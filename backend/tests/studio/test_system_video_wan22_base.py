"""SYSTEM_VIDEO_WAN22_BASE 상수 + SYSTEM_VIDEO_RULES override 검증.

spec v1.1 §5 + Codex Finding 4 — Wan 2.2 전용 gemma4 system prompt +
cartoon avoidance 의 user override 절 확인.
"""

from __future__ import annotations


def test_system_video_wan22_base_targets_wan() -> None:
    """SYSTEM_VIDEO_WAN22_BASE 가 Wan 2.2 + 16fps + umT5 명시."""
    from studio.prompt_pipeline import SYSTEM_VIDEO_WAN22_BASE

    for keyword in ("Wan 2.2", "16fps", "umT5"):
        assert keyword in SYSTEM_VIDEO_WAN22_BASE, f"키워드 누락: {keyword}"


def test_system_video_wan22_base_specifies_word_count() -> None:
    """50-80 단어 제약 명시."""
    from studio.prompt_pipeline import SYSTEM_VIDEO_WAN22_BASE

    assert "50-80 words" in SYSTEM_VIDEO_WAN22_BASE


def test_system_video_wan22_base_uses_positive_hand_instruction() -> None:
    """Codex Finding 5 보강 — 'hands remain still' 같은 positive instruction.

    부정형 'Avoid complex finger' 가 *없고*, 'hands remain still' 류가
    *있어야* 함 (negative-prompt-effect 회피).
    """
    from studio.prompt_pipeline import SYSTEM_VIDEO_WAN22_BASE

    assert "hands remain still" in SYSTEM_VIDEO_WAN22_BASE or (
        "hands stay" in SYSTEM_VIDEO_WAN22_BASE
    ), "positive hand instruction 누락"


def test_system_video_rules_allows_explicit_style_override() -> None:
    """Codex Finding 4 — 'unless explicitly requested' 보강 확인."""
    from studio.prompt_pipeline.upgrade import SYSTEM_VIDEO_RULES

    assert "unless the user" in SYSTEM_VIDEO_RULES, (
        "SYSTEM_VIDEO_RULES 에 user override 절 누락"
    )
    assert "explicitly requests" in SYSTEM_VIDEO_RULES
