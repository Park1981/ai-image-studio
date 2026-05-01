"""
prompt_pipeline.tools — 긴 프롬프트를 의미 카드로 분리 + 양방향 번역.

Phase 5 (2026-05-01) 신설.

구성:
- split_prompt_cards(): 긴 프롬프트를 카테고리별 카드 (subject/face/outfit/...) 로 분리
- translate_prompt(): 한↔영 양방향 번역 (LoRA / weight / negative 등 특수 토큰 보존)

설계 spec: docs/superpowers/specs/2026-05-01-prompt-tools-reasoning-modes-design.md
- §4.5 프롬프트 분리: think:false, format:json, temperature 0, num_predict 512~1024
- §5.5 / §5.6 신규 모듈 + 엔드포인트
- §11 비목표: 분리 결과로 원본을 자동 덮어쓰지 않는다
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Literal

from . import _common as _c
from . import _ollama as _o


# ═══════════════════════════════════════════════════════════════════════
# Prompt split — 카테고리 카드 분리
# ═══════════════════════════════════════════════════════════════════════

# spec §4.5 의 17 카테고리. JSON output 의 key 화이트리스트.
# 모델이 정의 외 key 를 만들면 "etc" 로 자동 폴백 (Ollama 가 주어진 keyset 안 지킬 때 안전망).
ALLOWED_SECTION_KEYS: frozenset[str] = frozenset({
    "subject",
    "composition",
    "face",
    "eyes",
    "nose",
    "lips",
    "skin",
    "makeup",
    "expression",
    "hair",
    "outfit",
    "background",
    "lighting",
    "style",
    "quality",
    "negative",
    "etc",
})


SYSTEM_SPLIT = """You are a prompt-engineering assistant.

The user provides a long Stable-Diffusion / Qwen / Flux style prompt that may
contain dozens of phrases describing different aspects (subject, face, outfit,
background, etc.) packed together with commas, parentheses, and weight tags.

Your job: split the prompt into semantic cards, one card per category.

Rules:
- Output ONLY a JSON object with a `sections` array — no preamble, no markdown,
  no commentary. The first character must be `{`, the last must be `}`.
- Each section has exactly two keys: `key` and `text`.
- `key` MUST be one of the following exact strings (lowercase, English):
  subject, composition, face, eyes, nose, lips, skin, makeup, expression,
  hair, outfit, background, lighting, style, quality, negative, etc.
- `text` is the cleaned-up phrase set for that category. Keep the original
  English (or transliteration) — do NOT translate.
- Preserve special tokens verbatim:
    LoRA tags (`<lora:name:weight>`),
    weight syntax (`(phrase:1.2)`, `((phrase))`),
    negative-prompt markers,
    parentheses, colons, numerical weights.
- If a phrase belongs to multiple categories, pick the most specific one.
  If unsure, use `etc`.
- Skip empty categories — do NOT include them in the output.
- If the prompt is too short to split (< 5 distinct phrases), return one
  `subject` section with the full prompt as-is.

