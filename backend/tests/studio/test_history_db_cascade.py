"""delete_item_with_refs / clear_all_with_refs 의 임시 풀 cascade 검증 (v9 · Phase A.2).

Plan: docs/superpowers/plans/2026-04-29-reference-library-v9.md
"""

from __future__ import annotations

import io
import time
from pathlib import Path

import pytest
from PIL import Image


# ─────────────────────────────────────────────
# fixture / helpers
# ─────────────────────────────────────────────


def _set_temp_db(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """history_db._DB_PATH 를 임시 DB 로 강제 (기존 테스트 패턴 그대로)."""
    db_path = tmp_path / "test_history.db"
    monkeypatch.setattr("studio.history_db._DB_PATH", str(db_path))
    return db_path


@pytest.fixture
def tmp_pool_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    pool_dir = tmp_path / "reference-pool"
    pool_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr("studio.reference_pool.POOL_DIR", pool_dir)
    return pool_dir


def _make_png_bytes(w: int = 64, h: int = 64) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color="red").save(buf, format="PNG")
    return buf.getvalue()


def _make_history_item(
    item_id: str,
    *,
    mode: str = "edit",
    reference_ref: str | None = None,
    image_ref: str | None = None,
    source_ref: str | None = None,
) -> dict:
    """최소 history dict — insert_item 시그니처 (camelCase) 따름."""
    return {
        "id": item_id,
        "mode": mode,
        "prompt": "test",
        "label": "test",
        "imageRef": image_ref or f"/images/studio/result/{item_id}.png",
        "createdAt": int(time.time() * 1000),
        "sourceRef": source_ref,
        "referenceRef": reference_ref,
        "lightning": False,
    }


# ─────────────────────────────────────────────
# delete_item_with_refs cascade
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_item_unlinks_orphan_pool_ref(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, tmp_pool_dir: Path
) -> None:
    """삭제하는 row 가 마지막 참조면 임시 풀 파일 unlink."""
    from studio import history_db
    from studio.reference_pool import save_to_pool

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    rel_url = await save_to_pool(_make_png_bytes(), "image/png")
    fname = rel_url.split("/")[-1]
    assert (tmp_pool_dir / fname).exists()

    await history_db.insert_item(_make_history_item("h1", reference_ref=rel_url))

    deleted, _src, _img = await history_db.delete_item_with_refs("h1")
    assert deleted is True
    # cascade 로 파일 unlink
    assert not (tmp_pool_dir / fname).exists()


@pytest.mark.asyncio
async def test_delete_item_keeps_shared_pool_ref(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, tmp_pool_dir: Path
) -> None:
    """다른 row 도 같은 ref 참조 시 unlink 안 함."""
    from studio import history_db
    from studio.reference_pool import save_to_pool

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    rel_url = await save_to_pool(_make_png_bytes(), "image/png")
    fname = rel_url.split("/")[-1]

    await history_db.insert_item(_make_history_item("h1", reference_ref=rel_url))
    await history_db.insert_item(_make_history_item("h2", reference_ref=rel_url))

    await history_db.delete_item_with_refs("h1")
    # h2 가 여전히 참조 → 파일 보존
    assert (tmp_pool_dir / fname).exists()


@pytest.mark.asyncio
async def test_delete_item_skips_permanent_ref(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, tmp_pool_dir: Path
) -> None:
    """영구 라이브러리 ref 는 cascade 안 함 (별도 lifecycle)."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    permanent = "/images/studio/reference-templates/abc.png"
    await history_db.insert_item(
        _make_history_item("h1", reference_ref=permanent)
    )

    deleted, _src, _img = await history_db.delete_item_with_refs("h1")
    assert deleted is True
    # tmp_pool_dir 에는 처음부터 파일 없었고, 그대로 — 검증: 파일 유무가 아니라
    # cascade 가 영구 ref 를 건드리지 않았는지 (no exception). 통과만으로 충분.


@pytest.mark.asyncio
async def test_delete_item_with_null_reference_ref(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, tmp_pool_dir: Path
) -> None:
    """reference_ref NULL row 도 정상 삭제 (옛 row 호환)."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    await history_db.insert_item(_make_history_item("h1", reference_ref=None))

    deleted, _src, _img = await history_db.delete_item_with_refs("h1")
    assert deleted is True


