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
import re
from dataclasses import dataclass

import httpx

log = logging.getLogger(__name__)

# Ollama URL 은 .env/config.py 에서만 읽는다 (하드코딩 금지 규칙).
# 테스트 환경에서 config import 가 실패할 수 있으므로 try/except 폴백만 허용.
try:
    from config import settings  # type: ignore

    _DEFAULT_OLLAMA_URL: str = settings.ollama_url
except Exception:  # pragma: no cover - 테스트/독립 실행 환경
    _DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"

# 16GB VRAM 환경에서 gemma4-un(25.2B) 첫 로드 30~60s 여유 필요.
# 이후 호출은 빠름. 환경에 따라 .env 로 조정 가능하도록 추후 이동.
DEFAULT_TIMEOUT = 120.0

# 시스템 프롬프트 — v3 (2026-04-23 후속):
# gemma4-un 이 JSON 모드 + 긴 출력 결합 시 loop 에 빠지는 이슈 회피를 위해 2-call 전환.
# Call 1: 영문 프롬프트 업그레이드 (plain text, loop 위험 ↓)
# Call 2: translate_to_korean 으로 en → ko 번역 (별도 짧은 호출)

SYSTEM_GENERATE = """You are a prompt engineer specialized in Qwen Image 2512 (a photorealistic text-to-image model).

Your job: rewrite the user's natural-language description into a single polished English prompt, optimized for Qwen Image 2512. Keep the user's intent exactly. Add specific, tactile details (lighting, composition, materials, film grain, bokeh, camera angle, style anchor).

RULES:
- Output ONLY the final English prompt — no preamble, no explanation, no quotes, no markdown.
- 40 ~ 120 words is a good target. Never exceed 200 words.
- Mix sensory detail with style anchors (e.g. "editorial photo, 35mm film, cinematic grading").
- Preserve any proper nouns, characters, or key visual elements from the user's input.
- If user wrote Korean, translate the intent to English before enhancing.
- Never output disclaimers or safety warnings.
- Never repeat words or phrases. If you catch yourself repeating, stop immediately."""

SYSTEM_EDIT = """You are an image-edit prompt engineer for Qwen Image Edit 2511.

The user wants to modify an existing image. You receive:
1. A brief description of the original image (from a vision model).
2. The user's edit instruction.

Your job: compose ONE final English edit prompt that tells the model exactly what to change, while explicitly preserving identity, facial features, body proportions, and other unchanged elements.

RULES:
- Output ONLY the final English prompt — no preamble, no explanation, no quotes, no markdown.
- Always include identity-preservation clauses: "keep the exact same face, identical face, same person, same identity, same facial features, same eye shape, same nose, same lips, same body proportion, realistic skin texture, no skin smoothing, photorealistic, highly detailed face, natural lighting."
- Describe the change clearly and specifically.
- If user wrote Korean, translate intent to English.
- Never repeat words or phrases."""

SYSTEM_TRANSLATE_KO = """You are a professional Korean translator.
Translate the given English image-generation prompt into natural, readable Korean.

RULES:
- Output ONLY the Korean translation — no preamble, no explanation, no quotes.
- Keep the same meaning and detail level. Do NOT summarize.
- Technical photography terms like "35mm film", "bokeh", "depth of field", "cinematic grading" can stay in English.
- Never repeat phrases. Output a single clean translation."""


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

    translation: str | None = None
    """업그레이드된 영문 프롬프트의 한국어 번역 (v2 · 2026-04-23).
    JSON 파싱 실패 또는 fallback 시 None."""


def _strip_repeat_noise(s: str) -> str:
    """모델이 loop 에 빠져 내뱉는 반복 문자/토큰/구 제거.

    탐지 케이스:
      1. 같은 문자 12번+ 연속 (예: ||||||||||)
      2. 같은 단어 8번+ 연속 (예: larger larger larger ...)
      3. 짧은 구 3번+ 반복 (예: a park-like a park-like a park-like ...)
    매치 시점부터 뒤를 전부 잘라낸다.
    """
    if not s:
        return s
    candidates: list[int] = []
    # 1) 같은 문자 12번+ 연속
    m = re.search(r"(.)\1{11,}", s)
    if m:
        candidates.append(m.start())
    # 2) 같은 단어 8번+ 연속
    m2 = re.search(r"\b(\w{2,20})(\s+\1){7,}", s)
    if m2:
        candidates.append(m2.start())
    # 3) 2~5 단어 구가 3번+ 반복 (하이픈·특수문자도 포함해서 매치)
    # 예: "a park-like a park-like a park-like" — 공백 기준 토큰이 2~5개 반복
    m3 = re.search(
        r"(\b[\w-]+(?:\s+[\w-]+){1,4})(?:\s+\1){2,}", s
    )
    if m3:
        candidates.append(m3.start())

    if candidates:
        s = s[: min(candidates)]
    return s.rstrip()


