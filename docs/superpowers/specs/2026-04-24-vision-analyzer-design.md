# Vision Analyzer — 이미지 분석 보조 기능 설계 (Spec)

**작성일**: 2026-04-24
**상태**: 기획 완료 · 구현 예정
**작성자**: Opus 4.7 (사용자 공동 기획)
**세션 참고**: 재설계 완료 이후 (`master` HEAD `bdfb4ca`) 기반 기능 추가

## 1. 배경 & 목적

AI Image Studio 는 Generate · Edit · (Video: 미구현) 3 모드를 제공한다. 사용자는 영상 모드 실구현을 기다리고 있지만 (오픈소스 모델 준비 미흡), 그 빈자리를 활용해 **보조 기능**으로 "Vision 분석" 단독 기능을 추가한다.

### 유스케이스
- 참고 이미지(레퍼런스)를 업로드 → 프롬프트 엔지니어링용 상세 설명을 영문으로 받기
- 영/한 2종 결과 각각 복사 → 사용자가 원하는 곳(Generate 프롬프트 필드 등)에 수동으로 붙여넣기
- 최근 분석 기록을 로컬에 남겨 빠르게 재조회

### 비목표 (YAGNI)
- 여러 장 일괄 분석 (배치)
- Generate 로 자동 라우팅 / gemma4 업그레이드 체이닝
- 서버 DB 히스토리 (로컬 localStorage 만)
- 분석 어조 토글 UI (단일 상세 어조 고정)

## 2. 결정 사항 요약

| 항목 | 결정 |
|------|------|
| 페이지 | `/vision` 신설 · 메인 메뉴 4카드 (`/video` 는 coming-soon 비활성) |
| 분석 결과 | 영문 + 한글 번역 2종, 탭 + 복사 버튼 |
| 히스토리 | 프론트 localStorage (Zustand persist · 최대 20건) |
| 생성 연동 | 단순 복사만. 자동 라우팅 없음 |
| 이미지 수 | 1장씩 |
| 분석 어조 | "프롬프트 엔지니어" — 40-120 단어 상세 묘사 |
| 비전 모델 | `Settings.visionModel` 재사용 (기본 `qwen2.5vl:7b`) |
| 번역 모델 | `Settings.ollamaModel` 재사용 (기본 `gemma4-un:latest`) |

## 3. 아키텍처

### 3.1 서버-클라이언트 구조

```
┌─────────── Frontend ───────────┐   ┌──────────── Backend ────────────┐
│  app/page.tsx   (메뉴 4카드)   │──▶│  studio/router.py               │
│  app/vision/page.tsx  (신규)   │   │  POST /api/studio/vision-analyze│
│                                │   │                                  │
│  hooks/useVisionPipeline (신)  │   │  studio/vision_pipeline.py      │
│  stores/useVisionStore   (신)  │   │   ├ SYSTEM_VISION_DETAILED (신) │
│  lib/api/vision.ts       (신)  │   │   ├ analyze_image_detailed (신) │
│  components/studio/            │   │   └ _describe_image (기존 재활용)│
│    VisionResultCard    (신)    │   │                                  │
│    VisionHistoryList   (신)    │   │  prompt_pipeline.py             │
│                                │   │   └ translate_to_korean (기존)  │
└────────────────────────────────┘   └──────────────────────────────────┘
```

### 3.2 재사용 자산 (건드리지 않음)
- `components/studio/SourceImageCard` · `components/chrome/VramBadge`
- `components/chrome/{Logo,TopBar,BackBtn,ModelBadge}`
- `stores/useSettingsStore` (`visionModel`, `ollamaModel`)
- `stores/useProcessStore` (`ollama` 상태)
- `stores/useToastStore`
- `backend/studio/vision_pipeline._describe_image`
- `backend/studio/prompt_pipeline.translate_to_korean`

## 4. 백엔드 설계

### 4.1 `backend/studio/vision_pipeline.py` 확장

**신규 상수**
```python
SYSTEM_VISION_DETAILED = """You are a prompt engineer analyzing an image for
reuse in a text-to-image generation prompt.

Output a single English paragraph of 40-120 words that captures:
subject, composition, lighting, mood, color palette, materials/textures,
camera/lens feel, film/style anchors, environment. Omit safety preambles.
No bullets, no markdown. Return ONLY the paragraph."""
```

