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
  const checkpoint = useAppStore((s) => s.checkpoint)
  const setCheckpoint = useAppStore((s) => s.setCheckpoint)

  // ComfyUI 실행 상태가 변경될 때 모델 목록 다시 가져오기
  const comfyuiRunning = processStatus.comfyui.running

  useEffect(() => {
    if (!comfyuiRunning) return

    const fetchModels = async () => {
      const response = await api.getModels()

      if (response.success && response.data) {
        setAvailableModels(response.data)

        // 체크포인트가 아직 설정되지 않았으면 첫 번째 모델 자동 선택
        if (!checkpoint && response.data.checkpoints.length > 0) {
          setCheckpoint(response.data.checkpoints[0])
        }
      }
    }

    fetchModels()
  }, [comfyuiRunning, setAvailableModels, checkpoint, setCheckpoint])

  return availableModels
}
