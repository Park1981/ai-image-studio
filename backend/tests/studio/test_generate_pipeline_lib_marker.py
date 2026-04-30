"""<lib>...</lib> 마커 deterministic strip 검증 — 3 input 케이스.

2026-04-30 (Phase 2B Task 9 · Codex v3 #3).

Codex v3 #3 fix: 옛 4번째 placeholder 케이스는 제거 (위험).
deterministic strip 의 input/output 검증 3 케이스 + 실제 pipeline 통합 검증은
E2E (Task 10) 시각 확인으로 충족.
"""

from __future__ import annotations

from studio._lib_marker import strip_library_markers


def test_strip_handles_lib_in_normal_gemma_output() -> None:
    """gemma4 가 마커 그대로 반환해도 strip 됨."""
    gemma = "a beautiful korean girl, <lib>cinematic 35mm</lib>, warm light"
    assert "<lib>" not in strip_library_markers(gemma)
    assert "cinematic 35mm" in strip_library_markers(gemma)


def test_strip_handles_lib_in_fallback_prompt() -> None:
    """Ollama fallback (원본 그대로) 시에도 strip 됨."""
    fallback = "한국 여자 <lib>cinematic 35mm</lib> 미소"
    assert "<lib>" not in strip_library_markers(fallback)
    assert "cinematic 35mm" in strip_library_markers(fallback)


def test_strip_handles_lib_in_pre_upgraded_prompt() -> None:
    """사용자 사전 확정 prompt 도 strip 됨."""
    pre = "<lib>delicate korean girl</lib>, soft window light"
    assert "<lib>" not in strip_library_markers(pre)
    assert "delicate korean girl" in strip_library_markers(pre)
