/**
 * lib/api/video.ts — LTX-2.3 Image-to-Video 스트림 (Mock/Real 분기).
 * 2026-04-24 · V5.
 *
 * Edit 과 같은 multipart upload + SSE 5-step 패턴.
 * Mock 모드는 샘플 mp4 placeholder 반환 (실 생성 없음).
 */

import {
  STUDIO_BASE,
  USE_MOCK,
  normalizeItem,
  parseSSE,
  sleep,
  uid,
} from "./client";
import type { HistoryItem, VideoRequest, VideoStage } from "./types";

export async function* videoImageStream(
  req: VideoRequest,
): AsyncGenerator<VideoStage, void, unknown> {
  if (USE_MOCK) {
    yield* mockVideoStream(req);
    return;
  }
  yield* realVideoStream(req);
}

async function* realVideoStream(
  req: VideoRequest,
): AsyncGenerator<VideoStage, void, unknown> {
  // multipart: image 파일 + meta JSON
  const form = new FormData();
  if (typeof req.sourceImage === "string") {
    const src = req.sourceImage;
    if (src.startsWith("mock-seed://")) {
      throw new Error(
        "Mock 결과 이미지는 영상 소스로 쓸 수 없어. 실제 이미지를 올려줘.",
      );
    }
    try {
      const res = await fetch(src);
      if (!res.ok) {
        throw new Error(`image fetch ${res.status}: ${src.slice(0, 80)}`);
      }
      const blob = await res.blob();
      const guessedName = src.startsWith("data:")
        ? "upload.png"
        : src.split("/").pop()?.split("?")[0] || "source.png";
      form.append("image", blob, guessedName);
    } catch (err) {
      throw new Error(
        `원본 이미지 로드 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    form.append("image", req.sourceImage);
  }
  form.append(
    "meta",
    JSON.stringify({
      prompt: req.prompt,
      adult: req.adult ?? false,
      lightning: req.lightning ?? true,
      longerEdge: req.longerEdge,
      ollamaModel: req.ollamaModel,
      visionModel: req.visionModel,
    }),
  );

  const createRes = await fetch(`${STUDIO_BASE}/api/studio/video`, {
    method: "POST",
    body: form,
  });
  if (!createRes.ok) {
    throw new Error(`video create failed: ${createRes.status}`);
  }
  const { stream_url } = (await createRes.json()) as {
    task_id: string;
    stream_url: string;
  };

  const streamRes = await fetch(`${STUDIO_BASE}${stream_url}`, {
    headers: { accept: "text/event-stream" },
  });
  if (!streamRes.ok) {
    throw new Error(`video stream failed: ${streamRes.status}`);
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
    if (evt.event === "step") {
      const payload = evt.data as {
        step: 1 | 2 | 3 | 4 | 5;
        done: boolean;
        description?: string;
        finalPrompt?: string;
        finalPromptKo?: string | null;
        provider?: string;
      };
      yield { type: "step", ...payload };
    }
    if (evt.event === "stage") {
      const payload = evt.data as {
        type: string;
        progress: number;
        stageLabel: string;
        samplingStep?: number | null;
        samplingTotal?: number | null;
      };
      yield {
        type: "stage",
        stageType: payload.type,
        progress: payload.progress,
        stageLabel: payload.stageLabel,
        samplingStep: payload.samplingStep ?? undefined,
        samplingTotal: payload.samplingTotal ?? undefined,
      };
      if (payload.type === "comfyui-sampling") {
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

async function* mockVideoStream(
  req: VideoRequest,
): AsyncGenerator<VideoStage, void, unknown> {
  // 5-step 시뮬레이션 (실 Ollama/ComfyUI 호출 없음)
  const steps: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5];
  for (const step of steps) {
    yield { type: "step", step, done: false };
    await sleep(400 + Math.random() * 500);
    const doneExtras: Partial<VideoStage & { type: "step" }> = {};
    if (step === 1) {
      doneExtras.description =
        "A person stands in warm window light with shallow depth of field.";
    } else if (step === 2) {
      doneExtras.finalPrompt =
        "A cinematic slow dolly in on a subject standing in soft warm window light, shallow depth of field, gentle ambient room noise, film grain, filmic tones, contemplative mood.";
      doneExtras.finalPromptKo =
        "부드러운 창가 빛 속에 선 피사체에 느린 달리 인, 얕은 심도, 잔잔한 실내 앰비언스, 필름 그레인, 시네마틱 톤, 사색적인 분위기.";
      doneExtras.provider = "mock";
    }
    yield { type: "step", step, done: true, ...doneExtras };
  }
  await sleep(300);

  const item: HistoryItem = {
    id: uid("vid"),
    mode: "video",
    prompt: req.prompt,
    label: req.prompt.slice(0, 28) + (req.prompt.length > 28 ? "…" : ""),
    width: 0,
    height: 0,
    seed: Math.floor(Math.random() * 1e9),
    steps: 0,
    cfg: 1.0,
    lightning: false,
    model: "LTX Video 2.3",
    createdAt: Date.now(),
    imageRef:
      typeof req.sourceImage === "string"
        ? req.sourceImage // Mock: 원본 이미지 path 를 imageRef 로 → <video> 는 못 재생하지만 썸네일은 OK
        : "mock-seed://video",
    visionDescription: "(mock) warm window light portrait",
    upgradedPrompt:
      "cinematic dolly in, warm window light, shallow DoF, film grain",
    upgradedPromptKo: "시네마틱 달리 인, 따뜻한 창가 빛, 얕은 심도, 필름 그레인",
    promptProvider: "mock",
    fps: 25,
    frameCount: 126,
    durationSec: 5,
  };
  yield { type: "done", item, savedToHistory: true };
}
