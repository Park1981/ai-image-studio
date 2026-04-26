"""
모델 목록 조회 라우터
- 체크포인트, LoRA, VAE 목록
- ComfyUI /object_info 기반
- 모델별 권장 파라미터 프리셋
"""

import json
from pathlib import Path

from fastapi import APIRouter

from models.schemas import ApiResponse
from legacy.services.comfyui_client import comfyui_client
from services.process_manager import process_manager  # 신규 위치 유지

# 모델 프리셋 JSON 로드
_PRESETS_PATH = Path(__file__).parent.parent.parent / "models" / "model_presets.json"
_model_presets: dict = {}
if _PRESETS_PATH.exists():
    _model_presets = json.loads(_PRESETS_PATH.read_text(encoding="utf-8"))

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


@router.get("/presets", response_model=ApiResponse[dict])
async def get_model_presets():
    """모델별 권장 파라미터 프리셋 조회"""
    return {
        "success": True,
        "data": {
            "diffusion_models": _model_presets.get("diffusion_models", {}),
            "checkpoints": _model_presets.get("checkpoints", {}),
        },
    }