**신규 데이터클래스**
```python
@dataclass
class VisionAnalysisResult:
    en: str           # 빈 문자열이면 fallback
    ko: str | None    # 번역 실패 시 None
    provider: str     # "ollama" | "fallback"
    fallback: bool    # True 면 비전 호출 자체 실패 (en="")
```

**신규 함수**
```python
async def analyze_image_detailed(
    image_bytes: bytes,
    *,
    vision_model: str = DEFAULT_OLLAMA_ROLES.vision,
    text_model: str = DEFAULT_OLLAMA_ROLES.text,
    ollama_url: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> VisionAnalysisResult:
    """1) 상세 system prompt 로 vision 모델 호출 → en
       2) translate_to_korean(en) → ko (선택적 실패)
       3) 실패 시 fallback=True, en=""
    """
```

내부는 기존 `_describe_image` 구현을 일반화 (system prompt 를 파라미터화) 하거나 별도로 `_call_vision_ollama` 헬퍼를 추출. 재사용 최대화.

### 4.2 `backend/studio/router.py` 확장

```python
@router.post("/vision-analyze")
async def vision_analyze(
    image: UploadFile = File(...),
    meta: str = Form("{}"),
) -> dict:
    """단일 이미지 → 상세 영문 설명 + 한글 번역 (동기 JSON)."""
    # 1) meta JSON 파싱 — { visionModel?, ollamaModel? }
    # 2) image.read() → bytes
    # 3) 20MB 초과 검증 (HTTPException 413)
    # 4) PIL.Image 로 (w, h) 추출 (실패 무시, 0 반환)
    # 5) analyze_image_detailed(...) 호출
    # 6) return { en, ko, provider, fallback, width, height, sizeBytes }
```

**에러 원칙**: Ollama 호출 실패여도 HTTP 200 + fallback=True 로 반환. 프론트가 fallback 체크해서 토스트.

### 4.3 테스트

`backend/tests/studio/test_vision_pipeline.py` 신설:
- `SYSTEM_VISION_DETAILED` 상수 존재 + 40-120 단어 가이드 포함
- `analyze_image_detailed` 가 vision 실패 시 `fallback=True, en=""` 반환
- `analyze_image_detailed` 가 번역 실패 시 `ko=None` but en 보존

`httpx_mock` 또는 `httpx.MockTransport` 로 Ollama 응답 주입.

## 5. 프론트엔드 설계

### 5.1 타입 (`lib/api/types.ts` 확장)

```typescript
export interface VisionAnalysisResponse {
  en: string;
  ko: string | null;
  provider: "ollama" | "fallback";
  fallback: boolean;
  width: number;
  height: number;
  sizeBytes: number;
}
```

### 5.2 API (`lib/api/vision.ts` 신규)

```typescript
export async function analyzeImage(
  sourceImage: string | File,
  opts: { visionModel?: string; ollamaModel?: string } = {},
): Promise<VisionAnalysisResponse>;
```

- USE_MOCK: 800ms 지연 후 가짜 영/한 응답
- Real: multipart POST → JSON 수신. `sourceImage` 가 string (dataURL/url) 이면 fetch→blob 변환. File 이면 그대로 append.

### 5.3 스토어 (`stores/useVisionStore.ts` 신규)

```typescript
export interface VisionEntry {
  id: string;               // `vis-${Date.now().toString(36)}`
  imageRef: string;         // dataURL (localStorage 직저장)
  thumbLabel: string;       // "파일명.png · 1024×768"
  en: string;
  ko: string | null;
  createdAt: number;
  visionModel: string;
}

interface VisionState {
  // 세션 한정
  currentImage: string | null;
  currentLabel: string;
  currentWidth: number | null;
  currentHeight: number | null;
  running: boolean;
  lastResult: { en: string; ko: string | null } | null;

  // persist
  entries: VisionEntry[];

  // actions
  setSource(image: string|null, label?, w?, h?): void;
  setRunning(v: boolean): void;
  setResult(en: string, ko: string|null): void;
  addEntry(e: VisionEntry): void;
  removeEntry(id: string): void;
  clearEntries(): void;
  loadEntry(id: string): void;   // entry 선택 시 currentImage + lastResult 복원
}
```

**persist 설정**: `{ name: "ais:vision", version: 1, partialize: s => ({ entries: s.entries }) }`. MAX=20 은 `addEntry` 내부에서 `slice(0, 20)`.

### 5.4 훅 (`hooks/useVisionPipeline.ts` 신규)

