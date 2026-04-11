/**
 * 풀스크린 이미지 뷰어 모달
 * 이미지 더블클릭 시 원본 해상도로 표시
 * ESC 닫기, 좌우 화살표 네비게이션, 마우스 휠 줌, 드래그 패닝
 */

'use client'

import { useEffect, useCallback, useState, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'

/** 백엔드 이미지 서버 기본 URL */
const IMAGE_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 5
const ZOOM_STEP = 0.15

export default function ImageViewer() {
  const generatedImages = useAppStore((s) => s.generatedImages)
  const viewerIndex = useAppStore((s) => s.viewerIndex)
  const setViewerIndex = useAppStore((s) => s.setViewerIndex)

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const panStart = useRef({ x: 0, y: 0 })

  const isOpen = viewerIndex !== null
  const currentImage = viewerIndex !== null ? generatedImages[viewerIndex] : null

  /** 줌/패닝 리셋 */
  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  /** 이전/다음/닫기 시 줌 리셋 */
  const goPrev = useCallback(() => {
    if (viewerIndex === null || viewerIndex <= 0) return
    setViewerIndex(viewerIndex - 1)
    resetView()
  }, [viewerIndex, setViewerIndex, resetView])

  const goNext = useCallback(() => {
    if (viewerIndex === null || viewerIndex >= generatedImages.length - 1) return
    setViewerIndex(viewerIndex + 1)
    resetView()
  }, [viewerIndex, generatedImages.length, setViewerIndex, resetView])

  const close = useCallback(() => {
    setViewerIndex(null)
    resetView()
  }, [setViewerIndex, resetView])

  /** 마우스 휠 줌 */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((prev) => {
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta))
    })
  }, [])

  /** 드래그 패닝 시작 */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY }
    panStart.current = { ...pan }
  }, [zoom, pan])

  /** 드래그 중 */
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    setPan({
      x: panStart.current.x + (e.clientX - dragStart.current.x),
      y: panStart.current.y + (e.clientY - dragStart.current.y),
    })
  }, [dragging])

  /** 드래그 종료 */
  const handleMouseUp = useCallback(() => {
    setDragging(false)
  }, [])

  /** 창 밖에서 마우스 놓아도 dragging 해제 */
  useEffect(() => {
    if (!dragging) return
    const handleGlobalMouseUp = () => setDragging(false)
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [dragging])

  /** 키보드 + 줌 단축키 */
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          close()
          break
        case 'ArrowLeft':
          goPrev()
          break
        case 'ArrowRight':
          goNext()
          break
        case '0':
          resetView()
          break
        case '+':
        case '=':
          setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))
          break
        case '-':
          setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, close, goPrev, goNext, resetView])

  if (!isOpen || !currentImage) return null

  const hasPrev = viewerIndex !== null && viewerIndex > 0
  const hasNext = viewerIndex !== null && viewerIndex < generatedImages.length - 1
  const zoomPct = Math.round(zoom * 100)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="이미지 뷰어"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={close}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
    >
      {/* 이미지 컨테이너 */}
      <div
        className="relative max-w-[90vw] max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        style={{ cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${IMAGE_BASE}${currentImage.url}`}
          alt={`이미지 뷰어 #${(viewerIndex ?? 0) + 1}`}
          className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl select-none"
          draggable={false}
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transition: dragging ? 'none' : 'transform 0.15s ease-out',
          }}
        />

        {/* 이미지 정보 오버레이 */}
        <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pointer-events-none">
          <div className="glass rounded-lg px-3 py-1.5 text-[11px] font-mono text-text-sub">
            {currentImage.filename} · seed: {currentImage.seed}
          </div>
          <div className="glass rounded-lg px-3 py-1.5 text-[11px] text-text-ghost">
            {(viewerIndex ?? 0) + 1} / {generatedImages.length}
          </div>
        </div>
      </div>

      {/* 상단 컨트롤 바 */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
        {/* 줌 아웃 */}
        <button
          onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP)) }}
          className="w-8 h-8 rounded-full glass flex items-center justify-center text-text-sub hover:text-text transition-colors text-sm font-mono"
        >
          −
        </button>
        {/* 줌 레벨 표시 + 리셋 */}
        <button
          onClick={(e) => { e.stopPropagation(); resetView() }}
          className="px-3 h-8 rounded-full glass flex items-center justify-center text-[11px] font-mono text-text-sub hover:text-text transition-colors min-w-[60px]"
        >
          {zoomPct}%
        </button>
        {/* 줌 인 */}
        <button
          onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP)) }}
          className="w-8 h-8 rounded-full glass flex items-center justify-center text-text-sub hover:text-text transition-colors text-sm font-mono"
        >
          +
        </button>
      </div>

      {/* 닫기 버튼 */}
      <button
        onClick={close}
        className="absolute top-4 right-4 w-10 h-10 rounded-full glass flex items-center justify-center text-text-sub hover:text-text transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* 이전 버튼 */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); goPrev() }}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass flex items-center justify-center text-text-sub hover:text-text transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      {/* 다음 버튼 */}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); goNext() }}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass flex items-center justify-center text-text-sub hover:text-text transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
    </div>
  )
}
