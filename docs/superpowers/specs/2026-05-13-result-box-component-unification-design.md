# AI Image Studio · Result Box Component Unification · Design Spec

작성일: 2026-05-13
저자: Claude (Opus 4.7) + Park1981 (londonboy.pzen@gmail.com)
상태: Draft (사용자 검토 대기)

---

## 1. 배경 & 동기

4 모드 (Generate / Edit / Video / Vision) 의 결과 박스가 **4 개 분리 컴포넌트** 로 구현되어 있다:

- `frontend/components/studio/generate/GenerateResultViewer.tsx` (238 라인)
- `frontend/components/studio/edit/EditResultViewer.tsx` (240 라인)
- `frontend/components/studio/VideoPlayerCard.tsx` (151 라인)
- `frontend/components/studio/VisionResultCard.tsx` (74 라인)

진행 중 결과 박스 동작이 **두 갈래로 갈림**:

| 모드 | 진행 중 동작 | 박스 안 표시 |
|------|----------|------------|
| Generate / Edit | 이전 결과 (옛 이미지 / 슬라이더) 유지 | caption (`.ais-result-caption`) + 메타 pill |
| Video / Vision | `StudioLoadingState` 로 박스 전체 대체 | "영상 생성 중..." / "분석 중..." 텍스트 + Spinner |

git history 검증 결과 — 이 두 갈래는 **명시적 UX 결정이 아니라 패턴 표류** (§9.1 함정 박제 참조). 결과 박스에서 진행 정보를 빼고 시각 효과만 남기려면 4 곳 손봐야 하고, 향후 효과 spec (별도) 의 변경 영역도 4 배가 된다.

이번 spec 은 **단일 진실의 출처 `<ResultBox>` base 도입 + 진행 중 정보 제거 + 페이드 전환 + ProgressModal X 비활성화** 까지를 통일 작업으로 묶고, 효과의 시각 디자인은 다음 spec 에서 다룬다.

## 2. 목표 (Goals)

1. 4 모드 결과 박스의 외곽 / 상태 분기 / 효과 slot 을 단일 `<ResultBox>` base 로 통일
2. 진행 시작 시 결과 박스 안의 진행 정보 (caption · pill · loading 텍스트) 제거
3. Generate / Edit 의 옛 이미지 0.4s 페이드 아웃 → 빈 캔버스 (효과 자리) 로 전환
4. 진행 중 ProgressModal X 비활성화 (정보 손실 방지)
5. 다음 효과 spec 의 작업 표면 최소화 — `effectOverlay` slot 한 곳만 채우면 4 모드 자동 적용

## 3. Non-goals

- **효과의 시각 디자인** (noise / scan / particle / iridescent 모티프 등) 은 이번 spec 밖 — 다음 effect spec 에서 결정
- Compare (`/vision/compare`) 페이지는 이번 범위 밖 (4 모드만 통일 · Compare 는 이미 다른 패턴)
- 4 본문 컴포넌트의 내부 로직 (Edit `sourceRef` 매칭 · Generate `zoom/pan` · Vision Recipe v2 mapping) 은 손대지 않음
- caption / pill 의 완료 후 표시는 *현행 유지* (진행 중 노출만 제거)

## 4. Architecture

```
┌─ /generate ─┐  ┌─ /edit ─┐  ┌─ /video ─┐  ┌─ /vision ─┐
│   page.tsx  │  │ page.tsx│  │ page.tsx │  │ page.tsx  │
└──────┬──────┘  └────┬────┘  └────┬─────┘  └─────┬─────┘
       └──────────┬───┴───────────┴──────────────┘
                  ↓ 모두 동일 base 사용
       ┌─── <ResultBox> (신규 base · ~80 라인) ────┐
       │   외곽 .ais-result-hero{-plain}{-edit}    │
       │   상태 분기 (idle / loading / done)       │
       │   AnimatePresence 0.4s cross-fade        │
       │   effectOverlay slot (다음 spec 채움)     │
       └──────────────────┬───────────────────────┘
                          ↓ children 으로 주입
            ┌──────┬──────┬──────┬───────┐
            │  GC  │  EC  │  VC  │  VsC  │
            └──────┴──────┴──────┴───────┘
      (GenerateContent / EditContent / VideoContent / VisionContent)
```

