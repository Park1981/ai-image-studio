"""
studio/router.py - FastAPI 라우터: /api/studio/*

엔드포인트:
  POST /api/studio/generate          → { task_id, stream_url }
  GET  /api/studio/generate/stream/{task_id}  → SSE
  POST /api/studio/edit              → { task_id, stream_url } (multipart)
  GET  /api/studio/edit/stream/{task_id}      → SSE
  POST /api/studio/upgrade-only      → { upgradedPrompt, ... } (sync)
  POST /api/studio/research          → { hints: [] } (sync)
  POST /api/studio/interrupt         → { ok }
  GET  /api/studio/models            → 모델 프리셋 (프론트 lib/model-presets.ts 미러)
  GET  /api/studio/ollama/models     → 설치된 Ollama 모델 목록
  GET  /api/studio/process/status    → {ollama:{running}, comfyui:{running}}
  POST /api/studio/process/{name}/{action}  → {ok, message}
  GET  /api/studio/history[/{id}]    → studio_history 조회
  DELETE /api/studio/history[/{id}]  → 삭제

2026-04-23 Opus 리뷰 반영:
  - _dispatch_to_comfy 단일화 (generate/edit 공통)
  - asyncio.Task 참조 보관(_spawn)
  - TASKS dict 에 lock 도입
  - SSE 클라이언트 끊김 감지 → 태스크 취소
  - history_db 실패를 done 이벤트 savedToHistory 에 반영
  - Edit 결과 실제 해상도 PIL 로 읽어서 반영
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import time
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field

from .presets import (
    ASPECT_RATIOS,
    DEFAULT_OLLAMA_ROLES,
    EDIT_MODEL,
    GENERATE_MODEL,
    get_aspect,
)
from .prompt_pipeline import upgrade_generate_prompt
from .claude_cli import research_prompt
from .vision_pipeline import run_vision_pipeline
from .comfy_api_builder import (
    build_generate_from_request,
    build_edit_from_request,
    _snap_dimension,
)
from .comfy_transport import ComfyUITransport, extract_output_images
from . import history_db

# 레거시 process_manager 재활용 (실 프로세스 제어 + VRAM 조회)
try:
    from services.process_manager import process_manager as _proc_mgr  # type: ignore
except Exception:  # pragma: no cover - 테스트 환경
    _proc_mgr = None

# ComfyUI 가 실제로 안 돌고 있어서 /prompt 가 실패해도 UI 는 Mock 이미지로 완주되게 할지.
# False 면 에러를 프론트로 올리고 토스트. True 면 폴백해서 mock-seed:// 리턴.
COMFY_MOCK_FALLBACK = True

# 생성된 이미지를 저장할 디렉토리 (main.py 가 backend/output/images 를 /images 로 static mount)
try:
    from config import settings  # type: ignore

    STUDIO_OUTPUT_DIR = Path(settings.output_image_path) / "studio"
    STUDIO_URL_PREFIX = "/images/studio"
except Exception:
    # 폴백 (테스트 환경 등)
    STUDIO_OUTPUT_DIR = Path("backend/output/images/studio")
    STUDIO_URL_PREFIX = "/images/studio"
STUDIO_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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
# 스키마
# ─────────────────────────────────────────────


class GenerateBody(BaseModel):
    prompt: str = Field(..., min_length=1)
    aspect: str = "1:1"
    # 사용자가 직접 픽셀 지정한 경우 (둘 다 주어져야 사용됨, 아니면 aspect 프리셋 사용)
    # 8의 배수 + 256~2048 범위 제약은 comfy_api_builder 에서 최종 clamp.
    width: int | None = Field(default=None, ge=256, le=2048)
    height: int | None = Field(default=None, ge=256, le=2048)
    steps: int = GENERATE_MODEL.defaults.steps
    cfg: float = GENERATE_MODEL.defaults.cfg
    seed: int = GENERATE_MODEL.defaults.seed
    lightning: bool = False
    research: bool = False
    # 설정에서 override 가능 (None 이면 프리셋 기본값)
    ollama_model: str | None = Field(default=None, alias="ollamaModel")
    vision_model: str | None = Field(default=None, alias="visionModel")
    # 사용자가 "업그레이드 확인" 모달에서 미리 확정한 프롬프트
    # (있으면 gemma4 upgrade 단계 생략)
    pre_upgraded_prompt: str | None = Field(
        default=None, alias="preUpgradedPrompt"
    )
    # 업그레이드 모달에서 이미 Claude 조사를 수행한 경우 힌트를 전달해서
    # 백엔드가 조사를 재실행하지 않게 한다. None 이면 평소처럼 research 플래그대로 동작.
    # 빈 배열 [] 도 "조사 완료 (힌트 없음)" 으로 간주해 재호출 안 함.
    pre_research_hints: list[str] | None = Field(
        default=None, alias="preResearchHints"
    )

    # Pydantic V2: class-based Config 대신 model_config = ConfigDict(...)
    model_config = ConfigDict(populate_by_name=True)


class UpgradeOnlyBody(BaseModel):
    """gemma4 업그레이드 + 선택적 조사만 수행 · ComfyUI 디스패치 없음."""

    prompt: str = Field(..., min_length=1)
    research: bool = False
    ollama_model: str | None = Field(default=None, alias="ollamaModel")

    model_config = ConfigDict(populate_by_name=True)


class ResearchBody(BaseModel):
    prompt: str
    model: str = GENERATE_MODEL.display_name


class ProcessAction(BaseModel):
    ok: bool
    message: str | None = None


class TaskCreated(BaseModel):
    task_id: str
    stream_url: str


# ─────────────────────────────────────────────
# 메모리 내 태스크 큐 (간단 버전)
# ─────────────────────────────────────────────


class Task:
    """단일 생성/수정 태스크 상태.

    - queue: SSE 이벤트 버퍼
    - worker: 파이프라인 asyncio.Task (클라이언트 SSE 끊길 때 cancel 하려고 보관)
    - cancelled: 클라이언트 disconnect 로 취소된 경우 True
    """

    def __init__(self, task_id: str) -> None:
        self.task_id = task_id
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.closed = False
        self.cancelled = False
        # monotonic: NTP 보정과 무관한 TTL 계산
        self.created_at = time.monotonic()
        self.worker: asyncio.Task[Any] | None = None

    async def emit(self, event_type: str, payload: dict[str, Any]) -> None:
        await self.queue.put({"event": event_type, "data": payload})

    async def close(self) -> None:
        if not self.closed:
            self.closed = True
            await self.queue.put({"event": "__close__", "data": {}})

    def cancel(self) -> None:
        """클라이언트 끊김 시 파이프라인 강제 종료."""
        self.cancelled = True
        if self.worker and not self.worker.done():
            self.worker.cancel()


TASKS: dict[str, Task] = {}
_TASKS_LOCK = asyncio.Lock()
TASK_TTL_SEC = 600  # 10분


async def _new_task() -> Task:
    """Task 등록 + 오래된 항목 cleanup (lock 보호)."""
    async with _TASKS_LOCK:
        # 오래된 완료 태스크 정리 (monotonic 기반)
        now = time.monotonic()
        stale = [
            tid
            for tid, t in TASKS.items()
            if t.closed and now - t.created_at > TASK_TTL_SEC
        ]
        for tid in stale:
            TASKS.pop(tid, None)

        task_id = f"tsk-{uuid.uuid4().hex[:12]}"
        t = Task(task_id)
        TASKS[task_id] = t
        return t


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
    - generator 가 GC 되거나 caller 가 aclose 하면 CancelledError 로 빠져나감.
    """
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


