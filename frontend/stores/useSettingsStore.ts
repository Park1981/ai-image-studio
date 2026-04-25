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
  EDIT_MODEL,
  GENERATE_MODEL,
} from "@/lib/model-presets";

export interface PromptTemplate {
  id: string;
  name: string;
  text: string;
}

export interface SettingsState {
  /* 모델 선택 (UI 용 표시값 — 실제 파일명은 model-presets 에서) */
  generateModel: string;
  editModel: string;
  ollamaModel: string;
  visionModel: string;

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
  lightningByDefault: boolean;
  autoStartComfy: boolean;
  /** Edit 결과 완료 후 자동 비교 분석 (백그라운드). 기본 false. */
  autoCompareAnalysis: boolean;

  /* 프롬프트 템플릿 */
  templates: PromptTemplate[];

  /* actions */
  setGenerateModel: (v: string) => void;
  setEditModel: (v: string) => void;
  setOllamaModel: (v: string) => void;
  setVisionModel: (v: string) => void;
  setHideGeneratePrompts: (v: boolean) => void;
  setHideEditPrompts: (v: boolean) => void;
  setLightningByDefault: (v: boolean) => void;
  setAutoStartComfy: (v: boolean) => void;
  setAutoCompareAnalysis: (v: boolean) => void;
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

      hideGeneratePrompts: true,
      hideEditPrompts: true,
      lightningByDefault: false,
      autoStartComfy: false,
      autoCompareAnalysis: false,

      templates: DEFAULT_TEMPLATES,

      setGenerateModel: (v) => set({ generateModel: v }),
      setEditModel: (v) => set({ editModel: v }),
      setOllamaModel: (v) => set({ ollamaModel: v }),
      setVisionModel: (v) => set({ visionModel: v }),
      setHideGeneratePrompts: (v) => set({ hideGeneratePrompts: v }),
      setHideEditPrompts: (v) => set({ hideEditPrompts: v }),
      setLightningByDefault: (v) => set({ lightningByDefault: v }),
      setAutoStartComfy: (v) => set({ autoStartComfy: v }),
      setAutoCompareAnalysis: (v) => set({ autoCompareAnalysis: v }),

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
      version: 3,
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
        return obj as unknown as SettingsState;
      },
    },
  ),
);
