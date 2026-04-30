"""
vision_pipeline/edit_source.py - Edit 9-slot 비전 매트릭스 흐름 (Phase 4.2 단계 3).

clarify_edit_intent (gemma4 자연어 -> 영문 정제) -> analyze_edit_source (qwen2.5vl 매트릭스)
-> upgrade_edit_prompt (gemma4 ComfyUI 프롬프트 변환). _describe_image / _aspect_label /
_to_base64 / VISION_SYSTEM 은 _common.py 에서 import.

spec 15장 패러다임 전환 (2026-04-25):
  동적 배열 (edit_focus / preserve_targets) -> 도메인별 고정 슬롯 매트릭스.
  비교 분석 (comparison_pipeline.analyze_pair) 의 5축 점수표 UX 와 시각적 쌍둥이.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .._json_utils import coerce_str as _coerce_str
from .._json_utils import parse_strict_json as _parse_strict_json
from .._ollama_client import call_chat_payload
from ..presets import DEFAULT_OLLAMA_ROLES
from ..prompt_pipeline import (
    UpgradeResult,
    upgrade_edit_prompt,
)
from . import _common as _c


# 도메인별 슬롯 키 (UI 라벨은 프론트가 한국어로 매핑).
PERSON_SLOTS: tuple[str, ...] = (
    "face_expression",
    "hair",
    "attire",
    "body_pose",
    "background",
)
OBJECT_SCENE_SLOTS: tuple[str, ...] = (
    "subject",
    "color_material",
    "layout_composition",
    "background_setting",
    "mood_style",
)
VALID_DOMAINS: frozenset[str] = frozenset({"person", "object_scene"})
VALID_ACTIONS: frozenset[str] = frozenset({"edit", "preserve"})

# Edit 비전 분석 시스템 프롬프트 (spec 15.8).
# {edit_intent} 는 런타임에 .replace() 로 gemma4 정제 결과 주입.
EDIT_VISION_ANALYSIS_SYSTEM = """You are an image-editing vision analyst.

The SOURCE image is provided. The user's edit intent (already refined into
clean English) is:

>>> {edit_intent} <<<

Your job: classify the image domain and produce a 5-slot edit/preserve matrix
that lets the user verify "did the edit follow my intent, and was everything
else preserved?"

Step 1 — Classify domain:
  - "person" if a human or anthropomorphic character is the main subject.
  - "object_scene" otherwise (products, landscapes, animals, food, vehicles,
    interiors, abstract scenes, etc.).

Step 2 — Fill all 5 slots for the chosen domain. For each slot, decide:
  - action: "edit"     if the user's intent involves changing this aspect.
  - action: "preserve" if the user wants this aspect kept as-is.
  Write a 1-sentence note that:
    - For edit:     describes what changes (target -> intended state).
    - For preserve: confirms what should stay (current state, key features).

Step 3 — Return STRICT JSON only (no markdown, no preamble, no trailing text).

If domain == "person":
{
  "domain": "person",
  "summary": "<1 sentence describing what is visible>",
  "slots": {
    "face_expression": {"action": "edit|preserve", "note": "..."},
    "hair":            {"action": "edit|preserve", "note": "..."},
    "attire":          {"action": "edit|preserve", "note": "..."},
    "body_pose":       {"action": "edit|preserve", "note": "..."},
    "background":      {"action": "edit|preserve", "note": "..."}
  }
}

For the "person" domain, the "background" slot is broad — it covers ALL of:
environment / setting, lighting (key/fill/rim, color temperature, hour),
overall color palette and grading, atmosphere / mood, weather, and
photographic style anchors (film grain, lens character, color treatment).
If the user asks to change "lighting", "warmer mood", "cinematic color",
"rainy atmosphere", "B&W", "vintage tone", classify this as
background.action = "edit" and describe the target state in the note.
If the user does NOT touch any of these, set background.action = "preserve".

