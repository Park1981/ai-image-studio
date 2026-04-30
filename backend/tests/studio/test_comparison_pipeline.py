"""
comparison_pipeline + history_db 마이그레이션 + /compare-analyze 라우트 테스트.

스코프:
  - source_ref / comparison_analysis 컬럼 idempotent ALTER
  - update_comparison() 가 JSON 직렬화로 저장
  - analyze_pair() 비전 호출 / JSON 파싱 / fallback / 번역 실패
  - POST /api/studio/compare-analyze 정상/에러 경로
"""

from __future__ import annotations

import io
import json
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
    """history_db._config._DB_PATH 를 임시 디렉토리로 강제."""
    db_path = tmp_path / "test_history.db"
    monkeypatch.setattr("studio.history_db._config._DB_PATH", str(db_path))
    return db_path


async def _drain_sse_done(cli, stream_url: str) -> dict:
    """Phase 6 (2026-04-27): compare/vision SSE drain 헬퍼.

    POST 가 task_id+stream_url 반환 → GET stream → done event payload 추출.
    error event 도착하면 RuntimeError 로 변환 (옛 HTTP 503 케이스 호환 — 캐스트 후 처리).
    """
    pending_event: str | None = None
    async with cli.stream("GET", stream_url) as sr:
        async for line in sr.aiter_lines():
            if line.startswith("event:"):
                pending_event = line[6:].strip()
                continue
            if line.startswith("data:"):
                try:
                    payload = json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    continue
                if pending_event == "done":
                    return payload
                if pending_event == "error":
                    raise RuntimeError(
                        f"sse error: {payload.get('message', 'unknown')}"
                    )
    raise RuntimeError("sse closed without done event")


@pytest.mark.asyncio
async def test_init_db_adds_comparison_columns(monkeypatch, tmp_path: Path) -> None:
    """init_studio_history_db() 가 source_ref / comparison_analysis 컬럼 모두 추가."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    async with aiosqlite.connect(history_db._config._DB_PATH) as db:
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
        "id": "tsk-1a2b3c4d5e6f",
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
        "sourceRef": "/images/studio/edit-source/tsk-1a2b3c4d5e6f.png",
    }
    await history_db.insert_item(item)
    items = await history_db.list_items(mode="edit")
    assert len(items) == 1
    assert items[0]["sourceRef"] == "/images/studio/edit-source/tsk-1a2b3c4d5e6f.png"
    assert items[0]["comparisonAnalysis"] is None  # 분석 전


@pytest.mark.asyncio
async def test_update_comparison_persists_json(monkeypatch, tmp_path: Path) -> None:
    """update_comparison() 가 dict 를 JSON 직렬화로 저장 + 재조회 시 dict 복원."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    item = {
        "id": "tsk-9f8e7d6c5b4a",
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
    ok = await history_db.update_comparison("tsk-9f8e7d6c5b4a", analysis)
    assert ok is True

    fetched = await history_db.get_item("tsk-9f8e7d6c5b4a")
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
    """v3: 비전 + 번역 모두 성공 시 domain + slots 5축 + 종합 평균 계산."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import analyze_pair

    # v3 형식: domain + slots × {intent, score, comment}
    raw_json = json.dumps({
        "domain": "person",
        "slots": {
            "face_expression": {"intent": "preserve", "score": 92, "comment": "Eyes and jaw preserved."},
            "hair":            {"intent": "preserve", "score": 88, "comment": "Same hairstyle."},
            "attire":          {"intent": "edit",     "score": 100, "comment": "Top color changed as requested."},
            "body_pose":       {"intent": "preserve", "score": 75, "comment": "Shoulder slightly narrower."},
            "background":      {"intent": "preserve", "score": 95, "comment": "Curtain pattern preserved."},
        },
        "summary": "Solid result with minor body drift.",
    })

    with (
        patch(
            "studio.comparison_pipeline.v3._call_vision_pair",
            new=AsyncMock(return_value=raw_json),
        ),
        patch(
            "studio.comparison_pipeline._common._translate_comments_to_ko",
            new=AsyncMock(return_value={
                "comments_ko": {
                    "face_expression": "눈과 턱 보존됨.",
                    "hair": "동일 헤어스타일.",
                    "attire": "상의 색상이 요청대로 변경됨.",
                    "body_pose": "어깨가 약간 좁아짐.",
                    "background": "커튼 패턴 보존됨.",
                },
                "summary_ko": "신원 보존 양호 · 약간의 체형 변화.",
            }),
        ),
    ):
        result = await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="change top color",
        )
    assert result.fallback is False
    assert result.provider == "ollama"
    assert result.domain == "person"
    # 슬롯 5개 모두 채워짐
    assert result.slots["face_expression"].score == 92
    assert result.slots["face_expression"].intent == "preserve"
    assert result.slots["attire"].intent == "edit"
    assert result.slots["attire"].score == 100
    # 종합 = (92+88+100+75+95)/5 = 90
    assert result.overall == 90
    # 한글 코멘트 정상 매핑
    assert result.slots["face_expression"].comment_ko == "눈과 턱 보존됨."
    assert "신원 보존" in result.summary_ko


@pytest.mark.asyncio
async def test_analyze_pair_object_scene_domain() -> None:
    """v3: 물체·풍경 모드 정상 응답 → 다른 슬롯 키 셋 + intent 컨텍스트."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import (
        OBJECT_SCENE_AXES, PERSON_AXES, analyze_pair,
    )

    raw_json = json.dumps({
        "domain": "object_scene",
        "slots": {
            "subject":             {"intent": "preserve", "score": 95, "comment": "Same mug."},
            "color_material":      {"intent": "edit",     "score": 100, "comment": "Color changed to blue as requested."},
            "layout_composition":  {"intent": "preserve", "score": 90, "comment": "Same framing."},
            "background_setting":  {"intent": "preserve", "score": 100, "comment": "Identical background."},
            "mood_style":          {"intent": "preserve", "score": 85, "comment": "Mood preserved."},
        },
        "summary": "Color change applied; rest preserved.",
    })
    with (
        patch(
            "studio.comparison_pipeline.v3._call_vision_pair",
            new=AsyncMock(return_value=raw_json),
        ),
        patch(
            "studio.comparison_pipeline._common._translate_comments_to_ko",
            new=AsyncMock(return_value={
                "comments_ko": {k: f"{k}_ko" for k in OBJECT_SCENE_AXES},
                "summary_ko": "색상 변경 적용 · 나머지 보존.",
            }),
        ),
    ):
        result = await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="change color to blue",
        )
    assert result.domain == "object_scene"
    for k in OBJECT_SCENE_AXES:
        assert k in result.slots
    # 인물 슬롯 키는 없어야 함
    for k in PERSON_AXES:
        if k not in OBJECT_SCENE_AXES:
            assert k not in result.slots


