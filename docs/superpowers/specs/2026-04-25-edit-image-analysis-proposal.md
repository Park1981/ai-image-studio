# Edit 이미지 분석 로직 개선 제안서 (Draft)

**작성일**: 2026-04-25
**상태**: 의견 조율용 초안
**작성자**: Codex
**대상 독자**: Claude AI, AI Image Studio 개발자
**관련 영역**: `/edit` 이미지 수정 파이프라인의 Step 1 비전 분석

> 이 문서는 확정 스펙이 아니라, 현재 코드 기준으로 확인된 문제와 개선 방향을 정리한 검토안이다. Claude가 다른 접근을 제안해도 좋으며, 최종 결정 전에는 구현 범위와 데이터 구조를 다시 합의한다.

## 1. 목적

`/edit` 모드의 이미지 분석 결과가 현재 너무 짧고 일반적인 캡션에 가까워, 사용자가 보기에도 부족하고 프롬프트 병합 단계에도 충분한 구조 정보를 주지 못한다.

개선 목표는 다음과 같다.

- 원본 이미지의 시각 정보를 더 세밀하게 파악한다.
- 사용자 수정 지시와 관련 있는 요소를 명확히 분리한다.
- 수정해야 할 대상과 보존해야 할 대상을 동시에 파악한다.
- UI의 "비전 모델 설명" 영역에서 사용자가 신뢰할 수 있는 분석 결과를 보여준다.
- 향후 "자세히" 보기나 비교 분석과 연결할 수 있는 구조를 마련한다.

## 2. 현재 코드 기준 사실

현재 Edit 이미지 분석은 `backend/studio/vision_pipeline.py`의 `run_vision_pipeline()`에서 실행된다.

흐름은 다음과 같다.

```text
원본 이미지 + 짧은 비전 캡션 프롬프트
  -> image_description 생성
  -> image_description + 사용자 수정 지시
  -> upgrade_edit_prompt()
  -> 최종 수정 프롬프트 생성
  -> history item.visionDescription 으로 저장/표시
```

현재 `VISION_SYSTEM`은 2-3문장 캡션을 요구한다.

```text
Focus on subject, setting, style, lighting, mood.
```

즉, 현재 분석은 다음 성격에 가깝다.

- 단일 문자열 캡션
- 인물/의상/자세/배경/색감 같은 세부 축 없음
- 사용자 수정 지시를 비전 분석 단계에는 직접 반영하지 않음
- 프롬프트 업그레이드 단계에서만 이미지 설명과 수정 지시를 결합
- UI에서는 `visionDescription` 원문을 그대로 표시

## 3. 문제 인식

### 3.1 분석이 너무 얕다

2-3문장 캡션은 전체 분위기를 설명하는 데는 충분하지만, 이미지 수정에는 부족하다.

예를 들어 인물 이미지라면 최소한 다음 정보가 필요하다.

- 얼굴/헤어/표정
- 상체/하체/의상/소품
- 포즈/카메라 방향/신체 비율
- 배경 구조/주요 오브젝트
- 조명/색감/렌즈감/스타일
- 수정 지시와 직접 관련 있는 영역
- 수정하지 말고 보존해야 할 영역

### 3.2 사용자 수정 지시와 분석 결과의 연결이 약하다

사용자가 "의상만 바꿔줘"라고 입력했다면 분석은 의상을 더 자세히 봐야 한다.
사용자가 "배경을 바꿔줘"라고 입력했다면 배경의 현재 상태와 변경 대상이 명확해야 한다.

현재 구조에서는 비전 분석이 먼저 일반 캡션으로 끝나고, 이후 프롬프트 업그레이드에서만 수정 지시가 결합된다. 그래서 UI에 표시되는 분석 결과는 사용자의 의도와 덜 맞아 보일 수 있다.

### 3.3 내부용 분석과 사용자 표시용 분석이 구분되어 있지 않다

현재 `image_description` 하나가 두 역할을 모두 한다.

- 내부 역할: 최종 수정 프롬프트를 만들기 위한 컨텍스트
- 외부 역할: 사용자에게 보여주는 비전 분석 결과

이 둘은 목적이 다르다. 내부용은 프롬프트 병합에 유리해야 하고, 사용자 표시용은 읽기 쉽고 신뢰 가능해야 한다.

## 4. 제안 방향

Codex의 1차 의견은 **Edit 이미지 분석을 "일반 캡션"에서 "수정 지시 기반 구조 분석"으로 바꾸는 것**이다.

다만 한 번에 큰 변경을 넣기보다, 호환성을 지키면서 단계적으로 가는 편이 안전하다.

## 5. 제안 데이터 구조

### 5.1 최소 호환 필드

기존 `visionDescription: string`은 유지한다.
기존 UI와 히스토리 호환을 깨지 않기 위해 이 필드는 계속 채운다.

### 5.2 신규 구조 필드 후보

추가 필드명은 확정이 아니다. Claude 검토 후 조정 가능하다.

```ts
export interface EditVisionAnalysis {
  summary: string;
  edit_focus: string[];
  preserve_targets: string[];
  people?: {
    present: boolean;
    count: number | null;
    face_hair_expression: string;
    pose_body_proportions: string;
    clothing_accessories: string;
  };
  background: {
    setting: string;
    key_objects: string[];
    depth_layout: string;
  };
  visual_style: {
    color_palette: string;
    lighting: string;
    camera_composition: string;
    mood_style: string;
  };
  edit_relevance: {
    requested_change_area: string;
    likely_sensitive_areas: string[];
    ambiguity_notes: string[];
  };
}
```

### 5.3 필드 의미

- `summary`: 사용자에게 보여줄 짧은 요약
- `edit_focus`: 수정 지시와 직접 관련 있는 관찰 요소
- `preserve_targets`: 수정 요청과 무관하므로 유지해야 할 요소
- `people`: 사람이 있을 때만 중요한 세부 분석
- `background`: 배경 변경/보존 판단용 정보
- `visual_style`: 색감, 조명, 카메라, 무드
- `edit_relevance`: 프롬프트 병합 단계가 참고할 핵심 힌트

