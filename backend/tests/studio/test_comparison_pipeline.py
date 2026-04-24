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


# ───────── 회귀 테스트: trailing 텍스트 + 대문자 헤더 ─────────


def test_parse_strict_json_handles_trailing_text() -> None:
    """qwen2.5vl 이 JSON 뒤에 자연어 코멘트 붙여도 첫 균형 JSON 만 추출."""
    from studio.comparison_pipeline import _parse_strict_json

    raw = '{"scores": {"face_id": 80}, "comments": {}, "summary": "ok"} Confidence: {high}'
    result = _parse_strict_json(raw)
    assert result is not None
    assert result["scores"]["face_id"] == 80
    assert result["summary"] == "ok"


def test_parse_strict_json_handles_nested_braces() -> None:
    """nested object 도 균형 맞춰 정상 파싱."""
    from studio.comparison_pipeline import _parse_strict_json

    raw = '{"a": {"b": {"c": 1}}, "d": 2}'
    result = _parse_strict_json(raw)
    assert result is not None
    assert result["a"]["b"]["c"] == 1
    assert result["d"] == 2


def test_parse_strict_json_with_code_fence() -> None:
    """``` json ... ``` 펜스 제거 후 파싱."""
    from studio.comparison_pipeline import _parse_strict_json

    raw = '```json\n{"x": 1}\n```'
    result = _parse_strict_json(raw)
    assert result == {"x": 1}


def test_parse_strict_json_unbalanced_returns_none() -> None:
    """열린 채 끝나는 JSON 은 None."""
    from studio.comparison_pipeline import _parse_strict_json

    raw = '{"x": {"y": 1'
    assert _parse_strict_json(raw) is None


@pytest.mark.asyncio
async def test_translate_section_parsing_uppercase_headers() -> None:
    """번역 모델이 대문자 헤더 [FACE_ID] 로 응답해도 정상 파싱."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import _translate_comments_to_ko

    raw_ko = (
        "[FACE_ID]\n눈 보존됨.\n\n"
        "[Body_Pose]\n어깨 변화.\n\n"
        "[summary]\n전반적 양호.\n"
    )
    # _call_ollama 직접 mock 하기 어려우니 httpx response 자체를 mock
    fake_response = type("R", (), {
        "raise_for_status": lambda self: None,
        "json": lambda self: {"message": {"content": raw_ko}},
    })()

    class FakeClient:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return None
        async def post(self, *a, **kw):
            return fake_response

    with patch("studio.comparison_pipeline.httpx.AsyncClient", lambda **kw: FakeClient()):
        result = await _translate_comments_to_ko(
            comments_en={"face_id": "x", "body_pose": "x", "attire": "", "background": "", "intent_fidelity": ""},
            summary_en="x",
            text_model="m",
            timeout=10.0,
            ollama_url="http://x",
        )
    assert result is not None
    assert result["comments_ko"]["face_id"] == "눈 보존됨."
    assert result["comments_ko"]["body_pose"] == "어깨 변화."
    assert result["summary_ko"] == "전반적 양호."


# ───────── /edit source 영구 저장 ─────────


@pytest.mark.asyncio
async def test_edit_persists_source_to_disk(monkeypatch, tmp_path: Path) -> None:
    """/edit 호출 시 source 가 STUDIO_OUTPUT_DIR/edit-source/{task_id}.png 로 저장되고
    history 에 sourceRef 가 기입된다."""
    from unittest.mock import AsyncMock, patch

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio import history_db, router as studio_router

    # 임시 STUDIO_OUTPUT_DIR + edit-source 서브디렉토리
    out_dir = tmp_path / "studio-out"
    out_dir.mkdir(parents=True, exist_ok=True)
    edit_src_dir = out_dir / "edit-source"
    edit_src_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(studio_router, "STUDIO_OUTPUT_DIR", out_dir)
    monkeypatch.setattr(studio_router, "EDIT_SOURCE_DIR", edit_src_dir)

    # 임시 DB
    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    # ComfyUI 디스패치는 mock-fallback 으로 우회
    from studio.router import ComfyDispatchResult

    async def fake_dispatch(*args, **kwargs):
        return ComfyDispatchResult(
            image_ref="mock-seed://test",
            width=1024, height=1024, comfy_error=None,
        )

    fake_vision_result = type("V", (), {
        "image_description": "x",
        "final_prompt": "x",
        "vision_ok": True,
        "upgrade": type("U", (), {
            "translation": "x",
            "provider": "ollama",
        })(),
    })()

    with (
        patch.object(studio_router, "_dispatch_to_comfy", new=AsyncMock(side_effect=fake_dispatch)),
        patch.object(studio_router, "run_vision_pipeline", new=AsyncMock(return_value=fake_vision_result)),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as cli:
            res = await cli.post(
                "/api/studio/edit",
                files={"image": ("src.png", _tiny_png_bytes(), "image/png")},
                data={"meta": json.dumps({"prompt": "make it blue", "lightning": True})},
            )
            assert res.status_code == 200
            stream_url = res.json()["stream_url"]
            # SSE 스트림 소비 — done 이벤트까지 대기
            done_item = None
            async with cli.stream("GET", stream_url) as sr:
                async for line in sr.aiter_lines():
                    if line.startswith("data:"):
                        try:
                            payload = json.loads(line[5:].strip())
                        except json.JSONDecodeError:
                            continue
                        if isinstance(payload, dict) and "item" in payload:
                            done_item = payload["item"]
                            break

    assert done_item is not None
    assert done_item.get("sourceRef", "").startswith("/images/studio/edit-source/")
    # 디스크에 파일 존재 — task_id 가 파일명
    rel = done_item["sourceRef"].replace("/images/studio/", "")
    assert (out_dir / rel).exists()
