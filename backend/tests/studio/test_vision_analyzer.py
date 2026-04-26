"""
analyze_image_detailed + POST /api/studio/vision-analyze 견고성 테스트 (2026-04-24).

핵심:
  - fallback 경로가 항상 존재 (비전 실패 → en="" + fallback=True)
  - 번역만 실패 시 en 보존 + ko=None
  - system prompt 가 SYSTEM_VISION_DETAILED 로 올바르게 쓰이는지
"""

from __future__ import annotations

import asyncio
import io
from unittest.mock import AsyncMock, patch

import pytest
from PIL import Image

from studio.vision_pipeline import (
    SYSTEM_VISION_DETAILED,
    VisionAnalysisResult,
    analyze_image_detailed,
)


def _tiny_png_bytes() -> bytes:
    """테스트용 2×2 PNG 바이트."""
    buf = io.BytesIO()
    Image.new("RGB", (2, 2), color=(200, 120, 60)).save(buf, "PNG")
    return buf.getvalue()


# ───────── 상수/가이드 검증 ─────────


def test_system_vision_detailed_has_required_cues() -> None:
    """상세 어조 가이드에 핵심 키워드들 포함."""
    assert "40-120 words" in SYSTEM_VISION_DETAILED
    # 프롬프트 재사용용이라 주제/조명/스타일 키워드 언급 필수
    for cue in ("subject", "composition", "lighting", "mood"):
        assert cue in SYSTEM_VISION_DETAILED.lower()
    # No bullets / markdown 제약 명시
    assert "no bullets" in SYSTEM_VISION_DETAILED.lower()
    assert "no markdown" in SYSTEM_VISION_DETAILED.lower()


# ───────── analyze_image_detailed 경로 ─────────


def test_vision_fallback_when_describe_fails() -> None:
    """비전 호출 완전 실패 (_describe_image returns "") 시 fallback=True, en="".

    번역은 호출되지 않아야 함.
    """
    translate_mock = AsyncMock(return_value="(should not be called)")
    with (
        patch(
            "studio.vision_pipeline._describe_image",
            new=AsyncMock(return_value=""),
        ),
        patch(
            "studio.vision_pipeline.translate_to_korean",
            new=translate_mock,
        ),
    ):
        result: VisionAnalysisResult = asyncio.run(
            analyze_image_detailed(_tiny_png_bytes())
        )
    assert result.fallback is True
    assert result.en == ""
    assert result.ko is None
    assert result.provider == "fallback"
    translate_mock.assert_not_called()


def test_vision_success_with_translation() -> None:
    """비전 + 번역 모두 성공 — fallback=False, en/ko 모두 유효."""
    describe_mock = AsyncMock(return_value="A warm editorial photo at dusk.")
    translate_mock = AsyncMock(return_value="황혼 무렵의 따뜻한 에디토리얼 사진.")
    with (
        patch(
            "studio.vision_pipeline._describe_image",
            new=describe_mock,
        ),
        patch(
            "studio.vision_pipeline.translate_to_korean",
            new=translate_mock,
        ),
    ):
        result = asyncio.run(analyze_image_detailed(_tiny_png_bytes()))
    assert result.fallback is False
    assert result.provider == "ollama"
    assert "editorial photo" in result.en
    assert "에디토리얼" in (result.ko or "")


def test_vision_success_translation_only_fails() -> None:
    """비전은 성공, 번역만 실패 — en 은 유지 · ko=None · fallback=False."""
    describe_mock = AsyncMock(return_value="A portrait with soft window light.")
    translate_mock = AsyncMock(return_value=None)  # translate 실패 시 None 반환
    with (
        patch(
            "studio.vision_pipeline._describe_image",
            new=describe_mock,
        ),
        patch(
            "studio.vision_pipeline.translate_to_korean",
            new=translate_mock,
        ),
    ):
        result = asyncio.run(analyze_image_detailed(_tiny_png_bytes()))
    assert result.fallback is False
    assert result.provider == "ollama"
    assert "portrait" in result.en
    assert result.ko is None


def test_vision_model_override_propagates() -> None:
    """vision_model / text_model override 가 실제 호출에 전달되는지."""
    describe_mock = AsyncMock(return_value="x")
    translate_mock = AsyncMock(return_value=None)
    with (
        patch(
            "studio.vision_pipeline._describe_image",
            new=describe_mock,
        ),
        patch(
            "studio.vision_pipeline.translate_to_korean",
            new=translate_mock,
        ),
    ):
        asyncio.run(
            analyze_image_detailed(
                _tiny_png_bytes(),
                vision_model="custom-vision:latest",
                text_model="custom-text:latest",
            )
        )
    # describe_mock 의 kwargs 에 vision_model 전달 확인
    _, kwargs = describe_mock.call_args
    assert kwargs["vision_model"] == "custom-vision:latest"
    assert kwargs["system_prompt"] == SYSTEM_VISION_DETAILED

    # translate_mock 에 text_model 이 model 인자로 전달
    _, tkwargs = translate_mock.call_args
    assert tkwargs["model"] == "custom-text:latest"


