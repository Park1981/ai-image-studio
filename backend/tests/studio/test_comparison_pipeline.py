"""
comparison_pipeline + history_db 마이그레이션 + /compare-analyze 라우트 테스트.

스코프:
  - source_ref / comparison_analysis 컬럼 idempotent ALTER
  - update_comparison() 가 JSON 직렬화로 저장
  - analyze_pair() 비전 호출 / JSON 파싱 / fallback / 번역 실패
  - POST /api/studio/compare-analyze 정상/에러 경로
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import tempfile
from pathlib import Path

import aiosqlite
import pytest
from PIL import Image


def _tiny_png_bytes() -> bytes:
    """테스트용 2×2 PNG 바이트."""
    buf = io.BytesIO()
    Image.new("RGB", (2, 2), color=(120, 80, 200)).save(buf, "PNG")
    return buf.getvalue()


def _set_temp_db(monkeypatch, tmp_path: Path) -> Path:
    """history_db._DB_PATH 를 임시 디렉토리로 강제."""
    db_path = tmp_path / "test_history.db"
    monkeypatch.setattr("studio.history_db._DB_PATH", str(db_path))
    return db_path


@pytest.mark.asyncio
async def test_init_db_adds_comparison_columns(monkeypatch, tmp_path: Path) -> None:
    """init_studio_history_db() 가 source_ref / comparison_analysis 컬럼 모두 추가."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    async with aiosqlite.connect(history_db._DB_PATH) as db:
        cur = await db.execute("PRAGMA table_info(studio_history)")
        cols = {row[1] for row in await cur.fetchall()}
    assert "source_ref" in cols
    assert "comparison_analysis" in cols


@pytest.mark.asyncio
async def test_init_db_idempotent(monkeypatch, tmp_path: Path) -> None:
    """init 두 번 불러도 ALTER 중복 에러 없이 통과."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()
    await history_db.init_studio_history_db()  # 두 번째 호출 — 에러 없어야 함
