/**
 * VisionModelSelector — 8B / Thinking 모델 선택 세그먼트 (vision · compare 공용).
 *
 * vision page inline 코드 (2026-05-04) 를 별도 컴포넌트로 추출 (2026-05-05).
 * 사용자가 분석 시점에 모델 선택. useSettingsStore.visionModel persist 와 연동.
 *
 * 시그니처 색:
 *   8B        = Cyan  (#06b6d4 · Cool / 빠름)
 *   Thinking  = Amber (#f59e0b · Warm / 사색)
 *
 * 영상 모델 카드 패턴 채택 (framer-motion flexGrow 1.7/1.0 spring + filter dim).
 */

"use client";

import { motion } from "framer-motion";

// ── 모델 ID 유니온 타입 ──────────────────────────────────────────────────────
export type VisionModelId =
  | "qwen3-vl:8b"
  | "qwen3-vl:8b-thinking-q8_0"
  | (string & {}); // useSettingsStore 에서 임의 모델명도 허용

// ── 모델 옵션 인터페이스 ──────────────────────────────────────────────────────
export interface VisionModelOption {
  /** Ollama 모델 ID */
  id: string;
  /** 카드에 표시할 짧은 라벨 */
  label: string;
  /** 카드 배경 이미지 경로 */
  bgImage: string;
  /** 활성 상태 ring + glow 색 (hex) */
  accentColor: string;
  /** 활성 상태 glow rgba 색 */
  glowRgba: string;
}

// ── 사용 가능한 Vision 모델 목록 ─────────────────────────────────────────────
export const VISION_MODEL_OPTIONS: readonly VisionModelOption[] = [
  {
    id: "qwen3-vl:8b",
    label: "8B",
    bgImage: "/vision-models/8b.png",
    accentColor: "#06b6d4",
    glowRgba: "rgba(6, 182, 212, 0.45)",
  },
  {
    id: "qwen3-vl:8b-thinking-q8_0",
    label: "Thinking",
    bgImage: "/vision-models/thinking.png",
    accentColor: "#f59e0b",
    glowRgba: "rgba(245, 158, 11, 0.45)",
  },
] as const;

// ── framer-motion 애니메이션 상수 (영상 카드 패턴 그대로) ─────────────────────
const ACTIVE_FLEX = 1.7;
const INACTIVE_FLEX = 1;
const SPRING_TRANSITION = {
  type: "spring" as const,
  stiffness: 320,
  damping: 26,
};

// ── 컴포넌트 Props ────────────────────────────────────────────────────────────
interface Props {
  /** 현재 선택된 모델 ID */
  value: string;
  /** 모델 변경 콜백 */
  onChange: (next: string) => void;
  /** true 일 때 카드 클릭 비활성화 (분석/비교 진행 중 등). default false. */
  disabled?: boolean;
}

/**
 * VisionModelSelector
 *
 * 8B / Thinking 두 카드를 가로로 나란히 렌더하고,
 * 활성 카드가 flexGrow 1.7 로 확장 (framer-motion spring).
 * vision page · compare page 에서 동일하게 재사용.
 */
export default function VisionModelSelector({
  value,
  onChange,
  disabled = false,
}: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Vision 모델 선택"
      style={{
        display: "flex",
        gap: 8,
        width: "100%",
      }}
    >
      {VISION_MODEL_OPTIONS.map((opt) => {
        const active = value === opt.id;
        return (
          <motion.button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${opt.label} 모델 선택`}
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            animate={{
              flexGrow: active ? ACTIVE_FLEX : INACTIVE_FLEX,
              scale: active ? 1 : 0.97,
            }}
            transition={SPRING_TRANSITION}
            style={{
              flexBasis: 0,
              minWidth: 0,
              position: "relative",
              minHeight: 88,
              borderRadius: 14,
              border: "none",
              padding: 0,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.55 : 1,
              overflow: "hidden",
              backgroundImage: `url("${opt.bgImage}")`,
              backgroundSize: "cover",
              backgroundPosition: "center right",
              backgroundRepeat: "no-repeat",
              transition: "filter 220ms ease, box-shadow 220ms ease",
              outline: "none",
              boxShadow: active
                ? `0 0 0 2px ${opt.accentColor}, 0 6px 18px ${opt.glowRgba}`
                : "0 0 0 1px rgba(148, 163, 184, 0.22), 0 1px 4px rgba(0, 0, 0, 0.18)",
              filter: active ? "none" : "saturate(0.65) brightness(0.72)",
            }}
          >
            {/* 좌측 어두운 gradient overlay — 모델명 가독성 (인물/사진은 우측에 위치). */}
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
            {/* 모델명 — 좌측 세로 중앙 (영상 카드 패턴). */}
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
                maxWidth: "70%",
                whiteSpace: "nowrap",
              }}
            >
              {opt.label}
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
