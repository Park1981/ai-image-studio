# Vision Compare 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vision Compare 메뉴 (`/vision/compare`) 를 *점수 매트릭스 단일 호출* → *각 이미지 풍부 분석 × 2 + 깊은 차이 추출* 패러다임으로 재설계. Edit context (v3) 무변경.

**Architecture:** 4-stage 백엔드 pipeline (`observe1` → `observe2` → `diff_synth` → `translate`) — vision_pipeline 의 정공법 (`vision_observe` + `prompt_synthesize`) 을 듀얼로 재사용 + 새 stage `diff_synthesize` 신설. Frontend 는 옛 5축 score shape 폐기하고 V4 dataclass (categoryDiffs/keyAnchors/fidelityScore) 미러 + Stacked layout (분리 thumbnail + BeforeAfter 슬라이더 동시).

**Tech Stack:** Backend Python 3.13 (FastAPI · httpx · Ollama qwen3-vl/qwen2.5vl + gemma4-un · pytest 215+ baseline) · Frontend Next.js 16 + React 19 + TypeScript strict + Zustand 5 + vitest 50+ baseline. SSE task-based pattern (옛 호환 그대로).

**Spec:** `docs/superpowers/specs/2026-05-05-vision-compare-redesign-design.md` (717 줄 · master `fd9207e`)

---

## Phase 분할 + Task Map

| Phase | Task 수 | 설명 |
|-------|---------|------|
| **0** | 1 | 선행 정리 — VisionModelSelector 컴포넌트 추출 (vision page 영향 0) |
| **1** | 5 | 백엔드 모듈 골격 — `compare_pipeline_v4/` 신설 (`_types`, `_axes`, `_coerce`, `diff_synthesize`) |
| **2** | 3 | 백엔드 pipeline orchestration — `analyze_pair_v4`, unload 명시, translate |
| **3** | 4 | 백엔드 route + persist 분기 + per-image endpoint + schema |
| **4** | 1 | 백엔드 옛 코드 폐기 — v2_generic 삭제 |
| **5** | 3 | 프론트 types + mock + store |
| **6** | 2 | 프론트 SSE drain + pipeline-defs |
| **7** | 9 | 프론트 컴포넌트 신설 (CompareResultHeader 등 9개) |
| **8** | 2 | 프론트 페이지 통합 — CompareAnalysisPanel 재작성, CompareLeftPanel 갱신 |
| **9** | 1 | 시각 review 게이트 (Phase 8 직후 사용자 평가) |
| **10** | 1 | 사용자 시나리오 시각 검증 (1/2/4/5 6/6 production 품질) |

총 32 task. **feature branch**: `feature/vision-compare-redesign`.

---

## File Structure

### Backend 신설

```
backend/studio/compare_pipeline_v4/
  __init__.py                 # facade re-export
  _types.py                   # CompareCategoryDiff / CompareKeyAnchor / CompareAnalysisResultV4
  _axes.py                    # 5 카테고리 axes 상수
  _coerce.py                  # JSON 정규화 helper (sentinel filter / score coerce / list coerce)
  diff_synthesize.py          # DIFF_SYNTHESIZE_SYSTEM + synthesize_diff(obs1, obs2, hint)
  translate.py                # *_en → *_ko 일괄 번역
  pipeline.py                 # analyze_pair_v4 (4 stage orchestration)
```

### Backend 갱신

- `backend/studio/routes/compare.py` — A/B PIL verify + width/height 추출, `analyze_pair_generic` import 제거
- `backend/studio/routes/__init__.py` — per-image endpoint 등록
- `backend/studio/pipelines/compare_analyze.py` — V4 호출 + persist context 분기 + 5 stage emit
- `backend/studio/schemas.py` — `VisionCompareAnalysisV4` Pydantic 모델 + per-image request/response

### Backend 폐기

- `backend/studio/comparison_pipeline/v2_generic.py` — 삭제
- `backend/studio/comparison_pipeline/__init__.py` — re-export 정리
- `backend/tests/test_comparison_pipeline_generic.py` — 삭제

### Frontend 신설

```
frontend/components/studio/VisionModelSelector.tsx       # Phase 0 (vision/compare 공용)
frontend/components/studio/compare/
  CompareResultHeader.tsx
  CompareImageDual.tsx
  CompareSliderViewer.tsx
  CompareCommonDiffChips.tsx
  CompareCategoryMatrix.tsx
  CompareKeyAnchors.tsx
  CompareTransformBox.tsx
  CompareImageDetailDrawer.tsx
  CompareUncertainBox.tsx
```

### Frontend 갱신

- `frontend/lib/api/types.ts` — `VisionCompareAnalysisV4` interface
- `frontend/lib/api/compare.ts` — SSE drain 5 stage 처리, per-image endpoint 호출
- `frontend/lib/api/mocks/compare.ts` — V4 fixture
- `frontend/stores/useVisionCompareStore.ts` — observation1/2 + perImagePrompt
- `frontend/lib/pipeline-defs.tsx` — `PIPELINE_DEFS["compare"]` 5 stage
- `frontend/app/vision/page.tsx` — VisionModelSelector 적용 (Phase 0)
- `frontend/app/vision/compare/page.tsx` — V4 store 연결
- `frontend/components/studio/compare/CompareAnalysisPanel.tsx` — V4 렌더 전면 재작성
- `frontend/components/studio/compare/CompareLeftPanel.tsx` — VisionModelSelector + 옛 input 정리

---

## Phase 0: 선행 정리 (1 task)

### Task 1: VisionModelSelector 컴포넌트 추출

**의도**: spec §8.2 — `app/vision/page.tsx:241-260` inline 코드를 컴포넌트로 분리. Compare 도 같은 UI 재사용 가능. 다른 페이지 영향 없음.

**Files:**
- Create: `frontend/components/studio/VisionModelSelector.tsx`
- Modify: `frontend/app/vision/page.tsx` (inline 제거 + 컴포넌트 사용)
- Test: `frontend/__tests__/vision-model-selector.test.tsx` (frontend 테스트 일관 패턴 — `frontend/__tests__/` 에 모든 test 위치)

- [ ] **Step 1: feature branch 생성**

```bash
git checkout -b feature/vision-compare-redesign
git status
```

Expected: branch 변경 + clean working tree (spec commit 이미 master 에 있음).

- [ ] **Step 2: 옛 inline 코드 위치 확인**

```bash
```

Run via Read tool:
```
Read frontend/app/vision/page.tsx offset=235 limit=40
```

확인할 것: VISION_MODEL_OPTIONS 정의 + 8B/Thinking 카드 렌더 markup + visionModel state binding.

- [ ] **Step 3: 실패 테스트 작성**

`frontend/components/studio/__tests__/VisionModelSelector.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import VisionModelSelector from "@/components/studio/VisionModelSelector";

describe("VisionModelSelector", () => {
  it("8B / Thinking 카드 두 장 렌더 + value 인 카드에 active 표시", () => {
    render(<VisionModelSelector value="qwen3-vl:8b" onChange={() => {}} />);
    const labels = screen.getAllByRole("button");
    expect(labels.length).toBe(2);
    expect(screen.getByText(/8B/i)).toBeInTheDocument();
    expect(screen.getByText(/Thinking/i)).toBeInTheDocument();
  });

  it("카드 클릭 시 onChange 호출 + 선택 모델 ID 전달", () => {
    const onChange = vi.fn();
    render(<VisionModelSelector value="qwen3-vl:8b" onChange={onChange} />);
    fireEvent.click(screen.getByText(/Thinking/i).closest("button")!);
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining("thinking"));
  });
});
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `cd frontend && npx vitest run components/studio/__tests__/VisionModelSelector.test.tsx`
Expected: FAIL — "Cannot find module '@/components/studio/VisionModelSelector'"

- [ ] **Step 5: 컴포넌트 구현**

> ⚠️ **2026-05-05 정정 박제** — 본 step 의 옛 코드 example 은 단순 텍스트 카드 + css transition 으로 잘못 작성됐었음. 실제로는 **옛 vision page 의 framer-motion + 배경이미지 카드 디자인을 그대로 보존** (시각 회귀 0). 아래 구현 가이드라인 참고 + `frontend/components/studio/video/VideoModelSegment.tsx` 패턴 미러링.

`frontend/components/studio/VisionModelSelector.tsx` 구현 가이드:

- **Props 시그니처** (3 필드):
  - `value: string` — settings store binding
  - `onChange: (next: string) => void`
  - `disabled?: boolean` — 분석/비교 진행 중 카드 클릭 막기 (옛 inline `disabled={analyzing}` 동작 보존). default false.
- **Type**:
  - `VisionModelId = "qwen3-vl:8b" | "qwen3-vl:8b-thinking-q8_0" | (string & {})` — 실 Ollama 모델 ID + escape hatch (옛 코드 호환)
  - `VisionModelOption = { id, label, bgImage, accentColor, glowRgba }` (5 필드)
- **Options export**:
  ```tsx
  export const VISION_MODEL_OPTIONS: readonly VisionModelOption[] = [
    { id: "qwen3-vl:8b", label: "8B", bgImage: "...", accentColor: "cyan", glowRgba: "..." },
    { id: "qwen3-vl:8b-thinking-q8_0", label: "Thinking", bgImage: "...", accentColor: "amber", glowRgba: "..." },
  ] as const;
  ```
  옛 inline 의 `as const` readonly tuple 패턴 보존. vision page 헤더 meta 라벨 표시에서도 import 재사용.
- **JSX 패턴** (VideoModelSegment 미러):
  - 컨테이너: `role="radiogroup"` + flex display
  - 각 카드: `<motion.button role="radio" aria-checked={active} aria-label={label}>` + `animate={{ flexGrow: active ? ACTIVE_FLEX : INACTIVE_FLEX }}` + SPRING_TRANSITION (stiffness 320 damping 26)
  - 좌측 gradient overlay (`pointerEvents:none`) + 좌측 16px 세로 중앙 모델명 + textShadow
  - `disabled` 시: `cursor: "not-allowed"` + `opacity: 0.55` + HTML `disabled` 속성 (자동 onClick 가드)
- **참고 파일**: `frontend/components/studio/video/VideoModelSegment.tsx` — 거의 byte-identical 패턴.
- **사용자 결정 박제** (2026-05-05): 옛 시각 디자인 그대로 보존. 단순화 X.

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd frontend && npx vitest run components/studio/__tests__/VisionModelSelector.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 7: vision page 에서 inline 제거 + 새 컴포넌트 사용**

`frontend/app/vision/page.tsx` (offset 235~265 부근 — VISION_MODEL_OPTIONS map 부분):

옛 inline 코드:
```tsx
{VISION_MODEL_OPTIONS.find((o) => o.id === visionModel)?.label ?? visionModel}
{VISION_MODEL_OPTIONS.map((opt) => {
  const active = visionModel === opt.id;
  /* 8B/Thinking 카드 markup */
})}
```

→ 다음 한 줄 교체:
```tsx
<VisionModelSelector value={visionModel} onChange={setVisionModel} />
```

import 추가 (page.tsx 상단):
```tsx
import VisionModelSelector from "@/components/studio/VisionModelSelector";
```

옛 `VISION_MODEL_OPTIONS` 정의가 vision page 안에 있었으면 컴포넌트로 이동했으니 제거.

- [ ] **Step 8: vision page 회귀 검증**

Run:
```bash
cd frontend
npx vitest run                          # 전체 frontend 테스트 (기준선 178 PASS · 무회귀)
npx tsc --noEmit                        # 타입 검증
npm run lint                            # eslint
```

Expected: 모두 clean. Vision 페이지 테스트 회귀 0.

- [ ] **Step 9: 시각 회귀 확인 (browser MCP)**

Vision 분석 페이지 (`/vision`) 열고 8B / Thinking 카드 visual 동일 확인. 클릭 시 store value 갱신 확인. (수동 — chrome MCP 사용 가능 시 자동.)

- [ ] **Step 10: Commit**

```bash
git add frontend/components/studio/VisionModelSelector.tsx \
        frontend/components/studio/__tests__/VisionModelSelector.test.tsx \
        frontend/app/vision/page.tsx
git commit -m "refactor(vision): VisionModelSelector 컴포넌트 추출 (vision/compare 공용 선행 정리)

vision page inline 코드 (8B/Thinking 카드 세그먼트) 를 별도 컴포넌트로 분리.
다음 단계 (Compare 재설계) 에서 CompareLeftPanel 도 동일 컴포넌트 사용.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1: 백엔드 모듈 골격 (5 task)

### Task 2: compare_pipeline_v4 패키지 + 5 카테고리 axes

**Files:**
- Create: `backend/studio/compare_pipeline_v4/__init__.py`
- Create: `backend/studio/compare_pipeline_v4/_axes.py`
- Test: `backend/tests/test_compare_v4_axes.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_compare_v4_axes.py`:

```python
"""compare_pipeline_v4 의 5 카테고리 axes 상수 검증."""

from studio.compare_pipeline_v4._axes import COMPARE_V4_AXES


def test_compare_v4_axes_5_categories_in_order():
    """vision_pipeline image_detail 의 5 슬롯과 동일 키 + 순서 (UI 매트릭스 일관)."""
    assert COMPARE_V4_AXES == (
        "composition",
        "subject",
        "clothing_or_materials",
        "environment",
        "lighting_camera_style",
    )


def test_compare_v4_axes_immutable_tuple():
    """튜플이라 mutation 안 됨 (실수 방지)."""
    assert isinstance(COMPARE_V4_AXES, tuple)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_v4_axes.py -v`
Expected: FAIL — "ModuleNotFoundError: No module named 'studio.compare_pipeline_v4'"

- [ ] **Step 3: 패키지 + axes 구현**

`backend/studio/compare_pipeline_v4/__init__.py`:
```python
"""
compare_pipeline_v4 — Vision Compare 재설계 (2-stage observe + diff_synthesize).

본질: "이미지의 차이를 자세히 깊이 분석".

Phase 1 (2026-05-05): 모듈 골격. Phase 2 에서 analyze_pair_v4 추가.
"""

from __future__ import annotations

# Phase 1 시점 — axes 만 export. analyze_pair_v4 는 Phase 2 에서 추가.
from ._axes import COMPARE_V4_AXES  # noqa: F401

__all__ = ["COMPARE_V4_AXES"]
```

`backend/studio/compare_pipeline_v4/_axes.py`:
```python
"""
compare_pipeline_v4._axes — 5 카테고리 axes 상수.

vision_pipeline.image_detail 의 9 슬롯 중 매핑 가능한 5개 (RecipeV2View 카드 구조).
순서 = UI 매트릭스 row 순서 (구도 → 피사체 → 의상·재질 → 환경 → 광원·카메라·스타일).
"""

from __future__ import annotations

# 튜플 — mutation 방지 (실수로 카테고리 추가 시 다른 곳 깨짐 검출용)
COMPARE_V4_AXES: tuple[str, ...] = (
    "composition",
    "subject",
    "clothing_or_materials",
    "environment",
    "lighting_camera_style",
)
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_v4_axes.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: 전체 pytest 회귀 0 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q`
Expected: 기준선 (master `fd9207e` = 474 PASS) + 2 신규 = **476 PASS**.

- [ ] **Step 6: Commit**

```bash
git add backend/studio/compare_pipeline_v4/__init__.py \
        backend/studio/compare_pipeline_v4/_axes.py \
        backend/tests/test_compare_v4_axes.py
git commit -m "feat(compare-v4): 모듈 골격 + 5 카테고리 axes (Phase 1 시작)"
```

---

### Task 3: V4 dataclass (`_types.py`)

**Files:**
- Create: `backend/studio/compare_pipeline_v4/_types.py`
- Test: `backend/tests/test_compare_v4_types.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_compare_v4_types.py`:

