# AI Image Studio — 프로젝트 진행 상태

> 마지막 업데이트: 2026-04-12 (세션 5)
> 세션 복구용 문서 — 새 세션에서 이 파일을 먼저 읽을 것

---

## 현재 진행 단계

**Phase 1~9: 기본 기능 구현 ✅** (txt2img, edit, 히스토리, 프리셋, 뷰어, 레이아웃)
**Phase A: 코드 구조 리팩토링 ✅** (슬라이스 분리, 컴포넌트 분해, 공유 훅, TaskManager)
**Phase B: 핵심 기능 개선 ✅** (비전 보강, Claude CLI 폴백, 생성→수정 흐름, Edit 확장, WS 안정화)
**Phase C: 새 기능 추가 ✅** (템플릿, 히스토리 검색, VRAM 표시, 유휴 자동 종료)
**Phase D: 테스트 ✅** (백엔드 pytest 64개 + 프론트엔드 vitest 34개)
**갭 분석: 93% (14/15 항목 완벽 구현)** — SamplingSettings→AdvancedSettings 네이밍 차이만
**Phase 10: 미착수** (영상 생성 — WAN 2.2 / HunyuanVideo 연동)

---

## 환경 설정

```bash
# 서비스 포트 매핑
ComfyUI Desktop: http://127.0.0.1:8188
백엔드 (FastAPI): http://127.0.0.1:8001
프론트엔드 (Next.js): http://localhost:3000
Ollama: http://127.0.0.1:11434

# 실행 순서
1. ComfyUI Desktop 직접 실행 (바탕화면 아이콘) 또는 백엔드가 자동 시작
2. cd backend && ../.venv/Scripts/uvicorn main:app --host 127.0.0.1 --port 8001 --reload
3. cd frontend && npm run dev

# 테스트 실행
4. cd backend && python -m pytest tests/ -v
5. cd frontend && npm test
```

## 모델 시스템

| 모드 | 모델 | Steps | CFG | Sampler | Scheduler | VAE |
|------|------|-------|-----|---------|-----------|-----|
| 생성 (기본) | Qwen Image 2512 | 50 | 4.0 | euler | simple | qwen_image_vae |
| 생성 | zImage Turbo | 8 | 1.0 | euler_ancestral | sgm_uniform | zImage_vae |
| 수정 | Qwen Edit 2511 | 50 | 4.0 | euler | simple | qwen_image_vae |

---

## 프로젝트 구조