@pytest.mark.asyncio
async def test_analyze_pair_vision_fail_fallback() -> None:
    """v3: 비전 빈 응답 → fallback=True · slots 5개 모두 score=None · 번역 미호출."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import OBJECT_SCENE_AXES, analyze_pair

    translate_mock = AsyncMock(return_value={"comments_ko": {}, "summary_ko": ""})
    with (
        patch(
            "studio.comparison_pipeline.v3._call_vision_pair",
            new=AsyncMock(return_value=""),
        ),
        patch(
            "studio.comparison_pipeline._common._translate_comments_to_ko",
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
    assert result.domain == "object_scene"  # fallback 기본 도메인
    # 5 슬롯 모두 존재 + score=None
    assert len(result.slots) == 5
    for k in OBJECT_SCENE_AXES:
        assert k in result.slots
        assert result.slots[k].score is None
    assert result.overall == 0
    translate_mock.assert_not_called()


@pytest.mark.asyncio
async def test_analyze_pair_json_parse_fail_fallback() -> None:
    """비전이 JSON 깨진 응답 → fallback · summary 에 파싱 실패 마커."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import analyze_pair

    with (
        patch(
            "studio.comparison_pipeline.v3._call_vision_pair",
            new=AsyncMock(return_value="{invalid: not json"),
        ),
        patch(
            "studio.comparison_pipeline._common._translate_comments_to_ko",
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
async def test_analyze_pair_partial_slots_average_only_present() -> None:
    """v3: 일부 슬롯 score 누락 → score=None 보존 + 평균은 받은 점수만으로."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import analyze_pair

    raw_json = json.dumps({
        "domain": "person",
        "slots": {
            "face_expression": {"intent": "preserve", "score": 80, "comment": "ok"},
            "hair":            {"intent": "preserve", "score": 60, "comment": "ok"},
            # attire / body_pose / background 누락
        },
        "summary": "Partial result.",
    })
    with (
        patch(
            "studio.comparison_pipeline.v3._call_vision_pair",
            new=AsyncMock(return_value=raw_json),
        ),
        patch(
            "studio.comparison_pipeline._common._translate_comments_to_ko",
            new=AsyncMock(return_value={
                "comments_ko": {"face_expression": "괜찮음", "hair": "괜찮음"},
                "summary_ko": "부분 결과.",
            }),
        ),
    ):
        result = await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="x",
        )
    # 누락 슬롯 — None 으로 채워짐
    assert result.slots["attire"].score is None
    assert result.slots["body_pose"].score is None
    # 받은 슬롯
    assert result.slots["face_expression"].score == 80
    assert result.slots["hair"].score == 60
    # overall = (80+60)/2 = 70
    assert result.overall == 70


@pytest.mark.asyncio
async def test_analyze_pair_translation_fail_keeps_en() -> None:
    """v3: 비전 OK · 번역 실패 시 슬롯 comment_ko 에 comment_en 그대로 + summary 에 마커."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import analyze_pair

    raw_json = json.dumps({
        "domain": "person",
        "slots": {
            "face_expression": {"intent": "preserve", "score": 90, "comment": "ok"},
            "hair":            {"intent": "preserve", "score": 80, "comment": "ok"},
            "attire":          {"intent": "edit",     "score": 70, "comment": "ok"},
            "body_pose":       {"intent": "preserve", "score": 85, "comment": "ok"},
            "background":      {"intent": "preserve", "score": 95, "comment": "ok"},
        },
        "summary": "All good.",
    })
    with (
        patch(
            "studio.comparison_pipeline.v3._call_vision_pair",
            new=AsyncMock(return_value=raw_json),
        ),
        patch(
            "studio.comparison_pipeline._common._translate_comments_to_ko",
            new=AsyncMock(return_value=None),  # 번역 실패
        ),
    ):
        result = await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="x",
        )
    assert result.fallback is False  # 비전은 살아있음
    assert result.slots["face_expression"].comment_ko == "ok"  # en 그대로
    assert "번역 실패" in result.summary_ko


# ───────── spec 19 (2026-04-26 후속) — Codex 시스템 프롬프트 점검 반영 ─────────


def test_system_compare_v3_1_has_rubric_and_extra_slots() -> None:
    """SYSTEM_COMPARE 가 score rubric + transform_prompt + uncertain + refined_intent 포함."""
    from studio.comparison_pipeline import SYSTEM_COMPARE

    # 핵심 placeholder 존재
    assert "{edit_prompt}" in SYSTEM_COMPARE
    assert "{refined_intent}" in SYSTEM_COMPARE  # spec 19 신규
    # rubric 가드 (preserve 점수 후함 방지)
    assert "95-100" in SYSTEM_COMPARE
    assert "Default to" in SYSTEM_COMPARE and "LOW end" in SYSTEM_COMPARE
    # 신규 슬롯
    assert "transform_prompt" in SYSTEM_COMPARE
    assert "uncertain" in SYSTEM_COMPARE
    # ABSOLUTE REQUIREMENTS 가 JSON 안정성 보장
    assert "ABSOLUTE REQUIREMENTS" in SYSTEM_COMPARE


@pytest.mark.asyncio
async def test_call_vision_pair_injects_format_json_and_refined_intent() -> None:
    """_call_vision_pair 가 Ollama payload 에 format=json + refined_intent 주입."""
    from unittest.mock import MagicMock, patch

    from studio.comparison_pipeline import _call_vision_pair

    captured: dict = {}

    class _FakeResponse:
        def raise_for_status(self) -> None: ...

        def json(self) -> dict:
            return {"message": {"content": "{}"}}

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url: str, json=None):
            captured["url"] = url
            captured["payload"] = json
            return _FakeResponse()

    with patch(
        "studio._ollama_client.httpx.AsyncClient",
        new=MagicMock(return_value=_FakeClient()),
    ):
        await _call_vision_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="옷 색깔 바꿔줘",
            vision_model="qwen2.5vl:7b",
            timeout=10.0,
            ollama_url="http://x",
            refined_intent="Change the top color to deep blue.",
        )

    payload = captured["payload"]
    # spec 19 (Codex #5): format=json 강제
    assert payload.get("format") == "json"
    # spec 19 (Codex #4): refined_intent 가 SYSTEM 프롬프트에 주입됨
    sys_msg = payload["messages"][0]["content"]
    assert "Change the top color to deep blue." in sys_msg
    # raw editPrompt 도 같이 들어가 있어야 함 (한국어 원문)
    assert "옷 색깔 바꿔줘" in sys_msg
    # keep_alive 가드 유지
    assert payload.get("keep_alive") == "0"


