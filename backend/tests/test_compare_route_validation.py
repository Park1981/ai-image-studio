"""compare-analyze route 의 A/B 이미지 PIL 검증 + width/height 추출.

Task 10 (Vision Compare 재설계 Phase 3):
  - 옛 route 는 bytes 길이만 체크 → PNG 손상/text 위장 우회 가능.
  - 신규: PIL.Image.verify() + size 추출 (V4 가 width/height 인자 필요).

3 케이스:
  1) 정상 PNG 페어 → 200 + task_id + stream_url
  2) text/plain 위장 → 400 "invalid image"
  3) 손상된 PNG (header 만 valid) → 400 "invalid image"
"""

from __future__ import annotations

import io
import json

from fastapi.testclient import TestClient
from PIL import Image as PILImage

from main import app
from studio import storage


def _png_bytes(w: int, h: int) -> bytes:
    """주어진 크기의 단색 PNG bytes 반환."""
    img = PILImage.new("RGB", (w, h), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_compare_route_accepts_valid_pair() -> None:
    """정상 PNG 두 장 → 200 + task_id + stream_url 반환."""
    client = TestClient(app)
    res = client.post(
        "/api/studio/compare-analyze",
        files={
            "source": ("a.png", _png_bytes(640, 480), "image/png"),
            "result": ("b.png", _png_bytes(800, 600), "image/png"),
        },
        data={"meta": '{"context": "compare", "compareHint": ""}'},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert "task_id" in body
    assert "stream_url" in body


def test_compare_route_accepts_local_image_refs(monkeypatch, tmp_path) -> None:
    """서버 이미지 ref 두 개 → 브라우저 CORS fetch 없이 백엔드가 로컬 파일로 읽음."""
    studio_dir = tmp_path / "studio"
    monkeypatch.setattr(storage, "STUDIO_OUTPUT_DIR", studio_dir)

    source_path = studio_dir / "generate" / "2026-05-13" / "gen-1039-001.png"
    result_path = studio_dir / "edit" / "2026-05-13" / "edit-1040-001.png"
    source_path.parent.mkdir(parents=True)
    result_path.parent.mkdir(parents=True)
    source_path.write_bytes(_png_bytes(640, 480))
    result_path.write_bytes(_png_bytes(800, 600))

    client = TestClient(app)
    res = client.post(
        "/api/studio/compare-analyze",
        data={
            "meta": json.dumps(
                {
                    "context": "compare",
                    "sourceRef": "/images/studio/generate/2026-05-13/gen-1039-001.png",
                    "resultRef": "/images/studio/edit/2026-05-13/edit-1040-001.png",
                }
            )
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert "task_id" in body
    assert "stream_url" in body


def test_compare_route_rejects_invalid_image() -> None:
    """text/plain bytes 위장 → 400 invalid image."""
    client = TestClient(app)
    res = client.post(
        "/api/studio/compare-analyze",
        files={
            "source": ("a.txt", b"not an image", "text/plain"),
            "result": ("b.png", _png_bytes(640, 480), "image/png"),
        },
        data={"meta": '{"context": "compare"}'},
    )
    assert res.status_code == 400
    assert "invalid image" in res.json()["detail"].lower()


def test_compare_route_rejects_zero_size_image() -> None:
    """손상된 PNG header (verify 실패) → 400 invalid image."""
    client = TestClient(app)
    # PNG signature 시작은 valid 하지만 chunk 가 깨진 garbage
    res = client.post(
        "/api/studio/compare-analyze",
        files={
            "source": ("a.png", b"\x89PNG\r\n\x1a\n_garbage", "image/png"),
            "result": ("b.png", _png_bytes(640, 480), "image/png"),
        },
        data={"meta": '{"context": "compare"}'},
    )
    assert res.status_code == 400
