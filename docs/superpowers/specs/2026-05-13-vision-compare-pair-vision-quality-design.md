# Vision Compare 품질 개선 — Pair Vision 중심 구조 설계

**작성일**: 2026-05-13  
**상태**: 오후 구현 전 기획 문서  
**대상**: `/vision/compare` V4 파이프라인 품질 개선  
**관련 문서**:
- `docs/superpowers/specs/2026-05-05-vision-compare-redesign-design.md`
- `docs/superpowers/plans/2026-05-03-vision-2stage-pipeline.md`
- `docs/superpowers/plans/2026-05-03-vision-precision-recall.md`
- `docs/superpowers/specs/2026-05-11-video-vision-pipeline-improvement-design.md`

---

## 0. 결론

현재 Vision Compare V4는 `A 이미지 관찰 → B 이미지 관찰 → gemma4가 관찰 JSON만 보고 차이 합성` 구조다. 이 구조는 각 이미지의 단독 관찰 결과를 재사용할 수 있다는 장점은 있지만, 최종 비교 판단을 이미지가 보이지 않는 gemma4가 담당한다는 한계가 있다.

이번 품질 개선의 핵심 방향은 다음과 같다.

```
observe A
→ observe B
→ pair vision compare(A+B 동시 시각 비교)
→ gemma4 translate 또는 제한적 finalize
```

즉, 최종 시각 비교 판단은 다시 비전 모델이 맡고, gemma4는 문장 정리와 한국어 번역만 담당한다. gemma4는 이미지를 볼 수 없으므로 새로운 시각 사실을 추가하면 안 된다.

오후 구현 MVP는 **pair vision compare를 새 `pair-compare` stage로 추가**하고, 기존 `VisionCompareAnalysisV4` 응답 shape는 유지하는 방향이 가장 안전하다.

---

## 1. 현재 확인한 정보

### 1.1 모델 역할

| 역할 | 현재 기본값 | 근거 파일 | 비고 |
|---|---|---|---|
| Vision model | `qwen3-vl:8b` | `backend/studio/presets.py`, `frontend/lib/model-presets.ts` | `STUDIO_VISION_MODEL`로 교체 가능 |
| Text model | `gemma4-un:latest` | `backend/studio/presets.py`, `frontend/lib/model-presets.ts` | 이미지 직접 판독 불가. 관찰 JSON/비전 결과만 처리 |
| keep_alive | `5m` | `resolve_ollama_keep_alive()` | vision 연속 호출에는 유리, 모델 전환 시 VRAM 점유 주의 |

### 1.2 현재 V4 파이프라인

현재 `backend/studio/compare_pipeline_v4/pipeline.py` 흐름:

```
compare-encoding
→ observe1      qwen3-vl
→ observe2      qwen3-vl
→ unload vision + sleep 1.0
→ diff-synth    gemma4-un
→ translation   gemma4-un
```

`observe_image()`는 `backend/studio/vision_pipeline/vision_observe.py`의 구조화 관찰자다. 출력에는 프레이밍, 인물, 얼굴, 의상, 상호작용, 배경, 조명, 품질, uncertain 등이 포함된다.

`diff_synthesize.py`는 두 observation JSON만 입력받는다. 따라서 observation이 놓친 차이점은 뒤에서 복구할 수 없다.

### 1.3 두 이미지 동시 vision 호출 선례

`backend/studio/comparison_pipeline/v3.py::_call_vision_pair()`에는 Ollama chat payload의 `images` 배열에 두 이미지를 순서대로 넣는 구현 선례가 있다.

```python
"images": [_to_b64(source_bytes), _to_b64(result_bytes)]
```

이 선례를 Vision Compare V4에도 재사용할 수 있다. 새 구현은 `Image 1 = A`, `Image 2 = B` 순서 보장을 테스트로 고정해야 한다.

### 1.4 프론트 진행 stage

현재 `frontend/lib/pipeline-defs.tsx`의 compare stage:

```
compare-encoding
→ observe1
→ observe2
→ diff-synth
→ translation
```

