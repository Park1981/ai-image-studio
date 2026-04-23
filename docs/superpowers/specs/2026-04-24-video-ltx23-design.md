# LTX Video 2.3 i2v 영상 생성 — 설계 (Spec)

**작성일**: 2026-04-24
**상태**: 기획 완료 · 구현 예정
**작성자**: Opus 4.7 (사용자 공동 기획)
**대상 워크플로우**: `workflow_templates/templates/video_ltx2_3_i2v.json`
  (Comfy-Org 공식 · LTX-2.3 Day-0 지원)

## 1. 배경 & 목적

사용자는 AI Image Studio 에 **영상 생성** 모드를 추가하고 싶다. LTX-2.3 (Lightricks 22B 오디오+영상 통합 모델) 가 2026-03-05 공식 출시되어 ComfyUI 공식 템플릿으로 제공된다. 사용자는 이미 ComfyUI 에서 해당 워크플로우 실구동을 검증했고, 모든 모델/LoRA 파일이 설치돼 있다.

### 유스케이스
- 이미지 한 장 업로드 → 자연어 지시 → **약 5초 오디오+영상 MP4** 생성
- 기존 Generate/Edit 과 동일 UX 패턴 (좌측 입력 · 우측 결과) 로 학습 부담 없음

### 비목표 (YAGNI)
- t2v (텍스트만으로 영상) — 워크플로우 미제공. 추후 확장
- 프레임/해상도 사용자 조절 — JSON 상수 고정 (126f @ 25fps, 긴 변 1536)
- 배치 생성 (여러 영상 동시)
- 실시간 프리뷰

## 2. 결정 사항 요약

| 항목 | 결정 |
|------|------|
| 범위 | i2v 전용 · 이미지 업로드 필수 |
| 프레임/FPS | 126f @ 25fps ≈ 4초 (워크플로우 상수, presets.py 에 정의) |
| 해상도 | 업로드 이미지 비율 유지 · `ResizeImagesByLongerEdge 1536` |
| 프롬프트 | gemma4 업그레이드 (Generate/Edit 과 일관) |
| 비전 체이닝 | qwen2.5vl → gemma4 → LTX (Edit 모드와 동일 2-call) |
| 출력 | MP4 (H.264 + AAC 오디오, CreateVideo 24fps) |
| 빌더 방식 | Python (Qwen Gen/Edit 과 동일) |
| UX 난이도 | Edit 모드 수준 (사용자 요구) |
| **구현 복잡도** | **Edit 보다 한 단계 위** — 아래 섹션 12 참고 |

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

#### 4.4b `_dispatch_to_comfy` 확장 — save_output 콜백 주입

현재 `_dispatch_to_comfy` 의 마지막 단계는 `_save_comfy_output(comfy, prompt_id)` 호출로 **이미지 PNG 저장 전용**. Video 파이프라인은 MP4 저장 경로가 달라 그대로 못 쓴다.

**선택**: 공통 함수는 유지하고 **`save_output` 콜백을 주입** 하는 방식으로 확장.

```python
SaveOutputFn = Callable[[ComfyUITransport, str], Awaitable[tuple[str, int, int]]]
# 반환: (url, width, height) · video 의 경우 width/height 는 frame 해상도

async def _dispatch_to_comfy(
    task: Task,
    api_prompt_factory,
    *,
    progress_start: int,
    progress_span: int,
    client_prefix: str = "ais",
    upload_bytes: bytes | None = None,
    upload_filename: str | None = None,
    save_output: SaveOutputFn | None = None,  # NEW — None 이면 기존 이미지 저장
) -> ComfyDispatchResult:
    ...
    save_fn = save_output or _save_comfy_output
    image_ref, width, height = await save_fn(comfy, prompt_id)
    ...
```

Video 파이프라인은 `_save_comfy_video()` 구현해서 주입. Generate/Edit 는 기본값 그대로 동작 (회귀 없음).

