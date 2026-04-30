# Phase 4.5 — `comfy_api_builder.py` 1197줄 분할 plan

> **버전**: v1 (2026-04-30 · Claude 작성 · 사용자 codex 1차 리뷰 대기)
> **선행 commit**: master `c8176e1` (Phase 4.4 comparison_pipeline 분할 완료)
> **인계**: `memory/project_session_2026_04_30_phase_4_4_comparison_pipeline_split.md` + 본 plan
> **검증 baseline**: backend pytest **361 PASS** / ruff clean · frontend vitest 91 / tsc / lint clean

---

## 0. 배경 + 목적

Phase 4.4 (comparison_pipeline 1046줄) master 머지 직후 마지막 backend split (Phase 4 시리즈 마무리).

`backend/studio/comfy_api_builder.py` (1197줄) 이 세 개의 독립 빌더 흐름을 단일 파일로 묶고 있음:
- **Generate 빌더** (Qwen Image 2512 — text2img)
- **Edit 빌더** (Qwen Image Edit 2511 — img2img + multi-ref)
- **Video 빌더** (LTX-2.3 i2v + 2-stage sampling)
- **공용 헬퍼** (`_snap_dimension` / `_build_loaders` / `_apply_lora_chain` / `_build_lora_chain` / `_apply_model_sampling` / `_save_image_node` / `_make_id_gen`)

→ 그룹별 분할로 단일 책임 + 각 흐름 독립 검증 가능. Phase 4.2/4.3/4.4 와 동일 패턴 (옵션 D). 단 **monkeypatch 0건** — 가장 간단한 phase.

> **Phase 4.4 학습 활용**: lazy import 0건 검증됨 (C2 함정 없음). 분류 정확성을 위해 *실제 사용처 grep* 으로 plan 박제.

---

## 🚫 NOT IN SCOPE (절대 손대지 말 것)

- ❌ ComfyUI flat API 형식 (node id / class_type / inputs) 변경 — 단순 코드 이동
- ❌ Qwen Image 2512 / Edit 2511 / LTX Video 2.3 워크플로우 수치 (steps / cfg / sampler / shift / lora strength 등) 변경
- ❌ `build_*_from_request` / `build_generate_api` / `build_edit_api` / `_build_edit_api_single` / `_build_edit_api_multi_ref` 시그니처 변경
- ❌ `_snap_dimension` 의 8배수 스냅 로직 변경 (LTX 2.3 spatial 8배수 필수)
- ❌ Multi-ref negative prompt / role 분기 로직 변경
- ❌ 옛 dataclass 필드 (GenerateApiInput / EditApiInput) 변경
- ❌ legacy/ 디렉토리

---

## 1. 함수 → 그룹 매핑 (1197줄 전수)

| 라인 | 항목 | 그룹 | 비고 |
|---|---|---|---|
| L1~53 | docstring + imports + types (ApiPrompt / NodeRef) | facade | sub-module 가 다시 import |
| L61~66 | `_make_id_gen` | `_common.py` | 모든 build_*_api 가 사용 |
| L67~71 | `_snap_dimension` | `_common.py` | generate / edit / video 모두 사용 + production 3 site + _dispatch facade |
| L73~107 | `_build_loaders` | `_common.py` | generate + edit 가 사용 |
| L108~141 | `_apply_lora_chain` | `_common.py` | generate + edit + video 모두 사용 (`_build_video_lora_chain` 안에서) |
| L142~166 | `_build_lora_chain` | `_common.py` | generate + edit 가 사용 |
| L167~182 | `_apply_model_sampling` | `_common.py` | generate + edit 가 사용 |
| L183~206 | `_save_image_node` | `_common.py` | generate + edit 가 사용 |
| L208~239 | `GenerateApiInput` dataclass | `generate.py` | build_generate_api 의 입력 |
| L240~312 | `build_generate_api` | `generate.py` | Generate 흐름 핵심 |
| L313~398 | `build_generate_from_request` | `generate.py` | Generate 진입점 (production import) |
| L399~423 | `EditApiInput` dataclass | `edit.py` | test 가 직접 import (test_multi_ref_edit.py) |
| L424~439 | `build_edit_api` | `edit.py` | Edit dispatcher (single vs multi-ref) |
| L440~468 | `_multi_ref_negative_prompt` | `edit.py` | multi-ref 전용 |
| L469~588 | `_build_edit_api_single` | `edit.py` | 단일 이미지 Edit |
| L589~733 | `_build_edit_api_multi_ref` | `edit.py` | image1 + image2 multi-ref Edit |
| L734~772 | `build_edit_from_request` | `edit.py` | Edit 진입점 (production import) |
| L774~782 | section divider (Video) | (제거 OK) | |
| L785~801 | `_build_video_lora_chain` | `video.py` | Video 전용 (lightning 토글 없음) |
| L803~끝 | `build_video_from_request` | `video.py` | Video 진입점 (production import) |

