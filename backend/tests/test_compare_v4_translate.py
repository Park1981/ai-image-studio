"""V4 결과 영문 → 한국어 일괄 번역 (flatten/unflatten · 평탄 k1/k2/... 계약)."""

import json
from unittest.mock import AsyncMock, patch

import pytest

from studio.compare_pipeline_v4._types import (
    CompareAnalysisResultV4,
    CompareCategoryDiff,
    CompareKeyAnchor,
)
from studio.compare_pipeline_v4.translate import (
    _flatten_strings,
    _has_korean_chars,
    translate_v4_result,
)


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


def test_flatten_strings_assigns_sequential_keys():
    """_flatten_strings 는 모든 *_en 슬롯을 k1, k2, ... 순서로 매핑."""
    flat_keys, flat_input = _flatten_strings(_sample_result())
    # 빈 uncertain 은 skip 됨
    assert "k1" in flat_input  # summary
    assert "k2" in flat_input  # common[0]
    # summary, common×2, diff×1, cat×3, anchor×2, transform = 10
    assert len(flat_input) == 10
    assert flat_input["k1"] == "Both images show the same person."
    assert flat_input["k10"] == "close left eye"


def test_has_korean_chars():
    assert _has_korean_chars("두 이미지는 같습니다") is True
    assert _has_korean_chars("Both images") is False
    assert _has_korean_chars("Mixed 한글 text") is True
    assert _has_korean_chars("") is False


@pytest.mark.asyncio
async def test_translate_v4_full_success():
    """모든 ko 슬롯이 채워짐 (평탄 k1/k2/... 응답)."""
    fake_ko = json.dumps({
        "k1": "두 이미지는 같은 사람.",
        "k2": "같은 사람",
        "k3": "같은 옷",
        "k4": "한쪽 눈 감음",
        "k5": "정면",
        "k6": "3/4 측면",
        "k7": "고개 돌림",
        "k8": "뜸",
        "k9": "감음",
        "k10": "왼쪽 눈 감기",
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
    assert result.category_diffs["composition"].image2_ko == "3/4 측면"
    assert result.category_diffs["composition"].diff_ko == "고개 돌림"
    assert result.key_anchors[0].image1_ko == "뜸"
    assert result.key_anchors[0].image2_ko == "감음"
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
async def test_translate_v4_label_preserved_en():
    """key_anchor.label 은 _flatten_strings 가 포함 안 시킴 → en 그대로."""
    fake_ko = json.dumps({
        "k1": "테스트 요약",
        "k2": "공통점 1",
        "k3": "공통점 2",
        "k4": "차이점 1",
        "k5": "정면",
        "k6": "3/4 측면",
        "k7": "고개 돌림",
        "k8": "뜸",
        "k9": "감음",
        "k10": "왼쪽 눈 감기",
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

    # label 은 항상 en 그대로 (번역 시도 X)
    assert result.key_anchors[0].label == "eye state"
    # image1/image2 는 한국어
    assert result.key_anchors[0].image1_ko == "뜸"
    assert result.key_anchors[0].image2_ko == "감음"


@pytest.mark.asyncio
async def test_translate_v4_english_echo_falls_back():
    """모델이 영문 echo / paraphrase 시 한글 검증으로 차단 → en fallback."""
    # 모든 value 가 영어 (한글 0자) → fallback
    fake_ko = json.dumps({
        "k1": "Two images of same person",  # paraphrase (echo 변형)
        "k2": "same person",  # exact echo
        "k3": "same outfit",
        "k4": "one eye closed",
        "k5": "head-on",
        "k6": "3/4 view",
        "k7": "head turned",
        "k8": "open",
        "k9": "closed",
        "k10": "close left eye",
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

    # 한글 char 없으므로 모두 en 으로 fallback
    assert result.summary_ko == "Both images show the same person."
    assert result.common_points_ko == ["same person", "same outfit"]
    assert result.category_diffs["composition"].image1_ko == "head-on"


@pytest.mark.asyncio
async def test_translate_v4_retry_recovers_english_echo():
    """1차 응답이 영어 echo 여도 retry 가 한국어 슬롯을 복구."""
    first_echo = json.dumps({
        "k1": "Both images show the same person.",
        "k2": "same person",
        "k3": "same outfit",
        "k4": "one eye closed",
        "k5": "head-on",
        "k6": "3/4 view",
        "k7": "head turned",
        "k8": "open",
        "k9": "closed",
        "k10": "close left eye",
    })
    retry_ko = json.dumps({
        "k1": "두 이미지는 같은 사람을 보여줍니다.",
        "k2": "같은 사람",
        "k3": "같은 의상",
        "k4": "한쪽 눈을 감음",
        "k5": "정면",
        "k6": "3/4 측면",
        "k7": "고개가 돌아감",
        "k8": "뜬 상태",
        "k9": "감은 상태",
        "k10": "왼쪽 눈을 감기",
    })
    chat = AsyncMock(side_effect=[first_echo, retry_ko])

    with patch(
        "studio.compare_pipeline_v4.translate.call_chat_payload",
        new=chat,
    ):
        result = await translate_v4_result(
            _sample_result(),
            text_model="gemma4-un:latest",
            timeout=60.0,
            ollama_url="http://localhost:11434",
        )

    assert chat.await_count == 2
    assert result.summary_ko == "두 이미지는 같은 사람을 보여줍니다."
    assert result.common_points_ko == ["같은 사람", "같은 의상"]
    assert result.transform_prompt_ko == "왼쪽 눈을 감기"


@pytest.mark.asyncio
async def test_translate_v4_partial_korean_partial_echo():
    """일부 슬롯만 번역 / 일부는 echo — 슬롯별로 한글 검증 적용."""
    fake_ko = json.dumps({
        "k1": "두 이미지는 같은 사람.",     # 한국어 OK
        "k2": "같은 사람",                  # OK
        "k3": "same outfit",                # echo (한글 X) → fallback
        "k4": "한쪽 눈 감음",               # OK
        "k5": "정면",                        # OK
        "k6": "3/4 view",                   # echo → fallback
        "k7": "고개 돌림",                  # OK
        "k8": "뜸",
        "k9": "감음",
        "k10": "close left eye",            # echo → fallback
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

    # 한국어 슬롯은 번역
    assert result.summary_ko == "두 이미지는 같은 사람."
    assert result.common_points_ko[0] == "같은 사람"
    # echo 슬롯은 en fallback (한글 char 없음 차단)
    assert result.common_points_ko[1] == "same outfit"
    assert result.category_diffs["composition"].image2_ko == "3/4 view"
    assert result.transform_prompt_ko == "close left eye"
