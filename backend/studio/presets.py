"""
presets.py - 모델 프리셋 (프론트 lib/model-presets.ts 미러).

프론트엔드와 **반드시 동기화**. JSON 이 아닌 Python 으로 유지해
runtime 에 type 체크를 받는 이점. /api/studio/models 엔드포인트로
프론트가 받아갈 때는 dataclasses.asdict 로 직렬화.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


# ── 종횡비 프리셋 (Qwen Image 2512 권장 사이즈) ──
@dataclass(frozen=True)
class AspectRatio:
    label: str
    width: int
    height: int


ASPECT_RATIOS: list[AspectRatio] = [
    AspectRatio("1:1", 1328, 1328),
    AspectRatio("16:9", 1664, 928),
    AspectRatio("9:16", 928, 1664),
    AspectRatio("4:3", 1472, 1104),
    AspectRatio("3:4", 1104, 1472),
    AspectRatio("3:2", 1584, 1056),
    AspectRatio("2:3", 1056, 1584),
]

ASPECT_MAP = {r.label: r for r in ASPECT_RATIOS}


def get_aspect(label: str) -> AspectRatio:
    """잘못된 label 이 들어오면 기본 1:1 로 폴백."""
    return ASPECT_MAP.get(label, ASPECT_RATIOS[0])


# ── LoRA 엔트리 ──
@dataclass(frozen=True)
class LoraEntry:
    name: str
    strength: float
    role: Literal["lightning", "extra"]


# ── Video 전용 LoRA 엔트리 ──
# Qwen 의 lightning/extra 분류와 달리, LTX-2.3 은 LoRA 체인을 순차 적용 후
# base+upscale 두 샘플링에서 같은 체인을 공유. role 구분 의미 없고 순서만 중요.
@dataclass(frozen=True)
class VideoLoraEntry:
    name: str
    strength: float
    note: str = ""  # 워크플로우상 역할 메모 (예: "distilled base", "extra")


# ── 파일 세트 ──
@dataclass(frozen=True)
class ModelFiles:
    unet: str
    clip: str
    vae: str


# ── 기본 샘플링 설정 ──
@dataclass(frozen=True)
class SamplingDefaults:
    steps: int
    cfg: float
    sampler: str
    scheduler: str
    shift: float
    batch_size: int
    seed: int


@dataclass(frozen=True)
class LightningOverride:
    steps: int
    cfg: float


# ── 생성 모델 ──
@dataclass(frozen=True)
class GenerateModelPreset:
    display_name: str
    tag: str
    workflow: str  # backend/workflows/ 하위 파일명
    subgraph_id: str
    files: ModelFiles
    loras: list[LoraEntry]
    defaults: SamplingDefaults
    lightning: LightningOverride
    negative_prompt: str
    default_aspect: str  # e.g. "1:1"


GENERATE_MODEL = GenerateModelPreset(
    display_name="Qwen Image 2512",
    tag="GGUF·FP8",
    workflow="qwen_image_2512.json",
    subgraph_id="c3c58f7e-2004-43ae-8b06-a956294bf7f4",
    files=ModelFiles(
        unet="qwen_image_2512_fp8_e4m3fn.safetensors",
        clip="qwen_2.5_vl_7b_fp8_scaled.safetensors",
        vae="qwen_image_vae.safetensors",
    ),
    loras=[
        LoraEntry(
            name="Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors",
            strength=1.0,
            role="lightning",
        ),
        LoraEntry(
            name="FemNude_qwen-image-2512_epoch30.safetensors",
            strength=1.0,
            role="extra",
        ),
    ],
    defaults=SamplingDefaults(
        steps=50,
        cfg=4.0,
        sampler="euler",
        scheduler="simple",
        shift=3.1,
        batch_size=1,
        seed=464857551335368,
    ),
    lightning=LightningOverride(steps=4, cfg=1.0),
    negative_prompt=(
        "低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，"
        "过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲"
    ),
    default_aspect="1:1",
)


# ── 수정 모델 ──
@dataclass(frozen=True)
class EditModelPreset:
    display_name: str
    tag: str
    workflow: str
    subgraph_id: str
    files: ModelFiles
    loras: list[LoraEntry]
    defaults: SamplingDefaults
    lightning: LightningOverride
    reference_latent_method: str
    auto_scale_reference: bool
    max_reference_images: int


EDIT_MODEL = EditModelPreset(
    display_name="Qwen Image Edit 2511",
    tag="BF16",
    workflow="qwen_image_edit_2511.json",
    subgraph_id="cdb2cf24-c432-439b-b5c8-5f69838580c9",
    files=ModelFiles(
        unet="qwen_image_edit_2511_bf16.safetensors",
        clip="qwen_2.5_vl_7b_fp8_scaled.safetensors",
        vae="qwen_image_vae.safetensors",
    ),
    loras=[
        LoraEntry(
            name="Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
            strength=1.0,
            role="lightning",
        ),
        LoraEntry(
            name="SexGod_CouplesNudity_QwenEdit_2511_v1.safetensors",
            strength=0.7,
            role="extra",
        ),
    ],
    defaults=SamplingDefaults(
        steps=40,
        cfg=4.0,
        sampler="euler",
        scheduler="simple",
        shift=3.1,
        batch_size=1,
        seed=988400431880911,
    ),
    lightning=LightningOverride(steps=4, cfg=1.0),
    reference_latent_method="index_timestep_zero",
    auto_scale_reference=True,
    max_reference_images=3,
)


# ── Ollama 역할 ──
@dataclass(frozen=True)
class OllamaRoles:
    text: str  # 프롬프트 업그레이드용 (gemma4-un 류)
    vision: str  # 수정 모드 이미지 분석용 (vision-q4km)


DEFAULT_OLLAMA_ROLES = OllamaRoles(
    text="gemma4-un:latest",
    vision="qwen2.5vl:7b",  # 표준 vision 모델 (Ollama 0.20.2 llama.cpp 지원)
)


# ══════════════════════════════════════════════════════════════════════
# LTX-2.3 Image-to-Video 프리셋
# ══════════════════════════════════════════════════════════════════════
# 출처: Comfy-Org/workflow_templates/templates/video_ltx2_3_i2v.json
# 공식 ComfyUI 템플릿의 subgraph 를 분석해 에센셜 값을 Python 으로 추출.
# ComfyMathExpression/PrimitiveInt/Reroute 조력 노드는 Python 에서 미리 계산해
# 에센셜 25~28 노드로 축소 후 build_video_from_request 가 조립.
# ══════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class VideoFiles:
    """LTX-2.3 체크포인트/인코더/업스케일러 파일명.

    unet 과 audio_vae 는 **같은 파일** — LTX-2.3 체크포인트에 AV VAE 가 통합.
    """
    unet: str
    text_encoder: str
    upscaler: str
    weight_dtype: str = "default"


@dataclass(frozen=True)
class VideoSampling:
    """LTX-2.3 2-stage sampling 파라미터 (공식 템플릿 값 그대로)."""

    # 시간
    seconds: int = 5
    fps: int = 25
    frame_count: int = 126  # seconds*fps + 1 (LTX 요구사항)

    # Pre-resize (ResizeImageMaskNode · 포트레이트 박스 fit)
    pre_resize_width: int = 500
    pre_resize_height: int = 800
    pre_resize_mode: str = "scale dimensions"
    pre_resize_anchor: str = "center"
    pre_resize_method: str = "lanczos"

    # Longer-edge 리사이즈 (ResizeImagesByLongerEdge)
    longer_edge: int = 1536

    # EmptyLTXVLatentVideo (pre_resize 의 절반)
    latent_width: int = 250   # pre_resize_width / 2
    latent_height: int = 400  # pre_resize_height / 2
    batch_size: int = 1

    # LTXVEmptyLatentAudio
    audio_frames: int = 126     # == frame_count
    audio_frame_rate: int = 25  # == fps
    audio_channels: int = 1

    # Sampling — Stage 1 (base)
    base_sampler: str = "euler_cfg_pp"
    base_sigmas: str = "0.85, 0.7250, 0.4219, 0.0"
    base_seed: int = 42       # RandomNoise widget (fixed) — build 호출자가 override 가능
    base_cfg: float = 1.0

    # Sampling — Stage 2 (upscale)
    upscale_sampler: str = "euler_ancestral_cfg_pp"
    upscale_sigmas: str = (
        "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0"
    )
    upscale_cfg: float = 1.0

    # LTXV 특수 파라미터
    preprocess_seed: int = 18       # LTXVPreprocess[18]
    imgtovideo_first_pad: float = 1.0    # LTXVImgToVideoInplace[1, False] (base stage)
    imgtovideo_second_pad: float = 0.7   # LTXVImgToVideoInplace[0.7, False] (upscale stage)
    imgtovideo_bypass: bool = False

    # VAE decode
    vae_decode_tile_size: int = 768
    vae_decode_overlap: int = 64
    vae_decode_temporal: int = 4096
    vae_decode_temporal_overlap: int = 4


@dataclass(frozen=True)
class VideoModelPreset:
    display_name: str
    tag: str
    files: VideoFiles
    loras: list[VideoLoraEntry]
    sampling: VideoSampling
    negative_prompt: str


VIDEO_MODEL = VideoModelPreset(
    display_name="LTX Video 2.3",
    tag="22B · A/V",
    files=VideoFiles(
        unet="ltx-2.3-22b-dev-fp8.safetensors",
        text_encoder="gemma_3_12B_it_fp4_mixed.safetensors",
        upscaler="ltx-2.3-spatial-upscaler-x2-1.1.safetensors",
    ),
    # 워크플로우 체인 순서 그대로 (model ← lora3 ← lora2 ← lora1 ← checkpoint):
    #   Checkpoint → 285(distilled) → 325(distilled) → 324(eros) → CFGGuider
    loras=[
        VideoLoraEntry(
            name="ltx-2.3-22b-distilled-lora-384.safetensors",
            strength=0.5,
            note="distilled · base",
        ),
        VideoLoraEntry(
            name="ltx-2.3-22b-distilled-lora-384.safetensors",
            strength=0.5,
            note="distilled · upscale",
        ),
        VideoLoraEntry(
            name="ltx2310eros_beta.safetensors",
            strength=0.5,
            note="extra",
        ),
    ],
    sampling=VideoSampling(),
    negative_prompt=(
        "pc game, console game, video game, cartoon, childish, ugly"
    ),
)


def resolve_video_unet_name(env_override: str | None = None) -> str:
    """VRAM 16GB 환경에서 공식 fp8 (29GB) 대신 Kijai transformer_only 등
    대체 파일을 쓸 수 있게 env override 를 허용.

    - env_override 가 있으면 그 값 사용
    - 없으면 VIDEO_MODEL.files.unet 반환 (공식 29GB fp8)
    """
    return env_override or VIDEO_MODEL.files.unet


# ── 유틸 ──
def active_loras(loras: list[LoraEntry], lightning_on: bool) -> list[LoraEntry]:
    """Lightning 토글에 따라 활성 LoRA 반환.
    - lightning_on=False: role == "extra" 만
    - lightning_on=True : role == "lightning" 과 extra 모두
    """
    if lightning_on:
        return list(loras)
    return [lo for lo in loras if lo.role != "lightning"]


def count_extra_loras(loras: list[LoraEntry]) -> int:
    return sum(1 for lo in loras if lo.role == "extra")
