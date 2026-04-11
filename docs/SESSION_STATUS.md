# AI Image Studio — 프로젝트 진행 상태

> 마지막 업데이트: 2026-04-11
> 세션 복구용 문서 — 새 세션에서 이 파일을 먼저 읽을 것

---

## 현재 진행 단계

**Phase 0: 프로젝트 초기화 ✅ 완료**
**Phase 0.5: 디자인 시스템 확정 🔄 진행 중 (사용자 피드백 대기)**
**Phase 1~5: 미착수**

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

### Phase 0.5 디자인 (부분 완료)
- [x] 디자인 브리프 문서 작성 (docs/design-brief.md)
- [x] 스티치 앱으로 디자인 시도 → 설정 페이지만 나옴, 100% 만족 안 됨
- [x] 직접 "Dark Room" 컨셉 디자인 시스템 구축 (globals.css)
- [x] 메인 생성 페이지 UI 구현 (page.tsx) — 2x2 그리드 + 사이드바 + 프롬프트 독
- [ ] **사용자 디자인 피드백 대기 중** ← 현재 여기
- [ ] 피드백 반영 후 design-tokens.ts 최종 확정

---

## 프로젝트 구조 (현재)

```
ai-image-studio/
├── frontend/                    # Next.js 14 (Tailwind v4, App Router)
│   ├── app/
│   │   ├── globals.css          # ★ 디자인 시스템 (@theme 토큰, 애니메이션)
│   │   ├── layout.tsx           # Sora + Geist + Geist Mono 폰트
│   │   └── page.tsx             # ★ 메인 생성 페이지 (전체 UI)
│   ├── components/ui/           # (빈 폴더 — Phase 1에서 컴포넌트화)
│   ├── hooks/                   # (빈 폴더)
│   ├── stores/useAppStore.ts    # Zustand 스토어 (상태 타입 정의됨)
│   ├── styles/design-tokens.ts  # 디자인 토큰 (globals.css와 동기화 필요)
│   ├── lib/api.ts               # API 클라이언트 (fetch 래퍼)
│   └── .env.local               # NEXT_PUBLIC_API_URL
│
├── backend/                     # FastAPI
│   ├── main.py                  # 엔트리 + lifespan + CORS + 헬스체크
│   ├── config.py                # pydantic-settings (.env 로드)
│   ├── database.py              # aiosqlite 스키마 (generations 테이블)
│   ├── models/schemas.py        # ★ Pydantic 스키마 (Generate, Enhance, Process, History)
│   ├── routers/                 # (빈 __init__.py만 — Phase 1에서 구현)
│   ├── services/                # (빈 __init__.py만 — Phase 1에서 구현)
│   └── workflows/               # (빈 폴더 — ComfyUI JSON 템플릿)
│
├── .venv/                       # Python 가상환경 (의존성 설치 완료)
├── docs/
│   ├── design-brief.md          # 스티치용 프로젝트 소개 문서
│   └── SESSION_STATUS.md        # ← 이 파일
├── stitch-output/               # 스티치 산출물 (DESIGN.md, code.html, screen.png)
│
├── AI_Image_Studio_기획서_v1.1.md  # ★ 원본 기획서 (전체 설계)
├── CLAUDE.md                    # Claude Code 프로젝트 설정
├── .env / .env.example          # 환경변수
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
| Phase 1 추가 | **생성 취소** | ComfyUI /interrupt 래핑 |
| Phase 2 추가 | **키보드 단축키** | Ctrl+Enter, Escape 등 |
| 폰트 | Sora(display) + Geist(UI) + Geist Mono(tech) | |
| 컬러 | Violet accent (#7c3aed) + 7단계 다크 서피스 | |

---

## 다음 할 일 (우선순위 순)

### 1. 디자인 피드백 반영 (Phase 0.5 마무리)
- 사용자에게 localhost:3000 보여주고 피드백 받기
- 컬러/레이아웃/폰트 수정사항 반영
- design-tokens.ts를 globals.css와 동기화

### 2. Phase 1: MVP 백엔드 구현
핵심 파일 생성 순서:
1. `backend/config.py` — ✅ 완료
2. `backend/services/process_manager.py` — ComfyUI 온디맨드 실행/종료
3. `backend/services/comfyui_client.py` — ComfyUI API 통신
4. `backend/services/workflow_manager.py` — JSON 템플릿 주입
5. `backend/routers/generate.py` — 생성 API + 취소 + WebSocket 진행률
6. `backend/routers/process.py` — 프로세스 상태 API

### 3. Phase 1: MVP 프론트엔드 연동
- page.tsx의 인라인 컴포넌트를 개별 파일로 분리
- useWebSocket.ts, useGenerate.ts 훅 구현
- 실제 API 연동

---

## 핵심 참조 파일

| 파일 | 용도 | 언제 읽을까 |
|------|------|-------------|
| `AI_Image_Studio_기획서_v1.1.md` | 전체 설계 원본 | 아키텍처/API/워크플로우 확인 시 |
| `docs/design-brief.md` | 디자인 방향 요약 | UI 수정 시 |
| `backend/models/schemas.py` | API 스키마 정의 | 라우터/서비스 구현 시 |
| `frontend/app/globals.css` | 디자인 토큰 전체 | UI 수정 시 |
| `frontend/app/page.tsx` | 메인 페이지 전체 | 컴포넌트 분리 시 |
| `frontend/stores/useAppStore.ts` | 상태 타입 정의 | 프론트 로직 구현 시 |

---

## 강화된 기획 (v2.0) 주요 추가사항

기획서 v1.1에 없었던 것 중 추가하기로 한 것:
1. **생성 취소 API** — `POST /api/generate/cancel/{task_id}` (Phase 1)
2. **큐 관리** — asyncio.Queue 인메모리 (Phase 1)
3. **키보드 단축키** — Ctrl+Enter 생성, Escape 취소 (Phase 2)
4. **이미지 저장 전략** — PNG Info 메타데이터 + 날짜별 디렉토리 (Phase 3)
5. **에러 처리 세분화** — 상황별 한국어 메시지 + 자동 복구 (전 Phase)
6. **설정 페이지 강화** — 프리셋, 기본값, 테마 (Phase 4~5)
7. **structlog** — 구조화 로깅 (Phase 5)

전체 플랜은 `.claude/plans/declarative-finding-bee.md`에 있음.

---

## 개발 환경 참고

```bash
# 프론트엔드 실행
cd frontend && npm run dev          # localhost:3000

# 백엔드 실행
cd backend && ../.venv/Scripts/uvicorn main:app --reload --port 8000

# 린트
cd backend && ../.venv/Scripts/ruff check .
cd frontend && npm run lint

# GitHub (주의: GH_TOKEN 만료됨, keyring 인증 사용)
unset GH_TOKEN                      # 반드시 먼저 실행
gh auth status                      # Park1981 keyring 인증 확인
```

---

## Git 커밋 히스토리

1. `65352ba` — init: 프로젝트 초기 세팅 (Phase 0)
2. `1208ca0` — feat(frontend): 메인 생성 페이지 UI + 디자인 시스템

---

> 새 세션 시작 시: 이 파일 + 기획서 + CLAUDE.md 읽고 Phase 0.5 피드백부터 이어가기
