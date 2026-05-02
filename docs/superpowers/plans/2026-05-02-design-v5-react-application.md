# Design V5 — React 적용 plan (v4 — Codex 2차 리뷰 반영)

**작성**: 2026-05-02 (v1) · v2 (4 페어 + AppHeader 통합) · v3 (Codex 1차 리뷰 반영) · **v4 (Codex 2차 리뷰 반영)**
**상태**: 시안 픽스 완료 + **결정 5개 확정** (2026-05-02) → Codex 2차 리뷰 반영 끝 → **Codex 3차 리뷰 대기** → 새 세션에서 적용 시작
**예상**: **18~27h (3~5 작업일)** · Phase 0~8 (Phase 1.5 신설 +3~5h)
**전제**: 시안에서 결정된 모든 항목 100% 반영. 백엔드 schema 변경 0건.

## v3 → v4 변경 요약 (Codex 2차 리뷰 반영)

| # | 변경 | 사유 |
|---|---|---|
| 1 | **Phase 3 frame 수학 재설계** — media query 분기 (≥1280 만 박스 frame, 1024~1279 는 grid 풀폭) | Codex 🔴: `min(95vw,1600px)` 1024 viewport 에서 972.8px 인데 안쪽 grid 1024 + padding 48 + border 2 = 1074px 필요 → **101.2px 부족** 으로 깨짐 |
| 2 | **Phase 1.5.3 Edit 카드 순서에서 성인 카드 제거** | Codex 🔴: Edit 코드 + 시안 모두 성인 모드 없음 (`EditLeftPanel.tsx` adult/성인 0 매치). 성인은 Video 전용. Edit 는 AI → 자동평가 → 퀄리티 → 추가 참조 까지 |
| 3 | **pytest 숫자 통일** — 405 (`cd backend; pytest tests/` 표준) + reference 로 469 (root collect · legacy 포함) 박제 | Codex 🔴: 환경별 차이 (legacy 4 파일 + 60+ collect 차이). plan 표준 명령은 CLAUDE.md 매칭 = 405 |
| 4 | **inline style 0 범위 좁히기** | Codex 🟡: 전체 패널 literal 0 은 너무 큼 → "V5 시각 대상 카드/헤더/CTA/action bar 본체 inline style 0, 동적 계산 (compareX/dynamicHeight 등) 은 허용" |
| 5 | **Video 속도 chip 명확화** | Codex 🟡: 별도 카드처럼 읽힘 → "video-res-card 내부 4단계 chip 유지" 명시 |
| 6 | **결정 K 문구 정정** | Codex 🟡: 오해 회피 → "CTA shortcut **표시** 제거 + 기능 미구현 유지" |

## v2 → v3 변경 요약 (Codex 1차 리뷰 반영)

| # | 변경 | 사유 |
|---|---|---|
| 1 | **Phase 1.5 신설** (좌측 패널 적용 · 3-5h) | Codex 🔴: 결정 A~D/J/K 가 좌측 패널인데 v2 가 우측/Chrome/Layout 위주 → 좌측 적용 단계 누락 |
| 2 | Phase 0 — `framer-motion install` 단계 **삭제** | 이미 설치됨 (`package.json:17` · `^12.38.0`) |
| 3 | Phase 0 — 자산 "7 webp" → **"8 base + 8 @2x = 16 webp"** | 실제: `card-bg-{ai,fast,claude,auto-compare,size,multi-ref,video-res,adult}.webp` × 2 (`@2x`) = 16. `auto-compare` 누락하면 Edit 자동평가 카드 깨짐 |
| 4 | Phase 0 — `frontend/public/studio/cards/` 디렉토리 신설 작업 명시 | 현재 미존재 |
| 5 | Phase 3 **재설계** — wrapper 가 grid 깨지 않게 | Codex 🔴: 현재 `StudioWorkspace` 가 직접 grid container (`StudioLayout.tsx:45`). 안에 `<StudioFrame>` wrapper 끼우면 좌/우 패널이 grid child 가 안 됨 → 옵션 (2) **StudioWorkspace 에 frame 스타일 직접 합치기** 채택 |
| 6 | Phase 6 — PromptToggle **기존 combined/split + A1111 호환 통합 복사 보존 필수** | Codex 🔴: 현재 `PromptToggle.tsx:23` 가 통합/분리 + A1111 호환 (`combinedText` + 통합 복사) 흐름 있음 → plan 의 "PROMPT/NEGATIVE 단순 토글" 로 교체하면 회귀. 색 톤 (green/red) 만 추가 |
| 7 | Phase 2 — MetricsPopover **`:focus-within` + close timer + Esc 닫기** 명시 | Codex 🟡: bridge `::before` + `transition-delay` 만으로는 자식 popover 일 때만 충분 → 키보드 접근성 보강 |
| 8 | Phase 2 — AppHeader 6 chip **1024px 충돌 검증** 추가 | Codex 🟡: 최소 지원 1024 인데 plan 검증 1280 부터만 |
| 9 | Phase 2 — ModeNav active 매칭 **`/vision/compare` exact priority** 명시 | Codex 🟢: Vision Analyze 와 chip 동시 활성 회피 |
| 10 | CSS class **`.ais-*` 네임스페이스 통일** | Codex 🟡: `.cta-primary`, `.mode-header`, `.result-header` 전역 충돌/무적용 위험 |
| 11 | Phase 1~7 — **inline style → className 전환 작업 명시** | Codex 🟡: Phase 1 CSS 만 추가하면 실제 컴포넌트 inline style 때문에 화면 안 바뀜 |
| 12 | Edit action bar — **"기본 4개 + canPromote 5번째"** 명시 | Codex 🟡: canPromote 보존과 "4 버튼" 충돌 해소 |
| 13 | Phase 8 — vitest **150 → 165** 정정 | Codex 🔴: 실제 165 collected (plan stale) |
| 14 | Phase 8 — master merge `--no-ff` → **"오빠 승인 후"** | Codex 🟢: 자동 X |
| 15 | 회귀 위험 9 → **11 항목** | PromptToggle combined/split (NEW) + inline→className 전환 (NEW) |
| 16 | Phase 1.5 후 **Codex 리뷰 1회 추가** | 좌측 패널 적용 정확도 보장 |

