import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VideoLeftPanel from "@/components/studio/video/VideoLeftPanel";
import { useVideoStore } from "@/stores/useVideoStore";

const imageCropMock = vi.hoisted(() => ({
  dataUrlToBlob: vi.fn(async () => new Blob(["source"], { type: "image/png" })),
  cropBlobByArea: vi.fn(async () => new Blob(["cropped"], { type: "image/png" })),
  blobToDataUrl: vi.fn(async () => "data:image/png;base64,VIDEO_CROP"),
}));

vi.mock("@/lib/image-crop", () => imageCropMock);

describe("VideoLeftPanel source crop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVideoStore.setState({
      sourceImage: null,
      sourceLabel: "이미지를 업로드하거나 히스토리에서 선택",
      sourceWidth: null,
      sourceHeight: null,
      sourceOriginal: null,
      sourceIsCropped: false,
      prompt: "",
      running: false,
      pipelineProgress: 0,
      pipelineLabel: "",
    });
  });

  it("crop modal 최종 적용은 video source 와 해상도 기준 크기를 갱신한다", async () => {
    useVideoStore
      .getState()
      .setSource(
        "data:image/png;base64,ORIGINAL",
        "video.png · 1000×800",
        1000,
        800,
      );

    render(
      <VideoLeftPanel
        promptTextareaRef={createRef<HTMLTextAreaElement>()}
        onGenerate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle("이미지 크롭"));
    fireEvent.click(screen.getByRole("button", { name: "크롭 미리 적용" }));

    await waitFor(() =>
      expect(screen.getByAltText("video.png · crop 800×640")).toHaveAttribute(
        "src",
        "data:image/png;base64,VIDEO_CROP",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "최종 적용" }));

    const s = useVideoStore.getState();
    expect(s.sourceImage).toBe("data:image/png;base64,VIDEO_CROP");
    expect(s.sourceLabel).toBe("video.png · crop 800×640");
    expect(s.sourceWidth).toBe(800);
    expect(s.sourceHeight).toBe(640);
    expect(s.sourceIsCropped).toBe(true);
    expect(screen.getByText("CROPPED")).toBeInTheDocument();
    const sourceSizeText = screen
      .getAllByText(/원본/)
      .find((el) => el.textContent?.includes("800×640"));
    expect(sourceSizeText).toBeTruthy();
  });
});
