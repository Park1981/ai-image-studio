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
  /** 업그레이드된 영문 프롬프트의 한국어 번역 (v2 · 2026-04-23) */
  upgradedPromptKo?: string | null;
  promptProvider?: string;
  researchHints?: string[];
  visionDescription?: string;
  /** ComfyUI 에러 메시지 (Mock 폴백 시) */
  comfyError?: string | null;
}

export interface GenerateRequest {
  prompt: string;
  aspect: string;
  /** 사용자가 픽셀 직접 지정 — 주어지면 백엔드가 aspect 프리셋 대신 사용 */
  width?: number;
  height?: number;
  steps: number;
  cfg: number;
  seed: number;
  lightning: boolean;
  research: boolean;
  /** 설정 override (없으면 백엔드 기본값) */
  ollamaModel?: string;
  visionModel?: string;
  /** showUpgradeStep 사용 시: 모달에서 사용자가 확정한 영문 프롬프트 */
  preUpgradedPrompt?: string;
  /** upgrade-only 단계에서 이미 얻은 Claude 힌트 — 빈 배열 [] 도 "조사 완료" 로 간주됨.
   *  undefined 이면 백엔드가 research 플래그대로 조사 실행. */
  preResearchHints?: string[];
}

export interface UpgradeOnlyResult {
  upgradedPrompt: string;
  /** 한국어 번역 (v2 · 2026-04-23). null 이면 파싱 실패 or fallback */
  upgradedPromptKo?: string | null;
  provider: string;
  fallback: boolean;
  researchHints: string[];
}

/** gemma4 업그레이드 + 선택적 Claude 조사만 수행 (ComfyUI 호출 없음) */
export async function upgradeOnly(params: {
  prompt: string;
  research: boolean;
  ollamaModel?: string;
}): Promise<UpgradeOnlyResult> {
  if (USE_MOCK) {
    await sleep(800 + Math.random() * 600);
    return {
      upgradedPrompt: `${params.prompt}, cinematic lighting, 35mm film, shallow depth of field, editorial photo aesthetic`,
      upgradedPromptKo: `${params.prompt}, 영화적 조명, 35mm 필름, 얕은 심도, 에디토리얼 포토 감성`,
      provider: "mock",
      fallback: false,
      researchHints: params.research
        ? [
            "이 모델은 디테일한 재질·필름 그레인 키워드에 반응합니다.",
            "조명 방향·시간대 명시 권장.",
          ]
        : [],
    };
  }
  const res = await fetch(`${STUDIO_BASE}/api/studio/upgrade-only`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`upgrade-only failed: ${res.status}`);
  return (await res.json()) as UpgradeOnlyResult;
}

export interface EditRequest {
  /** data URL, 서버 ref, 또는 File 객체 */
  sourceImage: string | File;
  prompt: string;
  lightning: boolean;
  ollamaModel?: string;
  visionModel?: string;
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
      /** comfyui-sampling 시 현재 샘플러 step (예: 3) */
      samplingStep?: number | null;
      /** comfyui-sampling 시 총 샘플러 step (예: 40) */
      samplingTotal?: number | null;
    }
  | { type: "done"; item: HistoryItem; savedToHistory: boolean };

