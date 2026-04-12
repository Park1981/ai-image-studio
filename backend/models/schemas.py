"""
Pydantic 스키마 정의
API 요청/응답 모델
"""

from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


# ─────────────────────────────────────────────
# 공통 응답
# ─────────────────────────────────────────────

class ApiResponse(BaseModel, Generic[T]):
    """공통 API 응답 래퍼"""
    success: bool
    data: T
    error: str | None = None


# ─────────────────────────────────────────────
# 이미지 생성
# ─────────────────────────────────────────────

class LoraConfig(BaseModel):
    """LoRA 설정"""
    name: str
    strength_model: float = Field(default=0.7, ge=0.0, le=2.0)
    strength_clip: float = Field(default=0.7, ge=0.0, le=2.0)


class GenerateRequest(BaseModel):
    """이미지 생성 요청"""
    prompt: str
    negative_prompt: str = ""
    auto_enhance: bool = True
    checkpoint: str = ""
    loras: list[LoraConfig] = []
    vae: str = ""
    sampler: str = "dpmpp_2m"
    scheduler: str = "karras"
    width: int = Field(default=1024, ge=256, le=2048)
    height: int = Field(default=1024, ge=256, le=2048)
    steps: int = Field(default=25, ge=1, le=150)
    cfg: float = Field(default=7.0, ge=1.0, le=30.0)
    seed: int = -1  # -1 = 랜덤
    batch_size: int = Field(default=1, ge=1, le=4)
    mode: str = "qwen_image"  # qwen_image | txt2img | img2img | inpaint


class EditRequest(BaseModel):
    """이미지 수정 요청 (Qwen Image Edit)"""
    source_image: str  # 업로드된 이미지 파일명 또는 서버 내 생성 이미지 경로
    edit_prompt: str  # 수정 지시 프롬프트
    auto_enhance: bool = True  # AI 프롬프트 보강 여부
    checkpoint: str = ""  # 체크포인트 이름 (빈 문자열이면 워크플로우 기본값)
    loras: list[LoraConfig] = []  # LoRA 설정 목록
    vae: str = ""  # VAE 이름 (빈 문자열이면 기본값)
    steps: int = Field(default=50, ge=1, le=150)
    cfg: float = Field(default=4.0, ge=1.0, le=30.0)
    seed: int = -1  # -1 = 랜덤


class GenerateResponse(BaseModel):
    """이미지 생성 응답"""
    task_id: str
    status: str  # queued | generating | completed | error | cancelled
    prompt_enhanced: str | None = None
    negative_prompt: str | None = None
    comfyui_started: bool = False


# ─────────────────────────────────────────────
# 프롬프트 보강
# ─────────────────────────────────────────────

class EnhanceCategoryConfig(BaseModel):
    """AI 보강 카테고리별 ON/OFF 설정"""
    subject: bool = True       # 피사체/인물
    background: bool = True    # 배경/환경
    lighting: bool = True      # 조명
    style: bool = True         # 스타일
    mood: bool = True          # 분위기
    technical: bool = False    # 기술적 (카메라/렌즈) — 기본 OFF


class EnhanceRequest(BaseModel):
    """프롬프트 보강 요청"""
    prompt: str
    style: str = "photorealistic"  # photorealistic | anime | illustration | etc.
    model: str = ""  # Ollama 모델 이름 (빈 문자열이면 기본 모델 사용)
    mode: str = "generate"  # generate | edit
    creativity: float = Field(default=0.7, ge=0.1, le=1.0)  # Ollama temperature
    detail_level: str = "normal"  # minimal | normal | detailed
    categories: EnhanceCategoryConfig = EnhanceCategoryConfig()


class EnhanceWithVisionRequest(BaseModel):
    """비전(이미지 분석) 기반 프롬프트 보강 요청"""
    prompt: str
    source_image: str  # 이미지 파일명 (uploads/ 또는 images/ 디렉토리)
    style: str = "photorealistic"
    ollama_model: str = ""  # 비전 모델 (빈 문자열이면 기본 모델 사용)
    creativity: float = Field(default=0.7, ge=0.1, le=1.0)
    detail_level: str = "normal"  # minimal | normal | detailed
    categories: EnhanceCategoryConfig | None = None


class EnhanceCategoryItem(BaseModel):
    """보강 결과의 카테고리별 항목"""
    name: str          # subject | background | lighting | style | mood | technical
    label_ko: str      # 한국어 라벨 (피사체/인물)
    text_en: str       # 영어 보강 텍스트
    text_ko: str       # 한국어 설명
    auto_filled: bool  # AI가 자동 채운 항목 여부


class EnhanceResponse(BaseModel):
    """프롬프트 보강 응답"""
    original: str
    enhanced: str  # 최종 합쳐진 프롬프트
    negative: str
    fallback: bool = False  # Ollama 호출 실패 시 폴백 사용 여부
    categories: list[EnhanceCategoryItem] = []  # 카테고리별 상세 결과
    provider: str = "ollama"  # 보강 제공자: "ollama" | "claude_cli" | "fallback"


# ─────────────────────────────────────────────
# 프로세스 상태
# ─────────────────────────────────────────────

class OllamaStatus(BaseModel):
    """Ollama 프로세스 상태"""
    running: bool
    model_loaded: str | None = None
    ram_usage_mb: float = 0


class ComfyUIStatus(BaseModel):
    """ComfyUI 프로세스 상태"""
    running: bool
    vram_used_gb: float = 0
    vram_total_gb: float = 16.0
    uptime_min: float = 0


class ProcessStatusResponse(BaseModel):
    """프로세스 상태 응답"""
    ollama: OllamaStatus
    comfyui: ComfyUIStatus


# ─────────────────────────────────────────────
# 히스토리
# ─────────────────────────────────────────────

class HistoryItem(BaseModel):
    """생성 이력 항목"""
    id: str
    prompt: str
    enhanced_prompt: str | None = None
    negative_prompt: str | None = None
    checkpoint: str
    loras: list[LoraConfig] = []
    sampler: str
    scheduler: str
    width: int
    height: int
    steps: int
    cfg: float
    seed: int
    images: list[str]  # 이미지 파일명 목록
    created_at: str
