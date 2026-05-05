"""
compare_pipeline_v4.translate — V4 결과 영문 → 한국어 일괄 번역.

flatten: 모든 *_en 슬롯을 키 path 와 함께 평면 dict 로 변환 → gemma4 한 번 호출.
unflatten: 응답 받아 dataclass 의 *_ko 슬롯에 복원.
실패 시 *_ko 가 *_en 으로 fallback (UI 가 망가지지 않게).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .._json_utils import parse_strict_json as _parse_strict_json
from .._ollama_client import call_chat_payload
from ._types import CompareAnalysisResultV4

log = logging.getLogger(__name__)


TRANSLATE_V4_SYSTEM = """You are a translator. Translate ONLY into natural Korean.

You receive a JSON object with English content. Translate every string value to Korean,
keeping the JSON structure exactly the same. Output STRICT JSON only.

Rules:
- Translate naturally — do NOT word-for-word.
- Use polite/formal Korean (존댓말).
- Keep technical terms in Korean (e.g., "구도", "피사체").
- Do NOT translate label fields (those are short technical anchors — keep English).
- All other string values: translate.
- All keys (e.g., "summary", "commonPoints"): keep exactly as input.
"""


async def translate_v4_result(
    result: CompareAnalysisResultV4,
    *,
    text_model: str,
    timeout: float,
    ollama_url: str,
) -> CompareAnalysisResultV4:
    """V4 dataclass 를 in-place 번역 (mutation 후 같은 객체 반환)."""
    # 번역용 평면 dict 생성
    payload_dict = _flatten_for_translation(result)

    payload = {
        "model": text_model,
        "messages": [
            {"role": "system", "content": TRANSLATE_V4_SYSTEM},
            {
                "role": "user",
                "content": (
                    "Translate this object to Korean. Keep keys, JSON structure, "
                    "and 'label' fields unchanged.\n\n"
                    f"```json\n{json.dumps(payload_dict, ensure_ascii=False, indent=2)}\n```"
                ),
            },
        ],
        "stream": False,
        "format": "json",
        "think": False,
        "keep_alive": "5m",
        "options": {"temperature": 0.3, "num_ctx": 8192},
    }

    try:
        raw = await call_chat_payload(
            ollama_url=ollama_url,
            payload=payload,
            timeout=timeout,
            allow_thinking_fallback=False,
        )
    except Exception as e:
        log.warning("translate_v4 call failed: %s", e)
        _apply_en_fallback_to_ko(result)
        return result

    # 빈 응답 → en fallback
    if not raw:
        log.warning("translate_v4 empty response")
        _apply_en_fallback_to_ko(result)
        return result

    parsed = _parse_strict_json(raw)
    if not isinstance(parsed, dict):
        log.warning("translate_v4 parse failed (raw len=%d)", len(raw))
        _apply_en_fallback_to_ko(result)
        return result

    # 성공 → *_ko 슬롯 적용
    _apply_translation_to_ko(result, parsed)
    return result


def _flatten_for_translation(r: CompareAnalysisResultV4) -> dict[str, Any]:
    """결과의 *_en 슬롯을 평면 dict 로 (label_kept 키로 번역 제외 신호 전달)."""
    return {
        "summary": r.summary_en,
        "commonPoints": list(r.common_points_en),
        "keyDifferences": list(r.key_differences_en),
        "categoryDiffs": {
            k: {"image1": v.image1, "image2": v.image2, "diff": v.diff}
            for k, v in r.category_diffs.items()
        },
        "keyAnchors": [
            {
                "label_kept": a.label,   # 모델에게 "이 키는 번역하지 마" 신호
                "image1": a.image1,
                "image2": a.image2,
            }
            for a in r.key_anchors
        ],
        "transformPrompt": r.transform_prompt_en,
        "uncertain": r.uncertain_en,
    }


def _apply_translation_to_ko(r: CompareAnalysisResultV4, ko: dict[str, Any]) -> None:
    """번역 결과를 *_ko 슬롯에 적용. 실패한 키는 en 으로 fallback."""
    r.summary_ko = _str_or_fallback(ko.get("summary"), r.summary_en)
    r.common_points_ko = _list_or_fallback(ko.get("commonPoints"), r.common_points_en)
    r.key_differences_ko = _list_or_fallback(ko.get("keyDifferences"), r.key_differences_en)

    # categoryDiffs — 6 슬롯 (image1/image2/diff × en+ko)
    cat_ko = ko.get("categoryDiffs")
    if isinstance(cat_ko, dict):
        for k, v in r.category_diffs.items():
            tr = cat_ko.get(k) if isinstance(cat_ko.get(k), dict) else {}
            v.image1_ko = _str_or_fallback(tr.get("image1"), v.image1)
            v.image2_ko = _str_or_fallback(tr.get("image2"), v.image2)
            v.diff_ko = _str_or_fallback(tr.get("diff"), v.diff)
    else:
        # 구조 없으면 모두 en 복사
        for v in r.category_diffs.values():
            v.image1_ko, v.image2_ko, v.diff_ko = v.image1, v.image2, v.diff

    # keyAnchors — label 은 절대 번역 안 함 (en 고정)
    anchors_ko = ko.get("keyAnchors")
    if isinstance(anchors_ko, list) and len(anchors_ko) == len(r.key_anchors):
        for a, tr in zip(r.key_anchors, anchors_ko):
            t = tr if isinstance(tr, dict) else {}
            a.image1_ko = _str_or_fallback(t.get("image1"), a.image1)
            a.image2_ko = _str_or_fallback(t.get("image2"), a.image2)
            # label 은 항상 en 유지 — 번역 시도 X
    else:
        # 길이 불일치 → en fallback
        for a in r.key_anchors:
            a.image1_ko, a.image2_ko = a.image1, a.image2

    r.transform_prompt_ko = _str_or_fallback(ko.get("transformPrompt"), r.transform_prompt_en)
    r.uncertain_ko = _str_or_fallback(ko.get("uncertain"), r.uncertain_en)


def _apply_en_fallback_to_ko(r: CompareAnalysisResultV4) -> None:
    """번역 실패 — 모든 *_ko 슬롯에 *_en 그대로 복사."""
    r.summary_ko = r.summary_en
    r.common_points_ko = list(r.common_points_en)
    r.key_differences_ko = list(r.key_differences_en)
    # category_diffs × 6 슬롯
    for v in r.category_diffs.values():
        v.image1_ko, v.image2_ko, v.diff_ko = v.image1, v.image2, v.diff
    # key_anchors × 4 슬롯 (label 은 en 이미 고정이므로 image1/image2 만)
    for a in r.key_anchors:
        a.image1_ko, a.image2_ko = a.image1, a.image2
    r.transform_prompt_ko = r.transform_prompt_en
    r.uncertain_ko = r.uncertain_en


def _str_or_fallback(value: Any, fallback: str) -> str:
    """번역 결과가 유효한 문자열이면 반환, 아니면 fallback."""
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


def _list_or_fallback(value: Any, fallback: list[str]) -> list[str]:
    """번역 결과가 유효한 리스트이면 반환, 아니면 fallback."""
    if isinstance(value, list):
        out = [s.strip() for s in value if isinstance(s, str) and s.strip()]
        if out:
            return out
    return list(fallback)
