# Video 큰 사이즈 경고 모달 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 영상 생성 모드 (`/video`) 에서 출력 W×H 가 임계 (W or H ≥ 1280, 또는 W&H 둘 다 ≥ 1000) 충족 시 Render 버튼 클릭 후 한 번 더 확인하는 경고 모달 추가. `[취소]` 누르면 좌측 슬라이더로 사이즈 직접 변경, `[그대로 진행]` 누르면 평소 generate 흐름.

**Architecture:** `frontend/lib/video-size.ts` 순수 util 신규 (임계 상수 + `shouldWarnVideoSize` + `simplifyRatio` 이동) + `VideoSizeWarnModal` 컴포넌트 신규 (`UpgradeConfirmModal.tsx` 패턴 차용) + `VideoLeftPanel` 의 `expected` 를 `useMemo` 단일 진실원으로 끌어올려 `VideoResolutionSlider` 와 모달 둘 다 같은 prop 으로 받음. `useVideoPipeline` 무변경.

**Tech Stack:** React 19 · Next.js 16 App Router · TypeScript strict · vitest + @testing-library/react · jsdom · Tailwind v4 + CSS vars

**Spec 참조:** `docs/superpowers/specs/2026-05-04-video-size-warn-modal-design.md` (v1.4)

---

## File Structure

| 액션 | 파일 | 책임 |
|------|------|------|
| 🆕 Create | `frontend/lib/video-size.ts` | 임계 상수 + `shouldWarnVideoSize` + `simplifyRatio` (순수 함수만 · store 결합 X) |
| 🆕 Create | `frontend/components/studio/video/VideoSizeWarnModal.tsx` | 경고 모달 컴포넌트 (Props · ESC + overlay 핸들러 + dialog shell) |
| 🆕 Create | `frontend/__tests__/lib-video-size.test.ts` | `shouldWarnVideoSize` + `simplifyRatio` 단위 테스트 |
| 🆕 Create | `frontend/__tests__/video-size-warn-modal.test.tsx` | 모달 컴포넌트 시나리오 테스트 |
| 🆕 Create | `frontend/__tests__/video-size-warn-integration.test.tsx` | `VideoLeftPanel` CTA 분기 통합 테스트 |
| ✏️ Modify | `frontend/components/studio/video/VideoLeftPanel.tsx` | `expected` `useMemo` 끌어올림 + `handleCtaClick`/`handleConfirmWarn`/`handleCancelWarn` 추가 + `VideoResolutionSlider` prop 시그니처 변경 (자체 계산 제거) + 모달 마운트 + 옛 `simplifyRatio` 함수 제거 + `@/lib/video-size` import |

---

## Task 1: lib/video-size.ts (TDD · RED → GREEN → COMMIT)

**Files:**
- Create: `frontend/lib/video-size.ts`
- Test: `frontend/__tests__/lib-video-size.test.ts`

### Step 1.1: 테스트 작성 (RED)

- [ ] Create `frontend/__tests__/lib-video-size.test.ts`:

