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
**Phase 6: 구조화 AI 보강 + 수정 모드 AI보강 ✅**
**Phase 7: 미착수 (프로세스 관리 + 모델 설정 + 사이즈)**
**Phase 8: 미착수 (잔여 개선 + 품질)**
**Phase 9: 미착수 (최종 레이아웃 리팩토링)**
**Phase 10: 미착수 (영상 생성 — 최종 단계)**

---

## 🔴 다음 세션에서 할 것

### Phase 7: 프로세스 관리 + 모델 설정 + 이미지 사이즈 (다음 우선)
**7-A. 프로세스 라이프사이클 변경**
- ComfyUI: 앱 시작 시 함께 시작, 앱 종료 시 함께 종료 (자동 셧다운 제거)
- Ollama: AI 보강 요청 시만 시작, 완료 후 VRAM 즉시 반납 (keep_alive: 0)
- VRAM 충돌 방지: Ollama 끝 → ComfyUI 사용 (순차적)

**7-B. 모델별 권장 설정 시스템**
- 모델 선택 시 자동으로 권장 steps/cfg/sampler/scheduler 적용
- 사용자 오버라이드 가능
- 예: Qwen Image → euler/simple/50steps/cfg4, 다른 모델은 다른 기본값
- 모델 메타데이터 JSON으로 관리

**7-C. 커스텀 이미지 사이즈**
- 비율 프리셋(1:1, 16:9 등) 외에 직접 width × height 픽셀 입력 지원
- 예: 500×500, 1920×1080 등 자유 입력

### Phase 8: 잔여 개선 + 품질
- 프리셋 삭제 UI (커스텀 프리셋 삭제 기능 없음)
- 뷰어 `prefers-reduced-motion` 대응
- localStorage JSON 구조 검증
- 모달 접근성 (`role="dialog"` / `aria-modal` / 포커스 관리)
- 히스토리 DB EditRequest.prompt warning 수정

### Phase 9: 최종 레이아웃 리팩토링 (모든 기능 완성 후)
- 하단 프롬프트 독 → **오른쪽 패널**로 이동
- 패널 구성: 프롬프트 입력, 프리셋/모델, 사이즈/배치, AI 보강 결과(자세히), 네거티브, 생성 버튼
- 이미지 그리드를 왼쪽에 넓게 안정적 배치
- 패널 접기/펴기 토글 유지, 히스토리 바 하단 유지
- 레이아웃 구상:
  ```
  ┌──────────────────────────┬─────────────────┐
  │ Header                   │                 │
  ├──────────────────────────┤  Right Panel    │
  │                          │  ├ 프롬프트 입력 │
  │  이미지 그리드 (넓게)     │  ├ 모델+설정    │
  │                          │  ├ 사이즈/배치   │
  │                          │  ├ AI 보강 결과  │
  │                          │  ├ 네거티브      │
  │                          │  └ [생성] 버튼   │
  ├──────────────────────────┤                 │
  │ History Bar              │                 │
  └──────────────────────────┴─────────────────┘
  ```

