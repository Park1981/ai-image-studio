# Edit 비교 분석 — 수정 결과 vs 원본 일관성 평가 설계 (Spec)

**작성일**: 2026-04-24
**상태**: 기획 완료 · 구현 예정
**작성자**: Opus 4.7 (사용자 공동 기획)
**세션 참고**: codex 교차리뷰 fix 머지 이후 (`master` HEAD `e7eed30`) 기반 기능 추가
**선행 디자인**: `2026-04-22-ai-image-studio-redesign-design.md` · `2026-04-24-vision-analyzer-design.md`

## 1. 배경 & 목적

`/edit` 모드는 Qwen Image Edit 2511 + 강한 LoRA (`SexGod_CouplesNudity_QwenEdit_2511_v1` 상시 0.7) 로 인물 콘텐츠를 자주 다룬다. 이 워크로드의 핵심 리스크는 **의도하지 않은 identity drift** — 얼굴/체형/배경이 사용자가 의도하지 않은 방향으로 변형되는 현상이다. LTX Video 영상 모드에서도 같은 문제 (`얼굴 drift`) 가 미해결로 남아 있다.

지금은 사용자가 Before/After 슬라이더로 눈으로만 일관성을 판단한다. 객관 평가 도구가 없어서 "조금 변한 거 같은데 얼만큼?" 같은 판단이 주관적이고 누적 통계도 없다.

이 기능은 **수정 결과 (after) 와 원본 (before) 을 비전 모델 (qwen2.5vl) 이 동시에 보고 5축으로 객관 평가** 하여, 사용자가 수정 품질을 정량/정성으로 검증할 수 있게 한다.

### 유스케이스
- 수정 직후 결과 품질 즉시 검증 (얼굴 drift, 의상/배경 의도 외 변화 탐지)
- history 에서 과거 수정 결과 다시 클릭 → 그때 분석한 결과 그대로 다시 보기
- 같은 source 로 여러 번 수정 시도 → 어떤 시도가 더 일관성 좋은지 비교
- 향후 분석 결과 누적 통계 → "어떤 LoRA 조합이 identity 보존 좋은가" 같은 회고 가능

### 비목표 (YAGNI)
- /generate 모드 비교 (원본 없음)
- /video 결과 vs source frame 비교 (frame extract 필요 — 추후)
- 가중치 커스터마이징 (현재 단순 산술 평균)
- 일괄 분석 (history 여러 개 한꺼번에)
- 분석 결과 → "이 차이 줄이려면 prompt 보완" 자동 제안 (추후 Phase 2)
- 분석 결과 누적 통계/대시보드 (추후)
- generate 모드 다중 seed 결과 비교

## 2. 결정 사항 요약

| 항목 | 결정 |
|------|------|
| 진입점 | `/edit` 페이지 슬라이더 하단 인라인 카드 + ImageLightbox 메타 패널 (둘 다) |
| UI 패턴 | "간단히 + 자세히" — 인라인 한 줄 요약 + "자세히" 모달 |
| 평가 5축 | `face_id`, `body_pose`, `attire`, `background`, `intent_fidelity` (인물/누드 특화) |
| 점수 형식 | 0-100 정수 + 색상 dot (≥80 녹, 50-79 노, <50 적) |
| 종합 점수 | 5축 단순 산술 평균 |
| 텍스트 형식 | 항목별 1-2문장 코멘트 + 종합 3-5문장 단락. 영문 원문 + 한국어 번역 둘 다 |
| 트리거 | 수동 default — 사용자가 "분석" 버튼 클릭 시. 설정 토글로 자동 모드 옵션 |
| 자동 모드 안전장치 | 분석 중 다음 수정 시작 시 자동 분석 skip · VRAM 임계 (>13GB) 시 skip |
| 비전 모델 | `Settings.visionModel` 재사용 (기본 `qwen2.5vl:7b`) — multi-image input |
| 번역 모델 | `Settings.ollamaModel` 재사용 (기본 `gemma4-un:latest` · think=False 필수) |
| 데이터 저장 | 영구 (DB · `comparison_analysis` 컬럼) + source 영구 저장 (`source_ref` 컬럼) |
| 재분석 | source_ref 가 살아있을 때만 가능 (옛날 row 는 source 없어 비활성) |
| 호환성 | 기존 row 는 두 컬럼 NULL. UI 가 부재 시 graceful 처리 |