async def _run_generate_pipeline(task: Task, body: GenerateBody) -> None:
    """백그라운드 실행 — 단계별로 task.emit() 으로 SSE 방출. 실 ComfyUI 디스패치 포함."""
    try:
        # 1. prompt-parse
        await task.emit(
            "stage",
            {
                "type": "prompt-parse",
                "progress": 10,
                "stageLabel": "프롬프트 해석",
            },
        )

        # 2. (선택) Claude 조사
        # research=true 가 외측 조건. 이 플래그가 꺼져 있으면 단계 자체 스킵 (이벤트 없음).
        # research=true 이면서 pre_research_hints 가 주어지면 (빈 배열 포함) 프론트가
        # upgrade-only 단계에서 이미 조사한 결과를 재사용 → 백엔드 재호출 안 함.
        research_hints: list[str] = []
        if body.research:
            if body.pre_research_hints is not None:
                research_hints = body.pre_research_hints
                await task.emit(
                    "stage",
                    {
                        "type": "claude-research",
                        "progress": 25,
                        "stageLabel": "조사 완료 (사전 확정)",
                    },
                )
            else:
                await task.emit(
                    "stage",
                    {
                        "type": "claude-research",
                        "progress": 25,
                        "stageLabel": "Claude 조사 중",
                    },
                )
                research = await research_prompt(
                    body.prompt, GENERATE_MODEL.display_name
                )
                if research.ok:
                    research_hints = research.hints

        # 3. gemma4 업그레이드 (또는 사전 확정된 프롬프트 사용)
        if body.pre_upgraded_prompt:
            # 사용자가 모달에서 이미 확인/수정한 프롬프트 — 재호출 스킵
            await task.emit(
                "stage",
                {
                    "type": "gemma4-upgrade",
                    "progress": 50,
                    "stageLabel": "업그레이드 완료 (사전 확정)",
                },
            )
            from .prompt_pipeline import UpgradeResult

            upgrade = UpgradeResult(
                upgraded=body.pre_upgraded_prompt,
                fallback=False,
                provider="pre-confirmed",
                original=body.prompt,
            )
        else:
            await task.emit(
                "stage",
                {
                    "type": "gemma4-upgrade",
                    "progress": 45,
                    "stageLabel": "gemma4 업그레이드",
                },
            )
            upgrade = await upgrade_generate_prompt(
                prompt=body.prompt,
                model=body.ollama_model or DEFAULT_OLLAMA_ROLES.text,
                research_context="\n".join(research_hints) if research_hints else None,
            )

        # 4. API 포맷 조립
        await task.emit(
            "stage",
            {
                "type": "workflow-dispatch",
                "progress": 60,
                "stageLabel": "워크플로우 전달",
            },
        )

        aspect = get_aspect(body.aspect)
        actual_seed = body.seed if body.seed > 0 else int(time.time() * 1000)

        # 사용자가 width/height 직접 지정했으면 그걸, 아니면 aspect 프리셋 사용.
        # snap/clamp 를 미리 하고 히스토리에도 같은 값으로 저장.
        if body.width is not None and body.height is not None:
            resolved_w = _snap_dimension(body.width)
            resolved_h = _snap_dimension(body.height)
        else:
            resolved_w = aspect.width
            resolved_h = aspect.height

        # 5. ComfyUI 디스패치 (Generate: 업로드 없음, prompt 즉시 조립)
        await task.emit(
            "stage",
            {
                "type": "comfyui-sampling",
                "progress": 70,
                "stageLabel": "ComfyUI 샘플링",
            },
        )

        def _make_generate_prompt(_uploaded: str | None) -> dict[str, Any]:
            return build_generate_from_request(
                prompt=upgrade.upgraded,
                aspect_label=body.aspect,
                steps=body.steps,
                cfg=body.cfg,
                seed=actual_seed,
                lightning=body.lightning,
                width=resolved_w,
                height=resolved_h,
            )

        dispatch = await _dispatch_to_comfy(
            task,
            _make_generate_prompt,
            progress_start=70,
            progress_span=25,
            client_prefix="ais",
        )
        image_ref = dispatch.image_ref
        comfy_error = dispatch.comfy_error
        # Generate: 사용자가 요청한 해상도가 그대로 저장됨 (PIL 읽기 실패해도 resolved 유지)
        saved_w = dispatch.width or resolved_w
        saved_h = dispatch.height or resolved_h

        # 6. 후처리
        await task.emit(
            "stage",
            {
                "type": "postprocess",
                "progress": 97,
                "stageLabel": "후처리",
            },
        )
        await asyncio.sleep(0.15)

        # 7. done
        item = {
            "id": f"gen-{uuid.uuid4().hex[:8]}",
            "mode": "generate",
            "prompt": body.prompt,
            "label": body.prompt[:28] + ("…" if len(body.prompt) > 28 else ""),
            "width": saved_w,
            "height": saved_h,
            "seed": actual_seed,
            "steps": body.steps,
            "cfg": body.cfg,
            "lightning": body.lightning,
            "model": GENERATE_MODEL.display_name,
            "createdAt": int(time.time() * 1000),
            "imageRef": image_ref,
            "upgradedPrompt": upgrade.upgraded,
            "upgradedPromptKo": upgrade.translation,
            "promptProvider": upgrade.provider,
            "researchHints": research_hints,
            "comfyError": comfy_error,
        }
        saved_to_history = await _persist_history(item)
        await task.emit(
            "done", {"item": item, "savedToHistory": saved_to_history}
        )
    except asyncio.CancelledError:
        log.info("Generate pipeline cancelled: %s", task.task_id)
        raise
    except Exception as e:
        log.exception("Generate pipeline error")
        await task.emit("error", {"message": str(e)})
    finally:
        await task.close()


