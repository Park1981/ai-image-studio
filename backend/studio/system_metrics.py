"""
시스템 자원 사용률 통합 측정 — CPU / RAM / GPU% / VRAM.

psutil (CPU·RAM) + nvidia-smi (GPU·VRAM) 두 소스를 한 번에 묶어
프론트 헤더의 SystemMetrics 4-bar UI 에 공급한다.

설계 원칙
- 모두 비차단 (asyncio.to_thread) — process/status 폴링 5초 주기 보호
- 실패 시 부분값만 채워 반환 (전부 다 비어도 응답은 200 유지)
- nvidia-smi 미설치 / psutil 실패 별개 처리

2026-04-26 신설 — 헤더 통합 SystemMetrics 도입.
"""

from __future__ import annotations

import asyncio
import logging
import subprocess
from typing import Any, TypedDict

import httpx
import psutil

from . import dispatch_state

# config.py 는 backend 가 sys.path 에 있을 때 top-level 모듈로 노출됨
# (uvicorn main:app 진입 + tests/conftest.py 가 backend 추가). 패턴 기존 모듈과 통일.
try:
    from config import settings  # type: ignore
except ImportError:
    from backend.config import settings  # type: ignore

logger = logging.getLogger(__name__)


class SystemMetrics(TypedDict, total=False):
    """모든 필드 옵셔널 — 측정 실패 시 누락 가능."""

    cpu_percent: float
    ram_used_gb: float
    ram_total_gb: float
    gpu_percent: float
    vram_used_gb: float
    vram_total_gb: float


# nvidia-smi 타임아웃 (초) — 폴링 5s 주기보다 충분히 짧게
_NVIDIA_SMI_TIMEOUT = 3.0
# psutil cpu_percent interval — 너무 짧으면 0 만 나오고 너무 길면 응답 느림
_CPU_INTERVAL = 0.1
# Ollama /api/ps 호출 타임아웃 — 짧게 잡아 process/status 폴링 차단 방지
_OLLAMA_PS_TIMEOUT = 1.5


def _measure_cpu_ram() -> dict:
    """psutil CPU + RAM 측정 (sync). asyncio.to_thread 로 감싸 호출."""
    try:
        # cpu_percent 첫 호출은 baseline 잡기용 0 반환 가능 — interval 줘서 측정값 보장
        cpu = psutil.cpu_percent(interval=_CPU_INTERVAL)
        vm = psutil.virtual_memory()
        return {
            "cpu_percent": round(cpu, 1),
            "ram_used_gb": round(vm.used / (1024**3), 1),
            "ram_total_gb": round(vm.total / (1024**3), 1),
        }
    except Exception as exc:  # pragma: no cover — psutil 자체 에러는 매우 드묾
        logger.warning("psutil 측정 실패: %s", exc)
        return {}


def _measure_gpu_vram() -> dict:
    """nvidia-smi 한 번에 VRAM used/total + GPU% 동시 조회 (sync)."""
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=memory.used,memory.total,utilization.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=_NVIDIA_SMI_TIMEOUT,
            shell=False,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return {}
        # "11400, 16384, 75" 형태 파싱
        line = result.stdout.strip().split("\n")[0]
        parts = [p.strip() for p in line.split(",")]
        used_mib = float(parts[0])
        total_mib = float(parts[1])
        gpu_util = float(parts[2])
        return {
            "vram_used_gb": round(used_mib / 1024, 1),
            "vram_total_gb": round(total_mib / 1024, 1),
            "gpu_percent": round(gpu_util, 1),
        }
    except FileNotFoundError:
        # nvidia-smi 미설치 환경 (개발 PC 등) — 한 번만 디버그 로그
        logger.debug("nvidia-smi 미발견 — GPU 메트릭 비활성")
        return {}
    except subprocess.TimeoutExpired:
        logger.warning("nvidia-smi 타임아웃 (%.1fs)", _NVIDIA_SMI_TIMEOUT)
        return {}
    except (ValueError, IndexError, OSError) as exc:
        logger.warning("nvidia-smi 파싱 실패: %s", exc)
        return {}


async def get_system_metrics() -> SystemMetrics:
    """CPU/RAM/GPU%/VRAM 동시 측정 — 두 소스 병렬 실행으로 응답 시간 단축."""
    cpu_ram, gpu_vram = await asyncio.gather(
        asyncio.to_thread(_measure_cpu_ram),
        asyncio.to_thread(_measure_gpu_vram),
    )
    # SystemMetrics dict 병합 — 한쪽 실패해도 다른 쪽은 살림
    return {**cpu_ram, **gpu_vram}  # type: ignore[return-value]


# ─────────────────────────────────────────────────────────────────────
# VRAM Breakdown — 프로세스별 분류 + 로드 모델 정보 (헤더 임계 오버레이)
# ─────────────────────────────────────────────────────────────────────

