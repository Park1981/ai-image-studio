/**
 * lib/image-crop.ts 단위 테스트.
 *
 * 2026-04-28 (수동 crop UI · Phase 2).
 *
 * 케이스:
 *   - dataUrlToBlob: PNG / JPEG / fetch 실패 → throw
 *   - cropBlobByArea: drawImage source rect 정확성 + canvas 사이즈 + PNG Blob 반환
 *   - cropBlobIfArea: area null 시 원본 그대로, area 있으면 crop 호출
 *
 * jsdom 한계로 canvas / HTMLImageElement 일부를 file-local 폴리필로 흉내냄.
 *
 * Codex Phase 2 리뷰 #5 (의심): fake canvas 라 실제 픽셀 / 디코드 / toBlob 실패를
 * 못 잡음. drawImage 호출 인자만 검증 — false negative 가능. 실 canvas 픽셀
 * 검증은 Playwright 도입 후 별도 plan 으로.
 */

import {
  describe,
  expect,
  it,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import {
  cropBlobByArea,
  cropBlobIfArea,
  dataUrlToBlob,
} from "@/lib/image-crop";
import type { CropArea } from "@/stores/useEditStore";

// ── jsdom 폴리필 ──
// Image: src 설정 시 즉시 onload 호출 (실제 비트맵 디코딩은 안 함)
// canvas.toBlob: 호출 인자만 검증 가능하게 fake PNG Blob 반환
// 둘 다 file-local — afterAll 에서 원복.
let originalToBlob: HTMLCanvasElement["toBlob"];
let originalImageSrcDescriptor: PropertyDescriptor | undefined;

beforeAll(() => {
  originalToBlob = HTMLCanvasElement.prototype.toBlob;
  originalImageSrcDescriptor = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    "src",
  );

  // canvas.toBlob 폴리필 — type 인자에 따라 빈 Blob 반환
  HTMLCanvasElement.prototype.toBlob = function (
    callback: BlobCallback,
    type?: string,
  ) {
    setTimeout(() => {
      callback(
        new Blob(["fake-image-bytes-" + Date.now()], {
          type: type || "image/png",
        }),
      );
    }, 0);
  } as HTMLCanvasElement["toBlob"];

  // HTMLImageElement.src setter 폴리필 — 설정 즉시 onload 호출
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    configurable: true,
    set(this: HTMLImageElement & { _src: string }, value: string) {
      this._src = value;
      // naturalWidth/Height 도 fake 로 — drawImage 가 의존
      Object.defineProperty(this, "naturalWidth", {
        value: 1024,
        configurable: true,
      });
      Object.defineProperty(this, "naturalHeight", {
        value: 1024,
        configurable: true,
      });
      setTimeout(() => this.onload?.(new Event("load")), 0);
    },
    get(this: HTMLImageElement & { _src?: string }) {
      return this._src ?? "";
    },
  });

  // URL.createObjectURL / revokeObjectURL — jsdom 미구현 케이스 대비
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  }
});

afterAll(() => {
  HTMLCanvasElement.prototype.toBlob = originalToBlob;
  if (originalImageSrcDescriptor) {
    Object.defineProperty(
      HTMLImageElement.prototype,
      "src",
      originalImageSrcDescriptor,
    );
  }
});

/** jsdom 의 Blob → Response stream 호환 우회 (api-vision-compare.test.ts 패턴).
 *  dataUrlToBlob 가 사용하는 필드만: ok / status / blob().
 */
function makeBlobResponse(type: string, bytes: number[] = [1]): Response {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob([new Uint8Array(bytes)], { type }),
  } as unknown as Response;
}

describe("dataUrlToBlob", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("PNG data URL → image/png Blob", async () => {
    const fetchMock = vi.fn(async () => makeBlobResponse("image/png", [1, 2]));
    vi.stubGlobal("fetch", fetchMock);

    const blob = await dataUrlToBlob("data:image/png;base64,xxx");

    expect(blob.type).toBe("image/png");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("JPEG data URL → image/jpeg Blob", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makeBlobResponse("image/jpeg", [1, 2])),
    );

    const blob = await dataUrlToBlob("data:image/jpeg;base64,xxx");

    expect(blob.type).toBe("image/jpeg");
  });

  it("fetch 실패 (404) → throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        blob: async () => new Blob(),
      }) as unknown as Response),
    );

    await expect(dataUrlToBlob("http://x.invalid/")).rejects.toThrow(/404/);
  });
});

/**
 * jsdom 은 CanvasRenderingContext2D 미구현 (node-canvas 없음).
 * canvas.getContext("2d") 자체를 mock 해서 fake context 반환 + drawImage spy.
 */
function setupCanvasMock() {
  const drawImage = vi.fn();
  const fakeCtx = { drawImage } as unknown as CanvasRenderingContext2D;
  const getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(fakeCtx as unknown as never);
  return {
    drawImage,
    restore: () => getContextSpy.mockRestore(),
  };
}

describe("cropBlobByArea", () => {
  it("drawImage 가 source rect 를 area 그대로 사용 + canvas 가 area 크기", async () => {
    const { drawImage, restore } = setupCanvasMock();

    const blob = new Blob(["src"], { type: "image/png" });
    const area: CropArea = { x: 100, y: 50, width: 768, height: 512 };

    const cropped = await cropBlobByArea(blob, area);

    expect(cropped).toBeInstanceOf(Blob);
    expect(cropped.type).toBe("image/png");

    // drawImage 호출 인자 — image, sx, sy, sw, sh, dx, dy, dw, dh
    expect(drawImage).toHaveBeenCalledOnce();
    const callArgs = drawImage.mock.calls[0];
    expect(callArgs[1]).toBe(100); // sx
    expect(callArgs[2]).toBe(50); // sy
    expect(callArgs[3]).toBe(768); // sw
    expect(callArgs[4]).toBe(512); // sh
    expect(callArgs[5]).toBe(0); // dx
    expect(callArgs[6]).toBe(0); // dy
    expect(callArgs[7]).toBe(768); // dw
    expect(callArgs[8]).toBe(512); // dh

    restore();
  });

  it("소수점 area 는 round 처리 + 음수 좌표 clamp", async () => {
    const { drawImage, restore } = setupCanvasMock();

    const blob = new Blob(["src"], { type: "image/png" });
    const area: CropArea = {
      x: -5.4,
      y: 10.6,
      width: 511.7,
      height: 256.2,
    };

    await cropBlobByArea(blob, area);

    const callArgs = drawImage.mock.calls[0];
    expect(callArgs[1]).toBe(0); // sx (음수 → 0 clamp)
    expect(callArgs[2]).toBe(11); // sy (round)
    expect(callArgs[3]).toBe(512); // sw (round)
    expect(callArgs[4]).toBe(256); // sh (round)

    restore();
  });
});

describe("cropBlobIfArea", () => {
  it("area null → 원본 Blob 그대로 반환 (no-crop path)", async () => {
    const original = new Blob(["original"], { type: "image/png" });
    const result = await cropBlobIfArea(original, null);
    expect(result).toBe(original); // 동일 인스턴스
  });

  it("area 있음 → crop 결과 Blob 반환 (다른 인스턴스)", async () => {
    const { drawImage, restore } = setupCanvasMock();

    const original = new Blob(["original"], { type: "image/png" });
    const area: CropArea = { x: 0, y: 0, width: 256, height: 256 };

    const result = await cropBlobIfArea(original, area);

    expect(result).not.toBe(original);
    expect(result).toBeInstanceOf(Blob);
    expect(drawImage).toHaveBeenCalledOnce();

    restore();
  });
});
