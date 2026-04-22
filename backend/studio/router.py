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
from pathlib import Path as _Path
try:
    from config import settings  # type: ignore

    STUDIO_OUTPUT_DIR = _Path(settings.output_image_path) / "studio"
    STUDIO_URL_PREFIX = "/images/studio"
except Exception:
    # 폴백 (테스트 환경 등)
    STUDIO_OUTPUT_DIR = _Path("backend/output/images/studio")
    STUDIO_URL_PREFIX = "/images/studio"
STUDIO_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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
    # 설정에서 override 가능 (None 이면 프리셋 기본값)
    ollama_model: str | None = Field(default=None, alias="ollamaModel")
    vision_model: str | None = Field(default=None, alias="visionModel")
    # 사용자가 "업그레이드 확인" 모달에서 미리 확정한 프롬프트
    # (있으면 gemma4 upgrade/ research 단계 생략)
    pre_upgraded_prompt: str | None = Field(
        default=None, alias="preUpgradedPrompt"
    )

    class Config:
        populate_by_name = True


class UpgradeOnlyBody(BaseModel):
    """gemma4 업그레이드 + 선택적 조사만 수행 · ComfyUI 디스패치 없음."""

    prompt: str = Field(..., min_length=1)
    research: bool = False
    ollama_model: str | None = Field(default=None, alias="ollamaModel")

    class Config:
        populate_by_name = True


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

        api_prompt = build_generate_from_request(
            prompt=upgrade.upgraded,
            aspect_label=body.aspect,
            steps=body.steps,
            cfg=body.cfg,
            seed=actual_seed,
            lightning=body.lightning,
        )

        # 5. ComfyUI 디스패치
        await task.emit(
            "stage",
            {
                "type": "comfyui-sampling",
                "progress": 70,
                "stageLabel": "ComfyUI 샘플링",
            },
        )
        image_ref, comfy_error = await _dispatch_to_comfy(
            task,
            api_prompt,
            progress_start=70,
            progress_end=95,
        )

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
            "width": aspect.width,
            "height": aspect.height,
            "seed": actual_seed,
            "steps": body.steps,
            "cfg": body.cfg,
            "lightning": body.lightning,
            "model": GENERATE_MODEL.display_name,
            "createdAt": int(time.time() * 1000),
            "imageRef": image_ref,
            "upgradedPrompt": upgrade.upgraded,
            "promptProvider": upgrade.provider,
            "researchHints": research_hints,
            "comfyError": comfy_error,
        }
        try:
            await history_db.insert_item(item)
        except Exception as db_err:
            log.warning("history_db insert failed: %s", db_err)
        await task.emit("done", {"item": item})
    except Exception as e:
        log.exception("Generate pipeline error")
        await task.emit("error", {"message": str(e)})
    finally:
        await task.close()


async def _dispatch_to_comfy(
    task: Task,
    api_prompt: dict[str, Any],
    *,
    progress_start: int,
    progress_end: int,
) -> tuple[str, str | None]:
    """ComfyUI 에 API prompt 제출 + WS 진행 수신 + 결과 이미지 다운로드.

    Returns:
        (imageRef, error_message) — error_message 는 ComfyUI 실패 시 설명. 성공 시 None.
        imageRef 는 성공 시 "/images/studio/xxx.png", 실패+fallback 시 "mock-seed://...".
    """
    client_id = f"ais-{uuid.uuid4().hex[:10]}"
    try:
        async with ComfyUITransport() as comfy:
            prompt_id = await comfy.submit(api_prompt, client_id)
            log.info("ComfyUI submitted prompt_id=%s", prompt_id)

            # WebSocket 진행 수신 — progress 이벤트만 SSE 에 진행률 반영
            span = progress_end - progress_start
            async for evt in comfy.listen(client_id, prompt_id):
                if evt.kind == "execution_error":
                    error = evt.data.get("exception_message", "unknown")
                    return (_mock_ref_or_raise(error), error)
                if evt.kind == "progress":
                    pct = evt.percent or 0.0
                    progress = progress_start + int(span * pct)
                    await task.emit(
                        "stage",
                        {
                            "type": "comfyui-sampling",
                            "progress": progress,
                            "stageLabel": f"ComfyUI 샘플링 {int(pct * 100)}%",
                        },
                    )
                # execution_success 면 루프 종료 (listen 내부에서 return)

            # 결과 이미지 가져오기
            history = await comfy.get_history(prompt_id)
            images = extract_output_images(history)
            if not images:
                return (_mock_ref_or_raise("no output images"), "no output images")

            img_info = images[0]
            raw = await comfy.download_image(
                filename=img_info["filename"],
                subfolder=img_info["subfolder"],
                image_type=img_info["type"],
            )

        # 로컬 저장
        save_name = f"{uuid.uuid4().hex}.png"
        save_path = STUDIO_OUTPUT_DIR / save_name
        save_path.write_bytes(raw)
        image_ref = f"{STUDIO_URL_PREFIX}/{save_name}"
        log.info("ComfyUI image saved: %s", image_ref)
        return (image_ref, None)

    except Exception as e:
        log.warning("ComfyUI dispatch failed: %s", e)
        return (_mock_ref_or_raise(str(e)), str(e))


