/**
 * MetricsPopover — 4 metric (CPU/GPU/VRAM/RAM) frosted glass dropdown (V5 · Phase 2 · 결정 N).
 *
 * 시안 (`docs/design-test/pair-edit.html` v3 · v2 NEW 옵션 A) 1:1 포팅:
 *   - top: 100% + 10 / right: -80px / blur 22 saturate 180%
 *   - 4 metric rows (dot+halo · MONO 라벨 · usage · long bar · % mono)
 *   - Divider + `VRAM BREAKDOWN` (ComfyUI/Ollama + Fraunces italic 모델명)
 *
 * 노출 조건 (부모 SystemMetrics 책임):
 *   - 호버 → CSS `.ais-metrics:hover` 자동 노출
 *   - Tab 포커스 → CSS `:focus-within` 자동 노출
 *   - 수동 (data-open="true") → 키보드 활성화 패턴 보강용 (현재는 자동만 사용)
 *
 * VRAM Breakdown row 노출 조건:
 *   - VRAM ≥ 80% (HIGH_THRESHOLD) AND breakdown 데이터 존재
 *   - 옛 SystemMetrics 의 VramBreakdownOverlay 정책 그대로 (회귀 위험 0).
 *   - 0.05GB 미만 잡음은 row 자체 스킵.
 *
 * Props 의 metrics 는 부모에서 가공된 형태 — null 메트릭은 이미 필터됨.
 *
 * 회귀 위험 보존:
 *   - 옛 inline 폐기 → frosted glass dropdown 으로 이동 (시각 본체 inline 0).
 *   - VRAM 80% breakdown 노출 정책 그대로.
 *   - aria-* 속성으로 a11y 보강 (id 연동은 SystemMetrics 가 책임).
 */

"use client";

import type { CSSProperties } from "react";
import type { VramBreakdown } from "@/lib/api/types";

/** 메트릭 시각 색상 — 옛 SystemMetrics 의 COLORS 와 1:1 동일 (회귀 0). */
export const METRIC_COLORS = {
  cpu: "#06B6D4",
  gpu: "#22C55E",
  vram: "#A855F7",
  ram: "#4A9EFF",
} as const;
export type MetricKey = keyof typeof METRIC_COLORS;

/** VRAM 임계 — 80% 이상에서 breakdown row 노출 (옛 정책 보존). */
export const HIGH_THRESHOLD = 80;
/** 90% 이상 막대 끝쪽 빨강 — 임계 신호 (옛 SystemMetrics 정책 보존). */
export const DANGER_THRESHOLD = 90;
const DANGER_COLOR = "#DC2626";
const WARN_COLOR = "#F59E0B";

export interface MetricItem {
  key: MetricKey;
  label: string;
  /** 0-100 사용률 */
  percent: number;
  /** 사용량 표기 — VRAM/RAM 만 정의 (예: "78.1 / 96G") */
  usage?: { used: string; total: string };
}

interface MetricsPopoverProps {
  /** 부모에서 컴파일된 metric 배열 (null 필터 끝) */
  metrics: MetricItem[];
  /** VRAM 임계 시 노출할 breakdown — 부모가 조건 판정 후 전달 (null 이면 row 미노출) */
  breakdown: VramBreakdown | null;
  /** popover DOM id — `aria-controls` 용 (부모의 aria-expanded 와 페어) */
  id?: string;
}

export default function MetricsPopover({
  metrics,
  breakdown,
  id,
}: MetricsPopoverProps) {
  return (
    <div
      id={id}
      className="ais-ah-metrics-popover"
      role="status"
      aria-label="시스템 자원 상세"
    >
      {metrics.map((m) => (
        <MetricRow key={m.key} metric={m} />
      ))}
      {breakdown && <BreakdownSection data={breakdown} />}
    </div>
  );
}

/* ─────────────────────────────────────────
   MetricRow — 4 메트릭 단일 row (dot + 라벨 + usage + bar + %)
   ───────────────────────────────────────── */
