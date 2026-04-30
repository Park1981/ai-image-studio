# Phase 4.3 — `prompt_pipeline.py` 975줄 분할 plan

> **버전**: v2 (2026-04-30 · Claude 작성 + 사용자 codex 1차 리뷰 5 finding 반영)
> **선행 commit**: master `e2546e0` (Phase 4.2 vision_pipeline 4 파일 분할 완료)
> **인계**: `memory/project_session_2026_04_30_phase_4_2_vision_pipeline_split.md` + 본 plan
> **검증 baseline**: backend pytest **361 PASS** / ruff clean · frontend vitest 91 / tsc / lint clean

## v1 → v2 핵심 변경 (codex 1차 리뷰 반영)

| # | 분류 | v1 문제 | v2 fix |
|---|---|---|---|
| C1 | Blocking | 단계 1 의 `prompt_pipeline.py` L20 `from ._ollama_client import call_chat_payload` 가 패키지 전환 후 `studio.prompt_pipeline._ollama_client` 로 해석 → import 깨짐 (Phase 4.2 C1 finding 과 동일 함정) | **단계 1 안에서 명시 갱신** — `from ._ollama_client import` → `from .._ollama_client import` (한 단계 위 모듈 명시) |
| C2 | Blocking | facade `__init__.py` 의 `clarify_edit_intent` re-export 가 *함수 객체 reference snapshot* — submodule (`translate.clarify_edit_intent`) 만 patch 해도 facade attribute 는 옛 reference 유지. `vision_pipeline/edit_source.py` 의 lazy `from ..prompt_pipeline import clarify_edit_intent` 가 facade attribute 를 fresh lookup 해서 *patch 안 먹음* | **lazy import 도 submodule 직접 import 로 변경** — edit_source.py L174, L511 의 `from ..prompt_pipeline import clarify_edit_intent` → `from ..prompt_pipeline.translate import clarify_edit_intent`. 단계 4 안에서 lazy import 갱신 + patch site 16건 모두 submodule path (`studio.prompt_pipeline.translate.clarify_edit_intent`) 로 갱신 (옵션 D 일관성) |
| I1 | Important | `_call_ollama_chat` patch 8건 → 실제 grep 10건 (test_edit_vision_analysis 4 + test_prompt_pipeline 2 + test_video_pipeline 4) | **10건** 으로 정정 (grep 실증) |
| I2 | Important | `clarify_edit_intent` patch 17건 → 실제 grep 16건 (test_edit_vision_analysis 의 import 라인 1건 제외) | **16건** 으로 정정 (grep 실증) |
| M1 | Minor | "production import 8 site" 표기 vs 본문 표 11 row 불일치 | **11 site** 로 통일 |
| | | **합계 35 → 36** patch site (_call_ollama_chat 10 + clarify_edit_intent 16 + translate_to_korean 6 + _run_upgrade_call 4) |

---

## 0. 배경 + 목적

Phase 4.2 (vision_pipeline.py 1131줄) master 머지 직후 다음 backend split.

`backend/studio/prompt_pipeline.py` (975줄) 이 4 가지 흐름을 단일 파일로 묶고 있음:
- **Ollama HTTP 전송** (`_call_ollama_chat` — 모든 텍스트 호출의 wire)
- **짧은 텍스트 변환** (`clarify_edit_intent` 의도 정제 + `translate_to_korean` 영→한 번역)
- **프롬프트 업그레이드** (`upgrade_generate_prompt` / `upgrade_edit_prompt` / `upgrade_video_prompt` + 매트릭스 directive + role/clause + 모든 SYSTEM 프롬프트 + `_run_upgrade_call` 공용 헬퍼)
- **공통 유틸** (`UpgradeResult` dataclass / `_strip_repeat_noise` / `_DEFAULT_OLLAMA_URL` / `DEFAULT_TIMEOUT`)

→ 그룹별 분할로 단일 책임 + 각 흐름 독립 검증 가능. Phase 4.2 와 동일 패턴 (옵션 D — sub-module 직접 import + patch site 즉시 갱신).

---

## 🚫 NOT IN SCOPE (절대 손대지 말 것)

