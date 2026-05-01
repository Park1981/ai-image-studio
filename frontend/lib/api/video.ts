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
} from "./client";
import type { TaskCreated } from "./generated-helpers";
import { mockVideoStream } from "./mocks/video";
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
      // Phase 2 (2026-05-01) — gemma4 보강 모드. 백엔드 default 가 fast 이므로 미전달 OK.
      promptMode: req.promptMode,
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

