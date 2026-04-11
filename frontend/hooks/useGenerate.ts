/**
 * 이미지 생성 오케스트레이션 훅
 * 생성 요청 → 즉시 task_id 수신 → WebSocket으로 전체 라이프사이클 추적
 */

'use client'

import { useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api } from '@/lib/api'
import { useWebSocket } from './useWebSocket'

export function useGenerate() {
  const { connect, disconnect } = useWebSocket()

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

  /** 이미지 생성 시작 */
  const generate = useCallback(async () => {
    if (!prompt.trim()) {
      setErrorMessage('프롬프트를 입력해주세요.')
      return
    }

    if (generationStatus === 'generating' || generationStatus === 'warming_up') {
      return
    }

    try {
      // 상태 초기화
      setGenerationStatus('warming_up')
      setProgress(0)
      setErrorMessage(null)

      // 생성 요청 — 즉시 task_id 반환됨
      const response = await api.generate({
        prompt: prompt.trim(),
        negative_prompt: negativePrompt.trim() || undefined,
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
        auto_enhance: autoEnhance,
      })

      if (!response.success) {
        setGenerationStatus('error')
        setErrorMessage(response.error || '이미지 생성 요청에 실패했습니다.')
        return
      }

      // task_id 수신 → 즉시 WebSocket 연결하여 전체 라이프사이클 추적
      const { task_id } = response.data
      setCurrentTaskId(task_id)
      connect(task_id)
    } catch {
      setGenerationStatus('error')
      setErrorMessage('이미지 생성 중 예상치 못한 오류가 발생했습니다.')
    }
  }, [
    prompt, negativePrompt, autoEnhance, checkpoint, loras, vae,
    sampler, scheduler, width, height, steps, cfg, seed, batchSize,
    generationStatus, setGenerationStatus, setCurrentTaskId, setProgress,
    setErrorMessage, connect,
  ])

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

  return { generate, cancel, isGenerating }
}
