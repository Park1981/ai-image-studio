/**
 * 이미지 그리드 컴포넌트
 * batchSize에 따라 동적 레이아웃 (1→1칸, 2→1x2, 3~4→2x2)
 * 생성 중에는 프로그레스 바/스피너 오버레이 표시
 * 생성 완료 후 선택 시 액션 오버레이 표시
 */

'use client'

import { useAppStore } from '@/stores/useAppStore'
import { useGenerate } from '@/hooks/useGenerate'
import { api } from '@/lib/api'
import { ImagePlaceholderIcon, CheckIcon } from './icons'
import ImageViewer from './ImageViewer'

/** 백엔드 이미지 서버 기본 URL */
const IMAGE_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'

/** batchSize에 따른 그리드 CSS 클래스 */
function getGridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1 grid-rows-1'
  if (count === 2) return 'grid-cols-2 grid-rows-1'
  return 'grid-cols-2 grid-rows-2'
}

export default function ImageGrid() {
  const selectedImageIndex = useAppStore((s) => s.selectedImageIndex)
  const setSelectedImageIndex = useAppStore((s) => s.setSelectedImageIndex)
  const generatedImages = useAppStore((s) => s.generatedImages)
  const generationStatus = useAppStore((s) => s.generationStatus)
  const progress = useAppStore((s) => s.progress)
  const batchSize = useAppStore((s) => s.batchSize)
  const setErrorMessage = useAppStore((s) => s.setErrorMessage)
  const setSeed = useAppStore((s) => s.setSeed)
  const setViewerIndex = useAppStore((s) => s.setViewerIndex)

  const setEditMode = useAppStore((s) => s.setEditMode)
  const setEditSourceImage = useAppStore((s) => s.setEditSourceImage)
  const setEditSourcePreview = useAppStore((s) => s.setEditSourcePreview)

  const { generate } = useGenerate()

  // 표시할 슬롯 수 — batchSize 기준 (생성 완료 후에는 실제 이미지 수)
  const slotCount = generatedImages.length > 0
    ? Math.max(generatedImages.length, batchSize)
    : batchSize

  const isActive =
    generationStatus === 'generating' ||
    generationStatus === 'warming_up' ||
    generationStatus === 'enhancing'

  // AI 보강 중 여부 (스피너 표시용)
  const isEnhancing = generationStatus === 'enhancing'

  // 생성 완료 여부
  const hasImages = generatedImages.length > 0
  const isCompleted = generationStatus === 'completed'

  /** 이미지 선택 토글 */
  const handleSelect = (index: number) => {
    if (!generatedImages[index]) return
    setSelectedImageIndex(index === selectedImageIndex ? null : index)
  }

  /** 다시 생성 (새 시드로) */
  const handleRegenerate = () => {
    setSeed(-1)
    generate()
  }

  /** 이미지 저장 (새 탭에서 열기) */
  const handleSave = () => {
    if (selectedImageIndex === null) return
    const image = generatedImages[selectedImageIndex]
    if (image) {
      window.open(`${IMAGE_BASE}${image.url}`, '_blank')
    }
  }

  /** 영상 만들기 (준비 중 토스트) */
  const handleVideo = () => {
    setErrorMessage('영상 생성 기능은 준비 중입니다')
  }

  /** 이미지 변형 (준비 중 토스트) */
  const handleVariation = () => {
    setErrorMessage('이미지 변형 기능은 준비 중입니다')
  }

  /** 선택된 이미지로 수정 모드 전환 */
  const handleEditImage = async (index: number) => {
    const image = generatedImages[index]
    if (!image) return

    // 이미지 URL에서 파일을 가져와 업로드
    const imageUrl = `${IMAGE_BASE}${image.url}`

    try {
      // 이미지를 fetch하여 File 객체로 변환
      const resp = await fetch(imageUrl)
      const blob = await resp.blob()
      const file = new File([blob], image.filename || 'edit-source.png', { type: blob.type })

      // 프리뷰 설정
      setEditSourcePreview(imageUrl)

      // 백엔드에 업로드
      const uploadResp = await api.uploadImage(file)
      if (uploadResp.success && uploadResp.data) {
        setEditSourceImage(uploadResp.data.filename)
        setEditMode(true)
      } else {
        setErrorMessage(uploadResp.error || '이미지 업로드에 실패했습니다.')
      }
    } catch {
      setErrorMessage('이미지를 수정 모드로 전환하는 중 오류가 발생했습니다.')
    }
  }

  return (
    <div className={`relative flex-1 grid ${getGridClass(slotCount)} gap-1.5 p-2 min-h-0 overflow-hidden`}>
      {Array.from({ length: slotCount }, (_, i) => {
        const image = generatedImages[i]
        const isSelected = selectedImageIndex === i

        return (
          <div
            key={i}
            role="button"
            tabIndex={image ? 0 : -1}
            aria-pressed={isSelected}
            onClick={() => handleSelect(i)}
            onDoubleClick={() => { if (image) setViewerIndex(i) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(i) }
            }}
            className={`relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200 ${
              isSelected
                ? 'ring-2 ring-accent-bright ring-offset-2 ring-offset-void scale-[0.99]'
                : 'ring-1 ring-edge hover:ring-edge-hover'
            }`}
          >
            {image ? (
              /* 생성된 이미지 표시 */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${IMAGE_BASE}${image.url}`}
                alt={`생성된 이미지 #${i + 1}`}
                className="w-full h-full object-contain bg-void"
                loading="lazy"
              />
            ) : (
              /* 빈 상태 플레이스홀더 */
              <div className="w-full h-full shimmer flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 opacity-20">
                  <ImagePlaceholderIcon />
                  <span className="text-[10px] font-mono text-text-sub">
                    {i + 1}
                  </span>
                </div>
              </div>
            )}

            {/* 선택 시 체크마크 */}
            {isSelected && (
              <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-accent flex items-center justify-center shadow-lg">
                <CheckIcon />
              </div>
            )}

            {/* 번호 뱃지 */}
            <div className="absolute bottom-2.5 left-2.5 px-1.5 py-0.5 rounded bg-black/50 backdrop-blur-sm text-[10px] font-mono text-text-sub">
              #{i + 1}
            </div>

            {/* 이미지에 시드값 표시 */}
            {image && (
              <div className="absolute bottom-2.5 right-2.5 px-1.5 py-0.5 rounded bg-black/50 backdrop-blur-sm text-[10px] font-mono text-text-ghost">
                seed: {image.seed}
              </div>
            )}

            {/* 선택된 이미지의 액션 오버레이 */}
            {isSelected && image && isCompleted && (
              <div
                className="absolute bottom-0 left-0 right-0 p-2 flex items-center justify-center gap-2"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <div className="glass rounded-xl px-3 py-2 flex items-center gap-1.5 border border-edge">
                  {[
                    { label: '다시 생성', handler: handleRegenerate, title: '같은 설정, 새 시드로 다시 생성' },
                    { label: '수정', handler: () => handleEditImage(i), title: '이 이미지를 수정 모드로 전환' },
                    { label: '영상 만들기', handler: handleVideo },
                    { label: '저장', handler: handleSave },
                    { label: '변형', handler: handleVariation },
                  ].map(({ label, handler, title }) => (
                    <span
                      key={label}
                      role="button"
                      tabIndex={0}
                      onClick={handler}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler() } }}
                      className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-text-sub hover:text-text hover:bg-white/[0.06] transition-all cursor-pointer"
                      title={title}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* 생성 중 프로그레스/스피너 오버레이 */}
      {isActive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="w-64 bg-surface/90 backdrop-blur-md rounded-xl p-4 border border-edge shadow-2xl pointer-events-auto">
            {/* 상태 텍스트 */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-text">
                {generationStatus === 'warming_up'
                  ? 'ComfyUI 준비 중...'
                  : isEnhancing
                    ? 'AI 프롬프트 보강 중...'
                    : '이미지 생성 중...'}
              </span>
              {/* AI 보강 중에는 스피너, 생성 중에는 퍼센트 */}
              {isEnhancing ? (
                <div className="w-4 h-4 border-2 border-accent-bright/30 border-t-accent-bright rounded-full animate-spin" />
              ) : (
                <span className="text-[11px] font-mono text-accent-bright tabular-nums">
                  {Math.round(progress)}%
                </span>
              )}
            </div>

            {/* 프로그레스 바 — AI 보강 중에는 indeterminate 애니메이션 */}
            <div className="h-1.5 bg-elevated rounded-full overflow-hidden">
              {isEnhancing ? (
                <div className="h-full w-1/3 bg-gradient-to-r from-accent to-accent-bright rounded-full animate-indeterminate" />
              ) : (
                <div
                  className="h-full bg-gradient-to-r from-accent to-accent-bright rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* 생성 완료 후 이미지 미선택 시 힌트 텍스트 */}
      {isCompleted && hasImages && selectedImageIndex === null && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <p className="text-[11px] text-text-ghost/70 bg-surface/60 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-edge/50">
            클릭: 옵션 · 더블클릭: 크게 보기
          </p>
        </div>
      )}

      {/* 풀스크린 이미지 뷰어 */}
      <ImageViewer />
    </div>
  )
}
