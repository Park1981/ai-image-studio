"""
studio.routes.streams — generate/edit/video 태스크 생성 + SSE 스트림.

3 모드 모두 동일 패턴:
  POST /{mode}                  → { task_id, stream_url } (백그라운드 spawn)
  GET  /{mode}/stream/{task_id} → SSE (event: stage/step/done/error)

task #17 (2026-04-26): router.py 풀 분해 2탄.
"""

from __future__ import annotations

import io
import json

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from PIL import Image, UnidentifiedImageError

from .. import dispatch_state
from ..pipelines import (
    _EDIT_MAX_IMAGE_BYTES,
    _extract_image_dims,
    _run_edit_pipeline,
    _run_generate_pipeline,
    _run_video_pipeline_task,
    _VIDEO_MAX_IMAGE_BYTES,
)
from ..presets import (
    EDIT_MODEL,
    GENERATE_MODEL,
    VIDEO_LONGER_EDGE_MAX,
    VIDEO_LONGER_EDGE_MIN,
    VIDEO_MODEL,
)
from ..schemas import GenerateBody, TaskCreated
from ..tasks import TASKS, _new_task
from ._common import _spawn, _stream_task, log

router = APIRouter()


# ─────────────────────────────────────────────
# 생성 (Generate)
# ─────────────────────────────────────────────


@router.post("/generate", response_model=TaskCreated)
async def create_generate_task(body: GenerateBody):
    """생성 요청 받으면 백그라운드 파이프라인 spawn, task_id 반환."""
    task = await _new_task()
    # 헤더 VRAM breakdown 오버레이용 — ComfyUI 마지막 dispatch 모델 기록
    dispatch_state.record("generate", GENERATE_MODEL.display_name)
    task.worker = _spawn(_run_generate_pipeline(task, body))
    return TaskCreated(
        task_id=task.task_id,
        stream_url=f"/api/studio/generate/stream/{task.task_id}",
    )


@router.get("/generate/stream/{task_id}")
async def generate_stream(task_id: str, request: Request):
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


# ─────────────────────────────────────────────
# 수정 (Edit)
# ─────────────────────────────────────────────


@router.post("/edit", response_model=TaskCreated)
async def create_edit_task(
    image: UploadFile = File(...),
    meta: str = Form(...),
):
    """수정 요청 (multipart): image 파일 + meta JSON ({ prompt, lightning })."""
    try:
        meta_obj = json.loads(meta)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"meta JSON invalid: {e}") from e

    prompt = meta_obj.get("prompt", "").strip()
    if not prompt:
        raise HTTPException(400, "prompt required")
    lightning = bool(meta_obj.get("lightning", False))
    # 설정에서 override (없으면 프리셋 기본값)
    ollama_model_override = meta_obj.get("ollamaModel") or meta_obj.get("ollama_model")
    vision_model_override = meta_obj.get("visionModel") or meta_obj.get("vision_model")

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(400, "empty image")

    # P1-5 (2026-04-26): size + image 형식 검증 — Vision/Video 와 동일 정책.
    # 이전엔 빈 bytes 만 체크하고 손상/비-이미지 도 통과 → ComfyUI 단계 모호한 실패.
    if len(image_bytes) > _EDIT_MAX_IMAGE_BYTES:
        raise HTTPException(
            413,
            f"image too large: {len(image_bytes)} bytes "
            f"(max {_EDIT_MAX_IMAGE_BYTES})",
        )

    # spec 19 후속 (Codex P1 #1): SOURCE 이미지 dim 추출 → vision 분석에 전달.
    # 이전엔 analyze_edit_source 가 width/height 받게 만들었지만 router 가
    # 안 넘겨서 dead code 였음 (aspect 항상 unknown). 여기서 PIL 한 번 열어
    # 정수 dim 만 추출. P1-5 보강: open 자체 실패 시 400 (손상 이미지 거부).
    source_w, source_h = 0, 0
    try:
        with Image.open(io.BytesIO(image_bytes)) as src_im:
            source_w, source_h = src_im.size
    except UnidentifiedImageError as e:
        # PIL 이 인식 못하는 형식 — 명백히 비-이미지. 즉시 reject.
        raise HTTPException(400, f"invalid image format: {e}") from e
    except Exception as dim_err:
        # 그 외 오류 (예외적 메모리/IO 등) — 0/0 폴백 후 ComfyUI 가 처리.
        log.info(
            "edit source dim extraction failed (non-fatal): %s", dim_err
        )

    task = await _new_task()
    # 헤더 VRAM breakdown 오버레이용 — ComfyUI 마지막 dispatch 모델 기록
    dispatch_state.record("edit", EDIT_MODEL.display_name)
    task.worker = _spawn(
        _run_edit_pipeline(
            task,
            image_bytes,
            prompt,
            lightning,
            image.filename or "input.png",
            ollama_model_override,
            vision_model_override,
            source_width=source_w,
            source_height=source_h,
        )
    )
    return TaskCreated(
        task_id=task.task_id,
        stream_url=f"/api/studio/edit/stream/{task.task_id}",
    )


