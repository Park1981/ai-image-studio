"""
compare_pipeline_v4.pipeline — analyze_pair_v4 (4 stage orchestration).

흐름:
  1. observe1 — vision_observe(image1)
  2. observe2 — vision_observe(image2)
  3. unload(vision_model) + sleep 1.0   ← 명시적 호출 (spec §3.1)
  4. diff_synth — synthesize_diff(obs1, obs2, hint)
  5. translate — translate_v4_result(result)

실패 (observation 빈 dict / diff fallback) 시 fallback shape 보장 (HTTP 200).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

from ..ollama_unload import unload_model
from ..vision_pipeline import observe_image
from ._types import CompareAnalysisResultV4
from .diff_synthesize import synthesize_diff
from .translate import translate_v4_result

log = logging.getLogger(__name__)

# progress_callback 타입 (stage_type: str → None)
ProgressCallback = Callable[[str], Awaitable[None]]


async def analyze_pair_v4(
    *,
    image1_bytes: bytes,
    image2_bytes: bytes,
    image1_w: int,
    image1_h: int,
    image2_w: int,
    image2_h: int,
    compare_hint: str,
    vision_model: str,
    text_model: str,
    ollama_url: str,
    timeout: float,
    progress_callback: ProgressCallback | None = None,
) -> CompareAnalysisResultV4:
    """A + B 두 이미지의 V4 차이 분석.

    HTTP 200 원칙 — 모든 fallback 경로도 CompareAnalysisResultV4 shape 유지.
    """

    async def _signal(stage_type: str) -> None:
        """progress_callback 에 stage_type 을 emit (실패 무시)."""
        if progress_callback is None:
            return
        try:
            await progress_callback(stage_type)
        except Exception as cb_err:  # pragma: no cover
            log.info("progress_callback raised (non-fatal): %s", cb_err)

    # ── 1단계: observe1 — 첫 번째 이미지 관찰 ──
    await _signal("observe1")
    obs1 = await observe_image(
        image1_bytes,
        width=image1_w,
        height=image1_h,
        vision_model=vision_model,
        timeout=timeout,
        ollama_url=ollama_url,
    )
    if not obs1:
        # vision 관찰 실패 → fallback (HTTP 200 보장)
        return _fallback_result(vision_model, text_model)

    # ── 2단계: observe2 — 두 번째 이미지 관찰 (같은 vision 모델 재사용) ──
    await _signal("observe2")
    obs2 = await observe_image(
        image2_bytes,
        width=image2_w,
        height=image2_h,
        vision_model=vision_model,
        timeout=timeout,
        ollama_url=ollama_url,
    )
    if not obs2:
        # 두 번째 관찰 실패 → fallback
        return _fallback_result(vision_model, text_model)

    # ── 모델 전환: vision unload + sleep (16GB VRAM swap 방지) ──
    # observe1/2 는 qwen3-vl vision 모델 점유 → diff_synth 는 gemma4 text 모델 필요
    # 두 모델 동시 점유 시 VRAM swap 발생 → 명시적 unload 후 1.0초 대기
    try:
        await unload_model(vision_model, ollama_url=ollama_url)
        await asyncio.sleep(1.0)
    except Exception as unload_err:
        # unload 실패는 non-fatal — diff_synth 계속 진행
        log.info("compare-v4 vision unload failed (non-fatal): %s", unload_err)

    # ── 3단계: diff_synth — 두 관찰 결과 차이 분석 ──
    await _signal("diff-synth")
    result = await synthesize_diff(
        observation1=obs1,
        observation2=obs2,
        compare_hint=compare_hint,
        text_model=text_model,
        timeout=timeout,
        ollama_url=ollama_url,
    )
    # diff_synthesize 는 vision_model 을 모름 → caller 인자로 채움
    result.vision_model = vision_model

    # diff fallback 이면 translate 건너뜀 (이미 *_ko 빈 문자열 — UI fallback)
    if result.fallback:
        return result

    # ── 4단계: translate — 영문 결과 → 한국어 번역 ──
    await _signal("translation")
    result = await translate_v4_result(
        result,
        text_model=text_model,
        timeout=60.0,
        ollama_url=ollama_url,
    )
    return result


def _fallback_result(vision_model: str, text_model: str) -> CompareAnalysisResultV4:
    """observation 빈 dict → fallback shape (HTTP 200 보장)."""
    import time

    from ._axes import COMPARE_V4_AXES

    return CompareAnalysisResultV4(
        summary_en="", summary_ko="",
        common_points_en=[], common_points_ko=[],
        key_differences_en=[], key_differences_ko=[],
        domain_match="mixed",
        category_diffs={},
        category_scores={k: None for k in COMPARE_V4_AXES},
        key_anchors=[],
        fidelity_score=None,
        transform_prompt_en="", transform_prompt_ko="",
        uncertain_en="vision observation failed",
        uncertain_ko="비전 관찰 실패",
        observation1={}, observation2={},
        provider="fallback",
        fallback=True,
        analyzed_at=int(time.time() * 1000),
        vision_model=vision_model,
        text_model=text_model,
    )
