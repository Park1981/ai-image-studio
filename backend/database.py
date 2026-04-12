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

CREATE TABLE IF NOT EXISTS prompt_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    prompt TEXT DEFAULT '',
    negative_prompt TEXT DEFAULT '',
    style TEXT DEFAULT 'photorealistic',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
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


async def save_generation(
    generation_id: str,
    prompt: str,
    enhanced_prompt: str | None,
    negative_prompt: str | None,
    checkpoint: str,
    loras: str,  # JSON 문자열
    sampler: str,
    scheduler: str,
    width: int,
    height: int,
    steps: int,
    cfg: float,
    seed: int,
    images: str,  # JSON 문자열
) -> None:
    """생성 완료 시 DB에 이력 저장"""
    async with aiosqlite.connect(settings.history_db_path) as db:
        await db.execute(
            """
            INSERT INTO generations
                (id, prompt, enhanced_prompt, negative_prompt, checkpoint,
                 loras, sampler, scheduler, width, height, steps, cfg, seed, images)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                generation_id, prompt, enhanced_prompt, negative_prompt,
                checkpoint, loras, sampler, scheduler,
                width, height, steps, cfg, seed, images,
            ),
        )
        await db.commit()


# ─────────────────────────────────────────────
# 프롬프트 템플릿 CRUD
# ─────────────────────────────────────────────

async def save_template(
    name: str,
    prompt: str,
    negative_prompt: str,
    style: str,
) -> dict:
    """프롬프트 템플릿 저장"""
    async with aiosqlite.connect(settings.history_db_path) as db:
        cursor = await db.execute(
            """
            INSERT INTO prompt_templates (name, prompt, negative_prompt, style)
            VALUES (?, ?, ?, ?)
            """,
            (name, prompt, negative_prompt, style),
        )
        await db.commit()
        template_id = cursor.lastrowid

    return {
        "id": template_id,
        "name": name,
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "style": style,
    }


async def get_templates() -> list[dict]:
    """프롬프트 템플릿 전체 목록 조회 (최신순)"""
    async with aiosqlite.connect(settings.history_db_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM prompt_templates ORDER BY created_at DESC"
        )
        rows = await cursor.fetchall()
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "prompt": r["prompt"],
                "negative_prompt": r["negative_prompt"],
                "style": r["style"],
                "created_at": r["created_at"],
            }
            for r in rows
        ]


async def delete_template(template_id: int) -> bool:
    """프롬프트 템플릿 삭제 (삭제 성공 여부 반환)"""
    async with aiosqlite.connect(settings.history_db_path) as db:
        cursor = await db.execute(
            "DELETE FROM prompt_templates WHERE id = ?",
            (template_id,),
        )
        await db.commit()
        return cursor.rowcount > 0


# ─────────────────────────────────────────────
# 히스토리 검색
# ─────────────────────────────────────────────

async def search_generations(
    query: str,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    """프롬프트 텍스트 검색 포함 히스토리 조회 (검색어, 페이지네이션)"""
    async with aiosqlite.connect(settings.history_db_path) as db:
        db.row_factory = aiosqlite.Row

        if query:
            like_param = f"%{query}%"
            # 전체 개수
            cursor = await db.execute(
                "SELECT COUNT(*) FROM generations WHERE prompt LIKE ?",
                (like_param,),
            )
            row = await cursor.fetchone()
            total = row[0] if row else 0

            # 목록 조회
            cursor = await db.execute(
                """SELECT * FROM generations
                   WHERE prompt LIKE ?
                   ORDER BY created_at DESC LIMIT ? OFFSET ?""",
                (like_param, limit, offset),
            )
        else:
            cursor = await db.execute("SELECT COUNT(*) FROM generations")
            row = await cursor.fetchone()
            total = row[0] if row else 0

            cursor = await db.execute(
                "SELECT * FROM generations ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )

        rows = await cursor.fetchall()
        items = [dict(r) for r in rows]
        return items, total
