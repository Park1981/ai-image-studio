"""
presets.py - 모델 프리셋 (프론트 lib/model-presets.ts 미러).

프론트엔드와 **반드시 동기화**. JSON 이 아닌 Python 으로 유지해
runtime 에 type 체크를 받는 이점. /api/studio/models 엔드포인트로
프론트가 받아갈 때는 dataclasses.asdict 로 직렬화.
"""

from __future__ import annotations

from dataclasses import dataclass, field
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
