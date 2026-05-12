# Video 비전 파이프라인 영상-특화 개선 (Spec v1.1)

**작성일**: 2026-05-11
**상태**: 기획 v1.1 (Codex review 1라운드 반영 — 5 finding 전체 수용)
**작성자**: Opus 4.7 (사용자 공동 기획 · Codex iterative review)
**대상 파일**: `docs/superpowers/specs/2026-05-11-video-vision-pipeline-improvement-design.md`
**관련 spec**:
- `docs/superpowers/specs/2026-05-03-video-model-selection-wan22.md` (Wan 2.2 / LTX 2.3 듀얼 도입)
- `docs/superpowers/specs/2026-05-05-vision-compare-redesign-design.md` (Vision 2-stage 관찰 패턴 — 참조용)

**선택 옵션**: **B** (영상 전용 비전 system + Wan 2.2 / LTX 2.3 gemma4 분기) — C 의 "관찰→합성" 3단계 분할은 영상에 슬롯 매트릭스가 없어 marginal gain 이고 매번 +5~10초 비용 발생. B 의 90→92점 가성비가 우월. C 는 B 결과 dogfooding 후 필요 시 후속 plan 으로.

---

## 0. v1.0 → v1.1 변경 요약 (Codex review 1라운드)

| # | Codex finding (severity) | v1.0 (초안) | v1.1 (현재) |
|---|--------------------------|-------------|-------------|
| 1 | model_id default 충돌 (**High**) | `build_system_video(adult, model_id="ltx")` default — 하위 호환 명목 | **`model_id` keyword-only required** (`*, model_id: VideoModelId`) · default 제거 · 누락 시 TypeError 즉시 발견. 기존 LTX 호출자는 명시 `model_id="ltx"` 로 갱신 |
| 2 | 테스트 전파 1단 부족 (**High**) | `upgrade_video_prompt → build_system_video` 만 검증 (1단) | **3단 전파 검증**: `_run_video_pipeline_task → run_video_pipeline → upgrade_video_prompt → build_system_video`. 신규 테스트 6 → **8개** (전파 2개 추가) |
| 3 | facade export 누락 (**Medium**) | `vision_pipeline/_common.py` + `prompt_pipeline/upgrade.py` 만 명시 | **facade 2개 추가**: `vision_pipeline/__init__.py` re-export `VIDEO_VISION_SYSTEM` + `prompt_pipeline/__init__.py` re-export `SYSTEM_VIDEO_WAN22_BASE`. 옵션 D 패턴 일관성 |
| 4 | "Avoid cartoon" rule 충돌 (**Medium**) | Wan 분기 안에 "user override" 명시했지만, 공통 `SYSTEM_VIDEO_RULES` 의 `"Avoid cartoon / game / childish aesthetics"` 는 hard rule 그대로 — anime/game 명시 요청과 충돌 | **`SYSTEM_VIDEO_RULES` 수정**: "Avoid cartoon / game / childish aesthetics **unless the user explicitly requests such a style**" 로 보강 |
| 5 | 테스트 경로 + 절대 숫자 (**Low**) | `backend/tests/test_video_pipeline.py` · 534→540 PASS / vitest 280 절대 숫자 | **`backend/tests/studio/test_video_pipeline.py`** 로 경로 수정 · 절대 숫자 → **"+8 신규 PASS / 기존 regression 0"** 목표 표현 |

> Codex iterative review 패턴 (memory `feedback_codex_iterative_review.md`) 적용 — finding 5/5 모두 정확 검증 후 수용. v1.1 반영 후 Codex 2라운드 재검증 권장.

---

## 1. Context — 왜 이 변경이 필요한가

영상 모드 (`/video`) 의 1단계 비전 분석은 현재 **일반 캡션용 system prompt** 를 그대로 사용 중. 영상 생성 (i2v) 의 핵심 정보 (첫 프레임 anchor / 잠재 모션 / 환경 동적 요소 / 카메라 잠재력 / 분위기) 를 의도적으로 잡지 않음.

### 1.1 현재 흐름 (`backend/studio/video_pipeline.py:48`)

```
run_video_pipeline()
  → _describe_image(system_prompt=VISION_SYSTEM, temperature=0.4)
       └ VISION_SYSTEM = "vision captioner. 2-3 concise English sentences.
                          Focus on subject, setting, style, lighting, mood."
  → ollama_unload (vision → text swap · spec 19)
  → upgrade_video_prompt(image_description, user_direction)
       └ SYSTEM_VIDEO_BASE (LTX-2.3 cinematic engineer · 60-150 단어)
```

### 1.2 핵심 결함 2개

**결함 A — 비전 1단계가 영상용이 아님** (`vision_pipeline/_common.py:41-45`)
- `VISION_SYSTEM` 은 정적 이미지 캡션용. 2~3문장 generic 출력
- gemma4 가 i2v 영상 대본 작성 시 빈약한 description 으로 *상상 보충* → 첫 프레임 identity drift 위험
- Edit / Vision Analyzer 는 도메인 전용 system 있음, Video 만 default fallback 그대로

