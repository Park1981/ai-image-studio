"""V4 결과 영문 → 한국어 일괄 번역 (flatten/unflatten)."""

import json
from unittest.mock import AsyncMock, patch

import pytest

from studio.compare_pipeline_v4._types import (
    CompareAnalysisResultV4,
    CompareCategoryDiff,
    CompareKeyAnchor,
)
from studio.compare_pipeline_v4.translate import translate_v4_result


def _sample_result() -> CompareAnalysisResultV4:
    return CompareAnalysisResultV4(
        summary_en="Both images show the same person.",
        summary_ko="",
        common_points_en=["same person", "same outfit"],
        common_points_ko=[],
        key_differences_en=["one eye closed"],
        key_differences_ko=[],
        domain_match="person",
        category_diffs={
            "composition": CompareCategoryDiff(
                image1="head-on", image2="3/4 view", diff="head turned",
            ),
        },
        category_scores={"composition": 85},
        key_anchors=[
            CompareKeyAnchor(label="eye state", image1="open", image2="closed"),
        ],
        fidelity_score=88,
        transform_prompt_en="close left eye",
        transform_prompt_ko="",
        uncertain_en="",
        uncertain_ko="",
        observation1={}, observation2={},
        provider="ollama", fallback=False,
        analyzed_at=0,
        vision_model="qwen3-vl:8b",
        text_model="gemma4-un:latest",
    )


@pytest.mark.asyncio
async def test_translate_v4_full_success():
    """모든 ko 슬롯이 채워짐."""
    fake_ko = json.dumps({
        "summary": "두 이미지는 같은 사람.",
        "commonPoints": ["같은 사람", "같은 옷"],
        "keyDifferences": ["한쪽 눈 감음"],
        "categoryDiffs": {
            "composition": {"image1": "정면", "image2": "3/4 측면", "diff": "고개 돌림"},
        },
        "keyAnchors": [
            {"label_kept": "eye state", "image1": "뜸", "image2": "감음"},
        ],
        "transformPrompt": "왼쪽 눈 감기",
        "uncertain": "",
    })

    with patch(
        "studio.compare_pipeline_v4.translate.call_chat_payload",
        new=AsyncMock(return_value=fake_ko),
    ):
        result = await translate_v4_result(
            _sample_result(),
            text_model="gemma4-un:latest",
            timeout=60.0,
            ollama_url="http://localhost:11434",
        )

    assert result.summary_ko == "두 이미지는 같은 사람."
    assert result.common_points_ko == ["같은 사람", "같은 옷"]
    assert result.key_differences_ko == ["한쪽 눈 감음"]
    assert result.category_diffs["composition"].image1_ko == "정면"
    assert result.category_diffs["composition"].diff_ko == "고개 돌림"
    assert result.key_anchors[0].image1_ko == "뜸"
    assert result.transform_prompt_ko == "왼쪽 눈 감기"


@pytest.mark.asyncio
async def test_translate_v4_failure_fallback_en_to_ko():
    """번역 실패 시 ko 슬롯이 en 값으로 fallback."""
    with patch(
        "studio.compare_pipeline_v4.translate.call_chat_payload",
        new=AsyncMock(return_value=""),
    ):
        result = await translate_v4_result(
            _sample_result(),
            text_model="gemma4-un:latest",
            timeout=60.0,
            ollama_url="http://localhost:11434",
        )

    # fallback: ko = en
    assert result.summary_ko == "Both images show the same person."
    assert result.common_points_ko == ["same person", "same outfit"]
    assert result.category_diffs["composition"].image1_ko == "head-on"
    assert result.transform_prompt_ko == "close left eye"


@pytest.mark.asyncio
async def test_translate_v4_label_not_translated():
    """key_anchor.label 은 번역 안 함 (en 그대로 유지)."""
    fake_ko = json.dumps({
        "summary": "테스트",
        "commonPoints": [], "keyDifferences": [], "categoryDiffs": {},
        "keyAnchors": [{"image1": "뜸", "image2": "감음"}],
        "transformPrompt": "", "uncertain": "",
    })

    with patch(
        "studio.compare_pipeline_v4.translate.call_chat_payload",
        new=AsyncMock(return_value=fake_ko),
    ):
        result = await translate_v4_result(
            _sample_result(),
            text_model="gemma4-un:latest",
            timeout=60.0,
            ollama_url="http://localhost:11434",
        )

    # label 은 en 그대로
    assert result.key_anchors[0].label == "eye state"
    assert result.key_anchors[0].image1_ko == "뜸"
