"""
history_db — studio_history + reference_templates 테이블 access (SQLite · aiosqlite).

Phase 4.1 (2026-04-30) — 단일 파일 history_db.py (886줄) 를 sub-module 로 분할:
  - _config.py     — DB 경로 / URL prefix / logger 단일 source
  - schema.py      — DDL + 증분 마이그레이션 + init 진입점
  - items.py       — studio_history 행 단위 CRUD (insert/list/get/delete + update_comparison)
  - cascade.py     — cascade 삭제 + 임시 풀 ref cleanup helper
  - stats.py       — count + size 통계
  - templates.py   — reference_templates CRUD (라이브러리 plan v8)

본 facade `__init__.py` 는 외부 호환을 위해 모든 public 항목을 re-export.
sub-module 은 `from . import _config as _cfg` + `_cfg._DB_PATH` 패턴 (codex C2 fix · monkeypatch 친화).

Schema version: SCHEMA_VERSION = 9 (자세한 버전 이력은 schema.py docstring 참조).
"""

from __future__ import annotations

# Phase 4.1 단계 3.1 — schema 그룹 (DDL + migration + init).
from .schema import (  # noqa: F401
    CREATE_IDX_CREATED,
    CREATE_IDX_MODE,
    CREATE_IDX_PROMPT_FAVORITES_MODE,
    CREATE_IDX_REF_LASTUSED,
    CREATE_PROMPT_FAVORITES,
    CREATE_REFERENCE_TEMPLATES,
    CREATE_TABLE,
    SCHEMA_VERSION,
    _get_schema_version,
    _migrate_add_video_mode,
    _migrate_create_prompt_favorites,
    _migrate_create_reference_templates,
    _needs_video_mode_migration,
    _set_schema_version,
    init_studio_history_db,
)

# Phase 4.1 단계 3.2 — items 그룹 (행 단위 CRUD).
from .items import (  # noqa: F401
    _row_to_item,
    delete_item,
    get_item,
    insert_item,
    list_items,
    replace_reference_ref_if_current,
    update_comparison,
)

# Phase 4.1 단계 3.3 — cascade 그룹 (cascade 삭제 + 임시 풀 cleanup).
from .cascade import (  # noqa: F401
    _safe_pool_unlink,
    clear_all,
    clear_all_with_refs,
    count_image_ref_usage,
    count_pool_refs,
    count_source_ref_usage,
    delete_item_with_refs,
    list_history_pool_refs,
)

# Phase 4.1 단계 3.4 — stats 그룹 (count + size 통계).
from .stats import (  # noqa: F401
    count_items,
    get_stats,
)

# Phase 4.1 단계 3.5 — templates 그룹 (reference_templates CRUD).
from .templates import (  # noqa: F401
    _row_to_reference_template,
    delete_reference_template,
    get_reference_template,
    insert_reference_template,
    list_reference_templates,
    touch_reference_template,
)

# v9 (2026-05-11) — prompt_favorites CRUD.
from .prompt_favorites import (  # noqa: F401
    VALID_PROMPT_FAVORITE_MODES,
    _prompt_hash,
    _row_to_prompt_favorite,
    delete_prompt_favorite,
    get_prompt_favorite,
    list_prompt_favorites,
    upsert_prompt_favorite,
)


# 명시 export 목록 — 외부 도구가 `from studio.history_db import *` 시 노출 항목.
# 사용자 코드가 호출하는 항목만 (private helper / DDL 상수도 test 직접 import 패턴 보호 위해 포함).
__all__ = [
    # schema
    "CREATE_IDX_CREATED",
    "CREATE_IDX_MODE",
    "CREATE_IDX_PROMPT_FAVORITES_MODE",
    "CREATE_IDX_REF_LASTUSED",
    "CREATE_PROMPT_FAVORITES",
    "CREATE_REFERENCE_TEMPLATES",
    "CREATE_TABLE",
    "SCHEMA_VERSION",
    "_get_schema_version",
    "_migrate_add_video_mode",
    "_migrate_create_prompt_favorites",
    "_migrate_create_reference_templates",
    "_needs_video_mode_migration",
    "_set_schema_version",
    "init_studio_history_db",
    # items
    "_row_to_item",
    "delete_item",
    "get_item",
    "insert_item",
    "list_items",
    "replace_reference_ref_if_current",
    "update_comparison",
    # cascade
    "_safe_pool_unlink",
    "clear_all",
    "clear_all_with_refs",
    "count_image_ref_usage",
    "count_pool_refs",
    "count_source_ref_usage",
    "delete_item_with_refs",
    "list_history_pool_refs",
    # stats
    "count_items",
    "get_stats",
    # templates
    "_row_to_reference_template",
    "delete_reference_template",
    "get_reference_template",
    "insert_reference_template",
    "list_reference_templates",
    "touch_reference_template",
    # prompt favorites
    "VALID_PROMPT_FAVORITE_MODES",
    "_prompt_hash",
    "_row_to_prompt_favorite",
    "delete_prompt_favorite",
    "get_prompt_favorite",
    "list_prompt_favorites",
    "upsert_prompt_favorite",
]
