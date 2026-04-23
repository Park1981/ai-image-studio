# LTX Video 2.3 i2v 영상 생성 — 설계 (Spec)

**작성일**: 2026-04-24
**상태**: 기획 완료 · 구현 예정
**작성자**: Opus 4.7 (사용자 공동 기획)
**대상 워크플로우**: `workflow_templates/templates/video_ltx2_3_i2v.json`
  (Comfy-Org 공식 · LTX-2.3 Day-0 지원)

## 1. 배경 & 목적

사용자는 AI Image Studio 에 **영상 생성** 모드를 추가하고 싶다. LTX-2.3 (Lightricks 22B 오디오+영상 통합 모델) 가 2026-03-05 공식 출시되어 ComfyUI 공식 템플릿으로 제공된다. 사용자는 이미 ComfyUI 에서 해당 워크플로우 실구동을 검증했고, 모든 모델/LoRA 파일이 설치돼 있다.

### 유스케이스
- 이미지 한 장 업로드 → 자연어 지시 → **약 4초 오디오+영상 MP4** 생성
- 기존 Generate/Edit 과 동일 UX 패턴 (좌측 입력 · 우측 결과) 로 학습 부담 없음

### 비목표 (YAGNI)
- t2v (텍스트만으로 영상) — 워크플로우 미제공. 추후 확장
- 프레임/해상도 사용자 조절 — JSON 상수 고정 (97f @ 24fps, 긴 변 1536)
- 배치 생성 (여러 영상 동시)
- 실시간 프리뷰

## 2. 결정 사항 요약

| 항목 | 결정 |
|------|------|
| 범위 | i2v 전용 · 이미지 업로드 필수 |
| 프레임/FPS | 97f @ 24fps ≈ 4초 (워크플로우 상수, presets.py 에 정의) |
| 해상도 | 업로드 이미지 비율 유지 · `ResizeImagesByLongerEdge 1536` |
| 프롬프트 | gemma4 업그레이드 (Generate/Edit 과 일관) |
| 비전 체이닝 | qwen2.5vl → gemma4 → LTX (Edit 모드와 동일 2-call) |
| 출력 | MP4 (H.264 + AAC 오디오, CreateVideo 24fps) |
| 빌더 방식 | Python (Qwen Gen/Edit 과 동일) |
| 구현 난이도 | Edit 모드 수준 (사용자 요구) |

## 3. 아키텍처

```
┌──────────── Frontend ────────────┐      ┌─────────── Backend ────────────┐
│  app/video/page.tsx (stub→실구현)│      │  studio/router.py              │
│   ├ SourceImageCard (재활용)     │──▶   │   POST /api/studio/video      │
│   ├ [영상 생성] sticky CTA       │      │   GET  /api/studio/video/     │
│   └ VideoPlayerCard (신규)       │      │        stream/{task_id} (SSE) │
│                                  │      │                                │
│  stores/useVideoStore.ts (신규)  │      │  studio/presets.py             │
│  hooks/useVideoPipeline (신규)   │      │   └ VIDEO_MODEL (신규)         │
│  components/studio/              │      │                                │
│    VideoPlayerCard (신규)        │      │  studio/comfy_api_builder.py   │
│                                  │      │   └ build_video_from_request   │
│  lib/api/video.ts (신규)         │      │     (47 노드 Python 조립)      │
│  lib/api/types.ts 확장           │      │                                │
│    + VideoRequest, VideoStage    │      │  studio/video_pipeline.py (신) │
│    + mode 에 "video" 추가         │      │   └ run_video_pipeline         │
│                                  │      │                                │
└──────────────────────────────────┘      │  studio/prompt_pipeline.py     │
                                          │   └ upgrade_video_prompt (신)  │
                                          │     + SYSTEM_VIDEO 상수        │
                                          │                                │
                                          │  studio/comfy_transport.py     │
                                          │   └ download_file() 일반화     │
                                          │                                │
                                          │  studio/history_db.py          │
                                          │   └ mode='video' 허용 확장     │
                                          └────────────────────────────────┘
```