### 파일 위치

- **신규**: `frontend/components/studio/ResultBox.tsx`
- **Rename only** (위치 그대로 · git history 보존):
  - `studio/generate/GenerateResultViewer.tsx` → `studio/generate/GenerateContent.tsx`
  - `studio/edit/EditResultViewer.tsx` → `studio/edit/EditContent.tsx`
  - `studio/VideoPlayerCard.tsx` → `studio/VideoContent.tsx`
  - `studio/VisionResultCard.tsx` → `studio/VisionContent.tsx`
- **CSS 무변경**: `.ais-result-hero{,-plain,-edit,-img}` (2026-05-04 통일 작업 결과 그대로)

## 5. Components

### 5.1 `<ResultBox>` API

```tsx
interface ResultBoxProps {
  state: "idle" | "loading" | "done";
  variant?: "hero" | "plain";           // default "hero" · Vision 만 "plain"
  modifier?: "edit";                    // .ais-result-hero-edit 호환 (Edit/Video)
  effectOverlay?: ReactNode;            // 이번 spec 에서는 사용 X (slot 만 박제)
  emptyState?: ReactNode;               // default <StudioEmptyState />
  loadingPlaceholder?: ReactNode;       // default 빈 div (효과 자리)
  children?: ReactNode;                 // state=done 일 때 렌더
}
```

**책임**:
- 외곽 `.ais-result-hero{-plain}{-edit}` 클래스 + dot-grid 매트 유지
- state 분기 (idle → emptyState · loading → loadingPlaceholder + effectOverlay · done → children)
- `done ↔ loading` 전환 시 framer-motion `AnimatePresence` 로 0.4s cross-fade

### 5.2 4 본문 컴포넌트 (Rename only)

| Rename 후 | 기존 라인 | 책임 |
|---------|---------|------|
| `GenerateContent` | 238 → ~190 (외곽 분리 후) | `<img>` + zoom/pan + hover action bar |
| `EditContent` | 240 → ~200 | BeforeAfter slider / SideBy + viewer mode 토글 + sourceRef 매칭 |
| `VideoContent` | 151 → ~120 | `<video>` player + 메타 + action bar |
| `VisionContent` | 74 → ~50 | `RecipeV2View` / `LegacyV1View` 분기 |

본문은 *done 상태 일 때만 렌더* — 외곽 / empty / loading 책임은 ResultBox 로 이관.

### 5.3 ProgressModal X 비활성화

```tsx
// frontend/components/studio/ProgressModal.tsx (5 줄 미만 변경)
<button
  onClick={onClose}
  disabled={running}                              // 추가
  title={running ? "진행 중에는 닫을 수 없습니다" : "모달 닫기"}
  style={{
    opacity: running ? 0.4 : 1,
    cursor: running ? "not-allowed" : "pointer",
  }}
>×</button>
```

`running` prop 은 페이지에서 store flag 그대로 전달 (4 모드 공용 단일 변경).

## 6. Data Flow

### 6.1 State 매핑 (페이지 책임)

| 모드 | `idle` | `loading` | `done` | 핵심 store field |
|------|--------|-----------|--------|----------------|
| Generate | `!generating && !selectedItem` | `generating` | `!generating && selectedItem` | `useGenerateStore.generating` |
| Edit | `!running && !pairMatched` | `running` | `!running && pairMatched` | `useEditStore.running` |
| Video | `!running && !lastVideoRef` | `running` | `!running && lastVideoRef` | `useVideoStore.running` |
| Vision | `!running && !lastResult` | `running` | `!running && lastResult` | `useVisionStore.running` |

### 6.2 페이드 전환 (ResultBox 내부)

```tsx
<AnimatePresence mode="sync">
  {state === "done" && (
    <motion.div key="done"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
      {children}
    </motion.div>
  )}
  {state === "loading" && (
    <motion.div key="loading"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
      {loadingPlaceholder}
      {effectOverlay}
    </motion.div>
  )}
  {state === "idle" && (
    <motion.div key="idle">{emptyState}</motion.div>
  )}
</AnimatePresence>
```

`mode="sync"` 가 cross-fade (둘 다 동시 0.4s). done ↔ loading / idle ↔ done 모두 자연 페이드.

### 6.3 Caption / Pill / Loading 텍스트 처리

