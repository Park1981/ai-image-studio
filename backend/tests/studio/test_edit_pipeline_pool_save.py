"""routes/streams.py 의 사용자 직접 업로드 → 임시 풀 저장 흐름 검증 (v9 · Phase A.3).

Plan: docs/superpowers/plans/2026-04-29-reference-library-v9.md
"""

from __future__ import annotations

import io
import json
from pathlib import Path

import pytest
from PIL import Image


def _png_bytes(w: int = 64, h: int = 64) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color=(120, 130, 140)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def patched_pipeline(monkeypatch: pytest.MonkeyPatch) -> dict:
    """_run_edit_pipeline 을 no-op coroutine 으로 교체 — 인자 capture 만."""
    captured: dict = {}

    async def _fake(*args, **kwargs) -> None:
        # 호출 즉시 인자 capture (spawn 후 task 실행 시점)
        captured["args"] = args
        captured["kwargs"] = kwargs

    monkeypatch.setattr("studio.routes.streams._run_edit_pipeline", _fake)
    return captured


@pytest.fixture
def patched_save_to_pool(monkeypatch: pytest.MonkeyPatch) -> dict:
    """save_to_pool 을 mock — 호출 인자 capture + 가짜 URL 반환."""
    captured: dict = {"called": False}

    async def _fake(img_bytes: bytes, content_type: str) -> str:
        captured["called"] = True
        captured["bytes_len"] = len(img_bytes)
        captured["content_type"] = content_type
        return "/images/studio/reference-pool/fake-uuid.png"

    monkeypatch.setattr("studio.routes.streams.save_to_pool", _fake)
    return captured


@pytest.mark.asyncio
async def test_user_upload_calls_save_to_pool_and_passes_pool_url(
    monkeypatch: pytest.MonkeyPatch,
    patched_pipeline: dict,
    patched_save_to_pool: dict,
) -> None:
    """사용자 직접 업로드 (template_id 없음) → save_to_pool 호출 + reference_ref_url 에 임시 풀 URL."""
    import asyncio

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    src = _png_bytes()
    ref = _png_bytes(128, 128)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/edit",
            files={
                "image": ("src.png", io.BytesIO(src), "image/png"),
                "reference_image": ("ref.png", io.BytesIO(ref), "image/png"),
            },
            data={
                "meta": json.dumps(
                    {
                        "prompt": "test",
                        "useReferenceImage": True,
                        "referenceRole": "outfit",
                        # referenceTemplateId 미전송 → 사용자 직접 업로드
                    }
                ),
            },
        )
    assert resp.status_code == 200, resp.text

    # spawn 된 task 가 mock 호출 → 잠시 yield (asyncio scheduling)
    for _ in range(10):
        if patched_pipeline.get("kwargs"):
            break
        await asyncio.sleep(0)

    # save_to_pool 호출됐는지
    assert patched_save_to_pool["called"] is True
    assert patched_save_to_pool["content_type"] == "image/png"
    assert patched_save_to_pool["bytes_len"] > 0

    # reference_ref_url 에 임시 풀 URL 전달
    kwargs = patched_pipeline["kwargs"]
    assert kwargs.get("reference_ref_url") == "/images/studio/reference-pool/fake-uuid.png"
    assert kwargs.get("reference_template_id") is None


@pytest.mark.asyncio
async def test_template_pick_skips_save_to_pool(
    monkeypatch: pytest.MonkeyPatch,
    patched_pipeline: dict,
    patched_save_to_pool: dict,
    tmp_path: Path,
) -> None:
    """라이브러리 픽 (referenceTemplateId 있음, 클라이언트 multipart 없음) →
    save_to_pool 호출 안 함, 영구 라이브러리 URL + 파일 bytes 사용 (C3 fix)."""
    import asyncio

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio import history_db, reference_storage

    # tmp DB + 영구 라이브러리 row
    db_path = tmp_path / "test_history.db"
    monkeypatch.setattr("studio.history_db._DB_PATH", str(db_path))
    await history_db.init_studio_history_db()

    # Codex C3 fix: 서버가 templateId 의 imageRef 를 직접 read → 실제 파일 필요.
    # tmp 디렉토리로 REFERENCE_DIR 도 격리 (영구 디렉토리 오염 방지).
    tmp_ref_dir = tmp_path / "ref-templates"
    tmp_ref_dir.mkdir()
    monkeypatch.setattr(reference_storage, "REFERENCE_DIR", tmp_ref_dir)
    fname = "00000000000000000000000000000001.png"
    (tmp_ref_dir / fname).write_bytes(_png_bytes(128, 128))
    image_url = f"/images/studio/reference-templates/{fname}"

    template_id = await history_db.insert_reference_template(
        {
            "name": "test",
            "imageRef": image_url,
            "roleDefault": "outfit",
            "visionDescription": "ok",
        }
    )

    src = _png_bytes()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/edit",
            files={
                "image": ("src.png", io.BytesIO(src), "image/png"),
                # Codex C3: templateId 만 전송 — multipart reference_image 동시 전송 금지
            },
            data={
                "meta": json.dumps(
                    {
                        "prompt": "test",
                        "useReferenceImage": True,
                        "referenceRole": "outfit",
                        "referenceTemplateId": template_id,
                    }
                ),
            },
        )
    assert resp.status_code == 200, resp.text

    for _ in range(10):
        if patched_pipeline.get("kwargs"):
            break
        await asyncio.sleep(0)

    # save_to_pool 호출 안 됨 (라이브러리 픽이라)
    assert patched_save_to_pool["called"] is False

    # reference_ref_url 에 영구 라이브러리 URL + 파이프라인이 받은 reference_bytes 가 템플릿 파일 bytes
    kwargs = patched_pipeline["kwargs"]
    assert kwargs.get("reference_ref_url") == image_url
    assert kwargs.get("reference_template_id") == template_id
    # C3 핵심: 서버가 템플릿 파일 read → reference_bytes 가 templateId 의 실제 파일 내용
    assert kwargs.get("reference_bytes") == (tmp_ref_dir / fname).read_bytes()


@pytest.mark.asyncio
async def test_no_reference_image_no_pool_save(
    monkeypatch: pytest.MonkeyPatch,
    patched_pipeline: dict,
    patched_save_to_pool: dict,
) -> None:
    """useReferenceImage=false → save_to_pool 안 호출 + reference_ref_url=None."""
    import asyncio

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    src = _png_bytes()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/edit",
            files={"image": ("src.png", io.BytesIO(src), "image/png")},
            data={
                "meta": json.dumps(
                    {
                        "prompt": "test",
                        "useReferenceImage": False,
                    }
                ),
            },
        )
    assert resp.status_code == 200, resp.text

    for _ in range(10):
        if patched_pipeline.get("kwargs"):
            break
        await asyncio.sleep(0)

    assert patched_save_to_pool["called"] is False

    kwargs = patched_pipeline["kwargs"]
    assert kwargs.get("reference_ref_url") is None
    assert kwargs.get("reference_template_id") is None
