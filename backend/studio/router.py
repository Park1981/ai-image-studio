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
  POST /api/studio/vision-analyze    → { en, ko, provider, ... } (multipart, sync)
  POST /api/studio/compare-analyze   → { analysis, saved } (multipart, sync · mutex 보호)
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
import os
import re
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
    VIDEO_MODEL,
    compute_video_resize,
    get_aspect,
)
from .prompt_pipeline import upgrade_generate_prompt
from .claude_cli import research_prompt
from .vision_pipeline import analyze_image_detailed, run_vision_pipeline
from .video_pipeline import run_video_pipeline
from .comparison_pipeline import analyze_pair, analyze_pair_generic
from .comfy_api_builder import (
    build_generate_from_request,
    build_edit_from_request,
    build_video_from_request,
    _snap_dimension,
)
from .comfy_transport import (
    ComfyUITransport,
    extract_output_files,
    extract_output_images,
)
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

# Edit 비교 분석용 source 영구 저장 (Task 5)
EDIT_SOURCE_DIR = STUDIO_OUTPUT_DIR / "edit-source"
EDIT_SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EDIT_SOURCE_URL_PREFIX = f"{STUDIO_URL_PREFIX}/edit-source"

# task_id 검증 정규식 — path traversal 방지 (CLAUDE.md 보안 규칙)
_TASK_ID_RE = re.compile(r"^tsk-[0-9a-f]{12}$")

# edit-source 파일명 화이트리스트 (path traversal 방지).
# 저장 시 uuid4 hex + ".png/.jpg/.jpeg/.webp" 포맷이므로 이 정규식 외엔 삭제 거부.
_EDIT_SOURCE_FILENAME_RE = re.compile(r"^[0-9a-zA-Z_\-]{1,64}\.(png|jpg|jpeg|webp)$")

# result 파일명 화이트리스트 (audit R1-6 · STUDIO_OUTPUT_DIR 직속).
# 영상 결과는 .mp4 확장자 허용. 이미지는 edit-source 와 동일 확장자 세트.
_RESULT_FILENAME_RE = re.compile(
    r"^[0-9a-zA-Z_\-]{1,64}\.(png|jpg|jpeg|webp|mp4)$"
)


def _edit_source_path_from_url(url: str) -> Path | None:
    """edit-source URL 을 실제 파일 경로로 변환. 안전하지 않으면 None.

    보안 방어선:
      1. URL 이 `/images/studio/edit-source/` prefix 로 시작해야 함
      2. 파일명이 `_EDIT_SOURCE_FILENAME_RE` 화이트리스트 통과해야 함
      3. 최종 경로가 EDIT_SOURCE_DIR 내부여야 함 (resolve 후 is_relative_to)
    """
    if not url or not url.startswith(EDIT_SOURCE_URL_PREFIX + "/"):
        return None
    filename = url[len(EDIT_SOURCE_URL_PREFIX) + 1 :].split("?", 1)[0].split("#", 1)[0]
    if not _EDIT_SOURCE_FILENAME_RE.match(filename):
        return None
    candidate = (EDIT_SOURCE_DIR / filename).resolve()
    try:
        if not candidate.is_relative_to(EDIT_SOURCE_DIR.resolve()):
            return None
    except ValueError:
        return None
    return candidate


