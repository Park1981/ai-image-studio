"""
studio.routes — task #17 (2026-04-26): router.py 풀 분해 2탄 (endpoint 그룹화).

router.py 가 921줄까지 줄었지만 여전히 endpoint 들이 한 파일에 모여있음.
본 패키지로 도메인별 분리:

  routes/_common.py    — 공용 SSE/태스크 유틸 (_stream_task, _spawn 등)
  routes/streams.py    — generate/edit/video 태스크 생성 + SSE 스트림
  routes/prompt.py     — upgrade-only + research + interrupt
  routes/prompt_favorites.py — 프롬프트 히스토리 즐겨찾기
  routes/vision.py     — vision-analyze (단일 이미지 분석)
  routes/compare.py    — compare-analyze (mutex + 2 context)
  routes/system.py     — process status / ollama models / process action / models / history

studio_router 단일 APIRouter 가 prefix="/api/studio" 로 모두 통합.
"""

from __future__ import annotations

from fastapi import APIRouter

from . import (
    compare,
    lab,
    prompt,
    prompt_favorites,
    reference_pool,
    reference_templates,
    streams,
    system,
    vision,
)

studio_router = APIRouter(prefix="/api/studio", tags=["studio"])

# 등록 순서는 임의 — FastAPI 가 path 매칭으로 분기.
# 다만 동일 path 충돌 방지 위해 그룹별 명시적 prefix 안 씀 (전부 /api/studio 직속).
studio_router.include_router(streams.router)
studio_router.include_router(lab.router)
studio_router.include_router(prompt.router)
studio_router.include_router(prompt_favorites.router)
studio_router.include_router(vision.router)
studio_router.include_router(compare.router)
studio_router.include_router(system.router)
# v8 (2026-04-28 라이브러리 plan): reference templates CRUD.
studio_router.include_router(reference_templates.router)
# v9 (2026-04-29 · Phase A.4): 임시 풀 stats / orphans / DELETE orphans.
studio_router.include_router(reference_pool.router)

__all__ = ["studio_router"]
