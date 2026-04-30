# Phase 4.4 — `comparison_pipeline.py` 1046줄 분할 plan

> **버전**: v1 (2026-04-30 · Claude 작성 · 사용자 codex 1차 리뷰 대기)
> **선행 commit**: master `e44f483` (Phase 4.3 prompt_pipeline 분할 + fastapi/pydantic pin + WPS433 cleanup)
> **인계**: `memory/project_session_2026_04_30_phase_4_3_prompt_pipeline_split.md` + 본 plan
> **검증 baseline**: backend pytest **361 PASS** / ruff clean · frontend vitest 91 / tsc / lint clean

---

## 0. 배경 + 목적

Phase 4.3 (prompt_pipeline 975줄) master 머지 직후 다음 backend split.

`backend/studio/comparison_pipeline.py` (1046줄) 이 두 개의 독립 흐름을 단일 파일로 묶고 있음:
- **v3 매트릭스 비교** (`analyze_pair` — Edit context 전용 · 도메인 분류 + 슬롯별 의도-맞춤 점수)
- **v2 generic 비교** (`analyze_pair_generic` — 일반 5축 점수)
- **공용 데이터 + 헬퍼** (axes 정의 / dataclass / _empty_* / _coerce_* / _translate_comments_to_ko)

→ 그룹별 분할로 단일 책임 + 각 흐름 독립 검증 가능. Phase 4.3 와 동일 패턴 (옵션 D — sub-module 직접 import + patch site 즉시 갱신).

> **Phase 4.3 학습 활용**: lazy import 0건 검증됨 (C2 함정 없음). C1 함정 (internal import depth) 만 단계 1 에 박제.

---

## 🚫 NOT IN SCOPE (절대 손대지 말 것)

- ❌ Phase 4.5 (comfy_api_builder split) — 별도 후속 plan
- ❌ legacy/ 디렉토리
- ❌ SYSTEM_COMPARE / SYSTEM_COMPARE_GENERIC / _TRANSLATE_SYSTEM / _COMPARE_HINT_DIRECTIVE 시스템 프롬프트 텍스트 변경 — 단순 코드 이동
- ❌ AXES 정의 (PERSON_AXES / OBJECT_SCENE_AXES / LEGACY_EDIT_AXES / AXES alias / COMPARE_AXES) 변경
- ❌ ComparisonSlotEntry / ComparisonAnalysisResult dataclass 필드 변경
- ❌ analyze_pair / analyze_pair_generic / _call_vision_pair / _translate_comments_to_ko 시그니처 변경
- ❌ test logic 수정 (patch target 갱신만, assert/setup 0건 변경)
- ❌ qwen2.5vl / gemma4 호출 옵션 변경

---

## 1. 함수 → 그룹 매핑 (1046줄 전수)

