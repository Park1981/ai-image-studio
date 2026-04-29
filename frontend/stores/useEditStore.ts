/**
 * useEditStore - 수정 모드 입력/파이프라인 상태.
 * sourceImage 는 data URL (업로드) 또는 히스토리에서 선택한 imageRef.
 * 영속 안 함 (세션 한정) — 이미지 바이너리 커서 localStorage 가 빠르게 참.
 *
 * 2026-04-27 (Phase 2 진행 모달 store 통일):
 *   stepDone/currentStep/stepHistory 제거 → stageHistory: StageEvent[] 도입.
 *   백엔드 stage emit 의 payload (description / finalPrompt / editVisionAnalysis 등)
 *   를 그대로 보관 — PipelineTimeline 의 StageDef.renderDetail 이 사용.
 *   step emit 은 백엔드가 transitional 로 보내지만 store 에선 무시 (Phase 4 정리).
 */

"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { EditVisionAnalysis } from "@/lib/api/types";
import type { StageEvent } from "@/stores/useGenerateStore";

/** Multi-reference 이미지의 역할 preset ID (2026-04-27) */
export type ReferenceRoleId = "face" | "outfit" | "style" | "background" | "custom";

/**
 * Multi-reference 수동 crop 영역 (2026-04-28 · Phase 1).
 * react-easy-crop 의 Area 와 shape 동일 (라이브러리 의존 회피용 자체 타입).
 * 단위는 *원본 이미지의 픽셀 좌표*. null 이면 crop 미적용 (원본 그대로).
 */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
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

  /** Multi-reference (2026-04-27): 두번째 이미지 입력 사용 여부 */
  useReferenceImage: boolean;
  /** 두번째 이미지 — data URL */
  referenceImage: string | null;
  referenceLabel: string;
  referenceWidth: number | null;
  referenceHeight: number | null;
  /** 사용자 명시 role — preset 5개 중 하나 */
  referenceRole: ReferenceRoleId;
  /** referenceRole === "custom" 일 때만 사용 — 사용자 자유 입력 */
  referenceRoleCustom: string;
  /**
   * 수동 crop 영역 (2026-04-28 · Phase 1).
   * null 이면 crop 미적용 (원본 그대로).
   * reset 트리거 3개:
   *   1. setReferenceImage(new image) — 새 업로드 시 자동 null
   *   2. setReferenceImage(null) — 해제 시 자동 null
   *   3. setUseReferenceImage(false) — multi-ref 토글 OFF 시 자동 null
   */
  referenceCropArea: CropArea | null;

  /* ── 라이브러리 plan v9 (2026-04-29 · Phase B.2) ──
   * 옛 v8 의 saveAsTemplate / templateName *제거* — 사후 저장으로 이전 (모달 입력).
   * pickedTemplateId / pickedTemplateRef: 라이브러리에서 픽한 경우만 set (그대로 유지).
   * 새 업로드/해제 시 picked 두 값 자동 null. */
  pickedTemplateId: string | null;
  pickedTemplateRef: string | null;

  // 파이프라인 상태
  running: boolean;
  /** 진행 모달용 stage 이벤트 타임라인 (Phase 2 통일).
   *  백엔드 emit("stage", {...}) 가 도착할 때마다 push.
   *  같은 type 이 진입 + 완료로 두 번 들어오면 byType Map 이 후자 (payload 풍부) 로 덮어씀. */
  stageHistory: StageEvent[];
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
   * 백엔드 stage("vision-analyze", done) payload 의 editVisionAnalysis 필드에서 추출.
   * resetPipeline 으로 초기화. persist X — 새로고침/세션 종료 시 사라짐.
   */
  editVisionAnalysis: EditVisionAnalysis | null;

  // actions
  setSource: (
    image: string | null,
    label?: string,
    w?: number,
    h?: number,
  ) => void;
  setUseReferenceImage: (v: boolean) => void;
  setReferenceImage: (
    image: string | null,
    label?: string,
    w?: number,
    h?: number,
  ) => void;
  setReferenceRole: (role: ReferenceRoleId) => void;
  setReferenceRoleCustom: (text: string) => void;
  /** Phase 1 (2026-04-28): crop 영역 직접 설정. EditReferenceCrop 의 onAreaChange 가 호출. */
  setReferenceCropArea: (area: CropArea | null) => void;
  /* 라이브러리 plan v9 setters (옛 saveAsTemplate / templateName 제거 · Phase B.2) */
  setPickedTemplateId: (id: string | null) => void;
  setPickedTemplateRef: (ref: string | null) => void;
  setPrompt: (v: string) => void;
  setLightning: (v: boolean) => void;
  setRunning: (running: boolean) => void;
  setCompareX: (v: number) => void;
  setPipelineProgress: (progress: number, label?: string) => void;
  /** Phase 2: stage 이벤트 도착 시 호출. arrivedAt 자동 부여. */
  pushStage: (evt: Omit<StageEvent, "arrivedAt">) => void;
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
  // 2026-04-29: 기본 ON (= ⚡ 빠른 모드 · 퀄리티 모드 OFF). 옛 false 는 EditLeftPanel 주석/desc 의
  // "(기본)" 표기와 mismatch 였음 — 토글 라벨 동작은 그대로, 초기값만 의도대로 정렬.
  lightning: true,

  useReferenceImage: false,
  referenceImage: null,
  referenceLabel: "참조 이미지를 업로드해 주세요",
  referenceWidth: null,
  referenceHeight: null,
  referenceRole: "face",
  referenceRoleCustom: "",
  referenceCropArea: null,
  // 라이브러리 plan v9 (2026-04-29 · Phase B.2) — 픽 상태만 유지, save 토글 제거.
  pickedTemplateId: null,
  pickedTemplateRef: null,

  running: false,
  stageHistory: [],
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
  // Phase 1 (2026-04-28): 토글 OFF 시 crop 영역 자동 reset (트리거 #3)
  setUseReferenceImage: (v) =>
    set((s) => ({
      useReferenceImage: v,
      referenceCropArea: v ? s.referenceCropArea : null,
    })),
  // Phase 1 (2026-04-28): 새 업로드 / 해제 모두 crop 영역 자동 reset (트리거 #1, #2).
  // v8 라이브러리 plan: 새 이미지 업로드 / 해제 시 라이브러리 픽 상태 (id+ref) 도 자동 null.
  setReferenceImage: (image, label, w, h) =>
    set({
      referenceImage: image,
      referenceLabel: label ?? "참조 이미지를 업로드해 주세요",
      referenceWidth: w ?? null,
      referenceHeight: h ?? null,
      referenceCropArea: null,
      pickedTemplateId: null,
      pickedTemplateRef: null,
    }),
  setReferenceRole: (role) => set({ referenceRole: role }),
  setReferenceRoleCustom: (text) => set({ referenceRoleCustom: text }),
  setReferenceCropArea: (area) => set({ referenceCropArea: area }),
  setPickedTemplateId: (id) => set({ pickedTemplateId: id }),
  setPickedTemplateRef: (ref) => set({ pickedTemplateRef: ref }),
  setPrompt: (v) => set({ prompt: v }),
  setLightning: (v) => set({ lightning: v }),
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
            // 새 실행 시작 시 이전 분석 결과 비움
            editVisionAnalysis: null,
          }
        : { running },
    ),
  setCompareX: (v) => set({ compareX: v }),
  setEditVisionAnalysis: (analysis) => set({ editVisionAnalysis: analysis }),
  setPipelineProgress: (progress, label) =>
    set((s) => ({
      pipelineProgress: progress,
      pipelineLabel: label ?? s.pipelineLabel,
    })),
  pushStage: (evt) =>
    set((s) => ({
      stageHistory: [...s.stageHistory, { ...evt, arrivedAt: Date.now() }],
    })),
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
  setSampling: (step, total) =>
    set({ samplingStep: step, samplingTotal: total }),
}));

