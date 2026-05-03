"""Studio 메모리 내 태스크 큐 (router.py 분해 · task #10 · 2026-04-26).

router.py 458-612 줄에 있던 Task 클래스 + TASKS dict + lock + cleanup 로직을
별도 모듈로 추출. behavior 무변경 (path/공개 API 유지).

router.py 가 이 모듈에서 다음을 import:
    Task, TASKS, _TASKS_LOCK, TASK_TTL_SEC (legacy alias),
    _new_task, _cleanup_stale_tasks, start_cleanup_loop, stop_cleanup_loop
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any

log = logging.getLogger(__name__)


def _inc_active_dispatch() -> None:
    """ProcessManager 활성 카운터 증가 (lazy import — 순환 회피).

    process_manager 미존재 (테스트 환경 등) 또는 호출 실패는 silent ignore.
    Task lifecycle 정확성보다 import safety 우선.
    """
    try:
        from services.process_manager import process_manager

        process_manager.increment_active_dispatch()
    except Exception as exc:
        log.warning("inc active_dispatch failed (non-fatal): %s", exc)


def _dec_active_dispatch() -> None:
    """ProcessManager 활성 카운터 감소 (lazy import — 순환 회피)."""
    try:
        from services.process_manager import process_manager

        process_manager.decrement_active_dispatch()
    except Exception as exc:
        log.warning("dec active_dispatch failed (non-fatal): %s", exc)


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
        # P0-1 (2026-04-26): 활성 task 가 idle 상태인지 판정하기 위한 마지막 이벤트 시각.
        # emit() 호출마다 갱신. 좀비 worker (ComfyUI hang 등) 회수에 사용.
        self.last_event_at = self.created_at
        # close() 호출 시점 — closed 이후 메모리 회수 TTL 계산용.
        self.closed_at: float | None = None
        self.worker: asyncio.Task[Any] | None = None
        # 2026-05-03: ProcessManager._active_dispatch_count idempotency flag.
        # close() 와 cancel() 모두 dec 시도하므로 이미 dec 했으면 noop.
        self._dispatch_counted: bool = False

    async def emit(self, event_type: str, payload: dict[str, Any]) -> None:
        # last_event_at 갱신 — 활성 task 의 idle 판정 기준.
        # 주의: single-threaded asyncio 라 _TASKS_LOCK 없이 안전 (Codex 검증).
        self.last_event_at = time.monotonic()
        await self.queue.put({"event": event_type, "data": payload})

    async def close(self) -> None:
        if not self.closed:
            self.closed = True
            self.closed_at = time.monotonic()
            await self.queue.put({"event": "__close__", "data": {}})
            # 활성 dispatch 카운트 감소 (idempotent — close/cancel 중복 호출 방어).
            if self._dispatch_counted:
                self._dispatch_counted = False
                _dec_active_dispatch()

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
        # 활성 dispatch 카운트 감소 (idempotent — close 가 먼저 호출된 경우 noop).
        if self._dispatch_counted:
            self._dispatch_counted = False
            _dec_active_dispatch()


TASKS: dict[str, Task] = {}
_TASKS_LOCK = asyncio.Lock()

# P0-1 (2026-04-26): TTL 정책을 4-state 별로 분리.
# 이전: TASK_TTL_SEC=600 단일 정책 — created_at 기준 → 비디오 7200s · 16GB swap 51분+ 케이스 강제 cancel 발생.
# 신규: closed / orphan(worker None) / worker-done / active 4-state 분리.
#   - CLOSED_TTL: 정상 종료된 task 메모리 회수 시점 (의미상 기존 TASK_TTL_SEC 와 동일)
#   - ORPHAN_GRACE: stream 연결 안 받은 task 회수 (보통 worker spawn 직후 실패 시나리오)
#   - ACTIVE_IDLE_TTL: 활성 worker 가 일정 시간 emit 없으면 좀비 추정 → cancel.
#       Codex 검증: emit() 은 ComfyUI progress WS 이벤트에서만 호출되므로 swap 케이스 emit gap 이
#       기존안 1500s 를 넘을 수 있음 → ComfyUI hard_timeout(7200s) + 5분 buffer = 7500s 로 보수화.
#       사실상 좀비 회수용 hard cap.
_CLOSED_TTL_SEC = 600  # 10분 — closed 후 메모리 회수
_ORPHAN_GRACE_SEC = 120  # 2분 — worker 미할당 task 회수
_ACTIVE_IDLE_TTL_SEC = 7500  # 2시간 5분 — emit 없이 idle 시 좀비 회수 (ComfyUI hard_timeout + buffer)
_CLEANUP_INTERVAL_SEC = 120  # 2분마다 stale sweep

# 하위호환 — 외부에서 import 하는 케이스 보호 (현재 import 검색 0건이지만 safety)
TASK_TTL_SEC = _CLOSED_TTL_SEC


async def _new_task() -> Task:
    """Task 등록 (lock 보호). cleanup 은 별도 백그라운드 task 에서 주기 실행."""
    async with _TASKS_LOCK:
        task_id = f"tsk-{uuid.uuid4().hex[:12]}"
        t = Task(task_id)
        # 활성 dispatch 카운터 증가 (5 mode 공통 · ComfyUI idle shutdown 보호).
        # close() 또는 cancel() 시점에 정확히 한 번 dec.
        t._dispatch_counted = True
        _inc_active_dispatch()
        TASKS[task_id] = t
        return t


async def _cleanup_stale_tasks() -> int:
    """4-state 별 TTL 정책으로 stale task 정리 (P0-1 재설계 · 2026-04-26).

    분류 순서 (Codex 검증 — closed 를 worker.done() 보다 먼저 봐야 정상 완료 task 즉시 삭제 안 됨):
      1. closed: closed_at 기준 _CLOSED_TTL_SEC 초과 → 회수
      2. orphan (worker None): created_at 기준 _ORPHAN_GRACE_SEC 초과 → 회수
      3. worker.done() (close() 못 부른 비정상 종료): 즉시 회수
      4. active: last_event_at 기준 _ACTIVE_IDLE_TTL_SEC 초과 → 좀비 추정 cancel

    Returns:
        정리된 task 개수.
    """
    async with _TASKS_LOCK:
        now = time.monotonic()
        stale: list[str] = []
        for tid, t in TASKS.items():
            if t.closed:
                # 정상 종료 task — closed_at 기준 메모리 회수
                if t.closed_at is not None and (now - t.closed_at) > _CLOSED_TTL_SEC:
                    stale.append(tid)
            elif t.worker is None:
                # orphan — _new_task 후 worker 할당 전 race (현재 코드엔 발생 가능 path 없지만 방어)
                if (now - t.created_at) > _ORPHAN_GRACE_SEC:
                    stale.append(tid)
            elif t.worker.done():
                # worker 종료됐는데 close() 못 부른 비정상 case — 안전 회수
                stale.append(tid)
            else:
                # 활성 task — emit gap 으로 좀비 판정 (ComfyUI hard_timeout 초과 케이스)
                if (now - t.last_event_at) > _ACTIVE_IDLE_TTL_SEC:
                    stale.append(tid)
        for tid in stale:
            t = TASKS.pop(tid, None)
            # 살아있는 worker 있으면 강제 종료 (좀비 회수)
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
