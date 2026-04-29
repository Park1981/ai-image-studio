/**
 * StepGrid — 6단계 카드 그리드 (edit / video 공용).
 *
 * 각 카드:
 *   - 좌측 액센트 줄 (StepAccent → 디자인 토큰 색)
 *   - index 큰 숫자 + title
 *   - simple 한 줄 + detail 본문
 *
 * 데스크톱 ≥1024px : 3열, 그 이하 : 1열.
 */

"use client";

import type { CSSProperties } from "react";
import type { FlowStep, StepAccent } from "@/lib/prompt-flow-content";

const ACCENT_BG: Record<StepAccent, string> = {
  blue: "var(--accent-soft)",
  green: "var(--green-soft)",
  amber: "var(--amber-soft)",
};

const ACCENT_INK: Record<StepAccent, string> = {
  blue: "var(--accent-ink)",
  green: "var(--green-ink)",
  amber: "var(--amber-ink)",
};

const ACCENT_LINE: Record<StepAccent, string> = {
  blue: "var(--accent)",
  green: "var(--green)",
  amber: "var(--amber)",
};

export default function StepGrid({ steps }: { steps: FlowStep[] }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 20,
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      }}
    >
      {steps.map((step, idx) => (
        <StepCard key={step.index} step={step} order={idx} />
      ))}
    </div>
  );
}

function StepCard({ step, order }: { step: FlowStep; order: number }) {
  const cardStyle: CSSProperties = {
    position: "relative",
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderLeft: `4px solid ${ACCENT_LINE[step.accent]}`,
    borderRadius: "var(--radius-card)",
    padding: "22px 22px 20px",
    boxShadow: "var(--shadow-sm)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    minHeight: 200,
    transition: "transform .2s ease, box-shadow .2s ease",
  };

  return (
    <article
      style={cardStyle}
      // 호버 시 살짝 떠오르는 인터랙션 (인라인 :hover 대체)
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "var(--shadow-md)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "var(--shadow-sm)";
      }}
      data-step-order={order}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 38,
            height: 28,
            padding: "0 10px",
            borderRadius: "var(--radius-full)",
            background: ACCENT_BG[step.accent],
            color: ACCENT_INK[step.accent],
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: ".08em",
            fontFamily: "Consolas, SFMono-Regular, monospace",
          }}
        >
          {step.index}
        </div>
        <h3
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 700,
            color: "var(--ink)",
            lineHeight: 1.3,
            letterSpacing: 0,
          }}
        >
          {step.title}
        </h3>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: ACCENT_INK[step.accent],
          fontWeight: 600,
          lineHeight: 1.5,
          letterSpacing: 0,
        }}
      >
        {step.simple}
      </p>

      <p
        style={{
          margin: 0,
          fontSize: 12.5,
          color: "var(--ink-3)",
          lineHeight: 1.62,
          letterSpacing: 0,
        }}
      >
        {step.detail}
      </p>
    </article>
  );
}