**결함 B — gemma4 2단계가 LTX 전용** (`prompt_pipeline/upgrade.py:314`)
- `SYSTEM_VIDEO_BASE` 안에 *"You are a cinematic prompt engineer for LTX-2.3 video generation"* 명시
- 현재 default 영상 모델은 **Wan 2.2 i2v** (`presets.py:663` · `DEFAULT_VIDEO_MODEL_ID = "wan22"`)
- Wan 의 텍스트 인코더는 umT5 (T5 small 계열), LTX 의 Gemma3 12B 대비 토큰 처리 범위·학습 분포가 다름
- 60~150 단어 cinematic paragraph 를 umT5 에 넣으면 토큰 잘림 + 학습 분포 밖 어휘 → 어색한 모션·앵커 약화

### 1.3 두 모델 핵심 차이 (presets.py 실증값)

| 항목 | Wan 2.2 i2v (default) | LTX 2.3 |
|------|----------------------|---------|
| Text encoder | `umt5_xxl_fp8_e4m3fn_scaled` (T5 계열) | `gemma_3_12B_it_fp4_mixed` (Gemma3 12B) |
| 선호 prompt 길이 | 50~80 단어 (T5 토큰 한계 ≈ 추정 · R3 참조) | 60~150 단어 (cinematic paragraph) |
| FPS (학습) | 16 | 25 |
| 모션 LoRA | **BounceHigh strength 0.8 항상 ON** | 없음 |
| 샘플링 stage | MoE 2-stage (high → low noise) | base + spatial upscale x2 |
| 약점 | 손가락·복잡한 손동작 | 얼굴 identity drift (img_compression 12 / second_strength 0.9 로 완화 중) |
| Lightning ON | 4 step · cfg 1.0 | 4 step (manual sigmas) |

---

## 2. 사용자 확정 결정 사항 (2026-05-11)

| # | 항목 | 결정 |
|---|------|------|
| 1 | 구현 옵션 | **B** (영상 전용 비전 system + Wan/LTX gemma4 분기) |
| 2 | 비전 단계 분리 | 1-call 유지 (3-stage 분할 안 함 — C 는 후속 plan 후보) |
| 3 | 비전 temperature | 0.4 → **0.2** (i2v anchor 일관성) |
| 4 | system prompt 라벨 형식 | 영문 라벨 (`ANCHOR:`, `MOTION CUES:` 등) — gemma4 가 파싱 안 하고 텍스트 그대로 흡수 |
| 5 | 한국어 사용자 입력 | 기존 흐름 유지 (gemma4 가 영어로 번역 후 처리) |
| 6 | Bounce LoRA strength 조정 | 이번 spec 범위 *밖* (별도 dogfooding 후 결정) |
| 7 | pre_upgraded_prompt 우회 경로 | 기존 유지 (비전/gemma4 둘 다 skip) |
| 8 (v1.1 신규) | `model_id` 시그니처 정책 | **keyword-only required** (default 없음) — Codex Finding 1 반영. 누락 호출자는 TypeError 로 즉시 노출 (silent Wan→LTX prompt 사고 차단) |

### 비목표 (YAGNI)

- 비전 단계의 구조화 JSON 출력 (C 옵션) — 후속 plan
- 비전 단계 2-stage 분리 (observe → synthesize) — 후속 plan
- 모델별 negative_prompt 추가 분기 — 현재 `presets.py` 값 유지 (Wan22 는 손 디테일, LTX 는 cartoon 회피로 이미 분기됨)
- Wan 2.2 의 Bounce LoRA strength 0.8 튜닝
- LTX 의 `imgtovideo_first_strength` / `img_compression` 추가 튜닝
- Vision model swap (qwen3-vl:8b → 다른 모델)
- 영상 history mode 분리 / DB schema migration

---

## 3. 구현 범위

### 3.1 Backend 변경 파일 (v1.1 — facade 2개 추가)

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `backend/studio/vision_pipeline/_common.py` | `VIDEO_VISION_SYSTEM` 신규 상수 추가 (기존 `VISION_SYSTEM` 유지 — Edit 폴백·기타 호출자 영향 없음) |
| 2 | `backend/studio/vision_pipeline/__init__.py` | `VIDEO_VISION_SYSTEM` facade re-export 추가 + `__all__` 에 등재 (옵션 D 패턴 일관성) |
| 3 | `backend/studio/prompt_pipeline/upgrade.py` | `SYSTEM_VIDEO_WAN22_BASE` 신규 + `SYSTEM_VIDEO_RULES` 수정 ("unless explicitly requested") + `build_system_video(*, adult, model_id)` keyword-only required 시그니처 |
| 4 | `backend/studio/prompt_pipeline/__init__.py` | `SYSTEM_VIDEO_WAN22_BASE` facade re-export 추가 + `__all__` 에 등재 |
| 5 | `backend/studio/video_pipeline.py` | (a) `_describe_image()` 호출 시 `system_prompt=VIDEO_VISION_SYSTEM`, `temperature=0.2` 명시. (b) `run_video_pipeline(*, model_id)` keyword-only required 파라미터 신규. (c) `upgrade_video_prompt()` 호출 시 `model_id=model_id` 전달 |
| 6 | `backend/studio/prompt_pipeline/upgrade.py` (재) | `upgrade_video_prompt(*, model_id)` keyword-only required 파라미터 추가 → `build_system_video(model_id=model_id)` 전달 |
| 7 | `backend/studio/pipelines/video.py` | `run_video_pipeline()` 호출 시 `model_id=model_id` 전달 (이미 `model_id: VideoModelId` 파라미터 보유 · line 76) |

