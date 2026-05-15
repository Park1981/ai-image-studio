"""
studio.pipelines — task #16 (2026-04-26): router.py 풀 분해 (_run_*_pipeline 추출).

router.py 가 1,769줄까지 커진 핵심 원인은 generate/edit/video 각 _run_*_pipeline
이 600줄 차지하던 것. 본 패키지로 분리해 router 는 endpoint dispatching 만 담당.

외부 호환:
  - tests/studio/test_comparison_pipeline.py 가 `from studio.router import _run_edit_pipeline`
  - tests/studio/test_history_cleanup.py 가 storage 심볼 import
  → router.py 가 본 패키지 심볼을 re-export 해서 외부 호환 보존.
"""

from __future__ import annotations

from ._dispatch import (
    COMFY_MOCK_FALLBACK,
    ComfyDispatchResult,
    SaveOutputFn,
    _cleanup_comfy_temp,
    _COMFYUI_OUTPUT_BASE,
    _dispatch_to_comfy,
    _mark_generation_complete,
    _mock_ref_or_raise,
    _OUR_COMFY_PREFIXES,
    _save_comfy_output,
    _save_comfy_video,
)
from .generate import _run_generate_pipeline
from .edit import _EDIT_MAX_IMAGE_BYTES, _run_edit_pipeline
from .video import (
    _VIDEO_MAX_IMAGE_BYTES,
    _extract_image_dims,
    _run_video_pipeline_task,
)
from .video_lab import _run_video_lab_pipeline_task
# Phase 6 (2026-04-27): Vision/Compare 도 task-based SSE 로 통일
from .vision_analyze import _run_vision_analyze_pipeline
from .compare_analyze import _run_compare_analyze_pipeline
from ..storage import STUDIO_MAX_IMAGE_BYTES

__all__ = [
    # _dispatch
    "COMFY_MOCK_FALLBACK",
    "ComfyDispatchResult",
    "SaveOutputFn",
    "_cleanup_comfy_temp",
    "_COMFYUI_OUTPUT_BASE",
    "_dispatch_to_comfy",
    "_mark_generation_complete",
    "_mock_ref_or_raise",
    "_OUR_COMFY_PREFIXES",
    "_save_comfy_output",
    "_save_comfy_video",
    # 파이프라인
    "_run_generate_pipeline",
    "_run_edit_pipeline",
    "_run_video_pipeline_task",
    "_run_video_lab_pipeline_task",
    "_run_vision_analyze_pipeline",
    "_run_compare_analyze_pipeline",
    # 사이즈/유틸 상수
    "_EDIT_MAX_IMAGE_BYTES",
    "_VIDEO_MAX_IMAGE_BYTES",
    "STUDIO_MAX_IMAGE_BYTES",
    "_extract_image_dims",
]
