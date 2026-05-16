# Edit Source Crop Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Edit-only source image crop flow where the user opens a large modal, freely moves/resizes a crop rectangle, applies it, sees the cropped image loaded back into the source slot, and can restore the original source.

**Architecture:** Keep the feature scoped to Edit source input. `SourceImageCard` gets optional crop/restore controls, `EditLeftPanel` owns the crop modal open state, `useEditStore` preserves the original source snapshot, and a new `SourceCropModal` performs the visual crop selection and client-side crop conversion. No backend schema or API changes are required because the existing Edit pipeline already uploads the current `sourceImage`.

**Tech Stack:** Next.js 16, React 19, TypeScript strict, Zustand, existing canvas crop helpers, Vitest, Testing Library. No new dependency.

---

## Scope And Guardrails

- This plan does not touch Lab, Video, Vision, Compare, backend routes, history DB, or production model behavior.
- Before implementation, either commit or intentionally keep separate the current ResultBox loading-label worktree changes so crop work is not mixed into the same commit by accident.
- The crop UX is `Crop & Replace`: applying crop replaces `sourceImage` with a cropped data URL and updates the displayed source dimensions.
- The restore UX is `Restore Original`: the first pre-crop source snapshot is kept in memory and restored on demand.
- The modal must use a draggable/resizable crop rectangle with corner and edge handles. Do not reuse the reference-image `react-easy-crop` UX for this because that crop model moves/zooms the image instead of resizing the rectangle itself.

## File Map

- Create `frontend/lib/source-crop-geometry.ts`
  - Pure rectangle math for move, resize, clamp, and natural-pixel conversion.
- Create `frontend/components/studio/edit/SourceCropModal.tsx`
  - Large modal, displayed image measurement, draggable crop rectangle, resize handles, apply/cancel/reset.
- Modify `frontend/lib/image-crop.ts`
  - Add `blobToDataUrl(blob)` so cropped blobs can replace `sourceImage`.
- Modify `frontend/stores/useEditStore.ts`
  - Add source original snapshot fields and actions: `applySourceCrop`, `restoreSourceOriginal`.
- Modify `frontend/components/studio/SourceImageCard.tsx`
  - Add optional crop button, cropped badge, and restore button.
- Modify `frontend/components/studio/edit/EditLeftPanel.tsx`
  - Wire Edit-only crop controls and modal.
- Modify `frontend/components/ui/Icon.tsx`
  - Add `crop` icon.
- Add tests:
  - `frontend/__tests__/source-crop-geometry.test.ts`
  - `frontend/__tests__/edit-source-crop-store.test.ts`
  - `frontend/__tests__/source-image-card-crop-actions.test.tsx`
  - Extend `frontend/__tests__/image-crop.test.ts`

---

### Task 1: Pure Crop Geometry

**Files:**
- Create: `frontend/lib/source-crop-geometry.ts`
- Test: `frontend/__tests__/source-crop-geometry.test.ts`

- [ ] **Step 1: Write failing geometry tests**

