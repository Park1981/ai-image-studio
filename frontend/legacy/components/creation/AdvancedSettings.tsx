/**
 * 고급 설정 패널 컴포넌트
 * VAE, LoRA, Steps, CFG, Seed, 샘플러, 스케줄러
 */

'use client'

import { useState, useMemo } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useModels } from '@/hooks/useModels'
import { PlusIcon, RefreshIcon, XIcon } from '../icons'

export default function AdvancedSettings() {
  // ── 스토어 상태 ──
  const vae = useAppStore((s) => s.vae)
  const setVae = useAppStore((s) => s.setVae)
  const loras = useAppStore((s) => s.loras)
  const addLora = useAppStore((s) => s.addLora)
  const removeLora = useAppStore((s) => s.removeLora)
  const updateLoraStrength = useAppStore((s) => s.updateLoraStrength)
  const steps = useAppStore((s) => s.steps)
  const setSteps = useAppStore((s) => s.setSteps)
  const cfg = useAppStore((s) => s.cfg)
  const setCfg = useAppStore((s) => s.setCfg)
  const seed = useAppStore((s) => s.seed)
  const setSeed = useAppStore((s) => s.setSeed)
  const sampler = useAppStore((s) => s.sampler)
  const setSampler = useAppStore((s) => s.setSampler)
  const scheduler = useAppStore((s) => s.scheduler)
  const setScheduler = useAppStore((s) => s.setScheduler)

  const availableModels = useModels()
  const modelPresets = useAppStore((s) => s.modelPresets)
  const checkpoint = useAppStore((s) => s.checkpoint)

  // ── 토글 상태 ──
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showLoraSelect, setShowLoraSelect] = useState(false)

  // 현재 모델의 compatible_loras 패턴 추출
  const compatiblePatterns = useMemo(() => {
    if (!modelPresets) return []
    const key = checkpoint.replace(/\.safetensors$/, '').replace(/^.*[\\\/]/, '')
    const all = { ...modelPresets.diffusion_models, ...modelPresets.checkpoints }
    const preset = all[key]
    if (!preset) {
      for (const v of Object.values(all)) {
        if (v.aliases?.includes(key)) return v.compatible_loras || []
      }
    }
    return preset?.compatible_loras || []
  }, [modelPresets, checkpoint])

  // 필터링된 LoRA 목록 (이미 추가된 것 제외, compatible 패턴 적용)
  const filteredLoras = useMemo(() => {
    const addedNames = new Set(loras.map((l) => l.name))
    let available = availableModels.loras.filter((n) => !addedNames.has(n))
    if (compatiblePatterns.length > 0) {
      available = available.filter((name) =>
        compatiblePatterns.some((p) => name.toLowerCase().includes(p.toLowerCase()))
      )
    }
    return available
  }, [availableModels.loras, loras, compatiblePatterns])

  return (
    <>
      {/* 고급 설정 토글 */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] transition-all border ${
          showAdvanced
            ? 'bg-accent-muted/30 border-accent/30 text-accent-bright'
            : 'border-edge text-text-sub hover:text-text hover:bg-white/[0.04]'
        }`}
      >
        {showAdvanced ? '▾ 고급 설정 접기' : '▸ 고급 설정'}
      </button>

      {/* 고급 설정 패널 */}
      {showAdvanced && (
        <div className="space-y-3 pt-1">
          {/* VAE */}
          <div>
            <label className="block text-[10px] text-text-sub mb-1">VAE</label>
            <select
              value={vae}
              onChange={(e) => setVae(e.target.value)}
              className="w-full bg-surface text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge focus:border-accent outline-none cursor-pointer"
            >
              <option value="">기본값 (모델 내장)</option>
              {availableModels.vaes.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>

          {/* LoRA */}
          <div>
            <label className="block text-[10px] text-text-sub mb-1">LoRA</label>
            {loras.map((lora) => (
              <div key={lora.name} className="flex items-center gap-2 p-2 rounded-lg bg-surface ring-1 ring-edge mb-1.5 group">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-mono text-text truncate">{lora.name}</p>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={lora.strengthModel}
                    onChange={(e) => updateLoraStrength(lora.name, parseFloat(e.target.value), parseFloat(e.target.value))}
                    className="w-full mt-1"
                  />
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[10px] font-mono text-accent-bright">{lora.strengthModel.toFixed(2)}</span>
                  <button
                    onClick={() => removeLora(lora.name)}
                    className="text-text-ghost hover:text-bad transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <XIcon />
                  </button>
                </div>
              </div>
            ))}
            {showLoraSelect ? (
              <div className="flex gap-1">
                <select
                  autoFocus
                  onChange={(e) => {
                    if (e.target.value) {
                      addLora({ name: e.target.value, strengthModel: 0.7, strengthClip: 0.7 })
                      setShowLoraSelect(false)
                    }
                  }}
                  onBlur={() => setShowLoraSelect(false)}
                  className="flex-1 bg-surface text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge focus:border-accent outline-none"
                >
                  <option value="">LoRA 선택...</option>
                  {filteredLoras.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <button
                onClick={() => setShowLoraSelect(true)}
                disabled={filteredLoras.length === 0}
                className="flex items-center gap-1.5 text-[11px] text-accent-bright hover:text-accent transition-colors w-full justify-center py-1.5 rounded-lg border border-dashed border-edge hover:border-accent/30 disabled:opacity-30"
              >
                <PlusIcon /> LoRA 추가 {filteredLoras.length > 0 && `(${filteredLoras.length})`}
              </button>
            )}
          </div>

          {/* Steps */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-text-sub">Steps</span>
              <span className="text-[10px] font-mono text-accent-bright">{steps}</span>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              value={steps}
              onChange={(e) => setSteps(parseInt(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none bg-elevated accent-accent"
            />
          </div>

          {/* CFG */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-text-sub">CFG</span>
              <span className="text-[10px] font-mono text-accent-bright">{cfg.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={cfg}
              onChange={(e) => setCfg(parseFloat(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none bg-elevated accent-accent"
            />
          </div>

          {/* Seed */}
          <div>
            <label className="block text-[10px] text-text-sub mb-1">시드</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={seed}
                onChange={(e) => { const val = parseInt(e.target.value, 10); setSeed(isNaN(val) ? -1 : val) }}
                className="flex-1 bg-surface font-mono text-[11px] text-text-sub rounded-lg px-2 py-1.5 border border-edge focus:border-accent outline-none"
              />
              <button
                onClick={() => setSeed(-1)}
                className="px-2 rounded-lg bg-surface border border-edge hover:border-edge-hover text-text-sub hover:text-text transition-all"
              >
                <RefreshIcon />
              </button>
            </div>
          </div>

          {/* 샘플러 / 스케줄러 */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[10px] text-text-sub mb-1">샘플러</label>
              <select
                value={sampler}
                onChange={(e) => setSampler(e.target.value)}
                className="w-full bg-surface text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge focus:border-accent outline-none cursor-pointer"
              >
                <option value="dpmpp_2m">dpmpp_2m</option>
                <option value="euler">euler</option>
                <option value="euler_ancestral">euler_ancestral</option>
                <option value="ddim">ddim</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[10px] text-text-sub mb-1">스케줄러</label>
              <select
                value={scheduler}
                onChange={(e) => setScheduler(e.target.value)}
                className="w-full bg-surface text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge focus:border-accent outline-none cursor-pointer"
              >
                <option value="simple">simple</option>
                <option value="normal">normal</option>
                <option value="karras">karras</option>
                <option value="exponential">exponential</option>
                <option value="sgm_uniform">sgm_uniform</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
