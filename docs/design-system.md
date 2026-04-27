# Design System — AI Image Studio

> 디자인 토큰 + 공용 컴포넌트 인벤토리.
> 2026-04-27 (C2-P2-6) 초안. 신규 컴포넌트 추가 시 본 문서도 갱신.

---

## 1. 디자인 토큰 (`frontend/app/globals.css`)

### 1.1 배경 + 잉크 (warm neutral)

| 토큰 | 값 | 용도 |
|------|-----|------|
| `--bg` | `#FAF9F7` | 페이지 배경 (warm off-white) |
| `--bg-2` | `#F4F2EE` | secondary 배경 (히스토리 셀 배경, disabled 등) |
| `--surface` | `#FFFFFF` | 카드 / 입력 박스 surface (`box-shadow: var(--shadow-sm)` 동반) |
| `--ink` | `#1F1F1F` | 본문 텍스트 (primary) |
| `--ink-2` | `#46464A` | 라벨 / 헤더 텍스트 (secondary) |
| `--ink-3` | `#7A7A80` | 보조 텍스트 (placeholder, hint) |
| `--ink-4` | `#AEAEB3` | 비활성 텍스트 / divider 인접 메타 |
| `--line` | `#E8E5DF` | 1px 라인 / border |
| `--line-2` | `#DCD8D0` | 진한 line (구분 강조) |

### 1.2 액센트 (cool blue)

| 토큰 | 값 | 용도 |
|------|-----|------|
| `--accent` | `#4A9EFF` | 메인 강조 (CTA 버튼, focus outline, link) |
| `--accent-ink` | `#1E7BE0` | accent 위 텍스트 (hover 상태) |
| `--accent-soft` | `#EAF3FF` | accent 배경 (선택 상태, info 박스) |
| `--accent-disabled` | `#C8D6E8` | CTA 비활성 배경 (5 페이지 통일) |

### 1.3 상태 색상

| 토큰 | 값 | 의미 |
|------|-----|------|
| `--green` | `#52C41A` | 성공 / 완료 (5축 점수 80+, timeline done bullet) |
| `--green-ink` | `#3E9912` | green 위 텍스트 |
| `--green-soft` | `#EEF9E4` | green 배경 (성공 안내 박스) |
| `--amber` | `#FAAD14` | 경고 / 주의 (5축 점수 60-79, fallback 상태) |
| `--amber-ink` | `#B47600` | amber 위 텍스트 |
| `--amber-soft` | `#FFF7E0` | amber 배경 (warn 안내 박스, fallback) |

### 1.4 어두운 영역 (Lightbox / Overlay)

| 토큰 | 값 | 용도 |
|------|-----|------|
| `--bg-dark` | `#0A0A0C` | 검은 배경 (lightbox · 이미지 포커스) |
| `--overlay-dark` | `rgba(10, 10, 12, 0.48)` | 모달 dim overlay |

### 1.5 그림자 (3단계)

| 토큰 | 용도 |
|------|------|
| `--shadow-sm` | 카드 / 인풋 기본 (정적) |
| `--shadow-md` | 호버 카드 / 떠오른 패널 |
| `--shadow-lg` | 모달 / Lightbox / floating dialog |

### 1.6 둥근 모서리 (6단계)

| 토큰 | 값 | 사용 예 |
|------|-----|---------|
| `--radius-sm` | `8px` | 작은 버튼 / chip / 라벨 |
| `--radius` | `12px` | 인풋 박스 / textarea / 작은 카드 |
| `--radius-card` | `14px` | 메인 카드 (VisionResultCard, SummaryCard, PromptToggleCard) |
| `--radius-lg` | `16px` | 큰 패널 (CompareViewer, AnalysisPanel) |
| `--radius-xl` | `20px` | 모달 sheet |
| `--radius-full` | `999px` | pill / 칩 / 동그라미 (CTA 버튼, badge) |

### 1.7 모션 (CSS easing)

| 토큰 | 값 | 사용 |
|------|-----|------|
| `--ais-ease-out-back` | `cubic-bezier(.34, 1.56, .64, 1)` | 애플시트 스프링 (ResultInfoModal) |
| `--ais-ease-quick` | `cubic-bezier(.4, 0, .2, 1)` | 일반 transition (200-250ms 권장) |

---

## 2. 레이아웃 표준 (`StudioLayout.tsx`)

### 2.1 핵심 상수

