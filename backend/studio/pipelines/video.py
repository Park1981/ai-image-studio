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
    DEFAULT_VIDEO_MODEL_ID,
    LTX_VIDEO_PRESET,
    VIDEO_MODEL,  # 호환 alias (== LTX_VIDEO_PRESET)
    VideoModelId,
    WAN22_VIDEO_PRESET,
    Wan22ModelPreset,
    compute_video_resize,
    get_video_preset,
)
from ..storage import STUDIO_MAX_IMAGE_BYTES, _persist_history
from ..tasks import Task
from ..prompt_pipeline import UpgradeResult
from ..video_pipeline import VideoPipelineResult, run_video_pipeline
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
    *,
    model_id: VideoModelId = DEFAULT_VIDEO_MODEL_ID,
    pre_upgraded_prompt: str | None = None,
    # Phase 2 (2026-05-01) — gemma4 보강 모드 ("fast" | "precise")
    prompt_mode: str = "fast",
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
        # Phase 4 (2026-04-27 진행 모달 store 통일 · 정리):
        #   step emit 완전 제거 (Phase 3 transitional 종료).
        #   stage 완료 emit payload 안에 detail (description / finalPrompt /
        #   finalPromptKo / provider) 흡수. 진입 emit + 완료 emit 둘 다 유지
        #   (PipelineTimeline 의 running row 표시 용). 완료 emit 에만 payload 풍부.

        # ── Step 1+2: vision-analyze + prompt-merge ──
        # pre_upgraded_prompt 가 있으면 두 단계 모두 우회 (사용자가 정제된 영문 입력 케이스).
        # vision (qwen2.5vl ~14GB) + gemma4 (14.85GB) 둘 다 안 호출 → ~15초 절약.
        if pre_upgraded_prompt:
            video_res = VideoPipelineResult(
                image_description="(pre-upgraded — vision skipped)",
                final_prompt=pre_upgraded_prompt,
                vision_ok=False,
                upgrade=UpgradeResult(
                    upgraded=pre_upgraded_prompt,
                    fallback=False,
                    provider="pre-confirmed",
                    original=prompt,
                ),
            )
            # 진입+완료 emit 한 번에 (UI 타임라인 일관성 — 빈 단계 표시).
            await task.emit(
                "stage",
                {
                    "type": "vision-analyze",
                    "progress": 20,
                    "stageLabel": "비전 분석 우회 (사전 확정 프롬프트)",
                    "description": video_res.image_description,
                },
            )
            await task.emit(
                "stage",
                {
                    "type": "prompt-merge",
                    "progress": 30,
                    "stageLabel": "프롬프트 병합 우회 (사전 확정)",
                    "finalPrompt": video_res.final_prompt,
                    "finalPromptKo": None,
                    "provider": "pre-confirmed",
                },
            )
        else:
            # ── Step 1: vision ── (0 → 20)
            await task.emit(
                "stage",
                {"type": "vision-analyze", "progress": 5, "stageLabel": "비전 분석"},
            )

            async with gpu_slot("video-vision"):
                video_res = await run_video_pipeline(
                    image_bytes,
                    prompt,
                    model_id=model_id,  # 3단 전파 (spec v1.1 Codex Finding 2)
                    vision_model=vision_model_override or DEFAULT_OLLAMA_ROLES.vision,
                    text_model=ollama_model_override or DEFAULT_OLLAMA_ROLES.text,
                    adult=adult,
                    prompt_mode=prompt_mode,
                )

            # stage 완료 payload 에 description 흡수.
            await task.emit(
                "stage",
                {
                    "type": "vision-analyze",
                    "progress": 20,
                    "stageLabel": "비전 분석 완료",
                    "description": video_res.image_description,
                },
            )

            # ── Step 2: prompt-merge ── (20 → 30)
            await task.emit(
                "stage",
                {"type": "prompt-merge", "progress": 25, "stageLabel": "프롬프트 병합"},
            )
            # prompt-merge 완료 stage 에 finalPrompt/finalPromptKo/provider 흡수.
            await task.emit(
                "stage",
                {
                    "type": "prompt-merge",
                    "progress": 30,
                    "stageLabel": "프롬프트 병합 완료",
                    "finalPrompt": video_res.final_prompt,
                    "finalPromptKo": video_res.upgrade.translation,
                    "provider": video_res.upgrade.provider,
                },
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

        actual_seed = int(time.time() * 1000) & 0xFFFFFFFF  # uint32 범위
        # .env 의 LTX_UNET_NAME override (config.settings.ltx_unet_name) — LTX 만 의미
        unet_override = getattr(settings, "ltx_unet_name", None)

        def _make_video_prompt(uploaded_name: str | None) -> dict[str, Any]:
            if uploaded_name is None:
                raise RuntimeError("Video pipeline requires uploaded image")
            return build_video_from_request(
                model_id=model_id,
                prompt=video_res.final_prompt,
                source_filename=uploaded_name,
                seed=actual_seed,
                unet_override=unet_override if model_id == "ltx" else None,
                adult=adult,
                source_width=source_width or None,
                source_height=source_height or None,
                longer_edge=longer_edge,
                lightning=lightning,
            )

        # ── Step 4: ComfyUI sampling ── (35 → 92)
        await task.emit(
            "stage",
            {
                "type": "comfyui-sampling",
                "progress": 35,
                "stageLabel": "ComfyUI 샘플링 대기",
            },
        )

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

        # ── Step 5: save-output ── (92 → 98)
        await task.emit(
            "stage",
            {"type": "save-output", "progress": 95, "stageLabel": "영상 저장"},
        )

        # ── Done ──
        # 모델별 history item 분기 (Phase 3 · spec §4.3)
        preset = get_video_preset(model_id)
        # 최종 영상 해상도 계산 — compute_video_resize 가 base(pre-upscale) 을 반환.
        base_w, base_h = compute_video_resize(
            source_width or 0, source_height or 0, longer_edge
        )
        if isinstance(preset, Wan22ModelPreset):
            # Wan 2.2: spatial upscaler 없음 — base dims 그대로
            ws = preset.sampling
            final_w, final_h = base_w, base_h
            fps_val: float = float(ws.base_fps)
            frame_count = ws.default_length
            duration_sec: float = round(ws.default_length / ws.base_fps, 2)
            cfg_val: float = ws.lightning_cfg if lightning else ws.precise_cfg
            steps_val: int = ws.lightning_steps if lightning else ws.precise_steps
        else:
            # LTX 2.3: spatial upscaler x2 로 공간 해상도만 2배 → 최종 = base × 2
            ls = preset.sampling
            final_w, final_h = base_w * 2, base_h * 2
            fps_val = float(ls.fps)
            frame_count = ls.frame_count
            duration_sec = float(ls.seconds)
            cfg_val = ls.base_cfg
            steps_val = 0  # LTX 는 ManualSigmas — 전통 step 개념 없음
        item = {
            "id": f"vid-{uuid.uuid4().hex[:8]}",
            "mode": "video",
            "prompt": prompt,
            "label": prompt[:28] + ("…" if len(prompt) > 28 else ""),
            "width": final_w,
            "height": final_h,
            "seed": actual_seed,
            "steps": steps_val,
            "cfg": cfg_val,
            "lightning": lightning,  # 실제 요청값 저장 (Lightning LoRA 토글)
            "model": preset.display_name,
            "modelId": model_id,  # NEW (Phase 3) — DB persist X · 응답에만 동봉
            "createdAt": int(time.time() * 1000),
            "imageRef": video_ref,
            "upgradedPrompt": video_res.final_prompt,
            "upgradedPromptKo": video_res.upgrade.translation,
            "visionDescription": video_res.image_description,
            "promptProvider": video_res.upgrade.provider,
            "comfyError": comfy_err,
            # video 전용 메타 — adult/fps/frameCount/durationSec
            "adult": adult,
            "fps": fps_val,
            "frameCount": frame_count,
            "durationSec": duration_sec,
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
