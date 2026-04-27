# Setup Guide — AI Image Studio

> 새 컴퓨터에서 처음 setup 하는 사람용 단계별 가이드.
> 2026-04-27 (C2-P2-4) 작성.

## 1. 사전 요구사항

| 항목 | 버전 / 사양 | 비고 |
|------|-------------|------|
| OS | Windows 11 | macOS/Linux 미지원 (CUDA + ComfyUI Desktop) |
| GPU | NVIDIA RTX 16GB+ VRAM | RTX 4070 Ti SUPER 권장 |
| Python | 3.13.x | venv 사용 — 시스템 Python 안 건드림 |
| Node.js | 20+ | nvm-windows 권장 |
| ComfyUI Desktop | 최신 | https://www.comfy.org/download |
| Ollama | 최신 | https://ollama.com — `gemma4-un` + `qwen2.5vl:7b` 모델 pull 필요 |

## 2. 설치 단계

### 2.1 저장소 clone

```powershell
cd D:\
git clone https://github.com/Park1981/ai-image-studio.git AI-Image-Studio
cd AI-Image-Studio
```

### 2.2 Python venv + 의존성

```powershell
# venv 생성
python -m venv .venv

# 활성화 (PowerShell)
.\.venv\Scripts\Activate.ps1

# 의존성 설치
pip install -r backend\requirements.txt
```

### 2.3 Frontend 의존성

```powershell
cd frontend
npm ci   # lockfile 기반 정확 설치 (재현 가능 빌드)
cd ..
```

### 2.4 Ollama 모델 준비

```powershell
ollama pull gemma4-un
ollama pull qwen2.5vl:7b
```

### 2.5 .env 작성

```powershell
copy .env.example .env
# 편집기로 .env 열어 ⚠️ 표시 항목 수정 (특히 ComfyUI 경로 4개)
```

자세한 키 설명은 `.env.example` 의 한국어 코멘트 참조.

### 2.6 ComfyUI 모델 다운로드

`docs/refactor-review-2026-04-27.md` 의 Model System 섹션 참조 + ComfyUI Manager 로 추가 설치.

| 용도 | 파일명 | 폴더 |
|------|--------|------|
| 생성 | `qwen_image_2512_fp8_e4m3fn.safetensors` | `diffusion_models/` |
| 수정 | `qwen_image_edit_2511_bf16.safetensors` | `diffusion_models/` |
| 영상 | `ltx-2.3-22b-dev-fp8.safetensors` | `diffusion_models/` |
| CLIP | `qwen_2.5_vl_7b_fp8_scaled.safetensors` | `text_encoders/` |
| VAE | `qwen_image_vae.safetensors` | `vae/` |
| Lightning LoRA (생성) | `Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors` | `loras/` |
| Lightning LoRA (수정) | `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` | `loras/` |
| Extra LoRA (생성) | `female-body-beauty_qwen.safetensors` | `loras/` |

## 3. 실행

### 3.1 한 번에 (권장)

```powershell
.\start.bat
```

콘솔 1개 보이고 backend/frontend/ComfyUI/Ollama 모두 hidden 으로 시작.
로그는 `logs/{backend,frontend,comfyui}.log` 확인.

### 3.2 개별 실행 (디버깅 시)

```powershell
# Backend (Terminal 1)
cd backend
..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --no-access-log

# Frontend (Terminal 2)
cd frontend
$env:NEXT_PUBLIC_USE_MOCK="false"
$env:NEXT_PUBLIC_STUDIO_API="http://localhost:8001"
npm run dev
```

### 3.3 종료

```powershell
.\stop.ps1
```

## 4. 확인

브라우저에서 http://localhost:3000 열기.

| 체크 | 정상 |
|------|------|
| 헤더 우측 자원 미터 (CPU/GPU/VRAM/RAM) | 막대 4개 표시 |
| 메인 페이지 6개 카드 (Image 2 + Vision 2 + Video 2) | 동일 인물 시리즈 |
| `/generate` 진입 | 좌패널 input + 우패널 결과 빈 상태 |
| `/edit` 이미지 업로드 + 수정 지시 → 실행 | 5단계 timeline 진행 |

문제 발생 시:

- ComfyUI 안 뜸 → `logs/comfyui.err.log` 확인 + `.env` 의 4 키 경로 검증
- "Ollama 정지" 토스트 → `ollama list` 로 모델 확인 + `OLLAMA_EXECUTABLE` 설정
- 헤더 VRAM 0G → `nvidia-smi` 명령 가능한지 확인 (드라이버 버전)

## 5. 개발 명령

```powershell
# Backend 검증
cd backend
..\.venv\Scripts\python.exe -m ruff check .
..\.venv\Scripts\python.exe -m pytest tests/

# Frontend 검증
cd frontend
npx tsc --noEmit
npm run lint
npm test -- --run
npm run build
```

`.github/workflows/quality-gate.yml` 가 master push 마다 동일 검증을 자동 실행.

## 6. 추가 참고

- `CLAUDE.md` — 프로젝트 규칙 + 현재 상태 + 모델 시스템
- `docs/refactor-review-2026-04-27.md` — 최근 리팩토링 인벤토리
- `docs/qa-checklist.md` — Zero Script QA 5 시나리오
- `docs/design-system.md` — 디자인 토큰 + 공용 컴포넌트 (작성 중)
