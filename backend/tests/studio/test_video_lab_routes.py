"""routes/lab.py tests."""

from __future__ import annotations

import asyncio
import io
import json
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from studio.lab_presets import LAB_LTX_SULPHUR_PRESET


def _tiny_png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color="blue").save(buf, format="PNG")
    return buf.getvalue()


class _FakeComfyTransport:
    async def __aenter__(self) -> "_FakeComfyTransport":
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        return None

    async def get_object_info(self) -> dict[str, Any]:
        files = [option.file_name for option in LAB_LTX_SULPHUR_PRESET.lora_options]
        return {
            "LoraLoaderModelOnly": {
                "input": {"required": {"lora_name": [files]}}
            }
        }


@pytest.mark.asyncio
async def test_check_lab_video_files_reports_comfyui_lora_enum() -> None:
    from main import app  # type: ignore[import-not-found]

    with patch("studio.routes.lab.ComfyUITransport", new=_FakeComfyTransport):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            resp = await ac.get("/api/studio/lab/video/files")

    assert resp.status_code == 200
    body = resp.json()
    assert body["allPresent"] is True
    assert body["missing"] == []
    assert body["availableCount"] == len(LAB_LTX_SULPHUR_PRESET.lora_options)


@pytest.mark.asyncio
async def test_create_lab_video_task_passes_selection_to_pipeline() -> None:
    from main import app  # type: ignore[import-not-found]

    captured_args: tuple[Any, ...] = ()
    captured_kwargs: dict[str, Any] = {}
    record_calls: list[tuple[str, str]] = []

    async def fake_pipeline(*args: Any, **kwargs: Any) -> None:
        nonlocal captured_args, captured_kwargs
        captured_args = args
        captured_kwargs = kwargs

    def fake_record(mode: str, name: str) -> None:
        record_calls.append((mode, name))

    meta = {
        "prompt": "slow cinematic motion",
        "activeLoraIds": ["distill_sulphur", "adult_sulphur"],
        "loraStrengths": {"adult_sulphur": 0.85},
        "promptMode": "precise",
        "longerEdge": 512,
    }

    with (
        patch(
            "studio.routes.lab._run_video_lab_pipeline_task",
            new=fake_pipeline,
        ),
        patch(
            "studio.routes.lab._assert_loras_available",
            new=AsyncMock(return_value=None),
        ),
        patch("studio.routes.lab.dispatch_state.record", new=fake_record),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            resp = await ac.post(
                "/api/studio/lab/video",
                files={"image": ("test.png", _tiny_png(), "image/png")},
                data={"meta": json.dumps(meta)},
            )
        await asyncio.sleep(0)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["stream_url"].startswith("/api/studio/lab/video/stream/")
    assert record_calls == [("video", "LTX 2.3 · Sulphur Lab")]

    assert captured_args[2] == "slow cinematic motion"
    assert captured_args[4] == "ltx-sulphur"
    assert captured_args[5] == ["distill_sulphur", "adult_sulphur"]
    assert captured_args[6] == {"adult_sulphur": 0.85}
    assert captured_args[9] is True
    assert captured_args[14] == 512
    assert captured_args[15] is True
    assert captured_kwargs["prompt_mode"] == "precise"


@pytest.mark.asyncio
async def test_create_lab_video_task_rejects_unknown_lora_id() -> None:
    from main import app  # type: ignore[import-not-found]

    meta = {"prompt": "x", "activeLoraIds": ["missing"]}
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/lab/video",
            files={"image": ("test.png", _tiny_png(), "image/png")},
            data={"meta": json.dumps(meta)},
        )

    assert resp.status_code == 400
    assert "unknown lab lora id" in resp.text