- ❌ Phase 4.4~4.5 (comparison_pipeline / comfy_api_builder split) — 별도 후속 plan
- ❌ legacy/ 디렉토리
- ❌ SYSTEM_GENERATE / SYSTEM_EDIT / SYSTEM_VIDEO_* / SYSTEM_TRANSLATE_KO / SYSTEM_CLARIFY_INTENT 시스템 프롬프트 텍스트 변경 — 단순 코드 이동
- ❌ ROLE_INSTRUCTIONS / ROLE_TO_SLOTS / DOMAIN_VALID_SLOTS dict 내용 변경
- ❌ `upgrade_*_prompt` / `clarify_edit_intent` / `translate_to_korean` / `_call_ollama_chat` / `_run_upgrade_call` 시그니처 변경
- ❌ `_build_matrix_directive_block` 의 매트릭스 [edit] / [preserve] / [reference_from_image2] 판단 로직 변경
- ❌ Multi-ref Phase 1' / 1'' Layer 1 / Layer 2 안전망 로직 변경
- ❌ test logic 수정 (patch target 갱신만, assert/setup 0건 변경)
- ❌ Ollama 호출 옵션 (num_ctx / temperature / repeat_penalty / num_predict / think / keep_alive) 변경

---

## 1. 함수 → 그룹 매핑 (975줄 전수)

| 라인 | 항목 | 그룹 | 비고 |
|---|---|---|---|
| L1~21 | docstring + imports + `_ollama_client` import | facade | sub-module 가 다시 import |
| L22 | `log = logging.getLogger(__name__)` | `_common.py` | facade alias 제거 정책 (Phase 4.1) |
| L24~31 | `_DEFAULT_OLLAMA_URL` (config 폴백) | `_common.py` | comparison_pipeline / video_pipeline 도 import |
| L33~37 | `DEFAULT_TIMEOUT = 240.0` | `_common.py` | comparison_pipeline / video_pipeline 도 import |
| L44~94 | `SYSTEM_GENERATE` | `upgrade.py` | upgrade_generate_prompt 전용 |
| L96~161 | `SYSTEM_EDIT` | `upgrade.py` | upgrade_edit_prompt 전용 |
| L167~204 | `ROLE_INSTRUCTIONS` dict | `upgrade.py` | build_reference_clause 가 사용 |
| L213~218 | `ROLE_TO_SLOTS` dict | `upgrade.py` | _build_matrix_directive_block + Phase 1'' Layer 2 사용 |
| L226~239 | `DOMAIN_VALID_SLOTS` dict | `upgrade.py` | _build_matrix_directive_block Layer 1 사용 |
| L242~251 | `_role_target_slots` | `upgrade.py` | _build_matrix_directive_block 가 사용 |
| L254~300 | `build_reference_clause` | `upgrade.py` | upgrade_edit_prompt 가 사용 |
| L303~349 | `SYSTEM_VIDEO_BASE` | `upgrade.py` | build_system_video 가 사용 |
| L352~360 | `SYSTEM_VIDEO_ADULT_CLAUSE` | `upgrade.py` | build_system_video 가 사용 |
| L362~368 | `SYSTEM_VIDEO_RULES` | `upgrade.py` | build_system_video 가 사용 |
| L371~377 | `build_system_video(adult)` | `upgrade.py` | upgrade_video_prompt 가 사용 |
| L381 | `SYSTEM_VIDEO` 하위 호환 alias | `upgrade.py` | test_prompt_pipeline 호환 |
| L383~390 | `SYSTEM_TRANSLATE_KO` | `translate.py` | translate_to_korean 전용 |
| L393~411 | `UpgradeResult` dataclass | `_common.py` | 모든 upgrade_* 의 return + 외부 import |
| L414~444 | `_strip_repeat_noise` | `_common.py` | translate / clarify / upgrade 모두 사용 |
| L454~473 | `SYSTEM_CLARIFY_INTENT` | `translate.py` | clarify_edit_intent 전용 |
| L476~519 | `clarify_edit_intent` | `translate.py` | 짧은 텍스트 정제 함수 |
| L522~547 | `translate_to_korean` | `translate.py` | 짧은 영→한 번역 함수 |
| L550~612 | `_run_upgrade_call` 공용 헬퍼 | `upgrade.py` | upgrade_generate/edit/video 모두 호출 |
| L615~677 | `upgrade_generate_prompt` | `upgrade.py` | 생성 프롬프트 업그레이드 |
| L680~696 | `_slot_label` | `upgrade.py` | _build_matrix_directive_block 전용 |
| L699~809 | `_build_matrix_directive_block` | `upgrade.py` | upgrade_edit_prompt 전용 |
| L812~891 | `upgrade_edit_prompt` (+ Phase 1'' Layer 2 phrase 주입) | `upgrade.py` | 수정 프롬프트 업그레이드 |
| L894~935 | `upgrade_video_prompt` | `upgrade.py` | 영상 프롬프트 업그레이드 |
| L938~975 | `_call_ollama_chat` | `_ollama.py` | Ollama HTTP 호출 (wire) |

