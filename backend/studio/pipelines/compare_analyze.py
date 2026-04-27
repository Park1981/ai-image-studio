"""
studio.pipelines.compare_analyze — 비교 분석 백그라운드 파이프라인.

Phase 6 (2026-04-27): /api/studio/compare-analyze 를 task-based SSE 로 전환.

context 분기:
  - "edit" (default): analyze_pair v3 — 도메인 분기 + 5 슬롯 매트릭스 + 의도 점수
  - "compare": analyze_pair_generic — Vision Compare 메뉴 (5축 generic)

흐름:
  1. emit "stage" type=compare-encoding (이미지 인코딩 마킹)
  2. (edit context 만) refined_intent 캐시 조회 / fresh clarify_edit_intent
     - emit "stage" type=intent-refine (있을 때만)
  3. analyze_pair / analyze_pair_generic with progress_callback
     - on_progress("vision-pair") → emit "stage" type=vision-pair
     - on_progress("translation") → emit "stage" type=translation
  4. (edit context + history_item_id 있음) DB persist
  5. emit "done" with {analysis, saved}

GPU lock: 옛 동작 그대로 (refine 은 별도 짧은 gate, 비교 분석은 30s 대기 후 busy).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from .. import history_db, ollama_unload
from .._gpu_lock import GpuBusyError, gpu_slot
from ..comparison_pipeline import analyze_pair, analyze_pair_generic
from ..prompt_pipeline import clarify_edit_intent
from ..storage import TASK_ID_RE
from ..tasks import Task

log = logging.getLogger(__name__)


# stage type → progress 매핑
_PROGRESS = {
    "intent-refine": 10,
    "vision-pair": 25,
    "translation": 75,
}
_LABEL = {
    "intent-refine": "수정 의도 정제 (gemma4)",
    "vision-pair": "두 이미지 비교 분석 (qwen2.5vl)",
    "translation": "한국어 번역 (gemma4)",
}


async def _run_compare_analyze_pipeline(
    task: Task,
    *,
    source_bytes: bytes,
    result_bytes: bytes,
    context: str,
    edit_prompt: str,
    compare_hint: str,
    history_item_id_raw: Any,
    vision_override: str | None,
    text_override: str | None,
) -> None:
    """비교 분석 백그라운드 파이프라인.

    routes/compare.py POST handler 가 이미 validation + bytes read 끝낸 상태.
    여기서는 refined_intent 준비 + GPU lock + analyze_* 호출 + DB persist + done emit.
    """
    try:
        # ── 1단계: 인코딩 마킹 ──
        await task.emit(
            "stage",
            {
                "type": "compare-encoding",
                "progress": 5,
                "stageLabel": "이미지 A/B 인코딩",
            },
        )

        # ── 2단계: refined_intent 준비 (edit context 만) ──
        # - 캐시 조회 → 미스면 짧은 gpu_slot 안에서 clarify_edit_intent (gemma4)
        # - 비교 분석 lock 과는 분리 (gemma4 cold start 가 다른 compare 요청 막지 않게)
        refined_intent = ""
        if context != "compare":
            if (
                isinstance(history_item_id_raw, str)
                and TASK_ID_RE.match(history_item_id_raw)
            ):
                try:
                    cached_item = await history_db.get_item(history_item_id_raw)
                    if cached_item and cached_item.get("refinedIntent"):
                        refined_intent = cached_item["refinedIntent"]
                except Exception as cache_err:
                    log.info(
                        "compare-analyze refined_intent cache lookup failed (non-fatal): %s",
                        cache_err,
                    )

            if not refined_intent and edit_prompt:
                # stage emit — UI 가 "수정 의도 정제" 줄 표시 (캐시 미스 시만 도착)
                await task.emit(
                    "stage",
                    {
                        "type": "intent-refine",
                        "progress": _PROGRESS["intent-refine"],
                        "stageLabel": _LABEL["intent-refine"],
                    },
                )
                try:
                    async with gpu_slot("compare-refine"):
                        refined_intent = await clarify_edit_intent(
                            edit_prompt,
                            model=text_override or "gemma4-un:latest",
                            timeout=60.0,
                        )
                except GpuBusyError as e:
                    await task.emit(
                        "error", {"message": str(e), "code": "gpu_busy"}
                    )
                    return
                except Exception as exc:
                    log.info(
                        "compare-analyze refine failed (non-fatal): %s", exc
                    )

        # ── 3단계: 비교 분석 호출 (with progress callback) ──
        async def on_progress(stage_type: str) -> None:
            await task.emit(
                "stage",
                {
                    "type": stage_type,
                    "progress": _PROGRESS.get(stage_type, 50),
                    "stageLabel": _LABEL.get(stage_type, stage_type),
                },
            )

        try:
            async with gpu_slot("compare-analyze"):
                if context == "compare":
                    result_obj = await analyze_pair_generic(
                        image_a_bytes=source_bytes,
                        image_b_bytes=result_bytes,
                        compare_hint=compare_hint,
                        vision_model=vision_override,
                        text_model=text_override,
                        progress_callback=on_progress,
                    )
                else:
                    result_obj = await analyze_pair(
                        source_bytes=source_bytes,
                        result_bytes=result_bytes,
                        edit_prompt=edit_prompt,
                        vision_model=vision_override,
                        text_model=text_override,
                        refined_intent=refined_intent,
                        progress_callback=on_progress,
                    )

                # spec 19 후속 — gate 안에서 unload 보내야 다음 ComfyUI dispatch 와 race 0
                try:
                    await ollama_unload.force_unload_all_loaded_models(
                        wait_sec=0.0
                    )
                except Exception as unload_err:
                    log.info(
                        "compare-analyze post-unload failed (non-fatal): %s",
                        unload_err,
                    )
        except GpuBusyError as e:
            await task.emit("error", {"message": str(e), "code": "gpu_busy"})
            return

        # ── 4단계: DB persist (edit context + history_item_id 매치 시만) ──
        saved = False
        if (
            isinstance(history_item_id_raw, str)
            and TASK_ID_RE.match(history_item_id_raw)
        ):
            try:
                saved = await history_db.update_comparison(
                    history_item_id_raw, result_obj.to_dict()
                )
            except Exception as db_err:
                log.warning("compare-analyze DB persist failed: %s", db_err)
                saved = False

        # ── 5단계: done event ──
        await task.emit(
            "done", {"analysis": result_obj.to_dict(), "saved": saved}
        )

    except asyncio.CancelledError:
        log.info("Compare-analyze pipeline cancelled: %s", task.task_id)
        raise
    except Exception as e:  # pragma: no cover - 방어적
        log.exception("Compare-analyze pipeline crashed: %s", e)
        await task.emit("error", {"message": str(e), "code": "internal"})
    finally:
        await task.close()
