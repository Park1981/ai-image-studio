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
  return (
    <section
      // V5MotionCard onClick (adult 토글) bubble 차단 — nested 영역 클릭이 부모 토글로 전파되지 않게.
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "10px 12px",
        borderRadius: "var(--radius-sm)",
        background: autoNsfwEnabled
          ? "rgba(255, 255, 255, 0.06)" // V5MotionCard 안 nested — 살짝 밝게
          : "rgba(0, 0, 0, 0.12)",
        border: autoNsfwEnabled
          ? "1px solid rgba(255, 255, 255, 0.18)"
          : "1px solid rgba(255, 255, 255, 0.08)",
        transition: "background .2s, border-color .2s",
      }}
    >
      <Toggle
        checked={autoNsfwEnabled}
        onChange={onToggle}
        label="🤖 자동 NSFW 시나리오"
        desc="AI 가 이미지 보고 알아서 시나리오 작성 (지시 비워도 OK)"
        align="right"
      />

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
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 600 }}>
                  강도: {INTENSITY_LABEL[nsfwIntensity]}
                </span>
                <span style={{ fontSize: 10.5, color: "var(--ink-4)" }}>
                  {INTENSITY_DESC[nsfwIntensity]}
                </span>
              </div>
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
                style={{ width: "100%" }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 10.5,
                  color: "var(--ink-4)",
                }}
              >
                <span>은근</span>
                <span>옷벗음</span>
                <span>옷벗음+애무</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
