/**
 * useGenerateStore - 생성 모드 입력/진행 상태.
 * 사이즈/옵션만 유지하고 prompt 는 페이지 진입 시 빈 값으로 시작.
 * 진행 상태(generating/progress)는 세션 내에서만 유효.
 *
 * 2026-04-24: Step/CFG/Seed UI 제거 — 해당 값은 이제 useGeneratePipeline 에서
 *  lightning 여부에 따라 GENERATE_MODEL.defaults / lightning 직접 참조 + seed 는 매번 랜덤.
 *  store 에 남겨두면 UI 없이 옛 값이 고정 재사용돼 모든 결과가 같아지는 문제.
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

  // 실행 상태 (영속 X)
  generating: boolean;
  progress: number;
  stage: string;
  /** 진행 모달용 stage 이벤트 타임라인 */
  stageHistory: StageEvent[];
  /** 실행 시작 시각 (ms since epoch) — 경과 시간 계산용 */
  startedAt: number | null;
  /** ComfyUI 샘플러 현재 스텝 (예: 3) */
  samplingStep: number | null;
  /** ComfyUI 샘플러 총 스텝 (예: 40) */
  samplingTotal: number | null;

  // actions
  setPrompt: (v: string) => void;
  /** 프리셋 선택 — 비율잠금 ON 이면 width 유지 + height 재계산, OFF 면 프리셋 기본값 */
  setAspect: (v: AspectValue) => void;
  /** 픽셀 직접 수정 — aspectLocked 상태를 참고해 반대편 자동 갱신 */
  setWidth: (v: number) => void;
  setHeight: (v: number) => void;
  /** 두 픽셀값을 원자적으로 지정 (재생성 등 복원 용) — aspectLocked 의 자동 갱신 무시 */
  setDimensions: (w: number, h: number) => void;
  setAspectLocked: (v: boolean) => void;
  setResearch: (v: boolean) => void;
  setRunning: (generating: boolean, progress?: number, stage?: string) => void;
  resetRunning: () => void;
  pushStage: (evt: Omit<StageEvent, "arrivedAt">) => void;
  /** ComfyUI 샘플링 스텝 업데이트 */
  setSampling: (step: number | null, total: number | null) => void;

  /** Lightning 토글 */
  applyLightning: (on: boolean) => void;
}

