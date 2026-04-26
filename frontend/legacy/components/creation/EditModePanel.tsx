/**
 * 수정 모드 이미지 업로드 컴포넌트
 * 드래그앤드롭/클릭 업로드 + 소스 이미지 프리뷰 + 제거 버튼
 */

'use client'

import { useState, useCallback, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api } from '@/lib/api'
import { UploadIcon } from '../icons'

export default function EditModePanel() {
  // ── 스토어 상태 ──
  const editMode = useAppStore((s) => s.editMode)
  const editSourceImage = useAppStore((s) => s.editSourceImage)
  const setEditSourceImage = useAppStore((s) => s.setEditSourceImage)
  const editSourcePreview = useAppStore((s) => s.editSourcePreview)
  const setEditSourcePreview = useAppStore((s) => s.setEditSourcePreview)
  const setErrorMessage = useAppStore((s) => s.setErrorMessage)
  const setWidth = useAppStore((s) => s.setWidth)
  const setHeight = useAppStore((s) => s.setHeight)
  const setCustomRatio = useAppStore((s) => s.setCustomRatio)

  // ── 로컬 상태 ──
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * 업로드된 이미지의 원본 치수를 sanitize 하여 스토어에 주입
   * - Qwen Edit 권장 step_size=16의 배수로 반올림 (ComfyUI latent 호환)
   * - min 512, max 2048 범위 클램프
   * - 임의 해상도이므로 사이즈 비율 잠금을 '자유'로 해제
   */
  const applySourceDimensions = useCallback((dataUrl: string) => {
    const img = new Image()
    img.onload = () => {
      const snap = (v: number) => Math.max(512, Math.min(2048, Math.round(v / 16) * 16))
      setWidth(snap(img.naturalWidth))
      setHeight(snap(img.naturalHeight))
      setCustomRatio('자유')
    }
    img.src = dataUrl
  }, [setWidth, setHeight, setCustomRatio])

  /** 이미지 업로드 처리 */
  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMessage('이미지 파일만 업로드할 수 있습니다.')
      return
    }
    setUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string
        setEditSourcePreview(dataUrl)
        // 소스 이미지 치수를 자동으로 가로/세로에 적용 (수정 모드 UX)
        applySourceDimensions(dataUrl)
      }
      reader.readAsDataURL(file)
      const response = await api.uploadImage(file)
      if (response.success && response.data) {
        setEditSourceImage(response.data.filename)
      } else {
        setErrorMessage(response.error || '이미지 업로드에 실패했습니다.')
        setEditSourcePreview(null)
      }
    } catch {
      setErrorMessage('이미지 업로드 중 오류가 발생했습니다.')
      setEditSourcePreview(null)
    } finally {
      setUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileUpload(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFileUpload(file)
  }

  // 수정 모드가 아니면 렌더링 안 함
  if (!editMode) return null

  return (
    <div className="px-3 pt-3 pb-1">
      {editSourcePreview ? (
        <div className="flex items-center gap-3">
          <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-edge shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={editSourcePreview} alt="수정할 이미지" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-text-sub truncate">{editSourceImage || '업로드 중...'}</p>
            <button
              onClick={() => { setEditSourceImage(null); setEditSourcePreview(null) }}
              className="text-[10px] text-bad/70 hover:text-bad transition-colors mt-0.5"
            >
              이미지 제거
            </button>
          </div>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-1.5 py-4 rounded-lg border-2 border-dashed border-edge hover:border-accent/50 cursor-pointer transition-all hover:bg-accent-muted/10"
        >
          <UploadIcon />
          <span className="text-[11px] text-text-sub">
            {uploading ? '업로드 중...' : '이미지를 드래그하거나 클릭'}
          </span>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  )
}
