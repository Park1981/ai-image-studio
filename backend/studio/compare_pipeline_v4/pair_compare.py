"""
compare_pipeline_v4.pair_compare — A+B 동시 vision 비교 stage.

spec 2026-05-13-vision-compare-pair-vision-quality-design.md:
  - 최종 시각 판단을 vision 모델 (qwen3-vl) 에 맡김
  - observation JSON 은 보조 hints, image evidence 가 우선
  - 출력 schema = diff_synthesize 와 동일한 V4 JSON schema (영문 only)
  - 한국어 번역은 translate_v4_result 가 담당 (vision 모델 한국어 약함 + nested JSON syntax error 회피)

구현 책임:
  - observation1 / observation2 / vision_model 은 함수 *내부* 에서 result 에 채움
    (caller 단순화 · spec §4.1.1 박제)
  - fallback 시 fallback=True + observation 보존 (caller 가 fallback 검출 후
    synthesize_diff 호출 — 본 함수는 fallback 결과를 caller 에게 신호로 돌려줌)
"""

from __future__ import annotations

import base64
import json
import logging
import time
from typing import Any

from .._json_utils import parse_strict_json as _parse_strict_json
from .._ollama_client import call_chat_payload
from ._axes import COMPARE_V4_AXES
from ._coerce import (
    coerce_category_diff,
    coerce_domain_match,
    coerce_fidelity_score,
    coerce_key_anchor,
    coerce_str_list,
    _safe_str as _coerce_safe_str,
)
from ._types import CompareAnalysisResultV4, CompareCategoryDiff

log = logging.getLogger(__name__)


# ── system prompt ──────────────────────────────────────────────────────────
# spec §6.1 + §6.3 의 정책 박제 — boilerplate ban / score hard caps exact 문구
PAIR_COMPARE_SYSTEM = """You are an expert image-comparison analyst.

You receive TWO images directly (Image 1 = A, Image 2 = B), plus their
observation JSON objects extracted by a vision model on the previous pass.

PRIMARY RULE:
- You can SEE both images. Trust visible evidence over the observation text.
- The observations are HINTS, not truth. If the images contradict the
  observations, write the correction and trust the images.
- Compare visible facts only.

LANGUAGE RULE:
- Output English only — Korean translation is handled by a downstream stage.

IDENTITY / BRAND BAN:
- Do not identify real people, celebrities, brands, or copyrighted characters.
- Keep subjects fictional and adult.

BOILERPLATE BAN:
- Do NOT use generic phrases unless directly supported by what you see:
  golden hour, 85mm lens, softbox lighting, masterpiece, ultra detailed,
  muted earth tones, cinematic editorial.

ANCHOR FIDELITY RULES (do not generalize):
- Reuse the most specific phrases from the observation JSON verbatim when
  they match what you see in the images.
- "asymmetric cross-strap cutout cropped tank top" must NOT be summarized as
  "simple tank top".
- "cup raised to lips" must NOT be summarized as "holding a cup".
- "transparent raincoats" must NOT become "silhouettes".
- If unsure, write the uncertain field rather than confident generalization.

OUTPUT STRICT JSON only (no markdown fences, no preamble, no trailing text):
{
  "summary": "<en, 3-5 sentences — overall comparison>",
  "common_points": ["<en short phrase>", ...],
  "key_differences": ["<en short phrase>", ...],
  "domain_match": "person|object_scene|mixed",
  "category_diffs": {
    "composition":           { "image1": "<en>", "image2": "<en>", "diff": "<en>" },
    "subject":               { "image1": "<en>", "image2": "<en>", "diff": "<en>" },
    "clothing_or_materials": { "image1": "<en>", "image2": "<en>", "diff": "<en>" },
    "environment":           { "image1": "<en>", "image2": "<en>", "diff": "<en>" },
    "lighting_camera_style": { "image1": "<en>", "image2": "<en>", "diff": "<en>" }
  },
  "category_scores": {
    "composition":           <integer 0-100 OR null>,
    "subject":               <integer 0-100 OR null>,
    "clothing_or_materials": <integer 0-100 OR null>,
    "environment":           <integer 0-100 OR null>,
    "lighting_camera_style": <integer 0-100 OR null>
  },
  "key_anchors": [
    { "label": "<en short>", "image1": "<en>", "image2": "<en>" }
  ],
  "fidelity_score": <integer 0-100 OR null>,
  "transform_prompt": "<en t2i instructions to turn image1 into image2>",
  "uncertain": "<en or empty string>"
}

STRICT JSON RULES:
- ALWAYS output every key — never omit any field. Use {} or [] or "" or null for empty.
- If domain_match == "mixed", category_diffs MUST be {} (empty object, not missing).
- fidelity_score: integer 0-100, or null if domain_match == "mixed" or images are
  fundamentally different concepts.
- category_scores values: integer 0-100, or null. Always output every category key.

SCORE HARD CAPS (spec §6.3 박제 — do not exceed):
- Same subject but clothing category clearly changed: fidelity_score <= 82.
- Framing changes from waist-up to close-up (or any large crop change):
  composition <= 85.
- 2 or more of {gaze direction, head angle, facial expression, pose} changed:
  fidelity_score <= 82.
- 2 or more large changes among {clothing, pose, composition}:
  fidelity_score <= 78.
- Fundamentally different concepts: fidelity_score = null.
- Default to LOW end when unsure. Under-score before over-score.

OBSERVATION CORRECTION:
- If observation text claims something the images do not support, treat the
  images as truth. Note major corrections in the uncertain field if helpful.

LIST SIZES:
- common_points: 3~6 entries. key_differences: 3~6 entries.
- key_anchors: 3~5 (same domain) or 5~8 (mixed domain — fills matrix gap).
"""


