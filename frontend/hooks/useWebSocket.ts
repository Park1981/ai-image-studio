/**
 * WebSocket 커스텀 훅
 * 이미지 생성 진행 상황을 실시간으로 수신
 */

'use client'

import { useRef, useCallback, useState, useEffect } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api } from '@/lib/api'

// WebSocket 메시지 타입 정의
interface WsProgressMessage {
  type: 'progress'
  progress: number
  current_step: number
  total_steps: number
}

interface WsStatusMessage {
  type: 'status'
  status: string
  enhanced_prompt?: string
  negative_prompt?: string
}

interface WsExecutingMessage {
  type: 'executing'
  node: string
}

interface WsCompletedMessage {
  type: 'completed'
  images: { url: string; seed: number; filename: string }[]
}

interface WsErrorMessage {
  type: 'error'
  error?: string
  message?: string
}

type WsMessage = WsProgressMessage | WsStatusMessage | WsExecutingMessage | WsCompletedMessage | WsErrorMessage

/** 재접속 최대 횟수 */
const MAX_RECONNECT_ATTEMPTS = 3
/** 재접속 대기 시간 (ms) */
const RECONNECT_DELAY = 2000

/** WebSocket 메시지를 스토어로 디스패치 */
function dispatchWsMessage(msg: WsMessage) {
  const store = useAppStore.getState()

  switch (msg.type) {
    case 'status': {
      // 백그라운드 태스크 상태 변화 (warming_up → enhancing → generating)
      const statusMsg = msg as WsStatusMessage
      const status = statusMsg.status
      if (status === 'warming_up' || status === 'enhancing' || status === 'generating') {
        store.setGenerationStatus(status)
      }
      // 보강된 프롬프트 수신 시 저장
      if (statusMsg.enhanced_prompt) {
        store.setEnhancedPrompt(statusMsg.enhanced_prompt)
      }
      break
    }

    case 'progress':
      // 생성 진행률 업데이트
      store.setProgress(msg.progress)
      store.setGenerationStatus('generating')
      break

    case 'executing':
      // 노드 실행 중 (진행 상태 유지)
      store.setGenerationStatus('generating')
      break

    case 'completed':
      // 생성 완료 → 이미지 저장
      store.setGenerationStatus('completed')
      store.setProgress(100)
      store.setGeneratedImages(msg.images)
      break

    case 'error': {
      // 에러 발생
      const errMsg = msg as WsErrorMessage
      store.setGenerationStatus('error')
      store.setErrorMessage(errMsg.message || errMsg.error || '이미지 생성 중 오류가 발생했습니다.')
      break
    }
  }
}

/** WebSocket 연결을 생성하는 순수 함수 (훅 외부에서 재귀 호출 가능) */
function createWebSocket(
  taskId: string,
  wsRef: React.RefObject<WebSocket | null>,
  reconnectCountRef: React.RefObject<number>,
  setIsConnected: (connected: boolean) => void,
) {
  // 기존 연결이 있으면 정리
  if (wsRef.current) {
    wsRef.current.close()
  }

  const wsUrl = api.wsUrl('/api/ws/generate')
  const ws = new WebSocket(wsUrl)
  wsRef.current = ws

  ws.onopen = () => {
    setIsConnected(true)
    // 태스크 ID 전송하여 구독 시작
    ws.send(JSON.stringify({ task_id: taskId }))
  }

  ws.onmessage = (event: MessageEvent) => {
    try {
      const msg: WsMessage = JSON.parse(event.data)
      dispatchWsMessage(msg)
    } catch {
      // JSON 파싱 실패 시 무시
    }
  }

  ws.onclose = () => {
    setIsConnected(false)

    // 생성 중이었다면 재접속 시도
    const status = useAppStore.getState().generationStatus
    if (
      status === 'generating' &&
      reconnectCountRef.current < MAX_RECONNECT_ATTEMPTS
    ) {
      reconnectCountRef.current = reconnectCountRef.current + 1
      setTimeout(
        () => createWebSocket(taskId, wsRef, reconnectCountRef, setIsConnected),
        RECONNECT_DELAY,
      )
    }
  }

  ws.onerror = () => {
    // 에러 발생 시 onclose에서 재접속 로직 처리
  }
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCountRef = useRef(0)
  const [isConnected, setIsConnected] = useState(false)

  /** WebSocket 연결 (태스크 ID로 진행 상황 구독) */
  const connect = useCallback((taskId: string) => {
    reconnectCountRef.current = 0
    createWebSocket(taskId, wsRef, reconnectCountRef, setIsConnected)
  }, [])

  /** WebSocket 연결 해제 */
  const disconnect = useCallback(() => {
    reconnectCountRef.current = MAX_RECONNECT_ATTEMPTS // 재접속 방지
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsConnected(false)
  }, [])

  // 컴포넌트 언마운트 시 연결 해제
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  return { connect, disconnect, isConnected }
}
