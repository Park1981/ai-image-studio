/**
 * V5MotionCard — V5 시그니처 카드 wrap 의 framer-motion spring 보간 (Phase 1.5.7 · 결정 ⓓ I).
 *
 * Why: V5 카드 active 변화 (padding 14 → 38 + adult-card 의 aspect-ratio 16/9) 의 CSS transition
 * 만으로는 다른 카드 밀려남이 점프. framer-motion `layout` prop 으로 형제 카드 reflow 도 spring.
 *
 * 정책 (오빠 결정 + plan v4 §1.5.7):
 *  - stiffness: 320 / damping: 26 (자연 fluid · 1초 미만)
 *  - `layout` prop 만 — children 의 layout shift 까지 자동 보간 (Codex 우려 회피).
 *  - `motion.div` 의 default `transition` 은 layout 만 override, 다른 property (opacity 등) 는
 *    그대로 두어 CSS transition 과 충돌 X.
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
import type { ReactNode } from "react";

/** 5 패널 공용 V5 카드 spring transition — layout 한정 */
const V5_SPRING_TRANSITION = {
  layout: { type: "spring" as const, stiffness: 320, damping: 26 },
};

interface Props {
  /** V5 카드 className (.ais-toggle-card .ais-sig-X 등) */
  className?: string;
  /** active 상태 (CSS [data-active="true"] selector 매칭) */
  "data-active"?: boolean | "true" | "false";
  /** 카드 내부 콘텐츠 */
  children: ReactNode;
}

export default function V5MotionCard({
  className,
  "data-active": dataActive,
  children,
}: Props) {
  // boolean → "true" / "false" 문자열 변환 (CSS [data-active="true"] selector 매칭).
  const dataActiveStr =
    typeof dataActive === "boolean"
      ? dataActive
        ? "true"
        : "false"
      : dataActive;

  return (
    <motion.div
      className={className}
      data-active={dataActiveStr}
      layout
      transition={V5_SPRING_TRANSITION}
    >
      {children}
    </motion.div>
  );
}