@router.get("/edit/stream/{task_id}")
async def edit_stream(task_id: str, request: Request):
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


# ─────────────────────────────────────────────
# 영상 (Video, LTX-2.3 i2v)
# ─────────────────────────────────────────────


@router.post("/video", response_model=TaskCreated)
async def create_video_task(
    image: UploadFile = File(...),
    meta: str = Form(...),
):
    """영상 생성 요청 (multipart: image 파일 + meta JSON).

    meta = { prompt, adult?, ollamaModel?, visionModel? }
    """
    try:
        meta_obj = json.loads(meta)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"meta JSON invalid: {e}") from e

    prompt = meta_obj.get("prompt", "").strip()
    if not prompt:
        raise HTTPException(400, "prompt required")

    ollama_override = meta_obj.get("ollamaModel") or meta_obj.get("ollama_model")
    vision_override = meta_obj.get("visionModel") or meta_obj.get("vision_model")
    adult = bool(meta_obj.get("adult", False))
    # Lightning 토글 — 기본 True (4-step 초고속). False 면 full 30-step.
    lightning = bool(meta_obj.get("lightning", True))
    # longerEdge: 사용자 지정 긴 변 픽셀. 누락/0 이면 기본값.
    longer_edge_raw = meta_obj.get("longerEdge") or meta_obj.get("longer_edge")
    longer_edge: int | None = None
    if longer_edge_raw is not None:
        try:
            longer_edge = int(longer_edge_raw)
        except (TypeError, ValueError):
            longer_edge = None
        else:
            # presets.py 범위로 clamp + 8배수 스냅
            longer_edge = max(
                VIDEO_LONGER_EDGE_MIN,
                min(VIDEO_LONGER_EDGE_MAX, (longer_edge // 8) * 8),
            )

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(400, "empty image")
    if len(image_bytes) > _VIDEO_MAX_IMAGE_BYTES:
        raise HTTPException(
            413,
            f"image too large: {len(image_bytes)} bytes "
            f"(max {_VIDEO_MAX_IMAGE_BYTES})",
        )

    # PIL 로 원본 dims 추출 → 비율 유지 리사이즈 계산에 사용
    source_w, source_h = _extract_image_dims(image_bytes)

    task = await _new_task()
    # 헤더 VRAM breakdown 오버레이용 — ComfyUI 마지막 dispatch 모델 기록
    dispatch_state.record("video", VIDEO_MODEL.display_name)
    task.worker = _spawn(
        _run_video_pipeline_task(
            task,
            image_bytes,
            prompt,
            image.filename or "input.png",
            ollama_override,
            vision_override,
            adult,
            source_w,
            source_h,
            longer_edge,
            lightning,
        )
    )
    return TaskCreated(
        task_id=task.task_id,
        stream_url=f"/api/studio/video/stream/{task.task_id}",
    )


@router.get("/video/stream/{task_id}")
async def video_stream(task_id: str, request: Request):
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