## 6. 비전 프롬프트 제안

현재 캡션 프롬프트를 바로 교체하기보다, 새 함수 또는 새 시스템 프롬프트로 분리하는 방식을 추천한다.

예시:

```text
You are an image-editing vision analyst.

Analyze the SOURCE image for an image editing pipeline.
The user's edit instruction is:
>>> {edit_instruction} <<<

Return STRICT JSON only.

Rules:
- First describe what is actually visible in the source image.
- Then identify which visible elements are relevant to the user's requested edit.
- Also identify elements that should likely be preserved because the user did not ask to change them.
- If a person is visible, analyze face/hair/expression, clothing/accessories, pose/body proportions, and full-body styling when visible.
- If no person is visible, set people.present=false and focus on subject, objects, background, lighting, color, and composition.
- Do not invent details that are not visible.
- Keep each field concise but specific.

JSON shape:
{
  "summary": "...",
  "edit_focus": ["..."],
  "preserve_targets": ["..."],
  "people": {
    "present": true,
    "count": 1,
    "face_hair_expression": "...",
    "pose_body_proportions": "...",
    "clothing_accessories": "..."
  },
  "background": {
    "setting": "...",
    "key_objects": ["..."],
    "depth_layout": "..."
  },
  "visual_style": {
    "color_palette": "...",
    "lighting": "...",
    "camera_composition": "...",
    "mood_style": "..."
  },
  "edit_relevance": {
    "requested_change_area": "...",
    "likely_sensitive_areas": ["..."],
    "ambiguity_notes": ["..."]
  }
}
```

## 7. 프롬프트 병합 단계 제안

`upgrade_edit_prompt()`에는 현재 단일 `image_description`만 전달된다.

개선 후에는 두 가지 중 하나를 선택할 수 있다.

### 안 A: 구조 분석을 문자열로 압축해서 전달

장점:
- 변경 범위가 작다.
- 기존 `upgrade_edit_prompt()` 인터페이스를 거의 유지할 수 있다.

단점:
- 구조화의 장점이 일부 사라진다.
- UI와 내부 로직에서 같은 문자열을 다시 파싱할 가능성이 생긴다.

예시:

```text
Source image analysis:
- Summary: ...
- Edit focus: ...
- Preserve targets: ...
- Person styling: ...
- Background: ...
- Visual style: ...
```

### 안 B: `upgrade_edit_prompt()`에 구조 분석 객체를 전달

장점:
- 내부 로직이 명확하다.
- 향후 비교 분석, 자동 보존 프롬프트, UI "자세히" 확장에 유리하다.

단점:
- 타입, DB, 테스트 변경이 늘어난다.
- 기존 히스토리와의 호환 처리 필요.

Codex 의견은 **Phase 1은 안 A**, 안정화 후 **Phase 2에서 안 B**가 현실적이다.

## 8. UI 표시 제안

현재 `AiEnhanceCard`와 `ImageLightbox`는 `visionDescription`을 단락으로 표시한다.

개선 방향은 다음 두 단계가 좋다.

### Phase 1: 요약 + 핵심 포인트

기존 카드 안에서 다음 정도만 보여준다.

```text
비전 모델 분석
요약: ...
수정 관련: 의상, 헤어, 배경 조명
보존 권장: 얼굴, 포즈, 배경 소품
```

### Phase 2: 자세히 보기

"자세히" 버튼을 추가하고, 모달 또는 접힘 영역에서 섹션별로 보여준다.

- 인물 스타일
- 자세/체형/구도
- 의상/소품
- 배경
- 색감/조명
- 수정 지시 관련 요소
- 보존 권장 요소
- 불확실하거나 모델이 확신하기 어려운 부분

## 9. 구현 후보 범위

### Backend

- `backend/studio/vision_pipeline.py`
  - `VISION_SYSTEM` 직접 교체 또는 신규 `EDIT_VISION_ANALYSIS_SYSTEM` 추가
  - `EditVisionAnalysisResult` dataclass 추가 후보
  - JSON 파싱/폴백 처리 추가
  - 기존 `image_description`은 계속 생성

- `backend/studio/router.py`
  - edit SSE step 1 응답에 구조 분석 추가 여부 검토
  - done item에 신규 필드 추가 여부 검토

- `backend/studio/history_db.py`
  - 영구 저장할 경우 신규 컬럼 필요
  - 단기적으로는 `vision_description` 문자열만 유지 가능

### Frontend

- `frontend/lib/api/types.ts`
  - `EditVisionAnalysis` 타입 후보 추가

- `frontend/hooks/useEditPipeline.ts`
  - step event나 done item에서 신규 분석 필드 수신

- `frontend/components/studio/AiEnhanceCard.tsx`
  - 기존 단락 표시에서 요약/포인트 표시로 개선

- `frontend/components/studio/ImageLightbox.tsx`
  - 상세 분석 표시 영역 확장 후보

## 10. 폴백 정책

비전 모델은 로컬 Ollama 상태에 영향을 받으므로 폴백이 중요하다.

권장 정책:

- JSON 파싱 성공: 구조 분석 사용
- JSON 파싱 실패 but raw text 있음: `visionDescription`에 raw text 저장, 구조 분석은 null
- 비전 호출 실패: 기존처럼 `(vision model unavailable...)` 성격의 안내를 남기고 사용자 지시만으로 진행
- 프롬프트 업그레이드 단계는 비전 실패 때문에 전체 수정 작업을 중단하지 않음

## 11. 테스트 제안

Backend 테스트:

- 구조 분석 JSON 정상 파싱
- 일부 필드 누락 시 기본값 보정
- malformed JSON일 때 raw caption 폴백
- 비전 호출 실패 시 수정 파이프라인 계속 진행
- edit instruction이 비전 프롬프트에 포함되는지 검증

Frontend 테스트:

- `visionDescription`만 있는 기존 히스토리 항목 표시
- 신규 `editVisionAnalysis`가 있는 항목 표시
- 분석 필드 일부가 null/빈 배열이어도 UI 깨지지 않음

## 12. Claude에게 요청할 검토 포인트

