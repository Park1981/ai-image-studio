"""
vision_pipeline — qwen2.5vl 비전 분석 (Phase 5 · 2-stage 분업 · 2026-05-03).

옛 단일 파일 vision_pipeline.py (1131줄) 을 sub-module 로 분할 (Phase 4.2):
  - _common.py           : ProgressCallback / VISION_SYSTEM / _describe_image / _to_base64 /
                           _aspect_label / _DEFAULT_OLLAMA_URL alias / DEFAULT_TIMEOUT alias / log
  - edit_source.py       : EDIT_VISION_ANALYSIS_SYSTEM + Edit 9-slot 매트릭스 흐름
                           (clarify_edit_intent → analyze_edit_source → upgrade_edit_prompt)
  - image_detail.py      : Vision Recipe v3 2-stage 오케스트레이터
                           (observe_image → synthesize_prompt → filter_banned →
                            map_observation_to_slots → translate → VisionAnalysisResult)

Phase 1-4 신규 sub-module (2026-05-03 Vision 2-stage):
  - vision_observe.py    : VISION_OBSERVATION_SYSTEM + observe_image (vision 관찰자)
  - prompt_synthesize.py : PROMPT_SYNTHESIZE_SYSTEM + synthesize_prompt (text 편집자)
  - banned_terms.py      : VISUAL_CONTRADICTION_TERMS + QUALITY_BOILERPLATE_TERMS + filter_banned
  - observation_mapping.py: map_observation_to_slots (observation → 5 슬롯)

facade (본 파일) 은 외부 호환을 위해 모든 public 항목 명시 re-export.
sub-module 은 `from . import _common as _c` + `_c._describe_image()` 패턴 (codex C2/C3 정합).

흐름 개요:
  - Edit 모드: clarify_edit_intent (gemma4) → analyze_edit_source (qwen2.5vl 매트릭스)
               → upgrade_edit_prompt (gemma4 ComfyUI 프롬프트). 폴백 = _describe_image 캡션.
  - Vision Analyzer (v3): observe_image (vision 관찰) → synthesize_prompt (text 합성)
                           → filter_banned → map_observation_to_slots → translate_to_korean.
                           vision 실패 시 fallback=True. text 실패 시 observation 기반 짧은
                           positive 자동 합성 (빈 문자열 X).
"""

from __future__ import annotations

# Phase 4.2 단계 2 — _common 그룹.
from ._common import (  # noqa: F401
    DEFAULT_TIMEOUT,
    ProgressCallback,
    VISION_SYSTEM,
    _DEFAULT_OLLAMA_URL,
    _aspect_label,
    _describe_image,
    _to_base64,
    log,
)

# Phase 4.2 단계 3 — edit_source 그룹.
from .edit_source import (  # noqa: F401
    EDIT_VISION_ANALYSIS_SYSTEM,
    EditSlotEntry,
    EditVisionAnalysis,
    OBJECT_SCENE_SLOTS,
    PERSON_SLOTS,
    VALID_ACTIONS,
    VALID_DOMAINS,
    VisionPipelineResult,
    _call_vision_edit_source,
    _coerce_action,
    _coerce_domain,
    _coerce_slots,
    _empty_fallback_slots,
    analyze_edit_source,
    run_vision_pipeline,
)

# Phase 4.2 단계 4 / Phase 5 — image_detail 그룹 (v3 2-stage 오케스트레이터).
# 주의: 옛 SYSTEM_VISION_DETAILED, SYSTEM_VISION_RECIPE_V2, _call_vision_recipe_v2 제거됨.
from .image_detail import (  # noqa: F401
    VisionAnalysisResult,
    analyze_image_detailed,
)

# Phase 1-4 신규 sub-module facade re-export (2026-05-03 · 2-stage).
from .vision_observe import (  # noqa: F401
    VISION_OBSERVATION_SYSTEM,
    observe_image,
)
from .prompt_synthesize import (  # noqa: F401
    PROMPT_SYNTHESIZE_SYSTEM,
    synthesize_prompt,
)
from .banned_terms import (  # noqa: F401
    QUALITY_BOILERPLATE_TERMS,
    VISUAL_CONTRADICTION_TERMS,
    filter_banned,
)
from .observation_mapping import (  # noqa: F401
    map_observation_to_slots,
)


__all__ = [
    # _common
    "DEFAULT_TIMEOUT",
    "ProgressCallback",
    "VISION_SYSTEM",
    "_DEFAULT_OLLAMA_URL",
    "_aspect_label",
    "_describe_image",
    "_to_base64",
    "log",
    # edit_source
    "EDIT_VISION_ANALYSIS_SYSTEM",
    "EditSlotEntry",
    "EditVisionAnalysis",
    "OBJECT_SCENE_SLOTS",
    "PERSON_SLOTS",
    "VALID_ACTIONS",
    "VALID_DOMAINS",
    "VisionPipelineResult",
    "_call_vision_edit_source",
    "_coerce_action",
    "_coerce_domain",
    "_coerce_slots",
    "_empty_fallback_slots",
    "analyze_edit_source",
    "run_vision_pipeline",
    # image_detail (v3 · Phase 5)
    "VisionAnalysisResult",
    "analyze_image_detailed",
    # vision_observe (Phase 1)
    "VISION_OBSERVATION_SYSTEM",
    "observe_image",
    # prompt_synthesize (Phase 2)
    "PROMPT_SYNTHESIZE_SYSTEM",
    "synthesize_prompt",
    # banned_terms (Phase 3)
    "VISUAL_CONTRADICTION_TERMS",
    "QUALITY_BOILERPLATE_TERMS",
    "filter_banned",
    # observation_mapping (Phase 4)
    "map_observation_to_slots",
]
