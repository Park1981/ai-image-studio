/**
 * CompareImageDetailDrawer — V4 on-demand prompt 결과 펼침 단위 테스트.
 * spec §5.3.7: 인라인 spinner + 결과 펼침 + 복사 + 재합성 버튼.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CompareImageDetailDrawer from "../CompareImageDetailDrawer";

afterEach(() => {
  vi.restoreAllMocks();
});

const SAMPLE = {
  summary: "샘플 요약",
  positive_prompt: "a portrait of a person",
  negative_prompt: "blurry",
  key_visual_anchors: ["face", "background"],
  uncertain: ["lighting"],
};

describe("CompareImageDetailDrawer", () => {
  it("loading=true 일 때 spinner + '프롬프트 합성 중...' 메시지", () => {
    render(
      <CompareImageDetailDrawer
        prompt={null}
        loading
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/프롬프트 합성 중/)).toBeTruthy();
  });

  it("prompt 차고 loading=false 일 때 summary + positive_prompt 노출", () => {
    render(
      <CompareImageDetailDrawer
        prompt={SAMPLE}
        loading={false}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("샘플 요약")).toBeTruthy();
    expect(screen.getByText(/a portrait of a person/)).toBeTruthy();
  });

  it("복사 버튼 클릭 → navigator.clipboard.writeText(positive_prompt) 호출", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(
      <CompareImageDetailDrawer
        prompt={SAMPLE}
        loading={false}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /복사/ }));
    expect(writeText).toHaveBeenCalledWith("a portrait of a person");
  });

  it("재합성 버튼 클릭 → onCancel 호출", () => {
    const onCancel = vi.fn();
    render(
      <CompareImageDetailDrawer
        prompt={SAMPLE}
        loading={false}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /재합성|초기화/ }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("prompt=null + loading=false 면 미렌더", () => {
    const { container } = render(
      <CompareImageDetailDrawer
        prompt={null}
        loading={false}
        onCancel={vi.fn()}
      />,
    );
    expect(container.querySelector(".ais-compare-image-drawer")).toBeNull();
  });

  it("key_visual_anchors 가 있으면 anchor 칩으로 노출", () => {
    render(
      <CompareImageDetailDrawer
        prompt={SAMPLE}
        loading={false}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("face")).toBeTruthy();
    expect(screen.getByText("background")).toBeTruthy();
  });
});
