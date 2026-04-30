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

import time
from typing import Any

from .._ollama_client import call_chat_payload
from ..presets import DEFAULT_OLLAMA_ROLES
from ..prompt_pipeline import _DEFAULT_OLLAMA_URL, DEFAULT_TIMEOUT
from ..vision_pipeline import ProgressCallback  # Phase 6 (2026-04-27): 단일 source
from . import _common as _c
from ._common import (  # noqa: F401 — facade re-export (production + test 호환)
    AXES,
    COMPARE_AXES,
    LEGACY_EDIT_AXES,
    OBJECT_SCENE_AXES,
    PERSON_AXES,
    ComparisonAnalysisResult,
    ComparisonSlotEntry,
    _coerce_comments,
    _coerce_score,
    _coerce_scores,
    _compute_overall,
    _empty_comments,
    _empty_scores,
    _parse_strict_json,
    _to_b64,
    _TRANSLATE_SYSTEM,
    _translate_comments_to_ko,
    log,
)

# 비전 응답 강제 — STRICT JSON only (Edit context v3.1 · spec 19 · 2026-04-26).
# 도메인 분류 + 슬롯별 의도 판정 + 의도-컨텍스트 점수 + score rubric + transform/uncertain.
#
# v3.1 변경 (Codex 진단 #3 + #4 + #6 반영):
#   - Score rubric (95-100/90-94/...) 추가 — preserve 슬롯 점수 후함 방지
#   - "Default to LOW end when unsure. Under-score before over-score." 편향 가드
#   - {refined_intent} placeholder — 정제된 영문 intent 도 함께 주입
#   - transform_prompt 슬롯 — 사용자 의도와 실제 결과 사이의 잔여 작업 묘사
#   - uncertain 슬롯 — 비교 못한 영역 명시
#
# hard cap (Vision Compare v2.2) 은 edit context 와 의미가 안 맞아 의도적으로 제외.
# (edit 슬롯의 점수는 "변경 정도" 가 아니라 "의도 부합도" 라 cap 부적절.)
SYSTEM_COMPARE = """You are a vision evaluator comparing TWO images:
  SOURCE = original image (before edit)
  RESULT = edited image (after the user's edit)

The user's raw edit instruction was: "{edit_prompt}"
Refined English intent (cleaned): "{refined_intent}"

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

  Score rubric (apply to BOTH preserve and edit semantics):
    95-100: nearly perfect (only tiny imperceptible differences / fully followed)
    90-94 : very close / largely followed (no major issue)
    80-89 : same concept but CLEAR visible differences / partially followed
    60-79 : major changes vs source / partially missed key aspects
    below 60: substantial mismatch / instruction largely ignored

  Default to the LOW end when unsure. Under-score before over-score.
  Especially for preserve slots — if pose, gaze, expression, hair flow, or
  background detail differ even subtly, do NOT give 95+. Recreation fidelity
  matters; subjective "looks similar" should land in the 80s, not the 90s.

Step 3 — Write a 3-5 sentence comment per slot (English). Cite ACTUAL
differences (gaze direction, pose specifics, fabric texture, lighting tone,
etc.). Avoid filler like "the two images look similar".

Step 4 — Write a 3-5 sentence overall summary (English).

Step 5 — transform_prompt (English t2i instructions):
  Describe the residual work needed to fully realize the user's intent on the
  RESULT — what additional or corrective changes (pose, expression, lighting,
  composition, texture, color) would make RESULT match the intent perfectly.
  If RESULT already fully matches the intent (all edit slots ≥ 95 and all
  preserve slots ≥ 95), output EXACTLY:
    "no significant gap — edit fully realizes the intent"
  Otherwise describe specific concrete next steps. Do NOT use that literal
  string when ANY slot is below 95.

Step 6 — uncertain (English):
  Aspects that could not be reliably evaluated visually (e.g. micro-detail
  hidden by JPEG compression, text not legible, occluded body parts).
  Use "" if all slots were confidently scored.

Return STRICT JSON only (no markdown fences, no preamble, no trailing text).

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
  "summary":          "<en, 3-5 sentences>",
  "transform_prompt": "<en t2i residual instructions>",
  "uncertain":        "<en or empty string>"
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
  "summary":          "<en, 3-5 sentences>",
  "transform_prompt": "<en t2i residual instructions>",
  "uncertain":        "<en or empty string>"
}

For the "person" domain, the "background" slot is broad — it covers
environment / setting, lighting (key/fill/rim, color temperature, hour),
overall color palette and grading, atmosphere / mood, weather, and
photographic style anchors. Score it accordingly.

ABSOLUTE REQUIREMENTS:
- Always fill ALL 5 slots for the chosen domain. Never omit a slot.
- Always provide an integer score 0-100 (no nulls, no missing).
- summary MUST be non-empty.
- transform_prompt MUST be non-empty.
- uncertain MAY be "" but must be present.
- Output ONLY this JSON object. NOTHING else."""