### 3.1 재사용 자산 (건드리지 않음)
- `SourceImageCard`, `VramBadge`, `Chrome/{Logo,TopBar,BackBtn,ModelBadge}`, `ProgressModal`
- `useSettingsStore` (`visionModel`, `ollamaModel`)
- `useProcessStore` (ollama/comfyui 상태)
- `_dispatch_to_comfy` (router.py 공용 헬퍼)
- `_build_loaders`, `_build_lora_chain`, `_apply_model_sampling` (comfy_api_builder 헬퍼)
- `vision_pipeline._describe_image`, `prompt_pipeline.translate_to_korean`
- `StaticFiles` mount `/images/*` (mp4 도 같은 폴더 저장해서 그대로 서빙)

### 3.2 신규 자산
- **백엔드**: `VIDEO_MODEL` preset · `build_video_from_request` · `run_video_pipeline` · `upgrade_video_prompt` · `/api/studio/video` 2 라우트
- **프론트엔드**: `useVideoStore` · `useVideoPipeline` · `VideoPlayerCard` · `app/video/page.tsx` 실구현

## 4. 백엔드 설계

### 4.1 `studio/presets.py` 확장

```python
@dataclass(frozen=True)
class VideoFiles:
    unet: str           # "ltx-2.3-22b-dev-fp8.safetensors" (체크포인트+VAE 통합)
    unet_dtype: str     # "default"
    text_encoder: str   # "gemma_3_12B_it_fp4_mixed.safetensors"
    upscaler: str       # "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"

@dataclass(frozen=True)
class VideoSampling:
    frame_count: int = 97
    fps: int = 24
    resize_longer_edge: int = 1536
    base_sampler: str = "euler_cfg_pp"
    upscale_sampler: str = "euler_ancestral_cfg_pp"
    base_sigmas: str = "0.85, 0.7250, 0.4219, 0.0"
    upscale_sigmas: str = "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0"
    cfg: float = 1.0
    preprocess_seed: int = 18  # LTXVPreprocess 고정값
    crop_ratio: float = 0.7    # LTXVImgToVideoInplace 두 번째 호출 파라미터

@dataclass(frozen=True)
class VideoModelPreset:
    display_name: str  # "LTX Video 2.3"
    tag: str           # "22B · A/V"
    files: VideoFiles
    loras: list[LoraEntry]
    sampling: VideoSampling
    negative_prompt: str

VIDEO_MODEL = VideoModelPreset(
    display_name="LTX Video 2.3",
    tag="22B · A/V",
    files=VideoFiles(
        unet="ltx-2.3-22b-dev-fp8.safetensors",
        unet_dtype="default",
        text_encoder="gemma_3_12B_it_fp4_mixed.safetensors",
        upscaler="ltx-2.3-spatial-upscaler-x2-1.1.safetensors",
    ),
    loras=[
        LoraEntry(
            name="ltx-2.3-22b-distilled-lora-384.safetensors",
            strength=0.5, role="distilled",
        ),
        LoraEntry(
            name="ltx-2.3-22b-distilled-lora-384.safetensors",
            strength=0.5, role="distilled_upscale",
        ),
        LoraEntry(
            name="ltx2310eros_beta.safetensors",
            strength=0.5, role="extra",
        ),
    ],
    sampling=VideoSampling(),
    negative_prompt="pc game, console game, video game, cartoon, childish, ugly",
)
```

**VRAM 16GB 대응 — env override**:
```python
# settings 에 선택적 오버라이드 필드 추가 (backend/config.py)
ltx_unet_name: str | None = None  # .env 로 Kijai transformer_only 등으로 교체 가능
```
VIDEO_MODEL.files.unet 을 runtime 에 이 값으로 치환 (None 이면 기본 사용).

### 4.2 `studio/comfy_api_builder.py` 확장