## 3. 아키텍처

### 3.1 컴포넌트 구조

```
┌─────────── Frontend ───────────┐   ┌──────────── Backend ────────────┐
│  app/edit/page.tsx (수정)      │──▶│  studio/router.py               │
│   └ ComparisonAnalysisCard 신  │   │   ├ POST /api/studio/edit       │
│      (인라인 한 줄 + 모달 트리거)│   │   │   (source_ref 도 같이 저장)  │
│                                │   │   └ POST /api/studio/compare-   │
│  components/studio/            │   │       analyze (신)              │
│   ├ ComparisonAnalysisCard 신  │   │                                  │
│   ├ ComparisonAnalysisModal 신 │   │  studio/comparison_pipeline.py  │
│   └ ImageLightbox (수정)       │   │   ├ SYSTEM_COMPARE (신 프롬프트)│
│      └ 메타 패널에 같은 카드   │   │   ├ analyze_pair() (신)         │
│                                │   │   └ _translate_to_ko() (신)     │
│  hooks/useComparisonAnalysis 신│   │                                  │
│   (수동/자동 트리거 + 캐시)    │   │  studio/history_db.py           │
│                                │   │   ├ migrate: source_ref,        │
│  lib/api/compare.ts (신)       │   │     comparison_analysis 컬럼   │
│  lib/api/types.ts (수정)       │   │   ├ update_comparison() (신)    │
│   └ ComparisonAnalysis 타입    │   │   └ HistoryItem 직렬화 확장     │
│                                │   │                                  │
│  stores/useSettingsStore (수정)│   │  studio/vision_pipeline.py      │
│   └ autoCompareAnalysis 토글   │   │   └ multi-image 지원 헬퍼 추가  │
│  stores/useHistoryStore (수정) │   │                                  │
│   └ HistoryItem 신규 필드 처리 │   │  studio/prompt_pipeline.py      │
│                                │   │   └ 한글 번역 헬퍼 재활용       │
└────────────────────────────────┘   └──────────────────────────────────┘
```

### 3.2 데이터 흐름

```
[수동 분석]
사용자 클릭 → useComparisonAnalysis.analyze(sourceRef, resultRef, editPrompt, historyItemId)
  → POST /api/studio/compare-analyze (multipart: source, result, meta)
  → backend: qwen2.5vl multi-image 호출 (5축 + 코멘트 영문 JSON 반환)
  → backend: gemma4-un (think:False) 한글 번역
  → backend: historyItemId 있으면 history_db.update_comparison() 영구 저장
  → backend: ComparisonAnalysis 응답
  → frontend: useHistoryStore.updateItem(id, { comparisonAnalysis })
  → UI: 인라인 카드 한 줄 + 모달 채워짐

[자동 분석 (설정 토글 ON)]
useEditPipeline done 핸들러 → 토글 ON 체크 → busy guard 통과 시
  → 위 동일 흐름 (백그라운드, 사용자 대기 X)
```

## 4. UI 설계

### 4.1 인라인 카드 — `ComparisonAnalysisCard`

위치: `/edit` 페이지 Before/After 슬라이더 바로 아래 + ImageLightbox 메타 패널 안.

3-state 렌더:

**Empty (분석 안 함, source 있음)**
```
┌──────────────────────────────────────────┐
│ 🔍 비교 분석                  [분석]     │ ← 회색 placeholder
└──────────────────────────────────────────┘
```

**Loading (분석 중)**
```
┌──────────────────────────────────────────┐
│ 🔍 분석 중… qwen2.5vl 5-10초 (스피너)   │
└──────────────────────────────────────────┘
```