function MetricRow({ metric }: { metric: MetricItem }) {
  const baseColor = METRIC_COLORS[metric.key];
  // 막대 fill 색 — 옛 정책: 0-80 solid / 80-90 amber tail / 90+ red tail
  const fillBackground =
    metric.percent >= DANGER_THRESHOLD
      ? `linear-gradient(90deg, ${baseColor} 0%, ${baseColor} 50%, ${WARN_COLOR} 75%, ${DANGER_COLOR} 100%)`
      : metric.percent >= HIGH_THRESHOLD
        ? `linear-gradient(90deg, ${baseColor} 0%, ${baseColor} 60%, ${WARN_COLOR} 100%)`
        : baseColor;

  // 동적 fill width 만 inline (V5 정책 동적 계산 허용 · 시각 본체는 className)
  const fillStyle: CSSProperties = {
    width: `${metric.percent}%`,
    background: fillBackground,
  };

  return (
    <div className="ais-ah-mp-row" data-tone={metric.key}>
      <span aria-hidden className="ais-ah-mp-dot" />
      <span className="ais-ah-mp-label">{metric.label}</span>
      <span className="ais-ah-mp-usage">
        {metric.usage ? `${metric.usage.used} / ${metric.usage.total}` : ""}
      </span>
      <div className="ais-ah-mp-bar">
        <div className="ais-ah-mp-fill" style={fillStyle} />
      </div>
      <span className="ais-ah-mp-percent">{Math.round(metric.percent)}%</span>
    </div>
  );
}

/* ─────────────────────────────────────────
   BreakdownSection — VRAM 점유 내역 (ComfyUI / Ollama)
   ───────────────────────────────────────── */
function BreakdownSection({ data }: { data: VramBreakdown }) {
  const { comfyui, ollama, otherGb } = data;

  // 0.05GB 미만 잡음 row 스킵 — 옛 정책 보존
  const showComfyui = comfyui.vramGb >= 0.05;
  const visibleOllamaModels = ollama.models.filter((m) => m.sizeVramGb >= 0.05);
  const showOllamaAggregate =
    visibleOllamaModels.length === 0 && ollama.vramGb >= 0.05;
  const showOther = otherGb >= 0.05;

  if (
    !showComfyui &&
    visibleOllamaModels.length === 0 &&
    !showOllamaAggregate &&
    !showOther
  ) {
    return null;
  }

  const comfyModel = comfyui.models[0];
  const comfyMode = modeLabel(comfyui.lastMode);
  const comfySub = comfyModel
    ? `${comfyModel}${comfyMode ? ` · ${comfyMode}` : ""}`
    : "(모델 정보 없음)";

  return (
    <>
      <div className="ais-ah-mp-divider" />
      <div className="ais-ah-mp-bd-eyebrow">VRAM Breakdown</div>

      {showComfyui && (
        <BreakdownRow label="ComfyUI" vramGb={comfyui.vramGb} sub={comfySub} />
      )}

      {visibleOllamaModels.length > 0
        ? visibleOllamaModels.map((m, idx) => (
            <BreakdownRow
              key={`${m.name}-${idx}`}
              label={idx === 0 ? "Ollama" : ""}
              vramGb={m.sizeVramGb}
              sub={`${m.name}${
                m.expiresInSec !== null
                  ? ` · ${formatExpiry(m.expiresInSec)}`
                  : ""
              }`}
            />
          ))
        : showOllamaAggregate && (
            <BreakdownRow
              label="Ollama"
              vramGb={ollama.vramGb}
              sub="(모델 정보 없음)"
            />
          )}

      {showOther && <BreakdownRow label="기타" vramGb={otherGb} sub="" />}
    </>
  );
}

/** 단일 BreakdownRow — name(mono) + vram(보라 mono) + 모델명(Fraunces italic) */
function BreakdownRow({
  label,
  vramGb,
  sub,
}: {
  label: string;
  vramGb: number;
  sub: string;
}) {
  return (
    <div className="ais-ah-mp-bd-row">
      <span className="ais-ah-mp-bd-name">{label}</span>
      <span className="ais-ah-mp-bd-vram">{vramGb.toFixed(1)}G</span>
      <span className="ais-ah-mp-bd-models" title={sub}>
        {sub}
      </span>
    </div>
  );
}

/** ComfyUI lastMode → 한글 라벨 (옛 SystemMetrics 정책 보존). */
function modeLabel(m?: string): string {
  if (m === "generate") return "생성";
  if (m === "edit") return "수정";
  if (m === "video") return "영상";
  return "";
}

/** Ollama keep_alive 남은 초 → 한국어 라벨. */
function formatExpiry(sec: number): string {
  if (sec <= 0) return "곧 unload";
  if (sec < 60) return `${sec}초 후 unload`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}분 후 unload`;
  return `${Math.round(m / 60)}시간 후 unload`;
}