# 비전 응답 강제 — STRICT JSON only (Vision Compare context · 2026-04-26 v2.2)
# v2.1 의 SYSTEM 이 200+ 줄로 길어 모델이 lost-in-middle → scores 누락 응답 발생.
# v2.2: 핵심 룰만 80줄로 단축 + JSON 스키마 마지막에 명확 강조 + 룰 위반 금지 표현.
SYSTEM_COMPARE_GENERIC = """You are a vision evaluator comparing TWO images:
  IMAGE_A = first
  IMAGE_B = second

Score each of 5 axes (composition, color, subject, mood, quality)
0-100 (integer) for recreation fidelity (HOW SIMILAR they are).

═══ SCORE RUBRIC ═══
  95-100: nearly identical (only tiny imperceptible differences)
  90-94 : very close (no major changes)
  80-89 : same concept but CLEAR visible differences
  60-79 : same broad scene but MAJOR pose/composition/expression changes
  below 60: substantial mismatch

Default to LOW end when unsure. Under-score before over-score.

═══ SUBJECT HARD CAPS (MUST APPLY) ═══
For "subject" axis only, enforce these upper bounds:
  - GAZE direction changed significantly         → subject MUST be ≤ 90
  - HEAD ANGLE changed significantly             → subject MUST be ≤ 88
  - FACIAL EXPRESSION changed significantly      → subject MUST be ≤ 88
  - POSE/BODY ORIENTATION changed significantly  → subject MUST be ≤ 88
  - 2 OR MORE of the above changed               → subject MUST be ≤ 82

DO NOT give subject > 90 if pose, gaze, head angle, or expression
differ between A and B — even when identity, clothing, and background
look the same.

═══ AXIS DEFINITIONS ═══
  composition: framing, layout, placement, perspective, aspect
  color      : palette, saturation, white balance, lighting tone
  subject    : identity, pose, head/gaze/expression (HARD CAPS APPLY)
  mood       : atmosphere, emotional tone, time-of-day feel
  quality    : technical sharpness/noise/focus parity (NOT "better")

═══ COMMENT TONE ═══
3-5 sentences per axis (English). Be SPECIFIC, cite actual differences.
Avoid filler ("two images are similar").

═══ TRANSFORM PROMPT ═══
A t2i instruction set that, applied to A's generation prompt, would
produce B. Describe specific concrete changes (gaze, expression, pose,
lighting, color tone, etc.) needed to transform A into B.

ONLY use the literal output "no significant changes — visually equivalent"
when ALL of these are simultaneously true:
  - composition >= 95
  - color       >= 95
  - subject     >= 95 (no hard caps triggered above)
  - mood        >= 95
  - quality     >= 95

If ANY axis is below 95, you MUST describe the actual changes — do
NOT use "no significant changes". Recreation fidelity requires this.

═══ UNCERTAIN ═══
Aspects not reliably comparable. Use "" if all confidently compared.

═══════════════════════════════════════════════════════════════════
RETURN STRICT JSON ONLY (no markdown fences, no preamble, no trailer)
═══════════════════════════════════════════════════════════════════
{
  "scores": {
    "composition": <integer 0-100>,
    "color":       <integer 0-100>,
    "subject":     <integer 0-100>,
    "mood":        <integer 0-100>,
    "quality":     <integer 0-100>
  },
  "comments": {
    "composition": "<English, 3-5 sentences>",
    "color":       "<English, 3-5 sentences>",
    "subject":     "<English, 3-5 sentences>",
    "mood":        "<English, 3-5 sentences>",
    "quality":     "<English, 3-5 sentences>"
  },
  "summary":          "<English, 3-5 sentences>",
  "transform_prompt": "<English t2i instructions to turn A into B>",
  "uncertain":        "<English, or empty string>"
}

ABSOLUTE REQUIREMENTS:
  1. ALL 5 score fields MUST be integers 0-100. NEVER null, NEVER missing.
  2. ALL 5 comment fields MUST be non-empty English strings.
  3. summary MUST be non-empty.
  4. transform_prompt MUST be non-empty.
  5. uncertain MAY be "" but must be present.
  6. Output ONLY this JSON object. NOTHING else."""

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


