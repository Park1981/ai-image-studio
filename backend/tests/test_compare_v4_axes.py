"""compare_pipeline_v4 의 5 카테고리 axes 상수 검증."""

from studio.compare_pipeline_v4._axes import COMPARE_V4_AXES


def test_compare_v4_axes_5_categories_in_order():
    """vision_pipeline image_detail 의 5 슬롯과 동일 키 + 순서 (UI 매트릭스 일관)."""
    assert COMPARE_V4_AXES == (
        "composition",
        "subject",
        "clothing_or_materials",
        "environment",
        "lighting_camera_style",
    )


def test_compare_v4_axes_immutable_tuple():
    """튜플이라 mutation 안 됨 (실수 방지)."""
    assert isinstance(COMPARE_V4_AXES, tuple)


def test_compare_v4_axes_count_is_5():
    """5 카테고리 매트릭스 박제 — 추가 시 frontend categoryDiffs 갱신 필수.

    누가 6번째 카테고리 무심코 추가하면 즉시 fail 로 알림 (silent break 방지).
    """
    assert len(COMPARE_V4_AXES) == 5
