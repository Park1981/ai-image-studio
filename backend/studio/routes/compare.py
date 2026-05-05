"""
studio.routes.compare — compare-analyze (Edit 결과 vs 원본 분석).

context 분기:
  edit (default): analyze_pair v3 — 도메인 분기 + 5 슬롯 매트릭스 + 의도 점수
  compare:       analyze_pair_v4 — Vision Compare 재설계 (관찰자→편집자 듀얼 + 5 카테고리 diff)

Phase 6 (2026-04-27): 동기 JSON 응답 → task-based SSE 로 전환.
  POST /compare-analyze              → { task_id, stream_url }
  GET  /compare-analyze/stream/{id}  → SSE (event: stage / done / error)

Task 12 (2026-05-05): per-image-prompt endpoint (단일 응답 · non-SSE).
  POST /compare-analyze/per-image-prompt → PerImagePromptResponse

GPU lock + ComfyUI 충돌 방지 정책은 백그라운드 파이프라인이 그대로 유지.
"""

from __future__ import annotations

import io

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from PIL import Image as PILImage

# Phase 6: 백그라운드 파이프라인 import (compare 도메인 로직 자체는 변경 없음)
from .._gpu_lock import GpuBusyError, gpu_slot
from ..comparison_pipeline import analyze_pair  # noqa: F401 — 옛 테스트 호환 (mock.patch 위치 · v3 edit context)
from ..pipelines import _run_compare_analyze_pipeline
from ..prompt_pipeline import clarify_edit_intent  # noqa: F401 — 옛 테스트 호환 (mock.patch 위치)
from ..schemas import PerImagePromptRequest, PerImagePromptResponse, TaskCreated
from ..storage import STUDIO_MAX_IMAGE_BYTES
from ..tasks import TASKS, _new_task
# Task 12 (V4): per-image t2i prompt endpoint — vision 정공법의 prompt_synthesize 재사용.
from ..vision_pipeline.prompt_synthesize import synthesize_prompt
from ._common import _spawn, _stream_task, parse_meta_object

router = APIRouter()


