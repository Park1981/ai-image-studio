/**
 * ToggleRow — 설정 드로어 공용 토글 카드 (2026-05-14 통일 시안).
 *
 * 의도:
 *  - 프롬프트 숨기기 (boolean) · AI 보정 모드 (2-choice) · 향후 segmented-3+
 *    모두 같은 카드 wrapper 공유. 우측 control 만 variant 분기.
 *  - 옛 SettingsDrawer 의 raw div 인라인 style ad-hoc 카드 + primitives.tsx 의
 *    Toggle 컴포넌트가 토큰이 어긋났던 회귀 해소.
 *  - segmented 버튼은 한글 글자 자모 break (예: "빠/른") 회귀 차단 — global css 의
 *    .ais-ctl-seg-btn 이 white-space: nowrap + min-width 44 가드.
 *
 * 단일 진실원:
 *  - 카드 wrapper / marker / label / desc / control 5 슬롯
 *  - tone="accent" (기본 · blue) · "violet" 두 변종
 *  - control = discriminated union (switch | segmented)
 */

"use client";

import type { ReactNode } from "react";

type SwitchControl = {
  variant: "switch";
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
};

type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
};

type SegmentedControl<T extends string> = {
  variant: "segmented";
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (next: T) => void;
  ariaLabel?: string;
};

type Control<T extends string> = SwitchControl | SegmentedControl<T>;

interface ToggleRowProps<T extends string = string> {
  /** 좌측 32×32 marker — 이모지 / 아이콘. 옵션 (미지정 시 좌측 박스 X). */
  marker?: ReactNode;
  /** 본문 라벨 — 한글 또는 ReactNode (em 등 inline 강조 가능). */
  label: ReactNode;
  /** 라벨 아래 설명 — 옵션. */
  desc?: ReactNode;
  /** active 시 카드 톤. "accent"(파랑 · 기본) | "violet". */
  tone?: "accent" | "violet";
  /** 우측 control — discriminated union. */
  control: Control<T>;
}

/** active 판정 — switch=checked / segmented=항상 active (선택값 있음). */
function isRowActive<T extends string>(control: Control<T>): boolean {
  return control.variant === "switch" ? control.checked : true;
}

export function ToggleRow<T extends string = string>({
  marker,
  label,
  desc,
  tone = "accent",
  control,
}: ToggleRowProps<T>) {
  const active = isRowActive(control);
  const rowClass = ["ais-toggle-row", active && "is-active"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rowClass} data-tone={tone}>
      {marker !== undefined && (
        <span className="ais-toggle-row-marker" aria-hidden="true">
          {marker}
        </span>
      )}
      <div className="ais-toggle-row-labels">
        <div className="ais-toggle-row-label">{label}</div>
        {desc !== undefined && (
          <div className="ais-toggle-row-desc">{desc}</div>
        )}
      </div>
      <div className="ais-toggle-row-control">
        {control.variant === "switch" ? (
          <SwitchControlEl control={control} tone={tone} />
        ) : (
          <SegmentedControlEl control={control} tone={tone} />
        )}
      </div>
    </div>
  );
}

function SwitchControlEl({
  control,
  tone,
}: {
  control: SwitchControl;
  tone: "accent" | "violet";
}) {
  const cls = [
    "ais-ctl-switch",
    control.checked && "is-on",
    tone === "violet" && "tone-violet",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      role="switch"
      aria-checked={control.checked}
      aria-label={control.ariaLabel}
      className={cls}
      onClick={() => control.onChange(!control.checked)}
    />
  );
}

function SegmentedControlEl<T extends string>({
  control,
  tone,
}: {
  control: SegmentedControl<T>;
  tone: "accent" | "violet";
}) {
  const cls = ["ais-ctl-seg", tone === "violet" && "tone-violet"]
    .filter(Boolean)
    .join(" ");
  return (
    <div role="radiogroup" aria-label={control.ariaLabel} className={cls}>
      {control.options.map((opt) => {
        const isActive = control.value === opt.value;
        const btnCls = ["ais-ctl-seg-btn", isActive && "is-active"]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            className={btnCls}
            onClick={() => control.onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
