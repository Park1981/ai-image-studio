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

import json
import time
import uuid
from typing import Any

import aiosqlite

# Phase 4.1 단계 2 — DB 경로 / URL prefix / logger 단일 source 는 _config.py.
# sub-module 동일 패턴. monkeypatch · 직접 read 모두 _config attribute 사용 (alias 0건).
from . import _config as _cfg
from ._config import _POOL_URL_PREFIX, log


# Schema version — 2026-04-27 (C2-P2-3) 도입.
# 신규 마이그레이션 추가 시 + 1 + init 함수에 idempotent 적용 함수 추가.
SCHEMA_VERSION = 8


async def _get_schema_version(db: aiosqlite.Connection) -> int:
    """PRAGMA user_version 으로 현재 schema 버전 조회 (legacy DB 는 0)."""
    cur = await db.execute("PRAGMA user_version")
    row = await cur.fetchone()
    return int(row[0]) if row and row[0] is not None else 0


async def _set_schema_version(db: aiosqlite.Connection, version: int) -> None:
    """PRAGMA user_version = N 설정. 다음 init 호출 시 skip 판정에 사용."""
    # PRAGMA 는 parameterized 안 됨 — 정수만 받으므로 f-string 안전.
    await db.execute(f"PRAGMA user_version = {int(version)}")


CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS studio_history (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('generate','edit','video')),
  prompt TEXT NOT NULL,
  label TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  seed INTEGER,
  steps INTEGER,
  cfg REAL,
  lightning INTEGER,
  model TEXT,
  created_at INTEGER NOT NULL,
  image_ref TEXT NOT NULL,
  upgraded_prompt TEXT,
  upgraded_prompt_ko TEXT,
  prompt_provider TEXT,
  research_hints TEXT,
  vision_description TEXT,
  comfy_error TEXT,
  source_ref TEXT,
  comparison_analysis TEXT,
  adult INTEGER,
  duration_sec REAL,
  fps INTEGER,
  frame_count INTEGER,
  refined_intent TEXT,
  reference_ref TEXT,
  reference_role TEXT
);
"""
CREATE_IDX_CREATED = (
    "CREATE INDEX IF NOT EXISTS idx_studio_history_created "
    "ON studio_history(created_at DESC)"
)
CREATE_IDX_MODE = (
    "CREATE INDEX IF NOT EXISTS idx_studio_history_mode "
    "ON studio_history(mode, created_at DESC)"
)

# v8 (2026-04-28 라이브러리 plan): reference 이미지 영구 저장 라이브러리.
# image_ref = `/images/studio/reference-templates/<uuid>.<ext>` 영구 URL only.
# vision_description / user_intent / role_default = 저장 시 1회 비전 분석 결과.
# last_used_at = 사용자가 라이브러리에서 픽 후 수정 실행 시 갱신 (정렬 키).
CREATE_REFERENCE_TEMPLATES = """
CREATE TABLE IF NOT EXISTS reference_templates (
  id TEXT PRIMARY KEY,
  image_ref TEXT NOT NULL,
  name TEXT NOT NULL,
  vision_description TEXT,
  user_intent TEXT,
  role_default TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
"""
CREATE_IDX_REF_LASTUSED = (
    "CREATE INDEX IF NOT EXISTS idx_reference_templates_lastused "
    "ON reference_templates(last_used_at DESC)"
)


async def _needs_video_mode_migration(db: aiosqlite.Connection) -> bool:
    """기존 테이블 CHECK 제약이 'video' 를 포함하는지 sqlite_master 의
    CREATE SQL 로 확인.

    PRAGMA table_info 는 CHECK 표현식을 노출하지 않아 신뢰 못함.
    sqlite_master.sql 의 원문에서 'video' 토큰 존재 여부를 본다.
    """
    cur = await db.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='studio_history'"
    )
    row = await cur.fetchone()
    if not row or not row[0]:
        return False  # 테이블 자체 없음 → CREATE_TABLE 이 생성 (마이그레이션 불필요)
    create_sql = row[0]
    return "'video'" not in create_sql


async def _migrate_add_video_mode(db: aiosqlite.Connection) -> None:
    """CHECK 제약을 'generate'/'edit'/'video' 로 확장하는 원자적 마이그레이션.

    SQLite 는 ALTER TABLE ... DROP CHECK 를 지원하지 않아 재생성 필요.
    순서:
      1) BEGIN IMMEDIATE — write lock 확보
      2) studio_history_new (확장된 CHECK) 생성
      3) SELECT * → INSERT 로 데이터 복사
      4) DROP old + RENAME new
      5) 인덱스 재생성
      6) COMMIT
    실패 시 ROLLBACK — 기존 테이블 무손실 유지.
    """
    await db.execute("BEGIN IMMEDIATE")
    try:
        # CREATE_TABLE 상수를 재사용하되 이름만 new 로
        create_new_sql = CREATE_TABLE.replace(
            "CREATE TABLE IF NOT EXISTS studio_history",
            "CREATE TABLE studio_history_new",
        )
        await db.execute(create_new_sql)
        # 데이터 복사 — SELECT * 대신 명시적 컬럼 목록 사용.
        # CREATE_TABLE 에 컬럼이 추가되어도 구 테이블 컬럼 수와 불일치가 나지 않도록
        # 기존 19개 컬럼만 이름 지정, 신규 컬럼(source_ref/comparison_analysis)은 NULL 로 채움.
        await db.execute(
            """INSERT INTO studio_history_new
               (id, mode, prompt, label, width, height, seed, steps, cfg, lightning,
                model, created_at, image_ref, upgraded_prompt, upgraded_prompt_ko,
                prompt_provider, research_hints, vision_description, comfy_error)
               SELECT
                id, mode, prompt, label, width, height, seed, steps, cfg, lightning,
                model, created_at, image_ref, upgraded_prompt, upgraded_prompt_ko,
                prompt_provider, research_hints, vision_description, comfy_error
               FROM studio_history"""
        )
        await db.execute("DROP TABLE studio_history")
        await db.execute(
            "ALTER TABLE studio_history_new RENAME TO studio_history"
        )
        # 인덱스는 DROP TABLE 시 함께 삭제 → 재생성
        await db.execute(CREATE_IDX_CREATED)
        await db.execute(CREATE_IDX_MODE)
        await db.commit()
        log.info(
            "Migrated studio_history: CHECK 제약에 'video' 모드 추가 완료"
        )
    except Exception:
        await db.execute("ROLLBACK")
        raise


async def _migrate_create_reference_templates(db: aiosqlite.Connection) -> None:
    """v8 (2026-04-28): reference_templates 테이블 + 인덱스 (라이브러리 plan).

    CREATE IF NOT EXISTS 라 idempotent — 매번 호출해도 안전.
    """
    await db.execute(CREATE_REFERENCE_TEMPLATES)
    await db.execute(CREATE_IDX_REF_LASTUSED)
    await db.commit()


async def init_studio_history_db() -> None:
    """테이블/인덱스 생성 (idempotent) + 증분 마이그레이션.

    2026-04-27 (C2-P2-3): PRAGMA user_version 추적 도입.
    user_version = SCHEMA_VERSION 이면 마이그레이션 step 자체 skip (빠른 부팅).
    """
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        await db.execute(CREATE_TABLE)
        await db.execute(CREATE_IDX_CREATED)
        await db.execute(CREATE_IDX_MODE)
        await db.commit()

        current_version = await _get_schema_version(db)
        if current_version >= SCHEMA_VERSION:
            log.debug(
                "studio_history schema v%d 최신 — 마이그레이션 skip (PRAGMA user_version=%d)",
                SCHEMA_VERSION,
                current_version,
            )
            log.info("studio_history DB ready at %s", _cfg._DB_PATH)
            return

        log.info(
            "studio_history schema migration: v%d → v%d",
            current_version,
            SCHEMA_VERSION,
        )
        # v2 (2026-04-23): upgraded_prompt_ko 컬럼 추가 (기존 DB 마이그레이션)
        try:
            await db.execute(
                "ALTER TABLE studio_history ADD COLUMN upgraded_prompt_ko TEXT"
            )
            log.info("Migrated studio_history: added upgraded_prompt_ko column")
        except Exception:
            # 이미 존재하거나 최초 CREATE 직후면 에러 — 정상
            pass
        await db.commit()
        # v3 (2026-04-24): CHECK(mode IN ...) 에 'video' 추가
        if await _needs_video_mode_migration(db):
            await _migrate_add_video_mode(db)
    # v4 (2026-04-24): comparison 분석 영구 저장 컬럼 두 개 추가
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        for col_name in ("source_ref", "comparison_analysis"):
            try:
                await db.execute(
                    f"ALTER TABLE studio_history ADD COLUMN {col_name} TEXT"
                )
                log.info("Migrated studio_history: added %s column", col_name)
            except Exception:
                # 이미 존재하면 정상 (idempotent)
                pass
        await db.commit()
    # v5 (2026-04-24): video 전용 메타 4개 — adult(bool) / duration_sec / fps / frame_count
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        v5_cols = (
            ("adult", "INTEGER"),
            ("duration_sec", "REAL"),
            ("fps", "INTEGER"),
            ("frame_count", "INTEGER"),
        )
        for col_name, col_type in v5_cols:
            try:
                await db.execute(
                    f"ALTER TABLE studio_history ADD COLUMN {col_name} {col_type}"
                )
                log.info("Migrated studio_history: added %s column", col_name)
            except Exception:
                # 이미 존재하면 정상 (idempotent)
                pass
        await db.commit()
    # v6 (2026-04-26 spec 19 후속): refined_intent 컬럼 추가
    # Edit 한 사이클 안의 clarify_edit_intent 결과 (영문 1-2문장) 캐시.
    # 비교 분석 (compare-analyze) 이 historyItemId 받으면 이 캐시 재사용 →
    # gemma4 cold start ~5초 절약.
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        try:
            await db.execute(
                "ALTER TABLE studio_history ADD COLUMN refined_intent TEXT"
            )
            log.info("Migrated studio_history: added refined_intent column")
        except Exception:
            # 이미 존재하면 정상 (idempotent)
            pass
        await db.commit()
    # v7 (2026-04-27): Edit multi-reference — reference_ref + reference_role 두 컬럼.
    # reference_ref = Library plan 의 영구 URL only (Phase 5 단계는 항상 NULL).
    # reference_role = 사용자 명시 role (face / outfit / style / background / custom).
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        for col_name in ("reference_ref", "reference_role"):
            try:
                await db.execute(
                    f"ALTER TABLE studio_history ADD COLUMN {col_name} TEXT"
                )
                log.info("Migrated studio_history: added %s column", col_name)
            except Exception:
                # 이미 존재하면 정상 (idempotent)
                pass
        await db.commit()
    # v8 (2026-04-28 라이브러리 plan): reference_templates 테이블 + 인덱스 신규.
    # studio_history 와 별개 테이블이라 ALTER 가 아닌 CREATE.
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        await _migrate_create_reference_templates(db)
        log.info("Migrated: reference_templates 테이블 + 인덱스 생성")
        # 모든 마이그레이션 적용 후 schema version 마킹 (다음 부팅에서 skip).
        await _set_schema_version(db, SCHEMA_VERSION)
        await db.commit()
    log.info(
        "studio_history DB ready at %s (schema v%d)", _cfg._DB_PATH, SCHEMA_VERSION
    )


async def insert_item(item: dict[str, Any]) -> None:
    """생성/수정 완료 아이템 저장.

    spec 19 후속 (v6): item.get("refinedIntent") 도 함께 저장 (Edit 한 사이클의
    gemma4 정제 결과 캐시 — 비교 분석에서 재사용). generate/video 는 None.
    """
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        await db.execute(
            """INSERT OR REPLACE INTO studio_history
            (id, mode, prompt, label, width, height, seed, steps, cfg, lightning,
             model, created_at, image_ref, upgraded_prompt, upgraded_prompt_ko,
             prompt_provider, research_hints, vision_description, comfy_error,
             source_ref, comparison_analysis,
             adult, duration_sec, fps, frame_count, refined_intent,
             reference_ref, reference_role)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                item["id"],
                item["mode"],
                item["prompt"],
                item["label"],
                item.get("width"),
                item.get("height"),
                item.get("seed"),
                item.get("steps"),
                item.get("cfg"),
                1 if item.get("lightning") else 0,
                item.get("model"),
                int(item.get("createdAt", time.time() * 1000)),
                item["imageRef"],
                item.get("upgradedPrompt"),
                item.get("upgradedPromptKo"),
                item.get("promptProvider"),
                json.dumps(item.get("researchHints") or [], ensure_ascii=False),
                item.get("visionDescription"),
                item.get("comfyError"),
                item.get("sourceRef"),
                # 분석은 별도 update_comparison 으로 갱신 — insert 시점엔 항상 None
                None,
                # v5: video 전용 메타 — generate/edit 은 None
                (1 if item.get("adult") else 0) if item.get("adult") is not None else None,
                item.get("durationSec"),
                item.get("fps"),
                item.get("frameCount"),
                # v6 (spec 19 후속): refined_intent — Edit 만 채움, 나머지 None
                item.get("refinedIntent"),
                # v7 (2026-04-27): Edit multi-reference — 토글 OFF 면 둘 다 None.
                # reference_ref = Library plan 의 영구 URL (Phase 5 단계는 항상 None).
                item.get("referenceRef"),
                item.get("referenceRole"),
            ),
        )
        await db.commit()


