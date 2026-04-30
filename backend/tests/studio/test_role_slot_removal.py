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


# ───────── Phase 1'' Layer 1: vision matrix 에 없는 target slot 강제 추가 (2026-04-28) ─────────


def _make_hair_only_analysis():
    """vision 분석 케이스: 사용자 instruction='머리 색 변경' → attire 슬롯이 *없는* 매트릭스.

    qwen2.5vl 가 사용자가 명시적으로 건드린 슬롯만 결과에 담는 케이스 재현.
    이게 Phase 1' Slot Replacement 의 한계 — for 루프가 attire 키를 못 봐서 우리
    [reference_from_image2] 코드가 적용 안 됨.
    """
    from studio.vision_pipeline import EditSlotEntry, EditVisionAnalysis

    return EditVisionAnalysis(
        domain="person",
        intent="Change the hair color to blue-black.",
        summary="Asian woman with mid-length hair.",
        slots={
            # attire 슬롯이 *없음* — vision 이 사용자 instruction 만 보고 결정
            "face_expression": EditSlotEntry(
                action="preserve", note="A neutral expression."
            ),
            "hair": EditSlotEntry(
                action="edit", note="Change hair color to blue-black."
            ),
            "body_pose": EditSlotEntry(
                action="preserve", note="The woman is standing facing the camera."
            ),
            "background": EditSlotEntry(
                action="preserve", note="Plain studio backdrop."
            ),
        },
        provider="ollama",
        fallback=False,
    )


def test_layer1_force_adds_missing_target_slot() -> None:
    """role=outfit + 매트릭스에 attire 키 없음 → [reference_from_image2] attire 강제 추가.

    Phase 1'' Layer 1 핵심: vision 이 attire 슬롯 안 만들어도 도메인 화이트리스트
    매칭되면 매트릭스에 강제 박힘.
    """
    from studio.prompt_pipeline import _build_matrix_directive_block

    analysis = _make_hair_only_analysis()
    assert "attire" not in analysis.slots  # 전제: vision 매트릭스에 attire 없음

    directive = _build_matrix_directive_block(analysis, reference_role="outfit")

    # attire 슬롯이 force-added 로 강제 추가됨
    assert "[reference_from_image2] attire" in directive
    assert "Apply image2's attire" in directive
    assert "force-added" in directive
    assert "MUST mention 'image2'" in directive


def test_layer1_does_NOT_add_slot_outside_domain() -> None:
    """도메인 외 슬롯은 강제 추가 안 됨.

    예: domain='person' + role='style' → mood_style 은 person 도메인 슬롯 아니므로
    DOMAIN_VALID_SLOTS['person'] 과 교집합 0 → 강제 추가 X.
    """
    from studio.prompt_pipeline import _build_matrix_directive_block

    analysis = _make_hair_only_analysis()
    directive = _build_matrix_directive_block(analysis, reference_role="style")

    # mood_style 는 person 도메인이 아니므로 force-add 안 됨
    assert "[reference_from_image2] mood / style" not in directive
    assert "[reference_from_image2] mood_style" not in directive


def test_layer1_skips_slot_if_already_in_matrix() -> None:
    """매트릭스에 이미 있는 target slot 은 *중복 추가 안 됨*.

    for 루프에서 [reference_from_image2] 로 처리됐으면 후속 force-add 패스에서 skip.
    """
    from studio.prompt_pipeline import _build_matrix_directive_block
    from studio.vision_pipeline import EditSlotEntry, EditVisionAnalysis

    analysis = EditVisionAnalysis(
        domain="person",
        intent="Hair color change",
        summary="...",
        slots={
            "hair": EditSlotEntry(action="edit", note="blue-black"),
            "attire": EditSlotEntry(  # 매트릭스에 *있음* (preserve)
                action="preserve", note="The woman wears a sweater."
            ),
        },
        provider="ollama",
        fallback=False,
    )
    directive = _build_matrix_directive_block(analysis, reference_role="outfit")

    # [reference_from_image2] attire 가 1번만 등장 (force-add 중복 X)
    count_ref = directive.count("[reference_from_image2] attire")
    assert count_ref == 1, f"중복 등장: {count_ref}회"
    # for 루프에서 처리됐으므로 force-added 라벨 부재 (이 케이스 force-add 트리거 X)
    assert "force-added" not in directive


