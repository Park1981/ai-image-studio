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


def _fake_video_result():
    from studio.prompt_pipeline import UpgradeResult
    from studio.video_pipeline import VideoPipelineResult

    return VideoPipelineResult(
        image_description="A person in a softly lit studio.",
        final_prompt="Turn toward the camera with realistic motion.",
        vision_ok=True,
        upgrade=UpgradeResult(
            upgraded="Turn toward the camera with realistic motion.",
            fallback=False,
            provider="test-provider",
            original="turn",
            translation="카메라를 향해 돈다",
        ),
    )


def _drain_events(task) -> list[dict]:
    events = []
    while not task.queue.empty():
        events.append(task.queue.get_nowait())
    return events


@pytest.mark.asyncio
async def test_video_lab_pair_pipeline_runs_wan_then_sulphur_and_persists_both() -> None:
    from studio.pipelines._dispatch import ComfyDispatchResult
    from studio.pipelines.video_lab import _run_video_lab_pair_pipeline_task
    from studio.tasks import Task

    task = Task(task_id="lab-pair-success")
    dispatch_calls: list[tuple[str | None, str, dict]] = []

    async def fake_dispatch(task_arg, factory, **kwargs):
        api = factory("uploaded.png")
        dispatch_calls.append(
            (
                getattr(task_arg, "_model_id", None),
                kwargs["client_prefix"],
                api,
            )
        )
        ref = "/images/studio/video/wan.mp4" if len(dispatch_calls) == 1 else "/images/studio/video/sulphur.mp4"
        return ComfyDispatchResult(image_ref=ref, comfy_error=None)

    with (
        patch(
            "studio.pipelines.video_lab.run_video_pipeline",
            new=AsyncMock(return_value=_fake_video_result()),
        ) as run_mock,
        patch("studio.pipelines.video_lab._dispatch_to_comfy", new=fake_dispatch),
        patch(
            "studio.pipelines.video_lab._persist_history",
            new=AsyncMock(return_value=True),
        ) as persist_mock,
        patch("studio.pipelines.video_lab._mark_generation_complete"),
    ):
        await _run_video_lab_pair_pipeline_task(
            task=task,
            image_bytes=b"fake",
            prompt="turn",
            filename="source.png",
            preset_id="ltx-sulphur",
            source_width=640,
            source_height=960,
            longer_edge=512,
            prompt_mode="precise",
        )

    assert run_mock.call_args.kwargs["model_id"] == "wan22"
    assert run_mock.call_args.kwargs["adult"] is True
    assert run_mock.call_args.kwargs["prompt_mode"] == "precise"
    assert [call[0] for call in dispatch_calls] == ["wan22", "ltx-sulphur"]
    assert [call[1] for call in dispatch_calls] == [
        "ais-lab-pair-wan",
        "ais-lab-pair-sulphur",
    ]

    persisted = [call.args[0] for call in persist_mock.call_args_list]
    assert [item["modelId"] for item in persisted] == ["wan22", "ltx-sulphur"]
    assert persisted[0]["seed"] == persisted[1]["seed"]
    assert persisted[0]["upgradedPrompt"] == "Turn toward the camera with realistic motion."
    assert "Beat 1 :" in persisted[1]["upgradedPrompt"]
    assert "No face swap" in persisted[1]["upgradedPrompt"]
    assert persisted[0]["width"] == persisted[1]["width"] == 336
    assert persisted[0]["height"] == persisted[1]["height"] == 512

    sulphur_resize = next(
        node
        for node in dispatch_calls[1][2].values()
        if node.get("class_type") == "ResizeImagesByLongerEdge"
    )
    sulphur_scale = next(
        node
        for node in dispatch_calls[1][2].values()
        if node.get("class_type") == "ImageScaleDownBy"
    )
    assert sulphur_resize["inputs"]["longer_edge"] == 512
    assert sulphur_scale["inputs"]["scale_by"] == 0.5

    done = [event for event in _drain_events(task) if event["event"] == "done"][-1]
    assert set(done["data"]["items"]) == {"wan22", "ltx-sulphur"}
    assert done["data"]["modelPrompts"]["wan22"] == (
        "Turn toward the camera with realistic motion."
    )
    assert "Beat 5 :" in done["data"]["modelPrompts"]["ltx-sulphur"]
    assert done["data"]["pairMode"] == "shared_5beat"
    assert done["data"]["sulphurProfile"] == "official_i2v_v1"


