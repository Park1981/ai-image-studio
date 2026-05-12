/**
 * VideoAutoNsfwCard — 자동 NSFW 시나리오 4-option segmented (spec 2026-05-12 v1.1 §4.8 + 2026-05-12 UX).
 *
 * Props 정책 (Codex Finding 11):
 *   - adult prop 없음. 호출자(VideoLeftPanel)가 adult=true 일 때만 렌더링.
 *
 * UX (2026-05-12 변경):
 *   - 토글 + 슬라이더 → 4 옵션 segmented (OFF / 1단계 / 2단계 / 3단계)
 *   - AI 프롬프트 보정 카드의 instant/thinking 패턴 차용 (4 옵션 확장)
 *   - active thumb crimson 시그니처 (adult 카드 톤 통일)
 */

"use client";

import type { NsfwIntensity } from "@/stores/useSettingsStore";

export interface VideoAutoNsfwCardProps {
  autoNsfwEnabled: boolean;
  nsfwIntensity: NsfwIntensity;
  onToggle: (v: boolean) => void;
  onIntensityChange: (v: NsfwIntensity) => void;
}

type Option = {
  /** segmented 안 위치 (0~3) */
  idx: number;
  /** 표시 라벨 */
  label: string;
  /** 클릭 시 autoNsfwEnabled */
  enabled: boolean;
  /** 클릭 시 nsfwIntensity (enabled=false 면 무시) */
  intensity: NsfwIntensity;
};

const OPTIONS: ReadonlyArray<Option> = [
  { idx: 0, label: "OFF", enabled: false, intensity: 2 },
  { idx: 1, label: "1단계", enabled: true, intensity: 1 },
  { idx: 2, label: "2단계", enabled: true, intensity: 2 },
  { idx: 3, label: "3단계", enabled: true, intensity: 3 },
];

const TEXT_PRIMARY = "rgba(255, 255, 255, 0.92)";
const TEXT_DIM = "rgba(255, 255, 255, 0.55)";
const CRIMSON_INK = "#ff5f6d";

export default function VideoAutoNsfwCard({
  autoNsfwEnabled,
  nsfwIntensity,
  onToggle,
  onIntensityChange,
}: VideoAutoNsfwCardProps) {
  // 현재 selected idx: OFF=0, ON 이면 intensity (1/2/3)
  const selectedIdx = autoNsfwEnabled ? nsfwIntensity : 0;

  const handleSelect = (opt: Option, e: React.MouseEvent) => {
    // V5MotionCard onClick (adult 토글) bubble 차단
    e.stopPropagation();
    if (opt.enabled) {
      // ON 으로 변경 — autoNsfwEnabled + intensity 둘 다 설정
      if (!autoNsfwEnabled) onToggle(true);
      if (nsfwIntensity !== opt.intensity) onIntensityChange(opt.intensity);
    } else {
      // OFF 로 변경 — autoNsfwEnabled 만 false (intensity 는 다음 ON 위해 유지)
      if (autoNsfwEnabled) onToggle(false);
    }
  };

  return (
    <section
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 14px",
        borderRadius: "var(--radius-sm)",
        background: autoNsfwEnabled
          ? "rgba(20, 6, 10, 0.62)"
          : "rgba(10, 4, 6, 0.5)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: autoNsfwEnabled
          ? "1px solid rgba(255, 95, 109, 0.32)"
          : "1px solid rgba(255, 255, 255, 0.1)",
        transition: "background .2s, border-color .2s",
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: TEXT_PRIMARY,
        }}
      >
        🤖 자동 NSFW 시나리오
      </span>

      {/* 4-option segmented (PromptModeRadio 패턴 4 옵션 확장).
       *  active thumb 가 crimson 톤으로 slide. */}
      <div
        role="radiogroup"
        aria-label="자동 NSFW 시나리오 강도"
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          padding: 3,
          background: "rgba(0, 0, 0, 0.28)",
          borderRadius: 999,
          height: 32,
        }}
      >
        {/* slide thumb — 25% width, left = idx * 25% */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 3,
            bottom: 3,
            left: `calc(${selectedIdx * 25}% + 3px)`,
            width: "calc(25% - 6px)",
            background: autoNsfwEnabled ? CRIMSON_INK : "rgba(255,255,255,0.16)",
            borderRadius: 999,
            transition: "left .18s ease, background .18s",
            boxShadow: autoNsfwEnabled
              ? "0 2px 6px rgba(255,95,109,0.35)"
              : "0 1px 3px rgba(0,0,0,0.2)",
          }}
        />
        {OPTIONS.map((opt) => {
          const active = opt.idx === selectedIdx;
          return (
            <button
              key={opt.idx}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={(e) => handleSelect(opt, e)}
              style={{
                position: "relative",
                zIndex: 1,
                background: "transparent",
                border: 0,
                cursor: "pointer",
                fontSize: 11.5,
                fontWeight: active ? 700 : 500,
                color: active ? "#fff" : TEXT_DIM,
                padding: "0 4px",
                transition: "color .15s, font-weight .15s",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
