/**
 * 사이즈 + 배치 선택 컴포넌트
 * 비율 프리셋 버튼 + 커스텀 px 입력 + 배치 사이즈
 */

'use client'

import { useState } from 'react'
import { useAppStore } from '@/stores/useAppStore'

/** 사이즈 프리셋 목록 */
const SIZE_PRESETS = [
  { label: '1:1', w: 1328, h: 1328 },
  { label: '16:9', w: 1664, h: 928 },
  { label: '9:16', w: 928, h: 1664 },
  { label: '4:3', w: 1472, h: 1104 },
  { label: '3:2', w: 1584, h: 1056 },
] as const

const BATCH_OPTIONS = [1, 2, 3, 4] as const

export default function SizeSelector() {
  // ── 스토어 상태 ──
  const width = useAppStore((s) => s.width)
  const setWidth = useAppStore((s) => s.setWidth)
  const height = useAppStore((s) => s.height)
  const setHeight = useAppStore((s) => s.setHeight)
  const batchSize = useAppStore((s) => s.batchSize)
  const setBatchSize = useAppStore((s) => s.setBatchSize)
  const generationStatus = useAppStore((s) => s.generationStatus)

  // ── 로컬 상태 ──
  const [showCustomSize, setShowCustomSize] = useState(false)

  const isGenerating =
    generationStatus === 'generating' ||
    generationStatus === 'warming_up' ||
    generationStatus === 'enhancing'

  const currentSizeLabel = SIZE_PRESETS.find((p) => p.w === width && p.h === height)?.label ?? 'custom'

  return (
    <div className="flex gap-3">
      {/* 사이즈 */}
      <div className="flex-1">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">사이즈</label>
        {showCustomSize ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={width}
              step={8}
              onChange={(e) => {
                const v = parseInt(e.target.value) || 256
                setWidth(Math.round(Math.max(256, Math.min(2048, v)) / 8) * 8)
              }}
              className="w-[56px] bg-surface text-[11px] font-mono text-text-sub rounded-lg px-1.5 py-1.5 border border-edge focus:border-accent outline-none text-center"
            />
            <span className="text-[10px] text-text-ghost">×</span>
            <input
              type="number"
              value={height}
              step={8}
              onChange={(e) => {
                const v = parseInt(e.target.value) || 256
                setHeight(Math.round(Math.max(256, Math.min(2048, v)) / 8) * 8)
              }}
              className="w-[56px] bg-surface text-[11px] font-mono text-text-sub rounded-lg px-1.5 py-1.5 border border-edge focus:border-accent outline-none text-center"
            />
            <button
              onClick={() => setShowCustomSize(false)}
              className="text-[10px] text-text-ghost hover:text-accent-bright transition-colors"
            >
              비율
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <select
              value={currentSizeLabel}
              onChange={(e) => {
                const p = SIZE_PRESETS.find((s) => s.label === e.target.value)
                if (p) { setWidth(p.w); setHeight(p.h) }
              }}
              className="bg-surface text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge focus:border-accent outline-none cursor-pointer flex-1"
            >
              {SIZE_PRESETS.map((p) => (
                <option key={p.label} value={p.label}>{p.label}</option>
              ))}
            </select>
            <button
              onClick={() => setShowCustomSize(true)}
              className="text-[10px] text-text-ghost hover:text-accent-bright transition-colors px-1"
            >
              px
            </button>
          </div>
        )}
      </div>

      {/* 배치 */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">배치</label>
        <div className="flex items-center rounded-lg border border-edge overflow-hidden">
          {BATCH_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => setBatchSize(n)}
              disabled={isGenerating}
              className={`px-2 py-1.5 text-[11px] font-mono transition-all disabled:opacity-40 ${
                batchSize === n ? 'bg-accent-muted text-accent-bright' : 'bg-surface text-text-sub hover:bg-elevated'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
