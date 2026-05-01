"""
studio.routes.prompt — upgrade-only + research + interrupt (sync).

upgrade-only: 사용자 모달 표시용 사전 업그레이드 (ComfyUI 미호출)
research: Claude CLI 조사 힌트
interrupt: 현재 ComfyUI job 즉시 중단 (전역)

task #17 (2026-04-26): router.py 풀 분해 2탄.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .._gpu_lock import GpuBusyError, gpu_slot
from .._lib_marker import strip_library_markers
from ..claude_cli import research_prompt
from ..comfy_api_builder import _snap_dimension
from ..comfy_transport import ComfyUITransport
from ..presets import DEFAULT_OLLAMA_ROLES, GENERATE_MODEL, get_aspect
from ..prompt_pipeline import (
    split_prompt_cards,
    translate_prompt,
    upgrade_generate_prompt,
)
from ..schemas import ResearchBody, UpgradeOnlyBody
from ._common import log

router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════
# Phase 5 (2026-05-01) — 프롬프트 분리 + 양방향 번역 엔드포인트.
# spec §5.6 — POST /api/studio/prompt/split + POST /api/studio/prompt/translate.
# ═══════════════════════════════════════════════════════════════════════


class PromptSplitBody(BaseModel):
    prompt: str = Field(..., min_length=1)
    ollama_model: str | None = Field(default=None, alias="ollamaModel")

    model_config = ConfigDict(populate_by_name=True)


class PromptTranslateBody(BaseModel):
    prompt: str = Field(..., min_length=1)
    # "ko" = 영→한, "en" = 한→영. 잘못된 값은 422 (Pydantic 기본).
    direction: Literal["ko", "en"]
    ollama_model: str | None = Field(default=None, alias="ollamaModel")

    model_config = ConfigDict(populate_by_name=True)


@router.post("/upgrade-only")
async def upgrade_only(body: UpgradeOnlyBody):
    """프롬프트 업그레이드 전용 (ComfyUI 미호출).

    showUpgradeStep 프리퍼런스 ON 일 때 프론트가 호출 → 모달에서 사용자 확인 →
    /generate 로 preUpgradedPrompt 와 함께 재요청.

    spec 19 후속 (Codex 추가 fix): aspect/width/height 도 SYSTEM_GENERATE 에
    전달 → /generate 본 호출과 동일한 size context 보장.
    """
    research_hints: list[str] = []
    if body.research:
        research = await research_prompt(body.prompt, GENERATE_MODEL.display_name)
        if research.ok:
            research_hints = research.hints

    # spec 19 후속 — generate pipeline 과 동일한 resolved_w/h 계산.
    # 사용자가 width/height 직접 지정했으면 snap, 아니면 aspect preset 사용.
    aspect = get_aspect(body.aspect)
    if body.width is not None and body.height is not None:
        resolved_w = _snap_dimension(body.width)
        resolved_h = _snap_dimension(body.height)
    else:
        resolved_w = aspect.width
        resolved_h = aspect.height

    try:
        async with gpu_slot("upgrade-only"):
            upgrade = await upgrade_generate_prompt(
                prompt=body.prompt,
                model=body.ollama_model or DEFAULT_OLLAMA_ROLES.text,
                research_context="\n".join(research_hints) if research_hints else None,
                width=resolved_w,
                height=resolved_h,
                # Phase 2 (2026-05-01) — 사용자가 모달 띄우기 전 [정밀] 토글한 경우 전파
                prompt_mode=body.prompt_mode or "fast",
            )
    except GpuBusyError as e:
        raise HTTPException(503, str(e)) from e

    # Codex v3 #2 (위치 3): /upgrade-only 응답의 upgradedPrompt 도 strip — 모달
    # 표시 + 프론트 textarea pre-fill 시 마커 잔존 방지 (위치 1 이중 안전망).
    return {
        "upgradedPrompt": strip_library_markers(upgrade.upgraded),
        "upgradedPromptKo": upgrade.translation,
        "provider": upgrade.provider,
        "fallback": upgrade.fallback,
        "researchHints": research_hints,
    }


@router.post("/prompt/split")
async def prompt_split(body: PromptSplitBody) -> dict:
    """긴 프롬프트 → 의미 카드 (sections 배열).

    Phase 5 (2026-05-01) — spec §5.6.

    UI 가 카드 형태로 노출. 원본 textarea 는 자동 덮어쓰지 않음 (spec §11 비목표).
    응답 shape: { sections: [{key, text}], provider, fallback, error?, raw? }
    """
    try:
        async with gpu_slot("prompt-split"):
            result = await split_prompt_cards(
                prompt=body.prompt,
                model=body.ollama_model or DEFAULT_OLLAMA_ROLES.text,
            )
    except GpuBusyError as e:
        raise HTTPException(503, str(e)) from e

    return {
        "sections": [s.to_dict() for s in result.sections],
        "provider": result.provider,
        "fallback": result.fallback,
        "error": result.error,
        # raw 는 디버그 용 — UI 에는 표시 안 하지만 fallback 시 진단에 유용.
        # 길이 cap (16KB) — 모델이 폭주해도 응답 크기 안전망.
        "raw": (result.raw or "")[:16384],
    }


@router.post("/prompt/translate")
async def prompt_translate(body: PromptTranslateBody) -> dict:
    """프롬프트 한↔영 양방향 번역.

    Phase 5 (2026-05-01) — spec §4.4 / §5.6.

    direction:
      - "ko" — 영문 → 한국어
      - "en" — 한국어 → 영문 (Stable Diffusion / Qwen 호환)

    LoRA / weight / negative 등 특수 토큰은 SYSTEM 프롬프트가 보존 강제.
    실패 시 translated=원문 + fallback=true (UI 가 그대로 표시).
    """
    try:
        async with gpu_slot("prompt-translate"):
            result = await translate_prompt(
                text=body.prompt,
                direction=body.direction,
                model=body.ollama_model or DEFAULT_OLLAMA_ROLES.text,
            )
    except GpuBusyError as e:
        raise HTTPException(503, str(e)) from e

    return {
        "translated": result.translated,
        "provider": result.provider,
        "fallback": result.fallback,
        "direction": result.direction,
        "error": result.error,
    }


@router.post("/research")
async def research(body: ResearchBody):
    res = await research_prompt(body.prompt, body.model)
    return {
        "ok": res.ok,
        "hints": res.hints,
        "error": res.error,
    }


@router.post("/interrupt")
async def interrupt_current():
    """현재 실행 중인 ComfyUI job 인터럽트 (전역). ComfyUI 는 client_id 관계없이 즉시 중단."""
    try:
        async with ComfyUITransport() as comfy:
            await comfy.interrupt()
        return {"ok": True, "message": "interrupted"}
    except Exception as e:
        log.warning("interrupt failed: %s", e)
        raise HTTPException(500, f"interrupt failed: {e}") from e
