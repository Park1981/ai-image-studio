"""
studio.pipelines.edit — _run_edit_pipeline 백그라운드 실행기.

Edit 한 사이클 (vision → prompt merge → param extract → ComfyUI dispatch → save).
spec 17 (preserve 슬롯 누출 차단) + spec 19 (단계별 unload) 정책 반영.

task #16 (2026-04-26): router.py 풀 분해.
"""

from __future__ import annotations

import asyncio
import io
import logging
import time
import uuid
from typing import Any

from PIL import Image

from ..comfy_api_builder import build_edit_from_request
from ..presets import DEFAULT_OLLAMA_ROLES, EDIT_MODEL
from ..storage import (
    EDIT_SOURCE_DIR,
    EDIT_SOURCE_URL_PREFIX,
    TASK_ID_RE,
    _persist_history,
)
from ..tasks import Task
from ..vision_pipeline import run_vision_pipeline
from .. import ollama_unload
from ._dispatch import _dispatch_to_comfy, _mark_generation_complete

log = logging.getLogger(__name__)

# P1-5 (2026-04-26): Vision/Video 와 동일 정책 (20MB 상한).
_EDIT_MAX_IMAGE_BYTES = 20 * 1024 * 1024


async def _run_edit_pipeline(
    task: Task,
    image_bytes: bytes,
    prompt: str,
    lightning: bool,
    filename: str,
    ollama_model_override: str | None = None,
    vision_model_override: str | None = None,
    *,
    source_width: int = 0,
    source_height: int = 0,
) -> None:
    try:
        # Step 1: vision analysis — pipelineProgress 10 → 30
        await task.emit("stage", {"type": "vision-analyze", "progress": 10, "stageLabel": "비전 분석"})
        await task.emit("step", {"step": 1, "done": False})
        vision = await run_vision_pipeline(
            image_bytes,
            prompt,
            vision_model=vision_model_override or DEFAULT_OLLAMA_ROLES.vision,
            text_model=ollama_model_override or DEFAULT_OLLAMA_ROLES.text,
            # spec 19 후속 (Codex P1 #1): SOURCE 이미지 aspect 정보 전달.
            # 이전엔 analyze_edit_source 가 받게 만들었는데 여기서 안 넘겨
            # dead code 였음. 이제 layout/composition 정확도 ↑.
            width=source_width,
            height=source_height,
        )
        # step 1 done payload — Phase 1 (2026-04-25):
        #   기존 description (사용자 표시용 요약) 은 그대로 유지.
        #   신규 editVisionAnalysis 는 구조 분석 성공 시에만 payload 포함 (휘발 · DB X).
        step1_done_payload: dict[str, Any] = {
            "step": 1,
            "done": True,
            "description": vision.image_description,
        }
        # getattr 로 안전 접근 — 기존 테스트의 경량 mock (속성 없음) 호환.
        _analysis = getattr(vision, "edit_vision_analysis", None)
        if _analysis is not None:
            step1_done_payload["editVisionAnalysis"] = _analysis.to_dict()
        await task.emit("step", step1_done_payload)
        await task.emit("stage", {"type": "vision-analyze", "progress": 30, "stageLabel": "비전 분석 완료"})

        # Step 2: prompt merge (이미 vision 파이프라인에서 완료) — 40 → 50
        await task.emit("stage", {"type": "prompt-merge", "progress": 40, "stageLabel": "프롬프트 병합"})
        await task.emit("step", {"step": 2, "done": False})
        await asyncio.sleep(0.2)
        await task.emit(
            "step",
            {
                "step": 2,
                "done": True,
                "finalPrompt": vision.final_prompt,
                "finalPromptKo": vision.upgrade.translation,
                "provider": vision.upgrade.provider,
            },
        )
        await task.emit("stage", {"type": "prompt-merge", "progress": 50, "stageLabel": "프롬프트 병합 완료"})

        # Step 3: size/style auto-extraction — 55 → 65
        await task.emit("stage", {"type": "param-extract", "progress": 55, "stageLabel": "파라미터 추출"})
        await task.emit("step", {"step": 3, "done": False})
        await asyncio.sleep(0.15)
        await task.emit("step", {"step": 3, "done": True})
        await task.emit("stage", {"type": "param-extract", "progress": 65, "stageLabel": "파라미터 확정"})

        # Step 4: ComfyUI dispatch — 70 → 95 (샘플링 실시간 %)
        await task.emit("stage", {"type": "comfyui-sampling", "progress": 70, "stageLabel": "ComfyUI 샘플링 대기"})
        await task.emit("step", {"step": 4, "done": False})

        actual_seed = int(time.time() * 1000)

        # spec 19 후속 (옵션 A): Edit 한 사이클은 qwen2.5vl (~14GB) + gemma4
        # (~14.85GB) 둘 다 호출 → 누적 메모리 점유 위험. ComfyUI 디스패치 전
        # 전부 unload + 1.5초 대기.
        await ollama_unload.force_unload_all_before_comfy()

        def _make_edit_prompt(uploaded_name: str | None) -> dict[str, Any]:
            # Edit 는 업로드 이후에만 호출됨 → uploaded_name 반드시 있음
            if uploaded_name is None:
                raise RuntimeError("Edit pipeline requires uploaded image")
            return build_edit_from_request(
                prompt=vision.final_prompt,
                source_filename=uploaded_name,
                seed=actual_seed,
                lightning=lightning,
            )

        dispatch = await _dispatch_to_comfy(
            task,
            _make_edit_prompt,
            mode="edit",
            progress_start=70,
            progress_span=25,
            client_prefix="ais-e",
            upload_bytes=image_bytes,
            upload_filename=filename or "input.png",
        )
        image_ref = dispatch.image_ref
        comfy_err = dispatch.comfy_error
        # Edit 은 FluxKontextImageScale 가 원본+스케일 후 크기를 결정 → PIL 값이 권위
        result_w = dispatch.width or 0
        result_h = dispatch.height or 0

        await task.emit("step", {"step": 4, "done": True})
        await task.emit("stage", {"type": "save-output", "progress": 98, "stageLabel": "결과 저장"})

        # ── source 영구 저장 (비교 분석용) ──
        # task.task_id 형식 (tsk-xxxxxxxxxxxx) 보장 — 이미 _new_task 에서 생성한 값.
        # 정규식 화이트리스트로 path traversal 방지 (CLAUDE.md 규칙).
        source_ref: str | None = None
        if TASK_ID_RE.match(task.task_id):
            source_path = EDIT_SOURCE_DIR / f"{task.task_id}.png"
            try:
                # PIL 로 RGB 변환 후 PNG 로 저장 (JPG 입력도 무손실 PNG 로 통일)
                with Image.open(io.BytesIO(image_bytes)) as src_im:
                    src_im.convert("RGB").save(source_path, "PNG")
                source_ref = f"{EDIT_SOURCE_URL_PREFIX}/{task.task_id}.png"
            except Exception as src_err:
                log.warning(
                    "edit source persist failed (non-fatal): %s", src_err
                )
                # 결과는 그대로 살리고 sourceRef=None 으로 진행

        # Done
        item = {
            "id": f"edit-{uuid.uuid4().hex[:8]}",
            "mode": "edit",
            "prompt": prompt,
            "label": prompt[:28] + ("…" if len(prompt) > 28 else ""),
            "width": result_w,
            "height": result_h,
            "seed": actual_seed,
            "steps": EDIT_MODEL.lightning.steps if lightning else EDIT_MODEL.defaults.steps,
            "cfg": EDIT_MODEL.lightning.cfg if lightning else EDIT_MODEL.defaults.cfg,
            "lightning": lightning,
            "model": EDIT_MODEL.display_name,
            "createdAt": int(time.time() * 1000),
            "imageRef": image_ref,
            "upgradedPrompt": vision.final_prompt,
            "upgradedPromptKo": vision.upgrade.translation,
            "visionDescription": vision.image_description,
            "comfyError": comfy_err,
            "sourceRef": source_ref,
        }
        # Phase 1 (2026-04-25): 구조 분석은 item 에만 붙여 SSE done 으로 전달.
        # insert_item 이 알려진 컬럼만 INSERT 하므로 DB persist X (휘발 패턴 유지).
        if _analysis is not None:
            item["editVisionAnalysis"] = _analysis.to_dict()
            # spec 19 후속 (v6): refined_intent 캐싱 — 비교 분석 (compare-analyze)
            # 이 historyItemId 받으면 이 값을 재사용해 gemma4 cold start ~5초 절약.
            # _analysis.intent 가 정제 영문 1-2문장 (clarify_edit_intent 결과).
            cached_intent = getattr(_analysis, "intent", "") or ""
            if cached_intent:
                item["refinedIntent"] = cached_intent
        saved_to_history = await _persist_history(item)
        await task.emit(
            "done", {"item": item, "savedToHistory": saved_to_history}
        )
        _mark_generation_complete()
    except asyncio.CancelledError:
        log.info("Edit pipeline cancelled: %s", task.task_id)
        raise
    except Exception as e:
        log.exception("Edit pipeline error")
        await task.emit("error", {"message": str(e)})
    finally:
        await task.close()
