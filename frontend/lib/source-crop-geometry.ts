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
