"""
prompt_synthesize — 2-stage 편집자 (2026-05-03 · ChatGPT 정공법).

Text 모델 (gemma4-un:latest 26B) 이 vision observation JSON 받아
positive_prompt + negative_prompt + summary + key_visual_anchors 합성.

think=False 필수 (CLAUDE.md rules — gemma4-un reasoning 모델 기본 끄기).

원칙: Text 는 관찰 메모를 프롬프트로 만드는 편집자.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .._json_utils import coerce_str as _coerce_str
from .._json_utils import parse_strict_json as _parse_strict_json
from .._ollama_client import call_chat_payload

log = logging.getLogger(__name__)


# ChatGPT 답변 §"Text 모델용 시스템 프롬프트" 그대로
PROMPT_SYNTHESIZE_SYSTEM = """You are an expert AI image-generation prompt writer.

You will receive a JSON object containing visual observations extracted from an image.
Your job is to convert the observations into a self-contained text-to-image prompt.

Important:
- Base the prompt only on the observation JSON.
- Do not invent details that contradict the observations.
- You may add generation-friendly photography terms only when supported by the observations.
- Avoid generic boilerplate unless it matches the observed image.
- Do not mention brands, real identities, celebrities, or copyrighted characters.
- Keep the subject fictional and adult.
- Preserve unique visual anchors.

Output STRICT JSON only:
{
  "summary": "",
  "positive_prompt": "",
  "negative_prompt": "",
  "key_visual_anchors": [],
  "uncertain": []
}

positive_prompt rules:
- 150 to 260 words.
- One dense English paragraph.
- Must be directly copy-pasteable into a text-to-image UI.
- Include: subject, expression, hair, clothing, pose, object interaction, environment, lighting, color palette, framing, depth, realism/style.
- Use concrete visible details.
- Do not repeat phrases.
- Do not use: muted earth tones, golden hour, softbox lighting, 85mm lens, masterpiece, best quality, unless the observation JSON clearly supports it.

negative_prompt rules:
- Comma-separated.
- Include common failure preventions.
- Include contradictions to preserve the observed image, such as dry hair if the subject is wet, smiling if the subject is winking/non-smiling, studio background if the image is outdoors.

Anchor Fidelity Rules:
- The positive_prompt must preserve the most specific visual phrases from the observation JSON.
- Do not replace specific details with generic wording.
- Reuse distinctive observation phrases verbatim when possible.
- Do not simplify "asymmetric cross-strap cutout cropped tank top" to "simple tank top".
- Do not simplify "cup raised to lips" to "holding a cup".
- Do not change "chest-up", "upper-body", or "waist-up" into "full-body".
- Do not change "pants", "cargo pants", or "utility pants" into "shorts".
- Do not change "transparent raincoats" or "plastic ponchos" into generic "silhouettes".
- If the observation says a detail is uncertain, phrase it as uncertain rather than replacing it with a confident guess.
- Visual accuracy is more important than elegant prose."""


async def synthesize_prompt(
    observation: dict[str, Any],
    *,
    text_model: str,
    timeout: float,
    ollama_url: str,
    keep_alive: str | None = None,
) -> dict[str, Any]:
    """observation JSON → 5 슬롯 dict (summary / positive_prompt / negative_prompt / key_visual_anchors / uncertain).

    Sampling (ChatGPT 2차 리뷰 권장):
      - temperature 0.4 (합성 약간 낮춤)
      - num_ctx 6144 (text-only 라 vision 보다 여유)
      - keep_alive: env var STUDIO_OLLAMA_KEEP_ALIVE (default "5m")
    """
    # _common 은 early return 이후에만 필요하므로 함수 내부 import
    from . import _common as _c

    # 빈 observation 입력 → Ollama 호출 없이 즉시 반환 (비용 절약)
    if not observation:
        return _empty_result()

    # Phase 6 의 resolve_ollama_keep_alive() lazy 호출 (Phase 6 전엔 caller 명시 주입 필요)
    if keep_alive is None:
        from ..presets import resolve_ollama_keep_alive
        resolved_keep_alive = resolve_ollama_keep_alive()
    else:
        resolved_keep_alive = keep_alive

    user_content = (
        "Convert this visual observation JSON into a generation-ready prompt.\n"
        "Preserve exact visual anchors verbatim. Do not generalize distinctive "
        "clothing, facial expression, object interaction, framing, or background "
        "crowd details.\n"
        "Do not add unsupported camera or lighting claims.\n\n"
        f"```json\n{json.dumps(observation, ensure_ascii=False, indent=2)}\n```"
    )
    payload = {
        "model": text_model,
        "messages": [
            {"role": "system", "content": PROMPT_SYNTHESIZE_SYSTEM},
            {"role": "user", "content": user_content},
        ],
        "stream": False,
        "format": "json",
        "think": False,  # CLAUDE.md rule — gemma4-un reasoning 모델 기본 OFF
        "keep_alive": resolved_keep_alive,
        "options": {"temperature": 0.4, "num_ctx": 6144},
    }
    try:
        raw = await call_chat_payload(
            ollama_url=ollama_url,
            payload=payload,
            timeout=timeout,
            allow_thinking_fallback=False,  # thinking field leak 방지 (Phase 3 동일 패턴)
        )
    except Exception as e:
        log.warning("prompt_synthesize call failed (%s): %s", text_model, e)
        return _empty_result()

    # 빈 응답 vs JSON parse 실패를 별도 분기로 구분 (다른 실패 모드 — Phase 3 패턴)
    if not raw:
        log.warning("prompt_synthesize empty response from %s", text_model)
        _c.debug_log("prompt_synthesize.empty_response", text_model)
        return _empty_result()

    parsed = _parse_strict_json(raw)
    if not isinstance(parsed, dict):
        log.warning("prompt_synthesize JSON parse failed (raw len=%d)", len(raw))
        _c.debug_log("prompt_synthesize.parse_failed", raw[:500])
        return _empty_result()

    result = {
        "summary": _coerce_str(parsed.get("summary")),
        "positive_prompt": _coerce_str(parsed.get("positive_prompt")),
        "negative_prompt": _coerce_str(parsed.get("negative_prompt")),
        "key_visual_anchors": parsed.get("key_visual_anchors") or [],
        "uncertain": parsed.get("uncertain") or [],
    }
    _c.debug_log("prompt_synthesize.result", result)
    return result


def _empty_result() -> dict[str, Any]:
    """5 슬롯 빈 결과 (실패 / 빈 입력 공용)."""
    return {
        "summary": "",
        "positive_prompt": "",
        "negative_prompt": "",
        "key_visual_anchors": [],
        "uncertain": [],
    }
