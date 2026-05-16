import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  FieldHeaderActionButton,
  StudioFieldHeader,
} from "@/components/studio/StudioFieldHeader";
import StudioPromptInput from "@/components/studio/StudioPromptInput";
import StickyProcessingCTA from "@/components/studio/StickyProcessingCTA";

afterEach(() => cleanup());

it("StudioFieldHeader renders the shared label and action button pattern", () => {
  const onClick = vi.fn();
  render(
    <StudioFieldHeader
      label="원본 이미지"
      accent="blue"
      action={
        <FieldHeaderActionButton icon="grid" onClick={onClick}>
          이미지 히스토리
        </FieldHeaderActionButton>
      }
    />,
  );

  expect(screen.getByText("원본 이미지")).toHaveClass("ais-field-label");
  const button = screen.getByRole("button", { name: "이미지 히스토리" });
  expect(button).toHaveClass("ais-field-action-btn");

  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});

it("StudioPromptInput keeps the shared prompt shell, change, and clear behavior", () => {
  const onChange = vi.fn();
  const { container } = render(
    <StudioPromptInput
      value="old prompt"
      onChange={onChange}
      placeholder="프롬프트 입력"
      clearLabel="프롬프트 비우기"
      rows={3}
    />,
  );

  expect(container.querySelector(".ais-prompt-shell")).toBeTruthy();
  const textarea = screen.getByPlaceholderText("프롬프트 입력");
  expect(textarea).toHaveClass("ais-prompt-textarea");

  fireEvent.change(textarea, { target: { value: "new prompt" } });
  expect(onChange).toHaveBeenCalledWith("new prompt");

  fireEvent.click(screen.getByRole("button", { name: "프롬프트 비우기" }));
  expect(onChange).toHaveBeenLastCalledWith("");
});

it("StickyProcessingCTA wraps ProcessingCTA with the shared sticky shell", () => {
  const { container } = render(
    <StickyProcessingCTA
      idleLabel="Generate"
      runningLabel="이미지 생성 중"
      running={false}
    />,
  );

  expect(container.firstElementChild).toHaveClass("ais-cta-sticky-top");
  expect(screen.getByRole("button", { name: "Generate" })).toHaveClass(
    "ais-processing-cta",
  );
});
