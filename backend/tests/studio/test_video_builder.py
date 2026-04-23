"""
LTX-2.3 Video i2v 워크플로우 빌더 검증 (2026-04-24).

목적:
  - VIDEO_MODEL preset 값 정합성
  - build_video_from_request 가 모든 필수 노드를 생성하는지
  - LoRA 체인 정상 구성
  - env override 가 unet_name 에 반영되는지
"""

from __future__ import annotations

from collections import Counter

import pytest

from studio.comfy_api_builder import build_video_from_request
from studio.presets import (
    VIDEO_LONGER_EDGE_DEFAULT,
    VIDEO_LONGER_EDGE_MAX,
    VIDEO_LONGER_EDGE_MIN,
    VIDEO_MODEL,
    VideoLoraEntry,
    compute_video_resize,
    resolve_video_unet_name,
)


# ───────── preset 값 검증 ─────────


def test_video_model_preset_values() -> None:
    """VIDEO_MODEL 상수값이 공식 워크플로우 기반인지."""
    s = VIDEO_MODEL.sampling
    assert s.seconds == 5
    assert s.fps == 25
    assert s.frame_count == 126  # 5 * 25 + 1
    assert s.pre_resize_width == 500
    assert s.pre_resize_height == 800
    assert s.longer_edge == 1536
    assert s.latent_width == s.pre_resize_width // 2
    assert s.latent_height == s.pre_resize_height // 2
    assert s.base_sampler == "euler_cfg_pp"
    assert s.upscale_sampler == "euler_ancestral_cfg_pp"


def test_video_files_consistent() -> None:
    """unet 과 audio_vae 는 같은 ckpt (LTX-2.3 통합)."""
    assert VIDEO_MODEL.files.unet.endswith(".safetensors")
    assert "ltx-2.3" in VIDEO_MODEL.files.unet.lower()
    assert "gemma" in VIDEO_MODEL.files.text_encoder.lower()
    assert "upscaler" in VIDEO_MODEL.files.upscaler.lower()


def test_video_loras_three_entries() -> None:
    """distilled 2회 + extra 1회 = 3개."""
    assert len(VIDEO_MODEL.loras) == 3
    assert all(isinstance(l, VideoLoraEntry) for l in VIDEO_MODEL.loras)
    assert all(l.strength == 0.5 for l in VIDEO_MODEL.loras)


def test_resolve_unet_override() -> None:
    """env override 가 우선 · 없으면 preset 기본값."""
    assert resolve_video_unet_name() == VIDEO_MODEL.files.unet
    assert resolve_video_unet_name("kijai.safetensors") == "kijai.safetensors"
    # 빈 문자열은 falsy → 기본값
    assert resolve_video_unet_name("") == VIDEO_MODEL.files.unet


# ───────── build_video_from_request 구조 검증 ─────────


REQUIRED_CLASSES = {
    "LoadImage",
    "ResizeImageMaskNode",
    "ResizeImagesByLongerEdge",
    "LTXVPreprocess",
    "CheckpointLoaderSimple",
    "LTXAVTextEncoderLoader",
    "LTXVAudioVAELoader",
    "LatentUpscaleModelLoader",
    "LoraLoaderModelOnly",
    "CLIPTextEncode",
    "LTXVConditioning",
    "EmptyLTXVLatentVideo",
    "LTXVEmptyLatentAudio",
    "LTXVImgToVideoInplace",
    "LTXVConcatAVLatent",
    "RandomNoise",
    "KSamplerSelect",
    "ManualSigmas",
    "CFGGuider",
    "SamplerCustomAdvanced",
    "LTXVSeparateAVLatent",
    "LTXVLatentUpsampler",
    "LTXVCropGuides",
    "VAEDecodeTiled",
    "LTXVAudioVAEDecode",
    "CreateVideo",
    "SaveVideo",
}


def _classes(api: dict) -> list[str]:
    return [n["class_type"] for n in api.values()]


def test_build_video_has_all_required_classes() -> None:
    api = build_video_from_request(
        prompt="a cat walking", source_filename="input.png", seed=42
    )
    present = set(_classes(api))
    missing = REQUIRED_CLASSES - present
    assert not missing, f"누락된 class: {missing}"


def test_build_video_total_node_count_sfw() -> None:
    """성인 모드 OFF (기본) — distilled LoRA 2개만 → 37 nodes.
    (Primitive/MathExpression/Reroute 조력 노드는 Python 에서 미리 계산해 제거)
    """
    api = build_video_from_request(
        prompt="x", source_filename="x.png", seed=1
    )
    assert len(api) == 37, f"노드 수 불일치: {len(api)} (expected 37, adult=False)"


def test_build_video_total_node_count_adult() -> None:
    """성인 모드 ON — distilled 2개 + eros 1개 → 38 nodes."""
    api = build_video_from_request(
        prompt="x", source_filename="x.png", seed=1, adult=True
    )
    assert len(api) == 38, f"노드 수 불일치: {len(api)} (expected 38, adult=True)"