## 확정 결정 (2026-05-02 오빠 결정 · Pending Decisions ⓐ~ⓔ 클로즈)

| # | 항목 | 확정 |
|---|---|---|
| ⓐ | 적용 전략 | **C (hybrid)** — Phase 1~3 한 번 merge + Phase 4~7 phase 별 merge + Phase 8 cleanup |
| ⓑ | branch 이름 | **`feature/design-v5`** |
| ⓒ | Caption (Generate/Edit) | **α** — 적용 + 2주 후 평가 (옛 "summary 제거" 결정 vs 시안 italic prompt 비교) |
| ⓓ | framer-motion 도입 | **Yes** (이미 설치 `^12.38.0` · 활성 카드 spring 만 신규 적용) |
| ⓔ | Codex 리뷰 시점 | **Phase 별** — Phase 1/**1.5**/2/4/5/6/7/8 완료 시점 (정확도 보장) |

## 시안 픽스 완료 (5 파일)

| 파일 | 상태 | 비고 |
|---|---|---|
| `docs/design-test/cards-v2.html` | ✅ 픽스 (v5) | 5 패널 좌측 갤러리 (Generate/Edit/Vision/Compare/Video) |
| `docs/design-test/pair-generate.html` | ✅ 픽스 (v7) | 좌+우 + AppHeader 정리 (HomeBtn 흡수 / 영문 nav / Fraunces italic / spring) |
| `docs/design-test/pair-edit.html` | ✅ 픽스 (v3) | BeforeAfter slider Hero + Comparison Card + SystemMetrics 호버 팝오버 |
| `docs/design-test/pair-vision.html` | ✅ 픽스 (v1) | Summary 한/영 + Prompt Toggle + 6 Detail Cards + Vision History |
| `docs/design-test/pair-compare.html` | ✅ 픽스 (v1) | A/B 슬롯 + 5축 Analysis + Transform + Uncertain |
| `docs/design-test/pair-video.html` | ⏸ 미작성 | Generate/Edit 와 비슷 — 후속 작업 (옵션) |

## 변경 범위 요약

| 영역 | 범위 | 위험도 |
|---|---|---|
| AppHeader (5 페이지 공용) | Logo Fraunces italic + 중앙 ModeNav 6 chip + HomeBtn 흡수 + ghost 통일 + MetricsPopover + spring | 🔴 한 번 깨지면 다 깨짐 |
| StudioWorkspace 박스 frame (5 페이지 공용) | `max-width: min(95vw, 1600px)` cap + border + padding (옵션 D · v3 재설계) | 🟡 시각만 |
| **좌측 패널 (5 mode)** ⭐NEW | StudioModeHeader bilingual + 카드 순서 (A~D · Edit 성인 X) + auto-compare-card / video-res-card / multi-ref / adult(Video 전용) 패턴 적용 + CTA shortcut **표시** 제거 + framer-motion spring | 🔴 V5 시각 대상 inline style → className 전환 회귀 위험 |
| Generate 우측 | Caption (NEW) + Archive 통합 헤더 + selected violet ring + 4 버튼 action bar | 🟢 작은 격상 |
| Edit 우측 | BeforeAfter slider Hero (matt + SegControl) + Caption ↔ Comparison 순서 + canPromote 5번째 액션 | 🟡 BeforeAfter + Caption |
| Vision 우측 | Summary 한/영 폰트 분기 + Prompt Toggle 색 톤 (combined/split 보존) + 6 Detail Cards + 새 history-tile 패턴 | 🟡 폰트 분기 + 회귀 회피 |
| Compare 우측 | A/B 라벨 그라데이션 + 5축 Analysis + Transform + Uncertain | 🔴 큰 변경 |
| CTA 위치 (Compare/Vision) | 옛 sticky 하단 → 상단 (옵션 F · H) | 🟡 flex:1 spacer 제거 |

## Phase 단계 (Hybrid 전략)

### Phase 0 — 사전 준비 (1-2h)

- [ ] 새 branch: `feature/design-v5` (master 영향 0 보장)
- [x] ~~`npm install framer-motion`~~ → **이미 설치 `^12.38.0`** (`package.json:17`) · 검증만
- [ ] **`frontend/public/studio/cards/` 디렉토리 신설** (현재 미존재)
- [ ] **16 webp 카드 배경 복사** (`docs/design-test/assets/card-bg-*.webp` 8 base + 8 @2x):
  - `card-bg-ai.webp` / `card-bg-ai@2x.webp` (violet · AI 보강)
  - `card-bg-fast.webp` / `card-bg-fast@2x.webp` (lime · 빠른 모드)
  - `card-bg-claude.webp` / `card-bg-claude@2x.webp` (orange · Claude 조사)
  - **`card-bg-auto-compare.webp` / `card-bg-auto-compare@2x.webp` (amber · Edit 자동평가)** ⚠ 누락하면 깨짐
  - `card-bg-size.webp` / `card-bg-size@2x.webp` (rose · 사이즈)
  - `card-bg-multi-ref.webp` / `card-bg-multi-ref@2x.webp` (fuchsia · 추가 참조)
  - `card-bg-video-res.webp` / `card-bg-video-res@2x.webp` (coral · 영상 해상도)
  - `card-bg-adult.webp` / `card-bg-adult@2x.webp` (crimson · 성인)
- [ ] 글로벌 메모리 갱신 (이 plan + memory `project_design_v5_pending_decisions.md` 박제 끝)
- [ ] **검증**: branch 깨끗 + 자산 16개 복사 확인 + framer-motion `^12.38.0` 확인

---

### Phase 1 — Foundation (시각만 · 3-4h) 🟢

#### 1.1 globals.css V5 토큰 추가
- 시그니처 컬러 8종 CSS variable (`--card-from`, `--card-to`, `--card-glow`, `--card-shadow` per signature):
  - violet/blue (AI), amber/orange (auto-compare), lime/cyan (fast/퀄리티), rose/pink (사이즈), fuchsia (multi-ref), warm coral (video-res), crimson (adult), neutral (Claude orange)