Create `frontend/__tests__/source-crop-geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  clampCropRect,
  moveCropRect,
  rectToNaturalArea,
  resizeCropRect,
  type CropHandle,
  type CropRect,
  type DisplayedImageMetrics,
} from "@/lib/source-crop-geometry";

const bounds = { width: 800, height: 600 };
const rect: CropRect = { x: 100, y: 80, width: 300, height: 240 };

describe("source crop geometry", () => {
  it("moveCropRect keeps the rectangle inside image bounds", () => {
    expect(moveCropRect(rect, 999, 999, bounds)).toEqual({
      x: 500,
      y: 360,
      width: 300,
      height: 240,
    });
    expect(moveCropRect(rect, -999, -999, bounds)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 240,
    });
  });

  it("resizeCropRect supports corner handles and minimum size", () => {
    const resized = resizeCropRect(
      rect,
      "se",
      420,
      260,
      bounds,
      96,
    );
    expect(resized).toEqual({ x: 100, y: 80, width: 420, height: 260 });

    const minned = resizeCropRect(rect, "nw", 999, 999, bounds, 96);
    expect(minned.width).toBe(96);
    expect(minned.height).toBe(96);
    expect(minned.x).toBe(304);
    expect(minned.y).toBe(224);
  });

  it("resizeCropRect supports edge handles", () => {
    const west = resizeCropRect(rect, "w", 70, 0, bounds, 96);
    expect(west).toEqual({ x: 170, y: 80, width: 230, height: 240 });

    const north = resizeCropRect(rect, "n", 0, 40, bounds, 96);
    expect(north).toEqual({ x: 100, y: 120, width: 300, height: 200 });
  });

  it("clampCropRect normalizes invalid rectangles", () => {
    expect(
      clampCropRect({ x: -20, y: -10, width: 20, height: 40 }, bounds, 96),
    ).toEqual({ x: 0, y: 0, width: 96, height: 96 });
  });

  it("rectToNaturalArea converts displayed pixels to natural image pixels", () => {
    const metrics: DisplayedImageMetrics = {
      displayedWidth: 800,
      displayedHeight: 600,
      naturalWidth: 1600,
      naturalHeight: 1200,
    };
    expect(rectToNaturalArea(rect, metrics)).toEqual({
      x: 200,
      y: 160,
      width: 600,
      height: 480,
    });
  });

  it("exports the expected handle type", () => {
    const handle: CropHandle = "ne";
    expect(handle).toBe("ne");
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
Push-Location frontend
npm test -- __tests__/source-crop-geometry.test.ts
Pop-Location
```

Expected: FAIL because `@/lib/source-crop-geometry` does not exist.

- [ ] **Step 3: Implement geometry helpers**

Create `frontend/lib/source-crop-geometry.ts`:

```ts
export type CropHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropBounds {
  width: number;
  height: number;
}

export interface DisplayedImageMetrics {
  displayedWidth: number;
  displayedHeight: number;
  naturalWidth: number;
  naturalHeight: number;
}

const round = (value: number) => Math.round(value);

export function clampCropRect(
  rect: CropRect,
  bounds: CropBounds,
  minSize = 96,
): CropRect {
  const maxWidth = Math.max(1, bounds.width);
  const maxHeight = Math.max(1, bounds.height);
  const width = Math.min(Math.max(minSize, round(rect.width)), maxWidth);
  const height = Math.min(Math.max(minSize, round(rect.height)), maxHeight);
  const x = Math.min(Math.max(0, round(rect.x)), maxWidth - width);
  const y = Math.min(Math.max(0, round(rect.y)), maxHeight - height);
  return { x, y, width, height };
}

export function moveCropRect(
  rect: CropRect,
  dx: number,
  dy: number,
  bounds: CropBounds,
  minSize = 96,
): CropRect {
  return clampCropRect(
    { ...rect, x: rect.x + dx, y: rect.y + dy },
    bounds,
    minSize,
  );
}

export function resizeCropRect(
  rect: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  bounds: CropBounds,
  minSize = 96,
): CropRect {
  let { x, y, width, height } = rect;

  if (handle.includes("w")) {
    x += dx;
    width -= dx;
  }
  if (handle.includes("e")) {
    width += dx;
  }
  if (handle.includes("n")) {
    y += dy;
    height -= dy;
  }
  if (handle.includes("s")) {
    height += dy;
  }

  if (width < minSize) {
    if (handle.includes("w")) x = rect.x + rect.width - minSize;
    width = minSize;
  }
  if (height < minSize) {
    if (handle.includes("n")) y = rect.y + rect.height - minSize;
    height = minSize;
  }

  if (x < 0) {
    width += x;
    x = 0;
  }
  if (y < 0) {
    height += y;
    y = 0;
  }
  if (x + width > bounds.width) width = bounds.width - x;
  if (y + height > bounds.height) height = bounds.height - y;

  return clampCropRect({ x, y, width, height }, bounds, minSize);
}

export function rectToNaturalArea(
  rect: CropRect,
  metrics: DisplayedImageMetrics,
): CropRect {
  const scaleX = metrics.naturalWidth / metrics.displayedWidth;
  const scaleY = metrics.naturalHeight / metrics.displayedHeight;
  return {
    x: round(rect.x * scaleX),
    y: round(rect.y * scaleY),
    width: round(rect.width * scaleX),
    height: round(rect.height * scaleY),
  };
}
```