### 3.2 Frontend 변경

**없음**. 1단계 비전 system / 2단계 gemma4 system 은 모두 backend 영역. `vision_model_override` / `model_id` 는 이미 multipart 로 전달되고 있어 시그니처 확장만 필요.

### 3.3 테스트 영향 (v1.1 — 6 → 8개)

**테스트 경로 (Codex Finding 5 수정)**: `backend/tests/studio/test_video_pipeline.py` + `backend/tests/studio/test_prompt_pipeline.py`

기존 테스트 영향:
- 기존 `upgrade_video_prompt` 직접 호출 테스트 → `model_id="ltx"` 명시 추가 (1줄)
- 기존 `run_video_pipeline` mock 테스트 → `model_id="ltx"` 또는 `"wan22"` 명시 추가
- 기존 LTX 호환 보존 케이스는 **명시적으로 `model_id="ltx"`** 로 통과 확인

**신규 테스트 8개 (정책 + 전파 검증)**:

| # | 테스트 이름 | 검증 대상 | 파일 |
|---|-------------|----------|------|
| 1 | `test_video_vision_system_has_5_labels` | `VIDEO_VISION_SYSTEM` 안에 5 라벨 (ANCHOR / MOTION CUES / ENVIRONMENT DYNAMICS / CAMERA POTENTIAL / MOOD) 전부 존재 | `test_video_pipeline.py` |
| 2 | `test_video_pipeline_uses_video_vision_system` | `_describe_image` mock 에서 `system_prompt` kwarg 가 `VIDEO_VISION_SYSTEM` 인지 | `test_video_pipeline.py` |
| 3 | `test_video_pipeline_uses_temperature_0_2` | 같은 mock 에서 `temperature=0.2` 검증 | `test_video_pipeline.py` |
| 4 | `test_build_system_video_dispatches_wan22` | `build_system_video(model_id="wan22")` 결과에 `SYSTEM_VIDEO_WAN22_BASE` 키워드 포함 | `test_prompt_pipeline.py` |
| 5 | `test_build_system_video_dispatches_ltx` | `build_system_video(model_id="ltx")` 결과에 LTX cinematic 키워드 포함 | `test_prompt_pipeline.py` |
| 6 | `test_build_system_video_rejects_missing_model_id` | `build_system_video(adult=False)` 가 TypeError 발생 (keyword-only required 보장) | `test_prompt_pipeline.py` |
| 7 (v1.1 신규) | `test_run_video_pipeline_propagates_model_id_to_upgrade` | `run_video_pipeline(..., model_id="wan22")` → `upgrade_video_prompt(model_id="wan22")` 전달 (mock 검증) | `test_video_pipeline.py` |
| 8 (v1.1 신규) | `test_run_video_pipeline_task_propagates_model_id` | `_run_video_pipeline_task(..., model_id="wan22")` → `run_video_pipeline(model_id="wan22")` 전달 (mock 검증) | `test_video_pipeline.py` |

**목표 (절대 숫자 → 변화량)**: pytest **+8 신규 PASS** · 기존 regression 0 · vitest 변화 0 · tsc/lint 회귀 0.

---

## 4. 영상 전용 비전 system prompt 초안 (`VIDEO_VISION_SYSTEM`)

```python
VIDEO_VISION_SYSTEM = """You are an i2v (image-to-video) analyst.

GOAL: Analyze this reference image so a downstream video model can
(1) reproduce the first frame with high fidelity, and
(2) generate natural motion for a 5-second clip.

Output 5 LABELED sections in this exact order. English only.
Describe ONLY what is visually present — do NOT speculate.

[ANCHOR] — for first-frame identity match.
  If person: gender, approximate age range, body type, face shape,
  skin tone, hair (color/length/style), clothing (top/bottom/accessories),
  pose, gaze direction. ONE sentence.
  If object/landscape: subject identity, composition, materials, dominant
  colors, viewpoint. ONE sentence.

[MOTION CUES] — what could naturally move in a short clip.
  Hands, arms, gaze, expression, hair strands, fabric/cloth, held objects.
  Mention only cues actually visible in the image (e.g. loose strands,
  parted lips, slightly raised hand). If nothing suggests motion:
  "static subject — minimal motion cues". ONE sentence.

[ENVIRONMENT DYNAMICS] — background elements that could animate naturally.
  Wind, rain, dust, water ripples, flame flicker, light flicker, traffic,
  crowd movement, falling leaves, mist. ONE sentence. If none: "still
  environment".

[CAMERA POTENTIAL] — spatial cues for camera work.
  Depth of field (shallow/deep), spatial layers (foreground/midground/
  background), leading lines, negative space direction. ONE sentence.

[MOOD] — time of day, weather, lighting tone, overall atmosphere.
  ONE sentence.

RULES:
- 5 sections, exactly one sentence each (total 5 sentences).
- Use the labels verbatim, in this exact order.
- NO preamble, NO closing remark, NO markdown.
- Only what is visible — never invent details.
"""
```

