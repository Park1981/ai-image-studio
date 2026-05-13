/**
 * ResultBox 통일 검증 — VideoContent 를 .ais-result-hero-edit 외곽에 주입.
 */

import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ResultBox } from "@/components/studio/ResultBox";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import VideoContent from "@/components/studio/VideoContent";

afterEach(() => cleanup());

it("done 상태 — outermost element 가 .ais-result-hero + edit className 보유", () => {
  const { container } = render(
    <ResultBox state="done" modifier="edit">
      <VideoContent src="http://example.com/test.mp4" />
    </ResultBox>,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero");
  expect(root!.className).toContain("ais-result-hero-edit");
  expect(root!.className).not.toContain("ais-result-hero-plain");
});

it("mock done 상태 — 통일 외곽 안에서 mock 안내를 보존한다", () => {
  const { container } = render(
    <ResultBox state="done" modifier="edit">
      <VideoContent src="mock-seed://video" />
    </ResultBox>,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-edit");
  expect(screen.getByText("Mock 영상 생성 완료")).toBeInTheDocument();
});

it("idle 상태 — emptyState 도 통일 외곽 안에 렌더한다", () => {
  const { container } = render(
    <ResultBox
      state="idle"
      modifier="edit"
      emptyState={<StudioEmptyState size="normal">비어있음</StudioEmptyState>}
    />,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-edit");
  expect(screen.getByText("비어있음")).toBeInTheDocument();
});

it("loading 상태 — 텍스트 없는 빈 placeholder 로 전환한다", () => {
  const { container } = render(
    <ResultBox state="loading" modifier="edit">
      <VideoContent src="http://example.com/test.mp4" />
    </ResultBox>,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero-edit");
  expect(screen.getByTestId("result-box-loading-placeholder")).toBeInTheDocument();
  expect(screen.queryByText(/영상 생성 중/)).not.toBeInTheDocument();
});
