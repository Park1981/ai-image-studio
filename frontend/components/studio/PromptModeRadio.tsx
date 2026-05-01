/**
 * PromptModeRadio - gemma4 보강 모드 선택 (segmented control).
 *
 * Phase 2 (2026-05-01) 신설 → 후속 (2026-05-01) 재디자인:
 *  옛: 좌측 라벨 + sub-text + 우측 작은 토글 (ais-toggle-row 패턴)
 *  신: 가로 50/50 segmented control — AI 보정 카드 *안에 inline* 으로 들어감.
 *
 * 라벨 = `instant` / `thinking` (영문 · Ollama API field 와 1:1 매핑).
 *  - instant = think:false / num_predict 800 / 5~15초
 *  - thinking = think:true / num_predict 4096 / 30~60초+
 *
 * 사용 컨텍스트:
 *  - {Mode}LeftPanel 의 AI 프롬프트 보정 토글 카드 *안* 에서 토글 ON 시에만 노출.
 *  - sub-text 없음 — 토글 자체 desc 가 컨텍스트 안내 + tooltip 보강.
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
  { id: "fast", label: "instant", desc: "think:false · 5~15초 · 기본" },
  { id: "precise", label: "thinking", desc: "think:true · 30~60초+ · 사고모드" },
];

function PromptModeRadioImpl({ value, onChange }: Props) {
  return (
    <div
      className="ais-prompt-mode-segmented"
      role="radiogroup"
      aria-label="AI 보정 모드"
      data-value={value}
    >
      {/* 슬라이드 thumb — active 옵션 위로 부드럽게 transform 이동.
       *  버튼들은 transparent + thumb 가 흰 pill 배경 책임. iOS segmented 패턴. */}
      <span aria-hidden className="ais-prompt-mode-thumb" />
      {OPTIONS.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active}
            title={opt.desc}
            onClick={() => onChange(opt.id)}
            className="ais-prompt-mode-seg-btn"
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const PromptModeRadio = memo(PromptModeRadioImpl);
export default PromptModeRadio;