pair vision compare를 새 stage로 만들면 `diff-synth`를 `pair-compare` 또는 `pair-verify`로 바꾸고 프론트 stage 정의도 같이 수정해야 한다.

---

## 2. 문제 정의

### 2.1 품질 문제

사용자 검증 화면에서 분석은 대체로 맞지만 얕다.

- 공통점이 너무 일반적이다.
- 차이점은 잡지만, 실제 이미지 대조 기반의 확신이 약하다.
- 유사도 점수가 시각 변화량 대비 높게 나올 수 있다.
- gemma4가 observation JSON을 바탕으로 자연스럽게 문장을 만들면서, 실제 이미지 비교라기보다 관찰 요약 재조합처럼 보인다.

### 2.2 구조적 원인

현재 구조에서 최종 비교자는 gemma4다.

```
이미지 A → vision observation JSON
이미지 B → vision observation JSON
두 JSON → gemma4 diff
```

gemma4는 이미지를 보지 못한다. 그래서 다음 문제가 생긴다.

- A/B를 한 화면에서 직접 대조하지 못한다.
- observation이 누락하거나 애매하게 쓴 내용을 재검증하지 못한다.
- `두 이미지가 얼마나 비슷한지` 같은 상대 판단이 약해진다.
- 점수 산정이 실제 픽셀/구도/의상 변화보다 텍스트 표현에 끌릴 수 있다.

---

## 3. 후보 구조

| 옵션 | 구조 | 장점 | 리스크 | 판단 |
|---|---|---|---|---|
| A. 현재 구조 보강 | observe A/B → gemma4 diff prompt 강화 | 구현 작음 | 이미지 직접 비교 한계 그대로 | 비추천 |
| B. A 관찰을 B 관찰에 주입 | observe A → observe B with A context → gemma4 | B 관찰이 A 기준으로 세밀해질 수 있음 | A 관찰 오류가 B 관찰을 편향시킴. 최종 비교자는 여전히 gemma4 | 보조 후보 |
| C. Pair vision only | A+B 동시 vision → 결과 | 최종 판단이 vision 중심 | 단독 observation 재사용/t2i prompt 자산 약화 | 너무 단순 |
| D. Dual observe + pair vision | observe A/B → A+B 동시 vision compare → gemma4 정리 | 단독 관찰 자산 유지 + 최종 비교는 vision 담당 | 호출 1회 증가 | 추천 |

추천은 D다.

---

## 4. 추천 파이프라인

### 4.1 오후 MVP

```
compare-encoding
→ observe1                 vision
→ observe2                 vision
→ pair-compare             vision, A+B 동시 입력
→ unload vision + sleep
→ translation              gemma4
```

MVP에서는 gemma4 `finalize` stage를 따로 두지 않아도 된다. pair vision이 기존 `VisionCompareAnalysisV4`에 가까운 JSON을 직접 출력하게 하고, 기존 `translate_v4_result()`로 한국어 필드만 채우는 편이 구현량이 작다.

### 4.2 개선형

```
compare-encoding
→ observe1
→ observe2
→ pair-compare             PairCompareEvidence 생성
→ unload vision + sleep
→ finalize                 gemma4, 기존 V4 schema로 정리
→ translation              gemma4
```

개선형에서는 pair vision이 증거 중심 JSON을 내고, gemma4가 UI용 schema로 정리한다. 단, finalize prompt에는 다음 규칙이 필요하다.

- pair vision 결과에 없는 시각 사실을 추가하지 않는다.
- observation과 pair vision이 충돌하면 pair vision을 우선한다.
- 애매한 내용은 `uncertain`에 남긴다.

### 4.3 gemma4를 pair vision 전에 넣지 않는 이유

사용자 아이디어 중 `observe A/B → gemma4 상황 파악 → A+B pair vision → gemma4 정제`는 논리적으로 가능하다. 하지만 현재 환경에서는 다음 비용이 있다.

```
vision → vision → text → vision → text
```