# nvidia-smi compute-apps 의 process_name 키워드 매칭
#   - Ollama: ollama.exe / ollama_llama_server.exe 등 "ollama" 포함
#   - ComfyUI: python.exe (Headless 모드 venv python) 또는 ComfyUI*.exe (Electron)
_OLLAMA_NAME_HINTS = ("ollama",)
_COMFYUI_NAME_HINTS = ("python", "comfyui")


def _query_compute_apps() -> list[dict[str, Any]]:
    """nvidia-smi --query-compute-apps 로 GPU 사용 프로세스 목록 조회.

    반환: [{"pid": int, "process_name": str, "vram_mib": float}, ...]
    실패 시 빈 리스트 (graceful).
    """
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-compute-apps=pid,process_name,used_memory",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=_NVIDIA_SMI_TIMEOUT,
            shell=False,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return []
        apps: list[dict[str, Any]] = []
        for raw in result.stdout.strip().splitlines():
            parts = [p.strip() for p in raw.split(",")]
            if len(parts) < 3:
                continue
            try:
                pid = int(parts[0])
                vram_mib = float(parts[2])
            except ValueError:
                continue
            apps.append(
                {
                    "pid": pid,
                    "process_name": parts[1],
                    "vram_mib": vram_mib,
                }
            )
        return apps
    except FileNotFoundError:
        # nvidia-smi 미설치 (개발 PC) — 디버그만, 일반 흐름
        logger.debug("nvidia-smi 미발견 — VRAM breakdown 비활성")
        return []
    except subprocess.TimeoutExpired:
        logger.warning("nvidia-smi compute-apps 타임아웃")
        return []
    except OSError as exc:
        logger.warning("nvidia-smi compute-apps 실패: %s", exc)
        return []


async def _query_ollama_ps() -> list[dict[str, Any]]:
    """Ollama /api/ps 호출 — 현재 로드된 모델 + size_vram + expires_at.

    keep_alive=0 정책에선 보통 빈 리스트지만, 호출 직후 ~5s 동안은 떠 있음.
    """
    url = f"{settings.ollama_url}/api/ps"
    try:
        async with httpx.AsyncClient(timeout=_OLLAMA_PS_TIMEOUT) as client:
            res = await client.get(url)
            if res.status_code != 200:
                return []
            data = res.json()
            return list(data.get("models") or [])
    except (httpx.HTTPError, OSError, ValueError) as exc:
        # Ollama 미실행이면 ConnectError — 흔한 케이스라 debug
        logger.debug("Ollama /api/ps 호출 실패: %s", exc)
        return []


def _expires_in_sec(expires_at: str | None) -> int | None:
    """ISO 8601 expires_at → 남은 초 (음수면 None). Ollama 응답은 보통 RFC3339."""
    if not expires_at:
        return None
    try:
        from datetime import datetime, timezone

        # "2026-04-26T05:32:11.123456789Z" 또는 "...+00:00" 형태 모두 대응
        s = expires_at.rstrip("Z")
        # 나노초 부분 잘라내기 (Python datetime 은 마이크로초까지만)
        if "." in s:
            head, frac = s.split(".", 1)
            # 타임존 분리
            tz_idx = max(frac.rfind("+"), frac.rfind("-"))
            tz_part = frac[tz_idx:] if tz_idx > 0 else ""
            digits = frac[:tz_idx] if tz_idx > 0 else frac
            digits = digits[:6]  # 마이크로초까지만
            s = f"{head}.{digits}{tz_part}"
        if "+" not in s and "-" not in s[10:]:
            s = s + "+00:00"  # naive → UTC 가정
        dt = datetime.fromisoformat(s)
        now = datetime.now(timezone.utc)
        delta = (dt - now).total_seconds()
        return max(0, int(delta)) if delta > 0 else None
    except (ValueError, TypeError):
        return None


