# Vision Compare 재설계 — 분석 + 깊은 차이 (2-stage observe + diff_synthesize)

**작성**: 2026-05-05
**Branch (예정)**: `feature/vision-compare-redesign`
**연관**: Vision 분석 페이지 정공법 (2-stage observer/synthesizer · 2026-05-03~04)

---

## 1. 요약 (TL;DR)

Vision Compare 메뉴 (`/vision/compare`) 를 *점수 매트릭스 위주 단일 호출* → *각 이미지 풍부 분석 × 2 + 깊은 차이 추출* 패러다임으로 재설계한다.

핵심 정체성 (사용자 정의): **"이미지의 차이를 자세히 깊이 분석하는 도구"** — 평가 도구가 아니다.

기존 `analyze_pair_generic` (v2_generic · 1-stage vision 모델 단독 점수+코멘트 합성) 을 폐기하고 새 모듈 `compare_pipeline_v4/` 로 대체한다. Edit context (`analyze_pair` v3) 는 손 안 댐.

---

## 2. 의도 / 본질

### 2.1 출발점 (사용자 시나리오)

오빠가 Compare 메뉴를 쓰는 시나리오 (우선 4개):

1. **같은 인물/같은 컨셉 다른 컷** — "뭐가 변했나 정밀 캐치"
2. **레퍼런스 ↔ 내가 만든 결과 매칭 검증** — "얼마나 비슷하게 만들었나"
3. *(선택 안 함)* A/B 평가 — "어느 쪽이 좋냐"
4. **완전히 다른 두 이미지 컨셉 분석** — "공통 요소 / 차이 요소 디스커버리"
5. **같은 프롬프트 다른 모델/세팅 비교** — "스타일 / 디테일 차이"

→ 공통 요구: **평가가 아니라 이해/디스커버리**. 점수보다 *구체적 차이 묘사*가 핵심.

### 2.2 본질 — 사용자 한 줄 정의

> "Compare 의 처음 추가된 의도는 Edit 의 간단한 분석을 더 자세히 + 두 이미지를 분석하는 것. 결국 = **이미지의 차이를 자세히 깊이 분석**."

이 한 줄이 모든 설계 결정의 keystone.

### 2.3 정공법 자산 재사용

Vision 분석 페이지가 2026-05-03~04 에 1-shot → 2-stage 정공법 (관찰자 → 편집자) 으로 재설계되어 production 품질 도달. 그 자산을 **그대로 듀얼로 재사용** + 새 stage (diff_synthesize) 추가.

```
Image1 → vision_observe ─→ observation1.json ──┐
Image2 → vision_observe ─→ observation2.json ──┤
                                               ├→ diff_synthesize → 차이 분석 결과
compare_hint (선택, 사용자 자유 자연어) ────────┤
                                               │
[on-demand]  prompt_synthesize × N ─ optional ─┘
```

---

## 3. 데이터 흐름

### 3.1 백엔드 stage

```
stage 0: compare-encoding  — A/B PIL validate + width/height 추출 (옛 호환)
stage 1: observe1          — vision_observe(image1, w1, h1)   → observation1
stage 2: observe2          — vision_observe(image2, w2, h2)   → observation2
[ unload(vision_model) + sleep 1.0 ]  ← 명시적 호출 (V4 가 직접 박음)
stage 3: diff-synth        — gemma4 (text 모델) 합성           → diff result JSON
stage 4: translate         — 영문 결과 → 한국어 번역           → ko 채움
[ force_unload_all_loaded_models() ] ← gate 안에서 (옛 v3 패턴 유지)
```

**모델 전환 unload 정책** ⭐ (Codex 검증):
- `observe1 → observe2`: 같은 vision 모델 재사용 → unload **불필요**
- `observe2 → diff_synth`: vision → text 모델 전환 → **`ollama_unload.unload_model(vision_model)` + `asyncio.sleep(1.0)` 명시 호출 필수**
  - 근거: `vision_observe.observe_image()` / `prompt_synthesize.synthesize_prompt()` 둘 다 `keep_alive` default 5m. `image_detail.py` 자체는 모델 전환 시 unload 안 함. V4 pipeline orchestrator 가 *명시적* unload 책임.
  - 호출 위치: `compare_pipeline_v4/pipeline.py` 의 `analyze_pair_v4()` 안, `observe2` await 끝난 직후 `diff_synthesize` await 직전.
- `diff_synth → translate`: 같은 text 모델 재사용 → unload **불필요**
- 분석 종료 직후 (gate 안에서) `force_unload_all_loaded_models()` 호출 — 옛 v3 패턴 유지 (다음 ComfyUI dispatch 와 race 0).

**병렬 실행 금지 (sequential 강제)** ⭐ 결정:
- `observe1`, `observe2` 는 같은 vision 모델이라 keep_alive hit 으로 동시 호출 시 시간 30~60초 → 약 절반 가능. 그러나 **sequential 강제** 로 결정.
- 근거: 16GB VRAM 환경에서 vision 모델 동시 inference 시 KV cache + image token 메모리 사용량 swap 위험. ComfyUI Desktop / Ollama / gemma4 가 동시에 메모리 점유 중인 환경에서는 swap → 오히려 느려질 가능성. 안정성 > 속도.
- 미래 더 큰 VRAM (24GB+) 환경 확정 시 재검토 후속.

**예상 시간** (16GB VRAM, RTX 4070 Ti SUPER 기준 추정):
- vision_observe × 2: 약 30~60초
- diff_synthesize: 약 15~30초 (text-only)
- translate: 약 10~20초
- 총: **약 55~110초** (vision 분석 페이지 단일 약 30~60초 대비 약 2배)

### 3.2 On-demand 추가 stage (사용자 결과 화면 버튼 클릭 시)

```
[per-image] prompt_synthesize(observation_i) → image_i 의 t2i prompt
```

추가 호출. 결과 화면 각 이미지 카드 안 "이 이미지 t2i prompt 만들기" 버튼.

### 3.3 진행 모달 stage (`pipeline-defs.tsx` 의 `PIPELINE_DEFS["compare"]` 갱신)

기존 — compare context 3 stage (`compare-encoding` → `vision-pair` → `translation`) · edit context 만 `intent-refine` 1 stage 추가 (캐시 미스 시) — → **신규 5 stage** (compare context):