```python
async def _save_comfy_video(
    comfy: ComfyUITransport, prompt_id: str
) -> tuple[str, int, int]:
    """LTX i2v 결과 MP4 다운로드 + 저장.

    ⚠️ ComfyUI history 응답에서 SaveVideo 노드의 출력이 어느 키로
    나오는지(`videos` / `gifs` / `files`) 실제 캡처로 확인해야 함.
    이 구현은 V2 시작 전 capture 결과로 확정.
    """
    history = await comfy.get_history(prompt_id)
    files = extract_output_files(history, output_class="SaveVideo")
    if not files:
        raise RuntimeError("no video output")
    f = files[0]  # {filename, subfolder, type, format?}
    raw = await comfy.download_file(f["filename"], f["subfolder"], f["type"])
    save_name = f"{uuid.uuid4().hex}.mp4"
    (STUDIO_OUTPUT_DIR / save_name).write_bytes(raw)
    # width/height 는 mp4 디코드 없이 알기 어려움 → 0 반환 (UI 에서 표기 생략)
    return (f"{STUDIO_URL_PREFIX}/{save_name}", 0, 0)
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

그리고 `extract_output_images()` 와 평행하게 `extract_output_files(history_entry, output_class="SaveVideo")` 추가 — history JSON 에서 특정 class_type 노드의 출력 파일 목록 반환.

#### ⚠️ V2 전 필수: SaveVideo 출력 키 캡처

ComfyUI `history/{prompt_id}` 응답에서 `outputs[node_id]` 가 SaveVideo 의 경우 어떤 키로 나오는지 **실제 구동해서 확인 필요**.

후보 키: `videos` / `gifs` / `files` / `images` (어느 것일지 버전/포크마다 다름).

**캡처 절차**:
1. ComfyUI 에서 공식 LTX-2.3 i2v 워크플로우 1회 수동 실행 (Sysmem Fallback 활성화 전제)
2. 생성 완료 후 ComfyUI `/history/{prompt_id}` 를 브라우저에서 직접 조회
3. SaveVideo 노드의 outputs 구조 JSON 복사
4. 이 spec 에 결과 첨부 후 `extract_output_files` 구현 확정

**추정 구조 (검증 전)**:
```json
{
  "outputs": {
    "<save_node_id>": {
      "videos": [{"filename": "...mp4", "subfolder": "", "type": "output", "format": "video/mp4"}]
    }
  }
}
```

캡처 없이 구현하면 첫 E2E 에서 `KeyError`. **V2 시작 전 차단자**.

### 4.7 `studio/history_db.py` 확장

- CHECK constraint `mode IN ('generate', 'edit')` → `('generate', 'edit', 'video')`
- 신규 필드는 추가하지 않음. `imageRef` 가 mp4 URL 이면 video 로 간주

#### 마이그레이션 전략 (SQLite CHECK 제약)

SQLite 는 `ALTER TABLE ... DROP CHECK` 불가. 테이블 재생성 필수.

**판별**: PRAGMA table_info 로는 CHECK 표현식 안 나옴. `sqlite_master.sql` 에서 CREATE TABLE 원문 조회 후 정규식으로 `CHECK(mode IN ('generate','edit'))` 존재 여부 확인.

**안전한 idempotent 마이그레이션**:
```python
async def _needs_video_migration(db: aiosqlite.Connection) -> bool:
    cur = await db.execute(
        "SELECT sql FROM sqlite_master "
        "WHERE type='table' AND name='studio_history'"
    )
    row = await cur.fetchone()
    if not row or not row[0]:
        return False
    create_sql = row[0]
    # 'video' 가 CHECK 목록에 이미 포함됐으면 스킵
    return "'video'" not in create_sql

async def _migrate_add_video_mode(db: aiosqlite.Connection) -> None:
    """CHECK 제약 확장 — 다음 순서로 원자적 실행:
    1) 트랜잭션 시작
    2) 새 CREATE TABLE studio_history_new (CHECK 확장판)
    3) INSERT ... SELECT 로 데이터 복사 (인덱스 없이)
    4) DROP TABLE studio_history
    5) ALTER TABLE ... RENAME TO studio_history
    6) 인덱스 재생성 (idx_studio_history_created, idx_studio_history_mode)
    7) COMMIT
    """
    await db.execute("BEGIN IMMEDIATE")
    try:
        await db.execute(
            "CREATE TABLE studio_history_new ("
            " id TEXT PRIMARY KEY,"
            " mode TEXT NOT NULL CHECK(mode IN ('generate','edit','video')),"
            " ... (기존 컬럼 순서 완전 동일)"
            ")"
        )
        await db.execute(
            "INSERT INTO studio_history_new SELECT * FROM studio_history"
        )
        await db.execute("DROP TABLE studio_history")
        await db.execute(
            "ALTER TABLE studio_history_new RENAME TO studio_history"
        )
        # 인덱스는 DROP TABLE 에서 함께 삭제됨 → 재생성
        await db.execute(CREATE_IDX_CREATED)
        await db.execute(CREATE_IDX_MODE)
        await db.commit()
        log.info("studio_history 마이그레이션: 'video' 모드 CHECK 확장 완료")
    except Exception:
        await db.execute("ROLLBACK")
        raise
