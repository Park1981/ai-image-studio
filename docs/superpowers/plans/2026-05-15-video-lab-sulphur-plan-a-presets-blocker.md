# Video Lab Sulphur — Plan A (Preset + Phase 1.5 Hard Blocker)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lab 영상 검증의 backend 진실원 (`lab_presets.py`) 을 신설하고, Sulphur LoRA 두 파일이 ComfyUI 워크플로우에서 정상 호환됨을 hard blocker 1회 실 호출로 입증한다. Plan B (backend 라우터/파이프라인) 와 Plan C (frontend) 의 의존 토대.

**Architecture:** TDD 로 dataclass + dispatch 함수 박제 (pytest) → ComfyUI `/object_info` 캡처 스크립트 + workflow class_type 검증 스크립트 → 사용자 LoRA 파일 다운로드 → 1회 실 호출 통과 결과 박제. backend 만 변경, frontend / routes / pipeline 은 Plan B/C 영역.

**Tech Stack:** Python 3.13 · pytest · aiohttp / httpx (ComfyUI HTTP) · dataclasses · `frontend/lib/lab-presets.ts` mirror 는 Plan C 영역 (지금 X)

**참조 spec:** `docs/superpowers/specs/2026-05-15-video-lab-framework-sulphur-design.md` v4

---

## File Structure

이 plan 이 만들거나 수정할 파일:

| 파일 | 책임 |
|---|---|
| `docs/superpowers/specs/2026-05-15-video-lab-framework-sulphur-design.md` | spec v4 박제 (이미 작성됨 · commit 만) |
| `docs/superpowers/plans/2026-05-15-video-lab-sulphur-plan-a-presets-blocker.md` | 본 plan (이미 작성됨 · commit 만) |
| `backend/studio/lab_presets.py` (**신규**) | LabLoraOption / LabVideoModelPreset dataclass + LAB_LTX_SULPHUR_PRESET 정의 + get_lab_video_preset() dispatch |
| `backend/tests/test_lab_presets.py` (**신규**) | dataclass + 프리셋 + dispatch 단위 테스트 |
| `backend/scripts/capture_comfy_object_info.py` (**신규**) | ComfyUI `/object_info` JSON 캡처 도구 (Wan22 spec Phase 1.5 패턴 재사용) |
| `backend/scripts/verify_lab_workflow_class_types.py` (**신규**) | 캡처된 object_info 와 Sulphur LoRA / LTX class_type 호환 검증 |
| `docs/superpowers/plans/2026-05-15-video-lab-sulphur-plan-a-results.md` (**신규 · Task 6**) | Phase 1.5 통과 결과 박제 (실측 데이터 + 결정 사항) |

**격리 원칙**: 본 plan 은 `studio/presets.py` / `studio/routes/` / `studio/pipelines/` 등 production 코드를 **건드리지 않음**. lab_presets.py 만 신설. Plan B 에서 routes/lab.py + pipelines/video_lab.py 가 lab_presets 를 import.

---

## Task 0: 브랜치 생성 + spec v4 / plan A 박제 commit

**Files:**
- Modify: 없음 (git 작업 + commit)

- [ ] **Step 1: 현재 git 상태 확인**

```bash
git status
git branch --show-current
```

기대 결과: `master` 브랜치 + clean tree (또는 spec v4 / plan A 만 untracked).

- [ ] **Step 2: feature 브랜치 생성**

```bash
git checkout -b feature/video-lab-sulphur-plan-a
```

기대 결과: `Switched to a new branch 'feature/video-lab-sulphur-plan-a'`.

- [ ] **Step 3: spec v4 + plan A 함께 commit**

```bash
git add docs/superpowers/specs/2026-05-15-video-lab-framework-sulphur-design.md
git add docs/superpowers/plans/2026-05-15-video-lab-sulphur-plan-a-presets-blocker.md
git commit -m "$(cat <<'EOF'
docs(specs): video lab framework + sulphur 설계 v4 + Plan A 박제

- spec v4: brainstorming → Codex 1/2/3차 리뷰 반영
  - history DB mode 신설 폐기 (옵션 B · mode=video 유지)
  - PipelineMode lab_video 추가 시 동기화 5 곳 (ProgressModal 3 + PipelineTimeline 2)
  - LabLoraOption.applies_to = 두 entry expand 정책
  - Phase 1.5 hard blocker 통과 기준 강화

- Plan A: preset + Phase 1.5 ComfyUI hard blocker (약 6 task)
EOF
)"
```

기대 결과: `[feature/video-lab-sulphur-plan-a XXXXXXX] docs(specs): ...`

---

## Task 1: LabLoraOption + LabVideoModelPreset dataclass 신설

**Files:**
- Create: `backend/studio/lab_presets.py`
- Create: `backend/tests/test_lab_presets.py`

- [ ] **Step 1: 테스트 먼저 작성 — dataclass 형태 검증**

`backend/tests/test_lab_presets.py` 신규 작성:

