import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_USE_MOCK;
});

async function loadProcessApi() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_USE_MOCK = "false";
  return import("@/lib/api/process");
}

describe("fetchProcessStatus", () => {
  it("maps backend process and system metrics into the frontend snapshot", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ollama: { running: true },
          comfyui: {
            running: false,
            vram_used_gb: 7.25,
            vram_total_gb: 16,
            gpu_percent: 42,
          },
          system: {
            cpu_percent: 18,
            ram_used_gb: 22,
            ram_total_gb: 64,
          },
          vram_breakdown: {
            comfyui: {
              vram_gb: 6.5,
              models: ["Qwen Image 2511"],
              last_mode: "generate",
            },
            ollama: {
              vram_gb: 0.75,
              models: [
                {
                  name: "qwen2.5vl:7b",
                  size_vram_gb: 0.75,
                  expires_in_sec: 30,
                },
              ],
            },
            other_gb: 0.25,
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchProcessStatus } = await loadProcessApi();
    const snapshot = await fetchProcessStatus();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8001/api/studio/process/status",
    );
    expect(snapshot).toMatchObject({
      ollamaRunning: true,
      comfyuiRunning: false,
      vram: { usedGb: 7.25, totalGb: 16 },
      ram: { usedGb: 22, totalGb: 64 },
      gpuPercent: 42,
      cpuPercent: 18,
      vramBreakdown: {
        comfyui: {
          vramGb: 6.5,
          models: ["Qwen Image 2511"],
          lastMode: "generate",
        },
        ollama: {
          vramGb: 0.75,
          models: [
            {
              name: "qwen2.5vl:7b",
              sizeVramGb: 0.75,
              expiresInSec: 30,
            },
          ],
        },
        otherGb: 0.25,
      },
    });
  });

  it("returns null when the status endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));

    const { fetchProcessStatus } = await loadProcessApi();

    expect(await fetchProcessStatus()).toBeNull();
  });
});
