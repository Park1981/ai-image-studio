/**
 * 히스토리 바 컴포넌트 (하단)
 * 최근 생성 이력 썸네일 표시 + 클릭 시 설정 복원
 */

'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api, type HistoryItem } from '@/lib/api'

/** 백엔드 이미지 서버 기본 URL */
const IMAGE_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'

/** 폴링 간격 — 생성 완료 시 자동 갱신 (5초) */
const POLL_INTERVAL = 5_000

export default function HistoryBar() {
  const [items, setItems] = useState<HistoryItem[]>([])
  const generationStatus = useAppStore((s) => s.generationStatus)

  // 스토어 액션 (설정 복원용)
  const setPrompt = useAppStore((s) => s.setPrompt)
  const setNegativePrompt = useAppStore((s) => s.setNegativePrompt)
  const setSampler = useAppStore((s) => s.setSampler)
  const setScheduler = useAppStore((s) => s.setScheduler)
  const setWidth = useAppStore((s) => s.setWidth)
  const setHeight = useAppStore((s) => s.setHeight)
  const setSteps = useAppStore((s) => s.setSteps)
  const setCfg = useAppStore((s) => s.setCfg)
  const setSeed = useAppStore((s) => s.setSeed)
  const setGeneratedImages = useAppStore((s) => s.setGeneratedImages)
  const setGenerationStatus = useAppStore((s) => s.setGenerationStatus)
  const setSelectedImageIndex = useAppStore((s) => s.setSelectedImageIndex)
  const setBatchSize = useAppStore((s) => s.setBatchSize)

  /** 히스토리 목록 가져오기 */
  const fetchHistory = useCallback(async () => {
    const response = await api.getHistory(1, 10)
    if (response.success && response.data) {
      setItems(response.data.items)
    }
  }, [])

  // 초기 로드 + 생성 완료 시 자동 갱신
  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  // 생성 상태가 completed로 변할 때 히스토리 갱신
  useEffect(() => {
    if (generationStatus === 'completed') {
      // 약간 딜레이 후 갱신 (DB 저장 완료 대기)
      const timer = setTimeout(fetchHistory, 1000)
      return () => clearTimeout(timer)
    }
  }, [generationStatus, fetchHistory])

  /** 히스토리 항목 클릭 → 설정 복원 + 이미지 표시 */
  const handleSelect = useCallback((item: HistoryItem) => {
    setPrompt(item.prompt)
    setNegativePrompt(item.negative_prompt || '')
    setSampler(item.sampler)
    setScheduler(item.scheduler)
    setWidth(item.width)
    setHeight(item.height)
    setSteps(item.steps)
    setCfg(item.cfg)
    setSeed(item.seed)
    setBatchSize(item.images.length || 1)
    setSelectedImageIndex(null)

    // 이미지 복원
    if (item.images.length > 0) {
      setGeneratedImages(item.images)
      setGenerationStatus('completed')
    }
  }, [
    setPrompt, setNegativePrompt, setSampler, setScheduler,
    setWidth, setHeight, setSteps, setCfg, setSeed, setBatchSize,
    setGeneratedImages, setGenerationStatus, setSelectedImageIndex,
  ])

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
        const thumb = item.images[0]
        return (
          <button
            key={item.id}
            onClick={() => handleSelect(item)}
            className="w-9 h-9 rounded-md shrink-0 ring-1 ring-edge hover:ring-accent-bright/50 transition-all overflow-hidden bg-ground"
            title={`${item.prompt.slice(0, 40)}... (${item.width}x${item.height})`}
          >
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${IMAGE_BASE}${thumb.url}`}
                alt={item.prompt.slice(0, 20)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full shimmer" />
            )}
          </button>
        )
      })}

      <button
        onClick={fetchHistory}
        className="text-[10px] text-text-dim hover:text-text-sub transition-colors shrink-0 ml-1"
      >
        새로고침
      </button>
    </div>
  )
}