```python
"""lab_presets.py 의 dataclass / 프리셋 / dispatch 단위 테스트.

Plan A: spec 박제 (2026-05-15-video-lab-framework-sulphur-design.md) v4 따라.
- dataclass 구조 검증 (frozen / 필드 타입)
- LAB_LTX_SULPHUR_PRESET 의 4 LoraOption 정의 정확성
- get_lab_video_preset() dispatch (유효 ID / 알 수 없는 ID)
"""
from __future__ import annotations

import pytest

from studio.lab_presets import (
    LAB_LTX_SULPHUR_PRESET,
    LAB_VIDEO_PRESETS,
    LabLoraOption,
    LabVideoModelPreset,
    get_lab_video_preset,
)


class TestLabLoraOption:
    """LabLoraOption 의 형태 + 기본값 검증."""

    def test_is_frozen_dataclass(self) -> None:
        """frozen dataclass 라 instance 수정 시 FrozenInstanceError."""
        option = LabLoraOption(
            id="test_id",
            display_name="Test",
            file_name="test.safetensors",
            default_strength=0.5,
        )
        with pytest.raises(Exception):  # dataclasses.FrozenInstanceError
            option.id = "changed"  # type: ignore[misc]

    def test_default_role_is_adult(self) -> None:
        """role default = 'adult' (생략 가능)."""
        option = LabLoraOption(
            id="x",
            display_name="X",
            file_name="x.safetensors",
            default_strength=0.5,
        )
        assert option.role == "adult"

    def test_default_applies_to_single(self) -> None:
        """applies_to default = ('single',) — adult 류 LoRA 기본."""
        option = LabLoraOption(
            id="x",
            display_name="X",
            file_name="x.safetensors",
            default_strength=0.5,
        )
        assert option.applies_to == ("single",)

    def test_lightning_applies_to_base_upscale(self) -> None:
        """lightning role 은 applies_to=('base','upscale') 명시 가능."""
        option = LabLoraOption(
            id="lightning_test",
            display_name="Test",
            file_name="test.safetensors",
            default_strength=0.5,
            role="lightning",
            applies_to=("base", "upscale"),
        )
        assert option.applies_to == ("base", "upscale")
        assert option.role == "lightning"


class TestLabVideoModelPreset:
    """LabVideoModelPreset 형태 + LAB_LTX_SULPHUR_PRESET 정확성."""

    def test_is_frozen(self) -> None:
        """frozen dataclass."""
        with pytest.raises(Exception):
            LAB_LTX_SULPHUR_PRESET.id = "changed"  # type: ignore[misc]

    def test_sulphur_preset_id(self) -> None:
        """preset id = 'ltx-sulphur'."""
        assert LAB_LTX_SULPHUR_PRESET.id == "ltx-sulphur"

    def test_sulphur_preset_display_name(self) -> None:
        """display name 이 'Lab' 단어 포함 — HistoryTile 의 Lab 배지 식별용."""
        assert "Lab" in LAB_LTX_SULPHUR_PRESET.display_name
        assert LAB_LTX_SULPHUR_PRESET.display_name == "LTX 2.3 · Sulphur Lab"

    def test_sulphur_preset_has_4_lora_options(self) -> None:
        """distill_default + distill_sulphur + adult_eros + adult_sulphur = 4 개."""
        assert len(LAB_LTX_SULPHUR_PRESET.lora_options) == 4
        ids = {opt.id for opt in LAB_LTX_SULPHUR_PRESET.lora_options}
        assert ids == {
            "distill_default",
            "distill_sulphur",
            "adult_eros",
            "adult_sulphur",
        }

    def test_distill_options_apply_to_base_upscale(self) -> None:
        """distill_default + distill_sulphur 모두 applies_to=('base','upscale')."""
        distill_opts = [
            opt
            for opt in LAB_LTX_SULPHUR_PRESET.lora_options
            if opt.role == "lightning"
        ]
        assert len(distill_opts) == 2
        for opt in distill_opts:
            assert opt.applies_to == ("base", "upscale"), (
                f"{opt.id} applies_to 가 ('base','upscale') 아님 — 빌더 expand 정책 어긋남"
            )

    def test_adult_options_apply_to_single(self) -> None:
        """adult_eros + adult_sulphur 모두 applies_to=('single',)."""
        adult_opts = [
            opt
            for opt in LAB_LTX_SULPHUR_PRESET.lora_options
            if opt.role == "adult"
        ]
        assert len(adult_opts) == 2
        for opt in adult_opts:
            assert opt.applies_to == ("single",)

    def test_sulphur_lora_file_name(self) -> None:
        """adult_sulphur 의 file_name 정확."""
        opt = next(
            o
            for o in LAB_LTX_SULPHUR_PRESET.lora_options
            if o.id == "adult_sulphur"
        )
        assert opt.file_name == "sulphur_lora_rank_768.safetensors"
        assert opt.default_strength == 0.7  # spec 첫 실측 시작값

    def test_sulphur_distill_file_name(self) -> None:
        """distill_sulphur 의 file_name 정확."""
        opt = next(
            o
            for o in LAB_LTX_SULPHUR_PRESET.lora_options
            if o.id == "distill_sulphur"
        )
        assert opt.file_name == (
            "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"
        )

    def test_default_distill_matches_production(self) -> None:
        """distill_default 의 file_name = production presets.py 의 distill 과 동일.

        baseline #1 조합 (default distill + eros only) 이 production 과 정확히
        같아야 비교 의미 — file_name 불일치 시 baseline 가치 0.
        """
        from studio.presets import LTX_VIDEO_PRESET

        opt = next(
            o
            for o in LAB_LTX_SULPHUR_PRESET.lora_options
            if o.id == "distill_default"
        )
        production_distill_names = {
            entry.name
            for entry in LTX_VIDEO_PRESET.loras
            if entry.role == "lightning"
        }
        assert opt.file_name in production_distill_names

    def test_eros_matches_production(self) -> None:
        """adult_eros file_name = production eros file_name."""
        from studio.presets import LTX_VIDEO_PRESET

        opt = next(
            o
            for o in LAB_LTX_SULPHUR_PRESET.lora_options
            if o.id == "adult_eros"
        )
        production_adult_names = {
            entry.name
            for entry in LTX_VIDEO_PRESET.loras
            if entry.role == "adult"
        }
        assert opt.file_name in production_adult_names

    def test_sampling_reuses_ltx_production(self) -> None:
        """sampling 은 production LTX_VIDEO_PRESET.sampling 재사용 (별 정의 X)."""
        from studio.presets import LTX_VIDEO_PRESET

        assert LAB_LTX_SULPHUR_PRESET.sampling is LTX_VIDEO_PRESET.sampling


class TestLabPresetDispatch:
    """get_lab_video_preset() dispatch + LAB_VIDEO_PRESETS 목록."""

    def test_dispatch_known_id(self) -> None:
        """'ltx-sulphur' 로 dispatch 시 LAB_LTX_SULPHUR_PRESET 반환."""
        result = get_lab_video_preset("ltx-sulphur")
        assert result is LAB_LTX_SULPHUR_PRESET

    def test_dispatch_unknown_raises(self) -> None:
        """알 수 없는 id 는 ValueError."""
        with pytest.raises(ValueError, match="unknown lab video preset"):
            get_lab_video_preset("nonexistent-preset")

    def test_lab_video_presets_list_contains_sulphur(self) -> None:
        """LAB_VIDEO_PRESETS 가 LAB_LTX_SULPHUR_PRESET 포함."""
        assert LAB_LTX_SULPHUR_PRESET in LAB_VIDEO_PRESETS
        assert len(LAB_VIDEO_PRESETS) >= 1
```

