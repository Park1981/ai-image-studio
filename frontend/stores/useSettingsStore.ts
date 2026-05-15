/**
 * useSettingsStore - 사용자 프리퍼런스 · 모델 선택 · 프롬프트 템플릿.
 * localStorage 영속화 (zustand/middleware persist).
 *
 * 드로어 UI 와 generate/edit 페이지 초기값 양쪽에서 공유.
 */

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  DEFAULT_OLLAMA_MODELS,
  DEFAULT_VIDEO_MODEL_ID,
  EDIT_MODEL,
  GENERATE_MODEL,
  type VideoModelId,
} from "@/lib/model-presets";

export interface PromptTemplate {
  id: string;
  name: string;
  text: string;
}

/**
 * gemma4 보강 모드 (Phase 2 · 2026-05-01).
 *
 * - "fast": think:false, num_predict 800, 5~15초 응답. 기본값.
 * - "precise": think:true, num_predict 4096, 30~60초+. 사용자 명시 선택만.
 *
 * 페이지 (Generate/Edit/Video) 별 session store 가 settings 의 기본값을 init 으로 받고,
 * 사용자가 그 페이지 패널에서 토글한 값은 새로 페이지 진입 시 settings 기본값으로 다시 초기화 됨.
 */
export type PromptEnhanceMode = "fast" | "precise";

/**
 * Auto NSFW 강도 (spec 2026-05-12 v1.1).
 * 1: 은근 (옷 유지) · 2: 옷벗음 (탈의 reveal 까지) · 3: 옷벗음+애무 (L2 + intimate self-touch).
 */
export type NsfwIntensity = 1 | 2 | 3;

export interface SettingsState {
  /* 모델 선택 (UI 용 표시값 — 실제 파일명은 model-presets 에서) */
  generateModel: string;
  editModel: string;
  ollamaModel: string;
  visionModel: string;
  /** Phase 4 (2026-05-03) — 영상 모델 선택 (Wan 2.2 default · 사용자 선택 persist) */
  videoModel: VideoModelId;
  /** Lab Video 마지막 선택 preset. Phase 1 은 ltx-sulphur 단일 preset. */
  labVideoPresetId: string;

  /* 프리퍼런스 토글 */
  /**
   * 생성 진행 모달의 detail 영역 (gemma4 영어 프롬프트 / 한글 번역 등) 숨김.
   * 기본 true (깔끔 모드). false 시:
   *   - 생성 전 사전 검수 모달 (UpgradeConfirmModal) 띄움
   *   - 진행 모달의 step detail 박스 자동 펼침
   * spec: 진행 모달 prompt 토글 (2026-04-25)
   */
  hideGeneratePrompts: boolean;
  /**
   * 수정 진행 모달의 detail 영역 (비전 분석 / 영어 프롬프트 등) 숨김.
   * 기본 true (깔끔 모드). false 시 진행 모달의 step detail 박스 자동 펼침.
   * 사전 모달 분기는 Edit 에 없음 — 단순 표시 토글.
   */
  hideEditPrompts: boolean;
  /**
   * 영상 진행 모달의 detail 영역 (비전 분석 / LTX 영어 프롬프트 등) 숨김.
   * 기본 true (깔끔 모드). false 시 진행 모달의 stage detail 박스 자동 펼침.
   * 사전 모달 분기는 Video 에 없음 — 단순 표시 토글 (Edit 와 동일).
   * 추가일: 2026-04-27 (Phase 4 후속).
   */
  hideVideoPrompts: boolean;
  lightningByDefault: boolean;
  autoStartComfy: boolean;
  /** Edit 결과 완료 후 자동 비교 분석 (백그라운드). 기본 false. */
  autoCompareAnalysis: boolean;
  /**
   * gemma4 프롬프트 보강 기본 모드 (Phase 2 · 2026-05-01).
   * 페이지 진입 시 페이지 store 의 promptMode 가 이 값으로 init.
   * 기본 "fast" — 정밀 모드는 사용자 명시 선택.
   */
  promptEnhanceMode: PromptEnhanceMode;

  /**
   * 자동 NSFW 시나리오 토글 (spec 2026-05-12 v1.1).
   * Video 페이지의 adult 토글 위에 별도 단계. ON 이면 vision + gemma4-un 이
   * 이미지 보고 explicit 시나리오 자율 작성 (사용자 지시 없어도 OK).
   * 기본 false.
   */
  autoNsfwEnabled: boolean;
  /**
   * 자동 NSFW 강도 (spec 2026-05-12 v1.1).
   * 1: 은근 (옷 유지) · 2: 옷벗음 (탈의 reveal) · 3: 옷벗음+애무 (intimate)
   * 기본 2 — autoNsfwEnabled=true 일 때 의미 있음.
   */
  nsfwIntensity: NsfwIntensity;

  /* 프롬프트 템플릿 */
  templates: PromptTemplate[];

  /* actions */
  setGenerateModel: (v: string) => void;
  setEditModel: (v: string) => void;
  setOllamaModel: (v: string) => void;
  setVisionModel: (v: string) => void;
  setVideoModel: (v: VideoModelId) => void;
  setLabVideoPresetId: (v: string) => void;
  setHideGeneratePrompts: (v: boolean) => void;
  setHideEditPrompts: (v: boolean) => void;
  setHideVideoPrompts: (v: boolean) => void;
  setLightningByDefault: (v: boolean) => void;
  setAutoStartComfy: (v: boolean) => void;
  setAutoCompareAnalysis: (v: boolean) => void;
  setPromptEnhanceMode: (v: PromptEnhanceMode) => void;
  setAutoNsfwEnabled: (v: boolean) => void;
  setNsfwIntensity: (v: NsfwIntensity) => void;
  addTemplate: (t: Omit<PromptTemplate, "id">) => void;
  removeTemplate: (id: string) => void;
}