export const useGenerateStore = create<GenerateState>()(
  persist(
    (set) => {
      const defaultAspect = GENERATE_MODEL.defaults.aspect;
      const defaultPreset = getAspect(defaultAspect);
      return {
        prompt: "",
        aspect: defaultAspect,
        width: defaultPreset.width,
        height: defaultPreset.height,
        aspectLocked: true,
        research: true,
        lightning: false,

        generating: false,
        progress: 0,
        stage: "",
        stageHistory: [],
        startedAt: null,
        samplingStep: null,
        samplingTotal: null,

        setPrompt: (v) => set({ prompt: v }),
        setAspect: (v) =>
          set((s) => {
            // custom 은 비율 자체가 없으니 현재 사이즈 유지 + aspect 라벨만 변경
            if (v === "custom") return { aspect: v };
            const preset = getAspect(v);
            // 비율 잠금 ON: 현재 width 유지 + 새 비율로 height 재계산
            //   기존엔 프리셋 기본값(예: 1664×928)으로 가로·세로 모두 덮어써서 사용자 입력이 날아감.
            //   비율잠금 의미를 "내가 정한 가로 유지" 로 일관되게 해석.
            if (s.aspectLocked) {
              const ratio = preset.width / preset.height;
              const newH = snapDimension(s.width / ratio);
              return { aspect: v, width: s.width, height: newH };
            }
            // 비율 잠금 OFF: 프리셋 기본값 그대로 적용 (기존 동작)
            return { aspect: v, width: preset.width, height: preset.height };
          }),
        setWidth: (v) =>
          set((s) => {
            const newW = snapDimension(v);
            if (!s.aspectLocked)
              return { width: newW, aspect: matchAspect(newW, s.height) };
            // 비율 잠금: aspect 는 그대로 유지 (snap 오차로 "custom" 되는 것 방지)
            const ratio = s.width / s.height || 1;
            const newH = snapDimension(newW / ratio);
            return { width: newW, height: newH };
          }),
        setHeight: (v) =>
          set((s) => {
            const newH = snapDimension(v);
            if (!s.aspectLocked)
              return { height: newH, aspect: matchAspect(s.width, newH) };
            // 비율 잠금: aspect 는 그대로 유지
            const ratio = s.width / s.height || 1;
            const newW = snapDimension(newH * ratio);
            return { width: newW, height: newH };
          }),
        setDimensions: (w, h) => {
          const newW = snapDimension(w);
          const newH = snapDimension(h);
          set({ width: newW, height: newH, aspect: matchAspect(newW, newH) });
        },
        setAspectLocked: (v) => set({ aspectLocked: v }),
        setResearch: (v) => set({ research: v }),
        setRunning: (generating, progress = 0, stage = "") =>
          set((s) => {
            // 새 세션 시작(generating=true + progress=0) 이면 시작 시각 기록 + 상태 초기화
            const freshStart = generating && progress === 0;
            return {
              generating,
              progress,
              stage,
              stageHistory: freshStart ? [] : s.stageHistory,
              startedAt: freshStart ? Date.now() : s.startedAt,
              samplingStep: freshStart ? null : s.samplingStep,
              samplingTotal: freshStart ? null : s.samplingTotal,
            };
          }),
        resetRunning: () =>
          set({
            generating: false,
            progress: 0,
            stage: "",
            startedAt: null,
            samplingStep: null,
            samplingTotal: null,
          }),
        pushStage: (evt) =>
          set((s) => ({
            stageHistory: [
              ...s.stageHistory,
              { ...evt, arrivedAt: Date.now() },
            ],
          })),
        setSampling: (step, total) =>
          set({ samplingStep: step, samplingTotal: total }),

        applyLightning: (on) => set({ lightning: on }),
      };
    },
    {
      name: "ais:generate",
      storage: createJSONStorage(() => localStorage),
      version: 4,
      // v3 → v4: prompt 영속 제거. 프롬프트는 히스토리/템플릿에서 복원.
      // v2 → v3: steps/cfg/seed 필드 제거 (UI 삭제에 맞춰 store 정리)
      // v1 → v2: width/height/aspectLocked 신규 필드 추가
      migrate: (persistedState: unknown, version: number) => {
        let state = persistedState as Record<string, unknown>;
        if (version < 2) {
          const preset = getAspect(
            (state.aspect as AspectRatioLabel | undefined) ??
              GENERATE_MODEL.defaults.aspect,
          );
          state = {
            ...state,
            width: preset.width,
            height: preset.height,
            aspectLocked: true,
          };
        }
        if (version < 3) {
          // steps/cfg/seed 는 더 이상 persist 안 함 — 옛 값 제거
          const { steps, cfg, seed, ...rest } = state;
          void steps;
          void cfg;
          void seed;
          state = rest;
        }
        if (version < 4) {
          const { prompt, ...rest } = state;
          void prompt;
          state = rest;
        }
        return state;
      },
      // 진행 상태 제외 (영속 X)
      partialize: (s) => ({
        aspect: s.aspect,
        width: s.width,
        height: s.height,
        aspectLocked: s.aspectLocked,
        research: s.research,
        lightning: s.lightning,
      }),
    },
  ),
);

/** W/H 가 기존 프리셋 중 하나와 동일하면 라벨 매칭, 아니면 "custom". */
function matchAspect(w: number, h: number): AspectValue {
  const match = ASPECT_RATIOS.find((r) => r.width === w && r.height === h);
  return match?.label ?? "custom";
}