**최종 분할** (5 파일 · Phase 4.2 와 동일 facade + 4 sub-module 패턴):
```
backend/studio/prompt_pipeline/
├── __init__.py     ~85줄  (facade · re-export + __all__)
├── _common.py      ~50줄  (UpgradeResult / _strip_repeat_noise /
│                          _DEFAULT_OLLAMA_URL / DEFAULT_TIMEOUT / log)
├── _ollama.py      ~45줄  (_call_ollama_chat — Ollama HTTP wire)
├── translate.py    ~120줄 (SYSTEM_TRANSLATE_KO / SYSTEM_CLARIFY_INTENT /
│                          clarify_edit_intent / translate_to_korean)
└── upgrade.py      ~700줄 (모든 SYSTEM_GENERATE/EDIT/VIDEO_* +
                           ROLE_INSTRUCTIONS/ROLE_TO_SLOTS/DOMAIN_VALID_SLOTS +
                           _role_target_slots / build_reference_clause /
                           build_system_video / _run_upgrade_call /
                           _slot_label / _build_matrix_directive_block /
                           upgrade_generate/edit/video_prompt)
```

> upgrade.py 가 가장 큰 sub-module (~700줄). vision_pipeline/edit_source.py 의 579줄과 유사 규모 — Edit 매트릭스 흐름이 응집된 것과 같은 이유로 upgrade 흐름 (system + role + matrix + 3 함수) 응집.

---

## 2. 핵심 위험 (Phase 4.2 와 동급)

### 2.1 ⚠️ Mock.patch site 36건 (codex I1 + I2 fix · grep 실증)

`studio.prompt_pipeline.X` 또는 `backend.studio.prompt_pipeline.X` 패턴으로 patch 하는 site (실제 grep):

| 옛 patch target | 새 patch target | 건수 |
|---|---|---|
| `studio.prompt_pipeline._call_ollama_chat` | `studio.prompt_pipeline._ollama._call_ollama_chat` | 8 |
| `backend.studio.prompt_pipeline._call_ollama_chat` | `backend.studio.prompt_pipeline._ollama._call_ollama_chat` | 2 |
| `studio.prompt_pipeline.clarify_edit_intent` | `studio.prompt_pipeline.translate.clarify_edit_intent` | 16 |
| `studio.prompt_pipeline.translate_to_korean` | `studio.prompt_pipeline.translate.translate_to_korean` | 4 |
| `backend.studio.prompt_pipeline.translate_to_korean` | `backend.studio.prompt_pipeline.translate.translate_to_korean` | 2 |
| `studio.prompt_pipeline._run_upgrade_call` | `studio.prompt_pipeline.upgrade._run_upgrade_call` | 4 |
| **합계** | | **36** |

> **건수 확정 (grep 실증, 2026-04-30)**:
> - `_call_ollama_chat`: test_edit_vision_analysis 4 + test_prompt_pipeline 2 (backend prefix) + test_video_pipeline 4 = **10**
> - `clarify_edit_intent`: test_edit_vision_analysis L194/226/252/276/303/334/362/398/420/447/480/517/561/615/655/688 = **16** (L26 import 라인 제외)
> - `translate_to_korean`: test_prompt_pipeline 2 (backend prefix) + test_video_pipeline 4 = **6**
> - `_run_upgrade_call`: test_role_slot_removal 4 = **4**

