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
# LTX-2.3 의 LoRA 체인:
#  - lightning (2개): Lightning 토글 ON 시 4-step 초고속 샘플링용
#    (2026-04-24 v10: 기존 "distilled" 에서 rename — Qwen 과 용어 통일)
#  - adult (옵션): 성인 모드 토글 ON 시에만 체인에 포함
# Lightning OFF + adult OFF → LoRA 0개 (full LTX 2.3 원본 샘플링, 얼굴 보존 최강)
@dataclass(frozen=True)
class VideoLoraEntry:
    name: str
    strength: float
    role: Literal["lightning", "adult"] = "lightning"
    note: str = ""  # 워크플로우상 역할 메모 (예: "lightning base", "extra")


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


# ── 스타일 프리셋 (LoRA + sampling override + 트리거) ──
# 2026-04-25: 특정 LoRA (예: AI Asian Influencer · blue_hair_q2512) 가 표준 sampling
# 파라미터와 다른 권장값 (sampler/steps/cfg) 을 요구할 때, 토글 ON 시 자동으로
# 적용. Lightning 과 비호환 (sampling 값이 충돌) — 호출부가 강제 OFF 처리.
@dataclass(frozen=True)
class StylePreset:
    """스타일 LoRA 프리셋.

    토글 ON 시:
      - LoRA 체인에 self.lora 가 추가됨 (strength 적용)
      - sampling 파라미터가 self.sampling_override 로 교체됨
      - self.trigger_prompt 가 비어있지 않으면 prompt 보강 시 트리거 강제
      - incompatible_with_lightning=True 면 호출부가 Lightning 토글 OFF 처리
    """

    id: str  # 식별자 — request 의 styleId 와 매칭 ("asian_influencer")
    display_name: str  # UI 라벨
    description: str  # UI 서브라벨 (예: "Euler A · 25step · cfg 6.0")
    lora: LoraEntry
    sampling_override: SamplingDefaults
    trigger_prompt: str  # 트리거 키워드 (빈 문자열 가능 — 차후 실측 후 추가)
    incompatible_with_lightning: bool = True


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
        # 2026-04-25: FemNude_qwen-image-2512_epoch30 → female-body-beauty_qwen
        # 사용자 평가에서 후자가 더 자연스러움. 트리거/sampling override 불필요한 LoRA.
        LoraEntry(
            name="female-body-beauty_qwen.safetensors",
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
    # 2026-04-25 픽스: Lightning 디테일 개선 (4/1.0 → 8/1.5).
    # 4-step 의 살짝 블러 느낌 → 사용자 비교 평가 (4/1.0 · 6/1.2 · 8/1.5) 결과:
    #   8/1.5 에서 머리카락 / 얼굴 / 의상 텍스처 모두 뚜렷하게 향상되고
    #   color over-saturation 없이 자연스러움. 시간은 4-step 대비 ~2배.
    # frontend/lib/model-presets.ts 의 GENERATE_MODEL.lightning 와 동기화 유지.
    lightning=LightningOverride(steps=8, cfg=1.5),
    negative_prompt=(
        "低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，"
        "过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲"
    ),
    default_aspect="1:1",
)


# ── Generate 스타일 LoRA 목록 ──
# 토글로 활성화하는 추가 LoRA. 활성 시 sampling 파라미터도 같이 override + 트리거 prepend.
# 차후 다른 스타일 LoRA 추가 시 이 배열에 StylePreset 객체만 추가하면 됨.
# 2026-04-25 (1차 시도 후 보류): blue_hair_q2512 (AI Asian Influencer) 평가 결과 효과 미약 →
# 제거. 시스템 (StylePreset / get_generate_style / builder 의 trigger prepend) 은 유지.
GENERATE_STYLES: list[StylePreset] = []