**Filled (분석 완료)**
```
┌──────────────────────────────────────────────────────┐
│ 🔍 🟢 78% match · 얼굴 🟢92 · 체형 🟡75 · 의상 🟡60  │
│                              [자세히] [재분석]       │
└──────────────────────────────────────────────────────┘
```

**Disabled (source 없음 — 옛날 row)**
```
┌──────────────────────────────────────────┐
│ 🔍 분석 불가 · 원본 이미지가 저장돼 있지 │
│    않은 옛 항목입니다                    │
└──────────────────────────────────────────┘
```

### 4.2 모달 — `ComparisonAnalysisModal`

"자세히" 클릭 시 오픈. 구조:

```
┌─ Modal ──────────────────────────────────────────────────┐
│ 비교 분석 · qwen2.5vl · 2026-04-24 14:32          [×]   │
├──────────────────────────────────────────────────────────┤
│ Before [thumbnail]   ⇄   After [thumbnail]              │
├──────────────────────────────────────────────────────────┤
│ 종합 매치율  🟢 78%                                      │
│                                                          │
│ ▌ 얼굴 ID         🟢 92 ████████████████████░░  92%    │
│ ▌ 체형/포즈       🟡 75 ███████████████░░░░░░  75%    │
│ ▌ 의상/누드 상태  🟡 60 ████████████░░░░░░░░░  60%    │
│ ▌ 배경 보존       🟢 88 █████████████████░░░░  88%    │
│ ▌ 의도 충실도     🟢 95 ███████████████████░░  95%    │
│                                                          │
├─ 항목별 코멘트 ────────────────────────────[ 영문 | 한글 ]┤
│ 얼굴 ID   원본의 눈매와 코 형태가 거의 그대로 보존됨…  │
│ 체형/포즈 어깨 라인이 약간 좁아졌고 골반 비율 변화…    │
│ 의상      상의 색이 청 → 흑으로 변경 (의도와 일치하나 │
│           질감이 sleek → matte 으로 의도 외 변화)      │
│ 배경      커튼 패턴은 보존, 조명 색온도 약간 차가워짐  │
│ 의도      "earrings 추가" prompt 정확히 반영           │
│                                                          │
├─ 종합 ──────────────────────────────────────────────────┤
│ 의상 변경 의도는 잘 반영되었으나 체형 일관성이 다소     │
│ 약화됨. 얼굴 ID 와 배경은 잘 보존되어 전반적으로 양호…  │
└──────────────────────────────────────────────────────────┘
```

- 영/한 토글: vision 분석 페이지와 동일 패턴
- 막대 색상은 점수 임계 (≥80 녹, 50-79 노, <50 적) — 인라인 dot 와 동일 룰
- 모달 너비 ≈ 640px · 스크롤 가능

### 4.3 ImageLightbox 통합

기존 `ImageLightbox.tsx` 의 메타 패널 (340px) 안에 동일 `ComparisonAnalysisCard` 컴포넌트 재사용. 조건부 렌더:
- `item.mode === "edit"` 일 때만
- 카드 안 동작은 /edit 페이지와 100% 동일 (분석/자세히/재분석)
- "자세히" 클릭 시 모달이 lightbox 위에 z-index 한 단계 더 위로 띄움

## 5. 데이터 모델

### 5.1 TypeScript 타입 (`frontend/lib/api/types.ts`)

```ts
/** 비교 분석 5축 점수 (0-100 정수) */
export interface ComparisonScores {
  face_id: number;
  body_pose: number;
  attire: number;
  background: number;
  intent_fidelity: number;
}

/** 5축 각각의 영문/한국어 코멘트 (1-2 문장) */
export type ComparisonComments = {
  [K in keyof ComparisonScores]: string;
};

/** 비교 분석 단일 결과 — history item 에 영구 저장 */
export interface ComparisonAnalysis {
  scores: ComparisonScores;
  /** 5축 산술 평균 (0-100) */
  overall: number;
  comments_en: ComparisonComments;
  comments_ko: ComparisonComments;
  summary_en: string;
  summary_ko: string;
  provider: "ollama" | "fallback";
  fallback: boolean;
  /** 분석 시점 unix ms */
  analyzedAt: number;
  visionModel: string;
}

/** HistoryItem 확장 — 신규 두 필드 */
export interface HistoryItem {
  // ... 기존 필드 유지 ...
  /** /edit 의 원본 이미지 영구 경로 (예: /images/edit-source/{id}.png).
   *  /generate · /video 결과는 항상 undefined. 옛 row 도 undefined. */
  sourceRef?: string;
  /** 비교 분석 결과. 분석 안 한 경우 undefined. */
  comparisonAnalysis?: ComparisonAnalysis;
}
```

