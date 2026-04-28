# Multi-Reference Slot Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit 모드 multi-reference 의 권위 충돌 버그 (image2 가 프롬프트에 한 번도 안 나오는 현상) 를 *충돌 해결* 이 아닌 *충돌 회피* 로 수정. reference_role 이 가리키는 슬롯을 image1 매트릭스 directive 에서 *제거* 하고 reference clause 만 단독으로 살린다.

**Architecture:**

- 1차 원인: `_build_matrix_directive_block()` 가 image1 매트릭스의 모든 슬롯을 `[preserve]` 로 고정 → reference clause 의 "image2 로 교체" 지시와 정면 충돌 → gemma4 가 quote 강제력 강한 [preserve] 채택.
- 해결: `reference_role` 매핑 슬롯을 매트릭스 directive 에서 *완전 제거* (action 이 `preserve` 일 때만 — `edit` 면 사용자 instruction 우선이라 제거 X). gemma4 가 그 슬롯에 대해 *침묵* → reference clause 만 살아남음.
- 기존 line 688-701 의 face-only 분기 제거. 4 role 모두 동일한 slot removal 메커니즘으로 통일.
- image2 비전 분석은 **이번 plan 에서 하지 않음** (Phase 2 보류 · 효과 검증 후 결정).

**Tech Stack:** Python 3.13 · FastAPI · pytest · Qwen Image Edit 2511 (ComfyUI) · gemma4-un / qwen2.5vl (Ollama)

**Branch:** `claude/multi-ref-slot-removal` (master 에서 분기)

**Baseline (변경 전):** pytest 267 · vitest 91 · tsc/lint clean

---

## File Map

- **Modify**: `backend/studio/prompt_pipeline.py`
  - `ROLE_TO_SLOTS` 매핑 신규 추가 (167 부근 ROLE_INSTRUCTIONS 옆)
  - `_role_target_slots()` 헬퍼 신규
  - `_build_matrix_directive_block()` 의 line 688-701 face-only 분기 제거 + slot removal 적용 (line 643-721)
- **Modify**: `backend/tests/studio/test_matrix_directive_block.py` — slot removal 케이스 추가 (face/outfit/style/background 4 role)
- **Create**: `backend/tests/studio/test_role_slot_removal.py` — instruction vs role 우선순위 회귀 테스트

---

## Task 1: ROLE_TO_SLOTS 매핑 + `_role_target_slots()` 헬퍼

**Files:**
- Modify: `backend/studio/prompt_pipeline.py:164-200` (ROLE_INSTRUCTIONS 직후)
- Test: `backend/tests/studio/test_role_slot_removal.py` (신규)

- [ ] **Step 1: 변경 전 baseline 검증**

```powershell
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q
```
Expected: PASS · 267 tests

- [ ] **Step 2: 신규 테스트 작성 (실패 확인용)**

`backend/tests/studio/test_role_slot_removal.py` 생성:

```python
"""
ROLE_TO_SLOTS 매핑 + _role_target_slots 헬퍼 단위 테스트.

목표: reference_role → image1 매트릭스에서 제거할 슬롯 키 집합 매핑이
      4 role 모두 일관되게 동작.
"""

from __future__ import annotations

import pytest

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
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```powershell
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_role_slot_removal.py -v
```
Expected: FAIL — `ImportError: cannot import name 'ROLE_TO_SLOTS' from 'studio.prompt_pipeline'`

- [ ] **Step 4: 구현**

`backend/studio/prompt_pipeline.py` 의 `ROLE_INSTRUCTIONS` (line 167) 직후, `build_reference_clause` (line 198) 직전에 다음 추가:

```python
# Multi-reference slot removal 매핑 (2026-04-28).
# reference_role 매핑 슬롯은 image1 매트릭스 directive 에서 *제거* 되어야
# [preserve] 지시와 reference_clause 의 "image2 로 교체" 지시 충돌이 회피된다.
#
# 인물/물체 도메인의 슬롯 이름이 다르므로 background/style 은 두 도메인의
# 의미적으로 동등한 슬롯을 모두 포함 (한쪽만 매칭되어도 안전).
ROLE_TO_SLOTS: dict[str, frozenset[str]] = {
    "face": frozenset({"face_expression"}),
    "outfit": frozenset({"attire"}),
    "background": frozenset({"background", "background_setting"}),
    "style": frozenset({"mood_style"}),
}