async def translate_to_korean(
    text: str,
    model: str = "gemma4-un:latest",
    timeout: float = 45.0,
    ollama_url: str | None = None,
) -> str | None:
    """영문 텍스트를 한국어로 번역 (짧은 단일 호출).

    반환: 번역 문자열 / 실패 시 None.
    업그레이드 이후 별도 호출로 사용 — 실패해도 en 은 영향 없음.
    """
    if not text.strip():
        return None
    try:
        raw = await _call_ollama_chat(
            ollama_url=ollama_url or _DEFAULT_OLLAMA_URL,
            model=model,
            system=SYSTEM_TRANSLATE_KO,
            user=text.strip(),
            timeout=timeout,
        )
        cleaned = _strip_repeat_noise(raw.strip())
        return cleaned if cleaned else None
    except Exception as e:
        log.info("translation failed (non-fatal): %s", e)
        return None


async def upgrade_generate_prompt(
    prompt: str,
    model: str = "gemma4-un:latest",
    research_context: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    include_translation: bool = True,
) -> UpgradeResult:
    """생성용 프롬프트 업그레이드 (v3: 2-call — en 먼저, 그다음 ko 번역).

    Args:
        prompt: 사용자 원본 프롬프트 (한/영)
        model: Ollama 모델 이름
        research_context: Claude CLI 조사 결과 (optional)
        timeout: HTTP 타임아웃 초
        ollama_url: Ollama 베이스 URL
        include_translation: False 면 번역 호출 skip (빠른 경로)
    """
    if not prompt.strip():
        return UpgradeResult(
            upgraded=prompt, fallback=True, provider="fallback", original=prompt
        )

    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL
    system = SYSTEM_GENERATE
    if research_context:
        system += (
            "\n\nAdditional research context (external — integrate naturally "
            "if relevant, ignore if not):\n" + research_context.strip()
        )

    try:
        # Call 1: 영문 업그레이드 (plain text)
        upgraded_raw = await _call_ollama_chat(
            ollama_url=resolved_url,
            model=model,
            system=system,
            user=prompt,
            timeout=timeout,
        )
        en = _strip_repeat_noise(upgraded_raw.strip()).strip()
        if not en:
            raise ValueError("Empty response from Ollama")
    except Exception as e:
        log.warning("gemma4 upgrade failed, falling back to original: %s", e)
        return UpgradeResult(
            upgraded=prompt,
            fallback=True,
            provider="fallback",
            original=prompt,
            translation=None,
        )

    # Call 2: 번역 (옵션 · 실패해도 en 은 살아남음)
    ko = None
    if include_translation:
        ko = await translate_to_korean(
            en, model=model, timeout=60.0, ollama_url=resolved_url
        )

    return UpgradeResult(
        upgraded=en,
        fallback=False,
        provider="ollama",
        original=prompt,
        translation=ko,
    )


async def upgrade_edit_prompt(
    edit_instruction: str,
    image_description: str,
    model: str = "gemma4-un:latest",
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    include_translation: bool = True,
) -> UpgradeResult:
    """수정용 프롬프트 업그레이드 (v3: 2-call)."""
    if not edit_instruction.strip():
        return UpgradeResult(
            upgraded=edit_instruction,
            fallback=True,
            provider="fallback",
            original=edit_instruction,
        )

    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL
    user_msg = (
        f"[Image description]\n{image_description.strip()}\n\n"
        f"[Edit instruction]\n{edit_instruction.strip()}"
    )

    try:
        upgraded_raw = await _call_ollama_chat(
            ollama_url=resolved_url,
            model=model,
            system=SYSTEM_EDIT,
            user=user_msg,
            timeout=timeout,
        )
        en = _strip_repeat_noise(upgraded_raw.strip()).strip()
        if not en:
            raise ValueError("Empty response from Ollama")
    except Exception as e:
        log.warning("Edit prompt upgrade failed: %s", e)
        return UpgradeResult(
            upgraded=edit_instruction,
            fallback=True,
            provider="fallback",
            original=edit_instruction,
            translation=None,
        )

    # 번역 (옵션)
    ko = None
    if include_translation:
        ko = await translate_to_korean(
            en, model=model, timeout=60.0, ollama_url=resolved_url
        )

    return UpgradeResult(
        upgraded=en,
        fallback=False,
        provider="ollama",
        original=edit_instruction,
        translation=ko,
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
        "options": options,
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(f"{ollama_url}/api/chat", json=payload)
        res.raise_for_status()
        data = res.json()
        msg = data.get("message") or {}
        content = msg.get("content", "") or ""
        # 안전장치: content 가 비어있으면 thinking 으로 폴백 (Ollama 버전 차이 대응)
        if not content.strip():
            thinking = msg.get("thinking", "") or ""
            if thinking.strip():
                log.info("ollama: content empty, using thinking field as fallback")
                content = thinking
        return content
