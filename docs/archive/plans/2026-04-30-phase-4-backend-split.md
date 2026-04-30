# Phase 4 — backend 5 파일 분할 plan

> **버전**: v2 (2026-04-30 · Claude 작성 + 사용자 codex 1차 리뷰 반영)
> **선행 commit**: master `4460477` (Phase 3.5 후속 fix 완료)
> **인계**: `memory/project_session_2026_04_30_phase_3_5_mock_split.md` + Phase 3.5 후속 fix 메모
> **검토 요청**: codex iterative review (1차 Critical 검출 → ✅ 반영 → 2차 100% → 구현)

## v1 → v2 핵심 변경 (codex 1차 리뷰 반영)

| # | 분류 | v1 문제 | v2 fix |
|---|---|---|---|
| C1 | Critical | 단계 3 (sub-module 분할) 가 단계 4 (monkeypatch 갱신) 보다 먼저 → 단계 3 종료 순간 fixture fail | **단계 2 한 commit 에 _config + 11 site 일괄 갱신** (sub-module 분할 전에 끝냄) |
| C2 | Critical | `reference_templates.py:242` 운영 코드의 `aiosqlite.connect(history_db._DB_PATH)` 직접 read 누락 | **단계 2 에 운영 1 + 테스트 4 = 직접 read 5 site 도 포함** (총 11 site) |
| C3 | Critical | sub-module 의 `from .reference_pool` / `from .storage` lazy import 가 분할 후 depth 1 부족 | **`from ..reference_pool` / `from ..storage` 로 명시 갱신** (cascade.py / stats.py) |
| I1 | Important | 외부 import 8 site 에 `streams.py:19` 누락 | **9 site 로 갱신** |
| I2 | Important | facade `from .schema import *` 가 ruff F403 위험 | **명시 import + `__all__` 정의** |
| R1 | Recommended | 선행 commit b6f2e11 stale | **4460477 로 갱신** (Phase 3.5 후속 fix 후) |

---

## 0. 배경 + 목적

Codex+Claude 통합 리팩토링 리뷰 (master `739e91f`) 의 Phase 4 (R2 Recommended) 가 보류 상태.
backend 5 파일이 800~1200줄 사이 단일 책임 모호 + 응집도 ↓.

**대상 파일**:

| 파일 | 줄수 | 책임 모호도 |
|---|---|---|
| `backend/studio/comfy_api_builder.py` | 1197 | generate/edit/video 빌더 한 파일 |
| `backend/studio/vision_pipeline.py` | 1131 | edit_source + image_detail 두 흐름 |
| `backend/studio/comparison_pipeline.py` | 1046 | v3 + v2_generic 두 알고리즘 |
| `backend/studio/prompt_pipeline.py` | 975 | translation + upgrade + ollama I/O |
| `backend/studio/history_db.py` | 886 | schema/items/cascade/templates/stats |

총 5,235줄 → 분할 시 각 sub-file 200~400줄 목표 (Phase 3.2/3.3/3.4 패턴).

**리스크**:
- 영향 import site 다수 (history_db 만 8 외부 + 6 monkeypatch site)
- mock.patch 위치 의존성 (CLAUDE.md 🔴 Critical: "lookup 모듈 기준")
- aiosqlite/httpx I/O 가 module-level state (`_DB_PATH`, `_OLLAMA_BASE` 등) 의존

→ **옵션 B 점진** (Phase 0~3 패턴 동일): 1 sub-phase 씩 brand → master merge → 다음 phase 시작.
→ master 항상 green 유지.

---

## 🚫 NOT IN SCOPE (절대 손대지 말 것)

- ❌ **frontend mock split (Phase 3.5)** — 이미 `b6f2e11` 머지 완료
- ❌ **legacy/ 디렉토리** — quarantine, 수정 금지 (CLAUDE.md 🟡)
- ❌ **schema 변경** — 단순 *코드 분할*, SQL/migration/DB 동작 0건 변경
- ❌ **함수 시그니처 변경** — 외부 호출 site 가 알아챌 변경 0건 (외부 import 동일하게 동작해야)
- ❌ **새 기능 추가** — 분할 + 일부 dead code 정리만, "while we're here" 보강 0건
- ❌ **Phase 4.2~4.5 본 plan 에서 자세히 작성 금지** — outline 만, detail 은 후속 plan
- ❌ **테스트 logic 수정** — patch target 만 갱신, assert/setup logic 0건 변경
- ❌ **공개 API 동작 변경** — `studio.history_db.X` 가 분할 후에도 동일 export