@pytest.mark.asyncio
async def test_video_lab_pair_pipeline_wan_failure_stops_before_sulphur() -> None:
    from studio.pipelines._dispatch import ComfyDispatchResult
    from studio.pipelines.video_lab import _run_video_lab_pair_pipeline_task
    from studio.tasks import Task

    task = Task(task_id="lab-pair-wan-fail")
    dispatch_count = 0

    async def fake_dispatch(*_args, **_kwargs):
        nonlocal dispatch_count
        dispatch_count += 1
        return ComfyDispatchResult(image_ref="mock://wan", comfy_error="wan failed")

    with (
        patch(
            "studio.pipelines.video_lab.run_video_pipeline",
            new=AsyncMock(return_value=_fake_video_result()),
        ),
        patch("studio.pipelines.video_lab._dispatch_to_comfy", new=fake_dispatch),
        patch("studio.pipelines.video_lab._persist_history", new=AsyncMock()) as persist_mock,
        patch("studio.pipelines.video_lab._mark_generation_complete") as complete_mock,
    ):
        await _run_video_lab_pair_pipeline_task(
            task=task,
            image_bytes=b"fake",
            prompt="turn",
            filename="source.png",
            preset_id="ltx-sulphur",
            source_width=640,
            source_height=960,
            longer_edge=512,
        )

    assert dispatch_count == 1
    persist_mock.assert_not_called()
    complete_mock.assert_called_once()
    errors = [event for event in _drain_events(task) if event["event"] == "error"]
    assert errors[-1]["data"]["failedModelId"] == "wan22"


@pytest.mark.asyncio
async def test_video_lab_pair_pipeline_sulphur_failure_keeps_wan_result() -> None:
    from studio.pipelines._dispatch import ComfyDispatchResult
    from studio.pipelines.video_lab import _run_video_lab_pair_pipeline_task
    from studio.tasks import Task

    task = Task(task_id="lab-pair-sulphur-fail")
    dispatch_count = 0

    async def fake_dispatch(*_args, **_kwargs):
        nonlocal dispatch_count
        dispatch_count += 1
        if dispatch_count == 1:
            return ComfyDispatchResult(image_ref="/images/studio/video/wan.mp4")
        return ComfyDispatchResult(
            image_ref="mock://sulphur",
            comfy_error="sulphur failed",
        )

    with (
        patch(
            "studio.pipelines.video_lab.run_video_pipeline",
            new=AsyncMock(return_value=_fake_video_result()),
        ),
        patch("studio.pipelines.video_lab._dispatch_to_comfy", new=fake_dispatch),
        patch(
            "studio.pipelines.video_lab._persist_history",
            new=AsyncMock(return_value=True),
        ) as persist_mock,
        patch("studio.pipelines.video_lab._mark_generation_complete") as complete_mock,
    ):
        await _run_video_lab_pair_pipeline_task(
            task=task,
            image_bytes=b"fake",
            prompt="turn",
            filename="source.png",
            preset_id="ltx-sulphur",
            source_width=640,
            source_height=960,
            longer_edge=512,
        )

    assert dispatch_count == 2
    assert persist_mock.call_count == 1
    complete_mock.assert_called_once()
    done = [event for event in _drain_events(task) if event["event"] == "done"][-1]
    assert set(done["data"]["items"]) == {"wan22"}
    assert done["data"]["failedModelId"] == "ltx-sulphur"
    assert done["data"]["errors"] == {"ltx-sulphur": "sulphur failed"}
