# Video 비전 파이프라인 영상-특화 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 영상 모드 1단계 비전 분석을 영상 전용 5-label system prompt 로 교체하고, 2단계 gemma4 를 Wan 2.2 / LTX 2.3 모델별로 분기해서 i2v 첫 프레임 anchor 와 모션 자연스러움 동시 개선.

**Architecture:** (1) `VIDEO_VISION_SYSTEM` 신규 — qwen3-vl 한테 5 라벨 (ANCHOR / MOTION CUES / ENVIRONMENT DYNAMICS / CAMERA POTENTIAL / MOOD) 영상용 분석 지시. (2) `build_system_video(*, adult, model_id)` keyword-only required 시그니처로 분기 — `"wan22"` 는 `SYSTEM_VIDEO_WAN22_BASE` (50-80 단어 concise + umT5 친화), `"ltx"` 는 기존 `SYSTEM_VIDEO_BASE` (60-150 단어 cinematic). (3) `model_id` 가 `_run_video_pipeline_task → run_video_pipeline → upgrade_video_prompt → build_system_video` 3단 전파 (keyword-only required 라 silent 누락 차단).

**Tech Stack:** Python 3.13 · FastAPI · pytest · qwen3-vl:8b (Ollama) · gemma4-un:latest (Ollama) · Wan 2.2 i2v / LTX 2.3 (ComfyUI)

**관련 spec:** `docs/superpowers/specs/2026-05-11-video-vision-pipeline-improvement-design.md` (v1.1 · Codex review 1라운드 반영)

**Phase 전략 (Pro 토큰 절약):** 5 phase 로 분할. 각 phase 끝에 commit + 검증 → 다음 phase 는 새 session 에서 시작 가능. Phase 0 (준비) 와 Phase 5 (dogfooding) 는 짧음, Phase 1~4 가 실제 구현. 각 phase 의 변경은 다음 phase 가 의존하지만, 각각 *그 자체로 git 상에서 통과* (테스트 회귀 0 + lint clean).

---

## Phase 0: 준비 (~10분)

베이스라인 측정 + 브랜치 생성. 한 세션 안에서 Phase 1 까지 진행해도 무방하지만, 토큰 사정 따라 여기서 끊을 수 있게 독립 phase.

### Task 0.1: 브랜치 생성

**Files:** (없음 — git operation)

- [ ] **Step 1: master 최신화**

```bash
git checkout master
git pull origin master
git status
```

Expected: `working tree clean`, master 가 origin/master 와 일치

- [ ] **Step 2: feature 브랜치 생성**

```bash
git checkout -b feature/video-vision-pipeline-improvement
```

Expected: `Switched to a new branch 'feature/video-vision-pipeline-improvement'`

### Task 0.2: 베이스라인 측정

**Files:** (없음 — 측정만)

- [ ] **Step 3: pytest 통과 수 측정**

```bash
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q 2>&1 | tail -5
```

Expected: `XXX passed` 형태 (그 숫자를 메모해두기 — Phase 4 끝에 +8 검증용)

- [ ] **Step 4: vitest 통과 수 측정**

```bash
cd ../frontend
npm test -- --run 2>&1 | tail -5
```

Expected: `Test Files XX passed`, `Tests XXX passed` — Phase 4 끝에 변화 0 검증용

- [ ] **Step 5: 베이스라인 메모**

(메모만 — 파일 변경 없음)

```
Phase 0 baseline (2026-05-11 기록):
  pytest: ___ passed
  vitest: ___ passed
  branch: feature/video-vision-pipeline-improvement
```

---

## Phase 1: VIDEO_VISION_SYSTEM 신규 + video_pipeline 적용 (~30분)

영상 전용 5-label 비전 system prompt 추가 + `video_pipeline.py` 가 이걸 사용하도록 변경 + 비전 온도 0.2.

### Task 1.1: VIDEO_VISION_SYSTEM 상수 추가

**Files:**
- Modify: `backend/studio/vision_pipeline/_common.py` (line 41-45 직후)
- Modify: `backend/studio/vision_pipeline/__init__.py` (facade re-export)

- [ ] **Step 1: 실패 테스트 작성**

신규 파일 `backend/tests/studio/test_video_vision_system.py`:

```python
"""VIDEO_VISION_SYSTEM 상수의 5 라벨 존재 + 영상 분석 의도 검증.

spec v1.1 §3.3 Task 1 — i2v 영상용 비전 system 의 5 섹션
(ANCHOR / MOTION CUES / ENVIRONMENT DYNAMICS / CAMERA POTENTIAL / MOOD)
이 정확히 포함되어 있어야 함.
"""

from __future__ import annotations


def test_video_vision_system_has_5_labels() -> None:
    """VIDEO_VISION_SYSTEM 안에 5 라벨 모두 verbatim 존재."""
    # facade re-export 경유 import
    from studio.vision_pipeline import VIDEO_VISION_SYSTEM

    for label in (
        "[ANCHOR]",
        "[MOTION CUES]",
        "[ENVIRONMENT DYNAMICS]",
        "[CAMERA POTENTIAL]",
        "[MOOD]",
    ):
        assert label in VIDEO_VISION_SYSTEM, f"라벨 누락: {label}"


def test_video_vision_system_mentions_i2v_goal() -> None:
    """i2v · 5-second clip · first frame 등 영상 분석 의도 키워드 포함."""
    from studio.vision_pipeline import VIDEO_VISION_SYSTEM

    for keyword in ("i2v", "first frame", "5-second"):
        assert keyword in VIDEO_VISION_SYSTEM, f"의도 키워드 누락: {keyword}"
```

- [ ] **Step 2: 테스트 실행 (FAIL 확인)**

```bash
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_vision_system.py -v
```

Expected: FAIL with `ImportError: cannot import name 'VIDEO_VISION_SYSTEM'`

- [ ] **Step 3: 상수 추가**

`backend/studio/vision_pipeline/_common.py` 의 `VISION_SYSTEM` (line 41-45) **바로 아래에** 추가:

