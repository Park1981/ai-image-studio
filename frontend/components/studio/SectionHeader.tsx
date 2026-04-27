/**
 * SectionHeader — 날짜 섹션 접기·펼치기 헤더.
 * 2026-04-24 · HistoryGallery / VisionHistoryList 공용.
 *
 * 클릭 시 토글, ▼/▶ 화살표 회전, 라벨 옆에 개수 chip 노출.
 *
 * 2026-04-27 폴리시 (오빠 피드백):
 *  - label fontSize 12.5 → 14, weight 600 → 700 (시각 위계 ↑)
 *  - count → 둥근 회색 chip pill (Image #7 reference)
 *  - chevron 색 ink-3 → ink-2 (더 분명)
 *  - 박스 카드 형태 (border + radius + background + shadow) — 닫힘/열림 동일 (옵션 A)
 *    · 닫힘만 박스 (옵션 D) 시도 → "사라져서 오히려 이상" 피드백 → A 로 후퇴.
 *  - box-sizing: border-box 명시 — `all: "unset"` 이 box-sizing 까지 reset 해서
 *    padding 더해질 때 우측 짤리던 문제 해결.
 *  - 닫힘=옅은 색 / 열림=진한 색 → 위계 표현 (박스는 같지만 텍스트 색으로 분기)
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
        // all: unset 이 box-sizing 도 reset → padding/border 가 width 위로 더해져 우측 짤림.
        // border-box 명시로 해결.
        boxSizing: "border-box",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "10px 14px",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-md)",
        background: hov ? "var(--bg-2)" : "var(--surface)",
        boxShadow: "var(--shadow-sm)",
        // 닫힘=옅음 / 열림=진함 → 시각 위계
        color: closed
          ? hov
            ? "var(--ink-2)"
            : "var(--ink-3)"
          : "var(--ink)",
        transition: "color .15s, background .15s, border-color .15s",
      }}
      title={closed ? "펼치기" : "접기"}
    >
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          transform: closed ? "rotate(-90deg)" : "rotate(0deg)",
          transition: "transform .18s",
          color: "var(--ink-2)",
        }}
      >
        <Icon name="chevron-down" size={14} />
      </span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "-.005em",
        }}
      >
        {label}
      </span>
      {/* count chip — 둥근 회색 pill (Image #7 reference) */}
      <span
        className="mono"
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: ".04em",
          color: "var(--ink-3)",
          background: "var(--bg-2)",
          padding: "2px 8px",
          borderRadius: "var(--radius-full)",
          border: "1px solid var(--line)",
        }}
      >
        {count}
      </span>
    </button>
  );
}
