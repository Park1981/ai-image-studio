/**
 * 모델 프리셋 자동 적용 훅
 * 모델 선택 시 권장 파라미터(sampler, scheduler, steps, cfg, width, height) 자동 설정
 */

'use client'

import { useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'

/** 프리셋 엔트리 타입 (모델 프리셋 JSON 구조) */
interface PresetEntry {
  aliases?: string[]
  sampler: string
  scheduler: string
  steps: number
  cfg: number
  vae?: string
  default_width: number
  default_height: number
}

export function useModelPresets() {
  /** 모델 선택 시 권장 파라미터 자동 적용 */
  const handleModelSelect = useCallback((modelName: string) => {
    const s = useAppStore.getState()
    s.setCheckpoint(modelName)

    // 프리셋 데이터가 없으면 모델만 설정
    const presets = s.modelPresets
    if (!presets) return

    // 모델명에서 확장자/경로 제거하여 키 생성
    const key = modelName.replace(/\.safetensors$/, '').replace(/^.*[\\\/]/, '')

    // diffusion_models + checkpoints 합쳐서 프리셋 검색
    const allPresets = { ...presets.diffusion_models, ...presets.checkpoints } as Record<string, PresetEntry>

    // 정확한 키 매칭 시도
    let preset: PresetEntry | undefined = allPresets[key]

    // 못 찾으면 aliases에서 검색
    if (!preset) {
      for (const [, v] of Object.entries(allPresets)) {
        if (v.aliases?.includes(key)) {
          preset = v
          break
        }
      }
    }

    // 프리셋 찾았으면 파라미터 일괄 적용
    if (preset) {
      s.setSampler(preset.sampler)
      s.setScheduler(preset.scheduler)
      s.setSteps(preset.steps)
      s.setCfg(preset.cfg)
      s.setWidth(preset.default_width)
      s.setHeight(preset.default_height)
      s.setVae(preset.vae || '')
    }
  }, [])

  return { handleModelSelect }
}