- Aurora Glass CTA: **`.ais-cta-primary`** (violet→blue grad + light sweep 0.7s)
- 카드 패턴 (`.ais-*` 네임스페이스 통일):
  - `.ais-toggle-card`, `.ais-size-card-v`, `.ais-video-res-card`, `.ais-multi-ref-card`, `.ais-auto-compare-card`, `.ais-adult-card`
- 활성 효과: padding 14→38, mask 35→15, transition 0.35s cubic-bezier
- 폰트: Fraunces (italic) + JetBrains Mono + Pretendard variable (이미 로드)

#### 1.2 mode-header 스타일
- **`.ais-mode-header`** (eyebrow JetBrains Mono 9.5/0.14em + Fraunces italic 26 bilingual `<strong>한글</strong> · English` + 점선 border-bottom)

#### 1.3 페어 시안 우측 전용 CSS (NEW · 모두 `.ais-*`)
- `.ais-result-header` (Fraunces italic 26 + violet output accent + meta pills)
- `.ais-result-hero` (16:9 매트 + dot grid 16px) + `.ais-result-hero-edit` (column · matt + slider)
- `.ais-result-action-bar` (어두운 frosted glass `rgba(28,30,38,.32)` + 흰 아이콘 4 버튼 + spring)
- `.ais-result-caption` (Fraunces italic 큰따옴표 prompt 1줄 truncate)
- `.ais-archive-header` (점선 border-top + Fraunces italic + count + size chip)
- `.ais-history-section-header` (박스 카드 + Fraunces italic bilingual + chevron 회전)
- `.ais-history-grid` (4-col 또는 auto-cols 240px min) + `.ais-history-tile` + `.ais-tile-action-bar` (4 버튼)
- `.ais-ba-slider` + `.ais-ba-handle-grip` + `.ais-ba-label-before/after` + `.ais-ba-label-a/b` (Compare A=violet/B=amber 그라데이션)
- `.ais-comparison-card` (Edit · amber 5축 dot)
- `.ais-compare-analysis-card` + `.ais-axis-row` + `.ais-transform-prompt-box` + `.ais-uncertain-box` (Compare 5축 분석)
- `.ais-vision-summary` + `.ais-vision-prompt-toggle` + `.ais-vision-detail-grid` + `.ais-vision-detail-card` (Vision 결과)
- `.ais-vision-history-tile` (썸네일 88 + Fraunces italic summary 2-line)

#### 1.4 AppHeader 전용 CSS
- `.ais-app-header-mock` 베이스 → `.ais-app-header` (production)
- `.ais-ah-nav` segmented (subtle bg + Fraunces italic 13 chips + spring 통통 cubic-bezier(0.34, 1.56, 0.64, 1))
- `.ais-ah-metrics-popover` 어두운 frosted dropdown + `.ais-ah-mp-row` (CPU/GPU/VRAM/RAM)

#### 1.5 Phase 1 검증
- [ ] dev 서버 5 페이지 렌더 깨짐 없음 (옛 디자인 그대로 + 새 클래스 추가만)
- [ ] tsc clean + ESLint clean
- [ ] **주의**: 이 단계만 끝낸 화면은 **여전히 옛 디자인** (className 전환은 Phase 1.5~7)

---

### Phase 1.5 — 좌측 패널 적용 (3-5h) 🔴 ⭐NEW

> **Codex 🔴 critical**: 결정 A~D / J / K (좌측 패널 카드 순서/패턴/CTA) 가 v2 plan 에서 별도 phase 없이 흩어져 있었음 → 통합 phase 신설.
> **회귀 위험 최대 구간** — inline style → className 전환 (Phase 1 CSS 가 이 단계부터 화면 적용)

#### 1.5.1 StudioModeHeader bilingual 전환
- `frontend/components/studio/StudioLayout.tsx:92` `StudioModeHeader`:
  - 옛: `<h1>{title}</h1> + <p>{description}</p>` (단일 한글)
  - 새: `<h1>` Fraunces italic 26 bilingual `<strong>한글</strong> · English` + eyebrow JetBrains Mono `MODE · GENERATE` 등
  - prop signature 변경: `{ title, description, flowHref, flowLabel }` → `{ titleKo, titleEn, eyebrow, description, flowHref, flowLabel }` (호환 위해 옛 `title` deprecated alias)

#### 1.5.2 Generate 좌측 패널 (`components/studio/generate/GenerateLeftPanel.tsx`)
- StudioModeHeader prop 전환 (`titleKo="생성" titleEn="Generate" eyebrow="MODE · GENERATE"`)
- 카드 순서 그대로 (이미 OK · 결정 A 는 Edit 만 해당)
- AI 보강 카드 → `.ais-toggle-card` className + violet signature
- Lightning Toggle → fast signature (lime)
- Research Banner → claude signature (orange)
- Size Card → `.ais-size-card-v` className + rose signature
- Primary CTA → `.ais-cta-primary` 변경 (옛 inline style 제거)
- **CTA shortcut 표시 제거** (결정 K · 기능 미구현 유지)

#### 1.5.3 Edit 좌측 패널 (`components/studio/edit/EditLeftPanel.tsx`)
- StudioModeHeader prop 전환 (`titleKo="수정" titleEn="Edit"`)
- **카드 순서 변경** (결정 A): AI → **자동평가** → 퀄리티 → 추가 참조 (Edit 는 성인 모드 없음 — Video 전용)
- 자동평가 카드 → `.ais-auto-compare-card` 패턴 (결정 C — amber signature)
- 추가 참조 (multi-ref) → `.ais-multi-ref-card` 패턴 (결정 J — fuchsia signature)
- AI 보강 / Lightning Toggle / 퀄리티 → 패턴 매칭
- Primary CTA → `.ais-cta-primary` + shortcut **표시** 제거 (결정 K · 기능 미구현 유지)

#### 1.5.4 Video 좌측 패널 (`components/studio/video/VideoLeftPanel.tsx`)
- StudioModeHeader prop 전환 (`titleKo="영상" titleEn="Video"`)
- **카드 순서 변경** (결정 B): AI → 퀄리티 → 성인 → **영상 해상도 (맨 아래)**
- 영상 해상도 카드 → `.ais-video-res-card` 패턴 (결정 D — coral signature) · **속도 chip 4단계는 video-res-card 내부에 유지** (결정 E — 별도 카드 X)
- 성인 → `.ais-adult-card` (crimson signature · Video 전용)
- AI 보강 / Lightning Toggle / 퀄리티 → 패턴 매칭
- Primary CTA → `.ais-cta-primary` + shortcut **표시** 제거 (결정 K · 기능 미구현 유지)