Claude가 특히 검토해줬으면 하는 부분은 다음이다.

1. JSON 구조 분석이 qwen2.5vl에서 안정적으로 나올지, 아니면 Markdown 섹션이 더 안전할지
2. `run_vision_pipeline()` 인터페이스를 확장할지, 새 함수로 분리할지
3. `visionDescription`만 유지하는 Phase 1로 충분한지, 처음부터 DB 필드를 추가할지
4. 사용자 수정 지시를 비전 분석 단계에 포함하는 것이 좋은지, 프롬프트 업그레이드 단계에만 두는 것이 좋은지
5. 인물 이미지 기준 세부 축이 충분한지
6. UI에서 "자세히"를 바로 넣을지, 우선 요약형 카드만 개선할지

## 13. Codex 1차 권장안

현재 상태에서는 다음 순서를 추천한다.

1. `VISION_SYSTEM`을 바로 덮어쓰기보다 `EDIT_VISION_ANALYSIS_SYSTEM`을 새로 추가한다.
2. 비전 분석 단계에 사용자 수정 지시를 함께 전달한다.
3. 모델 출력은 JSON으로 시도하되, 실패 시 raw text로 폴백한다.
4. 기존 `visionDescription`은 유지해서 히스토리/UI 호환을 지킨다.
5. Phase 1에서는 구조 분석을 사람이 읽는 요약 문자열로 압축해 `upgrade_edit_prompt()`에 전달한다.
6. Claude 검토 후 Phase 2에서 DB 필드와 UI 상세 모달을 확정한다.

이 방향이면 현재 기능을 깨지 않으면서, 사용자가 느끼는 "분석이 이상하고 얕다"는 문제를 가장 작게 개선할 수 있다.

---

## 14. Claude 검토 응답 (2026-04-25)

**검토자**: Claude (Opus 4.7)
**상태**: Codex 1차 권장안 방향 동의 + 일부 단순화/강화 제안

### 14.1 종합

Codex 의 1차 권장안 (`Phase 1 에 EDIT_VISION_ANALYSIS_SYSTEM 신규 추가 + JSON 시도 + visionDescription 호환 유지 + 안 A 로 시작`) 이 가장 안전하고 실용적. 아래 몇 가지 단순화/강화 의견.

### 14.2 Codex 6 검토 포인트에 대한 답

#### Q1. JSON 구조 분석 안정성 — JSON vs Markdown

**JSON 권장.** 프로젝트 내에 이미 검증된 패턴 있음.

- `backend/studio/comparison_pipeline.py` 의 `analyze_pair_generic()` 가 qwen2.5vl + JSON 5축 평가 + fallback 패턴 안정 동작 중 (Vision Compare 메뉴)
- 인프라: system prompt + JSON example 강조 + Ollama `format=json` 옵션 + parse 실패 시 raw text fallback
- 이 인프라를 `analyze_edit_source()` 새 함수로 거의 그대로 복사 가능 (system prompt 만 교체)

#### Q2. `run_vision_pipeline()` 확장 vs 새 함수 분리

**새 함수 분리 권장.** `analyze_edit_source(image, edit_instruction)` 같은 전용 함수.

- 이유: 기존 `run_vision_pipeline()` 은 단순 캡션 용도로 충분. 그대로 두면 다른 컨텍스트 (예: 미래에 Generate 의 reference 이미지 분석) 재사용 여지 남김
- comparison_pipeline 의 `analyze_pair` (Edit 전용) / `analyze_pair_generic` (Vision Compare) 분리 패턴과 동일한 결

#### Q3. visionDescription 만 유지 vs DB 필드 즉시 추가

**Phase 1 은 visionDescription 만 유지** (Codex 권장 동의). 단 SSE event payload 에는 구조 분석 포함:

- DB persist 안 함 → 마이그레이션 부담 0
- SSE step 1 event 에 `editVisionAnalysis: EditVisionAnalysis` 추가 → 프론트가 세션 메모리에만 들고 있음 (휘발 패턴)
- Lightbox 에서 그 세션의 분석 내용 표시 가능. 새로고침 시 사라짐
- **Vision Compare 와 같은 휘발 패턴 재사용** — 이미 UX 검증됨
- Phase 2 에서 DB 컬럼 추가 시 점진적 확장

#### Q4. Edit instruction 을 비전 분석 단계에 포함 vs 업그레이드 단계만

**비전 분석에 포함 권장** (Codex 의 prompt 디자인 동의).

- 우려: 사용자 의도가 비전 분석을 편향시킬 수 있음 ("의상 바꿔" → 의상만 분석, 배경 무시)
- Codex 의 prompt 가 이미 가드: `"First describe what is actually visible. Then identify which visible elements are relevant"` — **객관 묘사 → 의도 매칭** 2단계 강제. 좋음
- 캐시 어려움 (같은 이미지 + 다른 instruction = 다른 분석). 실사용에서 같은 이미지에 여러 instruction 주는 경우 드물어 큰 문제 X

#### Q5. 인물 이미지 세부 축 충분성

**거의 충분.** 추가 검토 가치 있는 1개:

- **`gaze_direction` (시선 방향)** 추가 제안 — 카메라 응시 / 옆모습 / 위·아래 향함 등. 인물 사진 수정 시 시선 보존이 자연스러움 핵심. `people` 객체 안에 `gaze_direction: string` 필드.

이 프로젝트가 인물 (여성) 위주 LoRA 라서 `clothing_accessories` + `pose_body_proportions` 는 이미 적절히 강조됨.

#### Q6. UI "자세히" 즉시 vs 요약 우선

**요약 우선** (Codex 의 Phase 1 동의).

- "자세히" 는 power user 기능. 첫 단계에선 요약만 노출해도 "분석 좋아졌다" 체감 충분
- `AiEnhanceCard` 의 기존 단락 표시 → `요약 + 수정 관련 [라벨1, 라벨2] + 보존 권장 [라벨3, 라벨4]` 짧은 표시로 교체
- 자세히 모달은 Phase 2 (사용자가 필요성 느낄 때만)

