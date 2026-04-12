/**
 * 프롬프트 입력 컴포넌트
 * 메인 프롬프트 textarea + 네거티브 프롬프트 토글 + AI 보강 체크박스
 */

'use client'

import { useState } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { SparkleIcon, XCircleIcon } from '../icons'

export default function PromptInput() {
  // ── 스토어 상태 ──
  const prompt = useAppStore((s) => s.prompt)
  const setPrompt = useAppStore((s) => s.setPrompt)
  const negativePrompt = useAppStore((s) => s.negativePrompt)
  const setNegativePrompt = useAppStore((s) => s.setNegativePrompt)
  const autoEnhance = useAppStore((s) => s.autoEnhance)
  const setAutoEnhance = useAppStore((s) => s.setAutoEnhance)
  const enhancePending = useAppStore((s) => s.enhancePending)
  const generationStatus = useAppStore((s) => s.generationStatus)
  const editMode = useAppStore((s) => s.editMode)

  // ── 로컬 상태 ──
  const [showNegative, setShowNegative] = useState(false)

  const isGenerating =
    generationStatus === 'generating' ||
    generationStatus === 'warming_up' ||
    generationStatus === 'enhancing'
  const isEnhancing = generationStatus === 'enhancing'

  return (
    <>
      {/* 프롬프트 textarea */}
      <div className="px-3 pt-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={editMode ? '수정할 내용을 설명해주세요...' : '이미지를 설명해주세요... (한국어 입력 가능)'}
          rows={3}
          disabled={isGenerating || enhancePending}
          className="w-full bg-surface rounded-lg resize-none outline-none px-3 py-2.5 text-[13px] placeholder-text-ghost leading-relaxed border border-edge focus:border-accent disabled:opacity-50"
        />
      </div>

      {/* AI 보강 토글 + 네거티브 토글 */}
      <div className="px-3 py-2 flex items-center gap-2">
        <button
          onClick={() => setAutoEnhance(!autoEnhance)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
            autoEnhance ? 'bg-accent-muted text-accent-bright' : 'text-text-sub hover:text-text hover:bg-white/[0.04]'
          }`}
          disabled={isEnhancing}
        >
          <SparkleIcon /> AI 보강
        </button>
        {!editMode && (
          <button
            onClick={() => setShowNegative(!showNegative)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] transition-all ${
              showNegative ? 'bg-bad/10 text-bad' : 'text-text-sub hover:text-text hover:bg-white/[0.04]'
            }`}
          >
            <XCircleIcon /> 네거티브
          </button>
        )}
      </div>

      {/* 네거티브 프롬프트 */}
      {showNegative && !enhancePending && (
        <div className="px-3 pb-2">
          <textarea
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="제외할 요소..."
            rows={2}
            disabled={isGenerating}
            className="w-full bg-surface rounded-lg resize-none outline-none px-3 py-2 text-[12px] placeholder-text-ghost leading-relaxed text-bad/70 border border-edge focus:border-bad/40 disabled:opacity-50"
          />
        </div>
      )}
    </>
  )
}
