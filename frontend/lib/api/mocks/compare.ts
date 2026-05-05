/**
 * Compare 메뉴 mock (USE_MOCK 모드).
 *
 * V4 shape — 옛 5축 score mock 폐기.
 */

import type { CompareAnalyzeRequest, CompareAnalyzeResponse } from "../compare";
import type { VisionCompareAnalysisV4 } from "../types";

/** SSE stage emit 모사 (실 백엔드의 5 stage 시퀀스 그대로) */
async function emitMockStages(
  onStage?: CompareAnalyzeRequest["onStage"],
): Promise<void> {
  const stages = [
    { type: "compare-encoding", progress: 5, stageLabel: "이미지 A/B 인코딩" },
    { type: "observe1", progress: 20, stageLabel: "Image1 관찰 (qwen3-vl)" },
    { type: "observe2", progress: 40, stageLabel: "Image2 관찰 (qwen3-vl)" },
    { type: "diff-synth", progress: 70, stageLabel: "차이 합성 (gemma4)" },
    { type: "translation", progress: 90, stageLabel: "한국어 번역 (gemma4)" },
  ];
  for (const s of stages) {
    onStage?.(s);
    await new Promise((r) => setTimeout(r, 200));
  }
}

function makeV4Sample(): VisionCompareAnalysisV4 {
  return {
    summaryEn: "Both images show the same person; image2 is winking.",
    summaryKo: "두 이미지는 같은 인물입니다. 두 번째는 한쪽 눈을 감고 있습니다.",
    commonPointsEn: ["same person", "same outfit", "studio setting"],
    commonPointsKo: ["같은 인물", "같은 의상", "스튜디오 배경"],
    keyDifferencesEn: ["one eye closed", "head turned slightly"],
    keyDifferencesKo: ["한쪽 눈 감음", "고개 살짝 돌림"],
    domainMatch: "person",
    categoryDiffs: {
      composition: {
        image1: "head-on, centered",
        image2: "3/4 view, slightly turned",
        diff: "head turned ~30 degrees",
        image1Ko: "정면, 중앙",
        image2Ko: "3/4 측면, 살짝 돌림",
        diffKo: "고개 약 30도 돌아감",
      },
      subject: {
        image1: "both eyes open",
        image2: "left eye closed (winking)",
        diff: "winking on left side",
        image1Ko: "두 눈 모두 뜸",
        image2Ko: "왼쪽 눈 감음",
        diffKo: "왼쪽으로 윙크",
      },
      clothing_or_materials: {
        image1: "white tank top",
        image2: "white tank top",
        diff: "identical",
        image1Ko: "흰색 탱크탑",
        image2Ko: "흰색 탱크탑",
        diffKo: "동일",
      },
      environment: {
        image1: "studio backdrop",
        image2: "studio backdrop",
        diff: "identical",
        image1Ko: "스튜디오 배경",
        image2Ko: "스튜디오 배경",
        diffKo: "동일",
      },
      lighting_camera_style: {
        image1: "softbox",
        image2: "softbox",
        diff: "identical",
        image1Ko: "소프트박스",
        image2Ko: "소프트박스",
        diffKo: "동일",
      },
    },
    categoryScores: {
      composition: 85,
      subject: 70,
      clothing_or_materials: 100,
      environment: 100,
      lighting_camera_style: 95,
    },
    keyAnchors: [
      {
        label: "eye state",
        image1: "both eyes open",
        image2: "left eye closed",
        image1Ko: "두 눈 뜸",
        image2Ko: "왼쪽 눈 감음",
      },
    ],
    fidelityScore: 88,
    transformPromptEn: "close left eye and turn head 30 degrees to the right",
    transformPromptKo: "왼쪽 눈을 감고 고개를 오른쪽으로 30도 돌리세요",
    uncertainEn: "",
    uncertainKo: "",
    observation1: { mock: true, image: 1 },
    observation2: { mock: true, image: 2 },
    provider: "ollama",
    fallback: false,
    analyzedAt: Date.now(),
    visionModel: "qwen3-vl:8b",
    textModel: "gemma4-un:latest",
  };
}

export async function mockCompareAnalyze(
  req: CompareAnalyzeRequest,
): Promise<CompareAnalyzeResponse> {
  await emitMockStages(req.onStage);
  return {
    analysis: makeV4Sample(),
    saved: false, // compare context 휘발
  };
}
