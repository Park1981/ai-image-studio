"""
Ollama 기반 프롬프트 보강/번역 엔진
- 한국어 → 영어 번역
- 스타일별 품질 태그 추가
- 부정 프롬프트 자동 생성
- Ollama 장애 시 폴백 처리
"""

import json
import logging
import re

import httpx

from config import settings
from models.schemas import EnhanceResponse

logger = logging.getLogger(__name__)

# Ollama API 타임아웃 (초) — LLM 추론은 오래 걸릴 수 있음
_LLM_TIMEOUT: float = 60.0

# ─────────────────────────────────────────────
# 시스템 프롬프트 상수
# ─────────────────────────────────────────────

_SYSTEM_PROMPT: str = """You are an expert Stable Diffusion prompt engineer.
Your task is to enhance user prompts for AI image generation.

RULES:
1. If the input is in Korean (or any non-English language), translate it to English first.
2. Enhance the prompt with detailed, descriptive tags appropriate for the specified style.
3. Generate a matching negative prompt to avoid common artifacts.
4. Keep the original intent and subject intact — do NOT change the meaning.
5. Respond ONLY with valid JSON, no extra text.

OUTPUT FORMAT (strict JSON):
{
  "enhanced": "the enhanced English prompt with quality tags",
  "negative": "negative prompt to avoid artifacts"
}"""

# 스타일별 보강 지침
_STYLE_INSTRUCTIONS: dict[str, str] = {
    "photorealistic": (
        "Style: PHOTOREALISTIC. "
        "Add tags like: masterpiece, best quality, photorealistic, "
        "ultra detailed, sharp focus, professional photography, "
        "natural lighting, 8k uhd, dslr, high resolution."
    ),
    "anime": (
        "Style: ANIME. "
        "Add tags like: masterpiece, best quality, anime style, "
        "detailed eyes, beautiful detailed face, cel shading, "
        "vibrant colors, clean lineart, illustration."
    ),
    "illustration": (
        "Style: DIGITAL ILLUSTRATION. "
        "Add tags like: masterpiece, best quality, digital art, "
        "illustration, detailed, colorful, concept art, "
        "artstation, trending, smooth."
    ),
    "cinematic": (
        "Style: CINEMATIC. "
        "Add tags like: masterpiece, best quality, cinematic lighting, "
        "dramatic atmosphere, film grain, movie still, "
        "depth of field, volumetric lighting, 8k."
    ),
    "fantasy": (
        "Style: FANTASY ART. "
        "Add tags like: masterpiece, best quality, fantasy art, "
        "magical, ethereal, detailed environment, epic composition, "
        "dramatic lighting, concept art."
    ),
}

# Ollama 실패 시 스타일별 기본 품질 태그 (폴백용)
_FALLBACK_QUALITY_TAGS: dict[str, str] = {
    "photorealistic": (
        "masterpiece, best quality, photorealistic, "
        "ultra detailed, sharp focus, 8k uhd"
    ),
    "anime": (
        "masterpiece, best quality, anime style, "
        "detailed, vibrant colors, illustration"
    ),
    "illustration": (
        "masterpiece, best quality, digital art, "
        "illustration, detailed, concept art"
    ),
    "cinematic": (
        "masterpiece, best quality, cinematic lighting, "
        "dramatic, film grain, 8k"
    ),
    "fantasy": (
        "masterpiece, best quality, fantasy art, "
        "magical, ethereal, epic composition"
    ),
}

# 기본 부정 프롬프트 (폴백용)
_FALLBACK_NEGATIVE: str = (
    "lowres, bad anatomy, bad hands, text, error, missing fingers, "
    "extra digit, fewer digits, cropped, worst quality, low quality, "
    "normal quality, jpeg artifacts, signature, watermark, username, blurry, "
    "deformed, ugly, duplicate, morbid, mutilated"
)


