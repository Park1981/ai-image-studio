/**
 * 프로세스 상태 폴링 훅
 * Ollama / ComfyUI 실행 상태를 주기적으로 확인
 */

'use client'

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api } from '@/lib/api'

/** 폴링 간격 (10초) */
const POLL_INTERVAL = 10_000

export function useProcessStatus() {
  const processStatus = useAppStore((s) => s.processStatus)
  const setProcessStatus = useAppStore((s) => s.setProcessStatus)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // 프로세스 상태 조회 함수
    const fetchStatus = async () => {
      const response = await api.getProcessStatus()

      if (response.success && response.data) {
        setProcessStatus({
          ollama: {
            running: response.data.ollama.running,
            modelLoaded: null,
          },
          comfyui: {
            running: response.data.comfyui.running,
            vramUsedGb: 0,
            vramTotalGb: 16,
          },
        })
      }
    }

    // 초기 1회 조회
    fetchStatus()

    // 주기적 폴링 시작
    intervalRef.current = setInterval(fetchStatus, POLL_INTERVAL)

    return () => {
      // 클린업: 폴링 중지
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [setProcessStatus])

  return processStatus
}
