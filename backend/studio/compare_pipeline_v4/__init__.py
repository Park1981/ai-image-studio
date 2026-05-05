"""
compare_pipeline_v4 — Vision Compare 재설계 (2-stage observe + diff_synthesize).

본질: "이미지의 차이를 자세히 깊이 분석".

Phase 1 (2026-05-05): 모듈 골격. Phase 2 에서 analyze_pair_v4 추가.
"""

from __future__ import annotations

# Phase 1 시점 — axes 만 export. analyze_pair_v4 는 Phase 2 에서 추가.
from ._axes import COMPARE_V4_AXES  # noqa: F401

__all__ = ["COMPARE_V4_AXES"]
