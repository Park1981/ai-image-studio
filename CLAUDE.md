# AI Image Studio

## Project
Local AI image generation WebUI.
Next.js 14 frontend + FastAPI backend + ComfyUI API + Ollama LLM.
Windows 11 로컬 환경 전용 (RTX 4070 Ti SUPER 16GB VRAM).

## Architecture
- frontend/: Next.js 14, App Router, TypeScript, Tailwind CSS, Zustand
- backend/: FastAPI, Python 3.11+, httpx, aiosqlite, pydantic-settings
- External: ComfyUI Desktop (:8188), Ollama (:11434)
- ComfyUI: workflow JSON template → dynamic field injection → POST /prompt
- Process: Ollama 상시 실행 / ComfyUI 온디맨드 실행-종료 (VRAM 절약)

## Commands
- Frontend dev: `cd frontend && npm run dev`
- Backend dev: `cd backend && uvicorn main:app --reload --port 8000`
- Frontend lint: `cd frontend && npm run lint`
- Backend lint: `cd backend && ruff check .`
- Frontend test: `cd frontend && npm test`
- Backend test: `cd backend && pytest`

## Code Style
- Korean comments in ALL files (한글 주석 필수)
- Python: snake_case, ruff formatter, type hints required
- TypeScript: camelCase vars, PascalCase components, strict mode
- API response format: { success: bool, data: T, error?: string }
- Imports: absolute paths, group by stdlib → external → internal
- Error messages: 한국어로 사용자에게 표시

## Key Files
- backend/services/comfyui_client.py: ComfyUI API 통신 (수정 시 주의)
- backend/services/process_manager.py: ComfyUI 프로세스 라이프사이클
- backend/services/workflow_manager.py: JSON 템플릿 로드 + 필드 교체
- backend/services/prompt_engine.py: Ollama 기반 프롬프트 보강/번역
- backend/config.py: pydantic-settings 환경설정 (모든 설정의 진입점)
- backend/workflows/*.json: ComfyUI API format (수동 생성, 코드로 수정 금지)
- frontend/styles/design-tokens.ts: 디자인 시스템 토큰 (변경 시 사용자 확인)
- frontend/stores/useAppStore.ts: Zustand 전역 상태

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

## Git
- Branch: feature/{module}-{description}
- Commit: type(scope): description (Korean OK)
- No force push to main
