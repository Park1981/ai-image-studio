/**
 * CompareResultHeader — V4 결과 헤더.
 * spec §5.3.1: 좌측 한국어 한 줄 요약 + 우측 fidelity chip (유사도 N%).
 *
 * Chip 표시 조건: domainMatch !== "mixed" && fidelityScore !== null.
 * Tone 분기: >=90 cyan / 80~89 amber / <80 muted (data-tone 속성으로 CSS 분기).
 */

"use client";

import { pickCompareText } from "./compareLanguage";

interface Props {
  summaryEn: string;
  summaryKo: string;
  fidelityScore: number | null;
  domainMatch: "person" | "object_scene" | "mixed";
}

function fidelityTone(score: number): "cyan" | "amber" | "muted" {
  if (score >= 90) return "cyan";
  if (score >= 80) return "amber";
  return "muted";
}

export default function CompareResultHeader({
  summaryEn,
  summaryKo,
  fidelityScore,
  domainMatch,
}: Props) {
  const showChip = domainMatch !== "mixed" && fidelityScore !== null;
  const tone = fidelityScore !== null ? fidelityTone(fidelityScore) : "muted";
  const summary = pickCompareText(summaryKo, summaryEn);

  return (
    <div
      className="ais-compare-result-header"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div
        className="ais-compare-summary"
        style={{
          fontSize: 15,
          color: "var(--ink-1)",
          lineHeight: 1.5,
          flex: 1,
        }}
        lang={summary.lang}
      >
        {summary.text}
      </div>
      {showChip && (
        <div
          className="ais-compare-fidelity-chip"
          data-tone={tone}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: "nowrap",
            background:
              tone === "cyan"
                ? "rgba(34, 211, 238, 0.12)"
                : tone === "amber"
                ? "rgba(251, 191, 36, 0.12)"
                : "rgba(148, 163, 184, 0.12)",
            color:
              tone === "cyan"
                ? "rgb(8, 145, 178)"
                : tone === "amber"
                ? "rgb(180, 83, 9)"
                : "rgb(100, 116, 139)",
          }}
        >
          유사도 {fidelityScore}%
        </div>
      )}
    </div>
  );
}
