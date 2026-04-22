# AI Image Studio — Full Redesign · Design Spec

- **Date**: 2026-04-22
- **Author**: 공동 브레인스토밍 (정완 오빠 + Claude)
- **Status**: Phase 1 구현 완료 · Phase 2 구현 대기
- **Branch**: `claude/quirky-chebyshev-805c60` (worktree)

---

## 1. Context

기존 구조는 단일 화면에 생성/수정/설정/히스토리를 모두 욱여넣은 복잡한 단일 패널이었음 (frontend 3,400+ 줄 · backend 3,292 줄). 사용자 체감상 "뭘 하는 앱인지 자기도 헷갈릴 정도"로 복잡해졌고, 불필요한 기능(6카테고리 AI 보강, 이중 히스토리, 이중 고급 설정, 프롬프트 템플릿 CRUD API 등)이 누적된 상태.

**재설계 목표**:
1. "모드 진입형" 명확한 플로우: 메인 메뉴 → 선택한 모드 화면
2. UX 밀도: 핵심 노출 + 고급은 접기. 모델 드롭다운은 메인에서 제거, 설정으로 이동.
3. "조사 필요(퀄리티 업)" 체크박스 — Claude CLI 호출 명시적 트리거
4. 수정 모드: 이미지 + 자연어 → 로컬 2단계 비전 체이닝(vision-q4km → gemma4-un) → 자동 프롬프트/사이즈 추출
5. 백엔드는 "참조로 냅두고" 새로 설계 — 검증된 I/O 패턴은 차용
6. 모델·워크플로우 JSON 기반 구성 — 새 모델 나올 때마다 코드 수정 없이 확장

---

## 2. 사용자 플로우

```
앱 시작 ─▶ 메인 메뉴 (카드 3장)
                │
                ├─ 이미지 생성 ─▶ 프롬프트 입력 + [조사 필요] + [생성]
                │                   │
                │                   ├─ gemma4-un 업그레이드
                │                   ├─ (옵션) Claude CLI 조사 → context 주입
                │                   ├─ (옵션) 업그레이드 확인 모달
                │                   └─ ComfyUI (Qwen Image 2512) ─▶ 결과
                │
                ├─ 이미지 수정 ─▶ 이미지 업로드 + 자연어 지시 + [수정]
                │                   │
                │                   ├─ 1. vision-q4km 이미지 설명
                │                   ├─ 2. gemma4-un 설명+요청 통합
                │                   ├─ 3. 사이즈/스타일 자동 추출
                │                   └─ ComfyUI (Qwen Image Edit 2511) ─▶ 결과
                │
                └─ 영상 생성 (v2 스텁)

⚙️ 어디서나 설정 드로어: 프로세스 · 모델 · 템플릿 · 프리퍼런스 · 히스토리 관리
```

---

## 3. 프론트엔드 아키텍처 (Phase 1 · 구현 완료)

### 3.1 기술 스택

- **Framework**: Next.js 16 (App Router) · React 19 · TypeScript strict
- **Styling**: Tailwind CSS v4 + CSS custom props (디자인 토큰)
- **상태관리**: Zustand v5 + persist middleware
- **폰트**: Pretendard Variable + Noto Sans KR + JetBrains Mono (CDN)
- **Mock API**: async generator 기반 파이프라인 스트림 (실 백엔드 연결 시 교체)

### 3.2 디자인 토큰 (`app/globals.css`)

| 계열 | 토큰 | 값 |
|-----|-----|---|
| 서피스 | `--bg` / `--bg-2` / `--surface` | #FAF9F7 / #F4F2EE / #FFFFFF |
| 잉크 | `--ink` / `--ink-2` / `--ink-3` / `--ink-4` | #1F1F1F / #46464A / #7A7A80 / #AEAEB3 |
| 라인 | `--line` / `--line-2` | #E8E5DF / #DCD8D0 |
| 액센트 | `--accent` / `--accent-ink` / `--accent-soft` | #4A9EFF / #1E7BE0 / #EAF3FF |
| 시맨틱 | `--green` / `--amber` | #52C41A / #FAAD14 |
| 라운딩 | `--radius-sm/md/lg` | 8/12/16 px |
| 섀도우 | `--shadow-sm/md/lg` | 3-tier |

