/**
 * CompareTransformBox — V4 transform_prompt 박스 단위 테스트.
 * spec §5.3.6: 영문 prompt 박스 + "복사" 버튼 + "한국어 ▾" 토글.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CompareTransformBox from "../CompareTransformBox";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CompareTransformBox", () => {
  it("영문 prompt 본문 + 복사 버튼 + 한국어 토글 노출", () => {
    render(
      <CompareTransformBox
        transformPromptEn="add wings to subject"
        transformPromptKo="피사체에 날개 추가"
      />,
    );
    expect(screen.getByText(/add wings to subject/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /복사/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /한국어/ })).toBeTruthy();
    // 한국어 default 미노출
    expect(screen.queryByText("피사체에 날개 추가")).toBeNull();
  });

  it("한국어 토글 클릭 시 한국어 본문 노출", () => {
    render(
      <CompareTransformBox
        transformPromptEn="add wings"
        transformPromptKo="날개 추가"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /한국어/ }));
    expect(screen.getByText("날개 추가")).toBeTruthy();
  });

  it("transformPromptKo 가 영어 fallback 이면 한국어 토글을 숨김", () => {
    render(
      <CompareTransformBox
        transformPromptEn="add wings"
        transformPromptKo="add wings"
      />,
    );
    expect(screen.queryByRole("button", { name: /한국어/ })).toBeNull();
    expect(screen.getByText("add wings").getAttribute("lang")).toBe("en");
  });

  it("복사 버튼 클릭 → navigator.clipboard.writeText(en) 호출", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(
      <CompareTransformBox
        transformPromptEn="add wings to subject"
        transformPromptKo="피사체에 날개 추가"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /복사/ }));
    expect(writeText).toHaveBeenCalledWith("add wings to subject");
  });

  it("transformPromptEn + Ko 둘 다 빈 문자열이면 미렌더", () => {
    const { container } = render(
      <CompareTransformBox transformPromptEn="" transformPromptKo="" />,
    );
    expect(container.querySelector(".ais-compare-transform")).toBeNull();
  });
});
