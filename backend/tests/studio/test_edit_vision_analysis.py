"""
analyze_edit_source v2 (slot matrix) + clarify_edit_intent + run_vision_pipeline
테스트 — spec 15장 패러다임 전환 적용.

스코프:
  - EDIT_VISION_ANALYSIS_SYSTEM 의 핵심 키 검증
  - clarify_edit_intent 정상 / 빈 입력 / 예외 폴백
  - analyze_edit_source 인물 모드 / 물체·풍경 모드 / 슬롯 누락 보정
  - 비전 호출 실패 / malformed JSON / domain 불명 폴백
  - to_dict camelCase / compact_context 형식 / human_summary
  - run_vision_pipeline 매트릭스 성공 → upgrade 압축 문자열 전달
  - run_vision_pipeline 매트릭스 실패 → 캡션 폴백 유지

실 네트워크 호출 없음 — 외부 의존성은 AsyncMock 으로 치환.
"""

from __future__ import annotations

import asyncio
import io
import json
from unittest.mock import AsyncMock, patch

from PIL import Image

from studio.prompt_pipeline import (
    SYSTEM_CLARIFY_INTENT,
    UpgradeResult,
    clarify_edit_intent,
)
from studio.vision_pipeline import (
    EDIT_VISION_ANALYSIS_SYSTEM,
    OBJECT_SCENE_SLOTS,
    PERSON_SLOTS,
    EditVisionAnalysis,
    analyze_edit_source,
    run_vision_pipeline,
)


def _tiny_png_bytes() -> bytes:
    """테스트용 2×2 PNG 바이트."""
    buf = io.BytesIO()
    Image.new("RGB", (2, 2), color=(100, 150, 200)).save(buf, "PNG")
    return buf.getvalue()


def _person_json() -> str:
    """인물 도메인 정상 응답 샘플."""
    return json.dumps({
        "domain": "person",
        "summary": "A young woman in a black outfit standing in a park at golden hour.",
        "slots": {
            "face_expression": {
                "action": "preserve",
                "note": "keep identity, soft smile, brown hair",
            },
            "hair": {
                "action": "preserve",
                "note": "same long brown hair",
            },
            "attire": {
                "action": "edit",
                "note": "remove top and bottom (full nude)",
            },
            "body_pose": {
                "action": "edit",
                "note": "increase bust to natural sagging E-cup, keep pose",
            },
            "background": {
                "action": "preserve",
                "note": "same park scene and lighting",
            },
        },
    })


def _object_scene_json() -> str:
    """물체·풍경 도메인 정상 응답 샘플."""
    return json.dumps({
        "domain": "object_scene",
        "summary": "A red ceramic mug on a wooden table near a window.",
        "slots": {
            "subject": {
                "action": "preserve",
                "note": "same red ceramic mug shape and size",
            },
            "color_material": {
                "action": "edit",
                "note": "change mug color from red to deep blue, matte finish",
            },
            "layout_composition": {
                "action": "preserve",
                "note": "centered on table, same camera angle",
            },
            "background_setting": {
                "action": "preserve",
                "note": "same wooden surface and window light",
            },
            "mood_style": {
                "action": "preserve",
                "note": "warm cozy atmosphere",
            },
        },
    })


# ───────── 상수 검증 ─────────


def test_edit_vision_analysis_system_has_core_cues() -> None:
    """v2 SYSTEM 프롬프트가 핵심 키 (domain / slots / action / 5 슬롯 키) 포함."""
    txt = EDIT_VISION_ANALYSIS_SYSTEM
    assert "{edit_intent}" in txt
    assert "domain" in txt
    assert "slots" in txt
    assert "edit|preserve" in txt
    # 인물 모드 슬롯
    for k in PERSON_SLOTS:
        assert k in txt
    # 물체·풍경 모드 슬롯
    for k in OBJECT_SCENE_SLOTS:
        assert k in txt
    assert "STRICT JSON" in txt