@pytest.mark.asyncio
async def test_analyze_pair_parses_transform_prompt_and_uncertain() -> None:
    """spec 19: 비전 응답의 transform_prompt + uncertain 이 결과에 채워지고 한글 번역도 흡수."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import analyze_pair

    raw_json = json.dumps({
        "domain": "person",
        "slots": {
            "face_expression": {"intent": "preserve", "score": 92, "comment": "ok"},
            "hair":            {"intent": "preserve", "score": 90, "comment": "ok"},
            "attire":          {"intent": "edit",     "score": 95, "comment": "ok"},
            "body_pose":       {"intent": "preserve", "score": 88, "comment": "ok"},
            "background":      {"intent": "preserve", "score": 90, "comment": "ok"},
        },
        "summary": "Edit largely realized.",
        "transform_prompt": "soften facial expression slightly, restore left hand position",
        "uncertain": "right earring partially hidden",
    })

    with (
        patch(
            "studio.comparison_pipeline.v3._call_vision_pair",
            new=AsyncMock(return_value=raw_json),
        ),
        patch(
            "studio.comparison_pipeline._common._translate_comments_to_ko",
            new=AsyncMock(return_value={
                "comments_ko": {
                    "face_expression": "표정 보존됨.",
                    "hair": "헤어 보존됨.",
                    "attire": "의상 변경 적용됨.",
                    "body_pose": "포즈 보존됨.",
                    "background": "배경 보존됨.",
                },
                "summary_ko": "수정 대체로 반영됨.",
                "extra": {
                    "transform_prompt": "표정을 약간 부드럽게, 왼손 위치 복원.",
                    "uncertain": "오른쪽 귀걸이가 일부 가림.",
                },
            }),
        ),
    ):
        result = await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="x",
            refined_intent="Change top color to blue.",
        )

    # 영문 그대로 흡수
    assert "soften facial expression" in result.transform_prompt_en
    assert "right earring" in result.uncertain_en
    # 한글 번역 흡수
    assert "표정을 약간 부드럽게" in result.transform_prompt_ko
    assert "오른쪽 귀걸이" in result.uncertain_ko
    # to_dict 직렬화에도 포함
    serialized = result.to_dict()
    assert "transform_prompt_en" in serialized
    assert "transform_prompt_ko" in serialized
    assert "uncertain_en" in serialized
    assert "uncertain_ko" in serialized


@pytest.mark.asyncio
async def test_analyze_pair_passes_refined_intent_to_vision_call() -> None:
    """spec 19: analyze_pair 호출 시 refined_intent 가 _call_vision_pair 로 전달되는지 검증."""
    from unittest.mock import patch

    from studio.comparison_pipeline import analyze_pair

    captured: dict = {}

    async def _fake_call(*args, **kwargs):
        captured.update(kwargs)
        # 빈 응답 → fallback 경로 (테스트 목적은 인자 전달만 검증)
        return ""

    with patch(
        "studio.comparison_pipeline.v3._call_vision_pair",
        new=_fake_call,
    ):
        await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="옷 변경",
            refined_intent="Change the outfit to a red dress.",
        )

    # _call_vision_pair 가 refined_intent 인자를 그대로 받았는지 확인
    assert captured.get("refined_intent") == "Change the outfit to a red dress."


# ───────── refined_intent 캐싱 (spec 19 후속 v6) ─────────


@pytest.mark.asyncio
async def test_history_db_persists_and_returns_refined_intent(
    monkeypatch, tmp_path: Path
) -> None:
    """v6 마이그레이션 + insert_item / get_item 가 refined_intent 왕복 처리."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    item = {
        "id": "tsk-cafef00d1234",
        "mode": "edit",
        "prompt": "옷 색깔 바꿔줘",
        "label": "옷 색깔 바꿔줘",
        "width": 1024,
        "height": 1024,
        "seed": 1,
        "steps": 4,
        "cfg": 1.0,
        "lightning": True,
        "model": "Qwen Image Edit 2511",
        "createdAt": 1234567890000,
        "imageRef": "/images/studio/result/tsk-cafef00d1234.png",
        "refinedIntent": "Change the top color to deep blue. Keep everything else unchanged.",
    }
    await history_db.insert_item(item)

    out = await history_db.get_item("tsk-cafef00d1234")
    assert out is not None
    assert out["refinedIntent"] == (
        "Change the top color to deep blue. Keep everything else unchanged."
    )