```ts
"compare": [
  { type: "compare-encoding", label: "이미지 A/B 인코딩", subLabel: "browser" },
  { type: "observe1",         label: "Image1 관찰",       subLabel: visionSubLabel },
  { type: "observe2",         label: "Image2 관찰",       subLabel: visionSubLabel },
  { type: "diff-synth",       label: "차이 합성",         subLabel: "gemma4-un (think:false)" },
  { type: "translation",      label: "한국어 번역",       subLabel: "gemma4-un" },
]
```

- `compare-encoding` 은 옛 호환 그대로 유지 (browser 단계 표시).
- `intent-refine` 은 edit context 전용. compare context 흐름에선 emit 안 함. PIPELINE_DEFS 정의에서 *type* 키 기준으로 표시되므로 edit/compare 분기는 stage 도착 여부만 다름.
- `visionSubLabel` 콜백 (settings.visionModel 동적 반영) 은 이미 vision 분석 페이지에 도입됨 — 재사용.

---

## 4. Schema

### 4.1 vision_observe — 재사용 (무변경)

`backend/studio/vision_pipeline/vision_observe.py:VISION_OBSERVATION_SYSTEM` 그대로. observation JSON schema (subjects/environment/lighting_and_color/photo_quality/uncertain) 는 두 이미지 동일.

### 4.2 diff_synthesize — 신규

새 시스템 프롬프트 `DIFF_SYNTHESIZE_SYSTEM`. text 모델 (gemma4-un, think:false) 이 두 observation JSON + (선택) compare_hint 받아 차이 합성.

**입력 user payload**:
```
Image1 observation JSON: { ... }
Image2 observation JSON: { ... }
User comparison hint (optional): "..."
```

**출력 schema (STRICT JSON)**:
```json
{
  "summary": "<en, 3-5 sentences — 두 이미지 종합 비교 한 단락>",
  "common_points": ["<en short phrase>", "..."],
  "key_differences": ["<en short phrase>", "..."],

  "domain_match": "person|object_scene|mixed",

  "category_diffs": {
    "composition":            { "image1": "<en>", "image2": "<en>", "diff": "<en>" },
    "subject":                { "image1": "<en>", "image2": "<en>", "diff": "<en>" },
    "clothing_or_materials":  { "image1": "<en>", "image2": "<en>", "diff": "<en>" },
    "environment":            { "image1": "<en>", "image2": "<en>", "diff": "<en>" },
    "lighting_camera_style":  { "image1": "<en>", "image2": "<en>", "diff": "<en>" }
  },

  "category_scores": {
    "composition":           <integer 0-100 OR null>,
    "subject":               <integer 0-100 OR null>,
    "clothing_or_materials": <integer 0-100 OR null>,
    "environment":           <integer 0-100 OR null>,
    "lighting_camera_style": <integer 0-100 OR null>
  },

  "key_anchors": [
    { "label": "<en short — gaze direction / hand position 등>", "image1": "<en>", "image2": "<en>" }
  ],

  "fidelity_score": <integer 0-100 OR null>,
  "transform_prompt": "<en t2i instructions to turn image1 into image2>",
  "uncertain": "<en or empty string>"
}
```

**STRICT JSON 출력 룰** ⭐ (vision_pipeline v3.3 mapping 결함 학습 박제):
- **모든 키 항상 출력** — 키 누락 절대 금지. parser 의 KeyError 방지.
- `category_diffs` 가 `mixed` 도메인이라 비어있을 때도 `{}` 빈 객체 명시 — 키 자체 누락 X.
- `category_scores` 도 동일 — 1차 spec 에선 frontend 가 이 필드를 읽지 않지만 **schema 에 박제**. Phase 2 (chip 클릭 펼침) 도래 시 backend prompt 한 줄 + frontend 펼침만 추가하면 됨 (forward-compat 비용 거의 0). 1차 합성 단계에서 모델은 `null` 또는 추정값 채워도 OK.
- `fidelity_score`: 키 항상 출력. 값은 `0~100 정수` 또는 `null`. 키 자체 누락 X.
- `uncertain`: 비어있으면 `""` (빈 문자열). 키 누락 X.

**Schema 의미 규칙**:
- `domain_match` 가 `"mixed"` (이종 도메인 — 한쪽은 person, 한쪽은 object_scene) 이면 `category_diffs` 는 `{}` 빈 객체. 대신 `key_anchors` 가 풍부.
- `domain_match` 가 `"person"` 또는 `"object_scene"` 이면 5 카테고리 (vision_pipeline 의 9 슬롯 중 매핑 가능한 5개) 모두 채워야 함.
- `fidelity_score`: 두 이미지 시각 유사도 0-100. `domain_match == "mixed"` 이거나 두 이미지가 본질적으로 다른 컨셉이면 `null`.
- `key_anchors`: 의미 있는 visual anchor (gaze / hand position / outfit detail 등) 3-8 개. 동도메인에선 카테고리 매트릭스 보조, 이도메인에선 메인.

**시스템 프롬프트 핵심 룰** (Vision 정공법 그대로 이식):
- Boilerplate 금지 — "golden hour, 85mm lens, masterpiece" 등 명시 차단
- Anchor Fidelity Rules — observation JSON 의 구체적 phrase 그대로 인용 ("transparent raincoats" → "silhouettes" 같은 generalize 금지)
- Identity / brand / celebrity 금지
- "Default to LOW end when unsure" (fidelity_score)
- compare_hint 가 비어있지 않으면 그 영역에 집중

**observation sub-detail 활용 지침** (diff_synthesize 시스템 프롬프트에 명시):
- vision_observe 의 sub-detail 슬롯 (subjects.face_detail / object_interaction / clothing_detail / environment.crowd_detail 등) 을 카테고리 매트릭스 + key_anchors 에 녹여 활용하라.
- "left_eye=closed, right_eye=open" → key_anchors 에 `{ "label": "eye state", "image1": "winking — left eye closed", "image2": "both eyes open" }` 같은 형태로 정밀 캐치.
- 단순히 "eyes" 같은 generic phrase 로 압축 금지.

**fidelity_score 산출 룰** (옛 v2_generic SUBJECT HARD CAPS 의 핵심만 이식):
- gaze direction / head angle / facial expression / pose 중 1개 이상 변경 → score ≤ 90
- 2개 이상 변경 → score ≤ 82
- domain_match == "mixed" → score = null