def _mock_ref_or_raise(reason: str) -> str:
    """COMFY_MOCK_FALLBACK 설정에 따라 mock ref 반환 또는 예외."""
    if COMFY_MOCK_FALLBACK:
        return f"mock-seed://{uuid.uuid4().hex}"
    raise RuntimeError(reason)


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

    task = _new_task()
    asyncio.create_task(
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
    ollama_model_override: str | None = None,
    vision_model_override: str | None = None,
) -> None:
    try:
        # Step 1: vision analysis
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

        # Step 4: ComfyUI dispatch — 업로드 → 프롬프트 제출 → 결과 수신
        await task.emit("step", {"step": 4, "done": False})

        actual_seed = int(time.time() * 1000)
        image_ref: str
        comfy_err: str | None = None
        client_id = f"ais-e-{uuid.uuid4().hex[:10]}"

        try:
            async with ComfyUITransport() as comfy:
                # 업로드 (ComfyUI input/ 폴더)
                uploaded = await comfy.upload_image(image_bytes, filename or "input.png")
                api_prompt = build_edit_from_request(
                    prompt=vision.final_prompt,
                    source_filename=uploaded,
                    seed=actual_seed,
                    lightning=lightning,
                )
                prompt_id = await comfy.submit(api_prompt, client_id)
                async for evt in comfy.listen(client_id, prompt_id):
                    if evt.kind == "execution_error":
                        comfy_err = evt.data.get("exception_message", "unknown")
                        break
                if comfy_err is None:
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
                    image_ref = f"{STUDIO_URL_PREFIX}/{save_name}"
                else:
                    image_ref = _mock_ref_or_raise(comfy_err)
        except Exception as e:
            log.warning("Edit ComfyUI dispatch failed: %s", e)
            comfy_err = str(e)
            image_ref = _mock_ref_or_raise(comfy_err)

        await task.emit("step", {"step": 4, "done": True})

        # Done
        item = {
            "id": f"edit-{uuid.uuid4().hex[:8]}",
            "mode": "edit",
            "prompt": prompt,
            "label": prompt[:28] + ("…" if len(prompt) > 28 else ""),
            "width": 1024,  # TODO: 원본 해상도 추출
            "height": 1024,
            "seed": actual_seed,
            "steps": EDIT_MODEL.lightning.steps if lightning else EDIT_MODEL.defaults.steps,
            "cfg": EDIT_MODEL.lightning.cfg if lightning else EDIT_MODEL.defaults.cfg,
            "lightning": lightning,
            "model": EDIT_MODEL.display_name,
            "createdAt": int(time.time() * 1000),
            "imageRef": image_ref,
            "upgradedPrompt": vision.final_prompt,
            "visionDescription": vision.image_description,
            "comfyError": comfy_err,
        }
        try:
            await history_db.insert_item(item)
        except Exception as db_err:
            log.warning("history_db insert failed: %s", db_err)
        await task.emit("done", {"item": item})
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
