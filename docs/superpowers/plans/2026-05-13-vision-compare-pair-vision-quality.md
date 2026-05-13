# Vision Compare Pair Vision 품질 개선 Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not implement optional follow-ups until the MVP is verified with real images.

**Goal:** `/vision/compare`의 최종 차이 판단을 gemma4 text 합성 중심에서 pair vision 중심으로 전환한다. 기존 단독 observation 자산은 유지하고, 최종 비교/점수는 A+B 이미지를 동시에 보는 vision 모델 결과를 우선한다.

**Architecture:** MVP는 `observe1 → observe2 → pair-compare → unload vision → translation`이다. `pair-compare`는 vision 모델에 두 이미지를 동시에 전달하고 기존 `VisionCompareAnalysisV4` shape로 정규화 가능한 JSON을 반환한다. pair vision 실패 시 기존 `synthesize_diff(obs1, obs2, hint)`를 fallback으로 사용한다.

**Spec:** `docs/superpowers/specs/2026-05-13-vision-compare-pair-vision-quality-design.md`

**Important constraint:** 현재 작업 트리는 다른 수정이 이미 있을 수 있다. 이 plan 구현 시 관련 파일만 건드리고, unrelated change는 되돌리지 않는다.

---

## Done Condition

- `context="compare"` 흐름에서 stage가 `compare-encoding → observe1 → observe2 → pair-compare → translation` 순서로 동작한다.
- pair vision은 Ollama payload의 `images` 배열에 `[A, B]` 순서로 두 이미지를 전달한다.
- 최종 응답 shape는 기존 `VisionCompareAnalysisV4`와 호환된다.
- pair vision 실패 시 기존 `diff_synthesize` fallback으로 결과가 반환된다.
- vision model unload는 pair vision 이후, text model 호출 이전에 실행된다.
- frontend 진행 모달과 테스트가 `pair-compare` stage를 인식한다.
- 실제 이미지 2쌍 이상으로 품질을 수동 확인한다.

---

## Phase Map

| Phase | 범위 | 목적 |
|---|---|---|
| 0 | Preflight | 현재 테스트/파일 기준 확인, 구현 범위 고정 |
| 1 | Backend pair module | `pair_compare.py` 신설, 두 이미지 동시 vision 호출 구현 |
| 2 | Backend pipeline | `analyze_pair_v4` orchestration 변경, fallback/unload 정리 |
| 3 | SSE + Frontend stage | `pair-compare` stage를 task pipeline과 UI에 반영 |
| 4 | Test update | backend/frontend 단위 테스트 갱신 |
| 5 | Verification | 타입/테스트/수동 이미지 검증 |
| 6 | Follow-up options | finalize stage, slider aspect, score tuning 등 후속만 분리 |

---

## Phase 0: Preflight

**의도:** 구현 전 기준선을 확인하고 MVP 범위를 고정한다.

**Files to inspect:**

```
backend/studio/compare_pipeline_v4/pipeline.py
backend/studio/compare_pipeline_v4/diff_synthesize.py
backend/studio/compare_pipeline_v4/_coerce.py
backend/studio/compare_pipeline_v4/_types.py
backend/studio/comparison_pipeline/v3.py
backend/studio/pipelines/compare_analyze.py
frontend/lib/pipeline-defs.tsx
frontend/__tests__/api-vision-compare.test.ts
backend/tests/test_compare_v4_pipeline.py
backend/tests/test_compare_persist_context.py
```

- [ ] `git status --short`로 기존 변경 파일을 확인한다.
- [ ] `comparison_pipeline/v3.py::_call_vision_pair()`의 `images: [source, result]` payload 방식을 다시 확인한다.
- [ ] `diff_synthesize.py`의 V4 JSON schema와 `_coerce` helper 사용 방식을 확인한다.
- [ ] MVP 범위를 고정한다.
  - 포함: `pair_compare.py`, pipeline orchestration, SSE/frontend stage, tests
  - 제외: gemma4 finalize stage, 별도 evidence schema, slider aspect fix, 점수 대규모 튜닝

**Phase 0 exit:** 구현 범위가 MVP로 고정되고, 관련 테스트 위치를 확인했다.

---

## Phase 1: Backend `pair_compare.py`

**의도:** vision 모델이 A/B 두 이미지를 동시에 보고 최종 비교 JSON을 만들 수 있게 한다.

**Create:**

```
backend/studio/compare_pipeline_v4/pair_compare.py
backend/tests/test_compare_v4_pair_compare.py
```

