"""
ComfyUI / Ollama 프로세스 라이프사이클 관리
- ComfyUI: 앱 시작/종료와 함께 동작 (상시 실행)
- Ollama: AI 보강 시만 온디맨드 호출 (VRAM 즉시 반납)
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
        # 마지막 이미지 생성 완료 시각 (유휴 자동 종료용)
        self._last_generation_at: float | None = None
        # ComfyUI start/stop 경로 직렬화 락 (동시 기동 경쟁 방지)
        self._comfyui_lifecycle_lock = asyncio.Lock()
        # Ollama 서브프로세스 핸들 (수동 시작 시만 보관)
        self._ollama_process: subprocess.Popen | None = None

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
        - asyncio.Lock으로 동시 기동 경쟁 방지 (double-check 패턴)
        """
        # 락 내부에서 재확인하는 double-check 패턴 (GPU 프로세스 중복 실행 방지)
        async with self._comfyui_lifecycle_lock:
            # 락 획득 후 재확인 (다른 태스크가 이미 기동했을 수 있음)
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
                logger.info("ComfyUI 기동 완료 (PID: %d)", self._comfyui_process.pid)
            else:
                logger.error("ComfyUI 기동 타임아웃 (%.0f초)", _STARTUP_TIMEOUT)
                # 락 내부에서 stop_comfyui 호출하면 재진입 데드락 → 직접 정리
                self._force_cleanup_comfyui()

            return started

    def _force_cleanup_comfyui(self) -> None:
        """락 내부용 강제 정리 — stop_comfyui의 락 재획득을 피하기 위해 분리"""
        if self._comfyui_process is None:
            return
        pid = self._comfyui_process.pid
        try:
            self._comfyui_process.kill()
            self._comfyui_process.wait(timeout=_SHUTDOWN_TIMEOUT)
            logger.info("ComfyUI 강제 정리 완료 (PID: %d)", pid)
        except (OSError, subprocess.TimeoutExpired) as exc:
            logger.error("ComfyUI 강제 정리 오류 (PID: %d): %s", pid, exc)
        finally:
            self._comfyui_process = None
            self._comfyui_started_at = None

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
        ComfyUI 프로세스 종료 — start_comfyui와 같은 락 사용 (동시 start/stop 직렬화)
        - terminate()로 우아한 종료 시도
        - 타임아웃 후 kill()로 강제 종료
        """
        async with self._comfyui_lifecycle_lock:
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
    # Ollama 시작 / 종료 (ComfyUI 패턴 동일)
    # ─────────────────────────────────────────────

    async def start_ollama(self) -> bool:
        """
        Ollama 프로세스 시작 (subprocess, shell=False, `ollama serve`)
        - 실행 파일 경로는 .env의 OLLAMA_EXECUTABLE 사용
        - 이미 실행 중이면 True 반환
        """
        if await self.check_ollama():
            logger.info("Ollama 이미 실행 중")
            return True

        executable = settings.ollama_executable
        if not executable:
            logger.error("ollama_executable 미설정 — .env 파일 확인 필요")
            return False

        exe_path = Path(executable)
        if not exe_path.exists():
            logger.error("Ollama 실행 파일 없음: %s", exe_path)
            return False

        logger.info("Ollama 시작 중: %s serve", exe_path)

        try:
            creation_flags = 0
            if sys.platform == "win32":
                creation_flags = (
                    subprocess.CREATE_NO_WINDOW
                    | subprocess.CREATE_NEW_PROCESS_GROUP
                )

            # `ollama serve` 로 백그라운드 실행 (보안: shell=False)
            self._ollama_process = subprocess.Popen(
                [str(exe_path), "serve"],
                cwd=str(exe_path.parent),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                shell=False,
                creationflags=creation_flags,
            )
        except OSError as exc:
            logger.error("Ollama 프로세스 생성 실패: %s", exc)
            return False

        started = await self._wait_for_ollama_ready()
        if started:
            logger.info("Ollama 기동 완료 (PID: %d)", self._ollama_process.pid)
        else:
            logger.error("Ollama 기동 타임아웃 (%.0f초)", _STARTUP_TIMEOUT)
            await self.stop_ollama()

        return started

    async def _wait_for_ollama_ready(self) -> bool:
        """Ollama /api/tags 응답 대기 (폴링)"""
        elapsed = 0.0
        while elapsed < _STARTUP_TIMEOUT:
            if await self.check_ollama():
                return True
            await asyncio.sleep(_HEALTH_CHECK_INTERVAL)
            elapsed += _HEALTH_CHECK_INTERVAL
        return False

    async def stop_ollama(self) -> bool:
        """
        Ollama 프로세스 종료
        - 우리가 시작한 프로세스만 종료 (외부에서 시작한 건 건드리지 않음)
        """
        if self._ollama_process is None:
            logger.info("Ollama 프로세스 핸들 없음 — 백엔드가 시작한 적 없음")
            return True

        pid = self._ollama_process.pid
        logger.info("Ollama 종료 요청 (PID: %d)", pid)

        try:
            self._ollama_process.terminate()
            try:
                await asyncio.to_thread(
                    self._ollama_process.wait, timeout=_SHUTDOWN_TIMEOUT
                )
                logger.info("Ollama 정상 종료 완료 (PID: %d)", pid)
            except subprocess.TimeoutExpired:
                logger.warning(
                    "Ollama 정상 종료 타임아웃 — 강제 종료 (PID: %d)", pid
                )
                self._ollama_process.kill()
                await asyncio.to_thread(self._ollama_process.wait)
        except OSError as exc:
            logger.error("Ollama 종료 중 오류: %s", exc)
            return False
        finally:
            self._ollama_process = None

        return True

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
    # VRAM 사용량 조회 (nvidia-smi)
    # ─────────────────────────────────────────────

    async def get_vram_usage(self) -> dict:
        """
        nvidia-smi로 GPU VRAM 사용량 조회 (async — 이벤트 루프 블로킹 방지).
        반환: {"used_gb": float, "total_gb": float}
        nvidia-smi 없거나 실패 시 기본값 반환.
        """
        try:
            # subprocess.run은 동기 호출 (최대 5초) — asyncio.to_thread로 async 컨텍스트에서 비차단
            result = await asyncio.to_thread(
                subprocess.run,
                [
                    "nvidia-smi",
                    "--query-gpu=memory.used,memory.total",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                text=True,
                timeout=5,
                shell=False,  # 보안: 명시적 False
            )
            if result.returncode == 0 and result.stdout.strip():
                # "4567, 16384" 형태 파싱 (MiB 단위)
                line = result.stdout.strip().split("\n")[0]
                parts = line.split(",")
                used_mib = float(parts[0].strip())
                total_mib = float(parts[1].strip())
                return {
                    "used_gb": round(used_mib / 1024, 1),
                    "total_gb": round(total_mib / 1024, 1),
                }
        except FileNotFoundError:
            logger.debug("nvidia-smi 미발견 — VRAM 모니터링 불가")
        except subprocess.TimeoutExpired:
            logger.warning("nvidia-smi 타임아웃 (5초)")
        except (ValueError, IndexError, OSError) as exc:
            logger.warning("nvidia-smi 파싱 실패: %s", exc)

        # 실패 시 기본값 반환
        return {"used_gb": 0, "total_gb": settings.vram_total_gb}

    # ─────────────────────────────────────────────
    # 유휴 자동 종료
    # ─────────────────────────────────────────────

    def mark_generation_complete(self) -> None:
        """이미지 생성 완료 시 시각 기록 (유휴 타이머 시작)"""
        self._last_generation_at = time.time()
        logger.info("생성 완료 시각 기록 — 유휴 타이머 시작")

    async def check_idle_shutdown(self) -> bool:
        """
        유휴 자동 종료 체크.
        마지막 생성 후 설정 시간 경과 시 ComfyUI 종료.
        반환: True면 종료 실행됨.
        """
        if self._last_generation_at is None:
            return False

        idle_seconds = time.time() - self._last_generation_at
        threshold = settings.comfyui_auto_shutdown_minutes * 60

        if idle_seconds > threshold:
            # ComfyUI가 실행 중인지 먼저 확인
            if await self.check_comfyui():
                logger.info(
                    "ComfyUI 유휴 자동 종료: %.1f분 유휴 (임계값 %d분)",
                    idle_seconds / 60,
                    settings.comfyui_auto_shutdown_minutes,
                )
                await self.stop_comfyui()
                self._last_generation_at = None  # 타이머 리셋
                return True
            else:
                # 이미 종료되어 있으면 타이머만 리셋
                self._last_generation_at = None
        return False

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
