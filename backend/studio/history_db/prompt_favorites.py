"""
history_db/prompt_favorites.py — prompt_favorites 테이블 CRUD.

시계 아이콘 프롬프트 히스토리의 별 즐겨찾기 전용 저장소.
저장 대상은 AI 보강 결과가 아니라 사용자가 입력한 원문 prompt 이다.
"""

from __future__ import annotations

import hashlib
import time
import uuid
from typing import Any

import aiosqlite

from . import _config as _cfg

VALID_PROMPT_FAVORITE_MODES = ("generate", "edit", "video", "compare")


def _normalize_prompt(prompt: str) -> str:
    return prompt.strip()


def _prompt_hash(prompt: str) -> str:
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()


def _make_favorite_id() -> str:
    return f"fav-{uuid.uuid4().hex[:12]}"


def _row_to_prompt_favorite(row: aiosqlite.Row) -> dict[str, Any]:
    """DB row → frontend PromptFavorite shape (camelCase)."""
    return {
        "id": row["id"],
        "mode": row["mode"],
        "prompt": row["prompt"],
        "promptHash": row["prompt_hash"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


async def list_prompt_favorites(mode: str | None = None) -> list[dict[str, Any]]:
    """프롬프트 즐겨찾기 목록 — updated_at 최신순."""
    params: list[Any] = []
    where_sql = ""
    if mode in VALID_PROMPT_FAVORITE_MODES:
        where_sql = "WHERE mode = ?"
        params.append(mode)
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            f"SELECT * FROM prompt_favorites {where_sql} "
            "ORDER BY updated_at DESC, created_at DESC",
            params,
        )
        rows = await cur.fetchall()
    return [_row_to_prompt_favorite(r) for r in rows]


async def get_prompt_favorite(favorite_id: str) -> dict[str, Any] | None:
    """단일 프롬프트 즐겨찾기 조회."""
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM prompt_favorites WHERE id = ?",
            (favorite_id,),
        )
        row = await cur.fetchone()
    return _row_to_prompt_favorite(row) if row else None


async def upsert_prompt_favorite(mode: str, prompt: str) -> dict[str, Any]:
    """mode + prompt_hash 기준으로 저장/갱신하고 저장된 row 를 반환."""
    if mode not in VALID_PROMPT_FAVORITE_MODES:
        raise ValueError(f"invalid mode: {mode}")
    clean_prompt = _normalize_prompt(prompt)
    if not clean_prompt:
        raise ValueError("prompt required")

    prompt_hash = _prompt_hash(clean_prompt)
    now = int(time.time() * 1000)
    new_id = _make_favorite_id()

    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO prompt_favorites (
                id, mode, prompt, prompt_hash, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(mode, prompt_hash) DO UPDATE SET
                prompt = excluded.prompt,
                updated_at = excluded.updated_at
            """,
            (new_id, mode, clean_prompt, prompt_hash, now, now),
        )
        await db.commit()
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM prompt_favorites WHERE mode = ? AND prompt_hash = ?",
            (mode, prompt_hash),
        )
        row = await cur.fetchone()

    if row is None:
        raise RuntimeError("prompt favorite upsert failed")
    return _row_to_prompt_favorite(row)


async def delete_prompt_favorite(favorite_id: str) -> bool:
    """id 기준 삭제. 존재하지 않으면 False."""
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            "DELETE FROM prompt_favorites WHERE id = ?",
            (favorite_id,),
        )
        await db.commit()
        return cur.rowcount > 0