def _result_path_from_url(url: str) -> Path | None:
    """result(image_ref) URL 을 실제 파일 경로로 변환. 안전하지 않으면 None.

    audit R1-6: DELETE history 시 orphan 된 결과 이미지/영상 파일 정리용.

    보안 방어선:
      1. URL 이 `/images/studio/` prefix 로 시작해야 함
      2. edit-source sub-path (`/images/studio/edit-source/...`) 는 제외
         → edit-source 는 별도 _cleanup_edit_source_file 로만 처리 (이중 삭제 방지)
      3. 파일명이 `_RESULT_FILENAME_RE` 화이트리스트 통과 (png/jpg/jpeg/webp/mp4)
      4. 최종 경로가 STUDIO_OUTPUT_DIR 직속 (sub-directory 거부 — edit-source 재진입 방지)
    """
    if not url:
        return None
    prefix = STUDIO_URL_PREFIX + "/"
    if not url.startswith(prefix):
        return None
    # edit-source sub 는 별도 처리. mock 결과나 타 도메인 URL 도 함께 제외.
    if url.startswith(EDIT_SOURCE_URL_PREFIX + "/"):
        return None
    filename = url[len(prefix) :].split("?", 1)[0].split("#", 1)[0]
    if "/" in filename or "\\" in filename:
        # STUDIO_OUTPUT_DIR 직속만 허용 (sub-directory 경로 거부)
        return None
    if not _RESULT_FILENAME_RE.match(filename):
        return None
    candidate = (STUDIO_OUTPUT_DIR / filename).resolve()
    try:
        if candidate.parent.resolve() != STUDIO_OUTPUT_DIR.resolve():
            # 직속 확인 (symlink 등 우회 방어)
            return None
    except (OSError, ValueError):
        return None
    return candidate


async def _cleanup_edit_source_file(
    url: str | None, *, already_deleted_from_db: bool = True
) -> bool:
    """edit-source URL 에 해당하는 파일을 안전하게 삭제.

    다른 history row 가 같은 source_ref 를 참조하면 (같은 원본에서 연속 수정한 경우)
    삭제하지 않음. url 이 edit-source 가 아니면 아무것도 안 함.

    Args:
        url: source_ref URL
        already_deleted_from_db: DB 에서 이미 삭제된 row 의 source_ref 이면 True.
            False 이면 count >= 1 허용 (= 자기 자신 외 참조 없음).

    Returns:
        True 면 실제로 파일 1개 삭제됨. False 면 스킵/오류.
    """
    if not url:
        return False
    path = _edit_source_path_from_url(url)
    if path is None:
        return False
    # 다른 row 가 이 source_ref 를 참조하는지 확인 (race 는 허용 — 최악의 경우
    # 참조 추가된 직후 삭제되면 해당 row 가 404 source 를 가리킴. 프론트는 graceful).
    remaining = await history_db.count_source_ref_usage(url)
    threshold = 0 if already_deleted_from_db else 1
    if remaining > threshold:
        return False
    try:
        path.unlink(missing_ok=True)
        return True
    except OSError as e:
        log.warning("edit-source 삭제 실패 %s: %s", path, e)
        return False


async def _cleanup_result_file(url: str | None) -> bool:
    """result(image_ref) URL 에 해당하는 파일을 안전하게 삭제 (audit R1-6).

    image_ref 는 본래 1:1 매핑이라 재참조 가능성 낮지만, Generate → Edit 체인 같은
    경우 image_ref 와 다른 row 의 source_ref 가 같은 파일을 가리킬 수 있음.
    파일 자체 count (image_ref + source_ref 양쪽) 가 0 일 때만 삭제.

    Returns:
        True 면 실제로 파일 1개 삭제됨. False 면 스킵/비대상/오류.
    """
    if not url:
        return False
    path = _result_path_from_url(url)
    if path is None:
        return False
    # 같은 URL 이 다른 row 에서 참조되고 있으면 보존 (edit 체인 · 비교 분석 등)
    remaining_as_image = await history_db.count_image_ref_usage(url)
    remaining_as_source = await history_db.count_source_ref_usage(url)
    if remaining_as_image + remaining_as_source > 0:
        return False
    try:
        path.unlink(missing_ok=True)
        return True
    except OSError as e:
        log.warning("result 파일 삭제 실패 %s: %s", path, e)
        return False

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
        # 큐 maxsize 제한 — 이벤트 폭주 시 메모리 보호. 1000 = 초당 50 이벤트 × 20초.
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1000)
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
        """클라이언트 끊김 시 파이프라인 강제 종료 + 큐 drain."""
        self.cancelled = True
        if self.worker and not self.worker.done():
            self.worker.cancel()
        # 큐에 남은 이벤트 drain — 메모리 회수
        try:
            while True:
                self.queue.get_nowait()
        except asyncio.QueueEmpty:
            pass