# ───────── FastAPI 라우트 검증 ─────────


@pytest.mark.asyncio
async def test_vision_analyze_route_happy_path() -> None:
    """POST /api/studio/vision-analyze multipart + meta 정상 처리."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    describe_mock = AsyncMock(return_value="A moody studio portrait.")
    translate_mock = AsyncMock(return_value="분위기 있는 스튜디오 초상.")
    with (
        patch(
            "studio.vision_pipeline._describe_image",
            new=describe_mock,
        ),
        patch(
            "studio.vision_pipeline.translate_to_korean",
            new=translate_mock,
        ),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as cli:
            res = await cli.post(
                "/api/studio/vision-analyze",
                files={"image": ("tiny.png", _tiny_png_bytes(), "image/png")},
                data={"meta": "{}"},
            )
    assert res.status_code == 200
    data = res.json()
    assert data["en"].startswith("A moody")
    assert data["ko"] and "초상" in data["ko"]
    assert data["provider"] == "ollama"
    assert data["fallback"] is False
    assert data["width"] == 2
    assert data["height"] == 2
    assert data["sizeBytes"] > 0


# ───────── Vision Recipe v2 (2026-04-26 spec 18) ─────────


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


def test_vision_v2_json_path_populates_slots() -> None:
    """v2 JSON 경로 — 정상 응답 시 9 슬롯 모두 채워지고 fallback=False."""
    fake_json = (
        '{"summary":"A studio portrait.","positive_prompt":"editorial portrait, '
        'subject-first, soft key, 85mm","negative_prompt":"blurry, watermark",'
        '"composition":"medium shot, centered","subject":"woman, neutral pose",'
        '"clothing_or_materials":"wool coat, matte texture",'
        '"environment":"plain studio backdrop","lighting_camera_style":'
        '"softbox key from left, 85mm f/1.8","uncertain":"exact age"}'
    )
    recipe_mock = AsyncMock(return_value=fake_json)
    translate_mock = AsyncMock(return_value="스튜디오 초상.")
    with (
        patch(
            "studio.vision_pipeline._call_vision_recipe_v2",
            new=recipe_mock,
        ),
        patch(
            "studio.vision_pipeline.translate_to_korean",
            new=translate_mock,
        ),
    ):
        result = asyncio.run(
            analyze_image_detailed(_tiny_png_bytes(), width=1024, height=1024)
        )

    assert result.fallback is False
    assert result.provider == "ollama"
    assert result.summary == "A studio portrait."
    assert "85mm" in result.positive_prompt
    assert "blurry" in result.negative_prompt
    assert result.composition == "medium shot, centered"
    assert result.subject == "woman, neutral pose"
    assert result.environment.startswith("plain studio")
    assert result.uncertain == "exact age"
    # en 은 summary + positive_prompt 합본
    assert "studio portrait" in result.en.lower()
    assert "85mm" in result.en
    # ko 는 summary 번역
    assert "스튜디오" in (result.ko or "")


def test_vision_v2_parse_failure_falls_back_to_paragraph() -> None:
    """v2 JSON 파싱 실패 → 옛 SYSTEM_VISION_DETAILED 폴백 경로 진입.

    9 슬롯 모두 빈 문자열 + en/ko 단락만 채워짐.
    """
    recipe_mock = AsyncMock(return_value="not a json {{{ broken")
    describe_mock = AsyncMock(return_value="A warm photo at dusk.")
    translate_mock = AsyncMock(return_value="황혼 사진.")
    with (
        patch(
            "studio.vision_pipeline._call_vision_recipe_v2",
            new=recipe_mock,
        ),
        patch(
            "studio.vision_pipeline._describe_image",
            new=describe_mock,
        ),
        patch(
            "studio.vision_pipeline.translate_to_korean",
            new=translate_mock,
        ),
    ):
        result = asyncio.run(analyze_image_detailed(_tiny_png_bytes()))

    assert result.fallback is False
    assert result.provider == "ollama"
    assert "warm photo" in result.en
    assert "황혼" in (result.ko or "")
    # 9 슬롯 모두 빈 문자열 (옛 row 와 동일 형태)
    assert result.summary == ""
    assert result.positive_prompt == ""
    assert result.negative_prompt == ""
    assert result.composition == ""
    assert result.subject == ""


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
