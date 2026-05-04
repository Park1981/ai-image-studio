# 5 페이지 우패널 결과 카드 통일 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5 페이지 우패널 결과 본문 카드의 외관 구현을 두 갈래 표준 (`.ais-result-hero` 매트 / `.ais-result-hero-plain` Plain) 으로 통일한다.

**Architecture:** className 표준 두 갈래 신설 + 4 갈래 분산 (Generate/Edit hero · Video inline · Vision 박스 부재 · Compare inline) 을 매핑 적용. Compare 좁음 결함은 `.ais-result-hero-edit` 의 `align-items: stretch` 가 자동 해결.

**Tech Stack:** Next.js 16 + React 19 + TypeScript strict + Tailwind v4 + globals.css (.ais-* 토큰) + vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-04-uniform-result-cards-design.md`

**Branch:** `feature/uniform-result-cards`

**Verification baseline:** pytest 474 / vitest 216 / tsc clean / ESLint clean.

---

## File Structure

### Modify
- `frontend/app/globals.css` — Phase 1: `.ais-result-hero-plain` 정의 추가 / Phase 4: `.ais-compare-analysis-card` 정의 제거
- `frontend/components/studio/VideoPlayerCard.tsx:92-167` — Phase 2: Filled 분기 inline → className
- `frontend/components/studio/VisionResultCard.tsx:44-68` — Phase 3: root wrapper `<div className="ais-result-hero-plain">` 추가 (V2/V1 분기 안 영향 0)
- `frontend/components/studio/compare/CompareViewer.tsx:52-118` — Phase 4: 외곽 inline → `.ais-result-hero` + `.ais-result-hero-edit` className
- `frontend/components/studio/compare/CompareAnalysisPanel.tsx` — Phase 4: className `.ais-compare-analysis-card` → `.ais-result-hero-plain`

### Create (신규 test 파일)
- `frontend/__tests__/uniform-video-card.test.tsx` — Phase 2 검증
- `frontend/__tests__/uniform-vision-card.test.tsx` — Phase 3 검증
- `frontend/__tests__/uniform-compare-cards.test.tsx` — Phase 4 검증

### Untouched (회귀 위험 보존)
- `frontend/components/studio/edit/EditResultViewer.tsx` — Edit hero 현행 유지
- `frontend/components/studio/generate/GenerateResultViewer.tsx` — Generate hero 현행 유지
- `frontend/components/studio/BeforeAfterSlider.tsx` — 자체 box-shadow 보존
- `frontend/__tests__/api-vision-compare.test.ts` — Vision Compare API test 무관

---

## Task 1: 브랜치 생성 + Phase 1 (CSS 표준 추가)

**Files:**
- Modify: `frontend/app/globals.css` (line ~1349 `.ais-result-hero-edit` 정의 다음 줄)

- [ ] **Step 1.1: feature 브랜치 생성**

```bash
git checkout master
git pull origin master
git checkout -b feature/uniform-result-cards
```

Expected: `Switched to a new branch 'feature/uniform-result-cards'`

- [ ] **Step 1.2: globals.css 에 `.ais-result-hero-plain` 추가**

`frontend/app/globals.css` 의 `.ais-result-hero-edit` 정의 (line ~1340-1348) 직후에 다음 블록을 추가:

```css
/* ── Plain 카드 — .ais-result-hero 패밀리 확장 (2026-05-04 통일 plan).
 *  텍스트 결과 (Vision / Compare-analysis) 용. dot-grid X · 약한 shadow.
 *  매트 (.ais-result-hero base) 와 분기 — 이미지/영상 = 매트 / 텍스트 = plain. */
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

- [ ] **Step 1.3: tsc + lint 통과 확인 (CSS 만 변경 — 시각 변경 0)**

```bash
cd frontend
npx tsc --noEmit
npm run lint
```

Expected: 두 명령 모두 clean exit.

- [ ] **Step 1.4: vitest 회귀 0 확인 (216 PASS 유지)**

```bash
cd frontend
npm test
```

Expected: `Tests  216 passed (216)` (CSS 추가만 했으므로 회귀 0).

- [ ] **Step 1.5: commit**

