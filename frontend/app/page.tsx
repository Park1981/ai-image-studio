/**
 * AI Image Studio - 메인 생성 페이지
 * 이미지가 주인공, 나머지는 도구
 * 사이드바는 고급 설정 토글 시에만 표시
 */

'use client'

import Header from '@/components/Header'
import ImageGrid from '@/components/ImageGrid'
import PromptDock from '@/components/PromptDock'
import SettingsSidebar from '@/components/SettingsSidebar'
import HistoryBar from '@/components/HistoryBar'
import HistoryPanel from '@/components/HistoryPanel'
import ErrorToast from '@/components/ErrorToast'
import { useAppStore } from '@/stores/useAppStore'

export default function Home() {
  // 사이드바 열림/닫힘 상태
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-void">
      {/* 에러 토스트 (화면 상단 고정) */}
      <ErrorToast />

      {/* 헤더 */}
      <Header />

      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        {/* 메인 영역: 이미지 그리드 + 프롬프트 입력 */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <ImageGrid />
          <PromptDock />
        </main>

        {/* 고급 설정 사이드바 (토글 시에만 표시) */}
        {sidebarOpen && <SettingsSidebar />}
      </div>

      {/* 히스토리 바 (하단) */}
      <HistoryBar />

      {/* 히스토리 전체 패널 (오버레이) */}
      <HistoryPanel />
    </div>
  )
}
