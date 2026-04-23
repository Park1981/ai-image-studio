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

from .presets import DEFAULT_OLLAMA_ROLES
from .prompt_pipeline import (
    _DEFAULT_OLLAMA_URL,
    DEFAULT_TIMEOUT,
    UpgradeResult,
    translate_to_korean,
    upgrade_edit_prompt,
)

log = logging.getLogger(__name__)

# Edit 파이프라인용 — 짧은 2~3 문장 캡션
VISION_SYSTEM = (
    "You are a vision captioner. Describe the given image in 2-3 concise "
    "English sentences. Focus on subject, setting, style, lighting, mood. "
    "Output only the description — no preamble."
)

# Vision Analyzer (독립 페이지) 용 — 40~120 단어 프롬프트 엔지니어 어조
SYSTEM_VISION_DETAILED = (
    "You are a prompt engineer analyzing an image for reuse in a "
    "text-to-image generation prompt.\n\n"
    "Output a single English paragraph of 40-120 words that captures: "
    "subject, composition, lighting, mood, color palette, materials/textures, "
    "camera/lens feel, film/style anchors, environment. "
    "Omit safety preambles. No bullets, no markdown. "
    "Return ONLY the paragraph."
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
    ollama_url: str | None = None,
) -> VisionPipelineResult:
    """수정 모드 2단계 체이닝 실행.

    Args:
        image_path: 로컬 파일 경로 (Path/str) 또는 raw bytes
        edit_instruction: 사용자 수정 요청 (한/영)
        ollama_url: 미지정 시 settings.ollama_url 사용
    """
    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL
    description = await _describe_image(
        image_path, vision_model, timeout, resolved_url
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
        ollama_url=resolved_url,
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
        "options": {"temperature": temperature},
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


# ────────────────────────────────────────
# Vision Analyzer (독립 페이지 /vision)
# ────────────────────────────────────────


@dataclass
class VisionAnalysisResult:
    """analyze_image_detailed 결과.

    - fallback=True: 비전 호출 자체 실패 (en 이 빈 문자열)
    - ko=None: 번역만 실패 (en 은 유효, 프론트가 "번역 실패" 표시)
    """

    en: str
    ko: str | None
    provider: str  # "ollama" | "fallback"
    fallback: bool


async def analyze_image_detailed(
    image_bytes: bytes,
    *,
    vision_model: str | None = None,
    text_model: str | None = None,
    ollama_url: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> VisionAnalysisResult:
    """단일 이미지 → 상세 영문 설명 + 한글 번역.

    1) SYSTEM_VISION_DETAILED 로 비전 모델 호출 → en (40-120 단어 목표)
    2) translate_to_korean(en) → ko (실패 시 None, en 은 유지)
    3) 비전 호출 자체 실패 시 fallback=True, en=""

    HTTP 레이어에선 절대 500 안 내는 원칙 — 프론트가 provider/fallback 으로 표시 분기.
    """
    resolved_vision = vision_model or DEFAULT_OLLAMA_ROLES.vision
    resolved_text = text_model or DEFAULT_OLLAMA_ROLES.text
    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL

    en = await _describe_image(
        image_bytes,
        vision_model=resolved_vision,
        timeout=timeout,
        ollama_url=resolved_url,
        system_prompt=SYSTEM_VISION_DETAILED,
        temperature=0.5,
    )
    if not en:
        return VisionAnalysisResult(
            en="", ko=None, provider="fallback", fallback=True
        )

    ko = await translate_to_korean(
        en, model=resolved_text, timeout=60.0, ollama_url=resolved_url
    )
    return VisionAnalysisResult(en=en, ko=ko, provider="ollama", fallback=False)


def _to_base64(image: Path | str | bytes) -> str:
    if isinstance(image, (str, Path)):
        data = Path(image).read_bytes()
    else:
        data = image
    return base64.b64encode(data).decode("ascii")
