/**
 * AI 보강 결과 표시 컴포넌트
 * 보강된 프롬프트 미리보기/편집, 카테고리 상세, 생성/재보강/취소 버튼
 */

'use client'

import { useState } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useGenerate } from '@/hooks/useGenerate'
import { useEnhance } from '@/hooks/useEnhance'
import { useEditMode } from '@/hooks/useEditMode'
import { SparkleIcon, WarningIcon, BoltIcon, EditIcon } from '../icons'

/** 카테고리 아이콘 매핑 */
const CATEGORY_ICONS: Record<string, string> = {
  subject: '🧑', background: '🏞️', lighting: '💡',
  style: '📷', mood: '🎨', technical: '⚙️',
}

export default function EnhanceResult() {
  // ── 스토어 상태 ──
  const enhancePending = useAppStore((s) => s.enhancePending)
  const enhancedPrompt = useAppStore((s) => s.enhancedPrompt)
  const setEnhancedPrompt = useAppStore((s) => s.setEnhancedPrompt)
  const enhancedNegative = useAppStore((s) => s.enhancedNegative)
  const enhanceFallback = useAppStore((s) => s.enhanceFallback)
  const enhanceProvider = useAppStore((s) => s.enhanceProvider)
  const enhancedCategories = useAppStore((s) => s.enhancedCategories)
  const generationStatus = useAppStore((s) => s.generationStatus)
  const editMode = useAppStore((s) => s.editMode)
  const prompt = useAppStore((s) => s.prompt)

  const { confirmEnhance } = useGenerate()
  const { enhance, cancelEnhance } = useEnhance()
  const { executeEdit } = useEditMode()

  // ── 로컬 상태 ──
  const [showCategoryDetail, setShowCategoryDetail] = useState(false)

  const isEnhancing = generationStatus === 'enhancing'
  const isGeneratingBusy =
    generationStatus === 'generating' ||
    generationStatus === 'warming_up' ||
    generationStatus === 'enhancing'

  // 보강 결과가 없으면 렌더링 안 함
  if (!enhancePending || !enhancedPrompt) return null

  /** 수정 모드 생성 핸들러 (editMode에서 보강 확인 후 생성) */
  const handleEditConfirm = async () => {
    const finalPrompt = enhancedPrompt || prompt.trim()
    await executeEdit(finalPrompt)
  }

  return (
    <div className={`mx-3 mb-2 rounded-lg border p-3 ${
      enhanceFallback ? 'border-bad/40 bg-bad/5' : 'border-accent/30 bg-accent-muted/30'
    }`}>
      {/* 헤더 — 생성 중에는 "사용 중" 뱃지 표시 */}
      <div className="flex items-center gap-1.5 mb-1.5">
        {enhanceFallback ? <WarningIcon /> : <SparkleIcon />}
        <span className={`text-[11px] font-medium ${enhanceFallback ? 'text-bad' : 'text-accent-bright'}`}>
          {enhanceFallback
            ? 'AI 보강 실패 — 기본 프롬프트'
            : enhanceProvider === 'claude_cli'
              ? editMode ? 'Claude로 수정 보강됨' : 'Claude로 보강됨'
              : editMode ? 'AI 수정 보강 결과' : 'AI 보강 결과'}
        </span>
        {isGeneratingBusy && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent-bright">
            생성에 사용 중
          </span>
        )}
        {enhancedCategories.length > 0 && (
          <button
            onClick={() => setShowCategoryDetail(!showCategoryDetail)}
            className="text-[10px] text-accent-bright/70 hover:text-accent-bright transition-colors ml-1"
          >
            {showCategoryDetail ? '간략히' : '자세히'}
          </button>
        )}
      </div>

      {/* 폴백 경고 */}
      {enhanceFallback && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-md bg-bad/10 border border-bad/20">
          <span className="text-[10px] text-bad/80 leading-snug">Ollama 연결 실패</span>
          <button
            onClick={() => enhance(prompt.trim(), editMode ? 'edit' : 'generate')}
            disabled={isEnhancing}
            className="shrink-0 px-2.5 py-1 rounded-md text-[10px] font-medium text-bad border border-bad/30 hover:bg-bad/10 transition-all disabled:opacity-40"
          >
            {isEnhancing ? '...' : '재시도'}
          </button>
        </div>
      )}

      {/* 카테고리 상세 or 보강 프롬프트 편집 */}
      {showCategoryDetail && enhancedCategories.length > 0 ? (
        <div className="space-y-2 mb-2">
          {enhancedCategories.map((cat) => (
            <div key={cat.name} className={`rounded-md border px-2.5 py-2 ${cat.auto_filled ? 'border-accent/20 bg-accent-muted/10' : 'border-edge bg-ground/30'}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[11px]">{CATEGORY_ICONS[cat.name] || '📎'}</span>
                <span className="text-[10px] font-medium text-text-sub">{cat.label_ko}</span>
                {cat.auto_filled && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent-bright">AI 자동</span>}
              </div>
              <p className="text-[11px] text-text leading-relaxed">{cat.text_en}</p>
              <p className="text-[10px] text-text-sub/70 mt-0.5">{cat.text_ko}</p>
            </div>
          ))}
        </div>
      ) : (
        <textarea
          value={enhancedPrompt}
          onChange={(e) => setEnhancedPrompt(e.target.value)}
          rows={3}
          className="w-full bg-ground/50 rounded-md resize-none outline-none px-3 py-2 text-[12px] text-text leading-relaxed border border-edge focus:border-accent"
        />
      )}

      {/* 네거티브 표시 */}
      {enhancedNegative && (
        <p className="mt-1.5 text-[10px] text-bad/60 truncate">네거티브: {enhancedNegative}</p>
      )}

      {/* 버튼 그룹 — 라벨 잘림 방지 위해 flex-wrap + whitespace-nowrap */}
      {/* 생성 중에는 비활성화하여 중복 제출 차단 (enhancePending 유지 + 프롬프트 가시화 목적) */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <button
          onClick={() => editMode ? handleEditConfirm() : confirmEnhance()}
          disabled={isGeneratingBusy}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold btn-glow text-white whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {editMode ? <><EditIcon /> 이미지 수정</> : <><BoltIcon /> 이미지 생성</>}
        </button>
        <button
          onClick={() => enhance(enhancedPrompt, editMode ? 'edit' : 'generate')}
          disabled={isGeneratingBusy}
          className="px-3 py-2 rounded-lg text-[11px] font-medium text-accent-bright hover:bg-accent-muted transition-all border border-accent/30 whitespace-nowrap disabled:opacity-40"
        >
          {isEnhancing ? '보강 중…' : '다시 보강'}
        </button>
        <button
          onClick={() => cancelEnhance()}
          disabled={isGeneratingBusy}
          className="px-3 py-2 rounded-lg text-[11px] text-text-sub hover:text-text hover:bg-white/[0.04] transition-all whitespace-nowrap disabled:opacity-40"
        >
          취소
        </button>
      </div>
    </div>
  )
}
