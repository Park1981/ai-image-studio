"""
studio.routes.reference_templates — Edit reference template 라이브러리 CRUD (v8 plan).

엔드포인트 (prefix=/api/studio):
  - GET    /reference-templates                — 전체 목록 (last_used_at DESC)
  - POST   /reference-templates                — 신규 저장 (multipart image + meta JSON)
  - DELETE /reference-templates/{template_id}  — DB row + 이미지 파일 삭제
  - POST   /reference-templates/{template_id}/touch — last_used_at 갱신
  - POST   /reference-templates/promote/{history_id} — v9 사후 저장 (임시 풀 → 영구)

DB insert 실패 시 방금 저장한 reference 파일 자동 unlink (orphan 방지).
"""

from __future__ import annotations

import json
import logging
import re

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from PIL import UnidentifiedImageError
from pydantic import BaseModel

from .. import history_db
from ..reference_pool import POOL_URL_PREFIX, pool_path_from_url
from ..reference_storage import (
    analyze_reference,
    delete_reference_file,
    save_reference_image,
)
from ..storage import STUDIO_MAX_IMAGE_BYTES

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/reference-templates")
async def list_templates():
    """저장된 reference templates — last_used_at 내림차순."""
    items = await history_db.list_reference_templates()
    return {"items": items}


