"""
studio.routes.prompt — upgrade-only + research + interrupt (sync).

upgrade-only: 사용자 모달 표시용 사전 업그레이드 (ComfyUI 미호출)
research: Claude CLI 조사 힌트
interrupt: 현재 ComfyUI job 즉시 중단 (전역)

task #17 (2026-04-26): router.py 풀 분해 2탄.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .._gpu_lock import GpuBusyError, gpu_slot
from .._lib_marker import strip_library_markers
from ..claude_cli import research_prompt
from ..comfy_api_builder import _snap_dimension
from ..comfy_transport import ComfyUITransport
from ..presets import DEFAULT_OLLAMA_ROLES, GENERATE_MODEL, get_aspect
from ..prompt_pipeline import upgrade_generate_prompt
from ..schemas import ResearchBody, UpgradeOnlyBody
from ._common import log

router = APIRouter()


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
