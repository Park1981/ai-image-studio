"""
AI Image Studio - FastAPI 백엔드 엔트리포인트
lifespan 이벤트로 ComfyUI/Ollama 프로세스 관리
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import settings
from database import init_db
from routers import generate, history, models, process, prompt
from services.process_manager import process_manager

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작/종료 시 리소스 관리"""
    # ── 시작 ──
    settings.ensure_data_dirs()
    await init_db()

    # Ollama 상태 확인
    ollama_ok = await process_manager.check_ollama()
    comfyui_ok = await process_manager.check_comfyui()

    logger.info("🚀 AI Image Studio 백엔드 시작")
    logger.info("   ComfyUI: %s (%s)", settings.comfyui_url, "✅ 실행 중" if comfyui_ok else "⏸️ 대기")
    logger.info("   Ollama:  %s (%s) — 모델: %s", settings.ollama_url, "✅ 실행 중" if ollama_ok else "❌ 미실행", settings.ollama_model)

    yield

    # ── 종료 ──
    await process_manager.stop_comfyui()
    logger.info("👋 AI Image Studio 백엔드 종료")


# FastAPI 앱 생성
app = FastAPI(
    title="AI Image Studio",
    description="Local AI-Powered Image Generation API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS 설정 (프론트엔드만 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 정적 파일 서빙 (생성된 이미지)
images_dir = Path(settings.output_image_path)
images_dir.mkdir(parents=True, exist_ok=True)
app.mount("/images", StaticFiles(directory=str(images_dir)), name="images")

# ── 라우터 등록 ──
app.include_router(generate.router)
app.include_router(history.router)
app.include_router(process.router)
app.include_router(models.router)
app.include_router(prompt.router)


@app.get("/")
async def root():
    """헬스 체크 엔드포인트"""
    return {
        "success": True,
        "data": {
            "name": "AI Image Studio",
            "version": "0.1.0",
            "status": "running",
        },
    }


@app.get("/api/health")
async def health():
    """상세 헬스 체크 (프로세스 상태 포함)"""
    ollama_ok = await process_manager.check_ollama()
    comfyui_ok = await process_manager.check_comfyui()
    return {
        "success": True,
        "data": {
            "backend": "ok",
            "comfyui": "running" if comfyui_ok else "stopped",
            "ollama": "running" if ollama_ok else "stopped",
        },
    }
