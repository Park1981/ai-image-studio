"""
studio.pipelines.compare_analyze — 비교 분석 백그라운드 파이프라인.

Phase 6 (2026-04-27): /api/studio/compare-analyze 를 task-based SSE 로 전환.

context 분기:
  - "edit" (default): analyze_pair v3 — 도메인 분기 + 5 슬롯 매트릭스 + 의도 점수 + DB persist
  - "compare": analyze_pair_v4 — Vision Compare 재설계 (관찰자→편집자 듀얼 + 5 카테고리 · 휘발 정책)

흐름 (compare context — Task 11 V4):
  1. emit "stage" type=compare-encoding
  2. analyze_pair_v4 with progress_callback (observe1 → observe2 → diff-synth → translation)
  3. emit "done" {analysis, saved=False} (휘발)

흐름 (edit context — v3 무변경):
  1. emit "stage" type=compare-encoding
  2. refined_intent 캐시 조회 / fresh clarify_edit_intent (intent-refine emit)
  3. analyze_pair v3 with progress_callback (vision-pair → translation)
  4. (history_item_id 매치 시) DB persist
  5. emit "done" {analysis, saved}

GPU lock: 옛 동작 그대로 (refine 은 별도 짧은 gate, 비교 분석은 30s 대기 후 busy).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from .. import history_db, ollama_unload
from .._gpu_lock import GpuBusyError, gpu_slot
from ..compare_pipeline_v4 import analyze_pair_v4
from ..comparison_pipeline import analyze_pair
from ..prompt_pipeline import clarify_edit_intent
from ..storage import HISTORY_ID_RE
from ..tasks import Task

log = logging.getLogger(__name__)


# stage type → progress 매핑 (v3 — edit context 전용)
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

# Task 11 (V4 — compare context 전용) — 5 stage 매핑.
# compare-encoding 은 본 pipeline 이 직접 emit (기점), 나머지 4 는 analyze_pair_v4 의 progress_callback 으로 전달.
_V4_PROGRESS = {
    "observe1": 20,
    "observe2": 40,
    "diff-synth": 70,
    "translation": 90,
}
_V4_LABEL = {
    "observe1": "Image1 관찰 (qwen3-vl)",
    "observe2": "Image2 관찰 (qwen3-vl)",
    "diff-synth": "차이 합성 (gemma4)",
    "translation": "한국어 번역 (gemma4)",
}


async def _run_compare_analyze_pipeline(
    task: Task,
    *,
    source_bytes: bytes,
    result_bytes: bytes,
    # Task 10 (V4): route 가 PIL verify + size 추출해서 넘김.
    # Task 11 에서 V4 (compare context) 가 observe_image 호출 시 사용.
    # v3 (edit context) 는 사용 안 함 (옛 동작 유지).
    source_w: int = 0,
    source_h: int = 0,
    result_w: int = 0,
    result_h: int = 0,
    context: str,
    edit_prompt: str,
    compare_hint: str,
    history_item_id_raw: Any,
    vision_override: str | None,
    text_override: str | None,
    # Phase 2 (2026-05-01) — Edit 자동 트리거 시 Edit 의 promptMode 가 그대로 전파.
    # cache miss 케이스에서만 clarify_edit_intent 호출에 영향. 수동 Compare 는 fast.
    prompt_mode: str = "fast",
) -> None:
    """비교 분석 백그라운드 파이프라인.

    routes/compare.py POST handler 가 이미 validation + bytes read 끝낸 상태.
    여기서는 refined_intent 준비 + GPU lock + analyze_* 호출 + DB persist + done emit.
    """
    try:
        # ── 1단계: 인코딩 마킹 (옛 호환 · v3/V4 공통) ──
        await task.emit(
            "stage",
            {
                "type": "compare-encoding",
                "progress": 5,
                "stageLabel": "이미지 A/B 인코딩",
            },
        )

        # ── Task 11 (V4): compare context 분기 ──
        # 옛 v2_generic 흐름을 V4 (관찰자→편집자 듀얼) 로 교체.
        # persist 안 함 (휘발 정책) + early return 으로 옛 edit 흐름과 격리.
        if context == "compare":

            async def _on_progress_v4(stage_type: str) -> None:
                """analyze_pair_v4 의 4 stage 진행 callback 을 task SSE 로 forward."""
                await task.emit(
                    "stage",
                    {
                        "type": stage_type,
                        "progress": _V4_PROGRESS.get(stage_type, 50),
                        "stageLabel": _V4_LABEL.get(stage_type, stage_type),
                    },
                )

            try:
                async with gpu_slot("compare-analyze"):
                    # ollama_url + timeout 은 settings.py 와 동일 default (config.py:63 미러).
                    # 후속 plan 후보: config.py 에서 settings 주입 (현재는 다른 pipeline 들과 일관 hardcode).
                    v4_result = await analyze_pair_v4(
                        image1_bytes=source_bytes,
                        image2_bytes=result_bytes,
                        image1_w=source_w,
                        image1_h=source_h,
                        image2_w=result_w,
                        image2_h=result_h,
                        compare_hint=compare_hint,
                        vision_model=vision_override or "qwen3-vl:8b",
                        text_model=text_override or "gemma4-un:latest",
                        ollama_url="http://127.0.0.1:11434",
                        timeout=90.0,
                        progress_callback=_on_progress_v4,
                    )
                    # spec 19 후속 — gate 안에서 unload 보내야 다음 ComfyUI dispatch 와 race 0
                    try:
                        await ollama_unload.force_unload_all_loaded_models(
                            wait_sec=0.0
                        )
                    except Exception as unload_err:
                        log.info(
                            "compare-v4 post-unload failed (non-fatal): %s",
                            unload_err,
                        )
            except GpuBusyError as e:
                await task.emit(
                    "error", {"message": str(e), "code": "gpu_busy"}
                )
                return

            # context='compare' — DB persist 차단 (휘발 정책).
            # SSE done payload 는 옛 키 그대로 ({analysis, saved}) — frontend 호환.
            await task.emit(
                "done", {"analysis": v4_result.to_dict(), "saved": False}
            )
            return

        # ── 2단계: refined_intent 준비 (edit context 만) ──
        # - 캐시 조회 → 미스면 짧은 gpu_slot 안에서 clarify_edit_intent (gemma4)
        # - 비교 분석 lock 과는 분리 (gemma4 cold start 가 다른 compare 요청 막지 않게)
        refined_intent = ""
        if context != "compare":
            # Codex C1 fix (2026-04-30): TASK_ID_RE → HISTORY_ID_RE.
            # history.id 는 gen-/edit-/vid- prefix 라서 옛 TASK_ID_RE (tsk-*) 로는
            # 절대 매치되지 않아 캐시 lookup 자체가 죽어 있었음.
            if (
                isinstance(history_item_id_raw, str)
                and HISTORY_ID_RE.match(history_item_id_raw)
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
                            prompt_mode=prompt_mode,
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
            # Task 14 (2026-05-05): compare context 는 위에서 V4 early return.
            # 여기 도달하면 항상 edit context — analyze_pair v3 단일 호출.
            async with gpu_slot("compare-analyze"):
                result_obj = await analyze_pair(
                    source_bytes=source_bytes,
                    result_bytes=result_bytes,
                    edit_prompt=edit_prompt,
                    vision_model=vision_override,
                    text_model=text_override,
                    refined_intent=refined_intent,
                    progress_callback=on_progress,
                )

                # ── Phase 6 cleanup (시각 일관성): stage 완료 시점 결과 흡수 emit ──
                # vision-pair done 시 overall 점수 + summary, translation done 시 한글 summary.
                # PipelineTimeline byType Map 이 마지막 payload 로 덮어씌움 → renderDetail 가 사용.
                await task.emit(
                    "stage",
                    {
                        "type": "vision-pair",
                        "progress": 70,
                        "stageLabel": "비교 분석 완료",
                        "overall": getattr(result_obj, "overall", None),
                        "summaryEn": getattr(result_obj, "summary_en", ""),
                        "provider": getattr(result_obj, "provider", "ollama"),
                        "fallback": getattr(result_obj, "fallback", False),
                    },
                )
                summary_ko = getattr(result_obj, "summary_ko", "")
                if summary_ko and summary_ko != "한글 번역 실패":
                    await task.emit(
                        "stage",
                        {
                            "type": "translation",
                            "progress": 95,
                            "stageLabel": "한국어 번역 완료",
                            "summaryKo": summary_ko,
                        },
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

        # ── 4단계: DB persist (history id 가 gen-/edit-/vid- 형식 매치 시만) ──
        # Codex C1 fix (2026-04-30): TASK_ID_RE 는 SSE 내부 task 채널 id (tsk-*) 전용.
        # 클라이언트가 보내는 historyItemId 는 gen-/edit-/vid- prefix 라서 옛 코드는
        # 절대 saved=True 가 될 수 없었음 → 결과가 store 휘발 상태.
        # update_comparison 은 rowcount==0 이면 False 반환 (id 매치 row 없음 → 무시).
        saved = False
        if (
            isinstance(history_item_id_raw, str)
            and HISTORY_ID_RE.match(history_item_id_raw)
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
