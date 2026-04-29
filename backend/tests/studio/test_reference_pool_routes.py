"""routes/reference_pool.py — stats/orphans/DELETE 통합 테스트 (v9 · Phase A.4).

Plan: docs/superpowers/plans/2026-04-29-reference-library-v9.md
"""

from __future__ import annotations

import io
import time
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image


def _make_png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), color="red").save(buf, format="PNG")
    return buf.getvalue()


def _set_temp_db(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    db_path = tmp_path / "test_history.db"
    monkeypatch.setattr("studio.history_db._DB_PATH", str(db_path))
    return db_path


@pytest.fixture
def tmp_pool_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    pool_dir = tmp_path / "reference-pool"
    pool_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr("studio.reference_pool.POOL_DIR", pool_dir)
    return pool_dir


def _make_history_item(
    item_id: str,
    *,
    reference_ref: str | None = None,
) -> dict:
    return {
        "id": item_id,
        "mode": "edit",
        "prompt": "test",
        "label": "test",
        "imageRef": f"/images/studio/result/{item_id}.png",
        "createdAt": int(time.time() * 1000),
        "referenceRef": reference_ref,
        "lightning": False,
    }


# ─────────────────────────────────────────────
# GET /reference-pool/stats
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_stats_empty(tmp_pool_dir: Path) -> None:
    from main import app  # type: ignore

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.get("/api/studio/reference-pool/stats")

    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 0
    assert data["totalBytes"] == 0


@pytest.mark.asyncio
async def test_get_stats_counts_files(tmp_pool_dir: Path) -> None:
    from main import app  # type: ignore
    from studio.reference_pool import save_to_pool

    await save_to_pool(_make_png_bytes(), "image/png")
    await save_to_pool(_make_png_bytes(), "image/png")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.get("/api/studio/reference-pool/stats")

    data = resp.json()
    assert data["count"] == 2
    assert data["totalBytes"] > 0


# ─────────────────────────────────────────────
# GET /reference-pool/orphans
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_orphans(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    tmp_pool_dir: Path,
) -> None:
    from main import app  # type: ignore
    from studio import history_db
    from studio.reference_pool import save_to_pool

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    referenced = await save_to_pool(_make_png_bytes(), "image/png")
    orphan = await save_to_pool(_make_png_bytes(), "image/png")
    await history_db.insert_item(
        _make_history_item("h1", reference_ref=referenced)
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.get("/api/studio/reference-pool/orphans")

    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 1
    assert data["refs"] == [orphan]


@pytest.mark.asyncio
async def test_get_orphans_all_referenced(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    tmp_pool_dir: Path,
) -> None:
    from main import app  # type: ignore
    from studio import history_db
    from studio.reference_pool import save_to_pool

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    ref1 = await save_to_pool(_make_png_bytes(), "image/png")
    ref2 = await save_to_pool(_make_png_bytes(), "image/png")
    await history_db.insert_item(_make_history_item("h1", reference_ref=ref1))
    await history_db.insert_item(_make_history_item("h2", reference_ref=ref2))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.get("/api/studio/reference-pool/orphans")

    data = resp.json()
    assert data["count"] == 0
    assert data["refs"] == []


# ─────────────────────────────────────────────
# DELETE /reference-pool/orphans
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_orphans(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    tmp_pool_dir: Path,
) -> None:
    from main import app  # type: ignore
    from studio import history_db
    from studio.reference_pool import iter_pool_refs, save_to_pool

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    referenced = await save_to_pool(_make_png_bytes(), "image/png")
    orphan1 = await save_to_pool(_make_png_bytes(), "image/png")
    orphan2 = await save_to_pool(_make_png_bytes(), "image/png")

    await history_db.insert_item(
        _make_history_item("h1", reference_ref=referenced)
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.delete("/api/studio/reference-pool/orphans")

    assert resp.status_code == 200
    data = resp.json()
    assert data["deleted"] == 2
    assert data["totalOrphans"] == 2

    # referenced 만 살아있어야
    remaining = [ref async for ref, _ in iter_pool_refs()]
    assert remaining == [referenced]


@pytest.mark.asyncio
async def test_delete_orphans_empty(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    tmp_pool_dir: Path,
) -> None:
    """디스크에 임시 풀 ref 0건이면 deleted=0."""
    from main import app  # type: ignore
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.delete("/api/studio/reference-pool/orphans")

    data = resp.json()
    assert data["deleted"] == 0
    assert data["totalOrphans"] == 0
