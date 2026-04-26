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
        # ComfyUI stdout/stderr 로 사용한 파일 핸들 — 종료 시 close 필요
        self._comfyui_log_handles: tuple | None = None
        # Ollama 서브프로세스 핸들 (수동 시작 시만 보관)
        self._ollama_process: subprocess.Popen | None = None

    @property
    def comfyui_pid(self) -> int | None:
        """우리가 띄운 ComfyUI subprocess PID — 외부 기동 시 None.

        헤더 VRAM breakdown UI 가 nvidia-smi compute-apps 와 매칭하는 데 사용.
        """
        proc = self._comfyui_process
        if proc is None or proc.poll() is not None:
            return None
        return proc.pid

    def _close_comfyui_log_handles(self) -> None:
        """ComfyUI subprocess 가 사용한 stdout/stderr 파일 핸들 close."""
        if self._comfyui_log_handles is None:
            return
        for h in self._comfyui_log_handles:
            try:
                h.close()
            except OSError:
                pass
        self._comfyui_log_handles = None

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

    def _resolve_comfyui_launch_args(
        self,
    ) -> tuple[list[str] | None, str | None, str]:
        """
        실행 모드 결정 + Popen 인자 생성.

        반환: (popen_args, popen_cwd, mode_label)
          - 실패 시 (None, None, "")
          - mode_label: "Headless Python" | "Electron GUI"

        분기 규칙:
          1) python + main_py + extra_paths_config 셋 모두 비어있지 않고 파일 존재
             → Headless Python 모드
          2) 그 외 → Electron executable 폴백
        """
        # ── 1순위: Headless Python 모드 (3 키 다 있음) ──
        py = settings.comfyui_python.strip()
        main_py = settings.comfyui_main_py.strip()
        extra_cfg = settings.comfyui_extra_paths_config.strip()

        if py and main_py and extra_cfg:
            py_path = Path(py)
            main_path = Path(main_py)
            cfg_path = Path(extra_cfg)
            missing: list[str] = []
            if not py_path.exists():
                missing.append(f"python={py_path}")
            if not main_path.exists():
                missing.append(f"main_py={main_path}")
            if not cfg_path.exists():
                missing.append(f"extra_cfg={cfg_path}")

            if missing:
                logger.warning(
                    "Headless Python 모드 경로 검증 실패 → Electron 폴백: %s",
                    ", ".join(missing),
                )
            else:
                # 포트는 comfyui_url 에서 추출 (기본 8000)
                port = self._extract_port_from_url(settings.comfyui_url, default=8000)
                args = [
                    str(py_path),
                    str(main_path),
                    "--listen", "127.0.0.1",
                    "--port", str(port),
                    "--extra-model-paths-config", str(cfg_path),
                    "--disable-auto-launch",
                ]
                # --base-directory: 표준 ComfyUI 모델 폴더 자동 인식
                # (Desktop yaml 은 desktop_extensions custom_nodes 만 정의해서 모델 누락됨)
                base_dir = settings.comfyui_base_dir.strip()
                if base_dir and Path(base_dir).exists():
                    args.extend(["--base-directory", str(Path(base_dir))])
                return args, str(main_path.parent), "Headless Python"

        # ── 2순위: Electron 폴백 ──
        executable = settings.comfyui_executable.strip()
        if not executable:
            logger.error(
                "ComfyUI 실행 경로 미설정 — "
                "(headless) COMFYUI_PYTHON+COMFYUI_MAIN_PY+COMFYUI_EXTRA_PATHS_CONFIG 또는 "
                "(electron) COMFYUI_EXECUTABLE 중 하나는 .env 에 설정 필요",
            )
            return None, None, ""

        exe_path = Path(executable)
        if not exe_path.exists():
            logger.error("ComfyUI 실행 파일 없음: %s", exe_path)
            return None, None, ""

        return [str(exe_path)], str(exe_path.parent), "Electron GUI"

    @staticmethod
    def _extract_port_from_url(url: str, *, default: int) -> int:
        """URL 에서 포트 추출 (실패 시 default 반환)"""
        try:
            from urllib.parse import urlparse

            parsed = urlparse(url)
            return parsed.port or default
        except (ValueError, AttributeError):
            return default

    async def start_comfyui(self) -> bool:
        """
        ComfyUI 프로세스 시작 (subprocess, shell=False)
        - 우선 모드 (Headless · 권장): COMFYUI_PYTHON + COMFYUI_MAIN_PY +
          COMFYUI_EXTRA_PATHS_CONFIG 3 키 모두 설정 시 Python 직접 호출
          → Electron GUI 창 안 뜸
        - 폴백 모드 (Backward-compat): 위 3 키 중 하나라도 비면
          COMFYUI_EXECUTABLE (Electron) 으로 실행 → GUI 창 뜸
        - 헬스체크 폴링으로 기동 완료 대기 / 이미 실행 중이면 True 반환
        - asyncio.Lock 으로 동시 기동 경쟁 방지 (double-check 패턴)
        """
        # 락 내부에서 재확인하는 double-check 패턴 (GPU 프로세스 중복 실행 방지)
        async with self._comfyui_lifecycle_lock:
            # 락 획득 후 재확인 (다른 태스크가 이미 기동했을 수 있음)
            if await self.check_comfyui():
                logger.info("ComfyUI 이미 실행 중")
                return True

            # ── 모드 분기: Headless (Python 직접) vs Electron (GUI) ──
            popen_args, popen_cwd, mode_label = self._resolve_comfyui_launch_args()
            if popen_args is None:
                # _resolve_comfyui_launch_args 가 이미 logger.error 출력함
                return False

            logger.info("ComfyUI 시작 중 (%s): %s", mode_label, popen_args[0])

            try:
                # Windows: 별도 콘솔 없이 백그라운드 실행 + 출력 버퍼 차단 방지
                creation_flags = 0
                if sys.platform == "win32":
                    creation_flags = (
                        subprocess.CREATE_NO_WINDOW
                        | subprocess.CREATE_NEW_PROCESS_GROUP
                    )

                # 2026-04-25: stdout/stderr 를 파일로 redirect (이전 DEVNULL 시 ComfyUI
                # 가 즉시 종료되는 케이스 발생 — 일부 native lib 가 DEVNULL stdout 에서
                # write 실패로 죽었을 가능성). 동시에 디버깅 가능 (logs/comfyui.log).
                # 로그 파일은 매 기동 시 덮어쓰기 (overwrite, append X — 누적 방지).
                logs_dir = (Path(__file__).resolve().parents[2] / "logs")
                logs_dir.mkdir(parents=True, exist_ok=True)
                comfy_log = logs_dir / "comfyui.log"
                comfy_err = logs_dir / "comfyui.err.log"
                self._comfyui_log_handles = (
                    comfy_log.open("w", encoding="utf-8", errors="replace"),
                    comfy_err.open("w", encoding="utf-8", errors="replace"),
                )

                # shell=False 필수 (보안)
                self._comfyui_process = subprocess.Popen(
                    popen_args,
                    cwd=popen_cwd,
                    stdout=self._comfyui_log_handles[0],
                    stderr=self._comfyui_log_handles[1],
                    stdin=subprocess.DEVNULL,
                    shell=False,
                    creationflags=creation_flags,
                )
            except OSError as exc:
                logger.error("ComfyUI 프로세스 생성 실패: %s", exc)
                self._close_comfyui_log_handles()
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
            self._close_comfyui_log_handles()

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
                self._close_comfyui_log_handles()

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