| 라인 | 항목 | 그룹 | 비고 |
|---|---|---|---|
| L1~36 | docstring + imports + log | facade | sub-module 가 다시 import |
| L40~64 | PERSON_AXES / OBJECT_SCENE_AXES / LEGACY_EDIT_AXES / AXES alias | `_common.py` | v3 + v2_generic 둘 다 사용 |
| L67~84 | COMPARE_AXES | `_common.py` | v2_generic 의 axes (analyze_pair_generic) |
| L87~192 | SYSTEM_COMPARE | `v3.py` | analyze_pair 전용 |
| L194~283 | SYSTEM_COMPARE_GENERIC | `v2_generic.py` | analyze_pair_generic 전용 |
| L285~302 | `_COMPARE_HINT_DIRECTIVE` | `v3.py` | analyze_pair hint 처리 |
| L306~322 | `ComparisonSlotEntry` dataclass | `_common.py` | v3 사용 (L651/662) + v2_generic 도 ComparisonAnalysisResult 의 slots 필드 reference |
| L324~399 | `ComparisonAnalysisResult` dataclass | `_common.py` | v3 (L727/747/818) + v2_generic (L956/972/1031) 둘 다 사용 |
| L401~409 | `_empty_scores` / `_empty_comments` | `_common.py` | _coerce_scores / _coerce_comments / v2_generic 사용 |
| L411~414 | `_to_b64` | `_common.py` | v3 (L460) + v2_generic (L886) |
| L416~482 | `_call_vision_pair` (v3) | `v3.py` | qwen2.5vl pair 호출 (v3 매트릭스) |
| L484~499 | `_coerce_scores` | `_common.py` | v2_generic (L985) 사용 + 잠재 재사용 |
| L501~514 | `_coerce_comments` | `_common.py` | v2_generic (L986) 사용 |
| L516~523 | `_compute_overall` | `_common.py` | v2_generic (L989) 사용 |
| L525~538 | `_TRANSLATE_SYSTEM` | `_common.py` | _translate_comments_to_ko 가 사용 |
| L540~630 | `_translate_comments_to_ko` | `_common.py` | v3 (L789) + v2_generic (L1004) 둘 다 사용 |
| L632~635 | `_coerce_intent` | `v3.py` | v3 슬롯 정규화 |
| L642~665 | `_coerce_v3_slots` | `v3.py` | v3 슬롯 매트릭스 정규화 |
| L668~673 | `_v3_overall` | `v3.py` | v3 종합 점수 |
| L676~833 | `analyze_pair` | `v3.py` | v3 진입점 |
| L835~840 | section divider | (제거 OK) | |
| L843~905 | `_call_vision_pair_generic` | `v2_generic.py` | qwen2.5vl pair 호출 (v2 generic) |
| L907~1046 | `analyze_pair_generic` | `v2_generic.py` | v2 generic 진입점 |

**최종 분할** (4 파일 · Phase 4.3 와 동일 facade + 3 sub-module 패턴):
```
backend/studio/comparison_pipeline/
├── __init__.py     ~80줄  (facade · re-export + __all__)
├── _common.py     ~430줄  (axes / dataclass / _to_b64 / _empty_* /
│                          _coerce_scores / _coerce_comments / _compute_overall /
│                          _TRANSLATE_SYSTEM / _translate_comments_to_ko)
├── v3.py          ~370줄  (SYSTEM_COMPARE / _COMPARE_HINT_DIRECTIVE /
│                          _call_vision_pair / _coerce_intent / _coerce_v3_slots /
│                          _v3_overall / analyze_pair)
└── v2_generic.py  ~230줄  (SYSTEM_COMPARE_GENERIC / _call_vision_pair_generic /
                           analyze_pair_generic)
```

> _common 이 가장 큰 sub-module (~430줄) — axes 정의 + dataclass + 5축 generic 처리 헬퍼 + 번역까지 응집. v3 / v2_generic 둘 다의 공통 기반.

---

## 2. 핵심 위험 (Phase 4.3 보다 작은 phase)

### 2.1 ⚠️ Mock.patch site 15건 (Phase 4.3 의 36 보다 적음)

`studio.comparison_pipeline.X` 패턴으로 patch 하는 site (실제 grep):

| 옛 patch target | 새 patch target | 건수 |
|---|---|---|
| `studio.comparison_pipeline._call_vision_pair` | `studio.comparison_pipeline.v3._call_vision_pair` | 8 |
| `studio.comparison_pipeline._translate_comments_to_ko` | `studio.comparison_pipeline._common._translate_comments_to_ko` | 7 |
| **합계** | | **15** |

> **건수 확정 (grep 실증, 2026-04-30)**:
> - `_call_vision_pair`: test_comparison_pipeline.py 전수 — L206/265/300/334/369/415/529/586 = 8
> - `_translate_comments_to_ko`: test_comparison_pipeline.py 전수 — L210/269/304/338/373/419/533 = 7

> **lazy import 0건** (grep 실증) — Phase 4.3 의 C2 함정 없음. 호출 site 분리 commit 만으로 patch 일관 동작.

