/**
 * SystemMetricsSection — CPU/GPU/VRAM/RAM 막대 + 분해 라인.
 *
 * 2026-05-14 Phase 3 (Editorial Resource): 얇은 5px bar + tone 별
 *   그라데이션 + mono micro 라벨 + 우측 mono percent. breakdown 은
 *   `↳ name` prefix + 우측 GB.
 *
 * 데이터 = useProcessStore (5초 폴링 결과 재사용 — 추가 fetch 없음).
 */

"use client";

import { useProcessStore } from "@/stores/useProcessStore";
import Section from "./Section";

type Tone = "cyan" | "green" | "violet" | "amber";

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
      title="리소스"
      titleEn="Resources"
      meta="SYS · LIVE"
    >
      <div className="ais-res-list">
        <MetricBar
          name="CPU"
          tone="cyan"
          percent={cpuPercent}
          valueText={cpuPercent != null ? cpuPercent.toFixed(1) : "—"}
          unit="%"
        />
        <MetricBar
          name="GPU"
          tone="green"
          percent={gpuPercent}
          valueText={gpuPercent != null ? gpuPercent.toFixed(1) : "—"}
          unit="%"
        />
        <MetricBar
          name="VRAM"
          tone="violet"
          percent={
            vram && vram.totalGb > 0 ? (vram.usedGb / vram.totalGb) * 100 : null
          }
          valueText={vram ? vram.usedGb.toFixed(1) : "—"}
          unit={vram ? `/ ${vram.totalGb.toFixed(0)} GB` : ""}
          breakdown={
            vramBreakdown
              ? [
                  {
                    label: "Ollama",
                    value: vramBreakdown.ollama.vramGb,
                    detail: vramBreakdown.ollama.models[0]?.name,
                  },
                  {
                    label: "ComfyUI",
                    value: vramBreakdown.comfyui.vramGb,
                    detail: vramBreakdown.comfyui.models[0],
                  },
                  { label: "기타", value: vramBreakdown.otherGb },
                ]
              : undefined
          }
        />
        <MetricBar
          name="RAM"
          tone="amber"
          percent={
            ram && ram.totalGb > 0 ? (ram.usedGb / ram.totalGb) * 100 : null
          }
          valueText={ram ? ram.usedGb.toFixed(1) : "—"}
          unit={ram ? `/ ${ram.totalGb.toFixed(0)} GB` : ""}
          breakdown={
            ramBreakdown
              ? [
                  { label: "Backend", value: ramBreakdown.backendGb },
                  { label: "ComfyUI", value: ramBreakdown.comfyuiGb },
                  { label: "Ollama", value: ramBreakdown.ollamaGb },
                  { label: "기타", value: ramBreakdown.otherGb },
                ]
              : undefined
          }
        />
      </div>
    </Section>
  );
}

type BreakdownLine = { label: string; value: number; detail?: string };

/** 한 줄 메트릭 — 라벨 + 얇은 5px bar + tone 별 그라데이션 + breakdown 옵션.
 *  값이 < 0.05 GB (≈ 50MB) 인 breakdown 항목은 숨김 (오빠 피드백 2026-04-27). */
function MetricBar({
  name,
  tone,
  percent,
  valueText,
  unit,
  breakdown,
}: {
  name: string;
  tone: Tone;
  percent: number | null;
  valueText: string;
  unit: string;
  breakdown?: BreakdownLine[];
}) {
  const clamped = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const visible = breakdown?.filter((l) => l.value >= 0.05);
  return (
    <div className="ais-res-row">
      <div className="ais-res-line">
        <span className="ais-res-name">{name}</span>
        <span className="ais-res-val">
          {valueText}
          {unit && <span className="unit">{unit}</span>}
        </span>
      </div>
      <div className="ais-res-bar">
        <div
          className="ais-res-bar-fill"
          data-tone={tone}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {visible && visible.length > 0 && (
        <div className="ais-res-break">
          {visible.map((l) => (
            <div key={l.label} className="ais-res-break-row">
              <span>
                {l.label}
                {l.detail && (
                  <span style={{ opacity: 0.7, marginLeft: 6 }}>{l.detail}</span>
                )}
              </span>
              <span>{l.value.toFixed(2)} GB</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