TASKS: dict[str, Task] = {}
_TASKS_LOCK = asyncio.Lock()
TASK_TTL_SEC = 600  # 10분
_CLEANUP_INTERVAL_SEC = 120  # 2분마다 stale sweep


async def _new_task() -> Task:
    """Task 등록 (lock 보호). cleanup 은 별도 백그라운드 task 에서 주기 실행."""
    async with _TASKS_LOCK:
        task_id = f"tsk-{uuid.uuid4().hex[:12]}"
        t = Task(task_id)
        TASKS[task_id] = t
        return t


async def _cleanup_stale_tasks() -> int:
    """closed 여부와 무관하게 TTL 초과한 task 모두 정리.

    Returns:
        정리된 task 개수.
    """
    async with _TASKS_LOCK:
        now = time.monotonic()
        stale = [
            tid
            for tid, t in TASKS.items()
            if now - t.created_at > TASK_TTL_SEC
        ]
        for tid in stale:
            t = TASKS.pop(tid, None)
            # 살아있는 worker 가 있으면 강제 종료 (좀비 회수)
            if t is not None and not t.closed:
                t.cancel()
        return len(stale)


async def _periodic_cleanup_loop() -> None:
    """앱 lifespan 동안 주기적으로 stale task 정리."""
    while True:
        try:
            await asyncio.sleep(_CLEANUP_INTERVAL_SEC)
            count = await _cleanup_stale_tasks()
            if count:
                log.info("stale task cleanup: %d removed", count)
        except asyncio.CancelledError:
            log.info("cleanup loop cancelled")
            raise
        except Exception:
            # 절대 죽지 않게 — 다음 주기에 재시도
            log.exception("cleanup loop iteration failed")


# 앱 lifespan 에서 시작/종료할 백그라운드 task 핸들 (main.py 의 lifespan 에서 관리)
_cleanup_task_handle: asyncio.Task[None] | None = None


def start_cleanup_loop() -> None:
    """앱 시작 시 호출. 이미 돌고 있으면 noop."""
    global _cleanup_task_handle
    if _cleanup_task_handle is None or _cleanup_task_handle.done():
        _cleanup_task_handle = asyncio.create_task(_periodic_cleanup_loop())


async def stop_cleanup_loop() -> None:
    """앱 종료 시 호출."""
    global _cleanup_task_handle
    if _cleanup_task_handle and not _cleanup_task_handle.done():
        _cleanup_task_handle.cancel()
        try:
            await _cleanup_task_handle
        except (asyncio.CancelledError, Exception):
            pass
        _cleanup_task_handle = None


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


SaveOutputFn = Callable[
    [ComfyUITransport, str], Awaitable[tuple[str, int, int]]
]
"""save_output 콜백 타입. 반환: (url, width, height) · video 는 0,0 반환 가능."""


