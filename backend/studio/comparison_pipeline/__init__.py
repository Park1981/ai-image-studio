"""
comparison_pipeline — Edit 결과 vs 원본 비교 분석 (qwen2.5vl multi-image) facade.

spec 16 (2026-04-25 v3 패러다임 전환):
  - 5축 키 = 사전 분석 슬롯과 동일 (도메인별 인물 5 / 물체·풍경 5)
  - 점수 의미 = 의도 컨텍스트 (보존이면 유사도, 변경이면 의도부합도)
  - domain 필드 추가 (analyze_pair 만 적용; analyze_pair_generic 영향 없음)

Phase 4.4 (2026-04-30) 3 sub-module 분할:
- _common: axes 정의 / dataclass / _empty_* / _coerce_* / _compute_overall /
           _to_b64 / _TRANSLATE_SYSTEM / _translate_comments_to_ko (v3 + v2_generic 공용)
- v3: SYSTEM_COMPARE / _call_vision_pair / _coerce_intent / _coerce_v3_slots /
      _v3_overall / analyze_pair (Edit context 매트릭스 비교)
- v2_generic: SYSTEM_COMPARE_GENERIC / _COMPARE_HINT_DIRECTIVE /
              _call_vision_pair_generic / analyze_pair_generic (Vision Compare 메뉴)

신규 코드는 sub-module 직접 import 권장 (production import 호환을 위해 facade
re-export 유지). mock.patch 도 sub-module path 사용 — facade attribute 는 import
시점 reference snapshot 이라 submodule patch 가 facade 에 반영 안 됨 (Phase 4.3
codex C2 정책).
"""

from __future__ import annotations

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
from .v2_generic import (  # noqa: F401 — facade re-export
    SYSTEM_COMPARE_GENERIC,
    _COMPARE_HINT_DIRECTIVE,
    _call_vision_pair_generic,
    analyze_pair_generic,
)
from .v3 import (  # noqa: F401 — facade re-export
    SYSTEM_COMPARE,
    _call_vision_pair,
    _coerce_intent,
    _coerce_v3_slots,
    _v3_overall,
    analyze_pair,
)

__all__ = [
    # _common — axes
    "PERSON_AXES",
    "OBJECT_SCENE_AXES",
    "LEGACY_EDIT_AXES",
    "AXES",
    "COMPARE_AXES",
    # _common — dataclass
    "ComparisonSlotEntry",
    "ComparisonAnalysisResult",
    # _common — helpers
    "_empty_scores",
    "_empty_comments",
    "_to_b64",
    "_coerce_scores",
    "_coerce_comments",
    "_compute_overall",
    # _common — translate
    "_TRANSLATE_SYSTEM",
    "_translate_comments_to_ko",
    # _common — _json_utils alias (옛 호환)
    "_coerce_score",
    "_parse_strict_json",
    # _common — log
    "log",
    # v3
    "SYSTEM_COMPARE",
    "_call_vision_pair",
    "_coerce_intent",
    "_coerce_v3_slots",
    "_v3_overall",
    "analyze_pair",
    # v2_generic (codex C2 fix — _COMPARE_HINT_DIRECTIVE 가 여기에)
    "SYSTEM_COMPARE_GENERIC",
    "_COMPARE_HINT_DIRECTIVE",
    "_call_vision_pair_generic",
    "analyze_pair_generic",
]
