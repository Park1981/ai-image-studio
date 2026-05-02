/**
 * V5MotionCard — V5 시그니처 카드 wrap 의 framer-motion spring 보간 (Phase 1.5.7 · 결정 ⓓ I).
 *
 * Why: V5 카드 active 변화 (padding 14 → 38 + adult-card 의 aspect-ratio 16/9) 의 CSS transition
 * 만으로는 다른 카드 밀려남이 점프. framer-motion `layout` prop 으로 형제 카드 reflow 도 spring.
 *
 * 정책 (오빠 결정 + plan v4 §1.5.7 + Codex 2차 fix):
 *  - **outer (motion.div)** = layout spring 만 — children size 변화에 형제 reflow 보간
 *  - **inner (.ais-toggle-card 등)** = V5 시각 + :hover transform translateY/scale (CSS)
 *  - 두 transform 이 **다른 element** 에 적용 → race 없음 (Codex 2차 우려 해소)
 *  - stiffness: 320 / damping: 26 (자연 fluid · 1초 미만)
 *
 * Usage:
 *   <V5MotionCard className="ais-toggle-card ais-sig-ai" data-active={active}>
 *     <Toggle flat ... />
 *   </V5MotionCard>
 *
 * Note: framer-motion ^12.38.0 이미 설치 (package.json:17 · plan v4 §Phase 0 검증 끝).
 */

"use client";

import { motion } from "framer-motion";
import type { KeyboardEvent, ReactNode } from "react";

/** 5 패널 공용 V5 카드 spring transition — layout 한정 */
const V5_SPRING_TRANSITION = {
  layout: { type: "spring" as const, stiffness: 320, damping: 26 },
};

interface Props {
  /** V5 카드 className (.ais-toggle-card .ais-sig-X 등) — *inner* div 에 적용 */
  className?: string;
  /** active 상태 (CSS [data-active="true"] selector 매칭) — *inner* div 에 적용 */
  "data-active"?: boolean | "true" | "false";
  /** 카드 자체가 토글 역할 (시안 v7 결정 #2). 안 Toggle 의 input 은 flat 모드로 제거됨.
   *  segmented (PromptModeRadio) 등 자식 click 은 e.stopPropagation 으로 차단해야 함. */
  onClick?: () => void;
  /** Hover 툴팁 텍스트 — CSS `[data-tooltip]:hover::after` 로 검정 박스 표시 (2026-05-02). */
  tooltip?: string;
  /** 카드 내부 콘텐츠 */
  children: ReactNode;
}

export default function V5MotionCard({
  className,
  "data-active": dataActive,
  onClick,
  tooltip,
  children,
}: Props) {
  // boolean → "true" / "false" 문자열 변환 (CSS [data-active="true"] selector 매칭).
  const dataActiveStr =
    typeof dataActive === "boolean"
      ? dataActive
        ? "true"
        : "false"
      : dataActive;

  // 카드 자체 click 핸들러 (시안 v7 결정 #2 — Toggle 작은 스위치 제거 + 카드 클릭 = 토글).
  // 키보드: Enter / Space 도 동일 동작 + role="button" + aria-pressed 로 접근성 보장.
  const interactiveProps = onClick
    ? {
        onClick,
        role: "button" as const,
        tabIndex: 0,
        "aria-pressed":
          typeof dataActive === "boolean"
            ? dataActive
            : dataActive === "true",
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        },
        style: { cursor: "pointer" as const },
      }
    : undefined;

  return (
    // outer: framer-motion layout (transform 사용 — 형제 reflow 보간)
    <motion.div layout transition={V5_SPRING_TRANSITION}>
      {/* inner: V5 시각 + :hover transform (CSS) — outer/inner 분리로 transform race 회피 */}
      <div
        className={className}
        data-active={dataActiveStr}
        data-tooltip={tooltip}
        {...interactiveProps}
      >
        {children}
      </div>
    </motion.div>
  );
}