> **lazy import 정책 (codex C2 fix)**: `vision_pipeline/edit_source.py` 의 lazy `from ..prompt_pipeline import clarify_edit_intent` (L174 / L511) 가 facade attribute 를 fresh lookup 함. 그러나 facade `__init__.py` 의 re-export 는 *함수 객체 reference snapshot* — submodule 만 patch 해도 facade attribute 는 옛 reference 유지 → patch 안 먹음. 따라서 **lazy import 자체를 submodule 직접 import 로 변경** (`from ..prompt_pipeline.translate import clarify_edit_intent`). 옵션 D 일관성 + Phase 4.2 의 patch site 갱신 패턴과 동일.

### 2.2 ⚠️ production import 11 site (codex M1 fix)

| 호출자 | 옛 import | 새 import (단계 1 후 OK 동작) |
|---|---|---|
| `studio/comparison_pipeline.py:33` | `from .prompt_pipeline import _DEFAULT_OLLAMA_URL, DEFAULT_TIMEOUT` | facade re-export 그대로 ✅ |
| `studio/video_pipeline.py:23-28` | `from .prompt_pipeline import (_DEFAULT_OLLAMA_URL, DEFAULT_TIMEOUT, UpgradeResult, upgrade_video_prompt)` | facade re-export 그대로 ✅ |
| `studio/router.py:115` | `from .prompt_pipeline import clarify_edit_intent, upgrade_generate_prompt` | facade re-export 그대로 ✅ |
| `studio/routes/prompt.py:20` | `from ..prompt_pipeline import upgrade_generate_prompt` | facade re-export 그대로 ✅ |
| `studio/routes/compare.py:23` | `from ..prompt_pipeline import clarify_edit_intent  # noqa: F401` | facade re-export 그대로 ✅ (옛 mock.patch 호환) |
| `studio/pipelines/compare_analyze.py:32` | `from ..prompt_pipeline import clarify_edit_intent` | facade re-export 그대로 ✅ |
| `studio/pipelines/generate.py:22, 100` | `from ..prompt_pipeline import upgrade_generate_prompt` + `from ..prompt_pipeline import UpgradeResult` (lazy) | facade re-export 그대로 ✅ |
| `studio/pipelines/video.py:33` | `from ..prompt_pipeline import UpgradeResult` | facade re-export 그대로 ✅ |
| `studio/vision_pipeline/_common.py:27` | `from ..prompt_pipeline import (DEFAULT_TIMEOUT, _DEFAULT_OLLAMA_URL)` | facade re-export 그대로 ✅ |
| `studio/vision_pipeline/edit_source.py:25` | `from ..prompt_pipeline import (UpgradeResult, upgrade_edit_prompt)` | facade re-export 그대로 ✅ (top-level import 유지) |
| `studio/vision_pipeline/edit_source.py:174, 511` | lazy `from ..prompt_pipeline import clarify_edit_intent` | **단계 4 에서 `from ..prompt_pipeline.translate import clarify_edit_intent` 로 변경** (codex C2 fix) |
| `studio/vision_pipeline/image_detail.py:21` | `from ..prompt_pipeline import translate_to_korean` | facade re-export 그대로 ✅ |

> **결론**: production 코드 변경 범위는 **단계 4 의 edit_source.py lazy import 2라인 (L174/L511) 만**. 나머지 production import 경로는 facade re-export 가 그대로 보존. 단계 1 (file → package) 종료 시점엔 production 코드 0 라인 변경.

### 2.3 facade internal import 전환 (codex C1 fix · Phase 4.2 와 동일 함정)

**🔴 단계 1 안에서 즉시 갱신 필요** — `prompt_pipeline.py` 의 단일 internal import 한 줄:

```python
# 옛 (단일 모듈 시점):
from ._ollama_client import call_chat_payload  # L20

# 새 (패키지 전환 후 facade __init__.py 안):
from .._ollama_client import call_chat_payload  # 한 단계 위 ollama_client 모듈
```

