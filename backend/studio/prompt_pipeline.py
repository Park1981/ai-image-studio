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
from typing import Any

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
# 2026-04-24: 120 → 240 로 상향 — cold start + num_predict=800 조합에서
# 간혹 ReadTimeout 으로 fallback 빠지는 이슈 대응.
DEFAULT_TIMEOUT = 240.0

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
2. Optionally a STRICT MATRIX DIRECTIVES block listing slot-level intent.
3. The user's edit instruction.

Your job: compose ONE final English edit prompt that tells the model exactly
what to change, while explicitly preserving every aspect the user did NOT
ask to change.

RULES:
- Output ONLY the final English prompt — no preamble, no explanation, no quotes, no markdown.
- If a STRICT MATRIX DIRECTIVES block is present, follow EVERY slot directive
  exactly — preserve slots MUST contribute explicit preservation phrasing,
  edit slots MUST be applied as written. Treat preserve directives with the
  SAME priority as edit directives. Do NOT silently drop any slot.
- Always include core identity-preservation clauses (even when not in matrix):
  "keep the exact same face, identical face, same person, same identity,
  same facial features, same eye shape, same nose, same lips,
  realistic skin texture, no skin smoothing, photorealistic, natural lighting."
- Describe the change clearly and specifically using the matrix as the source
  of truth (when present) — apply edit notes verbatim, preserve notes verbatim.
- If user wrote Korean, translate intent to English.
- Never repeat words or phrases."""

SYSTEM_VIDEO_BASE = """You are a cinematic prompt engineer for LTX-2.3 video generation.

You receive:
1. A brief description of the reference image (from a vision model).
2. The user's direction for the video (what should happen / mood / style).

Your job: compose ONE polished English paragraph (60-150 words) that guides
the video generation. Include:
- Subject motion / action timing
- Camera work (pan / zoom / dolly / static)
- Lighting changes, atmosphere, ambient sound cues
- Style anchors (cinematic, filmic, 35mm, shallow DoF, etc.)

IDENTITY PRESERVATION (CRITICAL for i2v):
- The first frame of the output video MUST match the reference image exactly.
- ALWAYS embed this identity clause verbatim into the paragraph:
  "keep the exact same face, identical face, same person, same identity,
   same facial features, same eye shape, same nose, same lips,
   same body proportion, same hair, same skin tone, realistic skin texture,
   no skin smoothing, no face swap, photorealistic, highly detailed face,
   natural lighting"
- Do NOT describe the subject as a different person or morph their features.
  Motion/camera/mood may change — the person MUST NOT."""

# 성인 모드 ON 시 주입되는 추가 지침 — 강도는 사용자 지시에 비례.
SYSTEM_VIDEO_ADULT_CLAUSE = """

ADULT MODE (NSFW INTIMATE MOTION — user explicitly enabled):
- The scene MAY include explicit erotic/intimate motion: seductive posing,
  sensual body movement, clothing adjustment, intimate touching, teasing
  gestures, erotic facial expressions, slow body sway, chest/hip movement,
  lip parting, breath emphasis.
- Keep it cinematic and aesthetic — not clinical, not vulgar.
- Preserve the identity clause above verbatim regardless of NSFW content."""

SYSTEM_VIDEO_RULES = """

