/**
 * Badge — 작은 chip 스타일 배지 (Phase 5 · 2026-05-03 신설).
 *
 * 용도: HistoryGallery 의 video mode modelId 표시 (Wan 22 = violet / LTX = cyan).
 * 향후 다른 메타 (status / tag) 표시에도 재사용.
 *
 * tone 매핑 (spec §5.7):
 *  - violet: Wan 2.2 i2v (신규 추천 모델)
 *  - cyan: LTX Video 2.3 (기존 모델 · 옛 row fallback)
 *  - neutral: 그 외 일반 메타
 */

"use client";

import type { CSSProperties, ReactNode } from "react";

export type BadgeTone = "violet" | "cyan" | "neutral";

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  /** 마우스 hover 시 툴팁 (모델 풀네임 + 스펙 등) */
  title?: string;
  /** 외부 위치 조정용 (예: position:absolute 컨테이너 안 배치) */
  style?: CSSProperties;
}

const TONE_STYLES: Record<BadgeTone, CSSProperties> = {
  violet: {
    background: "rgba(139, 92, 246, 0.15)",
    color: "#a78bfa",
    border: "1px solid rgba(139, 92, 246, 0.35)",
  },
  cyan: {
    background: "rgba(34, 211, 238, 0.15)",
    color: "#67e8f9",
    border: "1px solid rgba(34, 211, 238, 0.35)",
  },
  neutral: {
    background: "rgba(148, 163, 184, 0.15)",
    color: "#cbd5e1",
    border: "1px solid rgba(148, 163, 184, 0.3)",
  },
};

export default function Badge({
  tone = "neutral",
  children,
  title,
  style,
}: BadgeProps) {
  return (
    <span
      title={title}
      className="ais-badge"
      data-tone={tone}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        backdropFilter: "blur(4px)",
        ...TONE_STYLES[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
