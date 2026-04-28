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


# ───────── 사용자 발견 케이스 회귀 (2026-04-28 · Phase 1' Slot Replacement) ─────────
# 사용자 케이스: role=background + edit_instruction="Calvin Klein bra 제거"
# 결과 프롬프트에 image2 가 한 번도 안 나오고 "preserve background" 가 박힘.
# Phase 1' (codex 리뷰 반영): background 슬롯이 [reference_from_image2] 명시 액션으로 교체.
# 침묵(제거) 전략은 LLM 의 default-preserve 환각을 못 막아서 명시 액션으로 전환.


def _make_user_case_analysis():
    """사용자 케이스 재현용 매트릭스: bra 제거 instruction → attire 만 [edit]."""
    from studio.vision_pipeline import EditSlotEntry, EditVisionAnalysis

    return EditVisionAnalysis(
        domain="person",
        intent="Remove the Calvin Klein bra.",
        summary="A woman wearing a Calvin Klein bra in a studio setting.",
        slots={
            "face_expression": EditSlotEntry(
                action="preserve", note="The woman has a neutral expression."
            ),
            "hair": EditSlotEntry(
                action="preserve", note="The woman has long brown hair."
            ),
            "attire": EditSlotEntry(
                action="edit", note="Remove the Calvin Klein bra."
            ),
            "body_pose": EditSlotEntry(
                action="preserve", note="The woman is standing facing the camera."
            ),
            "background": EditSlotEntry(
                action="preserve", note="A plain studio backdrop."
            ),
        },
        provider="ollama",
        fallback=False,
    )


def test_user_case_background_role_replaces_with_reference_action() -> None:
    """사용자 발견 버그 회귀 — background slot 이 [reference_from_image2] 명시 액션으로 교체.

    Phase 1' 핵심: [preserve] 도 사라지고 [reference_from_image2] 가 박혀야.
    매트릭스에 명시 액션이 박혀야 gemma4 가 default-preserve 환각 못함.
    """
    from studio.prompt_pipeline import _build_matrix_directive_block

    analysis = _make_user_case_analysis()
    directive = _build_matrix_directive_block(analysis, reference_role="background")

    # [preserve] 라벨 부재 (제거 + 새 라벨로 교체)
    assert "[preserve] background" not in directive
    # 새 [reference_from_image2] 라벨 + image2 mention 강제 directive
    assert "[reference_from_image2] background" in directive
    assert "Apply image2's background" in directive
    assert "MUST mention 'image2'" in directive
    # attire [edit] 는 그대로 살아있어야 (사용자 instruction)
    assert "[edit] attire" in directive
    assert "Remove the Calvin Klein bra" in directive


def test_user_case_background_role_keeps_other_preserve_slots() -> None:
    """slot replacement 는 *role 매핑 슬롯만* 영향. 나머지 preserve 슬롯은 정상 유지."""
    from studio.prompt_pipeline import _build_matrix_directive_block

    analysis = _make_user_case_analysis()
    directive = _build_matrix_directive_block(analysis, reference_role="background")

    # 다른 preserve 슬롯 4개는 그대로 살아있어야 ([preserve] 그대로)
    assert "[preserve] face / expression" in directive
    assert "[preserve] hair" in directive
    assert "[preserve] body / pose" in directive


def test_user_case_full_system_edit_combines_directive_and_clause() -> None:
    """SYSTEM_EDIT + matrix directive + build_reference_clause 합성 후
    매트릭스 안에 [reference_from_image2] 명시 액션 + reference_clause 가 동시에 살아있어야.
    """
    from studio.prompt_pipeline import (
        SYSTEM_EDIT,
        _build_matrix_directive_block,
        build_reference_clause,
    )

    analysis = _make_user_case_analysis()
    directive = _build_matrix_directive_block(analysis, reference_role="background")
    clause = build_reference_clause("background")
    full_system = f"{SYSTEM_EDIT}\n\n{directive}\n\n{clause}"
    lower = full_system.lower()

    # background preserve 지시 완전 부재
    assert "preserve the original background" not in lower
    assert "[preserve] background" not in full_system
    # 매트릭스 안에 명시 액션 박힘 (codex 권장 핵심)
    assert "[reference_from_image2] background" in full_system
    assert "MUST mention 'image2'" in full_system
    # image2 reference 지시 명시
    assert "image2" in full_system
    assert "do not preserve" in lower or "replace" in lower
