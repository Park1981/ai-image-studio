"""
프롬프트 보강 라우터
- Ollama 기반 한국어 → 영어 번역 + 품질 태그 추가
"""

from fastapi import APIRouter

from models.schemas import ApiResponse, EnhanceRequest, EnhanceResponse
from services.prompt_engine import prompt_engine

router = APIRouter(prefix="/api/prompt", tags=["프롬프트"])


@router.post("/enhance", response_model=ApiResponse[EnhanceResponse])
async def enhance_prompt(request: EnhanceRequest):
    """구조화 프롬프트 AI 보강 (카테고리별 분석 + 빈 항목 자동 채우기)"""
    result = await prompt_engine.enhance_prompt(
        prompt=request.prompt,
        style=request.style,
        model=request.model,
        mode=request.mode,
        creativity=request.creativity,
        detail_level=request.detail_level,
        categories=request.categories,
    )
    return {"success": True, "data": result}
