"""
studio.pipelines.video — _run_video_pipeline_task 백그라운드 실행기 (LTX-2.3 i2v).

5-step 체이닝 (vision → prompt-merge → workflow-dispatch → comfyui-sampling → save).
spec 19 (단계별 unload + Edit/Video swap fix) 정책 반영.

task #16 (2026-04-26): router.py 풀 분해.
주의: settings import 추가 (이전 router.py 에선 NameError 잠재 버그였음).
"""

from __future__ import annotations

import asyncio
import io
import logging
import time
import uuid
from typing import Any

from PIL import Image

from config import settings  # type: ignore[import-not-found]

from .._gpu_lock import gpu_slot
from ..comfy_api_builder import build_video_from_request
from ..presets import (
    DEFAULT_OLLAMA_ROLES,
    VIDEO_MODEL,
    compute_video_resize,
)
from ..storage import STUDIO_MAX_IMAGE_BYTES, _persist_history
from ..tasks import Task
from ..video_pipeline import run_video_pipeline
from ._dispatch import (
    _dispatch_to_comfy,
    _mark_generation_complete,
    _save_comfy_video,
)

log = logging.getLogger(__name__)

# 하위 호환 re-export. 실제 정책값은 storage.STUDIO_MAX_IMAGE_BYTES 단일 소스.
_VIDEO_MAX_IMAGE_BYTES = STUDIO_MAX_IMAGE_BYTES


def _extract_image_dims(image_bytes: bytes) -> tuple[int, int]:
    """업로드 바이트에서 (width, height) 추출. 실패 시 (0, 0)."""
    try:
        with Image.open(io.BytesIO(image_bytes)) as im:
            return im.size  # (w, h)
    except Exception as exc:  # pragma: no cover — PIL 내부 에러 다양
        log.warning("image dims 추출 실패: %s", exc)
        return 0, 0