### 5.2 DB 마이그레이션 (`backend/studio/history_db.py`)

`studio_history` 테이블에 두 컬럼 추가:

```sql
ALTER TABLE studio_history ADD COLUMN source_ref TEXT;
ALTER TABLE studio_history ADD COLUMN comparison_analysis TEXT;  -- JSON serialize
```

마이그레이션 전략:
- `init_studio_history_db()` 가 idempotent: `PRAGMA table_info(studio_history)` 로 컬럼 존재 검사 후 없으면 ALTER
- 기존 row 들은 두 컬럼 NULL → UI 가 graceful 처리 (분석 불가 상태)
- `_row_to_item()` 가 두 컬럼 → camelCase 필드로 변환 (`source_ref` → `sourceRef`, `comparison_analysis` JSON parse → `comparisonAnalysis`)
- 신규 함수 `update_comparison(item_id, analysis_dict)` 추가

### 5.3 디스크 저장 — source 이미지

`/edit` 엔드포인트가 결과 저장 시 source 도 같이 저장:
- 경로: `${output_image_path}/edit-source/{history_item_id}.png`
- 형식: PNG (원본이 JPG 면 Pillow `Image.convert("RGB").save(path, "PNG")` 로 변환 — 무손실 보존)
- 크기: 평균 500KB-2MB · 사용자 의식 가능
- 정리: 향후 별도 cleanup job (현재 spec 외) — manual 삭제 가능
- 디스크 저장 실패 시: 결과 저장은 정상 진행, source_ref=NULL · warn 로그

## 6. 백엔드 API

### 6.1 신규 엔드포인트 — `POST /api/studio/compare-analyze`

**Request (multipart)**:
```
source: image file (또는 server ref path "/images/...")
result: image file (또는 server ref path)
meta: JSON {
  editPrompt: string,           // 사용자가 친 수정 지시
  historyItemId?: string,       // 있으면 분석 결과 DB 영구 저장
  visionModel?: string,         // 옵션 — 기본 settings.visionModel
  ollamaModel?: string          // 옵션 — 번역용, 기본 settings.ollamaModel
}
```

**Response**:
```json
{
  "analysis": ComparisonAnalysis,  // §5.1 타입
  "saved": true                    // historyItemId 있고 DB 갱신 성공 시 true
}
```

### 6.2 비전 모델 호출 — `studio/comparison_pipeline.py`

**SYSTEM_COMPARE 프롬프트 (영문 응답 강제 + JSON 강제)**:
```
You are a vision evaluator comparing TWO images of the same scene:
  SOURCE = original image (before user edit)
  RESULT = edited image (after user edit)

The user's edit instruction was: "{editPrompt}"

Evaluate identity preservation and intent fidelity on FIVE axes.
Score each axis 0-100 (integer):
  - face_id: identity preservation of person's face (eyes, nose, jaw,
    overall facial structure). 100 = identical, 0 = entirely different person.
  - body_pose: body shape, proportions, and pose preservation.
  - attire: clothing/nudity state vs the user's intent. 100 = exactly as
    requested, 0 = entirely opposite to request.
  - background: unintended background changes. 100 = background fully
    preserved, 0 = background completely different.
  - intent_fidelity: how faithfully the result follows the edit prompt.

Write a 1-2 sentence comment per axis (English).
Then write a 3-5 sentence overall summary (English).

Return STRICT JSON only (no markdown, no preamble):
{
  "scores": {
    "face_id": <int>,
    "body_pose": <int>,
    "attire": <int>,
    "background": <int>,
    "intent_fidelity": <int>
  },
  "comments": {
    "face_id": "<en>",
    "body_pose": "<en>",
    "attire": "<en>",
    "background": "<en>",
    "intent_fidelity": "<en>"
  },
  "summary": "<en, 3-5 sentences>"
}
```

