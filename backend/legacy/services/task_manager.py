"""
태스크 관리 서비스
- 인메모리 태스크 저장소 + asyncio.Lock 동시성 보호
- 생성/수정 통합 태스크 관리
- 오래된 태스크 자동 정리
"""

import asyncio
import time
import uuid
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class Task:
    """생성 태스크 데이터"""

    id: str
    mode: str  # "generate" | "edit"
    status: str  # queued, warming_up, enhancing, generating, completed, error, cancelled
    request: Any  # GenerateRequest | EditRequest
    prompt_id: str | None = None
    progress: float = 0
    images: list = field(default_factory=list)
    error: str | None = None
    enhanced_prompt: str | None = None
    negative_prompt: str | None = None
    created_at: float = field(default_factory=time.time)


class TaskManager:
    """태스크 라이프사이클 관리"""

    def __init__(self) -> None:
        self._tasks: dict[str, Task] = {}
        self._lock = asyncio.Lock()

    async def create_task(self, request: Any, mode: str = "generate") -> Task:
        """새 태스크 생성"""
        task_id = str(uuid.uuid4())[:8]
        task = Task(id=task_id, mode=mode, status="queued", request=request)
        async with self._lock:
            self._tasks[task_id] = task
        logger.info("태스크 생성: %s (모드: %s)", task_id, mode)
        return task

    async def get_task(self, task_id: str) -> Task | None:
        """태스크 조회"""
        return self._tasks.get(task_id)

    async def update_task(self, task_id: str, **kwargs: Any) -> None:
        """태스크 상태 업데이트 (Lock 보호)"""
        async with self._lock:
            task = self._tasks.get(task_id)
            if task:
                for key, value in kwargs.items():
                    if hasattr(task, key):
                        setattr(task, key, value)

    async def cleanup_old_tasks(self, max_age_hours: int = 24) -> int:
        """오래된 태스크 정리"""
        cutoff = time.time() - (max_age_hours * 3600)
        removed = 0
        async with self._lock:
            old_ids = [
                tid for tid, t in self._tasks.items() if t.created_at < cutoff
            ]
            for tid in old_ids:
                del self._tasks[tid]
                removed += 1
        if removed:
            logger.info("오래된 태스크 %d개 정리 완료", removed)
        return removed


# 싱글톤 인스턴스
task_manager = TaskManager()
