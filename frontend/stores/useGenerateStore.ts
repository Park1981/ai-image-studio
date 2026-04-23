/**
 * useGenerateStore - 생성 모드 입력/진행 상태.
 * 페이지 전환에도 입력값은 유지 (부분 영속 — prompt/aspect/lightning/research).
 * 진행 상태(generating/progress)는 세션 내에서만 유효.
 */

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  ASPECT_RATIOS,
  GENERATE_MODEL,
  getAspect,
  type AspectRatioLabel,
} from "@/lib/model-presets";

/** Qwen/ComfyUI 권장: 8의 배수 + 256~2048 clamp */
export function snapDimension(v: number): number {
  const clamped = Math.max(256, Math.min(2048, Math.round(v)));
  return Math.round(clamped / 8) * 8;
}

export interface StageEvent {
  type: string;
  /** UI 라벨 (예: "gemma4 업그레이드") */
  label: string;
  /** 0-100 */
  progress: number;
  /** 도착 시점 (ms since epoch) */
  arrivedAt: number;
}

/** 프리셋 중 어느 것과도 안 맞는 사용자 지정 사이즈 */
export type AspectValue = AspectRatioLabel | "custom";

export interface GenerateState {
  prompt: string;
  /** 프리셋 라벨 또는 "custom" (사용자가 픽셀 직접 수정한 경우) */
  aspect: AspectValue;
  /** 실제 사용할 픽셀 폭/높이 — aspect 프리셋과 독립적 */
  width: number;
  height: number;
  /** 비율 잠금: ON 이면 한쪽 수정 시 다른쪽 자동 계산 */
  aspectLocked: boolean;
  research: boolean;
  lightning: boolean;
  steps: number;
  cfg: number;
  seed: number;

  // 실행 상태 (영속 X)
  generating: boolean;
  progress: number;
  stage: string;
  /** 진행 모달용 stage 이벤트 타임라인 */
  stageHistory: StageEvent[];

  // actions
  setPrompt: (v: string) => void;
  /** 프리셋 선택 — aspect + width + height 를 동시에 프리셋 값으로 세팅 */
  setAspect: (v: AspectRatioLabel) => void;
  /** 픽셀 직접 수정 — aspectLocked 상태를 참고해 반대편 자동 갱신 */
  setWidth: (v: number) => void;
  setHeight: (v: number) => void;
  setAspectLocked: (v: boolean) => void;
  setResearch: (v: boolean) => void;
  setLightning: (v: boolean) => void;
  setSteps: (v: number) => void;
  setCfg: (v: number) => void;
  setSeed: (v: number) => void;
  setRunning: (generating: boolean, progress?: number, stage?: string) => void;
  resetRunning: () => void;
  pushStage: (evt: Omit<StageEvent, "arrivedAt">) => void;

  /** Lightning 토글 시 steps/CFG 자동 스위치 (defaults ↔ lightning) */
  applyLightning: (on: boolean) => void;
}

const DEFAULT_PROMPT =
  "따뜻한 창가에서 책을 읽는 검은 고양이, 늦은 오후 햇빛, 필름 그레인, 미묘한 보케";

export const useGenerateStore = create<GenerateState>()(
  persist(
    (set) => {
      const defaultAspect = GENERATE_MODEL.defaults.aspect;
      const defaultPreset = getAspect(defaultAspect);
      return {
      prompt: DEFAULT_PROMPT,
      aspect: defaultAspect,
      width: defaultPreset.width,
      height: defaultPreset.height,
      aspectLocked: true,
      research: true,
      lightning: false,
      steps: GENERATE_MODEL.defaults.steps,
      cfg: GENERATE_MODEL.defaults.cfg,
      seed: GENERATE_MODEL.defaults.seed,

      generating: false,
      progress: 0,
      stage: "",
      stageHistory: [],

      setPrompt: (v) => set({ prompt: v }),
      setAspect: (v) => {
        // 프리셋 선택 시 width/height 도 함께 프리셋 값으로 덮어씀 (비율 잠금 기준이 리셋됨)
        const preset = getAspect(v);
        set({ aspect: v, width: preset.width, height: preset.height });
      },
      setWidth: (v) =>
        set((s) => {
          const newW = snapDimension(v);
          if (!s.aspectLocked) return { width: newW, aspect: matchAspect(newW, s.height) };
          // 비율 잠금: aspect 는 그대로 유지 (snap 오차로 "custom" 되는 것 방지)
          const ratio = s.width / s.height || 1;
          const newH = snapDimension(newW / ratio);
          return { width: newW, height: newH };
        }),
      setHeight: (v) =>
        set((s) => {
          const newH = snapDimension(v);
          if (!s.aspectLocked) return { height: newH, aspect: matchAspect(s.width, newH) };
          // 비율 잠금: aspect 는 그대로 유지
          const ratio = s.width / s.height || 1;
          const newW = snapDimension(newH * ratio);
          return { width: newW, height: newH };
        }),
      setAspectLocked: (v) => set({ aspectLocked: v }),
      setResearch: (v) => set({ research: v }),
      setLightning: (v) => set({ lightning: v }),
      setSteps: (v) => set({ steps: v }),
      setCfg: (v) => set({ cfg: v }),
      setSeed: (v) => set({ seed: v }),
      setRunning: (generating, progress = 0, stage = "") =>
        set((s) => ({
          generating,
          progress,
          stage,
          // 새 세션 시작(generating=true + progress=0) 이면 히스토리 초기화
          stageHistory:
            generating && progress === 0 ? [] : s.stageHistory,
        })),
      resetRunning: () =>
        set({ generating: false, progress: 0, stage: "" }),
      pushStage: (evt) =>
        set((s) => ({
          stageHistory: [
            ...s.stageHistory,
            { ...evt, arrivedAt: Date.now() },
          ],
        })),

      applyLightning: (on) => {
        if (on) {
          set({
            lightning: true,
            steps: GENERATE_MODEL.lightning.steps,
            cfg: GENERATE_MODEL.lightning.cfg,
          });
        } else {
          set({
            lightning: false,
            steps: GENERATE_MODEL.defaults.steps,
            cfg: GENERATE_MODEL.defaults.cfg,
          });
        }
      },
      };
    },
    {
      name: "ais:generate",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      // v1 → v2: width/height/aspectLocked 신규 필드 추가
      migrate: (persistedState: unknown, version: number) => {
        if (version < 2) {
          const s = persistedState as { aspect?: AspectRatioLabel };
          const preset = getAspect(s.aspect ?? GENERATE_MODEL.defaults.aspect);
          return { ...s, width: preset.width, height: preset.height, aspectLocked: true };
        }
        return persistedState;
      },
      // 진행 상태 제외 (영속 X)
      partialize: (s) => ({
        prompt: s.prompt,
        aspect: s.aspect,
        width: s.width,
        height: s.height,
        aspectLocked: s.aspectLocked,
        research: s.research,
        lightning: s.lightning,
        steps: s.steps,
        cfg: s.cfg,
        seed: s.seed,
      }),
    },
  ),
);

/** W/H 가 기존 프리셋 중 하나와 동일하면 라벨 매칭, 아니면 "custom". */
function matchAspect(w: number, h: number): AspectValue {
  const match = ASPECT_RATIOS.find((r) => r.width === w && r.height === h);
  return match?.label ?? "custom";
}
