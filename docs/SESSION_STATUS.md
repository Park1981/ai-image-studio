# AI Image Studio — 프로젝트 진행 상태

> 마지막 업데이트: 2026-04-11
> 세션 복구용 문서 — 새 세션에서 이 파일을 먼저 읽을 것

---

## 현재 진행 단계

**Phase 0: 프로젝트 초기화 ✅ 완료**
**Phase 0.5: 디자인 시스템 확정 ✅ 완료**
**Phase 1: MVP 백엔드 + 프론트엔드 연동 ✅ 완료**
**Phase 1.5: UI 간소화 + 버그 수정 ✅ 완료**
**Phase 2~5: 미착수**

---

## 완료된 작업

### Phase 0 (전부 완료)
- [x] Git 초기화 + GitHub 레포 생성 (Park1981/ai-image-studio)
- [x] 프로젝트 디렉토리 구조 생성
- [x] CLAUDE.md 작성
- [x] .env.example + .env 생성
- [x] Next.js 14 프론트엔드 초기화 (TypeScript, Tailwind v4, Zustand)
- [x] FastAPI 백엔드 초기화 (pydantic-settings, aiosqlite, Pydantic 스키마)
- [x] Python 가상환경 (.venv) + 의존성 설치
- [x] 초기 커밋 + GitHub push

### Phase 0.5 디자인 (완료)
- [x] 디자인 브리프 문서 작성 (docs/design-brief.md)
- [x] "Dark Room" 컨셉 디자인 시스템 구축 (globals.css)
- [x] 메인 생성 페이지 UI 구현 — 2x2 그리드 + 사이드바 + 프롬프트 독
- [x] 디자인 피드백 확정

### Phase 1 MVP (완료)
- [x] C→D 드라이브 이동 후 venv 재생성 + 의존성 재설치
- [x] .env 업데이트 (gemma4:latest, 경로 확인)
- [x] **백엔드 서비스 4개 구현**:
  - `services/process_manager.py` — ComfyUI 온디맨드 실행/종료 + 자동 셧다운
  - `services/comfyui_client.py` — ComfyUI REST/WebSocket 통신
  - `services/workflow_manager.py` — JSON 워크플로우 템플릿 + 파라미터 주입 + LoRA 동적 삽입
  - `services/prompt_engine.py` — Ollama 프롬프트 보강/번역 + 폴백 처리
- [x] **ComfyUI 워크플로우 템플릿** (`workflows/txt2img.json`)
- [x] **백엔드 라우터 4개 구현**:
  - `routers/generate.py` — 이미지 생성 + 취소 + WebSocket 진행률
  - `routers/process.py` — 프로세스 상태 조회 + ComfyUI 시작/종료
  - `routers/models.py` — 모델 목록 조회
  - `routers/prompt.py` — 프롬프트 AI 보강
- [x] `main.py` 업데이트 — 라우터 등록 + lifespan + 정적 파일 서빙 + 로깅
- [x] **프론트엔드 컴포넌트 분리** (page.tsx 360줄 → 39줄):
  - `components/Header.tsx` — 실시간 프로세스 상태 표시
  - `components/ImageGrid.tsx` — 2x2 그리드 + 이미지 표시 + 선택 + 프로그레스 바
  - `components/PromptDock.tsx` — 프롬프트 입력 + AI 보강 + 생성/취소
  - `components/SettingsSidebar.tsx` — 모든 설정 Zustand 연동
  - `components/HistoryBar.tsx` — Phase 3 플레이스홀더
  - `components/ErrorToast.tsx` — 에러 토스트 (5초 자동 소멸)
  - `components/icons.tsx` — 아이콘 12개
- [x] **커스텀 훅 4개 구현**:
  - `hooks/useGenerate.ts` — 생성 플로우 오케스트레이션
  - `hooks/useWebSocket.ts` — WebSocket 진행률 수신
  - `hooks/useProcessStatus.ts` — 10초 간격 프로세스 폴링
  - `hooks/useModels.ts` — 모델 목록 동적 로드
