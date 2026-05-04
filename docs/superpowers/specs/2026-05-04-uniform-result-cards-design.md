# 5 페이지 우패널 결과 카드 통일 설계 spec

**작성일**: 2026-05-04
**대상**: `frontend/` (`/generate`, `/edit`, `/video`, `/vision`, `/vision/compare`)
**브랜치 (예정)**: `feature/uniform-result-cards`
**전제 조건**: master HEAD `c48b435` 또는 그 이후 (vision subLabel 동적화 + 영상 갤러리 라벨 redesign 완료 시점)
**검증 기준선**: pytest 474 / vitest 216 / tsc clean / ESLint clean

---

## 1. Context — 왜 이 변경이 필요한가

5 페이지가 동일한 `StudioPage / StudioWorkspace (400px + 1fr) / StudioLeftPanel / StudioRightPanel` shell + 동일한 `StudioModeHeader` + 동일한 `StudioResultHeader` 를 쓰지만, **우패널 결과 본문 카드**의 외관 구현이 4 갈래로 분산되어 있어 시각/구조 일관성이 깨져 있다.

### 1.1 현황 매트릭스 (master `c48b435` 기준)

| 페이지 | 결과 카드 외관 | 구현 방식 |
|--------|---------------|----------|
| Generate | 매트 카드 (dot-grid + shadow + aspect-ratio 1672/941) | className `.ais-result-hero` |
| Edit | 매트 카드 (dot-grid + shadow + aspect-ratio:auto + padding 24) | className `.ais-result-hero` + `.ais-result-hero-edit` |
| Video | 매트 카드 (dot-grid + shadow + padding 24) | **inline style** (Generate/Edit 통일 의도이지만 className 미전환) |
| Vision | **외곽 박스 없음** — 컨텐츠 직접 노출 | (없음) |
| Compare ① viewer | inline 박스 (padding 14) — **inner wrapper width 미지정 → 좁게 렌더링** | inline style |
| Compare ② analysis panel | plain 카드 (surface + border + padding 16) | className `.ais-compare-analysis-card` |

### 1.2 발생 문제

1. **Compare 우패널이 다른 페이지보다 좁게 보임** (사용자 시각 발견 · 2026-05-04). 원인: `CompareViewer` 의 `SliderViewer` / `SideBySideViewer` 안 inner wrapper 가 width 미지정으로 flex 부모 안에서 content 사이즈 (≈0) 로 수축 → `BeforeAfterSlider` 의 `width:100%` 가 부모 0 의 100% 이라 좁아짐.
2. **시각 일관성 부재**: Vision 만 외곽 박스 없음 / Compare 만 padding 14 / Video 와 Compare 만 inline (Generate/Edit 의 표준 className 미전환).
3. **미래 디자인 변경 비용**: 결과 카드 톤을 한 번 바꾸려면 4 곳 (Generate hero / Edit hero / Video inline / Compare inline) 을 손대야 함.

### 1.3 비목표 (YAGNI)

- Caption (`.ais-result-caption`) / HistorySectionHeader / HistoryGallery 통일 — **이미 통일** (master `136accd` 등)
- Compare 휘발 정책 → DB 저장 전환 — 사용자 결정 "내용차이라 어쩔수 없긴" (Compare 우패널에 history 섹션 부재 유지)
- 백엔드 변경 — 순수 frontend (CSS + className)
- HistoryItem schema 추가 (duration / individual size) — 사용자 결정 "굳이 안 함"
- 시안 (pair-*.html / cards-v2.html) lookup — 메모리 정리 완료 (2026-05-04 · 적용 끝났으니 헷갈림 방지)
- StudioModeHeader / StudioResultHeader / 좌패널 통일 — 이미 통일됨

---

## 2. 사용자 확정 결정 사항 (2026-05-04)

