# backend/tests/test_vision_observe.py
"""vision_observe — Ollama 호출 mock 기반 단위 테스트."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from studio.vision_pipeline.vision_observe import (
    VISION_OBSERVATION_SYSTEM,
    observe_image,
)


@pytest.mark.asyncio
class TestVisionObserve:
    """관찰 단계 — Ollama call mock + JSON 파싱 검증."""

    async def test_returns_parsed_dict_on_success(self) -> None:
        """정상 응답 → parsed dict."""
        mock_observation = {
            "image_orientation": "portrait",
            "subjects": [{"count_index": 1, "apparent_age_group": "young adult"}],
        }
        with patch(
            "studio.vision_pipeline.vision_observe.call_chat_payload",
            new=AsyncMock(return_value=json.dumps(mock_observation)),
        ):
            result = await observe_image(
                b"fake_image_bytes",
                width=832,
                height=1248,
                vision_model="qwen3-vl:8b",
                timeout=120.0,
                ollama_url="http://localhost:11434",
                keep_alive="5m",
            )
        assert result == mock_observation

    async def test_returns_empty_dict_on_call_exception(self) -> None:
        """Ollama 호출 예외 시 빈 dict 반환 (HTTP 500 안 냄)."""
        with patch(
            "studio.vision_pipeline.vision_observe.call_chat_payload",
            new=AsyncMock(side_effect=RuntimeError("ollama down")),
        ):
            result = await observe_image(
                b"fake",
                width=512,
                height=512,
                vision_model="qwen2.5vl:7b",
                timeout=60.0,
                ollama_url="http://localhost:11434",
                keep_alive="5m",
            )
        assert result == {}

    async def test_returns_empty_dict_on_invalid_json(self) -> None:
        """JSON 파싱 실패 시 빈 dict."""
        with patch(
            "studio.vision_pipeline.vision_observe.call_chat_payload",
            new=AsyncMock(return_value="not valid json {"),
        ):
            result = await observe_image(
                b"fake",
                width=512,
                height=512,
                vision_model="qwen2.5vl:7b",
                timeout=60.0,
                ollama_url="http://localhost:11434",
                keep_alive="5m",
            )
        assert result == {}

    async def test_payload_uses_format_json_and_observation_sampling(self) -> None:
        """Ollama payload 가 format=json + temperature 0.2 + num_ctx 4096 로 호출되는지."""
        captured: dict = {}

        async def capture(*, ollama_url: str, payload: dict, timeout: float) -> str:
            captured.update(payload)
            return "{}"

        with patch(
            "studio.vision_pipeline.vision_observe.call_chat_payload",
            new=AsyncMock(side_effect=capture),
        ):
            await observe_image(
                b"fake",
                width=512,
                height=512,
                vision_model="qwen3-vl:8b",
                timeout=60.0,
                ollama_url="http://localhost:11434",
                keep_alive="5m",
            )
        assert captured["format"] == "json"
        assert captured["keep_alive"] == "5m"
        assert captured["options"]["temperature"] == 0.2
        assert captured["options"]["num_ctx"] == 4096

    def test_system_prompt_forbids_boilerplate(self) -> None:
        """system prompt 가 boilerplate 금지 어휘 + positive_prompt 작성 금지 명시."""
        for forbidden in [
            "muted earth tones",
            "golden hour",
            "softbox lighting",
            "85mm lens",
            "Do not write an image-generation prompt",
            "Do not create a final prompt",
        ]:
            assert forbidden in VISION_OBSERVATION_SYSTEM, (
                f"VISION_OBSERVATION_SYSTEM missing critical guard: {forbidden!r}"
            )