def get_generate_style(style_id: str | None) -> StylePreset | None:
    """style_id 로 GENERATE_STYLES 에서 매칭되는 프리셋 반환 (없으면 None)."""
    if not style_id:
        return None
    for s in GENERATE_STYLES:
        if s.id == style_id:
            return s
    return None


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
    # 실제 노드 schema: resize_type (DYNAMICCOMBO · grouped) + scale_method + crop
    pre_resize_width: int = 500
    pre_resize_height: int = 800
    pre_resize_mode: str = "scale dimensions"
    pre_resize_crop: str = "center"
    pre_resize_scale_method: str = "lanczos"

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

    # LTXV 특수 파라미터 (실 schema 기준 이름)
    # 2026-04-24 · v10: 얼굴 identity drift 대응 (커뮤니티 consensus 반영)
    #   - img_compression 18→12: 원본 얼굴/피부 디테일 보존 강화
    #   - second_strength 0.7→0.9: upscale 단계 first-frame anchor 강화
    preprocess_img_compression: int = 12    # LTXVPreprocess.img_compression
    imgtovideo_first_strength: float = 1.0  # LTXVImgToVideoInplace.strength (base)
    imgtovideo_second_strength: float = 0.9 # LTXVImgToVideoInplace.strength (upscale)
    imgtovideo_bypass: bool = False

    # SaveVideo
    save_format: str = "mp4"  # COMBO default 'auto'
    save_codec: str = "h264"  # COMBO default 'auto'

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
    # 워크플로우 체인 순서 (model ← lora_last ← ... ← lora_first ← checkpoint).
    #  - lightning 2개: Lightning 토글 ON 시만 체인 포함 (4-step 초고속, 품질 희생)
    #  - adult (eros): 성인 모드 토글 ON 시에만 체인 포함
    # 2026-04-24 · v10: role "distilled" → "lightning" rename.
    loras=[
        VideoLoraEntry(
            name="ltx-2.3-22b-distilled-lora-384.safetensors",
            strength=0.5,
            role="lightning",
            note="lightning · base (4-step distilled)",
        ),
        VideoLoraEntry(
            name="ltx-2.3-22b-distilled-lora-384.safetensors",
            strength=0.5,
            role="lightning",
            note="lightning · upscale (4-step distilled)",
        ),
        VideoLoraEntry(
            name="ltx2310eros_beta.safetensors",
            strength=0.5,
            role="adult",
            note="erotic motion (adult mode only)",
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


def active_video_loras(
    loras: list[VideoLoraEntry],
    adult: bool,
    lightning: bool = True,
) -> list[VideoLoraEntry]:
    """Lightning/Adult 토글 조합에 따라 활성 Video LoRA 체인 반환.

    2026-04-24 · v10: lightning 인자 추가.

    - lightning=True,  adult=False: lightning 2개 (4-step 초고속 · 기본)
    - lightning=True,  adult=True : lightning 2개 + adult 1개 (초고속 + NSFW)
    - lightning=False, adult=False: LoRA 0개 (full 30-step · 얼굴 보존 최강)
    - lightning=False, adult=True : adult 1개만 (full sampling + NSFW)
    """
    result: list[VideoLoraEntry] = []
    for lo in loras:
        if lo.role == "lightning" and not lightning:
            continue
        if lo.role == "adult" and not adult:
            continue
        result.append(lo)
    return result


# ── Video 해상도 슬라이더 범위 (2026-04-24 · v9) ──
# 긴 변 픽셀 기준. LTX-2.3 은 공간 해상도 8배수 요구 + spatial-upscaler x2 이후 단계적 요구사항.
# max 1536 = VRAM 16GB 한계 + 공식 템플릿 기본값. min 512 = 품질 급락 마지노선.
# step 128 은 LTX 패치 크기(32×8=256) 배수/2 → latent 스페이스에서 깔끔하게 떨어짐.
VIDEO_LONGER_EDGE_MIN = 512
VIDEO_LONGER_EDGE_MAX = 1536
VIDEO_LONGER_EDGE_STEP = 128
VIDEO_LONGER_EDGE_DEFAULT = 1536


def build_quality_sigmas(steps: int, shift: float = 3.1) -> str:
    """Lightning OFF 시 쓸 full-step flow matching sigmas 생성.

    LTX 2.3 = flow matching 모델. simple scheduler + flow shift 적용.
    Shifted sigma 공식: σ' = shift·σ / (1 + (shift-1)·σ)

    Args:
        steps: 샘플링 스텝 수 (보통 30 for base, 20 for upscale)
        shift: flow shift 계수 (VIDEO_MODEL.sampling.shift 와 동일, 기본 3.1)

    Returns:
        "1.0000, 0.9888, ..., 0.0" 형태 CSV (ManualSigmas 입력용).
    """
    parts: list[str] = []
    for i in range(steps + 1):
        s = 1.0 - (i / steps)
        shifted = shift * s / (1 + (shift - 1) * s) if s > 0 else 0.0
        parts.append(f"{shifted:.4f}")
    return ", ".join(parts)


# Lightning OFF (고품질) 모드 sigmas — 상수화 (빌드 속도 ↑)
QUALITY_BASE_SIGMAS = build_quality_sigmas(30, shift=3.1)
QUALITY_UPSCALE_SIGMAS = build_quality_sigmas(20, shift=3.1)


def compute_video_resize(
    source_width: int, source_height: int, longer_edge: int
) -> tuple[int, int]:
    """원본 비율을 유지한 채 긴 변을 longer_edge 로 맞춘 (w, h) 반환.

    - 가로 >= 세로: w = longer_edge, h = longer_edge * (h/w)
    - 세로 > 가로 : h = longer_edge, w = longer_edge * (w/h)
    - 결과는 LTX-2.3 공간 요구사항에 맞춰 **8배수 스냅** (버림, 최소 8).

    Args:
        source_width: 원본 너비 (px · PIL 측정값)
        source_height: 원본 높이
        longer_edge: 사용자 지정 긴 변 픽셀 (VIDEO_LONGER_EDGE_MIN~MAX)

    Returns:
        (pre_resize_width, pre_resize_height) — ResizeImageMaskNode 입력값.
    """
    if source_width <= 0 or source_height <= 0:
        # 원본 dims 를 못 잡은 경우 기본 포트레이트 박스로 폴백
        return 512, 768
    if source_width >= source_height:
        w = longer_edge
        h = round(longer_edge * source_height / source_width)
    else:
        h = longer_edge
        w = round(longer_edge * source_width / source_height)
    # 8 배수 스냅 (최소 8)
    w = max(8, (w // 8) * 8)
    h = max(8, (h // 8) * 8)
    return w, h
