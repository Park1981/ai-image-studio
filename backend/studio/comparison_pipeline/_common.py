"""
comparison_pipeline._common — v3 + v2_generic 공용 데이터/헬퍼.

axes 정의 / dataclass / 5축 generic 처리 헬퍼 / Ollama 번역 호출까지 응집.
v3 (analyze_pair) + v2_generic (analyze_pair_generic) 둘 다 import.

Phase 4.4 단계 2 (2026-04-30) 분리.
"""

from __future__ import annotations

import base64
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from .._json_utils import coerce_score as _coerce_score  # noqa: F401 — facade alias
from .._json_utils import parse_strict_json as _parse_strict_json  # noqa: F401 — facade alias
from .._ollama_client import call_chat_payload

log = logging.getLogger(__name__)

# 5축 키 — Edit context 전용 (순서 고정 · UI 막대 순서와 일치).
# spec 16: 사전 분석 PERSON_SLOTS / OBJECT_SCENE_SLOTS 와 동일하게 정렬.
PERSON_AXES: tuple[str, str, str, str, str] = (
    "face_expression",
    "hair",
    "attire",
    "body_pose",
    "background",
)
OBJECT_SCENE_AXES: tuple[str, str, str, str, str] = (
    "subject",
    "color_material",
    "layout_composition",
    "background_setting",
    "mood_style",
)

# 옛 5축 (호환용 · 폐기 예정 · analyze_pair_generic 의 COMPARE_AXES 와 다름)
LEGACY_EDIT_AXES: tuple[str, str, str, str, str] = (
    "face_id",
    "body_pose",
    "attire",
    "background",
    "intent_fidelity",
)
# 하위 호환을 위해 AXES alias 유지 — analyze_pair_generic 등이 default 값으로 사용.
# 새 analyze_pair 는 도메인 동적 결정.
AXES: tuple[str, str, str, str, str] = LEGACY_EDIT_AXES

# 5축 키 — Vision Compare context 전용 (사용자가 임의로 고른 두 이미지)
COMPARE_AXES: tuple[str, str, str, str, str] = (
    "composition",
    "color",
    "subject",
    "mood",
    "quality",
)


@dataclass
class ComparisonSlotEntry:
    """v3 슬롯 엔트리 — intent + score + comment (en/ko 둘 다)."""

    intent: str = "preserve"  # "edit" | "preserve"
    score: int | None = None  # 0-100, fallback 시 None
    comment_en: str = ""
    comment_ko: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent": self.intent,
            "score": self.score,
            "commentEn": self.comment_en,
            "commentKo": self.comment_ko,
        }


