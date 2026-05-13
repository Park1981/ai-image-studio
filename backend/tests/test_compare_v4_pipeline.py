"""analyze_pair_v4 — pair vision 중심 orchestration + unload + fallback 검증.

mock.patch 사이트 (🔴 CLAUDE.md critical · spec §9.1):
  - 모두 lookup 모듈 = `studio.compare_pipeline_v4.pipeline.*`
  - __init__.py re-export 에 patch 금지 (caller 가 직접 import 한 객체와 다름)
"""

from unittest.mock import AsyncMock, patch

import pytest

from studio.compare_pipeline_v4 import analyze_pair_v4
from studio.compare_pipeline_v4._types import CompareAnalysisResultV4


def _fake_observation(label: str) -> dict:
    return {"subjects": [{"broad_visible_appearance": label}]}


def _fake_v4_result(*, fallback: bool = False, vision_model: str = "qwen3-vl:8b") -> CompareAnalysisResultV4:
    """compare_pair_with_vision 또는 synthesize_diff 가 돌려주는 모양."""
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
        provider="fallback" if fallback else "ollama",
        fallback=fallback,
        analyzed_at=0,
        vision_model=vision_model,
        text_model="gemma4-un:latest",
    )


@pytest.mark.asyncio
async def test_analyze_pair_v4_calls_4_stages_in_order():
    """observe1 → observe2 → pair-compare → translation 순서 + progress callback emit."""
    progress_calls = []

    async def on_progress(stage_type: str) -> None:
        progress_calls.append(stage_type)

    obs1 = _fake_observation("img1")
    obs2 = _fake_observation("img2")

    with patch(
        "studio.compare_pipeline_v4.pipeline.observe_image",
        new=AsyncMock(side_effect=[obs1, obs2]),
    ) as mock_observe, patch(
        "studio.compare_pipeline_v4.pipeline.compare_pair_with_vision",
        new=AsyncMock(return_value=_fake_v4_result()),
    ) as mock_pair, patch(
        "studio.compare_pipeline_v4.pipeline.synthesize_diff",
        new=AsyncMock(return_value=_fake_v4_result()),
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

    # 4 stage emit (spec §4.1 — diff-synth 사라지고 pair-compare 추가)
    assert progress_calls == ["observe1", "observe2", "pair-compare", "translation"]
    # observe_image 2번
    assert mock_observe.call_count == 2
    # pair-compare 1번 (정상 path)
    assert mock_pair.call_count == 1
    # synthesize_diff 호출되지 않음 (pair 정상 path)
    assert mock_diff.call_count == 0
    # translate 1번
    assert mock_translate.call_count == 1
    # unload — pair-compare 후 1회만 (spec §4.1.1 박제)
    assert mock_unload.call_count == 1
    # 결과 (compare_pair_with_vision 이 vision_model 함수 내부에서 채움)
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
async def test_analyze_pair_v4_unload_after_pair_compare_not_before():
    """순서: observe1 → observe2 → pair-compare → unload → translate.

    pair-compare 도 vision 호출 → observe2 직후가 아닌 pair 후 unload (spec §4.1.1).
    """
    call_order: list[str] = []

    async def fake_observe(*args, **kwargs):
        call_order.append("observe")
        return _fake_observation("x")

    async def fake_pair(*args, **kwargs):
        call_order.append("pair-compare")
        return _fake_v4_result()

    async def fake_unload(*args, **kwargs):
        call_order.append("unload")

    async def fake_translate(r, **kwargs):
        call_order.append("translate")
        return r

    with patch(
        "studio.compare_pipeline_v4.pipeline.observe_image", new=fake_observe,
    ), patch(
        "studio.compare_pipeline_v4.pipeline.compare_pair_with_vision", new=fake_pair,
    ), patch(
        "studio.compare_pipeline_v4.pipeline.unload_model", new=fake_unload,
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

    assert call_order == ["observe", "observe", "pair-compare", "unload", "translate"]


@pytest.mark.asyncio
async def test_pair_fallback_triggers_synthesize_diff_backup():
    """pair-compare 가 fallback 돌려주면 synthesize_diff 가 백업 호출됨 (spec §7.3)."""
    obs1 = _fake_observation("img1")
    obs2 = _fake_observation("img2")

    with patch(
        "studio.compare_pipeline_v4.pipeline.observe_image",
        new=AsyncMock(side_effect=[obs1, obs2]),
    ), patch(
        "studio.compare_pipeline_v4.pipeline.compare_pair_with_vision",
        new=AsyncMock(return_value=_fake_v4_result(fallback=True)),
    ) as mock_pair, patch(
        "studio.compare_pipeline_v4.pipeline.synthesize_diff",
        new=AsyncMock(return_value=_fake_v4_result(fallback=False, vision_model="")),
    ) as mock_diff, patch(
        "studio.compare_pipeline_v4.pipeline.translate_v4_result",
        new=AsyncMock(side_effect=lambda r, **k: r),
    ) as mock_translate, patch(
        "studio.compare_pipeline_v4.pipeline.unload_model",
        new=AsyncMock(),
    ) as mock_unload:
        result = await analyze_pair_v4(
            image1_bytes=b"x", image2_bytes=b"y",
            image1_w=512, image1_h=512, image2_w=512, image2_h=512,
            compare_hint="",
            vision_model="qwen3-vl:8b", text_model="gemma4-un:latest",
            ollama_url="http://localhost:11434", timeout=60.0,
        )

    assert mock_pair.call_count == 1
    assert mock_diff.call_count == 1            # fallback 트리거
    assert mock_unload.call_count == 1
    # synthesize_diff 결과로 회복 → translate 호출
    assert mock_translate.call_count == 1
    # caller 가 synthesize_diff result.vision_model 채움 (synthesize_diff 가 모름)
    assert result.vision_model == "qwen3-vl:8b"
    assert result.fallback is False


@pytest.mark.asyncio
async def test_pair_and_diff_both_fallback_skip_translation():
    """pair-compare + synthesize_diff 둘 다 fallback 이면 translation 건너뜀."""
    obs1 = _fake_observation("img1")
    obs2 = _fake_observation("img2")

    with patch(
        "studio.compare_pipeline_v4.pipeline.observe_image",
        new=AsyncMock(side_effect=[obs1, obs2]),
    ), patch(
        "studio.compare_pipeline_v4.pipeline.compare_pair_with_vision",
        new=AsyncMock(return_value=_fake_v4_result(fallback=True)),
    ), patch(
        "studio.compare_pipeline_v4.pipeline.synthesize_diff",
        new=AsyncMock(return_value=_fake_v4_result(fallback=True)),
    ), patch(
        "studio.compare_pipeline_v4.pipeline.translate_v4_result",
        new=AsyncMock(side_effect=lambda r, **k: r),
    ) as mock_translate, patch(
        "studio.compare_pipeline_v4.pipeline.unload_model",
        new=AsyncMock(),
    ):
        result = await analyze_pair_v4(
            image1_bytes=b"x", image2_bytes=b"y",
            image1_w=512, image1_h=512, image2_w=512, image2_h=512,
            compare_hint="",
            vision_model="qwen3-vl:8b", text_model="gemma4-un:latest",
            ollama_url="http://localhost:11434", timeout=60.0,
        )

    # translate skip
    assert mock_translate.call_count == 0
    assert result.fallback is True
