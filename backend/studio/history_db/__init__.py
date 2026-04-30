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
from ._config import _POOL_URL_PREFIX, log

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


async def delete_item_with_refs(
    item_id: str,
) -> tuple[bool, str | None, str | None]:
    """item 삭제 + 삭제된 row 의 (source_ref, image_ref) 동시 반환.

    audit P1b: DELETE /history/{id} 에서 orphan 파일 정리용으로
    source_ref 를 알아야 함. race condition 없이 DB 내부에서 원자적으로
    조회→삭제 수행 (같은 커넥션으로 순차 실행).

    v9 (2026-04-29 · Codex I2): reference_ref 가 임시 풀 URL 이고 다른 row 가
    참조하지 않으면 임시 풀 파일도 함께 unlink (cascade). 반환 시그니처는 그대로 —
    호출자 (routes/system.py) 영향 0.

    Returns:
        (deleted, source_ref, image_ref). deleted=False 면 나머지는 None.
    """
    pool_ref_to_unlink: str | None = None
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT source_ref, image_ref, reference_ref FROM studio_history WHERE id = ?",
            (item_id,),
        )
        row = await cur.fetchone()
        if row is None:
            return (False, None, None)
        source_ref = row["source_ref"]
        image_ref = row["image_ref"]
        reference_ref = row["reference_ref"]
        cur = await db.execute(
            "DELETE FROM studio_history WHERE id = ?", (item_id,)
        )
        await db.commit()
        deleted = cur.rowcount > 0

        # v9 cascade — 임시 풀 ref 면 마지막 참조 시 unlink 결정
        if (
            deleted
            and reference_ref
            and reference_ref.startswith(_POOL_URL_PREFIX)
        ):
            cur = await db.execute(
                "SELECT 1 FROM studio_history WHERE reference_ref = ? LIMIT 1",
                (reference_ref,),
            )
            shared = await cur.fetchone()
            if shared is None:
                pool_ref_to_unlink = reference_ref

    # DB 트랜잭션 끝난 뒤 unlink (안에서 file IO 부담 안 주기 위해)
    if pool_ref_to_unlink:
        await _safe_pool_unlink(pool_ref_to_unlink)

    return (deleted, source_ref, image_ref)


async def clear_all() -> int:
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute("DELETE FROM studio_history")
        await db.commit()
        return cur.rowcount


async def clear_all_with_refs() -> tuple[int, list[str], list[str]]:
    """전체 삭제 + 삭제된 모든 row 의 (source_refs, image_refs) 반환.

    audit P1b: edit-source/*.png orphan 파일 일괄 정리용.

    v9 (2026-04-29 · Codex I2): 삭제된 row 의 reference_ref 중 임시 풀 URL 인 것 모두
    cascade unlink. 반환 시그니처는 그대로 — 호출자 (routes/system.py:291) 영향 0.

    Returns:
        (deleted_count, source_refs, image_refs). refs 리스트는 NULL 제외.
    """
    pool_refs_to_unlink: list[str] = []
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT source_ref, image_ref, reference_ref FROM studio_history"
        )
        rows = await cur.fetchall()
        source_refs = [r["source_ref"] for r in rows if r["source_ref"]]
        image_refs = [r["image_ref"] for r in rows if r["image_ref"]]
        # v9 cascade — distinct 임시 풀 ref 만 (중복 unlink 방지)
        pool_refs_to_unlink = list(
            {
                r["reference_ref"]
                for r in rows
                if r["reference_ref"]
                and r["reference_ref"].startswith(_POOL_URL_PREFIX)
            }
        )
        cur = await db.execute("DELETE FROM studio_history")
        await db.commit()
        deleted_count = cur.rowcount

    # DB 트랜잭션 끝난 뒤 unlink
    for ref in pool_refs_to_unlink:
        await _safe_pool_unlink(ref)

    return (deleted_count, source_refs, image_refs)


# ─────────────────────────────────────────────
# v9 — 임시 풀 cascade helpers (Codex C3 + I2)
# ─────────────────────────────────────────────


