import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SourceCropModal from "@/components/studio/edit/SourceCropModal";

const imageCropMock = vi.hoisted(() => ({
  dataUrlToBlob: vi.fn(async () => new Blob(["source"], { type: "image/png" })),
  cropBlobByArea: vi.fn(async () => new Blob(["cropped"], { type: "image/png" })),
  blobToDataUrl: vi.fn(async () => "data:image/png;base64,CROPPED"),
}));

vi.mock("@/lib/image-crop", () => imageCropMock);

describe("SourceCropModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageCropMock.blobToDataUrl.mockResolvedValue("data:image/png;base64,CROPPED");
  });

  it("닫힘 상태에서는 렌더하지 않는다", () => {
    const { container } = render(
      <SourceCropModal
        open={false}
        image="data:image/png;base64,AAA"
        label="source.png"
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("열림 상태에서 crop rectangle 과 reset/cancel/apply 버튼을 렌더한다", () => {
    render(
      <SourceCropModal
        open
        image="data:image/png;base64,AAA"
        label="source.png"
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onError={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "원본 이미지 크롭" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("source-crop-rect")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "원본으로 초기화" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "되돌리기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "취소" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "크롭 미리 적용" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "최종 적용" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("crop handle n")).toHaveStyle({
      width: "88px",
      height: "12px",
    });
    expect(screen.getByLabelText("crop handle e")).toHaveStyle({
      width: "12px",
      height: "88px",
    });
  });

  it("Cancel 클릭 시 onCancel 을 호출한다", () => {
    const onCancel = vi.fn();
    render(
      <SourceCropModal
        open
        image="data:image/png;base64,AAA"
        label="source.png"
        onCancel={onCancel}
        onApply={vi.fn()}
        onError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("크롭 미리 적용은 modal 내부 이미지만 바꾸고 최종 적용 전에는 onApply 를 호출하지 않는다", async () => {
    const onApply = vi.fn();
    render(
      <SourceCropModal
        open
        image="data:image/png;base64,ORIGINAL"
        label="source.png"
        onCancel={vi.fn()}
        onApply={onApply}
        onError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "크롭 미리 적용" }));

    await waitFor(() =>
      expect(imageCropMock.blobToDataUrl).toHaveBeenCalledOnce(),
    );
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByAltText("source.png · crop 640×480")).toHaveAttribute(
      "src",
      "data:image/png;base64,CROPPED",
    );
    expect(screen.getByRole("button", { name: "되돌리기" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "최종 적용" }));

    expect(onApply).toHaveBeenCalledWith(
      "data:image/png;base64,CROPPED",
      "source.png · crop 640×480",
      640,
      480,
    );
  });

  it("크롭 미리 적용 없이 최종 적용하면 전달받은 원본 크기를 유지한다", () => {
    const onApply = vi.fn();
    render(
      <SourceCropModal
        open
        image="data:image/png;base64,ORIGINAL"
        label="source.png"
        width={1024}
        height={768}
        onCancel={vi.fn()}
        onApply={onApply}
        onError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "최종 적용" }));

    expect(onApply).toHaveBeenCalledWith(
      "data:image/png;base64,ORIGINAL",
      "source.png",
      1024,
      768,
    );
  });

  it("되돌리기는 직전 preview snapshot 으로 복원한다", async () => {
    imageCropMock.blobToDataUrl
      .mockResolvedValueOnce("data:image/png;base64,CROP1")
      .mockResolvedValueOnce("data:image/png;base64,CROP2");
    render(
      <SourceCropModal
        open
        image="data:image/png;base64,ORIGINAL"
        label="source.png"
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "크롭 미리 적용" }));
    await waitFor(() =>
      expect(screen.getByAltText("source.png · crop 640×480")).toHaveAttribute(
        "src",
        "data:image/png;base64,CROP1",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "크롭 미리 적용" }));
    await waitFor(() =>
      expect(screen.getByAltText("source.png · crop 512×384")).toHaveAttribute(
        "src",
        "data:image/png;base64,CROP2",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));

    expect(screen.getByAltText("source.png · crop 640×480")).toHaveAttribute(
      "src",
      "data:image/png;base64,CROP1",
    );
  });

  it("원본으로 초기화는 preview snapshot 과 되돌리기 stack 을 비운다", async () => {
    const onApply = vi.fn();
    render(
      <SourceCropModal
        open
        image="data:image/png;base64,ORIGINAL"
        label="source.png"
        onCancel={vi.fn()}
        onApply={onApply}
        onError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "크롭 미리 적용" }));
    await waitFor(() =>
      expect(screen.getByAltText("source.png · crop 640×480")).toHaveAttribute(
        "src",
        "data:image/png;base64,CROPPED",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "원본으로 초기화" }));

    expect(screen.getByAltText("source.png")).toHaveAttribute(
      "src",
      "data:image/png;base64,ORIGINAL",
    );
    expect(screen.getByRole("button", { name: "되돌리기" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "최종 적용" }));

    expect(onApply).toHaveBeenCalledWith(
      "data:image/png;base64,ORIGINAL",
      "source.png",
      800,
      600,
    );
  });
});
