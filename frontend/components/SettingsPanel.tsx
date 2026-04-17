/**
 * 설정 패널 (모달 오버레이)
 * 헤더 "설정" 버튼 클릭 시 표시
 * ComfyUI/Ollama 상태 + 앱 설정
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api, type OllamaModelInfo, type EnhanceCategoryConfig } from '@/lib/api'
import { loadCustomPresets, deleteCustomPreset, type Preset } from '@/lib/presets'

export default function SettingsPanel() {
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const processStatus = useAppStore((s) => s.processStatus)
  const autoEnhance = useAppStore((s) => s.autoEnhance)
  const setAutoEnhance = useAppStore((s) => s.setAutoEnhance)
  const batchSize = useAppStore((s) => s.batchSize)
  const setBatchSize = useAppStore((s) => s.setBatchSize)
  const ollamaModel = useAppStore((s) => s.ollamaModel)
  const setOllamaModel = useAppStore((s) => s.setOllamaModel)
  const enhanceSettings = useAppStore((s) => s.enhanceSettings)
  const setEnhanceSettings = useAppStore((s) => s.setEnhanceSettings)
  const setEnhanceCategory = useAppStore((s) => s.setEnhanceCategory)

  const [comfyLoading, setComfyLoading] = useState(false)
  const [ollamaLoading, setOllamaLoading] = useState(false)
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [customPresets, setCustomPresets] = useState<Preset[]>([])

  /** Ollama 모델 목록 불러오기 */
  const fetchOllamaModels = useCallback(async () => {
    setModelsLoading(true)
    const res = await api.getOllamaModels()
    if (res.success && res.data) {
      setOllamaModels(res.data)
    }
    setModelsLoading(false)
  }, [])

  // 설정 패널 열릴 때 모델 목록 + 커스텀 프리셋 로드
  useEffect(() => {
    if (settingsOpen) {
      fetchOllamaModels()
      setCustomPresets(loadCustomPresets())
    }
  }, [settingsOpen, fetchOllamaModels])

  /** 상태 즉시 갱신 (10초 폴링 대기 안 함) */
  const refreshProcessStatus = useCallback(async () => {
    const status = await api.getProcessStatus()
    if (status.success && status.data) {
      useAppStore.getState().setProcessStatus({
        ollama: { running: status.data.ollama.running, modelLoaded: null },
        comfyui: { running: status.data.comfyui.running, vramUsedGb: 0, vramTotalGb: 16 },
      })
    }
  }, [])

  /** ComfyUI 시작/종료 후 즉시 상태 갱신 */
  const handleToggleComfyUI = async () => {
    setComfyLoading(true)
    if (processStatus.comfyui.running) {
      await api.stopComfyUI()
    } else {
      await api.startComfyUI()
    }
    await refreshProcessStatus()
    setComfyLoading(false)
  }

  /** Ollama 시작/종료 후 즉시 상태 갱신 + 모델 목록 리로드 */
  const handleToggleOllama = async () => {
    setOllamaLoading(true)
    const res = processStatus.ollama.running
      ? await api.stopOllama()
      : await api.startOllama()
    if (!res.success && res.error) {
      // 사용자에게 실패 이유 알림 (간단히 alert)
      alert(res.error)
    }
    await refreshProcessStatus()
    // 새로 실행됐다면 모델 목록 리로드
    if (!processStatus.ollama.running) {
      await fetchOllamaModels()
    }
    setOllamaLoading(false)
  }

  if (!settingsOpen) return null

  return (
    <>
      {/* 배경 */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={() => setSettingsOpen(false)}
        aria-hidden="true"
      />

      {/* 패널 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="설정"
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] max-h-[80vh] bg-ground border border-edge rounded-xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <h2 className="text-[14px] font-semibold text-text">설정</h2>
          <button
            onClick={() => setSettingsOpen(false)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-text-sub hover:text-text hover:bg-white/[0.06] transition-all"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 내용 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* 프로세스 상태 */}
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-dim mb-3">프로세스 상태</h3>

            <div className="space-y-2">
              {/* Ollama */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-surface border border-edge">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${processStatus.ollama.running ? 'bg-ok pulse-live' : 'bg-text-ghost'}`} />
                  <span className="text-[12px] text-text">Ollama</span>
                </div>
                <button
                  onClick={handleToggleOllama}
                  disabled={ollamaLoading}
                  className={`text-[11px] px-3 py-1 rounded-md transition-all ${
                    processStatus.ollama.running
                      ? 'text-bad hover:bg-bad/10'
                      : 'text-ok hover:bg-ok/10'
                  } disabled:opacity-40`}
                >
                  {ollamaLoading ? '...' : processStatus.ollama.running ? '종료' : '시작'}
                </button>
              </div>

              {/* ComfyUI */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-surface border border-edge">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${processStatus.comfyui.running ? 'bg-ok pulse-live' : 'bg-text-ghost'}`} />
                  <span className="text-[12px] text-text">ComfyUI</span>
                </div>
                <button
                  onClick={handleToggleComfyUI}
                  disabled={comfyLoading}
                  className={`text-[11px] px-3 py-1 rounded-md transition-all ${
                    processStatus.comfyui.running
                      ? 'text-bad hover:bg-bad/10'
                      : 'text-ok hover:bg-ok/10'
                  } disabled:opacity-40`}
                >
                  {comfyLoading ? '...' : processStatus.comfyui.running ? '종료' : '시작'}
                </button>
              </div>
            </div>
          </section>

          {/* 생성 기본 설정 */}
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-dim mb-3">기본 설정</h3>

            <div className="space-y-3">
              {/* AI 자동 보강 */}
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-text-sub">AI 자동 보강</span>
                <button
                  onClick={() => setAutoEnhance(!autoEnhance)}
                  className={`w-10 h-5 rounded-full transition-all relative ${
                    autoEnhance ? 'bg-accent' : 'bg-elevated'
                  }`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                    autoEnhance ? 'left-5' : 'left-0.5'
                  }`} />
                </button>
              </div>

              {/* AI 보강 모델 (Ollama) */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] text-text-sub">AI 보강 모델</span>
                  <button
                    onClick={fetchOllamaModels}
                    disabled={modelsLoading}
                    className="text-[10px] text-text-ghost hover:text-text-sub transition-all disabled:opacity-40"
                    title="모델 목록 새로고침"
                  >
                    {modelsLoading ? '...' : '↻'}
                  </button>
                </div>
                <select
                  value={ollamaModel}
                  onChange={(e) => setOllamaModel(e.target.value)}
                  className="bg-surface text-[11px] font-mono text-text-sub rounded-md px-2 py-1.5 border border-edge hover:border-edge-hover focus:border-accent outline-none transition-all cursor-pointer max-w-[200px] truncate"
                >
                  <option value="">기본 모델</option>
                  {ollamaModels.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name} ({m.size_gb}GB)
                    </option>
                  ))}
                </select>
              </div>

              {/* 기본 배치 수 */}
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-text-sub">기본 배치 수</span>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => setBatchSize(n)}
                      className={`w-7 h-7 rounded-md text-[11px] font-mono transition-all ${
                        batchSize === n
                          ? 'bg-accent-muted text-accent-bright'
                          : 'bg-surface text-text-sub hover:bg-elevated'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* AI 보강 세부 설정 */}
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-dim mb-3">AI 보강 세부 설정</h3>

            <div className="space-y-3">
              {/* 창의성 슬라이더 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[12px] text-text-sub">창의성</span>
                  <span className="text-[11px] font-mono text-text-ghost">
                    {enhanceSettings.creativity.toFixed(1)}
                    <span className="text-[9px] ml-1">
                      {enhanceSettings.creativity <= 0.3 ? '보수적' : enhanceSettings.creativity >= 0.8 ? '창의적' : '보통'}
                    </span>
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.1"
                  value={enhanceSettings.creativity}
                  onChange={(e) => setEnhanceSettings({ creativity: parseFloat(e.target.value) })}
                  className="w-full h-1.5 rounded-full appearance-none bg-elevated accent-accent cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-text-ghost mt-0.5">
                  <span>보수적</span>
                  <span>창의적</span>
                </div>
              </div>

              {/* 디테일 레벨 */}
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-text-sub">디테일 수준</span>
                <div className="flex items-center gap-1">
                  {(['minimal', 'normal', 'detailed'] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => setEnhanceSettings({ detailLevel: level })}
                      className={`px-2.5 py-1 rounded-md text-[11px] transition-all ${
                        enhanceSettings.detailLevel === level
                          ? 'bg-accent-muted text-accent-bright'
                          : 'bg-surface text-text-sub hover:bg-elevated'
                      }`}
                    >
                      {level === 'minimal' ? '간략' : level === 'normal' ? '보통' : '상세'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 카테고리 ON/OFF 토글 */}
              <div>
                <span className="text-[12px] text-text-sub block mb-2">보강 카테고리</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    { key: 'subject' as keyof EnhanceCategoryConfig, icon: '🧑', label: '피사체/인물' },
                    { key: 'background' as keyof EnhanceCategoryConfig, icon: '🏞️', label: '배경/환경' },
                    { key: 'lighting' as keyof EnhanceCategoryConfig, icon: '💡', label: '조명' },
                    { key: 'style' as keyof EnhanceCategoryConfig, icon: '📷', label: '스타일' },
                    { key: 'mood' as keyof EnhanceCategoryConfig, icon: '🎨', label: '분위기' },
                    { key: 'technical' as keyof EnhanceCategoryConfig, icon: '⚙️', label: '기술적' },
                  ]).map(({ key, icon, label }) => (
                    <button
                      key={key}
                      onClick={() => setEnhanceCategory(key, !enhanceSettings.categories[key])}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] transition-all border ${
                        enhanceSettings.categories[key]
                          ? 'bg-accent-muted/50 border-accent/30 text-accent-bright'
                          : 'bg-surface border-edge text-text-ghost hover:text-text-sub'
                      }`}
                    >
                      <span className="text-[12px]">{icon}</span>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* 커스텀 프리셋 관리 */}
          {customPresets.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-dim mb-3">커스텀 프리셋</h3>
              <div className="space-y-1.5">
                {customPresets.map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-2 rounded-lg bg-surface border border-edge">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[12px]">{p.icon}</span>
                      <span className="text-[12px] text-text truncate">{p.name}</span>
                    </div>
                    <button
                      onClick={() => {
                        setCustomPresets(deleteCustomPreset(p.id))
                      }}
                      className="text-[10px] text-bad/60 hover:text-bad transition-colors shrink-0 px-1.5"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 단축키 안내 */}
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-dim mb-3">단축키</h3>
            <div className="space-y-1.5 text-[11px]">
              {[
                ['Ctrl+Enter', '생성 / 보강 확인'],
                ['ESC', '취소 / 뷰어 닫기'],
                ['더블클릭', '이미지 크게 보기'],
                ['←  →', '뷰어 이미지 전환'],
                ['+  −  0', '줌 인 / 줌 아웃 / 리셋'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <kbd className="px-2 py-0.5 rounded bg-surface border border-edge font-mono text-text-sub">{key}</kbd>
                  <span className="text-text-ghost">{desc}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 버전 정보 */}
          <div className="pt-3 border-t border-edge text-center">
            <p className="text-[10px] text-text-ghost">
              AI Image Studio v0.1.0 · Qwen Image 2512 · RTX 4070 Ti SUPER
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
