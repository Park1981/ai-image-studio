/**
 * CompareUncertainBox — V4 uncertain 박스 단위 테스트.
 * spec §5.3.8: 비어있지 않으면 페이지 끝에 작은 회색 박스 (영문 + 한국어).
 * 둘 다 빈 문자열이면 미렌더.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CompareUncertainBox from "../CompareUncertainBox";

describe("CompareUncertainBox", () => {
  it("ko + en 모두 있으면 둘 다 노출", () => {
    render(
      <CompareUncertainBox
        uncertainEn="lighting unknown"
        uncertainKo="조명 불확실"
      />,
    );
    expect(screen.getByText(/조명 불확실/)).toBeTruthy();
    expect(screen.getByText(/lighting unknown/)).toBeTruthy();
  });

  it("ko 만 있으면 ko 만 노출", () => {
    render(
      <CompareUncertainBox uncertainEn="" uncertainKo="조명 불확실" />,
    );
    expect(screen.getByText(/조명 불확실/)).toBeTruthy();
  });

  it("ko 슬롯이 영어 fallback 이면 영어 블록으로 한 번만 노출", () => {
    render(
      <CompareUncertainBox
        uncertainEn="lighting unknown"
        uncertainKo="lighting unknown"
      />,
    );
    expect(screen.getAllByText(/lighting unknown/)).toHaveLength(1);
    expect(screen.getByText(/lighting unknown/).getAttribute("lang")).toBe("en");
  });

  it("en 만 있으면 en 만 노출", () => {
    render(
      <CompareUncertainBox uncertainEn="lighting unknown" uncertainKo="" />,
    );
    expect(screen.getByText(/lighting unknown/)).toBeTruthy();
  });

  it("둘 다 빈 문자열이면 미렌더", () => {
    const { container } = render(
      <CompareUncertainBox uncertainEn="" uncertainKo="" />,
    );
    expect(container.querySelector(".ais-compare-uncertain")).toBeNull();
  });

  it("공백 문자열도 미렌더 (trim)", () => {
    const { container } = render(
      <CompareUncertainBox uncertainEn={"   "} uncertainKo={"\t\n"} />,
    );
    expect(container.querySelector(".ais-compare-uncertain")).toBeNull();
  });
});
