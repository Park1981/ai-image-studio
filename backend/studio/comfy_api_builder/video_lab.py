"""Lab video workflow builders.

Lab models reuse the production LTX graph, but their LoRA chain is built from
lab_presets.py instead of presets.py. This keeps production presets untouched.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from ..lab_presets import LabLoraOption, LabVideoModelPreset
from ..presets import VideoLoraEntry, VideoModelPreset
from ._common import ApiPrompt
from .video import build_ltx_from_model_preset


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
) -> ApiPrompt:
    """Build a Lab LTX workflow from explicit LoRA selections."""
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
