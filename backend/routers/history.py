"""
히스토리 라우터
- GET /api/history: 생성 이력 목록 (최신순, 페이지네이션)
- GET /api/history/{id}: 이력 상세 조회
- DELETE /api/history/{id}: 이력 삭제
"""

import json
import logging

from fastapi import APIRouter, Query

from database import get_db
from models.schemas import ApiResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/history", tags=["히스토리"])


@router.get("", response_model=ApiResponse[dict])
async def get_history_list(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
):
    """생성 이력 목록 조회 (최신순, 페이지네이션)"""
    offset = (page - 1) * limit

    db = await get_db()
    try:
        # 전체 개수
        cursor = await db.execute("SELECT COUNT(*) FROM generations")
        row = await cursor.fetchone()
        total = row[0] if row else 0

        # 목록 조회
        cursor = await db.execute(
            "SELECT * FROM generations ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
        rows = await cursor.fetchall()

        items = []
        for r in rows:
            items.append({
                "id": r["id"],
                "prompt": r["prompt"],
                "enhanced_prompt": r["enhanced_prompt"],
                "negative_prompt": r["negative_prompt"],
                "width": r["width"],
                "height": r["height"],
                "steps": r["steps"],
                "cfg": r["cfg"],
                "seed": r["seed"],
                "sampler": r["sampler"],
                "scheduler": r["scheduler"],
                "checkpoint": r["checkpoint"],
                "images": json.loads(r["images"]) if r["images"] else [],
                "created_at": r["created_at"],
            })

        return {
            "success": True,
            "data": {
                "items": items,
                "total": total,
                "page": page,
                "limit": limit,
                "has_more": offset + limit < total,
            },
        }
    finally:
        await db.close()


@router.get("/{history_id}", response_model=ApiResponse[dict])
async def get_history_detail(history_id: str):
    """이력 상세 조회"""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM generations WHERE id = ?", (history_id,)
        )
        row = await cursor.fetchone()

        if row is None:
            return {
                "success": False,
                "data": {},
                "error": "존재하지 않는 이력입니다.",
            }

        return {
            "success": True,
            "data": {
                "id": row["id"],
                "prompt": row["prompt"],
                "enhanced_prompt": row["enhanced_prompt"],
                "negative_prompt": row["negative_prompt"],
                "checkpoint": row["checkpoint"],
                "loras": json.loads(row["loras"]) if row["loras"] else [],
                "sampler": row["sampler"],
                "scheduler": row["scheduler"],
                "width": row["width"],
                "height": row["height"],
                "steps": row["steps"],
                "cfg": row["cfg"],
                "seed": row["seed"],
                "images": json.loads(row["images"]) if row["images"] else [],
                "created_at": row["created_at"],
            },
        }
    finally:
        await db.close()


@router.delete("/{history_id}", response_model=ApiResponse[dict])
async def delete_history(history_id: str):
    """이력 삭제"""
    db = await get_db()
    try:
        cursor = await db.execute(
            "DELETE FROM generations WHERE id = ?", (history_id,)
        )
        await db.commit()

        if cursor.rowcount == 0:
            return {
                "success": False,
                "data": {},
                "error": "존재하지 않는 이력입니다.",
            }

        return {
            "success": True,
            "data": {"id": history_id, "message": "이력이 삭제되었습니다."},
        }
    finally:
        await db.close()