| # | 항목 | 결정 |
|---|------|------|
| 1 | Vision 결과 카드 | **Plain 카드** 신규 (외곽 박스 O · dot-grid X) |
| 2 | 표준 분기 | **두 갈래** — 매트 (이미지/영상) / Plain (텍스트) |
| 3 | 매트 className | **`.ais-result-hero`** (현행 유지 · 패밀리 base) |
| 4 | Plain className | **`.ais-result-hero-plain`** (NEW · 패밀리 확장 · `.ais-result-hero` 와 분리) |
| 5 | Compare viewer | **매트** — Edit 패턴 (`.ais-result-hero` + `.ais-result-hero-edit`) 재사용 |
| 6 | Compare analysis panel | **Plain 으로 흡수** — `.ais-compare-analysis-card` → `.ais-result-hero-plain` 통합 |
| 7 | Video player card | **매트** — Filled 분기만 className 전환 (Mock/Empty 는 StudioEmptyState 그대로) |
| 8 | Compare history | 추가 안 함 (휘발 정책 유지) |
| 9 | 머지 전략 | 옵션 A — 브랜치 안 phase 단위 commit + 100% 후 master 1번 merge |
| 10 | 검증 | 자동 (vitest/tsc/lint) + 사용자 시각 (5 페이지 dev server) + Codex iterative review |

---

## 3. 표준 두 갈래 정의

### 3.1 매트 카드 — `.ais-result-hero` (base)

이미지/영상 결과를 매트 사진 갤러리 톤으로 감싸는 외곽 박스. **현행 정의 유지** (수정 없음).

