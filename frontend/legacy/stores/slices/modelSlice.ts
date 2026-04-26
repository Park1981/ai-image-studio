/**
 * 모델 슬라이스
 * 체크포인트, LoRA, VAE 설정 및 모델 목록/프리셋 관리
 */

import type { StateCreator } from 'zustand'
import type { ModelPresetsResponse } from '@/lib/api'

// ── 타입 정의 ──

/** LoRA 설정 타입 */
export interface LoraConfig {
  name: string
  strengthModel: number
  strengthClip: number
}

/** 사용 가능한 모델 목록 */
export interface AvailableModels {
  checkpoints: string[]
  diffusionModels: string[]
  loras: string[]
  vaes: string[]
}

export interface ModelSlice {
  // ── 모델 설정 ──
  checkpoint: string
  setCheckpoint: (checkpoint: string) => void
  loras: LoraConfig[]
  addLora: (lora: LoraConfig) => void
  removeLora: (name: string) => void
  updateLoraStrength: (name: string, strengthModel: number, strengthClip: number) => void
  vae: string
  setVae: (vae: string) => void

  // ── 모델 목록 ──
  availableModels: AvailableModels
  setAvailableModels: (models: AvailableModels) => void

  // ── 모델별 권장 설정 프리셋 ──
  modelPresets: ModelPresetsResponse | null
  setModelPresets: (presets: ModelPresetsResponse) => void
}

// ── 슬라이스 생성 ──

export const createModelSlice: StateCreator<ModelSlice, [], [], ModelSlice> = (set) => ({
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

  // ── 사용 가능한 모델 목록 ──
  availableModels: { checkpoints: [], diffusionModels: [], loras: [], vaes: [] },
  setAvailableModels: (models) => set({ availableModels: models }),

  // ── 모델별 권장 설정 프리셋 ──
  modelPresets: null,
  setModelPresets: (presets) => set({ modelPresets: presets }),
})
