/**
 * useVisionCompareStore — Vision Compare 페이지(/vision/compare) 상태.
 * 2026-04-24 신설.
 *
 * - 완전 휘발 (persist X): 페이지 떠나면 모두 초기화
 * - imageA / imageB: dataURL · 사용자가 임의로 업로드한 두 이미지
 * - viewerMode: 슬라이더 vs 나란히 토글 (비율 다르면 자동 나란히 권장)
 * - analysis: VisionCompareAnalysis | null (분석 결과 인메모리 보관)
 */

"use client";

import { create } from "zustand";
import type { VisionCompareAnalysis } from "@/lib/api/types";
import type { StageEvent } from "@/stores/useGenerateStore";

export type CompareViewerMode = "slider" | "sidebyside";

export interface VisionCompareImage {
  /** dataURL (FileReader.readAsDataURL 결과) 또는 절대 URL */
  dataUrl: string;
  /** 파일명 (UI 라벨 표시용) */
  label: string;
  /** PIL 측정 전이라 클라이언트에서 Image 객체로 측정 */
  width: number;
  height: number;
}

export interface VisionCompareState {
  imageA: VisionCompareImage | null;
  imageB: VisionCompareImage | null;
  /** 사용자 비교 지시 (선택 · 빈 문자열 OK) */
  hint: string;
  /** 분석 진행 중 여부 (CTA 비활성/스피너용) */
  running: boolean;
  /** 마지막 분석 결과 (페이지 떠나면 사라짐 · DB 저장 X) */
  analysis: VisionCompareAnalysis | null;
  /** 뷰어 모드 토글 */
  viewerMode: CompareViewerMode;
  /** Phase 6 (2026-04-27): SSE stage 이벤트 누적 — PipelineTimeline mode="compare". */
  stageHistory: StageEvent[];

  /* actions */
  setImageA: (img: VisionCompareImage | null) => void;
  setImageB: (img: VisionCompareImage | null) => void;
  swapImages: () => void;
  setHint: (v: string) => void;
  setRunning: (v: boolean) => void;
  setAnalysis: (a: VisionCompareAnalysis | null) => void;
  setViewerMode: (m: CompareViewerMode) => void;
  /** Phase 6: 백엔드 stage 이벤트 도착 시 호출. */
  pushStage: (e: StageEvent) => void;
  /** Phase 6: 새 분석 시작 시 stageHistory 초기화. */
  resetStages: () => void;
  /** 페이지 진입/리셋 시 초기 상태 복원 */
  reset: () => void;
}

export const useVisionCompareStore = create<VisionCompareState>()((set, get) => ({
  imageA: null,
  imageB: null,
  hint: "",
  running: false,
  analysis: null,
  viewerMode: "slider",
  stageHistory: [],

  setImageA: (img) =>
    set({
      imageA: img,
      // 새 이미지 로드 시 이전 분석 결과 초기화 (다른 비교라 의미 없음)
      analysis: null,
    }),

  setImageB: (img) =>
    set({
      imageB: img,
      analysis: null,
    }),

  swapImages: () => {
    const { imageA, imageB } = get();
    set({ imageA: imageB, imageB: imageA, analysis: null });
  },

  setHint: (v) => set({ hint: v }),
  setRunning: (v) => set({ running: v }),
  setAnalysis: (a) => set({ analysis: a }),
  setViewerMode: (m) => set({ viewerMode: m }),

  pushStage: (e) => set((s) => ({ stageHistory: [...s.stageHistory, e] })),
  resetStages: () => set({ stageHistory: [] }),

  reset: () =>
    set({
      imageA: null,
      imageB: null,
      hint: "",
      running: false,
      analysis: null,
      viewerMode: "slider",
      stageHistory: [],
    }),
}));
