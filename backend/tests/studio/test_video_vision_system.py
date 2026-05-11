"""VIDEO_VISION_SYSTEM 상수의 5 라벨 존재 + 영상 분석 의도 검증.

spec v1.1 §3.3 Task 1 — i2v 영상용 비전 system 의 5 섹션
(ANCHOR / MOTION CUES / ENVIRONMENT DYNAMICS / CAMERA POTENTIAL / MOOD)
이 정확히 포함되어 있어야 함.
"""

from __future__ import annotations


def test_video_vision_system_has_5_labels() -> None:
    """VIDEO_VISION_SYSTEM 안에 5 라벨 모두 verbatim 존재."""
    # facade re-export 경유 import
    from studio.vision_pipeline import VIDEO_VISION_SYSTEM

    for label in (
        "[ANCHOR]",
        "[MOTION CUES]",
        "[ENVIRONMENT DYNAMICS]",
        "[CAMERA POTENTIAL]",
        "[MOOD]",
    ):
        assert label in VIDEO_VISION_SYSTEM, f"라벨 누락: {label}"


def test_video_vision_system_mentions_i2v_goal() -> None:
    """i2v · 5-second clip · first frame 등 영상 분석 의도 키워드 포함."""
    from studio.vision_pipeline import VIDEO_VISION_SYSTEM

    for keyword in ("i2v", "first frame", "5-second"):
        assert keyword in VIDEO_VISION_SYSTEM, f"의도 키워드 누락: {keyword}"
