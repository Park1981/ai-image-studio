# Phase 4.2 — `vision_pipeline.py` 1131줄 분할 plan

> **버전**: v1 (2026-04-30 · Claude 작성 · 사용자 codex 1차 리뷰 대기)
> **선행 commit**: master `a8bad41` (Phase 4.1.1 helper 추출 완료)
> **인계**: `memory/project_session_2026_04_30_phase_4_1_history_db_split.md` + 본 plan
> **검증 baseline**: backend pytest 361 / ruff clean · frontend vitest 91 / tsc / lint clean

---

## 0. 배경 + 목적

Phase 4.1 (history_db.py 886줄) 완료 후 다음 본격 backend split.

`backend/studio/vision_pipeline.py` (1131줄) 이 두 개의 독립 흐름을 단일 파일로 묶고 있음:
- **Edit 9-slot vision recipe** (clarify_edit_intent → analyze_edit_source 매트릭스)
- **Vision Analyzer recipe v2** (단일 이미지 → 9-slot recipe JSON)
- **공용 qwen2.5vl 호출 헬퍼** (_describe_image, _to_base64 등)

→ 그룹별 분할로 단일 책임 + 각 흐름 독립 검증 가능.

---

## 🚫 NOT IN SCOPE (절대 손대지 말 것)

- ❌ Phase 4.3~4.5 (prompt/comparison/comfy_api_builder split) — 별도 후속 plan
- ❌ legacy/ 디렉토리
- ❌ Vision Recipe v2 의 9-slot JSON 정의 변경 — 단순 코드 이동
- ❌ Edit 매트릭스 슬롯 키 / domain 분류 변경
- ❌ qwen2.5vl 시스템 프롬프트 (VISION_SYSTEM / EDIT_VISION_ANALYSIS_SYSTEM / SYSTEM_VISION_DETAILED) 텍스트 변경
- ❌ `run_vision_pipeline` / `analyze_edit_source` / `analyze_image_detailed` 시그니처 변경
- ❌ test logic 수정 (patch target 갱신만, assert/setup 0건 변경)
- ❌ progress_callback 시그니처 (`Callable[[str], Awaitable[None]] | None`) 변경

---

## 1. 함수 → 그룹 매핑 (1131줄 전수)

| 라인 | 항목 | 그룹 | 비고 |
|---|---|---|---|
| L1~42 | docstring + imports | facade | sub-module 가 다시 import |
| L43~45 | `ProgressCallback` typedef | `_common.py` | comparison_pipeline 도 import |
| L48~84 | `VISION_SYSTEM` (Edit 짧은 캡션) | `_common.py` | Edit + Vision Analyzer 폴백 둘 다 사용? grep 필요 |
| L87~155 | `EDIT_VISION_ANALYSIS_SYSTEM` 매트릭스 | `edit_source.py` | Edit 전용 |
| L156~167 | `SYSTEM_VISION_DETAILED` 폴백 system | `image_detail.py` | Vision Analyzer 폴백 |
| L169~393 | (slot dataclass, ASPECT 상수, edit slot 키 정의 등) | edit_source/image_detail/_common 분기 필요 | 자세히 검토 |
| L394~535 | `run_vision_pipeline` (Edit 진입점) | `edit_source.py` | run_vision_pipeline = Edit 흐름 |
| L536~580 | `_describe_image` (qwen2.5vl 캡션 헬퍼) | `_common.py` | Edit + Vision Analyzer + video_pipeline 가 모두 사용 |
| L581~692 | (Edit 매트릭스 패러다임 docstring + helper) | edit_source.py | _empty_fallback_slots |
| L692~723 | `_coerce_domain` / `_coerce_action` / `_coerce_slots` | edit_source.py | Edit JSON coerce 전용 |
| L724~784 | `_call_vision_edit_source` | edit_source.py | Edit 매트릭스 호출 |
| L785~925 | `analyze_edit_source` | edit_source.py | Edit 매트릭스 진입점 |
| L926~956 | `_aspect_label` | image_detail.py | Vision Analyzer 전용 helper |
| L957~1006 | `_call_vision_recipe_v2` | image_detail.py | Vision Analyzer 호출 |
| L1007~1125 | `analyze_image_detailed` | image_detail.py | Vision Analyzer 진입점 |
| L1126~1131 | `_to_base64` | _common.py | 모든 vision 호출 헬퍼 |