이 순서는 모델 스왑이 두 번 발생한다. 16GB VRAM 환경에서는 `qwen3-vl`과 `gemma4-un` 전환 비용이 커지고, keep_alive 때문에 모델이 동시에 남아 swap 위험이 생긴다.

따라서 오후 MVP는 vision 호출을 연속으로 묶는다.

```
vision → vision → vision → unload → text
```

중간 checklist가 필요하면 gemma4가 아니라 코드에서 고정 체크리스트를 만들어 pair vision prompt에 넣는다.

---

## 5. 새 내부 계약

### 5.1 외부 응답 shape 유지

프론트와 기존 렌더러 영향 최소화를 위해 최종 응답은 기존 `VisionCompareAnalysisV4`를 유지한다.

유지 필드:

- `summaryEn`, `summaryKo`
- `commonPointsEn`, `commonPointsKo`
- `keyDifferencesEn`, `keyDifferencesKo`
- `domainMatch`
- `categoryDiffs`
- `categoryScores`
- `keyAnchors`
- `fidelityScore`
- `transformPromptEn`, `transformPromptKo`
- `uncertainEn`, `uncertainKo`
- `observation1`, `observation2`
- `provider`, `fallback`, `analyzedAt`, `visionModel`, `textModel`

### 5.2 신규 내부 evidence shape 후보

개선형을 택할 경우 pair vision은 아래 내부 schema를 출력한다.

```json
{
  "visual_summary": "",
  "domain_match": "person|object_scene|mixed",
  "same_subject_confidence": 0,
  "common_points": [],
  "key_differences": [],
  "category_diffs": {
    "composition": { "image1": "", "image2": "", "diff": "" },
    "subject": { "image1": "", "image2": "", "diff": "" },
    "clothing_or_materials": { "image1": "", "image2": "", "diff": "" },
    "environment": { "image1": "", "image2": "", "diff": "" },
    "lighting_camera_style": { "image1": "", "image2": "", "diff": "" }
  },
  "category_scores": {
    "composition": null,
    "subject": null,
    "clothing_or_materials": null,
    "environment": null,
    "lighting_camera_style": null
  },
  "key_anchors": [
    { "label": "", "image1": "", "image2": "", "changed": true }
  ],
  "fidelity_score": null,
  "transform_prompt": "",
  "observation_corrections": [],
  "uncertain": ""
}
```

MVP에서는 이 shape를 생략하고 pair vision이 `CompareAnalysisResultV4`로 바로 정규화 가능한 JSON을 출력해도 된다.

---

## 6. Pair Vision prompt 정책

### 6.1 핵심 원칙

pair vision은 두 이미지를 동시에 본다. observation JSON은 보조 자료일 뿐이다.

시스템 프롬프트에 반드시 들어갈 규칙:

- You see two images in order: Image 1 = A, Image 2 = B.
- Use the observations as hints, not as truth.
- If the images contradict the observations, trust the images and write the correction.
- Compare visible facts only.
- Do not identify real people, celebrities, brands, or copyrighted characters.
- Output strict JSON only.
- Do not use boilerplate such as `masterpiece`, `golden hour`, `85mm lens`, `cinematic editorial` unless visibly supported.

### 6.2 user payload 구성

```
Image 1 = A.
Image 2 = B.

Image A size: {w1}x{h1}
Image B size: {w2}x{h2}

Observation A:
{...}

Observation B:
{...}

User comparison hint:
{hint or "(not provided - compare all aspects)"}

Verification checklist:
- Compare clothing/top/bottom/accessories.
- Compare crop/framing/camera angle.
- Compare gaze/head angle/expression.
- Compare pose/hands/object interaction.
- Compare background and lighting.
- Call out observation corrections if visible evidence differs.
```

### 6.3 점수 보정 규칙

현재 예시처럼 같은 인물이어도 의상과 구도가 크게 바뀌면 78점대가 높게 느껴질 수 있다. pair vision prompt에는 hard cap을 명시한다.

권장 rubric:

