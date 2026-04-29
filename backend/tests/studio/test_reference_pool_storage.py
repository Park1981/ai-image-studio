"""임시 풀 storage 단위 테스트 — 실 PIL bytes + tmp_pool_dir monkeypatch.

Plan: docs/superpowers/plans/2026-04-29-reference-library-v9.md (Phase A.1)
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image


# ─────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────


def make_png_bytes(w: int = 256, h: int = 256, color: str = "red") -> bytes:
    """검증용 실 PNG bytes."""
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color=color).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def tmp_pool_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """임시 풀 디렉토리 fixture — production 오염 방지.

    monkeypatch 로 reference_pool 모듈의 POOL_DIR 을 일회성 바꿈.
    """
    pool_dir = tmp_path / "reference-pool"
    pool_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr("studio.reference_pool.POOL_DIR", pool_dir)
    return pool_dir


# ─────────────────────────────────────────────
# save_to_pool
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_save_to_pool_returns_relative_url_with_trailing_slash_prefix(
    tmp_pool_dir: Path,
) -> None:
    """save_to_pool 이 trailing slash 포함 prefix + .png 형태 반환."""
    from studio.reference_pool import POOL_URL_PREFIX, save_to_pool

    # Codex C6 — trailing slash 보장
    assert POOL_URL_PREFIX.endswith("/")

    img = make_png_bytes()
    rel_url = await save_to_pool(img, "image/png")

    assert rel_url.startswith(POOL_URL_PREFIX)
    assert rel_url.endswith(".png")  # PNG 통일 정책 (Codex C7)

    fname = rel_url[len(POOL_URL_PREFIX) :]
    assert (tmp_pool_dir / fname).exists()


@pytest.mark.asyncio
async def test_save_to_pool_invalid_bytes_raises(tmp_pool_dir: Path) -> None:
    """PIL 검증 실패 → ValueError."""
    from studio.reference_pool import save_to_pool

    with pytest.raises(ValueError, match="invalid image"):
        await save_to_pool(b"not an image", "image/png")


@pytest.mark.asyncio
async def test_save_to_pool_rgb_input_saves_as_png(tmp_pool_dir: Path) -> None:
    """RGB 입력도 PNG 로 저장 (Codex C7 — JPEG 분기 없음)."""
    from studio.reference_pool import save_to_pool

    img = make_png_bytes()  # RGB 모드
    rel_url = await save_to_pool(img, "image/jpeg")  # content_type 무관 PNG

    assert rel_url.endswith(".png")


# ─────────────────────────────────────────────
# is_path_safe / pool_path_from_url
# ─────────────────────────────────────────────


@pytest.mark.parametrize(
    "unsafe_url",
    [
        "/images/studio/reference-pool/../../../etc/passwd",
        "/images/studio/reference-pool/sub/file.png",
        "/images/studio/other/file.png",
        "/images/studio/reference-pool",  # trailing slash 없음
        "/images/studio/reference-pool-evil/file.png",  # prefix collision (Codex C6)
        "../escape.png",
        "",
        "/images/studio/reference-pool/",  # 빈 fname
        "/images/studio/reference-pool/sub\\file.png",  # 윈도우 경로 separator
    ],
)
def test_is_path_safe_rejects_unsafe(unsafe_url: str, tmp_pool_dir: Path) -> None:
    from studio.reference_pool import is_path_safe

    assert is_path_safe(unsafe_url) is False


def test_is_path_safe_accepts_valid(tmp_pool_dir: Path) -> None:
    from studio.reference_pool import is_path_safe

    assert is_path_safe("/images/studio/reference-pool/abc123.png") is True
    assert is_path_safe("/images/studio/reference-pool/abc-def_GHI.png") is True


def test_pool_path_from_url_unsafe_raises(tmp_pool_dir: Path) -> None:
    from studio.reference_pool import pool_path_from_url

    with pytest.raises(ValueError, match="unsafe"):
        pool_path_from_url("../escape.png")


# ─────────────────────────────────────────────
# delete_pool_ref (idempotent)
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_pool_ref_idempotent(tmp_pool_dir: Path) -> None:
    from studio.reference_pool import delete_pool_ref

    # 없는 ref 삭제 — missing_ok=True → True 반환 (idempotent)
    result = await delete_pool_ref(
        "/images/studio/reference-pool/nonexistent.png"
    )
    assert result is True


@pytest.mark.asyncio
async def test_delete_pool_ref_unsafe_raises(tmp_pool_dir: Path) -> None:
    from studio.reference_pool import delete_pool_ref

    with pytest.raises(ValueError, match="unsafe"):
        await delete_pool_ref("../escape.png")


@pytest.mark.asyncio
async def test_delete_pool_ref_removes_existing(tmp_pool_dir: Path) -> None:
    from studio.reference_pool import delete_pool_ref, save_to_pool

    rel_url = await save_to_pool(make_png_bytes(), "image/png")
    fname = rel_url.split("/")[-1]
    assert (tmp_pool_dir / fname).exists()

    ok = await delete_pool_ref(rel_url)
    assert ok is True
    assert not (tmp_pool_dir / fname).exists()


# ─────────────────────────────────────────────
# iter_pool_refs / list_orphan_pool_refs
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_iter_pool_refs_empty(tmp_pool_dir: Path) -> None:
    from studio.reference_pool import iter_pool_refs

    items = [item async for item in iter_pool_refs()]
    assert items == []


@pytest.mark.asyncio
async def test_iter_pool_refs_returns_url_and_size(tmp_pool_dir: Path) -> None:
    from studio.reference_pool import POOL_URL_PREFIX, iter_pool_refs, save_to_pool

    img = make_png_bytes()
    rel_url = await save_to_pool(img, "image/png")

    items = [item async for item in iter_pool_refs()]
    assert len(items) == 1
    url, size = items[0]
    assert url == rel_url
    assert url.startswith(POOL_URL_PREFIX)
    assert size > 0


@pytest.mark.asyncio
async def test_list_orphan_pool_refs(tmp_pool_dir: Path) -> None:
    from studio.reference_pool import list_orphan_pool_refs, save_to_pool

    img = make_png_bytes()
    ref1 = await save_to_pool(img, "image/png")
    ref2 = await save_to_pool(img, "image/png")
    ref3 = await save_to_pool(img, "image/png")

    referenced = {ref1, ref2}  # ref3 만 orphan
    orphans = await list_orphan_pool_refs(referenced)
    assert orphans == [ref3]


@pytest.mark.asyncio
async def test_list_orphan_pool_refs_all_referenced(tmp_pool_dir: Path) -> None:
    from studio.reference_pool import list_orphan_pool_refs, save_to_pool

    img = make_png_bytes()
    ref1 = await save_to_pool(img, "image/png")
    ref2 = await save_to_pool(img, "image/png")

    orphans = await list_orphan_pool_refs({ref1, ref2})
    assert orphans == []


@pytest.mark.asyncio
async def test_list_orphan_pool_refs_all_orphan(tmp_pool_dir: Path) -> None:
    from studio.reference_pool import list_orphan_pool_refs, save_to_pool

    img = make_png_bytes()
    ref1 = await save_to_pool(img, "image/png")
    ref2 = await save_to_pool(img, "image/png")

    orphans = await list_orphan_pool_refs(set())
    assert set(orphans) == {ref1, ref2}
