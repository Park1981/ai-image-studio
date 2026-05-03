/**
 * lib/api/video.ts — Phase 4 (2026-05-03) modelId multipart 송신 검증.
 *
 * 검증 시나리오:
 *  - VideoRequest.modelId="wan22" 면 multipart meta JSON 안에 modelId="wan22" 포함
 *  - modelId="ltx" 도 동일
 *  - modelId 미전달 시 meta JSON 의 modelId=undefined (백엔드 default = wan22)
 *  - mock 모드는 modelId 따라 item.model / item.modelId / fps / frameCount 분기
 *
 * spec: docs/superpowers/specs/2026-05-03-video-model-selection-wan22.md §5.4
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockVideoStream } from "@/lib/api/mocks/video";
import type { VideoRequest } from "@/lib/api/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_USE_MOCK;
});

beforeEach(() => {
  // mock 결정성을 위해 sleep 0 처리
  vi.mock("@/lib/api/client", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/api/client")>();
    return {
      ...actual,
      sleep: () => Promise.resolve(),
    };
  });
});

async function consume(req: VideoRequest) {
  const events: unknown[] = [];
  for await (const evt of mockVideoStream(req)) {
    events.push(evt);
  }
  return events;
}

describe("mockVideoStream — Phase 4 modelId 분기", () => {
  it("modelId='wan22' 면 done item 의 model='Wan 2.2 i2v' / modelId='wan22' / fps=16 / frameCount=81", async () => {
    const events = await consume({
      sourceImage: "data:image/png;base64,xxx",
      prompt: "panning shot",
      modelId: "wan22",
    });
    const done = events.find(
      (e): e is { type: "done"; item: { model: string; modelId: string; fps: number; frameCount: number } } =>
        typeof e === "object" && e !== null && (e as { type: string }).type === "done",
    );
    expect(done).toBeDefined();
    expect(done!.item.model).toBe("Wan 2.2 i2v");
    expect(done!.item.modelId).toBe("wan22");
    expect(done!.item.fps).toBe(16);
    expect(done!.item.frameCount).toBe(81);
  });

  it("modelId='ltx' 면 done item 의 model='LTX Video 2.3' / modelId='ltx' / fps=25 / frameCount=126", async () => {
    const events = await consume({
      sourceImage: "data:image/png;base64,xxx",
      prompt: "panning shot",
      modelId: "ltx",
    });
    const done = events.find(
      (e): e is { type: "done"; item: { model: string; modelId: string; fps: number; frameCount: number } } =>
        typeof e === "object" && e !== null && (e as { type: string }).type === "done",
    );
    expect(done).toBeDefined();
    expect(done!.item.model).toBe("LTX Video 2.3");
    expect(done!.item.modelId).toBe("ltx");
    expect(done!.item.fps).toBe(25);
    expect(done!.item.frameCount).toBe(126);
  });

  it("modelId 미전달 시 default Wan 22 적용 (DEFAULT_VIDEO_MODEL_ID 사용자 결정 #1)", async () => {
    const events = await consume({
      sourceImage: "data:image/png;base64,xxx",
      prompt: "panning shot",
      // modelId 누락
    });
    const done = events.find(
      (e): e is { type: "done"; item: { model: string; modelId: string } } =>
        typeof e === "object" && e !== null && (e as { type: string }).type === "done",
    );
    expect(done).toBeDefined();
    expect(done!.item.model).toBe("Wan 2.2 i2v");
    expect(done!.item.modelId).toBe("wan22");
  });
});
