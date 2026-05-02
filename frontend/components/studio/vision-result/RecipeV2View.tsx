/**
 * vision-result/RecipeV2View — Vision Recipe v2 풀 9 슬롯 카드.
 * 2026-04-27 (C2-P1-2): VisionResultCard 분해 — 페이지에서 추출.
 *
 * 구성:
 *   - SummaryCard (한/영 토글 · V5 Pretendard ↔ Fraunces italic 분기)
 *   - PromptToggleCard (통합/분리 모드 · A1111 호환 보존)
 *   - DetailCard 6개 그리드 (auto-fit 반응형)
 *
 * 2026-05-02 디자인 V5 Phase 6 격상:
 *  - 외곽 column flex inline → className `.ais-vision-result`
 *  - 그리드 inline → className `.ais-vision-detail-grid` (CSS minmax 260)
 */

"use client";

import DetailCard from "./DetailCard";
import PromptToggleCard from "./PromptToggle";
import SummaryCard from "./SummaryCard";
import type { VisionCardResult } from "@/components/studio/VisionResultCard";

export default function RecipeV2View({ result }: { result: VisionCardResult }) {
  const summary = result.summary || "";
  const positive = result.positivePrompt || "";
  const negative = result.negativePrompt || "";
  const ko = result.ko || "";
  const koFailed = result.ko === null;

  return (
    <div className="ais-vision-result">
      {/* Summary 카드 (한국어 우선 + 영문 토글) */}
      {summary && <SummaryCard en={summary} ko={ko} koFailed={koFailed} />}

      {/* PROMPT 토글 카드 (통합/분리 전환 · A1111 호환 보존 — 회귀 #10) */}
      <PromptToggleCard positive={positive} negative={negative} />

      {/* 디테일 슬롯 그리드 (6개) — V5 .ais-vision-detail-grid (auto-fit minmax 260) */}
      <div className="ais-vision-detail-grid">
        <DetailCard label="구도" value={result.composition} icon="grid" />
        <DetailCard label="피사체" value={result.subject} icon="scan-eye" />
        <DetailCard
          label="의상 · 재질"
          value={result.clothingOrMaterials}
          icon="image"
        />
        <DetailCard label="환경" value={result.environment} icon="film" />
        <DetailCard
          label="조명 · 카메라"
          value={result.lightingCameraStyle}
          icon="zoom-in"
        />
        <DetailCard
          label="불확실"
          value={result.uncertain}
          icon="search"
          muted
        />
      </div>
    </div>
  );
}
