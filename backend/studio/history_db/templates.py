"""
history_db/templates.py — reference_templates 테이블 CRUD (Phase 4.1 단계 3.5).

v8 (2026-04-28 라이브러리 plan) 도입. 영구 저장된 reference 이미지의 메타데이터
(image_ref / name / vision_description / user_intent / role_default / last_used_at)
를 관리. 사용자가 라이브러리에서 reference 를 선택해 수정 실행 시 last_used_at
갱신 (touch_reference_template) → 정렬 키 갱신.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

import aiosqlite

from . import _config as _cfg


def _row_to_reference_template(row: aiosqlite.Row) -> dict[str, Any]:
    """DB row → frontend ReferenceTemplate shape (camelCase)."""
    return {
        "id": row["id"],
        "imageRef": row["image_ref"],
        "name": row["name"],
        "visionDescription": row["vision_description"],
        "userIntent": row["user_intent"],
        "roleDefault": row["role_default"],
        "createdAt": row["created_at"],
        "lastUsedAt": row["last_used_at"],
    }


async def list_reference_templates() -> list[dict[str, Any]]:
    """저장된 reference templates 목록 — last_used_at 내림차순 (최근 사용 먼저).

    NULL last_used_at 은 0 으로 치환해 created_at DESC 로 fallback.
    """
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM reference_templates "
            "ORDER BY COALESCE(last_used_at, 0) DESC, created_at DESC"
        )
        rows = await cur.fetchall()
    return [_row_to_reference_template(r) for r in rows]


async def get_reference_template(template_id: str) -> dict[str, Any] | None:
    """단일 reference template 조회 — backend 가 referenceTemplateId 를 신뢰 근거로 사용.

    Codex 3차 리뷰 fix: 클라이언트의 정규화된 absolute referenceRef 를 DB 저장 근거로
    쓰지 않고, template id 로 DB 의 상대 image_ref 를 다시 조회한다.
    """
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM reference_templates WHERE id = ?",
            (template_id,),
        )
        row = await cur.fetchone()
    return _row_to_reference_template(row) if row else None


async def insert_reference_template(item: dict[str, Any]) -> str:
    """새 template 저장 — image_ref 는 호출 측에서 이미 영구 저장된 URL.

    Returns: 신규 id (tpl-<uuid8>).
    """
    new_id = item.get("id") or f"tpl-{uuid.uuid4().hex[:8]}"
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO reference_templates (
                id, image_ref, name, vision_description, user_intent,
                role_default, created_at, last_used_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id,
                item["imageRef"],
                item["name"],
                item.get("visionDescription"),
                item.get("userIntent"),
                item.get("roleDefault"),
                int(time.time() * 1000),
                None,
            ),
        )
        await db.commit()
    return new_id


async def delete_reference_template(template_id: str) -> tuple[bool, str | None]:
    """삭제 + 해당 image_ref 반환 (orphan 파일 정리용).

    Returns: (deleted, image_ref). deleted=False 면 image_ref 도 None.
    """
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT image_ref FROM reference_templates WHERE id = ?",
            (template_id,),
        )
        row = await cur.fetchone()
        if row is None:
            return (False, None)
        image_ref = row["image_ref"]
        del_cur = await db.execute(
            "DELETE FROM reference_templates WHERE id = ?", (template_id,)
        )
        await db.commit()
        return (del_cur.rowcount > 0, image_ref)


async def touch_reference_template(template_id: str) -> bool:
    """last_used_at 갱신 — 사용자가 이 템플릿으로 수정 실행 시 호출."""
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            "UPDATE reference_templates SET last_used_at = ? WHERE id = ?",
            (int(time.time() * 1000), template_id),
        )
        await db.commit()
        return cur.rowcount > 0
