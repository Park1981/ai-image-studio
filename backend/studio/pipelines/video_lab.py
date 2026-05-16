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
    SULPHUR_OFFICIAL_PROFILE_ID,
    build_ltx_lab_from_request,
    build_video_from_request,
    resolve_lab_video_loras,
)
from ..lab_presets import get_lab_video_preset
from ..presets import (
    DEFAULT_OLLAMA_ROLES,
    Wan22ModelPreset,
    compute_video_resize,
    get_video_preset,
)
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
    sulphur_profile: str | None = None,
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
        final_longer_edge = longer_edge or preset.sampling.longer_edge

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
                longer_edge=final_longer_edge,
                lightning=lightning,
                sulphur_profile=sulphur_profile,
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
            final_longer_edge,
        )
        final_w, final_h = base_w, base_h
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


class _ModelScopedTask:
    """Forward dispatch stage events while tagging the active pair model."""

    def __init__(self, task: Task, model_id: str) -> None:
        self.task_id = task.task_id
        self._task = task
        self._model_id = model_id

    async def emit(self, event: str, payload: dict[str, Any]) -> None:
        if event == "stage":
            payload = {**payload, "modelId": self._model_id}
        await self._task.emit(event, payload)


def build_sulphur_5beat_prompt(
    *,
    image_description: str,
    user_direction: str,
    upgraded_prompt: str,
) -> str:
    """Create Sulphur's model-specific i2v prompt using its 5-beat guide."""
    subject = image_description.strip() or "The subject from the reference image"
    direction = upgraded_prompt.strip() or user_direction.strip() or "subtle motion"
    return (
        f"{subject}, preserving the exact same identity, face, facial proportions, "
        "hairstyle, body proportions, outfit details, environment, and lighting from "
        "the reference image. No face swap, no identity drift.\n"
        f"Beat 1 : The subject starts from the reference pose and begins a small, realistic preparation for: {direction}\n"
        "Beat 2 : The action intensifies naturally; the body posture changes clearly while the face remains stable.\n"
        "Beat 3 : The main movement becomes the strongest moment of the sequence, with believable body mechanics.\n"
        "Beat 4 : The movement continues from Beat 3 without a jump cut, keeping the same person and scene continuity.\n"
        "Beat 5 : The action resolves into a held final posture with a lingering emotional expression.\n"
        "Camera work: camera movement supports the action with controlled cinematic tracking, no sudden zoom, no reframing that hides the face.\n"
        "Acting should be emotional and realistic.\n"
        "4K details, natural color, cinematic lighting and shadows, crisp textures, clean edges, "
        "fine material detail, high microcontrast, realistic shading, accurate tone mapping, "
        "smooth gradients, realistic highlights, detailed fabric and hair, sharp and natural."
    )


def _pair_item(
    *,
    model_id: str,
    prompt: str,
    model_prompt: str,
    image_description: str,
    provider: str,
    image_ref: str,
    comfy_error: str | None,
    seed: int,
    source_width: int,
    source_height: int,
    longer_edge: int | None,
    lightning: bool,
    adult: bool,
) -> dict[str, Any]:
    if model_id == "wan22":
        preset = get_video_preset("wan22")
        assert isinstance(preset, Wan22ModelPreset)
        sampling = preset.sampling
        resolved_edge = longer_edge or sampling.default_width
        base_w, base_h = compute_video_resize(
            source_width or 0,
            source_height or 0,
            resolved_edge,
        )
        final_w, final_h = base_w, base_h
        fps_val = float(sampling.base_fps)
        frame_count = sampling.default_length
        duration_sec = round(sampling.default_length / sampling.base_fps, 2)
        cfg_val = sampling.lightning_cfg if lightning else sampling.precise_cfg
        steps_val = sampling.lightning_steps if lightning else sampling.precise_steps
        model_name = preset.display_name
    else:
        preset = get_lab_video_preset("ltx-sulphur")
        resolved_edge = longer_edge or preset.sampling.longer_edge
        final_w, final_h = compute_video_resize(
            source_width or 0,
            source_height or 0,
            resolved_edge,
        )
        fps_val = 24.0
        frame_count = 121
        duration_sec = 5.0
        cfg_val = 1.0
        steps_val = 0
        model_name = preset.display_name

    return {
        "id": f"vid-{uuid.uuid4().hex[:8]}",
        "mode": "video",
        "prompt": prompt,
        "label": prompt[:28] + ("…" if len(prompt) > 28 else ""),
        "width": final_w,
        "height": final_h,
        "seed": seed,
        "steps": steps_val,
        "cfg": cfg_val,
        "lightning": lightning,
        "model": model_name,
        "modelId": model_id,
        "createdAt": int(time.time() * 1000),
        "imageRef": image_ref,
        "upgradedPrompt": model_prompt,
        "upgradedPromptKo": None,
        "visionDescription": image_description,
        "promptProvider": provider,
        "comfyError": comfy_error,
        "adult": adult,
        "fps": fps_val,
        "frameCount": frame_count,
        "durationSec": duration_sec,
    }


