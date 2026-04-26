"""
ollama_unload 헬퍼 단위 테스트 (spec 19 후속 · 옵션 A).

배경: 16GB VRAM 환경에서 ComfyUI 디스패치 직전 Ollama 메모리 강제 반납.
keep_alive=0 race condition 으로 swap 발생하던 문제 해결.

검증:
  - list_loaded_models — /api/ps 응답 파싱
  - unload_model — 단일 모델 unload
  - force_unload_all_before_comfy — 전체 흐름 (조회 → unload → wait)
  - 빈 결과 / 실패 graceful 처리
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_list_loaded_models_parses_ollama_ps() -> None:
    """list_loaded_models 가 /api/ps 응답에서 model 필드 추출."""
    from studio.ollama_unload import list_loaded_models

    fake_response = MagicMock()
    fake_response.raise_for_status = MagicMock()
    fake_response.json = MagicMock(return_value={
        "models": [
            {"name": "gemma4-un:latest", "model": "gemma4-un:latest", "size_vram": 14000000000},
            {"name": "qwen2.5vl:7b", "model": "qwen2.5vl:7b", "size_vram": 8000000000},
        ]
    })

    fake_client = AsyncMock()
    fake_client.__aenter__ = AsyncMock(return_value=fake_client)
    fake_client.__aexit__ = AsyncMock(return_value=False)
    fake_client.get = AsyncMock(return_value=fake_response)

    with patch(
        "studio.ollama_unload.httpx.AsyncClient",
        return_value=fake_client,
    ):
        models = await list_loaded_models(ollama_url="http://x")

    assert "gemma4-un:latest" in models
    assert "qwen2.5vl:7b" in models
    assert len(models) == 2


@pytest.mark.asyncio
async def test_list_loaded_models_empty_on_failure() -> None:
    """Ollama 응답 실패 시 빈 리스트 (graceful)."""
    from studio.ollama_unload import list_loaded_models

    fake_client = AsyncMock()
    fake_client.__aenter__ = AsyncMock(return_value=fake_client)
    fake_client.__aexit__ = AsyncMock(return_value=False)
    fake_client.get = AsyncMock(side_effect=RuntimeError("connection refused"))

    with patch(
        "studio.ollama_unload.httpx.AsyncClient",
        return_value=fake_client,
    ):
        models = await list_loaded_models(ollama_url="http://x")

    assert models == []


@pytest.mark.asyncio
async def test_unload_model_sends_keep_alive_zero() -> None:
    """unload_model 이 /api/generate 에 keep_alive: 0 (int) 전달."""
    from studio.ollama_unload import unload_model

    captured: dict = {}
    fake_response = MagicMock()
    fake_response.raise_for_status = MagicMock()

    async def _fake_post(url: str, json=None):
        captured["url"] = url
        captured["json"] = json
        return fake_response

    fake_client = AsyncMock()
    fake_client.__aenter__ = AsyncMock(return_value=fake_client)
    fake_client.__aexit__ = AsyncMock(return_value=False)
    fake_client.post = _fake_post

    with patch(
        "studio.ollama_unload.httpx.AsyncClient",
        return_value=fake_client,
    ):
        ok = await unload_model("gemma4-un:latest", ollama_url="http://x")

    assert ok is True
    assert captured["url"].endswith("/api/generate")
    # spec 19 옵션 A — int 0 이어야 함 (Ollama /api/generate 가 받는 표준)
    assert captured["json"]["keep_alive"] == 0
    assert captured["json"]["model"] == "gemma4-un:latest"


@pytest.mark.asyncio
async def test_unload_model_returns_false_on_failure() -> None:
    """unload 실패 시 False (예외 안 올림)."""
    from studio.ollama_unload import unload_model

    fake_client = AsyncMock()
    fake_client.__aenter__ = AsyncMock(return_value=fake_client)
    fake_client.__aexit__ = AsyncMock(return_value=False)
    fake_client.post = AsyncMock(side_effect=RuntimeError("timeout"))

    with patch(
        "studio.ollama_unload.httpx.AsyncClient",
        return_value=fake_client,
    ):
        ok = await unload_model("gemma4-un:latest", ollama_url="http://x")

    assert ok is False


@pytest.mark.asyncio
async def test_unload_model_skips_empty_name() -> None:
    """빈 모델 이름은 호출 안 하고 False 반환."""
    from studio.ollama_unload import unload_model

    ok = await unload_model("", ollama_url="http://x")
    assert ok is False


@pytest.mark.asyncio
async def test_force_unload_skips_wait_when_no_models() -> None:
    """로드된 모델 없으면 wait_sec=0 반환 (즉시 종료 · 1.5초 대기 X)."""
    from studio import ollama_unload as ou

    with patch.object(
        ou, "list_loaded_models", new=AsyncMock(return_value=[])
    ):
        result = await ou.force_unload_all_before_comfy(ollama_url="http://x")

    assert result == {"unloaded": [], "wait_sec": 0.0}


@pytest.mark.asyncio
async def test_force_unload_unloads_all_loaded_models() -> None:
    """로드된 모델들 모두 unload + 1.5s 대기 (wait_sec mock 으로 0 으로 단축)."""
    from studio import ollama_unload as ou

    with (
        patch.object(
            ou, "list_loaded_models",
            new=AsyncMock(return_value=["gemma4-un:latest", "qwen2.5vl:7b"]),
        ),
        patch.object(
            ou, "unload_model", new=AsyncMock(return_value=True)
        ),
    ):
        # wait_sec=0 으로 호출 → asyncio.sleep 스킵 (테스트 시간 단축)
        result = await ou.force_unload_all_before_comfy(
            ollama_url="http://x", wait_sec=0.0
        )

    assert sorted(result["unloaded"]) == sorted([
        "gemma4-un:latest", "qwen2.5vl:7b"
    ])
    assert result["wait_sec"] == 0.0


@pytest.mark.asyncio
async def test_force_unload_partial_failure_keeps_succeeded() -> None:
    """일부 unload 실패해도 성공한 것만 unloaded 리스트에 포함."""
    from studio import ollama_unload as ou

    async def _selective_unload(model: str, **_kw) -> bool:
        return model != "broken-model"

    with (
        patch.object(
            ou, "list_loaded_models",
            new=AsyncMock(return_value=["gemma4-un:latest", "broken-model"]),
        ),
        patch.object(ou, "unload_model", new=_selective_unload),
    ):
        result = await ou.force_unload_all_before_comfy(
            ollama_url="http://x", wait_sec=0.0
        )

    assert "gemma4-un:latest" in result["unloaded"]
    assert "broken-model" not in result["unloaded"]
