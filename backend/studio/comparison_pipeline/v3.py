"""
comparison_pipeline.v3 — Edit context v3 매트릭스 비교 (analyze_pair).

spec 16 (2026-04-25): 도메인 분류 + 슬롯별 의도 판정 + 의도-맞춤 점수.
- domain: "person" | "object_scene"
- 5개 슬롯 (도메인별)
- 점수 의미: 보존이면 유사도 / 변경이면 의도부합도

Phase 4.4 단계 3 (2026-04-30) 분리.
"""

from __future__ import annotations

import time
from typing import Any

from .._ollama_client import call_chat_payload
from ..presets import DEFAULT_OLLAMA_ROLES
from ..prompt_pipeline import _DEFAULT_OLLAMA_URL, DEFAULT_TIMEOUT
from ..vision_pipeline import ProgressCallback
from . import _common as _c
from ._common import (
    OBJECT_SCENE_AXES,
    PERSON_AXES,
    ComparisonAnalysisResult,
    ComparisonSlotEntry,
    _coerce_score,
    _parse_strict_json,
    _to_b64,
    log,
)


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
