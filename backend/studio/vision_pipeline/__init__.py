"""
vision_pipeline — qwen2.5vl 비전 분석 (Phase 4.2 분할 · 2026-04-30).

옛 단일 파일 vision_pipeline.py (1131줄) 을 sub-module 로 분할:
  - _common.py       : ProgressCallback / VISION_SYSTEM / _describe_image / _to_base64 /
                       _aspect_label / _DEFAULT_OLLAMA_URL alias / DEFAULT_TIMEOUT alias / log
  - edit_source.py   : EDIT_VISION_ANALYSIS_SYSTEM + Edit 9-slot 매트릭스 흐름
                       (clarify_edit_intent → analyze_edit_source → upgrade_edit_prompt)
  - image_detail.py  : SYSTEM_VISION_RECIPE_V2 + Vision Analyzer recipe v2 (단일 이미지 → 9-slot JSON)

facade (본 파일) 은 외부 호환을 위해 모든 public 항목 명시 re-export.
sub-module 은 `from . import _common as _c` + `_c._describe_image()` 패턴 (codex C2/C3 정합).

흐름 개요:
  - Edit 모드: clarify_edit_intent (gemma4) → analyze_edit_source (qwen2.5vl 매트릭스)
               → upgrade_edit_prompt (gemma4 ComfyUI 프롬프트). 폴백 = _describe_image 캡션.
  - Vision Analyzer: SYSTEM_VISION_RECIPE_V2 + width/height 주입 → JSON 9 슬롯.
                     실패 시 SYSTEM_VISION_DETAILED 로 폴백 (단락 영문) → 9 슬롯 빈 문자열.
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

# Phase 4.2 단계 4 — image_detail 그룹.
from .image_detail import (  # noqa: F401
    SYSTEM_VISION_DETAILED,
    SYSTEM_VISION_RECIPE_V2,
    VisionAnalysisResult,
    _call_vision_recipe_v2,
    analyze_image_detailed,
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
    # image_detail
    "SYSTEM_VISION_DETAILED",
    "SYSTEM_VISION_RECIPE_V2",
    "VisionAnalysisResult",
    "_call_vision_recipe_v2",
    "analyze_image_detailed",
]
