"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type PromptHistoryMode = "generate" | "edit" | "video" | "compare";

export interface PromptHistoryEntry {
  id: string;
  mode: PromptHistoryMode;
  prompt: string;
  createdAt: number;
}

interface PromptHistoryState {
  entries: PromptHistoryEntry[];
  add: (mode: PromptHistoryMode, prompt: string) => void;
  clearMode: (mode: PromptHistoryMode) => void;
}

const MAX_PROMPTS = 80;

export const usePromptHistoryStore = create<PromptHistoryState>()(
  persist(
    (set) => ({
      entries: [],
      add: (mode, prompt) => {
        const text = prompt.trim();
        if (!text) return;
        set((s) => {
          const filtered = s.entries.filter(
            (x) => !(x.mode === mode && x.prompt.trim() === text),
          );
          return {
            entries: [
              {
                id: `${mode}-${Date.now()}`,
                mode,
                prompt: text,
                createdAt: Date.now(),
              },
              ...filtered,
            ].slice(0, MAX_PROMPTS),
          };
        });
      },
      clearMode: (mode) =>
        set((s) => ({ entries: s.entries.filter((x) => x.mode !== mode) })),
    }),
    {
      name: "ais:prompt-history",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
