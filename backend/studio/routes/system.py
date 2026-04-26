"""
studio.routes.system — process status + ollama models + process action +
                        models preset + history CRUD.

도메인이 다양하지만 모두 "시스템/메타" 카테고리:
  GET  /models                 모델 프리셋 (프론트 미러)
  GET  /ollama/models          설치된 Ollama 모델 (Settings dropdown)
  GET  /process/status         Ollama·ComfyUI 상태 + 통합 자원 메트릭
  POST /process/{name}/{action}
  GET/DELETE /history[/{id}]

task #17 (2026-04-26): router.py 풀 분해 2탄.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException

from .. import history_db
from ..presets import ASPECT_RATIOS, EDIT_MODEL, GENERATE_MODEL
from ..schemas import ProcessAction
from ..storage import _cleanup_edit_source_file, _cleanup_result_file
from ..system_metrics import get_system_metrics, get_vram_breakdown
from ._common import _proc_mgr, log

router = APIRouter()


# ─────────────────────────────────────────────
# Models (프리셋 노출)
# ─────────────────────────────────────────────


@router.get("/models")
async def list_models():
    """모델 프리셋 노출 — 프론트 model-presets.ts 와 snake_case 그대로 매핑."""
    return {
        "generate": asdict(GENERATE_MODEL),
        "edit": asdict(EDIT_MODEL),
        "aspectRatios": [asdict(a) for a in ASPECT_RATIOS],
    }


# ─────────────────────────────────────────────
# Process / Ollama / System Metrics
# ─────────────────────────────────────────────


@router.get("/ollama/models")
async def list_ollama_models():
    """설치된 Ollama 모델 목록 (Settings drawer 드롭다운용).

    Returns:
        [{name, size_gb, modified_at}, ...] — 이름순 정렬.
    """
    if _proc_mgr is None:
        return []
    try:
        return await _proc_mgr.list_ollama_models()
    except Exception as e:
        log.warning("list_ollama_models failed: %s", e)
        return []


@router.get("/process/status")
async def process_status():
    """실 process_manager + system_metrics 로부터 Ollama·ComfyUI 상태 + 통합 자원 메트릭 조회.

    응답 구조 (2026-04-26 헤더 통합 SystemMetrics 도입):
      {
        "ollama":  {"running": bool},
        "comfyui": {"running": bool, "vram_used_gb": float?, "vram_total_gb": float?,
                    "gpu_percent": float?},
        "system":  {"cpu_percent": float?, "ram_used_gb": float?, "ram_total_gb": float?},
        "vram_breakdown": {
          "comfyui": {"vram_gb": float, "models": [str], "last_mode": str?},
          "ollama":  {"vram_gb": float, "models": [{"name", "size_vram_gb", "expires_in_sec"}]},
          "other_gb": float
        }
      }
    각 메트릭 필드는 측정 실패 시 누락 가능 (프론트에서 누락 = 미표시 처리).
    vram_breakdown 은 항상 포함 (실패 시 0/빈 리스트) — 프론트에서 80% 임계 넘을 때만 표시.
    """
    if _proc_mgr is None:
        return {
            "ollama": {"running": False},
            "comfyui": {"running": False},
            "system": {},
        }
    ollama_ok = await _proc_mgr.check_ollama()
    comfyui_ok = await _proc_mgr.check_comfyui()

    # 시스템 메트릭 일괄 측정 — psutil + nvidia-smi 병렬, 실패 시 부분값만 들어옴
    metrics: dict[str, Any] = {}
    try:
        metrics = await get_system_metrics()  # type: ignore[assignment]
    except Exception as exc:
        log.warning("system metrics 측정 실패: %s", exc)
        metrics = {}

    # VRAM breakdown — process_manager 노출 PID 활용 (외부 기동이면 None → 휴리스틱)
    # nvidia-smi compute-apps 가 ComfyUI 못 잡는 케이스 폴백을 위해 total_used_gb 도 전달.
    comfyui_pid = getattr(_proc_mgr, "comfyui_pid", None)
    total_used_gb = metrics.get("vram_used_gb")
    breakdown: dict[str, Any] = {}
    try:
        breakdown = await get_vram_breakdown(
            comfyui_pid=comfyui_pid,
            total_used_gb=total_used_gb,
        )
    except Exception as exc:
        log.warning("vram breakdown 측정 실패: %s", exc)
        breakdown = {}

    # comfyui 묶음 — VRAM + GPU% (GPU 메트릭 nvidia-smi 의존)
    comfyui_payload: dict[str, Any] = {"running": comfyui_ok}
    for key in ("vram_used_gb", "vram_total_gb", "gpu_percent"):
        if key in metrics:
            comfyui_payload[key] = metrics[key]

    # system 묶음 — CPU + RAM (psutil 의존)
    system_payload: dict[str, Any] = {}
    for key in ("cpu_percent", "ram_used_gb", "ram_total_gb"):
        if key in metrics:
            system_payload[key] = metrics[key]

    return {
        "ollama": {"running": ollama_ok},
        "comfyui": comfyui_payload,
        "system": system_payload,
        "vram_breakdown": breakdown,
    }


@router.post(
    "/process/{name}/{action}",
    response_model=ProcessAction,
)
async def process_action(name: str, action: str):
    if name not in ("ollama", "comfyui"):
        raise HTTPException(400, f"unknown process: {name}")
    if action not in ("start", "stop"):
        raise HTTPException(400, f"unknown action: {action}")
    if _proc_mgr is None:
        raise HTTPException(503, "process_manager unavailable")

    fn_name = f"{action}_{name}"
    fn = getattr(_proc_mgr, fn_name, None)
    if fn is None:
        raise HTTPException(400, f"no action {fn_name}")

    try:
        ok = await fn()
    except Exception as e:
        log.exception("process action failed")
        raise HTTPException(500, f"{fn_name} failed: {e}") from e

    return ProcessAction(
        ok=bool(ok),
        message=f"{name} {action} {'OK' if ok else 'FAILED'}",
    )


# ─────────────────────────────────────────────
# History CRUD
# ─────────────────────────────────────────────


@router.get("/history")
async def list_history(
    mode: str | None = None,
    limit: int = 50,
    before: int | None = None,
):
    """히스토리 조회 (최신순, mode 필터, cursor pagination)."""
    valid_modes = ("generate", "edit", "video")
    safe_mode = mode if mode in valid_modes else None
    items = await history_db.list_items(
        mode=safe_mode,
        limit=max(1, min(limit, 200)),
        before_ts=before,
    )
    total = await history_db.count_items(safe_mode)
    return {"items": items, "total": total}


@router.get("/history/{item_id}")
async def get_history(item_id: str):
    item = await history_db.get_item(item_id)
    if item is None:
        raise HTTPException(404, "not found")
    return item


@router.delete("/history/{item_id}")
async def delete_history(item_id: str):
    # audit P1b + R1-6: DB 삭제 + orphan 된 edit-source 원본 및 result 파일 정리.
    # 같은 ref 를 참조하는 다른 row 가 있으면 각 파일은 보존.
    ok, source_ref, image_ref = await history_db.delete_item_with_refs(item_id)
    if not ok:
        raise HTTPException(404, "not found")
    source_cleaned = await _cleanup_edit_source_file(source_ref)
    result_cleaned = await _cleanup_result_file(image_ref)
    return {
        "ok": True,
        "id": item_id,
        "source_cleaned": source_cleaned,
        "result_cleaned": result_cleaned,
    }


@router.delete("/history")
async def clear_history():
    # audit P1b + R1-6: 전체 삭제 시 edit-source + result 파일 동시 정리.
    count, source_refs, image_refs = await history_db.clear_all_with_refs()
    sources_cleaned = 0
    for url in set(source_refs):
        # 전체 삭제 후이므로 count_source_ref_usage 는 무조건 0. 안전.
        if await _cleanup_edit_source_file(url):
            sources_cleaned += 1
    results_cleaned = 0
    for url in set(image_refs):
        if await _cleanup_result_file(url):
            results_cleaned += 1
    return {
        "ok": True,
        "deleted": count,
        "sources_cleaned": sources_cleaned,
        "results_cleaned": results_cleaned,
    }
