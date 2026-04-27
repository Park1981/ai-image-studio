/**
 * useProcessStore - Ollama / ComfyUI 상태 + 통합 자원 메트릭.
 *
 * 2026-04-26: vram 단독에서 cpu/ram/gpu 까지 확장 (헤더 SystemMetrics 4-bar UI).
 *   - cpuPercent / gpuPercent: 0~100 사용률 (% 단위)
 *   - vram / ram: VramSnapshot (usedGb / totalGb) — 측정 실패 시 null
 *
 * persist 정책: 폴링이 5s 주기로 갱신하므로 메트릭은 영속 제외, 프로세스 상태만 보존.
 */

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { RamBreakdown, VramBreakdown } from "@/lib/api/types";

export type ProcStatus = "running" | "stopped";

/** GPU/RAM 사용량 스냅샷 — total=0 이면 store 에 null 로 저장. */
export interface MemorySnapshot {
  usedGb: number;
  totalGb: number;
}

/** 호환용 alias — 기존 VramSnapshot 사용처 유지. */
export type VramSnapshot = MemorySnapshot;

export interface ProcessState {
  ollama: ProcStatus;
  comfyui: ProcStatus;
  /** null 이면 측정 불가 (nvidia-smi 실패 또는 Mock 모드) → UI 에서 hidden */
  vram: MemorySnapshot | null;
  /** null 이면 psutil 실패 → UI 에서 hidden */
  ram: MemorySnapshot | null;
  /** 0~100 GPU 사용률 — null 이면 nvidia-smi 미설치 등 */
  gpuPercent: number | null;
  /** 0~100 CPU 사용률 — null 이면 psutil 실패 */
  cpuPercent: number | null;
  /** VRAM 임계 (80%) 오버레이용 프로세스 분류 — Mock/실패 시 null */
  vramBreakdown: VramBreakdown | null;
  /** 설정 시스템 메트릭 카드용 RAM 분해 — 실패 시 null (2026-04-27 신설) */
  ramBreakdown: RamBreakdown | null;

  setOllama: (s: ProcStatus) => void;
  setComfyui: (s: ProcStatus) => void;
  /** 폴러가 한 방에 모든 메트릭 동시 업데이트 (리렌더 최소화) */
  applyStatus: (input: {
    ollama: ProcStatus;
    comfyui: ProcStatus;
    vram: MemorySnapshot | null;
    ram: MemorySnapshot | null;
    gpuPercent: number | null;
    cpuPercent: number | null;
    vramBreakdown: VramBreakdown | null;
    ramBreakdown: RamBreakdown | null;
  }) => void;
  toggleOllama: () => void;
  toggleComfyui: () => void;
}

export const useProcessStore = create<ProcessState>()(
  persist(
    (set) => ({
      ollama: "running",
      comfyui: "stopped",
      vram: null,
      ram: null,
      gpuPercent: null,
      cpuPercent: null,
      vramBreakdown: null,
      ramBreakdown: null,
      setOllama: (s) => set({ ollama: s }),
      setComfyui: (s) => set({ comfyui: s }),
      applyStatus: (input) =>
        set({
          ollama: input.ollama,
          comfyui: input.comfyui,
          vram: input.vram,
          ram: input.ram,
          gpuPercent: input.gpuPercent,
          cpuPercent: input.cpuPercent,
          vramBreakdown: input.vramBreakdown,
          ramBreakdown: input.ramBreakdown,
        }),
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
      // 메트릭은 세션마다 새로 측정 — 영속 제외 (프로세스 ON/OFF 만 보존)
      partialize: (s) => ({ ollama: s.ollama, comfyui: s.comfyui }),
    },
  ),
);