```ts
/**
 * lib/video-size — 영상 출력 사이즈 경고 임계 + 비율 헬퍼 단위 테스트.
 * spec: docs/superpowers/specs/2026-05-04-video-size-warn-modal-design.md §6.1.1, §6.1.2
 */

import { describe, expect, it } from "vitest";

import {
  VIDEO_WARN_BOTH_EDGE,
  VIDEO_WARN_LONGER_EDGE,
  shouldWarnVideoSize,
  simplifyRatio,
} from "@/lib/video-size";

describe("VIDEO_WARN_* 상수", () => {
  it("임계값이 spec 결정과 일치", () => {
    expect(VIDEO_WARN_LONGER_EDGE).toBe(1280);
    expect(VIDEO_WARN_BOTH_EDGE).toBe(1000);
  });
});

describe("shouldWarnVideoSize", () => {
  it("832×480 (base) → false", () => {
    expect(shouldWarnVideoSize(832, 480)).toBe(false);
  });

  it("1024×1024 (둘 다 ≥ 1000) → true", () => {
    expect(shouldWarnVideoSize(1024, 1024)).toBe(true);
  });

  it("999×999 (둘 다 ≥ 1000 경계 미달) → false", () => {
    expect(shouldWarnVideoSize(999, 999)).toBe(false);
  });

  it("1000×1000 (둘 다 ≥ 1000 경계) → true", () => {
    expect(shouldWarnVideoSize(1000, 1000)).toBe(true);
  });

  it("1280×720 (W ≥ 1280) → true", () => {
    expect(shouldWarnVideoSize(1280, 720)).toBe(true);
  });

  it("720×1280 (H ≥ 1280) → true", () => {
    expect(shouldWarnVideoSize(720, 1280)).toBe(true);
  });

  it("1279×999 (둘 임계 미달) → false", () => {
    expect(shouldWarnVideoSize(1279, 999)).toBe(false);
  });

  it("1280×500 (W = 1280 경계) → true", () => {
    expect(shouldWarnVideoSize(1280, 500)).toBe(true);
  });

  it("가드: 0×0 (소스 미선택) → false", () => {
    expect(shouldWarnVideoSize(0, 0)).toBe(false);
  });

  it("가드: 음수 입력 → false", () => {
    expect(shouldWarnVideoSize(-100, 500)).toBe(false);
  });

  it("가드: NaN 입력 → false", () => {
    expect(shouldWarnVideoSize(Number.NaN, 720)).toBe(false);
  });

  it("가드: Infinity 입력 → false", () => {
    expect(shouldWarnVideoSize(Number.POSITIVE_INFINITY, 720)).toBe(false);
  });
});

describe("simplifyRatio", () => {
  it("1920×1080 → 16:9", () => {
    expect(simplifyRatio(1920, 1080)).toBe("16:9");
  });

  it("1080×1920 → 9:16", () => {
    expect(simplifyRatio(1080, 1920)).toBe("9:16");
  });

  it("1024×1024 → 1:1", () => {
    expect(simplifyRatio(1024, 1024)).toBe("1:1");
  });

  it("832×480 → 26:15 (비표준 GCD)", () => {
    expect(simplifyRatio(832, 480)).toBe("26:15");
  });

  it("가드: 0×0 → '-'", () => {
    expect(simplifyRatio(0, 0)).toBe("-");
  });

  it("가드: 한쪽 0 → '-'", () => {
    expect(simplifyRatio(1024, 0)).toBe("-");
  });

  it("가드: 음수 → '-'", () => {
    expect(simplifyRatio(-100, 500)).toBe("-");
  });

  it("가드: NaN → '-'", () => {
    expect(simplifyRatio(Number.NaN, 720)).toBe("-");
  });

  it("가드: Infinity → '-'", () => {
    expect(simplifyRatio(Number.POSITIVE_INFINITY, 720)).toBe("-");
  });

  it("소수 입력: 1920.4×1080.4 → 16:9 (Math.round 둘 다 내림)", () => {
    expect(simplifyRatio(1920.4, 1080.4)).toBe("16:9");
  });

  it("2차 가드: 0.4×0.4 → '-' (round 후 0×0)", () => {
    expect(simplifyRatio(0.4, 0.4)).toBe("-");
  });

  it("2차 가드: 0.4×1080 → '-' (round 후 한쪽 0)", () => {
    expect(simplifyRatio(0.4, 1080)).toBe("-");
  });
});
```

### Step 1.2: 테스트 실행 fail 확인

- [ ] Run: `cd frontend && npx vitest run __tests__/lib-video-size.test.ts`
- [ ] Expected: FAIL with `Failed to resolve import "@/lib/video-size"`

### Step 1.3: lib 구현 (GREEN)

- [ ] Create `frontend/lib/video-size.ts`:

```ts
/**
 * 영상 출력 사이즈 경고 임계 + 공용 비율 유틸.
 *
 * spec: docs/superpowers/specs/2026-05-04-video-size-warn-modal-design.md (v1.4)
 *
 * store/component 어느 쪽에도 결합되지 않은 순수 함수로 유지 — 테스트 시 mock 불필요.
 * 추후 Edit/Generate 모드도 같은 임계 정책을 쓰면 그대로 재사용 가능.
 */

/** 한 변이라도 이 값 이상이면 경고 모달 트리거 (W or H 단일 임계). */
export const VIDEO_WARN_LONGER_EDGE = 1280;

/** 가로/세로 *둘 다* 이 값 이상이면 경고 모달 트리거 (양방 결합 임계). */
export const VIDEO_WARN_BOTH_EDGE = 1000;

/**
 * 출력 W×H 가 경고 임계를 충족하는지.
 *
 * 가드:
 *  - NaN / Infinity → false (계산 꼬임 안전망)
 *  - ≤ 0 → false (소스 미선택 시 expected = {0, 0} 차단)
 */
export function shouldWarnVideoSize(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;

  return (
    width >= VIDEO_WARN_LONGER_EDGE ||
    height >= VIDEO_WARN_LONGER_EDGE ||
    (width >= VIDEO_WARN_BOTH_EDGE && height >= VIDEO_WARN_BOTH_EDGE)
  );
}

/**
 * 정수 비율 근사 — "16:9" / "3:4" 등.
 *
 * 가드 (2-layer):
 *  - 1차: NaN / Infinity / ≤ 0 → "-" 반환
 *  - 소수 입력 정수 스냅: Math.round 적용 후 GCD
 *  - 2차: round 결과 ≤ 0 → "-" 반환 (예: 0.4×0.4 → 0×0 race 방지)
 */
export function simplifyRatio(w: number, h: number): string {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return "-";
  }

  const wi = Math.round(w);
  const hi = Math.round(h);
  if (wi <= 0 || hi <= 0) return "-";

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(wi, hi);
  return `${wi / g}:${hi / g}`;
}
```

