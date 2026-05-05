"""diff_synthesize — DIFF_SYNTHESIZE_SYSTEM 프롬프트 + 응답 파싱."""

import json
from unittest.mock import AsyncMock, patch

import pytest

from studio.compare_pipeline_v4.diff_synthesize import (
    DIFF_SYNTHESIZE_SYSTEM,
    synthesize_diff,
)
from studio.compare_pipeline_v4._types import CompareAnalysisResultV4


# ── 시스템 프롬프트 룰 박제 ──
def test_system_prompt_has_boilerplate_ban():
    """vision_pipeline 정공법: boilerplate 금지 명시."""
    assert "golden hour" in DIFF_SYNTHESIZE_SYSTEM
    assert "85mm lens" in DIFF_SYNTHESIZE_SYSTEM


def test_system_prompt_has_anchor_fidelity_rules():
    assert "Anchor Fidelity" in DIFF_SYNTHESIZE_SYSTEM or "do not generalize" in DIFF_SYNTHESIZE_SYSTEM.lower()


def test_system_prompt_has_strict_json_keys_required():
    assert "category_diffs" in DIFF_SYNTHESIZE_SYSTEM
    assert "key_anchors" in DIFF_SYNTHESIZE_SYSTEM
    assert "fidelity_score" in DIFF_SYNTHESIZE_SYSTEM


def test_system_prompt_has_identity_brand_ban():
    assert "brand" in DIFF_SYNTHESIZE_SYSTEM.lower() or "identity" in DIFF_SYNTHESIZE_SYSTEM.lower()


# ── synthesize_diff: 정상 응답 ──
@pytest.mark.asyncio
async def test_synthesize_diff_full_response():
    fake_response = json.dumps({
        "summary": "Both show the same person; image2 is winking.",
        "common_points": ["same person", "same outfit"],
        "key_differences": ["one eye closed", "head turned slightly"],
        "domain_match": "person",
        "category_diffs": {
            "composition": {"image1": "head-on", "image2": "3/4 view", "diff": "head turned"},
            "subject": {"image1": "both eyes open", "image2": "left eye closed", "diff": "winking"},
            "clothing_or_materials": {"image1": "white tank", "image2": "white tank", "diff": "identical"},
            "environment": {"image1": "studio", "image2": "studio", "diff": "identical"},
            "lighting_camera_style": {"image1": "softbox", "image2": "softbox", "diff": "identical"},
        },
        "category_scores": {
            "composition": 85, "subject": 70, "clothing_or_materials": 100,
            "environment": 100, "lighting_camera_style": 95,
        },
        "key_anchors": [
            {"label": "eye state", "image1": "both eyes open", "image2": "left eye closed"},
        ],
        "fidelity_score": 88,
        "transform_prompt": "close left eye, turn head 30 degrees",
        "uncertain": "",
    })

    with patch(
        "studio.compare_pipeline_v4.diff_synthesize.call_chat_payload",
        new=AsyncMock(return_value=fake_response),
    ):
        result = await synthesize_diff(
            observation1={"raw1": "obs1"},
            observation2={"raw2": "obs2"},
            compare_hint="",
            text_model="gemma4-un:latest",
            timeout=120.0,
            ollama_url="http://localhost:11434",
        )

    assert isinstance(result, CompareAnalysisResultV4)
    assert result.domain_match == "person"
    assert result.fidelity_score == 88
    assert "composition" in result.category_diffs
    assert result.category_diffs["composition"].diff == "head turned"
    assert result.category_scores["subject"] == 70
    assert len(result.key_anchors) == 1
    assert result.key_anchors[0].label == "eye state"