---

## 1. Phase 4 outline (5 sub-phase)

| sub-phase | 대상 | 분할 그룹 | 본 plan 범위 |
|---|---|---|---|
| **4.1** | `history_db.py` 886줄 | schema / items / cascade / stats / templates | ✅ **detail** |
| 4.2 | `vision_pipeline.py` 1131줄 | edit_source / image_detail / _common | outline |
| 4.3 | `prompt_pipeline.py` 975줄 | translation / upgrade / _ollama | outline |
| 4.4 | `comparison_pipeline.py` 1046줄 | v3 / v2_generic / _common | outline |
| 4.5 | `comfy_api_builder.py` 1197줄 | generate / edit / video / _common | outline |

각 sub-phase = **별도 brand + 별도 plan + codex 리뷰 + 별도 master merge** (옵션 B).
→ 한 sub-phase 후 master green 확정 → 다음 sub-phase plan 작성.

---

## 2. Phase 4.1 detail — `history_db.py` 분할

### 2.1 함수 → 그룹 매핑 (886줄 전수)

| 라인 | 함수/상수 | 그룹 | 메모 |
|---|---|---|---|
| L29~52 | `_DB_PATH`, `_POOL_URL_PREFIX`, `log` | `_config` | 단일 source of truth |
| L57 | `SCHEMA_VERSION = 8` | schema | |
| L60~70 | `_get_schema_version`, `_set_schema_version` | schema | |
| L73~134 | `CREATE_TABLE`, `CREATE_IDX_*`, `CREATE_REFERENCE_TEMPLATES` (SQL constant) | schema | DDL only |
| L136~211 | `_needs_video_mode_migration`, `_migrate_add_video_mode`, `_migrate_create_reference_templates` | schema | |
| L214~322 | `init_studio_history_db()` | schema | 진입점 |
| L325~378 | `insert_item` | items | |
| L380~406 | `list_items` | items | |
| L408~416 | `get_item` | items | |
| L418~425 | `delete_item` | items | (cascade 없는 단순 삭제) |
| L427~481 | `delete_item_with_refs` | cascade | pool unlink + history row 삭제 |
| L483~488 | `clear_all` | cascade | |
| L490~533 | `clear_all_with_refs` | cascade | |
| L535~548 | `_safe_pool_unlink` | cascade | helper |
| L550~570 | `count_pool_refs`, `list_history_pool_refs` | cascade | |
| L572~603 | `count_source_ref_usage`, `count_image_ref_usage` | cascade | |
| L605~614 | `count_items` | stats | |
| L616~673 | `get_stats` | stats | |
| L675~691 | `update_comparison` | items | ⚠️ items vs stats 결정 — items (행 수정 작업이라) |
| L693~780 | `_row_to_item` | items | helper |
| L782~795 | `_row_to_reference_template` | templates | helper |
| L796~886 | `list_reference_templates`, `get_reference_template`, `insert_reference_template`, `delete_reference_template`, `touch_reference_template` | templates | |

**최종 분할**:
```
backend/studio/history_db/
├── __init__.py          (facade · 모든 public 함수 re-export · ~30줄)
├── _config.py           (_DB_PATH + _POOL_URL_PREFIX + log · ~25줄)
├── schema.py            (SCHEMA_VERSION + DDL + migration + init · ~330줄)
├── items.py             (insert/list/get/delete/update_comparison + _row_to_item · ~210줄)
├── cascade.py           (delete_with_refs + clear_*_with_refs + pool helpers · ~180줄)
├── stats.py             (count_items + get_stats · ~75줄)
└── templates.py         (reference_templates CRUD · ~110줄)
```

