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

  it("소수 입력: 1920.4×1080.4 → 16:9 (Math.round · 둘 다 내림)", () => {
    // 1920.4 → 1920, 1080.4 → 1080, GCD 120 → 16:9
    expect(simplifyRatio(1920.4, 1080.4)).toBe("16:9");
  });

  it("2차 가드: 0.4×0.4 → '-' (round 후 0×0)", () => {
    expect(simplifyRatio(0.4, 0.4)).toBe("-");
  });

  it("2차 가드: 0.4×1080 → '-' (round 후 한쪽 0)", () => {
    expect(simplifyRatio(0.4, 1080)).toBe("-");
  });
});