# ───────── Phase 1'' Layer 2: gemma4 post-process 강제 phrase 주입 (2026-04-28) ─────────


def test_layer2_phrase_injected_when_image2_missing() -> None:
    """gemma4 결과에 image2 미언급 + role 매핑 → 결과 끝에 deterministic phrase 주입.

    Mock _run_upgrade_call 로 image2 없는 결과 시뮬레이션.
    """
    import asyncio
    from unittest.mock import patch

    from studio.prompt_pipeline import UpgradeResult, upgrade_edit_prompt

    # gemma4 가 image2 없는 결과 반환하는 케이스 시뮬레이션
    async def fake_run_upgrade_call(**kwargs):
        return UpgradeResult(
            upgraded="Change hair to blue-black, preserve everything else.",
            fallback=False,
            provider="ollama",
            original=kwargs["original"],
            translation=None,
        )

    with patch(
        "studio.prompt_pipeline.upgrade._run_upgrade_call",
        side_effect=fake_run_upgrade_call,
    ):
        result = asyncio.run(
            upgrade_edit_prompt(
                edit_instruction="머리를 블루블랙으로 변경",
                image_description="A woman with mid-length hair.",
                reference_role="outfit",
            )
        )

    # Layer 2 phrase 주입 확인
    assert "image2" in result.upgraded.lower()
    assert "Apply image2's outfit" in result.upgraded


def test_layer2_does_NOT_inject_when_gemma4_already_mentions_image2() -> None:
    """gemma4 가 이미 image2 언급한 경우 → 중복 주입 안 함."""
    import asyncio
    from unittest.mock import patch

    from studio.prompt_pipeline import UpgradeResult, upgrade_edit_prompt

    async def fake_run_upgrade_call(**kwargs):
        return UpgradeResult(
            upgraded="Apply image2's outfit to the subject in image1, change hair color.",
            fallback=False,
            provider="ollama",
            original=kwargs["original"],
            translation=None,
        )

    with patch(
        "studio.prompt_pipeline.upgrade._run_upgrade_call",
        side_effect=fake_run_upgrade_call,
    ):
        result = asyncio.run(
            upgrade_edit_prompt(
                edit_instruction="머리 변경",
                image_description="...",
                reference_role="outfit",
            )
        )

    # gemma4 가 이미 image2 언급 → image2 단어 1번만 (중복 주입 X)
    count_image2 = result.upgraded.lower().count("image2")
    assert count_image2 == 1, f"중복 주입: image2 등장 {count_image2}회"


def test_layer2_does_NOT_inject_when_role_is_none() -> None:
    """reference_role=None → Layer 2 phrase 주입 안 함 (single-image 회귀 보장)."""
    import asyncio
    from unittest.mock import patch

    from studio.prompt_pipeline import UpgradeResult, upgrade_edit_prompt

    async def fake_run_upgrade_call(**kwargs):
        return UpgradeResult(
            upgraded="Change hair to blue-black.",
            fallback=False,
            provider="ollama",
            original=kwargs["original"],
            translation=None,
        )

    with patch(
        "studio.prompt_pipeline.upgrade._run_upgrade_call",
        side_effect=fake_run_upgrade_call,
    ):
        result = asyncio.run(
            upgrade_edit_prompt(
                edit_instruction="머리 변경",
                image_description="...",
                reference_role=None,
            )
        )

    # role=None → image2 미주입
    assert "image2" not in result.upgraded.lower()


def test_layer2_does_NOT_inject_when_fallback() -> None:
    """fallback=True → image2 phrase 주입 안 함 (Ollama 실패 시 원본 보존)."""
    import asyncio
    from unittest.mock import patch

    from studio.prompt_pipeline import UpgradeResult, upgrade_edit_prompt

    async def fake_run_upgrade_call(**kwargs):
        return UpgradeResult(
            upgraded=kwargs["original"],
            fallback=True,
            provider="fallback",
            original=kwargs["original"],
            translation=None,
        )

    with patch(
        "studio.prompt_pipeline.upgrade._run_upgrade_call",
        side_effect=fake_run_upgrade_call,
    ):
        result = asyncio.run(
            upgrade_edit_prompt(
                edit_instruction="Change hair",
                image_description="...",
                reference_role="outfit",
            )
        )

    # fallback 시 image2 phrase 미주입
    assert "image2" not in result.upgraded.lower()
    assert result.fallback is True