### Step 1.4: 테스트 실행 pass 확인

- [ ] Run: `cd frontend && npx vitest run __tests__/lib-video-size.test.ts`
- [ ] Expected: PASS — 23 tests (1 상수 + 12 shouldWarn + 12 simplify, 가드 케이스 포함)

### Step 1.5: Commit

```powershell
git add frontend/lib/video-size.ts frontend/__tests__/lib-video-size.test.ts
git commit -m "feat(video): 사이즈 경고 임계 util 추가 - shouldWarnVideoSize + simplifyRatio"
```

---

## Task 2: VideoSizeWarnModal 컴포넌트 (TDD · RED → GREEN → COMMIT)

**Files:**
- Create: `frontend/components/studio/video/VideoSizeWarnModal.tsx`
- Test: `frontend/__tests__/video-size-warn-modal.test.tsx`

**참조 패턴:** `frontend/components/studio/UpgradeConfirmModal.tsx` (dialog shell · ESC effect · primary/secondary btn 토큰)

### Step 2.1: 테스트 작성 (RED)

- [ ] Create `frontend/__tests__/video-size-warn-modal.test.tsx`:

```tsx
/**
 * VideoSizeWarnModal — 컴포넌트 시나리오 테스트.
 * spec: §6.1.3
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import VideoSizeWarnModal from "@/components/studio/video/VideoSizeWarnModal";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VideoSizeWarnModal", () => {
  it("open=false 면 DOM 미렌더", () => {
    const { container } = render(
      <VideoSizeWarnModal
        open={false}
        width={1536}
        height={864}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("open=true 마운트 시 dialog role + 타이틀 + 본문 + 두 버튼 노출", () => {
    render(
      <VideoSizeWarnModal
        open
        width={1536}
        height={864}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("큰 사이즈로 생성할까요?")).toBeTruthy();
    expect(
      screen.getByText(/현재 컴퓨터 제원에서는 생성 시간이 오래 걸리거나/),
    ).toBeTruthy();
    expect(screen.getByText(/1536×864/)).toBeTruthy();
    expect(screen.getByText("취소")).toBeTruthy();
    expect(screen.getByText("그대로 진행")).toBeTruthy();
  });

  it("[취소] 클릭 → onCancel 호출, onConfirm 미호출", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <VideoSizeWarnModal
        open
        width={1280}
        height={720}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText("취소"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("[그대로 진행] 클릭 → onConfirm 호출, onCancel 미호출", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <VideoSizeWarnModal
        open
        width={1280}
        height={720}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText("그대로 진행"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("ESC keydown → onCancel 호출", () => {
    const onCancel = vi.fn();
    render(
      <VideoSizeWarnModal
        open
        width={1280}
        height={720}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Overlay (dialog 자체) 클릭 → onCancel 호출", () => {
    const onCancel = vi.fn();
    render(
      <VideoSizeWarnModal
        open
        width={1280}
        height={720}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    // overlay 는 role="dialog" 의 root element. 자체 클릭만 닫힘 (currentTarget 체크).
    fireEvent.click(screen.getByRole("dialog"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("unmount 시 keydown listener 제거 (cleanup)", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(
      <VideoSizeWarnModal
        open
        width={1280}
        height={720}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("open=true → open=false 전환 시 cleanup 호출", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { rerender } = render(
      <VideoSizeWarnModal
        open
        width={1280}
        height={720}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    rerender(
      <VideoSizeWarnModal
        open={false}
        width={1280}
        height={720}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });
});
```

### Step 2.2: 테스트 실행 fail 확인

- [ ] Run: `cd frontend && npx vitest run __tests__/video-size-warn-modal.test.tsx`
- [ ] Expected: FAIL with `Failed to resolve import "@/components/studio/video/VideoSizeWarnModal"`

### Step 2.3: 모달 컴포넌트 구현 (GREEN)

- [ ] Create `frontend/components/studio/video/VideoSizeWarnModal.tsx`:

