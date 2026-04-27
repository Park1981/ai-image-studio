/**
 * snapDimension — Qwen/ComfyUI 권장 사이즈 스냅 단위 테스트.
 * 정책: 8의 배수 + 256~2048 clamp.
 */

import { describe, expect, it } from "vitest";

import { snapDimension } from "@/stores/useGenerateStore";

describe("snapDimension", () => {
  it("rounds to nearest multiple of 8", () => {
    expect(snapDimension(1024)).toBe(1024);
    expect(snapDimension(1025)).toBe(1024);
    expect(snapDimension(1028)).toBe(1032);
    expect(snapDimension(1031)).toBe(1032);
  });

  it("clamps below 256 to 256", () => {
    expect(snapDimension(0)).toBe(256);
    expect(snapDimension(100)).toBe(256);
    expect(snapDimension(255)).toBe(256);
  });

  it("clamps above 2048 to 2048", () => {
    expect(snapDimension(2049)).toBe(2048);
    expect(snapDimension(5000)).toBe(2048);
  });

  it("rounds non-integer inputs first then snaps", () => {
    // 1024.7 → round to 1025 → snap to nearest 8 → 1024
    expect(snapDimension(1024.7)).toBe(1024);
    // 1023.4 → round to 1023 → snap → 1024
    expect(snapDimension(1023.4)).toBe(1024);
  });

  it("preserves canonical preset sizes (16:9, 9:16, 4:3)", () => {
    // 1664×928 / 928×1664 / 1472×1104 / 1104×1472 모두 8의 배수
    expect(snapDimension(1664)).toBe(1664);
    expect(snapDimension(928)).toBe(928);
    expect(snapDimension(1472)).toBe(1472);
    expect(snapDimension(1104)).toBe(1104);
  });
});
