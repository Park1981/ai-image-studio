/**
 * lib/api/mocks/generate.ts — 생성 모드 Mock 스트림 (Phase 3.5 분리).
 * 2026-04-30 · USE_MOCK=true 환경에서 가짜 SSE stage 시퀀스 + 결과 item 생성.
 * 실제 백엔드 호출 없이 UI 검증용 데이터만 흘려주는 용도.
 */

import { ASPECT_RATIOS, GENERATE_MODEL } from "../../model-presets";
import { resolveSeed, sleep, uid } from "../client";
import type { GenStage, GenerateRequest, HistoryItem } from "../types";

/** 생성 모드 mock 스트림 — 백엔드 6단계 (prompt-parse / gemma4-upgrade /
 *  optional claude-research / workflow-dispatch / comfyui-sampling / postprocess)
 *  + done 패턴을 모방. UI 진행 모달과 결과 카드 검증용.
 */
export async function* mockGenerateStream(
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
