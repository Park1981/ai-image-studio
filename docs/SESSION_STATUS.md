# AI Image Studio — 프로젝트 진행 상태

> 마지막 업데이트: 2026-04-12
> 세션 복구용 문서 — 새 세션에서 이 파일을 먼저 읽을 것

---

## 현재 진행 단계

**Phase 0: 프로젝트 초기화 ✅**
**Phase 0.5: 디자인 시스템 확정 ✅**
**Phase 1: MVP 백엔드 + 프론트엔드 연동 ✅**
**Phase 1.5: Qwen 모델 연동 + E2E + 버그 수정 6건 ✅**
**Phase 2: AI보강 2단계 + 풀스크린 뷰어 + 접근성 + 단축키 ✅**
**Phase 3: 히스토리 시스템 (DB + 패널 + 설정 복원) ✅**
**Phase 4: 프리셋 + 뷰어 줌 + 설정 페이지 + 프리셋→AI보강 연동 ✅**
**Phase 4.5: Ollama 폴백 경고 + LLM 모델 스위칭 ✅**
**Phase 5: Qwen Image Edit 이미지 수정 기능 ✅**
**Phase 6: 미착수 (AI 보강 디테일 옵션)**
**Phase 7: 미착수 (영상 생성)**

---

## 🔴 다음 세션에서 할 것

### Phase 6: AI 보강 디테일 옵션
- 보강 세부 설정 (창의성, 디테일 수준, 스타일 강도 토글)
- prompt_engine 파라미터 확장

### Phase 7: 영상 생성
- WAN 2.2 / HunyuanVideo 연동 (모델 이미 설치됨)
- 영상 재생 UI

### 기타 미적용 사항
- 프리셋 삭제 UI (커스텀 프리셋 삭제 기능 없음)
- 뷰어 `prefers-reduced-motion` 대응

### 미적용 피드백 (메모리에 저장됨)
- Codex: localStorage JSON 구조 검증 필요
- Codex: 모달 `role="dialog"` / `aria-modal` / 포커스 관리 미흡

---

## 환경 설정 (중요!)

```bash
# 서비스 포트 매핑 (주의!)
ComfyUI Desktop: http://127.0.0.1:8000  # ← 기본 8188이 아님!
백엔드 (FastAPI): http://127.0.0.1:8001
프론트엔드 (Next.js): http://localhost:3000
Ollama: http://127.0.0.1:11434

# 실행 순서
1. ComfyUI Desktop 직접 실행 (바탕화면 아이콘) 또는 백엔드가 자동 시작
2. cd backend && ../.venv/Scripts/uvicorn main:app --host 127.0.0.1 --port 8001 --reload
3. cd frontend && npm run dev

# Ollama는 자동 시작됨 (ollama list 실행하면 서비스 자동 기동)
```

## 모델 정보

| 항목 | 값 |
|------|------|
| 이미지 생성 | Qwen Image 2512 (fp8, diffusion_models) |
| 텍스트 인코더 | qwen_2.5_vl_7b_fp8_scaled |
| VAE | qwen_image_vae |
| LLM (프롬프트 보강) | gemma4:26b (Ollama) |
| 워크플로우 | workflows/qwen_image.json |
| 기본 파라미터 | euler, simple, 50 steps, cfg=4, 1328×1328 |

---

## 프로젝트 구조

