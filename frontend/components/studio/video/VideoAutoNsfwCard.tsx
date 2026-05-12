/**
 * VideoAutoNsfwCard — 자동 NSFW 시나리오 토글 + 강도 슬라이더 (spec 2026-05-12 v1.1 §4.8).
 *
 * Props 정책 (Codex Finding 11):
 *   - adult prop 없음. 호출자(VideoLeftPanel)가 adult=true 일 때만 렌더링.
 *   - 토글/슬라이더 노출 조건은 컴포넌트 내부에서만 결정 (autoNsfwEnabled).
 *
 * 동작:
 *   - 토글 ON → AI 가 이미지 분석 후 자율 시나리오 작성 (사용자 지시 비워도 OK)
 *   - 강도: 1 은근 / 2 옷벗음 / 3 옷벗음+애무 (사용자 디폴트 = 2)
 *
 * 2026-05-12 fix: adult V5MotionCard 안 nested 통합. outer section 의
 * onClick stopPropagation 으로 부모 V5MotionCard onClick (adult 토글) bubble 차단.
 */

"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Toggle } from "@/components/ui/primitives";
import type { NsfwIntensity } from "@/stores/useSettingsStore";

export interface VideoAutoNsfwCardProps {
  autoNsfwEnabled: boolean;
  nsfwIntensity: NsfwIntensity;
  onToggle: (v: boolean) => void;
  onIntensityChange: (v: NsfwIntensity) => void;
}

const INTENSITY_LABEL: Record<NsfwIntensity, string> = {
  1: "은근",
  2: "옷벗음",
  3: "옷벗음+애무",
};

const INTENSITY_DESC: Record<NsfwIntensity, string> = {
  1: "옷 유지 · 자세·표정·암시만",
  2: "탈의 reveal 까지 (자기 손길 없음)",
  3: "탈의 + 누드 후 intimate self-touch",
};

export default function VideoAutoNsfwCard({
  autoNsfwEnabled,
  nsfwIntensity,
  onToggle,
  onIntensityChange,
}: VideoAutoNsfwCardProps) {
  // crimson 시그니처 — adult 카드와 톤 통일. inline 변수로 묶어 토글/슬라이더 둘 다 적용.
  const CRIMSON_INK = "#ff5f6d";          // 슬라이더 + 토글 액티브 색
  const CRIMSON_SOFT = "rgba(255, 95, 109, 0.18)";  // active background tint
  const TEXT_PRIMARY = "rgba(255, 255, 255, 0.92)";
  const TEXT_SECONDARY = "rgba(255, 255, 255, 0.62)";
  const TEXT_TERTIARY = "rgba(255, 255, 255, 0.42)";

  return (
    <section
      // V5MotionCard onClick (adult 토글) bubble 차단 — nested 영역 클릭이 부모 토글로 전파되지 않게.
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "12px 14px",
        borderRadius: "var(--radius-sm)",
        // 반투명 dark + backdrop-blur — 인물 배경 위에 nested 패널 분리감 + 가독성
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
      {/* 자동 NSFW 토글 — Toggle 컴포넌트 (파란 accent 고정) 대신 자체 구현으로
       *  crimson 시그니처 통일. label/desc 흰색 가독성. */}
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          cursor: "pointer",
          position: "relative",
        }}
      >
        <input
          type="checkbox"
          checked={autoNsfwEnabled}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label="자동 NSFW 시나리오"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0,
            cursor: "pointer",
            margin: 0,
            border: 0,
          }}
        />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              color: TEXT_PRIMARY,
              marginBottom: 2,
            }}
          >
            🤖 자동 NSFW 시나리오
          </span>
          <span
            style={{
              display: "block",
              fontSize: 11,
              color: TEXT_SECONDARY,
              lineHeight: 1.4,
            }}
          >
            AI 가 이미지 보고 알아서 시나리오 작성 (지시 비워도 OK)
          </span>
        </span>
        <span
          style={{
            position: "relative",
            width: 32,
            height: 18,
            borderRadius: 999,
            background: autoNsfwEnabled
              ? CRIMSON_INK
              : "rgba(255, 255, 255, 0.18)",
            transition: "background .15s",
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: autoNsfwEnabled ? 16 : 2,
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#fff",
              transition: "left .15s",
              boxShadow: "0 1px 3px rgba(0,0,0,.3)",
            }}
          />
        </span>
      </label>

      <AnimatePresence initial={false}>
        {autoNsfwEnabled && (
          <motion.div
            key="intensity-slider"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                paddingTop: 8,
                borderTop: `1px solid ${CRIMSON_SOFT}`,
              }}
            >
              {/* 라벨 1줄: "강도: 옷벗음+애무" — desc 는 그 아래로 분리 (overlap 회피) */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span
                  style={{
                    fontSize: 12,
                    color: TEXT_PRIMARY,
                    fontWeight: 600,
                  }}
                >
                  강도
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: CRIMSON_INK,
                    fontWeight: 700,
                  }}
                >
                  {INTENSITY_LABEL[nsfwIntensity]}
                </span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: TEXT_SECONDARY,
                  lineHeight: 1.4,
                }}
              >
                {INTENSITY_DESC[nsfwIntensity]}
              </span>
              <input
                type="range"
                min={1}
                max={3}
                step={1}
                value={nsfwIntensity}
                onChange={(e) =>
                  onIntensityChange(Number(e.target.value) as NsfwIntensity)
                }
                aria-label="자동 NSFW 강도"
                style={{
                  width: "100%",
                  // accent-color: 슬라이더 thumb + track 둘 다 crimson 통일
                  accentColor: CRIMSON_INK,
                  marginTop: 2,
                }}
              />
              {/* 슬라이더 라벨 — 강도별 위치 강조 (active 는 흰색, 나머지 dim) */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 10.5,
                  marginTop: -2,
                }}
              >
                {([1, 2, 3] as NsfwIntensity[]).map((lvl) => (
                  <span
                    key={lvl}
                    style={{
                      color:
                        lvl === nsfwIntensity ? TEXT_PRIMARY : TEXT_TERTIARY,
                      fontWeight: lvl === nsfwIntensity ? 600 : 400,
                      transition: "color .15s",
                    }}
                  >
                    {INTENSITY_LABEL[lvl]}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
