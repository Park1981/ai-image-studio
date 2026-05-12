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

import type { MouseEvent } from "react";
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

export default function VideoAutoNsfwCard({
  autoNsfwEnabled,
  nsfwIntensity,
  onToggle,
  onIntensityChange,
}: VideoAutoNsfwCardProps) {
  // 현재 selected idx: OFF=0, ON 이면 intensity (1/2/3)
  const selectedIdx = autoNsfwEnabled ? nsfwIntensity : 0;
  const selectedValue = autoNsfwEnabled ? `l${nsfwIntensity}` : "off";

  const handleSelect = (opt: Option, e: MouseEvent<HTMLButtonElement>) => {
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
    // PromptModeRadio 와 같은 segmented 외형을 쓰되 4칸 레이아웃은 독립 CSS 로 고정한다.
    <div
      className="ais-nsfw-mode-segmented"
      role="radiogroup"
      aria-label="자동 NSFW 시나리오 강도"
      data-value={selectedValue}
      data-enabled={autoNsfwEnabled ? "true" : "false"}
      onClick={(e) => e.stopPropagation()}
    >
      <span aria-hidden className="ais-nsfw-mode-thumb" />
      {OPTIONS.map((opt) => {
        const active = opt.idx === selectedIdx;
        return (
          <button
            key={opt.idx}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active}
            title={opt.enabled ? `자동 NSFW ${opt.label}` : "자동 NSFW 끄기"}
            onClick={(e) => handleSelect(opt, e)}
            className="ais-nsfw-mode-seg-btn"
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
