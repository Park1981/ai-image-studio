"""
comparison_pipeline.py - Edit 결과 vs 원본 비교 분석 (qwen2.5vl multi-image).

spec 16 (2026-04-25 v3 패러다임 전환):
  - 5축 키 = 사전 분석 슬롯과 동일 (도메인별 인물 5 / 물체·풍경 5)
  - 점수 의미 = 의도 컨텍스트 (보존이면 유사도, 변경이면 의도부합도)
  - domain 필드 추가 (analyze_pair 만 적용; analyze_pair_generic 영향 없음)

흐름:
1. SOURCE + RESULT 두 이미지를 qwen2.5vl 에 동시 전달
2. SYSTEM_COMPARE 가 (a) 도메인 분류, (b) 슬롯별 의도 판정, (c) 의도-맞춰 점수
3. _parse_strict_json() 로 slots 매트릭스 추출
4. gemma4-un (think:False) 로 슬롯 코멘트 + summary 를 한국어 번역
5. ComparisonAnalysisResult 반환 — fallback 경로도 동일 shape

비전 호출 실패 시 → fallback=True, slots 전부 null score / 빈 comment.
번역만 실패 시 → comments_ko = comments_en, summary_ko = "한글 번역 실패".
"""

from __future__ import annotations

import base64
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from .presets import DEFAULT_OLLAMA_ROLES
from .prompt_pipeline import _DEFAULT_OLLAMA_URL, DEFAULT_TIMEOUT

log = logging.getLogger(__name__)

# 5축 키 — Edit context 전용 (순서 고정 · UI 막대 순서와 일치).
# spec 16: 사전 분석 PERSON_SLOTS / OBJECT_SCENE_SLOTS 와 동일하게 정렬.
PERSON_AXES: tuple[str, str, str, str, str] = (
    "face_expression",
    "hair",
    "attire",
    "body_pose",
    "background",
)
OBJECT_SCENE_AXES: tuple[str, str, str, str, str] = (
    "subject",
    "color_material",
    "layout_composition",
    "background_setting",
    "mood_style",
)
# 옛 5축 (호환용 · 폐기 예정 · analyze_pair_generic 의 COMPARE_AXES 와 다름)
LEGACY_EDIT_AXES: tuple[str, str, str, str, str] = (
    "face_id",
    "body_pose",
    "attire",
    "background",
    "intent_fidelity",
)
# 하위 호환을 위해 AXES alias 유지 — analyze_pair_generic 등이 default 값으로 사용.
# 새 analyze_pair 는 도메인 동적 결정.
AXES: tuple[str, str, str, str, str] = LEGACY_EDIT_AXES

# 5축 키 — Vision Compare context 전용 (사용자가 임의로 고른 두 이미지)
COMPARE_AXES: tuple[str, str, str, str, str] = (
    "composition",
    "color",
    "subject",
    "mood",
    "quality",
)

