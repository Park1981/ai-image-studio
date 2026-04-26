/**
 * 히스토리 바 컴포넌트 (하단)
 * 최근 생성 이력 썸네일만 표시 (클릭 없이 갤러리 뷰)
 * 상세 조작은 상단 히스토리 패널에서
 */

'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api, type HistoryItem } from '@/lib/api'

/** 백엔드 이미지 서버 기본 URL */
const IMAGE_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'

export default function HistoryBar() {
  const [items, setItems] = useState<HistoryItem[]>([])
  const generationStatus = useAppStore((s) => s.generationStatus)
  const historyVersion = useAppStore((s) => s.historyVersion)

  /** 히스토리 목록 가져오기 */
  const fetchHistory = useCallback(async () => {
    const response = await api.getHistory(1, 10)
    if (response.success && response.data) {
      setItems(response.data.items)
    }
  }, [])

  // 초기 로드
  useEffect(() => {
    const timer = setTimeout(fetchHistory, 0)
    return () => clearTimeout(timer)
  }, [fetchHistory])

  // 생성 완료 시 자동 갱신
  useEffect(() => {
    if (generationStatus === 'completed') {
      const timer = setTimeout(fetchHistory, 1000)
      return () => clearTimeout(timer)
    }
  }, [generationStatus, fetchHistory])

  // 히스토리 변경(삭제 등) 시 갱신
  useEffect(() => {
    if (historyVersion > 0) {
      const timer = setTimeout(fetchHistory, 300)
      return () => clearTimeout(timer)
    }
  }, [historyVersion, fetchHistory])

  if (items.length === 0) {
    return (
      <div className="shrink-0 h-11 px-4 border-t border-edge flex items-center">
        <span className="text-[10px] text-text-ghost">
          생성 이력이 없습니다
        </span>
      </div>
    )
  }

  return (
    <div className="shrink-0 h-12 px-4 border-t border-edge flex items-center gap-2 overflow-x-auto">
      <span className="text-[10px] text-text-dim uppercase tracking-wider shrink-0 font-semibold">
        최근
      </span>

      {items.map((item) => {
        const thumb = item.images?.[0]
        return (
          <div
            key={item.id}
            className="w-9 h-9 rounded-md shrink-0 ring-1 ring-edge overflow-hidden bg-ground"
            title={item.prompt.slice(0, 50)}
          >
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${IMAGE_BASE}${thumb.url}`}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full shimmer" />
            )}
          </div>
        )
      })}
    </div>
  )
}
