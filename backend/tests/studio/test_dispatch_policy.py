from __future__ import annotations

from unittest.mock import AsyncMock

import pytest


def test_mock_ref_raises_when_comfy_mock_fallback_disabled(monkeypatch) -> None:
    from studio.pipelines import _dispatch

    monkeypatch.setattr(_dispatch, "COMFY_MOCK_FALLBACK", False)

    with pytest.raises(RuntimeError, match="comfy down"):
        _dispatch._mock_ref_or_raise("comfy down")


def test_mock_ref_returns_seed_when_comfy_mock_fallback_enabled(monkeypatch) -> None:
    from studio.pipelines import _dispatch

    monkeypatch.setattr(_dispatch, "COMFY_MOCK_FALLBACK", True)

    assert _dispatch._mock_ref_or_raise("comfy down").startswith("mock-seed://")


# ────────────────────────────────────────────────────────────
# Phase 5 (2026-04-27) — ComfyUI 자동 기동 (_ensure_comfyui_ready)
# ────────────────────────────────────────────────────────────


class _FakeTask:
    """task.emit 만 캡처하는 가벼운 mock — 실제 Task 의 큐/취소 로직 불필요."""

    def __init__(self) -> None:
        self.events: list[tuple[str, dict]] = []

    async def emit(self, event_type: str, payload: dict) -> None:
        self.events.append((event_type, payload))


@pytest.mark.asyncio
async def test_ensure_comfyui_ready_skips_when_proc_mgr_none(monkeypatch) -> None:
    """테스트 환경처럼 services.process_manager 미로드 시 — 무영향 return."""
    from studio.pipelines import _dispatch

    monkeypatch.setattr(_dispatch, "_proc_mgr", None)
    task = _FakeTask()

    await _dispatch._ensure_comfyui_ready(task, progress_at=68)

    assert task.events == []


@pytest.mark.asyncio
async def test_ensure_comfyui_ready_skips_when_already_running(monkeypatch) -> None:
    """ComfyUI 이미 떠 있으면 stage emit 안 함 (warmup row 안 보임)."""
    from studio.pipelines import _dispatch

    fake_mgr = AsyncMock()
    fake_mgr.check_comfyui = AsyncMock(return_value=True)
    fake_mgr.start_comfyui = AsyncMock(return_value=True)
    monkeypatch.setattr(_dispatch, "_proc_mgr", fake_mgr)

    task = _FakeTask()
    await _dispatch._ensure_comfyui_ready(task, progress_at=68)

    assert task.events == []
    fake_mgr.start_comfyui.assert_not_awaited()


@pytest.mark.asyncio
async def test_ensure_comfyui_ready_emits_warmup_and_starts(monkeypatch) -> None:
    """ComfyUI 꺼져 있으면 warmup stage emit + start_comfyui 호출 (자동 기동)."""
    from studio.pipelines import _dispatch

    fake_mgr = AsyncMock()
    fake_mgr.check_comfyui = AsyncMock(return_value=False)
    fake_mgr.start_comfyui = AsyncMock(return_value=True)
    monkeypatch.setattr(_dispatch, "_proc_mgr", fake_mgr)

    task = _FakeTask()
    await _dispatch._ensure_comfyui_ready(task, progress_at=68)

    # 1번만 emit + type=comfyui-warmup + progress 전달 확인
    assert len(task.events) == 1
    event_type, payload = task.events[0]
    assert event_type == "stage"
    assert payload["type"] == "comfyui-warmup"
    assert payload["progress"] == 68
    assert "stageLabel" in payload
    fake_mgr.start_comfyui.assert_awaited_once()


@pytest.mark.asyncio
async def test_ensure_comfyui_ready_raises_when_start_fails(monkeypatch) -> None:
    """start_comfyui 가 False 반환 시 RuntimeError → 상위 _dispatch except 로 위임."""
    from studio.pipelines import _dispatch

    fake_mgr = AsyncMock()
    fake_mgr.check_comfyui = AsyncMock(return_value=False)
    fake_mgr.start_comfyui = AsyncMock(return_value=False)
    monkeypatch.setattr(_dispatch, "_proc_mgr", fake_mgr)

    task = _FakeTask()

    with pytest.raises(RuntimeError, match="ComfyUI 시작 실패"):
        await _dispatch._ensure_comfyui_ready(task, progress_at=68)

    # 실패해도 warmup stage 는 미리 emit 됨 (UI 가 시도 표시 후 종료)
    assert len(task.events) == 1
    assert task.events[0][1]["type"] == "comfyui-warmup"


@pytest.mark.asyncio
async def test_ensure_comfyui_ready_graceful_when_healthcheck_raises(
    monkeypatch,
) -> None:
    """check_comfyui 가 예외 → warmup skip (헬스체크 실패가 dispatch 막으면 회귀 위험)."""
    from studio.pipelines import _dispatch

    fake_mgr = AsyncMock()
    fake_mgr.check_comfyui = AsyncMock(side_effect=RuntimeError("network glitch"))
    fake_mgr.start_comfyui = AsyncMock(return_value=True)
    monkeypatch.setattr(_dispatch, "_proc_mgr", fake_mgr)

    task = _FakeTask()
    await _dispatch._ensure_comfyui_ready(task, progress_at=68)

    # emit 없음 + start 도 호출 안 함 (실제 dispatch 가 ComfyUI 직접 호출 시 실패하면
    # 기존 except 경로가 mock_ref 폴백 또는 재-raise 처리)
    assert task.events == []
    fake_mgr.start_comfyui.assert_not_awaited()
