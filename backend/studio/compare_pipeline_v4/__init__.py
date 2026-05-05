"""
compare_pipeline_v4 — Vision Compare 재설계 (2-stage observe + diff_synthesize).

Phase 1: 모듈 골격 + dataclass + helper + diff_synthesize.
Phase 2: pipeline.py (analyze_pair_v4) + translate.py 추가 예정.

Import 정책 (옵션 D · vision_pipeline Phase 4.3 codex C2 학습 박제):
  - 신규 코드는 sub-module 직접 import (`from studio.compare_pipeline_v4._coerce import ...`)
  - facade alias 는 production import 호환 / 옛 테스트만 사용
"""

from __future__ import annotations

from ._axes import COMPARE_V4_AXES
from ._coerce import (
    coerce_category_diff,
    coerce_domain_match,
    coerce_fidelity_score,
    coerce_key_anchor,
    coerce_str_list,
)
from ._types import (
    CompareAnalysisResultV4,
    CompareCategoryDiff,
    CompareKeyAnchor,
)
from .diff_synthesize import DIFF_SYNTHESIZE_SYSTEM, synthesize_diff

__all__ = [
    "COMPARE_V4_AXES",
    "CompareAnalysisResultV4",
    "CompareCategoryDiff",
    "CompareKeyAnchor",
    "DIFF_SYNTHESIZE_SYSTEM",
    "coerce_category_diff",
    "coerce_domain_match",
    "coerce_fidelity_score",
    "coerce_key_anchor",
    "coerce_str_list",
    "synthesize_diff",
]