**최종 분할** (예상):
```
backend/studio/vision_pipeline/
├── __init__.py          (facade · re-export + __all__ · ~80줄)
├── _common.py           (ProgressCallback / VISION_SYSTEM / _describe_image / _to_base64 / _DEFAULT_OLLAMA_URL / DEFAULT_TIMEOUT alias · ~150줄)
├── edit_source.py       (EDIT_VISION_ANALYSIS_SYSTEM / EditSlotEntry / EditVisionAnalysis / _coerce_* / _call_vision_edit_source / analyze_edit_source / run_vision_pipeline · ~600줄)
└── image_detail.py      (SYSTEM_VISION_DETAILED / _aspect_label / _call_vision_recipe_v2 / analyze_image_detailed · ~250줄)
```

> 각 sub-file 200~600줄. edit_source 가 가장 큰 그룹 (Edit 매트릭스 흐름 응집).

---

## 2. 핵심 위험 (Phase 4.1 보다 큰 phase)

### 2.1 ⚠️ Mock.patch 44 site (4.1 의 7배)

`studio.vision_pipeline.X` 패턴으로 patch 하는 site 44건:
- `studio.vision_pipeline._call_vision_edit_source` (~15회)
- `studio.vision_pipeline._call_vision_recipe_v2` (~10회)
- `studio.vision_pipeline._describe_image` (~10회)
- `studio.vision_pipeline.upgrade_edit_prompt` (~5회 · prompt_pipeline 에서 import)
- `studio.vision_pipeline.translate_to_korean` (~5회 · prompt_pipeline 에서 import)
- `studio.vision_pipeline.asyncio.sleep` (1회)

**핵심 함정** (CLAUDE.md 🔴 Critical):

> mock.patch 위치 = lookup 모듈 기준. re-export 받는 모듈에 patch 해도 호출 site 가 다른 모듈이면 안 가로챔.

**즉**: facade `studio.vision_pipeline.__init__` 가 `_call_vision_edit_source` 를 re-export 해도, 실제 호출 site 가 `studio.vision_pipeline.edit_source` 안에 있다면 patch 가 안 먹음.

**옵션 비교**:

#### 옵션 A — 완전 분리 + 44 patch site 갱신
- patch target 모두 `studio.vision_pipeline.edit_source._call_vision_edit_source` 등으로 갱신
- 이론적으로 가장 정합 (CLAUDE.md 정책)
- 단점: 44 line 갱신 mechanical work (Phase 4.1 의 11 site 보다 4배)

#### 옵션 B — facade 가 모든 함수를 직접 노출 (sub-module 안 호출 시 facade 경유)
- sub-module 안에서 `_call_vision_edit_source` 호출 시 `from . import edit_source; edit_source._call_vision_edit_source()` 패턴 사용 안 함. 대신 같은 sub-module 안에 정의됐으면 직접 호출.
- 그룹 의존도가 같은 sub-module 안에 응집됐으면 patch site 변경 0건 가능
- **단**: cross-module 호출 (예: edit_source.py 가 _common.py 의 `_describe_image` 를 사용) 의 경우 patch target 이 다른 모듈이 됨 → patch 가 facade 에서 안 잡음 → fail

#### 옵션 C (Phase 4.1 패턴) — facade re-export + sub-module 이 facade 경유 호출
- sub-module 안에서 다른 sub-module 함수 호출할 때: `from . import _common as _c; _c._describe_image(...)` 가 아닌 `from .. import vision_pipeline; vision_pipeline._describe_image(...)` 패턴
- patch target = facade (옛 그대로) 유지 가능
- **단**: facade alias binding 시점 함정 — facade 가 module load 시 import 받은 함수 객체는 patch 후에도 옛 binding 가리킴 (sub-module 의 `vision_pipeline._describe_image` 가 facade 의 _describe_image 를 attribute 로 따라가도 patch 시점이 facade load 후이면 OK)

→ Python attribute lookup 은 **호출 시점**에 모듈 dict 에서 가져옴. `vision_pipeline._describe_image` 호출 시 `vision_pipeline.__init__` 의 `_describe_image` attribute 를 lookup → monkeypatch 가 facade attribute 를 patch 하면 patch 가 보임. 즉 **옵션 C 안전**.

