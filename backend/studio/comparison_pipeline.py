"""
comparison_pipeline.py - Edit 결과 vs 원본 비교 분석 (qwen2.5vl multi-image).

흐름:
1. SOURCE + RESULT 두 이미지를 qwen2.5vl 에 동시 전달 (Ollama messages.images 배열)
2. SYSTEM_COMPARE 가 5축 점수 (0-100) + 코멘트 + summary 를 STRICT JSON 으로 강제
3. _parse_strict_json() 로 점수/코멘트 추출 (누락 점수는 null 보존)
4. gemma4-un (think:False) 로 5축 코멘트 + summary 를 한 번에 한국어 번역
5. ComparisonAnalysisResult 반환 — fallback 경로도 항상 같은 shape 유지

비전 호출 실패 시 → fallback=True, scores 전부 null, summary 에 사유 명시.
번역만 실패 시 → comments_ko = comments_en (그대로), summary_ko = "한글 번역 실패".
"""

from __future__ import annotations

import base64
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from .presets import DEFAULT_OLLAMA_ROLES
from .prompt_pipeline import _DEFAULT_OLLAMA_URL, DEFAULT_TIMEOUT

log = logging.getLogger(__name__)

# 5축 키 — 순서 고정 (UI 막대 순서와 일치)
AXES: tuple[str, str, str, str, str] = (
    "face_id",
    "body_pose",
    "attire",
    "background",
    "intent_fidelity",
)

# 비전 응답 강제 — STRICT JSON only
SYSTEM_COMPARE = """You are a vision evaluator comparing TWO images of the same scene:
  SOURCE = original image (before user edit)
  RESULT = edited image (after user edit)

The user's edit instruction was: "{edit_prompt}"

Evaluate identity preservation and intent fidelity on FIVE axes.
Score each axis 0-100 (integer):
  - face_id: identity preservation of person's face (eyes, nose, jaw,
    overall facial structure). 100 = identical, 0 = entirely different person.
  - body_pose: body shape, proportions, and pose preservation.
  - attire: clothing/nudity state vs the user's intent. 100 = exactly as
    requested, 0 = entirely opposite to request.
  - background: unintended background changes. 100 = background fully
    preserved, 0 = background completely different.
  - intent_fidelity: how faithfully the result follows the edit prompt.

Write a 1-2 sentence comment per axis (English).
Then write a 3-5 sentence overall summary (English).

Return STRICT JSON only (no markdown, no preamble, no trailing text):
{
  "scores": {
    "face_id": <int>, "body_pose": <int>, "attire": <int>,
    "background": <int>, "intent_fidelity": <int>
  },
  "comments": {
    "face_id": "<en>", "body_pose": "<en>", "attire": "<en>",
    "background": "<en>", "intent_fidelity": "<en>"
  },
  "summary": "<en, 3-5 sentences>"
}"""


@dataclass
class ComparisonAnalysisResult:
    """analyze_pair() 결과 — DB 저장용 dict 와 같은 shape (camelCase 매핑은 호출처)."""

    scores: dict[str, int | None] = field(default_factory=dict)
    overall: int = 0
    comments_en: dict[str, str] = field(default_factory=dict)
    comments_ko: dict[str, str] = field(default_factory=dict)
    summary_en: str = ""
    summary_ko: str = ""
    provider: str = "fallback"  # "ollama" | "fallback"
    fallback: bool = True
    analyzed_at: int = 0
    vision_model: str = ""

    def to_dict(self) -> dict[str, Any]:
        """API 응답 / DB 저장용 직렬화 (camelCase 일부 매핑)."""
        return {
            "scores": self.scores,
            "overall": self.overall,
            "comments_en": self.comments_en,
            "comments_ko": self.comments_ko,
            "summary_en": self.summary_en,
            "summary_ko": self.summary_ko,
            "provider": self.provider,
            "fallback": self.fallback,
            "analyzedAt": self.analyzed_at,
            "visionModel": self.vision_model,
        }


def _empty_scores() -> dict[str, int | None]:
    """fallback 시 모든 축 null 로 초기화."""
    return {k: None for k in AXES}


def _empty_comments() -> dict[str, str]:
    """모든 축 빈 문자열로 초기화."""
    return {k: "" for k in AXES}


def _to_b64(data: bytes) -> str:
    """바이트를 base64 ASCII 문자열로 변환 (Ollama images 배열 형식)."""
    return base64.b64encode(data).decode("ascii")