#### 1.5.5 Compare 좌측 패널 (`components/studio/compare/CompareLeftPanel.tsx`)
- StudioModeHeader prop 전환 (`titleKo="비교" titleEn="Compare"`)
- **CTA 상단 sticky로 변경** (결정 F · 옛 하단 sticky · `flex:1 spacer` 제거)
- A/B 슬롯 카드 → 시안 톤 매칭

#### 1.5.6 Vision 좌측 (`app/vision/page.tsx` 안 — LeftPanel 컴포넌트 없음)
- StudioModeHeader prop 전환 (`titleKo="분석" titleEn="Analyze"`)
- **CTA 상단 sticky로 변경** (결정 H · 옛 하단 sticky · `flex:1 spacer` 제거)
- SourceImageCard → 시안 톤 매칭
- 안내 배너 그대로 유지

#### 1.5.7 framer-motion 활성 카드 spring (결정 ⓓ · I)
- 활성 카드 (`open` state) → `motion.div` `layout` + spring `stiffness: 320 / damping: 26`
- ⚠ `<motion.div layout>` 안 children 의 layout shift 가 생길 수 있음 — `layoutId` 충돌 회피 + `transition.layout` override

#### 1.5.8 Phase 1.5 검증
- [ ] 5 페이지 좌측 패널 시각 = 시안 페어 좌측과 1:1 매칭
- [ ] **inline style 잔여 0 (V5 시각 대상 한정)** — 카드/헤더/CTA/action bar 본체 inline style 0 (Codex 2차 🟡). 동적 계산 (compareX / dynamicHeight / framer-motion 의 motion style) 은 허용
- [ ] CTA 상단 sticky (Compare / Vision)
- [ ] 카드 활성 spring 자연 (1초 미만 fluid)
- [ ] **회귀** — `cd backend; pytest tests/` 405 PASS (root collect 469) + vitest 165 + tsc + ESLint clean
- [ ] **Codex 리뷰 추가** (좌측 패널 정확도 — 결정 A~K 1:1 매칭 검증)

---

### Phase 2 — Chrome (헤더 + Metrics 팝오버) (3-4h) 🔴

#### 2.1 AppHeader 리팩터
- `frontend/components/chrome/AppHeader.tsx`:
  - HomeBtn 좌측 제거
  - 중앙 `<ModeNav />` 컴포넌트 신설 — 6 chip (Home / Generate / Edit / Video / Analyze / Compare)
    - usePathname 으로 활성 chip 판정
    - **`/vision/compare` exact priority** (Vision Analyze chip 동시 활성 회피)
      - 매칭 우선순위: `pathname === "/vision/compare"` → Compare chip / `pathname === "/vision"` → Analyze chip / `pathname.startsWith("/vision")` → Analyze chip 폴백
    - router.push 로 라우팅
    - Fraunces italic 13px (V5 톤 통일)
  - SettingsButton / ShutdownButton ghost 톤 통일 (현재 SettingsButton 은 IconBtn 으로 OK · HomeBtn 만 outlined 이었음)
- `frontend/components/chrome/Chrome.tsx`:
  - Logo `Image Studio` 텍스트 → Fraunces italic 14px (mark + version mono 그대로)

#### 2.2 SystemMetrics 호버 팝오버 (옵션 A · 접근성 보강)
- `frontend/components/chrome/SystemMetrics.tsx`:
  - **옛 inline expand 폐기** — gap 6→12, bar 44→112 inline 코드 제거
  - 새 `MetricsPopover.tsx` 분리 — frosted glass dropdown (top: 100%+10 / right: -80px / blur 22 saturate 180%)
  - 4 metric rows (dot+halo · MONO 라벨 · usage · long bar · % mono)
  - Divider + `VRAM BREAKDOWN` (ComfyUI/Ollama + Fraunces italic 모델명 — VRAM ≥80% + breakdown 데이터 있을 때만)
  - **hover-stay-open + 키보드 접근성 보강** (Codex 🟡):
    - `::before` invisible bridge (10px) + transition-delay 0.15s (마우스 transit)
    - **`:focus-within`** popover 자동 노출 (Tab 키 진입)
    - **close timer 200ms** (마우스 leave 후 short delay)
    - **Esc 키 닫기** (focus return → trigger button)
    - `aria-expanded` + `aria-controls` 연결

#### 2.3 Phase 2 검증
- [ ] 모든 페이지 라우팅 (각 nav chip 클릭 시 이동)
- [ ] usePathname 활성 chip 판정 정확 (특히 `/vision` vs `/vision/compare` exact match)
- [ ] Logo italic 시각
- [ ] MetricsPopover hover/focus/blur/Esc 정상 (transit 끊김 없이 popover 안 액션 가능)
- [ ] **1024px viewport 충돌 검증** (Codex 🟡 — 최소 지원폭 1024 + Logo + 6 chip + 우측 metrics/settings/shutdown 한 줄 수용 가능?)
- [ ] 1280 / 1440 / 1920 / 2560 viewport 모두 시각 자연
- [ ] 키보드 접근성 — Tab 으로 metrics 진입 시 popover 자동 노출
- [ ] 회귀 — `cd backend; pytest tests/` 405 PASS (root collect 469) + vitest 165 + tsc + ESLint clean

---

### Phase 3 — Layout 박스 frame (1-2h) 🟡 (v4 재설계 — media query 분기)

> **Codex 1차 🔴**: v2 plan 의 "wrapper 끼우기" 방식은 현재 `StudioWorkspace` 가 직접 grid container 라 깨짐 (`StudioLayout.tsx:45` · `gridTemplateColumns: "400px minmax(624px, 1fr)"`). 좌/우 패널이 grid child 가 아니게 됨.
> **Codex 2차 🔴**: v3 의 "frame 스타일 직접 합치기" 도 1024 viewport 에서 수학 안 맞음 (`min(95vw,1600)` = 972.8px < 1024(grid)+48(padding)+2(border) = 1074px → **101.2px 부족**).
> **v4 재설계**: **media query 분기** — 1024~1279 는 frame 없이 grid 풀폭 (옛 동작 그대로) / **1280px+ 부터만 박스 frame** (양 옆 빔 + 박스 임팩트 발휘 가능 폭).

