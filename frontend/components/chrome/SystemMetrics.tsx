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
 *
 * 2026-04-26 (후속): VRAM 임계(80%) 넘으면 막대 하단 오버레이로 ComfyUI/Ollama
 *   프로세스별 VRAM + 로드 모델 정보 표시 — "왜 차있지" 궁금증 해소.
 */

"use client";

import { useProcessStore } from "@/stores/useProcessStore";
import type { VramBreakdown } from "@/lib/api/types";

/** 메트릭 별 시각 색상 — 4색 명확 구분 + 위험(빨강) 영역 충돌 회피.
 *  2026-04-26 (후속): CPU 빨강 → 시안 변경. 90%+ 위험 빨강 그라데이션과 시각 충돌 회피
 *  ("CPU 임계인 줄 알았는데 그냥 평상시였음" 문제 차단). 빨/주/노 영역은 임계 신호 전용. */
const COLORS = {
  cpu: "#06B6D4", // 시안 (Tailwind cyan-500) — RAM 파랑(sky)과 청록계로 구분
  gpu: "#22C55E", // 초록 (NVIDIA 그린, Tailwind green-500)
  vram: "#A855F7", // 보라 (Tailwind purple-500)
  ram: "#4A9EFF", // 파랑 (현 accent · 시스템 메모리)
} as const;
type MetricKey = keyof typeof COLORS;

