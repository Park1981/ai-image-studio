/**
 * lib/api/generate.ts — 생성 모드 스트림 + 업그레이드/조사.
 * 2026-04-23 Opus S3.
 */

import { ASPECT_RATIOS, GENERATE_MODEL } from "../model-presets";
import {
  STUDIO_BASE,
  USE_MOCK,
  normalizeItem,
  parseSSE,
  resolveSeed,
  sleep,
  uid,
} from "./client";
import type { TaskCreated } from "./generated-helpers";
import type {
  GenStage,
  GenerateRequest,
  HistoryItem,
  UpgradeOnlyResult,
} from "./types";

/** gemma4 업그레이드 + 선택적 Claude 조사만 수행 (ComfyUI 호출 없음).
 *
 * spec 19 후속 (Codex 추가 fix): aspect/width/height 도 전달 → backend 가
 * SYSTEM_GENERATE 에 [Output dimensions] 컨텍스트 주입. 이전엔 upgrade-only
 * 경로만 빠져 있어 "업그레이드 확인" 모달 사용 시 size context 누락됐음.
 */
export async function upgradeOnly(params: {
  prompt: string;
  research: boolean;
  ollamaModel?: string;
  aspect?: string;
  width?: number;
  height?: number;
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
  // Tier 3 (2026-04-27): generated OpenAPI 타입 사용 — backend schema 변경 시 자동 drift 감지
  const { task_id, stream_url } = (await createRes.json()) as TaskCreated;

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