### 4.1 출력 형식 예시 (가상)

```
[ANCHOR] A young adult woman in her early 20s with shoulder-length brown
hair, wearing a cream knit sweater, seated upright facing the camera with
a soft closed-mouth smile and direct gaze.
[MOTION CUES] Loose hair strands near her temples and a slightly tilted
head suggest gentle head turn or breeze interaction; hands rest visibly
on a ceramic coffee mug.
[ENVIRONMENT DYNAMICS] A blurred café window in the background shows
faint rain droplets and warm pendant lights with subtle flicker potential.
[CAMERA POTENTIAL] Shallow depth of field with strong foreground subject
isolation; negative space on the right invites a subtle push-in or slow
dolly toward the subject.
[MOOD] Late afternoon, overcast rainy day, warm interior tungsten
lighting, calm and intimate atmosphere.
```

---

## 5. Wan 2.2 전용 gemma4 system prompt 초안 (`SYSTEM_VIDEO_WAN22_BASE`)

```python
SYSTEM_VIDEO_WAN22_BASE = """You are a video prompt engineer for the
Wan 2.2 i2v model (16fps, umT5 text encoder, 5-second clip).

You receive:
1. A labeled analysis of the reference image (ANCHOR / MOTION CUES /
   ENVIRONMENT DYNAMICS / CAMERA POTENTIAL / MOOD).
2. The user's direction for the video.

Compose ONE concise English paragraph (50-80 words) for the model.
Keep sentences short and concrete. Avoid long cinematic flourishes —
Wan's text encoder prefers clean structured prompts.

INCLUDE in this order:
- First-frame anchor (paraphrase ANCHOR · keep key visual identifiers)
- Primary motion (1-2 specific actions grounded in MOTION CUES)
- Camera work (gentle pan / slow push-in / static / subtle dolly —
  choose ONE based on CAMERA POTENTIAL · prefer slow/subtle)
- Atmosphere (1 phrase from MOOD)

═════════════════════════════════════════════════════════════
IDENTITY PRESERVATION (CRITICAL for i2v):
═════════════════════════════════════════════════════════════
If ANCHOR describes a person:
  include verbatim: "keep the exact same face, same hair, same clothing,
  same body proportion, no face swap, no identity drift"
If ANCHOR describes an object/landscape:
  include verbatim: "keep the exact same subject, same composition,
  same materials, no subject swap"

═════════════════════════════════════════════════════════════
WAN 2.2 SPECIFIC GUIDANCE:
═════════════════════════════════════════════════════════════
- Prefer simple hand poses (Wan struggles with complex finger articulation).
  If the reference image has clear hand detail, use phrases like "hands
  remain still" or "hands stay in their pose" rather than describing
  intricate movement. Do NOT mention "hands" as a negative — describe
  what they DO naturally instead.
- Prefer slow camera motion (16fps · fast pans cause judder).
- Use plain language for depth of field ("blurred background" rather
  than "shallow DoF · 35mm · filmic" — out of umT5 training distribution).

═════════════════════════════════════════════════════════════
LIGHTING / STYLE OVERRIDE:
═════════════════════════════════════════════════════════════
If the user explicitly requests a lighting/style change
(neon, anime, B&W, rainy mood, cartoon, etc.), let it dominate.
Otherwise add "preserve original color tone, natural lighting" softly.

RULES:
- Output ONLY the final English paragraph — no preamble, no bullets.
- 50-80 words total. Plain language. Short sentences.
- If the user wrote Korean, translate intent to English.
- Include the identity clause exactly once (verbatim)."""
```

> **v1.1 보강 (Codex Finding 5 권장 반영)**: 기존 v1.0 의 "Avoid complex finger/hand articulation" 부정형이 negative-prompt-effect (오히려 손 강조) 위험. v1.1 은 *positive instruction* 으로 재작성 — "hands remain still / stay in pose" 처럼 자연스러운 행동을 *describe* 하도록 안내.

### 5.1 SYSTEM_VIDEO_RULES 수정 (Codex Finding 4 반영)

```python
SYSTEM_VIDEO_RULES = """

RULES:
- Output ONLY the final English paragraph — no preamble, no bullets, no markdown.
- Avoid cartoon / game / childish aesthetics **unless the user
  explicitly requests such a style** (e.g. "anime style", "pixel art",
  "cartoon look", "game cinematic"). In that case, the user direction
  dominates and the avoidance rule is waived.
- If the user wrote Korean, translate intent to English.
- Never repeat phrases (except the identity clause above, which is required)."""
```

