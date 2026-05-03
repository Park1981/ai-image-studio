"""banned_terms 후처리 필터 단위 테스트 (2 그룹 분리)."""

import pytest

from studio.vision_pipeline.banned_terms import (
    QUALITY_BOILERPLATE_TERMS,
    VISUAL_CONTRADICTION_TERMS,
    filter_banned,
)


class TestBannedTermsFilter:
    """관찰 근거 없는 visual contradiction 만 제거 — quality 태그는 보존."""

    def test_removes_visual_contradiction_when_no_evidence(self) -> None:
        """관찰 근거 없는 'muted earth tones' 는 제거된다."""
        positive = "young adult woman, holding a drink, muted earth tones, neon lights"
        observation = {
            "lighting_and_color": {
                "visible_light_sources": ["neon stage lights"],
                "dominant_colors": ["red", "blue"],
            }
        }
        result = filter_banned(positive, observation)
        assert "muted earth tones" not in result.lower()
        assert "neon lights" in result  # 다른 부분 유지

    def test_keeps_visual_term_when_evidence_present(self) -> None:
        """observation 에 'golden hour' 근거 있으면 유지된다."""
        positive = "young adult woman in golden hour lighting"
        observation = {
            "lighting_and_color": {
                "visible_light_sources": ["golden hour sunlight"],
            }
        }
        result = filter_banned(positive, observation)
        assert "golden hour" in result.lower()

    def test_quality_boilerplate_NOT_removed_in_mvp(self) -> None:
        """MVP 에선 quality 태그 (masterpiece/best quality 등) 는 유지된다."""
        positive = "subject, masterpiece, best quality, ultra detailed, high resolution"
        observation = {}  # 근거 X — 그래도 quality 태그는 보존되어야
        result = filter_banned(positive, observation)
        assert "masterpiece" in result.lower()
        assert "best quality" in result.lower()
        assert "ultra detailed" in result.lower()
        assert "high resolution" in result.lower()

    def test_handles_empty_input(self) -> None:
        """빈 입력은 그대로 반환."""
        assert filter_banned("", {}) == ""
        assert filter_banned("simple prompt", {}) == "simple prompt"

    def test_cleans_orphan_commas_after_removal(self) -> None:
        """제거 후 연속 콤마 / 공백 정리된다."""
        positive = "subject, muted earth tones, 85mm lens, lively scene"
        observation = {}  # 근거 없음 — 둘 다 제거
        result = filter_banned(positive, observation)
        assert ",," not in result
        assert "  " not in result  # 더블 스페이스 없음
        assert result.startswith("subject")
        assert result.endswith("lively scene")

    def test_visual_list_includes_known_offenders(self) -> None:
        """4 iterations 에서 발견한 visual contradiction 이 리스트에 있다."""
        for known in [
            "muted earth tones",
            "golden hour",
            "85mm portrait lens",
            "softbox key lighting",
            "shallow with soft bokeh",
            "cinematic editorial",
        ]:
            assert known in [b.lower() for b in VISUAL_CONTRADICTION_TERMS], (
                f"Missing known visual boilerplate: {known}"
            )

    def test_quality_terms_in_separate_group(self) -> None:
        """quality 태그는 VISUAL 그룹에 없고, QUALITY 그룹에만 있다."""
        for quality in ["masterpiece", "best quality", "ultra detailed", "high resolution"]:
            assert quality in [b.lower() for b in QUALITY_BOILERPLATE_TERMS]
            assert quality not in [b.lower() for b in VISUAL_CONTRADICTION_TERMS]
