"""
studio.pipelines.vision_analyze — Vision Analyzer 백그라운드 파이프라인.

Phase 6 (2026-04-27): /api/studio/vision-analyze 를 task-based SSE 로 전환.
기존 동기 JSON 응답 → task 생성 + 백그라운드 spawn + SSE stream.

흐름:
  1. emit "stage" type=vision-encoding (이미지 인코딩 마킹 · 즉시 완료)
  2. analyze_image_detailed(progress_callback=on_progress)
     - on_progress("vision-call") → emit "stage" type=vision-call
     - on_progress("translation") → emit "stage" type=translation
  3. emit "done" with full result payload (옛 JSON 응답 shape 그대로)
  4. 실패 시 emit "error"

GPU lock: gpu_slot("vision-analyze") 그대로 적용 — qwen2.5vl 와 ComfyUI 충돌 방지.
"""

from __future__ import annotations

import logging
from typing import Any

from .._gpu_lock import GpuBusyError, gpu_slot
from ..tasks import Task
from ..vision_pipeline import analyze_image_detailed

log = logging.getLogger(__name__)


# stage type → progress 매핑 (callback 으로 도착하는 신호 → SSE stage event)
# 2026-04-27 라벨 일관화: vision-call → vision-analyze 통일 (edit/video 와 동일 type).
# 백엔드 함수는 다르지만 사용자 시점에선 "이미지 분석" 동일 동작.
_VISION_PROGRESS = {
    "vision-call": 20,  # vision_pipeline.analyze_image_detailed 가 callback 으로 보내는 신호명
    "prompt-synthesize": 45,  # Phase 5: image_detail.py 2단계 (gemma4 text 합성) 시작 신호
    "translation": 70,
}
_VISION_LABEL = {
    "vision-call": "이미지 분석 (qwen3-vl)",
    "prompt-synthesize": "프롬프트 합성 (gemma4)",  # Phase 5 신규 단계
    "translation": "한국어 번역 (gemma4)",
}
# callback 신호명 → SSE stage type 매핑 (백엔드 함수 콜백명은 유지 · SSE type 만 통일)
_STAGE_TYPE_MAP = {
    "vision-call": "vision-analyze",
    "prompt-synthesize": "prompt-synthesize",  # Phase 5: 프론트 SSE type 그대로 전달
    "translation": "translation",
}


async def _run_vision_analyze_pipeline(
    task: Task,
    image_bytes: bytes,
    *,
    vision_model: str | None,
    text_model: str | None,
    width: int,
    height: int,
    size_bytes: int,
) -> None:
    """Vision Analyzer 백그라운드 파이프라인.

    route/vision.py POST handler 가 이미 validation + bytes read 끝낸 상태.
    여기서는 GPU lock + analyze_image_detailed 호출 + stage emit + done 만 담당.
    """
    try:
        # ── 1단계: 이미지 인코딩 마킹 (이미 read 끝남, 시각적 단계 표시만) ──
        await task.emit(
            "stage",
            {
                "type": "vision-encoding",
                "progress": 5,
                "stageLabel": "이미지 인코딩",
            },
        )

        # ── 2단계: callback 으로 vision-call / translation 단계 전환 알림 ──
        # callback 의 stage_type 은 vision_pipeline 내부 신호명 ("vision-call" 등)
        # → _STAGE_TYPE_MAP 으로 SSE stage type ("vision-analyze") 으로 변환 후 emit.
        async def on_progress(stage_type: str) -> None:
            sse_type = _STAGE_TYPE_MAP.get(stage_type, stage_type)
            await task.emit(
                "stage",
                {
                    "type": sse_type,
                    "progress": _VISION_PROGRESS.get(stage_type, 50),
                    "stageLabel": _VISION_LABEL.get(stage_type, stage_type),
                },
            )

        try:
            async with gpu_slot("vision-analyze"):
                result = await analyze_image_detailed(
                    image_bytes,
                    vision_model=vision_model,
                    text_model=text_model,
                    width=width,
                    height=height,
                    progress_callback=on_progress,
                )
        except GpuBusyError as e:
            await task.emit("error", {"message": str(e), "code": "gpu_busy"})
            return

        # ── Phase 6 cleanup (시각 일관성): stage 완료 시점에 결과 흡수 emit ──
        # Edit/Video 의 prompt-merge / vision-analyze 패턴과 동일 — 같은 type 두 번
        # emit 시 PipelineTimeline 의 byType Map 이 마지막 payload 로 덮어씌우므로
        # renderDetail 콜백이 결과 정보를 보조 박스로 표시 가능.
        await task.emit(
            "stage",
            {
                "type": "vision-analyze",
                "progress": 65,
                "stageLabel": "이미지 분석 완료",
                "summary": result.summary,
                "provider": result.provider,
                "fallback": result.fallback,
            },
        )
        if result.ko:
            await task.emit(
                "stage",
                {
                    "type": "translation",
                    "progress": 95,
                    "stageLabel": "한국어 번역 완료",
                    "summaryKo": result.ko,
                },
            )

        # ── 3단계: done event with full result payload (옛 JSON 응답 shape) ──
        payload: dict[str, Any] = {
            "en": result.en,
            "ko": result.ko,
            "provider": result.provider,
            "fallback": result.fallback,
            "width": width,
            "height": height,
            "sizeBytes": size_bytes,
            # v2 9 슬롯
            "summary": result.summary,
            "positivePrompt": result.positive_prompt,
            "negativePrompt": result.negative_prompt,
            "composition": result.composition,
            "subject": result.subject,
            "clothingOrMaterials": result.clothing_or_materials,
            "environment": result.environment,
            "lightingCameraStyle": result.lighting_camera_style,
            "uncertain": result.uncertain,
        }
        await task.emit("done", payload)

    except Exception as e:  # pragma: no cover - 방어적
        log.exception("vision-analyze pipeline crashed: %s", e)
        await task.emit("error", {"message": str(e), "code": "internal"})
    finally:
        await task.close()
