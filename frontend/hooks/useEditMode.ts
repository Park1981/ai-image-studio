/**
 * 이미지 수정 모드 훅
 * 수정 모드 생성 실행 + WebSocket 연결 로직 전담
 * useWebSocket 훅을 재사용하여 재접속/종결 처리 일관성 확보 (중복 dispatcher 제거)
 */

'use client'

import { useCallback, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api } from '@/lib/api'
import { useWebSocket } from './useWebSocket'

/** 백엔드 이미지 서버 기본 URL */
const IMAGE_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'

export function useEditMode() {
  // 중복 호출 방지 guard
  const busyRef = useRef(false)

  // 생성 모드와 동일한 WS 훅 재사용 (재접속/종결/dispatcher 일관)
  const { connect } = useWebSocket()

  /**
   * 생성된 이미지에서 바로 수정 모드로 전환
   * 재업로드 없이 서버 내 이미지 경로를 직접 사용
   */
  const startEditFromGenerated = useCallback((imageUrl: string, filename: string) => {
    const store = useAppStore.getState()

    // imageUrl에서 서버 내 경로 추출: /images/2026-04-11/xxx.png → 2026-04-11/xxx.png
    const pathMatch = imageUrl.match(/\/images\/(.+)/)
    const serverPath = pathMatch ? pathMatch[1] : filename

    // editMode ON + 소스 이미지 경로 설정
    store.setEditSourceImage(serverPath)
    store.setEditSourcePreview(`${IMAGE_BASE}${imageUrl}`)
    store.setEditMode(true)
    store.setSelectedImageIndex(null)
  }, [])

  /** 수정 모드 이미지 생성 실행 (useWebSocket으로 진행 상황 수신) */
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
    // 주의: enhancePending/enhancedCategories 는 의도적으로 유지 —
    //       생성 중에도 "사용된 보강 프롬프트"가 UI에 남아있어야 사용자 혼란 방지
    store.setGenerationStatus('warming_up')
    store.setProgress(0)
    store.setErrorMessage(null)

    try {
      const response = await api.generateEdit({
        source_image: editSourceImage,
        edit_prompt: editPrompt.trim(),
        auto_enhance: store.autoEnhance,
        checkpoint: store.checkpoint,
        loras: store.loras.map((l) => ({
          name: l.name,
          strength_model: l.strengthModel,
          strength_clip: l.strengthClip,
        })),
        vae: store.vae,
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

      // 생성 모드와 동일한 WebSocket 훅 사용 — 재접속/종결 처리 일관
      connect(task_id)
    } catch {
      store.setGenerationStatus('error')
      store.setErrorMessage('이미지 수정 중 예상치 못한 오류가 발생했습니다.')
    } finally {
      busyRef.current = false
    }
  }, [connect])

  return { executeEdit, startEditFromGenerated }
}
