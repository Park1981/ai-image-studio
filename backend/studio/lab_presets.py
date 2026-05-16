"""lab_presets.py - Lab validation model presets.

Production presets.py is intentionally left untouched. New video models are
first represented here, validated in /lab/video, then promoted to production
with a separate plan if they are worth keeping.

Spec: docs/superpowers/specs/2026-05-15-video-lab-framework-sulphur-design.md v4
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .presets import LTX_VIDEO_PRESET, VideoFiles, VideoSampling


@dataclass(frozen=True)
class LabLoraOption:
    """LoRA option exposed by the Lab video page.

    For lightning options, ``applies_to=("base", "upscale")`` means the builder
    expands the same LoRA into two sequential LoraLoaderModelOnly calls, mirroring
    the current production LTX distilled LoRA pattern.
    """

    id: str
    display_name: str
    file_name: str
    default_strength: float
    strength_min: float = 0.0
    strength_max: float = 1.5
    strength_step: float = 0.05
    role: Literal["lightning", "adult"] = "adult"
    applies_to: tuple[str, ...] = ("single",)
    note: str = ""


@dataclass(frozen=True)
class LabVideoModelPreset:
    """Lab-only video model preset."""

    id: str
    display_name: str
    tag: str
    base_files: VideoFiles
    lora_options: list[LabLoraOption]
    sampling: VideoSampling
    negative_prompt: str
    notes_md: str


LAB_LTX_SULPHUR_PRESET = LabVideoModelPreset(
    id="ltx-sulphur",
    display_name="LTX 2.3 · Sulphur Lab",
    tag="LoRA 검증",
    base_files=LTX_VIDEO_PRESET.files,
    lora_options=[
        LabLoraOption(
            id="distill_default",
            display_name="Distill: Default (384)",
            file_name="ltx-2.3-22b-distilled-lora-384.safetensors",
            default_strength=0.5,
            role="lightning",
            applies_to=("base", "upscale"),
            note="기존 LTX distill (production baseline 과 동일)",
        ),
        LabLoraOption(
            id="distill_sulphur",
            display_name="Distill: Sulphur (1.1_fro90)",
            file_name=(
                "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe."
                "safetensors"
            ),
            default_strength=0.5,
            role="lightning",
            applies_to=("base", "upscale"),
            note="Sulphur 권장 distill (Sulphur LoRA 와 세트 · 631 MB)",
        ),
        LabLoraOption(
            id="adult_sulphur",
            display_name="Adult: Sulphur",
            file_name="sulphur_lora_rank_768.safetensors",
            default_strength=0.7,
            role="adult",
            applies_to=("single",),
            note="Sulphur 2 NSFW finetune (10.3 GB)",
        ),
    ],
    sampling=LTX_VIDEO_PRESET.sampling,
    negative_prompt=LTX_VIDEO_PRESET.negative_prompt,
    notes_md=(
        "Sulphur-2-base 검증용. HuggingFace SulphurAI/Sulphur-2-base "
        "(gated=false · EULA 동의 불필요) 에서 "
        "`sulphur_lora_rank_768.safetensors` (10.3 GB) + "
        "`ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors` "
        "(631 MB) 를 받아 ComfyUI LoRA 디렉토리에 basename 으로 배치."
    ),
)


LAB_VIDEO_PRESETS: list[LabVideoModelPreset] = [LAB_LTX_SULPHUR_PRESET]


def get_lab_video_preset(preset_id: str) -> LabVideoModelPreset:
    """Return a lab video preset by id."""

    for preset in LAB_VIDEO_PRESETS:
        if preset.id == preset_id:
            return preset
    raise ValueError(f"unknown lab video preset: {preset_id!r}")
