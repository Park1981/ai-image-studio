/**
 * SystemMetricsSection — CPU/GPU/VRAM/RAM 막대 + VRAM/RAM 들여쓰기 분해.
 *
 * Phase 3.2 추출 (refactor doc 2026-04-30 §I2) — 옛 SettingsDrawer.tsx 의
 * SystemMetricsSection / MetricBar / BreakdownLines 3 함수.
 *
 * 데이터 = useProcessStore (5초 폴링 결과 재사용 — 추가 fetch 없음).
 */

"use client";

import { useProcessStore } from "@/stores/useProcessStore";
import Section from "./Section";

export default function SystemMetricsSection() {
  const cpuPercent = useProcessStore((s) => s.cpuPercent);
  const gpuPercent = useProcessStore((s) => s.gpuPercent);
  const vram = useProcessStore((s) => s.vram);
  const ram = useProcessStore((s) => s.ram);
  const vramBreakdown = useProcessStore((s) => s.vramBreakdown);
  const ramBreakdown = useProcessStore((s) => s.ramBreakdown);

  return (
    <Section
      num="02"
      title="리소스 모니터"
      titleEn="Resources"
      meta="SYS · LIVE"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: "12px 14px",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
        }}
      >
        <MetricBar
          label="CPU"
          accent="#06b6d4"
          percent={cpuPercent}
          rightText={cpuPercent != null ? `${cpuPercent.toFixed(1)}%` : "—"}
        />
        <MetricBar
          label="GPU"
          accent="#22c55e"
          percent={gpuPercent}
          rightText={gpuPercent != null ? `${gpuPercent.toFixed(1)}%` : "—"}
        />
        <div>
          <MetricBar
            label="VRAM"
            accent="#8b5cf6"
            percent={
              vram && vram.totalGb > 0
                ? (vram.usedGb / vram.totalGb) * 100
                : null
            }
            rightText={
              vram ? `${vram.usedGb.toFixed(1)} / ${vram.totalGb.toFixed(0)} GB` : "—"
            }
          />
          {vramBreakdown && (
            <BreakdownLines
              lines={[
                {
                  label: "Ollama",
                  value: vramBreakdown.ollama.vramGb,
                  detail: vramBreakdown.ollama.models.length
                    ? vramBreakdown.ollama.models[0].name
                    : undefined,
                },
                {
                  label: "ComfyUI",
                  value: vramBreakdown.comfyui.vramGb,
                  detail: vramBreakdown.comfyui.models.length
                    ? vramBreakdown.comfyui.models[0]
                    : undefined,
                },
                { label: "기타", value: vramBreakdown.otherGb },
              ]}
              unit="GB"
            />
          )}
        </div>
        <div>
          <MetricBar
            label="RAM"
            accent="#f59e0b"
            percent={
              ram && ram.totalGb > 0
                ? (ram.usedGb / ram.totalGb) * 100
                : null
            }
            rightText={
              ram ? `${ram.usedGb.toFixed(1)} / ${ram.totalGb.toFixed(0)} GB` : "—"
            }
          />
          {ramBreakdown && (
            <BreakdownLines
              lines={[
                { label: "Backend", value: ramBreakdown.backendGb },
                { label: "ComfyUI", value: ramBreakdown.comfyuiGb },
                { label: "Ollama", value: ramBreakdown.ollamaGb },
                { label: "기타", value: ramBreakdown.otherGb },
              ]}
              unit="GB"
            />
          )}
        </div>
      </div>
    </Section>
  );
}

/** 막대 한 줄 — label + bar + 우측 수치. percent null = 측정 불가 (회색 빈 막대). */
function MetricBar({
  label,
  accent,
  percent,
  rightText,
}: {
  label: string;
  accent: string;
  percent: number | null;
  rightText: string;
}) {
  const clamped = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: "var(--ink-2)",
            letterSpacing: ".02em",
          }}
        >
          {label}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--ink-3)",
            fontWeight: 500,
          }}
        >
          {rightText}
        </span>
      </div>
      <div
        style={{
          height: 6,
          width: "100%",
          background: "var(--bg-2)",
          borderRadius: "var(--radius-full)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${clamped}%`,
            background: accent,
            transition: "width .3s ease, background .2s",
          }}
        />
      </div>
    </div>
  );
}

/** 들여쓰기 분해 라인 — VRAM/RAM 아래 ↳ 형태.
 *  값이 < 0.05 GB (≈ 50MB) 인 항목은 숨김 (오빠 피드백 2026-04-27 — 0GB 노이즈 제거).
 *  모든 값이 임계 미만이면 컴포넌트 자체 안 그림. */
function BreakdownLines({
  lines,
  unit,
  threshold = 0.05,
}: {
  lines: Array<{ label: string; value: number; detail?: string }>;
  unit: string;
  threshold?: number;
}) {
  const visible = lines.filter((l) => l.value >= threshold);
  if (visible.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 6,
        paddingLeft: 10,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {visible.map((l) => (
        <div
          key={l.label}
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 8,
            fontSize: 10.5,
          }}
        >
          <span style={{ color: "var(--ink-4)" }}>
            <span style={{ marginRight: 4 }}>↳</span>
            {l.label}
            {l.detail && (
              <span
                className="mono"
                style={{
                  marginLeft: 6,
                  fontSize: 9.5,
                  color: "var(--ink-4)",
                  opacity: 0.7,
                }}
              >
                {l.detail}
              </span>
            )}
          </span>
          <span
            className="mono"
            style={{
              color: "var(--ink-3)",
              fontWeight: 500,
            }}
          >
            {l.value.toFixed(2)} {unit}
          </span>
        </div>
      ))}
    </div>
  );
}
