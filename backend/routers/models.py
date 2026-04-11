"""
모델 목록 조회 라우터
- 체크포인트, LoRA, VAE 목록
- ComfyUI /object_info 기반
"""

from fastapi import APIRouter

from models.schemas import ApiResponse
from services.comfyui_client import comfyui_client
from services.process_manager import process_manager

router = APIRouter(prefix="/api/models", tags=["모델"])


@router.get("/list", response_model=ApiResponse[dict])
async def get_model_list():
    """사용 가능한 모델 목록 조회 (체크포인트, LoRA, VAE)"""
    # ComfyUI가 실행 중인지 확인
    # 빈 응답 기본값
    empty = {
        "checkpoints": [],
        "diffusion_models": [],
        "loras": [],
        "vaes": [],
    }

    running = await process_manager.check_comfyui()
    if not running:
        return {
            "success": False,
            "data": empty,
            "error": "ComfyUI가 실행 중이 아닙니다. 먼저 시작해주세요.",
        }

    try:
        models = await comfyui_client.get_models()
        return {"success": True, "data": models}
    except Exception as exc:
        return {
            "success": False,
            "data": empty,
            "error": f"모델 목록 조회 실패: {exc}",
        }
