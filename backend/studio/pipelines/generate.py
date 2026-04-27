"""
studio.pipelines.generate — _run_generate_pipeline 백그라운드 실행기.

router.create_generate_task 가 _spawn 으로 띄우는 코루틴. 단계별 SSE emit,
ComfyUI dispatch, 히스토리 영구 저장까지 처리.

task #16 (2026-04-26): router.py 풀 분해.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any

from .._gpu_lock import gpu_slot
from ..claude_cli import research_prompt
from ..comfy_api_builder import _snap_dimension, build_generate_from_request
from ..presets import DEFAULT_OLLAMA_ROLES, GENERATE_MODEL, get_aspect
from ..prompt_pipeline import upgrade_generate_prompt
from ..schemas import GenerateBody
from ..storage import _persist_history
from ..tasks import Task
from ._dispatch import _dispatch_to_comfy, _mark_generation_complete

log = logging.getLogger(__name__)


async def _run_generate_pipeline(task: Task, body: GenerateBody) -> None:
    """백그라운드 실행 — 단계별로 task.emit() 으로 SSE 방출. 실 ComfyUI 디스패치 포함."""
    try:
        # 1. prompt-parse
        await task.emit(
            "stage",
            {
                "type": "prompt-parse",
                "progress": 10,
                "stageLabel": "프롬프트 해석",
            },
        )

        # 2. (선택) Claude 조사
        # research=true 가 외측 조건. 이 플래그가 꺼져 있으면 단계 자체 스킵 (이벤트 없음).
        # research=true 이면서 pre_research_hints 가 주어지면 (빈 배열 포함) 프론트가
        # upgrade-only 단계에서 이미 조사한 결과를 재사용 → 백엔드 재호출 안 함.
        research_hints: list[str] = []
        if body.research:
            if body.pre_research_hints is not None:
                research_hints = body.pre_research_hints
                await task.emit(
                    "stage",
                    {
                        "type": "claude-research",
                        "progress": 25,
                        "stageLabel": "조사 완료 (사전 확정)",
                    },
                )
            else:
                await task.emit(
                    "stage",
                    {
                        "type": "claude-research",
                        "progress": 25,
                        "stageLabel": "Claude 조사 중",
                    },
                )
                research = await research_prompt(
                    body.prompt, GENERATE_MODEL.display_name
                )
                if research.ok:
                    research_hints = research.hints

        # spec 19 후속 (Codex 리뷰 fix): resolved_w/h 를 upgrade 호출 전에
        # 미리 결정. 이전엔 upgrade 호출 뒤에 계산돼서 body.width/height 가
        # None (aspect preset 만 쓴 일반 케이스) 이면 upgrade 에 0/0 전달 →
        # SYSTEM_GENERATE 가 aspect context 못 받았음. 이제 preset 이든 직접
        # 지정이든 항상 정확한 dim 을 SYSTEM 에 전달.
        aspect = get_aspect(body.aspect)
        actual_seed = body.seed if body.seed > 0 else int(time.time() * 1000)
        if body.width is not None and body.height is not None:
            resolved_w = _snap_dimension(body.width)
            resolved_h = _snap_dimension(body.height)
        else:
            resolved_w = aspect.width
            resolved_h = aspect.height

        # 3. gemma4 업그레이드 (또는 사전 확정된 프롬프트 사용)
        if body.pre_upgraded_prompt:
            # 사용자가 모달에서 이미 확인/수정한 프롬프트 — 재호출 스킵
            await task.emit(
                "stage",
                {
                    "type": "gemma4-upgrade",
                    "progress": 50,
                    "stageLabel": "업그레이드 완료 (사전 확정)",
                },
            )
            from ..prompt_pipeline import UpgradeResult

            upgrade = UpgradeResult(
                upgraded=body.pre_upgraded_prompt,
                fallback=False,
                provider="pre-confirmed",
                original=body.prompt,
            )
        else:
            await task.emit(
                "stage",
                {
                    "type": "gemma4-upgrade",
                    "progress": 45,
                    "stageLabel": "gemma4 업그레이드",
                },
            )
            async with gpu_slot("generate-upgrade"):
                upgrade = await upgrade_generate_prompt(
                    prompt=body.prompt,
                    model=body.ollama_model or DEFAULT_OLLAMA_ROLES.text,
                    research_context="\n".join(research_hints) if research_hints else None,
                    # spec 19 후속 (F + Codex 리뷰 fix): resolved_w/h 가 항상 정확
                    # (preset 이든 직접 지정이든) → SYSTEM_GENERATE composition 정확도 ↑
                    width=resolved_w,
                    height=resolved_h,
                )

        # 4. API 포맷 조립
        await task.emit(
            "stage",
            {
                "type": "workflow-dispatch",
                "progress": 60,
                "stageLabel": "워크플로우 전달",
            },
        )

        # 5. ComfyUI 디스패치 (Generate: 업로드 없음, prompt 즉시 조립)
        await task.emit(
            "stage",
            {
                "type": "comfyui-sampling",
                "progress": 70,
                "stageLabel": "ComfyUI 샘플링",
            },
        )

        # Ollama unload + GPU gate 는 _dispatch_to_comfy 내부에서 공통 처리.

        def _make_generate_prompt(_uploaded: str | None) -> dict[str, Any]:
            return build_generate_from_request(
                prompt=upgrade.upgraded,
                aspect_label=body.aspect,
                steps=body.steps,
                cfg=body.cfg,
                seed=actual_seed,
                lightning=body.lightning,
                width=resolved_w,
                height=resolved_h,
                style_id=body.style_id,
            )

        dispatch = await _dispatch_to_comfy(
            task,
            _make_generate_prompt,
            mode="generate",
            progress_start=70,
            progress_span=25,
            client_prefix="ais",
        )
        image_ref = dispatch.image_ref
        comfy_error = dispatch.comfy_error
        # Generate: 사용자가 요청한 해상도가 그대로 저장됨 (PIL 읽기 실패해도 resolved 유지)
        saved_w = dispatch.width or resolved_w
        saved_h = dispatch.height or resolved_h

        # 6. 후처리
        await task.emit(
            "stage",
            {
                "type": "postprocess",
                "progress": 97,
                "stageLabel": "후처리",
            },
        )
        await asyncio.sleep(0.15)

        # 7. done
        item = {
            "id": f"gen-{uuid.uuid4().hex[:8]}",
            "mode": "generate",
            "prompt": body.prompt,
            "label": body.prompt[:28] + ("…" if len(body.prompt) > 28 else ""),
            "width": saved_w,
            "height": saved_h,
            "seed": actual_seed,
            "steps": body.steps,
            "cfg": body.cfg,
            "lightning": body.lightning,
            "styleId": body.style_id,
            "model": GENERATE_MODEL.display_name,
            "createdAt": int(time.time() * 1000),
            "imageRef": image_ref,
            "upgradedPrompt": upgrade.upgraded,
            "upgradedPromptKo": upgrade.translation,
            "promptProvider": upgrade.provider,
            "researchHints": research_hints,
            "comfyError": comfy_error,
        }
        saved_to_history = await _persist_history(item)
        await task.emit(
            "done", {"item": item, "savedToHistory": saved_to_history}
        )
        _mark_generation_complete()
    except asyncio.CancelledError:
        log.info("Generate pipeline cancelled: %s", task.task_id)
        raise
    except Exception as e:
        log.exception("Generate pipeline error")
        await task.emit("error", {"message": str(e)})
    finally:
        await task.close()
