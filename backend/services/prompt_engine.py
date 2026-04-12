"""
Ollama 기반 구조화 프롬프트 보강 엔진
- 6개 카테고리별 분석 + 빈 항목 자동 채우기
- 한국어 → 영어 번역
- 생성/수정 모드 분리
- 창의성/디테일 레벨 지원
- Ollama 장애 시 Claude CLI 폴백 → 태그 폴백 3단계 처리
"""

import asyncio
import base64
import json
import logging
import re
import subprocess
from io import BytesIO
from pathlib import Path

import httpx

from config import settings
from models.schemas import (
    EnhanceCategoryConfig,
    EnhanceCategoryItem,
    EnhanceResponse,
)

logger = logging.getLogger(__name__)

# Ollama API 타임아웃 (초) — LLM 추론은 오래 걸릴 수 있음
_LLM_TIMEOUT: float = 90.0

# ─────────────────────────────────────────────
# 카테고리 정의
# ─────────────────────────────────────────────

CATEGORY_META: dict[str, dict[str, str]] = {
    "subject": {
        "label_ko": "피사체/인물",
        "desc": "Main subject — person, object, creature. Include appearance, clothing, pose, expression.",
    },
    "background": {
        "label_ko": "배경/환경",
        "desc": "Scene setting — location, environment, season, time of day, indoor/outdoor.",
    },
    "lighting": {
        "label_ko": "조명",
        "desc": "Light direction, quality, color temperature — natural, studio, neon, golden hour, etc.",
    },
    "style": {
        "label_ko": "스타일",
        "desc": "Visual/artistic style — photorealistic, cinematic, anime, oil painting, etc.",
    },
    "mood": {
        "label_ko": "분위기",
        "desc": "Overall atmosphere and emotion — warm, cold, mysterious, romantic, dramatic, etc.",
    },
    "technical": {
        "label_ko": "기술적",
        "desc": "Camera/lens settings — close-up, wide angle, shallow DOF, bokeh, 8k, etc.",
    },
}

# ─────────────────────────────────────────────
# 시스템 프롬프트 (생성 모드)
# ─────────────────────────────────────────────

_SYSTEM_PROMPT_GENERATE: str = """You are an expert AI image generation prompt engineer.
Your task is to analyze the user's prompt and produce a STRUCTURED enhancement with the categories listed below.

## RULES
1. If the input is non-English, translate it to English first.
2. Analyze which categories the user already described.
3. For categories the user DID describe: keep their intent, enhance with more detail.
4. For categories the user did NOT describe: fill them in harmoniously with the described content.
5. Mark each category as auto_filled=true if the user didn't mention it, false if they did.
6. Also provide a Korean explanation (text_ko) for each category.
7. Generate a negative prompt to avoid common artifacts.
8. Respond ONLY with valid JSON.

## CATEGORIES
{category_instructions}

## DETAIL LEVEL: {detail_level}
- minimal: 1-2 descriptive phrases per category
- normal: 2-4 descriptive phrases per category
- detailed: 4-8 descriptive phrases per category

## OUTPUT FORMAT (strict JSON):
IMPORTANT: Only include categories listed above. Do NOT include categories that are not listed.
{{
  "categories": [
    {{"name": "<category_name>", "text_en": "...", "text_ko": "...", "auto_filled": true/false}},
    ...one entry per listed category above...
  ],
  "negative": "negative prompt to avoid artifacts"
}}"""

# ─────────────────────────────────────────────
# 시스템 프롬프트 (수정 모드)
# ─────────────────────────────────────────────

