/**
 * lib/api/mocks/compare.ts — Compare Analyzer Mock (Phase 3.5 fix · 추가 분리).
 * 2026-04-30 · USE_MOCK=true 환경에서 stage emit + sleep 후 가짜 결과 반환.
 * Edit context (5축: face_id/body_pose/attire/background/intent_fidelity) +
 * Compare context (5축: composition/color/subject/mood/quality) 두 분기 처리.
 */

import { sleep } from "../client";
import type {
  CompareAnalyzeRequest,
  CompareAnalyzeResponse,
} from "../compare";

/** Compare Analyzer mock — `compareAnalyze()` 의 USE_MOCK 분기에서 호출.
 *  context = "compare" → Vision Compare 5축, 그 외 → Edit 5축.
 */
export async function mockCompareAnalyze(
  req: CompareAnalyzeRequest,
): Promise<CompareAnalyzeResponse> {
  const isCompare = req.context === "compare";

  if (req.onStage) {
    req.onStage({
      type: "compare-encoding",
      progress: 5,
      stageLabel: "이미지 A/B 인코딩",
    });
  }
  await sleep(150);
  if (req.onStage) {
    req.onStage({
      type: "vision-pair",
      progress: 25,
      stageLabel: "두 이미지 비교 분석 (qwen2.5vl)",
    });
  }
  await sleep(500 + Math.random() * 400);
  if (req.onStage) {
    req.onStage({
      type: "translation",
      progress: 75,
      stageLabel: "한국어 번역 (gemma4)",
    });
  }
  await sleep(150);

  if (isCompare) {
    // Vision Compare 5축 mock (composition/color/subject/mood/quality)
    return {
      analysis: {
        scores: {
          composition: 78,
          color: 65,
          subject: 92,
          mood: 70,
          quality: 88,
        },
        overall: 79,
        comments_en: {
          composition: "Similar framing with minor crop differences.",
          color: "Image B has warmer tones.",
          subject: "Same person, slightly different pose.",
          mood: "Both calm but B is brighter.",
          quality: "B has higher resolution feel.",
        },
        comments_ko: {
          composition: "비슷한 프레이밍, 약간의 크롭 차이.",
          color: "B 가 더 따뜻한 톤.",
          subject: "동일 인물, 자세 약간 다름.",
          mood: "둘 다 차분, B 가 더 밝음.",
          quality: "B 가 해상도가 더 좋게 느껴짐.",
        },
        summary_en: "A and B are very similar with mild stylistic shifts.",
        summary_ko: "A·B 매우 유사 · 약간의 스타일 변화.",
        provider: "ollama",
        fallback: false,
        analyzedAt: Date.now(),
        visionModel: req.visionModel ?? "qwen2.5vl:7b",
      },
      saved: false,
    };
  }
  // Edit 5축 mock (face_id/body_pose/attire/background/intent_fidelity) — 기존 그대로
  return {
    analysis: {
      scores: {
        face_id: 92,
        body_pose: 75,
        attire: 60,
        background: 88,
        intent_fidelity: 95,
      },
      overall: 82,
      comments_en: {
        face_id: "Eyes and jaw preserved.",
        body_pose: "Shoulder slightly narrower.",
        attire: "Top color changed as requested.",
        background: "Curtain pattern preserved.",
        intent_fidelity: "Earrings added accurately.",
      },
      comments_ko: {
        face_id: "눈과 턱 보존됨.",
        body_pose: "어깨가 약간 좁아짐.",
        attire: "상의 색상이 요청대로 변경됨.",
        background: "커튼 패턴 보존됨.",
        intent_fidelity: "귀걸이가 정확히 추가됨.",
      },
      summary_en: "Solid result with minor body drift.",
      summary_ko: "신원 보존 양호 · 약간의 체형 변화.",
      provider: "ollama",
      fallback: false,
      analyzedAt: Date.now(),
      visionModel: req.visionModel ?? "qwen2.5vl:7b",
    },
    saved: !!req.historyItemId,
  };
}
