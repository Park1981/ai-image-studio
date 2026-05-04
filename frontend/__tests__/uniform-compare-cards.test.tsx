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
  expect(root!.className).toContain("ais-result-hero-edit");
});
