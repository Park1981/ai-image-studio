"""
_proc_mgr.py — services.process_manager 싱글톤 import 단일 진입점.

2026-04-27 (N1): routes/_common.py + pipelines/_dispatch.py 두 곳에서 동일한
try/except import 패턴이 중복돼 있던 것을 leaf 모듈 한 곳으로 통합.

레거시 services.process_manager 는 backend/legacy 격리 정책 예외로
backend/services/ 에 그대로 유지 — Studio 파이프라인이 idle shutdown 타이머 +
ComfyUI/Ollama 프로세스 제어에 의존하기 때문 (CLAUDE.md Rules 명시).

테스트 환경에서는 services 모듈 자체가 import 안 될 수 있어 None 폴백 +
호출자가 None 체크하는 패턴이 정착돼 있음 — 이 모듈도 그 정책 그대로 따름.
"""

from __future__ import annotations

from typing import Any

# Python module cache 가 동일 인스턴스 보장 — 여러 모듈에서 import 해도 1 instance.
try:
    from services.process_manager import process_manager as _instance  # type: ignore
except Exception:  # pragma: no cover - 테스트 환경
    _instance = None


process_manager: Any = _instance
"""레거시 process_manager 싱글톤 (테스트 환경 등에서 None 가능)."""
