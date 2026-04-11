# AI Image Studio — 프로젝트 진행 상태

> 마지막 업데이트: 2026-04-11
> 세션 복구용 문서 — 새 세션에서 이 파일을 먼저 읽을 것

---

## 현재 진행 단계

**Phase 0: 프로젝트 초기화 ✅ 완료**
**Phase 0.5: 디자인 시스템 확정 ✅ 완료**
**Phase 1: MVP 백엔드 + 프론트엔드 연동 ✅ 완료**
**Phase 1.5: Qwen 모델 연동 + E2E 생성 테스트 ✅ 완료 (이미지 표시 버그 수정 완료)**
**Phase 2~5: 미착수**

---

## 🟢 Phase 1.5 버그 수정 완료 (2026-04-11)

### 수정된 버그 6개
1. **WS 이미지 표시 버그** — `generate.py`에서 async generator 정리 중 예외가 except에 잡혀 다운로드 스킵 → `execution_done` 플래그로 해결
2. **ComfyUI 히스토리 prompt 파싱** — ComfyUI `/history` 응답의 `prompt` 필드가 list인데 dict로 가정 → isinstance 분기 추가
3. **ComfyUI 자동 실행** — `subprocess.PIPE`가 Electron 앱 출력 버퍼 차서 멈춤 → `DEVNULL` + Windows 플래그
4. **사이즈 드롭다운 값 불일치** — `"1328x1328"` vs `"1:1"` 매칭 안 됨 → `SIZE_PRESETS.find()` 매칭
5. **스케줄러 "simple" 누락** — Qwen 기본값인데 옵션에 없었음 → 추가
6. **모델 드롭다운** — `UNETLoader` 기반 모델 미표시 + 불필요한 자동 선택 → `diffusion_models` 추가, 자동선택 제거

### 다음 세션에서 할 것
- Phase 2: img2img, 풀스크린 뷰어, 단축키
- .env.example 업데이트

---

## 환경 설정 (중요!)

```bash
# 서비스 포트 매핑 (주의!)
ComfyUI Desktop: http://127.0.0.1:8000  # ← 기본 8188이 아님!
백엔드 (FastAPI): http://127.0.0.1:8001
프론트엔드 (Next.js): http://localhost:3000
Ollama: http://127.0.0.1:11434

# 실행 순서
1. ComfyUI Desktop 직접 실행 (바탕화면 아이콘)
2. cd backend && ../.venv/Scripts/uvicorn main:app --host 127.0.0.1 --port 8001
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
| ComfyUI 모델 경로 | C:/ComfyUI/models/ |
| ComfyUI 워크플로우 | C:/ComfyUI/user/default/workflows/ |

---

## 프로젝트 구조

```
ai-image-studio/
├── frontend/                        # Next.js 16 (Tailwind v4)
│   ├── app/page.tsx                 # 메인 페이지 (컴포넌트 조합)
│   ├── components/                  # UI 컴포넌트 7개
│   ├── hooks/                       # 커스텀 훅 4개
│   ├── stores/useAppStore.ts        # Zustand 스토어
│   ├── lib/api.ts                   # API 클라이언트
│   └── .env.local                   # NEXT_PUBLIC_API_URL=http://127.0.0.1:8001
│
├── backend/                         # FastAPI
│   ├── main.py                      # 엔트리 (포트 8001)
│   ├── config.py                    # 설정 (gemma4:26b, ComfyUI:8000)
│   ├── routers/                     # generate, process, models, prompt
│   ├── services/                    # process_manager, comfyui_client, workflow_manager, prompt_engine
│   └── workflows/
│       ├── qwen_image.json          # ★ 현재 기본 워크플로우
│       └── txt2img.json             # SDXL용 (사용 안 함)
│
├── data/images/                     # 생성된 이미지 저장
├── docs/SESSION_STATUS.md           # ← 이 파일
└── .env                             # 환경변수 (gitignore)
```

---

## API 엔드포인트 (14개)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/generate` | 이미지 생성 (즉시 task_id 반환, 백그라운드 처리) |
| POST | `/api/generate/cancel/{task_id}` | 생성 취소 |
| GET | `/api/generate/status/{task_id}` | 태스크 상태 조회 |
| WS | `/api/ws/generate` | 전체 라이프사이클 스트리밍 |
| GET | `/api/process/status` | Ollama/ComfyUI 상태 |
| POST | `/api/process/comfyui/start\|stop` | ComfyUI 제어 |
| GET | `/api/models/list` | 모델 목록 |
| POST | `/api/prompt/enhance` | 프롬프트 AI 보강 |

---

## E2E 테스트 결과 (2026-04-11)

```
프롬프트: "A cute cat sitting on a windowsill, soft morning light, cozy atmosphere"
    ↓ Ollama gemma4:26b 보강 (~15초)
보강: "masterpiece, best quality, photorealistic, ...a cute fluffy kitten sitting peacefully..."
    ↓ ComfyUI Qwen Image 2512 생성 (~60초, 50 steps)
결과: 1328×1328 PNG, 2.2MB ✅ 성공
    ↓ 이미지 서빙: http://127.0.0.1:8001/images/test.png ✅
    ↓ 프론트 그리드 표시: ❌ WS 완료 메시지 전달 안 됨 (버그)
```

---

## Git 커밋 히스토리

1. `65352ba` — init: 프로젝트 초기 세팅
2. `1208ca0` — feat(frontend): 메인 생성 페이지 UI + 디자인 시스템
3. `a5609cd` — docs: 세션 복구용 프로젝트 상태 문서 추가
4. `e899066` — feat: Phase 1 MVP 백엔드 + UI 간소화 완성
5. `8d59b72` — fix: Qwen Image 워크플로우 연동 + 실제 생성 테스트 성공

---

## 향후 로드맵

| Phase | 내용 | 상태 |
|-------|------|------|
| 1.5 버그 | WS 이미지 표시 수정 | 다음 세션 |
| 2 | img2img, 풀스크린 뷰어, 단축키 | 미착수 |
| 3 | 히스토리 시스템 (DB + 검색 + 재생성) | 미착수 |
| 4 | 설정 페이지, 프리셋 | 미착수 |
| 5 | 영상 생성 연동 (WAN/HunyuanVideo) | 미착수 |

---

> 새 세션 시작 시: 이 파일 읽고 → WS 버그 수정부터 시작
