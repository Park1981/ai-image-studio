/**
 * TimelineRow — 진행 모달 timeline 의 단일 row (bullet + label + elapsed).
 *
 * 2026-04-27 (Phase 1): 추출. post-Phase-6 cleanup 후 PipelineTimeline 단일 사용.
 */

"use client";

import Icon from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/primitives";

export interface TimelineRowProps {
  /** 1-based 순번 (pending 상태에서 표시) */
  n: number;
  /** stage/step 이름 */
  label: string;
  /** 모델·엔진 보조 라벨 (선택, mono 작은 글씨로 표시) */
  subLabel?: string;
  /** 진행 상태 */
  state: "pending" | "running" | "done" | "error";
  /** 소요 시간 문자열 (예: "12.4") — null 이면 표시 안 함 */
  elapsed: string | null;
}

export function TimelineRow({ n, label, subLabel, state, elapsed }: TimelineRowProps) {
  const bulletStyle = {
    width: 22,
    height: 22,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    border:
      state === "done"
        ? "1.5px solid var(--green)"
        : state === "running"
          ? "1.5px solid var(--accent)"
          : "1.5px solid var(--line-2)",
    background:
      state === "done"
        ? "var(--green)"
        : state === "running"
          ? "#fff"
          : "#fff",
    color: "#fff",
  } as const;

  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "6px 0",
      }}
    >
      <span style={bulletStyle}>
        {state === "done" ? (
          <Icon name="check" size={12} stroke={2.5} />
        ) : state === "running" ? (
          <Spinner size={10} color="var(--accent)" />
        ) : (
          <span
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              fontWeight: 600,
            }}
          >
            {n}
          </span>
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: state === "pending" ? "var(--ink-4)" : "var(--ink)",
            display: "flex",
            alignItems: "baseline",
            gap: 8,
          }}
        >
          {label}
          {subLabel && (
            <span
              className="mono"
              style={{
                fontSize: 10.5,
                color: "var(--ink-4)",
                letterSpacing: ".04em",
              }}
            >
              {subLabel}
            </span>
          )}
        </div>
      </div>
      {elapsed && (
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            color: "var(--ink-3)",
            letterSpacing: ".04em",
          }}
        >
          {elapsed}s
        </span>
      )}
      {state === "running" && (
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--accent)",
            letterSpacing: ".04em",
            animation: "pulse 1.4s ease-in-out infinite",
          }}
        >
          RUNNING
        </span>
      )}
    </li>
  );
}