# 비전 응답 강제 — STRICT JSON only (Edit context v3 · spec 16).
# 도메인 분류 + 슬롯별 의도 판정 + 의도-컨텍스트 점수.
SYSTEM_COMPARE = """You are a vision evaluator comparing TWO images:
  SOURCE = original image (before edit)
  RESULT = edited image (after the user's edit)

The user's edit instruction was: "{edit_prompt}"

Step 1 — Classify domain:
  - "person" if a human or anthropomorphic character is the main subject.
  - "object_scene" otherwise (products, landscapes, animals, food, vehicles,
    interiors, abstract scenes, etc.).

Step 2 — For each of the 5 domain-specific slots, decide intent and score.

  Intent decision (per slot):
    - intent: "edit"     if the user's instruction explicitly asks to change
      this aspect.
    - intent: "preserve" if the user's instruction does NOT mention changing
      this aspect (default to preserve).

  Score 0-100 (integer), based on intent:
    - If intent == "preserve": score = visual SIMILARITY between SOURCE and
      RESULT on this slot. 100 = identical, 0 = completely changed.
    - If intent == "edit":     score = how well the edit FOLLOWS the user's
      instruction on this slot. 100 = fully followed, 0 = ignored.

Step 3 — Write a 1-2 sentence comment per slot (English) explaining the score.
Step 4 — Write a 3-5 sentence overall summary (English).

Return STRICT JSON only (no markdown, no preamble, no trailing text).

If domain == "person":
{
  "domain": "person",
  "slots": {
    "face_expression": {"intent": "edit|preserve", "score": <int>, "comment": "<en>"},
    "hair":            {"intent": "edit|preserve", "score": <int>, "comment": "<en>"},
    "attire":          {"intent": "edit|preserve", "score": <int>, "comment": "<en>"},
    "body_pose":       {"intent": "edit|preserve", "score": <int>, "comment": "<en>"},
    "background":      {"intent": "edit|preserve", "score": <int>, "comment": "<en>"}
  },
  "summary": "<en, 3-5 sentences>"
}

If domain == "object_scene":
{
  "domain": "object_scene",
  "slots": {
    "subject":             {"intent": "edit|preserve", "score": <int>, "comment": "<en>"},
    "color_material":      {"intent": "edit|preserve", "score": <int>, "comment": "<en>"},
    "layout_composition":  {"intent": "edit|preserve", "score": <int>, "comment": "<en>"},
    "background_setting":  {"intent": "edit|preserve", "score": <int>, "comment": "<en>"},
    "mood_style":          {"intent": "edit|preserve", "score": <int>, "comment": "<en>"}
  },
  "summary": "<en, 3-5 sentences>"
}

Rules:
- Always fill ALL 5 slots for the chosen domain. Never omit a slot.
- Always provide an integer score 0-100 (no nulls).
- Comments are concise (max 2 sentences each)."""

# 비전 응답 강제 — STRICT JSON only (Vision Compare context · 신규 · edit 무영향)
# 사용자가 직접 고른 두 이미지를 5축 (composition/color/subject/mood/quality)으로 비교
# 힌트가 있으면 프롬프트 끝에 강한 지시문이 추가됨 (_call_vision_pair_generic 에서 처리)
SYSTEM_COMPARE_GENERIC = """You are a vision evaluator comparing TWO arbitrary images:
  IMAGE_A = first image
  IMAGE_B = second image

Evaluate the two images side-by-side on FIVE axes.
Score each axis 0-100 (integer) where the score reflects HOW SIMILAR the
two images are on that axis. 100 = identical, 0 = completely different.
  - composition: framing, layout, subject placement, perspective.
  - color: dominant palette, saturation, white balance, lighting tone.
  - subject: main subject(s) — identity, count, pose, action, expression.
  - mood: overall atmosphere, emotional tone, time-of-day feel.
  - quality: technical sharpness, resolution feel, noise/artifacts, focus.

Write a 1-2 sentence comment per axis (English) describing the
key DIFFERENCE between A and B on that axis.
Then write a 3-5 sentence overall summary (English) of how A and B compare.

Return STRICT JSON only (no markdown, no preamble, no trailing text):
{
  "scores": {
    "composition": <int>, "color": <int>, "subject": <int>,
    "mood": <int>, "quality": <int>
  },
  "comments": {
    "composition": "<en>", "color": "<en>", "subject": "<en>",
    "mood": "<en>", "quality": "<en>"
  },
  "summary": "<en, 3-5 sentences>"
}"""

