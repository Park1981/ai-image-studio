"""
프롬프트 보강 라우터
- Ollama 기반 한국어 → 영어 번역 + 품질 태그 추가
- 비전(이미지 분석) 기반 프롬프트 보강
"""

from fastapi import APIRouter, HTTPException

from database import delete_template, get_templates, save_template
from models.schemas import (
    ApiResponse,
    EnhanceRequest,
    EnhanceResponse,
    EnhanceWithVisionRequest,
    PromptTemplate,
    PromptTemplateCreate,
)
from legacy.services.image_path import resolve_image_path
from legacy.services.prompt_engine import prompt_engine

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
        provider=request.provider,
    )
    return {"success": True, "data": result}


@router.post("/enhance-with-vision", response_model=ApiResponse[EnhanceResponse])
async def enhance_prompt_with_vision(request: EnhanceWithVisionRequest):
    """비전(이미지 분석) 기반 프롬프트 보강 — 원본 이미지를 Ollama 멀티모달 모델로 분석"""
    # 이미지 파일명 → 실제 경로 변환 (services/image_path.resolve_image_path 공통 헬퍼)
    image_path = resolve_image_path(request.source_image)
    if image_path is None:
        raise HTTPException(
            status_code=404,
            detail=f"이미지를 찾을 수 없습니다: {request.source_image}",
        )

    result = await prompt_engine.enhance_prompt_with_vision(
        prompt=request.prompt,
        image_path=str(image_path),
        style=request.style,
        mode="edit",
        ollama_model=request.ollama_model,
        categories=request.categories,
        creativity=request.creativity,
        detail_level=request.detail_level,
    )
    return {"success": True, "data": result}


# ─────────────────────────────────────────────
# 프롬프트 템플릿 CRUD
# ─────────────────────────────────────────────

@router.get("/templates", response_model=ApiResponse[list[PromptTemplate]])
async def list_templates():
    """저장된 프롬프트 템플릿 목록 조회"""
    templates = await get_templates()
    return {"success": True, "data": templates}


@router.post("/templates", response_model=ApiResponse[PromptTemplate])
async def create_template(body: PromptTemplateCreate):
    """새 프롬프트 템플릿 저장"""
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="템플릿 이름을 입력해주세요.")
    result = await save_template(
        name=body.name.strip(),
        prompt=body.prompt,
        negative_prompt=body.negative_prompt,
        style=body.style,
    )
    return {"success": True, "data": result}


@router.delete("/templates/{template_id}", response_model=ApiResponse[dict])
async def remove_template(template_id: int):
    """프롬프트 템플릿 삭제"""
    deleted = await delete_template(template_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="존재하지 않는 템플릿입니다.")
    return {
        "success": True,
        "data": {"id": template_id, "message": "템플릿이 삭제되었습니다."},
    }