async def _persist_history(item: dict[str, Any]) -> bool:
    """history_db.insert_item 래퍼 — 실패를 bool 로 반환해 done 이벤트에 반영."""
    try:
        await history_db.insert_item(item)
        return True
    except Exception as db_err:
        log.warning("history_db insert failed: %s", db_err)
        return False


class ComfyDispatchResult(BaseModel):
    """_dispatch_to_comfy 반환 — 이미지 참조 + 해상도 + 오류 메시지."""

    image_ref: str
    width: int | None = None
    height: int | None = None
    comfy_error: str | None = None


async def _dispatch_to_comfy(
    task: Task,
    api_prompt_factory: Callable[[str | None], dict[str, Any]],
    *,
    progress_start: int,
    progress_span: int,
    client_prefix: str = "ais",
    upload_bytes: bytes | None = None,
    upload_filename: str | None = None,
) -> ComfyDispatchResult:
    """ComfyUI 에 API prompt 제출 + WS 진행 수신 + 결과 이미지 다운로드 (generate/edit 공통).

    Edit 플로우 (upload_bytes != None): 먼저 `/upload/image` 로 소스 이미지 업로드 →
    업로드된 파일명을 api_prompt_factory 에 넘겨 최종 api_prompt 조립.
    Generate 플로우 (upload_bytes == None): api_prompt_factory(None) 호출로 즉시 조립.

    Args:
        task: 진행률/에러 emit 대상
        api_prompt_factory: (uploaded_filename_or_None) -> api_prompt_dict
        progress_start/progress_span: pipelineProgress 에 매핑할 범위 (ComfyUI 샘플링 구간)
        upload_bytes/upload_filename: Edit 전용, 둘 다 있어야 업로드 수행

    Returns:
        ComfyDispatchResult(image_ref, width, height, comfy_error)
    """
    client_id = f"{client_prefix}-{uuid.uuid4().hex[:10]}"
    try:
        async with ComfyUITransport() as comfy:
            uploaded_name: str | None = None
            if upload_bytes is not None:
                uploaded_name = await comfy.upload_image(
                    upload_bytes, upload_filename or "input.png"
                )
            api_prompt = api_prompt_factory(uploaded_name)
            prompt_id = await comfy.submit(api_prompt, client_id)
            log.info("ComfyUI submitted prompt_id=%s", prompt_id)

            comfy_err: str | None = None
            async for evt in comfy.listen(client_id, prompt_id):
                if evt.kind == "execution_error":
                    comfy_err = evt.data.get("exception_message", "unknown")
                    break
                if evt.kind == "progress":
                    pct = evt.percent or 0.0
                    await task.emit(
                        "stage",
                        {
                            "type": "comfyui-sampling",
                            "progress": progress_start + int(progress_span * pct),
                            "stageLabel": f"ComfyUI 샘플링 {int(pct * 100)}%",
                            "samplingStep": evt.data.get("value"),
                            "samplingTotal": evt.data.get("max"),
                        },
                    )
                # execution_success 면 listen 내부에서 루프 종료

            if comfy_err:
                return ComfyDispatchResult(
                    image_ref=_mock_ref_or_raise(comfy_err), comfy_error=comfy_err
                )

            image_ref, width, height = await _save_comfy_output(comfy, prompt_id)
        log.info("ComfyUI image saved: %s (%dx%d)", image_ref, width, height)
        return ComfyDispatchResult(image_ref=image_ref, width=width, height=height)

    except asyncio.CancelledError:
        # 클라이언트가 끊었거나 interrupt 호출 — 상위로 재-raise 해서 파이프라인 정리
        raise
    except Exception as e:
        log.warning("ComfyUI dispatch failed: %s", e)
        return ComfyDispatchResult(
            image_ref=_mock_ref_or_raise(str(e)), comfy_error=str(e)
        )


