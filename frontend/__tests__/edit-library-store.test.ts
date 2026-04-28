/**
 * useEditStore — v8 라이브러리 plan 통합 회귀 (Codex Phase B+C 리뷰 fix #10).
 *
 * 검증 시나리오:
 *  - saveAsTemplate / templateName / pickedTemplateId / pickedTemplateRef 기본값
 *  - setter 4개 동작
 *  - reset 트리거: 라이브러리 픽 후 새 업로드 → picked 두 값 자동 null
 *  - 라이브러리 픽 시퀀스: setReferenceImage → setPicked... 순서로 호출 시 picked 보존
 *  - reference image 해제 → picked 두 값 자동 null
 *  - useReferenceImage 토글 OFF 는 picked 보존 (의도됨 — 사용자가 다시 ON 하면 이어서)
 *
 *  blob: URL preserve (normalizeReferenceTemplate) 도 함께 검증.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEditStore } from "@/stores/useEditStore";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_USE_MOCK;
});

beforeEach(() => {
  // 매 테스트 전 라이브러리 관련 상태 초기화
  useEditStore.setState({
    useReferenceImage: false,
    referenceImage: null,
    referenceLabel: "참조 이미지를 업로드해 주세요",
    referenceWidth: null,
    referenceHeight: null,
    referenceCropArea: null,
    saveAsTemplate: false,
    templateName: "",
    pickedTemplateId: null,
    pickedTemplateRef: null,
  });
});

describe("useEditStore - 라이브러리 plan v8 필드", () => {
  it("기본값: 모두 비활성/null", () => {
    const s = useEditStore.getState();
    expect(s.saveAsTemplate).toBe(false);
    expect(s.templateName).toBe("");
    expect(s.pickedTemplateId).toBeNull();
    expect(s.pickedTemplateRef).toBeNull();
  });

  it("setSaveAsTemplate / setTemplateName / setPickedTemplateId / setPickedTemplateRef setter 동작", () => {
    const s = useEditStore.getState();
    s.setSaveAsTemplate(true);
    s.setTemplateName("검정 드레스");
    s.setPickedTemplateId("tpl-abc");
    s.setPickedTemplateRef("/images/studio/reference-templates/x.png");
    const after = useEditStore.getState();
    expect(after.saveAsTemplate).toBe(true);
    expect(after.templateName).toBe("검정 드레스");
    expect(after.pickedTemplateId).toBe("tpl-abc");
    expect(after.pickedTemplateRef).toBe(
      "/images/studio/reference-templates/x.png",
    );
  });

  it("라이브러리 픽 시퀀스: setReferenceImage → setPicked... 순서면 picked 보존", () => {
    // 1. 픽 시뮬레이션 — EditLeftPanel onPick 핸들러 흐름 그대로
    const s = useEditStore.getState();
    s.setReferenceImage(
      "/images/studio/reference-templates/abc.png",
      "검정 드레스 · 라이브러리",
      0,
      0,
    );
    s.setPickedTemplateId("tpl-abc");
    s.setPickedTemplateRef("/images/studio/reference-templates/abc.png");
    s.setSaveAsTemplate(false);

    const after = useEditStore.getState();
    expect(after.pickedTemplateId).toBe("tpl-abc");
    expect(after.pickedTemplateRef).toBe(
      "/images/studio/reference-templates/abc.png",
    );
    expect(after.referenceImage).toBe(
      "/images/studio/reference-templates/abc.png",
    );
  });

  it("라이브러리 픽 후 새 이미지 업로드 → picked 두 값 자동 null", () => {
    const s = useEditStore.getState();
    s.setPickedTemplateId("tpl-abc");
    s.setPickedTemplateRef("/x/abc.png");

    // 사용자가 새 이미지 직접 업로드
    s.setReferenceImage("data:image/png;base64,xxx", "new.png", 1024, 1024);

    const after = useEditStore.getState();
    expect(after.pickedTemplateId).toBeNull();
    expect(after.pickedTemplateRef).toBeNull();
    expect(after.referenceImage).toBe("data:image/png;base64,xxx");
  });

  it("reference image 해제 (null) → picked 두 값 자동 null", () => {
    const s = useEditStore.getState();
    s.setReferenceImage("data:abc", "x", 0, 0);
    s.setPickedTemplateId("tpl-x");
    s.setPickedTemplateRef("/x/x.png");

    s.setReferenceImage(null);

    const after = useEditStore.getState();
    expect(after.referenceImage).toBeNull();
    expect(after.pickedTemplateId).toBeNull();
    expect(after.pickedTemplateRef).toBeNull();
  });

  it("useReferenceImage 토글 OFF 는 picked 보존 (의도됨)", () => {
    // 사용자가 토글 OFF → 다시 ON 하면 이전 픽 그대로 — 잠시 끄는 use case 보호
    const s = useEditStore.getState();
    s.setReferenceImage("/x/abc.png", "lib", 0, 0);
    s.setPickedTemplateId("tpl-abc");
    s.setPickedTemplateRef("/x/abc.png");

    s.setUseReferenceImage(false);

    const after = useEditStore.getState();
    expect(after.useReferenceImage).toBe(false);
    expect(after.pickedTemplateId).toBe("tpl-abc");
    expect(after.pickedTemplateRef).toBe("/x/abc.png");
  });
});

describe("normalizeReferenceTemplate - blob: URL preserve (Codex fix #5)", () => {
  it("blob: URL 은 그대로 (STUDIO_BASE prefix 안 붙임)", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_USE_MOCK = "false";
    const { listReferenceTemplates } = await import(
      "@/lib/api/reference-templates"
    );
    const blobUrl = "blob:http://localhost:3000/abc-123";
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "tpl-blob",
                imageRef: blobUrl,
                name: "blob test",
                visionDescription: null,
                userIntent: null,
                roleDefault: null,
                createdAt: 0,
                lastUsedAt: null,
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;

    const items = await listReferenceTemplates();
    expect(items[0].imageRef).toBe(blobUrl);
  });
});
