"""presets DEFAULT_OLLAMA_ROLES + resolve_ollama_keep_alive env var 동작 검증.

Phase 6 — env var 로 runtime 모델 swap + keep_alive 제어 가능한지 확인.
importlib.reload 사용 — module-level 상수가 import 시점에 평가되므로
env override 후 reload 해야 새 값 반영됨.
"""

import importlib

import pytest


def test_vision_model_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    """STUDIO_VISION_MODEL env var 설정 시 default 무시하고 그것 사용."""
    monkeypatch.setenv("STUDIO_VISION_MODEL", "qwen2.5vl:7b")
    # presets 모듈 reload — module-level constant 가 env 다시 읽음
    from studio import presets
    importlib.reload(presets)
    assert presets.DEFAULT_OLLAMA_ROLES.vision == "qwen2.5vl:7b"


def test_vision_model_default_when_env_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    """STUDIO_VISION_MODEL 없으면 default qwen3-vl:8b."""
    monkeypatch.delenv("STUDIO_VISION_MODEL", raising=False)
    from studio import presets
    importlib.reload(presets)
    assert presets.DEFAULT_OLLAMA_ROLES.vision == "qwen3-vl:8b"


def test_keep_alive_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    """STUDIO_OLLAMA_KEEP_ALIVE env var 우선 (default '5m')."""
    monkeypatch.setenv("STUDIO_OLLAMA_KEEP_ALIVE", "0")
    from studio import presets
    importlib.reload(presets)
    assert presets.resolve_ollama_keep_alive() == "0"

    monkeypatch.delenv("STUDIO_OLLAMA_KEEP_ALIVE", raising=False)
    importlib.reload(presets)
    assert presets.resolve_ollama_keep_alive() == "5m"
