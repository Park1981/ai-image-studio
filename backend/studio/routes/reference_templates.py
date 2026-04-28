"""
studio.routes.reference_templates — Edit reference template 라이브러리 CRUD (v8 plan).

엔드포인트 (prefix=/api/studio):
  - GET    /reference-templates                — 전체 목록 (last_used_at DESC)
  - POST   /reference-templates                — 신규 저장 (multipart image + meta JSON)
  - DELETE /reference-templates/{template_id}  — DB row + 이미지 파일 삭제
  - POST   /reference-templates/{template_id}/touch — last_used_at 갱신

DB insert 실패 시 방금 저장한 reference 파일 자동 unlink (orphan 방지).
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from PIL import UnidentifiedImageError

from .. import history_db
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