```python
"""V4 dataclass + to_dict camelCase 변환 검증."""

from studio.compare_pipeline_v4._types import (
    CompareAnalysisResultV4,
    CompareCategoryDiff,
    CompareKeyAnchor,
)


def test_category_diff_to_dict_camel_case():
    d = CompareCategoryDiff(
        image1="A", image2="B", diff="C",
        image1_ko="가", image2_ko="나", diff_ko="다",
    )
    out = d.to_dict()
    assert out == {
        "image1": "A", "image2": "B", "diff": "C",
        "image1Ko": "가", "image2Ko": "나", "diffKo": "다",
    }


def test_key_anchor_to_dict_camel_case():
    a = CompareKeyAnchor(
        label="gaze", image1="left", image2="right",
        image1_ko="왼쪽", image2_ko="오른쪽",
    )
    out = a.to_dict()
    assert out == {
        "label": "gaze", "image1": "left", "image2": "right",
        "image1Ko": "왼쪽", "image2Ko": "오른쪽",
    }


def test_result_v4_to_dict_full_camel_case():
    r = CompareAnalysisResultV4(
        summary_en="EN", summary_ko="KO",
        common_points_en=["c1"], common_points_ko=["공1"],
        key_differences_en=["d1"], key_differences_ko=["차1"],
        domain_match="person",
        category_diffs={
            "composition": CompareCategoryDiff(
                image1="x1", image2="x2", diff="x3",
                image1_ko="아", image2_ko="이", diff_ko="우",
            ),
        },
        category_scores={"composition": 87},
        key_anchors=[
            CompareKeyAnchor(
                label="gaze", image1="L", image2="R",
                image1_ko="좌", image2_ko="우",
            ),
        ],
        fidelity_score=87,
        transform_prompt_en="apply X",
        transform_prompt_ko="X 적용",
        uncertain_en="",
        uncertain_ko="",
        observation1={"raw1": "obs1"},
        observation2={"raw2": "obs2"},
        provider="ollama",
        fallback=False,
        analyzed_at=1700000000000,
        vision_model="qwen3-vl:8b",
        text_model="gemma4-un:latest",
    )
    out = r.to_dict()
    # camelCase 키 모두 존재 — spec §8.2 그대로
    expected_keys = {
        "summaryEn", "summaryKo",
        "commonPointsEn", "commonPointsKo",
        "keyDifferencesEn", "keyDifferencesKo",
        "domainMatch", "categoryDiffs", "categoryScores",
        "keyAnchors", "fidelityScore",
        "transformPromptEn", "transformPromptKo",
        "uncertainEn", "uncertainKo",
        "observation1", "observation2",
        "provider", "fallback", "analyzedAt",
        "visionModel", "textModel",
    }
    assert set(out.keys()) == expected_keys
    assert out["categoryDiffs"]["composition"]["image1Ko"] == "아"
    assert out["fidelityScore"] == 87


def test_result_v4_mixed_domain_empty_category_diffs():
    r = CompareAnalysisResultV4(
        summary_en="", summary_ko="",
        common_points_en=[], common_points_ko=[],
        key_differences_en=[], key_differences_ko=[],
        domain_match="mixed",
        category_diffs={},   # 빈 dict — 키 누락 X (spec STRICT JSON 룰)
        category_scores={},
        key_anchors=[],
        fidelity_score=None,
        transform_prompt_en="", transform_prompt_ko="",
        uncertain_en="", uncertain_ko="",
        observation1={}, observation2={},
        provider="ollama", fallback=False,
        analyzed_at=0, vision_model="qwen3-vl:8b",
        text_model="gemma4-un:latest",
    )
    out = r.to_dict()
    assert out["categoryDiffs"] == {}   # 키 누락 아님, 빈 객체
    assert out["fidelityScore"] is None
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_v4_types.py -v`
Expected: FAIL — "ImportError: cannot import name 'CompareAnalysisResultV4'"

- [ ] **Step 3: dataclass 구현**

`backend/studio/compare_pipeline_v4/_types.py`:

```python
"""
compare_pipeline_v4._types — V4 결과 dataclass.

원칙:
  - to_dict() 는 snake_case (Python) → camelCase (JSON) 변환 — frontend 친화 (spec §8.2).
  - 빈 객체/리스트는 None 이 아니라 {}/[] 로 채움 — STRICT JSON 룰 (키 누락 금지).
  - fidelity_score / category_scores 의 None 은 그대로 직렬화 (빈 매핑 X).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class CompareCategoryDiff:
    """카테고리별 [image1 묘사 / image2 묘사 / 차이 묘사] 트리플 (en + ko 6 슬롯)."""
    image1: str
    image2: str
    diff: str
    image1_ko: str = ""
    image2_ko: str = ""
    diff_ko: str = ""

    def to_dict(self) -> dict[str, str]:
        return {
            "image1": self.image1,
            "image2": self.image2,
            "diff": self.diff,
            "image1Ko": self.image1_ko,
            "image2Ko": self.image2_ko,
            "diffKo": self.diff_ko,
        }


@dataclass
class CompareKeyAnchor:
    """key visual anchor (gaze direction / hand position 등) — image1 vs image2 묘사."""
    label: str               # 짧은 phrase (en) — 번역 안 함
    image1: str
    image2: str
    image1_ko: str = ""
    image2_ko: str = ""

    def to_dict(self) -> dict[str, str]:
        return {
            "label": self.label,
            "image1": self.image1,
            "image2": self.image2,
            "image1Ko": self.image1_ko,
            "image2Ko": self.image2_ko,
        }


@dataclass
class CompareAnalysisResultV4:
    """V4 결과 — frontend `VisionCompareAnalysisV4` interface 미러."""
    # 헤더
    summary_en: str
    summary_ko: str
    common_points_en: list[str]
    common_points_ko: list[str]
    key_differences_en: list[str]
    key_differences_ko: list[str]

    # 도메인 + 매트릭스
    domain_match: str                                       # "person" | "object_scene" | "mixed"
    category_diffs: dict[str, CompareCategoryDiff]          # 5 카테고리 또는 빈 dict (mixed)
    category_scores: dict[str, int | None]                  # forward-compat (Phase 2 chip 펼침)
    key_anchors: list[CompareKeyAnchor]

    # 점수 + 변환
    fidelity_score: int | None                              # 0-100 또는 None
    transform_prompt_en: str
    transform_prompt_ko: str
    uncertain_en: str
    uncertain_ko: str

    # 원본 observation (on-demand prompt_synthesize 재사용)
    observation1: dict[str, Any]
    observation2: dict[str, Any]

    # 메타
    provider: str                                           # "ollama" | "fallback"
    fallback: bool
    analyzed_at: int                                        # ms epoch
    vision_model: str
    text_model: str

    def to_dict(self) -> dict[str, Any]:
        """snake_case → camelCase 직렬화 (spec §8.2)."""
        return {
            "summaryEn": self.summary_en,
            "summaryKo": self.summary_ko,
            "commonPointsEn": list(self.common_points_en),
            "commonPointsKo": list(self.common_points_ko),
            "keyDifferencesEn": list(self.key_differences_en),
            "keyDifferencesKo": list(self.key_differences_ko),
            "domainMatch": self.domain_match,
            "categoryDiffs": {k: v.to_dict() for k, v in self.category_diffs.items()},
            "categoryScores": dict(self.category_scores),
            "keyAnchors": [a.to_dict() for a in self.key_anchors],
            "fidelityScore": self.fidelity_score,
            "transformPromptEn": self.transform_prompt_en,
            "transformPromptKo": self.transform_prompt_ko,
            "uncertainEn": self.uncertain_en,
            "uncertainKo": self.uncertain_ko,
            "observation1": dict(self.observation1),
            "observation2": dict(self.observation2),
            "provider": self.provider,
            "fallback": self.fallback,
            "analyzedAt": self.analyzed_at,
            "visionModel": self.vision_model,
            "textModel": self.text_model,
        }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_v4_types.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/studio/compare_pipeline_v4/_types.py \
        backend/tests/test_compare_v4_types.py
git commit -m "feat(compare-v4): V4 dataclass + to_dict camelCase 직렬화"
```

---

### Task 4: JSON 정규화 helper (`_coerce.py`)

**Files:**
- Create: `backend/studio/compare_pipeline_v4/_coerce.py`
- Test: `backend/tests/test_compare_v4_coerce.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_compare_v4_coerce.py`:

```python
"""V4 JSON 정규화 helper (vision_pipeline observation_mapping 패턴 재사용)."""

import pytest

from studio.compare_pipeline_v4._coerce import (
    coerce_category_diff,
    coerce_domain_match,
    coerce_fidelity_score,
    coerce_key_anchor,
    coerce_str_list,
)


# domain_match
@pytest.mark.parametrize("inp,expected", [
    ("person", "person"),
    ("PERSON", "person"),
    ("  Object_Scene  ", "object_scene"),
    ("mixed", "mixed"),
    ("invalid", "mixed"),         # unknown → mixed (보수적 fallback)
    (None, "mixed"),
    ("", "mixed"),
])
def test_coerce_domain_match(inp, expected):
    assert coerce_domain_match(inp) == expected


# fidelity_score
@pytest.mark.parametrize("inp,expected", [
    (87, 87),
    ("75", 75),
    (105, 100),                    # clamp 0-100
    (-3, 0),
    (None, None),
    ("null", None),
    ("abc", None),
    (50.7, 50),                    # float → int
])
def test_coerce_fidelity_score(inp, expected):
    assert coerce_fidelity_score(inp) == expected


# str list — sentinel filter (vision_pipeline 패턴)
def test_coerce_str_list_sentinel_filter():
    out = coerce_str_list([
        "real point",
        "none",                    # sentinel
        "",                        # 빈
        "n/a",                     # sentinel
        "another real",
        None,                      # 비문자열
    ])
    assert out == ["real point", "another real"]


def test_coerce_str_list_max_n():
    out = coerce_str_list(["a"] * 20, max_n=6)
    assert len(out) == 6


def test_coerce_str_list_non_list():
    assert coerce_str_list(None) == []
    assert coerce_str_list("string") == []
    assert coerce_str_list({"a": 1}) == []


# category_diff
def test_coerce_category_diff_full():
    raw = {"image1": "A", "image2": "B", "diff": "C"}
    d = coerce_category_diff(raw)
    assert d.image1 == "A"
    assert d.image2 == "B"
    assert d.diff == "C"
    assert d.image1_ko == ""       # translate 단계 전엔 빈 문자열


def test_coerce_category_diff_missing_keys():
    """모델이 일부 키 누락한 경우 — 빈 문자열로 채움 (parser KeyError 방지)."""
    d = coerce_category_diff({"image1": "only"})
    assert d.image1 == "only"
    assert d.image2 == ""
    assert d.diff == ""


def test_coerce_category_diff_non_dict():
    d = coerce_category_diff(None)
    assert d.image1 == "" and d.image2 == "" and d.diff == ""


# key_anchor
def test_coerce_key_anchor():
    a = coerce_key_anchor({"label": "gaze", "image1": "L", "image2": "R"})
    assert a.label == "gaze" and a.image1 == "L" and a.image2 == "R"


def test_coerce_key_anchor_missing_label():
    a = coerce_key_anchor({"image1": "L", "image2": "R"})
    assert a.label == ""           # 빈 라벨도 허용 (UI 가 처리)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_v4_coerce.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: helper 구현**

`backend/studio/compare_pipeline_v4/_coerce.py`:

```python
"""
compare_pipeline_v4._coerce — JSON 정규화 helper.

vision_pipeline.observation_mapping 의 sentinel filter / coerce 패턴 재사용.
diff_synthesize 가 받는 모델 응답이 키 누락 / 잘못된 타입 / sentinel 등으로
깨질 때 안전하게 dataclass 채움.
"""

from __future__ import annotations

from typing import Any

from ._types import CompareCategoryDiff, CompareKeyAnchor


# vision_pipeline observation_mapping.SENTINEL_VALUES 와 동일
SENTINEL_VALUES = frozenset({
    "none",
    "null",
    "n/a",
    "na",
    "unknown",
    "unspecified",
    "not specified",
    "not visible",
    "not applicable",
})

VALID_DOMAINS = frozenset({"person", "object_scene", "mixed"})


def coerce_domain_match(value: Any) -> str:
    """domain 값 정규화 — unknown / 비정상 → 'mixed' (보수적 fallback)."""
    if not isinstance(value, str):
        return "mixed"
    norm = value.strip().lower()
    return norm if norm in VALID_DOMAINS else "mixed"


def coerce_fidelity_score(value: Any) -> int | None:
    """fidelity_score 정규화 — int 0-100 clamp 또는 None."""
    if value is None:
        return None
    # str "null" / "abc" 등 처리
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return max(0, min(100, n))


def coerce_str_list(value: Any, *, max_n: int = 8) -> list[str]:
    """list[str] 정규화 — sentinel/빈 문자열 filter, max_n cap."""
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        s = item.strip()
        if not s:
            continue
        if s.lower() in SENTINEL_VALUES:
            continue
        out.append(s)
        if len(out) >= max_n:
            break
    return out


def coerce_category_diff(raw: Any) -> CompareCategoryDiff:
    """카테고리 diff 트리플 정규화 — 키 누락 시 빈 문자열로 채움 (KeyError 방지)."""
    d: dict[str, Any] = raw if isinstance(raw, dict) else {}
    return CompareCategoryDiff(
        image1=_safe_str(d.get("image1")),
        image2=_safe_str(d.get("image2")),
        diff=_safe_str(d.get("diff")),
        # ko 슬롯은 translate 단계에서 채움 — 여기선 빈 문자열
    )


def coerce_key_anchor(raw: Any) -> CompareKeyAnchor:
    """key anchor 정규화 — label 누락도 빈 문자열로 (UI 가 처리)."""
    d: dict[str, Any] = raw if isinstance(raw, dict) else {}
    return CompareKeyAnchor(
        label=_safe_str(d.get("label")),
        image1=_safe_str(d.get("image1")),
        image2=_safe_str(d.get("image2")),
    )


def _safe_str(value: Any) -> str:
    """값을 문자열로 (None / 비문자열 → 빈 문자열). sentinel 도 빈 문자열 변환."""
    if not isinstance(value, str):
        return ""
    s = value.strip()
    if s.lower() in SENTINEL_VALUES:
        return ""
    return s
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_v4_coerce.py -v`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/studio/compare_pipeline_v4/_coerce.py \
        backend/tests/test_compare_v4_coerce.py
git commit -m "feat(compare-v4): JSON 정규화 helper (sentinel filter + coerce)"
```

---

### Task 5: `diff_synthesize` 시스템 프롬프트 + 호출 함수

**Files:**
- Create: `backend/studio/compare_pipeline_v4/diff_synthesize.py`
- Test: `backend/tests/test_diff_synthesize.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_diff_synthesize.py`:

