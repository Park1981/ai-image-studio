"""
PromptEngine 단위 테스트
- JSON 파싱 (직접, 코드블록, 중괄호)
- 폴백 응답 생성
- 카테고리 지침 빌더
- enhance_prompt 전체 흐름 (mock LLM)
"""

import pytest
from unittest.mock import AsyncMock, patch

from legacy.services.prompt_engine import PromptEngine, _FALLBACK_NEGATIVE, CATEGORY_META
from models.schemas import EnhanceCategoryConfig


# ─────────────────────────────────────────────
# _parse_llm_json 테스트
# ─────────────────────────────────────────────

class TestParseLlmJson:
    """LLM 응답 JSON 파싱 전략 테스트"""

    def setup_method(self):
        self.engine = PromptEngine()

    def test_직접_json_파싱(self):
        """유효한 JSON 문자열 직접 파싱"""
        raw = '{"categories": [{"name": "subject"}], "negative": "bad"}'
        result = self.engine._parse_llm_json(raw)
        assert result is not None
        assert result["negative"] == "bad"
        assert len(result["categories"]) == 1

    def test_코드블록_내부_json(self):
        """```json ... ``` 코드블록 내부 JSON 추출"""
        raw = 'Here is the result:\n```json\n{"categories": [], "negative": "blur"}\n```'
        result = self.engine._parse_llm_json(raw)
        assert result is not None
        assert result["negative"] == "blur"

    def test_코드블록_json_라벨_없이(self):
        """``` ... ``` 코드블록 (json 라벨 없이)"""
        raw = '```\n{"categories": [{"name": "style"}], "negative": "ugly"}\n```'
        result = self.engine._parse_llm_json(raw)
        assert result is not None
        assert result["negative"] == "ugly"

    def test_중괄호_범위_추출(self):
        """텍스트 속 중괄호 범위로 JSON 추출"""
        raw = 'Sure! {"categories": [], "negative": "watermark"} hope this helps!'
        result = self.engine._parse_llm_json(raw)
        assert result is not None
        assert result["negative"] == "watermark"

    def test_파싱_실패_none_반환(self):
        """완전히 파싱 불가한 텍스트 → None"""
        raw = "This is not JSON at all, no braces here."
        result = self.engine._parse_llm_json(raw)
        assert result is None

    def test_빈_문자열_none_반환(self):
        """빈 문자열 → None"""
        result = self.engine._parse_llm_json("")
        assert result is None

    def test_불완전_json_none_반환(self):
        """중괄호 있지만 유효하지 않은 JSON"""
        raw = '{"categories": [incomplete'
        result = self.engine._parse_llm_json(raw)
        assert result is None


# ─────────────────────────────────────────────
# _build_fallback 테스트
# ─────────────────────────────────────────────

class TestBuildFallback:
    """폴백 응답 생성 테스트"""

    def setup_method(self):
        self.engine = PromptEngine()

    def test_기본_스타일_폴백(self):
        """photorealistic 스타일 폴백 생성"""
        result = self.engine._build_fallback("a cat", "photorealistic")
        assert result.original == "a cat"
        assert "a cat" in result.enhanced
        assert "masterpiece" in result.enhanced
        assert result.fallback is True
        assert result.provider == "fallback"
        assert result.categories == []
        assert result.negative == _FALLBACK_NEGATIVE

    def test_anime_스타일_폴백(self):
        """anime 스타일 폴백 — 스타일별 태그 적용"""
        result = self.engine._build_fallback("a warrior", "anime")
        assert "anime" in result.enhanced.lower()
        assert result.fallback is True

    def test_미지원_스타일_photorealistic_폴백(self):
        """등록되지 않은 스타일 → photorealistic 기본값 사용"""
        result = self.engine._build_fallback("a house", "unknown_style_xyz")
        assert "photorealistic" in result.enhanced or "masterpiece" in result.enhanced
        assert result.fallback is True


# ─────────────────────────────────────────────
# _build_category_instructions 테스트
# ─────────────────────────────────────────────

