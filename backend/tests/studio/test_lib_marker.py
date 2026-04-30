"""strip_library_markers 단위 테스트 — 5 케이스.

2026-04-30 (Phase 2B Task 9 · Codex v3 #2).
"""

from __future__ import annotations

from studio._lib_marker import strip_library_markers


def test_strip_removes_all_markers() -> None:
    assert (
        strip_library_markers("a, <lib>cinematic 35mm</lib>, warm light")
        == "a, cinematic 35mm, warm light"
    )


def test_strip_preserves_inner_content() -> None:
    assert strip_library_markers("<lib>X</lib>") == "X"


def test_strip_handles_multiple_markers() -> None:
    text = "<lib>A</lib> <lib>B</lib> <lib>C</lib>"
    assert strip_library_markers(text) == "A B C"


def test_strip_no_markers_returns_original() -> None:
    assert strip_library_markers("plain text") == "plain text"


def test_strip_empty_string() -> None:
    assert strip_library_markers("") == ""