**Multi-image input** — qwen2.5vl 의 Ollama API 가 `images: [b64_source, b64_result]` 배열 지원. 두 이미지 같이 전달 + system prompt + user message ("Source is image 1. Result is image 2.").

**한국어 번역 (gemma4-un · think:False)**:
- 5개 축 코멘트 + summary 를 한 번에 묶어 번역 요청 (효율적)
- 번역 실패 시 `comments_ko` = `comments_en` 그대로 (fallback) + `summary_ko` = "한글 번역 실패"

### 6.3 `POST /api/studio/edit` 변경

기존 multipart 응답에 source 영구 저장 추가:
1. multipart 로 들어온 source 파일을 `${output_image_path}/edit-source/{generated_id}.png` 로 저장
2. history_db 에 row insert 시 `source_ref` 컬럼에 경로 기입
3. 기존 결과 imageRef 저장 흐름은 변화 없음

frontend 의 `lib/api/edit.ts` 도 응답 → `sourceRef` 필드 채움.

## 7. 트리거 + VRAM 안전장치

### 7.1 수동 (default)

- `ComparisonAnalysisCard` 의 "분석" 버튼 클릭
- `useComparisonAnalysis` 훅이 호출 가드 (이미 진행 중이면 toast.warn + skip)
- 진행 중 표시: 인라인 카드가 Loading state
- **`comparisonBusy` 정의**: `useComparisonAnalysis` 훅 내부의 `analyzing: Set<string>` (item id 단위). 동일 item 중복 호출은 차단되지만 다른 item 동시 분석은 허용 (백엔드 mutex 가 직렬화)

### 7.2 자동 (설정 토글)

`useSettingsStore` 신규 토글: `autoCompareAnalysis: boolean` (기본 `false`).

- 설정 패널의 Lightning 토글 옆에 같이 표시 (한 줄: "수정 후 자동 비교 분석")
- `useEditPipeline` 의 `done` 핸들러 안:
  ```ts
  if (autoCompareAnalysis && !comparisonBusy) {
    void analyzeInBackground(item.id);
  }
  ```
- 토스트 알림 — 자동 분석 완료 시 "비교 분석 도착 · 자세히" 액션 토스트

### 7.3 안전장치

- **busy guard**: 분석 중인 동안 다음 /edit 수정이 시작되면 자동 분석 skip (warn 토스트). 수동 호출은 차단 + "이전 분석 완료 후 시도" 안내
- **VRAM 임계**: `useProcessStore.vram.usedGb` 가 13GB 초과 시 자동 분석 skip + 토스트 "VRAM 부족 · 수동 재분석 가능"
- **백엔드 mutex**: ComfyUI sampling 활성 중이면 compare-analyze 호출이 짧게 대기 (간단 asyncio.Lock). 30s 대기 후에도 안 풀리면 503 + fallback

## 8. 에러 처리

| 시나리오 | 처리 |
|---|---|
| qwen2.5vl 응답 없음 (Ollama 정지 등) | 503 + frontend 토스트 "비전 모델 응답 없음" + fallback 분석 (provider="fallback", scores 모두 N/A, summary="응답 없음") |
| qwen2.5vl 응답 JSON parse 실패 | fallback 동일 + summary="응답 파싱 실패" + 원문 일부 로그 |
| 5축 일부 점수 누락 | 누락 축은 `null` (UI 에서 dash `—` 표시) · `overall` 은 받은 점수만 평균 |
| gemma4-un 한글 번역 실패 | `comments_ko` = `comments_en` 그대로 + `summary_ko` = "한글 번역 실패" + 한국어 영역에 ⚠️ 배지 |
| timeout (30s 초과) | 503 + 토스트 "분석 시간 초과 · 재시도" + DB 저장 안 함 |
| historyItemId 없음 (UI 가 일회성 호출) | 분석은 정상 수행, `saved=false` 응답. UI 는 메모리에만 표시 |
| historyItemId 가 DB 에 없음 | 분석은 정상 수행, `saved=false` + warn 로그 |
| 동일 item 중복 분석 (race) | 백엔드 mutex 로 직렬화 · 마지막 결과로 덮어쓰기 |
| source 디스크 저장 실패 | /edit 응답은 정상 (결과는 살아있음) · source_ref=null · 비교 분석은 향후 비활성 |