> `__init__.py` 가 없는 python 디렉토리는 namespace package 로 동작 — 명시 `__init__.py` 필수.
> 파일 이름이 `history_db.py` 였으므로 module → package 변환.

---

### 2.2 핵심 결정점 — `_DB_PATH` lookup 정책

⚠️ **분할 최대 함정**. 잘못하면 monkeypatch 6 site 가 silent fail (test green 인데 prod 다른 동작).

**현재 패턴**:
```python
# studio/history_db.py
_DB_PATH = settings.history_db_path  # module-level

async def insert_item(...):
    async with aiosqlite.connect(_DB_PATH) as db:  # closure 가 module global 참조
        ...
```

**테스트 patch**:
```python
monkeypatch.setattr("studio.history_db._DB_PATH", str(db_path))
```

**옵션 비교**:

#### A1. facade `__init__.py` 가 _DB_PATH 보유, sub-module 이 lazy lookup

```python
# studio/history_db/__init__.py
_DB_PATH = settings.history_db_path
from .schema import init_studio_history_db
from .items import insert_item, list_items, ...

# studio/history_db/items.py
async def insert_item(...):
    from . import _DB_PATH as path  # ❌ from import 는 binding 시점 고정
```

**❌ 문제**: `from . import _DB_PATH` 도 module load 시점에 binding → patch 안 먹음.
→ 함수 내부에서 매번 `from studio import history_db; path = history_db._DB_PATH` lazy lookup 필요.
→ 가독성 ↓ + 매 호출 import 오버헤드.

#### A2. 별도 `_config.py` 가 _DB_PATH 보유, sub-module 이 lazy lookup

```python
# studio/history_db/_config.py
_DB_PATH = settings.history_db_path

# studio/history_db/items.py
from . import _config as _cfg

async def insert_item(...):
    async with aiosqlite.connect(_cfg._DB_PATH) as db:
        ...
```

**✅ 장점**:
- `_cfg` 모듈은 한 번 import. `_cfg._DB_PATH` attribute lookup 은 호출 시점 → patch 가능.
- monkeypatch target 변경: `studio.history_db._DB_PATH` → `studio.history_db._config._DB_PATH` (6 site 갱신).
- 가독성 OK.

**📝 monkeypatch 갱신 6 파일**:
1. `tests/studio/test_comparison_pipeline.py:32`
2. `tests/studio/test_history_db_cascade.py:24`
3. `tests/studio/test_reference_pool_routes.py:25`
4. `tests/studio/test_edit_pipeline_pool_save.py:124`
5. `tests/studio/test_reference_promote_route.py:26`
6. `tests/studio/test_reference_templates.py:27`

#### A3. facade 가 _DB_PATH 를 노출 + sub-module 도 노출 (둘 다)

```python
# studio/history_db/__init__.py
from ._config import _DB_PATH  # facade re-export
```

**❌ 문제**: re-export 가 binding 만 복사 → facade._DB_PATH 를 patch 해도 `_cfg._DB_PATH` 는 그대로 → sub-module 함수가 patch 못 봄. **CLAUDE.md 🔴 Critical "patch site lookup module 기준" 위반**.

→ 만약 사용자가 backward-compat (옛 monkeypatch target 그대로) 우선이면 옵션 A1 lazy lookup 채택.

---

### 2.3 권장 옵션 — A2 (`_config.py` + 11 access site 갱신)

**이유**:
- monkeypatch + 직접 read 11 site 갱신은 단순 mechanical change
- sub-module 코드는 가독성 좋게 `_cfg._DB_PATH` attribute 사용
- CLAUDE.md 🔴 "lookup 모듈 기준" 정책 정합 (각 sub-module 이 _cfg 직접 의존)

**⚠️ codex C2 fix — facade alias 제거 결정**:

v1 에선 backward-compat 차원에서 facade `__init__.py` 에 `from ._config import _DB_PATH` re-export 를 제안했음. 그러나 codex 지적:

> A2로 가면 facade _DB_PATH alias 는 _config._DB_PATH 와 동기화되지 않아서 promote race 처리만 다른 DB를 볼 수 있어.

