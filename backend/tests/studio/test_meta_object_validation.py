"""C2 회귀 — multipart `meta` 필드 검증 (refactor doc 2026-04-30 §C2).

옛 코드 결함:
  json.loads(meta) 후 바로 .get() → meta=null/[]/문자열 등 비-object 페이로드에서
  AttributeError → 500.

수정:
  routes._common.parse_meta_object 헬퍼가 decode 실패 + non-object 모두 400 으로 통일.

영향 endpoint 4개:
  /api/studio/edit            (streams.py)
  /api/studio/video           (streams.py)
  /api/studio/vision-analyze  (vision.py)
  /api/studio/compare-analyze (compare.py)
"""

from __future__ import annotations

import io

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image


def _png_bytes(w: int = 64, h: int = 64) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color=(120, 130, 140)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_meta",
    [
        "null",  # JSON null → not dict
        "[]",  # array → not dict
        '"x"',  # string → not dict
        "42",  # number → not dict
        "true",  # bool → not dict
        "{not json",  # decode error
    ],
)
async def test_edit_endpoint_rejects_non_object_meta(bad_meta: str) -> None:
    """/edit 가 비-object 또는 비-JSON meta 를 400 으로 거부."""
    from main import app  # type: ignore

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as cli:
        res = await cli.post(
            "/api/studio/edit",
            files={"image": ("x.png", _png_bytes(), "image/png")},
            data={"meta": bad_meta},
        )
    assert res.status_code == 400, (
        f"meta={bad_meta!r} expected 400, got {res.status_code}: {res.text}"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_meta", ["null", "[]", '"x"', "42", "{bad"]
)
async def test_video_endpoint_rejects_non_object_meta(bad_meta: str) -> None:
    """/video 가 비-object meta 를 400 으로 거부."""
    from main import app  # type: ignore

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as cli:
        res = await cli.post(
            "/api/studio/video",
            files={"image": ("x.png", _png_bytes(), "image/png")},
            data={"meta": bad_meta},
        )
    assert res.status_code == 400


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_meta", ["null", "[]", '"x"', "42", "{bad"]
)
async def test_vision_analyze_endpoint_rejects_non_object_meta(bad_meta: str) -> None:
    """/vision-analyze 가 비-object meta 를 400 으로 거부."""
    from main import app  # type: ignore

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as cli:
        res = await cli.post(
            "/api/studio/vision-analyze",
            files={"image": ("x.png", _png_bytes(), "image/png")},
            data={"meta": bad_meta},
        )
    assert res.status_code == 400


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_meta", ["null", "[]", '"x"', "42", "{bad"]
)
async def test_compare_analyze_endpoint_rejects_non_object_meta(bad_meta: str) -> None:
    """/compare-analyze 가 비-object meta 를 400 으로 거부."""
    from main import app  # type: ignore

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as cli:
        res = await cli.post(
            "/api/studio/compare-analyze",
            files={
                "source": ("s.png", _png_bytes(), "image/png"),
                "result": ("r.png", _png_bytes(), "image/png"),
            },
            data={"meta": bad_meta},
        )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_parse_meta_object_helper_directly() -> None:
    """parse_meta_object 헬퍼가 직접 호출 시 dict 강제 + 다양한 입력 거부."""
    from fastapi import HTTPException

    from studio.routes._common import parse_meta_object

    # 정상 경로
    assert parse_meta_object("{}") == {}
    assert parse_meta_object('{"key": "value"}') == {"key": "value"}

    # 거부 경로
    for bad in ["null", "[]", '"x"', "42", "true", "{not"]:
        with pytest.raises(HTTPException) as exc_info:
            parse_meta_object(bad)
        assert exc_info.value.status_code == 400
