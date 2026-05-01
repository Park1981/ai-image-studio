"""
Phase 1 (2026-05-01) — _ollama_client.extract_chat_content +
prompt_pipeline._ollama._call_ollama_chat 호출 옵션화 테스트.

회귀 보호:
- think=False (기본) 호출이 thinking-fallback 활성 (기존 동작 유지)
- payload 기본 형태가 기존과 동일

신규 보호:
- think=True 호출이 thinking-fallback 차단 (reasoning 누출 방지)
- think / num_predict / format 등 옵션이 payload 에 정확히 반영
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from backend.studio._ollama_client import extract_chat_content
from backend.studio.prompt_pipeline import _ollama as ollama_mod


# ───── extract_chat_content ─────


def test_extract_uses_content_when_present() -> None:
    """content 가 있으면 thinking 무시하고 content 반환."""
    data = {"message": {"content": "hello", "thinking": "internal"}}
    assert extract_chat_content(data) == "hello"
    assert extract_chat_content(data, allow_thinking_fallback=False) == "hello"


def test_extract_thinking_fallback_default_true() -> None:
    """기본값(=True) 은 content 비면 thinking 사용 — 회귀 보호."""
    data = {"message": {"content": "", "thinking": "fallback-text"}}
    assert extract_chat_content(data) == "fallback-text"


def test_extract_thinking_fallback_false_blocks() -> None:
    """think=True 호출은 thinking 결과 인정 X (spec §5.2)."""
    data = {"message": {"content": "", "thinking": "should-be-ignored"}}
    assert extract_chat_content(data, allow_thinking_fallback=False) == ""


def test_extract_empty_message() -> None:
    """message 자체가 없거나 빈 딕셔너리면 빈 문자열."""
    assert extract_chat_content({}) == ""
    assert extract_chat_content({"message": None}) == ""
    assert extract_chat_content({"message": "wrong-type"}) == ""


# ───── _call_ollama_chat payload 검증 ─────


@pytest.mark.asyncio
async def test_call_chat_default_payload_unchanged() -> None:
    """think=False 기본 호출 payload 가 Phase 1 이전과 동일 (회귀 보호)."""
    captured: dict[str, Any] = {}

    async def fake_call(
        *,
        ollama_url: str,
        payload: dict[str, Any],
        timeout: float,
        allow_thinking_fallback: bool = True,
    ) -> str:
        captured["payload"] = payload
        captured["allow_thinking_fallback"] = allow_thinking_fallback
        captured["timeout"] = timeout
        return "ok"

    with patch.object(ollama_mod, "call_chat_payload", side_effect=fake_call):
        result = await ollama_mod._call_ollama_chat(
            ollama_url="http://localhost:11434",
            model="gemma4-un:latest",
            system="sys",
            user="usr",
            timeout=60.0,
        )
    assert result == "ok"

    payload = captured["payload"]
    assert payload["model"] == "gemma4-un:latest"
    assert payload["stream"] is False
    assert payload["think"] is False
    assert payload["keep_alive"] == "0"
    assert "format" not in payload  # 기본 호출은 format 미동봉
    assert payload["options"] == {
        "num_ctx": 8192,
        "temperature": 0.6,
        "top_p": 0.92,
        "repeat_penalty": 1.18,
        "num_predict": 800,
    }
    assert payload["messages"] == [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "usr"},
    ]
    # think=False → fallback 활성 (기존 동작)
    assert captured["allow_thinking_fallback"] is True


@pytest.mark.asyncio
async def test_call_chat_precise_mode_blocks_thinking_fallback() -> None:
    """think=True + num_predict 상향 → fallback 자동 차단 + payload 반영."""
    captured: dict[str, Any] = {}

    async def fake_call(
        *,
        ollama_url: str,
        payload: dict[str, Any],
        timeout: float,
        allow_thinking_fallback: bool = True,
    ) -> str:
        captured["payload"] = payload
        captured["allow_thinking_fallback"] = allow_thinking_fallback
        return "precise-ok"

    with patch.object(ollama_mod, "call_chat_payload", side_effect=fake_call):
        await ollama_mod._call_ollama_chat(
            ollama_url="http://localhost:11434",
            model="gemma4-un:latest",
            system="sys",
            user="usr",
            timeout=120.0,
            think=True,
            num_predict=4096,
        )

    payload = captured["payload"]
    assert payload["think"] is True
    assert payload["options"]["num_predict"] == 4096
    # think=True → fallback 차단 (spec §5.2 / CLAUDE.md Critical)
    assert captured["allow_thinking_fallback"] is False


@pytest.mark.asyncio
async def test_call_chat_format_optional() -> None:
    """format 인자는 미전달 시 payload 에 없음 / 전달 시 포함."""
    captured: dict[str, Any] = {}

    async def fake_call(
        *,
        ollama_url: str,
        payload: dict[str, Any],
        timeout: float,
        allow_thinking_fallback: bool = True,
    ) -> str:
        captured["payload"] = payload
        return "ok"

    with patch.object(ollama_mod, "call_chat_payload", side_effect=fake_call):
        await ollama_mod._call_ollama_chat(
            ollama_url="http://x",
            model="m",
            system="s",
            user="u",
            timeout=30.0,
            format="json",
        )

    assert captured["payload"]["format"] == "json"


@pytest.mark.asyncio
async def test_call_chat_custom_temperature_top_p_repeat() -> None:
    """temperature / top_p / repeat_penalty 도 payload options 에 반영."""
    captured: dict[str, Any] = {}

    async def fake_call(
        *,
        ollama_url: str,
        payload: dict[str, Any],
        timeout: float,
        allow_thinking_fallback: bool = True,
    ) -> str:
        captured["payload"] = payload
        return "ok"

    with patch.object(ollama_mod, "call_chat_payload", side_effect=fake_call):
        await ollama_mod._call_ollama_chat(
            ollama_url="http://x",
            model="m",
            system="s",
            user="u",
            timeout=30.0,
            temperature=0.0,
            top_p=1.0,
            repeat_penalty=1.0,
        )

    opts = captured["payload"]["options"]
    assert opts["temperature"] == 0.0
    assert opts["top_p"] == 1.0
    assert opts["repeat_penalty"] == 1.0
