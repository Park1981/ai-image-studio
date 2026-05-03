# Vision 2-Stage Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1-shot vision-to-prompt 을 vision (관찰) + text (합성) 2-stage 분업 architecture 로 교체. ChatGPT(하루) 진단의 1순위 정공법 채택.

**Architecture:** Vision 모델은 raw observation JSON 만 출력 (boilerplate 금지). Text 모델 (gemma4-un 26B) 이 observation 을 받아 positive_prompt 합성. 후처리 banned_terms 필터로 학습된 boilerplate ("muted earth tones" 등) 가 관찰 근거 없이 새어나오는 거 차단. 외부 시그니처 (analyze_image_detailed) 100% 유지로 frontend / pipelines / routes 0줄 변경.

**Tech Stack:** Python 3.13 / FastAPI / Ollama / qwen3-vl:8b (default · 6.1GB) + qwen2.5vl:7b (env var fallback) + gemma4-un:latest (26B text)

**진단 근거:** `claudedocs/vision-pipeline-chatgpt-brief.md` (4 데이터 포인트) + `claudedocs/답변.md` (ChatGPT 정공법)

**Spec 결정사항 (default 채택 — ChatGPT 2차 리뷰 8 항목 반영 · 2026-05-03):**
1. **Vision model**: env var `STUDIO_VISION_MODEL` 우선, 없으면 default `qwen3-vl:8b`. **Auto-detect fallback chain 빼고 단순화 (A안)** — 모델 없으면 Ollama 가 알아서 에러. MVP 안에 detect 로직 X.
2. **Architecture**: 4 sub-module 추가 (vision_observe / prompt_synthesize / banned_terms / observation_mapping) + image_detail.py 오케스트레이션 교체
3. **시그니처 유지**: `analyze_image_detailed()` 외부 호출 호환 100% (frontend / pipelines / routes 변경 0줄)
4. **Race 정책**: `broad_visible_appearance` 만 관찰 (REQUIRED 아님), text 단계에서 "fictional adult [appearance]" 변환
5. **Banned_terms 후처리 — 2 그룹 분리**: `VISUAL_CONTRADICTION_TERMS` (관찰 근거 없으면 강제 제거 · "muted earth tones" / "golden hour" / "softbox" / "85mm lens" 등) + `QUALITY_BOILERPLATE_TERMS` (`masterpiece` / `best quality` / `ultra detailed` / `high resolution` 등 · MVP 미적용 — 사용자가 의도적으로 쓸 수 있음)
6. **History DB**: v8 schema 그대로 (raw observation JSON 저장 X · 후속 plan 후보)
7. **Frontend 디버그 표시**: 후속 (MVP 는 positive_prompt 만 노출)
8. **Fallback 보강**: vision 실패 → 옛 fallback (provider="fallback") / **text 실패 → observation_mapping 기반 짧은 positive_prompt 자동 합성** (`{subject}, {clothing}, {environment}, {lighting}, realistic photo`) — 빈 문자열 안 줌
9. **테스트**: ~20 신규 단위 + 통합 테스트. **테스트 카운트 절대값 (429/432/446 등) 박지 않음** — "신규 테스트 PASS + 기존 regression 0" 으로 검증
10. **Sampling 파라미터** (ChatGPT 권장):
    - `vision_observe`: temperature **0.2** (관찰 deterministic), num_ctx **4096** (Ollama 기본 + 이미지 토큰 안전)
    - `prompt_synthesize`: temperature **0.4** (합성 약간 낮춤), num_ctx **6144**
11. **keep_alive**: env var `STUDIO_OLLAMA_KEEP_ALIVE` (default `"5m"` 실사용 · 개발 시 `"0"` 으로 swap) — 매 요청마다 모델 swap 방지
12. **디버그 옵션**: env var `STUDIO_VISION_DEBUG=1` 시 observation / synthesized / filtered / removed 를 log 에 print (개발용)

---

## File Structure

### Created (4 sub-modules)

```
backend/studio/vision_pipeline/
  vision_observe.py       (NEW · 1-stage · vision model 호출 → observation JSON)
  prompt_synthesize.py    (NEW · 2-stage · text model 호출 → final prompt JSON)
  banned_terms.py         (NEW · 후처리 필터 + banned phrase 리스트)
  observation_mapping.py  (NEW · observation JSON → 9 슬롯 매핑 helper)
```

### Modified

```
backend/studio/vision_pipeline/
  image_detail.py         (오케스트레이션 교체 · analyze_image_detailed 시그니처 유지)
  __init__.py             (facade · 새 함수 export 추가)
  _common.py              (debug_log 헬퍼 4-5줄 추가 · STUDIO_VISION_DEBUG)
  edit_source.py          (변경 0 · Edit 모드는 별 흐름)

backend/studio/
  presets.py              (DEFAULT_OLLAMA_ROLES 기본값 + STUDIO_OLLAMA_KEEP_ALIVE env var)
```

### Tests (NEW)

```
backend/tests/
  test_vision_observe.py        (5 단위)
  test_prompt_synthesize.py     (4 단위)
  test_banned_terms.py          (4 단위)
  test_observation_mapping.py   (3 단위)
  test_image_detail_v3.py       (4 통합 — 옛 test_vision_pipeline 일부 대체)
```

---

## 책임 분리

### `vision_observe.py` — 1-stage 관찰자

**입력**: image_bytes + width/height + vision_model + ollama_url + timeout + (옵셔널 keep_alive)
**출력**: `dict[str, Any]` (parsed observation JSON · 실패 시 빈 dict)
**역할**:
- ChatGPT 답변 §"Vision 모델용 시스템 프롬프트" 그대로 사용 (관찰 only · positive_prompt 작성 금지 · boilerplate 금지)
- Ollama format=json + **temperature 0.2** (관찰 deterministic) + **num_ctx 4096** (Ollama 기본 + 이미지 토큰 안전)
- keep_alive: env var `STUDIO_OLLAMA_KEEP_ALIVE` (default `"5m"`)
- JSON 파싱 시도 → 실패 시 `{}` 반환 (HTTP 500 안 냄) + `debug_log()` 호출

### `prompt_synthesize.py` — 2-stage 편집자

**입력**: observation_dict + text_model + ollama_url + timeout + (옵셔널 keep_alive)
**출력**: `dict[str, str | list]` 5 키 (`summary`, `positive_prompt`, `negative_prompt`, `key_visual_anchors`, `uncertain`)
**역할**:
- ChatGPT 답변 §"Text 모델용 시스템 프롬프트" 그대로 사용
- gemma4-un:latest 호출 (think=false 필수 — CLAUDE.md rules)
- user message: "Convert this visual observation JSON into..." + observation JSON
- format=json · **temperature 0.4** (합성 약간 낮춤) · **num_ctx 6144** (text-only 라 vision 보다 여유)
- keep_alive: env var `STUDIO_OLLAMA_KEEP_ALIVE` (default `"5m"`)
- 실패 시 빈 슬롯 dict 반환 + `debug_log()` 호출

### `banned_terms.py` — 후처리 안전망 (2 그룹)

**입력**: positive_prompt 문자열 + observation_dict
**출력**: 필터된 positive_prompt
**역할** (ChatGPT 2차 리뷰 권장 — 2 그룹 분리):
- `VISUAL_CONTRADICTION_TERMS`: 학습된 lighting/color/lens boilerplate (`muted earth tones`, `golden hour`, `softbox lighting`, `85mm portrait lens`, `shallow with soft bokeh`, `cinematic editorial` 등) — observation 근거 없으면 **강제 제거** + log warning
- `QUALITY_BOILERPLATE_TERMS`: 품질 태그 (`masterpiece`, `best quality`, `ultra detailed`, `high resolution` 등) — **MVP 미적용** (사용자가 의도적으로 쓸 수 있음 · 후속 옵션화)
- `filter_banned()` MVP 구현은 VISUAL_CONTRADICTION_TERMS 만 처리

### `observation_mapping.py` — observation → 9 슬롯

**입력**: observation_dict
**출력**: 5 슬롯 dict (`composition`, `subject`, `clothing_or_materials`, `environment`, `lighting_camera_style`)
**역할**:
- text model 이 안 채우는 5 슬롯을 observation JSON 에서 직접 매핑
- frontend RecipeV2View 의 6 디테일 카드 호환 유지

### `image_detail.py` — 오케스트레이션 (교체)

**Before**: 1-shot `_call_vision_recipe_v2` → JSON 파싱 → 9 슬롯
**After**: `vision_observe()` → `prompt_synthesize()` → `banned_terms.filter()` → `observation_mapping.map()` → 통합 9 슬롯 → `VisionAnalysisResult`
**시그니처 유지**: `analyze_image_detailed(image_bytes, *, vision_model=None, text_model=None, ollama_url=None, timeout, width, height, progress_callback=None)`

### `presets.py` — env var 지원

```python
# MVP A안 — auto-detect chain 빼고 단순 default + env var (ChatGPT 2차 리뷰)
# DEFAULT_OLLAMA_ROLES.vision = _env_or("qwen3-vl:8b", "STUDIO_VISION_MODEL")
# 모델 없으면 Ollama 가 알아서 에러 (frontend 에 명시 노출).
# resolve_vision_model() 같은 fallback 함수 자체 안 만듦.

def resolve_ollama_keep_alive() -> str:
    """STUDIO_OLLAMA_KEEP_ALIVE env var 우선 (default '5m').

    ChatGPT 2차 리뷰 — keep_alive '0' 은 매 요청마다 모델 swap 발생해서
    사용자 체감 느림. 실사용 default '5m' 으로.
    """
```

---

## Phase 분할

- **Phase 1**: `banned_terms.py` (2 그룹) + `_common.debug_log` 헬퍼 (의존성 0)
- **Phase 2**: `observation_mapping.py` (의존성 0)
- **Phase 3**: `vision_observe.py` (Ollama mock · temp 0.2 · num_ctx 4096)
- **Phase 4**: `prompt_synthesize.py` (Ollama mock · temp 0.4 · num_ctx 6144)
- **Phase 5**: `image_detail.py` 오케스트레이션 교체 (통합 · text fallback 보강)
- **Phase 6**: `presets.py` env var (vision/text/keep_alive) + default 변경
- **Phase 7**: 회귀 검증 (pytest + vitest + tsc + lint)
- **Phase 8**: 사용자 브라우저 검증 (같은 카리나 이미지로 ChatGPT rubric 100점 채점)

각 Phase 내에서 commit 1번. 총 6 commit (Phase 7 검증 / Phase 8 사용자 검증은 commit 없음).

---

## Phase 1: `banned_terms.py` + `_common.debug_log` 헬퍼 + 단위 테스트

