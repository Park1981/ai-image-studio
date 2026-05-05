/**
 * CompareKeyAnchors — V4 key anchor 강조 단위 테스트.
 * spec §5.3.5: domainMatch=mixed 면 항상 펼침 (메인 자리), 동도메인이면 토글 펼침 (보조).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CompareKeyAnchors from "../CompareKeyAnchors";
import type { CompareKeyAnchorJSON } from "@/lib/api/types";

const ANCHORS: CompareKeyAnchorJSON[] = [
  {
    label: "subject",
    image1: "person",
    image2: "cat",
    image1Ko: "사람",
    image2Ko: "고양이",
  },
  {
    label: "background",
    image1: "indoor",
    image2: "outdoor",
    image1Ko: "실내",
    image2Ko: "야외",
  },
];

describe("CompareKeyAnchors", () => {
  it("mixed 도메인 — 항상 펼친 상태로 anchor row 노출", () => {
    render(<CompareKeyAnchors anchors={ANCHORS} domainMatch="mixed" />);
    expect(screen.getByText("사람")).toBeTruthy();
    expect(screen.getByText("고양이")).toBeTruthy();
    expect(screen.getByText("실내")).toBeTruthy();
    expect(screen.getByText("야외")).toBeTruthy();
    // 토글 버튼 미노출 (mixed 는 항상 펼침)
    expect(screen.queryByRole("button", { name: /펼침|접기|key anchor/i })).toBeNull();
  });

  it("동도메인 (person) — 기본 접힘 + 토글 클릭 시 펼침", () => {
    render(<CompareKeyAnchors anchors={ANCHORS} domainMatch="person" />);
    // default 접힘
    expect(screen.queryByText("사람")).toBeNull();
    const toggle = screen.getByRole("button", { name: /key anchor/i });
    fireEvent.click(toggle);
    expect(screen.getByText("사람")).toBeTruthy();
    expect(screen.getByText("고양이")).toBeTruthy();
  });

  it("anchors 빈 배열이면 미렌더 (mixed 도)", () => {
    const { container } = render(
      <CompareKeyAnchors anchors={[]} domainMatch="mixed" />,
    );
    expect(container.querySelector(".ais-compare-anchors")).toBeNull();
  });

  it("anchor row 에 label + image1Ko → image2Ko 형식", () => {
    render(<CompareKeyAnchors anchors={ANCHORS} domainMatch="mixed" />);
    expect(screen.getByText("subject")).toBeTruthy();
    expect(screen.getByText("background")).toBeTruthy();
  });
});