def _role_target_slots(reference_role: str | None) -> frozenset[str]:
    """role 문자열 → 매트릭스에서 제거할 슬롯 키 집합.

    - None / 빈 문자열 / 알 수 없는 자유 텍스트: 빈 frozenset
      (자유 텍스트 role 은 어느 슬롯을 가리키는지 불명 → slot removal 미적용)
    - known role (face/outfit/style/background): ROLE_TO_SLOTS 의 정의된 집합
    """
    if not reference_role:
        return frozenset()
    return ROLE_TO_SLOTS.get(reference_role, frozenset())
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```powershell
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_role_slot_removal.py -v
```
Expected: PASS · 8 tests

- [ ] **Step 6: 사용자 승인 후 Commit**

⚠️ 사용자 명시 승인 후만 진행. 무단 commit 금지.

```bash
git checkout -b claude/multi-ref-slot-removal
git add backend/studio/prompt_pipeline.py backend/tests/studio/test_role_slot_removal.py
git commit -m "feat(multi-ref): ROLE_TO_SLOTS 매핑 + _role_target_slots 헬퍼 추가 (Task 1)"
```

---

## Task 2: `_build_matrix_directive_block` 에 slot removal 적용

**Files:**
- Modify: `backend/studio/prompt_pipeline.py:643-721` (_build_matrix_directive_block)
- Modify: `backend/tests/studio/test_matrix_directive_block.py` (slot removal 회귀 추가)

- [ ] **Step 1: 회귀 테스트 추가 — 실패 확인용**

`backend/tests/studio/test_matrix_directive_block.py` 끝에 다음 5개 테스트 추가 (`_make_person_analysis` 헬퍼는 기존 정의 재사용):

