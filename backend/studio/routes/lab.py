"""Lab endpoints.

The Lab video route is intentionally separate from production /video, while it
reuses tasks, SSE streaming, dispatch, and history storage.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from .. import dispatch_state
from ..comfy_api_builder import SULPHUR_OFFICIAL_PROFILE_ID, resolve_lab_video_loras
from ..comfy_transport import ComfyUITransport
from ..lab_presets import LAB_VIDEO_PRESETS, get_lab_video_preset
from ..pipelines import (
    _extract_image_dims,
    _run_video_lab_pair_pipeline_task,
    _run_video_lab_pipeline_task,
)
from ..presets import VIDEO_LONGER_EDGE_MAX, VIDEO_LONGER_EDGE_MIN
from ..schemas import TaskCreated
from ..storage import STUDIO_MAX_IMAGE_BYTES
from ..tasks import TASKS, _new_task
from ._common import _proc_mgr, _spawn, _stream_task, parse_meta_object

router = APIRouter(prefix="/lab", tags=["lab"])


def _extract_lora_enum(object_info: dict[str, Any]) -> list[str]:
    node = object_info.get("LoraLoaderModelOnly")
    if not isinstance(node, dict):
        return []
    required = node.get("input", {}).get("required", {})
    lora_name = required.get("lora_name")
    if not isinstance(lora_name, list) or not lora_name:
        return []
    values = lora_name[0]
    return [str(item) for item in values] if isinstance(values, list) else []


def _enum_contains(enum_values: list[str], file_name: str) -> tuple[bool, str | None]:
    if file_name in enum_values:
        return True, file_name
    for entry in enum_values:
        if entry.endswith("/" + file_name) or entry.endswith("\\" + file_name):
            return True, entry
    return False, None


async def _fetch_lora_enum_once() -> list[str]:
    async with ComfyUITransport() as comfy:
        return _extract_lora_enum(await comfy.get_object_info())


async def _fetch_lora_enum() -> list[str]:
    try:
        return await _fetch_lora_enum_once()
    except Exception as first_exc:
        if _proc_mgr is not None:
            try:
                started = await _proc_mgr.start_comfyui()
                if started:
                    return await _fetch_lora_enum_once()
            except Exception as retry_exc:
                raise HTTPException(
                    503, f"ComfyUI object_info unavailable: {retry_exc}"
                ) from retry_exc
        raise HTTPException(
            503, f"ComfyUI object_info unavailable: {first_exc}"
        ) from first_exc


async def _assert_loras_available(file_names: list[str]) -> None:
    if not file_names:
        return
    enum_values = await _fetch_lora_enum()
    missing = [
        name for name in file_names if not _enum_contains(enum_values, name)[0]
    ]
    if missing:
        raise HTTPException(400, f"missing Lab LoRA file(s): {', '.join(missing)}")


def _default_active_lora_ids(preset_id: str) -> list[str]:
    preset = get_lab_video_preset(preset_id)
    ids = {option.id for option in preset.lora_options}
    preferred = [
        option_id
        for option_id in ("distill_sulphur", "adult_sulphur")
        if option_id in ids
    ]
    if preferred:
        return preferred
    return [option.id for option in preset.lora_options if option.role == "lightning"]


def _parse_active_lora_ids(meta_obj: dict[str, Any], preset_id: str) -> list[str]:
    raw = meta_obj.get("activeLoraIds")
    if raw is None:
        raw = meta_obj.get("active_lora_ids")
    if raw is None:
        return _default_active_lora_ids(preset_id)
    if not isinstance(raw, list):
        raise HTTPException(400, "activeLoraIds must be a list")
    result: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            raise HTTPException(400, "activeLoraIds must contain strings")
        clean = item.strip()
        if clean:
            result.append(clean)
    return result


def _parse_lora_strengths(meta_obj: dict[str, Any]) -> dict[str, float]:
    raw = (
        meta_obj.get("loraStrengths")
        or meta_obj.get("lora_strengths")
        or meta_obj.get("strengthOverrides")
        or meta_obj.get("strength_overrides")
    )
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise HTTPException(400, "loraStrengths must be an object")
    strengths: dict[str, float] = {}
    for key, value in raw.items():
        try:
            strengths[str(key)] = float(value)
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                400, f"loraStrengths.{key} must be numeric"
            ) from exc
    return strengths


def _parse_longer_edge(meta_obj: dict[str, Any]) -> int | None:
    raw = meta_obj.get("longerEdge") or meta_obj.get("longer_edge")
    if raw is None:
        return None
    try:
        longer_edge = int(raw)
    except (TypeError, ValueError):
        return None
    return max(
        VIDEO_LONGER_EDGE_MIN,
        min(VIDEO_LONGER_EDGE_MAX, (longer_edge // 8) * 8),
    )


def _parse_prompt_mode(meta_obj: dict[str, Any]) -> str:
    raw = meta_obj.get("promptMode") or meta_obj.get("prompt_mode")
    return "precise" if isinstance(raw, str) and raw == "precise" else "fast"


def _parse_sulphur_profile(meta_obj: dict[str, Any]) -> str | None:
    raw = meta_obj.get("sulphurProfile") or meta_obj.get("sulphur_profile")
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise HTTPException(400, "sulphurProfile must be a string")
    profile = raw.strip()
    if not profile:
        return None
    if profile != SULPHUR_OFFICIAL_PROFILE_ID:
        raise HTTPException(400, f"unknown sulphur profile: {profile!r}")
    return profile


def _official_sulphur_lora_files(preset_id: str) -> list[str]:
    preset = get_lab_video_preset(preset_id)
    options = {option.id: option.file_name for option in preset.lora_options}
    try:
        return [options["distill_sulphur"], options["adult_sulphur"]]
    except KeyError as exc:
        raise HTTPException(
            400, "official Sulphur profile requires distill_sulphur and adult_sulphur"
        ) from exc


@router.get("/video/files")
async def check_lab_video_files() -> dict[str, Any]:
    """Return Lab LoRA visibility according to ComfyUI /object_info."""
    enum_values = await _fetch_lora_enum()
    presets: list[dict[str, Any]] = []
    missing: list[str] = []
    seen_missing: set[str] = set()

    for preset in LAB_VIDEO_PRESETS:
        files: list[dict[str, Any]] = []
        for option in preset.lora_options:
            present, found_as = _enum_contains(enum_values, option.file_name)
            if not present and option.file_name not in seen_missing:
                missing.append(option.file_name)
                seen_missing.add(option.file_name)
            files.append(
                {
                    "id": option.id,
                    "fileName": option.file_name,
                    "present": present,
                    "foundAs": found_as,
                }
            )
        presets.append({"id": preset.id, "files": files})

    return {
        "allPresent": not missing,
        "missing": missing,
        "availableCount": len(enum_values),
        "presets": presets,
    }


@router.post("/video", response_model=TaskCreated)
async def create_lab_video_task(
    image: UploadFile = File(...),
    meta: str = Form(...),
):
    """Create a Lab video task."""
    meta_obj = parse_meta_object(meta)
    preset_id_raw = meta_obj.get("presetId") or meta_obj.get("preset_id")
    preset_id = preset_id_raw if isinstance(preset_id_raw, str) else "ltx-sulphur"
    try:
        preset = get_lab_video_preset(preset_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    prompt_raw = meta_obj.get("prompt", "")
    prompt = prompt_raw.strip() if isinstance(prompt_raw, str) else ""
    auto_nsfw = bool(meta_obj.get("autoNsfw") or meta_obj.get("auto_nsfw") or False)
    if not prompt and not auto_nsfw:
        raise HTTPException(400, "prompt required")

    nsfw_intensity_raw = meta_obj.get("nsfwIntensity")
    if nsfw_intensity_raw is None:
        nsfw_intensity_raw = meta_obj.get("nsfw_intensity", 2)
    try:
        nsfw_intensity = int(nsfw_intensity_raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "nsfwIntensity must be an integer") from exc
    if auto_nsfw and nsfw_intensity not in (1, 2, 3):
        raise HTTPException(400, "nsfwIntensity must be 1|2|3")

    lightning = bool(meta_obj.get("lightning", True))
    sulphur_profile = _parse_sulphur_profile(meta_obj)
    active_lora_ids = _parse_active_lora_ids(meta_obj, preset.id)
    lora_strengths = _parse_lora_strengths(meta_obj)
    try:
        selected_loras = resolve_lab_video_loras(
            preset,
            active_lora_ids=active_lora_ids,
            strength_overrides=lora_strengths,
            lightning=lightning,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    adult_prompt = bool(meta_obj.get("adult", False)) or any(
        lora.role == "adult" for lora in selected_loras
    )
    if auto_nsfw and not adult_prompt:
        raise HTTPException(400, "autoNsfw requires adult Lab LoRA or adult=true")

    required_loras = (
        _official_sulphur_lora_files(preset.id)
        if sulphur_profile == SULPHUR_OFFICIAL_PROFILE_ID
        else sorted({lora.name for lora in selected_loras})
    )
    await _assert_loras_available(required_loras)

    pre_upgraded_raw = (
        meta_obj.get("preUpgradedPrompt") or meta_obj.get("pre_upgraded_prompt")
    )
    pre_upgraded_prompt: str | None = (
        pre_upgraded_raw.strip()
        if isinstance(pre_upgraded_raw, str) and pre_upgraded_raw.strip()
        else None
    )
    if auto_nsfw:
        pre_upgraded_prompt = None
    prompt_mode = _parse_prompt_mode(meta_obj)

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(400, "empty image")
    if len(image_bytes) > STUDIO_MAX_IMAGE_BYTES:
        raise HTTPException(
            413,
            f"image too large: {len(image_bytes)} bytes "
            f"(max {STUDIO_MAX_IMAGE_BYTES})",
        )

    source_w, source_h = _extract_image_dims(image_bytes)
    task = await _new_task()
    dispatch_state.record("video", preset.display_name)
    task.worker = _spawn(
        _run_video_lab_pipeline_task(
            task,
            image_bytes,
            prompt,
            image.filename or "input.png",
            preset.id,
            active_lora_ids,
            lora_strengths,
            meta_obj.get("ollamaModel") or meta_obj.get("ollama_model"),
            meta_obj.get("visionModel") or meta_obj.get("vision_model"),
            adult_prompt,
            auto_nsfw,
            nsfw_intensity,
            source_w,
            source_h,
            _parse_longer_edge(meta_obj),
            lightning,
            pre_upgraded_prompt=pre_upgraded_prompt,
            prompt_mode=prompt_mode,
            sulphur_profile=sulphur_profile,
        )
    )
    return TaskCreated(
        task_id=task.task_id,
        stream_url=f"/api/studio/lab/video/stream/{task.task_id}",
    )


@router.post("/video/pair", response_model=TaskCreated, include_in_schema=False)
@router.post("/video/compare", response_model=TaskCreated)
async def create_lab_video_compare_task(
    image: UploadFile = File(...),
    meta: str = Form(...),
):
    """Create a Wan/Sulphur Lab video comparison task."""
    meta_obj = parse_meta_object(meta)
    preset_id_raw = meta_obj.get("presetId") or meta_obj.get("preset_id")
    preset_id = preset_id_raw if isinstance(preset_id_raw, str) else "ltx-sulphur"
    try:
        preset = get_lab_video_preset(preset_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if preset.id != "ltx-sulphur":
        raise HTTPException(
            400, "Lab video compare currently supports ltx-sulphur only"
        )

    prompt_raw = meta_obj.get("prompt", "")
    prompt = prompt_raw.strip() if isinstance(prompt_raw, str) else ""
    auto_nsfw = bool(meta_obj.get("autoNsfw") or meta_obj.get("auto_nsfw") or False)
    if not prompt and not auto_nsfw:
        raise HTTPException(400, "prompt required")

    nsfw_intensity_raw = meta_obj.get("nsfwIntensity")
    if nsfw_intensity_raw is None:
        nsfw_intensity_raw = meta_obj.get("nsfw_intensity", 2)
    try:
        nsfw_intensity = int(nsfw_intensity_raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "nsfwIntensity must be an integer") from exc
    if auto_nsfw and nsfw_intensity not in (1, 2, 3):
        raise HTTPException(400, "nsfwIntensity must be 1|2|3")

    pair_mode_raw = meta_obj.get("pairMode") or meta_obj.get("pair_mode")
    pair_mode = (
        pair_mode_raw.strip()
        if isinstance(pair_mode_raw, str) and pair_mode_raw.strip()
        else "shared_5beat"
    )
    if pair_mode != "shared_5beat":
        raise HTTPException(400, f"unknown lab compare mode: {pair_mode!r}")

    sulphur_profile = _parse_sulphur_profile(meta_obj) or SULPHUR_OFFICIAL_PROFILE_ID
    await _assert_loras_available(_official_sulphur_lora_files(preset.id))

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(400, "empty image")
    if len(image_bytes) > STUDIO_MAX_IMAGE_BYTES:
        raise HTTPException(
            413,
            f"image too large: {len(image_bytes)} bytes "
            f"(max {STUDIO_MAX_IMAGE_BYTES})",
        )

    source_w, source_h = _extract_image_dims(image_bytes)
    task = await _new_task()
    dispatch_state.record("video", "Wan 2.2 i2v + LTX 2.3 · Sulphur Lab")
    task.worker = _spawn(
        _run_video_lab_pair_pipeline_task(
            task,
            image_bytes,
            prompt,
            image.filename or "input.png",
            preset.id,
            meta_obj.get("ollamaModel") or meta_obj.get("ollama_model"),
            meta_obj.get("visionModel") or meta_obj.get("vision_model"),
            True,
            auto_nsfw,
            nsfw_intensity,
            source_w,
            source_h,
            _parse_longer_edge(meta_obj),
            bool(meta_obj.get("lightning", True)),
            prompt_mode=_parse_prompt_mode(meta_obj),
            pair_mode=pair_mode,
            sulphur_profile=sulphur_profile,
        )
    )
    return TaskCreated(
        task_id=task.task_id,
        stream_url=f"/api/studio/lab/video/compare/stream/{task.task_id}",
    )


@router.get("/video/stream/{task_id}")
async def lab_video_stream(task_id: str, request: Request):
    task = TASKS.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return StreamingResponse(
        _stream_task(task, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/video/pair/stream/{task_id}", include_in_schema=False)
@router.get("/video/compare/stream/{task_id}")
async def lab_video_compare_stream(task_id: str, request: Request):
    task = TASKS.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return StreamingResponse(
        _stream_task(task, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