**현재 정의** (`globals.css:1303-1321`):
```css
.ais-result-hero {
  position: relative;
  width: 100%;
  aspect-ratio: 1672 / 941;     /* Generate 기본 — modifier 로 override */
  background-color: var(--surface);
  background-image: radial-gradient(circle, rgba(0,0,0,.06) 1px, transparent 1px);
  background-size: 16px 16px;
  border-radius: var(--radius-card);
  border: 1px solid var(--line);
  box-shadow:
    0 2px 4px rgba(23,20,14,.04),
    0 14px 36px rgba(23,20,14,.08);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

**Modifier 1 — `.ais-result-hero-edit`** (Edit / Compare-viewer 공용 · `globals.css:1340`):
```css
.ais-result-hero-edit {
  display: flex;
  flex-direction: column;
  align-items: stretch;          /* 자식 폭 100% 보장 */
  justify-content: flex-start;
  gap: 12px;
  padding: 24px;
  aspect-ratio: auto;            /* 자식 비율 따라감 */
}
```

이 modifier 가 **Compare 좁음 fix 의 핵심** — `align-items: stretch` 가 자식 inner wrapper 의 width 미지정 문제를 자동 해결.

### 3.2 Plain 카드 — `.ais-result-hero-plain` (NEW)

텍스트 결과를 깔끔하게 감싸는 외곽 박스. **dot-grid 없음** (텍스트 가독성 확보) + shadow 약함 (텍스트 영역이라 sm shadow 충분).

**신규 정의 (Phase 1 에서 globals.css 추가)**:
```css
.ais-result-hero-plain {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-sm);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
}
```

**디자인 결정 근거**:
- `padding: 24px` — 매트 `.ais-result-hero-edit` 와 통일 (5 페이지 결과 카드 padding 일관)
- `gap: 14px` — `.ais-compare-analysis-card` 의 14 보존 (현행 시각 유지)
- `box-shadow: var(--shadow-sm)` — 매트 카드의 강한 14px+36px shadow 와 분기 (텍스트 카드는 시각 무게 가벼움)
- `overflow: hidden` — `.ais-compare-analysis-card` 와 동일

### 3.3 분기 적용 규칙

```
결과 카드 컨텐츠가 이미지/영상이면     → 매트 (.ais-result-hero [+ -edit])
결과 카드 컨텐츠가 텍스트면           → Plain (.ais-result-hero-plain)
```

---

## 4. 페이지별 적용 매핑

| 페이지 | 결과 카드 | 적용 className | 변경량 | 회귀 위험 |
|--------|----------|---------------|--------|----------|
| Generate | latest 이미지 | `.ais-result-hero` (현행) | **0** | 없음 (변경 없음) |
| Edit | BeforeAfter | `.ais-result-hero` + `.ais-result-hero-edit` (현행) | **0** | 없음 (변경 없음) |
| Video | mp4 player (Filled 분기만) | `.ais-result-hero` (NEW) | inline → className 전환 | 시각 거의 동일 (현재도 dot-grid + padding 24 매트 톤) |
| Vision | RecipeV2View / LegacyV1View | `.ais-result-hero-plain` (NEW · root wrapper 1개 추가) | 외곽 div 1개 추가 | 분기 안 영향 0 |
| Compare ① viewer | CompareViewer | `.ais-result-hero` + `.ais-result-hero-edit` (NEW · 재사용) | inline → className 전환 + padding 14→24 | inner wrapper width 자동 100% (좁음 fix) |
| Compare ② analysis | CompareAnalysisPanel | `.ais-result-hero-plain` (NEW · 흡수) | className 변경 + 옛 `.ais-compare-analysis-card` 제거 | min-height 262 보존 필요 |

### 4.1 변경 파일 (예상)

- `frontend/app/globals.css` — `.ais-result-hero-plain` 신규 정의 + `.ais-compare-analysis-card` 제거 또는 `.ais-result-hero-plain` 으로 흡수
- `frontend/components/studio/VideoPlayerCard.tsx` — Filled 분기 (line 92~) 의 inline style → className 전환
- `frontend/components/studio/VisionResultCard.tsx` — root 에 `<div className="ais-result-hero-plain">` wrapper 추가
- `frontend/components/studio/compare/CompareViewer.tsx` — 외곽 inline → `.ais-result-hero` + `.ais-result-hero-edit` className · SliderViewer / SideBySideViewer 의 inner wrapper width 처리 검증
- `frontend/components/studio/compare/CompareAnalysisPanel.tsx` — className `.ais-compare-analysis-card` → `.ais-result-hero-plain` (또는 흡수 패턴)

---

## 5. 회귀 위험 7 항목 + 보존 방법

| # | 위험 | 보존 방법 | 검증 시점 |
|---|------|----------|----------|
| 1 | `.ais-result-hero` aspect-ratio 1672/941 (Generate 전용) → Video/Compare-viewer 에 부적합 | Video 는 base 만 적용 (aspect-ratio override 위해 `-edit` 또는 직접 `aspect-ratio:auto` style) — Phase 2 점검 / Compare-viewer 는 `-edit` modifier 재사용 | Phase 2 / Phase 4 |
| 2 | `.ais-result-hero-edit` 의 `flex column + align-items: stretch` (Edit 자식 폭 100% 보장) | Compare-viewer 재사용 시 그대로 — 이게 좁음 fix 의 핵심 메커니즘 | Phase 4 |
| 3 | VideoPlayerCard 3 분기 (Mock / Empty / Filled) | **Filled 만** 매트 카드 적용. Mock 분기 (line 49~) / Empty 분기 (line 81~) 는 StudioEmptyState 그대로 (다른 페이지 동일 패턴) | Phase 2 |
| 4 | VisionResultCard 2 분기 (RecipeV2View / LegacyV1View · line 64-67) | 외곽 박스를 컴포넌트 root 에 1개만 추가 — 분기 (V2/V1) 내부는 0 영향. Loading/Empty 분기 (line 46-62) 는 StudioLoadingState/StudioEmptyState 그대로 (외곽 박스 X 유지 — 다른 페이지 동일) | Phase 3 |
| 5 | BeforeAfterSlider 자체 box-shadow (`.ais-ba-slider` line 1762) vs 외곽 매트 shadow 중복 | Edit 에서 이미 검증된 패턴 (현재 정상 동작 중) — Compare-viewer 도 동일 구조라 회귀 X | Phase 4 |
| 6 | Compare viewer 헤더 (SegControl + 비율 경고 chip · CompareViewer.tsx:67-107) | `.ais-result-hero-edit` 의 column flex 첫 행으로 보존. `gap:12` 안에서 자연 정렬 | Phase 4 |
| 7 | dot grid + EmptyState/Loading 충돌 | Plain 카드는 dot-grid 없음 — 충돌 0. Video Filled 의 dot grid + video element 는 Generate hero 에서 검증된 패턴 | Phase 2 / Phase 3 |

### 5.1 추가 점검 항목 (Phase 5)

- `.ais-compare-analysis-card` 제거 시 grep 으로 다른 호출자 없는지 확인 (현재는 `CompareAnalysisPanel` 1곳만 사용 추정)
- `min-height: 262px` (`.ais-compare-analysis-card` 보유) → `.ais-result-hero-plain` 에 modifier 또는 inline style 로 보존 필요 여부 결정 (production UX cap · plan §7 시각 cap 보존)
- VideoPlayerCard Filled 의 `padding: 24` + `gap: 12` 가 `.ais-result-hero` base 정의에 없음 — `-edit` modifier 재사용 검토 또는 별도 modifier 신설
- ResultHoverActionBar (Generate/Edit) 의 hover 영역 — 외곽 박스 변경 시 hover 좌표 회귀 점검

---

## 6. 작업 범위 + 비목표

### 6.1 In-scope

- 5 페이지 우패널 결과 본문 카드 외관 (className 표준화 + 누락 wrapper 추가)
- `.ais-result-hero-plain` 신규 className 정의
- Compare 우패널 inner width 미지정 결함 fix (자동 — `.ais-result-hero-edit` 재사용으로 해결)
- `.ais-compare-analysis-card` → `.ais-result-hero-plain` 흡수 (className 통일)

### 6.2 Out-of-scope (YAGNI · §1.3 박제)

- Caption / HistorySectionHeader / Gallery 통일 (이미 통일됨)
- Compare history 추가 (휘발 정책 유지)
- 백엔드 변경 (순수 frontend)
- HistoryItem schema 추가
- 좌패널 / Mode Header / Result Header 통일 (이미 통일됨)
- 메뉴 페이지 (`app/page.tsx`) — 결과 카드 영역 없음

---

## 7. 검증 방식

### 7.1 자동 검증 (각 phase 끝)

- `cd backend; pytest tests/` → **474 PASS** 유지 (백엔드 변경 0 = 회귀 0 기대)
- `cd frontend; npm test` → **216 PASS** 유지 (스토어/훅 변경 0 = 회귀 0 기대)
- `npx tsc --noEmit` → clean
- `npm run lint` → clean

### 7.2 사용자 시각 검증 (Phase 5 · 핵심)

```powershell
# Backend (실 백엔드 띄울 때)
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --no-access-log

