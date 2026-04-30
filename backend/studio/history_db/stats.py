"""
history_db/stats.py — studio_history 통계 (Phase 4.1 단계 3.4).

count_items (mode filter) + get_stats (count + size + by_mode + db_size).
get_stats 는 storage._result_path_from_url lazy import 로 image_ref → 파일 경로
변환 후 stat 으로 사이즈 측정.
"""

from __future__ import annotations

from typing import Any

import aiosqlite

from . import _config as _cfg


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