**compare_hint 처리**:
- hint 비어있으면 user payload 에서 `"User comparison hint: (not provided — compare all aspects)"` 로 채움 — 빈 문자열 그대로 전달 시 모델 혼란 방지.
- hint 있으면 `"User comparison hint: \"<hint, 400자 cap>\""` + 시스템 프롬프트 끝에 "FOCUS this comparison on the user's hint when listed." 강조 1줄 추가.

**list 필드 N개 가이드**:
- `common_points`: 3~6개 (사람이 빠르게 훑는 분량)
- `key_differences`: 3~6개
- `key_anchors`: 동도메인 3~5개 / mixed 도메인 5~8개 (mixed 에선 매트릭스 공백 보충)

### 4.3 결과 dataclass (백엔드 → frontend)

```python
@dataclass
class CompareCategoryDiff:
    image1: str           # en
    image2: str           # en
    diff: str             # en
    image1_ko: str        # ko (translate 단계에서 채움)
    image2_ko: str
    diff_ko: str

@dataclass
class CompareKeyAnchor:
    label: str            # en (label 은 번역 안 함 — 짧은 phrase)
    image1: str
    image2: str
    image1_ko: str
    image2_ko: str

@dataclass
class CompareAnalysisResultV4:
    # 헤더
    summary_en: str
    summary_ko: str
    common_points_en: list[str]
    common_points_ko: list[str]
    key_differences_en: list[str]
    key_differences_ko: list[str]

    # 도메인 + 매트릭스
    domain_match: str     # "person" | "object_scene" | "mixed"
    category_diffs: dict[str, CompareCategoryDiff]   # 5 카테고리 (mixed 면 빈 dict)
    key_anchors: list[CompareKeyAnchor]

    # 점수 + 변환
    fidelity_score: int | None    # 0-100 또는 None
    category_scores: dict[str, int | None]   # forward-compat (Phase 2 chip 펼침용 · 1차에선 frontend 미사용)
    transform_prompt_en: str
    transform_prompt_ko: str
    uncertain_en: str
    uncertain_ko: str

    # 원본 observation (on-demand prompt_synthesize 시 재사용)
    observation1: dict[str, Any]
    observation2: dict[str, Any]

    # 메타
    provider: str         # "ollama" | "fallback"
    fallback: bool
    analyzed_at: int      # ms epoch
    vision_model: str     # 실 사용 모델 ID
    text_model: str
```

---

## 5. UI / Layout

### 5.1 페이지 (`/vision/compare`)

상단 AppHeader → `400px 좌패널 / 1fr 우패널` grid (다른 5 페이지 통일 layout).

**우패널 ASCII wireframe** (스크롤 길이 가늠용):

```
┌─────────────────────────────────────────────────────────────────┐
│  CompareResultHeader                          [유사도 87%] ▾    │  ← 5.3.1
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐                              │
│  │  Image1      │  │  Image2      │                              │  ← 5.3.2 분리
│  │  thumbnail   │  │  thumbnail   │                              │
│  └──────────────┘  └──────────────┘                              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  ◀━━━━━━━━━━━━━━━ ⇔ ━━━━━━━━━━━━━━━▶  (drag 핸들)            ││  ← 5.3.2 슬라이더
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  공통점: [chip] [chip] [chip]    차이점: [chip] [chip] [chip]    │  ← 5.3.3
├─────────────────────────────────────────────────────────────────┤
│  카테고리 매트릭스 (mixed 도메인이면 생략)                       │
│  ┌─ 구도 ─────────────────────────────────────────────────────┐ │
│  │ Image1 묘사 | Image2 묘사 | 차이 묘사                     ▾│ │  ← 5.3.4
│  └────────────────────────────────────────────────────────────┘ │
│  ┌─ 피사체 ───────────────────────────────────────────────────┐ │
│  │ ...                                                       ▾│ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌─ 의상·재질 ─┐ ┌─ 환경 ─┐ ┌─ 광원·카메라·스타일 ─┐            │
│  │ ...        │ │ ...   │ │ ...                  │            │
│  └────────────┘ └───────┘ └──────────────────────┘             │
├─────────────────────────────────────────────────────────────────┤
│  Key Anchor (동도메인은 ▾ 펼침, mixed 는 메인)                   │  ← 5.3.5
│  · gaze direction: image1=... | image2=...                       │
│  · hand position:  image1=... | image2=...                       │
├─────────────────────────────────────────────────────────────────┤
│  Transform Prompt                                  [복사]  [한글▾] │  ← 5.3.6
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ "Apply ... to image1 to ..."                                ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  Uncertain (있을 때만)                                            │  ← 5.3.8
│  · ...                                                            │
└─────────────────────────────────────────────────────────────────┘
```

**스크롤 길이 추정**: 약 1800~2400px (FHD 모니터 약 2~3 화면). 사용자 본질 ("자세히 깊이") 의 자연스러운 비용. 정보 밀도 우려는 **구현 Phase 1 끝나고 시각 review 게이트** 두기 — Phase 2 진입 전 사용자 시각 평가 1회 필수.

**On-demand drawer** (5.3.7) 펼치면 추가 약 300~500px. 미사용 default 접힘.

### 5.2 좌패널 (`CompareLeftPanel`)

위 → 아래:
1. **Image1 슬롯** (`CompareImageSlot`) — 업로드 / 붙여넣기 / 드래그
2. **Image2 슬롯** — 동일
3. **비교 지시 (선택)** — `<textarea>` *placeholder*: "예: 얼굴 표정만 집중 비교 / 전체 비교는 비워두세요". 한국어 자유 자연어. 비워도 OK.
4. **비전 모델 카드** — 8B / Thinking 세그먼트 (vision 분석 페이지 컴포넌트 재사용 · `useSettingsStore.visionModel` persist 공유)
5. **비교 분석 시작 CTA** — primary button. 두 이미지 다 있을 때만 활성. 재분석은 동일 버튼 (idempotent).

### 5.3 우패널 (`CompareViewer` + `CompareAnalysisPanel`)

#### 5.3.1 결과 헤더 (`CompareResultHeader`)
- 좌: 종합 한 줄 요약 (한국어, summary_ko)
- 우: **fidelity chip** (유사도 N%) — `domain_match == "mixed"` 또는 `fidelity_score == null` 이면 chip 생략. chip 클릭 시 펼침 → 5축 세부 (선택 — Phase 2 후속 가능, 1차 spec 에선 chip 만)

