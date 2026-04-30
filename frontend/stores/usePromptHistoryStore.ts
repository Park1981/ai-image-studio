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
  /** 2026-04-30 (Phase 1 Task 1): 단일 entry 삭제. */
  removeOne: (id: string) => void;
  clearMode: (mode: PromptHistoryMode) => void;
}

const MAX_PROMPTS = 80;

// 2026-04-30 (Codex v3 #1): 옛 `${mode}-${Date.now()}` 는 같은 ms 연속 add 시 충돌.
// crypto.randomUUID 우선 + jsdom/구버전 환경 fallback.
function makeEntryId(mode: PromptHistoryMode): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${mode}-${crypto.randomUUID()}`;
  }
  return `${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

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
                id: makeEntryId(mode),
                mode,
                prompt: text,
                createdAt: Date.now(),
              },
              ...filtered,
            ].slice(0, MAX_PROMPTS),
          };
        });
      },
      removeOne: (id) =>
        set((s) => ({ entries: s.entries.filter((x) => x.id !== id) })),
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
