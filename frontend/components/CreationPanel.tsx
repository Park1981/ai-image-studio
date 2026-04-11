/**
 * 오른쪽 생성 패널
 * 프롬프트 입력 + 모델/설정 + AI 보강 결과 + 고급 설정을 수직 배치
 * PromptDock + SettingsSidebar 통합
 */

'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useGenerate } from '@/hooks/useGenerate'
import { useModels } from '@/hooks/useModels'
import { getAllPresets, saveCustomPresets, loadCustomPresets, type Preset } from '@/lib/presets'
import { api } from '@/lib/api'
import {
  SparkleIcon, XCircleIcon, BoltIcon, StopIcon, WarningIcon, EditIcon, UploadIcon, PlusIcon, RefreshIcon, XIcon,
} from './icons'

/** 사이즈 프리셋 목록 */
const SIZE_PRESETS = [
  { label: '1:1', w: 1328, h: 1328 },
  { label: '16:9', w: 1664, h: 928 },
  { label: '9:16', w: 928, h: 1664 },
  { label: '4:3', w: 1472, h: 1104 },
  { label: '3:2', w: 1584, h: 1056 },
] as const

const BATCH_OPTIONS = [1, 2, 3, 4] as const

const CATEGORY_ICONS: Record<string, string> = {
  subject: '🧑', background: '🏞️', lighting: '💡',
  style: '📷', mood: '🎨', technical: '⚙️',
}

