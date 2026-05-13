# Changelog

> 누적 변경 로그 — 완료된 작업의 역사적 기록.
> 최신 변경 + 활성 정책은 `CLAUDE.md` 참조. 자세한 작업 내역은 git log + memory.

## 2026-05-13

- Video CTA / 입력 게이트 정리 — 자동 NSFW 실제 게이트를 `adult && autoNsfwEnabled` 로 통일하고, 영상 지시 입력 경로·AI 보강 카드·PromptModeRadio·Ollama 의존성 가드를 같은 조건으로 동기화. 관련 spec: `docs/superpowers/specs/2026-05-13-video-cta-input-gating-design.md`.

## 2026-05-02 (저녁)

### 디자인 V5 시안 vs React 차이점 fix — 사용자 검증 라운드

세션: 사용자가 시안 (`docs/design-test/pair-generate.html`) 과 실제 React 비교하면서 짚어준 차이점들 차례로 fix.
세션 인계: `memory/project_session_2026_05_02_design_v5_user_verification_round.md`

**Generate 좌측 (V5 카드 시그니처 정합)**:
- AI 프롬프트 보정 segmented (instant/thinking) — 활성 카드 wrapper 흰 반투명 + blur (옛 검정 0.04 → 인물 webp 위 묻힘 fix · `globals.css` `.ais-toggle-card[data-active="true"] .ais-prompt-mode-segmented`)
- 퀄리티 모드 라벨 고정 ("⚡ 빠른 모드" / "💎 퀄리티 모드" 동적 → "💎 퀄리티 모드" 고정 · 시안 `:2239`)
- 사이즈 카드 헤더 재구조화 — Field 라벨 → `.ais-size-header` (40px rose 그라데이션 아이콘 + title + chip · `:2247`)
- AspectCard rose-pink 시그니처 + AspectCard active 솔리드 흰 배경 (`var(--card-glow)` → `var(--surface)`) + position/z-index 강제 (인물 webp 위)
- DimInput disabled 시 `opacity: 0.5` → 텍스트 색만 회색 (배경 솔리드 유지)
- lock 버튼 active 배경 솔리드 흰 (옛 옅은 rose 묻힘 fix)
- 카드 hover 툴팁 — V5MotionCard `tooltip` prop + `.ais-toggle-card[data-tooltip]:hover::after` + `:has()` z-index 50

**Generate 우측 (헤더 + 카운트)**:
- StudioResultHeader title `생성 결과 · Generated` → `결과 · Latest` + invisible spacer div (좌/우 점선 정렬 · CSS HMR 우회)
- ResearchBanner `icon="search"` + desc 제거 (시안 v7)
- StudioModeHeader 구조 변경 — eyebrow 별도 행 (옛 mode-title-row 안 nested div → flex baseline 정렬 영향)
- Meta pills 미선택 시 PNG fallback null (옛 dummy chip 제거)
- 보관 카운트 source: store length → `useHistoryStats().byMode.X.count` (DB 정확값) — Generate/Edit/Video 모두 적용
- HistoryBootstrap fetch 정책: `listHistory({limit:100})` × 1 → mode 별 병렬 `Promise.all([generate, edit, video], limit:1000)` — mode 간 cap 충돌 회피 (예: edit 가 100 채우면 generate 0)
- HistoryGallery wrapper padding 4px (selected tile box-shadow 4px violet ring 의 좌/우/상/하 가장자리 잘림 fix)

**Edit 좌측 (카드 클릭 + 시그니처 + tooltip + icon-box)**:
- 4 카드 (AI/자동 분석/퀄리티/Multi-ref) onClick 추가 (옛 카드 자체 클릭 안 먹는 문제 fix)
- 라벨 단순화: "수정 후 자동 비교 분석" → "결과 자동 분석" / "빠른 모드" 동적 → "💎 퀄리티 모드" 고정 / "(실험적)" 제거
- desc 제거 (시안 v7 — Generate 와 동일 패턴)
- 자동 분석 카드 클래스 `ais-auto-compare-card` → `ais-sig-claude` (Generate Claude 와 동일 amber 시그니처 + `card-bg-claude.webp`)
- 4 카드에 `tooltip` prop 박음 (Generate 동일)
- 4 카드에 icon-box 추가 (`stars`, `search`, `bolt`, `image`)
- AI 카드 disabled opacity `0.7` → `1` 강제 (`.ais-toggle-card.ais-sig-ai[data-active="true"] > * { opacity: 1 !important }`) — Generate 와 시각 통일

**Edit 우측 (BeforeAfter 정합 시도 + SourceImageCard 시안 매칭)**:
- SourceImageCard 재구성 — 시안 매칭:
  - 옛 좌상단 ⓘ + 좌하단 사이즈 칩 제거 → 하단 frosted bar (좌 파일명 + 우 `1672 × 941 · PNG`)
  - 옛 [변경][x] 텍스트 pill → **둥근 frosted glass icon-only 2개** (refresh + x · 30×30)
  - frosted bar alpha 0.55 → 0.35 + blur 12 → 14
- BeforeAfterSlider — `afterFit`, `afterScaleX`, `autoMatchAspect` prop 신설 (default contain — 회귀 0)
  - 슬라이더 정합 fix 시도 — wrapper aspect = 원본 + 둘 다 contain (사용자 만족 · "지금 로직이 제일 좋아보인다")
  - autoMatchAspect 자동 측정 (onLoad + ResizeObserver + Guard ±15%) — 결국 비활성. 4% ComfyUI megapixel 미세 차이는 시각 인지 영역 밑이라 transform 보정 안 함
- result-header invisible spacer div (좌/우 점선 정렬)
- ResultHoverActionBar 진하기 alpha 0.55 + blur 22 (옛 0.32 + 18 너무 옅음 fix)

**Codex 미사용 (사용자 직접 진단 패턴)**:
- 사용자가 화면 캡처 + DevTools 진단 명령으로 직접 짚는 패턴 — Codex 호출 없이 1:1 fix
- 메모리 박제 — `memory/feedback_design_v5_no_spec_lookup.md` (시안 file 직접 보지 말고 사용자 말로만 수정)

**검증**: TSC clean (모든 fix 후 `tsc --noEmit` exit 0). pytest/vitest 미실행 (CSS + UI 전용 변경).

**HMR Known Issue 학습**: Next.js 16 + React 19 + globals.css 조합에서 *server-side module 캐시* stale → Hard reload 무관. 해결 — dev 서버 재시작. 작업 워크플로우: 가능한 React/inline style 위주 (HMR 안정), CSS class 변경은 한 박자 늦음 감안.

---

## 2026-05-02

### 디자인 V5 — Phase 4~8 branch 적용 (우측 패널 + cleanup · master 미반영)

**branch**: `feature/design-v5` (8 commit · master 대비 +9 · master merge 대기)
**plan**: `docs/superpowers/plans/2026-05-02-design-v5-react-application.md` (v4 · 우측 패널 격상)

**Phase 4 — Generate 우측 (Archive Header + Caption + 4 버튼 + violet ring)**:
- 공용 5 컴포넌트 격상 (Fraunces italic 26 bilingual + V5 토큰 cascade · `.ais-*` 전환):
  - StudioResultHeader (eyebrow `IMAGE STUDIO · RESULT` + violet `<strong>` + meta pills)
  - HistorySectionHeader → Archive Header (점선 border-top + count chip + size chip)
  - SectionHeader (Fraunces italic bilingual `<strong>오늘</strong> · Today` + KNOWN_EN 매핑 내장)
  - HistoryTile (violet ring 4 + `● 선택` 칩 + 4 버튼 — 복사 추가 · onCopy default = prompt)
  - ResultHoverActionBar (variant prop "hero" | "tile" + frosted glass CSS 이전)
- Generate 전용 + 신규 훅:
  - GenerateResultViewer (4 버튼 · download 제거 · Caption italic prompt 1줄 truncate)
  - GenerateRightPanel (titleEn=Generated + Archive sizeBytes + useHistoryStats)
  - useHistoryStats 신규 (items.length 변화 800ms debounce refetch)
