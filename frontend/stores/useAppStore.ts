/**
 * Zustand 전역 상태 관리 스토어
 * 슬라이스 패턴으로 분리된 상태를 합쳐서 단일 스토어로 제공
 * 외부 인터페이스(useAppStore) 동일하게 유지 — 기존 import 변경 불필요
 */

import { create } from 'zustand'

import { createProcessSlice } from './slices/processSlice'
import { createGenerationSlice } from './slices/generationSlice'
import { createPromptSlice } from './slices/promptSlice'
import { createModelSlice } from './slices/modelSlice'
import { createSettingsSlice } from './slices/settingsSlice'
import { createUiSlice } from './slices/uiSlice'

import type { ProcessSlice } from './slices/processSlice'
import type { GenerationSlice } from './slices/generationSlice'
import type { PromptSlice } from './slices/promptSlice'
import type { ModelSlice } from './slices/modelSlice'
import type { SettingsSlice } from './slices/settingsSlice'
import type { UiSlice } from './slices/uiSlice'

// ── 타입 re-export (기존 import 호환) ──
export type { LoraConfig } from './slices/modelSlice'

// ── 통합 AppState 타입 ──
export type AppState =
  ProcessSlice &
  GenerationSlice &
  PromptSlice &
  ModelSlice &
  SettingsSlice &
  UiSlice

// ── 스토어 생성 (슬라이스 합성) ──
export const useAppStore = create<AppState>((...a) => ({
  ...createProcessSlice(...a),
  ...createGenerationSlice(...a),
  ...createPromptSlice(...a),
  ...createModelSlice(...a),
  ...createSettingsSlice(...a),
  ...createUiSlice(...a),
}))