```
ai-image-studio/
├── frontend/                            # Next.js 14 (Tailwind CSS)
│   ├── app/page.tsx                     # 메인 페이지
│   ├── components/
│   │   ├── Header.tsx                   # 로고 + VRAM 바 + 상태
│   │   ├── ImageGrid.tsx                # 동적 그리드 + "수정" 버튼
│   │   ├── ImageViewer.tsx              # 풀스크린 뷰어 (줌/패닝)
│   │   ├── CreationPanel.tsx            # 오른쪽 통합 패널 (레이아웃 컨테이너)
│   │   ├── creation/                    # 서브컴포넌트 (Phase A 분해)
│   │   │   ├── PromptInput.tsx          # 프롬프트 입력 + 네거티브 + AI보강 체크
│   │   │   ├── EnhanceResult.tsx        # 보강 결과 카테고리 표시/확인
│   │   │   ├── ModelSelector.tsx        # 체크포인트 선택
│   │   │   ├── SizeSelector.tsx         # 사이즈 프리셋 + 커스텀
│   │   │   ├── AdvancedSettings.tsx     # sampler/scheduler/steps/cfg/seed/VAE/LoRA
│   │   │   ├── EditModePanel.tsx        # 이미지 업로드 + 프리뷰
│   │   │   └── GenerateButton.tsx       # 생성/취소 버튼
│   │   ├── HistoryPanel.tsx             # 히스토리 패널 (검색 지원)
│   │   └── icons.tsx                    # SVG 아이콘
│   ├── hooks/
│   │   ├── useGenerate.ts              # 2단계 생성 오케스트레이션
│   │   ├── useEnhance.ts               # AI 보강 로직
│   │   ├── useEditMode.ts              # 수정 모드 전환/소스 이미지 관리
│   │   ├── useModelPresets.ts           # 모델별 권장 파라미터 자동 적용
│   │   ├── useWebSocket.ts             # WS 진행률 (exponential backoff)
│   │   ├── useModels.ts                # 모델 목록 조회
│   │   └── useProcessStatus.ts         # 프로세스 상태 폴링
│   ├── stores/
│   │   ├── useAppStore.ts              # Zustand (슬라이스 합성 진입점)
│   │   └── slices/                     # 6개 슬라이스 (Phase A 분리)
│   │       ├── promptSlice.ts
│   │       ├── generationSlice.ts
│   │       ├── modelSlice.ts
│   │       ├── settingsSlice.ts
│   │       ├── uiSlice.ts
│   │       └── processSlice.ts
│   ├── lib/
│   │   ├── api.ts                      # API 클라이언트
│   │   └── presets.ts                  # 프리셋 시스템
│   ├── __tests__/                      # vitest (Phase D)
│   │   ├── setup.ts
│   │   ├── slices.test.ts
│   │   └── useGenerate.test.ts
│   └── styles/design-tokens.ts         # 디자인 토큰
│
├── backend/                             # FastAPI
│   ├── main.py                         # 엔트리 + lifespan
│   ├── config.py                       # pydantic-settings 환경 설정
│   ├── database.py                     # SQLite (히스토리 + 템플릿)
│   ├── routers/
│   │   ├── generate.py                 # 이미지 생성/수정 + WS
│   │   ├── history.py                  # 히스토리 CRUD + 검색
│   │   ├── process.py                  # ComfyUI/Ollama 관리 + VRAM
│   │   ├── models.py                   # 모델 목록 + 프리셋
│   │   └── prompt.py                   # AI 보강 + 비전 + 템플릿 CRUD
│   ├── services/
│   │   ├── comfyui_client.py           # ComfyUI REST/WS 클라이언트
│   │   ├── process_manager.py          # 프로세스 라이프사이클 + 유휴 종료
│   │   ├── workflow_manager.py         # 워크플로우 파라미터/LoRA 주입
│   │   ├── prompt_engine.py            # Ollama + Claude CLI 폴백 + 비전
│   │   └── task_manager.py             # 태스크 CRUD (asyncio.Lock)
│   ├── models/
│   │   ├── schemas.py                  # Pydantic 스키마
│   │   └── model_presets.json          # 모델별 권장 파라미터
│   ├── workflows/
│   │   ├── qwen_image.json
│   │   ├── qwen_image_edit.json
│   │   └── txt2img.json
│   ├── tests/                          # pytest (Phase D)
│   │   ├── conftest.py
│   │   ├── test_prompt_engine.py
│   │   ├── test_workflow_manager.py
│   │   ├── test_task_manager.py
│   │   └── test_generate.py
│   └── pytest.ini
│
├── docs/
│   ├── SESSION_STATUS.md               # ← 이 파일
│   └── design-brief.md                 # 초기 설계 문서
├── .gitignore
└── CLAUDE.md                           # 프로젝트 지시서
```

---

## 단축키

| 키 | 동작 |
|----|------|
| Ctrl+Enter | 생성 / 보강 확인 |
| ESC | 취소 / 뷰어 닫기 / 보강 취소 |
| 더블클릭 | 이미지 크게 보기 |
| ← → | 뷰어 이미지 전환 |
| + − 0 | 줌 인 / 줌 아웃 / 리셋 |

---

## 브라우저 테스트 규칙

- 이미지 생성/수정/AI보강: 스크린샷 **3분 간격**, 중간은 JS/read_page로 확인
- 레이아웃/UI 수정: 스크린샷 간격 제한 없음
- 구현 완료 후 codex:codex-rescue에 리뷰 요청

---

> 다음 목표: Phase 10 (영상 생성 — WAN 2.2 / HunyuanVideo 연동)