기존 `"Avoid cartoon / game / childish aesthetics."` 한 줄 hard rule 을 **명시적 user override 허용**으로 보강. 두 모델 공통 RULES 이므로 한 번만 수정.

### 5.2 build_system_video 시그니처 (v1.1 — keyword-only required)

```python
def build_system_video(
    *,
    adult: bool,
    model_id: VideoModelId,
) -> str:
    """Video 시스템 프롬프트 구성 (v1.1: keyword-only required).

    Codex Finding 1 반영 — 기존 `model_id="ltx"` default 가 현재
    `DEFAULT_VIDEO_MODEL_ID="wan22"` 와 충돌해 silent Wan→LTX prompt
    사고 위험. default 제거 + keyword-only 로 누락 호출자를 TypeError 로
    즉시 노출.

    model_id 분기:
      - "ltx"   → SYSTEM_VIDEO_BASE (cinematic paragraph 60~150 단어)
      - "wan22" → SYSTEM_VIDEO_WAN22_BASE (concise 50~80 단어 + Wan 가이드)
    """
    if model_id == "wan22":
        base = SYSTEM_VIDEO_WAN22_BASE
    elif model_id == "ltx":
        base = SYSTEM_VIDEO_BASE
    else:
        raise ValueError(f"unknown video model_id: {model_id!r}")

    return base + (SYSTEM_VIDEO_ADULT_CLAUSE if adult else "") + SYSTEM_VIDEO_RULES
```

`SYSTEM_VIDEO_ADULT_CLAUSE` 와 수정된 `SYSTEM_VIDEO_RULES` 는 두 모델 공통 — 재사용.

**호환 alias 처리**: 기존 모듈 상단의 `SYSTEM_VIDEO = build_system_video(adult=False)` 한 줄은 **삭제** — keyword-only required 시그니처와 충돌. 외부 호출자는 없음 (`grep` 으로 확인 후 commit).

### 5.3 upgrade_video_prompt 시그니처 (v1.1)

```python
async def upgrade_video_prompt(
    user_direction: str,
    image_description: str,
    *,
    model_id: VideoModelId,  # v1.1 신규 — keyword-only required
    model: str = "gemma4-un:latest",
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    include_translation: bool = True,
    adult: bool = False,
    prompt_mode: PromptEnhanceMode | str | None = "fast",
) -> UpgradeResult:
    """Video i2v 용 프롬프트 업그레이드 (v1.1: model_id 분기 추가).

    model_id 는 `build_system_video(model_id=...)` 로 그대로 전달되어
    Wan22 / LTX 별 system prompt 분기. keyword-only required.
    """
```

### 5.4 run_video_pipeline 시그니처 (v1.1)

```python
async def run_video_pipeline(
    image_path: Path | str | bytes,
    user_direction: str,
    *,
    model_id: VideoModelId,  # v1.1 신규 — keyword-only required
    vision_model: str | None = None,
    text_model: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    adult: bool = False,
    prompt_mode: str = "fast",
) -> VideoPipelineResult:
    """영상 생성용 2단계 체이닝 실행 (v1.1: model_id 추가)."""
```

`pipelines/video.py:141` 의 호출부는 이미 `model_id: VideoModelId` 파라미터를 보유 (line 76) — 단순 `model_id=model_id` 전달 한 줄 추가.

---

## 6. 데이터 흐름 전후 비교

### Before (현재 · v0)
```
이미지
 → qwen3-vl + VISION_SYSTEM (generic 2~3 sentences, temp 0.4)
 → "A young woman sits in a café with warm lighting." (예시)
 → gemma4 + SYSTEM_VIDEO_BASE (LTX cinematic, 60~150 단어)
 → Wan 2.2 / LTX 2.3 둘 다 같은 prompt 받음 ← Wan 결과 어색
```

### After (v1.1 적용)
```
이미지
 → qwen3-vl + VIDEO_VISION_SYSTEM (5 labeled sections, temp 0.2)
 → "[ANCHOR] ... [MOTION CUES] ... [ENVIRONMENT DYNAMICS] ..." (5 문장)
 → gemma4 + build_system_video(model_id=...)
     ├ model_id="wan22": SYSTEM_VIDEO_WAN22_BASE → 50~80 단어 concise
     └ model_id="ltx"  : SYSTEM_VIDEO_BASE → 60~150 단어 cinematic
 → 각 모델 학습 분포에 맞는 prompt 수신
```

---

## 7. 단계별 구현 순서 (TDD 권장 · v1.1 = 9 task)