# ── base64 helper (sibling · spec §1.3 박제) ────────────────────────────────
# comparison_pipeline._common._to_b64 와 동일 4줄 헬퍼.
# cross-package import 회피 위해 sibling 정의 (plan Task 1.3 선택지 채택).
def _to_b64(data: bytes) -> str:
    """바이트를 base64 ASCII 문자열로 변환 (Ollama images 배열 형식)."""
    return base64.b64encode(data).decode("ascii")


# ── user payload builder ───────────────────────────────────────────────────
def _build_user_payload(
    *,
    image1_w: int,
    image1_h: int,
    image2_w: int,
    image2_h: int,
    observation1: dict[str, Any],
    observation2: dict[str, Any],
    compare_hint: str,
) -> str:
    """user message — A/B 크기 + observation JSON + hint + checklist."""
    # 빈 hint 는 placeholder (spec §6.2)
    hint_clean = (compare_hint or "").strip()[:400]
    if hint_clean:
        hint_line = f'User comparison hint: "{hint_clean}"'
    else:
        hint_line = "User comparison hint: (not provided — compare all aspects)"

    return (
        "Image 1 = A. Image 2 = B.\n"
        f"Image A size: {image1_w}x{image1_h}\n"
        f"Image B size: {image2_w}x{image2_h}\n\n"
        f"Observation A:\n```json\n{json.dumps(observation1, ensure_ascii=False, indent=2)}\n```\n\n"
        f"Observation B:\n```json\n{json.dumps(observation2, ensure_ascii=False, indent=2)}\n```\n\n"
        f"{hint_line}\n\n"
        "Verification checklist:\n"
        "- Compare clothing / top / bottom / accessories.\n"
        "- Compare crop / framing / camera angle.\n"
        "- Compare gaze / head angle / facial expression.\n"
        "- Compare pose / hands / object interaction.\n"
        "- Compare background and lighting.\n"
        "- Call out observation corrections if visible evidence differs.\n\n"
        "Produce the deep difference analysis. Return STRICT JSON only."
    )


# ── fallback empty result ──────────────────────────────────────────────────
def _empty_result(
    *,
    vision_model: str,
    text_model: str,
    observation1: dict[str, Any],
    observation2: dict[str, Any],
) -> CompareAnalysisResultV4:
    """pair vision 실패 시 fallback shape (HTTP 200 보장).

    caller (analyze_pair_v4) 는 result.fallback=True 를 검출 후 기존
    synthesize_diff() 를 호출해 한 번 더 시도한다 (spec §7.3).
    """
    return CompareAnalysisResultV4(
        summary_en="", summary_ko="",
        common_points_en=[], common_points_ko=[],
        key_differences_en=[], key_differences_ko=[],
        domain_match="mixed",
        category_diffs={},
        category_scores={k: None for k in COMPARE_V4_AXES},
        key_anchors=[],
        fidelity_score=None,
        transform_prompt_en="", transform_prompt_ko="",
        uncertain_en="", uncertain_ko="",
        observation1=observation1, observation2=observation2,   # 보존 (caller 단순화)
        provider="fallback",
        fallback=True,
        analyzed_at=int(time.time() * 1000),
        vision_model=vision_model,                              # 함수 내부 채움
        text_model=text_model,
    )


