"""임시 풀 (reference-pool) 디스크 저장 + cascade cleanup 헬퍼.

영구 라이브러리 (reference_templates · reference_storage.py) 와 분리:
- 임시 풀: 사용자 직접 업로드 reference 가 자동 저장 (history row 와 lifecycle 묶임)
- 영구 라이브러리: 사용자 명시 promote 시에만 (별도 storage)

Cascade cleanup:
- history_db.delete_item_with_refs / clear_all_with_refs 가 임시 풀 ref 도 함께 unlink
- routes/reference_pool.py 의 DELETE /orphans 가 디스크 상 고아만 일괄 삭제

URL prefix: f"{STUDIO_URL_PREFIX}/reference-pool/" — **trailing slash 포함**.
   → "/images/studio/reference-pool" prefix 우회 (예: ".../reference-pool-evil") 차단.

PNG 통일: 입력 모드 무관 PNG 저장. 영구 storage 와 다른 정책 — promote 시 그대로 복사.

Plan: docs/superpowers/plans/2026-04-29-reference-library-v9.md (Phase A.1)
"""

from __future__ import annotations

import asyncio
import io
import logging
from pathlib import Path
from typing import AsyncIterator
from uuid import uuid4

from PIL import Image

from .storage import STUDIO_OUTPUT_DIR, STUDIO_URL_PREFIX

logger = logging.getLogger(__name__)

# 임시 풀 영구 저장 경로 (storage 의 STUDIO_OUTPUT_DIR 기반)
POOL_DIR: Path = STUDIO_OUTPUT_DIR / "reference-pool"
POOL_DIR.mkdir(parents=True, exist_ok=True)

# URL prefix — trailing slash 포함 (collision 방어 · Codex C6)
POOL_URL_PREFIX: str = f"{STUDIO_URL_PREFIX}/reference-pool/"


# ─────────────────────────────────────────────
# Path traversal 보안 + 공용 검증 헬퍼
# ─────────────────────────────────────────────


def is_path_safe(rel_url: str) -> bool:
    """상대 URL 이 POOL_DIR 안에 있는지 검증.

    1. POOL_URL_PREFIX (trailing slash 포함) 로 시작
    2. prefix 제거 후 fname 에 `/` `\\` `..` 또는 빈 문자 없음
    3. 실제 (POOL_DIR / fname).resolve() 가 POOL_DIR 안에 있음
    """
    if not rel_url.startswith(POOL_URL_PREFIX):
        return False
    fname = rel_url[len(POOL_URL_PREFIX):]
    if not fname or "/" in fname or "\\" in fname or ".." in fname:
        return False
    try:
        resolved = (POOL_DIR / fname).resolve()
        return resolved.parent == POOL_DIR.resolve()
    except (OSError, ValueError):
        return False


def pool_path_from_url(rel_url: str) -> Path:
    """상대 URL → 디스크 Path. 안전 검증 통과 시에만 반환.

    Codex C6: startswith + slice 직접 사용 금지 — 이 헬퍼 통해서만.
    """
    if not is_path_safe(rel_url):
        raise ValueError(f"unsafe pool ref: {rel_url}")
    fname = rel_url[len(POOL_URL_PREFIX):]
    return POOL_DIR / fname


# ─────────────────────────────────────────────
# 저장 (PNG 통일 · Codex C7)
# ─────────────────────────────────────────────


async def save_to_pool(img_bytes: bytes, content_type: str) -> str:
    """이미지 bytes 를 임시 풀에 저장하고 상대 URL 반환.

    PIL 로 검증 + PNG 재인코딩 (모드 무관).

    Returns: POOL_URL_PREFIX + <uuid>.png
    Raises: ValueError if not a valid image
    """

    def _decode_and_re_encode_png() -> bytes:
        # 1. verify (corruption 차단)
        try:
            with Image.open(io.BytesIO(img_bytes)) as img:
                img.verify()
        except Exception as e:
            raise ValueError(f"invalid image: {e}") from e

        # 2. verify 후 재open 필수 (PIL idiom)
        with Image.open(io.BytesIO(img_bytes)) as img:
            buf = io.BytesIO()
            # 모드 무관 PNG (RGBA/LA 보존, RGB 도 PNG, P 모드는 RGBA 변환)
            if img.mode == "P":
                img = img.convert("RGBA")
            img.save(buf, format="PNG", optimize=True)
            return buf.getvalue()

    encoded = await asyncio.to_thread(_decode_and_re_encode_png)

    fname = f"{uuid4().hex}.png"
    target = POOL_DIR / fname
    await asyncio.to_thread(target.write_bytes, encoded)

    return f"{POOL_URL_PREFIX}{fname}"


# ─────────────────────────────────────────────
# 삭제 (race 안전 + 로그 · Codex M2)
# ─────────────────────────────────────────────


async def delete_pool_ref(rel_url: str) -> bool:
    """임시 풀 ref 삭제. 안전 검증 + 파일 unlink.

    Returns: True (삭제 또는 이미 없음 — idempotent).
    Raises: ValueError if path unsafe.
    """
    target = pool_path_from_url(rel_url)
    try:
        await asyncio.to_thread(target.unlink, missing_ok=True)
        return True
    except OSError as e:
        logger.warning("pool unlink failed: %s — %s", rel_url, e)
        return False


# ─────────────────────────────────────────────
# 조회 / Orphan 검출
# ─────────────────────────────────────────────


async def iter_pool_refs() -> AsyncIterator[tuple[str, int]]:
    """모든 임시 풀 ref 와 파일 크기 (bytes) 순회.

    Yields: (rel_url, size_bytes)
    """

    def _list_sync() -> list[tuple[str, int]]:
        result: list[tuple[str, int]] = []
        if not POOL_DIR.exists():
            return result
        for p in POOL_DIR.iterdir():
            if p.is_file():
                result.append((f"{POOL_URL_PREFIX}{p.name}", p.stat().st_size))
        return result

    items = await asyncio.to_thread(_list_sync)
    for item in items:
        yield item


async def list_orphan_pool_refs(referenced_urls: set[str]) -> list[str]:
    """history 에서 참조 안 된 임시 풀 ref 목록.

    Args:
        referenced_urls: studio_history.reference_ref 중 *POOL_URL_PREFIX 로 시작하는* 값들
    Returns: 디스크에 있지만 referenced_urls 에 없는 rel_url list
    """
    orphans: list[str] = []
    async for rel_url, _size in iter_pool_refs():
        if rel_url not in referenced_urls:
            orphans.append(rel_url)
    return orphans