```python
def build_video_from_request(
    *,
    prompt: str,
    source_filename: str,     # ComfyUI input/ 에 업로드된 파일명
    seed: int,
    negative_prompt: str | None = None,
) -> ApiPrompt:
    """LTX-2.3 i2v 워크플로우 47노드 → Python 조립.

    파이프라인:
      LoadImage → ResizeImagesByLongerEdge(1536)
         ├─ LTXVImgToVideoInplace(1, False)    # base stage
         ├─ LTXVImgToVideoInplace(0.7, False)  # upscale stage
      CheckpointLoaderSimple(ltx-2.3-22b-dev-fp8)
      LTXAVTextEncoderLoader(Gemma 3 12B)
      LTXVAudioVAELoader(same)
      LatentUpscaleModelLoader(spatial-upscaler-x2-1.1)

      LoraLoaderModelOnly × 3:
        · distilled-384 @ 0.5 (base)
        · distilled-384 @ 0.5 (upscale)
        · ltx2310eros_beta @ 0.5 (extra)

      CLIPTextEncode × 2:
        positive ← user prompt (gemma4 업그레이드 결과)
        negative ← VIDEO_MODEL.negative_prompt

      LTXVPreprocess(seed=18) → LTXVImgToVideoInplace
      LTXVConditioning (LTX 프롬프트 변환)

      # Stage 1: base sampling
      EmptyLTXVLatentVideo(768, 512, 97, 1)
      LTXVEmptyLatentAudio → LTXVConcatAVLatent(AV)
      CFGGuider(cfg=1) + ManualSigmas(base_sigmas) + KSamplerSelect(euler_cfg_pp)
      SamplerCustomAdvanced → base latent AV

      # Stage 2: upscale
      LTXVLatentUpsampler(base_latent)
      ManualSigmas(upscale_sigmas) + KSamplerSelect(euler_ancestral_cfg_pp)
      SamplerCustomAdvanced → upscale latent AV
      LTXVCropGuides (crop_ratio=0.7) · 가이드 정리

      # Decode
      LTXVSeparateAVLatent → (video_latent, audio_latent)
      VAEDecodeTiled(768, 64, 4096, 4) → video frames
      LTXVAudioVAEDecode → audio waveform

      # Compose
      CreateVideo(fps=24) → SaveVideo (MP4)
    """
    ...
```

**구현 원칙**:
- 기존 `_build_loaders`/`_build_lora_chain`/`_apply_model_sampling`/`_make_id_gen` 재사용
- LTX-2.3 전용 헬퍼 `_build_ltx_av_stack` 추가 (base+upscale 2-stage sampling 묶음) — 가독성
- ComfyUI `/prompt` API 포맷 그대로 반환 (flat dict)

### 4.3 `studio/prompt_pipeline.py` 확장

```python
SYSTEM_VIDEO = """You are a cinematic prompt engineer for LTX-2.3 video
generation.

Input:
  [Image description] a vision-model description of the source frame.
  [User direction]    the user's ask in natural language (may be Korean).

Output a single polished English paragraph (60-150 words) that guides
the video generation: subject motion, camera work (pan/zoom/dolly),
pacing, ambient sound/audio cues, light changes, mood.

Keep the first-frame identity matching the image. Avoid cartoon/game
aesthetics. No bullets, no markdown, no preamble."""

async def upgrade_video_prompt(
    user_direction: str,
    image_description: str,
    model: str = "gemma4-un:latest",
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    include_translation: bool = True,
) -> UpgradeResult:
    """Edit 의 upgrade_edit_prompt 와 같은 구조.
    1) SYSTEM_VIDEO 로 gemma4 호출 → en
    2) translate_to_korean(en) → ko (선택적)
    3) 실패 시 fallback=True, user_direction 그대로 반환
    """
```

### 4.4 `studio/video_pipeline.py` 신규

```python
@dataclass
class VideoPipelineResult:
    image_description: str     # vision 결과 (step 1)
    final_prompt: str          # LTX 용 영문 (step 2)
    vision_ok: bool
    upgrade: UpgradeResult

async def run_video_pipeline(
    image_bytes: bytes,
    user_prompt: str,
    *,
    vision_model: str | None = None,
    text_model: str | None = None,
    ollama_url: str | None = None,
) -> VideoPipelineResult:
    """Edit 의 run_vision_pipeline 과 동일 구조 — upgrade 만 video 용."""
    description = await _describe_image(image_bytes, vision_model=...)
    upgrade = await upgrade_video_prompt(user_prompt, description, ...)
    return VideoPipelineResult(...)
```

