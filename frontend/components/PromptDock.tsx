/**
 * 프롬프트 입력 독 컴포넌트
 * 프롬프트 입력 + 인라인 기본 설정 (모델, 사이즈, 배치)
 * AI 보강 2단계: 보강 → 사용자 확인/수정 → 이미지 생성
 * 구조화 보강: 카테고리별 EN/KO 표시 + 자세히 보기
 */

'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useGenerate } from '@/hooks/useGenerate'
import { useModels } from '@/hooks/useModels'
import { getAllPresets, saveCustomPresets, loadCustomPresets, type Preset } from '@/lib/presets'
import { api } from '@/lib/api'
import { SparkleIcon, XCircleIcon, BoltIcon, StopIcon, GearIcon, WarningIcon, EditIcon, UploadIcon } from './icons'

/** 사이즈 프리셋 목록 (Qwen Image 권장 해상도 포함) */
const SIZE_PRESETS = [
  { label: '1:1', w: 1328, h: 1328 },
  { label: '16:9', w: 1664, h: 928 },
  { label: '9:16', w: 928, h: 1664 },
  { label: '4:3', w: 1472, h: 1104 },
  { label: '3:2', w: 1584, h: 1056 },
] as const

/** 배치 수 옵션 */
const BATCH_OPTIONS = [1, 2, 3, 4] as const

/** 카테고리 아이콘 매핑 */
const CATEGORY_ICONS: Record<string, string> = {
  subject: '🧑',
  background: '🏞️',
  lighting: '💡',
  style: '📷',
  mood: '🎨',
  technical: '⚙️',
}

