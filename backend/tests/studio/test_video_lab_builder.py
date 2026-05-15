"""Lab video builder tests."""

from __future__ import annotations

from collections import Counter

import pytest

from studio.comfy_api_builder import (
    build_ltx_lab_from_request,
    resolve_lab_video_loras,
)
from studio.lab_presets import LAB_LTX_SULPHUR_PRESET


def _lora_nodes(api: dict) -> list[dict]:
    return [
        node
        for node in api.values()
        if node.get("class_type") == "LoraLoaderModelOnly"
    ]


def test_resolve_lab_video_loras_expands_sulphur_distill() -> None:
    loras = resolve_lab_video_loras(
        LAB_LTX_SULPHUR_PRESET,
        active_lora_ids=["distill_sulphur", "adult_sulphur"],
        strength_overrides={"adult_sulphur": 0.8},
    )

    names = [lora.name for lora in loras]
    assert names == [
        "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
        "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
        "sulphur_lora_rank_768.safetensors",
    ]
    assert [lora.role for lora in loras] == ["lightning", "lightning", "adult"]
    assert loras[-1].strength == 0.8


def test_build_ltx_lab_from_request_does_not_mutate_production_video_model() -> None:
    import studio.comfy_api_builder.video as video_builder

    old_video_model = video_builder.VIDEO_MODEL
    api = build_ltx_lab_from_request(
        preset=LAB_LTX_SULPHUR_PRESET,
        active_lora_ids=["distill_sulphur", "adult_sulphur"],
        strength_overrides=None,
        prompt="cinematic motion",
        source_filename="source.png",
        seed=42,
        source_width=768,
        source_height=1024,
        longer_edge=512,
    )

    assert video_builder.VIDEO_MODEL is old_video_model
    lora_names = [node["inputs"]["lora_name"] for node in _lora_nodes(api)]
    assert Counter(lora_names) == Counter(
        {
            "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors": 2,
            "sulphur_lora_rank_768.safetensors": 1,
        }
    )


def test_build_ltx_lab_lightning_false_skips_distill_loras() -> None:
    api = build_ltx_lab_from_request(
        preset=LAB_LTX_SULPHUR_PRESET,
        active_lora_ids=["distill_sulphur", "adult_sulphur"],
        strength_overrides=None,
        prompt="cinematic motion",
        source_filename="source.png",
        seed=42,
        lightning=False,
    )

    lora_names = [node["inputs"]["lora_name"] for node in _lora_nodes(api)]
    assert lora_names == ["sulphur_lora_rank_768.safetensors"]


def test_resolve_lab_video_loras_rejects_unknown_lora_id() -> None:
    with pytest.raises(ValueError, match="unknown lab lora id"):
        resolve_lab_video_loras(
            LAB_LTX_SULPHUR_PRESET,
            active_lora_ids=["not-a-real-option"],
            strength_overrides=None,
        )


def test_resolve_lab_video_loras_rejects_out_of_range_strength() -> None:
    with pytest.raises(ValueError, match="adult_sulphur strength"):
        resolve_lab_video_loras(
            LAB_LTX_SULPHUR_PRESET,
            active_lora_ids=["adult_sulphur"],
            strength_overrides={"adult_sulphur": 2.0},
        )