- [ ] **Step 4: Run geometry tests**

Run:

```powershell
Push-Location frontend
npm test -- __tests__/source-crop-geometry.test.ts
Pop-Location
```

Expected: PASS.

---

### Task 2: Crop Blob To Data URL Helper

**Files:**
- Modify: `frontend/lib/image-crop.ts`
- Test: `frontend/__tests__/image-crop.test.ts`

- [ ] **Step 1: Write failing helper test**

Append to `frontend/__tests__/image-crop.test.ts`:

```ts
import { blobToDataUrl } from "@/lib/image-crop";

describe("blobToDataUrl", () => {
  it("Blob 을 data URL 로 변환한다", async () => {
    const url = await blobToDataUrl(new Blob(["abc"], { type: "image/png" }));
    expect(url).toMatch(/^data:image\/png;base64,/);
  });
});
```

Run:

```powershell
Push-Location frontend
npm test -- __tests__/image-crop.test.ts
Pop-Location
```

Expected: FAIL because `blobToDataUrl` is not exported.

- [ ] **Step 2: Add helper**

Add to `frontend/lib/image-crop.ts` before internal helpers:

```ts
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("blobToDataUrl: FileReader 실패"));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("blobToDataUrl: data URL 결과 없음"));
      }
    };
    reader.readAsDataURL(blob);
  });
}
```

- [ ] **Step 3: Run image-crop tests**

Run:

```powershell
Push-Location frontend
npm test -- __tests__/image-crop.test.ts
Pop-Location
```

Expected: PASS.

---

### Task 3: Edit Store Original Snapshot And Restore

**Files:**
- Modify: `frontend/stores/useEditStore.ts`
- Test: `frontend/__tests__/edit-source-crop-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Create `frontend/__tests__/edit-source-crop-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useEditStore } from "@/stores/useEditStore";

