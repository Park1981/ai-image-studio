/**
 * SectionHeader — 날짜 섹션 접기·펼치기 헤더.
 * 2026-04-24 · HistoryGallery / VisionHistoryList 공용.
 *
 * 클릭 시 토글, ▼/▶ 화살표 회전, 라벨 옆에 개수 배지 노출.
 */

"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";

interface Props {
  label: string;
  count: number;
  closed: boolean;
  onToggle: () => void;
}

export default function SectionHeader({ label, count, closed, onToggle }: Props) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 4px",
        borderBottom: "1px solid var(--line)",
        fontSize: 12.5,
        fontWeight: 600,
        color: hov ? "var(--ink)" : "var(--ink-2)",
        transition: "color .15s",
      }}
      title={closed ? "펼치기" : "접기"}
    >
      <span
        style={{
          display: "inline-flex",
          transform: closed ? "rotate(-90deg)" : "rotate(0deg)",
          transition: "transform .18s",
          color: "var(--ink-3)",
        }}
      >
        <Icon name="chevron-down" size={13} />
      </span>
      <span>{label}</span>
      <span
        className="mono"
        style={{
          fontSize: 10.5,
          color: "var(--ink-4)",
          letterSpacing: ".04em",
          fontWeight: 500,
        }}
      >
        {count}
      </span>
    </button>
  );
}