async def _run_video_lab_pair_pipeline_task(
    task: Task,
    image_bytes: bytes,
    prompt: str,
    filename: str,
    preset_id: str,
    ollama_model_override: str | None = None,
    vision_model_override: str | None = None,
    adult_prompt: bool = True,
    auto_nsfw: bool = False,
    nsfw_intensity: int = 2,
    source_width: int = 0,
    source_height: int = 0,
    longer_edge: int | None = None,
    lightning: bool = True,
    *,
    prompt_mode: str = "fast",
    pair_mode: str = "shared_5beat",
    sulphur_profile: str = SULPHUR_OFFICIAL_PROFILE_ID,
) -> None:
    """Run Wan first and Sulphur second with model-specific enhanced prompts."""
    try:
        if pair_mode != "shared_5beat":
            raise ValueError(f"unknown lab compare mode: {pair_mode!r}")
        if sulphur_profile != SULPHUR_OFFICIAL_PROFILE_ID:
            raise ValueError(f"unknown sulphur profile: {sulphur_profile!r}")

        preset = get_lab_video_preset(preset_id)
        await task.emit(
            "stage",
            {
                "type": "pair-prompt",
                "progress": 5,
                "stageLabel": "모델별 프롬프트 구성",
            },
        )
        async with gpu_slot("video-lab-pair-vision"):
            video_res = await run_video_pipeline(
                image_bytes,
                prompt,
                model_id="wan22",
                vision_model=vision_model_override or DEFAULT_OLLAMA_ROLES.vision,
                text_model=ollama_model_override or DEFAULT_OLLAMA_ROLES.text,
                adult=adult_prompt,
                auto_nsfw=auto_nsfw,
                nsfw_intensity=nsfw_intensity,
                prompt_mode=prompt_mode,
            )
        wan_prompt = video_res.final_prompt
        sulphur_prompt = build_sulphur_5beat_prompt(
            image_description=video_res.image_description,
            user_direction=prompt,
            upgraded_prompt=wan_prompt,
        )
        model_prompts = {"wan22": wan_prompt, preset.id: sulphur_prompt}
        await task.emit(
            "stage",
            {
                "type": "pair-prompt",
                "progress": 15,
                "stageLabel": "모델별 프롬프트 완료",
                "sharedPrompt": sulphur_prompt,
                "modelPrompts": model_prompts,
                "provider": video_res.upgrade.provider,
            },
        )

        actual_seed = int(time.time() * 1000) & 0xFFFFFFFF
        unet_override = getattr(settings, "ltx_unet_name", None)
        final_longer_edge = longer_edge or preset.sampling.longer_edge

        def _make_wan_prompt(uploaded_name: str | None) -> dict[str, Any]:
            if uploaded_name is None:
                raise RuntimeError("Lab compare Wan requires uploaded image")
            return build_video_from_request(
                model_id="wan22",
                prompt=wan_prompt,
                source_filename=uploaded_name,
                seed=actual_seed,
                source_width=source_width or None,
                source_height=source_height or None,
                longer_edge=longer_edge,
                lightning=lightning,
            )

        await task.emit(
            "stage",
            {
                "type": "pair-model-start",
                "progress": 20,
                "stageLabel": "Wan 생성 시작",
                "modelId": "wan22",
            },
        )
        wan_dispatch = await _dispatch_to_comfy(
            _ModelScopedTask(task, "wan22"),
            _make_wan_prompt,
            mode="video",
            progress_start=20,
            progress_span=30,
            client_prefix="ais-lab-pair-wan",
            upload_bytes=image_bytes,
            upload_filename=filename,
            save_output=_save_comfy_video,
            idle_timeout=900.0,
            hard_timeout=3600.0,
        )
        if wan_dispatch.comfy_error:
            await task.emit(
                "error",
                {
                    "message": wan_dispatch.comfy_error,
                    "failedModelId": "wan22",
                },
            )
            _mark_generation_complete()
            return
        wan_item = _pair_item(
            model_id="wan22",
            prompt=prompt,
            model_prompt=wan_prompt,
            image_description=video_res.image_description,
            provider=video_res.upgrade.provider,
            image_ref=wan_dispatch.image_ref,
            comfy_error=wan_dispatch.comfy_error,
            seed=actual_seed,
            source_width=source_width,
            source_height=source_height,
            longer_edge=longer_edge,
            lightning=lightning,
            adult=adult_prompt,
        )
        wan_saved = await _persist_history(wan_item)

        def _make_sulphur_prompt(uploaded_name: str | None) -> dict[str, Any]:
            if uploaded_name is None:
                raise RuntimeError("Lab compare Sulphur requires uploaded image")
            return build_ltx_lab_from_request(
                preset=preset,
                active_lora_ids=["distill_sulphur", "adult_sulphur"],
                strength_overrides={},
                prompt=sulphur_prompt,
                source_filename=uploaded_name,
                seed=actual_seed,
                unet_override=unet_override,
                source_width=source_width or None,
                source_height=source_height or None,
                longer_edge=final_longer_edge,
                lightning=True,
                sulphur_profile=sulphur_profile,
            )

        await task.emit(
            "stage",
            {
                "type": "pair-model-start",
                "progress": 55,
                "stageLabel": "Sulphur 생성 시작",
                "modelId": preset.id,
            },
        )
        sulphur_dispatch = await _dispatch_to_comfy(
            _ModelScopedTask(task, preset.id),
            _make_sulphur_prompt,
            mode="video",
            progress_start=55,
            progress_span=37,
            client_prefix="ais-lab-pair-sulphur",
            upload_bytes=image_bytes,
            upload_filename=filename,
            save_output=_save_comfy_video,
            idle_timeout=900.0,
            hard_timeout=3600.0,
        )
        if sulphur_dispatch.comfy_error:
            await task.emit(
                "done",
                {
                    "items": {"wan22": wan_item},
                    "savedToHistory": {"wan22": wan_saved},
                    "sharedPrompt": sulphur_prompt,
                    "modelPrompts": model_prompts,
                    "pairMode": pair_mode,
                    "sulphurProfile": sulphur_profile,
                    "failedModelId": preset.id,
                    "errors": {preset.id: sulphur_dispatch.comfy_error},
                },
            )
            _mark_generation_complete()
            return

        sulphur_item = _pair_item(
            model_id=preset.id,
            prompt=prompt,
            model_prompt=sulphur_prompt,
            image_description=video_res.image_description,
            provider=video_res.upgrade.provider,
            image_ref=sulphur_dispatch.image_ref,
            comfy_error=sulphur_dispatch.comfy_error,
            seed=actual_seed,
            source_width=source_width,
            source_height=source_height,
            longer_edge=longer_edge,
            lightning=True,
            adult=True,
        )
        sulphur_saved = await _persist_history(sulphur_item)
        await task.emit(
            "done",
            {
                "items": {"wan22": wan_item, preset.id: sulphur_item},
                "savedToHistory": {
                    "wan22": wan_saved,
                    preset.id: sulphur_saved,
                },
                "sharedPrompt": sulphur_prompt,
                "modelPrompts": model_prompts,
                "sharedPromptKo": video_res.upgrade.translation,
                "pairMode": pair_mode,
                "sulphurProfile": sulphur_profile,
            },
        )
        _mark_generation_complete()

    except asyncio.CancelledError:
        log.info("Lab compare video pipeline cancelled: %s", task.task_id)
        raise
    except Exception as e:
        log.exception("Lab compare video pipeline error")
        await task.emit("error", {"message": str(e)})
    finally:
        await task.close()
