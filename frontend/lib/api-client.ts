/**
 * lib/api-client.ts — 새 디자인용 API 레이어 (Mock ↔ Real 스위치 가능).
 *
 * 스위치 방법:
 *   USE_MOCK=true  (기본): setTimeout 기반 가짜 파이프라인
 *   USE_MOCK=false         : /api/studio/* 실 백엔드 호출 (SSE 스트림 파싱)
 *
 * 실 백엔드 URL 은 NEXT_PUBLIC_STUDIO_API 로 재정의 가능 (기본 http://localhost:8001).
 */

import { ASPECT_RATIOS, GENERATE_MODEL, EDIT_MODEL } from "./model-presets";

export const USE_MOCK =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_USE_MOCK !== "false"
    : true;

const STUDIO_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STUDIO_API) ||
  "http://localhost:8001";

/* ─────────────────────────────────
   타입
   ───────────────────────────────── */

export interface HistoryItem {
  id: string;
  mode: "generate" | "edit";
  prompt: string;
  label: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  lightning: boolean;
  model: string;
  createdAt: number;
  imageRef: string;
  /** 실 백엔드가 보조로 포함할 수 있는 메타 */
  upgradedPrompt?: string;
  promptProvider?: string;
  researchHints?: string[];
  visionDescription?: string;
}

export interface GenerateRequest {
  prompt: string;
  aspect: string;
  steps: number;
  cfg: number;
  seed: number;
  lightning: boolean;
  research: boolean;
}

export interface EditRequest {
  /** data URL, 서버 ref, 또는 File 객체 */
  sourceImage: string | File;
  prompt: string;
  lightning: boolean;
}

export type GenStage =
  | {
      type:
        | "prompt-parse"
        | "gemma4-upgrade"
        | "claude-research"
        | "workflow-dispatch"
        | "comfyui-sampling"
        | "postprocess";
      progress: number;
      stageLabel: string;
    }
  | { type: "done"; item: HistoryItem };

export type EditStage =
  | { type: "step"; step: 1 | 2 | 3 | 4; done: boolean }
  | { type: "done"; item: HistoryItem };

/* ─────────────────────────────────
   공용 유틸
   ───────────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uid = (prefix = "id") =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function resolveSeed(seed: number): number {
  return seed && seed > 0 ? seed : Math.floor(Math.random() * 1e15);
}

/**
 * 백엔드가 반환한 imageRef 를 절대 URL 로 정규화.
 * - "/images/..." → `${STUDIO_BASE}/images/...` (기본 http://localhost:8001)
 * - 나머지 (data:, blob:, http(s):, mock-seed:, etc.) 는 그대로.
 * 이 처리를 api-client 에 모아두면 ImageTile 은 절대 URL 만 받음.
 */
function normalizeImageRef(ref: string): string {
  if (ref.startsWith("/")) return `${STUDIO_BASE}${ref}`;
  return ref;
}

/** HistoryItem 의 imageRef 필드를 정규화해서 반환 */
function normalizeItem(item: HistoryItem): HistoryItem {
  return { ...item, imageRef: normalizeImageRef(item.imageRef) };
}

/**
 * SSE 스트림 파서 — fetch 의 ReadableStream 을 `event: X\ndata: {...}\n\n` 단위로 끊어서 yield.
 */