```bash
git add frontend/app/globals.css
git commit -m "style(css): .ais-result-hero-plain 표준 추가 (Phase 1)

5 페이지 우패널 결과 카드 통일 plan 의 첫 단계.
텍스트 결과 (Vision / Compare-analysis) 용 외곽 박스 표준 신설.
매트 (.ais-result-hero) 와 분기 — dot-grid X · shadow-sm.
"
```

---

## Task 2: Phase 2 — Video Filled 매트 className 전환

**Files:**
- Create: `frontend/__tests__/uniform-video-card.test.tsx`
- Modify: `frontend/components/studio/VideoPlayerCard.tsx:92-130`

- [ ] **Step 2.1: 실패 test 작성** — Filled 분기에 `.ais-result-hero` className 적용 검증

`frontend/__tests__/uniform-video-card.test.tsx` 신규 파일에 다음 코드:

```tsx
/**
 * Phase 2 검증 — VideoPlayerCard Filled 분기가 .ais-result-hero className 적용.
 * Mock / Empty 분기는 영향 0 (StudioEmptyState 그대로).
 */

import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import VideoPlayerCard from "@/components/studio/VideoPlayerCard";

afterEach(() => cleanup());

it("Filled 분기 — outermost element 가 .ais-result-hero className 보유", () => {
  // valid http-prefixed src → Filled 분기 활성
  const { container } = render(
    <VideoPlayerCard src="http://example.com/test.mp4" running={false} />,
  );
  // 첫 직계 자식 (root element) 가 .ais-result-hero 갖는지
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero");
});

it("Mock 분기 — .ais-result-hero className 적용 X (별도 inline dashed 박스 유지)", () => {
  const { container } = render(
    <VideoPlayerCard src="mock-seed://video" running={false} />,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).not.toContain("ais-result-hero");
});

it("Empty 분기 (src 없음) — StudioEmptyState 마운트 (.ais-result-hero 없음)", () => {
  const { container } = render(<VideoPlayerCard src="" running={false} />);
  const root = container.firstChild as HTMLElement | null;
  // StudioEmptyState 의 root 가 .ais-result-hero 안 가짐
  if (root) {
    expect(root.className).not.toContain("ais-result-hero");
  }
});
```

- [ ] **Step 2.2: test 실패 확인**

```bash
cd frontend
npm test -- uniform-video-card
```

Expected: 첫 it (Filled 분기) FAIL — current code 는 inline style 박스만 있어서 className 없음.

- [ ] **Step 2.3: VideoPlayerCard.tsx Filled 분기 변경**

`frontend/components/studio/VideoPlayerCard.tsx` 의 line 92~130 (Filled 분기 root `<div>`) 을 다음과 같이 변경:

**변경 전** (line 92-112):
```tsx
  // ── Filled ── 2026-04-27 매트 카드 + dot grid (Generate / Edit 와 통일)
  return (
    <div
      style={{
        // 카드 외관 = 매트 (var(--surface) + dot grid + border + shadow)
        backgroundColor: "var(--surface)",
        backgroundImage:
          "radial-gradient(circle, rgba(0,0,0,.06) 1px, transparent 1px)",
        backgroundSize: "16px 16px",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-sm)",
        overflow: "hidden",
        // 매트 padding — video 가 떠있는 느낌 (사진 갤러리 톤)
        padding: 24,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
```

**변경 후**:
```tsx
  // ── Filled ── 2026-05-04 통일 plan: .ais-result-hero 매트 카드 className 전환.
  // aspect-ratio:auto 필요 (video 실제 비율) + flex column + padding 24 — Edit 의
  // -edit modifier 와 동일한 요구라 함께 적용.
  return (
    <div
      className="ais-result-hero ais-result-hero-edit"
      style={{
        // 동적 보존 항목만 inline (Generate hero 의 16:9 aspect-ratio 는 부적합).
        // -edit modifier 가 aspect-ratio:auto + padding 24 + flex column + stretch.
      }}
    >
```

inline style 객체는 빈 객체로 두지 말고 prop 자체를 제거:

```tsx
  return (
    <div className="ais-result-hero ais-result-hero-edit">
```