describe("useEditStore - source crop replace/restore", () => {
  beforeEach(() => {
    useEditStore.setState({
      sourceImage: null,
      sourceLabel: "이미지를 업로드하거나 히스토리에서 선택",
      sourceWidth: null,
      sourceHeight: null,
      sourceOriginal: null,
      sourceIsCropped: false,
    });
  });

  it("setSource 는 새 원본을 설정하고 crop snapshot 을 초기화한다", () => {
    useEditStore
      .getState()
      .setSource("data:image/png;base64,A", "a.png · 1000×800", 1000, 800);

    expect(useEditStore.getState().sourceOriginal).toBeNull();
    expect(useEditStore.getState().sourceIsCropped).toBe(false);
  });

  it("applySourceCrop 은 현재 source 를 원본 snapshot 으로 보관하고 crop 결과를 로드한다", () => {
    useEditStore
      .getState()
      .setSource("data:image/png;base64,A", "a.png · 1000×800", 1000, 800);

    useEditStore
      .getState()
      .applySourceCrop("data:image/png;base64,C", "a.png · crop 640×480", 640, 480);

    const s = useEditStore.getState();
    expect(s.sourceImage).toBe("data:image/png;base64,C");
    expect(s.sourceLabel).toBe("a.png · crop 640×480");
    expect(s.sourceWidth).toBe(640);
    expect(s.sourceHeight).toBe(480);
    expect(s.sourceIsCropped).toBe(true);
    expect(s.sourceOriginal).toEqual({
      image: "data:image/png;base64,A",
      label: "a.png · 1000×800",
      width: 1000,
      height: 800,
    });
  });

  it("crop 을 다시 적용해도 최초 원본 snapshot 을 유지한다", () => {
    const store = useEditStore.getState();
    store.setSource("data:image/png;base64,A", "a.png · 1000×800", 1000, 800);
    store.applySourceCrop("data:image/png;base64,C1", "a.png · crop 640×480", 640, 480);
    useEditStore
      .getState()
      .applySourceCrop("data:image/png;base64,C2", "a.png · crop 320×240", 320, 240);

    expect(useEditStore.getState().sourceOriginal?.image).toBe(
      "data:image/png;base64,A",
    );
    expect(useEditStore.getState().sourceImage).toBe("data:image/png;base64,C2");
  });

  it("restoreSourceOriginal 은 원본을 복원하고 snapshot 을 비운다", () => {
    const store = useEditStore.getState();
    store.setSource("data:image/png;base64,A", "a.png · 1000×800", 1000, 800);
    store.applySourceCrop("data:image/png;base64,C", "a.png · crop 640×480", 640, 480);

    useEditStore.getState().restoreSourceOriginal();

    const s = useEditStore.getState();
    expect(s.sourceImage).toBe("data:image/png;base64,A");
    expect(s.sourceLabel).toBe("a.png · 1000×800");
    expect(s.sourceWidth).toBe(1000);
    expect(s.sourceHeight).toBe(800);
    expect(s.sourceOriginal).toBeNull();
    expect(s.sourceIsCropped).toBe(false);
  });
});
```

- [ ] **Step 2: Run failing store tests**

Run:

```powershell
Push-Location frontend
npm test -- __tests__/edit-source-crop-store.test.ts
Pop-Location
```

Expected: FAIL because `sourceOriginal`, `sourceIsCropped`, `applySourceCrop`, and `restoreSourceOriginal` do not exist.

- [ ] **Step 3: Implement store fields and actions**

In `frontend/stores/useEditStore.ts`, add:

```ts
export interface SourceSnapshot {
  image: string;
  label: string;
  width: number | null;
  height: number | null;
}
```

Add fields to `EditState`:

```ts
sourceOriginal: SourceSnapshot | null;
sourceIsCropped: boolean;
applySourceCrop: (
  image: string,
  label: string,
  w: number,
  h: number,
) => void;
restoreSourceOriginal: () => void;
```

Initial state:

```ts
sourceOriginal: null,
sourceIsCropped: false,
```

Replace `setSource` with logic that clears crop state for a new loaded source:

```ts
setSource: (image, label, w, h) =>
  set({
    sourceImage: image,
    sourceLabel: label ?? "이미지를 업로드하거나 히스토리에서 선택",
    sourceWidth: w ?? null,
    sourceHeight: h ?? null,
    sourceOriginal: null,
    sourceIsCropped: false,
  }),
applySourceCrop: (image, label, w, h) =>
  set((s) => ({
    sourceOriginal:
      s.sourceOriginal ??
      (s.sourceImage
        ? {
            image: s.sourceImage,
            label: s.sourceLabel,
            width: s.sourceWidth,
            height: s.sourceHeight,
          }
        : null),
    sourceImage: image,
    sourceLabel: label,
    sourceWidth: w,
    sourceHeight: h,
    sourceIsCropped: true,
  })),
restoreSourceOriginal: () =>
  set((s) => {
    if (!s.sourceOriginal) return {};
    return {
      sourceImage: s.sourceOriginal.image,
      sourceLabel: s.sourceOriginal.label,
      sourceWidth: s.sourceOriginal.width,
      sourceHeight: s.sourceOriginal.height,
      sourceOriginal: null,
      sourceIsCropped: false,
    };
  }),
