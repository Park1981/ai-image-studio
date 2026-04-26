# AI Image Studio

## Project
Local AI image generation WebUI.
Next.js 16 (App Router) frontend + FastAPI backend + ComfyUI API + Ollama LLM.
Windows 11 로컬 환경 전용 (RTX 4070 Ti SUPER 16GB VRAM).

**2026-04-22 전면 재설계 완료** — Phase 1+2 merged to master (HEAD around `5ff36bf`).
신규 구조는 `backend/studio/` + `frontend/components/studio/` + 4 route pages.
레거시 코드 (`backend/services/*`, `frontend/components/{Creation,History,Settings}Panel.tsx` 등) 는
참고용으로 보존 — 직접 수정 금지.

**2026-04-24 메뉴 UX v2 통일** — HEAD `207ae77` · 11 커밋.
4 페이지(/generate /edit /video /vision) 결과/히스토리/레이아웃 일괄 통일.
공용 컴포넌트 6개 신설 (HistoryGallery, SectionHeader, HistorySectionHeader, ResultHoverActionBar,
ResultInfoModal, BeforeAfterSlider). DB 스키마 v5 (adult/duration_sec/fps/frame_count 추가).
Generate 입력 UX: Step/CFG/Seed UI 제거(백엔드는 GENERATE_MODEL.defaults 직접 참조 · seed 매번 랜덤).

**2026-04-24 UI Consistency Audit** — `docs/ui-consistency-audit-2026-04-24.md` 참조.
P0+P1a+P1b+R1+R2+R3 완료 · 디자인 시스템 중추 완성 (판매 퀄리티 1차 도달).
- 토큰 6단계 (`--radius-sm/md/card/lg/xl/full`) + 기능 토큰 3개 (`--accent-disabled`, `--bg-dark`, `--overlay-dark`)
- 공용 shell 5개 (`StudioResultHeader/Card/Empty/Loading/UploadSlot`)
- `SourceImageCard` / `CompareImageSlot` 을 StudioUploadSlot 기반으로 재작성
- radius 하드코딩 76건 토큰화 (시각 무변경) · negative letterSpacing 17건 정리
- edit-source + result 파일 orphan cleanup (path traversal 4/5-layer · pytest 130)

**2026-04-25 클립보드 Paste 기능 + Compare fallback** — HEAD `4f40f5c` 기반 + paste fallback 추가.
전역 Ctrl+V 로 스크린샷/클립보드 이미지 바로 업로드. `StudioUploadSlot` 에 `pasteEnabled`/`pasteRequireHover` props.
단일 slot (edit/video/vision) 은 focus 가드로 textarea 충돌 방지 · 멀티 slot (compare) 은 호버 중인 slot 만 응답.
**Compare 페이지 hybrid 정책 추가**: 호버 슬롯 우선 + 호버 없으면 페이지 레벨 fallback (A 비면 A · B 비면 B · 둘 다 차면 토스트 안내).
충돌 방지: 슬롯 핸들러가 처리 시 `e.preventDefault()` → 페이지 핸들러는 `defaultPrevented` 로 skip.
empty 상태 호버 시 kbd 스타일 "Ctrl+V" 힌트 표시.

**2026-04-25 Edit 한 사이클 완성 (spec 14-16)** — HEAD `e39f5f3` · pytest 151/151 · vitest 23/23.
Edit 모드 5단계 흐름이 도메인 슬롯 매트릭스 패러다임으로 통합. 사전(slots)·사후(slots) 시각적 쌍둥이.
- **Step 1 비전 분석 (사전)**: `analyze_edit_source` v2 — 도메인별 5 슬롯 (인물: face_expression/hair/attire/body_pose/background, 물체·풍경: subject/color_material/layout_composition/background_setting/mood_style) × {action: edit|preserve, note}. `clarify_edit_intent` (gemma4 think:False) 가 한국어 자연어 → 영어 1-2 문장 정제 먼저 수행.
- **Step 2 프롬프트 통합**: `SYSTEM_EDIT` 가 STRICT MATRIX DIRECTIVES 블록 받으면 슬롯별 명시적 활용 (preserve 슬롯은 강한 보존 clause, edit 슬롯은 정확 반영). `upgrade_edit_prompt(*, analysis=None)` 옵셔널 인자로 매트릭스 객체 직접 전달.
- **Step 5 비교 분석 (사후)**: `analyze_pair` v3 — 도메인 분기 + 의도 컨텍스트 점수 (보존이면 유사도, 변경이면 의도부합도). 종합 = 5축 산술평균. 옛 row (face_id/body_pose/attire/background/intent_fidelity) 자동 호환.
- **프론트**: `EditVisionBlock` 매트릭스 행 UI 공용 컴포넌트 (AiEnhanceCard/ProgressModal/ImageLightbox 재사용). `ComparisonAnalysisCard/Modal` v3+v1 자동 분기 + 의도 배지 (🔵 변경 / 🟢 보존).
- **호환**: DB 스키마 무변경. 옛 히스토리 row 자동 폴백. `analyze_pair_generic` (Vision Compare) / Generate / Video / Vision Analyzer 영향 0%.
- **한계**: `body_pose` 슬롯이 binary action 이라 "가슴만 변경 + 포즈 보존" 같은 sub-aspect 의도 분리 표현 불가. SYSTEM 프롬프트가 "변경 안 시키면 동일 유지" 메타 지시로 어느 정도 커버.

**2026-04-25 spec 17 — preserve 슬롯 묘사 누출 차단** — HEAD `f386e3a` · pytest 159/159.
사용자 실측: "포즈 변경 요청 안 했는데 결과 포즈가 약간 변형됨" 발견. 원인: `_build_matrix_directive_block` 가 [preserve] 슬롯 note ("the woman is standing with her hands on her hips") 도 SYSTEM 에 흘려서 ComfyUI 가 변경 지시로 오해. **수정**: [preserve] 슬롯 note 와 source summary 를 SYSTEM 에 절대 안 보냄, generic preservation phrasing 만 강제 ("preserve the original X exactly as in the source"). `SYSTEM_EDIT` 가드 강화 — "[preserve] 슬롯에 specific description 금지" + mislead 예시. UI 표시용 slot.note 는 그대로 (사용자 표시 풍부, ComfyUI 입력 안전).