```python
# ───────── Multi-reference slot removal 회귀 (2026-04-28) ─────────


def test_background_role_removes_background_slot_when_preserve() -> None:
    """role=background + image1 매트릭스의 background.action=preserve →
    background 슬롯 directive 가 *완전히 제거*.

    핵심 회귀: 사용자가 image2 를 background 로 올렸는데 vision 이
    "사용자가 background 안 건드림" 이라고 preserve 결정한 케이스.
    Slot removal 전엔 [preserve] 지시가 박혀 reference clause 와 충돌.
    """
    analysis = _make_person_analysis()
    # background.action=preserve (헬퍼 기본값)
    directive = _build_matrix_directive_block(analysis, reference_role="background")

    assert "[preserve] background / environment" not in directive
    assert "background / environment" not in directive  # 라벨 자체가 안 나와야


def test_outfit_role_removes_attire_slot_when_preserve() -> None:
    """role=outfit + attire.action=preserve → attire 슬롯 directive 제거.

    헬퍼 기본값 (attire.action=edit) 변경: preserve 케이스 별도 케이스.
    """
    from studio.vision_pipeline import EditSlotEntry

    analysis = _make_person_analysis()
    # attire 를 preserve 로 변경
    analysis.slots["attire"] = EditSlotEntry(
        action="preserve", note="The woman wears a sweater."
    )
    directive = _build_matrix_directive_block(analysis, reference_role="outfit")

    assert "[preserve] attire" not in directive
    assert "[edit] attire" not in directive


def test_role_does_NOT_remove_slot_when_action_is_edit() -> None:
    """role 매핑 슬롯이라도 action=edit 이면 *제거하지 않음*.

    핵심 우선순위 규칙: 사용자 instruction 이 해당 슬롯을 명시적으로
    건드린 경우 (vision 이 [edit] 판정) → user instruction 우선,
    role 무효화 (slot removal 미적용).
    """
    from studio.vision_pipeline import EditSlotEntry

    analysis = _make_person_analysis()
    # background 를 edit 로 변경 (사용자가 명시적으로 건드림)
    analysis.slots["background"] = EditSlotEntry(
        action="edit", note="Make the background dark and stormy."
    )
    directive = _build_matrix_directive_block(analysis, reference_role="background")

    # [edit] directive 가 그대로 살아있어야
    assert "[edit] background" in directive
    assert "Make the background dark and stormy." in directive


def test_face_role_removes_face_expression_slot() -> None:
    """기존 face-only 분기 (line 688-701) 를 일관된 slot removal 메커니즘으로 통일.

    이전: face role → [reference] 로 변환되어 directive 안에 *남아있음*
    이후: face role → face_expression 슬롯이 directive 에서 *제거*
    """
    analysis = _make_person_analysis()
    directive = _build_matrix_directive_block(analysis, reference_role="face")

    assert "[reference] face" not in directive  # 옛 [reference] 라벨 사라짐
    assert "[preserve] face / expression" not in directive  # preserve 도 사라짐
    assert "face / expression" not in directive


def test_unknown_free_text_role_does_NOT_remove_any_slot() -> None:
    """자유 텍스트 role → ROLE_TO_SLOTS 매칭 X → slot removal 미적용.

    모든 슬롯이 정상적으로 directive 에 표시. 자유 텍스트는
    reference_clause 의 fallback 으로만 처리.
    """
    analysis = _make_person_analysis()
    directive = _build_matrix_directive_block(
        analysis, reference_role="hand gesture only"
    )

    # 모든 슬롯이 directive 에 등장 (헬퍼 기본 5 슬롯)
    assert "face / expression" in directive
    assert "hair" in directive
    assert "attire" in directive
    assert "body / pose" in directive
    assert "background / environment" in directive
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```powershell
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_matrix_directive_block.py -v -k "slot_removal or role_does_NOT or face_role_removes or unknown_free_text"
```
Expected: 5 tests FAIL (slot removal 로직 미구현 + 기존 face-only 분기가 [reference] 라벨 출력)

- [ ] **Step 3: 구현 — `_build_matrix_directive_block` 수정**

`backend/studio/prompt_pipeline.py:684-718` (for 루프) 를 다음으로 교체:

```python
    # 2026-04-28 Multi-reference slot removal:
    # role 이 가리키는 슬롯이 매트릭스에서 [preserve] 면 directive 에서 *완전 제거*.
    # action=edit 이면 사용자 instruction 우선 → role 무효화 (제거 X).
    # 옛 face-only 분기 (line 688-701) 도 이 메커니즘으로 일관 처리.
    target_slots = _role_target_slots(reference_role)

    for key, entry in slots.items():
        action = getattr(entry, "action", "preserve")
        note = (getattr(entry, "note", "") or "").strip()
        label = _slot_label(key)
        # role 매핑 슬롯이면서 action=preserve → 제거 (continue)
        # action=edit 이면 user instruction 우선이라 정상 처리
        if key in target_slots and action != "edit":
            continue
        if action == "edit":
            # 변경 의도 — note 가 변경 지시 자체이므로 그대로 명시
            lines.append(f"[edit] {label}")
            lines.append(
                f"  -> APPLY EXACTLY: {note or '(follow user instruction)'}"
            )
        else:
            # 보존 의도 — note 절대 명시 X. generic preservation 만 강제.
            lines.append(f"[preserve] {label} — KEEP IDENTICAL TO SOURCE")
            lines.append(
                "  -> DO NOT describe this slot's specific state in the output."
            )
            lines.append(
                f"  -> Use ONLY generic preservation phrasing: "
                f"\"preserve the original {label} exactly as in the source, "
                f"no change to {label}\"."
            )
```

→ 옛 `if reference_role == "face" and key == "face_expression":` 분기 (line 688-701) 가 *통째로* 제거된다. ROLE_TO_SLOTS 매핑이 face/outfit/style/background 모두 일관되게 처리.

- [ ] **Step 4: 신규 + 기존 테스트 모두 실행**

```powershell
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_matrix_directive_block.py -v
```
Expected: ALL PASS (기존 + 신규 5개 모두)

- [ ] **Step 5: 전체 pytest 회귀 검증**

```powershell
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q
```
Expected: PASS · 272 tests (267 + 신규 5)

⚠️ **face-only 분기 제거** 가 다른 테스트를 깨뜨리는지 특히 주목. 만약 `test_prompt_pipeline.py` 에서 face role + face_expression 슬롯의 [reference] 라벨을 검증하는 테스트가 있다면 *기대값 갱신* 필요 (slot removal 후엔 라벨 자체가 없어짐).

- [ ] **Step 6: 사용자 승인 후 Commit**

```bash
git add backend/studio/prompt_pipeline.py backend/tests/studio/test_matrix_directive_block.py
git commit -m "feat(multi-ref): _build_matrix_directive_block slot removal 적용 (Task 2)"
```

---

## Task 3: `build_reference_clause` 의 directive 강화

**Files:**
- Modify: `backend/studio/prompt_pipeline.py:198-244` (build_reference_clause + ROLE_INSTRUCTIONS)
- Modify: `backend/tests/studio/test_prompt_pipeline.py` (build_reference_clause 회귀 강화)

> **이 Task 의 목적**: slot removal 후 reference_clause 가 *유일한 권위* 가 되므로, gemma4 가 image2 묘사 없이도 명확하게 동작하도록 directive 표현 강화. ROLE_INSTRUCTIONS 의 outfit/style/background 가 face 만큼 strict 하지 않은 점을 보강.

- [ ] **Step 1: 회귀 테스트 추가 — 실패 확인용**

`backend/tests/studio/test_prompt_pipeline.py` 의 적절한 위치 (build_reference_clause 관련 테스트 그룹) 에 다음 추가:

```python
# ───────── Slot removal 후 reference_clause directive 강화 (2026-04-28) ─────────


