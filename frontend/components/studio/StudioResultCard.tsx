/**
 * StudioResultCard — 결과 카드 shell 공통화 (audit R2-2).
 *
 * 모든 결과 영역(이미지 뷰어·Before/After·영상 플레이어·비전 텍스트·비교 패널)
 * 의 **컨테이너 스타일** 을 통일. 내부 컨텐츠는 children slot.
 *
 * Variant:
 *   - media: 이미지/영상 뷰어 · overflow hidden · padding 0 (이미지가 꽉 채움)
 *   - text: 비전 분석 결과 같은 텍스트 중심 · padding 포함
 *   - panel: Compare 패널 같은 큰 컨테이너 · radius lg (16)
 *
 * 토큰:
 *   - background: var(--surface)
 *   - border: 1px solid var(--line)
 *   - borderRadius: var(--radius-card) | var(--radius-lg) (panel)
 *   - boxShadow: var(--shadow-sm)
 */

"use client";

import type { CSSProperties, ReactNode } from "react";

type Variant = "media" | "text" | "panel";

export default function StudioResultCard({
  variant = "media",
  children,
  style,
  onMouseEnter,
  onMouseLeave,
}: {
  variant?: Variant;
  children: ReactNode;
  /** 추가 스타일 (padding override 등). shell 기본 스타일을 덮어씀. */
  style?: CSSProperties;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const base: CSSProperties = {
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius:
      variant === "panel" ? "var(--radius-lg)" : "var(--radius-card)",
    boxShadow: "var(--shadow-sm)",
    overflow: "hidden",
    ...(variant === "text" ? { padding: 0 } : {}),
    ...(variant === "panel" ? { padding: 0 } : {}),
  };
  return (
    <div
      style={{ ...base, ...style }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  );
}