#### 권장 = 옵션 C

이유:
- Phase 4.1 history_db 와 동일 패턴 (이미 검증됨 · 회귀 0)
- monkeypatch 44 site 갱신 0건 (위험 최소)
- sub-module 간 cross-module 호출은 facade 경유로 통일 (가독성 약간 ↓ 하지만 patch 정합 ↑)

**구체 패턴**:
```python
# studio/vision_pipeline/edit_source.py
from . import _common  # 같은 패키지 안의 sub-module

async def _call_vision_edit_source(...):
    # _common._describe_image 직접 호출 X — facade 경유
    from .. import vision_pipeline
    base64_data = vision_pipeline._to_base64(image_bytes)
    ...
```

→ test 가 `studio.vision_pipeline._to_base64` patch 하면 facade attribute 가 patched. `from .. import vision_pipeline` 으로 받은 module 의 _to_base64 lookup 도 patched 본 받음.

근데 이게 가독성/순환 import 측면에서 별로일 수도. **다른 옵션 = sub-module 안에서 direct import + patch site 갱신**:

#### 옵션 D — sub-module 직접 import + 44 patch site 갱신 (Phase 4.1 monkeypatch 갱신 패턴 일관)

- 4.1 에서 11 site 갱신했듯 4.2 도 44 site 갱신
- patch target 변경 (`studio.vision_pipeline._X` → `studio.vision_pipeline.<sub>._X`)
- sub-module 안 코드는 일반 Python 패턴 (`from . import _common; _common._describe_image()`)
- mechanical work 이지만 정합 ↑

**옵션 C vs D 비교**:

| 기준 | 옵션 C (facade 경유) | 옵션 D (직접 import + patch 갱신) |
|---|---|---|
| patch site 변경 | 0건 | 44건 |
| sub-module 가독성 | ↓ (`from .. import vision_pipeline; vision_pipeline.X`) | ↑ (`from . import _common; _common.X`) |
| CLAUDE.md 🔴 정책 정합 | △ (facade 경유라 lookup 은 facade) | ✅ (호출 site = patch site) |
| Phase 4.1 일관성 | (4.1 은 다른 패턴 · sub-module 안 호출 매우 적음) | △ (4.1 11 site 갱신 패턴 확장) |
| 회귀 위험 | 낮음 (patch 변경 0) | 중 (44 site 누락 위험) |

**잠정 권장 = 옵션 D** (CLAUDE.md 🔴 정책 명시 + Phase 4.1 11 site 갱신 패턴 확장).

→ codex 1차 리뷰에서 결정 받기 (위험 vs 정합 trade-off).

### 2.2 ⚠️ lazy import `_describe_image` + `_DEFAULT_OLLAMA_URL`

`reference_storage.py:121` + `video_pipeline.py:29` 에서 `from .vision_pipeline import _describe_image`.

`_DEFAULT_OLLAMA_URL` 은 vision_pipeline 안에서 prompt_pipeline 의 const 를 그대로 re-export. 분할 후 facade 가 명시 re-export 필요 (`from .vision_pipeline import _DEFAULT_OLLAMA_URL` 도 `_common.py` 의 alias 가 됨).

→ facade `__init__.py` 의 명시 import + `__all__` 에 모두 포함.

### 2.3 cross-module 호출 의존도

- `run_vision_pipeline` (edit_source) → `_describe_image` (공용) + `_call_vision_edit_source` (같은 그룹) + `upgrade_edit_prompt` (prompt_pipeline · 외부)
- `analyze_image_detailed` (image_detail) → `_call_vision_recipe_v2` (같은 그룹) + `_describe_image` (공용 폴백) + `translate_to_korean` (prompt_pipeline · 외부)
- `_call_vision_edit_source` / `_call_vision_recipe_v2` → `_to_base64` (공용) + `call_chat_payload` (_ollama_client 외부)

→ edit_source / image_detail 둘 다 _common 에 의존. _common 은 stand-alone.

---

## 3. 단계별 실행 plan