async def _safe_pool_unlink(rel_url: str) -> None:
    """임시 풀 ref 안전 unlink. 순환 import 회피 위해 lazy import.

    실패 (path 검증 실패 / 파일 IO 에러) 는 silent — 로그만 남김.
    """
    try:
        from ..reference_pool import delete_pool_ref

        await delete_pool_ref(rel_url)
    except ValueError as e:
        log.warning("pool cascade unlink unsafe path: %s — %s", rel_url, e)
    except Exception as e:  # noqa: BLE001
        log.warning("pool cascade unlink failed: %s — %s", rel_url, e)


async def count_pool_refs() -> int:
    """studio_history 중 임시 풀 prefix 로 시작하는 reference_ref 보유 row 개수."""
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM studio_history WHERE reference_ref LIKE ?",
            (_POOL_URL_PREFIX + "%",),
        )
        row = await cur.fetchone()
        return int(row[0]) if row else 0


async def list_history_pool_refs() -> set[str]:
    """studio_history 의 임시 풀 reference_ref 모두 set 반환 (orphan 검출용)."""
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            "SELECT DISTINCT reference_ref FROM studio_history WHERE reference_ref LIKE ?",
            (_POOL_URL_PREFIX + "%",),
        )
        rows = await cur.fetchall()
        return {r[0] for r in rows if r[0]}


async def count_source_ref_usage(source_ref: str) -> int:
    """특정 source_ref 를 참조하는 row 개수.

    같은 원본에서 여러 수정을 만드는 경우가 있으므로
    파일 삭제 전에 0건인지 확인해야 안전 (다른 row 가 같은 원본 쓸 수 있음).
    """
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM studio_history WHERE source_ref = ?",
            (source_ref,),
        )
        row = await cur.fetchone()
        return int(row[0]) if row else 0


async def count_image_ref_usage(image_ref: str) -> int:
    """특정 image_ref 를 참조하는 row 개수 (audit R1-6 · result cleanup 용).

    image_ref 는 본래 1:1 매핑이지만, 히스토리 복제/재수정 흐름에서
    중복 참조 가능성이 있으므로 삭제 전 안전 체크.
    """
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM studio_history WHERE image_ref = ?",
            (image_ref,),
        )
        row = await cur.fetchone()
        return int(row[0]) if row else 0


_VALID_MODES = ("generate", "edit", "video")


async def count_items(mode: str | None = None) -> int:
    where_sql = "WHERE mode = ?" if mode in _VALID_MODES else ""
    params = [mode] if mode in _VALID_MODES else []
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            f"SELECT COUNT(*) FROM studio_history {where_sql}", params
        )
        row = await cur.fetchone()
    return int(row[0]) if row else 0


async def get_stats() -> dict[str, Any]:
    """히스토리 통계 — count / total_size_bytes / by_mode + db_size_bytes.

    각 image_ref 를 실 파일 경로로 변환 후 stat 으로 사이즈 측정.
    파일 누락 (orphan history row) 케이스는 size 0 처리 (count 만 누적).
    """
    # 지연 import — storage 가 history_db 를 import 하면 순환. storage._result_path_from_url
    # 자체는 stateless 라 함수 내부 import 안전.
    import os

    from ..storage import _result_path_from_url  # noqa: WPS433

    by_mode: dict[str, dict[str, int]] = {
        "generate": {"count": 0, "size_bytes": 0},
        "edit": {"count": 0, "size_bytes": 0},
        "video": {"count": 0, "size_bytes": 0},
    }

    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            "SELECT mode, image_ref FROM studio_history"
        )
        rows = await cur.fetchall()

    for row in rows:
        mode = row[0]
        image_ref = row[1]
        if mode not in by_mode:
            continue
        by_mode[mode]["count"] += 1
        if not image_ref:
            continue
        path = _result_path_from_url(image_ref)
        if path is None:
            continue
        try:
            by_mode[mode]["size_bytes"] += os.path.getsize(path)
        except OSError:
            # 파일 누락 / 권한 등 — count 만 살아있음
            pass

    total_count = sum(m["count"] for m in by_mode.values())
    total_size = sum(m["size_bytes"] for m in by_mode.values())

    # DB 파일 자체 크기 (sqlite-wal 등 부가 파일은 제외 — 메인 DB 만)
    db_size = 0
    try:
        db_size = os.path.getsize(_cfg._DB_PATH)
    except OSError:
        pass

    return {
        "count": total_count,
        "total_size_bytes": total_size,
        "db_size_bytes": db_size,
        "by_mode": by_mode,
    }


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
