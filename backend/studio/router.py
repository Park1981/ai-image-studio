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
from datetime import datetime
from pathlib import Path
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from PIL import Image, UnidentifiedImageError
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
from .prompt_pipeline import clarify_edit_intent, upgrade_generate_prompt
from .claude_cli import research_prompt
from .vision_pipeline import analyze_image_detailed, run_vision_pipeline
from .video_pipeline import run_video_pipeline
from .comparison_pipeline import analyze_pair, analyze_pair_generic
from .system_metrics import get_system_metrics, get_vram_breakdown
from . import dispatch_state, ollama_unload
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


def _mark_generation_complete() -> None:
    """Studio 파이프라인 완료 시 idle shutdown 타이머 시작.

    레거시 /api/generate 만 호출하던 mark_generation_complete 를 신규 Studio 파이프라인에도 통합.
    _proc_mgr 가 None (테스트 환경) 이면 무시. 호출 자체 실패해도 파이프라인은 정상 완료 처리.
    """
    if _proc_mgr is None:
        return
    try:
        _proc_mgr.mark_generation_complete()
    except Exception as exc:  # pragma: no cover - 방어적
        log.warning("mark_generation_complete 호출 실패: %s", exc)

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

# result 파일명 화이트리스트 (audit R1-6).
# 영상 결과는 .mp4 확장자 허용. 이미지는 edit-source 와 동일 확장자 세트.
# 두 가지 형식 모두 매치:
#   - 레거시 UUID 형식 (STUDIO_OUTPUT_DIR 직속): `<uuid32>.png`
#   - 신규 날짜/카운터 형식 (2026-04-25~, mode/date/ 서브폴더): `gen-1430-001.png`
_RESULT_FILENAME_RE = re.compile(
    r"^[0-9a-zA-Z_\-]{1,64}\.(png|jpg|jpeg|webp|mp4)$"
)

