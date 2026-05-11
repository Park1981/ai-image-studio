"""model_id 3단 전파 검증 (Codex Finding 2 — High).

_run_video_pipeline_task → run_video_pipeline → upgrade_video_prompt
까지 model_id 가 끊김 없이 전파되는지 mock 으로 검증.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_run_video_pipeline_propagates_model_id_to_upgrade() -> None:
    """run_video_pipeline(model_id='wan22') → upgrade_video_prompt(model_id='wan22')."""
    from studio.prompt_pipeline import UpgradeResult
    from studio.video_pipeline import run_video_pipeline

    with (
        patch(
            "studio.video_pipeline._describe_image",
            new=AsyncMock(return_value="[ANCHOR] desc"),
        ),
        patch(
            "studio.video_pipeline.upgrade_video_prompt",
            new=AsyncMock(),
        ) as upgrade_mock,
        patch(
            "studio.video_pipeline.ollama_unload.unload_model",
            new=AsyncMock(),
        ),
    ):
        upgrade_mock.return_value = UpgradeResult(
            upgraded="x", fallback=False, provider="test", original="x"
        )

        await run_video_pipeline(
            image_path=b"fake",
            user_direction="x",
            model_id="wan22",
        )

    # upgrade_video_prompt 호출 인자에 model_id='wan22' 포함 확인
    kwargs = upgrade_mock.call_args.kwargs
    assert kwargs.get("model_id") == "wan22", (
        f"upgrade_video_prompt 에 model_id='wan22' 안 전달됨 "
        f"(실제 kwargs: {kwargs})"
    )


@pytest.mark.asyncio
async def test_run_video_pipeline_propagates_ltx_model_id() -> None:
    """동일 검증 — model_id='ltx' 분기 보존."""
    from studio.prompt_pipeline import UpgradeResult
    from studio.video_pipeline import run_video_pipeline

    with (
        patch(
            "studio.video_pipeline._describe_image",
            new=AsyncMock(return_value="[ANCHOR] desc"),
        ),
        patch(
            "studio.video_pipeline.upgrade_video_prompt",
            new=AsyncMock(),
        ) as upgrade_mock,
        patch(
            "studio.video_pipeline.ollama_unload.unload_model",
            new=AsyncMock(),
        ),
    ):
        upgrade_mock.return_value = UpgradeResult(
            upgraded="x", fallback=False, provider="test", original="x"
        )

        await run_video_pipeline(
            image_path=b"fake",
            user_direction="x",
            model_id="ltx",
        )

    kwargs = upgrade_mock.call_args.kwargs
    assert kwargs.get("model_id") == "ltx"


@pytest.mark.asyncio
async def test_run_video_pipeline_rejects_missing_model_id() -> None:
    """model_id 누락 시 TypeError — keyword-only required."""
    from studio.video_pipeline import run_video_pipeline

    with pytest.raises(TypeError):
        await run_video_pipeline(  # type: ignore[call-arg]
            image_path=b"fake",
            user_direction="x",
        )