async def get_vram_breakdown(
    *,
    comfyui_pid: int | None = None,
    total_used_gb: float | None = None,
) -> dict[str, Any]:
    """프로세스별 VRAM 분류 + 로드 모델 정보 — 헤더 80% 임계 오버레이용.

    Args:
        comfyui_pid: process_manager 가 띄운 ComfyUI 의 정확한 PID (optional).
                     None 이면 process_name 휴리스틱 (python.exe / ComfyUI*) 으로 분류.
        total_used_gb: nvidia-smi 의 총 VRAM 사용량 (이미 측정한 값 재사용).
                       compute-apps 가 ComfyUI 못 잡을 때 폴백 계산에 사용.

    반환 구조:
      {
        "comfyui": {"vram_gb": 9.2, "models": ["qwen_image_2512"], "last_mode": "generate"},
        "ollama":  {"vram_gb": 5.1, "models": [{"name": "...", "size_vram_gb": 5.1, "expires_in_sec": 240}]},
        "other_gb": 0.4
      }
    실패 graceful — 측정 불가 시 모든 값 0/빈 리스트.

    2026-04-26 폴백 추가: Windows Headless 환경 등에서 nvidia-smi --query-compute-apps
    가 ComfyUI 프로세스를 못 잡는 케이스 발견. total_used_gb 와 분류 합계의 차이를
    ComfyUI 로 추정 (가장 큰 점유는 거의 항상 ComfyUI 라는 휴리스틱).
    """
    # 두 소스 병렬: nvidia-smi compute-apps + Ollama /api/ps
    apps_task = asyncio.to_thread(_query_compute_apps)
    ps_task = _query_ollama_ps()
    apps, ollama_models_raw = await asyncio.gather(apps_task, ps_task)

    # 프로세스별 VRAM 분류 (MiB → GB)
    comfyui_mib = 0.0
    ollama_mib = 0.0
    other_mib = 0.0
    for app in apps:
        pid = app["pid"]
        name_lower = str(app["process_name"]).lower()
        vram = app["vram_mib"]
        if comfyui_pid is not None and pid == comfyui_pid:
            comfyui_mib += vram
        elif any(hint in name_lower for hint in _OLLAMA_NAME_HINTS):
            ollama_mib += vram
        elif any(hint in name_lower for hint in _COMFYUI_NAME_HINTS):
            # 정확한 ComfyUI pid 모를 때 휴리스틱
            comfyui_mib += vram
        else:
            other_mib += vram

    # Ollama 로드 모델 — name / size_vram / expires_at 정리 (먼저 빌드, 폴백 계산에 사용)
    ollama_models: list[dict[str, Any]] = []
    for m in ollama_models_raw:
        try:
            size_vram_bytes = float(m.get("size_vram") or 0)
        except (TypeError, ValueError):
            size_vram_bytes = 0.0
        ollama_models.append(
            {
                "name": str(m.get("name") or m.get("model") or "(unknown)"),
                "size_vram_gb": round(size_vram_bytes / (1024**3), 1),
                "expires_in_sec": _expires_in_sec(m.get("expires_at")),
            }
        )

    # Ollama 실 점유량 — nvidia-smi compute-apps 매칭값과 Ollama API /api/ps 보고합계 중 큰 값.
    # 두 측정은 같은 점유를 다른 소스로 보는 거라 max 가 정확 (중복 합산 회피).
    # Windows 권한 정책으로 nvidia-smi used_memory 가 [N/A] 면 ollama_mib=0 이지만
    # /api/ps 의 size_vram 은 Ollama 자체 보고라 실 점유에 가까움.
    ollama_api_gb = sum(float(m.get("size_vram_gb") or 0) for m in ollama_models)
    ollama_nvidia_gb = ollama_mib / 1024
    ollama_total_gb = max(ollama_nvidia_gb, ollama_api_gb)

    # 폴백: nvidia-smi compute-apps 가 ComfyUI 못 잡았을 때 — total - (ollama + other) 차이를 할당.
    # ollama_total_gb 사용 (API 보고 포함) — Ollama 동시 점유 swap 케이스 정확히 분리.
    if comfyui_mib == 0.0 and total_used_gb is not None and total_used_gb > 0:
        other_gb_calc = other_mib / 1024
        accounted_gb = ollama_total_gb + other_gb_calc
        unaccounted_gb = total_used_gb - accounted_gb
        # 의미 있는 점유분만 (0.5GB 미만은 잡음 — driver 자체 사용분 등)
        if unaccounted_gb > 0.5:
            comfyui_mib = unaccounted_gb * 1024
            logger.debug(
                "vram breakdown 폴백 — compute-apps 매칭 실패, total %.1fG - ollama %.1fG - other %.1fG = ComfyUI %.1fG 추정",
                total_used_gb,
                ollama_total_gb,
                other_gb_calc,
                unaccounted_gb,
            )

    # ComfyUI 마지막 dispatch 정보
    last = dispatch_state.get()
    comfyui_block: dict[str, Any] = {
        "vram_gb": round(comfyui_mib / 1024, 1),
    }
    last_model = last.get("model") if isinstance(last, dict) else None
    last_mode = last.get("mode") if isinstance(last, dict) else None
    if last_model:
        comfyui_block["models"] = [last_model]
        comfyui_extras = last.get("extras") if isinstance(last, dict) else None
        if comfyui_extras:
            comfyui_block["extras"] = list(comfyui_extras)
    else:
        comfyui_block["models"] = []
    if last_mode:
        comfyui_block["last_mode"] = last_mode

    return {
        "comfyui": comfyui_block,
        "ollama": {
            # API 보고와 nvidia-smi 매칭 중 큰 값 사용 — 두 소스 측정 일관성
            "vram_gb": round(ollama_total_gb, 1),
            "models": ollama_models,
        },
        "other_gb": round(other_mib / 1024, 1),
    }