/** 사용률 임계 — 80% 이상 amber 톤 + VRAM 일 땐 breakdown 오버레이 표시 */
const HIGH_THRESHOLD = 80;
/** 90% 이상 막대 끝쪽 빨강 그라데이션 (진짜 위험 / OOM 직전) */
const DANGER_THRESHOLD = 90;
/** 위험 색 — Tailwind red-600. CPU(red-500 #EF4444) 와 충분히 구분되도록 짙게. */
const DANGER_COLOR = "#DC2626";
/** 경고 색 — amber-500. 80~90% 구간 끝쪽 톤. */
const WARN_COLOR = "#F59E0B";

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
  const breakdown = useProcessStore((s) => s.vramBreakdown);

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

  // VRAM 임계 + breakdown 둘 다 있어야 오버레이 표시
  const vramMetric = metrics.find((m) => m.key === "vram");
  const showOverlay =
    !!vramMetric && vramMetric.percent >= HIGH_THRESHOLD && !!breakdown;

  return (
    <div
      className="ais-metrics"
      role="group"
      aria-label="시스템 자원 사용률"
      // UI P0-5: keyboard focus 시에도 펼쳐지게. globals.css 의 :focus-within 분기와 한쌍.
      tabIndex={0}
    >
      {metrics.map((m) => (
        <MetricCell
          key={m.key}
          metric={m}
          overlay={showOverlay && m.key === "vram" ? breakdown : null}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────
   단일 메트릭 셀 — class 토글 (transition 은 globals.css 가 담당)
   ───────────────────────────────────────── */
function MetricCell({
  metric,
  overlay,
}: {
  metric: MetricItem;
  overlay: VramBreakdown | null;
}) {
  const color = COLORS[metric.key];
  const high = metric.percent >= HIGH_THRESHOLD;
  // 막대 색상 정책 (2026-04-26 후속, 사용자 제안 A안):
  //   0-80%   solid 고유색 (정체성 보존)
  //   80-90%  끝쪽 amber 톤 (linear-gradient · 경고)
  //   90+     끝쪽 빨강 그라데이션 (진짜 위험 — OOM 직전)
  // 그라데이션 stops 는 fill 의 width(=percent%) 안에서 매핑되므로 끝부분만 강조됨.
  // 1차 시도(2026-04-26) high 시 oklab mix 결함(파랑+amber→회색) 회피: 그라데이션은
  // 메트릭 색을 출발점으로 유지해 정체성 그대로 + 끝쪽만 위험 색.
  const fillBackground =
    metric.percent >= DANGER_THRESHOLD
      ? `linear-gradient(90deg, ${color} 0%, ${color} 50%, ${WARN_COLOR} 75%, ${DANGER_COLOR} 100%)`
      : metric.percent >= HIGH_THRESHOLD
        ? `linear-gradient(90deg, ${color} 0%, ${color} 60%, ${WARN_COLOR} 100%)`
        : color;

  const tooltip = metric.usage
    ? `${metric.label} ${metric.usage.used} / ${metric.usage.total} · ${Math.round(metric.percent)}%`
    : `${metric.label} ${Math.round(metric.percent)}%`;

  // VRAM 임계 시 cell 자체에 relative — 오버레이 absolute 앵커
  const cellStyle = overlay ? { position: "relative" as const } : undefined;

  return (
    <div className="ais-metric-cell" title={tooltip} style={cellStyle}>
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

      {/* bar — 막대 fill: 0-80% solid 고유색 / 80-90% amber / 90+ 빨강 그라데이션 */}
      <div className="ais-bar">
        <div
          className="ais-bar-fill"
          style={{
            width: `${metric.percent}%`,
            background: fillBackground,
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

      {/* VRAM 임계 (80%) 오버레이 — cell 아래로 fade-in */}
      {overlay && <VramBreakdownOverlay data={overlay} />}
    </div>
  );
}

/** 0~100 안전 clamp */
function clamp(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/* ─────────────────────────────────────────
   VRAM Breakdown 오버레이 — VRAM 막대 하단에 absolute 로 fade-in
   80% 넘을 때만 떠서 "왜 VRAM 차있지" 즉답 (ComfyUI 모델 + Ollama 모델 + 기타).
   ───────────────────────────────────────── */
function VramBreakdownOverlay({ data }: { data: VramBreakdown }) {
  const { comfyui, ollama, otherGb } = data;

  // 모드 라벨 한글화 — 사용자 노출 텍스트 톤 일치
  const modeLabel = (m?: string): string => {
    if (m === "generate") return "생성";
    if (m === "edit") return "수정";
    if (m === "video") return "영상";
    return "";
  };

  const comfyModel = comfyui.models[0];
  const comfyMode = modeLabel(comfyui.lastMode);

  // 0.0G 인 항목은 row 자체 숨김 — 노이즈 제거 (사용자 요청 2026-04-26)
  // 임계값 0.05GB = 약 50MiB 미만은 측정 잡음으로 간주
  const showComfyui = comfyui.vramGb >= 0.05;
  const visibleOllamaModels = ollama.models.filter((m) => m.sizeVramGb >= 0.05);
  // Ollama 전체 vram 은 있는데 모델 정보 누락된 케이스도 표시 (오류 의심)
  const showOllamaAggregate =
    visibleOllamaModels.length === 0 && ollama.vramGb >= 0.05;
  const showOther = otherGb >= 0.05;

  // 표시할 row 가 하나도 없으면 오버레이 자체 안 그림
  if (
    !showComfyui &&
    visibleOllamaModels.length === 0 &&
    !showOllamaAggregate &&
    !showOther
  ) {
    return null;
  }

  return (
    <div
      role="status"
      className="ais-vram-overlay"
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        right: 0,
        zIndex: 30,
        minWidth: 240,
        maxWidth: 320,
        padding: "10px 12px",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        boxShadow:
          "0 8px 28px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.10)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        whiteSpace: "nowrap",
        animation: "fade-in .18s var(--ais-ease-out-back, ease-out)",
      }}
    >
      {/* 헤더 — "VRAM 점유 내역" 작은 캡션 */}
      <div
        style={{
          fontSize: 9.5,
          letterSpacing: ".08em",
          color: "var(--ink-4)",
          textTransform: "uppercase",
          fontWeight: 600,
          marginBottom: 2,
        }}
      >
        VRAM 점유 내역
      </div>

      {/* ComfyUI 줄 — vram > 0 일 때만 */}
      {showComfyui && (
        <BreakdownRow
          icon="🎨"
          label="ComfyUI"
          vramGb={comfyui.vramGb}
          sub={
            comfyModel
              ? `${comfyModel}${comfyMode ? ` · ${comfyMode}` : ""}`
              : "(모델 정보 없음)"
          }
        />
      )}

      {/* Ollama 줄 — 로드 모델별 1줄 */}
      {visibleOllamaModels.length > 0
        ? visibleOllamaModels.map((m, idx) => (
            <BreakdownRow
              key={`${m.name}-${idx}`}
              icon={idx === 0 ? "🦙" : ""}
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
              icon="🦙"
              label="Ollama"
              vramGb={ollama.vramGb}
              sub="(모델 정보 없음)"
            />
          )}

      {/* 기타 (브라우저 GPU 가속 등) — 단순 수치만 */}
      {showOther && (
        <BreakdownRow icon="" label="기타" vramGb={otherGb} sub="" muted />
      )}
    </div>
  );
}

function BreakdownRow({
  icon,
  label,
  vramGb,
  sub,
  muted = false,
}: {
  icon: string;
  label: string;
  vramGb: number;
  sub: string;
  muted?: boolean;
}) {
  const inkMain = muted ? "var(--ink-4)" : "var(--ink)";
  const inkSub = "var(--ink-4)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        lineHeight: 1.35,
      }}
    >
      <span style={{ width: 14, fontSize: 12, flexShrink: 0 }}>{icon}</span>
      <span
        style={{
          minWidth: 56,
          color: inkMain,
          fontWeight: muted ? 500 : 600,
        }}
      >
        {label}
      </span>
      <span
        className="mono"
        style={{
          color: inkMain,
          fontVariantNumeric: "tabular-nums",
          fontWeight: muted ? 500 : 600,
          minWidth: 44,
          textAlign: "right",
        }}
      >
        {vramGb.toFixed(1)}G
      </span>
      {sub && (
        <span
          style={{
            color: inkSub,
            fontSize: 10.5,
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 200,
          }}
          title={sub}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

/** Ollama keep_alive 남은 초 → 한국어 라벨 ("4분 후 unload" / "30초 후 unload"). */
function formatExpiry(sec: number): string {
  if (sec <= 0) return "곧 unload";
  if (sec < 60) return `${sec}초 후 unload`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}분 후 unload`;
  return `${Math.round(m / 60)}시간 후 unload`;
}
