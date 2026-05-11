"""
video_pipeline.py — LTX-2.3 i2v 용 2단계 프롬프트 체이닝.

흐름:
  1. 이미지 + "이 이미지를 간결하게 설명" → qwen2.5vl
     → 이미지 설명 (영문)
  2. 이미지 설명 + 사용자 영상 지시 → gemma4-un (SYSTEM_VIDEO)
     → 최종 영상 프롬프트 (LTX-2.3 용)

vision 모델 실패 시 → 빈 설명으로 upgrade 진행 (폴백).
Edit 의 run_vision_pipeline 과 구조 동일, upgrade 만 video 용으로 교체.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path

from . import ollama_unload
from .presets import DEFAULT_OLLAMA_ROLES
from .prompt_pipeline import (
    _DEFAULT_OLLAMA_URL,
    DEFAULT_TIMEOUT,
    UpgradeResult,
    upgrade_video_prompt,
)
from .vision_pipeline import VIDEO_VISION_SYSTEM, _describe_image  # 기존 비전 헬퍼 재사용

log = logging.getLogger(__name__)


@dataclass
class VideoPipelineResult:
    """비전 → 영상 프롬프트 파이프라인 최종 결과."""

    image_description: str
    """1단계 vision 모델 출력 (영문). 실패 시 빈 문자열."""

    final_prompt: str
    """2단계 gemma4 통합 출력 (LTX-2.3 용 영문)."""

    vision_ok: bool
    upgrade: UpgradeResult


async def run_video_pipeline(
    image_path: Path | str | bytes,
    user_direction: str,
    vision_model: str | None = None,
    text_model: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    adult: bool = False,
    *,
    # Phase 2 (2026-05-01) — gemma4 보강 모드 ("fast" | "precise") · upgrade 단계로 패스스루.
    prompt_mode: str = "fast",
) -> VideoPipelineResult:
    """영상 생성용 2단계 체이닝 실행.

    Args:
        image_path: 로컬 파일 경로 (Path/str) 또는 raw bytes
        user_direction: 사용자 영상 지시 (한/영)
        vision_model: 비전 모델 (없으면 DEFAULT_OLLAMA_ROLES.vision)
        text_model: 텍스트 모델 (없으면 DEFAULT_OLLAMA_ROLES.text)
        adult: 성인 모드 토글 — upgrade_video_prompt 로 전달되어
            NSFW clause 가 시스템 프롬프트에 주입됨.
    """
    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL
    resolved_vision = vision_model or DEFAULT_OLLAMA_ROLES.vision
    resolved_text = text_model or DEFAULT_OLLAMA_ROLES.text

    description = await _describe_image(
        image_path,
        vision_model=resolved_vision,
        timeout=timeout,
        ollama_url=resolved_url,
        system_prompt=VIDEO_VISION_SYSTEM,  # spec 2026-05-11 v1.1 · i2v 영상 전용
        temperature=0.2,                    # i2v anchor 일관성 (기존 0.4 → 0.2)
    )
    vision_ok = bool(description.strip())
    if not vision_ok:
        # 비전 실패 — 업그레이드가 최소 정보라도 가지고 진행하도록
        description = "(vision model unavailable — relying on user direction only)"

    # spec 19 옵션 B: 비전 (qwen2.5vl ~14GB) 호출 끝났으니 gemma4 호출 전 unload.
    # 16GB VRAM 한계 → 두 모델 동시 점유 시 swap 발생. 단계별 unload 로 차단.
    # 비용: gemma4 cold load ~5초. swap 회피 가치 압도적 (LTX 샘플링 매우 무거움).
    # 2026-04-27 (N6): GPU_RELEASE_WAIT_SEC 단일 상수 공유.
    await ollama_unload.unload_model(resolved_vision, ollama_url=resolved_url)
    await asyncio.sleep(ollama_unload.GPU_RELEASE_WAIT_SEC)

    upgrade = await upgrade_video_prompt(
        user_direction=user_direction,
        image_description=description,
        model=resolved_text,
        timeout=timeout,
        ollama_url=resolved_url,
        adult=adult,
        prompt_mode=prompt_mode,
    )

    return VideoPipelineResult(
        image_description=description,
        final_prompt=upgrade.upgraded,
        vision_ok=vision_ok,
        upgrade=upgrade,
    )