_SYSTEM_PROMPT_EDIT: str = """You are an expert AI image editing prompt engineer.
Your task is to enhance an IMAGE EDIT instruction while preserving the user's change intent.

## RULES
1. The user describes WHAT TO CHANGE in an existing image.
2. Keep the change intent (what to modify) as the core — never alter the meaning.
3. Enhance with specific details that make the edit instruction clearer and more precise.
4. For each relevant category, describe the desired RESULT after editing.
5. Mark auto_filled=true for categories the user didn't specify, false for ones they did.
6. Provide Korean explanation (text_ko) for each category.
7. Generate a negative prompt for artifact avoidance.
8. Respond ONLY with valid JSON.

## CATEGORIES
{category_instructions}

## DETAIL LEVEL: {detail_level}
- minimal: concise edit instruction per category
- normal: moderate detail per category
- detailed: thorough description per category

## OUTPUT FORMAT (strict JSON):
IMPORTANT: Only include categories listed above. Do NOT include categories that are not listed.
{{
  "categories": [
    {{"name": "<category_name>", "text_en": "...", "text_ko": "...", "auto_filled": true/false}},
    ...one entry per listed category above...
  ],
  "negative": "negative prompt to avoid artifacts"
}}"""

# ─────────────────────────────────────────────
# 시스템 프롬프트 (비전 — 이미지 분석 기반 수정)
# ─────────────────────────────────────────────

_SYSTEM_PROMPT_VISION: str = """You are an expert AI image editing prompt engineer with vision capabilities.
You are analyzing an image that the user wants to modify.

## STEPS
1. First, describe what you see in the image: subject, background, style, lighting, mood, colors.
2. Then, incorporate the user's edit instruction while PRESERVING elements they didn't mention.
3. For each category, describe the DESIRED RESULT after editing (not the original state).
4. If the user only mentions changing one aspect (e.g., background), keep all other aspects as they appear in the original image.
5. Mark auto_filled=true for categories the user didn't specify changes for (but describe them as-is from the image), false for ones they explicitly requested changes.

## RULES
1. If the input is non-English, translate it to English first.
2. Preserve the original image's characteristics for unchanged categories.
3. Provide Korean explanation (text_ko) for each category.
4. Generate a negative prompt for artifact avoidance.
5. Respond ONLY with valid JSON.

## CATEGORIES
{category_instructions}

## DETAIL LEVEL: {detail_level}
- minimal: concise description per category
- normal: moderate detail per category
- detailed: thorough description per category

## OUTPUT FORMAT (strict JSON):
IMPORTANT: Only include categories listed above. Do NOT include categories that are not listed.
{{
  "categories": [
    {{"name": "<category_name>", "text_en": "...", "text_ko": "...", "auto_filled": true/false}},
    ...one entry per listed category above...
  ],
  "negative": "negative prompt to avoid artifacts"
}}"""

# 이미지 리사이즈 최대 크기 (비전 API 전달 시)
_VISION_MAX_SIZE: int = 1024

# ─────────────────────────────────────────────
# 스타일별 추가 지침
# ─────────────────────────────────────────────

_STYLE_HINTS: dict[str, str] = {
    "photorealistic": "Aim for photorealistic output. Use photography terms: sharp focus, natural skin, DSLR quality.",
    "anime": "Aim for anime/manga style. Use terms: cel shading, vibrant colors, clean lineart, illustration.",
    "illustration": "Aim for digital illustration. Use terms: concept art, artstation, colorful, smooth rendering.",
    "cinematic": "Aim for cinematic look. Use terms: film grain, dramatic lighting, movie still, volumetric light.",
    "fantasy": "Aim for fantasy art. Use terms: magical, ethereal, epic composition, dramatic sky.",
    "portrait": "This is a PORTRAIT (vertical 9:16). Focus on face, upper body, shallow depth of field, bokeh.",
    "landscape": "This is a LANDSCAPE (horizontal 16:9). Focus on wide angle, panoramic, scenic vista, atmospheric.",
}

# ─────────────────────────────────────────────
# 폴백용 상수
# ─────────────────────────────────────────────

_FALLBACK_QUALITY_TAGS: dict[str, str] = {
    "photorealistic": "masterpiece, best quality, photorealistic, ultra detailed, sharp focus, 8k uhd",
    "anime": "masterpiece, best quality, anime style, detailed, vibrant colors, illustration",
    "illustration": "masterpiece, best quality, digital art, illustration, detailed, concept art",
    "cinematic": "masterpiece, best quality, cinematic lighting, dramatic, film grain, 8k",
    "fantasy": "masterpiece, best quality, fantasy art, magical, ethereal, epic composition",
    "portrait": "masterpiece, best quality, portrait, face focus, shallow depth of field, detailed eyes, bokeh background, 8k uhd",
    "landscape": "masterpiece, best quality, landscape, wide angle, panoramic, scenic view, dramatic sky, 8k uhd",
}

