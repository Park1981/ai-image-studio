/**
 * vision-result/RecipeV2View — Vision Recipe v2 풀 9 슬롯 카드.
 * 2026-04-27 (C2-P1-2): VisionResultCard 분해 — 페이지에서 추출.
 *
 * 구성:
 *   - SummaryCard (한/영 토글)
 *   - PromptToggleCard (통합/분리 모드)
 *   - DetailCard 6개 그리드 (auto-fit 반응형)
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* ── Summary 카드 (한국어 우선 + 영문 토글) ── */}
      {summary && <SummaryCard en={summary} ko={ko} koFailed={koFailed} />}

      {/* ── PROMPT 토글 카드 (통합/분리 전환) ── */}
      <PromptToggleCard positive={positive} negative={negative} />

      {/* ── 디테일 슬롯 그리드 (6개) ──
          P0-1 반응형 (2026-04-26): auto-fit + minmax(280px) 로 폭에 따라 2~3열 자연 조정.
          1024px 우측 패널(~600px) → 2열 / 1440px(~1000px) → 3열 / 1920px(~1480px) → 4-5열. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 10,
        }}
      >
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
