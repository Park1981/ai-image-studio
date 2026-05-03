"""
banned_terms — 학습된 boilerplate 후처리 필터 (2026-05-03 · ChatGPT 정공법).

7B/8B vision model 이 system prompt 의 anti-pattern 도 무시하고
"muted earth tones", "golden hour", "85mm portrait lens" 같은 학습된
boilerplate phrase 를 자동 출력하는 catastrophic failure 방지.

ChatGPT 2차 리뷰: 2 그룹 분리.
  - VISUAL_CONTRADICTION_TERMS: lighting/color/lens 사실 오류 위험
    → 관찰 근거 없으면 강제 제거
  - QUALITY_BOILERPLATE_TERMS: 품질 태그 (masterpiece 등)
    → MVP 미적용 (사용자가 의도적으로 쓸 수 있음 · 후속 옵션화)

정책: "삭제" 가 아니라 "관찰 근거 없으면 삭제".
"""

from __future__ import annotations

import logging
import re
from typing import Any

from . import _common as _c

log = logging.getLogger(__name__)

# Group A — lighting/color/lens 사실 오류 위험 (관찰 근거 없으면 강제 제거)
VISUAL_CONTRADICTION_TERMS: list[str] = [
    "muted earth tones",
    "muted earth tone",
    "golden hour",
    "softbox key",
    "softbox lighting",
    "softbox key lighting",
    "85mm portrait lens",
    "85mm portrait",
    "85mm lens",
    "cinematic editorial",
    "cinematic editorial style",
    "cinematic editorial photography",
    "shallow with soft bokeh",
    "shallow DOF with soft bokeh",
]

# Group B — 품질 태그 (MVP 미적용 · 후속 옵션화)
# 사용자가 t2i 프롬프트 품질 향상 목적으로 의도적으로 쓰는 경우 많음.
QUALITY_BOILERPLATE_TERMS: list[str] = [
    "masterpiece",
    "best quality",
    "ultra detailed",
    "high resolution",
]


def _has_observation_evidence(phrase: str, observation: dict[str, Any]) -> bool:
    """observation JSON 안에 banned phrase 의 근거 단서 있는지 확인."""
    # 관찰 데이터에서 관련 필드 추출
    light = observation.get("lighting_and_color", {})
    photo = observation.get("photo_quality", {})

    haystacks: list[str] = []
    haystacks.extend(light.get("visible_light_sources", []) or [])
    haystacks.extend(light.get("dominant_colors", []) or [])
    haystacks.extend(photo.get("style_evidence", []) or [])
    haystacks.append(photo.get("depth_of_field", "") or "")
    haystacks.append(light.get("contrast", "") or "")

    needle = phrase.lower()
    for hay in haystacks:
        if isinstance(hay, str) and needle in hay.lower():
            return True
    return False


def filter_banned(positive_prompt: str, observation: dict[str, Any]) -> str:
    """positive_prompt 안 VISUAL_CONTRADICTION 그룹의 phrase 중
    관찰 근거 없는 것 제거. 근거 있으면 유지. 제거 시 log warning.

    QUALITY_BOILERPLATE_TERMS 는 MVP 에서 적용 X (사용자 의도 보존).
    """
    if not positive_prompt:
        return positive_prompt

    removed: list[str] = []
    result = positive_prompt
    for phrase in VISUAL_CONTRADICTION_TERMS:
        # 단어 경계 매칭 + 후행 콤마/점/공백 포함 제거
        pattern = re.compile(rf"\b{re.escape(phrase)}\b[,.\s]*", re.IGNORECASE)
        if not pattern.search(result):
            continue
        if _has_observation_evidence(phrase, observation):
            # 관찰 근거 있으면 유지
            continue
        result = pattern.sub("", result)
        removed.append(phrase)
        log.warning("banned_terms removed (no observation evidence): %r", phrase)

    if removed:
        # 디버그 모드에서만 상세 출력
        _c.debug_log("banned_terms.removed", removed)

    # 연속 콤마/공백 정리
    result = re.sub(r"\s*,\s*,+", ", ", result)
    result = re.sub(r"\s+", " ", result).strip().strip(",").strip()
    return result
