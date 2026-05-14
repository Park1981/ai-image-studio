/**
 * Phase 4 검증 — CompareViewer (매트) + CompareAnalysisPanel (Plain) 통일.
 *
 * Phase 4.1: CompareViewer 외곽이 .ais-result-hero + .ais-result-hero-edit.
 * Phase 4.2: CompareAnalysisPanel 외곽이 .ais-result-hero-plain.
 *
 * 2026-05-05 Block 2 Phase 8: VisionCompareAnalysis (5축) → VisionCompareAnalysisV4 fixture 교체.
 */

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CompareViewer from "@/components/studio/compare/CompareViewer";
import CompareAnalysisPanel from "@/components/studio/compare/CompareAnalysisPanel";
import type { VisionCompareImage } from "@/stores/useVisionCompareStore";
import type { VisionCompareAnalysisV4 } from "@/lib/api/types";

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

// V4 minimal fixture (옛 5축 score/comments 폐기 · 2-stage observe + diff_synthesize)
const minimalAnalysisV4: VisionCompareAnalysisV4 = {
  summaryEn: "Two portraits, similar style.",
  summaryKo: "두 인물 사진, 비슷한 스타일.",
  commonPointsEn: ["both portraits"],
  commonPointsKo: ["둘 다 인물"],
  keyDifferencesEn: ["different lighting"],
  keyDifferencesKo: ["조명 다름"],
  domainMatch: "person",
  categoryDiffs: {},
  categoryScores: {},
  keyAnchors: [],
  fidelityScore: 80,
  transformPromptEn: "",
  transformPromptKo: "",
  uncertainEn: "",
  uncertainKo: "",
  observation1: {},
  observation2: {},
  provider: "ollama",
  fallback: false,
  analyzedAt: 0,
  visionModel: "qwen3-vl:8b",
  textModel: "gemma4-un:latest",
};

it("CompareAnalysisPanel — analysis 있을 때 .ais-result-hero-plain 적용", () => {
  const { container } = render(
    <CompareAnalysisPanel
      running={false}
      analysis={minimalAnalysisV4}
      image1Url={imageA.dataUrl}
      image2Url={imageB.dataUrl}
      perImageInFlight={null}
      perImagePromptImage1={null}
      perImagePromptImage2={null}
      onPerImagePromptRequest={vi.fn()}
      onPerImagePromptReset={vi.fn()}
    />,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-plain");
  expect(root).toHaveAttribute("data-result-state", "done");
  expect(root!.className).not.toContain("ais-compare-analysis-card");
});

it("CompareAnalysisPanel — running 시에도 outer wrapper 에 .ais-result-hero-plain 적용", () => {
  const { container } = render(
    <CompareAnalysisPanel
      running={true}
      analysis={null}
      image1Url={null}
      image2Url={null}
      perImageInFlight={null}
      perImagePromptImage1={null}
      perImagePromptImage2={null}
      onPerImagePromptRequest={vi.fn()}
      onPerImagePromptReset={vi.fn()}
    />,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-plain");
  expect(root).toHaveAttribute("data-result-state", "loading");
  expect(screen.getByTestId("result-box-loading-placeholder")).toBeInTheDocument();
  expect(screen.getByText("비교 분석 중…")).toBeInTheDocument();
  expect(root!.className).not.toContain("ais-compare-analysis-card");
});
