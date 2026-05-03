"""
Wan 2.2 routes/pipelines 통합 검증 (Phase 3 · 2026-05-03).

목적:
  - routes/streams.py::create_video_task 가 meta JSON 의 modelId 를
    정확히 파싱해서 _run_video_pipeline_task 의 model_id kwarg 로 전달
  - dispatch_state.record 가 model 별 display_name 으로 호출
  - pipelines/video.py 의 history item 모델별 분기 (fps/frameCount/cfg)

spec: docs/superpowers/specs/2026-05-03-video-model-selection-wan22.md §4.3, §4.4
"""

from __future__ import annotations

import io
import json
from typing import Any
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from studio.presets import (
    LTX_VIDEO_PRESET,
    WAN22_VIDEO_PRESET,
    Wan22ModelPreset,
    get_video_preset,
)


def _tiny_png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), color=(50, 100, 150)).save(buf, format="PNG")
    return buf.getvalue()


# ───────── 1. routes 의 model_id 파싱 + dispatch ─────────


@pytest.mark.parametrize(
    "meta_extra,expected_model_id,expected_display_name",
    [
        # default (modelId 누락) → wan22
        ({}, "wan22", "Wan 2.2 i2v"),
        # 명시
        ({"modelId": "wan22"}, "wan22", "Wan 2.2 i2v"),
        ({"modelId": "ltx"}, "ltx", "LTX Video 2.3"),
        # 잘못된 값 → wan22 (default fallback)
        ({"modelId": "unknown"}, "wan22", "Wan 2.2 i2v"),
        # snake_case alias
        ({"model_id": "ltx"}, "ltx", "LTX Video 2.3"),
    ],
)
@pytest.mark.asyncio
async def test_create_video_task_modelId_parse_and_dispatch(
    meta_extra: dict[str, Any],
    expected_model_id: str,
    expected_display_name: str,
) -> None:
    """POST /api/studio/video 의 meta JSON 의 modelId → pipeline + dispatch_state 정확 전달."""
    from main import app  # type: ignore[import-not-found]

    captured_kwargs: dict[str, Any] = {}
    record_calls: list[tuple[str, str]] = []

    async def fake_pipeline(*_args: Any, **kwargs: Any) -> None:
        captured_kwargs.update(kwargs)

    def fake_record(mode: str, name: str) -> None:
        record_calls.append((mode, name))

    meta = {"prompt": "a panning shot of a calm sea"}
    meta.update(meta_extra)

    transport = ASGITransport(app=app)
    with patch(
        "studio.routes.streams._run_video_pipeline_task",
        new=fake_pipeline,
    ), patch(
        "studio.routes.streams.dispatch_state.record",
        new=fake_record,
    ):
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.post(
                "/api/studio/video",
                files={"image": ("test.png", _tiny_png(), "image/png")},
                data={"meta": json.dumps(meta)},
            )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "task_id" in body
    assert body["stream_url"].startswith("/api/studio/video/stream/")

    # _run_video_pipeline_task 가 model_id kwarg 로 받았는지
    assert captured_kwargs.get("model_id") == expected_model_id, (
        f"meta={meta_extra} expected model_id={expected_model_id} "
        f"actual={captured_kwargs.get('model_id')}"
    )
    # dispatch_state.record 가 모델별 display_name 으로 호출됐는지
    assert len(record_calls) == 1
    assert record_calls[0] == ("video", expected_display_name)


# ───────── 2. preset 분기 (sanity — get_video_preset) ─────────


def test_get_video_preset_dispatches_correct_instance() -> None:
    """get_video_preset 이 model_id 별 정확한 preset 인스턴스 반환."""
    wan = get_video_preset("wan22")
    assert isinstance(wan, Wan22ModelPreset)
    assert wan is WAN22_VIDEO_PRESET
    assert wan.display_name == "Wan 2.2 i2v"
    assert wan.sampling.base_fps == 16
    assert wan.sampling.default_length == 81
    assert wan.sampling.shift == 8.0
    # Lightning ON/OFF 분기값 검증 (spec §2 결정 #2)
    assert wan.sampling.lightning_steps == 4
    assert wan.sampling.lightning_cfg == 1.0
    assert wan.sampling.precise_steps == 20
    assert wan.sampling.precise_cfg == 3.5

    ltx = get_video_preset("ltx")
    assert ltx is LTX_VIDEO_PRESET
    assert ltx.display_name == "LTX Video 2.3"
    assert ltx.sampling.fps == 25
    assert ltx.sampling.frame_count == 126


def test_get_video_preset_unknown_raises() -> None:
    """알 수 없는 model_id 는 ValueError (frontend mirror sync 깨짐 검출)."""
    with pytest.raises(ValueError, match="unknown video model_id"):
        get_video_preset("unknown")  # type: ignore[arg-type]


# ───────── 3. spec §2 — Bounce LoRA strength 박제값 ─────────


def test_wan22_preset_bounce_lora_strength() -> None:
    """spec §2 결정 #3: Bounce LoRA strength 0.8 (Phase 6 튜닝 후 확정)."""
    motion_loras = [l for l in WAN22_VIDEO_PRESET.loras if l.role == "motion"]
    assert len(motion_loras) == 1
    bounce = motion_loras[0]
    assert bounce.strength == 0.8
    # high/low 양쪽에 동일 파일 적용 (spec §4.1)
    assert bounce.name_high == "BounceHighWan2_2.safetensors"
    assert bounce.name_low == bounce.name_high


def test_wan22_preset_lightning_lora_separation() -> None:
    """spec §4.1: Lightning LoRA 는 high/low noise 별 다른 파일 (학습 분리)."""
    lightning_loras = [
        l for l in WAN22_VIDEO_PRESET.loras if l.role == "lightning"
    ]
    assert len(lightning_loras) == 1
    light = lightning_loras[0]
    assert light.strength == 1.0
    assert "high_noise" in light.name_high
    assert "low_noise" in light.name_low
    assert light.name_high != light.name_low
