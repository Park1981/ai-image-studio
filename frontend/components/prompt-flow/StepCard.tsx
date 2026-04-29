/**
 * StepCard — mode 별 단계 카드 (옛 page.tsx 의 컴포넌트 그대로 분리).
 */

"use client";

import type { FlowStep } from "@/lib/prompt-flow-content";
import styles from "./prompt-flow.module.css";

export default function StepCard({ step }: { step: FlowStep }) {
  return (
    <article className={`${styles.stepCard} ${styles[step.accent]}`}>
      <div className={styles.stepIndex}>{step.index}</div>
      <div className={styles.stepCopy}>
        <h3>{step.title}</h3>
        <p className={styles.simple}>{step.simple}</p>
        <p>{step.detail}</p>
      </div>
    </article>
  );
}
