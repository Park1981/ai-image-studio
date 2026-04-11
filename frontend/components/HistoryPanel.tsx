/**
 * 히스토리 패널 (사이드 오버레이)
 * 헤더 "히스토리" 버튼 클릭 시 오른쪽에서 슬라이드 인
 * 전체 생성 이력 + AI보강 프롬프트 + 설정 복원
 */

'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api, type HistoryItem } from '@/lib/api'

/** 백엔드 이미지 서버 기본 URL */
const IMAGE_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'

export default function HistoryPanel() {
  const historyPanelOpen = useAppStore((s) => s.historyPanelOpen)
  const setHistoryPanelOpen = useAppStore((s) => s.setHistoryPanelOpen)

  const [items, setItems] = useState<HistoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)

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
  const setEnhancedPrompt = useAppStore((s) => s.setEnhancedPrompt)

  /** 히스토리 목록 가져오기 */
  const fetchHistory = useCallback(async (pageNum: number, append = false) => {
    setLoading(true)
    const response = await api.getHistory(pageNum, 20)
    if (response.success && response.data) {
      if (append) {
        setItems((prev) => [...prev, ...response.data.items])
      } else {
        setItems(response.data.items)
      }
      setTotal(response.data.total)
      setHasMore(response.data.has_more)
      setPage(pageNum)
    }
    setLoading(false)
  }, [])

  // 패널 열릴 때 목록 로드
  useEffect(() => {
    if (historyPanelOpen) {
      fetchHistory(1)
    }
  }, [historyPanelOpen, fetchHistory])

  /** 더 보기 */
  const handleLoadMore = () => {
    if (!loading && hasMore) {
      fetchHistory(page + 1, true)
    }
  }

  /** 항목 클릭 → 설정 복원 */
  const handleSelect = useCallback((item: HistoryItem) => {
    setPrompt(item.prompt)
    setNegativePrompt(item.negative_prompt || '')
    setEnhancedPrompt(item.enhanced_prompt || '')
    setSampler(item.sampler)
    setScheduler(item.scheduler)
    setWidth(item.width)
    setHeight(item.height)
    setSteps(item.steps)
    setCfg(item.cfg)
    setSeed(item.seed)
    const imgCount = item.images?.length || 1
    setBatchSize(imgCount)
    setSelectedImageIndex(null)

    if (item.images && item.images.length > 0) {
      setGeneratedImages(item.images)
      setGenerationStatus('completed')
    }

    setHistoryPanelOpen(false)
  }, [
    setPrompt, setNegativePrompt, setEnhancedPrompt, setSampler, setScheduler,
    setWidth, setHeight, setSteps, setCfg, setSeed, setBatchSize,
    setGeneratedImages, setGenerationStatus, setSelectedImageIndex,
    setHistoryPanelOpen,
  ])

  /** 항목 삭제 */
  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const response = await api.deleteHistory(id)
    if (response.success) {
      setItems((prev) => prev.filter((item) => item.id !== id))
      setTotal((prev) => prev - 1)
    }
  }, [])

  /** 시간 포맷 */
  const formatTime = (dateStr: string) => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)

    if (diffMin < 1) return '방금'
    if (diffMin < 60) return `${diffMin}분 전`
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}시간 전`
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
  }

  if (!historyPanelOpen) return null

  return (
    <>
      {/* 배경 오버레이 */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={() => setHistoryPanelOpen(false)}
        aria-hidden="true"
      />

      {/* 패널 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="히스토리"
        className="fixed top-0 right-0 bottom-0 z-50 w-[380px] bg-ground border-l border-edge flex flex-col shadow-2xl"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge shrink-0">
          <div>
            <h2 className="text-[13px] font-semibold text-text">생성 히스토리</h2>
            <p className="text-[10px] text-text-ghost mt-0.5">{total}건</p>
          </div>
          <button
            onClick={() => setHistoryPanelOpen(false)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-text-sub hover:text-text hover:bg-white/[0.06] transition-all"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 && !loading && (
            <div className="flex items-center justify-center h-32">
              <p className="text-[12px] text-text-ghost">생성 이력이 없습니다</p>
            </div>
          )}

          {items.map((item) => {
            const thumb = item.images?.[0]
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelect(item)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSelect(item) }}
                className="w-full flex gap-3 px-4 py-3 border-b border-edge/50 hover:bg-white/[0.02] transition-all text-left cursor-pointer group"
              >
                {/* 썸네일 */}
                <div className="w-14 h-14 rounded-lg shrink-0 overflow-hidden bg-surface ring-1 ring-edge">
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

                {/* 정보 */}
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-text line-clamp-1 leading-relaxed">
                    {item.prompt}
                  </p>
                  {/* AI 보강 프롬프트 */}
                  {item.enhanced_prompt && (
                    <p className="text-[10px] text-accent-bright/50 line-clamp-1 mt-0.5">
                      AI: {item.enhanced_prompt}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-mono text-text-ghost">
                      {item.width}x{item.height}
                    </span>
                    <span className="text-[10px] text-text-ghost">
                      {item.steps}steps
                    </span>
                    <span className="text-[10px] text-text-ghost">
                      seed:{item.seed}
                    </span>
                    <span className="text-[10px] text-text-ghost ml-auto">
                      {formatTime(item.created_at)}
                    </span>
                  </div>
                </div>

                {/* 삭제 버튼 */}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleDelete(item.id, e as unknown as React.MouseEvent)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleDelete(item.id, e as unknown as React.MouseEvent) } }}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-text-ghost hover:text-bad opacity-0 group-hover:opacity-100 transition-all shrink-0 self-center cursor-pointer"
                  title="삭제"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="m19 6-.867 12.142A2 2 0 0 1 16.138 20H7.862a2 2 0 0 1-1.995-1.858L5 6" />
                    <path d="M10 11v6M14 11v6M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                  </svg>
                </span>
              </div>
            )
          })}

          {/* 더 보기 */}
          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={loading}
              className="w-full py-3 text-[11px] text-accent-bright hover:text-accent transition-colors disabled:opacity-40"
            >
              {loading ? '로딩 중...' : '더 보기'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
