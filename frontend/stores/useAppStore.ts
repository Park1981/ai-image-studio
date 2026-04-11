/**
 * Zustand 전역 상태 관리 스토어
 * 앱 전체에서 공유하는 상태 정의
 */

import { create } from 'zustand'

// ── 타입 정의 ──

/** 프로세스 상태 타입 */
interface ProcessStatus {
  ollama: { running: boolean; modelLoaded: string | null }
  comfyui: { running: boolean; vramUsedGb: number; vramTotalGb: number }
}

/** 생성 상태 타입 */
type GenerationStatus = 'idle' | 'enhancing' | 'warming_up' | 'generating' | 'completed' | 'error' | 'cancelled'

/** 생성된 이미지 타입 */
interface GeneratedImage {
  url: string
  seed: number
  filename: string
}

/** LoRA 설정 타입 */
export interface LoraConfig {
  name: string
  strengthModel: number
  strengthClip: number
}

/** 사용 가능한 모델 목록 */
interface AvailableModels {
  checkpoints: string[]
  diffusionModels: string[]
  loras: string[]
  vaes: string[]
}

// ── 스토어 상태 인터페이스 ──

interface AppState {
  // ── 프로세스 상태 ──
  processStatus: ProcessStatus
  setProcessStatus: (status: ProcessStatus) => void

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

  // ── 프롬프트 관련 ──
  prompt: string
  setPrompt: (prompt: string) => void
  negativePrompt: string
  setNegativePrompt: (negativePrompt: string) => void
  enhancedPrompt: string
  setEnhancedPrompt: (enhancedPrompt: string) => void
  autoEnhance: boolean
  setAutoEnhance: (autoEnhance: boolean) => void

  // ── AI 보강 2단계 플로우 ──
  enhancePending: boolean  // 보강 결과 확인 대기 중
  setEnhancePending: (pending: boolean) => void
  enhancedNegative: string  // 보강된 네거티브 프롬프트 (확인 전)
  setEnhancedNegative: (neg: string) => void
  enhanceFallback: boolean  // Ollama 호출 실패 → 폴백 사용 여부
  setEnhanceFallback: (fallback: boolean) => void
  activeStyleHint: string  // 프리셋 기반 AI 보강 스타일 힌트
  setActiveStyleHint: (style: string) => void
  ollamaModel: string  // AI 보강에 사용할 Ollama 모델
  setOllamaModel: (model: string) => void

  // ── 모델 설정 ──
  checkpoint: string
  setCheckpoint: (checkpoint: string) => void
  loras: LoraConfig[]
  addLora: (lora: LoraConfig) => void
  removeLora: (name: string) => void
  updateLoraStrength: (name: string, strengthModel: number, strengthClip: number) => void
  vae: string
  setVae: (vae: string) => void

  // ── 생성 파라미터 ──
  sampler: string
  setSampler: (sampler: string) => void
  scheduler: string
  setScheduler: (scheduler: string) => void
  width: number
  setWidth: (width: number) => void
  height: number
  setHeight: (height: number) => void
  steps: number
  setSteps: (steps: number) => void
  cfg: number
  setCfg: (cfg: number) => void
  seed: number
  setSeed: (seed: number) => void
  batchSize: number
  setBatchSize: (batchSize: number) => void

  // ── 모델 목록 ──
  availableModels: AvailableModels
  setAvailableModels: (models: AvailableModels) => void

  // ── UI 선택 상태 ──
  selectedImageIndex: number | null
  setSelectedImageIndex: (index: number | null) => void

  // ── 풀스크린 뷰어 ──
  viewerIndex: number | null
  setViewerIndex: (index: number | null) => void

  // ── 사이드바 토글 상태 ──
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void

  // ── 히스토리 패널 ──
  historyPanelOpen: boolean
  setHistoryPanelOpen: (open: boolean) => void
  toggleHistoryPanel: () => void

  // ── 설정 패널 ──
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void

