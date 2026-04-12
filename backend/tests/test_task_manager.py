"""
TaskManager 단위 테스트
- 태스크 CRUD (생성, 조회, 업데이트)
- 동시성 보호 (asyncio.Lock)
- 오래된 태스크 정리
"""

import time

import pytest

from services.task_manager import TaskManager
from models.schemas import GenerateRequest, EditRequest


# ─────────────────────────────────────────────
# TaskManager 기본 CRUD
# ─────────────────────────────────────────────

class TestTaskManagerCrud:
    """태스크 생성, 조회, 업데이트"""

    @pytest.fixture(autouse=True)
    def fresh_manager(self):
        """매 테스트마다 새 TaskManager 인스턴스"""
        self.tm = TaskManager()

    @pytest.mark.asyncio
    async def test_태스크_생성(self):
        """create_task → id/status/mode 확인"""
        request = GenerateRequest(prompt="a cat")
        task = await self.tm.create_task(request, mode="generate")

        assert task.id is not None
        assert len(task.id) == 8  # uuid[:8]
        assert task.mode == "generate"
        assert task.status == "queued"
        assert task.request is request

    @pytest.mark.asyncio
    async def test_edit_태스크_생성(self):
        """edit 모드 태스크 생성"""
        request = EditRequest(source_image="img.png", edit_prompt="blue sky")
        task = await self.tm.create_task(request, mode="edit")

        assert task.mode == "edit"
        assert task.status == "queued"

    @pytest.mark.asyncio
    async def test_태스크_조회(self):
        """get_task로 생성된 태스크 조회"""
        request = GenerateRequest(prompt="sunset")
        task = await self.tm.create_task(request)

        found = await self.tm.get_task(task.id)
        assert found is not None
        assert found.id == task.id
        assert found.request.prompt == "sunset"

    @pytest.mark.asyncio
    async def test_존재하지_않는_태스크_조회(self):
        """없는 ID → None"""
        result = await self.tm.get_task("nonexistent")
        assert result is None

    @pytest.mark.asyncio
    async def test_태스크_업데이트(self):
        """update_task로 상태 변경"""
        request = GenerateRequest(prompt="tree")
        task = await self.tm.create_task(request)

        await self.tm.update_task(task.id, status="generating", progress=50)

        updated = await self.tm.get_task(task.id)
        assert updated.status == "generating"
        assert updated.progress == 50

    @pytest.mark.asyncio
    async def test_없는_필드_업데이트_무시(self):
        """존재하지 않는 필드 → 조용히 무시"""
        request = GenerateRequest(prompt="test")
        task = await self.tm.create_task(request)

        # 없는 필드 넣어도 에러 안 남
        await self.tm.update_task(task.id, nonexistent_field="value")

        updated = await self.tm.get_task(task.id)
        assert not hasattr(updated, "nonexistent_field")

    @pytest.mark.asyncio
    async def test_없는_태스크_업데이트(self):
        """존재하지 않는 태스크 업데이트 → 에러 없이 무시"""
        # 에러가 발생하지 않아야 함
        await self.tm.update_task("nope", status="error")


# ─────────────────────────────────────────────
# 태스크 정리
# ─────────────────────────────────────────────

class TestTaskCleanup:
    """오래된 태스크 자동 정리"""

    @pytest.mark.asyncio
    async def test_오래된_태스크_정리(self):
        """max_age_hours 초과 태스크 삭제"""
        tm = TaskManager()

        # 태스크 2개 생성
        request = GenerateRequest(prompt="old")
        old_task = await tm.create_task(request)
        new_task = await tm.create_task(GenerateRequest(prompt="new"))

        # old_task의 created_at을 25시간 전으로 조작
        old_task.created_at = time.time() - (25 * 3600)

        removed = await tm.cleanup_old_tasks(max_age_hours=24)
        assert removed == 1

        # old_task는 삭제됨
        assert await tm.get_task(old_task.id) is None
        # new_task는 유지
        assert await tm.get_task(new_task.id) is not None

    @pytest.mark.asyncio
    async def test_정리_대상_없음(self):
        """모든 태스크가 신선하면 삭제 없음"""
        tm = TaskManager()
        await tm.create_task(GenerateRequest(prompt="fresh"))
        removed = await tm.cleanup_old_tasks(max_age_hours=24)
        assert removed == 0


# ─────────────────────────────────────────────
# 동시성 테스트
# ─────────────────────────────────────────────

class TestTaskConcurrency:
    """asyncio.Lock 동시성 보호 확인"""

    @pytest.mark.asyncio
    async def test_동시_생성_고유_id(self):
        """동시에 여러 태스크 생성 → 모두 고유 ID"""
        import asyncio

        tm = TaskManager()
        requests = [GenerateRequest(prompt=f"test_{i}") for i in range(20)]
        tasks = await asyncio.gather(
            *[tm.create_task(req) for req in requests]
        )

        ids = [t.id for t in tasks]
        assert len(set(ids)) == 20  # 모두 고유

    @pytest.mark.asyncio
    async def test_동시_업데이트(self):
        """동시에 같은 태스크 업데이트 → 데이터 무결성"""
        import asyncio

        tm = TaskManager()
        task = await tm.create_task(GenerateRequest(prompt="shared"))

        # 동시에 progress를 업데이트
        async def update_progress(val: float):
            await tm.update_task(task.id, progress=val)

        await asyncio.gather(
            *[update_progress(float(i)) for i in range(10)]
        )

        # 마지막 업데이트가 적용되어야 함 (정확한 값은 비결정적이지만 무결성은 유지)
        result = await tm.get_task(task.id)
        assert 0 <= result.progress <= 9
