/**
 * UI 상태 슬라이스
 * 이미지 선택, 뷰어, 사이드바, 히스토리, 설정 패널, 수정 모드 관리
 */

import type { StateCreator } from 'zustand'

export interface UiSlice {
  // ── UI 선택 상태 ──
  selectedImageIndex: number | null
  setSelectedImageIndex: (index: number | null) => void

  // ── 풀스크린 뷰어 ──
  viewerIndex: number | null
  setViewerIndex: (index: number | null) => void

  // ── 사이드바 토글 상태 ──
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void

  // ── 히스토리 패널 ──
  historyPanelOpen: boolean
  setHistoryPanelOpen: (open: boolean) => void
  toggleHistoryPanel: () => void

  // ── 설정 패널 ──
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void

  // ── 이미지 수정 모드 ──
  editMode: boolean
  setEditMode: (mode: boolean) => void
  editSourceImage: string | null  // 업로드된 소스 이미지 파일명
  setEditSourceImage: (filename: string | null) => void
  editSourcePreview: string | null  // 프리뷰용 Data URL
  setEditSourcePreview: (preview: string | null) => void
}

// ── 슬라이스 생성 ──

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set) => ({
  // ── UI 선택 상태 ──
  selectedImageIndex: null,
  setSelectedImageIndex: (index) => set({ selectedImageIndex: index }),

  // ── 풀스크린 뷰어 ──
  viewerIndex: null,
  setViewerIndex: (index) => set({ viewerIndex: index }),

  // ── 사이드바 토글 상태 ──
  sidebarOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  // ── 히스토리 패널 ──
  historyPanelOpen: false,
  setHistoryPanelOpen: (open) => set({ historyPanelOpen: open }),
  toggleHistoryPanel: () => set((state) => ({ historyPanelOpen: !state.historyPanelOpen })),

  // ── 설정 패널 ──
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  // ── 이미지 수정 모드 ──
  editMode: false,
  setEditMode: (mode) => set({ editMode: mode }),
  editSourceImage: null,
  setEditSourceImage: (filename) => set({ editSourceImage: filename }),
  editSourcePreview: null,
  setEditSourcePreview: (preview) => set({ editSourcePreview: preview }),
})