### Phase 10: 영상 생성 (최종 단계)
- WAN 2.2 / HunyuanVideo 연동 (모델 이미 설치됨)
- 영상 재생 UI
- 영상 전용 파라미터 (프레임수, 길이 등)

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
| 이미지 수정 | Qwen Image Edit 2511 (bf16, diffusion_models) |
| 텍스트 인코더 | qwen_2.5_vl_7b_fp8_scaled |
| VAE | qwen_image_vae |
| LLM (프롬프트 보강) | gemma4:26b (Ollama, 설정에서 변경 가능) |
| 생성 워크플로우 | workflows/qwen_image.json |
| 수정 워크플로우 | workflows/qwen_image_edit.json |
| 생성 기본 파라미터 | euler, simple, 50 steps, cfg=4, 1328×1328 |
| 수정 기본 파라미터 | euler, simple, 50 steps, cfg=4 (원본 이미지 크기 유지) |

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
│   └── workflows/
│       ├── qwen_image.json          # Qwen Image 생성 워크플로우
│       ├── qwen_image_edit.json     # Qwen Image Edit 수정 워크플로우
│       └── txt2img.json             # 범용 txt2img 워크플로우
│
├── data/
│   ├── images/                      # 생성 이미지 (날짜별 하위폴더)
│   ├── uploads/                     # 수정 모드 소스 이미지 업로드
│   └── history.db                   # SQLite 히스토리 DB
└── docs/SESSION_STATUS.md           # ← 이 파일
```

---

## 주요 기능 요약

| 기능 | 설명 |
|------|------|
| AI 보강 2단계 | 생성→AI보강→사용자확인/수정→이미지생성 |
| Ollama 폴백 경고 | AI보강 실패 시 빨간색 경고 배너 + 재시도 버튼 |
| LLM 모델 스위칭 | 설정 페이지에서 Ollama 모델 선택 (5개 모델) |
| 이미지 수정 (Phase 5) | 생성/수정 모드 토글, 이미지 업로드 → Qwen Edit → 수정 결과 |
| 프리셋→AI보강 | 프리셋 스타일이 AI 보강 지침에 전달 (portrait/landscape 등) |
| 동적 그리드 | batchSize에 따라 1칸/2칸/2x2 레이아웃 |
| 풀스크린 뷰어 | 더블클릭, 마우스 휠 줌 0.5x~5x, 드래그 패닝 |
| 히스토리 | DB 자동 저장, 하단 썸네일 갤러리, 상단 패널 (설정 복원) |
| 프리셋 | 기본 5종 + 커스텀 저장 (localStorage) |
| 설정 페이지 | 프로세스 관리 + LLM 모델 선택 + 기본 설정 + 단축키 |
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

## 세션 2 커밋 히스토리 (2026-04-12)

```
c00afc3  feat: Ollama 폴백 경고 + LLM 모델 스위칭
533f0dd  feat: Phase 5 — Qwen Image Edit 이미지 수정 기능
862ba5e  docs: Phase 5 완료 상태 + Phase 6~7 로드맵 갱신
5fdf584  fix: Qwen Image Edit 워크플로우 필드명 수정
```

## 세션 1 커밋 히스토리 (2026-04-11)

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

## Phase 5 기술 상세 (다음 세션 참고)

### 이미지 수정 파이프라인
```
사용자 이미지 업로드 → POST /api/images/upload → data/uploads/ 저장
                     → POST /api/generate/edit → ComfyUI /upload/image
                     → qwen_image_edit.json 워크플로우 실행
                     → WS 진행률 → 결과 이미지 다운로드 → 그리드 표시
```

### 수정 워크플로우 핵심 노드
- TextEncodeQwenImageEdit: 필드명 `prompt` (text 아님!)
- CFGNorm: 필드명 `strength` (scale 아님!)
- LoadImage: ComfyUI input 디렉토리에 업로드 필요

### 알려진 제한/개선 사항
- 브라우저 UI에서 form_input으로 textarea 값 설정 시 React state 동기 문제 있음
- 히스토리 DB 저장 시 EditRequest에 prompt 속성 없어서 warning 발생 (기능은 정상)
- 수정 모드에서 생성된 이미지 그리드 "수정" 버튼으로 바로 재수정 가능

---

## Phase 6 기술 상세 (세션 3, 2026-04-12)

### 구조화 AI 보강 시스템
```
사용자 입력 → Ollama (gemma4:26b) 분석
  → 6개 카테고리별 분류 (피사체/배경/조명/스타일/분위기/기술적)
  → 사용자가 입력한 카테고리: 유지 + 디테일 보강
  → 빈 카테고리: AI가 문맥에 맞게 자동 채우기
  → 영어 보강 텍스트 + 한국어 설명 반환
  → auto_filled 플래그로 AI 자동 채움 표시
```

### 주요 변경 파일
- `backend/services/prompt_engine.py`: 카테고리 기반 시스템 프롬프트, 생성/수정 모드 분리
- `backend/models/schemas.py`: EnhanceCategoryConfig, EnhanceCategoryItem 추가
- `frontend/stores/useAppStore.ts`: enhanceSettings (creativity/detailLevel/categories)
- `frontend/components/PromptDock.tsx`: 수정 모드 AI보강, 자세히 보기 토글
- `frontend/components/SettingsPanel.tsx`: AI 보강 세부 설정 (창의성/디테일/카테고리 토글)
- `frontend/lib/presets.ts`: 프리셋별 카테고리 기본값 연동

### Codex 리뷰 반영 (5건)
- [bug] edit 모드 busyRef 중복 호출 방지 추가
- [warning] 시스템 프롬프트에 동적 카테고리 수 반영
- [warning] enhance 실패 시 이전 결과 초기화
- [warning] edit 모드 WebSocket close() 추가
- [warning] edit negative dead data — 인지됨 (향후 개선)

---

> 새 세션 시작 시: 이 파일 읽고 → Phase 7 (영상 생성) 진행