@dataclass
class ComparisonAnalysisResult:
    """analyze_pair / analyze_pair_generic 공용 결과.

    v3 형식 (analyze_pair 만 사용):
      - domain + slots (인물 5 / 물체·풍경 5)
      - 점수 의미 = 의도 컨텍스트 (보존이면 유사도, 변경이면 의도부합도)

    옛 형식 (analyze_pair_generic 만 사용 · Vision Compare 메뉴):
      - scores + comments_en/ko + summary_en/ko (5축 유사도)

    to_dict() 가 두 형식 모두 직렬화 — 프론트가 키 셋으로 자동 분기.
    """

    # v3 신규 필드 (analyze_pair · spec 16)
    domain: str = ""  # "person" | "object_scene" | "" (옛 형식 또는 fallback)
    slots: dict[str, ComparisonSlotEntry] = field(default_factory=dict)

    # 옛 형식 (analyze_pair_generic + 호환용)
    scores: dict[str, int | None] = field(default_factory=dict)
    comments_en: dict[str, str] = field(default_factory=dict)
    comments_ko: dict[str, str] = field(default_factory=dict)

    overall: int = 0
    summary_en: str = ""
    summary_ko: str = ""

    # 2026-04-26 v2.1 / spec 19 (2026-04-26 후속) — edit/generic 공용 extra 필드.
    # 의미는 context 별로 다름:
    #   - analyze_pair_generic (Vision Compare): A 를 B 로 바꾸는 t2i 변형 지시
    #   - analyze_pair (Edit context · spec 19): 사용자 의도 부합도 잔여 작업
    #     (RESULT 가 의도를 완전히 실현하려면 추가로 필요한 변경)
    # uncertain 도 공용 — 비전이 신뢰성 있게 평가 못한 영역.
    transform_prompt_en: str = ""
    transform_prompt_ko: str = ""
    uncertain_en: str = ""
    uncertain_ko: str = ""

    provider: str = "fallback"  # "ollama" | "fallback"
    fallback: bool = True
    analyzed_at: int = 0
    vision_model: str = ""

    def to_dict(self) -> dict[str, Any]:
        """API 응답 / DB 저장용 직렬화. v3 와 옛 형식 모두 포함 — 프론트 자동 분기."""
        out: dict[str, Any] = {
            "overall": self.overall,
            "summary_en": self.summary_en,
            "summary_ko": self.summary_ko,
            "provider": self.provider,
            "fallback": self.fallback,
            "analyzedAt": self.analyzed_at,
            "visionModel": self.vision_model,
        }
        # v3 형식 — analyze_pair 가 채움
        if self.domain and self.slots:
            out["domain"] = self.domain
            out["slots"] = {k: v.to_dict() for k, v in self.slots.items()}
        # 옛 형식 — analyze_pair_generic 또는 fallback 시 채움
        if self.scores:
            out["scores"] = self.scores
        if self.comments_en:
            out["comments_en"] = self.comments_en
        if self.comments_ko:
            out["comments_ko"] = self.comments_ko
        # 2026-04-26 v2.1 / spec 19 — 공용 extra 필드 (값 있을 때만 포함)
        # edit context 와 generic context 가 의미만 다르고 키 이름은 동일.
        if self.transform_prompt_en:
            out["transform_prompt_en"] = self.transform_prompt_en
        if self.transform_prompt_ko:
            out["transform_prompt_ko"] = self.transform_prompt_ko
        if self.uncertain_en:
            out["uncertain_en"] = self.uncertain_en
        if self.uncertain_ko:
            out["uncertain_ko"] = self.uncertain_ko
        return out


def _empty_scores(axes: tuple[str, ...] = AXES) -> dict[str, int | None]:
    """fallback 시 모든 축 null 로 초기화. axes 기본값=AXES (edit 호출자 무영향)."""
    return {k: None for k in axes}


def _empty_comments(axes: tuple[str, ...] = AXES) -> dict[str, str]:
    """모든 축 빈 문자열로 초기화. axes 기본값=AXES (edit 호출자 무영향)."""
    return {k: "" for k in axes}


def _to_b64(data: bytes) -> str:
    """바이트를 base64 ASCII 문자열로 변환 (Ollama images 배열 형식)."""
    return base64.b64encode(data).decode("ascii")


def _coerce_scores(
    raw_scores: Any, axes: tuple[str, ...] = AXES
) -> dict[str, int | None]:
    """5축 점수 dict 정규화 — 누락 / 비정수 → None, 범위는 0-100 클램프.

    2026-04-26 (Codex 진단): _coerce_score 헬퍼 위임 → string 방어 일관 적용.
    """
    out: dict[str, int | None] = _empty_scores(axes)
    if not isinstance(raw_scores, dict):
        return out
    for axis in axes:
        coerced = _coerce_score(raw_scores.get(axis))
        if coerced is not None:
            out[axis] = coerced
    return out


def _coerce_comments(
    raw_comments: Any, axes: tuple[str, ...] = AXES
) -> dict[str, str]:
    """5축 코멘트 dict 정규화 — 누락 → 빈 문자열, strip 적용.
    axes 기본값=AXES (edit 호출자 무영향)."""
    out: dict[str, str] = _empty_comments(axes)
    if not isinstance(raw_comments, dict):
        return out
    for axis in axes:
        v = raw_comments.get(axis)
        if isinstance(v, str):
            out[axis] = v.strip()
    return out


