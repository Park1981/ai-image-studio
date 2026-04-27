/**
 * StudioResultHeader — 4 페이지 우측 결과 영역 상단 헤더 공통화 (audit R2-1).
 *
 * 2026-04-27: accent vertical bar 추가 (오빠 피드백 — 텍스트 앞 시각 마커).
 *  카테고리 색상 코딩: input=blue · output=violet · archive=neutral
 *  (SectionAccentBar 헬퍼 export — HistorySectionHeader / GenerateLeftPanel 공용)
 */

"use client";

import type { ReactNode } from "react";

export type SectionAccent = "blue" | "violet" | "neutral";

const ACCENT_COLOR: Record<SectionAccent, string> = {
  blue: "var(--accent)", // 입력 (프롬프트)
  violet: "#A78BFA", // 출력 (생성/수정 결과 · 1차 시안 인라인 · OK 시 토큰화)
  neutral: "var(--line-2)", // 보관 (히스토리)
};

/** 섹션 제목 좌측 vertical color bar — 3×14px · 둥근 모서리. */
export function SectionAccentBar({ accent }: { accent: SectionAccent }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 3,
        height: 14,
        borderRadius: 2,
        background: ACCENT_COLOR[accent],
        flexShrink: 0,
        // baseline 정렬 보정 — h3 의 descender 와 맞춤
        transform: "translateY(2px)",
      }}
    />
  );
}

export default function StudioResultHeader({
  title,
  meta,
  actions,
  accent = "violet",
}: {
  title: string;
  meta?: ReactNode;
  /** 우측 mono meta 뒤에 붙는 선택적 액션 슬롯 (SmallBtn, IconBtn 등) */
  actions?: ReactNode;
  /** 좌측 accent bar 색 (기본 violet · 결과 출력 톤) */
  accent?: SectionAccent;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <SectionAccentBar accent={accent} />
        <h3
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {title}
        </h3>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        {meta != null && (
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              letterSpacing: ".04em",
            }}
          >
            {meta}
          </span>
        )}
        {actions}
      </div>
    </div>
  );
}