- [ ] **Step 2: 테스트 실행 (모두 fail 확인 — ImportError 또는 ModuleNotFoundError)**

```powershell
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest backend/tests/test_lab_presets.py -v
```

기대 결과: 모든 테스트 fail with `ModuleNotFoundError: No module named 'studio.lab_presets'`.

- [ ] **Step 3: lab_presets.py 신설 — 최소 구현 (dataclass + 빈 preset 정의)**

`backend/studio/lab_presets.py` 신규 작성:

```python
"""lab_presets.py - Lab 검증용 모델 프리셋.

production presets.py 와 격리. Lab 페이지 (/lab/video) 에서만 사용.
신규 모델은 여기 추가 → 검증 후 만족 시 별 plan 으로 production 흡수.

spec: docs/superpowers/specs/2026-05-15-video-lab-framework-sulphur-design.md v4
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .presets import (
    LTX_VIDEO_PRESET,
    VideoFiles,
    VideoSampling,
)


@dataclass(frozen=True)
class LabLoraOption:
    """Lab 페이지에서 토글 가능한 LoRA 옵션.

    role 은 production VideoLoraEntry 와 호환되지만, sub-key (id) 로 더 세분화
    (예: 'adult_eros' / 'adult_sulphur') — 여러 변종이 같은 카테고리에 있을 때.

    applies_to: lightning role 의 경우 빌더가 같은 LoRA 를 두 entry 로 expand
    해서 순차 model_ref chain 에 적용 (production presets.py:391-402 패턴 미러).
    'base' + 'upscale' 두 번 호출 — 시각적 분리 아닌 LoraLoaderModelOnly 두 호출의
    순차 적용. adult / single 류는 ('single',) 1 회만.
    """

    id: str  # frontend 토글 식별 ('adult_eros', 'adult_sulphur', 'distill_default', 'distill_sulphur')
    display_name: str  # UI 라벨
    file_name: str  # safetensors basename (subpath X · ComfyUI loras/ 루트 배치)
    default_strength: float
    strength_min: float = 0.0
    strength_max: float = 1.5
    strength_step: float = 0.05
    role: Literal["lightning", "adult"] = "adult"
    applies_to: tuple[str, ...] = ("single",)
    note: str = ""


@dataclass(frozen=True)
class LabVideoModelPreset:
    """Lab 영상 모델 프리셋. production VideoModelPreset 과 다른 구조.

    base_files / sampling / negative_prompt 는 production LTX_VIDEO_PRESET 의
    값을 재사용 (Sulphur 가 LTX 2.3 derivative — 같은 인프라 적합).
    """

    id: str  # 'ltx-sulphur' 등 dispatch key
    display_name: str  # HistoryTile Lab 배지 식별용 ('Lab' 단어 포함 권장)
    tag: str
    base_files: VideoFiles
    lora_options: list[LabLoraOption]
    sampling: VideoSampling
    negative_prompt: str
    notes_md: str  # UI 도움말 (다운로드 안내 + 검증 가이드)


# ── Sulphur-2 LTX 변종 (Phase 1 첫 적용) ──
LAB_LTX_SULPHUR_PRESET = LabVideoModelPreset(
    id="ltx-sulphur",
    display_name="LTX 2.3 · Sulphur Lab",
    tag="LoRA 검증",
    base_files=LTX_VIDEO_PRESET.files,  # text_encoder / upscaler / unet 모두 재사용
    lora_options=[
        # Distill (Lightning) 변종 — radio (default / sulphur).
        # applies_to=('base','upscale') → 빌더가 두 LoraLoaderModelOnly 호출로 expand
        # (production presets.py:391-402 의 동일 파일 두 entry 패턴 미러).
        LabLoraOption(
            id="distill_default",
            display_name="Distill: Default (384)",
            file_name="ltx-2.3-22b-distilled-lora-384.safetensors",
            default_strength=0.5,
            role="lightning",
            applies_to=("base", "upscale"),
            note="기존 LTX distill (production baseline 과 동일)",
        ),
        LabLoraOption(
            id="distill_sulphur",
            display_name="Distill: Sulphur (1.1_fro90)",
            file_name="ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
            default_strength=0.5,
            role="lightning",
            applies_to=("base", "upscale"),
            note="Sulphur 권장 distill (Sulphur LoRA 와 세트 · 631 MB)",
        ),
        # Adult LoRA — checkbox 중복 선택 가능 (eros / sulphur · 둘 다 OK).
        LabLoraOption(
            id="adult_eros",
            display_name="Adult: Eros",
            file_name="ltx2310eros_beta.safetensors",
            default_strength=0.5,
            role="adult",
            applies_to=("single",),
            note="기존 production adult LoRA",
        ),
        LabLoraOption(
            id="adult_sulphur",
            display_name="Adult: Sulphur",
            file_name="sulphur_lora_rank_768.safetensors",
            default_strength=0.7,  # README 미명시 — 첫 실측 시작값
            role="adult",
            applies_to=("single",),
            note="Sulphur 2 NSFW finetune (10.3 GB)",
        ),
    ],
    sampling=LTX_VIDEO_PRESET.sampling,
    negative_prompt=LTX_VIDEO_PRESET.negative_prompt,
    notes_md=(
        "Sulphur-2-base 검증용. HuggingFace SulphurAI/Sulphur-2-base "
        "(gated=false · EULA 동의 불필요) 에서 "
        "`sulphur_lora_rank_768.safetensors` (10.3 GB) + "
        "`ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors` (631 MB) "
        "받아 ComfyUI LoRA 디렉토리 (`comfyui_base_dir/models/loras/` 또는 "
        "`extra_model_paths.yaml` 의 loras 항목 위치) 에 basename 으로 배치."
    ),
)

# Lab 페이지에서 노출할 preset 목록 (미래 추가 시 여기에)
LAB_VIDEO_PRESETS: list[LabVideoModelPreset] = [LAB_LTX_SULPHUR_PRESET]


def get_lab_video_preset(preset_id: str) -> LabVideoModelPreset:
    """preset_id → preset 인스턴스 dispatch.

    Raises:
        ValueError: 알 수 없는 preset_id (frontend mirror 와 sync 깨짐)
    """
    for p in LAB_VIDEO_PRESETS:
        if p.id == preset_id:
            return p
    raise ValueError(f"unknown lab video preset: {preset_id!r}")
```