# Frontend (실 백엔드)
$env:NEXT_PUBLIC_USE_MOCK="false"; $env:NEXT_PUBLIC_STUDIO_API="http://localhost:8001"
cd frontend; npm run dev
```

5 페이지 순차 확인:
1. `/generate` — Generate 결과 카드 회귀 0 (변경 없음)
2. `/edit` — Edit 결과 카드 회귀 0 (변경 없음) + BeforeAfter 슬라이더 정상
3. `/video` — Video Filled 카드 매트 톤 유지 (시각 거의 동일) + Mock/Empty 분기 정상
4. `/vision` — Plain 외곽 박스로 결과 영역 시각 무게 ↑ + 텍스트 가독성 OK
5. `/vision/compare` — Compare viewer 가 우패널 폭 100% 점유 (좁음 fix 확인) + analysis panel plain 톤 유지

### 7.3 Codex iterative review (Phase 5)

- 박제 패턴 활용: 1차 → fix → 2차 → 100% → 구현 (`feedback_codex_iterative_review.md`)
- 검증 항목:
  - className 적용 누락 없는지 5 페이지 grep
  - aspect-ratio 부적합 (Video/Compare 에 1672/941 적용되면 안 됨)
  - `.ais-compare-analysis-card` 잔여 호출자 (Compare 외 호출처 점검)
  - Vision 의 V2/V1 분기 안 외곽 박스 중복 (root 1곳만)

---

## 8. 머지 전략 + Phase 분할

### 8.1 브랜치 + 머지 (박제 default)

- 브랜치: `feature/uniform-result-cards`
- 옵션 A — 100% 후 master 1번 merge (`--no-ff`)
- 브랜치 안 phase 단위 commit (각 phase 끝에 검증 통과 확인)

### 8.2 Phase 분할

#### Phase 1 — CSS 표준 추가
- `frontend/app/globals.css` 에 `.ais-result-hero-plain` 정의 추가
- `.ais-compare-analysis-card` 처리 결정 — Phase 4 에서 제거 또는 alias
- 검증: tsc/lint clean (시각 변경 0 — CSS 만 추가)
- commit: `style(css): .ais-result-hero-plain 표준 추가 (Phase 1)`

#### Phase 2 — Video 매트 className 전환
- `VideoPlayerCard.tsx` Filled 분기 (line 92~) inline → className
- Mock / Empty 분기 무변경
- 검증: vitest 216 / tsc / lint / 시각 (Video 페이지)
- commit: `refactor(video): VideoPlayerCard Filled 매트 className 전환 (Phase 2)`

#### Phase 3 — Vision Plain 외곽 박스 추가
- `VisionResultCard.tsx` root 에 `<div className="ais-result-hero-plain">` wrapper 추가
- Loading / Empty 분기는 외곽 박스 X 유지 (StudioLoadingState / StudioEmptyState 그대로)
- V2 / V1 분기 무변경
- 검증: vitest / tsc / lint / 시각 (Vision 페이지)
- commit: `refactor(vision): VisionResultCard plain 외곽 박스 추가 (Phase 3)`

#### Phase 4 — Compare 통일 (viewer 매트 + analysis plain 흡수)
- `CompareViewer.tsx` 외곽 inline → `.ais-result-hero` + `.ais-result-hero-edit`
  - SliderViewer / SideBySideViewer 의 inner width 자동 fix 확인
  - padding 14 → 24 (`.ais-result-hero-edit` 정의 적용)
- `CompareAnalysisPanel.tsx` className `.ais-compare-analysis-card` → `.ais-result-hero-plain`
- `globals.css` 에서 `.ais-compare-analysis-card` 제거 (또는 `.ais-result-hero-plain` 으로 alias 경유 검토 — 잔여 호출자 grep 후 결정)
- min-height 262 처리 (Plain 에 modifier 또는 인라인 보존)
- 검증: vitest / tsc / lint / 시각 (Compare 페이지 — 좁음 fix 확인 핵심)
- commit: `refactor(compare): CompareViewer 매트 + AnalysisPanel plain 흡수 (Phase 4)`

#### Phase 5 — 시각 검증 + Codex review + 회귀 점검
- 5 페이지 dev server 시각 검증 (사용자)
- Codex review 1차 → fix → 2차
- 회귀 7 항목 (§5) 모두 보존 점검
- 자동 검증 (vitest 216 / pytest 474 / tsc / lint) 최종 통과
- commit: `chore: 통일 작업 회귀 점검 + Codex review fix (Phase 5)`

### 8.3 master merge

```bash
git checkout master
git merge --no-ff feature/uniform-result-cards
git push origin master
```

머지 후 MEMORY.md 갱신 (`최신` section · 변경 commit hash + 검증 결과 박제).

---

## 9. 알려진 결정 미루기 (Phase 4 점검 필요)

- **`min-height: 262px` 처리** — `.ais-compare-analysis-card` 의 production UX cap. `.ais-result-hero-plain` base 에 박을지 / Compare 만 modifier 로 줄지 / 인라인 보존할지 Phase 4 시점에 결정.
- **`.ais-compare-analysis-card` 잔여 호출자** — `CompareAnalysisPanel` 1곳 추정이지만 Phase 4 시작 시점에 grep 으로 실증.
- **Video Filled 의 padding/gap** — 현재 inline `padding:24 + gap:12` 인데 `.ais-result-hero` base 에는 없음. `-edit` modifier 재사용할지 / 신규 modifier (`-video`) 만들지 / inline 잔존할지 Phase 2 시점에 결정.

이 3 항목은 spec 작성 시점에 미리 결정 안 함 — 코드 만지면서 자연 결정 (over-engineering 방지).

---

## 10. 성공 기준

1. **Compare 좁음 fix** — 우패널 결과 영역이 다른 4 페이지와 동일한 폭 점유 (사용자 시각 확인)
2. **시각 회귀 0** — Generate / Edit 무변경 / Video Filled 거의 동일 / Vision 외곽 박스 추가만 차이 / Compare 좁음 fix 외 시각 변경 없음
3. **자동 회귀 0** — pytest 474 / vitest 216 / tsc / lint 통과
4. **className 표준 일관성** — 5 페이지 우패널 결과 카드가 `.ais-result-hero` (이미지/영상) 또는 `.ais-result-hero-plain` (텍스트) 둘 중 하나로 분기 적용 (inline 박스 0)
5. **회귀 위험 7 항목 (§5) 모두 보존**
