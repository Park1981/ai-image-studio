/**
 * 프롬프트 슬라이스
 * 프롬프트 입력, AI 보강, 스타일 힌트, Ollama 모델 설정 관리
 */

import type { StateCreator } from 'zustand'
import type { EnhanceCategoryItem, EnhanceCategoryConfig } from '@/lib/api'

// ── 타입 정의 ──

/** AI 보강 세부 설정 */
export interface EnhanceSettings {
  creativity: number  // 0.1~1.0 (Ollama temperature)
  detailLevel: 'minimal' | 'normal' | 'detailed'
  categories: EnhanceCategoryConfig
}

export interface PromptSlice {
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
  enhanceFallback: boolean  // Ollama 호출 실패 -> 폴백 사용 여부
  setEnhanceFallback: (fallback: boolean) => void
  enhanceProvider: string  // 보강 제공자: "ollama" | "claude_cli" | "fallback"
  setEnhanceProvider: (provider: string) => void
  activeStyleHint: string  // 프리셋 기반 AI 보강 스타일 힌트
  setActiveStyleHint: (style: string) => void
  ollamaModel: string  // AI 보강에 사용할 Ollama 모델
  setOllamaModel: (model: string) => void

  // ── AI 보강 세부 설정 ──
  enhanceSettings: EnhanceSettings
  setEnhanceSettings: (settings: Partial<EnhanceSettings>) => void
  setEnhanceCategory: (name: keyof EnhanceCategoryConfig, value: boolean) => void

  // ── 보강 결과 카테고리 데이터 ──
  enhancedCategories: EnhanceCategoryItem[]
  setEnhancedCategories: (cats: EnhanceCategoryItem[]) => void
}

// ── 슬라이스 생성 ──

export const createPromptSlice: StateCreator<PromptSlice, [], [], PromptSlice> = (set) => ({
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
  enhanceProvider: 'ollama',
  setEnhanceProvider: (provider) => set({ enhanceProvider: provider }),
  activeStyleHint: 'photorealistic',
  setActiveStyleHint: (style) => set({ activeStyleHint: style }),
  ollamaModel: '',  // 빈 문자열 = 서버 기본 모델 (gemma4:26b)
  setOllamaModel: (model) => set({ ollamaModel: model }),

  // ── AI 보강 세부 설정 ──
  enhanceSettings: {
    creativity: 0.7,
    detailLevel: 'normal',
    categories: {
      subject: true,
      background: true,
      lighting: true,
      style: true,
      mood: true,
      technical: false,
    },
  },
  setEnhanceSettings: (partial) =>
    set((state) => ({
      enhanceSettings: { ...state.enhanceSettings, ...partial },
    })),
  setEnhanceCategory: (name, value) =>
    set((state) => ({
      enhanceSettings: {
        ...state.enhanceSettings,
        categories: { ...state.enhanceSettings.categories, [name]: value },
      },
    })),

  // ── 보강 결과 카테고리 데이터 ──
  enhancedCategories: [],
  setEnhancedCategories: (cats) => set({ enhancedCategories: cats }),
})