- [ ] **Step 4: 테스트 실행 — 모두 pass 확인**

```powershell
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest backend/tests/test_lab_presets.py -v
```

기대 결과: 14 / 14 PASS.

- [ ] **Step 5: 전체 backend 회귀 확인**

```powershell
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest backend/tests/ -q
```

기대 결과: 581 + 14 = **595 passed**. 회귀 0.

- [ ] **Step 6: commit**

```bash
git add backend/studio/lab_presets.py backend/tests/test_lab_presets.py
git commit -m "$(cat <<'EOF'
feat(lab): lab_presets.py 신설 — LabLoraOption + LAB_LTX_SULPHUR_PRESET

- LabLoraOption frozen dataclass (id / file_name / default_strength /
  role / applies_to / strength_min/max/step / note)
- LabVideoModelPreset 정의 (production LTX_VIDEO_PRESET 의 files/sampling/
  negative_prompt 재사용 — Sulphur 는 LTX 2.3 derivative)
- LAB_LTX_SULPHUR_PRESET = 4 LoraOption (distill_default + distill_sulphur +
  adult_eros + adult_sulphur · spec §4.2.1 박제 그대로)
- applies_to=('base','upscale') 명시 — 빌더 두 entry expand 정책 (Plan B 진입 시)
- get_lab_video_preset() dispatch + LAB_VIDEO_PRESETS 목록

backend pytest 581 → 595 (+14 신규).
회귀 0.

spec: docs/superpowers/specs/2026-05-15-video-lab-framework-sulphur-design.md v4
plan: docs/superpowers/plans/2026-05-15-video-lab-sulphur-plan-a-presets-blocker.md
EOF
)"
```

