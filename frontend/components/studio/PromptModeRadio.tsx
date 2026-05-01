/**
 * PromptModeRadio - gemma4 보강 모드 선택 라디오 (Phase 2 · 2026-05-01).
 *
 * Generate / Edit / Video LeftPanel 공용. 토글 (Lightning/AI보정) 과 다른
 * UX 패턴 — 두 옵션의 의미가 대칭적이라 라디오로 표현 (ON/OFF 가 아님).
 *
 * 라벨:
 *  - 빠른    · think:false / 5~15초
 *  - 정밀    · think:true  / 30~60초+
 *
 * desc 는 카드 안 작은 텍스트로 사용 (Toggle 의 desc prop 패턴 참고).
 */

"use client";

import { memo } from "react";

type Mode = "fast" | "precise";

interface Props {
  value: Mode;
  onChange: (mode: Mode) => void;
}

const OPTIONS: ReadonlyArray<{
  id: Mode;
  label: string;
  desc: string;
}> = [
  { id: "fast", label: "빠른", desc: "5~15초 · 기본" },
  { id: "precise", label: "정밀", desc: "30~60초+ · 사고모드" },
];

function PromptModeRadioImpl({ value, onChange }: Props) {
  return (
    <div
      className="ais-toggle-row"
      style={{
        // Toggle 의 행 패턴 그대로 재사용 — 좌측 라벨 / 우측 컨트롤.
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        borderRadius: 8,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        gap: 12,
      }}
      role="radiogroup"
      aria-label="AI 보정 모드"
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
          🧠 보정 모드
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--ink-3)",
            marginTop: 2,
          }}
        >
          {value === "precise"
            ? "정밀 · gemma4 사고모드 (오래 걸릴 수 있음)"
            : "빠른 · 기본 보강 (속도 우선)"}
        </div>
      </div>

      <div
        style={{
          display: "inline-flex",
          gap: 2,
          padding: 2,
          borderRadius: 6,
          background: "var(--line)",
        }}
      >
        {OPTIONS.map((opt) => {
          const active = opt.id === value;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={opt.desc}
              onClick={() => onChange(opt.id)}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 4,
                border: "none",
                cursor: "pointer",
                color: active ? "var(--accent-ink)" : "var(--ink-3)",
                background: active ? "var(--surface)" : "transparent",
                boxShadow: active ? "0 1px 3px rgba(0,0,0,.08)" : "none",
                transition: "background 120ms, color 120ms",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const PromptModeRadio = memo(PromptModeRadioImpl);
export default PromptModeRadio;
