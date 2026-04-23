"""
AI Image Studio - FastAPI 백엔드 엔트리포인트
lifespan 이벤트로 ComfyUI/Ollama 프로세스 관리
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import settings
from database import init_db
from routers import generate, history, models, process, prompt
from services.process_manager import process_manager
from studio.router import router as studio_router
from studio.history_db import init_studio_history_db

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


async def _idle_shutdown_loop() -> None:
    """60초 간격으로 ComfyUI 유휴 자동 종료 체크"""
    while True:
        try:
            await asyncio.sleep(60)
            await process_manager.check_idle_shutdown()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("유휴 종료 체크 오류: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작/종료 시 리소스 관리"""
    # ── 시작 ──
    settings.ensure_data_dirs()
    await init_db()
    # 재설계 studio_history 테이블 (같은 DB 파일, 별도 테이블)
    await init_studio_history_db()

    # ComfyUI 자동 시작 (앱과 함께 실행)
    comfyui_ok = await process_manager.check_comfyui()
    if not comfyui_ok:
        logger.info("ComfyUI 자동 시작 중...")
        comfyui_ok = await process_manager.start_comfyui()

    # Ollama 상태 확인 (온디맨드 — AI 보강 시 자동 시작됨)
    ollama_ok = await process_manager.check_ollama()

    logger.info("🚀 AI Image Studio 백엔드 시작")
    logger.info("   ComfyUI: %s (%s)", settings.comfyui_url, "✅ 실행 중" if comfyui_ok else "❌ 시작 실패")
    logger.info("   Ollama:  %s (%s) — 온디맨드 (AI 보강 시 자동)", settings.ollama_url, "✅ 대기 중" if ollama_ok else "⏸️ 미실행")
    logger.info("   유휴 자동 종료: %d분", settings.comfyui_auto_shutdown_minutes)

    # 유휴 자동 종료 백그라운드 태스크 시작
    idle_task = asyncio.create_task(_idle_shutdown_loop())

    yield

    # 유휴 체크 태스크 취소
    idle_task.cancel()
    try:
        await idle_task
    except asyncio.CancelledError:
        pass

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

# CORS 설정 (프론트엔드만 허용 — 여러 개발 포트 동시 지원)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# StaticFiles mount 는 Starlette 의 sub-app 이라 CORSMiddleware 가 자동 적용 안 됨.
# (특히 fetch() 로 이미지 다운로드 시 CORS 차단) — /images 응답에 수동으로 CORS 헤더 주입.
@app.middleware("http")
async def ensure_cors_for_static_images(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/images"):
        origin = request.headers.get("origin")
        allowed = set(settings.frontend_origins)
        if origin and origin in allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Credentials"] = "true"
    return response


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

# 재설계 (/api/studio/*) — Phase 2 신규 라우터. 기존 라우터와 병행.
app.include_router(studio_router)


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
