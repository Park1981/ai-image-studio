/**
 * AI Image Studio - 메인 생성 페이지
 * 이미지 그리드(왼쪽) + 설정 패널(오른쪽) 레이아웃
 * 히스토리 바는 하단 유지
 */

'use client'

import Header from '@/components/Header'
import ImageGrid from '@/components/ImageGrid'
import CreationPanel from '@/components/CreationPanel'
import HistoryBar from '@/components/HistoryBar'
import HistoryPanel from '@/components/HistoryPanel'
import SettingsPanel from '@/components/SettingsPanel'
import ErrorToast from '@/components/ErrorToast'

export default function Home() {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-void">
      {/* 에러 토스트 (화면 상단 고정) */}
      <ErrorToast />

      {/* 헤더 */}
      <Header />

      {/* 메인 영역: 이미지 그리드(왼쪽) + 생성 패널(오른쪽) */}
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        {/* 이미지 그리드 — 왼쪽, 넓게 */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <ImageGrid />
          {/* 히스토리 바 (하단 썸네일) */}
          <HistoryBar />
        </main>

        {/* 오른쪽 생성 패널 */}
        <CreationPanel />
      </div>

      {/* 히스토리 전체 패널 (오버레이) */}
      <HistoryPanel />

      {/* 설정 패널 (모달) */}
      <SettingsPanel />
    </div>
  )
}
