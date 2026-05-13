/**
 * CompareCommonDiffChips — V4 공통점/차이점 칩 영역.
 * spec §5.3.3: 좌측 cyan "공통점" + 우측 amber "차이점" + 칩 hover 시 영문 원문 tooltip.
 *
 * 둘 다 빈 배열이면 미렌더.
 */

"use client";

import { pickCompareTextList, type CompareDisplayText } from "./compareLanguage";

interface Props {
  commonPointsKo: string[];
  commonPointsEn: string[];
  keyDifferencesKo: string[];
  keyDifferencesEn: string[];
}

export default function CompareCommonDiffChips({
  commonPointsKo,
  commonPointsEn,
  keyDifferencesKo,
  keyDifferencesEn,
}: Props) {
  const commonPoints = pickCompareTextList(commonPointsKo, commonPointsEn);
  const keyDifferences = pickCompareTextList(keyDifferencesKo, keyDifferencesEn);

  if (commonPoints.length === 0 && keyDifferences.length === 0) {
    return null;
  }
  return (
    <div
      className="ais-compare-chips"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
      }}
    >
      <ChipColumn
        label="공통점"
        tone="cyan"
        items={commonPoints}
      />
      <ChipColumn
        label="차이점"
        tone="amber"
        items={keyDifferences}
      />
    </div>
  );
}

function ChipColumn({
  label,
  tone,
  items,
}: {
  label: string;
  tone: "cyan" | "amber";
  items: CompareDisplayText[];
}) {
  const palette = tone === "cyan"
    ? { bg: "rgba(34, 211, 238, 0.12)", color: "rgb(8, 145, 178)", border: "rgba(34, 211, 238, 0.3)" }
    : { bg: "rgba(251, 191, 36, 0.12)", color: "rgb(180, 83, 9)", border: "rgba(251, 191, 36, 0.3)" };

  return (
    <div
      className="ais-compare-chips-col"
      data-tone={tone}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: palette.color,
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map((item, i) => {
          const tooltip = item.lang === "ko" && item.en ? item.en : undefined;
          return (
            <span
              key={`${tone}-${i}`}
              className="ais-compare-chip"
              title={tooltip}
              lang={item.lang}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 12,
                background: palette.bg,
                color: palette.color,
                border: `1px solid ${palette.border}`,
                whiteSpace: "nowrap",
              }}
            >
              {item.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
