"""Small shared Ollama HTTP helpers.

Callers still own prompt/payload construction. This module centralizes the
transport details so chat, ps, and unload calls do not each open bespoke
httpx boilerplate.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)


async def post_json(
    *,
    ollama_url: str,
    endpoint: str,
    payload: dict[str, Any],
    timeout: float,
) -> dict[str, Any]:
    """POST JSON to an Ollama endpoint and return the decoded response."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(f"{ollama_url}{endpoint}", json=payload)
        res.raise_for_status()
        data = res.json()
    return data if isinstance(data, dict) else {}


async def get_json(
    *,
    ollama_url: str,
    endpoint: str,
    timeout: float,
) -> dict[str, Any]:
    """GET JSON from an Ollama endpoint and return the decoded response."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.get(f"{ollama_url}{endpoint}")
        res.raise_for_status()
        data = res.json()
    return data if isinstance(data, dict) else {}


def extract_chat_content(data: dict[str, Any]) -> str:
    """Extract Ollama chat content with thinking-field fallback."""
    msg = data.get("message") or {}
    if not isinstance(msg, dict):
        return ""
    content = msg.get("content", "") or ""
    if isinstance(content, str) and content.strip():
        return content
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
) -> str:
    """POST /api/chat and return stripped message content."""
    data = await post_json(
        ollama_url=ollama_url,
        endpoint="/api/chat",
        payload=payload,
        timeout=timeout,
    )
    return extract_chat_content(data).strip()


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
