"""
studio.routes._common — endpoint 들이 공유하는 SSE/태스크 유틸.

task #17 (2026-04-26): router.py 풀 분해 시 streams/prompt/vision/compare 모두
import 하는 공용 헬퍼를 한 곳에 모음. endpoint 모듈 자체는 import 비용 최소화.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable

from fastapi import Request

from ..tasks import Task

# 레거시 process_manager 재활용 (실 프로세스 제어 + VRAM 조회).
# 모듈 단위 단일 인스턴스 — system 라우트가 주로 사용 + compare 후 unload 등에서도 참조.
try:
    from services.process_manager import process_manager as _proc_mgr  # type: ignore
except Exception:  # pragma: no cover - 테스트 환경
    _proc_mgr = None


log = logging.getLogger("studio.routes")

# 백그라운드로 돌리는 asyncio.Task 참조 보관 — GC 가 중간에 수거하는 이슈 방지.
# set.add / discard 패턴이 FastAPI 권장.
_BACKGROUND_TASKS: set[asyncio.Task[Any]] = set()


def _spawn(coro: Awaitable[Any]) -> asyncio.Task[Any]:
    """asyncio.create_task 래퍼 — 참조 보관 후 완료 시 자동 discard."""
    task = asyncio.create_task(coro)
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    return task


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