def test_build_video_lora_chain_count_sfw() -> None:
    """성인 모드 OFF — distilled 2개만 체인에 포함."""
    api = build_video_from_request(
        prompt="x", source_filename="x.png", seed=1
    )
    counts = Counter(_classes(api))
    assert counts["LoraLoaderModelOnly"] == 2
    lora_nodes = [n for n in api.values() if n["class_type"] == "LoraLoaderModelOnly"]
    # eros LoRA 는 체인에 없어야 함
    assert not any(
        "eros" in n["inputs"]["lora_name"].lower() for n in lora_nodes
    ), "성인 모드 OFF 인데 eros LoRA 가 체인에 포함됨"


def test_build_video_lora_chain_count_adult() -> None:
    """성인 모드 ON — distilled 2개 + eros 1개 체인에 포함."""
    api = build_video_from_request(
        prompt="x", source_filename="x.png", seed=1, adult=True
    )
    counts = Counter(_classes(api))
    assert counts["LoraLoaderModelOnly"] == 3
    lora_nodes = [n for n in api.values() if n["class_type"] == "LoraLoaderModelOnly"]
    assert any(
        "eros" in n["inputs"]["lora_name"].lower() for n in lora_nodes
    ), "성인 모드 ON 인데 eros LoRA 가 체인에 없음"


def test_build_video_sampling_counts() -> None:
    """2-stage sampling 의 노드 수는 adult 토글과 무관."""
    api = build_video_from_request(
        prompt="x", source_filename="x.png", seed=1
    )
    counts = Counter(_classes(api))
    # 2-stage sampling: 각 stage 마다 Noise/Sampler/Sigmas/Guider/Sample/Separate
    assert counts["RandomNoise"] == 2
    assert counts["KSamplerSelect"] == 2
    assert counts["ManualSigmas"] == 2
    assert counts["CFGGuider"] == 2
    assert counts["SamplerCustomAdvanced"] == 2
    assert counts["LTXVSeparateAVLatent"] == 2
    assert counts["LTXVConcatAVLatent"] == 2
    assert counts["LTXVImgToVideoInplace"] == 2
    assert counts["CLIPTextEncode"] == 2


def test_compute_video_resize_landscape_keeps_ratio() -> None:
    """가로 이미지 — 긴 변 = longer, 짧은 변 = 비율 유지 + 8배수."""
    w, h = compute_video_resize(1920, 1080, 1024)
    assert w == 1024
    # 1024 * 1080/1920 = 576 (8배수)
    assert h == 576


def test_compute_video_resize_portrait_keeps_ratio() -> None:
    """세로 이미지 — 긴 변 = longer (h), 짧은 변 = 비율 유지."""
    w, h = compute_video_resize(1080, 1920, 1024)
    assert h == 1024
    assert w == 576


def test_compute_video_resize_square() -> None:
    """정사각 — w == h == longer."""
    w, h = compute_video_resize(1024, 1024, 768)
    assert w == 768
    assert h == 768


def test_compute_video_resize_snap_to_8() -> None:
    """8 배수 스냅 (버림)."""
    # 1500 × 1000 → longer=1024 → (1024, round(1024*1000/1500)=683) → 680 스냅
    w, h = compute_video_resize(1500, 1000, 1024)
    assert w == 1024
    assert h % 8 == 0
    assert h == 680  # round(682.666) = 683 → 683//8*8 = 680


def test_compute_video_resize_zero_dims_fallback() -> None:
    """원본 dims 0 → 포트레이트 폴백."""
    w, h = compute_video_resize(0, 0, 1024)
    assert (w, h) == (512, 768)


def test_build_video_uses_source_dims_for_resize() -> None:
    """source_width/height 전달 시 pre_resize 가 원본 비율 유지."""
    api = build_video_from_request(
        prompt="x",
        source_filename="x.png",
        seed=1,
        source_width=1920,
        source_height=1080,
        longer_edge=1024,
    )
    resize_nodes = [
        n for n in api.values() if n["class_type"] == "ResizeImageMaskNode"
    ]
    assert len(resize_nodes) == 1
    inp = resize_nodes[0]["inputs"]
    assert inp["resize_type.width"] == 1024
    assert inp["resize_type.height"] == 576  # 1080 * 1024/1920

    # longer-edge resizer 도 동적 longer 반영
    longer_nodes = [
        n for n in api.values() if n["class_type"] == "ResizeImagesByLongerEdge"
    ]
    assert longer_nodes[0]["inputs"]["longer_edge"] == 1024

    # latent 도 pre_resize / 2 로 동적 계산 (최소 8)
    lv = [n for n in api.values() if n["class_type"] == "EmptyLTXVLatentVideo"]
    assert lv[0]["inputs"]["width"] == 512   # 1024 / 2
    assert lv[0]["inputs"]["height"] == 288  # 576 / 2


def test_build_video_no_dims_uses_legacy_portrait_box() -> None:
    """source_width/height 미전달 시 레거시 500×800 포트레이트 폴백."""
    api = build_video_from_request(
        prompt="x", source_filename="x.png", seed=1
    )
    resize_nodes = [
        n for n in api.values() if n["class_type"] == "ResizeImageMaskNode"
    ]
    inp = resize_nodes[0]["inputs"]
    assert inp["resize_type.width"] == VIDEO_MODEL.sampling.pre_resize_width
    assert inp["resize_type.height"] == VIDEO_MODEL.sampling.pre_resize_height