**Files:**
- Create: `backend/studio/vision_pipeline/banned_terms.py`
- Modify: `backend/studio/vision_pipeline/_common.py` (debug_log 헬퍼 4-5줄 추가)
- Create: `backend/tests/test_banned_terms.py`

### Task 1.0: `_common.py` 에 debug_log 헬퍼 추가 (cross-cutting · 모든 phase 공용)

- [ ] **Step 1: _common.py 끝에 debug_log 추가**

```python
# backend/studio/vision_pipeline/_common.py 끝에 append
import os
from typing import Any as _DebugAny  # 이미 있는 import 와 충돌 방지

_DEBUG_TRUTHY = ("1", "true", "yes", "on")


def debug_log(stage: str, payload: _DebugAny) -> None:
    """STUDIO_VISION_DEBUG=1 일 때만 stage + payload 를 log 에 print.

    개발/디버깅용. 운영 배포 시 env var 안 켜면 noop.

    ChatGPT 2차 리뷰 — env var 를 함수 내부에서 읽음 (재시작 없이도
    런타임 ON/OFF 즉시 반영). module-level constant 캐싱 X.
    """
    enabled = os.environ.get("STUDIO_VISION_DEBUG", "").strip().lower() in _DEBUG_TRUTHY
    if not enabled:
        return
    log.warning("[VISION_DEBUG][%s] %s", stage, payload)
```

### Task 1.1: `banned_terms.py` 모듈 생성

- [ ] **Step 2: banned_terms.py 박기 — 2 그룹 + filter_banned (VISUAL 만 적용)**

```python
# backend/studio/vision_pipeline/banned_terms.py
"""
banned_terms — 학습된 boilerplate 후처리 필터 (2026-05-03 · ChatGPT 정공법).

7B/8B vision model 이 system prompt 의 anti-pattern 도 무시하고
"muted earth tones", "golden hour", "85mm portrait lens" 같은 학습된
boilerplate phrase 를 자동 출력하는 catastrophic failure 방지.

ChatGPT 2차 리뷰: 2 그룹 분리.
  - VISUAL_CONTRADICTION_TERMS: lighting/color/lens 사실 오류 위험
    → 관찰 근거 없으면 강제 제거
  - QUALITY_BOILERPLATE_TERMS: 품질 태그 (masterpiece 등)
    → MVP 미적용 (사용자가 의도적으로 쓸 수 있음 · 후속 옵션화)

정책: "삭제" 가 아니라 "관찰 근거 없으면 삭제".
"""

from __future__ import annotations

import logging
import re
from typing import Any

from . import _common as _c

log = logging.getLogger(__name__)

# Group A — lighting/color/lens 사실 오류 위험 (관찰 근거 없으면 강제 제거)
VISUAL_CONTRADICTION_TERMS: list[str] = [
    "muted earth tones",
    "muted earth tone",
    "golden hour",
    "softbox key",
    "softbox lighting",
    "softbox key lighting",
    "85mm portrait lens",
    "85mm portrait",
    "85mm lens",
    "cinematic editorial",
    "cinematic editorial style",
    "cinematic editorial photography",
    "shallow with soft bokeh",
    "shallow DOF with soft bokeh",
]

# Group B — 품질 태그 (MVP 미적용 · 후속 옵션화)
# 사용자가 t2i 프롬프트 품질 향상 목적으로 의도적으로 쓰는 경우 많음.
QUALITY_BOILERPLATE_TERMS: list[str] = [
    "masterpiece",
    "best quality",
    "ultra detailed",
    "high resolution",
]


def _has_observation_evidence(phrase: str, observation: dict[str, Any]) -> bool:
    """observation JSON 안에 banned phrase 의 근거 단서 있는지 확인."""
    light = observation.get("lighting_and_color", {})
    photo = observation.get("photo_quality", {})

    haystacks: list[str] = []
    haystacks.extend(light.get("visible_light_sources", []) or [])
    haystacks.extend(light.get("dominant_colors", []) or [])
    haystacks.extend(photo.get("style_evidence", []) or [])
    haystacks.append(photo.get("depth_of_field", "") or "")
    haystacks.append(light.get("contrast", "") or "")

    needle = phrase.lower()
    for hay in haystacks:
        if isinstance(hay, str) and needle in hay.lower():
            return True
    return False


def filter_banned(positive_prompt: str, observation: dict[str, Any]) -> str:
    """positive_prompt 안 VISUAL_CONTRADICTION 그룹의 phrase 중
    관찰 근거 없는 것 제거. 근거 있으면 유지. 제거 시 log warning.

    QUALITY_BOILERPLATE_TERMS 는 MVP 에서 적용 X (사용자 의도 보존).
    """
    if not positive_prompt:
        return positive_prompt

    removed: list[str] = []
    result = positive_prompt
    for phrase in VISUAL_CONTRADICTION_TERMS:
        pattern = re.compile(rf"\b{re.escape(phrase)}\b[,.\s]*", re.IGNORECASE)
        if not pattern.search(result):
            continue
        if _has_observation_evidence(phrase, observation):
            continue
        result = pattern.sub("", result)
        removed.append(phrase)
        log.warning("banned_terms removed (no observation evidence): %r", phrase)

    if removed:
        _c.debug_log("banned_terms.removed", removed)

    # 연속 콤마/공백 정리
    result = re.sub(r"\s*,\s*,+", ", ", result)
    result = re.sub(r"\s+", " ", result).strip().strip(",").strip()
    return result
```

- [ ] **Step 3: 단위 테스트 박기 (7 케이스 · 2 그룹 검증 + quality 태그 미적용 보장)**

```python
# backend/tests/test_banned_terms.py
"""banned_terms 후처리 필터 단위 테스트 (2 그룹 분리)."""

import pytest

from studio.vision_pipeline.banned_terms import (
    QUALITY_BOILERPLATE_TERMS,
    VISUAL_CONTRADICTION_TERMS,
    filter_banned,
)


class TestBannedTermsFilter:
    """관찰 근거 없는 visual contradiction 만 제거 — quality 태그는 보존."""

    def test_removes_visual_contradiction_when_no_evidence(self) -> None:
        """관찰 근거 없는 'muted earth tones' 는 제거된다."""
        positive = "young adult woman, holding a drink, muted earth tones, neon lights"
        observation = {
            "lighting_and_color": {
                "visible_light_sources": ["neon stage lights"],
                "dominant_colors": ["red", "blue"],
            }
        }
        result = filter_banned(positive, observation)
        assert "muted earth tones" not in result.lower()
        assert "neon lights" in result  # 다른 부분 유지

    def test_keeps_visual_term_when_evidence_present(self) -> None:
        """observation 에 'golden hour' 근거 있으면 유지된다."""
        positive = "young adult woman in golden hour lighting"
        observation = {
            "lighting_and_color": {
                "visible_light_sources": ["golden hour sunlight"],
            }
        }
        result = filter_banned(positive, observation)
        assert "golden hour" in result.lower()

    def test_quality_boilerplate_NOT_removed_in_mvp(self) -> None:
        """MVP 에선 quality 태그 (masterpiece/best quality 등) 는 유지된다."""
        positive = "subject, masterpiece, best quality, ultra detailed, high resolution"
        observation = {}  # 근거 X — 그래도 quality 태그는 보존되어야
        result = filter_banned(positive, observation)
        assert "masterpiece" in result.lower()
        assert "best quality" in result.lower()
        assert "ultra detailed" in result.lower()
        assert "high resolution" in result.lower()

    def test_handles_empty_input(self) -> None:
        """빈 입력은 그대로 반환."""
        assert filter_banned("", {}) == ""
        assert filter_banned("simple prompt", {}) == "simple prompt"

    def test_cleans_orphan_commas_after_removal(self) -> None:
        """제거 후 연속 콤마 / 공백 정리된다."""
        positive = "subject, muted earth tones, 85mm lens, lively scene"
        observation = {}  # 근거 없음 — 둘 다 제거
        result = filter_banned(positive, observation)
        assert ",," not in result
        assert "  " not in result  # 더블 스페이스 없음
        assert result.startswith("subject")
        assert result.endswith("lively scene")

    def test_visual_list_includes_known_offenders(self) -> None:
        """4 iterations 에서 발견한 visual contradiction 이 리스트에 있다."""
        for known in [
            "muted earth tones",
            "golden hour",
            "85mm portrait lens",
            "softbox key lighting",
            "shallow with soft bokeh",
            "cinematic editorial",
        ]:
            assert known in [b.lower() for b in VISUAL_CONTRADICTION_TERMS], (
                f"Missing known visual boilerplate: {known}"
            )

    def test_quality_terms_in_separate_group(self) -> None:
        """quality 태그는 VISUAL 그룹에 없고, QUALITY 그룹에만 있다."""
        for quality in ["masterpiece", "best quality", "ultra detailed", "high resolution"]:
            assert quality in [b.lower() for b in QUALITY_BOILERPLATE_TERMS]
            assert quality not in [b.lower() for b in VISUAL_CONTRADICTION_TERMS]
```

- [ ] **Step 4: 테스트 실행 (GREEN — 구현 박았으므로)**

Run: `cd D:\AI-Image-Studio\backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_banned_terms.py -v`
Expected: 7 PASS (신규 테스트 모두 PASS)

- [ ] **Step 5: 회귀 검증 (기존 regression 0)**

Run: `cd D:\AI-Image-Studio\backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ --tb=short -q`
Expected: 신규 테스트 PASS + 기존 regression 0 (절대값은 환경 따라 변동 가능)

- [ ] **Step 6: 커밋**

```bash
cd D:\AI-Image-Studio
git add backend/studio/vision_pipeline/banned_terms.py backend/studio/vision_pipeline/_common.py backend/tests/test_banned_terms.py
git commit -m "$(cat <<'EOF'
feat(vision): banned_terms 후처리 필터 + debug helper (2-stage Phase 1)

7B/8B vision 모델이 system prompt 의 anti-pattern 도 무시하고 학습된
boilerplate ("muted earth tones", "golden hour", "85mm portrait lens"
등) 를 자동 출력하는 catastrophic failure 방지.

ChatGPT 2차 리뷰 채택 — 2 그룹 분리:
  - VISUAL_CONTRADICTION_TERMS: lighting/color/lens 사실 오류 위험
    → 관찰 근거 없으면 강제 제거 (filter_banned 적용)
  - QUALITY_BOILERPLATE_TERMS: 품질 태그 (masterpiece 등)
    → MVP 미적용 (사용자 의도 보존 · 후속 옵션화)

추가: _common.py 에 debug_log() 헬퍼 (env var STUDIO_VISION_DEBUG=1
일 때만 stage + payload print · 운영은 noop).

테스트 7 신규 (2 그룹 검증 + quality 태그 미적용 보장).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: `observation_mapping.py` + 단위 테스트

**Files:**
- Create: `backend/studio/vision_pipeline/observation_mapping.py`
- Create: `backend/tests/test_observation_mapping.py`

### Task 2.1: `observation_mapping.py` 모듈 생성

- [ ] **Step 1: 매핑 함수 박기**

```python
# backend/studio/vision_pipeline/observation_mapping.py
"""
observation_mapping — vision observation JSON → 9 슬롯 5개 매핑 (2026-05-03).

text model (prompt_synthesize) 가 안 채우는 5 슬롯을 observation JSON 에서
직접 매핑. frontend RecipeV2View 의 6 디테일 카드 호환 유지.

매핑 대상: composition, subject, clothing_or_materials, environment,
          lighting_camera_style
"""