- **진행 중**: 페이지에서 `state === "done"` 일 때만 caption / pill 렌더 → 진행 중 박스 안 정보 0
- **완료 후**: 현행 유지 (caption + pill + hover action bar 그대로)
- **`StudioLoadingState` 텍스트** ("영상 생성 중..." / "분석 중...") 는 ResultBox 의 default `loadingPlaceholder` (빈 div) 로 대체 — 효과는 다음 spec

### 6.4 전체 시퀀스 (Generate 예시)

```
[생성] 클릭
  ↓
store.generating = true
  ↓
page: state = "loading" 계산
  ↓
ResultBox AnimatePresence
  ├─ children (옛 이미지) 0.4s opacity 0 페이드 아웃
  └─ loadingPlaceholder (빈 div) 0.4s opacity 1 페이드 인
  ↓
ProgressModal: running=true → 자동 펼침 + X disabled
  ↓
SSE stages → modal timeline 업데이트
  ↓
완료 → store.generating=false + selectedItem 갱신
  ↓
page: state = "done" 계산
  ↓
ResultBox AnimatePresence (loadingPlaceholder 페이드 아웃 + 새 children 페이드 인)
  ↓
ProgressModal: 모드별 delay (1000~1400ms · Vision 1000 · Generate 기본값 · Video 1400) 후 자동 닫힘 + X 활성화 복원
```

## 7. Migration (Phase 별)

| Phase | 작업 | 변경 파일 | 검증 |
|-------|------|---------|------|
| **0** | `<ResultBox>` base + AnimatePresence 패턴 신설 | `studio/ResultBox.tsx` (신규) | vitest 단위 5 |
| **1** | Vision 마이그레이션 (가장 단순 · 74줄) | `VisionResultCard` → `VisionContent` + `vision/page.tsx` | vitest +3 ~ +5 |
| **2** | Video 마이그레이션 (151줄) | `VideoPlayerCard` → `VideoContent` + `video/page.tsx` | vitest +3 ~ +5 |
| **3** | Generate 마이그레이션 (238줄 · zoom/pan 보존) | `GenerateResultViewer` → `GenerateContent` + `generate/page.tsx` | vitest +3 ~ +5 |
| **4** | Edit 마이그레이션 (240줄 · BeforeAfter + sourceRef · 가장 복잡) | `EditResultViewer` → `EditContent` + `edit/page.tsx` | vitest +3 ~ +5 |
| **5** | ProgressModal X 비활성화 (5 모드 공용 단일 변경) | `studio/ProgressModal.tsx` | vitest +2 |
| **6** | 시각 회귀 검증 (chrome MCP 12 컷) | — | 4 페이지 × 3 상태 스크린샷 |
| **7** | Codex 교차 리뷰 (종료 조건: finding < 10 = 패스) | (없거나 미세) | — |
| **8** | `--no-ff` master merge | — | pytest 회귀 0 |

**순서 결정 근거**: 복잡도 ↑ 순 (Vision → Video → Generate → Edit). base 안정화 후 가장 까다로운 Edit 마지막. 각 Phase 마다 회귀 검증 끝나야 다음 진입.

## 8. Testing

### 8.1 vitest 신규 (목표 +15 ~ +20)

```
ResultBox 단위 (5):
  - state="idle" → emptyState 렌더
  - state="loading" → loadingPlaceholder + effectOverlay 렌더
  - state="done" → children 렌더
  - done → loading 전환 → exit transition 발동 (opacity 0)
  - effectOverlay prop 전달 시 loading 안에 같이 렌더

페이지 통합 (4 모드 × 3):
  - store flag 변경 → ResultBox state prop 변경
  - caption/pill 은 state="done" 일 때만 노출 확인
  - 4 본문 컴포넌트 기존 RTL 회귀 0

ProgressModal (2):
  - running=true → X 버튼 disabled
  - running=false → X 활성화 복원
```

### 8.2 자동 검증 (모든 Phase)

- `npx tsc --noEmit` → 0 error
- `npm run lint` → 0 error (pre-existing 제외)
- `npm test` → 회귀 0 (기존 298 + 신규 ~17)
- 백엔드 무변경 → pytest 534 PASS 유지

### 8.3 시각 회귀 (Phase 6 · Chrome MCP)

