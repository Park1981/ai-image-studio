"""
ComfyUI 마지막 dispatch 모델 캐시 — 헤더 VRAM breakdown UI 용.

router.py 의 generate/edit/video 진입 시점에 record() 호출.
system_metrics.get_vram_breakdown() 이 get() 으로 조회해 응답에 포함.

설계 의도:
  - ComfyUI 자체는 "현재 로드된 모델" API 를 제공하지 않음 (LRU 캐시 내부 상태).
  - 우리 backend 가 dispatch 한 모델은 정확히 알고 있으므로, 마지막 사용 모델을
    "현재 VRAM 점유 가능성 가장 높은 후보" 로 표시한다.
  - keep_alive 정책에 따라 unload 됐을 수 있으나, 휴리스틱으로 충분.

Thread safety: 단일 워커 가정 + 단순 dict 쓰기는 GIL 보호. 별도 lock 불필요.
"""

from __future__ import annotations

import time
from typing import TypedDict


class LastDispatch(TypedDict, total=False):
    mode: str  # "generate" | "edit" | "video"
    model: str  # 모델 파일명 또는 별칭 (UI 표시용)
    extras: list[str]  # 부가 모델 (LoRA / VAE / Text Encoder 등)
    timestamp: float


_state: LastDispatch = {}


def record(mode: str, model: str, *, extras: list[str] | None = None) -> None:
    """ComfyUI dispatch 시점에 사용 중인 모델 기록."""
    _state["mode"] = mode
    _state["model"] = model
    _state["extras"] = list(extras) if extras else []
    _state["timestamp"] = time.time()


def get() -> LastDispatch:
    """현재 캐시된 마지막 dispatch 정보 (복사본)."""
    return dict(_state)  # type: ignore[return-value]


def clear() -> None:
    """테스트용 리셋."""
    _state.clear()