_FALLBACK_NEGATIVE: str = (
    "lowres, bad anatomy, bad hands, text, error, missing fingers, "
    "extra digit, fewer digits, cropped, worst quality, low quality, "
    "normal quality, jpeg artifacts, signature, watermark, username, blurry, "
    "deformed, ugly, duplicate, morbid, mutilated"
)


class PromptEngine:
    """Ollama 기반 구조화 프롬프트 보강 엔진"""

    def __init__(self) -> None:
        self._ollama_url: str = settings.ollama_url
        self._model: str = settings.ollama_model

    # ─────────────────────────────────────────────
    # 카테고리 지침 빌더
    # ─────────────────────────────────────────────

    def _build_category_instructions(
        self, categories: EnhanceCategoryConfig
    ) -> str:
        """활성화된 카테고리만 포함한 지침 문자열 생성"""
        lines: list[str] = []
        cat_dict = categories.model_dump()
        for name, meta in CATEGORY_META.items():
            if cat_dict.get(name, False):
                lines.append(f"- **{name}** ({meta['label_ko']}): {meta['desc']}")
        return "\n".join(lines) if lines else "- All categories disabled."

    # ─────────────────────────────────────────────
    # 메인 보강 함수
    # ─────────────────────────────────────────────

    async def enhance_prompt(
        self,
        prompt: str,
        style: str = "photorealistic",
        model: str = "",
        mode: str = "generate",
        creativity: float = 0.7,
        detail_level: str = "normal",
        categories: EnhanceCategoryConfig | None = None,
    ) -> EnhanceResponse:
        """
        구조화 프롬프트 보강 (Ollama LLM 활용)
        1. 사용자 입력 분석 → 카테고리 분류
        2. 빈 카테고리 자동 채우기
        3. 영어/한국어 병행 출력
        4. 부정 프롬프트 생성

        Ollama 장애 시 Claude CLI → 태그 폴백 3단계 처리
        """
        if categories is None:
            categories = EnhanceCategoryConfig()

        # 활성 카테고리 지침 생성
        cat_instructions = self._build_category_instructions(categories)

        # 모드별 시스템 프롬프트 선택
        if mode == "edit":
            system_prompt = _SYSTEM_PROMPT_EDIT.format(
                category_instructions=cat_instructions,
                detail_level=detail_level,
            )
        else:
            system_prompt = _SYSTEM_PROMPT_GENERATE.format(
                category_instructions=cat_instructions,
                detail_level=detail_level,
            )

        # 스타일 힌트 추가
        style_hint = _STYLE_HINTS.get(style, _STYLE_HINTS["photorealistic"])
        user_message = f"STYLE HINT: {style_hint}\n\nUser prompt: {prompt}"

        # 모델 선택
        use_model = model.strip() if model else self._model

        # ── 1단계: Ollama 시도 ──
        result: dict | None = None
        provider = "ollama"

        try:
            result = await self._call_ollama(
                system_prompt, user_message, use_model, creativity
            )
        except Exception as exc:
            logger.error("Ollama 호출 실패: %s", exc)

        # ── 2단계: Ollama 실패 → Claude CLI 폴백 시도 ──
        if result is None:
            logger.info("Ollama 응답 없음 — Claude CLI 폴백 시도")
            try:
                result = await self._call_claude_cli(system_prompt, user_message)
                if result is not None:
                    provider = "claude_cli"
            except Exception as exc:
                logger.error("Claude CLI 폴백 실패: %s", exc)

        # ── 3단계: 둘 다 실패 → 태그 폴백 ──
        if result is None:
            logger.warning("모든 LLM 폴백 실패 — 기본 태그 폴백 사용")
            return self._build_fallback(prompt, style)

        # ── LLM 응답 파싱 (Ollama 또는 Claude CLI) ──
        raw_cats = result.get("categories", [])
        cat_dict = categories.model_dump()
        category_items: list[EnhanceCategoryItem] = []

        for raw in raw_cats:
            name = raw.get("name", "")
            # 활성화된 카테고리만 포함
            if name in cat_dict and cat_dict.get(name, False):
                meta = CATEGORY_META.get(name, {})
                category_items.append(
                    EnhanceCategoryItem(
                        name=name,
                        label_ko=meta.get("label_ko", name),
                        text_en=raw.get("text_en", ""),
                        text_ko=raw.get("text_ko", ""),
                        auto_filled=raw.get("auto_filled", True),
                    )
                )

        # 합쳐진 프롬프트 생성 (카테고리 영어 텍스트 결합)
        combined_parts = [
            item.text_en for item in category_items if item.text_en
        ]
        enhanced = ", ".join(combined_parts) if combined_parts else prompt

        negative = result.get("negative", _FALLBACK_NEGATIVE)

        logger.info(
            "구조화 프롬프트 보강 완료 (provider: %s, 스타일: %s, 모드: %s, 카테고리: %d개)",
            provider, style, mode, len(category_items),
        )
        return EnhanceResponse(
            original=prompt,
            enhanced=enhanced,
            negative=negative,
            categories=category_items,
            provider=provider,
        )

    # ─────────────────────────────────────────────
    # 비전 기반 프롬프트 보강
    # ─────────────────────────────────────────────

    async def enhance_prompt_with_vision(
        self,
        prompt: str,
        image_path: str,
        style: str = "photorealistic",
        mode: str = "edit",
        ollama_model: str = "",
        categories: EnhanceCategoryConfig | None = None,
        creativity: float = 0.7,
        detail_level: str = "normal",
    ) -> EnhanceResponse:
        """
        비전 기반 프롬프트 보강 — 이미지를 분석하여 프롬프트 퀄리티 향상
        Ollama 멀티모달 모델(gemma4-un)에 이미지를 base64로 전달

        1. image_path에서 이미지 읽기 + base64 인코딩
        2. 비전 전용 시스템 프롬프트로 이미지 분석 + 사용자 편집 의도 결합
        3. 기존 카테고리 JSON 형식으로 응답 파싱
        4. 비전 실패 시 → 텍스트 전용 enhance_prompt()로 폴백
        """
        if categories is None:
            categories = EnhanceCategoryConfig()

        # 이미지 base64 인코딩
        try:
            image_b64 = self._load_and_encode_image(image_path)
        except (FileNotFoundError, ValueError) as exc:
            logger.warning("이미지 로드 실패 — 텍스트 전용 보강으로 폴백: %s", exc)
            return await self.enhance_prompt(
                prompt=prompt, style=style, model=ollama_model,
                mode=mode, creativity=creativity,
                detail_level=detail_level, categories=categories,
            )

        # 활성 카테고리 지침 생성
        cat_instructions = self._build_category_instructions(categories)

        # 비전 전용 시스템 프롬프트
        system_prompt = _SYSTEM_PROMPT_VISION.format(
            category_instructions=cat_instructions,
            detail_level=detail_level,
        )

        # 스타일 힌트 + 사용자 편집 지시
        style_hint = _STYLE_HINTS.get(style, _STYLE_HINTS["photorealistic"])
        user_message = f"STYLE HINT: {style_hint}\n\nUser edit instruction: {prompt}"

        # 모델 선택 (비전 지원 모델 필수)
        use_model = ollama_model.strip() if ollama_model else self._model

        try:
            result = await self._call_ollama_vision(
                system_prompt, user_message, image_b64,
                model=use_model, temperature=creativity,
            )

            if result is not None:
                # 카테고리 결과 파싱 (기존 로직 재사용)
                raw_cats = result.get("categories", [])
                cat_dict = categories.model_dump()
                category_items: list[EnhanceCategoryItem] = []

                for raw in raw_cats:
                    name = raw.get("name", "")
                    if name in cat_dict and cat_dict.get(name, False):
                        meta = CATEGORY_META.get(name, {})
                        category_items.append(
                            EnhanceCategoryItem(
                                name=name,
                                label_ko=meta.get("label_ko", name),
                                text_en=raw.get("text_en", ""),
                                text_ko=raw.get("text_ko", ""),
                                auto_filled=raw.get("auto_filled", True),
                            )
                        )

                combined_parts = [
                    item.text_en for item in category_items if item.text_en
                ]
                enhanced = ", ".join(combined_parts) if combined_parts else prompt
                negative = result.get("negative", _FALLBACK_NEGATIVE)

                logger.info(
                    "비전 기반 프롬프트 보강 완료 (스타일: %s, 카테고리: %d개)",
                    style, len(category_items),
                )
                return EnhanceResponse(
                    original=prompt,
                    enhanced=enhanced,
                    negative=negative,
                    categories=category_items,
                )

        except Exception as exc:
            logger.error("비전 보강 실패 — 텍스트 전용 폴백: %s", exc)

        # 비전 실패 시 텍스트 전용 보강으로 폴백
        logger.info("비전 보강 실패 → 텍스트 전용 enhance_prompt() 폴백")
        return await self.enhance_prompt(
            prompt=prompt, style=style, model=ollama_model,
            mode=mode, creativity=creativity,
            detail_level=detail_level, categories=categories,
        )

    # ─────────────────────────────────────────────
    # 이미지 로드 + base64 인코딩
    # ─────────────────────────────────────────────

    def _load_and_encode_image(self, image_path: str) -> str:
        """
        이미지 파일 읽기 → base64 인코딩
        - 허용된 디렉토리 내 경로인지 검증 (path traversal 방지)
        - 이미지가 너무 크면 리사이즈 (max 1024px)
        """
        file_path = Path(image_path).resolve()

        # path traversal 방지: 허용 디렉토리 확인
        allowed_dirs = [
            Path(settings.upload_path).resolve(),
            Path(settings.output_image_path).resolve(),
        ]
        if not any(
            str(file_path).startswith(str(d)) for d in allowed_dirs
        ):
            raise ValueError(
                f"허용되지 않은 경로: {file_path} "
                f"(허용: {[str(d) for d in allowed_dirs]})"
            )

        if not file_path.exists():
            raise FileNotFoundError(f"이미지 파일을 찾을 수 없음: {file_path}")

        # Pillow로 리사이즈 후 base64 인코딩
        try:
            from PIL import Image, ImageOps

            with Image.open(file_path) as img:
                # EXIF 회전 적용
                img = ImageOps.exif_transpose(img)

                # 최대 크기 초과 시 리사이즈
                if max(img.size) > _VISION_MAX_SIZE:
                    img.thumbnail(
                        (_VISION_MAX_SIZE, _VISION_MAX_SIZE),
                        Image.LANCZOS,
                    )
                    logger.info(
                        "비전용 이미지 리사이즈: %s → %s",
                        file_path.name, img.size,
                    )

                # RGB 변환 (투명도 채널 제거)
                if img.mode in ("RGBA", "P", "LA"):
                    img = img.convert("RGB")

                buffer = BytesIO()
                img.save(buffer, format="JPEG", quality=85)
                return base64.b64encode(buffer.getvalue()).decode("utf-8")

        except ImportError:
            # Pillow 미설치 시 원본 그대로 인코딩 (리사이즈 없음)
            logger.warning("Pillow 미설치 — 원본 이미지 그대로 인코딩")
            raw_bytes = file_path.read_bytes()
            return base64.b64encode(raw_bytes).decode("utf-8")

    # ─────────────────────────────────────────────
    # Ollama Vision API 호출 (이미지 포함)
    # ─────────────────────────────────────────────

    async def _call_ollama_vision(
        self,
        system_prompt: str,
        user_message: str,
        image_b64: str,
        model: str | None = None,
        temperature: float = 0.7,
    ) -> dict | None:
        """
        Ollama /api/generate 비전 호출 — images 파라미터로 base64 이미지 전달
        반환: 파싱된 JSON 딕셔너리 또는 None
        """
        payload = {
            "model": model or self._model,
            "system": system_prompt,
            "prompt": user_message,
            "images": [image_b64],  # Ollama 비전 API: base64 이미지 배열
            "stream": False,
            "keep_alive": "0",  # 완료 후 VRAM 즉시 반납
            "options": {
                "temperature": temperature,
                "num_predict": 2048,
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
            logger.error("Ollama 비전 응답 타임아웃 (%.0f초)", _LLM_TIMEOUT)
            return None
        except httpx.HTTPError as exc:
            logger.error("Ollama 비전 API 호출 실패: %s", exc)
            return None

        # 응답 텍스트 추출
        raw_response = data.get("response", "")
        if not raw_response:
            logger.warning("Ollama 비전 빈 응답")
            return None

        # JSON 파싱 (기존 파서 재사용)
        return self._parse_llm_json(raw_response)

    # ─────────────────────────────────────────────
    # Ollama API 호출
    # ─────────────────────────────────────────────

    async def _call_ollama(
        self,
        system_prompt: str,
        user_message: str,
        model: str | None = None,
        temperature: float = 0.7,
    ) -> dict | None:
        """
        Ollama /api/generate 호출
        반환: 파싱된 JSON 딕셔너리 또는 None
        """
        payload = {
            "model": model or self._model,
            "system": system_prompt,
            "prompt": user_message,
            "stream": False,
            "keep_alive": "0",  # 완료 후 VRAM 즉시 반납 (ComfyUI와 VRAM 충돌 방지)
            "options": {
                "temperature": temperature,
                "num_predict": 2048,  # 카테고리별 출력이므로 토큰 늘림
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
    # Claude CLI 폴백 호출 (VRAM 미사용)
    # ─────────────────────────────────────────────

    async def _call_claude_cli(
        self,
        system_prompt: str,
        user_prompt: str,
    ) -> dict | None:
        """
        Claude CLI 비대화형 모드(-p)로 프롬프트 보강
        Ollama 실패 시 폴백으로 사용 — 클라우드 API 호출이므로 GPU VRAM 미사용
        """
        if not settings.llm_fallback_enabled:
            logger.info("Claude CLI 폴백 비활성화됨 (설정: llm_fallback_enabled=false)")
            return None

        # 시스템 프롬프트 + 사용자 프롬프트를 하나로 결합
        combined = f"[System]\n{system_prompt}\n\n[User]\n{user_prompt}"

        try:
            result = await asyncio.to_thread(
                subprocess.run,
                [settings.claude_cli_path, "-p", combined, "--output-format", "text"],
                capture_output=True,
                text=True,
                timeout=120,  # 2분 타임아웃
                shell=False,  # 보안: shell injection 방지
            )

            if result.returncode != 0:
                logger.error("Claude CLI 비정상 종료 (code=%d): %s",
                             result.returncode, result.stderr[:200])
                return None

            raw_output = result.stdout.strip()
            if not raw_output:
                logger.warning("Claude CLI 빈 응답")
                return None

            # 기존 JSON 파서 재사용
            return self._parse_llm_json(raw_output)

        except FileNotFoundError:
            logger.error("Claude CLI를 찾을 수 없습니다 (경로: %s)", settings.claude_cli_path)
            return None
        except subprocess.TimeoutExpired:
            logger.error("Claude CLI 응답 시간 초과 (120초)")
            return None
        except Exception as exc:
            logger.error("Claude CLI 호출 중 예외: %s", exc)
            return None

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

        enhanced = f"{prompt}, {quality_tags}"

        logger.info("폴백 프롬프트 생성 (스타일: %s)", style)
        return EnhanceResponse(
            original=prompt,
            enhanced=enhanced,
            negative=_FALLBACK_NEGATIVE,
            fallback=True,
            categories=[],  # 폴백 시 카테고리 없음
            provider="fallback",
        )


# 싱글톤 인스턴스
prompt_engine = PromptEngine()
