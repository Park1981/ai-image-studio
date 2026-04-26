"""
studio/router.py - FastAPI 라우터: /api/studio/*

엔드포인트:
  POST /api/studio/generate          → { task_id, stream_url }
  GET  /api/studio/generate/stream/{task_id}  → SSE
  POST /api/studio/edit              → { task_id, stream_url } (multipart)
  GET  /api/studio/edit/stream/{task_id}      → SSE
  POST /api/studio/video             → { task_id, stream_url } (multipart, LTX-2.3 i2v)
  GET  /api/studio/video/stream/{task_id}     → SSE
  POST /api/studio/upgrade-only      → { upgradedPrompt, ... } (sync)
  POST /api/studio/research          → { hints: [] } (sync)
  POST /api/studio/interrupt         → { ok }
  POST /api/studio/vision-analyze    → { en, ko, provider, ... } (multipart, sync)
  POST /api/studio/compare-analyze   → { analysis, saved } (multipart, sync · mutex 보호)
  GET  /api/studio/models            → 모델 프리셋 (프론트 lib/model-presets.ts 미러)
  GET  /api/studio/ollama/models     → 설치된 Ollama 모델 목록
  GET  /api/studio/process/status    → {ollama:{running}, comfyui:{running}}
  POST /api/studio/process/{name}/{action}  → {ok, message}
  GET  /api/studio/history[/{id}]    → studio_history 조회
  DELETE /api/studio/history[/{id}]  → 삭제

2026-04-26 task #16: router.py 풀 분해 — _run_*_pipeline + ComfyUI 디스패치 헬퍼
모두 studio.pipelines 패키지로 이전. router 는 endpoint 정의 + 입력 검증만 담당.
외부 호환을 위해 pipelines 의 주요 심볼은 본 모듈에서 re-export (test 호환).
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
from dataclasses import asdict
from typing import Any, Awaitable

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from PIL import Image, UnidentifiedImageError

from .presets import (
    ASPECT_RATIOS,
    DEFAULT_OLLAMA_ROLES,
    EDIT_MODEL,
    GENERATE_MODEL,
    VIDEO_MODEL,
    get_aspect,
)
from .prompt_pipeline import clarify_edit_intent, upgrade_generate_prompt
from .claude_cli import research_prompt
from .vision_pipeline import analyze_image_detailed
from .comparison_pipeline import analyze_pair, analyze_pair_generic
from .system_metrics import get_system_metrics, get_vram_breakdown
from . import dispatch_state, ollama_unload
from .comfy_api_builder import _snap_dimension
from .comfy_transport import ComfyUITransport
from . import history_db
from .presets import (
    VIDEO_LONGER_EDGE_MAX as _video_longer_max,
    VIDEO_LONGER_EDGE_MIN as _video_longer_min,
)

# ─────────────────────────────────────────────
# Storage 계층 — task #12 (2026-04-26): storage.py 모듈로 분리
# 외부 호환을 위해 동일 이름 re-export.
# ─────────────────────────────────────────────
from .storage import (  # noqa: E402,F401 — re-export
    EDIT_SOURCE_DIR,
    EDIT_SOURCE_URL_PREFIX,
    STUDIO_OUTPUT_DIR,
    STUDIO_URL_PREFIX,
    TASK_ID_RE as _TASK_ID_RE,  # legacy alias
    _cleanup_edit_source_file,
    _cleanup_result_file,
    _edit_source_path_from_url,
    _EDIT_SOURCE_FILENAME_RE,
    _next_save_path,
    _persist_history,
    _resolve_save_dir,
    _result_path_from_url,
    _RESULT_FILENAME_RE,
)

# ─────────────────────────────────────────────
# Pydantic 모델 — task #10 (2026-04-26): schemas.py 모듈로 분리
# ─────────────────────────────────────────────
from .schemas import (  # noqa: E402,F401 — re-export
    GenerateBody,
    ProcessAction,
    ResearchBody,
    TaskCreated,
    UpgradeOnlyBody,
)

# ─────────────────────────────────────────────
# 메모리 내 태스크 큐 — task #10 (2026-04-26): tasks.py 모듈로 분리
# ─────────────────────────────────────────────
from .tasks import (  # noqa: E402,F401 — re-export
    TASK_TTL_SEC,  # legacy alias (외부 import 호환)
    TASKS,
    Task,
    _cleanup_stale_tasks,
    _new_task,
    _TASKS_LOCK,
    start_cleanup_loop,
    stop_cleanup_loop,
)

# ─────────────────────────────────────────────
# 파이프라인 — task #16 (2026-04-26): pipelines/ 패키지로 분리
# 외부 호환 (tests/studio/test_*) 을 위해 핵심 심볼 re-export.
# ─────────────────────────────────────────────
from .pipelines import (  # noqa: E402,F401 — re-export
    COMFY_MOCK_FALLBACK,
    ComfyDispatchResult,
    SaveOutputFn,
    _cleanup_comfy_temp,
    _COMFYUI_OUTPUT_BASE,
    _dispatch_to_comfy,
    _EDIT_MAX_IMAGE_BYTES,
    _extract_image_dims,
    _mark_generation_complete,
    _mock_ref_or_raise,
    _OUR_COMFY_PREFIXES,
    _run_edit_pipeline,
    _run_generate_pipeline,
    _run_video_pipeline_task,
    _save_comfy_output,
    _save_comfy_video,
    _VIDEO_MAX_IMAGE_BYTES,
)

# 레거시 process_manager 재활용 (실 프로세스 제어 + VRAM 조회)
try:
    from services.process_manager import process_manager as _proc_mgr  # type: ignore
except Exception:  # pragma: no cover - 테스트 환경
    _proc_mgr = None


# 백그라운드로 돌리는 asyncio.Task 참조 보관 — GC 가 중간에 수거하는 이슈 방지.
# set.add / discard 패턴이 FastAPI 권장.
_BACKGROUND_TASKS: set[asyncio.Task[Any]] = set()


def _spawn(coro: Awaitable[Any]) -> asyncio.Task[Any]:
    """asyncio.create_task 래퍼 — 참조 보관 후 완료 시 자동 discard."""
    task = asyncio.create_task(coro)
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    return task


log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/studio", tags=["studio"])


# ─────────────────────────────────────────────
# SSE 포매터
# ─────────────────────────────────────────────


def _sse_format(event: str, data: dict[str, Any]) -> bytes:
    """SSE 이벤트 포맷: `event: X\\ndata: {...}\\n\\n`."""
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


async def _stream_task(task: Task, request: Request | None = None):
    """태스크 큐를 drain 하며 SSE 바이트를 yield.

    - queue 에서 꺼낼 때 짧은 timeout 으로 wait_for 걸어 주기적으로
      client disconnect 여부 체크 → 끊겼으면 task.cancel() 로 파이프라인 회수.
    - `__close__` 이벤트 수신 시 정상 종료.
    - 이미 closed + 큐 비어있는 task 에 재접속하면 즉시 종료 (ping 무한 루프 방지).
    - generator 가 GC 되거나 caller 가 aclose 하면 CancelledError 로 빠져나감.
    """
    # 재접속 케이스 — 이미 끝난 task 에 다시 stream 요청 시 즉시 종료
    if task.closed and task.queue.empty():
        log.info("SSE re-connect to closed task — closing immediately: %s", task.task_id)
        return
    try:
        while True:
            # disconnect 감지 주기 (초) — 너무 짧으면 CPU 낭비, 너무 길면 반응성 저하
            try:
                item = await asyncio.wait_for(task.queue.get(), timeout=2.0)
            except asyncio.TimeoutError:
                if request is not None and await request.is_disconnected():
                    log.info("SSE client disconnected: %s", task.task_id)
                    task.cancel()
                    break
                # task 가 그 사이 close 됐는데 큐도 비어있으면 더 보낼 게 없음 — 종료
                if task.closed and task.queue.empty():
                    log.info("SSE task closed during wait — finishing: %s", task.task_id)
                    break
                # heartbeat — 프록시 idle timeout 방지 (콜론 시작 주석은 SSE 스펙상 무시됨)
                yield b": ping\n\n"
                continue
            if item["event"] == "__close__":
                break
            yield _sse_format(item["event"], item["data"])
    except asyncio.CancelledError:
        log.info("SSE stream cancelled: %s", task.task_id)
        task.cancel()
        raise


# ─────────────────────────────────────────────
# 생성 엔드포인트
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
# 수정 엔드포인트
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
# Upgrade-only (sync, 모달용)
# ─────────────────────────────────────────────


@router.post("/upgrade-only")
async def upgrade_only(body: UpgradeOnlyBody):
    """프롬프트 업그레이드 전용 (ComfyUI 미호출).

    showUpgradeStep 프리퍼런스 ON 일 때 프론트가 호출 → 모달에서 사용자 확인 →
    /generate 로 preUpgradedPrompt 와 함께 재요청.

    spec 19 후속 (Codex 추가 fix): aspect/width/height 도 SYSTEM_GENERATE 에
    전달 → /generate 본 호출과 동일한 size context 보장.
    """
    research_hints: list[str] = []
    if body.research:
        research = await research_prompt(body.prompt, GENERATE_MODEL.display_name)
        if research.ok:
            research_hints = research.hints

    # spec 19 후속 — generate pipeline 과 동일한 resolved_w/h 계산.
    # 사용자가 width/height 직접 지정했으면 snap, 아니면 aspect preset 사용.
    aspect = get_aspect(body.aspect)
    if body.width is not None and body.height is not None:
        resolved_w = _snap_dimension(body.width)
        resolved_h = _snap_dimension(body.height)
    else:
        resolved_w = aspect.width
        resolved_h = aspect.height

    upgrade = await upgrade_generate_prompt(
        prompt=body.prompt,
        model=body.ollama_model or DEFAULT_OLLAMA_ROLES.text,
        research_context="\n".join(research_hints) if research_hints else None,
        width=resolved_w,
        height=resolved_h,
    )
    return {
        "upgradedPrompt": upgrade.upgraded,
        "upgradedPromptKo": upgrade.translation,
        "provider": upgrade.provider,
        "fallback": upgrade.fallback,
        "researchHints": research_hints,
    }


# ─────────────────────────────────────────────
# Video i2v (LTX-2.3)
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
                _video_longer_min,
                min(_video_longer_max, (longer_edge // 8) * 8),
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


# ─────────────────────────────────────────────
# Vision Analyzer (독립 페이지 /vision)
# ─────────────────────────────────────────────


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

    result = await analyze_image_detailed(
        image_bytes,
        vision_model=vision_model_override,
        text_model=ollama_model_override,
        width=width,
        height=height,
    )

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


# ─────────────────────────────────────────────
# Compare Analyze (Edit 결과 vs 원본 5축 평가)
# ─────────────────────────────────────────────


# ComfyUI 샘플링과 직렬화하기 위한 mutex — vision 호출이 ComfyUI 와 동시 활성 시
# VRAM 16GB 환경에서 충돌 방지. analyze_pair 내부 timeout 은 240s (DEFAULT_TIMEOUT)
# 이라, 선행 호출이 길게 걸리면 후속은 30s 후 503 반환 — 이는 의도된 backpressure 설계
# (단일 프로세스 + 단일 GPU 보호).
_COMPARE_LOCK = asyncio.Lock()
_COMPARE_LOCK_TIMEOUT_SEC = 30.0
_COMPARE_MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB (vision/video 라우트 동일값)


@router.post("/compare-analyze")
async def compare_analyze(
    source: UploadFile = File(...),
    result: UploadFile = File(...),
    meta: str = Form(...),
):
    """Edit 결과(result) 와 원본(source) 을 qwen2.5vl 로 5축 비교 평가.

    multipart:
      source: 원본 이미지 파일
      result: 수정 결과 이미지 파일
      meta: JSON {editPrompt, historyItemId?, visionModel?, ollamaModel?}

    historyItemId 가 주어지면 분석 결과를 DB 에 영구 저장 (saved=True).
    HTTP 200 원칙 — 비전 실패해도 fallback 결과로 200 반환 (analysis.fallback=True).
    동시 호출 시 _COMPARE_LOCK 으로 직렬화 → 30s 대기 후 락이면 503 (의도 설계).
    """
    try:
        meta_obj = json.loads(meta)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"meta JSON invalid: {e}") from e

    # context 분기: 기본 "edit" (Edit 호출자 무영향) · "compare" 면 generic 코드 경로
    context = (meta_obj.get("context") or "edit").strip().lower()
    edit_prompt = (meta_obj.get("editPrompt") or "").strip()
    compare_hint = (meta_obj.get("compareHint") or "").strip()
    history_item_id_raw = meta_obj.get("historyItemId")
    vision_override = meta_obj.get("visionModel") or meta_obj.get("vision_model")
    text_override = meta_obj.get("ollamaModel") or meta_obj.get("ollama_model")

    source_bytes = await source.read()
    result_bytes = await result.read()
    if not source_bytes or not result_bytes:
        raise HTTPException(400, "empty image (source or result)")
    if (
        len(source_bytes) > _COMPARE_MAX_IMAGE_BYTES
        or len(result_bytes) > _COMPARE_MAX_IMAGE_BYTES
    ):
        raise HTTPException(413, "image too large")

    # spec 19 후속 (Codex P1 #2): refined_intent 준비를 lock 밖에서 수행.
    # 이전엔 _COMPARE_LOCK 안에서 clarify_edit_intent (gemma4) 호출 가능했음 →
    # cold start ~5초가 다른 compare 요청을 30s lock timeout 까지 밀어붙임.
    # lock 의 본 목적은 qwen2.5vl 비전 호출과 ComfyUI VRAM 충돌 회피이므로
    # gemma4 text 호출은 lock 밖이 안전 (다른 모델 + 작은 메모리).
    refined_intent = ""
    if context != "compare":
        # edit context 만 refined_intent 사용 (Vision Compare 는 compare_hint 만)
        if (
            isinstance(history_item_id_raw, str)
            and _TASK_ID_RE.match(history_item_id_raw)
        ):
            try:
                cached_item = await history_db.get_item(history_item_id_raw)
                if cached_item and cached_item.get("refinedIntent"):
                    refined_intent = cached_item["refinedIntent"]
            except Exception as cache_err:
                log.info(
                    "compare-analyze refined_intent cache lookup failed (non-fatal): %s",
                    cache_err,
                )
        # 캐시 미스 + edit_prompt 있으면 fresh 호출 (lock 밖)
        if not refined_intent and edit_prompt:
            try:
                refined_intent = await clarify_edit_intent(
                    edit_prompt,
                    model=text_override or "gemma4-un:latest",
                    timeout=60.0,
                )
            except Exception as exc:
                log.info(
                    "compare-analyze refine failed (non-fatal): %s", exc
                )

    # mutex — ComfyUI 샘플링과 충돌 회피용 직렬화. 30s 대기 후에도 락이면 503.
    # 이제 lock 안엔 qwen2.5vl 비전 호출 (analyze_pair / analyze_pair_generic)
    # 만 들어감 → 동시성 개선.
    try:
        await asyncio.wait_for(
            _COMPARE_LOCK.acquire(), timeout=_COMPARE_LOCK_TIMEOUT_SEC
        )
    except asyncio.TimeoutError as e:
        raise HTTPException(503, "compare-analyze busy (locked > 30s)") from e

    try:
        if context == "compare":
            # Vision Compare 메뉴 — 사용자가 임의로 고른 두 이미지 비교
            # source = IMAGE_A, result = IMAGE_B (multipart 필드명 재활용)
            result_obj = await analyze_pair_generic(
                image_a_bytes=source_bytes,
                image_b_bytes=result_bytes,
                compare_hint=compare_hint,
                vision_model=vision_override,
                text_model=text_override,
            )
        else:
            # edit context — refined_intent 는 위에서 lock 밖에 준비됨
            result_obj = await analyze_pair(
                source_bytes=source_bytes,
                result_bytes=result_bytes,
                edit_prompt=edit_prompt,
                vision_model=vision_override,
                text_model=text_override,
                refined_intent=refined_intent,
            )
    finally:
        _COMPARE_LOCK.release()

    # historyItemId 가 _TASK_ID_RE 매치 + DB 에 존재할 때만 저장
    # (Vision Compare 메뉴는 historyItemId 미전송 → 자동 스킵 = 완전 휘발 보장)
    saved = False
    if isinstance(history_item_id_raw, str) and _TASK_ID_RE.match(history_item_id_raw):
        try:
            saved = await history_db.update_comparison(
                history_item_id_raw, result_obj.to_dict()
            )
        except Exception as db_err:
            log.warning("compare-analyze DB persist failed: %s", db_err)
            saved = False

    # spec 19 후속 (옵션 1 · 사용자 진단): 자동 비교 분석 후 모델 (qwen2.5vl
    # + gemma4 합 28GB) 이 keep_alive 처리 deferred 로 메모리에 남아있을
    # 수 있음. ComfyUI 가 곧바로 안 호출되니 wait_sec=0 으로 unload 명령만
    # 즉시 발송 → 헤더 VRAM Breakdown 깨끗 + 다음 작업 안전. graceful (실패해도
    # 응답 영향 X — 헬퍼가 내부에서 모든 예외 흡수).
    try:
        await ollama_unload.force_unload_all_before_comfy(wait_sec=0.0)
    except Exception as unload_err:
        log.info(
            "compare-analyze post-unload failed (non-fatal): %s", unload_err
        )

    return {"analysis": result_obj.to_dict(), "saved": saved}


@router.post("/research")
async def research(body: ResearchBody):
    res = await research_prompt(body.prompt, body.model)
    return {
        "ok": res.ok,
        "hints": res.hints,
        "error": res.error,
    }


# ─────────────────────────────────────────────
# Models (프리셋 노출)
# ─────────────────────────────────────────────


@router.get("/models")
async def list_models():
    """모델 프리셋 노출 — 프론트 model-presets.ts 와 snake_case 그대로 매핑."""
    return {
        "generate": asdict(GENERATE_MODEL),
        "edit": asdict(EDIT_MODEL),
        "aspectRatios": [asdict(a) for a in ASPECT_RATIOS],
    }


# ─────────────────────────────────────────────
# Process (실 process_manager)
# ─────────────────────────────────────────────


@router.post("/interrupt")
async def interrupt_current():
    """현재 실행 중인 ComfyUI job 인터럽트 (전역). ComfyUI 는 client_id 관계없이 즉시 중단."""
    try:
        async with ComfyUITransport() as comfy:
            await comfy.interrupt()
        return {"ok": True, "message": "interrupted"}
    except Exception as e:
        log.warning("interrupt failed: %s", e)
        raise HTTPException(500, f"interrupt failed: {e}") from e


@router.get("/ollama/models")
async def list_ollama_models():
    """설치된 Ollama 모델 목록 (Settings drawer 드롭다운용).

    Returns:
        [{name, size_gb, modified_at}, ...] — 이름순 정렬.
    """
    if _proc_mgr is None:
        return []
    try:
        return await _proc_mgr.list_ollama_models()
    except Exception as e:
        log.warning("list_ollama_models failed: %s", e)
        return []


@router.get("/process/status")
async def process_status():
    """실 process_manager + system_metrics 로부터 Ollama·ComfyUI 상태 + 통합 자원 메트릭 조회.

    응답 구조 (2026-04-26 헤더 통합 SystemMetrics 도입):
      {
        "ollama":  {"running": bool},
        "comfyui": {"running": bool, "vram_used_gb": float?, "vram_total_gb": float?,
                    "gpu_percent": float?},
        "system":  {"cpu_percent": float?, "ram_used_gb": float?, "ram_total_gb": float?},
        "vram_breakdown": {
          "comfyui": {"vram_gb": float, "models": [str], "last_mode": str?},
          "ollama":  {"vram_gb": float, "models": [{"name", "size_vram_gb", "expires_in_sec"}]},
          "other_gb": float
        }
      }
    각 메트릭 필드는 측정 실패 시 누락 가능 (프론트에서 누락 = 미표시 처리).
    vram_breakdown 은 항상 포함 (실패 시 0/빈 리스트) — 프론트에서 80% 임계 넘을 때만 표시.
    """
    if _proc_mgr is None:
        return {
            "ollama": {"running": False},
            "comfyui": {"running": False},
            "system": {},
        }
    ollama_ok = await _proc_mgr.check_ollama()
    comfyui_ok = await _proc_mgr.check_comfyui()

    # 시스템 메트릭 일괄 측정 — psutil + nvidia-smi 병렬, 실패 시 부분값만 들어옴
    metrics: dict[str, Any] = {}
    try:
        metrics = await get_system_metrics()  # type: ignore[assignment]
    except Exception as exc:
        log.warning("system metrics 측정 실패: %s", exc)
        metrics = {}

    # VRAM breakdown — process_manager 노출 PID 활용 (외부 기동이면 None → 휴리스틱)
    # nvidia-smi compute-apps 가 ComfyUI 못 잡는 케이스 폴백을 위해 total_used_gb 도 전달.
    comfyui_pid = getattr(_proc_mgr, "comfyui_pid", None)
    total_used_gb = metrics.get("vram_used_gb")
    breakdown: dict[str, Any] = {}
    try:
        breakdown = await get_vram_breakdown(
            comfyui_pid=comfyui_pid,
            total_used_gb=total_used_gb,
        )
    except Exception as exc:
        log.warning("vram breakdown 측정 실패: %s", exc)
        breakdown = {}

    # comfyui 묶음 — VRAM + GPU% (GPU 메트릭 nvidia-smi 의존)
    comfyui_payload: dict[str, Any] = {"running": comfyui_ok}
    for key in ("vram_used_gb", "vram_total_gb", "gpu_percent"):
        if key in metrics:
            comfyui_payload[key] = metrics[key]

    # system 묶음 — CPU + RAM (psutil 의존)
    system_payload: dict[str, Any] = {}
    for key in ("cpu_percent", "ram_used_gb", "ram_total_gb"):
        if key in metrics:
            system_payload[key] = metrics[key]

    return {
        "ollama": {"running": ollama_ok},
        "comfyui": comfyui_payload,
        "system": system_payload,
        "vram_breakdown": breakdown,
    }


@router.get("/history")
async def list_history(
    mode: str | None = None,
    limit: int = 50,
    before: int | None = None,
):
    """히스토리 조회 (최신순, mode 필터, cursor pagination)."""
    valid_modes = ("generate", "edit", "video")
    safe_mode = mode if mode in valid_modes else None
    items = await history_db.list_items(
        mode=safe_mode,
        limit=max(1, min(limit, 200)),
        before_ts=before,
    )
    total = await history_db.count_items(safe_mode)
    return {"items": items, "total": total}


@router.get("/history/{item_id}")
async def get_history(item_id: str):
    item = await history_db.get_item(item_id)
    if item is None:
        raise HTTPException(404, "not found")
    return item


@router.delete("/history/{item_id}")
async def delete_history(item_id: str):
    # audit P1b + R1-6: DB 삭제 + orphan 된 edit-source 원본 및 result 파일 정리.
    # 같은 ref 를 참조하는 다른 row 가 있으면 각 파일은 보존.
    ok, source_ref, image_ref = await history_db.delete_item_with_refs(item_id)
    if not ok:
        raise HTTPException(404, "not found")
    source_cleaned = await _cleanup_edit_source_file(source_ref)
    result_cleaned = await _cleanup_result_file(image_ref)
    return {
        "ok": True,
        "id": item_id,
        "source_cleaned": source_cleaned,
        "result_cleaned": result_cleaned,
    }


@router.delete("/history")
async def clear_history():
    # audit P1b + R1-6: 전체 삭제 시 edit-source + result 파일 동시 정리.
    count, source_refs, image_refs = await history_db.clear_all_with_refs()
    sources_cleaned = 0
    for url in set(source_refs):
        # 전체 삭제 후이므로 count_source_ref_usage 는 무조건 0. 안전.
        if await _cleanup_edit_source_file(url):
            sources_cleaned += 1
    results_cleaned = 0
    for url in set(image_refs):
        if await _cleanup_result_file(url):
            results_cleaned += 1
    return {
        "ok": True,
        "deleted": count,
        "sources_cleaned": sources_cleaned,
        "results_cleaned": results_cleaned,
    }


@router.post(
    "/process/{name}/{action}",
    response_model=ProcessAction,
)
async def process_action(name: str, action: str):
    if name not in ("ollama", "comfyui"):
        raise HTTPException(400, f"unknown process: {name}")
    if action not in ("start", "stop"):
        raise HTTPException(400, f"unknown action: {action}")
    if _proc_mgr is None:
        raise HTTPException(503, "process_manager unavailable")

    fn_name = f"{action}_{name}"
    fn = getattr(_proc_mgr, fn_name, None)
    if fn is None:
        raise HTTPException(400, f"no action {fn_name}")

    try:
        ok = await fn()
    except Exception as e:
        log.exception("process action failed")
        raise HTTPException(500, f"{fn_name} failed: {e}") from e

    return ProcessAction(
        ok=bool(ok),
        message=f"{name} {action} {'OK' if ok else 'FAILED'}",
    )
