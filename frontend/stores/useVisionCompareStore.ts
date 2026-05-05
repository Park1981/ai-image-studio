/**
 * useVisionCompareStore — Vision Compare 페이지(/vision/compare) 상태.
 *
 * 2026-04-24 신설. 2026-05-05 V4 갱신 (Task 17):
 *   - 옛 5축 score 결과 폐기 → VisionCompareAnalysisV4 (2-stage observe + diff_synthesize).
 *   - perImagePrompt 휘발 캐시 (이미지별 t2i prompt on-demand 합성 결과).
 *   - 전역 inFlight 직렬화 표시 — 같은 시점에 한 이미지만 합성 진행 중.
 *
 * 정책:
 *   - 완전 휘발 (persist X): 페이지 떠나면 모두 초기화.
 *   - imageA / imageB: dataURL · 사용자가 임의로 업로드한 두 이미지.
 *   - viewerMode: 슬라이더 vs 나란히 토글 (비율 다르면 자동 나란히 권장).
 *   - analysis: VisionCompareAnalysisV4 | null (분석 결과 인메모리 보관).
 *   - perImagePrompt: image1/image2 별 합성 결과 캐시 + 전역 inFlight 한 슬롯.
 */

"use client";

import { create } from "zustand";
import type { VisionCompareAnalysisV4 } from "@/lib/api/types";
import type { StageEvent } from "@/lib/stage";

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

/**
 * Per-image prompt 합성 결과 (backend `PerImagePromptResponse` 미러).
 * 백엔드 snake_case 그대로 (단일 응답 endpoint · 자동 변환 없음).
 */
export interface PerImagePromptResult {
  summary: string;
  positive_prompt: string;
  negative_prompt: string;
  key_visual_anchors: string[];
  uncertain: string[];
}

export type PerImageWhich = "image1" | "image2";

export interface PerImagePromptState {
  image1: PerImagePromptResult | null;
  image2: PerImagePromptResult | null;
  /** 전역 직렬화 — 한 시점에 한 이미지만 합성 진행 가능. */
  inFlight: PerImageWhich | null;
}

const EMPTY_PER_IMAGE_PROMPT: PerImagePromptState = {
  image1: null,
  image2: null,
  inFlight: null,
};

export interface VisionCompareState {
  imageA: VisionCompareImage | null;
  imageB: VisionCompareImage | null;
  /** 사용자 비교 지시 (선택 · 빈 문자열 OK) */
  hint: string;
  /** 분석 진행 중 여부 (CTA 비활성/스피너용) */
  running: boolean;
  /** 마지막 분석 결과 (페이지 떠나면 사라짐 · DB 저장 X) */
  analysis: VisionCompareAnalysisV4 | null;
  /** 뷰어 모드 토글 */
  viewerMode: CompareViewerMode;
  /** SSE stage 이벤트 누적 — PipelineTimeline mode="compare". */
  stageHistory: StageEvent[];
  /** Per-image t2i prompt 합성 결과 캐시 + 전역 inFlight 직렬화. */
  perImagePrompt: PerImagePromptState;

  /* actions */
  setImageA: (img: VisionCompareImage | null) => void;
  setImageB: (img: VisionCompareImage | null) => void;
  swapImages: () => void;
  setHint: (v: string) => void;
  setRunning: (v: boolean) => void;
  setAnalysis: (a: VisionCompareAnalysisV4 | null) => void;
  setViewerMode: (m: CompareViewerMode) => void;
  /** 백엔드 stage 이벤트 도착 시 호출. */
  pushStage: (e: StageEvent) => void;
  /** 새 분석 시작 시 stageHistory 초기화. */
  resetStages: () => void;
  /** Per-image prompt 합성 결과 저장 (image1 또는 image2). */
  setPerImagePrompt: (which: PerImageWhich, result: PerImagePromptResult) => void;
  /** Per-image 합성 진행 중 표시 (전역 직렬화). null = idle. */
  setPerImageInFlight: (which: PerImageWhich | null) => void;
  /** 새 메인 분석 시작 시 호출 — 캐시 + inFlight 모두 초기화. */
  clearPerImagePrompts: () => void;
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
  perImagePrompt: { ...EMPTY_PER_IMAGE_PROMPT },

  setImageA: (img) =>
    set({
      imageA: img,
      // 새 이미지 로드 시 이전 분석 + 합성 캐시 초기화 (다른 비교라 의미 없음)
      analysis: null,
      perImagePrompt: { ...EMPTY_PER_IMAGE_PROMPT },
    }),

  setImageB: (img) =>
    set({
      imageB: img,
      analysis: null,
      perImagePrompt: { ...EMPTY_PER_IMAGE_PROMPT },
    }),

  swapImages: () => {
    const { imageA, imageB } = get();
    set({
      imageA: imageB,
      imageB: imageA,
      analysis: null,
      perImagePrompt: { ...EMPTY_PER_IMAGE_PROMPT },
    });
  },

  setHint: (v) => set({ hint: v }),
  setRunning: (v) => set({ running: v }),
  setAnalysis: (a) => set({ analysis: a }),
  setViewerMode: (m) => set({ viewerMode: m }),

  pushStage: (e) => set((s) => ({ stageHistory: [...s.stageHistory, e] })),
  resetStages: () => set({ stageHistory: [] }),

  setPerImagePrompt: (which, result) =>
    set((s) => ({
      perImagePrompt: {
        ...s.perImagePrompt,
        [which]: result,
        // 합성 끝나면 inFlight 해제 (해당 슬롯이 진행 중이었던 경우)
        inFlight: s.perImagePrompt.inFlight === which ? null : s.perImagePrompt.inFlight,
      },
    })),

  setPerImageInFlight: (which) =>
    set((s) => ({
      perImagePrompt: { ...s.perImagePrompt, inFlight: which },
    })),

  clearPerImagePrompts: () =>
    set({ perImagePrompt: { ...EMPTY_PER_IMAGE_PROMPT } }),

  reset: () =>
    set({
      imageA: null,
      imageB: null,
      hint: "",
      running: false,
      analysis: null,
      viewerMode: "slider",
      stageHistory: [],
      perImagePrompt: { ...EMPTY_PER_IMAGE_PROMPT },
    }),
}));
