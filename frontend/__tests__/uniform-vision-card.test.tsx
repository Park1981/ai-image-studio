/**
 * ResultBox 통일 검증 — VisionContent 를 .ais-result-hero-plain 외곽에 주입.
 */

import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ResultBox } from "@/components/studio/ResultBox";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import VisionContent, {
  type VisionCardResult,
} from "@/components/studio/VisionContent";

afterEach(() => cleanup());

// VisionCardResult 의 필수 필드는 en + ko (string | null). 나머지 optional.
const v2Result: VisionCardResult = {
  en: "Young woman in red dress at sunset.",
  ko: "노을 무렵 빨간 드레스 입은 젊은 여성.",
  positivePrompt: "young woman, red dress, sunset",
};

it("V2 done 상태 — outermost element 가 .ais-result-hero-plain wrapper", () => {
  const { container } = render(
    <ResultBox state="done" variant="plain">
      <VisionContent result={v2Result} />
    </ResultBox>,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-plain");
});

it("V1 분기 (positivePrompt 빈값) — 동일하게 .ais-result-hero-plain wrapper", () => {
  const v1Result: VisionCardResult = { ...v2Result, positivePrompt: "" };
  const { container } = render(
    <ResultBox state="done" variant="plain">
      <VisionContent result={v1Result} />
    </ResultBox>,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-plain");
});

it("idle 상태 — emptyState 도 plain wrapper 안에 렌더한다", () => {
  const { container } = render(
    <ResultBox
      state="idle"
      variant="plain"
      emptyState={<StudioEmptyState size="normal">비어있음</StudioEmptyState>}
    />,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-plain");
  expect(screen.getByText("비어있음")).toBeInTheDocument();
});

it("loading 상태 — 텍스트 없는 빈 placeholder 로 전환한다", () => {
  const { container } = render(
    <ResultBox state="loading" variant="plain">
      <VisionContent result={v2Result} />
    </ResultBox>,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-plain");
  expect(screen.getByTestId("result-box-loading-placeholder")).toBeInTheDocument();
  expect(screen.queryByText(/분석 중/)).not.toBeInTheDocument();
});