def test_build_video_longer_edge_default_1536() -> None:
    """longer_edge 기본값은 1536 (VIDEO_LONGER_EDGE_DEFAULT)."""
    api = build_video_from_request(
        prompt="x",
        source_filename="x.png",
        seed=1,
        source_width=1920,
        source_height=1080,
        # longer_edge 생략 → 1536 기본
    )
    resize_nodes = [
        n for n in api.values() if n["class_type"] == "ResizeImageMaskNode"
    ]
    assert resize_nodes[0]["inputs"]["resize_type.width"] == VIDEO_LONGER_EDGE_DEFAULT


def test_video_longer_edge_range_constants() -> None:
    """슬라이더 범위 상수값 검증."""
    assert VIDEO_LONGER_EDGE_MIN == 512
    assert VIDEO_LONGER_EDGE_MAX == 1536
    assert VIDEO_LONGER_EDGE_DEFAULT == 1536


def test_build_video_load_image_uses_source_filename() -> None:
    api = build_video_from_request(
        prompt="x", source_filename="myphoto.jpg", seed=1
    )
    load_nodes = [n for n in api.values() if n["class_type"] == "LoadImage"]
    assert load_nodes[0]["inputs"]["image"] == "myphoto.jpg"


def test_build_video_positive_prompt_wired() -> None:
    api = build_video_from_request(
        prompt="UNIQUE_VERIFICATION_123", source_filename="x.png", seed=1
    )
    encodes = [n for n in api.values() if n["class_type"] == "CLIPTextEncode"]
    # Positive 노드에 prompt 가 들어있는지 (_meta.title 로 구분)
    positive = next(
        (n for n in encodes if n.get("_meta", {}).get("title") == "Positive"),
        None,
    )
    assert positive is not None
    assert positive["inputs"]["text"] == "UNIQUE_VERIFICATION_123"


def test_build_video_negative_prompt_default() -> None:
    api = build_video_from_request(
        prompt="x", source_filename="x.png", seed=1
    )
    encodes = [n for n in api.values() if n["class_type"] == "CLIPTextEncode"]
    negative = next(
        (n for n in encodes if n.get("_meta", {}).get("title") == "Negative"),
        None,
    )
    assert negative is not None
    assert negative["inputs"]["text"] == VIDEO_MODEL.negative_prompt


def test_build_video_negative_prompt_override() -> None:
    api = build_video_from_request(
        prompt="x",
        source_filename="x.png",
        seed=1,
        negative_prompt="custom negative",
    )
    encodes = [n for n in api.values() if n["class_type"] == "CLIPTextEncode"]
    negative = next(
        n for n in encodes if n.get("_meta", {}).get("title") == "Negative"
    )
    assert negative["inputs"]["text"] == "custom negative"


def test_build_video_unet_override() -> None:
    """env override 가 Checkpoint/AudioVAE/TextEncoder 모두에 반영."""
    api = build_video_from_request(
        prompt="x",
        source_filename="x.png",
        seed=1,
        unet_override="kijai-transformer_only.safetensors",
    )
    ckpt = next(n for n in api.values() if n["class_type"] == "CheckpointLoaderSimple")
    av_vae = next(n for n in api.values() if n["class_type"] == "LTXVAudioVAELoader")
    text_enc = next(n for n in api.values() if n["class_type"] == "LTXAVTextEncoderLoader")
    assert ckpt["inputs"]["ckpt_name"] == "kijai-transformer_only.safetensors"
    assert av_vae["inputs"]["ckpt_name"] == "kijai-transformer_only.safetensors"
    assert text_enc["inputs"]["ckpt_name"] == "kijai-transformer_only.safetensors"


def test_build_video_frame_params_match_preset() -> None:
    api = build_video_from_request(prompt="x", source_filename="x.png", seed=1)
    s = VIDEO_MODEL.sampling
    empty_vid = next(n for n in api.values() if n["class_type"] == "EmptyLTXVLatentVideo")
    assert empty_vid["inputs"]["length"] == s.frame_count
    assert empty_vid["inputs"]["width"] == s.latent_width
    assert empty_vid["inputs"]["height"] == s.latent_height

    empty_aud = next(n for n in api.values() if n["class_type"] == "LTXVEmptyLatentAudio")
    assert empty_aud["inputs"]["frames_number"] == s.audio_frames
    assert empty_aud["inputs"]["frame_rate"] == s.audio_frame_rate

    create = next(n for n in api.values() if n["class_type"] == "CreateVideo")
    assert create["inputs"]["fps"] == float(s.fps)


def test_build_video_seed_different_for_stages() -> None:
    """base stage seed = 주어진 값, upscale stage seed = seed+1 로 구분."""
    api = build_video_from_request(prompt="x", source_filename="x.png", seed=100)
    noises = [n for n in api.values() if n["class_type"] == "RandomNoise"]
    seeds = [n["inputs"]["noise_seed"] for n in noises]
    assert sorted(seeds) == [100, 101]