async def list_items(
    mode: str | None = None,
    limit: int = 50,
    before_ts: int | None = None,
) -> list[dict[str, Any]]:
    """최신순 목록. before_ts 가 있으면 그보다 이전 것만 (pagination cursor)."""
    where = []
    params: list[Any] = []
    if mode in ("generate", "edit", "video"):
        where.append("mode = ?")
        params.append(mode)
    if before_ts:
        where.append("created_at < ?")
        params.append(int(before_ts))
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    sql = (
        f"SELECT * FROM studio_history {where_sql} "
        "ORDER BY created_at DESC LIMIT ?"
    )
    params.append(int(limit))

    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(sql, params)
        rows = await cur.fetchall()
    return [_row_to_item(r) for r in rows]


async def get_item(item_id: str) -> dict[str, Any] | None:
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM studio_history WHERE id = ?", (item_id,)
        )
        row = await cur.fetchone()
    return _row_to_item(row) if row else None


async def delete_item(item_id: str) -> bool:
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            "DELETE FROM studio_history WHERE id = ?", (item_id,)
        )
        await db.commit()
        return cur.rowcount > 0


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


async def update_comparison(
    item_id: str, analysis: dict[str, Any]
) -> bool:
    """비교 분석 결과를 JSON 직렬화로 저장.

    Returns:
        rowcount > 0 (해당 id 의 row 가 존재하고 갱신됐으면 True).
    """
    payload = json.dumps(analysis, ensure_ascii=False)
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            "UPDATE studio_history SET comparison_analysis = ? WHERE id = ?",
            (payload, item_id),
        )
        await db.commit()
        return cur.rowcount > 0


