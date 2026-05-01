"""
studio.routes.streams — generate/edit/video 태스크 생성 + SSE 스트림.

3 모드 모두 동일 패턴:
  POST /{mode}                  → { task_id, stream_url } (백그라운드 spawn)
  GET  /{mode}/stream/{task_id} → SSE (event: stage/step/done/error)

task #17 (2026-04-26): router.py 풀 분해 2탄.
"""

from __future__ import annotations

import io

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from PIL import Image, UnidentifiedImageError

from .. import dispatch_state, history_db
from ..pipelines import (
    _extract_image_dims,
    _run_edit_pipeline,
    _run_generate_pipeline,
    _run_video_pipeline_task,
)
from ..presets import (
    EDIT_MODEL,
    GENERATE_MODEL,
    VIDEO_LONGER_EDGE_MAX,
    VIDEO_LONGER_EDGE_MIN,
    VIDEO_MODEL,
)
from ..reference_pool import save_to_pool
from ..reference_storage import reference_path_from_url
from ..schemas import GenerateBody, TaskCreated
from ..storage import STUDIO_MAX_IMAGE_BYTES
from ..tasks import TASKS, _new_task
from ._common import _spawn, _stream_task, log, parse_meta_object

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
    reference_image: UploadFile | None = File(None),
):
    """수정 요청 (multipart): image 파일 + meta JSON + 옵션 reference_image."""
    meta_obj = parse_meta_object(meta)

    prompt = meta_obj.get("prompt", "").strip()
    if not prompt:
        raise HTTPException(400, "prompt required")
    lightning = bool(meta_obj.get("lightning", False))
    # 설정에서 override (없으면 프리셋 기본값)
    ollama_model_override = meta_obj.get("ollamaModel") or meta_obj.get("ollama_model")
    vision_model_override = meta_obj.get("visionModel") or meta_obj.get("vision_model")

    # Phase 2 (2026-05-01): gemma4 보강 모드 ("fast" | "precise"). 미전달 / 미인식 → fast.
    prompt_mode_raw = meta_obj.get("promptMode") or meta_obj.get("prompt_mode")
    prompt_mode: str = (
        "precise" if isinstance(prompt_mode_raw, str) and prompt_mode_raw == "precise" else "fast"
    )

    # Multi-reference (2026-04-27): meta 의 토글 + role 파싱.
    # 토글 OFF (기본) 면 옛 단일 이미지 흐름 100% 동일.
    use_reference_image = bool(meta_obj.get("useReferenceImage", False))
    reference_role_raw = meta_obj.get("referenceRole")
    reference_role: str | None = (
        reference_role_raw.strip()
        if isinstance(reference_role_raw, str) and reference_role_raw.strip()
        else None
    )

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(400, "empty image")

    # P1-5 (2026-04-26): size + image 형식 검증 — Vision/Video 와 동일 정책.
    # 이전엔 빈 bytes 만 체크하고 손상/비-이미지 도 통과 → ComfyUI 단계 모호한 실패.
    if len(image_bytes) > STUDIO_MAX_IMAGE_BYTES:
        raise HTTPException(
            413,
            f"image too large: {len(image_bytes)} bytes "
            f"(max {STUDIO_MAX_IMAGE_BYTES})",
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

    # Multi-reference (2026-04-27): reference 이미지 bytes 읽기 (조건부).
    # 토글 OFF 또는 파일 미동봉이면 None — 옛 단일 흐름 100% 동일.
    reference_bytes: bytes | None = None
    reference_filename: str | None = None
    reference_ref_url: str | None = None

    # 메타에서 referenceTemplateId 추출 (서버 권위 경로 분기 키)
    reference_template_id_meta = meta_obj.get("referenceTemplateId")
    if isinstance(reference_template_id_meta, str):
        reference_template_id_meta = reference_template_id_meta.strip() or None
    else:
        reference_template_id_meta = None

    # Codex Phase 1-3 리뷰 fix (2026-04-28): useRef=false 인데 reference_image 가
    # multipart 로 동봉된 silent-drop 케이스. 클라이언트 버그 가시화 + body drain.
    if reference_image is not None and not use_reference_image:
        await reference_image.read()  # drain — body 무시
        log.warning(
            "edit: reference_image multipart 동봉됐지만 useReferenceImage=false → 무시함",
        )

    if use_reference_image:
        # ┌──────────────────────────────────────────────────────────┐
        # │ Codex C3 fix (2026-04-30): 서버 권위 reference_bytes 결정. │
        # │  - referenceTemplateId 있음 → DB tpl["imageRef"] 의 파일 read.│
        # │  - 없음 → 클라이언트 multipart bytes (직접 업로드).          │
        # │ 옛 흐름은 templateId 가 있어도 클라이언트 multipart bytes 를 │
        # │ ComfyUI 에 전달 → "기록은 templateA / 생성은 imageB" 가능. │
        # └──────────────────────────────────────────────────────────┘
        if reference_template_id_meta:
            # 양쪽 동시 동봉은 명시적 거부 — 신뢰 경계 모호 + 클라이언트 버그 가시화
            if reference_image is not None:
                await reference_image.read()  # drain
                raise HTTPException(
                    400,
                    "referenceTemplateId 와 reference_image multipart 를 동시에 보낼 수 없습니다 "
                    "(서버 권위 충돌 방지 — 둘 중 하나만 사용).",
                )
            tpl = await history_db.get_reference_template(reference_template_id_meta)
            if tpl is None:
                raise HTTPException(404, "reference template not found")
            tpl_path = reference_path_from_url(tpl["imageRef"])
            if tpl_path is None or not tpl_path.exists():
                raise HTTPException(
                    410, "reference template file missing on server"
                )
            try:
                reference_bytes = tpl_path.read_bytes()
            except OSError as e:
                raise HTTPException(
                    500, f"reference template read failed: {e}"
                ) from e
            if len(reference_bytes) > STUDIO_MAX_IMAGE_BYTES:
                # 옛 영구 파일이 max 초과 — 정책상 거부 (이론상 발생 거의 X)
                raise HTTPException(
                    413, "reference template file exceeds size limit"
                )
            reference_filename = tpl_path.name
            reference_ref_url = tpl["imageRef"]  # history 기록 = 서버 권위
        elif reference_image is not None:
            # 직접 업로드 경로 — 옛 검증 흐름 그대로
            reference_bytes = await reference_image.read()
            if not reference_bytes:
                reference_bytes = None
            elif len(reference_bytes) > STUDIO_MAX_IMAGE_BYTES:
                raise HTTPException(
                    413,
                    f"reference image too large: {len(reference_bytes)} bytes "
                    f"(max {STUDIO_MAX_IMAGE_BYTES})",
                )
            else:
                try:
                    with Image.open(io.BytesIO(reference_bytes)) as ref_im:
                        _ = ref_im.size  # 손상 검증만
                except UnidentifiedImageError as e:
                    raise HTTPException(
                        400, f"invalid reference image format: {e}"
                    ) from e
                reference_filename = reference_image.filename or "reference.png"
                # v9 (2026-04-29): 임시 풀 저장 → 사후 promote 가능
                try:
                    reference_ref_url = await save_to_pool(
                        reference_bytes,
                        (reference_image.content_type or "image/png"),
                    )
                except ValueError as e:
                    raise HTTPException(400, f"invalid reference image: {e}") from e

    # ⚠️ Backend 게이트 (Codex 리뷰 — zero-regression 보장):
    # reference_bytes 가 None 이면 reference_role 도 None 강제.
    if reference_bytes is None:
        reference_role = None

    # useReferenceImage=true 인데 파일 없는 케이스 거부 (templateId 없고 multipart 도 없음)
    if use_reference_image and reference_bytes is None:
        raise HTTPException(
            400,
            "참조 이미지 토글이 켜져 있는데 reference_image 또는 referenceTemplateId 가 필요합니다.",
        )

    # 토글 OFF 면 stale template/ref 메타도 무효화
    if not use_reference_image:
        reference_ref_url = None
        reference_template_id_meta = None

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
            reference_bytes=reference_bytes,
            reference_filename=reference_filename,
            reference_role=reference_role,
            # v8 라이브러리 plan
            reference_ref_url=reference_ref_url,
            reference_template_id=reference_template_id_meta,
            prompt_mode=prompt_mode,
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
    meta_obj = parse_meta_object(meta)

    prompt = meta_obj.get("prompt", "").strip()
    if not prompt:
        raise HTTPException(400, "prompt required")

    ollama_override = meta_obj.get("ollamaModel") or meta_obj.get("ollama_model")
    vision_override = meta_obj.get("visionModel") or meta_obj.get("vision_model")
    adult = bool(meta_obj.get("adult", False))
    # Lightning 토글 — 기본 True (4-step 초고속). False 면 full 30-step.
    lightning = bool(meta_obj.get("lightning", True))
    # AI 프롬프트 보정 우회 (2026-04-27) — 사용자가 정제된 영문 프롬프트 직접 입력한 케이스.
    # None 또는 빈 문자열이면 평소처럼 vision + gemma4 단계 수행.
    pre_upgraded_raw = (
        meta_obj.get("preUpgradedPrompt") or meta_obj.get("pre_upgraded_prompt")
    )
    pre_upgraded_prompt: str | None = (
        pre_upgraded_raw.strip() if isinstance(pre_upgraded_raw, str) and pre_upgraded_raw.strip() else None
    )
    # Phase 2 (2026-05-01): gemma4 보강 모드 ("fast" | "precise"). 미전달 / 미인식 → fast.
    video_prompt_mode_raw = meta_obj.get("promptMode") or meta_obj.get("prompt_mode")
    video_prompt_mode: str = (
        "precise" if isinstance(video_prompt_mode_raw, str) and video_prompt_mode_raw == "precise" else "fast"
    )
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
    if len(image_bytes) > STUDIO_MAX_IMAGE_BYTES:
        raise HTTPException(
            413,
            f"image too large: {len(image_bytes)} bytes "
            f"(max {STUDIO_MAX_IMAGE_BYTES})",
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
            pre_upgraded_prompt=pre_upgraded_prompt,
            prompt_mode=video_prompt_mode,
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
