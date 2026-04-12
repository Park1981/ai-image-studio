/**
 * 이미지 수정 모드 훅
 * 수정 모드 생성 실행 + WebSocket 연결 로직 전담
 * GenerateButton / EnhanceResult에 산재하던 수정 모드 생성 로직을 통합
 */

'use client'

import { useCallback, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api } from '@/lib/api'

export function useEditMode() {
  // 중복 호출 방지 guard
  const busyRef = useRef(false)

  /** 수정 모드 이미지 생성 실행 (WebSocket 연결 포함) */
  const executeEdit = useCallback(async (editPrompt: string) => {
    const store = useAppStore.getState()
    const { editSourceImage } = store

    if (!editSourceImage) {
      store.setErrorMessage('수정할 이미지를 먼저 업로드해주세요.')
      return
    }
    if (!editPrompt.trim()) {
      store.setErrorMessage('수정할 내용을 설명해주세요.')
      return
    }
    if (busyRef.current) return
    busyRef.current = true

    // 상태 초기화
    store.setGenerationStatus('warming_up')
    store.setProgress(0)
    store.setErrorMessage(null)
    store.setEnhancePending(false)
    store.setEnhanceFallback(false)
    store.setEnhancedCategories([])

    try {
      const response = await api.generateEdit({
        source_image: editSourceImage,
        edit_prompt: editPrompt.trim(),
        steps: store.steps,
        cfg: store.cfg,
        seed: store.seed,
      })

      if (!response.success) {
        store.setGenerationStatus('error')
        store.setErrorMessage(response.error || '이미지 수정 요청에 실패했습니다.')
        return
      }

      const { task_id } = response.data
      store.setCurrentTaskId(task_id)

      // WebSocket 연결하여 진행 상황 수신
      const wsUrl = api.wsUrl('/api/ws/generate')
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => ws.send(JSON.stringify({ task_id }))

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data)
          const s = useAppStore.getState()
          switch (msg.type) {
            case 'status':
              if (['warming_up', 'enhancing', 'generating'].includes(msg.status)) {
                s.setGenerationStatus(msg.status)
              }
              break
            case 'progress':
              s.setProgress(msg.progress)
              s.setGenerationStatus('generating')
              break
            case 'executing':
              s.setGenerationStatus('generating')
              break
            case 'completed':
              s.setGenerationStatus('completed')
              s.setProgress(100)
              s.setGeneratedImages(msg.images)
              ws.close()
              break
            case 'error':
              s.setGenerationStatus('error')
              s.setErrorMessage(msg.message || msg.error || '이미지 수정 중 오류')
              ws.close()
              break
          }
        } catch { /* JSON 파싱 실패 시 무시 */ }
      }

      ws.onerror = () => ws.close()
    } catch {
      store.setGenerationStatus('error')
      store.setErrorMessage('이미지 수정 중 예상치 못한 오류가 발생했습니다.')
    } finally {
      busyRef.current = false
    }
  }, [])

  return { executeEdit }
}
