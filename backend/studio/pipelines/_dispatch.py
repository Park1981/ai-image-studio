"""
studio.pipelines._dispatch — ComfyUI 디스패치 공용 헬퍼.

generate/edit/video 파이프라인이 공유하는:
  - ComfyDispatchResult: dispatch 결과 모델
  - _dispatch_to_comfy: ComfyUI 에 API prompt 제출 + WS 진행 수신 + 결과 다운로드
  - _save_comfy_output / _save_comfy_video: 결과 파일 저장 콜백
  - _cleanup_comfy_temp: ComfyUI output 임시 파일 정리
  - _mark_generation_complete: 레거시 idle shutdown 타이머 시작
  - COMFY_MOCK_FALLBACK / _OUR_COMFY_PREFIXES: 동작 정책 상수

task #16 (2026-04-26): router.py 풀 분해 — 본래 router.py 안에 인라인이던 코드.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable, TYPE_CHECKING

from config import settings  # type: ignore[import-not-found]
from PIL import Image
from pydantic import BaseModel

from .. import ollama_unload
from .._gpu_lock import GpuBusyError, acquire_gpu_slot, release_gpu_slot
# 레거시 process_manager 재활용 — Studio 파이프라인 완료 시 idle shutdown 타이머 트리거.
# 2026-04-27 (N1): _proc_mgr.py 단일 모듈로 통합 — 한 곳에서 import.
from .._proc_mgr import process_manager as _proc_mgr
from ..comfy_api_builder import _snap_dimension  # noqa: F401 — re-export 호환
from ..comfy_transport import (
    ComfyUITransport,
    extract_output_files,
    extract_output_images,
)
from ..storage import _next_save_path, STUDIO_URL_PREFIX

if TYPE_CHECKING:
    from ..tasks import Task

log = logging.getLogger(__name__)


# ComfyUI 가 실제로 안 돌고 있어서 /prompt 가 실패해도 UI 는 Mock 이미지로 완주되게 할지.
# False 면 에러를 프론트로 올리고 토스트. True 면 폴백해서 mock-seed:// 리턴.
COMFY_MOCK_FALLBACK = settings.comfy_mock_fallback


def _mark_generation_complete() -> None:
    """Studio 파이프라인 완료 시 idle shutdown 타이머 시작.

    레거시 /api/generate 만 호출하던 mark_generation_complete 를 신규 Studio 파이프라인에도 통합.
    _proc_mgr 가 None (테스트 환경) 이면 무시. 호출 자체 실패해도 파이프라인은 정상 완료 처리.
    """
    if _proc_mgr is None:
        return
    try:
        _proc_mgr.mark_generation_complete()
    except Exception as exc:  # pragma: no cover - 방어적
        log.warning("mark_generation_complete 호출 실패: %s", exc)


def _summarize_api_prompt(api_prompt: dict[str, Any]) -> tuple[int, int]:
    """Return (LoadImage count, TextEncodeQwenImageEditPlus nodes with image2)."""
    load_image_count = 0
    image2_encoder_count = 0
    for node in api_prompt.values():
        if not isinstance(node, dict):
            continue
        class_type = node.get("class_type")
        inputs = node.get("inputs") or {}
        if class_type == "LoadImage":
            load_image_count += 1
        if (
            class_type == "TextEncodeQwenImageEditPlus"
            and isinstance(inputs, dict)
            and "image2" in inputs
        ):
            image2_encoder_count += 1
    return load_image_count, image2_encoder_count


class ComfyDispatchResult(BaseModel):
    """_dispatch_to_comfy 반환 — 이미지 참조 + 해상도 + 오류 메시지."""

    image_ref: str
    width: int | None = None
    height: int | None = None
    comfy_error: str | None = None


SaveOutputFn = Callable[
    [ComfyUITransport, str, str], Awaitable[tuple[str, int, int]]
]
"""save_output 콜백 타입. 인자: (comfy, prompt_id, mode). mode 는 _next_save_path 에 전달.
반환: (url, width, height) · video 는 0,0 반환 가능."""


def _mock_ref_or_raise(reason: str) -> str:
    """COMFY_MOCK_FALLBACK 설정에 따라 mock ref 반환 또는 예외."""
    if COMFY_MOCK_FALLBACK:
        return f"mock-seed://{uuid.uuid4().hex}"
    raise RuntimeError(reason)


# ComfyUI output 폴더 경로 — 임시 파일 삭제용 (선택 설정).
# .env 에 COMFYUI_OUTPUT_PATH 없으면 cleanup no-op (안전 디폴트).
_COMFYUI_OUTPUT_BASE: Path | None = None
try:
    _env_comfy_out = os.getenv("COMFYUI_OUTPUT_PATH")
    if _env_comfy_out:
        _candidate = Path(_env_comfy_out).resolve()
        if _candidate.is_dir():
            _COMFYUI_OUTPUT_BASE = _candidate
        else:
            log.warning(
                "COMFYUI_OUTPUT_PATH 가 디렉토리가 아님: %s (cleanup 비활성)",
                _env_comfy_out,
            )
except Exception as _e:
    log.warning("COMFYUI_OUTPUT_PATH resolve 실패: %s (cleanup 비활성)", _e)

# 우리가 ComfyUI 에 만든 결과물만 식별 — 다른 워크플로우/사용자 직접 작업 건드리지 않음.
_OUR_COMFY_PREFIXES = ("AIS-Gen", "AIS-Edit", "AIS-Video")


async def _cleanup_comfy_temp(
    comfy: "ComfyUITransport", file_info: dict[str, Any]
) -> None:
    """ComfyUI output 의 임시 파일 삭제 (다운로드 성공 후 호출).

    우리 백엔드가 파일을 영구 보관하므로 ComfyUI 측은 중복 저장. 디스크 절약 위해
    AIS-Gen / AIS-Edit / AIS-Video prefix 로 우리 것만 식별해 삭제.

    .env 의 COMFYUI_OUTPUT_PATH 가 설정되지 않았거나 유효하지 않으면 no-op
    (안전 디폴트 — 잘못된 경로 삭제 방지).

    Args:
        comfy: (향후 HTTP API 기반 삭제 대비 · 현재는 미사용)
        file_info: extract_output_* 가 반환한 {filename, subfolder, type} dict.
    """
    _ = comfy  # 현재는 파일 시스템 직접 접근이라 미사용 (API reserve)
    if _COMFYUI_OUTPUT_BASE is None:
        return
    filename = file_info.get("filename", "")
    subfolder = file_info.get("subfolder", "") or ""
    file_type = file_info.get("type", "output")

    # temp 타입은 ComfyUI 가 자동 정리 — 건드리지 않음
    if file_type != "output":
        return

    # 우리 prefix 만 (다른 워크플로우 결과 보호)
    if not any(filename.startswith(p) for p in _OUR_COMFY_PREFIXES):
        return

    # 경로 조립 + path traversal 방어
    try:
        target = (_COMFYUI_OUTPUT_BASE / subfolder / filename).resolve()
        if not target.is_relative_to(_COMFYUI_OUTPUT_BASE):
            log.warning("comfy cleanup skip - path escapes base: %s", target)
            return
        if target.exists():
            target.unlink()
            log.info("ComfyUI 임시 파일 삭제: %s", target.name)
    except OSError as e:
        log.warning("ComfyUI 임시 파일 삭제 실패 %s: %s", filename, e)


async def _save_comfy_video(
    comfy: ComfyUITransport, prompt_id: str, mode: str
) -> tuple[str, int, int]:
    """ComfyUI 완료 prompt 의 영상 파일을 다운로드·저장.

    SaveVideo 노드의 outputs 키는 ComfyUI 버전마다 다름 —
    extract_output_files 가 videos/gifs/animated/files/images 순서 탐색.
    width/height 는 PIL 로 못 읽어서 (mp4 이므로) 0 반환. 프론트가 표기 생략.

    2026-04-25: mode/date 계층 저장 구조 적용. ComfyUI 측 임시 파일은 다운로드 후 삭제.
    """
    history = await comfy.get_history(prompt_id)
    files = extract_output_files(history)
    if not files:
        raise RuntimeError("no video output in history")
    # 영상 확장자 우선 선택 (PNG 프리뷰가 섞여있을 수 있음)
    video_candidates = [
        f for f in files
        if f["filename"].lower().endswith((".mp4", ".webm", ".mov", ".gif"))
    ]
    chosen = video_candidates[0] if video_candidates else files[0]
    raw = await comfy.download_file(
        filename=chosen["filename"],
        subfolder=chosen["subfolder"],
        file_type=chosen["type"],
    )
    ext = os.path.splitext(chosen["filename"])[1].lstrip(".") or "mp4"
    save_path, url_rel = _next_save_path(mode, ext)
    save_path.write_bytes(raw)

    # ComfyUI 측 임시 파일 정리 (디스크 절약 · AIS-Video prefix 로 식별)
    await _cleanup_comfy_temp(comfy, chosen)

    return (f"{STUDIO_URL_PREFIX}/{url_rel}", 0, 0)


async def _save_comfy_output(
    comfy: ComfyUITransport, prompt_id: str, mode: str
) -> tuple[str, int, int]:
    """ComfyUI 완료 prompt 의 첫 이미지를 다운로드·저장하고 (url, width, height) 반환.

    PIL 로 실제 해상도를 읽어 히스토리 메타데이터에 반영 (Edit 결과는 원본+스케일 후 크기가
    프리셋과 다를 수 있음 — 하드코딩 1024 이슈 해소).

    2026-04-25: mode/date 계층 저장 구조 적용. ComfyUI 측 임시 파일은 다운로드 후 삭제.
    """
    history = await comfy.get_history(prompt_id)
    images = extract_output_images(history)
    if not images:
        raise RuntimeError("no output images")
    img = images[0]
    raw = await comfy.download_image(
        filename=img["filename"],
        subfolder=img["subfolder"],
        image_type=img["type"],
    )
    save_path, url_rel = _next_save_path(mode, "png")
    save_path.write_bytes(raw)

    # ComfyUI 측 임시 파일 정리 (디스크 절약 · AIS-Gen/Edit prefix 로 식별)
    await _cleanup_comfy_temp(comfy, img)

    # 실해상도 추출 — 실패해도 이미지 자체는 살리고 0 으로 폴백
    try:
        with Image.open(io.BytesIO(raw)) as im:
            width, height = im.size
    except Exception as e:
        log.warning("PIL size read failed: %s", e)
        width, height = 0, 0

    return (f"{STUDIO_URL_PREFIX}/{url_rel}", width, height)


async def _ensure_comfyui_ready(task: "Task", progress_at: int) -> None:
    """ComfyUI 가 꺼져 있으면 깨우면서 진행 모달에 알린다 (Phase 5 자동 기동).

    호출 흐름 (`_dispatch_to_comfy` 진입 직후):
      1. `_proc_mgr` 가 None (테스트 환경) 이면 즉시 return — 호출자 무영향.
      2. `check_comfyui` (HTTP 헬스체크) 가 True 면 이미 떠 있는 것 → return.
      3. 꺼져 있으면 stage emit ("comfyui-warmup") + `start_comfyui` 호출.
         프론트의 `PIPELINE_DEFS.<mode>.comfyui-warmup` row 가 `enabled` 콜백으로
         이 stage 도착 시점부터 표시 (자동 기동 시에만 노출).
      4. `start_comfyui` 가 False 반환하면 RuntimeError → 상위 `_dispatch_to_comfy`
         의 except 블록이 mock_ref 폴백 또는 재-raise (기존 정책 유지).

    Args:
        task: stage emit 대상.
        progress_at: warmup stage 의 progress 값. 보통 `progress_start - 2` 권장
            (sampling stage 직전 살짝 앞 — 진행 바 역행 방지).
    """
    if _proc_mgr is None:
        return  # 테스트 환경 — services.process_manager 미로드 시 폴백
    try:
        already_up = await _proc_mgr.check_comfyui()
    except Exception as exc:  # pragma: no cover - 방어적
        log.warning("ComfyUI 헬스체크 실패 (warmup skip): %s", exc)
        return
    if already_up:
        return

    await task.emit(
        "stage",
        {
            "type": "comfyui-warmup",
            "progress": progress_at,
            "stageLabel": "ComfyUI 깨우는 중 (~30초)",
        },
    )
    started = await _proc_mgr.start_comfyui()
    if not started:
        raise RuntimeError("ComfyUI 시작 실패")


async def _dispatch_to_comfy(
    task: "Task",
    api_prompt_factory: Callable[..., dict[str, Any]],
    *,
    mode: str,
    progress_start: int,
    progress_span: int,
    client_prefix: str = "ais",
    upload_bytes: bytes | None = None,
    upload_filename: str | None = None,
    # Multi-ref (2026-04-27): 추가 업로드 (현재는 1건만 — reference). 미래 확장 가능.
    extra_uploads: list[tuple[bytes, str]] | None = None,
    save_output: SaveOutputFn | None = None,
    # 2026-04-26 idle 600→1200s, hard 1800→7200s — 16GB VRAM 풀 퀄리티 swap 케이스 안전망.
    idle_timeout: float = 1200.0,
    hard_timeout: float = 7200.0,
) -> ComfyDispatchResult:
    """ComfyUI 에 API prompt 제출 + WS 진행 수신 + 결과 다운로드 (공용).

    Edit 플로우 (upload_bytes != None): 먼저 `/upload/image` 로 소스 이미지 업로드 →
    업로드된 파일명을 api_prompt_factory 에 넘겨 최종 api_prompt 조립.
    Generate 플로우 (upload_bytes == None): api_prompt_factory(None) 호출로 즉시 조립.

    Args:
        task: 진행률/에러 emit 대상
        api_prompt_factory: (uploaded_filename_or_None) -> api_prompt_dict
        progress_start/progress_span: pipelineProgress 에 매핑할 범위
        upload_bytes/upload_filename: Edit/Video 전용, 둘 다 있어야 업로드 수행
        save_output: 결과 저장 콜백. None 이면 _save_comfy_output (이미지).
            Video 는 _save_comfy_video 주입.
        idle_timeout/hard_timeout: WS listen timeout. Video 는 연장 필요.

    Returns:
        ComfyDispatchResult(image_ref, width, height, comfy_error)
    """
    client_id = f"{client_prefix}-{uuid.uuid4().hex[:10]}"
    save_fn = save_output or _save_comfy_output
    gpu_operation = f"comfyui-{mode}"
    gpu_acquired = False
    try:
        await acquire_gpu_slot(gpu_operation)
        gpu_acquired = True

        # Phase 5: ComfyUI 자동 기동 — 꺼져 있으면 깨우면서 warmup stage emit.
        # GPU slot 잡은 채로 호출 (다른 dispatch 와 직렬화 보장 · ComfyUI 시작 자체는 GPU 미사용).
        await _ensure_comfyui_ready(task, progress_at=max(progress_start - 2, 0))

        # The unload must happen while holding the shared GPU slot; otherwise a
        # concurrent vision/upgrade call can load Ollama between unload and submit.
        await ollama_unload.force_unload_all_loaded_models()

        async with ComfyUITransport() as comfy:
            uploaded_name: str | None = None
            if upload_bytes is not None:
                uploaded_name = await comfy.upload_image(
                    upload_bytes, upload_filename or "input.png"
                )
            log.info(
                "_dispatch_to_comfy: mode=%s upload=%s extra_uploads=%d",
                mode,
                upload_filename,
                len(extra_uploads) if extra_uploads else 0,
            )
            # Multi-ref: extra 업로드 (있으면 순차) — extra_uploads None 이면 옛 흐름.
            # ⚠️ Codex 2차 리뷰 fix #2: factory 호출 시 keyword 는 extra_uploads 있을 때만.
            # 옛 generate/video factory 는 positional 1개만 받음 — 영향 0 보장.
            if extra_uploads:
                extra_uploaded_names: list[str] = []
                for extra_bytes, extra_filename in extra_uploads:
                    extra_name = await comfy.upload_image(
                        extra_bytes, extra_filename or "extra.png"
                    )
                    extra_uploaded_names.append(extra_name)
                api_prompt = api_prompt_factory(
                    uploaded_name, extra_uploaded_names=extra_uploaded_names,
                )
            else:
                api_prompt = api_prompt_factory(uploaded_name)
            load_image_count, image2_encoder_count = _summarize_api_prompt(
                api_prompt
            )
            log.info(
                "_dispatch_to_comfy api_prompt: mode=%s nodes=%d LoadImage=%d "
                "TextEncodeQwenImageEditPlus.image2=%d",
                mode,
                len(api_prompt),
                load_image_count,
                image2_encoder_count,
            )
            prompt_id = await comfy.submit(api_prompt, client_id)
            log.info("ComfyUI submitted prompt_id=%s", prompt_id)

            comfy_err: str | None = None
            async for evt in comfy.listen(
                client_id, prompt_id,
                idle_timeout=idle_timeout, hard_timeout=hard_timeout,
            ):
                if evt.kind == "execution_error":
                    comfy_err = evt.data.get("exception_message", "unknown")
                    break
                if evt.kind == "progress":
                    pct = evt.percent or 0.0
                    await task.emit(
                        "stage",
                        {
                            "type": "comfyui-sampling",
                            "progress": progress_start + int(progress_span * pct),
                            "stageLabel": f"ComfyUI 샘플링 {int(pct * 100)}%",
                            "samplingStep": evt.data.get("value"),
                            "samplingTotal": evt.data.get("max"),
                        },
                    )
                # execution_success 면 listen 내부에서 루프 종료

            if comfy_err:
                return ComfyDispatchResult(
                    image_ref=_mock_ref_or_raise(comfy_err), comfy_error=comfy_err
                )

            output_ref, width, height = await save_fn(comfy, prompt_id, mode)
        log.info("ComfyUI output saved: %s (%dx%d)", output_ref, width, height)
        return ComfyDispatchResult(image_ref=output_ref, width=width, height=height)

    except asyncio.CancelledError:
        # 클라이언트가 끊었거나 interrupt 호출 — 상위로 재-raise 해서 파이프라인 정리
        raise
    except GpuBusyError as e:
        log.warning("ComfyUI dispatch busy: %s", e)
        raise
    except Exception as e:
        log.warning("ComfyUI dispatch failed: %s", e)
        return ComfyDispatchResult(
            image_ref=_mock_ref_or_raise(str(e)), comfy_error=str(e)
        )
    finally:
        if gpu_acquired:
            release_gpu_slot(gpu_operation)
