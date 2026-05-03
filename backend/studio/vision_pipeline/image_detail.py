"""
vision_pipeline/image_detail.py - Vision Recipe v3 (2-stage 분업 · 2026-05-03).

ChatGPT(하루) 정공법 채택. 옛 1-shot SYSTEM_VISION_RECIPE_V2 제거.

흐름:
  1. vision_observe.observe_image(image_bytes) → observation JSON
  2. prompt_synthesize.synthesize_prompt(observation) → 4 슬롯 (summary,
     positive_prompt, negative_prompt, key_visual_anchors, uncertain)
  3. banned_terms.filter_banned(positive_prompt, observation) → 후처리 필터
  4. observation_mapping.map_observation_to_slots(observation) → 5 슬롯
     (composition, subject, clothing_or_materials, environment,
      lighting_camera_style)
  5. translate_to_korean(summary) → ko
  6. VisionAnalysisResult 반환 (시그니처 + 9 슬롯 호환)

외부 호환: analyze_image_detailed() 시그니처 100% 유지.
폴백 (ChatGPT 2차 리뷰 보강):
  - vision 실패 (observation 빈 dict): provider="fallback", fallback=True
  - text 실패 (synthesize 빈 결과): observation_mapping 기반 짧은
    positive_prompt 자동 합성 ("{subject}, {clothing}, {environment},
    {lighting}, {composition}, realistic photo") + summary 1 문장.
    빈 문자열 안 줌 — 프론트가 비전 분석 망함처럼 보이지 않게.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..presets import DEFAULT_OLLAMA_ROLES
from ..prompt_pipeline import translate_to_korean
from . import _common as _c
from . import banned_terms as _bt
from . import observation_mapping as _om
from . import prompt_synthesize as _ps
from . import vision_observe as _vo


@dataclass
class VisionAnalysisResult:
    """analyze_image_detailed 결과 (v3 · 2-stage 분업).

    레거시 필드 호환:
      - en: 메인 영문 (summary + positive_prompt 합본 또는 폴백 단락)
      - ko: 한국어 번역 (실패 시 None)
      - fallback=True: 비전 호출 자체 실패
      - ko=None: 번역만 실패

    Vision Recipe v3 9 슬롯:
      모두 빈 문자열 가능. 폴백 경로 (vision 실패) 에서 모두 "" 로 채움.
      text 실패 시 (synthesize 빈 결과) 는 observation_mapping 기반
      짧은 positive_prompt 자동 합성 — summary/positive 빈 문자열 X.
    """

    en: str
    ko: str | None
    provider: str  # "ollama" | "fallback"
    fallback: bool

    # ── v3 9 슬롯 (vision 실패 경로는 모두 "" — 프론트 자동 폴백) ──
    summary: str = ""
    positive_prompt: str = ""
    negative_prompt: str = ""
    composition: str = ""
    subject: str = ""
    clothing_or_materials: str = ""
    environment: str = ""
    lighting_camera_style: str = ""
    uncertain: str = ""


async def analyze_image_detailed(
    image_bytes: bytes,
    *,
    vision_model: str | None = None,
    text_model: str | None = None,
    ollama_url: str | None = None,
    timeout: float = _c.DEFAULT_TIMEOUT,
    width: int = 0,
    height: int = 0,
    progress_callback: _c.ProgressCallback | None = None,
) -> VisionAnalysisResult:
    """단일 이미지 → 2-stage 분업 (vision 관찰 + text 합성) → 9 슬롯 + 한글 번역."""
    resolved_vision = vision_model or DEFAULT_OLLAMA_ROLES.vision
    resolved_text = text_model or DEFAULT_OLLAMA_ROLES.text
    resolved_url = ollama_url or _c._DEFAULT_OLLAMA_URL

    # progress_callback 호출 헬퍼 — None 또는 예외 시 무영향 (분석 자체에 영향 없음).
    async def _signal(stage_type: str) -> None:
        if progress_callback is None:
            return
        try:
            await progress_callback(stage_type)
        except Exception as cb_err:  # pragma: no cover
            _c.log.info("progress_callback raised (non-fatal): %s", cb_err)

    # ── 1단계: Vision 관찰 (observe_image) ──
    await _signal("vision-call")
    observation = await _vo.observe_image(
        image_bytes,
        width=width,
        height=height,
        vision_model=resolved_vision,
        timeout=timeout,
        ollama_url=resolved_url,
    )

    if not observation:
        # Vision 자체 실패 — 옛 호환: fallback=True, 9 슬롯 모두 빈 문자열
        return VisionAnalysisResult(
            en="",
            ko=None,
            provider="fallback",
            fallback=True,
        )

    # ── 2단계: Text 합성 (synthesize_prompt) ──
    await _signal("prompt-synthesize")
    synthesized = await _ps.synthesize_prompt(
        observation,
        text_model=resolved_text,
        timeout=timeout,
        ollama_url=resolved_url,
    )

    # ── 3단계: Banned-term 후처리 (관찰 근거 없는 boilerplate 제거) ──
    raw_positive = synthesized.get("positive_prompt", "") or ""
    filtered_positive = _bt.filter_banned(raw_positive, observation)
    _c.debug_log("image_detail.filtered_positive", filtered_positive)

    # ── 4단계: 5 슬롯 observation 직접 매핑 ──
    mapped_slots = _om.map_observation_to_slots(observation)

    # ── 5단계: 통합 결과 조립 + text 실패 폴백 (ChatGPT 2차 리뷰 보강) ──
    summary = synthesized.get("summary", "") or ""
    negative_prompt = synthesized.get("negative_prompt", "") or ""
    uncertain_list = synthesized.get("uncertain", []) or []
    uncertain_str = ", ".join(str(u) for u in uncertain_list if u)

    # text 합성 실패 시 observation 기반 짧은 fallback positive 자동 합성.
    # 빈 문자열보다 훨씬 나음 — 프론트가 비전 분석 망함처럼 보이지 않게.
    if not filtered_positive:
        fallback_parts = [
            mapped_slots["subject"],
            mapped_slots["clothing_or_materials"],
            mapped_slots["environment"],
            mapped_slots["lighting_camera_style"],
            mapped_slots["composition"],
            "realistic photo",
        ]
        filtered_positive = ", ".join(p for p in fallback_parts if p).strip(", ").strip()
        _c.debug_log("image_detail.text_fallback_positive", filtered_positive)

    # summary 도 없으면 observation 기반 1 문장 fallback
    if not summary and mapped_slots["subject"]:
        summary = (
            f"Recovered observation: {mapped_slots['subject']} "
            f"in {mapped_slots['environment'] or 'unspecified setting'}."
        ).strip()

    # en 은 옛 호환 — summary + positive_prompt 합본 (사용자 화면용)
    en_combined = summary
    if filtered_positive:
        en_combined = (
            f"{summary}\n\n{filtered_positive}" if summary else filtered_positive
        )

    # ── 6단계: 한국어 번역 (summary 만 — positive 는 t2i 입력용 영문 유지) ──
    ko: str | None = None
    if summary:
        await _signal("translation")
        ko = await translate_to_korean(
            summary,
            model=resolved_text,
            timeout=60.0,
            ollama_url=resolved_url,
        )

    return VisionAnalysisResult(
        en=en_combined,
        ko=ko,
        provider="ollama",
        fallback=False,
        summary=summary,
        positive_prompt=filtered_positive,
        negative_prompt=negative_prompt,
        composition=mapped_slots["composition"],
        subject=mapped_slots["subject"],
        clothing_or_materials=mapped_slots["clothing_or_materials"],
        environment=mapped_slots["environment"],
        lighting_camera_style=mapped_slots["lighting_camera_style"],
        uncertain=uncertain_str,
    )
