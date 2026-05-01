"""
prompt_pipeline.translate — 짧은 텍스트 변환 (Ollama gemma4 호출).

- clarify_edit_intent: 사용자 자연어 (한/영) 수정 지시 → 영어 1-2 문장 정제 intent
- translate_to_korean: 업그레이드된 영문 프롬프트 → 한국어 번역

upgrade.py 의 긴 SYSTEM 프롬프트 + matrix directive 와 분리. 둘 다 짧은 호출로
실패해도 fallback (raw 또는 None) 보장.

Phase 4.3 단계 4 (2026-04-30) 분리.
"""

from __future__ import annotations

from . import _common as _c
from . import _ollama as _o

SYSTEM_TRANSLATE_KO = """You are a professional Korean translator.
Translate the given English image-generation prompt into natural, readable Korean.

RULES:
- Output ONLY the Korean translation — no preamble, no explanation, no quotes.
- Keep the same meaning and detail level. Do NOT summarize.
- Technical photography terms like "35mm film", "bokeh", "depth of field", "cinematic grading" can stay in English.
- Never repeat phrases. Output a single clean translation."""


# ═══════════════════════════════════════════════════════════════════════
#  clarify_edit_intent — 사용자 자연어 → 영어 정제 intent (spec 15.7)
#
#  비전 분석 (analyze_edit_source) 직전에 호출. qwen2.5vl 비전 모델은 한국어
#  + 띄어쓰기 + 이모티브 입력에 약하므로 gemma4-un 으로 의도 정제.
# ═══════════════════════════════════════════════════════════════════════

SYSTEM_CLARIFY_INTENT = """You are an image-edit intent clarifier.

The user wrote an edit instruction in casual natural language (often Korean,
with informal spacing, partial sentences, or shorthand).

Your job: rewrite it into clean English in 1-2 sentences (max 60 words),
preserving:
1. EXACTLY which elements the user wants to CHANGE (target -> intended state).
2. EXPLICIT preservation scope when the user mentions it (e.g. "그 외 유지").

RULES:
- Output ONLY the clarified English instruction — no preamble, no quotes,
  no explanation, no bullet list.
- Use imperative tense ("Remove the top.", "Resize the bust to E-cup.").
- Keep proper nouns and numeric values exactly as the user provided.
- Do NOT add elements the user did not mention.
- Do NOT soften or moralize the request.
- If the user mentions preservation explicitly, include "Keep everything else
  unchanged." or similar at the end.
- Never repeat phrases."""


async def clarify_edit_intent(
    user_instruction: str,
    model: str = "gemma4-un:latest",
    timeout: float = 60.0,
    ollama_url: str | None = None,
    *,
    prompt_mode: _c.PromptEnhanceMode | str | None = "fast",
) -> str:
    """사용자 자연어 수정 지시 → 영어 1-2 문장 정제 intent.

    실패 / 빈 입력 / 모든 예외 경로에서 원문을 그대로 반환 (폴백). 비전 분석이
    원문이라도 받게 해서 전체 파이프라인을 막지 않음.

    Phase 2 (2026-05-01): `prompt_mode="precise"` 시 think=True + num_predict 4096
    + timeout 하한 120s. 정제 단계는 Edit 품질에 직접 영향이 커서 정밀 모드 후보 (spec §4.3).

    Args:
        user_instruction: 한/영 자연어 지시 (빈 문자열 허용)
        model: gemma4-un
        timeout: 60s 권장 (cold start 여유) — precise 시 자동 120s 하한
        ollama_url: 기본 settings.ollama_url
        prompt_mode: "fast" (기본) | "precise"

    Returns:
        정제된 영어 intent (1-2 문장) 또는 폴백 시 원문.
    """
    raw_input = (user_instruction or "").strip()
    if not raw_input:
        return ""

    resolved_url = ollama_url or _c._DEFAULT_OLLAMA_URL
    opts = _c._resolve_mode_options(prompt_mode, base_timeout=timeout)
    try:
        raw = await _o._call_ollama_chat(
            ollama_url=resolved_url,
            model=model,
            system=SYSTEM_CLARIFY_INTENT,
            user=raw_input,
            timeout=opts["timeout"],
            think=opts["think"],
            num_predict=opts["num_predict"],
        )
        cleaned = _c._strip_repeat_noise(raw.strip()).strip()
        if not cleaned:
            _c.log.info("clarify_edit_intent: empty response, falling back to raw")
            return raw_input
        # 너무 길면 600자 cap (비전 SYSTEM 프롬프트 보호)
        if len(cleaned) > 600:
            cleaned = cleaned[:600].rstrip()
        return cleaned
    except Exception as e:
        _c.log.info("clarify_edit_intent failed (non-fatal): %s", e)
        return raw_input


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
        raw = await _o._call_ollama_chat(
            ollama_url=ollama_url or _c._DEFAULT_OLLAMA_URL,
            model=model,
            system=SYSTEM_TRANSLATE_KO,
            user=text.strip(),
            timeout=timeout,
        )
        cleaned = _c._strip_repeat_noise(raw.strip())
        return cleaned if cleaned else None
    except Exception as e:
        _c.log.info("translation failed (non-fatal): %s", e)
        return None