| # | Task | 변경 파일 | 테스트 |
|---|------|----------|--------|
| 1 | `VIDEO_VISION_SYSTEM` 상수 + facade re-export | `vision_pipeline/_common.py`, `__init__.py` | `test_video_vision_system_has_5_labels` |
| 2 | `video_pipeline.py` 가 `VIDEO_VISION_SYSTEM` + temp 0.2 사용 | `video_pipeline.py` | `test_video_pipeline_uses_video_vision_system` + `test_video_pipeline_uses_temperature_0_2` |
| 3 | `SYSTEM_VIDEO_WAN22_BASE` 상수 + facade re-export | `prompt_pipeline/upgrade.py`, `__init__.py` | (Task 4 와 묶임) |
| 4 | `SYSTEM_VIDEO_RULES` "unless explicitly requested" 보강 | `prompt_pipeline/upgrade.py` | rule 문자열 grep 검증 (assert 한 줄) |
| 5 | `build_system_video(*, adult, model_id)` keyword-only required + 분기 | `prompt_pipeline/upgrade.py` | `test_build_system_video_dispatches_wan22` + `_ltx` + `_rejects_missing_model_id` |
| 6 | `upgrade_video_prompt(*, model_id)` keyword-only required | `prompt_pipeline/upgrade.py` | 기존 LTX 테스트 갱신 (`model_id="ltx"` 명시) |
| 7 | `run_video_pipeline(*, model_id)` keyword-only required + `upgrade_video_prompt(model_id=...)` 전달 | `video_pipeline.py` | `test_run_video_pipeline_propagates_model_id_to_upgrade` |
| 8 | `pipelines/video.py` 의 `run_video_pipeline()` 호출에 `model_id=model_id` 전달 | `pipelines/video.py` | `test_run_video_pipeline_task_propagates_model_id` |
| 9 | dogfooding (시나리오 A~D 각 1회) | — | 사용자 시각 평가 (§8.2) |

각 task 는 RED (failing test) → GREEN (impl) → REFACTOR 사이클 권장.
Task 6 의 "기존 LTX 테스트 갱신" 은 별도 commit 로 분리 권장 (review diff 명확화).

---

## 8. 검증 기준

### 8.1 자동 검증 (v1.1 — 변화량 기준)

- pytest **+8 신규 PASS · 기존 regression 0** (절대 숫자는 master 시점 기준 측정 후 PR description 에 기록)
- vitest 변화 0 (frontend 변경 없음)
- tsc / lint 회귀 0

### 8.2 사용자 시각 검증 (dogfooding)

**시나리오 A — Wan 2.2 default · 인물 사진**
- 첫 프레임 identity (얼굴 / 머리 / 의상) 가 원본과 일치하는가?
- 모션이 자연스럽고 손가락 깨짐 없는가?
- 카메라 워크가 16fps 에 적합한 수준 (slow/subtle) 인가?

**시나리오 B — LTX 2.3 · 인물 사진**
- 기존 LTX 결과 품질과 동등 이상인가? (regression 안 됨 확인)
- cinematic paragraph 가 풍부하게 살아있는가?

**시나리오 C — Wan 2.2 · 풍경/물체 사진**
- ANCHOR 가 person 경로가 아닌 object/landscape 경로로 작성되는가?
- 환경 동적 요소 (바람·물·빛 깜빡임) 가 자연스럽게 반영되는가?

**시나리오 D — Wan 2.2 · adult mode ON**
- NSFW clause 가 system prompt 에 정상 주입되는가?
- identity preservation clause 가 NSFW 와 충돌 없이 공존하는가?

**시나리오 E (v1.1 신규) — 명시적 anime/cartoon 요청**
- 사용자 prompt 에 "anime style" 명시 → `SYSTEM_VIDEO_RULES` 의 "unless explicitly requested" 가 작동하여 cartoon avoidance 가 waive 되는가?
- Wan / LTX 양쪽 모두 동일하게 동작하는가?

### 8.3 회귀 체크리스트

- `pre_upgraded_prompt` 우회 경로 (영문 정제 입력) 가 여전히 작동 (vision + gemma4 둘 다 skip · ~15초 절약)
- `vision_model_override` (settings 의 visionModel) 가 여전히 전달됨
- `ollama_unload` (spec 19) 가 vision → gemma4 swap 사이에 호출됨
- `gpu_slot("video-vision")` lock 유지
- 기존 LTX 테스트 (master 시점 PASS) 가 `model_id="ltx"` 명시 후에도 동일 결과

---

## 9. 리스크 / 트레이드오프 (v1.1 — R6 → R1 으로 해소)

