# AI Image Studio

## Project
Local AI image generation WebUI.
Next.js 16 (App Router) frontend + FastAPI backend + ComfyUI API + Ollama LLM.
Windows 11 로컬 환경 전용 (RTX 4070 Ti SUPER 16GB VRAM).

**2026-04-22 전면 재설계 완료** — Phase 1+2 merged to master (HEAD around `5ff36bf`).
신규 구조는 `backend/studio/` + `frontend/components/studio/` + 4 route pages.
레거시 코드 (`backend/services/*`, `frontend/components/{Creation,History,Settings}Panel.tsx` 등) 는
참고용으로 보존 — 직접 수정 금지.

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
- Backend test: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/` (13 tests)

## Code Style
- Korean comments in ALL files (한글 주석 필수)
- Python: snake_case, type hints required
- TypeScript: camelCase vars, PascalCase components, strict mode
- 신규 studio 코드: 디자인 토큰 (CSS vars) + 인라인 스타일 + Tailwind 혼합 (Claude Design 핸드오프 기반)
- Imports: absolute paths (@/), group by stdlib → external → internal
- Error messages: 한국어로 사용자에게 표시 + Toast 시스템

## Key Files (재설계 이후)
### 신규 (권위)
- **backend/studio/router.py**: `/api/studio/*` FastAPI 라우터 (generate/edit SSE · upgrade-only · research · interrupt · history · models · process · ollama/models)
- **backend/studio/comfy_api_builder.py**: ComfyUI flat API format 빌더 (`build_generate_from_request`, `build_edit_from_request`)
- **backend/studio/comfy_transport.py**: WebSocket + HTTP 전송 (idle 600s / hard 1800s timeout)
- **backend/studio/{prompt,vision}_pipeline.py**: Ollama gemma4 업그레이드 + qwen2.5vl 비전 2단계
- **backend/studio/presets.py**: Qwen Image 2512 / Edit 2511 프리셋 (프론트와 동기화 필수)
- **backend/studio/history_db.py**: SQLite studio_history 테이블
- **backend/workflows/qwen_image_2512.json, qwen_image_edit_2511.json**: 워크플로우 참조 (디스패치는 comfy_api_builder 가 Python 으로 구성)
- **frontend/app/{page,generate,edit,video}/page.tsx**: 4 라우트
- **frontend/components/studio/\***: AiEnhanceCard, HistoryTile, ImageLightbox, ProgressModal, UpgradeConfirmModal
- **frontend/lib/{api-client,model-presets,image-actions}.ts**: 핵심 프론트 유틸
- **frontend/stores/use*Store.ts**: Zustand 6개 (settings/process/history/generate/edit/toast)
- **frontend/app/globals.css**: 디자인 토큰 (warm neutral + cool blue)

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

## Model System (재설계 · 2026-04-22)
- 생성 모드: **Qwen Image 2512** (diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors)
  - Lightning LoRA: `Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors` (토글)
  - Extra LoRA: `FemNude_qwen-image-2512_epoch30.safetensors` (상시 strength 1)
- 수정 모드: **Qwen Image Edit 2511** (diffusion_models/qwen_image_edit_2511_bf16.safetensors)
  - Lightning LoRA: `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` (토글)
  - Extra LoRA: `SexGod_CouplesNudity_QwenEdit_2511_v1.safetensors` (상시 strength 0.7)
- 공통 CLIP: `qwen_2.5_vl_7b_fp8_scaled.safetensors` (qwen_image type)
- 공통 VAE: `qwen_image_vae.safetensors`
- 프롬프트 업그레이드: `gemma4-un:latest` (Ollama)
- 수정 모드 비전: `qwen2.5vl:7b` (Ollama · 기본값)
- 프리셋 정의: `backend/studio/presets.py` + `frontend/lib/model-presets.ts` (동기화 필수)
- 종횡비 프리셋 (Qwen 권장): 1:1 1328² / 16:9 1664×928 / 9:16 928×1664 / 4:3 1472×1104 / 3:4 1104×1472 / 3:2 1584×1056 / 2:3 1056×1584

## API Endpoints (`/api/studio/*`)
- `POST /generate` + `GET /generate/stream/{id}` (SSE 단계 스트림)
- `POST /edit` (multipart) + `GET /edit/stream/{id}` (SSE 4단계)
- `POST /upgrade-only` (gemma4 업그레이드만, showUpgradeStep 토글 ON 시 사용)
- `POST /research` (Claude CLI 조사 힌트)
- `POST /interrupt` (ComfyUI 전역 중단)
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