**최종 분할** (5 파일 · Phase 4.4 와 동일 facade + 4 sub-module 패턴):
```
backend/studio/comfy_api_builder/
├── __init__.py    ~80줄  (facade · re-export + __all__)
├── _common.py    ~190줄  (ApiPrompt / NodeRef types + _make_id_gen / _snap_dimension /
│                         _build_loaders / _apply_lora_chain / _build_lora_chain /
│                         _apply_model_sampling / _save_image_node)
├── generate.py   ~210줄  (GenerateApiInput / build_generate_api / build_generate_from_request)
├── edit.py       ~360줄  (EditApiInput / build_edit_api / _multi_ref_negative_prompt /
│                         _build_edit_api_single / _build_edit_api_multi_ref /
│                         build_edit_from_request)
└── video.py      ~420줄  (_build_video_lora_chain / build_video_from_request)
```

> edit.py 가 가장 큰 sub-module (~360줄) — multi-ref 분기 + image1/image2 builder 응집. video.py 도 비슷 (~420줄) — LTX-2.3 의 2-stage sampling 자체가 큰 흐름.

---

## 2. 핵심 위험 (Phase 4.4 보다 더 작은 phase)

### 2.1 ⚠️ Mock.patch site **0건** — 갱신 작업 없음

`grep -rn "studio\.comfy_api_builder\." backend/tests/` 결과 0건. test 가 모두 *직접 import* + *실제 호출* 패턴 (mock 없음). Phase 4.5 의 핵심 안전성 — patch site 갱신 0 작업.

### 2.2 ⚠️ production import 5 site

| 호출자 | 옛 import | 새 import (단계 1 후 OK 동작) |
|---|---|---|
| `studio/pipelines/edit.py:23` | `from ..comfy_api_builder import build_edit_from_request` | facade re-export 그대로 ✅ |
| `studio/pipelines/generate.py:20` | `from ..comfy_api_builder import _snap_dimension, build_generate_from_request` | facade re-export 그대로 ✅ |
| `studio/pipelines/video.py:25` | `from ..comfy_api_builder import build_video_from_request` | facade re-export 그대로 ✅ |
| `studio/pipelines/_dispatch.py:34` | `from ..comfy_api_builder import _snap_dimension  # noqa: F401 — re-export 호환` | facade re-export 그대로 ✅ |
| `studio/routes/prompt.py:17` | `from ..comfy_api_builder import _snap_dimension` | facade re-export 그대로 ✅ |

> **결론**: production 코드 변경 0 라인. facade `__init__.py` 의 re-export 가 모든 import 경로를 그대로 보존.

### 2.3 ⚠️ test direct import 7 site

| 테스트 파일 | 옛 import | 새 import |
|---|---|---|
| `test_multi_ref_edit.py:313, 339, 470, 509, 532, 553` | `from studio.comfy_api_builder import EditApiInput / build_edit_api / build_edit_from_request` | facade re-export 그대로 ✅ |
| `test_video_builder.py:16` | `from studio.comfy_api_builder import build_video_from_request` | facade re-export 그대로 ✅ |