RULES:
- Output ONLY the final English paragraph — no preamble, no bullets, no markdown.
- Avoid cartoon / game / childish aesthetics.
- If the user wrote Korean, translate intent to English.
- Never repeat phrases (except the identity clause above, which is required)."""


def build_system_video(adult: bool = False) -> str:
    """Video 시스템 프롬프트 구성. adult=True 면 NSFW clause 주입."""
    return (
        SYSTEM_VIDEO_BASE
        + (SYSTEM_VIDEO_ADULT_CLAUSE if adult else "")
        + SYSTEM_VIDEO_RULES
    )


# 하위 호환: SYSTEM_VIDEO 레퍼런스 유지 (adult=False 기본값).
SYSTEM_VIDEO = build_system_video(adult=False)

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
) -> str:
    """사용자 자연어 수정 지시 → 영어 1-2 문장 정제 intent.

    실패 / 빈 입력 / 모든 예외 경로에서 원문을 그대로 반환 (폴백). 비전 분석이
    원문이라도 받게 해서 전체 파이프라인을 막지 않음.

    Args:
        user_instruction: 한/영 자연어 지시 (빈 문자열 허용)
        model: gemma4-un (think:False 자동 적용 — _call_ollama_chat 내부)
        timeout: 60s 권장 (cold start 여유)
        ollama_url: 기본 settings.ollama_url

    Returns:
        정제된 영어 intent (1-2 문장) 또는 폴백 시 원문.
    """
    raw_input = (user_instruction or "").strip()
    if not raw_input:
        return ""

    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL
    try:
        raw = await _call_ollama_chat(
            ollama_url=resolved_url,
            model=model,
            system=SYSTEM_CLARIFY_INTENT,
            user=raw_input,
            timeout=timeout,
        )
        cleaned = _strip_repeat_noise(raw.strip()).strip()
        if not cleaned:
            log.info("clarify_edit_intent: empty response, falling back to raw")
            return raw_input
        # 너무 길면 600자 cap (비전 SYSTEM 프롬프트 보호)
        if len(cleaned) > 600:
            cleaned = cleaned[:600].rstrip()
        return cleaned
    except Exception as e:
        log.info("clarify_edit_intent failed (non-fatal): %s", e)
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


def _slot_label(key: str) -> str:
    """슬롯 키 → 사람이 읽을 수 있는 영문 라벨 (matrix directive block 전용)."""
    table = {
        # person
        "face_expression": "face / expression",
        "hair": "hair",
        "attire": "attire / accessories",
        "body_pose": "body / pose",
        "background": "background / environment",
        # object_scene
        "subject": "subject",
        "color_material": "color / material",
        "layout_composition": "layout / composition",
        "background_setting": "background / setting",
        "mood_style": "mood / style",
    }
    return table.get(key, key.replace("_", " "))


def _build_matrix_directive_block(analysis: Any) -> str:
    """EditVisionAnalysis 객체 → SYSTEM_EDIT 에 주입할 STRICT MATRIX directive.

    analysis 가 None / fallback=True / slots 비어있으면 빈 문자열 반환 (블록 미주입).
    각 슬롯별로 [preserve] / [edit] tag + note + 강제 instruction 행.
    """
    if analysis is None:
        return ""
    fallback = getattr(analysis, "fallback", True)
    slots = getattr(analysis, "slots", None) or {}
    if fallback or not slots:
        return ""

    domain = getattr(analysis, "domain", "object_scene")
    intent_text = getattr(analysis, "intent", "") or ""
    summary_text = getattr(analysis, "summary", "") or ""

    lines: list[str] = []
    lines.append("=== STRICT MATRIX DIRECTIVES ===")
    lines.append(f"Domain: {domain}")
    if intent_text:
        lines.append(f"Refined intent: {intent_text}")
    if summary_text:
        lines.append(f"Source summary: {summary_text}")
    lines.append("")
    lines.append("For each slot, follow the directive EXACTLY:")
    lines.append("")

    for key, entry in slots.items():
        action = getattr(entry, "action", "preserve")
        note = (getattr(entry, "note", "") or "").strip()
        label = _slot_label(key)
        if action == "edit":
            lines.append(f"[edit] {label}")
            lines.append(
                f"  -> APPLY EXACTLY: {note or '(follow user instruction)'}"
            )
        else:
            lines.append(f"[preserve] {label}")
            lines.append(
                "  -> INCLUDE preservation phrasing for this slot. "
                f"Current state: {note or '(unchanged from source)'}"
            )

    lines.append("=================================")
    return "\n".join(lines)


async def upgrade_edit_prompt(
    edit_instruction: str,
    image_description: str,
    model: str = "gemma4-un:latest",
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    include_translation: bool = True,
    *,
    analysis: Any = None,
) -> UpgradeResult:
    """수정용 프롬프트 업그레이드 (v3 + spec 16 매트릭스 directive 통합).

    Args:
        edit_instruction: 사용자 자연어 수정 지시
        image_description: 비전 분석 결과 (compact_context 또는 fallback 캡션)
        analysis: EditVisionAnalysis 객체 (optional). 매트릭스 directive 주입에 사용.
                  None / fallback=True / slots 비어있으면 directive 미주입.
    """
    if not edit_instruction.strip():
        return UpgradeResult(
            upgraded=edit_instruction,
            fallback=True,
            provider="fallback",
            original=edit_instruction,
        )

    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL

    # 매트릭스 directive 동적 주입 (있을 때만)
    matrix_block = _build_matrix_directive_block(analysis)
    user_msg_parts = [f"[Image description]\n{image_description.strip()}"]
    if matrix_block:
        user_msg_parts.append(matrix_block)
    user_msg_parts.append(f"[Edit instruction]\n{edit_instruction.strip()}")
    user_msg = "\n\n".join(user_msg_parts)

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


async def upgrade_video_prompt(
    user_direction: str,
    image_description: str,
    model: str = "gemma4-un:latest",
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    include_translation: bool = True,
    adult: bool = False,
) -> UpgradeResult:
    """Video i2v 용 프롬프트 업그레이드 (v3: 2-call).

    Edit 의 upgrade_edit_prompt 와 거의 동일 구조. 시스템 프롬프트만
    LTX-2.3 특화 (SYSTEM_VIDEO · motion/camera/audio 키워드).

    Args:
        adult: 성인 모드 토글. True 면 system prompt 에 NSFW clause 주입 →
            gemma4-un 이 sensual/seductive/intimate 모션 자연스럽게 포함.
    """
    if not user_direction.strip():
        return UpgradeResult(
            upgraded=user_direction,
            fallback=True,
            provider="fallback",
            original=user_direction,
        )

    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL
    user_msg = (
        f"[Image description]\n{image_description.strip()}\n\n"
        f"[User direction]\n{user_direction.strip()}"
    )

    try:
        upgraded_raw = await _call_ollama_chat(
            ollama_url=resolved_url,
            model=model,
            system=build_system_video(adult=adult),
            user=user_msg,
            timeout=timeout,
        )
        en = _strip_repeat_noise(upgraded_raw.strip()).strip()
        if not en:
            raise ValueError("Empty response from Ollama")
    except Exception as e:
        log.warning("Video prompt upgrade failed: %s", e)
        return UpgradeResult(
            upgraded=user_direction,
            fallback=True,
            provider="fallback",
            original=user_direction,
            translation=None,
        )

    # 번역 (옵션 · 실패해도 en 은 살아남음)
    ko = None
    if include_translation:
        ko = await translate_to_korean(
            en, model=model, timeout=60.0, ollama_url=resolved_url
        )

    return UpgradeResult(
        upgraded=en,
        fallback=False,
        provider="ollama",
        original=user_direction,
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