```
ai-image-studio/
├── frontend/                        # Next.js 16 (Tailwind v4)
│   ├── app/page.tsx                 # 메인 페이지
│   ├── components/
│   │   ├── Header.tsx               # 로고 + 상태 + 새생성/히스토리/설정
│   │   ├── ImageGrid.tsx            # 동적 그리드 (batchSize 기반)
│   │   ├── ImageViewer.tsx          # 풀스크린 뷰어 (줌/패닝)
│   │   ├── PromptDock.tsx           # 프롬프트 입력 + 프리셋 + 설정
│   │   ├── SettingsSidebar.tsx      # 고급 설정 (VAE, LoRA, Steps 등)
│   │   ├── SettingsPanel.tsx        # 설정 모달 (프로세스/단축키)
│   │   ├── HistoryBar.tsx           # 하단 썸네일 갤러리
│   │   ├── HistoryPanel.tsx         # 전체 히스토리 패널
│   │   ├── ErrorToast.tsx           # 에러 알림
│   │   └── icons.tsx                # SVG 아이콘
│   ├── hooks/
│   │   ├── useGenerate.ts           # 2단계 생성 (보강→확인→생성)
│   │   ├── useWebSocket.ts          # WS 진행률 수신
│   │   ├── useModels.ts             # 모델 목록 조회
│   │   └── useProcessStatus.ts      # 프로세스 상태 폴링
│   ├── stores/useAppStore.ts        # Zustand 전역 상태
│   ├── lib/
│   │   ├── api.ts                   # API 클라이언트
│   │   └── presets.ts               # 프리셋 시스템
│   └── .env.local
│
├── backend/                         # FastAPI
│   ├── main.py                      # 엔트리
│   ├── config.py                    # 환경 설정
│   ├── database.py                  # SQLite 히스토리 DB
│   ├── routers/
│   │   ├── generate.py              # 이미지 생성 + WS + 히스토리 저장
│   │   ├── history.py               # 히스토리 CRUD API
│   │   ├── process.py               # ComfyUI/Ollama 관리
│   │   ├── models.py                # 모델 목록 (UNET + 체크포인트)
│   │   └── prompt.py                # AI 프롬프트 보강
│   ├── services/
│   │   ├── comfyui_client.py        # ComfyUI REST/WS 클라이언트
│   │   ├── process_manager.py       # 프로세스 라이프사이클
│   │   ├── workflow_manager.py      # 워크플로우 파라미터 주입
│   │   └── prompt_engine.py         # Ollama 프롬프트 보강 엔진
│   └── workflows/qwen_image.json    # Qwen Image 워크플로우
│
├── data/
│   ├── images/                      # 생성 이미지 (날짜별 하위폴더)
│   └── history.db                   # SQLite 히스토리 DB
└── docs/SESSION_STATUS.md           # ← 이 파일
```

---

## 주요 기능 요약

| 기능 | 설명 |
|------|------|
| AI 보강 2단계 | 생성→AI보강→사용자확인/수정→이미지생성 |
| 프리셋→AI보강 | 프리셋 스타일이 AI 보강 지침에 전달 (portrait/landscape 등) |
| 동적 그리드 | batchSize에 따라 1칸/2칸/2x2 레이아웃 |
| 풀스크린 뷰어 | 더블클릭, 마우스 휠 줌 0.5x~5x, 드래그 패닝 |
| 히스토리 | DB 자동 저장, 하단 썸네일 갤러리, 상단 패널 (설정 복원) |
| 프리셋 | 기본 5종 + 커스텀 저장 (localStorage) |
| 설정 페이지 | 프로세스 관리 + 기본 설정 + 단축키 안내 |
| ComfyUI 자동 시작 | subprocess + Windows 플래그 |

## 단축키

| 키 | 동작 |
|----|------|
| Ctrl+Enter | 생성 / 보강 확인 |
| ESC | 취소 / 뷰어 닫기 / 보강 취소 |
| 더블클릭 | 이미지 크게 보기 |
| ← → | 뷰어 이미지 전환 |
| + − 0 | 줌 인 / 줌 아웃 / 리셋 |

---

## 이번 세션 커밋 히스토리 (2026-04-11)

```
5b9e17b  fix: WS 이미지 표시 + ComfyUI 자동 실행 + UI 6건
087d2b4  fix: 동적 그리드 + hydration + 스피너
2b65ea1  feat: AI보강 2단계 분리
51f205a  feat: 풀스크린 뷰어 + 접근성 + 단축키
d2c15db  fix: Codex 리뷰 (중복방지/수정본/ESC)
70dff7a  fix: 이미지 비율 object-contain
fe018ee  feat: Phase 3 히스토리 시스템
c992c51  feat: 상단 히스토리 패널
1ae7d77  fix: 히스토리 피드백 반영
4ff9808  feat: Phase 4 프리셋+줌+설정
171cf20  fix: Codex Phase 4 피드백 3건
41aac51  docs: Phase 2~4 완료 상태 반영
ce33745  feat: 프리셋→AI보강 스타일 연동
```

---

> 새 세션 시작 시: 이 파일 읽고 → Phase 5 기획 또는 피드백 반영