```tsx
/**
 * VideoSizeWarnModal - 영상 출력 사이즈가 임계 (W or H ≥ 1280, 또는 W&H 둘 다 ≥ 1000) 충족 시
 * Render 클릭 후 사용자에게 한 번 더 확인을 받는 경고 모달.
 *
 * spec: docs/superpowers/specs/2026-05-04-video-size-warn-modal-design.md (v1.4)
 *
 * VideoLeftPanel 의 handleCtaClick 에서:
 *   1. shouldWarnVideoSize(expected.W, expected.H) 충족 시 open=true
 *   2. 사용자가 [그대로 진행] 누르면 → setWarnOpen(false) → onGenerate()
 *   3. [취소] / ESC / overlay 클릭 → setWarnOpen(false) (생성 중단, 사용자가 좌측 슬라이더로 변경)
 *
 * shell 패턴: UpgradeConfirmModal.tsx 동일 (dialog role + zIndex 65 + design tokens).
 */

"use client";

import { useEffect } from "react";

import Icon from "@/components/ui/Icon";
import { simplifyRatio } from "@/lib/video-size";

interface Props {
  open: boolean;
  /** 출력 예상 가로 (px) — VideoLeftPanel 의 expected.width 가 단일 진실원. */
  width: number;
  /** 출력 예상 세로 (px) — VideoLeftPanel 의 expected.height. */
  height: number;
  /** [취소] / ESC / overlay 클릭. */
  onCancel: () => void;
  /** [그대로 진행]. */
  onConfirm: () => void;
}

export default function VideoSizeWarnModal({
  open,
  width,
  height,
  onCancel,
  onConfirm,
}: Props) {
  // ESC = cancel. open=false 시 listener 미등록 + open 변경/unmount 시 cleanup (UpgradeConfirmModal:77-84 패턴).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const ratio = simplifyRatio(width, height);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="영상 사이즈 확인"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 65,
        background: "rgba(23, 20, 14, 0.42)",
        display: "grid",
        placeItems: "center",
        animation: "fade-in .18s ease",
        padding: 20,
      }}
      // overlay 클릭만 닫힘 (모달 내부 클릭은 가로채지 않게 currentTarget 체크).
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <section
        style={{
          background: "var(--bg)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--line)",
          width: "min(440px, 100%)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <header
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
            }}
          >
            <Icon name="alert" size={14} />
            <h2
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: 0,
              }}
            >
              큰 사이즈로 생성할까요?
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            style={{
              all: "unset",
              cursor: "pointer",
              width: 28,
              height: 28,
              borderRadius: "var(--radius-sm)",
              display: "grid",
              placeItems: "center",
              color: "var(--ink-3)",
            }}
            title="취소 (ESC)"
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        {/* Body */}
        <div
          style={{
            padding: "16px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.6,
            }}
          >
            현재 컴퓨터 제원에서는 생성 시간이 오래 걸리거나 중간에 중단될 수
            있어요.
          </p>
          <div
            style={{
              padding: "10px 12px",
              background: "var(--bg-2)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-sm)",
              fontSize: 12.5,
              lineHeight: 1.55,
              color: "var(--ink-2)",
            }}
          >
            출력{" "}
            <span
              className="mono"
              style={{ color: "var(--accent-ink)", fontWeight: 600 }}
            >
              {width}×{height}
            </span>{" "}
            <span style={{ color: "var(--ink-4)" }}>· {ratio}</span>
          </div>
        </div>

        {/* Footer */}
        <footer
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            background: "var(--bg-2)",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              all: "unset",
              padding: "8px 14px",
              borderRadius: "var(--radius-sm)",
              background: "var(--surface)",
              color: "var(--ink-2)",
              border: "1px solid var(--line)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              all: "unset",
              padding: "8px 16px",
              borderRadius: "var(--radius-sm)",
              background: "var(--accent)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 0,
              boxShadow: "0 2px 8px rgba(74,158,255,.28)",
              cursor: "pointer",
            }}
          >
            그대로 진행
          </button>
        </footer>
      </section>
    </div>
  );
}
```

> **note**: `Icon name="alert"` 가 존재하지 않으면 `name="warning"` 또는 `name="info"` 로 fallback. 구현 시 `frontend/components/ui/Icon.tsx` 의 enum 확인.

### Step 2.4: 테스트 실행 pass 확인

- [ ] Run: `cd frontend && npx vitest run __tests__/video-size-warn-modal.test.tsx`
- [ ] Expected: PASS — 8 tests
- [ ] 만약 `Icon name="alert"` 가 enum 에 없어 컴파일 에러: `Icon` 컴포넌트의 name union 확인 후 존재하는 값으로 교체 (warning / info / x 등).

### Step 2.5: Commit

