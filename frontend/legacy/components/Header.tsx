/**
 * 헤더 컴포넌트
 * 로고, 프로세스 상태 표시, 네비게이션 버튼
 */

'use client'

import { useProcessStatus } from '@/hooks/useProcessStatus'
import { useAppStore } from '@/stores/useAppStore'
import { ClockIcon, GearIcon, LogoSparkIcon } from './icons'

/** 상태 표시 알약 */
function StatusPill({
  label,
  running,
}: {
  label: string
  running: boolean
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
        running
          ? 'bg-ok/10 text-ok'
          : 'bg-white/[0.03] text-text-dim'
      }`}
    >
      <div
        className={`w-1.5 h-1.5 rounded-full ${
          running ? 'bg-ok pulse-live' : 'bg-text-ghost'
        }`}
      />
      {label}
    </div>
  )
}

/** VRAM 사용량 프로그레스 바 */
function VramBar({
  usedGb,
  totalGb,
}: {
  usedGb: number
  totalGb: number
}) {
  const pct = totalGb > 0 ? (usedGb / totalGb) * 100 : 0
  // 85% 이상 빨간색, 60-85% 노란색, 60% 이하 초록색
  const barColor =
    pct >= 85
      ? 'bg-red-500'
      : pct >= 60
        ? 'bg-yellow-500'
        : 'bg-ok'
  const textColor =
    pct >= 85
      ? 'text-red-400'
      : pct >= 60
        ? 'text-yellow-400'
        : 'text-text-dim'

  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-[10px] font-mono ${textColor}`}>
        VRAM {usedGb.toFixed(1)}/{totalGb.toFixed(0)}G
      </span>
      <div className="w-14 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  )
}

/** 네비게이션 버튼 */
function NavButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-text-sub hover:text-text hover:bg-white/[0.04] transition-all text-xs"
      title={label}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

export default function Header() {
  // 실시간 프로세스 상태 (10초 간격 폴링)
  const processStatus = useProcessStatus()
  const toggleHistoryPanel = useAppStore((s) => s.toggleHistoryPanel)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)

  /** 새 생성 — 전체 상태 초기화 */
  const handleNewGeneration = () => {
    const s = useAppStore.getState()
    s.setPrompt('')
    s.setNegativePrompt('')
    s.setEnhancedPrompt('')
    s.setEnhancedNegative('')
    s.setEnhancePending(false)
    s.setGeneratedImages([])
    s.setGenerationStatus('idle')
    s.setSelectedImageIndex(null)
    s.setProgress(0)
    s.setErrorMessage(null)
    s.setSeed(-1)
  }

  return (
    <header className="flex items-center justify-between px-5 h-12 border-b border-edge shrink-0">
      {/* 로고 */}
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center shadow-[0_0_12px_rgba(124,58,237,0.3)]">
          <LogoSparkIcon />
        </div>
        <h1 className="text-[15px] font-semibold tracking-tight font-[family-name:var(--font-sora)]">
          AI Image Studio
        </h1>
      </div>

      {/* 상태 + 네비게이션 */}
      <div className="flex items-center gap-2.5">
        <StatusPill
          label="Ollama"
          running={processStatus.ollama.running}
        />
        <StatusPill
          label="ComfyUI"
          running={processStatus.comfyui.running}
        />
        {/* ComfyUI 실행 중일 때만 VRAM 사용량 표시 */}
        {processStatus.comfyui.running && (
          <VramBar
            usedGb={processStatus.comfyui.vramUsedGb}
            totalGb={processStatus.comfyui.vramTotalGb}
          />
        )}
        <div className="w-px h-4 bg-edge mx-1" />
        {/* 새 생성 (초기화) */}
        <NavButton
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          }
          label="새 생성"
          onClick={handleNewGeneration}
        />
        <NavButton icon={<ClockIcon />} label="히스토리" onClick={toggleHistoryPanel} />
        <NavButton icon={<GearIcon />} label="설정" onClick={() => setSettingsOpen(true)} />
      </div>
    </header>
  )
}
