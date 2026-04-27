"""
_errors.py — Studio 도메인 예외 (leaf 모듈 · 의존성 없음).

2026-04-27 (Claude G): 외부 시스템 호출 실패를 도메인별로 분류해 호출자가
세분화된 처리를 할 수 있도록 함. 기존 코드는 RuntimeError / ValueError /
httpx 원시 예외를 광범위하게 raise — 호출자가 except Exception 으로
전부 흡수하는 패턴이라 분류가 어려웠음.

도입 단계:
  1) (이번 patch) 클래스 정의 + Ollama HTTP 헬퍼만 wrap.
     - 모든 클래스가 Exception 자손이라 기존 except Exception 호환 100%.
     - 신규 코드는 except OllamaError / ComfyError 로 더 정밀한 분기 가능.
  2) (차후) 호출부 점진 갱신 — log 메시지 + 사용자 toast 분류.

분류 정책:
  - StudioError: 모든 도메인 예외의 base.
  - OllamaError: /api/chat, /api/generate, /api/ps 호출 실패.
  - ComfyError: ComfyUI HTTP/WS 호출 실패.
"""

from __future__ import annotations


class StudioError(Exception):
    """Studio 도메인 예외 base — 모든 OllamaError/ComfyError 의 부모."""


class OllamaError(StudioError):
    """Ollama HTTP 호출 실패 (네트워크/타임아웃/응답 형식 오류)."""


class ComfyError(StudioError):
    """ComfyUI HTTP/WS 호출 실패 (디스패치/listen/다운로드)."""