```powershell
git add frontend/components/studio/video/VideoSizeWarnModal.tsx frontend/__tests__/video-size-warn-modal.test.tsx
git commit -m "feat(video): VideoSizeWarnModal 컴포넌트 추가 - 큰 사이즈 진행 확인 모달"
```

---

## Task 3: VideoLeftPanel 통합 (expected 끌어올림 + CTA 분기)

**Files:**
- Modify: `frontend/components/studio/video/VideoLeftPanel.tsx`
- Test: `frontend/__tests__/video-size-warn-integration.test.tsx`

### Step 3.1: 통합 테스트 작성 (RED)

- [ ] Create `frontend/__tests__/video-size-warn-integration.test.tsx`:

```tsx
/**
 * VideoLeftPanel - 큰 사이즈 경고 모달 CTA 분기 통합 테스트.
 * spec: §6.1.4
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";

import VideoLeftPanel from "@/components/studio/video/VideoLeftPanel";
import { useVideoStore } from "@/stores/useVideoStore";

/** 테스트마다 useVideoStore 초기화. */
function resetStore(): void {
  const s = useVideoStore.getState();
  // 입력 reset
  s.setSource(null);
  s.setPrompt("");
  s.setLongerEdge(832);
  s.setLightning(true);
  s.setAdult(false);
  s.setSkipUpgrade(false);
  // 실행 상태 reset
  s.resetPipeline();
  s.setRunning(false);
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  resetStore();
});

/** 임계 미만 (832×480) source 세팅. */
function setSmallSource(): void {
  useVideoStore.getState().setSource("data:image/png;base64,xx", "test", 832, 480);
  useVideoStore.getState().setPrompt("느린 달리 인");
  useVideoStore.getState().setLongerEdge(832);
}

/** 임계 충족 (1536×864) source 세팅. */
function setLargeSource(): void {
  useVideoStore.getState().setSource("data:image/png;base64,xx", "test", 1920, 1080);
  useVideoStore.getState().setPrompt("느린 달리 인");
  useVideoStore.getState().setLongerEdge(1536);
}

describe("VideoLeftPanel CTA 분기", () => {
  it("임계 미만 사이즈 + Render 클릭 → onGenerate 즉시 호출, 모달 미노출", () => {
    setSmallSource();
    const onGenerate = vi.fn();
    const ref = createRef<HTMLTextAreaElement>();
    render(<VideoLeftPanel promptTextareaRef={ref} onGenerate={onGenerate} />);

    fireEvent.click(screen.getByRole("button", { name: /Render/i }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("임계 충족 사이즈 + Render 클릭 → 모달 노출, onGenerate 미호출", () => {
    setLargeSource();
    const onGenerate = vi.fn();
    const ref = createRef<HTMLTextAreaElement>();
    render(<VideoLeftPanel promptTextareaRef={ref} onGenerate={onGenerate} />);

    fireEvent.click(screen.getByRole("button", { name: /Render/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("큰 사이즈로 생성할까요?")).toBeTruthy();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("모달 [그대로 진행] → 모달 닫힘 + onGenerate 호출", () => {
    setLargeSource();
    const onGenerate = vi.fn();
    const ref = createRef<HTMLTextAreaElement>();
    render(<VideoLeftPanel promptTextareaRef={ref} onGenerate={onGenerate} />);

    fireEvent.click(screen.getByRole("button", { name: /Render/i }));
    fireEvent.click(screen.getByText("그대로 진행"));

    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("모달 [취소] → 모달 닫힘 + onGenerate 미호출", () => {
    setLargeSource();
    const onGenerate = vi.fn();
    const ref = createRef<HTMLTextAreaElement>();
    render(<VideoLeftPanel promptTextareaRef={ref} onGenerate={onGenerate} />);

    fireEvent.click(screen.getByRole("button", { name: /Render/i }));
    fireEvent.click(screen.getByText("취소"));

    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("slider 와 모달이 같은 expected 표시 (단일 진실원)", () => {
    setLargeSource();
    const ref = createRef<HTMLTextAreaElement>();
    render(<VideoLeftPanel promptTextareaRef={ref} onGenerate={vi.fn()} />);

    // slider 의 출력 사이즈 표시 (size-header-chip)
    const sliderText = screen.getByText(/×/).textContent ?? "";
    fireEvent.click(screen.getByRole("button", { name: /Render/i }));

    // 모달 본문의 출력 사이즈 표기
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("1536×864");
    expect(sliderText).toContain("1536×864");
  });
});
```

### Step 3.2: 테스트 실행 fail 확인

