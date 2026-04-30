"""
history_db/items.py — studio_history 테이블의 행 단위 CRUD (Phase 4.1 단계 3.2).

생성/수정 결과 (HistoryItem) 의 insert / list / get / delete + comparison 갱신
+ _row_to_item dict 변환 helper. row 수정 작업이라 update_comparison 도 본 모듈.
"""

from __future__ import annotations

import json
import time
from typing import Any

import aiosqlite

from . import _config as _cfg


async def insert_item(item: dict[str, Any]) -> None:
    """생성/수정 완료 아이템 저장.

    spec 19 후속 (v6): item.get("refinedIntent") 도 함께 저장 (Edit 한 사이클의
    gemma4 정제 결과 캐시 — 비교 분석에서 재사용). generate/video 는 None.
    """
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        await db.execute(
            """INSERT OR REPLACE INTO studio_history
            (id, mode, prompt, label, width, height, seed, steps, cfg, lightning,
             model, created_at, image_ref, upgraded_prompt, upgraded_prompt_ko,
             prompt_provider, research_hints, vision_description, comfy_error,
             source_ref, comparison_analysis,
             adult, duration_sec, fps, frame_count, refined_intent,
             reference_ref, reference_role)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                item["id"],
                item["mode"],
                item["prompt"],
                item["label"],
                item.get("width"),
                item.get("height"),
                item.get("seed"),
                item.get("steps"),
                item.get("cfg"),
                1 if item.get("lightning") else 0,
                item.get("model"),
                int(item.get("createdAt", time.time() * 1000)),
                item["imageRef"],
                item.get("upgradedPrompt"),
                item.get("upgradedPromptKo"),
                item.get("promptProvider"),
                json.dumps(item.get("researchHints") or [], ensure_ascii=False),
                item.get("visionDescription"),
                item.get("comfyError"),
                item.get("sourceRef"),
                # 분석은 별도 update_comparison 으로 갱신 — insert 시점엔 항상 None
                None,
                # v5: video 전용 메타 — generate/edit 은 None
                (1 if item.get("adult") else 0) if item.get("adult") is not None else None,
                item.get("durationSec"),
                item.get("fps"),
                item.get("frameCount"),
                # v6 (spec 19 후속): refined_intent — Edit 만 채움, 나머지 None
                item.get("refinedIntent"),
                # v7 (2026-04-27): Edit multi-reference — 토글 OFF 면 둘 다 None.
                # reference_ref = Library plan 의 영구 URL (Phase 5 단계는 항상 None).
                item.get("referenceRef"),
                item.get("referenceRole"),
            ),
        )
        await db.commit()

async def list_items(
    mode: str | None = None,
    limit: int = 50,
    before_ts: int | None = None,
) -> list[dict[str, Any]]:
    """최신순 목록. before_ts 가 있으면 그보다 이전 것만 (pagination cursor)."""
    where = []
    params: list[Any] = []
    if mode in ("generate", "edit", "video"):
        where.append("mode = ?")
        params.append(mode)
    if before_ts:
        where.append("created_at < ?")
        params.append(int(before_ts))
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    sql = (
        f"SELECT * FROM studio_history {where_sql} "
        "ORDER BY created_at DESC LIMIT ?"
    )
    params.append(int(limit))

    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(sql, params)
        rows = await cur.fetchall()
    return [_row_to_item(r) for r in rows]

async def get_item(item_id: str) -> dict[str, Any] | None:
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM studio_history WHERE id = ?", (item_id,)
        )
        row = await cur.fetchone()
    return _row_to_item(row) if row else None

async def delete_item(item_id: str) -> bool:
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            "DELETE FROM studio_history WHERE id = ?", (item_id,)
        )
        await db.commit()
        return cur.rowcount > 0

async def update_comparison(
    item_id: str, analysis: dict[str, Any]
) -> bool:
    """비교 분석 결과를 JSON 직렬화로 저장.

    Returns:
        rowcount > 0 (해당 id 의 row 가 존재하고 갱신됐으면 True).
    """
    payload = json.dumps(analysis, ensure_ascii=False)
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        cur = await db.execute(
            "UPDATE studio_history SET comparison_analysis = ? WHERE id = ?",
            (payload, item_id),
        )
        await db.commit()
        return cur.rowcount > 0

def _row_to_item(row: aiosqlite.Row) -> dict[str, Any]:
    """row → 프론트 HistoryItem shape."""
    hints_raw = row["research_hints"]
    try:
        hints = json.loads(hints_raw) if hints_raw else []
    except Exception:
        hints = []
    # upgraded_prompt_ko 는 ALTER 로 추가된 컬럼이라 오래된 row 에서는 없을 수 있음
    try:
        upgraded_ko = row["upgraded_prompt_ko"]
    except (IndexError, KeyError):
        upgraded_ko = None
    # v4 컬럼 (source_ref, comparison_analysis) — 마이그레이션 전 row 호환
    try:
        source_ref = row["source_ref"]
    except (IndexError, KeyError):
        source_ref = None
    try:
        comp_raw = row["comparison_analysis"]
        comp_obj = json.loads(comp_raw) if comp_raw else None
    except (IndexError, KeyError, json.JSONDecodeError):
        comp_obj = None

    # v5 컬럼 (video 전용 — adult/duration_sec/fps/frame_count) — 마이그레이션 전 row 호환
    def _safe(name: str) -> Any:
        try:
            return row[name]
        except (IndexError, KeyError):
            return None

    adult_raw = _safe("adult")
    duration_sec = _safe("duration_sec")
    fps = _safe("fps")
    frame_count = _safe("frame_count")
    # v6 (spec 19 후속) — refined_intent (Edit 모드만 채워짐 · 옛 row 는 None)
    refined_intent = _safe("refined_intent")
    # v7 (2026-04-27) — multi-reference (Edit 모드만 채워짐 · 옛 row + generate/video 는 None)
    reference_ref = _safe("reference_ref")
    reference_role = _safe("reference_role")

    item: dict[str, Any] = {
        "id": row["id"],
        "mode": row["mode"],
        "prompt": row["prompt"],
        "label": row["label"],
        "width": row["width"],
        "height": row["height"],
        "seed": row["seed"],
        "steps": row["steps"],
        "cfg": row["cfg"],
        "lightning": bool(row["lightning"]),
        "model": row["model"],
        "createdAt": row["created_at"],
        "imageRef": row["image_ref"],
        "upgradedPrompt": row["upgraded_prompt"],
        "upgradedPromptKo": upgraded_ko,
        "promptProvider": row["prompt_provider"],
        "researchHints": hints,
        "visionDescription": row["vision_description"],
        "comfyError": row["comfy_error"],
        "sourceRef": source_ref,
        "comparisonAnalysis": comp_obj,
    }
    # v5 video 전용 메타는 값이 있을 때만 노출 (generate/edit 은 undefined 유지)
    if adult_raw is not None:
        item["adult"] = bool(adult_raw)
    if duration_sec is not None:
        item["durationSec"] = duration_sec
    if fps is not None:
        item["fps"] = fps
    if frame_count is not None:
        item["frameCount"] = frame_count
    # v6 refined_intent — Edit 모드만 채움 (옛 row + generate/video 는 노출 안함)
    if refined_intent:
        item["refinedIntent"] = refined_intent
    # v7 multi-reference — Edit 모드 multi-ref ON 케이스만 채움 (옛 row 는 노출 안함).
    # camelCase 로 — frontend HistoryItem 타입과 일관.
    if reference_ref is not None:
        item["referenceRef"] = reference_ref
    if reference_role is not None:
        item["referenceRole"] = reference_role
    return item