def test_reference_clause_outfit_explicitly_blocks_image1_outfit_preserve() -> None:
    """outfit role: image1 의 옷을 *보존하지 말라* 는 명시적 directive.

    Slot removal 로 [preserve] attire 가 사라진 상태에서 gemma4 가
    "preserve the original attire" 같은 환각 phrasing 을 생성하지
    않도록 reference_clause 가 그것을 *명시적으로 차단*.
    """
    from studio.prompt_pipeline import build_reference_clause

    clause = build_reference_clause("outfit")
    lower = clause.lower()
    # image2 의 옷을 적용한다는 지시
    assert "image2" in clause
    assert "outfit" in lower or "clothing" in lower or "attire" in lower
    # image1 옷 보존 명시 차단
    assert "do not preserve" in lower or "do not keep" in lower or "replace" in lower


def test_reference_clause_background_explicitly_blocks_image1_background_preserve() -> None:
    """background role: image1 의 배경을 *보존하지 말라* 는 명시적 directive."""
    from studio.prompt_pipeline import build_reference_clause

    clause = build_reference_clause("background")
    lower = clause.lower()
    assert "image2" in clause
    assert "background" in lower or "environment" in lower
    assert "do not preserve" in lower or "replace" in lower


def test_reference_clause_style_explicitly_blocks_image1_style_preserve() -> None:
    """style role: image1 의 톤/조명을 *보존하지 말라* 는 명시적 directive."""
    from studio.prompt_pipeline import build_reference_clause

    clause = build_reference_clause("style")
    lower = clause.lower()
    assert "image2" in clause
    assert "style" in lower or "tone" in lower or "color" in lower or "lighting" in lower
    assert "do not preserve" in lower or "replace" in lower or "match" in lower
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```powershell
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_prompt_pipeline.py -v -k "reference_clause_outfit_explicitly or reference_clause_background_explicitly or reference_clause_style_explicitly"
```
Expected: 3 tests FAIL — 현재 ROLE_INSTRUCTIONS 의 outfit/style/background 가 "do not preserve" / "replace" 같은 명시 phrasing 을 보장하지 않음.

- [ ] **Step 3: 구현 — ROLE_INSTRUCTIONS 강화**

`backend/studio/prompt_pipeline.py:180-194` 를 다음으로 교체:

```python
    "outfit": (
        "Reference image (image2) provides CLOTHING/ACCESSORIES reference. "
        "Apply ONLY the outfit, garments, or accessories from image2 onto the "
        "subject in image1. "
        "Do NOT preserve image1's original clothing — replace it with image2's "
        "outfit. "
        "Keep image1's face, hair, body pose, and background unchanged."
    ),
    "style": (
        "Reference image (image2) provides STYLE REFERENCE — color palette, "
        "lighting tone, and overall mood. "
        "Match these aesthetics on image1 by replacing image1's color tone, "
        "lighting, and atmosphere with image2's. "
        "Do NOT preserve image1's original color grading or lighting; "
        "the final result should adopt image2's visual style. "
        "Keep image1's subject identity, pose, and composition intact."
    ),
    "background": (
        "Reference image (image2) provides BACKGROUND/ENVIRONMENT reference. "
        "Replace image1's background with the environment shown in image2. "
        "Do NOT preserve image1's original background — the final result must "
        "depict the subject of image1 placed within image2's environment. "
        "Keep image1's subject identity, pose, expression, and clothing intact."
    ),
```

`face` role 은 이미 `STRICT FACE-ONLY TRANSFER...` 로 강한 directive 보유. 변경 X.

- [ ] **Step 4: 신규 + 기존 테스트 실행**

```powershell
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_prompt_pipeline.py -v
```
Expected: ALL PASS

- [ ] **Step 5: 전체 pytest 회귀**

