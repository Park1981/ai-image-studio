"""
studio.routes.vision — vision-analyze (단일 이미지 → 9 슬롯 STRICT JSON).

Vision Analyzer 독립 페이지(/vision) 전용. Edit/Compare 와 분리.

task #17 (2026-04-26): router.py 풀 분해 2탄.
"""

from __future__ import annotations

import io
import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from PIL import Image

from .._gpu_lock import GpuBusyError, gpu_slot
from ..vision_pipeline import analyze_image_detailed
from ._common import log

router = APIRouter()

# 20 MB — 프론트 FileReader 에서 dataURL 저장 부담 감안
_VISION_MAX_IMAGE_BYTES = 20 * 1024 * 1024


@router.post("/vision-analyze")
async def vision_analyze(
    image: UploadFile = File(...),
    meta: str = Form("{}"),
):
    """단일 이미지 → 상세 영문 설명 + 한글 번역 (동기 JSON).

    Vision Analyzer 독립 페이지(/vision) 전용. Edit 파이프라인과 분리.
    HTTP 200 원칙 — Ollama 실패 시에도 provider="fallback" 로 반환.
    """
    try:
        meta_obj = json.loads(meta)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"meta JSON invalid: {e}") from e

    vision_model_override = (
        meta_obj.get("visionModel") or meta_obj.get("vision_model")
    )
    ollama_model_override = (
        meta_obj.get("ollamaModel") or meta_obj.get("ollama_model")
    )

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(400, "empty image")
    if len(image_bytes) > _VISION_MAX_IMAGE_BYTES:
        raise HTTPException(
            413,
            f"image too large: {len(image_bytes)} bytes "
            f"(max {_VISION_MAX_IMAGE_BYTES})",
        )

    # 해상도 추출 — 실패해도 진행 (0 반환)
    width = 0
    height = 0
    try:
        with Image.open(io.BytesIO(image_bytes)) as im:
            width, height = im.size
    except Exception as e:
        log.warning("vision-analyze PIL size read failed: %s", e)

    try:
        async with gpu_slot("vision-analyze"):
            result = await analyze_image_detailed(
                image_bytes,
                vision_model=vision_model_override,
                text_model=ollama_model_override,
                width=width,
                height=height,
            )
    except GpuBusyError as e:
        raise HTTPException(503, str(e)) from e

    # 응답: 옛 호환 필드 (en/ko) + Vision Recipe v2 9 슬롯 (2026-04-26 spec 18)
    return {
        "en": result.en,
        "ko": result.ko,
        "provider": result.provider,
        "fallback": result.fallback,
        "width": width,
        "height": height,
        "sizeBytes": len(image_bytes),
        # ── v2 신규 9 슬롯 (옛 row 호환: 폴백 시 모두 "") ──
        "summary": result.summary,
        "positivePrompt": result.positive_prompt,
        "negativePrompt": result.negative_prompt,
        "composition": result.composition,
        "subject": result.subject,
        "clothingOrMaterials": result.clothing_or_materials,
        "environment": result.environment,
        "lightingCameraStyle": result.lighting_camera_style,
        "uncertain": result.uncertain,
    }
