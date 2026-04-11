# AI Image Studio
### Local AI-Powered Image Generation WebUI

> **Next.js + FastAPI + ComfyUI + Ollama**
> Project Planning Document v1.1 | 2026.04.11 | UNITECH / Park Jung-Wan

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [시스템 아키텍처](#2-시스템-아키텍처)
3. [프로세스 라이프사이클 관리](#3-프로세스-라이프사이클-관리)
4. [핵심 기능 정의](#4-핵심-기능-정의)
5. [UI/UX 설계](#5-uiux-설계)
6. [API 설계](#6-api-설계)
7. [프로젝트 구조](#7-프로젝트-구조)
8. [개발 환경 세팅 (Claude Code)](#8-개발-환경-세팅-claude-code)
9. [CLAUDE.md 설계](#9-claudemd-설계)
10. [서브 에이전트 전략](#10-서브-에이전트-전략)
11. [개발 로드맵](#11-개발-로드맵)
12. [기술 스택 상세](#12-기술-스택-상세)
13. [리스크 및 고려사항](#13-리스크-및-고려사항)
14. [향후 확장 계획](#14-향후-확장-계획)

---

## 1. 프로젝트 개요

### 1.1 프로젝트명

**AI Image Studio** - Local AI-Powered Image Generation WebUI

### 1.2 목적 및 배경

ComfyUI의 강력한 이미지 생성 기능을 직관적인 웹 UI로 래핑하여, 비전문가도 쉽게 고품질 AI 이미지를 생성할 수 있는 로컬 환경 구축.

- ComfyUI 워크플로우의 복잡성을 숨기고 직관적 UI 제공
- 로컬 LLM(Ollama/Gemma)을 활용한 프롬프트 자동 보강 및 번역
- LoRA, 체크포인트, 샘플러 등 세부 설정을 슬라이더/드롭다운으로 제어
- 이미지 수정(img2img, inpaint) 및 배치 생성 지원
- 생성 이력 관리 및 검색
- **앱 시작/종료와 연동된 외부 프로세스(ComfyUI) 자동 관리로 PC 리소스 확보**

### 1.3 대상 환경

| 항목 | 사양 |
|------|------|
| 운영 환경 | Windows 11 로컬 PC (독립 실행) |
| GPU | NVIDIA RTX 4070 Ti SUPER (16GB VRAM) |
| RAM | 96GB DDR5 |
| 저장소 | NVMe SSD (모델/이미지 저장용) |
| 프론트엔드 | Next.js 14+ (App Router, TypeScript) |
| 백엔드 | FastAPI (Python 3.11+) |
| 이미지 생성 | ComfyUI Desktop (API 모드, :8188) |
| 로컬 LLM | Ollama + Gemma 3 27B (or Gemma 4) |
| 개발 도구 | Claude Code v2.1.91+ (VS Code), `/ultraplan` |

---

## 2. 시스템 아키텍처

### 2.1 전체 구성도

```
┌────────────────────────────────────────────────┐
│          브라우저 (Next.js Frontend)            │
│  ┌──────────────────────────────────────────┐  │
│  │ 프롬프트 입력 | 모델/LoRA 선택 | 설정    │  │
│  │ 이미지 그리드 뷰 | 진행률 | 히스토리     │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
                        │ REST API / WebSocket
┌────────────────────────────────────────────────┐
│         FastAPI Backend (:8000)                 │
│  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Prompt Engine │  │ ComfyUI Controller     │  │
│  │  (Ollama)     │  │ (Workflow Manager)     │  │
│  └──────────────┘  └────────────────────────┘  │
│  ┌─────────────────────────────────────────┐   │
│  │ Process Lifecycle Manager               │   │
│  │ (Ollama 상시 / ComfyUI 온디맨드 제어)   │   │
│  └─────────────────────────────────────────┘   │
└────────────────────────────────────────────────┘
          │                       │
  ┌───────────────┐       ┌────────────────────┐
  │ Ollama :11434 │       │ ComfyUI Desktop    │
  │ Gemma 3/4     │       │ :8188 (API Mode)   │
  │ (상시 실행)    │       │ (온디맨드 실행)     │
  └───────────────┘       │ models/loras/      │
                          │ models/checkpoints/│
                          └────────────────────┘
```

### 2.2 통신 흐름

| 단계 | 방향 | 프로토콜 | 설명 |
|------|------|----------|------|
| 1 | Frontend → Backend | REST API | 프롬프트 + 설정값 전송 |
| 2 | Backend → Ollama | HTTP POST | 프롬프트 보강/번역 요청 |
| 3 | Backend → ComfyUI | HTTP POST | 워크플로우 JSON 전송 |
| 4 | Backend ← ComfyUI | WebSocket | 진행률 실시간 수신 |
| 5 | Backend → Frontend | SSE / WS | 진행률 + 결과 이미지 전달 |

### 2.3 데이터 흐름 상세

```
[사용자 한국어 입력]
    │
    ▼
[FastAPI] ──POST──▶ [Ollama/Gemma] (상시 대기)
    │                    │
    │               한→영 번역 +
    │               품질 태그 추가 +
    │               네거티브 프롬프트 생성
    │                    │
    ◀────────────────────┘
    │
    ▼
[Process Manager] ── ComfyUI 실행 상태 확인 ──▶ 미실행 시 자동 시작 + 워밍업 대기
    │
    ▼
[Workflow Manager]
    │  워크플로우 JSON 템플릿 로드
    │  프롬프트/모델/LoRA/설정값 주입
    │
    ▼
[ComfyUI API] ──POST /prompt──▶ [ComfyUI Engine]
    │                                  │
    │  ◀──WebSocket (진행률)───────────┘
    │
    ▼
[GET /view?filename=xxx] → 이미지 수신
    │
    ▼
[Frontend] → 2x2 그리드 표시 + 히스토리 저장
```

---

## 3. 프로세스 라이프사이클 관리

### 3.1 설계 원칙

PC 리소스(VRAM, RAM) 확보를 위해, 외부 프로세스를 앱과 연동하여 자동 관리한다.

| 프로세스 | 전략 | 이유 |
|----------|------|------|
| **Ollama** | 상시 실행 (백그라운드 서비스) | 프로세스 자체가 가벼움 (~50MB), 요청 없으면 5분 후 자동 모델 언로드 |
| **ComfyUI Desktop** | 온디맨드 실행/종료 | 모델 로딩 시 VRAM 10GB+ 점유, 안 쓸 때 리소스 낭비 큼 |

### 3.2 ComfyUI 온디맨드 관리 흐름

```
[앱 시작 (FastAPI)]
    │
    ├── Ollama 실행 상태 확인 → 미실행 시 시작
    │
    └── ComfyUI는 아직 시작하지 않음 (리소스 절약)

[첫 이미지 생성 요청 시]
    │
    ├── ComfyUI 프로세스 시작 (subprocess)
    ├── Health Check 폴링 (GET /system_stats)
    ├── Ready 확인까지 대기 (타임아웃 60초)
    ├── Frontend에 "ComfyUI 워밍업 중..." 상태 표시
    └── Ready → 생성 요청 전송

[앱 종료 (FastAPI shutdown)]
    │
    ├── ComfyUI 프로세스 종료 (graceful → force)
    └── Ollama는 상시 유지 (OS 서비스)
```

### 3.3 Process Lifecycle Manager 구현 요점

```
backend/services/process_manager.py

역할:
- ComfyUI 실행 경로 설정 (config.py에서 관리)
- start_comfyui() : subprocess.Popen으로 실행 + health check 폴링
- stop_comfyui() : graceful shutdown 시도 → 5초 후 force kill
- is_comfyui_ready() : GET /system_stats 200 응답 확인
- ensure_comfyui() : 생성 요청 시 호출, 미실행이면 자동 시작
- FastAPI lifespan 이벤트에 start/stop 연결

고려사항:
- ComfyUI Desktop 실행 경로는 사용자마다 다를 수 있음 → .env로 관리
- 모델 로딩 시간 (SDXL 기준 ~15초) 포함한 워밍업 대기
- 비정상 종료 시 좀비 프로세스 방지 (atexit 등록)
- 이미 수동으로 ComfyUI가 실행 중인 경우 감지 (포트 체크)
```

### 3.4 유휴 시 자동 종료 (선택적)

- 마지막 생성 요청 후 N분(기본 10분) 경과 시 ComfyUI 자동 종료
- 설정에서 "항상 켜기" / "자동 종료" / "수동" 선택 가능
- 자동 종료 시 다음 생성 요청에서 다시 자동 시작 (워밍업 대기 포함)

---

## 4. 핵심 기능 정의

### 4.1 프롬프트 엔진

| 기능 | 설명 | 우선순위 |
|------|------|----------|
| 한국어 입력 | 한국어로 설명하면 AI가 영어 프롬프트로 변환 | P1 |
| 프롬프트 보강 | AI가 품질 태그, 스타일 키워드 자동 추가 | P1 |
| Negative Prompt 자동 생성 | 프롬프트에 맞는 네거티브 프롬프트 자동 생성 | P1 |
| 프롬프트 템플릿 | 자주 쓰는 스타일 템플릿 저장/불러오기 | P2 |
| 프롬프트 히스토리 | 과거 프롬프트 검색 및 재사용 | P2 |

### 4.2 이미지 생성

| 기능 | 설명 | 우선순위 |
|------|------|----------|
| txt2img | 텍스트로 이미지 생성 (1~4장 배치) | P1 |
| img2img | 참조 이미지 기반 변환 생성 | P2 |
| Inpainting | 이미지 부분 수정 (마스크 페인팅) | P2 |
| Upscale | 생성된 이미지 고해상도 확대 | P3 |
| 실시간 프리뷰 | 생성 중 진행 상황 표시 (WebSocket) | P1 |

### 4.3 모델 및 LoRA 관리

| 기능 | 설명 | 우선순위 |
|------|------|----------|
| 체크포인트 선택 | ComfyUI models/checkpoints/ 스캔 → 드롭다운 | P1 |
| LoRA 선택 (다중) | 복수 LoRA 동시 적용, 각각 강도 조절 | P1 |
| LoRA 강도 슬라이더 | strength_model / strength_clip 개별 조절 | P1 |
| VAE 선택 | VAE 모델 변경 옵션 | P2 |
| 샘플러 선택 | euler, dpmpp_2m, karras 등 선택 | P1 |
| 모델 자동 감지 | 폴더 감시로 새 모델 자동 목록 반영 | P3 |

### 4.4 결과 및 히스토리

| 기능 | 설명 | 우선순위 |
|------|------|----------|
| 4장 그리드 뷰 | 생성된 이미지 2x2 그리드로 비교 | P1 |
| 선택 및 저장 | 마음에 드는 이미지 선택 → 로컬 저장 | P1 |
| 생성 정보 표시 | 프롬프트, 시드, 모델, LoRA, 설정값 표시 | P1 |
| 히스토리 검색 | 과거 생성 이력 검색 및 필터링 | P2 |
| 즉시 재생성 | 과거 설정값으로 재생성 (시드 변경 가능) | P2 |

### 4.5 프로세스 관리 (UI)

| 기능 | 설명 | 우선순위 |
|------|------|----------|
| 상태 인디케이터 | 헤더에 Ollama/ComfyUI 실행 상태 표시 (🟢/🔴) | P1 |
| ComfyUI 수동 시작/종료 | 설정에서 수동 제어 버튼 | P2 |
| 유휴 자동 종료 설정 | 자동 종료 타이머 설정 (분 단위) | P2 |
| VRAM 사용량 표시 | ComfyUI system_stats에서 VRAM 정보 표시 | P3 |

---

## 5. UI/UX 설계

### 5.1 화면 구성

```
┌─────────────────────────────────────────────────────────────────┐
│  [AI Image Studio]          [🟢 Ollama] [🟢 ComfyUI]  [⚙ 설정]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────┐  ┌───────────────┐  │
│  │                                       │  │ 모델 선택     │  │
│  │     이미지 결과 영역                  │  │ ────────────  │  │
│  │     ┌─────────┐ ┌─────────┐          │  │ LoRA 선택     │  │
│  │     │ 이미지 1 │ │ 이미지 2 │          │  │ [+ LoRA 추가] │  │
│  │     └─────────┘ └─────────┘          │  │ ────────────  │  │
│  │     ┌─────────┐ ┌─────────┐          │  │ LoRA1 강도 [=]│  │
│  │     │ 이미지 3 │ │ 이미지 4 │          │  │ LoRA2 강도 [=]│  │
│  │     └─────────┘ └─────────┘          │  │ ────────────  │  │
│  └───────────────────────────────────────┘  │ 사이즈  [v]   │  │
│                                             │ Steps   [v]   │  │
│  ┌───────────────────────────────────────┐  │ CFG     [v]   │  │
│  │ 프롬프트 입력란                       │  │ Seed    [v]   │  │
│  │ 한국어 입력 OK                        │  │ Batch   [1-4] │  │
│  │ [AI 보강] ────── 보강 결과 미리보기   │  │ Sampler [v]   │  │
│  │ [네거티브 자동생성]         [🎨 생성]  │  │ Scheduler [v] │  │
│  └───────────────────────────────────────┘  └───────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 📋 최근 히스토리 (최근 5건, 클릭 시 설정 복원)            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 주요 페이지

| 페이지 | 경로 | 설명 |
|--------|------|------|
| 메인 (생성) | `/` | 프롬프트 입력, 설정, 이미지 생성/결과 |
| 히스토리 | `/history` | 생성 이력 목록, 검색, 재생성 |
| 설정 | `/settings` | ComfyUI/Ollama URL, 프로세스 관리, 기본값, 테마 |

### 5.3 디자인 원칙

- 다크 모드 기본 (OLED 최적화, 눈 피로 감소)
- 이미지 결과 영역을 가장 크게 배치 (70% 이상)
- 설정 패널은 우측 사이드바 (Collapsible)
- 애니메이션 최소화, 기능적 전환만 사용
- 모바일 반응형 (태블릿에서도 사용 가능)

### 5.4 디자인 시스템 구축 프로세스 ⚠️ 중요

디자인 시스템은 **사용자와의 적극적인 피드백 루프**를 통해 확정한다.

```
[Step 1] 컬러 팔레트 제안 (2~3 옵션)
    → 사용자 피드백 → 확정
    
[Step 2] 타이포그래피 + 간격 시스템 제안
    → 사용자 피드백 → 확정

[Step 3] 핵심 컴포넌트 샘플 구현 (3~4개)
    - PromptInput, ImageGrid, LoraPanel, SettingsPanel
    → 사용자 피드백 → 수정 → 확정

[Step 4] 메인 페이지 전체 레이아웃 구현
    → 사용자 피드백 → 수정 → 확정

[Step 5] 나머지 페이지 + 반응형 구현
```

디자인 시스템 산출물:
- `frontend/styles/design-tokens.ts` — 컬러, 간격, 폰트, 그림자 등 토큰 정의
- `frontend/components/ui/` — 공통 UI 컴포넌트 (Button, Slider, Dropdown, Card 등)
- 사용자 확정 없이 디자인 구현 진행 금지

---

## 6. API 설계

### 6.1 FastAPI 엔드포인트

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/generate` | 이미지 생성 요청 (txt2img / img2img) |
| POST | `/api/prompt/enhance` | AI 프롬프트 보강 요청 |
| GET | `/api/models/checkpoints` | 체크포인트 목록 조회 |
| GET | `/api/models/loras` | LoRA 목록 조회 |
| GET | `/api/models/samplers` | 샘플러 목록 조회 |
| GET | `/api/models/vaes` | VAE 목록 조회 |
| GET | `/api/status/{task_id}` | 생성 진행 상황 조회 |
| GET | `/api/images/{filename}` | 생성된 이미지 조회 |
| GET | `/api/history` | 생성 이력 조회 |
| DELETE | `/api/history/{id}` | 이력 삭제 |
| GET | `/api/process/status` | Ollama/ComfyUI 프로세스 상태 |
| POST | `/api/process/comfyui/start` | ComfyUI 수동 시작 |
| POST | `/api/process/comfyui/stop` | ComfyUI 수동 종료 |
| WS | `/ws/progress` | WebSocket 생성 진행률 스트림 |

### 6.2 주요 요청/응답 스키마

#### POST /api/generate

```json
// Request
{
  "prompt": "한국어 또는 영어 프롬프트",
  "negative_prompt": "네거티브 프롬프트 (선택)",
  "auto_enhance": true,
  "checkpoint": "sdxl_base_1.0.safetensors",
  "loras": [
    { "name": "detail_enhancer.safetensors", "strength_model": 0.7, "strength_clip": 0.7 },
    { "name": "anime_style.safetensors", "strength_model": 0.5, "strength_clip": 0.5 }
  ],
  "vae": "sdxl_vae.safetensors",
  "sampler": "dpmpp_2m",
  "scheduler": "karras",
  "width": 1024,
  "height": 1024,
  "steps": 25,
  "cfg": 7.0,
  "seed": -1,
  "batch_size": 4,
  "mode": "txt2img"
}

// Response
{
  "success": true,
  "data": {
    "task_id": "abc123",
    "status": "queued",
    "prompt_enhanced": "enhanced english prompt...",
    "negative_prompt": "auto-generated negative...",
    "comfyui_started": false
  }
}
```

#### POST /api/prompt/enhance

```json
// Request
{
  "prompt": "벚꽃 아래 걷는 여자",
  "style": "photorealistic"
}

// Response
{
  "success": true,
  "data": {
    "original": "벚꽃 아래 걷는 여자",
    "enhanced": "a woman walking under cherry blossom trees, soft pink petals falling, golden hour sunlight, shallow depth of field, photorealistic, 8k uhd, masterpiece, best quality",
    "negative": "worst quality, low quality, blurry, deformed, ugly, bad anatomy"
  }
}
```

#### GET /api/process/status

```json
// Response
{
  "success": true,
  "data": {
    "ollama": { "running": true, "model_loaded": "gemma3:27b", "ram_usage_mb": 52 },
    "comfyui": { "running": true, "vram_used_gb": 11.2, "vram_total_gb": 16.0, "uptime_min": 23 }
  }
}
```

### 6.3 ComfyUI API 연동

| ComfyUI API | 용도 |
|-------------|------|
| `POST /prompt` | 워크플로우 실행 (JSON body) |
| `GET /system_stats` | 시스템 상태 확인 + health check |
| `GET /history/{prompt_id}` | 생성 결과 조회 |
| `GET /view?filename=xxx` | 이미지 파일 조회 |
| `GET /object_info` | 노드 정보 조회 (LoRA 목록 포함) |
| `WS /ws?clientId=xxx` | 실시간 진행률 수신 |

### 6.4 워크플로우 JSON 템플릿 전략

ComfyUI에서 수동으로 각 워크플로우를 만든 후, API Format JSON으로 저장하여 템플릿으로 사용.

| 템플릿 파일 | 용도 |
|-------------|------|
| `txt2img_base.json` | 기본 텍스트 → 이미지 생성 |
| `txt2img_lora.json` | LoRA 적용 텍스트 → 이미지 |
| `img2img.json` | 이미지 → 이미지 변환 |
| `inpaint.json` | 부분 수정 (마스크 기반) |
| `upscale.json` | 고해상도 확대 |

FastAPI의 `workflow_manager.py`에서 템플릿 JSON을 로드한 후, 프롬프트/모델/LoRA/설정값 필드만 동적으로 교체하여 ComfyUI에 전송.

---

## 7. 프로젝트 구조

```
ai-image-studio/
├── frontend/                    # Next.js 14 (App Router)
│   ├── app/
│   │   ├── page.tsx             # 메인 페이지 (생성 UI)
│   │   ├── history/page.tsx     # 히스토리 페이지
│   │   ├── settings/page.tsx    # 설정 페이지
│   │   └── layout.tsx           # 공통 레이아웃
│   ├── components/
│   │   ├── ui/                  # 디자인 시스템 공통 컴포넌트
│   │   │   ├── Button.tsx
│   │   │   ├── Slider.tsx
│   │   │   ├── Dropdown.tsx
│   │   │   └── Card.tsx
│   │   ├── PromptInput.tsx      # 프롬프트 입력 + AI 보강
│   │   ├── ImageGrid.tsx        # 2x2 결과 그리드
│   │   ├── ModelSelector.tsx    # 체크포인트 선택
│   │   ├── LoraPanel.tsx        # LoRA 다중 선택 + 강도
│   │   ├── SettingsPanel.tsx    # 생성 설정 패널
│   │   ├── ProgressBar.tsx      # 생성 진행률
│   │   ├── StatusIndicator.tsx  # Ollama/ComfyUI 상태 표시
│   │   └── HistoryList.tsx      # 생성 이력 목록
│   ├── hooks/
│   │   ├── useGenerate.ts       # 생성 API 훅
│   │   ├── useWebSocket.ts      # WS 진행률 훅
│   │   ├── useModels.ts         # 모델 목록 훅
│   │   └── useProcessStatus.ts  # 프로세스 상태 훅
│   ├── stores/
│   │   └── useAppStore.ts       # Zustand 상태 관리
│   ├── styles/
│   │   └── design-tokens.ts     # 디자인 토큰 정의
│   ├── lib/
│   │   └── api.ts               # API 클라이언트
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── backend/                     # FastAPI
│   ├── main.py                  # FastAPI 앱 엔트리 + lifespan
│   ├── routers/
│   │   ├── generate.py          # 생성 API 라우터
│   │   ├── models.py            # 모델/LoRA API
│   │   ├── prompt.py            # 프롬프트 보강 API
│   │   ├── history.py           # 히스토리 API
│   │   └── process.py           # 프로세스 관리 API
│   ├── services/
│   │   ├── comfyui_client.py    # ComfyUI API 클라이언트
│   │   ├── ollama_client.py     # Ollama API 클라이언트
│   │   ├── workflow_manager.py  # 워크플로우 JSON 관리
│   │   ├── prompt_engine.py     # 프롬프트 보강 엔진
│   │   └── process_manager.py   # 프로세스 라이프사이클 관리
│   ├── models/
│   │   └── schemas.py           # Pydantic 스키마
│   ├── workflows/               # ComfyUI 템플릿 JSON
│   │   ├── txt2img_base.json
│   │   ├── txt2img_lora.json
│   │   ├── img2img.json
│   │   ├── inpaint.json
│   │   └── upscale.json
│   ├── config.py                # 환경설정 (경로, URL, 타이머)
│   ├── database.py              # SQLite 히스토리 DB
│   └── requirements.txt
│
├── CLAUDE.md                    # Claude Code 메인 설정
├── .env                         # 환경변수 (ComfyUI 경로 등)
├── .gitignore
└── README.md
```

---

## 8. 개발 환경 세팅 (Claude Code)

### 8.1 사전 요구사항

| 항목 | 요구사항 |
|------|----------|
| Claude Code | v2.1.91 이상 |
| GitHub | 계정 연결 완료 |
| Claude Code on the web | 활성화 |
| Node.js | 18+ |
| Python | 3.11+ |
| Ollama | 설치 완료 + gemma3:27b 다운로드 |
| ComfyUI Desktop | 설치 완료 + SDXL/Flux 모델 1개 이상 |

### 8.2 초기 세팅 순서

```
1. 프로젝트 디렉토리 생성
   $ mkdir ai-image-studio && cd ai-image-studio
   $ git init

2. Claude Code에서 /ultraplan 실행
   $ claude
   > /ultraplan "AI Image Studio 프로젝트 초기 세팅.
   >  기획서(AI_Image_Studio_기획서_v1.1.md)를 참고하여
   >  프로젝트 구조 생성, CLAUDE.md 작성, 
   >  frontend/backend 보일러플레이트 세팅,
   >  .env 템플릿 생성을 진행해줘."

3. /ultraplan이 Opus 4.6으로 플래닝 진행 (최대 30분)
   → 터미널은 다른 작업 가능

4. 브라우저에서 플랜 리뷰
   → 인라인 코멘트, 이모지 리액션으로 피드백
   → 수정 요청 가능

5. 승인 후 실행
   → 웹에서 바로 실행 → PR 생성
   → 또는 "teleport back to terminal"로 로컬 실행
```

### 8.3 /ultraplan 활용 전략

| Phase | /ultraplan 프롬프트 | 목적 |
|-------|---------------------|------|
| 초기 세팅 | 프로젝트 구조 + CLAUDE.md + 보일러플레이트 | 전체 뼈대 |
| Phase 1 | ComfyUI 연동 서비스 + 기본 생성 UI | MVP |
| Phase 2 | Ollama 연동 + LoRA 패널 + 배치 생성 | AI + LoRA |
| Phase 3 | img2img + inpaint + 히스토리 | 고급 기능 |

각 Phase 시작 시 `/ultraplan`으로 Opus 4.6의 심층 플래닝을 받고, 리뷰 후 실행하는 사이클.

### 8.4 .env 템플릿

```bash
# ComfyUI
COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_EXECUTABLE=C:/Users/{username}/AppData/Local/Programs/ComfyUI/ComfyUI.exe
COMFYUI_MODELS_PATH=C:/Users/{username}/ComfyUI/models
COMFYUI_AUTO_SHUTDOWN_MINUTES=10

# Ollama
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:27b

# App
APP_PORT=8000
HISTORY_DB_PATH=./data/history.db
OUTPUT_IMAGE_PATH=./data/images
```

---

## 9. CLAUDE.md 설계

### 9.1 설계 원칙

Anthropic 공식 문서 기반으로, Claude Code가 프로젝트를 정확히 이해하고 효율적으로 작업할 수 있는 구조로 작성한다.

핵심 원칙:
- **200줄 이내** 유지 (컨텍스트 효율)
- **구조화된 섹션** 사용 (파싱 최적화)
- **구체적 규칙** 명시 (모호한 표현 지양)
- **파일-역할 매핑** 포함 (수정 시 컨텍스트 최소화)

### 9.2 CLAUDE.md 초안

```markdown
# AI Image Studio

## Project
Local AI image generation WebUI.
Next.js 14 frontend + FastAPI backend + ComfyUI API + Ollama LLM.

## Architecture
- frontend/: Next.js 14, App Router, TypeScript, Tailwind CSS, Zustand
- backend/: FastAPI, Python 3.11+, httpx, aiosqlite
- External: ComfyUI Desktop (:8188), Ollama (:11434)
- ComfyUI: workflow JSON template → dynamic field injection → POST /prompt

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
- API response: { success: bool, data: T, error?: string }
- Imports: absolute paths, group by stdlib → external → internal

## Key Files
- backend/services/comfyui_client.py: ComfyUI API 통신 (수정 시 주의)
- backend/services/process_manager.py: ComfyUI 프로세스 라이프사이클
- backend/services/workflow_manager.py: JSON 템플릿 로드 + 필드 교체
- backend/workflows/*.json: ComfyUI API format (수동 생성, 코드로 수정 금지)
- frontend/styles/design-tokens.ts: 디자인 시스템 토큰 (변경 시 사용자 확인)

## Rules
- workflow JSON 템플릿은 코드로 직접 수정하지 말 것 (사용자에게 확인)
- ComfyUI/Ollama URL은 .env에서 config.py로 로드 (하드코딩 금지)
- 외부 API 호출(ComfyUI, Ollama)은 반드시 try/except + 타임아웃
- 새 의존성 추가 전 사용자에게 확인
- 디자인 토큰 변경 시 사용자 피드백 필수
- 에러 메시지는 한국어로 표시

## Testing
- Backend: pytest + httpx AsyncClient (E2E)
- Frontend: vitest + React Testing Library
- ComfyUI 관련: mock client로 테스트 (실제 ComfyUI 불필요)

## Git
- Branch: feature/{module}-{description}
- Commit: type(scope): description (Korean OK)
- PR: /ultraplan 리뷰 후 머지
```

### 9.3 공식 문서 기반 최적화 포인트

| 항목 | 적용 내용 |
|------|-----------|
| Commands 섹션 | Claude Code가 dev/lint/test 명령어를 즉시 실행 가능 |
| Key Files 섹션 | 수정 시 관련 파일을 미리 컨텍스트에 로드하도록 유도 |
| Rules 섹션 | 금지 사항을 명확히 하여 실수 방지 |
| 200줄 제한 | 컨텍스트 윈도우 효율, /compact 시 유지 |
| 서브 CLAUDE.md | frontend/CLAUDE.md, backend/CLAUDE.md로 모듈별 상세 규칙 분리 가능 |

---

## 10. 서브 에이전트 전략

### 10.1 설계 원칙

- **메인 에이전트**: 모듈 간 의존성이 있는 핵심 작업 (아키텍처, 서비스 연동, API 설계)
- **서브 에이전트**: 독립적으로 완결 가능한 작업 (개별 컴포넌트, 유틸리티, 테스트)
- 서브 에이전트는 **컨텍스트가 분리**되므로, 다른 모듈 상태에 의존하는 작업은 부적합

### 10.2 작업 분배

| 작업 | 담당 | 이유 |
|------|------|------|
| ComfyUI 클라이언트 + 워크플로우 매니저 | **메인** | 서로 강하게 결합, API 설계와 연관 |
| Process Manager | **메인** | FastAPI lifespan과 연동, 전체 흐름에 영향 |
| Ollama 클라이언트 + 프롬프트 엔진 | **메인** | 생성 API와 직접 연관 |
| 생성 API 라우터 | **메인** | 여러 서비스 조합 필요 |
| PromptInput 컴포넌트 | **서브** ✅ | 독립적 UI, props 인터페이스만 정의하면 됨 |
| ImageGrid 컴포넌트 | **서브** ✅ | 독립적 UI |
| LoraPanel 컴포넌트 | **서브** ✅ | 독립적 UI, 복잡도 높아 전담이 효율적 |
| SettingsPanel 컴포넌트 | **서브** ✅ | 독립적 UI |
| HistoryList + 히스토리 페이지 | **서브** ✅ | 독립적 페이지 |
| 디자인 시스템 (ui/ 컴포넌트) | **서브** ✅ | 공통 컴포넌트, 독립적 |
| StatusIndicator 컴포넌트 | **서브** ✅ | 간단한 상태 표시 |
| 테스트 코드 (모듈별) | **서브** ✅ | 각 모듈 테스트 독립적 작성 가능 |
| DB 스키마 + 마이그레이션 | **서브** ✅ | 스키마 정의 후 독립 작업 |

### 10.3 서브 에이전트 실행 가이드

서브 에이전트에게 작업을 위임할 때 제공해야 할 정보:

```
1. 구현할 컴포넌트/모듈 명
2. Props/인터페이스 정의 (TypeScript 타입)
3. 디자인 토큰 참조 (design-tokens.ts)
4. API 응답 스키마 (해당하는 경우)
5. 테스트 요구사항
```

### 10.4 작업 흐름

```
[/ultraplan으로 Phase 플래닝]
    │
    ▼
[메인 에이전트: 핵심 서비스 + API 구현]
    │
    ├── 서브 에이전트 A: PromptInput 컴포넌트
    ├── 서브 에이전트 B: ImageGrid 컴포넌트
    ├── 서브 에이전트 C: LoraPanel 컴포넌트
    └── 서브 에이전트 D: 테스트 코드
    │
    ▼
[메인 에이전트: 통합 + E2E 테스트]
```

---

## 11. 개발 로드맵

### Phase 0: 초기 세팅 (1일)

| Task | 세부 내용 | 담당 |
|------|-----------|------|
| /ultraplan 실행 | 프로젝트 구조 + CLAUDE.md + 보일러플레이트 | /ultraplan |
| 리뷰 및 수정 | 플랜 리뷰, 피드백 반영 | 사용자 |
| .env 설정 | ComfyUI 경로, Ollama 모델 등 로컬 환경 세팅 | 사용자 |
| ComfyUI 템플릿 준비 | txt2img_base.json API Format 저장 | 사용자 (ComfyUI에서) |
| 디자인 시스템 확정 | 컬러/타이포/컴포넌트 피드백 루프 | 사용자 + 서브 에이전트 |

### Phase 1: MVP - 기본 생성 (3일)

| Task | 세부 내용 | 담당 | 예상 시간 |
|------|-----------|------|-----------|
| Process Manager | ComfyUI 온디맨드 실행/종료 + health check | 메인 | 3h |
| ComfyUI 클라이언트 | comfyui_client.py + workflow_manager.py | 메인 | 4h |
| 생성 API | /api/generate + WebSocket 진행률 | 메인 | 3h |
| 기본 UI (PromptInput) | 프롬프트 입력 컴포넌트 | 서브 | 2h |
| 기본 UI (ImageGrid) | 이미지 결과 표시 | 서브 | 2h |
| StatusIndicator | 프로세스 상태 표시 | 서브 | 1h |
| 통합 테스트 | txt2img 전체 E2E 테스트 | 메인 | 2h |

> **Phase 1 완료 기준**: 프롬프트 입력 → ComfyUI 자동 시작 → 이미지 1장 생성 → 결과 표시 → 앱 종료 시 ComfyUI 종료

### Phase 2: AI + LoRA + 배치 (3일)

| Task | 세부 내용 | 담당 | 예상 시간 |
|------|-----------|------|-----------|
| Ollama 클라이언트 | ollama_client.py + prompt_engine.py | 메인 | 3h |
| 프롬프트 보강 API | /api/prompt/enhance | 메인 | 2h |
| 프롬프트 보강 UI | AI 보강 버튼 + 보강 결과 편집 | 서브 | 2h |
| LoRA 패널 | 다중 선택, 강도, 동적 워크플로우 조립 | 서브 | 4h |
| 모델 선택 UI | 체크포인트 + 샘플러 + VAE 드롭다운 | 서브 | 2h |
| 4장 배치 생성 | 시드 변경 4회 생성 + 그리드 뷰 | 메인 | 3h |

> **Phase 2 완료 기준**: 한국어 입력 → AI 보강 → LoRA 적용 → 4장 생성 → 그리드 비교

### Phase 3: 이미지 수정 + 히스토리 (4일)

| Task | 세부 내용 | 담당 | 예상 시간 |
|------|-----------|------|-----------|
| img2img | 참조 이미지 업로드 + denoise 조절 | 메인 | 4h |
| Inpainting | 캔버스 마스크 페인팅 UI + 부분 수정 | 메인 + 서브 | 6h |
| DB 스키마 | SQLite 테이블 + 마이그레이션 | 서브 | 2h |
| 히스토리 API | CRUD + 검색 + 필터링 | 메인 | 3h |
| 히스토리 UI | 이력 목록 + 재생성 기능 | 서브 | 3h |
| Upscale | 고해상도 확대 워크플로우 연동 | 메인 | 2h |

> **Phase 3 완료 기준**: img2img/inpaint 동작 + 전체 생성 이력 관리

---

## 12. 기술 스택 상세

| 구분 | 기술 | 버전 | 용도 |
|------|------|------|------|
| Frontend | Next.js | 14+ | App Router, SSR/CSR |
| Frontend | TypeScript | 5.x | 타입 안정성 |
| Frontend | Tailwind CSS | 3.x | 다크 테마 스타일링 |
| Frontend | Zustand | 4.x | 상태 관리 |
| Backend | FastAPI | 0.110+ | REST API + WebSocket |
| Backend | Python | 3.11+ | 백엔드 런타임 |
| Backend | httpx | 0.27+ | 비동기 HTTP 클라이언트 |
| Backend | aiosqlite | 0.20+ | 비동기 SQLite |
| Backend | websockets | 12+ | ComfyUI WS 연결 |
| AI | Ollama | latest | 로컬 LLM 서비스 |
| AI | Gemma 3/4 | 27B | 프롬프트 보강 |
| Image | ComfyUI Desktop | latest | 이미지 생성 엔진 |
| Image | SDXL / Flux.1 | - | 기본 체크포인트 모델 |
| Dev | Claude Code | v2.1.91+ | AI 에이전트 개발 + /ultraplan |
| Dev | ruff | latest | Python 린트/포맷 |
| Dev | vitest | latest | Frontend 테스트 |
| Dev | pytest | latest | Backend 테스트 |

---

## 13. 리스크 및 고려사항

| 리스크 | 영향도 | 대응 방안 |
|--------|--------|-----------|
| ComfyUI API 문서 부족 | 중 | 커뮤니티 예제 + 직접 테스트로 보완 |
| VRAM 부족 (16GB) | 중 | SDXL 기준 최적화, 배치 시 순차 처리, 유휴 시 ComfyUI 종료 |
| ComfyUI Desktop 실행 경로 | 중 | .env로 사용자별 경로 설정, 자동 탐색 로직 |
| ComfyUI 모델 로딩 대기 시간 | 중 | 워밍업 상태 UI 표시, health check 폴링 |
| Ollama 모델 바꾸면 품질 변동 | 낮 | 프롬프트 시스템 프롬프트로 품질 유지 |
| 워크플로우 JSON 호환성 | 중 | ComfyUI 버전 고정, 템플릿 버전 관리 |
| LoRA 호환성 문제 | 낮 | 모델-LoRA 호환성 뱃지 표시 기능 검토 |
| 서브 에이전트 컨텍스트 분리 | 중 | Props 인터페이스 사전 정의, 통합은 메인 에이전트 |
| /ultraplan 플래닝 시간 | 낮 | 터미널 다른 작업 병행 가능 |

---

## 14. 향후 확장 계획

| 우선순위 | 기능 | 설명 |
|----------|------|------|
| 1 | Telegram / KakaoTalk Bot | 메신저로 이미지 생성 요청 |
| 2 | ControlNet 지원 | 포즈/엣지/디프스 제어 |
| 3 | Video Generation | LTX-Video 모델 연동 (기존 ComfyUI 설정 활용) |
| 4 | 프롬프트 템플릿 마켓 | 커뮤니티 프롬프트 공유 |
| 5 | 다언어 지원 | 일본어, 중국어 프롬프트 지원 |
| 6 | 클라우드 배포 | 외부 접속 지원 (Tailscale/Cloudflare Tunnel) |
| 7 | Gallery 모드 | 생성 이미지 갤러리 뷰 + 태그 분류 |
| 8 | 스케줄러 | 대량 배치 예약 생성 (야간 자동 실행) |

---

> **AI Image Studio Project Plan v1.1**
> *Prepared for Claude Code Development with /ultraplan*
> *UNITECH Co., Ltd. / Park Jung-Wan / 2026.04.11*
