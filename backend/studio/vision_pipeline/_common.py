"""
vision_pipeline/_common.py — qwen2.5vl 호출 + 공용 헬퍼 (Phase 4.2 단계 2).

edit_source.py / image_detail.py 둘 다 의존하는 항목:
  - ProgressCallback typedef (router task-based SSE 변환용)
  - VISION_SYSTEM (Edit 짧은 캡션 system · _describe_image 의 default system prompt)
  - _describe_image (qwen2.5vl 캡션 호출 — Edit 폴백 + Vision Analyzer 폴백 + reference_storage / video_pipeline lazy import)
  - _to_base64 (image → base64 PNG)
  - _aspect_label (codex C2 fix · Edit `_call_vision_edit_source` + Vision Analyzer `_call_vision_recipe_v2` 둘 다 사용)

prompt_pipeline alias:
  - _DEFAULT_OLLAMA_URL (Ollama 기본 URL)
  - DEFAULT_TIMEOUT (Ollama call timeout)
"""

from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import Awaitable, Callable

from .._ollama_client import call_chat_payload

# alias re-export — facade `__init__.py` 와 sub-module 들이 이 곳을 거쳐 사용.
# _common 안 직접 사용 X → ruff F401 noqa 명시.
from ..prompt_pipeline import (  # noqa: F401
    DEFAULT_TIMEOUT,
    _DEFAULT_OLLAMA_URL,
)


# Phase 6 (2026-04-27): progress callback 시그니처 — analyze_* 함수가 단계 transition
# 시점에 호출. router (task-based SSE) 가 stage emit 으로 변환. None 이면 무영향.
ProgressCallback = Callable[[str], Awaitable[None]]

log = logging.getLogger("studio.vision_pipeline")


VISION_SYSTEM = (
    "You are a vision captioner. Describe the given image in 2-3 concise "
    "English sentences. Focus on subject, setting, style, lighting, mood. "
    "Output only the description — no preamble."
)


async def _describe_image(
    image_path: Path | str | bytes,
    vision_model: str,
    timeout: float,
    ollama_url: str,
    *,
    system_prompt: str = VISION_SYSTEM,
    temperature: float = 0.4,
) -> str:
    """Ollama 비전 모델에게 이미지 설명 요청.

    system_prompt 로 Edit 파이프라인용 캡션 / Vision Analyzer 상세 두 어조 분기.
    """
    try:
        b64 = _to_base64(image_path)
    except Exception as e:
        log.warning("Image read failed: %s", e)
        return ""

    payload = {
        "model": vision_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": "Describe this image.",
                "images": [b64],
            },
        ],
        "stream": False,
        # 2026-04-26: VRAM 즉시 반납 — 비전 모델 14GB 가 ComfyUI 와 충돌 방지
        "keep_alive": "0",
        "options": {"temperature": temperature},
    }
    try:
        return await call_chat_payload(
            ollama_url=ollama_url,
            payload=payload,
            timeout=timeout,
        )
    except Exception as e:
        log.warning("Vision model call failed (%s): %s", vision_model, e)
        return ""


def _aspect_label(width: int, height: int) -> str:
    """W×H → 사람 친화 비율 라벨 (예: '1:1 square', '16:9 widescreen').

    근사 매핑 — Qwen 권장 비율(1664×928 등)이 정확한 16:9 가 아니라도 근사로 잡힘.
    매칭 없으면 GCD 단순화 결과 + 'custom' 라벨.
    """
    if width <= 0 or height <= 0:
        return "unknown aspect"
    # 약수로 단순화 (custom 라벨 표기용)
    from math import gcd

    g = gcd(width, height)
    w_r, h_r = width // g, height // g

    # 근사 매핑 — 약 2% 오차 허용 (Qwen 권장 1664×928 = 1.793 ≈ 16:9 = 1.778)
    ratio = width / height
    common: list[tuple[float, str]] = [
        (1.0, "1:1 square"),
        (16 / 9, "16:9 widescreen"),
        (9 / 16, "9:16 vertical"),
        (4 / 3, "4:3 standard"),
        (3 / 4, "3:4 portrait"),
        (3 / 2, "3:2 landscape"),
        (2 / 3, "2:3 tall portrait"),
    ]
    for target_ratio, label in common:
        if abs(ratio - target_ratio) < target_ratio * 0.02:
            return label
    return f"{w_r}:{h_r} custom"


def _to_base64(image: Path | str | bytes) -> str:
    if isinstance(image, (str, Path)):
        data = Path(image).read_bytes()
    else:
        data = image
    return base64.b64encode(data).decode("ascii")