from __future__ import annotations

from typing import Any


def _join_nonempty(items: list[str | None] | tuple[str | None, ...], sep: str = ", ") -> str:
    """None / 빈 문자열 제외 후 join. 항상 string 반환."""
    parts = [str(x).strip() for x in items if x and str(x).strip()]
    return sep.join(parts)


def _format_subject(s: dict[str, Any], idx: int) -> str:
    """단일 subject dict → 사람이 읽을 수 있는 문장."""
    label_parts = [
        s.get("apparent_age_group"),
        s.get("broad_visible_appearance"),
    ]
    detail_parts = [
        s.get("face_direction"),
        s.get("expression"),
        s.get("eyes"),
        s.get("mouth"),
        s.get("hair"),
        s.get("pose"),
        s.get("hands"),
    ]
    head = _join_nonempty(label_parts, sep=" ")
    detail = _join_nonempty(detail_parts, sep=", ")
    if head and detail:
        return f"subject {idx}: {head} — {detail}"
    if head:
        return f"subject {idx}: {head}"
    if detail:
        return f"subject {idx}: {detail}"
    return ""


def map_observation_to_slots(observation: dict[str, Any]) -> dict[str, str]:
    """observation JSON → 5 슬롯 (composition / subject / clothing_or_materials / environment / lighting_camera_style)."""
    if not observation:
        return {
            "composition": "",
            "subject": "",
            "clothing_or_materials": "",
            "environment": "",
            "lighting_camera_style": "",
        }

    # composition: framing 합본
    framing = observation.get("framing", {}) or {}
    orientation = observation.get("image_orientation", "") or ""
    composition = _join_nonempty([
        orientation,
        framing.get("crop"),
        framing.get("camera_angle"),
        framing.get("subject_position"),
    ])

    # subject: subjects 배열 → 다중 처리
    subjects = observation.get("subjects", []) or []
    subject = "; ".join(filter(None, [
        _format_subject(s, i + 1) for i, s in enumerate(subjects)
    ]))

    # clothing_or_materials: 모든 subject 의 clothing + accessories 합본
    clothing_items: list[str] = []
    for s in subjects:
        clothing_items.extend(s.get("clothing", []) or [])
        clothing_items.extend(s.get("accessories_or_objects", []) or [])
    clothing_or_materials = _join_nonempty(clothing_items)

    # environment: location + foreground/middle/background + weather
    env = observation.get("environment", {}) or {}
    environment = _join_nonempty([
        env.get("location_type"),
        _join_nonempty(env.get("foreground", []) or []),
        _join_nonempty(env.get("midground", []) or []),
        _join_nonempty(env.get("background", []) or []),
        _join_nonempty(env.get("weather_or_surface_condition", []) or []),
    ])

    # lighting_camera_style: lighting + photo_quality 합본
    light = observation.get("lighting_and_color", {}) or {}
    photo = observation.get("photo_quality", {}) or {}
    lighting_camera_style = _join_nonempty([
        _join_nonempty(light.get("visible_light_sources", []) or []),
        _join_nonempty(light.get("dominant_colors", []) or []),
        light.get("contrast"),
        photo.get("depth_of_field"),
        photo.get("focus_target"),
        _join_nonempty(photo.get("style_evidence", []) or []),
    ])

    return {
        "composition": composition,
        "subject": subject,
        "clothing_or_materials": clothing_or_materials,
        "environment": environment,
        "lighting_camera_style": lighting_camera_style,
    }
```

- [ ] **Step 2: 단위 테스트 박기 (3 케이스)**

```python
# backend/tests/test_observation_mapping.py
"""observation_mapping — observation JSON → 9 슬롯 5개 매핑 단위 테스트."""

import pytest

from studio.vision_pipeline.observation_mapping import map_observation_to_slots


class TestObservationMapping:
    """observation 의 nested JSON 을 frontend 호환 5 슬롯으로 평탄화."""

    def test_full_observation_maps_all_slots(self) -> None:
        """완전한 observation 은 5 슬롯 모두 채운다."""
        observation = {
            "image_orientation": "portrait",
            "framing": {
                "crop": "chest-up",
                "camera_angle": "slight upward tilt",
                "subject_position": "center-left",
            },
            "subjects": [
                {
                    "count_index": 1,
                    "apparent_age_group": "young adult",
                    "broad_visible_appearance": "East Asian female",
                    "face_direction": "facing camera",
                    "expression": "winking",
                    "hair": "long wet dark hair",
                    "pose": "drinking from cup",
                    "clothing": ["gray cropped tank top with cutouts", "beige cargo pants"],
                    "accessories_or_objects": ["clear plastic cup with yellow drink"],
                }
            ],
            "environment": {
                "location_type": "outdoor music festival at night",
                "foreground": ["crowd in plastic raincoats"],
                "background": ["MUSIC FESTIVAL neon sign", "stage with lights"],
                "weather_or_surface_condition": ["rain", "wet surfaces"],
            },
            "lighting_and_color": {
                "visible_light_sources": ["red stage lights", "blue stage lights"],
                "dominant_colors": ["red", "blue", "neon"],
                "contrast": "high contrast",
            },
            "photo_quality": {
                "depth_of_field": "shallow",
                "focus_target": "subject face and cup",
                "style_evidence": ["concert/event photography"],
            },
        }
        slots = map_observation_to_slots(observation)
        assert "portrait" in slots["composition"]
        assert "chest-up" in slots["composition"]
        assert "East Asian female" in slots["subject"]
        assert "winking" in slots["subject"]
        assert "cropped tank top" in slots["clothing_or_materials"]
        assert "cargo pants" in slots["clothing_or_materials"]
        assert "music festival" in slots["environment"]
        assert "rain" in slots["environment"]
        assert "red stage lights" in slots["lighting_camera_style"]
        assert "shallow" in slots["lighting_camera_style"]

    def test_empty_observation_returns_empty_slots(self) -> None:
        """빈 observation 은 빈 5 슬롯 반환 (None 아님)."""
        slots = map_observation_to_slots({})
        assert slots == {
            "composition": "",
            "subject": "",
            "clothing_or_materials": "",
            "environment": "",
            "lighting_camera_style": "",
        }

    def test_multi_subject_uses_numbered_format(self) -> None:
        """다중 subject 는 'subject 1; subject 2' 형식."""
        observation = {
            "subjects": [
                {"apparent_age_group": "young adult", "broad_visible_appearance": "female", "expression": "smiling"},
                {"apparent_age_group": "middle-aged", "broad_visible_appearance": "male", "expression": "neutral"},
            ]
        }
        slots = map_observation_to_slots(observation)
        assert "subject 1:" in slots["subject"]
        assert "subject 2:" in slots["subject"]
        assert "young adult female" in slots["subject"]
        assert "middle-aged male" in slots["subject"]
```

- [ ] **Step 3: 테스트 실행 + 회귀**

Run: `cd D:\AI-Image-Studio\backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_observation_mapping.py -v`
Expected: 3 PASS

Run: `cd D:\AI-Image-Studio\backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ --tb=short -q`
Expected: 신규 테스트 PASS + 기존 regression 0

- [ ] **Step 4: 커밋**

```bash
git add backend/studio/vision_pipeline/observation_mapping.py backend/tests/test_observation_mapping.py
git commit -m "$(cat <<'EOF'
feat(vision): observation_mapping helper (2-stage Phase 2)

vision observation JSON 의 nested 구조를 frontend RecipeV2View 의
5 슬롯 (composition / subject / clothing_or_materials / environment /
lighting_camera_style) 으로 평탄화 매핑.

text model 이 4 슬롯만 채우고 나머지 5 슬롯은 observation 에서 직접
매핑하는 방식 (책임 분리 + 모델 호출 비용 절약).

테스트 3 신규 (관찰 → 5 슬롯 매핑 검증).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: `vision_observe.py` + 단위 테스트

**Files:**
- Create: `backend/studio/vision_pipeline/vision_observe.py`
- Create: `backend/tests/test_vision_observe.py`

### Task 3.1: vision_observe 모듈 생성

- [ ] **Step 1: vision_observe.py 박기 — system prompt + 호출 함수**