### 단계 1 — facade rename + lazy import depth fix (1 commit)
- `git mv backend/studio/vision_pipeline.py backend/studio/vision_pipeline/__init__.py`
- module → package 전환
- (Phase 4.1 단계 1 패턴) lazy import depth 변경 site grep 후 fix:
  - `from ._json_utils import` → `from .._json_utils import` (sub-module 으로 옮길 때만 영향)
  - `from ._ollama_client import` → 동일
  - `from .presets import` → 동일
  - `from .prompt_pipeline import` → 동일
  - 단, facade `__init__.py` 안에선 그대로 유지 (depth 동일)
- 검증: `pytest tests/studio/` 361 PASS

### 단계 2 — _common.py 분리 + cross-module 패턴 결정 (1 commit)
- `_common.py` 신규: ProgressCallback / VISION_SYSTEM / _describe_image / _to_base64 / _DEFAULT_OLLAMA_URL alias / DEFAULT_TIMEOUT alias / log
- facade `__init__.py` 갱신: `_common` 항목 제거 + `from ._common import ...` 명시 import
- 외부 import 영향 0건 (facade re-export)
- 검증: `pytest tests/studio/` 361 PASS

### 단계 3 — edit_source.py 분리 (1 commit)
- 옵션 D 채택 시: sub-module 안 `from . import _common; _common._describe_image()` 패턴
- patch target 갱신 (이번 commit 안 또는 단계 5 일괄)
- EDIT_VISION_ANALYSIS_SYSTEM / EditSlotEntry / EditVisionAnalysis / _empty_fallback_slots / _coerce_* / _call_vision_edit_source / analyze_edit_source / run_vision_pipeline 모두 이동
- facade re-export 갱신
- 검증: `pytest tests/studio/` 361 PASS

### 단계 4 — image_detail.py 분리 (1 commit)
- SYSTEM_VISION_DETAILED / _aspect_label / _call_vision_recipe_v2 / analyze_image_detailed 이동
- facade re-export 갱신
- 검증: `pytest tests/studio/` 361 PASS

### 단계 5 — patch site 44개 일괄 갱신 (옵션 D · 1 commit)
- `studio.vision_pipeline._call_vision_edit_source` → `studio.vision_pipeline.edit_source._call_vision_edit_source`
- `studio.vision_pipeline._call_vision_recipe_v2` → `studio.vision_pipeline.image_detail._call_vision_recipe_v2`
- `studio.vision_pipeline._describe_image` → `studio.vision_pipeline._common._describe_image`
- `studio.vision_pipeline.upgrade_edit_prompt` → `studio.vision_pipeline.edit_source.upgrade_edit_prompt` (Edit 흐름이 import 받음)
- `studio.vision_pipeline.translate_to_korean` → `studio.vision_pipeline.image_detail.translate_to_korean`
- `studio.vision_pipeline.asyncio.sleep` → `studio.vision_pipeline.edit_source.asyncio.sleep` (run_vision_pipeline 의 단계별 unload sleep)
- 단계 5 종료 grep assertion: `grep -rn 'studio\.vision_pipeline\.[^_]' backend/tests/ | grep -v "edit_source\.\|image_detail\.\|_common\."` = 0 (구버전 patch 잔여 검출)
- 검증: `pytest tests/` 361 PASS

### 단계 6 — facade 정리 + `__all__` 명시 (1 commit)
- 옛 stale comment 제거
- 명시 import + `__all__` (Phase 4.1 패턴)
- 검증: `pytest tests/` 361 PASS + ruff clean

### 단계 7 — changelog + master --no-ff merge (2 commit)

**예상 commit 수**: 8 (rename + _common + edit_source + image_detail + patch + facade + changelog + merge)

---

## 4. 검증 plan

각 단계별:
- `pytest tests/studio/test_edit_vision_analysis.py -v` — Edit 흐름 직접
- `pytest tests/studio/test_vision_analyzer.py -v` — Vision Analyzer 직접
- `pytest tests/studio/test_role_slot_removal.py -v` — Edit slot 검증
- `pytest tests/studio/test_matrix_directive_block.py -v` — Edit 매트릭스 directive
- `pytest tests/studio/test_comparison_pipeline.py -v` — comparison 의 vision_pipeline import 검증
- `pytest tests/` 풀 (361 PASS)

단계 5 종료 grep assertion (옵션 D 채택 시):
```bash
grep -rn 'studio\.vision_pipeline\.[A-Za-z_]\+' backend/tests/ \
  | grep -v "studio\.vision_pipeline\.\(edit_source\|image_detail\|_common\)\." \
  | grep -v "from studio\.vision_pipeline import"
# = 0 이어야 통과
```

