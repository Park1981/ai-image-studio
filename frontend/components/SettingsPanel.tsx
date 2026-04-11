/**
 * 설정 패널 (모달 오버레이)
 * 헤더 "설정" 버튼 클릭 시 표시
 * ComfyUI/Ollama 상태 + 앱 설정
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api, type OllamaModelInfo } from '@/lib/api'

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

  const [comfyLoading, setComfyLoading] = useState(false)
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)

  /** Ollama 모델 목록 불러오기 */
  const fetchOllamaModels = useCallback(async () => {
    setModelsLoading(true)
    const res = await api.getOllamaModels()
    if (res.success && res.data) {
      setOllamaModels(res.data)
    }
    setModelsLoading(false)
  }, [])

  // 설정 패널 열릴 때 모델 목록 조회
  useEffect(() => {
    if (settingsOpen) {
      fetchOllamaModels()
    }
  }, [settingsOpen, fetchOllamaModels])

  /** ComfyUI 시작/종료 후 즉시 상태 갱신 */
  const handleToggleComfyUI = async () => {
    setComfyLoading(true)
    if (processStatus.comfyui.running) {
      await api.stopComfyUI()
    } else {
      await api.startComfyUI()
    }
    // 즉시 상태 갱신 (10초 폴링 대기 안 함)
    const status = await api.getProcessStatus()
    if (status.success && status.data) {
      useAppStore.getState().setProcessStatus({
        ollama: { running: status.data.ollama.running, modelLoaded: null },
        comfyui: { running: status.data.comfyui.running, vramUsedGb: 0, vramTotalGb: 16 },
      })
    }
    setComfyLoading(false)
  }

  if (!settingsOpen) return null

  return (
    <>
      {/* 배경 */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={() => setSettingsOpen(false)}
      />

      {/* 패널 */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] max-h-[80vh] bg-ground border border-edge rounded-xl shadow-2xl flex flex-col overflow-hidden">
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
                <span className={`text-[11px] ${processStatus.ollama.running ? 'text-ok' : 'text-text-ghost'}`}>
                  {processStatus.ollama.running ? '실행 중' : '미실행'}
                </span>
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
                  <option value="">gemma4:26b (기본)</option>
                  {ollamaModels
                    .filter((m) => m.name !== 'gemma4:26b')
                    .map((m) => (
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
