"""
ROLE_TO_SLOTS 매핑 + _role_target_slots 헬퍼 단위 테스트.

목표: reference_role → image1 매트릭스에서 제거할 슬롯 키 집합 매핑이
      4 role 모두 일관되게 동작.
"""

from __future__ import annotations

from studio.prompt_pipeline import ROLE_TO_SLOTS, _role_target_slots


# ───────── ROLE_TO_SLOTS 매핑 직접 검증 ─────────


def test_role_to_slots_face_targets_face_expression() -> None:
    """face role → face_expression 슬롯 (인물 도메인)."""
    assert "face_expression" in ROLE_TO_SLOTS["face"]


def test_role_to_slots_outfit_targets_attire() -> None:
    """outfit role → attire 슬롯 (인물 도메인)."""
    assert "attire" in ROLE_TO_SLOTS["outfit"]


def test_role_to_slots_background_targets_both_domains() -> None:
    """background role → background (인물) + background_setting (물체) 두 슬롯.

    물체/풍경 도메인의 슬롯 이름이 다르므로 두 도메인 모두 cover 해야.
    """
    targets = ROLE_TO_SLOTS["background"]
    assert "background" in targets
    assert "background_setting" in targets


def test_role_to_slots_style_targets_mood_style() -> None:
    """style role → mood_style 슬롯 (물체 도메인). 인물 도메인은 직접 매칭 슬롯 없음."""
    assert "mood_style" in ROLE_TO_SLOTS["style"]


# ───────── _role_target_slots 헬퍼 ─────────


def test_role_target_slots_known_role() -> None:
    """known role → 매핑 슬롯 키 frozenset 반환."""
    result = _role_target_slots("background")
    assert isinstance(result, frozenset)
    assert "background" in result


def test_role_target_slots_none_returns_empty() -> None:
    """role None → 빈 frozenset (제거 슬롯 없음)."""
    assert _role_target_slots(None) == frozenset()


def test_role_target_slots_empty_string_returns_empty() -> None:
    """빈 문자열 role → 빈 frozenset."""
    assert _role_target_slots("") == frozenset()


def test_role_target_slots_unknown_role_returns_empty() -> None:
    """알 수 없는 자유 텍스트 role → 빈 frozenset.

    자유 텍스트는 어느 슬롯을 가리키는지 알 수 없으므로 slot removal 미적용.
    reference_clause 의 자유 텍스트 fallback 만 동작.
    """
    assert _role_target_slots("hand pose only") == frozenset()
