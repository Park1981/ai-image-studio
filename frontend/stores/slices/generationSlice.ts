/**
 * 생성 상태 슬라이스
 * 이미지 생성 진행 상태, 결과, 에러 관리
 */

import type { StateCreator } from 'zustand'

// ── 타입 정의 ──

/** 생성 상태 타입 */
export type GenerationStatus = 'idle' | 'enhancing' | 'warming_up' | 'generating' | 'completed' | 'error' | 'cancelled'

/** 생성된 이미지 타입 */
export interface GeneratedImage {
  url: string
  seed: number
  filename: string
}

export interface GenerationSlice {
  // ── 생성 상태 ──
  generationStatus: GenerationStatus
  setGenerationStatus: (status: GenerationStatus) => void

  // ── 진행률 (0~100) ──
  progress: number
  setProgress: (progress: number) => void

  // ── 현재 태스크 ID ──
  currentTaskId: string | null
  setCurrentTaskId: (taskId: string | null) => void

  // ── 생성된 이미지들 ──
  generatedImages: GeneratedImage[]
  setGeneratedImages: (images: GeneratedImage[]) => void

  // ── 에러 메시지 ──
  errorMessage: string | null
  setErrorMessage: (message: string | null) => void
}

// ── 슬라이스 생성 ──

export const createGenerationSlice: StateCreator<GenerationSlice, [], [], GenerationSlice> = (set) => ({
  // ── 생성 상태 ──
  generationStatus: 'idle',
  setGenerationStatus: (status) => set({ generationStatus: status }),

  // ── 진행률 ──
  progress: 0,
  setProgress: (progress) => set({ progress }),

  // ── 태스크 ID ──
  currentTaskId: null,
  setCurrentTaskId: (taskId) => set({ currentTaskId: taskId }),

  // ── 생성된 이미지 ──
  generatedImages: [],
  setGeneratedImages: (images) => set({ generatedImages: images }),

  // ── 에러 ──
  errorMessage: null,
  setErrorMessage: (message) => set({ errorMessage: message }),
})
