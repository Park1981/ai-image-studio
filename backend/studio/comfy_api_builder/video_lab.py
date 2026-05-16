"""Lab video workflow builders.

Lab models reuse the production LTX graph, but their LoRA chain is built from
lab_presets.py instead of presets.py. This keeps production presets untouched.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import replace

from ..lab_presets import LabLoraOption, LabVideoModelPreset
from ..presets import VideoLoraEntry, VideoModelPreset
from ._common import ApiPrompt
from .video import build_ltx_from_model_preset

SULPHUR_OFFICIAL_PROFILE_ID = "official_i2v_v1"
SULPHUR_UPSCALE_SIGMAS = "0.85, 0.7250, 0.4219, 0.0"
SULPHUR_BASE_SCHEDULER = {
    "steps": 8,
    "max_shift": 4,
    "base_shift": 1.5,
    "stretch": True,
    "terminal": 0.1,
}
SULPHUR_OFFICIAL_UPSCALER = "ltx-2.3-spatial-upscaler-x2-1.0.safetensors"


def _option_map(preset: LabVideoModelPreset) -> dict[str, LabLoraOption]:
    return {option.id: option for option in preset.lora_options}


def resolve_lab_video_loras(
    preset: LabVideoModelPreset,
    *,
    active_lora_ids: Sequence[str],
    strength_overrides: Mapping[str, float] | None = None,
    lightning: bool = True,
) -> list[VideoLoraEntry]:
    """Resolve a Lab LoRA selection into production-compatible entries.

    Lightning options with applies_to=("base", "upscale") are intentionally
    expanded to two sequential LoraLoaderModelOnly nodes, matching production
    LTX's distilled LoRA pattern.
    """
    options = _option_map(preset)
    active = list(dict.fromkeys(str(item) for item in active_lora_ids))
    unknown = sorted(set(active) - set(options))
    if unknown:
        raise ValueError(f"unknown lab lora id: {unknown[0]!r}")

    overrides = {str(k): v for k, v in (strength_overrides or {}).items()}
    unknown_strengths = sorted(set(overrides) - set(options))
    if unknown_strengths:
        raise ValueError(
            f"unknown lab lora strength override: {unknown_strengths[0]!r}"
        )

    entries: list[VideoLoraEntry] = []
    active_set = set(active)
    for option in preset.lora_options:
        if option.id not in active_set:
            continue
        if option.role == "lightning" and not lightning:
            continue

        strength = _resolve_strength(option, overrides)
        for slot in option.applies_to:
            entries.append(
                VideoLoraEntry(
                    name=option.file_name,
                    strength=strength,
                    role=option.role,
                    note=f"lab {option.id} · {slot}",
                )
            )
    return entries


def _resolve_strength(
    option: LabLoraOption,
    overrides: Mapping[str, float],
) -> float:
    raw_value = overrides.get(option.id, option.default_strength)
    try:
        value = float(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{option.id} strength must be numeric") from exc
    if value < option.strength_min or value > option.strength_max:
        raise ValueError(
            f"{option.id} strength must be between "
            f"{option.strength_min:g} and {option.strength_max:g}"
        )
    return value


def _required_option(preset: LabVideoModelPreset, option_id: str) -> LabLoraOption:
    options = _option_map(preset)
    try:
        return options[option_id]
    except KeyError as exc:
        raise ValueError(f"missing lab lora option: {option_id!r}") from exc


def _sulphur_official_loras(
    preset: LabVideoModelPreset,
) -> tuple[list[VideoLoraEntry], list[VideoLoraEntry]]:
    """Return the Lab-only Sulphur official-ish stage LoRA chains."""
    distill = _required_option(preset, "distill_sulphur")
    sulphur = _required_option(preset, "adult_sulphur")
    base = [
        VideoLoraEntry(
            name=distill.file_name,
            strength=0.7,
            role="lightning",
            note="sulphur official base · distill",
        ),
        VideoLoraEntry(
            name=sulphur.file_name,
            strength=1.0,
            role="adult",
            note="sulphur official base · adult",
        ),
    ]
    upscale = [
        VideoLoraEntry(
            name=sulphur.file_name,
            strength=1.0,
            role="adult",
            note="sulphur official upscale · adult",
        ),
        VideoLoraEntry(
            name=distill.file_name,
            strength=0.5,
            role="lightning",
            note="sulphur official upscale · distill",
        ),
    ]
    return base, upscale


def build_ltx_lab_from_request(
    *,
    preset: LabVideoModelPreset,
    active_lora_ids: Sequence[str],
    strength_overrides: Mapping[str, float] | None,
    prompt: str,
    source_filename: str,
    seed: int,
    negative_prompt: str | None = None,
    unet_override: str | None = None,
    source_width: int | None = None,
    source_height: int | None = None,
    longer_edge: int | None = None,
    lightning: bool = True,
    sulphur_profile: str | None = None,
) -> ApiPrompt:
    """Build a Lab LTX workflow from explicit LoRA selections."""
    if sulphur_profile and sulphur_profile != SULPHUR_OFFICIAL_PROFILE_ID:
        raise ValueError(f"unknown sulphur profile: {sulphur_profile!r}")

    if sulphur_profile == SULPHUR_OFFICIAL_PROFILE_ID:
        return _build_sulphur_official_from_request(
            preset=preset,
            prompt=prompt,
            source_filename=source_filename,
            seed=seed,
            negative_prompt=negative_prompt,
            unet_override=unet_override,
            source_width=source_width,
            source_height=source_height,
            longer_edge=longer_edge,
        )

    loras = resolve_lab_video_loras(
        preset,
        active_lora_ids=active_lora_ids,
        strength_overrides=strength_overrides,
        lightning=lightning,
    )
    lab_model = VideoModelPreset(
        display_name=preset.display_name,
        tag=preset.tag,
        files=preset.base_files,
        loras=loras,
        sampling=preset.sampling,
        negative_prompt=preset.negative_prompt,
    )
    adult = any(lora.role == "adult" for lora in loras)
    return build_ltx_from_model_preset(
        model_preset=lab_model,
        prompt=prompt,
        source_filename=source_filename,
        seed=seed,
        negative_prompt=negative_prompt,
        unet_override=unet_override,
        adult=adult,
        source_width=source_width,
        source_height=source_height,
        longer_edge=longer_edge,
        lightning=lightning,
    )


def _build_sulphur_official_from_request(
    *,
    preset: LabVideoModelPreset,
    prompt: str,
    source_filename: str,
    seed: int,
    negative_prompt: str | None,
    unet_override: str | None,
    source_width: int | None,
    source_height: int | None,
    longer_edge: int | None,
) -> ApiPrompt:
    """Build the Lab-only Sulphur official-ish i2v profile."""
    base_loras, upscale_loras = _sulphur_official_loras(preset)
    sampling = replace(
        preset.sampling,
        fps=24,
        frame_count=121,
        audio_frames=121,
        audio_frame_rate=24,
        base_sampler="euler_ancestral_cfg_pp",
        upscale_sampler="euler_ancestral_cfg_pp",
        upscale_sigmas=SULPHUR_UPSCALE_SIGMAS,
        imgtovideo_first_strength=0.8,
        imgtovideo_second_strength=1.0,
    )
    lab_model = VideoModelPreset(
        display_name=preset.display_name,
        tag=preset.tag,
        files=replace(preset.base_files, upscaler=SULPHUR_OFFICIAL_UPSCALER),
        loras=[*base_loras, *upscale_loras],
        sampling=sampling,
        negative_prompt=preset.negative_prompt,
    )
    return build_ltx_from_model_preset(
        model_preset=lab_model,
        prompt=prompt,
        source_filename=source_filename,
        seed=seed,
        negative_prompt=negative_prompt,
        unet_override=unet_override,
        adult=True,
        source_width=source_width,
        source_height=source_height,
        longer_edge=longer_edge,
        lightning=True,
        base_loras_override=base_loras,
        upscale_loras_override=upscale_loras,
        base_scheduler_override=dict(SULPHUR_BASE_SCHEDULER),
        base_i2v_image_scale=0.5,
    )
