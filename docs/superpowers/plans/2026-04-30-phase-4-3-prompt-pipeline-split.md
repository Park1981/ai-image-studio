# Phase 4.3 — `prompt_pipeline.py` 975줄 분할 plan

> **버전**: v1 (2026-04-30 · Claude 작성 · 사용자 codex 1차 리뷰 대기)
> **선행 commit**: master `e2546e0` (Phase 4.2 vision_pipeline 4 파일 분할 완료)
> **인계**: `memory/project_session_2026_04_30_phase_4_2_vision_pipeline_split.md` + 본 plan
> **검증 baseline**: backend pytest **361 PASS** / ruff clean · frontend vitest 91 / tsc / lint clean

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

### 2.1 ⚠️ Mock.patch site 36건 (Phase 4.2 의 44 와 비슷한 규모)

`studio.prompt_pipeline.X` 또는 `backend.studio.prompt_pipeline.X` 패턴으로 patch 하는 site:

| 옛 patch target | 새 patch target | 건수 |
|---|---|---|
| `studio.prompt_pipeline._call_ollama_chat` | `studio.prompt_pipeline._ollama._call_ollama_chat` | 6 |
| `backend.studio.prompt_pipeline._call_ollama_chat` | `backend.studio.prompt_pipeline._ollama._call_ollama_chat` | 2 |
| `studio.prompt_pipeline.clarify_edit_intent` | `studio.prompt_pipeline.translate.clarify_edit_intent` | 17 |
| `studio.prompt_pipeline.translate_to_korean` | `studio.prompt_pipeline.translate.translate_to_korean` | 4 |
| `backend.studio.prompt_pipeline.translate_to_korean` | `backend.studio.prompt_pipeline.translate.translate_to_korean` | 2 |
| `studio.prompt_pipeline._run_upgrade_call` | `studio.prompt_pipeline.upgrade._run_upgrade_call` | 4 |
| **합계** | | **35** |

> **건수 확정 방법**: `grep -nc "studio\.prompt_pipeline\." tests/studio/*.py` — test_edit_vision_analysis 20 + test_prompt_pipeline 4 + test_video_pipeline 8 + test_role_slot_removal 4 = 36 (1건 차이는 import 라인 1개 — 실제 patch 35건). 단계 7 grep assertion 으로 0건 확인.

> **lazy import 검증**: `vision_pipeline/edit_source.py` (L174 / L511) 가 `from ..prompt_pipeline import clarify_edit_intent` 를 함수 안 lazy import. 분할 후 갱신 필요 여부 — 함수 안 lazy import 라 매 호출마다 fresh attribute lookup → facade `clarify_edit_intent` re-export 가 살아있으면 옛 동작 유지. *patch target 만 갱신* 하면 됨 (호출 site 변경 0).

### 2.2 ⚠️ production import 8 site

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
| `studio/vision_pipeline/edit_source.py:25, 174, 511` | `from ..prompt_pipeline import (UpgradeResult, upgrade_edit_prompt)` + lazy `clarify_edit_intent` | facade re-export 그대로 ✅ |
| `studio/vision_pipeline/image_detail.py:21` | `from ..prompt_pipeline import translate_to_korean` | facade re-export 그대로 ✅ |

> **결론**: production 코드는 **무손상**. facade `__init__.py` 의 re-export 가 모든 import 경로를 그대로 보존. 단계 1 (file → package) 종료 시점에 production 코드 0 라인 변경.

### 2.3 facade internal import 전환 (Phase 4.2 C1 fix 패턴)

분할 후 facade `__init__.py` 가 4 sub-module 에서 re-export 하므로 facade 안의 *internal import* 갱신은 **불필요** (각 sub-module 이 자신의 import 를 가짐). Phase 4.2 의 C1 같은 함정은 회피.

단 sub-module 의 internal import (Phase 4.2 의 `..` 갱신 패턴) 는 필요:
- `_common.py`: `from .._ollama_client import call_chat_payload` 가 아니라 `_call_ollama_chat` 만 _ollama.py 로 → `_common.py` 는 `call_chat_payload` 미사용 (clean)
- `_ollama.py`: `from .._ollama_client import call_chat_payload` (한 단계 위 ollama_client 모듈)
- `translate.py`: `from . import _common as _c` + `_c._strip_repeat_noise(...)` + `_c._DEFAULT_OLLAMA_URL` + `from . import _ollama as _o` + `_o._call_ollama_chat(...)`
- `upgrade.py`: `from . import _common as _c` + `_c.UpgradeResult` / `_c._strip_repeat_noise` / `_c._DEFAULT_OLLAMA_URL` / `_c.DEFAULT_TIMEOUT` + `from . import _ollama as _o` + `_o._call_ollama_chat(...)` + `from . import translate as _t` + `_t.translate_to_korean(...)` (로컬 호출 옵션 D)

> **옵션 D 확정** (Phase 4.2 와 동일): `from . import _common as _c` + `_c.X()` 패턴 — patch lookup 이 정의 위치 모듈에서 일어나도록 보장.

### 2.4 lazy import 보존 정책

기존 `vision_pipeline/edit_source.py` 의 lazy import (`from ..prompt_pipeline import clarify_edit_intent`) 는 facade re-export 활성 시 그대로 작동. **변경 불필요**. mock.patch target 만 `studio.prompt_pipeline.translate.clarify_edit_intent` 로 갱신.

