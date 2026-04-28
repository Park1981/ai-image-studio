/**
 * Edit Multi-Ref 수동 crop store 단위 테스트.
 *
 * 2026-04-28 (수동 crop UI · Phase 1).
 *
 * 5 케이스:
 *   - referenceCropArea 기본 null
 *   - setReferenceCropArea setter 동작
 *   - reset 트리거 #1: 새 image 업로드 → 자동 null
 *   - reset 트리거 #2: image 해제 (null) → 자동 null
 *   - reset 트리거 #3: multi-ref 토글 OFF → 자동 null
 *   - 토글 ON 유지 시 area 보존 (regression 방지)
 *
 * 컴포넌트 visual 검증 (비율 lock / bypassCrop) 은 react-easy-crop 의 jsdom
 * 호환성 (ResizeObserver / window gesture) 부담으로 manual 검증으로 둠.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { useEditStore, type CropArea } from "@/stores/useEditStore";

const SAMPLE_AREA: CropArea = { x: 100, y: 50, width: 768, height: 768 };

describe("useEditStore - referenceCropArea (Phase 1 수동 crop)", () => {
  beforeEach(() => {
    // 매 테스트 전 reference 영역 초기 상태로 reset
    useEditStore.setState({
      useReferenceImage: false,
      referenceImage: null,
      referenceLabel: "참조 이미지를 업로드해 주세요",
      referenceWidth: null,
      referenceHeight: null,
      referenceRole: "face",
      referenceRoleCustom: "",
      referenceCropArea: null,
    });
  });

  it("기본값은 null", () => {
    expect(useEditStore.getState().referenceCropArea).toBeNull();
  });

  it("setReferenceCropArea 가 area 를 그대로 저장", () => {
    useEditStore.getState().setReferenceCropArea(SAMPLE_AREA);
    expect(useEditStore.getState().referenceCropArea).toEqual(SAMPLE_AREA);

    // null 로 명시 reset 도 동작
    useEditStore.getState().setReferenceCropArea(null);
    expect(useEditStore.getState().referenceCropArea).toBeNull();
  });

  it("reset 트리거 #1: 새 image 업로드 → area 자동 null", () => {
    // 이미 area 가 잡힌 상태
    useEditStore.getState().setReferenceCropArea(SAMPLE_AREA);
    expect(useEditStore.getState().referenceCropArea).not.toBeNull();

    // 새 이미지 업로드
    useEditStore
      .getState()
      .setReferenceImage("data:image/png;base64,NEW", "new.png", 1024, 1024);

    expect(useEditStore.getState().referenceCropArea).toBeNull();
  });

  it("reset 트리거 #2: image 해제 (null) → area 자동 null", () => {
    useEditStore
      .getState()
      .setReferenceImage("data:image/png;base64,XX", "x.png", 1024, 1024);
    useEditStore.getState().setReferenceCropArea(SAMPLE_AREA);
    expect(useEditStore.getState().referenceCropArea).not.toBeNull();

    // 해제 (X 버튼)
    useEditStore.getState().setReferenceImage(null);

    expect(useEditStore.getState().referenceCropArea).toBeNull();
  });

  it("reset 트리거 #3: multi-ref 토글 OFF → area 자동 null", () => {
    useEditStore.getState().setUseReferenceImage(true);
    useEditStore.getState().setReferenceCropArea(SAMPLE_AREA);
    expect(useEditStore.getState().referenceCropArea).toEqual(SAMPLE_AREA);

    // 토글 OFF
    useEditStore.getState().setUseReferenceImage(false);

    expect(useEditStore.getState().referenceCropArea).toBeNull();
  });

  it("토글 ON 유지 시 area 보존 (regression 가드)", () => {
    useEditStore.getState().setUseReferenceImage(true);
    useEditStore.getState().setReferenceCropArea(SAMPLE_AREA);

    // 같은 ON 으로 한 번 더 호출 — area 유지되어야 함
    useEditStore.getState().setUseReferenceImage(true);

    expect(useEditStore.getState().referenceCropArea).toEqual(SAMPLE_AREA);
  });
});
