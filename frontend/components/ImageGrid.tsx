/**
 * 이미지 그리드 컴포넌트
 * 2x2 그리드로 생성된 이미지 또는 플레이스홀더 표시
 * 생성 중에는 프로그레스 바 오버레이 표시
 * 생성 완료 후 선택 시 액션 오버레이 표시 (다시 생성, 영상 만들기, 저장, 변형)
 */

'use client'

import { useAppStore } from '@/stores/useAppStore'
import { useGenerate } from '@/hooks/useGenerate'
import { ImagePlaceholderIcon, CheckIcon } from './icons'

/** 백엔드 이미지 서버 기본 URL */
const IMAGE_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'

export default function ImageGrid() {
  const selectedImageIndex = useAppStore((s) => s.selectedImageIndex)
  const setSelectedImageIndex = useAppStore((s) => s.setSelectedImageIndex)
  const generatedImages = useAppStore((s) => s.generatedImages)
  const generationStatus = useAppStore((s) => s.generationStatus)
  const progress = useAppStore((s) => s.progress)
  const batchSize = useAppStore((s) => s.batchSize)
  const setErrorMessage = useAppStore((s) => s.setErrorMessage)
  const setSeed = useAppStore((s) => s.setSeed)

  const { generate } = useGenerate()

  // 표시할 슬롯 수 (배치 사이즈 기준, 최소 4개)
  const slotCount = Math.max(batchSize, 4)
  const isActive =
    generationStatus === 'generating' ||
    generationStatus === 'warming_up' ||
    generationStatus === 'enhancing'

  // 생성 완료 여부 (이미지가 존재하는 상태)
  const hasImages = generatedImages.length > 0
  const isCompleted = generationStatus === 'completed'

  /** 이미지 선택 토글 */
  const handleSelect = (index: number) => {
    // 이미지가 있는 슬롯만 선택 가능
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

  return (
    <div className="relative flex-1 grid grid-cols-2 grid-rows-2 gap-1.5 p-2 min-h-0 overflow-hidden">
      {Array.from({ length: slotCount }, (_, i) => {
        const image = generatedImages[i]
        const isSelected = selectedImageIndex === i

        return (
          <button
            key={i}
            onClick={() => handleSelect(i)}
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
                className="w-full h-full object-cover"
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
              >
                <div className="glass rounded-xl px-3 py-2 flex items-center gap-1.5 border border-edge">
                  {/* 다시 생성 */}
                  <button
                    onClick={handleRegenerate}
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-text-sub hover:text-text hover:bg-white/[0.06] transition-all"
                    title="같은 설정, 새 시드로 다시 생성"
                  >
                    다시 생성
                  </button>
                  {/* 영상 만들기 */}
                  <button
                    onClick={handleVideo}
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-text-sub hover:text-text hover:bg-white/[0.06] transition-all"
                  >
                    영상 만들기
                  </button>
                  {/* 저장 */}
                  <button
                    onClick={handleSave}
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-text-sub hover:text-text hover:bg-white/[0.06] transition-all"
                  >
                    저장
                  </button>
                  {/* 변형 */}
                  <button
                    onClick={handleVariation}
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-text-sub hover:text-text hover:bg-white/[0.06] transition-all"
                  >
                    변형
                  </button>
                </div>
              </div>
            )}
          </button>
        )
      })}

      {/* 생성 중 프로그레스 바 오버레이 */}
      {isActive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="w-64 bg-surface/90 backdrop-blur-md rounded-xl p-4 border border-edge shadow-2xl pointer-events-auto">
            {/* 상태 텍스트 */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-text">
                {generationStatus === 'warming_up'
                  ? 'ComfyUI 준비 중...'
                  : generationStatus === 'enhancing'
                    ? 'AI 프롬프트 보강 중...'
                    : '이미지 생성 중...'}
              </span>
              <span className="text-[11px] font-mono text-accent-bright tabular-nums">
                {Math.round(progress)}%
              </span>
            </div>

            {/* 프로그레스 바 */}
            <div className="h-1.5 bg-elevated rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent to-accent-bright rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 생성 완료 후 이미지 미선택 시 힌트 텍스트 */}
      {isCompleted && hasImages && selectedImageIndex === null && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <p className="text-[11px] text-text-ghost/70 bg-surface/60 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-edge/50">
            이미지를 클릭하여 옵션을 확인하세요
          </p>
        </div>
      )}
    </div>
  )
}
