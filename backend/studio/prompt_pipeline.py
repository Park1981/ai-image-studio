"""
prompt_pipeline.py - gemma4 기반 프롬프트 업그레이드 (Ollama 연동).

흐름:
1. 사용자가 자연어 프롬프트 입력 (한글 OK)
2. gemma4-un 에 시스템 프롬프트 + 사용자 프롬프트 전달
3. "업그레이드된 영어 프롬프트" 반환 (Qwen Image 2512 에 최적화)
4. 실패/타임아웃 시 원본 프롬프트 + warn 플래그 반환 (폴백)

조사(Claude CLI) 컨텍스트가 있으면 시스템 프롬프트에 참고자료로 주입한다.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

log = logging.getLogger(__name__)

OLLAMA_URL = "http://localhost:11434"
# 16GB VRAM 환경에서 gemma4-un(25.2B) 첫 로드 30~60s 여유 필요.
# 이후 호출은 빠름. 환경에 따라 .env 로 조정 가능하도록 추후 이동.
DEFAULT_TIMEOUT = 120.0

# 시스템 프롬프트 (영문 — gemma 영문 출력 잘함)
SYSTEM_GENERATE = """You are a prompt engineer specialized in Qwen Image 2512 (a photorealistic text-to-image model).

Your job: rewrite the user's natural-language description into a single polished English prompt,
optimized for Qwen Image 2512. Keep the user's intent exactly. Add specific, tactile details
(lighting, composition, materials, film grain, bokeh, camera angle, style anchor).

RULES:
- Output ONLY the final English prompt — no preamble, no explanation, no quotes.
- 40 ~ 120 words is a good target. Never exceed 200 words.
- Mix sensory detail with style anchors (e.g. "editorial photo, 35mm film, cinematic grading").
- Preserve any proper nouns, characters, or key visual elements from the user's input.
- If user wrote Korean, translate the intent to English before enhancing.
- Never output disclaimers or safety warnings."""

SYSTEM_EDIT = """You are an image-edit prompt engineer for Qwen Image Edit 2511.

The user wants to modify an existing image. You receive:
1. A brief description of the original image (from a vision model).
2. The user's edit instruction.

Your job: compose ONE final English edit prompt that tells the model exactly what to change,
while explicitly preserving identity, facial features, body proportions, and other unchanged elements.

RULES:
- Output ONLY the final English prompt — no preamble, no explanation, no quotes.
- Always include identity-preservation clauses: "keep the exact same face, identical face,
  same person, same identity, same facial features, same eye shape, same nose, same lips,
  same body proportion, realistic skin texture, no skin smoothing, photorealistic, highly
  detailed face, natural lighting."
- Describe the change clearly and specifically.
- If user wrote Korean, translate intent to English."""


@dataclass
class UpgradeResult:
    """프롬프트 업그레이드 결과."""

    upgraded: str
    """최종 영문 프롬프트."""

    fallback: bool
    """True 면 Ollama 실패로 원본을 그대로 반환한 상태."""

    provider: str
    """'ollama' | 'fallback'."""

    original: str
    """사용자 원본 프롬프트."""


async def upgrade_generate_prompt(
    prompt: str,
    model: str = "gemma4-un:latest",
    research_context: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str = OLLAMA_URL,
) -> UpgradeResult:
    """생성용 프롬프트 업그레이드.

    Args:
        prompt: 사용자 원본 프롬프트 (한/영)
        model: Ollama 모델 이름
        research_context: Claude CLI 조사 결과 (optional)
        timeout: HTTP 타임아웃 초
        ollama_url: Ollama 베이스 URL (테스트에서 재정의 가능)
    """
    if not prompt.strip():
        return UpgradeResult(
            upgraded=prompt, fallback=True, provider="fallback", original=prompt
        )

    system = SYSTEM_GENERATE
    if research_context:
        system += (
            "\n\nAdditional research context (external — integrate naturally "
            "if relevant, ignore if not):\n" + research_context.strip()
        )

    try:
        upgraded = await _call_ollama_chat(
            ollama_url=ollama_url,
            model=model,
            system=system,
            user=prompt,
            timeout=timeout,
        )
        if not upgraded.strip():
            raise ValueError("Empty response from Ollama")
        return UpgradeResult(
            upgraded=upgraded.strip(),
            fallback=False,
            provider="ollama",
            original=prompt,
        )
    except Exception as e:
        log.warning("gemma4 upgrade failed, falling back to original: %s", e)
        return UpgradeResult(
            upgraded=prompt,
            fallback=True,
            provider="fallback",
            original=prompt,
        )


async def upgrade_edit_prompt(
    edit_instruction: str,
    image_description: str,
    model: str = "gemma4-un:latest",
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str = OLLAMA_URL,
) -> UpgradeResult:
    """수정용 프롬프트 업그레이드 (이미지 설명 + 사용자 지시 → 최종 edit 프롬프트)."""
    if not edit_instruction.strip():
        return UpgradeResult(
            upgraded=edit_instruction,
            fallback=True,
            provider="fallback",
            original=edit_instruction,
        )

    user_msg = (
        f"[Image description]\n{image_description.strip()}\n\n"
        f"[Edit instruction]\n{edit_instruction.strip()}"
    )

    try:
        upgraded = await _call_ollama_chat(
            ollama_url=ollama_url,
            model=model,
            system=SYSTEM_EDIT,
            user=user_msg,
            timeout=timeout,
        )
        if not upgraded.strip():
            raise ValueError("Empty response from Ollama")
        return UpgradeResult(
            upgraded=upgraded.strip(),
            fallback=False,
            provider="ollama",
            original=edit_instruction,
        )
    except Exception as e:
        log.warning("Edit prompt upgrade failed: %s", e)
        return UpgradeResult(
            upgraded=edit_instruction,
            fallback=True,
            provider="fallback",
            original=edit_instruction,
        )


async def _call_ollama_chat(
    *,
    ollama_url: str,
    model: str,
    system: str,
    user: str,
    timeout: float,
) -> str:
    """Ollama /api/chat 호출 (non-streaming)."""
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        "options": {
            "temperature": 0.7,
            "top_p": 0.95,
            "num_ctx": 8192,
        },
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(f"{ollama_url}/api/chat", json=payload)
        res.raise_for_status()
        data = res.json()
        return (data.get("message") or {}).get("content", "")
