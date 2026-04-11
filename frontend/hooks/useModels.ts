/**
 * 모델 목록 조회 훅
 * ComfyUI가 실행 중일 때 사용 가능한 모델 목록을 가져옴
 */

'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api } from '@/lib/api'

export function useModels() {
  const processStatus = useAppStore((s) => s.processStatus)
  const availableModels = useAppStore((s) => s.availableModels)
  const setAvailableModels = useAppStore((s) => s.setAvailableModels)

  // ComfyUI 실행 상태가 변경될 때 모델 목록 다시 가져오기
  const comfyuiRunning = processStatus.comfyui.running

  useEffect(() => {
    if (!comfyuiRunning) return

    const fetchModels = async () => {
      const response = await api.getModels()

      if (response.success && response.data) {
        setAvailableModels({
          checkpoints: response.data.checkpoints ?? [],
          diffusionModels: response.data.diffusion_models ?? [],
          loras: response.data.loras ?? [],
          vaes: response.data.vaes ?? [],
        })
        // 워크플로우 기본 모델 사용 — 체크포인트 자동 선택 안 함
        // Qwen Image 등 UNET 기반 워크플로우는 모델이 내장되어 있으므로
        // 사용자가 직접 선택할 때만 checkpoint 값 변경
      }
    }

    fetchModels()
  }, [comfyuiRunning, setAvailableModels])

  return availableModels
}