- Codex 2 라운드 fix: ActionBarButton inline 0 (data-attribute 분기) + Hero `.ais-result-hero` className + `:hover` 룰 정리 + img anti-drag CSS 이전
- 회귀 보존: HistoryGallery ResizeObserver 자동 컬럼 (#1) / Hero wheel zoom + drag pan (#2) / focus-within 키보드 (#3)

**Phase 5 — Edit 우측 (Hero matt + BEFORE/AFTER + Comparison amber + Caption + canPromote)**:
- 매트지 Hero `.ais-result-hero .ais-result-hero-edit` className
- BeforeAfter slider — `.ais-ba-slider` className + `.ais-ba-label-before/-after` (CSS text-transform: uppercase)
- Action Bar 4 버튼 (download → copy) + canPromote=true 시 5번째 "라이브러리 저장" 보존 (#5)
- Caption 슬롯 (italic afterItem.prompt 1줄 truncate)
- ComparisonAnalysisCard filled state V5 amber + data-tone 분기 + score 숫자 제거 (시안 톤)
- EditRightPanel: titleEn=Edited + meta pills + sizeBytes (useHistoryStats edit)
- Codex 1 라운드 fix: 모든 state V5 className + 자식 inline → CSS + a11y aria-label (axis "얼굴 92% — 일치")
- 회귀 보존: BeforeAfter 드래그 핸들 (#4) / canPromote (#5) / sourceRef NULL toast (#7)

**Phase 6 — Vision 우측 (Summary 한/영 분기 + PromptToggle 색 톤 + Detail Cards + 새 history-tile)**:
- SummaryCard `data-lang` 분기 — 한글 = Pretendard / 영문 = Fraunces italic 13.5
- **PromptToggle 회귀 #10 보존 ⚠** — combined/split toggle + A1111 호환 `combinedText` (positive\\n\\nNegative prompt: negative) + 통합 모드 복사 버튼 모두 보존. 색 톤만 추가 (POSITIVE green #2D7A2D / NEGATIVE red #B8232C)
- DetailCard className `.ais-vision-detail-card` + data-muted
- RecipeV2View grid `.ais-vision-detail-grid` (auto-fit minmax 260)
- VisionHistoryList: 새 vision-history-tile 패턴 (썸네일 88 + 본문 mono meta + Fraunces italic summary 2-line truncate) · 2-col 고정 grid · gridCols/cycleGrid props 제거
- vision/page.tsx: titleEn=Analysis + meta pills (해상도 violet + EN+KO mono)
- LegacyV1View 회귀 #6 보존 (positivePrompt 빈 row 자동 폴백 — VisionResultCard isV2 분기 변경 0)
- Codex 1 라운드 fix: CSS 중복 정리 + 통합 모드 negative label 색 #B8232C 통일

**Phase 7 — Compare 우측 (A/B 그라데이션 + 5축 + Transform/Uncertain V5)**:
- BeforeAfterSlider `labelVariant?: "before-after" | "ab"` prop 신규 — Phase 5 nit 박제 활용
  - "before-after" (default · Edit/Lightbox 호환) → V5 검은 톤
  - "ab" (Compare) → V5 violet/amber 그라데이션 (`.ais-ba-label-a/-b`)
- CompareViewer: labelVariant="ab" 명시 → V5 시그니처 자동
- CompareAnalysisPanel: 외곽 `.ais-compare-analysis-card` + 헤더 `.ais-cac-header / -title / -overall-chip` (violet gradient) + AxisRow `.ais-axis-*` data-tone (≥80 green / ≥60 amber / <60 gray)
- CompareExtraBoxes: TransformPromptBox V5 violet gradient + UncertainBox V5 amber gradient
- Codex 1 라운드 fix: uncertain-body className 제거 (cascade 충분) + tp-context-meta ellipsis 추가 + plan §8 박제 (AxisRow role="meter" cleanup 후보)

**Phase 8 — Cleanup + 회귀 (dead CSS 제거 + 정통 disclosure + role="meter")**:
- A: `.ais-magic-prompt-card` dead CSS 제거 (Phase 1.5 후 사용 0)
- B: `.ais-range-input` dead selector 제거 (var cascade 채택 후)
- C: SystemMetrics 정통 disclosure — `<button>` + aria-expanded + onClick toggle (옛 ESLint role="group" 충돌 해소)
- D: AxisRow role="meter" + aria-valuenow/min/max 정통 a11y
- E: VisionHistoryList 헤더 V5 Archive Header 통일 — **옵션 B 채택** (Vision 전용 옛 시각 보존 · plan §8 후속 plan 후보 박제)

**검증 (Phase 4~8 누적 회귀 0)**:
- backend pytest **405 / 405 PASS** (CLAUDE.md 표준)
- frontend vitest **165 / 165 PASS**
- TSC clean / ESLint 0 warning

**다음 단계**: master merge `--no-ff` (오빠 승인 후) — Phase 0~3 에 이어 우측 패널 + cleanup 박제.

---

### 디자인 V5 — Phase 0~3 master merge (좌측 패널 + Chrome + Layout)

**master**: `d6b000a` (merge --no-ff · 10 commit + merge commit · 89 files / +21,563 / -847)
**branch**: `feature/design-v5` 보존 (Phase 4~7 우측 패널 다음 세션 이어서)
**plan**: `docs/superpowers/plans/2026-05-02-design-v5-react-application.md` (v4 · 541줄 · Codex 1+2차 리뷰 반영)

**Phase 0 — 사전 준비**:
- branch `feature/design-v5` 분기 (master 영향 0)
- 16 webp 카드 배경 자산 복사 (`frontend/public/studio/cards/`)
  - `card-bg-{ai,fast,claude,auto-compare,size,multi-ref,video-res,adult}.webp` × 2 (@2x)
- framer-motion `^12.38.0` 검증 (이미 설치)

**Phase 1 — Foundation (CSS only · +1709줄)**:
- V5 시그니처 컬러 토큰 8세트 × 4 var = 32 var (`--card-{from,to,glow,shadow}-X`)
- 활성 카드 효과 토큰 (padding 14→38 / mask 35→15 / 0.35s spring)
- `.ais-mode-header` (Fraunces italic 26 bilingual + 점선 border)
- `.ais-cta-primary` V5 Aurora Glass override (violet→blue + light sweep 0.7s)
- 8 카드 패턴 (`.ais-toggle-card` 베이스 + `.ais-sig-{ai,fast,claude}` modifier · `.ais-{auto-compare,multi-ref,video-res,adult,size}-card` 단독)
- 페어 우측 시안 CSS (Result Header/Hero/Caption + Archive Header + History Section/Tile + BeforeAfter Slider + Comparison Card + Compare 5축 + Vision Summary/PromptToggle/Detail)
- AppHeader CSS (`.ais-app-header` + `.ais-ah-nav` + `.ais-ah-metrics-popover` frosted glass)
- `.ais-studio-workspace` frame (Phase 3 재설계 — 1024~1279 grid 풀폭 / 1280+ max-width: min(95vw,1600px) 박스)
- Codex 1차 리뷰 fix: 음수 letter-spacing 10 → 0 / @2x image-set Retina 지원

**Phase 1.5 — 좌측 패널 5 mode 적용 ⭐**:
- `StudioModeHeader` 새 prop signature (`titleKo`/`titleEn`/`eyebrow` + 옛 `title` alias)
- Generate 좌측 (3 V5 카드: sig-ai/sig-claude/sig-fast + size-card-v)
- Edit 좌측 (4 V5 카드 + 카드 순서 결정 A: AI→자동평가→퀄리티→multi-ref · 성인 X · Codex 2차 정정)
- Video 좌측 (4 V5 카드 + 카드 순서 결정 B: AI→퀄리티→성인→영상해상도 맨 아래 · 속도 chip 4단계 video-res-card 내부 유지)
- Compare 좌측 (CTA 상단 sticky 결정 F)
- Vision 좌측 (CTA 상단 sticky 결정 H)
- 5 패널 CTA shortcut 표시 제거 (결정 K) + CTA 텍스트 영문 통일
- `V5MotionCard.tsx` 신규 (motion outer + .ais-toggle-card inner 분리 · spring stiffness 320 / damping 26)
- Codex 2차 리뷰 fix: Range 시그니처 색 (`--ais-range-accent` var fallback) / motion outer/inner 분리 (transform race 회피)

**Phase 2 — Chrome**:
- `AppHeader` HomeBtn 좌측 제거 → ModeNav 첫 chip 흡수
- `ModeNav.tsx` 신규 (6 chip · Fraunces italic 13 + spring 통통 + `/vision/compare` exact priority + `/prompt-flow/{generate,edit,video}` mode 매핑)
- `Chrome` Logo Fraunces italic 14
- `MetricsPopover.tsx` 신규 (frosted glass dropdown · 4 metric row + VRAM ≥80% breakdown)
- 접근성 4중 hover-stay-open (:hover / :focus-within / [data-open] / popover :hover) + ::before 10px bridge + close timer 200ms + Esc focus return
- Codex 3차 리뷰 fix: `/prompt-flow/*` 활성 매핑 + Esc focus return (blur 제거)
- Codex 4차 리뷰 fix: prompt-flow chip 클릭 시 mode 화면 라우팅 회복

**Phase 3 — Layout (1024 viewport 수학 검증)**:
- `StudioWorkspace` 에 `.ais-studio-workspace` className 추가
- 1024 viewport: frame 없이 grid 풀폭 (좌 400 + 우 624 = 1024 정확 fit)
- 1280 viewport: `min(95vw,1600)` = 1216px > grid 1024 + padding 48 + border 2 = 1074px → 142px 여유
- 1920+: 1600px cap (28인치 모니터 양 옆 빔 자연)

**검증** (master 회귀 0):
- TSC clean / ESLint 0 warning
- pytest 405/405 PASS · vitest 165/165 PASS
- next build (Turbopack) 14 routes prerendered

**다음 세션** (Phase 4~8):
- Phase 4 Generate 우측 (Caption + Archive Header + selected ring + 4 버튼 action bar)
- Phase 5 Edit 우측 (BeforeAfter Hero matt + Comparison Card amber + canPromote 5번째 액션)
- Phase 6 Vision 우측 (Summary 한/영 분기 + PromptToggle combined/split 보존 · 회귀 #10)
- Phase 7 Compare 우측 (A/B violet/amber 그라데이션 + 5축 + Transform/Uncertain)
- Phase 8 cleanup + 회귀 + master merge

**Phase 8 cleanup 후보** (`project_pending_issues.md` 박제):
- `.ais-magic-prompt-card` dead CSS (Phase 1.5 후 사용처 0)
- `.ais-range-input` dead selector (`--ais-range-accent` cascade 패턴 채택 후 0)
- SystemMetrics trigger 정통 disclosure 패턴 (`<button>` + onClick toggle + aria-expanded ESLint 통과)

---

## 2026-05-01

### 디자인 V5 — 5 패널 풀 시안 (좌측 패널 리디자인 · 시안 단계 · master 미반영)

**위치**: `docs/design-test/cards-v2.html` (1500+ 줄) · `docs/design-test/README.md`

**5 패널** (V5 Aurora Glass — frosted blur + 카드 전체 클릭 + hover 툴팁):
- 생성 (Generate) — 프롬프트 → Qwen Image · final fix
- 수정 (Edit) — 실제 EditLeftPanel.tsx 매칭 (참조 ON sub-section 포함)
- 분석 (Vision Analyze) — 간소 (이미지 + CTA + 안내)
- 비교 (Vision Compare) — A/B 슬롯 + 스왑 + 비교 지시
- 영상 (Video Generate) — LTX-2.3 i2v · 영상 해상도 (사이즈 카드 패턴 재사용)

**시그니처 6 컬러**:

| from → to | 카드 |
|---|---|
| violet `#8B5CF6` → blue `#3B82F6` | AI 보정 |
| amber `#F59E0B` → orange `#FB923C` | Claude 조사 / 결과 자동 평가 (페어) |
| lime `#84CC16` → cyan `#06B6D4` | 퀄리티 모드 |
| rose `#F43F5E` → pink `#EC4899` | 사이즈 / 추가 참조 / 영상 해상도 (트리오) |
| crimson `#DC2626` → red `#F87171` | 성인 모드 |
| (legacy) teal `#14B8A6` → emerald `#10B981` | 옛 자동평가 — 사용 X |

**이미지 7장** (ChatGPT image 2.0 · 16:9 · rule of thirds 우측 1/3 · K-pop 인물 · Vogue Korea 톤):
- card-bg-{ai, claude, fast, size, multi-ref, auto-compare, adult}.webp (@1x + @2x · 평균 25-50KB)
- 자동화: `resize_cards.py` (PIL · 원본 → raw 백업 + WebP)

**카드 패턴**:
- 카드 전체 클릭 = ON/OFF 토글 (토글 스위치 *제거*)
- desc 텍스트 *제거* + hover 검정 pill 툴팁 (data-tooltip)
- 비활성 카드 segmented `display: none`
- 비활성 이미지 `opacity 0.28 · saturate 0.4 · brightness 0.92`
- 활성 텍스트 `ink + 600 굵기`
- segmented 반투명 (`rgba 0.7 + backdrop-blur 8px`)

**라벨 이모지 통일** (5 패널 일관):
- 🪄 AI 프롬프트 보정 / 🔍 Claude 프롬프트 조사 / 📊 결과 자동 평가
- 💎 퀄리티 모드 (다이아 ◆ 아이콘 — 번개 → 변경)
- 🖼️ 추가 참조 이미지 / 🔞 성인 모드

**상세 인계**: `memory/project_session_2026_05_01_design_v5_5panels.md`

**다음 단계**: 오빠 시안 검토 → React 적용 plan (`/pdca plan generate-edit-leftpanel-v5-redesign` · 추정 6-8h).

---

### Prompt Tools Reasoning Modes Phase 1~5 + Codex 2라운드 fix + M2 보강 (master `b37b638`)

**검증**: backend pytest **405 PASS** · frontend vitest **150 PASS** · tsc/ESLint clean · 회귀 0건

6 commit (Phase 1~5 + Codex Phase 4/5 리뷰 fix + spec 갱신 + M2 자동 Compare 정밀 모드 사용자 인지 보강).

**핵심**:
- Phase 1~4: 프롬프트 reasoning modes (instant/thinking) · clarify_edit_intent + upgrade 분기
- Phase 5: 프롬프트 도구 (번역/분리) + 양방향 번역 (KO ↔ EN)
- M2 결정: Edit Compare 자동 트리거 — 옵션 A + 부분 C 하이브리드 (toast.info 한 줄)
- spec: `docs/superpowers/specs/2026-05-01-prompt-tools-reasoning-modes-design.md` §13.2 (Codex 2라운드 review · 알려진 이슈 박제)

**상세**: `memory/project_session_2026_05_01_prompt_tools_phase_1_5_impl.md`

## 2026-04-30

### Phase 4.5 — backend `comfy_api_builder.py` 1197줄 4 sub-module 분할 (current master · Phase 4 시리즈 마무리)

**검증**: backend pytest **361 PASS** · ruff clean · frontend vitest **91 PASS** · tsc / ESLint clean · 회귀 0건

선행 commit: master `c8176e1` (Phase 4.4 comparison_pipeline 분할). plan v2 (사용자 codex 1차 리뷰 2 Blocking 반영) 따라 단계적 진행.

**plan v2 핵심 결정 (codex C1+C2 fix)**:
- C1 Blocking: `_common.py` 가 `log = logging.getLogger(__name__)` 명시 + edit.py 가 `from ._common import log` (`build_edit_api` L430 의 `log.info(...)` 호환) — 모든 sub-module 공유 logger 패턴
- C2 Blocking: `_common.py` 에 `from ..presets import LoraEntry` 명시 (`_build_lora_chain` L149 type annotation 의존)

**5 commit 흐름** (단계별 — Phase 4 시리즈 중 가장 단순):
1. `c34b480` — 단계 1: file → package + presets import `..` 갱신
2. `4540a92` — 단계 2: `_common` 그룹 분리 (types + log + 7 헬퍼)
3. `aebb5a8` — 단계 3: `generate` 분리 (Qwen Image 2512 text2img)
4. `31c426c` — 단계 4: `edit` 분리 (Qwen Edit 2511 + multi-ref)
5. `94a4da8` — 단계 5: `video` 분리 (LTX Video 2.3 i2v) + facade 정리 + `__all__` 24 항목

**규모**:
- 옛 `studio/comfy_api_builder.py` 1197줄 → 5 파일 (총 1,330줄, +133줄 헤더/sub-module 보일러):
  - facade `__init__.py` 91줄 (pure re-export + `__all__` 24 항목)
  - `_common.py` 169줄 (ApiPrompt/NodeRef + log + 7 헬퍼)
  - `generate.py` 213줄 (GenerateApiInput + build_generate_*)
  - `edit.py` 401줄 (EditApiInput + build_edit_api dispatcher + multi-ref + build_edit_*)
  - `video.py` 456줄 (_build_video_lora_chain + build_video_from_request — LTX-2.3 2-stage)

**patch site 0건** — Phase 4 시리즈 중 가장 안전한 phase. test 모두 직접 import + 실제 호출 (mock 없음). production import 5 site + test direct import 7 site 모두 facade re-export 통과.

**효과**:
- 3 빌더 흐름 (Generate / Edit / Video) 분리 → 단일 책임
- 공용 7 헬퍼 _common 응집 — 재사용성 명시
- production import 5 site (pipelines/edit + generate + video + _dispatch + routes/prompt) 무손상

### Phase 4 시리즈 마무리 (4.1 → 4.5)

| Phase | 대상 | 옛 줄 수 | 분할 결과 | patch site |
|---|---|---|---|---|
| 4.1 | history_db.py | 886 | 7 파일 | 11 |
| 4.1.1 | helper 추출 | (작음) | replace_reference_ref_if_current | - |
| 4.2 | vision_pipeline.py | 1131 | 4 파일 | 44 |
| 4.3 | prompt_pipeline.py | 975 | 5 파일 | 36 |
| 4.4 | comparison_pipeline.py | 1046 | 4 파일 | 15 |
| 4.5 | comfy_api_builder.py | 1197 | 5 파일 | 0 |

**총 5,235줄 → 25 파일** (각 파일 평균 ~209줄). 옵션 D 일관 적용. patch site 106건 모두 sub-module path (flat patch 0건).

### Phase 4.4 — backend `comparison_pipeline.py` 1046줄 3 sub-module 분할

**검증**: backend pytest **361 PASS** · ruff clean · frontend vitest **91 PASS** · tsc / ESLint clean · 회귀 0건

선행 commit: master `e44f483` (Phase 4.3 prompt_pipeline + fastapi/pydantic pin + WPS433 cleanup). plan v2 (사용자 codex 1차 리뷰 4 finding 반영) 따라 단계적 진행.

**plan v2 핵심 결정 (codex C1+C2+M1+M2 fix)**:
- C1 Blocking: `_translate_comments_to_ko` patch 7건 갱신 시점을 단계 4 → **단계 2** 로 이동 (단계 2 commit 안에 함수 이동 + facade `_c.X` lookup + patch 7건 모두 한 묶음)
- C2 Blocking: `_COMPARE_HINT_DIRECTIVE` 분류 v3 → **v2_generic** (`_call_vision_pair_generic` L865 가 사용 — 실제 사용처 grep 실증)
- M1 Minor: production import "4 site" → **3 site** 통일
- M2 Minor: `__all__` stale fix (_COMPARE_HINT_DIRECTIVE 위치 + SYSTEM_COMPARE 중복 제거)

**4 commit 흐름 (단계별)**:
1. `4373386` — 단계 1: file → package + internal import 6 site `..` 갱신
2. `acb6764` — 단계 2: `_common` 그룹 분리 (axes / dataclass / 5축 헬퍼 / 번역) + patch 7 site 즉시 갱신 (codex C1 fix)
3. `158d8ee` — 단계 3: `v3` 분리 + patch 8 site 갱신
4. `4e75a36` — 단계 4: `v2_generic` 분리 + `_COMPARE_HINT_DIRECTIVE` 재배치 (codex C2 fix) + facade 정리 + `__all__` 29 항목

**규모**:
- 옛 `studio/comparison_pipeline.py` 1046줄 → 4 파일 (총 1,194줄, +148줄 헤더/sub-module 보일러):
  - facade `__init__.py` 95줄 (pure re-export + `__all__` 29 항목)
  - `_common.py` 318줄 (axes 정의 + ComparisonSlotEntry/ComparisonAnalysisResult dataclass + _empty_*/_to_b64 + _coerce_*/_compute_overall + _TRANSLATE_SYSTEM/_translate_comments_to_ko + _coerce_score/_parse_strict_json alias)
  - `v3.py` 405줄 (SYSTEM_COMPARE + _call_vision_pair + _coerce_intent/_coerce_v3_slots/_v3_overall + analyze_pair)
  - `v2_generic.py` 376줄 (SYSTEM_COMPARE_GENERIC + _COMPARE_HINT_DIRECTIVE + _call_vision_pair_generic + analyze_pair_generic)

**patch site 15건 모두 sub-module path 갱신** (flat patch 0건 · grep 실증):
- `v3._call_vision_pair`: 8
- `_common._translate_comments_to_ko`: 7

**효과**:
- v3 매트릭스 비교 (Edit context) 와 v2 generic 비교 (Vision Compare 메뉴) 분리 → 단일 책임
- 공용 axes / dataclass / 헬퍼 / 번역 _common 응집 — 재사용성 명시
- production import 3 site (router / routes/compare / pipelines/compare_analyze) 무손상

### Phase 4.3 — backend `prompt_pipeline.py` 975줄 4 sub-module 분할

**검증**: backend pytest **361 PASS** · ruff clean · frontend vitest **91 PASS** · tsc / ESLint clean · 회귀 0건

선행 commit: master `e2546e0` (Phase 4.2 vision_pipeline 분할). plan v2.1 (사용자 codex 1차 리뷰 5 finding + 후속 stale 3건 반영) 따라 단계적 진행.

**plan v2 핵심 결정 (codex C1+C2+I1+I2+M1 fix)**:
- C1 Blocking: 단계 1 안에서 `from ._ollama_client` → `from .._ollama_client` 즉시 갱신 (Phase 4.2 C1 동일 함정)
- C2 Blocking: `vision_pipeline/edit_source.py` lazy import 2 site (L174/L513) 도 `from ..prompt_pipeline.translate import clarify_edit_intent` 로 변경. facade re-export 가 함수 reference snapshot 이라 submodule patch 가 facade attribute 까지 갱신 못함 → 호출 site 자체를 submodule 직접 import 로 변경해야 patch 일관 동작
- I1 Important: `_call_ollama_chat` patch 8건 → 실제 grep **10건** (test_edit_vision_analysis 4 + test_prompt_pipeline 2 backend prefix + test_video_pipeline 4)
- I2 Important: `clarify_edit_intent` patch 17건 → 실제 grep **16건** (import 라인 제외)
- M1 Minor: production import "8 site" → **11 site** 통일

**5 commit 흐름** (단계별):
1. `fb1d7e5` — 단계 1: file → package + `_ollama_client` import depth 갱신
2. `8c4f4c7` — 단계 2: `_common` 그룹 분리 (UpgradeResult / _strip_repeat_noise / _DEFAULT_OLLAMA_URL / DEFAULT_TIMEOUT / log)
3. `8cd260c` — 단계 3: `_ollama` 분리 + facade 호출자 `_o.X` lookup 변경 + patch 10 site 갱신
4. `48a7647` — 단계 4: `translate` 분리 + edit_source.py lazy import 2 site 갱신 + patch 22 site 갱신
5. `9835cbe` — 단계 5: `upgrade` 분리 + patch 4 site 갱신 + facade 정리 + `__all__` 29 항목

**규모**:
- 옛 `studio/prompt_pipeline.py` 975줄 → 5 파일 (총 1,124줄, +149줄 헤더/sub-module 보일러):
  - facade `__init__.py` 99줄 (pure re-export + `__all__` 29 항목)
  - `_common.py` 85줄 (UpgradeResult dataclass + 상수 + _strip_repeat_noise)
  - `_ollama.py` 50줄 (`_call_ollama_chat` HTTP wire)
  - `translate.py` 128줄 (clarify_edit_intent + translate_to_korean + 2 SYSTEM 프롬프트)
  - `upgrade.py` 762줄 (모든 SYSTEM_GENERATE/EDIT/VIDEO_* + ROLE_* + DOMAIN_VALID_SLOTS + matrix directive + 3 upgrade 함수)

**patch site 36건 모두 sub-module path 갱신** (flat patch 0건 · grep 실증):
- `_ollama._call_ollama_chat`: 10 (8 + 2 backend prefix)
- `translate.clarify_edit_intent`: 16
- `translate.translate_to_korean`: 6 (4 + 2 backend prefix)
- `upgrade._run_upgrade_call`: 4

**효과**:
- 4 그룹 (Ollama wire / 짧은 텍스트 변환 / 긴 프롬프트 업그레이드 + matrix / 공용 데이터) 분리 → 단일 책임
- vision_pipeline/edit_source.py 의 lazy import 도 submodule 직접 → facade snapshot 함정 회피 + patch 일관성 보장
- production import 11 site 무손상 (facade re-export 통과)

### Phase 4.2 — backend `vision_pipeline.py` 1131줄 4 파일 분할

**검증**: backend pytest **361 PASS** · ruff clean · frontend vitest **91 PASS** · tsc / ESLint clean · 회귀 0건

선행 commit: master `a8bad41` (Phase 4.1.1 helper). plan v2 (사용자 codex 1차 리뷰 6 finding 반영) 따라 단계적 진행.

**plan v2 핵심 결정 (codex C1+C2+C3+I1+I2+I3+R1 fix)**:
- C1: facade `__init__.py` 의 internal import 7 site 모두 `..` 로 갱신 (lazy ollama_unload 1건 추가 발견)
- C2: `_aspect_label` 위치 → `_common.py` (Edit + Vision Analyzer 둘 다 사용 · grep 실증)
- C3: 옵션 D patch target 갱신 시점 = 단계 3~4 sub-module 분리 commit 안에서 즉시
- I1: 옵션 D 확정 (sub-module 직접 import + 44 patch site 갱신)
- I2: grep assertion `[A-Za-z_]+` 패턴 (private patch `_call_vision_*` 검출)
- I3: SYSTEM_VISION_RECIPE_V2 / VisionPipelineResult / VisionAnalysisResult 그룹 매핑 명시
- R1: production 6 + test 5 = 11 파일 (grep 실증)

**6 commit 흐름**:
1. `333dced` — docs(plan): Phase 4.2 plan v1
2. `c738400` — docs(plan): Phase 4.2 plan v2 (codex 6 finding 반영)
3. `4a7deb5` — 단계 1: file → package + internal import 7 site .. 갱신
4. `90c74ef` — 단계 2: _common 그룹 분리 (ProgressCallback / VISION_SYSTEM / _describe_image / _to_base64 / _aspect_label)
5. `310f85a` — 단계 3~6: edit_source + image_detail 분리 + facade 정리 + patch 44 site 갱신 + `__all__`

**규모**:
- 옛 `studio/vision_pipeline.py` 1131줄 → 4 파일 (총 1,225줄, +94줄 헤더/sub-module 보일러):
  - facade `__init__.py` 96줄 (pure re-export + `__all__`)
  - `_common.py` 128줄 (qwen2.5vl 호출 + 공용 헬퍼)
  - `edit_source.py` 579줄 (Edit 9-slot 매트릭스 흐름)
  - `image_detail.py` 422줄 (Vision Analyzer recipe v2)

**효과**:
- 두 독립 흐름 (Edit 매트릭스 vs Vision Analyzer recipe v2) 분리 → 단일 책임
- monkeypatch 44 site 가 호출 site 의 lookup module 기준으로 갱신 (CLAUDE.md 🔴 정합)
- Edit + Vision Analyzer 둘 다 쓰는 _aspect_label 등 공용 헬퍼 _common.py 응집

### Phase 4.1.1 — `replace_reference_ref_if_current` helper 추출 (codex Open Question 반영)

**검증**: pytest **361 PASS** · ruff clean · 회귀 0건

Phase 4.1 후 codex Open Question:
> `routes/reference_templates.py:242` 가 직접 `aiosqlite.connect(history_db._config._DB_PATH)` 사용 — route ↔ DB layer 경계 침범.

→ `history_db.replace_reference_ref_if_current(history_id, current_ref, new_ref) -> bool` helper 흡수.
- WHERE reference_ref = current_ref 조건부 UPDATE (race-safe)
- race lost (rowcount==0) 시 caller 가 rollback (template + 영구 파일 + 409)
- route 의 connect+SQL 6줄 → helper 호출 1줄
- `aiosqlite` import 제거 (route 가 더 이상 DB 직접 접근 안 함)

### Phase 4.1 — backend `history_db.py` 886줄 7 파일 분할

**검증**: backend pytest **361 PASS** · ruff clean · frontend vitest **91 PASS** · tsc / ESLint clean · 회귀 0건

선행 commit: master `4460477` (Phase 3.5 후속 fix). plan v2 (codex 1차 리뷰 6 finding 반영) 따라 8 commit 으로 단계적 진행.

**plan v2 핵심 결정 (codex C1+C2+C3 fix)**:
- `_DB_PATH` lookup 정책 = A2 (`_config.py` 별도 + sub-module 의 `_cfg._DB_PATH` attribute lookup · monkeypatch 친화)
- facade alias `_DB_PATH = _cfg._DB_PATH` re-export 안 함 (sync 함정 차단)
- 11 access site 일괄 갱신 (단계 2 한 commit · monkeypatch 6 + 직접 read 5)
- sub-module lazy import depth 갱신 (cascade.py / stats.py 의 `..reference_pool` / `..storage`)
- facade `from .X import *` 금지 → 명시 import + `__all__` (codex I2 fix · ruff F403 차단)

**8 commit 흐름**:
1. `f2a1ac5` — docs(plan): Phase 4 backend split plan v2
2. `58607ac` — 단계 1: facade rename + lazy import depth fix (file → package)
3. `9f0967b` — 단계 2: `_config.py` 도입 + 11 access site 일괄 갱신 (grep assertion 0건 게이트)
4. `7ab86da` — 단계 3.1: schema 그룹 분리 (DDL + migration + init)
5. `bf11ea3` — 단계 3.2: items 그룹 분리 (insert/list/get/delete + update_comparison)
6. `fc06956` — 단계 3.3: cascade 그룹 분리 (cascade 삭제 + 임시 풀 cleanup)
7. `2a6112f` — 단계 3.4: stats 그룹 분리 (count + size 통계)
8. `533edf2` — 단계 3.5: templates 그룹 분리 + facade 정리 + `__all__`

**규모**:
- 옛 `studio/history_db.py` 886줄 → 7 파일 (총 1,073줄, +187줄 헤더/facade 보일러플레이트):
  - facade `__init__.py` 117줄 (pure re-export)
  - `_config.py` 35줄
  - `schema.py` 306줄
  - `items.py` 215줄
  - `cascade.py` 187줄
  - `stats.py` 88줄
  - `templates.py` 125줄

**효과**:
- 한 파일 단일 책임 (DDL / CRUD / cascade / stats / templates 분리)
- 외부 9 import site 변경 0건 (facade 모든 public 항목 명시 re-export)
- monkeypatch + 직접 read 11 site 모두 `studio.history_db._config._DB_PATH` 단일 target
- mock.patch 위치 정책 (CLAUDE.md 🔴 Critical "lookup 모듈 기준") 정합

### Phase 3.5 후속 fix — vision/compare mock 도 mocks/ 분리

**검증**: tsc / ESLint clean · vitest **91 PASS** · 회귀 0건

직전 Phase 3.5 (master `b6f2e11`) 가 generate/edit/video 만 분리했으나,
사용자 리뷰로 `vision.ts` (mockAnalyze 53줄 file-private 함수) +
`compare.ts` (인라인 mock 96줄) 도 실질 stream-mock 패턴이라 분리 누락 지적.
본 fix 로 5 stream mock 모두 `lib/api/mocks/` 에 통일.

| 파일 | 전 → 후 | mocks/ 신규 |
|---|---|---|
| vision.ts | 202 → 147 (−55) | mocks/vision.ts (66) |
| compare.ts | 248 → 155 (−93) | mocks/compare.ts (117 · 인라인 → 함수 추출) |

**효과**:
- 5 mock (generate/edit/video/vision/compare) 모두 동일 패턴으로 분리 일관성 확보
- compare.ts 의 인라인 100줄짜리 5축 mock 데이터가 별도 모듈로 떨어져 가독성 ↑

### Phase 3.5 — mock stream 3종 lib/api/mocks/ 분리

**검증**: tsc / ESLint clean · vitest **91 PASS** · 회귀 0건

`generate.ts` / `edit.ts` / `video.ts` 안의 file-private `mock*Stream` 3종을
새 디렉토리 `frontend/lib/api/mocks/` 로 분리. 실 백엔드 호출 분기는 원본
파일에 그대로 두고, USE_MOCK 분기만 named import 로 위임.

| 파일 | 전 → 후 | mocks/ 신규 |
|---|---|---|
| generate.ts | 209 → 150 (−59) | mocks/generate.ts (70) |
| edit.ts | 250 → 198 (−52) | mocks/edit.ts (59) |
| video.ts | 219 → 154 (−65) | mocks/video.ts (86) |

**효과**:
- 실 백엔드 호출 흐름 (multipart 업로드 + SSE drain) 만 원본 파일에 남아 가독성 ↑
- mock 데이터 (sample 프롬프트 / 가짜 stage timing 등) 검증·수정 시 원본 흐름 안 건드림
- 인계 plan 의 보류 항목 (Phase 3.5 R2 워밍업) 소화

### Codex+Claude 통합 리팩토링 리뷰 — Phase 0~3.4 완료

**검증**: backend ruff **clean** · pytest **361 PASS** · frontend vitest **91 PASS** · tsc/ESLint clean · 회귀 0건
**규모**: 11 commits · 46 files · -1,130줄 (dead code 청소 효과)

#### Codex 리뷰 문서 → 실증 → 실행 흐름

1. Codex 가 `docs/refactor-review-final-2026-04-30.md` 작성 (Claude+Codex 통합 리뷰)
2. Claude 가 핵심 주장 100% 실증 검증 (Critical 4 + Important 5 + Recommended 4)
3. 검증 통과한 항목만 phase 별 실행 (위험도 순)
4. 실행 후 Codex 후속 리뷰 → stale warning 게이트 잔여점 1건 추가 발견 → 즉시 fix

#### Phase 0 — baseline gate (`6041cda`)

- backend ruff 9건 fix (E402 6 / F401 1 / F841 2)
- 전: ruff fail 9 → 후: ruff clean

#### Phase 1 — Critical correctness 4건

| commit | 항목 | 영향 |
|---|---|---|
| `09deffc` | C1: compare-analyze edit-* 영구 저장 | history.id 저장 회복 (옛 silent miss) |
| `72da932` | C2: multipart meta object 검증 공통화 | 4 endpoint 500 → 400 정상 |
| `fdd7c52` | C3: referenceTemplateId 서버 권위 | 신뢰 경계 분리 |
| `a063715` | C4: promote conditional UPDATE + rollback | race orphan 차단 |

회귀 테스트 추가:
- `test_meta_object_validation.py` (신규 22건 · 4 endpoint × 5~6 케이스)
- `test_reference_promote_route.py` 에 race 시나리오 2건 추가
- `test_comparison_pipeline.py` 의 옛 `tsk-*` 테스트 → `edit-*` 로 갱신
- `test_edit_pipeline_pool_save.py` / `test_reference_templates.py` template path 흐름 갱신

#### Phase 2 — dead code 청소 (`334ec25`)

- frontend 7 파일 삭제 (1,165줄):
  - `icons.tsx` / `PipelineSteps.tsx` / `SelectedItemPreview.tsx` / `StudioResultCard.tsx`
  - `ResultInfoModal.tsx` / `AiEnhanceCard.tsx` / `VramBadge.tsx`
- backend 2 파일 삭제 (355줄 + 13 test):
  - `studio/workflow_runner.py` + `tests/studio/test_workflow_runner.py`
- stale comment 정리 (3건) + CLAUDE.md 컴포넌트 목록 갱신
- 보존 (메모리 노트): `prompt-flow/GenerateUseCaseDiagram.tsx` (cherry-pick 가능)

#### Phase 3 — frontend 구조 분할

| commit | 항목 | 효과 |
|---|---|---|
| `f40482c` | 3.1 stage slice 추출 | `lib/stage.ts` + `stores/createStageSlice.ts` 신규. Generate/Edit/Video 3 store 의 stage 추적 5 필드 + 2 액션 공통화 (Codex caveat: persist 차이 보존) |
| `18beb7e` | 3.2 SettingsDrawer 분할 | 1466 → 221줄 (-85%). 5 파일 분리 (Section/Process/SystemMetrics/History/ReferencePool) |
| `09b8de0` | 3.3 AppHeader ShutdownButton 분리 | 457 → 127줄 (-72%). 옛 ShutdownBtn/Overlay/btn helper 348줄 분리 |
| `09b8de0` | 3.4 ImageLightbox Inner 분리 | 466 → 27줄 (-94%). LightboxInner 391줄 별도 파일 |

#### Codex 후속 리뷰 잔여점 fix (`fa6bd00`)

- `useComparisonAnalysis.ts:155` 의 saved=false 경고 게이트 옛 `tsk-` 패턴 → `HISTORY_ID_RE` 정합
- C1 본 fix 시 historyItemId 전송 게이트는 제거했지만 경고 조건만 잊었던 stale 항목

#### Phase 별 commit 흐름 (11개)

1. `5b540c1` — refactor 리뷰 문서 (Codex 작성)
2. `6041cda` — Phase 0: ruff baseline clean
3. `09deffc` — Phase 1.C1: compare-analyze 영구 저장
4. `72da932` — Phase 1.C2: meta object 검증 공통화
5. `fdd7c52` — Phase 1.C3: template trust boundary
6. `a063715` — Phase 1.C4: promote race fix
7. `334ec25` — Phase 2: dead code 8건 삭제
8. `f40482c` — Phase 3.1: stage slice 추출
9. `18beb7e` — Phase 3.2: SettingsDrawer 분할
10. `09b8de0` — Phase 3.3+3.4: AppHeader + Lightbox 분리
11. `fa6bd00` — Codex 후속 리뷰: stale warning 게이트 정리

#### 의도적 보류 (별도 세션 권장)

- **Phase 3.5 (mock stream 분리)** — R2, 가치 낮음
- **Phase 4 (backend 5 파일 분할)** — 영향 5,235줄 + 30+ mock.patch site 갱신.
  Codex 자체 caveat 인용: "분할 시 테스트 patch target 을 반드시 lookup 모듈
  기준으로 갱신". 별도 PR 점진 진행 권장.

---

### Edit Reference Library v9 — UI 통합 + 사후 저장 + 임시 풀 cascade cleanup

**master HEAD**: `358783b` (push 완료)
**검증**: backend pytest **349 PASS** · frontend vitest **91 PASS** · tsc / ESLint clean · 회귀 0건

#### 기획 의도 (사용자 명시 3가지만 — NOT IN SCOPE 박스 0건 침범)

1. **UI 통합**: 참조 이미지 박스 + 사용 영역 crop UI → 단일 박스 (`ReferenceImageBox`)
2. **사후 저장**: 라이브러리 저장 시점 *생성 전 토글* → *결과 ActionBar `📚` 버튼 + 모달*
3. **임시 풀 cascade cleanup**: 디스크 임시 풀 + history cascade unlink + 설정 Drawer 수동 GC

#### Codex iterative review 흐름

- **1차 리뷰**: Critical 7 / Important 14 / Minor 4 (총 25 항목)
- **2차 검증**: self-review 25/25 ✅ (mechanical grep)
- 식별자 mismatch (예: `studio_history`/`_DB_PATH`/`insert_item`/`delete_item_with_refs`)
  + ReferenceImageBox 의 옛 EditReferenceCrop 흡수 + race double-check + DB rollback +
  vision 실패 silent + types 주석 갱신 등 모두 반영

#### Phase 별 commit (5개)

1. `c7daa4c` — plan 문서 (Codex iterative review 반영본)
2. `4a32ee3` — Phase A backend (5 NEW + 4 modified · pytest 56 신규 · OpenAPI snapshot 갱신)
3. `d08faba` — Phase B UI 통합 (ReferenceImageBox 신규 + 옛 saveAsTemplate/templateName 제거 + EditReferenceCrop 삭제)
4. `2a94516` — Phase C 사후 저장 (PromoteModal + ActionBar 버튼 + updateReferenceRef store action)
5. `ae38b80` — Phase D 설정 Drawer (ReferencePoolSection + reference-pool API client)
6. `358783b` — master `--no-ff` merge

#### 최종 동선 변경

| 항목 | 옛 (v8) | 새 (v9) |
|---|---|---|
| 참조 이미지 박스 | SourceImageCard + 별도 EditReferenceCrop | ReferenceImageBox 단일 (드롭존↔crop↔bypass 3 모드) |
| 라이브러리 저장 시점 | "수정 생성" *전* `saveAsTemplate` Toggle | "수정 생성" *후* ActionBar `📚` → 모달 |
| `studio_history.reference_ref` (직접 업로드) | NULL | 임시 풀 URL (promote 후 영구 URL swap) |
| 단건/전체 history 삭제 | 영구 라이브러리 ref 만 cascade | + 임시 풀 ref cascade unlink (호출자 영향 0) |
| 수동 cleanup | 없음 | 설정 Drawer 의 "고아 ref 일괄 삭제" 버튼 |
| `EditReferenceCrop.tsx` | 별도 컴포넌트 | **삭제** (ReferenceImageBox 흡수) |

#### 신규 / 변경 / 삭제 (28 파일)

**Backend NEW** (7 파일):
- `studio/reference_pool.py` — POOL_URL_PREFIX trailing slash + pool_path_from_url 헬퍼 + PNG 통일
- `studio/routes/reference_pool.py` — GET stats / GET orphans / DELETE orphans (race double-check)
- `tests/studio/test_reference_pool_storage.py` (22)
- `tests/studio/test_history_db_cascade.py` (13)
- `tests/studio/test_edit_pipeline_pool_save.py` (3)
- `tests/studio/test_reference_pool_routes.py` (6)
- `tests/studio/test_reference_promote_route.py` (12)

**Backend Modified** (5 파일):
- `studio/history_db.py` — cascade + count_pool_refs / list_history_pool_refs
- `studio/routes/__init__.py` — reference_pool 라우터 등록
- `studio/routes/reference_templates.py` — POST /promote/{history_id} (history.referenceRef swap + DB rollback + visionFailed)
- `studio/routes/streams.py` — multipart 후 save_to_pool() 분기
- `tests/_snapshots/openapi.json` — 신규 endpoint 반영

**Frontend NEW** (3 파일):
- `components/studio/edit/ReferenceImageBox.tsx` — 옛 EditReferenceCrop + SourceImageCard 흡수
- `components/studio/edit/ReferencePromoteModal.tsx` — 사후 저장 모달
- `lib/api/reference-pool.ts` — getPoolStats / getPoolOrphans / deletePoolOrphans

**Frontend Modified** (8 파일):
- `stores/useEditStore.ts` — saveAsTemplate / templateName 4 항목 제거
- `stores/useHistoryStore.ts` — `updateReferenceRef` action 추가
- `components/studio/edit/EditLeftPanel.tsx` — ReferenceImageBox 1개로 교체
- `components/studio/edit/EditResultViewer.tsx` — `📚` ActionBar 버튼 + canPromote 판정
- `hooks/useEditPipeline.ts` — 옛 자동 promote 호출 제거
- `lib/api/reference-templates.ts` — `promoteFromHistory()` 추가
- `lib/api/types.ts` — `HistoryItem.referenceRef` 주석 v9 갱신
- `__tests__/edit-library-store.test.ts` — saveAsTemplate / templateName 검증 부분 제거
- `components/settings/SettingsDrawer.tsx` — `ReferencePoolSection` 추가

**Frontend Deleted** (1 파일):
- `components/studio/EditReferenceCrop.tsx` (ReferenceImageBox 흡수)

**OpenAPI 자동 동기** (2 파일):
- `frontend/lib/api/openapi.json` (29 paths · 13 schemas)
- `frontend/lib/api/generated.ts`

#### NOT IN SCOPE (사용자 명시 — 침범 0건)

❌ image1 crop / InstantID / Multi-ref slot 알고리즘 / 라이브러리 검색·태그·정렬 /
   자동 시간 기반 GC / vision 자동 호출 / Drawer 임시 풀 노출 / Generate-Video 라이브러리 도입 /
   키보드 단축키 / 라이브러리 동기·공유

#### 핵심 정책 박제

- **POOL_URL_PREFIX trailing slash**: `/images/studio/reference-pool/` (collision 방어 — Codex C6)
- **pool_path_from_url() 공용 헬퍼**: 모든 path 검증 한 곳으로 통일
- **promote response shape**: `{ template: { id, name, imageRef, visionDescription, roleDefault, ... }, visionFailed }`
- **canPromote 판정**: `history.referenceRef.includes("/images/studio/reference-pool/")` (절대 URL 화 후에도 매칭)
- **promote 성공 → swap**: 백엔드가 `studio_history.reference_ref` 를 영구 URL 로 update + frontend `updateReferenceRef` store sync → ActionBar 의 `📚` 자동 사라짐 (중복 promote 방지)
- **race condition**: orphan delete 시 history snapshot double-check (Codex I4)

#### 사용자 검사 결과

✅ 모든 동선 정상 (실 환경 통합 시나리오 8건 + Lightbox compare 회귀 검증)

---

### Prompt Flow 도움말 페이지 redesign + Launcher 후속 (옛 master)

**master HEAD**: `bbab39f` (push 완료)
**검증**: tsc / ESLint clean · vitest **91/91** (회귀 0)

#### 진행 흐름 (7 merge commit)

1. **redesign 1차** (`79b6147`) — 동적 라우트 `/prompt-flow/[mode]` + 공용 컴포넌트 5종 + lib 데이터 + 메인 카드 톤 hero
2. **사용자 결정으로 회귀** (`033ea75`) — "기존 디자인이 더 보기 좋다" → 옛 단일 페이지 복원 + 톤만 존댓말 변환
3. **mode별 풀 페이지 분리** (`071d084`) — 옛 단일 페이지 + 인터랙티브 페이지(1202줄) → mode별 풀 페이지 3개 통합 + DiagramSlot
4. **hero 메인 카드 톤 통일** (`ad2b316`) — `/menu/{mode}.png` 배경 + 그라디언트 + 작은 glass 칩
5. **Journey subtitle 정확도 보강** (`c8fd7d1`) — "이미지 정보" → "컨텍스트(해상도·이미지·스타일 등)" (generate 모드 정확도)
6. **Launcher v2 후속** (`f92b06c`) — Shutdown 모달 디자인 개선 + 톤 존댓말 + 새 앱 아이콘 (prompt-flow 와 별 작업)
7. **흐름 다이어그램 PNG 3종 임베드** (`bbab39f`) — 사용자 친화 다이어그램 PNG 3종 (generate/edit/video) 자동 임베드 + DiagramSlot 자동 분기 (children 우선 → PNG fallback)

#### 최종 구조

| 라우트 | 콘텐츠 |
|---|---|
| `/prompt-flow` | `/prompt-flow/generate` redirect |
| `/prompt-flow/generate` | Hero(generate.png) + Journey + 다이어그램 PNG (1/3) + 6단계 + ruleBlock + Example |
| `/prompt-flow/edit` | Hero(edit.png) + Journey + 다이어그램 PNG (2/3) + 7단계 + 매트릭스 + 참조 역할 + Example |
| `/prompt-flow/video` | Hero(video.png) + Journey + 다이어그램 PNG (3/3) + 6단계 + ruleBlock + Example |

3 mode 페이지 모두 동일 패턴 — `<PromptFlowShell content={PROMPT_FLOW_CONTENT.{mode}} />` 한 줄로 렌더.

각 페이지:
- Hero = 메뉴 카드와 동일 배경이미지 + 어두운 그라디언트 + 흰색 텍스트 + 다른 mode 도움말 작은 glass 칩 2개
- 다이어그램 = `frontend/public/prompt-flow/{generate,edit,video}-flow.png` (next/image · sizes / priority / lazy 최적화)

#### 신규 파일 (코드 6종 + 자산 3종)

코드:
- `lib/prompt-flow-content.tsx` — 3 mode 단일 출처 데이터 (메타 + 단계 + extras)
- `components/prompt-flow/PromptFlowShell.tsx` — 풀 레이아웃 (Hero + Journey + DiagramSlot + Section + CTA)
- `components/prompt-flow/StepCard.tsx` — 단계 카드
- `components/prompt-flow/GenerateUseCaseDiagram.tsx` — 옛 UC 다이어그램 분리 (보존, cherry-pick 가능)
- `components/prompt-flow/DiagramSlot.tsx` — children 우선 + PNG 자동 fallback
- `components/prompt-flow/prompt-flow.module.css` — 옛 page.module.css 이전

자산:
- `public/prompt-flow/generate-flow.png` (1.1 MB · 6단계 + 선택 옵션 + 핵심 포인트)
- `public/prompt-flow/edit-flow.png` (1.5 MB · 7단계 + 참조 이미지 5종 + 핵심 포인트)
- `public/prompt-flow/video-flow.png` (1.4 MB · 7단계 + 선택 옵션 + 핵심 포인트)

#### 폐기

- `app/prompt-flow/page.module.css` (921줄, 옛 통합 페이지 전용) — components 로 이전
- `app/prompt-flow/generate/page.tsx` (1202줄, 옛 인터랙티브 분기 트리) — 콘텐츠 미사용 결정
- `app/prompt-flow/generate/page.module.css` (옛 인터랙티브 전용)

#### 수정

- `StudioModeHeader` flowHref 통일: `edit→/prompt-flow/edit`, `video→/prompt-flow/video`
- 사용자 노출 한국어 100% 존댓말 변환 (반말·"오빠" 호칭 0건)

#### 톤 변환 (반말 → 존댓말)

| 옛 | 새 |
|---|---|
| "오빠가 적은 말에서 시작해" | "사용자가 입력하신 문장에서 시작합니다" |
| "원하는 장면을 말로 적는다" | "원하는 장면을 문장으로 입력합니다" |
| "그래서 의도치 않은 재해석을 줄인다" | "그래서 의도치 않은 재해석을 줄여 줍니다" |

---

## 2026-04-28

### Multi-ref Phase 1+1'+1'' — image2 prompt 보장 (current master)

**브랜치**: `claude/multi-ref-slot-removal` → master merge `--no-ff` (`fe8e387`)
**검증**: pytest 267 → **293** (+26 신규) · vitest 91 · tsc / lint clean
**진화**: Slot Removal (Phase 1) → Slot Replacement (Phase 1' · codex 리뷰 반영) → 2-Layer 안전망 (Phase 1'')

#### 동기

사용자 발견 케이스: `role=background` + `edit_instruction="Calvin Klein bra 제거"` 실행 시 결과 프롬프트에
**image2 가 한번도 안 나오고 `preserve background` 가 박힘**. 매트릭스 [preserve] 지시와
reference_clause 의 "image2 로 교체" 지시 충돌 → quote 강제력 더 센 [preserve] 가 우연히 이김.

#### Phase 1 — Slot Removal (1 commit)

- `ROLE_TO_SLOTS` 매핑 + `_role_target_slots()` 헬퍼
- `_build_matrix_directive_block`: target slot 매트릭스에서 *제거 (continue)* — 침묵 전략
- 옛 face-only 분기 (line 688-701) 제거 → 4 role 일관 메커니즘
- 사용자 검증 결과 **실패** — gemma4 가 침묵을 default-preserve 로 환각

#### Phase 1' — Slot Replacement (codex 리뷰 반영 · 1 commit)

> codex: "role 은 보조 설명이 아닌 implicit user instruction. attire 슬롯은 침묵/삭제가 아니라 reference_from_image2 같은 명시적 action."

- 슬롯 제거 → `[reference_from_image2]` 명시 액션으로 *교체*
- "Apply image2's X to image1" + "Do NOT preserve image1's X" + "MUST mention 'image2'" 강제 directive
- 매트릭스에 경쟁 권위 박혀 reference_clause 와 동등 강도

#### Phase 1'' — 2-Layer 안전망 (1 commit · 7 신규 tests)

> codex: "프롬프트에 image2 없으면 Qwen Edit 가 image2 conditioning 받아도 cross-attention 약함."

- **Layer 1**: 도메인별 화이트리스트 (`DOMAIN_VALID_SLOTS`) + missing slot 강제 추가
  - vision 이 슬롯 안 만들어도 (예: "머리만 변경" → attire 슬롯 부재) 강제 박음
- **Layer 2**: gemma4 결과 post-process — image2 미언급 시 deterministic phrase 부착
  - `_ROLE_PHRASES`: face/outfit/style/background 4종

#### 사용자 실 테스트 결과

| role | 결과 | 비고 |
|---|---|---|
| outfit | ✅ image2 옷 적용 (Calvin Klein 글자까지 transfer) | Layer 2 phrase 부착으로 동작 |
| background | ✅ image2 환경 적용 | gemma4 직접 박음 |
| face | ⚠️ 프롬프트는 OK, 결과 약함 | Qwen Edit 모델 한계 — InstantID 별도 plan 후보 |
| style | ⚠️ 프롬프트는 OK, 결과 약함 | IP-Adapter 별도 plan 후보 |

#### 신규 테스트 (26)

- `test_role_slot_removal.py` (신규, 18 tests)
- `test_matrix_directive_block.py` (+5)
- `test_prompt_pipeline.py` (+3)
- `test_multi_ref_edit.py` (face role assertion 갱신)

#### 알려진 한계 (Phase 2 후보)

- face/style: 모델 conditioning 한계 — InstantID / IP-Adapter Style 별도 통합
- 자유 텍스트 role: ROLE_TO_SLOTS 매칭 X → reference_clause fallback 만 (충돌 가능성 잔존)

---

### Edit Reference Template Library v8

**브랜치**: `claude/edit-reference-library` → master merge `--no-ff` (`da848aa`)
**검증**: pytest 267 (244 → +23) · vitest 91 (74 → +17) · tsc / lint clean
**Codex 리뷰**: 2회 (Phase A 단독 + Phase B+C 통합) · 결함 7건 모두 fix (🔴 0 / 🟡 5 / 🟢 2)

#### 동기

Multi-reference + 수동 Crop 본 plan 의 후속. 같은 reference 이미지 (옷/배경/스타일) 를
*2회 이상 재업로드* 하는 케이스 발견 시 라이브러리화 가치. cropping 영역까지 영구 저장.

#### Phase A — Backend foundation (4 commit · v8 schema + CRUD + 라우트)

- **v8 schema**: `reference_templates` 테이블 + `idx_reference_templates_lastused`
- **CRUD**: `list / get / insert / delete / touch` (last_used_at DESC + created_at fallback)
- **`reference_storage.py`** 신규 (140 줄): 영구 저장 + path traversal 보안 + PIL 재인코딩 + vision 분석 헬퍼
- **`POST /api/studio/reference-templates`** (multipart) — 이미지 + meta JSON
  - PIL 검증 → vision 분석 (graceful) → DB insert (실패 시 파일 unlink 롤백)
- **DELETE / POST touch** — Soft 삭제 + last_used_at 갱신
- **Codex 리뷰 fix**: meta JSON dict 가드 (`isinstance(parsed, dict)` 400) + URL query/hash 거부 + 테스트 nit

#### Phase B — Frontend UI (2 commit · types + API + Drawer)

- **`types.ts ReferenceTemplate`** (8 필드) + `EditRequest` 에 `referenceRef` + `referenceTemplateId` 추가
- **`lib/api/reference-templates.ts`** 신규: `list / create / delete / touch` + `normalizeReferenceTemplate` URL 절대화 (Codex 2차 리뷰 fix #6)
- **`ReferenceLibraryDrawer.tsx`** 신규 (333 줄): 우측 480px Drawer + 2열 grid TemplateCard + pick/delete + 빈 상태 안내
- **단위 테스트 10건**: URL 정규화 + create/delete/touch graceful

#### Phase C — Integration (3 commit · store + EditLeftPanel + meta + 자동 저장)

- **`useEditStore`**: saveAsTemplate / templateName / pickedTemplateId / pickedTemplateRef + setReferenceImage 가 picked 두 값 자동 null
- **`EditLeftPanel`**: "라이브러리에서 선택" 버튼 + saveAsTemplate Toggle + Drawer 마운트
- **Codex 3차 리뷰 fix (핵심)** — 권위 신뢰 키 분리:
  - 클라이언트 `referenceRef` 는 absolute URL 일 수 있어 백엔드 DB 저장 근거로 신뢰 X
  - `referenceTemplateId` → `history_db.get_reference_template` 으로 권위 image_ref 결정
  - 회귀 테스트: evil absolute URL 보내도 DB 의 상대 URL 이 pipeline 으로 전달
- **`useEditPipeline` 자동 저장**: done 콜백에서 saveAsTemplate ON + 새 업로드 + 이름 입력 → `createReferenceTemplate`

#### Codex Phase B+C 리뷰 fix (1 commit)

- **자동 저장 closure stale fix**: 실행 시작 시 스냅샷 캡처 → 실행 중 토글/이름 변경 무관
- **Drawer 접근성**: aria-modal + Esc 닫기 + focus 진입/복귀
- **blob: URL preserve**: `normalizeReferenceTemplate` 보존 prefix 에 추가
- **통합 회귀**: `edit-library-store.test.ts` (7 케이스 — 픽 후 새 업로드 reset / 토글 OFF picked 보존 / blob URL 등)

#### 정책 결정

- **저장 정책**: 명시적 ("템플릿으로 저장" 토글 ON 시만)
- **비전 분석**: 저장 시 1회 (qwen2.5vl 동기 5-10초)
- **삭제**: Soft (DB row + 이미지 파일 삭제, 옛 history.referenceRef 보존)
- **history.referenceRef 채우기**: 옵션 A (첫 실행 = null / 라이브러리 픽 = 영구 URL)
- **얼굴 transfer 한계**: Qwen Edit 본질 — InstantID 별도 plan 후보

### Launcher v2 (start_v2 / stop_v2 + ShutdownBtn + /loading)

**브랜치**: `claude/launcher-v2` → master merge `--no-ff` (`af0a9cf`)
**검증**: pytest 235 / vitest 74 / tsc / lint clean (0 회귀)
**작성**: codex 직접 작성 (이번 세션은 검토 + 분할 commit + master 머지)

#### 동기

옛 `start.bat` 콘솔 1개 + Hidden 흐름은 유지하되, 종료를 좀더 안전하게:
1. PowerShell 단독 종료 스크립트 (단계별)
2. 브라우저 앱 윈도우의 종료 버튼이 백엔드 endpoint 통해 종료 트리거
3. Backend 부팅 전에는 정적 `loading.html`, Backend ready 시 Next.js `/loading` 으로 전환

#### 구조

- **`start_v2.bat` / `start_v2.ps1`** (`c034bdf`)
  - 콘솔 1개만 + Backend/Frontend/Ollama Hidden + ComfyUI headless
  - 브라우저 app window 가 `launcher/loading.html` 부터 띄우고 backend ready 후 `/loading` 으로 전환
  - 로그: `logs/launcher-v2.log` / `logs/{backend,frontend}.{log,err.log}`
- **`stop_v2.ps1`** — ComfyUI/Frontend/Backend 단계별 kill + (옵션) Ollama kill + 브라우저 창 닫기
- **`launcher/loading.html`** — PowerShell 단계 정적 로딩 (Next.js 미가동 구간 대비)
- **Backend `POST /api/studio/system/shutdown`** — localhost only + subprocess 로 `stop_v2.ps1 -KillOllama -CloseBrowser` 실행 (CREATE_NO_WINDOW)
- **Frontend `ShutdownBtn`** (AppHeader) — `NEXT_PUBLIC_ENABLE_LOCAL_SHUTDOWN=true` 일 때만 노출. confirm 모달 → 5단계 진행 (ComfyUI/Ollama/Frontend/Backend/브라우저) → 실패 시 toast + failed phase 유지
- **Frontend `/loading` 페이지** (`89a6f77`) — 부팅 대기 화면 (4 서비스 ready 표시 · 1.2s polling · backend ready 시 `/` redirect · "메인으로/종료" 액션)

#### 안전망

- **Localhost 게이트**: backend 가 client.host 검사로 `127.0.0.1`/`::1`/`localhost` 만 허용
- **환경변수 게이트**: 프런트 종료 버튼은 `ENABLE_LOCAL_SHUTDOWN` 미설정 시 렌더 0
- **subprocess `shell=False`** + 절대경로 + `creationflags=CREATE_NO_WINDOW`

### Edit Multi-Reference 수동 Crop UI (Phase 1-3 MVP)

**브랜치**: `claude/edit-multi-ref` → master merge `--no-ff`
**검증**: pytest 234 (231 → +3) · vitest 74 (61 → +13) · tsc / lint clean
**Codex 리뷰**: 3회 의뢰 (Phase 1/2/3) + 결함 2건 fix

#### 동기

`edit-153d2c13` 검증 결과: gemma4 가 정확한 영문 prompt 를 만들어도 Qwen Edit 가 image2 를 broad reference 로 처리해 의상/배경이 결과에 누수. face geometric crop 도입 (`0d7ff57`) 했다가 얼굴 위치 다양성에 빗나가 제거. 사용자가 *직접* 영역을 자르는 매뉴얼 UI 가 가장 실용적 해결책으로 결정.

#### Phase 1 — UI scaffolding (`16b75eb` + `6f56cc7` + `5754f8c`)

- `react-easy-crop@^5.5.7` 도입 (`next/dynamic({ ssr:false })` 격리)
- `frontend/components/studio/EditReferenceCrop.tsx` 신규 — 인라인 crop UI (모달 X)
  · 자유/1:1/4:3/9:16 비율 lock 토글 (자유 = 이미지 자연 비율 사용 · `onMediaLoaded` 자동 계산)
  · 256px 최소 가드 (미만 시 `onAreaChange(null)` 무효 처리)
  · `bypassCrop` prop 자리만 (라이브러리 plan 진입 시 활성)
  · 외부 dim 0.75 (기본 0.5 → 가독성 ↑)
- `useEditStore.referenceCropArea: CropArea | null` + reset 트리거 3개 자동 적용
  · 새 업로드 / 해제 / multi-ref 토글 OFF
- `EditLeftPanel` 통합 — `key={referenceImage}` 로 새 이미지 시 컴포넌트 local state 강제 reset (Codex 리뷰 결함 #1 fix)
- vitest 신규 6 케이스 (store 단위 + reset 트리거 검증)

#### Phase 2 — 클라이언트 crop → cropped File 전송 (`76f29cf` + `e6ad93a`)

- `frontend/lib/image-crop.ts` 신규 (3 헬퍼)
  · `dataUrlToBlob(dataUrl)` / `cropBlobByArea(blob, area)` (canvas drawImage + toBlob) / `cropBlobIfArea(blob, area | null)` (no-crop path)
- `useEditPipeline` submit 흐름 수정
  · `referenceCropArea` 있으면 `dataUrlToBlob → cropBlobIfArea → new File('reference-crop.png', 'image/png')` → multipart 의 `reference_image` 필드
  · area null 이면 원본 data URL 그대로 (옛 흐름 100% 동일)
  · crop 변환 실패 시 `toast.error` + 진입 차단 (`setRunning` 호출 X)
- `effectiveUseRef = useReferenceImage && !!referenceImage` 단일 게이트 (Codex 리뷰 결함 #3 fix · race 시 백엔드 400 차단)
- vitest 신규 7 케이스 (jsdom canvas 미구현 우회 — `getContext("2d")` mock 으로 fake ctx)

#### Phase 3 — 백엔드 회귀 테스트 (`3a04953` + `87ed7f1`)

- 백엔드 코드 변경 0 — multipart 는 이미 image2 그대로 받고 있음
- `test_multi_ref_edit.py` 에 cropped reference 흐름 회귀 2건 (256x256 + 64x64)
  · 클라이언트 256px 가드 우회한 작은 사이즈도 백엔드는 거부 안 함 (UX/백엔드 책임 분리 신호)
- `test_dispatch_extra_uploads.py` 에 dispatch 까지 도달 회귀 1건 (Codex 리뷰 의심 #2 보강)
  · cropped bytes → `comfy.upload_image` → factory 의 `extra_uploaded_names=["reference-crop.png"]` 정확 전달

#### 알려진 한계 (의도된 trade-off)

- **얼굴 transfer 약함**: Qwen Edit 본질 한계 — manual crop 으로 image2 의 의상/배경 누수는 차단되나 face identity 전송은 약함. 별도 InstantID plan 후보.
- **저장**: cropped Blob 은 영구 저장 X (메모리 → multipart → ComfyUI 임시 input). 영구 저장 + 라이브러리 재선택은 `docs/superpowers/plans/2026-04-27-edit-reference-library.md` 후속 plan 에서 다룸.
- **mediaAspect 깜빡임**: onMediaLoaded 전 1:1 1ms 이내. trade-off 인정 (별도 image preload 비용 대비 효용 낮음).
- **Phase 2 fake canvas false negative**: jsdom 한계로 drawImage 호출 인자만 검증, 실 픽셀은 manual / Playwright 도입 시 보강.

## 2026-04-27

### 진행 모달 통일 + Tier 2/3 (현재 master)

- **AI 프롬프트 보정 우회 토글** (`claude/prompt-skip-toggle`). Generate / Video 좌측 패널 프롬프트 카드 직후 신규 토글 (`🪄 AI 프롬프트 보정` ⇄ `✏️ 프롬프트 직접 사용`). 사용자가 정제된 영문 프롬프트를 복사해 붙여넣은 케이스 — gemma4(+vision) 단계 우회. Generate: 기존 `preUpgradedPrompt` 재사용 (백엔드 변경 0). Video: `VideoRequest.preUpgradedPrompt` 신설 + `pipelines/video.py` 분기 (~15초 절약 · vision/gemma4 둘 다 skip). 의미 반전 + 라벨 동적 패턴 (Lightning 과 통일). 스토어 `useGenerateStore` v5→v6 / `useVideoStore` skipUpgrade 신설. Edit 는 매트릭스 분석 본질이라 보류. pytest 215 / vitest 50 / tsc / lint clean.
- **Harness cleanup** — CLAUDE.md / MEMORY.md / docs/ 정리. 변경 로그 → `docs/changelog.md` (이 파일) 분리. 옛 audit/review 문서 → `docs/archive/`.
- **Tier 3 — OpenAPI 자동 타입 생성** (`ef64d63`). `openapi-typescript ^7.13.0` (devDep) + `backend/scripts/dump_openapi.py` (FastAPI 풀 OpenAPI 3.1 dump) + npm script `gen:types` (chain). `frontend/lib/api/generated.ts` (1,261줄 자동) + `generated-helpers.ts` (Schemas/Paths alias). 시범 마이그레이션 5건 (lib/api/{generate,edit,video,vision,compare}.ts inline cast → `as TaskCreated`). hybrid 정책 — 한글 주석 + narrow union 은 types.ts 손편집 유지.
- **Tier 2 — Phase 6 산출물 단위 테스트** (`d5ee0b0`). vitest 19 → 50 (+31). 신규 3 파일: `stores-stage-history.test.ts` (Vision/VisionCompare store 의 stageHistory) · `api-vision-compare.test.ts` (SSE drain + onStage callback · jsdom Blob 호환 우회) · `pipeline-defs-consistency.test.ts` (5 mode 정적 검증).
- **Phase 6 후속 — 라벨 체계화 + Generate timeline 통일** (`3057c50`). 5 mode 라벨 사용자 친화화 (ComfyUI 샘플링 → "이미지 생성" / "이미지 수정" / "영상 생성") · "비전 분석" → "이미지 분석" 통일 · "워크플로우 전달/구성" → "워크플로우 설정" · `gemma4-upgrade` → "프롬프트 강화" + subLabel `gemma4-un` · `Claude 조사` → "프롬프트 조사" + subLabel `Claude · 최신 팁` · vision-call → vision-analyze (edit/video 와 동일 type) · Generate `postprocess` → `save-output`. 옛 `progress/Timelines.tsx` 제거 (97줄) → 5 mode 모두 PipelineTimeline 단일. Vision/Compare 보조 박스 추가 (Edit/Video 패턴 일관).
- **Phase 6 — Vision/Compare 진행 모달 통일** (`ef536c9`). `/api/studio/vision-analyze` + `/compare-analyze` 동기 JSON → task-based SSE. 신규 `pipelines/{vision_analyze,compare_analyze}.py`. `analyze_image_detailed` / `analyze_pair` / `analyze_pair_generic` 셋 모두 옵셔널 `progress_callback` 추가. `PipelineMode = HistoryMode | "vision" | "compare"` union. PIPELINE_DEFS 에 vision (3 stage) + compare (4 stage) 추가. **gemma4 translation StageDef 에 `enabled: !c.gemma4Off`** — 옵션 B 통일의 진짜 가치 (미래 토글 한 줄 자동 정리). `AnalysisProgressModal.tsx` 삭제 (337줄). pytest 215. mock.patch 위치 갱신 8건.
- **Phase 5 — ComfyUI 자동 기동** (`7c7b9a5`). `_dispatch._ensure_comfyui_ready` 헬퍼. `_dispatch_to_comfy` 의 `acquire_gpu_slot` 직후 호출. ComfyUI 꺼져있으면 stage emit + start. 진행 모달에 "ComfyUI 깨우는 중 (~30초)" warmup row 자동 노출. 프론트 추가 코드 0 (PIPELINE_DEFS 의 enabled: warmupArrived). pytest 210→215.
- **Phase 1-4 — 진행 모달 store 통일** (`be51476`). 3 mode 분리 패턴 → 단일 StageDef 시스템. 신규 `frontend/lib/pipeline-defs.tsx` (PIPELINE_DEFS 진실의 출처) + `progress/{PipelineTimeline,TimelineRow,DetailBox}.tsx`. 백엔드 emit 통일 (step → stage payload 흡수). useEditStore/useVideoStore 의 stepDone/currentStep/stepHistory 제거 → stageHistory + pushStage. PIPELINE_DEFS.video 의 `workflow-build` → `workflow-dispatch` 잠재 버그 fix. interrupt 판정 통일 (`lastStage === "comfyui-sampling"`). 후속 폴리시: `hideVideoPrompts` 신설 + Lightning 토글 라벨 동적 분기.

## 2026-04-26

- **Codex 리뷰 + 퀄리티 리팩토링** (8 commit, `544066f`). Phase 0 P0 안정화 + 분해 + SSE 추상화 + frontend/legacy quarantine. pytest 197→201. 신규 모듈 6개: backend (`types.py`, `tasks.py`, `schemas.py`, `storage.py`) + frontend (`hooks/usePipelineStream.ts` + `components/studio/generate/*` 4 파일). frontend/legacy/ 39파일 quarantine.
- **router.py 풀 분해 + legacy quarantine** (3 commit `0c4b999`). `backend/studio/router.py` 1,769 → **118줄 (facade only · -93%)**. `studio/{routes,pipelines}/` 분리 (12 신규 파일 · 2,005줄). 옛 5 라우터 + 5 services + 4 tests + conftest = 15 파일 `backend/legacy/` 격리. **신규 정책**: mock.patch 위치 = lookup 모듈 기준. **잠재 NameError fix 1건**: 옛 router.py 1213줄의 `getattr(settings, ...)` 가 `settings` import 없이 참조 → pipelines/video.py 명시 import.
- **edit/video page 풀 분해** (`ac1b7db`). edit/page.tsx 646→170 (-74%) · video/page.tsx 591→87 (-85%). Generate 패턴 복제. 신규 컴포넌트 5개. vitest exclude `legacy/**` 추가.
- **spec 19 — 시스템 프롬프트 통합 + Ollama race fix** (4 라운드, `2c8b024`). pytest 166→197. 신규 모듈 3개: `_json_utils.py` (parse_strict_json) · `ollama_unload.py` · `CompareExtraBoxes.tsx`. 라운드 1: SYSTEM_COMPARE v3.1 + person background 흡수 + format=json. 라운드 2: parse_strict_json quoted-string aware + DB v6 refined_intent 캐싱. 라운드 3: SYSTEM_EDIT/VIDEO/GENERATE adaptive + Claude CLI 격리. 라운드 4 (CRITICAL): vision_pipeline / video_pipeline 안에서 단계별 Ollama unload (qwen2.5vl + gemma4 동시 점유 → swap → ComfyUI sampling 3분+ → 30~60초로 정상화).
- **VRAM Breakdown 오버레이** (`63ae160`). 헤더 80% 임계 시 ComfyUI/Ollama 점유 + 모델 정보 오버레이. **Windows nvidia-smi 권한 정책 폴백** (CRITICAL): `used_gpu_memory` 컬럼이 일반 사용자 권한 [N/A] → `total - ollama - other = ComfyUI` 추정. 막대 시각 개편 (collapsed 22→44px / 위험 그라데이션). CPU 색상 빨강 → 시안.
- **Codex 3가지 미세 fix**. `_coerce_score` 문자열 방어 (CRITICAL · 옛엔 종합 0% 버그) · keep_alive 타입 통일 (str "0") · transform_prompt 트리거 조건 명확화 ("ALL 5 axes >= 95").
- **Compare v2.2 + Ollama keep_alive=0** (Codex+Claude 공동 spec). 점수 calibration rubric 5단계 + Subject 하드 캡 (recreation fidelity 보호) + transform_prompt + uncertain 슬롯 + format=json + SYSTEM 200→80줄 단축. **CRITICAL VRAM 정책**: 모든 Ollama `/api/chat` 호출에 `"keep_alive": "0"` 추가 (7 호출). 응답 직후 모델 unload, VRAM 즉시 반납.
- **Chrome 통합 + Vision Recipe v2.1**. AppHeader (라우트 자동 분기) + SystemMetrics (CPU/GPU/VRAM/RAM 4-bar · macOS 색상 매핑) + SystemStatusChip (ComfyUI 가동 표시) + 메인 카피라이트 풋터. Backend `system_metrics.py` 신설 (psutil + nvidia-smi). `/process/status` 응답 v2 (`vram_used_gb`, `system.cpu_percent` 등). ComfyUI timeout 확장 (idle 600→1200s, hard 1800→7200s · 16GB VRAM swap 안전망). Vision Recipe v2.1: SYSTEM_VISION_RECIPE_V2 (9 슬롯 STRICT JSON · Codex+Claude 공동) + width/height 주입 + POSITIVE self-containment + multi-subject 핸들링 + 광역 race 라벨. 히스토리 가로 흐름 (height-aware Masonry · greedy).

## 2026-04-25

- **Edit 한 사이클 완성 (spec 14-17)** (`91348bb`). Edit 모드 5단계가 도메인 슬롯 매트릭스 패러다임으로 통합. `analyze_edit_source` v2 (인물/물체·풍경 5 슬롯) + `clarify_edit_intent` (gemma4 정제) + `SYSTEM_EDIT` STRICT MATRIX DIRECTIVES + spec 17 preserve 누출 차단 + `analyze_pair` v3 (도메인 분기 + 의도 컨텍스트 점수). 신규 `EditVisionBlock` 매트릭스 행 UI 공용 컴포넌트. DB 스키마 무변경 (옛 row 자동 폴백). 후속 폴리시: 진행 모달 prompt 토글 분리 (생성/수정) · Generate Lightning 8/1.5 튜닝 (블러 개선).
- **Headless Launcher (창 0개) + 가동 fix 5건**. start.bat 콘솔 1개만 + Backend/Frontend/Ollama Hidden + ComfyUI Headless Python 직접 호출 (Electron GUI 없음). 5 fix: lifespan ComfyUI 비차단 / Wait-ForPort / stdout redirect / `--base-directory` / globals.css `@import` 순서.
- **UI Polish + Generate LoRA 시스템**. 메인 헤딩 "AI Image Studio" + 메뉴 6장 동일 인물 시리즈. MenuCard 아이콘/tag 제거. /generate 좌측 패널 재구성 (Lightning 단독 + SizeCard 분리). StylePreset 인프라 신설 (활성 0 · 시도 #1 보류). Extra LoRA 교체: FemNude → female-body-beauty_qwen.
- **클립보드 Paste + Compare hybrid fallback**. 전역 Ctrl+V 로 스크린샷 업로드. Compare 페이지 호버 슬롯 우선 + 페이지 fallback (A 비면 A · B 비면 B).

## 2026-04-24

- **메뉴 UX v2 통일** (`207ae77`, 11 commit). 4 페이지 결과/히스토리/레이아웃 일괄 통일. 공용 컴포넌트 6개 신설 (HistoryGallery / SectionHeader / HistorySectionHeader / ResultHoverActionBar / ResultInfoModal / BeforeAfterSlider). DB 스키마 v5 (adult/duration_sec/fps/frame_count). Generate 입력 UX: Step/CFG/Seed UI 제거 (백엔드 자동 + seed 매번 랜덤).
- **Edit 비교 분석** (`45b6e2e`, 19 commit). qwen2.5vl 5축 평가 + 영구 저장 + UI 통합 + BeforeAfter 일관성 규칙.
- **UI Consistency Audit (P0+P1+R1+R2+R3)**. 디자인 시스템 중추 완성. 토큰 6단계 (`--radius-sm/md/card/lg/xl/full`) + 기능 토큰 3개. 공용 shell 5개 (StudioResultHeader/Card/Empty/Loading/UploadSlot). radius 하드코딩 76건 토큰화. edit-source + result 파일 orphan cleanup (path traversal 4-layer 방어).
- **Vision Compare 메뉴 신설** (`/vision/compare`). Edit 무영향 백엔드 격리 (analyze_pair_generic). 메인 메뉴 3카테고리 6카드 그리드.
- **LTX Video 2.3 추가** (`027817d`). 성인 모드 + 해상도 슬라이더 + Lightning 토글. 얼굴 drift 미해결 보류.
- **Codex 교차리뷰 fix 머지**. video mode 필터 4-layer 통일 · SSE lifecycle 정리 · 3 훅 finally 보강 · HistoryBootstrap 재시도 · HistoryTile 옵티미스틱 롤백.

## 2026-04-22

- **전면 재설계 완료** (Phase 1+2 merged, `5ff36bf`). 신규 구조 `backend/studio/` + `frontend/components/studio/` + 4 route pages. 레거시 코드 (`backend/services/*`, `frontend/components/{Creation,History,Settings}Panel.tsx`) 보존만 — 직접 수정 금지.

## 그 이전 — Phase 1 + Phase F + 기타

- 초기 개발 단계 (Phase A-E) → Phase F 리팩토링 (22건 리뷰) → Phase F+ 픽스 (회귀 8건) → 재설계 직전. 자세한 내역은 memory archive 참조.