/* ──────────── 그룹 selectors (task #8 · 2026-04-26) ────────────
 * generate 와 동일 패턴 — 좌측 입력 / 우측 결과 / 진행상태를 useShallow 로 묶음.
 */

/** 입력 + 액션 (좌측 패널) */
export const useEditInputs = () =>
  useEditStore(
    useShallow((s) => ({
      sourceImage: s.sourceImage,
      sourceLabel: s.sourceLabel,
      sourceWidth: s.sourceWidth,
      sourceHeight: s.sourceHeight,
      setSource: s.setSource,
      prompt: s.prompt,
      setPrompt: s.setPrompt,
      lightning: s.lightning,
      setLightning: s.setLightning,
      // Multi-reference 필드 (2026-04-27)
      useReferenceImage: s.useReferenceImage,
      referenceImage: s.referenceImage,
      referenceLabel: s.referenceLabel,
      referenceWidth: s.referenceWidth,
      referenceHeight: s.referenceHeight,
      referenceRole: s.referenceRole,
      referenceRoleCustom: s.referenceRoleCustom,
      referenceCropArea: s.referenceCropArea,
      setUseReferenceImage: s.setUseReferenceImage,
      setReferenceImage: s.setReferenceImage,
      setReferenceRole: s.setReferenceRole,
      setReferenceRoleCustom: s.setReferenceRoleCustom,
      setReferenceCropArea: s.setReferenceCropArea,
      // 라이브러리 plan v9 (옛 saveAsTemplate / templateName 제거)
      pickedTemplateId: s.pickedTemplateId,
      pickedTemplateRef: s.pickedTemplateRef,
      setPickedTemplateId: s.setPickedTemplateId,
      setPickedTemplateRef: s.setPickedTemplateRef,
    })),
  );

/** 진행 상태 (모달 + CTA) */
export const useEditRunning = () =>
  useEditStore(
    useShallow((s) => ({
      running: s.running,
      pipelineProgress: s.pipelineProgress,
      pipelineLabel: s.pipelineLabel,
    })),
  );
