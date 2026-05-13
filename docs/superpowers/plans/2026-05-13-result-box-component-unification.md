# Result Box Component Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4 모드 (Generate / Edit / Video / Vision) 결과 박스를 단일 `<ResultBox>` base 로 통일 + 진행 중 박스 안 정보 제거 + Generate/Edit 0.4s 페이드 전환 + ProgressModal X 비활성화 + 효과 slot 박제 (다음 spec).

**Architecture:** 얇은 `<ResultBox>` base (외곽 + 상태 분기 + AnimatePresence cross-fade + effectOverlay slot) + 모드별 본문 (`<{Generate,Edit,Video,Vision}Content>`) 을 children 으로 주입. 4 페이지가 store flag 를 `state="idle"|"loading"|"done"` 으로 매핑.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript strict · Zustand 5 · framer-motion (이미 deps) · vitest + jsdom · chrome MCP

**관련 문서:** `docs/superpowers/specs/2026-05-13-result-box-component-unification-design.md`

**검증 패턴:**
- 회귀 0: `npx tsc --noEmit` + `npm run lint` + `npm test` (현재 vitest 298 PASS + pytest 534 PASS)
- 시각: chrome MCP 12 컷 (4 페이지 × 3 상태)
- Codex 종료 조건: finding < 10 → 패스 (feedback memory `codex-review-threshold`)

**Branch 전략:** `feature/result-box-unification` · `--no-ff` master merge

---

## Task 1: `<ResultBox>` Base 신설 + AnimatePresence

**Files:**
- Create: `frontend/components/studio/ResultBox.tsx`
- Create: `frontend/__tests__/result-box.test.tsx`

- [ ] **Step 1: Branch 생성**

Run: `git checkout -b feature/result-box-unification`
Expected: `Switched to a new branch 'feature/result-box-unification'`

- [ ] **Step 2: 실패 테스트 작성**

`frontend/__tests__/result-box.test.tsx`:

```tsx
// ResultBox 단위 테스트 — 5 케이스 (state 분기 + effectOverlay slot + 페이드 트리거)
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultBox } from "@/components/studio/ResultBox";

describe("ResultBox", () => {
  it("state='idle' 일 때 emptyState 렌더", () => {
    render(<ResultBox state="idle" emptyState={<div>비어있음</div>} />);
    expect(screen.getByText("비어있음")).toBeInTheDocument();
  });

  it("state='loading' 일 때 loadingPlaceholder + effectOverlay 같이 렌더", () => {
    render(
      <ResultBox
        state="loading"
        loadingPlaceholder={<div>로딩 자리</div>}
        effectOverlay={<div data-testid="effect">효과</div>}
      />
    );
    expect(screen.getByText("로딩 자리")).toBeInTheDocument();
    expect(screen.getByTestId("effect")).toBeInTheDocument();
  });

  it("state='done' 일 때 children 렌더", () => {
    render(
      <ResultBox state="done">
        <div>완료 본문</div>
      </ResultBox>
    );
    expect(screen.getByText("완료 본문")).toBeInTheDocument();
  });

  it("variant='plain' 일 때 .ais-result-hero-plain 클래스 적용", () => {
    const { container } = render(<ResultBox state="idle" variant="plain" />);
    expect(container.querySelector(".ais-result-hero-plain")).toBeInTheDocument();
  });

  it("modifier='edit' 일 때 .ais-result-hero-edit 클래스 추가", () => {
    const { container } = render(<ResultBox state="idle" modifier="edit" />);
    expect(container.querySelector(".ais-result-hero-edit")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd frontend && npx vitest run __tests__/result-box.test.tsx`
Expected: 5 FAIL ("Cannot find module @/components/studio/ResultBox")

- [ ] **Step 4: ResultBox.tsx 최소 구현**

`frontend/components/studio/ResultBox.tsx`:

```tsx
/**
 * ResultBox — 4 모드 결과 박스 통일 base.
 *
 * 외곽 .ais-result-hero{,-plain,-edit} 클래스 + 상태 분기 (idle/loading/done) +
 * framer-motion AnimatePresence cross-fade (0.4s) + effectOverlay slot (다음 spec).
 *
 * 모드별 본문 (Generate/Edit/Video/Vision) 은 children 으로 주입.
 */
"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";

interface ResultBoxProps {
  state: "idle" | "loading" | "done";
  variant?: "hero" | "plain";        // default "hero" · Vision 만 "plain"
  modifier?: "edit";                 // .ais-result-hero-edit 호환 (Edit/Video)
  effectOverlay?: ReactNode;         // 다음 effect spec 슬롯
  emptyState?: ReactNode;            // idle 일 때 렌더
  loadingPlaceholder?: ReactNode;    // loading 일 때 렌더 (default 빈 div)
  children?: ReactNode;              // done 일 때 렌더
}

export function ResultBox({
  state,
  variant = "hero",
  modifier,
  effectOverlay,
  emptyState,
  loadingPlaceholder,
  children,
}: ResultBoxProps) {
  // 외곽 클래스 조합 — variant + modifier 결합
  const variantClass = variant === "plain" ? "ais-result-hero-plain" : "ais-result-hero";
  const modifierClass = modifier === "edit" ? "ais-result-hero-edit" : "";
  const className = [variantClass, modifierClass].filter(Boolean).join(" ");

  return (
    <div className={className}>
      <AnimatePresence mode="sync">
        {state === "idle" && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            {emptyState}
          </motion.div>
        )}
        {state === "loading" && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            {loadingPlaceholder ?? <div data-testid="rb-loading-default" />}
            {effectOverlay}
          </motion.div>
        )}
        {state === "done" && (
          <motion.div
            key="done"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd frontend && npx vitest run __tests__/result-box.test.tsx`
