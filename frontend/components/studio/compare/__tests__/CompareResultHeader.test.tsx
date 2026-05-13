/**
 * CompareResultHeader — V4 결과 헤더 컴포넌트 단위 테스트.
 * spec §5.3.1: summary 좌측 + fidelity chip 우측 (domainMatch=mixed 또는 fidelityScore=null 이면 chip 생략).
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CompareResultHeader from "../CompareResultHeader";

describe("CompareResultHeader", () => {
  it("summaryKo 텍스트 + fidelity chip 표시 (정상 케이스)", () => {
    render(
      <CompareResultHeader
        summaryEn="Two portraits"
        summaryKo="두 인물 비교"
        fidelityScore={87}
        domainMatch="person"
      />,
    );
    expect(screen.getByText("두 인물 비교")).toBeTruthy();
    expect(screen.getByText(/87/)).toBeTruthy();
    expect(screen.getByText(/유사도/)).toBeTruthy();
  });

  it("domainMatch=mixed 일 때 chip 생략", () => {
    render(
      <CompareResultHeader
        summaryEn="Different domains"
        summaryKo="다른 도메인"
        fidelityScore={null}
        domainMatch="mixed"
      />,
    );
    expect(screen.getByText("다른 도메인")).toBeTruthy();
    expect(screen.queryByText(/유사도/)).toBeNull();
  });

  it("fidelityScore=null 일 때도 chip 생략 (동도메인이어도)", () => {
    render(
      <CompareResultHeader
        summaryEn="x"
        summaryKo="x"
        fidelityScore={null}
        domainMatch="person"
      />,
    );
    expect(screen.queryByText(/유사도/)).toBeNull();
  });

  it("score >=90 cyan tone, 80~89 amber, <80 muted (data-tone 속성)", () => {
    const { rerender } = render(
      <CompareResultHeader
        summaryEn="x"
        summaryKo="x"
        fidelityScore={92}
        domainMatch="person"
      />,
    );
    expect(screen.getByText(/유사도/).closest("[data-tone]")?.getAttribute("data-tone")).toBe("cyan");

    rerender(
      <CompareResultHeader
        summaryEn="x"
        summaryKo="x"
        fidelityScore={85}
        domainMatch="person"
      />,
    );
    expect(screen.getByText(/유사도/).closest("[data-tone]")?.getAttribute("data-tone")).toBe("amber");

    rerender(
      <CompareResultHeader
        summaryEn="x"
        summaryKo="x"
        fidelityScore={70}
        domainMatch="person"
      />,
    );
    expect(screen.getByText(/유사도/).closest("[data-tone]")?.getAttribute("data-tone")).toBe("muted");
  });

  it("summaryKo 가 영어 fallback 이면 summaryEn 을 영문으로 표시", () => {
    render(
      <CompareResultHeader
        summaryEn="Both images show the same person."
        summaryKo="Both images show the same person."
        fidelityScore={87}
        domainMatch="person"
      />,
    );
    const summary = screen.getByText("Both images show the same person.");
    expect(summary.getAttribute("lang")).toBe("en");
  });
});
