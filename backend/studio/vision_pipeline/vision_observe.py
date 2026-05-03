"""
vision_observe — 1-stage observer (2026-05-03 · ChatGPT 정공법).

Vision 모델 (qwen3-vl:8b 또는 qwen2.5vl:7b) 이 raw observation JSON
만 출력. positive_prompt 작성 / boilerplate phrase 사용 모두 금지.

원칙: Vision 은 작가가 아니라 관찰자.
"""

from __future__ import annotations

import logging
from typing import Any

from .._json_utils import parse_strict_json as _parse_strict_json
from .._ollama_client import call_chat_payload
from . import _common as _c

log = logging.getLogger(__name__)


# ChatGPT 답변 §"Vision 모델용 시스템 프롬프트" 그대로
VISION_OBSERVATION_SYSTEM = """You are a visual observation extractor.

Your task is to inspect the image and output only visible facts.
Do not write an image-generation prompt.
Do not use artistic boilerplate.
Do not guess camera lens, lighting equipment, time of day, race, brand, identity, or mood unless directly visible.
Do not use generic phrases such as cinematic editorial, muted earth tones, golden hour, softbox lighting, 85mm lens, masterpiece, ultra detailed.

Return STRICT JSON only.

Schema:
{
  "image_orientation": "",
  "framing": {
    "crop": "",
    "camera_angle": "",
    "subject_position": ""
  },
  "subjects": [
    {
      "count_index": 1,
      "apparent_age_group": "",
      "broad_visible_appearance": "",
      "face_direction": "",
      "expression": "",
      "eyes": "",
      "mouth": "",
      "hair": "",
      "pose": "",
      "hands": "",
      "clothing": [],
      "accessories_or_objects": [],
      "face_detail": {
        "eye_state": "",
        "left_eye": "",
        "right_eye": "",
        "mouth_state": "",
        "expression_notes": []
      },
      "object_interaction": {
        "object": "",
        "object_position_relative_to_face": "",
        "action": ""
      },
      "clothing_detail": {
        "top_type": "",
        "top_color": "",
        "strap_layout": "",
        "cutouts_or_openings": "",
        "bottom_type": "",
        "bottom_color": "",
        "bottom_style_details": []
      }
    }
  ],
  "environment": {
    "location_type": "",
    "foreground": [],
    "midground": [],
    "background": [],
    "weather_or_surface_condition": [],
    "crowd_detail": {
      "people_visible": "",
      "raincoats_or_ponchos": "",
      "crowd_clothing": [],
      "crowd_focus": ""
    }
  },
  "lighting_and_color": {
    "visible_light_sources": [],
    "dominant_colors": [],
    "contrast": "",
    "flash_or_reflection_evidence": ""
  },
  "photo_quality": {
    "depth_of_field": "",
    "motion_blur": "",
    "focus_target": "",
    "style_evidence": []
  },
  "uncertain": []
}

Precision Observation Checklist:
Before filling the JSON, inspect the image for small but important visual anchors.

Face and expression:
- Check whether both eyes are open, one eye is closed, or one eye is partially closed.
- If one eye is closed or nearly closed while the other is open, describe it as "winking" or "one eye closed".
- Describe mouth state separately: closed mouth, open mouth, drinking, cup covering mouth, smile, neutral.

Object interaction:
- Do not write only "holding a cup" if the cup is close to the mouth.
- Specify whether the cup is raised to the lips, covering the mouth, held near the chest, or held down.

Clothing:
- Do not simplify distinctive garments.
- Look for asymmetric straps, cross straps, cutouts, cropped tops, side openings, cargo pockets, utility details, pants vs shorts.
- If unsure whether the bottom is shorts or pants, write "uncertain" instead of guessing.

Framing:
- Carefully distinguish full-body, thigh-up, waist-up, chest-up, close-up.
- Do not use full-body unless the full body from head to feet is visible.

Background:
- Look for rain, wet surfaces, transparent raincoats, plastic ponchos, stage lights, neon signs, concert or festival structures.

Rules:
- Use short concrete phrases.
- If unsure, write it in "uncertain".
- Prefer "appears to be" for uncertain visual attributes.
- Do not repeat the same phrase.
- Do not create a final prompt."""


async def observe_image(
    image_bytes: bytes,
    *,
    width: int,
    height: int,
    vision_model: str,
    timeout: float,
    ollama_url: str,
    keep_alive: str | None = None,
) -> dict[str, Any]:
    """이미지 → observation JSON dict (실패 시 빈 dict).

    Sampling (ChatGPT 2차 리뷰 권장):
      - temperature 0.2 (관찰은 deterministic 가까이)
      - num_ctx 4096 (Ollama 기본 + 이미지 토큰 안전)
      - keep_alive: env var STUDIO_OLLAMA_KEEP_ALIVE (default "5m")
    """
    # Phase 6 의 resolve_ollama_keep_alive() 를 lazy 호출 (Phase 6 전엔 caller 가
    # keep_alive 명시 주입 필요)
    if keep_alive is None:
        from ..presets import resolve_ollama_keep_alive
        resolved_keep_alive = resolve_ollama_keep_alive()
    else:
        resolved_keep_alive = keep_alive

    ratio_label = _c._aspect_label(width, height)
    user_content = (
        f"One SOURCE image attached. Aspect: {width}×{height} ({ratio_label}).\n"
        "Extract visible facts only. Return STRICT JSON matching the schema. "
        "No prompt-writing. No boilerplate."
    )
    payload = {
        "model": vision_model,
        "messages": [
            {"role": "system", "content": VISION_OBSERVATION_SYSTEM},
            {
                "role": "user",
                "content": user_content,
                "images": [_c._to_base64(image_bytes)],
            },
        ],
        "stream": False,
        "format": "json",
        "keep_alive": resolved_keep_alive,
        "options": {"temperature": 0.2, "num_ctx": 4096},
    }
    try:
        raw = await call_chat_payload(
            ollama_url=ollama_url,
            payload=payload,
            timeout=timeout,
            allow_thinking_fallback=False,  # vision 모델은 thinking 없음; 미래 reasoning 모델 swap 시 thinking leak 방지
        )
    except Exception as e:
        log.warning("vision_observe call failed (%s): %s", vision_model, e)
        return {}

    # 빈 응답 vs JSON parse 실패를 별도 분기로 구분 (다른 실패 모드)
    if not raw:
        log.warning("vision_observe empty response from %s", vision_model)
        _c.debug_log("vision_observe.empty_response", vision_model)
        return {}

    parsed = _parse_strict_json(raw)
    if not isinstance(parsed, dict):
        log.warning("vision_observe JSON parse failed (raw len=%d)", len(raw))
        _c.debug_log("vision_observe.parse_failed", raw[:500])
        return {}

    _c.debug_log("vision_observe.observation", parsed)
    return parsed