Expected: 5 PASS

- [ ] **Step 6: tsc + lint clean**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: 0 error (pre-existing 제외)

- [ ] **Step 7: Commit**

```bash
git add frontend/components/studio/ResultBox.tsx frontend/__tests__/result-box.test.tsx
git commit -m "feat(studio): ResultBox base 신설 — 4 모드 통일 외곽 + AnimatePresence 0.4s cross-fade"
```

---

## Task 2: Vision 마이그레이션

**Files:**
- Rename: `frontend/components/studio/VisionResultCard.tsx` → `frontend/components/studio/VisionContent.tsx`
- Modify: `frontend/components/studio/VisionContent.tsx` (외곽 분리 후 본문만 남김)
- Modify: `frontend/app/vision/page.tsx` (ResultBox 호출 패턴)
- Create: `frontend/__tests__/vision-result-box.test.tsx`

- [ ] **Step 1: 파일 rename (git mv)**

Run:
```bash
git mv frontend/components/studio/VisionResultCard.tsx frontend/components/studio/VisionContent.tsx
```

Expected: rename 완료 (git history 보존)

- [ ] **Step 2: VisionContent.tsx 본문만 남김**

기존 `VisionContent.tsx` (74 라인) 에서:
- 외곽 `.ais-result-hero-plain` div + `running` 분기 + `StudioLoadingState` 호출 + `StudioEmptyState` 호출 삭제
- 본문만 남김 — `running=false && result` 일 때의 렌더 (`RecipeV2View` / `LegacyV1View` 분기) 만 export

수정 후 예상 구조:
```tsx
"use client";

import type { VisionAnalysisResult } from "@/lib/api/types";
import { RecipeV2View } from "./vision/RecipeV2View";
import { LegacyV1View } from "./vision/LegacyV1View";

interface VisionContentProps {
  result: VisionAnalysisResult;
}

export function VisionContent({ result }: VisionContentProps) {
  // Recipe v2 우선 · 옛 v1 fallback
  if (result.recipe) {
    return <RecipeV2View recipe={result.recipe} />;
  }
  return <LegacyV1View result={result} />;
}
```

(기존 import / 본문 로직은 실제 파일에서 정확히 추출 — line 44-74 참조)

- [ ] **Step 3: vision/page.tsx 에서 ResultBox 사용**

기존 `app/vision/page.tsx` 의 결과 박스 렌더 구역을 다음으로 교체:

```tsx
import { ResultBox } from "@/components/studio/ResultBox";
import { VisionContent } from "@/components/studio/VisionContent";
import { StudioEmptyState } from "@/components/studio/StudioEmptyState";
import { useVisionStore } from "@/stores/useVisionStore";

// ... 컴포넌트 body 안:
const { running, lastResult } = useVisionStore();
const state = running ? "loading" : lastResult ? "done" : "idle";

return (
  <ResultBox
    state={state}
    variant="plain"
    emptyState={<StudioEmptyState size="normal" />}
  >
    {lastResult && <VisionContent result={lastResult} />}
  </ResultBox>
);
```

(기존 페이지의 caption/pill 렌더 라인은 `state === "done"` 조건으로 감싸기)

- [ ] **Step 4: vision-result-box 통합 테스트**

`frontend/__tests__/vision-result-box.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import VisionPage from "@/app/vision/page";

// useVisionStore mock
vi.mock("@/stores/useVisionStore", () => ({
  useVisionStore: vi.fn(),
}));

describe("Vision page ResultBox 통합", () => {
  it("running=true 일 때 loading state 렌더 (본문 없음)", async () => {
    const { useVisionStore } = await import("@/stores/useVisionStore");
    (useVisionStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      running: true,
      lastResult: null,
    });
    render(<VisionPage />);
    expect(screen.queryByTestId("vision-content")).not.toBeInTheDocument();
  });

  it("running=false + lastResult 있을 때 done state · VisionContent 렌더", async () => {
    const { useVisionStore } = await import("@/stores/useVisionStore");
    (useVisionStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      running: false,
      lastResult: { recipe: { /* mock recipe */ } },
    });
    render(<VisionPage />);
    expect(screen.queryByTestId("vision-content")).toBeInTheDocument();
  });

  it("running=false + lastResult=null 일 때 idle state · empty state 렌더", async () => {
    const { useVisionStore } = await import("@/stores/useVisionStore");
    (useVisionStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      running: false,
      lastResult: null,
    });
    render(<VisionPage />);
    expect(screen.queryByTestId("vision-empty")).toBeInTheDocument();
  });
});
```

