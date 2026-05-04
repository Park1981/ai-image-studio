/**
 * Phase 4 검증 — CompareViewer (매트) + CompareAnalysisPanel (Plain) 통일.
 *
 * Phase 4.1 (이 파일 첫 it): CompareViewer 외곽이 .ais-result-hero + .ais-result-hero-edit.
 * Phase 4.2 (다음 task): CompareAnalysisPanel 이 .ais-result-hero-plain 적용.
 */

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import CompareViewer from "@/components/studio/compare/CompareViewer";
import CompareAnalysisPanel from "@/components/studio/compare/CompareAnalysisPanel";
import type { VisionCompareImage } from "@/stores/useVisionCompareStore";
import type { VisionCompareAnalysis } from "@/lib/api/types";

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

// Phase 4.2 — VisionCompareAnalysis 최소 픽스처
// fields: scores / overall / comments_en / comments_ko / summary_en / summary_ko /
//         provider / fallback / analyzedAt / visionModel (lib/api/types.ts:214)
const minimalAnalysis: VisionCompareAnalysis = {
  scores: {
    composition: 75,
    color: 80,
    subject: 70,
    mood: 65,
    quality: 78,
  },
  overall: 74,
  comments_en: { composition: "", color: "", subject: "", mood: "", quality: "" },
  comments_ko: { composition: "", color: "", subject: "", mood: "", quality: "" },
  summary_en: "",
  summary_ko: "",
  provider: "ollama",
  fallback: false,
  analyzedAt: 0,
  visionModel: "qwen3-vl:8b",
};

it("CompareAnalysisPanel — analysis 있을 때 .ais-result-hero-plain 적용", () => {
  const { container } = render(
    <CompareAnalysisPanel running={false} analysis={minimalAnalysis} />,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-plain");
  expect(root!.className).not.toContain("ais-compare-analysis-card");
});

it("CompareAnalysisPanel — running 시에도 outer wrapper 에 .ais-result-hero-plain 적용", () => {
  const { container } = render(
    <CompareAnalysisPanel running={true} analysis={null} />,
  );
  // 현재 구현: running 시 외곽 <div> 안에 AnalysisLoading 렌더 — root 는 여전히 외곽 wrapper.
  // VisionResultCard 와 다른 패턴 (CompareAnalysisPanel 의 header 가 항상 wrapper 안에 보존되어야 함).
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-plain");        // positive — wrapper 항상 적용
  expect(root!.className).not.toContain("ais-compare-analysis-card"); // 옛 class 부재
});
