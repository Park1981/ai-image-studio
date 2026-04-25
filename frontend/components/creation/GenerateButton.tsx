/**
 * 생성/수정 버튼 컴포넌트
 * 모드에 따라 텍스트 변경, 로딩 상태, Ctrl+Enter 단축키
 */

'use client'

import { useCallback, useEffect } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useGenerate } from '@/hooks/useGenerate'
import { useEnhance } from '@/hooks/useEnhance'
import { useEditMode } from '@/hooks/useEditMode'
import { BoltIcon, EditIcon, StopIcon, SparkleIcon } from '../icons'

export default function GenerateButton() {
  // ── 스토어 상태 ──
  const prompt = useAppStore((s) => s.prompt)
  const editMode = useAppStore((s) => s.editMode)
  const editSourceImage = useAppStore((s) => s.editSourceImage)
  const autoEnhance = useAppStore((s) => s.autoEnhance)
  const enhancePending = useAppStore((s) => s.enhancePending)
  const enhancedPrompt = useAppStore((s) => s.enhancedPrompt)

  const { generate, confirmEnhance, cancel, isGenerating } = useGenerate()
  const { enhance, cancelEnhance } = useEnhance()
  const { executeEdit } = useEditMode()

  /** 수정 모드 생성 */
  const handleEditGenerate = useCallback(async () => {
    const setErrorMessage = useAppStore.getState().setErrorMessage
    if (!editSourceImage) { setErrorMessage('수정할 이미지를 먼저 업로드해주세요.'); return }
    if (!prompt.trim()) { setErrorMessage('수정할 내용을 설명해주세요.'); return }

    // autoEnhance ON + 아직 보강 안 된 경우 → 먼저 보강
    if (autoEnhance && !enhancePending) {
      await enhance(prompt.trim(), 'edit')
      return
    }

    // 보강 완료 상태면 보강 프롬프트 사용, 아니면 원본 사용
    const finalPrompt = enhancePending ? (enhancedPrompt || prompt.trim()) : prompt.trim()
    await executeEdit(finalPrompt)
  }, [editSourceImage, prompt, autoEnhance, enhancePending, enhancedPrompt, enhance, executeEdit])

  /** 통합 생성 버튼 클릭 */
  const handleGenerateClick = useCallback(() => {
    if (isGenerating) cancel()
    else if (editMode) handleEditGenerate()
    else if (enhancePending) confirmEnhance()
    else generate()
  }, [isGenerating, editMode, handleEditGenerate, enhancePending, generate, confirmEnhance, cancel])

  // ── 단축키: Ctrl+Enter → 생성, Escape → 보강 취소 ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (enhancePending) {
          if (editMode) {
            handleEditGenerate()
          } else {
            confirmEnhance()
          }
        } else if (editMode && !isGenerating && prompt.trim()) {
          handleEditGenerate()
        } else if (!isGenerating && prompt.trim()) {
          generate()
        }
      }
      if (e.key === 'Escape' && enhancePending) {
        const viewerOpen = useAppStore.getState().viewerIndex !== null
        if (!viewerOpen) cancelEnhance()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [generate, handleEditGenerate, confirmEnhance, cancelEnhance, isGenerating, enhancePending, editMode, prompt])

  // ── 버튼 레이블 상태별 결정 ──
  // 1. 생성/수정 진행 중   → "취소"
  // 2. 보강 완료 대기 상태 → "이미지 생성" / "이미지 수정" (보강 결과로 실제 생성 실행)
  // 3. autoEnhance ON + 입력 있음 → "프롬프트 보강" (보강 단계 선행)
  // 4. autoEnhance OFF    → "이미지 생성" / "이미지 수정" (즉시 실행)
  let buttonLabel: React.ReactNode
  if (isGenerating) {
    buttonLabel = <><StopIcon /> 취소</>
  } else if (enhancePending) {
    buttonLabel = editMode ? <><EditIcon /> 이미지 수정</> : <><BoltIcon /> 이미지 생성</>
  } else if (autoEnhance && prompt.trim()) {
    buttonLabel = <><SparkleIcon /> 프롬프트 보강</>
  } else {
    buttonLabel = editMode ? <><EditIcon /> 이미지 수정</> : <><BoltIcon /> 이미지 생성</>
  }

  return (
    <div className="shrink-0 px-3 py-2.5 border-t border-edge">
      <button
        onClick={handleGenerateClick}
        disabled={!isGenerating && !prompt.trim()}
        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${
          isGenerating
            ? 'bg-bad/20 text-bad hover:bg-bad/30 border border-bad/30'
            : 'btn-glow text-white disabled:opacity-30 disabled:cursor-not-allowed'
        }`}
      >
        {buttonLabel}
      </button>
      <span className="block text-center text-[10px] text-text-ghost mt-1">Ctrl+Enter</span>
    </div>
  )
}
