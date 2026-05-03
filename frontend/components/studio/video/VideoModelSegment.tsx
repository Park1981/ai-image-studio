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
            className="ais-video-model-segment-btn"
            data-active={active}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 8,
              border: "none",
              cursor: disabled ? "not-allowed" : "pointer",
              // 가독성 개선 (2026-05-03 fix): 비활성도 충분히 어두운 배경 위에서 잘 보이도록.
              background: active
                ? "rgba(139, 92, 246, 0.28)"
                : "rgba(30, 41, 59, 0.55)",
              color: active ? "#f8fafc" : "#e2e8f0",
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              transition: "background 150ms ease, color 150ms ease, border 150ms ease",
              opacity: disabled ? 0.5 : 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 3,
              textAlign: "left",
              outline: "none",
              boxShadow: active
                ? "0 0 0 1.5px rgba(167, 139, 250, 0.7)"
                : "0 0 0 1px rgba(148, 163, 184, 0.2)",
            }}
          >
            <span>{preset.displayName}</span>
            <span
              style={{
                fontSize: 10,
                // 비활성 sub-tag 도 충분히 보이도록 (옛: #64748b 너무 옅음)
                color: active ? "#c4b5fd" : "#94a3b8",
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
