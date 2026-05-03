/**
 * lib/api/mocks/video.ts — LTX-2.3 영상 모드 Mock 스트림 (Phase 3.5 분리).
 * 2026-04-30 · 5-stage + save-output emit. Mock 모드는 실제 mp4 없음 →
 * `mock-seed://video` sentinel 로 통일 (VideoPlayerCard / Lightbox 안내 표시).
 */

import { sleep, uid } from "../client";
import { VIDEO_MODEL_PRESETS, DEFAULT_VIDEO_MODEL_ID } from "@/lib/model-presets";
import type { HistoryItem, VideoRequest, VideoStage } from "../types";

/** 영상 모드 mock 스트림 — 백엔드 5-stage (vision-analyze / prompt-merge /
 *  workflow-dispatch / comfyui-sampling / save-output) 와 동일 패턴 + detail
 *  payload (description / finalPrompt 등) 흡수.
 */
export async function* mockVideoStream(
  req: VideoRequest,
): AsyncGenerator<VideoStage, void, unknown> {
  const desc =
    "A person stands in warm window light with shallow depth of field.";
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
    {
      stageType: "vision-analyze",
      progress: 20,
      stageLabel: "비전 분석 완료",
      extra: { description: desc },
    },
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
    yield {
      type: "stage",
      stageType: s.stageType,
      progress: s.progress,
      stageLabel: s.stageLabel,
      ...(s.extra ?? {}),
    };
    await sleep(250 + Math.random() * 150);
  }

  // Phase 3 (2026-05-03) — modelId 별 mock 응답 분기.
  const modelId = req.modelId ?? DEFAULT_VIDEO_MODEL_ID;
  const preset = VIDEO_MODEL_PRESETS[modelId];
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
    model: preset.displayName,
    modelId,
    createdAt: Date.now(),
    // Mock 모드는 실제 mp4 가 없음 → mock-seed:// sentinel 로 통일.
    // VideoPlayerCard / ImageLightbox 가 이 sentinel 을 보면 재생 시도 안 하고 안내 표시.
    imageRef: "mock-seed://video",
    visionDescription: "(mock) warm window light portrait",
    upgradedPrompt:
      "cinematic dolly in, warm window light, shallow DoF, film grain",
    upgradedPromptKo:
      "시네마틱 달리 인, 따뜻한 창가 빛, 얕은 심도, 필름 그레인",
    promptProvider: "mock",
    fps: preset.baseFps,
    frameCount: preset.defaultLength,
    durationSec: Math.round((preset.defaultLength / preset.baseFps) * 100) / 100,
  };
  yield { type: "done", item, savedToHistory: true };
}
