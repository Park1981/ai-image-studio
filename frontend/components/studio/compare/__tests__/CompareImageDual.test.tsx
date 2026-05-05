/**
 * CompareImageDual — 분리 thumbnail 좌/우 + on-demand 버튼 단위 테스트.
 * spec §5.3.2 + §5.3.7: 두 이미지 thumbnail + "이 이미지 t2i prompt 만들기" 버튼 + 결과 펼침.
 *
 * 핵심 invariant:
 *  - inFlight 비어있을 때 양쪽 버튼 활성
 *  - inFlight=image1 일 때 양쪽 버튼 모두 disabled (전역 직렬화)
 *  - image1Prompt/image2Prompt 가 차면 결과 영역 노출
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CompareImageDual from "../CompareImageDual";

const SAMPLE_PROMPT = {
  summary: "샘플 요약",
  positive_prompt: "a portrait of a person",
  negative_prompt: "",
  key_visual_anchors: ["anchor1"],
  uncertain: [],
};

describe("CompareImageDual", () => {
  it("두 썸네일 + 양쪽 합성 버튼 렌더 (idle 상태)", () => {
    render(
      <CompareImageDual
        image1Url="https://example.com/a.png"
        image2Url="https://example.com/b.png"
        image1Prompt={null}
        image2Prompt={null}
        inFlight={null}
        onPromptRequest={vi.fn()}
        onPromptReset={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: /이 이미지 t2i prompt 만들기/ });
    expect(buttons).toHaveLength(2);
    buttons.forEach((b) => expect((b as HTMLButtonElement).disabled).toBe(false));
  });

  it("inFlight=image1 일 때 양쪽 버튼 모두 disabled (전역 직렬화)", () => {
    render(
      <CompareImageDual
        image1Url="x"
        image2Url="y"
        image1Prompt={null}
        image2Prompt={null}
        inFlight="image1"
        onPromptRequest={vi.fn()}
        onPromptReset={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: /이 이미지 t2i prompt 만들기|합성 중/ });
    buttons.forEach((b) => expect((b as HTMLButtonElement).disabled).toBe(true));
  });

  it("image1 버튼 클릭 → onPromptRequest('image1') 호출", () => {
    const onRequest = vi.fn();
    render(
      <CompareImageDual
        image1Url="x"
        image2Url="y"
        image1Prompt={null}
        image2Prompt={null}
        inFlight={null}
        onPromptRequest={onRequest}
        onPromptReset={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: /이 이미지 t2i prompt 만들기/ });
    fireEvent.click(buttons[0]);
    expect(onRequest).toHaveBeenCalledWith("image1");
  });

  it("image1Prompt 차면 결과 영역에 positive_prompt 노출", () => {
    render(
      <CompareImageDual
        image1Url="x"
        image2Url="y"
        image1Prompt={SAMPLE_PROMPT}
        image2Prompt={null}
        inFlight={null}
        onPromptRequest={vi.fn()}
        onPromptReset={vi.fn()}
      />,
    );
    expect(screen.getByText(/a portrait of a person/)).toBeTruthy();
  });

  it("image1Prompt 차면 image1 영역에 reset 버튼 노출 → onPromptReset('image1') 호출", () => {
    const onReset = vi.fn();
    render(
      <CompareImageDual
        image1Url="x"
        image2Url="y"
        image1Prompt={SAMPLE_PROMPT}
        image2Prompt={null}
        inFlight={null}
        onPromptRequest={vi.fn()}
        onPromptReset={onReset}
      />,
    );
    const resetBtn = screen.getByRole("button", { name: /재합성|초기화/ });
    fireEvent.click(resetBtn);
    expect(onReset).toHaveBeenCalledWith("image1");
  });
});
