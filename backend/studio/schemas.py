"""Studio API request/response Pydantic 모델 (router.py 분해 · task #10 · 2026-04-26).

router.py 의 GenerateBody / UpgradeOnlyBody / ResearchBody / ProcessAction / TaskCreated /
ComfyDispatchResult 등을 별도 모듈로 추출.

router.py 가 이 모듈에서 동일 이름으로 re-import. behavior 무변경.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from .presets import GENERATE_MODEL


class GenerateBody(BaseModel):
    prompt: str = Field(..., min_length=1)
    aspect: str = "1:1"
    # 사용자가 직접 픽셀 지정한 경우 (둘 다 주어져야 사용됨, 아니면 aspect 프리셋 사용)
    # 8의 배수 + 256~2048 범위 제약은 comfy_api_builder 에서 최종 clamp.
    width: int | None = Field(default=None, ge=256, le=2048)
    height: int | None = Field(default=None, ge=256, le=2048)
    steps: int = GENERATE_MODEL.defaults.steps
    cfg: float = GENERATE_MODEL.defaults.cfg
    seed: int = GENERATE_MODEL.defaults.seed
    lightning: bool = False
    research: bool = False
    # 설정에서 override 가능 (None 이면 프리셋 기본값)
    ollama_model: str | None = Field(default=None, alias="ollamaModel")
    vision_model: str | None = Field(default=None, alias="visionModel")
    # 사용자가 "업그레이드 확인" 모달에서 미리 확정한 프롬프트
    # (있으면 gemma4 upgrade 단계 생략)
    pre_upgraded_prompt: str | None = Field(
        default=None, alias="preUpgradedPrompt"
    )
    # 업그레이드 모달에서 이미 Claude 조사를 수행한 경우 힌트를 전달해서
    # 백엔드가 조사를 재실행하지 않게 한다. None 이면 평소처럼 research 플래그대로 동작.
    # 빈 배열 [] 도 "조사 완료 (힌트 없음)" 으로 간주해 재호출 안 함.
    pre_research_hints: list[str] | None = Field(
        default=None, alias="preResearchHints"
    )
    # 스타일 LoRA 토글 (2026-04-25) — None / "asian_influencer" 등 GENERATE_STYLES.id
    # 활성 시 sampling 파라미터 자동 override + Lightning 강제 OFF + LoRA 체인 추가
    style_id: str | None = Field(default=None, alias="styleId")

    # Pydantic V2: class-based Config 대신 model_config = ConfigDict(...)
    model_config = ConfigDict(populate_by_name=True)


class UpgradeOnlyBody(BaseModel):
    """gemma4 업그레이드 + 선택적 조사만 수행 · ComfyUI 디스패치 없음.

    spec 19 후속 (Codex 추가 fix): aspect/width/height 도 받아서 SYSTEM_GENERATE
    의 [Output dimensions] 컨텍스트에 정확한 dim 주입.
    GenerateBody 와 동일 필드 (옵셔널 · 미전달 시 aspect preset 폴백).
    """

    prompt: str = Field(..., min_length=1)
    research: bool = False
    ollama_model: str | None = Field(default=None, alias="ollamaModel")
    # spec 19 후속 — aspect 컨텍스트 (옵셔널)
    aspect: str = "1:1"
    width: int | None = Field(default=None, ge=256, le=2048)
    height: int | None = Field(default=None, ge=256, le=2048)

    model_config = ConfigDict(populate_by_name=True)


class ResearchBody(BaseModel):
    prompt: str
    model: str = GENERATE_MODEL.display_name


class ProcessAction(BaseModel):
    ok: bool
    message: str | None = None


class TaskCreated(BaseModel):
    task_id: str
    stream_url: str
