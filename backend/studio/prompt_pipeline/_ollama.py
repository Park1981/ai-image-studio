"""
prompt_pipeline._ollama — Ollama /api/chat HTTP 전송 (wire layer).

translate / upgrade 가 모두 이 _call_ollama_chat 1 함수만 호출.
Phase 4.3 단계 3 (2026-04-30) 분리.

2026-05-01 (Phase 1): think / num_predict / temperature / top_p / repeat_penalty /
format 인자화. allow_thinking_fallback 은 think 에서 자동 derive (think=True 면 False).
기본값은 기존 동작과 100% 동일 (회귀 0).
"""

from __future__ import annotations

from typing import Any

from .._ollama_client import call_chat_payload


async def _call_ollama_chat(
    *,
    ollama_url: str,
    model: str,
    system: str,
    user: str,
    timeout: float,
    think: bool = False,
    num_predict: int = 800,
    temperature: float = 0.6,
    top_p: float = 0.92,
    repeat_penalty: float = 1.18,
    format: str | dict[str, Any] | None = None,
) -> str:
    """Ollama /api/chat 호출 (non-streaming).

    기본값은 기존 동작과 동일. Phase 2 정밀 모드는 think=True + num_predict 상향
    + timeout 상향 으로 호출한다 (`prompt_pipeline._common._resolve_mode_options`).

    `allow_thinking_fallback` 은 노출하지 않는다 — `think` 값에서 자동 derive 하므로
    호출자가 잊어도 thinking 누출이 구조적으로 불가능 (CLAUDE.md Critical 룰 보호).
    """
    # v3: plain text 에 repeat_penalty 적용 — gemma4-un 이 긴 출력에서 loop 빠지는 이슈 대응.
    options: dict[str, Any] = {
        "num_ctx": 8192,
        "temperature": temperature,
        "top_p": top_p,
        "repeat_penalty": repeat_penalty,
        "num_predict": num_predict,
    }

    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        # v3.1 (2026-04-23): gemma4-un 이 thinking 모델로 동작해서 content 가 비는 이슈.
        # Ollama 신규 필드 think=false 로 reasoning 억제. think=True 는 정밀 모드 한정.
        "think": think,
        # 2026-04-26: VRAM 즉시 반납 (CLAUDE.md "Ollama: 온디맨드 호출 + 즉시 반납" 의도)
        # 기본 5분 keep_alive 가 16GB VRAM 환경 ComfyUI 와 충돌 → 응답 직후 unload.
        "keep_alive": "0",
        "options": options,
    }
    if format is not None:
        payload["format"] = format

    # think=True 면 thinking fallback 자동 차단 (spec §5.2 / CLAUDE.md Critical 보호)
    return await call_chat_payload(
        ollama_url=ollama_url,
        payload=payload,
        timeout=timeout,
        allow_thinking_fallback=not think,
    )