### 14.3 추가 강화 의견

**A. 인프라 재활용**
`comparison_pipeline.analyze_pair_generic` 의 패턴을 그대로 복사:
- system prompt + JSON example 강조
- `format=json` Ollama 옵션
- parse 시도 + raw fallback + 부분 필드 누락 보정

**B. 분량 + 우선순위**
- Phase 1 분량: **~3h** (새 함수 + 시스템 프롬프트 + 파싱 + visionDescription 압축 + SSE event payload + 프론트 요약 카드)
- Phase 2 분량: ~3-4h (DB persist + 자세히 모달)
- 사용자 우선순위 판단: Edit 비전 분석에 명시적 불만 표시된 기록 없음. "더 좋게" 만드는 nice-to-have. 저장 위치 정리보다 나중에 가도 무리 없음.

**C. 검증 어려움 고지**
Edit 결과 품질 향상은 객관 수치화 어려움. 비전 분석 자체가 그럴듯해 보여도, 최종 ComfyUI 샘플링 결과가 진짜 좋아졌는지는 주관 평가. 즉 Phase 1 단계에서 **사용자가 직접 비교 사용 → 효과 체감 후 Phase 2 결정** 흐름 권장.

**D. 2-phase 분리 + 휘발 SSE 전략의 장점**
- Phase 1 에 DB persist 안 해도 사용자가 Lightbox 에서 구조 분석 체감 가능 (그 세션에서만)
- 세션 종료 후 사라져도 "구조 분석" UX 가 검증되는 시점이 빠름
- Phase 2 로 넘어가는 기준: 사용자가 "자세히 보기 + 기록 유지 원함" 이라고 느낄 때

### 14.4 Phase 1 구현 순서 제안 (Claude 버전)

1. `backend/studio/vision_pipeline.py` 에 `analyze_edit_source(image, edit_instruction)` 함수 추가 (`comparison_pipeline.analyze_pair_generic` 패턴 복사)
2. 신규 `EDIT_VISION_ANALYSIS_SYSTEM` 상수 — Codex 제안 프롬프트 + `gaze_direction` 추가
3. JSON 파싱 + raw text fallback + 부분 필드 누락 보정
4. `run_vision_pipeline()` 에서 기존 `image_description` 생성 후, edit 컨텍스트면 `analyze_edit_source` 추가 호출. 결과를 압축 문자열로 재조합해 `upgrade_edit_prompt()` 에 전달 (안 A)
5. `visionDescription` 에는 사람이 읽기 쉬운 요약 (`summary + "수정 관련: ..." + "보존 권장: ..."`) 저장 — 기존 호환 유지
6. SSE step 1 event 에 `editVisionAnalysis` payload 추가 (구조 JSON)
7. 프론트 `EditVisionAnalysis` 타입 추가 + `useEditPipeline` 수신 + `useEditStore` 메모리 저장 (휘발)
8. `AiEnhanceCard` 요약 + 라벨 리스트 표시로 교체
9. 백엔드 테스트 (정상 파싱 / 필드 누락 / malformed JSON / 비전 실패 / edit instruction 포함 검증)
10. 프론트 테스트 — 기존 `visionDescription` 만 있는 히스토리도 깨지지 않는지

### 14.5 확정

**Codex 권장안 + 위 추가 의견 반영해서 진행하면 좋음.** 다만 우선순위 측면에서 **저장 위치 정리 → 이 spec 순으로 분리 권장.** 한 PR 에 두 작업 묶으면 검증 부담 큼.

**결정 사항 (2026-04-25):**
- 오늘 세션: 저장 위치 정리만 진행
- 이 spec 은 다음 세션 활성 후보로 승격
- Phase 1 먼저 진행 후 사용자 검증 → Phase 2 결정

---

## 15. 실측 피드백 → 패러다임 전환 (2026-04-25 후속)

**작성자**: Claude (Opus 4.7)
**계기**: 14.5 결정대로 Phase 1 1차 구현 완료 → 사용자 실측 검증 → 표현 방식 한계 발견.

### 15.1 1차 구현 결과 관찰

`EDIT_VISION_ANALYSIS_SYSTEM` 을 spec 6 에 따라 그대로 구현. qwen2.5vl 호출 성공. JSON 파싱 안정. UI 칩 렌더 깔끔.

**그런데 사용자 검증에서 표현 방식의 한계 드러남:**

사용자 입력:
```
상의 , 하의 완전 노출, 완전 누드,
자연스럽게 처질정도의 e컵 기슴 크기로 변경,
그외 모든 상태 유지.
```

UI 표시 결과:
```
수정 관련  [상의] [하의] [가슴 크기]
보존 권장  [얼굴] [머리] [손] [입술] [손가락] [손목] [팔] [몸]
```

### 15.2 사용자 피드백의 핵심

> "내가 원하는 수정 지시를 잘 따라서 했는지 여부와, 그외 나머지는 유지 했는지가 분석의 관점이야."

> "그 수정지시+유지 결과 를 세부적으로 인물일경우는 얼굴, 헤어, 의상, 바디, 배경 등 이 있을꺼고 인물이 없으면 얼굴이나 기타 스타일은 빼고 배경, 물체 위치 등이 나와야 할건데..."

### 15.3 spec 5~7 의 설계 한계 진단

| 항목 | spec 5~7 의 설계 | 실측에서 드러난 한계 |
|---|---|---|
| `edit_focus` | 수정 관련 **관찰 요소** 동적 배열 | 변경 방향(how) 빠짐 — 대상(what) 만 단어로 |
| `preserve_targets` | 유지할 **요소** 동적 배열 | 부위가 너무 파편화 — "얼굴/머리/손/팔/..." |
| 카테고리 분류 | 없음 (자유 배열) | 사용자 검증의 일관된 기준 부재 |
| 도메인 분기 | `people.present` 만 | 슬롯 자체는 인물·물체·풍경 모두 동일 |

**근본 원인**: 동적 배열은 "AI 가 본 대로 자유 나열" 에 적합하지만, **사용자가 "내 의도가 모든 카테고리에 잘 반영됐나" 를 일관된 기준으로 검증하기엔 부적합**.