```python
# backend/studio/vision_pipeline/vision_observe.py
"""
vision_observe — 1-stage observer (2026-05-03 · ChatGPT 정공법).

Vision 모델 (qwen3-vl:8b 또는 qwen2.5vl:7b) 이 raw observation JSON
만 출력. positive_prompt 작성 / boilerplate phrase 사용 모두 금지.

원칙: Vision 은 작가가 아니라 관찰자.
"""

from __future__ import annotations

import logging
from typing import Any

from .._json_utils import parse_strict_json as _parse_strict_json
from .._ollama_client import call_chat_payload
from . import _common as _c

log = logging.getLogger(__name__)


# ChatGPT 답변 §"Vision 모델용 시스템 프롬프트" 그대로
VISION_OBSERVATION_SYSTEM = """You are a visual observation extractor.

Your task is to inspect the image and output only visible facts.
Do not write an image-generation prompt.
Do not use artistic boilerplate.
Do not guess camera lens, lighting equipment, time of day, race, brand, identity, or mood unless directly visible.
Do not use generic phrases such as cinematic editorial, muted earth tones, golden hour, softbox lighting, 85mm lens, masterpiece, ultra detailed.

Return STRICT JSON only.

Schema:
{
  "image_orientation": "",
  "framing": {
    "crop": "",
    "camera_angle": "",
    "subject_position": ""
  },
  "subjects": [
    {
      "count_index": 1,
      "apparent_age_group": "",
      "broad_visible_appearance": "",
      "face_direction": "",
      "expression": "",
      "eyes": "",
      "mouth": "",
      "hair": "",
      "pose": "",
      "hands": "",
      "clothing": [],
      "accessories_or_objects": []
    }
  ],
  "environment": {
    "location_type": "",
    "foreground": [],
    "midground": [],
    "background": [],
    "weather_or_surface_condition": []
  },
  "lighting_and_color": {
    "visible_light_sources": [],
    "dominant_colors": [],
    "contrast": "",
    "flash_or_reflection_evidence": ""
  },
  "photo_quality": {
    "depth_of_field": "",
    "motion_blur": "",
    "focus_target": "",
    "style_evidence": []
  },
  "uncertain": []
}

Rules:
- Use short concrete phrases.
- If unsure, write it in "uncertain".
- Prefer "appears to be" for uncertain visual attributes.
- Do not repeat the same phrase.
- Do not create a final prompt."""


async def observe_image(
    image_bytes: bytes,
    *,
    width: int,
    height: int,
    vision_model: str,
    timeout: float,
    ollama_url: str,
    keep_alive: str | None = None,
) -> dict[str, Any]:
    """이미지 → observation JSON dict (실패 시 빈 dict).

    Sampling (ChatGPT 2차 리뷰 권장):
      - temperature 0.2 (관찰은 deterministic 가까이)
      - num_ctx 4096 (Ollama 기본 + 이미지 토큰 안전)
      - keep_alive: env var STUDIO_OLLAMA_KEEP_ALIVE (default "5m")
    """
    from ..presets import resolve_ollama_keep_alive

    resolved_keep_alive = keep_alive if keep_alive is not None else resolve_ollama_keep_alive()
    ratio_label = _c._aspect_label(width, height)
    user_content = (
        f"One SOURCE image attached. Aspect: {width}×{height} ({ratio_label}).\n"
        "Extract visible facts only. Return STRICT JSON matching the schema. "
        "No prompt-writing. No boilerplate."
    )
    payload = {
        "model": vision_model,
        "messages": [
            {"role": "system", "content": VISION_OBSERVATION_SYSTEM},
            {
                "role": "user",
                "content": user_content,
                "images": [_c._to_base64(image_bytes)],
            },
        ],
        "stream": False,
        "format": "json",
        "keep_alive": resolved_keep_alive,
        "options": {"temperature": 0.2, "num_ctx": 4096},
    }
    try:
        raw = await call_chat_payload(
            ollama_url=ollama_url,
            payload=payload,
            timeout=timeout,
        )
    except Exception as e:
        log.warning("vision_observe call failed (%s): %s", vision_model, e)
        return {}

    parsed = _parse_strict_json(raw) if raw else None
    if not isinstance(parsed, dict):
        log.warning("vision_observe JSON parse failed (raw len=%d)", len(raw))
        _c.debug_log("vision_observe.parse_failed", raw[:500] if raw else "")
        return {}
    _c.debug_log("vision_observe.observation", parsed)
    return parsed
```

- [ ] **Step 2: 단위 테스트 박기 (5 케이스 · 모두 mock 기반)**

```python
# backend/tests/test_vision_observe.py
"""vision_observe — Ollama 호출 mock 기반 단위 테스트."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from studio.vision_pipeline.vision_observe import (
    VISION_OBSERVATION_SYSTEM,
    observe_image,
)


@pytest.mark.asyncio
class TestVisionObserve:
    """관찰 단계 — Ollama call mock + JSON 파싱 검증."""

    async def test_returns_parsed_dict_on_success(self) -> None:
        """정상 응답 → parsed dict."""
        mock_observation = {
            "image_orientation": "portrait",
            "subjects": [{"count_index": 1, "apparent_age_group": "young adult"}],
        }
        with patch(
            "studio.vision_pipeline.vision_observe.call_chat_payload",
            new=AsyncMock(return_value=json.dumps(mock_observation)),
        ):
            result = await observe_image(
                b"fake_image_bytes",
                width=832,
                height=1248,
                vision_model="qwen3-vl:8b",
                timeout=120.0,
                ollama_url="http://localhost:11434",
            )
        assert result == mock_observation

    async def test_returns_empty_dict_on_call_exception(self) -> None:
        """Ollama 호출 예외 시 빈 dict 반환 (HTTP 500 안 냄)."""
        with patch(
            "studio.vision_pipeline.vision_observe.call_chat_payload",
            new=AsyncMock(side_effect=RuntimeError("ollama down")),
        ):
            result = await observe_image(
                b"fake",
                width=512,
                height=512,
                vision_model="qwen2.5vl:7b",
                timeout=60.0,
                ollama_url="http://localhost:11434",
            )
        assert result == {}

    async def test_returns_empty_dict_on_invalid_json(self) -> None:
        """JSON 파싱 실패 시 빈 dict."""
        with patch(
            "studio.vision_pipeline.vision_observe.call_chat_payload",
            new=AsyncMock(return_value="not valid json {"),
        ):
            result = await observe_image(
                b"fake",
                width=512,
                height=512,
                vision_model="qwen2.5vl:7b",
                timeout=60.0,
                ollama_url="http://localhost:11434",
            )
        assert result == {}

    async def test_payload_uses_format_json_and_observation_sampling(self) -> None:
        """Ollama payload 가 format=json + temperature 0.2 + num_ctx 4096 로 호출되는지."""
        captured: dict = {}

        async def capture(*, ollama_url: str, payload: dict, timeout: float) -> str:
            captured.update(payload)
            return "{}"

        with patch(
            "studio.vision_pipeline.vision_observe.call_chat_payload",
            new=AsyncMock(side_effect=capture),
        ):
            await observe_image(
                b"fake",
                width=512,
                height=512,
                vision_model="qwen3-vl:8b",
                timeout=60.0,
                ollama_url="http://localhost:11434",
                keep_alive="5m",  # 명시적 주입 (default resolver 우회)
            )
        assert captured["format"] == "json"
        assert captured["keep_alive"] == "5m"
        assert captured["options"]["temperature"] == 0.2
        assert captured["options"]["num_ctx"] == 4096

    def test_system_prompt_forbids_boilerplate(self) -> None:
        """system prompt 가 boilerplate 금지 어휘 + positive_prompt 작성 금지 명시."""
        for forbidden in [
            "muted earth tones",
            "golden hour",
            "softbox lighting",
            "85mm lens",
            "Do not write an image-generation prompt",
            "Do not create a final prompt",
        ]:
            assert forbidden in VISION_OBSERVATION_SYSTEM, (
                f"VISION_OBSERVATION_SYSTEM missing critical guard: {forbidden!r}"
            )
```

- [ ] **Step 3: observe_image 호출처에서 mock observe_image (4번 케이스) 의 인자 갱신 — `vision_model` / `timeout` / `ollama_url` 외에 새 옵셔널 `keep_alive` 받게**

Step 1 의 함수 시그니처 변경에 따라 모든 테스트 호출이 그대로 동작하는지 확인 (옵셔널이라 호환).

- [ ] **Step 4: 테스트 실행 + 회귀**

Run: `cd D:\AI-Image-Studio\backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_vision_observe.py -v`
Expected: 5 PASS

Run: `cd D:\AI-Image-Studio\backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ --tb=short -q`
Expected: 신규 테스트 PASS + 기존 regression 0

- [ ] **Step 5: 커밋**

```bash
git add backend/studio/vision_pipeline/vision_observe.py backend/tests/test_vision_observe.py
git commit -m "$(cat <<'EOF'
feat(vision): vision_observe 1-stage 관찰자 (2-stage Phase 3)

ChatGPT(하루) 정공법 §"Vision 모델용 시스템 프롬프트" 그대로 채택.
Vision 모델 (qwen3-vl:8b / qwen2.5vl:7b) 이 raw observation JSON
만 출력 — positive_prompt 작성 / boilerplate ("muted earth tones",
"golden hour", "85mm lens" 등) 사용 모두 금지.

Sampling (ChatGPT 2차 리뷰 권장):
  - temperature 0.2 (관찰 deterministic 가까이)
  - num_ctx 4096 (Ollama 기본 + 이미지 토큰 안전)
  - keep_alive: env var STUDIO_OLLAMA_KEEP_ALIVE 우선 (default "5m")

debug_log() 호출 — STUDIO_VISION_DEBUG=1 시 observation/parse_failed
출력.

원칙: Vision 은 작가가 아니라 관찰자.

테스트 5 신규 (Ollama mock 기반).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: `prompt_synthesize.py` + 단위 테스트

**Files:**
- Create: `backend/studio/vision_pipeline/prompt_synthesize.py`
- Create: `backend/tests/test_prompt_synthesize.py`

### Task 4.1: prompt_synthesize 모듈 생성

- [ ] **Step 1: prompt_synthesize.py 박기**

```python
# backend/studio/vision_pipeline/prompt_synthesize.py
"""
prompt_synthesize — 2-stage editor (2026-05-03 · ChatGPT 정공법).

Text 모델 (gemma4-un:latest 26B) 이 vision observation JSON 받아
positive_prompt + negative_prompt + summary + key_visual_anchors 합성.

think=False 필수 (CLAUDE.md rules — gemma4-un reasoning 모델 기본 끄기).

원칙: Text 는 관찰 메모를 프롬프트로 만드는 편집자.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .._json_utils import coerce_str as _coerce_str
from .._json_utils import parse_strict_json as _parse_strict_json
from .._ollama_client import call_chat_payload

log = logging.getLogger(__name__)


# ChatGPT 답변 §"Text 모델용 시스템 프롬프트" 그대로
PROMPT_SYNTHESIZE_SYSTEM = """You are an expert AI image-generation prompt writer.

You will receive a JSON object containing visual observations extracted from an image.
Your job is to convert the observations into a self-contained text-to-image prompt.

Important:
- Base the prompt only on the observation JSON.
- Do not invent details that contradict the observations.
- You may add generation-friendly photography terms only when supported by the observations.
- Avoid generic boilerplate unless it matches the observed image.
- Do not mention brands, real identities, celebrities, or copyrighted characters.
- Keep the subject fictional and adult.
- Preserve unique visual anchors.

Output STRICT JSON only:
{
  "summary": "",
  "positive_prompt": "",
  "negative_prompt": "",
  "key_visual_anchors": [],
  "uncertain": []
}

positive_prompt rules:
- 150 to 260 words.
- One dense English paragraph.
- Must be directly copy-pasteable into a text-to-image UI.
- Include: subject, expression, hair, clothing, pose, object interaction, environment, lighting, color palette, framing, depth, realism/style.
- Use concrete visible details.
- Do not repeat phrases.
- Do not use: muted earth tones, golden hour, softbox lighting, 85mm lens, masterpiece, best quality, unless the observation JSON clearly supports it.