class PromptEngine:
    """Ollama 기반 프롬프트 보강 엔진"""

    def __init__(self) -> None:
        self._ollama_url: str = settings.ollama_url
        self._model: str = settings.ollama_model

    # ─────────────────────────────────────────────
    # 메인 보강 함수
    # ─────────────────────────────────────────────

    async def enhance_prompt(
        self, prompt: str, style: str = "photorealistic"
    ) -> EnhanceResponse:
        """
        프롬프트 보강 (Ollama LLM 활용)
        1. 한국어 → 영어 번역
        2. 스타일 기반 품질 태그 추가
        3. 부정 프롬프트 생성

        Ollama 장애 시 폴백: 원본 + 기본 태그 반환
        """
        # 스타일 지침 선택 (미등록 스타일은 photorealistic 기본)
        style_instruction = _STYLE_INSTRUCTIONS.get(
            style, _STYLE_INSTRUCTIONS["photorealistic"]
        )

        user_message = f"{style_instruction}\n\nUser prompt: {prompt}"

        try:
            result = await self._call_ollama(user_message)

            if result is not None:
                enhanced = result.get("enhanced", prompt)
                negative = result.get("negative", _FALLBACK_NEGATIVE)

                logger.info("프롬프트 보강 완료 (스타일: %s)", style)
                return EnhanceResponse(
                    original=prompt,
                    enhanced=enhanced,
                    negative=negative,
                )

        except Exception as exc:
            logger.error("프롬프트 보강 실패 — 폴백 사용: %s", exc)

        # 폴백: 원본 + 기본 태그
        return self._build_fallback(prompt, style)

    # ─────────────────────────────────────────────
    # Ollama API 호출
    # ─────────────────────────────────────────────

    async def _call_ollama(self, user_message: str) -> dict | None:
        """
        Ollama /api/generate 호출
        반환: 파싱된 JSON 딕셔너리 또는 None
        """
        payload = {
            "model": self._model,
            "system": _SYSTEM_PROMPT,
            "prompt": user_message,
            "stream": False,
            "options": {
                "temperature": 0.7,
                "num_predict": 1024,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=_LLM_TIMEOUT) as client:
                resp = await client.post(
                    f"{self._ollama_url}/api/generate",
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()

        except httpx.TimeoutException:
            logger.error("Ollama 응답 타임아웃 (%.0f초)", _LLM_TIMEOUT)
            return None
        except httpx.HTTPError as exc:
            logger.error("Ollama API 호출 실패: %s", exc)
            return None

        # Ollama 응답에서 텍스트 추출
        raw_response = data.get("response", "")
        if not raw_response:
            logger.warning("Ollama 빈 응답")
            return None

        # JSON 파싱 시도
        return self._parse_llm_json(raw_response)

    # ─────────────────────────────────────────────
    # LLM 응답 JSON 파싱
    # ─────────────────────────────────────────────

    def _parse_llm_json(self, raw: str) -> dict | None:
        """
        LLM 응답에서 JSON 추출 및 파싱
        - 직접 JSON 파싱 시도
        - 실패 시 코드블록(```json ... ```) 내부 추출 시도
        - 실패 시 중괄호 범위 추출 시도
        """
        # 1차: 직접 파싱
        try:
            return json.loads(raw.strip())
        except json.JSONDecodeError:
            pass

        # 2차: 코드블록 내부 추출
        code_block_match = re.search(
            r"```(?:json)?\s*\n?(.*?)\n?\s*```",
            raw,
            re.DOTALL,
        )
        if code_block_match:
            try:
                return json.loads(code_block_match.group(1).strip())
            except json.JSONDecodeError:
                pass

        # 3차: 중괄호 범위 추출
        brace_match = re.search(r"\{.*\}", raw, re.DOTALL)
        if brace_match:
            try:
                return json.loads(brace_match.group(0))
            except json.JSONDecodeError:
                pass

        logger.warning("LLM 응답 JSON 파싱 실패: %s", raw[:200])
        return None

    # ─────────────────────────────────────────────
    # 폴백 처리
    # ─────────────────────────────────────────────

    def _build_fallback(
        self, prompt: str, style: str
    ) -> EnhanceResponse:
        """
        Ollama 장애 시 폴백 응답 생성
        원본 프롬프트 + 스타일별 기본 태그 결합
        """
        quality_tags = _FALLBACK_QUALITY_TAGS.get(
            style, _FALLBACK_QUALITY_TAGS["photorealistic"]
        )

        # 원본 프롬프트 뒤에 품질 태그 추가
        enhanced = f"{prompt}, {quality_tags}"

        logger.info("폴백 프롬프트 생성 (스타일: %s)", style)
        return EnhanceResponse(
            original=prompt,
            enhanced=enhanced,
            negative=_FALLBACK_NEGATIVE,
        )


# 싱글톤 인스턴스
prompt_engine = PromptEngine()