> **결론**: test 도 facade 통과 → 변경 0 라인.

### 2.4 facade internal import 전환 (codex C1 fix · Phase 4.2/4.3/4.4 와 동일 함정)

**🔴 단계 1 안에서 즉시 갱신 필요** — `comfy_api_builder.py` 의 단일 internal import:

```python
# 옛 (단일 모듈 시점):
from .presets import (
    EDIT_MODEL,
    GENERATE_MODEL,
    LoraEntry,
    QUALITY_BASE_SIGMAS,
    QUALITY_UPSCALE_SIGMAS,
    VIDEO_LONGER_EDGE_DEFAULT,
    VIDEO_MODEL,
    VideoLoraEntry,
    active_video_loras,
    compute_video_resize,
    get_aspect,
    get_generate_style,
    resolve_video_unet_name,
)

# 새 (패키지 전환 후 facade __init__.py 안):
from ..presets import (...)  # 한 단계 위 모듈 명시
```

> **함정**: `comfy_api_builder.py` → `comfy_api_builder/__init__.py` 로 옮기면 `.` 는 `studio.comfy_api_builder` 자체를 가리킴. Phase 4.2 (vision_pipeline) / Phase 4.3 (prompt_pipeline) / Phase 4.4 (comparison_pipeline 6 site) 와 동일 함정. 단계 1 commit 안에서 갱신 누락 시 pytest 즉시 fail.

### 2.5 sub-module internal import 패턴 (옵션 D 확정)

분할 후 sub-module 의 internal import:
- `_common.py`:
  - 외부 의존 없음 (logging / itertools / typing 만)
  - ApiPrompt / NodeRef 타입 정의 + 7 헬퍼 함수
- `generate.py`:
  - `from ..presets import GENERATE_MODEL, get_aspect, get_generate_style, LoraEntry`
  - `from . import _common as _c` + `_c._make_id_gen / _c._build_loaders / _c._apply_lora_chain / _c._build_lora_chain / _c._apply_model_sampling / _c._save_image_node / _c._snap_dimension` 사용 (옵션 D)
  - or `from ._common import ApiPrompt, NodeRef, ...` 직접 import (helpers 가 patch 대상 아니므로 OK)
- `edit.py`:
  - `from ..presets import EDIT_MODEL, LoraEntry, get_aspect`
  - `from . import _common as _c` + `_c.X` 사용 (또는 직접 import)
- `video.py`:
  - `from ..presets import (VIDEO_MODEL, VideoLoraEntry, active_video_loras, compute_video_resize, resolve_video_unet_name, VIDEO_LONGER_EDGE_DEFAULT, QUALITY_BASE_SIGMAS, QUALITY_UPSCALE_SIGMAS)`
  - `from . import _common as _c` + `_c._make_id_gen / _c._apply_lora_chain` 사용

> **옵션 D**: helpers 가 patch 대상이 아니지만 (Phase 4.5 patch 0건) 일관성 위해 `_c.X` lookup 패턴 유지. 또는 직접 import 도 OK (mock 없음 + Phase 4.5 의 작업 단순화 위해).

### 2.6 lazy import 정책 (Phase 4.3 C2 함정 검증)

`comfy_api_builder.py` 의 lazy import grep 결과 **0건**. C2 함정 없음.

---

## 3. 단계별 진행 (Phase 4.4 와 동일 6 단계)

### 단계 0: plan 문서 commit + 사용자 codex 1차 리뷰

- 본 plan 을 `docs/superpowers/plans/2026-04-30-phase-4-5-comfy-api-builder-split.md` 로 commit
- 사용자가 직접 codex 1차 리뷰 받아옴 (Phase 4.1+4.2+4.3+4.4 검증된 패턴)
- 리뷰 finding 반영하여 v2 plan 갱신 후 단계 1 진입

### 단계 1: file → package 전환 + internal import `..` 갱신 (codex C1 fix)