| # | 리스크 | 완화 |
|---|--------|------|
| R1 | Wan 2.2 분기 후 결과가 오히려 *덜* cinematic — 사용자 기대 어긋남 | dogfooding 시나리오 B (LTX 비교) 필수 · 50~80 단어 제약이 너무 답답하면 v1.2 에서 80~100 으로 완화 |
| R2 | `VIDEO_VISION_SYSTEM` 5 라벨 출력을 모델이 일관되게 따르지 않음 (qwen3-vl variance) | `temp 0.2` + 라벨 verbatim 강제. 실패 시 description 그대로 gemma4 전달 (5 라벨 없어도 빈약하지만 폴백 가능) |
| R3 | umT5 토큰 한계 가정 — 실제 한계 미실측 | Wan 2.2 50~80 단어는 보수적 추정 (T5 일반 max_length 512 토큰 기준 안전 마진). 실측 후 조정 — dogfooding 시 prompt 길이 로깅 권장 |
| R4 | 누락 호출자가 LTX prompt 를 Wan 에 줄 silent 사고 | **해소** (v1.1 · Codex Finding 1) — `model_id` keyword-only required 로 누락 시 TypeError 즉시 발생. 통합 테스트로 `_run_video_pipeline_task → run_video_pipeline → upgrade_video_prompt → build_system_video` 3단 전파 검증 |
| R5 | `_describe_image` 의 다른 호출자가 `VIDEO_VISION_SYSTEM` 영향 받음 | 영향 없음 — `_describe_image` 의 `system_prompt` 는 kwarg, default 는 기존 `VISION_SYSTEM` 그대로. Video 만 명시 override |
| R6 (v1.1 신규) | Wan 의 "complex finger 회피" rule 이 negative-prompt-effect (오히려 손 강조) | v1.1 보강 (Codex Finding 5 권장) — *positive instruction* ("hands remain still") 로 재작성. dogfooding 시나리오 A 에서 손 결과 면밀 관찰 |
| R7 (v1.1 신규) | `SYSTEM_VIDEO_RULES` 의 "unless explicitly requested" 우회가 *너무 관대* — 무관한 prompt 에도 cartoon 결과 | gemma4 의 일관된 user direction 해석에 의존. 시나리오 E 로 dogfooding 검증. 부족 시 v1.2 에서 키워드 white list 명시 |

---

## 10. 후속 plan 후보 (이번 spec 범위 밖)

| # | 항목 | 트리거 |
|---|------|--------|
| F1 | C 옵션 — 비전 1단계를 observe (JSON 구조) → synthesize (paragraph) 2-stage 분리 | B dogfooding 후에도 첫 프레임 anchor 가 약하면 |
| F2 | Wan 2.2 의 BounceHigh LoRA strength 튜닝 (현재 0.8 → 0.6/0.7/0.9 비교) | 모든 영상이 통통 튀는 느낌이 강하다고 사용자 평가 시 |
| F3 | LTX 2.3 의 `imgtovideo_first_strength` 추가 튜닝 (현재 1.0) | LTX 첫 프레임 drift 가 여전히 보일 때 |
| F4 | 모델별 negative_prompt 도 vision 결과 기반으로 동적 보강 | dogfooding 후 특정 artifact 패턴 발견 시 |
| F5 | Vision history mode 분리 (`mode="video-vision"`) — DB schema v10 migration | 영상 비전 분석 결과 별도 저장 필요시 |
| F6 | 사용자 prompt 정제 단계 추가 (Korean intent extraction → English motion verbs) | 한국어 prompt 의 motion 표현이 자주 누락될 때 |
| F7 (v1.1 신규) | Wan 2.2 prompt 길이 50~80 → 80~100 완화 (R1 발현 시) | 시나리오 A 에서 결과가 너무 빈약하면 |
| F8 (v1.1 신규) | "unless explicitly requested" 의 키워드 white list 명시 (R7 발현 시) | 시나리오 E 에서 우회가 너무 관대하면 |

---

## 11. 변경 요약 (v1.1 — Codex review 빠른 재점검용)

- **새 상수 2개**: `VIDEO_VISION_SYSTEM` (`vision_pipeline/_common.py`) + `SYSTEM_VIDEO_WAN22_BASE` (`prompt_pipeline/upgrade.py`)
- **facade re-export 2개** (v1.1 신규 · Codex Finding 3): `vision_pipeline/__init__.py` + `prompt_pipeline/__init__.py`
- **rule 수정 1개** (v1.1 신규 · Codex Finding 4): `SYSTEM_VIDEO_RULES` 에 "unless explicitly requested" 보강
- **시그니처 keyword-only required 3개** (v1.1 · Codex Finding 1):
  1. `build_system_video(*, adult, model_id)` — default 제거
  2. `upgrade_video_prompt(..., *, model_id, ...)`
  3. `run_video_pipeline(image_path, user_direction, *, model_id, ...)`
- **호출 site 변경 4개**:
  1. `video_pipeline.py` → `_describe_image` 호출 시 `system_prompt=VIDEO_VISION_SYSTEM`, `temperature=0.2`
  2. `video_pipeline.py` → `upgrade_video_prompt` 호출 시 `model_id=model_id`
  3. `pipelines/video.py` → `run_video_pipeline` 호출 시 `model_id=model_id`
  4. 기존 LTX 테스트 → `model_id="ltx"` 명시 추가 (review diff 격리)
- **신규 테스트 8개** (v1.1 · Codex Finding 2 — 3단 전파 검증 2개 추가)
- **삭제 코드 1개**: 기존 `SYSTEM_VIDEO = build_system_video(adult=False)` 하위 호환 alias 라인 (keyword-only required 와 충돌 · 외부 호출자 grep 후 안전 제거)
- **마이그레이션 / DB schema 변경 없음**
- **Frontend 변경 없음**

