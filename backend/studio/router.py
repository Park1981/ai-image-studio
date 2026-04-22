"""
studio/router.py - FastAPI 라우터: /api/studio/*

엔드포인트:
  POST /api/studio/generate          → { task_id, stream_url }
  GET  /api/studio/generate/stream/{task_id}  → SSE
  POST /api/studio/edit              → { task_id, stream_url } (multipart)
  GET  /api/studio/edit/stream/{task_id}      → SSE
  POST /api/studio/research          → { hints: [] } (sync)
  GET  /api/studio/models            → 모델 프리셋 (프론트 lib/model-presets.ts 미러)
  GET  /api/studio/process/status    → {ollama:{running}, comfyui:{running}}
  POST /api/studio/process/{name}/{action}  → {ok, message}

현재 구현 단계 (Sub-Phase 2C):
  - 프롬프트 업그레이드는 REAL (Ollama 호출, 실패 시 폴백)
  - ComfyUI 디스패치는 **MOCK** (실 연결은 Sub-Phase 2D 에서 FakeTransport → ComfyUITransport 교체)
  - 생성된 이미지는 없음 (imageRef 는 `mock-seed://...`)
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .presets import (
    ASPECT_RATIOS,
    EDIT_MODEL,
    GENERATE_MODEL,
    get_aspect,
)
from .prompt_pipeline import upgrade_generate_prompt
from .claude_cli import research_prompt
from .vision_pipeline import run_vision_pipeline
from .workflow_runner import (
    GenerateInjection,
    EditInjection,
    build_generate_prompt,
    build_edit_prompt,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/studio", tags=["studio"])


# ─────────────────────────────────────────────
# 스키마
# ─────────────────────────────────────────────


class GenerateBody(BaseModel):
    prompt: str = Field(..., min_length=1)
    aspect: str = "1:1"
    steps: int = GENERATE_MODEL.defaults.steps
    cfg: float = GENERATE_MODEL.defaults.cfg
    seed: int = GENERATE_MODEL.defaults.seed
    lightning: bool = False
    research: bool = False


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
    """단일 생성/수정 태스크 상태."""

    def __init__(self, task_id: str):
        self.task_id = task_id
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.closed = False
        self.created_at = time.time()

    async def emit(self, event_type: str, payload: dict[str, Any]) -> None:
        await self.queue.put({"event": event_type, "data": payload})

    async def close(self) -> None:
        if not self.closed:
            self.closed = True
            await self.queue.put({"event": "__close__", "data": {}})


TASKS: dict[str, Task] = {}
TASK_TTL_SEC = 600  # 10분


def _new_task() -> Task:
    # 오래된 완료 태스크 정리
    now = time.time()
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


async def _stream_task(task: Task):
    """태스크 큐를 drain 하며 SSE 바이트를 yield."""
    while True:
        item = await task.queue.get()
        if item["event"] == "__close__":
            break
        yield _sse_format(item["event"], item["data"])


# ─────────────────────────────────────────────
# 생성 엔드포인트
# ─────────────────────────────────────────────


@router.post("/generate", response_model=TaskCreated)
async def create_generate_task(body: GenerateBody):
    """생성 요청 받으면 백그라운드 파이프라인 spawn, task_id 반환."""
    task = _new_task()
    asyncio.create_task(_run_generate_pipeline(task, body))
    return TaskCreated(
        task_id=task.task_id,
        stream_url=f"/api/studio/generate/stream/{task.task_id}",
    )


@router.get("/generate/stream/{task_id}")
async def generate_stream(task_id: str):
    task = TASKS.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return StreamingResponse(
        _stream_task(task),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def _run_generate_pipeline(task: Task, body: GenerateBody) -> None:
    """백그라운드 실행 — 단계별로 task.emit() 으로 SSE 방출."""
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

        # 2. gemma4 upgrade (optional research context preload)
        research_hints: list[str] = []
        if body.research:
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
            research_context="\n".join(research_hints) if research_hints else None,
        )

        # 3. workflow 주입
        await task.emit(
            "stage",
            {
                "type": "workflow-dispatch",
                "progress": 65,
                "stageLabel": "워크플로우 전달",
            },
        )

        aspect = get_aspect(body.aspect)
        lightning_lora = next(
            (l.name for l in GENERATE_MODEL.loras if l.role == "lightning"),
            "",
        )
        inj = GenerateInjection(
            text=upgrade.upgraded,
            width=aspect.width,
            height=aspect.height,
            enable_turbo_mode=body.lightning,
            seed=body.seed if body.seed > 0 else int(time.time() * 1000),
            unet_name=GENERATE_MODEL.files.unet,
            clip_name=GENERATE_MODEL.files.clip,
            vae_name=GENERATE_MODEL.files.vae,
            lora_name=lightning_lora,
        )
        _wf, _api = build_generate_prompt(
            GENERATE_MODEL.workflow, GENERATE_MODEL.subgraph_id, inj
        )
        # ⚠️ 실 ComfyUI 디스패치는 Sub-Phase 2D 에서.
        # 지금은 주입만 확인하고 mock 대기.

        # 4. comfyui-sampling (mock 대기)
        await task.emit(
            "stage",
            {
                "type": "comfyui-sampling",
                "progress": 88,
                "stageLabel": "ComfyUI 샘플링 (mock)",
            },
        )
        await asyncio.sleep(0.8)

        await task.emit(
            "stage",
            {
                "type": "postprocess",
                "progress": 97,
                "stageLabel": "후처리",
            },
        )
        await asyncio.sleep(0.3)

        # 5. done — HistoryItem
        item = {
            "id": f"gen-{uuid.uuid4().hex[:8]}",
            "mode": "generate",
            "prompt": body.prompt,
            "label": body.prompt[:28] + ("…" if len(body.prompt) > 28 else ""),
            "width": aspect.width,
            "height": aspect.height,
            "seed": inj.seed,
            "steps": body.steps,
            "cfg": body.cfg,
            "lightning": body.lightning,
            "model": GENERATE_MODEL.display_name,
            "createdAt": int(time.time() * 1000),
            "imageRef": f"mock-seed://{uuid.uuid4().hex}",
            "upgradedPrompt": upgrade.upgraded,
            "promptProvider": upgrade.provider,
            "researchHints": research_hints,
        }
        await task.emit("done", {"item": item})
    except Exception as e:
        log.exception("Generate pipeline error")
        await task.emit("error", {"message": str(e)})
    finally:
        await task.close()


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

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(400, "empty image")

    task = _new_task()
    asyncio.create_task(
        _run_edit_pipeline(task, image_bytes, prompt, lightning, image.filename or "input.png")
    )
    return TaskCreated(
        task_id=task.task_id,
        stream_url=f"/api/studio/edit/stream/{task.task_id}",
    )


@router.get("/edit/stream/{task_id}")
async def edit_stream(task_id: str):
    task = TASKS.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return StreamingResponse(
        _stream_task(task),
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
) -> None:
    try:
        # Step 1: vision analysis
        await task.emit("step", {"step": 1, "done": False})
        vision = await run_vision_pipeline(image_bytes, prompt)
        await task.emit(
            "step",
            {
                "step": 1,
                "done": True,
                "description": vision.image_description,
            },
        )

        # Step 2: prompt merge (already done inside vision pipeline)
        await task.emit("step", {"step": 2, "done": False})
        await asyncio.sleep(0.2)
        await task.emit(
            "step",
            {
                "step": 2,
                "done": True,
                "finalPrompt": vision.final_prompt,
                "provider": vision.upgrade.provider,
            },
        )

        # Step 3: size/style auto-extraction (mock — 원본 사이즈 그대로 사용)
        await task.emit("step", {"step": 3, "done": False})
        await asyncio.sleep(0.15)
        await task.emit("step", {"step": 3, "done": True})

        # Step 4: ComfyUI dispatch (mock)
        await task.emit("step", {"step": 4, "done": False})
        lightning_lora = next(
            (l.name for l in EDIT_MODEL.loras if l.role == "lightning"),
            "",
        )
        inj = EditInjection(
            prompt=vision.final_prompt,
            enable_turbo_mode=lightning,
            seed=int(time.time() * 1000),
            unet_name=EDIT_MODEL.files.unet,
            clip_name=EDIT_MODEL.files.clip,
            vae_name=EDIT_MODEL.files.vae,
            lora_name=lightning_lora,
            image_filename=filename,
        )
        _wf, _api = build_edit_prompt(
            EDIT_MODEL.workflow, EDIT_MODEL.subgraph_id, inj
        )
        await asyncio.sleep(0.8)
        await task.emit("step", {"step": 4, "done": True})

        # Done
        item = {
            "id": f"edit-{uuid.uuid4().hex[:8]}",
            "mode": "edit",
            "prompt": prompt,
            "label": prompt[:28] + ("…" if len(prompt) > 28 else ""),
            "width": 1024,  # TODO: 실 이미지 사이즈
            "height": 1024,
            "seed": inj.seed,
            "steps": EDIT_MODEL.lightning.steps if lightning else EDIT_MODEL.defaults.steps,
            "cfg": EDIT_MODEL.lightning.cfg if lightning else EDIT_MODEL.defaults.cfg,
            "lightning": lightning,
            "model": EDIT_MODEL.display_name,
            "createdAt": int(time.time() * 1000),
            "imageRef": f"mock-seed://{uuid.uuid4().hex}",
            "upgradedPrompt": vision.final_prompt,
            "visionDescription": vision.image_description,
        }
        await task.emit("done", {"item": item})
    except Exception as e:
        log.exception("Edit pipeline error")
        await task.emit("error", {"message": str(e)})
    finally:
        await task.close()


# ─────────────────────────────────────────────
# Research (sync)
# ─────────────────────────────────────────────


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


def _preset_to_dict(preset) -> dict[str, Any]:
    """dataclass → JSON-ready dict (camelCase 변환은 안 함 — 프론트 모델-프리셋 계약 맞춤)."""
    d = asdict(preset)
    # camelCase 호환 변환 (프론트 model-presets.ts 와 매칭)
    return d


@router.get("/models")
async def list_models():
    return {
        "generate": _preset_to_dict(GENERATE_MODEL),
        "edit": _preset_to_dict(EDIT_MODEL),
        "aspectRatios": [asdict(a) for a in ASPECT_RATIOS],
    }


# ─────────────────────────────────────────────
# Process (mock)
# ─────────────────────────────────────────────


_PROC_STATUS = {"ollama": True, "comfyui": False}  # 간단 mock 상태 저장


@router.get("/process/status")
async def process_status():
    return {
        "ollama": {"running": _PROC_STATUS["ollama"]},
        "comfyui": {"running": _PROC_STATUS["comfyui"]},
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

    _PROC_STATUS[name] = action == "start"
    return ProcessAction(ok=True, message=f"{name} {action} (mock)")