### 2.5 함수 안 import re-binding 위험 (Phase 4.2 단계 1 lazy 발견과 동일)

facade `__init__.py` 작성 시 `_DEFAULT_OLLAMA_URL` 같은 **상수**의 re-export 는 *시점 snapshot* 임. test_prompt_pipeline 의 monkeypatch 가 `_DEFAULT_OLLAMA_URL` 을 변경하지는 않지만 (grep 결과 없음), 안전 차원에서 facade 가 *모듈 attribute 로 expose* 하는 형태로 작성.

---

## 3. 단계별 진행 (Phase 4.2 와 동일 6 단계 + 시행착오 안전판)

### 단계 0: plan 문서 commit + 사용자 codex 1차 리뷰

- 본 plan 을 `docs/superpowers/plans/2026-04-30-phase-4-3-prompt-pipeline-split.md` 로 commit
- 사용자가 직접 codex 1차 리뷰 받아옴 (Phase 4.1 + 4.2 검증된 패턴)
- 리뷰 finding 반영하여 v2 plan 갱신 후 단계 1 진입

### 단계 1: file → package 전환 (facade 골격 + production import 무손상)

- `mkdir backend/studio/prompt_pipeline/`
- `mv backend/studio/prompt_pipeline.py backend/studio/prompt_pipeline/__init__.py`
- facade 안 모든 production 노출 항목을 그대로 유지 (re-export 미실행 단계 — 옛 단일 모듈 그대로 facade 안에 박혀있음)
- pytest 실행 → 361 PASS 확인 (변화 0)
- commit: `refactor(prompt_pipeline): file → package 전환 (Phase 4.3 단계 1)`

### 단계 2: `_common.py` 분리 + facade re-export

- `_common.py` 신설: `UpgradeResult` / `_strip_repeat_noise` / `_DEFAULT_OLLAMA_URL` / `DEFAULT_TIMEOUT` / `log`
- facade `__init__.py` 에서 `_common` 의 5 항목을 명시 import + re-export
- production import (`from .prompt_pipeline import _DEFAULT_OLLAMA_URL, DEFAULT_TIMEOUT, UpgradeResult` 등) 모두 facade 통과 ✅
- pytest → 361 PASS
- commit: `refactor(prompt_pipeline): _common 그룹 분리 (Phase 4.3 단계 2)`

### 단계 3: `_ollama.py` 분리 + patch site 즉시 갱신 (codex C3 fix)

- `_ollama.py` 신설: `_call_ollama_chat` 만 (1 함수)
- import: `from .._ollama_client import call_chat_payload`
- facade `__init__.py` 에서 `from ._ollama import _call_ollama_chat` re-export
- **patch site 8건 즉시 갱신** (`studio.prompt_pipeline._call_ollama_chat` → `studio.prompt_pipeline._ollama._call_ollama_chat` + `backend.` prefix 동일 변환)
  - test_edit_vision_analysis.py: 4건 (L142, 154, 164, 175 — clarify 호출 안 _call_ollama_chat)
  - test_prompt_pipeline.py: 2건 (L152, 245 — backend prefix)
  - test_video_pipeline.py: 4건 (L130, 150, 178, 198)
  - **재확인**: `grep -nc "studio\.prompt_pipeline\._call_ollama_chat"` 으로 정확한 건수 박제
- pytest → 361 PASS
- commit: `refactor(prompt_pipeline): _ollama 분리 + patch 8 site 갱신 (Phase 4.3 단계 3)`

### 단계 4: `translate.py` 분리 + patch site 즉시 갱신

- `translate.py` 신설: `SYSTEM_TRANSLATE_KO` / `SYSTEM_CLARIFY_INTENT` / `clarify_edit_intent` / `translate_to_korean`
- import: `from . import _common as _c` + `from . import _ollama as _o`
- 함수 안에서 `_c._strip_repeat_noise(...)` + `_c._DEFAULT_OLLAMA_URL` + `_o._call_ollama_chat(...)` 호출 (옵션 D)
- facade `__init__.py` 에서 4 항목 re-export
- **patch site 23건 즉시 갱신**
  - `clarify_edit_intent` 17건 (모두 test_edit_vision_analysis.py)
  - `translate_to_korean` 6건 (test_prompt_pipeline.py 2 + test_video_pipeline.py 4)
- pytest → 361 PASS
- commit: `refactor(prompt_pipeline): translate 분리 + patch 23 site 갱신 (Phase 4.3 단계 4)`

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
- **lazy import 호환**: `vision_pipeline/edit_source.py` 의 lazy `from ..prompt_pipeline import clarify_edit_intent` 는 facade re-export 살아있으면 그대로 동작 — 변경 0

---

## 7. v1 → v2 변경 (codex 1차 리뷰 후 채울 영역)

> 사용자가 codex 1차 리뷰 받아오면 이 섹션에 finding fix 표 작성:
>
> | # | 분류 | v1 문제 | v2 fix |
> |---|---|---|---|

---

## 8. 다음 후속 plan (별도 세션)

- **Phase 4.4**: `comparison_pipeline.py` (1046줄) → v3 / v2_generic / _common 그룹
- **Phase 4.5**: `comfy_api_builder.py` (1197줄) → builder_generate / _edit / _video / _common 그룹
