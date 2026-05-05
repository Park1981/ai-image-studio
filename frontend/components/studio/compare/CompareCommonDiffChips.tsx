/**
 * CompareCommonDiffChips — V4 공통점/차이점 칩 영역.
 * spec §5.3.3: 좌측 cyan "공통점" + 우측 amber "차이점" + 칩 hover 시 영문 원문 tooltip.
 *
 * 둘 다 빈 배열이면 미렌더.
 */

"use client";

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
  if (commonPointsKo.length === 0 && keyDifferencesKo.length === 0) {
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
        ko={commonPointsKo}
        en={commonPointsEn}
      />
      <ChipColumn
        label="차이점"
        tone="amber"
        ko={keyDifferencesKo}
        en={keyDifferencesEn}
      />
    </div>
  );
}

function ChipColumn({
  label,
  tone,
  ko,
  en,
}: {
  label: string;
  tone: "cyan" | "amber";
  ko: string[];
  en: string[];
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
        {ko.map((text, i) => {
          const tooltip = i < en.length ? en[i] : undefined;
          return (
            <span
              key={`${tone}-${i}`}
              className="ais-compare-chip"
              title={tooltip}
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
              {text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