@pytest.mark.asyncio
async def test_get_item_returns_no_refined_intent_when_unset(
    monkeypatch, tmp_path: Path
) -> None:
    """refinedIntent 안 넣고 insert 한 row 는 get_item 결과에 키 자체가 없음.

    옛 row + generate/video row 와 동일한 패턴 (값 없으면 노출 안함).
    """
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    await history_db.insert_item({
        "id": "tsk-deadbeef5678",
        "mode": "generate",
        "prompt": "x",
        "label": "x",
        "width": 1024,
        "height": 1024,
        "seed": 1,
        "steps": 8,
        "cfg": 1.5,
        "lightning": True,
        "model": "Qwen Image 2512",
        "createdAt": 1234567890000,
        "imageRef": "/images/studio/result/tsk-deadbeef5678.png",
    })

    out = await history_db.get_item("tsk-deadbeef5678")
    assert out is not None
    assert "refinedIntent" not in out


# ───────── 회귀 테스트: trailing 텍스트 + 대문자 헤더 ─────────


# ───────── _coerce_score 문자열 방어 (2026-04-26 Codex 진단) ─────────


def test_coerce_score_int_and_float() -> None:
    """기본: int / float 정상 처리, 0-100 클램프."""
    from studio.comparison_pipeline import _coerce_score

    assert _coerce_score(50) == 50
    assert _coerce_score(95.7) == 95
    assert _coerce_score(0) == 0
    assert _coerce_score(100) == 100
    assert _coerce_score(150) == 100  # 상한 클램프
    assert _coerce_score(-10) == 0  # 하한 클램프