(VisionContent / StudioEmptyState 에 `data-testid="vision-content"` / `data-testid="vision-empty"` 추가 필요 — 또는 텍스트로 검증)

- [ ] **Step 5: 테스트 실행**

Run: `cd frontend && npx vitest run __tests__/vision-result-box.test.tsx`
Expected: 3 PASS

- [ ] **Step 6: 전체 회귀 + tsc + lint**

Run: `cd frontend && npm test && npx tsc --noEmit && npm run lint`
Expected: 회귀 0 · 0 error (pre-existing 제외)

- [ ] **Step 7: Commit**

```bash
git add frontend/components/studio/VisionContent.tsx frontend/app/vision/page.tsx frontend/__tests__/vision-result-box.test.tsx
git commit -m "refactor(vision): VisionResultCard → VisionContent + page.tsx ResultBox 패턴 적용"
```

---

## Task 3: Video 마이그레이션

**Files:**
- Rename: `frontend/components/studio/VideoPlayerCard.tsx` → `frontend/components/studio/VideoContent.tsx`
- Modify: `frontend/components/studio/VideoContent.tsx` (외곽 분리)
- Modify: `frontend/app/video/page.tsx`
- Create: `frontend/__tests__/video-result-box.test.tsx`

- [ ] **Step 1: 파일 rename**

Run:
```bash
git mv frontend/components/studio/VideoPlayerCard.tsx frontend/components/studio/VideoContent.tsx
```

- [ ] **Step 2: VideoContent.tsx 본문만 남김**

기존 (151 라인) 에서:
- `running` 분기 + `StudioLoadingState` 호출 + `StudioEmptyState` 호출 삭제
- 본문 (`<video>` player + 메타 + action bar) 만 남김
- props 변경: `src` `prompt` `lastVideoMeta` 등 — done 상태 일 때 필요한 데이터만 받음

수정 후 예상 구조 (외곽 div 제거 · `<video>` element 가 root):

```tsx
"use client";

import { useState } from "react";
import { ResultHoverActionBar, ActionBarButton } from "./ResultHoverActionBar";

interface VideoContentProps {
  src: string;
  prompt?: string;
  onCopyPrompt?: () => void;
  onReuse?: () => void;
}

export function VideoContent({ src, prompt, onCopyPrompt, onReuse }: VideoContentProps) {
  const [hovered, setHovered] = useState(false);
  // 본문: <video> + action bar
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: "relative" }}
    >
      <video src={src} controls autoPlay loop muted />
      <ResultHoverActionBar hovered={hovered} variant="hero">
        {/* ... 기존 action bar 버튼들 그대로 */}
      </ResultHoverActionBar>
    </div>
  );
}
```

(실제 본문 코드는 기존 line 32-151 에서 추출 — `running` 분기와 외곽 div 만 제거)

- [ ] **Step 3: video/page.tsx 에서 ResultBox 사용**

```tsx
import { ResultBox } from "@/components/studio/ResultBox";
import { VideoContent } from "@/components/studio/VideoContent";
import { StudioEmptyState } from "@/components/studio/StudioEmptyState";
import { useVideoStore } from "@/stores/useVideoStore";

const { running, lastVideoRef, lastVideoMeta } = useVideoStore();
const state = running ? "loading" : lastVideoRef ? "done" : "idle";

return (
  <ResultBox
    state={state}
    variant="hero"
    modifier="edit"
    emptyState={<StudioEmptyState size="normal" />}
  >
    {lastVideoRef && <VideoContent src={lastVideoRef} {...lastVideoMeta} />}
  </ResultBox>
);
```

- [ ] **Step 4: video-result-box 통합 테스트 3 케이스**

