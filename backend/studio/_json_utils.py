"""
_json_utils.py - 비전 응답 JSON 파싱 공용 유틸 (leaf module).

vision_pipeline.py / comparison_pipeline.py 둘 다 동일 로직을 사본으로 갖고
있어 유지보수 위험이 있어 (한 쪽 고치면 다른 쪽 잊을 위험) leaf 모듈로 통합.
이 모듈은 다른 studio/* 모듈에 의존하지 않음 → 순환 import 안전.

2026-04-26 spec 19: 시스템 프롬프트 점검 후속.
"""

from __future__ import annotations

import json
import re
from typing import Any


def parse_strict_json(raw: str) -> dict[str, Any] | None:
    """비전 응답에서 첫 번째 JSON object 추출 → dict, 실패 시 None.

    qwen2.5vl 이 가끔 ```json ... ``` 펜스를 두르거나 JSON 뒤에 자연어 코멘트
    (예: "{...} Confidence: high") 를 붙여. 따라서:
      1) ``` 펜스 제거
      2) 첫 '{' 부터 brace depth 가 0 이 되는 첫 '}' 까지 균형 매칭
      3) json.loads — 실패 시 None

    spec 19 후속 (Codex 권고): quoted-string aware scanner.
    이전엔 brace depth 만 셌어서 문자열 값 안에 `{` 또는 `}` 가 포함되면
    (예: "transform_prompt": "shift gaze {upward}") 균형이 어긋나 파싱 실패.
    이제 in_string 상태 + backslash escape 추적해서 문자열 안의 brace 무시.
    """
    if not raw:
        return None
    cleaned = re.sub(r"```(?:json)?\s*", "", raw, flags=re.IGNORECASE).rstrip("`").strip()
    start = cleaned.find("{")
    if start == -1:
        return None

    depth = 0
    in_string = False
    escape_next = False  # 직전 문자가 backslash 인지

    for i in range(start, len(cleaned)):
        ch = cleaned[i]

        # 문자열 안의 escape 처리 (예: \" / \\) — 다음 한 글자 무조건 skip
        if escape_next:
            escape_next = False
            continue

        if in_string:
            if ch == "\\":
                escape_next = True
            elif ch == '"':
                in_string = False
            # in_string 안에선 brace depth 변화 무시
            continue

        # 문자열 밖 — brace depth 또는 문자열 진입 추적
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(cleaned[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def coerce_str(v: Any) -> str:
    """None / 비문자 → ''."""
    if isinstance(v, str):
        return v.strip()
    return ""