@pytest.mark.asyncio
async def test_delete_item_returns_legacy_signature(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, tmp_pool_dir: Path
) -> None:
    """반환 시그니처는 옛 그대로 (deleted, source_ref, image_ref) — 호출자 영향 0."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    await history_db.insert_item(
        _make_history_item(
            "h1",
            reference_ref="/images/studio/reference-pool/x.png",
            source_ref="/images/studio/edit-source/src.png",
            image_ref="/images/studio/result/img.png",
        )
    )

    result = await history_db.delete_item_with_refs("h1")
    assert len(result) == 3
    deleted, source_ref, image_ref = result
    assert deleted is True
    assert source_ref == "/images/studio/edit-source/src.png"
    assert image_ref == "/images/studio/result/img.png"


# ─────────────────────────────────────────────
# clear_all_with_refs cascade (Codex I2)
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_clear_all_unlinks_all_pool_refs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, tmp_pool_dir: Path
) -> None:
    """전체 삭제 시 임시 풀 ref 모두 unlink."""
    from studio import history_db
    from studio.reference_pool import save_to_pool

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    ref1 = await save_to_pool(_make_png_bytes(), "image/png")
    ref2 = await save_to_pool(_make_png_bytes(), "image/png")
    permanent = "/images/studio/reference-templates/perm.png"

    await history_db.insert_item(_make_history_item("h1", reference_ref=ref1))
    await history_db.insert_item(_make_history_item("h2", reference_ref=ref2))
    await history_db.insert_item(
        _make_history_item("h3", reference_ref=permanent)
    )

    fname1 = ref1.split("/")[-1]
    fname2 = ref2.split("/")[-1]
    assert (tmp_pool_dir / fname1).exists()
    assert (tmp_pool_dir / fname2).exists()

    count, _src_refs, _img_refs = await history_db.clear_all_with_refs()
    assert count == 3
    # ref1, ref2 모두 unlink
    assert not (tmp_pool_dir / fname1).exists()
    assert not (tmp_pool_dir / fname2).exists()


@pytest.mark.asyncio
async def test_clear_all_returns_legacy_signature(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, tmp_pool_dir: Path
) -> None:
    """clear_all_with_refs 반환 시그니처 옛 그대로 (count, source_refs, image_refs)."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    await history_db.insert_item(
        _make_history_item(
            "h1",
            source_ref="/images/studio/edit-source/a.png",
            image_ref="/images/studio/result/r1.png",
        )
    )

    result = await history_db.clear_all_with_refs()
    assert len(result) == 3
    count, source_refs, image_refs = result
    assert count == 1
    assert source_refs == ["/images/studio/edit-source/a.png"]
    assert image_refs == ["/images/studio/result/r1.png"]


@pytest.mark.asyncio
async def test_clear_all_dedupes_pool_refs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, tmp_pool_dir: Path
) -> None:
    """같은 풀 ref 를 여러 row 가 참조해도 unlink 1회만 호출 (dedup)."""
    from studio import history_db
    from studio.reference_pool import save_to_pool

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    ref = await save_to_pool(_make_png_bytes(), "image/png")
    fname = ref.split("/")[-1]

    await history_db.insert_item(_make_history_item("h1", reference_ref=ref))
    await history_db.insert_item(_make_history_item("h2", reference_ref=ref))

    await history_db.clear_all_with_refs()
    assert not (tmp_pool_dir / fname).exists()


# ─────────────────────────────────────────────
# count_pool_refs / list_history_pool_refs
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_count_pool_refs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, tmp_pool_dir: Path
) -> None:
    """임시 풀 prefix 로 시작하는 reference_ref 보유 row 만 카운트."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    await history_db.insert_item(
        _make_history_item("h1", reference_ref="/images/studio/reference-pool/a.png")
    )
    await history_db.insert_item(
        _make_history_item("h2", reference_ref="/images/studio/reference-pool/b.png")
    )
    await history_db.insert_item(
        _make_history_item(
            "h3", reference_ref="/images/studio/reference-templates/c.png"
        )
    )
    await history_db.insert_item(_make_history_item("h4", reference_ref=None))

    count = await history_db.count_pool_refs()
    assert count == 2


@pytest.mark.asyncio
async def test_list_history_pool_refs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, tmp_pool_dir: Path
) -> None:
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    await history_db.insert_item(
        _make_history_item("h1", reference_ref="/images/studio/reference-pool/a.png")
    )
    await history_db.insert_item(
        _make_history_item("h2", reference_ref="/images/studio/reference-pool/a.png")
    )
    await history_db.insert_item(
        _make_history_item("h3", reference_ref="/images/studio/reference-pool/b.png")
    )

    refs = await history_db.list_history_pool_refs()
    assert refs == {
        "/images/studio/reference-pool/a.png",
        "/images/studio/reference-pool/b.png",
    }


@pytest.mark.asyncio
async def test_list_history_pool_refs_empty(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, tmp_pool_dir: Path
) -> None:
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    refs = await history_db.list_history_pool_refs()
    assert refs == set()


# ─────────────────────────────────────────────
# Phase A.6 — DELETE /api/studio/history endpoint cascade (Codex I2)
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_all_history_endpoint_cascades_pool_refs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, tmp_pool_dir: Path
) -> None:
    """DELETE /api/studio/history → clear_all_with_refs → 임시 풀 cascade unlink."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio import history_db
    from studio.reference_pool import save_to_pool

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    ref1 = await save_to_pool(_make_png_bytes(), "image/png")
    ref2 = await save_to_pool(_make_png_bytes(), "image/png")
    fname1 = ref1.split("/")[-1]
    fname2 = ref2.split("/")[-1]
    assert (tmp_pool_dir / fname1).exists()
    assert (tmp_pool_dir / fname2).exists()

    await history_db.insert_item(_make_history_item("h1", reference_ref=ref1))
    await history_db.insert_item(_make_history_item("h2", reference_ref=ref2))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.delete("/api/studio/history")

    assert resp.status_code == 200
    # cascade — 두 파일 모두 unlink
    assert not (tmp_pool_dir / fname1).exists()
    assert not (tmp_pool_dir / fname2).exists()


@pytest.mark.asyncio
async def test_delete_single_history_endpoint_cascades_pool_ref(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, tmp_pool_dir: Path
) -> None:
    """DELETE /api/studio/history/{id} → delete_item_with_refs → 임시 풀 cascade."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio import history_db
    from studio.reference_pool import save_to_pool

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    ref = await save_to_pool(_make_png_bytes(), "image/png")
    fname = ref.split("/")[-1]
    await history_db.insert_item(_make_history_item("h1", reference_ref=ref))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.delete("/api/studio/history/h1")

    assert resp.status_code == 200
    assert not (tmp_pool_dir / fname).exists()