# 신규 저장 구조의 mode 서브폴더 화이트리스트.
_VALID_MODE_DIRS = frozenset({"generate", "edit", "video"})
# 신규 저장 구조의 date 서브폴더 형식 (YYYY-MM-DD).
_DATE_DIR_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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

    audit R1-6 (+ 2026-04-25 저장 구조 변경): DELETE history 시 orphan 된 결과 파일 정리용.

    허용 경로 2종 (둘 다 STUDIO_OUTPUT_DIR 내부):
      - 레거시 직속: `/images/studio/<uuid>.png`
      - 신규 계층: `/images/studio/{generate|edit|video}/YYYY-MM-DD/<filename>.<ext>`

    보안 방어선:
      1. URL 이 `/images/studio/` prefix 로 시작해야 함
      2. edit-source sub-path 는 제외 (이중 삭제 방지 — 별도 _cleanup_edit_source_file)
      3. 직속이면 파일명만 `_RESULT_FILENAME_RE` 통과
      4. 계층이면 [mode ∈ _VALID_MODE_DIRS] / [date = YYYY-MM-DD] / [filename 통과]
         (mode/date 외 다른 서브폴더 구조는 거부 — backslash 포함)
      5. 최종 경로가 STUDIO_OUTPUT_DIR 내부인지 resolve 후 is_relative_to 확인 (symlink 방어)
    """
    if not url:
        return None
    prefix = STUDIO_URL_PREFIX + "/"
    if not url.startswith(prefix):
        return None
    # edit-source sub 는 별도 처리. mock 결과나 타 도메인 URL 도 함께 제외.
    if url.startswith(EDIT_SOURCE_URL_PREFIX + "/"):
        return None
    rel = url[len(prefix) :].split("?", 1)[0].split("#", 1)[0]
    # backslash 는 Windows path separator — URL 에 포함되면 조작 의심 · 거부
    if "\\" in rel:
        return None

    parts = rel.split("/")
    if len(parts) == 1:
        # 레거시 직속 UUID 파일 (하위호환)
        filename = parts[0]
        if not _RESULT_FILENAME_RE.match(filename):
            return None
        candidate = (STUDIO_OUTPUT_DIR / filename).resolve()
    elif len(parts) == 3:
        # 신규 mode/date/filename 계층
        mode_dir, date_dir, filename = parts
        if mode_dir not in _VALID_MODE_DIRS:
            return None
        if not _DATE_DIR_RE.match(date_dir):
            return None
        if not _RESULT_FILENAME_RE.match(filename):
            return None
        candidate = (STUDIO_OUTPUT_DIR / mode_dir / date_dir / filename).resolve()
    else:
        # 기타 depth (예: edit-source 는 위에서 걸렀으므로 여긴 알 수 없는 구조)
        return None

    # 최종 symlink 우회 방어 — 실제 경로가 STUDIO_OUTPUT_DIR 안인지 검증
    try:
        if not candidate.is_relative_to(STUDIO_OUTPUT_DIR.resolve()):
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

# ──────────────────────────────────────────────────────────────────────
# 저장 경로 헬퍼 (2026-04-25 · 저장 구조 정리)
#
# 새 구조: STUDIO_OUTPUT_DIR/{mode}/{YYYY-MM-DD}/{prefix}-{HHMM}-{NNN}.{ext}
#   예: data/images/studio/generate/2026-04-25/gen-1430-001.png
#   예: data/images/studio/edit/2026-04-25/edit-1502-002.png
#   예: data/images/studio/video/2026-04-25/video-1530-001.mp4
#
# 카운터는 해당 폴더 내 통합 (매일 리셋). 충돌 시 retry loop 로 +1.
# 기존 UUID 파일 (STUDIO_OUTPUT_DIR 직속) 은 path traversal 가드에서 여전히 허용.
# ──────────────────────────────────────────────────────────────────────

# mode → 파일명 prefix 매핑
_MODE_PREFIX = {
    "generate": "gen",
    "edit": "edit",
    "video": "video",
}


def _resolve_save_dir(mode: str) -> Path:
    """mode/date 계층 디렉토리 보장 후 반환.

    Args:
        mode: "generate" | "edit" | "video"

    Returns:
        STUDIO_OUTPUT_DIR / mode / YYYY-MM-DD (존재 보장)
    """
    if mode not in _MODE_PREFIX:
        raise ValueError(f"Invalid mode: {mode!r}")
    today = datetime.now().strftime("%Y-%m-%d")
    target = STUDIO_OUTPUT_DIR / mode / today
    target.mkdir(parents=True, exist_ok=True)
    return target


def _next_save_path(mode: str, ext: str) -> tuple[Path, str]:
    """mode/date 폴더 안에서 다음 사용 가능한 저장 경로 생성.

    포맷: {prefix}-{HHMM}-{NNN}.{ext}  (예: gen-1430-001.png)
      - HHMM: 현재 시각 (하루 안 카운터 흐름 이해 용)
      - NNN: 해당 폴더 내 순차 번호 (001 부터, 충돌 시 +1 재시도)

    Args:
        mode: "generate" | "edit" | "video"
        ext: 확장자 ("png", "jpg", "mp4" 등. dot 있어도 허용)

    Returns:
        (절대 경로, URL 상대경로) 튜플.
        URL 상대경로는 STUDIO_URL_PREFIX 뒤에 붙일 `mode/date/file.ext` 형태.
    """
    prefix = _MODE_PREFIX[mode]
    save_dir = _resolve_save_dir(mode)
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    hhmm = now.strftime("%H%M")
    ext = ext.lstrip(".")

    # 폴더 내 기존 파일 수 기반으로 시작 번호 추정 (retry 횟수 최소화)
    try:
        start_n = sum(1 for _ in save_dir.iterdir()) + 1
    except OSError:
        start_n = 1

    n = start_n
    while n <= 9999:
        filename = f"{prefix}-{hhmm}-{n:03d}.{ext}"
        candidate = save_dir / filename
        if not candidate.exists():
            relative = f"{mode}/{date_str}/{filename}"
            return candidate, relative
        n += 1
    # 극단 방어: 한 폴더에 9999개 넘으면 에러
    raise RuntimeError(f"{save_dir} 폴더가 가득 찼음 (9999 초과)")


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


# ─────────────────────────────────────────────
# Pydantic 모델 — task #10 (2026-04-26): schemas.py 모듈로 분리
# ─────────────────────────────────────────────
from .schemas import (  # noqa: E402
    GenerateBody,
    ProcessAction,
    ResearchBody,
    TaskCreated,
    UpgradeOnlyBody,
)


# ─────────────────────────────────────────────
# 메모리 내 태스크 큐 — task #10 (2026-04-26): tasks.py 모듈로 분리
# router.py 분량 줄이기 위해 별도 모듈. 외부 호환을 위해 동일 이름 re-export.
# ─────────────────────────────────────────────
from .tasks import (  # noqa: E402
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

        # spec 19 후속 (Codex 리뷰 fix): resolved_w/h 를 upgrade 호출 전에
        # 미리 결정. 이전엔 upgrade 호출 뒤에 계산돼서 body.width/height 가
        # None (aspect preset 만 쓴 일반 케이스) 이면 upgrade 에 0/0 전달 →
        # SYSTEM_GENERATE 가 aspect context 못 받았음. 이제 preset 이든 직접
        # 지정이든 항상 정확한 dim 을 SYSTEM 에 전달.
        aspect = get_aspect(body.aspect)
        actual_seed = body.seed if body.seed > 0 else int(time.time() * 1000)
        if body.width is not None and body.height is not None:
            resolved_w = _snap_dimension(body.width)
            resolved_h = _snap_dimension(body.height)
        else:
            resolved_w = aspect.width
            resolved_h = aspect.height

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
                # spec 19 후속 (F + Codex 리뷰 fix): resolved_w/h 가 항상 정확
                # (preset 이든 직접 지정이든) → SYSTEM_GENERATE composition 정확도 ↑
                width=resolved_w,
                height=resolved_h,
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

        # 5. ComfyUI 디스패치 (Generate: 업로드 없음, prompt 즉시 조립)
        await task.emit(
            "stage",
            {
                "type": "comfyui-sampling",
                "progress": 70,
                "stageLabel": "ComfyUI 샘플링",
            },
        )

        # spec 19 후속 (옵션 A): ComfyUI 디스패치 직전 Ollama 강제 unload
        # → gemma4 (~14.85GB) 가 unload 되지 않고 남아 ComfyUI 가 swap 모드로
        #   진입하던 race condition 차단. 1.5초 대기로 GPU 메모리 실제 반납 보장.
        await ollama_unload.force_unload_all_before_comfy()

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
                style_id=body.style_id,
            )

        dispatch = await _dispatch_to_comfy(
            task,
            _make_generate_prompt,
            mode="generate",
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
            "styleId": body.style_id,
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
        _mark_generation_complete()
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
    [ComfyUITransport, str, str], Awaitable[tuple[str, int, int]]
]
"""save_output 콜백 타입. 인자: (comfy, prompt_id, mode). mode 는 _next_save_path 에 전달.
반환: (url, width, height) · video 는 0,0 반환 가능."""


async def _dispatch_to_comfy(
    task: Task,
    api_prompt_factory: Callable[[str | None], dict[str, Any]],
    *,
    mode: str,
    progress_start: int,
    progress_span: int,
    client_prefix: str = "ais",
    upload_bytes: bytes | None = None,
    upload_filename: str | None = None,
    save_output: SaveOutputFn | None = None,
    # 2026-04-26 idle 600→1200s, hard 1800→7200s — 16GB VRAM 풀 퀄리티 swap 케이스 안전망.
    idle_timeout: float = 1200.0,
    hard_timeout: float = 7200.0,
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

            output_ref, width, height = await save_fn(comfy, prompt_id, mode)
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


# ComfyUI output 폴더 경로 — 임시 파일 삭제용 (선택 설정)
# .env 에 COMFYUI_OUTPUT_PATH 없으면 cleanup no-op (안전 디폴트).
_COMFYUI_OUTPUT_BASE: Path | None = None
try:
    _env_comfy_out = os.getenv("COMFYUI_OUTPUT_PATH")
    if _env_comfy_out:
        _candidate = Path(_env_comfy_out).resolve()
        if _candidate.is_dir():
            _COMFYUI_OUTPUT_BASE = _candidate
        else:
            log.warning(
                "COMFYUI_OUTPUT_PATH 가 디렉토리가 아님: %s (cleanup 비활성)",
                _env_comfy_out,
            )
except Exception as _e:
    log.warning("COMFYUI_OUTPUT_PATH resolve 실패: %s (cleanup 비활성)", _e)

# 우리가 ComfyUI 에 만든 결과물만 식별 — 다른 워크플로우/사용자 직접 작업 건드리지 않음.
_OUR_COMFY_PREFIXES = ("AIS-Gen", "AIS-Edit", "AIS-Video")


async def _cleanup_comfy_temp(
    comfy: "ComfyUITransport", file_info: dict[str, Any]
) -> None:
    """ComfyUI output 의 임시 파일 삭제 (다운로드 성공 후 호출).

    우리 백엔드가 파일을 영구 보관하므로 ComfyUI 측은 중복 저장. 디스크 절약 위해
    AIS-Gen / AIS-Edit / AIS-Video prefix 로 우리 것만 식별해 삭제.

    .env 의 COMFYUI_OUTPUT_PATH 가 설정되지 않았거나 유효하지 않으면 no-op
    (안전 디폴트 — 잘못된 경로 삭제 방지).

    Args:
        comfy: (향후 HTTP API 기반 삭제 대비 · 현재는 미사용)
        file_info: extract_output_* 가 반환한 {filename, subfolder, type} dict.
    """
    _ = comfy  # 현재는 파일 시스템 직접 접근이라 미사용 (API reserve)
    if _COMFYUI_OUTPUT_BASE is None:
        return
    filename = file_info.get("filename", "")
    subfolder = file_info.get("subfolder", "") or ""
    file_type = file_info.get("type", "output")

    # temp 타입은 ComfyUI 가 자동 정리 — 건드리지 않음
    if file_type != "output":
        return

    # 우리 prefix 만 (다른 워크플로우 결과 보호)
    if not any(filename.startswith(p) for p in _OUR_COMFY_PREFIXES):
        return

    # 경로 조립 + path traversal 방어
    try:
        target = (_COMFYUI_OUTPUT_BASE / subfolder / filename).resolve()
        if not target.is_relative_to(_COMFYUI_OUTPUT_BASE):
            log.warning("comfy cleanup skip - path escapes base: %s", target)
            return
        if target.exists():
            target.unlink()
            log.info("ComfyUI 임시 파일 삭제: %s", target.name)
    except OSError as e:
        log.warning("ComfyUI 임시 파일 삭제 실패 %s: %s", filename, e)


async def _save_comfy_video(
    comfy: ComfyUITransport, prompt_id: str, mode: str
) -> tuple[str, int, int]:
    """ComfyUI 완료 prompt 의 영상 파일을 다운로드·저장.

    SaveVideo 노드의 outputs 키는 ComfyUI 버전마다 다름 —
    extract_output_files 가 videos/gifs/animated/files/images 순서 탐색.
    width/height 는 PIL 로 못 읽어서 (mp4 이므로) 0 반환. 프론트가 표기 생략.

    2026-04-25: mode/date 계층 저장 구조 적용. ComfyUI 측 임시 파일은 다운로드 후 삭제.
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
    ext = os.path.splitext(chosen["filename"])[1].lstrip(".") or "mp4"
    save_path, url_rel = _next_save_path(mode, ext)
    save_path.write_bytes(raw)

    # ComfyUI 측 임시 파일 정리 (디스크 절약 · AIS-Video prefix 로 식별)
    await _cleanup_comfy_temp(comfy, chosen)

    return (f"{STUDIO_URL_PREFIX}/{url_rel}", 0, 0)


