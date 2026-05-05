"""
compare_pipeline_v4._coerce — JSON 정규화 helper.

vision_pipeline.observation_mapping 의 sentinel filter / coerce 패턴 재사용.
diff_synthesize 가 받는 모델 응답이 키 누락 / 잘못된 타입 / sentinel 등으로
깨질 때 안전하게 dataclass 채움.
"""

from __future__ import annotations

from typing import Any

from ._types import CompareCategoryDiff, CompareKeyAnchor


# vision_pipeline observation_mapping.SENTINEL_VALUES 와 동일
SENTINEL_VALUES = frozenset({
    "none",
    "null",
    "n/a",
    "na",
    "unknown",
    "unspecified",
    "not specified",
    "not visible",
    "not applicable",
})

# 허용되는 domain_match 값 목록
VALID_DOMAINS = frozenset({"person", "object_scene", "mixed"})


def coerce_domain_match(value: Any) -> str:
    """domain 값 정규화 — unknown / 비정상 → 'mixed' (보수적 fallback).

    모델이 대소문자 혼용 또는 공백 포함 문자열을 돌려줄 때
    소문자 strip 후 허용 목록 확인. 없으면 'mixed' 반환.
    """
    if not isinstance(value, str):
        return "mixed"
    norm = value.strip().lower()
    return norm if norm in VALID_DOMAINS else "mixed"


def coerce_fidelity_score(value: Any) -> int | None:
    """fidelity_score 정규화 — int 0-100 clamp 또는 None.

    - "null" 문자열 → None
    - 숫자로 변환 불가 → None
    - float 입력 → int 변환 (floor 동작)
    - 범위 초과 → clamp (0~100)
    """
    if value is None:
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return max(0, min(100, n))


def coerce_str_list(value: Any, *, max_n: int = 8) -> list[str]:
    """list[str] 정규화 — sentinel/빈 문자열 filter, max_n cap.

    - 비list 입력 → 빈 리스트
    - 비문자열 원소 → 건너뜀
    - 빈 문자열 또는 sentinel 값 → 건너뜀
    - max_n 초과 원소 → 잘라냄
    """
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        s = item.strip()
        if not s:
            continue
        if s.lower() in SENTINEL_VALUES:
            continue
        out.append(s)
        if len(out) >= max_n:
            break
    return out


def coerce_category_diff(raw: Any) -> CompareCategoryDiff:
    """카테고리 diff 트리플 정규화 — 키 누락 시 빈 문자열로 채움 (KeyError 방지).

    모델이 image1/image2/diff 중 일부 키를 빠뜨리는 경우를 안전하게 처리.
    ko 슬롯은 번역(translate) 단계에서 채워지므로 여기서는 빈 문자열로 초기화.
    """
    d: dict[str, Any] = raw if isinstance(raw, dict) else {}
    return CompareCategoryDiff(
        image1=_safe_str(d.get("image1")),
        image2=_safe_str(d.get("image2")),
        diff=_safe_str(d.get("diff")),
        # ko 슬롯은 translate 단계에서 채움 — 여기선 빈 문자열
    )


def coerce_key_anchor(raw: Any) -> CompareKeyAnchor:
    """key anchor 정규화 — label 누락도 빈 문자열로 (UI 가 처리).

    시선 방향 / 손 위치 등 핵심 앵커 포인트를 안전하게 생성.
    비dict 입력 시 모든 필드를 빈 문자열로 채운 앵커 반환.
    """
    d: dict[str, Any] = raw if isinstance(raw, dict) else {}
    return CompareKeyAnchor(
        label=_safe_str(d.get("label")),
        image1=_safe_str(d.get("image1")),
        image2=_safe_str(d.get("image2")),
    )


def _safe_str(value: Any) -> str:
    """값을 문자열로 (None / 비문자열 → 빈 문자열). sentinel 도 빈 문자열 변환.

    모든 coerce_* 함수의 공통 문자열 변환 로직.
    - 비문자열 → ""
    - 공백 strip 후 sentinel 목록 확인 → ""
    - 정상 문자열 → strip 결과 반환
    """
    if not isinstance(value, str):
        return ""
    s = value.strip()
    if s.lower() in SENTINEL_VALUES:
        return ""
    return s
