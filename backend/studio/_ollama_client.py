"""Small shared Ollama HTTP helpers.

Callers still own prompt/payload construction. This module centralizes the
transport details so chat, ps, and unload calls do not each open bespoke
httpx boilerplate.

2026-04-27 (Claude G): httpx 원시 예외 → OllamaError 로 wrap. 호출자는
except OllamaError 로 도메인 분기 가능. except Exception 호환 (자손).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ._errors import OllamaError

log = logging.getLogger(__name__)


async def post_json(
    *,
    ollama_url: str,
    endpoint: str,
    payload: dict[str, Any],
    timeout: float,
) -> dict[str, Any]:
    """POST JSON to an Ollama endpoint and return the decoded response.

    Raises:
        OllamaError: httpx 네트워크/타임아웃/HTTP 4xx-5xx 등 모든 전송 실패.
    """
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(f"{ollama_url}{endpoint}", json=payload)
            res.raise_for_status()
            data = res.json()
    except (httpx.HTTPError, httpx.TimeoutException) as e:
        raise OllamaError(f"POST {endpoint} 실패: {e}") from e
    except ValueError as e:
        # res.json() decode 실패
        raise OllamaError(f"POST {endpoint} 응답 JSON decode 실패: {e}") from e
    return data if isinstance(data, dict) else {}


async def get_json(
    *,
    ollama_url: str,
    endpoint: str,
    timeout: float,
) -> dict[str, Any]:
    """GET JSON from an Ollama endpoint and return the decoded response.

    Raises:
        OllamaError: httpx 전송 실패 또는 JSON decode 실패.
    """
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.get(f"{ollama_url}{endpoint}")
            res.raise_for_status()
            data = res.json()
    except (httpx.HTTPError, httpx.TimeoutException) as e:
        raise OllamaError(f"GET {endpoint} 실패: {e}") from e
    except ValueError as e:
        raise OllamaError(f"GET {endpoint} 응답 JSON decode 실패: {e}") from e
    return data if isinstance(data, dict) else {}


def extract_chat_content(
    data: dict[str, Any],
    *,
    allow_thinking_fallback: bool = True,
) -> str:
    """Extract Ollama chat content, optionally falling back to the thinking field.

    `allow_thinking_fallback=True` (기본) 는 현재 동작 유지 — content 비면 thinking 사용.
    `think:true` 호출에서는 호출자가 False 로 명시해 reasoning 누출을 차단해야 한다.
    """
    msg = data.get("message") or {}
    if not isinstance(msg, dict):
        return ""
    content = msg.get("content", "") or ""
    if isinstance(content, str) and content.strip():
        return content
    if not allow_thinking_fallback:
        # think:true 호출은 thinking 을 결과로 인정하지 않음 (spec §5.2)
        return ""
    thinking = msg.get("thinking", "") or ""
    if isinstance(thinking, str) and thinking.strip():
        log.info("ollama: content empty, using thinking field as fallback")
        return thinking
    return ""


async def call_chat_payload(
    *,
    ollama_url: str,
    payload: dict[str, Any],
    timeout: float,
    allow_thinking_fallback: bool = True,
) -> str:
    """POST /api/chat and return stripped message content.

    `allow_thinking_fallback` 은 그대로 `extract_chat_content` 로 전달.
    호출자 (`_call_ollama_chat`) 가 `think` 값에서 자동 derive 한다.
    """
    data = await post_json(
        ollama_url=ollama_url,
        endpoint="/api/chat",
        payload=payload,
        timeout=timeout,
    )
    return extract_chat_content(
        data,
        allow_thinking_fallback=allow_thinking_fallback,
    ).strip()


async def get_ps(
    *,
    ollama_url: str,
    timeout: float,
) -> dict[str, Any]:
    """GET /api/ps."""
    return await get_json(
        ollama_url=ollama_url,
        endpoint="/api/ps",
        timeout=timeout,
    )


async def request_unload(
    *,
    ollama_url: str,
    model: str,
    timeout: float,
) -> bool:
    """Ask Ollama to unload one model via /api/generate keep_alive=0."""
    await post_json(
        ollama_url=ollama_url,
        endpoint="/api/generate",
        payload={"model": model, "keep_alive": 0},
        timeout=timeout,
    )
    return True