# 힌트가 있을 때 시스템 프롬프트 끝에 추가되는 강한 지시 블록
# (없으면 추가하지 않음 — AI 가 빈 힌트로 혼란 안 겪게)
_COMPARE_HINT_DIRECTIVE = """

═══════════════════════════════════════════
 USER'S COMPARISON FOCUS — APPLY TO ALL AXES
═══════════════════════════════════════════
The user wants you to focus this comparison on:
  >>> {compare_hint} <<<

REQUIRED behavior:
1. PRIORITIZE this focus area when scoring EVERY axis. If the focus is
   "faces", then composition/color/subject/mood/quality scores must
   primarily reflect how the FACES compare on each axis.
2. EVERY axis comment MUST mention how A and B differ specifically
   regarding "{compare_hint}".
3. The summary's first sentence MUST directly address "{compare_hint}".
4. Ignore aspects of the images that are unrelated to "{compare_hint}".
═══════════════════════════════════════════
"""


@dataclass
class ComparisonSlotEntry:
    """v3 슬롯 엔트리 — intent + score + comment (en/ko 둘 다)."""

    intent: str = "preserve"  # "edit" | "preserve"
    score: int | None = None  # 0-100, fallback 시 None
    comment_en: str = ""
    comment_ko: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent": self.intent,
            "score": self.score,
            "commentEn": self.comment_en,
            "commentKo": self.comment_ko,
        }


@dataclass
class ComparisonAnalysisResult:
    """analyze_pair / analyze_pair_generic 공용 결과.

    v3 형식 (analyze_pair 만 사용):
      - domain + slots (인물 5 / 물체·풍경 5)
      - 점수 의미 = 의도 컨텍스트 (보존이면 유사도, 변경이면 의도부합도)

    옛 형식 (analyze_pair_generic 만 사용 · Vision Compare 메뉴):
      - scores + comments_en/ko + summary_en/ko (5축 유사도)

    to_dict() 가 두 형식 모두 직렬화 — 프론트가 키 셋으로 자동 분기.
    """

    # v3 신규 필드 (analyze_pair · spec 16)
    domain: str = ""  # "person" | "object_scene" | "" (옛 형식 또는 fallback)
    slots: dict[str, ComparisonSlotEntry] = field(default_factory=dict)

    # 옛 형식 (analyze_pair_generic + 호환용)
    scores: dict[str, int | None] = field(default_factory=dict)
    comments_en: dict[str, str] = field(default_factory=dict)
    comments_ko: dict[str, str] = field(default_factory=dict)

    overall: int = 0
    summary_en: str = ""
    summary_ko: str = ""
    provider: str = "fallback"  # "ollama" | "fallback"
    fallback: bool = True
    analyzed_at: int = 0
    vision_model: str = ""

    def to_dict(self) -> dict[str, Any]:
        """API 응답 / DB 저장용 직렬화. v3 와 옛 형식 모두 포함 — 프론트 자동 분기."""
        out: dict[str, Any] = {
            "overall": self.overall,
            "summary_en": self.summary_en,
            "summary_ko": self.summary_ko,
            "provider": self.provider,
            "fallback": self.fallback,
            "analyzedAt": self.analyzed_at,
            "visionModel": self.vision_model,
        }
        # v3 형식 — analyze_pair 가 채움
        if self.domain and self.slots:
            out["domain"] = self.domain
            out["slots"] = {k: v.to_dict() for k, v in self.slots.items()}
        # 옛 형식 — analyze_pair_generic 또는 fallback 시 채움
        if self.scores:
            out["scores"] = self.scores
        if self.comments_en:
            out["comments_en"] = self.comments_en
        if self.comments_ko:
            out["comments_ko"] = self.comments_ko
        return out


def _empty_scores(axes: tuple[str, ...] = AXES) -> dict[str, int | None]:
    """fallback 시 모든 축 null 로 초기화. axes 기본값=AXES (edit 호출자 무영향)."""
    return {k: None for k in axes}


def _empty_comments(axes: tuple[str, ...] = AXES) -> dict[str, str]:
    """모든 축 빈 문자열로 초기화. axes 기본값=AXES (edit 호출자 무영향)."""
    return {k: "" for k in axes}


def _to_b64(data: bytes) -> str:
    """바이트를 base64 ASCII 문자열로 변환 (Ollama images 배열 형식)."""
    return base64.b64encode(data).decode("ascii")


