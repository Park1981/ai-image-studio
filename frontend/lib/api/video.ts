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
import type { TaskCreated } from "./generated-helpers";
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
      // skipUpgrade ON 시 vision + gemma4 단계 모두 우회 (~15초 절약).
      preUpgradedPrompt: req.preUpgradedPrompt,
    }),
  );

  const createRes = await fetch(`${STUDIO_BASE}/api/studio/video`, {
    method: "POST",
    body: form,
  });
  if (!createRes.ok) {
    throw new Error(`video create failed: ${createRes.status}`);
  }
  // Tier 3 (2026-04-27): generated OpenAPI 타입 사용
  const { stream_url } = (await createRes.json()) as TaskCreated;

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
    // Phase 4 (2026-04-27 진행 모달 store 통일 · 정리):
    //   백엔드가 더 이상 "step" event 보내지 않음 (transitional 종료).
    //   detail 정보는 모두 "stage" event 의 payload extra 필드로 도착.
    if (evt.event === "stage") {
      const payload = evt.data as {
        type: string;
        progress: number;
        stageLabel: string;
        samplingStep?: number | null;
        samplingTotal?: number | null;
      } & Record<string, unknown>;
      // Phase 3 (2026-04-27 진행 모달 store 통일):
      //   백엔드 stage emit payload 의 모든 필드 (description / finalPrompt /
      //   finalPromptKo / provider 등) 를 그대로 통과.
      //   PipelineTimeline.StageDef.renderDetail 이 stageHistory[].payload 에서 사용.
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

async function* mockVideoStream(
  req: VideoRequest,
): AsyncGenerator<VideoStage, void, unknown> {
  // Phase 4 (2026-04-27): mock 도 stage emit 으로 변환 — 진행 모달 정상 표시.
  // 백엔드 5-stage (vision-analyze / prompt-merge / workflow-dispatch /
  // comfyui-sampling / save-output) 와 동일 패턴 + detail payload 흡수.
  const desc = "A person stands in warm window light with shallow depth of field.";
  const fp =
    "A cinematic slow dolly in on a subject standing in soft warm window light, shallow depth of field, gentle ambient room noise, film grain, filmic tones, contemplative mood.";
  const fpKo =
    "부드러운 창가 빛 속에 선 피사체에 느린 달리 인, 얕은 심도, 잔잔한 실내 앰비언스, 필름 그레인, 시네마틱 톤, 사색적인 분위기.";
  const stages: {
    stageType: string;
    progress: number;
    stageLabel: string;
    extra?: Record<string, unknown>;
  }[] = [
    { stageType: "vision-analyze", progress: 5, stageLabel: "비전 분석" },
    { stageType: "vision-analyze", progress: 20, stageLabel: "비전 분석 완료", extra: { description: desc } },
    { stageType: "prompt-merge", progress: 25, stageLabel: "프롬프트 병합" },
    {
      stageType: "prompt-merge",
      progress: 30,
      stageLabel: "프롬프트 병합 완료",
      extra: { finalPrompt: fp, finalPromptKo: fpKo, provider: "mock" },
    },
    { stageType: "workflow-dispatch", progress: 33, stageLabel: "워크플로우 전달" },
    { stageType: "comfyui-sampling", progress: 35, stageLabel: "ComfyUI 샘플링 대기" },
    { stageType: "comfyui-sampling", progress: 92, stageLabel: "ComfyUI 샘플링" },
    { stageType: "save-output", progress: 95, stageLabel: "영상 저장" },
  ];
  for (const s of stages) {
    yield { type: "stage", stageType: s.stageType, progress: s.progress, stageLabel: s.stageLabel, ...(s.extra ?? {}) };
    await sleep(250 + Math.random() * 150);
  }

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
    // Mock 모드는 실제 mp4 가 없음 → mock-seed:// sentinel 로 통일.
    // VideoPlayerCard / ImageLightbox 가 이 sentinel 을 보면 재생 시도 안 하고 안내 표시.
    imageRef: "mock-seed://video",
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
