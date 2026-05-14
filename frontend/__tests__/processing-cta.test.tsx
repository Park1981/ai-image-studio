import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ProcessingCTA from "@/components/studio/ProcessingCTA";

afterEach(() => cleanup());

it("idle 상태에서는 기본 라벨과 아이콘만 렌더한다", () => {
  render(
    <ProcessingCTA
      idleLabel="Generate"
      runningLabel="이미지 생성 중"
      running={false}
    />,
  );

  const button = screen.getByRole("button", { name: "Generate" });
  expect(button).toHaveClass("ais-processing-cta");
  expect(button).toHaveAttribute("data-running", "false");
  expect(button).toHaveAttribute("aria-busy", "false");
  expect(screen.queryByText("%")).not.toBeInTheDocument();
});

it("running 상태에서는 진행률과 서브 라벨을 렌더한다", () => {
  render(
    <ProcessingCTA
      idleLabel="Generate"
      runningLabel="이미지 생성 중"
      running
      progress={54.4}
      subLabel="qwen-image · sampling"
    />,
  );

  const button = screen.getByRole("button", {
    name: /이미지 생성 중 qwen-image · sampling 54%/,
  });
  expect(button).toHaveAttribute("data-running", "true");
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button).toHaveStyle("--p: 54%");
});

it("running 중 disabled 여도 클릭은 막고 진행 상태는 유지한다", () => {
  const onClick = vi.fn();
  render(
    <ProcessingCTA
      idleLabel="Generate"
      runningLabel="이미지 생성 중"
      running
      progress={120}
      disabled
      onClick={onClick}
    />,
  );

  const button = screen.getByRole("button");
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("data-running", "true");
  expect(button).toHaveStyle("--p: 100%");

  fireEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
});
