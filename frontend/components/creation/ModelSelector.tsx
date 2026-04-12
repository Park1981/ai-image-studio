/**
 * 모델 선택 + 프리셋 컴포넌트
 * 체크포인트/Diffusion 모델 드롭다운 + 스타일 프리셋 버튼
 */

'use client'

import { useState, useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useModels } from '@/hooks/useModels'
import { useModelPresets } from '@/hooks/useModelPresets'
import { getAllPresets, saveCustomPresets, loadCustomPresets, type Preset } from '@/lib/presets'

export default function ModelSelector() {
  // ── 스토어 상태 ──
  const checkpoint = useAppStore((s) => s.checkpoint)
  const generationStatus = useAppStore((s) => s.generationStatus)
  const modelPresets = useAppStore((s) => s.modelPresets)

  const availableModels = useModels()
  const { handleModelSelect } = useModelPresets()

  const isGenerating =
    generationStatus === 'generating' ||
    generationStatus === 'warming_up' ||
    generationStatus === 'enhancing'

  // ── 프리셋 로컬 상태 ──
  const [presetList, setPresetList] = useState(() => getAllPresets())

  /** 프리셋 적용 */
  const handlePresetSelect = useCallback((presetId: string) => {
    const preset = getAllPresets().find((p) => p.id === presetId)
    if (!preset) return
    const s = useAppStore.getState()
    s.setSampler(preset.params.sampler)
    s.setScheduler(preset.params.scheduler)
    s.setSteps(preset.params.steps)
    s.setCfg(preset.params.cfg)
    s.setWidth(preset.params.width)
    s.setHeight(preset.params.height)
    s.setActiveStyleHint(preset.styleHint)
    if (preset.enhanceCategories) s.setEnhanceSettings({ categories: preset.enhanceCategories })
  }, [])

  /** 현재 설정을 프리셋으로 저장 */
  const handleSavePreset = useCallback(() => {
    const name = window.prompt('프리셋 이름을 입력하세요:')
    if (!name?.trim()) return
    const store = useAppStore.getState()
    const custom = loadCustomPresets()
    const newPreset: Preset = {
      id: `custom-${Date.now()}`,
      name: name.trim(),
      icon: '🎨',
      builtin: false,
      styleHint: store.activeStyleHint,
      params: {
        sampler: store.sampler,
        scheduler: store.scheduler,
        steps: store.steps,
        cfg: store.cfg,
        width: store.width,
        height: store.height,
      },
      enhanceCategories: { ...store.enhanceSettings.categories },
    }
    custom.push(newPreset)
    saveCustomPresets(custom)
    setPresetList(getAllPresets())
  }, [])

  // modelPresets가 없으면 초기 fetch는 CreationPanel에서 처리
  void modelPresets

  return (
    <>
      {/* 프리셋 */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">프리셋</label>
        <div className="flex gap-1 flex-wrap">
          {presetList.map((p) => (
            <button
              key={p.id}
              onClick={() => handlePresetSelect(p.id)}
              className="px-2 py-1 rounded-md text-[10px] bg-surface border border-edge hover:border-accent/40 text-text-sub hover:text-text transition-all"
            >
              {p.icon} {p.name}
            </button>
          ))}
          <button
            onClick={handleSavePreset}
            className="px-2 py-1 rounded-md text-[10px] border border-dashed border-edge text-text-ghost hover:text-accent-bright hover:border-accent/30 transition-all"
          >
            💾 저장
          </button>
        </div>
      </div>

      {/* 모델 드롭다운 */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">모델</label>
        <select
          value={checkpoint}
          onChange={(e) => handleModelSelect(e.target.value)}
          disabled={isGenerating}
          className="w-full bg-surface text-[11px] font-mono text-text-sub rounded-lg px-2.5 py-1.5 border border-edge hover:border-edge-hover focus:border-accent outline-none cursor-pointer disabled:opacity-40 truncate"
        >
          <option value="">Qwen Image (기본)</option>
          {availableModels.diffusionModels.length > 0 && (
            <optgroup label="Diffusion Models">
              {availableModels.diffusionModels.map((dm) => (
                <option key={dm} value={dm}>{dm}</option>
              ))}
            </optgroup>
          )}
          {availableModels.checkpoints.length > 0 && (
            <optgroup label="Checkpoints">
              {availableModels.checkpoints.map((cp) => (
                <option key={cp} value={cp}>{cp}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
    </>
  )
}