- [ ] **Step 2.4: test 통과 확인**

```bash
cd frontend
npm test -- uniform-video-card
```

Expected: 3 it 모두 PASS.

- [ ] **Step 2.5: 전체 vitest + tsc + lint clean**

```bash
cd frontend
npm test && npx tsc --noEmit && npm run lint
```

Expected: `Tests  219 passed (219)` (216 + 신규 3) · tsc clean · lint clean.

- [ ] **Step 2.6: commit**

```bash
git add frontend/components/studio/VideoPlayerCard.tsx frontend/__tests__/uniform-video-card.test.tsx
git commit -m "refactor(video): VideoPlayerCard Filled 매트 className 전환 (Phase 2)

inline style → .ais-result-hero + .ais-result-hero-edit (Edit 패턴 재사용).
aspect-ratio:auto + padding 24 + flex column + stretch 자동 적용.
Mock / Empty 분기 무변경 (StudioEmptyState 그대로).

vitest +3 test (216 → 219).
"
```

---

## Task 3: Phase 3 — Vision Plain 외곽 박스 추가

**Files:**
- Create: `frontend/__tests__/uniform-vision-card.test.tsx`
- Modify: `frontend/components/studio/VisionResultCard.tsx:44-68`

- [ ] **Step 3.1: 실패 test 작성** — V2/V1 분기에 `.ais-result-hero-plain` wrapper 적용 검증

`frontend/__tests__/uniform-vision-card.test.tsx` 신규 파일:

```tsx
/**
 * Phase 3 검증 — VisionResultCard 의 V2/V1 분기에 .ais-result-hero-plain wrapper.
 * Loading / Empty 분기는 wrapper 없음 (StudioLoadingState/StudioEmptyState 그대로).
 */

import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import VisionResultCard, {
  type VisionCardResult,
} from "@/components/studio/VisionResultCard";

afterEach(() => cleanup());

// VisionCardResult 의 필수 필드는 en + ko (string | null). 나머지 optional.
const v2Result: VisionCardResult = {
  en: "Young woman in red dress at sunset.",
  ko: "노을 무렵 빨간 드레스 입은 젊은 여성.",
  positivePrompt: "young woman, red dress, sunset",
};

it("V2 분기 — outermost element 가 .ais-result-hero-plain wrapper", () => {
  const { container } = render(
    <VisionResultCard result={v2Result} running={false} />,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-plain");
});

it("V1 분기 (positivePrompt 빈값) — 동일하게 .ais-result-hero-plain wrapper", () => {
  const v1Result: VisionCardResult = { ...v2Result, positivePrompt: "" };
  const { container } = render(
    <VisionResultCard result={v1Result} running={false} />,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-plain");
});

it("Empty 분기 (result null) — wrapper 없음 (StudioEmptyState 그대로)", () => {
  const { container } = render(<VisionResultCard result={null} running={false} />);
  const root = container.firstChild as HTMLElement | null;
  if (root) {
    expect(root.className).not.toContain("ais-result-hero-plain");
  }
});

it("Loading 분기 (running true) — wrapper 없음 (StudioLoadingState 그대로)", () => {
  const { container } = render(<VisionResultCard result={null} running={true} />);
  const root = container.firstChild as HTMLElement | null;
  if (root) {
    expect(root.className).not.toContain("ais-result-hero-plain");
  }
});
```

- [ ] **Step 3.2: test 실패 확인**

```bash
cd frontend
npm test -- uniform-vision-card
```

Expected: 첫 두 it (V2/V1 분기) FAIL — current code 는 RecipeV2View / LegacyV1View 가 wrapper 없이 직접 컨텐츠 반환.

- [ ] **Step 3.3: VisionResultCard.tsx 의 V2/V1 분기 wrapper 추가**

`frontend/components/studio/VisionResultCard.tsx` 의 line 64-67 변경:

**변경 전**:
```tsx
  // ─── Branching: v2 vs v1 ───
  const isV2 = !!(result.positivePrompt && result.positivePrompt.trim());
  if (isV2) return <RecipeV2View result={result} />;
  return <LegacyV1View result={result} />;
}
```

