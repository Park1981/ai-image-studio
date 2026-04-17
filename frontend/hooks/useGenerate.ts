/**
 * 이미지 생성 오케스트레이션 훅
 * 2단계 플로우: AI보강 → 사용자 확인 → 이미지 생성
 * autoEnhance OFF면 바로 생성
 *
 * enhance 로직은 useEnhance 훅으로 분리,
 * editMode 생성 로직은 useEditMode 훅으로 분리
 */

'use client'

import { useCallback, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api } from '@/lib/api'
import { useWebSocket } from './useWebSocket'
import { useEnhance } from './useEnhance'

export function useGenerate() {
  const { connect, disconnect } = useWebSocket()
  const {
    enhance,
    getEnhancedResult,
    cancelEnhance,
    enhancePending,
  } = useEnhance()

  // 중복 호출 방지 guard (렌더 사이클보다 빠른 더블클릭/연타 차단)
  const busyRef = useRef(false)

  // 스토어에서 필요한 상태와 액션
  const prompt = useAppStore((s) => s.prompt)
  const negativePrompt = useAppStore((s) => s.negativePrompt)
  const autoEnhance = useAppStore((s) => s.autoEnhance)
  const checkpoint = useAppStore((s) => s.checkpoint)
  const loras = useAppStore((s) => s.loras)
  const vae = useAppStore((s) => s.vae)
  const sampler = useAppStore((s) => s.sampler)
  const scheduler = useAppStore((s) => s.scheduler)
  const width = useAppStore((s) => s.width)
  const height = useAppStore((s) => s.height)
  const steps = useAppStore((s) => s.steps)
  const cfg = useAppStore((s) => s.cfg)
  const seed = useAppStore((s) => s.seed)
  const batchSize = useAppStore((s) => s.batchSize)
  const generationStatus = useAppStore((s) => s.generationStatus)
  const currentTaskId = useAppStore((s) => s.currentTaskId)

  const setGenerationStatus = useAppStore((s) => s.setGenerationStatus)
  const setCurrentTaskId = useAppStore((s) => s.setCurrentTaskId)
  const setProgress = useAppStore((s) => s.setProgress)
  const setErrorMessage = useAppStore((s) => s.setErrorMessage)

  /** 이미지 생성 실행 (보강 확인 후 또는 autoEnhance OFF) */
  const startGeneration = useCallback(async (finalPrompt: string, finalNegative: string) => {
    if (generationStatus === 'generating' || generationStatus === 'warming_up') {
      return
    }
    if (busyRef.current) return
    busyRef.current = true

    try {
      // 보강 상태(enhancePending)는 의도적으로 유지 — 생성 중에도 보강 프롬프트 가시화
      setGenerationStatus('warming_up')
      setProgress(0)
      setErrorMessage(null)

      // auto_enhance=false — 이미 보강된 프롬프트를 직접 전달
      const response = await api.generate({
        prompt: finalPrompt,
        negative_prompt: finalNegative || undefined,
        checkpoint: checkpoint || undefined,
        loras: loras.length > 0
          ? loras.map((l) => ({
              name: l.name,
              strength_model: l.strengthModel,
              strength_clip: l.strengthClip,
            }))
          : undefined,
        vae: vae || undefined,
        sampler,
        scheduler,
        width,
        height,
        steps,
        cfg,
        seed,
        batch_size: batchSize,
        auto_enhance: false, // 프론트에서 이미 보강 완료
      })

      if (!response.success) {
        setGenerationStatus('error')
        setErrorMessage(response.error || '이미지 생성 요청에 실패했습니다.')
        return
      }

      const { task_id } = response.data
      setCurrentTaskId(task_id)
      connect(task_id)
    } catch {
      setGenerationStatus('error')
      setErrorMessage('이미지 생성 중 예상치 못한 오류가 발생했습니다.')
    } finally {
      busyRef.current = false
    }
  }, [
    generationStatus, checkpoint, loras, vae,
    sampler, scheduler, width, height, steps, cfg, seed, batchSize,
    setGenerationStatus, setCurrentTaskId, setProgress,
    setErrorMessage, connect,
  ])

  /** 통합 생성 버튼 핸들러 */
  const generate = useCallback(async () => {
    if (!prompt.trim()) {
      setErrorMessage('프롬프트를 입력해주세요.')
      return
    }

    if (autoEnhance) {
      // 2단계 플로우: 먼저 보강
      await enhance()
    } else {
      // 보강 없이 바로 생성
      await startGeneration(prompt.trim(), negativePrompt.trim())
    }
  }, [prompt, negativePrompt, autoEnhance, enhance, startGeneration, setErrorMessage])

  /** 보강 결과 확인 → 이미지 생성 */
  const confirmEnhance = useCallback(async () => {
    const { finalPrompt, finalNegative } = getEnhancedResult()
    await startGeneration(finalPrompt, finalNegative)
  }, [getEnhancedResult, startGeneration])

  /** 이미지 생성 취소 */
  const cancel = useCallback(async () => {
    if (!currentTaskId) return

    try {
      const response = await api.cancelGeneration(currentTaskId)
      if (response.success) {
        setGenerationStatus('cancelled')
        setProgress(0)
        disconnect()
      } else {
        setErrorMessage(response.error || '생성 취소에 실패했습니다.')
      }
    } catch {
      setErrorMessage('생성 취소 중 오류가 발생했습니다.')
    }
  }, [currentTaskId, setGenerationStatus, setProgress, setErrorMessage, disconnect])

  const isGenerating =
    generationStatus === 'generating' ||
    generationStatus === 'warming_up' ||
    generationStatus === 'enhancing'

  return {
    generate,
    enhance,
    confirmEnhance,
    cancelEnhance,
    cancel,
    isGenerating,
    enhancePending,
  }
}