### 2.2 ⚠️ production import 4 site

| 호출자 | 옛 import | 새 import (단계 1 후 OK 동작) |
|---|---|---|
| `studio/router.py:114` | `from .comparison_pipeline import analyze_pair, analyze_pair_generic` | facade re-export 그대로 ✅ |
| `studio/routes/compare.py:21` | `from ..comparison_pipeline import analyze_pair, analyze_pair_generic` | facade re-export 그대로 ✅ |
| `studio/pipelines/compare_analyze.py:31` | `from ..comparison_pipeline import analyze_pair, analyze_pair_generic` | facade re-export 그대로 ✅ |

> **결론**: production 코드 변경 0 라인. facade `__init__.py` 의 re-export 가 모든 import 경로를 그대로 보존.

### 2.3 facade internal import 전환 (codex C1 fix · Phase 4.2/4.3 와 동일 함정)

**🔴 단계 1 안에서 즉시 갱신 필요** — `comparison_pipeline.py` 의 internal import 6 site:

```python
# 옛 (단일 모듈 시점):
from ._json_utils import coerce_score as _coerce_score
from ._json_utils import parse_strict_json as _parse_strict_json
from ._ollama_client import call_chat_payload
from .presets import DEFAULT_OLLAMA_ROLES
from .prompt_pipeline import _DEFAULT_OLLAMA_URL, DEFAULT_TIMEOUT
from .vision_pipeline import ProgressCallback

# 새 (패키지 전환 후 facade __init__.py 안):
from .._json_utils import coerce_score as _coerce_score
from .._json_utils import parse_strict_json as _parse_strict_json
from .._ollama_client import call_chat_payload
from ..presets import DEFAULT_OLLAMA_ROLES
from ..prompt_pipeline import _DEFAULT_OLLAMA_URL, DEFAULT_TIMEOUT
from ..vision_pipeline import ProgressCallback
```

> **함정**: `comparison_pipeline.py` → `comparison_pipeline/__init__.py` 로 옮기면 `.` 는 `studio.comparison_pipeline` 자체를 가리킴. Phase 4.2 (vision_pipeline 7 site) / Phase 4.3 (prompt_pipeline 1 site) 와 동일 함정. 단계 1 commit 안에서 갱신 누락 시 pytest 즉시 fail.

### 2.4 sub-module internal import 패턴 (옵션 D 확정)

분할 후 sub-module 의 internal import:
- `_common.py`:
  - `from .._json_utils import coerce_score as _coerce_score, parse_strict_json as _parse_strict_json` (v3 / v2_generic 둘 다 의존? — _coerce_v3_slots 의 _coerce_score / analyze_pair 와 analyze_pair_generic 의 _parse_strict_json 사용 → 두 함수가 _common 에 있으면 sub-module 들이 _c 통해 lookup 안 됨. 안전하게 _common 에서 alias import 후 v3/v2_generic 이 `_c._coerce_score` / `_c._parse_strict_json` 사용)
  - `from .._ollama_client import call_chat_payload` (_translate_comments_to_ko 가 사용)
  - `from ..presets import DEFAULT_OLLAMA_ROLES` (필요 시)
  - `from ..prompt_pipeline import _DEFAULT_OLLAMA_URL, DEFAULT_TIMEOUT`
- `v3.py`:
  - `from . import _common as _c` + `_c._call_vision_pair` 같은 게 아니라 v3 의 `_call_vision_pair` 는 v3 자체에 정의
  - `from .._ollama_client import call_chat_payload` (_call_vision_pair 가 사용)
  - `from .._json_utils import parse_strict_json as _parse_strict_json` (analyze_pair 가 사용)
  - `from ..presets import DEFAULT_OLLAMA_ROLES` (필요 시)
  - `from . import _common as _c` (axes / dataclass / _to_b64 / _translate_comments_to_ko 사용)