---

## 12. Codex review 시 특히 점검 요청 (v1.1 — 2라운드 게이트)

v1.0 의 6 질문은 모두 v1.1 반영 후 재검증 필요. 추가 점검 항목:

1. `model_id` keyword-only required 정책이 모든 호출 site (테스트 포함) 에 누락 없이 적용되었는가?
2. `SYSTEM_VIDEO_RULES` 의 "unless explicitly requested" 가 너무 관대해 *무관한* prompt 에도 cartoon 결과를 유발하지 않는가? (R7)
3. Wan 의 *positive instruction* 재작성 ("hands remain still") 이 i2v 실제 결과에서 손 깨짐을 줄이는가, 아니면 단순히 자연스러운 묘사 회피로 끝나는가? (R6)
4. `vision_pipeline/__init__.py` 와 `prompt_pipeline/__init__.py` 의 facade re-export 가 옵션 D 패턴 일관성 (sub-module 직접 import + `_c.X()` 호출) 과 충돌하지 않는가?
5. `SYSTEM_VIDEO = build_system_video(adult=False)` 하위 호환 alias 삭제 시 grep 으로 외부 호출자 0건 확인 절차가 명시되어 있는가?
6. Task 6 의 "기존 LTX 테스트 갱신" 별도 commit 분리 권장이 review diff 격리에 충분한가, 아니면 신규 테스트 추가 commit 과 묶는 게 더 안전한가?

---

## 13. v1.1 반영 자취 (Codex review 1라운드 자취)

| Finding | 원본 (Codex 인용) | v1.1 반영 |
|---------|-------------------|-----------|
| **High 1** | "model_id default를 'ltx'로 두는 설계가 현재 기본 모델과 충돌해. 현재 앱 기본은 `DEFAULT_VIDEO_MODEL_ID = 'wan22'`인데, 스펙은 `build_system_video(..., model_id='ltx')`를 제안하고 있어." | `build_system_video(*, adult, model_id)` keyword-only required 로 변경. `upgrade_video_prompt` / `run_video_pipeline` 도 동일 정책. §2 결정 8 + §5.2 + R4 해소 |
| **High 2** | "테스트 계획이 model_id 전파를 한 단계 부족하게 잡고 있어. 실제 핵심은 `_run_video_pipeline_task -> run_video_pipeline -> upgrade_video_prompt`까지 안 끊기는지야." | 신규 테스트 7 (`test_run_video_pipeline_propagates_model_id_to_upgrade`) + 8 (`test_run_video_pipeline_task_propagates_model_id`) 추가. §3.3 테이블 갱신 |
| **Medium 3** | "변경 파일 목록에 facade export가 빠졌어. `vision_pipeline/__init__.py`, `prompt_pipeline/__init__.py`도 같이 업데이트해야 안정적으로 import/test 할 수 있어." | §3.1 에 facade 파일 2개 추가 (변경 파일 5 → 7). Task 1·3 에 re-export 명시 |
| **Medium 4** | "공통 `SYSTEM_VIDEO_RULES`에는 여전히 `Avoid cartoon / game / childish aesthetics.`가 마지막에 붙어. 사용자가 anime/game 스타일을 명시하면 서로 충돌할 수 있어. 'unless explicitly requested'로 바꾸는 게 맞아." | §5.1 신설 — `SYSTEM_VIDEO_RULES` 보강 코드. Task 4 신규 + 시나리오 E 신규 + R7 신규 |
| **Low 5** | "테스트 경로와 개수는 문서가 현재 구조랑 안 맞아. `backend/tests/studio/test_video_pipeline.py`야. 534 -> 540, vitest 280 같은 절대 숫자도 목표 표현으로 바꾸는 게 안전해." | §3.3 경로 수정 (`backend/tests/studio/`) + §8.1 "절대 숫자 → 변화량 (+8 신규 PASS · regression 0)" 표현 |

**v1.1 추가 보강 (Codex 권장 외)**:
- R6 신규 — Wan 의 finger 회피 rule 을 *positive instruction* 으로 재작성
- 시나리오 E 신규 — anime/cartoon 명시 요청 검증
- F7 / F8 신규 — v1.2 후속 조정 후보 박제

---

**한 줄 요약 (v1.1)**: 영상 모드 1단계 비전이 generic caption 그대로, 2단계 gemma4 가 LTX 전용 → Wan 2.2 default 인데 LTX prompt 받는 mismatch. B 옵션 v1.1 은 (1) `VIDEO_VISION_SYSTEM` 으로 영상용 5-label 분석, (2) `build_system_video(*, model_id)` keyword-only required 분기 (Codex Finding 1 해소), (3) 3단 전파 검증 (Finding 2), (4) facade re-export (Finding 3), (5) cartoon rule user override (Finding 4), (6) 테스트 경로 + 변화량 표현 (Finding 5). 신규 테스트 8개 + dogfooding 5 시나리오 + regression 0.
