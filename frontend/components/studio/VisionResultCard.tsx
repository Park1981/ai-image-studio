/**
 * VisionResultCard — Vision Recipe v2 결과 표시 (2026-04-26 spec 18 통합).
 * 2026-04-27 (C2-P1-2) 분해 — sub-component 들을 vision-result/* 로 추출.
 *
 * 두 모드 자동 분기 (positivePrompt 유무로 판정):
 *   - v2 row: summary + PROMPT + NEGATIVE + 디테일 6 슬롯 (vision-result/RecipeV2View)
 *   - 옛 v1 row (positivePrompt 빈): 영/한 탭 + 단락 (vision-result/LegacyV1View)
 *
 * 3 상태:
 *   - loading (running=true)
 *   - empty (result=null)
 *   - filled (v2 또는 v1)
 *
 * 모든 영역에 복사 버튼 (PROMPT / NEGATIVE / summary) — 호출처 어디서든 복사 후 사용.
 */

"use client";

import LegacyV1View from "./vision-result/LegacyV1View";
import RecipeV2View from "./vision-result/RecipeV2View";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import StudioLoadingState from "@/components/studio/StudioLoadingState";

/** v2 9 슬롯 + 옛 호환 en/ko. positivePrompt 비면 옛 row. */
export interface VisionCardResult {
  en: string;
  ko: string | null;
  summary?: string;
  positivePrompt?: string;
  negativePrompt?: string;
  composition?: string;
  subject?: string;
  clothingOrMaterials?: string;
  environment?: string;
  lightingCameraStyle?: string;
  uncertain?: string;
}

interface Props {
  result: VisionCardResult | null;
  running: boolean;
}

export default function VisionResultCard({ result, running }: Props) {
  // ─── Loading ───
  if (running) {
    return (
      <StudioLoadingState
        title="분석 중…"
        description="Vision Recipe v2 추출 + 한글 번역"
      />
    );
  }

  // ─── Empty ───
  if (!result) {
    return (
      <StudioEmptyState size="normal">
        이미지를 업로드하고 <b>분석</b> 버튼을 눌러 주세요.
      </StudioEmptyState>
    );
  }

  // ─── Branching: v2 vs v1 ───
  // 2026-05-04 통일 plan: V2/V1 분기 모두 .ais-result-hero-plain wrapper 로 감싸
  // Vision 결과 영역의 외곽 박스 톤을 다른 4 페이지와 통일. Loading/Empty 분기는
  // StudioLoadingState/StudioEmptyState 자체 외곽이 있어 wrapper 없음.
  const isV2 = !!(result.positivePrompt && result.positivePrompt.trim());
  return (
    <div className="ais-result-hero-plain">
      {isV2 ? <RecipeV2View result={result} /> : <LegacyV1View result={result} />}
    </div>
  );
}