> **함정**: `prompt_pipeline.py` → `prompt_pipeline/__init__.py` 로 옮기면 `.` 는 `studio.prompt_pipeline` 자체를 가리킴. `._ollama_client` = `studio.prompt_pipeline._ollama_client` (없는 모듈) → ImportError. Phase 4.2 의 C1 finding 과 *동일 함정*. 단계 1 commit 안에서 갱신 누락 시 pytest 즉시 fail.

### 2.4 sub-module internal import 패턴 (옵션 D 확정)

분할 후 sub-module 들이 본체를 가지므로 sub-module 의 internal import:
- `_common.py`: 외부 의존 없음 (작음)
- `_ollama.py`: `from .._ollama_client import call_chat_payload` (한 단계 위 ollama_client 모듈)
- `translate.py`: `from . import _common as _c` + `_c._strip_repeat_noise(...)` + `_c._DEFAULT_OLLAMA_URL` + `from . import _ollama as _o` + `_o._call_ollama_chat(...)`
- `upgrade.py`: `from . import _common as _c` + `_c.UpgradeResult` / `_c._strip_repeat_noise` / `_c._DEFAULT_OLLAMA_URL` / `_c.DEFAULT_TIMEOUT` + `from . import _ollama as _o` + `_o._call_ollama_chat(...)` + `from . import translate as _t` + `_t.translate_to_korean(...)` (로컬 호출 옵션 D)

> **옵션 D 확정** (Phase 4.2 와 동일): `from . import _common as _c` + `_c.X()` 패턴 — patch lookup 이 정의 위치 모듈에서 일어나도록 보장.

### 2.5 lazy import 정책 변경 (codex C2 fix)

`vision_pipeline/edit_source.py` 의 lazy import 2 site (L174, L511) 는 분할 후 *facade* 가 아니라 *submodule* 직접 import 로 변경:

```python
# 옛:
from ..prompt_pipeline import clarify_edit_intent  # facade lookup

# 새 (단계 4 안에서 갱신):
from ..prompt_pipeline.translate import clarify_edit_intent  # submodule 직접 lookup
```

> **이유**: facade `__init__.py` 의 re-export `from .translate import clarify_edit_intent` 는 facade attribute 를 *함수 객체 reference snapshot* 으로 bind. 이후 submodule (`translate.clarify_edit_intent`) 만 patch 하면 submodule attribute 만 변경되고 facade attribute 는 옛 함수 객체 그대로. lazy import 가 facade attribute 를 fresh lookup 해도 옛 함수 받아옴 → patch 안 먹음. 호출 site (lazy import) 도 submodule 로 변경해야 일관 동작.

> **patch site 16건 모두 submodule path 갱신 + lazy import 2 site 동시 갱신** (단계 4 commit 안에서 함께).

### 2.6 함수 안 import re-binding 위험 (Phase 4.2 단계 1 lazy 발견과 동일)

facade `__init__.py` 작성 시 `_DEFAULT_OLLAMA_URL` 같은 **상수**의 re-export 는 *시점 snapshot* 임. test_prompt_pipeline 의 monkeypatch 가 `_DEFAULT_OLLAMA_URL` 을 변경하지는 않지만 (grep 결과 없음), 안전 차원에서 facade 가 *모듈 attribute 로 expose* 하는 형태로 작성.

---

## 3. 단계별 진행 (Phase 4.2 와 동일 6 단계 + 시행착오 안전판)

### 단계 0: plan 문서 commit + 사용자 codex 1차 리뷰

- 본 plan 을 `docs/superpowers/plans/2026-04-30-phase-4-3-prompt-pipeline-split.md` 로 commit
- 사용자가 직접 codex 1차 리뷰 받아옴 (Phase 4.1 + 4.2 검증된 패턴)
- 리뷰 finding 반영하여 v2 plan 갱신 후 단계 1 진입

### 단계 1: file → package 전환 + `_ollama_client` import depth 갱신 (codex C1 fix)