#### 5.3.2 이미지 영역 (A1 — 분리 + 슬라이더 동시)
- 위: 분리 thumbnail 좌/우 (`CompareImageDual`) — 클릭 시 lightbox
- 아래: BeforeAfter 슬라이더 (`CompareSliderViewer`) — horizontal wipe (drag 핸들)
- 사이즈 다른 두 이미지 → letterbox (검은 여백 padding)
- 슬라이더 wipe 핸들 default = 50%

#### 5.3.3 공통점 / 차이점 칩 영역 (`CompareCommonDiffChips`)
- 좌: "공통점" 라벨 + 칩 N개 (cyan tone)
- 우: "차이점" 라벨 + 칩 N개 (amber tone)
- 칩 hover 시 영문 원문 tooltip

#### 5.3.4 카테고리 매트릭스 (`CompareCategoryMatrix`)
`domain_match != "mixed"` 일 때만 표시. 5 row (composition / subject / clothing_or_materials / environment / lighting_camera_style):

```
┌─────────────────────┬─────────────────────┬─────────────────────┐
│  composition        │                     │                     │
├─────────────────────┼─────────────────────┼─────────────────────┤
│  Image1 묘사 (ko)   │ Image2 묘사 (ko)   │ 차이 묘사 (ko)      │
└─────────────────────┴─────────────────────┴─────────────────────┘
```
- 가로 3-column. studio 페이지는 1024+ min-width 라 모바일 stack 은 YAGNI — 후속 모바일 plan 도래 시 처리.
- 카테고리 라벨 한국어: 구도 / 피사체 / 의상·재질 / 환경 / 광원·카메라·스타일
- 영문 원문 카드별 펼침 (각 row 우상단 작은 ▾ 토글)

#### 5.3.5 Key Anchor 강조 (`CompareKeyAnchors`)
- `domain_match == "mixed"` 이면 메인 (카테고리 매트릭스 자리에)
- 동도메인이면 매트릭스 *아래* 보조 섹션 (toggle 펼침)
- 각 anchor row: `[label] image1: ... | image2: ...` (반응형 layout)

#### 5.3.6 transform_prompt 박스 (`CompareTransformBox`)
- 영문 prompt + "복사" 버튼 (clipboard) + 한국어 번역 펼침 토글
- "이 명령어를 generate / edit 페이지에 붙여넣어 image1 을 image2 처럼 변환하세요" 안내

#### 5.3.7 On-demand t2i prompt 합성 버튼 (`CompareImageDetailDrawer`)
- 분리 thumbnail 각각에 작은 버튼 "이 이미지 t2i prompt 만들기"
- 클릭 시 추가 호출 (gemma4 prompt_synthesize · observation 재사용 → 추가 vision 호출 X)
- 합성 완료 후 thumbnail 아래 펼침 영역에 prompt 표시 + 복사 버튼
- 합성 결과는 `useVisionCompareStore` 에 휘발 캐시 (페이지 떠나면 사라짐 · DB 저장 X)

**UX 정책** ⭐ (구현 진입 전 닫음):
- **진행 모달 안 띄움** — 5 stage 메인 모달 (`<ProgressModal />`) 과 충돌 방지. 메인 모달은 분석 단계 전용.
- **인라인 spinner** — drawer 펼침 영역 내부에 작은 spinner + "프롬프트 합성 중..." 텍스트 (약 10~20초).
- **토스트 안 띄움** — 성공 시 spinner → 결과 prompt 자동 교체 (silent success). 실패 시 *그 때만* 에러 토스트 1회 ("프롬프트 합성 실패 — 다시 시도해주세요").
- **버튼 비활성 (전역 직렬화)** — 합성 중인 동안 **양쪽 이미지의 버튼 모두 disabled** (전역 동시 1건만). §6.4 GPU lock 정책과 일관 — `gpu_slot` 30초 wait 후 busy 라 진짜 queue 가 아니므로 UI 직렬화로 충돌 차단.
- **재합성** — 결과 영역 우상단 "재합성" 작은 버튼 (사용자가 결과 마음에 안 들 때).

#### 5.3.8 uncertain 박스 (`CompareUncertainBox`)
- 비어있지 않으면 페이지 끝에 작은 회색 박스로 노출 (영문 + 한국어)

---

## 6. API 변경

### 6.1 endpoint 시그니처 (호환 유지)

`POST /api/studio/compare-analyze` (multipart) — 그대로. `meta.context` 분기:

| context | 호출 함수 | 변경 |
|---------|----------|------|
| `"edit"` | `analyze_pair` (v3) | **무변경** |
| `"compare"` | ~~`analyze_pair_generic` (v2_generic)~~ → `analyze_pair_v4` (신규) | **교체** |

### 6.2 meta 필드

| 필드 | 변경 | 설명 |
|------|------|------|
| `context` | 동일 | `"edit"` / `"compare"` |
| `compareHint` | 동일 | 자유 자연어. `analyze_pair_v4` 의 user payload 에 주입 |
| `visionModel` | 동일 | 8B / Thinking |
| `ollamaModel` | 동일 | text 모델 (gemma4-un) |
| ~~`promptMode`~~ | **제거** | precise/fast 분기 불필요 (분석 + 차이 본질에 무관). v4 receiver 가 이 키를 받으면 **무시** (400 안 던짐 — 옛 frontend 가 무관 키 보낼 가능성 ↓ 안전망). frontend 쪽에서 더 이상 보내지 않음. |

### 6.3 SSE event 계약 ⭐ (정확 박제 — 옛 코드 호환 + frontend contract 보호)

**stage event** (`event: stage`) data payload — 옛 계약 유지 + extra 자유:
```jsonc
// 필수 키 (frontend compare.ts 가 destructure 함)
{ "type": "<stage_type>", "progress": <0~100>, "stageLabel": "<ko 라벨>", ... }

// 실 시퀀스 (compare context · V4)
{ "type": "compare-encoding", "progress": 5,  "stageLabel": "이미지 A/B 인코딩" }
{ "type": "observe1",         "progress": 20, "stageLabel": "Image1 관찰" }
{ "type": "observe2",         "progress": 40, "stageLabel": "Image2 관찰" }
{ "type": "diff-synth",       "progress": 70, "stageLabel": "차이 합성" }
{ "type": "translation",      "progress": 90, "stageLabel": "한국어 번역" }
// 완료 시점 (PipelineTimeline byType Map 에서 마지막 payload 흡수 → renderDetail 가 사용)
{ "type": "translation",      "progress": 95, "stageLabel": "한국어 번역 완료",
  "summaryKo": "<ko summary>" }
```

