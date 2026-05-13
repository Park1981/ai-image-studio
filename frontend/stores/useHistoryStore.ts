/**
 * useHistoryStore - 생성/수정 결과물 히스토리 (공용).
 * generate/edit 페이지에서 공유, localStorage 영속 (최대 200개).
 */

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { HistoryItem } from "@/lib/api/types";

// 2026-05-13: 200 → 2000 (cap 풀기 · 사용자 DB 진실 그대로 갤러리에 표시).
//  옛 200 cap 은 mode 합산 후 절단으로 mode 별 분포가 timing 따라 흔들렸음.
//  localStorage 부담은 image URL string 만 저장 → 2000 row × ~500 byte ≈ 1MB 으로 안전.
const MAX_HISTORY = 2000;

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
  /** v9 (2026-04-29 · Phase C.2): promote 성공 후 referenceRef swap 반영.
   *  사용자 직접 업로드 후 사후 promote → 백엔드가 영구 URL 로 swap →
   *  EditResultViewer 의 canPromote 가 자동 false 되도록 store 도 동기화. */
  updateReferenceRef: (id: string, referenceRef: string) => void;

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
      // v9 — promote 성공 시 해당 id row 의 referenceRef 만 swap (Phase C.2)
      updateReferenceRef: (id, referenceRef) =>
        set((s) => ({
          items: s.items.map((it) =>
            it.id === id ? { ...it, referenceRef } : it,
          ),
        })),

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
