/**
 * VideoSizeWarnModal — 컴포넌트 시나리오 테스트.
 * spec: §6.1.3
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import VideoSizeWarnModal from "@/components/studio/video/VideoSizeWarnModal";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VideoSizeWarnModal", () => {
  it("open=false 면 DOM 미렌더", () => {
    const { container } = render(
      <VideoSizeWarnModal
        open={false}
        width={1536}
        height={864}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("open=true 마운트 시 dialog role + 타이틀 + 본문 + 두 버튼 노출", () => {
    render(
      <VideoSizeWarnModal
        open
        width={1536}
        height={864}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("큰 사이즈로 생성할까요?")).toBeTruthy();
    expect(
      screen.getByText(/현재 컴퓨터 제원에서는 생성 시간이 오래 걸리거나/),
    ).toBeTruthy();
    expect(screen.getByText(/1536×864/)).toBeTruthy();
    expect(screen.getByText("취소")).toBeTruthy();
    expect(screen.getByText("그대로 진행")).toBeTruthy();
  });

  it("[취소] 클릭 → onCancel 호출, onConfirm 미호출", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <VideoSizeWarnModal
        open
        width={1280}
        height={720}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText("취소"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("[그대로 진행] 클릭 → onConfirm 호출, onCancel 미호출", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <VideoSizeWarnModal
        open
        width={1280}
        height={720}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText("그대로 진행"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("ESC keydown → onCancel 호출", () => {
    const onCancel = vi.fn();
    render(
      <VideoSizeWarnModal
        open
        width={1280}
        height={720}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Overlay (dialog 자체) 클릭 → onCancel 호출", () => {
    const onCancel = vi.fn();
    render(
      <VideoSizeWarnModal
        open
        width={1280}
        height={720}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    // overlay 는 role="dialog" 의 root element. 자체 클릭만 닫힘 (currentTarget 체크).
    fireEvent.click(screen.getByRole("dialog"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("unmount 시 keydown listener 제거 (cleanup)", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(
      <VideoSizeWarnModal
        open
        width={1280}
        height={720}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("open=true → open=false 전환 시 cleanup 호출", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { rerender } = render(
      <VideoSizeWarnModal
        open
        width={1280}
        height={720}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    rerender(
      <VideoSizeWarnModal
        open={false}
        width={1280}
        height={720}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });
});