**done event** (`event: done`) data payload — **{ analysis, saved }** 계약 *유지*:
```jsonc
{ "analysis": <CompareAnalysisResultV4 JSON · result_obj.to_dict()>, "saved": <bool> }
```

frontend `compare.ts:155` 가 `json.analysis` 파싱하므로 **키 이름 `result` 가 아니라 `analysis`** — 옛 계약 그대로. 본 spec 의 신규 키 도입 없음.

**error event** (`event: error`):
```jsonc
{ "message": "<ko 또는 en>", "code": "gpu_busy|internal|..." }
```

### 6.4 신규 endpoint (on-demand t2i prompt)

```
POST /api/studio/compare-analyze/per-image-prompt
body: { observation: <observation JSON>, ollamaModel?: string }
response: { summary, positive_prompt, negative_prompt, key_visual_anchors, uncertain }
```

**응답 형식**: **단일 JSON 응답 (non-SSE)** — `prompt_synthesize` 가 단일 호출 (vision 안 거침) 이라 SSE 불필요. frontend 는 그냥 `await fetch(...).then(r => r.json())`.

`prompt_synthesize` 직접 호출. 이미 캐시된 observation 을 client 가 보내므로 추가 vision 호출 0건. 약 10~20초 소요.

**timeout**: backend 60초 (gemma4 think:false 일반 응답 시간 + margin). 초과 시 504 응답.

**GPU lock 정책** ⭐ (Codex 검증 — `_gpu_lock.py:16` 30초 wait 후 busy):
- 본 endpoint 도 **`gpu_slot("compare-per-image-prompt")` 통과 필수** — 메인 분석 / ComfyUI dispatch 와 충돌 차단.
- 진짜 queue 가 아니라 30초 wait 후 GpuBusyError → 사용자 시점 호출 시 메인 분석이 *이미 끝난* 상태가 default. 충돌은 드물지만 안전망.
- **UI 직렬화** — frontend 는 *전역에서 동시 1건만 허용*. image1 / image2 버튼 중 한쪽 합성 중이면 다른 쪽 disabled. 이유: per-image 호출이 같은 text 모델 (gemma4) 큐에서 직렬 처리 → 동시 호출해도 백엔드 직렬. UI 에서 명확하게 disabled 시키는 게 사용자 혼란 방지.
- **busy 시 처리** — backend 가 `GpuBusyError` → 503 응답 + `{ "code": "gpu_busy", "message": "..." }`. frontend 는 토스트 표시 + 버튼 enable 복원.

---

## 7. 백엔드 모듈 구조

### 7.1 신설

```
backend/studio/compare_pipeline_v4/
  __init__.py                      # facade (analyze_pair_v4 export · sub-module re-export)
  _types.py                        # dataclass 만 (CompareCategoryDiff / CompareKeyAnchor / CompareAnalysisResultV4)
  _axes.py                         # 5 카테고리 axes 상수 (composition / subject / clothing_or_materials / environment / lighting_camera_style)
  _coerce.py                       # JSON 정규화 helper (sentinel filter / score coerce / list coerce — vision_pipeline observation_mapping 패턴 재사용)
  diff_synthesize.py               # DIFF_SYNTHESIZE_SYSTEM + synthesize_diff(obs1, obs2, hint)
  translate.py                     # 결과 dataclass 의 *_en → *_ko 일괄 번역 (vision_pipeline 의 translate 패턴)
  pipeline.py                      # analyze_pair_v4 (4 stage orchestration)
```

**사전 분할 근거** (vision_pipeline Phase 4.2 학습 박제):
- `_common.py` 단일 파일에 dataclass + helper + axes 다 몰면 후속 분할 (helper 추출 / 옵션 D refactor) 시 patch site 갱신 비용 큼. 처음부터 책임별 분할.
- `_types.py` / `_axes.py` / `_coerce.py` 3 파일로 분리 — 각 책임 단일.
- **import 패턴: 옵션 D** — sub-module 직접 import (`from .compare_pipeline_v4._coerce import ...`). 신규 코드에서 facade alias 사용 안 함. 이유: facade re-export 가 *함수 reference snapshot* 이라 mock.patch lookup 이 정의 위치 모듈에서 일어나야 정확. vision_pipeline Phase 4.3 codex C2 함정과 동일 정책.
- facade `__init__.py` 의 re-export 는 production import 호환만 (`from .compare_pipeline_v4 import analyze_pair_v4`). 본체 0줄, alias 만.

### 7.2 폐기

- `backend/studio/comparison_pipeline/v2_generic.py` — **삭제** (legacy quarantine 안 함 — production 호환 0건이라 그냥 삭제가 깔끔)
  - `analyze_pair_generic`, `SYSTEM_COMPARE_GENERIC`, `_COMPARE_HINT_DIRECTIVE`, `_call_vision_pair_generic` 모두 함께
  - facade `__init__.py` 의 re-export 도 정리 (`SYSTEM_COMPARE_GENERIC`, `_COMPARE_HINT_DIRECTIVE`, `analyze_pair_generic`, `_call_vision_pair_generic` line 제거)
  - 옛 테스트 (`backend/tests/test_comparison_pipeline_generic.py` 등) 삭제
- `backend/studio/comparison_pipeline/v3.py` — **무변경 (Edit context)**

git 이력에 살아있으므로 필요 시 `git log --diff-filter=D` 로 복원 가능. legacy/ quarantine 은 production 에 호환 필요한 옛 라우터/서비스 패턴이라 본 케이스에 부적합.

### 7.3 호출 site 갱신

- `backend/studio/pipelines/compare_analyze.py` — `context == "compare"` 분기에서 `analyze_pair_v4` 호출
- `backend/studio/routes/compare.py` — `analyze_pair_generic` import 제거 (v3 의 `analyze_pair` 만 남김)

**Route 입력 검증 보강** ⭐ (Codex 검증 — observe_image 가 width/height 필요):
- 현재 `routes/compare.py:62` 는 `await source.read()` 후 bytes 만 사용. PIL 검증 / 치수 추출 없음.
- V4 가 `vision_observe.observe_image(bytes, width=..., height=...)` 호출하므로 **route 에서 A/B 각각 width/height 추출** 필요.
- 패턴 (vision 분석 페이지 endpoint 와 동일):
  ```python
  from PIL import Image
  import io
  source_img = Image.open(io.BytesIO(source_bytes))
  source_w, source_h = source_img.size
  source_img.verify()  # 손상 검증
  # result_img 동일
  ```