- `v2_generic.py`:
  - `from .._ollama_client import call_chat_payload` (_call_vision_pair_generic 가 사용)
  - `from .._json_utils import parse_strict_json as _parse_strict_json`
  - `from ..presets import DEFAULT_OLLAMA_ROLES` (필요 시)
  - `from . import _common as _c` (axes / dataclass / _empty_* / _coerce_* / _compute_overall / _translate_comments_to_ko 사용)

> **옵션 D**: sub-module 들이 `_c.X()` 또는 직접 import. patch 대상 (`_translate_comments_to_ko` / `_call_vision_pair`) 은 항상 *정의 위치 모듈* 에서 lookup → v3 의 `_call_vision_pair` 호출 site 도 *같은 v3 모듈* 안 → v3.py 안에서 lookup → patch (`studio.comparison_pipeline.v3._call_vision_pair`) 일관 동작.

> **`_translate_comments_to_ko` patch 일관성**: v3 (analyze_pair) + v2_generic (analyze_pair_generic) 둘 다 호출. _common 에 정의 + 두 sub-module 이 `_c._translate_comments_to_ko(...)` lookup → patch (`studio.comparison_pipeline._common._translate_comments_to_ko`) 한 번에 두 호출자 모두 갱신.

### 2.5 lazy import 정책 (Phase 4.3 C2 함정 검증)

`comparison_pipeline.py` 의 lazy import grep 결과 **0건**. C2 함정 없음.

---

## 3. 단계별 진행 (Phase 4.3 와 동일 6 단계)

### 단계 0: plan 문서 commit + 사용자 codex 1차 리뷰

- 본 plan 을 `docs/superpowers/plans/2026-04-30-phase-4-4-comparison-pipeline-split.md` 로 commit
- 사용자가 직접 codex 1차 리뷰 받아옴 (Phase 4.1+4.2+4.3 검증된 패턴)
- 리뷰 finding 반영하여 v2 plan 갱신 후 단계 1 진입

### 단계 1: file → package 전환 + internal import 6 site `..` 갱신 (codex C1 fix)

- `mkdir backend/studio/comparison_pipeline/`
- `mv backend/studio/comparison_pipeline.py backend/studio/comparison_pipeline/__init__.py`
- **🔴 같은 commit 안에서 즉시 갱신** (codex C1 fix):
  - L29~34 6 internal import 모두 `..X` 로
- pytest 실행 → 361 PASS 확인 (변화 0)
- commit: `refactor(comparison_pipeline): file → package 전환 + internal import 6 site .. 갱신 (Phase 4.4 단계 1)`

### 단계 2: `_common.py` 분리 + facade re-export

- `_common.py` 신설:
  - PERSON_AXES / OBJECT_SCENE_AXES / LEGACY_EDIT_AXES / AXES alias / COMPARE_AXES
  - ComparisonSlotEntry / ComparisonAnalysisResult dataclass
  - _empty_scores / _empty_comments / _to_b64
  - _coerce_scores / _coerce_comments / _compute_overall
  - _TRANSLATE_SYSTEM / _translate_comments_to_ko
- import: `from .._json_utils import (...)` + `from .._ollama_client import call_chat_payload` + `from ..prompt_pipeline import _DEFAULT_OLLAMA_URL, DEFAULT_TIMEOUT` + 필요 시 `from ..presets import DEFAULT_OLLAMA_ROLES`
- facade `__init__.py` 에서 _common 항목 명시 import + re-export
- facade 본체에서 동일 항목 정의 *제거* + facade 안 호출 site 도 `_c.X` lookup 으로 변경 (Phase 4.3 단계 3 학습 — facade 본체 동시 존재 시 호출 site 도 변경 필요)
- pytest → 361 PASS
- commit: `refactor(comparison_pipeline): _common 그룹 분리 (Phase 4.4 단계 2)`

### 단계 3: `v3.py` 분리 + patch 8 site 갱신

