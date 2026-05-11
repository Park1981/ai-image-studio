"""
history_db/schema.py — DDL + 증분 마이그레이션 (Phase 4.1 단계 3.1).

studio_history + reference_templates 두 테이블의 CREATE/ALTER 와
PRAGMA user_version 기반 마이그레이션 진입점 (`init_studio_history_db`).

Schema version (2026-04-27 · C2-P2-3 도입):
    SCHEMA_VERSION = 9 (현재).
    PRAGMA user_version 으로 추적 — SQLite 빌트인 (별도 schema_version 테이블 불필요).

    버전 이력:
      v2 (2026-04-23) — upgraded_prompt_ko 컬럼
      v3 (2026-04-24) — CHECK(mode) 에 'video' 추가 (테이블 재생성)
      v4 (2026-04-24) — source_ref + comparison_analysis 컬럼
      v5 (2026-04-24) — video 메타 4개 (adult/duration_sec/fps/frame_count)
      v6 (2026-04-26) — refined_intent (Edit 한 사이클 gemma4 정제 캐시)
      v7 (2026-04-27) — reference_ref + reference_role (Edit multi-reference)
      v8 (2026-04-28) — reference_templates 테이블 + 인덱스 (라이브러리 plan)
      v9 (2026-05-11) — prompt_favorites 테이블 + 인덱스

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

import aiosqlite

from . import _config as _cfg
from ._config import log


# Schema version — 2026-04-27 (C2-P2-3) 도입.
# 신규 마이그레이션 추가 시 + 1 + init 함수에 idempotent 적용 함수 추가.
SCHEMA_VERSION = 9


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

# v9 (2026-05-11): 시계 아이콘 프롬프트 히스토리용 즐겨찾기.
# studio_history 는 "실행 결과" 보관이고, prompt_favorites 는 "재사용할 사용자 원문"
# 보관이라 별도 테이블로 둔다. compare 는 결과 history 에 없지만 prompt picker mode 로 존재.
CREATE_PROMPT_FAVORITES = """
CREATE TABLE IF NOT EXISTS prompt_favorites (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('generate','edit','video','compare')),
  prompt TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(mode, prompt_hash)
);
"""
CREATE_IDX_PROMPT_FAVORITES_MODE = (
    "CREATE INDEX IF NOT EXISTS idx_prompt_favorites_mode "
    "ON prompt_favorites(mode, updated_at DESC)"
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


async def _migrate_create_prompt_favorites(db: aiosqlite.Connection) -> None:
    """v9 (2026-05-11): prompt_favorites 테이블 + 인덱스.

    CREATE IF NOT EXISTS 라 idempotent — current_version 이 이미 최신이어도
    init 경로에서 실행해 누락 테이블을 보완할 수 있다.
    """
    await db.execute(CREATE_PROMPT_FAVORITES)
    await db.execute(CREATE_IDX_PROMPT_FAVORITES_MODE)
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
        await _migrate_create_prompt_favorites(db)
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
    # v9 (2026-05-11): prompt_favorites 테이블 + 인덱스 신규.
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        await _migrate_create_prompt_favorites(db)
        log.info("Migrated: prompt_favorites 테이블 + 인덱스 생성")
        # 모든 마이그레이션 적용 후 schema version 마킹 (다음 부팅에서 skip).
        await _set_schema_version(db, SCHEMA_VERSION)
        await db.commit()
    log.info(
        "studio_history DB ready at %s (schema v%d)", _cfg._DB_PATH, SCHEMA_VERSION
    )
