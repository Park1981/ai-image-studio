/**
 * reference-templates API 클라이언트 단위 테스트.
 *
 * 핵심 검증 (Codex 2차 리뷰 fix #6):
 *  - 백엔드 상대 path 가 STUDIO_BASE prefix 로 절대 URL 변환되는지
 *  - 이미 절대 URL 이면 그대로 보존
 *
 * USE_MOCK 은 module 로드 시점 const 라 vi.stubEnv 로는 못 바꿈 → process-api.test.ts
 * 패턴 따라 vi.resetModules() + process.env 직접 + dynamic import.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_USE_MOCK;
});

async function loadApi() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_USE_MOCK = "false";
  return import("@/lib/api/reference-templates");
}

const SAMPLE_ITEM = {
  id: "tpl-abc12345",
  imageRef: "/images/studio/reference-templates/" + "0".repeat(32) + ".png",
  name: "테스트 의상",
  visionDescription: null,
  userIntent: null,
  roleDefault: "outfit",
  createdAt: 1714000000000,
  lastUsedAt: null,
};

describe("listReferenceTemplates - URL 정규화", () => {
  it("상대 path 는 STUDIO_BASE prefix 로 절대 URL 변환", async () => {
    const { listReferenceTemplates } = await loadApi();
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ items: [SAMPLE_ITEM] }), {
          status: 200,
        }),
      ),
    ) as unknown as typeof fetch;

    const items = await listReferenceTemplates();
    expect(items).toHaveLength(1);
    expect(items[0].imageRef).toMatch(
      /^https?:\/\/.+\/images\/studio\/reference-templates\/0{32}\.png$/,
    );
  });

  it("이미 절대 URL 이면 그대로", async () => {
    const { listReferenceTemplates } = await loadApi();
    const absolute = "https://example.com/x.png";
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            items: [{ ...SAMPLE_ITEM, imageRef: absolute }],
          }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;

    const items = await listReferenceTemplates();
    expect(items[0].imageRef).toBe(absolute);
  });

  it("data: URL 도 그대로 (mock 경로)", async () => {
    const { listReferenceTemplates } = await loadApi();
    const dataUrl = "data:image/png;base64,iVBOR...";
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            items: [{ ...SAMPLE_ITEM, imageRef: dataUrl }],
          }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;

    const items = await listReferenceTemplates();
    expect(items[0].imageRef).toBe(dataUrl);
  });

  it("non-200 응답이면 빈 배열 (graceful)", async () => {
    const { listReferenceTemplates } = await loadApi();
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("err", { status: 500 })),
    ) as unknown as typeof fetch;
    expect(await listReferenceTemplates()).toEqual([]);
  });

  it("fetch 자체 실패도 빈 배열", async () => {
    const { listReferenceTemplates } = await loadApi();
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("net err")),
    ) as unknown as typeof fetch;
    expect(await listReferenceTemplates()).toEqual([]);
  });
});

describe("createReferenceTemplate", () => {
  it("File 직접 → multipart 전송 + 응답 imageRef 정규화", async () => {
    const { createReferenceTemplate } = await loadApi();
    const tinyPng = new File([new Uint8Array([137, 80, 78, 71])], "x.png", {
      type: "image/png",
    });
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/api/studio/reference-templates")) {
        return Promise.resolve(
          new Response(JSON.stringify({ item: SAMPLE_ITEM }), {
            status: 200,
          }),
        );
      }
      throw new Error(`unexpected url: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await createReferenceTemplate({
      imageFile: tinyPng,
      name: "T",
      role: "outfit",
    });
    expect(result?.imageRef).toMatch(
      /^https?:\/\/.+\/images\/studio\/reference-templates\/0{32}\.png$/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("실패 응답 시 throw (호출자가 toast 처리)", async () => {
    const { createReferenceTemplate } = await loadApi();
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("size", { status: 413 })),
    ) as unknown as typeof fetch;

    const f = new File([new Uint8Array([1, 2, 3])], "x.png", {
      type: "image/png",
    });
    await expect(
      createReferenceTemplate({ imageFile: f, name: "T" }),
    ).rejects.toThrow(/413/);
  });
});

describe("deleteReferenceTemplate / touchReferenceTemplate", () => {
  it("delete: 200 → true", async () => {
    const { deleteReferenceTemplate } = await loadApi();
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    ) as unknown as typeof fetch;
    expect(await deleteReferenceTemplate("tpl-x")).toBe(true);
  });

  it("delete: 404 → false", async () => {
    const { deleteReferenceTemplate } = await loadApi();
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("not found", { status: 404 })),
    ) as unknown as typeof fetch;
    expect(await deleteReferenceTemplate("tpl-x")).toBe(false);
  });

  it("touch: 네트워크 실패 → false (graceful)", async () => {
    const { touchReferenceTemplate } = await loadApi();
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("offline")),
    ) as unknown as typeof fetch;
    expect(await touchReferenceTemplate("tpl-x")).toBe(false);
  });
});
