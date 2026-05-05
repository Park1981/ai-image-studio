"""
compare_pipeline_v4.translate — V4 결과 영문 → 한국어 일괄 번역.

flatten: 모든 *_en 슬롯을 키 path 와 함께 평면 dict 로 변환 → gemma4 한 번 호출.
unflatten: 응답 받아 dataclass 의 *_ko 슬롯에 복원.
실패 시 *_ko 가 *_en 으로 fallback (UI 가 망가지지 않게).
"""

from __future__ import annotations

import json
import logging
import re

from .._json_utils import parse_strict_json as _parse_strict_json
from .._ollama_client import call_chat_payload
from ._types import CompareAnalysisResultV4

# 한글 유니코드 범위: 가-힣 (완성형 음절) + 자모 + 호환 자모.
# echo paraphrase 차단용 — 응답 value 에 한글 1자 이상 있어야 valid 로 인정.
_KOREAN_CHAR_RE = re.compile(r"[가-힯ᄀ-ᇿ㄰-㆏]")


def _has_korean_chars(s: str) -> bool:
    """문자열에 한글 음절 또는 자모가 1자 이상 있는지."""
    return bool(_KOREAN_CHAR_RE.search(s))

log = logging.getLogger(__name__)


TRANSLATE_V4_SYSTEM = """당신은 영한 번역가입니다. 입력은 평탄한 JSON: {"k1": "english", "k2": "english", ...}.

ABSOLUTE RULES:
1. Output ONLY this exact structure: {"k1": "한국어", "k2": "한국어", ...}.
2. DO NOT use ANY other keys. Specifically FORBIDDEN keys: "summary", "commonPoints", "keyDifferences", "categoryDiffs", "keyAnchors", "transformPrompt", "uncertain", "image1", "image2", "diff", "composition", "subject".
3. ONLY use keys that match the pattern k1, k2, k3, ... exactly as in input.
4. Every value MUST contain Korean characters (한글). Pure English values are FORBIDDEN.
5. Polite/formal Korean (존댓말 · "~합니다", "~입니다").
6. Output STRICT JSON only. No markdown, no code fences, no explanation.

EXAMPLE input:
{"k1": "Two portraits of the same woman", "k2": "landscape orientation, centered"}

EXAMPLE output (CORRECT):
{"k1": "동일한 여성의 두 인물 사진입니다", "k2": "가로 방향, 중앙 배치"}

EXAMPLE output (WRONG — uses forbidden keys):
{"summary": "...", "commonPoints": [...]}

EXAMPLE output (WRONG — English echo):
{"k1": "Two portraits of the same woman", "k2": "landscape orientation, centered"}
"""


