/**
 * SystemMetrics — 헤더 통합 자원 사용률 4-bar UI (V5 trigger).
 *
 * Phase 2 (V5 · 2026-05-02 · 결정 N · 옵션 A):
 *   - 옛 V4 의 hover-시-trigger-자체-expand 정책 폐기 (globals.css §V4 hover selector 제거).
 *   - V5: trigger (4-bar) 는 평상시 정지. 호버 / 포커스 시 *아래로* `<MetricsPopover />` 가 떨어진다.
 *   - 시안 (`pair-edit.html` v3 · v2 NEW 옵션 A) 1:1 매치.
 *
 * 4-bar trigger:
 *   각 메트릭 색상 막대 4개만 (CPU 시안 / GPU 초록 / VRAM 보라 / RAM 파랑).
 *   80%+ amber tail / 90%+ red tail 그라데이션은 그대로 (옛 정책 보존).
 *
 * Popover (MetricsPopover.tsx):
 *   - dot+halo · MONO 라벨 · usage · long bar · % mono — 4 row
 *   - VRAM ≥ 80% + breakdown 데이터 → ComfyUI / Ollama row 추가
 *
 * 접근성 (Codex 1차 🟡 보강 + Phase 8 cleanup 정통 disclosure 패턴):
 *   - hover-stay-open: globals.css 의 `::before` 10px invisible bridge + `:hover` selector
 *     (마우스가 popover 위로 transit 시 닫히지 않음) + close transition-delay 0.15s.
 *   - close timer 200ms: 마우스 leave 후 short delay (popover 안으로 transit 시간 확보).
 *   - `:focus-within` popover 자동 노출 — Tab 키 진입 시 (CSS 자동 hook).
 *   - **Esc 키 닫기**: focus 가 trigger 안에 있을 때만 active. focus return → trigger 유지.
 *   - **정통 disclosure**: `<button>` + `aria-expanded={open}` + `aria-controls` + `onClick toggle`.
 *     ESLint role="group" 충돌 해소 (Phase 8 cleanup · 2026-05-02).
 *
 * 회귀 위험 보존:
 *   - 8: hover-stay-open + 키보드 — bridge ::before + transition-delay + :focus-within + close timer 200ms + Esc.
 *   - 11: V5 시각 대상 inline style → className. 동적 fill width/background 만 inline (정책 허용).
 */

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useProcessStore } from "@/stores/useProcessStore";
import MetricsPopover, {
  HIGH_THRESHOLD,
  DANGER_THRESHOLD,
  METRIC_COLORS,
  type MetricItem,
} from "./MetricsPopover";

const DANGER_COLOR = "#DC2626";
const WARN_COLOR = "#F59E0B";

/** 마우스 leave 후 popover 자동 닫힘 지연 — bridge ::before 와 페어 (시안 v2) */
const CLOSE_TIMER_MS = 200;

