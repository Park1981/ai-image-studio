/**
 * useProcessStore - Ollama / ComfyUI 상태 (mock).
 * 드로어에서 바뀌면 TopBar ModelBadge 등에도 파급.
 */

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ProcStatus = "running" | "stopped";

/** VRAM 실시간 측정값 — 백엔드 nvidia-smi 성공 시에만 채워짐. */
export interface VramSnapshot {
  usedGb: number;
  totalGb: number;
}

export interface ProcessState {
  ollama: ProcStatus;
  comfyui: ProcStatus;
  /** null 이면 측정 불가 (nvidia-smi 실패 또는 Mock 모드) → UI 에서 hidden */
  vram: VramSnapshot | null;

  setOllama: (s: ProcStatus) => void;
  setComfyui: (s: ProcStatus) => void;
  setVram: (v: VramSnapshot | null) => void;
  /** 폴러가 한 방에 3개 상태 동시 업데이트 (리렌더 최소화) */
  applyStatus: (
    ollama: ProcStatus,
    comfyui: ProcStatus,
    vram: VramSnapshot | null,
  ) => void;
  toggleOllama: () => void;
  toggleComfyui: () => void;
}

export const useProcessStore = create<ProcessState>()(
  persist(
    (set) => ({
      ollama: "running",
      comfyui: "stopped",
      vram: null,
      setOllama: (s) => set({ ollama: s }),
      setComfyui: (s) => set({ comfyui: s }),
      setVram: (v) => set({ vram: v }),
      applyStatus: (ollama, comfyui, vram) => set({ ollama, comfyui, vram }),
      toggleOllama: () =>
        set((st) => ({ ollama: st.ollama === "running" ? "stopped" : "running" })),
      toggleComfyui: () =>
        set((st) => ({
          comfyui: st.comfyui === "running" ? "stopped" : "running",
        })),
    }),
    {
      name: "ais:process",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      // vram 은 세션마다 새로 측정 — 영속 제외
      partialize: (s) => ({ ollama: s.ollama, comfyui: s.comfyui }),
    },
  ),
);
