"""
prompt_pipeline._common — 모든 sub-module 이 공유하는 데이터 + 유틸.

UpgradeResult dataclass / _strip_repeat_noise / _DEFAULT_OLLAMA_URL / DEFAULT_TIMEOUT / log.

Phase 4.3 단계 2 (2026-04-30) 분리 — sub-module 들은 `from . import _common as _c`
패턴으로 직접 import 한다 (옵션 D · Phase 4.2 와 동일).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Literal, TypedDict

log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# Phase 2 (2026-05-01) — Prompt enhance 모드 enum + 옵션 resolver.
# ═══════════════════════════════════════════════════════════════════════
PromptEnhanceMode = Literal["fast", "precise"]


class _ModeOptions(TypedDict):
    """`_resolve_mode_options` 의 반환 형태 — `_call_ollama_chat` 에 그대로 전달."""

    think: bool
    num_predict: int
    timeout: float


# 정밀 모드는 timeout 을 *최소* 보장값으로 끌어올린다 (caller timeout 이 더 크면 그대로).
PRECISE_MIN_TIMEOUT = 120.0
PRECISE_NUM_PREDICT = 4096
FAST_NUM_PREDICT = 800


def _resolve_mode_options(
    mode: PromptEnhanceMode | str | None,
    *,
    base_timeout: float,
) -> _ModeOptions:
    """모드 → think / num_predict / timeout 묶음.

    - `"fast"` (기본 / 미인식 값 / None): 기존 동작 — think=False, num_predict=800, timeout 그대로.
    - `"precise"`: think=True, num_predict=4096, timeout=max(base_timeout, 120s).

    base_timeout 은 caller 의 timeout 인자. 정밀 모드라도 호출자가 더 큰 값을 명시했다면
    그대로 보존. 짧은 caller timeout 만 강제로 120s 하한 적용.
    """
    if mode == "precise":
        return _ModeOptions(
            think=True,
            num_predict=PRECISE_NUM_PREDICT,
            timeout=max(base_timeout, PRECISE_MIN_TIMEOUT),
        )
    # fast / unknown / None 은 모두 fast 로 정규화
    return _ModeOptions(
        think=False,
        num_predict=FAST_NUM_PREDICT,
        timeout=base_timeout,
    )

# Ollama URL 은 .env/config.py 에서만 읽는다 (하드코딩 금지 규칙).
# 테스트 환경에서 config import 가 실패할 수 있으므로 try/except 폴백만 허용.
try:
    from config import settings  # type: ignore

    _DEFAULT_OLLAMA_URL: str = settings.ollama_url
except Exception:  # pragma: no cover - 테스트/독립 실행 환경
    _DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"

# 16GB VRAM 환경에서 gemma4-un(25.2B) 첫 로드 30~60s 여유 필요.
# 이후 호출은 빠름. 환경에 따라 .env 로 조정 가능하도록 추후 이동.
# 2026-04-24: 120 → 240 로 상향 — cold start + num_predict=800 조합에서
# 간혹 ReadTimeout 으로 fallback 빠지는 이슈 대응.
DEFAULT_TIMEOUT = 240.0


@dataclass
class UpgradeResult:
    """프롬프트 업그레이드 결과."""

    upgraded: str
    """최종 영문 프롬프트."""

    fallback: bool
    """True 면 Ollama 실패로 원본을 그대로 반환한 상태."""

    provider: str
    """'ollama' | 'fallback' | 'fallback-precise-failed' | 'pre-confirmed'.

    Phase 2 (2026-05-01) 신규: `'fallback-precise-failed'` 는 정밀 모드 호출이 실패해
    원본으로 폴백한 케이스. UI 가 빠른 모드 자동 재시도/원본 안내를 분기하는 데 사용.
    """

    original: str
    """사용자 원본 프롬프트."""

    translation: str | None = None
    """업그레이드된 영문 프롬프트의 한국어 번역 (v2 · 2026-04-23).
    JSON 파싱 실패 또는 fallback 시 None."""


def _strip_repeat_noise(s: str) -> str:
    """모델이 loop 에 빠져 내뱉는 반복 문자/토큰/구 제거.

    탐지 케이스:
      1. 같은 문자 12번+ 연속 (예: ||||||||||)
      2. 같은 단어 8번+ 연속 (예: larger larger larger ...)
      3. 짧은 구 3번+ 반복 (예: a park-like a park-like a park-like ...)
    매치 시점부터 뒤를 전부 잘라낸다.
    """
    if not s:
        return s
    candidates: list[int] = []
    # 1) 같은 문자 12번+ 연속
    m = re.search(r"(.)\1{11,}", s)
    if m:
        candidates.append(m.start())
    # 2) 같은 단어 8번+ 연속
    m2 = re.search(r"\b(\w{2,20})(\s+\1){7,}", s)
    if m2:
        candidates.append(m2.start())
    # 3) 2~5 단어 구가 3번+ 반복 (하이픈·특수문자도 포함해서 매치)
    # 예: "a park-like a park-like a park-like" — 공백 기준 토큰이 2~5개 반복
    m3 = re.search(
        r"(\b[\w-]+(?:\s+[\w-]+){1,4})(?:\s+\1){2,}", s
    )
    if m3:
        candidates.append(m3.start())

    if candidates:
        s = s[: min(candidates)]
    return s.rstrip()