def test_system_clarify_intent_has_core_cues() -> None:
    """clarify SYSTEM 프롬프트가 핵심 가이드 포함."""
    txt = SYSTEM_CLARIFY_INTENT
    assert "1-2 sentences" in txt or "60 words" in txt
    assert "imperative" in txt.lower()
    assert "preserv" in txt.lower()


# ───────── clarify_edit_intent ─────────


def test_clarify_intent_happy_path() -> None:
    """정상 호출 → gemma4 정제 결과 반환."""
    expected = "Remove top and bottom clothing entirely. Resize the bust to a natural sagging E-cup. Keep everything else unchanged."
    with patch(
        "studio.prompt_pipeline._call_ollama_chat",
        new=AsyncMock(return_value=expected),
    ):
        result = asyncio.run(
            clarify_edit_intent("상의 하의 완전 노출, 가슴 E컵으로 변경, 그 외 유지")
        )
    assert result == expected


def test_clarify_intent_empty_input_returns_empty() -> None:
    """빈 입력은 호출 없이 빈 문자열 반환."""
    call_mock = AsyncMock(return_value="should not be called")
    with patch("studio.prompt_pipeline._call_ollama_chat", new=call_mock):
        result = asyncio.run(clarify_edit_intent(""))
    assert result == ""
    call_mock.assert_not_called()


def test_clarify_intent_falls_back_on_exception() -> None:
    """ollama 호출 예외 시 원문 그대로 폴백."""
    raw_input = "make it nicer"
    with patch(
        "studio.prompt_pipeline._call_ollama_chat",
        new=AsyncMock(side_effect=RuntimeError("ollama down")),
    ):
        result = asyncio.run(clarify_edit_intent(raw_input))
    assert result == raw_input


def test_clarify_intent_falls_back_on_empty_response() -> None:
    """ollama 응답이 빈 문자열이면 원문 폴백."""
    raw_input = "change something"
    with patch(
        "studio.prompt_pipeline._call_ollama_chat",
        new=AsyncMock(return_value=""),
    ):
        result = asyncio.run(clarify_edit_intent(raw_input))
    assert result == raw_input


# ───────── analyze_edit_source 정상 경로 ─────────


def test_analyze_edit_source_person_domain() -> None:
    """인물 모드 정상 응답 → domain=person, slots 5개 모두 채워짐."""
    with (
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value=_person_json()),
        ),
        # clarify_edit_intent 도 stub (외부 호출 막기)
        patch(
            "studio.prompt_pipeline.clarify_edit_intent",
            new=AsyncMock(return_value="refined intent text"),
        ),
    ):
        result: EditVisionAnalysis = asyncio.run(
            analyze_edit_source(_tiny_png_bytes(), "상의 하의 누드, E컵")
        )
    assert result.fallback is False
    assert result.provider == "ollama"
    assert result.domain == "person"
    assert result.intent == "refined intent text"
    assert result.summary.startswith("A young woman")
    # 슬롯 5개 모두 존재
    for key in PERSON_SLOTS:
        assert key in result.slots
        assert result.slots[key].action in ("edit", "preserve")
    # action 분류 검증
    assert result.slots["face_expression"].action == "preserve"
    assert result.slots["attire"].action == "edit"
    assert "remove top" in result.slots["attire"].note.lower()
    assert result.slots["body_pose"].action == "edit"
    assert "e-cup" in result.slots["body_pose"].note.lower()


def test_analyze_edit_source_object_scene_domain() -> None:
    """물체·풍경 모드 정상 응답 → domain=object_scene, 다른 슬롯 키 셋."""
    with (
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value=_object_scene_json()),
        ),
        patch(
            "studio.prompt_pipeline.clarify_edit_intent",
            new=AsyncMock(return_value="Change mug color to deep blue."),
        ),
    ):
        result = asyncio.run(
            analyze_edit_source(_tiny_png_bytes(), "머그컵 색을 파랑으로")
        )
    assert result.domain == "object_scene"
    for key in OBJECT_SCENE_SLOTS:
        assert key in result.slots
    # 인물 모드 키는 없어야 함 (도메인 분리 검증)
    for key in PERSON_SLOTS:
        if key not in OBJECT_SCENE_SLOTS:
            assert key not in result.slots
    assert result.slots["color_material"].action == "edit"
    assert "deep blue" in result.slots["color_material"].note.lower()


