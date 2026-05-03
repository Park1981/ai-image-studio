/**
 * VideoModelSegment — 영상 모델 선택 세그먼트 컨트롤 (Phase 5 · 2026-05-03 신설).
 *
 * 위치: VideoLeftPanel 의 StudioModeHeader 와 SourceImageCard 사이 (spec §5.6).
 * 두 모델 (Wan 2.2 / LTX 2.3) 의 표시명 + tag + ETA hint 를 pill 형태로 제공.
 *
 * Source-of-truth (옵션 A · spec §5.6):
 *  onChange = useVideoStore.setSelectedVideoModel — 내부에서 useSettingsStore 도 fan-out + sweet spot 자동 채움.
 *  호출부는 이 컴포넌트 한 곳만 옴 (race 없음 · 동기 호출).
 */

"use client";

import { VIDEO_MODEL_PRESETS, type VideoModelId } from "@/lib/model-presets";

interface Props {
  value: VideoModelId;
  onChange: (id: VideoModelId) => void;
  disabled?: boolean;
}

const MODEL_IDS: readonly VideoModelId[] = ["wan22", "ltx"] as const;

export default function VideoModelSegment({ value, onChange, disabled }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="영상 모델 선택"
      style={{
        display: "flex",
        gap: 6,
        padding: 4,
        borderRadius: 12,
        background: "rgba(15, 23, 42, 0.4)",
        border: "1px solid rgba(148, 163, 184, 0.15)",
      }}
    >
      {MODEL_IDS.map((id) => {
        const preset = VIDEO_MODEL_PRESETS[id];
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(id)}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 8,
              border: "none",
              cursor: disabled ? "not-allowed" : "pointer",
              background: active
                ? "rgba(139, 92, 246, 0.18)"
                : "transparent",
              color: active ? "#e2e8f0" : "#94a3b8",
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              transition: "background 150ms ease, color 150ms ease",
              opacity: disabled ? 0.5 : 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 3,
              textAlign: "left",
              outline: active ? "1px solid rgba(139, 92, 246, 0.45)" : "none",
            }}
          >
            <span>{preset.displayName}</span>
            <span
              style={{
                fontSize: 10,
                color: active ? "#a78bfa" : "#64748b",
                fontWeight: 400,
              }}
            >
              {preset.tag} · ⚡ {preset.speedHint.lightning}
            </span>
          </button>
        );
      })}
    </div>
  );
}