---

## 5. 외부 import 영향 (12 파일)

### Production (7 파일)
- `studio/comparison_pipeline.py:34` — `from .vision_pipeline import ProgressCallback`
- `studio/pipelines/edit.py:33` — `from ..vision_pipeline import run_vision_pipeline`
- `studio/pipelines/vision_analyze.py:25` — `from ..vision_pipeline import analyze_image_detailed`
- `studio/reference_storage.py:121` — lazy `from .vision_pipeline import _DEFAULT_OLLAMA_URL, _describe_image`
- `studio/router.py:116` — `from .vision_pipeline import run_vision_pipeline` (re-export)
- `studio/video_pipeline.py:29` — `from .vision_pipeline import _describe_image`

→ facade `__init__.py` 에서 모두 명시 re-export 시 변경 0건.

### Test (5 파일)
- `tests/studio/test_edit_vision_analysis.py:31` — Edit slot dataclass + run_vision_pipeline 등
- `tests/studio/test_matrix_directive_block.py:14` — Edit 매트릭스 directive
- `tests/studio/test_role_slot_removal.py` (3 site) — `EditSlotEntry, EditVisionAnalysis`
- `tests/studio/test_vision_analyzer.py:19, 260, 276` — Vision Analyzer + helper

→ facade 명시 re-export + `__all__` 시 변경 0건.

---

## 6. 잠재 회귀 + 미리 박제

| 위험 | 검증 방법 | 미리 fix |
|---|---|---|
| 옵션 D 의 44 patch site 갱신 누락 | 단계 5 종료 grep assertion | grep 결과 0건 통과 게이트 |
| facade re-export 누락 (특히 EditSlotEntry / EditVisionAnalysis dataclass) | pytest collection error 즉시 검출 | `__all__` 명시 |
| `_DEFAULT_OLLAMA_URL` 가 prompt_pipeline alias 라 facade 가 prompt_pipeline 변경 시 영향 | facade 가 `from .prompt_pipeline import _DEFAULT_OLLAMA_URL` 그대로 (sub-module _common.py 도 동일) | 변경 0건 |
| edit_source.py 의 `from . import _common` 가 module load 시 _common 아직 미로드면 fail (드물지만 가능) | facade `__init__.py` 가 _common 먼저 import | facade import 순서 명시 (_common 먼저) |
| video_pipeline / reference_storage 의 lazy import (`from .vision_pipeline import _describe_image`) | facade re-export 받음 | 변경 0건 |
| comparison_pipeline 의 `ProgressCallback` import | facade 가 `_common.ProgressCallback` re-export | 변경 0건 |

---

## 7. 코덱스 리뷰 요청 사항

@codex — 본 plan v1 검토 요청 (Phase 4.1 같은 패턴):

**중점 검토 항목**:
1. 옵션 C vs D 선택 (`patch target 갱신` vs `facade 경유 호출`)
   - 44 site 갱신 위험 vs CLAUDE.md 정책 정합
   - sub-module 가독성 trade-off
2. 함수 → 그룹 매핑 검증
   - `VISION_SYSTEM` 이 Edit + Vision Analyzer 둘 다 사용? grep 결과
   - `_describe_image` 가 Vision Analyzer 폴백에도 쓰임? 확인
3. cross-module 호출 안전성
   - edit_source 가 _common.py 의 `_describe_image` 호출 시 패턴
   - 옵션 D 채택 시 patch target 정확성
4. 단계 1 의 lazy import depth fix
   - vision_pipeline.py 안에서 `from ._X` 패턴이 어디 있는지 grep 결과
5. 외부 import 12 site 외 누락 (특히 conftest.py)
6. monkeypatch 44 site 외 누락 (특히 다른 test 파일의 indirect patch)
7. NOT IN SCOPE 박스 누락 항목
8. CLAUDE.md 🔴 Critical 정합성 (옵션 C vs D 의 trade-off)

**출력 양식**: Critical / Important / Recommended 분류 + plan v1 의 구체 section 인용 + 구체 fix 제안.

**verification_loop**: 옵션 C vs D 결정 시 실제 monkeypatch 패턴 (Python attribute lookup 시점) 직접 검증.