export default function SystemMetrics() {
  const cpu = useProcessStore((s) => s.cpuPercent);
  const gpu = useProcessStore((s) => s.gpuPercent);
  const vram = useProcessStore((s) => s.vram);
  const ram = useProcessStore((s) => s.ram);
  const breakdown = useProcessStore((s) => s.vramBreakdown);

  // popover open state — `data-open="true"` hook 으로 키보드 활성화 보강 (Esc 시 false)
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverId = useId();

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

  // VRAM 임계 + breakdown 둘 다 있어야 popover 안 breakdown 노출
  const vramMetric = metrics.find((m) => m.key === "vram");
  const showBreakdown =
    !!vramMetric && vramMetric.percent >= HIGH_THRESHOLD && !!breakdown;

  // Esc 키 닫기 — focus 가 trigger 안 (또는 popover) 에 있을 때만 active.
  // Codex 3차 정책: focus return → trigger 유지 (blur X). 키보드 사용자가 Esc 로 닫아도
  // Tab 흐름 자연 (trigger 에서 다음 sibling 으로 자연 이동 가능).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const root = triggerRef.current;
      if (!root) return;
      // focus 가 trigger 안 (popover 포함 — popover 도 trigger DOM 의 자식) 에 있을 때만
      if (!root.contains(document.activeElement)) return;
      e.preventDefault();
      setOpen(false);
      // focus return → trigger root (tabIndex=0). popover 안 focus 였다면 root 으로 복귀.
      // blur 안 함 — focus 유지. :focus-within 가 다시 popover 열어도 의도 (a11y 정책 매칭).
      root.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // unmount 시 timer cleanup — 메모리 누수 차단
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  if (metrics.length === 0) return null;

  // hover/leave 핸들러 — close timer 로 마우스 transit 자연 처리.
  // CSS bridge ::before 와 페어 (둘 중 하나라도 hover 유지하면 popover 살아있음).
  const handleMouseEnter = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    // data-open hook 은 키보드 보강용 — hover 는 CSS selector 가 처리하므로 setOpen 은 보조
    setOpen(true);
  };
  const handleMouseLeave = () => {
    // 200ms 지연 후 close — popover 안으로 transit 시간 확보
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, CLOSE_TIMER_MS);
  };

  return (
    <button
      type="button"
      ref={triggerRef}
      className="ais-metrics"
      aria-label="시스템 자원 사용률"
      aria-expanded={open}
      aria-controls={popoverId}
      // data-open hook — Esc 닫기 + close timer 동기화용 (CSS selector 와 페어)
      data-open={open ? "true" : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      // 정통 disclosure: 클릭 토글 (키보드 Enter/Space 도 자동 처리 · Phase 8 cleanup)
      onClick={() => setOpen((v) => !v)}
    >
      {/* 4-bar trigger — 평상시 정지 + 색상 시그니처 (CPU 시안/GPU 초록/VRAM 보라/RAM 파랑) */}
      {metrics.map((m) => (
        <MetricBar key={m.key} metric={m} />
      ))}

      {/* Frosted glass dropdown — hover/focus/data-open 시 아래로 떨어짐 */}
      <MetricsPopover
        id={popoverId}
        metrics={metrics}
        breakdown={showBreakdown ? breakdown : null}
      />
    </button>
  );
}

/* ─────────────────────────────────────────
   MetricBar — V5 trigger 의 단일 4-bar (평상시 정지 · 색상만 노출)
   - 옛 dot/label/usage/% slide 는 popover 로 이동 (CSS display:none).
   - 0-80% solid / 80-90% amber tail / 90+ red tail 정책 보존.
   ───────────────────────────────────────── */
function MetricBar({ metric }: { metric: MetricItem }) {
  const color = METRIC_COLORS[metric.key];
  const fillBackground =
    metric.percent >= DANGER_THRESHOLD
      ? `linear-gradient(90deg, ${color} 0%, ${color} 50%, ${WARN_COLOR} 75%, ${DANGER_COLOR} 100%)`
      : metric.percent >= HIGH_THRESHOLD
        ? `linear-gradient(90deg, ${color} 0%, ${color} 60%, ${WARN_COLOR} 100%)`
        : color;

  const tooltip = metric.usage
    ? `${metric.label} ${metric.usage.used} / ${metric.usage.total} · ${Math.round(metric.percent)}%`
    : `${metric.label} ${Math.round(metric.percent)}%`;

  return (
    <div className="ais-metric-cell" title={tooltip}>
      {/* dot/label/usage/percent 는 globals.css `.ais-slide`/`.ais-dot` display:none 으로 미노출 — popover 가 책임.
          DOM 은 의미상 유지 (옛 `:focus-within` 의도 + 향후 V6 재활용 가능). */}
      <div className="ais-bar">
        <div
          className="ais-bar-fill"
          style={{
            width: `${metric.percent}%`,
            background: fillBackground,
          }}
        />
      </div>
    </div>
  );
}

/** 0~100 안전 clamp */
function clamp(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
