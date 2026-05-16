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

const MAX_ERROR_DETAIL_CHARS = 1200;

async function responseError(res: Response, label: string): Promise<Error> {
  const raw = await res.text().catch(() => "");
  let detail = raw.trim();
  if (detail) {
    try {
      const parsed = JSON.parse(detail) as { detail?: unknown };
      if (typeof parsed.detail === "string") detail = parsed.detail;
      else if (parsed.detail) detail = JSON.stringify(parsed.detail);
    } catch {
      /* use raw text */
    }
  }
  const suffix = detail
    ? `: ${detail.slice(0, MAX_ERROR_DETAIL_CHARS)}`
    : "";
  return new Error(`${label} (${res.status})${suffix}`);
}

function sseErrorMessage(
  payload: {
    message?: string;
    failedModelId?: string;
    errors?: Record<string, string>;
  },
  fallback: string,
): string {
  const modelError = payload.failedModelId
    ? payload.errors?.[payload.failedModelId]
    : undefined;
  const message = modelError || payload.message || fallback;
  return payload.failedModelId ? `${payload.failedModelId}: ${message}` : message;
}

async function createLabVideoCompareTask(form: FormData): Promise<Response> {
  const compareRes = await fetch(`${STUDIO_BASE}/api/studio/lab/video/compare`, {
    method: "POST",
    body: form,
  });
  if (compareRes.status !== 404) return compareRes;

  return fetch(`${STUDIO_BASE}/api/studio/lab/video/pair`, {
    method: "POST",
    body: form,
  });
}

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

export interface LabVideoPairRequest {
  sourceImage: string | File;
  prompt: string;
  presetId: string;
  longerEdge?: number;
  lightning?: boolean;
  ollamaModel?: string;
  visionModel?: string;
  promptMode?: "fast" | "precise";
  pairMode?: "shared_5beat";
  sulphurProfile?: "official_i2v_v1";
}

export type LabVideoPairStage =
  | Exclude<VideoStage, { type: "done" }>
  | {
      type: "done";
      items: Record<string, HistoryItem>;
      savedToHistory: Record<string, boolean>;
      sharedPrompt?: string;
      sharedPromptKo?: string | null;
      modelPrompts?: Record<string, string>;
      pairMode?: string;
      sulphurProfile?: string;
      failedModelId?: string;
      errors?: Record<string, string>;
    };

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