### 3.3 라우팅 & 페이지

```
app/
├── page.tsx                  # MainMenu (카드 3장 + 상태 스트립)
├── generate/page.tsx         # GenerateScreen
├── edit/page.tsx             # EditScreen (FileReader 업로드)
├── video/page.tsx            # 스텁 "곧 만나요"
└── layout.tsx                # AppShell 래퍼
```

### 3.4 컴포넌트 디렉토리

```
components/
├── app/
│   └── AppShell.tsx                  # SettingsProvider + Drawer + ToastHost + AutoStartBoot
├── chrome/Chrome.tsx                 # Logo · TopBar · IconBtn · BackBtn · ModelBadge
├── menu/MenuCard.tsx
├── settings/
│   ├── SettingsContext.tsx           # open/close + ESC
│   ├── SettingsButton.tsx            # gear trigger
│   └── SettingsDrawer.tsx            # 5개 섹션 (Process/Model/Templates/Preferences/History)
└── ui/
    ├── Icon.tsx                      # 23개 SVG 아이콘
    ├── ImageTile.tsx                 # 결정론적 플레이스홀더 + StripedPH
    ├── primitives.tsx                # Pill/Field/SegControl/Range/Meta/SmallBtn/Spinner/StepMark/Toggle
    └── ToastHost.tsx                 # 우측 하단 토스트
```

### 3.5 Zustand 스토어 (6개)

| 스토어 | 영속화 | 역할 |
|-------|------|------|
| `useSettingsStore` | ✅ 전체 | 모델 선택 · 프리퍼런스 토글 · 프롬프트 템플릿 |
| `useProcessStore` | ✅ 전체 | Ollama · ComfyUI 상태 |
| `useHistoryStore` | ✅ items (selected 제외) | 생성/수정 결과 (최대 200) |
| `useGenerateStore` | ⏳ 부분 (입력값만) | 프롬프트 · 종횡비 · 고급 설정 · 진행 상태 |
| `useEditStore` | ❌ 세션 한정 | 업로드 이미지 · 파이프라인 상태 |
| `useToastStore` | ❌ 세션 한정 | 전역 토스트 |

localStorage namespace 접두어 `ais:` 사용.

### 3.6 Mock API 레이어 (`lib/api-client.ts`)

- `generateImageStream(req)` — AsyncGenerator, 단계별 `{type, progress, stageLabel}` yield, 마지막에 `{type: "done", item}` yield
- `editImageStream(req)` — AsyncGenerator, 4단계 step 진행
- `setProcessStatus(name, action)` — Mock delay 후 성공 반환
- `researchPrompt(prompt, model)` — Mock 힌트 3개 반환

`NEXT_PUBLIC_USE_MOCK="false"` 시 실 백엔드 호출로 전환 (Phase 2).

### 3.7 주요 UX 디테일

- **Settings drawer**: 우측 슬라이드 (400px), overlay click + ESC 닫기, 5개 섹션
- **Lightning 토글**: ON 시 steps=4/CFG=1.0 자동 스위치, OFF 복귀
- **조사 필요 배너**: amber tint, 체크박스 + "미리보기" 버튼 (즉시 Claude CLI 호출)
- **종횡비 SegControl**: 1:1/16:9/9:16/4:3/3:4/3:2/2:3 (Qwen 2512 권장)
- **Before/After 슬라이더**: 드래그 가능, FileReader dataURL 또는 결정론적 플레이스홀더 혼용
- **토스트**: 4종류(info/success/warn/error), 3.8초 자동 dismiss, 수동 닫기
- **히스토리 픽커**: 수정 모드 "히스토리에서 선택" 클릭 시 최근 16장 오버레이

---

## 4. 모델 & 워크플로우 계약 (`lib/model-presets.ts`)

### 4.1 Aspect Ratios (Qwen 권장)

| Label | W × H |
|-------|------|
| 1:1 | 1328×1328 |
| 16:9 | 1664×928 |
| 9:16 | 928×1664 |
| 4:3 | 1472×1104 |
| 3:4 | 1104×1472 |
| 3:2 | 1584×1056 |
| 2:3 | 1056×1584 |

### 4.2 Generate Model — Qwen Image 2512

