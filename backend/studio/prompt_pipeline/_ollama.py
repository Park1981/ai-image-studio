"""
prompt_pipeline._ollama — Ollama /api/chat HTTP 전송 (wire layer).

translate / upgrade 가 모두 이 _call_ollama_chat 1 함수만 호출.
Phase 4.3 단계 3 (2026-04-30) 분리.
"""

from __future__ import annotations

from .._ollama_client import call_chat_payload


async def _call_ollama_chat(
    *,
    ollama_url: str,
    model: str,
    system: str,
    user: str,
    timeout: float,
) -> str:
    """Ollama /api/chat 호출 (non-streaming)."""
    # v3: plain text 에 repeat_penalty 적용 — gemma4-un 이 긴 출력에서 loop 빠지는 이슈 대응.
    options: dict = {
        "num_ctx": 8192,
        "temperature": 0.6,
        "top_p": 0.92,
        "repeat_penalty": 1.18,
        "num_predict": 800,
    }

    payload: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        # v3.1 (2026-04-23): gemma4-un 이 thinking 모델로 동작해서 content 가 비는 이슈.
        # Ollama 신규 필드 think=false 로 reasoning 억제.
        "think": False,
        # 2026-04-26: VRAM 즉시 반납 (CLAUDE.md "Ollama: 온디맨드 호출 + 즉시 반납" 의도)
        # 기본 5분 keep_alive 가 16GB VRAM 환경 ComfyUI 와 충돌 → 응답 직후 unload.
        "keep_alive": "0",
        "options": options,
    }
    return await call_chat_payload(
        ollama_url=ollama_url,
        payload=payload,
        timeout=timeout,
    )
