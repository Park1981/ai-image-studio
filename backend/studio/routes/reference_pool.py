"""GET stats / GET orphans / DELETE orphans endpoints (v9 · Phase A.4).

기존 reference_templates.py 패턴 따라 router prefix 없음 — endpoint 경로에
/reference-pool 직접 박음. studio.routes.__init__.py 가 /api/studio prefix 부여.

Race 완화 (Codex I4): orphan delete 시점에 history snapshot 재조회 (double-check).

Plan: docs/superpowers/plans/2026-04-29-reference-library-v9.md (Phase A.4)
"""

from __future__ import annotations

from fastapi import APIRouter

from .. import history_db
from ..reference_pool import (
    delete_pool_ref,
    iter_pool_refs,
    list_orphan_pool_refs,
)

router = APIRouter(tags=["reference-pool"])


@router.get("/reference-pool/stats")
async def get_pool_stats() -> dict:
    """임시 풀 사용량 — count + total bytes."""
    count = 0
    total = 0
    async for _ref, size in iter_pool_refs():
        count += 1
        total += size
    return {"count": count, "totalBytes": total}


@router.get("/reference-pool/orphans")
async def get_pool_orphans() -> dict:
    """history 에서 참조 안 된 임시 풀 ref 목록."""
    referenced = await history_db.list_history_pool_refs()
    orphans = await list_orphan_pool_refs(referenced)
    return {"refs": orphans, "count": len(orphans)}


@router.delete("/reference-pool/orphans")
async def delete_pool_orphans() -> dict:
    """orphan 일괄 삭제. 영구 라이브러리는 손대지 않음.

    Race 완화 (Codex I4): delete 직전에 history snapshot 다시 조회 (double-check).
    """
    referenced_initial = await history_db.list_history_pool_refs()
    orphans_initial = await list_orphan_pool_refs(referenced_initial)

    deleted = 0
    for ref in orphans_initial:
        # double-check race — delete 직전 snapshot 재조회
        referenced_recheck = await history_db.list_history_pool_refs()
        if ref in referenced_recheck:
            continue  # race — 새 history 가 참조 시작 → skip
        try:
            ok = await delete_pool_ref(ref)
            if ok:
                deleted += 1
        except ValueError:
            # safe 검증 실패는 silent (이미 reference_pool 내부 로그)
            continue

    return {"deleted": deleted, "totalOrphans": len(orphans_initial)}