```python
# Video i2v 전용 비전 system (spec 2026-05-11 v1.1).
# 일반 캡션 VISION_SYSTEM 과 별개로, 영상 생성에 필요한 5 섹션을 라벨 형식으로 출력.
# downstream gemma4 (SYSTEM_VIDEO_BASE / SYSTEM_VIDEO_WAN22_BASE) 가 그대로 흡수.
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

- [ ] **Step 4: facade re-export**

`backend/studio/vision_pipeline/__init__.py` 의 `from ._common import (...)` 블록 (line 34-43) 안에 `VIDEO_VISION_SYSTEM` 추가:

```python
from ._common import (  # noqa: F401
    DEFAULT_TIMEOUT,
    ProgressCallback,
    VIDEO_VISION_SYSTEM,  # NEW (2026-05-11 · i2v 영상 전용)
    VISION_SYSTEM,
    _DEFAULT_OLLAMA_URL,
    _aspect_label,
    _describe_image,
    _to_base64,
    log,
)
```

같은 파일의 `__all__` 리스트에도 추가 (line 92 영역):

```python
__all__ = [
    # _common
    "DEFAULT_TIMEOUT",
    "ProgressCallback",
    "VIDEO_VISION_SYSTEM",  # NEW
    "VISION_SYSTEM",
    # ... (이하 기존 그대로)
```

- [ ] **Step 5: 테스트 실행 (PASS 확인)**

```bash
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_vision_system.py -v
```

Expected: 2 passed

### Task 1.2: video_pipeline.py 가 VIDEO_VISION_SYSTEM + temp 0.2 사용

**Files:**
- Modify: `backend/studio/video_pipeline.py` (line 74-79)
- Add tests: `backend/tests/studio/test_video_pipeline_uses_video_vision_system.py`

- [ ] **Step 6: 실패 테스트 작성**

신규 파일 `backend/tests/studio/test_video_pipeline_uses_video_vision_system.py`:

```python
"""run_video_pipeline 이 _describe_image 를 VIDEO_VISION_SYSTEM + temp 0.2 로 호출하는지 검증.

spec v1.1 §3.3 Task 2,3 — mock 으로 _describe_image 호출 kwargs 확인.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_video_pipeline_uses_video_vision_system() -> None:
    """run_video_pipeline 이 system_prompt=VIDEO_VISION_SYSTEM 으로 호출."""
    from studio.video_pipeline import run_video_pipeline
    from studio.vision_pipeline import VIDEO_VISION_SYSTEM

    # _describe_image 와 upgrade_video_prompt 둘 다 mock
    with (
        patch(
            "studio.video_pipeline._describe_image",
            new=AsyncMock(return_value="[ANCHOR] ... [MOOD] ..."),
        ) as describe_mock,
        patch(
            "studio.video_pipeline.upgrade_video_prompt",
            new=AsyncMock(),
        ) as upgrade_mock,
        patch(
            "studio.video_pipeline.ollama_unload.unload_model",
            new=AsyncMock(),
        ),
    ):
        # 빈 UpgradeResult mock 반환
        from studio.prompt_pipeline import UpgradeResult

        upgrade_mock.return_value = UpgradeResult(
            upgraded="x", fallback=False, provider="test", original="x"
        )

        await run_video_pipeline(
            image_path=b"fake-image-bytes",
            user_direction="test direction",
            model_id="wan22",
        )

    # _describe_image 호출 인자 검증
    call_kwargs = describe_mock.call_args.kwargs
    assert call_kwargs["system_prompt"] == VIDEO_VISION_SYSTEM, (
        "video_pipeline 이 VIDEO_VISION_SYSTEM 을 system_prompt 로 안 넘김"
    )


@pytest.mark.asyncio
async def test_video_pipeline_uses_temperature_0_2() -> None:
    """run_video_pipeline 이 _describe_image 를 temperature=0.2 로 호출."""
    from studio.video_pipeline import run_video_pipeline

    with (
        patch(
            "studio.video_pipeline._describe_image",
            new=AsyncMock(return_value="[ANCHOR] ... [MOOD] ..."),
        ) as describe_mock,
        patch(
            "studio.video_pipeline.upgrade_video_prompt",
            new=AsyncMock(),
        ) as upgrade_mock,
        patch(
            "studio.video_pipeline.ollama_unload.unload_model",
            new=AsyncMock(),
        ),
    ):
        from studio.prompt_pipeline import UpgradeResult

        upgrade_mock.return_value = UpgradeResult(
            upgraded="x", fallback=False, provider="test", original="x"
        )

        await run_video_pipeline(
            image_path=b"fake",
            user_direction="x",
            model_id="wan22",
        )

    call_kwargs = describe_mock.call_args.kwargs
    assert call_kwargs["temperature"] == 0.2, (
        f"video_pipeline 이 temperature=0.2 로 안 부름 (실제: {call_kwargs.get('temperature')})"
    )
```

- [ ] **Step 7: 테스트 실행 (FAIL 확인)**

```bash
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline_uses_video_vision_system.py -v
```

Expected: 2 failed (model_id keyword-only 가 아직 없음 + system_prompt/temperature 가 기존 default 사용)

> **참고**: 이 테스트는 Phase 3 의 `run_video_pipeline(*, model_id)` 시그니처 변경 후에야 정상 통과. 이 phase 에서는 우선 `_describe_image` 호출 인자만 변경하고, **`model_id` 파라미터는 Phase 4 에서 추가**. 따라서 Step 7 의 테스트 실행은 *Phase 4 이후* 로 미룰 수 있음 — Phase 1 의 GREEN 은 `VIDEO_VISION_SYSTEM` 사용 + temp 0.2 만 확인. 자세한 게이트는 Step 9.

- [ ] **Step 8: video_pipeline.py 변경**

`backend/studio/video_pipeline.py` line 22-29 (import 블록) 에서 `VIDEO_VISION_SYSTEM` 추가:

```python
from .vision_pipeline import VIDEO_VISION_SYSTEM, _describe_image  # 기존 비전 헬퍼 재사용
```

같은 파일 line 74-79 (`_describe_image` 호출부) 를 변경:

**Before:**
```python
    description = await _describe_image(
        image_path,
        vision_model=resolved_vision,
        timeout=timeout,
        ollama_url=resolved_url,
    )
```

**After:**
```python
    description = await _describe_image(
        image_path,
        vision_model=resolved_vision,
        timeout=timeout,
        ollama_url=resolved_url,
        system_prompt=VIDEO_VISION_SYSTEM,  # spec 2026-05-11 v1.1 · i2v 영상 전용
        temperature=0.2,                    # i2v anchor 일관성 (기존 0.4 → 0.2)
    )
```

- [ ] **Step 9: Phase 1 GREEN 게이트 확인**

Phase 4 의 `model_id` keyword-only required 가 아직 안 들어왔으므로, 이 phase 끝에서는 다음 두 *부분 검증* 만 수행:

```bash
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_vision_system.py -v
```

Expected: 2 passed (라벨 + 의도 검증)

```bash
# video_pipeline.py 의 _describe_image 호출에 VIDEO_VISION_SYSTEM 이 들어갔는지 grep
grep -n "VIDEO_VISION_SYSTEM" backend/studio/video_pipeline.py
grep -n "temperature=0.2" backend/studio/video_pipeline.py
```

Expected: 각각 1줄 이상 매치

> **`test_video_pipeline_uses_video_vision_system.py` 의 2 테스트는 Phase 4 종료 후 PASS** — 그때 다시 실행. 지금은 *작성만* 하고 SKIP 또는 xfail 마커는 붙이지 않음 (Phase 4 끝에서 추가 작업 없이 자동 PASS 되게).

- [ ] **Step 10: 전체 pytest 회귀 확인**

```bash
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q 2>&1 | tail -5
```

Expected: Phase 0 베이스라인 + 2 (라벨/의도) — `test_video_pipeline_uses_video_vision_system.py` 의 2 는 Phase 4 까지 FAIL.

> **수용 가능한 transient FAIL**: 2개 (`test_video_pipeline_uses_video_vision_system` + `test_video_pipeline_uses_temperature_0_2`) — Phase 4 끝에서 해소.

### Task 1.3: Phase 1 commit

- [ ] **Step 11: 변경 파일 staging**

```bash
git add backend/studio/vision_pipeline/_common.py
git add backend/studio/vision_pipeline/__init__.py
git add backend/studio/video_pipeline.py
git add backend/tests/studio/test_video_vision_system.py
git add backend/tests/studio/test_video_pipeline_uses_video_vision_system.py
git status
```

Expected: 5 파일 staged · untracked 없음

- [ ] **Step 12: commit**

```bash
git commit -m "feat(video-vision): VIDEO_VISION_SYSTEM 신규 + temperature 0.2

영상 모드 1단계 비전 분석을 일반 캡션 VISION_SYSTEM → i2v 전용
VIDEO_VISION_SYSTEM 으로 교체. 5 라벨 형식 (ANCHOR / MOTION CUES /
ENVIRONMENT DYNAMICS / CAMERA POTENTIAL / MOOD) 으로 첫 프레임
anchor + 잠재 모션 단서 동시 추출.

- vision_pipeline/_common.py: VIDEO_VISION_SYSTEM 상수 추가
- vision_pipeline/__init__.py: facade re-export
- video_pipeline.py: _describe_image 호출 시 system_prompt + temp 0.2
- 테스트 4건 (2 PASS · 2 deferred — Phase 4 종료 후 PASS)

spec: docs/superpowers/specs/2026-05-11-video-vision-pipeline-improvement-design.md (v1.1)"
```

---

## Phase 2: SYSTEM_VIDEO_WAN22_BASE + RULES override 보강 (~25분)

Wan 2.2 전용 gemma4 system prompt 추가 + 공통 RULES 의 "Avoid cartoon" 을 user override 허용으로 보강. 아직 `build_system_video` 분기 로직 X — Phase 3 에서.

### Task 2.1: SYSTEM_VIDEO_WAN22_BASE 상수 + RULES 수정

**Files:**
- Modify: `backend/studio/prompt_pipeline/upgrade.py` (line 314-388)
- Modify: `backend/studio/prompt_pipeline/__init__.py` (facade re-export)

- [ ] **Step 1: 실패 테스트 작성**

신규 파일 `backend/tests/studio/test_system_video_wan22_base.py`:

```python
"""SYSTEM_VIDEO_WAN22_BASE 상수 + SYSTEM_VIDEO_RULES override 검증.

spec v1.1 §5 + Codex Finding 4 — Wan 2.2 전용 gemma4 system prompt +
cartoon avoidance 의 user override 절 확인.
"""

from __future__ import annotations


def test_system_video_wan22_base_targets_wan() -> None:
    """SYSTEM_VIDEO_WAN22_BASE 가 Wan 2.2 + 16fps + umT5 명시."""
    from studio.prompt_pipeline import SYSTEM_VIDEO_WAN22_BASE

    for keyword in ("Wan 2.2", "16fps", "umT5"):
        assert keyword in SYSTEM_VIDEO_WAN22_BASE, f"키워드 누락: {keyword}"


def test_system_video_wan22_base_specifies_word_count() -> None:
    """50-80 단어 제약 명시."""
    from studio.prompt_pipeline import SYSTEM_VIDEO_WAN22_BASE

    assert "50-80 words" in SYSTEM_VIDEO_WAN22_BASE


def test_system_video_wan22_base_uses_positive_hand_instruction() -> None:
    """Codex Finding 5 보강 — 'hands remain still' 같은 positive instruction.

    부정형 'Avoid complex finger' 가 *없고*, 'hands remain still' 류가
    *있어야* 함 (negative-prompt-effect 회피).
    """
    from studio.prompt_pipeline import SYSTEM_VIDEO_WAN22_BASE

    assert "hands remain still" in SYSTEM_VIDEO_WAN22_BASE or (
        "hands stay" in SYSTEM_VIDEO_WAN22_BASE
    ), "positive hand instruction 누락"


def test_system_video_rules_allows_explicit_style_override() -> None:
    """Codex Finding 4 — 'unless explicitly requested' 보강 확인."""
    from studio.prompt_pipeline.upgrade import SYSTEM_VIDEO_RULES

    assert "unless the user" in SYSTEM_VIDEO_RULES, (
        "SYSTEM_VIDEO_RULES 에 user override 절 누락"
    )
    assert "explicitly requests" in SYSTEM_VIDEO_RULES
```

- [ ] **Step 2: 테스트 실행 (FAIL 확인)**

```bash
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_system_video_wan22_base.py -v
```

Expected: 4 failed (`ImportError: cannot import name 'SYSTEM_VIDEO_WAN22_BASE'` + RULES 검증 fail)

- [ ] **Step 3: SYSTEM_VIDEO_WAN22_BASE 추가**

`backend/studio/prompt_pipeline/upgrade.py` 의 `SYSTEM_VIDEO_BASE` 마지막 줄 (line 360 = `as a soft preservation hint."""`) **바로 아래에** 추가:

```python


# ══════════════════════════════════════════════════════════════════════
# Wan 2.2 i2v 전용 gemma4 system prompt (spec 2026-05-11 v1.1)
# ══════════════════════════════════════════════════════════════════════
# umT5 (T5 계열) 텍스트 인코더는 60-150 단어 cinematic paragraph 보다
# 50-80 단어 concise prompt 를 더 잘 처리 (학습 분포 일치).
# Codex Finding 5 (v1.1) — 부정형 finger 회피 rule 은 negative-prompt-effect
# 위험 → positive instruction ("hands remain still") 로 재작성.
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
- Prefer simple hand poses. If the reference image has clear hand
  detail, use phrases like "hands remain still" or "hands stay in their
  pose" rather than describing intricate movement. Describe what hands
  DO naturally instead of negating their motion.
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

- [ ] **Step 4: SYSTEM_VIDEO_RULES 수정**

같은 파일의 `SYSTEM_VIDEO_RULES` (line 373-379) 를 교체:

**Before:**
```python
SYSTEM_VIDEO_RULES = """

RULES:
- Output ONLY the final English paragraph — no preamble, no bullets, no markdown.
- Avoid cartoon / game / childish aesthetics.
- If the user wrote Korean, translate intent to English.
- Never repeat phrases (except the identity clause above, which is required)."""
```

**After:**
```python
SYSTEM_VIDEO_RULES = """

RULES:
- Output ONLY the final English paragraph — no preamble, no bullets, no markdown.
- Avoid cartoon / game / childish aesthetics unless the user explicitly
  requests such a style (e.g. "anime style", "pixel art", "cartoon look",
  "game cinematic"). In that case, the user direction dominates and the
  avoidance rule is waived.
- If the user wrote Korean, translate intent to English.
- Never repeat phrases (except the identity clause above, which is required)."""
```

- [ ] **Step 5: facade re-export**

`backend/studio/prompt_pipeline/__init__.py` 의 import 블록에서 `upgrade` 모듈로부터 가져오는 라인에 `SYSTEM_VIDEO_WAN22_BASE` 추가. 정확한 위치는 기존 `SYSTEM_VIDEO` 또는 `SYSTEM_VIDEO_BASE` import 옆:

```python
from .upgrade import (  # noqa: F401
    # ... 기존 항목 ...
    SYSTEM_VIDEO_BASE,
    SYSTEM_VIDEO_WAN22_BASE,  # NEW (2026-05-11 · Wan 2.2 전용)
    SYSTEM_VIDEO_RULES,
    # ... 기존 항목 ...
)
```

(주의: 기존 `__init__.py` 의 정확한 import 구조는 Step 5-A 에서 먼저 확인)

- [ ] **Step 5-A: 기존 __init__.py 확인 후 추가**

```bash
grep -n "SYSTEM_VIDEO" backend/studio/prompt_pipeline/__init__.py
```

Expected: 기존 `SYSTEM_VIDEO_BASE` 또는 `SYSTEM_VIDEO` 가 이미 re-export 되어 있음 — 그 라인 옆에 `SYSTEM_VIDEO_WAN22_BASE` 한 줄 추가. 만약 `__all__` 리스트가 있으면 거기에도 추가.

(없으면 신규 import 블록 추가)

- [ ] **Step 6: 테스트 실행 (PASS 확인)**

```bash
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_system_video_wan22_base.py -v
```

Expected: 4 passed

- [ ] **Step 7: 전체 pytest 회귀**

```bash
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q 2>&1 | tail -5
```

Expected: Phase 0 베이스라인 + 6 (라벨 2 + Wan22 4) — 여전히 2 transient FAIL (Phase 1 의 video_pipeline 테스트).

### Task 2.2: Phase 2 commit

- [ ] **Step 8: commit**

```bash
git add backend/studio/prompt_pipeline/upgrade.py
git add backend/studio/prompt_pipeline/__init__.py
git add backend/tests/studio/test_system_video_wan22_base.py
git commit -m "feat(video-vision): SYSTEM_VIDEO_WAN22_BASE + RULES override 보강

Wan 2.2 i2v 전용 gemma4 system prompt 신규 (50-80 단어 concise ·
umT5 친화). 공통 SYSTEM_VIDEO_RULES 의 cartoon avoidance 를 user
explicit override 허용으로 보강 (Codex Finding 4).

- prompt_pipeline/upgrade.py: SYSTEM_VIDEO_WAN22_BASE 신규
- prompt_pipeline/upgrade.py: SYSTEM_VIDEO_RULES \"unless explicitly requested\" 보강
- prompt_pipeline/__init__.py: facade re-export
- 테스트 4건 (PASS · positive hand instruction + style override 검증 포함)

spec: docs/superpowers/specs/2026-05-11-video-vision-pipeline-improvement-design.md (v1.1)"
```

---

## Phase 3: build_system_video keyword-only required + 분기 (~25분)

`build_system_video` 시그니처를 keyword-only required 로 변경 + `model_id` 분기 로직 추가. `upgrade_video_prompt` 도 동일 정책.

### Task 3.1: build_system_video keyword-only + 분기

**Files:**
- Modify: `backend/studio/prompt_pipeline/upgrade.py` (line 382-392)

- [ ] **Step 1: 실패 테스트 작성**

신규 파일 `backend/tests/studio/test_build_system_video_dispatch.py`:

```python
"""build_system_video model_id 분기 + keyword-only required 검증.

spec v1.1 §5.2 + Codex Finding 1 — silent Wan→LTX prompt 사고 차단.
"""

from __future__ import annotations

import pytest


def test_build_system_video_dispatches_wan22() -> None:
    """model_id='wan22' 시 SYSTEM_VIDEO_WAN22_BASE 키워드 포함."""
    from studio.prompt_pipeline.upgrade import build_system_video

    result = build_system_video(adult=False, model_id="wan22")
    assert "Wan 2.2" in result
    assert "16fps" in result
    assert "50-80 words" in result


def test_build_system_video_dispatches_ltx() -> None:
    """model_id='ltx' 시 LTX cinematic 키워드 포함."""
    from studio.prompt_pipeline.upgrade import build_system_video

    result = build_system_video(adult=False, model_id="ltx")
    assert "LTX-2.3" in result
    assert "60-150 words" in result


def test_build_system_video_rejects_missing_model_id() -> None:
    """model_id 누락 시 TypeError — keyword-only required 보장.

    Codex Finding 1 — 누락 호출자가 silent 로 LTX prompt 받지 않도록.
    """
    from studio.prompt_pipeline.upgrade import build_system_video

    with pytest.raises(TypeError):
        build_system_video(adult=False)  # type: ignore[call-arg]


def test_build_system_video_rejects_unknown_model_id() -> None:
    """알 수 없는 model_id 는 ValueError."""
    from studio.prompt_pipeline.upgrade import build_system_video

    with pytest.raises(ValueError, match="unknown video model_id"):
        build_system_video(adult=False, model_id="unknown")  # type: ignore[arg-type]


def test_build_system_video_includes_adult_clause_when_adult() -> None:
    """adult=True 시 NSFW clause 포함 (양 모델 공통)."""
    from studio.prompt_pipeline.upgrade import build_system_video

    wan_result = build_system_video(adult=True, model_id="wan22")
    ltx_result = build_system_video(adult=True, model_id="ltx")

    # SYSTEM_VIDEO_ADULT_CLAUSE 의 핵심 문구
    assert "ADULT MODE" in wan_result
    assert "ADULT MODE" in ltx_result
```

- [ ] **Step 2: 테스트 실행 (FAIL 확인)**

```bash
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_build_system_video_dispatch.py -v
```

Expected: 5 failed (현재 `build_system_video(adult=False)` 는 default 있음 + Wan 분기 없음 + unknown 검증 없음)

- [ ] **Step 3: build_system_video 시그니처 변경**

`backend/studio/prompt_pipeline/upgrade.py` line 382-392 를 교체:

**Before:**
```python
def build_system_video(adult: bool = False) -> str:
    """Video 시스템 프롬프트 구성. adult=True 면 NSFW clause 주입."""
    return (
        SYSTEM_VIDEO_BASE
        + (SYSTEM_VIDEO_ADULT_CLAUSE if adult else "")
        + SYSTEM_VIDEO_RULES
    )


# 하위 호환: SYSTEM_VIDEO 레퍼런스 유지 (adult=False 기본값).
SYSTEM_VIDEO = build_system_video(adult=False)
```

**After:**
```python
# VideoModelId 는 presets.py 의 Literal 과 동일 — 순환 import 회피 위해 string 만 검사.
# 실 타입 체크는 호출자 (pipelines/video.py) 가 VideoModelId 로 받아 전달.
def build_system_video(*, adult: bool, model_id: str) -> str:
    """Video 시스템 프롬프트 구성 (spec 2026-05-11 v1.1).

    Codex Finding 1 (v1.1) — keyword-only required.
    기존 `model_id="ltx"` default 가 `DEFAULT_VIDEO_MODEL_ID="wan22"` 와
    충돌해 silent Wan→LTX prompt 사고 위험. default 제거 + keyword-only 로
    누락 호출자를 TypeError 즉시 노출.

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


# 기존 `SYSTEM_VIDEO = build_system_video(adult=False)` 하위 호환 alias 제거됨
# (v1.1 · spec §5.2). 외부 호출자 grep 결과 0건 확인 후 안전 제거.
```

- [ ] **Step 4: 외부 호출자 grep 확인**

```bash
grep -rn "SYSTEM_VIDEO\b" backend/ --include="*.py" | grep -v "test_" | grep -v "SYSTEM_VIDEO_"
```

Expected: 결과 0건 (module-level alias `SYSTEM_VIDEO` 단독 참조 없음). 만약 매치가 있으면 그 호출자도 같이 갱신 필요.

> **만약 매치 발견 시**: 해당 파일에서 `SYSTEM_VIDEO` → `build_system_video(adult=False, model_id="ltx")` 로 갱신. LTX 가 기존 default 였으므로 "ltx" 로 보존.

- [ ] **Step 5: 테스트 실행 (PASS 확인)**

```bash
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_build_system_video_dispatch.py -v
```

Expected: 5 passed

### Task 3.2: upgrade_video_prompt 시그니처 변경

**Files:**
- Modify: `backend/studio/prompt_pipeline/upgrade.py` (line 763-807)

- [ ] **Step 6: upgrade_video_prompt 변경**

`backend/studio/prompt_pipeline/upgrade.py` 의 `upgrade_video_prompt` 함수 시그니처 (line 763-773) 변경:

**Before:**
```python
async def upgrade_video_prompt(
    user_direction: str,
    image_description: str,
    model: str = "gemma4-un:latest",
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    include_translation: bool = True,
    adult: bool = False,
    *,
    prompt_mode: PromptEnhanceMode | str | None = "fast",
) -> UpgradeResult:
```

**After:**
```python
async def upgrade_video_prompt(
    user_direction: str,
    image_description: str,
    *,
    model_id: str,  # spec 2026-05-11 v1.1 · keyword-only required (Codex Finding 1)
    model: str = "gemma4-un:latest",
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    include_translation: bool = True,
    adult: bool = False,
    prompt_mode: PromptEnhanceMode | str | None = "fast",
) -> UpgradeResult:
```

같은 함수의 `build_system_video` 호출부 (line 798) 변경:

**Before:**
```python
        system=build_system_video(adult=adult),
```

**After:**
```python
        system=build_system_video(adult=adult, model_id=model_id),
```

- [ ] **Step 7: 기존 LTX 테스트 갱신**

`backend/tests/studio/test_prompt_pipeline.py` 의 `upgrade_video_prompt` 호출하는 모든 테스트에 `model_id="ltx"` 명시 추가:

```bash
grep -n "upgrade_video_prompt(" backend/tests/studio/test_prompt_pipeline.py
```

각 매치 위치를 확인하고, `upgrade_video_prompt(` 호출 인자에 `model_id="ltx"` 추가 (keyword-only 이므로 순서 무관).

예시 변경:

**Before:**
```python
result = await upgrade_video_prompt(
    user_direction="walk forward",
    image_description="A person standing",
)
```

**After:**
```python
result = await upgrade_video_prompt(
    user_direction="walk forward",
    image_description="A person standing",
    model_id="ltx",  # 기존 LTX 동작 보존 (v1.1)
)
```

- [ ] **Step 8: 기존 LTX 테스트 회귀 확인**

```bash
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_prompt_pipeline.py -v
```

Expected: 모든 테스트 PASS (기존 LTX 동작 보존)

- [ ] **Step 9: 전체 pytest 회귀**

```bash
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q 2>&1 | tail -5
```

Expected: Phase 0 베이스라인 + 11 (라벨 2 + Wan22 4 + dispatch 5) — 여전히 2 transient FAIL (Phase 1 video_pipeline 테스트, `run_video_pipeline` 에 `model_id` 없음).

### Task 3.3: Phase 3 commit

- [ ] **Step 10: commit**

```bash
git add backend/studio/prompt_pipeline/upgrade.py
git add backend/tests/studio/test_build_system_video_dispatch.py
git add backend/tests/studio/test_prompt_pipeline.py
git commit -m "refactor(video-vision): build_system_video model_id keyword-only required

build_system_video / upgrade_video_prompt 시그니처를 keyword-only
required 로 변경. 누락 호출자는 TypeError 로 즉시 노출 (Codex Finding 1).
silent Wan→LTX prompt 사고 차단.

- build_system_video(*, adult, model_id) — default 제거
- upgrade_video_prompt(*, model_id, ...) — keyword-only required
- model_id='wan22' / 'ltx' 분기 + unknown → ValueError
- 기존 SYSTEM_VIDEO module-level alias 제거 (외부 호출자 0건 확인)
- 기존 LTX 테스트 → model_id='ltx' 명시 추가 (회귀 보존)
- 신규 테스트 5건 (dispatch wan22/ltx + missing/unknown + adult clause)

spec: docs/superpowers/specs/2026-05-11-video-vision-pipeline-improvement-design.md (v1.1)"
```

---

## Phase 4: 3단 전파 (task → pipeline → upgrade) (~30분)

`_run_video_pipeline_task → run_video_pipeline → upgrade_video_prompt → build_system_video` 까지 `model_id` 가 끊김 없이 전파되도록 + 전파 검증 테스트 2개.

### Task 4.1: run_video_pipeline 시그니처 + 호출부

**Files:**
- Modify: `backend/studio/video_pipeline.py` (line 48-58 시그니처 + line 92-100 호출부)

- [ ] **Step 1: 실패 테스트 작성**

신규 파일 `backend/tests/studio/test_video_pipeline_model_id_propagation.py`:

```python
"""model_id 3단 전파 검증 (Codex Finding 2 — High).

_run_video_pipeline_task → run_video_pipeline → upgrade_video_prompt
까지 model_id 가 끊김 없이 전파되는지 mock 으로 검증.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_run_video_pipeline_propagates_model_id_to_upgrade() -> None:
    """run_video_pipeline(model_id='wan22') → upgrade_video_prompt(model_id='wan22')."""
    from studio.prompt_pipeline import UpgradeResult
    from studio.video_pipeline import run_video_pipeline

    with (
        patch(
            "studio.video_pipeline._describe_image",
            new=AsyncMock(return_value="[ANCHOR] desc"),
        ),
        patch(
            "studio.video_pipeline.upgrade_video_prompt",
            new=AsyncMock(),
        ) as upgrade_mock,
        patch(
            "studio.video_pipeline.ollama_unload.unload_model",
            new=AsyncMock(),
        ),
    ):
        upgrade_mock.return_value = UpgradeResult(
            upgraded="x", fallback=False, provider="test", original="x"
        )

        await run_video_pipeline(
            image_path=b"fake",
            user_direction="x",
            model_id="wan22",
        )

    # upgrade_video_prompt 호출 인자에 model_id='wan22' 포함 확인
    kwargs = upgrade_mock.call_args.kwargs
    assert kwargs.get("model_id") == "wan22", (
        f"upgrade_video_prompt 에 model_id='wan22' 안 전달됨 "
        f"(실제 kwargs: {kwargs})"
    )


@pytest.mark.asyncio
async def test_run_video_pipeline_propagates_ltx_model_id() -> None:
    """동일 검증 — model_id='ltx' 분기 보존."""
    from studio.prompt_pipeline import UpgradeResult
    from studio.video_pipeline import run_video_pipeline

    with (
        patch(
            "studio.video_pipeline._describe_image",
            new=AsyncMock(return_value="[ANCHOR] desc"),
        ),
        patch(
            "studio.video_pipeline.upgrade_video_prompt",
            new=AsyncMock(),
        ) as upgrade_mock,
        patch(
            "studio.video_pipeline.ollama_unload.unload_model",
            new=AsyncMock(),
        ),
    ):
        upgrade_mock.return_value = UpgradeResult(
            upgraded="x", fallback=False, provider="test", original="x"
        )

        await run_video_pipeline(
            image_path=b"fake",
            user_direction="x",
            model_id="ltx",
        )

    kwargs = upgrade_mock.call_args.kwargs
    assert kwargs.get("model_id") == "ltx"


@pytest.mark.asyncio
async def test_run_video_pipeline_rejects_missing_model_id() -> None:
    """model_id 누락 시 TypeError — keyword-only required."""
    from studio.video_pipeline import run_video_pipeline

    with pytest.raises(TypeError):
        await run_video_pipeline(  # type: ignore[call-arg]
            image_path=b"fake",
            user_direction="x",
        )
```

- [ ] **Step 2: 테스트 실행 (FAIL 확인)**

```bash
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline_model_id_propagation.py -v
```

Expected: 3 failed (`run_video_pipeline` 에 `model_id` 파라미터 없음)

- [ ] **Step 3: run_video_pipeline 시그니처 변경**

`backend/studio/video_pipeline.py` 의 `run_video_pipeline` 시그니처 (line 48-59) 변경:

**Before:**
```python
async def run_video_pipeline(
    image_path: Path | str | bytes,
    user_direction: str,
    vision_model: str | None = None,
    text_model: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    adult: bool = False,
    *,
    # Phase 2 (2026-05-01) — gemma4 보강 모드 ("fast" | "precise") · upgrade 단계로 패스스루.
    prompt_mode: str = "fast",
) -> VideoPipelineResult:
```

**After:**
```python
async def run_video_pipeline(
    image_path: Path | str | bytes,
    user_direction: str,
    *,
    model_id: str,  # spec 2026-05-11 v1.1 · keyword-only required (Codex Finding 1+2)
    vision_model: str | None = None,
    text_model: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    adult: bool = False,
    # Phase 2 (2026-05-01) — gemma4 보강 모드 ("fast" | "precise") · upgrade 단계로 패스스루.
    prompt_mode: str = "fast",
) -> VideoPipelineResult:
```

- [ ] **Step 4: upgrade_video_prompt 호출에 model_id 전달**

같은 파일의 `upgrade_video_prompt` 호출부 (line 92-100):

**Before:**
```python
    upgrade = await upgrade_video_prompt(
        user_direction=user_direction,
        image_description=description,
        model=resolved_text,
        timeout=timeout,
        ollama_url=resolved_url,
        adult=adult,
        prompt_mode=prompt_mode,
    )
```

**After:**
```python
    upgrade = await upgrade_video_prompt(
        user_direction=user_direction,
        image_description=description,
        model_id=model_id,  # 3단 전파 (spec v1.1 Codex Finding 2)
        model=resolved_text,
        timeout=timeout,
        ollama_url=resolved_url,
        adult=adult,
        prompt_mode=prompt_mode,
    )
```

- [ ] **Step 5: 테스트 실행 (PASS 확인)**

```bash
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline_model_id_propagation.py -v
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline_uses_video_vision_system.py -v
```

Expected: 3 + 2 = **5 passed** (Phase 1 의 deferred 2개도 동시 해소)

### Task 4.2: pipelines/video.py 가 model_id 전달

**Files:**
- Modify: `backend/studio/pipelines/video.py` (line 140-148 — `run_video_pipeline` 호출부)

- [ ] **Step 6: 실패 테스트 작성**

신규 파일 `backend/tests/studio/test_run_video_pipeline_task_propagation.py`:

```python
"""_run_video_pipeline_task → run_video_pipeline 의 model_id 전파 검증.

spec v1.1 Codex Finding 2 — 3단 전파의 최상위 단.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_run_video_pipeline_task_propagates_model_id() -> None:
    """_run_video_pipeline_task(model_id='wan22') → run_video_pipeline(model_id='wan22')."""
    from studio.pipelines.video import _run_video_pipeline_task
    from studio.tasks import Task
    from studio.video_pipeline import VideoPipelineResult
    from studio.prompt_pipeline import UpgradeResult

    # Task mock — emit / close 만 검증 (실제 SSE 흐름은 비검증)
    task = Task(task_id="test-task-1")

    with (
        patch(
            "studio.pipelines.video.run_video_pipeline",
            new=AsyncMock(),
        ) as run_mock,
        patch(
            "studio.pipelines.video._dispatch_to_comfy",
            new=AsyncMock(),
        ) as dispatch_mock,
        patch(
            "studio.pipelines.video._save_comfy_video",
            new=AsyncMock(),
        ),
        patch(
            "studio.pipelines.video._persist_history",
            new=AsyncMock(return_value=True),
        ),
        patch(
            "studio.pipelines.video._mark_generation_complete",
        ),
    ):
        run_mock.return_value = VideoPipelineResult(
            image_description="desc",
            final_prompt="prompt",
            vision_ok=True,
            upgrade=UpgradeResult(
                upgraded="prompt", fallback=False, provider="test", original="x"
            ),
        )
        dispatch_mock.return_value = type("D", (), {
            "image_ref": "/api/files/test.mp4",
            "comfy_error": None,
        })()

        await _run_video_pipeline_task(
            task=task,
            image_bytes=b"fake",
            prompt="x",
            filename="test.png",
            model_id="wan22",
        )

    # run_video_pipeline 호출 인자에 model_id='wan22' 포함 확인
    kwargs = run_mock.call_args.kwargs
    assert kwargs.get("model_id") == "wan22", (
        f"run_video_pipeline 에 model_id='wan22' 안 전달됨 (실제: {kwargs})"
    )
```

- [ ] **Step 7: 테스트 실행 (FAIL 확인)**

```bash
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_run_video_pipeline_task_propagation.py -v
```

Expected: 1 failed (현재 pipelines/video.py 의 `run_video_pipeline` 호출에 `model_id` 없음)

- [ ] **Step 8: pipelines/video.py 호출부 변경**

`backend/studio/pipelines/video.py` 의 line 140-148 (`run_video_pipeline` 호출부) 변경:

**Before:**
```python
            async with gpu_slot("video-vision"):
                video_res = await run_video_pipeline(
                    image_bytes,
                    prompt,
                    vision_model=vision_model_override or DEFAULT_OLLAMA_ROLES.vision,
                    text_model=ollama_model_override or DEFAULT_OLLAMA_ROLES.text,
                    adult=adult,
                    prompt_mode=prompt_mode,
                )
```

**After:**
```python
            async with gpu_slot("video-vision"):
                video_res = await run_video_pipeline(
                    image_bytes,
                    prompt,
                    model_id=model_id,  # 3단 전파 (spec v1.1 Codex Finding 2)
                    vision_model=vision_model_override or DEFAULT_OLLAMA_ROLES.vision,
                    text_model=ollama_model_override or DEFAULT_OLLAMA_ROLES.text,
                    adult=adult,
                    prompt_mode=prompt_mode,
                )
```

> **확인**: `_run_video_pipeline_task` 시그니처 (line 76) 는 이미 `model_id: VideoModelId = DEFAULT_VIDEO_MODEL_ID` 보유 — 변경 불필요. 함수 내부 closure 에서 그대로 사용 가능.

- [ ] **Step 9: 테스트 실행 (PASS 확인)**

```bash
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_run_video_pipeline_task_propagation.py -v
```

Expected: 1 passed

- [ ] **Step 10: 전체 pytest 회귀**

```bash
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q 2>&1 | tail -5
```

Expected: Phase 0 베이스라인 **+ 8 신규 PASS** · 기존 regression 0

### Task 4.3: Phase 4 commit

- [ ] **Step 11: commit**

```bash
git add backend/studio/video_pipeline.py
git add backend/studio/pipelines/video.py
git add backend/tests/studio/test_video_pipeline_model_id_propagation.py
git add backend/tests/studio/test_run_video_pipeline_task_propagation.py
git commit -m "refactor(video-vision): model_id 3단 전파 (task → pipeline → upgrade)

_run_video_pipeline_task → run_video_pipeline → upgrade_video_prompt
→ build_system_video 까지 model_id 가 끊김 없이 전파되도록 keyword-only
required 정책 완성 (Codex Finding 2).

- video_pipeline.run_video_pipeline(*, model_id) — keyword-only required
- pipelines/video.py: run_video_pipeline 호출에 model_id=model_id 전달
- 전파 검증 테스트 4건 (run_video × 3 + task × 1)
- Phase 1 의 deferred 2건 (uses_video_vision_system / uses_temperature_0_2)
  동시 PASS

spec: docs/superpowers/specs/2026-05-11-video-vision-pipeline-improvement-design.md (v1.1)"
```

---

## Phase 5: 검증 + dogfooding + merge (~30분 + 사용자 시각 검증 시간)

자동 검증 통과 후 실제 영상 생성 5 시나리오로 시각 검증. 모두 OK 이면 master 머지.

### Task 5.1: 자동 검증 종합

- [ ] **Step 1: pytest 변화량 확인**

```bash
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q 2>&1 | tail -5
```

Expected: Phase 0 베이스라인 **+ 8 PASS · regression 0**

| 신규 테스트 파일 | PASS 수 |
|------------------|---------|
| `test_video_vision_system.py` | 2 |
| `test_video_pipeline_uses_video_vision_system.py` | 2 |
| `test_system_video_wan22_base.py` | 4 (그중 1개는 Phase 1 의 라벨 자체 검증으로 *Wan22 무관* — 실제 +8 안에 카운트) |
| `test_build_system_video_dispatch.py` | 5 |
| `test_video_pipeline_model_id_propagation.py` | 3 |
| `test_run_video_pipeline_task_propagation.py` | 1 |
| **합계** | **17 (그중 8 이 spec §3.3 명시 신규 + 9 가 보조 검증)** |

> **카운트 정정**: spec §3.3 의 "+8 신규" 는 *핵심 검증* 8개. 실제로는 보조 검증 (RULES override / unknown model_id / hand instruction 등) 까지 17개 추가됨. PR description 에 둘 다 명시.

- [ ] **Step 2: vitest 회귀 0**

```bash
cd ../frontend
npm test -- --run 2>&1 | tail -5
```

Expected: Phase 0 베이스라인 그대로 (frontend 변경 0)

- [ ] **Step 3: tsc + lint clean**

```bash
npx tsc --noEmit 2>&1 | tail -5
npm run lint 2>&1 | tail -5
```

Expected: 0 error (사전 error 만 있으면 베이스라인과 동일)

### Task 5.2: 시각 dogfooding (사용자 수행 — 필요 시 Claude 가 안내)

> **참고**: 이 단계는 *사용자가 직접 영상 생성 4~5건 실행* 후 결과 평가. Claude 는 결과를 받으면 spec §8.2 의 시나리오 체크리스트로 평가.

- [ ] **Step 4: 시나리오 A — Wan 2.2 default · 인물 사진**

조건:
- 영상 모델 = Wan 2.2 (default)
- 입력: 인물 사진 1장 (얼굴 + 상반신)
- prompt: "그녀가 천천히 미소짓는다" (한국어 + 단순 모션)
- adult OFF

체크:
- [ ] 첫 프레임 identity (얼굴/머리/의상) 가 원본과 일치
- [ ] 미소 모션이 자연스럽고 손가락 깨짐 없음
- [ ] 카메라 워크가 slow/subtle (jerky 없음)
- [ ] 5초 분량 안에서 prompt 가 실현됨

- [ ] **Step 5: 시나리오 B — LTX 2.3 · 인물 사진 (회귀 확인)**

조건:
- 영상 모델 = LTX 2.3 (수동 전환)
- 입력: 같은 인물 사진
- prompt: 같은 "그녀가 천천히 미소짓는다"

체크:
- [ ] 기존 LTX 결과 품질과 동등 이상 (regression 안 됨)
- [ ] cinematic paragraph 풍부 (spatial upscale 2배 디테일)
- [ ] 첫 프레임 identity 보존

- [ ] **Step 6: 시나리오 C — Wan 2.2 · 풍경/물체 사진**

조건:
- 영상 모델 = Wan 2.2
- 입력: 풍경 사진 (예: 비 오는 카페 창문, 또는 호수)
- prompt: "분위기 그대로 자연스럽게 살아 움직이게"

체크:
- [ ] ANCHOR 가 person 경로가 아닌 object/landscape 경로 작성 (VIDEO_VISION_SYSTEM 의 분기 작동)
- [ ] 환경 동적 요소 (비/물결/빛 깜빡임) 자연스럽게 반영

- [ ] **Step 7: 시나리오 D — Wan 2.2 · adult mode ON**

조건:
- 영상 모델 = Wan 2.2
- adult mode ON
- 입력: 인물 사진
- prompt: 적절한 NSFW 모션

체크:
- [ ] NSFW clause 정상 주입 (sensual/intimate 모션 반영)
- [ ] identity preservation clause 와 NSFW 충돌 없음 (얼굴 보존)

- [ ] **Step 8: 시나리오 E — anime/cartoon 명시 요청**

조건:
- 영상 모델 = Wan 2.2 (또는 LTX)
- 입력: 인물 사진
- prompt: "anime style 로 만들어줘"

체크:
- [ ] `SYSTEM_VIDEO_RULES` 의 "unless explicitly requested" 작동 → cartoon avoidance waive
- [ ] 결과 영상이 anime 스타일로 시도됨 (완벽한 anime 가 아니어도 *시도* 되면 OK)

### Task 5.3: master merge (사용자 OK 시)

- [ ] **Step 9: 최종 점검**

```bash
git status
git log --oneline master..HEAD
```

Expected: 4 commit (Phase 1~4 각 1개) · working tree clean

- [ ] **Step 10: master 로 머지**

```bash
git checkout master
git merge --no-ff feature/video-vision-pipeline-improvement -m "merge: video-vision pipeline 영상-특화 개선 (spec 2026-05-11 v1.1)

Phase 1: VIDEO_VISION_SYSTEM 신규 + temperature 0.2
Phase 2: SYSTEM_VIDEO_WAN22_BASE + RULES override
Phase 3: build_system_video model_id keyword-only required
Phase 4: model_id 3단 전파 (task → pipeline → upgrade)

검증: pytest +8 신규 (실제 +17 보조 포함) · regression 0 · vitest 0
dogfooding: 시나리오 A~E 모두 사용자 시각 검증 통과

Codex review 1라운드 5 finding 전체 반영 (spec §13 자취).
spec: docs/superpowers/specs/2026-05-11-video-vision-pipeline-improvement-design.md (v1.1)"
```

- [ ] **Step 11: push (사용자 명시 시)**

```bash
git push origin master
```

> **주의**: 사용자가 명시적으로 push 요청 시에만 실행. 기본은 *로컬 머지까지만*.

- [ ] **Step 12: feature 브랜치 cleanup (선택)**

```bash
git branch -d feature/video-vision-pipeline-improvement
```

Expected: `Deleted branch feature/video-vision-pipeline-improvement`

---

## 부록 A — Phase 간 의존 + 토큰 절약 전략

| Phase | 의존 | 새 세션 진입 가능 여부 | 끝에 transient FAIL |
|-------|------|----------------------|---------------------|
| 0 | 없음 | ✅ | 0 |
| 1 | Phase 0 (브랜치) | ✅ | 2 (Phase 4 까지 deferred) |
| 2 | Phase 1 (없음 · 독립) | ✅ | 2 (Phase 1 의 deferred 유지) |
| 3 | Phase 2 (SYSTEM_VIDEO_WAN22_BASE) | ✅ | 2 (Phase 1 의 deferred 유지) |
| 4 | Phase 3 (build_system_video 분기) | ✅ | **0** (Phase 1 의 deferred 자동 해소) |
| 5 | Phase 4 (모든 코드 완료) | ✅ | 0 |

**새 세션 진입 가이드**: 각 phase 시작 전에:
1. `git log --oneline -5` 로 현재 상태 확인
2. `git status` 로 working tree clean 확인
3. 이 plan 문서의 해당 phase 만 읽기 (앞 phase 는 commit 으로 확인 가능 — 다시 읽을 필요 X)

## 부록 B — Codex 2라운드 검증 (선택)

Phase 4 완료 후 / dogfooding 전에 Codex 한테 v1.1 spec 의 Phase-by-Phase 구현 결과 재검증 요청 가능:

```
@codex:codex-rescue
feature/video-vision-pipeline-improvement 브랜치의 Phase 1~4 commit 4개를 검증해줘.
spec: docs/superpowers/specs/2026-05-11-video-vision-pipeline-improvement-design.md (v1.1)
plan: docs/superpowers/plans/2026-05-11-video-vision-pipeline-improvement.md

특히 spec §12 (Codex review 시 특히 점검 요청) 의 6 질문 + §13 자취 표의 5 finding 이 실제 구현에 정확히 반영되었는지 + Phase 4 의 3단 전파가 silent 누락 없이 끊김 없이 작동하는지 확인 부탁해.
```

Codex 피드백 받으면 새 phase 로 추가 commit (Phase 4.5: codex-followup) 후 dogfooding 재시작.

---

**한 줄 요약**: 5 phase × ~30분 · 각 phase 끝 commit 으로 토큰 절약 · Phase 1 의 deferred 2 테스트는 Phase 4 끝에서 자동 해소 · dogfooding 5 시나리오 후 master 머지.
