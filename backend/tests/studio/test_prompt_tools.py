"""
Phase 5 (2026-05-01) — split_prompt_cards + translate_prompt 테스트.

검증:
- split_prompt_cards 가 think:false / format:json / temperature 0 / num_predict 1024
- 빈 입력 / 빈 응답 / JSON 파싱 실패 / 정규화 실패 → fallback=True (4 분기)
- _normalize_sections 가 알 수 없는 key 를 'etc' 로 정규화
- 평탄한 dict {key: text} 응답도 list 변환
- translate_prompt direction="ko" / "en" 분기 (SYSTEM 다름)
- 빈 입력 / 빈 응답 / 호출 실패 → fallback=True + translated=원문
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from backend.studio.prompt_pipeline import _ollama as ollama_mod
from backend.studio.prompt_pipeline import (
    PromptSection,
    split_prompt_cards,
    translate_prompt,
)
from backend.studio.prompt_pipeline.tools import _normalize_sections


# ───── _normalize_sections (순수 함수) ─────


def test_normalize_sections_standard_shape() -> None:
    parsed = {
        "sections": [
            {"key": "subject", "text": "20yo Korean woman"},
            {"key": "face", "text": "symmetrical face"},
        ]
    }
    out = _normalize_sections(parsed)
    assert out == [
        PromptSection(key="subject", text="20yo Korean woman"),
        PromptSection(key="face", text="symmetrical face"),
    ]


def test_normalize_sections_unknown_key_falls_back_to_etc() -> None:
    parsed = {
        "sections": [
            {"key": "weird_unknown", "text": "phrase 1"},
            {"key": "FACE", "text": "phrase 2"},  # case insensitive
        ]
    }
    out = _normalize_sections(parsed)
    assert out[0].key == "etc"  # weird_unknown → etc
    assert out[1].key == "face"  # FACE → face (lowercased)


def test_normalize_sections_skips_empty_text() -> None:
    parsed = {
        "sections": [
            {"key": "subject", "text": ""},
            {"key": "face", "text": "  "},  # whitespace only
            {"key": "outfit", "text": "red dress"},
        ]
    }
    out = _normalize_sections(parsed)
    assert len(out) == 1
    assert out[0].key == "outfit"


def test_normalize_sections_flat_dict_fallback() -> None:
    """모델이 sections 배열 대신 평탄한 {key: text} 반환한 케이스."""
    parsed = {"subject": "20yo woman", "face": "sharp jawline"}
    out = _normalize_sections(parsed)
    keys = [s.key for s in out]
    assert "subject" in keys
    assert "face" in keys


def test_normalize_sections_invalid_input() -> None:
    """parsed 가 list/dict 둘 다 아니면 빈 리스트."""
    assert _normalize_sections("not a dict") == []
    assert _normalize_sections(None) == []
    assert _normalize_sections(42) == []


# ───── split_prompt_cards — payload + fallback 분기 ─────


def _make_capture():
    captured: dict[str, Any] = {"calls": []}

    async def fake(**kwargs: Any) -> str:
        captured["calls"].append(kwargs)
        if "raise" in captured:
            raise captured["raise"]
        return captured.get("response", "")

    return captured, fake


@pytest.mark.asyncio
async def test_split_payload_uses_json_format_temp0_thinkfalse() -> None:
    captured, fake = _make_capture()
    captured["response"] = (
        '{"sections":[{"key":"subject","text":"a young Korean woman"}]}'
    )
    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake):
        result = await split_prompt_cards("a young Korean woman, K-pop idol look")

    assert result.fallback is False
    assert result.provider == "ollama"
    assert len(result.sections) == 1
    assert result.sections[0].key == "subject"

    call = captured["calls"][0]
    assert call["think"] is False
    assert call["format"] == "json"
    assert call["temperature"] == 0.0
    assert call["num_predict"] == 1024
    assert call["timeout"] == 60.0


@pytest.mark.asyncio
async def test_split_empty_input() -> None:
    result = await split_prompt_cards("")
    assert result.fallback is True
    assert result.sections == []
    assert result.provider == "fallback"


@pytest.mark.asyncio
async def test_split_ollama_failure() -> None:
    captured, fake = _make_capture()
    captured["raise"] = RuntimeError("ollama down")
    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake):
        result = await split_prompt_cards("test prompt")
    assert result.fallback is True
    assert result.error and "Ollama 호출 실패" in result.error


@pytest.mark.asyncio
async def test_split_invalid_json() -> None:
    captured, fake = _make_capture()
    captured["response"] = "this is not JSON"
    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake):
        result = await split_prompt_cards("test prompt")
    assert result.fallback is True
    assert result.error and "JSON 파싱" in result.error


@pytest.mark.asyncio
async def test_split_empty_sections_falls_back() -> None:
    """모델이 빈 sections 배열 반환 → fallback (UI 가 빈 카드 안 그리게)."""
    captured, fake = _make_capture()
    captured["response"] = '{"sections": []}'
    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake):
        result = await split_prompt_cards("test prompt")
    assert result.fallback is True
    assert result.sections == []


# ───── translate_prompt — direction 분기 + fallback ─────


@pytest.mark.asyncio
async def test_translate_ko_direction_uses_korean_system() -> None:
    captured, fake = _make_capture()
    captured["response"] = "한국 여자, K팝 아이돌 룩"
    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake):
        result = await translate_prompt(
            "Korean woman, K-pop idol look", direction="ko"
        )
    assert result.fallback is False
    assert result.translated == "한국 여자, K팝 아이돌 룩"
    assert result.direction == "ko"
    # SYSTEM 안에 "Korean" 있어야 (영→한 SYSTEM 사용 검증)
    call = captured["calls"][0]
    assert "Korean" in call["system"]


@pytest.mark.asyncio
async def test_translate_en_direction_uses_english_system() -> None:
    captured, fake = _make_capture()
    captured["response"] = "Korean woman, K-pop idol look"
    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake):
        result = await translate_prompt(
            "한국 여자, K팝 아이돌 룩", direction="en"
        )
    assert result.fallback is False
    assert result.translated == "Korean woman, K-pop idol look"
    assert result.direction == "en"
    call = captured["calls"][0]
    # 한→영 SYSTEM 은 "English" 명시
    assert "English" in call["system"]


@pytest.mark.asyncio
async def test_translate_empty_input() -> None:
    result = await translate_prompt("", direction="ko")
    assert result.fallback is True
    assert result.translated == ""


@pytest.mark.asyncio
async def test_translate_failure_returns_original() -> None:
    """호출 실패 → translated=원문 + fallback=True (UI 가 원문 그대로 표시)."""
    captured, fake = _make_capture()
    captured["raise"] = TimeoutError("ollama timeout")
    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake):
        result = await translate_prompt("test prompt", direction="ko")
    assert result.fallback is True
    assert result.translated == "test prompt"