export default function CreationPanel() {
  // ── 스토어 상태 ──
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

  const checkpoint = useAppStore((s) => s.checkpoint)
  const width = useAppStore((s) => s.width)
  const setWidth = useAppStore((s) => s.setWidth)
  const height = useAppStore((s) => s.height)
  const setHeight = useAppStore((s) => s.setHeight)
  const batchSize = useAppStore((s) => s.batchSize)
  const setBatchSize = useAppStore((s) => s.setBatchSize)

  // 수정 모드
  const editMode = useAppStore((s) => s.editMode)
  const setEditMode = useAppStore((s) => s.setEditMode)
  const editSourceImage = useAppStore((s) => s.editSourceImage)
  const setEditSourceImage = useAppStore((s) => s.setEditSourceImage)
  const editSourcePreview = useAppStore((s) => s.editSourcePreview)
  const setEditSourcePreview = useAppStore((s) => s.setEditSourcePreview)

  // 고급 설정
  const vae = useAppStore((s) => s.vae)
  const setVae = useAppStore((s) => s.setVae)
  const loras = useAppStore((s) => s.loras)
  const addLora = useAppStore((s) => s.addLora)
  const removeLora = useAppStore((s) => s.removeLora)
  const updateLoraStrength = useAppStore((s) => s.updateLoraStrength)
  const steps = useAppStore((s) => s.steps)
  const setSteps = useAppStore((s) => s.setSteps)
  const cfg = useAppStore((s) => s.cfg)
  const setCfg = useAppStore((s) => s.setCfg)
  const seed = useAppStore((s) => s.seed)
  const setSeed = useAppStore((s) => s.setSeed)
  const sampler = useAppStore((s) => s.sampler)
  const setSampler = useAppStore((s) => s.setSampler)
  const scheduler = useAppStore((s) => s.scheduler)
  const setScheduler = useAppStore((s) => s.setScheduler)

  const modelPresets = useAppStore((s) => s.modelPresets)
  const availableModels = useModels()
  const { generate, enhance, confirmEnhance, cancelEnhance, cancel, isGenerating } = useGenerate()

  // ── 로컬 상태 ──
  const [showNegative, setShowNegative] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showCategoryDetail, setShowCategoryDetail] = useState(false)
  const [showCustomSize, setShowCustomSize] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editBusyRef = useRef(false)
  const isEnhancing = generationStatus === 'enhancing'

  // 모델 프리셋 fetch
  useEffect(() => {
    if (!modelPresets) {
      api.getModelPresets().then((res) => {
        if (res.success && res.data) useAppStore.getState().setModelPresets(res.data)
      })
    }
  }, [modelPresets])

  // ── 핸들러 ──

  /** 모델 선택 시 권장 파라미터 자동 적용 */
  const handleModelSelect = useCallback((modelName: string) => {
    const s = useAppStore.getState()
    s.setCheckpoint(modelName)
    const presets = s.modelPresets
    if (!presets) return
    const key = modelName.replace(/\.safetensors$/, '').replace(/^.*[\\\/]/, '')
    type PresetEntry = { aliases?: string[]; sampler: string; scheduler: string; steps: number; cfg: number; default_width: number; default_height: number }
    const allPresets = { ...presets.diffusion_models, ...presets.checkpoints } as Record<string, PresetEntry>
    let preset: PresetEntry | undefined = allPresets[key]
    if (!preset) {
      for (const [, v] of Object.entries(allPresets)) {
        if (v.aliases?.includes(key)) { preset = v; break }
      }
    }
    if (preset) {
      s.setSampler(preset.sampler); s.setScheduler(preset.scheduler)
      s.setSteps(preset.steps); s.setCfg(preset.cfg)
      s.setWidth(preset.default_width); s.setHeight(preset.default_height)
    }
  }, [])

  /** 이미지 업로드 */
  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { setErrorMessage('이미지 파일만 업로드할 수 있습니다.'); return }
    setUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = (e) => setEditSourcePreview(e.target?.result as string)
      reader.readAsDataURL(file)
      const response = await api.uploadImage(file)
      if (response.success && response.data) setEditSourceImage(response.data.filename)
      else { setErrorMessage(response.error || '이미지 업로드에 실패했습니다.'); setEditSourcePreview(null) }
    } catch { setErrorMessage('이미지 업로드 중 오류가 발생했습니다.'); setEditSourcePreview(null) }
    finally { setUploading(false) }
  }, [setErrorMessage, setEditSourceImage, setEditSourcePreview])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (file) handleFileUpload(file); e.target.value = ''
  }, [handleFileUpload])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) handleFileUpload(file)
  }, [handleFileUpload])

  /** 수정 모드 생성 */
  const handleEditGenerate = useCallback(async () => {
    if (!editSourceImage) { setErrorMessage('수정할 이미지를 먼저 업로드해주세요.'); return }
    if (!prompt.trim()) { setErrorMessage('수정할 내용을 설명해주세요.'); return }
    if (autoEnhance && !enhancePending) { await enhance(prompt.trim(), 'edit'); return }
    if (editBusyRef.current) return
    editBusyRef.current = true
    const finalPrompt = enhancePending ? (enhancedPrompt || prompt.trim()) : prompt.trim()
    const store = useAppStore.getState()
    store.setGenerationStatus('warming_up'); store.setProgress(0); store.setErrorMessage(null)
    store.setEnhancePending(false); store.setEnhanceFallback(false); store.setEnhancedCategories([])
    try {
      const response = await api.generateEdit({
        source_image: editSourceImage, edit_prompt: finalPrompt,
        steps: store.steps, cfg: store.cfg, seed: store.seed,
      })
      if (!response.success) { store.setGenerationStatus('error'); store.setErrorMessage(response.error || '이미지 수정 요청에 실패했습니다.'); return }
      const { task_id } = response.data; store.setCurrentTaskId(task_id)
      const wsUrl = api.wsUrl('/api/ws/generate')
      const ws = new WebSocket(wsUrl)
      ws.onopen = () => ws.send(JSON.stringify({ task_id }))
      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data); const s = useAppStore.getState()
          switch (msg.type) {
            case 'status': if (['warming_up', 'enhancing', 'generating'].includes(msg.status)) s.setGenerationStatus(msg.status); break
            case 'progress': s.setProgress(msg.progress); s.setGenerationStatus('generating'); break
            case 'executing': s.setGenerationStatus('generating'); break
            case 'completed': s.setGenerationStatus('completed'); s.setProgress(100); s.setGeneratedImages(msg.images); ws.close(); break
            case 'error': s.setGenerationStatus('error'); s.setErrorMessage(msg.message || msg.error || '이미지 수정 중 오류'); ws.close(); break
          }
        } catch { /* 무시 */ }
      }
      ws.onerror = () => ws.close()
    } catch { store.setGenerationStatus('error'); store.setErrorMessage('이미지 수정 중 예상치 못한 오류가 발생했습니다.') }
    finally { editBusyRef.current = false }
  }, [editSourceImage, prompt, autoEnhance, enhancePending, enhancedPrompt, enhance, setErrorMessage])

  /** 통합 생성 버튼 */
  const handleGenerateClick = useCallback(() => {
    if (isGenerating) cancel()
    else if (editMode) handleEditGenerate()
    else if (enhancePending) confirmEnhance()
    else generate()
  }, [isGenerating, editMode, handleEditGenerate, enhancePending, generate, confirmEnhance, cancel])

  /** 프리셋 적용 */
  const handlePresetSelect = useCallback((presetId: string) => {
    const preset = getAllPresets().find((p) => p.id === presetId)
    if (!preset) return
    const s = useAppStore.getState()
    s.setSampler(preset.params.sampler); s.setScheduler(preset.params.scheduler)
    s.setSteps(preset.params.steps); s.setCfg(preset.params.cfg)
    s.setWidth(preset.params.width); s.setHeight(preset.params.height)
    s.setActiveStyleHint(preset.styleHint)
    if (preset.enhanceCategories) s.setEnhanceSettings({ categories: preset.enhanceCategories })
  }, [])

  const [presetList, setPresetList] = useState(() => getAllPresets())
  const handleSavePreset = useCallback(() => {
    const name = window.prompt('프리셋 이름을 입력하세요:')
    if (!name?.trim()) return
    const store = useAppStore.getState()
    const custom = loadCustomPresets()
    const newPreset: Preset = {
      id: `custom-${Date.now()}`, name: name.trim(), icon: '🎨', builtin: false,
      styleHint: store.activeStyleHint,
      params: { sampler: store.sampler, scheduler: store.scheduler, steps: store.steps, cfg: store.cfg, width: store.width, height: store.height },
      enhanceCategories: { ...store.enhanceSettings.categories },
    }
    custom.push(newPreset); saveCustomPresets(custom); setPresetList(getAllPresets())
  }, [])

  const handleAddLora = useCallback(() => {
    const addedNames = new Set(loras.map((l) => l.name))
    const available = availableModels.loras.filter((n) => !addedNames.has(n))
    if (available.length > 0) addLora({ name: available[0], strengthModel: 0.7, strengthClip: 0.7 })
  }, [loras, availableModels.loras, addLora])

  const currentSizeLabel = SIZE_PRESETS.find((p) => p.w === width && p.h === height)?.label ?? 'custom'

  // ── 단축키 ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (enhancePending) { editMode ? handleEditGenerate() : confirmEnhance() }
        else if (editMode && !isGenerating && prompt.trim()) handleEditGenerate()
        else if (!isGenerating && prompt.trim()) generate()
      }
      if (e.key === 'Escape' && enhancePending) {
        const viewerOpen = useAppStore.getState().viewerIndex !== null
        if (!viewerOpen) cancelEnhance()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [generate, handleEditGenerate, confirmEnhance, cancelEnhance, isGenerating, enhancePending, editMode, prompt])

  // 패널 접힘 시 최소 표시
  if (panelCollapsed) {
    return (
      <aside className="w-10 shrink-0 border-l border-edge bg-ground/80 flex flex-col items-center pt-3">
        <button
          onClick={() => setPanelCollapsed(false)}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-sub hover:text-accent-bright hover:bg-accent-muted transition-all"
          title="패널 열기"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
      </aside>
    )
  }

  return (
    <aside className="w-[320px] shrink-0 border-l border-edge bg-ground/80 flex flex-col overflow-hidden">
      {/* 패널 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-edge shrink-0">
        {/* 모드 토글 */}
        <div className="flex items-center rounded-lg border border-edge overflow-hidden">
          <button
            onClick={() => setEditMode(false)}
            disabled={isGenerating}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-all disabled:opacity-40 ${
              !editMode ? 'bg-accent-muted text-accent-bright' : 'bg-ground text-text-sub hover:bg-elevated'
            }`}
          >
            <BoltIcon /> 생성
          </button>
          <button
            onClick={() => setEditMode(true)}
            disabled={isGenerating}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-all disabled:opacity-40 ${
              editMode ? 'bg-accent-muted text-accent-bright' : 'bg-ground text-text-sub hover:bg-elevated'
            }`}
          >
            <EditIcon /> 수정
          </button>
        </div>
        <button
          onClick={() => setPanelCollapsed(true)}
          className="w-6 h-6 rounded-md flex items-center justify-center text-text-sub hover:text-text hover:bg-white/[0.06] transition-all"
          title="패널 접기"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      {/* 스크롤 가능 영역 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* 수정 모드: 이미지 업로드 */}
        {editMode && (
          <div className="px-3 pt-3 pb-1">
            {editSourcePreview ? (
              <div className="flex items-center gap-3">
                <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-edge shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={editSourcePreview} alt="수정할 이미지" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-text-sub truncate">{editSourceImage || '업로드 중...'}</p>
                  <button onClick={() => { setEditSourceImage(null); setEditSourcePreview(null) }}
                    className="text-[10px] text-bad/70 hover:text-bad transition-colors mt-0.5">이미지 제거</button>
                </div>
              </div>
            ) : (
              <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-1.5 py-4 rounded-lg border-2 border-dashed border-edge hover:border-accent/50 cursor-pointer transition-all hover:bg-accent-muted/10">
                <UploadIcon />
                <span className="text-[11px] text-text-sub">{uploading ? '업로드 중...' : '이미지를 드래그하거나 클릭'}</span>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
          </div>
        )}

        {/* 프롬프트 입력 */}
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

        {/* AI 보강 토글 */}
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
        </div>

        {/* AI 보강 결과 */}
        {enhancePending && enhancedPrompt && (
          <div className={`mx-3 mb-2 rounded-lg border p-3 ${
            enhanceFallback ? 'border-bad/40 bg-bad/5' : 'border-accent/30 bg-accent-muted/30'
          }`}>
            <div className="flex items-center gap-1.5 mb-1.5">
              {enhanceFallback ? <WarningIcon /> : <SparkleIcon />}
              <span className={`text-[11px] font-medium ${enhanceFallback ? 'text-bad' : 'text-accent-bright'}`}>
                {enhanceFallback ? 'AI 보강 실패 — 기본 프롬프트' : editMode ? 'AI 수정 보강 결과' : 'AI 보강 결과'}
              </span>
              {enhancedCategories.length > 0 && (
                <button onClick={() => setShowCategoryDetail(!showCategoryDetail)}
                  className="text-[10px] text-accent-bright/70 hover:text-accent-bright transition-colors ml-1">
                  {showCategoryDetail ? '간략히' : '자세히'}
                </button>
              )}
            </div>
            {enhanceFallback && (
              <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-md bg-bad/10 border border-bad/20">
                <span className="text-[10px] text-bad/80 leading-snug">Ollama 연결 실패</span>
                <button onClick={() => enhance(prompt.trim(), editMode ? 'edit' : 'generate')} disabled={isEnhancing}
                  className="shrink-0 px-2.5 py-1 rounded-md text-[10px] font-medium text-bad border border-bad/30 hover:bg-bad/10 transition-all disabled:opacity-40">
                  {isEnhancing ? '...' : '재시도'}
                </button>
              </div>
            )}
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
              <textarea value={enhancedPrompt} onChange={(e) => setEnhancedPrompt(e.target.value)} rows={3}
                className="w-full bg-ground/50 rounded-md resize-none outline-none px-3 py-2 text-[12px] text-text leading-relaxed border border-edge focus:border-accent" />
            )}
            {enhancedNegative && <p className="mt-1.5 text-[10px] text-bad/60 truncate">네거티브: {enhancedNegative}</p>}
            <div className="flex items-center gap-2 mt-2">
              <button onClick={() => editMode ? handleEditGenerate() : confirmEnhance()}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-semibold btn-glow text-white">
                {editMode ? <><EditIcon /> 수정</> : <><BoltIcon /> 생성</>}
              </button>
              <button onClick={() => enhance(enhancedPrompt, editMode ? 'edit' : 'generate')} disabled={isEnhancing}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-accent-bright hover:bg-accent-muted transition-all border border-accent/30">
                {isEnhancing ? '...' : '다시 보강'}
              </button>
              <button onClick={() => cancelEnhance()}
                className="px-3 py-1.5 rounded-lg text-[11px] text-text-sub hover:text-text hover:bg-white/[0.04] transition-all">취소</button>
            </div>
          </div>
        )}

        {/* 네거티브 프롬프트 */}
        {showNegative && !enhancePending && (
          <div className="px-3 pb-2">
            <textarea value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="제외할 요소..." rows={2} disabled={isGenerating}
              className="w-full bg-surface rounded-lg resize-none outline-none px-3 py-2 text-[12px] placeholder-text-ghost leading-relaxed text-bad/70 border border-edge focus:border-bad/40 disabled:opacity-50" />
          </div>
        )}

        {/* 구분선 */}
        {!enhancePending && <div className="border-t border-edge mx-3" />}

        {/* 모델/프리셋/사이즈/배치 — 보강 대기 중이면 숨김 */}
        {!enhancePending && (
          <div className="px-3 py-3 space-y-3">
            {/* 프리셋 */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">프리셋</label>
              <div className="flex gap-1 flex-wrap">
                {presetList.map((p) => (
                  <button key={p.id} onClick={() => handlePresetSelect(p.id)}
                    className="px-2 py-1 rounded-md text-[10px] bg-surface border border-edge hover:border-accent/40 text-text-sub hover:text-text transition-all">
                    {p.icon} {p.name}
                  </button>
                ))}
                <button onClick={handleSavePreset}
                  className="px-2 py-1 rounded-md text-[10px] border border-dashed border-edge text-text-ghost hover:text-accent-bright hover:border-accent/30 transition-all">
                  💾 저장
                </button>
              </div>
            </div>

            {/* 모델 */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">모델</label>
              <select value={checkpoint} onChange={(e) => handleModelSelect(e.target.value)} disabled={isGenerating}
                className="w-full bg-surface text-[11px] font-mono text-text-sub rounded-lg px-2.5 py-1.5 border border-edge hover:border-edge-hover focus:border-accent outline-none cursor-pointer disabled:opacity-40 truncate">
                <option value="">Qwen Image (기본)</option>
                {availableModels.diffusionModels.length > 0 && (
                  <optgroup label="Diffusion Models">
                    {availableModels.diffusionModels.map((dm) => <option key={dm} value={dm}>{dm}</option>)}
                  </optgroup>
                )}
                {availableModels.checkpoints.length > 0 && (
                  <optgroup label="Checkpoints">
                    {availableModels.checkpoints.map((cp) => <option key={cp} value={cp}>{cp}</option>)}
                  </optgroup>
                )}
              </select>
            </div>

            {/* 사이즈 + 배치 (가로 배치) */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">사이즈</label>
                {showCustomSize ? (
                  <div className="flex items-center gap-1">
                    <input type="number" value={width} step={8}
                      onChange={(e) => { const v = parseInt(e.target.value) || 256; setWidth(Math.round(Math.max(256, Math.min(2048, v)) / 8) * 8) }}
                      className="w-[56px] bg-surface text-[11px] font-mono text-text-sub rounded-lg px-1.5 py-1.5 border border-edge focus:border-accent outline-none text-center" />
                    <span className="text-[10px] text-text-ghost">×</span>
                    <input type="number" value={height} step={8}
                      onChange={(e) => { const v = parseInt(e.target.value) || 256; setHeight(Math.round(Math.max(256, Math.min(2048, v)) / 8) * 8) }}
                      className="w-[56px] bg-surface text-[11px] font-mono text-text-sub rounded-lg px-1.5 py-1.5 border border-edge focus:border-accent outline-none text-center" />
                    <button onClick={() => setShowCustomSize(false)}
                      className="text-[10px] text-text-ghost hover:text-accent-bright transition-colors">비율</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <select value={currentSizeLabel}
                      onChange={(e) => { const p = SIZE_PRESETS.find((s) => s.label === e.target.value); if (p) { setWidth(p.w); setHeight(p.h) } }}
                      className="bg-surface text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge focus:border-accent outline-none cursor-pointer flex-1">
                      {SIZE_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
                    </select>
                    <button onClick={() => setShowCustomSize(true)}
                      className="text-[10px] text-text-ghost hover:text-accent-bright transition-colors px-1">px</button>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">배치</label>
                <div className="flex items-center rounded-lg border border-edge overflow-hidden">
                  {BATCH_OPTIONS.map((n) => (
                    <button key={n} onClick={() => setBatchSize(n)} disabled={isGenerating}
                      className={`px-2 py-1.5 text-[11px] font-mono transition-all disabled:opacity-40 ${
                        batchSize === n ? 'bg-accent-muted text-accent-bright' : 'bg-surface text-text-sub hover:bg-elevated'
                      }`}>{n}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* 고급 설정 토글 */}
            <button onClick={() => setShowAdvanced(!showAdvanced)}
              className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] transition-all border ${
                showAdvanced ? 'bg-accent-muted/30 border-accent/30 text-accent-bright' : 'border-edge text-text-sub hover:text-text hover:bg-white/[0.04]'
              }`}>
              {showAdvanced ? '▾ 고급 설정 접기' : '▸ 고급 설정'}
            </button>

            {/* 고급 설정 패널 */}
            {showAdvanced && (
              <div className="space-y-3 pt-1">
                {/* VAE */}
                <div>
                  <label className="block text-[10px] text-text-sub mb-1">VAE</label>
                  <select value={vae} onChange={(e) => setVae(e.target.value)}
                    className="w-full bg-surface text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge focus:border-accent outline-none cursor-pointer">
                    <option value="">기본값 (모델 내장)</option>
                    {availableModels.vaes.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>

                {/* LoRA */}
                <div>
                  <label className="block text-[10px] text-text-sub mb-1">LoRA</label>
                  {loras.map((lora) => (
                    <div key={lora.name} className="flex items-center gap-2 p-2 rounded-lg bg-surface ring-1 ring-edge mb-1.5 group">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-mono text-text truncate">{lora.name}</p>
                        <input type="range" min={0} max={1} step={0.05} value={lora.strengthModel}
                          onChange={(e) => updateLoraStrength(lora.name, parseFloat(e.target.value), parseFloat(e.target.value))}
                          className="w-full mt-1" />
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[10px] font-mono text-accent-bright">{lora.strengthModel.toFixed(2)}</span>
                        <button onClick={() => removeLora(lora.name)}
                          className="text-text-ghost hover:text-bad transition-colors opacity-0 group-hover:opacity-100"><XIcon /></button>
                      </div>
                    </div>
                  ))}
                  <button onClick={handleAddLora} disabled={availableModels.loras.length === 0}
                    className="flex items-center gap-1.5 text-[11px] text-accent-bright hover:text-accent transition-colors w-full justify-center py-1.5 rounded-lg border border-dashed border-edge hover:border-accent/30 disabled:opacity-30">
                    <PlusIcon /> LoRA 추가
                  </button>
                </div>

                {/* Steps */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-text-sub">Steps</span>
                    <span className="text-[10px] font-mono text-accent-bright">{steps}</span>
                  </div>
                  <input type="range" min={1} max={100} value={steps} onChange={(e) => setSteps(parseInt(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none bg-elevated accent-accent" />
                </div>

                {/* CFG */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-text-sub">CFG</span>
                    <span className="text-[10px] font-mono text-accent-bright">{cfg.toFixed(1)}</span>
                  </div>
                  <input type="range" min={1} max={20} step={0.5} value={cfg} onChange={(e) => setCfg(parseFloat(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none bg-elevated accent-accent" />
                </div>

                {/* Seed */}
                <div>
                  <label className="block text-[10px] text-text-sub mb-1">시드</label>
                  <div className="flex gap-1.5">
                    <input type="text" value={seed}
                      onChange={(e) => { const val = parseInt(e.target.value, 10); setSeed(isNaN(val) ? -1 : val) }}
                      className="flex-1 bg-surface font-mono text-[11px] text-text-sub rounded-lg px-2 py-1.5 border border-edge focus:border-accent outline-none" />
                    <button onClick={() => setSeed(-1)}
                      className="px-2 rounded-lg bg-surface border border-edge hover:border-edge-hover text-text-sub hover:text-text transition-all">
                      <RefreshIcon />
                    </button>
                  </div>
                </div>

                {/* 샘플러 / 스케줄러 */}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] text-text-sub mb-1">샘플러</label>
                    <select value={sampler} onChange={(e) => setSampler(e.target.value)}
                      className="w-full bg-surface text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge focus:border-accent outline-none cursor-pointer">
                      <option value="dpmpp_2m">dpmpp_2m</option>
                      <option value="euler">euler</option>
                      <option value="euler_ancestral">euler_ancestral</option>
                      <option value="ddim">ddim</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] text-text-sub mb-1">스케줄러</label>
                    <select value={scheduler} onChange={(e) => setScheduler(e.target.value)}
                      className="w-full bg-surface text-[11px] font-mono text-text-sub rounded-lg px-2 py-1.5 border border-edge focus:border-accent outline-none cursor-pointer">
                      <option value="simple">simple</option>
                      <option value="normal">normal</option>
                      <option value="karras">karras</option>
                      <option value="exponential">exponential</option>
                      <option value="sgm_uniform">sgm_uniform</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 생성 버튼 (하단 고정) */}
      <div className="shrink-0 px-3 py-2.5 border-t border-edge">
        <button onClick={handleGenerateClick} disabled={!isGenerating && !prompt.trim()}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${
            isGenerating
              ? 'bg-bad/20 text-bad hover:bg-bad/30 border border-bad/30'
              : 'btn-glow text-white disabled:opacity-30 disabled:cursor-not-allowed'
          }`}>
          {isGenerating ? (<><StopIcon /> 취소</>) : editMode ? (<><EditIcon /> 수정</>) : (<><BoltIcon /> 생성</>)}
        </button>
        <span className="block text-center text-[10px] text-text-ghost mt-1">Ctrl+Enter</span>
      </div>
    </aside>
  )
}
