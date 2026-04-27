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

⚠️ 멀티 워커 정책 (2026-04-27 N7):
  - 현재 .env / start.* 정책 = `uvicorn --workers 1` (단일 프로세스).
  - 향후 `--workers 2+` 설정 시:
      (a) 각 worker 가 별도 _state dict 를 가져 헤더 UI 가 worker 별 다른 값 표시
      (b) record() 가 호출된 worker 만 정확하게 추적 (다른 worker 는 빈 dict)
  - 마이그레이션 필요 시: Redis (간단) 또는 SQLite memory-mapped (빌트인) 공유.
  - GPU 자체가 단일 자원이라 worker 늘려도 GPU lock 으로 직렬화돼 큰 이득 없음 — 그대로 유지 권장.
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
