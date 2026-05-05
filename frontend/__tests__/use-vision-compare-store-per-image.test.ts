/**
 * useVisionCompareStore — perImagePrompt 휘발 캐시 + 전역 inFlight 직렬화 동작 테스트.
 * Task 17 (Phase 5) 박제: 미묘한 invariant — setPerImagePrompt 가 진행 중인 슬롯만 자동 해제.
 *
 * 의도:
 *   - per-image t2i prompt 합성 결과 image1/image2 별 캐시 동작
 *   - 전역 inFlight 한 슬롯만 표시 (동시 호출 직렬화)
 *   - setPerImagePrompt 호출 시 자동 inFlight 해제 (해당 슬롯이었던 경우만)
 *   - clearPerImagePrompts / 이미지 변경 / reset 시 캐시 초기화
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  type PerImagePromptResult,
  useVisionCompareStore,
} from "@/stores/useVisionCompareStore";

const sampleResult1: PerImagePromptResult = {
  summary: "image1 summary",
  positive_prompt: "p1",
  negative_prompt: "n1",
  key_visual_anchors: ["anchor1"],
  uncertain: [],
};

const sampleResult2: PerImagePromptResult = {
  summary: "image2 summary",
  positive_prompt: "p2",
  negative_prompt: "n2",
  key_visual_anchors: ["anchor2"],
  uncertain: ["unsure"],
};

const sampleImage = {
  dataUrl: "data:image/png;base64,xxx",
  label: "test.png",
  width: 512,
  height: 512,
};

beforeEach(() => {
  useVisionCompareStore.getState().reset();
});

describe("useVisionCompareStore — perImagePrompt 캐시", () => {
  it("초기 상태는 image1/image2 모두 null + inFlight null", () => {
    const { perImagePrompt } = useVisionCompareStore.getState();
    expect(perImagePrompt.image1).toBeNull();
    expect(perImagePrompt.image2).toBeNull();
    expect(perImagePrompt.inFlight).toBeNull();
  });

  it("setPerImagePrompt 가 image1/image2 슬롯에 독립적으로 캐시", () => {
    const { setPerImagePrompt } = useVisionCompareStore.getState();
    setPerImagePrompt("image1", sampleResult1);
    expect(useVisionCompareStore.getState().perImagePrompt.image1).toEqual(
      sampleResult1,
    );
    expect(useVisionCompareStore.getState().perImagePrompt.image2).toBeNull();

    setPerImagePrompt("image2", sampleResult2);
    expect(useVisionCompareStore.getState().perImagePrompt.image1).toEqual(
      sampleResult1,
    );
    expect(useVisionCompareStore.getState().perImagePrompt.image2).toEqual(
      sampleResult2,
    );
  });

  it("clearPerImagePrompts 가 image1/image2/inFlight 전체 초기화", () => {
    const { setPerImagePrompt, setPerImageInFlight, clearPerImagePrompts } =
      useVisionCompareStore.getState();
    setPerImagePrompt("image1", sampleResult1);
    setPerImagePrompt("image2", sampleResult2);
    setPerImageInFlight("image1");

    clearPerImagePrompts();

    const { perImagePrompt } = useVisionCompareStore.getState();
    expect(perImagePrompt.image1).toBeNull();
    expect(perImagePrompt.image2).toBeNull();
    expect(perImagePrompt.inFlight).toBeNull();
  });
});

describe("useVisionCompareStore — 전역 inFlight 직렬화", () => {
  it("setPerImageInFlight 가 한 슬롯만 표시 (전역 직렬화)", () => {
    const { setPerImageInFlight } = useVisionCompareStore.getState();

    setPerImageInFlight("image1");
    expect(useVisionCompareStore.getState().perImagePrompt.inFlight).toBe(
      "image1",
    );

    // 새 호출이 이전 표시 덮어씀 — 직렬화의 핵심 (동시 호출 방어).
    setPerImageInFlight("image2");
    expect(useVisionCompareStore.getState().perImagePrompt.inFlight).toBe(
      "image2",
    );

    setPerImageInFlight(null);
    expect(useVisionCompareStore.getState().perImagePrompt.inFlight).toBeNull();
  });

  it("setPerImagePrompt 가 진행 중이던 슬롯이면 inFlight 자동 해제", () => {
    const { setPerImageInFlight, setPerImagePrompt } =
      useVisionCompareStore.getState();
    setPerImageInFlight("image1");

    setPerImagePrompt("image1", sampleResult1);

    // image1 합성 끝났으니 inFlight 자동 해제.
    expect(useVisionCompareStore.getState().perImagePrompt.inFlight).toBeNull();
    expect(useVisionCompareStore.getState().perImagePrompt.image1).toEqual(
      sampleResult1,
    );
  });

  it("setPerImagePrompt 가 다른 슬롯 inFlight 는 보존 (겹쳤을 때 안전망)", () => {
    const { setPerImageInFlight, setPerImagePrompt } =
      useVisionCompareStore.getState();
    // 사실상 직렬화 정책상 이 상황은 일어나지 않지만,
    // 잘못 호출되더라도 다른 슬롯의 inFlight 표시는 안 깨야 함.
    setPerImageInFlight("image2");

    setPerImagePrompt("image1", sampleResult1);

    expect(useVisionCompareStore.getState().perImagePrompt.inFlight).toBe(
      "image2",
    );
    expect(useVisionCompareStore.getState().perImagePrompt.image1).toEqual(
      sampleResult1,
    );
  });
});

describe("useVisionCompareStore — 캐시 휘발 트리거", () => {
  it("setImageA 시 perImagePrompt 초기화 (다른 비교라 의미 없음)", () => {
    const { setPerImagePrompt, setImageA } =
      useVisionCompareStore.getState();
    setPerImagePrompt("image1", sampleResult1);
    setPerImagePrompt("image2", sampleResult2);

    setImageA(sampleImage);

    const { perImagePrompt } = useVisionCompareStore.getState();
    expect(perImagePrompt.image1).toBeNull();
    expect(perImagePrompt.image2).toBeNull();
    expect(perImagePrompt.inFlight).toBeNull();
  });

  it("setImageB 시 perImagePrompt 초기화", () => {
    const { setPerImagePrompt, setImageB } =
      useVisionCompareStore.getState();
    setPerImagePrompt("image1", sampleResult1);

    setImageB(sampleImage);

    expect(
      useVisionCompareStore.getState().perImagePrompt.image1,
    ).toBeNull();
  });

  it("swapImages 시 perImagePrompt 초기화 (A/B 가 바뀌어 캐시 무의미)", () => {
    const { setImageA, setImageB, setPerImagePrompt, swapImages } =
      useVisionCompareStore.getState();
    setImageA(sampleImage);
    setImageB({ ...sampleImage, label: "other.png" });
    setPerImagePrompt("image1", sampleResult1);
    setPerImagePrompt("image2", sampleResult2);

    swapImages();

    const { perImagePrompt } = useVisionCompareStore.getState();
    expect(perImagePrompt.image1).toBeNull();
    expect(perImagePrompt.image2).toBeNull();
  });

  it("reset() 시 perImagePrompt 초기화 (페이지 떠날 때 휘발)", () => {
    const { setPerImagePrompt, setPerImageInFlight, reset } =
      useVisionCompareStore.getState();
    setPerImagePrompt("image1", sampleResult1);
    setPerImageInFlight("image2");

    reset();

    const { perImagePrompt } = useVisionCompareStore.getState();
    expect(perImagePrompt.image1).toBeNull();
    expect(perImagePrompt.image2).toBeNull();
    expect(perImagePrompt.inFlight).toBeNull();
  });
});