```powershell
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q
```
Expected: PASS · 275 tests (272 + 신규 3)

- [ ] **Step 6: 사용자 승인 후 Commit**

```bash
git add backend/studio/prompt_pipeline.py backend/tests/studio/test_prompt_pipeline.py
git commit -m "feat(multi-ref): ROLE_INSTRUCTIONS outfit/style/background directive 강화 (Task 3)"
```

---

## Task 4: 사용자 케이스 통합 회귀 테스트

**Files:**
- Modify: `backend/tests/studio/test_role_slot_removal.py` (Task 1 신규 파일에 통합 케이스 추가)

> **이 Task 의 목적**: 사용자가 발견한 실제 케이스 (`role=background` + `edit_instruction="bra 제거"`) 가 매트릭스 + reference_clause 합성 후 더 이상 "preserve background" phrasing 을 만들지 않는지 *문서화된 회귀* 로 박제.

- [ ] **Step 1: 통합 회귀 테스트 추가**

`backend/tests/studio/test_role_slot_removal.py` 끝에 추가:

```python
# ───────── 사용자 발견 케이스 회귀 (2026-04-28) ─────────
# 사용자 케이스: role=background + edit_instruction="Calvin Klein bra 제거"
# 결과 프롬프트에 image2 가 한 번도 안 나오고 "preserve background" 가 박힘.
# Slot removal 후엔 background 슬롯이 매트릭스에서 사라지고 reference_clause 만 남음.


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


def test_user_case_background_role_removes_preserve_background_directive() -> None:
    """사용자 발견 버그 회귀 — background slot 의 [preserve] directive 가 사라져야."""
    from studio.prompt_pipeline import _build_matrix_directive_block

    analysis = _make_user_case_analysis()
    directive = _build_matrix_directive_block(analysis, reference_role="background")

    # 사용자 보고 결과 프롬프트의 핵심 phrasing 이 매트릭스 directive 에서 사라졌는지
    assert "[preserve] background" not in directive
    assert "preserve the original background" not in directive.lower()
    # attire [edit] 는 그대로 살아있어야 (사용자 instruction)
    assert "[edit] attire" in directive
    assert "Remove the Calvin Klein bra" in directive


def test_user_case_background_role_keeps_other_preserve_slots() -> None:
    """slot removal 은 *role 매핑 슬롯만* 영향. 나머지 preserve 슬롯은 정상 유지."""
    from studio.prompt_pipeline import _build_matrix_directive_block

    analysis = _make_user_case_analysis()
    directive = _build_matrix_directive_block(analysis, reference_role="background")

    # 다른 preserve 슬롯 4개는 그대로 살아있어야
    assert "[preserve] face / expression" in directive
    assert "[preserve] hair" in directive
    assert "[preserve] body / pose" in directive


def test_user_case_full_system_edit_combines_directive_and_clause() -> None:
    """SYSTEM_EDIT + matrix directive + build_reference_clause 합성 후
    image2 reference 지시는 살아있고 background preserve 지시는 사라져야.
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
    # image2 reference 지시 명시
    assert "image2" in full_system
    assert "background" in lower  # reference_clause 의 background 키워드
    assert "do not preserve" in lower or "replace" in lower
```

- [ ] **Step 2: 테스트 실행 — Task 1+2+3 누적 효과 확인**

```powershell
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_role_slot_removal.py -v
```
Expected: ALL PASS · 11 tests (8 + 신규 3)

- [ ] **Step 3: 전체 pytest 회귀**

```powershell
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q
```
Expected: PASS · 278 tests (275 + 신규 3)

- [ ] **Step 4: 사용자 승인 후 Commit**

```bash
git add backend/tests/studio/test_role_slot_removal.py
git commit -m "test(multi-ref): 사용자 발견 background role 케이스 회귀 테스트 (Task 4)"
```

---

## Task 5: 최종 검증 + 머지 준비

- [ ] **Step 1: Frontend 회귀 — 백엔드 schema 변경 없음 확인**

```powershell
cd frontend
npm run gen:types
git diff lib/api/generated.ts
```
Expected: **diff 없음** (이번 plan 은 백엔드 시그니처 변경 X · 내부 로직만)

만약 diff 있으면 — 의도치 않은 schema drift 발생 의미. 원인 분석 필요.

- [ ] **Step 2: Frontend 검증 (회귀 보장)**

```powershell
cd frontend
npm test
npm run lint
npx tsc --noEmit
```
Expected: vitest 91 PASS · lint clean · tsc clean

