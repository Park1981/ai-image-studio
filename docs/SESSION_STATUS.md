# AI Image Studio — 프로젝트 진행 상태

> 마지막 업데이트: 2026-04-12 (세션 4)
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
**Phase 6: 구조화 AI 보강 + 수정 모드 AI보강 ✅**
**Phase 7: 프로세스 관리 + 모델 프리셋 + 커스텀 사이즈 ✅**
**Phase 8: 잔여 개선 + Codex 리뷰 반영 ✅**
**Phase 9: 최종 레이아웃 리팩토링 ✅**
**Phase 9.5: 모델 시스템 리팩토링 ← 구현 완료, 테스트 필요**
**Phase 10: 미착수 (영상 생성 — 최종 단계)**

---

## 🔴 다음 세션에서 할 것 (이어서 하자)

### 1. 모델 시스템 리팩 테스트 (최우선)
세션 4에서 구현 완료된 코드가 정상 동작하는지 브라우저 테스트:

**변경 파일:**
- `backend/models/model_presets.json` — 3개 모델만 (Qwen 2512, zImage Turbo, Qwen Edit 2511)
- `frontend/components/CreationPanel.tsx` — 모드별 필터링 + 자동 전환 + VAE 매칭

**테스트 항목:**
- [ ] 생성 모드 드롭다운: Qwen Image 2512 (기본) + zImage Turbo만 표시
- [ ] 수정 모드 전환 시 Qwen Edit 2511 자동 선택
- [ ] zImage Turbo 선택 시 steps=8, cfg=1.0, scheduler=sgm_uniform 적용
- [ ] 모드 전환 시 VAE 자동 매칭 (qwen_image_vae / zImage_vae)
- [ ] 생성 모드로 복귀 시 Qwen 2512 기본값 복원 (steps=50, cfg=4.0)

### 2. E2E 테스트 이어서
- TEST 5: 수정 모드 이미지 생성 (Qwen Edit 2511)
- TEST 6: 새 프롬프트 txt2img 생성
- TEST 7: 히스토리 목록 + 삭제
- TEST 8: 에러 핸들링

### 3. 발견된 이슈
- 프롬프트 텍스트 중복 입력 현상: AI 보강 결과에 텍스트 중복 발생 → 원인 조사 필요

### 4. Codex 리뷰
- 모델 시스템 리팩 코드에 대해 codex:codex-rescue 리뷰 요청

### 5. Phase 10: 영상 생성 (최종)
- WAN 2.2 / HunyuanVideo 연동 (모델 이미 설치됨)

---

## 환경 설정

```bash
# 서비스 포트 매핑
ComfyUI Desktop: http://127.0.0.1:8000
백엔드 (FastAPI): http://127.0.0.1:8001
프론트엔드 (Next.js): http://localhost:3000
Ollama: http://127.0.0.1:11434

# 실행 순서
1. ComfyUI Desktop 직접 실행 (바탕화면 아이콘) 또는 백엔드가 자동 시작
2. cd backend && ../.venv/Scripts/uvicorn main:app --host 127.0.0.1 --port 8001 --reload
3. cd frontend && npm run dev
```

## 모델 시스템 (Phase 9.5 — 신규)

| 모드 | 모델 | Steps | CFG | Sampler | Scheduler | VAE |
|------|------|-------|-----|---------|-----------|-----|
| 생성 (기본) | Qwen Image 2512 | 50 | 4.0 | euler | simple | qwen_image_vae |
| 생성 | zImage Turbo | 8 | 1.0 | euler_ancestral | sgm_uniform | zImage_vae |
| 수정 | Qwen Edit 2511 | 50 | 4.0 | euler | simple | qwen_image_vae |

- 모드 전환(생성↔수정) 시 모델 + 파라미터 자동 적용
- 프리셋 데이터: `backend/models/model_presets.json`
- 필터링 로직: `frontend/components/CreationPanel.tsx` (filteredModels useMemo)

---

## 프로젝트 구조

```
ai-image-studio/
├── frontend/                        # Next.js 14 (Tailwind CSS)
│   ├── app/page.tsx                 # 메인 페이지
│   ├── components/
│   │   ├── Header.tsx               # 로고 + 상태 + 새생성/히스토리/설정
│   │   ├── ImageGrid.tsx            # 동적 그리드 (batchSize 기반)
│   │   ├── ImageViewer.tsx          # 풀스크린 뷰어 (줌/패닝)
│   │   ├── CreationPanel.tsx        # 오른쪽 통합 패널 (프롬프트+설정+모델)
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
│   └── styles/design-tokens.ts      # 디자인 토큰
│
├── backend/                         # FastAPI
│   ├── main.py                      # 엔트리
│   ├── config.py                    # 환경 설정
│   ├── database.py                  # SQLite 히스토리 DB
│   ├── routers/
│   │   ├── generate.py              # 이미지 생성 + WS + 히스토리 저장
│   │   ├── history.py               # 히스토리 CRUD API
│   │   ├── process.py               # ComfyUI/Ollama 관리
│   │   ├── models.py                # 모델 목록 + 프리셋
│   │   └── prompt.py                # AI 프롬프트 보강
│   ├── services/
│   │   ├── comfyui_client.py        # ComfyUI REST/WS 클라이언트
│   │   ├── process_manager.py       # 프로세스 라이프사이클
│   │   ├── workflow_manager.py      # 워크플로우 파라미터 주입
│   │   └── prompt_engine.py         # Ollama 프롬프트 보강 엔진
│   ├── models/
│   │   ├── schemas.py               # Pydantic 스키마
│   │   └── model_presets.json       # 모델별 권장 파라미터
│   └── workflows/
│       ├── qwen_image.json          # Qwen Image 생성 워크플로우
│       ├── qwen_image_edit.json     # Qwen Image Edit 수정 워크플로우
│       └── txt2img.json             # 범용 txt2img 워크플로우
│
├── data/
│   ├── images/                      # 생성 이미지 (날짜별 하위폴더)
│   ├── uploads/                     # 수정 모드 소스 이미지 업로드
│   └── history.db                   # SQLite 히스토리 DB
├── docs/SESSION_STATUS.md           # ← 이 파일
└── CLAUDE.md                        # 프로젝트 지시서
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

> 새 세션 시작 시: 이 파일 읽고 → "모델 시스템 리팩 테스트" 우선 진행
