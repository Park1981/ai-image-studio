"""
history_db.py - studio_history 테이블 (SQLite · aiosqlite).

프론트 HistoryItem 과 1:1 대응. 레거시 `generations` 테이블과 분리.
같은 DB 파일(settings.history_db_path)에 테이블만 별개로 추가.

Schema version (2026-04-27 · C2-P2-3 도입):
    SCHEMA_VERSION = 현재 6.
    PRAGMA user_version 으로 추적 — SQLite 빌트인 (별도 schema_version 테이블 불필요).

    버전 이력:
      v2 (2026-04-23) — upgraded_prompt_ko 컬럼
      v3 (2026-04-24) — CHECK(mode) 에 'video' 추가 (테이블 재생성)
      v4 (2026-04-24) — source_ref + comparison_analysis 컬럼
      v5 (2026-04-24) — video 메타 4개 (adult/duration_sec/fps/frame_count)
      v6 (2026-04-26) — refined_intent (Edit 한 사이클 gemma4 정제 캐시)

    신규 버전 추가 정책:
      1) 컬럼 추가 (`ALTER TABLE ... ADD COLUMN ...`) — try/except 로 idempotent.
      2) 또는 테이블 재생성 (CHECK 제약 변경 등) — _migrate_add_video_mode 패턴.
      3) SCHEMA_VERSION 상수 + 1.
      4) init_studio_history_db() 가 모든 마이그레이션 실행 후 PRAGMA user_version 갱신.
      5) 다음 실행에서 user_version=SCHEMA_VERSION 이면 마이그레이션 자체 skip
         (성능 — 빈 ALTER 도 매번 실행 안 함).

    legacy DB (user_version=0) 호환: 모든 마이그레이션이 idempotent 라 안전 재실행.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

import aiosqlite

# Phase 4.1 단계 2 — DB 경로 / URL prefix / logger 단일 source 는 _config.py.
# sub-module 동일 패턴. monkeypatch · 직접 read 모두 _config attribute 사용 (alias 0건).
from . import _config as _cfg

# Phase 4.1 단계 3.1 — schema 그룹 분리. facade re-export (외부 호환).
from .schema import (  # noqa: F401
    CREATE_IDX_CREATED,
    CREATE_IDX_MODE,
    CREATE_IDX_REF_LASTUSED,
    CREATE_REFERENCE_TEMPLATES,
    CREATE_TABLE,
    SCHEMA_VERSION,
    _get_schema_version,
    _migrate_add_video_mode,
    _migrate_create_reference_templates,
    _needs_video_mode_migration,
    _set_schema_version,
    init_studio_history_db,
)

# Phase 4.1 단계 3.2 — items 그룹 분리. facade re-export.
from .items import (  # noqa: F401
    _row_to_item,
    delete_item,
    get_item,
    insert_item,
    list_items,
    update_comparison,
)

# Phase 4.1 단계 3.3 — cascade 그룹 분리. facade re-export.
from .cascade import (  # noqa: F401
    _safe_pool_unlink,
    clear_all,
    clear_all_with_refs,
    count_image_ref_usage,
    count_pool_refs,
    count_source_ref_usage,
    delete_item_with_refs,
    list_history_pool_refs,
)

# Phase 4.1 단계 3.4 — stats 그룹 분리. facade re-export.
from .stats import (  # noqa: F401
    count_items,
    get_stats,
)


# ─────────────────────────────────────────────
# v8 (2026-04-28 라이브러리 plan): reference_templates CRUD
# ─────────────────────────────────────────────


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
