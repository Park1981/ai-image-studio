/**
 * useEditStore - 수정 모드 입력/파이프라인 상태.
 * sourceImage 는 data URL (업로드) 또는 히스토리에서 선택한 imageRef.
 * 영속 안 함 (세션 한정) — 이미지 바이너리 커서 localStorage 가 빠르게 참.
 */

"use client";

import { create } from "zustand";
import type { EditVisionAnalysis } from "@/lib/api/types";

export interface EditStepDetail {
  n: 1 | 2 | 3 | 4;
  startedAt: number;
  doneAt: number | null;
  /** step 1 에서 받은 vision 설명 */
  description?: string;
  /** step 2 에서 받은 최종 프롬프트 (영문) */
  finalPrompt?: string;
  /** step 2 에서 받은 한국어 번역 (v2 · 2026-04-23) */
  finalPromptKo?: string | null;
  /** step 2 provider (ollama/fallback) */
  provider?: string;
}

export interface EditState {
  /** data URL (업로드) 또는 히스토리 imageRef */
  sourceImage: string | null;
  /** 화면 표시용 파일명/라벨 */
  sourceLabel: string;
  /** 화면 표시용 원본 사이즈 */
  sourceWidth: number | null;
  sourceHeight: number | null;

  prompt: string;
  lightning: boolean;

  // 파이프라인 상태
  running: boolean;
  /** 현재 완료된 step (0 = 시작 전, 1~4 = 각 단계 완료) */
  stepDone: number;
  currentStep: 1 | 2 | 3 | 4 | null;
  /** 진행 모달용 상세 타임라인 */
  stepHistory: EditStepDetail[];
  /** 실행 시작 시각 (ms since epoch) — 경과 시간 계산용 */
  startedAt: number | null;
  /** ComfyUI 샘플러 현재 스텝 */
  samplingStep: number | null;
  /** ComfyUI 샘플러 총 스텝 */
  samplingTotal: number | null;
  /** 백엔드 stage.progress (0~100) — ProgressModal 상단 진행바가 이 값을 그대로 표시 */
  pipelineProgress: number;
  pipelineLabel: string;

  // 비교 슬라이더
  compareX: number;

  /**
   * Edit 비전 구조 분석 (Phase 1 · 2026-04-25 · 휘발).
   * SSE step 1 done 에서 수신한 구조 JSON. resetPipeline 으로 초기화.
   * persist X — 새로고침/세션 종료 시 사라짐 (Vision Compare 패턴).
   */
  editVisionAnalysis: EditVisionAnalysis | null;

  // actions
  setSource: (
    image: string | null,
    label?: string,
    w?: number,
    h?: number,
  ) => void;
  setPrompt: (v: string) => void;
  setLightning: (v: boolean) => void;
  setRunning: (running: boolean) => void;
  setStep: (step: 1 | 2 | 3 | 4 | null, done: boolean) => void;
  /** n 만 필수. 나머지는 부분 업데이트 — 기존 필드 (특히 startedAt) 는 머지에서 보존. */
  recordStepDetail: (
    detail: Partial<EditStepDetail> & { n: EditStepDetail["n"] },
  ) => void;
  setCompareX: (v: number) => void;
  setPipelineProgress: (progress: number, label?: string) => void;
  /** Phase 1: step 1 done 에서 받은 구조 분석 저장 (휘발). */
  setEditVisionAnalysis: (analysis: EditVisionAnalysis | null) => void;
  resetPipeline: () => void;
  /** ComfyUI 샘플링 스텝 업데이트 */
  setSampling: (step: number | null, total: number | null) => void;
}

export const useEditStore = create<EditState>((set) => ({
  sourceImage: null,
  sourceLabel: "이미지를 업로드하거나 히스토리에서 선택",
  sourceWidth: null,
  sourceHeight: null,

  prompt: "",
  lightning: false,

  running: false,
  stepDone: 0,
  currentStep: null,
  stepHistory: [],
  startedAt: null,
  samplingStep: null,
  samplingTotal: null,
  pipelineProgress: 0,
  pipelineLabel: "",

  compareX: 50,

  editVisionAnalysis: null,

  setSource: (image, label, w, h) =>
    set({
      sourceImage: image,
      sourceLabel: label ?? "이미지를 업로드하거나 히스토리에서 선택",
      sourceWidth: w ?? null,
      sourceHeight: h ?? null,
    }),
  setPrompt: (v) => set({ prompt: v }),
  setLightning: (v) => set({ lightning: v }),
  setRunning: (running) =>
    set(
      running
        ? {
            running,
            stepDone: 0,
            currentStep: 1,
            stepHistory: [],
            startedAt: Date.now(),
            samplingStep: null,
            samplingTotal: null,
            pipelineProgress: 0,
            pipelineLabel: "초기화",
            // 새 실행 시작 시 이전 분석 결과 비움
            editVisionAnalysis: null,
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
        // done 도착 시 완료 시각 + 상세 merge. 기존 startedAt 을 후순위로 두지 않기 위해
        // detail 먼저, 그 위에 x.startedAt 을 다시 덮어 보존.
        return {
          stepHistory: s.stepHistory.map((x) =>
            x.n === detail.n ? { ...x, ...detail, startedAt: x.startedAt } : x,
          ),
        };
      }
      // 새 엔트리 — startedAt 없으면 현재 시각 기본.
      const fresh: EditStepDetail = {
        startedAt: Date.now(),
        doneAt: null,
        ...detail,
        n: detail.n,
      };
      return { stepHistory: [...s.stepHistory, fresh] };
    }),
  setCompareX: (v) => set({ compareX: v }),
  setEditVisionAnalysis: (analysis) => set({ editVisionAnalysis: analysis }),
  setPipelineProgress: (progress, label) =>
    set((s) => ({
      pipelineProgress: progress,
      pipelineLabel: label ?? s.pipelineLabel,
    })),
  resetPipeline: () =>
    set({
      running: false,
      stepDone: 0,
      currentStep: null,
      stepHistory: [],
      startedAt: null,
      samplingStep: null,
      samplingTotal: null,
      pipelineProgress: 0,
      pipelineLabel: "",
    }),
  setSampling: (step, total) =>
    set({ samplingStep: step, samplingTotal: total }),
}));
