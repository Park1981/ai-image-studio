"""
AI Image Studio - FastAPI 백엔드 엔트리포인트
lifespan 이벤트로 ComfyUI/Ollama 프로세스 관리
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작/종료 시 리소스 관리"""
    # ── 시작 ──
    settings.ensure_data_dirs()
    # TODO Phase 1: Ollama 상태 확인 + ComfyUI Process Manager 초기화
    print("🚀 AI Image Studio 백엔드 시작")
    print(f"   ComfyUI: {settings.comfyui_url}")
    print(f"   Ollama: {settings.ollama_url} ({settings.ollama_model})")

    yield

    # ── 종료 ──
    # TODO Phase 1: ComfyUI 프로세스 graceful shutdown
    print("👋 AI Image Studio 백엔드 종료")


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


# ── 라우터 등록 (Phase별 추가) ──
# Phase 1: generate, process
# Phase 2: prompt, models
# Phase 3: history


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
    # TODO Phase 1: 실제 프로세스 상태 확인
    return {
        "success": True,
        "data": {
            "backend": "ok",
            "comfyui": "unchecked",
            "ollama": "unchecked",
        },
    }