@router.post("/compare-analyze", response_model=TaskCreated)
async def create_compare_analyze_task(
    source: UploadFile = File(...),
    result: UploadFile = File(...),
    meta: str = Form(...),
):
    """비교 분석 요청 (multipart). Phase 6 — task 생성 + SSE.

    multipart:
      source: 원본 이미지 파일 (Vision Compare 컨텍스트에선 IMAGE_A)
      result: 결과 이미지 파일 (Vision Compare 컨텍스트에선 IMAGE_B)
      meta: JSON {context?, editPrompt?, compareHint?, historyItemId?, visionModel?, ollamaModel?}

    응답: { task_id, stream_url } — 클라이언트가 stream_url 로 SSE 구독.
    """
    meta_obj = parse_meta_object(meta)

    context = (meta_obj.get("context") or "edit").strip().lower()
    edit_prompt = (meta_obj.get("editPrompt") or "").strip()
    compare_hint = (meta_obj.get("compareHint") or "").strip()
    history_item_id_raw = meta_obj.get("historyItemId")
    vision_override = meta_obj.get("visionModel") or meta_obj.get("vision_model")
    text_override = meta_obj.get("ollamaModel") or meta_obj.get("ollama_model")
    # Phase 2 (2026-05-01) — Edit 자동 트리거 케이스에서 Edit 모드 패스스루.
    # 수동 Compare (Vision Compare 메뉴) 는 promptMode 미전달 → fast.
    compare_prompt_mode_raw = meta_obj.get("promptMode") or meta_obj.get("prompt_mode")
    compare_prompt_mode: str = (
        "precise" if isinstance(compare_prompt_mode_raw, str) and compare_prompt_mode_raw == "precise" else "fast"
    )

    source_bytes = await source.read()
    result_bytes = await result.read()
    if not source_bytes or not result_bytes:
        raise HTTPException(400, "empty image (source or result)")
    if (
        len(source_bytes) > STUDIO_MAX_IMAGE_BYTES
        or len(result_bytes) > STUDIO_MAX_IMAGE_BYTES
    ):
        raise HTTPException(413, "image too large")

    # ── Task 10 (V4): PIL verify + size 추출 ──
    # 옛 코드는 bytes 길이만 체크 → text 위장 / 손상 PNG 우회 가능했음.
    # V4 의 observe_image 가 width/height 인자를 요구 (per-image 슬롯 계산용).
    try:
        img_a = PILImage.open(io.BytesIO(source_bytes))
        img_a.verify()
        # verify() 후엔 stream 이 닫혀 size 접근 불가 → 재 open 필수
        img_a = PILImage.open(io.BytesIO(source_bytes))
        source_w, source_h = img_a.size
        if source_w <= 0 or source_h <= 0:
            raise ValueError("zero size")
    except Exception:
        raise HTTPException(400, "invalid image (source)")

    try:
        img_b = PILImage.open(io.BytesIO(result_bytes))
        img_b.verify()
        img_b = PILImage.open(io.BytesIO(result_bytes))
        result_w, result_h = img_b.size
        if result_w <= 0 or result_h <= 0:
            raise ValueError("zero size")
    except Exception:
        raise HTTPException(400, "invalid image (result)")

    task = await _new_task()
    task.worker = _spawn(
        _run_compare_analyze_pipeline(
            task,
            source_bytes=source_bytes,
            result_bytes=result_bytes,
            source_w=source_w,
            source_h=source_h,
            result_w=result_w,
            result_h=result_h,
            context=context,
            edit_prompt=edit_prompt,
            compare_hint=compare_hint,
            history_item_id_raw=history_item_id_raw,
            vision_override=vision_override,
            text_override=text_override,
            prompt_mode=compare_prompt_mode,
        )
    )
    return TaskCreated(
        task_id=task.task_id,
        stream_url=f"/api/studio/compare-analyze/stream/{task.task_id}",
    )


@router.get("/compare-analyze/stream/{task_id}")
async def compare_analyze_stream(task_id: str, request: Request):
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


# ── Task 12 (V4): per-image t2i prompt endpoint ──
# 메인 분석 결과의 observation1/2 중 하나로부터 t2i prompt 5 슬롯을 합성.
# on-demand 호출 (사용자가 결과 화면에서 클릭) — 단일 JSON 응답 (non-SSE).
# Pydantic 모델은 ..schemas 에 박제 (Task 13).
@router.post(
    "/compare-analyze/per-image-prompt",
    response_model=PerImagePromptResponse,
)
async def compare_per_image_prompt(req: PerImagePromptRequest) -> PerImagePromptResponse:
    """observation JSON → t2i prompt 합성 (단일 응답 · non-SSE).

    on-demand 호출 — 메인 분석 후 사용자가 결과 화면에서 클릭. 약 10~20초.
    gpu_slot('compare-per-image-prompt') 안에서 호출 → busy 시 503 + code=gpu_busy.
    """
    if not req.observation:
        raise HTTPException(400, "empty observation")

    text_model = req.ollamaModel or "gemma4-un:latest"
    try:
        async with gpu_slot("compare-per-image-prompt"):
            synth = await synthesize_prompt(
                req.observation,
                text_model=text_model,
                timeout=60.0,
                ollama_url="http://localhost:11434",
            )
    except GpuBusyError as e:
        raise HTTPException(
            status_code=503,
            detail={"code": "gpu_busy", "message": str(e)},
        )

    return PerImagePromptResponse(
        summary=synth.get("summary", "") or "",
        positive_prompt=synth.get("positive_prompt", "") or "",
        negative_prompt=synth.get("negative_prompt", "") or "",
        key_visual_anchors=synth.get("key_visual_anchors", []) or [],
        uncertain=synth.get("uncertain", []) or [],
    )