## 9. 보안 / 규칙 준수 (CLAUDE.md)

- ComfyUI / Ollama 외부 호출 모두 `try/except` + `httpx.Timeout(30.0)` 명시
- gemma4-un 호출 시 `think: False` 강제 (기존 prompt_pipeline 패턴 그대로 재활용)
- 한글 주석 모든 신규 파일에 추가
- subprocess 사용 없음 (외부 API 만)
- 디자인 토큰 변경 없음 — 기존 `--ink`, `--surface`, `--accent`, `--green`/`--yellow`/`--red` 재사용
- path traversal 방지: `historyItemId` 는 `^tsk-[0-9a-f]{12}$` 정규식 검증 후 디스크 경로 구성
- CORS: 기존 미들웨어 그대로 (localhost 만)
- API 응답 schema 신뢰 X — frontend 가 `as` cast 대신 type guard 함수 사용 (codex 1차 리뷰 교훈 반영)

## 10. 검증 게이트

구현 완료 시:
- **백엔드**: `pytest tests/studio/` 통과 + 신규 `test_comparison_pipeline.py` (Mock vision client 로 5축 점수/JSON 파싱/fallback 검증)
- **프론트**: `tsc --noEmit` exit 0 · 신규 코드 lint clean
- **수동 QA**:
  1. /edit 으로 인물 수정 1장 → "분석" 클릭 → 인라인 카드 채워짐 → 모달 5축 표시
  2. 페이지 떠난 뒤 history 그리드 다시 클릭 → 분석 결과 그대로 다시 보임
  3. ImageLightbox 에서 같은 item 열기 → 메타 패널에 동일 분석 보임
  4. 설정 자동 토글 ON → 새 수정 → 백그라운드 도착 토스트 + 카드 채워짐
  5. Ollama 정지 후 분석 시도 → fallback 응답 정상 표시
  6. 옛날 row (source_ref NULL) 클릭 → "분석 불가" 안내 정상

## 11. 구현 단계 (Implementation Plan 으로 분리)

이 spec 승인 후 별도 implementation plan 문서로 분리:
1. DB 마이그레이션 + history_db schema 확장
2. /edit 엔드포인트 source 영구 저장
3. compare-analyze 백엔드 엔드포인트 + comparison_pipeline
4. 프론트 타입 + lib/api/compare.ts
5. ComparisonAnalysisCard 컴포넌트
6. ComparisonAnalysisModal 컴포넌트
7. /edit 페이지 통합 + ImageLightbox 메타 패널 통합
8. 설정 자동 토글 + useComparisonAnalysis 훅
9. 검증 게이트 통과 + 수동 QA

## 12. 향후 확장 (Out of Scope · 기록만)

- gemma4-un (think 모드) → 분석 결과 → "이 차이 줄이려면 prompt 보완" 자동 제안 + 원클릭 재수정
- /video 결과 vs source 이미지 비교 (frame extract + multi-image)
- 가중치 커스터마이징 (5축 비중 사용자 설정)
- 일괄 분석 + 통계 대시보드 ("이 LoRA 조합의 평균 face_id 점수")
- /generate 모드 다중 seed 결과 비교 (same prompt, different seeds)
- 분석 결과 export (CSV / JSON 다운로드)
- 점수 임계 사용자 커스터마이징 (현재 ≥80/50-79/<50 고정)