→ **facade alias 제거**. 모든 access (monkeypatch + 직접 read) 를 `_config._DB_PATH` 로 통일.
→ 옛 외부 도구의 직접 access 가능성은 risk 감수 (production 안에선 git grep 으로 11 site 모두 확인됨).

**11 access site 전수 (단계 2 에서 한 commit 에 갱신)**:

| # | 종류 | 파일 | 라인 | 갱신 후 |
|---|---|---|---|---|
| 1 | monkeypatch | tests/studio/test_comparison_pipeline.py | 32 | `studio.history_db._config._DB_PATH` |
| 2 | monkeypatch | tests/studio/test_history_db_cascade.py | 24 | `studio.history_db._config._DB_PATH` |
| 3 | monkeypatch | tests/studio/test_reference_pool_routes.py | 25 | `studio.history_db._config._DB_PATH` |
| 4 | monkeypatch | tests/studio/test_edit_pipeline_pool_save.py | 124 | `studio.history_db._config._DB_PATH` |
| 5 | monkeypatch | tests/studio/test_reference_promote_route.py | 26 | `studio.history_db._config._DB_PATH` |
| 6 | monkeypatch | tests/studio/test_reference_templates.py | 27 | `studio.history_db._config._DB_PATH` |
| 7 | direct read | **studio/routes/reference_templates.py** | **242** | `history_db._config._DB_PATH` (운영) |
| 8 | direct read | tests/studio/test_comparison_pipeline.py | 70 | `history_db._config._DB_PATH` |
| 9 | direct read | tests/studio/test_reference_promote_route.py | 380 | `history_db._config._DB_PATH` |
| 10 | direct read | tests/studio/test_reference_promote_route.py | 410 | `history_db._config._DB_PATH` |
| 11 | direct read | tests/studio/test_reference_templates.py | 41, 56 | `history_db._config._DB_PATH` |

**리스크**:
- `from . import _config as _cfg` 가 누락된 함수가 있으면 NameError → pytest 가 즉시 잡음
- 11 site 중 하나라도 누락 시 silent fail 가능 → **단계 2 종료 직전 grep assertion** 필수:
  ```bash
  # 단계 2 끝나면 이 grep 결과 0건이어야 함 (구버전 access 잔여 검출)
  grep -rn "studio\.history_db\._DB_PATH\|history_db\._DB_PATH" backend/ \
    | grep -v "_config\._DB_PATH" | wc -l   # 0 이어야 통과
  ```
- 회귀 위험 낮음 (mechanical refactor + test coverage 충분)

---

### 2.4 외부 import 영향 (9 파일 · codex I1 fix)

```
backend/main.py                                  : from studio.history_db import init_studio_history_db
backend/studio/storage.py                        : from . import history_db
backend/studio/pipelines/edit.py                 : from .. import history_db
backend/studio/pipelines/compare_analyze.py      : from .. import history_db, ollama_unload
backend/studio/routes/reference_pool.py          : from .. import history_db
backend/studio/routes/reference_templates.py     : from .. import history_db
backend/studio/routes/streams.py                 : from .. import dispatch_state, history_db   ← v2 추가 (I1)
backend/studio/routes/system.py                  : from .. import history_db
backend/tests/studio/test_video_pipeline.py      : from studio.history_db import (...)
```

**✅ facade `__init__.py` 가 모든 public 함수 명시 export (`__all__`) 하면 변경 0건** — 분할 후에도 `history_db.insert_item(...)` 동작 동일.

`test_video_pipeline.py:17` 의 직접 import (구체 함수명 가져옴) 는 facade `__all__` 에 해당 함수 포함되면 그대로 동작.

### 2.4.1 sub-module 의 lazy import depth 갱신 (codex C3 fix)

현재 `history_db.py` 의 두 lazy import 가 분할 후 sub-module 안으로 들어가면 **depth 1 부족** 으로 fail:

| 현재 위치 (history_db.py) | 분할 후 위치 (sub-module) | 갱신 |
|---|---|---|
| L541 `from .reference_pool import delete_pool_ref` (in `_safe_pool_unlink`) | `cascade.py` 안 | `from ..reference_pool import delete_pool_ref` |
| L626 `from .storage import _result_path_from_url` (in `get_stats`) | `stats.py` 안 | `from ..storage import _result_path_from_url` |

