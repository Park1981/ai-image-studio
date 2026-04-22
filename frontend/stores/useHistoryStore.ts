/**
 * useHistoryStore - 생성/수정 결과물 히스토리 (공용).
 * generate/edit 페이지에서 공유, localStorage 영속 (최대 200개).
 */

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { HistoryItem } from "@/lib/api-client";

const MAX_HISTORY = 200;

export interface HistoryState {
  items: HistoryItem[];
  selectedId: string | null;

  add: (item: HistoryItem) => void;
  remove: (id: string) => void;
  select: (id: string | null) => void;
  clear: () => void;

  /** 모드별 필터링 view */
  itemsByMode: (mode: HistoryItem["mode"]) => HistoryItem[];
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      items: [],
      selectedId: null,

      add: (item) =>
        set((s) => ({
          items: [item, ...s.items].slice(0, MAX_HISTORY),
          selectedId: item.id,
        })),
      remove: (id) =>
        set((s) => ({
          items: s.items.filter((x) => x.id !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
        })),
      select: (id) => set({ selectedId: id }),
      clear: () => set({ items: [], selectedId: null }),

      itemsByMode: (mode) => get().items.filter((x) => x.mode === mode),
    }),
    {
      name: "ais:history",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // selectedId 는 세션마다 초기화 (영속에서 제외)
      partialize: (s) => ({ items: s.items }),
    },
  ),
);
