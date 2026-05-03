"""
Wan 2.2 i2v ComfyUI 빌더 검증 (Phase 2 · 2026-05-03).

목적:
  - build_video_from_request(model_id="wan22", ...) 가 spec §4.2 노드 그래프 그대로 생성
  - WAN22_VIDEO_PRESET 의 dataclass 값이 노드 widget 에 정확히 반영되는지
  - Lightning ON/OFF 분기 (steps/cfg/split) 정확
  - LoRA 체인: lightning(toggle) + motion(always) — high/low 양쪽 모두

spec: docs/superpowers/specs/2026-05-03-video-model-selection-wan22.md §4.2
Phase 1.5 검증 (2026-05-03): WanImageToVideo 출력 = CONDITIONING × 2 + LATENT 3개.
"""

from __future__ import annotations

from collections import Counter

from studio.comfy_api_builder import build_video_from_request
from studio.presets import WAN22_VIDEO_PRESET


def _api_wan22(*, lightning: bool = True, **kw):
    """헬퍼 — Wan22 빌더 호출 default 인자 묶음."""
    defaults = dict(
        model_id="wan22",
        prompt="A cinematic shot of a woman walking",
        source_filename="input.png",
        seed=42,
        source_width=832,
        source_height=480,
        lightning=lightning,
    )
    defaults.update(kw)
    return build_video_from_request(**defaults)


# ───────── 1. 노드 셋 검증 ─────────


def test_wan22_required_node_types_present() -> None:
    """spec §4.2 다이어그램의 모든 필수 class_type 이 빌더 출력에 포함되는지."""
    api = _api_wan22(lightning=True)
    types = Counter(node["class_type"] for node in api.values())
    # 단일 노드 (1회만 등장)
    assert types["LoadImage"] == 1
    assert types["CLIPLoader"] == 1
    assert types["VAELoader"] == 1
    assert types["WanImageToVideo"] == 1
    assert types["VAEDecode"] == 1
    assert types["CreateVideo"] == 1
    assert types["SaveVideo"] == 1
    # 양쪽 stage 등장 (high + low)
    assert types["UnetLoaderGGUF"] == 2
    assert types["ModelSamplingSD3"] == 2
    assert types["KSamplerAdvanced"] == 2
    # CLIPTextEncode 는 positive/negative 2개
    assert types["CLIPTextEncode"] == 2
    # LoRA: Lightning ON 시 high(2) + low(2) = 4 (lightning + motion 양쪽 stage)
    assert types["LoraLoaderModelOnly"] == 4


# ───────── 2. Lightning ON sampling 파라미터 ─────────


def test_wan22_lightning_on_ksampler_widgets() -> None:
    """Lightning ON: KSamplerAdvanced 두 노드의 steps=4/cfg=1.0/end_step 정확."""
    api = _api_wan22(lightning=True, seed=12345)
    samplers = [n for n in api.values() if n["class_type"] == "KSamplerAdvanced"]
    assert len(samplers) == 2
    # high stage (add_noise=enable, start_at_step=0, end_at_step=2 (lightning_split))
    high = next(s for s in samplers if s["inputs"]["add_noise"] == "enable")
    assert high["inputs"]["steps"] == 4
    assert high["inputs"]["cfg"] == 1.0
    assert high["inputs"]["start_at_step"] == 0
    assert high["inputs"]["end_at_step"] == 2  # lightning_split
    assert high["inputs"]["return_with_leftover_noise"] == "enable"
    assert high["inputs"]["noise_seed"] == 12345
    # low stage (add_noise=disable, start_at_step=2, end_at_step=10000)
    low = next(s for s in samplers if s["inputs"]["add_noise"] == "disable")
    assert low["inputs"]["steps"] == 4
    assert low["inputs"]["cfg"] == 1.0
    assert low["inputs"]["start_at_step"] == 2  # split
    assert low["inputs"]["end_at_step"] == 10000
    assert low["inputs"]["return_with_leftover_noise"] == "disable"
    # high/low 동일 seed (사용자 결정 #2 spec §4.2)
    assert low["inputs"]["noise_seed"] == 12345


# ───────── 3. Lightning OFF sampling 파라미터 ─────────


def test_wan22_lightning_off_ksampler_widgets() -> None:
    """Lightning OFF (정밀): steps=20/cfg=3.5/end_step=10/10000."""
    api = _api_wan22(lightning=False)
    samplers = [n for n in api.values() if n["class_type"] == "KSamplerAdvanced"]
    high = next(s for s in samplers if s["inputs"]["add_noise"] == "enable")
    low = next(s for s in samplers if s["inputs"]["add_noise"] == "disable")
    assert high["inputs"]["steps"] == 20
    assert high["inputs"]["cfg"] == 3.5
    assert high["inputs"]["end_at_step"] == 10  # precise_split
    assert low["inputs"]["steps"] == 20
    assert low["inputs"]["cfg"] == 3.5
    assert low["inputs"]["start_at_step"] == 10
    assert low["inputs"]["end_at_step"] == 10000
    # Lightning OFF 시 LoRA 체인은 motion 만 (lightning 스킵)
    types = Counter(node["class_type"] for node in api.values())
    assert types["LoraLoaderModelOnly"] == 2  # high motion + low motion


