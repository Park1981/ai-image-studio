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


@pytest.mark.asyncio
async def test_insert_with_source_ref_persists(monkeypatch, tmp_path: Path) -> None:
    """insert_item 이 source_ref 를 저장하고 list_items 가 camelCase 로 반환."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    item = {
        "id": "tsk-test12345678",
        "mode": "edit",
        "prompt": "make it blue",
        "label": "make it blue",
        "width": 1024,
        "height": 1024,
        "seed": 42,
        "steps": 4,
        "cfg": 1.0,
        "lightning": True,
        "model": "qwen-image-edit-2511",
        "createdAt": 1700000000000,
        "imageRef": "/images/studio/result.png",
        "sourceRef": "/images/studio/edit-source/tsk-test12345678.png",
    }
    await history_db.insert_item(item)
    items = await history_db.list_items(mode="edit")
    assert len(items) == 1
    assert items[0]["sourceRef"] == "/images/studio/edit-source/tsk-test12345678.png"
    assert items[0]["comparisonAnalysis"] is None  # 분석 전


@pytest.mark.asyncio
async def test_update_comparison_persists_json(monkeypatch, tmp_path: Path) -> None:
    """update_comparison() 가 dict 를 JSON 직렬화로 저장 + 재조회 시 dict 복원."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    item = {
        "id": "tsk-test87654321",
        "mode": "edit",
        "prompt": "x",
        "label": "x",
        "width": 1024,
        "height": 1024,
        "seed": 1,
        "steps": 4,
        "cfg": 1.0,
        "lightning": True,
        "model": "qwen-image-edit-2511",
        "createdAt": 1700000001000,
        "imageRef": "/images/studio/r.png",
    }
    await history_db.insert_item(item)

    analysis = {
        "scores": {"face_id": 92, "body_pose": 75, "attire": 60,
                   "background": 88, "intent_fidelity": 95},
        "overall": 82,
        "comments_en": {"face_id": "good", "body_pose": "ok", "attire": "ok",
                        "background": "ok", "intent_fidelity": "ok"},
        "comments_ko": {"face_id": "좋음", "body_pose": "보통", "attire": "보통",
                        "background": "보통", "intent_fidelity": "좋음"},
        "summary_en": "Solid identity preservation.",
        "summary_ko": "신원 보존 양호.",
        "provider": "ollama",
        "fallback": False,
        "analyzedAt": 1700000005000,
        "visionModel": "qwen2.5vl:7b",
    }
    ok = await history_db.update_comparison("tsk-test87654321", analysis)
    assert ok is True

    fetched = await history_db.get_item("tsk-test87654321")
    assert fetched is not None
    assert fetched["comparisonAnalysis"]["overall"] == 82
    assert fetched["comparisonAnalysis"]["scores"]["face_id"] == 92


@pytest.mark.asyncio
async def test_update_comparison_unknown_id_returns_false(
    monkeypatch, tmp_path: Path,
) -> None:
    """존재하지 않는 id 는 False 반환 (예외 X)."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    ok = await history_db.update_comparison("tsk-nonexistent00", {"overall": 50})
    assert ok is False
