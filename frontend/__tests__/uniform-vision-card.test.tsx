/**
 * Phase 3 검증 — VisionResultCard 의 V2/V1 분기에 .ais-result-hero-plain wrapper.
 * Loading / Empty 분기는 wrapper 없음 (StudioLoadingState/StudioEmptyState 그대로).
 */

import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import VisionResultCard, {
  type VisionCardResult,
} from "@/components/studio/VisionResultCard";

afterEach(() => cleanup());

// VisionCardResult 의 필수 필드는 en + ko (string | null). 나머지 optional.
const v2Result: VisionCardResult = {
  en: "Young woman in red dress at sunset.",
  ko: "노을 무렵 빨간 드레스 입은 젊은 여성.",
  positivePrompt: "young woman, red dress, sunset",
};

it("V2 분기 — outermost element 가 .ais-result-hero-plain wrapper", () => {
  const { container } = render(
    <VisionResultCard result={v2Result} running={false} />,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-plain");
});

it("V1 분기 (positivePrompt 빈값) — 동일하게 .ais-result-hero-plain wrapper", () => {
  const v1Result: VisionCardResult = { ...v2Result, positivePrompt: "" };
  const { container } = render(
    <VisionResultCard result={v1Result} running={false} />,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-plain");
});

it("Empty 분기 (result null) — wrapper 없음 (StudioEmptyState 그대로)", () => {
  const { container } = render(<VisionResultCard result={null} running={false} />);
  const root = container.firstChild as HTMLElement | null;
  // StudioEmptyState 는 항상 DOM 노드를 마운트하므로 non-null 명시 검증
  expect(root).not.toBeNull();
  expect(root!.className).not.toContain("ais-result-hero-plain");
});

it("Loading 분기 (running true) — wrapper 없음 (StudioLoadingState 그대로)", () => {
  const { container } = render(<VisionResultCard result={null} running={true} />);
  const root = container.firstChild as HTMLElement | null;
  // StudioLoadingState 는 항상 DOM 노드를 마운트하므로 non-null 명시 검증
  expect(root).not.toBeNull();
  expect(root!.className).not.toContain("ais-result-hero-plain");
});