Example output shape:
{
  "sections": [
    {"key": "subject", "text": "20yo Korean woman, K-pop idol look"},
    {"key": "face",    "text": "symmetrical face, sharp jawline"},
    {"key": "outfit",  "text": "red satin dress, gold accessories"}
  ]
}"""


@dataclass
class PromptSection:
    """split 결과의 1 section (= UI 카드)."""

    key: str
    """ALLOWED_SECTION_KEYS 안의 카테고리 식별자."""
    text: str
    """그 카테고리에 해당하는 phrase 묶음 (영어 · LoRA / weight 보존)."""

    def to_dict(self) -> dict[str, str]:
        return {"key": self.key, "text": self.text}


@dataclass
class PromptSplitResult:
    """split_prompt_cards 의 결과 묶음.

    실패 / 빈 입력 / JSON 파싱 실패 시 sections=[] + fallback=True. 이 경우 UI 는
    "분리 실패 — 원본 유지" 토스트만 띄우고 사용자 textarea 는 건드리지 않는다 (spec §11).
    """

    sections: list[PromptSection]
    provider: str
    """'ollama' | 'fallback' | 'fallback-precise-failed'."""
    fallback: bool
    raw: str = ""
    """모델 원시 응답 (디버그/로그 용 · UI 노출 X). JSON 파싱 실패 시 진단에 유용."""
    error: str | None = None
    """fallback 사유 (간단한 한 줄). UI 토스트에 그대로 사용."""


def _normalize_sections(parsed: Any) -> list[PromptSection]:
    """Ollama JSON 응답 → PromptSection 리스트.

    parsed 가 spec 모양과 어긋나면 가능한 한 best-effort 보존:
    - sections 배열이 아니라 dict { key: text } 면 list 변환
    - allowed key 가 아니면 "etc" 로 정규화
    - text 가 비면 skip
    """
    sections: list[PromptSection] = []

    if isinstance(parsed, dict):
        seq = parsed.get("sections")
        if not isinstance(seq, list):
            # 모델이 sections 배열 대신 평탄한 {key: text} 딕셔너리 반환한 케이스
            seq = [{"key": k, "text": v} for k, v in parsed.items() if isinstance(v, str)]
    elif isinstance(parsed, list):
        seq = parsed
    else:
        return []

    for raw in seq:
        if not isinstance(raw, dict):
            continue
        key = str(raw.get("key", "")).strip().lower()
        text = str(raw.get("text", "")).strip()
        if not text:
            continue
        if key not in ALLOWED_SECTION_KEYS:
            key = "etc"
        sections.append(PromptSection(key=key, text=text))

    return sections


async def split_prompt_cards(
    prompt: str,
    *,
    model: str = "gemma4-un:latest",
    timeout: float = 60.0,
    ollama_url: str | None = None,
) -> PromptSplitResult:
    """긴 프롬프트 → 의미 카드 (sections 배열).

    Args:
        prompt: 사용자 원본 프롬프트 (한/영 · 빈 입력 허용)
        model: Ollama 모델 (gemma4-un · think:false 자동 적용)
        timeout: 60s 권장 (긴 프롬프트 + cold start 여유)
        ollama_url: 기본 settings.ollama_url

    Returns:
        PromptSplitResult — 실패 / 빈 입력 / 파싱 실패 시 sections=[] + fallback=True.
        UI 는 결과를 *카드 형태로 추가 노출* 하고 원본 textarea 는 건드리지 않는다.
    """
    cleaned = (prompt or "").strip()
    if not cleaned:
        return PromptSplitResult(
            sections=[],
            provider="fallback",
            fallback=True,
            error="빈 입력",
        )

    resolved_url = ollama_url or _c._DEFAULT_OLLAMA_URL
    raw = ""
    try:
        raw = await _o._call_ollama_chat(
            ollama_url=resolved_url,
            model=model,
            system=SYSTEM_SPLIT,
            user=cleaned,
            timeout=timeout,
            # spec §4.5 — JSON 모드 + temperature 0 + 짧은 num_predict
            think=False,
            format="json",
            temperature=0.0,
            num_predict=1024,
        )
    except Exception as e:
        _c.log.warning("split_prompt_cards Ollama 호출 실패: %s", e)
        return PromptSplitResult(
            sections=[],
            provider="fallback",
            fallback=True,
            raw="",
            error=f"Ollama 호출 실패: {e}",
        )

    raw_stripped = raw.strip()
    if not raw_stripped:
        return PromptSplitResult(
            sections=[],
            provider="fallback",
            fallback=True,
            raw=raw,
            error="빈 응답",
        )

    try:
        parsed = json.loads(raw_stripped)
    except (json.JSONDecodeError, ValueError) as e:
        _c.log.warning("split_prompt_cards JSON 파싱 실패: %s", e)
        return PromptSplitResult(
            sections=[],
            provider="fallback",
            fallback=True,
            raw=raw,
            error=f"JSON 파싱 실패: {e}",
        )

    sections = _normalize_sections(parsed)
    if not sections:
        # 정규화 후 비면 — 모델이 빈 배열 / 잘못된 shape 반환. fallback.
        return PromptSplitResult(
            sections=[],
            provider="fallback",
            fallback=True,
            raw=raw,
            error="섹션 정규화 결과 비어있음",
        )

    return PromptSplitResult(
        sections=sections,
        provider="ollama",
        fallback=False,
        raw=raw,
    )


# ═══════════════════════════════════════════════════════════════════════
# Translate prompt — 한 ↔ 영 양방향 번역
# ═══════════════════════════════════════════════════════════════════════


SYSTEM_TRANSLATE_PROMPT_KO = """You are a professional translator for AI image-generation prompts.

