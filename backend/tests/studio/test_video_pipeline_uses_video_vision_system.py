"""run_video_pipeline 이 _describe_image 를 VIDEO_VISION_SYSTEM + temp 0.2 로 호출하는지 검증.

spec v1.1 §3.3 Task 2,3 — mock 으로 _describe_image 호출 kwargs 확인.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_video_pipeline_uses_video_vision_system() -> None:
    """run_video_pipeline 이 system_prompt=VIDEO_VISION_SYSTEM 으로 호출."""
    from studio.video_pipeline import run_video_pipeline
    from studio.vision_pipeline import VIDEO_VISION_SYSTEM

    # _describe_image 와 upgrade_video_prompt 둘 다 mock
    with (
        patch(
            "studio.video_pipeline._describe_image",
            new=AsyncMock(return_value="[ANCHOR] ... [MOOD] ..."),
        ) as describe_mock,
        patch(
            "studio.video_pipeline.upgrade_video_prompt",
            new=AsyncMock(),
        ) as upgrade_mock,
        patch(
            "studio.video_pipeline.ollama_unload.unload_model",
            new=AsyncMock(),
        ),
    ):
        # 빈 UpgradeResult mock 반환
        from studio.prompt_pipeline import UpgradeResult

        upgrade_mock.return_value = UpgradeResult(
            upgraded="x", fallback=False, provider="test", original="x"
        )

        await run_video_pipeline(
            image_path=b"fake-image-bytes",
            user_direction="test direction",
            model_id="wan22",
        )

    # _describe_image 호출 인자 검증
    call_kwargs = describe_mock.call_args.kwargs
    assert call_kwargs["system_prompt"] == VIDEO_VISION_SYSTEM, (
        "video_pipeline 이 VIDEO_VISION_SYSTEM 을 system_prompt 로 안 넘김"
    )


@pytest.mark.asyncio
async def test_video_pipeline_uses_temperature_0_2() -> None:
    """run_video_pipeline 이 _describe_image 를 temperature=0.2 로 호출."""
    from studio.video_pipeline import run_video_pipeline

    with (
        patch(
            "studio.video_pipeline._describe_image",
            new=AsyncMock(return_value="[ANCHOR] ... [MOOD] ..."),
        ) as describe_mock,
        patch(
            "studio.video_pipeline.upgrade_video_prompt",
            new=AsyncMock(),
        ) as upgrade_mock,
        patch(
            "studio.video_pipeline.ollama_unload.unload_model",
            new=AsyncMock(),
        ),
    ):
        from studio.prompt_pipeline import UpgradeResult

        upgrade_mock.return_value = UpgradeResult(
            upgraded="x", fallback=False, provider="test", original="x"
        )

        await run_video_pipeline(
            image_path=b"fake",
            user_direction="x",
            model_id="wan22",
        )

    call_kwargs = describe_mock.call_args.kwargs
    assert call_kwargs["temperature"] == 0.2, (
        f"video_pipeline 이 temperature=0.2 로 안 부름 (실제: {call_kwargs.get('temperature')})"
    )
