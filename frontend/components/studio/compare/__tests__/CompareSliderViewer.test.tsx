/**
 * CompareSliderViewer — V4 슬라이더 단위 테스트.
 * spec §5.3.2: BeforeAfter 슬라이더 wrap + letterbox 처리 + drag 핸들 default 50%.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CompareSliderViewer from "../CompareSliderViewer";

describe("CompareSliderViewer", () => {
  it("두 url 받아 BeforeAfterSlider 렌더 (A/B 라벨)", () => {
    const { container } = render(
      <CompareSliderViewer
        image1Url="https://example.com/a.png"
        image2Url="https://example.com/b.png"
      />,
    );
    // BeforeAfterSlider 내부 ais-ba-slider className 존재 확인
    expect(container.querySelector(".ais-ba-slider")).not.toBeNull();
    // A/B 라벨 노출 (compare 시그니처 labelVariant="ab")
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
  });

  it("두 이미지 모두 <img> 로 렌더 (data: 또는 http URL)", () => {
    const { container } = render(
      <CompareSliderViewer
        image1Url="data:image/png;base64,xx"
        image2Url="http://example.com/b.png"
      />,
    );
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBeGreaterThanOrEqual(2);
  });
});
