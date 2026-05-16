"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import Icon from "@/components/ui/Icon";
import {
  blobToDataUrl,
  cropBlobByArea,
  dataUrlToBlob,
} from "@/lib/image-crop";
import {
  clampCropRect,
  moveCropRect,
  rectToNaturalArea,
  resizeCropRect,
  type CropHandle,
  type CropRect,
  type DisplayedImageMetrics,
} from "@/lib/source-crop-geometry";

interface SourceCropModalProps {
  open: boolean;
  image: string | null;
  label: string;
  width?: number | null;
  height?: number | null;
  onCancel: () => void;
  onApply: (image: string, label: string, width: number, height: number) => void;
  onError: (message: string) => void;
}

type Interaction =
  | {
      kind: "move";
      startX: number;
      startY: number;
      startRect: CropRect;
    }
  | {
      kind: "resize";
      handle: CropHandle;
      startX: number;
      startY: number;
      startRect: CropRect;
    };

interface CropSnapshot {
  image: string;
  label: string;
  width: number;
  height: number;
}

const MIN_CROP_SIZE = 96;
const MAX_UNDO_STACK = 10;
const DEFAULT_METRICS: DisplayedImageMetrics = {
  displayedWidth: 800,
  displayedHeight: 600,
  naturalWidth: 800,
  naturalHeight: 600,
};
const HANDLES: CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export default function SourceCropModal({
  open,
  image,
  label,
  width,
  height,
  onCancel,
  onApply,
  onError,
}: SourceCropModalProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [metrics, setMetrics] = useState<DisplayedImageMetrics | null>(null);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [applying, setApplying] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<CropSnapshot | null>(
    null,
  );
  const [workingSnapshot, setWorkingSnapshot] = useState<CropSnapshot | null>(
    null,
  );
  const [undoStack, setUndoStack] = useState<CropSnapshot[]>([]);

  useEffect(() => {
    if (!open || !image) {
      setMetrics(null);
      setCropRect(null);
      setInteraction(null);
      setApplying(false);
      setInitialSnapshot(null);
      setWorkingSnapshot(null);
      setUndoStack([]);
      return;
    }

    const snapshot = createSnapshot(
      image,
      label,
      width ?? DEFAULT_METRICS.naturalWidth,
      height ?? DEFAULT_METRICS.naturalHeight,
    );
    setMetrics(null);
    setCropRect(null);
    setInteraction(null);
    setApplying(false);
    setInitialSnapshot(snapshot);
    setWorkingSnapshot(snapshot);
    setUndoStack([]);
  }, [height, image, label, open, width]);

  const fallbackMetrics = useMemo<DisplayedImageMetrics>(() => {
    const width = Math.max(
      1,
      workingSnapshot?.width ?? DEFAULT_METRICS.naturalWidth,
    );
    const height = Math.max(
      1,
      workingSnapshot?.height ?? DEFAULT_METRICS.naturalHeight,
    );
    return {
      displayedWidth: width,
      displayedHeight: height,
      naturalWidth: width,
      naturalHeight: height,
    };
  }, [workingSnapshot?.height, workingSnapshot?.width]);

  const activeMetrics = metrics ?? fallbackMetrics;
  const activeRect = useMemo(
    () => cropRect ?? createInitialRect(activeMetrics),
    [activeMetrics, cropRect],
  );
  const naturalArea = useMemo(
    () => rectToNaturalArea(activeRect, activeMetrics),
    [activeMetrics, activeRect],
  );

  const updateMetrics = useCallback((img: HTMLImageElement) => {
    const box = img.getBoundingClientRect();
    const displayedWidth = Math.max(
      1,
      Math.round(box.width || img.clientWidth || img.naturalWidth),
    );
    const displayedHeight = Math.max(
      1,
      Math.round(box.height || img.clientHeight || img.naturalHeight),
    );
    const naturalWidth = Math.max(1, img.naturalWidth || displayedWidth);
    const naturalHeight = Math.max(1, img.naturalHeight || displayedHeight);
    const loadedSrc = img.currentSrc || img.src;
    const next = {
      displayedWidth,
      displayedHeight,
      naturalWidth,
      naturalHeight,
    };
    setMetrics(next);
    setCropRect(createInitialRect(next));
    setWorkingSnapshot((prev) =>
      prev && prev.image === loadedSrc
        ? { ...prev, width: naturalWidth, height: naturalHeight }
        : prev,
    );
    setInitialSnapshot((prev) =>
      prev && prev.image === loadedSrc
        ? { ...prev, width: naturalWidth, height: naturalHeight }
        : prev,
    );
  }, []);

  useEffect(() => {
    if (!interaction) return;

    const onMove = (event: PointerEvent) => {
      const dx = event.clientX - interaction.startX;
      const dy = event.clientY - interaction.startY;
      const bounds = {
        width: activeMetrics.displayedWidth,
        height: activeMetrics.displayedHeight,
      };
      const next =
        interaction.kind === "move"
          ? moveCropRect(interaction.startRect, dx, dy, bounds, MIN_CROP_SIZE)
          : resizeCropRect(
              interaction.startRect,
              interaction.handle,
              dx,
              dy,
              bounds,
              MIN_CROP_SIZE,
            );
      setCropRect(next);
    };

    const onUp = () => setInteraction(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [activeMetrics.displayedHeight, activeMetrics.displayedWidth, interaction]);

  const startMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setInteraction({
      kind: "move",
      startX: event.clientX,
      startY: event.clientY,
      startRect: activeRect,
    });
  };

  const startResize =
    (handle: CropHandle) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setInteraction({
        kind: "resize",
        handle,
        startX: event.clientX,
        startY: event.clientY,
        startRect: activeRect,
      });
    };

  const resetViewState = () => {
    setMetrics(null);
    setCropRect(null);
    setInteraction(null);
  };

  const resetToOriginal = () => {
    if (!initialSnapshot) return;
    setWorkingSnapshot(initialSnapshot);
    setUndoStack([]);
    resetViewState();
  };

  const undoCrop = () => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setWorkingSnapshot(previous);
    setUndoStack((stack) => stack.slice(0, -1));
    resetViewState();
  };

  const previewCrop = async () => {
    if (!workingSnapshot || applying) return;
    setApplying(true);
    try {
      const area = rectToNaturalArea(
        clampCropRect(
          activeRect,
          {
            width: activeMetrics.displayedWidth,
            height: activeMetrics.displayedHeight,
          },
          MIN_CROP_SIZE,
        ),
        activeMetrics,
      );
      const blob = await dataUrlToBlob(workingSnapshot.image);
      const cropped = await cropBlobByArea(blob, area);
      const croppedDataUrl = await blobToDataUrl(cropped);
      const baseName = getBaseLabel(workingSnapshot.label);
      setUndoStack((stack) => [
        ...stack.slice(-(MAX_UNDO_STACK - 1)),
        workingSnapshot,
      ]);
      setWorkingSnapshot(
        createSnapshot(
          croppedDataUrl,
          `${baseName} · crop ${area.width}×${area.height}`,
          area.width,
          area.height,
        ),
      );
      resetViewState();
    } catch {
      onError("원본 이미지 crop 실패");
    } finally {
      setApplying(false);
    }
  };

  const finalApply = () => {
    if (!workingSnapshot) return;
    onApply(
      workingSnapshot.image,
      workingSnapshot.label,
      workingSnapshot.width,
      workingSnapshot.height,
    );
  };

  if (!open || !image || !workingSnapshot) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="원본 이미지 크롭"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "rgba(15, 14, 12, .58)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
      }}
    >
      <div
        style={{
          width: "min(1180px, calc(100vw - 48px))",
          maxHeight: "calc(100vh - 48px)",
          display: "grid",
          gridTemplateRows: "auto minmax(0, 1fr) auto",
          overflow: "hidden",
          borderRadius: "var(--radius-lg)",
          border: "1px solid rgba(255,255,255,.42)",
          background: "var(--bg)",
          boxShadow: "0 24px 80px rgba(0,0,0,.28)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "16px 18px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0,
              }}
            >
              EDIT SOURCE
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 18,
                fontWeight: 700,
                color: "var(--ink)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              원본 이미지 크롭
            </div>
          </div>
          <button
            type="button"
            title="닫기"
            onClick={onCancel}
            style={iconButtonStyle}
          >
            <Icon name="x" size={15} />
          </button>
        </header>

        <div
          style={{
            minHeight: 0,
            overflow: "auto",
            padding: 18,
            display: "grid",
            placeItems: "center",
            background:
              "linear-gradient(45deg, rgba(0,0,0,.035) 25%, transparent 25%), linear-gradient(-45deg, rgba(0,0,0,.035) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(0,0,0,.035) 75%), linear-gradient(-45deg, transparent 75%, rgba(0,0,0,.035) 75%)",
            backgroundSize: "20px 20px",
            backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0",
          }}
        >
          <div
            style={{
              position: "relative",
              display: "inline-block",
              maxWidth: "100%",
              userSelect: "none",
              touchAction: "none",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={workingSnapshot.image}
              alt={workingSnapshot.label}
              onLoad={(event) => updateMetrics(event.currentTarget)}
              draggable={false}
              style={{
                display: "block",
                maxWidth: "100%",
                maxHeight: "calc(100vh - 260px)",
                objectFit: "contain",
              }}
            />
            <div
              data-testid="source-crop-rect"
              onPointerDown={startMove}
              style={{
                position: "absolute",
                left: activeRect.x,
                top: activeRect.y,
                width: activeRect.width,
                height: activeRect.height,
                cursor: "move",
                border: "2px dashed rgba(12,18,22,.9)",
                boxShadow:
                  "0 0 0 9999px rgba(0,0,0,.38), 0 0 0 1px rgba(255,255,255,.28)",
                background:
                  "linear-gradient(rgba(255,255,255,.16), rgba(255,255,255,.03))",
              }}
            >
              {HANDLES.map((handle) => (
                <button
                  key={handle}
                  type="button"
                  aria-label={`crop handle ${handle}`}
                  onPointerDown={startResize(handle)}
                  style={{
                    ...cropHandleStyle(handle),
                    ...handlePosition(handle),
                    cursor: handleCursor(handle),
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <footer
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "14px 18px",
            borderTop: "1px solid var(--line)",
            background: "var(--surface)",
          }}
        >
          <div
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-3)", letterSpacing: 0 }}
          >
            X {Math.round(naturalArea.x)} · Y {Math.round(naturalArea.y)} · W{" "}
            {Math.round(naturalArea.width)} · H {Math.round(naturalArea.height)}
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              onClick={resetToOriginal}
              style={secondaryButtonStyle}
            >
              원본으로 초기화
            </button>
            <button
              type="button"
              onClick={undoCrop}
              disabled={undoStack.length === 0}
              style={disabledStyle(
                secondaryButtonStyle,
                undoStack.length === 0,
              )}
            >
              되돌리기
            </button>
            <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
              취소
            </button>
            <button
              type="button"
              onClick={() => void previewCrop()}
              disabled={applying}
              style={disabledStyle(secondaryButtonStyle, applying)}
            >
              {applying ? "미리 적용 중" : "크롭 미리 적용"}
            </button>
            <button
              type="button"
              onClick={finalApply}
              disabled={applying}
              style={disabledStyle(primaryButtonStyle, applying)}
            >
              최종 적용
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function createSnapshot(
  image: string,
  label: string,
  width: number,
  height: number,
): CropSnapshot {
  return {
    image,
    label,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function getBaseLabel(value: string): string {
  return value.split(" · ")[0] || "source.png";
}

function createInitialRect(metrics: DisplayedImageMetrics): CropRect {
  const width = Math.max(
    MIN_CROP_SIZE,
    Math.round(metrics.displayedWidth * 0.8),
  );
  const height = Math.max(
    MIN_CROP_SIZE,
    Math.round(metrics.displayedHeight * 0.8),
  );
  return clampCropRect(
    {
      x: Math.round((metrics.displayedWidth - width) / 2),
      y: Math.round((metrics.displayedHeight - height) / 2),
      width,
      height,
    },
    {
      width: metrics.displayedWidth,
      height: metrics.displayedHeight,
    },
    MIN_CROP_SIZE,
  );
}

function handlePosition(handle: CropHandle): CSSProperties {
  const center = "50%";
  const edge = -8;
  const positions: Record<CropHandle, CSSProperties> = {
    n: { top: edge, left: center, transform: "translateX(-50%)" },
    s: { bottom: edge, left: center, transform: "translateX(-50%)" },
    e: { right: edge, top: center, transform: "translateY(-50%)" },
    w: { left: edge, top: center, transform: "translateY(-50%)" },
    nw: { top: edge, left: edge },
    ne: { top: edge, right: edge },
    sw: { bottom: edge, left: edge },
    se: { bottom: edge, right: edge },
  };
  return positions[handle];
}

function handleCursor(handle: CropHandle): string {
  if (handle === "n" || handle === "s") return "ns-resize";
  if (handle === "e" || handle === "w") return "ew-resize";
  if (handle === "nw" || handle === "se") return "nwse-resize";
  return "nesw-resize";
}

function cropHandleStyle(handle: CropHandle): CSSProperties {
  const base: CSSProperties = {
    all: "unset",
    position: "absolute",
    boxSizing: "border-box",
  };
  const grip: CSSProperties = {
    ...base,
    borderRadius: 2,
    background: "rgba(255,255,255,.92)",
    border: "1px solid rgba(15,18,20,.52)",
    boxShadow:
      "0 0 0 1px rgba(255,255,255,.48), 0 2px 9px rgba(0,0,0,.32)",
  };

  if (handle === "n" || handle === "s") {
    return { ...grip, width: 88, height: 12 };
  }
  if (handle === "e" || handle === "w") {
    return { ...grip, width: 12, height: 88 };
  }

  const corner: CSSProperties = {
    ...base,
    width: 44,
    height: 44,
    background: "transparent",
  };
  const fill = "12px solid rgba(255,255,255,.92)";
  const shadow = "drop-shadow(0 2px 5px rgba(0,0,0,.42))";
  const cornerBorders: Partial<Record<CropHandle, CSSProperties>> = {
    nw: {
      borderTop: fill,
      borderLeft: fill,
      filter: shadow,
    },
    ne: {
      borderTop: fill,
      borderRight: fill,
      filter: shadow,
    },
    sw: {
      borderBottom: fill,
      borderLeft: fill,
      filter: shadow,
    },
    se: {
      borderBottom: fill,
      borderRight: fill,
      filter: shadow,
    },
  };
  return { ...corner, ...cornerBorders[handle] };
}

function disabledStyle<T extends CSSProperties>(
  style: T,
  disabled: boolean,
): CSSProperties {
  if (!disabled) return style;
  return {
    ...style,
    opacity: 0.48,
    cursor: "not-allowed",
  };
}

const iconButtonStyle = {
  all: "unset",
  width: 32,
  height: 32,
  borderRadius: "var(--radius-sm)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  color: "var(--ink-2)",
} as const;

const secondaryButtonStyle = {
  all: "unset",
  cursor: "pointer",
  padding: "8px 13px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--line)",
  background: "var(--bg)",
  color: "var(--ink-2)",
  fontSize: 12,
  fontWeight: 700,
} as const;

const primaryButtonStyle = {
  all: "unset",
  cursor: "pointer",
  padding: "9px 15px",
  borderRadius: "var(--radius-sm)",
  background: "var(--ink)",
  color: "var(--bg)",
  fontSize: 12,
  fontWeight: 800,
} as const;