**변경 후**:
```tsx
  // ─── Branching: v2 vs v1 ───
  // 2026-05-04 통일 plan: V2/V1 분기 모두 .ais-result-hero-plain wrapper 로 감싸
  // Vision 결과 영역의 외곽 박스 톤을 다른 4 페이지와 통일. Loading/Empty 분기는
  // StudioLoadingState/StudioEmptyState 자체 외곽이 있어 wrapper 없음.
  const isV2 = !!(result.positivePrompt && result.positivePrompt.trim());
  return (
    <div className="ais-result-hero-plain">
      {isV2 ? <RecipeV2View result={result} /> : <LegacyV1View result={result} />}
    </div>
  );
}
```

- [ ] **Step 3.4: test 통과 확인**

```bash
cd frontend
npm test -- uniform-vision-card
```

Expected: 4 it 모두 PASS.

- [ ] **Step 3.5: 전체 vitest + tsc + lint clean**

```bash
cd frontend
npm test && npx tsc --noEmit && npm run lint
```

Expected: `Tests  223 passed (223)` (219 + 신규 4) · tsc clean · lint clean.

- [ ] **Step 3.6: commit**

```bash
git add frontend/components/studio/VisionResultCard.tsx frontend/__tests__/uniform-vision-card.test.tsx
git commit -m "refactor(vision): VisionResultCard plain 외곽 박스 추가 (Phase 3)

V2/V1 분기 모두 .ais-result-hero-plain root wrapper.
Loading/Empty 분기는 무변경 (StudioLoadingState/EmptyState 그대로).

vitest +4 test (219 → 223).
"
```

---

## Task 4: Phase 4.1 — Compare viewer 매트 className 전환 (좁음 fix 핵심)

**Files:**
- Create: `frontend/__tests__/uniform-compare-cards.test.tsx`
- Modify: `frontend/components/studio/compare/CompareViewer.tsx:52-118`

- [ ] **Step 4.1.1: 실패 test 작성** — CompareViewer outermost 에 매트 className 적용

`frontend/__tests__/uniform-compare-cards.test.tsx` 신규 파일:

```tsx
/**
 * Phase 4 검증 — CompareViewer (매트) + CompareAnalysisPanel (Plain) 통일.
 *
 * Phase 4.1 (이 파일 첫 it): CompareViewer 외곽이 .ais-result-hero + .ais-result-hero-edit.
 * Phase 4.2 (다음 task): CompareAnalysisPanel 이 .ais-result-hero-plain 적용.
 */

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import CompareViewer from "@/components/studio/compare/CompareViewer";
import type { VisionCompareImage } from "@/stores/useVisionCompareStore";

afterEach(() => cleanup());

const imageA: VisionCompareImage = {
  dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  label: "A.png",
  width: 1280,
  height: 720,
};
const imageB: VisionCompareImage = { ...imageA, label: "B.png" };

it("CompareViewer outermost 가 .ais-result-hero + .ais-result-hero-edit", () => {
  const { container } = render(
    <CompareViewer
      imageA={imageA}
      imageB={imageB}
      mode="slider"
      onModeChange={vi.fn()}
    />,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero");
  expect(root!.className).toContain("ais-result-hero-edit");
});

it("Compare empty (이미지 없음) — 매트 className 보존 (Empty 분기 자체도 외곽 안)", () => {
  const { container } = render(
    <CompareViewer
      imageA={null}
      imageB={null}
      mode="slider"
      onModeChange={vi.fn()}
    />,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero");
});
```

- [ ] **Step 4.1.2: test 실패 확인**

```bash
cd frontend
npm test -- uniform-compare-cards
```

Expected: 두 it 모두 FAIL — current code 는 inline style 만 있어서 className 없음.

- [ ] **Step 4.1.3: CompareViewer.tsx 외곽 + inner SliderViewer/SideBySideViewer 변경**

`frontend/components/studio/compare/CompareViewer.tsx` 의 line 52-117 변경:

**변경 전 (외곽 박스 line 52-64)**:
```tsx
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-lg)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 304,
      }}
    >
```

