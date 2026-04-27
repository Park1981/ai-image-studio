/**
 * lib/api/edit.ts — 수정 모드 스트림 (multipart 업로드 + SSE 4단계).
 * 2026-04-23 Opus S3.
 */

import { EDIT_MODEL } from "../model-presets";
import {
  STUDIO_BASE,
  USE_MOCK,
  normalizeItem,
  parseSSE,
  sleep,
  uid,
} from "./client";
import type {
  EditRequest,
  EditStage,
  EditVisionAnalysis,
  HistoryItem,
} from "./types";

/* ─────────────────────────────────
   Edit stream — Mock vs Real 분기
   ───────────────────────────────── */

export async function* editImageStream(
  req: EditRequest,
): AsyncGenerator<EditStage, void, unknown> {
  if (USE_MOCK) {
    yield* mockEditStream(req);
    return;
  }
  yield* realEditStream(req);
}

async function* realEditStream(
  req: EditRequest,
): AsyncGenerator<EditStage, void, unknown> {
  // multipart: image 파일 + meta JSON
  const form = new FormData();
  if (typeof req.sourceImage === "string") {
    // 문자열 source 종류:
    //  1) "data:image/..." — 업로드 직후 FileReader 결과
    //  2) "http://..." or "/images/..." — 히스토리에서 선택한 서버 이미지
    //  3) "mock-seed://..." — Mock 결과 (실 백엔드에선 에러)
    const src = req.sourceImage;
    if (src.startsWith("mock-seed://")) {
      throw new Error(
        "Mock 결과 이미지는 수정에 사용 불가. 실제 생성 후 재시도해줘.",
      );
    }
    // data:/blob:/ http(s): 모두 fetch 로 통일해 blob 변환.
    // 히스토리 이미지(/images/studio/... 절대 URL)는 백엔드의 ensure_cors_for_static_images
    // 미들웨어가 Access-Control-Allow-Origin 을 주입해주므로 CORS 통과.
    try {
      const res = await fetch(src);
      if (!res.ok) {
        throw new Error(`image fetch ${res.status}: ${src.slice(0, 80)}`);
      }
      const blob = await res.blob();
      // 파일명 추출 (history URL 이면 basename, data URL 이면 "upload.png")
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
      lightning: req.lightning,
      ollamaModel: req.ollamaModel,
      visionModel: req.visionModel,
    }),
  );

  const createRes = await fetch(`${STUDIO_BASE}/api/studio/edit`, {
    method: "POST",
    body: form,
  });
  if (!createRes.ok) {
    throw new Error(`edit create failed: ${createRes.status}`);
  }
  const { stream_url } = (await createRes.json()) as {
    task_id: string;
    stream_url: string;
  };

  const streamRes = await fetch(`${STUDIO_BASE}${stream_url}`, {
    headers: { accept: "text/event-stream" },
  });
  if (!streamRes.ok) {
    throw new Error(`edit stream failed: ${streamRes.status}`);
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
        step: 1 | 2 | 3 | 4;
        done: boolean;
        description?: string;
        /** Phase 1 (2026-04-25): step 1 done 에 구조 분석 JSON 포함 가능 (휘발) */
        editVisionAnalysis?: EditVisionAnalysis;
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
      } & Record<string, unknown>;
      // Phase 2 (2026-04-27 진행 모달 store 통일):
      //   백엔드 stage emit payload 의 모든 필드 (description / finalPrompt /
      //   finalPromptKo / provider / editVisionAnalysis 등) 를 그대로 통과.
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
      // 전체 파이프라인 진행률 (ProgressModal 상단 바용) + 임의 payload 흡수.
      yield {
        type: "stage",
        stageType: payload.type,
        progress: payload.progress,
        stageLabel: payload.stageLabel,
        samplingStep: payload.samplingStep ?? undefined,
        samplingTotal: payload.samplingTotal ?? undefined,
        ...extra,
      };
      // ComfyUI 샘플링일 때 추가로 샘플러 스텝 표시용 "sampling" 이벤트도 방출
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

async function* mockEditStream(
  req: EditRequest,
): AsyncGenerator<EditStage, void, unknown> {
  const steps: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];
  for (const step of steps) {
    yield { type: "step", step, done: false };
    await sleep(500 + Math.random() * 400);
    yield { type: "step", step, done: true };
  }
  await sleep(250);

  const item: HistoryItem = {
    id: uid("edit"),
    mode: "edit",
    prompt: req.prompt,
    label: req.prompt.slice(0, 28) + (req.prompt.length > 28 ? "…" : ""),
    width: 1024,
    height: 1024,
    seed: Math.floor(Math.random() * 1e15),
    steps: req.lightning
      ? EDIT_MODEL.lightning.steps
      : EDIT_MODEL.defaults.steps,
    cfg: req.lightning ? EDIT_MODEL.lightning.cfg : EDIT_MODEL.defaults.cfg,
    lightning: req.lightning,
    model: EDIT_MODEL.displayName,
    createdAt: Date.now(),
    imageRef:
      typeof req.sourceImage === "string"
        ? req.sourceImage
        : "mock-seed://edit",
    visionDescription:
      "A subject in a minimalist studio setting, soft window light, neutral tones, photographed with shallow depth of field.",
    upgradedPrompt: `${req.prompt}, keep the exact same face, identical face, same person, same identity, realistic skin texture, no skin smoothing, photorealistic, highly detailed face, natural lighting`,
    upgradedPromptKo: `${req.prompt}, 얼굴 동일성 유지 (같은 사람, 동일한 이목구비), 사실적인 피부 텍스처, 스무딩 없음, 포토리얼리즘, 자연광`,
    promptProvider: "mock",
  };
  yield { type: "done", item, savedToHistory: true };
}
