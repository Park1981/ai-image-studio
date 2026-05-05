"""compare-analyze pipeline 의 persist context 분기 (compare 휘발 / edit 저장).

Task 11 (Vision Compare 재설계 Phase 3):
  - context='compare' → analyze_pair_v4 호출 + 5 stage emit + persist 차단 (휘발)
  - context='edit' (default) → 옛 analyze_pair v3 + DB persist (무변경)

3 케이스:
  1) compare context — update_comparison 호출 0회, done.saved=False
  2) edit context — analyze_pair v3 호출 + update_comparison 1회 (옛 동작 유지)
  3) compare context — 5 stage emit 검증 (compare-encoding + observe1/2 + diff-synth + translation)
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from studio.compare_pipeline_v4._types import CompareAnalysisResultV4
from studio.pipelines.compare_analyze import _run_compare_analyze_pipeline


def _fake_v4_result() -> CompareAnalysisResultV4:
    """V4 dataclass 의 빈 인스턴스 (mock 반환용)."""
    return CompareAnalysisResultV4(
        summary_en="",
        summary_ko="",
        common_points_en=[],
        common_points_ko=[],
        key_differences_en=[],
        key_differences_ko=[],
        domain_match="person",
        category_diffs={},
        category_scores={},
        key_anchors=[],
        fidelity_score=None,
        transform_prompt_en="",
        transform_prompt_ko="",
        uncertain_en="",
        uncertain_ko="",
        observation1={},
        observation2={},
        provider="ollama",
        fallback=False,
        analyzed_at=0,
        vision_model="qwen3-vl:8b",
        text_model="gemma4-un:latest",
    )


def _make_v4_with_stage_callback():
    """analyze_pair_v4 mock — progress_callback 으로 4 stage emit 후 결과 반환.

    실 V4 pipeline 이 progress_callback 으로 observe1/2 + diff-synth + translation 을
    emit 하는 동작을 시뮬레이션. test 3 의 5 stage 검증 가능.
    """

    async def _fake(*args, progress_callback=None, **kwargs):
        if progress_callback is not None:
            await progress_callback("observe1")
            await progress_callback("observe2")
            await progress_callback("diff-synth")
            await progress_callback("translation")
        return _fake_v4_result()

    return _fake


@pytest.mark.asyncio
async def test_compare_context_does_not_persist_to_db() -> None:
    """context='compare' — update_comparison 호출 안 함 (휘발 정책)."""
    task = MagicMock()
    task.emit = AsyncMock()
    task.close = AsyncMock()

    with patch(
        "studio.pipelines.compare_analyze.analyze_pair_v4",
        new=_make_v4_with_stage_callback(),
    ), patch(
        "studio.pipelines.compare_analyze.history_db.update_comparison",
        new=AsyncMock(return_value=True),
    ) as mock_update:
        await _run_compare_analyze_pipeline(
            task,
            source_bytes=b"x",
            result_bytes=b"y",
            source_w=512,
            source_h=512,
            result_w=512,
            result_h=512,
            context="compare",
            edit_prompt="",
            compare_hint="",
            history_item_id_raw="gen-12345678",  # HISTORY_ID_RE 매치 (8자리 hex) — 매치되지만 compare 라 무시
            vision_override="qwen3-vl:8b",
            text_override="gemma4-un:latest",
        )

    assert mock_update.call_count == 0  # compare context — DB 저장 호출 X

    # done event 의 saved=False
    done_calls = [
        c for c in task.emit.call_args_list if c.args[0] == "done"
    ]
    assert len(done_calls) == 1
    assert done_calls[0].args[1]["saved"] is False


@pytest.mark.asyncio
async def test_edit_context_persists_to_db() -> None:
    """context='edit' (default) — update_comparison 호출 (옛 동작 유지)."""
    task = MagicMock()
    task.emit = AsyncMock()
    task.close = AsyncMock()

    fake_v3_result = MagicMock()
    fake_v3_result.to_dict = MagicMock(return_value={"some": "v3 data"})
    fake_v3_result.overall = 88
    fake_v3_result.summary_en = ""
    fake_v3_result.summary_ko = ""
    fake_v3_result.provider = "ollama"
    fake_v3_result.fallback = False

    with patch(
        "studio.pipelines.compare_analyze.analyze_pair",
        new=AsyncMock(return_value=fake_v3_result),
    ), patch(
        "studio.pipelines.compare_analyze.history_db.update_comparison",
        new=AsyncMock(return_value=True),
    ) as mock_update, patch(
        "studio.pipelines.compare_analyze.clarify_edit_intent",
        new=AsyncMock(return_value="brighter scene"),
    ):
        await _run_compare_analyze_pipeline(
            task,
            source_bytes=b"x",
            result_bytes=b"y",
            source_w=512,
            source_h=512,
            result_w=512,
            result_h=512,
            context="edit",
            edit_prompt="brighten",
            compare_hint="",
            history_item_id_raw="edit-aaaaaaaa",  # HISTORY_ID_RE 매치 (8자리 hex)
            vision_override="qwen2.5vl:7b",
            text_override="gemma4-un:latest",
        )

    assert mock_update.call_count == 1


@pytest.mark.asyncio
async def test_compare_context_emits_v4_stages() -> None:
    """context='compare' — 5 stage emit (compare-encoding + observe1/2 + diff-synth + translation)."""
    task = MagicMock()
    task.emit = AsyncMock()
    task.close = AsyncMock()

    with patch(
        "studio.pipelines.compare_analyze.analyze_pair_v4",
        new=_make_v4_with_stage_callback(),
    ):
        await _run_compare_analyze_pipeline(
            task,
            source_bytes=b"x",
            result_bytes=b"y",
            source_w=512,
            source_h=512,
            result_w=512,
            result_h=512,
            context="compare",
            edit_prompt="",
            compare_hint="",
            history_item_id_raw=None,
            vision_override="qwen3-vl:8b",
            text_override="gemma4-un:latest",
        )

    stage_types = [
        c.args[1]["type"]
        for c in task.emit.call_args_list
        if c.args[0] == "stage"
    ]
    # compare-encoding (pipeline emit) + observe1/2 + diff-synth + translation (analyze_pair_v4 callback forward)
    assert "compare-encoding" in stage_types
    assert "observe1" in stage_types
    assert "observe2" in stage_types
    assert "diff-synth" in stage_types
    assert "translation" in stage_types