```typescript
export function useVisionPipeline() {
  // useVisionStore + useSettingsStore + useProcessStore + toast 구독
  return { analyze, analyzing };
  // analyze(): 조건 체크 → analyzeImage() 호출 → setResult + addEntry + 토스트
}
```

### 5.5 컴포넌트

**`components/studio/VisionResultCard.tsx`**
- props: `result: { en, ko } | null`, `running: boolean`
- 세그먼트 탭 (영문/한글) + 각 탭에 복사 버튼 + 카드 레이아웃
- Empty state: "이미지 업로드 후 [분석] 버튼을 눌러봐"
- Loading state: Spinner + "분석 중…"

**`components/studio/VisionHistoryList.tsx`**
- props: `entries: VisionEntry[]`, `onSelect(id)`, `onDelete(id)`, `onClear()`
- 3-col 그리드. 각 카드: 썸네일 + 날짜 + 영문 요약 50자 + × 삭제 버튼
- 빈 상태: "아직 분석 기록이 없어"
- 상단 우측 "모두 지우기" 버튼 (entries.length > 0 일 때)

### 5.6 페이지 (`app/vision/page.tsx` 신규)

레이아웃은 Generate/Edit 와 동일 방식. 좌 400px / 우 1fr.

**좌 패널**
- TopBar (BackBtn, Logo, ModelBadge — qwen2.5vl:7b 상태), VramBadge, SettingsButton
- `<SourceImageCard>` (재활용)
- `[분석]` primary 버튼 — sticky bottom. `running` 상태에서는 Spinner + "분석 중…"

**우 패널**
- `<VisionResultCard>`
- `<VisionHistoryList>`

### 5.7 메뉴 수정 (`app/page.tsx`)

카드 4개로 확장:
- 생성 (기존)
- 수정 (기존)
- **Vision 분석** (신규, 활성)
- 영상 (기존, `disabled` + "coming soon" 배지 유지)

## 6. 구현 순서 (커밋 단위)

1. **C1**: Spec 문서 작성 + 커밋 (이 문서)
2. **C2**: 백엔드 — `vision_pipeline.py` + `router.py` + test. pytest 통과
3. **C3**: 프론트 타입/스토어/API — `lib/api/types.ts` + `lib/api/vision.ts` + `lib/api-client.ts` barrel + `stores/useVisionStore.ts`. tsc 통과
4. **C4**: 프론트 컴포넌트/훅 — `hooks/useVisionPipeline.ts` + `VisionResultCard.tsx` + `VisionHistoryList.tsx`. tsc 통과
5. **C5**: 프론트 페이지 + 메뉴 — `app/vision/page.tsx` + `app/page.tsx` 수정. Next build 통과
6. **master merge** (사용자 승인 후)

## 7. 에러 처리 매트릭스

| 시나리오 | 감지 | 동작 |
|---------|------|------|
| 이미지 파일 아님 | `SourceImageCard.handleFiles` | `toast.error` |
| 20MB 초과 | 백엔드 router | HTTP 413 → 프론트 토스트 |
| Ollama 정지 | 프론트 `analyze()` 시작 시 | 경고 토스트, 계속 진행 |
| Vision 호출 실패 | `analyze_image_detailed` 내부 | fallback=True, en="" 반환. HTTP 200 유지 |
| 번역 실패 | `translate_to_korean=None` | en 살리고 ko 탭만 "번역 실패" |
| 네트워크 실패 | 프론트 fetch | try/catch → `toast.error`, running 해제 |
| localStorage 초과 | `addEntry` | MAX=20 에서 자동 drop (선제 방지) |

## 8. 검증 체크리스트

- [ ] `pytest backend/tests/studio/` 전부 통과 (기존 19건 + 신규 3+ 건)
- [ ] `npx tsc --noEmit` 통과
- [ ] `npm run build` 통과
- [ ] `app/page.tsx` 메뉴 4카드 렌더, 영상 disabled
- [ ] `/vision` 페이지 접근 시 런타임 에러 없음 (Mock 모드 기준)
- [ ] 이미지 업로드 → 분석 → 영/한 결과 수신 → 히스토리 persist (수동, 백엔드 구동 시)

## 9. 향후 확장 여지 (이번 범위 밖)

- 분석 어조 토글 (간결/상세/구조화 JSON)
- 여러 장 배치 분석
- "Generate 로 바로 보내기" 버튼 (현재는 복사만)
- 서버 DB 히스토리 이관 (localStorage → `studio_history` mode="vision")
- 다국어 확장 (중/일 번역)
- OCR 모드 (이미지 내 글자 추출)
