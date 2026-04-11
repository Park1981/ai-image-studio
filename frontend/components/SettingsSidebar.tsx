/**
 * 설정 사이드바 컴포넌트
 * 고급 설정만 표시 (VAE, LoRA, Steps, CFG, Seed, 샘플러, 스케줄러)
 * 기본 설정 (모델, 사이즈, 배치)은 PromptDock 인라인으로 이동됨
 * sidebarOpen 상태에 따라 슬라이드 인/아웃 애니메이션
 */

'use client'

import { useCallback } from 'react'
import { useAppStore, type LoraConfig } from '@/stores/useAppStore'
import { useModels } from '@/hooks/useModels'
import { PlusIcon, RefreshIcon, XIcon } from './icons'

// ── 사이드바 서브 컴포넌트 ──

/** 섹션 래퍼 */
function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="px-3.5 py-3 border-b border-edge">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-dim mb-2.5">
        {title}
      </h3>
      {children}
    </div>
  )
}

/** 레이블 */
function Label({ text, mt = false }: { text: string; mt?: boolean }) {
  return (
    <label className={`block text-[11px] text-text-sub mb-1 ${mt ? 'mt-3' : ''}`}>
      {text}
    </label>
  )
}

/** LoRA 아이템 */
function LoraItem({
  lora,
  onStrengthChange,
  onRemove,
}: {
  lora: LoraConfig
  onStrengthChange: (strength: number) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-ground ring-1 ring-edge group">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-mono text-text truncate">{lora.name}</p>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={lora.strengthModel}
          onChange={(e) => onStrengthChange(parseFloat(e.target.value))}
          className="w-full mt-1.5"
        />
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] font-mono text-accent-bright tabular-nums">
          {lora.strengthModel.toFixed(2)}
        </span>
        <button
          onClick={onRemove}
          className="text-text-ghost hover:text-bad transition-colors opacity-0 group-hover:opacity-100"
        >
          <XIcon />
        </button>
      </div>
    </div>
  )
}

/** 슬라이더 필드 */
function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-text-sub">{label}</span>
        <span className="text-[11px] font-mono text-accent-bright tabular-nums">
          {step < 1 ? value.toFixed(1) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}

export default function SettingsSidebar() {
  // 모델 목록 (ComfyUI 실행 시 자동 갱신)
  const availableModels = useModels()

  // 사이드바 토글 상태
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)

  // 스토어 상태 및 액션 (고급 설정만)
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

  /** LoRA 추가 (사용 가능한 목록에서 아직 추가되지 않은 첫 번째 LoRA) */
  const handleAddLora = useCallback(() => {
    const addedNames = new Set(loras.map((l) => l.name))
    const available = availableModels.loras.filter((n) => !addedNames.has(n))

    if (available.length > 0) {
      addLora({
        name: available[0],
        strengthModel: 0.7,
        strengthClip: 0.7,
      })
    }
  }, [loras, availableModels.loras, addLora])

  /** 시드 랜덤화 */
  const handleRandomSeed = useCallback(() => {
    setSeed(-1)
  }, [setSeed])

  return (
    <aside className="w-[240px] shrink-0 border-l border-edge bg-ground/60 flex flex-col overflow-y-auto overflow-x-hidden transition-all duration-200">
      {/* 사이드바 헤더 — 제목 + 닫기 버튼 */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-edge">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
          고급 설정
        </h2>
        <button
          onClick={() => setSidebarOpen(false)}
          className="w-6 h-6 flex items-center justify-center rounded-md text-text-sub hover:text-text hover:bg-white/[0.06] transition-all"
          title="사이드바 닫기"
        >
          <XIcon />
        </button>
      </div>

      {/* ── VAE 섹션 ── */}
      <Section title="VAE">
        <Label text="VAE 모델" />
        <select
          className="input-field text-[11px] font-mono"
          value={vae}
          onChange={(e) => setVae(e.target.value)}
        >
          <option value="">기본값 (모델 내장)</option>
          {availableModels.vaes.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Section>

      {/* ── LoRA 섹션 ── */}
      <Section title="LoRA">
        <div className="space-y-2">
          {loras.map((lora) => (
            <LoraItem
              key={lora.name}
              lora={lora}
              onStrengthChange={(strength) =>
                updateLoraStrength(lora.name, strength, strength)
              }
              onRemove={() => removeLora(lora.name)}
            />
          ))}
        </div>
        {/* LoRA가 없을 때 안내 */}
        {loras.length === 0 && (
          <p className="text-[10px] text-text-ghost text-center py-2">
            추가된 LoRA가 없습니다
          </p>
        )}
        <button
          onClick={handleAddLora}
          disabled={availableModels.loras.length === 0}
          className="mt-2.5 flex items-center gap-1.5 text-[11px] text-accent-bright hover:text-accent transition-colors w-full justify-center py-1.5 rounded-lg border border-dashed border-edge hover:border-edge-accent disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <PlusIcon /> LoRA 추가
        </button>
      </Section>

      {/* ── 설정 섹션 (Steps, CFG, Seed, 샘플러, 스케줄러) ── */}
      <Section title="설정">
        <div className="space-y-3">
          {/* Steps 슬라이더 */}
          <SliderField
            label="Steps"
            value={steps}
            min={1}
            max={100}
            onChange={setSteps}
          />

          {/* CFG 슬라이더 */}
          <SliderField
            label="CFG"
            value={cfg}
            min={1}
            max={20}
            step={0.5}
            onChange={setCfg}
          />

          {/* 시드 입력 */}
          <Label text="시드" mt />
          <div className="flex gap-1.5">
            <input
              type="text"
              value={seed}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                setSeed(isNaN(val) ? -1 : val)
              }}
              className="input-field font-mono text-[11px] flex-1"
            />
            <button
              onClick={handleRandomSeed}
              className="px-2 rounded-md bg-ground ring-1 ring-edge hover:ring-edge-hover text-text-sub hover:text-text transition-all"
              title="랜덤"
            >
              <RefreshIcon />
            </button>
          </div>

          {/* 샘플러 선택 */}
          <Label text="샘플러" mt />
          <select
            className="input-field text-[11px] font-mono"
            value={sampler}
            onChange={(e) => setSampler(e.target.value)}
          >
            <option value="dpmpp_2m">dpmpp_2m</option>
            <option value="euler">euler</option>
            <option value="euler_ancestral">euler_ancestral</option>
            <option value="ddim">ddim</option>
          </select>

          {/* 스케줄러 선택 */}
          <Label text="스케줄러" mt />
          <select
            className="input-field text-[11px] font-mono"
            value={scheduler}
            onChange={(e) => setScheduler(e.target.value)}
          >
            <option value="karras">karras</option>
            <option value="normal">normal</option>
            <option value="exponential">exponential</option>
            <option value="sgm_uniform">sgm_uniform</option>
          </select>
        </div>
      </Section>
    </aside>
  )
}
