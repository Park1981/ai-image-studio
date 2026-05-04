/**
 * Phase 2 검증 — VideoPlayerCard Filled 분기가 .ais-result-hero className 적용.
 * Mock / Empty 분기는 영향 0 (StudioEmptyState 그대로).
 */

import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import VideoPlayerCard from "@/components/studio/VideoPlayerCard";

afterEach(() => cleanup());

it("Filled 분기 — outermost element 가 .ais-result-hero className 보유", () => {
  // valid http-prefixed src → Filled 분기 활성
  const { container } = render(
    <VideoPlayerCard src="http://example.com/test.mp4" running={false} />,
  );
  // 첫 직계 자식 (root element) 가 .ais-result-hero 갖는지
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).toContain("ais-result-hero");
});

it("Mock 분기 — .ais-result-hero className 적용 X (별도 inline dashed 박스 유지)", () => {
  const { container } = render(
    <VideoPlayerCard src="mock-seed://video" running={false} />,
  );
  const root = container.firstChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root!.className).not.toContain("ais-result-hero");
});

it("Empty 분기 (src 없음) — StudioEmptyState 마운트 (.ais-result-hero 없음)", () => {
  const { container } = render(<VideoPlayerCard src="" running={false} />);
  const root = container.firstChild as HTMLElement | null;
  // StudioEmptyState 의 root 가 .ais-result-hero 안 가짐
  if (root) {
    expect(root.className).not.toContain("ais-result-hero");
  }
});
