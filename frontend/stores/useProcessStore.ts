/**
 * useProcessStore - Ollama / ComfyUI 상태 (mock).
 * 드로어에서 바뀌면 TopBar ModelBadge 등에도 파급.
 */

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ProcStatus = "running" | "stopped";

export interface ProcessState {
  ollama: ProcStatus;
  comfyui: ProcStatus;

  setOllama: (s: ProcStatus) => void;
  setComfyui: (s: ProcStatus) => void;
  toggleOllama: () => void;
  toggleComfyui: () => void;
}

export const useProcessStore = create<ProcessState>()(
  persist(
    (set) => ({
      ollama: "running",
      comfyui: "stopped",
      setOllama: (s) => set({ ollama: s }),
      setComfyui: (s) => set({ comfyui: s }),
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
      version: 1,
    },
  ),
);
