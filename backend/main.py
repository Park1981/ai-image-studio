"""
AI Image Studio - FastAPI 백엔드 엔트리포인트
lifespan 이벤트로 ComfyUI/Ollama 프로세스 관리
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from database import init_db
from services.process_manager import process_manager
from studio.router import (
    router as studio_router,
    start_cleanup_loop as start_studio_cleanup_loop,
    stop_cleanup_loop as stop_studio_cleanup_loop,
)
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


def _silence_proactor_reset(loop: asyncio.AbstractEventLoop) -> None:
    """Windows ProactorEventLoop 의 소켓 teardown 시 발생하는
    ConnectionResetError/ConnectionAbortedError 트레이스백을 조용히 처리.

    응답은 이미 완료된 상태에서 proactor 가 소켓을 뒤늦게 닫으며 발생 — 무해함.
    httpx/websockets 레벨에서 잡기 어려워서 loop exception handler 로 일괄 차단.
    (Python issue 39010 · Windows-only 주기적 발생)
    """
    default_handler = loop.get_exception_handler()

    def _handler(inner_loop: asyncio.AbstractEventLoop, context: dict) -> None:
        exc = context.get("exception")
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError)):
            logger.debug("proactor 소켓 reset 무시: %s", exc)
            return
        if default_handler is None:
            inner_loop.default_exception_handler(context)
        else:
            default_handler(inner_loop, context)

    loop.set_exception_handler(_handler)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작/종료 시 리소스 관리"""
    # ── 시작 ──
    _silence_proactor_reset(asyncio.get_running_loop())
    settings.ensure_data_dirs()
    await init_db()
    # 재설계 studio_history 테이블 (같은 DB 파일, 별도 테이블)
    await init_studio_history_db()

    # ComfyUI 자동 시작 (background task — lifespan 차단 방지)
    # 2026-04-25: Headless Python 모드에서 첫 부팅이 길어지면 lifespan await 가
    # backend listen 시작을 막아 health check 가 timeout 났음. 이제는 fire-and-forget
    # 으로 즉시 listen 시작 + ComfyUI 부팅은 별도 task. 동시 호출은 process_manager
    # 의 _comfyui_lifecycle_lock 으로 자연 직렬화됨.
    comfyui_ok = await process_manager.check_comfyui()
    if not comfyui_ok:
        logger.info("ComfyUI 백그라운드 시작 (backend 는 즉시 listen)...")
        # 결과 무시 — 실패해도 backend 자체는 정상. 사용자 generate 시점에 재확인됨.
        asyncio.create_task(process_manager.start_comfyui())

    # Ollama 상태 확인 (온디맨드 — AI 보강 시 자동 시작됨)
    ollama_ok = await process_manager.check_ollama()

    logger.info("🚀 AI Image Studio 백엔드 시작")
    logger.info("   ComfyUI: %s (%s)", settings.comfyui_url, "✅ 실행 중" if comfyui_ok else "❌ 시작 실패")
    logger.info("   Ollama:  %s (%s) — 온디맨드 (AI 보강 시 자동)", settings.ollama_url, "✅ 대기 중" if ollama_ok else "⏸️ 미실행")
    logger.info("   유휴 자동 종료: %d분", settings.comfyui_auto_shutdown_minutes)

    # 유휴 자동 종료 백그라운드 태스크 시작
    idle_task = asyncio.create_task(_idle_shutdown_loop())
    # studio SSE task 주기적 stale cleanup 시작
    start_studio_cleanup_loop()

    yield

    # 유휴 체크 태스크 취소
    idle_task.cancel()
    try:
        await idle_task
    except asyncio.CancelledError:
        pass
    # studio cleanup loop 종료
    await stop_studio_cleanup_loop()

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


# StaticFiles mount 응답에 CORS 헤더 직접 주입
# 이유: CORSMiddleware는 FastAPI 라우터에는 자동 반응하지만,
#       app.mount() 로 얹은 StaticFiles sub-ASGI 응답에는 헤더가 확실히 안 붙는 경우가 있어
#       브라우저 fetch() 가 "No 'Access-Control-Allow-Origin' header" 로 차단됨.
#       history 이미지 → Edit 모드 전송 (urlToDataUrl) 시 재현됨.
@app.middleware("http")
async def ensure_cors_for_static_images(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/images/"):
        origin = request.headers.get("origin")
        if origin and origin in settings.frontend_origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Vary"] = "Origin"
    return response


# 정적 파일 서빙 (생성된 이미지)
images_dir = Path(settings.output_image_path)
images_dir.mkdir(parents=True, exist_ok=True)
app.mount("/images", StaticFiles(directory=str(images_dir)), name="images")

# ── 라우터 등록 ──
# task #18 (2026-04-26): 옛 routers/* 5개 (/api/{generate,history,models,process,prompt})
# 는 backend/legacy/routers/ 로 quarantine — frontend/legacy 만 호출하던 dead path.
# 신규 frontend 는 모두 /api/studio/* 사용. 옛 라우터를 살리려면 backend/legacy/
# 에서 import 후 include_router 추가하면 됨 (코드 본체는 보존됨).
app.include_router(studio_router)


# ─────────────────────────────────────────────
# 전역 예외 핸들러 — 2026-04-24
# 목적:
#  1) 어떤 엔드포인트에서 예기치 못한 예외가 나도 FastAPI 기본 HTML
#     "Internal Server Error" 대신 JSON 응답 + 경로/클래스 명시
#  2) 콘솔에 전체 traceback 덤프 → 다음 500 발생 시 원인 즉시 파악
#  3) HTTPException (404, 413 등 명시 에러) 은 기본 핸들러 유지
# ─────────────────────────────────────────────


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    # HTTPException 은 FastAPI 기본 핸들러가 이미 처리 — 여기엔 안 옴.
    # 순수 Python Exception 만 진입.
    logger.exception(
        "🔥 Unhandled %s at %s %s",
        type(exc).__name__,
        request.method,
        request.url.path,
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "서버 내부 오류 · 백엔드 콘솔 로그 확인",
            "error": type(exc).__name__,
            "path": request.url.path,
        },
    )


# HTTPException 은 명시적이므로 그대로 유지 (404, 413 등)
# 단, 로깅만 찍어 디버깅 도움
@app.exception_handler(HTTPException)
async def _http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code >= 500:
        logger.warning(
            "HTTP %d at %s %s: %s",
            exc.status_code,
            request.method,
            request.url.path,
            exc.detail,
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


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
