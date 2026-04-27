from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_gpu_slot_times_out_when_already_held() -> None:
    from studio._gpu_lock import GpuBusyError, gpu_slot

    async with gpu_slot("outer"):
        with pytest.raises(GpuBusyError) as exc_info:
            async with gpu_slot("inner", timeout=0.01):
                pass

    assert "inner busy" in str(exc_info.value)


@pytest.mark.asyncio
async def test_gpu_slot_releases_after_error() -> None:
    from studio._gpu_lock import gpu_slot

    with pytest.raises(RuntimeError):
        async with gpu_slot("raises"):
            raise RuntimeError("boom")

    async with gpu_slot("after-error", timeout=0.01):
        pass