- `mkdir backend/studio/prompt_pipeline/`
- `mv backend/studio/prompt_pipeline.py backend/studio/prompt_pipeline/__init__.py`
- **🔴 같은 commit 안에서 즉시 갱신** (codex C1 fix):
  - L20 `from ._ollama_client import call_chat_payload` → `from .._ollama_client import call_chat_payload`
- facade 안 모든 production 노출 항목을 그대로 유지 (re-export 미실행 단계 — 옛 단일 모듈 그대로 facade 안에 박혀있음)
- pytest 실행 → 361 PASS 확인 (변화 0)
- commit: `refactor(prompt_pipeline): file → package 전환 + _ollama_client import .. 갱신 (Phase 4.3 단계 1)`

### 단계 2: `_common.py` 분리 + facade re-export

- `_common.py` 신설: `UpgradeResult` / `_strip_repeat_noise` / `_DEFAULT_OLLAMA_URL` / `DEFAULT_TIMEOUT` / `log`
- facade `__init__.py` 에서 `_common` 의 5 항목을 명시 import + re-export
- production import (`from .prompt_pipeline import _DEFAULT_OLLAMA_URL, DEFAULT_TIMEOUT, UpgradeResult` 등) 모두 facade 통과 ✅
- pytest → 361 PASS
- commit: `refactor(prompt_pipeline): _common 그룹 분리 (Phase 4.3 단계 2)`

### 단계 3: `_ollama.py` 분리 + patch site 즉시 갱신 (codex I1 fix · 10건)

- `_ollama.py` 신설: `_call_ollama_chat` 만 (1 함수)
- import: `from .._ollama_client import call_chat_payload`
- facade `__init__.py` 에서 `from ._ollama import _call_ollama_chat` re-export
- **patch site 10건 즉시 갱신** (`studio.prompt_pipeline._call_ollama_chat` → `studio.prompt_pipeline._ollama._call_ollama_chat` + `backend.` prefix 동일 변환)
  - test_edit_vision_analysis.py: 4건 (L142, 154, 164, 175)
  - test_prompt_pipeline.py: 2건 (L152, 245 — backend prefix)
  - test_video_pipeline.py: 4건 (L130, 150, 178, 198)
- pytest → 361 PASS
- commit: `refactor(prompt_pipeline): _ollama 분리 + patch 10 site 갱신 (Phase 4.3 단계 3)`

### 단계 4: `translate.py` 분리 + lazy import 갱신 (codex C2 fix) + patch site 즉시 갱신 (codex I2 fix · 22건)

- `translate.py` 신설: `SYSTEM_TRANSLATE_KO` / `SYSTEM_CLARIFY_INTENT` / `clarify_edit_intent` / `translate_to_korean`
- import: `from . import _common as _c` + `from . import _ollama as _o`
- 함수 안에서 `_c._strip_repeat_noise(...)` + `_c._DEFAULT_OLLAMA_URL` + `_o._call_ollama_chat(...)` 호출 (옵션 D)
- facade `__init__.py` 에서 4 항목 re-export
- **🔴 같은 commit 안에서 lazy import 2 site 갱신 (codex C2 fix)**:
  - `vision_pipeline/edit_source.py` L174: `from ..prompt_pipeline import clarify_edit_intent` → `from ..prompt_pipeline.translate import clarify_edit_intent`
  - `vision_pipeline/edit_source.py` L511: 동일 변경
  - 이유: facade re-export 가 함수 객체 reference snapshot 이라 submodule patch 가 facade attribute 까지 갱신 못함. lazy import 가 facade attribute 를 fresh lookup 해도 옛 함수 받아옴. 호출 site 자체를 submodule 직접 import 로 변경해야 patch 일관 동작.
- **patch site 22건 즉시 갱신**
  - `clarify_edit_intent` 16건 (test_edit_vision_analysis.py L194/226/252/276/303/334/362/398/420/447/480/517/561/615/655/688)
  - `translate_to_korean` 6건 (test_prompt_pipeline.py L156/249 backend prefix + test_video_pipeline.py L131/151/179/199)
- pytest → 361 PASS
- commit: `refactor(prompt_pipeline): translate 분리 + edit_source lazy import 갱신 + patch 22 site 갱신 (Phase 4.3 단계 4)`