`/generate` `/edit` `/video` `/vision` × `idle` / `loading` / `done` = **12 컷**.

특히 검증할 항목:
- 4 페이지 결과 박스 외곽 일관성 (`.ais-result-hero` 클래스 동일 적용)
- Generate / Edit 의 done → loading 전환 시 페이드 자연스러움
- Edit BeforeAfter 슬라이더 정합 (`compareX 50 자동 리셋` 기존 동작 보존)
- Vision 의 `.ais-result-hero-plain` variant 가 다른 모드와 의도된 차이 유지

### 8.4 Codex 교차 리뷰 (Phase 7)

`codex:codex-rescue` 위임 — 회귀 risk / dead code grep / AnimatePresence key 정확성 / store flag → state 매핑 race condition.

**종료 조건**:
- finding < 10 → fix 패스 (다음 Phase 진행)
- finding ≥ 10 → 통합 단일 commit 으로 fix 후 재검증
- severity 무관 (high/medium/low 모두 count) — 단 *security/critical bug* 1 건이라도 예외 fix

(자세한 정책: feedback memory `codex-review-threshold`)

## 9. 함정 박제 (Pitfalls)

| # | 함정 | 대응 |
|---|------|------|
| **1** | Generate/Edit 의 "진행 중 이전 결과 유지" 는 *명시적 UX 결정이 아니라 패턴 표류* — git history 검증 commit: `cc5c856` (공통 shell 신설 · Video/Vision 만 적용) · `e14e27d` (Generate 분해 시 shell 누락) · `ac1b7db` ("Generate 패턴 복제" 명시 — Edit 가 표류 그대로 복사) | 통일 시 옛 동작 무작정 보존하지 말고 깔끔하게 정리 (옛 결과 페이드 아웃 후 빈 캔버스) |
| **2** | Edit 의 `compareX 50 자동 리셋` 미세 동작 보존 필수 | Phase 4 마이그레이션 시 기존 `__tests__/edit-*` 테스트 회귀 0 검증 |
| **3** | AnimatePresence `mode="sync"` 가 cross-fade · `mode="wait"` 는 순차 (사용 안 함) | ResultBox 구현 시 mode 정확성 vitest 로 검증 |
| **4** | framer-motion 의 `exit` transition 은 컴포넌트 unmount 시 발동 — children 의 conditional 렌더링 필요 | `state === "done" && children` 형태로 작성 (단순 `children` 직접 렌더 X) |
| **5** | Generate `zoom/pan` 의 hover state ref 가 본문 컴포넌트 내부 — 외곽 분리 시 영향 없는지 확인 | Phase 3 vitest 회귀 + chrome MCP 시각 검증 |
| **6** | Vision 의 `.ais-result-hero-plain` variant 는 다른 모드와 매트 패턴 다름 (dot-grid 없음) | `<ResultBox variant="plain">` prop 정확 전달 |
| **7** | ProgressModal 은 5 모드 공용 — Compare 페이지에도 영향 (이번 spec 범위 외지만 변경은 옴) | Phase 5 시 Compare 페이지도 시각 검증 (12 컷 외 추가 1 컷) |

## 10. Open Questions

없음 — 모든 결정 brainstorming 5 라운드 (scope · base 패턴 · 진행 중 박스 상태 · 모달 닫기 · 회귀 검증) 에서 박제 완료.

## 11. 참고

- `cc5c856` (2026-04-24) 공통 shell `StudioLoadingState` 신설 commit
- `fa3cb6d` (2026-05-04) 결과 카드 className 통일 작업 (`.ais-result-hero` / `-plain` 표준)
- `ac1b7db` (2026-04-26) "Generate 패턴 복제" 명시 commit (Edit 분해)
- feedback memory: `codex-review-threshold` (finding < 10 패스 정책)
- Visual companion mockups (이번 brainstorming 세션):
  - `.superpowers/brainstorm/1937-1778682146/content/loading-state.html` (진행 중 박스 상태 3 후보)
  - `.superpowers/brainstorm/1937-1778682146/content/architecture.html` (전체 구조 다이어그램)

---

이 spec 의 implementation plan 은 `docs/superpowers/plans/2026-05-13-result-box-component-unification.md` 에 별도 작성 예정 (`superpowers:writing-plans` skill 호출 시).