```

`init_studio_history_db()` 에서:
```python
if await _needs_video_migration(db):
    await _migrate_add_video_mode(db)
```

**주의 사항**:
- `BEGIN IMMEDIATE` 로 write lock 확보
- 실패 시 ROLLBACK → 기존 테이블 그대로 유지 (데이터 무손실)
- 신규 CREATE TABLE 은 기존과 **컬럼 순서·타입 완전 동일** 해야 `SELECT *` 복사 안전. 이 spec 구현 시 기존 `CREATE_TABLE` 상수를 그대로 재사용하되 CHECK 부분만 교체.
- 테스트: `test_video_pipeline.py` 에 마이그레이션 테스트 추가 (CHECK 없는 DB → 마이그레이션 → 'video' insert 성공 확인).

### 4.8 저장 경로

- `/data/images/studio/xxx.mp4` — 기존 이미지와 같은 폴더 (확장자로 구분)
- StaticFiles mount 는 그대로. Content-Type 은 FastAPI/Starlette 가 자동 판정 (mp4 → video/mp4)

## 5. 프론트엔드 설계

### 5.1 `lib/api/types.ts` 확장 + 파급 효과

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
```

#### ⚠️ mode 확장 파급 — video ref 를 이미지로 렌더하면 broken

`imageRef` 가 `.mp4` URL 인 경우 기존 컴포넌트들이 `<img src={imageRef}>` 로 렌더하면 broken image 표시. 영향 파일 + 대응:

| 컴포넌트 | 영향 | 대응 |
|---------|------|------|
| `components/ui/ImageTile.tsx` | `isImageRef(seed)` 가 `.mp4` 도 image 로 판정 → `<img>` broken | `isVideoRef(ref)` 추가 · `<video muted poster>` 분기 또는 상위에서 render prop 주입 |
| `components/studio/HistoryTile.tsx` | item.mode === "video" 인 경우 전부 ImageTile 로 렌더 | mode 따라 VideoThumb 컴포넌트로 분기 |
| `components/studio/SelectedItemPreview.tsx` | Generate 전용이라 video 미진입 (히스토리 필터가 mode==="generate") | **영향 없음** (필터로 격리) |
| `components/studio/HistoryPicker.tsx` | Edit 페이지의 "히스토리에서 선택" — 전체 items 를 ImageTile 로 | Edit 원본으로는 video 부적절 → `items.filter(mode !== "video")` |
| `components/studio/AiEnhanceCard.tsx` | upgradedPrompt/visionDescription 표시 — 이미지 자체는 안 그림 | **영향 없음** |
| `components/studio/ImageLightbox.tsx` | `<img src>` 로 큰 이미지 | mode==="video" 면 `<video controls>` 분기 또는 Video 전용 Lightbox 별도 |
| `stores/useHistoryStore.ts` | 전체 items 공유 | `itemsByMode` 이미 존재 — 필터로 OK |

**이번 spec 구현 범위**:
- `ImageTile` + `HistoryTile` 은 video 분기 **구현** (필수 · 히스토리 그리드에 video 썸네일 나와야)
- `HistoryPicker` 는 **필터**만 (`mode !== "video"`)
- `ImageLightbox` 는 **이번 범위 밖** — Video 는 VideoPlayerCard 가 우측에 상시 노출되므로 라이트박스 없어도 동작. v2 확장.

`VideoThumb` 컴포넌트 간단 설계:
```typescript
<div style={{position:"relative", aspectRatio:"1/1"}}>
  <video src={ref} muted playsInline preload="metadata"
         style={{width:"100%", height:"100%", objectFit:"cover"}} />
  <div style={{position:"absolute", bottom:6, right:6,
               background:"rgba(0,0,0,.6)", color:"#fff",
               fontSize:10, padding:"2px 6px", borderRadius:4}}>
    ▶ 4s
  </div>
</div>
```

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