- [x] `stores/useAppStore.ts` — 전체 상태 확장 (설정 파라미터, 모델 목록, 선택 UI)
- [x] `lib/api.ts` — 구체 API 메서드 8개 추가
- [x] 백엔드 uvicorn 실행 확인 + API 헬스체크 정상
- [x] 프론트엔드 빌드 + 브라우저 UI 확인 (콘솔 에러 없음)
- [x] ruff + ESLint 린트 통과

---

## 프로젝트 구조 (현재)

```
ai-image-studio/
├── frontend/                        # Next.js 16 (Tailwind v4, App Router)
│   ├── app/
│   │   ├── globals.css              # 디자인 시스템 (@theme 토큰, 애니메이션)
│   │   ├── layout.tsx               # Sora + Geist + Geist Mono 폰트
│   │   └── page.tsx                 # 메인 페이지 (컴포넌트 조합)
│   ├── components/
│   │   ├── Header.tsx               # 헤더 + 프로세스 상태
│   │   ├── ImageGrid.tsx            # 2x2 이미지 그리드
│   │   ├── PromptDock.tsx           # 프롬프트 입력 + 생성 버튼
│   │   ├── SettingsSidebar.tsx      # 설정 사이드바
│   │   ├── HistoryBar.tsx           # 히스토리 (Phase 3)
│   │   ├── ErrorToast.tsx           # 에러 토스트
│   │   └── icons.tsx                # SVG 아이콘 모음
│   ├── hooks/
│   │   ├── useGenerate.ts           # 생성 플로우 훅
│   │   ├── useWebSocket.ts          # WebSocket 훅
│   │   ├── useProcessStatus.ts      # 상태 폴링 훅
│   │   └── useModels.ts             # 모델 목록 훅
│   ├── stores/useAppStore.ts        # Zustand 스토어
│   ├── lib/api.ts                   # API 클라이언트
│   └── .env.local                   # NEXT_PUBLIC_API_URL
│
├── backend/                         # FastAPI
│   ├── main.py                      # 엔트리 + lifespan + CORS + 라우터 등록
│   ├── config.py                    # pydantic-settings (.env 로드)
│   ├── database.py                  # aiosqlite 스키마
│   ├── models/schemas.py            # Pydantic 스키마
│   ├── routers/
│   │   ├── generate.py              # 이미지 생성 + 취소 + WS
│   │   ├── process.py               # 프로세스 상태/시작/종료
│   │   ├── models.py                # 모델 목록
│   │   └── prompt.py                # 프롬프트 보강
│   ├── services/
│   │   ├── process_manager.py       # ComfyUI/Ollama 프로세스 관리
│   │   ├── comfyui_client.py        # ComfyUI API 클라이언트
│   │   ├── workflow_manager.py      # 워크플로우 템플릿 + 파라미터 주입
│   │   └── prompt_engine.py         # Ollama 프롬프트 보강
│   └── workflows/
│       └── txt2img.json             # txt2img 기본 워크플로우
│
├── .venv/                           # Python 가상환경 (D 드라이브)
├── data/                            # DB + 생성 이미지 저장
├── docs/
│   ├── design-brief.md              # 디자인 방향 문서
│   └── SESSION_STATUS.md            # ← 이 파일
│
├── AI_Image_Studio_기획서_v1.1.md     # 원본 기획서
├── CLAUDE.md                        # Claude Code 설정
├── .env / .env.example              # 환경변수
└── .gitignore
```

---

## 기술 스택 결정 사항

