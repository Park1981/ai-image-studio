"""Studio 도메인 타입 단일 진입점 (task #6 · 2026-04-26).

Frontend `lib/api/types.ts::StudioMode` 와 한쌍.
이전엔 router/pipeline 에 "generate"/"edit"/"video"/"vision" 문자열이 흩뿌려져 있어
오타 시 컴파일 차단 못함. 이 모듈로 점진 통일.

도입 정책: 신규 코드는 Mode/HistoryMode 사용. 기존 코드는 회귀 위험 없이
변경 가능한 시점에 점진 교체 (task #5 분해 작업과 함께).
"""

from __future__ import annotations

from typing import Literal

# 4 모드 (history 미저장 모드 포함)
Mode = Literal["generate", "edit", "video", "vision"]

# History DB 에 저장 가능한 모드 (vision 제외)
HistoryMode = Literal["generate", "edit", "video"]
