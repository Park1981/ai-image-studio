"""
history_db.py - studio_history 테이블 (SQLite · aiosqlite).

프론트 HistoryItem 과 1:1 대응. 레거시 `generations` 테이블과 분리.
같은 DB 파일(settings.history_db_path)에 테이블만 별개로 추가.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

import aiosqlite

try:
    from config import settings  # type: ignore

    _DB_PATH = settings.history_db_path
except Exception:
    _DB_PATH = "./data/history.db"


log = logging.getLogger(__name__)


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
  comparison_analysis TEXT
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


async def init_studio_history_db() -> None:
    """테이블/인덱스 생성 (idempotent) + 증분 마이그레이션."""
    async with aiosqlite.connect(_DB_PATH) as db:
        await db.execute(CREATE_TABLE)
        await db.execute(CREATE_IDX_CREATED)
        await db.execute(CREATE_IDX_MODE)
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
    async with aiosqlite.connect(_DB_PATH) as db:
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
    log.info("studio_history DB ready at %s", _DB_PATH)


async def insert_item(item: dict[str, Any]) -> None:
    """생성/수정 완료 아이템 저장."""
    async with aiosqlite.connect(_DB_PATH) as db:
        await db.execute(
            """INSERT OR REPLACE INTO studio_history
            (id, mode, prompt, label, width, height, seed, steps, cfg, lightning,
             model, created_at, image_ref, upgraded_prompt, upgraded_prompt_ko,
             prompt_provider, research_hints, vision_description, comfy_error)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
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

    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(sql, params)
        rows = await cur.fetchall()
    return [_row_to_item(r) for r in rows]


async def get_item(item_id: str) -> dict[str, Any] | None:
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM studio_history WHERE id = ?", (item_id,)
        )
        row = await cur.fetchone()
    return _row_to_item(row) if row else None


async def delete_item(item_id: str) -> bool:
    async with aiosqlite.connect(_DB_PATH) as db:
        cur = await db.execute(
            "DELETE FROM studio_history WHERE id = ?", (item_id,)
        )
        await db.commit()
        return cur.rowcount > 0


async def clear_all() -> int:
    async with aiosqlite.connect(_DB_PATH) as db:
        cur = await db.execute("DELETE FROM studio_history")
        await db.commit()
        return cur.rowcount


_VALID_MODES = ("generate", "edit", "video")


async def count_items(mode: str | None = None) -> int:
    where_sql = "WHERE mode = ?" if mode in _VALID_MODES else ""
    params = [mode] if mode in _VALID_MODES else []
    async with aiosqlite.connect(_DB_PATH) as db:
        cur = await db.execute(
            f"SELECT COUNT(*) FROM studio_history {where_sql}", params
        )
        row = await cur.fetchone()
    return int(row[0]) if row else 0


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
    return {
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
    }