- 같은 인물/대상이어도 의상 카테고리가 크게 바뀌면 `fidelity_score <= 82`.
- 프레이밍이 waist-up에서 close-up 또는 큰 crop 변화면 `composition <= 85`.
- 시선, 머리 각도, 표정, 포즈 중 2개 이상 바뀌면 `fidelity_score <= 82`.
- 의상, 포즈, 구도 중 2개 이상 큰 변화면 `fidelity_score <= 78`.
- 이미지가 본질적으로 다른 컨셉이면 `fidelity_score = null`.
- 확신이 낮으면 낮게 준다. 과대평가보다 과소평가를 우선한다.

---

## 7. Backend 구현 범위

### 7.1 신규 파일 후보

```
backend/studio/compare_pipeline_v4/
  pair_compare.py          # pair vision call + JSON parse + V4 result normalize
```

개선형이면 추가:

```
backend/studio/compare_pipeline_v4/
  finalize.py              # pair evidence → CompareAnalysisResultV4 정리
```

### 7.2 수정 파일

```
backend/studio/compare_pipeline_v4/pipeline.py
backend/studio/compare_pipeline_v4/__init__.py
backend/studio/compare_pipeline_v4/_types.py      # 필요 시 provider/fallback 문자열만 유지
backend/studio/pipelines/compare_analyze.py
backend/tests/test_compare_v4_pair_compare.py
backend/tests/test_compare_v4_pipeline.py
```

구현 주의:

- pair compare는 이미 route/pipeline에서 확보한 `image1_bytes`, `image2_bytes`를 그대로 사용한다.
- 프론트가 `/images/studio/...`를 직접 fetch해서 Blob으로 바꾸는 흐름을 새로 만들지 않는다.
- `source_ref` / `result_ref` 기반 로컬 이미지 처리와 충돌하지 않아야 한다.

### 7.3 fallback 정책

pair vision 실패 시 HTTP 200 원칙은 유지한다.

권장 fallback 순서:

1. `observe1` 또는 `observe2` 실패: 기존 `_fallback_result()`
2. `pair-compare` 실패: 기존 `synthesize_diff(obs1, obs2, hint)`로 fallback
3. `synthesize_diff`도 실패: fallback result

이렇게 하면 새 pair vision이 불안정해도 기존 기능은 유지된다.

### 7.4 progress stage

권장 stage:

```
compare-encoding: 5
observe1: 20
observe2: 40
pair-compare: 65
translation: 90
```

개선형에서 finalize를 넣으면:

```
pair-compare: 60
finalize: 75
translation: 90
```

기존 `diff-synth` stage type을 재사용하면 프론트 수정은 작지만 의미가 틀어진다. 오후 구현에서는 새 `pair-compare` stage를 추가하고 `pipeline-defs.tsx`도 갱신하는 편이 낫다.

---

## 8. Frontend 구현 범위

### 8.1 필수

```
frontend/lib/pipeline-defs.tsx
frontend/lib/api/compare.ts
frontend/__tests__/api-vision-compare.test.ts
```

변경:

- compare stage에서 `diff-synth`를 `pair-compare`로 교체
- stage label: `동시 비교`
- subLabel: vision model
- SSE stage forwarding 테스트 갱신

### 8.2 결과 UI는 유지

최종 response shape를 유지하면 아래 컴포넌트는 원칙적으로 수정하지 않는다.

```
frontend/components/studio/compare/CompareAnalysisPanel.tsx
frontend/components/studio/compare/CompareCommonDiffChips.tsx
frontend/components/studio/compare/CompareCategoryMatrix.tsx
frontend/components/studio/compare/CompareKeyAnchors.tsx
frontend/components/studio/compare/CompareResultHeader.tsx
```

다만 화면 품질에서 확인된 슬라이더 비율 문제는 모델 품질과 별도다. 오후에 같이 처리한다면 `CompareSliderViewer.tsx` 또는 `BeforeAfterSlider` 쪽에서 A 이미지 기준 aspect ratio를 명시하는 작은 UI 수정으로 분리한다.