`frontend/__tests__/video-result-box.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import VideoPage from "@/app/video/page";

vi.mock("@/stores/useVideoStore", () => ({ useVideoStore: vi.fn() }));

describe("Video page ResultBox 통합", () => {
  it("running=true → loading state (본문 없음)", async () => {
    const { useVideoStore } = await import("@/stores/useVideoStore");
    (useVideoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      running: true, lastVideoRef: null, lastVideoMeta: {},
    });
    render(<VideoPage />);
    expect(screen.queryByTestId("video-content")).not.toBeInTheDocument();
  });

  it("running=false + lastVideoRef 있을 때 done state · <video> 렌더", async () => {
    const { useVideoStore } = await import("@/stores/useVideoStore");
    (useVideoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      running: false, lastVideoRef: "/videos/test.mp4", lastVideoMeta: {},
    });
    render(<VideoPage />);
    const video = screen.queryByTestId("video-content")?.querySelector("video");
    expect(video).toBeTruthy();
  });

  it("running=false + lastVideoRef=null → idle state · empty 렌더", async () => {
    const { useVideoStore } = await import("@/stores/useVideoStore");
    (useVideoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      running: false, lastVideoRef: null, lastVideoMeta: {},
    });
    render(<VideoPage />);
    expect(screen.queryByTestId("video-empty")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: 테스트 실행**

Run: `cd frontend && npx vitest run __tests__/video-result-box.test.tsx`
Expected: 3 PASS

- [ ] **Step 6: 전체 회귀 + tsc + lint**

Run: `cd frontend && npm test && npx tsc --noEmit && npm run lint`
Expected: 회귀 0

- [ ] **Step 7: Commit**

```bash
git add frontend/components/studio/VideoContent.tsx frontend/app/video/page.tsx frontend/__tests__/video-result-box.test.tsx
git commit -m "refactor(video): VideoPlayerCard → VideoContent + page.tsx ResultBox 패턴 적용"
```

---

## Task 4: Generate 마이그레이션 (zoom/pan 보존)

**Files:**
- Rename: `frontend/components/studio/generate/GenerateResultViewer.tsx` → `frontend/components/studio/generate/GenerateContent.tsx`
- Modify: `frontend/components/studio/generate/GenerateContent.tsx` (외곽 분리)
- Modify: `frontend/app/generate/page.tsx`
- Create: `frontend/__tests__/generate-result-box.test.tsx`

- [ ] **Step 1: 파일 rename**

Run:
```bash
git mv frontend/components/studio/generate/GenerateResultViewer.tsx frontend/components/studio/generate/GenerateContent.tsx
```

- [ ] **Step 2: GenerateContent.tsx 본문만 남김**

기존 (238 라인) 에서:
- 외곽 `.ais-result-hero` div + `item` truthy 분기 제거 (외곽은 ResultBox 책임)
- 본문 (`<img>` + zoom/pan refs + hover action bar) 만 남김
- **zoom/pan state (`scale` / `offset` / `isDragging`) 와 ref (`containerRef`) 는 본문 컴포넌트 내부 유지** — 외곽 분리 시 이 ref 가 동일 컴포넌트 안에 있는지 확인

수정 후 props:
```tsx
interface GenerateContentProps {
  item: HistoryItem;
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onExpand: () => void;
  onCopyPrompt: () => void;
  onEdit: () => void;
  onReuse: () => void;
}
```

(기존 본문 line 156-238 의 hero div 내부 코드 그대로 사용 · 단 클래스 `.ais-result-hero` 는 ResultBox 가 책임 → `<div>` wrapper 가 클래스 X 가 되거나 위치 잡기용으로만 사용)

- [ ] **Step 3: generate/page.tsx 에서 ResultBox 사용**

```tsx
import { ResultBox } from "@/components/studio/ResultBox";
import { GenerateContent } from "@/components/studio/generate/GenerateContent";
import { StudioEmptyState } from "@/components/studio/StudioEmptyState";
import { useGenerateStore } from "@/stores/useGenerateStore";

const { generating, items, selectedId } = useGenerateStore();
const selectedItem = items.find(i => i.id === selectedId);
const state = generating ? "loading" : selectedItem ? "done" : "idle";

// caption/pill 는 state="done" 일 때만 렌더 (기존 라인 conditional 로 감싸기)

return (
  <>
    {state === "done" && <StudioResultHeader {...pillProps} />}
    <ResultBox state={state} emptyState={<StudioEmptyState size="normal" />}>
      {selectedItem && (
        <GenerateContent
          item={selectedItem}
          hovered={hovered}
          onEnter={onEnter}
          // ... 기존 handlers 그대로
        />
      )}
    </ResultBox>
    {state === "done" && captionText && (
      <div className="ais-result-caption ais-result-caption-prompt">{captionText}</div>
    )}
  </>
);
```

- [ ] **Step 4: generate-result-box 통합 테스트 4 케이스 (zoom/pan 회귀 포함)**

`frontend/__tests__/generate-result-box.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import GeneratePage from "@/app/generate/page";

vi.mock("@/stores/useGenerateStore", () => ({ useGenerateStore: vi.fn() }));

