"""build_system_video model_id 분기 + keyword-only required 검증.

spec v1.1 §5.2 + Codex Finding 1 — silent Wan→LTX prompt 사고 차단.
"""

from __future__ import annotations

import pytest


def test_build_system_video_dispatches_wan22() -> None:
    """model_id='wan22' 시 SYSTEM_VIDEO_WAN22_BASE 키워드 포함."""
    from studio.prompt_pipeline.upgrade import build_system_video

    result = build_system_video(adult=False, model_id="wan22")
    assert "Wan 2.2" in result
    assert "16fps" in result
    assert "50-80 words" in result


def test_build_system_video_dispatches_ltx() -> None:
    """model_id='ltx' 시 LTX cinematic 키워드 포함."""
    from studio.prompt_pipeline.upgrade import build_system_video

    result = build_system_video(adult=False, model_id="ltx")
    assert "LTX-2.3" in result
    assert "60-150 words" in result


def test_build_system_video_rejects_missing_model_id() -> None:
    """model_id 누락 시 TypeError — keyword-only required 보장.

    Codex Finding 1 — 누락 호출자가 silent 로 LTX prompt 받지 않도록.
    """
    from studio.prompt_pipeline.upgrade import build_system_video

    with pytest.raises(TypeError):
        build_system_video(adult=False)  # type: ignore[call-arg]


def test_build_system_video_rejects_unknown_model_id() -> None:
    """알 수 없는 model_id 는 ValueError."""
    from studio.prompt_pipeline.upgrade import build_system_video

    with pytest.raises(ValueError, match="unknown video model_id"):
        build_system_video(adult=False, model_id="unknown")  # type: ignore[arg-type]


def test_build_system_video_includes_adult_clause_when_adult() -> None:
    """adult=True 시 NSFW clause 포함 (양 모델 공통)."""
    from studio.prompt_pipeline.upgrade import build_system_video

    wan_result = build_system_video(adult=True, model_id="wan22")
    ltx_result = build_system_video(adult=True, model_id="ltx")

    # SYSTEM_VIDEO_ADULT_CLAUSE 의 핵심 문구
    assert "ADULT MODE" in wan_result
    assert "ADULT MODE" in ltx_result