**Recommended public API:**

```python
async def compare_pair_with_vision(
    *,
    image1_bytes: bytes,
    image2_bytes: bytes,
    image1_w: int,
    image1_h: int,
    image2_w: int,
    image2_h: int,
    observation1: dict[str, Any],
    observation2: dict[str, Any],
    compare_hint: str,
    vision_model: str,
    text_model: str,
    timeout: float,
    ollama_url: str,
    keep_alive: str | None = None,
) -> CompareAnalysisResultV4:
    ...
```

### Task 1.1: system prompt 작성

- [ ] `PAIR_COMPARE_SYSTEM` 상수를 추가한다.
- [ ] 반드시 포함할 규칙:
  - `Image 1 = A`, `Image 2 = B`
  - observations are hints, not truth
  - image evidence overrides observation text
  - strict JSON only
  - identity/brand/celebrity 금지
  - boilerplate 금지
  - score hard caps
- [ ] 출력 schema는 MVP에서 기존 `diff_synthesize.py`와 같은 V4 JSON schema를 사용한다.

### Task 1.2: user payload 작성

- [ ] `_build_user_payload(...)` helper를 만든다.
- [ ] 포함 항목:
  - A/B 이미지 크기
  - observation1 JSON
  - observation2 JSON
  - compare hint 또는 placeholder
  - 고정 verification checklist
- [ ] checklist는 코드 고정 문자열로 넣는다. MVP에서는 gemma4 checklist 생성 단계를 추가하지 않는다.

### Task 1.3: Ollama vision call 구현

- [ ] `call_chat_payload()`를 사용한다.
- [ ] payload는 `format: "json"`, `stream: False`를 사용한다.
- [ ] `messages[-1]["images"]`에 `[A, B]` 순서로 base64를 넣는다.
- [ ] base64 helper는 기존 helper를 재사용한다. 새 구현을 만들지 않는다.
- [ ] `keep_alive` 기본값은 `resolve_ollama_keep_alive()`로 맞춘다.
- [ ] 권장 options:

```python
"options": {"temperature": 0.2, "num_ctx": 8192}
```

### Task 1.4: result normalize

- [ ] `parse_strict_json()`으로 응답을 파싱한다.
- [ ] `_coerce` helper를 써서 `CompareAnalysisResultV4`를 만든다.
- [ ] `observation1`, `observation2`는 최종 result에 그대로 보존한다.
- [ ] `provider="ollama"`, `fallback=False`를 정상 결과에 설정한다.
- [ ] 실패 시 `fallback=True`인 빈 result를 반환한다.
- [ ] pair 실패와 mixed/null score는 구분한다. 호출 실패/parse 실패만 fallback이다.

### Task 1.5: unit tests

- [ ] payload에 `images`가 정확히 2개 들어가는지 검증한다.
- [ ] A/B 순서가 보존되는지 검증한다.
- [ ] prompt에 observation1/2와 compare hint가 포함되는지 검증한다.
- [ ] 성공 JSON이 `CompareAnalysisResultV4`로 정규화되는지 검증한다.
- [ ] call 실패/empty response/parse 실패가 fallback result를 반환하는지 검증한다.

**Phase 1 exit:** `compare_pair_with_vision()` 단위 테스트가 통과한다.

---

## Phase 2: Backend Pipeline Orchestration

**의도:** 기존 `diff-synth` 중심 흐름을 pair vision 중심으로 바꾸되, 실패 시 기존 diff fallback을 유지한다.

**Modify:**

```
backend/studio/compare_pipeline_v4/pipeline.py
backend/studio/compare_pipeline_v4/__init__.py
backend/tests/test_compare_v4_pipeline.py
```

### Task 2.1: facade export

- [ ] `compare_pipeline_v4/__init__.py`에서 `PAIR_COMPARE_SYSTEM`, `compare_pair_with_vision`을 re-export한다.
- [ ] 기존 `synthesize_diff` export는 fallback 테스트와 호환을 위해 유지한다.

### Task 2.2: `analyze_pair_v4()` stage 순서 변경

현재:

```
observe1
→ observe2
→ unload vision
→ diff-synth
→ translation
```

변경:

```
observe1
→ observe2
→ pair-compare
→ unload vision
→ translation
```

