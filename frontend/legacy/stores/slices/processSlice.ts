/**
 * 프로세스 상태 슬라이스
 * Ollama / ComfyUI 프로세스 실행 상태 관리
 */

import type { StateCreator } from 'zustand'

// ── 타입 정의 ──

/** 프로세스 상태 타입 */
export interface ProcessStatus {
  ollama: { running: boolean; modelLoaded: string | null }
  comfyui: { running: boolean; vramUsedGb: number; vramTotalGb: number }
}

export interface ProcessSlice {
  processStatus: ProcessStatus
  setProcessStatus: (status: ProcessStatus) => void
}

// ── 슬라이스 생성 ──

export const createProcessSlice: StateCreator<ProcessSlice, [], [], ProcessSlice> = (set) => ({
  // ── 프로세스 상태 초기값 ──
  processStatus: {
    ollama: { running: false, modelLoaded: null },
    comfyui: { running: false, vramUsedGb: 0, vramTotalGb: 16 },
  },
  setProcessStatus: (status) => set({ processStatus: status }),
})