### 단계 5: `upgrade.py` 분리 + patch site 즉시 갱신 + facade 정리 + `__all__`

- `upgrade.py` 신설 (~700줄):
  - 모든 SYSTEM_* 프롬프트 (GENERATE / EDIT / VIDEO_BASE / VIDEO_ADULT_CLAUSE / VIDEO_RULES + SYSTEM_VIDEO alias)
  - ROLE_INSTRUCTIONS / ROLE_TO_SLOTS / DOMAIN_VALID_SLOTS
  - `_role_target_slots` / `build_reference_clause` / `build_system_video`
  - `_run_upgrade_call`
  - `_slot_label` / `_build_matrix_directive_block`
  - `upgrade_generate_prompt` / `upgrade_edit_prompt` / `upgrade_video_prompt`
- import: `from . import _common as _c` + `from . import _ollama as _o` + `from . import translate as _t`
- 함수 안 호출: `_c.UpgradeResult` / `_c._strip_repeat_noise` / `_c._DEFAULT_OLLAMA_URL` / `_c.DEFAULT_TIMEOUT` / `_o._call_ollama_chat(...)` / `_t.translate_to_korean(...)` (옵션 D)
- facade `__init__.py` 정리 — 옛 단일 모듈 본체 모두 제거. re-export + `__all__` 명시만 남김.
- `__all__` 정의 (모든 production 노출 + test import 노출 항목):
  ```python
  __all__ = [
      # _common
      "UpgradeResult",
      "_strip_repeat_noise",  # private 이지만 test 가 import (test_prompt_pipeline.py:15)
      "_DEFAULT_OLLAMA_URL",
      "DEFAULT_TIMEOUT",
      # _ollama
      "_call_ollama_chat",
      # translate
      "SYSTEM_TRANSLATE_KO",
      "SYSTEM_CLARIFY_INTENT",
      "clarify_edit_intent",
      "translate_to_korean",
      # upgrade
      "SYSTEM_GENERATE",
      "SYSTEM_EDIT",
      "ROLE_INSTRUCTIONS",
      "ROLE_TO_SLOTS",
      "DOMAIN_VALID_SLOTS",
      "_role_target_slots",
      "build_reference_clause",
      "SYSTEM_VIDEO_BASE",
      "SYSTEM_VIDEO_ADULT_CLAUSE",
      "SYSTEM_VIDEO_RULES",
      "build_system_video",
      "SYSTEM_VIDEO",
      "_run_upgrade_call",
      "upgrade_generate_prompt",
      "_slot_label",
      "_build_matrix_directive_block",
      "upgrade_edit_prompt",
      "upgrade_video_prompt",
  ]
  ```
- **patch site 4건 즉시 갱신** (`_run_upgrade_call` test_role_slot_removal.py L295, 328, 361, 393)
- pytest → 361 PASS / ruff clean / mypy (있다면) clean
- **grep assertion**: `grep -rn "studio\.prompt_pipeline\.[A-Za-z_]+" backend/tests/` 결과의 모든 매치가 sub-module path (`._common.X` / `._ollama.X` / `.translate.X` / `.upgrade.X`) 또는 단순 import 경로여야 함. flat patch (`studio.prompt_pipeline.X` where X 가 facade re-export attribute 인 경우) 0건 보장.
- commit: `refactor(prompt_pipeline): upgrade 분리 + patch 4 site 갱신 + facade 정리 + __all__ (Phase 4.3 단계 5)`

### 단계 6: changelog + master `--no-ff` merge

- `docs/changelog.md` 에 Phase 4.3 항목 추가 (Phase 4.1 + 4.1.1 + 4.2 패턴 따라)
- frontend 회귀 검증: vitest 91 PASS · tsc / lint clean (변경 없는데 baseline 확인)
- master 로 checkout → `git merge --no-ff <branch>` → push
- commit: `docs(changelog): Phase 4.3 prompt_pipeline 분할 항목 추가` + merge commit

---

## 4. 그룹 매핑 검증 (Phase 4.2 R1 패턴 — grep 실증)