---

## 9. 테스트 계획

### 9.1 Backend unit

신규 테스트:

- pair compare payload가 `images: [A, B]` 순서로 들어간다.
- pair compare prompt에 observation1/2, compare hint, checklist가 포함된다.
- pair compare 성공 시 `CompareAnalysisResultV4` shape가 유지된다.
- pair compare 실패 시 기존 `synthesize_diff` fallback이 호출된다.
- vision unload는 pair compare 이후에 호출된다.
- `translation`은 fallback 결과에서는 skip된다.

### 9.2 Frontend unit

수정 테스트:

- `pipeline-defs.tsx` compare stage에 `pair-compare`가 표시된다.
- SSE stage `pair-compare`가 progress modal에 전달된다.
- 기존 V4 결과 렌더러는 response shape 변화 없이 통과한다.

### 9.3 수동 검증 케이스

오후 구현 후 같은 샘플로 확인한다.

케이스 1: 같은 인물, 의상/구도 크게 변화

- A: 흰색 홀터/비키니 상의, 허리 위 스튜디오 인물
- B: 흰색 탑 + 베이지 카디건 + 검은색 바지, close-up 인물
- 기대:
  - 의상 변화가 핵심 차이로 상단에 나온다.
  - crop/framing 변화가 명확히 나온다.
  - `fidelity_score`가 과대평가되지 않는다.
  - 한국어 결과에 영어 fallback이 섞이지 않는다.

케이스 2: 거의 동일한 이미지

- 기대:
  - 공통점이 구체적이다.
  - 차이점이 과장되지 않는다.
  - score가 높게 나온다.

케이스 3: 완전히 다른 도메인

- 기대:
  - `domainMatch = mixed`
  - `fidelityScore = null`
  - 비교는 공통/차이 디스커버리 중심으로 표시된다.

---

## 10. 오후 구현 체크리스트

- [ ] `pair_compare.py` 추가
- [ ] pair vision system/user prompt 작성
- [ ] pair vision JSON parse/normalize 구현
- [ ] `pipeline.py` 흐름을 `observe1 → observe2 → pair-compare → unload → translation`으로 변경
- [ ] pair 실패 시 기존 `synthesize_diff` fallback 유지
- [ ] `compare_analyze.py` progress mapping에 `pair-compare` 추가
- [ ] `pipeline-defs.tsx` compare stage 갱신
- [ ] backend unit 테스트 추가
- [ ] frontend stage 테스트 갱신
- [ ] `tsc`, compare 관련 vitest, backend compare pytest 실행
- [ ] 브라우저에서 실제 이미지 2쌍 수동 확인

---

## 11. 아직 결정할 것

1. `pair-compare`가 바로 V4 JSON을 만들지, 내부 evidence JSON 후 gemma4 finalize를 둘지 결정.
   - 오후 MVP는 V4 직접 출력 추천.
   - 품질이 부족하면 finalize stage를 후속으로 추가.

2. stage type 이름.
   - 추천: `pair-compare`
   - 대안: `pair-verify`

3. 슬라이더 비율 문제를 이번 구현에 포함할지.
   - 모델 품질 이슈는 아니지만 사용자가 체감하는 비교 품질에는 영향이 크다.
   - 포함한다면 별도 작은 UI 수정으로 분리한다.

4. 점수 hard cap 수치.
   - 초기값은 이 문서의 rubric 사용.
   - 실제 5~10개 샘플 dogfooding 후 조정.

---

## 12. 최종 판단

사용자 가설은 맞다. 비전에 모든 것을 맡기는 것이 아니라, **최종 시각 판단은 비전 모델에 맡기고 gemma4는 정리자로 제한**하는 것이 정확하다.

단독 observation은 버릴 필요가 없다. A/B 각각의 구조화 관찰은 per-image t2i prompt 생성과 pair vision의 보조 컨텍스트로 가치가 있다. 다만 최종 차이 분석과 점수는 반드시 두 이미지를 동시에 본 pair vision 결과를 우선해야 한다.
