"""
analyze_image_detailed + POST /api/studio/vision-analyze 견고성 테스트.

Phase 5 (2026-05-03): 옛 1-shot 아키텍처 (SYSTEM_VISION_RECIPE_V2,
_call_vision_recipe_v2, SYSTEM_VISION_DETAILED) 제거 후 갱신.
핵심 시나리오는 test_image_detail_v3.py 로 이동.
본 파일에는 변경 없는 유틸 + 라우트 테스트만 유지.
"""

from __future__ import annotations

import asyncio
import io
from unittest.mock import AsyncMock, patch

import pytest
from PIL import Image

from studio.vision_pipeline import (
    VisionAnalysisResult,
    analyze_image_detailed,
)


def _tiny_png_bytes() -> bytes:
    """테스트용 2×2 PNG 바이트."""
    buf = io.BytesIO()
    Image.new("RGB", (2, 2), color=(200, 120, 60)).save(buf, "PNG")
    return buf.getvalue()


# ───────── 유틸 상수 검증 ─────────


def test_aspect_label_common_ratios() -> None:
    """_aspect_label — 권장 비율들이 사람 친화 라벨로 매핑."""
    from studio.vision_pipeline import _aspect_label

    assert _aspect_label(1024, 1024) == "1:1 square"
    assert _aspect_label(1664, 928) == "16:9 widescreen"  # GCD=104
    assert _aspect_label(928, 1664) == "9:16 vertical"
    assert _aspect_label(1472, 1104) == "4:3 standard"
    assert _aspect_label(1584, 1056) == "3:2 landscape"
    # 비표준 비율은 custom 라벨
    assert _aspect_label(1000, 333).endswith("custom")
    # 0/음수 방어
    assert _aspect_label(0, 0) == "unknown aspect"


# ───────── FastAPI 라우트 검증 ─────────


@pytest.mark.asyncio
async def test_vision_analyze_route_happy_path() -> None:
    """POST /api/studio/vision-analyze + SSE stream → done event payload 검증.

    Phase 6 (2026-04-27): 동기 JSON → task-based SSE 로 전환. POST 는 {task_id, stream_url}
    반환, 실 결과는 SSE drain 후 done event payload 에서 추출.
    Phase 5 (2026-05-03): 2-stage mock (_vo.observe_image + _ps.synthesize_prompt).
    """
    import json as _json

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    # v3 2-stage 아키텍처 — vision 관찰 + text 합성 각각 mock
    mock_observation = {
        "subjects": [{"broad_visible_appearance": "East Asian female", "apparent_age_group": "young adult"}],
        "environment": {"location_type": "studio"},
    }
    mock_synthesized = {
        "summary": "A moody studio portrait.",
        "positive_prompt": "East Asian young adult female, studio portrait",
        "negative_prompt": "blurry, watermark",
        "key_visual_anchors": ["studio backdrop"],
        "uncertain": [],
    }
    with (
        patch(
            "studio.vision_pipeline.image_detail._vo.observe_image",
            new=AsyncMock(return_value=mock_observation),
        ),
        patch(
            "studio.vision_pipeline.image_detail._ps.synthesize_prompt",
            new=AsyncMock(return_value=mock_synthesized),
        ),
        patch(
            "studio.vision_pipeline.image_detail.translate_to_korean",
            new=AsyncMock(return_value="분위기 있는 스튜디오 초상."),
        ),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as cli:
            res = await cli.post(
                "/api/studio/vision-analyze",
                files={"image": ("tiny.png", _tiny_png_bytes(), "image/png")},
                data={"meta": "{}"},
            )
            assert res.status_code == 200
            stream_url = res.json()["stream_url"]

            # SSE drain — done event payload 추출 (옛 JSON 응답 shape 동일)
            data: dict | None = None
            async with cli.stream("GET", stream_url) as sr:
                pending_event: str | None = None
                async for line in sr.aiter_lines():
                    if line.startswith("event:"):
                        pending_event = line[6:].strip()
                        continue
                    if line.startswith("data:"):
                        try:
                            payload = _json.loads(line[5:].strip())
                        except _json.JSONDecodeError:
                            continue
                        if pending_event == "done":
                            data = payload
                            break

    assert data is not None
    assert "moody" in data["en"]
    assert data["ko"] and "초상" in data["ko"]
    assert data["provider"] == "ollama"
    assert data["fallback"] is False
    assert data["width"] == 2
    assert data["height"] == 2
    assert data["sizeBytes"] > 0


@pytest.mark.asyncio
async def test_vision_analyze_route_empty_image_400() -> None:
    """빈 파일 400."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as cli:
        res = await cli.post(
            "/api/studio/vision-analyze",
            files={"image": ("empty.png", b"", "image/png")},
            data={"meta": "{}"},
        )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_vision_analyze_route_invalid_meta_400() -> None:
    """meta JSON 깨짐 400."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as cli:
        res = await cli.post(
            "/api/studio/vision-analyze",
            files={"image": ("x.png", _tiny_png_bytes(), "image/png")},
            data={"meta": "{not json"},
        )
    assert res.status_code == 400