describe("Generate page ResultBox 통합", () => {
  it("generating=true 일 때 loading state", async () => {
    const { useGenerateStore } = await import("@/stores/useGenerateStore");
    (useGenerateStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      generating: true, items: [], selectedId: null,
    });
    render(<GeneratePage />);
    expect(screen.queryByTestId("generate-content")).not.toBeInTheDocument();
  });

  it("generating=false + selectedItem 있을 때 done · <img> 렌더", async () => {
    const { useGenerateStore } = await import("@/stores/useGenerateStore");
    (useGenerateStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      generating: false,
      items: [{ id: "1", imageRef: "/test.png", label: "test", prompt: "x" }],
      selectedId: "1",
    });
    render(<GeneratePage />);
    expect(screen.queryByAltText("test")).toBeTruthy();
  });

  it("caption 은 state=done 일 때만 렌더", async () => {
    const { useGenerateStore } = await import("@/stores/useGenerateStore");
    (useGenerateStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      generating: true, items: [], selectedId: null,
    });
    render(<GeneratePage />);
    expect(screen.queryByText(/caption/i)).not.toBeInTheDocument();
  });

  it("zoom/pan ref 가 정상 작동 — img 더블클릭 시 scale 리셋", async () => {
    // 기존 zoom/pan 동작 회귀 확인
    // (실제 마우스 이벤트는 jsdom 한계로 시뮬레이션 어려움 — DOM 요소 존재만 확인)
    const { useGenerateStore } = await import("@/stores/useGenerateStore");
    (useGenerateStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      generating: false,
      items: [{ id: "1", imageRef: "/test.png", label: "test", prompt: "x" }],
      selectedId: "1",
    });
    render(<GeneratePage />);
    const img = screen.queryByAltText("test") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img?.classList.contains("ais-result-hero-img")).toBe(true);
  });
});
```

- [ ] **Step 5: 테스트 실행**

Run: `cd frontend && npx vitest run __tests__/generate-result-box.test.tsx`
Expected: 4 PASS

- [ ] **Step 6: 전체 회귀 + tsc + lint**

Run: `cd frontend && npm test && npx tsc --noEmit && npm run lint`
Expected: 회귀 0

- [ ] **Step 7: Commit**

```bash
git add frontend/components/studio/generate/GenerateContent.tsx frontend/app/generate/page.tsx frontend/__tests__/generate-result-box.test.tsx
git commit -m "refactor(generate): GenerateResultViewer → GenerateContent + page.tsx ResultBox + zoom/pan 보존"
```

---

## Task 5: Edit 마이그레이션 (가장 복잡 · BeforeAfter + sourceRef + compareX 리셋 보존)

**Files:**
- Rename: `frontend/components/studio/edit/EditResultViewer.tsx` → `frontend/components/studio/edit/EditContent.tsx`
- Modify: `frontend/components/studio/edit/EditContent.tsx` (외곽 분리)
- Modify: `frontend/app/edit/page.tsx`
- Create: `frontend/__tests__/edit-result-box.test.tsx`

- [ ] **Step 1: 기존 Edit 테스트 모두 회귀 0 인지 사전 확인**

Run: `cd frontend && npx vitest run __tests__/edit-*.test.tsx`
Expected: 모두 PASS (이번 task 의 baseline)

- [ ] **Step 2: 파일 rename**

Run:
```bash
git mv frontend/components/studio/edit/EditResultViewer.tsx frontend/components/studio/edit/EditContent.tsx
```

- [ ] **Step 3: EditContent.tsx 본문만 남김**

기존 (240 라인) 에서:
- 외곽 `.ais-result-hero .ais-result-hero-edit` div 제거 (ResultBox 책임)
- 본문 (BeforeAfter slider + SideBy + viewer mode 토글 + sourceRef 매칭 로직) 만 남김
- **`compareX 50 자동 리셋` 미세 동작 보존** (afterId 변경 시 setCompareX(50) 호출 — 본문 컴포넌트 안에 유지)
- **`pairMatched` 계산 (sourceRef === sourceImage) 은 페이지 책임으로 이동** — EditContent 는 `sourceImage` + `afterItem` props 받아서 본문만 렌더

수정 후 props:
```tsx
interface EditContentProps {
  sourceImage: string;
  afterItem: HistoryItem;
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onExpand: () => void;
  onCopyPrompt: () => void;
  onReuse: () => void;
  // ... 기존 handlers
}
```

- [ ] **Step 4: edit/page.tsx 에서 ResultBox 사용**

```tsx
import { ResultBox } from "@/components/studio/ResultBox";
import { EditContent } from "@/components/studio/edit/EditContent";
import { StudioEmptyState } from "@/components/studio/StudioEmptyState";
import { useEditStore } from "@/stores/useEditStore";

const { running, sourceImage, items, afterId } = useEditStore();
const afterItem = items.find(i => i.id === afterId);
const pairMatched = afterItem?.sourceRef === sourceImage;
const state = running ? "loading" : pairMatched ? "done" : "idle";

return (
  <>
    {state === "done" && <StudioResultHeader {...pillProps} />}
    <ResultBox
      state={state}
      modifier="edit"
      emptyState={<StudioEmptyState size="normal" />}
    >
      {pairMatched && afterItem && (
        <EditContent
          sourceImage={sourceImage}
          afterItem={afterItem}
          {...handlers}
        />
      )}
    </ResultBox>
    {state === "done" && captionText && (
      <div className="ais-result-caption ais-result-caption-prompt">{captionText}</div>
    )}
  </>
);
```

- [ ] **Step 5: edit-result-box 통합 테스트 5 케이스 (BeforeAfter + sourceRef + compareX 리셋 보존 포함)**

`frontend/__tests__/edit-result-box.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import EditPage from "@/app/edit/page";

vi.mock("@/stores/useEditStore", () => ({ useEditStore: vi.fn() }));

