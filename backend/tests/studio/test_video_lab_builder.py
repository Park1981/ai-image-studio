"""Lab video builder tests."""

from __future__ import annotations

from collections import Counter

import pytest

from studio.comfy_api_builder import (
    build_ltx_lab_from_request,
    build_video_from_request,
    resolve_lab_video_loras,
)
from studio.comfy_api_builder.video_lab import SULPHUR_OFFICIAL_PROFILE_ID
from studio.lab_presets import LAB_LTX_SULPHUR_PRESET


def _lora_nodes(api: dict) -> list[dict]:
    return [
        node
        for node in api.values()
        if node.get("class_type") == "LoraLoaderModelOnly"
    ]


def _official_api() -> dict:
    return build_ltx_lab_from_request(
        preset=LAB_LTX_SULPHUR_PRESET,
        active_lora_ids=["distill_sulphur", "adult_sulphur"],
        strength_overrides=None,
        prompt="cinematic motion",
        source_filename="source.png",
        seed=42,
        source_width=768,
        source_height=1024,
        longer_edge=512,
        sulphur_profile=SULPHUR_OFFICIAL_PROFILE_ID,
    )


def _node(api: dict, ref: list) -> dict:
    return api[str(ref[0])]


def _samplers(api: dict) -> list[dict]:
    return [
        node
        for node in api.values()
        if node.get("class_type") == "SamplerCustomAdvanced"
    ]


def _sampler_with_sigmas_type(api: dict, class_type: str) -> dict:
    return next(
        sampler
        for sampler in _samplers(api)
        if _node(api, sampler["inputs"]["sigmas"]).get("class_type") == class_type
    )


def _lora_chain_from_model_ref(api: dict, model_ref: list) -> list[tuple[str, float]]:
    chain: list[tuple[str, float]] = []
    ref = model_ref
    while True:
        node = _node(api, ref)
        if node.get("class_type") != "LoraLoaderModelOnly":
            break
        chain.append(
            (
                node["inputs"]["lora_name"],
                float(node["inputs"]["strength_model"]),
            )
        )
        ref = node["inputs"]["model"]
    return list(reversed(chain))


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


def test_sulphur_official_profile_base_uses_ltxv_scheduler_not_production_upscale_sigmas() -> None:
    api = _official_api()
    base_sampler = _sampler_with_sigmas_type(api, "LTXVScheduler")
    scheduler = _node(api, base_sampler["inputs"]["sigmas"])

    assert _node(api, base_sampler["inputs"]["sampler"])["inputs"][
        "sampler_name"
    ] == "euler_ancestral_cfg_pp"
    assert scheduler["inputs"]["steps"] == 8
    assert scheduler["inputs"]["max_shift"] == 4
    assert scheduler["inputs"]["base_shift"] == 1.5
    assert scheduler["inputs"]["stretch"] is True
    assert scheduler["inputs"]["terminal"] == 0.1

    wrong_base = (
        "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, "
        "0.725, 0.421875, 0.0"
    )
    manual_sigmas = [
        node["inputs"]["sigmas"]
        for node in api.values()
        if node.get("class_type") == "ManualSigmas"
    ]
    assert wrong_base not in manual_sigmas


def test_sulphur_official_profile_upscale_uses_short_manual_sigmas() -> None:
    api = _official_api()
    up_sampler = _sampler_with_sigmas_type(api, "ManualSigmas")
    sigmas = _node(api, up_sampler["inputs"]["sigmas"])

    assert _node(api, up_sampler["inputs"]["sampler"])["inputs"][
        "sampler_name"
    ] == "euler_ancestral_cfg_pp"
    assert sigmas["inputs"]["sigmas"] == "0.85, 0.7250, 0.4219, 0.0"


