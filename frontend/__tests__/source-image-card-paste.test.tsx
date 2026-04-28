/**
 * SourceImageCard 의 pasteRequireHover prop 동작 단위 테스트.
 * Multi-ref 페이지에서 두 카드가 paste 충돌 안 하도록 StudioUploadSlot 에
 * prop 이 정확히 전달되는지 검증.
 *
 * 2026-04-27 (Edit Multi-Reference Phase 2 · Codex 2차 리뷰 fix #3 · 3차 리뷰 fix).
 * 단순 container truthy 검증은 의미가 약하므로 StudioUploadSlot 을 mock 하고
 * 그 prop 값을 직접 assert.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import SourceImageCard from "@/components/studio/SourceImageCard";

// vi.hoisted 로 mock 호출 추적용 상태 — vi.mock 내부에서 참조 가능.
const slotState = vi.hoisted(() => ({
  lastProps: null as null | { pasteRequireHover?: boolean },
}));

vi.mock("@/components/studio/StudioUploadSlot", () => ({
  default: (props: { pasteRequireHover?: boolean }) => {
    slotState.lastProps = props;
    return <div data-testid="studio-upload-slot" />;
  },
}));

describe("SourceImageCard - pasteRequireHover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    slotState.lastProps = null;
  });

  it("default false: StudioUploadSlot 에 pasteRequireHover=false 전달", () => {
    const onChange = vi.fn();
    render(
      <SourceImageCard
        sourceImage={null}
        sourceLabel=""
        sourceWidth={null}
        sourceHeight={null}
        onChange={onChange}
        onClear={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(slotState.lastProps?.pasteRequireHover).toBe(false);
  });

  it("pasteRequireHover=true: StudioUploadSlot 에 true 전달", () => {
    const onChange = vi.fn();
    render(
      <SourceImageCard
        sourceImage={null}
        sourceLabel=""
        sourceWidth={null}
        sourceHeight={null}
        onChange={onChange}
        onClear={vi.fn()}
        onError={vi.fn()}
        pasteRequireHover
      />,
    );
    expect(slotState.lastProps?.pasteRequireHover).toBe(true);
  });
});