negative_prompt rules:
- Comma-separated.
- Include common failure preventions.
- Include contradictions to preserve the observed image, such as dry hair if the subject is wet, smiling if the subject is winking/non-smiling, studio background if the image is outdoors."""


async def synthesize_prompt(
    observation: dict[str, Any],
    *,
    text_model: str,
    timeout: float,
    ollama_url: str,
    keep_alive: str | None = None,
) -> dict[str, Any]:
    """observation JSON → 4 슬롯 dict (summary / positive_prompt / negative_prompt / key_visual_anchors / uncertain).

    Sampling (ChatGPT 2차 리뷰 권장):
      - temperature 0.4 (합성 약간 낮춤)
      - num_ctx 6144 (text-only 라 vision 보다 여유)
      - keep_alive: env var STUDIO_OLLAMA_KEEP_ALIVE (default "5m")
    """
    from . import _common as _c
    from ..presets import resolve_ollama_keep_alive

    if not observation:
        return _empty_result()

    resolved_keep_alive = keep_alive if keep_alive is not None else resolve_ollama_keep_alive()
    user_content = (
        "Convert this visual observation JSON into a generation-ready prompt.\n"
        "Preserve the exact visual anchors.\n"
        "Do not add unsupported camera or lighting claims.\n\n"
        f"```json\n{json.dumps(observation, ensure_ascii=False, indent=2)}\n```"
    )
    payload = {
        "model": text_model,
        "messages": [
            {"role": "system", "content": PROMPT_SYNTHESIZE_SYSTEM},
            {"role": "user", "content": user_content},
        ],
        "stream": False,
        "format": "json",
        "think": False,  # CLAUDE.md rule — gemma4-un reasoning 모델 기본 OFF
        "keep_alive": resolved_keep_alive,
        "options": {"temperature": 0.4, "num_ctx": 6144},
    }
    try:
        raw = await call_chat_payload(
            ollama_url=ollama_url,
            payload=payload,
            timeout=timeout,
        )
    except Exception as e:
        log.warning("prompt_synthesize call failed (%s): %s", text_model, e)
        return _empty_result()

    parsed = _parse_strict_json(raw) if raw else None
    if not isinstance(parsed, dict):
        log.warning("prompt_synthesize JSON parse failed (raw len=%d)", len(raw))
        _c.debug_log("prompt_synthesize.parse_failed", raw[:500] if raw else "")
        return _empty_result()

    result = {
        "summary": _coerce_str(parsed.get("summary")),
        "positive_prompt": _coerce_str(parsed.get("positive_prompt")),
        "negative_prompt": _coerce_str(parsed.get("negative_prompt")),
        "key_visual_anchors": parsed.get("key_visual_anchors") or [],
        "uncertain": parsed.get("uncertain") or [],
    }
    _c.debug_log("prompt_synthesize.result", result)
    return result


def _empty_result() -> dict[str, Any]:
    return {
        "summary": "",
        "positive_prompt": "",
        "negative_prompt": "",
        "key_visual_anchors": [],
        "uncertain": [],
    }
```

- [ ] **Step 2: 단위 테스트 박기 (5 케이스)**

```python
# backend/tests/test_prompt_synthesize.py
"""prompt_synthesize — Ollama 호출 mock 기반 단위 테스트."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from studio.vision_pipeline.prompt_synthesize import (
    PROMPT_SYNTHESIZE_SYSTEM,
    synthesize_prompt,
)


@pytest.mark.asyncio
class TestPromptSynthesize:
    """합성 단계 — Ollama text model mock + 4 슬롯 결과."""

    async def test_returns_4_slots_on_success(self) -> None:
        """정상 응답 → 4 슬롯 + 2 list 반환."""
        mock_response = {
            "summary": "An East Asian young adult woman at a music festival.",
            "positive_prompt": "young adult woman, East Asian features, ...",
            "negative_prompt": "smiling, dry hair, studio background, blurry",
            "key_visual_anchors": ["wet hair", "winking", "neon stage"],
            "uncertain": ["specific drink type"],
        }
        with patch(
            "studio.vision_pipeline.prompt_synthesize.call_chat_payload",
            new=AsyncMock(return_value=json.dumps(mock_response)),
        ):
            result = await synthesize_prompt(
                {"subjects": [{"apparent_age_group": "young adult"}]},
                text_model="gemma4-un:latest",
                timeout=120.0,
                ollama_url="http://localhost:11434",
            )
        assert result["summary"] == mock_response["summary"]
        assert result["positive_prompt"] == mock_response["positive_prompt"]
        assert result["negative_prompt"] == mock_response["negative_prompt"]
        assert result["key_visual_anchors"] == mock_response["key_visual_anchors"]
        assert result["uncertain"] == mock_response["uncertain"]

    async def test_returns_empty_on_empty_observation(self) -> None:
        """빈 observation 입력 → 빈 결과 (Ollama 호출 안 함)."""
        with patch(
            "studio.vision_pipeline.prompt_synthesize.call_chat_payload",
            new=AsyncMock(return_value=""),
        ) as mock_call:
            result = await synthesize_prompt(
                {},
                text_model="gemma4-un:latest",
                timeout=60.0,
                ollama_url="http://localhost:11434",
            )
        mock_call.assert_not_called()
        assert result["positive_prompt"] == ""

    async def test_returns_empty_on_call_exception(self) -> None:
        """Ollama 호출 예외 시 빈 결과."""
        with patch(
            "studio.vision_pipeline.prompt_synthesize.call_chat_payload",
            new=AsyncMock(side_effect=TimeoutError("text model timeout")),
        ):
            result = await synthesize_prompt(
                {"subjects": [{}]},
                text_model="gemma4-un:latest",
                timeout=60.0,
                ollama_url="http://localhost:11434",
            )
        assert result["positive_prompt"] == ""
        assert result["key_visual_anchors"] == []

    async def test_payload_uses_think_false_and_synthesize_sampling(self) -> None:
        """Ollama payload 가 think=False (gemma4 rule) + temperature 0.4 + num_ctx 6144 로 호출."""
        captured: dict = {}

        async def capture(*, ollama_url: str, payload: dict, timeout: float) -> str:
            captured.update(payload)
            return "{}"

        with patch(
            "studio.vision_pipeline.prompt_synthesize.call_chat_payload",
            new=AsyncMock(side_effect=capture),
        ):
            await synthesize_prompt(
                {"subjects": [{}]},
                text_model="gemma4-un:latest",
                timeout=60.0,
                ollama_url="http://localhost:11434",
                keep_alive="5m",
            )
        assert captured["think"] is False
        assert captured["format"] == "json"
        assert captured["keep_alive"] == "5m"
        assert captured["options"]["temperature"] == 0.4
        assert captured["options"]["num_ctx"] == 6144

    def test_system_prompt_forbids_boilerplate_unless_supported(self) -> None:
        """system prompt 가 boilerplate 조건부 금지 + 150~260 word + adult lock 명시."""
        assert "150 to 260 words" in PROMPT_SYNTHESIZE_SYSTEM
        assert "muted earth tones" in PROMPT_SYNTHESIZE_SYSTEM  # 금지 리스트 안에
        assert "fictional and adult" in PROMPT_SYNTHESIZE_SYSTEM
        assert "Do not invent details that contradict" in PROMPT_SYNTHESIZE_SYSTEM
```

- [ ] **Step 3: 테스트 실행 + 회귀**

Run: `cd D:\AI-Image-Studio\backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_prompt_synthesize.py -v`
Expected: 5 PASS

Run: `cd D:\AI-Image-Studio\backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ --tb=short -q`
Expected: 신규 테스트 PASS + 기존 regression 0

- [ ] **Step 4: 커밋**

```bash
git add backend/studio/vision_pipeline/prompt_synthesize.py backend/tests/test_prompt_synthesize.py
git commit -m "$(cat <<'EOF'
feat(vision): prompt_synthesize 2-stage 편집자 (2-stage Phase 4)

ChatGPT(하루) 정공법 §"Text 모델용 시스템 프롬프트" 그대로 채택.
Text 모델 (gemma4-un:latest 26B) 이 vision observation JSON 받아
positive_prompt + negative_prompt + summary + key_visual_anchors
+ uncertain 합성.

Sampling (ChatGPT 2차 리뷰 권장):
  - temperature 0.4 (합성 약간 낮춤)
  - num_ctx 6144 (text-only 라 vision 보다 여유)
  - keep_alive: env var STUDIO_OLLAMA_KEEP_ALIVE (default "5m")

think=False 필수 (CLAUDE.md gemma4-un rule). 빈 observation 입력
시 Ollama 호출 안 함 (비용 절약). debug_log() 호출 — STUDIO_VISION_DEBUG=1
시 result/parse_failed 출력.

원칙: Text 는 관찰 메모를 프롬프트로 만드는 편집자.

테스트 5 신규 (Ollama mock 기반).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: `image_detail.py` 오케스트레이션 교체

**Files:**
- Modify: `backend/studio/vision_pipeline/image_detail.py` (analyze_image_detailed 내부 교체)
- Modify: `backend/studio/vision_pipeline/__init__.py` (새 함수 facade re-export)
- Create: `backend/tests/test_image_detail_v3.py` (통합 4 테스트)

### Task 5.1: 옛 1-shot 함수 제거 + 새 오케스트레이션 박기

- [ ] **Step 1: image_detail.py 교체 — 옛 SYSTEM_VISION_RECIPE_V2 + _call_vision_recipe_v2 제거, 새 오케스트레이션**

