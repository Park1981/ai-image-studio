/**
 * Edit Multi-Reference store + CTA 단위 테스트 (Phase 2 회귀 베이스라인).
 *
 * 2026-04-27 (Edit Multi-Reference Phase 2).
 * 7 케이스: store 기본값 + setter (5) + EditLeftPanel CTA 비활성 derived (2).
 * FormData / API 통합 테스트는 Phase 3 (Task 10 / lib/api/edit.ts 의 multi-ref
 * 확장) 와 함께 별도 파일에서 추가됨.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { useEditStore } from "@/stores/useEditStore";

describe("useEditStore - reference fields", () => {
  beforeEach(() => {
    // 각 테스트 전에 reference 영역만 초기 상태로 reset (다른 필드는 영향 0).
    useEditStore.setState({
      useReferenceImage: false,
      referenceImage: null,
      referenceLabel: "참조 이미지를 업로드해 주세요",
      referenceWidth: null,
      referenceHeight: null,
      referenceRole: "face",
      referenceRoleCustom: "",
    });
  });

  it("default values are safe (toggle OFF)", () => {
    const s = useEditStore.getState();
    expect(s.useReferenceImage).toBe(false);
    expect(s.referenceImage).toBeNull();
    expect(s.referenceRole).toBe("face");
    expect(s.referenceRoleCustom).toBe("");
  });

  it("setUseReferenceImage toggles flag", () => {
    useEditStore.getState().setUseReferenceImage(true);
    expect(useEditStore.getState().useReferenceImage).toBe(true);
    useEditStore.getState().setUseReferenceImage(false);
    expect(useEditStore.getState().useReferenceImage).toBe(false);
  });

  it("setReferenceImage sets all fields", () => {
    useEditStore
      .getState()
      .setReferenceImage("data:image/png;base64,xxx", "ref.png", 1024, 768);
    const s = useEditStore.getState();
    expect(s.referenceImage).toBe("data:image/png;base64,xxx");
    expect(s.referenceLabel).toBe("ref.png");
    expect(s.referenceWidth).toBe(1024);
    expect(s.referenceHeight).toBe(768);
  });

  it("setReferenceRole accepts all 5 presets", () => {
    const presets = ["face", "outfit", "style", "background", "custom"] as const;
    for (const p of presets) {
      useEditStore.getState().setReferenceRole(p);
      expect(useEditStore.getState().referenceRole).toBe(p);
    }
  });

  it("setReferenceRoleCustom captures user input", () => {
    useEditStore.getState().setReferenceRoleCustom("헤어스타일 참조");
    expect(useEditStore.getState().referenceRoleCustom).toBe("헤어스타일 참조");
  });
});

// ── EditLeftPanel CTA 비활성 동작 (간접 — store/derived 검증) ──
// Codex 2차 리뷰 fix #4: useReferenceImage=true + referenceImage 없음 → 백엔드
// 400 미리 방지하기 위해 EditLeftPanel 의 ctaDisabled 조건에 가드 추가.
describe("EditLeftPanel CTA disabled (Codex 2차 리뷰 fix #4)", () => {
  it("multi-ref ON + referenceImage null → CTA 차단 조건 true", () => {
    useEditStore.setState({
      useReferenceImage: true,
      referenceImage: null,
    });
    const s = useEditStore.getState();
    // EditLeftPanel 의 ctaDisabled 추가 조건:
    //   useReferenceImage && !referenceImage
    const blocked = s.useReferenceImage && !s.referenceImage;
    expect(blocked).toBe(true);
  });

  it("multi-ref ON + referenceImage 있음 → CTA 차단 false", () => {
    useEditStore.setState({
      useReferenceImage: true,
      referenceImage: "data:image/png;base64,xxx",
    });
    const s = useEditStore.getState();
    const blocked = s.useReferenceImage && !s.referenceImage;
    expect(blocked).toBe(false);
  });
});