### 15.4 패러다임 전환 결정

**동적 배열 → 도메인별 고정 슬롯 매트릭스.**

비교 분석 (`comparison_pipeline.analyze_pair`) 의 5축 점수표 UX 와 동일한 시각 패턴 채택:
- 사전 분석: 슬롯별 `{action, note}` 매트릭스
- 사후 분석: 슬롯별 점수 매트릭스
- → 두 단계가 **시각적 쌍둥이** 가 되어 사용자가 "분석 → 실행 → 검증" 흐름 따라가기 직관적.

### 15.5 도메인 정의 + 슬롯 매핑

**판정 규칙**:
- `people.present === true` → **A. 인물/캐릭터 모드** (실사 인물 + 애니메이션 캐릭터)
- `people.present === false` → **B. 물체/풍경 모드**

**A. 인물/캐릭터 — 5 슬롯**:

| 키 | UI 라벨 | 무엇을 보는가 |
|---|---|---|
| `face_expression` | 얼굴/표정 | 정체성 (눈·코·입·턱), 표정, 시선, 메이크업 |
| `hair` | 헤어 | 길이, 색, 스타일, 헤어 액세서리 |
| `attire` | 의상/액세서리 | 옷, 누드 상태, 목걸이/귀걸이 등 |
| `body_pose` | 바디/포즈 | 자세, 신체 비율, 가슴 크기, 피부 톤 |
| `background` | 배경/환경 | 장소, 조명, 분위기 |

**B. 물체/풍경 — 5 슬롯**:

| 키 | UI 라벨 | 무엇을 보는가 |
|---|---|---|
| `subject` | 주체 | 메인 오브젝트 종류, 형태, 크기 |
| `color_material` | 색·재질 | 색상, 텍스처, 광택, 마감 |
| `layout_composition` | 배치·구도 | 위치, 각도, 카메라 시점, 프레이밍 |
| `background_setting` | 배경·환경 | 환경, 시간대, 날씨 |
| `mood_style` | 분위기·스타일 | 무드, 시각 톤 (cinematic / editorial 등) |

### 15.6 새 데이터 구조

```ts
type EditDomain = "person" | "object_scene";

interface EditSlotEntry {
  action: "edit" | "preserve";   // binary — 중간 상태 없음 (사용자 결정)
  note: string;                  // 한 줄 설명 (qwen2.5vl 출력 언어 자율)
}

interface EditVisionAnalysis {
  domain: EditDomain;
  intent: string;                // gemma4 정제 1줄 (영문) — 신규
  summary: string;               // qwen2.5vl 요약 1줄
  slots: Record<string, EditSlotEntry>;  // 도메인에 따라 키 셋 다름

  provider: "ollama" | "fallback";
  fallback: boolean;
  analyzedAt: number;
  visionModel: string;
}
```

폐기되는 필드 (1차 구현 → 폐기):
- `edit_focus[]` / `preserve_targets[]` — 슬롯 매트릭스로 흡수
- `people.face_hair_expression` / `pose_body_proportions` / `clothing_accessories` / `gaze_direction` — 슬롯으로 평탄화
- `background.setting` / `key_objects[]` / `depth_layout` — 슬롯으로 흡수
- `visual_style.*` — 슬롯으로 흡수
- `edit_relevance.*` — `intent` 1줄로 대체

### 15.7 gemma4 사전 정제 (신규 단계)

**근거**: 한국어 자연어 + 띄어쓰기 + 이모티브 입력은 qwen2.5vl 비전 모델이 약함. gemma4-un 이 의도 정제 전문가 역할.

**함수**: `clarify_edit_intent(user_instruction) -> str`
- 모델: `gemma4-un:latest` (think=False · CLAUDE.md 규칙)
- 입력: 한/영 자연어
- 출력: 영어 1-2 문장 정제 intent (40-60 단어 권장)
- 시스템 프롬프트: "Translate intent to clear English. Keep structure: change targets + preservation scope. No flourishes."
- 실패 시: 원문 그대로 반환 (폴백)

**호출 위치**: `analyze_edit_source` 시작 시점. 결과를 비전 SYSTEM 프롬프트의 `{edit_instruction}` 자리에 주입.

### 15.8 새 SYSTEM 프롬프트 (개정안)

```text
You are an image-editing vision analyst.

The SOURCE image is provided. The user's edit intent (already refined into
clean English) is:

>>> {edit_intent} <<<

Your job: classify the image domain and produce a 5-slot edit/preserve matrix
that lets the user verify "did the edit follow my intent, and was everything
else preserved?"

Step 1 — Classify domain:
  - "person" if a human or anthropomorphic character is the main subject.
  - "object_scene" otherwise (products, landscapes, animals, food, vehicles,
    interiors, abstract scenes, etc.).

Step 2 — Fill all 5 slots for the chosen domain. For each slot, decide:
  - action: "edit"     if the user's intent involves changing this aspect.
  - action: "preserve" if the user wants this aspect kept as-is.
  Write a 1-sentence note that:
    - For edit:     describes what changes (target → intended state).
    - For preserve: confirms what should stay (current state, key features).

Step 3 — Return STRICT JSON only (no markdown, no preamble):

If domain == "person":
{
  "domain": "person",
  "summary": "<1 sentence describing what is visible>",
  "slots": {
    "face_expression": {"action": "edit|preserve", "note": "..."},
    "hair":            {"action": "edit|preserve", "note": "..."},
    "attire":          {"action": "edit|preserve", "note": "..."},
    "body_pose":       {"action": "edit|preserve", "note": "..."},
    "background":      {"action": "edit|preserve", "note": "..."}
  }
}

If domain == "object_scene":
{
  "domain": "object_scene",
  "summary": "<1 sentence describing what is visible>",
  "slots": {
    "subject":             {"action": "edit|preserve", "note": "..."},
    "color_material":      {"action": "edit|preserve", "note": "..."},
    "layout_composition":  {"action": "edit|preserve", "note": "..."},
    "background_setting":  {"action": "edit|preserve", "note": "..."},
    "mood_style":          {"action": "edit|preserve", "note": "..."}
  }
}

Rules:
- Always fill ALL 5 slots for the chosen domain. Never omit a slot.
- If the user's intent does not mention a slot, set action=preserve with a
  note describing the current visible state.
- Notes are concise (max 1 sentence, 25 words).
- Do not invent details that are not visible in the image.
```