```python
# backend/studio/vision_pipeline/image_detail.py
"""
vision_pipeline/image_detail.py - Vision Recipe v3 (2-stage 분업 · 2026-05-03).

ChatGPT(하루) 정공법 채택. 옛 1-shot SYSTEM_VISION_RECIPE_V2 제거.

흐름:
  1. vision_observe.observe_image(image_bytes) → observation JSON
  2. prompt_synthesize.synthesize_prompt(observation) → 4 슬롯 (summary,
     positive_prompt, negative_prompt, key_visual_anchors, uncertain)
  3. banned_terms.filter_banned(positive_prompt, observation) → 후처리 필터
  4. observation_mapping.map_observation_to_slots(observation) → 5 슬롯
     (composition, subject, clothing_or_materials, environment,
      lighting_camera_style)
  5. translate_to_korean(summary) → ko
  6. VisionAnalysisResult 반환 (시그니처 + 9 슬롯 호환)

외부 호환: analyze_image_detailed() 시그니처 100% 유지.
폴백 (ChatGPT 2차 리뷰 보강):
  - vision 실패 (observation 빈 dict): provider="fallback", fallback=True
  - text 실패 (synthesize 빈 결과): observation_mapping 기반 짧은
    positive_prompt 자동 합성 ("{subject}, {clothing}, {environment},
    {lighting}, {composition}, realistic photo") + summary 1 문장.
    빈 문자열 안 줌 — 프론트가 비전 분석 망함처럼 보이지 않게.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..presets import DEFAULT_OLLAMA_ROLES
from ..prompt_pipeline import translate_to_korean
from . import _common as _c
from . import banned_terms as _bt
from . import observation_mapping as _om
from . import prompt_synthesize as _ps
from . import vision_observe as _vo


@dataclass
class VisionAnalysisResult:
    """analyze_image_detailed 결과 (v3 · 2-stage 분업).

    레거시 필드 호환:
      - en: 메인 영문 (summary + positive_prompt 합본 또는 폴백 단락)
      - ko: 한국어 번역 (실패 시 None)
      - fallback=True: 비전 호출 자체 실패
      - ko=None: 번역만 실패

    Vision Recipe v3 9 슬롯:
      모두 빈 문자열 가능. 폴백 경로 (vision 실패) 에서 모두 "" 로 채움.
      text 실패 시 (synthesize 빈 결과) 는 observation_mapping 기반
      짧은 positive_prompt 자동 합성 — summary/positive 빈 문자열 X.
    """

    en: str
    ko: str | None
    provider: str  # "ollama" | "fallback"
    fallback: bool

    summary: str = ""
    positive_prompt: str = ""
    negative_prompt: str = ""
    composition: str = ""
    subject: str = ""
    clothing_or_materials: str = ""
    environment: str = ""
    lighting_camera_style: str = ""
    uncertain: str = ""


async def analyze_image_detailed(
    image_bytes: bytes,
    *,
    vision_model: str | None = None,
    text_model: str | None = None,
    ollama_url: str | None = None,
    timeout: float = _c.DEFAULT_TIMEOUT,
    width: int = 0,
    height: int = 0,
    progress_callback: _c.ProgressCallback | None = None,
) -> VisionAnalysisResult:
    """단일 이미지 → 2-stage 분업 (vision 관찰 + text 합성) → 9 슬롯 + 한글 번역."""
    resolved_vision = vision_model or DEFAULT_OLLAMA_ROLES.vision
    resolved_text = text_model or DEFAULT_OLLAMA_ROLES.text
    resolved_url = ollama_url or _c._DEFAULT_OLLAMA_URL

    async def _signal(stage_type: str) -> None:
        if progress_callback is None:
            return
        try:
            await progress_callback(stage_type)
        except Exception as cb_err:  # pragma: no cover
            _c.log.info("progress_callback raised (non-fatal): %s", cb_err)

    # Stage 1: Vision observation
    await _signal("vision-call")
    observation = await _vo.observe_image(
        image_bytes,
        width=width,
        height=height,
        vision_model=resolved_vision,
        timeout=timeout,
        ollama_url=resolved_url,
    )

    if not observation:
        # Vision 자체 실패 — 옛 호환: fallback=True
        return VisionAnalysisResult(
            en="",
            ko=None,
            provider="fallback",
            fallback=True,
        )

    # Stage 2: Text synthesis
    await _signal("prompt-synthesize")
    synthesized = await _ps.synthesize_prompt(
        observation,
        text_model=resolved_text,
        timeout=timeout,
        ollama_url=resolved_url,
    )

    # Stage 3: Banned-term 후처리 (관찰 근거 없는 boilerplate 제거)
    raw_positive = synthesized.get("positive_prompt", "") or ""
    filtered_positive = _bt.filter_banned(raw_positive, observation)
    _c.debug_log("image_detail.filtered_positive", filtered_positive)

    # Stage 4: 5 슬롯 observation 매핑
    mapped_slots = _om.map_observation_to_slots(observation)

    # Stage 5: 통합 결과 조립 + Text 실패 fallback (ChatGPT 2차 리뷰)
    summary = synthesized.get("summary", "") or ""
    negative_prompt = synthesized.get("negative_prompt", "") or ""
    uncertain_list = synthesized.get("uncertain", []) or []
    uncertain_str = ", ".join(str(u) for u in uncertain_list if u)

    # ChatGPT 2차 리뷰 — text 실패 시 observation 기반 짧은 fallback positive 합성.
    # 빈 문자열 보단 훨씬 나음. summary 도 1 문장 fallback.
    if not filtered_positive:
        fallback_parts = [
            mapped_slots["subject"],
            mapped_slots["clothing_or_materials"],
            mapped_slots["environment"],
            mapped_slots["lighting_camera_style"],
            mapped_slots["composition"],
            "realistic photo",
        ]
        filtered_positive = ", ".join(p for p in fallback_parts if p).strip(", ").strip()
        _c.debug_log("image_detail.text_fallback_positive", filtered_positive)

    if not summary and mapped_slots["subject"]:
        summary = (
            f"Recovered observation: {mapped_slots['subject']} "
            f"in {mapped_slots['environment'] or 'unspecified setting'}."
        ).strip()

    en_combined = summary
    if filtered_positive:
        en_combined = (
            f"{summary}\n\n{filtered_positive}" if summary else filtered_positive
        )

    # Stage 6: 한국어 번역 (summary 만 — positive 는 t2i 입력용 영문 유지)
    ko: str | None = None
    if summary:
        await _signal("translation")
        ko = await translate_to_korean(
            summary,
            model=resolved_text,
            timeout=60.0,
            ollama_url=resolved_url,
        )

    return VisionAnalysisResult(
        en=en_combined,
        ko=ko,
        provider="ollama",
        fallback=False,
        summary=summary,
        positive_prompt=filtered_positive,
        negative_prompt=negative_prompt,
        composition=mapped_slots["composition"],
        subject=mapped_slots["subject"],
        clothing_or_materials=mapped_slots["clothing_or_materials"],
        environment=mapped_slots["environment"],
        lighting_camera_style=mapped_slots["lighting_camera_style"],
        uncertain=uncertain_str,
    )
```

- [ ] **Step 2: __init__.py facade 갱신 — 옛 SYSTEM_VISION_RECIPE_V2 export 제거 (옛 함수 사용처 0 검증 후)**

먼저 옛 함수 사용처 grep:

Run: `cd D:\AI-Image-Studio && grep -rn "SYSTEM_VISION_RECIPE_V2\|_call_vision_recipe_v2\|SYSTEM_VISION_DETAILED" backend/ --include="*.py"`
Expected: image_detail.py 옛 코드 자체 외에는 없음 (또는 __init__.py facade re-export 만)

- [ ] **Step 3: __init__.py 갱신**

```python
# backend/studio/vision_pipeline/__init__.py 의 image_detail 그룹 re-export 부분
# Phase 4.2 단계 4 — image_detail 그룹 (v3 2-stage 으로 교체 · 2026-05-03)
from .image_detail import (  # noqa: F401
    VisionAnalysisResult,
    analyze_image_detailed,
)

# 신규 sub-module facade re-export (테스트 patch site 일관성)
from .vision_observe import (  # noqa: F401
    VISION_OBSERVATION_SYSTEM,
    observe_image,
)
from .prompt_synthesize import (  # noqa: F401
    PROMPT_SYNTHESIZE_SYSTEM,
    synthesize_prompt,
)
from .banned_terms import (  # noqa: F401
    QUALITY_BOILERPLATE_TERMS,
    VISUAL_CONTRADICTION_TERMS,
    filter_banned,
)
from .observation_mapping import (  # noqa: F401
    map_observation_to_slots,
)
```

`__all__` 리스트도 갱신 — 옛 `SYSTEM_VISION_DETAILED`, `SYSTEM_VISION_RECIPE_V2`, `_call_vision_recipe_v2` 제거하고 신규 항목 추가:

```python
# image_detail / vision_observe / prompt_synthesize / banned_terms /
# observation_mapping 의 public 심볼 모두 __all__ 에 enumerate.
__all__ += [  # facade re-export
    # image_detail
    "VisionAnalysisResult",
    "analyze_image_detailed",
    # vision_observe
    "VISION_OBSERVATION_SYSTEM",
    "observe_image",
    # prompt_synthesize
    "PROMPT_SYNTHESIZE_SYSTEM",
    "synthesize_prompt",
    # banned_terms (2 그룹 — BANNED_PHRASES 옛 단일 리스트 제거)
    "QUALITY_BOILERPLATE_TERMS",
    "VISUAL_CONTRADICTION_TERMS",
    "filter_banned",
    # observation_mapping
    "map_observation_to_slots",
]
```

- [ ] **Step 4: 통합 테스트 박기 — test_image_detail_v3.py (4 케이스)**

