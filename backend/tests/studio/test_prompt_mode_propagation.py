"""
Phase 2 (2026-05-01) — promptMode 전파 + fallback-precise-failed 테스트.

검증 대상:
- _resolve_mode_options 의 fast / precise / unknown 정규화
- upgrade_generate_prompt(prompt_mode="precise") payload 가 think:true + num_predict 4096
- upgrade_*_prompt 실패 시 precise → provider="fallback-precise-failed", fast → "fallback"
- upgrade_*_prompt 기본 호출 (mode 미전달) payload 가 Phase 1 이전과 동일
- clarify_edit_intent(prompt_mode="precise") payload 가 think:true 전달
- translate_to_korean 은 prompt_mode 인자 없이 항상 think:false (정책 §4.4)
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from backend.studio.prompt_pipeline import (
    _resolve_mode_options,
    clarify_edit_intent,
    translate_to_korean,
    upgrade_edit_prompt,
    upgrade_generate_prompt,
    upgrade_video_prompt,
)
from backend.studio.prompt_pipeline import _ollama as ollama_mod


# ───── _resolve_mode_options ─────


def test_resolve_mode_fast_default() -> None:
    """fast (기본) → think False / num_predict 800 / timeout 그대로."""
    opts = _resolve_mode_options("fast", base_timeout=240.0)
    assert opts == {"think": False, "num_predict": 800, "timeout": 240.0}


def test_resolve_mode_unknown_falls_back_to_fast() -> None:
    """미인식 값 / None → fast 로 정규화."""
    assert _resolve_mode_options(None, base_timeout=60.0) == {
        "think": False, "num_predict": 800, "timeout": 60.0
    }
    assert _resolve_mode_options("nonsense", base_timeout=60.0) == {
        "think": False, "num_predict": 800, "timeout": 60.0
    }


def test_resolve_mode_precise() -> None:
    """precise → think True / num_predict 4096 / timeout 하한 120s."""
    # 짧은 caller timeout 은 120 으로 끌어올림
    opts = _resolve_mode_options("precise", base_timeout=60.0)
    assert opts == {"think": True, "num_predict": 4096, "timeout": 120.0}
    # caller timeout 이 더 크면 그대로 보존
    opts2 = _resolve_mode_options("precise", base_timeout=240.0)
    assert opts2 == {"think": True, "num_predict": 4096, "timeout": 240.0}


# ───── upgrade_generate_prompt — payload + provider ─────


def _make_capture():
    """_call_ollama_chat 호출을 가로채 (kwargs, raise_error) 반환."""
    captured: dict[str, Any] = {"calls": []}

    async def fake_call(**kwargs: Any) -> str:
        captured["calls"].append(kwargs)
        if captured.get("raise"):
            raise captured["raise"]
        return captured.get("response", "Upgraded English prompt")

    return captured, fake_call


@pytest.mark.asyncio
async def test_upgrade_generate_default_uses_fast_mode() -> None:
    """기본 호출 (mode 미전달) → think=False, num_predict=800 (회귀 보호)."""
    captured, fake_call = _make_capture()
    # translate_to_korean 도 같은 _call_ollama_chat 거치므로 한 번에 mock.
    captured["response"] = "ok"

    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake_call):
        result = await upgrade_generate_prompt(prompt="cat in space")

    assert result.fallback is False
    assert result.provider == "ollama"
    # 첫 호출 = upgrade (translate 는 두 번째 호출 — include_translation=True)
    upgrade_call = captured["calls"][0]
    assert upgrade_call["think"] is False
    assert upgrade_call["num_predict"] == 800


@pytest.mark.asyncio
async def test_upgrade_generate_precise_mode_sets_think_and_num_predict() -> None:
    """precise → think=True, num_predict=4096, timeout 하한 120s."""
    captured, fake_call = _make_capture()
    captured["response"] = "ok"

    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake_call):
        await upgrade_generate_prompt(
            prompt="cat in space",
            timeout=60.0,  # < 120s → 정밀 시 자동 하한 적용
            prompt_mode="precise",
        )

    upgrade_call = captured["calls"][0]
    assert upgrade_call["think"] is True
    assert upgrade_call["num_predict"] == 4096
    assert upgrade_call["timeout"] == 120.0


@pytest.mark.asyncio
async def test_upgrade_generate_fast_failure_provider_fallback() -> None:
    """fast 모드 실패 → provider='fallback' (옛 동작 유지)."""
    captured, fake_call = _make_capture()
    captured["raise"] = RuntimeError("ollama down")

    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake_call):
        result = await upgrade_generate_prompt(prompt="cat in space")

    assert result.fallback is True
    assert result.provider == "fallback"


@pytest.mark.asyncio
async def test_upgrade_generate_precise_failure_marks_provider_distinctly() -> None:
    """precise 모드 실패 → provider='fallback-precise-failed' (Phase 2 신규)."""
    captured, fake_call = _make_capture()
    captured["raise"] = RuntimeError("precise call timed out")

    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake_call):
        result = await upgrade_generate_prompt(
            prompt="cat in space", prompt_mode="precise"
        )

    assert result.fallback is True
    assert result.provider == "fallback-precise-failed"


# ───── upgrade_edit_prompt + upgrade_video_prompt 동일 동작 보장 ─────


@pytest.mark.asyncio
async def test_upgrade_edit_precise_failure_marks_provider() -> None:
    captured, fake_call = _make_capture()
    captured["raise"] = ValueError("Empty response from Ollama")

    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake_call):
        result = await upgrade_edit_prompt(
            edit_instruction="change outfit",
            image_description="a model",
            prompt_mode="precise",
        )

    assert result.provider == "fallback-precise-failed"


@pytest.mark.asyncio
async def test_upgrade_video_precise_failure_marks_provider() -> None:
    captured, fake_call = _make_capture()
    captured["raise"] = ValueError("Empty response from Ollama")

    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake_call):
        result = await upgrade_video_prompt(
            user_direction="zoom in slowly",
            image_description="a person",
            prompt_mode="precise",
        )

    assert result.provider == "fallback-precise-failed"


# ───── clarify_edit_intent — 모드 전파 ─────


@pytest.mark.asyncio
async def test_clarify_intent_precise_sets_think() -> None:
    captured, fake_call = _make_capture()
    captured["response"] = "Change the outfit only."

    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake_call):
        result = await clarify_edit_intent(
            "옷만 바꿔줘", prompt_mode="precise", timeout=60.0,
        )

    assert result == "Change the outfit only."
    call = captured["calls"][0]
    assert call["think"] is True
    assert call["num_predict"] == 4096


@pytest.mark.asyncio
async def test_clarify_intent_default_fast() -> None:
    captured, fake_call = _make_capture()
    captured["response"] = "Change the outfit only."

    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake_call):
        await clarify_edit_intent("옷만 바꿔줘")

    call = captured["calls"][0]
    assert call["think"] is False
    assert call["num_predict"] == 800


# ───── translate_to_korean — 항상 fast 정책 ─────


@pytest.mark.asyncio
async def test_translate_always_fast_no_mode_arg() -> None:
    """spec §4.4 — 번역은 prompt_mode 인자 없음. think 미명시 → 기본 False (fast)."""
    captured, fake_call = _make_capture()
    captured["response"] = "한국어 번역"

    with patch.object(ollama_mod, "_call_ollama_chat", side_effect=fake_call):
        await translate_to_korean("Cat in space")

    call = captured["calls"][0]
    # translate 는 _call_ollama_chat 의 think/num_predict 인자를 *명시 안 함* —
    # 즉 _call_ollama_chat 의 기본값 (think=False, num_predict=800) 으로 호출됨.
    # mode 분기 인자가 절대 들어가지 않는 것 자체가 정책 보호 (think 키가 kwargs 에 없어야 함).
    assert "think" not in call
    assert "num_predict" not in call
