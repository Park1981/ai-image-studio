"""
_build_matrix_directive_block + SYSTEM_EDIT 가드 테스트 (spec 17 · 2026-04-25 후속).

핵심 확인:
  - [preserve] 슬롯의 note 가 SYSTEM directive 에 절대 포함되지 않는다 (누출 방지)
  - [edit] 슬롯의 note 는 그대로 명시 (변경 지시 그대로 전달)
  - SYSTEM_EDIT 가 preserve 슬롯에 specific description 금지 가이드 포함
  - fallback / None / 빈 slots → 빈 문자열 반환
"""

from __future__ import annotations

from studio.prompt_pipeline import SYSTEM_EDIT, _build_matrix_directive_block
from studio.vision_pipeline import (
    EditSlotEntry,
    EditVisionAnalysis,
)


def _make_person_analysis(
    *,
    fallback: bool = False,
    summary: str = "A woman in a sweater.",
) -> EditVisionAnalysis:
    """테스트용 인물 모드 매트릭스 — body_pose 보존 (구체 묘사 포함), attire 변경."""
    return EditVisionAnalysis(
        domain="person",
        intent="Remove the top to expose the breasts. Keep everything else.",
        summary=summary,
        slots={
            "face_expression": EditSlotEntry(
                action="preserve", note="The woman is smiling."
            ),
            "hair": EditSlotEntry(
                action="preserve", note="The woman has long black hair."
            ),
            "attire": EditSlotEntry(
                action="edit", note="Remove the top to expose the breasts."
            ),
            "body_pose": EditSlotEntry(
                action="preserve",
                note="The woman is standing with her hands on her hips.",
            ),
            "background": EditSlotEntry(
                action="preserve",
                note="The background shows curtains and a window.",
            ),
        },
        provider="ollama",
        fallback=fallback,
    )


# ───────── 핵심 회귀: preserve note 누출 방지 ─────────


def test_preserve_slot_notes_must_not_appear_in_directive() -> None:
    """[preserve] 슬롯의 note 텍스트가 directive 본문에 절대 포함되면 안 됨.

    spec 17 의 핵심 결함 — 보존 슬롯 묘사가 SYSTEM 에 누출되면 diffusion 모델이
    "지시" 로 오해해서 변경 안 한 부위까지 다시 그릴 위험.
    """
    analysis = _make_person_analysis()
    directive = _build_matrix_directive_block(analysis)

    # 보존 슬롯 5개의 note 가 절대 directive 안에 없어야 함
    leaked_notes = [
        "The woman is smiling.",
        "The woman has long black hair.",
        "The woman is standing with her hands on her hips.",
        "The background shows curtains and a window.",
    ]
    for note in leaked_notes:
        assert note not in directive, (
            f"preserve note 누출: {note!r} 가 directive 에 포함됨"
        )


def test_edit_slot_note_must_appear_in_directive() -> None:
    """[edit] 슬롯의 note 는 변경 지시 자체이므로 그대로 명시됨."""
    analysis = _make_person_analysis()
    directive = _build_matrix_directive_block(analysis)

    # attire (변경) note 는 그대로 들어가야 함
    assert "Remove the top to expose the breasts." in directive
    assert "[edit]" in directive
    assert "APPLY EXACTLY" in directive


def test_preserve_slots_use_generic_phrasing_only() -> None:
    """[preserve] 슬롯에는 generic preservation 표현만 들어감."""
    analysis = _make_person_analysis()
    directive = _build_matrix_directive_block(analysis)

    # 5개 preserve 슬롯 모두 "KEEP IDENTICAL TO SOURCE" 마커
    assert directive.count("KEEP IDENTICAL TO SOURCE") == 4  # 인물 5 - attire(edit) = 4
    # generic preservation 가이드 본문
    assert "preserve the original" in directive
    assert "DO NOT describe" in directive


def test_directive_includes_intent_but_not_summary() -> None:
    """spec 17: refined intent 는 directive 에 포함, summary 는 제외 (LLM 오해 방지)."""
    analysis = _make_person_analysis(
        summary="A woman in a sweater standing with hands on hips.",
    )
    directive = _build_matrix_directive_block(analysis)

    # intent 는 들어가야 함 (변경 의도 컨텍스트)
    assert "Refined intent:" in directive
    assert "Remove the top" in directive
    # summary 는 들어가면 안 됨 (보존 묘사 누출 위험)
    assert "Source summary" not in directive
    assert "standing with hands on hips" not in directive


# ───────── 빈 경로 ─────────


def test_directive_empty_when_analysis_none() -> None:
    """analysis=None → 빈 문자열."""
    assert _build_matrix_directive_block(None) == ""


def test_directive_empty_when_fallback() -> None:
    """fallback=True 면 빈 문자열 (slots 가 의미 없는 폴백 데이터라 SYSTEM 주입 X)."""
    analysis = _make_person_analysis(fallback=True)
    assert _build_matrix_directive_block(analysis) == ""


def test_directive_empty_when_no_slots() -> None:
    """slots 가 비어 있으면 빈 문자열."""
    analysis = EditVisionAnalysis(
        domain="person", intent="x", summary="x", slots={}, fallback=False
    )
    assert _build_matrix_directive_block(analysis) == ""


# ───────── SYSTEM_EDIT 가드 ─────────


def test_system_edit_has_preserve_no_describe_guard() -> None:
    """SYSTEM_EDIT 가 [preserve] 슬롯에 specific description 금지 가이드 포함."""
    # 줄바꿈으로 끊겨도 키워드 검색되도록 공백 정규화
    txt = " ".join(SYSTEM_EDIT.split())
    # 핵심 가드 키워드
    assert "[preserve]" in txt
    assert "NEVER describe" in txt
    assert "generic preservation phrasing" in txt
    # mislead 경고 (이게 왜 위험한지)
    # spec 19 후속: "diffusion model" 메타 단어 → "the model" 로 일반화
    # (사용자 결과 프롬프트에 "diffusion model" 같은 메타 토큰 누출 방지)
    assert "mislead the model" in txt
    # core identity preservation 은 유지
    assert "exact same face" in txt


def test_system_edit_v2_domain_aware_identity_clauses() -> None:
    """spec 19 후속 — SYSTEM_EDIT 가 도메인별 identity clause 분리 + lighting 조건부."""
    txt = SYSTEM_EDIT
    # 도메인별 분기 명시
    assert 'Domain == "person"' in txt
    assert 'Domain == "object_scene"' in txt
    # person clause 핵심 키워드
    assert "exact same face" in txt
    # object_scene clause 핵심 키워드 (사람 단어 없이)
    assert "exact same subject" in txt
    assert "no subject swap" in txt
    # lighting/style 은 conditional 명시
    assert "DO NOT force" in txt
    assert "neon lighting" in txt or "anime style" in txt
    # 길이 가드
    assert "60-200 words" in txt or "Never exceed 250 words" in txt
