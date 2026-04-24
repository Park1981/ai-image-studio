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

## Architecture (신규 · 재설계 후)
- frontend/: Next.js 16, App Router, React 19, TypeScript strict, Tailwind v4, Zustand 5
- backend/: FastAPI, Python 3.13, httpx + websockets + aiosqlite + pydantic-settings
- External: ComfyUI Desktop (:8000), Ollama (:11434)
- 백엔드 포트 8001 (config 에선 8000이 기본이지만 ComfyUI 가 선점 → uvicorn `--port 8001` 필수)
- Process: Ollama 상시 실행 / ComfyUI 는 backend lifespan 에서 자동 시작

## Commands
- Frontend dev (실 백엔드 연결): `$env:NEXT_PUBLIC_USE_MOCK="false"; $env:NEXT_PUBLIC_STUDIO_API="http://localhost:8001"; cd frontend && npm run dev`
- Frontend dev (Mock): `cd frontend && npm run dev`
- Backend dev: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --no-access-log`
- Frontend lint: `cd frontend && npm run lint`
- Backend test: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/` (91 tests · Edit 비교 분석 추가)

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
- **backend/studio/{prompt,vision,video,comparison}_pipeline.py**: Ollama gemma4 업그레이드 + qwen2.5vl 비전 · Video 는 5-step 체이닝 · **comparison 은 multi-image 5축 평가**
- **backend/studio/presets.py**: Qwen Image 2512 / Edit 2511 / **LTX Video 2.3** 프리셋 (프론트와 동기화 필수) · `compute_video_resize`, `build_quality_sigmas`, `active_video_loras` 헬퍼 포함
- **backend/studio/history_db.py**: SQLite studio_history 테이블 (mode: generate/edit/**video**) · **source_ref + comparison_analysis + v5: adult/duration_sec/fps/frame_count 컬럼** (video 메타 · idempotent ALTER 마이그레이션)
- **backend/workflows/qwen_image_2512.json, qwen_image_edit_2511.json**: 워크플로우 참조 (디스패치는 comfy_api_builder 가 Python 으로 구성 · Video 는 38-node flat API 전부 Python 조립)
- **frontend/app/{page,generate,edit,video,vision}/page.tsx**: 5 라우트 · 모두 페이지 최소너비 `1024` + grid `"400px minmax(624px, 1fr)"` 통일
- **frontend/components/studio/\*** (2026-04-24 이전): AiEnhanceCard(미사용·보존), HistoryTile(아이콘 only hover 바), ImageLightbox (video 분기 + InfoPanel + 비교 분석 조건부 + BeforeAfter 토글), ProgressModal, UpgradeConfirmModal, VideoPlayerCard(+크게 버튼), **ComparisonAnalysisCard, ComparisonAnalysisModal**
- **frontend/components/studio/\*** (2026-04-24 신설 · 공용): **HistoryGallery** (Masonry+날짜섹션 · generate/edit/video), **SectionHeader** (섹션 접기헤더 · HistoryGallery+VisionHistoryList 공유), **HistorySectionHeader** (히스토리 헤더 템플릿 · 4메뉴 통일), **ResultHoverActionBar** (+ActionBarButton · 호버 글래스바), **ResultInfoModal** (애플시트 스프링 · 보존), **BeforeAfterSlider** (edit 지역 컴포넌트 공용화 · Lightbox 비교 토글 재사용)
- **frontend/lib/date-sections.ts**: 제네릭 `groupByDate<T extends { createdAt: number }>` + `isClosedSection` (HistoryGallery + VisionHistoryList 공유)
- **frontend/hooks/useComparisonAnalysis.ts**: 비교 분석 트리거 + per-item busy guard + VRAM 임계 (>13GB skip) + 결과 store inline patch
- **frontend/hooks/useGeneratePipeline.ts**: 스트림 실행 + 업그레이드 모달 + **researchPreview** state (loading/hints/error/run · ResearchBanner 인라인 결과 용)
- **frontend/lib/{api-client,model-presets,image-actions}.ts**: 핵심 프론트 유틸 · **lib/api/compare.ts** (compareAnalyze) · image-actions fetch 는 `cache:"no-store"` 로 CORS 캐시 우회
- **frontend/stores/use*Store.ts**: Zustand 7개 (settings/process/history/generate/edit/**video**/toast) · `useVideoStore` 에 adult/longerEdge/lightning 토글 + computeVideoResize 헬퍼 · `useSettingsStore` 에 `autoCompareAnalysis` 토글 · `useGenerateStore` 는 v3 (steps/cfg/seed 필드 제거, migrate 로 옛 값 자동 삭제)
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
  - Extra LoRA: `FemNude_qwen-image-2512_epoch30.safetensors` (상시 strength 1)
- 수정 모드: **Qwen Image Edit 2511** (diffusion_models/qwen_image_edit_2511_bf16.safetensors)
  - Lightning LoRA: `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` (토글)
  - Extra LoRA: `SexGod_CouplesNudity_QwenEdit_2511_v1.safetensors` (상시 strength 0.7)
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
- `POST /compare-analyze` (multipart source+result+meta) — Edit 결과 vs 원본 5축 평가 (qwen2.5vl multi-image)
  - meta JSON: `{editPrompt, historyItemId?, visionModel?, ollamaModel?}`
  - 응답: `{analysis: ComparisonAnalysis, saved: bool}` · HTTP 200 원칙 (fallback 보장)
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
- `docs/superpowers/specs/2026-04-24-edit-comparison-analysis-design.md` — Edit 비교 분석 spec
- `docs/superpowers/plans/2026-04-24-edit-comparison-analysis.md` — 15-task TDD implementation plan

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