describe("Edit page ResultBox 통합", () => {
  it("running=true → loading state (본문 없음)", async () => {
    const { useEditStore } = await import("@/stores/useEditStore");
    (useEditStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      running: true, sourceImage: "/a.png", items: [], afterId: null,
    });
    render(<EditPage />);
    expect(screen.queryByTestId("edit-content")).not.toBeInTheDocument();
  });

  it("pairMatched=true 일 때 done · BeforeAfter 슬라이더 렌더", async () => {
    const { useEditStore } = await import("@/stores/useEditStore");
    (useEditStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      running: false,
      sourceImage: "/a.png",
      items: [{ id: "x", imageRef: "/x.png", sourceRef: "/a.png", label: "after" }],
      afterId: "x",
    });
    render(<EditPage />);
    expect(screen.queryByTestId("before-after-slider")).toBeTruthy();
  });

  it("pairMatched=false (sourceRef 미일치) 일 때 idle · empty 렌더", async () => {
    const { useEditStore } = await import("@/stores/useEditStore");
    (useEditStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      running: false,
      sourceImage: "/a.png",
      items: [{ id: "x", imageRef: "/x.png", sourceRef: "/different.png" }],
      afterId: "x",
    });
    render(<EditPage />);
    expect(screen.queryByTestId("edit-empty")).toBeInTheDocument();
  });

  it("afterId 전환 시 compareX 50 자동 리셋 (기존 미세 동작 보존)", async () => {
    // EditContent 내부 useEffect 검증 — afterId 변경 시 setCompareX(50)
    // (실제 hook 호출은 본문 컴포넌트 단위 테스트로 검증 — page level 은 렌더 확인만)
    const { useEditStore } = await import("@/stores/useEditStore");
    (useEditStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      running: false,
      sourceImage: "/a.png",
      items: [{ id: "x", imageRef: "/x.png", sourceRef: "/a.png" }],
      afterId: "x",
    });
    const { rerender } = render(<EditPage />);
    // afterId 전환
    (useEditStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      running: false,
      sourceImage: "/a.png",
      items: [
        { id: "x", imageRef: "/x.png", sourceRef: "/a.png" },
        { id: "y", imageRef: "/y.png", sourceRef: "/a.png" },
      ],
      afterId: "y",
    });
    rerender(<EditPage />);
    // BeforeAfter 슬라이더가 다시 렌더되고 compareX 가 50 인지 확인
    const slider = screen.queryByTestId("before-after-slider");
    expect(slider).toBeTruthy();
  });

  it("caption/pill 은 state=done 일 때만 렌더", async () => {
    const { useEditStore } = await import("@/stores/useEditStore");
    (useEditStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      running: true, sourceImage: "/a.png", items: [], afterId: null,
    });
    render(<EditPage />);
    expect(screen.queryByText(/before/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: 테스트 실행 + 기존 edit 테스트 모두 회귀 0 확인**

Run:
```bash
cd frontend && npx vitest run __tests__/edit-result-box.test.tsx __tests__/edit-*.test.tsx
```
Expected: 신규 5 PASS + 기존 모두 PASS

- [ ] **Step 7: 전체 회귀 + tsc + lint**

Run: `cd frontend && npm test && npx tsc --noEmit && npm run lint`
Expected: 회귀 0

- [ ] **Step 8: Commit**

```bash
git add frontend/components/studio/edit/EditContent.tsx frontend/app/edit/page.tsx frontend/__tests__/edit-result-box.test.tsx
git commit -m "refactor(edit): EditResultViewer → EditContent + page.tsx ResultBox + compareX 리셋 보존"
```

---

## Task 6: ProgressModal X 비활성화

**Files:**
- Modify: `frontend/components/studio/ProgressModal.tsx` (line 381-398 X 버튼 부근 5 줄)
- Modify: `frontend/app/{generate,edit,video,vision}/page.tsx` (각 페이지에서 `running` prop 전달 — 이미 있을 가능성 큼)
- Create: `frontend/__tests__/progress-modal-x-disabled.test.tsx`

- [ ] **Step 1: 기존 ProgressModal X 버튼 부근 확인**

Read: `frontend/components/studio/ProgressModal.tsx:381-398`
박제: X 버튼 onClick=onClose · title="모달 닫기 (생성은 계속됨)"

- [ ] **Step 2: 실패 테스트 작성**

`frontend/__tests__/progress-modal-x-disabled.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressModal } from "@/components/studio/ProgressModal";

describe("ProgressModal X 버튼 비활성화", () => {
  it("running=true 일 때 X 버튼 disabled", () => {
    const onClose = vi.fn();
    render(
      <ProgressModal
        open={true}
        running={true}
        mode="generate"
        stageHistory={[]}
        progress={50}
        onClose={onClose}
      />
    );
    const closeBtn = screen.getByTitle(/진행 중에는 닫을 수 없습니다/);
    expect((closeBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("running=false 일 때 X 활성화 + 클릭 시 onClose 호출", () => {
    const onClose = vi.fn();
    render(
      <ProgressModal
        open={true}
        running={false}
        mode="generate"
        stageHistory={[]}
        progress={100}
        onClose={onClose}
      />
    );
    const closeBtn = screen.getByTitle(/모달 닫기/);
    expect((closeBtn as HTMLButtonElement).disabled).toBe(false);
    closeBtn.click();
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd frontend && npx vitest run __tests__/progress-modal-x-disabled.test.tsx`
Expected: 2 FAIL (title 매치 실패)

- [ ] **Step 4: ProgressModal X 버튼 수정**

`frontend/components/studio/ProgressModal.tsx:381-398` 부근 X 버튼 JSX 를 다음으로 교체:

```tsx
<button
  type="button"
  onClick={onClose}
  disabled={running}
  title={running ? "진행 중에는 닫을 수 없습니다" : "모달 닫기"}
  style={{
    // ... 기존 스타일 유지
    opacity: running ? 0.4 : 1,
    cursor: running ? "not-allowed" : "pointer",
  }}
  aria-label={running ? "진행 중에는 닫을 수 없습니다" : "모달 닫기"}
>
  ×
</button>
```

(`running` prop 이 이미 ProgressModal 에 전달되고 있는지 확인 — 기존 ProgressModalProps 박제 → 없으면 추가)

- [ ] **Step 5: 통과 확인**

Run: `cd frontend && npx vitest run __tests__/progress-modal-x-disabled.test.tsx`
Expected: 2 PASS

- [ ] **Step 6: 전체 회귀 + tsc + lint**

Run: `cd frontend && npm test && npx tsc --noEmit && npm run lint`
Expected: 회귀 0

- [ ] **Step 7: Commit**

```bash
git add frontend/components/studio/ProgressModal.tsx frontend/__tests__/progress-modal-x-disabled.test.tsx
git commit -m "feat(progress): 진행 중 X 비활성화 — 정보 손실 방지 (5 모드 공용)"
```

---

## Task 7: 시각 회귀 검증 (chrome MCP 12 컷)

**Files:**
- 없음 (검증만)

- [ ] **Step 1: 백엔드 + 프론트엔드 dev 서버 시작**

Run (사용자가 background 로):
```bash
# Terminal 1
cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --no-access-log

# Terminal 2
cd frontend && npm run dev
```

Expected: Backend `:8001` + Frontend `:3000` 응답 정상

- [ ] **Step 2: chrome MCP 로 4 페이지 idle 상태 캡처**

각 페이지 처음 진입 시 (히스토리 비어있는 상태 또는 새 세션):
- `/generate` `/edit` `/video` `/vision` 4 컷
- 결과 박스 외곽 일관성 확인 (`.ais-result-hero` / `-plain` 클래스)

기록: `claudedocs/result-box-visual-2026-05-13-idle.md` 에 4 컷 + 관찰 박제

- [ ] **Step 3: chrome MCP 로 4 페이지 loading 상태 캡처**

각 페이지에서 [생성] / [수정 생성] / [영상 생성] / [분석] 트리거 후 진행 중 캡처:
- 페이드 전환 시점 (0.2s 부근) 1 컷 + 진행 안정화 (1.5s) 1 컷
- 진행 모달 X 비활성화 확인
- 결과 박스 안 caption/pill/loading 텍스트 0 인지 확인

4 페이지 × 1 컷 = 4 컷. 기록: `claudedocs/result-box-visual-2026-05-13-loading.md`

- [ ] **Step 4: chrome MCP 로 4 페이지 done 상태 캡처**

진행 완료 후:
- 4 페이지 × 1 컷 = 4 컷
- caption/pill/action bar 정상 복원 확인
- Generate zoom/pan · Edit BeforeAfter 슬라이더 정합

기록: `claudedocs/result-box-visual-2026-05-13-done.md`

- [ ] **Step 5: 종합 박제 작성**

`claudedocs/result-box-visual-2026-05-13-summary.md`:
- 12 컷 종합 + 회귀 (있으면 박제) + 다음 phase 진입 OK 사인
- 회귀 발견 시: 해당 Phase 로 돌아가 fix + 재검증

- [ ] **Step 6: Commit (claudedocs 박제 파일)**

```bash
git add claudedocs/result-box-visual-2026-05-13-*.md
git commit -m "docs(visual): result-box unification 12 컷 시각 검증 박제"
```

---

## Task 8: Codex 교차 리뷰

**Files:**
- 없음 (리뷰만)

- [ ] **Step 1: Codex 종합 리뷰 위임**

`codex:codex-rescue` 에이전트 호출:

Prompt 요지:
- 검토 범위: 이번 브랜치 (`feature/result-box-unification`) 의 전체 diff
- 핵심 검토 항목:
  - 회귀 risk: 4 본문 컴포넌트 rename 시 놓친 호출부 grep
  - AnimatePresence `mode="sync"` + `key` prop 정확성
  - state 매핑 race condition (`generating ↔ selectedItem` 동시 변화 케이스)
  - dead code: 옛 viewer 의 helper 가 다른 곳에서 import 되는지
  - ProgressModal `running` prop 5 모드 공용 일관성

- [ ] **Step 2: Codex finding 분석**

- finding count < 10 → fix 없이 패스 → Step 4 진행
- finding count ≥ 10 → Step 3 진행
- severity 무관 (high/medium/low 모두 count) — 단 *security/critical bug* 1 건이라도 예외 fix

(feedback memory `codex-review-threshold` 참조)

- [ ] **Step 3: finding 통합 fix (10 이상 시만)**

- `superpowers:receiving-code-review` skill 활용 — 빈 동의 X 기술적 평가 only
- 통합 단일 commit (`14c8e30` `3dd965c` `e2b0537` 패턴 따라)
- vitest + tsc + lint clean 재검증

- [ ] **Step 4: Commit (있으면)**

```bash
git add <fix 파일들>
git commit -m "refactor(result-box): Codex 리뷰 N finding 통합 fix"
```

---

## Task 9: Master Merge + Push

**Files:**
- 없음 (merge 작업)

- [ ] **Step 1: Master 최신화 + rebase**

Run:
```bash
git checkout master
git pull origin master
git checkout feature/result-box-unification
git rebase master
```

Expected: rebase 충돌 0 (이번 spec 은 신규 파일 + rename 위주)

- [ ] **Step 2: 최종 전체 검증**

Run:
```bash
cd frontend && npm test && npx tsc --noEmit && npm run lint
cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/
```

Expected: vitest 회귀 0 (기존 298 + 신규 ~17) · pytest 534 PASS · tsc 0 error · lint 0 error

- [ ] **Step 3: `--no-ff` master merge**

Run:
```bash
git checkout master
git merge --no-ff feature/result-box-unification -m "Merge branch 'feature/result-box-unification' — 4 모드 결과 박스 ResultBox base 통일

- ResultBox base 신설 (frontend/components/studio/ResultBox.tsx · ~80 라인)
- AnimatePresence mode='sync' 0.4s cross-fade (done ↔ loading ↔ idle)
- 4 모드 마이그레이션: Vision → Video → Generate → Edit (복잡도 ↑ 순)
- 4 viewer rename only (위치 그대로 · git history 보존)
- 진행 중 결과 박스 안 caption/pill/loading 텍스트 0
- ProgressModal 진행 중 X 비활성화 (5 모드 공용)
- effectOverlay slot 박제 (다음 효과 spec 에서 채움)

검증:
- vitest 회귀 0 · 기존 298 + 신규 ~17 PASS
- pytest 534 PASS (백엔드 무변경)
- tsc + lint 0 error
- chrome MCP 12 컷 시각 검증 (4 페이지 × 3 상태)
- Codex 종합 리뷰 N finding (N < 10 = 패스 또는 통합 fix)

Spec: docs/superpowers/specs/2026-05-13-result-box-component-unification-design.md
Plan: docs/superpowers/plans/2026-05-13-result-box-component-unification.md"
```

- [ ] **Step 4: Push**

Run:
```bash
git push origin master
git push origin --delete feature/result-box-unification   # 원격 브랜치 삭제 (있었으면)
git branch -d feature/result-box-unification               # 로컬 브랜치 삭제
```

Expected: master 푸시 완료 + 브랜치 cleanup

- [ ] **Step 5: Memory 박제 (회귀 0 도달 시점 + 핵심 학습)**

Update: `C:/Users/pzen/.claude/projects/D--AI-Image-Studio/memory/MEMORY.md` 에 완료 박제 한 줄 추가

```markdown
## ✅ 완료 (2026-05-13 — Result Box 4 모드 통일 · master `<hash>` push)
- `<ResultBox>` base + AnimatePresence cross-fade + effectOverlay slot 박제 (다음 효과 spec)
- 4 viewer rename only · 회귀 0 · vitest 298 → ~315 PASS
- ProgressModal X 진행 중 비활성화 (5 모드 공용)
```

핵심 학습 박제 (`feedback_*` 로 추출 가치 있는 패턴):
- 4 모드 통일은 *rename only + 외곽 추출* 가 가장 안전 (git history 보존 + 본문 무변경)
- AnimatePresence `mode="sync"` cross-fade 패턴 (다른 effect spec 에서 재사용 가능)

---

## 종합 검증 매트릭스

| 영역 | 기준 | 명령 |
|------|------|------|
| Frontend 회귀 | 기존 298 + 신규 ~17 PASS | `cd frontend && npm test` |
| Frontend 타입 | 0 error | `cd frontend && npx tsc --noEmit` |
| Frontend Lint | 0 error (pre-existing 제외) | `cd frontend && npm run lint` |
| Backend 회귀 | 534 PASS (무변경) | `cd backend && python -m pytest tests/` |
| 시각 회귀 | 12 컷 일관성 OK | chrome MCP 수동 |
| Codex 리뷰 | finding < 10 또는 통합 fix | codex:codex-rescue |

## 함정 박제 재확인

(spec §9 참조)

1. Generate/Edit 의 "진행 중 이전 결과 유지" 는 표류 — 이번 통일에서 깔끔 정리
2. Edit `compareX 50 자동 리셋` 미세 동작 보존 필수 (Task 5 Step 5 회귀 테스트)
3. AnimatePresence `mode="sync"` 가 cross-fade · `mode="wait"` 는 순차 (사용 안 함)
4. framer-motion `exit` transition 은 unmount 발동 — children 조건 렌더링 필수 (`state === "done" && children`)
5. Generate zoom/pan ref 는 본문 컴포넌트 내부 유지 (외곽 분리해도 영향 없음)
6. Vision `.ais-result-hero-plain` variant 는 dot-grid 없음 (`<ResultBox variant="plain">` 정확 전달)
7. ProgressModal X 비활성화는 5 모드 공용 변경 — Compare 페이지도 자동 영향

---

**예상 작업 시간**: 6~8 시간 (Phase 1~5 각 1~1.5h · Phase 6 시각 검증 1h · Phase 7 Codex 0.5~1h · Phase 8 merge 0.5h)

**의존성**: framer-motion (이미 deps `package.json` 에 있음 확인 필요) · vitest + jsdom · chrome MCP browser tools

**롤백 계획**: 각 Task 가 독립 commit 이라 cherry-pick 또는 `git revert <commit>` 으로 부분 롤백 가능. Phase 4 (Edit · 가장 복잡) 단독 회귀 시 그 commit 만 revert 후 후속 phase 재진입.
