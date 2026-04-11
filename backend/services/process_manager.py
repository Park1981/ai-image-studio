"""
ComfyUI / Ollama 프로세스 라이프사이클 관리
- Ollama: 상시 실행 (헬스체크만 수행)
- ComfyUI: 온디맨드 실행/종료 (VRAM 절약 전략)
- 자동 셧다운 타이머: 일정 시간 비활동 시 ComfyUI 종료
"""

import asyncio
import logging
import subprocess
import sys
import time
from pathlib import Path

import httpx

from config import settings

logger = logging.getLogger(__name__)

# 헬스체크 폴링 간격 (초)
_HEALTH_CHECK_INTERVAL: float = 1.0
# ComfyUI 시작 대기 최대 시간 (초)
_STARTUP_TIMEOUT: float = 120.0
# 종료 대기 최대 시간 (초)
_SHUTDOWN_TIMEOUT: float = 15.0
# HTTP 헬스체크 타임아웃 (초)
_HTTP_TIMEOUT: float = 5.0


class ProcessManager:
    """ComfyUI / Ollama 프로세스 관리자"""

    def __init__(self) -> None:
        # ComfyUI 서브프로세스 핸들
        self._comfyui_process: subprocess.Popen | None = None
        # ComfyUI 시작 시각 (업타임 계산용)
        self._comfyui_started_at: float | None = None
        # 마지막 생성 요청 시각 (자동 셧다운 판단용)
        self._last_activity: float = 0.0
        # 자동 셧다운 타이머 태스크
        self._shutdown_task: asyncio.Task | None = None

    # ─────────────────────────────────────────────
    # Ollama 헬스체크
    # ─────────────────────────────────────────────

    async def check_ollama(self) -> bool:
        """Ollama 프로세스 상태 확인 (GET /api/tags)"""
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                resp = await client.get(f"{settings.ollama_url}/api/tags")
                return resp.status_code == 200
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            logger.warning("Ollama 헬스체크 실패: %s", exc)
            return False

    # ─────────────────────────────────────────────
    # ComfyUI 헬스체크
    # ─────────────────────────────────────────────

    async def check_comfyui(self) -> bool:
        """ComfyUI 프로세스 상태 확인 (GET /)"""
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                resp = await client.get(settings.comfyui_url)
                return resp.status_code == 200
        except (httpx.HTTPError, httpx.TimeoutException):
            return False

    # ─────────────────────────────────────────────
    # ComfyUI 시작
    # ─────────────────────────────────────────────

    async def start_comfyui(self) -> bool:
        """
        ComfyUI 프로세스 시작 (subprocess, shell=False)
        - 실행 파일 경로를 설정에서 가져옴
        - 헬스체크 폴링으로 기동 완료 대기
        - 이미 실행 중이면 True 반환
        """
        # 이미 실행 중인지 확인
        if await self.check_comfyui():
            logger.info("ComfyUI 이미 실행 중")
            return True

        executable = settings.comfyui_executable
        if not executable:
            logger.error("comfyui_executable 미설정 — .env 파일 확인 필요")
            return False

        exe_path = Path(executable)
        if not exe_path.exists():
            logger.error("ComfyUI 실행 파일 없음: %s", exe_path)
            return False

        logger.info("ComfyUI 시작 중: %s", exe_path)

        try:
            # Windows: 별도 콘솔 없이 백그라운드 실행 + 출력 버퍼 차단 방지
            creation_flags = 0
            if sys.platform == "win32":
                creation_flags = (
                    subprocess.CREATE_NO_WINDOW
                    | subprocess.CREATE_NEW_PROCESS_GROUP
                )

            # shell=False 필수 (보안), DEVNULL로 출력 버퍼 막힘 방지
            self._comfyui_process = subprocess.Popen(
                [str(exe_path)],
                cwd=str(exe_path.parent),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                shell=False,  # 보안: 명시적 False
                creationflags=creation_flags,
            )
        except OSError as exc:
            logger.error("ComfyUI 프로세스 생성 실패: %s", exc)
            return False

        # 헬스체크 폴링으로 기동 완료 대기
        started = await self._wait_for_comfyui_ready()
        if started:
            self._comfyui_started_at = time.time()
            self.reset_activity_timer()
            logger.info("ComfyUI 기동 완료 (PID: %d)", self._comfyui_process.pid)
        else:
            logger.error("ComfyUI 기동 타임아웃 (%.0f초)", _STARTUP_TIMEOUT)
            await self.stop_comfyui()

        return started

    async def _wait_for_comfyui_ready(self) -> bool:
        """ComfyUI /system_stats 응답 대기 (폴링)"""
        elapsed = 0.0
        while elapsed < _STARTUP_TIMEOUT:
            try:
                async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                    resp = await client.get(
                        f"{settings.comfyui_url}/system_stats"
                    )
                    if resp.status_code == 200:
                        return True
            except (httpx.HTTPError, httpx.TimeoutException):
                pass

            await asyncio.sleep(_HEALTH_CHECK_INTERVAL)
            elapsed += _HEALTH_CHECK_INTERVAL

        return False

    # ─────────────────────────────────────────────
    # ComfyUI 종료
    # ─────────────────────────────────────────────

    async def stop_comfyui(self) -> bool:
        """
        ComfyUI 프로세스 종료
        - terminate()로 우아한 종료 시도
        - 타임아웃 후 kill()로 강제 종료
        """
        # 자동 셧다운 타이머 취소
        self._cancel_shutdown_task()

        if self._comfyui_process is None:
            logger.info("ComfyUI 프로세스 핸들 없음 — 종료 불필요")
            return True

        pid = self._comfyui_process.pid
        logger.info("ComfyUI 종료 요청 (PID: %d)", pid)

        try:
            # 우아한 종료 시도
            self._comfyui_process.terminate()

            # 종료 대기
            try:
                await asyncio.to_thread(
                    self._comfyui_process.wait, timeout=_SHUTDOWN_TIMEOUT
                )
                logger.info("ComfyUI 정상 종료 완료 (PID: %d)", pid)
            except subprocess.TimeoutExpired:
                # 타임아웃 → 강제 종료
                logger.warning(
                    "ComfyUI 정상 종료 타임아웃 — 강제 종료 (PID: %d)", pid
                )
                self._comfyui_process.kill()
                await asyncio.to_thread(self._comfyui_process.wait)

        except OSError as exc:
            logger.error("ComfyUI 종료 중 오류: %s", exc)
            return False
        finally:
            self._comfyui_process = None
            self._comfyui_started_at = None

        return True

    # ─────────────────────────────────────────────
    # ComfyUI 보장 (필요 시 시작)
    # ─────────────────────────────────────────────

    async def ensure_comfyui(self) -> bool:
        """ComfyUI 실행 보장 — 미실행 시 시작"""
        if await self.check_comfyui():
            return True
        return await self.start_comfyui()

    # ─────────────────────────────────────────────
    # 자동 셧다운 타이머
    # ─────────────────────────────────────────────

    def reset_activity_timer(self) -> None:
        """생성 요청마다 호출 — 자동 셧다운 타이머 리셋"""
        self._last_activity = time.time()

        # 기존 타이머 취소 후 새로 생성
        self._cancel_shutdown_task()

        # 이벤트 루프가 돌고 있으면 타이머 태스크 등록
        try:
            loop = asyncio.get_running_loop()
            self._shutdown_task = loop.create_task(self._auto_shutdown_worker())
        except RuntimeError:
            # 이벤트 루프 없으면 무시 (테스트 환경 등)
            pass

    async def _auto_shutdown_worker(self) -> None:
        """설정된 비활동 시간 경과 후 ComfyUI 자동 종료"""
        timeout_seconds = settings.comfyui_auto_shutdown_minutes * 60
        try:
            await asyncio.sleep(timeout_seconds)

            # 타이머 만료 후 마지막 활동 시점 재검증
            elapsed = time.time() - self._last_activity
            if elapsed >= timeout_seconds:
                logger.info(
                    "ComfyUI 비활동 %d분 경과 — 자동 종료",
                    settings.comfyui_auto_shutdown_minutes,
                )
                await self.stop_comfyui()
        except asyncio.CancelledError:
            # 타이머 리셋 시 정상 취소
            pass

    def _cancel_shutdown_task(self) -> None:
        """자동 셧다운 태스크 취소"""
        if self._shutdown_task is not None and not self._shutdown_task.done():
            self._shutdown_task.cancel()
            self._shutdown_task = None

    # ─────────────────────────────────────────────
    # Ollama 모델 목록 조회
    # ─────────────────────────────────────────────

    async def list_ollama_models(self) -> list[dict]:
        """Ollama 설치된 모델 목록 반환 (GET /api/tags)"""
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                resp = await client.get(f"{settings.ollama_url}/api/tags")
                resp.raise_for_status()
                data = resp.json()
                models = data.get("models", [])
                # 이름, 크기, 수정일 등 필요한 정보만 추출
                return [
                    {
                        "name": m.get("name", ""),
                        "size_gb": round(m.get("size", 0) / (1024**3), 1),
                        "modified_at": m.get("modified_at", ""),
                    }
                    for m in models
                    if m.get("name")
                ]
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            logger.error("Ollama 모델 목록 조회 실패: %s", exc)
            return []

    # ─────────────────────────────────────────────
    # 상태 조회 (업타임 등)
    # ─────────────────────────────────────────────

    def get_comfyui_uptime_minutes(self) -> float:
        """ComfyUI 업타임 (분)"""
        if self._comfyui_started_at is None:
            return 0.0
        return (time.time() - self._comfyui_started_at) / 60.0

    @property
    def comfyui_pid(self) -> int | None:
        """ComfyUI 프로세스 PID (미실행 시 None)"""
        if self._comfyui_process is None:
            return None
        return self._comfyui_process.pid


# 싱글톤 인스턴스
process_manager = ProcessManager()