# ───────── 4. LoRA 체인 순서/내용 ─────────


def test_wan22_lora_chain_order_and_files() -> None:
    """LoRA 체인 순서: lightning → motion. high/low 별 정확한 파일명."""
    api = _api_wan22(lightning=True)
    lora_nodes = [
        (nid, n) for nid, n in api.items() if n["class_type"] == "LoraLoaderModelOnly"
    ]
    assert len(lora_nodes) == 4

    # node id 순서대로 정렬 → 빌더가 high 먼저 → low 순서로 추가했는지
    lora_nodes.sort(key=lambda kv: int(kv[0]))
    names = [n["inputs"]["lora_name"] for _, n in lora_nodes]

    # 예상 순서:
    # high stage: lightning_high → motion_high
    # low stage:  lightning_low  → motion_low
    expected = [
        "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
        "BounceHighWan2_2.safetensors",
        "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
        "BounceHighWan2_2.safetensors",
    ]
    assert names == expected

    # strength 검증: lightning=1.0, motion=0.8 (preset 박제값)
    strengths = [n["inputs"]["strength_model"] for _, n in lora_nodes]
    assert strengths == [1.0, 0.8, 1.0, 0.8]


# ───────── 5. ModelSamplingSD3 shift = 8.0 ─────────


def test_wan22_model_sampling_sd3_shift() -> None:
    """spec §2 결정 — GGUF 권장 shift 8.0 (safetensors fp8 의 5 와 다름)."""
    api = _api_wan22()
    sd3_nodes = [n for n in api.values() if n["class_type"] == "ModelSamplingSD3"]
    assert len(sd3_nodes) == 2
    for n in sd3_nodes:
        assert n["inputs"]["shift"] == 8.0


# ───────── 6. WanImageToVideo / 파일명 / fps default ─────────


def test_wan22_image_to_video_and_files() -> None:
    """WanImageToVideo 의 width/height/length default + 파일명 (spec §4.2 검증)."""
    api = _api_wan22()
    # WanImageToVideo
    wan_node = next(
        n for n in api.values() if n["class_type"] == "WanImageToVideo"
    )
    # 832×480 source 입력 → compute_video_resize 가 그대로 (이미 8배수)
    assert wan_node["inputs"]["width"] == 832
    assert wan_node["inputs"]["height"] == 480
    assert wan_node["inputs"]["length"] == 81  # default_length
    assert wan_node["inputs"]["batch_size"] == 1

    # CLIPLoader type="wan" + 파일명 (Phase 1.5 검증)
    clip_node = next(n for n in api.values() if n["class_type"] == "CLIPLoader")
    assert clip_node["inputs"]["type"] == "wan"
    assert clip_node["inputs"]["clip_name"] == WAN22_VIDEO_PRESET.files.text_encoder

    # VAE
    vae_node = next(n for n in api.values() if n["class_type"] == "VAELoader")
    assert vae_node["inputs"]["vae_name"] == WAN22_VIDEO_PRESET.files.vae

    # UnetLoaderGGUF: high + low 둘 다 정확한 파일명
    unet_nodes = [n for n in api.values() if n["class_type"] == "UnetLoaderGGUF"]
    unet_names = sorted(n["inputs"]["unet_name"] for n in unet_nodes)
    assert unet_names == sorted(
        [WAN22_VIDEO_PRESET.files.unet_high, WAN22_VIDEO_PRESET.files.unet_low]
    )
    # dequant_dtype 파라미터는 노드에 없으므로 빌더가 보내지 말아야 함 (Phase 1.5 검증)
    for n in unet_nodes:
        assert "dequant_dtype" not in n["inputs"]

    # CreateVideo fps = 16 (Wan 학습 fps)
    create_node = next(n for n in api.values() if n["class_type"] == "CreateVideo")
    assert create_node["inputs"]["fps"] == 16.0


# ───────── 보너스: facade 의 unknown model_id ValueError ─────────


def test_wan22_facade_unknown_model_id_raises() -> None:
    """잘못된 model_id 는 ValueError (frontend mirror 와 sync 깨짐 검출)."""
    import pytest

    with pytest.raises(ValueError, match="unknown video model_id"):
        build_video_from_request(
            model_id="unknown",  # type: ignore[arg-type]
            prompt="x",
            source_filename="x.png",
            seed=1,
        )