export type EditStage =
  | {
      type: "step";
      step: 1 | 2 | 3 | 4;
      done: boolean;
      /** step 1 done 에서 도착하는 비전 설명 */
      description?: string;
      /** step 2 done 에서 도착하는 최종 프롬프트 (영문) */
      finalPrompt?: string;
      /** step 2 done 에서 도착하는 한국어 번역 (v2 · 2026-04-23) */
      finalPromptKo?: string | null;
      /** step 2 provider (ollama/fallback) */
      provider?: string;
    }
  | {
      /** ComfyUI 샘플링 중 진행률/스텝 업데이트 (step 4 내부) */
      type: "sampling";
      progress: number;
      samplingStep?: number | null;
      samplingTotal?: number | null;
    }
  /**
   * 백엔드가 emit 하는 전체 파이프라인 진행률 (0~100) + 단계 라벨.
   * Generate 의 GenStage 와 동일한 의미로 통일 — ProgressModal 의 상단 진행바는 이 값만 사용.
   */
  | {
      type: "stage";
      stageType: string;
      progress: number;
      stageLabel: string;
      samplingStep?: number;
      samplingTotal?: number;
    }
  | { type: "done"; item: HistoryItem; savedToHistory: boolean };

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
      const dataLines: string[] = [];
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
  // 1. POST /generate → task_id (preUpgradedPrompt 있으면 백엔드에서 gemma4 단계 skip)
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
      const payload = evt.data as {
        item: HistoryItem;
        savedToHistory?: boolean;
      };
      yield {
        type: "done",
        item: normalizeItem(payload.item),
        // 백엔드가 안 보내면 "정상 저장" 으로 가정 (구 버전 호환)
        savedToHistory: payload.savedToHistory ?? true,
      };
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
    upgradedPromptKo: `${req.prompt}, 영화적 조명, 35mm 필름, 얕은 심도, 고해상도 디테일, 에디토리얼 포토 감성`,
    promptProvider: "mock",
    researchHints: req.research
      ? [
          "이 모델은 디테일한 재질·필름 그레인 키워드에 강하게 반응합니다.",
          "조명 방향·시간대를 명시하면 원하는 분위기가 훨씬 잘 잡힙니다.",
          "프롬프트 끝에 스타일 앵커 (editorial, 35mm 등)를 붙이세요.",
        ]
      : undefined,
  };
  yield { type: "done", item, savedToHistory: true };
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
      // 전체 파이프라인 진행률 (ProgressModal 상단 바용)
      yield {
        type: "stage",
        stageType: payload.type,
        progress: payload.progress,
        stageLabel: payload.stageLabel,
        samplingStep: payload.samplingStep ?? undefined,
        samplingTotal: payload.samplingTotal ?? undefined,
      };
      // ComfyUI 샘플링일 때 추가로 샘플러 스텝 표시용 "sampling" 이벤트도 방출
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

/* ─────────────────────────────────
   Process control
   ───────────────────────────────── */

/** 현재 실행 중인 ComfyUI 작업 인터럽트 (전역). */
export async function interruptCurrent(): Promise<boolean> {
  if (USE_MOCK) return true;
  try {
    const res = await fetch(`${STUDIO_BASE}/api/studio/interrupt`, {
      method: "POST",
    });
    return res.ok;
  } catch {
    return false;
  }
}

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

/* ─────────────────────────────────
   Ollama 모델 목록 (설치된 것)
   ───────────────────────────────── */

export interface OllamaModel {
  name: string;
  size_gb: number;
  modified_at: string;
}

export async function listOllamaModels(): Promise<OllamaModel[]> {
  if (USE_MOCK) {
    return [
      { name: "gemma4-un:latest", size_gb: 16, modified_at: "" },
      { name: "gemma4-heretic:text-q4km", size_gb: 16, modified_at: "" },
      { name: "qwen2.5vl:7b", size_gb: 5.5, modified_at: "" },
    ];
  }
  try {
    const res = await fetch(`${STUDIO_BASE}/api/studio/ollama/models`);
    if (!res.ok) return [];
    return (await res.json()) as OllamaModel[];
  } catch {
    return [];
  }
}

/* ─────────────────────────────────
   History (서버 영속)
   ───────────────────────────────── */

export async function listHistory(opts?: {
  mode?: "generate" | "edit";
  limit?: number;
  before?: number;
}): Promise<{ items: HistoryItem[]; total: number }> {
  if (USE_MOCK) {
    return { items: [], total: 0 };
  }
  const q = new URLSearchParams();
  if (opts?.mode) q.set("mode", opts.mode);
  if (opts?.limit) q.set("limit", String(opts.limit));
  if (opts?.before) q.set("before", String(opts.before));
  const res = await fetch(
    `${STUDIO_BASE}/api/studio/history?${q.toString()}`,
  );
  if (!res.ok) throw new Error(`history list failed: ${res.status}`);
  const data = (await res.json()) as {
    items: HistoryItem[];
    total: number;
  };
  return { items: data.items.map(normalizeItem), total: data.total };
}

export async function deleteHistoryItem(id: string): Promise<void> {
  if (USE_MOCK) return;
  const res = await fetch(`${STUDIO_BASE}/api/studio/history/${id}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404)
    throw new Error(`delete failed: ${res.status}`);
}

export async function clearHistory(): Promise<number> {
  if (USE_MOCK) return 0;
  const res = await fetch(`${STUDIO_BASE}/api/studio/history`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`clear failed: ${res.status}`);
  const data = (await res.json()) as { deleted: number };
  return data.deleted;
}

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
