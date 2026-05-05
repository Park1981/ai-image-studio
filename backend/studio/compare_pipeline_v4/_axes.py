"""
compare_pipeline_v4._axes — 5 카테고리 axes 상수.

vision_pipeline.image_detail 의 9 슬롯 중 매핑 가능한 5개 (RecipeV2View 카드 구조).
순서 = UI 매트릭스 row 순서 (구도 → 피사체 → 의상·재질 → 환경 → 광원·카메라·스타일).
"""

from __future__ import annotations

# 튜플 — mutation 방지 (실수로 카테고리 추가 시 다른 곳 깨짐 검출용)
COMPARE_V4_AXES: tuple[str, ...] = (
    "composition",
    "subject",
    "clothing_or_materials",
    "environment",
    "lighting_camera_style",
)
