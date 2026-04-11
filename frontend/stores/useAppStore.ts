/**
 * Zustand 전역 상태 관리 스토어
 * 앱 전체에서 공유하는 상태 정의
 */

import { create } from 'zustand'

// 프로세스 상태 타입
interface ProcessStatus {
  ollama: { running: boolean; modelLoaded: string | null }
  comfyui: { running: boolean; vramUsedGb: number; vramTotalGb: number }
}

// 생성 상태 타입
type GenerationStatus = 'idle' | 'enhancing' | 'warming_up' | 'generating' | 'completed' | 'error' | 'cancelled'

// 생성된 이미지 타입
interface GeneratedImage {
  url: string
  seed: number
  filename: string
}

// 앱 스토어 상태
interface AppState {
  // 프로세스 상태
  processStatus: ProcessStatus
  setProcessStatus: (status: ProcessStatus) => void

  // 생성 상태
  generationStatus: GenerationStatus
  setGenerationStatus: (status: GenerationStatus) => void

  // 진행률 (0~100)
  progress: number
  setProgress: (progress: number) => void

  // 현재 태스크 ID
  currentTaskId: string | null
  setCurrentTaskId: (taskId: string | null) => void

  // 생성된 이미지들
  generatedImages: GeneratedImage[]
  setGeneratedImages: (images: GeneratedImage[]) => void

  // 에러 메시지
  errorMessage: string | null
  setErrorMessage: (message: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  // 프로세스 상태 초기값
  processStatus: {
    ollama: { running: false, modelLoaded: null },
    comfyui: { running: false, vramUsedGb: 0, vramTotalGb: 16 },
  },
  setProcessStatus: (status) => set({ processStatus: status }),

  // 생성 상태
  generationStatus: 'idle',
  setGenerationStatus: (status) => set({ generationStatus: status }),

  // 진행률
  progress: 0,
  setProgress: (progress) => set({ progress }),

  // 태스크 ID
  currentTaskId: null,
  setCurrentTaskId: (taskId) => set({ currentTaskId: taskId }),

  // 생성된 이미지
  generatedImages: [],
  setGeneratedImages: (images) => set({ generatedImages: images }),

  // 에러
  errorMessage: null,
  setErrorMessage: (message) => set({ errorMessage: message }),
}))
