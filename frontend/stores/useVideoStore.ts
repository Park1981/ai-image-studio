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
import type { StageEvent } from "@/lib/stage";
// Phase 3 stage slice 추출 (refactor doc 2026-04-30 §I3) — 3 store 공통.
import {
  STAGE_INITIAL_STATE,
  createStageActions,
  type StageSliceState,
} from "@/stores/createStageSlice";

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

// stage slice 5 필드 (stageHistory / startedAt / samplingStep / samplingTotal) 는
// StageSliceState 에서 inherit. createStageActions 가 pushStage / setSampling 제공.
export interface VideoState extends StageSliceState {
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

  /**
   * gemma4 보강 모드 (Phase 2 · 2026-05-01) · session-only.
   * VideoLeftPanel 마운트 시 settings.promptEnhanceMode 로 init sync.
   */
  promptMode: "fast" | "precise";

  /* 파이프라인 상태 (Video 만의 추가 — stage slice 5 필드는 위에서 inherit) */
  running: boolean;
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
  /** Phase 2 (2026-05-01): gemma4 보강 모드 토글 */
  setPromptMode: (v: "fast" | "precise") => void;
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
  // 2026-05-01: default OFF 로 변경 (영상 사용자는 영문 프롬프트 직접 다듬어 쓰는 경향).
  // skipUpgrade=true → AI 보정 우회 (gemma4/vision 호출 X · ~15초 절약).
  skipUpgrade: true,
  // Phase 2 (2026-05-01) — settings 의 default 가 마운트 시 sync.
  promptMode: "fast",

  running: false,
  pipelineProgress: 0,
  pipelineLabel: "",

  // stage slice 5 필드 + 2 액션 (lib/stage.ts + createStageSlice.ts) — 3 store 공통.
  ...STAGE_INITIAL_STATE,
  ...createStageActions<VideoState>(set),

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
  setPromptMode: (v) => set({ promptMode: v }),

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

  // pushStage / setSampling 은 createStageActions 가 위에서 주입.

  setPipelineProgress: (progress, label) =>
    set((s) => ({
      pipelineProgress: progress,
      pipelineLabel: label ?? s.pipelineLabel,
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
      // Phase 2 (2026-05-01) — gemma4 보강 모드
      promptMode: s.promptMode,
      setPromptMode: s.setPromptMode,
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