- `_run_compare_analyze_pipeline` 시그니처에 `source_w / source_h / result_w / result_h` 추가 → V4 가 그대로 `observe_image` 에 전달.
- 검증 실패 (PIL 손상 / 사이즈 0) → `HTTPException(400, "invalid image")`.

**Persist context 분기 보강** ⭐ (Codex 검증 — 현재 `historyItemId` 만 보고 update_comparison 호출):
- 현재 `pipelines/compare_analyze.py:213-220` 가 `historyItemId` 매칭만 보고 `update_comparison()` 호출. **context 분기 없음**.
- V4 결과 shape 가 edit history row 에 잘못 저장될 위험 (compare context 인데 historyItemId 가 우연히 gen-/edit-/vid- 매치).
- **명시 차단**: `if context != "compare" and HISTORY_ID_RE.match(history_item_id_raw): ...` — compare context 일 때 *영구 저장 금지* (휘발 store 결정 박제 §9 일관).
- 옛 edit context (v3) 의 persist 동작은 그대로 유지.

---

## 8. 프론트엔드 변경

### 8.1 신설 컴포넌트

```
frontend/components/studio/compare/
  CompareResultHeader.tsx          # summary_ko + fidelity chip
  CompareImageDual.tsx             # 분리 thumbnail 좌/우 + on-demand 버튼
  CompareSliderViewer.tsx          # BeforeAfter horizontal wipe (BeforeAfterSlider 재활용)
  CompareCommonDiffChips.tsx       # 공통점/차이점 칩 영역
  CompareCategoryMatrix.tsx        # 5 카테고리 매트릭스 (3-col)
  CompareKeyAnchors.tsx            # key anchor 강조
  CompareTransformBox.tsx          # transform_prompt + 복사
  CompareImageDetailDrawer.tsx     # on-demand 합성 결과 펼침
  CompareUncertainBox.tsx
```

### 8.2 갱신

- `frontend/lib/api/types.ts:214` — `VisionCompareAnalysis` 타입 → `VisionCompareAnalysisV4` (신규 dataclass 미러 · 한글 주석 narrow union)
- `frontend/lib/api/compare.ts` — SSE drain 새 stage (5 stage 포함 compare-encoding) 처리. done payload 계약 `{ analysis, saved }` 그대로 유지 (frontend `compare.ts:155` 무변경).
- `frontend/lib/api/mocks/compare.ts` — V4 fixture 로 교체 (옛 `mockCompareAnalyze` 의 5축 score shape 폐기)
- `frontend/stores/useVisionCompareStore.ts` — observation1/2 + perImagePrompt 캐시 필드 추가. 옛 `overall/scores/comments` 필드 제거.
- `frontend/lib/pipeline-defs.tsx:363` — `PIPELINE_DEFS["compare"]` 5 stage (compare-encoding + observe1 + observe2 + diff-synth + translation) 로 교체. `intent-refine` 은 edit 전용 — compare 분기에선 emit 안 됨.
- `frontend/components/studio/compare/CompareAnalysisPanel.tsx:70` — v4 렌더로 전면 재작성

**`to_dict()` API key 네이밍** ⭐ (frontend 가 받을 dict shape — V4 dataclass 필드명 그대로 직렬화):
```python
def to_dict(self) -> dict[str, Any]:
    return {
        "summaryEn": self.summary_en,
        "summaryKo": self.summary_ko,
        "commonPointsEn": self.common_points_en,
        "commonPointsKo": self.common_points_ko,
        "keyDifferencesEn": self.key_differences_en,
        "keyDifferencesKo": self.key_differences_ko,
        "domainMatch": self.domain_match,
        "categoryDiffs": { k: v.to_dict() for k, v in self.category_diffs.items() },
        "categoryScores": self.category_scores,
        "keyAnchors": [a.to_dict() for a in self.key_anchors],
        "fidelityScore": self.fidelity_score,
        "transformPromptEn": self.transform_prompt_en,
        "transformPromptKo": self.transform_prompt_ko,
        "uncertainEn": self.uncertain_en,
        "uncertainKo": self.uncertain_ko,
        "observation1": self.observation1,
        "observation2": self.observation2,
        "provider": self.provider,
        "fallback": self.fallback,
        "analyzedAt": self.analyzed_at,
        "visionModel": self.vision_model,
        "textModel": self.text_model,
    }
```
- snake_case (Python) → camelCase (JSON). 옛 v3/v2_generic to_dict 가 `summary_en`/`summary_ko` 같은 snake_case 였던 것과 다름 — frontend 친화로 통일.
- frontend `types.ts` 의 `VisionCompareAnalysisV4` 인터페이스가 이 키 그대로 반영.

**OpenAPI 자동 동기화 한계** ⭐ (Codex 검증):
- `/compare-analyze` POST response model = `TaskCreated` (not analysis). SSE done payload 의 `analysis` JSON 은 OpenAPI schema 에 **잡히지 않음**.
- → `npm run gen:types` 가 V4 analysis drift 를 *자동 검출 못 함*. 안전망 약함.
- **대체 안전망**: **frontend contract test 신설** — `__tests__/api-vision-compare-contract.test.ts`:
  - 백엔드 `to_dict()` 의 모든 키가 frontend `VisionCompareAnalysisV4` interface 에 존재 (필수 키 누락 검출)
  - 한국어 + 영어 슬롯 짝 (`summaryEn` ↔ `summaryKo` 등) 검증
  - `categoryDiffs` 가 5 카테고리 키 (composition / subject / clothing_or_materials / environment / lighting_camera_style) 모두 포함 또는 빈 객체 (mixed) — 키 누락 검출
- backend 도 `tests/test_compare_v4_to_dict.py` 추가 — 모든 key 명시 + camelCase 변환 검증.
- 한글 주석 / narrow union 가치 있는 타입은 `lib/api/types.ts` 손편집 유지 (CLAUDE.md rule). `Schemas["..."]` alias 는 V4 analysis 에 적용 X (TaskCreated 만 잡힘).

**VisionModelSelector 컴포넌트 추출** ⭐ (Codex 권장):
- 현재 `app/vision/page.tsx:241-260` inline 코드 (8B / Thinking 카드 세그먼트). 컴포넌트 파일 없음.
- 본 spec 에서 Compare 페이지가 같은 UI 재사용 → **컴포넌트 추출 선행**:
  - 신설: `frontend/components/studio/VisionModelSelector.tsx` (props: `value`, `onChange`)
  - `app/vision/page.tsx` inline 코드 제거 + 새 컴포넌트 사용
  - `CompareLeftPanel` 도 동일 컴포넌트 사용 (settings.visionModel persist 공유)
