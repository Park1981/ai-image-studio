/**
 * useVideoLabStore — isolated state for /lab/video.
 */

"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { StageEvent } from "@/lib/stage";
import {
  LAB_LTX_SULPHUR_PRESET,
  getLabLoraOption,
} from "@/lib/lab-presets";
import {
  VIDEO_LONGER_EDGE_DEFAULT,
  VIDEO_LONGER_EDGE_MAX,
  VIDEO_LONGER_EDGE_MIN,
} from "@/stores/useVideoStore";
import {
  STAGE_INITIAL_STATE,
  createStageActions,
  type StageSliceState,
} from "@/stores/createStageSlice";

type PromptMode = "fast" | "precise";

export interface VideoLabPairRefs {
  wan22?: string | null;
  sulphur?: string | null;
}

export interface VideoLabState extends StageSliceState {
  sourceImage: string | null;
  sourceLabel: string;
  sourceWidth: number | null;
  sourceHeight: number | null;
  prompt: string;
  presetId: string;
  activeLoraIds: string[];
  loraStrengths: Record<string, number>;
  longerEdge: number;
  longerEdgeUserOverride: boolean;
  lightning: boolean;
  skipUpgrade: boolean;
  promptMode: PromptMode;
  running: boolean;
  pipelineProgress: number;
  pipelineLabel: string;
  lastError: string | null;
  lastVideoRef: string | null;
  lastPairRefs: VideoLabPairRefs | null;

  setSource: (
    image: string | null,
    label?: string,
    w?: number,
    h?: number,
  ) => void;
  setPrompt: (v: string) => void;
  setDistillVariant: (id: string) => void;
  setLoraActive: (id: string, active: boolean) => void;
  setLoraStrength: (id: string, value: number) => void;
  setLongerEdge: (v: number) => void;
  setLightning: (v: boolean) => void;
  setSkipUpgrade: (v: boolean) => void;
  setPromptMode: (v: PromptMode) => void;
  setRunning: (running: boolean) => void;
  setSampling: (step: number | null, total: number | null) => void;
  setPipelineProgress: (progress: number, label?: string) => void;
  pushStage: (evt: Omit<StageEvent, "arrivedAt">) => void;
  setLastError: (message: string | null) => void;
  setLastVideoRef: (ref: string | null) => void;
  setLastPairRefs: (refs: VideoLabPairRefs | null) => void;
  resetPipeline: () => void;
}

const DEFAULT_ACTIVE_LORAS = ["distill_sulphur", "adult_sulphur"];

function defaultStrengths(): Record<string, number> {
  return Object.fromEntries(
    LAB_LTX_SULPHUR_PRESET.loraOptions.map((option) => [
      option.id,
      option.defaultStrength,
    ]),
  );
}

function clampStrength(id: string, value: number): number {
  const option = getLabLoraOption(id);
  if (!option) return value;
  return Math.max(option.strengthMin, Math.min(option.strengthMax, value));
}

function snapLongerEdge(value: number): number {
  return Math.max(
    VIDEO_LONGER_EDGE_MIN,
    Math.min(VIDEO_LONGER_EDGE_MAX, Math.floor(value / 8) * 8),
  );
}

export const useVideoLabStore = create<VideoLabState>((set) => ({
  sourceImage: null,
  sourceLabel: "이미지를 업로드하거나 히스토리에서 선택",
  sourceWidth: null,
  sourceHeight: null,
  prompt: "",
  presetId: LAB_LTX_SULPHUR_PRESET.id,
  activeLoraIds: DEFAULT_ACTIVE_LORAS,
  loraStrengths: defaultStrengths(),
  longerEdge: VIDEO_LONGER_EDGE_DEFAULT,
  longerEdgeUserOverride: false,
  lightning: true,
  skipUpgrade: true,
  promptMode: "fast",
  running: false,
  pipelineProgress: 0,
  pipelineLabel: "",
  lastError: null,
  ...STAGE_INITIAL_STATE,
  ...createStageActions<VideoLabState>(set),
  lastVideoRef: null,
  lastPairRefs: null,

  setSource: (image, label, w, h) =>
    set({
      sourceImage: image,
      sourceLabel: label ?? "이미지를 업로드하거나 히스토리에서 선택",
      sourceWidth: w ?? null,
      sourceHeight: h ?? null,
      longerEdgeUserOverride: false,
    }),
  setPrompt: (v) => set({ prompt: v }),
  setDistillVariant: (id) =>
    set((state) => {
      const nonDistill = state.activeLoraIds.filter((activeId) => {
        const option = getLabLoraOption(activeId);
        return option?.role !== "lightning";
      });
      return { activeLoraIds: [id, ...nonDistill] };
    }),
  setLoraActive: (id, active) =>
    set((state) => {
      const exists = state.activeLoraIds.includes(id);
      if (active && !exists) {
        return { activeLoraIds: [...state.activeLoraIds, id] };
      }
      if (!active && exists) {
        return {
          activeLoraIds: state.activeLoraIds.filter((activeId) => activeId !== id),
        };
      }
      return {};
    }),
  setLoraStrength: (id, value) =>
    set((state) => ({
      loraStrengths: {
        ...state.loraStrengths,
        [id]: clampStrength(id, value),
      },
    })),
  setLongerEdge: (v) =>
    set({ longerEdge: snapLongerEdge(v), longerEdgeUserOverride: true }),
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
            lastError: null,
          }
        : { running },
    ),
  setPipelineProgress: (progress, label) =>
    set((state) => ({
      pipelineProgress: progress,
      pipelineLabel: label ?? state.pipelineLabel,
    })),
  setLastError: (message) => set({ lastError: message }),
  setLastVideoRef: (ref) => set({ lastVideoRef: ref, lastPairRefs: null }),
  setLastPairRefs: (refs) => set({ lastPairRefs: refs, lastVideoRef: null }),
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

export const useVideoLabInputs = () =>
  useVideoLabStore(
    useShallow((s) => ({
      sourceImage: s.sourceImage,
      sourceLabel: s.sourceLabel,
      sourceWidth: s.sourceWidth,
      sourceHeight: s.sourceHeight,
      setSource: s.setSource,
      prompt: s.prompt,
      setPrompt: s.setPrompt,
      presetId: s.presetId,
      activeLoraIds: s.activeLoraIds,
      loraStrengths: s.loraStrengths,
      setDistillVariant: s.setDistillVariant,
      setLoraActive: s.setLoraActive,
      setLoraStrength: s.setLoraStrength,
      longerEdge: s.longerEdge,
      setLongerEdge: s.setLongerEdge,
      lightning: s.lightning,
      setLightning: s.setLightning,
      skipUpgrade: s.skipUpgrade,
      setSkipUpgrade: s.setSkipUpgrade,
      promptMode: s.promptMode,
      setPromptMode: s.setPromptMode,
    })),
  );

export const useVideoLabRunning = () =>
  useVideoLabStore(
    useShallow((s) => ({
      running: s.running,
      pipelineProgress: s.pipelineProgress,
      pipelineLabel: s.pipelineLabel,
    })),
  );