```

Extend `useEditInputs` to expose:

```ts
sourceOriginal: s.sourceOriginal,
sourceIsCropped: s.sourceIsCropped,
applySourceCrop: s.applySourceCrop,
restoreSourceOriginal: s.restoreSourceOriginal,
```

- [ ] **Step 4: Run store tests**

Run:

```powershell
Push-Location frontend
npm test -- __tests__/edit-source-crop-store.test.ts __tests__/edit-multi-ref-crop.test.ts
Pop-Location
```

Expected: PASS.

---

### Task 4: Source Image Card Crop Controls

**Files:**
- Modify: `frontend/components/ui/Icon.tsx`
- Modify: `frontend/components/studio/SourceImageCard.tsx`
- Test: `frontend/__tests__/source-image-card-crop-actions.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Create `frontend/__tests__/source-image-card-crop-actions.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SourceImageCard from "@/components/studio/SourceImageCard";

vi.mock("@/components/studio/StudioUploadSlot", () => ({
  default: ({
    children,
    onReady,
  }: {
    children?: React.ReactNode;
    onReady?: (pick: () => void) => void;
  }) => {
    onReady?.(vi.fn());
    return <div data-testid="studio-upload-slot">{children}</div>;
  },
}));

function renderFilled(overrides: Partial<React.ComponentProps<typeof SourceImageCard>> = {}) {
  const props: React.ComponentProps<typeof SourceImageCard> = {
    sourceImage: "data:image/png;base64,AAA",
    sourceLabel: "source.png · 1000×800",
    sourceWidth: 1000,
    sourceHeight: 800,
    onChange: vi.fn(),
    onClear: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  render(<SourceImageCard {...props} />);
  return props;
}

describe("SourceImageCard crop controls", () => {
  it("onCrop 이 있으면 crop 버튼을 렌더하고 클릭을 전달한다", () => {
    const onCrop = vi.fn();
    renderFilled({ onCrop });

    fireEvent.click(screen.getByTitle("이미지 크롭"));

    expect(onCrop).toHaveBeenCalledOnce();
  });

  it("cropped 상태이면 restore 버튼과 CROPPED 배지를 렌더한다", () => {
    const onRestoreOriginal = vi.fn();
    renderFilled({ isCropped: true, onRestoreOriginal });

    expect(screen.getByText("CROPPED")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("원본 복원"));

    expect(onRestoreOriginal).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run failing UI tests**

Run:

```powershell
Push-Location frontend
npm test -- __tests__/source-image-card-crop-actions.test.tsx
Pop-Location
```

Expected: FAIL because props/buttons are not implemented.

- [ ] **Step 3: Add crop icon**

In `frontend/components/ui/Icon.tsx`, add `"crop"` to `IconName` and a switch case:

```tsx
case "crop":
  return (
    <svg {...common}>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M2 6h14a2 2 0 0 1 2 2v14" />
      <path d="M10 10h4v4" />
    </svg>
  );
```

- [ ] **Step 4: Add optional SourceImageCard controls**

In `frontend/components/studio/SourceImageCard.tsx`, extend props:

```ts
onCrop?: () => void;
onRestoreOriginal?: () => void;
isCropped?: boolean;
```

Render crop and restore controls only when optional props are present:

```tsx
{isCropped && (
  <button
    type="button"
    title="원본 복원"
    onClick={(e) => {
      e.stopPropagation();
      onRestoreOriginal?.();
    }}
    className="mono"
    style={{
      all: "unset",
      position: "absolute",
      top: 10,
      left: 10,
      cursor: "pointer",
      padding: "6px 9px",
      borderRadius: "var(--radius-full)",
      background: "rgba(0,0,0,.38)",
      backdropFilter: "blur(14px) saturate(180%)",
      WebkitBackdropFilter: "blur(14px) saturate(180%)",
      border: "1px solid rgba(255,255,255,.22)",
      color: "#fff",
      fontSize: 10.5,
      fontWeight: 700,
    }}
  >
    CROPPED
  </button>
)}
```

Add a crop icon button before refresh:

```tsx
{onCrop && (
  <RoundIconBtn title="이미지 크롭" icon="crop" onClick={onCrop} />
)}
```

- [ ] **Step 5: Run UI tests**

Run:

```powershell
Push-Location frontend
npm test -- __tests__/source-image-card-crop-actions.test.tsx __tests__/source-image-card-paste.test.tsx
Pop-Location
```

Expected: PASS.

---

### Task 5: Source Crop Modal

**Files:**
- Create: `frontend/components/studio/edit/SourceCropModal.tsx`
- Test: `frontend/__tests__/source-crop-modal.test.tsx`

- [ ] **Step 1: Write failing modal smoke tests**

Create `frontend/__tests__/source-crop-modal.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SourceCropModal from "@/components/studio/edit/SourceCropModal";

