"""Shared GPU gate for local Ollama and ComfyUI work.

The app targets a single 16GB GPU. Ollama vision/text models and ComfyUI
sampling must not overlap, or ComfyUI can fall back to slow system-RAM swap.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

log = logging.getLogger(__name__)

GPU_LOCK_TIMEOUT_SEC = 30.0

_GPU_LOCK = asyncio.Lock()


class GpuBusyError(RuntimeError):
    """Raised when the single-GPU gate stays busy beyond the timeout."""

    def __init__(self, operation: str, timeout: float = GPU_LOCK_TIMEOUT_SEC) -> None:
        self.operation = operation
        self.timeout = timeout
        super().__init__(f"{operation} busy (locked > {timeout:g}s)")


async def acquire_gpu_slot(
    operation: str,
    *,
    timeout: float = GPU_LOCK_TIMEOUT_SEC,
) -> None:
    """Acquire the process-wide GPU slot or raise a backpressure error."""
    try:
        await asyncio.wait_for(_GPU_LOCK.acquire(), timeout=timeout)
    except asyncio.TimeoutError as exc:
        raise GpuBusyError(operation, timeout) from exc
    log.debug("GPU slot acquired: %s", operation)


def release_gpu_slot(operation: str) -> None:
    """Release the process-wide GPU slot acquired by acquire_gpu_slot()."""
    _GPU_LOCK.release()
    log.debug("GPU slot released: %s", operation)


@asynccontextmanager
async def gpu_slot(
    operation: str,
    *,
    timeout: float = GPU_LOCK_TIMEOUT_SEC,
) -> AsyncIterator[None]:
    """Context manager wrapper for a short Ollama/ComfyUI GPU section."""
    await acquire_gpu_slot(operation, timeout=timeout)
    try:
        yield
    finally:
        release_gpu_slot(operation)
