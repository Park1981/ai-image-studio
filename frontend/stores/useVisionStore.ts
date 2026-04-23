/**
 * useVisionStore — Vision Analyzer 페이지(/vision) 상태.
 * 2026-04-24 C3.
 *
 * - 세션 한정: currentImage (dataURL), currentLabel/Width/Height, running, lastResult
 * - persist: entries (최근 20건) 만 localStorage 저장.
 *   이미지는 dataURL 로 그대로 저장 → 20건 상한이 용량 방어선.
 */

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// 2026-04-24 G1: 20 → 100. entry 의 imageRef 를 256px JPEG 썸네일로 저장하므로
// 용량 부담은 100건 × 약 50KB = 5MB (localStorage 10MB 한계 내 여유).
export const MAX_VISION_HISTORY = 100;

export interface VisionEntry {
  id: string; // `vis-${Date.now().toString(36)}`
  /** dataURL (업로드 원본 그대로) 또는 서버 이미지 URL */
  imageRef: string;
  /** "파일명.png · 1024×768" */
  thumbLabel: string;
  en: string;
  ko: string | null;
  /** ms since epoch */
  createdAt: number;
  /** 어떤 vision 모델이 분석했는지 (나중에 필터링용) */
  visionModel: string;
  /** 해상도 (PIL 측정 — 0 이면 미상) */
  width: number;
  height: number;
}

interface VisionResult {
  en: string;
  ko: string | null;
}

export interface VisionState {
  /* 세션 한정 */
  currentImage: string | null;
  currentLabel: string;
  currentWidth: number | null;
  currentHeight: number | null;
  running: boolean;
  lastResult: VisionResult | null;

  /* 영속 */
  entries: VisionEntry[];

  /* actions */
  setSource: (
    image: string | null,
    label?: string,
    w?: number,
    h?: number,
  ) => void;
  clearSource: () => void;
  setRunning: (v: boolean) => void;
  setResult: (en: string, ko: string | null) => void;
  addEntry: (entry: VisionEntry) => void;
  removeEntry: (id: string) => void;
  clearEntries: () => void;
  /** 히스토리에서 entry 선택 — currentImage + lastResult 복원 */
  loadEntry: (id: string) => void;
}

export const useVisionStore = create<VisionState>()(
  persist(
    (set, get) => ({
      currentImage: null,
      currentLabel: "이미지를 업로드하면 Vision 분석 시작",
      currentWidth: null,
      currentHeight: null,
      running: false,
      lastResult: null,

      entries: [],

      setSource: (image, label, w, h) =>
        set({
          currentImage: image,
          currentLabel: label ?? "이미지를 업로드하면 Vision 분석 시작",
          currentWidth: w ?? null,
          currentHeight: h ?? null,
          // 새 이미지 로드 시 이전 결과 초기화
          lastResult: image === null ? null : get().lastResult,
        }),

      clearSource: () =>
        set({
          currentImage: null,
          currentLabel: "이미지를 업로드하면 Vision 분석 시작",
          currentWidth: null,
          currentHeight: null,
          lastResult: null,
        }),

      setRunning: (v) => set({ running: v }),

      setResult: (en, ko) => set({ lastResult: { en, ko } }),

      addEntry: (entry) =>
        set((s) => {
          // 동일 id 중복 제거 후 맨 앞에 삽입, MAX 상한
          const filtered = s.entries.filter((x) => x.id !== entry.id);
          return {
            entries: [entry, ...filtered].slice(0, MAX_VISION_HISTORY),
          };
        }),

      removeEntry: (id) =>
        set((s) => ({
          entries: s.entries.filter((x) => x.id !== id),
        })),

      clearEntries: () => set({ entries: [] }),

      loadEntry: (id) => {
        const entry = get().entries.find((x) => x.id === id);
        if (!entry) return;
        set({
          currentImage: entry.imageRef,
          currentLabel: entry.thumbLabel,
          currentWidth: entry.width || null,
          currentHeight: entry.height || null,
          lastResult: { en: entry.en, ko: entry.ko },
        });
      },
    }),
    {
      name: "ais:vision",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // 세션 상태 (currentImage, running, lastResult) 는 제외
      partialize: (s) => ({ entries: s.entries }),
    },
  ),
);