- **Workflow**: `backend/workflows/qwen_image_2512.json` (Subgraph `c3c58f7e-…`)
- **Files**:
  - UNET: `qwen_image_2512_fp8_e4m3fn.safetensors`
  - CLIP: `qwen_2.5_vl_7b_fp8_scaled.safetensors`
  - VAE: `qwen_image_vae.safetensors`
- **LoRA 체인**:
  1. `Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors` (strength 1, role=lightning)
  2. `FemNude_qwen-image-2512_epoch30.safetensors` (strength 1, role=extra)
- **Defaults**: steps=50, CFG=4.0, sampler=euler, scheduler=simple, shift=3.1, batch=1, seed=464857551335368
- **Lightning**: steps=4, CFG=1.0
- **Negative prompt**: 워크플로우 고정 중국어 네거티브 (저품질/왜곡/AI감 방지)

### 4.3 Edit Model — Qwen Image Edit 2511

- **Workflow**: `backend/workflows/qwen_image_edit_2511.json` (Subgraph `cdb2cf24-…`)
- **Files**: UNET = `qwen_image_edit_2511_bf16.safetensors`, CLIP/VAE 공용
- **LoRA 체인**:
  1. `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` (strength 1, role=lightning)
  2. `SexGod_CouplesNudity_QwenEdit_2511_v1.safetensors` (strength 0.7, role=extra)
- **Defaults**: steps=40, CFG=4.0, sampler=euler, scheduler=simple, shift=3.1, cfgNorm=1
- **Lightning**: steps=4, CFG=1.0
- **referenceLatentMethod**: `index_timestep_zero` (FluxKontextMultiReferenceLatentMethod)
- **autoScaleReferenceImage**: true (FluxKontextImageScale)
- **maxReferenceImages**: 3 (UI 는 1번 슬롯만 노출)

### 4.4 Ollama 모델 역할 분리

| 역할 | 모델 | 비고 |
|------|-----|------|
| 프롬프트 업그레이드 | `gemma4-un:latest` (25.2B) | text 전용 — tools/thinking 사용 |
| 수정 모드 비전 분석 | `gemma4-heretic:vision-q4km` (572M + CLIP) | 로컬 비전, 2단계 체이닝 |
| 백업 텍스트 | `gemma4-heretic:text-q4km`, `super-sis:latest` 등 | 선택적 |

---

## 5. 백엔드 아키텍처 (Phase 2 · 구현 대기)

### 5.1 기술 스택 (기존 유지)

- FastAPI (Python 3.11+) · uvicorn · httpx · aiosqlite · pydantic-settings
- 기존 `backend/services/comfyui_client.py` 는 **참조로 유지**. 검증된 WebSocket 핸들링 패턴을 차용.
- ComfyUI Desktop (:8188) · Ollama (:11434) 외부 연결
- Claude CLI subprocess (cp949 디코딩 이슈 기존 해결)

### 5.2 디렉토리 스케치 (새 구조)

```
backend/
├── main.py                    # FastAPI 앱 + lifespan (autoStart 옵션 반영)
├── config.py                  # pydantic-settings · .env 로드
├── database.py                # aiosqlite 초기화
├── routers/
│   ├── generate.py            # POST /api/generate, SSE /api/generate/stream/{task_id}
│   ├── edit.py                # POST /api/edit (multipart), 동일 SSE
│   ├── research.py            # POST /api/research (Claude CLI 비대화 호출)
│   ├── history.py             # GET / DELETE /api/history[/{id}]
│   ├── models.py              # GET /api/models (presets 반환)
│   ├── process.py             # GET /api/process/status, POST /start|stop
│   └── templates.py           # (선택) 서버측 템플릿 API (현재는 프론트 로컬 저장)
├── services/
│   ├── comfy_runner.py        # 새 이름 — workflow JSON 로드 + 입력 주입 + WebSocket 실행
│   ├── prompt_pipeline.py     # gemma4 업그레이드 + optional Claude 조사 병합
│   ├── vision_pipeline.py     # 수정 모드 2단계 체이닝 (vision-q4km → gemma4-un)
│   ├── claude_cli.py          # subprocess + UTF-8 인코딩
│   ├── process_manager.py     # Ollama · ComfyUI 라이프사이클 (기존 차용)
│   ├── task_manager.py        # in-flight task registry (기존 차용)
│   └── storage.py             # 이미지 파일 저장/서빙 (기본 backend/output/)
├── models/
│   ├── schemas.py             # Pydantic 요청/응답
│   └── presets.py             # ModelPreset dataclass (lib/model-presets.ts 의 Python 대응)
└── workflows/
    ├── qwen_image_2512.json                   # ✅ 저장됨
    ├── qwen_image_edit_2511.json              # ✅ 저장됨
    └── qwen_image_edit_2511.with_notes.json   # ✅ 저장됨 (참조용)
```