```python
# backend/tests/test_image_detail_v3.py
"""image_detail.analyze_image_detailed v3 통합 테스트 (2-stage 분업)."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from studio.vision_pipeline.image_detail import (
    VisionAnalysisResult,
    analyze_image_detailed,
)


@pytest.mark.asyncio
class TestAnalyzeImageDetailedV3:
    """2-stage 통합 — vision_observe → prompt_synthesize → banned_terms → mapping."""

    async def test_full_success_path(self) -> None:
        """vision + text 모두 성공 → 9 슬롯 다 채워짐."""
        mock_observation: dict[str, Any] = {
            "image_orientation": "portrait",
            "framing": {"crop": "chest-up", "camera_angle": "slight upward"},
            "subjects": [
                {
                    "count_index": 1,
                    "apparent_age_group": "young adult",
                    "broad_visible_appearance": "East Asian female",
                    "expression": "winking",
                    "hair": "long wet dark hair",
                    "clothing": ["gray cropped tank with cutouts"],
                }
            ],
            "environment": {
                "location_type": "music festival outdoor at night",
                "background": ["neon MUSIC FESTIVAL sign"],
            },
            "lighting_and_color": {
                "visible_light_sources": ["red stage lights", "blue stage lights"],
                "dominant_colors": ["red", "blue"],
            },
            "photo_quality": {"depth_of_field": "shallow"},
        }
        mock_synthesized = {
            "summary": "East Asian young adult woman at music festival.",
            "positive_prompt": "young adult fictional East Asian woman, winking, ...",
            "negative_prompt": "smiling, dry hair, studio background",
            "key_visual_anchors": ["wet hair", "winking", "neon stage"],
            "uncertain": ["drink type"],
        }
        with (
            patch(
                "studio.vision_pipeline.image_detail._vo.observe_image",
                new=AsyncMock(return_value=mock_observation),
            ),
            patch(
                "studio.vision_pipeline.image_detail._ps.synthesize_prompt",
                new=AsyncMock(return_value=mock_synthesized),
            ),
            patch(
                "studio.vision_pipeline.image_detail.translate_to_korean",
                new=AsyncMock(return_value="동아시아 젊은 성인 여성이 음악 페스티벌에 있다."),
            ),
        ):
            result = await analyze_image_detailed(
                b"fake_image",
                width=832,
                height=1248,
                timeout=120.0,
            )

        assert isinstance(result, VisionAnalysisResult)
        assert result.fallback is False
        assert result.provider == "ollama"
        assert "winking" in result.positive_prompt
        assert result.summary == mock_synthesized["summary"]
        assert "smiling" in result.negative_prompt
        # observation 매핑 5 슬롯
        assert "East Asian female" in result.subject
        assert "music festival" in result.environment
        assert "red stage lights" in result.lighting_camera_style
        assert "cropped tank" in result.clothing_or_materials
        assert "chest-up" in result.composition
        assert result.uncertain == "drink type"
        assert result.ko is not None and "음악" in result.ko

    async def test_vision_failure_returns_fallback(self) -> None:
        """vision 호출 실패 → fallback=True (text 호출 안 함)."""
        with (
            patch(
                "studio.vision_pipeline.image_detail._vo.observe_image",
                new=AsyncMock(return_value={}),
            ),
            patch(
                "studio.vision_pipeline.image_detail._ps.synthesize_prompt",
                new=AsyncMock(return_value={}),
            ) as mock_synth,
        ):
            result = await analyze_image_detailed(
                b"fake",
                width=512,
                height=512,
            )
        assert result.fallback is True
        assert result.provider == "fallback"
        assert result.positive_prompt == ""
        mock_synth.assert_not_called()

    async def test_text_failure_uses_observation_fallback_positive(self) -> None:
        """text 합성 실패 → observation 기반 짧은 positive 자동 합성 (빈 문자열 X)."""
        mock_observation = {
            "subjects": [{"apparent_age_group": "young adult", "broad_visible_appearance": "Caucasian male"}],
            "environment": {"location_type": "studio"},
            "lighting_and_color": {"visible_light_sources": ["softbox key light"]},
        }
        with (
            patch(
                "studio.vision_pipeline.image_detail._vo.observe_image",
                new=AsyncMock(return_value=mock_observation),
            ),
            patch(
                "studio.vision_pipeline.image_detail._ps.synthesize_prompt",
                new=AsyncMock(return_value={
                    "summary": "",
                    "positive_prompt": "",
                    "negative_prompt": "",
                    "key_visual_anchors": [],
                    "uncertain": [],
                }),
            ),
            patch(
                "studio.vision_pipeline.image_detail.translate_to_korean",
                new=AsyncMock(return_value=None),
            ),
        ):
            result = await analyze_image_detailed(
                b"fake",
                width=512,
                height=512,
            )
        # text 실패라 fallback 은 아님 (vision 은 성공)
        assert result.fallback is False
        # ChatGPT 2차 리뷰 — text 실패해도 positive 빈 문자열 X (observation 기반 합성)
        assert result.positive_prompt != ""
        assert "Caucasian male" in result.positive_prompt
        assert "studio" in result.positive_prompt
        assert "softbox key light" in result.positive_prompt
        assert "realistic photo" in result.positive_prompt
        # summary 도 observation 기반 1 문장 fallback
        assert "Caucasian male" in result.summary
        # observation 5 슬롯은 그대로
        assert "Caucasian male" in result.subject
        assert "studio" in result.environment

    async def test_banned_terms_filter_applied(self) -> None:
        """positive_prompt 안 boilerplate 가 observation 근거 없으면 제거된다."""
        mock_observation = {
            "subjects": [{}],
            "lighting_and_color": {
                "visible_light_sources": ["neon stage lights"],
                "dominant_colors": ["red", "blue"],
            },
        }
        mock_synthesized = {
            "summary": "Subject at neon scene.",
            # positive_prompt 안에 banned 'muted earth tones' 박혀있음 — observation 에 근거 없음
            "positive_prompt": "subject standing, muted earth tones, neon background",
            "negative_prompt": "",
            "key_visual_anchors": [],
            "uncertain": [],
        }
        with (
            patch(
                "studio.vision_pipeline.image_detail._vo.observe_image",
                new=AsyncMock(return_value=mock_observation),
            ),
            patch(
                "studio.vision_pipeline.image_detail._ps.synthesize_prompt",
                new=AsyncMock(return_value=mock_synthesized),
            ),
            patch(
                "studio.vision_pipeline.image_detail.translate_to_korean",
                new=AsyncMock(return_value=None),
            ),
        ):
            result = await analyze_image_detailed(
                b"fake",
                width=512,
                height=512,
            )
        assert "muted earth tones" not in result.positive_prompt.lower()
        assert "neon" in result.positive_prompt
```

- [ ] **Step 5: 옛 test_vision_pipeline 스타일 테스트가 있다면 정리 — patch site 갱신**

Run: `cd D:\AI-Image-Studio && grep -rn "SYSTEM_VISION_RECIPE_V2\|_call_vision_recipe_v2" backend/tests/ --include="*.py"`
Expected: 옛 patch site 가 있다면 신규 patch site (`studio.vision_pipeline.image_detail._vo.observe_image` 등) 로 갱신 필요.

발견 시 Edit 으로 갱신. 없으면 skip.

- [ ] **Step 6: 테스트 실행 + 회귀**

Run: `cd D:\AI-Image-Studio\backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_image_detail_v3.py -v`
Expected: 4 PASS

Run: `cd D:\AI-Image-Studio\backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ --tb=short -q`
Expected: 신규 테스트 PASS + 기존 regression 0 (옛 test_vision_pipeline 의 patch site 가 깨졌으면 Step 5 에서 갱신 후 다시 검증)

- [ ] **Step 7: 커밋**

```bash
git add backend/studio/vision_pipeline/image_detail.py backend/studio/vision_pipeline/__init__.py backend/tests/test_image_detail_v3.py
# Step 5 에서 갱신한 옛 테스트 파일이 있으면 같이 add
git commit -m "$(cat <<'EOF'
feat(vision): image_detail.py 2-stage 오케스트레이션 교체 (Phase 5)

옛 1-shot SYSTEM_VISION_RECIPE_V2 제거. analyze_image_detailed()
시그니처 100% 유지하면서 내부를 6 단계로 교체:

  1. vision_observe.observe_image — observation JSON
  2. prompt_synthesize.synthesize_prompt — 4 슬롯 합성
  3. banned_terms.filter_banned — boilerplate 후처리
  4. observation_mapping.map_observation_to_slots — 5 슬롯 매핑
  5. translate_to_korean — summary 한글 번역
  6. VisionAnalysisResult — 9 슬롯 통합 (frontend 호환)

폴백 (ChatGPT 2차 리뷰 보강):
  - vision 실패 → provider="fallback", fallback=True
  - text 실패 → observation 기반 짧은 positive 자동 합성
    "{subject}, {clothing}, {environment}, {lighting}, {composition},
    realistic photo" + summary 1 문장 (빈 문자열 X)

debug_log() 호출 — STUDIO_VISION_DEBUG=1 시 filtered_positive /
text_fallback_positive 출력.

facade __init__.py 갱신 — 신규 5 sub-module 항목 re-export.

테스트 4 신규 통합 + 옛 patch site 갱신.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6: `presets.py` env var 헬퍼 + default 변경 (단순 A안)

**Files:**
- Modify: `backend/studio/presets.py` (DEFAULT_OLLAMA_ROLES 기본값 + 2 env helper)

ChatGPT 2차 리뷰 — A안 채택: **auto-detect fallback chain 빼고 단순 default + env var 만**. 모델 없으면 Ollama 가 알아서 에러. MVP 안에 detect 로직 안 박음 (귀찮은 만큼 가치 작음).

### Task 6.1: env var 헬퍼 + default 단순화

- [ ] **Step 1: presets.py 의 DEFAULT_OLLAMA_ROLES 수정 — env var 헬퍼 + keep_alive resolver**

먼저 현재 코드 read:

Run: `grep -n "DEFAULT_OLLAMA_ROLES\|OllamaRoles\|qwen2.5vl" backend/studio/presets.py | head -10`

발견된 위치 보고 Edit 으로 갱신. 패턴 가정:

```python
# Before (예시 — 실제 코드와 달라질 수 있음)
DEFAULT_OLLAMA_ROLES = OllamaRoles(
    vision="qwen2.5vl:7b",
    text="gemma4-un:latest",
)
```

```python
# After
import os

def _env_or(default: str, env_key: str) -> str:
    """env var 있으면 그것, 없으면 default 반환 (양쪽 strip)."""
    value = (os.environ.get(env_key) or "").strip()
    return value if value else default


def resolve_ollama_keep_alive() -> str:
    """STUDIO_OLLAMA_KEEP_ALIVE env var 우선 (default '5m').

    ChatGPT 2차 리뷰 — keep_alive '0' 은 매 요청마다 모델 swap 발생해서
    사용자 체감 느림. 실사용 default '5m' 으로 변경. 개발 중엔
    `set STUDIO_OLLAMA_KEEP_ALIVE=0` 으로 swap.
    """
    return _env_or("5m", "STUDIO_OLLAMA_KEEP_ALIVE")


DEFAULT_OLLAMA_ROLES = OllamaRoles(
    # 2026-05-03 vision default qwen2.5vl:7b → qwen3-vl:8b (ChatGPT 정공법)
    # env var STUDIO_VISION_MODEL 로 swap 가능 (qwen2.5vl:7b 폴백 등)
    # MVP — auto-detect fallback chain 없음 (모델 없으면 Ollama 가 에러)
    vision=_env_or("qwen3-vl:8b", "STUDIO_VISION_MODEL"),
    text=_env_or("gemma4-un:latest", "STUDIO_TEXT_MODEL"),
)
```

- [ ] **Step 2: 회귀 검증 (presets 변경이 기존 테스트 안 깨는지)**

Run: `cd D:\AI-Image-Studio\backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ --tb=short -q`
Expected: 기존 regression 0

- [ ] **Step 3: env var 단위 테스트 추가 (3 케이스 — vision/text/keep_alive)**

`backend/tests/test_presets_env.py` (NEW):

```python
"""presets DEFAULT_OLLAMA_ROLES + resolve_ollama_keep_alive env var 동작 검증."""

import importlib

import pytest


def test_vision_model_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    """STUDIO_VISION_MODEL env var 설정 시 default 무시하고 그것 사용."""
    monkeypatch.setenv("STUDIO_VISION_MODEL", "qwen2.5vl:7b")
    # presets 모듈 reload — module-level constant 가 env 다시 읽음
    from studio import presets
    importlib.reload(presets)
    assert presets.DEFAULT_OLLAMA_ROLES.vision == "qwen2.5vl:7b"


def test_vision_model_default_when_env_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    """STUDIO_VISION_MODEL 없으면 default qwen3-vl:8b."""
    monkeypatch.delenv("STUDIO_VISION_MODEL", raising=False)
    from studio import presets
    importlib.reload(presets)
    assert presets.DEFAULT_OLLAMA_ROLES.vision == "qwen3-vl:8b"


def test_keep_alive_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    """STUDIO_OLLAMA_KEEP_ALIVE env var 우선 (default '5m')."""
    monkeypatch.setenv("STUDIO_OLLAMA_KEEP_ALIVE", "0")
    from studio import presets
    importlib.reload(presets)
    assert presets.resolve_ollama_keep_alive() == "0"

    monkeypatch.delenv("STUDIO_OLLAMA_KEEP_ALIVE", raising=False)
    importlib.reload(presets)
    assert presets.resolve_ollama_keep_alive() == "5m"
