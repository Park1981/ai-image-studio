/**
 * VideoModelSegment — 영상 모델 선택 세그먼트 컨트롤 (Phase 5 · 2026-05-03 신설).
 *
 * 위치: VideoLeftPanel 의 StudioModeHeader 와 SourceImageCard 사이 (spec §5.6).
 *
 * 디자인 (사용자 피드백 2026-05-03):
 *  - 배경 이미지 카드 형태 (gold/violet 톤 · /public/images/video-model-{id}-bg.png)
 *  - 모델명만 깔끔히 표시 (tag/speedHint/desc 모두 제거 — ETA 는 CTA 메타에 이미 있음)
 *  - 좌측 어두운 gradient overlay 로 텍스트 가독성 확보 (인물은 우측에 위치)
 *  - 활성: violet ring + scale 1.0 + 풀 컬러
 *  - 비활성: 약한 ring + scale 0.97 + saturate/brightness 살짝 낮춤
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

/** 모델별 배경 이미지 (frontend/public/images/) — 사용자 매칭:
 *  wan22 = 부드러운 wave dreamy (gold) / ltx = 빛줄기 cyber (gold)
 */
const MODEL_BG_IMAGES: Record<VideoModelId, string> = {
  wan22: "/images/video-model-wan22-bg.png",
  ltx: "/images/video-model-ltx-bg.png",
};

export default function VideoModelSegment({ value, onChange, disabled }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="영상 모델 선택"
      style={{
        display: "flex",
        gap: 8,
        width: "100%",
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
            aria-label={`${preset.displayName} 모델 선택`}
            disabled={disabled}
            onClick={() => onChange(id)}
            className="ais-video-model-card"
            data-active={active}
            style={{
              flex: 1,
              position: "relative",
              minHeight: 88,
              borderRadius: 14,
              border: "none",
              padding: 0,
              cursor: disabled ? "not-allowed" : "pointer",
              overflow: "hidden",
              backgroundImage: `url("${MODEL_BG_IMAGES[id]}")`,
              backgroundSize: "cover",
              backgroundPosition: "center right",
              backgroundRepeat: "no-repeat",
              transition:
                "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), filter 200ms ease, box-shadow 200ms ease",
              opacity: disabled ? 0.5 : 1,
              outline: "none",
              boxShadow: active
                ? "0 0 0 2px rgba(167, 139, 250, 0.85), 0 6px 18px rgba(139, 92, 246, 0.32)"
                : "0 0 0 1px rgba(148, 163, 184, 0.22), 0 1px 4px rgba(0, 0, 0, 0.18)",
              transform: active ? "scale(1)" : "scale(0.97)",
              filter: active ? "none" : "saturate(0.7) brightness(0.78)",
            }}
          >
            {/* 좌측 어두운 gradient overlay — 모델명 텍스트 가독성 (인물은 우측 위치).
             *  pointerEvents:none 으로 버튼 클릭 가로채기 방지. */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(90deg, rgba(15,23,42,0.72) 0%, rgba(15,23,42,0.42) 42%, rgba(15,23,42,0) 70%)",
                pointerEvents: "none",
              }}
            />
            {/* 모델명 — 좌측 세로 중앙. 깔끔하게 모델명만 (사용자 요청). */}
            <div
              style={{
                position: "absolute",
                left: 16,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#f8fafc",
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: "-0.005em",
                lineHeight: 1.2,
                textShadow: "0 2px 8px rgba(0, 0, 0, 0.55)",
                pointerEvents: "none",
                maxWidth: "60%",
              }}
            >
              {preset.displayName}
            </div>
          </button>
        );
      })}
    </div>
  );
}
