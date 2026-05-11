"use client";

import { create } from "zustand";
import {
  createPromptFavorite,
  deletePromptFavorite,
  listPromptFavorites,
} from "@/lib/api/prompt-favorites";
import type { PromptFavorite, PromptFavoriteMode } from "@/lib/api/types";

interface PromptFavoritesState {
  entries: PromptFavorite[];
  hydrated: boolean;
  loading: boolean;
  hydrate: (force?: boolean) => Promise<void>;
  toggle: (mode: PromptFavoriteMode, prompt: string) => Promise<boolean>;
}

export function promptFavoriteKey(
  mode: PromptFavoriteMode,
  prompt: string,
): string {
  return `${mode}\u0000${prompt.trim()}`;
}

function upsertEntry(
  entries: PromptFavorite[],
  item: PromptFavorite,
): PromptFavorite[] {
  const withoutSame = entries.filter((e) => e.id !== item.id);
  return [item, ...withoutSame].sort((a, b) => b.updatedAt - a.updatedAt);
}

function findByPrompt(
  entries: PromptFavorite[],
  mode: PromptFavoriteMode,
  prompt: string,
): PromptFavorite | undefined {
  const key = promptFavoriteKey(mode, prompt);
  return entries.find((e) => promptFavoriteKey(e.mode, e.prompt) === key);
}

export const usePromptFavoritesStore = create<PromptFavoritesState>()(
  (set, get) => ({
    entries: [],
    hydrated: false,
    loading: false,
    hydrate: async (force = false) => {
      const state = get();
      if (state.loading || (state.hydrated && !force)) return;
      set({ loading: true });
      try {
        const entries = await listPromptFavorites();
        set({ entries, hydrated: true, loading: false });
      } catch (err) {
        set({ loading: false });
        throw err;
      }
    },
    toggle: async (mode, prompt) => {
      const cleanPrompt = prompt.trim();
      if (!cleanPrompt) return false;

      const existing = findByPrompt(get().entries, mode, cleanPrompt);
      if (existing) {
        const before = get().entries;
        set({ entries: before.filter((e) => e.id !== existing.id) });
        try {
          await deletePromptFavorite(existing.id);
          return false;
        } catch (err) {
          set({ entries: before });
          throw err;
        }
      }

      const created = await createPromptFavorite({
        mode,
        prompt: cleanPrompt,
      });
      set((s) => ({ entries: upsertEntry(s.entries, created) }));
      return true;
    },
  }),
);