  // ── 이미지 수정 모드 ──
  editMode: boolean
  setEditMode: (mode: boolean) => void
  editSourceImage: string | null  // 업로드된 소스 이미지 파일명
  setEditSourceImage: (filename: string | null) => void
  editSourcePreview: string | null  // 프리뷰용 Data URL
  setEditSourcePreview: (preview: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  // ── 프로세스 상태 초기값 ──
  processStatus: {
    ollama: { running: false, modelLoaded: null },
    comfyui: { running: false, vramUsedGb: 0, vramTotalGb: 16 },
  },
  setProcessStatus: (status) => set({ processStatus: status }),

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

  // ── 프롬프트 ──
  prompt: '',
  setPrompt: (prompt) => set({ prompt }),
  negativePrompt: '',
  setNegativePrompt: (negativePrompt) => set({ negativePrompt }),
  enhancedPrompt: '',
  setEnhancedPrompt: (enhancedPrompt) => set({ enhancedPrompt }),
  autoEnhance: true,
  setAutoEnhance: (autoEnhance) => set({ autoEnhance }),
  enhancePending: false,
  setEnhancePending: (pending) => set({ enhancePending: pending }),
  enhancedNegative: '',
  setEnhancedNegative: (neg) => set({ enhancedNegative: neg }),
  enhanceFallback: false,
  setEnhanceFallback: (fallback) => set({ enhanceFallback: fallback }),
  activeStyleHint: 'photorealistic',
  setActiveStyleHint: (style) => set({ activeStyleHint: style }),
  ollamaModel: '',  // 빈 문자열 = 서버 기본 모델 (gemma4:26b)
  setOllamaModel: (model) => set({ ollamaModel: model }),

  // ── 모델 설정 ──
  checkpoint: '',
  setCheckpoint: (checkpoint) => set({ checkpoint }),
  loras: [],
  addLora: (lora) => set((state) => ({ loras: [...state.loras, lora] })),
  removeLora: (name) => set((state) => ({
    loras: state.loras.filter((l) => l.name !== name),
  })),
  updateLoraStrength: (name, strengthModel, strengthClip) =>
    set((state) => ({
      loras: state.loras.map((l) =>
        l.name === name ? { ...l, strengthModel, strengthClip } : l
      ),
    })),
  vae: '',
  setVae: (vae) => set({ vae }),

  // ── 생성 파라미터 ──
  sampler: 'euler',
  setSampler: (sampler) => set({ sampler }),
  scheduler: 'simple',
  setScheduler: (scheduler) => set({ scheduler }),
  width: 1328,
  setWidth: (width) => set({ width }),
  height: 1328,
  setHeight: (height) => set({ height }),
  steps: 50,
  setSteps: (steps) => set({ steps }),
  cfg: 4.0,
  setCfg: (cfg) => set({ cfg }),
  seed: -1,
  setSeed: (seed) => set({ seed }),
  batchSize: 4,
  setBatchSize: (batchSize) => set({ batchSize }),

  // ── 사용 가능한 모델 목록 ──
  availableModels: { checkpoints: [], diffusionModels: [], loras: [], vaes: [] },
  setAvailableModels: (models) => set({ availableModels: models }),

  // ── UI 선택 상태 ──
  selectedImageIndex: null,
  setSelectedImageIndex: (index) => set({ selectedImageIndex: index }),

  // ── 풀스크린 뷰어 ──
  viewerIndex: null,
  setViewerIndex: (index) => set({ viewerIndex: index }),

  // ── 사이드바 토글 상태 ──
  sidebarOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  // ── 히스토리 패널 ──
  historyPanelOpen: false,
  setHistoryPanelOpen: (open) => set({ historyPanelOpen: open }),
  toggleHistoryPanel: () => set((state) => ({ historyPanelOpen: !state.historyPanelOpen })),

  // ── 설정 패널 ──
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  // ── 이미지 수정 모드 ──
  editMode: false,
  setEditMode: (mode) => set({ editMode: mode }),
  editSourceImage: null,
  setEditSourceImage: (filename) => set({ editSourceImage: filename }),
  editSourcePreview: null,
  setEditSourcePreview: (preview) => set({ editSourcePreview: preview }),
}))
