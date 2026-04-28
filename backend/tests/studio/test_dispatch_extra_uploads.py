"""_dispatch_to_comfy 의 factory 호출 분기 회귀 테스트.

extra_uploads=None 이면 옛 (positional 1개) factory 형태가 깨지지 않아야 하고,
extra_uploads 가 있으면 새 (keyword) factory 형태가 정확히 호출돼야 함.

ComfyUITransport 자체는 mock — 실 ComfyUI 무관 단위 테스트.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from studio.pipelines._dispatch import _dispatch_to_comfy


@pytest.mark.asyncio
async def test_factory_called_positional_when_no_extra_uploads():
    """기존 generate/video factory 시그니처 회귀 검증."""
    factory = MagicMock(return_value={"node1": {"class_type": "Test"}})
    task = AsyncMock()

    async def _empty_listen(*args, **kwargs):
        if False:
            yield None

    async def _save_output(_comfy, _prompt_id, _mode):
        return ("/images/studio/test.png", 1, 1)

    with patch(
        "studio.pipelines._dispatch.ComfyUITransport"
    ) as TransportCls, patch(
        "studio.pipelines._dispatch.acquire_gpu_slot", new=AsyncMock()
    ), patch(
        # Codex 3차 리뷰 fix: release_gpu_slot 은 sync 함수라 MagicMock.
        "studio.pipelines._dispatch.release_gpu_slot", new=MagicMock()
    ), patch(
        "studio.pipelines._dispatch._ensure_comfyui_ready", new=AsyncMock()
    ), patch(
        "studio.pipelines._dispatch.ollama_unload.force_unload_all_loaded_models",
        new=AsyncMock(),
    ):
        comfy = AsyncMock()
        comfy.upload_image = AsyncMock(return_value="src.png")
        comfy.submit = AsyncMock(return_value="prompt-id")
        # Codex 3차 리뷰 fix: listen 은 async iterator.
        comfy.listen = _empty_listen
        TransportCls.return_value.__aenter__.return_value = comfy
        TransportCls.return_value.__aexit__.return_value = None

        await _dispatch_to_comfy(
            task,
            factory,
            mode="edit",
            progress_start=10,
            progress_span=80,
            upload_bytes=b"x",
            upload_filename="src.png",
            extra_uploads=None,
            save_output=_save_output,
        )

    factory.assert_called_once_with("src.png")
    args, kwargs = factory.call_args
    assert "extra_uploaded_names" not in kwargs


@pytest.mark.asyncio
async def test_factory_called_with_extra_when_uploads_present():
    """extra_uploads 있으면 keyword extra_uploaded_names 가 정확히 전달."""
    factory = MagicMock(return_value={"node1": {"class_type": "Test"}})
    task = AsyncMock()

    async def _empty_listen(*args, **kwargs):
        if False:
            yield None

    async def _save_output(_comfy, _prompt_id, _mode):
        return ("/images/studio/test.png", 1, 1)

    with patch(
        "studio.pipelines._dispatch.ComfyUITransport"
    ) as TransportCls, patch(
        "studio.pipelines._dispatch.acquire_gpu_slot", new=AsyncMock()
    ), patch(
        "studio.pipelines._dispatch.release_gpu_slot", new=MagicMock()
    ), patch(
        "studio.pipelines._dispatch._ensure_comfyui_ready", new=AsyncMock()
    ), patch(
        "studio.pipelines._dispatch.ollama_unload.force_unload_all_loaded_models",
        new=AsyncMock(),
    ):
        comfy = AsyncMock()
        comfy.upload_image = AsyncMock(side_effect=["src.png", "ref.png"])
        comfy.submit = AsyncMock(return_value="prompt-id")
        comfy.listen = _empty_listen
        TransportCls.return_value.__aenter__.return_value = comfy
        TransportCls.return_value.__aexit__.return_value = None

        await _dispatch_to_comfy(
            task,
            factory,
            mode="edit",
            progress_start=10,
            progress_span=80,
            upload_bytes=b"x",
            upload_filename="src.png",
            extra_uploads=[(b"y", "ref.png")],
            save_output=_save_output,
        )

    args, kwargs = factory.call_args
    assert args == ("src.png",)
    assert kwargs == {"extra_uploaded_names": ["ref.png"]}
