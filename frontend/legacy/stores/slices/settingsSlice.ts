/**
 * 생성 파라미터 슬라이스
 * sampler, scheduler, 해상도, steps, cfg, seed, batchSize 관리
 */

import type { StateCreator } from 'zustand'

export interface SettingsSlice {
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
  // 커스텀 px 모드의 비율 잠금 ('자유' | '1:1' | '16:9' | ...)
  // 외부에서 이미지 해상도 반영 시 '자유'로 전환하기 위해 store로 노출
  customRatio: string
  setCustomRatio: (ratio: string) => void
}

// ── 슬라이스 생성 ──

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set) => ({
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
  batchSize: 1,
  setBatchSize: (batchSize) => set({ batchSize }),
  customRatio: '1:1',
  setCustomRatio: (customRatio) => set({ customRatio }),
})