# ── mixed 도메인 fallback ──
@pytest.mark.asyncio
async def test_synthesize_diff_mixed_domain_empty_category_diffs():
    fake_response = json.dumps({
        "summary": "image1 is a portrait, image2 is a landscape.",
        "common_points": ["both photographic"],
        "key_differences": ["subject vs scene", "different palettes"],
        "domain_match": "mixed",
        "category_diffs": {},                  # 빈 dict — STRICT JSON 룰
        "category_scores": {},
        "key_anchors": [
            {"label": "subject type", "image1": "person", "image2": "mountain landscape"},
            {"label": "color palette", "image1": "warm skin tones", "image2": "cool blue/grey"},
        ],
        "fidelity_score": None,                # mixed → null
        "transform_prompt": "replace subject with landscape composition",
        "uncertain": "",
    })

    with patch(
        "studio.compare_pipeline_v4.diff_synthesize.call_chat_payload",
        new=AsyncMock(return_value=fake_response),
    ):
        result = await synthesize_diff(
            observation1={}, observation2={}, compare_hint="",
            text_model="gemma4-un:latest", timeout=120.0,
            ollama_url="http://localhost:11434",
        )

    assert result.domain_match == "mixed"
    assert result.category_diffs == {}
    assert result.fidelity_score is None
    assert len(result.key_anchors) == 2


# ── parse 실패 fallback ──
@pytest.mark.asyncio
async def test_synthesize_diff_parse_failed_fallback():
    with patch(
        "studio.compare_pipeline_v4.diff_synthesize.call_chat_payload",
        new=AsyncMock(return_value="not json {{"),
    ):
        result = await synthesize_diff(
            observation1={}, observation2={}, compare_hint="",
            text_model="gemma4-un:latest", timeout=120.0,
            ollama_url="http://localhost:11434",
        )

    assert result.fallback is True
    assert result.provider == "fallback"
    assert result.summary_en == ""
    assert result.fidelity_score is None
    assert result.category_diffs == {}


# ── 빈 응답 fallback ──
@pytest.mark.asyncio
async def test_synthesize_diff_empty_response_fallback():
    with patch(
        "studio.compare_pipeline_v4.diff_synthesize.call_chat_payload",
        new=AsyncMock(return_value=""),
    ):
        result = await synthesize_diff(
            observation1={}, observation2={}, compare_hint="",
            text_model="gemma4-un:latest", timeout=120.0,
            ollama_url="http://localhost:11434",
        )

    assert result.fallback is True


# ── compare_hint 처리 ──
@pytest.mark.asyncio
async def test_synthesize_diff_with_hint_passes_to_user_payload():
    """hint 가 user payload 에 포함되고 빈 hint 는 placeholder 로 변환."""
    fake_response = json.dumps({
        "summary": "", "common_points": [], "key_differences": [],
        "domain_match": "person",
        "category_diffs": {k: {"image1": "", "image2": "", "diff": ""} for k in
                           ["composition", "subject", "clothing_or_materials", "environment", "lighting_camera_style"]},
        "category_scores": {},
        "key_anchors": [], "fidelity_score": None,
        "transform_prompt": "", "uncertain": "",
    })

    captured_payloads = []

    async def capture_payload(*, ollama_url, payload, timeout, **kwargs):
        captured_payloads.append(payload)
        return fake_response

    with patch(
        "studio.compare_pipeline_v4.diff_synthesize.call_chat_payload",
        new=capture_payload,
    ):
        await synthesize_diff(
            observation1={}, observation2={}, compare_hint="얼굴 표정만 집중",
            text_model="gemma4-un:latest", timeout=120.0,
            ollama_url="http://localhost:11434",
        )

    assert len(captured_payloads) == 1
    user_msg = captured_payloads[0]["messages"][1]["content"]
    assert "얼굴 표정만 집중" in user_msg

    # 빈 hint 는 (not provided) 로 변환
    captured_payloads.clear()
    with patch(
        "studio.compare_pipeline_v4.diff_synthesize.call_chat_payload",
        new=capture_payload,
    ):
        await synthesize_diff(
            observation1={}, observation2={}, compare_hint="",
            text_model="gemma4-un:latest", timeout=120.0,
            ollama_url="http://localhost:11434",
        )
    assert "not provided" in captured_payloads[0]["messages"][1]["content"].lower()
