/**
 * api-vision-compare.test.ts — Phase 6 (2026-04-27) 신규 SSE drain 패턴 검증.
 *
 * 검증 범위:
 *   - analyzeImage / compareAnalyze 가 POST → {task_id, stream_url} → SSE drain → done payload
 *   - opts.onStage / req.onStage 콜백이 stage 이벤트마다 호출 + 순서 보존
 *   - error event 도착 시 throw
 *   - done event 도착 후 결과 반환 (옛 JSON 응답 shape 그대로)
 *
 * Mock fetch 패턴:
 *   - 1번째 fetch (POST) → 200 + JSON {task_id, stream_url}
 *   - 2번째 fetch (GET stream_url) → 200 + SSE body
 *
 * USE_MOCK 환경 가드 — env 가 mock 모드면 실 fetch 안 호출됨. lib/api/client.ts 의
 * USE_MOCK 은 NEXT_PUBLIC_USE_MOCK env 로 결정 → 테스트는 vi.stubEnv 로 false 강제.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// USE_MOCK=false 강제 — 실 SSE drain 코드 경로 검증.
// (USE_MOCK=true 면 mockAnalyze 가 fetch 안 거치고 가짜 결과 반환 → 별도 테스트)
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_USE_MOCK", "false");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** SSE response 빌더 — parseSSE 가 소비 가능한 body 형식 */
function sseBody(events: { event: string; data: unknown }[]): string {
  return (
    events
      .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}`)
      .join("\n\n") + "\n\n"
  );
}

function makeStreamResponse(body: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function makeJsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** jsdom 의 Blob → Response stream 호환 우회 — fake response 객체.
 *  lib/api/vision.ts / compare.ts 가 사용하는 필드만: ok / status / blob() / arrayBuffer().
 */
function makeBlobResponse(bytes: number[] = [1]): Response {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob([new Uint8Array(bytes)]),
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as Response;
}

/** fetch 호출 순서대로 응답을 큐에서 pop 하는 mock 셋업.
 *  vision: source fetch (이미지 blob) → POST → GET stream
 *  compare: source fetch + result fetch → POST → GET stream
 */
function queueFetchResponses(responses: Response[]): ReturnType<typeof vi.fn> {
  const queue = [...responses];
  const mock = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("fetch queue exhausted (test setup error)");
    return next;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/* ─────────────────────────────────────────────
 * analyzeImage (Vision)
 * ─────────────────────────────────────────────*/

describe("analyzeImage (Phase 6 SSE drain)", () => {
  it("POST → {task_id, stream_url} → SSE drain → done payload 반환", async () => {
    // 동적 import — env stub 후 module 로드해야 USE_MOCK=false 가 반영됨
    const { analyzeImage } = await import("@/lib/api/vision");

    queueFetchResponses([
      // 1. data: URL 의 fetch (이미지 blob 변환)
      makeBlobResponse([1, 2, 3]),
      // 2. POST /api/studio/vision-analyze → {task_id, stream_url}
      makeJsonResponse({
        task_id: "tsk-vis-001",
        stream_url: "/api/studio/vision-analyze/stream/tsk-vis-001",
      }),
      // 3. GET stream → SSE body (stage × 3 + done)
      makeStreamResponse(
        sseBody([
          { event: "stage", data: { type: "vision-encoding", progress: 5, stageLabel: "이미지 인코딩" } },
          { event: "stage", data: { type: "vision-analyze", progress: 20, stageLabel: "이미지 분석" } },
          { event: "stage", data: { type: "translation", progress: 70, stageLabel: "한국어 번역" } },
          {
            event: "done",
            data: {
              en: "Editorial portrait",
              ko: "에디토리얼 인물",
              provider: "ollama",
              fallback: false,
              width: 1024,
              height: 1024,
              sizeBytes: 100,
              summary: "An editorial portrait",
              positivePrompt: "Editorial portrait, ...",
              negativePrompt: "blurry, lowres",
              composition: "Medium close-up",
              subject: "Young figure",
              clothingOrMaterials: "Soft wool knit",
              environment: "Indoor studio",
              lightingCameraStyle: "North window soft key",
              uncertain: "Exact age",
            },
          },
        ]),
      ),
    ]);

    const stages: string[] = [];
    const result = await analyzeImage("data:image/png;base64,xxxx", {
      onStage: (e) => {
        stages.push(e.type);
      },
    });

    // onStage 콜백 — 3 stage 이벤트 순서대로 호출 (PipelineTimeline 의 stageHistory 갱신)
    expect(stages).toEqual([
      "vision-encoding",
      "vision-analyze",
      "translation",
    ]);
    // done payload 그대로 반환 (옛 JSON 응답 shape)
    expect(result.en).toBe("Editorial portrait");
    expect(result.ko).toBe("에디토리얼 인물");
    expect(result.provider).toBe("ollama");
    expect(result.fallback).toBe(false);
    expect(result.summary).toBe("An editorial portrait");
  });

  it("error event 도착 시 throw", async () => {
    const { analyzeImage } = await import("@/lib/api/vision");

    queueFetchResponses([
      makeBlobResponse([1]),
      makeJsonResponse({
        task_id: "tsk-vis-002",
        stream_url: "/api/studio/vision-analyze/stream/tsk-vis-002",
      }),
      makeStreamResponse(
        sseBody([
          { event: "stage", data: { type: "vision-encoding", progress: 5, stageLabel: "이미지 인코딩" } },
          { event: "error", data: { message: "GPU busy", code: "gpu_busy" } },
        ]),
      ),
    ]);

    await expect(
      analyzeImage("data:image/png;base64,xx"),
    ).rejects.toThrow(/GPU busy/);
  });

  it("POST 실패 시 적절한 에러 메시지 throw", async () => {
    const { analyzeImage } = await import("@/lib/api/vision");

    queueFetchResponses([
      makeBlobResponse([1]),
      // POST 가 413 (이미지 너무 큼) 반환
      new Response(JSON.stringify({ detail: "image too large" }), {
        status: 413,
        headers: { "content-type": "application/json" },
      }),
    ]);

    await expect(analyzeImage("data:image/png;base64,xx")).rejects.toThrow(
      /vision-analyze 413/,
    );
  });

  it("mock-seed:// URL 은 거부 (실 분석 불가)", async () => {
    const { analyzeImage } = await import("@/lib/api/vision");
    await expect(
      analyzeImage("mock-seed://abc123"),
    ).rejects.toThrow(/Mock 결과 이미지/);
  });
});

/* ─────────────────────────────────────────────
 * compareAnalyze (Vision Compare / Edit auto)
 * ─────────────────────────────────────────────*/

describe("compareAnalyze (Phase 6 SSE drain)", () => {
  it("compare 컨텍스트 — POST + SSE drain → analysis 반환", async () => {
    const { compareAnalyze } = await import("@/lib/api/compare");

    queueFetchResponses([
      // source blob fetch (data URL → blob)
      makeBlobResponse([1]),
      // result blob fetch
      makeBlobResponse([2]),
      // POST → task_id
      makeJsonResponse({
        task_id: "tsk-cmp-001",
        stream_url: "/api/studio/compare-analyze/stream/tsk-cmp-001",
      }),
      // GET stream → 4 stage + done
      makeStreamResponse(
        sseBody([
          { event: "stage", data: { type: "compare-encoding", progress: 5, stageLabel: "이미지 A/B 인코딩" } },
          { event: "stage", data: { type: "vision-pair", progress: 25, stageLabel: "이미지 비교 분석" } },
          { event: "stage", data: { type: "translation", progress: 75, stageLabel: "한국어 번역" } },
          {
            event: "done",
            data: {
              analysis: {
                scores: { composition: 80, color: 75 },
                overall: 78,
                comments_en: { composition: "Similar framing" },
                comments_ko: { composition: "비슷한 프레이밍" },
                summary_en: "A and B are similar",
                summary_ko: "A·B 유사",
                provider: "ollama",
                fallback: false,
                analyzedAt: 1700000000000,
                visionModel: "qwen2.5vl:7b",
              },
              saved: false,
            },
          },
        ]),
      ),
    ]);

    const stages: string[] = [];
    const { analysis, saved } = await compareAnalyze({
      source: "data:image/png;base64,a",
      result: "data:image/png;base64,b",
      editPrompt: "",
      context: "compare",
      compareHint: "",
      onStage: (e) => {
        stages.push(e.type);
      },
    });

    // onStage 호출 순서 — Vision Compare 메뉴는 intent-refine 안 거침
    expect(stages).toEqual([
      "compare-encoding",
      "vision-pair",
      "translation",
    ]);
    expect(stages).not.toContain("intent-refine");
    // analysis 반환 + saved=false (historyItemId 미전송)
    expect(analysis).toBeDefined();
    expect((analysis as { overall: number }).overall).toBe(78);
    expect(saved).toBe(false);
  });

  it("Edit 컨텍스트 + 캐시 미스 — intent-refine stage 도착", async () => {
    const { compareAnalyze } = await import("@/lib/api/compare");

    queueFetchResponses([
      makeBlobResponse([1]),
      makeBlobResponse([2]),
      makeJsonResponse({
        task_id: "tsk-cmp-002",
        stream_url: "/api/studio/compare-analyze/stream/tsk-cmp-002",
      }),
      makeStreamResponse(
        sseBody([
          { event: "stage", data: { type: "compare-encoding", progress: 5, stageLabel: "이미지 A/B 인코딩" } },
          { event: "stage", data: { type: "intent-refine", progress: 10, stageLabel: "수정 의도 정제" } },
          { event: "stage", data: { type: "vision-pair", progress: 25, stageLabel: "이미지 비교 분석" } },
          { event: "stage", data: { type: "translation", progress: 75, stageLabel: "한국어 번역" } },
          {
            event: "done",
            data: {
              analysis: {
                domain: "person",
                slots: {},
                overall: 85,
                summary_en: "ok",
                summary_ko: "괜찮음",
                provider: "ollama",
                fallback: false,
                analyzedAt: 1700000000000,
                visionModel: "qwen2.5vl:7b",
              },
              saved: true,
            },
          },
        ]),
      ),
    ]);

    const stages: string[] = [];
    const { saved } = await compareAnalyze({
      source: "data:image/png;base64,a",
      result: "data:image/png;base64,b",
      editPrompt: "옷 색깔 바꿔줘",
      historyItemId: "tsk-aaaaaaaaaaaa",
      onStage: (e) => stages.push(e.type),
    });

    // intent-refine 포함 — Edit 컨텍스트 + 캐시 미스 시 도착
    expect(stages).toContain("intent-refine");
    expect(saved).toBe(true);
  });

  it("error event 도착 시 throw", async () => {
    const { compareAnalyze } = await import("@/lib/api/compare");

    queueFetchResponses([
      makeBlobResponse([1]),
      makeBlobResponse([2]),
      makeJsonResponse({
        task_id: "tsk-cmp-003",
        stream_url: "/api/studio/compare-analyze/stream/tsk-cmp-003",
      }),
      makeStreamResponse(
        sseBody([
          { event: "error", data: { message: "GPU busy", code: "gpu_busy" } },
        ]),
      ),
    ]);

    await expect(
      compareAnalyze({
        source: "data:image/png;base64,a",
        result: "data:image/png;base64,b",
        editPrompt: "",
        context: "compare",
      }),
    ).rejects.toThrow(/GPU busy/);
  });

  it("done payload analysis 누락 시 throw (응답 검증)", async () => {
    const { compareAnalyze } = await import("@/lib/api/compare");

    queueFetchResponses([
      makeBlobResponse([1]),
      makeBlobResponse([2]),
      makeJsonResponse({
        task_id: "tsk-cmp-004",
        stream_url: "/api/studio/compare-analyze/stream/tsk-cmp-004",
      }),
      makeStreamResponse(
        sseBody([
          { event: "done", data: { saved: false } }, // analysis 누락
        ]),
      ),
    ]);

    await expect(
      compareAnalyze({
        source: "data:image/png;base64,a",
        result: "data:image/png;base64,b",
        editPrompt: "",
      }),
    ).rejects.toThrow(/malformed/);
  });
});