def test_analyze_edit_source_uses_provided_refined_intent() -> None:
    """refined_intent 인자가 주어지면 clarify_edit_intent 재호출 없음."""
    clarify_mock = AsyncMock(return_value="should not be called")
    with (
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value=_person_json()),
        ),
        patch("studio.prompt_pipeline.clarify_edit_intent", new=clarify_mock),
    ):
        result = asyncio.run(
            analyze_edit_source(
                _tiny_png_bytes(),
                "원문 지시",
                refined_intent="Pre-refined English intent.",
            )
        )
    assert result.intent == "Pre-refined English intent."
    clarify_mock.assert_not_called()


# ───────── analyze_edit_source 폴백 경로 ─────────


def test_analyze_edit_source_vision_fail_fallback_shape() -> None:
    """비전 호출 빈 응답 → fallback=True, slots 5개 모두 preserve+빈 note."""
    with (
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value=""),
        ),
        patch(
            "studio.prompt_pipeline.clarify_edit_intent",
            new=AsyncMock(return_value="refined"),
        ),
    ):
        result = asyncio.run(
            analyze_edit_source(_tiny_png_bytes(), "anything")
        )
    assert result.fallback is True
    assert result.provider == "fallback"
    # 폴백 도메인은 object_scene 기본
    assert result.domain == "object_scene"
    assert len(result.slots) == 5
    for key in OBJECT_SCENE_SLOTS:
        assert key in result.slots
        assert result.slots[key].action == "preserve"
        assert result.slots[key].note == ""
    assert "unavailable" in result.summary.lower()


def test_analyze_edit_source_malformed_json_fallback() -> None:
    """JSON 깨진 응답 → fallback + 5 슬롯 빈 매트릭스."""
    with (
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value="{invalid not json"),
        ),
        patch(
            "studio.prompt_pipeline.clarify_edit_intent",
            new=AsyncMock(return_value="refined"),
        ),
    ):
        result = asyncio.run(
            analyze_edit_source(_tiny_png_bytes(), "anything")
        )
    assert result.fallback is True
    assert "parse" in result.summary.lower()
    assert len(result.slots) == 5


def test_analyze_edit_source_unknown_domain_normalizes_to_object_scene() -> None:
    """domain 키가 알 수 없는 값이면 object_scene 으로 정규화."""
    payload = json.dumps({
        "domain": "alien",  # 무효
        "summary": "Some image.",
        "slots": {
            "subject": {"action": "edit", "note": "x"},
            "color_material": {"action": "preserve", "note": "y"},
            "layout_composition": {"action": "preserve", "note": "z"},
            "background_setting": {"action": "preserve", "note": "a"},
            "mood_style": {"action": "preserve", "note": "b"},
        },
    })
    with (
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value=payload),
        ),
        patch(
            "studio.prompt_pipeline.clarify_edit_intent",
            new=AsyncMock(return_value="r"),
        ),
    ):
        result = asyncio.run(
            analyze_edit_source(_tiny_png_bytes(), "x")
        )
    assert result.domain == "object_scene"
    assert result.fallback is False
    assert result.slots["subject"].action == "edit"