async def _dispatch_to_comfy(
    task: Task,
    api_prompt_factory: Callable[[str | None], dict[str, Any]],
    *,
    progress_start: int,
    progress_span: int,
    client_prefix: str = "ais",
    upload_bytes: bytes | None = None,
    upload_filename: str | None = None,
    save_output: SaveOutputFn | None = None,
    idle_timeout: float = 600.0,
    hard_timeout: float = 1800.0,
) -> ComfyDispatchResult:
    """ComfyUI 에 API prompt 제출 + WS 진행 수신 + 결과 다운로드 (공용).

    Edit 플로우 (upload_bytes != None): 먼저 `/upload/image` 로 소스 이미지 업로드 →
    업로드된 파일명을 api_prompt_factory 에 넘겨 최종 api_prompt 조립.
    Generate 플로우 (upload_bytes == None): api_prompt_factory(None) 호출로 즉시 조립.

    Args:
        task: 진행률/에러 emit 대상
        api_prompt_factory: (uploaded_filename_or_None) -> api_prompt_dict
        progress_start/progress_span: pipelineProgress 에 매핑할 범위
        upload_bytes/upload_filename: Edit/Video 전용, 둘 다 있어야 업로드 수행
        save_output: 결과 저장 콜백. None 이면 _save_comfy_output (이미지).
            Video 는 _save_comfy_video 주입.
        idle_timeout/hard_timeout: WS listen timeout. Video 는 연장 필요.

    Returns:
        ComfyDispatchResult(image_ref, width, height, comfy_error)
    """
    client_id = f"{client_prefix}-{uuid.uuid4().hex[:10]}"
    save_fn = save_output or _save_comfy_output
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
            async for evt in comfy.listen(
                client_id, prompt_id,
                idle_timeout=idle_timeout, hard_timeout=hard_timeout,
            ):
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

            output_ref, width, height = await save_fn(comfy, prompt_id)
        log.info("ComfyUI output saved: %s (%dx%d)", output_ref, width, height)
        return ComfyDispatchResult(image_ref=output_ref, width=width, height=height)

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


async def _save_comfy_video(
    comfy: ComfyUITransport, prompt_id: str
) -> tuple[str, int, int]:
    """ComfyUI 완료 prompt 의 영상 파일을 다운로드·저장.

    SaveVideo 노드의 outputs 키는 ComfyUI 버전마다 다름 —
    extract_output_files 가 videos/gifs/animated/files/images 순서 탐색.
    width/height 는 PIL 로 못 읽어서 (mp4 이므로) 0 반환. 프론트가 표기 생략.
    """
    history = await comfy.get_history(prompt_id)
    files = extract_output_files(history)
    if not files:
        raise RuntimeError("no video output in history")
    # 영상 확장자 우선 선택 (PNG 프리뷰가 섞여있을 수 있음)
    video_candidates = [
        f for f in files
        if f["filename"].lower().endswith((".mp4", ".webm", ".mov", ".gif"))
    ]
    chosen = video_candidates[0] if video_candidates else files[0]
    raw = await comfy.download_file(
        filename=chosen["filename"],
        subfolder=chosen["subfolder"],
        file_type=chosen["type"],
    )
    ext = os.path.splitext(chosen["filename"])[1] or ".mp4"
    save_name = f"{uuid.uuid4().hex}{ext}"
    (STUDIO_OUTPUT_DIR / save_name).write_bytes(raw)
    return (f"{STUDIO_URL_PREFIX}/{save_name}", 0, 0)


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

        # ── source 영구 저장 (비교 분석용) ──
        # task.task_id 형식 (tsk-xxxxxxxxxxxx) 보장 — 이미 _new_task 에서 생성한 값.
        # 정규식 화이트리스트로 path traversal 방지 (CLAUDE.md 규칙).
        source_ref: str | None = None
        if _TASK_ID_RE.match(task.task_id):
            source_path = EDIT_SOURCE_DIR / f"{task.task_id}.png"
            try:
                # PIL 로 RGB 변환 후 PNG 로 저장 (JPG 입력도 무손실 PNG 로 통일)
                with Image.open(io.BytesIO(image_bytes)) as src_im:
                    src_im.convert("RGB").save(source_path, "PNG")
                source_ref = f"{EDIT_SOURCE_URL_PREFIX}/{task.task_id}.png"
            except Exception as src_err:
                log.warning(
                    "edit source persist failed (non-fatal): %s", src_err
                )
                # 결과는 그대로 살리고 sourceRef=None 으로 진행

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
            "sourceRef": source_ref,
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


# ─────────────────────────────────────────────
# Video i2v (LTX-2.3)
# ─────────────────────────────────────────────