async def _call_vision_pair(
    source_bytes: bytes,
    result_bytes: bytes,
    edit_prompt: str,
    *,
    vision_model: str,
    timeout: float,
    ollama_url: str,
    refined_intent: str = "",
) -> str:
    """qwen2.5vl 에 두 이미지 동시 전달 → raw 응답 문자열.

    spec 19 (2026-04-26 · Codex #4 + #5):
      - format=json 추가 (generic 과 일관성)
      - refined_intent 옵셔널 — SYSTEM 의 {refined_intent} placeholder 채움.
        분석 단계에서 이미 정제된 intent 가 있으면 비교 단계에서도 재사용해
        모델이 한국어 / 구어체 raw prompt 를 다시 해석할 필요 없음.

    Ollama /api/chat messages.images 배열에 SOURCE, RESULT 순서로 담음.
    실패 시 빈 문자열 반환 (예외는 위로 안 올림 — analyze_pair 가 fallback 처리).
    """
    raw_prompt = (edit_prompt or "")[:400]
    refined_clean = (refined_intent or "").strip()[:400] or "(not provided — use the raw instruction above)"
    system_content = (
        SYSTEM_COMPARE
        .replace("{edit_prompt}", raw_prompt)
        .replace("{refined_intent}", refined_clean)
    )

    payload = {
        "model": vision_model,
        "messages": [
            {
                "role": "system",
                "content": system_content,
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
        # spec 19 (Codex #5): generic 과 동일하게 format=json 강제 — JSON 안정화
        "format": "json",
        # 2026-04-26: VRAM 즉시 반납
        "keep_alive": "0",
        "options": {"temperature": 0.3, "num_ctx": 8192},
    }
    try:
        return await call_chat_payload(
            ollama_url=ollama_url,
            payload=payload,
            timeout=timeout,
        )
    except Exception as e:
        log.warning("compare vision call failed (%s): %s", vision_model, e)
        return ""


def _coerce_intent(raw: Any) -> str:
    """슬롯 intent 정규화 — edit/preserve 외 값은 preserve 기본."""
    s = (raw or "").strip().lower() if isinstance(raw, str) else ""
    return s if s in ("edit", "preserve") else "preserve"


# _coerce_score 는 ._json_utils.coerce_score 로 이동 (2026-04-27 N9).
# `from studio.comparison_pipeline import _coerce_score` 호환 위해 위에서 alias import.


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
    refined_intent: str = "",
    progress_callback: ProgressCallback | None = None,
) -> ComparisonAnalysisResult:
    """SOURCE + RESULT 비교 분석 v3.1 (spec 19 · rubric + transform/uncertain + refined_intent).

    HTTP 200 원칙 — 모든 fallback 경로도 ComparisonAnalysisResult shape 유지.

    Args:
        source_bytes / result_bytes: PIL 호환 이미지 바이트
        edit_prompt: 사용자 수정 지시 raw (한/영, 시스템 프롬프트에 주입)
        refined_intent: clarify_edit_intent 로 정제된 영문 intent (spec 19 · Codex #4)
            비어있으면 SYSTEM 이 raw prompt 만 보고 판단 (옛 동작과 동일).
        vision_model: 기본 settings.visionModel (qwen2.5vl:7b)
        text_model: 번역용 (기본 gemma4-un:latest)
        progress_callback: Phase 6 — 단계 transition 시점에 호출 ("vision-pair" / "translation").
            None 이면 무영향. router (task-based SSE) 가 stage emit 으로 변환.
    """
    resolved_vision = vision_model or DEFAULT_OLLAMA_ROLES.vision
    resolved_text = text_model or DEFAULT_OLLAMA_ROLES.text
    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL

    # Phase 6: callback 호출 헬퍼 — None 또는 예외 시 무영향
    async def _signal(stage_type: str) -> None:
        if progress_callback is None:
            return
        try:
            await progress_callback(stage_type)
        except Exception as cb_err:  # pragma: no cover - 방어적
            log.info("progress_callback raised (non-fatal): %s", cb_err)

    # ── 1단계: 비전 호출 ──
    await _signal("vision-pair")
    raw = await _call_vision_pair(
        source_bytes,
        result_bytes,
        edit_prompt,
        vision_model=resolved_vision,
        timeout=timeout,
        ollama_url=resolved_url,
        refined_intent=refined_intent,
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

    # ── 3단계: domain + slots + transform/uncertain 정규화 ──
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

    # spec 19 (2026-04-26 · Codex #3): transform_prompt + uncertain 파싱 (옵셔널)
    transform_raw = parsed.get("transform_prompt")
    transform_en = (
        transform_raw.strip() if isinstance(transform_raw, str) else ""
    )
    uncertain_raw = parsed.get("uncertain")
    uncertain_en = (
        uncertain_raw.strip() if isinstance(uncertain_raw, str) else ""
    )

    # ── 4단계: 한글 번역 (코멘트 + summary + transform/uncertain 한 호출) ──
    await _signal("translation")
    comments_en_for_translate = {k: s.comment_en for k, s in slots.items()}
    translation = await _c._translate_comments_to_ko(
        comments_en_for_translate,
        summary_en,
        text_model=resolved_text,
        timeout=60.0,
        ollama_url=resolved_url,
        axes=axes,
        extra_sections={"transform_prompt": transform_en, "uncertain": uncertain_en},
    )
    if translation is None:
        # 번역 실패 — 코멘트는 en 그대로, summary 에 마커
        for k, s in slots.items():
            s.comment_ko = s.comment_en
        summary_ko = "한글 번역 실패"
        transform_ko = transform_en
        uncertain_ko = uncertain_en
    else:
        for k, s in slots.items():
            s.comment_ko = (
                translation["comments_ko"].get(k) or s.comment_en
            )
        summary_ko = translation["summary_ko"] or summary_en
        transform_ko = (
            translation.get("extra", {}).get("transform_prompt") or transform_en
        )
        uncertain_ko = (
            translation.get("extra", {}).get("uncertain") or uncertain_en
        )

    return ComparisonAnalysisResult(
        domain=domain,
        slots=slots,
        overall=overall,
        summary_en=summary_en,
        summary_ko=summary_ko,
        transform_prompt_en=transform_en,
        transform_prompt_ko=transform_ko,
        uncertain_en=uncertain_en,
        uncertain_ko=uncertain_ko,
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
        # 2026-04-26 v2.1: Vision Recipe v2 와 동일하게 format=json 강제 (Codex 안)
        "format": "json",
        # 2026-04-26: VRAM 즉시 반납
        "keep_alive": "0",
        "options": {"temperature": 0.3, "num_ctx": 8192},
    }
    try:
        return await call_chat_payload(
            ollama_url=ollama_url,
            payload=payload,
            timeout=timeout,
        )
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
    progress_callback: ProgressCallback | None = None,
) -> ComparisonAnalysisResult:
    """A + B 두 이미지의 일반 비교 분석 (Vision Compare 메뉴 전용).

    Edit 의 analyze_pair 와 5축 (composition/color/subject/mood/quality) +
    시스템 프롬프트 (SYSTEM_COMPARE_GENERIC) 가 다름. Edit 코드 경로 무영향.

    Args:
        image_a_bytes / image_b_bytes: PIL 호환 이미지 바이트 (사용자 업로드 2장)
        compare_hint: 사용자 비교 지시 힌트 (선택 · 빈 문자열 OK)
        vision_model: 기본 settings.visionModel (qwen2.5vl:7b)
        text_model: 번역용 (기본 gemma4-un:latest)
        progress_callback: Phase 6 — analyze_pair 와 동일 패턴 ("vision-pair" / "translation").

    Returns:
        ComparisonAnalysisResult — 모든 fallback 경로 동일 shape 보장.
    """
    resolved_vision = vision_model or DEFAULT_OLLAMA_ROLES.vision
    resolved_text = text_model or DEFAULT_OLLAMA_ROLES.text
    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL

    async def _signal(stage_type: str) -> None:
        if progress_callback is None:
            return
        try:
            await progress_callback(stage_type)
        except Exception as cb_err:  # pragma: no cover - 방어적
            log.info("progress_callback raised (non-fatal): %s", cb_err)

    # ── 1단계: 비전 호출 ──
    await _signal("vision-pair")
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

    # 2026-04-26 v2.1 — transform_prompt + uncertain 파싱 (Codex+Claude 안)
    transform_raw = parsed.get("transform_prompt")
    transform_en = (
        transform_raw.strip() if isinstance(transform_raw, str) else ""
    )
    uncertain_raw = parsed.get("uncertain")
    uncertain_en = (
        uncertain_raw.strip() if isinstance(uncertain_raw, str) else ""
    )

    # ── 4단계: 한글 번역 (실패해도 en 으로 폴백) ──
    # transform/uncertain 도 같은 번역 묶음에 포함 (extra_sections 인자 도입)
    await _signal("translation")
    translation = await _c._translate_comments_to_ko(
        comments_en,
        summary_en,
        text_model=resolved_text,
        timeout=60.0,
        ollama_url=resolved_url,
        axes=COMPARE_AXES,
        extra_sections={"transform_prompt": transform_en, "uncertain": uncertain_en},
    )
    if translation is None:
        comments_ko = dict(comments_en)
        summary_ko = "한글 번역 실패"
        transform_ko = transform_en
        uncertain_ko = uncertain_en
    else:
        comments_ko = {
            axis: translation["comments_ko"].get(axis) or comments_en.get(axis, "")
            for axis in COMPARE_AXES
        }
        summary_ko = translation["summary_ko"] or summary_en
        transform_ko = (
            translation.get("extra", {}).get("transform_prompt") or transform_en
        )
        uncertain_ko = (
            translation.get("extra", {}).get("uncertain") or uncertain_en
        )

    return ComparisonAnalysisResult(
        scores=scores,
        overall=overall,
        comments_en=comments_en,
        comments_ko=comments_ko,
        summary_en=summary_en,
        summary_ko=summary_ko,
        transform_prompt_en=transform_en,
        transform_prompt_ko=transform_ko,
        uncertain_en=uncertain_en,
        uncertain_ko=uncertain_ko,
        provider="ollama",
        fallback=False,
        analyzed_at=int(time.time() * 1000),
        vision_model=resolved_vision,
    )
