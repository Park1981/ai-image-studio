/**
 * 프롬프트 입력 독 컴포넌트
 * 프롬프트 입력 + 인라인 기본 설정 (모델, 사이즈, 배치)
 * AI 보강, 네거티브 프롬프트, 고급 설정 토글, 생성/취소 버튼
 */

'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useGenerate } from '@/hooks/useGenerate'
import { useModels } from '@/hooks/useModels'
import { api } from '@/lib/api'
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

  const { generate, cancel, isGenerating } = useGenerate()

  // 네거티브 프롬프트 표시 토글
  const [showNegative, setShowNegative] = useState(false)
  // AI 보강 로딩 상태
  const [isEnhancing, setIsEnhancing] = useState(false)

  // 텍스트영역 참조 (Ctrl+Enter 처리용)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /** Ctrl+Enter 단축키로 생성 */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!isGenerating && prompt.trim()) {
          generate()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [generate, isGenerating, prompt])

  /** AI 프롬프트 보강 호출 */
  const handleEnhance = useCallback(async () => {
    if (!prompt.trim() || isEnhancing) return

    setIsEnhancing(true)
    try {
      const response = await api.enhancePrompt(prompt.trim())

      if (response.success && response.data) {
        setEnhancedPrompt(response.data.enhanced)
        // 보강된 프롬프트로 교체
        setPrompt(response.data.enhanced)
        // 네거티브 프롬프트가 비어있으면 AI가 생성한 것으로 설정
        if (!negativePrompt.trim() && response.data.negative) {
          setNegativePrompt(response.data.negative)
        }
      } else {
        setErrorMessage(response.error || '프롬프트 보강에 실패했습니다.')
      }
    } catch {
      setErrorMessage('프롬프트 보강 중 오류가 발생했습니다.')
    } finally {
      setIsEnhancing(false)
    }
  }, [
    prompt, isEnhancing, negativePrompt,
    setPrompt, setNegativePrompt, setEnhancedPrompt, setErrorMessage,
  ])

  /** 생성/취소 버튼 클릭 */
  const handleGenerateClick = useCallback(() => {
    if (isGenerating) {
      cancel()
    } else {
      generate()
    }
  }, [isGenerating, generate, cancel])

  /** 현재 사이즈 프리셋 라벨 계산 */
  const currentSizeLabel = `${width}x${height}`

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
          disabled={isGenerating}
          className="w-full bg-transparent resize-none outline-none px-4 pt-3 pb-1 text-[13px] placeholder-text-ghost leading-relaxed disabled:opacity-50"
        />

        {/* 보강된 프롬프트 표시 (있을 경우) */}
        {enhancedPrompt && enhancedPrompt !== prompt && (
          <div className="px-4 pb-1">
            <p className="text-[10px] text-accent-bright/60 truncate">
              AI 보강: {enhancedPrompt}
            </p>
          </div>
        )}

        {/* 네거티브 프롬프트 입력 (토글) */}
        {showNegative && (
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

        {/* 하단 액션 바 — 인라인 설정 포함 */}
        <div className="flex items-center justify-between px-2.5 pb-2 gap-1 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {/* AI 보강 토글 */}
            <button
              onClick={autoEnhance ? () => setAutoEnhance(false) : () => setAutoEnhance(true)}
              onDoubleClick={handleEnhance}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                autoEnhance
                  ? 'bg-accent-muted text-accent-bright'
                  : 'text-text-sub hover:text-text hover:bg-white/[0.04]'
              }`}
              title={
                autoEnhance
                  ? '자동 보강 ON (더블클릭으로 수동 보강)'
                  : '자동 보강 OFF (더블클릭으로 수동 보강)'
              }
              disabled={isEnhancing}
            >
              <SparkleIcon />
              {isEnhancing ? '보강 중...' : 'AI 보강'}
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

            {/* 모델 드롭다운 (인라인) */}
            <select
              value={checkpoint}
              onChange={(e) => setCheckpoint(e.target.value)}
              disabled={isGenerating}
              className="bg-ground text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge hover:border-edge-hover focus:border-accent outline-none transition-all max-w-[140px] truncate cursor-pointer disabled:opacity-40"
              title={checkpoint || '모델 선택'}
            >
              <option value="">모델 선택</option>
              {availableModels.checkpoints.map((cp) => (
                <option key={cp} value={cp}>
                  {cp}
                </option>
              ))}
            </select>

            {/* 사이즈 드롭다운 (인라인) */}
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

            {/* 배치 수 버튼 그룹 (인라인) */}
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

            {/* 고급 설정 토글 버튼 */}
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
      </div>
    </div>
  )
}