**변경 후**:
```tsx
  return (
    <div
      className="ais-result-hero ais-result-hero-edit"
      style={{
        // 동적 보존: minHeight 304 (Compare 시각 cap · plan §9 박제).
        // 나머지 (background/border/radius/padding/flex column/gap) 는 className 의 .ais-result-hero + .ais-result-hero-edit 가 처리.
        // -edit modifier 의 gap 12 → 10 차이는 의도된 일관화 (Edit 와 통일).
        minHeight: 304,
      }}
    >
```

**SliderViewer (line 133-158) 의 inner wrapper 는 변경 불필요** —
부모 `.ais-result-hero-edit` 의 `align-items: stretch` 가 자식 폭 100% 자동 보장 (= 좁음 fix 의 자동 해결 메커니즘).

다만 `SliderViewer` 의 외곽 `<div style={{ width: "100%", display: "flex", justifyContent: "center" }}>` 는 BeforeAfterSlider 가운데 정렬 위해 유지 (회귀 위험 #5 보존).

**SideBySideViewer (line 160-182) 도 변경 불필요** — `gridTemplateColumns: "1fr 1fr"` 는 `align-items: stretch` 부모 안에서 자동 폭 100% 점유.

- [ ] **Step 4.1.4: test 통과 확인**

```bash
cd frontend
npm test -- uniform-compare-cards
```

Expected: 두 it (Phase 4.1) PASS. (Phase 4.2 의 CompareAnalysisPanel test 는 Task 5 에서 추가 — 이 시점엔 아직 없음.)

- [ ] **Step 4.1.5: 전체 vitest + tsc + lint clean**

```bash
cd frontend
npm test && npx tsc --noEmit && npm run lint
```

Expected: `Tests  225 passed (225)` (223 + 신규 2) · tsc clean · lint clean.

- [ ] **Step 4.1.6: commit**

```bash
git add frontend/components/studio/compare/CompareViewer.tsx frontend/__tests__/uniform-compare-cards.test.tsx
git commit -m "refactor(compare): CompareViewer 매트 className 전환 (Phase 4.1)

inline style → .ais-result-hero + .ais-result-hero-edit (Edit 패턴 재사용).
좁음 fix 자동 해결 — -edit modifier 의 align-items:stretch 가
SliderViewer/SideBySideViewer 의 inner wrapper 폭 100% 자동 보장.

minHeight 304 inline 보존 (Compare 시각 cap).
SliderViewer/SideBySideViewer 본문은 무변경.

vitest +2 test (223 → 225).
"
```

---

## Task 5: Phase 4.2 — Compare analysis panel Plain 흡수 + globals.css 정리

**Files:**
- Modify: `frontend/components/studio/compare/CompareAnalysisPanel.tsx`
- Modify: `frontend/__tests__/uniform-compare-cards.test.tsx` (Task 4 에서 만든 파일에 it 추가)
- Modify: `frontend/app/globals.css` (`.ais-compare-analysis-card` 정의 제거)

- [ ] **Step 5.1: `.ais-compare-analysis-card` 잔여 호출자 grep**

```bash
cd frontend
grep -rn "ais-compare-analysis-card" --include="*.tsx" --include="*.ts" --include="*.css" .
```

Expected: 2 결과만 — `app/globals.css` 정의 + `compare/CompareAnalysisPanel.tsx` 사용. 다른 호출자 없음 확인.

만약 다른 호출자 발견 시 → plan 일시 중단 + 사용자 확인 (spec §9 박제: "Phase 4 시작 시점에 grep 으로 실증").

- [ ] **Step 5.2: 실패 test 추가** — CompareAnalysisPanel root 가 `.ais-result-hero-plain`

`frontend/__tests__/uniform-compare-cards.test.tsx` 의 끝 부분 (마지막 it 다음) 에 다음 추가:

```tsx
import CompareAnalysisPanel from "@/components/studio/compare/CompareAnalysisPanel";
import type { VisionCompareAnalysis } from "@/lib/api/types";

// VisionCompareAnalysis 실제 fields (lib/api/types.ts:214) — comments_en/comments_ko
// 분리 + summary_en/summary_ko 분리 + transform_prompt_en/_ko + uncertain_en/_ko optional.
// provider/analyzedAt/visionModel 필수.
const minimalAnalysis: VisionCompareAnalysis = {
  scores: {
    composition: 75,
    color: 80,
    subject: 70,
    mood: 65,
    quality: 78,
  },
  overall: 74,
  comments_en: { composition: "", color: "", subject: "", mood: "", quality: "" },
  comments_ko: { composition: "", color: "", subject: "", mood: "", quality: "" },
  summary_en: "",
  summary_ko: "",
  provider: "ollama",
  fallback: false,
  analyzedAt: 0,
  visionModel: "qwen3-vl:8b",
};

it("CompareAnalysisPanel — analysis 있을 때 .ais-result-hero-plain 적용", () => {
  const { container } = render(
    <CompareAnalysisPanel running={false} analysis={minimalAnalysis} />,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-plain");
  expect(root!.className).not.toContain("ais-compare-analysis-card");
});

it("CompareAnalysisPanel — running 시 (StudioLoadingState) 도 동일하게 처리", () => {
  const { container } = render(
    <CompareAnalysisPanel running={true} analysis={null} />,
  );
  // 현재 구현: running 시 StudioLoadingState 직접 반환 — wrapper 없음 (Vision 패턴과 통일).
  const root = container.firstChild as HTMLElement | null;
  if (root) {
    expect(root.className).not.toContain("ais-result-hero-plain");
  }
});
```

- [ ] **Step 5.3: test 실패 확인**

```bash
cd frontend
npm test -- uniform-compare-cards
```

Expected: 추가 첫 it FAIL — current code 는 `.ais-compare-analysis-card` className 사용.

- [ ] **Step 5.4: CompareAnalysisPanel.tsx className 변경**

`frontend/components/studio/compare/CompareAnalysisPanel.tsx` 안에서 `ais-compare-analysis-card` 를 `ais-result-hero-plain` 으로 변경.

먼저 정확한 위치를 확인:

```bash
cd frontend
grep -n "ais-compare-analysis-card" components/studio/compare/CompareAnalysisPanel.tsx
```

해당 라인의 className `"ais-compare-analysis-card"` 를 `"ais-result-hero-plain"` 으로 교체. 만약 모듈 안에 inline style 로 `min-height: 262` 이 따로 정의되어 있으면 보존 (`.ais-compare-analysis-card` 의 `min-height: 262px` 가 Plain base 에 없으므로 inline 으로 옮김).

만약 `.ais-compare-analysis-card` 의 `min-height: 262` 가 className 으로만 있고 inline 부재면, CompareAnalysisPanel 의 root `<div>` 에 `style={{ minHeight: 262 }}` 추가:

```tsx
<div className="ais-result-hero-plain" style={{ minHeight: 262 }}>
```

- [ ] **Step 5.5: globals.css 에서 `.ais-compare-analysis-card` 정의 제거**

`frontend/app/globals.css` 의 line 1980 부근 `.ais-compare-analysis-card { ... }` 블록 전체 삭제. 직전/직후 빈 줄 정리.

만약 같은 prefix 의 자식 selector (`.ais-compare-analysis-card .X { ... }`) 가 있으면 그것들도 식별 후 다음 중 선택:
- 자식 selector 가 다른 곳에서도 의미 있으면 → `.ais-result-hero-plain .X { ... }` 로 변경
- 자식 selector 가 CompareAnalysisPanel 전용이면 → `.ais-result-hero-plain .X { ... }` 로 변경

확인 명령:
```bash
cd frontend
grep -n "ais-compare-analysis-card" app/globals.css
```

각 매치를 검토하고 위 규칙대로 처리. 모두 처리한 뒤 final grep 으로 잔여 0 확인:
```bash
grep -rn "ais-compare-analysis-card" --include="*.tsx" --include="*.ts" --include="*.css" .
```

Expected: 매치 0건.

- [ ] **Step 5.6: test 통과 확인 + 전체 회귀 0**

```bash
cd frontend
npm test && npx tsc --noEmit && npm run lint
```

Expected: `Tests  227 passed (227)` (225 + 신규 2) · tsc clean · lint clean.

- [ ] **Step 5.7: commit**

```bash
git add frontend/components/studio/compare/CompareAnalysisPanel.tsx frontend/__tests__/uniform-compare-cards.test.tsx frontend/app/globals.css
git commit -m "refactor(compare): CompareAnalysisPanel plain 흡수 + .ais-compare-analysis-card 제거 (Phase 4.2)

className .ais-compare-analysis-card → .ais-result-hero-plain 통일.
globals.css 의 옛 .ais-compare-analysis-card 정의 제거 (자식 selector 도 -plain 로 이전).
min-height 262 보존 (인라인 또는 자식 selector 안).

vitest +2 test (225 → 227).
"
```

---

## Task 6: Phase 5 — 사용자 시각 검증 + Codex review + 회귀 점검

**Files:** (코드 변경 없음 — 검증 단계)

- [ ] **Step 6.1: dev server 띄우기**

```powershell
# Backend (실 백엔드)
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --no-access-log
```

다른 터미널:
```powershell
$env:NEXT_PUBLIC_USE_MOCK="false"; $env:NEXT_PUBLIC_STUDIO_API="http://localhost:8001"
cd frontend; npm run dev
```

- [ ] **Step 6.2: 사용자 시각 검증 5 페이지 (Chrome MCP)**

각 페이지 스크린샷 + 사용자 OK 받기:
1. `/generate` — Generate 결과 카드 회귀 0 (변경 없음)
2. `/edit` — Edit 결과 카드 회귀 0 + BeforeAfter 슬라이더 정상 (변경 없음)
3. `/video` — Video Filled 매트 톤 유지 (시각 거의 동일) + Mock/Empty 분기 정상
4. `/vision` — Plain 외곽 박스로 결과 영역 시각 무게 ↑ + 텍스트 가독성 OK
5. `/vision/compare` — Compare viewer 가 우패널 폭 100% 점유 (좁음 fix 확인 핵심) + analysis panel plain 톤 유지

5 페이지 모두 사용자 OK 받기.

- [ ] **Step 6.3: 회귀 7 항목 (spec §5) grep + 코드 점검**

```bash
cd frontend
# 1. .ais-result-hero 의 aspect-ratio 1672/941 가 Generate 외에서 적용되는지
grep -n "1672 / 941" app/globals.css components/studio/

# 2. .ais-compare-analysis-card 잔여 0 확인
grep -rn "ais-compare-analysis-card" --include="*.tsx" --include="*.ts" --include="*.css" .

# 3. inline 박스 (background: var(--surface) + border + radius-card) 가 결과 카드 영역에 잔여 있는지
grep -n "var(--surface)" components/studio/compare/ components/studio/VideoPlayerCard.tsx components/studio/VisionResultCard.tsx
```

각 결과 검토:
- 1: Generate hero 의 base 정의 1곳만 OK
- 2: 0건 OK
- 3: BeforeAfterSlider 등 자체 이미지 영역은 OK · CompareViewer / VideoPlayerCard / VisionResultCard 의 root 외곽은 0건이어야 함

- [ ] **Step 6.4: Codex iterative review 1차 (사용자 명시 시)**

박제 패턴 (`feedback_codex_iterative_review.md`) 활용. 사용자가 "Codex 리뷰 보내" 명시 시:

```
codex:codex-rescue 에이전트 디스패치:
- 변경 5 commit (df52074 spec 외)
- spec 박제대로 5 phase 통일 작업 검증
- 회귀 위험 7 항목 보존 점검
- className 분기 정합성 (Generate/Edit hero 무변경 / Video/Compare-viewer 매트 / Vision/Compare-analysis Plain)
```

Codex finding 별로 Step 분할 후 fix → 2차 review → 100%.

- [ ] **Step 6.5: 자동 검증 최종 통과**

```bash
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/

cd ../frontend
npm test
npx tsc --noEmit
npm run lint
```

Expected:
- pytest: `474 passed`
- vitest: `Tests  227 passed (227)`
- tsc: clean
- lint: clean

- [ ] **Step 6.6: master HEAD log 출력 (인계용)**

```bash
git log --oneline master..HEAD
```

5 commit 확인:
- (Task 1) `style(css): .ais-result-hero-plain ...`
- (Task 2) `refactor(video): VideoPlayerCard ...`
- (Task 3) `refactor(vision): VisionResultCard ...`
- (Task 4) `refactor(compare): CompareViewer ...`
- (Task 5) `refactor(compare): CompareAnalysisPanel ...`

---

## Task 7: master merge (사용자 명시 시)

**박제 (`feedback_test_first_merge_after.md`)**: 테스트 먼저 → 사용자 명시 요청 시에만 master merge. 자동 머지 X.

- [ ] **Step 7.1: 사용자가 "master 머지해" 명시할 때만 진행**

```bash
git checkout master
git pull origin master
git merge --no-ff feature/uniform-result-cards -m "Merge branch 'feature/uniform-result-cards' — 5 페이지 우패널 결과 카드 통일

5 commit:
- style(css): .ais-result-hero-plain 표준 추가 (Phase 1)
- refactor(video): VideoPlayerCard Filled 매트 className 전환 (Phase 2)
- refactor(vision): VisionResultCard plain 외곽 박스 추가 (Phase 3)
- refactor(compare): CompareViewer 매트 className 전환 (Phase 4.1)
- refactor(compare): CompareAnalysisPanel plain 흡수 + .ais-compare-analysis-card 제거 (Phase 4.2)

검증: pytest 474 / vitest 227 / tsc clean / lint clean.
시각 검증: 5 페이지 사용자 OK + Compare 좁음 fix 확인.

Spec: docs/superpowers/specs/2026-05-04-uniform-result-cards-design.md
Plan: docs/superpowers/plans/2026-05-04-uniform-result-cards.md
"
git push origin master
```

- [ ] **Step 7.2: MEMORY.md 갱신 (한 줄 인계)**

`C:\Users\pzen\.claude\projects\D--AI-Image-Studio\memory\MEMORY.md` 의 `## 🚧 최신` section 위에 새 entry 추가:

```markdown
## 🚧 최신 (2026-05-04 — 5 페이지 우패널 결과 카드 통일 · master `<merge-hash>` push 완료)
- **세션 인계**: spec `docs/superpowers/specs/2026-05-04-uniform-result-cards-design.md` + plan `docs/superpowers/plans/2026-05-04-uniform-result-cards.md`
- **5 commits** (브랜치 `feature/uniform-result-cards` → master merge `--no-ff`):
  - Phase 1: `.ais-result-hero-plain` 표준 추가
  - Phase 2: VideoPlayerCard Filled 매트 className 전환
  - Phase 3: VisionResultCard plain 외곽 박스 추가
  - Phase 4.1: CompareViewer 매트 className 전환 (좁음 fix 자동 해결)
  - Phase 4.2: CompareAnalysisPanel plain 흡수 + `.ais-compare-analysis-card` 제거
- **검증**: pytest 474 · vitest 227 (216→+11 신규) · tsc clean · lint clean · 5 페이지 시각 OK
- **표준**: 매트 (`.ais-result-hero` [+ `-edit`]) — Generate/Edit/Video/Compare-viewer / Plain (`.ais-result-hero-plain`) — Vision/Compare-analysis
```

`<merge-hash>` 는 실제 merge commit hash 로 교체.

---

## 성공 기준 체크리스트

- [ ] Compare 좁음 fix — 우패널 결과 영역이 다른 4 페이지와 동일한 폭 점유 (사용자 시각 OK)
- [ ] 시각 회귀 0 — Generate/Edit 변경 없음 / Video Filled 거의 동일 / Vision 외곽 박스 추가만 / Compare 좁음 fix 외 변경 없음
- [ ] 자동 회귀 0 — pytest 474 / vitest 227 / tsc clean / lint clean
- [ ] className 표준 일관성 — 5 페이지 결과 카드 영역 inline 박스 0건 (grep 검증)
- [ ] 회귀 7 항목 (spec §5) 모두 보존
- [ ] master merge 완료 + push 완료 + MEMORY.md 갱신