```python
"""diff_synthesize — DIFF_SYNTHESIZE_SYSTEM 프롬프트 + 응답 파싱."""

import json
from unittest.mock import AsyncMock, patch

import pytest

from studio.compare_pipeline_v4.diff_synthesize import (
    DIFF_SYNTHESIZE_SYSTEM,
    synthesize_diff,
)
from studio.compare_pipeline_v4._types import CompareAnalysisResultV4


# ── 시스템 프롬프트 룰 박제 ──
def test_system_prompt_has_boilerplate_ban():
    """vision_pipeline 정공법: boilerplate 금지 명시."""
    assert "golden hour" in DIFF_SYNTHESIZE_SYSTEM
    assert "85mm lens" in DIFF_SYNTHESIZE_SYSTEM


def test_system_prompt_has_anchor_fidelity_rules():
    assert "Anchor Fidelity" in DIFF_SYNTHESIZE_SYSTEM or "do not generalize" in DIFF_SYNTHESIZE_SYSTEM.lower()


def test_system_prompt_has_strict_json_keys_required():
    assert "category_diffs" in DIFF_SYNTHESIZE_SYSTEM
    assert "key_anchors" in DIFF_SYNTHESIZE_SYSTEM
    assert "fidelity_score" in DIFF_SYNTHESIZE_SYSTEM


def test_system_prompt_has_identity_brand_ban():
    assert "brand" in DIFF_SYNTHESIZE_SYSTEM.lower() or "identity" in DIFF_SYNTHESIZE_SYSTEM.lower()


# ── synthesize_diff: 정상 응답 ──
@pytest.mark.asyncio
async def test_synthesize_diff_full_response():
    fake_response = json.dumps({
        "summary": "Both show the same person; image2 is winking.",
        "common_points": ["same person", "same outfit"],
        "key_differences": ["one eye closed", "head turned slightly"],
        "domain_match": "person",
        "category_diffs": {
            "composition": {"image1": "head-on", "image2": "3/4 view", "diff": "head turned"},
            "subject": {"image1": "both eyes open", "image2": "left eye closed", "diff": "winking"},
            "clothing_or_materials": {"image1": "white tank", "image2": "white tank", "diff": "identical"},
            "environment": {"image1": "studio", "image2": "studio", "diff": "identical"},
            "lighting_camera_style": {"image1": "softbox", "image2": "softbox", "diff": "identical"},
        },
        "category_scores": {
            "composition": 85, "subject": 70, "clothing_or_materials": 100,
            "environment": 100, "lighting_camera_style": 95,
        },
        "key_anchors": [
            {"label": "eye state", "image1": "both eyes open", "image2": "left eye closed"},
        ],
        "fidelity_score": 88,
        "transform_prompt": "close left eye, turn head 30 degrees",
        "uncertain": "",
    })

    with patch(
        "studio.compare_pipeline_v4.diff_synthesize.call_chat_payload",
        new=AsyncMock(return_value=fake_response),
    ):
        result = await synthesize_diff(
            observation1={"raw1": "obs1"},
            observation2={"raw2": "obs2"},
            compare_hint="",
            text_model="gemma4-un:latest",
            timeout=120.0,
            ollama_url="http://localhost:11434",
        )

    assert isinstance(result, CompareAnalysisResultV4)
    assert result.domain_match == "person"
    assert result.fidelity_score == 88
    assert "composition" in result.category_diffs
    assert result.category_diffs["composition"].diff == "head turned"
    assert result.category_scores["subject"] == 70
    assert len(result.key_anchors) == 1
    assert result.key_anchors[0].label == "eye state"


# ── mixed 도메인 fallback ──
@pytest.mark.asyncio
async def test_synthesize_diff_mixed_domain_empty_category_diffs():
    fake_response = json.dumps({
        "summary": "image1 is a portrait, image2 is a landscape.",
        "common_points": ["both photographic"],
        "key_differences": ["subject vs scene", "different palettes"],
        "domain_match": "mixed",
        "category_diffs": {},                  # 빈 dict — STRICT JSON 룰
        "category_scores": {},
        "key_anchors": [
            {"label": "subject type", "image1": "person", "image2": "mountain landscape"},
            {"label": "color palette", "image1": "warm skin tones", "image2": "cool blue/grey"},
        ],
        "fidelity_score": None,                # mixed → null
        "transform_prompt": "replace subject with landscape composition",
        "uncertain": "",
    })

    with patch(
        "studio.compare_pipeline_v4.diff_synthesize.call_chat_payload",
        new=AsyncMock(return_value=fake_response),
    ):
        result = await synthesize_diff(
            observation1={}, observation2={}, compare_hint="",
            text_model="gemma4-un:latest", timeout=120.0,
            ollama_url="http://localhost:11434",
        )

    assert result.domain_match == "mixed"
    assert result.category_diffs == {}
    assert result.fidelity_score is None
    assert len(result.key_anchors) == 2


# ── parse 실패 fallback ──
@pytest.mark.asyncio
async def test_synthesize_diff_parse_failed_fallback():
    with patch(
        "studio.compare_pipeline_v4.diff_synthesize.call_chat_payload",
        new=AsyncMock(return_value="not json {{"),
    ):
        result = await synthesize_diff(
            observation1={}, observation2={}, compare_hint="",
            text_model="gemma4-un:latest", timeout=120.0,
            ollama_url="http://localhost:11434",
        )

    assert result.fallback is True
    assert result.provider == "fallback"
    assert result.summary_en == ""
    assert result.fidelity_score is None
    assert result.category_diffs == {}


# ── 빈 응답 fallback ──
@pytest.mark.asyncio
async def test_synthesize_diff_empty_response_fallback():
    with patch(
        "studio.compare_pipeline_v4.diff_synthesize.call_chat_payload",
        new=AsyncMock(return_value=""),
    ):
        result = await synthesize_diff(
            observation1={}, observation2={}, compare_hint="",
            text_model="gemma4-un:latest", timeout=120.0,
            ollama_url="http://localhost:11434",
        )

    assert result.fallback is True


# ── compare_hint 처리 ──
@pytest.mark.asyncio
async def test_synthesize_diff_with_hint_passes_to_user_payload():
    """hint 가 user payload 에 포함되고 빈 hint 는 placeholder 로 변환."""
    fake_response = json.dumps({
        "summary": "", "common_points": [], "key_differences": [],
        "domain_match": "person",
        "category_diffs": {k: {"image1": "", "image2": "", "diff": ""} for k in
                           ["composition", "subject", "clothing_or_materials", "environment", "lighting_camera_style"]},
        "category_scores": {},
        "key_anchors": [], "fidelity_score": None,
        "transform_prompt": "", "uncertain": "",
    })

    captured_payloads = []

    async def capture_payload(*, ollama_url, payload, timeout, **kwargs):
        captured_payloads.append(payload)
        return fake_response

    with patch(
        "studio.compare_pipeline_v4.diff_synthesize.call_chat_payload",
        new=capture_payload,
    ):
        await synthesize_diff(
            observation1={}, observation2={}, compare_hint="얼굴 표정만 집중",
            text_model="gemma4-un:latest", timeout=120.0,
            ollama_url="http://localhost:11434",
        )

    assert len(captured_payloads) == 1
    user_msg = captured_payloads[0]["messages"][1]["content"]
    assert "얼굴 표정만 집중" in user_msg

    # 빈 hint 는 (not provided) 로 변환
    captured_payloads.clear()
    with patch(
        "studio.compare_pipeline_v4.diff_synthesize.call_chat_payload",
        new=capture_payload,
    ):
        await synthesize_diff(
            observation1={}, observation2={}, compare_hint="",
            text_model="gemma4-un:latest", timeout=120.0,
            ollama_url="http://localhost:11434",
        )
    assert "not provided" in captured_payloads[0]["messages"][1]["content"].lower()
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_diff_synthesize.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: `diff_synthesize` 구현**

`backend/studio/compare_pipeline_v4/diff_synthesize.py`:

```python
"""
compare_pipeline_v4.diff_synthesize — V4 차이 합성 stage.

text 모델 (gemma4-un, think:false) 이 두 observation JSON + (선택) compare_hint
받아 V4 결과 dataclass 합성.

원칙 (vision_pipeline 정공법 그대로 이식):
  - boilerplate 금지 (golden hour / 85mm lens / masterpiece 등)
  - Anchor Fidelity Rules — generalize 금지 (specific phrase 그대로 인용)
  - Identity / brand / celebrity 금지
  - STRICT JSON: 모든 키 항상 출력 (키 누락 X · spec §4.2)
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from .._json_utils import parse_strict_json as _parse_strict_json
from .._ollama_client import call_chat_payload
from ._axes import COMPARE_V4_AXES
from ._coerce import (
    coerce_category_diff,
    coerce_domain_match,
    coerce_fidelity_score,
    coerce_key_anchor,
    coerce_str_list,
)
from ._types import CompareAnalysisResultV4, CompareCategoryDiff

log = logging.getLogger(__name__)


DIFF_SYNTHESIZE_SYSTEM = """You are an expert image-comparison analyst.

You receive TWO observation JSON objects (image1, image2) extracted by a vision model.
Your job is to produce a deep, specific difference analysis between the two images.

Output STRICT JSON only:
{
  "summary": "<en, 3-5 sentences — overall comparison>",
  "common_points": ["<en short phrase>", ...],
  "key_differences": ["<en short phrase>", ...],
  "domain_match": "person|object_scene|mixed",
  "category_diffs": {
    "composition":           { "image1": "<en>", "image2": "<en>", "diff": "<en>" },
    "subject":               { "image1": "<en>", "image2": "<en>", "diff": "<en>" },
    "clothing_or_materials": { "image1": "<en>", "image2": "<en>", "diff": "<en>" },
    "environment":           { "image1": "<en>", "image2": "<en>", "diff": "<en>" },
    "lighting_camera_style": { "image1": "<en>", "image2": "<en>", "diff": "<en>" }
  },
  "category_scores": {
    "composition":           <integer 0-100 OR null>,
    "subject":               <integer 0-100 OR null>,
    "clothing_or_materials": <integer 0-100 OR null>,
    "environment":           <integer 0-100 OR null>,
    "lighting_camera_style": <integer 0-100 OR null>
  },
  "key_anchors": [
    { "label": "<en short>", "image1": "<en>", "image2": "<en>" }
  ],
  "fidelity_score": <integer 0-100 OR null>,
  "transform_prompt": "<en t2i instructions to turn image1 into image2>",
  "uncertain": "<en or empty string>"
}

STRICT JSON RULES:
- ALWAYS output every key — never omit any field. Use {} or [] or "" or null for empty.
- If domain_match == "mixed", category_diffs MUST be {} (empty object, not missing).
- fidelity_score: integer 0-100, or null if domain_match == "mixed" or images are fundamentally different concepts.
- category_scores values: integer 0-100, or null. Always output every category key.

ANCHOR FIDELITY RULES (do not generalize):
- Reuse the most specific phrases from the observation JSON verbatim.
- "asymmetric cross-strap cutout cropped tank top" must NOT be summarized as "simple tank top".
- "cup raised to lips" must NOT be summarized as "holding a cup".
- "transparent raincoats" must NOT become "silhouettes".
- If unsure, write the uncertain field rather than confident generalization.

BOILERPLATE BAN:
- Do NOT use generic phrases unless directly supported by the observations:
  golden hour, 85mm lens, softbox lighting, masterpiece, ultra detailed, muted earth tones, cinematic editorial.

IDENTITY / BRAND BAN:
- Do not name brands, real identities, celebrities, or copyrighted characters.
- Keep subjects fictional and adult.

OBSERVATION SUB-DETAIL USAGE:
- vision_observe sub-detail slots (subjects.face_detail / object_interaction / clothing_detail / environment.crowd_detail)
  must be folded into category_diffs and key_anchors.
- "left_eye=closed, right_eye=open" → key_anchors entry with label "eye state",
  image1: "both eyes open", image2: "winking — left eye closed".
- Do NOT compress to generic phrase like "eyes".

FIDELITY_SCORE RULES:
- gaze direction / head angle / facial expression / pose changed: score MUST be ≤ 90.
- 2 or more of the above changed: score MUST be ≤ 82.
- domain_match == "mixed": score MUST be null.
- "Default to LOW end when unsure. Under-score before over-score."

LIST SIZES:
- common_points: 3~6 entries. key_differences: 3~6 entries.
- key_anchors: 3~5 (same domain) or 5~8 (mixed domain — fills matrix gap).

When the user comparison hint is provided, FOCUS this comparison on that hint.
"""


def _build_user_payload(
    observation1: dict[str, Any],
    observation2: dict[str, Any],
    compare_hint: str,
) -> str:
    """user message — two observation JSON dumps + hint (or placeholder)."""
    hint_clean = (compare_hint or "").strip()[:400]
    if hint_clean:
        hint_line = f'User comparison hint: "{hint_clean}"'
    else:
        hint_line = "User comparison hint: (not provided — compare all aspects)"
    return (
        f"Image1 observation JSON:\n```json\n{json.dumps(observation1, ensure_ascii=False, indent=2)}\n```\n\n"
        f"Image2 observation JSON:\n```json\n{json.dumps(observation2, ensure_ascii=False, indent=2)}\n```\n\n"
        f"{hint_line}\n\n"
        "Produce the deep difference analysis. Return STRICT JSON only."
    )


def _empty_v4_result(*, vision_model: str, text_model: str, fallback: bool) -> CompareAnalysisResultV4:
    """비어있는 V4 결과 (fallback 또는 input 빈 경우)."""
    return CompareAnalysisResultV4(
        summary_en="", summary_ko="",
        common_points_en=[], common_points_ko=[],
        key_differences_en=[], key_differences_ko=[],
        domain_match="mixed",
        category_diffs={},
        category_scores={k: None for k in COMPARE_V4_AXES},
        key_anchors=[],
        fidelity_score=None,
        transform_prompt_en="", transform_prompt_ko="",
        uncertain_en="", uncertain_ko="",
        observation1={}, observation2={},
        provider="fallback" if fallback else "ollama",
        fallback=fallback,
        analyzed_at=int(time.time() * 1000),
        vision_model=vision_model,
        text_model=text_model,
    )


async def synthesize_diff(
    *,
    observation1: dict[str, Any],
    observation2: dict[str, Any],
    compare_hint: str,
    text_model: str,
    timeout: float,
    ollama_url: str,
    keep_alive: str | None = None,
) -> CompareAnalysisResultV4:
    """observation1, observation2 → V4 결과 dataclass.

    실패 (network / parse / 빈 응답) 시 fallback 결과 반환 (HTTP 200 원칙).
    """
    if keep_alive is None:
        from ..presets import resolve_ollama_keep_alive
        resolved_keep_alive = resolve_ollama_keep_alive()
    else:
        resolved_keep_alive = keep_alive

    payload = {
        "model": text_model,
        "messages": [
            {"role": "system", "content": DIFF_SYNTHESIZE_SYSTEM},
            {"role": "user", "content": _build_user_payload(observation1, observation2, compare_hint)},
        ],
        "stream": False,
        "format": "json",
        "think": False,                          # CLAUDE.md rule — gemma4-un reasoning 기본 OFF
        "keep_alive": resolved_keep_alive,
        "options": {"temperature": 0.4, "num_ctx": 8192},
    }

    try:
        raw = await call_chat_payload(
            ollama_url=ollama_url,
            payload=payload,
            timeout=timeout,
            allow_thinking_fallback=False,
        )
    except Exception as e:
        log.warning("diff_synthesize call failed (%s): %s", text_model, e)
        return _empty_v4_result(vision_model="", text_model=text_model, fallback=True)

    if not raw:
        log.warning("diff_synthesize empty response from %s", text_model)
        return _empty_v4_result(vision_model="", text_model=text_model, fallback=True)

    parsed = _parse_strict_json(raw)
    if not isinstance(parsed, dict):
        log.warning("diff_synthesize JSON parse failed (raw len=%d)", len(raw))
        return _empty_v4_result(vision_model="", text_model=text_model, fallback=True)

    # ── 정규화 ──
    domain = coerce_domain_match(parsed.get("domain_match"))
    cat_diffs_raw = parsed.get("category_diffs", {})
    cat_diffs: dict[str, CompareCategoryDiff] = {}
    if domain != "mixed" and isinstance(cat_diffs_raw, dict):
        for axis in COMPARE_V4_AXES:
            cat_diffs[axis] = coerce_category_diff(cat_diffs_raw.get(axis))
    # mixed 면 빈 dict 유지 (spec §4.2)

    cat_scores_raw = parsed.get("category_scores", {})
    cat_scores: dict[str, int | None] = {}
    if isinstance(cat_scores_raw, dict):
        for axis in COMPARE_V4_AXES:
            cat_scores[axis] = coerce_fidelity_score(cat_scores_raw.get(axis))
    else:
        cat_scores = {k: None for k in COMPARE_V4_AXES}

    anchors_raw = parsed.get("key_anchors", [])
    anchors = []
    if isinstance(anchors_raw, list):
        for raw_anchor in anchors_raw[:8]:
            a = coerce_key_anchor(raw_anchor)
            if a.label or a.image1 or a.image2:    # 완전히 빈 entry 는 skip
                anchors.append(a)

    return CompareAnalysisResultV4(
        summary_en=_safe_str(parsed.get("summary")),
        summary_ko="",
        common_points_en=coerce_str_list(parsed.get("common_points"), max_n=6),
        common_points_ko=[],
        key_differences_en=coerce_str_list(parsed.get("key_differences"), max_n=6),
        key_differences_ko=[],
        domain_match=domain,
        category_diffs=cat_diffs,
        category_scores=cat_scores,
        key_anchors=anchors,
        fidelity_score=coerce_fidelity_score(parsed.get("fidelity_score")),
        transform_prompt_en=_safe_str(parsed.get("transform_prompt")),
        transform_prompt_ko="",
        uncertain_en=_safe_str(parsed.get("uncertain")),
        uncertain_ko="",
        observation1=observation1,
        observation2=observation2,
        provider="ollama",
        fallback=False,
        analyzed_at=int(time.time() * 1000),
        vision_model="",                          # pipeline 단계에서 채움
        text_model=text_model,
    )


def _safe_str(value: Any) -> str:
    """str 안전 추출 — None / 비문자열 → 빈 문자열."""
    return value.strip() if isinstance(value, str) else ""
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_diff_synthesize.py -v`
Expected: PASS (8 tests)

- [ ] **Step 5: 전체 회귀**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q`
Expected: 기준선 + 신규 24 = **498 PASS** (Task 2~5 누적).

- [ ] **Step 6: Commit**

```bash
git add backend/studio/compare_pipeline_v4/diff_synthesize.py \
        backend/tests/test_diff_synthesize.py
git commit -m "feat(compare-v4): diff_synthesize 시스템 프롬프트 + 합성 함수 (vision 정공법 이식)"
```

---

### Task 6: `__init__.py` facade 확장 (Phase 1 마무리)

**Files:**
- Modify: `backend/studio/compare_pipeline_v4/__init__.py`

- [ ] **Step 1: facade re-export 추가**

```python
"""
compare_pipeline_v4 — Vision Compare 재설계 (2-stage observe + diff_synthesize).

Phase 1: 모듈 골격 + dataclass + helper + diff_synthesize.
Phase 2: pipeline.py (analyze_pair_v4) + translate.py 추가 예정.

Import 정책 (옵션 D · vision_pipeline Phase 4.3 codex C2 학습 박제):
  - 신규 코드는 sub-module 직접 import (`from studio.compare_pipeline_v4._coerce import ...`)
  - facade alias 는 production import 호환 / 옛 테스트만 사용