@router.post("/reference-templates")
async def create_template(
    image: UploadFile = File(...),
    meta: str = Form(...),
):
    """신규 template 저장 — 이미지 + 메타 + 자동 vision 분석.

    meta = { name: str, role?: str, userIntent?: str, visionModel?: str }

    실패 정책:
      - 이미지 invalid: 400 (저장 X)
      - PIL 재인코딩 실패: 400 (저장 X)
      - DB insert 실패: 저장된 파일 unlink + 500 (orphan 방지)
      - vision 분석 실패: graceful — visionDescription=None 으로 저장 계속
    """
    try:
        meta_obj = json.loads(meta)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"meta JSON invalid: {e}") from e
    # Codex Phase A 리뷰 fix: meta 가 object 가 아니면 (null / list / string)
    # 이후 .get() 이 500 터짐 → 400 으로 친절하게 거부.
    if not isinstance(meta_obj, dict):
        raise HTTPException(400, "meta must be a JSON object")

    name = (meta_obj.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    role = meta_obj.get("role")
    user_intent = meta_obj.get("userIntent")
    vision_model = meta_obj.get("visionModel")

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(400, "empty image")
    if len(image_bytes) > STUDIO_MAX_IMAGE_BYTES:
        raise HTTPException(
            413,
            f"image too large: {len(image_bytes)} bytes (max {STUDIO_MAX_IMAGE_BYTES})",
        )

    # 1) PIL 검증 + 영구 저장
    try:
        image_url = save_reference_image(image_bytes)
    except UnidentifiedImageError as e:
        raise HTTPException(400, f"invalid image format: {e}") from e

    # 2) Vision 분석 (실패 graceful — None 저장)
    try:
        vision_desc = await analyze_reference(
            image_bytes, role, user_intent, vision_model=vision_model
        )
    except Exception as e:
        log.warning("vision 분석 예외 (graceful): %s", e)
        vision_desc = None

    # 3) DB insert — 실패 시 파일 롤백
    try:
        new_id = await history_db.insert_reference_template(
            {
                "imageRef": image_url,
                "name": name,
                "visionDescription": vision_desc,
                "userIntent": user_intent,
                "roleDefault": role,
            }
        )
    except Exception as e:
        # Orphan 방지 — 방금 저장한 파일 정리
        delete_reference_file(image_url)
        log.exception("reference template DB insert 실패 — 파일 롤백")
        raise HTTPException(500, f"db insert failed: {e}") from e

    saved = await history_db.get_reference_template(new_id)
    return {"item": saved}


@router.delete("/reference-templates/{template_id}")
async def delete_template(template_id: str):
    """삭제 — DB row + 이미지 파일 모두 정리.

    Soft 정책: 옛 history 의 reference_ref URL 은 보존 (이미지만 깨짐 표시).
    """
    deleted, image_ref = await history_db.delete_reference_template(template_id)
    if not deleted:
        raise HTTPException(404, "template not found")
    if image_ref:
        delete_reference_file(image_ref)
    return {"ok": True}


@router.post("/reference-templates/{template_id}/touch")
async def touch_template(template_id: str):
    """last_used_at 갱신 — 사용자가 이 템플릿으로 수정 실행 시."""
    ok = await history_db.touch_reference_template(template_id)
    if not ok:
        raise HTTPException(404, "template not found")
    return {"ok": True}


# ─────────────────────────────────────────────
# v9 (2026-04-29) — 사후 저장 promote endpoint
# ─────────────────────────────────────────────


class _PromoteBody(BaseModel):
    name: str
    role: str | None = None  # promote 시 사용자가 role 변경 가능 (옵션 — 없으면 history 의 referenceRole)
    userIntent: str | None = None  # promote 시 사용자가 의도 추가 가능 (옵션)


# 1~64자 + alphanumeric/한글/공백/하이픈/언더스코어
_NAME_PATTERN = re.compile(r"^[A-Za-z0-9가-힣\s_\-]{1,64}$")


@router.post("/reference-templates/promote/{history_id}")
async def promote_from_history(history_id: str, body: _PromoteBody) -> dict:
    """v9 사후 저장 — 임시 풀 ref 를 영구 라이브러리로 promote.

    흐름:
      1. history.referenceRef 가 임시 풀 URL 인지 검증 (pool_path_from_url 활용)
      2. 임시 풀 파일 read → save_reference_image() (영구 저장 + PIL 재인코딩)
      3. analyze_reference() — 실패 시 visionFailed=True silent
      4. insert_reference_template — 실패 시 dst unlink rollback
      5. studio_history.reference_ref → 영구 URL 로 swap (canPromote 자동 false)

    Plan: 2026-04-29-reference-library-v9.md (Phase A.5)
    """
    name = body.name.strip()
    if not _NAME_PATTERN.match(name):
        raise HTTPException(
            400,
            "invalid name (1~64자, alphanumeric/한글/공백/하이픈/언더스코어 only)",
        )

    # 1. history 조회
    item = await history_db.get_item(history_id)
    if item is None:
        raise HTTPException(404, f"history not found: {history_id}")

    pool_ref = item.get("referenceRef") or ""
    if not pool_ref.startswith(POOL_URL_PREFIX):
        raise HTTPException(
            400,
            "history has no pool reference (NULL or already a permanent ref)",
        )

    # 2. 임시 풀 파일 read (안전 검증 통과 후만)
    try:
        src_path = pool_path_from_url(pool_ref)
    except ValueError as e:
        raise HTTPException(400, f"unsafe pool ref: {e}") from e

    if not src_path.exists():
        raise HTTPException(404, "pool file missing on disk")

    image_bytes = src_path.read_bytes()

    # 3. 영구 저장 (PIL 재인코딩 + path 정규화 — save_reference_image 재사용)
    try:
        image_url = save_reference_image(image_bytes)
    except UnidentifiedImageError as e:
        raise HTTPException(400, f"invalid pool image format: {e}") from e

    # 4. Vision 분석 (실패 silent — Codex I6)
    role = (body.role or item.get("referenceRole") or "custom") or "custom"
    user_intent = body.userIntent
    vision_desc: str | None = None
    vision_failed = False
    try:
        vision_desc = await analyze_reference(image_bytes, role, user_intent)
    except Exception as e:
        log.warning("promote vision 분석 실패 (graceful): %s", e)
        vision_desc = None
        vision_failed = True

    # 5. DB row insert — 실패 시 영구 파일 rollback (Codex I5)
    try:
        new_id = await history_db.insert_reference_template(
            {
                "imageRef": image_url,
                "name": name,
                "visionDescription": vision_desc,
                "userIntent": user_intent,
                "roleDefault": role,
            }
        )
    except Exception as e:
        delete_reference_file(image_url)
        log.exception("promote DB insert 실패 — 파일 롤백")
        raise HTTPException(500, f"db insert failed: {e}") from e

    # 6. studio_history.reference_ref swap — conditional (Codex C4 fix 2026-04-30).
    #    옛 흐름: unconditional UPDATE → 동시 promote 시 서로 다른 template row +
    #    영구 파일 N개 생성 + 마지막 UPDATE 만 살아남아 orphan 발생.
    #    수정: WHERE reference_ref = pool_ref 조건부 → race 패자는 rowcount==0 →
    #    방금 만든 template row + 영구 파일 rollback + 409 응답.
    # Phase 4.1.1 cleanup (codex Open Question): direct connect+SQL → history_db helper.
    swapped = await history_db.replace_reference_ref_if_current(
        history_id, pool_ref, image_url,
    )
    if not swapped:
        # 다른 promote 요청이 먼저 성공함 — 우리가 만든 row + 파일 모두 rollback
        await history_db.delete_reference_template(new_id)
        delete_reference_file(image_url)
        log.warning(
            "promote race lost (history_id=%s) — template + file rolled back",
            history_id,
        )
        raise HTTPException(
            409,
            "concurrent promote detected — already promoted by another request",
        )

    saved = await history_db.get_reference_template(new_id)
    return {
        "template": saved,
        "visionFailed": vision_failed,
    }