### 5.3 API 계약 (프론트 ↔ 백엔드)

#### 5.3.1 Generate

```http
POST /api/generate
Content-Type: application/json
{
  "prompt": "...",
  "aspect": "1:1",
  "steps": 50,
  "cfg": 4.0,
  "seed": 464857551335368,
  "lightning": false,
  "research": false
}

Response 200:
{
  "task_id": "tsk_abc123",
  "stream_url": "/api/generate/stream/tsk_abc123"
}
```

SSE Stream (text/event-stream):
```
event: stage
data: {"type":"prompt-parse","progress":15,"stageLabel":"프롬프트 해석"}

event: stage
data: {"type":"gemma4-upgrade","progress":35,"stageLabel":"gemma4 업그레이드","upgraded":"..."}

event: done
data: {"item": HistoryItem}

event: error
data: {"message": "..."}
```

#### 5.3.2 Edit

```http
POST /api/edit
Content-Type: multipart/form-data
- image: (file)
- meta: JSON { "prompt": "...", "lightning": false }

Response: 동일 패턴 (task_id + stream_url)
```

Stream 은 4단계 step 이벤트 + done:
```
event: step
data: {"step":1,"done":false}
event: step
data: {"step":1,"done":true,"description":"..."}
...
event: done
data: {"item": HistoryItem}
```

#### 5.3.3 Research (Claude CLI)

```http
POST /api/research
{
  "prompt": "...",
  "model": "Qwen Image 2512"
}

Response 200:
{
  "hints": ["...", "...", "..."],
  "latency_ms": 1820
}
```

#### 5.3.4 Process

```http
GET /api/process/status
→ {"ollama":{"running":true},"comfyui":{"running":false,"vram_used_gb":0}}

POST /api/process/{ollama|comfyui}/{start|stop}
→ {"ok":true,"message":"..."}
```

#### 5.3.5 History

```http
GET /api/history?limit=50&cursor=...
→ {"items":[HistoryItem], "next_cursor": "..."}

DELETE /api/history/{id}
→ {"ok":true}
```

#### 5.3.6 Models

```http
GET /api/models
→ {
  "generate": {ModelPreset},
  "edit": {ModelPreset},
  "aspect_ratios": [...]
}
```

### 5.4 워크플로우 주입 계약

`comfy_runner` 가 `workflow.json` 을 로드 후 subgraph proxyWidgets 에 다음 값 주입:

**Generate (subgraph `c3c58f7e-…`)**:
- `text` ← 최종 프롬프트 (gemma4 업그레이드 + 선택적 Claude 조사 반영)
- `width`, `height` ← aspect 에서 도출
- `value` (enable_turbo_mode) ← `lightning` 불린
- `seed` ← 요청 seed (0 이면 서버에서 랜덤)
- `unet_name`, `clip_name`, `vae_name`, `lora_name` ← preset (변경 여지 남김)

JSON 의 하드코딩된 2번째 LoRA (FemNude), ModelSamplingAuraFlow shift, Negative prompt, CFGNorm 는 그대로 유지 (주입 대상 아님).

**Edit (subgraph `cdb2cf24-…`)**:
- `image`, `image2`, `image3` ← 사용자 업로드 (슬롯 1, 2/3 은 비움)
- `prompt` ← vision_pipeline 결과 최종 프롬프트
- `value` ← lightning 불린
- seed, 모델 파일명 4종 ← preset

### 5.5 Pipeline 구현 순서

