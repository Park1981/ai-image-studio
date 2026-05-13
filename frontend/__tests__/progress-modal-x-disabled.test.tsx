import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ProgressModal from "@/components/studio/ProgressModal";
import { useGenerateStore } from "@/stores/useGenerateStore";

afterEach(() => {
  cleanup();
  useGenerateStore.getState().resetRunning();
});

it("진행 중에는 X 버튼을 비활성화하고 닫기 콜백을 호출하지 않는다", () => {
  useGenerateStore.getState().setRunning(true);
  const onClose = vi.fn();

  render(<ProgressModal mode="generate" onClose={onClose} />);

  const closeBtn = screen.getByRole("button", {
    name: "진행 중에는 닫을 수 없습니다",
  });
  expect(closeBtn).toBeDisabled();

  fireEvent.click(closeBtn);
  expect(onClose).not.toHaveBeenCalled();
});

it("진행이 끝나면 X 버튼을 다시 활성화한다", () => {
  useGenerateStore.getState().resetRunning();
  const onClose = vi.fn();

  render(<ProgressModal mode="generate" onClose={onClose} />);

  const closeBtn = screen.getByRole("button", { name: "모달 닫기" });
  expect(closeBtn).not.toBeDisabled();

  fireEvent.click(closeBtn);
  expect(onClose).toHaveBeenCalledTimes(1);
});

