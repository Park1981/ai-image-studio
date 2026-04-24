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


# ───────── comparison_pipeline 코어 ─────────


@pytest.mark.asyncio
async def test_analyze_pair_happy_path() -> None:
    """비전 + 번역 모두 성공 시 ComparisonAnalysisResult 풀로 채워짐."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import analyze_pair

    raw_json = json.dumps({
        "scores": {
            "face_id": 92, "body_pose": 75, "attire": 60,
            "background": 88, "intent_fidelity": 95,
        },
        "comments": {
            "face_id": "Eyes and jaw preserved.",
            "body_pose": "Shoulder slightly narrower.",
            "attire": "Top color changed as requested.",
            "background": "Curtain pattern preserved.",
            "intent_fidelity": "Earrings added accurately.",
        },
        "summary": "Solid result with minor body drift.",
    })

    with (
        patch(
            "studio.comparison_pipeline._call_vision_pair",
            new=AsyncMock(return_value=raw_json),
        ),
        patch(
            "studio.comparison_pipeline._translate_comments_to_ko",
            new=AsyncMock(return_value={
                "comments_ko": {
                    "face_id": "눈과 턱 보존됨.",
                    "body_pose": "어깨가 약간 좁아짐.",
                    "attire": "상의 색상이 요청대로 변경됨.",
                    "background": "커튼 패턴 보존됨.",
                    "intent_fidelity": "귀걸이가 정확히 추가됨.",
                },
                "summary_ko": "신원 보존 양호 · 약간의 체형 변화.",
            }),
        ),
    ):
        result = await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="add earrings",
        )
    assert result.fallback is False
    assert result.provider == "ollama"
    assert result.scores["face_id"] == 92
    # 5축 산술 평균 (92+75+60+88+95)/5 = 82
    assert result.overall == 82
    assert "신원 보존" in result.summary_ko


@pytest.mark.asyncio
async def test_analyze_pair_vision_fail_fallback() -> None:
    """비전 호출 실패 (빈 응답) 시 fallback=True · scores 모두 null · 번역 미호출."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import analyze_pair

    translate_mock = AsyncMock(return_value={"comments_ko": {}, "summary_ko": ""})
    with (
        patch(
            "studio.comparison_pipeline._call_vision_pair",
            new=AsyncMock(return_value=""),
        ),
        patch(
            "studio.comparison_pipeline._translate_comments_to_ko",
            new=translate_mock,
        ),
    ):
        result = await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="x",
        )
    assert result.fallback is True
    assert result.provider == "fallback"
    assert all(v is None for v in result.scores.values())
    assert result.overall == 0  # 빈 평균은 0 으로 표기
    translate_mock.assert_not_called()


@pytest.mark.asyncio
async def test_analyze_pair_json_parse_fail_fallback() -> None:
    """비전이 JSON 깨진 응답 → fallback · summary 에 파싱 실패 마커."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import analyze_pair

    with (
        patch(
            "studio.comparison_pipeline._call_vision_pair",
            new=AsyncMock(return_value="{invalid: not json"),
        ),
        patch(
            "studio.comparison_pipeline._translate_comments_to_ko",
            new=AsyncMock(),
        ),
    ):
        result = await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="x",
        )
    assert result.fallback is True
    assert "파싱" in result.summary_ko or "parse" in result.summary_en.lower()


@pytest.mark.asyncio
async def test_analyze_pair_partial_scores_average_only_present() -> None:
    """일부 축 누락 시 null 로 보존 + overall 평균은 받은 점수만으로."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import analyze_pair

    raw_json = json.dumps({
        "scores": {
            "face_id": 80, "body_pose": 60,
            # attire / background / intent_fidelity 누락
        },
        "comments": {"face_id": "ok", "body_pose": "ok"},
        "summary": "Partial result.",
    })
    with (
        patch(
            "studio.comparison_pipeline._call_vision_pair",
            new=AsyncMock(return_value=raw_json),
        ),
        patch(
            "studio.comparison_pipeline._translate_comments_to_ko",
            new=AsyncMock(return_value={
                "comments_ko": {"face_id": "괜찮음", "body_pose": "괜찮음"},
                "summary_ko": "부분 결과.",
            }),
        ),
    ):
        result = await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="x",
        )
    assert result.scores["attire"] is None
    assert result.scores["face_id"] == 80
    # overall = (80+60)/2 = 70
    assert result.overall == 70


@pytest.mark.asyncio
async def test_analyze_pair_translation_fail_keeps_en() -> None:
    """비전 OK · 번역 실패 시 ko 자리에 en 그대로 + summary_ko 에 마커."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import analyze_pair

    raw_json = json.dumps({
        "scores": {"face_id": 90, "body_pose": 80, "attire": 70,
                   "background": 85, "intent_fidelity": 95},
        "comments": {"face_id": "ok", "body_pose": "ok", "attire": "ok",
                     "background": "ok", "intent_fidelity": "ok"},
        "summary": "All good.",
    })
    with (
        patch(
            "studio.comparison_pipeline._call_vision_pair",
            new=AsyncMock(return_value=raw_json),
        ),
        patch(
            "studio.comparison_pipeline._translate_comments_to_ko",
            new=AsyncMock(return_value=None),  # 번역 실패
        ),
    ):
        result = await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="x",
        )
    assert result.fallback is False  # 비전은 살아있음
    assert result.comments_ko["face_id"] == "ok"  # en 그대로
    assert "번역 실패" in result.summary_ko