def _compute_overall(scores: dict[str, int | None]) -> int:
    """5축 산술 평균 — None 제외. 모두 None 이면 0 반환."""
    valid = [v for v in scores.values() if v is not None]
    if not valid:
        return 0
    return round(sum(valid) / len(valid))


_TRANSLATE_SYSTEM = """You are a professional Korean translator.
You receive multiple short English texts, each prefixed with [section_name].
Translate each section into natural Korean. Keep the same [section_name]
prefix on each Korean section. Output ONLY the translated sections — no
preamble, no explanation. Use exactly this format:

[section_name]
<korean translation>

[section_name]
<korean translation>
...
"""


async def _translate_comments_to_ko(
    comments_en: dict[str, str],
    summary_en: str,
    *,
    text_model: str,
    timeout: float,
    ollama_url: str,
    axes: tuple[str, ...] = AXES,
    extra_sections: dict[str, str] | None = None,
) -> dict[str, Any] | None:
    """5축 코멘트 + summary + extra (transform_prompt / uncertain) 한 호출로 번역.

    gemma4-un, think:False. 실패 시 None.

    Args:
        extra_sections: 추가 번역 묶음 — {"transform_prompt": "...", "uncertain": "..."} 등.
            빈 문자열은 자동 스킵. 결과는 returned dict 의 "extra" 키에 같은 키로 들어감.

    Returns:
        {"comments_ko": {axis: ko_text, ...}, "summary_ko": str,
         "extra": {key: ko_text, ...}} or None.
    """
    # 번역할 섹션 묶음 구성
    sections: list[str] = []
    for axis in axes:
        text = comments_en.get(axis, "").strip()
        if text:
            sections.append(f"[{axis}]\n{text}")
    if summary_en.strip():
        sections.append(f"[summary]\n{summary_en.strip()}")
    # 2026-04-26 v2.1 — extra_sections (transform_prompt / uncertain 등)
    extra_keys: list[str] = []
    if extra_sections:
        for key, text in extra_sections.items():
            if text and text.strip():
                sections.append(f"[{key}]\n{text.strip()}")
                extra_keys.append(key)
    if not sections:
        return None

    user_msg = "\n\n".join(sections)
    payload = {
        "model": text_model,
        "messages": [
            {"role": "system", "content": _TRANSLATE_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        "stream": False,
        # CLAUDE.md 규칙: gemma4-un 은 reasoning 모델 → think:False 필수
        "think": False,
        # 2026-04-26: VRAM 즉시 반납
        "keep_alive": "0",
        "options": {"temperature": 0.4, "num_ctx": 4096, "num_predict": 800},
    }
    try:
        raw = await call_chat_payload(
            ollama_url=ollama_url,
            payload=payload,
            timeout=timeout,
        )
        if not raw:
            return None
    except Exception as e:
        log.info("compare translation failed (non-fatal): %s", e)
        return None

    # 섹션 파싱 — [axis_name] 패턴으로 split (대소문자 무시)
    # re.split 결과: ["", "axis1", "text1", "axis2", "text2", ...]
    sections_ko = re.split(r"\[([a-zA-Z_]+)\]\s*", raw)
    comments_ko: dict[str, str] = {}
    summary_ko = ""
    extra_ko: dict[str, str] = {}
    extra_keys_lower = {k.lower(): k for k in extra_keys}
    # 짝수 인덱스(1,3,5,...) = 키, 홀수 인덱스(2,4,6,...) = 값
    for i in range(1, len(sections_ko) - 1, 2):
        # 모델이 대문자/혼합 케이스로 응답해도 lower() 로 정규화
        key_lower = sections_ko[i].strip().lower()
        val = sections_ko[i + 1].strip()
        if key_lower == "summary":
            summary_ko = val
        elif key_lower in axes:
            comments_ko[key_lower] = val
        elif key_lower in extra_keys_lower:
            # 원본 키 케이스로 저장 (extra_sections 호출자와 동일 키)
            extra_ko[extra_keys_lower[key_lower]] = val
    return {
        "comments_ko": comments_ko,
        "summary_ko": summary_ko,
        "extra": extra_ko,
    }