→ 분할 commit (단계 3) 에서 함수 이동과 함께 동시에 갱신 필수.

---

### 2.5 단계별 실행 plan (v2 · codex C1 fix)

#### 단계 1 — facade rename · no-op (1 commit)
- `git mv backend/studio/history_db.py backend/studio/history_db/__init__.py`
- 코드 변경 0건. Python 의 module → package 전환만.
- monkeypatch target `studio.history_db._DB_PATH` 가 새 `__init__.py` 의 module-level 변수로 그대로 동작.
- **검증**: `pytest tests/studio/` 361 PASS

#### 단계 2 — `_config.py` 도입 + 11 site 일괄 갱신 (1 commit · ⭐ C1 핵심)
- `studio/history_db/_config.py` 신규:
  ```python
  # studio/history_db/_config.py
  import logging
  try:
      from config import settings  # type: ignore
      _DB_PATH = settings.history_db_path
  except Exception:
      _DB_PATH = "./data/history.db"
  _POOL_URL_PREFIX = "/images/studio/reference-pool/"
  log = logging.getLogger("studio.history_db")
  ```
- facade `__init__.py` 갱신:
  - 옛 `_DB_PATH = settings.history_db_path` 등 module-level 정의 **제거**
  - 옛 `log = logging.getLogger(__name__)` 도 `_config.log` 로 통일
  - 함수 본문 안에서 `_DB_PATH` 참조 → `from . import _config as _cfg` (모듈 상단) + 함수 본문 `_cfg._DB_PATH` 로 치환 (전 함수)
  - facade 의 `_DB_PATH` alias 절대 export 안 함 (codex C2 fix · 동기화 함정)
- 운영 1 + 테스트 5 = **직접 read 5 site** 갱신:
  - `studio/routes/reference_templates.py:242` → `history_db._config._DB_PATH`
  - `tests/studio/test_comparison_pipeline.py:70` → `history_db._config._DB_PATH`
  - `tests/studio/test_reference_promote_route.py:380, 410` → `history_db._config._DB_PATH`
  - `tests/studio/test_reference_templates.py:41, 56` → `history_db._config._DB_PATH`
- **monkeypatch 6 site** 갱신:
  - 6 fixture 의 `studio.history_db._DB_PATH` → `studio.history_db._config._DB_PATH`
- **단계 2 종료 grep assertion** (PR 통과 게이트):
  ```bash
  grep -rn "studio\.history_db\._DB_PATH\|history_db\._DB_PATH" backend/ \
    | grep -v "_config\._DB_PATH" | wc -l   # 0 이어야 통과
  ```
- **검증**: `pytest tests/` 361 PASS + 위 grep = 0

#### 단계 3 — schema/items/cascade/stats/templates 5 그룹 분할 (5 commit)
- 각 commit 단위로:
  1. `studio/history_db/<group>.py` 파일 생성
  2. 해당 그룹 함수 + 헬퍼 이동 (facade `__init__.py` 에서 빠짐)
  3. sub-module 상단 `from . import _config as _cfg` + 함수 본문 `_cfg._DB_PATH` 사용
  4. **lazy import depth 갱신** (cascade/stats 만 해당 · codex C3 fix):
     - cascade.py: `from ..reference_pool import delete_pool_ref`
     - stats.py: `from ..storage import _result_path_from_url`
  5. facade `__init__.py` 갱신:
     - **명시 import** (codex I2 fix · `import *` 금지):
       ```python
       from .schema import init_studio_history_db, SCHEMA_VERSION
       from .items import (
           insert_item, list_items, get_item, delete_item,
           update_comparison, _row_to_item,
       )
       # ... 등
       ```
     - `__all__` 정의 (모든 public 명):
       ```python
       __all__ = [
           "init_studio_history_db", "SCHEMA_VERSION",
           "insert_item", "list_items", "get_item", "delete_item",
           "update_comparison", "_row_to_item",
           "delete_item_with_refs", "clear_all", "clear_all_with_refs",
           "count_pool_refs", "list_history_pool_refs",
           "count_source_ref_usage", "count_image_ref_usage", "_safe_pool_unlink",
           "count_items", "get_stats",
           "list_reference_templates", "get_reference_template",
           "insert_reference_template", "delete_reference_template",
           "touch_reference_template", "_row_to_reference_template",
       ]
       ```
  6. **검증**: `pytest tests/studio/` 361 PASS (해당 그룹 + 인접 그룹 회귀)