class TestBuildCategoryInstructions:
    """카테고리 지침 생성 테스트"""

    def setup_method(self):
        self.engine = PromptEngine()

    def test_기본_카테고리_5개_활성(self):
        """기본 설정: technical=False, 나머지 5개 True"""
        config = EnhanceCategoryConfig()
        result = self.engine._build_category_instructions(config)
        # subject, background, lighting, style, mood 포함 확인
        assert "subject" in result
        assert "background" in result
        assert "technical" not in result  # 기본 OFF

    def test_전체_활성(self):
        """6개 전체 활성"""
        config = EnhanceCategoryConfig(technical=True)
        result = self.engine._build_category_instructions(config)
        for name in CATEGORY_META:
            assert name in result

    def test_전체_비활성(self):
        """전부 False → disabled 메시지"""
        config = EnhanceCategoryConfig(
            subject=False, background=False, lighting=False,
            style=False, mood=False, technical=False,
        )
        result = self.engine._build_category_instructions(config)
        assert "disabled" in result.lower()

    def test_일부만_활성(self):
        """subject + style만 활성"""
        config = EnhanceCategoryConfig(
            subject=True, background=False, lighting=False,
            style=True, mood=False, technical=False,
        )
        result = self.engine._build_category_instructions(config)
        assert "subject" in result
        assert "style" in result
        assert "background" not in result
        assert "lighting" not in result


# ─────────────────────────────────────────────
# enhance_prompt 통합 흐름 테스트 (mock LLM)
# ─────────────────────────────────────────────

class TestEnhancePrompt:
    """enhance_prompt 전체 파이프라인 (LLM mock)"""

    def setup_method(self):
        self.engine = PromptEngine()

    @pytest.mark.asyncio
    async def test_ollama_성공(self):
        """Ollama 정상 응답 → 카테고리 파싱"""
        mock_response = {
            "categories": [
                {"name": "subject", "text_en": "a fluffy cat", "text_ko": "솜털 고양이", "auto_filled": False},
                {"name": "background", "text_en": "garden", "text_ko": "정원", "auto_filled": True},
            ],
            "negative": "bad quality",
        }
        with patch.object(self.engine, "_call_ollama", new_callable=AsyncMock, return_value=mock_response):
            result = await self.engine.enhance_prompt("고양이")

        assert result.original == "고양이"
        assert "fluffy cat" in result.enhanced
        assert result.provider == "ollama"
        assert result.fallback is False
        assert len(result.categories) >= 1

    @pytest.mark.asyncio
    async def test_ollama_실패_claude_폴백(self):
        """Ollama 실패 → Claude CLI 폴백 성공"""
        mock_response = {
            "categories": [
                {"name": "subject", "text_en": "a cute dog", "text_ko": "귀여운 강아지", "auto_filled": False},
            ],
            "negative": "low quality",
        }
        with patch.object(self.engine, "_call_ollama", new_callable=AsyncMock, return_value=None):
            with patch.object(self.engine, "_call_claude_cli", new_callable=AsyncMock, return_value=mock_response):
                result = await self.engine.enhance_prompt("강아지")

        assert result.provider == "claude_cli"
        assert "cute dog" in result.enhanced

    @pytest.mark.asyncio
    async def test_전부_실패_태그_폴백(self):
        """Ollama + Claude CLI 둘 다 실패 → 태그 폴백"""
        with patch.object(self.engine, "_call_ollama", new_callable=AsyncMock, return_value=None):
            with patch.object(self.engine, "_call_claude_cli", new_callable=AsyncMock, return_value=None):
                result = await self.engine.enhance_prompt("풍경", style="landscape")

        assert result.fallback is True
        assert result.provider == "fallback"
        assert "풍경" in result.enhanced
        assert "landscape" in result.enhanced.lower() or "panoramic" in result.enhanced.lower()

    @pytest.mark.asyncio
    async def test_edit_모드(self):
        """mode="edit"일 때 정상 동작"""
        mock_response = {
            "categories": [
                {"name": "subject", "text_en": "modified subject", "text_ko": "수정된 피사체", "auto_filled": False},
            ],
            "negative": "artifacts",
        }
        with patch.object(self.engine, "_call_ollama", new_callable=AsyncMock, return_value=mock_response):
            result = await self.engine.enhance_prompt("배경을 바다로", mode="edit")

        assert result.original == "배경을 바다로"
        assert result.provider == "ollama"

    @pytest.mark.asyncio
    async def test_비활성_카테고리_필터링(self):
        """비활성 카테고리는 결과에서 제외"""
        mock_response = {
            "categories": [
                {"name": "subject", "text_en": "cat", "text_ko": "고양이", "auto_filled": False},
                {"name": "technical", "text_en": "8k uhd", "text_ko": "초고화질", "auto_filled": True},
            ],
            "negative": "bad",
        }
        # technical=False (기본값)
        config = EnhanceCategoryConfig(technical=False)
        with patch.object(self.engine, "_call_ollama", new_callable=AsyncMock, return_value=mock_response):
            result = await self.engine.enhance_prompt("고양이", categories=config)

        # technical 카테고리가 결과에 없어야 함
        cat_names = [c.name for c in result.categories]
        assert "technical" not in cat_names
        assert "subject" in cat_names