```

Run: `cd D:\AI-Image-Studio\backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_presets_env.py -v`
Expected: 3 PASS

Run: `cd D:\AI-Image-Studio\backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ --tb=short -q`
Expected: 신규 3 PASS + 기존 regression 0

- [ ] **Step 4: 커밋**

```bash
git add backend/studio/presets.py backend/tests/test_presets_env.py
git commit -m "$(cat <<'EOF'
feat(vision): default qwen3-vl:8b + env var (model + keep_alive) (Phase 6)

ChatGPT 2차 리뷰 채택 — A안 (단순 default + env var, auto-detect X).

DEFAULT_OLLAMA_ROLES.vision 기본값 qwen2.5vl:7b → qwen3-vl:8b
(ChatGPT 정공법). env var:
  - STUDIO_VISION_MODEL — vision 모델 swap (qwen2.5vl:7b 폴백 등)
  - STUDIO_TEXT_MODEL — text 모델 swap
  - STUDIO_OLLAMA_KEEP_ALIVE — keep_alive (default '5m' 실사용 ·
    개발 중 '0' 으로 swap 가능)

resolve_ollama_keep_alive() 헬퍼 신설 — vision_observe /
prompt_synthesize 가 호출.

MVP — 모델 없으면 Ollama 가 알아서 에러 (auto-detect 안 박음).

테스트 3 신규 (env override + default · vision/text/keep_alive).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7: 풀 회귀 검증

### Task 7.1: 전체 검증 사이클

- [ ] **Step 1: pytest 풀**

Run: `cd D:\AI-Image-Studio\backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ --tb=short -q`
Expected: 신규 24~26 테스트 PASS + 기존 regression 0 (옛 vision_pipeline 1-shot 테스트가 있다면 patch site 갱신 또는 삭제)

- [ ] **Step 2: vitest 풀**

Run: `cd D:\AI-Image-Studio\frontend && npm test 2>&1 | tail -15`
Expected: 178 PASS (변동 없음 — frontend 변경 0)

- [ ] **Step 3: tsc + lint clean**

Run: `cd D:\AI-Image-Studio\frontend && npx tsc --noEmit 2>&1 | tail -5 && npm run lint 2>&1 | tail -5`
Expected: 둘 다 clean

- [ ] **Step 4: dead code 검색 — 옛 SYSTEM_VISION_RECIPE_V2 / _call_vision_recipe_v2 / SYSTEM_VISION_DETAILED 잔존 0**

Run: `cd D:\AI-Image-Studio && grep -rn "SYSTEM_VISION_RECIPE_V2\|_call_vision_recipe_v2\|SYSTEM_VISION_DETAILED" backend/ --include="*.py"`
Expected: 0 결과 (또는 git history 주석만)

- [ ] **Step 5: 검증 결과 요약 commit (변경 없으면 skip)**

회귀 검증 commit 따로 안 박음 — 다음 phase (사용자 검증) 와 함께.

---

## Phase 8: 사용자 브라우저 검증 (수동)

### Task 8.1: 카리나 이미지 재검증 (ChatGPT rubric 기반)

- [ ] **Step 1: backend 재시작 안내**

```powershell
# 사용자에게 안내 — backend uvicorn 재시작 필요
cd D:\AI-Image-Studio\backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --no-access-log
```

또는 `start.bat` 재시작. 디버그 정보 보고 싶으면 `set STUDIO_VISION_DEBUG=1` 후 시작.

- [ ] **Step 2: qwen3-vl:8b 다운 확인**

Run: `ollama list 2>&1 | grep -i qwen`
- qwen3-vl:8b 있으면: 그대로 default 사용
- qwen3-vl:8b 없음: env var 로 fallback `set STUDIO_VISION_MODEL=qwen2.5vl:7b` 안내

- [ ] **Step 3: 같은 카리나 이미지로 /vision 재분석**

브라우저 → http://localhost:3000/vision → 카리나 이미지 업로드 → 분석.

- [ ] **Step 4: ChatGPT rubric 100점 채점**

| 항목 | 점수 | Pass 여부 |
|---|---|---|
| 비 오는 페스티벌 유지 | 10 | ☐ |
| 젖은 긴 머리 | 10 | ☐ |
| 윙크 | 15 | ☐ |
| 컵/마시는 포즈 | 10 | ☐ |
| 비대칭 크로스 스트랩 컷아웃 탑 | 15 | ☐ |
| 베이지 카고/유틸리티 팬츠 | 10 | ☐ |
| 우비 입은 군중 | 10 | ☐ |
| 빨강/파랑 네온 조명 | 10 | ☐ |
| 세로 상반신 구도 | 5 | ☐ |
| 반복/보일러플레이트 없음 | 5 | ☐ |
| **합계** | 100 | |

- **80점 이상**: 실사용 가능 → master merge 검토
- **70점대**: 후처리 보강 필요 → banned_terms 추가 + 재시도
- **60점 이하**: model/architecture 추가 변경 필요 → Codex 재위임

- [ ] **Step 5: 점수 기반 결정 — Pass / Adjust / Pivot**

Pass (80+): Phase 9 진행 (사용자 결정 시 master merge)
Adjust (70~79): banned_terms 리스트 보강 또는 system prompt 미세 조정 후 재검증
Pivot (60-): qwen3-vl:8b vs qwen2.5vl:7b 비교 또는 ChatGPT 재위임

---

## Phase 9: 사용자 결정 시 master merge

### Task 9.1: master 머지 (사용자 명시 요청 시에만)

- [ ] **Step 1: 사용자 컨펌 받기**

브라우저 검증 80점+ 통과 후 사용자에게:
> "검증 결과 X점이야. master 머지할까?"

- [ ] **Step 2: master merge (사용자 OK 시)**

```bash
git checkout master
git merge --no-ff <feature-branch> -m "feat(vision): 2-stage pipeline (vision 관찰 + text 합성) — ChatGPT 정공법

옛 qwen2.5vl:7b 1-shot 의 catastrophic failures (boilerplate copy /
anti-pattern ignorance / observation error / repetition collapse)
해결.

Phase 1-6: banned_terms / observation_mapping / vision_observe /
prompt_synthesize / image_detail v3 / presets env var.

테스트 424 → 448 PASS (24 신규). frontend 변경 0줄.
검증: 카리나 이미지 ChatGPT rubric X/100."
git push origin master
```

---

## Self-Review Checklist (post-write · ChatGPT 2차 리뷰 8 항목 반영)

### 1. Spec coverage

- [x] ChatGPT 1차 답변 §"Vision 모델용 시스템 프롬프트" → Phase 3 (`vision_observe.py`)
- [x] ChatGPT 1차 답변 §"Text 모델용 시스템 프롬프트" → Phase 4 (`prompt_synthesize.py`)
- [x] ChatGPT 1차 답변 §"후처리 banned_terms" → Phase 1 (`banned_terms.py` · 2 그룹)
- [x] ChatGPT 1차 답변 §"추천 파이프라인 6 stage" → Phase 5 (`image_detail.py` 오케스트레이션)
- [x] ChatGPT 1차 답변 §"qwen3-vl:8b 비전 모델 교체 테스트" → Phase 6 (env var + default)
- [x] ChatGPT 1차 답변 §"테스트 100점 rubric" → Phase 8 (사용자 브라우저 검증)
- [x] **ChatGPT 2차 리뷰 #1**: vision num_ctx 4096 → Phase 3 코드 + 테스트
- [x] **ChatGPT 2차 리뷰 #2**: vision temperature 0.2 → Phase 3 코드 + 테스트
- [x] **ChatGPT 2차 리뷰 #3**: prompt_synthesize temperature 0.4 + num_ctx 6144 → Phase 4 코드 + 테스트
- [x] **ChatGPT 2차 리뷰 #4**: keep_alive env var (default '5m') → Phase 6 (resolver) + Phase 3/4 (호출)
- [x] **ChatGPT 2차 리뷰 #5**: banned_terms 2 그룹 분리 (VISUAL_CONTRADICTION 강제 / QUALITY MVP 미적용) → Phase 1
- [x] **ChatGPT 2차 리뷰 #6**: STUDIO_VISION_DEBUG 옵션 → Phase 1 (`_common.debug_log` 헬퍼) + Phase 3/4/5 호출
- [x] **ChatGPT 2차 리뷰 #7**: text 실패 fallback observation 기반 합성 → Phase 5 (Stage 5)
- [x] **ChatGPT 2차 리뷰 #8**: auto-detect fallback 빼고 단순 default → Phase 6 (A안)
- [x] **테스트 카운트 표현**: 절대값 (429/432/446) → "신규 PASS + 기존 regression 0" 으로 변경 — 모든 phase
- [x] 우리 진단서 §"frontend 호환 100%" → Phase 5 (시그니처 유지) + Phase 7 (vitest 178 변동 없음 확인)

### 2. Placeholder scan

- ✅ "TBD" / "TODO" / "implement later" 0건
- ✅ "Add appropriate error handling" 0건 — 모든 폴백 분기 명시
- ✅ "Similar to Task N" 0건 — 모든 코드 블록 풀 인용
- ✅ "Write tests for the above" 0건 — 모든 테스트 코드 풀 인용

### 3. Type consistency

- ✅ `VisionAnalysisResult` Phase 5 정의 — 9 슬롯 + en/ko/provider/fallback (옛과 동일)
- ✅ `observation: dict[str, Any]` — Phase 3/4/5 일관
- ✅ `synthesize_prompt()` 반환: `dict[str, Any]` — Phase 4 / Phase 5 일관 (5 키)
- ✅ `map_observation_to_slots()` 반환: `dict[str, str]` — Phase 2 / Phase 5 일관 (5 키)
- ✅ `filter_banned(positive_prompt: str, observation: dict)` — Phase 1 / Phase 5 일관
- ✅ `observe_image()` / `synthesize_prompt()` 둘 다 `keep_alive: str | None = None` 옵셔널 (default `resolve_ollama_keep_alive()`)
- ✅ `_common.debug_log(stage: str, payload: Any)` — Phase 1 정의 / Phase 3/4/5 호출 일관

### 4. 외부 호환

- ✅ `analyze_image_detailed()` 시그니처 유지 — `pipelines/vision_analyze.py` / `routes/vision.py` 0줄 변경
- ✅ `VisionAnalysisResult` 9 슬롯 동일 — frontend `RecipeV2View` / `PromptToggle` 0줄 변경
- ✅ History DB v8 schema 그대로 — migration 불필요
- ✅ `BANNED_PHRASES` (옛 단일 리스트) → `VISUAL_CONTRADICTION_TERMS` + `QUALITY_BOILERPLATE_TERMS` 2 그룹 (외부 사용처 0 — Phase 1 신규 모듈이라 호환 깨질 코드 없음)