- [ ] Run: `cd frontend && npx vitest run __tests__/video-size-warn-integration.test.tsx`
- [ ] Expected: FAIL — `VideoLeftPanel` 에 모달 마운트 없음 + handleCtaClick 분기 없음. 모든 5 테스트 fail.

### Step 3.3: VideoLeftPanel 수정

3.3.a, 3.3.b, 3.3.c, 3.3.d 4 개 파편으로 분리해서 적용. 각 단계마다 테스트 부분 검증.

#### 3.3.a — `expected` `useMemo` 끌어올림 + import 추가

- [ ] In `frontend/components/studio/video/VideoLeftPanel.tsx`, **상단 import 블록** 에 추가:

```ts
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
```

(기존 `import { useEffect, useRef, type RefObject } from "react";` 줄을 위 형태로 교체 — `useMemo` + `useState` 추가)

- [ ] 같은 파일 import 블록 끝에 추가:

```ts
import VideoSizeWarnModal from "@/components/studio/video/VideoSizeWarnModal";
import { shouldWarnVideoSize } from "@/lib/video-size";
```

- [ ] `useVideoInputs/useVideoRunning/computeVideoResize` import 줄에서 `computeVideoResize` 가 이미 import 되어 있는지 확인 (현재 spec 에서는 import 됨). OK.

- [ ] 컴포넌트 함수 안에서 (기존 `const ctaDisabled = ...` 줄 *바로 위* 위치) 추가:

```ts
// 단일 진실원 — slider + warn modal 둘 다 이 expected 사용 (불일치 race 차단).
// useMemo: sourceWidth/sourceHeight/longerEdge 변동 시만 재계산.
const expected = useMemo(() => {
  if (!sourceWidth || !sourceHeight) return { width: 0, height: 0 };
  return computeVideoResize(sourceWidth, sourceHeight, longerEdge);
}, [sourceWidth, sourceHeight, longerEdge]);

// 큰 사이즈 경고 모달 노출 state.
const [warnOpen, setWarnOpen] = useState(false);
```

#### 3.3.b — handler 3개 추가 + CTA onClick 교체

- [ ] 기존 `const ctaDisabled = running || !sourceImage || !prompt.trim();` 줄 *바로 다음* 에 추가:

```ts
/**
 * Render CTA 클릭 — 사이즈 임계 충족 시 경고 모달, 미만이면 즉시 onGenerate.
 * 방어 가드: running / warnOpen / ctaDisabled 중 하나라도 truthy 면 early return.
 */
const handleCtaClick = () => {
  if (running || warnOpen || ctaDisabled) return;

  if (shouldWarnVideoSize(expected.width, expected.height)) {
    setWarnOpen(true);
    return;
  }

  onGenerate();
};

/** 모달 [그대로 진행] — 닫고 → 즉시 onGenerate (모달 잔류 프레임 ↓). */
const handleConfirmWarn = () => {
  setWarnOpen(false);
  onGenerate();
};

/** 모달 [취소] / ESC / overlay — 닫기만, generate 미호출. */
const handleCancelWarn = () => {
  setWarnOpen(false);
};
```

- [ ] 기존 CTA 버튼 (`<button type="button" onClick={onGenerate} disabled={ctaDisabled} ...>`) 의 `onClick` 을 다음으로 교체:

```tsx
onClick={handleCtaClick}
```

#### 3.3.c — 모달 마운트

- [ ] `VideoLeftPanel` 함수의 `return (` 직후 `<StudioLeftPanel>` 의 *형제 요소* 로 모달 마운트. 즉 return 의 **첫 번째 자식** 으로 fragment 사용:

기존:
```tsx
return (
  <StudioLeftPanel>
    <StudioModeHeader ... />
    {/* ... 나머지 */}
  </StudioLeftPanel>
);
```

변경:
```tsx
return (
  <>
    <VideoSizeWarnModal
      open={warnOpen}
      width={expected.width}
      height={expected.height}
      onCancel={handleCancelWarn}
      onConfirm={handleConfirmWarn}
    />
    <StudioLeftPanel>
      <StudioModeHeader ... />
      {/* ... 나머지 그대로 */}
    </StudioLeftPanel>
  </>
);
```

#### 3.3.d — `VideoResolutionSlider` prop 시그니처 변경 + 옛 `simplifyRatio` 제거

- [ ] `<VideoResolutionSlider>` JSX 호출에 `expected` prop 추가:

```tsx
<VideoResolutionSlider
  longerEdge={longerEdge}
  setLongerEdge={setLongerEdge}
  sourceWidth={sourceWidth}
  sourceHeight={sourceHeight}
  expected={expected}
/>
```

- [ ] `function VideoResolutionSlider(...)` 시그니처 변경 — `expected` prop 받음:

```ts
function VideoResolutionSlider({
  longerEdge,
  setLongerEdge,
  sourceWidth,
  sourceHeight,
  expected,
}: {
  longerEdge: number;
  setLongerEdge: (v: number) => void;
  sourceWidth: number | null;
  sourceHeight: number | null;
  expected: { width: number; height: number };
}) {
  const hasSource = !!(sourceWidth && sourceHeight);
  // 옛: const expected = hasSource ? computeVideoResize(...) : {0,0};
  // 신: prop 으로 받음 (단일 진실원).
  const timeFactor = Math.pow(longerEdge / VIDEO_LONGER_EDGE_MAX, 2);
  // ... 나머지 그대로
```

내부에서 기존 `const expected = hasSource ? computeVideoResize(sourceWidth!, sourceHeight!, longerEdge) : { width: 0, height: 0 };` 줄 **삭제** (prop 으로 대체).

- [ ] 파일 맨 아래 `function simplifyRatio(w: number, h: number): string { ... }` (현재 line 577 근처) **삭제**. 위에서 `import { shouldWarnVideoSize } from "@/lib/video-size";` 추가했으니 같은 import 줄을 다음으로 확장:

```ts
import { shouldWarnVideoSize, simplifyRatio } from "@/lib/video-size";
```

→ 컴포넌트 안에서 사용하는 `simplifyRatio(...)` 호출은 그대로 유지 (lib import 가 대신함).

### Step 3.4: 통합 테스트 실행 pass 확인

- [ ] Run: `cd frontend && npx vitest run __tests__/video-size-warn-integration.test.tsx`
- [ ] Expected: PASS — 5 tests

### Step 3.5: 전체 frontend 검증 (regression 0)

- [ ] Run: `cd frontend && npx vitest run`
- [ ] Expected: 모든 테스트 PASS · 기존 회귀 0 · 신규 36 (Task 1: 23 + Task 2: 8 + Task 3: 5) 추가
- [ ] Run: `cd frontend && npx tsc --noEmit`
- [ ] Expected: 출력 없음 (clean)
- [ ] Run: `cd frontend && npm run lint`
- [ ] Expected: lint 에러 0

### Step 3.6: Commit

```powershell
git add frontend/components/studio/video/VideoLeftPanel.tsx frontend/__tests__/video-size-warn-integration.test.tsx
git commit -m "feat(video): Render CTA 사이즈 경고 모달 통합 - expected 단일 진실원 + handleCtaClick 분기"
```

---

## Task 4: 브라우저 실측 검증 (수동 · regression 가드)

**참조:** CLAUDE.md "Browser Testing" 섹션 — 레이아웃/UI 수정은 스크린샷 간격 제한 없음.

### Step 4.1: 백엔드 + 프론트엔드 기동

- [ ] PowerShell 1: `cd backend; D:\AI-Image-Studio\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --no-access-log`
- [ ] PowerShell 2: `$env:NEXT_PUBLIC_USE_MOCK="false"; $env:NEXT_PUBLIC_STUDIO_API="http://localhost:8001"; cd frontend; npm run dev`

### Step 4.2: 브라우저 실측 시나리오

- [ ] 브라우저 `http://localhost:3000/video` 진입
- [ ] **시나리오 A — 임계 미만 (모달 미노출 회귀 검증)**:
  - 작은 이미지 (예 832×480 이하 PNG) 업로드
  - 영상 지시 입력
  - 슬라이더 832 (default) 유지
  - "Render" 클릭 → 모달 *노출 없이* 평소대로 영상 생성 진행 시작 (Progress 모달 노출)
  - "🛑 중단" 으로 즉시 멈춰도 OK (실제 영상 생성 완료까지 갈 필요는 없음 · 분기만 검증)
- [ ] **시나리오 B — 임계 충족 (모달 노출)**:
  - 큰 이미지 (1920×1080 등) 업로드
  - 영상 지시 입력
  - 슬라이더 1536 까지 (또는 "📐 원본" 클릭) → slider chip "고품질" rose 색상 + 출력 표기 1536×864 확인
  - "Render" 클릭 → **경고 모달 노출** 확인:
    - 타이틀: "큰 사이즈로 생성할까요?"
    - 본문: "현재 컴퓨터 제원에서는 생성 시간이 오래 걸리거나 중간에 중단될 수 있어요."
    - 출력 사이즈: `1536×864 · 16:9` (slider 표시값과 일치)
  - **B-1: ESC 키** → 모달 닫힘 · 영상 생성 미시작
  - 다시 Render 클릭 → 모달 재노출
  - **B-2: overlay 클릭** (모달 바깥 dim 영역) → 모달 닫힘
  - 다시 Render → **B-3: [취소] 클릭** → 모달 닫힘 · 영상 생성 미시작
  - 슬라이더 1024 까지 줄임 → 출력 표기 변경 확인
  - 다시 Render → 1024×576 은 임계 미만 (W=1024<1280, H=576<1000) → 모달 미노출, 평소대로 진행