If domain == "object_scene":
{
  "domain": "object_scene",
  "summary": "<1 sentence describing what is visible>",
  "slots": {
    "subject":             {"action": "edit|preserve", "note": "..."},
    "color_material":      {"action": "edit|preserve", "note": "..."},
    "layout_composition":  {"action": "edit|preserve", "note": "..."},
    "background_setting":  {"action": "edit|preserve", "note": "..."},
    "mood_style":          {"action": "edit|preserve", "note": "..."}
  }
}

Rules:
- Always fill ALL 5 slots for the chosen domain. Never omit a slot.
- If the user's intent does not mention a slot, set action=preserve with a
  note describing the current visible state.
- Notes are concise (max 1 sentence, 25 words).
- Do not invent details that are not visible in the image."""


@dataclass
class VisionPipelineResult:
    """비전 → 수정 프롬프트 파이프라인 최종 결과.

    Phase 1 (2026-04-25):
      - image_description: 사용자 표시용 요약 (구조 분석 성공 시 human_summary,
        실패 시 기존 짧은 캡션 또는 "(vision unavailable ...)")
      - edit_vision_analysis: 구조 분석 (성공 시 EditVisionAnalysis, 실패 시 None)
      - final_prompt: upgrade_edit_prompt 결과 (변경 없음)
    """

    image_description: str
    """사용자 표시용 요약 (DB visionDescription 저장 + step 1 description)."""

    final_prompt: str
    """2단계 gemma4-un 통합 출력."""

    vision_ok: bool
    upgrade: UpgradeResult

    edit_vision_analysis: EditVisionAnalysis | None = None
    """구조 분석 (Phase 1 휘발 · SSE payload 로만 전달)."""


async def run_vision_pipeline(
    image_path: Path | str | bytes,
    edit_instruction: str,
    vision_model: str = "gemma4-heretic:vision-q4km",
    text_model: str = "gemma4-un:latest",
    timeout: float = _c.DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    *,
    width: int = 0,
    height: int = 0,
    # Multi-reference (2026-04-27 Phase 4): image2 자체는 비전 분석 X —
    # 사용자 명시 role 만 upgrade 단계로 전달해 SYSTEM_EDIT 분기 반영.
    reference_role: str | None = None,
) -> VisionPipelineResult:
    """Edit 모드 비전 파이프라인 (v2 · spec 15장 패러다임 전환).

    흐름:
      1) clarify_edit_intent() — gemma4 가 사용자 자연어 → 영어 정제 intent
      2) analyze_edit_source() — qwen2.5vl 가 정제 intent + 이미지 → 슬롯 매트릭스
      3) 성공 시: compact_context() 를 upgrade_edit_prompt 에 전달
         실패 시: 기존 _c._describe_image 로 짧은 캡션 폴백 (원래 동작 유지)

    Args:
        image_path: 로컬 파일 경로 (Path/str) 또는 raw bytes
        edit_instruction: 사용자 자연어 수정 지시 (한/영)
        vision_model: 비전 모델 (qwen2.5vl:7b 권장)
        text_model: gemma4 정제 + upgrade 공통 모델 (gemma4-un)
        ollama_url: 미지정 시 settings.ollama_url
    """
    # 지연 import — 순환 회피. clarify_edit_intent 는 prompt_pipeline.translate 에 있음.
    # Phase 4.3 단계 4 (codex C2 fix): facade 가 아니라 submodule 직접 import.
    # facade re-export 의 함수 reference snapshot 함정 회피 + patch 일관 동작.
    from ..prompt_pipeline.translate import clarify_edit_intent
    # 지연 import — 모델 단계별 unload 헬퍼 (옵션 B · 16GB VRAM swap 차단).
    from .. import ollama_unload

    resolved_url = ollama_url or _c._DEFAULT_OLLAMA_URL

    # image_path 를 bytes 로 정규화 (analyze_edit_source 는 bytes 시그니처)
    if isinstance(image_path, (str, Path)):
        try:
            image_bytes = Path(image_path).read_bytes()
        except Exception as e:
            _c.log.warning("Image read failed for analyze_edit_source: %s", e)
            image_bytes = b""
    else:
        image_bytes = image_path

    # ── 0단계: gemma4 의도 정제 (사용자 자연어 → 영어 1-2문장) ──
    refined_intent = await clarify_edit_intent(
        edit_instruction,
        model=text_model,
        timeout=60.0,
        ollama_url=resolved_url,
    )

    # spec 19 옵션 B: gemma4 (clarify) 끝났으니 비전 호출 전 명시적 unload.
    # 이전엔 clarify (gemma4 14.85GB) + analyze (qwen2.5vl 14GB) 가 동시 점유 →
    # 28GB > 16GB VRAM 한계 → swap. 이제 단계 전환마다 unload 로 swap 차단.
    # 비용: gemma4 cold reload ~5초 (upgrade 단계). swap 회피 가치 압도적.
    # 2026-04-27 (N6): GPU_RELEASE_WAIT_SEC 단일 상수 공유.
    await ollama_unload.unload_model(text_model, ollama_url=resolved_url)
    await asyncio.sleep(ollama_unload.GPU_RELEASE_WAIT_SEC)

    # ── 1단계: 비전 매트릭스 분석 ──
    analysis: EditVisionAnalysis | None = None
    if image_bytes:
        analysis = await analyze_edit_source(
            image_bytes,
            edit_instruction,
            vision_model=vision_model,
            text_model=text_model,
            ollama_url=resolved_url,
            timeout=timeout,
            refined_intent=refined_intent,  # 정제 결과 재사용 (중복 호출 방지)
            width=width,
            height=height,
        )

    # 성공 판정 — fallback=False 이고 (summary 또는 어떤 슬롯의 note 라도 있음)
    analysis_ok = bool(
        analysis
        and not analysis.fallback
        and (
            analysis.summary
            or any(slot.note for slot in analysis.slots.values())
        )
    )

    if analysis_ok and analysis is not None:
        # 성공 경로
        description = analysis.human_summary()
        upgrade_ctx = analysis.compact_context()
        vision_ok = True
    else:
        # ── 1b단계: 매트릭스 분석 실패 → 짧은 캡션 폴백 ──
        fallback_caption = await _c._describe_image(
            image_bytes or image_path, vision_model, timeout, resolved_url
        )
        if fallback_caption.strip():
            description = fallback_caption
            upgrade_ctx = fallback_caption
            vision_ok = True
        else:
            description = "(vision model unavailable — relying on user instruction only)"
            upgrade_ctx = description
            vision_ok = False
        # analysis 가 None 이면 그대로 None 전달, fallback shape 면 그것도 그대로
        # 전달 — 프론트가 fallback 플래그로 분기.

    # spec 19 옵션 B: 비전 (qwen2.5vl) 호출 끝났으니 gemma4 호출 전 unload.
    # upgrade + translate 가 gemma4 reuse 라 cold reload 비용 한 번만.
    # 2026-04-27 (N6): GPU_RELEASE_WAIT_SEC 단일 상수 공유.
    await ollama_unload.unload_model(vision_model, ollama_url=resolved_url)
    await asyncio.sleep(ollama_unload.GPU_RELEASE_WAIT_SEC)

    # 정제 intent 가 있으면 upgrade 에도 함께 전달 (image_description 위에 추가)
    upgrade_input = (
        f"User intent (refined): {refined_intent}\n\n{upgrade_ctx}"
        if refined_intent
        else upgrade_ctx
    )

    # spec 16: 매트릭스 객체도 upgrade 에 직접 전달 → SYSTEM_EDIT 에서
    # STRICT MATRIX DIRECTIVES 블록 동적 주입. 객체가 fallback 이면 미주입.
    upgrade = await upgrade_edit_prompt(
        edit_instruction=edit_instruction,
        image_description=upgrade_input,
        model=text_model,
        timeout=timeout,
        ollama_url=resolved_url,
        analysis=analysis if analysis_ok else None,
        # Multi-reference (2026-04-27 Phase 4): None 이면 옛 SYSTEM_EDIT 그대로.
        reference_role=reference_role,
    )
    return VisionPipelineResult(
        image_description=description,
        final_prompt=upgrade.upgraded,
        vision_ok=vision_ok,
        upgrade=upgrade,
        edit_vision_analysis=analysis,
    )


@dataclass
class EditSlotEntry:
    """슬롯 단위 매트릭스 항목 — {수정/유지} × 1줄 설명."""

    action: str = "preserve"  # "edit" | "preserve"
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"action": self.action, "note": self.note}


@dataclass
class EditVisionAnalysis:
    """Edit 이미지 v2 구조 분석 결과 (spec 15.6).

    domain 에 따라 slots 의 키 셋 다름 (PERSON_SLOTS / OBJECT_SCENE_SLOTS).
    fallback=True 경로도 동일 shape 보장 (slots 5개 모두 preserve + 빈 note).
    """

    domain: str = "object_scene"  # "person" | "object_scene"
    intent: str = ""              # gemma4 정제 결과 (영어 1-2문장)
    summary: str = ""             # qwen2.5vl 요약 1줄 (영어)
    slots: dict[str, EditSlotEntry] = field(default_factory=dict)

    provider: str = "fallback"    # "ollama" | "fallback"
    fallback: bool = True
    analyzed_at: int = 0
    vision_model: str = ""

    def to_dict(self) -> dict[str, Any]:
        """SSE payload / 프론트 타입과 맞춘 camelCase 직렬화."""
        return {
            "domain": self.domain,
            "intent": self.intent,
            "summary": self.summary,
            "slots": {k: v.to_dict() for k, v in self.slots.items()},
            "provider": self.provider,
            "fallback": self.fallback,
            "analyzedAt": self.analyzed_at,
            "visionModel": self.vision_model,
        }

    def compact_context(self) -> str:
        """upgrade_edit_prompt() 에 넘길 압축 문자열.

        spec 19 (2026-04-26 후속 · Codex 진단 #2 반영):
          [preserve] 슬롯의 note 는 절대 출력하지 않는다. 이전엔 여기서 모든
          슬롯 note 를 기록해서 user_msg 의 [Image description] 블록에 흘렀고,
          gemma4 가 그걸 변경 지시로 오해해 의도치 않은 디테일이 결과에
          섞이는 사례가 발생함 (spec 17 SYSTEM 가드와 모순).

          이제는 preserve 슬롯은 라벨만 보존 — "(preserved)" 마커만.
          [edit] 슬롯은 변경 지시 자체이므로 note 그대로 명시 (필수).

        예시 (인물 모드):
          Source image analysis (person):
          Intent: Remove top and bottom clothing entirely. Resize bust to natural E-cup.
          Summary: A woman in a black outfit standing in a park.
          - face_expression [preserve] (preserved)
          - hair [preserve] (preserved)
          - attire [edit] remove top and bottom (full nude)
          - body_pose [edit] increase bust to natural sagging E-cup
          - background [preserve] (preserved)
        """
        lines: list[str] = [f"Source image analysis ({self.domain}):"]
        if self.intent:
            lines.append(f"Intent: {self.intent}")
        if self.summary:
            lines.append(f"Summary: {self.summary}")
        for key in self._domain_slot_order():
            entry = self.slots.get(key)
            if entry is None:
                continue
            if entry.action == "preserve":
                # preserve 슬롯은 specific 묘사 절대 노출 X (spec 19 · Codex #2)
                lines.append(f"- {key} [preserve] (preserved — keep as-is)")
            else:
                # edit 슬롯은 변경 지시 자체 → note 명시 필수
                note = entry.note or "(follow user instruction)"
                lines.append(f"- {key} [edit] {note}")
        return "\n".join(lines)

    def human_summary(self) -> str:
        """DB visionDescription + SSE step 1 description 에 들어가는 1줄.

        summary 우선, 없으면 intent. 둘 다 없으면 빈 문자열 (휘발 폴백).
        """
        return self.summary or self.intent

    def _domain_slot_order(self) -> tuple[str, ...]:
        """domain 에 맞는 슬롯 키 순서. 알 수 없으면 object_scene 기본."""
        if self.domain == "person":
            return PERSON_SLOTS
        return OBJECT_SCENE_SLOTS


def _empty_fallback_slots(domain: str) -> dict[str, EditSlotEntry]:
    """fallback 경로용 빈 슬롯 5개 — 모두 preserve + 빈 note."""
    keys = PERSON_SLOTS if domain == "person" else OBJECT_SCENE_SLOTS
    return {k: EditSlotEntry(action="preserve", note="") for k in keys}


def _coerce_domain(raw: Any) -> str:
    """domain 정규화 — 알 수 없으면 'object_scene' 기본."""
    s = _coerce_str(raw).lower()
    return s if s in VALID_DOMAINS else "object_scene"


def _coerce_action(raw: Any) -> str:
    """action 정규화 — edit/preserve 외 값은 모두 'preserve' 기본."""
    s = _coerce_str(raw).lower()
    return s if s in VALID_ACTIONS else "preserve"


def _coerce_slots(raw: Any, domain: str) -> dict[str, EditSlotEntry]:
    """슬롯 매트릭스 정규화 — 도메인 키 5개 강제, 누락은 preserve+빈 note."""
    keys = PERSON_SLOTS if domain == "person" else OBJECT_SCENE_SLOTS
    out: dict[str, EditSlotEntry] = {}
    raw_dict = raw if isinstance(raw, dict) else {}
    for key in keys:
        item = raw_dict.get(key)
        if isinstance(item, dict):
            out[key] = EditSlotEntry(
                action=_coerce_action(item.get("action")),
                note=_coerce_str(item.get("note")),
            )
        else:
            out[key] = EditSlotEntry(action="preserve", note="")
    return out


async def _call_vision_edit_source(
    image_bytes: bytes,
    edit_intent: str,
    *,
    vision_model: str,
    timeout: float,
    ollama_url: str,
    width: int = 0,
    height: int = 0,
) -> str:
    """qwen2.5vl 에 SOURCE 이미지 + 정제된 영어 intent → raw 응답 문자열.

    Ollama format=json 옵션으로 JSON 안정화. 실패 시 빈 문자열 (호출자 fallback).

    spec 19 (2026-04-26 · Codex #9): width/height 가 알려져 있으면 user message
    첫 줄에 명시 → Vision Recipe v2.1 의 검증된 패턴. 모델이 layout/composition
    추측 안 해도 됨 (특히 16:9 / 9:16 / 1:1 분기).
    """
    # intent 600자 cap (너무 긴 정제 결과 방어)
    intent_clean = (edit_intent or "").strip()[:600]
    system_content = EDIT_VISION_ANALYSIS_SYSTEM.replace(
        "{edit_intent}", intent_clean or "(no edit intent provided)"
    )

    user_lines: list[str] = []
    if width > 0 and height > 0:
        user_lines.append(
            f"Source image attached. Aspect: {width}×{height} ({_c._aspect_label(width, height)})."
        )
    user_lines.append(
        "Classify the domain, then fill all 5 slots for that domain. "
        "Return STRICT JSON only."
    )
    user_content = "\n".join(user_lines)
    payload = {
        "model": vision_model,
        "messages": [
            {"role": "system", "content": system_content},
            {
                "role": "user",
                "content": user_content,
                "images": [_c._to_base64(image_bytes)],
            },
        ],
        "stream": False,
        "format": "json",
        # 2026-04-26: VRAM 즉시 반납
        "keep_alive": "0",
        "options": {"temperature": 0.3, "num_ctx": 8192},
    }
    try:
        return await call_chat_payload(
            ollama_url=ollama_url,
            payload=payload,
            timeout=timeout,
        )
    except Exception as e:
        _c.log.warning("edit-source vision call failed (%s): %s", vision_model, e)
        return ""


async def analyze_edit_source(
    image_bytes: bytes,
    edit_instruction: str,
    *,
    vision_model: str | None = None,
    text_model: str | None = None,
    ollama_url: str | None = None,
    timeout: float = _c.DEFAULT_TIMEOUT,
    refined_intent: str | None = None,
    width: int = 0,
    height: int = 0,
) -> EditVisionAnalysis:
    """SOURCE 이미지 + 사용자 수정 지시 → 도메인별 5 슬롯 매트릭스 분석.

    흐름:
      1) refined_intent 가 명시되지 않았으면 clarify_edit_intent 호출 (gemma4 정제)
      2) 정제 intent 를 SYSTEM 프롬프트에 주입해 qwen2.5vl 비전 호출
      3) JSON 파싱 + 슬롯 매트릭스 정규화
      4) 어느 단계든 실패해도 동일 shape (fallback=True) 반환

    Args:
        image_bytes: PIL 호환 바이트
        edit_instruction: 사용자 자연어 수정 지시 (한/영)
        vision_model: 기본 settings.visionModel (qwen2.5vl:7b)
        text_model: gemma4 정제용 (기본 gemma4-un:latest)
        ollama_url: 기본 settings.ollama_url
        timeout: httpx 타임아웃
        refined_intent: 외부에서 이미 정제된 intent 가 있으면 재호출 스킵

    Returns:
        EditVisionAnalysis — fallback=True 경로도 slots 5개 모두 preserve+빈 note.
    """
    # text_model 은 lazy import 우회 — clarify_edit_intent 가 prompt_pipeline.translate 에 있음
    # Phase 4.3 단계 4 (codex C2 fix): facade 가 아니라 submodule 직접 import.
    from ..prompt_pipeline.translate import clarify_edit_intent

    resolved_vision = vision_model or DEFAULT_OLLAMA_ROLES.vision
    resolved_text = text_model or DEFAULT_OLLAMA_ROLES.text
    resolved_url = ollama_url or _c._DEFAULT_OLLAMA_URL

    # ── 0단계: 의도 정제 (gemma4) ──
    if refined_intent is None:
        intent = await clarify_edit_intent(
            edit_instruction,
            model=resolved_text,
            timeout=60.0,
            ollama_url=resolved_url,
        )
    else:
        intent = refined_intent.strip()

    # ── 1단계: 비전 호출 ──
    raw = await _call_vision_edit_source(
        image_bytes,
        intent or edit_instruction,  # 정제 실패 시 원문으로 폴백
        vision_model=resolved_vision,
        timeout=timeout,
        ollama_url=resolved_url,
        width=width,
        height=height,
    )
    if not raw:
        return EditVisionAnalysis(
            domain="object_scene",
            intent=intent,
            summary="Vision model unavailable.",
            slots=_empty_fallback_slots("object_scene"),
            provider="fallback",
            fallback=True,
            analyzed_at=int(time.time() * 1000),
            vision_model=resolved_vision,
        )

    # ── 2단계: JSON 파싱 ──
    parsed = _parse_strict_json(raw)
    if parsed is None:
        _c.log.warning("edit-source JSON parse failed; raw head: %s", raw[:200])
        return EditVisionAnalysis(
            domain="object_scene",
            intent=intent,
            summary="Vision response parse failed.",
            slots=_empty_fallback_slots("object_scene"),
            provider="fallback",
            fallback=True,
            analyzed_at=int(time.time() * 1000),
            vision_model=resolved_vision,
        )

    # ── 3단계: domain + slots 정규화 ──
    domain = _coerce_domain(parsed.get("domain"))
    slots = _coerce_slots(parsed.get("slots"), domain)
    summary = _coerce_str(parsed.get("summary"))

    return EditVisionAnalysis(
        domain=domain,
        intent=intent,
        summary=summary,
        slots=slots,
        provider="ollama",
        fallback=False,
        analyzed_at=int(time.time() * 1000),
        vision_model=resolved_vision,
    )
