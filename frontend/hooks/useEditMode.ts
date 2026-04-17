/**
 * 이미지 수정 모드 훅
 * 수정 모드 생성 실행 + WebSocket 연결 로직 전담
 * GenerateButton / EnhanceResult에 산재하던 수정 모드 생성 로직을 통합
 */

'use client'

import { useCallback, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api } from '@/lib/api'

/** 백엔드 이미지 서버 기본 URL */
const IMAGE_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'

export function useEditMode() {
  // 중복 호출 방지 guard
  const busyRef = useRef(false)

  /**
   * 생성된 이미지에서 바로 수정 모드로 전환
   * 재업로드 없이 서버 내 이미지 경로를 직접 사용
   * 소스 이미지 해상도를 생성 파라미터(W/H)에 자동 반영
   */
  const startEditFromGenerated = useCallback((imageUrl: string, filename: string) => {
    const store = useAppStore.getState()

    // imageUrl에서 서버 내 경로 추출: /images/2026-04-11/xxx.png → data/images/2026-04-11/xxx.png
    // URL 형태: /images/날짜/파일명.png
    const pathMatch = imageUrl.match(/\/images\/(.+)/)
    const serverPath = pathMatch ? pathMatch[1] : filename
    const fullUrl = `${IMAGE_BASE}${imageUrl}`

    // editMode ON + 소스 이미지 경로 설정
    store.setEditSourceImage(serverPath)
    store.setEditSourcePreview(fullUrl)
    store.setEditMode(true)
    store.setSelectedImageIndex(null)

    // 소스 이미지 실제 해상도 추출 → W/H + 비율 자유로 반영
    const img = new Image()
    img.onload = () => {
      const snap = (n: number) => Math.round(Math.max(256, Math.min(2048, n)) / 8) * 8
      const s = useAppStore.getState()
      s.setWidth(snap(img.naturalWidth))
      s.setHeight(snap(img.naturalHeight))
      s.setCustomRatio('자유')
    }
    img.src = fullUrl
  }, [])

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
        // 프론트의 수동 보강 플로우로 교체됨 — 백엔드 자동 보강 비활성화
        auto_enhance: false,
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

  return { executeEdit, startEditFromGenerated }
}
