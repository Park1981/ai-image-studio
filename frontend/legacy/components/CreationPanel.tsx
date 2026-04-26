/**
 * 오른쪽 생성 패널 — 레이아웃 컨테이너
 * 하위 컴포넌트들을 수직 배치하고 패널 접기/펼치기 관리
 */

'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { api } from '@/lib/api'
import { BoltIcon, EditIcon } from './icons'
import {
  PromptInput,
  EnhanceResult,
  ModelSelector,
  SizeSelector,
  EditModePanel,
  GenerateButton,
  AdvancedSettings,
} from './creation'

export default function CreationPanel() {
  // ── 패널 접기 상태 ──
  const [panelCollapsed, setPanelCollapsed] = useState(false)

  // ── 스토어 상태 (패널 헤더용) ──
  const editMode = useAppStore((s) => s.editMode)
  const setEditMode = useAppStore((s) => s.setEditMode)
  const enhancePending = useAppStore((s) => s.enhancePending)
  const generationStatus = useAppStore((s) => s.generationStatus)
  const modelPresets = useAppStore((s) => s.modelPresets)

  const isGenerating =
    generationStatus === 'generating' ||
    generationStatus === 'warming_up' ||
    generationStatus === 'enhancing'

  // 모델 프리셋 초기 fetch
  useEffect(() => {
    if (!modelPresets) {
      api.getModelPresets().then((res) => {
        if (res.success && res.data) useAppStore.getState().setModelPresets(res.data)
      })
    }
  }, [modelPresets])

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
      {/* 패널 헤더: 모드 토글 + 접기 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-edge shrink-0">
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
        <EditModePanel />

        {/* 프롬프트 입력 + AI 보강 토글 + 네거티브 */}
        <PromptInput />

        {/* AI 보강 결과 */}
        <EnhanceResult />

        {/* 구분선 */}
        {!enhancePending && <div className="border-t border-edge mx-3" />}

        {/* 모델/프리셋/사이즈/배치/고급 — 보강 대기 중이면 숨김 */}
        {!enhancePending && (
          <div className="px-3 py-3 space-y-3">
            <ModelSelector />
            <SizeSelector />
            <AdvancedSettings />
          </div>
        )}
      </div>

      {/* 생성 버튼 (하단 고정) */}
      <GenerateButton />
    </aside>
  )
}