export default function PromptDock() {
  const prompt = useAppStore((s) => s.prompt)
  const setPrompt = useAppStore((s) => s.setPrompt)
  const negativePrompt = useAppStore((s) => s.negativePrompt)
  const setNegativePrompt = useAppStore((s) => s.setNegativePrompt)
  const autoEnhance = useAppStore((s) => s.autoEnhance)
  const setAutoEnhance = useAppStore((s) => s.setAutoEnhance)
  const enhancedPrompt = useAppStore((s) => s.enhancedPrompt)
  const setEnhancedPrompt = useAppStore((s) => s.setEnhancedPrompt)
  const enhancePending = useAppStore((s) => s.enhancePending)
  const enhancedNegative = useAppStore((s) => s.enhancedNegative)
  const generationStatus = useAppStore((s) => s.generationStatus)
  const enhanceFallback = useAppStore((s) => s.enhanceFallback)
  const setErrorMessage = useAppStore((s) => s.setErrorMessage)
  const enhancedCategories = useAppStore((s) => s.enhancedCategories)

  // 인라인 설정 상태
  const checkpoint = useAppStore((s) => s.checkpoint)
  const setCheckpoint = useAppStore((s) => s.setCheckpoint)
  const width = useAppStore((s) => s.width)
  const setWidth = useAppStore((s) => s.setWidth)
  const height = useAppStore((s) => s.height)
  const setHeight = useAppStore((s) => s.setHeight)
  const batchSize = useAppStore((s) => s.batchSize)
  const setBatchSize = useAppStore((s) => s.setBatchSize)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)

  // 이미지 수정 모드 상태
  const editMode = useAppStore((s) => s.editMode)
  const setEditMode = useAppStore((s) => s.setEditMode)
  const editSourceImage = useAppStore((s) => s.editSourceImage)
  const setEditSourceImage = useAppStore((s) => s.setEditSourceImage)
  const editSourcePreview = useAppStore((s) => s.editSourcePreview)
  const setEditSourcePreview = useAppStore((s) => s.setEditSourcePreview)

  // 모델 목록 가져오기
  const availableModels = useModels()

  const {
    generate, enhance, confirmEnhance, cancelEnhance,
    cancel, isGenerating,
  } = useGenerate()

  // 네거티브 프롬프트 표시 토글
  const [showNegative, setShowNegative] = useState(false)

  // 카테고리 자세히 보기 토글
  const [showCategoryDetail, setShowCategoryDetail] = useState(false)

  // 커스텀 사이즈 입력 모드
  const [showCustomSize, setShowCustomSize] = useState(false)

  // 파일 입력 참조
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 텍스트영역 참조
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 이미지 업로드 중 여부
  const [uploading, setUploading] = useState(false)

  // AI 보강 중 여부
  const isEnhancing = generationStatus === 'enhancing'

  // 모델 프리셋 데이터
  const modelPresets = useAppStore((s) => s.modelPresets)

  // 모델 프리셋 fetch (초기 1회)
  useEffect(() => {
    if (!modelPresets) {
      api.getModelPresets().then((res) => {
        if (res.success && res.data) {
          useAppStore.getState().setModelPresets(res.data)
        }
      })
    }
  }, [modelPresets])

  /** 모델 선택 시 권장 파라미터 자동 적용 */
  const handleModelSelect = useCallback((modelName: string) => {
    const s = useAppStore.getState()
    s.setCheckpoint(modelName)

    const presets = s.modelPresets
    if (!presets) return

    // 모델명에서 확장자 + 경로 제거하여 프리셋 키 매칭
    const key = modelName.replace(/\.safetensors$/, '').replace(/^.*[\\\/]/, '')

    // 직접 키 매칭 또는 aliases 검색
    type PresetEntry = { aliases?: string[]; sampler: string; scheduler: string; steps: number; cfg: number; default_width: number; default_height: number }
    const allPresets = { ...presets.diffusion_models, ...presets.checkpoints } as Record<string, PresetEntry>
    let preset: PresetEntry | undefined = allPresets[key]
    if (!preset) {
      // aliases에서 매칭 검색
      for (const [, v] of Object.entries(allPresets)) {
        if (v.aliases?.includes(key)) {
          preset = v
          break
        }
      }
    }

    if (preset) {
      s.setSampler(preset.sampler)
      s.setScheduler(preset.scheduler)
      s.setSteps(preset.steps)
      s.setCfg(preset.cfg)
      s.setWidth(preset.default_width)
      s.setHeight(preset.default_height)
    }
  }, [])

  /** 이미지 파일 업로드 처리 */
  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMessage('이미지 파일만 업로드할 수 있습니다.')
      return
    }

    setUploading(true)
    try {
      // Data URL 프리뷰 생성
      const reader = new FileReader()
      reader.onload = (e) => {
        setEditSourcePreview(e.target?.result as string)
      }
      reader.readAsDataURL(file)

      // 백엔드에 업로드
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
  }, [setErrorMessage, setEditSourceImage, setEditSourcePreview])

  /** 파일 입력 변경 핸들러 */
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileUpload(file)
    // 같은 파일 재선택 허용
    e.target.value = ''
  }, [handleFileUpload])

  /** 드래그 앤 드롭 핸들러 */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFileUpload(file)
  }, [handleFileUpload])

  // 수정 모드 중복 호출 방지 guard
  const editBusyRef = useRef(false)

  /** 수정 모드에서 생성 실행 (AI보강 결과 또는 원본 프롬프트 사용) */
  const handleEditGenerate = useCallback(async () => {
    if (!editSourceImage) {
      setErrorMessage('수정할 이미지를 먼저 업로드해주세요.')
      return
    }
    if (!prompt.trim()) {
      setErrorMessage('수정할 내용을 설명해주세요.')
      return
    }

    // autoEnhance ON이고 보강 대기 중이 아니면 → 먼저 보강 실행
    if (autoEnhance && !enhancePending) {
      await enhance(prompt.trim(), 'edit')
      return
    }

    // 중복 호출 방지
    if (editBusyRef.current) return
    editBusyRef.current = true

    // 보강 확인 후 또는 autoEnhance OFF → 바로 수정 실행
    const finalPrompt = enhancePending ? (enhancedPrompt || prompt.trim()) : prompt.trim()

    const store = useAppStore.getState()
    store.setGenerationStatus('warming_up')
    store.setProgress(0)
    store.setErrorMessage(null)
    store.setEnhancePending(false)
    store.setEnhanceFallback(false)
    store.setEnhancedCategories([])

    try {
      const response = await api.generateEdit({
        source_image: editSourceImage,
        edit_prompt: finalPrompt,
        steps: store.steps,
        cfg: store.cfg,
        seed: store.seed,
      })

      if (!response.success) {
        store.setGenerationStatus('error')
        store.setErrorMessage(response.error || '이미지 수정 요청에 실패했습니다.')
        return
      }

      const { task_id } = response.data
      store.setCurrentTaskId(task_id)

      // WebSocket 연결으로 진행률 수신
      const wsUrl = api.wsUrl('/api/ws/generate')
      const ws = new WebSocket(wsUrl)
      ws.onopen = () => ws.send(JSON.stringify({ task_id }))
      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data)
          const s = useAppStore.getState()
          switch (msg.type) {
            case 'status':
              if (['warming_up', 'enhancing', 'generating'].includes(msg.status)) {
                s.setGenerationStatus(msg.status)
              }
              break
            case 'progress':
              s.setProgress(msg.progress)
              s.setGenerationStatus('generating')
              break
            case 'executing':
              s.setGenerationStatus('generating')
              break
            case 'completed':
              s.setGenerationStatus('completed')
              s.setProgress(100)
              s.setGeneratedImages(msg.images)
              ws.close()
              break
            case 'error':
              s.setGenerationStatus('error')
              s.setErrorMessage(msg.message || msg.error || '이미지 수정 중 오류')
              ws.close()
              break
          }
        } catch { /* JSON 파싱 실패 무시 */ }
      }
      ws.onerror = () => ws.close()
    } catch {
      store.setGenerationStatus('error')
      store.setErrorMessage('이미지 수정 중 예상치 못한 오류가 발생했습니다.')
    } finally {
      editBusyRef.current = false
    }
  }, [editSourceImage, prompt, autoEnhance, enhancePending, enhancedPrompt, enhance, setErrorMessage])

  /** Ctrl+Enter 단축키로 생성/확인 */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (enhancePending) {
          if (editMode) {
            handleEditGenerate()
          } else {
            confirmEnhance()
          }
        } else if (editMode && !isGenerating && prompt.trim()) {
          handleEditGenerate()
        } else if (!isGenerating && prompt.trim()) {
          generate()
        }
      }
      // ESC로 보강 취소 (풀스크린 뷰어가 열려있으면 뷰어가 우선 처리)
      if (e.key === 'Escape' && enhancePending) {
        const viewerOpen = useAppStore.getState().viewerIndex !== null
        if (!viewerOpen) cancelEnhance()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [generate, handleEditGenerate, confirmEnhance, cancelEnhance, isGenerating, enhancePending, editMode, prompt])

  /** 생성/취소 버튼 클릭 */
  const handleGenerateClick = useCallback(() => {
    if (isGenerating) {
      cancel()
    } else if (editMode) {
      handleEditGenerate()
    } else if (enhancePending) {
      confirmEnhance()
    } else {
      generate()
    }
  }, [isGenerating, editMode, handleEditGenerate, enhancePending, generate, confirmEnhance, cancel])

  /** 프리셋 적용 — 파라미터 + AI 보강 스타일 힌트 */
  const handlePresetSelect = useCallback((presetId: string) => {
    const preset = getAllPresets().find((p) => p.id === presetId)
    if (!preset) return
    const s = useAppStore.getState()
    s.setSampler(preset.params.sampler)
    s.setScheduler(preset.params.scheduler)
    s.setSteps(preset.params.steps)
    s.setCfg(preset.params.cfg)
    s.setWidth(preset.params.width)
    s.setHeight(preset.params.height)
    s.setActiveStyleHint(preset.styleHint)
    // 프리셋에 카테고리 설정이 있으면 적용
    if (preset.enhanceCategories) {
      s.setEnhanceSettings({ categories: preset.enhanceCategories })
    }
  }, [])

  // 프리셋 목록 상태 (커스텀 저장 시 즉시 갱신용)
  const [presetList, setPresetList] = useState(() => getAllPresets())

  /** 현재 설정을 프리셋으로 저장 */
  const handleSavePreset = useCallback(() => {
    const name = window.prompt('프리셋 이름을 입력하세요:')
    if (!name?.trim()) return
    const store = useAppStore.getState()
    const custom = loadCustomPresets()
    const newPreset: Preset = {
      id: `custom-${Date.now()}`,
      name: name.trim(),
      icon: '🎨',
      builtin: false,
      styleHint: store.activeStyleHint,
      params: {
        sampler: store.sampler,
        scheduler: store.scheduler,
        steps: store.steps,
        cfg: store.cfg,
        width: store.width,
        height: store.height,
      },
      enhanceCategories: { ...store.enhanceSettings.categories },
    }
    custom.push(newPreset)
    saveCustomPresets(custom)
    setPresetList(getAllPresets())
  }, [])

  /** 현재 사이즈 프리셋 라벨 계산 */
  const currentSizeLabel =
    SIZE_PRESETS.find((p) => p.w === width && p.h === height)?.label ?? 'custom'

  return (
    <div className="shrink-0 px-2 pb-2">
      <div className="prompt-glow rounded-xl bg-surface border border-edge transition-all">
        {/* 수정 모드: 소스 이미지 업로드 영역 */}
        {editMode && (
          <div className="px-3 pt-3 pb-1">
            {editSourcePreview ? (
              /* 업로드된 이미지 프리뷰 */
              <div className="flex items-center gap-3">
                <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-edge shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={editSourcePreview}
                    alt="수정할 이미지"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-text-sub truncate">
                    {editSourceImage || '업로드 중...'}
                  </p>
                  <button
                    onClick={() => {
                      setEditSourceImage(null)
                      setEditSourcePreview(null)
                    }}
                    className="text-[10px] text-bad/70 hover:text-bad transition-colors mt-0.5"
                  >
                    이미지 제거
                  </button>
                </div>
              </div>
            ) : (
              /* 이미지 업로드 드롭존 */
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-1.5 py-4 rounded-lg border-2 border-dashed border-edge hover:border-accent/50 cursor-pointer transition-all hover:bg-accent-muted/10"
              >
                <UploadIcon />
                <span className="text-[11px] text-text-sub">
                  {uploading ? '업로드 중...' : '이미지를 드래그하거나 클릭하여 선택'}
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
        )}

        {/* 메인 프롬프트 입력 */}
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={editMode ? '수정할 내용을 설명해주세요...' : '이미지를 설명해주세요... (한국어 입력 가능)'}
          rows={2}
          disabled={isGenerating || enhancePending}
          className="w-full bg-transparent resize-none outline-none px-4 pt-3 pb-1 text-[13px] placeholder-text-ghost leading-relaxed disabled:opacity-50"
        />

        {/* AI 보강 결과 확인 영역 (2단계 플로우) — 생성/수정 모두 */}
        {enhancePending && enhancedPrompt && (
          <div className={`mx-3 mb-2 rounded-lg border p-3 ${
            enhanceFallback
              ? 'border-bad/40 bg-bad/5'
              : 'border-accent/30 bg-accent-muted/30'
          }`}>
            <div className="flex items-center gap-1.5 mb-1.5">
              {enhanceFallback ? <WarningIcon /> : <SparkleIcon />}
              <span className={`text-[11px] font-medium ${
                enhanceFallback ? 'text-bad' : 'text-accent-bright'
              }`}>
                {enhanceFallback
                  ? 'AI 보강 실패 — 기본 프롬프트 적용됨'
                  : editMode ? 'AI 수정 보강 결과' : 'AI 보강 결과'
                }
              </span>
              {/* 자세히 보기 토글 */}
              {enhancedCategories.length > 0 && (
                <button
                  onClick={() => setShowCategoryDetail(!showCategoryDetail)}
                  className="text-[10px] text-accent-bright/70 hover:text-accent-bright transition-colors ml-1"
                >
                  {showCategoryDetail ? '간략히' : '자세히'}
                </button>
              )}
              <span className="text-[10px] text-text-ghost ml-auto">수정 가능</span>
            </div>
            {/* Ollama 폴백 경고 배너 */}
            {enhanceFallback && (
              <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-md bg-bad/10 border border-bad/20">
                <span className="text-[10px] text-bad/80 leading-snug">
                  Ollama(gemma4) 연결 실패로 기본 품질 태그만 추가되었습니다.
                </span>
                <button
                  onClick={() => enhance(prompt.trim(), editMode ? 'edit' : 'generate')}
                  disabled={isEnhancing}
                  className="shrink-0 px-2.5 py-1 rounded-md text-[10px] font-medium text-bad border border-bad/30 hover:bg-bad/10 transition-all disabled:opacity-40"
                >
                  {isEnhancing ? '재시도 중...' : '재시도'}
                </button>
              </div>
            )}

            {/* 카테고리 상세 보기 */}
            {showCategoryDetail && enhancedCategories.length > 0 ? (
              <div className="space-y-2 mb-2">
                {enhancedCategories.map((cat) => (
                  <div
                    key={cat.name}
                    className={`rounded-md border px-2.5 py-2 ${
                      cat.auto_filled
                        ? 'border-accent/20 bg-accent-muted/10'
                        : 'border-edge bg-ground/30'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[11px]">{CATEGORY_ICONS[cat.name] || '📎'}</span>
                      <span className="text-[10px] font-medium text-text-sub">
                        {cat.label_ko}
                      </span>
                      {cat.auto_filled && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent-bright">
                          AI 자동
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-text leading-relaxed">{cat.text_en}</p>
                    <p className="text-[10px] text-text-sub/70 mt-0.5">{cat.text_ko}</p>
                  </div>
                ))}
              </div>
            ) : (
              /* 합쳐진 보강 프롬프트 편집 */
              <textarea
                value={enhancedPrompt}
                onChange={(e) => setEnhancedPrompt(e.target.value)}
                rows={3}
                className="w-full bg-ground/50 rounded-md resize-none outline-none px-3 py-2 text-[12px] text-text leading-relaxed border border-edge focus:border-accent"
              />
            )}

            {/* 보강된 네거티브 프롬프트 */}
            {enhancedNegative && (
              <p className="mt-1.5 text-[10px] text-bad/60 truncate">
                네거티브: {enhancedNegative}
              </p>
            )}
            {/* 액션 버튼 */}
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => editMode ? handleEditGenerate() : confirmEnhance()}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-semibold btn-glow text-white"
              >
                {editMode ? <EditIcon /> : <BoltIcon />}
                {editMode ? '이미지 수정' : '이미지 생성'}
              </button>
              <button
                onClick={() => enhance(enhancedPrompt, editMode ? 'edit' : 'generate')}
                disabled={isEnhancing}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-accent-bright hover:bg-accent-muted transition-all border border-accent/30"
              >
                {isEnhancing ? '보강 중...' : '다시 보강'}
              </button>
              <button
                onClick={() => cancelEnhance()}
                className="px-3 py-1.5 rounded-lg text-[11px] text-text-sub hover:text-text hover:bg-white/[0.04] transition-all"
              >
                취소
              </button>
              <span className="text-[10px] text-text-ghost ml-auto hidden lg:inline">
                Ctrl+Enter {editMode ? '수정' : '생성'} · ESC 취소
              </span>
            </div>
          </div>
        )}

        {/* 보강 대기 중이 아닐 때만 기존 보강 프리뷰 표시 */}
        {!enhancePending && enhancedPrompt && enhancedPrompt !== prompt && (
          <div className="px-4 pb-1">
            <p className="text-[10px] text-accent-bright/60 truncate">
              AI 보강: {enhancedPrompt}
            </p>
          </div>
        )}

        {/* 네거티브 프롬프트 입력 (토글) */}
        {showNegative && !enhancePending && (
          <div className="px-4 pb-1 border-t border-edge/50">
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="제외할 요소를 입력하세요... (네거티브 프롬프트)"
              rows={1}
              disabled={isGenerating}
              className="w-full bg-transparent resize-none outline-none pt-2 pb-1 text-[12px] placeholder-text-ghost leading-relaxed text-bad/70 disabled:opacity-50"
            />
          </div>
        )}

        {/* 하단 액션 바 — 보강 대기 중이면 숨김 */}
        {!enhancePending && (
          <div className="flex items-center justify-between px-2.5 pb-2 gap-1 flex-wrap">
            <div className="flex items-center gap-1 flex-wrap">
              {/* 생성 / 수정 모드 토글 */}
              <div className="flex items-center rounded-lg border border-edge overflow-hidden mr-0.5">
                <button
                  onClick={() => setEditMode(false)}
                  disabled={isGenerating}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium transition-all disabled:opacity-40 ${
                    !editMode
                      ? 'bg-accent-muted text-accent-bright'
                      : 'bg-ground text-text-sub hover:bg-elevated'
                  }`}
                >
                  <BoltIcon />
                  생성
                </button>
                <button
                  onClick={() => setEditMode(true)}
                  disabled={isGenerating}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium transition-all disabled:opacity-40 ${
                    editMode
                      ? 'bg-accent-muted text-accent-bright'
                      : 'bg-ground text-text-sub hover:bg-elevated'
                  }`}
                >
                  <EditIcon />
                  수정
                </button>
              </div>

              {/* AI 보강 토글 — 생성 + 수정 모드 모두 표시 */}
              <button
                onClick={autoEnhance ? () => setAutoEnhance(false) : () => setAutoEnhance(true)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                  autoEnhance
                    ? 'bg-accent-muted text-accent-bright'
                    : 'text-text-sub hover:text-text hover:bg-white/[0.04]'
                }`}
                title={autoEnhance ? '자동 보강 ON' : '자동 보강 OFF'}
                disabled={isEnhancing}
              >
                <SparkleIcon />
                AI 보강
              </button>

              {/* 생성 모드 전용 컨트롤 (수정 모드에서는 숨김) */}
              {!editMode && (
                <>
                  {/* 네거티브 프롬프트 토글 */}
                  <button
                    onClick={() => setShowNegative(!showNegative)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] transition-all ${
                      showNegative
                        ? 'bg-bad/10 text-bad'
                        : 'text-text-sub hover:text-text hover:bg-white/[0.04]'
                    }`}
                  >
                    <XCircleIcon />
                    네거티브
                  </button>

                  {/* 구분선 */}
                  <div className="w-px h-4 bg-edge mx-0.5" />

                  {/* 프리셋 드롭다운 */}
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value === '__save__') {
                        handleSavePreset()
                      } else {
                        handlePresetSelect(e.target.value)
                      }
                      e.target.value = ''
                    }}
                    disabled={isGenerating}
                    className="bg-ground text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge hover:border-edge-hover focus:border-accent outline-none transition-all cursor-pointer disabled:opacity-40"
                  >
                    <option value="">프리셋</option>
                    {presetList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.icon} {p.name}
                      </option>
                    ))}
                    <option value="__save__">💾 현재 설정 저장...</option>
                  </select>

                  {/* 모델 드롭다운 — 선택 시 권장 파라미터 자동 적용 */}
                  <select
                    value={checkpoint}
                    onChange={(e) => handleModelSelect(e.target.value)}
                    disabled={isGenerating}
                    className="bg-ground text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge hover:border-edge-hover focus:border-accent outline-none transition-all max-w-[160px] truncate cursor-pointer disabled:opacity-40"
                    title={checkpoint || 'Qwen Image (워크플로우 기본)'}
                  >
                    <option value="">Qwen Image (기본)</option>
                    {availableModels.diffusionModels.length > 0 && (
                      <optgroup label="Diffusion Models">
                        {availableModels.diffusionModels.map((dm) => (
                          <option key={dm} value={dm}>{dm}</option>
                        ))}
                      </optgroup>
                    )}
                    {availableModels.checkpoints.length > 0 && (
                      <optgroup label="Checkpoints">
                        {availableModels.checkpoints.map((cp) => (
                          <option key={cp} value={cp}>{cp}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>

                  {/* 사이즈: 프리셋 드롭다운 + 커스텀 입력 토글 */}
                  {showCustomSize ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={width}
                        onChange={(e) => {
                          const v = parseInt(e.target.value) || 256
                          setWidth(Math.round(Math.max(256, Math.min(2048, v)) / 8) * 8)
                        }}
                        step={8}
                        disabled={isGenerating}
                        className="w-[60px] bg-ground text-[11px] font-mono text-text-sub rounded-lg px-1.5 py-1.5 border border-edge focus:border-accent outline-none text-center disabled:opacity-40"
                        title="너비 (px, 8의 배수)"
                      />
                      <span className="text-[10px] text-text-ghost">×</span>
                      <input
                        type="number"
                        value={height}
                        onChange={(e) => {
                          const v = parseInt(e.target.value) || 256
                          setHeight(Math.round(Math.max(256, Math.min(2048, v)) / 8) * 8)
                        }}
                        step={8}
                        disabled={isGenerating}
                        className="w-[60px] bg-ground text-[11px] font-mono text-text-sub rounded-lg px-1.5 py-1.5 border border-edge focus:border-accent outline-none text-center disabled:opacity-40"
                        title="높이 (px, 8의 배수)"
                      />
                      <button
                        onClick={() => setShowCustomSize(false)}
                        className="text-[10px] text-text-ghost hover:text-accent-bright transition-colors px-1"
                        title="비율 프리셋으로 전환"
                      >
                        비율
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-0.5">
                      <select
                        value={currentSizeLabel}
                        onChange={(e) => {
                          const preset = SIZE_PRESETS.find((p) => p.label === e.target.value)
                          if (preset) {
                            setWidth(preset.w)
                            setHeight(preset.h)
                          }
                        }}
                        disabled={isGenerating}
                        className="bg-ground text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge hover:border-edge-hover focus:border-accent outline-none transition-all cursor-pointer disabled:opacity-40"
                      >
                        {SIZE_PRESETS.map((preset) => (
                          <option key={preset.label} value={preset.label}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => setShowCustomSize(true)}
                        className="text-[10px] text-text-ghost hover:text-accent-bright transition-colors px-1"
                        title="직접 픽셀 입력"
                      >
                        px
                      </button>
                    </div>
                  )}

                  {/* 배치 수 버튼 그룹 */}
                  <div className="flex items-center rounded-lg border border-edge overflow-hidden">
                    {BATCH_OPTIONS.map((n) => (
                      <button
                        key={n}
                        onClick={() => setBatchSize(n)}
                        disabled={isGenerating}
                        className={`px-2 py-1.5 text-[11px] font-mono transition-all disabled:opacity-40 ${
                          batchSize === n
                            ? 'bg-accent-muted text-accent-bright'
                            : 'bg-ground text-text-sub hover:bg-elevated'
                        }`}
                        title={`${n}장 생성`}
                      >
                        x{n}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* 고급 설정 토글 */}
              <button
                onClick={toggleSidebar}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] transition-all ${
                  sidebarOpen
                    ? 'bg-accent-muted text-accent-bright'
                    : 'text-text-sub hover:text-text hover:bg-white/[0.04]'
                }`}
                title="고급 설정 패널 열기/닫기"
              >
                <GearIcon />
                고급
              </button>

              {/* 단축키 안내 */}
              <span className="text-[10px] text-text-ghost ml-1 hidden lg:inline">
                Ctrl+Enter
              </span>
            </div>

            {/* 생성/수정/취소 버튼 */}
            <button
              onClick={handleGenerateClick}
              disabled={!isGenerating && !prompt.trim()}
              className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-[13px] font-semibold transition-all shrink-0 ${
                isGenerating
                  ? 'bg-bad/20 text-bad hover:bg-bad/30 border border-bad/30'
                  : 'btn-glow text-white disabled:opacity-30 disabled:cursor-not-allowed'
              }`}
            >
              {isGenerating ? (
                <>
                  <StopIcon />
                  취소
                </>
              ) : editMode ? (
                <>
                  <EditIcon />
                  수정
                </>
              ) : (
                <>
                  <BoltIcon />
                  생성
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