async def _run_video_pipeline_task(
    task: Task,
    image_bytes: bytes,
    prompt: str,
    filename: str,
    ollama_model_override: str | None = None,
    vision_model_override: str | None = None,
    adult: bool = False,
    source_width: int = 0,
    source_height: int = 0,
    longer_edge: int | None = None,
    lightning: bool = True,
) -> None:
    """Video i2v 파이프라인 백그라운드 실행 (5 step).

    Progress 구간 배분:
      step 1 vision-analyze    0   → 20
      step 2 prompt-merge      20  → 30
      step 3 workflow-dispatch 30  → 35
      step 4 comfyui-sampling  35  → 92  (2-stage 내부 통합)
      step 5 save-output       92  → 98
    """
    try:
        # ── Step 1: vision ── (0 → 20)
        await task.emit(
            "stage",
            {"type": "vision-analyze", "progress": 5, "stageLabel": "비전 분석"},
        )
        await task.emit("step", {"step": 1, "done": False})

        async with gpu_slot("video-vision"):
            video_res = await run_video_pipeline(
                image_bytes,
                prompt,
                vision_model=vision_model_override or DEFAULT_OLLAMA_ROLES.vision,
                text_model=ollama_model_override or DEFAULT_OLLAMA_ROLES.text,
                adult=adult,
            )

        await task.emit(
            "step",
            {
                "step": 1,
                "done": True,
                "description": video_res.image_description,
            },
        )
        await task.emit(
            "stage",
            {"type": "vision-analyze", "progress": 20, "stageLabel": "비전 분석 완료"},
        )

        # ── Step 2: prompt-merge ── (20 → 30)
        await task.emit(
            "stage",
            {"type": "prompt-merge", "progress": 25, "stageLabel": "프롬프트 병합"},
        )
        await task.emit("step", {"step": 2, "done": False})
        await task.emit(
            "step",
            {
                "step": 2,
                "done": True,
                "finalPrompt": video_res.final_prompt,
                "finalPromptKo": video_res.upgrade.translation,
                "provider": video_res.upgrade.provider,
            },
        )
        await task.emit(
            "stage",
            {"type": "prompt-merge", "progress": 30, "stageLabel": "프롬프트 병합 완료"},
        )

        # ── Step 3: workflow-dispatch ── (30 → 35)
        await task.emit(
            "stage",
            {
                "type": "workflow-dispatch",
                "progress": 33,
                "stageLabel": "워크플로우 전달",
            },
        )
        await task.emit("step", {"step": 3, "done": False})

        actual_seed = int(time.time() * 1000) & 0xFFFFFFFF  # uint32 범위
        # .env 의 LTX_UNET_NAME override (config.settings.ltx_unet_name)
        unet_override = getattr(settings, "ltx_unet_name", None)

        def _make_video_prompt(uploaded_name: str | None) -> dict[str, Any]:
            if uploaded_name is None:
                raise RuntimeError("Video pipeline requires uploaded image")
            return build_video_from_request(
                prompt=video_res.final_prompt,
                source_filename=uploaded_name,
                seed=actual_seed,
                unet_override=unet_override,
                adult=adult,
                source_width=source_width or None,
                source_height=source_height or None,
                longer_edge=longer_edge,
                lightning=lightning,
            )

        await task.emit("step", {"step": 3, "done": True})

        # ── Step 4: ComfyUI sampling ── (35 → 92)
        await task.emit(
            "stage",
            {
                "type": "comfyui-sampling",
                "progress": 35,
                "stageLabel": "ComfyUI 샘플링 대기",
            },
        )
        await task.emit("step", {"step": 4, "done": False})

        # Ollama unload + GPU gate 는 _dispatch_to_comfy 내부에서 공통 처리.

        dispatch = await _dispatch_to_comfy(
            task,
            _make_video_prompt,
            mode="video",
            progress_start=35,
            progress_span=57,
            client_prefix="ais-v",
            upload_bytes=image_bytes,
            upload_filename=filename,
            save_output=_save_comfy_video,
            # LTX 는 긴 작업 — idle 15분, hard 1시간
            idle_timeout=900.0,
            hard_timeout=3600.0,
        )
        video_ref = dispatch.image_ref  # .mp4 URL
        comfy_err = dispatch.comfy_error

        await task.emit("step", {"step": 4, "done": True})

        # ── Step 5: save-output ── (92 → 98)
        await task.emit(
            "stage",
            {"type": "save-output", "progress": 95, "stageLabel": "영상 저장"},
        )
        await task.emit("step", {"step": 5, "done": True})

        # ── Done ──
        s = VIDEO_MODEL.sampling
        # 최종 영상 해상도 계산 — compute_video_resize 는 base(pre-upscale) 을 반환.
        # LTX-2.3 은 spatial upscaler x2 로 공간 해상도만 2배 → 최종 = base × 2.
        base_w, base_h = compute_video_resize(
            source_width or 0, source_height or 0, longer_edge
        )
        final_w, final_h = base_w * 2, base_h * 2
        item = {
            "id": f"vid-{uuid.uuid4().hex[:8]}",
            "mode": "video",
            "prompt": prompt,
            "label": prompt[:28] + ("…" if len(prompt) > 28 else ""),
            "width": final_w,
            "height": final_h,
            "seed": actual_seed,
            "steps": 0,  # LTX 는 ManualSigmas 기반 — 전통 step 개념 없음
            "cfg": s.base_cfg,
            "lightning": lightning,  # 실제 요청값 저장 (Lightning LoRA 토글)
            "model": VIDEO_MODEL.display_name,
            "createdAt": int(time.time() * 1000),
            "imageRef": video_ref,
            "upgradedPrompt": video_res.final_prompt,
            "upgradedPromptKo": video_res.upgrade.translation,
            "visionDescription": video_res.image_description,
            "promptProvider": video_res.upgrade.provider,
            "comfyError": comfy_err,
            # video 전용 메타 — adult/fps/frameCount/durationSec
            "adult": adult,
            "fps": s.fps,
            "frameCount": s.frame_count,
            "durationSec": s.seconds,
        }
        saved_to_history = await _persist_history(item)
        await task.emit(
            "done", {"item": item, "savedToHistory": saved_to_history}
        )
        _mark_generation_complete()

    except asyncio.CancelledError:
        log.info("Video pipeline cancelled: %s", task.task_id)
        raise
    except Exception as e:
        log.exception("Video pipeline error")
        await task.emit("error", {"message": str(e)})
    finally:
        await task.close()
