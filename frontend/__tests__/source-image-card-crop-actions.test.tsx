import type { ComponentProps, ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SourceImageCard from "@/components/studio/SourceImageCard";

vi.mock("@/components/studio/StudioUploadSlot", () => ({
  default: ({ children }: { children?: ReactNode }) => {
    return <div data-testid="studio-upload-slot">{children}</div>;
  },
}));

function renderFilled(overrides: Partial<ComponentProps<typeof SourceImageCard>> = {}) {
  const props: ComponentProps<typeof SourceImageCard> = {
    sourceImage: "data:image/png;base64,AAA",
    sourceLabel: "source.png · 1000×800",
    sourceWidth: 1000,
    sourceHeight: 800,
    onChange: vi.fn(),
    onClear: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  render(<SourceImageCard {...props} />);
  return props;
}

describe("SourceImageCard crop controls", () => {
  it("onCrop 이 있으면 crop 버튼을 렌더하고 클릭을 전달한다", () => {
    const onCrop = vi.fn();
    renderFilled({ onCrop });

    fireEvent.click(screen.getByTitle("이미지 크롭"));

    expect(onCrop).toHaveBeenCalledOnce();
  });

  it("cropped 상태이면 restore 버튼과 CROPPED 배지를 렌더한다", () => {
    const onRestoreOriginal = vi.fn();
    renderFilled({ isCropped: true, onRestoreOriginal });

    expect(screen.getByText("CROPPED")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("원본 복원"));

    expect(onRestoreOriginal).toHaveBeenCalledOnce();
  });
});
