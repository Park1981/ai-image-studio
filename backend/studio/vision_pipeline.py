"""
vision_pipeline.py - 수정 모드용 이미지 분석 2단계 체이닝.

흐름:
1. 이미지 + "이 이미지를 간결하게 설명해줘" → gemma4-heretic:vision-q4km
   → 이미지 설명 (영문 권장)
2. 이미지 설명 + 사용자 수정 요청 → gemma4-un
   → 최종 수정 프롬프트 (prompt_pipeline.upgrade_edit_prompt 재사용)

vision 모델이 local 에 없거나 호출 실패 시 → 빈 설명으로 진행 (폴백).
"""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from pathlib import Path

import httpx

from .prompt_pipeline import (
    OLLAMA_URL,
    DEFAULT_TIMEOUT,
    UpgradeResult,
    upgrade_edit_prompt,
)

log = logging.getLogger(__name__)

VISION_SYSTEM = (
    "You are a vision captioner. Describe the given image in 2-3 concise "
    "English sentences. Focus on subject, setting, style, lighting, mood. "
    "Output only the description — no preamble."
)


@dataclass
class VisionPipelineResult:
    """비전 → 수정 프롬프트 파이프라인 최종 결과."""

    image_description: str
    """1단계 비전 모델 출력."""

    final_prompt: str
    """2단계 gemma4-un 통합 출력."""

    vision_ok: bool
    upgrade: UpgradeResult


async def run_vision_pipeline(
    image_path: Path | str | bytes,
    edit_instruction: str,
    vision_model: str = "gemma4-heretic:vision-q4km",
    text_model: str = "gemma4-un:latest",
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str = OLLAMA_URL,
) -> VisionPipelineResult:
    """수정 모드 2단계 체이닝 실행.

    Args:
        image_path: 로컬 파일 경로 (Path/str) 또는 raw bytes
        edit_instruction: 사용자 수정 요청 (한/영)
    """
    description = await _describe_image(
        image_path, vision_model, timeout, ollama_url
    )
    vision_ok = bool(description.strip())

    # fallback description: 최소한의 정보라도 전달
    if not vision_ok:
        description = "(vision model unavailable — relying on user instruction only)"

    upgrade = await upgrade_edit_prompt(
        edit_instruction=edit_instruction,
        image_description=description,
        model=text_model,
        timeout=timeout,
        ollama_url=ollama_url,
    )
    return VisionPipelineResult(
        image_description=description,
        final_prompt=upgrade.upgraded,
        vision_ok=vision_ok,
        upgrade=upgrade,
    )


async def _describe_image(
    image_path: Path | str | bytes,
    vision_model: str,
    timeout: float,
    ollama_url: str,
) -> str:
    """Ollama 비전 모델에게 이미지 설명 요청."""
    try:
        b64 = _to_base64(image_path)
    except Exception as e:
        log.warning("Image read failed: %s", e)
        return ""

    payload = {
        "model": vision_model,
        "messages": [
            {"role": "system", "content": VISION_SYSTEM},
            {
                "role": "user",
                "content": "Describe this image.",
                "images": [b64],
            },
        ],
        "stream": False,
        "options": {"temperature": 0.4},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(f"{ollama_url}/api/chat", json=payload)
            res.raise_for_status()
            data = res.json()
            content = (data.get("message") or {}).get("content", "")
            return content.strip()
    except Exception as e:
        log.warning("Vision model call failed (%s): %s", vision_model, e)
        return ""


def _to_base64(image: Path | str | bytes) -> str:
    if isinstance(image, (str, Path)):
        data = Path(image).read_bytes()
    else:
        data = image
    return base64.b64encode(data).decode("ascii")