def _mock_ref_or_raise(reason: str) -> str:
    """COMFY_MOCK_FALLBACK 설정에 따라 mock ref 반환 또는 예외."""
    if COMFY_MOCK_FALLBACK:
        return f"mock-seed://{uuid.uuid4().hex}"
    raise RuntimeError(reason)


async def _save_comfy_output(
    comfy: ComfyUITransport, prompt_id: str
) -> tuple[str, int, int]:
    """ComfyUI 완료 prompt 의 첫 이미지를 다운로드·저장하고 (url, width, height) 반환.

    PIL 로 실제 해상도를 읽어 히스토리 메타데이터에 반영 (Edit 결과는 원본+스케일 후 크기가
    프리셋과 다를 수 있음 — 하드코딩 1024 이슈 해소).
    """
    history = await comfy.get_history(prompt_id)
    images = extract_output_images(history)
    if not images:
        raise RuntimeError("no output images")
    img = images[0]
    raw = await comfy.download_image(
        filename=img["filename"],
        subfolder=img["subfolder"],
        image_type=img["type"],
    )
    save_name = f"{uuid.uuid4().hex}.png"
    (STUDIO_OUTPUT_DIR / save_name).write_bytes(raw)

    # 실해상도 추출 — 실패해도 이미지 자체는 살리고 0 으로 폴백
    try:
        with Image.open(io.BytesIO(raw)) as im:
            width, height = im.size
    except Exception as e:
        log.warning("PIL size read failed: %s", e)
        width, height = 0, 0

    return (f"{STUDIO_URL_PREFIX}/{save_name}", width, height)


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

    task = await _new_task()
    task.worker = _spawn(
        _run_edit_pipeline(
            task,
            image_bytes,
            prompt,
            lightning,
            image.filename or "input.png",
            ollama_model_override,
            vision_model_override,
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


async def _run_edit_pipeline(
    task: Task,
    image_bytes: bytes,
    prompt: str,
    lightning: bool,
    filename: str,
    ollama_model_override: str | None = None,
    vision_model_override: str | None = None,
) -> None:
    try:
        # Step 1: vision analysis — pipelineProgress 10 → 30
        await task.emit("stage", {"type": "vision-analyze", "progress": 10, "stageLabel": "비전 분석"})
        await task.emit("step", {"step": 1, "done": False})
        vision = await run_vision_pipeline(
            image_bytes,
            prompt,
            vision_model=vision_model_override or DEFAULT_OLLAMA_ROLES.vision,
            text_model=ollama_model_override or DEFAULT_OLLAMA_ROLES.text,
        )
        await task.emit(
            "step",
            {
                "step": 1,
                "done": True,
                "description": vision.image_description,
            },
        )
        await task.emit("stage", {"type": "vision-analyze", "progress": 30, "stageLabel": "비전 분석 완료"})

        # Step 2: prompt merge (이미 vision 파이프라인에서 완료) — 40 → 50
        await task.emit("stage", {"type": "prompt-merge", "progress": 40, "stageLabel": "프롬프트 병합"})
        await task.emit("step", {"step": 2, "done": False})
        await asyncio.sleep(0.2)
        await task.emit(
            "step",
            {
                "step": 2,
                "done": True,
                "finalPrompt": vision.final_prompt,
                "finalPromptKo": vision.upgrade.translation,
                "provider": vision.upgrade.provider,
            },
        )
        await task.emit("stage", {"type": "prompt-merge", "progress": 50, "stageLabel": "프롬프트 병합 완료"})

        # Step 3: size/style auto-extraction — 55 → 65
        await task.emit("stage", {"type": "param-extract", "progress": 55, "stageLabel": "파라미터 추출"})
        await task.emit("step", {"step": 3, "done": False})
        await asyncio.sleep(0.15)
        await task.emit("step", {"step": 3, "done": True})
        await task.emit("stage", {"type": "param-extract", "progress": 65, "stageLabel": "파라미터 확정"})

        # Step 4: ComfyUI dispatch — 70 → 95 (샘플링 실시간 %)
        await task.emit("stage", {"type": "comfyui-sampling", "progress": 70, "stageLabel": "ComfyUI 샘플링 대기"})
        await task.emit("step", {"step": 4, "done": False})

        actual_seed = int(time.time() * 1000)

        def _make_edit_prompt(uploaded_name: str | None) -> dict[str, Any]:
            # Edit 는 업로드 이후에만 호출됨 → uploaded_name 반드시 있음
            if uploaded_name is None:
                raise RuntimeError("Edit pipeline requires uploaded image")
            return build_edit_from_request(
                prompt=vision.final_prompt,
                source_filename=uploaded_name,
                seed=actual_seed,
                lightning=lightning,
            )

        dispatch = await _dispatch_to_comfy(
            task,
            _make_edit_prompt,
            progress_start=70,
            progress_span=25,
            client_prefix="ais-e",
            upload_bytes=image_bytes,
            upload_filename=filename or "input.png",
        )
        image_ref = dispatch.image_ref
        comfy_err = dispatch.comfy_error
        # Edit 은 FluxKontextImageScale 가 원본+스케일 후 크기를 결정 → PIL 값이 권위
        result_w = dispatch.width or 0
        result_h = dispatch.height or 0

        await task.emit("step", {"step": 4, "done": True})
        await task.emit("stage", {"type": "save-output", "progress": 98, "stageLabel": "결과 저장"})

        # Done
        item = {
            "id": f"edit-{uuid.uuid4().hex[:8]}",
            "mode": "edit",
            "prompt": prompt,
            "label": prompt[:28] + ("…" if len(prompt) > 28 else ""),
            "width": result_w,
            "height": result_h,
            "seed": actual_seed,
            "steps": EDIT_MODEL.lightning.steps if lightning else EDIT_MODEL.defaults.steps,
            "cfg": EDIT_MODEL.lightning.cfg if lightning else EDIT_MODEL.defaults.cfg,
            "lightning": lightning,
            "model": EDIT_MODEL.display_name,
            "createdAt": int(time.time() * 1000),
            "imageRef": image_ref,
            "upgradedPrompt": vision.final_prompt,
            "upgradedPromptKo": vision.upgrade.translation,
            "visionDescription": vision.image_description,
            "comfyError": comfy_err,
        }
        saved_to_history = await _persist_history(item)
        await task.emit(
            "done", {"item": item, "savedToHistory": saved_to_history}
        )
    except asyncio.CancelledError:
        log.info("Edit pipeline cancelled: %s", task.task_id)
        raise
    except Exception as e:
        log.exception("Edit pipeline error")
        await task.emit("error", {"message": str(e)})
    finally:
        await task.close()


# ─────────────────────────────────────────────
# Research (sync)
# ─────────────────────────────────────────────


@router.post("/upgrade-only")
async def upgrade_only(body: UpgradeOnlyBody):
    """프롬프트 업그레이드 전용 (ComfyUI 미호출).

    showUpgradeStep 프리퍼런스 ON 일 때 프론트가 호출 → 모달에서 사용자 확인 →
    /generate 로 preUpgradedPrompt 와 함께 재요청.
    """
    research_hints: list[str] = []
    if body.research:
        research = await research_prompt(body.prompt, GENERATE_MODEL.display_name)
        if research.ok:
            research_hints = research.hints
    upgrade = await upgrade_generate_prompt(
        prompt=body.prompt,
        model=body.ollama_model or DEFAULT_OLLAMA_ROLES.text,
        research_context="\n".join(research_hints) if research_hints else None,
    )
    return {
        "upgradedPrompt": upgrade.upgraded,
        "upgradedPromptKo": upgrade.translation,
        "provider": upgrade.provider,
        "fallback": upgrade.fallback,
        "researchHints": research_hints,
    }


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
# Process (mock)
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
    """실 process_manager 로부터 Ollama·ComfyUI 상태 + VRAM 조회."""
    if _proc_mgr is None:
        return {
            "ollama": {"running": False},
            "comfyui": {"running": False},
        }
    ollama_ok = await _proc_mgr.check_ollama()
    comfyui_ok = await _proc_mgr.check_comfyui()
    vram: dict[str, Any] = {}
    try:
        vram = await _proc_mgr.get_vram_usage()
    except Exception:
        vram = {}
    return {
        "ollama": {"running": ollama_ok},
        "comfyui": {"running": comfyui_ok, **(vram or {})},
    }


@router.get("/history")
async def list_history(
    mode: str | None = None,
    limit: int = 50,
    before: int | None = None,
):
    """히스토리 조회 (최신순, mode 필터, cursor pagination)."""
    items = await history_db.list_items(
        mode=mode if mode in ("generate", "edit") else None,
        limit=max(1, min(limit, 200)),
        before_ts=before,
    )
    total = await history_db.count_items(
        mode if mode in ("generate", "edit") else None
    )
    return {"items": items, "total": total}


@router.get("/history/{item_id}")
async def get_history(item_id: str):
    item = await history_db.get_item(item_id)
    if item is None:
        raise HTTPException(404, "not found")
    return item


@router.delete("/history/{item_id}")
async def delete_history(item_id: str):
    ok = await history_db.delete_item(item_id)
    if not ok:
        raise HTTPException(404, "not found")
    return {"ok": True, "id": item_id}


@router.delete("/history")
async def clear_history():
    count = await history_db.clear_all()
    return {"ok": True, "deleted": count}


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