def test_analyze_edit_source_missing_slots_filled_with_preserve_default() -> None:
    """일부 슬롯만 있는 응답 → 누락 슬롯은 action=preserve+빈 note 로 보정."""
    payload = json.dumps({
        "domain": "person",
        "summary": "A man in a suit.",
        "slots": {
            "attire": {"action": "edit", "note": "change suit color to blue"},
            # face_expression / hair / body_pose / background 누락
        },
    })
    with (
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value=payload),
        ),
        patch(
            "studio.prompt_pipeline.clarify_edit_intent",
            new=AsyncMock(return_value="r"),
        ),
    ):
        result = asyncio.run(
            analyze_edit_source(_tiny_png_bytes(), "x")
        )
    assert result.fallback is False
    # 5개 모두 존재
    for key in PERSON_SLOTS:
        assert key in result.slots
    assert result.slots["attire"].action == "edit"
    # 누락된 슬롯은 preserve + 빈 note
    assert result.slots["face_expression"].action == "preserve"
    assert result.slots["face_expression"].note == ""


def test_analyze_edit_source_invalid_action_normalizes_to_preserve() -> None:
    """action 이 알 수 없는 값이면 preserve 로 정규화."""
    payload = json.dumps({
        "domain": "person",
        "summary": "x",
        "slots": {
            "face_expression": {"action": "modify", "note": "n"},  # 무효
            "hair": {"action": "preserve", "note": "n"},
            "attire": {"action": "edit", "note": "n"},
            "body_pose": {"action": "preserve", "note": "n"},
            "background": {"action": "preserve", "note": "n"},
        },
    })
    with (
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value=payload),
        ),
        patch(
            "studio.prompt_pipeline.clarify_edit_intent",
            new=AsyncMock(return_value="r"),
        ),
    ):
        result = asyncio.run(
            analyze_edit_source(_tiny_png_bytes(), "x")
        )
    assert result.slots["face_expression"].action == "preserve"
    assert result.slots["attire"].action == "edit"


# ───────── 직렬화 / 헬퍼 ─────────


def test_to_dict_camelcase_for_frontend() -> None:
    """to_dict() 가 프론트 타입과 맞춘 형식 — slots 보존, analyzedAt camelCase."""
    with (
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value=_person_json()),
        ),
        patch(
            "studio.prompt_pipeline.clarify_edit_intent",
            new=AsyncMock(return_value="r"),
        ),
    ):
        result = asyncio.run(
            analyze_edit_source(_tiny_png_bytes(), "x")
        )
    d = result.to_dict()
    assert d["domain"] == "person"
    assert d["intent"] == "r"
    assert "slots" in d
    assert d["slots"]["attire"]["action"] == "edit"
    assert d["slots"]["attire"]["note"]
    # 메타 camelCase
    assert "analyzedAt" in d
    assert "visionModel" in d
    assert d["fallback"] is False


def test_compact_context_lists_all_slots_in_order() -> None:
    """compact_context() 가 도메인 슬롯 순서대로 5줄 + intent + summary 포함."""
    with (
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value=_person_json()),
        ),
        patch(
            "studio.prompt_pipeline.clarify_edit_intent",
            new=AsyncMock(return_value="Test intent."),
        ),
    ):
        result = asyncio.run(
            analyze_edit_source(_tiny_png_bytes(), "x")
        )
    ctx = result.compact_context()
    assert "Source image analysis (person):" in ctx
    assert "Intent: Test intent." in ctx
    assert "Summary: A young woman" in ctx
    # 모든 인물 슬롯 키 등장 (순서)
    for key in PERSON_SLOTS:
        assert f"- {key} [" in ctx
    # action 표기
    assert "[edit]" in ctx
    assert "[preserve]" in ctx


