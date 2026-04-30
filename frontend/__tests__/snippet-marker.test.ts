/**
 * snippet-marker 헬퍼 단위 테스트 — 9 케이스.
 * 2026-04-30 (Phase 2B Task 5 · plan 2026-04-30-prompt-snippets-library.md).
 */
import { describe, expect, it } from "vitest";
import {
  hasMarker,
  removeMarker,
  stripAllMarkers,
  wrapMarker,
} from "@/lib/snippet-marker";

describe("snippet-marker", () => {
  it("wrapMarker — 기본 prompt 를 <lib>...</lib> 로 감쌈", () => {
    expect(wrapMarker("cinematic 35mm")).toBe("<lib>cinematic 35mm</lib>");
  });

  it("wrapMarker — 양쪽 공백 trim", () => {
    expect(wrapMarker("  warm light  ")).toBe("<lib>warm light</lib>");
  });

  it("hasMarker — textarea 에 마커 포함되면 true", () => {
    const ta = "a girl, <lib>cinematic 35mm</lib>, warm light";
    expect(hasMarker(ta, "cinematic 35mm")).toBe(true);
  });

  it("hasMarker — 마커 없으면 false", () => {
    expect(hasMarker("a girl, warm light", "cinematic 35mm")).toBe(false);
  });

  it("removeMarker — 단일 마커 제거", () => {
    const ta = "a girl, <lib>cinematic 35mm</lib>, warm light";
    expect(removeMarker(ta, "cinematic 35mm")).toBe("a girl, warm light");
  });

  it("removeMarker — 빈 콤마 정리 (앞/뒤/중간)", () => {
    const ta = "<lib>cinematic 35mm</lib>, warm light";
    expect(removeMarker(ta, "cinematic 35mm")).toBe("warm light");
  });

  it("removeMarker — 매칭 안 되면 원본 + 정리", () => {
    const ta = "a girl, warm light";
    expect(removeMarker(ta, "cinematic 35mm")).toBe("a girl, warm light");
  });

  it("stripAllMarkers — 단일 마커 토큰 제거 + 안 내용 보존", () => {
    expect(stripAllMarkers("<lib>X</lib>")).toBe("X");
  });

  it("stripAllMarkers — 다중 마커 모두 제거", () => {
    expect(
      stripAllMarkers("<lib>A</lib> mid <lib>B</lib> end <lib>C</lib>"),
    ).toBe("A mid B end C");
  });
});