기대 결과: `[feature/video-lab-sulphur-plan-a XXXXXXX] feat(lab): lab_presets.py ...`

---

## Task 2: ComfyUI /object_info 캡처 스크립트

**Files:**
- Create: `backend/scripts/capture_comfy_object_info.py`
- (Optional output: `backend/scripts/_capture_object_info.json` · gitignore 또는 단발성)

- [ ] **Step 1: capture 스크립트 신설**

`backend/scripts/capture_comfy_object_info.py`:

```python
"""ComfyUI /object_info 전체 JSON 을 캡처해 파일로 저장.

Phase 1.5 hard blocker 용 — Sulphur LoRA 두 파일이 LoraLoaderModelOnly 의
ENUM 목록에 존재하는지 + 우리 LTX 워크플로우의 모든 class_type 이
/object_info 에 존재하는지 후속 verify 스크립트가 확인.

사용:
  python backend/scripts/capture_comfy_object_info.py
출력:
  backend/scripts/_capture_object_info.json (gitignore — 단발성 진단 산출물)

ComfyUI 가 동작 중이어야 함 (start.bat 으로 자동기동 또는 수동 실행).
URL 은 backend/config.py 의 comfyui_url 사용 (default http://127.0.0.1:8000).
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import httpx


REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = Path(__file__).resolve().parent / "_capture_object_info.json"


async def capture(comfy_url: str) -> dict:
    """ComfyUI /object_info GET → JSON 반환.

    Args:
        comfy_url: ComfyUI 기본 URL (예: 'http://127.0.0.1:8000')

    Returns:
        /object_info 응답 (전체 노드 dict)

    Raises:
        httpx.HTTPStatusError: ComfyUI 다운 또는 비정상 응답
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{comfy_url.rstrip('/')}/object_info")
        resp.raise_for_status()
        return resp.json()


async def main() -> int:
    # sys.path 보강 — backend/ 디렉토리 추가 (studio 모듈 import 가능)
    backend_dir = REPO_ROOT / "backend"
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    from config import settings

    comfy_url = settings.comfyui_url or "http://127.0.0.1:8000"
    print(f"ComfyUI URL: {comfy_url}")

    try:
        info = await capture(comfy_url)
    except httpx.HTTPError as e:
        print(f"❌ ComfyUI 호출 실패: {e}", file=sys.stderr)
        print("   start.bat 으로 ComfyUI 가 동작 중인지 확인.", file=sys.stderr)
        return 1

    OUTPUT_PATH.write_text(
        json.dumps(info, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"✅ {len(info)} 개 노드 캡처 → {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
```

- [ ] **Step 2: `.gitignore` 에 capture 산출물 추가 (단발성 진단 — repo 에 박제 X)**

`backend/scripts/.gitignore` 신규 또는 추가:

```
_capture_object_info.json
```

(이미 있으면 skip)

- [ ] **Step 3: 스크립트 syntax 확인**

```powershell
D:\AI-Image-Studio\.venv\Scripts\python.exe -c "import ast; ast.parse(open('backend/scripts/capture_comfy_object_info.py', encoding='utf-8').read())"
```

기대 결과: 무 출력 (syntax 정상).

- [ ] **Step 4: ⚠️ 실 ComfyUI 호출은 Task 5 (사용자 수동 단계) 까지 보류**

Task 5 에서 사용자가 Sulphur 파일 다운로드 + ComfyUI 기동 후 한 번에 실행.

- [ ] **Step 5: commit**

```bash
git add backend/scripts/capture_comfy_object_info.py backend/scripts/.gitignore
git commit -m "feat(scripts): ComfyUI /object_info 캡처 도구 (Phase 1.5 hard blocker)"
```

---

## Task 3: workflow class_type / LoRA enum 검증 스크립트

**Files:**
- Create: `backend/scripts/verify_lab_workflow_class_types.py`

- [ ] **Step 1: verify 스크립트 신설**

`backend/scripts/verify_lab_workflow_class_types.py`:

```python
"""Phase 1.5 hard blocker — Lab Sulphur 워크플로우 호환성 검증.

입력: backend/scripts/_capture_object_info.json (Task 2 의 출력)
검증:
  (1) Sulphur 두 LoRA 파일 basename 이 LoraLoaderModelOnly.lora_name ENUM 에 존재
  (2) Lab 워크플로우가 사용하는 모든 class_type 이 /object_info 에 존재
      — LoraLoaderModelOnly, CheckpointLoaderSimple, LTXVImgToVideoInplace,
        LTXVPreprocess, ResizeImageMaskNode, ResizeImagesByLongerEdge,
        CreateVideo, SaveVideo, LTXVEmptyLatentAudio (+ 기타 우리 워크플로우 핵심)

사용:
  python backend/scripts/verify_lab_workflow_class_types.py
출력 (예시):
  ✅ Sulphur LoRA 발견: sulphur_lora_rank_768.safetensors
  ✅ Sulphur distill 발견: ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors
  ✅ class_type LoraLoaderModelOnly 존재
  ...
  통과: 2 / 2 LoRA · 9 / 9 class_type
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
CAPTURE_PATH = Path(__file__).resolve().parent / "_capture_object_info.json"


REQUIRED_LORA_FILES = [
    "sulphur_lora_rank_768.safetensors",
    "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
]


REQUIRED_CLASS_TYPES = [
    "LoraLoaderModelOnly",
    "CheckpointLoaderSimple",
    "LTXVImgToVideoInplace",
    "LTXVPreprocess",
    "ResizeImageMaskNode",
    "ResizeImagesByLongerEdge",
    "EmptyLTXVLatentVideo",
    "LTXVEmptyLatentAudio",
    "CreateVideo",
    "SaveVideo",
    "CLIPLoader",
    "VAELoader",
]


def load_capture() -> dict:
    if not CAPTURE_PATH.exists():
        print(
            f"❌ {CAPTURE_PATH} 없음. 먼저 capture_comfy_object_info.py 실행.",
            file=sys.stderr,
        )
        sys.exit(2)
    return json.loads(CAPTURE_PATH.read_text(encoding="utf-8"))


def extract_lora_enum(info: dict) -> list[str]:
    """LoraLoaderModelOnly.input.required.lora_name 의 ENUM 목록 반환.

    /object_info 의 LoraLoaderModelOnly 정의:
      {
        "input": {
          "required": {
            "lora_name": [["file1.safetensors", "subfolder/file2.safetensors", ...], {...}]
          }
        }
      }
    """
    node = info.get("LoraLoaderModelOnly")
    if not node:
        return []
    required = node.get("input", {}).get("required", {})
    lora_name = required.get("lora_name")
    if not lora_name or not isinstance(lora_name, list) or len(lora_name) == 0:
        return []
    enum_list = lora_name[0]
    if not isinstance(enum_list, list):
        return []
    return [str(x) for x in enum_list]


def check_lora_present(enum_list: list[str], target_basename: str) -> tuple[bool, str | None]:
    """basename 또는 subpath 매칭 검사. 매칭된 정확한 enum 값 반환."""
    # basename 직접 매칭
    if target_basename in enum_list:
        return True, target_basename
    # subpath 매칭 (예: 'distill_loras/foo.safetensors' 도 OK)
    for entry in enum_list:
        if entry.endswith("/" + target_basename) or entry.endswith("\\" + target_basename):
            return True, entry
    return False, None


def main() -> int:
    info = load_capture()
    enum_list = extract_lora_enum(info)
    if not enum_list:
        print("❌ LoraLoaderModelOnly 에서 lora_name ENUM 추출 실패.", file=sys.stderr)
        return 1

    print(f"ComfyUI 가 인식하는 LoRA: {len(enum_list)} 개")
    print()

    # 1. LoRA 파일 존재 검증
    lora_pass = 0
    for target in REQUIRED_LORA_FILES:
        ok, found_as = check_lora_present(enum_list, target)
        if ok:
            print(f"✅ LoRA 발견: {found_as}")
            lora_pass += 1
        else:
            print(f"❌ LoRA 누락: {target}")
            print(f"   → ComfyUI loras/ 디렉토리에 basename 으로 배치 필요")

    print()

    # 2. class_type 존재 검증
    type_pass = 0
    for ct in REQUIRED_CLASS_TYPES:
        if ct in info:
            print(f"✅ class_type {ct} 존재")
            type_pass += 1
        else:
            print(f"❌ class_type {ct} 누락 — custom node 미설치 가능성")

    print()
    print(
        f"통과: {lora_pass} / {len(REQUIRED_LORA_FILES)} LoRA · "
        f"{type_pass} / {len(REQUIRED_CLASS_TYPES)} class_type"
    )

    if lora_pass < len(REQUIRED_LORA_FILES) or type_pass < len(REQUIRED_CLASS_TYPES):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: syntax 확인**

```powershell
D:\AI-Image-Studio\.venv\Scripts\python.exe -c "import ast; ast.parse(open('backend/scripts/verify_lab_workflow_class_types.py', encoding='utf-8').read())"
```

기대 결과: 무 출력.

- [ ] **Step 3: commit**

```bash
git add backend/scripts/verify_lab_workflow_class_types.py
git commit -m "feat(scripts): Lab 워크플로우 class_type / LoRA enum 검증 (Phase 1.5)"
```

---

## Task 4: README — Sulphur LoRA 다운로드 가이드 (사용자 작업 안내)

**Files:**
- Create: `docs/superpowers/plans/_lab-sulphur-download-guide.md`

- [ ] **Step 1: 다운로드 가이드 박제**

`docs/superpowers/plans/_lab-sulphur-download-guide.md`:

```markdown
# Sulphur LoRA 다운로드 가이드 (Task 5 사용자 수동 작업)

> 이 파일은 Plan A Phase 1.5 의 사용자 수동 단계 가이드. Plan A Task 5 진입 전 수행.

## 1. HuggingFace 페이지 접속

`https://huggingface.co/SulphurAI/Sulphur-2-base`

- gated=false → 로그인 / EULA 동의 불필요
- 브라우저 또는 `huggingface-cli download` 둘 다 가능

