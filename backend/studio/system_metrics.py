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
from typing import TypedDict

import psutil

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