| 항목 | grep 명령 | 예상 결과 |
|---|---|---|
| `_DEFAULT_OLLAMA_URL` 사용처 | `grep -rn "_DEFAULT_OLLAMA_URL" backend/studio backend/tests` | comparison_pipeline / video_pipeline / vision_pipeline._common / prompt_pipeline 내부 (translate + upgrade) |
| `DEFAULT_TIMEOUT` 사용처 | `grep -rn "DEFAULT_TIMEOUT" backend/studio backend/tests` | comparison_pipeline / video_pipeline / vision_pipeline._common / prompt_pipeline 내부 (upgrade) |
| `UpgradeResult` 사용처 | `grep -rn "UpgradeResult" backend/studio backend/tests` | video_pipeline / pipelines/generate / pipelines/video / vision_pipeline.edit_source / prompt_pipeline 내부 |
| `_strip_repeat_noise` 사용처 | `grep -rn "_strip_repeat_noise" backend/studio backend/tests` | prompt_pipeline 내부 (translate + upgrade) + test_prompt_pipeline.py |
| `_call_ollama_chat` 사용처 | `grep -rn "_call_ollama_chat" backend/studio` | prompt_pipeline 내부 (translate + upgrade) + test 4 파일 (patch only) |
| `clarify_edit_intent` 사용처 | `grep -rn "clarify_edit_intent" backend/studio` | pipelines/compare_analyze / vision_pipeline/edit_source (lazy) / router / routes/compare (옛 호환) + test 1 파일 |
| `translate_to_korean` 사용처 | `grep -rn "translate_to_korean" backend/studio` | vision_pipeline/image_detail / prompt_pipeline 내부 (upgrade `_run_upgrade_call`) + test 2 파일 |
| `_run_upgrade_call` 사용처 | `grep -rn "_run_upgrade_call" backend/studio` | prompt_pipeline.upgrade 내부 only + test_role_slot_removal.py |
| `_build_matrix_directive_block` 사용처 | `grep -rn "_build_matrix_directive_block" backend/studio` | prompt_pipeline.upgrade 내부 (upgrade_edit_prompt 호출) + test_role_slot_removal / test_multi_ref_edit / test_matrix_directive_block |

→ 각 항목이 매핑된 그룹 외에서 호출되지 않는지 단계 0 시점에 grep 으로 실증 후 v2 plan 에 결과 박제.

---

## 5. 테스트 회귀 0 보장 (Phase 4.1 + 4.2 정책)

- 단계 1~5 매 commit 후 `cd backend && pytest tests/` 361 PASS 확인 (회귀 0)
- 각 단계 commit 메시지 안에 pytest 결과 명시 ("361 PASS")
- ruff: `ruff check backend/studio/prompt_pipeline/` clean
- 단계 5 종료 시 frontend `npm test` (vitest 91) / `npx tsc --noEmit` / `npm run lint` clean — backend 분할 영향 없는데 baseline 확인용

---

## 6. 핵심 정책 박제 (Phase 4.2 학습 재사용)

- **옵션 D 확정**: sub-module 직접 import + `_c.X()` 호출 패턴
- **patch site 즉시 갱신**: 각 sub-module 분리 commit 안에서 patch site 갱신 (단계 5 일괄 미루지 않음)
- **facade alias 제거**: 단계 5 시점에 facade 안 본체 0줄 (re-export + `__all__` 만)
- **grep assertion `[A-Za-z_]+` 패턴**: private patch (`_call_ollama_chat` / `_run_upgrade_call`) 누락 방지
- **lazy import 도 submodule 직접 (codex C2)**: `vision_pipeline/edit_source.py` 의 lazy import 2 site (L174/L511) 도 단계 4 안에서 `from ..prompt_pipeline.translate import clarify_edit_intent` 로 변경. facade re-export 의 함수 객체 reference snapshot 함정 회피 (옵션 D 일관성)

---

## 7. 다음 후속 plan (별도 세션)

- **Phase 4.4**: `comparison_pipeline.py` (1046줄) → v3 / v2_generic / _common 그룹
- **Phase 4.5**: `comfy_api_builder.py` (1197줄) → builder_generate / _edit / _video / _common 그룹