- `v3.py` 신설:
  - SYSTEM_COMPARE / _COMPARE_HINT_DIRECTIVE
  - _call_vision_pair
  - _coerce_intent / _coerce_v3_slots / _v3_overall
  - analyze_pair
- import: `from . import _common as _c` + `from .._ollama_client import call_chat_payload` + `from .._json_utils import parse_strict_json as _parse_strict_json` + 필요 시 `from ..presets import DEFAULT_OLLAMA_ROLES`
- v3 안 호출: `_c._to_b64(...)` / `_c._translate_comments_to_ko(...)` / `_c.ComparisonSlotEntry(...)` / `_c.ComparisonAnalysisResult(...)`
- facade `__init__.py` 에서 v3 항목 import + re-export
- facade 본체에서 v3 항목 제거
- **patch site 8건 즉시 갱신**:
  - test_comparison_pipeline.py L206/265/300/334/369/415/529/586:
    `studio.comparison_pipeline._call_vision_pair` → `studio.comparison_pipeline.v3._call_vision_pair`
- pytest → 361 PASS
- commit: `refactor(comparison_pipeline): v3 분리 + patch 8 site 갱신 (Phase 4.4 단계 3)`

### 단계 4: `v2_generic.py` 분리 + patch 7 site 갱신 + facade 정리 + `__all__`

- `v2_generic.py` 신설:
  - SYSTEM_COMPARE_GENERIC
  - _call_vision_pair_generic
  - analyze_pair_generic
- import: `from . import _common as _c` + `from .._ollama_client import call_chat_payload` + `from .._json_utils import parse_strict_json as _parse_strict_json` + 필요 시 `from ..presets import DEFAULT_OLLAMA_ROLES`
- v2_generic 안 호출: `_c._to_b64(...)` / `_c._empty_scores(...)` / `_c._empty_comments(...)` / `_c._coerce_scores(...)` / `_c._coerce_comments(...)` / `_c._compute_overall(...)` / `_c._translate_comments_to_ko(...)` / `_c.ComparisonAnalysisResult(...)`
- facade `__init__.py` 정리:
  - 옛 본체 모두 제거
  - 4 sub-module 명시 import + re-export
  - `__all__` 명시 (production 노출 + test import 노출 모두 포함):
    ```python
    __all__ = [
        # _common — axes
        "PERSON_AXES",
        "OBJECT_SCENE_AXES",
        "LEGACY_EDIT_AXES",
        "AXES",
        "COMPARE_AXES",
        # _common — dataclass
        "ComparisonSlotEntry",
        "ComparisonAnalysisResult",
        # _common — helpers
        "_empty_scores",
        "_empty_comments",
        "_to_b64",
        "_coerce_scores",
        "_coerce_comments",
        "_compute_overall",
        # _common — translate
        "_TRANSLATE_SYSTEM",
        "_translate_comments_to_ko",
        # v3
        "SYSTEM_COMPARE",
        "_COMPARE_HINT_DIRECTIVE",
        "_call_vision_pair",
        "_coerce_intent",
        "_coerce_v3_slots",
        "_v3_overall",
        "analyze_pair",
        # v2_generic
        "SYSTEM_COMPARE_GENERIC",
        "_call_vision_pair_generic",
        "analyze_pair_generic",
        # 옛 호환 (test_comparison_pipeline 가 직접 import)
        "_coerce_score",  # _json_utils alias
        "_parse_strict_json",  # _json_utils alias
        "SYSTEM_COMPARE",
    ]
    ```
- **patch site 7건 즉시 갱신**:
  - test_comparison_pipeline.py L210/269/304/338/373/419/533:
    `studio.comparison_pipeline._translate_comments_to_ko` → `studio.comparison_pipeline._common._translate_comments_to_ko`