async def translate_v4_result(
    result: CompareAnalysisResultV4,
    *,
    text_model: str,
    timeout: float,
    ollama_url: str,
) -> CompareAnalysisResultV4:
    """V4 dataclass 를 in-place 번역 (mutation 후 같은 객체 반환).

    평탄화 전략: nested JSON (categoryDiffs/keyAnchors 등) 의 한국어 응답이
    list element syntax error 빈발 → fully flat {k1: en, k2: en, ...} 로 변환 후 번역.
    flat_keys 의 순서로 평탄화 → 응답을 같은 순서로 unflatten.
    """
    flat_keys, flat_input = _flatten_strings(result)
    if not flat_input:
        return result

    payload = {
        "model": text_model,
        "messages": [
            {"role": "system", "content": TRANSLATE_V4_SYSTEM},
            {
                "role": "user",
                "content": (
                    "다음 평탄한 JSON 의 모든 영어 value 를 한국어로 번역해주세요. "
                    "키 (k1, k2, ...) 는 그대로 보존, value 만 한국어로. 영어 echo 금지.\n\n"
                    f"```json\n{json.dumps(flat_input, ensure_ascii=False, indent=2)}\n```\n\n"
                    "같은 키 + 한국어 value 의 JSON 을 출력하세요."
                ),
            },
        ],
        "stream": False,
        "format": "json",
        "think": False,
        "keep_alive": "5m",
        "options": {"temperature": 0.4, "num_ctx": 8192},
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

    if not raw:
        log.warning("translate_v4 empty response")
        _apply_en_fallback_to_ko(result)
        return result

    parsed = _parse_strict_json(raw)
    if not isinstance(parsed, dict):
        log.warning("translate_v4 parse failed (raw len=%d)", len(raw))
        _apply_en_fallback_to_ko(result)
        return result

    # 평탄 응답 → en 슬롯 별 한국어 매핑 (한글 검증)
    flat_ko: dict[str, str] = {}
    echo_count = 0
    for key, en in flat_input.items():
        ko_val = parsed.get(key)
        if (
            isinstance(ko_val, str)
            and ko_val.strip()
            and ko_val.strip() != en
            and _has_korean_chars(ko_val)  # 한글 1자 이상 필수 — echo paraphrase 차단
        ):
            flat_ko[key] = ko_val.strip()
        else:
            flat_ko[key] = en  # echo / 누락 / 한글 없음 → en fallback
            echo_count += 1

    if echo_count > 0:
        log.warning(
            "translate_v4 partial echo (%d/%d slots fell back to en)",
            echo_count,
            len(flat_input),
        )

    _unflatten_to_result(result, flat_keys, flat_ko)
    return result


def _flatten_strings(r: CompareAnalysisResultV4) -> tuple[list[tuple[str, str]], dict[str, str]]:
    """모든 *_en 슬롯을 (k1, k2, ...) 평탄 dict 로.

    Returns:
        flat_keys: [("summary", "k1"), ("common.0", "k2"), ...]  — 평탄 key → 의미적 위치 매핑
        flat_input: {"k1": "english text", "k2": "english text", ...}
    """
    flat_keys: list[tuple[str, str]] = []
    flat_input: dict[str, str] = {}
    counter = 0

    def add(loc: str, en: str) -> None:
        nonlocal counter
        if not en:
            return
        counter += 1
        k = f"k{counter}"
        flat_keys.append((loc, k))
        flat_input[k] = en

    add("summary", r.summary_en)
    for i, en in enumerate(r.common_points_en):
        add(f"common.{i}", en)
    for i, en in enumerate(r.key_differences_en):
        add(f"diff.{i}", en)
    for axis_key, v in r.category_diffs.items():
        add(f"cat.{axis_key}.image1", v.image1)
        add(f"cat.{axis_key}.image2", v.image2)
        add(f"cat.{axis_key}.diff", v.diff)
    for i, a in enumerate(r.key_anchors):
        add(f"anchor.{i}.image1", a.image1)
        add(f"anchor.{i}.image2", a.image2)
    add("transform", r.transform_prompt_en)
    add("uncertain", r.uncertain_en)
    return flat_keys, flat_input


def _unflatten_to_result(
    r: CompareAnalysisResultV4,
    flat_keys: list[tuple[str, str]],
    flat_ko: dict[str, str],
) -> None:
    """평탄 dict (flat_ko) 를 result dataclass 의 *_ko 슬롯에 복원."""
    # list 버퍼 (commonPoints / keyDifferences) — en 으로 미리 초기화
    common_ko = list(r.common_points_en)
    diffs_ko = list(r.key_differences_en)
    # categoryDiffs / keyAnchors 는 en 으로 default fallback (loop 안에서 갱신)
    for v in r.category_diffs.values():
        v.image1_ko, v.image2_ko, v.diff_ko = v.image1, v.image2, v.diff
    for a in r.key_anchors:
        a.image1_ko, a.image2_ko = a.image1, a.image2
    r.summary_ko = r.summary_en
    r.transform_prompt_ko = r.transform_prompt_en
    r.uncertain_ko = r.uncertain_en

    # 평탄 응답 으로 갱신
    for loc, k in flat_keys:
        ko = flat_ko.get(k, "")
        if not ko:
            continue
        if loc == "summary":
            r.summary_ko = ko
        elif loc.startswith("common."):
            idx = int(loc.split(".", 1)[1])
            if idx < len(common_ko):
                common_ko[idx] = ko
        elif loc.startswith("diff."):
            idx = int(loc.split(".", 1)[1])
            if idx < len(diffs_ko):
                diffs_ko[idx] = ko
        elif loc.startswith("cat."):
            _, axis, attr = loc.split(".", 2)
            v = r.category_diffs.get(axis)
            if v is not None:
                if attr == "image1":
                    v.image1_ko = ko
                elif attr == "image2":
                    v.image2_ko = ko
                elif attr == "diff":
                    v.diff_ko = ko
        elif loc.startswith("anchor."):
            _, idx_str, attr = loc.split(".", 2)
            idx = int(idx_str)
            if idx < len(r.key_anchors):
                a = r.key_anchors[idx]
                if attr == "image1":
                    a.image1_ko = ko
                elif attr == "image2":
                    a.image2_ko = ko
        elif loc == "transform":
            r.transform_prompt_ko = ko
        elif loc == "uncertain":
            r.uncertain_ko = ko

    r.common_points_ko = common_ko
    r.key_differences_ko = diffs_ko


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


