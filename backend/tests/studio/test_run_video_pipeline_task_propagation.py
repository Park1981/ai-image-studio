"""_run_video_pipeline_task → run_video_pipeline 의 model_id 전파 검증.

spec v1.1 Codex Finding 2 — 3단 전파의 최상위 단.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_run_video_pipeline_task_propagates_model_id() -> None:
    """_run_video_pipeline_task(model_id='wan22') → run_video_pipeline(model_id='wan22')."""
    from studio.pipelines.video import _run_video_pipeline_task
    from studio.tasks import Task
    from studio.video_pipeline import VideoPipelineResult
    from studio.prompt_pipeline import UpgradeResult

    # Task mock — emit / close 만 검증 (실제 SSE 흐름은 비검증)
    task = Task(task_id="test-task-1")

    with (
        patch(
            "studio.pipelines.video.run_video_pipeline",
            new=AsyncMock(),
        ) as run_mock,
        patch(
            "studio.pipelines.video._dispatch_to_comfy",
            new=AsyncMock(),
        ) as dispatch_mock,
        patch(
            "studio.pipelines.video._save_comfy_video",
            new=AsyncMock(),
        ),
        patch(
            "studio.pipelines.video._persist_history",
            new=AsyncMock(return_value=True),
        ),
        patch(
            "studio.pipelines.video._mark_generation_complete",
        ),
    ):
        run_mock.return_value = VideoPipelineResult(
            image_description="desc",
            final_prompt="prompt",
            vision_ok=True,
            upgrade=UpgradeResult(
                upgraded="prompt", fallback=False, provider="test", original="x"
            ),
        )
        dispatch_mock.return_value = type("D", (), {
            "image_ref": "/api/files/test.mp4",
            "comfy_error": None,
        })()

        await _run_video_pipeline_task(
            task=task,
            image_bytes=b"fake",
            prompt="x",
            filename="test.png",
            model_id="wan22",
        )

    # run_video_pipeline 호출 인자에 model_id='wan22' 포함 확인
    kwargs = run_mock.call_args.kwargs
    assert kwargs.get("model_id") == "wan22", (
        f"run_video_pipeline 에 model_id='wan22' 안 전달됨 (실제: {kwargs})"
    )
