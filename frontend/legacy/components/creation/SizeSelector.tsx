/**
 * 사이즈 + 배치 선택 컴포넌트
 * 비율 프리셋 버튼 + 커스텀 px 입력 + 배치 사이즈
 * 커스텀 px 모드에서도 비율 잠금 유지 — 한쪽 입력 변경 시 반대쪽 자동 계산
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

const FREE_RATIO = '자유'

/** 8 단위 스냅 + 256~2048 클램프 공통 */
const snapPx = (n: number) => Math.round(Math.max(256, Math.min(2048, n)) / 8) * 8

/** 라벨(예: '1:1')에서 w/h 배율 반환. '자유'면 null */
const ratioOf = (label: string): { rw: number; rh: number } | null => {
  const p = SIZE_PRESETS.find((s) => s.label === label)
  return p ? { rw: p.w, rh: p.h } : null
}

export default function SizeSelector() {
  // ── 스토어 상태 ──
  const width = useAppStore((s) => s.width)
  const setWidth = useAppStore((s) => s.setWidth)
  const height = useAppStore((s) => s.height)
  const setHeight = useAppStore((s) => s.setHeight)
  const batchSize = useAppStore((s) => s.batchSize)
  const setBatchSize = useAppStore((s) => s.setBatchSize)
  const generationStatus = useAppStore((s) => s.generationStatus)
  // 커스텀 px 모드의 비율 잠금 — store 기반 (이미지 업로드 시 외부에서 '자유'로 전환 가능)
  const customRatio = useAppStore((s) => s.customRatio)
  const setCustomRatio = useAppStore((s) => s.setCustomRatio)

  // ── 로컬 상태 ──
  const [showCustomSize, setShowCustomSize] = useState(false)

  const isGenerating =
    generationStatus === 'generating' ||
    generationStatus === 'warming_up' ||
    generationStatus === 'enhancing'

  const matchedPreset = SIZE_PRESETS.find((p) => p.w === width && p.h === height)
  const currentSizeLabel = matchedPreset?.label ?? 'custom'
  // 사용자가 px 모드 수동 진입했거나, 현재 w/h가 프리셋과 매치되지 않으면 custom 입력 UI 자동 표시
  // (예: 수정 모드에서 소스 이미지 해상도를 그대로 반영했을 때)
  const showCustomInput = showCustomSize || !matchedPreset

  // ── 핸들러 ──
  /** 커스텀 모드 진입: 현재 w/h가 프리셋과 매치되면 비율 유지 */
  const enterCustomMode = () => {
    const matched = SIZE_PRESETS.find((p) => p.w === width && p.h === height)
    if (matched) setCustomRatio(matched.label)
    setShowCustomSize(true)
  }

  /** 가로 입력 → 비율 잠금 시 세로 자동 계산 */
  const handleWidthChange = (raw: string) => {
    const v = parseInt(raw) || 256
    const newW = snapPx(v)
    setWidth(newW)
    const r = ratioOf(customRatio)
    if (r) setHeight(snapPx((newW * r.rh) / r.rw))
  }

  /** 세로 입력 → 비율 잠금 시 가로 자동 계산 */
  const handleHeightChange = (raw: string) => {
    const v = parseInt(raw) || 256
    const newH = snapPx(v)
    setHeight(newH)
    const r = ratioOf(customRatio)
    if (r) setWidth(snapPx((newH * r.rw) / r.rh))
  }

  /** 비율 선택 변경 → 특정 비율이면 현재 가로 기준으로 세로 맞춤 */
  const handleRatioChange = (next: string) => {
    setCustomRatio(next)
    const r = ratioOf(next)
    if (r) setHeight(snapPx((width * r.rh) / r.rw))
  }

  return (
    <div className="flex gap-3">
      {/* 사이즈 */}
      <div className="flex-1 min-w-0">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">사이즈</label>
        {showCustomInput ? (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
            <input
              type="number"
              value={width}
              step={8}
              onChange={(e) => handleWidthChange(e.target.value)}
              className="w-[56px] bg-surface text-[11px] font-mono text-text-sub rounded-lg px-1.5 py-1.5 border border-edge focus:border-accent outline-none text-center shrink-0"
            />
            <span className="text-[10px] text-text-ghost shrink-0">×</span>
            <input
              type="number"
              value={height}
              step={8}
              onChange={(e) => handleHeightChange(e.target.value)}
              className="w-[56px] bg-surface text-[11px] font-mono text-text-sub rounded-lg px-1.5 py-1.5 border border-edge focus:border-accent outline-none text-center shrink-0"
            />
            {/* 비율 잠금 드롭다운 ('자유' 선택 시 해제) */}
            <select
              value={customRatio}
              onChange={(e) => handleRatioChange(e.target.value)}
              title={customRatio === FREE_RATIO ? '비율 자유 (독립 입력)' : `비율 고정: ${customRatio}`}
              className="bg-surface text-[10px] font-mono text-text-sub rounded-md px-1 py-1 border border-edge focus:border-accent outline-none shrink-0"
            >
              <option value={FREE_RATIO}>{FREE_RATIO}</option>
              {SIZE_PRESETS.map((p) => (
                <option key={p.label} value={p.label}>{p.label}</option>
              ))}
            </select>
            <button
              onClick={() => setShowCustomSize(false)}
              className="text-[10px] text-text-ghost hover:text-accent-bright transition-colors shrink-0"
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
                if (p) { setWidth(p.w); setHeight(p.h); setCustomRatio(p.label) }
              }}
              className="bg-surface text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge focus:border-accent outline-none cursor-pointer flex-1 min-w-0"
            >
              {SIZE_PRESETS.map((p) => (
                <option key={p.label} value={p.label}>{p.label}</option>
              ))}
            </select>
            <button
              onClick={enterCustomMode}
              className="text-[10px] text-text-ghost hover:text-accent-bright transition-colors px-1 shrink-0"
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