### 15.9 새 UI 표시 (EditVisionBlock 재작성)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 수정 의도
[gemma4 정제 1줄]

📋 인물 모드 분석
얼굴/표정    🟢 유지   정체성·표정 보존
헤어        🟢 유지   동일 헤어스타일
의상        🔵 수정   상의/하의 완전 제거 (누드)
바디/포즈    🔵 수정   가슴 E컵으로 변경, 자세 유지
배경        🟢 유지   동일 장소·조명
━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

비교 분석 모달 (5축 점수표) 과 시각적 쌍둥이.

### 15.10 호환성 / 마이그레이션

- **DB 스키마**: 변경 없음 (`visionDescription` 만 유지 · 사람 친화 영문 `summary` 1줄 저장)
- **옛 히스토리 row**: `editVisionAnalysis === undefined` → 기존 단락 폴백 유지
- **휘발 패턴**: 변경 없음 (SSE step 1 + done item 에만 포함)
- **comparison_pipeline / Generate / Video / Vision Analyzer**: 영향 0%

### 15.11 작업 분량 (재구현 · v2)

| 작업 | 분량 |
|---|---|
| spec 14.x 추가 | 30 분 |
| 백엔드 SYSTEM + dataclass 재설계 | 1 h |
| `clarify_edit_intent` 신규 | 30 분 |
| `analyze_edit_source` 재구현 + `run_vision_pipeline` 통합 | 1 h |
| 백엔드 테스트 재작성 | 1 h |
| 프론트 타입 + EditVisionBlock 매트릭스 재작성 | 1 h |
| 검증 (pytest + vitest + lint + tsc) | 30 분 |
| **총** | **~5 h** |


---

## 16. Edit 한 사이클 완성 (2026-04-25 · 후속 v3)

**작성자**: Claude (Opus 4.7)
**계기**: 15장 (v2 매트릭스) 구현 직후 사용자가 핵심 누락 지적 →
"비전 분석 (사전) 과 비교 분석 (사후) 만 손댔고 중간 (프롬프트 통합) 이 빠짐."

### 16.1 사용자 통찰 (정확함)

> "지금 흐름을 보면 비전및 의도 파악후 수정지시 업데이트 하고 수정하는 프롬프트를 체크 해야 할거 같고, 그다음 이미지 출력, 그 후 이미지 비교 이잖아? 이 흐름대로 오늘 진행을 해야해. 그래야 하나의 이미지 수정 모드가 완벽해지니까."

### 16.2 Edit 한 사이클 = 5 단계

```
Step 1. 비전 분석 (사전)         → analyze_edit_source 매트릭스
Step 2. 프롬프트 통합 (gemma4)   → upgrade_edit_prompt 영어 최종 프롬프트   ← 핵심 연결고리
Step 3. 파라미터 추출            → 자동 (workflow defaults)
Step 4. ComfyUI 샘플링 (출력)    → 결과 이미지
Step 5. 비교 분석 (사후)         → analyze_pair 점수 + 코멘트
```

15장 (v2) 까지: **Step 1 완성 + Step 5 제안만** → Step 2 가 매트릭스 정보를 충분히
활용 못해서 ComfyUI 결과가 의도대로 안 나옴 (예: 사용자가 포즈 보존 의도였는데
포즈가 흔들림).

### 16.3 사용자 실측 증거

**입력**: "상의/하의 완전 노출, E컵, 그 외 모든 상태 유지"

**예상 동작**:
- 의상: 변경 (누드)
- 바디 (가슴): 변경 (E컵)
- 얼굴 / 헤어 / 포즈 / 배경: 보존

**실제 결과**: 포즈가 살짝 흔들림 → "유지" 의도였는데 변형됨.

**원인 진단**: `compact_context()` 에 `body_pose [preserve]` 가 들어가도
`SYSTEM_EDIT` 가 일반적인 identity-preservation clause 만 강제 → "remove top,
change bust" 강조에 끌려 preserve 의도가 약해짐.

### 16.4 결정: Step 2 정합성 + Step 5 정렬 동시 처리

#### 16.4.1 Step 2 — 매트릭스 directive 주입

`upgrade_edit_prompt(edit_instruction, image_description, *, analysis=None)` 시그니처
확장. analysis 가 EditVisionAnalysis 면 SYSTEM 프롬프트에 동적 instruction
block 주입:

```text
=== STRICT MATRIX DIRECTIVES ===
For each slot below, follow the directive EXACTLY:

[preserve] face_expression: keep identity, soft smile, brown hair
  → INCLUDE preservation phrasing: "exact same face, identical
    eyes/nose/lips, no facial change"

[preserve] hair: same long brown hair
  → INCLUDE: "same hairstyle, same color, same length"

[edit] attire: remove top and bottom (full nude)
  → APPLY EXACTLY: remove top and bottom (full nude)

[edit] body_pose: increase bust to natural sagging E-cup, keep pose
  → APPLY EXACTLY: increase bust to natural sagging E-cup, keep pose

[preserve] background: same park scene and lighting
  → INCLUDE preservation phrasing for background and lighting
=================================
```

이러면 gemma4-un 이 매 슬롯마다 명시적으로 preserve / edit clause 를 합쳐서
최종 프롬프트 만듦 → ComfyUI 가 의도대로 그릴 확률 ↑.

#### 16.4.2 Step 5 — 비교 분석 5축 = 사전 슬롯과 동일

| 도메인 | 5 축 (사전 = 사후 동일) |
|---|---|
| person | face_expression / hair / attire / body_pose / background |
| object_scene | subject / color_material / layout_composition / background_setting / mood_style |

