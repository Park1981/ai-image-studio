/**
 * 헤더 컴포넌트
 * 로고, 프로세스 상태 표시, 네비게이션 버튼
 */

'use client'

import { useProcessStatus } from '@/hooks/useProcessStatus'
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

/** 네비게이션 버튼 */
function NavButton({
  icon,
  label,
}: {
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
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
        <div className="w-px h-4 bg-edge mx-1" />
        <NavButton icon={<ClockIcon />} label="히스토리" />
        <NavButton icon={<GearIcon />} label="설정" />
      </div>
    </header>
  )
}