1. **V1. Spec 문서** (이 문서) 커밋 ✅
2. **V1.5. ComfyUI SaveVideo 출력 키 캡처** — ⚠️ **차단자** · 실 구동 1회, `/history/{id}` JSON 복사해서 spec 업데이트. 이 결과 없이 V2 시작 금지.
3. **V2. 백엔드 preset + 빌더** — presets.py::VIDEO_MODEL + comfy_api_builder.py::build_video_from_request + test_video_builder.py
4. **V3. 백엔드 파이프라인** — prompt_pipeline.py::upgrade_video_prompt + video_pipeline.py + history_db.py 마이그레이션(sqlite_master 기반) + test_video_pipeline.py (마이그레이션 테스트 포함)
5. **V4. 백엔드 라우트 + transport 확장** — router.py::/video + /video/stream + comfy_transport.extract_output_files + download_file + _dispatch_to_comfy 에 save_output 콜백 주입 + _save_comfy_video
6. **V5. 프론트 타입/API/스토어** — types.ts (mode 확장 + video 메타) + lib/api/video.ts + useVideoStore.ts
7. **V6. 프론트 훅/컴포넌트** — useVideoPipeline.ts + VideoPlayerCard.tsx + VideoThumb (ImageTile/HistoryTile video 분기)
8. **V7. 프론트 페이지 + 필터** — app/video/page.tsx 실구현 + 메인 메뉴 disabled 해제 + HistoryPicker 에 video 필터
9. **V8. 검증 + master 머지** — pytest (마이그레이션 테스트 포함) + tsc + build + 실 구동 체크리스트

## 11. 향후 확장 여지 (이번 범위 밖)

- t2v (텍스트만 영상) — `build_video_from_request` 에 `source_filename=None` 분기 + 별도 워크플로우 (LoadImage 없는 변종)
- Vision 페이지에도 영상 미리보기 (이 spec 과 무관)
- 프레임/해상도 사용자 조절 UI (고급 아코디언)
- 배치 생성 (프롬프트 여러 개)
- 썸네일/포스터 프레임 추출 (ffmpeg) — 히스토리 썸네일 개선
- 영상 전용 라이트박스 (ImageLightbox 확장)
- LoRA 강도 토글 (현재 0.5 고정)
- MP4 메타 파싱으로 width/height/duration 백엔드에서 정확 기록 (현재 0 반환)

## 12. 실제 구현 복잡도 — "Edit 보다 한 단계 위" 상세

사용자 요구는 "Edit 모드 수준" 이지만 UX 만 그렇고 구현 복잡도는 실질적으로 높다. 주의 요인:

| 요인 | Edit | Video | 차이 |
|------|------|-------|------|
| 출력 포맷 | PNG 1장 | MP4 + 오디오 | `download_file` · mime 처리 · `<video>` 재생 |
| 워크플로우 노드 수 | 15~20 | **47** | LTX-2.3 subgraph 큼 |
| Sampling 구조 | 단일 KSampler | **2-stage** (base + upscale) + AV concat | `build_video_from_request` 분기 많음 |
| WS 타임아웃 | 10분 | **60분** | idle 15분 · hard 1시간 |
| ComfyUI 출력 키 | `images` 확정 | **`videos`/`gifs`/`files` 미확인** | V1.5 캡처 필요 |
| DB 마이그레이션 | 기존 컬럼 추가 (ALTER) | **CHECK 제약 확장** (재생성) | 트랜잭션/인덱스 복구 |
| 프론트 썸네일 | `<img>` | **`<video>` + poster** | ImageTile 분기 |
| 히스토리 렌더 파급 | mode 분기 불필요 | **mode==="video" 전파** (5+ 파일) | 타입 union 확장 |
| VRAM 요구 | 16GB 여유 | **16GB 빡빡 (29GB fp8)** | env override + Sysmem Fallback 문서화 |

**총평**: UI 자체는 Edit 복붙 수준 단순하지만, 백엔드/스토리지/타입 레이어는 한 층 위의 작업. V2~V8 커밋 단위로 나눈 건 이 복잡도를 단계별로 차단하려는 목적.