- [ ] **시나리오 C — 양방 임계 (W&H 둘 다 ≥ 1000)**:
  - 정사각형 이미지 (1024×1024) 업로드
  - 슬라이더 1024 까지 → 출력 1024×1024 (둘 다 ≥ 1000)
  - Render → 모달 노출 확인
  - [그대로 진행] → 모달 닫힘 · 영상 생성 시작 (Progress 모달 즉시 전환)

### Step 4.3: 브라우저 검증 결과 박제

- [ ] 위 4개 시나리오 (A / B-1~3 / C) 모두 통과 확인. 통과 못 하면 stop & 디버그.

### Step 4.4: dev 서버 종료

- [ ] PowerShell 두 창 모두 `Ctrl+C` 종료 (혹은 `start.bat` 사용 시 launcher 종료).

---

## Task 5: 최종 검증 + master merge 결정 박제

### Step 5.1: 전체 회귀 검증

- [ ] Run: `cd frontend && npx vitest run`
- [ ] Expected: 모든 PASS (기존 + 신규 36)
- [ ] Run: `cd frontend && npx tsc --noEmit && npm run lint`
- [ ] Expected: clean
- [ ] Run: `cd backend; D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/`
- [ ] Expected: pytest 215 (또는 spec memory 기준 446) 그대로 — 백엔드 변경 0건 회귀 확인.

### Step 5.2: 사용자 결정 대기 (master merge 전)

memory `feedback_test_first_merge_after.md` + `feedback_merge_strategy_validation.md`:

- 모든 commit 은 feature branch 안에만 (`claude/video-size-warn` 등 권장)
- 사용자가 명시적으로 "master 로 머지하자" 라고 할 때만 `git merge --no-ff` 진행
- push 도 사용자 명시 후 `git push origin master`

→ Step 5.1 완료 후 사용자에게 결과 보고하고 머지 여부 확인 받음.

---

## Self-Review Checklist (작성자가 plan 완료 후 체크)

- [x] **Spec 커버리지**: spec §1~§10 모든 결정/요구사항이 task 에 매핑됨
  - §2 #1 임계 → Task 1 `shouldWarnVideoSize` ✅
  - §2 #2 모델 차등 없음 → 별 코드 없음 (구현 0건) ✅
  - §2 #3 사이즈 변경 UX → Task 3 `[취소]` → 모달 닫기만 ✅
  - §2 #4 dismiss 없음 → 별 옵션 X ✅
  - §2 #5 Render 시점만 → Task 3.3.b `handleCtaClick` ✅
  - §2 #6 버튼 → Task 2 모달 footer ✅
  - §2 #7 핵심 문구 → Task 2 본문 ✅
  - §4.1 UX 문구 → Task 2 ✅
  - §4.2 인터랙션 → Task 2 테스트 + Task 3 통합 테스트 ✅
  - §5.1.1 lib → Task 1 ✅
  - §5.1.2 모달 → Task 2 ✅
  - §5.2.1 panel 수정 → Task 3.3 ✅
  - §5.3 옛 `simplifyRatio` 제거 → Task 3.3.d ✅
  - §6.1.1 `shouldWarnVideoSize` 테스트 → Task 1.1 ✅
  - §6.1.2 `simplifyRatio` 테스트 → Task 1.1 ✅
  - §6.1.3 모달 테스트 → Task 2.1 ✅
  - §6.1.4 통합 테스트 → Task 3.1 ✅
  - §6.3 회귀 검증 → Task 5.1 ✅
  - §7 엣지 케이스 → Task 1 가드 테스트 + Task 4 브라우저 시나리오 C ✅
  - §8 단계 → Task 1~5 ✅
- [x] **Placeholder scan**: TBD/TODO/"add appropriate" 없음. 모든 코드 블록 박제.
- [x] **Type consistency**:
  - `Props.width: number` / `Props.height: number` (Task 2 컴포넌트) ↔ `expected.width`/`expected.height` (Task 3 panel) ↔ `width`/`height` (Task 2 모달 import) ✅
  - `shouldWarnVideoSize(width, height)` 시그니처 일관 ✅
  - `simplifyRatio(w, h)` Task 1 ↔ Task 2 import ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-04-video-size-warn-modal.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

어떤 방식으로 갈까?
