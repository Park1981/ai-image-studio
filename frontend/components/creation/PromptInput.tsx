/**
 * 프롬프트 입력 컴포넌트
 * 메인 프롬프트 textarea + 네거티브 프롬프트 토글 + AI 보강 체크박스
 * + 프롬프트 템플릿 저장/불러오기
 */

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api, type PromptTemplate } from '@/lib/api'
import { SparkleIcon, XCircleIcon, BookmarkIcon, FolderOpenIcon, XIcon } from '../icons'

export default function PromptInput() {
  // ── 스토어 상태 ──
  const prompt = useAppStore((s) => s.prompt)
  const setPrompt = useAppStore((s) => s.setPrompt)
  const negativePrompt = useAppStore((s) => s.negativePrompt)
  const setNegativePrompt = useAppStore((s) => s.setNegativePrompt)
  const autoEnhance = useAppStore((s) => s.autoEnhance)
  const setAutoEnhance = useAppStore((s) => s.setAutoEnhance)
  const enhancePending = useAppStore((s) => s.enhancePending)
  const generationStatus = useAppStore((s) => s.generationStatus)
  const editMode = useAppStore((s) => s.editMode)
  const enhanceLlmProvider = useAppStore((s) => s.enhanceLlmProvider)
  const setEnhanceLlmProvider = useAppStore((s) => s.setEnhanceLlmProvider)

  // ── 로컬 상태 ──
  const [showNegative, setShowNegative] = useState(false)

  // 템플릿 관련 상태
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [saving, setSaving] = useState(false)

  // 외부 클릭 감지용 ref
  const templateDropdownRef = useRef<HTMLDivElement>(null)
  const saveInputRef = useRef<HTMLInputElement>(null)

  const isGenerating =
    generationStatus === 'generating' ||
    generationStatus === 'warming_up' ||
    generationStatus === 'enhancing'
  const isEnhancing = generationStatus === 'enhancing'

  // ── 템플릿 목록 로드 ──
  const fetchTemplates = useCallback(async () => {
    const res = await api.getTemplates()
    if (res.success && res.data) {
      setTemplates(res.data)
    }
  }, [])

  // 드롭다운 열릴 때 목록 새로고침
  useEffect(() => {
    if (showTemplates) {
      fetchTemplates()
    }
  }, [showTemplates, fetchTemplates])

  // 저장 인풋 열릴 때 포커스
  useEffect(() => {
    if (showSaveInput && saveInputRef.current) {
      saveInputRef.current.focus()
    }
  }, [showSaveInput])

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        templateDropdownRef.current &&
        !templateDropdownRef.current.contains(e.target as Node)
      ) {
        setShowTemplates(false)
      }
    }
    if (showTemplates) {
      document.addEventListener('mousedown', handleClick)
    }
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showTemplates])

  // ── 템플릿 저장 ──
  const handleSaveTemplate = async () => {
    const name = templateName.trim()
    if (!name) return

    setSaving(true)
    const res = await api.saveTemplate({
      name,
      prompt,
      negative_prompt: negativePrompt,
      style: 'photorealistic',
    })
    setSaving(false)

    if (res.success) {
      setTemplateName('')
      setShowSaveInput(false)
      // 저장 후 목록 갱신 (드롭다운이 열려있다면)
      if (showTemplates) fetchTemplates()
    }
  }

  // ── 템플릿 불러오기 ──
  const handleLoadTemplate = (tpl: PromptTemplate) => {
    setPrompt(tpl.prompt)
    setNegativePrompt(tpl.negative_prompt || '')
    setShowTemplates(false)
  }

  // ── 템플릿 삭제 ──
  const handleDeleteTemplate = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    const res = await api.deleteTemplate(id)
    if (res.success) {
      setTemplates((prev) => prev.filter((t) => t.id !== id))
    }
  }

  return (
    <>
      {/* 프롬프트 textarea */}
      <div className="px-3 pt-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={editMode ? '수정할 내용을 설명해주세요...' : '이미지를 설명해주세요... (한국어 입력 가능)'}
          rows={3}
          disabled={isGenerating || enhancePending}
          className="w-full bg-surface rounded-lg resize-none outline-none px-3 py-2.5 text-[13px] placeholder-text-ghost leading-relaxed border border-edge focus:border-accent disabled:opacity-50"
        />
      </div>

      {/* AI 보강 토글 + 네거티브 토글 + 템플릿 버튼 */}
      <div className="px-3 py-2 flex items-center gap-2">
        <button
          onClick={() => setAutoEnhance(!autoEnhance)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
            autoEnhance ? 'bg-accent-muted text-accent-bright' : 'text-text-sub hover:text-text hover:bg-white/[0.04]'
          }`}
          disabled={isEnhancing}
        >
          <SparkleIcon /> AI 보강
        </button>
        {autoEnhance && (
          <select
            value={enhanceLlmProvider}
            onChange={(e) => setEnhanceLlmProvider(e.target.value as 'auto' | 'ollama' | 'claude')}
            className="bg-transparent text-[10px] text-text-sub border border-edge rounded-md px-1 py-1 outline-none focus:border-accent"
          >
            <option value="auto">자동</option>
            <option value="ollama">로컬 AI</option>
            <option value="claude">Claude</option>
          </select>
        )}
        {!editMode && (
          <button
            onClick={() => setShowNegative(!showNegative)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] transition-all ${
              showNegative ? 'bg-bad/10 text-bad' : 'text-text-sub hover:text-text hover:bg-white/[0.04]'
            }`}
          >
            <XCircleIcon /> 네거티브
          </button>
        )}

        {/* 구분선 */}
        <div className="w-px h-4 bg-edge mx-0.5" />

        {/* 템플릿 저장 버튼 */}
        <button
          onClick={() => {
            setShowSaveInput(!showSaveInput)
            setShowTemplates(false)
          }}
          disabled={!prompt.trim()}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-text-sub hover:text-text hover:bg-white/[0.04] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          title="현재 프롬프트를 템플릿으로 저장"
        >
          <BookmarkIcon /> 저장
        </button>

        {/* 템플릿 불러오기 드롭다운 */}
        <div className="relative" ref={templateDropdownRef}>
          <button
            onClick={() => {
              setShowTemplates(!showTemplates)
              setShowSaveInput(false)
            }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-text-sub hover:text-text hover:bg-white/[0.04] transition-all"
            title="저장된 템플릿 불러오기"
          >
            <FolderOpenIcon /> 불러오기
          </button>

          {/* 템플릿 목록 드롭다운 */}
          {showTemplates && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-panel border border-edge rounded-lg shadow-xl z-50 overflow-hidden">
              {templates.length === 0 ? (
                <div className="px-3 py-4 text-center text-[11px] text-text-ghost">
                  저장된 템플릿이 없습니다
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto">
                  {templates.map((tpl) => (
                    <div
                      key={tpl.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleLoadTemplate(tpl)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleLoadTemplate(tpl) }}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-white/[0.04] cursor-pointer group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-text truncate">{tpl.name}</p>
                        <p className="text-[10px] text-text-ghost truncate mt-0.5">
                          {tpl.prompt || '(빈 프롬프트)'}
                        </p>
                      </div>
                      {/* 삭제 버튼 */}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => handleDeleteTemplate(tpl.id, e)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.stopPropagation()
                            handleDeleteTemplate(tpl.id, e as unknown as React.MouseEvent)
                          }
                        }}
                        className="w-5 h-5 rounded flex items-center justify-center text-text-ghost hover:text-bad opacity-0 group-hover:opacity-100 transition-all shrink-0 cursor-pointer"
                        title="템플릿 삭제"
                      >
                        <XIcon />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 템플릿 저장 인라인 입력 */}
      {showSaveInput && (
        <div className="px-3 pb-2 flex items-center gap-2">
          <input
            ref={saveInputRef}
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveTemplate()
              if (e.key === 'Escape') {
                setShowSaveInput(false)
                setTemplateName('')
              }
            }}
            placeholder="템플릿 이름 입력 후 Enter"
            className="flex-1 bg-surface rounded-lg outline-none px-3 py-1.5 text-[12px] placeholder-text-ghost border border-edge focus:border-accent"
            maxLength={50}
          />
          <button
            onClick={handleSaveTemplate}
            disabled={!templateName.trim() || saving}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-accent-muted text-accent-bright hover:bg-accent/20 transition-all disabled:opacity-40"
          >
            {saving ? '...' : '저장'}
          </button>
          <button
            onClick={() => {
              setShowSaveInput(false)
              setTemplateName('')
            }}
            className="px-2 py-1.5 rounded-lg text-[11px] text-text-sub hover:text-text hover:bg-white/[0.04] transition-all"
          >
            취소
          </button>
        </div>
      )}

      {/* 네거티브 프롬프트 */}
      {showNegative && !enhancePending && (
        <div className="px-3 pb-2">
          <textarea
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="제외할 요소..."
            rows={2}
            disabled={isGenerating}
            className="w-full bg-surface rounded-lg resize-none outline-none px-3 py-2 text-[12px] placeholder-text-ghost leading-relaxed text-bad/70 border border-edge focus:border-bad/40 disabled:opacity-50"
          />
        </div>
      )}
    </>
  )
}
