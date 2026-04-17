/**
 * AI 프롬프트 보강 훅
 * Ollama 기반 프롬프트 보강/확인/취소 로직 전담
 * useGenerate에서 분리하여 단일 책임 원칙 준수
 */

'use client'

import { useCallback, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api } from '@/lib/api'

export function useEnhance() {
  // 중복 호출 방지 guard
  const busyRef = useRef(false)

  // 스토어에서 필요한 상태와 액션
  const prompt = useAppStore((s) => s.prompt)
  const enhancedPrompt = useAppStore((s) => s.enhancedPrompt)
  const enhancedNegative = useAppStore((s) => s.enhancedNegative)
  const enhancePending = useAppStore((s) => s.enhancePending)
  const negativePrompt = useAppStore((s) => s.negativePrompt)

  const setGenerationStatus = useAppStore((s) => s.setGenerationStatus)
  const setProgress = useAppStore((s) => s.setProgress)
  const setErrorMessage = useAppStore((s) => s.setErrorMessage)
  const setEnhancedPrompt = useAppStore((s) => s.setEnhancedPrompt)
  const setEnhancedNegative = useAppStore((s) => s.setEnhancedNegative)
  const setEnhancePending = useAppStore((s) => s.setEnhancePending)
  const setEnhanceFallback = useAppStore((s) => s.setEnhanceFallback)

  /** AI 프롬프트 보강 실행 (sourcePrompt 지정 시 해당 프롬프트로 보강) */
  const enhance = useCallback(async (sourcePrompt?: string, mode?: 'generate' | 'edit') => {
    const textToEnhance = sourcePrompt ?? prompt.trim()
    if (!textToEnhance) {
      setErrorMessage('프롬프트를 입력해주세요.')
      return
    }
    if (busyRef.current) return
    busyRef.current = true

    try {
      setGenerationStatus('enhancing')
      setProgress(0)
      setErrorMessage(null)

      // 프리셋 스타일 힌트 + Ollama 모델 + 보강 설정을 전달
      const { activeStyleHint, ollamaModel, enhanceSettings, editMode, editSourceImage, enhanceLlmProvider } = useAppStore.getState()

      // 수정 모드 + 소스 이미지 있으면 비전(이미지 분석) API 사용
      const useVision = (mode === 'edit' || editMode) && !!editSourceImage
      const response = useVision
        ? await api.enhanceEditPrompt(
            textToEnhance,
            editSourceImage!,
            activeStyleHint,
            ollamaModel,
            {
              creativity: enhanceSettings.creativity,
              detailLevel: enhanceSettings.detailLevel,
              categories: enhanceSettings.categories,
            }
          )
        : await api.enhancePrompt(
            textToEnhance,
            activeStyleHint,
            ollamaModel,
            {
              mode: mode || 'generate',
              creativity: enhanceSettings.creativity,
              detail_level: enhanceSettings.detailLevel,
              categories: enhanceSettings.categories,
              provider: enhanceLlmProvider,
            }
          )

      if (response.success && response.data) {
        setEnhancedPrompt(response.data.enhanced)
        setEnhancedNegative(response.data.negative || '')
        setEnhanceFallback(response.data.fallback ?? false)
        // 보강 제공자 저장 (ollama | claude_cli | fallback)
        useAppStore.getState().setEnhanceProvider(response.data.provider || 'ollama')
        // 카테고리 상세 결과 저장
        useAppStore.getState().setEnhancedCategories(response.data.categories || [])
        setEnhancePending(true)
        setGenerationStatus('idle')
      } else {
        // 실패 시 — 이전 보강 세션 상태가 남아있을 수 있으므로 명시적 초기화
        resetEnhanceState()
        setErrorMessage(response.error || '프롬프트 보강에 실패했습니다.')
      }
    } catch {
      // 에러 시 — 동일하게 상태 정리
      resetEnhanceState()
      setErrorMessage('프롬프트 보강 중 오류가 발생했습니다.')
    } finally {
      busyRef.current = false
    }

    // 성공/실패 분기 공통 상태 정리 헬퍼
    function resetEnhanceState() {
      setEnhancedPrompt('')
      setEnhancedNegative('')
      setEnhanceFallback(false)
      setEnhancePending(false)  // 보강 대기 상태 해제 (UI 오염 방지)
      useAppStore.getState().setEnhancedCategories([])
      useAppStore.getState().setEnhanceProvider('ollama')
      setGenerationStatus('idle')
    }
  }, [
    prompt, setGenerationStatus, setProgress, setErrorMessage,
    setEnhancedPrompt, setEnhancedNegative, setEnhancePending,
    setEnhanceFallback,
  ])

  /** 보강 결과 확인 → 최종 프롬프트 반환 (생성 트리거는 호출자 담당) */
  const getEnhancedResult = useCallback(() => {
    const finalPrompt = enhancedPrompt || prompt.trim()
    const finalNegative = enhancedNegative || negativePrompt.trim()
    return { finalPrompt, finalNegative }
  }, [enhancedPrompt, enhancedNegative, prompt, negativePrompt])

  /** 보강 취소 (원래 프롬프트로 복귀) */
  const cancelEnhance = useCallback(() => {
    setEnhancePending(false)
    setEnhancedPrompt('')
    setEnhancedNegative('')
    setEnhanceFallback(false)
    setGenerationStatus('idle')
    useAppStore.getState().setEnhanceProvider('ollama')
    useAppStore.getState().setEnhancedCategories([])
  }, [setEnhancePending, setEnhancedPrompt, setEnhancedNegative, setEnhanceFallback, setGenerationStatus])

  return {
    enhance,
    getEnhancedResult,
    cancelEnhance,
    enhancePending,
    enhancedPrompt,
    enhancedNegative,
  }
}
