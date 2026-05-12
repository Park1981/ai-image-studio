import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ImageHistoryPickerDrawer from "@/components/studio/ImageHistoryPickerDrawer";
import type { HistoryItem } from "@/lib/api/types";

afterEach(() => {
  cleanup();
});

const baseItem: HistoryItem = {
  id: "base",
  mode: "generate",
  prompt: "",
  label: "base",
  width: 1024,
  height: 1024,
  seed: 1,
  steps: 20,
  cfg: 7,
  lightning: true,
  model: "test",
  createdAt: Date.UTC(2026, 4, 11),
  imageRef: "/images/studio/base.png",
};

function item(overrides: Partial<HistoryItem>): HistoryItem {
  return { ...baseItem, ...overrides };
}

describe("ImageHistoryPickerDrawer", () => {
  it("shows generate/edit history only and filters by mode", () => {
    render(
      <ImageHistoryPickerDrawer
        open
        items={[
          item({
            id: "generate-1",
            mode: "generate",
            label: "Generated",
            prompt: "generate prompt",
            imageRef: "/images/studio/generate.png",
          }),
          item({
            id: "edit-1",
            mode: "edit",
            label: "Edited",
            prompt: "edit prompt",
            imageRef: "/images/studio/edit.png",
          }),
          item({
            id: "video-1",
            mode: "video",
            label: "Video",
            prompt: "video prompt",
            imageRef: "/images/studio/video.mp4",
          }),
        ]}
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "원본 이미지 선택" })).toBeInTheDocument();
    expect(screen.getByText("전체 2")).toBeInTheDocument();
    expect(screen.getByText("generate prompt")).toBeInTheDocument();
    expect(screen.getByText("edit prompt")).toBeInTheDocument();
    expect(screen.queryByText("video prompt")).toBeNull();

    fireEvent.click(screen.getByText("수정 1"));

    expect(screen.queryByText("generate prompt")).toBeNull();
    expect(screen.getByText("edit prompt")).toBeInTheDocument();
  });

  it("picks an item and closes the drawer", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const picked = item({
      id: "edit-1",
      mode: "edit",
      label: "Edited",
      prompt: "edit prompt",
      imageRef: "/images/studio/edit.png",
    });

    render(
      <ImageHistoryPickerDrawer
        open
        items={[picked]}
        selectedImageRef="/images/studio/edit.png"
        onClose={onClose}
        onPick={onPick}
      />,
    );

    fireEvent.click(screen.getByTitle("edit prompt"));

    expect(onPick).toHaveBeenCalledWith(picked);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
