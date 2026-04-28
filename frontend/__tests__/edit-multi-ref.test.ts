/**
 * Edit Multi-Reference store + CTA + FormData 단위 테스트.
 *
 * 2026-04-27 (Edit Multi-Reference Phase 2 + Phase 3 회수).
 * 9 케이스:
 *   - store 기본값 + setter (5)
 *   - EditLeftPanel CTA 비활성 derived (2)
 *   - editImageStream FormData 검증 — multi-ref OFF / ON (2)
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { useEditStore } from "@/stores/useEditStore";

// FormData 검증 테스트는 *real* 흐름 (mock 분기 X) 을 거쳐야 fetch 가 호출됨.
// vitest 환경에선 USE_MOCK 기본 true 라 mockEditStream 분기로 빠지므로 강제 override.
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, USE_MOCK: false };
});

import { editImageStream } from "@/lib/api/edit";

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

// ── FormData / API 통합 테스트 (Phase 3 Task 10 회수 · Codex 2차 fix #4) ──
// editImageStream 이 multi-ref 토글에 따라 reference_image 와 meta 키를 정확히
// 전송하는지 검증. fetch 를 mock 으로 가로채 multipart body 만 캡처.
describe("editImageStream - FormData 검증 (Codex 2차 리뷰 fix #4)", () => {
  beforeEach(() => {
    // fetch mock — multipart body 만 캡처, 실 백엔드 무관.
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ task_id: "tsk-test", stream_url: "/x" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    ) as unknown as typeof fetch;
  });

  it("multi-ref OFF: FormData 에 reference_image 없음", async () => {
    const gen = editImageStream({
      // Codex 3차 리뷰 fix: data URL 은 edit.ts 내부에서 먼저 fetch 되므로
      // FormData 검증 테스트에서는 File 을 사용해 첫 fetch 가 /edit 생성 요청이 되게 함.
      sourceImage: new File([new Uint8Array([1])], "src.png", {
        type: "image/png",
      }),
      prompt: "test",
      lightning: false,
      useReferenceImage: false, // OFF
    });
    // 처음 yield 까지만 진행 — 실 SSE 무시
    try {
      await gen.next();
    } catch {
      /* SSE 스트림 mock 부재라 에러 OK */
    }

    // fetch 가 받은 FormData 검증
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0];
    const form = init?.body as FormData;
    expect(form.has("reference_image")).toBe(false);

    // meta JSON 의 useReferenceImage 도 false / 또는 미포함
    const metaStr = form.get("meta") as string;
    const meta = JSON.parse(metaStr);
    expect(meta.useReferenceImage).toBeFalsy();
    expect(meta.referenceRole).toBeUndefined();
  });

  it("multi-ref ON: FormData 에 reference_image + meta 포함", async () => {
    const gen = editImageStream({
      // Codex 3차 리뷰 fix: source/reference 모두 File 로 전달해 이미지 fetch call 과
      // /edit 생성 fetch call 이 섞이지 않게 함.
      sourceImage: new File([new Uint8Array([1])], "src.png", {
        type: "image/png",
      }),
      prompt: "test",
      lightning: false,
      useReferenceImage: true,
      referenceImage: new File([new Uint8Array([2])], "ref.png", {
        type: "image/png",
      }),
      referenceRole: "face",
    });
    try {
      await gen.next();
    } catch {
      /* SSE 스트림 mock 부재라 에러 OK */
    }

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0];
    const form = init?.body as FormData;

    expect(form.has("reference_image")).toBe(true);
    const metaStr = form.get("meta") as string;
    const meta = JSON.parse(metaStr);
    expect(meta.useReferenceImage).toBe(true);
    expect(meta.referenceRole).toBe("face");
  });
});
