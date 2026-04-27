from __future__ import annotations

import pytest


def test_mock_ref_raises_when_comfy_mock_fallback_disabled(monkeypatch) -> None:
    from studio.pipelines import _dispatch

    monkeypatch.setattr(_dispatch, "COMFY_MOCK_FALLBACK", False)

    with pytest.raises(RuntimeError, match="comfy down"):
        _dispatch._mock_ref_or_raise("comfy down")


def test_mock_ref_returns_seed_when_comfy_mock_fallback_enabled(monkeypatch) -> None:
    from studio.pipelines import _dispatch

    monkeypatch.setattr(_dispatch, "COMFY_MOCK_FALLBACK", True)

    assert _dispatch._mock_ref_or_raise("comfy down").startswith("mock-seed://")
