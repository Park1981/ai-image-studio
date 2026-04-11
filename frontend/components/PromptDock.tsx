/**
 * 프롬프트 입력 독 컴포넌트
 * 프롬프트 입력 + 인라인 기본 설정 (모델, 사이즈, 배치)
 * AI 보강 2단계: 보강 → 사용자 확인/수정 → 이미지 생성
 */

'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useGenerate } from '@/hooks/useGenerate'
import { useModels } from '@/hooks/useModels'
import { getAllPresets, saveCustomPresets, loadCustomPresets, type Preset } from '@/lib/presets'
import { SparkleIcon, XCircleIcon, BoltIcon, StopIcon, GearIcon } from './icons'

/** 사이즈 프리셋 목록 (Qwen Image 권장 해상도 포함) */
const SIZE_PRESETS = [
  { label: '1:1', w: 1328, h: 1328 },
  { label: '16:9', w: 1664, h: 928 },
  { label: '9:16', w: 928, h: 1664 },
  { label: '4:3', w: 1472, h: 1104 },
  { label: '3:2', w: 1584, h: 1056 },
] as const

/** 배치 수 옵션 */
const BATCH_OPTIONS = [1, 2, 3, 4] as const

export default function PromptDock() {
  const prompt = useAppStore((s) => s.prompt)
  const setPrompt = useAppStore((s) => s.setPrompt)
  const negativePrompt = useAppStore((s) => s.negativePrompt)
  const setNegativePrompt = useAppStore((s) => s.setNegativePrompt)
  const autoEnhance = useAppStore((s) => s.autoEnhance)
  const setAutoEnhance = useAppStore((s) => s.setAutoEnhance)
  const enhancedPrompt = useAppStore((s) => s.enhancedPrompt)
  const setEnhancedPrompt = useAppStore((s) => s.setEnhancedPrompt)
  const enhancePending = useAppStore((s) => s.enhancePending)
  const enhancedNegative = useAppStore((s) => s.enhancedNegative)
  const generationStatus = useAppStore((s) => s.generationStatus)
  const setErrorMessage = useAppStore((s) => s.setErrorMessage)

  // 인라인 설정 상태
  const checkpoint = useAppStore((s) => s.checkpoint)
  const setCheckpoint = useAppStore((s) => s.setCheckpoint)
  const width = useAppStore((s) => s.width)
  const setWidth = useAppStore((s) => s.setWidth)
  const height = useAppStore((s) => s.height)
  const setHeight = useAppStore((s) => s.setHeight)
  const batchSize = useAppStore((s) => s.batchSize)
  const setBatchSize = useAppStore((s) => s.setBatchSize)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)

  // 모델 목록 가져오기
  const availableModels = useModels()

  const {
    generate, enhance, confirmEnhance, cancelEnhance,
    cancel, isGenerating,
  } = useGenerate()

  // 네거티브 프롬프트 표시 토글
  const [showNegative, setShowNegative] = useState(false)

  // 텍스트영역 참조
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // AI 보강 중 여부
  const isEnhancing = generationStatus === 'enhancing'

  /** Ctrl+Enter 단축키로 생성/확인 */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (enhancePending) {
          confirmEnhance()
        } else if (!isGenerating && prompt.trim()) {
          generate()
        }
      }
      // ESC로 보강 취소 (풀스크린 뷰어가 열려있으면 뷰어가 우선 처리)
      if (e.key === 'Escape' && enhancePending) {
        const viewerOpen = useAppStore.getState().viewerIndex !== null
        if (!viewerOpen) cancelEnhance()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [generate, confirmEnhance, cancelEnhance, isGenerating, enhancePending, prompt])

  /** 생성/취소 버튼 클릭 */
  const handleGenerateClick = useCallback(() => {
    if (isGenerating) {
      cancel()
    } else if (enhancePending) {
      confirmEnhance()
    } else {
      generate()
    }
  }, [isGenerating, enhancePending, generate, confirmEnhance, cancel])

  /** 프리셋 적용 */
  const handlePresetSelect = useCallback((presetId: string) => {
    const preset = getAllPresets().find((p) => p.id === presetId)
    if (!preset) return
    useAppStore.getState().setSampler(preset.params.sampler)
    useAppStore.getState().setScheduler(preset.params.scheduler)
    useAppStore.getState().setSteps(preset.params.steps)
    useAppStore.getState().setCfg(preset.params.cfg)
    useAppStore.getState().setWidth(preset.params.width)
    useAppStore.getState().setHeight(preset.params.height)
  }, [])

  // 프리셋 목록 상태 (커스텀 저장 시 즉시 갱신용)
  const [presetList, setPresetList] = useState(() => getAllPresets())

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
      params: {
        sampler: store.sampler,
        scheduler: store.scheduler,
        steps: store.steps,
        cfg: store.cfg,
        width: store.width,
        height: store.height,
      },
    }
    custom.push(newPreset)
    saveCustomPresets(custom)
    setPresetList(getAllPresets())
  }, [])

  /** 현재 사이즈 프리셋 라벨 계산 */
  const currentSizeLabel =
    SIZE_PRESETS.find((p) => p.w === width && p.h === height)?.label ?? 'custom'

  return (
    <div className="shrink-0 px-2 pb-2">
      <div className="prompt-glow rounded-xl bg-surface border border-edge transition-all">
        {/* 메인 프롬프트 입력 */}
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="이미지를 설명해주세요... (한국어 입력 가능)"
          rows={2}
          disabled={isGenerating || enhancePending}
          className="w-full bg-transparent resize-none outline-none px-4 pt-3 pb-1 text-[13px] placeholder-text-ghost leading-relaxed disabled:opacity-50"
        />

        {/* AI 보강 결과 확인 영역 (2단계 플로우) */}
        {enhancePending && enhancedPrompt && (
          <div className="mx-3 mb-2 rounded-lg border border-accent/30 bg-accent-muted/30 p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <SparkleIcon />
              <span className="text-[11px] font-medium text-accent-bright">AI 보강 결과</span>
              <span className="text-[10px] text-text-ghost ml-auto">수정 가능</span>
            </div>
            {/* 보강된 프롬프트 편집 가능 */}
            <textarea
              value={enhancedPrompt}
              onChange={(e) => setEnhancedPrompt(e.target.value)}
              rows={3}
              className="w-full bg-ground/50 rounded-md resize-none outline-none px-3 py-2 text-[12px] text-text leading-relaxed border border-edge focus:border-accent"
            />
            {/* 보강된 네거티브 프롬프트 */}
            {enhancedNegative && (
              <p className="mt-1.5 text-[10px] text-bad/60 truncate">
                네거티브: {enhancedNegative}
              </p>
            )}
            {/* 액션 버튼 */}
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => confirmEnhance()}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-semibold btn-glow text-white"
              >
                <BoltIcon />
                이미지 생성
              </button>
              <button
                onClick={() => enhance(enhancedPrompt)}
                disabled={isEnhancing}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-accent-bright hover:bg-accent-muted transition-all border border-accent/30"
              >
                {isEnhancing ? '보강 중...' : '다시 보강'}
              </button>
              <button
                onClick={() => cancelEnhance()}
                className="px-3 py-1.5 rounded-lg text-[11px] text-text-sub hover:text-text hover:bg-white/[0.04] transition-all"
              >
                취소
              </button>
              <span className="text-[10px] text-text-ghost ml-auto hidden lg:inline">
                Ctrl+Enter 생성 · ESC 취소
              </span>
            </div>
          </div>
        )}

        {/* 보강 대기 중이 아닐 때만 기존 보강 프리뷰 표시 */}
        {!enhancePending && enhancedPrompt && enhancedPrompt !== prompt && (
          <div className="px-4 pb-1">
            <p className="text-[10px] text-accent-bright/60 truncate">
              AI 보강: {enhancedPrompt}
            </p>
          </div>
        )}

        {/* 네거티브 프롬프트 입력 (토글) */}
        {showNegative && !enhancePending && (
          <div className="px-4 pb-1 border-t border-edge/50">
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="제외할 요소를 입력하세요... (네거티브 프롬프트)"
              rows={1}
              disabled={isGenerating}
              className="w-full bg-transparent resize-none outline-none pt-2 pb-1 text-[12px] placeholder-text-ghost leading-relaxed text-bad/70 disabled:opacity-50"
            />
          </div>
        )}

        {/* 하단 액션 바 — 보강 대기 중이면 숨김 */}
        {!enhancePending && (
          <div className="flex items-center justify-between px-2.5 pb-2 gap-1 flex-wrap">
            <div className="flex items-center gap-1 flex-wrap">
              {/* AI 보강 토글 */}
              <button
                onClick={autoEnhance ? () => setAutoEnhance(false) : () => setAutoEnhance(true)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                  autoEnhance
                    ? 'bg-accent-muted text-accent-bright'
                    : 'text-text-sub hover:text-text hover:bg-white/[0.04]'
                }`}
                title={autoEnhance ? '자동 보강 ON' : '자동 보강 OFF'}
                disabled={isEnhancing}
              >
                <SparkleIcon />
                AI 보강
              </button>

              {/* 네거티브 프롬프트 토글 */}
              <button
                onClick={() => setShowNegative(!showNegative)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] transition-all ${
                  showNegative
                    ? 'bg-bad/10 text-bad'
                    : 'text-text-sub hover:text-text hover:bg-white/[0.04]'
                }`}
              >
                <XCircleIcon />
                네거티브
              </button>

              {/* 구분선 */}
              <div className="w-px h-4 bg-edge mx-0.5" />

              {/* 프리셋 드롭다운 */}
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value === '__save__') {
                    handleSavePreset()
                  } else {
                    handlePresetSelect(e.target.value)
                  }
                  e.target.value = ''
                }}
                disabled={isGenerating}
                className="bg-ground text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge hover:border-edge-hover focus:border-accent outline-none transition-all cursor-pointer disabled:opacity-40"
              >
                <option value="">프리셋</option>
                {presetList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.icon} {p.name}
                  </option>
                ))}
                <option value="__save__">💾 현재 설정 저장...</option>
              </select>

              {/* 모델 드롭다운 */}
              <select
                value={checkpoint}
                onChange={(e) => setCheckpoint(e.target.value)}
                disabled={isGenerating}
                className="bg-ground text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge hover:border-edge-hover focus:border-accent outline-none transition-all max-w-[160px] truncate cursor-pointer disabled:opacity-40"
                title={checkpoint || 'Qwen Image (워크플로우 기본)'}
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

              {/* 사이즈 드롭다운 */}
              <select
                value={currentSizeLabel}
                onChange={(e) => {
                  const preset = SIZE_PRESETS.find((p) => p.label === e.target.value)
                  if (preset) {
                    setWidth(preset.w)
                    setHeight(preset.h)
                  }
                }}
                disabled={isGenerating}
                className="bg-ground text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge hover:border-edge-hover focus:border-accent outline-none transition-all cursor-pointer disabled:opacity-40"
              >
                {SIZE_PRESETS.map((preset) => (
                  <option key={preset.label} value={preset.label}>
                    {preset.label}
                  </option>
                ))}
              </select>

              {/* 배치 수 버튼 그룹 */}
              <div className="flex items-center rounded-lg border border-edge overflow-hidden">
                {BATCH_OPTIONS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setBatchSize(n)}
                    disabled={isGenerating}
                    className={`px-2 py-1.5 text-[11px] font-mono transition-all disabled:opacity-40 ${
                      batchSize === n
                        ? 'bg-accent-muted text-accent-bright'
                        : 'bg-ground text-text-sub hover:bg-elevated'
                    }`}
                    title={`${n}장 생성`}
                  >
                    x{n}
                  </button>
                ))}
              </div>

              {/* 고급 설정 토글 */}
              <button
                onClick={toggleSidebar}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] transition-all ${
                  sidebarOpen
                    ? 'bg-accent-muted text-accent-bright'
                    : 'text-text-sub hover:text-text hover:bg-white/[0.04]'
                }`}
                title="고급 설정 패널 열기/닫기"
              >
                <GearIcon />
                고급
              </button>

              {/* 단축키 안내 */}
              <span className="text-[10px] text-text-ghost ml-1 hidden lg:inline">
                Ctrl+Enter
              </span>
            </div>

            {/* 생성/취소 버튼 */}
            <button
              onClick={handleGenerateClick}
              disabled={!isGenerating && !prompt.trim()}
              className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-[13px] font-semibold transition-all shrink-0 ${
                isGenerating
                  ? 'bg-bad/20 text-bad hover:bg-bad/30 border border-bad/30'
                  : 'btn-glow text-white disabled:opacity-30 disabled:cursor-not-allowed'
              }`}
            >
              {isGenerating ? (
                <>
                  <StopIcon />
                  취소
                </>
              ) : (
                <>
                  <BoltIcon />
                  생성
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
