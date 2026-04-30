/**
 * lib/api/mocks/edit.ts — 수정 모드 Mock 스트림 (Phase 3.5 분리).
 * 2026-04-30 · USE_MOCK=true 환경에서 4-stage + save-output stage emit.
 * Phase 4 (2026-04-27 진행 모달 store 통일) 패턴 그대로 유지.
 */

import { EDIT_MODEL } from "../../model-presets";
import { sleep, uid } from "../client";
import type { EditRequest, EditStage, HistoryItem } from "../types";

/** 수정 모드 mock 스트림 — 백엔드 4-stage (vision-analyze / prompt-merge /
 *  param-extract / comfyui-sampling) + save-output 패턴과 동일.
 */
export async function* mockEditStream(
  req: EditRequest,
): AsyncGenerator<EditStage, void, unknown> {
  const stages: { stageType: string; progress: number; stageLabel: string }[] = [
    { stageType: "vision-analyze", progress: 10, stageLabel: "비전 분석" },
    { stageType: "vision-analyze", progress: 30, stageLabel: "비전 분석 완료" },
    { stageType: "prompt-merge", progress: 40, stageLabel: "프롬프트 병합" },
    { stageType: "prompt-merge", progress: 50, stageLabel: "프롬프트 병합 완료" },
    { stageType: "param-extract", progress: 55, stageLabel: "파라미터 추출" },
    { stageType: "param-extract", progress: 65, stageLabel: "파라미터 확정" },
    { stageType: "comfyui-sampling", progress: 70, stageLabel: "ComfyUI 샘플링 대기" },
    { stageType: "comfyui-sampling", progress: 95, stageLabel: "ComfyUI 샘플링" },
    { stageType: "save-output", progress: 98, stageLabel: "결과 저장" },
  ];
  for (const s of stages) {
    yield { type: "stage", ...s };
    await sleep(250 + Math.random() * 150);
  }

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