- 추출 작업은 본 redesign plan 의 Phase 0 (선행 정리) 로 분리 가능 — 다른 페이지 (vision/edit 자동 트리거) 영향 없는 lint/test 확인 후.

### 8.3 폐기 또는 Legacy

- `CompareAnalysisPanel` 의 점수 매트릭스 렌더 (5축 0-100 막대) 코드 제거
- `CompareViewer` 의 점수 정렬 로직 제거

---

## 9. 마이그레이션 / 호환

| 영역 | 정책 |
|------|------|
| Edit context (v3) | 변경 없음. 기존 `analyze_pair` + 5 슬롯 매트릭스 + intent 그대로. |
| 기존 v2_generic 사용자 데이터 | DB 저장 X (휘발 store) — 데이터 마이그레이션 불필요 |
| frontend `VisionCompareAnalysis` 옛 타입 | 신규 V4 로 교체 (1:1 mapping 없음 — 점수 매트릭스 vs 카테고리 매트릭스 의미 다름) |
| 옛 테스트 (`test_comparison_pipeline_generic.py` 등) | 새 모듈에 맞춰 재작성. 옛 fixture 폐기. |

**Breaking change 동기**: v2_generic 의 점수 매트릭스 패러다임이 새 본질 ("분석 + 차이") 과 의미가 다름. 호환 어댑터 만들면 두 패러다임 섞여 코드 복잡 → YAGNI.

---

## 10. 검증 / 테스트

### 10.1 백엔드 unit (pytest) — 신규 + 갱신

신규:
- `tests/test_compare_v4_pipeline.py` — 5 stage orchestration mock (compare-encoding + observe1 + observe2 + diff-synth + translation), 결과 dataclass shape, unload 호출 검증 (observe2 → diff-synth 사이)
- `tests/test_diff_synthesize.py` — 시스템 프롬프트 + DIFF_SYNTHESIZE 응답 파싱 (정상 / domain_match=mixed / fidelity_score=null / 키 누락 fallback / category_scores 옵셔널)
- `tests/test_compare_v4_translate.py` — 영문→한국어 번역 flatten/unflatten (실패 시 *_ko 가 *_en 으로 fallback). `category_diffs` 안의 image1/image2/diff 트리플 + `key_anchors[]` 안의 image1/image2 + summary + common_points + key_differences + transform_prompt + uncertain 모두 일괄 번역.
- `tests/test_compare_v4_to_dict.py` — `to_dict()` 출력 키 명시 검증 (snake_case → camelCase) + 모든 필드 존재
- `tests/test_compare_per_image_prompt_endpoint.py` — observation 재사용 endpoint (단일 JSON 응답 + gpu_slot 통과 + 60초 timeout)
- `tests/test_compare_route_validation.py` — A/B PIL 검증 + width/height 추출 + 손상 이미지 400 응답
- `tests/test_compare_persist_context.py` — context="compare" 일 때 update_comparison 호출 안 함 (휘발), context="edit" 일 때 호출 (옛 동작 유지)

갱신:
- `tests/test_compare_analyze_route.py` — 메타 필드 (compareHint / visionModel / ollamaModel) 정상 통과, promptMode 받아도 무시 (400 안 던짐)
- 실측 시나리오 4종 (시나리오 1, 2, 4, 5 각 1 케이스) — fixture observation pair → 기대 schema 충족

폐기:
- `tests/test_comparison_pipeline_generic.py` — 옛 v2_generic 전용. 삭제.

### 10.2 프론트 unit (vitest) — 신규 + 갱신

신규:
- `__tests__/api-vision-compare-contract.test.ts` — backend `to_dict()` 키 ↔ frontend `VisionCompareAnalysisV4` interface 정합성 (OpenAPI 한계 보완)
- `components/studio/compare/CompareCategoryMatrix.test.tsx` — 5 카테고리 row + mixed 도메인 시 빈 dict 처리
- `components/studio/compare/CompareCommonDiffChips.test.tsx` — 공통점 / 차이점 칩 렌더
- `components/studio/compare/CompareTransformBox.test.tsx` — 복사 버튼 + 한국어 토글
- `components/studio/compare/CompareImageDetailDrawer.test.tsx` — on-demand 합성 spinner / silent success / 실패 토스트 / disabled 상호 배제
- `components/studio/VisionModelSelector.test.tsx` — vision/compare 공용 컴포넌트 (8B/Thinking 토글)

갱신:
- `__tests__/api-vision-compare.test.ts` — stage 시퀀스 vision-pair → **observe1/observe2/diff-synth/translation** + done payload `{analysis, saved}` 유지
- `__tests__/pipeline-defs-consistency.test.ts` — compare 핵심 stage 변경 (5 stage)
- `__tests__/stores-stage-history.test.ts` — V4 stage type + V4 analysis fixture
- `__tests__/uniform-compare-cards.test.tsx` — 옛 5축 panel fixture 폐기 → V4 fixture 로 교체
- `stores/useVisionCompareStore.test.ts` — observation 캐시 + on-demand 합성 결과 저장 + 옛 `overall/scores/comments` 필드 폐기 검증

폐기:
- `lib/api/mocks/compare.ts` 의 옛 fixture (5축 score shape) — 본 store 테스트 갱신 시 함께 폐기.

### 10.3 사용자 시각 검증 (browser MCP)

| # | 시나리오 | fixture |
|---|----------|---------|
| 1 | 같은 인물 다른 컷 | 카리나 사진 2장 (`docs/design-test/assets/raw/`) — pose / expression 만 다른 변형 |
| 2 | 레퍼런스 ↔ 결과 | 레퍼런스 사진 + 같은 컨셉으로 생성한 Qwen 2512 결과 (history DB 에서 선택) |
| 4 | 이종 (사진 vs 일러스트) | 풍경 사진 + ChatGPT Image (이미 raw/ 에 있음 · `2026년 5월 3일 오후 05_07_13.png` 류) |
| 5 | 같은 prompt 다른 모델 | Wan 22 i2v 결과 frame 1 추출 + 같은 i2v 의 LTX 2.3 결과 frame 1 추출 — 정지 이미지로 비교. (또는 generate 결과끼리: Qwen 2512 + Lightning 2 결과 vs Lightning 토글 OFF 결과) |