**2026-04-25 진행 모달 prompt 토글 (생성/수정 분리)** — HEAD `4c50f8a`.
`useSettingsStore`: `showUpgradeStep` (1개) → `hideGeneratePrompts` + `hideEditPrompts` (2개) 분리 + 의미 반전 (ON = 안 보이게 / 기본 둘 다 true). persist v2→v3 migrate (옛 사용자 자동 변환). SettingsDrawer 토글 2개 + 툴팁. ProgressModal `EditTimeline` 의 step detail 박스 분기 (`hideEditPrompts=true` 면 안 그림). useGeneratePipeline 의 사전 모달 분기는 `!hideGeneratePrompts` 로 갱신 (false 면 UpgradeConfirmModal 띄움). ImageLightbox InfoPanel / VideoTimeline / Edit step 3 (자동 처리) 는 토글 영향 X (그대로).

**2026-04-25 Headless Launcher (창 0개) + 가동 fix 5건**.
start.bat 실행 시 콘솔 1개만 보이고 나머지 모두 숨김. ComfyUI Electron GUI / Backend PS / Frontend PS / Ollama 작업표시줄 모두 제거. 로그는 `logs/{backend,frontend,comfyui}.log` + `{backend,frontend,comfyui}.err.log` 로 redirect — 디버깅 시 `Get-Content -Wait` 로 tail 가능. **ComfyUI Headless 모드 (4 키 신규)**: `.env` 의 `COMFYUI_PYTHON` + `COMFYUI_MAIN_PY` + `COMFYUI_EXTRA_PATHS_CONFIG` + `COMFYUI_BASE_DIR` 모두 설정되면 venv python 으로 main.py 직접 호출 (`--listen --port --extra-model-paths-config --disable-auto-launch --base-directory`) → Electron 안 띄움. 사용자 시스템 추가 setup: `comfyui-frontend-package` (PyPI) 한 번 설치 필요 (Desktop 의 자동 frontend 갱신 우회). 폴백: 위 키 중 하나라도 비면 `COMFYUI_EXECUTABLE` (Electron GUI). 가동 시 발견된 5 fix 적용:
1. **lifespan ComfyUI 시작 비차단**: `await start_comfyui` → `asyncio.create_task` (backend 즉시 listen)
2. **start.ps1 Wait-ForUrl → Wait-ForPort**: HTTP polling 대신 TCP listen 체크 (PowerShell HTTP client timeout 누적 회피)
3. **ComfyUI stdout/stderr → logs/comfyui.log redirect**: subprocess.DEVNULL 이 일부 native lib 와 호환 안 되어 즉시 종료되던 문제 해결
4. **`--base-directory C:/ComfyUI` 인자**: Desktop 의 yaml 이 자체 포맷이라 표준 ComfyUI 모델 폴더 인식 못함 → `--base-directory` 로 표준 구조 자동 인식
5. **globals.css `@import` 순서**: Tailwind v4 가 `@import "tailwindcss"` 펼치면서 layers 생성 → 외부 Google Fonts/Pretendard `@import` 가 그 뒤에 위치해 PostCSS 거부 → 외부 fonts 먼저 / tailwind 마지막 순서로 변경.

**2026-04-25 UI Polish (메인 + 4 라우트 + MenuCard)**.
1. 메인 페이지: 상단 mono "Local Runtime · ComfyUI..." 스트립 제거 + 헤딩 "어떤 걸 만들까요?" → **"AI Image Studio"** + 메뉴 배경 이미지 6개 동일 인물 시리즈로 통일 (`new_menu/` → `menu/` 스위치, 기존은 `_archive/` 보존)
2. MenuCard: 좌상단 아이콘 pill + 우상단 tag (NEW / LTX-2.3 / 준비중) 모두 제거 — 사진이 의미 전달, disabled 는 grayscale + "곧 만나요" 만
3. /edit + /video 좌측 패널 PipelineSteps 박스 제거 (실행 중에는 ProgressModal 이 primary)
4. /video 진입 시 `lastVideoRef ?? videoResults[0]` fallback 제거 → `lastVideoRef ?? null` (generate/edit/vision 과 동일 패턴, 첫 진입 빈 상태)
5. /generate 좌측 패널 재구성: "고급" accordion 헤더 제거 + Lightning Toggle 단독 + 사이즈 단독 카드 (`SizeCard`) 분리. Shift+Enter 라벨/동작 둘 다 제거 (Enter = newline 일관)

**2026-04-25 Generate LoRA 시스템 + extra LoRA 교체**.
- **StylePreset 인프라 (확장형)**: `backend/studio/presets.py::StylePreset` dataclass + `GENERATE_STYLES: list[StylePreset]` 배열. 활성 시 자동으로 (1) sampling override (steps/cfg/sampler/scheduler/shift) (2) LoRA 체인에 추가 (3) trigger_prompt prepend (substring check 후 중복 방지) (4) Lightning 강제 OFF (호환성). frontend `lib/model-presets.ts::GENERATE_STYLES` 동기화 + `useGenerateStore.styleId` + `/generate` request body `styleId` 전달. UI: GENERATE_STYLES 배열 비어있으면 토글 안 그림 (1차 시도 후 보류 시).
- **시도 #1 (보류)**: AI Asian Influencer (`blue_hair_q2512.safetensors`, weight 0.75, Euler A · 25step · cfg 6.0, trigger="east asian girl") — 효과 미약 평가로 보류. 시스템은 유지 (차후 다른 LoRA 추가 시 GENERATE_STYLES 배열에 객체만 push).
- **extra LoRA 교체**: `FemNude_qwen-image-2512_epoch30.safetensors` → **`female-body-beauty_qwen.safetensors`** (strength 1.0). 자연스러운 표현 + sampling override 불필요한 단순 LoRA.

**2026-04-25 Generate Lightning 8/1.5 튜닝** — HEAD `e6547be` + `91348bb`.
Generate Lightning steps 4→8, cfg 1.0→1.5. 사용자 비교 평가 (4/1.0 · 6/1.2 · 8/1.5) 결과 8/1.5 채택 (머리카락 결 / 얼굴 표정 / 니트 텍스처 / 손가락 / 배경 디테일 모두 뚜렷, color over-saturation 없음). 시간 ~2배 (예: 8s → 16s). **백엔드 + 프론트 둘 다 변경 필수**: `backend/studio/presets.py::GENERATE_MODEL.lightning` + `frontend/lib/model-presets.ts::GENERATE_MODEL.lightning` 동기화 (CLAUDE.md "프리셋 정의: 동기화 필수" 규칙 — 첫 시도 때 백엔드만 바꿔서 메타 반영 안 되는 문제 겪음). Edit Lightning 은 4/1.0 그대로 (Edit 결과 만족 상태).