def test_coerce_score_string_variants() -> None:
    """문자열 응답 (모델이 실수로 string 으로 보낸 경우) 도 정상 파싱.

    이전 버전 (int/float 만) → None 반환 → 종합 0% 버그 발생.
    Codex 진단으로 string 방어 추가.
    """
    from studio.comparison_pipeline import _coerce_score

    # 단순 숫자 string
    assert _coerce_score("95") == 95
    assert _coerce_score(" 88 ") == 88  # 양옆 공백
    # 퍼센트 표기
    assert _coerce_score("95%") == 95
    assert _coerce_score("88%") == 88
    # x/100 표기
    assert _coerce_score("95/100") == 95
    assert _coerce_score("70/100") == 70
    # 부가 텍스트 (괄호 안 코멘트)
    assert _coerce_score("85 (high)") == 85
    # 소수점 string
    assert _coerce_score("92.5") == 92


def test_coerce_score_invalid_returns_none() -> None:
    """파싱 불가능한 값은 None — 폴백 트리거."""
    from studio.comparison_pipeline import _coerce_score

    assert _coerce_score(None) is None
    assert _coerce_score("") is None
    assert _coerce_score("high") is None
    assert _coerce_score("N/A") is None
    assert _coerce_score(True) is None  # bool 은 명시적 제외
    assert _coerce_score([95]) is None  # 리스트 등 비지원 타입


def test_coerce_scores_handles_string_dict() -> None:
    """_coerce_scores (복수형) 도 string 처리 일관 적용."""
    from studio.comparison_pipeline import COMPARE_AXES, _coerce_scores

    raw = {
        "composition": "92",
        "color": "88%",
        "subject": "78/100",
        "mood": 90,
        "quality": "95.5",
    }
    out = _coerce_scores(raw, COMPARE_AXES)
    assert out["composition"] == 92
    assert out["color"] == 88
    assert out["subject"] == 78
    assert out["mood"] == 90
    assert out["quality"] == 95


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


# ───── spec 19 후속 (재합산) — D: lock 범위 최적화 + A: edit width/height 전달 ─────