**점수 의미 (옵션 A · 단일 점수)**:
- 슬롯이 **사용자 보존 의도**였으면 → 점수 = 유사도 (100=동일, 0=완전 변함)
- 슬롯이 **사용자 변경 의도**였으면 → 점수 = 의도부합도 (100=의도대로, 0=무시)

`SYSTEM_COMPARE` 가 사용자 edit prompt 를 보고 슬롯별로 의도 판정 + 그에 맞는
점수 매김. 종합 = 5 축 산술평균 (모두 같은 의미라 평균 가능).

#### 16.4.3 옛 row 호환

DB `comparison_analysis` 는 JSON 컬럼이라 스키마 변경 없음. 기존 row 의 옛 5축
(`face_id`, `body_pose`, `attire`, `background`, `intent_fidelity`) 은 그대로
저장되어 있음. **프론트가 키 셋으로 자동 분기**:

- 옛 키 발견 → 옛 라벨 (얼굴 ID / 체형/포즈 / 의상/누드 상태 / 배경 보존 / 의도 충실도)
- 새 키 + `domain` 필드 → 도메인별 새 라벨

마이그레이션 없음. 새 row 부터 새 형식.

### 16.5 새 SYSTEM_COMPARE (개정안)

```text
You are a vision evaluator comparing TWO images of the same scene:
  SOURCE = original image (before edit)
  RESULT = edited image (after user's edit)

The user's edit instruction was: "{edit_prompt}"

Step 1 — Classify domain:
  - "person" if a human or anthropomorphic character is the main subject.
  - "object_scene" otherwise.

Step 2 — For each of the 5 domain-specific slots, decide intent and score:
  Intent decision:
    - intent: "edit"     if the user's instruction asks to change this slot
    - intent: "preserve" if the user's instruction does not mention changing
      this slot (default to preserve)
  Score 0-100 (integer):
    - If intent=preserve: score = visual SIMILARITY of this slot between
      SOURCE and RESULT. 100=identical, 0=completely changed.
    - If intent=edit:     score = how well the edit follows the instruction
      on this slot. 100=fully followed, 0=ignored.

Step 3 — Write a 1-2 sentence comment per slot (English) describing:
  - For preserve: how similar SOURCE and RESULT are on this slot.
  - For edit:     how well the edit was applied per the user's intent.

Step 4 — Write a 3-5 sentence overall summary (English).

Return STRICT JSON only (no markdown, no preamble, no trailing text).

If domain == "person":
{
  "domain": "person",
  "slots": {
    "face_expression": {"intent": "edit|preserve", "score": <int>, "comment": "<en>"},
    "hair":            {"intent": "edit|preserve", "score": <int>, "comment": "<en>"},
    "attire":          {"intent": "edit|preserve", "score": <int>, "comment": "<en>"},
    "body_pose":       {"intent": "edit|preserve", "score": <int>, "comment": "<en>"},
    "background":      {"intent": "edit|preserve", "score": <int>, "comment": "<en>"}
  },
  "summary": "<en, 3-5 sentences>"
}

If domain == "object_scene": same shape with subject/color_material/
layout_composition/background_setting/mood_style.
```

### 16.6 프론트 표시 변경

**ComparisonAnalysisCard / Modal**:
- domain 으로 한국어 라벨 셋 결정 (인물 / 물체·풍경)
- 슬롯별 1행: [한글 라벨] [📌 보존 / 🎯 변경 의도 배지] [점수 막대 + 점수] [한글 코멘트]
- 종합 = 5축 산술평균 (모든 슬롯이 같은 의미)
- 옛 row 자동 감지 → 옛 라벨로 표시 + 의도 배지 없음 (옛 데이터엔 intent 정보 없음)

### 16.7 데이터 구조 변경

```ts
// 새 형식 (v3)
type EditDomain = "person" | "object_scene";
type SlotIntent = "edit" | "preserve";

interface ComparisonSlotEntry {
  intent: SlotIntent;
  score: number | null;       // 0-100 정수, null=실패
  comment: string;
}

interface ComparisonAnalysis {
  domain: EditDomain;          // 신규
  slots: Record<string, ComparisonSlotEntry>;  // 5 슬롯
  overall: number;             // 산술평균
  summary_en: string;
  summary_ko: string;
  provider: "ollama" | "fallback";
  fallback: boolean;
  analyzedAt: number;
  visionModel: string;
  // 폐기: scores / comments_en / comments_ko (별도 필드)
}

// 옛 형식 (마이그레이션 없이 호환만)
// scores: {face_id, body_pose, attire, background, intent_fidelity}
// comments_en/comments_ko, summary_en/summary_ko
```

프론트는 `analysis.slots` 존재로 분기:
- `slots` 있음 → 새 v3 표시
- `slots` 없고 `scores` 있음 → 옛 v1 표시 (호환)

### 16.8 테스트 보강

- analyze_pair 인물 모드 정상 / 물체·풍경 모드 정상
- 슬롯별 의도 판정 검증 (edit prompt 따라 분기)
- 도메인 분류 검증
- 옛 row 호환 (DB 의 옛 5축 keys 가 그대로 list_items 로 나오는지)
- 프론트 옛 row 표시 분기 (vitest 가능 시)

### 16.9 작업 분량

| 작업 | 분량 |
|---|---|
| spec 16장 추가 | 30분 |
| Step 2: SYSTEM_EDIT + upgrade_edit_prompt 재작성 | 1.5h |
| Step 2 보강: run_vision_pipeline → 매트릭스 객체 전달 | 30분 |
| Step 5: comparison_pipeline 재작성 | 1.5h |
| 옛 row 호환 (백엔드 + 프론트) | 30분 |
| 프론트 ComparisonAnalysisCard / Modal 재작성 | 1.5h |
| 백엔드 + 프론트 테스트 + 검증 | 1h |
| **총** | **~7h** |

### 16.10 효과 (한 사이클 완성)

오빠가 한 번 더 돌렸을 때:
- ✅ 사전 (Step 1): 매트릭스 정확히 분석
- ✅ **변환 (Step 2): 매트릭스 → 최종 프롬프트에 슬롯별 directive 명시**
- ✅ **출력 (Step 4): ComfyUI 가 진짜 의도대로 그림** (포즈 보존 등)
- ✅ 사후 (Step 5): 사전과 같은 카테고리로 비교 + 의도 컨텍스트 점수
- 사전 ↔ 사후 시각적 쌍둥이 일관성