- `mkdir backend/studio/comfy_api_builder/`
- `mv backend/studio/comfy_api_builder.py backend/studio/comfy_api_builder/__init__.py`
- **🔴 같은 commit 안에서 즉시 갱신** (codex C1 fix):
  - L33 `from .presets import (...)` → `from ..presets import (...)`
- pytest 실행 → 361 PASS 확인 (변화 0)
- commit: `refactor(comfy_api_builder): file → package 전환 + presets import .. 갱신 (Phase 4.5 단계 1)`

### 단계 2: `_common.py` 분리 + facade re-export

- `_common.py` 신설:
  - `ApiPrompt` / `NodeRef` types
  - `_make_id_gen` / `_snap_dimension` / `_build_loaders` / `_apply_lora_chain` / `_build_lora_chain` / `_apply_model_sampling` / `_save_image_node`
- import: `import logging`, `from itertools import count`, `from typing import Any, Callable, Iterable`
- facade `__init__.py` 에서 _common 항목 명시 import + re-export
- facade 본체에서 동일 항목 정의 *제거* + facade 안 다른 함수의 호출 site 가 import 된 reference 로 그대로 작동 (helpers patch 대상 아니라 _c lookup 불필요)
- pytest → 361 PASS
- commit: `refactor(comfy_api_builder): _common 그룹 분리 (Phase 4.5 단계 2)`

### 단계 3: `generate.py` 분리

- `generate.py` 신설:
  - `GenerateApiInput` dataclass
  - `build_generate_api`
  - `build_generate_from_request`
- import: `from ..presets import GENERATE_MODEL, LoraEntry, get_aspect, get_generate_style` + `from . import _common as _c` + `from ._common import ApiPrompt, NodeRef` (또는 _c.X 호출)
- facade `__init__.py` 에서 generate 항목 import + re-export
- facade 본체에서 generate 정의 제거
- pytest → 361 PASS
- commit: `refactor(comfy_api_builder): generate 분리 (Phase 4.5 단계 3)`

### 단계 4: `edit.py` 분리

- `edit.py` 신설:
  - `EditApiInput` dataclass
  - `build_edit_api` / `_multi_ref_negative_prompt` / `_build_edit_api_single` / `_build_edit_api_multi_ref` / `build_edit_from_request`
- import: `from ..presets import EDIT_MODEL, LoraEntry, get_aspect` + `from . import _common as _c` + `from ._common import ApiPrompt, NodeRef`
- facade `__init__.py` 에서 edit 항목 import + re-export
- facade 본체에서 edit 정의 제거
- pytest → 361 PASS
- commit: `refactor(comfy_api_builder): edit 분리 (Phase 4.5 단계 4)`

### 단계 5: `video.py` 분리 + facade 정리 + `__all__`

- `video.py` 신설:
  - `_build_video_lora_chain`
  - `build_video_from_request`
- import: `from ..presets import VIDEO_MODEL, VideoLoraEntry, active_video_loras, compute_video_resize, resolve_video_unet_name, VIDEO_LONGER_EDGE_DEFAULT, QUALITY_BASE_SIGMAS, QUALITY_UPSCALE_SIGMAS` + `from . import _common as _c`
- facade `__init__.py` 정리:
  - 옛 본체 모두 제거
  - 4 sub-module 명시 import + re-export
  - `__all__` 명시:
    ```python
    __all__ = [
        # _common — types
        "ApiPrompt",
        "NodeRef",
        # _common — helpers
        "_make_id_gen",
        "_snap_dimension",
        "_build_loaders",
        "_apply_lora_chain",
        "_build_lora_chain",
        "_apply_model_sampling",
        "_save_image_node",
        # generate
        "GenerateApiInput",
        "build_generate_api",
        "build_generate_from_request",
        # edit
        "EditApiInput",
        "build_edit_api",
        "_multi_ref_negative_prompt",
        "_build_edit_api_single",
        "_build_edit_api_multi_ref",
        "build_edit_from_request",
        # video
        "_build_video_lora_chain",
        "build_video_from_request",
    ]
    ```