## 2. 받을 파일 2 개

| 파일 | 크기 | HF 경로 |
|---|---|---|
| `sulphur_lora_rank_768.safetensors` | 10.3 GB | root |
| `ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors` | 631 MB | `distill_loras/` |

⚠️ HF `distill_loras/` subfolder 안에 있어도 **basename 만 사용**해서 ComfyUI loras 루트 폴더에 평탄 배치.

## 3. ComfyUI LoRA 디렉토리에 배치

기본 위치: `D:\AI-Image-Studio\ComfyUI\models\loras\`

(만약 `comfyui_extra_paths_config` 에 별 loras 경로가 있으면 그쪽도 OK · spec §4.1.2 참조)

배치 후 디렉토리 안에 두 파일이 보여야 함:
```

```
ComfyUI/models/loras/
├── sulphur_lora_rank_768.safetensors                                    (10.3 GB)
├── ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors    (631 MB)
└── (기존 LoRA 파일들 — ltx-2.3-22b-distilled-lora-384.safetensors 등)
```

```markdown
## 4. 다운로드 후 → Plan A Task 5 진입

다운로드 완료 보고 + ComfyUI 정상 기동 확인 후 Task 5 hard blocker 실행.
```

- [ ] **Step 2: commit**

```bash
git add docs/superpowers/plans/_lab-sulphur-download-guide.md
git commit -m "docs(plan-a): Sulphur LoRA 다운로드 가이드 박제 (Task 5 사용자 수동)"
```

---

## Task 5: Phase 1.5 Hard Blocker 실행 — capture + verify (사용자 수동 단계)

**Files:**
- (Run scripts · no file changes in this task)

- [ ] **Step 1: 사용자가 Sulphur LoRA 두 파일 다운로드 완료했는지 확인**