"""

from __future__ import annotations

from ._axes import COMPARE_V4_AXES
from ._coerce import (
    coerce_category_diff,
    coerce_domain_match,
    coerce_fidelity_score,
    coerce_key_anchor,
    coerce_str_list,
)
from ._types import (
    CompareAnalysisResultV4,
    CompareCategoryDiff,
    CompareKeyAnchor,
)
from .diff_synthesize import DIFF_SYNTHESIZE_SYSTEM, synthesize_diff

__all__ = [
    "COMPARE_V4_AXES",
    "CompareAnalysisResultV4",
    "CompareCategoryDiff",
    "CompareKeyAnchor",
    "DIFF_SYNTHESIZE_SYSTEM",
    "coerce_category_diff",
    "coerce_domain_match",
    "coerce_fidelity_score",
    "coerce_key_anchor",
    "coerce_str_list",
    "synthesize_diff",
]
```

- [ ] **Step 2: 회귀 검증**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q`
Expected: 회귀 0.

- [ ] **Step 3: Commit**

```bash
git add backend/studio/compare_pipeline_v4/__init__.py
git commit -m "feat(compare-v4): __init__ facade re-export (Phase 1 마무리)"
```

---

## Phase 2: Backend pipeline orchestration (3 task)

### Task 7: 번역 stage (`translate.py`)

**Files:**
- Create: `backend/studio/compare_pipeline_v4/translate.py`
- Test: `backend/tests/test_compare_v4_translate.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_compare_v4_translate.py`:

```python
"""V4 결과 영문 → 한국어 일괄 번역 (flatten/unflatten)."""

import json
from unittest.mock import AsyncMock, patch

import pytest

from studio.compare_pipeline_v4._types import (
    CompareAnalysisResultV4,
    CompareCategoryDiff,
    CompareKeyAnchor,
)
from studio.compare_pipeline_v4.translate import translate_v4_result


def _sample_result() -> CompareAnalysisResultV4:
    return CompareAnalysisResultV4(
        summary_en="Both images show the same person.",
        summary_ko="",
        common_points_en=["same person", "same outfit"],
        common_points_ko=[],
        key_differences_en=["one eye closed"],
        key_differences_ko=[],
        domain_match="person",
        category_diffs={
            "composition": CompareCategoryDiff(
                image1="head-on", image2="3/4 view", diff="head turned",
            ),
        },
        category_scores={"composition": 85},
        key_anchors=[
            CompareKeyAnchor(label="eye state", image1="open", image2="closed"),
        ],
        fidelity_score=88,
        transform_prompt_en="close left eye",
        transform_prompt_ko="",
        uncertain_en="",
        uncertain_ko="",
        observation1={}, observation2={},
        provider="ollama", fallback=False,
        analyzed_at=0,
        vision_model="qwen3-vl:8b",
        text_model="gemma4-un:latest",
    )


@pytest.mark.asyncio
async def test_translate_v4_full_success():
    """모든 ko 슬롯이 채워짐."""
    fake_ko = json.dumps({
        "summary": "두 이미지는 같은 사람.",
        "commonPoints": ["같은 사람", "같은 옷"],
        "keyDifferences": ["한쪽 눈 감음"],
        "categoryDiffs": {
            "composition": {"image1": "정면", "image2": "3/4 측면", "diff": "고개 돌림"},
        },
        "keyAnchors": [
            {"label_kept": "eye state", "image1": "뜸", "image2": "감음"},
        ],
        "transformPrompt": "왼쪽 눈 감기",
        "uncertain": "",
    })

    with patch(
        "studio.compare_pipeline_v4.translate.call_chat_payload",
        new=AsyncMock(return_value=fake_ko),
    ):
        result = await translate_v4_result(
            _sample_result(),
            text_model="gemma4-un:latest",
            timeout=60.0,
            ollama_url="http://localhost:11434",
        )

    assert result.summary_ko == "두 이미지는 같은 사람."
    assert result.common_points_ko == ["같은 사람", "같은 옷"]
    assert result.key_differences_ko == ["한쪽 눈 감음"]
    assert result.category_diffs["composition"].image1_ko == "정면"
    assert result.category_diffs["composition"].diff_ko == "고개 돌림"
    assert result.key_anchors[0].image1_ko == "뜸"
    assert result.transform_prompt_ko == "왼쪽 눈 감기"


@pytest.mark.asyncio
async def test_translate_v4_failure_fallback_en_to_ko():
    """번역 실패 시 ko 슬롯이 en 값으로 fallback."""
    with patch(
        "studio.compare_pipeline_v4.translate.call_chat_payload",
        new=AsyncMock(return_value=""),
    ):
        result = await translate_v4_result(
            _sample_result(),
            text_model="gemma4-un:latest",
            timeout=60.0,
            ollama_url="http://localhost:11434",
        )

    # fallback: ko = en
    assert result.summary_ko == "Both images show the same person."
    assert result.common_points_ko == ["same person", "same outfit"]
    assert result.category_diffs["composition"].image1_ko == "head-on"
    assert result.transform_prompt_ko == "close left eye"


@pytest.mark.asyncio
async def test_translate_v4_label_not_translated():
    """key_anchor.label 은 번역 안 함 (en 그대로 유지)."""
    fake_ko = json.dumps({
        "summary": "테스트",
        "commonPoints": [], "keyDifferences": [], "categoryDiffs": {},
        "keyAnchors": [{"image1": "뜸", "image2": "감음"}],
        "transformPrompt": "", "uncertain": "",
    })

    with patch(
        "studio.compare_pipeline_v4.translate.call_chat_payload",
        new=AsyncMock(return_value=fake_ko),
    ):
        result = await translate_v4_result(
            _sample_result(),
            text_model="gemma4-un:latest",
            timeout=60.0,
            ollama_url="http://localhost:11434",
        )

    # label 은 en 그대로
    assert result.key_anchors[0].label == "eye state"
    assert result.key_anchors[0].image1_ko == "뜸"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_v4_translate.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: `translate.py` 구현**

`backend/studio/compare_pipeline_v4/translate.py`:

```python
"""
compare_pipeline_v4.translate — V4 결과 영문 → 한국어 일괄 번역.

flatten: 모든 *_en 슬롯을 키 path 와 함께 평면 dict 로 변환 → gemma4 한 번 호출.
unflatten: 응답 받아 dataclass 의 *_ko 슬롯에 복원.
실패 시 *_ko 가 *_en 으로 fallback (UI 가 망가지지 않게).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .._json_utils import parse_strict_json as _parse_strict_json
from .._ollama_client import call_chat_payload
from ._types import CompareAnalysisResultV4

log = logging.getLogger(__name__)


TRANSLATE_V4_SYSTEM = """You are a translator. Translate ONLY into natural Korean.

You receive a JSON object with English content. Translate every string value to Korean,
keeping the JSON structure exactly the same. Output STRICT JSON only.

Rules:
- Translate naturally — do NOT word-for-word.
- Use polite/formal Korean (존댓말).
- Keep technical terms in Korean (e.g., "구도", "피사체").
- Do NOT translate label fields (those are short technical anchors — keep English).
- All other string values: translate.
- All keys (e.g., "summary", "commonPoints"): keep exactly as input.
"""


async def translate_v4_result(
    result: CompareAnalysisResultV4,
    *,
    text_model: str,
    timeout: float,
    ollama_url: str,
) -> CompareAnalysisResultV4:
    """V4 dataclass 를 in-place 번역 (mutation 후 같은 객체 반환)."""
    payload_dict = _flatten_for_translation(result)

    payload = {
        "model": text_model,
        "messages": [
            {"role": "system", "content": TRANSLATE_V4_SYSTEM},
            {
                "role": "user",
                "content": (
                    "Translate this object to Korean. Keep keys, JSON structure, "
                    "and 'label' fields unchanged.\n\n"
                    f"```json\n{json.dumps(payload_dict, ensure_ascii=False, indent=2)}\n```"
                ),
            },
        ],
        "stream": False,
        "format": "json",
        "think": False,
        "keep_alive": "5m",
        "options": {"temperature": 0.3, "num_ctx": 8192},
    }

    try:
        raw = await call_chat_payload(
            ollama_url=ollama_url,
            payload=payload,
            timeout=timeout,
            allow_thinking_fallback=False,
        )
    except Exception as e:
        log.warning("translate_v4 call failed: %s", e)
        _apply_en_fallback_to_ko(result)
        return result

    if not raw:
        log.warning("translate_v4 empty response")
        _apply_en_fallback_to_ko(result)
        return result

    parsed = _parse_strict_json(raw)
    if not isinstance(parsed, dict):
        log.warning("translate_v4 parse failed (raw len=%d)", len(raw))
        _apply_en_fallback_to_ko(result)
        return result

    _apply_translation_to_ko(result, parsed)
    return result


def _flatten_for_translation(r: CompareAnalysisResultV4) -> dict[str, Any]:
    """결과의 *_en 슬롯을 평면 dict 로 (label 은 표시만, 번역하지 말라는 신호)."""
    return {
        "summary": r.summary_en,
        "commonPoints": list(r.common_points_en),
        "keyDifferences": list(r.key_differences_en),
        "categoryDiffs": {
            k: {"image1": v.image1, "image2": v.image2, "diff": v.diff}
            for k, v in r.category_diffs.items()
        },
        "keyAnchors": [
            {
                "label_kept": a.label,            # 모델에게 "이 키는 번역하지 마" 신호
                "image1": a.image1,
                "image2": a.image2,
            }
            for a in r.key_anchors
        ],
        "transformPrompt": r.transform_prompt_en,
        "uncertain": r.uncertain_en,
    }


def _apply_translation_to_ko(r: CompareAnalysisResultV4, ko: dict[str, Any]) -> None:
    """번역 결과를 *_ko 슬롯에 적용. 실패한 키는 en 으로 fallback."""
    r.summary_ko = _str_or_fallback(ko.get("summary"), r.summary_en)
    r.common_points_ko = _list_or_fallback(ko.get("commonPoints"), r.common_points_en)
    r.key_differences_ko = _list_or_fallback(ko.get("keyDifferences"), r.key_differences_en)

    cat_ko = ko.get("categoryDiffs")
    if isinstance(cat_ko, dict):
        for k, v in r.category_diffs.items():
            tr = cat_ko.get(k) if isinstance(cat_ko.get(k), dict) else {}
            v.image1_ko = _str_or_fallback(tr.get("image1"), v.image1)
            v.image2_ko = _str_or_fallback(tr.get("image2"), v.image2)
            v.diff_ko = _str_or_fallback(tr.get("diff"), v.diff)
    else:
        for v in r.category_diffs.values():
            v.image1_ko, v.image2_ko, v.diff_ko = v.image1, v.image2, v.diff

    anchors_ko = ko.get("keyAnchors")
    if isinstance(anchors_ko, list) and len(anchors_ko) == len(r.key_anchors):
        for a, tr in zip(r.key_anchors, anchors_ko):
            t = tr if isinstance(tr, dict) else {}
            a.image1_ko = _str_or_fallback(t.get("image1"), a.image1)
            a.image2_ko = _str_or_fallback(t.get("image2"), a.image2)
            # label 은 그대로 (en 유지) — 번역 시도 X
    else:
        for a in r.key_anchors:
            a.image1_ko, a.image2_ko = a.image1, a.image2

    r.transform_prompt_ko = _str_or_fallback(ko.get("transformPrompt"), r.transform_prompt_en)
    r.uncertain_ko = _str_or_fallback(ko.get("uncertain"), r.uncertain_en)


def _apply_en_fallback_to_ko(r: CompareAnalysisResultV4) -> None:
    """번역 실패 — 모든 *_ko 슬롯에 *_en 그대로 복사."""
    r.summary_ko = r.summary_en
    r.common_points_ko = list(r.common_points_en)
    r.key_differences_ko = list(r.key_differences_en)
    for v in r.category_diffs.values():
        v.image1_ko, v.image2_ko, v.diff_ko = v.image1, v.image2, v.diff
    for a in r.key_anchors:
        a.image1_ko, a.image2_ko = a.image1, a.image2
    r.transform_prompt_ko = r.transform_prompt_en
    r.uncertain_ko = r.uncertain_en


