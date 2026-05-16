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
    const resized = resizeCropRect(rect, "se", 120, 20, bounds, 96);
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
