/**
 * UI Primitives - 작은 재사용 컴포넌트 모음
 * Pill, Field, SegControl, Range, Meta, SmallBtn, Spinner, StepMark
 */

"use client";

import type { CSSProperties, ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

/* ── Pill ── 작은 태그/뱃지 */
export function Pill({
  children,
  mini = false,
}: {
  children: ReactNode;
  mini?: boolean;
}) {
  return (
    <span
      className="mono"
      style={{
        fontSize: mini ? 10 : 11,
        padding: mini ? "1px 6px" : "2px 8px",
        border: "1px solid var(--line)",
        borderRadius: 4,
        color: "var(--ink-3)",
        background: "var(--bg)",
        letterSpacing: ".02em",
      }}
    >
      {children}
    </span>
  );
}

/* ── Field ── label + 입력 래퍼 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        style={{
          fontSize: 11,
          color: "var(--ink-3)",
          fontWeight: 500,
          letterSpacing: 0,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/* ── SegControl ── 세그먼트 셀렉터 (사이즈 등)
   options 는 string[] 또는 {label, value}[] 둘 다 허용. */
export type SegOption = string | { label: string; value: string };
export function SegControl({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: SegOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const items = options.map((o) =>
    typeof o === "string" ? { label: o, value: o } : o,
  );
  return (
    <div
      style={{
        display: "inline-flex",
        padding: 2,
        background: "var(--bg-2)",
        borderRadius: "var(--radius-sm)",
        gap: 2,
        flexWrap: "wrap",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {items.map((o) => (
        <button
          key={o.value}
          disabled={disabled}
          onClick={() => {
            if (!disabled) onChange(o.value);
          }}
          className="mono"
          style={{
            all: "unset",
            cursor: disabled ? "not-allowed" : "pointer",
            padding: "4px 8px",
            fontSize: 11,
            letterSpacing: ".02em",
            borderRadius: "var(--radius-sm)",
            background: o.value === value ? "var(--surface)" : "transparent",
            color: o.value === value ? "var(--ink)" : "var(--ink-3)",
            boxShadow: o.value === value ? "var(--shadow-sm)" : "none",
            transition: "all .15s",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Toggle ── 체크박스 스타일 토글 스위치 (고급 설정용)
 *  align="left" (기본): 좌측 토글 + 우측 라벨 (옛 호환)
 *  align="right" (2026-04-27): 좌측 라벨 + 우측 토글 (Settings 패턴 — 디자인 통일용)
 *  tone="neutral" (기본): 파란 accent (var(--accent))
 *  tone="amber"  (2026-04-27): 앰버 톤 (Claude 조사 같은 별도 카테고리)
 */
export function Toggle({
  checked,
  onChange,
  label,
  desc,
  align = "left",
  tone = "neutral",
  disabled = false,
  flat = false,
  icon,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
  align?: "left" | "right";
  tone?: "neutral" | "amber";
  /** 2026-05-01 — 항상 ON 인데 시각적으로 표시만 필요한 케이스 (Edit AI 보정 등). */
  disabled?: boolean;
  /** 2026-05-01 — 외부 카드 안 inline 으로 들어갈 때 자체 background/border/padding 제거.
   *  외부 카드 (.ais-magic-prompt-card 등) 가 색 책임. */
  flat?: boolean;
  /** 2026-05-02 — V5 카드 안 좌측 40x40 icon-box. 시안 pair-generate.html v7 .icon-box 패턴.
   *  flat 모드에서만 의미 있음 (외부 카드 wrapper 가 active 톤 책임). */
  icon?: IconName;
}) {
  // tone 별 색깔 매핑
  const toneColors =
    tone === "amber"
      ? {
          bg: "var(--amber-soft)",
          border: "rgba(250,173,20,.35)",
          switch: "var(--amber-ink)",
        }
      : {
          bg: "var(--accent-soft)",
          border: "rgba(74,158,255,.35)",
          switch: "var(--accent)",
        };
  const toggleSwitch = (
    <span
      style={{
        position: "relative",
        width: 28,
        height: 16,
        borderRadius: "var(--radius-full)",
        background: checked ? toneColors.switch : "var(--line-2)",
        transition: "background .15s",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 14 : 2,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "#fff",
          transition: "left .15s",
          boxShadow: "0 1px 2px rgba(0,0,0,.2)",
        }}
      />
    </span>
  );
  const labelArea = (
    <span
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        // 우측 토글 정렬: 라벨 영역이 자유 확장 → 토글이 우측 끝에 붙음
        flex: align === "right" ? 1 : undefined,
        minWidth: 0,
      }}
    >
      {/* 시안 pair-generate.html v7 일치 — fontSize 12 → 12.5 (시안 .toggle-row .label-area .label). */}
      <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink-2)" }}>
        {label}
      </span>
      {desc && (
        <span style={{ fontSize: 10.5, color: "var(--ink-4)" }}>{desc}</span>
      )}
    </span>
  );
  return (
    <label
      style={{
        // 숨김 checkbox 의 absolute 기준을 토글 내부로 고정해
        // 드로어 scrollHeight 계산에 보이지 않는 overflow 가 섞이지 않게 한다.
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: disabled ? "not-allowed" : "pointer",
        padding: flat ? 0 : "8px 10px",
        borderRadius: flat ? 0 : "var(--radius-sm)",
        background: flat
          ? "transparent"
          : checked
          ? toneColors.bg
          : "var(--bg-2)",
        border: flat
          ? "none"
          : `1px solid ${checked ? toneColors.border : "var(--line)"}`,
        transition: "all .15s",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {/* visually-transparent 패턴 (2026-04-25 layout shift fix · Codex 진단).
          flat=true (V5 카드 안 inline) 시 — input + 작은 toggleSwitch 시각 모두 제거.
          카드 wrapper (V5MotionCard) 가 onClick + 시각/접근성 책임 (시안 v7 결정 #2 · 카드 자체가 토글). */}
      {!flat && (
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            if (disabled) return;
            onChange(e.target.checked);
          }}
          disabled={disabled}
          aria-label={label}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            margin: 0,
            opacity: 0,
            cursor: disabled ? "not-allowed" : "pointer",
            border: 0,
          }}
        />
      )}
      {/* V5 카드 좌측 icon-box (시안 pair-generate.html v7 .icon-box 패턴 · flat 모드 한정).
          align 무관하게 라벨 *좌측* 에 위치 — 시안 .toggle-row 구조 (icon · label · ...). */}
      {flat && icon && (
        <span className="ais-toggle-icon-box">
          <Icon name={icon} size={19} />
        </span>
      )}
      {/* align 에 따라 토글/라벨 순서 결정 — flat 시 toggleSwitch 시각도 제거. */}
      {align === "left" ? (
        <>
          {!flat && toggleSwitch}
          {labelArea}
        </>
      ) : (
        <>
          {labelArea}
          {!flat && toggleSwitch}
        </>
      )}
    </label>
  );
}

/* ── Range ── 슬라이더 */
export function Range({
  min,
  max,
  step = 1,
  value,
  onChange,
  disabled = false,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        width: "100%",
        // V5 시그니처 카드 안에선 부모 CSS 의 --ais-range-accent var 가 cascade 로 override
        // (예: .ais-size-card-v 안에선 var(--card-from) = rose). 외부 사용처는 fallback var(--accent) 유지.
        accentColor: "var(--ais-range-accent, var(--accent))",
        background: `linear-gradient(to right, var(--ais-range-accent, var(--accent)) ${pct}%, var(--line) ${pct}%)`,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    />
  );
}

/* ── Meta ── key/value 한 줄 표시 */
export function Meta({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 11.5,
        gap: 10,
      }}
    >
      <span style={{ color: "var(--ink-4)" }}>{k}</span>
      <span
        style={{
          color: "var(--ink-2)",
          fontWeight: 500,
          textAlign: "right",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {v}
      </span>
    </div>
  );
}

/* ── SmallBtn ── 작은 아이콘+텍스트 버튼 */
export function SmallBtn({
  icon,
  children,
  onClick,
}: {
  icon: IconName;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        color: "var(--ink-2)",
        padding: "5px 9px",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg)",
        flex: 1,
        justifyContent: "center",
        whiteSpace: "nowrap",
      }}
    >
      <Icon name={icon} size={11} />
      {children}
    </button>
  );
}

/* ── Spinner ── 작은 로딩 스피너 (흰색 트랙, 흰 톱) */
export function Spinner({ size = 13, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <span
      className="spin"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `2px solid rgba(255,255,255,.4)`,
        borderTopColor: color,
        display: "inline-block",
      }}
    />
  );
}

/* ── StepMark ── 파이프라인 단계 마크 (완료/진행중/대기) */
export function StepMark({ done, running }: { done: boolean; running: boolean }) {
  return (
    <span
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: running ? "#fff" : done ? "var(--green)" : "#fff",
        border: `1.5px solid ${done || running ? "var(--green)" : "var(--line-2)"}`,
        display: "grid",
        placeItems: "center",
        color: "#fff",
        flexShrink: 0,
        position: "relative",
      }}
    >
      {running ? (
        <span
          className="spin"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            border: "1.5px solid rgba(82,196,26,.3)",
            borderTopColor: "var(--green)",
          }}
        />
      ) : done ? (
        <Icon name="check" size={10} stroke={2.5} />
      ) : null}
    </span>
  );
}

/* ── 공용 style 토큰 ── */
export const inputStyle: CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  padding: "7px 10px",
  fontSize: 12,
  fontFamily: "inherit",
  background: "var(--bg)",
  color: "var(--ink)",
  outline: "none",
  width: "100%",
  flex: 1,
};

export const iconBtnStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--line)",
  background: "var(--bg)",
  color: "var(--ink-2)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
};