async def _save_comfy_output(
    comfy: ComfyUITransport, prompt_id: str, mode: str
) -> tuple[str, int, int]:
    """ComfyUI 완료 prompt 의 첫 이미지를 다운로드·저장하고 (url, width, height) 반환.

    PIL 로 실제 해상도를 읽어 히스토리 메타데이터에 반영 (Edit 결과는 원본+스케일 후 크기가
    프리셋과 다를 수 있음 — 하드코딩 1024 이슈 해소).

    2026-04-25: mode/date 계층 저장 구조 적용. ComfyUI 측 임시 파일은 다운로드 후 삭제.
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
    save_path, url_rel = _next_save_path(mode, "png")
    save_path.write_bytes(raw)

    # ComfyUI 측 임시 파일 정리 (디스크 절약 · AIS-Gen/Edit prefix 로 식별)
    await _cleanup_comfy_temp(comfy, img)

    # 실해상도 추출 — 실패해도 이미지 자체는 살리고 0 으로 폴백
    try:
        with Image.open(io.BytesIO(raw)) as im:
            width, height = im.size
    except Exception as e:
        log.warning("PIL size read failed: %s", e)
        width, height = 0, 0

    return (f"{STUDIO_URL_PREFIX}/{url_rel}", width, height)


# ─────────────────────────────────────────────
# 수정 엔드포인트
# ─────────────────────────────────────────────


_EDIT_MAX_IMAGE_BYTES = 20 * 1024 * 1024  # P1-5 (2026-04-26): Vision/Video 와 동일 정책


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


async def _run_edit_pipeline(
    task: Task,
    image_bytes: bytes,
    prompt: str,
    lightning: bool,
    filename: str,
    ollama_model_override: str | None = None,
    vision_model_override: str | None = None,
    *,
    source_width: int = 0,
    source_height: int = 0,
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
            # spec 19 후속 (Codex P1 #1): SOURCE 이미지 aspect 정보 전달.
            # 이전엔 analyze_edit_source 가 받게 만들었는데 여기서 안 넘겨
            # dead code 였음. 이제 layout/composition 정확도 ↑.
            width=source_width,
            height=source_height,
        )
        # step 1 done payload — Phase 1 (2026-04-25):
        #   기존 description (사용자 표시용 요약) 은 그대로 유지.
        #   신규 editVisionAnalysis 는 구조 분석 성공 시에만 payload 포함 (휘발 · DB X).
        step1_done_payload: dict[str, Any] = {
            "step": 1,
            "done": True,
            "description": vision.image_description,
        }
        # getattr 로 안전 접근 — 기존 테스트의 경량 mock (속성 없음) 호환.
        _analysis = getattr(vision, "edit_vision_analysis", None)
        if _analysis is not None:
            step1_done_payload["editVisionAnalysis"] = _analysis.to_dict()
        await task.emit("step", step1_done_payload)
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

        # spec 19 후속 (옵션 A): Edit 한 사이클은 qwen2.5vl (~14GB) + gemma4
        # (~14.85GB) 둘 다 호출 → 누적 메모리 점유 위험. ComfyUI 디스패치 전
        # 전부 unload + 1.5초 대기.
        await ollama_unload.force_unload_all_before_comfy()

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
            mode="edit",
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
        # Phase 1 (2026-04-25): 구조 분석은 item 에만 붙여 SSE done 으로 전달.
        # insert_item 이 알려진 컬럼만 INSERT 하므로 DB persist X (휘발 패턴 유지).
        if _analysis is not None:
            item["editVisionAnalysis"] = _analysis.to_dict()
            # spec 19 후속 (v6): refined_intent 캐싱 — 비교 분석 (compare-analyze)
            # 이 historyItemId 받으면 이 값을 재사용해 gemma4 cold start ~5초 절약.
            # _analysis.intent 가 정제 영문 1-2문장 (clarify_edit_intent 결과).
            cached_intent = getattr(_analysis, "intent", "") or ""
            if cached_intent:
                item["refinedIntent"] = cached_intent
        saved_to_history = await _persist_history(item)
        await task.emit(
            "done", {"item": item, "savedToHistory": saved_to_history}
        )
        _mark_generation_complete()
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

        # spec 19 후속 (옵션 A): Video 도 vision + upgrade 후 ComfyUI 디스패치 →
        # gemma4 + qwen2.5vl 누적 점유 가능. unload + 1.5초 대기.
        await ollama_unload.force_unload_all_before_comfy()

        dispatch = await _dispatch_to_comfy(
            task,
            _make_video_prompt,
            mode="video",
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
        _mark_generation_complete()

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
