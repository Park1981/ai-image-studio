"""
history_db/cascade.py — studio_history 의 cascade 삭제 + 임시 풀 ref 정리
(Phase 4.1 단계 3.3).

audit P1b + v9 Codex I2:
  - DELETE /history/{id} → orphan source/image 파일 정리 (delete_item_with_refs)
  - DELETE /history (clear all) → orphan 일괄 정리 (clear_all_with_refs)
  - 임시 풀 reference_ref cascade unlink (마지막 참조 시)
  - count_/list_ helper (orphan 검출 / promote 정합성 체크)
"""

from __future__ import annotations

import aiosqlite

from . import _config as _cfg
from ._config import _POOL_URL_PREFIX, log


async def delete_item_with_refs(
    item_id: str,
) -> tuple[bool, str | None, str | None]:
    """item 삭제 + 삭제된 row 의 (source_ref, image_ref) 동시 반환.

    audit P1b: DELETE /history/{id} 에서 orphan 파일 정리용으로
    source_ref 를 알아야 함. race condition 없이 DB 내부에서 원자적으로
    조회→삭제 수행 (같은 커넥션으로 순차 실행).

    v9 (2026-04-29 · Codex I2): reference_ref 가 임시 풀 URL 이고 다른 row 가
    참조하지 않으면 임시 풀 파일도 함께 unlink (cascade). 반환 시그니처는 그대로 —
    호출자 (routes/system.py) 영향 0.

    Returns:
        (deleted, source_ref, image_ref). deleted=False 면 나머지는 None.
    """
    pool_ref_to_unlink: str | None = None
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT source_ref, image_ref, reference_ref FROM studio_history WHERE id = ?",
            (item_id,),
        )
        row = await cur.fetchone()
        if row is None:
            return (False, None, None)
        source_ref = row["source_ref"]
        image_ref = row["image_ref"]
        reference_ref = row["reference_ref"]
        cur = await db.execute(
            "DELETE FROM studio_history WHERE id = ?", (item_id,)
        )
        await db.commit()
        deleted = cur.rowcount > 0

        # v9 cascade — 임시 풀 ref 면 마지막 참조 시 unlink 결정
        if (
            deleted
            and reference_ref
            and reference_ref.startswith(_POOL_URL_PREFIX)
        ):
            cur = await db.execute(
                "SELECT 1 FROM studio_history WHERE reference_ref = ? LIMIT 1",
                (reference_ref,),
            )
            shared = await cur.fetchone()
            if shared is None:
                pool_ref_to_unlink = reference_ref

    # DB 트랜잭션 끝난 뒤 unlink (안에서 file IO 부담 안 주기 위해)
    if pool_ref_to_unlink:
        await _safe_pool_unlink(pool_ref_to_unlink)

    return (deleted, source_ref, image_ref)


async def clear_all() -> int:
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute("DELETE FROM studio_history")
        await db.commit()
        return cur.rowcount


async def clear_all_with_refs() -> tuple[int, list[str], list[str]]:
    """전체 삭제 + 삭제된 모든 row 의 (source_refs, image_refs) 반환.

    audit P1b: edit-source/*.png orphan 파일 일괄 정리용.

    v9 (2026-04-29 · Codex I2): 삭제된 row 의 reference_ref 중 임시 풀 URL 인 것 모두
    cascade unlink. 반환 시그니처는 그대로 — 호출자 (routes/system.py:291) 영향 0.

    Returns:
        (deleted_count, source_refs, image_refs). refs 리스트는 NULL 제외.
    """
    pool_refs_to_unlink: list[str] = []
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT source_ref, image_ref, reference_ref FROM studio_history"
        )
        rows = await cur.fetchall()
        source_refs = [r["source_ref"] for r in rows if r["source_ref"]]
        image_refs = [r["image_ref"] for r in rows if r["image_ref"]]
        # v9 cascade — distinct 임시 풀 ref 만 (중복 unlink 방지)
        pool_refs_to_unlink = list(
            {
                r["reference_ref"]
                for r in rows
                if r["reference_ref"]
                and r["reference_ref"].startswith(_POOL_URL_PREFIX)
            }
        )
        cur = await db.execute("DELETE FROM studio_history")
        await db.commit()
        deleted_count = cur.rowcount

    # DB 트랜잭션 끝난 뒤 unlink
    for ref in pool_refs_to_unlink:
        await _safe_pool_unlink(ref)

    return (deleted_count, source_refs, image_refs)


async def _safe_pool_unlink(rel_url: str) -> None:
    """임시 풀 ref 안전 unlink. 순환 import 회피 위해 lazy import.

    실패 (path 검증 실패 / 파일 IO 에러) 는 silent — 로그만 남김.
    """
    try:
        from ..reference_pool import delete_pool_ref

        await delete_pool_ref(rel_url)
    except ValueError as e:
        log.warning("pool cascade unlink unsafe path: %s — %s", rel_url, e)
    except Exception as e:  # noqa: BLE001
        log.warning("pool cascade unlink failed: %s — %s", rel_url, e)


async def count_pool_refs() -> int:
    """studio_history 중 임시 풀 prefix 로 시작하는 reference_ref 보유 row 개수."""
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM studio_history WHERE reference_ref LIKE ?",
            (_POOL_URL_PREFIX + "%",),
        )
        row = await cur.fetchone()
        return int(row[0]) if row else 0


async def list_history_pool_refs() -> set[str]:
    """studio_history 의 임시 풀 reference_ref 모두 set 반환 (orphan 검출용)."""
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            "SELECT DISTINCT reference_ref FROM studio_history WHERE reference_ref LIKE ?",
            (_POOL_URL_PREFIX + "%",),
        )
        rows = await cur.fetchall()
        return {r[0] for r in rows if r[0]}


async def count_source_ref_usage(source_ref: str) -> int:
    """특정 source_ref 를 참조하는 row 개수.

    같은 원본에서 여러 수정을 만드는 경우가 있으므로
    파일 삭제 전에 0건인지 확인해야 안전 (다른 row 가 같은 원본 쓸 수 있음).
    """
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM studio_history WHERE source_ref = ?",
            (source_ref,),
        )
        row = await cur.fetchone()
        return int(row[0]) if row else 0


async def count_image_ref_usage(image_ref: str) -> int:
    """특정 image_ref 를 참조하는 row 개수 (audit R1-6 · result cleanup 용).

    image_ref 는 본래 1:1 매핑이지만, 히스토리 복제/재수정 흐름에서
    중복 참조 가능성이 있으므로 삭제 전 안전 체크.
    """
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM studio_history WHERE image_ref = ?",
            (image_ref,),
        )
        row = await cur.fetchone()
        return int(row[0]) if row else 0
