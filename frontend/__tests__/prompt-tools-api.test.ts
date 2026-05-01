/**
 * Phase 5 (2026-05-01) — splitPrompt + translatePrompt 클라이언트 테스트.
 *
 * 검증:
 *  - splitPrompt 가 POST /api/studio/prompt/split 으로 prompt + ollamaModel 전송
 *  - translatePrompt 가 direction 동봉 (한↔영 분기)
 *  - HTTP 에러 → throw
 *  - PROMPT_SECTION_KEYS 17 카테고리 spec §4.5 와 일치
 *
 * USE_MOCK 회피 패턴: process-api.test.ts 의 dynamic import + vi.resetModules().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_USE_MOCK;
});

async function loadPromptTools() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_USE_MOCK = "false";
  return import("@/lib/api/prompt-tools");
}

describe("prompt-tools — POST body shape", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("splitPrompt 가 POST /prompt/split 호출 + body 에 prompt + ollamaModel", async () => {
    const { splitPrompt } = await loadPromptTools();
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sections: [{ key: "subject", text: "test" }],
          provider: "ollama",
          fallback: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await splitPrompt({
      prompt: "long prompt",
      ollamaModel: "gemma4-un:latest",
    });

    expect(res.fallback).toBe(false);
    expect(res.sections[0].key).toBe("subject");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/api/studio/prompt/split");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      prompt: "long prompt",
      ollamaModel: "gemma4-un:latest",
    });
  });

  it("translatePrompt direction='ko' 가 body 에 그대로 동봉", async () => {
    const { translatePrompt } = await loadPromptTools();
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          translated: "한국어",
          provider: "ollama",
          fallback: false,
          direction: "ko",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await translatePrompt({ prompt: "Korean", direction: "ko" });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/api/studio/prompt/translate");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.direction).toBe("ko");
  });

  it("translatePrompt direction='en' 도 body 에 정확히 동봉", async () => {
    const { translatePrompt } = await loadPromptTools();
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          translated: "English",
          provider: "ollama",
          fallback: false,
          direction: "en",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await translatePrompt({ prompt: "한국어", direction: "en" });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.direction).toBe("en");
  });

  it("HTTP 5xx 시 Error throw", async () => {
    const { splitPrompt } = await loadPromptTools();
    fetchSpy.mockResolvedValueOnce(
      new Response("server error", { status: 500 }),
    );
    await expect(splitPrompt({ prompt: "x" })).rejects.toThrow();
  });
});

describe("prompt-tools — 카테고리 키 일관성", () => {
  it("PROMPT_SECTION_KEYS 가 spec §4.5 의 17 카테고리와 정확히 일치", async () => {
    const { PROMPT_SECTION_KEYS } = await loadPromptTools();
    // spec §4.5 의 카테고리 (백엔드 ALLOWED_SECTION_KEYS 와 1:1).
    const expected = [
      "subject",
      "composition",
      "face",
      "eyes",
      "nose",
      "lips",
      "skin",
      "makeup",
      "expression",
      "hair",
      "outfit",
      "background",
      "lighting",
      "style",
      "quality",
      "negative",
      "etc",
    ];
    expect(PROMPT_SECTION_KEYS).toEqual(expected);
    expect(PROMPT_SECTION_KEYS.length).toBe(17);
  });
});