**시나리오 5 fixture 정책**: 영상 frame 추출은 `ffmpeg -i input.mp4 -vframes 1 frame.png` 로 정지 이미지화 (1차 spec 에선 manual). 후속에선 영상 모달 안에서 한 frame 자동 export 옵션 plan 후보.

→ 6/6 production 품질 도달 시 spec OK (vision precision 기준 동일).

---

## 11. 알려진 함정 / 후속

### 11.1 알려진 함정

- **두 이미지 사이즈 차이 큰 경우**: 슬라이더 letterbox 처리. UI 답답할 수 있지만 crop 보다 안전 (정보 잃지 않음).
- **fidelity_score 의미 모호 case**: 동도메인이지만 다른 컨셉 (인물 A vs 인물 B 다른 사람). 이 때 점수 의미 약하지만 chip 표시. 사용자가 시각적으로 판단.
- **gemma4 의 anchor fidelity 위반**: vision 분석 페이지 v3.3 에서 본 함정 (라벨 없는 콤마 join 누수, sentinel filter 우회 등) 가 diff_synthesize 에도 발생 가능. observation_mapping 의 `_format_*` helper 에서 검증된 패턴 재사용.
- **이종 도메인 detection 부정확**: 한쪽이 풍경 안에 사람이 있는 경우 등. domain_match="mixed" 로 안전하게 fallback.
- **token cost**: 4 stage 호출 (vision 2 + text 2). vision 분석 페이지 단일 호출 대비 약 2.5배. 사용자에게 시간 안내 (진행 모달 stage subLabel).

### 11.2 후속 plan 후보 (1차 spec 안 함)

- **Phase 2: fidelity chip 클릭 시 5축 세부 펼침** — 1차 schema 에 `category_scores` 옵셔널 슬롯 이미 박제 → backend prompt 한 줄 + frontend chip 펼침만 추가 (schema breaking 없음).
- **Phase 3: 결과 deep link** — "이 transform_prompt 로 generate" 버튼 → /generate 페이지 prefill (현재 spec 의 (C) 옵션).
- **Phase 4: 결과 영구 저장** — DB schema v9 migration. 갤러리 + 재방문.
- **Phase 5: 3개 이상 이미지 비교** — 현재는 2개 한정. N개 비교는 별도 plan.
- **Phase 6: Edit context (v3) 도 v4 패러다임으로 통합** — Edit 의 의도/슬롯 매트릭스를 분석+차이 패러다임에 맞춰 재구성. 사용자 명시: "Compare 완벽히 한 후 Edit".

**5 페이지 통일 layout 충돌 인계** (2026-05-04 master `fa3cb6d` 기준):
- 직전 master 가 5 페이지 결과 카드 통일 (`.ais-result-hero` / `.ais-result-hero-plain`) 박았는데, 본 spec 의 v4 결과 헤더는 새로 디자인. v3 (Edit context) 와 v4 (Compare) 결과 헤더가 다르게 생김 → 5 페이지 통일 일시 깨짐.
- 의도적 — 사용자 명시 "Compare 완벽히 한 후 Edit". **Phase 6 (Edit v3 → v4 통합)** 도래 전까진 Compare 결과 헤더가 다른 4 페이지 패턴과 일관성 깨진 상태 유지.
- Phase 6 plan 작성 시 5 페이지 통일 디자인을 어떻게 흡수/대체할지 결정 후속.

**plan 박제 후속**:
- 본 spec 검토 + 사용자 승인 후 → `docs/superpowers/plans/2026-05-05-vision-compare-redesign.md` (TDD Phase 분할) 작성 단계로. superpowers 워크플로우 (spec → plan → 구현). brainstorming skill 의 `writing-plans` skill 호출.

---

## 12. 결정 이력 (사용자 의도 박제)

- **2026-05-05 brainstorming (이 spec 의 출발점)**:
  - 사용자: "이미지의 차이를 자세히 깊이 분석" 이 본질.
  - 사용자: 시나리오 1, 2, 4, 5 (3 평가는 빠짐) → "분석 + 차이" 무게 중심.
  - 사용자: 옵션 2 (observation only) + on-demand t2i 합성.
  - 사용자: Layout A (Stacked) + 이미지 영역 A1 (분리 + 슬라이더 동시).
  - 사용자: 5 가지 작은 결정 (점수 chip / hint 유지 / on-demand 합성 / 비전 모델 카드 / 매트릭스 가로 3-col) 모두 추천 채택.

- **2026-05-05 spec 검토 round 1** (사용자 12 finding):
  - On-demand UX 정의 / fidelity_score JSON 표기 / forward-compat (category_scores 슬롯) / ASCII wireframe + 시각 게이트 / 5 페이지 통일 충돌 인계 / sequential 강제 근거 / promptMode 제거 못박기 / _common 사전 분할 + 옵션 D / 768px YAGNI / 시나리오 5 fixture / gen:types 절차 / plan 후속 — 12 항목 모두 spec 박제.

- **2026-05-05 spec 검토 round 2** (사용자 Codex 정밀 리뷰):
  - SSE 계약 정정 — stage `{type, progress, stageLabel}` + done `{analysis, saved}` (옛 코드 호환 그대로 유지). 본 spec 신규 키 도입 없음.
  - Route validation 박제 — A/B PIL verify + width/height 추출 → pipeline 전달.
  - Persist context 분기 — `context == "compare"` 일 때 `update_comparison()` 호출 금지 명시.
  - Frontend 전면 교체 명시 — overall/scores/comments shape 폐기, V4 dataclass 미러로 교체.
  - Unload 호출 위치 박제 — V4 pipeline 이 `observe2 → diff_synth` 사이 명시적 `ollama_unload.unload_model(vision_model)` 호출.
  - GPU lock 정책 — per-image endpoint 도 `gpu_slot` 통과 + UI 직렬화 (한 번에 하나만).
  - OpenAPI 한계 인정 — TaskCreated response 라 SSE done payload 가 schema 에 안 잡힘. **frontend contract test 신설** (`api-vision-compare-contract.test.ts`) 으로 보호.
  - `to_dict()` API key 네이밍 — snake_case → camelCase 변환 명시 (frontend 친화).
  - VisionModelSelector 컴포넌트 추출 (vision page inline → 재사용).
  - 테스트 범위 확대 — backend 7 신규 + 2 갱신 + 1 폐기, frontend 6 신규 + 5 갱신 + 1 폐기.

---

*spec 끝.*