def test_compact_context_skips_preserve_slot_notes_spec19() -> None:
    """spec 19 (Codex #2): preserve 슬롯의 specific note 는 절대 출력 X.

    이전엔 preserve 슬롯 note (예: "soft smile, brown hair") 가 그대로
    [Image description] 블록에 흘러서 gemma4 가 변경 지시로 오해할 위험
    있었음. 이제 preserve 는 generic 마커 ("(preserved — keep as-is)") 로
    대체. edit 슬롯 note 는 변경 지시 자체이므로 그대로 명시.
    """
    with (
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value=_person_json()),
        ),
        patch(
            "studio.prompt_pipeline.clarify_edit_intent",
            new=AsyncMock(return_value="Test intent."),
        ),
    ):
        result = asyncio.run(
            analyze_edit_source(_tiny_png_bytes(), "x")
        )
    ctx = result.compact_context()

    # _person_json() 의 preserve 슬롯 specific notes 가 ctx 에 있으면 안 됨
    preserve_specific_notes = [
        "keep identity, soft smile, brown hair",  # face_expression note
        "same long brown hair",                    # hair note
        "same park scene and lighting",            # background note
    ]
    for note in preserve_specific_notes:
        assert note not in ctx, (
            f"preserve 슬롯 note '{note}' 가 compact_context 에 누출됨 "
            f"(spec 19 가드 위반)"
        )

    # edit 슬롯 note 는 그대로 명시되어야 함 (변경 지시 자체)
    assert "remove top and bottom (full nude)" in ctx
    assert "increase bust to natural sagging E-cup" in ctx

    # preserve 마커 존재 확인 (slot label 만 보존)
    assert "(preserved" in ctx


def test_human_summary_returns_summary_or_intent() -> None:
    """human_summary() 는 summary 우선, 없으면 intent."""
    with (
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value=_person_json()),
        ),
        patch(
            "studio.prompt_pipeline.clarify_edit_intent",
            new=AsyncMock(return_value="intent only"),
        ),
    ):
        result = asyncio.run(
            analyze_edit_source(_tiny_png_bytes(), "x")
        )
    # summary 가 있으면 summary 반환
    assert result.human_summary() == result.summary

    # summary 비어있을 때 intent 폴백
    result2 = EditVisionAnalysis(intent="fallback intent", summary="")
    assert result2.human_summary() == "fallback intent"


# ───────── run_vision_pipeline 통합 ─────────


def _fake_upgrade(captured: dict[str, str]):
    """upgrade_edit_prompt 를 치환하는 AsyncMock — 인자 capture."""

    async def _inner(
        edit_instruction: str,
        image_description: str,
        **_kwargs: object,
    ) -> UpgradeResult:
        captured["edit_instruction"] = edit_instruction
        captured["image_description"] = image_description
        return UpgradeResult(
            upgraded="a final test prompt",
            fallback=False,
            provider="ollama",
            original=edit_instruction,
            translation="최종 테스트 프롬프트",
        )

    return _inner


def test_run_vision_pipeline_passes_compact_context_when_matrix_ok() -> None:
    """매트릭스 분석 성공 → upgrade 의 image_description 에 정제 intent + 압축 컨텍스트."""
    captured: dict[str, str] = {}
    with (
        patch(
            "studio.prompt_pipeline.clarify_edit_intent",
            new=AsyncMock(return_value="Refined English intent."),
        ),
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value=_person_json()),
        ),
        patch(
            "studio.vision_pipeline.edit_source.upgrade_edit_prompt",
            new=_fake_upgrade(captured),
        ),
        patch(
            "studio.vision_pipeline._common._describe_image",
            new=AsyncMock(return_value="(should not be called)"),
        ) as describe_spy,
    ):
        result = asyncio.run(
            run_vision_pipeline(_tiny_png_bytes(), "상의 누드")
        )
    # upgrade 입력에 정제 intent + 매트릭스 컨텍스트 둘 다 포함
    assert "Refined English intent." in captured["image_description"]
    assert "Source image analysis (person):" in captured["image_description"]
    # 사용자 표시용 description 은 summary
    assert result.image_description.startswith("A young woman")
    assert result.edit_vision_analysis is not None
    assert result.edit_vision_analysis.fallback is False
    assert result.edit_vision_analysis.intent == "Refined English intent."
    describe_spy.assert_not_called()


