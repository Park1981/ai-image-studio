"""
compare_pipeline_v4.diff_synthesize — V4 차이 합성 stage.

text 모델 (gemma4-un, think:false) 이 두 observation JSON + (선택) compare_hint
받아 V4 결과 dataclass 합성.

원칙 (vision_pipeline 정공법 그대로 이식):
  - boilerplate 금지 (golden hour / 85mm lens / masterpiece 등)
  - Anchor Fidelity Rules — generalize 금지 (specific phrase 그대로 인용)
  - Identity / brand / celebrity 금지
  - STRICT JSON: 모든 키 항상 출력 (키 누락 X · spec §4.2)
"""

from __future__ import annotations

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
    _safe_str as _coerce_safe_str,    # sentinel filter 포함 버전 (로컬 _safe_str 대체)
)
from ._types import CompareAnalysisResultV4, CompareCategoryDiff

log = logging.getLogger(__name__)


DIFF_SYNTHESIZE_SYSTEM = """You are an expert image-comparison analyst.

You receive TWO observation JSON objects (image1, image2) extracted by a vision model.
Your job is to produce a deep, specific difference analysis between the two images.

Output STRICT JSON only:
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
- fidelity_score: integer 0-100, or null if domain_match == "mixed" or images are fundamentally different concepts.
- category_scores values: integer 0-100, or null. Always output every category key.

ANCHOR FIDELITY RULES (do not generalize):
- Reuse the most specific phrases from the observation JSON verbatim.
- "asymmetric cross-strap cutout cropped tank top" must NOT be summarized as "simple tank top".
- "cup raised to lips" must NOT be summarized as "holding a cup".
- "transparent raincoats" must NOT become "silhouettes".
- If unsure, write the uncertain field rather than confident generalization.

BOILERPLATE BAN:
- Do NOT use generic phrases unless directly supported by the observations:
  golden hour, 85mm lens, softbox lighting, masterpiece, ultra detailed, muted earth tones, cinematic editorial.

IDENTITY / BRAND BAN:
- Do not name brands, real identities, celebrities, or copyrighted characters.
- Keep subjects fictional and adult.

OBSERVATION SUB-DETAIL USAGE:
- vision_observe sub-detail slots (subjects.face_detail / object_interaction / clothing_detail / environment.crowd_detail)
  must be folded into category_diffs and key_anchors.
- "left_eye=closed, right_eye=open" → key_anchors entry with label "eye state",
  image1: "both eyes open", image2: "winking — left eye closed".
- Do NOT compress to generic phrase like "eyes".

FIDELITY_SCORE RULES:
- gaze direction / head angle / facial expression / pose changed: score MUST be ≤ 90.
- 2 or more of the above changed: score MUST be ≤ 82.
- domain_match == "mixed": score MUST be null.
- "Default to LOW end when unsure. Under-score before over-score."

LIST SIZES:
- common_points: 3~6 entries. key_differences: 3~6 entries.
- key_anchors: 3~5 (same domain) or 5~8 (mixed domain — fills matrix gap).

When the user comparison hint is provided, FOCUS this comparison on that hint.
"""


def _build_user_payload(
    observation1: dict[str, Any],
    observation2: dict[str, Any],
    compare_hint: str,
) -> str:
    """user message — two observation JSON dumps + hint (or placeholder)."""
    # 빈 hint 는 placeholder 로 변환, 있으면 400자 cap
    hint_clean = (compare_hint or "").strip()[:400]
    if hint_clean:
        hint_line = f'User comparison hint: "{hint_clean}"'
    else:
        hint_line = "User comparison hint: (not provided — compare all aspects)"
    return (
        f"Image1 observation JSON:\n```json\n{json.dumps(observation1, ensure_ascii=False, indent=2)}\n```\n\n"
        f"Image2 observation JSON:\n```json\n{json.dumps(observation2, ensure_ascii=False, indent=2)}\n```\n\n"
        f"{hint_line}\n\n"
        "Produce the deep difference analysis. Return STRICT JSON only."
    )


def _empty_v4_result(*, vision_model: str, text_model: str, fallback: bool) -> CompareAnalysisResultV4:
    """비어있는 V4 결과 (fallback 또는 input 빈 경우)."""
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
        observation1={}, observation2={},
        provider="fallback" if fallback else "ollama",
        fallback=fallback,
        analyzed_at=int(time.time() * 1000),
        vision_model=vision_model,
        text_model=text_model,
    )


async def synthesize_diff(
    *,
    observation1: dict[str, Any],
    observation2: dict[str, Any],
    compare_hint: str,
    text_model: str,
    timeout: float,
    ollama_url: str,
    keep_alive: str | None = None,
) -> CompareAnalysisResultV4:
    """observation1, observation2 → V4 결과 dataclass.

    실패 (network / parse / 빈 응답) 시 fallback 결과 반환 (HTTP 200 원칙).
    """
    # 두 observation 모두 비어있으면 Ollama 호출 없이 즉시 fallback
    # (prompt_synthesize 의 빈 입력 early return 패턴과 일관 · 비용 절약)
    if not observation1 and not observation2:
        log.info("diff_synthesize skipped — both observations empty")
        return _empty_v4_result(vision_model="", text_model=text_model, fallback=True)

    # keep_alive None 시 presets 에서 lazy 호출
    if keep_alive is None:
        from ..presets import resolve_ollama_keep_alive
        resolved_keep_alive = resolve_ollama_keep_alive()
    else:
        resolved_keep_alive = keep_alive

    payload = {
        "model": text_model,
        "messages": [
            {"role": "system", "content": DIFF_SYNTHESIZE_SYSTEM},
            {"role": "user", "content": _build_user_payload(observation1, observation2, compare_hint)},
        ],
        "stream": False,
        "format": "json",
        "think": False,                          # CLAUDE.md rule — gemma4-un reasoning 기본 OFF
        "keep_alive": resolved_keep_alive,
        "options": {"temperature": 0.4, "num_ctx": 8192},
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
        log.warning("diff_synthesize call failed (%s): %s", text_model, e)
        return _empty_v4_result(vision_model="", text_model=text_model, fallback=True)

    # ── 빈 응답 guard ──
    if not raw:
        log.warning("diff_synthesize empty response from %s", text_model)
        return _empty_v4_result(vision_model="", text_model=text_model, fallback=True)

    # ── JSON 파싱 ──
    parsed = _parse_strict_json(raw)
    if not isinstance(parsed, dict):
        log.warning("diff_synthesize JSON parse failed (raw len=%d)", len(raw))
        return _empty_v4_result(vision_model="", text_model=text_model, fallback=True)

    # ── 정규화 ──
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

    # key_anchors: 최대 8개 (mixed 시 5~8 권장)
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
        observation1=observation1,
        observation2=observation2,
        provider="ollama",
        fallback=False,
        analyzed_at=int(time.time() * 1000),
        vision_model="",                          # pipeline 단계에서 채움
        text_model=text_model,
    )
