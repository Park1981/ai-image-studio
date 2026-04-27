"""
studio.routes.compare — compare-analyze (Edit 결과 vs 원본 5축 평가).

context 분기:
  edit (default): analyze_pair v3 — 도메인 분기 + 5 슬롯 매트릭스 + 의도 점수
  compare:       analyze_pair_generic — Vision Compare 메뉴 (5축 generic)

공용 GPU gate 로 ComfyUI 샘플링과 직렬화 — 16GB VRAM 충돌 방지.
30s 대기 후에도 gate 가 바쁘면 503 (의도된 backpressure).

task #17 (2026-04-26): router.py 풀 분해 2탄.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from .. import history_db, ollama_unload
from .._gpu_lock import GpuBusyError, gpu_slot
from ..comparison_pipeline import analyze_pair, analyze_pair_generic
from ..prompt_pipeline import clarify_edit_intent
from ..storage import TASK_ID_RE
from ._common import log

router = APIRouter()

_COMPARE_MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB (vision/video 라우트 동일값)


@router.post("/compare-analyze")
async def compare_analyze(
    source: UploadFile = File(...),
    result: UploadFile = File(...),
    meta: str = Form(...),
):
    """Edit 결과(result) 와 원본(source) 을 qwen2.5vl 로 5축 비교 평가.

    multipart:
      source: 원본 이미지 파일
      result: 수정 결과 이미지 파일
      meta: JSON {editPrompt, historyItemId?, visionModel?, ollamaModel?}

    historyItemId 가 주어지면 분석 결과를 DB 에 영구 저장 (saved=True).
    HTTP 200 원칙 — 비전 실패해도 fallback 결과로 200 반환 (analysis.fallback=True).
    동시 호출 시 공용 GPU gate 로 직렬화 → 30s 대기 후 busy 면 503 (의도 설계).
    """
    try:
        meta_obj = json.loads(meta)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"meta JSON invalid: {e}") from e

    # context 분기: 기본 "edit" (Edit 호출자 무영향) · "compare" 면 generic 코드 경로
    context = (meta_obj.get("context") or "edit").strip().lower()
    edit_prompt = (meta_obj.get("editPrompt") or "").strip()
    compare_hint = (meta_obj.get("compareHint") or "").strip()
    history_item_id_raw = meta_obj.get("historyItemId")
    vision_override = meta_obj.get("visionModel") or meta_obj.get("vision_model")
    text_override = meta_obj.get("ollamaModel") or meta_obj.get("ollama_model")

    source_bytes = await source.read()
    result_bytes = await result.read()
    if not source_bytes or not result_bytes:
        raise HTTPException(400, "empty image (source or result)")
    if (
        len(source_bytes) > _COMPARE_MAX_IMAGE_BYTES
        or len(result_bytes) > _COMPARE_MAX_IMAGE_BYTES
    ):
        raise HTTPException(413, "image too large")

    # spec 19 후속 (Codex P1 #2): refined_intent 준비를 lock 밖에서 수행.
    # 이전엔 _COMPARE_LOCK 안에서 clarify_edit_intent (gemma4) 호출 가능했음 →
    # cold start ~5초가 다른 compare 요청을 30s lock timeout 까지 밀어붙임.
    # lock 의 본 목적은 qwen2.5vl 비전 호출과 ComfyUI VRAM 충돌 회피이므로
    # gemma4 text 호출은 lock 밖이 안전 (다른 모델 + 작은 메모리).
    refined_intent = ""
    if context != "compare":
        # edit context 만 refined_intent 사용 (Vision Compare 는 compare_hint 만)
        if (
            isinstance(history_item_id_raw, str)
            and TASK_ID_RE.match(history_item_id_raw)
        ):
            try:
                cached_item = await history_db.get_item(history_item_id_raw)
                if cached_item and cached_item.get("refinedIntent"):
                    refined_intent = cached_item["refinedIntent"]
            except Exception as cache_err:
                log.info(
                    "compare-analyze refined_intent cache lookup failed (non-fatal): %s",
                    cache_err,
                )
        # 캐시 미스 + edit_prompt 있으면 fresh 호출.
        # compare 분석 gate 와는 분리하되, 공용 GPU gate 는 적용해 ComfyUI 와 충돌 방지.
        if not refined_intent and edit_prompt:
            try:
                async with gpu_slot("compare-refine"):
                    refined_intent = await clarify_edit_intent(
                        edit_prompt,
                        model=text_override or "gemma4-un:latest",
                        timeout=60.0,
                    )
            except GpuBusyError as e:
                raise HTTPException(503, str(e)) from e
            except Exception as exc:
                log.info(
                    "compare-analyze refine failed (non-fatal): %s", exc
                )

    # 공용 GPU gate — qwen2.5vl 비전 호출과 ComfyUI 샘플링 동시 활성 차단.
    try:
        async with gpu_slot("compare-analyze"):
            if context == "compare":
                # Vision Compare 메뉴 — 사용자가 임의로 고른 두 이미지 비교
                # source = IMAGE_A, result = IMAGE_B (multipart 필드명 재활용)
                result_obj = await analyze_pair_generic(
                    image_a_bytes=source_bytes,
                    image_b_bytes=result_bytes,
                    compare_hint=compare_hint,
                    vision_model=vision_override,
                    text_model=text_override,
                )
            else:
                # edit context — refined_intent 는 위에서 별도 짧은 gate 로 준비됨
                result_obj = await analyze_pair(
                    source_bytes=source_bytes,
                    result_bytes=result_bytes,
                    edit_prompt=edit_prompt,
                    vision_model=vision_override,
                    text_model=text_override,
                    refined_intent=refined_intent,
                )

            # spec 19 후속 (옵션 1 · 사용자 진단): 자동 비교 분석 후 모델
            # unload 명령을 gate 안에서 보내야 다음 ComfyUI dispatch 와 race 가 없다.
            try:
                await ollama_unload.force_unload_all_before_comfy(wait_sec=0.0)
            except Exception as unload_err:
                log.info(
                    "compare-analyze post-unload failed (non-fatal): %s",
                    unload_err,
                )
    except GpuBusyError as e:
        raise HTTPException(503, str(e)) from e

    # historyItemId 가 TASK_ID_RE 매치 + DB 에 존재할 때만 저장
    # (Vision Compare 메뉴는 historyItemId 미전송 → 자동 스킵 = 완전 휘발 보장)
    saved = False
    if isinstance(history_item_id_raw, str) and TASK_ID_RE.match(history_item_id_raw):
        try:
            saved = await history_db.update_comparison(
                history_item_id_raw, result_obj.to_dict()
            )
        except Exception as db_err:
            log.warning("compare-analyze DB persist failed: %s", db_err)
            saved = False

    return {"analysis": result_obj.to_dict(), "saved": saved}