1. `comfy_runner` + workflow 로드/주입 단위 테스트
2. WebSocket 진행 수신 + SSE relay
3. `prompt_pipeline` (gemma4 + 선택적 claude)
4. `vision_pipeline` (2단계 체이닝)
5. 이미지 저장 + history DB 기록
6. `/api/generate`, `/api/edit` 와이어
7. `/api/research` (Claude CLI) — 독립 엔드포인트
8. `/api/process/*` (기존 process_manager 차용)
9. `/api/history`, `/api/models`
10. E2E 스모크 (mock ComfyUI)

---

## 6. 데이터 모델

### 6.1 HistoryItem (프론트 = 백엔드 공통 shape)

```ts
interface HistoryItem {
  id: string;
  mode: "generate" | "edit";
  prompt: string;
  label: string;          // UI 표시용 단축 라벨
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  lightning: boolean;
  model: string;           // displayName
  createdAt: number;       // epoch ms
  imageRef: string;        // 서버: /images/abc.png · Mock: mock-seed://... · Edit: dataURL
}
```

### 6.2 ModelPreset (JSON)

`backend/models/model_presets.json` — 프론트 `lib/model-presets.ts` 와 일대일 대응. 서버가 `/api/models` 로 반환.

```json
{
  "generate": {
    "displayName": "Qwen Image 2512",
    "workflow": "qwen_image_2512.json",
    "subgraphId": "c3c58f7e-...",
    "files": {...},
    "loras": [{"name":"...","strength":1,"role":"lightning"}, ...],
    "defaults": {...},
    "lightning": {"steps":4, "cfg":1.0}
  },
  "edit": {...}
}
```

### 6.3 SQLite 스키마 (단일 테이블)

```sql
CREATE TABLE history (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('generate','edit')),
  prompt TEXT NOT NULL,
  label TEXT NOT NULL,
  width INTEGER, height INTEGER,
  seed INTEGER, steps INTEGER, cfg REAL,
  lightning INTEGER,
  model TEXT,
  created_at INTEGER NOT NULL,
  image_ref TEXT NOT NULL,
  raw_meta TEXT  -- JSON: 추가 메타 (LoRA 구성, negative 등)
);
CREATE INDEX idx_history_created ON history(created_at DESC);
CREATE INDEX idx_history_mode ON history(mode, created_at DESC);
```

---

## 7. 에러 처리 & 상태 복구

### 7.1 프론트 (Phase 1 구현됨)

- 모든 API 실패 → Toast(error) 출력, 스토어 `resetRunning()` 호출하여 UI 풀어줌
- 업로드 이미지 형식 오류 → Toast(error)
- 히스토리 삭제 `confirm()` 1회
- Settings drawer 프로세스 토글 실패 → Toast(error) + 원상 복귀 (안 set)

### 7.2 백엔드 (Phase 2 설계)

- **ComfyUI 연결 실패**: 500 + `{error, action_hint: "ComfyUI 시작해줘"}`. 프론트는 Toast + 드로어 열기 제안.
- **Workflow JSON 로드 실패**: 500. 구조 검증 (subgraphId 일치, 필수 proxyWidgets 존재).
- **Claude CLI 타임아웃**: 20s 초과 시 research 없이 원본 프롬프트로 진행 + Warn 이벤트.
- **Ollama 응답 실패**: 프롬프트 업그레이드 skip + Warn. 원본 프롬프트 전달.
- **이미지 파일 저장 실패**: disk full 등. 500 + disk 상태 안내.
- **SSE 연결 끊김**: 클라이언트 재연결은 하지 않음 (멱등성 문제). 사용자에게 "연결 끊어짐" 토스트 후 폴링(/api/history/{id}) 로 결과 확인.

### 7.3 보안 (CLAUDE.md 제약 반영)

- subprocess 호출: `shell=False`, 경로 화이트리스트
- 이미지 경로 파라미터: path traversal 방지 (`storage.py` 에서 normalize + root check)
- CORS: localhost 만 허용
- `.env` 에서 모든 URL/포트 로드, 하드코딩 금지

---

## 8. 테스트 전략

### 8.1 Phase 1 (프론트)

- **Vitest + React Testing Library**: 각 스토어 단위 테스트 (persist mock 제외)
- **컴포넌트 스냅샷**: MenuCard · Toggle · SegControl 렌더 검증
- **Integration (JSDOM)**: "생성 클릭 → 단계 이벤트 → 히스토리 추가 → 토스트" 플로우
- **수동 smoke**: 4개 라우트 200 + 주요 UI 문자열 검증 (CI 에서 curl 스크립트)