async function* parseSSE(
  response: Response,
): AsyncGenerator<{ event: string; data: unknown }, void, unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SSE body missing");
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let eventName = "message";
      let dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length > 0) {
        const raw = dataLines.join("\n");
        try {
          yield { event: eventName, data: JSON.parse(raw) };
        } catch {
          yield { event: eventName, data: raw };
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

/* ─────────────────────────────────
   Generate stream — Mock vs Real 분기
   ───────────────────────────────── */

export async function* generateImageStream(
  req: GenerateRequest,
): AsyncGenerator<GenStage, void, unknown> {
  if (USE_MOCK) {
    yield* mockGenerateStream(req);
    return;
  }
  yield* realGenerateStream(req);
}

async function* realGenerateStream(
  req: GenerateRequest,
): AsyncGenerator<GenStage, void, unknown> {
  // 1. POST /generate → task_id
  const createRes = await fetch(`${STUDIO_BASE}/api/studio/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!createRes.ok) {
    throw new Error(`generate create failed: ${createRes.status}`);
  }
  const { task_id, stream_url } = (await createRes.json()) as {
    task_id: string;
    stream_url: string;
  };

  // 2. GET stream (SSE)
  const streamRes = await fetch(`${STUDIO_BASE}${stream_url}`, {
    headers: { accept: "text/event-stream" },
  });
  if (!streamRes.ok) {
    throw new Error(`stream connect failed: ${streamRes.status}`);
  }

  for await (const evt of parseSSE(streamRes)) {
    if (evt.event === "error") {
      const payload = evt.data as { message?: string };
      throw new Error(payload.message || "pipeline error");
    }
    if (evt.event === "done") {
      const payload = evt.data as { item: HistoryItem };
      yield { type: "done", item: normalizeItem(payload.item) };
      return;
    }
    if (evt.event === "stage") {
      yield evt.data as GenStage;
    }
  }
  void task_id; // 현재 취소 기능 없음 — 추후 task_id 로 DELETE
}

async function* mockGenerateStream(
  req: GenerateRequest,
): AsyncGenerator<GenStage, void, unknown> {
  const steps: GenStage[] = [
    { type: "prompt-parse", progress: 15, stageLabel: "프롬프트 해석" },
    { type: "gemma4-upgrade", progress: 35, stageLabel: "gemma4 업그레이드" },
  ];
  if (req.research) {
    steps.push({
      type: "claude-research",
      progress: 50,
      stageLabel: "Claude 조사 반영",
    });
  }
  steps.push(
    { type: "workflow-dispatch", progress: 60, stageLabel: "워크플로우 전달" },
    { type: "comfyui-sampling", progress: 88, stageLabel: "ComfyUI 샘플링" },
    { type: "postprocess", progress: 97, stageLabel: "후처리" },
  );

  for (const step of steps) {
    await sleep(350 + Math.random() * 500);
    yield step;
  }
  await sleep(200);

  const aspect =
    ASPECT_RATIOS.find((a) => a.label === req.aspect) ?? ASPECT_RATIOS[0];
  const item: HistoryItem = {
    id: uid("gen"),
    mode: "generate",
    prompt: req.prompt,
    label: req.prompt.slice(0, 28) + (req.prompt.length > 28 ? "…" : ""),
    width: aspect.width,
    height: aspect.height,
    seed: resolveSeed(req.seed),
    steps: req.steps,
    cfg: req.cfg,
    lightning: req.lightning,
    model: GENERATE_MODEL.displayName,
    createdAt: Date.now(),
    imageRef: `mock-seed://${uid("img")}`,
    // Mock 에서도 AI 보강 결과 필드 채워서 UI 검증 가능
    upgradedPrompt: `${req.prompt}, cinematic lighting, 35mm film, shallow depth of field, highly detailed, editorial photo aesthetic`,
    promptProvider: "mock",
    researchHints: req.research
      ? [
          "이 모델은 디테일한 재질·필름 그레인 키워드에 강하게 반응합니다.",
          "조명 방향·시간대를 명시하면 원하는 분위기가 훨씬 잘 잡힙니다.",
          "프롬프트 끝에 스타일 앵커 (editorial, 35mm 등)를 붙이세요.",
        ]
      : undefined,
  };
  yield { type: "done", item };
}

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
    // data URL → Blob 변환
    if (req.sourceImage.startsWith("data:")) {
      const blob = await (await fetch(req.sourceImage)).blob();
      form.append("image", blob, "upload.png");
    } else {
      throw new Error("non-dataURL string sources not supported yet");
    }
  } else {
    form.append("image", req.sourceImage);
  }
  form.append(
    "meta",
    JSON.stringify({ prompt: req.prompt, lightning: req.lightning }),
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
      const payload = evt.data as { item: HistoryItem };
      yield { type: "done", item: normalizeItem(payload.item) };
      return;
    }
    if (evt.event === "step") {
      const payload = evt.data as { step: 1 | 2 | 3 | 4; done: boolean };
      yield { type: "step", ...payload };
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
    promptProvider: "mock",
  };
  yield { type: "done", item };
}

/* ─────────────────────────────────
   Process control
   ───────────────────────────────── */

export async function setProcessStatus(
  name: "ollama" | "comfyui",
  action: "start" | "stop",
): Promise<{ ok: boolean; message?: string }> {
  if (USE_MOCK) {
    await sleep(400);
    return { ok: true };
  }
  const res = await fetch(
    `${STUDIO_BASE}/api/studio/process/${name}/${action}`,
    { method: "POST" },
  );
  if (!res.ok) {
    return { ok: false, message: `${res.status}` };
  }
  return res.json();
}

/* ─────────────────────────────────
   Research (Claude CLI)
   ───────────────────────────────── */

export async function researchPrompt(
  prompt: string,
  model: string,
): Promise<{ hints: string[] }> {
  if (USE_MOCK) {
    await sleep(1500 + Math.random() * 1200);
    return {
      hints: [
        `"${model}" 은 하이퍼 디테일·필름 그레인 키워드를 잘 살립니다.`,
        "조명 방향과 시간대를 명시하면 품질이 확 뛰어요.",
        `프롬프트 끝에 스타일 앵커 1~2개 붙이면 일관성 ↑`,
      ],
    };
  }
  const res = await fetch(`${STUDIO_BASE}/api/studio/research`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, model }),
  });
  if (!res.ok) throw new Error(`research failed: ${res.status}`);
  const data = (await res.json()) as {
    ok: boolean;
    hints: string[];
    error?: string;
  };
  if (!data.ok) throw new Error(data.error || "research error");
  return { hints: data.hints };
}