### 4.5 `studio/router.py` 확장

```python
class VideoMeta(BaseModel):
    prompt: str = Field(..., min_length=1)
    ollama_model: str | None = Field(default=None, alias="ollamaModel")
    vision_model: str | None = Field(default=None, alias="visionModel")
    model_config = ConfigDict(populate_by_name=True)


_VIDEO_MAX_IMAGE_BYTES = 20 * 1024 * 1024


@router.post("/video", response_model=TaskCreated)
async def create_video_task(
    image: UploadFile = File(...),
    meta: str = Form(...),
):
    meta_obj = json.loads(meta)
    prompt = meta_obj.get("prompt", "").strip()
    if not prompt:
        raise HTTPException(400, "prompt required")
    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(400, "empty image")
    if len(image_bytes) > _VIDEO_MAX_IMAGE_BYTES:
        raise HTTPException(413, "image too large (max 20MB)")

    task = await _new_task()
    task.worker = _spawn(
        _run_video_pipeline_task(
            task, image_bytes, prompt,
            image.filename or "input.png",
            meta_obj.get("ollamaModel"),
            meta_obj.get("visionModel"),
        )
    )
    return TaskCreated(
        task_id=task.task_id,
        stream_url=f"/api/studio/video/stream/{task.task_id}",
    )


@router.get("/video/stream/{task_id}")
async def video_stream(task_id: str, request: Request):
    # Edit stream 과 100% 동일 패턴
    ...


async def _run_video_pipeline_task(
    task: Task,
    image_bytes: bytes,
    prompt: str,
    filename: str,
    ollama_override: str | None,
    vision_override: str | None,
):
    """5 step 파이프라인:
      step 1: vision-analyze      (0→20%)
      step 2: prompt-merge        (20→30%)
      step 3: workflow-dispatch   (30→35%)
      step 4: comfyui-sampling    (35→92%)  ← 2-stage 내부 통합 progress
      step 5: save-output         (92→98%)
    """
    # vision 파이프라인 (Edit 과 동일 구조)
    vision = await run_video_pipeline(image_bytes, prompt, ...)

    # _dispatch_to_comfy 재활용 — Edit 와 동일한 factory 패턴
    def _make_video_prompt(uploaded_name: str | None) -> dict[str, Any]:
        if uploaded_name is None:
            raise RuntimeError("Video pipeline requires uploaded image")
        return build_video_from_request(
            prompt=vision.final_prompt,
            source_filename=uploaded_name,
            seed=int(time.time() * 1000),
        )

    dispatch = await _dispatch_to_comfy(
        task, _make_video_prompt,
        progress_start=35, progress_span=57,
        client_prefix="ais-v",
        upload_bytes=image_bytes,
        upload_filename=filename,
    )
    ...
```

### 4.6 `studio/comfy_transport.py` 확장

```python
async def download_file(
    self,
    filename: str,
    subfolder: str = "",
    file_type: str = "output",
) -> bytes:
    """GET /view 일반화 — 기존 download_image 를 감싸는 alias."""
```

그리고 `extract_output_images()` 와 평행하게 `extract_output_files(history_entry, class_filter="SaveVideo")` 추가 — history JSON 에서 SaveVideo 노드의 출력 파일 목록 반환.

### 4.7 `studio/history_db.py` 확장

- CHECK constraint `mode IN ('generate', 'edit')` → `('generate', 'edit', 'video')`
- 기존 DB 마이그레이션: SQLite CHECK 변경은 까다로워서 **"CHECK 제거"** 방향 — 런타임 validation 으로 전환
- 신규 필드는 추가하지 않음. `imageRef` 가 mp4 URL 이면 video 로 간주

**마이그레이션**:
```sql
-- 무통증 경로: CHECK 제거한 새 테이블로 copy
PRAGMA foreign_keys=off;
BEGIN;
CREATE TABLE studio_history_new (id TEXT PRIMARY KEY, mode TEXT NOT NULL, ...);
INSERT INTO studio_history_new SELECT * FROM studio_history;
DROP TABLE studio_history;
ALTER TABLE studio_history_new RENAME TO studio_history;
COMMIT;
PRAGMA foreign_keys=on;
```

