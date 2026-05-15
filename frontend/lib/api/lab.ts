/**
 * Lab API client.
 */

import {
  STUDIO_BASE,
  USE_MOCK,
  fetchImageBlob,
  normalizeItem,
  parseSSE,
} from "./client";
import type { TaskCreated } from "./generated-helpers";
import type { HistoryItem, VideoStage } from "./types";

export interface LabVideoRequest {
  sourceImage: string | File;
  prompt: string;
  presetId: string;
  activeLoraIds: string[];
  loraStrengths: Record<string, number>;
  longerEdge?: number;
  lightning?: boolean;
  ollamaModel?: string;
  visionModel?: string;
  preUpgradedPrompt?: string;
  promptMode?: "fast" | "precise";
}

export interface LabVideoFilesResponse {
  allPresent: boolean;
  missing: string[];
  availableCount: number;
  presets: Array<{
    id: string;
    files: Array<{
      id: string;
      fileName: string;
      present: boolean;
      foundAs: string | null;
    }>;
  }>;
}

export async function checkLabVideoFiles(): Promise<LabVideoFilesResponse> {
  const res = await fetch(`${STUDIO_BASE}/api/studio/lab/video/files`);
  if (!res.ok) {
    throw new Error(`lab video file check failed: ${res.status}`);
  }
  return (await res.json()) as LabVideoFilesResponse;
}

export async function* labVideoImageStream(
  req: LabVideoRequest,
): AsyncGenerator<VideoStage, void, unknown> {
  if (USE_MOCK) {
    yield {
      type: "stage",
      stageType: "vision-analyze",
      progress: 20,
      stageLabel: "비전 분석 완료",
      description: "Mock Lab source image description.",
    };
    yield {
      type: "stage",
      stageType: "prompt-merge",
      progress: 30,
      stageLabel: "프롬프트 병합 완료",
      finalPrompt: req.prompt,
      provider: "mock",
    };
    yield {
      type: "done",
      savedToHistory: true,
      item: {
        id: `vid-${Date.now().toString(36)}`,
        mode: "video",
        prompt: req.prompt,
        label: req.prompt.slice(0, 28) || "Lab video",
        width: 1024,
        height: 1536,
        seed: Date.now(),
        steps: 0,
        cfg: 1,
        lightning: req.lightning ?? true,
        model: "LTX 2.3 · Sulphur Lab",
        modelId: "ltx-sulphur",
        createdAt: Date.now(),
        imageRef: "/mock/video/lab-sulphur.mp4",
        adult: req.activeLoraIds.some((id) => id.startsWith("adult_")),
        durationSec: 5,
        fps: 25,
        frameCount: 126,
      } as HistoryItem,
    };
    return;
  }
  yield* realLabVideoStream(req);
}

async function* realLabVideoStream(
  req: LabVideoRequest,
): AsyncGenerator<VideoStage, void, unknown> {
  const form = new FormData();
  if (typeof req.sourceImage === "string") {
    const src = req.sourceImage;
    if (src.startsWith("mock-seed://")) {
      throw new Error("Mock 결과 이미지는 영상 소스로 쓸 수 없어.");
    }
    const blob = await fetchImageBlob(src);
    const guessedName = src.startsWith("data:")
      ? "upload.png"
      : src.split("/").pop()?.split("?")[0] || "source.png";
    form.append("image", blob, guessedName);
  } else {
    form.append("image", req.sourceImage);
  }

  form.append(
    "meta",
    JSON.stringify({
      prompt: req.prompt,
      presetId: req.presetId,
      activeLoraIds: req.activeLoraIds,
      loraStrengths: req.loraStrengths,
      lightning: req.lightning ?? true,
      longerEdge: req.longerEdge,
      ollamaModel: req.ollamaModel,
      visionModel: req.visionModel,
      preUpgradedPrompt: req.preUpgradedPrompt,
      promptMode: req.promptMode,
    }),
  );

  const createRes = await fetch(`${STUDIO_BASE}/api/studio/lab/video`, {
    method: "POST",
    body: form,
  });
  if (!createRes.ok) {
    throw new Error(`lab video create failed: ${createRes.status}`);
  }
  const { stream_url } = (await createRes.json()) as TaskCreated;

  const streamRes = await fetch(`${STUDIO_BASE}${stream_url}`, {
    headers: { accept: "text/event-stream" },
  });
  if (!streamRes.ok) {
    throw new Error(`lab video stream failed: ${streamRes.status}`);
  }

  for await (const evt of parseSSE(streamRes)) {
    if (evt.event === "error") {
      const payload = evt.data as { message?: string };
      throw new Error(payload.message || "pipeline error");
    }
    if (evt.event === "done") {
      const payload = evt.data as {
        item: HistoryItem;
        savedToHistory?: boolean;
      };
      yield {
        type: "done",
        item: normalizeItem(payload.item),
        savedToHistory: payload.savedToHistory ?? true,
      };
      return;
    }
    if (evt.event === "stage") {
      const payload = evt.data as {
        type: string;
        progress: number;
        stageLabel: string;
        samplingStep?: number | null;
        samplingTotal?: number | null;
      } & Record<string, unknown>;
      const {
        type: rawType,
        progress: _p,
        stageLabel: _sl,
        samplingStep: _ss,
        samplingTotal: _st,
        ...extra
      } = payload;
      void _p;
      void _sl;
      void _ss;
      void _st;
      yield {
        type: "stage",
        stageType: payload.type,
        progress: payload.progress,
        stageLabel: payload.stageLabel,
        samplingStep: payload.samplingStep ?? undefined,
        samplingTotal: payload.samplingTotal ?? undefined,
        ...extra,
      };
      if (rawType === "comfyui-sampling") {
        yield {
          type: "sampling",
          progress: payload.progress ?? 0,
          samplingStep: payload.samplingStep ?? null,
          samplingTotal: payload.samplingTotal ?? null,
        };
      }
    }
  }
}