- pytest → 361 PASS / ruff clean
- commit: `refactor(comfy_api_builder): video 분리 + facade 정리 + __all__ (Phase 4.5 단계 5)`

### 단계 6: changelog + master `--no-ff` merge

- `docs/changelog.md` 에 Phase 4.5 항목 추가
- frontend baseline 검증 (vitest 91 / tsc / lint clean)
- master checkout → `git merge --no-ff <branch>` → push

---

## 4. 그룹 매핑 검증 (Phase 4.4 학습 — grep 실증 후 plan 박제)

| 헬퍼 | grep 결과 (호출처) | 분류 정합 |
|---|---|---|
| `_snap_dimension` | generate / edit / video / _dispatch / routes/prompt | **_common** ✅ |
| `_build_loaders` | generate + edit | **_common** ✅ |
| `_apply_lora_chain` | generate + edit + video (`_build_video_lora_chain` 안에서) | **_common** ✅ |
| `_build_lora_chain` | generate + edit | **_common** ✅ |
| `_apply_model_sampling` | generate + edit | **_common** ✅ |
| `_save_image_node` | generate + edit | **_common** ✅ |
| `_make_id_gen` | generate + edit + video | **_common** ✅ |
| `_multi_ref_negative_prompt` | edit (multi-ref 분기) only | **edit** ✅ |
| `_build_edit_api_single` / `_build_edit_api_multi_ref` | edit (`build_edit_api` dispatcher) only | **edit** ✅ |
| `_build_video_lora_chain` | video only | **video** ✅ |

→ 모든 매핑 grep 실증 후 v1 plan 박제 (Phase 4.4 의 codex C2 type finding 회피).

---

## 5. 테스트 회귀 0 보장 (Phase 4.1+4.2+4.3+4.4 정책)

- 단계 1~5 매 commit 후 `cd backend && pytest tests/` 361 PASS 확인 (회귀 0)
- 각 단계 commit 메시지 안에 pytest 결과 명시 ("361 PASS")
- ruff: `ruff check backend/studio/comfy_api_builder/` clean
- 단계 5 종료 시 frontend `npm test` (vitest 91) / `npx tsc --noEmit` / `npm run lint` clean

---

## 6. 핵심 정책 박제 (Phase 4.2/4.3/4.4 학습 재사용)

- **옵션 D 확정**: sub-module 직접 import + `_c.X()` 호출 패턴 (helpers 가 patch 대상 아니지만 일관성)
- **patch site 갱신 0**: Phase 4.5 의 가장 큰 안전 — mock.patch 0건 (Phase 4.4 의 15 / Phase 4.3 의 36 보다 단순)
- **facade alias 제거**: 단계 5 시점에 facade 안 본체 0줄 (re-export + `__all__` 만)
- **C1 동일 함정**: 단계 1 안에서 internal `.presets` → `..presets` 갱신
- **C2 함정 없음** (검증됨): comfy_api_builder 안에 lazy import 0건
- **분류 정확성** (codex C2 — Phase 4.4 학습): 그룹 매핑은 *실제 사용처 grep* 으로 실증 (위 4. 표 참조)

---

## 7. Phase 4 시리즈 마무리

Phase 4.5 master 머지 후 Phase 4 backend split 시리즈 완료:

| Phase | 대상 | 줄 수 | 분할 결과 |
|---|---|---|---|
| 4.1 | history_db.py | 886줄 | 7 파일 |
| 4.1.1 | helper 추출 | (작음) | replace_reference_ref_if_current |
| 4.2 | vision_pipeline.py | 1131줄 | 4 파일 |
| 4.3 | prompt_pipeline.py | 975줄 | 5 파일 |
| 4.4 | comparison_pipeline.py | 1046줄 | 4 파일 |
| 4.5 | comfy_api_builder.py | 1197줄 | 5 파일 |

**총 5,235줄 → 25 파일** (각 파일 평균 ~210줄). 단일 책임 + 옵션 D 일관 적용.