| 상수 | 값 | 용도 |
|------|-----|------|
| `STUDIO_MIN_WIDTH` | `1024` | 최소 viewport (UI P0-1 · 2026-04-27 · `ViewportGuard` 가 미만 시 안내) |
| `STUDIO_GRID_COLUMNS` | `"400px minmax(624px, 1fr)"` | 좌패널 400 + 우패널 가변 |
| `STUDIO_LEFT_PANEL_PADDING` | `"24px 20px"` | 좌패널 내부 padding |
| `STUDIO_RIGHT_PANEL_PADDING` | `"24px 32px"` | 우패널 내부 padding |
| `STUDIO_PANEL_GAP` | `18` | 패널 안 카드 간 gap (px) |

### 2.2 페이지 구조 (5 페이지 통일)

```tsx
<StudioPage>                         // min-width 1024 + flex column
  <AppHeader />                       // 자동 분기 (메인/메뉴 페이지)
  <StudioWorkspace>                   // grid 400px + 1fr
    <StudioLeftPanel>                 // 좌측 입력 (24px 20px padding)
      <StudioModeHeader title="..." />
      {/* 모드별 입력 컴포넌트 */}
    </StudioLeftPanel>
    <StudioRightPanel>                // 우측 결과 (24px 32px padding)
      {/* 모드별 결과 뷰어 */}
    </StudioRightPanel>
  </StudioWorkspace>
</StudioPage>
```

---

## 3. 공용 컴포넌트 (`components/studio/`)

### 3.1 결과 / 히스토리

| 컴포넌트 | 파일 | 역할 |
|----------|------|------|
| `StudioResultCard` | `StudioResultCard.tsx` | 결과 카드 shell (header + body + 호버 액션바) |
| `StudioResultHeader` | `StudioResultHeader.tsx` | 결과 카드 상단 헤더 통일 |
| `ResultHoverActionBar` | `ResultHoverActionBar.tsx` | 결과 위 호버 액션바 (focus-within a11y · 2026-04-27) |
| `ActionBarButton` | `ResultHoverActionBar.tsx` | 액션바 안 버튼 (focus-visible outline) |
| `HistoryGallery` | `HistoryGallery.tsx` | Masonry+날짜섹션 (generate/edit/video) |
| `HistoryTile` | `HistoryTile.tsx` | 히스토리 한 칸 (호버 액션바) |
| `HistorySectionHeader` | `HistorySectionHeader.tsx` | 히스토리 섹션 헤더 (4메뉴 통일) |
| `SectionHeader` | `SectionHeader.tsx` | 접기 가능 섹션 헤더 (HistoryGallery + VisionHistoryList 공유) |

### 3.2 빈 / 로딩 상태 (Audit R2 통일)

| 컴포넌트 | 파일 | 사이즈 옵션 |
|----------|------|-------------|
| `StudioEmptyState` | `StudioEmptyState.tsx` | `size: "small" \| "panel" \| "normal"` |
| `StudioLoadingState` | `StudioLoadingState.tsx` | `size: "small" \| "panel" \| "normal"` |

### 3.3 업로드 / 이미지

| 컴포넌트 | 파일 | 용도 |
|----------|------|------|
| `StudioUploadSlot` | `StudioUploadSlot.tsx` | 업로드 드롭존 shell (paste hook 통합 · 2026-04-27) |
| `SourceImageCard` | `SourceImageCard.tsx` | edit/video 원본 이미지 카드 (StudioUploadSlot 기반) |
| `CompareImageSlot` | `CompareImageSlot.tsx` | compare A/B 슬롯 (StudioUploadSlot 기반) |
| `BeforeAfterSlider` | `BeforeAfterSlider.tsx` | 슬라이드 비교 (Edit + Lightbox + Compare) |
| `ImageLightbox` | `ImageLightbox.tsx` | 전체화면 뷰어 (InfoPanel 분해 · 2026-04-27) |

### 3.4 입력 / 모달

| 컴포넌트 | 파일 | 용도 |
|----------|------|------|
| `PromptHistoryPeek` | `PromptHistoryPeek.tsx` | 프롬프트 입력 위 옛 입력 미리보기 |
| `UpgradeConfirmModal` | `UpgradeConfirmModal.tsx` | gemma4 업그레이드 결과 확인 |
| `ResultInfoModal` | `ResultInfoModal.tsx` | 결과 메타 정보 모달 (스프링 애니) |
| `ProgressModal` | `ProgressModal.tsx` | 5단계 timeline 모달 (Timelines 분해 · 2026-04-27) |
| `AnalysisProgressModal` | `AnalysisProgressModal.tsx` | 비교 분석 진행 모달 |
| `ResearchBanner` | `ResearchBanner.tsx` | Claude 조사 힌트 인라인 결과 |

### 3.5 도메인 폴더 (분해된 페이지)

