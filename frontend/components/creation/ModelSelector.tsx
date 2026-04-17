/**
 * 모델 선택 + 프리셋 컴포넌트
 * 체크포인트/Diffusion 모델 드롭다운 + 스타일 프리셋 버튼
 */

'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useModels } from '@/hooks/useModels'
import { useModelPresets } from '@/hooks/useModelPresets'
import { getAllPresets, saveCustomPresets, loadCustomPresets, type Preset } from '@/lib/presets'

// ── 모드별 기본 모델 (워크플로우 템플릿에 내장된 기본) ──
// key: editMode, value: { 키(확장자 제외), 표시용 라벨 }
const DEFAULT_MODEL_BY_MODE = {
  generate: { key: 'qwen_image_fp8_e4m3fn', label: 'Qwen Image 2512 (기본)' },
  edit: { key: 'qwen_image_edit_2511_bf16', label: 'Qwen Edit 2511 (기본)' },
} as const

export default function ModelSelector() {
  // ── 스토어 상태 ──
  const checkpoint = useAppStore((s) => s.checkpoint)
  const generationStatus = useAppStore((s) => s.generationStatus)
  const modelPresets = useAppStore((s) => s.modelPresets)
  const editMode = useAppStore((s) => s.editMode)

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

  // ── 모드별 모델 필터링 ──
  // 프리셋 mode 필드가 현재 모드와 일치하는 모델만 노출
  // 프리셋에 등록되지 않은 모델은 모드 호환성을 판단할 수 없으므로 기본적으로 숨김
  // (단, 현재 선택된 checkpoint는 edge case로 항상 유지하여 select 값 불일치 방지)
  const currentModeKey: 'generate' | 'edit' = editMode ? 'edit' : 'generate'
  const matchesCurrentMode = useCallback(
    (fullName: string): boolean => {
      if (fullName === checkpoint && checkpoint) return true // 선택된 모델은 항상 유지
      if (!modelPresets) return true // 프리셋 미로드 상태는 전부 표시 (초기 플래시 방지)
      const key = fullName.replace(/\.safetensors$/, '').replace(/^.*[\\/]/, '')
      const all = { ...modelPresets.diffusion_models, ...modelPresets.checkpoints }
      const preset = all[key] ?? Object.values(all).find((v) => v.aliases?.includes(key))
      if (!preset || !preset.mode) return false
      return preset.mode === currentModeKey
    },
    [modelPresets, currentModeKey, checkpoint],
  )
  const filteredDiffusionModels = useMemo(
    () => availableModels.diffusionModels.filter(matchesCurrentMode),
    [availableModels.diffusionModels, matchesCurrentMode],
  )
  const filteredCheckpoints = useMemo(
    () => availableModels.checkpoints.filter(matchesCurrentMode),
    [availableModels.checkpoints, matchesCurrentMode],
  )

  // ── 모드 전환 시 모델 + 파라미터 자동 동기화 ──
  // 마운트 시 1회 + editMode 변경 시마다 실행 → 기본 모델 키로 프리셋 적용
  // 초기 마운트는 modelPresets 로드 완료 후에만 동작 (빈 프리셋으로 덮어쓰지 않기)
  const lastAppliedModeRef = useRef<'generate' | 'edit' | null>(null)
  useEffect(() => {
    if (!modelPresets) return
    if (lastAppliedModeRef.current === currentModeKey) return
    lastAppliedModeRef.current = currentModeKey
    // 기본 모델 프리셋 적용 → checkpoint는 ""로 두고 파라미터만 동기화
    const defaultKey = DEFAULT_MODEL_BY_MODE[currentModeKey].key
    handleModelSelect(defaultKey)
    // checkpoint는 "기본(워크플로우 내장)"으로 유지 — 워크플로우 JSON 자체가 mode별로 분리되어 있음
    useAppStore.getState().setCheckpoint('')
  }, [currentModeKey, modelPresets, handleModelSelect])

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
          <option value="">{DEFAULT_MODEL_BY_MODE[currentModeKey].label}</option>
          {filteredDiffusionModels.length > 0 && (
            <optgroup label="Diffusion Models">
              {filteredDiffusionModels.map((dm) => (
                <option key={dm} value={dm}>{dm}</option>
              ))}
            </optgroup>
          )}
          {filteredCheckpoints.length > 0 && (
            <optgroup label="Checkpoints">
              {filteredCheckpoints.map((cp) => (
                <option key={cp} value={cp}>{cp}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
    </>
  )
}
