import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ResultBox } from "@/components/studio/ResultBox";

afterEach(() => cleanup());

it("idle 상태는 emptyState 를 통일 외곽 안에 렌더한다", () => {
  const { container } = render(
    <ResultBox state="idle" emptyState={<div>비어있음</div>} />,
  );

  const root = container.firstElementChild as HTMLElement | null;
  expect(root).not.toBeNull();
  expect(root).toHaveClass("ais-result-hero");
  expect(root).toHaveAttribute("data-result-state", "idle");
  expect(screen.getByText("비어있음")).toBeInTheDocument();
});

it("loading 상태는 빈 placeholder 와 effectOverlay slot 을 렌더한다", () => {
  render(
    <ResultBox
      state="loading"
      loadingLabel="GENERATING IMAGE"
      effectOverlay={<div data-testid="effect">효과</div>}
    />,
  );

  const placeholder = screen.getByTestId("result-box-loading-placeholder");
  expect(placeholder).toBeInTheDocument();
  expect(placeholder).toHaveAttribute("aria-label", "GENERATING IMAGE");
  expect(screen.getByText("GENERATING IMAGE")).toHaveClass(
    "ais-result-loading-label",
  );
  expect(screen.getByTestId("result-loading-dots")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  expect(screen.getByTestId("effect")).toBeInTheDocument();
});

it("done 상태에서만 children 을 렌더한다", () => {
  render(
    <ResultBox state="done">
      <div>완료 본문</div>
    </ResultBox>,
  );

  expect(screen.getByText("완료 본문")).toBeInTheDocument();
});

it("loading 이 낀 상태 전환만 fade 대상으로 표시한다", () => {
  const { container, rerender } = render(
    <ResultBox state="done">
      <div>완료 본문</div>
    </ResultBox>,
  );
  const root = container.firstElementChild as HTMLElement;
  expect(root).toHaveAttribute("data-result-transition", "instant");

  rerender(
    <ResultBox state="loading">
      <div>완료 본문</div>
    </ResultBox>,
  );
  expect(root).toHaveAttribute("data-result-transition", "fade");

  rerender(<ResultBox state="idle" emptyState={<div>비어있음</div>} />);
  expect(root).toHaveAttribute("data-result-transition", "fade");

  rerender(
    <ResultBox state="done">
      <div>다시 완료</div>
    </ResultBox>,
  );
  expect(root).toHaveAttribute("data-result-transition", "instant");
});

it("plain variant 는 plain 외곽만 적용한다", () => {
  const { container } = render(<ResultBox state="idle" variant="plain" />);
  const root = container.firstElementChild as HTMLElement | null;

  expect(root).not.toBeNull();
  expect(root).toHaveClass("ais-result-hero-plain");
  expect(root).not.toHaveClass("ais-result-hero");
});

it("edit modifier 는 hero + edit 외곽 조합을 적용한다", () => {
  const { container } = render(<ResultBox state="idle" modifier="edit" />);
  const root = container.firstElementChild as HTMLElement | null;

  expect(root).not.toBeNull();
  expect(root).toHaveClass("ais-result-hero");
  expect(root).toHaveClass("ais-result-hero-edit");
});