#### 3.1 StudioWorkspace 에 frame 스타일 합치기 (≥1280 만 활성)
- `frontend/components/studio/StudioLayout.tsx:45` `StudioWorkspace`:
  - 기존 inline style 그대로 유지: `flex: 1 + display: grid + gridTemplateColumns: "400px minmax(624px, 1fr)" + minHeight: calc(100vh - 52px)`
  - **새 className `.ais-studio-workspace`** 추가
  - `globals.css` 에서 media query 분기:
    ```css
    /* 1024~1279 : 옛 동작 그대로 (frame 없이 grid 풀폭) */
    .ais-studio-workspace {
      /* frame 스타일 없음 — grid 만 */
    }

    /* 1280+ : 박스 frame */
    @media (min-width: 1280px) {
      .ais-studio-workspace {
        max-width: min(95vw, 1600px);
        margin: 0 auto;
        padding: 22px 24px 30px;
        border: 1px solid var(--line);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
      }
    }
    ```
  - **grid 그대로 유지** (`400px minmax(624px, 1fr)`) — 좌/우 패널 direct child 깨짐 0
- 5 페이지 (`/`, `/generate`, `/edit`, `/video`, `/vision`, `/vision/compare`) 모두 자동 영향 (StudioLayout 공용)

#### 3.2 Phase 3 검증
- [ ] **1024 viewport** — frame 없이 grid 풀폭 (좌 400 + 우 624 = 1024 정확 fit) ⚠ 수학 검증
- [ ] **1280 viewport** — frame 활성 (`min(95vw, 1600)` = 1216px > 좌 400 + 우 624 + padding 48 + border 2 = 1074px ✅ 142px 여유)
- [ ] 1440 / 1920 / 2560 viewport 박스 시각 (양 옆 빔 자연 + 28인치 cap 1600px)
- [ ] right-panel 자동 확장 (history auto-cols 2~6 정상)
- [ ] Hero maxHeight 65vh 정상 (큰 모니터 자연 cap)
- [ ] **좌/우 패널 grid child 정상** (Codex 1차 재설계 검증)
- [ ] **1280 경계** — media query transition 매끄러움 (1279 → 1280 갑작스런 점프 자연)

---

### Phase 4 — Generate 우측 (2-3h) 🟢

#### 4.1 공용 컴포넌트 격상 (className 전환 명시)
- `frontend/components/studio/StudioResultHeader.tsx`:
  - `<h3>` 13px → `<h2>` Fraunces italic 26px (eyebrow + bilingual `<strong>한글</strong> · English` + meta pills)
  - violet output accent (`#7C3AED` strong color)
  - className `.ais-result-header` 적용 (inline style 잔여 0)
- `frontend/components/studio/HistorySectionHeader.tsx`:
  - 옛 작은 헤더 (border-top + h3 13px) → **Archive Header** 격상 (점선 border-top + eyebrow `IMAGE STUDIO · ARCHIVE` + Fraunces italic 26 `보관 · History` + count + size chip)
  - className `.ais-archive-header`
- `frontend/components/studio/SectionHeader.tsx`:
  - Fraunces italic bilingual `<strong>오늘</strong> · Today` 17px + count chip + chevron
  - className `.ais-history-section-header`
- `frontend/components/studio/HistoryTile.tsx`:
  - selected = 흰 ring 2px + violet ring 4px + `● 선택` violet 칩 (옛 2px blue accent border 보다 강함)
  - hover 액션바 4 버튼 (자세히 / 복사 / 수정 / 삭제 — 옛 3 버튼 `zoom · edit · delete` → 복사 추가)
  - className `.ais-history-tile` + `.ais-tile-action-bar`
- `frontend/components/studio/ResultHoverActionBar.tsx`:
  - 어두운 frosted glass 그대로 유지 (이미 비슷)
  - **Hero 5 버튼 → 4 버튼 (download 제거)** — `canPromote` 등 프롭 그대로
  - className `.ais-result-action-bar`

