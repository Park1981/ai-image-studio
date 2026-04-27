"""POST /api/studio/edit 의 image upload 검증 테스트 (P1-5 · 2026-04-26).

이전: 빈 bytes 만 체크 → 손상/비-이미지/대용량 통과 후 ComfyUI 단계 모호한 실패.
신규: Vision/Video 와 동일 정책 — size > 20MB → 413, PIL 인식 실패 → 400.
"""

from __future__ import annotations

import io
import json

import pytest
from PIL import Image


def _png_bytes(w: int = 64, h: int = 64) -> bytes:
    """유효한 PNG bytes 생성."""
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color=(120, 130, 140)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_edit_rejects_oversized_image() -> None:
    """20MB 초과 이미지 → 413."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio.storage import STUDIO_MAX_IMAGE_BYTES

    # 20MB + 1 byte (실제 이미지일 필요 없음 — size 체크가 PIL open 보다 먼저)
    oversized = b"P" + b"\x00" * STUDIO_MAX_IMAGE_BYTES

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/edit",
            files={"image": ("big.png", oversized, "image/png")},
            data={"meta": json.dumps({"prompt": "test"})},
        )

    assert resp.status_code == 413, resp.text
    assert "too large" in resp.text.lower()


def test_upload_size_aliases_share_single_policy_value() -> None:
    """라우트별 compatibility alias 가 공용 상수와 같은 값을 가리키는지 검증."""
    from studio.pipelines import _EDIT_MAX_IMAGE_BYTES, _VIDEO_MAX_IMAGE_BYTES
    from studio.storage import STUDIO_MAX_IMAGE_BYTES

    assert _EDIT_MAX_IMAGE_BYTES == STUDIO_MAX_IMAGE_BYTES
    assert _VIDEO_MAX_IMAGE_BYTES == STUDIO_MAX_IMAGE_BYTES


@pytest.mark.asyncio
async def test_edit_rejects_invalid_image() -> None:
    """비-이미지 bytes → 400."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    # 이미지 헤더 시그니처 없는 평범한 텍스트
    bogus = b"this is definitely not an image, just plain text bytes"

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/edit",
            files={"image": ("fake.png", bogus, "image/png")},
            data={"meta": json.dumps({"prompt": "test"})},
        )

    assert resp.status_code == 400, resp.text
    body = resp.text.lower()
    assert "invalid" in body or "format" in body


@pytest.mark.asyncio
async def test_edit_rejects_empty_image() -> None:
    """빈 bytes → 400 (기존 동작 유지 검증)."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/edit",
            files={"image": ("empty.png", b"", "image/png")},
            data={"meta": json.dumps({"prompt": "test"})},
        )

    assert resp.status_code == 400, resp.text
    assert "empty" in resp.text.lower()


@pytest.mark.asyncio
async def test_edit_rejects_missing_prompt() -> None:
    """prompt 비어있음 → 400 (기존 동작 유지 검증)."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/edit",
            files={"image": ("ok.png", _png_bytes(), "image/png")},
            data={"meta": json.dumps({"prompt": "   "})},
        )

    assert resp.status_code == 400, resp.text
    assert "prompt" in resp.text.lower()