export async function* labVideoPairStream(
  req: LabVideoPairRequest,
): AsyncGenerator<LabVideoPairStage, void, unknown> {
  if (USE_MOCK) {
    const now = Date.now();
    const sharedPrompt = `${req.prompt}\nBeat 1: Prepare.\nBeat 2: Continue.\nBeat 3: Move.\nBeat 4: Resolve.\nBeat 5: Hold.`;
    const modelPrompts = {
      wan22: req.prompt,
      "ltx-sulphur": sharedPrompt,
    };
    yield {
      type: "stage",
      stageType: "pair-prompt",
      progress: 15,
      stageLabel: "공유 프롬프트 완료",
      sharedPrompt,
      modelPrompts,
      provider: "mock",
    };
    yield {
      type: "stage",
      stageType: "pair-model-start",
      progress: 20,
      stageLabel: "Wan 생성 시작",
      modelId: "wan22",
    };
    yield {
      type: "stage",
      stageType: "pair-model-start",
      progress: 55,
      stageLabel: "Sulphur 생성 시작",
      modelId: "ltx-sulphur",
    };
    yield {
      type: "done",
      savedToHistory: { wan22: true, "ltx-sulphur": true },
      sharedPrompt,
      modelPrompts,
      pairMode: req.pairMode ?? "shared_5beat",
      sulphurProfile: req.sulphurProfile ?? "official_i2v_v1",
      items: {
        wan22: {
          id: `vid-wan-${now.toString(36)}`,
          mode: "video",
          prompt: req.prompt,
          label: req.prompt.slice(0, 28) || "Wan 비교 영상",
          width: 832,
          height: 480,
          seed: now,
          steps: 4,
          cfg: 1,
          lightning: req.lightning ?? true,
          model: "Wan 2.2 i2v",
          modelId: "wan22",
          createdAt: now,
          imageRef: "/mock/video/lab-pair-wan.mp4",
          upgradedPrompt: sharedPrompt,
          durationSec: 5,
          fps: 16,
          frameCount: 81,
        } as HistoryItem,
        "ltx-sulphur": {
          id: `vid-sulphur-${now.toString(36)}`,
          mode: "video",
          prompt: req.prompt,
          label: req.prompt.slice(0, 28) || "Sulphur 비교 영상",
          width: 1024,
          height: 1536,
          seed: now,
          steps: 0,
          cfg: 1,
          lightning: true,
          model: "LTX 2.3 · Sulphur Lab",
          modelId: "ltx-sulphur",
          createdAt: now,
          imageRef: "/mock/video/lab-pair-sulphur.mp4",
          upgradedPrompt: sharedPrompt,
          adult: true,
          durationSec: 5,
          fps: 24,
          frameCount: 121,
        } as HistoryItem,
      },
    };
    return;
  }
  yield* realLabVideoPairStream(req);
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
    throw await responseError(createRes, "Lab 영상 생성 요청 실패");
  }
  const { stream_url } = (await createRes.json()) as TaskCreated;

  const streamRes = await fetch(`${STUDIO_BASE}${stream_url}`, {
    headers: { accept: "text/event-stream" },
  });
  if (!streamRes.ok) {
    throw await responseError(streamRes, "Lab 영상 스트림 연결 실패");
  }

  for await (const evt of parseSSE(streamRes)) {
    if (evt.event === "error") {
      const payload = evt.data as { message?: string };
      throw new Error(payload.message || "Lab 영상 파이프라인 오류");
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

async function* realLabVideoPairStream(
  req: LabVideoPairRequest,
): AsyncGenerator<LabVideoPairStage, void, unknown> {
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
      lightning: req.lightning ?? true,
      longerEdge: req.longerEdge,
      ollamaModel: req.ollamaModel,
      visionModel: req.visionModel,
      promptMode: req.promptMode,
      pairMode: req.pairMode ?? "shared_5beat",
      sulphurProfile: req.sulphurProfile ?? "official_i2v_v1",
    }),
  );

  const createRes = await createLabVideoCompareTask(form);
  if (!createRes.ok) {
    throw await responseError(createRes, "Lab 비교 생성 요청 실패");
  }
  const { stream_url } = (await createRes.json()) as TaskCreated;

  const streamRes = await fetch(`${STUDIO_BASE}${stream_url}`, {
    headers: { accept: "text/event-stream" },
  });
  if (!streamRes.ok) {
    throw await responseError(streamRes, "Lab 비교 스트림 연결 실패");
  }

  for await (const evt of parseSSE(streamRes)) {
    if (evt.event === "error") {
      const payload = evt.data as {
        message?: string;
        failedModelId?: string;
        errors?: Record<string, string>;
      };
      throw new Error(sseErrorMessage(payload, "Lab 비교 파이프라인 오류"));
    }
    if (evt.event === "done") {
      const payload = evt.data as {
        items?: Record<string, HistoryItem>;
        savedToHistory?: Record<string, boolean>;
        sharedPrompt?: string;
        sharedPromptKo?: string | null;
        modelPrompts?: Record<string, string>;
        pairMode?: string;
        sulphurProfile?: string;
        failedModelId?: string;
        errors?: Record<string, string>;
      };
      const normalizedItems = Object.fromEntries(
        Object.entries(payload.items ?? {}).map(([key, item]) => [
          key,
          normalizeItem(item),
        ]),
      );
      yield {
        type: "done",
        items: normalizedItems,
        savedToHistory: payload.savedToHistory ?? {},
        sharedPrompt: payload.sharedPrompt,
        sharedPromptKo: payload.sharedPromptKo,
        modelPrompts: payload.modelPrompts,
        pairMode: payload.pairMode,
        sulphurProfile: payload.sulphurProfile,
        failedModelId: payload.failedModelId,
        errors: payload.errors,
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