- [ ] **Step 3: Codex 리뷰 위임**

⚠️ 사용자 명시 승인 후만. 디자인 차원에서 충분히 토론했지만 구현 검증 별도.

`codex:codex-rescue` 에이전트에 다음 요청:

> "Phase 1 (Slot Removal) 구현 완료. master 분기 `claude/multi-ref-slot-removal`. 변경 파일:
> - `backend/studio/prompt_pipeline.py` (ROLE_TO_SLOTS / _role_target_slots 추가, _build_matrix_directive_block slot removal 적용, ROLE_INSTRUCTIONS outfit/style/background 강화, face-only 분기 제거)
> - `backend/tests/studio/test_role_slot_removal.py` (신규 11 tests)
> - `backend/tests/studio/test_matrix_directive_block.py` (신규 5 tests)
> - `backend/tests/studio/test_prompt_pipeline.py` (신규 3 tests)
>
> 검증해줘:
> 1. slot removal 로직이 의도대로 동작하나 (특히 action=edit 우선순위)
> 2. ROLE_INSTRUCTIONS 강화 phrasing 이 LLM 에 잘 전달될 표현인가
> 3. face-only 분기 제거가 기존 face role 동작을 깨지 않았나
> 4. 자유 텍스트 role 의 fallback 안전한가
> 5. 놓친 회귀 케이스 / 결함 있나"

- [ ] **Step 4: Codex 피드백 반영 (있다면)**

🔴 critical / 🟡 important 결함 수정. 🟢 nice-to-have 는 별도 Issue 로.

- [ ] **Step 5: 사용자 명시 승인 후 master merge**

⚠️ 사용자가 "merge" / "master 머지" 명시 요청 시만. 자동 merge 금지.

```bash
git checkout master
git merge --no-ff claude/multi-ref-slot-removal -m "Merge branch 'claude/multi-ref-slot-removal': Multi-reference Phase 1 (Slot Removal)"
git log --oneline -5
```

- [ ] **Step 6: changelog + memory 갱신**

`docs/changelog.md` 에 Phase 1 항목 추가 (어제 reference-library v8 항목 형식 따라).
`C:\Users\pzen\.claude\projects\D--AI-Image-Studio\memory\MEMORY.md` 의 "최신" 섹션 갱신.

- [ ] **Step 7: origin push**

```bash
git push origin master
git status
```
Expected: `Your branch is up to date with 'origin/master'.`

---

## 알려진 한계 (Phase 2 후보)

이 plan 으로 해결되지 않는 것 — 효과 검증 후 별도 plan 작성 여부 결정:

1. **image2 의 *내용*은 텍스트 프롬프트에 안 들어감.** ComfyUI 의 visual conditioning 만 의존. background/style 케이스에서 효과 부족 가능 (face/outfit 은 visual feature 강해서 보통 OK).
2. **자유 텍스트 role 은 slot removal 미적용.** ROLE_TO_SLOTS 에 매핑 없음 → 자유 텍스트는 reference_clause 의 자유 텍스트 fallback 만 동작 (충돌 가능성 잔존). 빈도 낮으면 보류.
3. **사용자 instruction 이 슬롯을 *암묵적으로* 건드리는 케이스.** 예: "분위기를 어둡게" 가 mood_style 로 vision 분석되면 [edit] 라 우선순위 OK. 그러나 vision 이 [preserve] 로 잘못 판정하면 slot removal 트리거 → 의도와 어긋날 수 있음. vision 분석기 정확도에 의존.

→ 효과 부족 확인되면 **Phase 2 = image2 비전 (role=background/style 만)** plan 진행.

---

## 검증 후 baseline (예상)

- pytest: 267 → **278** (+11 신규)
- vitest: 91 → 91 (변경 없음)
- tsc / lint: clean 유지

---

## Self-Review 체크 (작성 후)

✅ Spec coverage: 결함 5개 중 1·2·3·5 가 이 plan 으로 해소 (4 crop 의미론은 별개 plan).
✅ Placeholder scan: TBD/TODO/"appropriate" 없음. 모든 step 에 실제 코드 + 명령.
✅ Type consistency: `ROLE_TO_SLOTS` / `_role_target_slots` / `target_slots` 변수명 일관.
✅ Task 간 의존성: 1 → 2 → 3 → 4 → 5 순차. 각 step 의 commit 으로 부분 진행 가능.
