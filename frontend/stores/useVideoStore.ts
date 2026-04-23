/**
 * useVideoStore — LTX-2.3 i2v 페이지(/video) 상태.
 * 2026-04-24 · V5.
 *
 * Edit 스토어와 구조가 거의 동일 (5-step 파이프라인).
 * persist 안 함 — mp4 파일 크고 히스토리는 서버 DB 담당.
 */

"use client";

import { create } from "zustand";

// ── 영상 해상도 슬라이더 범위 (backend presets.py 와 동기화) ──
export const VIDEO_LONGER_EDGE_MIN = 512;
export const VIDEO_LONGER_EDGE_MAX = 1536;
export const VIDEO_LONGER_EDGE_STEP = 128;
export const VIDEO_LONGER_EDGE_DEFAULT = 1536;

/** 원본 비율 유지 · 긴 변을 longer 로 맞춘 (w, h). 8배수 스냅. */
export function computeVideoResize(
  sourceWidth: number,
  sourceHeight: number,
  longer: number,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) return { width: 0, height: 0 };
  let w: number, h: number;
  if (sourceWidth >= sourceHeight) {
    w = longer;
    h = Math.round((longer * sourceHeight) / sourceWidth);
  } else {
    h = longer;
    w = Math.round((longer * sourceWidth) / sourceHeight);
  }
  w = Math.max(8, Math.floor(w / 8) * 8);
  h = Math.max(8, Math.floor(h / 8) * 8);
  return { width: w, height: h };
}

export interface VideoStepDetail {
  n: 1 | 2 | 3 | 4 | 5;
  startedAt: number;
  doneAt: number | null;
  /** step 1 비전 설명 */
  description?: string;
  /** step 2 최종 LTX 프롬프트 (영문) */
  finalPrompt?: string;
  /** step 2 한국어 번역 */
  finalPromptKo?: string | null;
  /** step 2 provider (ollama/fallback) */
  provider?: string;
}

export interface VideoState {
  /** data URL (업로드) 또는 히스토리 imageRef */
  sourceImage: string | null;
  sourceLabel: string;
  sourceWidth: number | null;
  sourceHeight: number | null;

  prompt: string;
  /**
   * 성인 모드 토글 (2026-04-24 · v8).
   * ON  → gemma4 시스템 프롬프트에 NSFW clause 주입 + eros LoRA 체인 포함
   * OFF → distilled LoRA 만 · SFW 프롬프트 (얼굴 보존 안정)
   */
  adult: boolean;

  /**
   * 영상 해상도 · 긴 변 픽셀 (2026-04-24 · v9).
   * 512 ~ 1536 (step 128). 원본 비율 유지하며 긴 변만 이 값으로 스케일.
   * 작을수록 빠름 (시간 ≈ 픽셀수 제곱).
   */
  longerEdge: number;

  /* 파이프라인 상태 (세션 한정) */
  running: boolean;
  currentStep: 1 | 2 | 3 | 4 | 5 | null;
  stepDone: number; // 0=시작 전, 1~5 단계 완료
  stepHistory: VideoStepDetail[];
  startedAt: number | null;
  samplingStep: number | null;
  samplingTotal: number | null;
  pipelineProgress: number; // 0~100
  pipelineLabel: string;

  /** 완료된 영상 mp4 URL (세션) */
  lastVideoRef: string | null;

  /* actions */
  setSource: (
    image: string | null,
    label?: string,
    w?: number,
    h?: number,
  ) => void;
  setPrompt: (v: string) => void;
  setAdult: (v: boolean) => void;
  setLongerEdge: (v: number) => void;
  setRunning: (running: boolean) => void;
  setStep: (step: 1 | 2 | 3 | 4 | 5 | null, done: boolean) => void;
  recordStepDetail: (detail: VideoStepDetail) => void;
  setSampling: (step: number | null, total: number | null) => void;
  setPipelineProgress: (progress: number, label?: string) => void;
  setLastVideoRef: (ref: string | null) => void;
  resetPipeline: () => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  sourceImage: null,
  sourceLabel: "이미지를 업로드하거나 히스토리에서 선택",
  sourceWidth: null,
  sourceHeight: null,

  prompt: "피사체는 그대로 유지. 부드러운 창가 빛과 느린 달리 인, 잔잔한 앰비언스.",
  adult: false,
  longerEdge: VIDEO_LONGER_EDGE_DEFAULT,

  running: false,
  currentStep: null,
  stepDone: 0,
  stepHistory: [],
  startedAt: null,
  samplingStep: null,
  samplingTotal: null,
  pipelineProgress: 0,
  pipelineLabel: "",

  lastVideoRef: null,

  setSource: (image, label, w, h) =>
    set({
      sourceImage: image,
      sourceLabel: label ?? "이미지를 업로드하거나 히스토리에서 선택",
      sourceWidth: w ?? null,
      sourceHeight: h ?? null,
    }),

  setPrompt: (v) => set({ prompt: v }),

  setAdult: (v) => set({ adult: v }),

  setLongerEdge: (v) => {
    // 범위 + 8배수 스냅
    const clamped = Math.max(
      VIDEO_LONGER_EDGE_MIN,
      Math.min(VIDEO_LONGER_EDGE_MAX, Math.floor(v / 8) * 8),
    );
    set({ longerEdge: clamped });
  },

  setRunning: (running) =>
    set(
      running
        ? {
            running,
            currentStep: 1,
            stepDone: 0,
            stepHistory: [],
            startedAt: Date.now(),
            samplingStep: null,
            samplingTotal: null,
            pipelineProgress: 0,
            pipelineLabel: "초기화",
          }
        : { running },
    ),

  setStep: (step, done) =>
    set({
      currentStep: step,
      stepDone: done ? (step ?? 0) : step ? step - 1 : 0,
    }),

  recordStepDetail: (detail) =>
    set((s) => {
      const existing = s.stepHistory.find((x) => x.n === detail.n);
      if (existing) {
        return {
          stepHistory: s.stepHistory.map((x) =>
            x.n === detail.n ? { ...x, ...detail } : x,
          ),
        };
      }
      return { stepHistory: [...s.stepHistory, detail] };
    }),

  setSampling: (step, total) =>
    set({ samplingStep: step, samplingTotal: total }),

  setPipelineProgress: (progress, label) =>
    set((s) => ({
      pipelineProgress: progress,
      pipelineLabel: label ?? s.pipelineLabel,
    })),

  setLastVideoRef: (ref) => set({ lastVideoRef: ref }),

  resetPipeline: () =>
    set({
      running: false,
      currentStep: null,
      stepDone: 0,
      stepHistory: [],
      startedAt: null,
      samplingStep: null,
      samplingTotal: null,
      pipelineProgress: 0,
      pipelineLabel: "",
    }),
}));