- **그룹 순서**: schema → items → cascade → stats → templates (의존도 낮은 → 높은)

#### 단계 4 — 풀 검증 (no-commit)
- `pytest tests/` 361 PASS 풀 회귀
- `ruff check backend/studio/` clean
- `cd frontend && npx tsc --noEmit && npm run lint && npm test -- --run` (frontend 영향 0이지만 baseline 확인)

#### 단계 5 — changelog + master --no-ff merge (2 commit)
- `docs/changelog.md` Phase 4.1 항목 추가
- master `--no-ff` merge + push

**예상 commit 수**: 1 (rename) + 1 (_config + 11 site) + 5 (그룹) + 1 (changelog) + 1 (merge commit) = **9 commits**

---

### 2.6 검증 plan

각 단계별로:
- `python -m pytest tests/studio/test_history_db_cascade.py -v` — 해당 그룹 직접 테스트
- `python -m pytest tests/studio/ -v` — backend 전체 회귀
- `ruff check studio/` — 신규 파일도 clean (특히 `import *` 금지 검출)
- 단계 2 종료 후: `grep -rn "studio\.history_db\._DB_PATH\|history_db\._DB_PATH" backend/ | grep -v "_config\._DB_PATH" | wc -l` = 0 (구버전 access 잔여 검출 게이트)
- 단계 5 종료 후: `pytest tests/ -v` 풀 (361 PASS 확인)

---

### 2.7 잠재 회귀 + 미리 박제 (v2)

| 위험 | 검증 방법 | 미리 fix |
|---|---|---|
| `from .X import _DB_PATH` 으로 잘못 import 한 sub-module (binding 시점 고정) | grep + pytest fixture monkeypatch 가 잡음 | 모든 sub-module = `from . import _config as _cfg` 패턴 강제 |
| 11 site 중 누락 site 가 있어 silent fail | 단계 2 종료 grep assertion (위 2.6) | grep 결과 0건 통과 게이트 |
| `update_comparison` 을 stats vs items 어느 그룹에 둘지 | 인계 caveat — items (행 수정) | 본 plan 명시 (items) |
| `_row_to_reference_template` 이 templates.py 외에서 쓰이는지 | grep | 현재는 templates 안에서만 사용 → templates.py 만 |
| facade `__init__.py` 가 너무 비대해지나 | 명시 import + `__all__` 만 50줄 정도 | OK (Phase 3.2 SettingsDrawer facade 패턴과 동일) |
| `aiosqlite` import 가 sub-module 마다 중복 | 각 파일이 직접 import (DRY 위반 X — 명시성 ↑) | OK |
| circular import (templates ↔ items 간) | 현재 설계상 의존 없음 (각각 독립 SQL) | OK |
| `from .reference_pool` / `from .storage` 가 sub-module 안에서 fail | codex C3 fix — 분할 commit 에서 `from ..reference_pool` 로 동시 갱신 | 단계 3 의 5번 항목 강제 |
| facade `from .schema import *` 가 ruff F403 trigger | codex I2 fix — 명시 import + `__all__` | 단계 3 의 5번 항목 강제 |

---

## 3. Phase 4.2~4.5 outline (별도 plan)

각 sub-phase 는 본 plan 머지 후 별도 plan 작성.

