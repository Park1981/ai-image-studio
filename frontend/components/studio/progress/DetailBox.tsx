/**
 * DetailBox — 진행 모달 timeline row 아래 보조 정보 박스
 * (비전 설명 · 최종 프롬프트 · 한국어 번역 등).
 *
 * 2026-04-27 (Phase 1): progress/Timelines.tsx 에서 추출 — PipelineTimeline 의
 * StageDef.renderDetail 콜백 안에서도 직접 사용.
 */

"use client";

import type { ReactNode } from "react";

export interface DetailBoxProps {
  /** 시각 톤 — info: 일반 / warn: fallback 등 주의 / muted: 보조 (번역 등) */
  kind: "info" | "warn" | "muted";
  /** 박스 상단 라벨 (대문자 + letter-spacing 적용됨) */
  title: string;
  /** 박스 본문 — 보통 문자열, 줄바꿈 보존됨 */
  children: ReactNode;
}

export function DetailBox({ kind, title, children }: DetailBoxProps) {
  const bg =
    kind === "warn"
      ? "var(--amber-soft)"
      : kind === "muted"
        ? "var(--surface)"
        : "var(--bg-2)";
  const border =
    kind === "warn"
      ? "rgba(250,173,20,.35)"
      : kind === "muted"
        ? "var(--line)"
        : "var(--line)";
  return (
    <div
      style={{
        marginLeft: 34,
        marginTop: 4,
        padding: "10px 12px",
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: "var(--radius-sm)",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          color: "var(--ink-3)",
          textTransform: "uppercase",
          letterSpacing: ".06em",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--ink-2)",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {children}
      </div>
    </div>
  );
}
