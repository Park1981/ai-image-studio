import { describe, expect, it, vi } from "vitest";

import { consumePipelineStream } from "@/hooks/usePipelineStream";

type TestEvent =
  | { type: "stage"; progress: number; stageLabel: string }
  | { type: "sampling"; samplingStep: number; samplingTotal: number }
  | { type: "done"; item: { id: string } };

async function* stream(events: TestEvent[]): AsyncGenerator<TestEvent> {
  for (const event of events) {
    yield event;
  }
}

describe("consumePipelineStream", () => {
  it("routes typed events, calls progress for non-done, and finalizes", async () => {
    const seen: string[] = [];
    const progress = vi.fn();
    const finalized = vi.fn();

    await consumePipelineStream(
      stream([
        { type: "stage", progress: 10, stageLabel: "프롬프트 해석" },
        { type: "sampling", samplingStep: 2, samplingTotal: 4 },
        { type: "done", item: { id: "gen-1" } },
      ]),
      {
        on: {
          stage: (event) => seen.push(`stage:${event.progress}`),
          sampling: (event) =>
            seen.push(`sampling:${event.samplingStep}/${event.samplingTotal}`),
          done: (event) => seen.push(`done:${event.item.id}`),
        },
        onProgress: progress,
        onFinally: finalized,
      },
    );

    expect(seen).toEqual(["stage:10", "sampling:2/4", "done:gen-1"]);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(finalized).toHaveBeenCalledOnce();
  });

  it("reports incomplete streams that end without done", async () => {
    const incomplete = vi.fn();
    const finalized = vi.fn();

    await consumePipelineStream(
      stream([{ type: "stage", progress: 10, stageLabel: "프롬프트 해석" }]),
      {
        on: {},
        onIncomplete: incomplete,
        onFinally: finalized,
      },
    );

    expect(incomplete).toHaveBeenCalledOnce();
    expect(finalized).toHaveBeenCalledOnce();
  });

  it("passes thrown stream errors to onError and still finalizes", async () => {
    const error = new Error("stream failed");
    const onError = vi.fn();
    const finalized = vi.fn();

    async function* broken(): AsyncGenerator<TestEvent> {
      throw error;
    }

    await consumePipelineStream(broken(), {
      on: {},
      onError,
      onFinally: finalized,
    });

    expect(onError).toHaveBeenCalledWith(error);
    expect(finalized).toHaveBeenCalledOnce();
  });
});