- **4.2 vision_pipeline.py** — `edit_source` (Edit 9-slot vision recipe) + `image_detail` (image-detail vision) + `_common` (qwen2.5vl 호출 헬퍼). monkeypatch target 영향 작음 (대부분 `studio.routes.streams.*` 에서 patch).
- **4.3 prompt_pipeline.py** — `translation` (KO→EN) + `upgrade` (gemma4 업그레이드) + `_ollama` (Ollama I/O 헬퍼). `_ollama_chat` 등 internal 함수 patch site 다수.
- **4.4 comparison_pipeline.py** — `v3` (Compare v3 5-axis 평가) + `v2_generic` (옛 generic 평가) + `_common`. v3 vs v2 분기 함수 (`run_compare_v3` etc.) 가 _common 호출.
- **4.5 comfy_api_builder.py** — `builder_generate` + `builder_edit` + `builder_video` + `_common` (LoRA chain / VAE 등). 가장 크지만 그룹 간 의존 적음.

---

## 4. 추천 진행 순서

1. **Phase 4.1 plan codex 리뷰** (Critical/Important/Recommended 분류)
2. 사용자 승인 + Critical fix 반영
3. Phase 4.1 구현 (단계 1~6 위 명시)
4. Phase 4.1 머지 후 master green 확인
5. Phase 4.2 plan 작성 → codex 리뷰 → 구현 → 머지 (반복)

---

## 5. 검증 체크리스트 (Phase 4.1 종료 시 · v2)

- [ ] `backend/studio/history_db/` 디렉토리 + 7 파일 (`__init__`, `_config`, schema, items, cascade, stats, templates)
- [ ] 각 sub-file 200~330줄 범위
- [ ] facade `__init__.py` = 명시 import + `__all__` (codex I2 fix · `import *` 0건)
- [ ] 외부 9 import site 변경 0건 (facade 호환 · streams.py 포함)
- [ ] 11 access site 갱신 (`_DB_PATH` → `_config._DB_PATH`):
  - [ ] monkeypatch 6 (test_comparison/cascade/reference_pool/edit_pipeline_pool/reference_promote/reference_templates)
  - [ ] 직접 read 5 (운영 reference_templates.py:242 + 테스트 4)
- [ ] `grep -rn "studio\.history_db\._DB_PATH\|history_db\._DB_PATH" backend/ | grep -v "_config\._DB_PATH"` = 0
- [ ] sub-module lazy import depth 갱신 (cascade.py: `..reference_pool` / stats.py: `..storage`)
- [ ] `pytest tests/` 361 PASS (회귀 0)
- [ ] `ruff check backend/` clean (특히 F403 0건)
- [ ] master `--no-ff` merge + origin push

---

## 6. 코덱스 리뷰 history

### v1 → v2 (codex 1차 · 사용자 직접 호출)

**Critical 3건 + Important 2건 + Recommended 1건 = 6 finding 모두 v2 반영 완료**:
- C1: 단계 순서 깨짐 (단계 3 → 단계 4 의존) → 단계 2 한 commit 일괄 갱신으로 흡수
- C2: `reference_templates.py:242` 운영 코드 직접 read 누락 + facade alias sync 함정 → facade alias 제거 + 11 site 일괄 (운영 1 + 테스트 4 추가 발견)
- C3: sub-module lazy import depth 부족 → cascade/stats 명시 갱신
- I1: streams.py 외부 import 누락 → 9 site 로 갱신
- I2: facade `import *` ruff F403 → 명시 import + `__all__`
- R1: 선행 commit stale → b6f2e11 → 4460477

### v2 → v3 (codex 2차 · 검증)

@codex — v2 plan 의 v1 fix 반영이 codex 1차 리뷰 항목 100% 일치하는지 확인 요청 (별도 round).

**핵심 검증 항목**:
1. v2 의 11 access site 갱신이 v1 의 monkeypatch 6 + codex 가 지적 못한 직접 read 5 site 모두 cover 하는지
2. 단계 2 grep assertion 패턴이 silent fail 검출 가능한지
3. 단계 3 의 5 commit 각각이 master green 보장 (특히 lazy import depth 갱신 누락 시 어느 commit 에서 fail)
4. facade alias 제거가 외부 도구/스크립트 영향 0건인지 (production 코드 grep)
5. `__all__` 항목에 누락된 public 명 있는지

**출력 양식**: Critical / Important / Recommended 분류 + plan v2 의 구체 section 인용 + 잔여 issue 0 확인.
