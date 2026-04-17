"""
프로세스 상태 관리 라우터
- Ollama / ComfyUI 실행 상태 조회
- ComfyUI 수동 시작/종료
"""

from fastapi import APIRouter

from models.schemas import (
    ApiResponse,
    ComfyUIStatus,
    OllamaStatus,
    ProcessStatusResponse,
)
from services.process_manager import process_manager

router = APIRouter(prefix="/api/process", tags=["프로세스"])


@router.get("/status", response_model=ApiResponse[ProcessStatusResponse])
async def get_process_status():
    """Ollama / ComfyUI 프로세스 상태 조회"""
    ollama_running = await process_manager.check_ollama()
    comfyui_running = await process_manager.check_comfyui()

    # VRAM 사용량 조회 (nvidia-smi)
    vram = process_manager.get_vram_usage()

    return {
        "success": True,
        "data": ProcessStatusResponse(
            ollama=OllamaStatus(running=ollama_running),
            comfyui=ComfyUIStatus(
                running=comfyui_running,
                vram_used_gb=vram["used_gb"],
                vram_total_gb=vram["total_gb"],
                uptime_min=process_manager.get_comfyui_uptime_minutes(),
            ),
        ),
    }


@router.get("/ollama/models", response_model=ApiResponse[list])
async def list_ollama_models():
    """Ollama 설치된 모델 목록 조회"""
    models = await process_manager.list_ollama_models()
    return {"success": True, "data": models}


@router.post("/comfyui/start", response_model=ApiResponse[dict])
async def start_comfyui():
    """ComfyUI 수동 시작"""
    started = await process_manager.start_comfyui()
    if not started:
        return {
            "success": False,
            "data": {},
            "error": "ComfyUI 시작에 실패했습니다. 경로 설정을 확인해주세요.",
        }
    return {
        "success": True,
        "data": {"message": "ComfyUI가 시작되었습니다."},
    }


@router.post("/comfyui/stop", response_model=ApiResponse[dict])
async def stop_comfyui():
    """ComfyUI 수동 종료"""
    stopped = await process_manager.stop_comfyui()
    if not stopped:
        return {
            "success": False,
            "data": {},
            "error": "ComfyUI 종료에 실패했습니다.",
        }
    return {
        "success": True,
        "data": {"message": "ComfyUI가 종료되었습니다."},
    }


@router.post("/ollama/start", response_model=ApiResponse[dict])
async def start_ollama():
    """Ollama 수동 시작"""
    started = await process_manager.start_ollama()
    if not started:
        return {
            "success": False,
            "data": {},
            "error": "Ollama 시작에 실패했습니다. .env의 OLLAMA_EXECUTABLE 경로를 확인해주세요.",
        }
    return {
        "success": True,
        "data": {"message": "Ollama가 시작되었습니다."},
    }


@router.post("/ollama/stop", response_model=ApiResponse[dict])
async def stop_ollama():
    """Ollama 수동 종료 (백엔드가 시작한 경우만)"""
    stopped = await process_manager.stop_ollama()
    if not stopped:
        return {
            "success": False,
            "data": {},
            "error": "Ollama 종료에 실패했습니다.",
        }
    return {
        "success": True,
        "data": {"message": "Ollama가 종료되었습니다."},
    }