**2026-04-26 헤더 통합 + Vision Recipe v2.1 + 안정성 강화** — pytest 162 · vitest 23 · lint+tsc clean.
- **AppHeader (통합 헤더)**: 6 페이지 TopBar 패턴 → `<AppHeader />` 한 줄. `usePathname()` 자동 분기 (메인 / 메뉴). BackBtn → home 아이콘 (icon-only · tooltip "메인으로"). `frontend/components/chrome/AppHeader.tsx` 신설.
- **SystemMetrics (4-bar 자원 사용률)**: CPU/GPU/VRAM/RAM 헤더 우측 상시 표시. macOS Activity Monitor 색상 매핑 (CPU 빨 / GPU 초 / VRAM 보 / RAM 파). 평소 막대만 → hover 시 살짝 튕기듯 (CSS class 토글 패턴 · `globals.css` 의 `.ais-metrics:hover` selector + delay 시퀀스). `frontend/components/chrome/SystemMetrics.tsx` 신설. 사용량 표기: `78.1` 굵게 / `/96G` 옅게 (시각 위계).
- **SystemStatusChip (ComfyUI 가동 표시)**: `useProcessStore.comfyui` 구독. stopped → 🔵 점멸 + "ComfyUI 준비 중…" 상시. running 전환 → 🟢 "준비 완료" 2초 후 fade out. `frontend/components/chrome/SystemStatusChip.tsx` 신설.
- **VramBadge 그래픽화**: 텍스트 → 미니 bar (38×5px) + 사용량(`11.4G`) + 사용률 임계 amber 색.
- **메인 풋터 (카피라이트)**: 하단 스트립 (VramBadge + 최근 생성 + 설정 안내) 제거 → 멋스러운 풋터 (제품명 대문자 letter-spacing + © 2026 · v1.2.4 · N generations + 빌드 스택).
- **메인 다이어트**: padding/heading/footer 합산 ~80px 절약 (1154px viewport 풋터 fully 가시).
- **HistoryGallery 가로 흐름 + height-aware Masonry**: CSS columns (세로 우선) → JS column 분배 (가로 우선). 누적 height 가장 짧은 컬럼에 다음 item greedy 추가 → 진짜 Masonry wall 효과. /generate /edit /video 의 갤러리 박스 `maxHeight: 55vh + overflowY:auto` 제거 → 자연 페이지 스크롤 (날짜 섹션 접기 + 가로 흐름이 정보 밀도 관리).
- **Backend system_metrics 모듈 신설**: `backend/studio/system_metrics.py` (psutil + nvidia-smi 병렬 측정 · CPU/RAM/GPU%/VRAM 통합). `/process/status` 응답 확장: `comfyui.{vram_used_gb, vram_total_gb, gpu_percent}` + `system.{cpu_percent, ram_used_gb, ram_total_gb}`. 옛 `used_gb/total_gb` 필드명 → 신 `vram_used_gb/vram_total_gb` 명시. `psutil 7.2.2` 추가 의존성.
- **ComfyUI timeout 대폭 확장**: idle 600→1200s, hard 1800→7200s. 16GB VRAM 풀 퀄리티 (40 step) + swap 케이스 (51분+) 안전 회수. Video 는 그대로 (idle 900 / hard 3600).
- **Vision Recipe v2.1**: SYSTEM_VISION_DETAILED → SYSTEM_VISION_RECIPE_V2 (Codex+Claude 공동 spec). user message `"Describe this image."` → `"Source image attached. Aspect: WxH (label). Produce the recreation recipe..."`. 응답: 9 슬롯 STRICT JSON (`summary` / `positive_prompt` / `negative_prompt` / `composition` / `subject` / `clothing_or_materials` / `environment` / `lighting_camera_style` / `uncertain`). JSON 파싱 실패 시 옛 `SYSTEM_VISION_DETAILED` 폴백 (단락 형태). `_aspect_label()` 헬퍼 (1024×1024 → "1:1 square" 등 근사 매핑).
  - **POSITIVE self-containment 강제**: 모든 슬롯 정보 (lens / palette / lighting setup / framing) 흡수 — 사용자가 POSITIVE 만 복붙해도 정보 손실 0
  - **t2i 친화 톤**: comma-style + 자연어 짧은 문장 혼합 (descriptive paragraph 톤 회피)
  - **Multi-subject 풀 핸들링**: side-by-side / collage / group 등 layout-aware 분석. summary 에 layout 명시 + composition 1급 디테일 + subject numbered list (1) left.. 2) right..) + positive_prompt 도 layout-aware
  - **광역 race 허용**: East Asian / Caucasian / African·Black / South Asian / Hispanic / Middle Eastern 라벨 OK (사용자 결정). 정확 nationality (Korean/Japanese/Chinese) 는 strong cues 시만, 그 외 `uncertain` 처리. 정확 나이 / 이름은 항상 `uncertain`.
  - **풍부한 결과**: positive_prompt 80-200 → 150-300 word (comprehensive · prioritize completeness)
- **VisionResultCard 풀 9 슬롯 UI**: Summary 카드 (한/영 토글) / PromptToggleCard (통합·분리 토글, 한 카드 안 모드 분기 · 시각 위계 안정) / 디테일 6 슬롯 그리드 (구도·피사체·의상·환경·조명·불확실).
  - **PROMPT 토글**: 통합 = A1111 표준 (`positive\n\nNegative prompt: negative` · 외부 SD WebUI/Forge/ComfyUI A1111 노드 호환) / 분리 = hairline 으로 구분된 두 섹션 (자체 헤더 + 복사 버튼)
  - **옛 v1 row 자동 폴백**: `positivePrompt` 비면 옛 영/한 탭 단락 카드 표시 (사용자 인지 비용 0)
- **types/store 확장**: `VisionRecipeV2` interface + `VisionAnalysisResponse extends VisionRecipeV2`. `useVisionStore` 의 `VisionEntry` + `VisionResult` 9 슬롯 옵셔널 필드. `useVisionPipeline` 응답 매핑. `useProcessStore` 에 cpu/ram/gpu 필드 + `applyStatus({ollama, comfyui, vram, ram, gpuPercent, cpuPercent})` 시그니처 변경.
- **테스트**: pytest 159→162 (`_aspect_label` / vision recipe v2 happy path / JSON parse 실패 폴백 3 케이스 추가).