const DEFAULT_TEMPLATES: PromptTemplate[] = [
  {
    id: "cinematic",
    name: "시네마틱 인물",
    text: "cinematic portrait, 35mm film, soft bokeh, warm tones, detailed skin texture",
  },
  {
    id: "product",
    name: "제품샷 · 스튜디오",
    text: "studio product shot, white seamless background, softbox lighting, ultra sharp",
  },
  {
    id: "landscape",
    name: "풍경 · 황금시간",
    text: "wide landscape, golden hour, volumetric light, atmospheric depth, hyperreal",
  },
];

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      generateModel: GENERATE_MODEL.displayName,
      editModel: EDIT_MODEL.displayName,
      // 백엔드 backend/studio/presets.py::DEFAULT_OLLAMA_ROLES 와 싱크 유지.
      // 상수 분리 이후 여기 직접 문자열 하드코딩 금지 (Opus S4).
      ollamaModel: DEFAULT_OLLAMA_MODELS.text,
      visionModel: DEFAULT_OLLAMA_MODELS.vision,
      // Phase 4 (2026-05-03) — 사용자 결정 #1: default Wan 2.2.
      videoModel: DEFAULT_VIDEO_MODEL_ID,
      labVideoPresetId: "ltx-sulphur",

      hideGeneratePrompts: true,
      hideEditPrompts: true,
      hideVideoPrompts: true,
      lightningByDefault: false,
      autoStartComfy: false,
      autoCompareAnalysis: false,
      promptEnhanceMode: "fast",
      // spec 2026-05-12 v1.1 — 자동 NSFW 시나리오 (Video 페이지 전용 영향)
      autoNsfwEnabled: false,
      nsfwIntensity: 2 as NsfwIntensity,

      templates: DEFAULT_TEMPLATES,

      setGenerateModel: (v) => set({ generateModel: v }),
      setEditModel: (v) => set({ editModel: v }),
      setOllamaModel: (v) => set({ ollamaModel: v }),
      setVisionModel: (v) => set({ visionModel: v }),
      setVideoModel: (v) => set({ videoModel: v }),
      setLabVideoPresetId: (v) => set({ labVideoPresetId: v }),
      setHideGeneratePrompts: (v) => set({ hideGeneratePrompts: v }),
      setHideEditPrompts: (v) => set({ hideEditPrompts: v }),
      setHideVideoPrompts: (v) => set({ hideVideoPrompts: v }),
      setLightningByDefault: (v) => set({ lightningByDefault: v }),
      setAutoStartComfy: (v) => set({ autoStartComfy: v }),
      setAutoCompareAnalysis: (v) => set({ autoCompareAnalysis: v }),
      setPromptEnhanceMode: (v) => set({ promptEnhanceMode: v }),
      setAutoNsfwEnabled: (v) => set({ autoNsfwEnabled: v }),
      setNsfwIntensity: (v) => set({ nsfwIntensity: v }),

      addTemplate: (t) =>
        set((s) => ({
          templates: [
            { id: `tpl-${Date.now().toString(36)}`, ...t },
            ...s.templates,
          ],
        })),
      removeTemplate: (id) =>
        set((s) => ({ templates: s.templates.filter((x) => x.id !== id) })),
    }),
    {
      name: "ais:settings",
      storage: createJSONStorage(() => localStorage),
      version: 8,
      migrate: (persisted: unknown, fromVersion: number) => {
        const obj = (persisted as Record<string, unknown>) || {};
        // v1 → v2: autoCompareAnalysis 기본 false 추가
        if (fromVersion < 2) {
          obj.autoCompareAnalysis = false;
        }
        // v2 → v3: showUpgradeStep → hideGeneratePrompts (의미 반전) +
        //         hideEditPrompts 신설. spec: 진행 모달 prompt 토글 분리.
        if (fromVersion < 3) {
          if (obj.showUpgradeStep !== undefined) {
            // 옛 사용자 설정 보존 — showUpgradeStep=true (사전 모달 + 펼침)
            // = hideGeneratePrompts=false (= 보이게 + 사전 모달).
            obj.hideGeneratePrompts = !obj.showUpgradeStep;
            delete obj.showUpgradeStep;
          } else {
            obj.hideGeneratePrompts = true;
          }
          obj.hideEditPrompts = true;
        }
        // v3 → v4: hideVideoPrompts 신설 (Phase 4 후속 · 2026-04-27).
        // 기본 true (Edit/Generate 와 일관 — 깔끔 모드 기본).
        if (fromVersion < 4) {
          obj.hideVideoPrompts = true;
        }
        // v4 → v5: promptEnhanceMode 신설 (Phase 2 · 2026-05-01).
        // 기본 "fast" — 정밀 모드는 사용자 명시 선택만.
        if (fromVersion < 5) {
          obj.promptEnhanceMode = "fast";
        }
        // v5 → v6: videoModel 신설 (Phase 4 · 2026-05-03 · Wan 2.2 도입).
        // 기본 "wan22" — 사용자 결정 #1 (spec §2).
        if (fromVersion < 6) {
          obj.videoModel = DEFAULT_VIDEO_MODEL_ID;
        }
        // v6 → v7: autoNsfwEnabled + nsfwIntensity 신설 (spec 2026-05-12 v1.1).
        // 기본 false / 2 — 사용자 결정 (브레인스토밍 Q1 = 디폴트 강도 2).
        if (fromVersion < 7) {
          obj.autoNsfwEnabled = false;
          obj.nsfwIntensity = 2;
        }
        if (fromVersion < 8) {
          obj.labVideoPresetId = "ltx-sulphur";
        }
        return obj as unknown as SettingsState;
      },
    },
  ),
);