오빠한테 다음 질문:
- (a) `sulphur_lora_rank_768.safetensors` (10.3 GB) 받았는가?
- (b) `ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors` (631 MB) 받았는가?
- (c) 두 파일 모두 `ComfyUI/models/loras/` 에 basename 으로 배치 완료했는가?
- (d) ComfyUI Desktop 또는 `start.bat` 으로 기동 중인가? (http://127.0.0.1:8000 응답 OK)

오빠가 모두 OK 하면 Step 2 진입.

- [ ] **Step 2: capture 스크립트 실행**

```powershell
D:\AI-Image-Studio\.venv\Scripts\python.exe backend/scripts/capture_comfy_object_info.py
```

기대 결과:
```
ComfyUI URL: http://127.0.0.1:8000
✅ N 개 노드 캡처 → D:\AI-Image-Studio\backend\scripts\_capture_object_info.json
```

(N 은 보통 1000~3000 노드)

- [ ] **Step 3: verify 스크립트 실행**

```powershell
D:\AI-Image-Studio\.venv\Scripts\python.exe backend/scripts/verify_lab_workflow_class_types.py
```

기대 결과 (모든 검증 통과 시):
```
ComfyUI 가 인식하는 LoRA: 30~50 개

✅ LoRA 발견: sulphur_lora_rank_768.safetensors
✅ LoRA 발견: ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors

✅ class_type LoraLoaderModelOnly 존재
✅ class_type CheckpointLoaderSimple 존재
✅ class_type LTXVImgToVideoInplace 존재
... (12 종류 모두)

통과: 2 / 2 LoRA · 12 / 12 class_type
```

exit code 0 = hard blocker 통과.

- [ ] **Step 4: 결과 박제 (Task 6 에서 진행)**

verify 출력을 복사해서 Task 6 의 결과 박제 markdown 에 첨부.

⚠️ **만약 fail 하면**:
- LoRA 누락 → 파일 위치 재확인 + ComfyUI 재시작 (LoRA 목록 캐시 갱신)
- class_type 누락 → ComfyUI custom node 미설치 (Comfy-Org/workflow_templates / ComfyUI-LTXVideo 등). 누락 노드 설치 후 재캡처.
- 해결 안 되면 오빠 + Codex 협의 후 Plan A 중단 판정.

---

## Task 6: Phase 1.5 결과 박제 + Plan A 완료 commit

**Files:**
- Create: `docs/superpowers/plans/2026-05-15-video-lab-sulphur-plan-a-results.md`

- [ ] **Step 1: 결과 박제 markdown 작성**

`docs/superpowers/plans/2026-05-15-video-lab-sulphur-plan-a-results.md`:

```markdown
# Plan A — Phase 1.5 Hard Blocker 결과 박제

**실행일**: YYYY-MM-DD HH:MM (Task 5 실행 시 갱신)
**실행자**: 사용자 + Opus 4.7

## 1. ComfyUI /object_info 캡처 결과

- 노드 수: N 개 (Task 5 Step 2 출력 그대로)
- 캡처 파일: `backend/scripts/_capture_object_info.json` (gitignore · 단발성)

## 2. LoRA enum 검증

| 파일 | 결과 | ComfyUI enum 값 |
|---|---|---|
| `sulphur_lora_rank_768.safetensors` | ✅ / ❌ | (Task 5 출력 발췌) |
| `ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors` | ✅ / ❌ | (Task 5 출력 발췌) |

## 3. class_type 검증

12 개 class_type 모두 존재 ✅ / 일부 누락 ❌

(누락 시 누락 목록 + 설치 방법 박제)

## 4. 종합 평가

- ✅ **통과**: Plan B (backend route/pipeline/builder) 진입 OK
- ❌ **불통과**: Plan A 중단 — 누락 항목 해결 후 Task 5 재실행

## 5. 후속 결정

- LoRA strength 시작값 검토 (spec §5.1) — 첫 실측 (조합 #4) 에서 0.5 / 0.7 / 1.0 비교
- Sulphur LoRA + eros 동시 호환성 (spec §5.8) — 첫 실측 (조합 #5) 에서 확인
- Lab history 표시 범위 (spec §5.10) — Plan C 진입 시 결정
```

(Task 5 Step 3 출력 그대로 발췌해서 채움)

- [ ] **Step 2: commit**

```bash
git add docs/superpowers/plans/2026-05-15-video-lab-sulphur-plan-a-results.md
git commit -m "$(cat <<'EOF'
docs(plan-a): Phase 1.5 hard blocker 결과 박제

- ComfyUI /object_info 캡처 N 노드
- LoRA enum: 2/2 통과 (sulphur_lora_rank_768 + distill 1.1_fro90)
- class_type: 12/12 통과
- 종합: Plan B 진입 OK
EOF
)"
```

- [ ] **Step 3: Plan A 완료 — master merge --no-ff**

```bash
git checkout master
git merge --no-ff feature/video-lab-sulphur-plan-a -m "$(cat <<'EOF'
feat(lab): Video Lab Plan A 완료 (preset + Phase 1.5 hard blocker)

- spec v4 박제 (brainstorming + Codex 1/2/3차 리뷰 반영)
- lab_presets.py 신설 (LabLoraOption + LAB_LTX_SULPHUR_PRESET · pytest +14)
- ComfyUI /object_info 캡처 + class_type 검증 스크립트
- Phase 1.5 통과 결과 박제 → Plan B 진입 OK

backend pytest 581 → 595. 회귀 0. frontend 미수정.

다음: Plan B (routes/lab.py + pipelines/video_lab.py + builder)
EOF
)"
```

- [ ] **Step 4: 최종 검증**

```bash
git log --oneline -10
git status
```

기대 결과:
- master HEAD = "feat(lab): Video Lab Plan A 완료 ..."
- working tree clean
- feature/video-lab-sulphur-plan-a 브랜치는 남아 있음 (Plan B 진입 전 별 cleanup commit 으로 삭제 또는 유지)

---

## Self-Review Checklist

- [x] **Spec coverage**:
  - §4.2.1 lab_presets.py 정의 → Task 1 ✅
  - §4.1.1 + §4.1.2 다운로드 가이드 + LoRA 경로 정책 → Task 4 ✅
  - §5.9 Phase 1.5 hard blocker 통과 기준 (mp4 저장 + class_type 검증) → Task 3 (class_type 검증 부분), mp4 저장은 Plan B/C 에서 실 영상 생성 시 검증
  - §6 Phase 0/1/1.5 → Task 0/1/2-5 ✅
- [x] **Placeholder scan**: TBD / TODO 없음. pseudocode 없음 — 모든 코드 실행 가능 형태.
- [x] **Type consistency**: `LabLoraOption` / `LabVideoModelPreset` / `get_lab_video_preset()` 시그니처 일관 (Task 1 정의 ↔ Task 5/6 사용).
- [x] **Plan B/C 의존**: Plan B 가 `from studio.lab_presets import ...` 만 import → 본 plan 의 export 가 진실원. Plan C 의 frontend mirror 도 같은 형태로 받음.

⚠️ **Phase 1.5 mp4 저장 검증** = Plan A 범위 밖. 본 plan 은 `/object_info` 정적 검증만. 실 mp4 생성은 Plan B 의 pipeline + Plan C 의 frontend 가 합쳐져야 가능. spec §5.9 의 "실 mp4 저장" 은 Plan B/C 끝나고 통합 검증 단계 (Phase 6 사용자 실측).

---

## Plan A 종료 후 다음 단계

1. **Plan B 작성** — `docs/superpowers/plans/2026-05-15-video-lab-sulphur-plan-b-backend.md`
   - routes/lab.py + pipelines/video_lab.py + builder
   - history insert (mode="video", model="LTX 2.3 · Sulphur Lab")
2. **Plan C 작성** — `docs/superpowers/plans/2026-05-15-video-lab-sulphur-plan-c-frontend.md`
   - frontend store/hook/api/pipeline-defs + LeftPanel + page + E2E + ModeNav Lab 링크 + HistoryTile Lab 배지
   - PipelineMode "lab_video" 추가 시 ProgressModal 3 곳 + PipelineTimeline 2 곳 동기화 (spec v4 §4.3.2)
3. **Phase 6 사용자 실측** — 5 조합 동일 source 비교 (spec §4.4)
4. **흡수 결정** — 결과 따라 Phase 2/3 plan 작성 또는 lab 영구 유지
