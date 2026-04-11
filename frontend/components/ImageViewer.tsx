/**
 * 풀스크린 이미지 뷰어 모달
 * 이미지 더블클릭 시 원본 해상도로 표시
 * ESC 닫기, 좌우 화살표 네비게이션
 */

'use client'

import { useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'

/** 백엔드 이미지 서버 기본 URL */
const IMAGE_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'

export default function ImageViewer() {
  const generatedImages = useAppStore((s) => s.generatedImages)
  const viewerIndex = useAppStore((s) => s.viewerIndex)
  const setViewerIndex = useAppStore((s) => s.setViewerIndex)

  const isOpen = viewerIndex !== null
  const currentImage = viewerIndex !== null ? generatedImages[viewerIndex] : null

  /** 이전 이미지 */
  const goPrev = useCallback(() => {
    if (viewerIndex === null || viewerIndex <= 0) return
    setViewerIndex(viewerIndex - 1)
  }, [viewerIndex, setViewerIndex])

  /** 다음 이미지 */
  const goNext = useCallback(() => {
    if (viewerIndex === null || viewerIndex >= generatedImages.length - 1) return
    setViewerIndex(viewerIndex + 1)
  }, [viewerIndex, generatedImages.length, setViewerIndex])

  /** 닫기 */
  const close = useCallback(() => {
    setViewerIndex(null)
  }, [setViewerIndex])

  /** 키보드 핸들링 */
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
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, close, goPrev, goNext])

  if (!isOpen || !currentImage) return null

  const hasPrev = viewerIndex !== null && viewerIndex > 0
  const hasNext = viewerIndex !== null && viewerIndex < generatedImages.length - 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={close}
    >
      {/* 이미지 컨테이너 */}
      <div
        className="relative max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${IMAGE_BASE}${currentImage.url}`}
          alt={`이미지 뷰어 #${(viewerIndex ?? 0) + 1}`}
          className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
        />

        {/* 이미지 정보 오버레이 */}
        <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
          <div className="glass rounded-lg px-3 py-1.5 text-[11px] font-mono text-text-sub">
            {currentImage.filename} · seed: {currentImage.seed}
          </div>
          <div className="glass rounded-lg px-3 py-1.5 text-[11px] text-text-ghost">
            {(viewerIndex ?? 0) + 1} / {generatedImages.length} · ESC 닫기
          </div>
        </div>
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