현재 기존 `__tests__/` 는 레거시 컴포넌트용 — 신규 테스트는 `__tests__/studio/` 하위에 분리.

### 8.2 Phase 2 (백엔드)

- **pytest + httpx AsyncClient**: 각 라우터 happy path + 에러 브랜치
- **ComfyUI mock**: `services/comfy_runner.py` 에 pluggable transport. 테스트에선 FakeComfyTransport 주입 → 지정된 step 이벤트 발생 후 완료.
- **Ollama mock**: httpx respx 로 `/api/chat` 응답 주입
- **Claude CLI mock**: subprocess monkeypatch 로 stdout 프리셋
- **Zero Script QA** (CLAUDE.md 언급): Docker 실시간 로그 + 구조화 JSON 로그로 수동 검증 보완

### 8.3 E2E (Phase 2 후)

- **Playwright MCP**: 메뉴 → 생성 → 이미지 확인 → 수정 → 결과 시나리오
- **테스트 모델 프리셋**: 작은 SD 모델로 cherry-pick (Qwen 로딩 30s 방지)

---

## 9. Phase 2 구현 순서 (권장)

1. **워크플로우 로드 + 주입 단위** (2h) — mock transport 로 검증
2. **SSE 파이프라인** (4h) — FastAPI StreamingResponse + EventSource 프론트 연결
3. **prompt_pipeline** (3h) — Ollama 호출 + 실패 폴백
4. **vision_pipeline** (3h) — 2단계 체이닝 검증
5. **research (Claude CLI)** (2h) — subprocess + UTF-8 + 타임아웃
6. **/api/process/** (2h) — 기존 process_manager 차용
7. **/api/history, /api/models** (2h)
8. **storage + 이미지 서빙** (1h)
9. **실연결 스모크 테스트** (Ollama + ComfyUI 실제 띄워서 1장 생성, 1장 수정) (2h)
10. **회귀 픽스** (2~5h)

**예상 소요**: 21~27h (상당한 디버깅 예상). 단계별로 커밋 + 테스트 권장.

---

## 10. 열린 이슈 · 나중에 결정

- **비디오 모드 (v2)**: Wan 2.x 기반? HunyuanVideo? 오빠가 워크플로우 준비되면 결정
- **템플릿 서버 저장**: 현재 프론트 localStorage. 협업/백업 필요 시 `/api/templates` 추가
- **다크 모드**: Claude Design 핸드오프는 라이트 전용. 필요 시 토큰 교체 시스템 추가
- **i18n**: 지금 한국어 고정. 영어/일본어 지원은 v3
- **이미지 업로드 크기 제한**: 현재 제한 없음. Phase 2 에서 서버측 max 20MB 강제
- **히스토리 200개 오버플로**: 프론트만 FIFO. 백엔드 DB 는 전체 유지 → 페이지네이션

---

## 11. 검증 상태 (Phase 1)

- ✅ 4개 라우트 (`/`, `/generate`, `/edit`, `/video`) 모두 HTTP 200
- ✅ Settings Drawer 마운트 + 5개 섹션 렌더 (프로세스/모델/템플릿/프리퍼런스/히스토리)
- ✅ Toast 4종 등장/dismiss
- ✅ localStorage 영속화 (settings · process · history · generate 입력값)
- ✅ FileReader 업로드 + 크기 추출
- ✅ Mock API 스트림 5단계 (generate) / 4단계 (edit) 완료 이벤트
- ✅ Lightning 토글 ↔ steps/CFG 동기화
- ✅ 종횡비 7개 SegControl
- ✅ 수정 모드 히스토리 픽커
- ✅ 메인 메뉴 실 히스토리 카운트 + ComfyUI 상태 표시
- ✅ 콘솔 에러 없음

## 12. 다음 할 일 (사용자 테스트 후)

1. 오빠 실제 브라우저에서 한 바퀴 돌려보고 UX 이슈 피드백
2. Phase 2 구현 착수 (섹션 9 순서 기반)
3. E2E 스모크 후 배포 준비
