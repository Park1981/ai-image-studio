"""
studio.routes.prompt_favorites — prompt history 즐겨찾기 CRUD.

엔드포인트 (prefix=/api/studio):
  - GET    /prompt-favorites             — 전체 또는 mode별 목록
  - POST   /prompt-favorites             — mode + 사용자 원문 prompt 저장(upsert)
  - DELETE /prompt-favorites/{favorite_id} — 즐겨찾기 해제
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import history_db

router = APIRouter()


class PromptFavoriteBody(BaseModel):
    mode: str = Field(..., min_length=1)
    prompt: str = Field(..., min_length=1)


@router.get("/prompt-favorites")
async def list_prompt_favorites(mode: str | None = None):
    """프롬프트 즐겨찾기 목록 — updated_at 최신순."""
    safe_mode = (
        mode if mode in history_db.VALID_PROMPT_FAVORITE_MODES else None
    )
    items = await history_db.list_prompt_favorites(safe_mode)
    return {"items": items}


@router.post("/prompt-favorites")
async def create_prompt_favorite(body: PromptFavoriteBody):
    """사용자 원문 prompt 를 즐겨찾기에 저장. 같은 mode+prompt 는 갱신."""
    try:
        item = await history_db.upsert_prompt_favorite(body.mode, body.prompt)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"item": item}


@router.delete("/prompt-favorites/{favorite_id}")
async def delete_prompt_favorite(favorite_id: str):
    """프롬프트 즐겨찾기 해제."""
    ok = await history_db.delete_prompt_favorite(favorite_id)
    if not ok:
        raise HTTPException(404, "favorite not found")
    return {"ok": True}
