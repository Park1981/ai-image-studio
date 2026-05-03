# backend/tests/test_prompt_synthesize.py
"""prompt_synthesize — Ollama 호출 mock 기반 단위 테스트."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from studio.vision_pipeline.prompt_synthesize import (
    PROMPT_SYNTHESIZE_SYSTEM,
    synthesize_prompt,
)


@pytest.mark.asyncio
class TestPromptSynthesize:
    """합성 단계 — Ollama text model mock + 5 슬롯 결과."""

    async def test_returns_5_slots_on_success(self) -> None:
        """정상 응답 → 5 슬롯 (summary/positive/negative/anchors/uncertain) 반환."""
        mock_response = {
            "summary": "An East Asian young adult woman at a music festival.",
            "positive_prompt": "young adult woman, East Asian features, ...",
            "negative_prompt": "smiling, dry hair, studio background, blurry",
            "key_visual_anchors": ["wet hair", "winking", "neon stage"],
            "uncertain": ["specific drink type"],
        }
        with patch(
            "studio.vision_pipeline.prompt_synthesize.call_chat_payload",
            new=AsyncMock(return_value=json.dumps(mock_response)),
        ):
            result = await synthesize_prompt(
                {"subjects": [{"apparent_age_group": "young adult"}]},
                text_model="gemma4-un:latest",
                timeout=120.0,
                ollama_url="http://localhost:11434",
                keep_alive="5m",
            )
        assert result["summary"] == mock_response["summary"]
        assert result["positive_prompt"] == mock_response["positive_prompt"]
        assert result["negative_prompt"] == mock_response["negative_prompt"]
        assert result["key_visual_anchors"] == mock_response["key_visual_anchors"]
        assert result["uncertain"] == mock_response["uncertain"]

    async def test_returns_empty_on_empty_observation(self) -> None:
        """빈 observation 입력 → 빈 결과 (Ollama 호출 안 함)."""
        with patch(
            "studio.vision_pipeline.prompt_synthesize.call_chat_payload",
            new=AsyncMock(return_value=""),
        ) as mock_call:
            result = await synthesize_prompt(
                {},
                text_model="gemma4-un:latest",
                timeout=60.0,
                ollama_url="http://localhost:11434",
                keep_alive="5m",
            )
        mock_call.assert_not_called()
        assert result["positive_prompt"] == ""

    async def test_returns_empty_on_call_exception(self) -> None:
        """Ollama 호출 예외 시 빈 결과."""
        with patch(
            "studio.vision_pipeline.prompt_synthesize.call_chat_payload",
            new=AsyncMock(side_effect=TimeoutError("text model timeout")),
        ):
            result = await synthesize_prompt(
                {"subjects": [{}]},
                text_model="gemma4-un:latest",
                timeout=60.0,
                ollama_url="http://localhost:11434",
                keep_alive="5m",
            )
        assert result["positive_prompt"] == ""
        assert result["key_visual_anchors"] == []

    async def test_payload_uses_think_false_and_synthesize_sampling(self) -> None:
        """Ollama payload 가 think=False (gemma4 rule) + temperature 0.4 + num_ctx 6144 로 호출."""
        captured: dict = {}

        async def capture(
            *,
            ollama_url: str,
            payload: dict,
            timeout: float,
            allow_thinking_fallback: bool = True,
        ) -> str:
            captured.update(payload)
            captured["__allow_thinking_fallback"] = allow_thinking_fallback
            return "{}"

        with patch(
            "studio.vision_pipeline.prompt_synthesize.call_chat_payload",
            new=AsyncMock(side_effect=capture),
        ):
            await synthesize_prompt(
                {"subjects": [{}]},
                text_model="gemma4-un:latest",
                timeout=60.0,
                ollama_url="http://localhost:11434",
                keep_alive="5m",
            )
        assert captured["think"] is False
        assert captured["format"] == "json"
        assert captured["stream"] is False
        assert captured["keep_alive"] == "5m"
        assert captured["options"]["temperature"] == 0.4
        assert captured["options"]["num_ctx"] == 6144
        assert captured["__allow_thinking_fallback"] is False

    def test_system_prompt_forbids_boilerplate_unless_supported(self) -> None:
        """system prompt 가 boilerplate 조건부 금지 + 150~260 word + adult lock 명시."""
        assert "150 to 260 words" in PROMPT_SYNTHESIZE_SYSTEM
        assert "muted earth tones" in PROMPT_SYNTHESIZE_SYSTEM  # 금지 리스트 안에
        assert "fictional and adult" in PROMPT_SYNTHESIZE_SYSTEM
        assert "Do not invent details that contradict" in PROMPT_SYNTHESIZE_SYSTEM

    def test_system_prompt_includes_anchor_fidelity_rules(self) -> None:
        """Anchor Fidelity Rules 가 일반화 금지 cue 들을 명시한다."""
        for forbidden_generalization in [
            "Anchor Fidelity Rules",
            "asymmetric cross-strap cutout cropped tank top",
            "simple tank top",
            "cup raised to lips",
            "holding a cup",
            "chest-up",
            "full-body",
            "cargo pants",
            "shorts",
            "transparent raincoats",
            "plastic ponchos",
            "silhouettes",
            "Visual accuracy is more important than elegant prose",
        ]:
            assert forbidden_generalization in PROMPT_SYNTHESIZE_SYSTEM, (
                f"PROMPT_SYNTHESIZE_SYSTEM missing fidelity rule: "
                f"{forbidden_generalization!r}"
            )
