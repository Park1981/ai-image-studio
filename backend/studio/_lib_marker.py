"""
_lib_marker — `<lib>...</lib>` 마커 deterministic 처리.

2026-04-30 (Phase 2B Task 9 · Codex v3 #2 · plan 2026-04-30-prompt-snippets-library.md).

frontend/lib/snippet-marker.ts 의 stripAllMarkers 와 동일 의도.
LLM 협조 (system prompt 지시) 뿐 아니라 deterministic 안전망을 두기 위해 백엔드의
4 위치에서 마커 잔존 시 강제 제거:
  1. upgrade_generate_prompt 의 UpgradeResult.upgraded
  2. ComfyUI dispatch 직전 final_prompt (이중 안전망)
  3. /api/studio/upgrade-only 응답의 upgradedPrompt
  4. history DB 저장 prompt (UI readability)
"""

from __future__ import annotations

OPEN = "<lib>"
CLOSE = "</lib>"


def strip_library_markers(text: str) -> str:
    """모든 `<lib>` / `</lib>` 토큰 제거 — 안 내용 보존.

    LLM 협조 (system prompt 지시) + deterministic 안전망 둘 다 동작.
    빈 문자열 / None-falsy 도 안전 (no-op).
    """
    if not text:
        return text
    return text.replace(OPEN, "").replace(CLOSE, "")