#### 4.2 Generate 전용
- `frontend/components/studio/generate/GenerateResultViewer.tsx`:
  - Action Bar 4 버튼 (자세히 / 복사 / 수정 / 리프레시 — download 제거)
  - **Caption 슬롯 (NEW · Plan 결정 항목 ⓒ)** — italic prompt 1줄 truncate (Hero 아래)
  - className `.ais-result-caption`
  - Hero wheel zoom + drag pan + dbl-click reset **유지 필수** (옛 코드 그대로 keep · 회귀 위험 #2)
- `frontend/components/studio/generate/GenerateRightPanel.tsx`:
  - Caption 슬롯 추가 (Hero 와 Archive 사이)
  - Archive 통합 헤더 추가 (HistorySectionHeader 격상 활용)
  - `useHistoryStats` 훅 추가 (`/api/studio/history/stats` 호출 → `byMode.generate.sizeBytes` 표시)

#### 4.3 Phase 4 검증
- [ ] /generate 페이지 시각 + 인터랙션
- [ ] HistoryGallery ResizeObserver 자동 컬럼 정상 (240px min · 2~6)
- [ ] Hero wheel zoom + drag pan + dbl-click reset 정상
- [ ] inline style 잔여 0 (className 전환 완료 확인)

---

### Phase 5 — Edit 우측 (2-3h) 🟡

- `frontend/components/studio/edit/EditResultViewer.tsx`:
  - **Action Bar — 기본 4 버튼 (자세히 / 복사 / 다음 수정 원본 / 리프레시 — download 제거) + canPromote=true 시 5번째 "라이브러리 저장" 추가** (Codex 🟡 명시)
  - BeforeAfter slider 안 BEFORE/AFTER mono 라벨 추가 (rgba(0,0,0,.55) bg + 흰 글자)
  - SegControl (슬라이더/나란히) 그대로 유지
  - canPromote 라이브러리 저장 버튼 **유지 필수** (회귀 위험 #5)
- `frontend/components/studio/ComparisonAnalysisCard.tsx`:
  - filled state 시각 격상 — amber gradient bg + 점 + mono `87%` + 3축 dot 색 매칭 + [자세히] [재분석]
  - className `.ais-comparison-card`
- `frontend/components/studio/edit/EditRightPanel.tsx`:
  - **Caption 슬롯 (Edit 지시 italic)** Hero 아래 추가 (Plan 결정 항목 ⓒ — 같이 가)
  - **순서: Hero → Caption → Comparison → Archive → History** (오빠 결정)
  - sourceRef NULL 옛 row toast 안내 **유지 필수** (회귀 위험 #7)

#### 5.1 Phase 5 검증
- [ ] /edit 페이지 시각 + BeforeAfter slider 드래그 정상 (compareX 0~100)
- [ ] slider/sidebyside 모드 토글 정상
- [ ] sourceRef === sourceImage 짝 일치 검증 정상
- [ ] **canPromote=true 시 5번째 액션 노출 / canPromote=false 시 4 버튼 만** (Codex 🟡 명시)
- [ ] sourceRef NULL 옛 row 클릭 toast 정상

---

### Phase 6 — Vision 우측 (3-4h) 🟡 (PromptToggle 회귀 회피)

> **Codex 🔴**: 현재 `PromptToggle.tsx:23` 가 통합/분리 + A1111 호환 (`combinedText` + 통합 복사) 흐름 있음 → plan 의 "PROMPT/NEGATIVE 단순 토글" 로 교체하면 회귀.
> **결정**: 색 톤 (green/red) 만 추가, **combined/split 토글 + A1111 호환 통합 복사 보존 필수**

- `frontend/components/studio/vision-result/SummaryCard.tsx`:
  - **한글 본문 = Pretendard / 영문 본문 = Fraunces italic 13.5** 분기 추가 (`data-lang="ko"` / `data-lang="en"`)
  - 한/영 tab + 복사 버튼 그대로
  - className `.ais-vision-summary`
- `frontend/components/studio/vision-result/PromptToggle.tsx`:
  - **`combined/split` toggle 보존** (회귀 위험 #10)
  - **A1111 호환 `combinedText` (positive + Negative prompt: negative) 보존**
  - **통합 모드 복사 버튼 보존** (`onCopy(combinedText, "통합 프롬프트")`)
  - **추가만**: split 모드 시 POSITIVE 섹션 = green tone (`#2D7A2D` active dot/icon) / NEGATIVE 섹션 = red tone (`#B8232C` active dot/icon)
  - mono body 그대로
  - className `.ais-vision-prompt-toggle`
- `frontend/components/studio/vision-result/DetailCard.tsx`:
  - 카드별 아이콘박스 + UPPERCASE mono 라벨 (이미 비슷 — 작은 격상)
  - className `.ais-vision-detail-card`
- `frontend/components/studio/vision-result/RecipeV2View.tsx`:
  - grid `repeat(auto-fit, minmax(260px, 1fr))` 그대로 유지
  - className `.ais-vision-detail-grid`
- `frontend/components/studio/VisionHistoryList.tsx`:
  - **새 vision-history-tile 패턴** (썸네일 88 + 본문: mono meta `5/2 14:20 · 1672×941` + Fraunces italic summary 2-line truncate)
  - 2-col grid (옛 ImageTile + label 패턴 폐기)
  - 날짜 섹션 그룹핑 (groupByDate) 그대로 유지
  - className `.ais-vision-history-tile`
- `frontend/app/vision/page.tsx`:
  - **CTA 상단 sticky로 변경** (Phase 1.5 와 같이 가는 작업 — 결정 H)
  - 안내 배너 그대로 유지
- v1 옛 row 호환 (LegacyV1View) **유지 필수** (회귀 위험 #6 · positivePrompt 빈 row)

#### 6.1 Phase 6 검증
- [ ] /vision 페이지 시각
- [ ] 한/영 tab 클릭 시 Pretendard ↔ Fraunces italic 폰트 분기
- [ ] **PromptToggle: 통합 모드 클릭 시 통합 복사 정상 (`positive\n\nNegative prompt: negative`)** ⚠ 회귀 회피
- [ ] PromptToggle: 분리 모드 클릭 시 POSITIVE green / NEGATIVE red 색 톤
- [ ] 한글 번역 실패 시 영문 탭 폴백 정상
- [ ] v1 옛 row LegacyV1View 폴백 정상

---

### Phase 7 — Compare 우측 (3-4h) 🔴

- `frontend/components/studio/compare/CompareLeftPanel.tsx`:
  - CTA 상단 sticky (Phase 1.5 에서 이미 처리 — 검증만)
- `frontend/components/studio/BeforeAfterSlider.tsx` (Phase 5 Codex 3차 nit #1 박제):
  - **`labelVariant?: "before-after" | "ab"` prop 신규** (기본 "before-after" — Edit/Lightbox 호환)
  - className 분기:
    - `"before-after"` → `.ais-ba-label-before` / `.ais-ba-label-after` (V5 검은 톤 default · 현재 적용됨)
    - `"ab"` → `.ais-ba-label-a` / `.ais-ba-label-b` (V5 violet/amber 그라데이션 시그니처 · `globals.css:1601-1614` 활용)
- `frontend/components/studio/compare/CompareViewer.tsx`:
  - BeforeAfterSlider 호출 시 **`labelVariant="ab"` + `beforeLabel="A"` + `afterLabel="B"`** 명시
  - V5 시그니처 그라데이션 자동 적용 (globals.css 의 `.ais-ba-label-a` / `-b` 정의 활용)
  - 비율 차이 amber 경고 chip 그대로 유지
- `frontend/components/studio/compare/CompareAnalysisPanel.tsx`:
  - 종합 chip = violet gradient (`linear-gradient(135deg, rgba(139,92,246,0.10), rgba(139,92,246,0.04))` + violet text)
  - 5 AxisRow — bar 색 (80+ green / 60+ amber / 미만 gray) 매칭
  - className `.ais-compare-analysis-card` + `.ais-axis-row`
  - SUMMARY 박스 (neutral) → **TRANSFORM Prompt 박스 (violet 톤)** → **UNCERTAIN 박스 (amber 톤)** 분리
- `frontend/components/studio/CompareExtraBoxes.tsx`:
  - TransformPromptBox / UncertainBox 시안 톤 매칭 (violet/amber bg)
  - className `.ais-transform-prompt-box` + `.ais-uncertain-box`

#### 7.1 Phase 7 검증
- [ ] /vision/compare 페이지 시각
- [ ] BeforeAfter slider 드래그 정상
- [ ] slider/sidebyside 모드 토글 정상
- [ ] 비율 10%↑ 차이 자동 amber 경고 노출
- [ ] transform_prompt 한/영 토글 정상 (CompareExtraBoxes)
- [ ] uncertain 한/영 토글 정상

---

### Phase 8 — Cleanup + 회귀 테스트 (1-2h)

- [ ] **VisionHistoryList 헤더 V5 Archive Header 패턴 통일 검토** (Codex Phase 6 nit #3 박제):
  - 현재 옛 헤더: h3 "최근 분석" + count + 모두 지우기 버튼 (`.ais-vision-history-header`)
  - Edit/Generate V5 패턴: HistorySectionHeader (eyebrow `IMAGE STUDIO · ARCHIVE` + Fraunces italic bilingual + count chip + sizeBytes chip)
  - 옵션 A — 통일: HistorySectionHeader 격상 + `titleEn="History"` (sizeBytes 는 vision 전용 X — count 만)
  - 옵션 B — 그대로 (Vision 전용 작은 헤더 의도 보존 · plan §6 명시 X)
  - 결정 후보 — Phase 8 시점 시각 비교 후
- [ ] 5 페이지 수동 검증 (Chrome MCP — 시안 페어 시각 일치 확인)
- [ ] 회귀 테스트:
  - **`cd backend; pytest tests/` → 405 PASS** (CLAUDE.md 표준 명령 · legacy quarantine 적용)
  - **(reference) project root collect = 469** — Codex 가 본 숫자 (legacy `backend/legacy/tests/` 4 파일 포함). plan 의 표준은 405
  - **vitest 165 PASS**
  - tsc clean + ESLint clean
- [ ] 메모리 박제 — `project_design_v5_pending_decisions.md` 적용 완료 표시 + 새 메모리 추가 (적용 후 회고)
- [ ] CHANGELOG 업데이트 (`docs/changelog.md`)
- [ ] **master merge — `--no-ff` (CLAUDE.md 관례) · 오빠 승인 후 수동 실행** (Codex 1차 🟢)

---

## 회귀 위험 항목 (적용 시 *유지 필수*) ⚠ (9 → 11 항목)

| # | 항목 | 위치 | 시안 | 실 production 처리 |
|---|---|---|---|---|
| 1 | HistoryGallery ResizeObserver 자동 컬럼 (240px min · 2~6) | `HistoryGallery.tsx:61` | 4 고정 | **자동 유지** (4K 모니터 손해 회피) |
| 2 | Hero wheel zoom + drag pan + dbl-click reset | `GenerateResultViewer.tsx:81-143` | 안 그림 | **유지 필수** |
| 3 | ActionBar focus-within 키보드 접근성 | `ResultHoverActionBar.tsx:42-52` | 안 그림 | **유지 필수** |
| 4 | BeforeAfterSlider 드래그 핸들 (compareX) | `BeforeAfterSlider.tsx` | 50% 정적 | **드래그 유지** |
| 5 | canPromote 라이브러리 저장 버튼 | `EditResultViewer.tsx:141-147` | 안 그림 | **유지** (Edit reference v9) — Phase 5 에서 5번째 액션으로 명시 |
| 6 | v1 옛 row 호환 (Vision LegacyV1View) | `vision-result/LegacyV1View.tsx` | 안 그림 | **유지** (positivePrompt 빈 row) |
| 7 | sourceRef NULL 옛 Edit row toast | `EditRightPanel.tsx:120-134` | 안 그림 | **유지** |
| 8 | MetricsPopover hover-stay-open + 키보드 | (NEW) | 항상 노출 | **bridge ::before + transition-delay 0.15s + `:focus-within` + close timer + Esc** (Codex 🟡 보강) |
| 9 | MockBadge / StatusChip 조건부 노출 | `AppHeader.tsx:70-95`, `SystemStatusChip.tsx` | 항상 | **production 조건 유지** (USE_MOCK / running grace) |
| **10** ⭐NEW | **PromptToggle combined/split + A1111 호환 통합 복사** | `vision-result/PromptToggle.tsx:23` | PROMPT/NEGATIVE 단순 토글 | **combined/split 토글 + `combinedText` (A1111) + 통합 복사 보존 필수** (Codex 🔴 — 색 톤만 추가) |
| **11** ⭐NEW | **V5 시각 대상 inline style → className 점진 전환** | 5 mode 좌/우 패널 카드/헤더/CTA/action bar 본체 | className 만 사용 | **Phase 1.5~7 각 단계마다 V5 시각 대상 inline style 잔여 0 검증** (Codex 1차 🟡 + 2차 🟡 범위 좁힘 — 동적 계산 compareX/dynamicHeight/motion style 은 허용) |

---

## Pending Decisions (모두 클로즈 ✅ — 위 "확정 결정" 섹션 참조)

ⓐ~ⓔ 모두 확정 (2026-05-02). Codex 1차 리뷰 반영 끝 → Codex 2차 리뷰 후 적용 시작.

---

## 결정 항목 누적 (메모리 박제 A~K + ⓐ~ⓔ + L~R)

### 시안 단계 결정 (이미 박제)

| # | 결정 | 적용 위치 |
|---|---|---|
| A | Edit 카드 순서: AI → 자동평가 → 퀄리티 | EditLeftPanel.tsx (Phase 1.5.3) |
| B | Video 카드 순서: 영상해상도 맨 아래 | VideoLeftPanel.tsx (Phase 1.5.4) |
| C | 자동 평가 → 카드 패턴 격상 | EditLeftPanel.tsx (Phase 1.5.3) |
| D | 영상 해상도 → 카드 패턴 격상 | VideoLeftPanel.tsx (Phase 1.5.4) |
| E | 속도 chip 4단계 그대로 | VideoLeftPanel.tsx (이미 OK) |
| F | Compare CTA 상단 이동 | CompareLeftPanel.tsx (Phase 1.5.5) |
| G | PromptToolsResults 그대로 (시안 X 정합) | 없음 |
| H | Vision Analyze CTA 상단 이동 | vision/page.tsx (Phase 1.5.6) |
| I | framer-motion 도입 | 이미 설치 (Phase 1.5.7 활성 카드 spring) |
| J | 추가 참조 fuchsia 분리 | EditLeftPanel.tsx (Phase 1.5.3) + globals.css (Phase 1.1) |
| K | **CTA shortcut 표시 제거 + 기능 미구현 유지** (v4 정정) | 5 패널 모두 (Phase 1.5.2~6) |
| **L** | **너비 정책 — 박스 + max-width: min(95vw, 1600px) cap** | StudioLayout.tsx (Phase 3 재설계) |
| **M** | **AppHeader 정리 — HomeBtn 흡수 / 영문 nav 6 chip / Fraunces italic / spring** | AppHeader.tsx + Chrome.tsx (Phase 2) |
| **N** | **SystemMetrics 호버 팝오버 (옵션 A) + 접근성 보강** | SystemMetrics.tsx + MetricsPopover.tsx 신설 (Phase 2) |
| **O** | **Hero/Tile Action Bar 어두운 frosted glass 통일 + 4 버튼 (download 제거)** | ResultHoverActionBar.tsx + Edit/Generate ResultViewer (Phase 4/5) |
| **P** | **Result Header pill duration 제거** (생성 duration schema 미저장) | StudioResultHeader.tsx (Phase 4) |
| **Q** | **Archive 통합 헤더 (count + size chip · HistoryStats API)** | HistorySectionHeader.tsx + 새 useHistoryStats 훅 (Phase 4) |
| **R** | **selected tile 강화 (흰 2px ring + violet 4px ring + 칩 라벨)** | HistoryTile.tsx (Phase 4) |

---

## 백엔드 정합성 보장

5 endpoint × 모든 입력 시안 100% 커버 확인 완료 (2026-05-01 점검 + 2026-05-02 페어 확인):
- `POST /api/studio/generate` (GenerateBody)
- `POST /api/studio/edit` (multipart)
- `POST /api/studio/video` (multipart)
- `POST /api/studio/vision-analyze` (multipart)
- `POST /api/studio/compare-analyze` (multipart)

**UI 변경만** — 백엔드 schema 변경 0건. 가짜 추가 0건.

**데이터 모델 격차 (시안 X · 미적용)**:
- 생성 duration (`HistoryItem.durationMs`) 미저장 — Result Header pill 에서 제거
- 개별 이미지 size 미저장 — Result Header pill 에서 제거
- 모드별 전체 size — `/api/studio/history/stats.byMode.generate.sizeBytes` 이미 있음 → Archive Header 활용

---

## 검증 기준

- **`cd backend; pytest tests/` → 405 PASS** (CLAUDE.md 표준 명령 · 백엔드 회귀 0)
  - reference: project root collect = 469 (legacy 4 파일 포함 · Codex 가 본 숫자)
- **vitest 165 PASS** (스토어/훅 변경 X — UI only · v3 정정)
- tsc clean (frontend type 검증)
- ESLint clean
- 5 페이지 수동 검증 (Chrome MCP) — 시안 페어 시각 일치 + 인터랙션 정상
- 회귀 위험 **11 항목** 모두 보존 확인 (v3 +2)
- **V5 시각 대상 inline style 잔여 0** (카드/헤더/CTA/action bar 본체 · 동적 계산은 허용 · v4 범위 좁힘)

---

## Codex 리뷰 체크포인트 (Phase 별 추천 · v3 +1회)

큰 plan 정확도 보장 (메모리 `feedback_codex_iterative_review.md` 참조):

- **Phase 1.5 후 → 좌측 패널 정확도 (결정 A~K 1:1 매칭) 검증** ⭐NEW (Codex 🔴)
- Phase 1 후 → globals.css + 페어 시안 CSS 일관성 리뷰 (`.ais-*` 네임스페이스 통일 검증)
- Phase 2 후 → AppHeader + ModeNav + MetricsPopover 통합 정합 점검 (1024px 충돌 + 접근성)
- Phase 3 후 → StudioWorkspace frame 합치기 grid 무손상 검증
- Phase 4 후 → Generate 우측 시안 vs 실제 매칭
- Phase 5-7 후 → Edit / Vision / Compare 우측 매칭 + 회귀 위험 11 항목 보존 확인 (특히 #10 PromptToggle)
- Phase 8 후 → 전체 회귀 검토

---

## 참고 자산

- 시안 페어 (4 파일) — `docs/design-test/pair-{generate,edit,vision,compare}.html`
- cards-v2.html — 좌측 패널 5 갤러리 (옛 시안 픽스)
- **16 webp 카드 배경** — `docs/design-test/assets/card-bg-*.webp` × 8 base + 8 @2x (+ adult-alts/ 5 alternative)
- 현재 plan v1 → v2 → **v3 (Codex 1차 리뷰 반영)** ← 이 문서
- Codex 1차 리뷰 텍스트 — 인계 메모리 `project_session_2026_05_02_pair_designs_plan_v2.md` 참조

---

## 메모리 참조

- `project_design_v5_pending_decisions.md` — A~R 결정 + 회귀 위험 + 백엔드 정합성
- `project_session_2026_05_02_design_v5_fixed.md` — 시안 픽스 세션 인계
- `project_session_2026_05_02_pair_designs_plan_v2.md` — 페어 4 + plan v2 인계 (이 v3 의 직전)
- `feedback_design_v5_iteration_workflow.md` — cards-v2.html 픽스 전까지 frontend/ 안 건드림
- `feedback_design_v5_personal_tool_intent.md` — 화려 + 인물 강조 정체성
- `feedback_design_v5_backend_parity.md` — 백엔드 기능 100% 보존
- `feedback_codex_iterative_review.md` — Codex iterative review 패턴 (큰 plan 의 정확도 보장)