런타임에 `init_studio_history_db()` 에서 idempotent 체크 (PRAGMA table_info 로 기존 CHECK 확인 후 마이그레이션).

### 4.8 저장 경로

- `/data/images/studio/xxx.mp4` — 기존 이미지와 같은 폴더 (확장자로 구분)
- StaticFiles mount 는 그대로. Content-Type 은 FastAPI/Starlette 가 자동 판정 (mp4 → video/mp4)

## 5. 프론트엔드 설계

### 5.1 `lib/api/types.ts` 확장

```typescript
// mode 타입에 "video" 추가
export interface HistoryItem {
  mode: "generate" | "edit" | "video";
  // ... 기존 필드 모두 유지
  // video 는 특별한 필드 추가 없음 — imageRef 가 mp4 URL
  /** 영상 길이 (초). video 모드만. */
  durationSec?: number;
  /** fps. video 모드만. */
  fps?: number;
  /** 프레임 수. video 모드만. */
  frameCount?: number;
}

export interface VideoRequest {
  sourceImage: string | File;
  prompt: string;
  ollamaModel?: string;
  visionModel?: string;
}

export type VideoStage =
  | { type: "step"; step: 1 | 2 | 3 | 4 | 5; done: boolean;
      description?: string; finalPrompt?: string;
      finalPromptKo?: string | null; provider?: string; }
  | { type: "sampling"; progress: number;
      samplingStep?: number | null; samplingTotal?: number | null; }
  | { type: "stage"; stageType: string; progress: number;
      stageLabel: string; samplingStep?: number; samplingTotal?: number; }
  | { type: "done"; item: HistoryItem; savedToHistory: boolean };
```

### 5.2 `lib/api/video.ts` 신규

```typescript
export async function* videoImageStream(
  req: VideoRequest,
): AsyncGenerator<VideoStage, void, unknown> {
  if (USE_MOCK) yield* mockVideoStream(req);
  else yield* realVideoStream(req);
}
```

- Real: Edit 과 동일 패턴 (multipart upload + SSE)
- Mock: 5 step 시뮬레이션 + 가짜 mp4 URL (public 샘플 또는 mock-seed)

### 5.3 `stores/useVideoStore.ts` 신규

Edit 스토어와 거의 동일 구조:
```typescript
interface VideoState {
  sourceImage: string | null;
  sourceLabel: string;
  sourceWidth: number | null;
  sourceHeight: number | null;
  prompt: string;
  running: boolean;
  currentStep: 1 | 2 | 3 | 4 | 5 | null;
  stepDone: number;
  stepHistory: VideoStepDetail[];
  startedAt: number | null;
  samplingStep: number | null;
  samplingTotal: number | null;
  pipelineProgress: number;
  pipelineLabel: string;
  lastVideoRef: string | null;  // 완료된 mp4 URL (세션)
  // actions ...
}
```

세션 한정 — persist 안 함 (영상 파일 크고 히스토리는 서버 DB 가 담당).

### 5.4 `hooks/useVideoPipeline.ts` 신규

```typescript
export function useVideoPipeline({ onComplete }: {
  onComplete: (videoRef: string) => void;
}): { generate: () => Promise<void> };
```

Edit 훅과 거의 동일. `addItem(evt.item)` 으로 히스토리 저장, `setLastVideoRef(evt.item.imageRef)`.

### 5.5 `components/studio/VideoPlayerCard.tsx` 신규

```typescript
interface Props {
  src: string | null;       // mp4 URL
  running: boolean;
  progress?: number;
  label?: string;
}
```

- `<video controls autoPlay={false} loop>` — 컨트롤 + 루프
- Empty state: "분석/생성 후 재생됩니다"
- Loading: Spinner + stageLabel + progress %
- 하단: [저장] [복사-URL] [크게 보기] (크게 보기는 라이트박스 확장 버전 — 미구현, 버튼만)

### 5.6 `app/video/page.tsx` 실구현 (기존 stub 대체)

