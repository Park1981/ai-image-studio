/**
 * lib/api/mocks/vision.ts — Vision Analyzer Mock (Phase 3.5 fix · 추가 분리).
 * 2026-04-30 · USE_MOCK=true 환경에서 단계별 sleep + onStage emit + 가짜 결과 반환.
 * 실 백엔드 task-based SSE 패턴 모사 (vision-encoding / vision-analyze / translation 3단계).
 */

import { sleep } from "../client";
import type { VisionAnalysisResponse } from "../types";
import type { AnalyzeImageOptions } from "../vision";

/** Vision Analyzer mock — `analyzeImage()` 의 USE_MOCK 분기에서 호출.
 *  sourceImage 는 사용 안 함 (가짜 결과 고정) → underscore prefix.
 */
export async function mockAnalyze(
  _sourceImage: string | File,
  opts: AnalyzeImageOptions,
): Promise<VisionAnalysisResponse> {
  void _sourceImage;
  // Mock 도 stage 이벤트 emit — 진행 모달 정상 표시 보존 (Phase 4 mock 도 stage 변환 정책 일관)
  if (opts.onStage) {
    opts.onStage({
      type: "vision-encoding",
      progress: 5,
      stageLabel: "이미지 인코딩",
    });
  }
  await sleep(150);
  if (opts.onStage) {
    opts.onStage({
      type: "vision-analyze",
      progress: 20,
      stageLabel: "이미지 분석 (qwen2.5vl)",
    });
  }
  await sleep(300 + Math.random() * 300);
  if (opts.onStage) {
    opts.onStage({
      type: "translation",
      progress: 70,
      stageLabel: "한국어 번역 (gemma4)",
    });
  }
  await sleep(150);
  return {
    en: "Editorial-style portrait photograph, soft north-facing window light pooling on the subject's left cheek, shallow depth of field with creamy bokeh, neutral warm palette blending ochre and muted terracotta, fine skin texture retained with subtle 35mm film grain, balanced rule-of-thirds composition, slight matte film look, quiet contemplative mood.",
    ko: "에디토리얼 스타일 인물 사진, 북쪽 창가에서 들어오는 부드러운 빛이 피사체의 왼쪽 볼에 고임, 크리미한 보케가 만드는 얕은 심도, 오커와 뮤트 테라코타가 섞인 뉴트럴 웜 팔레트, 35mm 필름의 미묘한 그레인이 살아있는 섬세한 피부 질감, 삼분할 구도의 균형 있는 프레이밍, 매트한 필름 룩, 차분하고 사색적인 분위기.",
    provider: "mock",
    fallback: false,
    width: 1024,
    height: 1024,
    sizeBytes: 482_000,
    summary:
      "An editorial portrait of a contemplative figure lit by soft north window light.",
    positivePrompt:
      "Editorial portrait of a young figure facing slightly away from camera, soft north window light pooling on left cheek, 35mm f/1.4 shallow depth of field with creamy bokeh, balanced rule-of-thirds framing, neutral warm palette of ochre and muted terracotta, fine retained skin texture with subtle 35mm film grain, matte film stock look, quiet contemplative studio setting, cinematic photography, ultra detailed.",
    negativePrompt:
      "extra fingers, deformed hands, blurry, lowres, watermark, text artifacts, oversaturated, plastic skin",
    composition: "Medium close-up, rule of thirds, subject centered slightly left.",
    subject: "Young figure, neutral expression, head turned slightly away.",
    clothingOrMaterials: "Soft wool knit, matte finish, muted ochre tone.",
    environment: "Clean indoor studio, neutral wall, soft window light from left.",
    lightingCameraStyle:
      "North window soft key from left, no fill, 35mm f/1.4, shallow DOF, matte film grading.",
    uncertain: "Exact age, ethnicity, location.",
  };
}
