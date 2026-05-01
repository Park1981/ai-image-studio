/**
 * SplitIcon - 프롬프트 분리 도구 SVG 아이콘.
 *
 * Phase 5 후속 (2026-05-01) — wireframe mockup 패턴 (3 줄 길이 다름).
 * '카드로 나뉜 layout' 의미를 추상적으로 표현. currentColor + opacity 0.7 → 다크/라이트 호환.
 */

"use client";

interface Props {
  size?: number;
  /** ARIA 라벨 — 기본은 컨텍스트 (PromptToolsButtons) 가 title 로 처리 */
  ariaLabel?: string;
}

export default function SplitIcon({ size = 16, ariaLabel }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      style={{ opacity: 0.75 }}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      role={ariaLabel ? "img" : undefined}
    >
      {/* 3 줄 길이 다르게 — wireframe 카드 분리 느낌 */}
      <line x1="5" y1="7" x2="19" y2="7" />
      <line x1="5" y1="12" x2="13" y2="12" />
      <line x1="5" y1="17" x2="17" y2="17" />
    </svg>
  );
}
