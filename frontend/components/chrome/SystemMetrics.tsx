/**
 * SystemMetrics — 헤더 통합 자원 사용률 4-bar UI.
 *
 * Collapsed (평상시): 색상 막대 4개만 — 각 메트릭 색상 구분
 * Expanded (hover):   살짝 튕기듯 펼쳐지며 dot · 라벨 · 사용량 · 큰 막대 · % 모두 등장
 *
 * 디자인 결정 (2026-04-26 오빠와 합의):
 *   1) Collapsed 막대만 (라벨 X) · A
 *   2) 색상 — macOS Activity Monitor 패턴 (CPU=빨강 / GPU=초록 / VRAM=보라 / RAM=파랑)
 *      — 1차 시도 쿨톤 그라데이션 ① 은 명도 차이 부족해 구분 X (사용자 피드백) → 4색 명확 구분
 *   3) 인터랙션 hover-only · A (lock 없음)
 *   4) 애니메이션 살짝 튕기듯 (cubic-bezier overshoot) · B
 *
 * 메트릭 별 표시:
 *   CPU/GPU — % 만 (사용률 자체가 단위)
 *   VRAM/RAM — 사용량(GB) + bar + %
 *
 * 누락 정책: 어느 메트릭이든 store 에서 null → 해당 메트릭 자체 미렌더.
 *
 * 트랜지션: globals.css 의 `.ais-metrics` 클래스 토글 패턴 — inline style 의
 *   transition 불안정 회피 (사용자 1차 피드백 "딱딱하게 온오프" 해결).
 */

"use client";

import { useProcessStore } from "@/stores/useProcessStore";

/** 메트릭 별 시각 색상 — macOS Activity Monitor 매핑 (4색 명확 구분) */
const COLORS = {
  cpu: "#EF4444", // 빨강 (Tailwind red-500)
  gpu: "#22C55E", // 초록 (NVIDIA 그린, Tailwind green-500)
  vram: "#A855F7", // 보라 (Tailwind purple-500)
  ram: "#4A9EFF", // 파랑 (현 accent · 시스템 메모리)
} as const;
type MetricKey = keyof typeof COLORS;

/** 사용률 임계 — 75% 이상 amber 톤 섞임 */
const HIGH_THRESHOLD = 75;

interface MetricItem {
  key: MetricKey;
  label: string;
  /** 0-100 사용률 */
  percent: number;
  /** 사용량 표기 — VRAM/RAM 만 정의됨, CPU/GPU 는 undefined.
   *  used 굵게 / total 옅게 시각 위계 (예: 78.1 / 96G). */
  usage?: { used: string; total: string };
}

export default function SystemMetrics() {
  const cpu = useProcessStore((s) => s.cpuPercent);
  const gpu = useProcessStore((s) => s.gpuPercent);
  const vram = useProcessStore((s) => s.vram);
  const ram = useProcessStore((s) => s.ram);

  // 메트릭 컴파일 — 데이터 있는 것만, 누락 메트릭은 자동 스킵
  const metrics: MetricItem[] = [];
  if (cpu !== null) {
    metrics.push({ key: "cpu", label: "CPU", percent: clamp(cpu) });
  }
  if (gpu !== null) {
    metrics.push({ key: "gpu", label: "GPU", percent: clamp(gpu) });
  }
  if (vram !== null && vram.totalGb > 0) {
    metrics.push({
      key: "vram",
      label: "VRAM",
      percent: clamp((vram.usedGb / vram.totalGb) * 100),
      usage: {
        used: vram.usedGb.toFixed(1),
        total: `${Math.round(vram.totalGb)}G`,
      },
    });
  }
  if (ram !== null && ram.totalGb > 0) {
    metrics.push({
      key: "ram",
      label: "RAM",
      percent: clamp((ram.usedGb / ram.totalGb) * 100),
      usage: {
        used: ram.usedGb.toFixed(1),
        total: `${Math.round(ram.totalGb)}G`,
      },
    });
  }

  if (metrics.length === 0) return null;

  return (
    <div
      className="ais-metrics"
      role="group"
      aria-label="시스템 자원 사용률"
    >
      {metrics.map((m) => (
        <MetricCell key={m.key} metric={m} />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────
   단일 메트릭 셀 — class 토글 (transition 은 globals.css 가 담당)
   ───────────────────────────────────────── */
function MetricCell({ metric }: { metric: MetricItem }) {
  const color = COLORS[metric.key];
  const high = metric.percent >= HIGH_THRESHOLD;
  // 막대 색상은 메트릭 색 그대로 유지 (정체성 보존).
  //   1차 시도: high 시 amber 와 oklab mix → 파랑(#4A9EFF) + amber 가 회색으로 변하는 결함 발견.
  //   현재: 임계 시각화는 % 텍스트 색상(amber-ink)으로만 표현 — 막대는 메트릭 컬러 유지.
  const fillColor = color;

  const tooltip = metric.usage
    ? `${metric.label} ${metric.usage.used} / ${metric.usage.total} · ${Math.round(metric.percent)}%`
    : `${metric.label} ${Math.round(metric.percent)}%`;

  return (
    <div className="ais-metric-cell" title={tooltip}>
      {/* dot — expanded 일 때만 나타남 (색상 시각 단서) */}
      <span
        aria-hidden
        className="ais-dot"
        style={{ background: color }}
      />

      {/* 라벨 (CPU/GPU/VRAM/RAM) */}
      <span
        className="ais-slide ais-label"
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          color: "var(--ink-3)",
          letterSpacing: ".05em",
        }}
      >
        {metric.label}
      </span>

      {/* 사용량 — VRAM/RAM 만 (CPU/GPU 는 % 자체가 단위)
          시각 위계: used 굵게 강조 / total 옅게 컨텍스트 ("78.1 / 96G") */}
      {metric.usage && (
        <span
          className="ais-slide ais-usage mono"
          style={{
            fontSize: 11,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span style={{ color: "var(--ink)", fontWeight: 600 }}>
            {metric.usage.used}
          </span>
          <span style={{ color: "var(--ink-4)", fontWeight: 500, marginLeft: 1 }}>
            /{metric.usage.total}
          </span>
        </span>
      )}

      {/* bar — 막대 fill 색상은 메트릭 별 다름 */}
      <div className="ais-bar">
        <div
          className="ais-bar-fill"
          style={{
            width: `${metric.percent}%`,
            background: fillColor,
          }}
        />
      </div>

      {/* 퍼센트 — expanded 일 때만 */}
      <span
        className="ais-slide ais-percent mono"
        style={{
          fontSize: 10.5,
          color: high ? "var(--amber-ink)" : "var(--ink-4)",
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
        }}
      >
        {Math.round(metric.percent)}%
      </span>
    </div>
  );
}

/** 0~100 안전 clamp */
function clamp(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
