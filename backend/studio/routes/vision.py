"""
studio.routes.vision — vision-analyze (단일 이미지 → 9 슬롯 STRICT JSON).

Vision Analyzer 독립 페이지(/vision) 전용. Edit/Compare 와 분리.

Phase 6 (2026-04-27): 동기 JSON 응답 → task-based SSE 로 전환.
  POST /vision-analyze              → { task_id, stream_url } (백그라운드 spawn)
  GET  /vision-analyze/stream/{id}  → SSE (event: stage / done / error)

generate/edit/video 와 동일 패턴 — 진행 모달이 PipelineTimeline 단일 컴포넌트로 통일.
"""

from __future__ import annotations

import io

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from PIL import Image, UnidentifiedImageError

from ..pipelines import _run_vision_analyze_pipeline
from ..schemas import TaskCreated
from ..storage import STUDIO_MAX_IMAGE_BYTES
from ..tasks import TASKS, _new_task
from ._common import _spawn, _stream_task, log, parse_meta_object

router = APIRouter()


@router.post("/vision-analyze", response_model=TaskCreated)
async def create_vision_analyze_task(
    image: UploadFile = File(...),
    meta: str = Form("{}"),
):
    """단일 이미지 비전 분석 요청 (multipart). Phase 6 — task 생성 + SSE.

    meta JSON: {visionModel?, ollamaModel?}
    응답: { task_id, stream_url } — 클라이언트가 stream_url 로 SSE 구독.

    HTTP 200 원칙은 done event payload 안에서 보장 (provider="fallback" 폴백).
    """
    meta_obj = parse_meta_object(meta)

    vision_model_override = (
        meta_obj.get("visionModel") or meta_obj.get("vision_model")
    )
    ollama_model_override = (
        meta_obj.get("ollamaModel") or meta_obj.get("ollama_model")
    )

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(400, "empty image")
    if len(image_bytes) > STUDIO_MAX_IMAGE_BYTES:
        raise HTTPException(
            413,
            f"image too large: {len(image_bytes)} bytes "
            f"(max {STUDIO_MAX_IMAGE_BYTES})",
        )

    # 해상도 추출 — 손상/비-이미지면 400 (Edit/Video 와 동일 정책)
    width = 0
    height = 0
    try:
        with Image.open(io.BytesIO(image_bytes)) as im:
            width, height = im.size
    except UnidentifiedImageError as e:
        raise HTTPException(400, f"invalid image format: {e}") from e
    except Exception as dim_err:
        log.info("vision-analyze PIL size read failed (non-fatal): %s", dim_err)

    task = await _new_task()
    task.worker = _spawn(
        _run_vision_analyze_pipeline(
            task,
            image_bytes,
            vision_model=vision_model_override,
            text_model=ollama_model_override,
            width=width,
            height=height,
            size_bytes=len(image_bytes),
        )
    )
    return TaskCreated(
        task_id=task.task_id,
        stream_url=f"/api/studio/vision-analyze/stream/{task.task_id}",
    )


@router.get("/vision-analyze/stream/{task_id}")
async def vision_analyze_stream(task_id: str, request: Request):
    task = TASKS.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return StreamingResponse(
        _stream_task(task, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
