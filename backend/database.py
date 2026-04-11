"""
SQLite 히스토리 데이터베이스
aiosqlite 비동기 접근
"""

import aiosqlite

from config import settings

# DB 스키마 (Phase 3에서 완전 구현)
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    enhanced_prompt TEXT,
    negative_prompt TEXT,
    checkpoint TEXT NOT NULL DEFAULT '',
    loras TEXT DEFAULT '[]',
    sampler TEXT NOT NULL DEFAULT 'dpmpp_2m',
    scheduler TEXT NOT NULL DEFAULT 'karras',
    width INTEGER NOT NULL DEFAULT 1024,
    height INTEGER NOT NULL DEFAULT 1024,
    steps INTEGER NOT NULL DEFAULT 25,
    cfg REAL NOT NULL DEFAULT 7.0,
    seed INTEGER NOT NULL DEFAULT -1,
    images TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_generations_created_at
    ON generations(created_at DESC);
"""


async def init_db() -> None:
    """데이터베이스 초기화 (테이블 생성)"""
    async with aiosqlite.connect(settings.history_db_path) as db:
        await db.executescript(SCHEMA_SQL)
        await db.commit()


async def get_db() -> aiosqlite.Connection:
    """DB 커넥션 반환"""
    db = await aiosqlite.connect(settings.history_db_path)
    db.row_factory = aiosqlite.Row
    return db
