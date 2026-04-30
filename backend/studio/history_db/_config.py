"""
history_db/_config.py — DB 경로 + 임시 풀 URL prefix + logger 단일 source.

Phase 4.1 단계 2 (codex C2 fix · facade alias 제거 정책):
  - 모든 sub-module 이 `from . import _config as _cfg` import + 함수 본문에서
    `_cfg._DB_PATH` attribute 접근 (binding 시점 고정 회피).
  - monkeypatch + 직접 read 모두 `studio.history_db._config._DB_PATH` 단일 target.
  - facade `__init__.py` 가 `_DB_PATH` re-export 하지 않음 (sync 함정 차단).

run-time 설정 lookup:
  - production: `config.settings.history_db_path` (uvicorn 기동 시 로드)
  - test: `monkeypatch.setattr("studio.history_db._config._DB_PATH", str(tmp_db))`
  - fallback: `./data/history.db` (config 모듈 로드 실패 시)
"""

from __future__ import annotations

import logging

try:
    from config import settings  # type: ignore

    _DB_PATH = settings.history_db_path
except Exception:
    _DB_PATH = "./data/history.db"


# 임시 풀 URL prefix — reference_pool 모듈과 동기. 순환 import 회피 위해 *문자열 상수로 직접 박음*.
# (reference_pool.POOL_URL_PREFIX 와 항상 동일해야 함 — Codex C6 정책)
_POOL_URL_PREFIX = "/images/studio/reference-pool/"


# logger 는 패키지명 기반 (__name__ = "studio.history_db._config" 가 아닌 합성된 이름).
# sub-module 이 동일 logger 공유하도록 명시 이름 사용.
log = logging.getLogger("studio.history_db")
