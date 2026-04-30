# AI Image Studio

Local AI image generation WebUI. Next.js 16 + FastAPI + ComfyUI + Ollama.
Windows 11 로컬 환경 전용 (RTX 4070 Ti SUPER 16GB VRAM).

> **변경 로그**: `docs/changelog.md`
> **진행 모달 표시 항목**: `docs/progress-modal-display.md`
> **설계 spec**: `docs/superpowers/specs/`

## Architecture

- **frontend/**: Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v4 · Zustand 5
- **backend/**: FastAPI · Python 3.13 · httpx + websockets + aiosqlite + pydantic-settings
- **External**: ComfyUI Desktop (`:8000`), Ollama (`:11434`)
- **Backend port 8001** (config 의 8000 은 ComfyUI 가 선점 → uvicorn `--port 8001` 필수)
- **Process lifecycle**: Ollama 상시 / ComfyUI 는 backend lifespan 자동 시작 (Phase 5 자동기동 워밍업)
- **Launcher**: `start.bat` 콘솔 1개만 + Backend/Frontend/Ollama Hidden + ComfyUI Headless Python (`logs/*.log` 에서 디버깅)

## Commands

```powershell
# Frontend dev (실 백엔드)
$env:NEXT_PUBLIC_USE_MOCK="false"; $env:NEXT_PUBLIC_STUDIO_API="http://localhost:8001"
cd frontend; npm run dev

# Frontend dev (Mock)
cd frontend; npm run dev

# Backend dev
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --no-access-log

# Backend test (215 tests)
cd backend; D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/

# Frontend test (50 tests · vitest) + lint + tsc
cd frontend; npm test; npm run lint; npx tsc --noEmit

# OpenAPI 자동 타입 갱신 (백엔드 schema 변경 시)
cd frontend; npm run gen:types
```

## Code Style

- **한글 주석 필수** (모든 파일)
- **Python**: snake_case, type hints required
- **TypeScript**: camelCase vars, PascalCase components, strict mode
- **신규 studio 코드**: 디자인 토큰 (CSS vars) + 인라인 스타일 + Tailwind 혼합 (Claude Design 핸드오프)
- **Imports**: absolute paths (`@/`), group by stdlib → external → internal
- **사용자 노출 텍스트**: 한국어 존댓말 (공식체 · placeholder / empty / toast 모두). 코드 주석 / 로그는 개발자 톤 (반말 OK).
- **Error 표시**: 한국어로 사용자에게 + Toast 시스템

## Architecture — Key Files

### Backend (`backend/`)

- **`studio/router.py`** (118줄 · facade only) — `from .routes import studio_router as router` + 외부 호환 re-export 묶음. 신규 코드는 본래 위치 직접 import 권장.
- **`studio/routes/`** (7 파일) — endpoint 도메인별 그룹: `streams.py` (gen/edit/video task+SSE) · `prompt.py` (upgrade-only/research/interrupt) · `vision.py` · `compare.py` · `system.py` · `_common.py` (SSE/태스크 유틸)
- **`studio/pipelines/`** (7 파일) — 백그라운드 파이프라인: `_dispatch.py` (ComfyUI 디스패치 + Phase 5 자동기동 헬퍼) · `generate.py` · `edit.py` · `video.py` · `vision_analyze.py` · `compare_analyze.py` (Phase 6)
- **`studio/{prompt,vision,video,comparison}_pipeline.py`** — Ollama gemma4 + qwen2.5vl 호출 로직. `progress_callback: Callable[[str], Awaitable[None]] | None` (Phase 6 이후 옵셔널).
- **`studio/comfy_api_builder.py`** — ComfyUI flat API format 빌더 (`build_{generate,edit,video}_from_request`)
- **`studio/comfy_transport.py`** — WebSocket + HTTP 전송 (idle 1200s / hard 7200s · 16GB VRAM swap 안전망)
- **`studio/presets.py`** — Qwen Image 2512 / Edit 2511 / LTX Video 2.3 프리셋 (**프론트와 동기화 필수**)
- **`studio/history_db.py`** — SQLite (mode: generate/edit/video) · v6 schema (refined_intent 캐싱 컬럼 포함)
- **`studio/_json_utils.py` / `ollama_unload.py` / `_gpu_lock.py` / `dispatch_state.py` / `system_metrics.py` / `_proc_mgr.py`** — 공용 유틸
- **`scripts/dump_openapi.py`** — FastAPI 풀 OpenAPI 3.1 dump (`npm run gen:types` 가 호출)
- **`legacy/`** (quarantine) — 옛 5 라우터 + 5 services + 4 tests + conftest. **수정 금지**. main.py 등록 끊김.
- **`services/process_manager.py`** — 신규 코드 사용 중 (이동 금지)

### Frontend (`frontend/`)

- **`app/{page,generate,edit,video,vision,vision/compare}/page.tsx`** — 6 라우트. 모두 페이지 최소너비 1024 + grid `"400px minmax(624px, 1fr)"` 통일. 메인은 3카테고리 × 2카드 그리드 (Image:생성/수정 · Vision:분석/비교 · Video:생성/업스케일(준비중))
- **`lib/pipeline-defs.tsx`** — **5 mode 진행 모달의 단일 진실의 출처**. `PipelineMode = HistoryMode | "vision" | "compare"` + `PIPELINE_DEFS` (StageDef 배열). gemma4 토글 등 미래 분기는 `enabled` 콜백 한 줄로 자동 일관 적용.
- **`components/studio/ProgressModal.tsx`** — 5 mode 통일 진행 모달 (`<PipelineTimeline mode={mode} />`)
- **`components/studio/progress/{PipelineTimeline,TimelineRow,DetailBox}.tsx`** — 통일 timeline 컴포넌트
- **`components/studio/EditVisionBlock.tsx`** — Edit 비전 매트릭스 행 UI 공용 (인물 5 / 물체·풍경 5 슬롯 · 🔵수정/🟢보존 배지)
- **`components/studio/{HistoryGallery,SectionHeader,HistorySectionHeader,ResultHoverActionBar,BeforeAfterSlider}.tsx`** — 4메뉴 통일 공용 컴포넌트 (ResultInfoModal 은 2026-04-30 dead code 청소 시 삭제 — InfoPanel 로 흡수됨)
- **`components/studio/CompareExtraBoxes.tsx`** — TransformPromptBox + UncertainBox (Compare v2.2)
- **`components/chrome/{AppHeader,SystemMetrics,SystemStatusChip}.tsx`** — 통합 헤더 (CPU/GPU/VRAM/RAM 4-bar · macOS 색상 매핑 · 80% 임계 시 VRAM breakdown 오버레이). 옛 VramBadge 는 2026-04-30 dead code 청소 시 삭제됨.
- **`hooks/{useGeneratePipeline,useEditPipeline,useVideoPipeline,useVisionPipeline,useComparisonAnalysis}.ts`** — mode 별 파이프라인 훅
- **`lib/api/`** — `client.ts` (parseSSE 등) · `{generate,edit,video,vision,compare}.ts` (SSE drain) · `types.ts` (한글 주석/narrow union 손편집) · `generated.ts` (자동 생성) · `generated-helpers.ts` (Schemas/Paths alias)
- **`stores/use*Store.ts`** — Zustand 8개 (settings/process/history/generate/edit/video/visionCompare/toast). `useGenerateStore` 의 `StageEvent` 정의가 5 mode 공용.
- **`legacy/`** (quarantine, 39 파일) — tsconfig/eslint/vitest exclude. 옛 fetchApi 기반 api.ts 등.

## Rules — 🔴 Critical / 🟡 Important / 🟢 Recommended

### 🔴 Critical (Never Compromise)

- **mock.patch 위치 = lookup 모듈 기준**. re-export 받는 모듈에 patch 해도 호출 site 가 다른 모듈이면 안 가로챔. 함수 분해/이동 시 patch 사이트 명시 갱신 필수. 신규 테스트는 `studio.routes.X` / `studio.pipelines.X` 직접 import 권장.
- **Edit/Video pipeline 단계별 Ollama unload 필수** (spec 19 옵션 B). 16GB VRAM 환경에서 vision (qwen2.5vl) + text (gemma4) 동시 점유 → swap → ComfyUI sampling 매우 느림. `vision_pipeline` / `video_pipeline` 안에서 모델 전환마다 `ollama_unload.unload_model + asyncio.sleep(1.0)` 호출. ComfyUI dispatch 직전엔 `_dispatch.py` 가 `force_unload_all_loaded_models` 호출 (옵션 A backup).
- **Ollama keep_alive 호출 형식**. `/api/chat` 은 string `"0"` (deferred 가능) → 명시적 강제 unload 는 반드시 `/api/generate` + int `0` 사용 (`ollama_unload.unload_model` 헬퍼).
- **gemma4-un 호출 시 `think: false` 필수**. reasoning 모델이라 없으면 content 빈값.
- **subprocess 호출 시 `shell=False` 필수** + 경로 화이트리스트.
- **이미지 경로 파라미터는 path traversal 방지 검증 필수**.
- **CORS**: localhost 만 허용.
- **외부 API 호출 (ComfyUI / Ollama)**: 반드시 try/except + 타임아웃.
- **workflow JSON 템플릿은 코드로 직접 수정 금지** (사용자에게 확인).
- **새 의존성 추가 전 사용자에게 확인**.

### 🟡 Important

- **프리셋 정의 동기화 필수**: `backend/studio/presets.py` 변경 시 `frontend/lib/model-presets.ts` 도 같이.
- **Video LTX-2.3 공간 해상도 8배수 필수** (compute_video_resize 자동 스냅).
- **legacy 코드 수정 금지**. 옛 라우터 살리려면 `main.py` 에 `from legacy.routers import X` + `app.include_router(X.router)` 추가만.
- **백엔드 schema 변경 시**: `npm run gen:types` 호출 → frontend `generated.ts` 자동 갱신 → tsc 가 drift 자동 표시.
- **ComfyUI/Ollama URL 은 `.env` 에서 `config.py` 로 로드** (하드코딩 금지).
- **테스트 회귀 0**: 변경 후 pytest 215 + vitest 50 + tsc + lint clean 검증.
- **디자인 토큰 변경 시 사용자 피드백 필수**.

### 🟢 Recommended

- **commit type(scope)**: 한국어 OK. merge 는 `--no-ff`.
- **branch 이름**: `claude/{name}` 또는 `feature/{module}-{description}`.
- **새 코드는 `Schemas["X"]` 사용** (자동 동기화). 한글 주석/narrow union 가치 있는 타입은 `lib/api/types.ts` 손편집 유지.

## Testing

- **Backend**: pytest + httpx AsyncClient. ComfyUI 관련은 mock client (실제 ComfyUI 불필요).
- **Frontend**: vitest + jsdom. SSE drain 테스트 패턴 — `__tests__/api-vision-compare.test.ts` 의 `makeBlobResponse` 헬퍼 (jsdom Blob 호환 우회).
- **현재 테스트 수**: pytest 215 / vitest 50.

## Browser Testing (Chrome 자동화)

- 이미지 생성/수정/AI보강: 스크린샷 최소 **3분 간격**, 중간은 JS/read_page 로 상태 확인
- 레이아웃/UI 수정: 스크린샷 간격 제한 없음
- ComfyUI 작업은 시간이 오래 걸리므로 충분히 대기 후 결과 확인

## Code Review (Codex 연동)

- 구현/수정 완료 후 `codex:codex-rescue` 에이전트에게 리뷰 요청
- Codex 피드백 반영 후 상호 보완하여 품질 향상
- 대규모 코드 분석 / 갭 분석 등 토큰 소모가 큰 작업도 Codex 에 위임 가능

## Model System

### 생성 모드 — Qwen Image 2512

- **Diffusion**: `qwen_image_2512_fp8_e4m3fn.safetensors`
- **Lightning LoRA** (토글): `Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors` · **steps/cfg = 8 / 1.5**
- **Extra LoRA** (상시 strength 1.0): `female-body-beauty_qwen.safetensors`
- **Style LoRA 시스템** (확장형 · 활성 0): `GENERATE_STYLES: list[StylePreset]` — 토글 시 sampling override + LoRA 체인 + trigger prepend + Lightning 강제 OFF

### 수정 모드 — Qwen Image Edit 2511

- **Diffusion**: `qwen_image_edit_2511_bf16.safetensors`
- **Lightning LoRA** (토글): `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` · **steps/cfg = 4 / 1.0**
- **Extra LoRA** (상시 strength 0.7): `SexGod_CouplesNudity_QwenEdit_2511_v1.safetensors`

### 영상 모드 — LTX Video 2.3

- **Diffusion**: `ltx-2.3-22b-dev-fp8.safetensors` (29GB · 16GB VRAM 한계)
- **Text Encoder**: `gemma_3_12B_it_fp4_mixed.safetensors`
- **Upscaler**: `ltx-2.3-spatial-upscaler-x2-1.1.safetensors`
- **Lightning LoRA** (토글, 2개): `ltx-2.3-22b-distilled-lora-384.safetensors` × 2 (base/upscale)
- **Adult LoRA** (토글): `ltx2310eros_beta.safetensors`
- 2-stage sampling (base + upscale) · 126 frames (5s × 25fps + 1)
- 해상도 슬라이더 512~1536 (step 128) · 원본 비율 유지 (8배수 스냅)

### 공통

- **CLIP**: `qwen_2.5_vl_7b_fp8_scaled.safetensors` (qwen_image type)
- **VAE**: `qwen_image_vae.safetensors`
- **프롬프트 업그레이드**: `gemma4-un:latest` (Ollama · 26B · think=False 필수)
- **수정/영상/비전 분석**: `qwen2.5vl:7b` (Ollama)
- **종횡비 프리셋** (Qwen 권장): 1:1 1328² / 16:9 1664×928 / 9:16 928×1664 / 4:3 1472×1104 / 3:4 1104×1472 / 3:2 1584×1056 / 2:3 1056×1584

## API Endpoints (`/api/studio/*`)

모두 task-based SSE 패턴 (POST → `{task_id, stream_url}` → GET stream → done event):

| Endpoint | 비고 |
|----------|------|
| `POST /generate` + `GET /generate/stream/{id}` | SSE 단계 스트림 |
| `POST /edit` (multipart) + stream | 4 단계 + warmup 옵션 |
| `POST /video` (multipart) + stream | LTX-2.3 i2v 5 단계 |
| `POST /vision-analyze` (multipart) + stream | Vision Recipe v2.1 (9 슬롯) |
| `POST /compare-analyze` (multipart) + stream | 2 context (edit / compare) · 5축 평가 |
| `POST /upgrade-only` | gemma4 업그레이드만 (모달용) |
| `POST /research` | Claude CLI 조사 힌트 |
| `POST /interrupt` | ComfyUI 전역 중단 |
| `GET /models`, `GET /ollama/models` | 모델 목록 |
| `GET /process/status` | CPU/GPU/VRAM/RAM + vram_breakdown |
| `POST /process/{ollama|comfyui}/{start|stop}` | 프로세스 제어 |
| `GET/DELETE /history[/{id}]` | 히스토리 |

응답 schema 는 `npm run gen:types` 후 `lib/api/generated.ts` 참조. 자세한 SSE drain 은 `lib/api/{generate,edit,video,vision,compare}.ts`.

## Git

- **Branch**: `feature/{module}-{description}` 또는 `claude/{name}`
- **Commit**: `type(scope): description` (한국어 OK)
- **Merge**: `--no-ff` merge commit (기존 관례)
- **No force push to main**

## UX 규칙 (활성)

### BeforeAfter 슬라이더 (/edit)

- **렌더 조건**: `afterItem.sourceRef && afterItem.sourceRef === sourceImage` (진짜 한 쌍만)
- 히스토리 타일 클릭 → `setSource(sourceRef)` + `setAfterId(id)` 동시 (그 수정의 원본 자동 복원)
- 옛 row (sourceRef NULL) 클릭 → toast 안내 + 슬라이더 자동 빈 상태
- BeforeAfter wrapper 는 **바깥 `flex+justify-center` + 안쪽 `position:relative`** 2-layer (세로형 이미지 가운데 정렬)
- afterId 전환 시 `compareX` 50 자동 리셋 (새 비교 항상 중앙 시작)
- Lightbox 에서 `edit + sourceRef` 있으면 `↔ 비교` 토글 + `B` 단축키

### /generate 입력

- Step/CFG/Seed **UI 노출 X** (백엔드 자동 + seed 매번 랜덤)
- 비율 잠금 ON 상태에서 프리셋 칩 클릭 → width 유지 + height 재계산 (프리셋 기본값 덮어쓰지 않음)
- W/H 입력박스 prefix 는 DimInput 으로 overlay (라벨 외부 노출 없음)
- W/H 슬라이더 최소값 768 (Qwen 권장 하한)
- 비율잠금 ON 시 H input + H 슬라이더 모두 disabled
- 재생성 (onReuse) 은 prompt + 사이즈 + lightning 만 복원

### ResearchBanner

- 결과는 토스트가 아닌 **배너 내부 인라인** 표시 (휘발 안 됨)
- 버튼: "힌트 미리 받기" · 체크박스: "Claude 프롬프트 조사"
- `researchPreview` state 는 `useGeneratePipeline` 훅에서 관리
- 힌트 전체 N개 노출 (slice 제한 없음)

### Multi-reference + Manual Crop (/edit · 2026-04-28)

- **토글 ON** (`🖼️ 참조 이미지 사용 (실험적)`) 후 image2 업로드 시 자동으로 인라인 crop UI ("사용 영역") 노출
- Crop UI 구성: `react-easy-crop` 기반 · 자유/1:1/4:3/9:16 비율 lock + zoom slider + 외부 dim 0.75
- **default = 박스 100%** (이미지 전체) — 사용자가 안 줄이면 옛 흐름 (원본 그대로)
- "수정 생성" 클릭 시점에 `useEditPipeline` 이 캔버스 drawImage 로 cropped Blob 생성 → `reference-crop.png` File → multipart 의 `reference_image` 필드
- **256px 미만 영역**은 `onAreaChange(null)` 로 silent fallback (도움말에 명시 · 백엔드 사이즈 검증은 *없음*)
- **Reset 트리거 3개** (`useEditStore.referenceCropArea`): 새 image2 업로드 / 해제 (X) / multi-ref 토글 OFF
- **`key={referenceImage}`** 로 새 업로드 시 컴포넌트 local state (crop/zoom/aspectMode) 강제 reset (Codex Phase 1 리뷰 결함 fix)
- **`effectiveUseRef = useReferenceImage && !!referenceImage`** 단일 게이트 — race 시 백엔드 400 차단 (Codex Phase 2 리뷰 결함 fix)
- **저장**: cropped Blob 은 영구 저장 안 함 (메모리 → multipart → ComfyUI 임시 input). 영구 저장 + 라이브러리 재선택은 `docs/superpowers/plans/2026-04-27-edit-reference-library.md` 후속 plan
- **얼굴 transfer 한계**: Qwen Edit 본질로 face role 은 약함 — 의상/배경 role 위주 사용 권장. InstantID 별도 plan 후보
- **`bypassCrop` prop**: 라이브러리 plan 진입 시 활성 (이미 crop 된 reference 재 crop 방지). 현재는 자리만
