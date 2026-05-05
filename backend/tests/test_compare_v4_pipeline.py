"""analyze_pair_v4 — 4 stage orchestration + unload 호출 검증."""

from unittest.mock import AsyncMock, patch

import pytest

from studio.compare_pipeline_v4 import analyze_pair_v4
from studio.compare_pipeline_v4._types import CompareAnalysisResultV4


def _fake_observation(label: str) -> dict:
    return {"subjects": [{"broad_visible_appearance": label}]}


def _fake_diff_result() -> CompareAnalysisResultV4:
    return CompareAnalysisResultV4(
        summary_en="diff", summary_ko="",
        common_points_en=[], common_points_ko=[],
        key_differences_en=[], key_differences_ko=[],
        domain_match="person",
        category_diffs={},
        category_scores={},
        key_anchors=[],
        fidelity_score=85,
        transform_prompt_en="", transform_prompt_ko="",
        uncertain_en="", uncertain_ko="",
        observation1=_fake_observation("a"),
        observation2=_fake_observation("b"),
        provider="ollama", fallback=False, analyzed_at=0,
        vision_model="", text_model="gemma4-un:latest",
    )


@pytest.mark.asyncio
async def test_analyze_pair_v4_calls_4_stages_in_order():
    """observe1 → observe2 → diff_synth → translate 순서 + progress callback emit."""
    progress_calls = []

    async def on_progress(stage_type: str) -> None:
        progress_calls.append(stage_type)

    obs1 = _fake_observation("img1")
    obs2 = _fake_observation("img2")

    with patch(
        "studio.compare_pipeline_v4.pipeline.observe_image",
        new=AsyncMock(side_effect=[obs1, obs2]),
    ) as mock_observe, patch(
        "studio.compare_pipeline_v4.pipeline.synthesize_diff",
        new=AsyncMock(return_value=_fake_diff_result()),
    ) as mock_diff, patch(
        "studio.compare_pipeline_v4.pipeline.translate_v4_result",
        new=AsyncMock(side_effect=lambda r, **k: r),
    ) as mock_translate, patch(
        "studio.compare_pipeline_v4.pipeline.unload_model",
        new=AsyncMock(),
    ) as mock_unload:
        result = await analyze_pair_v4(
            image1_bytes=b"\x89PNG_fake1",
            image2_bytes=b"\x89PNG_fake2",
            image1_w=512, image1_h=512,
            image2_w=512, image2_h=512,
            compare_hint="",
            vision_model="qwen3-vl:8b",
            text_model="gemma4-un:latest",
            ollama_url="http://localhost:11434",
            timeout=120.0,
            progress_callback=on_progress,
        )

    # 4 stage emit
    assert progress_calls == ["observe1", "observe2", "diff-synth", "translation"]
    # observe_image 2번
    assert mock_observe.call_count == 2
    # diff_synthesize 1번
    assert mock_diff.call_count == 1
    # translate 1번
    assert mock_translate.call_count == 1
    # unload — observe2 → diff-synth 직전 1번
    assert mock_unload.call_count == 1
    # 결과의 vision_model 채워짐
    assert result.vision_model == "qwen3-vl:8b"


@pytest.mark.asyncio
async def test_analyze_pair_v4_observation_failure_fallback():
    """vision 호출 실패 (빈 dict) → fallback 결과 (HTTP 200 보장)."""
    with patch(
        "studio.compare_pipeline_v4.pipeline.observe_image",
        new=AsyncMock(return_value={}),
    ):
        result = await analyze_pair_v4(
            image1_bytes=b"x", image2_bytes=b"y",
            image1_w=512, image1_h=512, image2_w=512, image2_h=512,
            compare_hint="",
            vision_model="qwen3-vl:8b", text_model="gemma4-un:latest",
            ollama_url="http://localhost:11434", timeout=60.0,
        )

    assert result.fallback is True
    assert result.provider == "fallback"


@pytest.mark.asyncio
async def test_analyze_pair_v4_unload_called_between_observe2_and_diff():
    """순서: observe1 → observe2 → unload → diff_synth → translate."""
    call_order: list[str] = []

    async def fake_observe(*args, **kwargs):
        call_order.append("observe")
        return _fake_observation("x")

    async def fake_unload(*args, **kwargs):
        call_order.append("unload")

    async def fake_diff(*args, **kwargs):
        call_order.append("diff")
        return _fake_diff_result()

    async def fake_translate(r, **kwargs):
        call_order.append("translate")
        return r

    with patch(
        "studio.compare_pipeline_v4.pipeline.observe_image", new=fake_observe,
    ), patch(
        "studio.compare_pipeline_v4.pipeline.unload_model", new=fake_unload,
    ), patch(
        "studio.compare_pipeline_v4.pipeline.synthesize_diff", new=fake_diff,
    ), patch(
        "studio.compare_pipeline_v4.pipeline.translate_v4_result", new=fake_translate,
    ):
        await analyze_pair_v4(
            image1_bytes=b"x", image2_bytes=b"y",
            image1_w=512, image1_h=512, image2_w=512, image2_h=512,
            compare_hint="",
            vision_model="qwen3-vl:8b", text_model="gemma4-un:latest",
            ollama_url="http://localhost:11434", timeout=60.0,
        )

    assert call_order == ["observe", "observe", "unload", "diff", "translate"]