async def _call_vision_pair(
    source_bytes: bytes,
    result_bytes: bytes,
    edit_prompt: str,
    *,
    vision_model: str,
    timeout: float,
    ollama_url: str,
) -> str:
    """qwen2.5vl 에 두 이미지 동시 전달 → raw 응답 문자열.

    Ollama /api/chat messages.images 배열에 SOURCE, RESULT 순서로 담음.
    실패 시 빈 문자열 반환 (예외는 위로 안 올림 — analyze_pair 가 fallback 처리).
    """
    payload = {
        "model": vision_model,
        "messages": [
            {
                "role": "system",
                "content": SYSTEM_COMPARE.replace("{edit_prompt}", edit_prompt[:400]),
            },
            {
                "role": "user",
                "content": (
                    "Image 1 = SOURCE (original).\n"
                    "Image 2 = RESULT (edited).\n"
                    "Evaluate now. Return STRICT JSON only."
                ),
                # qwen2.5vl Ollama API: images 배열에 순서대로 base64 전달
                "images": [_to_b64(source_bytes), _to_b64(result_bytes)],
            },
        ],
        "stream": False,
        "options": {"temperature": 0.3, "num_ctx": 8192},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(f"{ollama_url}/api/chat", json=payload)
            res.raise_for_status()
            data = res.json()
            return ((data.get("message") or {}).get("content") or "").strip()
    except Exception as e:
        log.warning("compare vision call failed (%s): %s", vision_model, e)
        return ""


def _parse_strict_json(raw: str) -> dict[str, Any] | None:
    """비전 응답에서 첫 번째 JSON object 추출 → dict, 실패 시 None.

    qwen2.5vl 이 가끔 ```json ... ``` 펜스를 두르거나 JSON 뒤에 자연어 코멘트
    (예: "{...} Confidence: high") 를 붙임. 따라서:
      1) ``` 펜스 제거
      2) 첫 '{' 부터 brace depth 가 0 이 되는 첫 '}' 까지 균형 매칭
      3) json.loads — 실패 시 None
    """
    if not raw:
        return None
    # ``` 펜스 제거
    cleaned = re.sub(r"```(?:json)?\s*", "", raw, flags=re.IGNORECASE).rstrip("`").strip()
    # 첫 '{' 위치 탐색
    start = cleaned.find("{")
    if start == -1:
        return None
    # balanced-brace 탐색 — depth 가 0 이 되는 첫 '}' 까지만 추출
    depth = 0
    for i in range(start, len(cleaned)):
        ch = cleaned[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(cleaned[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None  # 균형 안 맞으면 (열린 채 끝남) None


def _coerce_scores(
    raw_scores: Any, axes: tuple[str, ...] = AXES
) -> dict[str, int | None]:
    """5축 점수 dict 정규화 — 누락 / 비정수 → None, 범위는 0-100 클램프.
    axes 기본값=AXES (edit 호출자 무영향)."""
    out: dict[str, int | None] = _empty_scores(axes)
    if not isinstance(raw_scores, dict):
        return out
    for axis in axes:
        val = raw_scores.get(axis)
        if isinstance(val, bool):  # bool 은 int 의 subclass — 명시 제외
            continue
        if isinstance(val, (int, float)):
            out[axis] = max(0, min(100, int(val)))
    return out


def _coerce_comments(
    raw_comments: Any, axes: tuple[str, ...] = AXES
) -> dict[str, str]:
    """5축 코멘트 dict 정규화 — 누락 → 빈 문자열, strip 적용.
    axes 기본값=AXES (edit 호출자 무영향)."""
    out: dict[str, str] = _empty_comments(axes)
    if not isinstance(raw_comments, dict):
        return out
    for axis in axes:
        v = raw_comments.get(axis)
        if isinstance(v, str):
            out[axis] = v.strip()
    return out


def _compute_overall(scores: dict[str, int | None]) -> int:
    """5축 산술 평균 — None 제외. 모두 None 이면 0 반환."""
    valid = [v for v in scores.values() if v is not None]
    if not valid:
        return 0
    return round(sum(valid) / len(valid))


# 한국어 번역 묶음 — 5축 코멘트 + summary 를 한 번에 보내고 섹션 헤더로 분리
_TRANSLATE_SYSTEM = """You are a professional Korean translator.
You receive multiple short English texts, each prefixed with [section_name].
Translate each section into natural Korean. Keep the same [section_name]
prefix on each Korean section. Output ONLY the translated sections — no
preamble, no explanation. Use exactly this format:

[section_name]
<korean translation>

[section_name]
<korean translation>
...
"""


async def _translate_comments_to_ko(
    comments_en: dict[str, str],
    summary_en: str,
    *,
    text_model: str,
    timeout: float,
    ollama_url: str,
    axes: tuple[str, ...] = AXES,
) -> dict[str, Any] | None:
    """5축 코멘트 + summary 를 한 호출로 번역 (gemma4-un, think:False). 실패 시 None.
    axes 기본값=AXES (edit 호출자 무영향).

    Returns:
        {"comments_ko": {axis: ko_text, ...}, "summary_ko": str} or None
    """
    # 번역할 섹션 묶음 구성
    sections: list[str] = []
    for axis in axes:
        text = comments_en.get(axis, "").strip()
        if text:
            sections.append(f"[{axis}]\n{text}")
    if summary_en.strip():
        sections.append(f"[summary]\n{summary_en.strip()}")
    if not sections:
        return None

    user_msg = "\n\n".join(sections)
    payload = {
        "model": text_model,
        "messages": [
            {"role": "system", "content": _TRANSLATE_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        "stream": False,
        # CLAUDE.md 규칙: gemma4-un 은 reasoning 모델 → think:False 필수
        "think": False,
        "options": {"temperature": 0.4, "num_ctx": 4096, "num_predict": 800},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(f"{ollama_url}/api/chat", json=payload)
            res.raise_for_status()
            data = res.json()
            raw = ((data.get("message") or {}).get("content") or "").strip()
        if not raw:
            return None
    except Exception as e:
        log.info("compare translation failed (non-fatal): %s", e)
        return None

    # 섹션 파싱 — [axis_name] 패턴으로 split (대소문자 무시)
    # re.split 결과: ["", "axis1", "text1", "axis2", "text2", ...]
    sections_ko = re.split(r"\[([a-zA-Z_]+)\]\s*", raw)
    comments_ko: dict[str, str] = {}
    summary_ko = ""
    # 짝수 인덱스(1,3,5,...) = 키, 홀수 인덱스(2,4,6,...) = 값
    for i in range(1, len(sections_ko) - 1, 2):
        # 모델이 대문자/혼합 케이스로 응답해도 lower() 로 정규화
        key = sections_ko[i].strip().lower()
        val = sections_ko[i + 1].strip()
        if key == "summary":
            summary_ko = val
        elif key in axes:
            comments_ko[key] = val
    return {"comments_ko": comments_ko, "summary_ko": summary_ko}


def _coerce_intent(raw: Any) -> str:
    """슬롯 intent 정규화 — edit/preserve 외 값은 preserve 기본."""
    s = (raw or "").strip().lower() if isinstance(raw, str) else ""
    return s if s in ("edit", "preserve") else "preserve"


def _coerce_score(raw: Any) -> int | None:
    """0-100 정수로 정규화. None / 비정수 → None."""
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return max(0, min(100, int(raw)))
    return None


def _coerce_v3_slots(
    raw: Any, axes: tuple[str, ...]
) -> dict[str, ComparisonSlotEntry]:
    """v3 슬롯 매트릭스 정규화 — 도메인 키 5개 강제."""
    out: dict[str, ComparisonSlotEntry] = {}
    raw_dict = raw if isinstance(raw, dict) else {}
    for key in axes:
        item = raw_dict.get(key)
        if isinstance(item, dict):
            out[key] = ComparisonSlotEntry(
                intent=_coerce_intent(item.get("intent")),
                score=_coerce_score(item.get("score")),
                comment_en=(
                    item.get("comment", "").strip()
                    if isinstance(item.get("comment"), str)
                    else ""
                ),
                comment_ko="",  # 번역 단계에서 채움
            )
        else:
            out[key] = ComparisonSlotEntry(
                intent="preserve", score=None, comment_en="", comment_ko=""
            )
    return out


def _v3_overall(slots: dict[str, ComparisonSlotEntry]) -> int:
    """v3 종합 = 슬롯 점수 산술평균 (None 제외, 모두 None 이면 0)."""
    valid = [s.score for s in slots.values() if s.score is not None]
    if not valid:
        return 0
    return round(sum(valid) / len(valid))


async def analyze_pair(
    source_bytes: bytes,
    result_bytes: bytes,
    edit_prompt: str,
    *,
    vision_model: str | None = None,
    text_model: str | None = None,
    ollama_url: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> ComparisonAnalysisResult:
    """SOURCE + RESULT 비교 분석 v3 (spec 16 · 도메인 분기 + 의도 컨텍스트 점수).

    HTTP 200 원칙 — 모든 fallback 경로도 ComparisonAnalysisResult shape 유지.

    Args:
        source_bytes / result_bytes: PIL 호환 이미지 바이트
        edit_prompt: 사용자 수정 지시 (시스템 프롬프트에 주입)
        vision_model: 기본 settings.visionModel (qwen2.5vl:7b)
        text_model: 번역용 (기본 gemma4-un:latest)
    """
    resolved_vision = vision_model or DEFAULT_OLLAMA_ROLES.vision
    resolved_text = text_model or DEFAULT_OLLAMA_ROLES.text
    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL

    # ── 1단계: 비전 호출 ──
    raw = await _call_vision_pair(
        source_bytes,
        result_bytes,
        edit_prompt,
        vision_model=resolved_vision,
        timeout=timeout,
        ollama_url=resolved_url,
    )
    if not raw:
        return ComparisonAnalysisResult(
            domain="object_scene",
            slots={
                k: ComparisonSlotEntry(
                    intent="preserve", score=None, comment_en="", comment_ko=""
                )
                for k in OBJECT_SCENE_AXES
            },
            summary_en="Vision model unavailable.",
            summary_ko="비전 모델 응답 없음.",
            provider="fallback",
            fallback=True,
            analyzed_at=int(time.time() * 1000),
            vision_model=resolved_vision,
        )

    # ── 2단계: JSON 파싱 ──
    parsed = _parse_strict_json(raw)
    if parsed is None:
        log.warning("compare JSON parse failed; raw head: %s", raw[:200])
        return ComparisonAnalysisResult(
            domain="object_scene",
            slots={
                k: ComparisonSlotEntry(
                    intent="preserve", score=None, comment_en="", comment_ko=""
                )
                for k in OBJECT_SCENE_AXES
            },
            summary_en="Vision response parse failed.",
            summary_ko="비전 응답 파싱 실패.",
            provider="fallback",
            fallback=True,
            analyzed_at=int(time.time() * 1000),
            vision_model=resolved_vision,
        )

    # ── 3단계: domain + slots 정규화 ──
    raw_domain = parsed.get("domain")
    domain = (
        raw_domain.strip().lower()
        if isinstance(raw_domain, str) and raw_domain.strip().lower() in ("person", "object_scene")
        else "object_scene"
    )
    axes = PERSON_AXES if domain == "person" else OBJECT_SCENE_AXES
    slots = _coerce_v3_slots(parsed.get("slots"), axes)
    summary_raw = parsed.get("summary")
    summary_en = summary_raw.strip() if isinstance(summary_raw, str) else ""
    overall = _v3_overall(slots)

    # ── 4단계: 한글 번역 (코멘트 + summary 한 호출) ──
    comments_en_for_translate = {k: s.comment_en for k, s in slots.items()}
    translation = await _translate_comments_to_ko(
        comments_en_for_translate,
        summary_en,
        text_model=resolved_text,
        timeout=60.0,
        ollama_url=resolved_url,
        axes=axes,
    )
    if translation is None:
        # 번역 실패 — 코멘트는 en 그대로, summary 에 마커
        for k, s in slots.items():
            s.comment_ko = s.comment_en
        summary_ko = "한글 번역 실패"
    else:
        for k, s in slots.items():
            s.comment_ko = (
                translation["comments_ko"].get(k) or s.comment_en
            )
        summary_ko = translation["summary_ko"] or summary_en

    return ComparisonAnalysisResult(
        domain=domain,
        slots=slots,
        overall=overall,
        summary_en=summary_en,
        summary_ko=summary_ko,
        provider="ollama",
        fallback=False,
        analyzed_at=int(time.time() * 1000),
        vision_model=resolved_vision,
    )


# ═══════════════════════════════════════════════════════════════════════
#  Vision Compare Context (신규 · 2026-04-24)
#  사용자가 직접 고른 두 이미지 비교용 — 위 Edit 코드 경로(analyze_pair)와
#  완전 분리. 시스템 프롬프트(SYSTEM_COMPARE_GENERIC), 5축(COMPARE_AXES)
#  모두 별도. Edit 호출자는 이 코드 경로를 절대 거치지 않음.
# ═══════════════════════════════════════════════════════════════════════


async def _call_vision_pair_generic(
    image_a_bytes: bytes,
    image_b_bytes: bytes,
    compare_hint: str,
    *,
    vision_model: str,
    timeout: float,
    ollama_url: str,
) -> str:
    """qwen2.5vl 에 임의 두 이미지(A, B) 동시 전달 → raw 응답 문자열.

    Edit 의 _call_vision_pair 와 시스템 프롬프트가 다른 것 외에는 동일 구조.
    힌트가 있으면 시스템 프롬프트 끝에 강한 지시 블록 추가 +
    user message 첫 줄에 한번 더 강조 (qwen2.5vl 이 무시하는 것 방지).
    실패 시 빈 문자열 반환.
    """
    # 힌트 트리밍 (시스템 프롬프트에서 400자 cap)
    hint_clean = compare_hint.strip()[:400] if compare_hint else ""

    # 시스템 프롬프트 — 힌트 있으면 강한 지시 블록 추가
    system_content = SYSTEM_COMPARE_GENERIC
    if hint_clean:
        system_content += _COMPARE_HINT_DIRECTIVE.replace(
            "{compare_hint}", hint_clean
        )

    # user message — 힌트 있으면 첫 줄에 한번 더 강조 (가장 가까운 곳에 위치)
    user_lines = ["Image 1 = IMAGE_A.", "Image 2 = IMAGE_B."]
    if hint_clean:
        user_lines.append(f'>>> Focus your comparison on: "{hint_clean}" <<<')
    user_lines.append("Compare them now. Return STRICT JSON only.")
    user_content = "\n".join(user_lines)

    payload = {
        "model": vision_model,
        "messages": [
            {
                "role": "system",
                "content": system_content,
            },
            {
                "role": "user",
                "content": user_content,
                "images": [_to_b64(image_a_bytes), _to_b64(image_b_bytes)],
            },
        ],
        "stream": False,
        "options": {"temperature": 0.3, "num_ctx": 8192},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(f"{ollama_url}/api/chat", json=payload)
            res.raise_for_status()
            data = res.json()
            return ((data.get("message") or {}).get("content") or "").strip()
    except Exception as e:
        log.warning("compare-generic vision call failed (%s): %s", vision_model, e)
        return ""


async def analyze_pair_generic(
    image_a_bytes: bytes,
    image_b_bytes: bytes,
    compare_hint: str,
    *,
    vision_model: str | None = None,
    text_model: str | None = None,
    ollama_url: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> ComparisonAnalysisResult:
    """A + B 두 이미지의 일반 비교 분석 (Vision Compare 메뉴 전용).

    Edit 의 analyze_pair 와 5축 (composition/color/subject/mood/quality) +
    시스템 프롬프트 (SYSTEM_COMPARE_GENERIC) 가 다름. Edit 코드 경로 무영향.

    Args:
        image_a_bytes / image_b_bytes: PIL 호환 이미지 바이트 (사용자 업로드 2장)
        compare_hint: 사용자 비교 지시 힌트 (선택 · 빈 문자열 OK)
        vision_model: 기본 settings.visionModel (qwen2.5vl:7b)
        text_model: 번역용 (기본 gemma4-un:latest)

    Returns:
        ComparisonAnalysisResult — 모든 fallback 경로 동일 shape 보장.
    """
    resolved_vision = vision_model or DEFAULT_OLLAMA_ROLES.vision
    resolved_text = text_model or DEFAULT_OLLAMA_ROLES.text
    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL

    # ── 1단계: 비전 호출 ──
    raw = await _call_vision_pair_generic(
        image_a_bytes,
        image_b_bytes,
        compare_hint,
        vision_model=resolved_vision,
        timeout=timeout,
        ollama_url=resolved_url,
    )
    if not raw:
        return ComparisonAnalysisResult(
            scores=_empty_scores(COMPARE_AXES),
            comments_en=_empty_comments(COMPARE_AXES),
            comments_ko=_empty_comments(COMPARE_AXES),
            summary_en="Vision model unavailable.",
            summary_ko="비전 모델 응답 없음.",
            provider="fallback",
            fallback=True,
            analyzed_at=int(time.time() * 1000),
            vision_model=resolved_vision,
        )

    # ── 2단계: JSON 파싱 ──
    parsed = _parse_strict_json(raw)
    if parsed is None:
        log.warning("compare-generic JSON parse failed; raw head: %s", raw[:200])
        return ComparisonAnalysisResult(
            scores=_empty_scores(COMPARE_AXES),
            comments_en=_empty_comments(COMPARE_AXES),
            comments_ko=_empty_comments(COMPARE_AXES),
            summary_en="Vision response parse failed.",
            summary_ko="비전 응답 파싱 실패.",
            provider="fallback",
            fallback=True,
            analyzed_at=int(time.time() * 1000),
            vision_model=resolved_vision,
        )

    # ── 3단계: 점수/코멘트 정규화 (axes=COMPARE_AXES) ──
    scores = _coerce_scores(parsed.get("scores"), COMPARE_AXES)
    comments_en = _coerce_comments(parsed.get("comments"), COMPARE_AXES)
    summary_raw = parsed.get("summary")
    summary_en = summary_raw.strip() if isinstance(summary_raw, str) else ""
    overall = _compute_overall(scores)

    # ── 4단계: 한글 번역 (실패해도 en 으로 폴백) ──
    translation = await _translate_comments_to_ko(
        comments_en,
        summary_en,
        text_model=resolved_text,
        timeout=60.0,
        ollama_url=resolved_url,
        axes=COMPARE_AXES,
    )
    if translation is None:
        comments_ko = dict(comments_en)
        summary_ko = "한글 번역 실패"
    else:
        comments_ko = {
            axis: translation["comments_ko"].get(axis) or comments_en.get(axis, "")
            for axis in COMPARE_AXES
        }
        summary_ko = translation["summary_ko"] or summary_en

    return ComparisonAnalysisResult(
        scores=scores,
        overall=overall,
        comments_en=comments_en,
        comments_ko=comments_ko,
        summary_en=summary_en,
        summary_ko=summary_ko,
        provider="ollama",
        fallback=False,
        analyzed_at=int(time.time() * 1000),
        vision_model=resolved_vision,
    )