→ "이미지 수정 모드 완벽" 달성.

---

## 17. 보존 슬롯 묘사 누출 픽스 (2026-04-25 · 후속 v3.1)

**작성자**: Claude (Opus 4.7)
**계기**: spec 16 한 사이클 완성 후 사용자 실측 → "포즈 변경 요청 안 했는데
결과 포즈가 약간 바뀌었음" 발견. 최종 EN 프롬프트 추적해서 원인 진단.

### 17.1 사용자 통찰 (정확함)

> "내가 의도는 의상만인데 포즈가 약간 바뀌었어. 프롬프트에 포즈를 변경하는
> 게 추가되었다는게 걸리는거야. 난 수정지시 안했는데."

### 17.2 진단

`run_vision_pipeline` 결과 EN 프롬프트:

```
"...the woman is smiling, the woman has long black hair,
 the woman is standing with her hands on her hips,           ← 누출!
 and the background shows curtains and a window with natural light,
 keeping everything else unchanged."
```

**경로**:
1. qwen2.5vl 이 원본 보고 `slots.body_pose.note = "The woman is standing
   with her hands on her hips."` 작성 (보존 의도, 단순 묘사)
2. `_build_matrix_directive_block` 가 SYSTEM 에 `[preserve] body_pose →
   Current state: <note>` 형태로 그대로 흘림
3. gemma4-un 이 directive 받아 최종 EN 프롬프트에 그 묘사를 그대로 반영
4. ComfyUI Qwen Image Edit 가 "standing with hands on hips" 를 **변경 지시**
   로 오해 → 손/어깨 위치를 명시적으로 다시 그림 → 결과 포즈 변형

### 17.3 디자인 결함

spec 16 의 매트릭스 directive 시스템은 "사전·사후 정합성" 을 위해 슬롯
note 를 SYSTEM 에 모두 흘렸음. 그런데 **보존 의도 슬롯의 묘사는 흘리면
안 됨** — 그건 "지시" 가 아니라 "변경 안 함" 이기 때문.

원칙:
- **변경 의도 슬롯 (`[edit]`)**: note 가 변경 지시 자체이므로 그대로 명시
- **보존 의도 슬롯 (`[preserve]`)**: note 는 **묘사**이지 지시 아님 → SYSTEM 에 흘리지 X
  → generic preservation 만 강제 (예: "preserve the original body_pose
  exactly as in the source, no change to body_pose")

### 17.4 적용 변경

**`backend/studio/prompt_pipeline.py` `_build_matrix_directive_block`**:

Before (spec 16):
```python
if action == "edit":
    lines.append(f"[edit] {label}")
    lines.append(f"  -> APPLY EXACTLY: {note}")
else:
    lines.append(f"[preserve] {label}")
    lines.append(
        f"  -> INCLUDE preservation phrasing for this slot. "
        f"Current state: {note}"   # ← note 누출
    )
```

After (spec 17):
```python
if action == "edit":
    # 변경 의도 — note 그대로 명시 (변경 지시 자체)
    lines.append(f"[edit] {label}")
    lines.append(f"  -> APPLY EXACTLY: {note}")
else:
    # 보존 의도 — note 절대 명시 X. generic preservation 만.
    lines.append(f"[preserve] {label} — KEEP IDENTICAL TO SOURCE")
    lines.append("  -> DO NOT describe this slot's specific state in the output.")
    lines.append(
        f'  -> Use ONLY generic preservation phrasing: '
        f'"preserve the original {label} exactly as in the source, '
        f'no change to {label}".'
    )
```

추가로 **`Source summary` 도 SYSTEM 에 안 보냄** (spec 16 에선 보냈음). summary 도
원본 묘사라서 LLM 이 지시로 오해할 수 있음. `Refined intent` 만 변경 의도
컨텍스트로 전달.

**`SYSTEM_EDIT` 가드 강화**:

```text
- For [preserve] slots: NEVER describe the specific state of that aspect.
  Use ONLY generic preservation phrasing such as
  "preserve the original X exactly as in the source", "no change to X",
  "keep X unchanged". Specific descriptions of preserved aspects (e.g.
  "the woman is standing with hands on hips") will mislead the diffusion
  model into re-generating that aspect, causing unintended changes.
  This is critical: preserve = "do not touch this", NOT a re-description.
```

### 17.5 UI 영향 X

이 변경은 **백엔드가 SYSTEM_EDIT 에 보내는 directive 블록만 수정**. UI 표시용
slot.note (사용자가 보는 "인물 모드 분석" 카드의 슬롯별 한 줄 설명) 는 그대로
유지. 사용자에게는 풍부한 정보, ComfyUI 에는 안전한 generic preservation.

### 17.6 효과

다음 실측에서:
- 변경 요청 슬롯 (의상 등): 의도대로 변경 ✅
- **보존 요청 슬롯 (포즈, 얼굴, 헤어, 배경 등): 진짜 그대로 유지** ✅
  (구체 묘사가 SYSTEM 에 안 흘러가니 ComfyUI 가 새 지시로 오해할 일 없음)

### 17.7 호환성

- 모든 pytest 회귀 통과 (151 + 신규 8 = 159)
- `analyze_pair_generic` (Vision Compare) 무영향
- `comparison_pipeline.analyze_pair` 무영향 (이건 사후 분석으로 별도 흐름)
- DB 스키마 무변경
- 프론트 UI 무변경

### 17.8 작업 분량

| 작업 | 분량 |
|---|---|
| spec 17장 추가 | 10분 |
| `_build_matrix_directive_block` preserve 처리 변경 | 10분 |
| `SYSTEM_EDIT` 가드 강화 | 5분 |
| 신규 테스트 `test_matrix_directive_block.py` (8 케이스) | 10분 |
| 회귀 + 검증 | 5분 |
| **총** | **~40분** |