@pytest.mark.asyncio
async def test_compare_analyze_skips_clarify_when_refined_intent_cached(
    monkeypatch, tmp_path: Path
) -> None:
    """spec 19 후속 (Codex 리뷰): historyItemId 의 row 에 refinedIntent 캐시가
    있으면 clarify_edit_intent 호출 안 함 → gemma4 cold start ~5초 절약.

    캐시 히트 → analyze_pair 의 refined_intent 인자에 캐시 값 그대로 전달.
    """
    from unittest.mock import patch

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio import history_db
    from studio.comparison_pipeline import (
        ComparisonAnalysisResult,
        ComparisonSlotEntry,
    )

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    # 사전 row insert + refinedIntent 캐시
    # Codex C1 fix (2026-04-30): history.id 는 edit-/gen-/vid- prefix.
    # 옛 tsk-* 사용은 실제 history id 형식이 아니어서 게이트 통과해도 silent miss.
    cached_intent = "Change the top color to deep blue. Keep everything else unchanged."
    await history_db.insert_item({
        "id": "edit-cace1234",
        "mode": "edit",
        "prompt": "옷 색깔 바꿔줘",
        "label": "옷 색깔 바꿔줘",
        "width": 1024, "height": 1024, "seed": 1,
        "steps": 4, "cfg": 1.0, "lightning": True,
        "model": "Qwen Image Edit 2511",
        "createdAt": 1700000000000,
        "imageRef": "/images/studio/result/edit-cace1234.png",
        "refinedIntent": cached_intent,
    })

    clarify_calls: list[str] = []

    async def _fake_clarify(*args, **_kwargs):
        clarify_calls.append(args[0] if args else "")
        return "FRESH (should not be called when cache hit)"

    captured_intent: list[str] = []

    async def _fake_analyze(*_args, **kwargs):
        captured_intent.append(kwargs.get("refined_intent", ""))
        return ComparisonAnalysisResult(
            domain="person",
            slots={
                k: ComparisonSlotEntry(
                    intent="preserve", score=90, comment_en="ok", comment_ko="ok"
                )
                for k in ("face_expression", "hair", "attire", "body_pose", "background")
            },
            overall=90,
            summary_en="ok", summary_ko="ok",
            provider="ollama", fallback=False,
            analyzed_at=1700000000000, vision_model="qwen2.5vl:7b",
        )

    with (
        patch("studio.pipelines.compare_analyze.clarify_edit_intent", new=_fake_clarify),
        patch("studio.pipelines.compare_analyze.analyze_pair", new=_fake_analyze),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as cli:
            res = await cli.post(
                "/api/studio/compare-analyze",
                files={
                    "source": ("s.png", _tiny_png_bytes(), "image/png"),
                    "result": ("r.png", _tiny_png_bytes(), "image/png"),
                },
                data={"meta": json.dumps({
                    "editPrompt": "옷 색깔 바꿔줘",
                    "historyItemId": "edit-cace1234",
                })},
            )
            assert res.status_code == 200
            await _drain_sse_done(cli, res.json()["stream_url"])
    # 캐시 히트 → clarify 호출 0회 (gemma4 cold start ~5초 절약 검증)
    assert clarify_calls == [], (
        f"clarify_edit_intent 가 캐시 히트 시 호출됨 (예상: 0회 / 실제: {len(clarify_calls)}회)"
    )
    # analyze_pair 가 캐시된 refined_intent 그대로 받았는지
    assert captured_intent == [cached_intent]


@pytest.mark.asyncio
async def test_compare_analyze_runs_clarify_intent_outside_lock(
    monkeypatch, tmp_path: Path
) -> None:
    """D — clarify_edit_intent 가 _COMPARE_LOCK 잡히기 전에 호출돼야 함.

    이전엔 lock 안에서 gemma4 cold start ~5초 잡혀서 다른 compare 요청이
    30s lock timeout 으로 503 받을 수 있었음. lock 밖으로 옮긴 후엔 vision
    호출 직전까지 기다리지 않고 미리 정제 수행.
    """
    from unittest.mock import patch

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio.comparison_pipeline import (
        ComparisonAnalysisResult,
        ComparisonSlotEntry,
    )

    call_order: list[str] = []

    async def _fake_clarify(*_args, **_kwargs):
        call_order.append("clarify")
        return "Refined English intent."

    async def _fake_analyze(*_args, **kwargs):
        call_order.append("analyze")
        # refined_intent 가 lock 밖 정제 결과로 들어왔는지 확인
        assert kwargs.get("refined_intent") == "Refined English intent."
        return ComparisonAnalysisResult(
            domain="person",
            slots={
                k: ComparisonSlotEntry(
                    intent="preserve", score=90, comment_en="ok", comment_ko="ok"
                )
                for k in ("face_expression", "hair", "attire", "body_pose", "background")
            },
            overall=90,
            summary_en="ok",
            summary_ko="ok",
            provider="ollama",
            fallback=False,
            analyzed_at=1700000000000,
            vision_model="qwen2.5vl:7b",
        )

    with (
        patch("studio.pipelines.compare_analyze.clarify_edit_intent", new=_fake_clarify),
        patch("studio.pipelines.compare_analyze.analyze_pair", new=_fake_analyze),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as cli:
            res = await cli.post(
                "/api/studio/compare-analyze",
                files={
                    "source": ("s.png", _tiny_png_bytes(), "image/png"),
                    "result": ("r.png", _tiny_png_bytes(), "image/png"),
                },
                data={"meta": json.dumps({"editPrompt": "옷 색깔 바꿔줘"})},
            )
            assert res.status_code == 200
            await _drain_sse_done(cli, res.json()["stream_url"])
    # 호출 순서: clarify (lock 밖) → analyze (lock 안)
    assert call_order == ["clarify", "analyze"]


@pytest.mark.asyncio
async def test_edit_run_pipeline_forwards_width_height_to_vision() -> None:
    """A — _run_edit_pipeline 가 source_width/source_height kwargs 를
    run_vision_pipeline 에 width/height kwargs 로 전달하는지 단위 검증.

    full SSE + ComfyUI dispatch 통합은 다른 통합 테스트가 커버.
    여기선 spec 19 후속 변경 (kwargs 라우팅) 만 좁게 검증.
    """
    from unittest.mock import AsyncMock, patch

    from studio.router import _run_edit_pipeline

    captured: dict = {}

    async def _fake_vision(*_args, **kwargs):
        captured.update(kwargs)
        # _run_edit_pipeline 이 vision 결과 attribute 접근하는데, 빠른 종료를
        # 위해 RuntimeError 로 short-circuit (try/except 가 잡음 → 에러 emit 후 종료)
        raise RuntimeError("short-circuit after capture")

    # task.emit / task.close 는 호출되지만 결과 검증 대상 아님 — AsyncMock 으로 noop
    fake_task = AsyncMock()
    fake_task.task_id = "tsk-cafef00d1234"
    fake_task.emit = AsyncMock(return_value=None)
    fake_task.close = AsyncMock(return_value=None)

    # task #16 (2026-04-26): _run_edit_pipeline 이 studio.pipelines.edit 로 이동.
    # 호출 site 가 거기이므로 patch 대상도 동일 모듈로 정정.
    with patch("studio.pipelines.edit.run_vision_pipeline", new=_fake_vision):
        await _run_edit_pipeline(
            fake_task,
            image_bytes=_tiny_png_bytes(),
            prompt="test",
            lightning=True,
            filename="x.png",
            source_width=1664,
            source_height=928,
        )

    assert captured.get("width") == 1664
    assert captured.get("height") == 928


# ───── spec 19 후속 — quoted-string aware scanner (Codex P2 권고) ─────


def test_parse_strict_json_handles_brace_inside_string() -> None:
    """문자열 값 안의 { 또는 } 가 brace depth 에 영향 안 줌.

    예전 brace-only scanner 는 transform_prompt 안에 "{...}" 가 들어오면
    균형이 어긋나서 파싱 실패했음. quoted-string aware 로 해결.
    """
    from studio._json_utils import parse_strict_json

    raw = (
        '{"transform_prompt": "shift gaze {upward} 30 degrees", '
        '"summary": "ok"}'
    )
    result = parse_strict_json(raw)
    assert result is not None
    assert result["transform_prompt"] == "shift gaze {upward} 30 degrees"
    assert result["summary"] == "ok"


def test_parse_strict_json_handles_escaped_quote_in_string() -> None:
    """문자열 안의 escape 된 따옴표 \\" 도 정상 처리."""
    from studio._json_utils import parse_strict_json

    # JSON 문자열로 'She said "hi" to me' 표현 — \" 로 escape
    raw = '{"comment": "She said \\"hi\\" to me", "score": 95}'
    result = parse_strict_json(raw)
    assert result is not None
    assert result["comment"] == 'She said "hi" to me'
    assert result["score"] == 95


def test_parse_strict_json_handles_escaped_backslash_then_quote() -> None:
    """\\\\\" 패턴 (escape 된 backslash + 진짜 종료 따옴표) 도 정상 처리.

    edge case: \\\\\" 는 "백슬래시 한 글자 + 종료 따옴표" 의미.
    quoted-string aware scanner 가 escape_next 를 한 글자만 skip 하므로 정상.
    """
    from studio._json_utils import parse_strict_json

    # JSON 문자열 값이 'path\\' (백슬래시로 끝남) 인 케이스
    raw = '{"path": "C:\\\\folder\\\\", "ok": true}'
    result = parse_strict_json(raw)
    assert result is not None
    assert result["path"] == "C:\\folder\\"
    assert result["ok"] is True


@pytest.mark.asyncio
async def test_translate_section_parsing_uppercase_headers() -> None:
    """번역 모델이 대문자 헤더 [FACE_ID] 로 응답해도 정상 파싱."""
    from unittest.mock import patch

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

    with patch("studio._ollama_client.httpx.AsyncClient", lambda **kw: FakeClient()):
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
    from studio import history_db, storage as studio_storage
    from studio.pipelines import edit as edit_pipeline

    # 임시 STUDIO_OUTPUT_DIR + edit-source 서브디렉토리
    # task #16 (2026-04-26): 본래 모듈은 studio.storage / studio.pipelines.edit.
    # router 의 동일 이름은 re-export 인데 monkeypatch 는 lookup 모듈 이름을
    # 갱신해야 실 코드 경로에 적용됨.
    out_dir = tmp_path / "studio-out"
    out_dir.mkdir(parents=True, exist_ok=True)
    edit_src_dir = out_dir / "edit-source"
    edit_src_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(studio_storage, "STUDIO_OUTPUT_DIR", out_dir)
    monkeypatch.setattr(studio_storage, "EDIT_SOURCE_DIR", edit_src_dir)
    monkeypatch.setattr(edit_pipeline, "EDIT_SOURCE_DIR", edit_src_dir)

    # 임시 DB
    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    # ComfyUI 디스패치는 mock-fallback 으로 우회
    # task #16 (2026-04-26): ComfyDispatchResult 본래 위치는 studio.pipelines.
    # router 도 re-export 하지만 동일 클래스 객체 보장 위해 본래 위치에서 import.
    from studio.pipelines import ComfyDispatchResult

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
        # task #16 (2026-04-26): _dispatch_to_comfy / run_vision_pipeline 호출 site
        # 가 studio.pipelines.edit 로 이동 — 거기서 patch 해야 가로챔.
        patch.object(edit_pipeline, "_dispatch_to_comfy", new=AsyncMock(side_effect=fake_dispatch)),
        patch.object(edit_pipeline, "run_vision_pipeline", new=AsyncMock(return_value=fake_vision_result)),
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


# ───────── /compare-analyze 라우트 ─────────


@pytest.mark.asyncio
async def test_compare_analyze_route_happy_path(monkeypatch, tmp_path: Path) -> None:
    """multipart source+result+meta → analysis 응답 + saved=False (no historyItemId)."""
    from unittest.mock import AsyncMock, patch

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio.comparison_pipeline import ComparisonAnalysisResult

    fake = ComparisonAnalysisResult(
        scores={k: 80 for k in ("face_id","body_pose","attire","background","intent_fidelity")},
        overall=80,
        comments_en={k: "ok" for k in ("face_id","body_pose","attire","background","intent_fidelity")},
        comments_ko={k: "괜찮음" for k in ("face_id","body_pose","attire","background","intent_fidelity")},
        summary_en="All good.",
        summary_ko="전반적으로 양호.",
        provider="ollama",
        fallback=False,
        analyzed_at=1700000000000,
        vision_model="qwen2.5vl:7b",
    )

    # Phase 6 (2026-04-27): 호출 site = pipelines/compare_analyze.py 로 이동.
    # mock.patch 위치도 거기에 맞춰 갱신 — routes/compare.py 의 import 는 옛 호환용 namespace 만.
    with patch(
        "studio.pipelines.compare_analyze.analyze_pair",
        new=AsyncMock(return_value=fake),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as cli:
            res = await cli.post(
                "/api/studio/compare-analyze",
                files={
                    "source": ("s.png", _tiny_png_bytes(), "image/png"),
                    "result": ("r.png", _tiny_png_bytes(), "image/png"),
                },
                data={"meta": json.dumps({"editPrompt": "add earrings"})},
            )
            assert res.status_code == 200
            body = await _drain_sse_done(cli, res.json()["stream_url"])
    assert body["analysis"]["overall"] == 80
    assert body["saved"] is False  # historyItemId 없음


@pytest.mark.asyncio
async def test_compare_analyze_persists_when_history_id_given(
    monkeypatch, tmp_path: Path
) -> None:
    """historyItemId 가 DB 에 존재하면 update_comparison 호출 + saved=True."""
    from unittest.mock import AsyncMock, patch

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio import history_db
    from studio.comparison_pipeline import ComparisonAnalysisResult

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()
    # Codex C1 fix (2026-04-30): edit-* 가 실제 history id 형식.
    # 옛 tsk-aaaaaaaaaaaa 는 실제로 어떤 history row 와도 매치되지 않던 상태.
    await history_db.insert_item({
        "id": "edit-aaaaaaaa",
        "mode": "edit",
        "prompt": "x", "label": "x",
        "width": 1024, "height": 1024, "seed": 1,
        "steps": 4, "cfg": 1.0, "lightning": True,
        "model": "qwen-image-edit-2511",
        "createdAt": 1700000000000,
        "imageRef": "/images/studio/r.png",
    })

    fake = ComparisonAnalysisResult(
        scores={k: 70 for k in ("face_id","body_pose","attire","background","intent_fidelity")},
        overall=70, comments_en={}, comments_ko={},
        summary_en="ok", summary_ko="좋음",
        provider="ollama", fallback=False,
        analyzed_at=1700000000000, vision_model="qwen2.5vl:7b",
    )

    with patch(
        "studio.pipelines.compare_analyze.analyze_pair", new=AsyncMock(return_value=fake),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as cli:
            res = await cli.post(
                "/api/studio/compare-analyze",
                files={
                    "source": ("s.png", _tiny_png_bytes(), "image/png"),
                    "result": ("r.png", _tiny_png_bytes(), "image/png"),
                },
                data={"meta": json.dumps({
                    "editPrompt": "x",
                    "historyItemId": "edit-aaaaaaaa",
                })},
            )
            assert res.status_code == 200
            body = await _drain_sse_done(cli, res.json()["stream_url"])
    assert body["saved"] is True

    fetched = await history_db.get_item("edit-aaaaaaaa")
    assert fetched["comparisonAnalysis"]["overall"] == 70


@pytest.mark.asyncio
async def test_compare_analyze_unknown_history_id_saved_false(
    monkeypatch, tmp_path: Path
) -> None:
    """historyItemId 가 DB 에 없으면 saved=False, 분석은 정상 응답."""
    from unittest.mock import AsyncMock, patch

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio import history_db
    from studio.comparison_pipeline import ComparisonAnalysisResult

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    fake = ComparisonAnalysisResult(
        scores={k: None for k in ("face_id","body_pose","attire","background","intent_fidelity")},
        overall=0, comments_en={}, comments_ko={},
        summary_en="x", summary_ko="x",
        provider="fallback", fallback=True,
        analyzed_at=0, vision_model="qwen2.5vl:7b",
    )

    with patch("studio.pipelines.compare_analyze.analyze_pair", new=AsyncMock(return_value=fake)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as cli:
            res = await cli.post(
                "/api/studio/compare-analyze",
                files={
                    "source": ("s.png", _tiny_png_bytes(), "image/png"),
                    "result": ("r.png", _tiny_png_bytes(), "image/png"),
                },
                data={"meta": json.dumps({
                    "editPrompt": "x",
                    "historyItemId": "edit-bbbbbbbb",  # 형식 valid 지만 DB row 없음
                })},
            )
            assert res.status_code == 200
            body = await _drain_sse_done(cli, res.json()["stream_url"])
    assert body["saved"] is False


@pytest.mark.asyncio
async def test_compare_analyze_empty_source_400(monkeypatch, tmp_path: Path) -> None:
    """source 파일 비어있으면 400."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as cli:
        res = await cli.post(
            "/api/studio/compare-analyze",
            files={
                "source": ("s.png", b"", "image/png"),
                "result": ("r.png", _tiny_png_bytes(), "image/png"),
            },
            data={"meta": json.dumps({"editPrompt": "x"})},
        )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_compare_analyze_invalid_meta_400(monkeypatch) -> None:
    """meta JSON 깨짐 400."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as cli:
        res = await cli.post(
            "/api/studio/compare-analyze",
            files={
                "source": ("s.png", _tiny_png_bytes(), "image/png"),
                "result": ("r.png", _tiny_png_bytes(), "image/png"),
            },
            data={"meta": "{not json"},
        )
    assert res.status_code == 400