- [ ] `observe2` 성공 후 vision unload를 즉시 하지 않는다.
- [ ] `_signal("pair-compare")` 후 `compare_pair_with_vision()`을 호출한다.
- [ ] pair 결과가 정상이면 그 result를 translation에 넘긴다.
- [ ] pair 결과가 fallback이면 vision unload 후 기존 `synthesize_diff()`를 호출한다.
- [ ] fallback `synthesize_diff()` 호출 전에는 반드시 vision unload + `sleep(1.0)`을 수행한다.
- [ ] 최종 fallback 결과에서는 translation을 skip하는 기존 정책을 유지한다.

### Task 2.3: unload 위치 검증

- [ ] 정상 pair path에서 unload는 `pair-compare` 이후, `translation` 이전에 호출된다.
- [ ] pair fallback path에서 unload는 `synthesize_diff` 이전에 호출된다.
- [ ] unload 실패는 non-fatal log만 남긴다.

### Task 2.4: pipeline tests 갱신

- [ ] stage order 기대값을 `observe1, observe2, pair-compare, translation`으로 바꾼다.
- [ ] 기존 `diff_synthesize 1번` 기대는 pair fallback 테스트로 이동한다.
- [ ] pair 정상 path에서는 `synthesize_diff`가 호출되지 않음을 검증한다.
- [ ] pair fallback path에서는 `synthesize_diff`가 호출됨을 검증한다.
- [ ] observation 실패 fallback은 기존대로 유지한다.

**Phase 2 exit:** backend pipeline 단위 테스트가 새 stage 순서로 통과한다.

---

## Phase 3: SSE + Frontend Stage

**의도:** 진행 모달과 SSE 테스트가 새 `pair-compare` stage를 정확히 인식하게 한다.

**Modify:**

```
backend/studio/pipelines/compare_analyze.py
backend/tests/test_compare_persist_context.py
frontend/lib/pipeline-defs.tsx
frontend/__tests__/api-vision-compare.test.ts
frontend/__tests__/pipeline-defs-consistency.test.ts
```

### Task 3.1: backend progress mapping

- [ ] `_V4_PROGRESS`에서 `diff-synth`를 제거하고 `pair-compare`를 추가한다.

```python
_V4_PROGRESS = {
    "observe1": 20,
    "observe2": 40,
    "pair-compare": 65,
    "translation": 90,
}
```

- [ ] `_V4_LABEL`도 갱신한다.

```python
"pair-compare": "동시 비교 (qwen3-vl)"
```

- [ ] compare context docstring도 새 stage 순서로 수정한다.

### Task 3.2: frontend pipeline defs

- [ ] `PIPELINE_DEFS.compare`에서 `diff-synth` entry를 `pair-compare`로 교체한다.
- [ ] label은 `동시 비교`, subLabel은 `visionSubLabel`을 사용한다.
- [ ] renderDetail은 MVP에서 제거하거나 단순 유지한다. pair stage callback이 summary payload를 넘기지 않는다면 summary detail을 기대하지 않는다.

### Task 3.3: frontend API/stage tests

- [ ] mock SSE fixture에서 `diff-synth` 대신 `pair-compare`를 사용한다.
- [ ] compare stage sequence 테스트를 갱신한다.
- [ ] `vision-pair`가 compare context에 다시 들어오지 않는다는 기존 보장은 유지한다.

**Phase 3 exit:** frontend stage 관련 테스트가 `pair-compare` 기준으로 통과한다.

---

## Phase 4: Test Update And Narrow Verification

**의도:** 구현 변경의 직접 영향 범위만 먼저 검증한다.

### Backend commands

PowerShell 기준:

```powershell
cd backend
python -m pytest tests/test_compare_v4_pair_compare.py tests/test_compare_v4_pipeline.py tests/test_compare_persist_context.py tests/test_diff_synthesize.py
python -m pytest tests/test_compare_route_validation.py tests/test_compare_v4_translate.py
```

검증 포인트:

- pair module 단위 테스트 통과
- pipeline stage 순서 통과
- compare context persist 차단 유지
- 기존 translate retry/fallback 테스트 유지
- source_ref/result_ref route 검증 유지

### Frontend commands

```powershell
cd frontend
npx vitest run __tests__/api-vision-compare.test.ts __tests__/pipeline-defs-consistency.test.ts
npx tsc --noEmit
```

검증 포인트:

- SSE `pair-compare` forwarding 통과
- pipeline defs consistency 통과
- type error 없음

**Phase 4 exit:** narrow backend/frontend tests가 통과한다.

---

## Phase 5: Manual Dogfooding

**의도:** 실제 품질 이슈가 개선됐는지 확인한다. 이 phase 전에는 점수 cap을 추가 조정하지 않는다.

