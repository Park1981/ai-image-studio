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
          letterSpacing: "-0.005em",
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
}: {
  options: SegOption[];
  value: string;
  onChange: (v: string) => void;
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
        borderRadius: 8,
        gap: 2,
        flexWrap: "wrap",
      }}
    >
      {items.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className="mono"
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "4px 8px",
            fontSize: 11,
            letterSpacing: ".02em",
            borderRadius: 6,
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

/* ── Toggle ── 체크박스 스타일 토글 스위치 (고급 설정용) */
export function Toggle({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: "pointer",
        padding: "8px 10px",
        borderRadius: 8,
        background: checked ? "var(--accent-soft)" : "var(--bg-2)",
        border: `1px solid ${checked ? "rgba(74,158,255,.35)" : "var(--line)"}`,
        transition: "all .15s",
      }}
    >
      <span
        style={{
          position: "relative",
          width: 28,
          height: 16,
          borderRadius: 999,
          background: checked ? "var(--accent)" : "var(--line-2)",
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
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        // display:none = layout flow 에서 완전 제거 (position:absolute 부유 이슈 방지)
        style={{ display: "none" }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-2)" }}>
          {label}
        </span>
        {desc && (
          <span style={{ fontSize: 10.5, color: "var(--ink-4)" }}>{desc}</span>
        )}
      </span>
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
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        width: "100%",
        accentColor: "var(--accent)",
        background: `linear-gradient(to right, var(--accent) ${pct}%, var(--line) ${pct}%)`,
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
        borderRadius: 6,
        background: "var(--bg)",
        flex: 1,
        justifyContent: "center",
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
  borderRadius: 8,
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
  borderRadius: 8,
  border: "1px solid var(--line)",
  background: "var(--bg)",
  color: "var(--ink-2)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
};