**2026-04-26 (후속) Compare v2.2 + Ollama keep_alive=0** — pytest 162 · vitest 23 · lint+tsc clean.
- **Vision Compare v2.2** (Codex+Claude 공동 spec):
  - **점수 calibration rubric** 5단계 (95-100 nearly identical / 90-94 very close / 80-89 clear differences / 60-79 major changes / <60 substantial mismatch). "Default to LOW end when unsure. Under-score before over-score." 명시.
  - **Subject 하드 캡** (recreation fidelity 보호): GAZE 변화 → ≤90 / HEAD ANGLE → ≤88 / FACIAL EXPRESSION → ≤88 / POSE → ≤88 / 2개 이상 동시 → ≤82. "DO NOT give subject > 90 if pose/gaze/angle/expression differ — even when identity, clothing, background look the same."
  - **Quality 의미 명확화**: "technical similarity, NOT 'which is better'". 둘 다 high 면 high stay, but 코멘트는 parity 묘사.
  - **풍부 묘사**: 각 축 1-2 → 3-5 sentences. 구체적 디테일 (gaze direction, head angle, expression specifics) 명시.
  - **transform_prompt 슬롯 신설**: A → B 변형 t2i 지시 (e.g. "shift gaze upward 30°, soften smile..."). 95+ 동일 시 "no significant changes — visually equivalent".
  - **uncertain 슬롯 신설**: 비교 못한 영역 명시 (없으면 "").
  - **format: "json"** 추가 (Vision Recipe v2 와 일관).
  - **SYSTEM 단축 v2.1→v2.2**: 200+ 줄 → 80 줄 (lost-in-middle 회피). ABSOLUTE REQUIREMENTS 섹션 추가 — 모든 점수 필드 0-100 정수 강제 + null/missing 금지. v2.1 첫 시도 시 모델이 점수 누락 (종합 0%) 한 사례 fix.
  - **Vision Recipe v2 example 교체**: 단일 centered portrait 예시 → 4 도메인 예시 (off-center 인물 / top-down 음식 / 항공 풍경 / 매크로 제품). "Match shape to actual domain — DO NOT default to centered portrait phrasing for non-portrait images." 강조.
- **VisionCompareAnalysis 확장**: `transform_prompt_en/ko` + `uncertain_en/ko` 옵셔널 필드. 번역 묶음에 `extra_sections` 인자 추가 (transform/uncertain 도 동일 호출에서 한국어 번역).
- **Frontend `/vision/compare` UI**: TransformPromptBox 신설 (보라색 left-bar · 영문 우선 복사 + 한국어 메인 + 영문 옅게 표시) · UncertainBox 신설 (회색 톤). Summary 카드 다음에 배치.
- **Ollama keep_alive=0** (CRITICAL — VRAM 안정성):
  - 16GB VRAM 환경에서 Ollama 가 비전 분석 후 14GB 5분 점유 (default keep_alive=5m) → ComfyUI 와 swap 충돌 → 무한 로딩 사례 발견.
  - **모든 Ollama `/api/chat` payload 에 `"keep_alive": 0` 추가** (7 호출):
    `vision_pipeline._describe_image` / `_call_vision_edit_source` / `_call_vision_recipe_v2` /
    `comparison_pipeline._call_vision_pair` / `_call_vision_pair_generic` / `_translate_comments_to_ko` /
    `prompt_pipeline._chat_text_only`
  - Vision (qwen2.5vl 14GB) + Text (gemma4-un 16GB) 모두 적용 — 응답 직후 unload, VRAM 즉시 반납.
  - Trade-off: 다음 호출 시 모델 재로드 ~5초 (ComfyUI 30초+ 컨텍스트라 영향 미미). 안정성 압도적 우선.
  - 검증: 강제 unload (`POST /api/generate keep_alive:0`) → VRAM 15.4GB → 1.3GB 즉시 반납 확인.
  - CLAUDE.md "Ollama: 온디맨드 호출 + VRAM 즉시 반납" 의도와 일치.
- **테스트**: pytest 162 (회귀 0) · vitest 23 · lint+tsc clean.

**2026-04-26 (후속 2) Codex 3가지 미세 fix** — pytest 162→166 · vitest 23.
- **`_coerce_score` 문자열 방어** (CRITICAL): 모델이 `"95"` / `"95%"` / `"95/100"` / `"85 (high)"` 같은 문자열로 응답해도 정상 파싱 (이전엔 None → 종합 0% 버그). string strip + `%` / `/100` / `(...)` 제거 + float 변환. `_coerce_scores` 도 `_coerce_score` 헬퍼 위임 → 일관 적용.
- **keep_alive 타입 통일**: int `0` → str `"0"` (7 호출 모두). Ollama spec duration 형식 일관성 (옛 코드 패턴 일치 + Ollama 명시적 표준).
- **transform_prompt 트리거 조건 명확화**: "A and B are 95+ identical" 모호 → "ALL 5 axes >= 95 (composition / color / subject (no caps) / mono / quality)" 명시. 임의 axis < 95 면 구체 변경 묘사 강제. "no significant changes" 남발 차단.
- **pytest 보강**: `_coerce_score` 단위 테스트 4 케이스 추가 (int/float / string variants / invalid → None / dict 통합).