def _str_or_fallback(value: Any, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


def _list_or_fallback(value: Any, fallback: list[str]) -> list[str]:
    if isinstance(value, list):
        out = [s.strip() for s in value if isinstance(s, str) and s.strip()]
        if out:
            return out
    return list(fallback)
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_v4_translate.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/studio/compare_pipeline_v4/translate.py \
        backend/tests/test_compare_v4_translate.py
git commit -m "feat(compare-v4): translate stage (flatten/unflatten + en fallback)"
```

---

### Task 8: `analyze_pair_v4` 4-stage orchestrator (`pipeline.py`)

**Files:**
- Create: `backend/studio/compare_pipeline_v4/pipeline.py`
- Modify: `backend/studio/compare_pipeline_v4/__init__.py` (re-export 추가)
- Test: `backend/tests/test_compare_v4_pipeline.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_compare_v4_pipeline.py`:

```python
"""analyze_pair_v4 — 4 stage orchestration + unload 호출 검증."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from studio.compare_pipeline_v4 import analyze_pair_v4
from studio.compare_pipeline_v4._types import CompareAnalysisResultV4


def _fake_observation(label: str) -> dict:
    return {"subjects": [{"broad_visible_appearance": label}]}


def _fake_diff_result() -> CompareAnalysisResultV4:
    return CompareAnalysisResultV4(
        summary_en="diff", summary_ko="",
        common_points_en=[], common_points_ko=[],
        key_differences_en=[], key_differences_ko=[],
        domain_match="person",
        category_diffs={},
        category_scores={},
        key_anchors=[],
        fidelity_score=85,
        transform_prompt_en="", transform_prompt_ko="",
        uncertain_en="", uncertain_ko="",
        observation1=_fake_observation("a"),
        observation2=_fake_observation("b"),
        provider="ollama", fallback=False, analyzed_at=0,
        vision_model="", text_model="gemma4-un:latest",
    )


@pytest.mark.asyncio
async def test_analyze_pair_v4_calls_4_stages_in_order():
    """observe1 → observe2 → diff_synth → translate 순서 + progress callback emit."""
    progress_calls = []

    async def on_progress(stage_type: str) -> None:
        progress_calls.append(stage_type)

    obs1 = _fake_observation("img1")
    obs2 = _fake_observation("img2")

    with patch(
        "studio.compare_pipeline_v4.pipeline.observe_image",
        new=AsyncMock(side_effect=[obs1, obs2]),
    ) as mock_observe, patch(
        "studio.compare_pipeline_v4.pipeline.synthesize_diff",
        new=AsyncMock(return_value=_fake_diff_result()),
    ) as mock_diff, patch(
        "studio.compare_pipeline_v4.pipeline.translate_v4_result",
        new=AsyncMock(side_effect=lambda r, **k: r),
    ) as mock_translate, patch(
        "studio.compare_pipeline_v4.pipeline.unload_model",
        new=AsyncMock(),
    ) as mock_unload:
        result = await analyze_pair_v4(
            image1_bytes=b"\x89PNG_fake1",
            image2_bytes=b"\x89PNG_fake2",
            image1_w=512, image1_h=512,
            image2_w=512, image2_h=512,
            compare_hint="",
            vision_model="qwen3-vl:8b",
            text_model="gemma4-un:latest",
            ollama_url="http://localhost:11434",
            timeout=120.0,
            progress_callback=on_progress,
        )

    # 4 stage emit
    assert progress_calls == ["observe1", "observe2", "diff-synth", "translation"]
    # observe_image 2번 호출
    assert mock_observe.call_count == 2
    # diff_synthesize 1번
    assert mock_diff.call_count == 1
    # translate 1번
    assert mock_translate.call_count == 1
    # unload — observe2 끝나고 diff-synth 직전 1번
    assert mock_unload.call_count == 1
    assert mock_unload.call_args.kwargs.get("model_name") == "qwen3-vl:8b" or \
           mock_unload.call_args.args[0] == "qwen3-vl:8b"

    # 결과의 vision_model 채워짐
    assert result.vision_model == "qwen3-vl:8b"


@pytest.mark.asyncio
async def test_analyze_pair_v4_observation_failure_fallback():
    """vision 호출 실패 (빈 dict) → fallback 결과 (HTTP 200 보장)."""
    with patch(
        "studio.compare_pipeline_v4.pipeline.observe_image",
        new=AsyncMock(return_value={}),
    ):
        result = await analyze_pair_v4(
            image1_bytes=b"x", image2_bytes=b"y",
            image1_w=512, image1_h=512, image2_w=512, image2_h=512,
            compare_hint="",
            vision_model="qwen3-vl:8b", text_model="gemma4-un:latest",
            ollama_url="http://localhost:11434", timeout=60.0,
        )

    assert result.fallback is True
    assert result.provider == "fallback"


@pytest.mark.asyncio
async def test_analyze_pair_v4_unload_called_between_observe2_and_diff():
    """순서: observe1 → observe2 → unload → diff_synth → translate."""
    call_order: list[str] = []

    async def fake_observe(*args, **kwargs):
        call_order.append("observe")
        return _fake_observation("x")

    async def fake_unload(*args, **kwargs):
        call_order.append("unload")

    async def fake_diff(*args, **kwargs):
        call_order.append("diff")
        return _fake_diff_result()

    async def fake_translate(r, **kwargs):
        call_order.append("translate")
        return r

    with patch(
        "studio.compare_pipeline_v4.pipeline.observe_image", new=fake_observe,
    ), patch(
        "studio.compare_pipeline_v4.pipeline.unload_model", new=fake_unload,
    ), patch(
        "studio.compare_pipeline_v4.pipeline.synthesize_diff", new=fake_diff,
    ), patch(
        "studio.compare_pipeline_v4.pipeline.translate_v4_result", new=fake_translate,
    ):
        await analyze_pair_v4(
            image1_bytes=b"x", image2_bytes=b"y",
            image1_w=512, image1_h=512, image2_w=512, image2_h=512,
            compare_hint="",
            vision_model="qwen3-vl:8b", text_model="gemma4-un:latest",
            ollama_url="http://localhost:11434", timeout=60.0,
        )

    assert call_order == ["observe", "observe", "unload", "diff", "translate"]
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_v4_pipeline.py -v`
Expected: FAIL — `analyze_pair_v4` 없음

- [ ] **Step 3: `pipeline.py` 구현**

`backend/studio/compare_pipeline_v4/pipeline.py`:

```python
"""
compare_pipeline_v4.pipeline — analyze_pair_v4 (4 stage orchestration).

흐름:
  1. observe1 — vision_observe(image1)
  2. observe2 — vision_observe(image2)
  3. unload(vision_model) + sleep 1.0   ← 명시적 호출 (spec §3.1)
  4. diff_synth — synthesize_diff(obs1, obs2, hint)
  5. translate — translate_v4_result(result)

실패 (observation 빈 dict / diff fallback) 시 fallback shape 보장 (HTTP 200).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

from ..ollama_unload import unload_model
from ..vision_pipeline import observe_image
from ._types import CompareAnalysisResultV4
from .diff_synthesize import synthesize_diff
from .translate import translate_v4_result

log = logging.getLogger(__name__)

ProgressCallback = Callable[[str], Awaitable[None]]


async def analyze_pair_v4(
    *,
    image1_bytes: bytes,
    image2_bytes: bytes,
    image1_w: int,
    image1_h: int,
    image2_w: int,
    image2_h: int,
    compare_hint: str,
    vision_model: str,
    text_model: str,
    ollama_url: str,
    timeout: float,
    progress_callback: ProgressCallback | None = None,
) -> CompareAnalysisResultV4:
    """A + B 두 이미지의 V4 차이 분석.

    HTTP 200 원칙 — 모든 fallback 경로도 CompareAnalysisResultV4 shape 유지.
    """

    async def _signal(stage_type: str) -> None:
        if progress_callback is None:
            return
        try:
            await progress_callback(stage_type)
        except Exception as cb_err:  # pragma: no cover
            log.info("progress_callback raised (non-fatal): %s", cb_err)

    # ── 1단계: observe1 ──
    await _signal("observe1")
    obs1 = await observe_image(
        image1_bytes,
        width=image1_w,
        height=image1_h,
        vision_model=vision_model,
        timeout=timeout,
        ollama_url=ollama_url,
    )
    if not obs1:
        return _fallback_result(vision_model, text_model)

    # ── 2단계: observe2 (같은 vision 모델 재사용 — 사이 unload 없음) ──
    await _signal("observe2")
    obs2 = await observe_image(
        image2_bytes,
        width=image2_w,
        height=image2_h,
        vision_model=vision_model,
        timeout=timeout,
        ollama_url=ollama_url,
    )
    if not obs2:
        return _fallback_result(vision_model, text_model)

    # ── 모델 전환: vision unload + sleep (16GB VRAM swap 방지) ──
    try:
        await unload_model(vision_model, ollama_url=ollama_url)
        await asyncio.sleep(1.0)
    except Exception as unload_err:
        log.info("compare-v4 vision unload failed (non-fatal): %s", unload_err)

    # ── 3단계: diff_synth ──
    await _signal("diff-synth")
    result = await synthesize_diff(
        observation1=obs1,
        observation2=obs2,
        compare_hint=compare_hint,
        text_model=text_model,
        timeout=timeout,
        ollama_url=ollama_url,
    )
    # 메타 채움 (diff_synthesize 는 vision_model 모름)
    result.vision_model = vision_model

    # diff fallback 이면 translate 건너뜀 (이미 *_ko 빈 문자열 — UI fallback)
    if result.fallback:
        return result

    # ── 4단계: translate ──
    await _signal("translation")
    result = await translate_v4_result(
        result,
        text_model=text_model,
        timeout=60.0,
        ollama_url=ollama_url,
    )
    return result


def _fallback_result(vision_model: str, text_model: str) -> CompareAnalysisResultV4:
    """observation 빈 dict → fallback (HTTP 200)."""
    import time

    from ._axes import COMPARE_V4_AXES
    return CompareAnalysisResultV4(
        summary_en="", summary_ko="",
        common_points_en=[], common_points_ko=[],
        key_differences_en=[], key_differences_ko=[],
        domain_match="mixed",
        category_diffs={},
        category_scores={k: None for k in COMPARE_V4_AXES},
        key_anchors=[],
        fidelity_score=None,
        transform_prompt_en="", transform_prompt_ko="",
        uncertain_en="vision observation failed",
        uncertain_ko="비전 관찰 실패",
        observation1={}, observation2={},
        provider="fallback",
        fallback=True,
        analyzed_at=int(time.time() * 1000),
        vision_model=vision_model,
        text_model=text_model,
    )
```

- [ ] **Step 4: __init__.py 에 `analyze_pair_v4` re-export 추가**

`backend/studio/compare_pipeline_v4/__init__.py` 의 import / __all__ 에 추가:
```python
from .pipeline import analyze_pair_v4
# __all__ 에 "analyze_pair_v4" 추가
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_v4_pipeline.py -v`
Expected: PASS (3 tests)

- [ ] **Step 6: 전체 회귀**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q`
Expected: 회귀 0 + 누적 신규 테스트 모두 PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/studio/compare_pipeline_v4/pipeline.py \
        backend/studio/compare_pipeline_v4/__init__.py \
        backend/tests/test_compare_v4_pipeline.py
git commit -m "feat(compare-v4): analyze_pair_v4 4 stage orchestration + 명시적 unload"
```

---

### Task 9: `unload_model` helper 검증 (Phase 2 마무리)

**Files:**
- Modify: `backend/studio/ollama_unload.py` (필요 시 — `unload_model(name, ollama_url=...)` 시그니처 확인 + 보강)

- [ ] **Step 1: 현재 시그니처 확인**

Run via Read:
```
Read backend/studio/ollama_unload.py
```

확인할 것: `unload_model(name)` 또는 `unload_model(name, ollama_url=...)` — pipeline.py 호출 패턴과 일치 검증.

- [ ] **Step 2: 시그니처 mismatch 인 경우 pipeline.py 수정**

만약 옛 시그니처가 `unload_model(model)` 만이면 pipeline.py 의 호출을 그에 맞춰 수정.
Edit pipeline.py:
```python
# 옛 시그니처에 맞춤 (없으면 그대로)
await unload_model(vision_model)
```

- [ ] **Step 3: 회귀 검증**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_v4_pipeline.py -v`
Expected: PASS.

- [ ] **Step 4: Commit (변경 있을 때만)**

```bash
git add backend/studio/compare_pipeline_v4/pipeline.py
git commit -m "fix(compare-v4): unload_model 시그니처 정합 (Phase 2 마무리)"
```

(변경 없으면 skip.)

---

## Phase 3: Backend route + persist + per-image endpoint (4 task)

### Task 10: Route validation — A/B PIL verify + width/height 추출

**Files:**
- Modify: `backend/studio/routes/compare.py`
- Modify: `backend/studio/pipelines/compare_analyze.py` (signature 갱신)
- Test: `backend/tests/test_compare_route_validation.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_compare_route_validation.py`:

```python
"""compare-analyze route 의 A/B 이미지 PIL 검증 + width/height 추출."""

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from main import app


def _png_bytes(w: int, h: int) -> bytes:
    img = Image.new("RGB", (w, h), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_compare_route_accepts_valid_pair():
    client = TestClient(app)
    res = client.post(
        "/api/studio/compare-analyze",
        files={
            "source": ("a.png", _png_bytes(640, 480), "image/png"),
            "result": ("b.png", _png_bytes(800, 600), "image/png"),
        },
        data={"meta": '{"context": "compare", "compareHint": ""}'},
    )
    # task 생성 성공 (실 분석은 background)
    assert res.status_code == 200
    assert "task_id" in res.json()
    assert "stream_url" in res.json()


def test_compare_route_rejects_invalid_image():
    client = TestClient(app)
    res = client.post(
        "/api/studio/compare-analyze",
        files={
            "source": ("a.txt", b"not an image", "text/plain"),
            "result": ("b.png", _png_bytes(640, 480), "image/png"),
        },
        data={"meta": '{"context": "compare"}'},
    )
    assert res.status_code == 400
    assert "invalid image" in res.json()["detail"].lower()


def test_compare_route_rejects_zero_size_image():
    """0×0 또는 손상된 PNG."""
    client = TestClient(app)
    # 손상된 PNG header
    res = client.post(
        "/api/studio/compare-analyze",
        files={
            "source": ("a.png", b"\x89PNG\r\n\x1a\n_garbage", "image/png"),
            "result": ("b.png", _png_bytes(640, 480), "image/png"),
        },
        data={"meta": '{"context": "compare"}'},
    )
    assert res.status_code == 400
```

- [ ] **Step 2: 테스트 실패 확인 (옛 route 가 verify 안 함 → 옛 검증으로는 통과 안 되는 케이스 확인)**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_route_validation.py -v`
Expected: 일부 FAIL (`test_compare_route_rejects_invalid_image` 가 200 또는 다른 코드 반환).

- [ ] **Step 3: route validation 구현**

`backend/studio/routes/compare.py` 수정 — `create_compare_analyze_task` 안:

```python
import io
from PIL import Image as PILImage

# ... (기존 import 그대로)

@router.post("/compare-analyze", response_model=TaskCreated)
async def create_compare_analyze_task(
    source: UploadFile = File(...),
    result: UploadFile = File(...),
    meta: str = Form(...),
):
    meta_obj = parse_meta_object(meta)
    # ... (옛 meta parsing 그대로)

    source_bytes = await source.read()
    result_bytes = await result.read()
    if not source_bytes or not result_bytes:
        raise HTTPException(400, "empty image (source or result)")
    if (
        len(source_bytes) > STUDIO_MAX_IMAGE_BYTES
        or len(result_bytes) > STUDIO_MAX_IMAGE_BYTES
    ):
        raise HTTPException(413, "image too large")

    # ── 신규: PIL verify + size 추출 (V4 가 width/height 필요) ──
    try:
        img_a = PILImage.open(io.BytesIO(source_bytes))
        img_a.verify()
        img_a = PILImage.open(io.BytesIO(source_bytes))      # verify 후 재 open 필요
        source_w, source_h = img_a.size
        if source_w <= 0 or source_h <= 0:
            raise ValueError("zero size")
    except Exception:
        raise HTTPException(400, "invalid image (source)")

    try:
        img_b = PILImage.open(io.BytesIO(result_bytes))
        img_b.verify()
        img_b = PILImage.open(io.BytesIO(result_bytes))
        result_w, result_h = img_b.size
        if result_w <= 0 or result_h <= 0:
            raise ValueError("zero size")
    except Exception:
        raise HTTPException(400, "invalid image (result)")

    task = await _new_task()
    task.worker = _spawn(
        _run_compare_analyze_pipeline(
            task,
            source_bytes=source_bytes,
            result_bytes=result_bytes,
            source_w=source_w, source_h=source_h,
            result_w=result_w, result_h=result_h,
            context=context,
            edit_prompt=edit_prompt,
            compare_hint=compare_hint,
            history_item_id_raw=history_item_id_raw,
            vision_override=vision_override,
            text_override=text_override,
            prompt_mode=compare_prompt_mode,
        )
    )
    return TaskCreated(...)
```

`backend/studio/pipelines/compare_analyze.py` — `_run_compare_analyze_pipeline` 시그니처에 `source_w, source_h, result_w, result_h: int` 4 파라미터 추가. 일단 받기만 하고 내부 사용은 Task 11 에서.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_route_validation.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: 회귀 검증**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q`
Expected: 옛 compare 테스트 회귀 0 (시그니처 추가는 backward-compatible — 옛 caller 가 모두 keyword args 전달).

- [ ] **Step 6: Commit**

```bash
git add backend/studio/routes/compare.py \
        backend/studio/pipelines/compare_analyze.py \
        backend/tests/test_compare_route_validation.py
git commit -m "feat(compare-route): A/B PIL verify + width/height 추출 (V4 observe_image 인자)"
```

---

### Task 11: Pipeline V4 호출 + persist context 분기 + 5 stage emit

**Files:**
- Modify: `backend/studio/pipelines/compare_analyze.py`
- Test: `backend/tests/test_compare_persist_context.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_compare_persist_context.py`:

```python
"""compare-analyze pipeline 의 persist context 분기 (compare 휘발 / edit 저장)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from studio.pipelines.compare_analyze import _run_compare_analyze_pipeline
from studio.compare_pipeline_v4._types import CompareAnalysisResultV4


def _fake_v4_result() -> CompareAnalysisResultV4:
    return CompareAnalysisResultV4(
        summary_en="", summary_ko="",
        common_points_en=[], common_points_ko=[],
        key_differences_en=[], key_differences_ko=[],
        domain_match="person", category_diffs={}, category_scores={},
        key_anchors=[], fidelity_score=None,
        transform_prompt_en="", transform_prompt_ko="",
        uncertain_en="", uncertain_ko="",
        observation1={}, observation2={},
        provider="ollama", fallback=False, analyzed_at=0,
        vision_model="qwen3-vl:8b", text_model="gemma4-un:latest",
    )


@pytest.mark.asyncio
async def test_compare_context_does_not_persist_to_db():
    """context='compare' 일 때 update_comparison 호출 안 함 (휘발)."""
    task = MagicMock()
    task.emit = AsyncMock()
    task.close = AsyncMock()

    with patch(
        "studio.pipelines.compare_analyze.analyze_pair_v4",
        new=AsyncMock(return_value=_fake_v4_result()),
    ), patch(
        "studio.pipelines.compare_analyze.history_db.update_comparison",
        new=AsyncMock(return_value=True),
    ) as mock_update:
        await _run_compare_analyze_pipeline(
            task,
            source_bytes=b"x", result_bytes=b"y",
            source_w=512, source_h=512, result_w=512, result_h=512,
            context="compare",
            edit_prompt="",
            compare_hint="",
            history_item_id_raw="gen-1234567890ab",   # 매치되지만 compare 라 무시
            vision_override="qwen3-vl:8b",
            text_override="gemma4-un:latest",
        )

    assert mock_update.call_count == 0   # compare context — DB 저장 호출 X

    # done event 의 saved=False
    done_call = next(
        c for c in task.emit.call_args_list if c.args[0] == "done"
    )
    assert done_call.args[1]["saved"] is False


@pytest.mark.asyncio
async def test_edit_context_persists_to_db():
    """context='edit' (default) 일 때 update_comparison 호출 (옛 동작 유지)."""
    task = MagicMock()
    task.emit = AsyncMock()
    task.close = AsyncMock()

    fake_v3_result = MagicMock()
    fake_v3_result.to_dict = MagicMock(return_value={"some": "v3 data"})
    fake_v3_result.overall = 88
    fake_v3_result.summary_en = ""
    fake_v3_result.summary_ko = ""
    fake_v3_result.provider = "ollama"
    fake_v3_result.fallback = False

    with patch(
        "studio.pipelines.compare_analyze.analyze_pair",
        new=AsyncMock(return_value=fake_v3_result),
    ), patch(
        "studio.pipelines.compare_analyze.history_db.update_comparison",
        new=AsyncMock(return_value=True),
    ) as mock_update:
        await _run_compare_analyze_pipeline(
            task,
            source_bytes=b"x", result_bytes=b"y",
            source_w=512, source_h=512, result_w=512, result_h=512,
            context="edit",
            edit_prompt="brighten",
            compare_hint="",
            history_item_id_raw="edit-1234567890ab",
            vision_override="qwen2.5vl:7b",
            text_override="gemma4-un:latest",
        )

    assert mock_update.call_count == 1


@pytest.mark.asyncio
async def test_compare_context_emits_v4_stages():
    """context='compare' 일 때 5 stage emit (compare-encoding + observe1/2 + diff-synth + translation)."""
    task = MagicMock()
    task.emit = AsyncMock()
    task.close = AsyncMock()

    with patch(
        "studio.pipelines.compare_analyze.analyze_pair_v4",
        new=AsyncMock(return_value=_fake_v4_result()),
    ):
        await _run_compare_analyze_pipeline(
            task,
            source_bytes=b"x", result_bytes=b"y",
            source_w=512, source_h=512, result_w=512, result_h=512,
            context="compare",
            edit_prompt="",
            compare_hint="",
            history_item_id_raw=None,
            vision_override="qwen3-vl:8b",
            text_override="gemma4-un:latest",
        )

    stage_types = [
        c.args[1]["type"] for c in task.emit.call_args_list
        if c.args[0] == "stage"
    ]
    # compare-encoding (route emit) + observe1 + observe2 + diff-synth + translation (analyze_pair_v4 emit)
    assert "compare-encoding" in stage_types
    # 나머지 4 stage 는 analyze_pair_v4 의 progress_callback 으로 전달 — pipeline 이 forward
    assert "observe1" in stage_types
    assert "observe2" in stage_types
    assert "diff-synth" in stage_types
    assert "translation" in stage_types
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_persist_context.py -v`
Expected: FAIL (옛 코드는 v2_generic 호출 + persist 분기 없음).

- [ ] **Step 3: pipeline 갱신**

`backend/studio/pipelines/compare_analyze.py` — context='compare' 분기에서 `analyze_pair_v4` 호출 + 5 stage forward + persist 차단:

```python
from ..compare_pipeline_v4 import analyze_pair_v4

# ... (옛 import / log / _PROGRESS / _LABEL 그대로)

# V4 stage label / progress 추가
_V4_PROGRESS = {
    "observe1": 20,
    "observe2": 40,
    "diff-synth": 70,
    "translation": 90,
}
_V4_LABEL = {
    "observe1": "Image1 관찰 (qwen3-vl)",
    "observe2": "Image2 관찰 (qwen3-vl)",
    "diff-synth": "차이 합성 (gemma4)",
    "translation": "한국어 번역 (gemma4)",
}


async def _run_compare_analyze_pipeline(
    task: Task,
    *,
    source_bytes: bytes,
    result_bytes: bytes,
    source_w: int,                    # Task 10 신규
    source_h: int,
    result_w: int,
    result_h: int,
    context: str,
    edit_prompt: str,
    compare_hint: str,
    history_item_id_raw: Any,
    vision_override: str | None,
    text_override: str | None,
    prompt_mode: str = "fast",
) -> None:
    try:
        # ── 1단계: 인코딩 마킹 (옛 호환) ──
        await task.emit("stage", {"type": "compare-encoding", "progress": 5, "stageLabel": "이미지 A/B 인코딩"})

        # ── compare context 분기 ──
        if context == "compare":
            async def on_progress_v4(stage_type: str) -> None:
                await task.emit("stage", {
                    "type": stage_type,
                    "progress": _V4_PROGRESS.get(stage_type, 50),
                    "stageLabel": _V4_LABEL.get(stage_type, stage_type),
                })

            try:
                async with gpu_slot("compare-analyze"):
                    result_obj = await analyze_pair_v4(
                        image1_bytes=source_bytes,
                        image2_bytes=result_bytes,
                        image1_w=source_w, image1_h=source_h,
                        image2_w=result_w, image2_h=result_h,
                        compare_hint=compare_hint,
                        vision_model=vision_override or "qwen3-vl:8b",
                        text_model=text_override or "gemma4-un:latest",
                        ollama_url="http://localhost:11434",   # TODO: settings 주입
                        timeout=180.0,
                        progress_callback=on_progress_v4,
                    )
                    try:
                        await ollama_unload.force_unload_all_loaded_models(wait_sec=0.0)
                    except Exception as unload_err:
                        log.info("compare-v4 post-unload failed: %s", unload_err)
            except GpuBusyError as e:
                await task.emit("error", {"message": str(e), "code": "gpu_busy"})
                return

            # context='compare' — DB persist 안 함 (휘발 정책)
            saved = False
            await task.emit("done", {"analysis": result_obj.to_dict(), "saved": saved})
            return

        # ── 옛 edit context 흐름 (analyze_pair v3) — 무변경 ──
        # (기존 refine + analyze_pair + persist 코드 그대로 유지)
        # ...
    except asyncio.CancelledError:
        log.info("Compare-analyze pipeline cancelled: %s", task.task_id)
        raise
    except Exception as e:
        log.exception("Compare-analyze pipeline crashed: %s", e)
        await task.emit("error", {"message": str(e), "code": "internal"})
    finally:
        await task.close()
```

기존 edit context 흐름 코드는 그대로 유지 (옛 동작 100%).

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_persist_context.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: 옛 compare-analyze 회귀**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_analyze_route.py -v`
Expected: 회귀 0 (edit context 흐름 무변경).

- [ ] **Step 6: Commit**

```bash
git add backend/studio/pipelines/compare_analyze.py \
        backend/tests/test_compare_persist_context.py
git commit -m "feat(compare-pipeline): V4 호출 + persist context 분기 (compare=휘발 / edit=저장 유지)"
```

---

### Task 12: per-image t2i prompt endpoint

**Files:**
- Create: `backend/studio/routes/compare_per_image.py` 또는 `compare.py` 안에 추가
- Modify: `backend/studio/routes/__init__.py` (router 등록)
- Test: `backend/tests/test_compare_per_image_prompt_endpoint.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_compare_per_image_prompt_endpoint.py`:

```python
"""on-demand per-image prompt endpoint."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app


def test_per_image_prompt_endpoint_success():
    fake_synth = {
        "summary": "Portrait of a person",
        "positive_prompt": "professional studio portrait...",
        "negative_prompt": "blurry, low quality",
        "key_visual_anchors": ["studio", "soft lighting"],
        "uncertain": [],
    }

    client = TestClient(app)
    with patch(
        "studio.routes.compare.synthesize_prompt",
        new=AsyncMock(return_value=fake_synth),
    ):
        res = client.post(
            "/api/studio/compare-analyze/per-image-prompt",
            json={
                "observation": {"subjects": [{"broad_visible_appearance": "young adult"}]},
                "ollamaModel": "gemma4-un:latest",
            },
        )

    assert res.status_code == 200
    data = res.json()
    assert "positive_prompt" in data
    assert data["positive_prompt"].startswith("professional")


def test_per_image_prompt_endpoint_rejects_empty_observation():
    client = TestClient(app)
    res = client.post(
        "/api/studio/compare-analyze/per-image-prompt",
        json={"observation": {}},
    )
    assert res.status_code == 400 or res.status_code == 422


def test_per_image_prompt_endpoint_busy_returns_503():
    """gpu_slot busy → 503 + gpu_busy code."""
    from studio._gpu_lock import GpuBusyError

    client = TestClient(app)
    with patch(
        "studio.routes.compare.synthesize_prompt",
        new=AsyncMock(side_effect=GpuBusyError("compare-per-image-prompt")),
    ):
        res = client.post(
            "/api/studio/compare-analyze/per-image-prompt",
            json={"observation": {"subjects": [{"broad_visible_appearance": "x"}]}},
        )

    assert res.status_code == 503
    assert res.json().get("detail", {}).get("code") == "gpu_busy" or \
           "gpu" in str(res.json()).lower()
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_per_image_prompt_endpoint.py -v`
Expected: FAIL — endpoint 없음 (404).

- [ ] **Step 3: endpoint 구현**

`backend/studio/routes/compare.py` 끝에 추가:

```python
from pydantic import BaseModel, Field

from .._gpu_lock import GpuBusyError, gpu_slot
from ..vision_pipeline.prompt_synthesize import synthesize_prompt


class PerImagePromptRequest(BaseModel):
    observation: dict = Field(..., description="vision_observe JSON 결과")
    ollamaModel: str | None = Field(default=None, description="text 모델 override")


class PerImagePromptResponse(BaseModel):
    summary: str
    positive_prompt: str
    negative_prompt: str
    key_visual_anchors: list[str]
    uncertain: list[str]


@router.post(
    "/compare-analyze/per-image-prompt",
    response_model=PerImagePromptResponse,
)
async def compare_per_image_prompt(req: PerImagePromptRequest):
    """observation JSON → t2i prompt 합성 (단일 응답 · non-SSE).

    on-demand 호출 — 메인 분석 후 사용자가 결과 화면에서 클릭. 약 10~20초.
    """
    if not req.observation:
        raise HTTPException(400, "empty observation")

    text_model = req.ollamaModel or "gemma4-un:latest"
    try:
        async with gpu_slot("compare-per-image-prompt"):
            synth = await synthesize_prompt(
                req.observation,
                text_model=text_model,
                timeout=60.0,
                ollama_url="http://localhost:11434",
            )
    except GpuBusyError as e:
        raise HTTPException(
            status_code=503,
            detail={"code": "gpu_busy", "message": str(e)},
        )

    return PerImagePromptResponse(
        summary=synth.get("summary", ""),
        positive_prompt=synth.get("positive_prompt", ""),
        negative_prompt=synth.get("negative_prompt", ""),
        key_visual_anchors=synth.get("key_visual_anchors", []) or [],
        uncertain=synth.get("uncertain", []) or [],
    )
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/test_compare_per_image_prompt_endpoint.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/studio/routes/compare.py \
        backend/tests/test_compare_per_image_prompt_endpoint.py
git commit -m "feat(compare-route): on-demand per-image prompt endpoint (단일 응답 · gpu_slot)"
```

---

### Task 13: schema (Pydantic) — V4 dataclass 미러 + per-image

**Files:**
- Modify: `backend/studio/schemas.py`
- Test: `backend/tests/test_compare_v4_to_dict.py` (이미 Task 3 에 있음 — 보강)

- [ ] **Step 1: schemas.py 에 Pydantic 모델 추가**

```python
# backend/studio/schemas.py 에 추가

class CompareCategoryDiffOut(BaseModel):
    image1: str
    image2: str
    diff: str
    image1Ko: str
    image2Ko: str
    diffKo: str


class CompareKeyAnchorOut(BaseModel):
    label: str
    image1: str
    image2: str
    image1Ko: str
    image2Ko: str


class VisionCompareAnalysisV4(BaseModel):
    summaryEn: str
    summaryKo: str
    commonPointsEn: list[str]
    commonPointsKo: list[str]
    keyDifferencesEn: list[str]
    keyDifferencesKo: list[str]
    domainMatch: str
    categoryDiffs: dict[str, CompareCategoryDiffOut]
    categoryScores: dict[str, int | None]
    keyAnchors: list[CompareKeyAnchorOut]
    fidelityScore: int | None
    transformPromptEn: str
    transformPromptKo: str
    uncertainEn: str
    uncertainKo: str
    observation1: dict
    observation2: dict
    provider: str
    fallback: bool
    analyzedAt: int
    visionModel: str
    textModel: str
```

- [ ] **Step 2: OpenAPI dump 갱신 + frontend types regen**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe scripts/dump_openapi.py
cd ../frontend && npm run gen:types
```

확인: `frontend/lib/api/generated.ts` 에 `VisionCompareAnalysisV4` schema 등장.

- [ ] **Step 3: 회귀 검증**

Run:
```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q
cd ../frontend && npx tsc --noEmit
```

Expected: 회귀 0.

- [ ] **Step 4: Commit**

```bash
git add backend/studio/schemas.py frontend/lib/api/generated.ts
git commit -m "feat(compare-schema): VisionCompareAnalysisV4 Pydantic 모델 + OpenAPI 자동 동기화"
```

---

## Phase 4: Backend 옛 코드 폐기 (1 task)

### Task 14: `comparison_pipeline/v2_generic.py` 삭제

**Files:**
- Delete: `backend/studio/comparison_pipeline/v2_generic.py`
- Modify: `backend/studio/comparison_pipeline/__init__.py` (re-export 정리)
- Modify: `backend/studio/routes/compare.py` (import 정리)
- Modify: `backend/studio/pipelines/compare_analyze.py` (import 정리 — `analyze_pair_generic` 제거)
- Delete: `backend/tests/test_comparison_pipeline_generic.py` (있다면)

- [ ] **Step 1: v2_generic 호출 site 모두 grep**

Run via Grep:
```
analyze_pair_generic | SYSTEM_COMPARE_GENERIC | _COMPARE_HINT_DIRECTIVE | _call_vision_pair_generic
```

확인할 site 모두 listing — 다 갱신 후에만 삭제.

- [ ] **Step 2: 호출 site 갱신 (이미 Task 11 에서 대부분 처리)**

`comparison_pipeline/__init__.py` 의 re-export 에서 v2_generic 4 export 제거.

`routes/compare.py:21` 의 `from ..comparison_pipeline import analyze_pair, analyze_pair_generic` 에서 `analyze_pair_generic` 제거.

`pipelines/compare_analyze.py` 의 `from ..comparison_pipeline import analyze_pair, analyze_pair_generic` 에서 `analyze_pair_generic` 제거.

- [ ] **Step 3: v2_generic 파일 삭제**

```bash
rm backend/studio/comparison_pipeline/v2_generic.py
```

옛 테스트도 있으면 삭제:
```bash
rm -f backend/tests/test_comparison_pipeline_generic.py
```

- [ ] **Step 4: 회귀 검증**

Run:
```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q
```

Expected: 회귀 0. 옛 v2_generic 직접 import 한 코드가 남아있으면 ImportError — fix.

- [ ] **Step 5: Commit**

```bash
git add -A backend/studio/comparison_pipeline/ \
       backend/studio/routes/compare.py \
       backend/studio/pipelines/compare_analyze.py
git rm backend/studio/comparison_pipeline/v2_generic.py 2>/dev/null || true
git rm backend/tests/test_comparison_pipeline_generic.py 2>/dev/null || true
git commit -m "chore(compare): v2_generic 삭제 + facade re-export 정리 (Phase 4)"
```

---

## Phase 5: Frontend types + mock + store (3 task)

### Task 15: `VisionCompareAnalysisV4` interface (`types.ts`)

**Files:**
- Modify: `frontend/lib/api/types.ts`
- Test: `frontend/__tests__/api-vision-compare-contract.test.ts`

- [ ] **Step 1: contract test 먼저 작성** (OpenAPI 한계 보완 안전망)

`frontend/__tests__/api-vision-compare-contract.test.ts`:

```ts
/**
 * VisionCompareAnalysisV4 contract test — backend to_dict 키 ↔ frontend interface 정합성.
 *
 * 의도: OpenAPI 가 SSE done payload schema 를 못 잡으므로 (TaskCreated response),
 * frontend 가 backend 의 camelCase 출력 키를 모두 받을 수 있는지 정적 검증.
 *
 * backend 변경 시 이 테스트가 가장 먼저 fail.
 */
import { describe, expect, it } from "vitest";
import type { VisionCompareAnalysisV4 } from "@/lib/api/types";

describe("VisionCompareAnalysisV4 contract", () => {
  it("모든 필수 키 존재 (backend to_dict 미러)", () => {
    // 컴파일러 검증 — 키 누락 시 type error
    const sample: VisionCompareAnalysisV4 = {
      summaryEn: "",
      summaryKo: "",
      commonPointsEn: [],
      commonPointsKo: [],
      keyDifferencesEn: [],
      keyDifferencesKo: [],
      domainMatch: "person",
      categoryDiffs: {},
      categoryScores: {},
      keyAnchors: [],
      fidelityScore: null,
      transformPromptEn: "",
      transformPromptKo: "",
      uncertainEn: "",
      uncertainKo: "",
      observation1: {},
      observation2: {},
      provider: "ollama",
      fallback: false,
      analyzedAt: 0,
      visionModel: "qwen3-vl:8b",
      textModel: "gemma4-un:latest",
    };
    expect(sample.domainMatch).toBe("person");
  });

  it("category_diffs 가 5 카테고리 키만 받음 (mixed=빈 dict)", () => {
    const r: VisionCompareAnalysisV4 = {
      summaryEn: "", summaryKo: "",
      commonPointsEn: [], commonPointsKo: [],
      keyDifferencesEn: [], keyDifferencesKo: [],
      domainMatch: "person",
      categoryDiffs: {
        composition: { image1: "a", image2: "b", diff: "c", image1Ko: "", image2Ko: "", diffKo: "" },
        subject: { image1: "", image2: "", diff: "", image1Ko: "", image2Ko: "", diffKo: "" },
        clothing_or_materials: { image1: "", image2: "", diff: "", image1Ko: "", image2Ko: "", diffKo: "" },
        environment: { image1: "", image2: "", diff: "", image1Ko: "", image2Ko: "", diffKo: "" },
        lighting_camera_style: { image1: "", image2: "", diff: "", image1Ko: "", image2Ko: "", diffKo: "" },
      },
      categoryScores: {
        composition: 87, subject: null, clothing_or_materials: null,
        environment: null, lighting_camera_style: null,
      },
      keyAnchors: [],
      fidelityScore: 80,
      transformPromptEn: "", transformPromptKo: "",
      uncertainEn: "", uncertainKo: "",
      observation1: {}, observation2: {},
      provider: "ollama", fallback: false, analyzedAt: 0,
      visionModel: "", textModel: "",
    };
    expect(Object.keys(r.categoryDiffs).length).toBe(5);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx vitest run __tests__/api-vision-compare-contract.test.ts`
Expected: FAIL — `VisionCompareAnalysisV4` 없음.

- [ ] **Step 3: types.ts 에 interface 추가**

`frontend/lib/api/types.ts` 의 `VisionCompareAnalysis` (옛 5축 인터페이스) 자리에 새 인터페이스 추가:

```ts
/**
 * VisionCompareAnalysisV4 — Vision Compare 메뉴 결과 (V4 · 2-stage observe + diff_synthesize).
 *
 * backend `compare_pipeline_v4.CompareAnalysisResultV4.to_dict()` 미러.
 * 옛 `VisionCompareAnalysis` (overall/scores/comments) 폐기됨.
 */
export interface CompareCategoryDiffJSON {
  image1: string;
  image2: string;
  diff: string;
  image1Ko: string;
  image2Ko: string;
  diffKo: string;
}

export interface CompareKeyAnchorJSON {
  label: string;
  image1: string;
  image2: string;
  image1Ko: string;
  image2Ko: string;
}

export interface VisionCompareAnalysisV4 {
  summaryEn: string;
  summaryKo: string;
  commonPointsEn: string[];
  commonPointsKo: string[];
  keyDifferencesEn: string[];
  keyDifferencesKo: string[];

  domainMatch: "person" | "object_scene" | "mixed";
  categoryDiffs: Record<string, CompareCategoryDiffJSON>;   // 5 카테고리 또는 빈 dict (mixed)
  categoryScores: Record<string, number | null>;            // forward-compat

  keyAnchors: CompareKeyAnchorJSON[];

  fidelityScore: number | null;                             // 0-100 또는 null

  transformPromptEn: string;
  transformPromptKo: string;
  uncertainEn: string;
  uncertainKo: string;

  observation1: Record<string, unknown>;                    // on-demand prompt_synthesize 재사용
  observation2: Record<string, unknown>;

  provider: "ollama" | "fallback";
  fallback: boolean;
  analyzedAt: number;
  visionModel: string;
  textModel: string;
}

// 옛 alias 폐기 — VisionCompareAnalysis 인터페이스는 더 이상 export 안 함.
// 아직 import 하는 곳이 있으면 컴파일 fail → 그 site 갱신.
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npx vitest run __tests__/api-vision-compare-contract.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: 옛 `VisionCompareAnalysis` import site fix**

Run via Grep:
```
import.*VisionCompareAnalysis(?!V4) | : VisionCompareAnalysis(?!V4)
```

각 site 를 `VisionCompareAnalysisV4` 로 교체 (또는 옛 코드 자체가 폐기 대상이면 그대로 두고 후속 task 에서 폐기).

- [ ] **Step 6: tsc + lint 검증**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: clean (또는 폐기 예정 site 만 error — Task 16~ 에서 처리).

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/api/types.ts \
        frontend/__tests__/api-vision-compare-contract.test.ts
git commit -m "feat(compare-types): VisionCompareAnalysisV4 interface + contract test (OpenAPI 한계 보완)"
```

---

### Task 16: Mock fixture (`mocks/compare.ts`) V4 교체

**Files:**
- Modify: `frontend/lib/api/mocks/compare.ts`

- [ ] **Step 1: 옛 mock 폐기 + V4 fixture 작성**

`frontend/lib/api/mocks/compare.ts` 를 다음과 같이 전면 교체:

```ts
/**
 * Compare 메뉴 mock (USE_MOCK 모드).
 *
 * V4 shape — 옛 5축 score mock 폐기.
 */

import type { CompareAnalyzeRequest, CompareAnalyzeResponse } from "../compare";
import type { VisionCompareAnalysisV4 } from "../types";

/** SSE stage emit 모사 (실 백엔드의 5 stage 시퀀스 그대로) */
async function emitMockStages(
  onStage?: CompareAnalyzeRequest["onStage"],
): Promise<void> {
  const stages = [
    { type: "compare-encoding", progress: 5, stageLabel: "이미지 A/B 인코딩" },
    { type: "observe1", progress: 20, stageLabel: "Image1 관찰 (qwen3-vl)" },
    { type: "observe2", progress: 40, stageLabel: "Image2 관찰 (qwen3-vl)" },
    { type: "diff-synth", progress: 70, stageLabel: "차이 합성 (gemma4)" },
    { type: "translation", progress: 90, stageLabel: "한국어 번역 (gemma4)" },
  ];
  for (const s of stages) {
    onStage?.(s);
    await new Promise((r) => setTimeout(r, 200));
  }
}

function makeV4Sample(): VisionCompareAnalysisV4 {
  return {
    summaryEn: "Both images show the same person; image2 is winking.",
    summaryKo: "두 이미지는 같은 인물입니다. 두 번째는 한쪽 눈을 감고 있습니다.",
    commonPointsEn: ["same person", "same outfit", "studio setting"],
    commonPointsKo: ["같은 인물", "같은 의상", "스튜디오 배경"],
    keyDifferencesEn: ["one eye closed", "head turned slightly"],
    keyDifferencesKo: ["한쪽 눈 감음", "고개 살짝 돌림"],
    domainMatch: "person",
    categoryDiffs: {
      composition: {
        image1: "head-on, centered",
        image2: "3/4 view, slightly turned",
        diff: "head turned ~30 degrees",
        image1Ko: "정면, 중앙",
        image2Ko: "3/4 측면, 살짝 돌림",
        diffKo: "고개 약 30도 돌아감",
      },
      subject: {
        image1: "both eyes open",
        image2: "left eye closed (winking)",
        diff: "winking on left side",
        image1Ko: "두 눈 모두 뜸",
        image2Ko: "왼쪽 눈 감음",
        diffKo: "왼쪽으로 윙크",
      },
      clothing_or_materials: {
        image1: "white tank top",
        image2: "white tank top",
        diff: "identical",
        image1Ko: "흰색 탱크탑",
        image2Ko: "흰색 탱크탑",
        diffKo: "동일",
      },
      environment: {
        image1: "studio backdrop",
        image2: "studio backdrop",
        diff: "identical",
        image1Ko: "스튜디오 배경",
        image2Ko: "스튜디오 배경",
        diffKo: "동일",
      },
      lighting_camera_style: {
        image1: "softbox",
        image2: "softbox",
        diff: "identical",
        image1Ko: "소프트박스",
        image2Ko: "소프트박스",
        diffKo: "동일",
      },
    },
    categoryScores: {
      composition: 85,
      subject: 70,
      clothing_or_materials: 100,
      environment: 100,
      lighting_camera_style: 95,
    },
    keyAnchors: [
      {
        label: "eye state",
        image1: "both eyes open",
        image2: "left eye closed",
        image1Ko: "두 눈 뜸",
        image2Ko: "왼쪽 눈 감음",
      },
    ],
    fidelityScore: 88,
    transformPromptEn: "close left eye and turn head 30 degrees to the right",
    transformPromptKo: "왼쪽 눈을 감고 고개를 오른쪽으로 30도 돌리세요",
    uncertainEn: "",
    uncertainKo: "",
    observation1: { mock: true, image: 1 },
    observation2: { mock: true, image: 2 },
    provider: "ollama",
    fallback: false,
    analyzedAt: Date.now(),
    visionModel: "qwen3-vl:8b",
    textModel: "gemma4-un:latest",
  };
}

export async function mockCompareAnalyze(
  req: CompareAnalyzeRequest,
): Promise<CompareAnalyzeResponse> {
  await emitMockStages(req.onStage);
  return {
    analysis: makeV4Sample(),
    saved: false,                                    // compare context 휘발
  };
}
```

- [ ] **Step 2: tsc 검증**

```bash
cd frontend && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api/mocks/compare.ts
git commit -m "feat(compare-mock): V4 fixture 교체 (옛 5축 score mock 폐기)"
```

---

### Task 17: `useVisionCompareStore` V4 갱신

**Files:**
- Modify: `frontend/stores/useVisionCompareStore.ts`
- Modify: `frontend/stores/__tests__/useVisionCompareStore.test.ts` (있다면) — 갱신

- [ ] **Step 1: 현재 store 시그니처 확인**

Read: `frontend/stores/useVisionCompareStore.ts` — 현 필드 (overall/scores/comments 등) 와 cache 구조 파악.

- [ ] **Step 2: V4 필드로 갱신**

옛 필드 (`scores`, `overall`, `commentsEn`, `commentsKo` 등) 를 V4 shape 으로 교체:

```ts
// 핵심 필드 (옛 store 의 옛 분석 결과 자리에)
analysis: VisionCompareAnalysisV4 | null,

// On-demand 합성 결과 캐시 (image1 / image2 별 휘발 저장)
perImagePrompt: {
  image1: { positive_prompt: string; summary: string; ... } | null,
  image2: { positive_prompt: string; summary: string; ... } | null,
  inFlight: "image1" | "image2" | null,         // 전역 직렬화 표시
},

// On-demand action
setPerImagePrompt: (which: "image1" | "image2", result: ...) => void,
setPerImageInFlight: (which: "image1" | "image2" | null) => void,
clearPerImagePrompts: () => void,                // analysis 새로 시작 시 호출
```

`reset()` / `setAnalysis()` 등 기존 action 도 V4 shape 으로 교체.

- [ ] **Step 3: 옛 store 테스트 갱신**

기존 `useVisionCompareStore.test.ts` 가 있으면 V4 fixture 로 교체. perImagePrompt 캐시 동작 + 전역 inFlight 직렬화 verify.

- [ ] **Step 4: 회귀**

```bash
cd frontend && npx vitest run stores
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/stores/useVisionCompareStore.ts \
        frontend/stores/__tests__/useVisionCompareStore.test.ts
git commit -m "feat(compare-store): V4 shape 갱신 + perImagePrompt 휘발 캐시"
```

---

## Phase 6: Frontend SSE drain + pipeline-defs (2 task)

### Task 18: `compare.ts` SSE drain 5 stage 처리

**Files:**
- Modify: `frontend/lib/api/compare.ts`
- Test: `frontend/__tests__/api-vision-compare.test.ts`

- [ ] **Step 1: 옛 `api-vision-compare.test.ts` 테스트 갱신 (5 stage 시퀀스)**

옛 stage 시퀀스 (`vision-pair`, `translation`) → 새 (`compare-encoding`, `observe1`, `observe2`, `diff-synth`, `translation`) — done payload 는 `{ analysis: V4, saved: false }`.

```ts
// (관련 테스트 케이스 갱신 — 옛 mock SSE 응답 갱신)
```

- [ ] **Step 2: 테스트 실패 확인**

`cd frontend && npx vitest run __tests__/api-vision-compare.test.ts` — 옛 mock 으로 fail.

- [ ] **Step 3: `compare.ts` 갱신**

`compare.ts` 의 `CompareAnalyzeResponse.analysis` 타입을 `VisionCompareAnalysisV4 | ComparisonAnalysis` 로 (V4 추가, ComparisonAnalysis = Edit context v3 유지). 옛 `VisionCompareAnalysis` 폐기.

`promptMode` 필드 제거 (spec §6.2 — frontend 더 이상 안 보냄).

- [ ] **Step 4: 테스트 통과**

`cd frontend && npx vitest run __tests__/api-vision-compare.test.ts` — PASS.

- [ ] **Step 5: 회귀**

```bash
cd frontend && npx vitest run && npx tsc --noEmit
```

Expected: 회귀 0 (옛 5축 시각 컴포넌트가 아직 V4 안 따른 면 type error — Phase 7~8 에서 fix).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/api/compare.ts \
        frontend/__tests__/api-vision-compare.test.ts
git commit -m "feat(compare-api): SSE drain 5 stage + V4 응답 + promptMode 제거"
```

---

### Task 19: `pipeline-defs.tsx` `PIPELINE_DEFS["compare"]` 5 stage

**Files:**
- Modify: `frontend/lib/pipeline-defs.tsx`
- Test: `frontend/__tests__/pipeline-defs-consistency.test.ts` (갱신)

- [ ] **Step 1: 5 stage 정의 교체**

`pipeline-defs.tsx:363` 의 `compare` array 를:

```ts
compare: [
  { type: "compare-encoding", label: "이미지 A/B 인코딩", subLabel: "browser" },
  { type: "observe1",         label: "Image1 관찰", subLabel: visionSubLabel },
  { type: "observe2",         label: "Image2 관찰", subLabel: visionSubLabel },
  { type: "diff-synth",       label: "차이 합성",   subLabel: "gemma4-un (think:false)" },
  { type: "translation",      label: "한국어 번역", subLabel: "gemma4-un" },
],
```

- [ ] **Step 2: consistency 테스트 갱신**

5 stage 시퀀스 + visionSubLabel 콜백 정합성 verify.

- [ ] **Step 3: 회귀**

```bash
cd frontend && npx vitest run __tests__/pipeline-defs-consistency.test.ts \
                              __tests__/stores-stage-history.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/pipeline-defs.tsx \
        frontend/__tests__/pipeline-defs-consistency.test.ts \
        frontend/__tests__/stores-stage-history.test.ts
git commit -m "feat(compare-pipeline-defs): 5 stage 진행 모달 (compare-encoding + observe1/2 + diff-synth + translation)"
```

---

## Phase 7: Frontend 컴포넌트 신설 (9 task)

각 컴포넌트는 **TDD 사이클** (테스트 → 실패 → 구현 → 통과 → commit). 컴포넌트 props 시그니처는 spec §5.3 의 마지막 박제.

### Task 20: `CompareResultHeader.tsx`

**Files:**
- Create: `frontend/components/studio/compare/CompareResultHeader.tsx`
- Test: `frontend/components/studio/compare/__tests__/CompareResultHeader.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CompareResultHeader from "../CompareResultHeader";

describe("CompareResultHeader", () => {
  it("summaryKo 텍스트 렌더 + fidelity chip 표시", () => {
    render(<CompareResultHeader summaryKo="두 인물 비교" fidelityScore={87} domainMatch="person" />);
    expect(screen.getByText("두 인물 비교")).toBeInTheDocument();
    expect(screen.getByText(/87/)).toBeInTheDocument();
  });

  it("domainMatch=mixed 일 때 chip 생략", () => {
    render(<CompareResultHeader summaryKo="다른 도메인" fidelityScore={null} domainMatch="mixed" />);
    expect(screen.queryByText(/유사도/)).not.toBeInTheDocument();
  });

  it("fidelityScore=null 일 때도 chip 생략", () => {
    render(<CompareResultHeader summaryKo="x" fidelityScore={null} domainMatch="person" />);
    expect(screen.queryByText(/유사도/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 → 구현 → PASS → commit**

구현 (`CompareResultHeader.tsx`): summary text + 우측 fidelity chip (`유사도 N%`). chip 표시 조건: `domainMatch !== 'mixed' && fidelityScore !== null`. 색상은 score 에 따라 단계 (>=90 cyan, 80~89 amber, <80 muted).

```bash
git commit -m "feat(compare-ui): CompareResultHeader (summary + fidelity chip)"
```

---

### Task 21: `CompareImageDual.tsx`

분리 thumbnail 좌/우 + on-demand 버튼.

- [ ] **Step 1: 실패 테스트 작성**

```tsx
// image1/image2 url + onPromptRequest(which) callback + perImagePrompt 결과 표시
```

- [ ] **Step 2~5: 구현 → commit**

Props: `image1Url`, `image2Url`, `image1Prompt`, `image2Prompt`, `inFlight`, `onPromptRequest(which)`, `onPromptReset(which)`. 두 thumbnail 옆에 "이 이미지 t2i prompt 만들기" 버튼 + spinner (inFlight 일 때) + 결과 펼침 영역.

`git commit -m "feat(compare-ui): CompareImageDual + on-demand 버튼 (전역 직렬화)"`

---

### Task 22: `CompareSliderViewer.tsx`

BeforeAfter 슬라이더 (horizontal wipe).

- [ ] **Step 1: 실패 테스트 작성**

```tsx
// drag 핸들 default 50% + onChange wipe value
```

- [ ] **Step 2~5: 구현 → commit**

`BeforeAfterSlider` 패턴 재사용 (frontend/components/studio/BeforeAfterSlider.tsx 기존 컴포넌트 wrap). letterbox 처리 (다른 사이즈 이미지 시 검은 여백).

`git commit -m "feat(compare-ui): CompareSliderViewer (BeforeAfter wipe + letterbox)"`

---

### Task 23: `CompareCommonDiffChips.tsx`

공통점/차이점 칩 영역.

- [ ] **Step 1~5: 테스트 → 구현 → commit**

Props: `commonPointsKo[]`, `keyDifferencesKo[]`, hover tooltip (en 원문). 좌측 cyan, 우측 amber.

`git commit -m "feat(compare-ui): CompareCommonDiffChips"`

---

### Task 24: `CompareCategoryMatrix.tsx`

5 카테고리 매트릭스 (3-col).

- [ ] **Step 1~5: 테스트 → 구현 → commit**

Props: `categoryDiffs: Record<string, CompareCategoryDiffJSON>`. 5 row × 3 col (image1 / image2 / diff). 각 row 우상단 영문 펼침 토글. mixed 도메인이면 빈 컴포넌트 (또는 부모가 안 렌더).

`git commit -m "feat(compare-ui): CompareCategoryMatrix (5 카테고리 가로 3-col)"`

---

### Task 25: `CompareKeyAnchors.tsx`

key anchor 강조.

- [ ] **Step 1~5: 테스트 → 구현 → commit**

Props: `anchors: CompareKeyAnchorJSON[]`, `domainMatch`. 동도메인이면 toggle 펼침, mixed 면 항상 펼침. row layout: `[label] image1 → image2`.

`git commit -m "feat(compare-ui): CompareKeyAnchors (mixed 도메인 메인 / 동도메인 보조)"`

---

### Task 26: `CompareTransformBox.tsx`

transform_prompt + 복사 버튼.

- [ ] **Step 1~5: 테스트 → 구현 → commit**

Props: `transformPromptEn`, `transformPromptKo`. 영문 prompt 박스 + "복사" 버튼 + "한국어 ▾" 토글.

`git commit -m "feat(compare-ui): CompareTransformBox (복사 + 한글 토글)"`

---

### Task 27: `CompareImageDetailDrawer.tsx`

on-demand 합성 결과 펼침.

- [ ] **Step 1~5: 테스트 → 구현 → commit**

Props: `prompt: { positive_prompt, summary, ... } | null`, `loading`, `onCancel`. 펼침 시 prompt 표시 + 복사 + 재합성 버튼.

`git commit -m "feat(compare-ui): CompareImageDetailDrawer (인라인 spinner + 결과 펼침)"`

---

### Task 28: `CompareUncertainBox.tsx`

uncertain 박스 (작은 회색 박스).

- [ ] **Step 1~5: 테스트 → 구현 → commit**

Props: `uncertainEn`, `uncertainKo`. 둘 다 빈 문자열이면 렌더 X.

`git commit -m "feat(compare-ui): CompareUncertainBox"`

---

## Phase 8: Frontend 페이지 통합 (2 task)

### Task 29: `CompareAnalysisPanel.tsx` V4 렌더 전면 재작성

**Files:**
- Modify: `frontend/components/studio/compare/CompareAnalysisPanel.tsx`
- Modify: `frontend/__tests__/uniform-compare-cards.test.tsx` (V4 fixture 교체)

- [ ] **Step 1: 옛 panel 분석 + 신규 panel 설계**

옛 5축 score 매트릭스 렌더 코드 제거. 새 layout (spec §5 ASCII wireframe 그대로):

1. CompareResultHeader
2. CompareImageDual + CompareSliderViewer (이미지 영역 A1)
3. CompareCommonDiffChips
4. CompareCategoryMatrix (mixed 면 skip)
5. CompareKeyAnchors
6. CompareTransformBox
7. CompareUncertainBox

- [ ] **Step 2: 테스트 갱신 (uniform-compare-cards)**

V4 fixture 로 교체. 5축 score assertion 폐기.

- [ ] **Step 3: 구현**

```tsx
"use client";

import type { VisionCompareAnalysisV4 } from "@/lib/api/types";
import CompareResultHeader from "./CompareResultHeader";
import CompareImageDual from "./CompareImageDual";
import CompareSliderViewer from "./CompareSliderViewer";
import CompareCommonDiffChips from "./CompareCommonDiffChips";
import CompareCategoryMatrix from "./CompareCategoryMatrix";
import CompareKeyAnchors from "./CompareKeyAnchors";
import CompareTransformBox from "./CompareTransformBox";
import CompareUncertainBox from "./CompareUncertainBox";

interface Props {
  analysis: VisionCompareAnalysisV4;
  image1Url: string;
  image2Url: string;
  // on-demand callback
  onPerImagePromptRequest: (which: "image1" | "image2") => void;
  onPerImagePromptReset: (which: "image1" | "image2") => void;
  perImageInFlight: "image1" | "image2" | null;
  perImagePromptImage1: any | null;
  perImagePromptImage2: any | null;
}

export default function CompareAnalysisPanel({
  analysis, image1Url, image2Url,
  onPerImagePromptRequest, onPerImagePromptReset,
  perImageInFlight, perImagePromptImage1, perImagePromptImage2,
}: Props) {
  return (
    <div className="ais-result-hero-plain" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <CompareResultHeader
        summaryKo={analysis.summaryKo}
        fidelityScore={analysis.fidelityScore}
        domainMatch={analysis.domainMatch}
      />
      <CompareImageDual
        image1Url={image1Url}
        image2Url={image2Url}
        image1Prompt={perImagePromptImage1}
        image2Prompt={perImagePromptImage2}
        inFlight={perImageInFlight}
        onPromptRequest={onPerImagePromptRequest}
        onPromptReset={onPerImagePromptReset}
      />
      <CompareSliderViewer image1Url={image1Url} image2Url={image2Url} />
      <CompareCommonDiffChips
        commonPointsKo={analysis.commonPointsKo}
        commonPointsEn={analysis.commonPointsEn}
        keyDifferencesKo={analysis.keyDifferencesKo}
        keyDifferencesEn={analysis.keyDifferencesEn}
      />
      {analysis.domainMatch !== "mixed" && (
        <CompareCategoryMatrix categoryDiffs={analysis.categoryDiffs} />
      )}
      <CompareKeyAnchors anchors={analysis.keyAnchors} domainMatch={analysis.domainMatch} />
      <CompareTransformBox
        transformPromptEn={analysis.transformPromptEn}
        transformPromptKo={analysis.transformPromptKo}
      />
      <CompareUncertainBox
        uncertainEn={analysis.uncertainEn}
        uncertainKo={analysis.uncertainKo}
      />
    </div>
  );
}
```

- [ ] **Step 4: 회귀 + commit**

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npm run lint
```

```bash
git commit -m "feat(compare-ui): CompareAnalysisPanel V4 렌더 전면 재작성 (Phase 7 컴포넌트 통합)"
```

---

### Task 30: `CompareLeftPanel.tsx` + page wiring

**Files:**
- Modify: `frontend/components/studio/compare/CompareLeftPanel.tsx`
- Modify: `frontend/app/vision/compare/page.tsx`

- [ ] **Step 1: CompareLeftPanel 갱신**

- 비전 모델 카드 = `<VisionModelSelector />` 사용 (Phase 0 의 컴포넌트)
- compareHint textarea (옛 코드 그대로 — placeholder 한국어 자유 자연어)
- 옛 promptMode 토글 등 폐기 (spec §6.2)

- [ ] **Step 2: page.tsx 갱신**

- store 의 V4 shape 사용
- `compareAnalyze({ ..., onStage })` 호출 시 5 stage 처리
- on-demand 버튼 → `compareAnalyze.perImagePrompt({ observation })` 호출 (Task 18 의 compare.ts 에 함수 추가 필요)

이 시점에 `compare.ts` 에 `compareAnalyzePerImagePrompt(observation)` 함수 추가:

```ts
export async function compareAnalyzePerImagePrompt(
  observation: Record<string, unknown>,
  ollamaModel?: string,
): Promise<{ summary: string; positive_prompt: string; ... }> {
  const res = await fetch(`${STUDIO_BASE}/api/studio/compare-analyze/per-image-prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ observation, ollamaModel }),
  });
  if (res.status === 503) {
    const body = await res.json();
    throw new Error(body.detail?.message || "GPU busy — 잠시 후 다시 시도해주세요");
  }
  if (!res.ok) throw new Error(`per-image-prompt failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 3: 통합 회귀**

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npm run lint
cd ../backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -q
```

Expected: 모두 PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(compare-page): CompareLeftPanel + page wiring V4 통합 (VisionModelSelector + on-demand 버튼)"
```

---

## Phase 9: 시각 review 게이트 (1 task)

### Task 31: 사용자 시각 review

**의도**: spec §5.1 — Phase 8 끝나고 Phase 10 사용자 시나리오 검증 진입 전 1회 시각 review (정보 밀도 / 스크롤 길이 / 시각 일관성 점검).

- [ ] **Step 1: 백엔드 + 프론트 dev 서버 띄움**

```powershell
# Backend (terminal 1)
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --no-access-log

# Frontend (terminal 2)
$env:NEXT_PUBLIC_USE_MOCK="false"
$env:NEXT_PUBLIC_STUDIO_API="http://localhost:8001"
cd frontend && npm run dev
```

- [ ] **Step 2: 사용자 시각 평가 요청**

브라우저 → `/vision/compare` 접속 → mock 또는 실 분석 1회 → spec ASCII wireframe 과 시각 비교.

체크리스트 (사용자 직접 확인):
- [ ] CompareResultHeader 의 fidelity chip 색/위치 OK?
- [ ] CompareImageDual + Slider 의 letterbox / wipe 핸들 자연스러운가?
- [ ] CommonDiffChips 의 cyan/amber 톤 가독성 OK?
- [ ] CategoryMatrix 의 3-col 정보 밀도 OK? 너무 빡빡하지 않은가?
- [ ] KeyAnchors 의 위치 / 펼침 토글 자연스러운가?
- [ ] TransformBox 복사 버튼 동작 OK?
- [ ] 전체 스크롤 길이 1800~2400px 추정 범위 내?
- [ ] On-demand 버튼 spinner / 결과 펼침 자연스러운가?

- [ ] **Step 3: 사용자 피드백 받아 fix (있다면)**

피드백 → 컴포넌트 styling fix → 추가 commit.

- [ ] **Step 4: review 통과 후 박제 commit (있다면)**

```bash
git commit -m "fix(compare-ui): Phase 8 시각 review 피드백 반영"
```

---

## Phase 10: 사용자 시나리오 시각 검증 (1 task)

### Task 32: 시나리오 1, 2, 4, 5 6/6 production 품질 도달

**의도**: spec §10.3 — vision precision 기준 동일. 실 이미지 fixture 로 V4 분석 결과 품질 평가.

- [ ] **Step 1: fixture 준비**

| # | 시나리오 | fixture 경로 |
|---|----------|--------------|
| 1 | 같은 인물 다른 컷 | `docs/design-test/assets/raw/edit-1727-007.png` + 같은 인물 다른 컷 (사용자 준비) |
| 2 | 레퍼런스 ↔ 결과 | 레퍼런스 + history 에서 매칭 결과 1장 |
| 4 | 사진 vs 일러스트 | `docs/design-test/assets/raw/2026-05-03 오후 05_07_13.png` (ChatGPT 일러) + 일반 사진 1장 |
| 5 | 같은 prompt 다른 모델 | Wan22 결과 frame1 + LTX 결과 frame1 (ffmpeg 추출) |

- [ ] **Step 2: 각 시나리오 분석 1회**

브라우저 → `/vision/compare` → 두 이미지 업로드 → "비교 분석 시작" → 결과 평가:

| 항목 | 평가 |
|------|------|
| **summary 정확도** | 요약이 두 이미지를 정확히 포착했나? |
| **common_points 가치** | 의미 있는 공통점인가, trivial 한가? |
| **key_differences 정밀도** | 핵심 차이를 놓치지 않았나? |
| **categoryDiffs 깊이** | 5 카테고리에서 묘사가 generic 한가, specific 한가? (anchor fidelity) |
| **keyAnchors 캐치력** | gaze / hand / eye 등 작은 anchor 캐치하나? |
| **fidelity_score 합리성** | 점수가 시각 인상과 일치? |
| **transform_prompt 사용성** | 이걸 generate 페이지에 붙여넣으면 동작할까? |

- [ ] **Step 3: 6/6 production 품질 도달 시 통과**

vision precision 동일 기준 — 6개 평가 항목 중 모두 production 가치 (사용자 만족).

부족하면 prompt 튜닝 fix → 추가 commit.

- [ ] **Step 4: 시나리오 통과 commit**

```bash
git commit -m "test(compare-v4): 시나리오 1/2/4/5 6/6 production 품질 도달 (Phase 10 완료)"
```

- [ ] **Step 5: master merge 준비**

```bash
git log --oneline master..feature/vision-compare-redesign | wc -l
```

Phase 0~10 commit 수 확인. master `--no-ff` merge 는 사용자 명시 요청 시.

---

## Self-Review

### Spec coverage check

| Spec 섹션 | Plan task |
|-----------|-----------|
| §1 요약 | 전체 plan |
| §2 의도 / 본질 | (참고) |
| §3.1 4 stage + unload 정책 | Task 8 (pipeline.py) |
| §3.2 on-demand stage | Task 12, 27, 30 |
| §3.3 진행 모달 5 stage | Task 19 |
| §4.1 vision_observe 재사용 | Task 8 (call site) |
| §4.2 diff_synthesize schema + STRICT JSON | Task 5 |
| §4.3 dataclass | Task 3 |
| §5.1 페이지 layout + ASCII wireframe | Task 29~30 + Task 31 시각 review |
| §5.2 좌패널 | Task 30 |
| §5.3.1 Header | Task 20 |
| §5.3.2 이미지 영역 A1 | Task 21, 22 |
| §5.3.3 칩 | Task 23 |
| §5.3.4 매트릭스 | Task 24 |
| §5.3.5 Anchors | Task 25 |
| §5.3.6 Transform | Task 26 |
| §5.3.7 On-demand | Task 27 (+ 17 store + 30 wiring) |
| §5.3.8 Uncertain | Task 28 |
| §6.1 endpoint context 분기 | Task 11 |
| §6.2 promptMode 제거 | Task 18 |
| §6.3 SSE 계약 | Task 11, 18 |
| §6.4 per-image endpoint + GPU lock | Task 12 |
| §7.1 모듈 구조 (`_types`/`_axes`/`_coerce`/`diff_synthesize`/`translate`/`pipeline`) | Task 2~8 |
| §7.2 v2_generic 폐기 | Task 14 |
| §7.3 route validation + persist 분기 | Task 10, 11 |
| §8.1 신설 컴포넌트 9개 | Task 20~28 |
| §8.2 갱신 (types / mock / store / pipeline-defs / panel) + to_dict camelCase + OpenAPI 한계 + VisionModelSelector | Task 1, 13, 15~19, 29 |
| §10 테스트 (backend 7 신규 + 2 갱신 + 1 폐기, frontend 6 신규 + 5 갱신 + 1 폐기) | 분산 |
| §11.1 함정 | Task 8 fallback / Task 5 anchor fidelity 시스템 프롬프트 |
| §11.2 plan 박제 후속 | (이 plan 자체) |

빠진 거 없음.

### Placeholder scan

전체 plan 에 "TBD" / "TODO" 검색 — Task 11 의 `ollama_url="http://localhost:11434", # TODO: settings 주입` 1건 있음. 이건 backend 의 일관 패턴 (다른 pipeline 도 hardcode) 이라 허용. plan 에서 명시:

→ Task 11 의 그 한 줄은 spec §11.2 후속 plan 후보로 박제 (`config.py` 에서 설정 로드 통합 후속).

다른 placeholder 없음.

### Type consistency

- `VisionCompareAnalysisV4` interface 모든 task 에서 동일 키 사용 ✅
- `CompareCategoryDiffJSON` / `CompareKeyAnchorJSON` ✅
- `analyze_pair_v4` 시그니처 (Task 8) ↔ pipeline 호출 (Task 11) 인자 일치 ✅
- `_run_compare_analyze_pipeline` 시그니처 (Task 10 의 4 신규 파라미터 + Task 11 의 V4 호출) 일치 ✅
- `to_dict()` snake_case → camelCase 변환 일관 ✅
- `compareAnalyzePerImagePrompt` (Task 30 추가) ↔ endpoint (Task 12) 일치 ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-05-vision-compare-redesign.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — 각 task 마다 fresh subagent 디스패치 + task 사이 review. 빠른 iteration, 메인 컨텍스트 보호. 32 task 라 subagent 30+ 회 + review checkpoint.

**2. Inline Execution** — 본 세션에서 직접 실행. batch 단위 (Phase 별) checkpoint. 메인 컨텍스트 무거워질 수 있음.

오빠 어떤 방식 쓸래?

---

*plan 끝.*
