/**
 * useSettingsStore - 사용자 프리퍼런스 · 모델 선택 · 프롬프트 템플릿.
 * localStorage 영속화 (zustand/middleware persist).
 *
 * 드로어 UI 와 generate/edit 페이지 초기값 양쪽에서 공유.
 */

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { GENERATE_MODEL, EDIT_MODEL } from "@/lib/model-presets";

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
  showUpgradeStep: boolean;
  lightningByDefault: boolean;
  autoStartComfy: boolean;

  /* 프롬프트 템플릿 */
  templates: PromptTemplate[];

  /* actions */
  setGenerateModel: (v: string) => void;
  setEditModel: (v: string) => void;
  setOllamaModel: (v: string) => void;
  setVisionModel: (v: string) => void;
  setShowUpgradeStep: (v: boolean) => void;
  setLightningByDefault: (v: boolean) => void;
  setAutoStartComfy: (v: boolean) => void;
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
      ollamaModel: "gemma4-un:latest",
      visionModel: "qwen2.5vl:7b",

      showUpgradeStep: true,
      lightningByDefault: false,
      autoStartComfy: false,

      templates: DEFAULT_TEMPLATES,

      setGenerateModel: (v) => set({ generateModel: v }),
      setEditModel: (v) => set({ editModel: v }),
      setOllamaModel: (v) => set({ ollamaModel: v }),
      setVisionModel: (v) => set({ visionModel: v }),
      setShowUpgradeStep: (v) => set({ showUpgradeStep: v }),
      setLightningByDefault: (v) => set({ lightningByDefault: v }),
      setAutoStartComfy: (v) => set({ autoStartComfy: v }),

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
      version: 1,
    },
  ),
);
