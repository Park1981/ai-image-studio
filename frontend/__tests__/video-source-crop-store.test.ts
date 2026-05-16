import { beforeEach, describe, expect, it } from "vitest";
import { useVideoStore } from "@/stores/useVideoStore";

describe("useVideoStore - source crop replace/restore", () => {
  beforeEach(() => {
    useVideoStore.setState({
      sourceImage: null,
      sourceLabel: "이미지를 업로드하거나 히스토리에서 선택",
      sourceWidth: null,
      sourceHeight: null,
      sourceOriginal: null,
      sourceIsCropped: false,
      longerEdgeUserOverride: false,
    });
  });

  it("setSource 는 새 원본을 설정하고 crop snapshot 을 초기화한다", () => {
    useVideoStore
      .getState()
      .setSource("data:image/png;base64,A", "video.png · 1000×800", 1000, 800);

    expect(useVideoStore.getState().sourceOriginal).toBeNull();
    expect(useVideoStore.getState().sourceIsCropped).toBe(false);
  });

  it("applySourceCrop 은 현재 source 를 원본 snapshot 으로 보관하고 crop 결과를 로드한다", () => {
    useVideoStore
      .getState()
      .setSource("data:image/png;base64,A", "video.png · 1000×800", 1000, 800);

    useVideoStore
      .getState()
      .applySourceCrop(
        "data:image/png;base64,C",
        "video.png · crop 640×480",
        640,
        480,
      );

    const s = useVideoStore.getState();
    expect(s.sourceImage).toBe("data:image/png;base64,C");
    expect(s.sourceLabel).toBe("video.png · crop 640×480");
    expect(s.sourceWidth).toBe(640);
    expect(s.sourceHeight).toBe(480);
    expect(s.sourceIsCropped).toBe(true);
    expect(s.sourceOriginal).toEqual({
      image: "data:image/png;base64,A",
      label: "video.png · 1000×800",
      width: 1000,
      height: 800,
    });
  });

  it("restoreSourceOriginal 은 원본을 복원하고 snapshot 을 비운다", () => {
    const store = useVideoStore.getState();
    store.setSource("data:image/png;base64,A", "video.png · 1000×800", 1000, 800);
    store.applySourceCrop(
      "data:image/png;base64,C",
      "video.png · crop 640×480",
      640,
      480,
    );

    useVideoStore.getState().restoreSourceOriginal();

    const s = useVideoStore.getState();
    expect(s.sourceImage).toBe("data:image/png;base64,A");
    expect(s.sourceLabel).toBe("video.png · 1000×800");
    expect(s.sourceWidth).toBe(1000);
    expect(s.sourceHeight).toBe(800);
    expect(s.sourceOriginal).toBeNull();
    expect(s.sourceIsCropped).toBe(false);
  });
});
