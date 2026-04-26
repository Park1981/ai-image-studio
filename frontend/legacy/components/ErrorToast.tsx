/**
 * 에러 토스트 컴포넌트
 * 에러 메시지를 화면 상단에 표시하고 자동 소멸
 */

'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { XIcon } from './icons'

/** 자동 소멸 시간 (5초) */
const AUTO_DISMISS_MS = 5000

export default function ErrorToast() {
  const errorMessage = useAppStore((s) => s.errorMessage)
  const setErrorMessage = useAppStore((s) => s.setErrorMessage)

  // 일정 시간 후 자동 소멸
  useEffect(() => {
    if (!errorMessage) return

    const timer = setTimeout(() => {
      setErrorMessage(null)
    }, AUTO_DISMISS_MS)

    return () => clearTimeout(timer)
  }, [errorMessage, setErrorMessage])

  // 에러가 없으면 렌더링하지 않음
  if (!errorMessage) return null

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-full px-4">
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-bad/15 border border-bad/30 backdrop-blur-md shadow-lg">
        {/* 에러 아이콘 */}
        <div className="w-5 h-5 rounded-full bg-bad/20 flex items-center justify-center shrink-0">
          <span className="text-bad text-[11px] font-bold">!</span>
        </div>

        {/* 에러 메시지 */}
        <p className="text-[12px] text-bad flex-1">{errorMessage}</p>

        {/* 닫기 버튼 */}
        <button
          onClick={() => setErrorMessage(null)}
          className="text-bad/60 hover:text-bad transition-colors shrink-0"
        >
          <XIcon />
        </button>
      </div>
    </div>
  )
}