def _row_to_item(row: aiosqlite.Row) -> dict[str, Any]:
    """row → 프론트 HistoryItem shape."""
    hints_raw = row["research_hints"]
    try:
        hints = json.loads(hints_raw) if hints_raw else []
    except Exception:
        hints = []
    # upgraded_prompt_ko 는 ALTER 로 추가된 컬럼이라 오래된 row 에서는 없을 수 있음
    try:
        upgraded_ko = row["upgraded_prompt_ko"]
    except (IndexError, KeyError):
        upgraded_ko = None
    # v4 컬럼 (source_ref, comparison_analysis) — 마이그레이션 전 row 호환
    try:
        source_ref = row["source_ref"]
    except (IndexError, KeyError):
        source_ref = None
    try:
        comp_raw = row["comparison_analysis"]
        comp_obj = json.loads(comp_raw) if comp_raw else None
    except (IndexError, KeyError, json.JSONDecodeError):
        comp_obj = None

    # v5 컬럼 (video 전용 — adult/duration_sec/fps/frame_count) — 마이그레이션 전 row 호환
    def _safe(name: str) -> Any:
        try:
            return row[name]
        except (IndexError, KeyError):
            return None

    adult_raw = _safe("adult")
    duration_sec = _safe("duration_sec")
    fps = _safe("fps")
    frame_count = _safe("frame_count")
    # v6 (spec 19 후속) — refined_intent (Edit 모드만 채워짐 · 옛 row 는 None)
    refined_intent = _safe("refined_intent")
    # v7 (2026-04-27) — multi-reference (Edit 모드만 채워짐 · 옛 row + generate/video 는 None)
    reference_ref = _safe("reference_ref")
    reference_role = _safe("reference_role")

    item: dict[str, Any] = {
        "id": row["id"],
        "mode": row["mode"],
        "prompt": row["prompt"],
        "label": row["label"],
        "width": row["width"],
        "height": row["height"],
        "seed": row["seed"],
        "steps": row["steps"],
        "cfg": row["cfg"],
        "lightning": bool(row["lightning"]),
        "model": row["model"],
        "createdAt": row["created_at"],
        "imageRef": row["image_ref"],
        "upgradedPrompt": row["upgraded_prompt"],
        "upgradedPromptKo": upgraded_ko,
        "promptProvider": row["prompt_provider"],
        "researchHints": hints,
        "visionDescription": row["vision_description"],
        "comfyError": row["comfy_error"],
        "sourceRef": source_ref,
        "comparisonAnalysis": comp_obj,
    }
    # v5 video 전용 메타는 값이 있을 때만 노출 (generate/edit 은 undefined 유지)
    if adult_raw is not None:
        item["adult"] = bool(adult_raw)
    if duration_sec is not None:
        item["durationSec"] = duration_sec
    if fps is not None:
        item["fps"] = fps
    if frame_count is not None:
        item["frameCount"] = frame_count
    # v6 refined_intent — Edit 모드만 채움 (옛 row + generate/video 는 노출 안함)
    if refined_intent:
        item["refinedIntent"] = refined_intent
    # v7 multi-reference — Edit 모드 multi-ref ON 케이스만 채움 (옛 row 는 노출 안함).
    # camelCase 로 — frontend HistoryItem 타입과 일관.
    if reference_ref is not None:
        item["referenceRef"] = reference_ref
    if reference_role is not None:
        item["referenceRole"] = reference_role
    return item


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