Translate the given English prompt into natural, readable Korean.

Rules:
- Output ONLY the Korean translation — no preamble, no commentary, no quotes.
- Preserve special tokens VERBATIM (do NOT translate inside them):
    LoRA tags `<lora:name:weight>`,
    weight syntax `(phrase:1.2)` and `((phrase))`,
    negative-prompt prefixes,
    parentheses, colons, numerical weights.
- Photography terms like "35mm film", "bokeh", "depth of field", "cinematic
  grading" can stay in English. Common style anchors stay in English.
- Keep the same level of detail — do NOT summarize.
- Never repeat phrases. Output a single clean translation."""


SYSTEM_TRANSLATE_PROMPT_EN = """You are a professional translator for AI image-generation prompts.

Translate the given Korean prompt into clean, natural English suitable for
Stable-Diffusion / Qwen / Flux models.

Rules:
- Output ONLY the English translation — no preamble, no commentary, no quotes.
- Preserve special tokens VERBATIM (do NOT translate inside them):
    LoRA tags `<lora:name:weight>`,
    weight syntax `(phrase:1.2)` and `((phrase))`,
    negative-prompt prefixes,
    parentheses, colons, numerical weights.
- Translate intent, not literal words — produce idiomatic English that the
  diffusion model would actually understand (e.g. "황금시간 노을빛" →
  "golden hour sunset light").
- Keep the same level of detail — do NOT summarize.
- Never repeat phrases. Output a single clean translation."""


TranslateDirection = Literal["ko", "en"]


@dataclass
class PromptTranslateResult:
    translated: str
    """번역 결과 (실패 시 원문 그대로)."""
    provider: str
    """'ollama' | 'fallback'."""
    fallback: bool
    direction: TranslateDirection
    """번역 방향 — 응답 자체에 포함시켜 클라이언트가 분기에 사용 가능."""
    error: str | None = None


async def translate_prompt(
    text: str,
    *,
    direction: TranslateDirection,
    model: str = "gemma4-un:latest",
    timeout: float = 60.0,
    ollama_url: str | None = None,
) -> PromptTranslateResult:
    """프롬프트 한↔영 양방향 번역.

    spec §4.4: 번역은 항상 think:false (사고모드 이득 낮음 + 속도 우선).
    LoRA / weight / negative 등 특수 토큰은 SYSTEM 프롬프트에서 보존 강제.

    Args:
        text: 번역 대상 프롬프트 (빈 문자열 허용)
        direction: "ko" (영→한) | "en" (한→영)
        model: Ollama 모델 (gemma4-un)
        timeout: 60s 권장 (cold start 여유)
        ollama_url: 기본 settings.ollama_url

    Returns:
        PromptTranslateResult — 실패 시 translated=원문 + fallback=True.
    """
    cleaned = (text or "").strip()
    if not cleaned:
        return PromptTranslateResult(
            translated="",
            provider="fallback",
            fallback=True,
            direction=direction,
            error="빈 입력",
        )

    resolved_url = ollama_url or _c._DEFAULT_OLLAMA_URL
    system = (
        SYSTEM_TRANSLATE_PROMPT_KO
        if direction == "ko"
        else SYSTEM_TRANSLATE_PROMPT_EN
    )
    try:
        raw = await _o._call_ollama_chat(
            ollama_url=resolved_url,
            model=model,
            system=system,
            user=cleaned,
            timeout=timeout,
            # spec §4.4 — 번역은 항상 fast (think False · num_predict 기본값)
        )
    except Exception as e:
        _c.log.warning("translate_prompt 호출 실패 (direction=%s): %s", direction, e)
        return PromptTranslateResult(
            translated=cleaned,
            provider="fallback",
            fallback=True,
            direction=direction,
            error=f"Ollama 호출 실패: {e}",
        )

    out = _c._strip_repeat_noise(raw.strip()).strip()
    if not out:
        return PromptTranslateResult(
            translated=cleaned,
            provider="fallback",
            fallback=True,
            direction=direction,
            error="빈 응답",
        )

    return PromptTranslateResult(
        translated=out,
        provider="ollama",
        fallback=False,
        direction=direction,
    )
