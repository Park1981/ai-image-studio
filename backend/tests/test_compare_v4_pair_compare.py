"""compare_pair_with_vision — A+B 동시 vision 비교 단위 테스트.

mock.patch 사이트 박제 (🔴 CLAUDE.md critical · spec §9.1):
  - call_chat_payload patch 는 lookup 모듈 기준 →
    `studio.compare_pipeline_v4.pair_compare.call_chat_payload`
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from studio.compare_pipeline_v4.pair_compare import (
    PAIR_COMPARE_SYSTEM,
    _build_user_payload,
    _to_b64,
    compare_pair_with_vision,
)
from studio.compare_pipeline_v4._types import CompareAnalysisResultV4


# ── fixtures ────────────────────────────────────────────────────────────────


def _fake_observation(label: str) -> dict:
    """간단한 observation JSON (subject 1명)."""
    return {"subjects": [{"broad_visible_appearance": f"{label}-appearance"}]}


def _full_v4_response() -> dict:
    """pair vision 정상 응답 (V4 schema)."""
    return {
        "summary": "Both images show the same subject in different outfits.",
        "common_points": ["same subject", "indoor lighting", "neutral background"],
        "key_differences": [
            "outfit changed from holter to layered top",
            "framing changed from waist-up to close-up",
        ],
        "domain_match": "person",
        "category_diffs": {
            "composition": {"image1": "waist-up center", "image2": "close-up shoulder", "diff": "tighter crop"},
            "subject": {"image1": "young adult woman", "image2": "young adult woman", "diff": "same person"},
            "clothing_or_materials": {
                "image1": "white holter top",
                "image2": "white top with beige cardigan",
                "diff": "layered with cardigan",
            },
            "environment": {"image1": "studio neutral", "image2": "studio neutral", "diff": "similar"},
            "lighting_camera_style": {"image1": "soft front", "image2": "soft front", "diff": "similar"},
        },
        "category_scores": {
            "composition": 70,
            "subject": 92,
            "clothing_or_materials": 60,
            "environment": 90,
            "lighting_camera_style": 90,
        },
        "key_anchors": [
            {"label": "outfit category", "image1": "holter", "image2": "layered top"},
            {"label": "framing", "image1": "waist-up", "image2": "close-up"},
        ],
        "fidelity_score": 78,
        "transform_prompt": "Recompose into close-up, change outfit to layered top with cardigan",
        "uncertain": "",
    }


# ── unit tests ──────────────────────────────────────────────────────────────


def test_pair_compare_system_prompt_includes_critical_rules():
    """system prompt 에 spec §4.1.1 + §6.3 박제 규칙 포함."""
    # 영문 only 박제
    assert "Output English only" in PAIR_COMPARE_SYSTEM
    # boilerplate ban 박제 (spec §6.1)
    assert "golden hour" in PAIR_COMPARE_SYSTEM
    assert "85mm lens" in PAIR_COMPARE_SYSTEM
    assert "masterpiece" in PAIR_COMPARE_SYSTEM
    # score hard caps exact 문구 박제 (spec §6.3)
    assert "fidelity_score <= 82" in PAIR_COMPARE_SYSTEM
    assert "composition <= 85" in PAIR_COMPARE_SYSTEM
    assert "fidelity_score <= 78" in PAIR_COMPARE_SYSTEM
    assert "fidelity_score = null" in PAIR_COMPARE_SYSTEM
    # image evidence > observation 우선 박제
    assert "images" in PAIR_COMPARE_SYSTEM.lower()
    assert "hints" in PAIR_COMPARE_SYSTEM.lower()
    # identity/brand ban
    assert "celebrities" in PAIR_COMPARE_SYSTEM


def test_build_user_payload_with_hint():
    """compare_hint 가 있으면 user message 에 인용 형태로 포함."""
    payload = _build_user_payload(
        image1_w=512, image1_h=768,
        image2_w=1024, image2_h=1536,
        observation1=_fake_observation("a"),
        observation2=_fake_observation("b"),
        compare_hint="의상 변화에 집중",
    )
    # 크기 표시
    assert "512x768" in payload
    assert "1024x1536" in payload
    # 한국어 hint 그대로 인용 (vision 모델이 한국어 hint 받아도 영문 분석)
    assert '"의상 변화에 집중"' in payload
    # observation JSON 둘 다 들어감
    assert "a-appearance" in payload
    assert "b-appearance" in payload
    # checklist 박제 (spec §6.2)
    assert "Verification checklist" in payload
    assert "clothing" in payload.lower()
    assert "framing" in payload.lower()
    assert "gaze" in payload.lower()


def test_build_user_payload_without_hint_placeholder():
    """compare_hint 가 빈 문자열이면 placeholder (spec §6.2) 박제."""
    payload = _build_user_payload(
        image1_w=512, image1_h=512,
        image2_w=512, image2_h=512,
        observation1={},
        observation2={},
        compare_hint="",
    )
    assert "(not provided" in payload


def test_to_b64_helper():
    """sibling _to_b64 helper — bytes → ASCII base64."""
    result = _to_b64(b"\x89PNG_test")
    assert isinstance(result, str)
    # ASCII only (Ollama images 배열 요구사항)
    assert result.encode("ascii") == result.encode("ascii")  # raises if non-ascii
    # 라운드트립
    import base64
    assert base64.b64decode(result) == b"\x89PNG_test"


@pytest.mark.asyncio
async def test_payload_has_two_images_in_order():
    """payload 의 messages[-1]['images'] 가 [A, B] 순서로 2개 entry."""
    captured_payload: dict = {}

    async def fake_call(*, ollama_url: str, payload: dict, timeout: float, **kwargs) -> str:
        captured_payload.update(payload)
        return json.dumps(_full_v4_response())

    with patch(
        "studio.compare_pipeline_v4.pair_compare.call_chat_payload",
        new=AsyncMock(side_effect=fake_call),
    ):
        await compare_pair_with_vision(
            image1_bytes=b"\x89PNG_AAA",
            image2_bytes=b"\x89PNG_BBB",
            image1_w=512, image1_h=512,
            image2_w=512, image2_h=512,
            observation1=_fake_observation("a"),
            observation2=_fake_observation("b"),
            compare_hint="",
            vision_model="qwen3-vl:8b",
            text_model="gemma4-un:latest",
            timeout=120.0,
            ollama_url="http://localhost:11434",
            keep_alive="5m",
        )

    user_msg = captured_payload["messages"][-1]
    assert "images" in user_msg
    images = user_msg["images"]
    assert isinstance(images, list)
    assert len(images) == 2
    # A → B 순서 보존 (각각 base64 디코딩)
    import base64
    assert base64.b64decode(images[0]) == b"\x89PNG_AAA"
    assert base64.b64decode(images[1]) == b"\x89PNG_BBB"


@pytest.mark.asyncio
async def test_payload_format_json_and_chat_keep_alive_string():
    """format=json 강제 + keep_alive 는 chat API string 형식 (CLAUDE.md critical)."""
    captured: dict = {}

    async def fake_call(*, ollama_url: str, payload: dict, timeout: float, **kwargs) -> str:
        captured.update(payload)
        return json.dumps(_full_v4_response())

    with patch(
        "studio.compare_pipeline_v4.pair_compare.call_chat_payload",
        new=AsyncMock(side_effect=fake_call),
    ):
        await compare_pair_with_vision(
            image1_bytes=b"x", image2_bytes=b"y",
            image1_w=512, image1_h=512, image2_w=512, image2_h=512,
            observation1={}, observation2={},
            compare_hint="",
            vision_model="qwen3-vl:8b",
            text_model="gemma4-un:latest",
            timeout=60.0, ollama_url="http://localhost:11434",
            keep_alive="0",
        )

    assert captured["format"] == "json"
    # /api/chat keep_alive 는 string 형식만 (int 0 은 /api/generate 강제 unload 용)
    assert captured["keep_alive"] == "0"
    assert isinstance(captured["keep_alive"], str)


@pytest.mark.asyncio
async def test_success_returns_v4_with_observation_and_vision_model_filled():
    """정상 응답 시 result.observation1/2/vision_model 이 *함수 내부* 에서 채워짐."""
    obs1 = _fake_observation("img1")
    obs2 = _fake_observation("img2")

    with patch(
        "studio.compare_pipeline_v4.pair_compare.call_chat_payload",
        new=AsyncMock(return_value=json.dumps(_full_v4_response())),
    ):
        result = await compare_pair_with_vision(
            image1_bytes=b"x", image2_bytes=b"y",
            image1_w=512, image1_h=512, image2_w=512, image2_h=512,
            observation1=obs1, observation2=obs2,
            compare_hint="",
            vision_model="qwen3-vl:8b",
            text_model="gemma4-un:latest",
            timeout=60.0, ollama_url="http://localhost:11434",
        )

    # spec §4.1.1 박제 — 함수 내부 채움 검증
    assert result.observation1 == obs1
    assert result.observation2 == obs2
    assert result.vision_model == "qwen3-vl:8b"
    assert result.text_model == "gemma4-un:latest"
    # 정상 path
    assert result.provider == "ollama"
    assert result.fallback is False
    # V4 schema 정규화 정상
    assert result.summary_en.startswith("Both images")
    assert result.domain_match == "person"
    assert result.fidelity_score == 78
    assert len(result.category_diffs) == 5
    assert len(result.key_anchors) == 2


@pytest.mark.asyncio
async def test_mixed_domain_forces_null_scores():
    """mixed domain 은 모델이 점수를 줘도 score 불변식을 서버에서 강제."""
    response = _full_v4_response()
    response["domain_match"] = "mixed"
    response["category_diffs"] = {}
    response["category_scores"] = {
        "composition": 99,
        "subject": 88,
        "clothing_or_materials": 77,
        "environment": 66,
        "lighting_camera_style": 55,
    }
    response["fidelity_score"] = 91

    with patch(
        "studio.compare_pipeline_v4.pair_compare.call_chat_payload",
        new=AsyncMock(return_value=json.dumps(response)),
    ):
        result = await compare_pair_with_vision(
            image1_bytes=b"x", image2_bytes=b"y",
            image1_w=512, image1_h=512, image2_w=512, image2_h=512,
            observation1={"type": "portrait"}, observation2={"type": "landscape"},
            compare_hint="",
            vision_model="qwen3-vl:8b",
            text_model="gemma4-un:latest",
            timeout=60.0, ollama_url="http://localhost:11434",
        )

    assert result.domain_match == "mixed"
    assert result.category_diffs == {}
    assert result.fidelity_score is None
    assert all(v is None for v in result.category_scores.values())


@pytest.mark.asyncio
async def test_ollama_error_returns_fallback_preserving_observations():
    """Ollama 호출 예외 → fallback=True + observation 보존."""
    obs1 = _fake_observation("img1")
    obs2 = _fake_observation("img2")

    with patch(
        "studio.compare_pipeline_v4.pair_compare.call_chat_payload",
        new=AsyncMock(side_effect=RuntimeError("network down")),
    ):
        result = await compare_pair_with_vision(
            image1_bytes=b"x", image2_bytes=b"y",
            image1_w=512, image1_h=512, image2_w=512, image2_h=512,
            observation1=obs1, observation2=obs2,
            compare_hint="",
            vision_model="qwen3-vl:8b",
            text_model="gemma4-un:latest",
            timeout=60.0, ollama_url="http://localhost:11434",
        )

    assert result.fallback is True
    assert result.provider == "fallback"
    # observation 보존 (caller 가 fallback synthesize_diff 호출 시 재사용)
    assert result.observation1 == obs1
    assert result.observation2 == obs2
    assert result.vision_model == "qwen3-vl:8b"


@pytest.mark.asyncio
async def test_empty_response_returns_fallback():
    """빈 raw 응답 → fallback shape."""
    with patch(
        "studio.compare_pipeline_v4.pair_compare.call_chat_payload",
        new=AsyncMock(return_value=""),
    ):
        result = await compare_pair_with_vision(
            image1_bytes=b"x", image2_bytes=b"y",
            image1_w=512, image1_h=512, image2_w=512, image2_h=512,
            observation1={}, observation2={},
            compare_hint="",
            vision_model="qwen3-vl:8b",
            text_model="gemma4-un:latest",
            timeout=60.0, ollama_url="http://localhost:11434",
        )

    assert result.fallback is True


@pytest.mark.asyncio
async def test_parse_failure_returns_fallback():
    """JSON parse 실패 (raw 가 JSON 이 아님) → fallback shape."""
    with patch(
        "studio.compare_pipeline_v4.pair_compare.call_chat_payload",
        new=AsyncMock(return_value="this is not json at all 그냥 텍스트"),
    ):
        result = await compare_pair_with_vision(
            image1_bytes=b"x", image2_bytes=b"y",
            image1_w=512, image1_h=512, image2_w=512, image2_h=512,
            observation1={}, observation2={},
            compare_hint="",
            vision_model="qwen3-vl:8b",
            text_model="gemma4-un:latest",
            timeout=60.0, ollama_url="http://localhost:11434",
        )

    assert result.fallback is True


@pytest.mark.asyncio
async def test_payload_includes_observation_and_hint():
    """payload 의 user content 에 observation1/2 + compare_hint 가 포함."""
    captured: dict = {}

    async def fake_call(*, ollama_url: str, payload: dict, timeout: float, **kwargs) -> str:
        captured.update(payload)
        return json.dumps(_full_v4_response())

    with patch(
        "studio.compare_pipeline_v4.pair_compare.call_chat_payload",
        new=AsyncMock(side_effect=fake_call),
    ):
        await compare_pair_with_vision(
            image1_bytes=b"x", image2_bytes=b"y",
            image1_w=512, image1_h=512, image2_w=512, image2_h=512,
            observation1=_fake_observation("apple"),
            observation2=_fake_observation("banana"),
            compare_hint="의상 비교",
            vision_model="qwen3-vl:8b",
            text_model="gemma4-un:latest",
            timeout=60.0, ollama_url="http://localhost:11434",
        )

    user_content = captured["messages"][-1]["content"]
    assert "apple" in user_content
    assert "banana" in user_content
    assert "의상 비교" in user_content
    assert "Verification checklist" in user_content
