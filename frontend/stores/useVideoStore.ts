/**
 * useVideoStore — LTX-2.3 i2v 페이지(/video) 상태.
 * 2026-04-24 · V5.
 *
 * persist 안 함 — mp4 파일 크고 히스토리는 서버 DB 담당.
 *
 * 2026-04-27 (Phase 3 진행 모달 store 통일):
 *   stepDone/currentStep/stepHistory/VideoStepDetail 제거 → stageHistory: StageEvent[].
 *   백엔드 stage emit payload (description / finalPrompt / provider 등) 를
 *   pushStage 로 stageHistory 에 그대로 보관 — PipelineTimeline 의 StageDef.renderDetail 사용.
 *   step emit 은 백엔드가 transitional 로 보내지만 store 에선 무시 (Phase 4 정리).
 */

"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { StageEvent } from "@/stores/useGenerateStore";

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

  /**
   * Lightning 4-step 초고속 모드 (2026-04-24 · v10).
   * ON  (기본) — 5분 내외 · distilled LoRA · 얼굴 drift 가능
   * OFF        — 20분+ · full 30-step · 얼굴 보존 최강
   */
  lightning: boolean;

  /** AI 프롬프트 보정 (vision + gemma4) 우회 — true 면 prompt 를 preUpgradedPrompt 로 그대로 전송.
   *  사용자가 이미 정제된 영문 프롬프트를 복사해서 붙여넣은 케이스용. default false. */
  skipUpgrade: boolean;

  /* 파이프라인 상태 (세션 한정) */
  running: boolean;
  /** 진행 모달용 stage 이벤트 타임라인 (Phase 3 통일).
   *  백엔드 emit("stage", {...}) 가 도착할 때마다 push.
   *  같은 type 진입 + 완료로 두 번 들어오면 byType Map 이 후자 (payload 풍부) 로 덮어씀. */
  stageHistory: StageEvent[];
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
  setLightning: (v: boolean) => void;
  setSkipUpgrade: (v: boolean) => void;
  setRunning: (running: boolean) => void;
  setSampling: (step: number | null, total: number | null) => void;
  setPipelineProgress: (progress: number, label?: string) => void;
  /** Phase 3: stage 이벤트 도착 시 호출. arrivedAt 자동 부여. */
  pushStage: (evt: Omit<StageEvent, "arrivedAt">) => void;
  setLastVideoRef: (ref: string | null) => void;
  resetPipeline: () => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  sourceImage: null,
  sourceLabel: "이미지를 업로드하거나 히스토리에서 선택",
  sourceWidth: null,
  sourceHeight: null,

  prompt: "",
  adult: false,
  longerEdge: VIDEO_LONGER_EDGE_DEFAULT,
  lightning: true,
  skipUpgrade: false,

  running: false,
  stageHistory: [],
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

  setLightning: (v) => set({ lightning: v }),

  setSkipUpgrade: (v) => set({ skipUpgrade: v }),

  setRunning: (running) =>
    set(
      running
        ? {
            running,
            stageHistory: [],
            startedAt: Date.now(),
            samplingStep: null,
            samplingTotal: null,
            pipelineProgress: 0,
            pipelineLabel: "초기화",
          }
        : { running },
    ),

  setSampling: (step, total) =>
    set({ samplingStep: step, samplingTotal: total }),

  setPipelineProgress: (progress, label) =>
    set((s) => ({
      pipelineProgress: progress,
      pipelineLabel: label ?? s.pipelineLabel,
    })),

  pushStage: (evt) =>
    set((s) => ({
      stageHistory: [...s.stageHistory, { ...evt, arrivedAt: Date.now() }],
    })),

  setLastVideoRef: (ref) => set({ lastVideoRef: ref }),

  resetPipeline: () =>
    set({
      running: false,
      stageHistory: [],
      startedAt: null,
      samplingStep: null,
      samplingTotal: null,
      pipelineProgress: 0,
      pipelineLabel: "",
    }),
}));

/* ──────────── 그룹 selectors (task #8 · 2026-04-26) ──────────── */

/** 입력 + 액션 (좌측 패널) */
export const useVideoInputs = () =>
  useVideoStore(
    useShallow((s) => ({
      sourceImage: s.sourceImage,
      sourceLabel: s.sourceLabel,
      sourceWidth: s.sourceWidth,
      sourceHeight: s.sourceHeight,
      setSource: s.setSource,
      prompt: s.prompt,
      setPrompt: s.setPrompt,
      adult: s.adult,
      setAdult: s.setAdult,
      longerEdge: s.longerEdge,
      setLongerEdge: s.setLongerEdge,
      lightning: s.lightning,
      setLightning: s.setLightning,
      skipUpgrade: s.skipUpgrade,
      setSkipUpgrade: s.setSkipUpgrade,
    })),
  );

/** 진행 상태 */
export const useVideoRunning = () =>
  useVideoStore(
    useShallow((s) => ({
      running: s.running,
      pipelineProgress: s.pipelineProgress,
      pipelineLabel: s.pipelineLabel,
    })),
  );
