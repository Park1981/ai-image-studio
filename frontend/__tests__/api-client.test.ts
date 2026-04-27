import { describe, expect, it } from "vitest";

import {
  normalizeImageRef,
  normalizeItem,
  parseSSE,
} from "@/lib/api/client";
import type { HistoryItem } from "@/lib/api/types";

function sseResponse(body: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
  );
}

describe("parseSSE", () => {
  it("yields JSON object events and ignores malformed frames", async () => {
    const res = sseResponse(
      [
        "event: stage",
        'data: {"type":"prompt-parse","progress":10}',
        "",
        "event: broken",
        "data: not-json",
        "",
        "event: done",
        'data: {"item":{"id":"gen-1"}}',
        "",
        "",
      ].join("\n"),
    );

    const events = [];
    for await (const evt of parseSSE(res)) {
      events.push(evt);
    }

    expect(events).toEqual([
      {
        event: "stage",
        data: { type: "prompt-parse", progress: 10 },
      },
      {
        event: "done",
        data: { item: { id: "gen-1" } },
      },
    ]);
  });
});

describe("image ref normalization", () => {
  it("converts backend-relative image refs and preserves external refs", () => {
    expect(normalizeImageRef("/images/studio/a.png")).toBe(
      "http://localhost:8001/images/studio/a.png",
    );
    expect(normalizeImageRef("mock-seed://abc")).toBe("mock-seed://abc");
    expect(normalizeImageRef("https://example.test/a.png")).toBe(
      "https://example.test/a.png",
    );
  });

  it("normalizes imageRef and sourceRef on history items", () => {
    const item: HistoryItem = {
      id: "edit-1",
      mode: "edit",
      prompt: "make it blue",
      label: "make it blue",
      width: 1024,
      height: 1024,
      seed: 1,
      steps: 4,
      cfg: 1,
      lightning: true,
      model: "Qwen Image Edit 2511",
      createdAt: 1700000000000,
      imageRef: "/images/studio/edit/result.png",
      sourceRef: "/images/studio/edit-source/source.png",
    };

    expect(normalizeItem(item)).toMatchObject({
      imageRef: "http://localhost:8001/images/studio/edit/result.png",
      sourceRef: "http://localhost:8001/images/studio/edit-source/source.png",
    });
  });
});
