/**
 * useGenerateStore - 생성 모드 입력/진행 상태.
 * 페이지 전환에도 입력값은 유지 (부분 영속 — prompt/aspect/lightning/research).
 * 진행 상태(generating/progress)는 세션 내에서만 유효.
 */

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { GENERATE_MODEL, type AspectRatioLabel } from "@/lib/model-presets";

export interface StageEvent {
  type: string;
  /** UI 라벨 (예: "gemma4 업그레이드") */
  label: string;
  /** 0-100 */
  progress: number;
  /** 도착 시점 (ms since epoch) */
  arrivedAt: number;
}

export interface GenerateState {
  prompt: string;
  aspect: AspectRatioLabel;
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
  setAspect: (v: AspectRatioLabel) => void;
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
    (set) => ({
      prompt: DEFAULT_PROMPT,
      aspect: GENERATE_MODEL.defaults.aspect,
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
      setAspect: (v) => set({ aspect: v }),
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
    }),
    {
      name: "ais:generate",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // 진행 상태 제외 (영속 X)
      partialize: (s) => ({
        prompt: s.prompt,
        aspect: s.aspect,
        research: s.research,
        lightning: s.lightning,
        steps: s.steps,
        cfg: s.cfg,
        seed: s.seed,
      }),
    },
  ),
);