- pytest → 361 PASS / ruff clean
- **grep assertion**: `grep -rn "studio\.comparison_pipeline\.[A-Za-z_]+" backend/tests/` 결과 모든 매치가 sub-module path (`._common.X` / `.v3.X` / `.v2_generic.X`) 또는 단순 import 경로여야 함. flat patch 0건 보장.
- commit: `refactor(comparison_pipeline): v2_generic 분리 + patch 7 site 갱신 + facade 정리 + __all__ (Phase 4.4 단계 4)`

### 단계 5: changelog + master `--no-ff` merge

- `docs/changelog.md` 에 Phase 4.4 항목 추가
- frontend baseline 검증 (vitest 91 / tsc / lint clean — 변경 없는데 baseline 확인)
- master checkout → `git merge --no-ff <branch>` → push

---

## 4. 그룹 매핑 검증 (Phase 4.3 학습 — grep 실증 후 plan 박제)

| 항목 | grep 명령 | 예상 결과 (검증됨) |
|---|---|---|
| `_translate_comments_to_ko` 호출처 | `grep -n "_translate_comments_to_ko" backend/studio/comparison_pipeline.py` | v3 (L789) + v2_generic (L1004) → _common 정합 |
| `ComparisonSlotEntry` 호출처 | 동일 | v3 (L651/662) + v2_generic 의 ComparisonAnalysisResult slots → _common 정합 |
| `ComparisonAnalysisResult` 호출처 | 동일 | v3 (L727/747/818) + v2_generic (L956/972/1031) → _common 정합 |
| `_to_b64` 호출처 | 동일 | v3 (L460) + v2_generic (L886) → _common 정합 |
| `_empty_scores` / `_empty_comments` 호출처 | 동일 | v2_generic (L957/958/974/975) + _coerce_scores/_coerce_comments 안 → _common 정합 |
| `_coerce_scores` / `_coerce_comments` / `_compute_overall` 호출처 | 동일 | v2_generic (L985/986/989) only → _common 가도 OK (재사용성) |
| `_call_vision_pair` 호출처 | 동일 | v3 only (analyze_pair L717) → v3 정합 |
| `_call_vision_pair_generic` 호출처 | 동일 | v2_generic only → v2_generic 정합 |

→ 모든 매핑 grep 실증 후 v1 plan 박제. Phase 4.2 R1 / Phase 4.3 I1+I2 type 의 수량 오차 위험 회피.

---

## 5. 테스트 회귀 0 보장 (Phase 4.1+4.2+4.3 정책)

- 단계 1~4 매 commit 후 `cd backend && pytest tests/` 361 PASS 확인 (회귀 0)
- 각 단계 commit 메시지 안에 pytest 결과 명시 ("361 PASS")
- ruff: `ruff check backend/studio/comparison_pipeline/` clean
- 단계 4 종료 시 frontend `npm test` (vitest 91) / `npx tsc --noEmit` / `npm run lint` clean

---

## 6. 핵심 정책 박제 (Phase 4.2+4.3 학습 재사용)

- **옵션 D 확정**: sub-module 직접 import + `_c.X()` 호출 패턴
- **patch site 즉시 갱신**: 각 sub-module 분리 commit 안에서 patch site 갱신 (단계 4 일괄 미루지 않음)
- **facade alias 제거**: 단계 4 시점에 facade 안 본체 0줄 (re-export + `__all__` 만)
- **C1 동일 함정**: 단계 1 안에서 internal `.X` import → `..X` 갱신 (이번엔 6 site)
- **C2 함정 없음** (검증됨): comparison_pipeline 안에 lazy import 0건 — Phase 4.3 의 facade snapshot 우회 불필요
- **facade 본체 동시 존재 시 호출 site 도 변경** (Phase 4.3 단계 3 학습): 단계 2/3/4 의 sub-module 분리 commit 안에서 facade 본체의 호출 site 도 `_c.X` / `_v3.X` 등 lookup 으로 변경

---

## 7. 다음 후속 plan (별도 세션)

- **Phase 4.5**: `comfy_api_builder.py` (1197줄) → builder_generate / _edit / _video / _common 그룹 (마지막 phase)