Edit 페이지 레이아웃 재활용 (좌 400px / 우 1fr):

**좌 패널**:
- TopBar (BackBtn, Logo, ModelBadge="LTX Video 2.3 · AV")
- `<SourceImageCard>` (재활용)
- 프롬프트 textarea (auto-grow, Edit 와 동일)
- 안내 배너 ("약 4초 MP4 · 평균 소요 5~20분 · 로컬 처리")
- Sticky [영상 생성] CTA

**우 패널**:
- `<VideoPlayerCard src={lastVideoRef} running={running} ...>`
- 파이프라인 단계 표시 (5 step 초록 박스 — `PipelineSteps` 재활용, PIPELINE_META 만 video 용으로)
- 수정 히스토리 갤러리 (mode="video" 필터) — HistoryTile 재활용, 썸네일은 임시로 ImageTile 자리에 `<video poster>` 또는 첫 프레임

**임시 간단화**: 라이트박스는 이번 범위 밖. 히스토리 썸네일도 Poster 없이 seed 기반 이미지타일 + 파일명만.

## 6. 데이터 플로우

```
[1] 업로드: SourceImageCard → useVideoStore.setSource(dataUrl, label, w, h)

[2] [영상 생성] → useVideoPipeline.generate()
    └ 조건: sourceImage 있음, prompt trim > 0, Ollama running (경고만)

[3] videoImageStream POST → /api/studio/video (multipart)
    응답 { task_id, stream_url }

[4] SSE GET /api/studio/video/stream/{id}
    event: step { step:1, done:false }     ← vision 시작
    event: step { step:1, done:true, description:"..." }
    event: step { step:2, done:false }     ← prompt merge
    event: step { step:2, done:true, finalPrompt:"...", finalPromptKo:"..." }
    event: step { step:3, done:false/true } ← workflow dispatch
    event: step { step:4, done:false }     ← sampling 시작
    event: stage { progress:35..92, samplingStep, samplingTotal } (실시간)
    event: step { step:4, done:true }
    event: step { step:5, done:true }      ← save output
    event: done { item, savedToHistory }

[5] done 수신:
    addItem(item)                           ← useHistoryStore
    setLastVideoRef(item.imageRef)          ← useVideoStore
    toast.success("영상 생성 완료", label)
    if fallback: toast.warn

[6] 재생: VideoPlayerCard 에 lastVideoRef → <video src>
```

## 7. 에러 처리

| 시나리오 | 감지 | 동작 |
|----------|------|------|
| 이미지 파일 아님 | SourceImageCard.handleFiles | toast.error, 업로드 거부 |
| 20MB 초과 | 백엔드 /video | HTTP 413 → 프론트 토스트 |
| Ollama 정지 | useVideoPipeline 시작 시 | 경고 토스트, 계속 진행 |
| Vision 호출 실패 | run_vision_pipeline | description="" 로 gemma4 진행 |
| gemma4 실패 | upgrade_video_prompt | fallback=True, 원본 프롬프트로 LTX 전달, 프론트 토스트 warn |
| ComfyUI /prompt 실패 | _dispatch_to_comfy | comfy_error 반환, mock-seed imageRef (COMFY_MOCK_FALLBACK) + 토스트 error |
| VRAM OOM | ComfyUI WS execution_error | comfy_error 로 전달, 프론트 "OOM — .env 의 LTX_UNET_NAME 으로 Kijai variant 시도" 안내 |
| WS idle 15분 / hard 1시간 | comfy_transport.listen 타임아웃 | TimeoutError → comfy_error |
| 사용자 interrupt | 기존 /interrupt 엔드포인트 | ComfyUI 전역 중단 · task.cancel 전파 |
| history_db insert 실패 | _persist_history | done 이벤트에 savedToHistory:false, 프론트 토스트 |

**WS 타임아웃 조정**: Edit 의 idle=600s / hard=1800s 는 LTX 에 부족. Video 전용 호출 시 **idle=900s, hard=3600s** 로 확장 (`ComfyUITransport.listen(...)` 파라미터 주입).

## 8. VRAM 16GB 대응 전략