| 항목 | 결정 | 비고 |
|------|------|------|
| 프론트 통신 | **WebSocket** | SSE 아님 (사용자 결정) |
| UI 라이브러리 | **Tailwind만** | shadcn/ui 미사용 (사용자 결정) |
| DB | **aiosqlite** | SQLModel 아님 (사용자 결정) |
| Config | **pydantic-settings** | .env 자동 로드 |
| LLM 모델 | **gemma4:latest** | gemma3에서 변경 |
| Phase 1 추가 | **생성 취소** | ComfyUI /interrupt 래핑 |
| Phase 2 추가 | **키보드 단축키** | Ctrl+Enter, Escape 등 |
| 폰트 | Sora(display) + Geist(UI) + Geist Mono(tech) | |
| 컬러 | Violet accent (#7c3aed) + 7단계 다크 서피스 | |

---

## API 엔드포인트 (14개)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/` | 헬스 체크 |
| GET | `/api/health` | 상세 헬스 체크 |
| POST | `/api/generate` | 이미지 생성 요청 |
| POST | `/api/generate/cancel/{task_id}` | 생성 취소 |
| GET | `/api/generate/status/{task_id}` | 태스크 상태 조회 |
| WS | `/api/ws/generate` | 생성 진행률 WebSocket |
| GET | `/api/process/status` | 프로세스 상태 |
| POST | `/api/process/comfyui/start` | ComfyUI 시작 |
| POST | `/api/process/comfyui/stop` | ComfyUI 종료 |
| GET | `/api/models/list` | 모델 목록 |
| POST | `/api/prompt/enhance` | 프롬프트 AI 보강 |
| - | `/images/{path}` | 정적 이미지 서빙 |

---

## 다음 할 일 (우선순위 순)

### 1. Phase 2: 고급 기능 구현
- [ ] img2img, inpaint 워크플로우 추가
- [ ] 이미지 풀스크린 뷰어 (오버레이)
- [ ] 키보드 단축키 체계 (Ctrl+Enter, Escape 등)
- [ ] 이미지 다운로드/복사 기능
- [ ] 설정 프리셋 (저장/불러오기)

### 2. Phase 3: 히스토리 시스템
- [ ] 생성 이력 DB 저장 (aiosqlite)
- [ ] 히스토리 페이지 (/history)
- [ ] 과거 설정으로 재생성
- [ ] 히스토리바 실제 데이터 연동

### 3. Phase 4: 설정 페이지
- [ ] 설정 페이지 (/settings)
- [ ] ComfyUI/Ollama URL 설정
- [ ] 기본값 설정
- [ ] 테마 설정

### 4. Phase 5: 안정화
- [ ] structlog 도입
- [ ] 에러 복구 로직 강화
- [ ] 성능 최적화

---

## 핵심 참조 파일

| 파일 | 용도 | 언제 읽을까 |
|------|------|-------------|
| `AI_Image_Studio_기획서_v1.1.md` | 전체 설계 원본 | 아키텍처/API/워크플로우 확인 시 |
| `docs/design-brief.md` | 디자인 방향 요약 | UI 수정 시 |
| `backend/models/schemas.py` | API 스키마 정의 | 라우터/서비스 구현 시 |
| `frontend/app/globals.css` | 디자인 토큰 전체 | UI 수정 시 |
| `frontend/stores/useAppStore.ts` | 전역 상태 타입 | 프론트 로직 구현 시 |
| `frontend/lib/api.ts` | API 클라이언트 | API 호출 추가/수정 시 |

---

## 개발 환경 참고

```bash
# 프론트엔드 실행
cd frontend && npm run dev          # localhost:3000

# 백엔드 실행
cd backend && ../.venv/Scripts/uvicorn main:app --reload --port 8000

# 린트
cd D:/AI-Image-Studio && .venv/Scripts/ruff check backend/
cd frontend && npm run lint

# GitHub
gh auth status                      # Park1981 인증 확인
```

---

## Git 커밋 히스토리

1. `65352ba` — init: 프로젝트 초기 세팅 (Phase 0)
2. `1208ca0` — feat(frontend): 메인 생성 페이지 UI + 디자인 시스템
3. `a5609cd` — docs: 세션 복구용 프로젝트 상태 문서 추가
4. *(커밋 대기)* — feat: Phase 1 MVP 백엔드 + 프론트엔드 연동

---

> 새 세션 시작 시: 이 파일 + CLAUDE.md 읽고 Phase 2부터 이어가기
