/**
 * VramBadge — TopBar 우상단의 VRAM 사용량 그래픽 배지.
 * useProcessStore.vram 구독 (null 이면 렌더 스킵).
 *
 * 2026-04-23 Opus F3: 양 페이지(TopBar) 의 하드코딩 "VRAM 11.4 / 24 GB" 대체.
 * 2026-04-26: 텍스트 → 미니 bar + 사용량 그래픽 (사용률 임계 색상 변화).
 */

"use client";

import { useProcessStore } from "@/stores/useProcessStore";

/** 막대 폭/높이 — TopBar 안에 들어가는 컴팩트 사이즈 */
const BAR_W = 38;
const BAR_H = 5;

/** 사용률 75% 미만 = accent / 75%+ = amber (16GB 환경에서 ~12GB 부터 경고) */
const HIGH_THRESHOLD = 0.75;

export default function VramBadge() {
  const vram = useProcessStore((s) => s.vram);
  // nvidia-smi 실패 or Mock 모드 — 배지 자체 숨김
  if (!vram) return null;

  // 표시 값
  const used = vram.usedGb;
  const total = vram.totalGb;
  const ratio = total > 0 ? Math.min(1, used / total) : 0;
  const percent = Math.round(ratio * 100);

  // 사용률 임계 색상
  const high = ratio >= HIGH_THRESHOLD;
  const fillColor = high ? "var(--amber)" : "var(--accent)";
  const trackColor = "var(--line)";

  // 사용량 텍스트 — 컴팩트 (예: "11.4G" / "16G" 등)
  const usedLabel = `${used.toFixed(1)}G`;
  const tooltip = `ComfyUI VRAM ${used.toFixed(1)} / ${Math.round(total)} GB · ${percent}%`;

  return (
    <div
      role="meter"
      aria-label={tooltip}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      title={tooltip}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        marginRight: 4,
      }}
    >
      {/* 미니 막대 — track + fill (사용률 비례) */}
      <div
        aria-hidden
        style={{
          position: "relative",
          width: BAR_W,
          height: BAR_H,
          background: trackColor,
          borderRadius: BAR_H / 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${percent}%`,
            background: fillColor,
            borderRadius: BAR_H / 2,
            transition: "width .35s ease, background .25s",
          }}
        />
      </div>
      {/* 사용량 텍스트 — 'G' 접미사로 컴팩트 */}
      <span
        className="mono"
        style={{
          fontSize: 10.5,
          color: high ? "var(--amber-ink)" : "var(--ink-3)",
          letterSpacing: ".04em",
          fontVariantNumeric: "tabular-nums",
          minWidth: 28,
          textAlign: "right",
        }}
      >
        {usedLabel}
      </span>
    </div>
  );
}
