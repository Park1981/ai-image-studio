/**
 * CompareCategoryMatrix — V4 5 카테고리 × 3-col 매트릭스 단위 테스트.
 * spec §5.3.4: 5 row (composition / subject / clothing_or_materials / environment / lighting_camera_style),
 * 3 col (image1 ko / image2 ko / diff ko), 각 row 우상단 영문 펼침 토글.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CompareCategoryMatrix from "../CompareCategoryMatrix";
import type { CompareCategoryDiffJSON } from "@/lib/api/types";

function makeRow(prefix: string): CompareCategoryDiffJSON {
  return {
    image1: `${prefix} en1`,
    image2: `${prefix} en2`,
    diff: `${prefix} diff en`,
    image1Ko: `${prefix} 한1`,
    image2Ko: `${prefix} 한2`,
    diffKo: `${prefix} 차이 한`,
  };
}

describe("CompareCategoryMatrix", () => {
  it("5 카테고리 한국어 라벨 + 한국어 본문 렌더 (default 영문 미노출)", () => {
    render(
      <CompareCategoryMatrix
        categoryDiffs={{
          composition: makeRow("c"),
          subject: makeRow("s"),
          clothing_or_materials: makeRow("cl"),
          environment: makeRow("e"),
          lighting_camera_style: makeRow("l"),
        }}
      />,
    );
    expect(screen.getByText("구도")).toBeTruthy();
    expect(screen.getByText("피사체")).toBeTruthy();
    expect(screen.getByText("의상·재질")).toBeTruthy();
    expect(screen.getByText("환경")).toBeTruthy();
    expect(screen.getByText("광원·카메라·스타일")).toBeTruthy();
    // 한국어 본문
    expect(screen.getByText("c 한1")).toBeTruthy();
    expect(screen.getByText("c 한2")).toBeTruthy();
    expect(screen.getByText("c 차이 한")).toBeTruthy();
    // 영문은 default 미노출
    expect(screen.queryByText("c en1")).toBeNull();
  });

  it("row 우상단 ▾ 토글 클릭 시 영문 본문 노출", () => {
    render(
      <CompareCategoryMatrix
        categoryDiffs={{
          composition: makeRow("c"),
        }}
      />,
    );
    expect(screen.queryByText("c en1")).toBeNull();
    const toggle = screen.getByRole("button", { name: /영문|en/i });
    fireEvent.click(toggle);
    expect(screen.getByText("c en1")).toBeTruthy();
    expect(screen.getByText("c en2")).toBeTruthy();
    expect(screen.getByText("c diff en")).toBeTruthy();
  });

  it("ko 슬롯이 영어 fallback 이면 영어 본문만 표시하고 en 토글은 숨김", () => {
    render(
      <CompareCategoryMatrix
        categoryDiffs={{
          composition: {
            image1: "front portrait",
            image2: "side portrait",
            diff: "head angle differs",
            image1Ko: "front portrait",
            image2Ko: "side portrait",
            diffKo: "head angle differs",
          },
        }}
      />,
    );
    expect(screen.getByText("front portrait").getAttribute("lang")).toBe("en");
    expect(screen.queryByRole("button", { name: /영문|en/i })).toBeNull();
  });

  it("categoryDiffs 빈 dict 면 컴포넌트 미렌더", () => {
    const { container } = render(<CompareCategoryMatrix categoryDiffs={{}} />);
    expect(container.querySelector(".ais-compare-matrix")).toBeNull();
  });

  it("일부 카테고리만 있어도 그것만 렌더 (지정 순서)", () => {
    render(
      <CompareCategoryMatrix
        categoryDiffs={{
          subject: makeRow("s"),
          environment: makeRow("e"),
        }}
      />,
    );
    expect(screen.getByText("피사체")).toBeTruthy();
    expect(screen.getByText("환경")).toBeTruthy();
    expect(screen.queryByText("구도")).toBeNull();
  });
});