def test_run_vision_pipeline_unloads_models_between_stages_spec19() -> None:
    """spec 19 옵션 B — 단계별 unload 호출 순서 검증.

    기대 흐름:
      clarify (gemma4) → unload(gemma4) → analyze (qwen2.5vl)
      → unload(qwen2.5vl) → upgrade (gemma4)

    이전엔 두 모델 동시 점유로 16GB VRAM swap 발생 → ComfyUI 가 swap 모드로
    이어받음 → sampling 매우 느림. 이제 단계 전환마다 명시적 unload + 1초 대기로
    swap 차단.
    """
    captured: dict[str, str] = {}
    unload_calls: list[str] = []

    async def _spy_unload(model: str, **_kwargs):
        unload_calls.append(model)
        return True

    # asyncio.sleep 도 mock — 테스트 시간 단축 (1초 대기 X 2 = 2초 절약)
    async def _no_sleep(_sec):
        return None

    with (
        patch(
            "studio.prompt_pipeline.clarify_edit_intent",
            new=AsyncMock(return_value="intent"),
        ),
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value=_person_json()),
        ),
        patch(
            "studio.vision_pipeline.edit_source.upgrade_edit_prompt",
            new=_fake_upgrade(captured),
        ),
        patch(
            "studio.ollama_unload.unload_model",
            new=_spy_unload,
        ),
        patch(
            "studio.vision_pipeline.edit_source.asyncio.sleep",
            new=_no_sleep,
        ),
    ):
        asyncio.run(
            run_vision_pipeline(
                _tiny_png_bytes(),
                "옷 바꿔",
                vision_model="qwen2.5vl:7b",
                text_model="gemma4-un:latest",
            )
        )

    # 호출 순서: gemma4 (clarify 후) → qwen2.5vl (analyze 후)
    assert unload_calls == ["gemma4-un:latest", "qwen2.5vl:7b"], (
        f"단계별 unload 순서 불일치 (예상: gemma4 → qwen / 실제: {unload_calls})"
    )


def test_run_vision_pipeline_falls_back_to_caption_when_matrix_fails() -> None:
    """비전 매트릭스 실패 → 기존 _describe_image 캡션 폴백 동작 유지."""
    captured: dict[str, str] = {}
    with (
        patch(
            "studio.prompt_pipeline.clarify_edit_intent",
            new=AsyncMock(return_value="Refined."),
        ),
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value=""),  # 매트릭스 실패
        ),
        patch(
            "studio.vision_pipeline._common._describe_image",
            new=AsyncMock(return_value="A short caption."),
        ),
        patch(
            "studio.vision_pipeline.edit_source.upgrade_edit_prompt",
            new=_fake_upgrade(captured),
        ),
    ):
        result = asyncio.run(
            run_vision_pipeline(_tiny_png_bytes(), "do something")
        )
    # upgrade 에 캡션이 들어감 (정제 intent 도 함께)
    assert "A short caption." in captured["image_description"]
    assert "Refined." in captured["image_description"]
    assert result.image_description == "A short caption."
    assert result.edit_vision_analysis is not None
    assert result.edit_vision_analysis.fallback is True
    assert result.vision_ok is True


def test_run_vision_pipeline_unavailable_when_both_fail() -> None:
    """매트릭스 + 캡션 모두 실패 → '(vision unavailable)' + vision_ok=False."""
    captured: dict[str, str] = {}
    with (
        patch(
            "studio.prompt_pipeline.clarify_edit_intent",
            new=AsyncMock(return_value=""),
        ),
        patch(
            "studio.vision_pipeline.edit_source._call_vision_edit_source",
            new=AsyncMock(return_value=""),
        ),
        patch(
            "studio.vision_pipeline._common._describe_image",
            new=AsyncMock(return_value=""),
        ),
        patch(
            "studio.vision_pipeline.edit_source.upgrade_edit_prompt",
            new=_fake_upgrade(captured),
        ),
    ):
        result = asyncio.run(
            run_vision_pipeline(_tiny_png_bytes(), "do something")
        )
    assert "unavailable" in result.image_description.lower()
    assert result.vision_ok is False