describe("SourceCropModal", () => {
  it("닫힘 상태에서는 렌더하지 않는다", () => {
    const { container } = render(
      <SourceCropModal
        open={false}
        image="data:image/png;base64,AAA"
        label="source.png"
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("열림 상태에서 crop rectangle 과 reset/cancel/apply 버튼을 렌더한다", () => {
    render(
      <SourceCropModal
        open
        image="data:image/png;base64,AAA"
        label="source.png"
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onError={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "원본 이미지 크롭" })).toBeInTheDocument();
    expect(screen.getByTestId("source-crop-rect")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply Crop" })).toBeInTheDocument();
  });

  it("Cancel 클릭 시 onCancel 을 호출한다", () => {
    const onCancel = vi.fn();
    render(
      <SourceCropModal
        open
        image="data:image/png;base64,AAA"
        label="source.png"
        onCancel={onCancel}
        onApply={vi.fn()}
        onError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run failing modal tests**

Run:

```powershell
Push-Location frontend
npm test -- __tests__/source-crop-modal.test.tsx
Pop-Location
```

Expected: FAIL because `SourceCropModal` does not exist.

- [ ] **Step 3: Implement modal shell and pointer interaction**

Create `frontend/components/studio/edit/SourceCropModal.tsx` with these required behaviors:

```ts
interface SourceCropModalProps {
  open: boolean;
  image: string | null;
  label: string;
  onCancel: () => void;
  onApply: (image: string, label: string, width: number, height: number) => void;
  onError: (message: string) => void;
}
```

Implementation requirements:

- Return `null` when `open === false` or `image === null`.
- Render `role="dialog"` and `aria-label="원본 이미지 크롭"`.
- Display the image in a large constrained modal, not inside the 256px source card.
- Keep `cropRect` in displayed image coordinates.
- Initialize crop to the centered 80% rectangle after the displayed image dimensions are known.
- Support pointer dragging:
  - body drag moves the rectangle via `moveCropRect`.
  - handles `n`, `s`, `e`, `w`, `nw`, `ne`, `sw`, `se` resize via `resizeCropRect`.
- On `Apply Crop`:
  - convert displayed rect to natural pixels using `rectToNaturalArea`.
  - use `dataUrlToBlob(image)`, `cropBlobByArea(blob, area)`, and `blobToDataUrl(croppedBlob)`.
  - call `onApply(croppedDataUrl, nextLabel, area.width, area.height)`.
  - use label format `${baseName} · crop ${area.width}×${area.height}` where `baseName = label.split(" · ")[0] || "source.png"`.
- On crop failure, call `onError("원본 이미지 crop 실패")`.

- [ ] **Step 4: Run modal tests**

Run:

```powershell
Push-Location frontend
npm test -- __tests__/source-crop-modal.test.tsx
Pop-Location
```

Expected: PASS.

---

### Task 6: EditLeftPanel Integration

**Files:**
- Modify: `frontend/components/studio/edit/EditLeftPanel.tsx`
- Test: `frontend/__tests__/edit-source-crop-store.test.ts`
- Test: `frontend/__tests__/source-image-card-crop-actions.test.tsx`

- [ ] **Step 1: Wire store selectors**

In `EditLeftPanel`, destructure new fields/actions from `useEditInputs()`:

```ts
sourceOriginal,
sourceIsCropped,
applySourceCrop,
restoreSourceOriginal,
```

Add local state:

```ts
const [sourceCropOpen, setSourceCropOpen] = useState(false);
```

- [ ] **Step 2: Pass crop controls to SourceImageCard**

Update the existing `SourceImageCard` call:

```tsx
<SourceImageCard
  sourceImage={sourceImage}
  sourceLabel={sourceLabel}
  sourceWidth={sourceWidth}
  sourceHeight={sourceHeight}
  onChange={handleSourceChange}
  onClear={handleClearSource}
  onError={(msg) => toast.error(msg)}
  pasteRequireHover={useReferenceImage}
  onCrop={sourceImage ? () => setSourceCropOpen(true) : undefined}
  isCropped={sourceIsCropped}
  onRestoreOriginal={
    sourceOriginal
      ? () => {
          restoreSourceOriginal();
          toast.info("원본 이미지 복원");
        }
      : undefined
  }
/>
```

- [ ] **Step 3: Render SourceCropModal**

Add below the source card block:

```tsx
<SourceCropModal
  open={sourceCropOpen}
  image={sourceImage}
  label={sourceLabel}
  onCancel={() => setSourceCropOpen(false)}
  onApply={(image, label, w, h) => {
    applySourceCrop(image, label, w, h);
    setSourceCropOpen(false);
    toast.success("원본 이미지 크롭 적용", `${w}×${h}`);
  }}
  onError={(msg) => toast.error(msg)}
/>
```

Import:

```ts
import SourceCropModal from "@/components/studio/edit/SourceCropModal";
```

- [ ] **Step 4: Run targeted tests**

Run:

```powershell
Push-Location frontend
npm test -- __tests__/edit-source-crop-store.test.ts __tests__/source-image-card-crop-actions.test.tsx __tests__/source-crop-modal.test.tsx
Pop-Location
```

Expected: PASS.

---

### Task 7: Full Frontend Verification

**Files:**
- No new files.

- [ ] **Step 1: Run all crop-related tests**

Run:

```powershell
Push-Location frontend
npm test -- __tests__/source-crop-geometry.test.ts __tests__/image-crop.test.ts __tests__/edit-source-crop-store.test.ts __tests__/source-image-card-crop-actions.test.tsx __tests__/source-crop-modal.test.tsx __tests__/source-image-card-paste.test.tsx __tests__/edit-multi-ref-crop.test.ts
Pop-Location
```

Expected: PASS.

- [ ] **Step 2: Typecheck**

Run:

```powershell
Push-Location frontend
npx tsc --noEmit
Pop-Location
```

Expected: PASS.

- [ ] **Step 3: Lint**

Run:

```powershell
Push-Location frontend
npm run lint
Pop-Location
```

Expected: PASS with the existing `frontend/app/layout.tsx` custom font warning only.

- [ ] **Step 4: Browser smoke**

Use the existing dev server if port 3000 is already running. Otherwise start:

```powershell
Push-Location frontend
$env:NEXT_PUBLIC_USE_MOCK="false"
$env:NEXT_PUBLIC_STUDIO_API="http://localhost:8001"
npm run dev
Pop-Location
```

Manual or browser-agent checks:

- Open `http://127.0.0.1:3000/edit`.
- Load an image into the source slot.
- Click the crop icon.
- Confirm the modal opens large enough for precise crop.
- Drag the crop rectangle body and at least one corner handle.
- Click `Apply Crop`.
- Confirm the source slot reloads the cropped image and shows `CROPPED`.
- Click `CROPPED` / restore control.
- Confirm the original image and dimensions return.

Expected: no console crash, no layout overlap, no accidental Video/Vision/Lab UI changes.

---

## Self-Review

- Spec coverage: The plan covers large modal crop, free rectangle move/resize, apply-as-source, and restore original.
- Scope check: The plan is limited to Edit source image UI and client-side conversion. No backend work is required.
- Type consistency: `CropRect` and existing `CropArea` are structurally identical. Store actions use source-specific names to avoid conflict with existing `referenceCropArea`.
- Dependency check: No new dependency is introduced. The rectangle UX is implemented directly because the existing `react-easy-crop` interaction model does not match the requested handle-based crop rectangle.
- Risk: `SourceCropModal` is the only interaction-heavy part. Geometry helpers are pure-tested to reduce pointer-event risk, and browser smoke is required before claiming completion.
