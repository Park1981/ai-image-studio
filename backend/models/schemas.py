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
    mode: str = "txt2img"  # txt2img | img2img | inpaint


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

class EnhanceRequest(BaseModel):
    """프롬프트 보강 요청"""
    prompt: str
    style: str = "photorealistic"  # photorealistic | anime | illustration | etc.


class EnhanceResponse(BaseModel):
    """프롬프트 보강 응답"""
    original: str
    enhanced: str
    negative: str


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
