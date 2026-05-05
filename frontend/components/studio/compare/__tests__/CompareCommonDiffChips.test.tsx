/**
 * CompareCommonDiffChips — V4 공통점/차이점 칩 영역 단위 테스트.
 * spec §5.3.3: 좌측 cyan "공통점" + 우측 amber "차이점" + 칩 hover 영문 tooltip.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CompareCommonDiffChips from "../CompareCommonDiffChips";

describe("CompareCommonDiffChips", () => {
  it("공통점/차이점 라벨 + 칩 N개 렌더 (한국어)", () => {
    render(
      <CompareCommonDiffChips
        commonPointsKo={["둘 다 인물", "둘 다 야외"]}
        commonPointsEn={["both portraits", "both outdoor"]}
        keyDifferencesKo={["조명 다름"]}
        keyDifferencesEn={["different lighting"]}
      />,
    );
    expect(screen.getByText("공통점")).toBeTruthy();
    expect(screen.getByText("차이점")).toBeTruthy();
    expect(screen.getByText("둘 다 인물")).toBeTruthy();
    expect(screen.getByText("둘 다 야외")).toBeTruthy();
    expect(screen.getByText("조명 다름")).toBeTruthy();
  });

  it("ko 칩의 title 속성에 영문 원문 (hover tooltip)", () => {
    render(
      <CompareCommonDiffChips
        commonPointsKo={["둘 다 인물"]}
        commonPointsEn={["both portraits"]}
        keyDifferencesKo={["조명 다름"]}
        keyDifferencesEn={["different lighting"]}
      />,
    );
    const commonChip = screen.getByText("둘 다 인물");
    expect(commonChip.getAttribute("title")).toBe("both portraits");
    const diffChip = screen.getByText("조명 다름");
    expect(diffChip.getAttribute("title")).toBe("different lighting");
  });

  it("ko 배열보다 en 배열이 짧으면 title 미설정 (안전한 인덱스 매칭)", () => {
    render(
      <CompareCommonDiffChips
        commonPointsKo={["A", "B"]}
        commonPointsEn={["only A"]}
        keyDifferencesKo={[]}
        keyDifferencesEn={[]}
      />,
    );
    expect(screen.getByText("A").getAttribute("title")).toBe("only A");
    expect(screen.getByText("B").getAttribute("title")).toBeNull();
  });

  it("commonPointsKo + keyDifferencesKo 둘 다 빈 배열이면 컴포넌트 자체 미렌더 (또는 빈 결과)", () => {
    const { container } = render(
      <CompareCommonDiffChips
        commonPointsKo={[]}
        commonPointsEn={[]}
        keyDifferencesKo={[]}
        keyDifferencesEn={[]}
      />,
    );
    expect(container.querySelector(".ais-compare-chips")).toBeNull();
  });
});