| 폴더 | 역할 |
|------|------|
| `generate/` | LeftPanel + ResultViewer + RightPanel + SizeCard |
| `edit/` | LeftPanel + ResultViewer + RightPanel |
| `video/` | LeftPanel + RightPanel |
| `compare/` | LeftPanel + Viewer + AnalysisPanel |
| `vision-result/` | RecipeV2View + PromptToggle + SummaryCard + DetailCard + LegacyV1View |
| `lightbox/` | InfoPanel (메타 + 프롬프트 + 비전 + 비교 + ComparisonInPanel) |
| `progress/` | Timelines (Generate/Edit/Video Timeline + TimelineRow + DetailBox) |

---

## 4. Chrome (`components/chrome/`)

| 컴포넌트 | 파일 | 역할 |
|----------|------|------|
| `AppHeader` | `AppHeader.tsx` | 통합 헤더 (라우트 자동 분기) |
| `SystemMetrics` | `SystemMetrics.tsx` | CPU/GPU/VRAM/RAM 4-bar 모니터 |
| `SystemStatusChip` | `SystemStatusChip.tsx` | ComfyUI 가동 상태 표시 (2초 fade out) |
| `VramBadge` | (별도 파일) | VRAM 미니 bar + 임계 amber |

---

## 5. 공용 hook (`hooks/`)

| Hook | 파일 | 용도 |
|------|------|------|
| `useImagePasteTarget` | `useImagePasteTarget.ts` | 전역 Ctrl+V paste 리스너 (2026-04-27 신설) |
| `usePipelineStream` | `usePipelineStream.ts` | SSE 스트림 consumer (`consumePipelineStream`) |
| `useAutoCloseModal` | `useAutoCloseModal.ts` | 모달 자동 닫기 |
| `useAutoGrowTextarea` | `useAutoGrowTextarea.ts` | textarea 자동 높이 |
| `useGeneratePipeline` | `useGeneratePipeline.ts` | Generate 파이프라인 진입점 |
| `useEditPipeline` | `useEditPipeline.ts` | Edit 파이프라인 진입점 |
| `useVideoPipeline` | `useVideoPipeline.ts` | Video 파이프라인 진입점 |
| `useVisionPipeline` | `useVisionPipeline.ts` | Vision Recipe 파이프라인 진입점 |
| `useComparisonAnalysis` | `useComparisonAnalysis.ts` | 비교 분석 트리거 + busy guard |

---

## 6. UI primitives (`components/ui/`)

| Primitive | 용도 |
|-----------|------|
| `Icon` | Lucide 기반 아이콘 (`name: IconName`) |
| `SmallBtn` | 작은 칩 버튼 (icon + label + radius-full) |
| `Spinner` | 작은 spinner (size + color) |
| `SegControl` | segment toggle (예: Slider/Side-by-side) |
| `ImageTile` | 이미지 썸네일 컴포넌트 (히스토리) |

---

## 7. 사용 가이드

### 7.1 새 컴포넌트 만들 때

1. 도메인이 명확하면 `components/studio/<domain>/` 하위 폴더에.
2. 공용이면 `components/studio/` 평면에.
3. 색상 / radius / shadow 는 반드시 토큰 사용 (raw hex 금지).
4. 200줄 초과 시 sub-component 로 분리.

### 7.2 색상 선택 가이드

- **CTA / 액션 강조** → `--accent` (background + 위 텍스트는 `#fff`)
- **본문 텍스트** → `--ink`, 라벨 → `--ink-2`, 메타 → `--ink-3`, 비활성 → `--ink-4`
- **카드 surface** → `--surface` + `--shadow-sm`
- **성공** → `--green`, **경고** → `--amber`
- **위험** → `#EF4444` (Tailwind red-500 · 토큰 미정의)

### 7.3 둥근 모서리 가이드

| 컴포넌트 종류 | 토큰 |
|---------------|------|
| 칩 / pill | `--radius-full` |
| 작은 버튼 / 라벨 | `--radius-sm` |
| 인풋 / 작은 카드 | `--radius` |
| 메인 카드 (정보 단위) | `--radius-card` |
| 큰 패널 / 영역 | `--radius-lg` |
| 모달 sheet | `--radius-xl` |

---

## 8. 미정 / 차후

- 위험 색상 (`#EF4444`) 토큰화 필요 (`--red`, `--red-soft`)
- 폰트 시스템 (Pretendard + Fraunces) 토큰화 — 현재 inline `fontFamily`
- 모션 토큰 추가 (transition duration: fast/normal/slow)
- spacing scale 토큰 (현재 raw 4/8/10/12/14/16/18 등 혼재)

이 항목들은 다음 라운드 (필요 시) 디자인 시스템 v2 에서 처리.
