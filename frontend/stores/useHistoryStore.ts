/**
 * useHistoryStore - 생성/수정 결과물 히스토리 (공용).
 * generate/edit 페이지에서 공유, localStorage 영속 (최대 200개).
 */

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { HistoryItem } from "@/lib/api/types";

const MAX_HISTORY = 200;

export interface HistoryState {
  items: HistoryItem[];
  selectedId: string | null;
  hydrated: boolean;

  add: (item: HistoryItem) => void;
  remove: (id: string) => void;
  select: (id: string | null) => void;
  clear: () => void;
  replaceAll: (items: HistoryItem[]) => void;
  markHydrated: () => void;

  /** 모드별 필터링 view */
  itemsByMode: (mode: HistoryItem["mode"]) => HistoryItem[];
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      items: [],
      selectedId: null,
      hydrated: false,

      add: (item) =>
        set((s) => {
          // 동일 id 가 이미 있으면 앞으로 당김 (중복 방지)
          const filtered = s.items.filter((x) => x.id !== item.id);
          return {
            items: [item, ...filtered].slice(0, MAX_HISTORY),
            selectedId: item.id,
          };
        }),
      remove: (id) =>
        set((s) => ({
          items: s.items.filter((x) => x.id !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
        })),
      select: (id) => set({ selectedId: id }),
      clear: () => set({ items: [], selectedId: null }),
      replaceAll: (items) =>
        set({ items: items.slice(0, MAX_HISTORY), selectedId: null }),
      markHydrated: () => set({ hydrated: true }),

      itemsByMode: (mode) => get().items.filter((x) => x.mode === mode),
    }),
    {
      name: "ais:history",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // selectedId / hydrated 는 세션마다 초기화
      partialize: (s) => ({ items: s.items }),
    },
  ),
);
