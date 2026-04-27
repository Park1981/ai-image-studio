"""
ollama_unload.py — Ollama 강제 unload 헬퍼 (spec 19 후속 · 2026-04-26).

배경:
  16GB VRAM 환경에서 gemma4-un (14.85GB) + ComfyUI Qwen Image 2512 (12-15GB)
  가 동시 점유 시도 → ComfyUI 가 system RAM 으로 swap → sampling 매우 느림.

  prompt_pipeline 의 _call_ollama_chat 은 keep_alive="0" 을 보내지만,
  Ollama 가 unload 처리하기 전에 ComfyUI 디스패치가 GPU 를 잡으면
  unload 가 deferred 됨 → swap 발생.

해결:
  ComfyUI 디스패치 직전 명시적으로:
    1) /api/ps 로 현재 로드된 모든 모델 조회
    2) 각 모델에 /api/generate keep_alive=0 호출 → 즉시 unload 큐 등록
    3) GPU_RELEASE_WAIT_SEC 대기 → GPU 메모리 실제 반납 보장
    4) 그 후 ComfyUI 가 깨끗한 VRAM 에서 작업 시작

비용: 매 generate/edit/video 마다 +GPU_RELEASE_WAIT_SEC 초 (ComfyUI 30초+ 대비 미미).
효과: swap 차단 → sampling 속도 정상화.

2026-04-27 (N6 단일화): vision_pipeline / video_pipeline 의 단계별 unload sleep 도
이 상수를 공유 — 한 곳에서 조정하면 전체 일관 적용.
"""

from __future__ import annotations

import asyncio
import logging

from ._ollama_client import get_ps, request_unload

log = logging.getLogger(__name__)

try:
    from config import settings  # type: ignore

    _DEFAULT_OLLAMA_URL: str = settings.ollama_url
except Exception:  # pragma: no cover — 테스트/독립 실행 환경
    _DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"

# unload 명령 응답 받은 후 GPU 메모리 실제 반납까지 기다리는 시간.
# Ollama 가 비동기로 메모리 해제하므로 즉시 nvidia-smi 에 반영 안 됨.
# 1.0초 = spec 19 에서 swap 차단 효과 검증된 값. force_unload_all_before_comfy 와
# vision/video pipeline 의 단계별 unload 가 모두 이 상수를 공유 (DRY).
GPU_RELEASE_WAIT_SEC = 1.0

# /api/ps + /api/generate 호출 자체는 빠름 — 짧은 timeout 으로 충분.
_PS_TIMEOUT = 5.0
_UNLOAD_TIMEOUT = 10.0


async def list_loaded_models(
    *, ollama_url: str | None = None, timeout: float = _PS_TIMEOUT
) -> list[str]:
    """현재 Ollama 에 로드된 모델 이름 목록.

    실패 시 빈 리스트 반환 (호출자가 graceful 처리).
    """
    url = ollama_url or _DEFAULT_OLLAMA_URL
    try:
        data = await get_ps(ollama_url=url, timeout=timeout)
        models = data.get("models") or []
        return [
            m.get("model") or m.get("name", "")
            for m in models
            if isinstance(m, dict) and (m.get("model") or m.get("name"))
        ]
    except Exception as e:
        log.info("ollama list_loaded_models failed (non-fatal): %s", e)
        return []


async def unload_model(
    model: str,
    *,
    ollama_url: str | None = None,
    timeout: float = _UNLOAD_TIMEOUT,
) -> bool:
    """단일 모델 강제 unload (`/api/generate keep_alive=0`).

    응답 받으면 done_reason=unload — Ollama 가 메모리 해제 큐에 등록한 상태.
    실제 GPU 반납은 비동기. 호출자가 GPU_RELEASE_WAIT_SEC 만큼 대기 권장.

    Returns:
        True = unload 명령 성공 / False = 실패 (graceful · 비치명).
    """
    if not model.strip():
        return False
    url = ollama_url or _DEFAULT_OLLAMA_URL
    try:
        return await request_unload(
            ollama_url=url,
            model=model,
            timeout=timeout,
        )
    except Exception as e:
        log.info("ollama unload_model(%s) failed (non-fatal): %s", model, e)
        return False


async def force_unload_all_before_comfy(
    *,
    ollama_url: str | None = None,
    wait_sec: float = GPU_RELEASE_WAIT_SEC,
) -> dict:
    """ComfyUI 디스패치 직전 안전장치 — 로드된 모든 Ollama 모델 unload + 대기.

    흐름:
      1) /api/ps 로 현재 로드된 모델 조회
      2) 각 모델에 keep_alive=0 unload 명령 (병렬)
      3) wait_sec 동안 sleep (GPU 메모리 실제 반납 대기)

    실패 / 빈 결과 모두 graceful — ComfyUI 디스패치는 그대로 진행.

    Returns:
        {"unloaded": [model_names], "wait_sec": float}
        실패 시 unloaded=[].
    """
    models = await list_loaded_models(ollama_url=ollama_url)
    if not models:
        # 로드된 모델 없음 = 이미 깨끗한 상태 → 대기도 스킵
        return {"unloaded": [], "wait_sec": 0.0}

    # 모든 모델 unload 명령 병렬 (대부분 1-2개라 부하 미미)
    results = await asyncio.gather(
        *[unload_model(m, ollama_url=ollama_url) for m in models],
        return_exceptions=True,
    )
    unloaded = [
        m for m, ok in zip(models, results, strict=False)
        if ok is True
    ]

    # GPU 메모리 실제 반납 대기 — Ollama 가 비동기로 해제
    if unloaded and wait_sec > 0:
        await asyncio.sleep(wait_sec)

    log.info(
        "ollama force_unload_all_before_comfy: unloaded=%s wait=%.1fs",
        unloaded, wait_sec if unloaded else 0.0,
    )
    return {"unloaded": unloaded, "wait_sec": wait_sec if unloaded else 0.0}