# ── public API ──────────────────────────────────────────────────────────────
async def compare_pair_with_vision(
    *,
    image1_bytes: bytes,
    image2_bytes: bytes,
    image1_w: int,
    image1_h: int,
    image2_w: int,
    image2_h: int,
    observation1: dict[str, Any],
    observation2: dict[str, Any],
    compare_hint: str,
    vision_model: str,
    text_model: str,
    timeout: float,
    ollama_url: str,
    keep_alive: str | None = None,
) -> CompareAnalysisResultV4:
    """A + B 두 이미지를 동시에 vision 모델에 전달 → V4 결과 dataclass.

    spec §4.1.1 책임 분리 박제:
      - observation1/2 + vision_model 은 *함수 내부* 에서 result 에 채움
      - 영문 only output — translate_v4_result 가 한국어 채움

    실패 시 fallback shape 반환 (HTTP 200 원칙). caller 는 fallback=True 검출 후
    기존 synthesize_diff() fallback 가능 (spec §7.3).
    """
    # keep_alive None 시 presets 에서 lazy resolve (chat API → string 형식)
    if keep_alive is None:
        from ..presets import resolve_ollama_keep_alive
        resolved_keep_alive = resolve_ollama_keep_alive()
    else:
        resolved_keep_alive = keep_alive

    user_content = _build_user_payload(
        image1_w=image1_w,
        image1_h=image1_h,
        image2_w=image2_w,
        image2_h=image2_h,
        observation1=observation1,
        observation2=observation2,
        compare_hint=compare_hint,
    )

    payload = {
        "model": vision_model,
        "messages": [
            {"role": "system", "content": PAIR_COMPARE_SYSTEM},
            {
                "role": "user",
                "content": user_content,
                # Ollama /api/chat: images 배열에 [A, B] 순서로 base64 (spec §1.3 박제)
                "images": [_to_b64(image1_bytes), _to_b64(image2_bytes)],
            },
        ],
        "stream": False,
        "format": "json",                  # strict JSON 강제 (V4 Phase 10 박제)
        "keep_alive": resolved_keep_alive, # /api/chat: string 형식 (CLAUDE.md critical)
        "options": {"temperature": 0.2, "num_ctx": 8192},
    }

    # ── Ollama 호출 ──
    try:
        raw = await call_chat_payload(
            ollama_url=ollama_url,
            payload=payload,
            timeout=timeout,
            allow_thinking_fallback=False,
        )
    except Exception as e:
        log.warning("pair_compare call failed (%s): %s", vision_model, e)
        return _empty_result(
            vision_model=vision_model, text_model=text_model,
            observation1=observation1, observation2=observation2,
        )

    if not raw:
        log.warning("pair_compare empty response from %s", vision_model)
        return _empty_result(
            vision_model=vision_model, text_model=text_model,
            observation1=observation1, observation2=observation2,
        )

    # ── JSON 파싱 ──
    parsed = _parse_strict_json(raw)
    if not isinstance(parsed, dict):
        log.warning("pair_compare JSON parse failed (raw len=%d)", len(raw))
        return _empty_result(
            vision_model=vision_model, text_model=text_model,
            observation1=observation1, observation2=observation2,
        )

    # ── 정규화 (diff_synthesize 와 동일 패턴 · _coerce helper 재사용) ──
    domain = coerce_domain_match(parsed.get("domain_match"))

    # category_diffs: mixed 면 빈 dict 유지 (spec §4.2)
    cat_diffs_raw = parsed.get("category_diffs", {})
    cat_diffs: dict[str, CompareCategoryDiff] = {}
    if domain != "mixed" and isinstance(cat_diffs_raw, dict):
        for axis in COMPARE_V4_AXES:
            cat_diffs[axis] = coerce_category_diff(cat_diffs_raw.get(axis))

    # category_scores: 5 카테고리 모두 정규화
    cat_scores_raw = parsed.get("category_scores", {})
    cat_scores: dict[str, int | None] = {}
    if isinstance(cat_scores_raw, dict):
        for axis in COMPARE_V4_AXES:
            cat_scores[axis] = coerce_fidelity_score(cat_scores_raw.get(axis))
    else:
        cat_scores = {k: None for k in COMPARE_V4_AXES}

    # key_anchors: 최대 8개
    anchors_raw = parsed.get("key_anchors", [])
    anchors = []
    if isinstance(anchors_raw, list):
        for raw_anchor in anchors_raw[:8]:
            a = coerce_key_anchor(raw_anchor)
            if a.label or a.image1 or a.image2:    # 완전히 빈 entry 는 skip
                anchors.append(a)

    return CompareAnalysisResultV4(
        summary_en=_coerce_safe_str(parsed.get("summary")),
        summary_ko="",
        common_points_en=coerce_str_list(parsed.get("common_points"), max_n=6),
        common_points_ko=[],
        key_differences_en=coerce_str_list(parsed.get("key_differences"), max_n=6),
        key_differences_ko=[],
        domain_match=domain,
        category_diffs=cat_diffs,
        category_scores=cat_scores,
        key_anchors=anchors,
        fidelity_score=coerce_fidelity_score(parsed.get("fidelity_score")),
        transform_prompt_en=_coerce_safe_str(parsed.get("transform_prompt")),
        transform_prompt_ko="",
        uncertain_en=_coerce_safe_str(parsed.get("uncertain")),
        uncertain_ko="",
        observation1=observation1,          # 함수 내부 채움 (spec §4.1.1)
        observation2=observation2,          # 함수 내부 채움
        provider="ollama",
        fallback=False,
        analyzed_at=int(time.time() * 1000),
        vision_model=vision_model,          # 함수 내부 채움
        text_model=text_model,
    )