# 20 MB — Edit 와 동일 상한 (영상 생성 input 이미지)
_VIDEO_MAX_IMAGE_BYTES = 20 * 1024 * 1024

# 해상도 슬라이더 범위 (presets.py 와 동일)
from .presets import (  # noqa: E402 — 유도 import (모듈 상단 import 체인은 이미 무거움)
    VIDEO_LONGER_EDGE_MAX as _video_longer_max,
    VIDEO_LONGER_EDGE_MIN as _video_longer_min,
)


def _extract_image_dims(image_bytes: bytes) -> tuple[int, int]:
    """업로드 바이트에서 (width, height) 추출. 실패 시 (0, 0)."""
    try:
        with Image.open(io.BytesIO(image_bytes)) as im:
            return im.size  # (w, h)
    except Exception as exc:  # pragma: no cover — PIL 내부 에러 다양
        log.warning("image dims 추출 실패: %s", exc)
        return 0, 0


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


async def _run_video_pipeline_task(
    task: Task,
    image_bytes: bytes,
    prompt: str,
    filename: str,
    ollama_model_override: str | None = None,
    vision_model_override: str | None = None,
    adult: bool = False,
    source_width: int = 0,
    source_height: int = 0,
    longer_edge: int | None = None,
    lightning: bool = True,
) -> None:
    """Video i2v 파이프라인 백그라운드 실행 (5 step).

    Progress 구간 배분:
      step 1 vision-analyze    0   → 20
      step 2 prompt-merge      20  → 30
      step 3 workflow-dispatch 30  → 35
      step 4 comfyui-sampling  35  → 92  (2-stage 내부 통합)
      step 5 save-output       92  → 98
    """
    try:
        # ── Step 1: vision ── (0 → 20)
        await task.emit(
            "stage",
            {"type": "vision-analyze", "progress": 5, "stageLabel": "비전 분석"},
        )
        await task.emit("step", {"step": 1, "done": False})

        video_res = await run_video_pipeline(
            image_bytes,
            prompt,
            vision_model=vision_model_override or DEFAULT_OLLAMA_ROLES.vision,
            text_model=ollama_model_override or DEFAULT_OLLAMA_ROLES.text,
            adult=adult,
        )

        await task.emit(
            "step",
            {
                "step": 1,
                "done": True,
                "description": video_res.image_description,
            },
        )
        await task.emit(
            "stage",
            {"type": "vision-analyze", "progress": 20, "stageLabel": "비전 분석 완료"},
        )

        # ── Step 2: prompt-merge ── (20 → 30)
        await task.emit(
            "stage",
            {"type": "prompt-merge", "progress": 25, "stageLabel": "프롬프트 병합"},
        )
        await task.emit("step", {"step": 2, "done": False})
        await task.emit(
            "step",
            {
                "step": 2,
                "done": True,
                "finalPrompt": video_res.final_prompt,
                "finalPromptKo": video_res.upgrade.translation,
                "provider": video_res.upgrade.provider,
            },
        )
        await task.emit(
            "stage",
            {"type": "prompt-merge", "progress": 30, "stageLabel": "프롬프트 병합 완료"},
        )

        # ── Step 3: workflow-dispatch ── (30 → 35)
        await task.emit(
            "stage",
            {
                "type": "workflow-dispatch",
                "progress": 33,
                "stageLabel": "워크플로우 전달",
            },
        )
        await task.emit("step", {"step": 3, "done": False})

        actual_seed = int(time.time() * 1000) & 0xFFFFFFFF  # uint32 범위
        # .env 의 LTX_UNET_NAME override (config.settings.ltx_unet_name)
        unet_override = getattr(settings, "ltx_unet_name", None)

        def _make_video_prompt(uploaded_name: str | None) -> dict[str, Any]:
            if uploaded_name is None:
                raise RuntimeError("Video pipeline requires uploaded image")
            return build_video_from_request(
                prompt=video_res.final_prompt,
                source_filename=uploaded_name,
                seed=actual_seed,
                unet_override=unet_override,
                adult=adult,
                source_width=source_width or None,
                source_height=source_height or None,
                longer_edge=longer_edge,
                lightning=lightning,
            )

        await task.emit("step", {"step": 3, "done": True})

        # ── Step 4: ComfyUI sampling ── (35 → 92)
        await task.emit(
            "stage",
            {
                "type": "comfyui-sampling",
                "progress": 35,
                "stageLabel": "ComfyUI 샘플링 대기",
            },
        )
        await task.emit("step", {"step": 4, "done": False})

        dispatch = await _dispatch_to_comfy(
            task,
            _make_video_prompt,
            progress_start=35,
            progress_span=57,
            client_prefix="ais-v",
            upload_bytes=image_bytes,
            upload_filename=filename,
            save_output=_save_comfy_video,
            # LTX 는 긴 작업 — idle 15분, hard 1시간
            idle_timeout=900.0,
            hard_timeout=3600.0,
        )
        video_ref = dispatch.image_ref  # .mp4 URL
        comfy_err = dispatch.comfy_error

        await task.emit("step", {"step": 4, "done": True})

        # ── Step 5: save-output ── (92 → 98)
        await task.emit(
            "stage",
            {"type": "save-output", "progress": 95, "stageLabel": "영상 저장"},
        )
        await task.emit("step", {"step": 5, "done": True})

        # ── Done ──
        s = VIDEO_MODEL.sampling
        # 최종 영상 해상도 계산 — compute_video_resize 는 base(pre-upscale) 을 반환.
        # LTX-2.3 은 spatial upscaler x2 로 공간 해상도만 2배 → 최종 = base × 2.
        base_w, base_h = compute_video_resize(
            source_width or 0, source_height or 0, longer_edge
        )
        final_w, final_h = base_w * 2, base_h * 2
        item = {
            "id": f"vid-{uuid.uuid4().hex[:8]}",
            "mode": "video",
            "prompt": prompt,
            "label": prompt[:28] + ("…" if len(prompt) > 28 else ""),
            "width": final_w,
            "height": final_h,
            "seed": actual_seed,
            "steps": 0,  # LTX 는 ManualSigmas 기반 — 전통 step 개념 없음
            "cfg": s.base_cfg,
            "lightning": lightning,  # 실제 요청값 저장 (Lightning LoRA 토글)
            "model": VIDEO_MODEL.display_name,
            "createdAt": int(time.time() * 1000),
            "imageRef": video_ref,
            "upgradedPrompt": video_res.final_prompt,
            "upgradedPromptKo": video_res.upgrade.translation,
            "visionDescription": video_res.image_description,
            "promptProvider": video_res.upgrade.provider,
            "comfyError": comfy_err,
            # video 전용 메타 — adult/fps/frameCount/durationSec
            "adult": adult,
            "fps": s.fps,
            "frameCount": s.frame_count,
            "durationSec": s.seconds,
        }
        saved_to_history = await _persist_history(item)
        await task.emit(
            "done", {"item": item, "savedToHistory": saved_to_history}
        )

    except asyncio.CancelledError:
        log.info("Video pipeline cancelled: %s", task.task_id)
        raise
    except Exception as e:
        log.exception("Video pipeline error")
        await task.emit("error", {"message": str(e)})
    finally:
        await task.close()


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
    )

    return {
        "en": result.en,
        "ko": result.ko,
        "provider": result.provider,
        "fallback": result.fallback,
        "width": width,
        "height": height,
        "sizeBytes": len(image_bytes),
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

    # mutex — ComfyUI 샘플링과 충돌 회피용 직렬화. 30s 대기 후에도 락이면 503.
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
            # 기본 "edit" 코드 경로 — 기존 동작 100% 보존
            result_obj = await analyze_pair(
                source_bytes=source_bytes,
                result_bytes=result_bytes,
                edit_prompt=edit_prompt,
                vision_model=vision_override,
                text_model=text_override,
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
