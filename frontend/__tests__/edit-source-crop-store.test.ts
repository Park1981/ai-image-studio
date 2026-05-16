import { beforeEach, describe, expect, it } from "vitest";
import { useEditStore } from "@/stores/useEditStore";

describe("useEditStore - source crop replace/restore", () => {
  beforeEach(() => {
    useEditStore.setState({
      sourceImage: null,
      sourceLabel: "이미지를 업로드하거나 히스토리에서 선택",
      sourceWidth: null,
      sourceHeight: null,
      sourceOriginal: null,
      sourceIsCropped: false,
    });
  });

  it("setSource 는 새 원본을 설정하고 crop snapshot 을 초기화한다", () => {
    useEditStore
      .getState()
      .setSource("data:image/png;base64,A", "a.png · 1000×800", 1000, 800);

    expect(useEditStore.getState().sourceOriginal).toBeNull();
    expect(useEditStore.getState().sourceIsCropped).toBe(false);
  });

  it("applySourceCrop 은 현재 source 를 원본 snapshot 으로 보관하고 crop 결과를 로드한다", () => {
    useEditStore
      .getState()
      .setSource("data:image/png;base64,A", "a.png · 1000×800", 1000, 800);

    useEditStore
      .getState()
      .applySourceCrop(
        "data:image/png;base64,C",
        "a.png · crop 640×480",
        640,
        480,
      );

    const s = useEditStore.getState();
    expect(s.sourceImage).toBe("data:image/png;base64,C");
    expect(s.sourceLabel).toBe("a.png · crop 640×480");
    expect(s.sourceWidth).toBe(640);
    expect(s.sourceHeight).toBe(480);
    expect(s.sourceIsCropped).toBe(true);
    expect(s.sourceOriginal).toEqual({
      image: "data:image/png;base64,A",
      label: "a.png · 1000×800",
      width: 1000,
      height: 800,
    });
  });

  it("crop 을 다시 적용해도 최초 원본 snapshot 을 유지한다", () => {
    const store = useEditStore.getState();
    store.setSource("data:image/png;base64,A", "a.png · 1000×800", 1000, 800);
    store.applySourceCrop(
      "data:image/png;base64,C1",
      "a.png · crop 640×480",
      640,
      480,
    );
    useEditStore
      .getState()
      .applySourceCrop(
        "data:image/png;base64,C2",
        "a.png · crop 320×240",
        320,
        240,
      );

    expect(useEditStore.getState().sourceOriginal?.image).toBe(
      "data:image/png;base64,A",
    );
    expect(useEditStore.getState().sourceImage).toBe(
      "data:image/png;base64,C2",
    );
  });

  it("restoreSourceOriginal 은 원본을 복원하고 snapshot 을 비운다", () => {
    const store = useEditStore.getState();
    store.setSource("data:image/png;base64,A", "a.png · 1000×800", 1000, 800);
    store.applySourceCrop(
      "data:image/png;base64,C",
      "a.png · crop 640×480",
      640,
      480,
    );

    useEditStore.getState().restoreSourceOriginal();

    const s = useEditStore.getState();
    expect(s.sourceImage).toBe("data:image/png;base64,A");
    expect(s.sourceLabel).toBe("a.png · 1000×800");
    expect(s.sourceWidth).toBe(1000);
    expect(s.sourceHeight).toBe(800);
    expect(s.sourceOriginal).toBeNull();
    expect(s.sourceIsCropped).toBe(false);
  });
});
