/**
 * HistorySectionHeader — 히스토리 섹션 헤더 공용 템플릿.
 * 2026-04-24 · 4 메뉴 (generate / edit / video / vision) 통일.
 *
 * 레이아웃:
 *  - 상단 border-top 구분선
 *  - 좌: h3 "{title}" + 수량 배지
 *  - 우: actions slot (컬럼 토글, 모두 지우기 등 메뉴별 액션)
 */

"use client";

import type { ReactNode } from "react";
import {
  SectionAccentBar,
  type SectionAccent,
} from "./StudioResultHeader";

interface Props {
  title: string;
  count: number;
  /** 수량 뒤 단위 (기본 "items"). Vision 은 "/ max" 같은 별도 포맷이 필요하면 countLabel 로 override */
  countLabel?: string;
  /** 우측 액션 버튼 slot */
  actions?: ReactNode;
  /** 좌측 accent bar 색 (기본 neutral · 보관 톤) */
  accent?: SectionAccent;
}

export default function HistorySectionHeader({
  title,
  count,
  countLabel = "items",
  actions,
  accent = "neutral",
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: 4,
        borderTop: "1px solid var(--line)",
        marginTop: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginTop: 10,
        }}
      >
        <SectionAccentBar accent={accent} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
          {title}
        </h3>
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            letterSpacing: ".04em",
            marginLeft: 2,
          }}
        >
          {count} {countLabel}
        </span>
      </div>
      {actions && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
          {actions}
        </div>
      )}
    </div>
  );
}
