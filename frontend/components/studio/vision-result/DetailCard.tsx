/**
 * vision-result/DetailCard — 디테일 슬롯 (6개 · 그리드 카드).
 * 2026-04-27 (C2-P1-2): VisionResultCard 분해 — 페이지에서 추출.
 */

"use client";

import Icon from "@/components/ui/Icon";

export type DetailIcon = "grid" | "scan-eye" | "image" | "film" | "zoom-in" | "search";

interface Props {
  label: string;
  value: string | undefined;
  icon: DetailIcon;
  muted?: boolean;
}

export default function DetailCard({ label, value, icon, muted = false }: Props) {
  const empty = !value || !value.trim();
  return (
    <div
      style={{
        background: muted ? "var(--bg-2)" : "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        opacity: muted && !empty ? 0.85 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: muted ? "var(--ink-4)" : "var(--ink-3)",
        }}
      >
        <Icon name={icon} size={11} />
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: muted ? "var(--ink-4)" : "var(--ink-3)",
            letterSpacing: ".04em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.5,
          color: muted ? "var(--ink-3)" : "var(--ink)",
          wordBreak: "break-word",
        }}
      >
        {empty ? (
          <span
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              fontStyle: "italic",
            }}
          >
            (없음)
          </span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}
