/**
 * useEditStore - 수정 모드 입력/파이프라인 상태.
 * sourceImage 는 data URL (업로드) 또는 히스토리에서 선택한 imageRef.
 * 영속 안 함 (세션 한정) — 이미지 바이너리 커서 localStorage 가 빠르게 참.
 */

"use client";

import { create } from "zustand";

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

  // 비교 슬라이더
  compareX: number;

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
  setCompareX: (v: number) => void;
  resetPipeline: () => void;
}

export const useEditStore = create<EditState>((set) => ({
  sourceImage: null,
  sourceLabel: "이미지를 업로드하거나 히스토리에서 선택",
  sourceWidth: null,
  sourceHeight: null,

  prompt: "배경을 바다로 바꿔줘. 오후의 햇살이 물결에 반사되도록.",
  lightning: false,

  running: false,
  stepDone: 0,
  currentStep: null,

  compareX: 50,

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
    set(running ? { running, stepDone: 0, currentStep: 1 } : { running }),
  setStep: (step, done) =>
    set({
      currentStep: step,
      stepDone: done ? (step ?? 0) : step ? step - 1 : 0,
    }),
  setCompareX: (v) => set({ compareX: v }),
  resetPipeline: () =>
    set({ running: false, stepDone: 0, currentStep: null }),
}));