### Case 1: 같은 인물, 의상/구도 크게 변화

입력:

- A: 흰색 홀터/비키니 상의, 허리 위 인물
- B: 흰색 탑 + 베이지 카디건 + 검은색 바지, close-up 인물

기대:

- 의상 변화가 상단 차이점에 나온다.
- crop/framing 변화가 명확히 나온다.
- `fidelityScore`가 80대 후반/90대로 과대평가되지 않는다.
- 한국어 결과에 영어 fallback이 섞이지 않는다.

### Case 2: 거의 동일한 이미지

기대:

- 공통점이 구체적이다.
- 차이점이 과장되지 않는다.
- score가 높게 나온다.

### Case 3: 완전히 다른 도메인

기대:

- `domainMatch = mixed`
- `fidelityScore = null`
- 공통/차이 디스커버리 중심으로 표시된다.

### Optional runtime check

- [ ] DevTools console에 CORS 이미지 fetch 에러가 다시 생기지 않는지 확인한다.
- [ ] compare modal stage가 `pair-compare`에서 멈추지 않는지 확인한다.
- [ ] pair vision 실패를 강제로 mock했을 때 기존 diff fallback이 동작하는지 확인한다.

**Phase 5 exit:** 실제 이미지 2쌍 이상에서 pair vision 결과가 기존 diff-only 결과보다 낫다고 판단된다.

---

## Phase 6: Follow-up Options

이 phase는 MVP 검증 후 별도 작업으로만 진행한다.

### Option A: gemma4 finalize stage

도입 조건:

- pair vision JSON이 너무 거칠거나 UI 문장 품질이 낮다.
- 단, pair vision의 시각 판단은 맞다.

추가 흐름:

```
pair-compare
→ unload vision
→ finalize
→ translation
```

주의:

- finalize는 pair vision 결과에 없는 시각 사실을 추가하면 안 된다.
- observation과 pair vision이 충돌하면 pair vision을 우선한다.

### Option B: 내부 evidence schema

도입 조건:

- pair vision이 기존 V4 schema를 직접 안정적으로 못 채운다.

추가:

```
PairCompareEvidence → finalize → VisionCompareAnalysisV4
```

### Option C: Slider aspect fix

도입 조건:

- 모델 분석은 개선됐지만 비교 화면에서 슬라이더 비율 때문에 품질 체감이 계속 나쁘다.

범위:

- `CompareSliderViewer.tsx` 또는 `BeforeAfterSlider`에서 A 이미지 기준 aspect ratio를 명시한다.
- 모델 파이프라인 변경과 같은 commit에 섞지 않는다.

### Option D: Score rubric tuning

도입 조건:

- 실제 샘플 5~10개에서 score가 일관되게 높거나 낮다.

주의:

- prompt hard cap만 먼저 조정한다.
- frontend에서 점수를 임의 보정하지 않는다.

---

## Implementation Notes

- `pair-compare` stage 이름을 사용한다. `pair-verify`는 후속 evidence 검증형으로 남긴다.
- pair compare는 이미 route/pipeline이 보유한 `image1_bytes`, `image2_bytes`를 사용한다.
- 프론트에서 `/images/studio/...`를 fetch해서 Blob으로 바꾸는 흐름을 새로 만들지 않는다.
- `source_ref` / `result_ref` 기반 backend local read 흐름은 그대로 유지한다.
- `diff-synth`는 fallback 내부 구현으로 남기되, 정상 UI stage에서는 숨긴다.
- 이 plan에서는 `docs/changelog.md` 갱신은 선택이다. 실제 구현 완료 후 사용자-facing 변경으로 정리할 때 갱신한다.

---

## Final Verification Checklist

- [ ] `backend/tests/test_compare_v4_pair_compare.py` 통과
- [ ] `backend/tests/test_compare_v4_pipeline.py` 통과
- [ ] `backend/tests/test_compare_persist_context.py` 통과
- [ ] `backend/tests/test_compare_route_validation.py` 통과
- [ ] `frontend/__tests__/api-vision-compare.test.ts` 통과
- [ ] `frontend/__tests__/pipeline-defs-consistency.test.ts` 통과
- [ ] `frontend npx tsc --noEmit` 통과
- [ ] 실제 compare run에서 stage 순서 확인
- [ ] 실제 이미지 결과에서 한국어 fallback 없음 확인
- [ ] pair vision 실패 fallback path 확인
