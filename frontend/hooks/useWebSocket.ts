/**
 * WebSocket 커스텀 훅
 * 이미지 생성 진행 상황을 실시간으로 수신
 */

'use client'

import { useRef, useCallback, useState, useEffect } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api } from '@/lib/api'

// WebSocket 메시지 타입 정의 — backend/routers/generate.py 전송 payload와 스키마 동기화
interface WsProgressMessage {
  type: 'progress'
  task_id: string
  progress: number
  current: number   // 현재 단계 (백엔드: current)
  total: number     // 전체 단계 (백엔드: total)
}

interface WsStatusMessage {
  type: 'status'
  task_id: string
  status: string
  progress?: number
  enhanced_prompt?: string | null
  negative_prompt?: string | null
}

interface WsExecutingMessage {
  type: 'executing'
  task_id: string
  node: string
}

interface WsCompletedMessage {
  type: 'completed'
  task_id: string
  images: { url: string; seed: number; filename: string }[]
}

interface WsErrorMessage {
  type: 'error'
  task_id?: string
  error?: string
  message?: string
}

interface WsCancelledMessage {
  type: 'cancelled'
  task_id: string
  message?: string
}

type WsMessage =
  | WsProgressMessage
  | WsStatusMessage
  | WsExecutingMessage
  | WsCompletedMessage
  | WsErrorMessage
  | WsCancelledMessage

/** WS 메시지가 스트림 종료를 의미하는지 판단 */
function isTerminalMessage(msg: WsMessage): boolean {
  return msg.type === 'completed' || msg.type === 'error' || msg.type === 'cancelled'
}

/** 재접속 최대 횟수 */
const MAX_RECONNECT_ATTEMPTS = 5

/** Exponential backoff 딜레이 계산 (ms) */
function getReconnectDelay(attempt: number): number {
  // 1s, 2s, 4s, 8s, 16s (최대)
  return Math.min(1000 * Math.pow(2, attempt), 16000)
}

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

    case 'cancelled': {
      // 백엔드에서 취소 통보 (useGenerate.cancel 시 서버가 status='cancelled'로 전송)
      const cancMsg = msg as WsCancelledMessage
      store.setGenerationStatus('cancelled')
      store.setProgress(0)
      if (cancMsg.message) store.setErrorMessage(cancMsg.message)
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

      // 종결 메시지면 재접속 방지 + 명시적 close
      // (기존에는 서버 끊김에 의존 → 엣지케이스에서 연결 남아있을 수 있음)
      if (isTerminalMessage(msg)) {
        reconnectCountRef.current = MAX_RECONNECT_ATTEMPTS
        ws.close()
      }
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
      const attempt = reconnectCountRef.current
      reconnectCountRef.current = attempt + 1
      setTimeout(
        () => createWebSocket(taskId, wsRef, reconnectCountRef, setIsConnected),
        getReconnectDelay(attempt),
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