async def _call_vision_pair(
    source_bytes: bytes,
    result_bytes: bytes,
    edit_prompt: str,
    *,
    vision_model: str,
    timeout: float,
    ollama_url: str,
) -> str:
    """qwen2.5vl 에 두 이미지 동시 전달 → raw 응답 문자열.

    Ollama /api/chat messages.images 배열에 SOURCE, RESULT 순서로 담음.
    실패 시 빈 문자열 반환 (예외는 위로 안 올림 — analyze_pair 가 fallback 처리).
    """
    payload = {
        "model": vision_model,
        "messages": [
            {
                "role": "system",
                "content": SYSTEM_COMPARE.replace("{edit_prompt}", edit_prompt[:400]),
            },
            {
                "role": "user",
                "content": (
                    "Image 1 = SOURCE (original).\n"
                    "Image 2 = RESULT (edited).\n"
                    "Evaluate now. Return STRICT JSON only."
                ),
                # qwen2.5vl Ollama API: images 배열에 순서대로 base64 전달
                "images": [_to_b64(source_bytes), _to_b64(result_bytes)],
            },
        ],
        "stream": False,
        "options": {"temperature": 0.3, "num_ctx": 8192},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(f"{ollama_url}/api/chat", json=payload)
            res.raise_for_status()
            data = res.json()
            return ((data.get("message") or {}).get("content") or "").strip()
    except Exception as e:
        log.warning("compare vision call failed (%s): %s", vision_model, e)
        return ""


def _parse_strict_json(raw: str) -> dict[str, Any] | None:
    """비전 응답에서 첫 번째 JSON object 추출 → dict, 실패 시 None.

    qwen2.5vl 이 가끔 ```json ... ``` 펜스를 두르거나 JSON 뒤에 자연어 코멘트
    (예: "{...} Confidence: high") 를 붙임. 따라서:
      1) ``` 펜스 제거
      2) 첫 '{' 부터 brace depth 가 0 이 되는 첫 '}' 까지 균형 매칭
      3) json.loads — 실패 시 None
    """
    if not raw:
        return None
    # ``` 펜스 제거
    cleaned = re.sub(r"```(?:json)?\s*", "", raw, flags=re.IGNORECASE).rstrip("`").strip()
    # 첫 '{' 위치 탐색
    start = cleaned.find("{")
    if start == -1:
        return None
    # balanced-brace 탐색 — depth 가 0 이 되는 첫 '}' 까지만 추출
    depth = 0
    for i in range(start, len(cleaned)):
        ch = cleaned[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(cleaned[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None  # 균형 안 맞으면 (열린 채 끝남) None


def _coerce_scores(raw_scores: Any) -> dict[str, int | None]:
    """5축 점수 dict 정규화 — 누락 / 비정수 → None, 범위는 0-100 클램프."""
    out: dict[str, int | None] = _empty_scores()
    if not isinstance(raw_scores, dict):
        return out
    for axis in AXES:
        val = raw_scores.get(axis)
        if isinstance(val, bool):  # bool 은 int 의 subclass — 명시 제외
            continue
        if isinstance(val, (int, float)):
            out[axis] = max(0, min(100, int(val)))
    return out


def _coerce_comments(raw_comments: Any) -> dict[str, str]:
    """5축 코멘트 dict 정규화 — 누락 → 빈 문자열, strip 적용."""
    out: dict[str, str] = _empty_comments()
    if not isinstance(raw_comments, dict):
        return out
    for axis in AXES:
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


# 한국어 번역 묶음 — 5축 코멘트 + summary 를 한 번에 보내고 섹션 헤더로 분리
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
) -> dict[str, Any] | None:
    """5축 코멘트 + summary 를 한 호출로 번역 (gemma4-un, think:False). 실패 시 None.

    Returns:
        {"comments_ko": {axis: ko_text, ...}, "summary_ko": str} or None
    """
    # 번역할 섹션 묶음 구성
    sections: list[str] = []
    for axis in AXES:
        text = comments_en.get(axis, "").strip()
        if text:
            sections.append(f"[{axis}]\n{text}")
    if summary_en.strip():
        sections.append(f"[summary]\n{summary_en.strip()}")
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
        "options": {"temperature": 0.4, "num_ctx": 4096, "num_predict": 800},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(f"{ollama_url}/api/chat", json=payload)
            res.raise_for_status()
            data = res.json()
            raw = ((data.get("message") or {}).get("content") or "").strip()
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
    # 짝수 인덱스(1,3,5,...) = 키, 홀수 인덱스(2,4,6,...) = 값
    for i in range(1, len(sections_ko) - 1, 2):
        # 모델이 대문자/혼합 케이스로 응답해도 lower() 로 정규화
        key = sections_ko[i].strip().lower()
        val = sections_ko[i + 1].strip()
        if key == "summary":
            summary_ko = val
        elif key in AXES:
            comments_ko[key] = val
    return {"comments_ko": comments_ko, "summary_ko": summary_ko}


async def analyze_pair(
    source_bytes: bytes,
    result_bytes: bytes,
    edit_prompt: str,
    *,
    vision_model: str | None = None,
    text_model: str | None = None,
    ollama_url: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> ComparisonAnalysisResult:
    """SOURCE + RESULT 비교 분석 (HTTP 200 원칙 — 항상 결과 dataclass 반환).

    Args:
        source_bytes / result_bytes: PIL 로 읽기 가능한 이미지 바이트
        edit_prompt: 사용자가 친 수정 지시 (시스템 프롬프트에 주입)
        vision_model: 기본 settings.visionModel (qwen2.5vl:7b)
        text_model: 번역용 (기본 gemma4-un:latest)

    Returns:
        ComparisonAnalysisResult — 모든 fallback 경로도 동일 shape 보장.
    """
    # 모델/URL 기본값 해석
    resolved_vision = vision_model or DEFAULT_OLLAMA_ROLES.vision
    resolved_text = text_model or DEFAULT_OLLAMA_ROLES.text
    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL

    # ── 1단계: 비전 호출 ──
    raw = await _call_vision_pair(
        source_bytes,
        result_bytes,
        edit_prompt,
        vision_model=resolved_vision,
        timeout=timeout,
        ollama_url=resolved_url,
    )
    if not raw:
        # 비전 호출 자체 실패 → 번역도 불필요
        return ComparisonAnalysisResult(
            scores=_empty_scores(),
            comments_en=_empty_comments(),
            comments_ko=_empty_comments(),
            summary_en="Vision model unavailable.",
            summary_ko="비전 모델 응답 없음.",
            provider="fallback",
            fallback=True,
            analyzed_at=int(time.time() * 1000),
            vision_model=resolved_vision,
        )

    # ── 2단계: JSON 파싱 ──
    parsed = _parse_strict_json(raw)
    if parsed is None:
        log.warning("compare JSON parse failed; raw head: %s", raw[:200])
        return ComparisonAnalysisResult(
            scores=_empty_scores(),
            comments_en=_empty_comments(),
            comments_ko=_empty_comments(),
            summary_en="Vision response parse failed.",
            summary_ko="비전 응답 파싱 실패.",
            provider="fallback",
            fallback=True,
            analyzed_at=int(time.time() * 1000),
            vision_model=resolved_vision,
        )

    # ── 3단계: 점수/코멘트 정규화 ──
    scores = _coerce_scores(parsed.get("scores"))
    comments_en = _coerce_comments(parsed.get("comments"))
    summary_raw = parsed.get("summary")
    summary_en = summary_raw.strip() if isinstance(summary_raw, str) else ""
    overall = _compute_overall(scores)

    # ── 4단계: 한글 번역 (실패해도 en 으로 폴백) ──
    translation = await _translate_comments_to_ko(
        comments_en,
        summary_en,
        text_model=resolved_text,
        timeout=60.0,  # 번역은 짧은 텍스트라 60s 충분
        ollama_url=resolved_url,
    )
    if translation is None:
        # 번역 실패 — comments 는 en 그대로, summary 에 마커
        comments_ko = dict(comments_en)
        summary_ko = "한글 번역 실패"
    else:
        # 번역 누락된 축은 en 으로 폴백
        comments_ko = {
            axis: translation["comments_ko"].get(axis) or comments_en.get(axis, "")
            for axis in AXES
        }
        summary_ko = translation["summary_ko"] or summary_en

    return ComparisonAnalysisResult(
        scores=scores,
        overall=overall,
        comments_en=comments_en,
        comments_ko=comments_ko,
        summary_en=summary_en,
        summary_ko=summary_ko,
        provider="ollama",
        fallback=False,
        analyzed_at=int(time.time() * 1000),
        vision_model=resolved_vision,
    )