| 레이어 | 대응 |
|--------|------|
| ComfyUI 자체 | Sysmem Fallback (NVIDIA 제어판에서 활성화 — 사용자 수동) |
| 모델 파일명 | `.env` 의 `LTX_UNET_NAME` 으로 override 가능 (기본은 공식 fp8 29GB) |
| 대안 체크포인트 | Kijai `transformer_only_fp8_scaled` (22GB) 또는 GGUF Q4_K_S |
| 사용자 안내 | UI 에 "초회 실행 시 OOM 가능, Sysmem Fallback 활성화 권장" 문구 |
| 예상 시간 | 정상: 5~10분 / Sysmem offload: 15~30분 |

**README 또는 인라인 힌트**에 명시 — 이번 spec 구현 시점엔 UI 간단 안내만 추가.

## 9. 테스트 전략

### 9.1 Backend unit (`backend/tests/studio/test_video_pipeline.py` 신규)
- `SYSTEM_VIDEO` 상수 — 60-150 단어 가이드 포함
- `VIDEO_MODEL` preset 필드 검증 (파일명, LoRA 목록, sampling 값)
- `upgrade_video_prompt` — fallback 경로 (gemma4 실패 시 원본 보존)
- `run_video_pipeline` — vision 실패 → description="" 로 gemma4 진행

### 9.2 Backend builder (`backend/tests/studio/test_video_builder.py` 신규)
- `build_video_from_request` 스모크:
  - 반환 dict 의 노드 수 = 47 (또는 해당 값)
  - 필수 class_type 포함 (CheckpointLoaderSimple, LTXAVTextEncoderLoader, SaveVideo, CreateVideo)
  - LoRA 체인 노드 수 = 3 (distilled 2 + extra 1)
  - positive/negative CLIPTextEncode 연결 점검

### 9.3 Backend integration (기존 test_vision_analyzer.py 패턴)
- `POST /api/studio/video` multipart + meta
- Mock via `studio.vision_pipeline._describe_image` patch + `ComfyUITransport` mock

### 9.4 Frontend
- `tsc --noEmit` · `npm run build`
- 수동 Mock 모드 검증 (USE_MOCK=true) — 브라우저에서 비디오 플레이어 렌더 확인

### 9.5 실 런타임
- 사용자가 브라우저에서 end-to-end
- ComfyUI 연결 전제
- 첫 실행 시 VRAM 확인 (오빠가 수동 검증)

## 10. 구현 순서 (커밋 단위)

1. **V1. Spec 문서** (이 문서) 커밋
2. **V2. 백엔드 preset + 빌더** — presets.py::VIDEO_MODEL + comfy_api_builder.py::build_video_from_request + test_video_builder.py
3. **V3. 백엔드 파이프라인** — prompt_pipeline.py::upgrade_video_prompt + video_pipeline.py + history_db.py 마이그레이션 + test_video_pipeline.py
4. **V4. 백엔드 라우트** — router.py::/video + /video/stream + comfy_transport 확장 + /env override 연결
5. **V5. 프론트 타입/API/스토어** — types.ts + lib/api/video.ts + useVideoStore.ts
6. **V6. 프론트 훅/컴포넌트** — useVideoPipeline.ts + VideoPlayerCard.tsx
7. **V7. 프론트 페이지** — app/video/page.tsx 실구현 + 메인 메뉴 disabled 해제
8. **V8. 검증 + master 머지** — pytest + tsc + build + 실 구동 체크리스트

## 11. 향후 확장 여지 (이번 범위 밖)

- t2v (텍스트만 영상) — `build_video_from_request` 에 `source_filename=None` 분기 + 별도 워크플로우 (LoadImage 없는 변종)
- Vision 페이지에도 영상 미리보기 (이 spec 과 무관)
- 프레임/해상도 사용자 조절 UI (고급 아코디언)
- 배치 생성 (프롬프트 여러 개)
- 썸네일/포스터 프레임 추출 (ffmpeg) — 히스토리 썸네일 개선
- 영상 전용 라이트박스 (ImageLightbox 확장)
- LoRA 강도 토글 (현재 0.5 고정)