**2026-04-26 (후속 3) VRAM Breakdown 오버레이 + 막대 100% 길게 + 위험 그라데이션** — pytest 166 · tsc+lint clean.
사용자 제안: "VRAM 임계 넘을 때 ComfyUI/Ollama 어떤 모델 점유 중인지 헤더에 자세히 보고 싶다." → 80% 임계 진입 시 막대 하단 오버레이 fade-in.
- **Backend 신규 모듈 `backend/studio/dispatch_state.py`**: ComfyUI 마지막 dispatch 모델 캐시 (단순 모듈 변수 + record/get/clear). router.py 의 generate/edit/video 진입 시점에 `dispatch_state.record(mode, model.display_name)` 호출 (3 endpoint).
- **Backend `system_metrics.py::get_vram_breakdown()`**: nvidia-smi `--query-compute-apps=pid,process_name,used_memory` + Ollama `/api/ps` 병렬 호출. 프로세스별 VRAM 분류 (ComfyUI / Ollama / 기타). PID 매칭 정확 + process_name 휴리스틱 폴백.
- **🔑 Windows 권한 정책 폴백** (CRITICAL): Windows 11 보안 정책으로 일반 사용자 권한 nvidia-smi 의 `used_gpu_memory` 컬럼이 모두 `[N/A]` 반환 (관리자 권한만 GB 값 노출). 우리 코드는 ValueError 로 skip → 모든 분류 0G. **폴백**: `total_used_gb - (ollama_total_gb + other_gb)` 차이를 ComfyUI 로 추정. `ollama_total_gb = max(nvidia-smi 매칭, /api/ps size_vram 합)` — 두 측정원 max 로 swap 케이스 (Ollama 동시 점유) 도 정확 분리. 합산이 물리 VRAM 한계 안으로 수렴.
- **`process_manager.comfyui_pid` property**: subprocess.Popen 의 PID 노출 (외부 기동이면 None). breakdown 의 정확 PID 매칭에 활용.
- **`/process/status` 응답 확장**: `vram_breakdown: {comfyui:{vram_gb,models,last_mode?}, ollama:{vram_gb,models[{name,size_vram_gb,expires_in_sec}]}, other_gb}` 항상 포함 (실패 graceful · 빈 객체).
- **Frontend `VramBreakdown` 타입** + `useProcessStore.vramBreakdown` 필드 + `AppShell` 폴러 5초 주기 동기화.
- **SystemMetrics VRAM 임계 오버레이** (`>= 80%` + breakdown 있을 때만): 막대 하단 fade-in. ComfyUI 줄 (모델명 + 모드 한글) / Ollama 줄 (모델별 · expires 한글 — "4분 후 unload") / 기타 줄. **0.0G row 자체 숨김** (사용자 요청 — 모두 0 이면 오버레이 자체 안 그림).
- **막대 시각 개편**: width 22→44px (collapsed) / 56→112px (hover). 색상 정책 3단계 — `0-80%` solid 고유색 / `80-90%` 끝쪽 amber linear-gradient / `90-100%` 끝쪽 빨강 그라데이션 (Tailwind red-600 #DC2626). 1차 시도 oklab mix 결함 회피 — 메트릭 색을 출발점으로 유지해 정체성 보존 + 끝쪽만 위험 색 강조.
- **CPU 색상 빨강 → 시안** (#06B6D4 Tailwind cyan-500): 90%+ 위험 빨강 그라데이션과 시각 충돌 회피 ("CPU 임계인 줄 알았는데 평상시" 차단). 빨/주/노 영역은 임계 신호 전용으로 비움. RAM 파랑(sky-blue)과 청록계로 충분히 구분.
- **VramBadge amber 임계 통일**: 0.75 → 0.80 (SystemMetrics 와 일치 · breakdown 오버레이 트리거와 동일).
- **검증**: pytest 166/166 · tsc clean · lint clean · 실측 backend 응답 확인 (ComfyUI 15.2G + Ollama 0G 정상 표시, 폴백 작동).

**2026-04-26 spec 19 — 비전 + gemma4 + Claude CLI 시스템 프롬프트 통합 점검** — pytest 166→197 · tsc+lint clean.
사용자 요청 (Codex + Claude 점검 합산) → 4 라운드 누적 작업. 비전 시스템 프롬프트 점검 → gemma4/Claude CLI 점검 → Ollama race fix → upgrade-only aspect.
- **신규 모듈 3개**: `backend/studio/_json_utils.py` (parse_strict_json 통합 · quoted-string aware scanner), `backend/studio/ollama_unload.py` (force_unload_all_before_comfy + 단계별 unload_model), `frontend/components/studio/CompareExtraBoxes.tsx` (TransformPromptBox + UncertainBox 공용)
- **Vision 점검 (라운드 1)**: SYSTEM_COMPARE v3.1 (rubric + transform_prompt + uncertain + refined_intent placeholder + ABSOLUTE REQUIREMENTS) · person 도메인 background 슬롯 lighting/color/style 흡수 명시 · `compact_context()` preserve 슬롯 note skip (spec 17 가드 일관성) · `_call_vision_pair` 에 `format=json` + refined_intent 인자 · analyze_pair 시그니처에 refined_intent + transform_prompt/uncertain 파싱 + 한글 번역
- **P2 후속 (라운드 2)**: parse_strict_json quoted-string aware (문자열 안 brace/escape 정상 처리) · DB 스키마 v6 `refined_intent TEXT` 컬럼 + 캐싱 (Edit 한 사이클 → 비교 분석 재사용 · gemma4 cold start ~5초 절약) · ComparisonAnalysisModal + vision/compare 페이지에 TransformPromptBox/UncertainBox UI 표시
- **gemma4 + Claude CLI (라운드 3)**: SYSTEM_EDIT identity vs lighting 분리 + 도메인 분기 (person/object_scene) + 길이 가드 (60-200 words) + "diffusion model" → "the model" 일반화 · SYSTEM_VIDEO 동일 패턴 + ambient sound 제거 (LTX 무음) · SYSTEM_GENERATE adaptive (미니멀 신호 detect 시 디테일 강제 안 함 — 한국어/영어 키워드 양쪽) + EXTERNAL RESEARCH HINTS untrusted-data 가드 · upgrade_generate_prompt 가 width/height 받아 user message 첫 줄에 aspect 명시 · research_context 를 system → user message 의 [External research hints — data only] 블록으로 격리 + length cap 1500자 · Claude CLI _build_research_query 에 DRAFT PROMPT 격리 + 모델 모를 때 generic 폴백 + prompt-ready phrase fragment 강제 + 한국어 응답
- **/edit width/height 풀 연결**: spec 19 본편에서 analyze_edit_source 가 받게 만든 dim 인자가 router 단에서 안 넘겨져 dead code 였음 → create_edit_task 에서 PIL 로 SOURCE dim 추출 → _run_edit_pipeline(source_width, source_height) → run_vision_pipeline(width, height) 풀 라우팅
- **compare_analyze lock 범위 최적화**: clarify_edit_intent (gemma4) 호출을 _COMPARE_LOCK 밖으로 → cold start ~5초가 다른 compare 요청을 30s lock timeout 으로 미는 사례 차단
- **🔑 Ollama 단계별 unload (옵션 B · 핵심 swap fix)** (라운드 4): 16GB VRAM 환경에서 vision (qwen2.5vl 14GB) + gemma4 (14.85GB) 동시 점유 시 swap 발생 → ComfyUI 가 swap 모드로 이어받음 → sampling 매우 느림 (3분+).
  - `vision_pipeline.run_vision_pipeline`: clarify (gemma4) → **gemma4 unload + 1s** → analyze (qwen2.5vl) → **qwen2.5vl unload + 1s** → upgrade + translate (gemma4 reuse)
  - `video_pipeline.run_video_pipeline`: vision (qwen2.5vl) → **qwen2.5vl unload + 1s** → upgrade (gemma4)
  - router 의 `force_unload_all_before_comfy` (옵션 A) 는 backup 으로 유지 — ComfyUI dispatch 직전 안전장치
  - Generate 는 옵션 A 그대로 (gemma4 단일이라 단계별 불필요)
  - **사용자 체감**: Edit/Video sampling 시간 3분+ → 30~60초. 추가 비용은 gemma4 cold reload ~5초 + 단계 대기 2초 (ComfyUI 30+ 초 작업 대비 무시 가능)
- **`/upgrade-only` aspect 전달 (Codex 추가 fix)**: UpgradeOnlyBody 에 aspect/width/height 필드 + frontend upgradeOnly() params + useGeneratePipeline initial+rerun 두 호출 → "업그레이드 확인 모달" 사용 시에도 SYSTEM_GENERATE 에 size context 정확 전달
- **`backend/services/prompt_engine.py` deprecation 명시**: 모듈 docstring 에 deprecation 블록 (실제 코드 무변경 — main.py 의 routers/{prompt,generate}.py 등록은 유지). 신규 frontend 는 lib/api-client.ts 만 사용 → 옛 라우터는 fallback 으로만 활성
- **검증**: pytest 166→197 (회귀 0 · 누적 +31 신규 테스트)

## Architecture (신규 · 재설계 후)
- frontend/: Next.js 16, App Router, React 19, TypeScript strict, Tailwind v4, Zustand 5
- backend/: FastAPI, Python 3.13, httpx + websockets + aiosqlite + pydantic-settings
- External: ComfyUI Desktop (:8000), Ollama (:11434)
- 백엔드 포트 8001 (config 에선 8000이 기본이지만 ComfyUI 가 선점 → uvicorn `--port 8001` 필수)
- Process: Ollama 상시 실행 / ComfyUI 는 backend lifespan 에서 자동 시작
- **Launcher**: `start.bat` 실행 시 콘솔 1개만 보임 (start.bat 자체) · Backend/Frontend/Ollama 모두 Hidden · ComfyUI Headless Python 직접 호출 (Electron GUI 없음) · 로그는 `logs/*.log` 에서 확인

## Commands
- Frontend dev (실 백엔드 연결): `$env:NEXT_PUBLIC_USE_MOCK="false"; $env:NEXT_PUBLIC_STUDIO_API="http://localhost:8001"; cd frontend && npm run dev`
- Frontend dev (Mock): `cd frontend && npm run dev`
- Backend dev: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --no-access-log`
- Frontend lint: `cd frontend && npm run lint`
- Backend test: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/` (159 tests · Edit 한 사이클 v3 + spec 17)

## Code Style
- Korean comments in ALL files (한글 주석 필수)
- Python: snake_case, type hints required
- TypeScript: camelCase vars, PascalCase components, strict mode
- 신규 studio 코드: 디자인 토큰 (CSS vars) + 인라인 스타일 + Tailwind 혼합 (Claude Design 핸드오프 기반)
- Imports: absolute paths (@/), group by stdlib → external → internal
- Error messages: 한국어로 사용자에게 표시 + Toast 시스템

## Key Files (재설계 이후)
### 신규 (권위)
- **backend/studio/router.py**: `/api/studio/*` FastAPI 라우터 (generate/edit/**video** SSE · upgrade-only · research · interrupt · vision-analyze · **compare-analyze** · history · models · process · ollama/models)
- **backend/studio/comfy_api_builder.py**: ComfyUI flat API format 빌더 (`build_generate_from_request`, `build_edit_from_request`, **`build_video_from_request`**)
- **backend/studio/comfy_transport.py**: WebSocket + HTTP 전송 (idle 600s / hard 1800s timeout · Video 는 idle 900s / hard 3600s)
- **backend/studio/{prompt,vision,video,comparison}_pipeline.py**: Ollama gemma4 업그레이드 + qwen2.5vl 비전 · Video 는 5-step 체이닝 · **vision_pipeline.analyze_edit_source v2 (인물/물체·풍경 5 슬롯 매트릭스 · 2026-04-25 spec 15)** · **prompt_pipeline.clarify_edit_intent + SYSTEM_EDIT STRICT MATRIX DIRECTIVES (2026-04-25 spec 16)** · **comparison_pipeline 은 2 context 분리 (analyze_pair v3 = Edit 도메인 분기 + 의도 컨텍스트 점수 / analyze_pair_generic = Vision Compare · SYSTEM 프롬프트와 5축 모두 별도 · Edit 무영향 보장)**
- **backend/studio/presets.py**: Qwen Image 2512 / Edit 2511 / **LTX Video 2.3** 프리셋 (프론트와 동기화 필수) · `compute_video_resize`, `build_quality_sigmas`, `active_video_loras` 헬퍼 포함
- **backend/studio/history_db.py**: SQLite studio_history 테이블 (mode: generate/edit/**video**) · **source_ref + comparison_analysis + v5: adult/duration_sec/fps/frame_count 컬럼** (video 메타 · idempotent ALTER 마이그레이션)
- **backend/workflows/qwen_image_2512.json, qwen_image_edit_2511.json**: 워크플로우 참조 (디스패치는 comfy_api_builder 가 Python 으로 구성 · Video 는 38-node flat API 전부 Python 조립)
- **frontend/app/{page,generate,edit,video,vision,vision/compare}/page.tsx**: 6 라우트 · 모두 페이지 최소너비 `1024` + grid `"400px minmax(624px, 1fr)"` 통일 · 메인 page 는 3카테고리(이미지/비전/영상) × 2카드 그리드 (Image:생성/수정 · Vision:분석/비교 · Video:생성/업스케일(준비중))
- **frontend/components/studio/\*** (2026-04-24 이전): AiEnhanceCard(미사용·보존), HistoryTile(아이콘 only hover 바), ImageLightbox (video 분기 + InfoPanel + 비교 분석 조건부 + BeforeAfter 토글), ProgressModal, UpgradeConfirmModal, VideoPlayerCard(+크게 버튼), **ComparisonAnalysisCard, ComparisonAnalysisModal**
- **frontend/components/studio/\*** (2026-04-24 신설 · 공용): **HistoryGallery** (Masonry+날짜섹션 · generate/edit/video), **SectionHeader** (섹션 접기헤더 · HistoryGallery+VisionHistoryList 공유), **HistorySectionHeader** (히스토리 헤더 템플릿 · 4메뉴 통일), **ResultHoverActionBar** (+ActionBarButton · 호버 글래스바), **ResultInfoModal** (애플시트 스프링 · 보존), **BeforeAfterSlider** (edit 지역 컴포넌트 공용화 · Lightbox 비교 토글 재사용)
- **frontend/components/studio/EditVisionBlock.tsx** (2026-04-25 신설 · 공용): Edit 비전 매트릭스 행 UI (수정 의도 + 슬롯별 🔵수정/🟢보존 배지 + note · 인물 5 / 물체·풍경 5 도메인 분기). `AiEnhanceCard` / `ProgressModal` (edit step 1) / `ImageLightbox` (edit) 셋이 재사용. `showHeader` / `showBackground` props 로 컨텍스트별 레이아웃 분기.
- **frontend/lib/date-sections.ts**: 제네릭 `groupByDate<T extends { createdAt: number }>` + `isClosedSection` (HistoryGallery + VisionHistoryList 공유)
- **frontend/hooks/useComparisonAnalysis.ts**: 비교 분석 트리거 + per-item busy guard + VRAM 임계 (>13GB skip) + 결과 store inline patch
- **frontend/hooks/useGeneratePipeline.ts**: 스트림 실행 + 업그레이드 모달 + **researchPreview** state (loading/hints/error/run · ResearchBanner 인라인 결과 용)
- **frontend/lib/{api-client,model-presets,image-actions}.ts**: 핵심 프론트 유틸 · **lib/api/compare.ts** (compareAnalyze) · image-actions fetch 는 `cache:"no-store"` 로 CORS 캐시 우회
- **frontend/stores/use*Store.ts**: Zustand 8개 (settings/process/history/generate/edit/**video**/**visionCompare**/toast) · `useVideoStore` 에 adult/longerEdge/lightning 토글 + computeVideoResize 헬퍼 · `useSettingsStore` 에 `autoCompareAnalysis` 토글 · `useGenerateStore` 는 v3 (steps/cfg/seed 필드 제거, migrate 로 옛 값 자동 삭제) · `useVisionCompareStore` 는 persist X 완전 휘발 (페이지 떠나면 모두 사라짐)
- **frontend/app/globals.css**: 디자인 토큰 (warm neutral + cool blue) + `@keyframes fade-in`

### 레거시 (참조용 · 수정 금지)
- backend/services/*, backend/routers/*, frontend/components/{Creation,History,Settings}*.tsx, frontend/hooks/*, frontend/stores/slices/*, frontend/lib/api.ts

## Rules
- workflow JSON 템플릿은 코드로 직접 수정하지 말 것 (사용자에게 확인)
- ComfyUI/Ollama URL은 .env에서 config.py로 로드 (하드코딩 금지)
- 외부 API 호출(ComfyUI, Ollama)은 반드시 try/except + 타임아웃
- subprocess 호출 시 shell=False 필수, 경로 화이트리스트
- 새 의존성 추가 전 사용자에게 확인
- 디자인 토큰 변경 시 사용자 피드백 필수
- 이미지 경로 파라미터는 path traversal 방지 검증 필수
- CORS: localhost만 허용
- **gemma4-un 호출 시 `think: false` 필수** (reasoning 모델이라 없으면 content 빈값)
- **Video LTX-2.3 는 공간 해상도 8배수 필수** (compute_video_resize 가 자동 스냅)
- **🔑 Edit/Video pipeline 단계별 unload 필수** (spec 19 옵션 B): 16GB VRAM 환경에서 vision (qwen2.5vl) + text (gemma4) 동시 점유 → swap 발생 → ComfyUI sampling 매우 느림. vision_pipeline / video_pipeline 안에서 모델 전환마다 `ollama_unload.unload_model + asyncio.sleep(1.0)` 호출. ComfyUI dispatch 직전엔 router 가 `ollama_unload.force_unload_all_before_comfy()` (옵션 A backup). 이 패턴 깨면 swap 재발 가능.
- **Ollama keep_alive 호출 형식**: `/api/chat` 은 string `"0"` 으로 보내지만 즉시 unload 안 보장 (deferred). 명시적 강제 unload 는 반드시 `/api/generate` + int `0` 사용 (`ollama_unload.unload_model` 헬퍼 활용).

## Testing
- Backend: pytest + httpx AsyncClient
- Frontend: vitest + React Testing Library
- ComfyUI 관련: mock client로 테스트 (실제 ComfyUI 불필요)

## Browser Testing (Chrome 자동화)
- 이미지 생성/수정/AI보강 테스트: 스크린샷 최소 **3분 간격**, 중간은 JS/read_page로 상태 확인
- 레이아웃/UI 수정 등 일반 테스트: 스크린샷 간격 제한 없음
- 스크린샷 누적으로 2000px 멀티이미지 제한 주의 — 가능하면 텍스트 기반 확인 우선
- ComfyUI 작업(생성/수정)은 시간이 오래 걸리므로 충분히 대기 후 결과 확인

## Code Review (Codex 연동)
- 구현/수정 완료 후 codex:codex-rescue 에이전트에게 리뷰 요청
- Codex 피드백 반영 후 상호 보완하여 품질 향상
- 대규모 코드 분석, 갭 분석 등 토큰 소모가 큰 작업도 Codex에 위임 가능

## Model System (재설계 · 2026-04-22 · Video 추가 2026-04-24)
- 생성 모드: **Qwen Image 2512** (diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors)
  - Lightning LoRA: `Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors` (토글)
  - Extra LoRA: **`female-body-beauty_qwen.safetensors`** (상시 strength 1) · 2026-04-25 교체 (FemNude 에서 변경)
  - **Lightning steps/cfg = 8 / 1.5** (2026-04-25 픽스 · 4/1.0 의 블러 개선 · 비교 평가로 확정)
  - **Style LoRA 시스템 (확장형, 활성 0개)**: `GENERATE_STYLES: list[StylePreset]` — 토글 시 sampling override + LoRA 체인 + trigger prepend + Lightning 강제 OFF. 차후 추가 시 배열에 객체 push.
- 수정 모드: **Qwen Image Edit 2511** (diffusion_models/qwen_image_edit_2511_bf16.safetensors)
  - Lightning LoRA: `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` (토글)
  - Extra LoRA: `SexGod_CouplesNudity_QwenEdit_2511_v1.safetensors` (상시 strength 0.7)
  - Lightning steps/cfg = 4 / 1.0 (Edit 결과 만족 상태 — 그대로 유지)
- 영상 모드: **LTX Video 2.3** (ltx-2.3-22b-dev-fp8.safetensors, 29GB · 16GB VRAM 한계)
  - Text Encoder: `gemma_3_12B_it_fp4_mixed.safetensors`
  - Upscaler: `ltx-2.3-spatial-upscaler-x2-1.1.safetensors`
  - Lightning LoRA (토글): `ltx-2.3-22b-distilled-lora-384.safetensors` × 2 (base/upscale)
  - Adult LoRA (토글): `ltx2310eros_beta.safetensors`
  - 2-stage sampling (base + upscale) · 126 frames (5s × 25fps + 1)
  - 해상도 슬라이더 512~1536 (step 128) · 원본 비율 유지 (8배수 스냅)
- 공통 CLIP: `qwen_2.5_vl_7b_fp8_scaled.safetensors` (qwen_image type)
- 공통 VAE: `qwen_image_vae.safetensors`
- 프롬프트 업그레이드: `gemma4-un:latest` (Ollama · 26B · **think=False 필수**)
- 수정/영상 비전: `qwen2.5vl:7b` (Ollama · 기본값)
- 프리셋 정의: `backend/studio/presets.py` + `frontend/lib/model-presets.ts` (동기화 필수)
- 종횡비 프리셋 (Qwen 권장): 1:1 1328² / 16:9 1664×928 / 9:16 928×1664 / 4:3 1472×1104 / 3:4 1104×1472 / 3:2 1584×1056 / 2:3 1056×1584

## API Endpoints (`/api/studio/*`)
- `POST /generate` + `GET /generate/stream/{id}` (SSE 단계 스트림)
- `POST /edit` (multipart) + `GET /edit/stream/{id}` (SSE 4단계)
- `POST /video` (multipart) + `GET /video/stream/{id}` (SSE 5단계, LTX-2.3 i2v)
  - meta JSON: `{prompt, adult?, lightning?, longerEdge?, ollamaModel?, visionModel?}`
- `POST /upgrade-only` (gemma4 업그레이드만, showUpgradeStep 토글 ON 시 사용)
- `POST /research` (Claude CLI 조사 힌트)
- `POST /interrupt` (ComfyUI 전역 중단)
- `POST /vision-analyze` (Vision Analyzer 독립 페이지)
- `POST /compare-analyze` (multipart source+result+meta) — qwen2.5vl multi-image 평가 (2 context 분리)
  - meta JSON Edit context (default): `{editPrompt, historyItemId?, visionModel?, ollamaModel?}` — analyze_pair() v3 · 도메인 분기 + 5 슬롯 매트릭스 + 의도 컨텍스트 점수 (보존이면 유사도 / 변경이면 의도부합도)
  - meta JSON Vision Compare context: `{context: "compare", compareHint?, visionModel?, ollamaModel?}` — analyze_pair_generic() · 5축 composition/color/subject/mood/quality · historyItemId 미전송 = 완전 휘발
  - 응답: `{analysis: ComparisonAnalysis | VisionCompareAnalysis, saved: bool}` · HTTP 200 원칙 (fallback 보장) · 옛 row (face_id/body_pose/attire/background/intent_fidelity) 자동 호환
  - asyncio.Lock + 30s timeout → 503 (ComfyUI 샘플링과 직렬화)
- `GET /models`, `GET /ollama/models`
- `GET /process/status`, `POST /process/{ollama|comfyui}/{start|stop}`
- `GET/DELETE /history[/{id}]`

## Git
- Branch: feature/{module}-{description} 또는 worktree `claude/{name}`
- Commit: type(scope): description (Korean OK)
- Merge: `--no-ff` merge commit 사용 (기존 관례)
- No force push to main

## Design Doc
- `docs/superpowers/specs/2026-04-22-ai-image-studio-redesign-design.md` — 재설계 전체 통합 spec (12 섹션)
- `docs/superpowers/specs/2026-04-24-edit-comparison-analysis-design.md` — Edit 비교 분석 spec (v1 · 5축 유사도)
- `docs/superpowers/plans/2026-04-24-edit-comparison-analysis.md` — 15-task TDD implementation plan
- **`docs/superpowers/specs/2026-04-25-edit-image-analysis-proposal.md` — Edit 한 사이클 v3 통합 spec (16 섹션 합본)**: Codex 초안 (1-13) + Claude 검토 응답 (14) + Phase 1 v2 패러다임 전환 (15: 도메인 슬롯 매트릭스) + 한 사이클 완성 (16: SYSTEM_EDIT 매트릭스 directive + comparison_pipeline v3 도메인 분기 + 의도 컨텍스트 점수)

## UX 규칙 (BeforeAfter 슬라이더)
- /edit 페이지의 Before/After 슬라이더는 오직 진짜 완료된 한 쌍만 표시
- 렌더 조건: `afterItem.sourceRef && afterItem.sourceRef === sourceImage`
- 히스토리 타일 클릭 → `setSource(sourceRef)` + `setAfterId(id)` 동시 실행 (그 수정의 원본 자동 복원)
- 옛 row (sourceRef NULL) 클릭 → toast 안내 + 슬라이더 자동 빈 상태
- useEditPipeline done → `setSource(newItem.sourceRef)` 로 dataURL → backend 영구 URL 교체
- BeforeAfter wrapper 는 **바깥 `flex+justify-center` + 안쪽 `position:relative`** 2-layer 로 가운데 정렬 (세로형 이미지에서 aspectRatio+maxHeight 로 width 축소 시 왼쪽 치우침 방지)
- afterId 전환 시 `compareX` 를 50 으로 자동 리셋 (새 비교 항상 중앙 시작)
- Lightbox 에서 `edit + sourceRef` 있으면 `↔ 비교` 토글 버튼 + `B` 단축키 → BeforeAfterSlider 로 전환

## UX 규칙 (/generate 입력 · 2026-04-24)
- Step/CFG/Seed **UI 노출 X** (고급 accordion 에서도 제거) · 백엔드는 `GENERATE_MODEL.defaults/lightning` 직접 참조 + seed 매번 랜덤
- 비율 잠금 ON 상태에서 프리셋 칩 클릭 → **width 유지 + height 재계산** (프리셋 기본값 덮어쓰지 않음)
- W/H 입력박스 prefix 는 DimInput 으로 overlay (라벨 외부 노출 없음)
- W/H 슬라이더 최소값 **768** (Qwen 권장 하한, 품질 유지 범위)
- 비율잠금 ON 시 H input + H 슬라이더 모두 disabled
- 재생성 (onReuse) 은 prompt + 사이즈 + lightning 만 복원 (seed/steps/cfg 는 UI 제거에 맞춰 복원 제외)

## UX 규칙 (ResearchBanner)
- 결과는 **토스트가 아닌 배너 내부 인라인** 에 표시 (로딩 spinner / 힌트 목록 / 에러 · 휘발 안 됨)
- 버튼 라벨: "힌트 미리 받기" (구체적) · 체크박스 라벨: "Claude 프롬프트 조사" (필요 뉘앙스 제거)
- `researchPreview` state 는 `useGeneratePipeline` 훅에서 관리 → ResearchBanner props 주입
- 힌트 `slice(0,2)` 제한 제거 → **전체 N개** 노출

## 사용자 노출 텍스트 톤
- 모든 placeholder / empty state / toast 는 한국어 존댓말 (공식체)
- 코드 주석 / 로그 메시지는 개발자 톤 그대로 (반말 OK)