def test_sulphur_official_profile_uses_stage_specific_lora_chains() -> None:
    api = _official_api()
    base_sampler = _sampler_with_sigmas_type(api, "LTXVScheduler")
    up_sampler = _sampler_with_sigmas_type(api, "ManualSigmas")
    base_guider = _node(api, base_sampler["inputs"]["guider"])
    up_guider = _node(api, up_sampler["inputs"]["guider"])

    assert base_guider["inputs"]["model"] != up_guider["inputs"]["model"]
    assert _lora_chain_from_model_ref(api, base_guider["inputs"]["model"]) == [
        (
            "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
            0.7,
        ),
        ("sulphur_lora_rank_768.safetensors", 1.0),
    ]
    assert _lora_chain_from_model_ref(api, up_guider["inputs"]["model"]) == [
        ("sulphur_lora_rank_768.safetensors", 1.0),
        (
            "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
            0.5,
        ),
    ]


def test_sulphur_official_profile_uses_local_sulphur_lora_basename() -> None:
    api = _official_api()
    names = [node["inputs"]["lora_name"] for node in _lora_nodes(api)]

    assert "sulphur_lora_rank_768.safetensors" in names
    assert "ltx2310eros_beta.safetensors" not in names
    assert "sulphur_final.safetensors" not in names


def test_sulphur_official_profile_i2v_strength_fps_and_frame_count() -> None:
    api = _official_api()
    i2v_nodes = [
        node
        for _, node in sorted(api.items(), key=lambda item: int(item[0]))
        if node.get("class_type") == "LTXVImgToVideoInplace"
    ]
    assert [node["inputs"]["strength"] for node in i2v_nodes] == [0.8, 1.0]

    conditioning = next(
        node for node in api.values() if node.get("class_type") == "LTXVConditioning"
    )
    empty_video = next(
        node for node in api.values() if node.get("class_type") == "EmptyLTXVLatentVideo"
    )
    empty_audio = next(
        node for node in api.values() if node.get("class_type") == "LTXVEmptyLatentAudio"
    )
    create_video = next(
        node for node in api.values() if node.get("class_type") == "CreateVideo"
    )
    assert conditioning["inputs"]["frame_rate"] == 24.0
    assert empty_video["inputs"]["length"] == 121
    assert empty_audio["inputs"]["frames_number"] == 121
    assert empty_audio["inputs"]["frame_rate"] == 24
    assert create_video["inputs"]["fps"] == 24.0


def test_sulphur_official_profile_scales_base_anchor_image_like_official_workflow() -> None:
    api = _official_api()
    scale_node_id, scale_node = next(
        (node_id, node)
        for node_id, node in api.items()
        if node.get("class_type") == "ImageScaleDownBy"
    )
    i2v_nodes = [
        node
        for _, node in sorted(api.items(), key=lambda item: int(item[0]))
        if node.get("class_type") == "LTXVImgToVideoInplace"
    ]
    upscaler = next(
        node
        for node in api.values()
        if node.get("class_type") == "LatentUpscaleModelLoader"
    )

    assert scale_node["inputs"]["scale_by"] == 0.5
    assert i2v_nodes[0]["inputs"]["image"] == [scale_node_id, 0]
    assert _node(api, i2v_nodes[1]["inputs"]["image"]).get(
        "class_type"
    ) == "LTXVPreprocess"
    assert upscaler["inputs"]["model_name"] == (
        "ltx-2.3-spatial-upscaler-x2-1.0.safetensors"
    )


def test_production_ltx_builder_keeps_existing_sampling() -> None:
    api = build_video_from_request(
        model_id="ltx",
        prompt="cinematic motion",
        source_filename="source.png",
        seed=42,
        source_width=768,
        source_height=1024,
        longer_edge=512,
    )
    sigmas = [
        node["inputs"]["sigmas"]
        for node in api.values()
        if node.get("class_type") == "ManualSigmas"
    ]

    assert "0.85, 0.7250, 0.4219, 0.0" in sigmas
    assert (
        "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, "
        "0.725, 0.421875, 0.0"
    ) in sigmas
    assert not any(
        node.get("class_type") == "LTXVScheduler" for node in api.values()
    )
