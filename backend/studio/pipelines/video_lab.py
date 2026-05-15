"""Lab video pipeline.

This module mirrors the production video pipeline but uses lab_presets.py for
the model definition. Results are still stored as mode="video".
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any

from config import settings  # type: ignore[import-not-found]

from .._gpu_lock import gpu_slot
from ..comfy_api_builder import (
    build_ltx_lab_from_request,
    resolve_lab_video_loras,
)
from ..lab_presets import get_lab_video_preset
from ..presets import DEFAULT_OLLAMA_ROLES, compute_video_resize
from ..storage import _persist_history
from ..tasks import Task
from ..prompt_pipeline import UpgradeResult
from ..video_pipeline import VideoPipelineResult, run_video_pipeline
from ._dispatch import (
    _dispatch_to_comfy,
    _mark_generation_complete,
    _save_comfy_video,
)

log = logging.getLogger(__name__)


async def _run_video_lab_pipeline_task(
    task: Task,
    image_bytes: bytes,
    prompt: str,
    filename: str,
    preset_id: str,
    active_lora_ids: list[str],
    lora_strengths: dict[str, float],
    ollama_model_override: str | None = None,
    vision_model_override: str | None = None,
    adult_prompt: bool = False,
    auto_nsfw: bool = False,
    nsfw_intensity: int = 2,
    source_width: int = 0,
    source_height: int = 0,
    longer_edge: int | None = None,
    lightning: bool = True,
    *,
    pre_upgraded_prompt: str | None = None,
    prompt_mode: str = "fast",
) -> None:
    """Run a Lab LTX video task using the common SSE and ComfyUI dispatch path."""
    try:
        preset = get_lab_video_preset(preset_id)
        selected_loras = resolve_lab_video_loras(
            preset,
            active_lora_ids=active_lora_ids,
            strength_overrides=lora_strengths,
            lightning=lightning,
        )
        adult = adult_prompt or any(lora.role == "adult" for lora in selected_loras)
        lightning_effective = any(
            lora.role == "lightning" for lora in selected_loras
        )

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
            await task.emit(
                "stage",
                {"type": "vision-analyze", "progress": 5, "stageLabel": "비전 분석"},
            )
            async with gpu_slot("video-vision"):
                video_res = await run_video_pipeline(
                    image_bytes,
                    prompt,
                    model_id="ltx",
                    vision_model=vision_model_override
                    or DEFAULT_OLLAMA_ROLES.vision,
                    text_model=ollama_model_override or DEFAULT_OLLAMA_ROLES.text,
                    adult=adult,
                    auto_nsfw=auto_nsfw,
                    nsfw_intensity=nsfw_intensity,
                    prompt_mode=prompt_mode,
                )
            await task.emit(
                "stage",
                {
                    "type": "vision-analyze",
                    "progress": 20,
                    "stageLabel": "비전 분석 완료",
                    "description": video_res.image_description,
                },
            )
            await task.emit(
                "stage",
                {"type": "prompt-merge", "progress": 25, "stageLabel": "프롬프트 병합"},
            )
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

        await task.emit(
            "stage",
            {
                "type": "workflow-dispatch",
                "progress": 33,
                "stageLabel": "워크플로우 전달",
            },
        )

        actual_seed = int(time.time() * 1000) & 0xFFFFFFFF
        unet_override = getattr(settings, "ltx_unet_name", None)

        def _make_video_prompt(uploaded_name: str | None) -> dict[str, Any]:
            if uploaded_name is None:
                raise RuntimeError("Lab video pipeline requires uploaded image")
            return build_ltx_lab_from_request(
                preset=preset,
                active_lora_ids=active_lora_ids,
                strength_overrides=lora_strengths,
                prompt=video_res.final_prompt,
                source_filename=uploaded_name,
                seed=actual_seed,
                unet_override=unet_override,
                source_width=source_width or None,
                source_height=source_height or None,
                longer_edge=longer_edge,
                lightning=lightning,
            )

        await task.emit(
            "stage",
            {
                "type": "comfyui-sampling",
                "progress": 35,
                "stageLabel": "ComfyUI 샘플링 대기",
            },
        )

        dispatch = await _dispatch_to_comfy(
            task,
            _make_video_prompt,
            mode="video",
            progress_start=35,
            progress_span=57,
            client_prefix="ais-lab-v",
            upload_bytes=image_bytes,
            upload_filename=filename,
            save_output=_save_comfy_video,
            idle_timeout=900.0,
            hard_timeout=3600.0,
        )
        video_ref = dispatch.image_ref
        comfy_err = dispatch.comfy_error

        await task.emit(
            "stage",
            {"type": "save-output", "progress": 95, "stageLabel": "영상 저장"},
        )

        sampling = preset.sampling
        base_w, base_h = compute_video_resize(
            source_width or 0,
            source_height or 0,
            longer_edge or sampling.longer_edge,
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
            "steps": 0,
            "cfg": sampling.base_cfg,
            "lightning": lightning_effective,
            "model": preset.display_name,
            "modelId": preset.id,
            "createdAt": int(time.time() * 1000),
            "imageRef": video_ref,
            "upgradedPrompt": video_res.final_prompt,
            "upgradedPromptKo": video_res.upgrade.translation,
            "visionDescription": video_res.image_description,
            "promptProvider": video_res.upgrade.provider,
            "comfyError": comfy_err,
            "adult": adult,
            "autoNsfw": auto_nsfw,
            "nsfwIntensity": nsfw_intensity if auto_nsfw else None,
            "fps": float(sampling.fps),
            "frameCount": sampling.frame_count,
            "durationSec": float(sampling.seconds),
        }
        saved_to_history = await _persist_history(item)
        await task.emit("done", {"item": item, "savedToHistory": saved_to_history})
        _mark_generation_complete()

    except asyncio.CancelledError:
        log.info("Lab video pipeline cancelled: %s", task.task_id)
        raise
    except Exception as e:
        log.exception("Lab video pipeline error")
        await task.emit("error", {"message": str(e)})
    finally:
        await task.close()
