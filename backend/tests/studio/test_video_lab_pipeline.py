"""pipelines/video_lab.py tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_video_lab_pipeline_persists_video_mode_and_lab_model() -> None:
    from studio.pipelines.video_lab import _run_video_lab_pipeline_task
    from studio.prompt_pipeline import UpgradeResult
    from studio.tasks import Task
    from studio.video_pipeline import VideoPipelineResult

    task = Task(task_id="lab-video-test")

    with (
        patch(
            "studio.pipelines.video_lab.run_video_pipeline",
            new=AsyncMock(),
        ) as run_mock,
        patch(
            "studio.pipelines.video_lab._dispatch_to_comfy",
            new=AsyncMock(),
        ) as dispatch_mock,
        patch(
            "studio.pipelines.video_lab._persist_history",
            new=AsyncMock(return_value=True),
        ) as persist_mock,
        patch("studio.pipelines.video_lab._mark_generation_complete"),
    ):
        run_mock.return_value = VideoPipelineResult(
            image_description="desc",
            final_prompt="final prompt",
            vision_ok=True,
            upgrade=UpgradeResult(
                upgraded="final prompt",
                fallback=False,
                provider="test",
                original="source prompt",
            ),
        )
        dispatch_mock.return_value = type(
            "Dispatch",
            (),
            {"image_ref": "/images/studio/video/test.mp4", "comfy_error": None},
        )()

        await _run_video_lab_pipeline_task(
            task=task,
            image_bytes=b"fake",
            prompt="source prompt",
            filename="source.png",
            preset_id="ltx-sulphur",
            active_lora_ids=["distill_sulphur", "adult_sulphur"],
            lora_strengths={"adult_sulphur": 0.75},
            source_width=768,
            source_height=1024,
            longer_edge=512,
        )

    run_kwargs = run_mock.call_args.kwargs
    assert run_kwargs["model_id"] == "ltx"
    assert run_kwargs["adult"] is True

    item = persist_mock.call_args.args[0]
    assert item["mode"] == "video"
    assert item["model"] == "LTX 2.3 · Sulphur Lab"
    assert item["modelId"] == "ltx-sulphur"
    assert item["imageRef"] == "/images/studio/video/test.mp4"
    assert item["adult"] is True
    assert item["lightning"] is True
    assert item["fps"] == 25.0
    assert item["frameCount"] == 126
    assert item["durationSec"] == 5.0
