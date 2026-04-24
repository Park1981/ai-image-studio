# Edit 비교 분석 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit 모드 결과 ↔ 원본 이미지 일관성을 qwen2.5vl 비전 모델로 5축 평가 (face_id / body_pose / attire / background / intent_fidelity) 한 뒤 점수+코멘트 영구 저장 · /edit 페이지 인라인 카드와 ImageLightbox 메타 패널에 표시.

**Architecture:**
- 백엔드: 신규 `studio/comparison_pipeline.py` 가 qwen2.5vl multi-image 호출 + gemma4-un (think:False) 한글 번역 + JSON parse + fallback. `studio/router.py` 에 `/compare-analyze` 엔드포인트 추가 + `/edit` 응답에 source 디스크 영구 저장. `history_db.py` 에 `source_ref` / `comparison_analysis` 컬럼 ALTER + `update_comparison()` 헬퍼.
- 프론트: 신규 `lib/api/compare.ts` + `hooks/useComparisonAnalysis.ts` (트리거+캐시+busy guard) + `components/studio/ComparisonAnalysis{Card,Modal}.tsx`. `useSettingsStore` 에 `autoCompareAnalysis` 토글 추가.
- 데이터 흐름: 사용자 클릭 → multipart POST → vision (qwen2.5vl 동시 2장) → JSON parse → 한글 번역 → `historyItemId` 있으면 DB 갱신 → 응답 → `useHistoryStore.add` 로 inline 갱신.

**Tech Stack:** FastAPI · aiosqlite · httpx · qwen2.5vl:7b (Ollama multi-image) · gemma4-un (Ollama, `think:False`) · Next.js 16 · React 19 · Zustand 5 · TypeScript strict.

**선행 spec:** `docs/superpowers/specs/2026-04-24-edit-comparison-analysis-design.md` (HEAD `e337ca8`)

---

## File Structure

### 신규 파일
- `backend/studio/comparison_pipeline.py` — `SYSTEM_COMPARE`, `analyze_pair()`, `_parse_strict_json()`, `_translate_comments_to_ko()`, `ComparisonAnalysisResult` dataclass
- `backend/tests/studio/test_comparison_pipeline.py` — Mock 비전 클라이언트로 5축/JSON 파싱/누락 점수/번역 실패/fallback 검증 + 라우트 happy/error path
- `frontend/lib/api/compare.ts` — `compareAnalyze({source, result, editPrompt, historyItemId, ...})` 호출 함수
- `frontend/components/studio/ComparisonAnalysisCard.tsx` — 4-state 인라인 카드 (empty / loading / filled / disabled)
- `frontend/components/studio/ComparisonAnalysisModal.tsx` — 5축 막대 + 코멘트 영/한 토글 모달
- `frontend/hooks/useComparisonAnalysis.ts` — 수동/자동 트리거 + per-item busy guard + VRAM 임계 체크 + 결과 store 반영

### 수정 파일
- `backend/studio/history_db.py` — ALTER COLUMN 마이그레이션 + `insert_item` 에 `source_ref` + `_row_to_item` 신규 두 컬럼 직렬화 + `update_comparison(item_id, analysis_dict)` 신규
- `backend/studio/router.py` — `/edit` 응답 시 source 디스크 영구 저장 (`STUDIO_OUTPUT_DIR/edit-source/{id}.png`) + `/compare-analyze` 엔드포인트 신규 + `_COMPARE_LOCK` asyncio.Lock
- `frontend/lib/api/types.ts` — `ComparisonScores`, `ComparisonComments`, `ComparisonAnalysis` 타입 + `HistoryItem` 에 `sourceRef?`, `comparisonAnalysis?` 두 필드
- `frontend/lib/api-client.ts` — barrel 에 `compareAnalyze`, `ComparisonAnalysis` 등 re-export
- `frontend/lib/api/edit.ts` — `mockEditStream` 에 `sourceRef` 채움 (Mock 호환)
- `frontend/components/studio/ImageLightbox.tsx` — `InfoPanel` 안에 `item.mode === "edit"` 일 때 `ComparisonAnalysisCard` 렌더 (z-index 한 단계 ↑)
- `frontend/app/edit/page.tsx` — `<AiEnhanceCard>` 바로 아래 `<ComparisonAnalysisCard>` 추가
- `frontend/hooks/useEditPipeline.ts` — `done` 핸들러 안에서 `autoCompareAnalysis` ON & busy 아닐 때 백그라운드 분석 트리거
- `frontend/stores/useSettingsStore.ts` — `autoCompareAnalysis: boolean` (기본 false) + setter
- `frontend/components/settings/SettingsDrawer.tsx` — `PreferencesSection` 에 토글 한 줄 추가

---

## Task 1: DB 스키마 마이그레이션 (source_ref + comparison_analysis 컬럼)

**Files:**
- Modify: `backend/studio/history_db.py`
- Test: `backend/tests/studio/test_comparison_pipeline.py` (이 task 분량은 마이그레이션 idempotent 만 검증)

- [ ] **Step 1: 실패 테스트 작성 — 두 컬럼 존재 + 신규 row insert 시 직렬화**

테스트 파일 신규 생성:

```python
# backend/tests/studio/test_comparison_pipeline.py
"""
comparison_pipeline + history_db 마이그레이션 + /compare-analyze 라우트 테스트.

스코프:
  - source_ref / comparison_analysis 컬럼 idempotent ALTER
  - update_comparison() 가 JSON 직렬화로 저장
  - analyze_pair() 비전 호출 / JSON 파싱 / fallback / 번역 실패
  - POST /api/studio/compare-analyze 정상/에러 경로
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import tempfile
from pathlib import Path

import aiosqlite
import pytest
from PIL import Image


def _tiny_png_bytes() -> bytes:
    """2×2 PNG 바이트 (테스트용)."""
    buf = io.BytesIO()
    Image.new("RGB", (2, 2), color=(120, 80, 200)).save(buf, "PNG")
    return buf.getvalue()


def _set_temp_db(monkeypatch, tmp_path: Path) -> Path:
    """history_db._DB_PATH 를 임시 디렉토리로 강제."""
    db_path = tmp_path / "test_history.db"
    monkeypatch.setattr("studio.history_db._DB_PATH", str(db_path))
    return db_path


@pytest.mark.asyncio
async def test_init_db_adds_comparison_columns(monkeypatch, tmp_path: Path) -> None:
    """init_studio_history_db() 가 source_ref / comparison_analysis 컬럼 모두 추가."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    # 컬럼 존재 확인
    async with aiosqlite.connect(history_db._DB_PATH) as db:
        cur = await db.execute("PRAGMA table_info(studio_history)")
        cols = {row[1] for row in await cur.fetchall()}
    assert "source_ref" in cols
    assert "comparison_analysis" in cols


@pytest.mark.asyncio
async def test_init_db_idempotent(monkeypatch, tmp_path: Path) -> None:
    """init 두 번 불러도 ALTER 중복 에러 없이 통과."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()
    await history_db.init_studio_history_db()  # 두 번째 호출 — 에러 없어야 함
```

- [ ] **Step 2: 테스트 실행 → FAIL 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_comparison_pipeline.py -v`
Expected: FAIL — 두 컬럼이 아직 없음. `assert "source_ref" in cols` 실패.

- [ ] **Step 3: history_db.py 에 마이그레이션 코드 추가**

`backend/studio/history_db.py` 수정. `CREATE_TABLE` 상수에 두 컬럼 추가 + `init_studio_history_db()` 안에 idempotent ALTER 블록 추가.

```python
# CREATE_TABLE 상수의 마지막 컬럼 (comfy_error TEXT) 다음 줄에 추가:
CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS studio_history (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('generate','edit','video')),
  prompt TEXT NOT NULL,
  label TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  seed INTEGER,
  steps INTEGER,
  cfg REAL,
  lightning INTEGER,
  model TEXT,
  created_at INTEGER NOT NULL,
  image_ref TEXT NOT NULL,
  upgraded_prompt TEXT,
  upgraded_prompt_ko TEXT,
  prompt_provider TEXT,
  research_hints TEXT,
  vision_description TEXT,
  comfy_error TEXT,
  source_ref TEXT,
  comparison_analysis TEXT
);
"""
```

`init_studio_history_db()` 의 v3 비디오 마이그레이션 블록 직후 (마지막 `log.info(...)` 호출 이전) 에 v4 블록 추가:

```python
# v4 (2026-04-24): comparison 분석 영구 저장 컬럼 두 개 추가
async with aiosqlite.connect(_DB_PATH) as db:
    for col_name in ("source_ref", "comparison_analysis"):
        try:
            await db.execute(
                f"ALTER TABLE studio_history ADD COLUMN {col_name} TEXT"
            )
            log.info("Migrated studio_history: added %s column", col_name)
        except Exception:
            # 이미 존재하면 정상 (idempotent)
            pass
    await db.commit()
```

- [ ] **Step 4: 테스트 재실행 → PASS 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_comparison_pipeline.py -v`
Expected: PASS — 두 테스트 모두 통과.

- [ ] **Step 5: 기존 테스트 회귀 없는지 전체 실행**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/`
Expected: 신규 2건 + 기존 13건 모두 PASS.

- [ ] **Step 6: 커밋**

```bash
git add backend/studio/history_db.py backend/tests/studio/test_comparison_pipeline.py
git commit -m "$(cat <<'EOF'
feat(history-db): source_ref + comparison_analysis 컬럼 추가

- studio_history 테이블에 두 컬럼 ALTER (idempotent)
- 기존 row 는 NULL — UI 가 graceful 처리
- 마이그레이션 테스트 2건 (init/idempotent)

Edit 비교 분석 기능 (spec: 2026-04-24-edit-comparison-analysis-design)
영구 저장 인프라.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: history_db 함수 확장 (insert_item · _row_to_item · update_comparison)

**Files:**
- Modify: `backend/studio/history_db.py`
- Test: `backend/tests/studio/test_comparison_pipeline.py` (append)

- [ ] **Step 1: 실패 테스트 — insert_item 시 source_ref 저장 + update_comparison 동작 + _row_to_item 직렬화**

기존 테스트 파일 끝에 append:

```python
@pytest.mark.asyncio
async def test_insert_with_source_ref_persists(monkeypatch, tmp_path: Path) -> None:
    """insert_item 이 source_ref 를 저장하고 list_items 가 camelCase 로 반환."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    item = {
        "id": "tsk-test12345678",
        "mode": "edit",
        "prompt": "make it blue",
        "label": "make it blue",
        "width": 1024,
        "height": 1024,
        "seed": 42,
        "steps": 4,
        "cfg": 1.0,
        "lightning": True,
        "model": "qwen-image-edit-2511",
        "createdAt": 1700000000000,
        "imageRef": "/images/studio/result.png",
        "sourceRef": "/images/studio/edit-source/tsk-test12345678.png",
    }
    await history_db.insert_item(item)
    items = await history_db.list_items(mode="edit")
    assert len(items) == 1
    assert items[0]["sourceRef"] == "/images/studio/edit-source/tsk-test12345678.png"
    assert items[0]["comparisonAnalysis"] is None  # 분석 전


@pytest.mark.asyncio
async def test_update_comparison_persists_json(monkeypatch, tmp_path: Path) -> None:
    """update_comparison() 가 dict 를 JSON 직렬화로 저장 + 재조회 시 dict 복원."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    item = {
        "id": "tsk-test87654321",
        "mode": "edit",
        "prompt": "x",
        "label": "x",
        "width": 1024,
        "height": 1024,
        "seed": 1,
        "steps": 4,
        "cfg": 1.0,
        "lightning": True,
        "model": "qwen-image-edit-2511",
        "createdAt": 1700000001000,
        "imageRef": "/images/studio/r.png",
    }
    await history_db.insert_item(item)

    analysis = {
        "scores": {"face_id": 92, "body_pose": 75, "attire": 60,
                   "background": 88, "intent_fidelity": 95},
        "overall": 82,
        "comments_en": {"face_id": "good", "body_pose": "ok", "attire": "ok",
                        "background": "ok", "intent_fidelity": "ok"},
        "comments_ko": {"face_id": "좋음", "body_pose": "보통", "attire": "보통",
                        "background": "보통", "intent_fidelity": "좋음"},
        "summary_en": "Solid identity preservation.",
        "summary_ko": "신원 보존 양호.",
        "provider": "ollama",
        "fallback": False,
        "analyzedAt": 1700000005000,
        "visionModel": "qwen2.5vl:7b",
    }
    ok = await history_db.update_comparison("tsk-test87654321", analysis)
    assert ok is True

    fetched = await history_db.get_item("tsk-test87654321")
    assert fetched is not None
    assert fetched["comparisonAnalysis"]["overall"] == 82
    assert fetched["comparisonAnalysis"]["scores"]["face_id"] == 92


@pytest.mark.asyncio
async def test_update_comparison_unknown_id_returns_false(
    monkeypatch, tmp_path: Path,
) -> None:
    """존재하지 않는 id 는 False 반환 (예외 X)."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    ok = await history_db.update_comparison("tsk-nonexistent00", {"overall": 50})
    assert ok is False
```

- [ ] **Step 2: 테스트 실행 → FAIL 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_comparison_pipeline.py -v -k "insert_with_source_ref or update_comparison"`
Expected: FAIL — `update_comparison` 함수 없음 + `_row_to_item` 이 신규 컬럼 모름.

- [ ] **Step 3: history_db.py 에 함수/직렬화 확장**

`insert_item` 의 SQL 과 파라미터에 두 컬럼 추가 — 컬럼 리스트 끝에 `source_ref, comparison_analysis` 추가, VALUES placeholder 두 개 추가, 파라미터 튜플에 두 값 추가:

```python
async def insert_item(item: dict[str, Any]) -> None:
    """생성/수정 완료 아이템 저장."""
    async with aiosqlite.connect(_DB_PATH) as db:
        await db.execute(
            """INSERT OR REPLACE INTO studio_history
            (id, mode, prompt, label, width, height, seed, steps, cfg, lightning,
             model, created_at, image_ref, upgraded_prompt, upgraded_prompt_ko,
             prompt_provider, research_hints, vision_description, comfy_error,
             source_ref, comparison_analysis)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                item["id"],
                item["mode"],
                item["prompt"],
                item["label"],
                item.get("width"),
                item.get("height"),
                item.get("seed"),
                item.get("steps"),
                item.get("cfg"),
                1 if item.get("lightning") else 0,
                item.get("model"),
                int(item.get("createdAt", time.time() * 1000)),
                item["imageRef"],
                item.get("upgradedPrompt"),
                item.get("upgradedPromptKo"),
                item.get("promptProvider"),
                json.dumps(item.get("researchHints") or [], ensure_ascii=False),
                item.get("visionDescription"),
                item.get("comfyError"),
                item.get("sourceRef"),
                # 분석은 별도 update_comparison 으로 갱신 — insert 시점엔 항상 None
                None,
            ),
        )
        await db.commit()
```

`_row_to_item` 의 return dict 마지막에 두 필드 추가 (try/except 로 옛날 row 호환):

```python
def _row_to_item(row: aiosqlite.Row) -> dict[str, Any]:
    """row → 프론트 HistoryItem shape."""
    hints_raw = row["research_hints"]
    try:
        hints = json.loads(hints_raw) if hints_raw else []
    except Exception:
        hints = []
    try:
        upgraded_ko = row["upgraded_prompt_ko"]
    except (IndexError, KeyError):
        upgraded_ko = None
    # v4 컬럼 (source_ref, comparison_analysis) — 마이그레이션 전 row 호환
    try:
        source_ref = row["source_ref"]
    except (IndexError, KeyError):
        source_ref = None
    try:
        comp_raw = row["comparison_analysis"]
        comp_obj = json.loads(comp_raw) if comp_raw else None
    except (IndexError, KeyError, json.JSONDecodeError):
        comp_obj = None

    return {
        "id": row["id"],
        "mode": row["mode"],
        "prompt": row["prompt"],
        "label": row["label"],
        "width": row["width"],
        "height": row["height"],
        "seed": row["seed"],
        "steps": row["steps"],
        "cfg": row["cfg"],
        "lightning": bool(row["lightning"]),
        "model": row["model"],
        "createdAt": row["created_at"],
        "imageRef": row["image_ref"],
        "upgradedPrompt": row["upgraded_prompt"],
        "upgradedPromptKo": upgraded_ko,
        "promptProvider": row["prompt_provider"],
        "researchHints": hints,
        "visionDescription": row["vision_description"],
        "comfyError": row["comfy_error"],
        "sourceRef": source_ref,
        "comparisonAnalysis": comp_obj,
    }
```

`history_db.py` 파일 끝에 `update_comparison` 신규 함수 추가:

```python
async def update_comparison(
    item_id: str, analysis: dict[str, Any]
) -> bool:
    """비교 분석 결과를 JSON 직렬화로 저장.

    Returns:
        rowcount > 0 (해당 id 의 row 가 존재하고 갱신됐으면 True).
    """
    payload = json.dumps(analysis, ensure_ascii=False)
    async with aiosqlite.connect(_DB_PATH) as db:
        cur = await db.execute(
            "UPDATE studio_history SET comparison_analysis = ? WHERE id = ?",
            (payload, item_id),
        )
        await db.commit()
        return cur.rowcount > 0
```

- [ ] **Step 4: 테스트 재실행 → PASS 확인**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_comparison_pipeline.py -v`
Expected: 5건 모두 PASS.

- [ ] **Step 5: 회귀 검증**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/`
Expected: 전체 PASS (마이그레이션이 기존 테스트의 임시 DB 에도 잘 적용돼야 함).

- [ ] **Step 6: 커밋**

```bash
git add backend/studio/history_db.py backend/tests/studio/test_comparison_pipeline.py
git commit -m "$(cat <<'EOF'
feat(history-db): update_comparison() + _row_to_item 확장

- insert_item: sourceRef 저장 (insert 시점엔 comparison NULL)
- _row_to_item: source_ref/comparison_analysis camelCase 직렬화
  (옛 row 컬럼 부재 시 try/except 로 graceful)
- update_comparison(item_id, analysis): JSON 직렬화 UPDATE
  존재 안 하는 id 는 False 반환

테스트 3건 추가 (source_ref persist · update happy · unknown id)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: TypeScript 타입 (ComparisonScores · ComparisonAnalysis · HistoryItem 확장)

**Files:**
- Modify: `frontend/lib/api/types.ts`
- Modify: `frontend/lib/api-client.ts`

- [ ] **Step 1: types.ts 에 신규 타입 + HistoryItem 확장 추가**

`frontend/lib/api/types.ts` 의 `HistoryItem` interface 다음 (혹은 video 메타 다음, 39줄 근처) 에 두 신규 필드 추가, 그리고 파일 상단 (HistoryItem 위) 에 새 인터페이스 묶음 삽입:

```ts
/* ──────────── Comparison Analysis (Edit 결과 vs 원본) ──────────── */

/** 비교 분석 5축 점수 (0-100 정수). 누락 축은 null 가능 — UI 에서 dash 표시. */
export interface ComparisonScores {
  face_id: number | null;
  body_pose: number | null;
  attire: number | null;
  background: number | null;
  intent_fidelity: number | null;
}

/** 5축 각각의 1-2 문장 코멘트 (en 또는 ko). */
export type ComparisonComments = {
  [K in keyof ComparisonScores]: string;
};

/** 비교 분석 단일 결과 — history item 에 영구 저장. */
export interface ComparisonAnalysis {
  scores: ComparisonScores;
  /** 5축 산술 평균 (0-100). null 점수는 평균 계산에서 제외. */
  overall: number;
  comments_en: ComparisonComments;
  comments_ko: ComparisonComments;
  summary_en: string;
  summary_ko: string;
  provider: "ollama" | "fallback";
  fallback: boolean;
  /** 분석 시점 unix ms. */
  analyzedAt: number;
  visionModel: string;
}
```

`HistoryItem` interface 의 마지막 video 필드 (`frameCount?: number`) 다음 줄에 두 필드 추가:

```ts
  /* ── Edit 모드 비교 분석 (mode === "edit" 일 때만 채워짐) ── */
  /** 원본 이미지 영구 경로 (예: "/images/studio/edit-source/{id}.png").
   *  옛 row 또는 generate/video 결과는 undefined. */
  sourceRef?: string;
  /** 비교 분석 결과. 분석 안 한 경우 undefined. */
  comparisonAnalysis?: ComparisonAnalysis;
```

- [ ] **Step 2: api-client barrel 에 신규 타입 re-export 추가**

`frontend/lib/api-client.ts` 의 `export type` 블록에 추가:

```ts
export type {
  HistoryItem,
  GenerateRequest,
  UpgradeOnlyResult,
  EditRequest,
  GenStage,
  EditStage,
  OllamaModel,
  ProcessStatusSnapshot,
  VramSnapshot,
  VideoRequest,
  VideoStage,
  VisionAnalysisResponse,
  ComparisonScores,
  ComparisonComments,
  ComparisonAnalysis,
} from "./api/types";
```

- [ ] **Step 3: TypeScript 컴파일 통과 확인**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0 (에러 없음).

- [ ] **Step 4: lint 통과 확인**

Run: `cd frontend && npm run lint`
Expected: 신규 타입 관련 lint 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add frontend/lib/api/types.ts frontend/lib/api-client.ts
git commit -m "$(cat <<'EOF'
feat(types): ComparisonAnalysis 타입 + HistoryItem 확장

- ComparisonScores (5축 · null 가능)
- ComparisonComments (en/ko · 5축 매핑)
- ComparisonAnalysis (scores+overall+코멘트+summary+provider+meta)
- HistoryItem.sourceRef / comparisonAnalysis 신규 필드

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 백엔드 comparison_pipeline.py — analyze_pair + JSON parse + 번역

**Files:**
- Create: `backend/studio/comparison_pipeline.py`
- Test: `backend/tests/studio/test_comparison_pipeline.py` (append)

- [ ] **Step 1: 실패 테스트 — analyze_pair 의 JSON 파싱 / fallback / 번역 실패**

기존 테스트 파일 끝에 append (모듈 import 는 함수 안에서 — 모듈이 아직 없음):

```python
# ───────── comparison_pipeline 코어 ─────────


@pytest.mark.asyncio
async def test_analyze_pair_happy_path() -> None:
    """비전 + 번역 모두 성공 시 ComparisonAnalysisResult 풀로 채워짐."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import analyze_pair

    raw_json = json.dumps({
        "scores": {
            "face_id": 92, "body_pose": 75, "attire": 60,
            "background": 88, "intent_fidelity": 95,
        },
        "comments": {
            "face_id": "Eyes and jaw preserved.",
            "body_pose": "Shoulder slightly narrower.",
            "attire": "Top color changed as requested.",
            "background": "Curtain pattern preserved.",
            "intent_fidelity": "Earrings added accurately.",
        },
        "summary": "Solid result with minor body drift.",
    })
    translated = (
        "[face_id]\n눈과 턱 보존됨.\n\n"
        "[body_pose]\n어깨가 약간 좁아짐.\n\n"
        "[attire]\n상의 색상이 요청대로 변경됨.\n\n"
        "[background]\n커튼 패턴 보존됨.\n\n"
        "[intent_fidelity]\n귀걸이가 정확히 추가됨.\n\n"
        "[summary]\n신원 보존 양호 · 약간의 체형 변화.\n"
    )

    with (
        patch(
            "studio.comparison_pipeline._call_vision_pair",
            new=AsyncMock(return_value=raw_json),
        ),
        patch(
            "studio.comparison_pipeline._translate_comments_to_ko",
            new=AsyncMock(return_value={
                "comments_ko": {
                    "face_id": "눈과 턱 보존됨.",
                    "body_pose": "어깨가 약간 좁아짐.",
                    "attire": "상의 색상이 요청대로 변경됨.",
                    "background": "커튼 패턴 보존됨.",
                    "intent_fidelity": "귀걸이가 정확히 추가됨.",
                },
                "summary_ko": "신원 보존 양호 · 약간의 체형 변화.",
            }),
        ),
    ):
        result = await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="add earrings",
        )
    assert result.fallback is False
    assert result.provider == "ollama"
    assert result.scores["face_id"] == 92
    # 5축 산술 평균 (92+75+60+88+95)/5 = 82
    assert result.overall == 82
    assert "신원 보존" in result.summary_ko


@pytest.mark.asyncio
async def test_analyze_pair_vision_fail_fallback() -> None:
    """비전 호출 실패 (빈 응답) 시 fallback=True · scores 모두 null · 번역 미호출."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import analyze_pair

    translate_mock = AsyncMock(return_value={"comments_ko": {}, "summary_ko": ""})
    with (
        patch(
            "studio.comparison_pipeline._call_vision_pair",
            new=AsyncMock(return_value=""),
        ),
        patch(
            "studio.comparison_pipeline._translate_comments_to_ko",
            new=translate_mock,
        ),
    ):
        result = await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="x",
        )
    assert result.fallback is True
    assert result.provider == "fallback"
    assert all(v is None for v in result.scores.values())
    assert result.overall == 0  # 빈 평균은 0 으로 표기
    translate_mock.assert_not_called()


@pytest.mark.asyncio
async def test_analyze_pair_json_parse_fail_fallback() -> None:
    """비전이 JSON 깨진 응답 → fallback · summary 에 파싱 실패 마커."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import analyze_pair

    with (
        patch(
            "studio.comparison_pipeline._call_vision_pair",
            new=AsyncMock(return_value="{invalid: not json"),
        ),
        patch(
            "studio.comparison_pipeline._translate_comments_to_ko",
            new=AsyncMock(),
        ),
    ):
        result = await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="x",
        )
    assert result.fallback is True
    assert "파싱" in result.summary_ko or "parse" in result.summary_en.lower()


@pytest.mark.asyncio
async def test_analyze_pair_partial_scores_average_only_present() -> None:
    """일부 축 누락 시 null 로 보존 + overall 평균은 받은 점수만으로."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import analyze_pair

    raw_json = json.dumps({
        "scores": {
            "face_id": 80, "body_pose": 60,
            # attire / background / intent_fidelity 누락
        },
        "comments": {"face_id": "ok", "body_pose": "ok"},
        "summary": "Partial result.",
    })
    with (
        patch(
            "studio.comparison_pipeline._call_vision_pair",
            new=AsyncMock(return_value=raw_json),
        ),
        patch(
            "studio.comparison_pipeline._translate_comments_to_ko",
            new=AsyncMock(return_value={
                "comments_ko": {"face_id": "괜찮음", "body_pose": "괜찮음"},
                "summary_ko": "부분 결과.",
            }),
        ),
    ):
        result = await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="x",
        )
    assert result.scores["attire"] is None
    assert result.scores["face_id"] == 80
    # overall = (80+60)/2 = 70
    assert result.overall == 70


@pytest.mark.asyncio
async def test_analyze_pair_translation_fail_keeps_en() -> None:
    """비전 OK · 번역 실패 시 ko 자리에 en 그대로 + summary_ko 에 마커."""
    from unittest.mock import AsyncMock, patch

    from studio.comparison_pipeline import analyze_pair

    raw_json = json.dumps({
        "scores": {"face_id": 90, "body_pose": 80, "attire": 70,
                   "background": 85, "intent_fidelity": 95},
        "comments": {"face_id": "ok", "body_pose": "ok", "attire": "ok",
                     "background": "ok", "intent_fidelity": "ok"},
        "summary": "All good.",
    })
    with (
        patch(
            "studio.comparison_pipeline._call_vision_pair",
            new=AsyncMock(return_value=raw_json),
        ),
        patch(
            "studio.comparison_pipeline._translate_comments_to_ko",
            new=AsyncMock(return_value=None),  # 번역 실패
        ),
    ):
        result = await analyze_pair(
            source_bytes=_tiny_png_bytes(),
            result_bytes=_tiny_png_bytes(),
            edit_prompt="x",
        )
    assert result.fallback is False  # 비전은 살아있음
    assert result.comments_ko["face_id"] == "ok"  # en 그대로
    assert "번역 실패" in result.summary_ko
```

- [ ] **Step 2: 테스트 실행 → FAIL (모듈 없음)**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_comparison_pipeline.py -v -k "analyze_pair"`
Expected: ImportError — `studio.comparison_pipeline` 모듈 없음.

- [ ] **Step 3: comparison_pipeline.py 작성**

`backend/studio/comparison_pipeline.py` 신규 생성:

```python
"""
comparison_pipeline.py - Edit 결과 vs 원본 비교 분석 (qwen2.5vl multi-image).

흐름:
1. SOURCE + RESULT 두 이미지를 qwen2.5vl 에 동시 전달 (Ollama messages.images 배열)
2. SYSTEM_COMPARE 가 5축 점수 (0-100) + 코멘트 + summary 를 STRICT JSON 으로 강제
3. _parse_strict_json() 로 점수/코멘트 추출 (누락 점수는 null 보존)
4. gemma4-un (think:False) 로 5축 코멘트 + summary 를 한 번에 한국어 번역
5. ComparisonAnalysisResult 반환 — fallback 경로도 항상 같은 shape 유지

비전 호출 실패 시 → fallback=True, scores 전부 null, summary 에 사유 명시.
번역만 실패 시 → comments_ko = comments_en (그대로), summary_ko = "한글 번역 실패".
"""

from __future__ import annotations

import base64
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from .presets import DEFAULT_OLLAMA_ROLES
from .prompt_pipeline import _DEFAULT_OLLAMA_URL, DEFAULT_TIMEOUT

log = logging.getLogger(__name__)

# 5축 키 — 순서 고정 (UI 막대 순서와 일치)
AXES: tuple[str, str, str, str, str] = (
    "face_id",
    "body_pose",
    "attire",
    "background",
    "intent_fidelity",
)

# 비전 응답 강제 — STRICT JSON only
SYSTEM_COMPARE = """You are a vision evaluator comparing TWO images of the same scene:
  SOURCE = original image (before user edit)
  RESULT = edited image (after user edit)

The user's edit instruction was: "{edit_prompt}"

Evaluate identity preservation and intent fidelity on FIVE axes.
Score each axis 0-100 (integer):
  - face_id: identity preservation of person's face (eyes, nose, jaw,
    overall facial structure). 100 = identical, 0 = entirely different person.
  - body_pose: body shape, proportions, and pose preservation.
  - attire: clothing/nudity state vs the user's intent. 100 = exactly as
    requested, 0 = entirely opposite to request.
  - background: unintended background changes. 100 = background fully
    preserved, 0 = background completely different.
  - intent_fidelity: how faithfully the result follows the edit prompt.

Write a 1-2 sentence comment per axis (English).
Then write a 3-5 sentence overall summary (English).

Return STRICT JSON only (no markdown, no preamble, no trailing text):
{
  "scores": {
    "face_id": <int>, "body_pose": <int>, "attire": <int>,
    "background": <int>, "intent_fidelity": <int>
  },
  "comments": {
    "face_id": "<en>", "body_pose": "<en>", "attire": "<en>",
    "background": "<en>", "intent_fidelity": "<en>"
  },
  "summary": "<en, 3-5 sentences>"
}"""


@dataclass
class ComparisonAnalysisResult:
    """analyze_pair() 결과 — DB 저장용 dict 와 같은 shape (camelCase 매핑은 호출처)."""

    scores: dict[str, int | None] = field(default_factory=dict)
    overall: int = 0
    comments_en: dict[str, str] = field(default_factory=dict)
    comments_ko: dict[str, str] = field(default_factory=dict)
    summary_en: str = ""
    summary_ko: str = ""
    provider: str = "fallback"  # "ollama" | "fallback"
    fallback: bool = True
    analyzed_at: int = 0
    vision_model: str = ""

    def to_dict(self) -> dict[str, Any]:
        """API 응답 / DB 저장용 직렬화 (camelCase 일부 매핑)."""
        return {
            "scores": self.scores,
            "overall": self.overall,
            "comments_en": self.comments_en,
            "comments_ko": self.comments_ko,
            "summary_en": self.summary_en,
            "summary_ko": self.summary_ko,
            "provider": self.provider,
            "fallback": self.fallback,
            "analyzedAt": self.analyzed_at,
            "visionModel": self.vision_model,
        }


def _empty_scores() -> dict[str, int | None]:
    """fallback 시 모든 축 null 로 초기화."""
    return {k: None for k in AXES}


def _empty_comments() -> dict[str, str]:
    return {k: "" for k in AXES}


def _to_b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


async def _call_vision_pair(
    source_bytes: bytes,
    result_bytes: bytes,
    edit_prompt: str,
    *,
    vision_model: str,
    timeout: float,
    ollama_url: str,
) -> str:
    """qwen2.5vl 에 두 이미지 동시 전달 → raw 응답 문자열.

    실패 시 빈 문자열 반환 (예외는 위로 안 올림 — analyze_pair 가 fallback 처리).
    """
    payload = {
        "model": vision_model,
        "messages": [
            {
                "role": "system",
                "content": SYSTEM_COMPARE.replace("{edit_prompt}", edit_prompt[:400]),
            },
            {
                "role": "user",
                "content": (
                    "Image 1 = SOURCE (original).\n"
                    "Image 2 = RESULT (edited).\n"
                    "Evaluate now. Return STRICT JSON only."
                ),
                "images": [_to_b64(source_bytes), _to_b64(result_bytes)],
            },
        ],
        "stream": False,
        "options": {"temperature": 0.3, "num_ctx": 8192},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(f"{ollama_url}/api/chat", json=payload)
            res.raise_for_status()
            data = res.json()
            return ((data.get("message") or {}).get("content") or "").strip()
    except Exception as e:
        log.warning("compare vision call failed (%s): %s", vision_model, e)
        return ""


def _parse_strict_json(raw: str) -> dict[str, Any] | None:
    """비전 응답에서 첫 번째 JSON object 추출 → dict, 실패 시 None.

    qwen2.5vl 이 가끔 ```json ... ``` 펜스를 둘러 보내서 fence 제거 + 첫 { ... } 매칭.
    """
    if not raw:
        return None
    # ``` 펜스 제거
    cleaned = re.sub(r"```(?:json)?\s*", "", raw, flags=re.IGNORECASE).rstrip("`").strip()
    # 첫 번째 { ... } 매칭 (greedy — 마지막 닫는 } 까지)
    m = re.search(r"\{[\s\S]*\}", cleaned)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _coerce_scores(raw_scores: Any) -> dict[str, int | None]:
    """5축 점수 dict 정규화 — 누락 / 비정수 → None."""
    out: dict[str, int | None] = _empty_scores()
    if not isinstance(raw_scores, dict):
        return out
    for axis in AXES:
        val = raw_scores.get(axis)
        if isinstance(val, bool):  # bool 은 int 의 subclass — 명시 제외
            continue
        if isinstance(val, (int, float)):
            out[axis] = max(0, min(100, int(val)))
    return out


def _coerce_comments(raw_comments: Any) -> dict[str, str]:
    """5축 코멘트 dict 정규화 — 누락 → 빈 문자열."""
    out: dict[str, str] = _empty_comments()
    if not isinstance(raw_comments, dict):
        return out
    for axis in AXES:
        v = raw_comments.get(axis)
        if isinstance(v, str):
            out[axis] = v.strip()
    return out


def _compute_overall(scores: dict[str, int | None]) -> int:
    """5축 산술 평균 — None 제외. 모두 None 이면 0."""
    valid = [v for v in scores.values() if v is not None]
    if not valid:
        return 0
    return round(sum(valid) / len(valid))


# 한국어 번역 묶음 — 5축 코멘트 + summary 를 한 번에 보내고 섹션 헤더로 분리
_TRANSLATE_SYSTEM = """You are a professional Korean translator.
You receive multiple short English texts, each prefixed with [section_name].
Translate each section into natural Korean. Keep the same [section_name]
prefix on each Korean section. Output ONLY the translated sections — no
preamble, no explanation. Use exactly this format:

[section_name]
<korean translation>

[section_name]
<korean translation>
...
"""


async def _translate_comments_to_ko(
    comments_en: dict[str, str],
    summary_en: str,
    *,
    text_model: str,
    timeout: float,
    ollama_url: str,
) -> dict[str, Any] | None:
    """5축 코멘트 + summary 를 한 호출로 번역. 실패 시 None.

    Returns:
        {"comments_ko": {axis: ko_text, ...}, "summary_ko": str} or None
    """
    sections: list[str] = []
    for axis in AXES:
        text = comments_en.get(axis, "").strip()
        if text:
            sections.append(f"[{axis}]\n{text}")
    if summary_en.strip():
        sections.append(f"[summary]\n{summary_en.strip()}")
    if not sections:
        return None

    user_msg = "\n\n".join(sections)
    payload = {
        "model": text_model,
        "messages": [
            {"role": "system", "content": _TRANSLATE_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        "stream": False,
        # gemma4-un thinking 모델 — content 비는 이슈 회피 (CLAUDE.md 규칙)
        "think": False,
        "options": {"temperature": 0.4, "num_ctx": 4096, "num_predict": 800},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(f"{ollama_url}/api/chat", json=payload)
            res.raise_for_status()
            data = res.json()
            raw = ((data.get("message") or {}).get("content") or "").strip()
        if not raw:
            return None
    except Exception as e:
        log.info("compare translation failed (non-fatal): %s", e)
        return None

    # 섹션 파싱 — [axis_name] 패턴으로 split
    sections_ko = re.split(r"\[([a-z_]+)\]\s*", raw)
    # split 결과: ["", "axis1", "text1", "axis2", "text2", ...]
    comments_ko: dict[str, str] = {}
    summary_ko = ""
    for i in range(1, len(sections_ko) - 1, 2):
        key = sections_ko[i].strip()
        val = sections_ko[i + 1].strip()
        if key == "summary":
            summary_ko = val
        elif key in AXES:
            comments_ko[key] = val
    return {"comments_ko": comments_ko, "summary_ko": summary_ko}


async def analyze_pair(
    source_bytes: bytes,
    result_bytes: bytes,
    edit_prompt: str,
    *,
    vision_model: str | None = None,
    text_model: str | None = None,
    ollama_url: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> ComparisonAnalysisResult:
    """SOURCE + RESULT 비교 분석 (HTTP 200 원칙 — 항상 결과 dataclass 반환).

    Args:
        source_bytes / result_bytes: PIL 로 읽기 가능한 이미지 바이트
        edit_prompt: 사용자가 친 수정 지시 (시스템 프롬프트에 주입)
        vision_model: 기본 settings.visionModel (qwen2.5vl:7b)
        text_model: 번역용 (기본 gemma4-un:latest)
    """
    resolved_vision = vision_model or DEFAULT_OLLAMA_ROLES.vision
    resolved_text = text_model or DEFAULT_OLLAMA_ROLES.text
    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL

    raw = await _call_vision_pair(
        source_bytes,
        result_bytes,
        edit_prompt,
        vision_model=resolved_vision,
        timeout=timeout,
        ollama_url=resolved_url,
    )
    if not raw:
        return ComparisonAnalysisResult(
            scores=_empty_scores(),
            comments_en=_empty_comments(),
            comments_ko=_empty_comments(),
            summary_en="Vision model unavailable.",
            summary_ko="비전 모델 응답 없음.",
            provider="fallback",
            fallback=True,
            analyzed_at=int(time.time() * 1000),
            vision_model=resolved_vision,
        )

    parsed = _parse_strict_json(raw)
    if parsed is None:
        log.warning("compare JSON parse failed; raw head: %s", raw[:200])
        return ComparisonAnalysisResult(
            scores=_empty_scores(),
            comments_en=_empty_comments(),
            comments_ko=_empty_comments(),
            summary_en="Vision response parse failed.",
            summary_ko="비전 응답 파싱 실패.",
            provider="fallback",
            fallback=True,
            analyzed_at=int(time.time() * 1000),
            vision_model=resolved_vision,
        )

    scores = _coerce_scores(parsed.get("scores"))
    comments_en = _coerce_comments(parsed.get("comments"))
    summary_en = (parsed.get("summary") or "").strip() if isinstance(parsed.get("summary"), str) else ""
    overall = _compute_overall(scores)

    # 번역 — 실패해도 en 은 살아남음
    translation = await _translate_comments_to_ko(
        comments_en,
        summary_en,
        text_model=resolved_text,
        timeout=60.0,
        ollama_url=resolved_url,
    )
    if translation is None:
        comments_ko = dict(comments_en)  # en 그대로
        summary_ko = "한글 번역 실패"
    else:
        # 번역 누락된 축은 en 으로 폴백
        comments_ko = {
            axis: translation["comments_ko"].get(axis) or comments_en.get(axis, "")
            for axis in AXES
        }
        summary_ko = translation["summary_ko"] or summary_en

    return ComparisonAnalysisResult(
        scores=scores,
        overall=overall,
        comments_en=comments_en,
        comments_ko=comments_ko,
        summary_en=summary_en,
        summary_ko=summary_ko,
        provider="ollama",
        fallback=False,
        analyzed_at=int(time.time() * 1000),
        vision_model=resolved_vision,
    )
```

- [ ] **Step 4: 테스트 재실행 → PASS**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_comparison_pipeline.py -v -k "analyze_pair"`
Expected: 5건 모두 PASS.

- [ ] **Step 5: 회귀 검증**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/`
Expected: 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
git add backend/studio/comparison_pipeline.py backend/tests/studio/test_comparison_pipeline.py
git commit -m "$(cat <<'EOF'
feat(studio): comparison_pipeline — qwen2.5vl 5축 비교 평가

- SYSTEM_COMPARE: STRICT JSON 강제 + 5축 점수+코멘트+summary
- analyze_pair(): multi-image 호출 → JSON parse → 한글 번역 → fallback 보장
- _parse_strict_json: ``` fence + 첫 {} 매칭으로 견고 파싱
- _coerce_scores/_coerce_comments: 누락/비정수 → null 정규화
- _translate_comments_to_ko: 5축 + summary 한 호출 묶음 (think:False)
- _compute_overall: null 제외 산술 평균

테스트 5건 (happy / vision fail / parse fail / partial scores / 번역 fail)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: /edit 엔드포인트에 source 디스크 영구 저장

**Files:**
- Modify: `backend/studio/router.py`
- Test: `backend/tests/studio/test_comparison_pipeline.py` (append)

- [ ] **Step 1: 실패 테스트 — /edit 응답 후 sourceRef 가 채워지고 디스크에 파일 존재**

기존 테스트 파일 끝에 append:

```python
# ───────── /edit source 영구 저장 ─────────


@pytest.mark.asyncio
async def test_edit_persists_source_to_disk(monkeypatch, tmp_path: Path) -> None:
    """/edit 호출 시 source 가 STUDIO_OUTPUT_DIR/edit-source/{id}.png 로 저장되고
    history 에 sourceRef 가 기입된다."""
    from unittest.mock import AsyncMock, patch

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio import history_db, router as studio_router

    # 임시 STUDIO_OUTPUT_DIR
    out_dir = tmp_path / "studio-out"
    out_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(studio_router, "STUDIO_OUTPUT_DIR", out_dir)
    # 임시 DB
    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    # ComfyUI 디스패치는 mock-fallback 으로 우회
    async def fake_dispatch(*args, **kwargs):
        from studio.router import ComfyDispatchResult
        return ComfyDispatchResult(
            image_ref="mock-seed://test",
            width=1024, height=1024, comfy_error=None,
        )

    fake_vision_result = type("V", (), {
        "image_description": "x",
        "final_prompt": "x",
        "vision_ok": True,
        "upgrade": type("U", (), {
            "translation": "x",
            "provider": "ollama",
        })(),
    })()

    with (
        patch.object(studio_router, "_dispatch_to_comfy", new=AsyncMock(side_effect=fake_dispatch)),
        patch.object(studio_router, "run_vision_pipeline", new=AsyncMock(return_value=fake_vision_result)),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as cli:
            res = await cli.post(
                "/api/studio/edit",
                files={"image": ("src.png", _tiny_png_bytes(), "image/png")},
                data={"meta": json.dumps({"prompt": "make it blue", "lightning": True})},
            )
            assert res.status_code == 200
            task_id = res.json()["task_id"]
            # SSE 스트림 소비 — done 이벤트까지 대기
            stream_url = res.json()["stream_url"]
            done_item = None
            async with cli.stream("GET", stream_url) as sr:
                async for line in sr.aiter_lines():
                    if line.startswith("event: done"):
                        # 다음 줄이 data: ...
                        pass
                    elif line.startswith("data:") and "\"item\"" in line:
                        payload = json.loads(line[5:].strip())
                        if "item" in payload:
                            done_item = payload["item"]
                            break

    assert done_item is not None
    assert done_item.get("sourceRef", "").startswith("/images/studio/edit-source/")
    # 디스크에 파일 존재
    rel = done_item["sourceRef"].replace("/images/studio/", "")
    assert (out_dir / rel).exists()
```

- [ ] **Step 2: 테스트 실행 → FAIL**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_comparison_pipeline.py -v -k "edit_persists_source"`
Expected: FAIL — sourceRef 가 응답에 없음.

- [ ] **Step 3: router.py 수정 — _run_edit_pipeline 에 source 저장 로직 추가**

`backend/studio/router.py` 의 `STUDIO_OUTPUT_DIR.mkdir(...)` 직후 (91줄 근처) 에 source 디렉토리 상수 추가:

```python
EDIT_SOURCE_DIR = STUDIO_OUTPUT_DIR / "edit-source"
EDIT_SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EDIT_SOURCE_URL_PREFIX = f"{STUDIO_URL_PREFIX}/edit-source"

# task_id 검증 정규식 — path traversal 방지 (CLAUDE.md 규칙)
_TASK_ID_RE = re.compile(r"^tsk-[0-9a-f]{12}$")
```

상단 import 에 `re` 추가 (이미 없으면) — 줄 30 근처:

```python
import re
```

`_run_edit_pipeline` 내부에서 `item = { ... }` 만들기 직전 에 source 저장 블록 추가 (881줄 근처, dispatch 끝나고 step 4 done 직후):

```python
        # ── source 영구 저장 (비교 분석용) ──
        # task.task_id 형식 (tsk-xxxxxxxxxxxx) 보장 — 이미 _new_task 에서 생성한 값.
        source_ref: str | None = None
        if _TASK_ID_RE.match(task.task_id):
            source_path = EDIT_SOURCE_DIR / f"{task.task_id}.png"
            try:
                # PIL 로 RGB 변환 후 PNG 로 저장 (JPG 입력도 무손실 PNG 로 통일)
                with Image.open(io.BytesIO(image_bytes)) as src_im:
                    src_im.convert("RGB").save(source_path, "PNG")
                source_ref = f"{EDIT_SOURCE_URL_PREFIX}/{task.task_id}.png"
            except Exception as src_err:
                log.warning(
                    "edit source persist failed (non-fatal): %s", src_err
                )
                # 결과는 그대로 살리고 sourceRef=None 으로 진행
```

`item = { ... }` 의 마지막 필드들 다음에 `"id": ..., "sourceRef": source_ref,` 추가 — 단, item.id 는 별도 uuid (`f"edit-{uuid.uuid4().hex[:8]}"`) 라 다름. **sourceRef 의 파일명은 task.task_id 기준** 이라 별도 키 사용. 단, item.id 가 디스크 파일명과 다르면 옛 row 비교가 어려워짐 → item.id 자체를 task.task_id 와 동일하게 변경하면 깔끔함.

여기선 구조 변경 부담 줄이기 위해 **파일명 = task.task_id 유지 + sourceRef URL 만 item 에 매핑** (item.id 는 기존 그대로 `edit-xxxxxxxx`).

```python
        item = {
            "id": f"edit-{uuid.uuid4().hex[:8]}",
            "mode": "edit",
            ...
            "comfyError": comfy_err,
            "sourceRef": source_ref,
        }
```

- [ ] **Step 4: 테스트 재실행 → PASS**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_comparison_pipeline.py -v -k "edit_persists_source"`
Expected: PASS.

- [ ] **Step 5: 회귀 검증**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/`
Expected: 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
git add backend/studio/router.py backend/tests/studio/test_comparison_pipeline.py
git commit -m "$(cat <<'EOF'
feat(edit): source 이미지 영구 저장 (비교 분석 인프라)

- EDIT_SOURCE_DIR/edit-source/{task_id}.png 로 PIL convert("RGB") + PNG
- task_id 정규식 화이트리스트 (path traversal 방지 — CLAUDE.md)
- 저장 실패는 non-fatal · sourceRef=None · 결과는 정상 진행
- _run_edit_pipeline 의 item 응답에 sourceRef 필드 추가

비교 분석 기능에서 history 그리드 재클릭 시 원본 복원에 사용.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: /api/studio/compare-analyze 엔드포인트

**Files:**
- Modify: `backend/studio/router.py`
- Test: `backend/tests/studio/test_comparison_pipeline.py` (append)

- [ ] **Step 1: 실패 테스트 — POST /compare-analyze multipart 정상 / unknown id / 빈 이미지**

기존 테스트 파일 끝에 append:

```python
# ───────── /compare-analyze 라우트 ─────────


@pytest.mark.asyncio
async def test_compare_analyze_route_happy_path(monkeypatch, tmp_path: Path) -> None:
    """multipart source+result+meta → analysis 응답 + saved=False (no historyItemId)."""
    from unittest.mock import AsyncMock, patch

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio.comparison_pipeline import ComparisonAnalysisResult

    fake = ComparisonAnalysisResult(
        scores={k: 80 for k in ("face_id","body_pose","attire","background","intent_fidelity")},
        overall=80,
        comments_en={k: "ok" for k in ("face_id","body_pose","attire","background","intent_fidelity")},
        comments_ko={k: "괜찮음" for k in ("face_id","body_pose","attire","background","intent_fidelity")},
        summary_en="All good.",
        summary_ko="전반적으로 양호.",
        provider="ollama",
        fallback=False,
        analyzed_at=1700000000000,
        vision_model="qwen2.5vl:7b",
    )

    with patch(
        "studio.router.analyze_pair",
        new=AsyncMock(return_value=fake),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as cli:
            res = await cli.post(
                "/api/studio/compare-analyze",
                files={
                    "source": ("s.png", _tiny_png_bytes(), "image/png"),
                    "result": ("r.png", _tiny_png_bytes(), "image/png"),
                },
                data={"meta": json.dumps({"editPrompt": "add earrings"})},
            )
    assert res.status_code == 200
    body = res.json()
    assert body["analysis"]["overall"] == 80
    assert body["saved"] is False  # historyItemId 없음


@pytest.mark.asyncio
async def test_compare_analyze_persists_when_history_id_given(
    monkeypatch, tmp_path: Path
) -> None:
    """historyItemId 가 DB 에 존재하면 update_comparison 호출 + saved=True."""
    from unittest.mock import AsyncMock, patch

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio import history_db
    from studio.comparison_pipeline import ComparisonAnalysisResult

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()
    # 사전 row 삽입
    await history_db.insert_item({
        "id": "tsk-aaaaaaaaaaaa",
        "mode": "edit",
        "prompt": "x", "label": "x",
        "width": 1024, "height": 1024, "seed": 1,
        "steps": 4, "cfg": 1.0, "lightning": True,
        "model": "qwen-image-edit-2511",
        "createdAt": 1700000000000,
        "imageRef": "/images/studio/r.png",
    })

    fake = ComparisonAnalysisResult(
        scores={k: 70 for k in ("face_id","body_pose","attire","background","intent_fidelity")},
        overall=70, comments_en={}, comments_ko={},
        summary_en="ok", summary_ko="좋음",
        provider="ollama", fallback=False,
        analyzed_at=1700000000000, vision_model="qwen2.5vl:7b",
    )

    with patch(
        "studio.router.analyze_pair", new=AsyncMock(return_value=fake),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as cli:
            res = await cli.post(
                "/api/studio/compare-analyze",
                files={
                    "source": ("s.png", _tiny_png_bytes(), "image/png"),
                    "result": ("r.png", _tiny_png_bytes(), "image/png"),
                },
                data={"meta": json.dumps({
                    "editPrompt": "x",
                    "historyItemId": "tsk-aaaaaaaaaaaa",
                })},
            )
    assert res.status_code == 200
    body = res.json()
    assert body["saved"] is True

    fetched = await history_db.get_item("tsk-aaaaaaaaaaaa")
    assert fetched["comparisonAnalysis"]["overall"] == 70


@pytest.mark.asyncio
async def test_compare_analyze_unknown_history_id_saved_false(
    monkeypatch, tmp_path: Path
) -> None:
    """historyItemId 가 DB 에 없으면 saved=False, 분석은 정상 응답."""
    from unittest.mock import AsyncMock, patch

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio import history_db
    from studio.comparison_pipeline import ComparisonAnalysisResult

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    fake = ComparisonAnalysisResult(
        scores={k: None for k in ("face_id","body_pose","attire","background","intent_fidelity")},
        overall=0, comments_en={}, comments_ko={},
        summary_en="x", summary_ko="x",
        provider="fallback", fallback=True,
        analyzed_at=0, vision_model="qwen2.5vl:7b",
    )

    with patch("studio.router.analyze_pair", new=AsyncMock(return_value=fake)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as cli:
            res = await cli.post(
                "/api/studio/compare-analyze",
                files={
                    "source": ("s.png", _tiny_png_bytes(), "image/png"),
                    "result": ("r.png", _tiny_png_bytes(), "image/png"),
                },
                data={"meta": json.dumps({
                    "editPrompt": "x",
                    "historyItemId": "tsk-doesnotexist",
                })},
            )
    assert res.status_code == 200
    assert res.json()["saved"] is False


@pytest.mark.asyncio
async def test_compare_analyze_empty_source_400(monkeypatch, tmp_path: Path) -> None:
    """source 파일 비어있으면 400."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as cli:
        res = await cli.post(
            "/api/studio/compare-analyze",
            files={
                "source": ("s.png", b"", "image/png"),
                "result": ("r.png", _tiny_png_bytes(), "image/png"),
            },
            data={"meta": json.dumps({"editPrompt": "x"})},
        )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_compare_analyze_invalid_meta_400(monkeypatch) -> None:
    """meta JSON 깨짐 400."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as cli:
        res = await cli.post(
            "/api/studio/compare-analyze",
            files={
                "source": ("s.png", _tiny_png_bytes(), "image/png"),
                "result": ("r.png", _tiny_png_bytes(), "image/png"),
            },
            data={"meta": "{not json"},
        )
    assert res.status_code == 400
```

- [ ] **Step 2: 테스트 실행 → FAIL**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_comparison_pipeline.py -v -k "compare_analyze"`
Expected: FAIL — 라우트 없음 (404).

- [ ] **Step 3: router.py 에 엔드포인트 + mutex 추가**

`backend/studio/router.py` 상단 import 블록에 추가:

```python
from .comparison_pipeline import analyze_pair
```

파일 어디든 (예: vision-analyze 라우트 다음, 1304줄 근처) 에 라우트 + mutex 추가:

```python
# ─────────────────────────────────────────────
# Compare Analyze (Edit 결과 vs 원본 5축 평가)
# ─────────────────────────────────────────────


# ComfyUI 샘플링과 직렬화하기 위한 mutex — vision 호출이 ComfyUI 와 동시 활성 시
# VRAM 충돌 방지. 30s 대기 후에도 안 풀리면 503.
_COMPARE_LOCK = asyncio.Lock()
_COMPARE_LOCK_TIMEOUT_SEC = 30.0
_COMPARE_MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB (Edit 와 동일)


@router.post("/compare-analyze")
async def compare_analyze(
    source: UploadFile = File(...),
    result: UploadFile = File(...),
    meta: str = Form(...),
):
    """Edit 결과(result) 와 원본(source) 을 qwen2.5vl 로 5축 비교 평가.

    multipart:
      source: 원본 이미지 파일
      result: 수정 결과 이미지 파일
      meta: JSON {editPrompt, historyItemId?, visionModel?, ollamaModel?}

    historyItemId 가 주어지면 분석 결과를 DB 에 영구 저장 (saved=True).
    HTTP 200 원칙 — 비전 실패해도 fallback 결과로 200 반환.
    """
    try:
        meta_obj = json.loads(meta)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"meta JSON invalid: {e}") from e

    edit_prompt = (meta_obj.get("editPrompt") or "").strip()
    history_item_id_raw = meta_obj.get("historyItemId")
    vision_override = meta_obj.get("visionModel") or meta_obj.get("vision_model")
    text_override = meta_obj.get("ollamaModel") or meta_obj.get("ollama_model")

    source_bytes = await source.read()
    result_bytes = await result.read()
    if not source_bytes or not result_bytes:
        raise HTTPException(400, "empty image (source or result)")
    if (
        len(source_bytes) > _COMPARE_MAX_IMAGE_BYTES
        or len(result_bytes) > _COMPARE_MAX_IMAGE_BYTES
    ):
        raise HTTPException(413, "image too large")

    # mutex — ComfyUI 샘플링과 충돌 회피용 직렬화. 30s 대기 후에도 락이면 503.
    try:
        await asyncio.wait_for(
            _COMPARE_LOCK.acquire(), timeout=_COMPARE_LOCK_TIMEOUT_SEC
        )
    except asyncio.TimeoutError as e:
        raise HTTPException(503, "compare-analyze busy (locked > 30s)") from e

    try:
        result_obj = await analyze_pair(
            source_bytes=source_bytes,
            result_bytes=result_bytes,
            edit_prompt=edit_prompt,
            vision_model=vision_override,
            text_model=text_override,
        )
    finally:
        _COMPARE_LOCK.release()

    # historyItemId 가 _TASK_ID_RE 매치 + DB 에 존재할 때만 저장
    saved = False
    if isinstance(history_item_id_raw, str) and _TASK_ID_RE.match(history_item_id_raw):
        try:
            saved = await history_db.update_comparison(
                history_item_id_raw, result_obj.to_dict()
            )
        except Exception as db_err:
            log.warning("compare-analyze DB persist failed: %s", db_err)
            saved = False

    return {"analysis": result_obj.to_dict(), "saved": saved}
```

**참고:** `_TASK_ID_RE` 는 Task 5 에서 이미 모듈 상단에 정의됨. `history_db` 는 이미 import 됨.

- [ ] **Step 4: 테스트 재실행 → PASS**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_comparison_pipeline.py -v -k "compare_analyze"`
Expected: 5건 모두 PASS.

- [ ] **Step 5: 회귀 검증**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/`
Expected: 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
git add backend/studio/router.py backend/tests/studio/test_comparison_pipeline.py
git commit -m "$(cat <<'EOF'
feat(api): POST /api/studio/compare-analyze 엔드포인트

- multipart source+result+meta → analyze_pair → analysis JSON 응답
- historyItemId 가 _TASK_ID_RE 매치 + DB 존재 시 update_comparison 호출
- _COMPARE_LOCK (asyncio.Lock + 30s wait) 로 ComfyUI 샘플링과 직렬화
- HTTP 200 원칙: 비전 실패해도 fallback 결과로 200
- 20MB 상한 + 빈 파일 400 + meta JSON 깨짐 400

테스트 5건 (happy / persisted / unknown id / empty source / invalid meta)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 프론트 lib/api/compare.ts (compareAnalyze 호출)

**Files:**
- Create: `frontend/lib/api/compare.ts`
- Modify: `frontend/lib/api-client.ts`

- [ ] **Step 1: compare.ts 신규 작성**

`frontend/lib/api/compare.ts`:

```ts
/**
 * lib/api/compare.ts — Edit 결과 ↔ 원본 비교 분석 호출.
 * 백엔드 POST /api/studio/compare-analyze 래퍼.
 *
 * USE_MOCK 모드에선 sleep 후 가짜 ComparisonAnalysis 반환 (UI 개발용).
 */

import { STUDIO_BASE, USE_MOCK, sleep } from "./client";
import type { ComparisonAnalysis } from "./types";

export interface CompareAnalyzeRequest {
  /** 원본 이미지 — File / data URL / 절대 URL */
  source: File | string;
  /** 수정 결과 이미지 — File / data URL / 절대 URL */
  result: File | string;
  /** 사용자가 친 수정 지시 (시스템 프롬프트 컨텍스트). */
  editPrompt: string;
  /** 있으면 백엔드가 DB 에 영구 저장. tsk-{12hex} 형식. */
  historyItemId?: string;
  /** 비전 모델 override (기본 settings.visionModel). */
  visionModel?: string;
  /** 번역 모델 override (기본 settings.ollamaModel). */
  ollamaModel?: string;
}

export interface CompareAnalyzeResponse {
  analysis: ComparisonAnalysis;
  /** historyItemId 가 DB 에 존재하고 갱신 성공 시 true. */
  saved: boolean;
}

/** File / data URL / 절대 URL → Blob 변환 (Edit 의 패턴 동일). */
async function toBlob(input: File | string): Promise<Blob> {
  if (input instanceof File) return input;
  const res = await fetch(input);
  if (!res.ok) {
    throw new Error(`image fetch ${res.status}: ${input.slice(0, 80)}`);
  }
  return res.blob();
}

export async function compareAnalyze(
  req: CompareAnalyzeRequest,
): Promise<CompareAnalyzeResponse> {
  if (USE_MOCK) {
    await sleep(800 + Math.random() * 600);
    return {
      analysis: {
        scores: {
          face_id: 92, body_pose: 75, attire: 60,
          background: 88, intent_fidelity: 95,
        },
        overall: 82,
        comments_en: {
          face_id: "Eyes and jaw preserved.",
          body_pose: "Shoulder slightly narrower.",
          attire: "Top color changed as requested.",
          background: "Curtain pattern preserved.",
          intent_fidelity: "Earrings added accurately.",
        },
        comments_ko: {
          face_id: "눈과 턱 보존됨.",
          body_pose: "어깨가 약간 좁아짐.",
          attire: "상의 색상이 요청대로 변경됨.",
          background: "커튼 패턴 보존됨.",
          intent_fidelity: "귀걸이가 정확히 추가됨.",
        },
        summary_en: "Solid result with minor body drift.",
        summary_ko: "신원 보존 양호 · 약간의 체형 변화.",
        provider: "ollama",
        fallback: false,
        analyzedAt: Date.now(),
        visionModel: req.visionModel || "qwen2.5vl:7b",
      },
      saved: !!req.historyItemId,
    };
  }

  const form = new FormData();
  const sourceBlob = await toBlob(req.source);
  const resultBlob = await toBlob(req.result);
  form.append("source", sourceBlob, "source.png");
  form.append("result", resultBlob, "result.png");
  form.append(
    "meta",
    JSON.stringify({
      editPrompt: req.editPrompt,
      historyItemId: req.historyItemId,
      visionModel: req.visionModel,
      ollamaModel: req.ollamaModel,
    }),
  );

  const res = await fetch(`${STUDIO_BASE}/api/studio/compare-analyze`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`compare-analyze failed: ${res.status}`);
  }
  // 백엔드가 신뢰 X — 최소 shape 검증 후 반환 (codex 1차 리뷰 교훈)
  const json = (await res.json()) as Partial<CompareAnalyzeResponse>;
  if (!json.analysis || typeof json.analysis !== "object") {
    throw new Error("compare-analyze: malformed response");
  }
  return {
    analysis: json.analysis as ComparisonAnalysis,
    saved: !!json.saved,
  };
}
```

- [ ] **Step 2: api-client.ts barrel 에 re-export 추가**

`frontend/lib/api-client.ts` 의 마지막 export 블록에 추가:

```ts
export {
  compareAnalyze,
  type CompareAnalyzeRequest,
  type CompareAnalyzeResponse,
} from "./api/compare";
```

- [ ] **Step 3: tsc / lint 통과 확인**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: exit 0.

- [ ] **Step 4: 커밋**

```bash
git add frontend/lib/api/compare.ts frontend/lib/api-client.ts
git commit -m "$(cat <<'EOF'
feat(api): compareAnalyze() — /api/studio/compare-analyze 호출 래퍼

- File/data URL/절대 URL 모두 toBlob 으로 통일
- USE_MOCK: 800-1400ms sleep 후 가짜 ComparisonAnalysis 반환 (UI 개발용)
- 응답 shape 최소 검증 (analysis 필드 존재) — 백엔드 신뢰 X
- api-client barrel 에 re-export

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: ComparisonAnalysisCard 컴포넌트 (인라인 4-state)

**Files:**
- Create: `frontend/components/studio/ComparisonAnalysisCard.tsx`

- [ ] **Step 1: 컴포넌트 신규 작성**

`frontend/components/studio/ComparisonAnalysisCard.tsx`:

```tsx
/**
 * ComparisonAnalysisCard - 비교 분석 결과 인라인 카드 (4-state).
 *
 * State:
 *  - empty    : sourceRef 있고 분석 안 함 → "분석" 버튼만
 *  - loading  : 분석 중 → 스피너 + 라벨
 *  - filled   : 분석 완료 → 종합 % + 5축 dot + [자세히] [재분석]
 *  - disabled : sourceRef 없음 → "분석 불가" 안내 (옛 row)
 *
 * /edit 페이지 Before/After 슬라이더 아래 + ImageLightbox 메타 패널 안에서 재사용.
 * 클릭 시 ComparisonAnalysisModal 오픈은 부모가 관리 (onOpenDetail).
 */

"use client";

import type { CSSProperties } from "react";
import Icon from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/primitives";
import type { ComparisonAnalysis, HistoryItem } from "@/lib/api-client";

export interface Props {
  item: HistoryItem;
  /** 분석 진행 중 여부 (useComparisonAnalysis 훅이 관리). */
  busy: boolean;
  /** 분석 트리거 (수동 클릭). */
  onAnalyze: () => void;
  /** "자세히" 클릭 → 모달 오픈. analysis 있을 때만 호출됨. */
  onOpenDetail: (analysis: ComparisonAnalysis) => void;
  /** "재분석" 클릭. analysis 있을 때만 호출됨. */
  onReanalyze: () => void;
}

export default function ComparisonAnalysisCard({
  item,
  busy,
  onAnalyze,
  onOpenDetail,
  onReanalyze,
}: Props) {
  const analysis = item.comparisonAnalysis;
  const hasSource = !!item.sourceRef;

  // disabled — 옛 row · sourceRef 없음
  if (!hasSource) {
    return (
      <CardShell>
        <span style={{ fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.5 }}>
          🔍 분석 불가 · 원본 이미지가 저장돼 있지 않은 옛 항목입니다
        </span>
      </CardShell>
    );
  }

  // loading
  if (busy) {
    return (
      <CardShell>
        <Spinner />
        <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
          분석 중… qwen2.5vl 5-10초
        </span>
      </CardShell>
    );
  }

  // empty — sourceRef 있음 + 분석 안 함
  if (!analysis) {
    return (
      <CardShell>
        <Icon name="search" size={13} style={{ color: "var(--ink-3)" }} />
        <span style={{ fontSize: 12, color: "var(--ink-3)", flex: 1 }}>
          비교 분석
        </span>
        <button
          type="button"
          onClick={onAnalyze}
          style={btnStyle("primary")}
        >
          분석
        </button>
      </CardShell>
    );
  }

  // filled — 분석 결과 있음
  return (
    <CardShell>
      <Icon name="search" size={13} style={{ color: "var(--ink-3)" }} />
      <Dot score={analysis.overall} />
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>
        {analysis.overall}% match
      </span>
      <span style={{ fontSize: 11, color: "var(--ink-4)" }}>·</span>
      <AxisDot label="얼굴" v={analysis.scores.face_id} />
      <AxisDot label="체형" v={analysis.scores.body_pose} />
      <AxisDot label="의상" v={analysis.scores.attire} />
      <span style={{ flex: 1 }} />
      <button
        type="button"
        onClick={() => onOpenDetail(analysis)}
        style={btnStyle("secondary")}
      >
        자세히
      </button>
      <button
        type="button"
        onClick={onReanalyze}
        style={btnStyle("ghost")}
        title="재분석"
      >
        <Icon name="refresh" size={11} />
      </button>
    </CardShell>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        boxShadow: "var(--shadow-sm)",
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}

function scoreColor(score: number | null): string {
  if (score == null) return "var(--ink-4)";
  if (score >= 80) return "var(--green-ink, #2f8a3a)";
  if (score >= 50) return "var(--amber-ink, #b8860b)";
  return "var(--red-ink, #c0392b)";
}

function Dot({ score }: { score: number | null }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: scoreColor(score),
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,.1)",
      }}
    />
  );
}

function AxisDot({ label, v }: { label: string; v: number | null }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        color: "var(--ink-3)",
      }}
    >
      {label}
      <Dot score={v} />
      <span className="mono" style={{ fontSize: 10.5, color: scoreColor(v) }}>
        {v ?? "—"}
      </span>
    </span>
  );
}

function btnStyle(kind: "primary" | "secondary" | "ghost"): CSSProperties {
  const base: CSSProperties = {
    all: "unset",
    cursor: "pointer",
    fontSize: 11,
    padding: "4px 10px",
    borderRadius: 6,
    transition: "background .12s",
  };
  if (kind === "primary") {
    return {
      ...base,
      background: "var(--accent)",
      color: "#fff",
      fontWeight: 600,
    };
  }
  if (kind === "secondary") {
    return {
      ...base,
      background: "var(--bg-2)",
      color: "var(--ink-2)",
      border: "1px solid var(--line)",
    };
  }
  // ghost
  return {
    ...base,
    background: "transparent",
    color: "var(--ink-3)",
    padding: "4px 6px",
  };
}
```

- [ ] **Step 2: tsc / lint 통과 확인**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: exit 0.

- [ ] **Step 3: 커밋**

```bash
git add frontend/components/studio/ComparisonAnalysisCard.tsx
git commit -m "$(cat <<'EOF'
feat(studio): ComparisonAnalysisCard — 4-state 인라인 카드

- empty    : sourceRef 있음 + 분석 X → [분석] 버튼
- loading  : 분석 중 → 스피너 + 라벨
- filled   : overall % + 5축 중 3개 축 dot + [자세히] [재분석]
- disabled : sourceRef 없음 → "분석 불가" 안내

색상 임계 ≥80 녹 / 50-79 노 / <50 적 (디자인 토큰 재사용).
부모가 onAnalyze / onOpenDetail / onReanalyze / busy 관리.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: ComparisonAnalysisModal 컴포넌트 (5축 막대 + 영/한 토글)

**Files:**
- Create: `frontend/components/studio/ComparisonAnalysisModal.tsx`

- [ ] **Step 1: 컴포넌트 신규 작성**

`frontend/components/studio/ComparisonAnalysisModal.tsx`:

```tsx
/**
 * ComparisonAnalysisModal - "자세히" 클릭 시 오픈되는 5축 비교 분석 상세 모달.
 *
 * 구조:
 *  - 헤더: 비전 모델 + 분석 시각
 *  - 종합 매치율 (큰 dot + %)
 *  - 5축 막대 (점수 + 색상)
 *  - 항목별 코멘트 (영/한 토글) — vision-analyzer 패턴 동일
 *  - 종합 (영/한 토글)
 *
 * Lightbox 위에 띄울 수 있도록 z-index 80 (Lightbox 70 + 1).
 */

"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import type {
  ComparisonAnalysis,
  ComparisonScores,
  HistoryItem,
} from "@/lib/api-client";

const AXIS_LABELS: { key: keyof ComparisonScores; label: string }[] = [
  { key: "face_id", label: "얼굴 ID" },
  { key: "body_pose", label: "체형/포즈" },
  { key: "attire", label: "의상/누드 상태" },
  { key: "background", label: "배경 보존" },
  { key: "intent_fidelity", label: "의도 충실도" },
];

interface Props {
  item: HistoryItem;
  analysis: ComparisonAnalysis;
  onClose: () => void;
}

export default function ComparisonAnalysisModal({
  item,
  analysis,
  onClose,
}: Props) {
  const [lang, setLang] = useState<"en" | "ko">("ko");
  const comments = lang === "ko" ? analysis.comments_ko : analysis.comments_en;
  const summary = lang === "ko" ? analysis.summary_ko : analysis.summary_en;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="비교 분석 상세"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(8,8,10,.72)",
        display: "grid",
        placeItems: "center",
        animation: "fade-in .14s ease",
      }}
    >
      <div
        style={{
          width: "min(640px, 92vw)",
          maxHeight: "88vh",
          overflowY: "auto",
          background: "var(--bg)",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,.4)",
          border: "1px solid var(--line)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink)",
              }}
            >
              비교 분석
            </div>
            <div
              className="mono"
              style={{
                fontSize: 10.5,
                color: "var(--ink-4)",
                marginTop: 2,
              }}
            >
              {analysis.visionModel} ·{" "}
              {new Date(analysis.analyzedAt).toLocaleString("ko-KR", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {analysis.fallback && (
                <span style={{ color: "var(--amber-ink)", marginLeft: 6 }}>
                  · fallback
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              all: "unset",
              cursor: "pointer",
              padding: 6,
              borderRadius: 6,
              color: "var(--ink-3)",
            }}
            title="닫기"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Overall */}
        <div
          style={{
            padding: "18px 18px 6px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <ScoreDot score={analysis.overall} size={20} />
          <div>
            <div style={{ fontSize: 11, color: "var(--ink-4)" }}>
              종합 매치율
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: scoreColor(analysis.overall),
              }}
            >
              {analysis.overall}%
            </div>
          </div>
        </div>

        {/* 5축 막대 */}
        <div style={{ padding: "10px 18px 6px" }}>
          {AXIS_LABELS.map(({ key, label }) => (
            <AxisBar
              key={key}
              label={label}
              score={analysis.scores[key]}
            />
          ))}
        </div>

        {/* 코멘트 + 영/한 토글 */}
        <div
          style={{
            padding: "16px 18px 8px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: ".08em",
              color: "var(--ink-3)",
            }}
          >
            항목별 코멘트
          </div>
          <LangToggle lang={lang} onChange={setLang} />
        </div>
        <div style={{ padding: "0 18px 12px" }}>
          {AXIS_LABELS.map(({ key, label }) => (
            <CommentRow
              key={key}
              label={label}
              text={comments?.[key] || "—"}
            />
          ))}
        </div>

        {/* 종합 텍스트 */}
        <div
          style={{
            padding: "12px 18px 20px",
            borderTop: "1px solid var(--line)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: ".08em",
              color: "var(--ink-3)",
              marginBottom: 8,
            }}
          >
            종합
          </div>
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: "var(--ink-2)",
              whiteSpace: "pre-wrap",
            }}
          >
            {summary || "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

function scoreColor(score: number | null): string {
  if (score == null) return "var(--ink-4)";
  if (score >= 80) return "var(--green-ink, #2f8a3a)";
  if (score >= 50) return "var(--amber-ink, #b8860b)";
  return "var(--red-ink, #c0392b)";
}

function ScoreDot({ score, size = 12 }: { score: number | null; size?: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: scoreColor(score),
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,.1)",
      }}
    />
  );
}

function AxisBar({ label, score }: { label: string; score: number | null }) {
  const v = score ?? 0;
  const color = scoreColor(score);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "100px 1fr 50px",
        alignItems: "center",
        gap: 10,
        padding: "5px 0",
      }}
    >
      <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{label}</span>
      <div
        style={{
          height: 8,
          background: "var(--bg-2)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${v}%`,
            height: "100%",
            background: color,
            transition: "width .25s",
          }}
        />
      </div>
      <span
        className="mono"
        style={{
          fontSize: 11.5,
          color,
          textAlign: "right",
          fontWeight: 600,
        }}
      >
        {score ?? "—"}
      </span>
    </div>
  );
}

function CommentRow({ label, text }: { label: string; text: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "100px 1fr",
        gap: 10,
        padding: "6px 0",
        fontSize: 12,
        lineHeight: 1.5,
        borderBottom: "1px solid var(--line)",
      }}
    >
      <span style={{ color: "var(--ink-3)" }}>{label}</span>
      <span style={{ color: "var(--ink)", whiteSpace: "pre-wrap" }}>
        {text}
      </span>
    </div>
  );
}

function LangToggle({
  lang,
  onChange,
}: {
  lang: "en" | "ko";
  onChange: (l: "en" | "ko") => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--bg-2)",
        border: "1px solid var(--line)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {(["en", "ko"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "3px 10px",
            fontSize: 11,
            fontWeight: lang === l ? 600 : 400,
            background: lang === l ? "var(--surface)" : "transparent",
            color: lang === l ? "var(--ink)" : "var(--ink-3)",
          }}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: tsc / lint 통과**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: exit 0.

- [ ] **Step 3: 커밋**

```bash
git add frontend/components/studio/ComparisonAnalysisModal.tsx
git commit -m "$(cat <<'EOF'
feat(studio): ComparisonAnalysisModal — 5축 막대 + 영/한 토글

- 종합 % 큰 dot + 임계 색상
- 5축 막대 (점수 0-100 막대 너비 + 색상)
- 항목별 코멘트 영/한 토글 (vision-analyzer 패턴 동일)
- 종합 단락 영/한 토글
- z-index 80 (Lightbox 70 위)
- fallback=true 시 헤더에 마커

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: useComparisonAnalysis 훅 (트리거 · 캐시 · busy guard · VRAM 임계)

**Files:**
- Create: `frontend/hooks/useComparisonAnalysis.ts`

- [ ] **Step 1: 훅 신규 작성**

`frontend/hooks/useComparisonAnalysis.ts`:

```ts
/**
 * useComparisonAnalysis - Edit 결과 vs 원본 비교 분석 트리거 + 캐시 관리.
 *
 * 책임:
 *  - analyze(item): 수동 또는 자동 분석 호출 + per-item busy guard
 *  - 분석 결과를 useHistoryStore.replaceAll 로 inline patch (item 갱신)
 *  - VRAM 임계 (>13GB) 시 자동 호출은 skip + 토스트 (수동은 경고만)
 *  - 동일 item 중복 호출 차단 (Set<itemId> busy)
 *  - 백엔드 mutex 가 ComfyUI 와 직렬화 — 프론트는 토스트로 안내
 *
 * 반환:
 *  - analyze(item, opts?): 외부 트리거 진입점
 *  - isBusy(itemId): 특정 item 분석 중 여부 (UI 가 카드 state 분기)
 */

"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { compareAnalyze } from "@/lib/api-client";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useProcessStore } from "@/stores/useProcessStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";
import type { HistoryItem } from "@/lib/api-client";

const VRAM_THRESHOLD_GB = 13;

/** 모듈 전역 — 페이지 간에도 동일 set 공유 (Edit / Lightbox 둘 다). */
const _busy = new Set<string>();
const _listeners = new Set<() => void>();

function _notify() {
  for (const fn of _listeners) fn();
}

function _subscribe(fn: () => void) {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

function _snapshot(): ReadonlySet<string> {
  return _busy;
}

export interface AnalyzeOptions {
  /** true 면 자동 모드 — VRAM 초과/사용자 작업 중일 때 silent skip. */
  silent?: boolean;
}

export function useComparisonAnalysis() {
  // 외부 store (busy set) 구독 — Card 가 isBusy 변할 때 리렌더 받게
  useSyncExternalStore(_subscribe, _snapshot, _snapshot);

  const visionModel = useSettingsStore((s) => s.visionModel);
  const ollamaModel = useSettingsStore((s) => s.ollamaModel);
  const items = useHistoryStore((s) => s.items);
  const replaceAll = useHistoryStore((s) => s.replaceAll);
  const vram = useProcessStore((s) => s.vram);

  // 클로저로 최신 items 보관 — 비동기 콜백에서도 stale 회피
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const isBusy = useCallback((itemId: string) => _busy.has(itemId), []);

  const analyze = useCallback(
    async (item: HistoryItem, opts: AnalyzeOptions = {}) => {
      // 사전 가드
      if (item.mode !== "edit") {
        if (!opts.silent) toast.warn("비교 분석은 Edit 결과만 가능");
        return;
      }
      if (!item.sourceRef) {
        if (!opts.silent) toast.warn("원본 이미지가 저장돼 있지 않은 옛 항목");
        return;
      }
      if (_busy.has(item.id)) {
        if (!opts.silent) toast.warn("이미 분석 진행 중", "잠시 후 다시 시도");
        return;
      }
      // VRAM 임계 — 자동(silent) 호출만 skip, 수동은 경고만
      if (vram && vram.usedGb > VRAM_THRESHOLD_GB) {
        if (opts.silent) {
          toast.warn(
            "VRAM 부족 · 자동 분석 skip",
            `${vram.usedGb.toFixed(1)}GB > ${VRAM_THRESHOLD_GB}GB`,
          );
          return;
        }
        toast.warn(
          "VRAM 높음 · 분석 시도",
          `${vram.usedGb.toFixed(1)}GB · 진행 가능`,
        );
      }

      _busy.add(item.id);
      _notify();
      try {
        const { analysis, saved } = await compareAnalyze({
          source: item.sourceRef,
          result: item.imageRef,
          editPrompt: item.prompt,
          historyItemId: item.id.startsWith("tsk-") ? item.id : undefined,
          visionModel,
          ollamaModel,
        });

        // 결과를 store 의 해당 item 에 inline patch (replaceAll 사용 — Zustand 권장)
        const next = itemsRef.current.map((x) =>
          x.id === item.id ? { ...x, comparisonAnalysis: analysis } : x,
        );
        replaceAll(next);

        if (analysis.fallback) {
          toast.warn("비교 분석 fallback", analysis.summary_ko || "비전 응답 부족");
        } else if (!opts.silent) {
          toast.success("비교 분석 완료", `종합 ${analysis.overall}%`);
        } else {
          // 자동 모드 — 짧게 알림
          toast.info("비교 분석 도착", `종합 ${analysis.overall}%`);
        }
        if (item.id.startsWith("tsk-") && !saved) {
          // historyItemId 보냈는데 DB 저장 안 됨 — 경고
          toast.warn("DB 저장 실패", "재시작 후 결과 사라질 수 있어");
        }
      } catch (err) {
        toast.error(
          "비교 분석 실패",
          err instanceof Error ? err.message : "알 수 없는 오류",
        );
      } finally {
        _busy.delete(item.id);
        _notify();
      }
    },
    [vram, visionModel, ollamaModel, replaceAll],
  );

  return { analyze, isBusy };
}
```

- [ ] **Step 2: tsc / lint 통과**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: exit 0.

- [ ] **Step 3: 커밋**

```bash
git add frontend/hooks/useComparisonAnalysis.ts
git commit -m "$(cat <<'EOF'
feat(hooks): useComparisonAnalysis — 트리거 · busy guard · VRAM 임계

- analyze(item, opts): 수동/자동 진입점 (silent 옵션으로 자동 토스트 톤 분기)
- per-item _busy set + useSyncExternalStore 로 isBusy 구독 (페이지 간 공유)
- 가드: mode !== "edit", sourceRef 없음, 중복 호출, VRAM > 13GB
- 결과 → useHistoryStore.replaceAll inline patch
- saved=false (DB 저장 실패) 시 경고 토스트
- fallback / 성공 / 자동 도착 토스트 분기

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: /edit 페이지 — Before/After 슬라이더 아래 카드 통합

**Files:**
- Modify: `frontend/app/edit/page.tsx`

- [ ] **Step 1: 페이지에 카드 + 모달 import 및 렌더 추가**

`frontend/app/edit/page.tsx` 의 import 블록에 추가 (28줄 근처 AiEnhanceCard 옆):

```tsx
import ComparisonAnalysisCard from "@/components/studio/ComparisonAnalysisCard";
import ComparisonAnalysisModal from "@/components/studio/ComparisonAnalysisModal";
import { useComparisonAnalysis } from "@/hooks/useComparisonAnalysis";
```

`EditPage` 함수 안 (43줄 근처 selectHistory 다음) 에 훅 사용 + 모달 state 추가:

```tsx
  const { analyze, isBusy } = useComparisonAnalysis();
  const [comparisonModalOpen, setComparisonModalOpen] = useState(false);
```

`<AiEnhanceCard item={afterItem} />` 직후 (588줄 근처) 에 카드 추가:

```tsx
              <AiEnhanceCard item={afterItem} />
              <ComparisonAnalysisCard
                item={afterItem}
                busy={isBusy(afterItem.id)}
                onAnalyze={() => analyze(afterItem)}
                onOpenDetail={() => setComparisonModalOpen(true)}
                onReanalyze={() => analyze(afterItem)}
              />
```

페이지 최상단 `<div>` 시작부 (170줄 근처 `progressOpen && ...` 옆) 에 모달 렌더 추가:

```tsx
      {comparisonModalOpen && afterItem?.comparisonAnalysis && (
        <ComparisonAnalysisModal
          item={afterItem}
          analysis={afterItem.comparisonAnalysis}
          onClose={() => setComparisonModalOpen(false)}
        />
      )}
```

- [ ] **Step 2: tsc / lint 통과**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: exit 0.

- [ ] **Step 3: 커밋**

```bash
git add frontend/app/edit/page.tsx
git commit -m "$(cat <<'EOF'
feat(edit-page): Before/After 아래 ComparisonAnalysisCard + Modal 통합

- AiEnhanceCard 직후에 ComparisonAnalysisCard 렌더 (afterItem 있을 때만)
- useComparisonAnalysis 훅으로 트리거/busy 관리
- comparisonModalOpen state + ComparisonAnalysisModal lazy 렌더

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: ImageLightbox InfoPanel 안에 카드 통합 (mode === "edit" 분기)

**Files:**
- Modify: `frontend/components/studio/ImageLightbox.tsx`

- [ ] **Step 1: InfoPanel 안에 카드 + 모달 추가**

`frontend/components/studio/ImageLightbox.tsx` 상단 import 블록에 추가:

```tsx
import { useState } from "react";
import ComparisonAnalysisCard from "./ComparisonAnalysisCard";
import ComparisonAnalysisModal from "./ComparisonAnalysisModal";
import { useComparisonAnalysis } from "@/hooks/useComparisonAnalysis";
```

(주의: `useState` 는 이미 import 됨 — 중복 추가 안 함.)

`InfoPanel` 함수 (368줄 근처) 안에서 ComfyUI 에러 section (554줄 근처) 다음에 비교 분석 카드 추가:

```tsx
      {/* 비교 분석 (Edit 모드 전용) */}
      {item.mode === "edit" && (
        <section style={{ marginBottom: 18 }}>
          <SectionTitle>비교 분석</SectionTitle>
          <ComparisonInPanel item={item} />
        </section>
      )}
```

`InfoPanel` 함수 끝 (`</aside>` 닫기 직전) 에 ComparisonInPanel 헬퍼 컴포넌트를 같은 파일 안에 추가 (CopyChip 등 헬퍼들 옆에 배치):

```tsx
/* ─────────────────────────────────
   ComparisonInPanel — Lightbox 내부 비교 분석 카드 + 모달
   별도 컴포넌트로 분리해 useComparisonAnalysis 훅 사용 가능 (InfoPanel 자체는 hook 사용 위치 부적합 X)
   ───────────────────────────────── */
function ComparisonInPanel({ item }: { item: HistoryItem }) {
  const { analyze, isBusy } = useComparisonAnalysis();
  const [open, setOpen] = useState(false);
  return (
    <>
      <ComparisonAnalysisCard
        item={item}
        busy={isBusy(item.id)}
        onAnalyze={() => analyze(item)}
        onOpenDetail={() => setOpen(true)}
        onReanalyze={() => analyze(item)}
      />
      {open && item.comparisonAnalysis && (
        <ComparisonAnalysisModal
          item={item}
          analysis={item.comparisonAnalysis}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: tsc / lint 통과**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: exit 0.

- [ ] **Step 3: 커밋**

```bash
git add frontend/components/studio/ImageLightbox.tsx
git commit -m "$(cat <<'EOF'
feat(lightbox): InfoPanel 안에 ComparisonAnalysisCard 통합

- mode === "edit" 일 때만 "비교 분석" section 렌더
- ComparisonInPanel 헬퍼: useComparisonAnalysis + 모달 state 캡슐화
- 모달은 z-index 80 으로 Lightbox 위에 띄움

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: 자동 토글 — useSettingsStore + SettingsDrawer

**Files:**
- Modify: `frontend/stores/useSettingsStore.ts`
- Modify: `frontend/components/settings/SettingsDrawer.tsx`

- [ ] **Step 1: useSettingsStore 에 autoCompareAnalysis 추가**

`frontend/stores/useSettingsStore.ts` 의 `SettingsState` interface 에 추가:

```ts
  /* 프리퍼런스 토글 */
  showUpgradeStep: boolean;
  lightningByDefault: boolean;
  autoStartComfy: boolean;
  /** Edit 결과 완료 후 자동 비교 분석 (백그라운드). 기본 false. */
  autoCompareAnalysis: boolean;
```

setter 추가:

```ts
  setAutoCompareAnalysis: (v: boolean) => void;
```

`create` 안의 default + setter 구현:

```ts
      autoCompareAnalysis: false,
      ...
      setAutoCompareAnalysis: (v) => set({ autoCompareAnalysis: v }),
```

`persist` 의 `version` 을 1 → 2 로 올리고 마이그레이션 함수 추가 (기존 사용자 자동 false 적용):

```ts
    {
      name: "ais:settings",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (persisted: unknown, fromVersion: number) => {
        // v1 → v2: autoCompareAnalysis 기본 false 추가
        const obj = (persisted as Record<string, unknown>) || {};
        if (fromVersion < 2) {
          obj.autoCompareAnalysis = false;
        }
        return obj as SettingsState;
      },
    },
```

- [ ] **Step 2: SettingsDrawer 의 PreferencesSection 에 토글 UI 추가**

`frontend/components/settings/SettingsDrawer.tsx` 의 `PreferencesSection` (621줄 근처) 수정 — destructure 와 setter 추가 + Toggle 한 줄 추가:

```tsx
function PreferencesSection() {
  const {
    showUpgradeStep,
    lightningByDefault,
    autoStartComfy,
    autoCompareAnalysis,
    setShowUpgradeStep,
    setLightningByDefault,
    setAutoStartComfy,
    setAutoCompareAnalysis,
  } = useSettingsStore();

  return (
    <Section title="프리퍼런스" desc="기본 동작 토글 · 모든 변경 즉시 저장">
      <Toggle
        checked={showUpgradeStep}
        onChange={setShowUpgradeStep}
        label="프롬프트 업그레이드 확인 단계 보이기"
        desc="gemma4 보강 결과를 모달로 먼저 확인"
      />
      <Toggle
        checked={lightningByDefault}
        onChange={(v) => {
          setLightningByDefault(v);
          toast.info(
            v ? "Lightning 기본 ON" : "Lightning 기본 OFF",
            "다음부터 생성 화면 진입 시 반영돼요.",
          );
        }}
        label="Lightning 모드 기본 ON"
        desc="생성 화면 진입 시 ⚡ 4-step 자동 선택"
      />
      <Toggle
        checked={autoCompareAnalysis}
        onChange={setAutoCompareAnalysis}
        label="수정 후 자동 비교 분석"
        desc="Edit 결과 완료 시 백그라운드로 5축 평가 (VRAM>13GB 시 skip)"
      />
      <Toggle
        checked={autoStartComfy}
        onChange={setAutoStartComfy}
        label="앱 시작 시 ComfyUI 자동 실행"
        desc="VRAM 계속 점유 — 주의"
      />
    </Section>
  );
}
```

- [ ] **Step 3: tsc / lint 통과**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: exit 0.

- [ ] **Step 4: 커밋**

```bash
git add frontend/stores/useSettingsStore.ts frontend/components/settings/SettingsDrawer.tsx
git commit -m "$(cat <<'EOF'
feat(settings): autoCompareAnalysis 토글 추가

- useSettingsStore: autoCompareAnalysis (기본 false) + setter
- persist version 1→2 + migrate (기존 사용자 false 자동 주입)
- SettingsDrawer PreferencesSection 에 토글 한 줄 (Lightning 옆)
- desc 에 VRAM>13GB skip 안내

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: useEditPipeline done 핸들러 — 자동 분석 트리거

**Files:**
- Modify: `frontend/hooks/useEditPipeline.ts`

- [ ] **Step 1: done 분기에 자동 트리거 추가**

`frontend/hooks/useEditPipeline.ts` 상단 import 에 추가:

```ts
import { useComparisonAnalysis } from "@/hooks/useComparisonAnalysis";
```

`useEditPipeline` 함수 안 (47줄 근처) 에 훅 + 설정 구독 추가:

```ts
  const visionModelSel = useSettingsStore((s) => s.visionModel);
  const autoCompareAnalysis = useSettingsStore((s) => s.autoCompareAnalysis);
  const { analyze: analyzeComparison, isBusy: isComparisonBusy } =
    useComparisonAnalysis();
```

`done` 분기 (98줄 근처) 의 `addItem(evt.item);` 다음에 자동 트리거 블록 추가:

```ts
        } else if (evt.type === "done") {
          resetPipeline();
          addItem(evt.item);
          onComplete(evt.item.id);
          toast.success("수정 완료", evt.item.label);
          if (evt.item.comfyError) {
            toast.error(...);
          } else if (evt.item.promptProvider === "fallback") {
            toast.warn(...);
          }
          if (!evt.savedToHistory) {
            toast.warn(...);
          }
          // 자동 비교 분석 — 토글 ON + 동일 item 분석 중 아닐 때만
          if (
            autoCompareAnalysis &&
            evt.item.mode === "edit" &&
            evt.item.sourceRef &&
            !isComparisonBusy(evt.item.id)
          ) {
            // void — 백그라운드, 본 흐름 차단 X
            void analyzeComparison(evt.item, { silent: true });
          }
          completed = true;
          return;
```

- [ ] **Step 2: tsc / lint 통과**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: exit 0.

- [ ] **Step 3: 커밋**

```bash
git add frontend/hooks/useEditPipeline.ts
git commit -m "$(cat <<'EOF'
feat(edit-pipeline): 자동 비교 분석 백그라운드 트리거

- useEditPipeline done 핸들러: autoCompareAnalysis ON + sourceRef 있음
  + busy 아님 조건 모두 만족 시 void analyzeComparison({silent:true})
- silent=true → useComparisonAnalysis 가 VRAM 초과 시 skip 토스트만

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: 수동 QA + 회귀 게이트 통과

**Files:**
- 코드 변경 없음 (검증 단계)

- [ ] **Step 1: 백엔드 + 프론트 모두 기동**

두 개 터미널에서 각각 실행:

Backend:
```
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --no-access-log
```

Frontend (실 백엔드 연결):
```powershell
$env:NEXT_PUBLIC_USE_MOCK="false"; $env:NEXT_PUBLIC_STUDIO_API="http://localhost:8001"; cd frontend; npm run dev
```

ComfyUI 와 Ollama 도 켜져 있어야 함 (qwen2.5vl:7b · gemma4-un:latest 모델 필요).

- [ ] **Step 2: QA 시나리오 1 — /edit 단일 수정 + 수동 분석**

http://localhost:3000/edit 접속 → 인물 사진 1장 업로드 → 수정 지시 입력 → [수정 생성] →
완료 후 Before/After 슬라이더 아래에 "🔍 비교 분석 [분석]" 카드 보이는지 확인 →
[분석] 클릭 → 5-15초 후 인라인 dot/% 채워짐 → [자세히] 클릭 → 모달에 5축 막대 + 영/한 토글 동작 확인.

Expected: 모달에 5축 점수 + 코멘트 (영/한 둘 다) + 종합 단락 표시.

- [ ] **Step 3: QA 시나리오 2 — 페이지 떠난 뒤 history 그리드 다시 클릭**

다른 페이지로 이동 → /edit 으로 복귀 → 수정 히스토리 그리드에서 방금 분석한 결과 클릭 →
인라인 카드가 채워진 상태 그대로 다시 보이는지 확인.

Expected: comparisonAnalysis 가 영구 저장돼서 새로고침/이동 후에도 카드 채워짐.

- [ ] **Step 4: QA 시나리오 3 — ImageLightbox 메타 패널**

수정 히스토리 썸네일에서 [확장] 클릭 → Lightbox 오픈 → 우측 InfoPanel 안 "비교 분석" section 에 동일 카드 → [자세히] 클릭 → 모달이 Lightbox 위에 겹쳐서 뜸 → 닫으면 Lightbox 만 남음.

Expected: z-index 충돌 없음, 영/한 토글 정상.

- [ ] **Step 5: QA 시나리오 4 — 자동 모드 토글**

설정 드로어 → "수정 후 자동 비교 분석" 토글 ON → /edit 으로 새 수정 진행 →
완료 후 백그라운드에서 "비교 분석 도착 · 종합 X%" 토스트 도착 → 카드 자동 채워짐.

Expected: 사용자가 [분석] 안 눌러도 카드가 자동 filled state 로 변함.

- [ ] **Step 6: QA 시나리오 5 — Ollama 정지 시 fallback**

Ollama 프로세스 정지 (`ollama stop` 또는 트레이 종료) → 분석 클릭 →
모달 헤더에 "fallback" 마커 + summary 에 "비전 모델 응답 없음" 표시.

Expected: HTTP 200 + fallback 결과로 graceful 처리.

- [ ] **Step 7: QA 시나리오 6 — 옛 row (sourceRef NULL)**

이번 작업 이전에 만들어진 edit row 가 history 에 있으면 클릭 →
"분석 불가 · 원본 이미지가 저장돼 있지 않은 옛 항목입니다" 안내 표시.

Expected: 분석 버튼 자체가 안 보이고 안내 메시지만.

- [ ] **Step 8: 백엔드 회귀 테스트 전체 실행**

Run: `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/ -v`
Expected: 13건 + 신규 ~13건 = ~26건 모두 PASS.

- [ ] **Step 9: 프론트 lint + tsc 최종 확인**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: exit 0.

- [ ] **Step 10: 메모리 업데이트 + 최종 마커 커밋 (메모리만)**

`C:\Users\pzen\.claude\projects\D--AI-Image-Studio\memory\MEMORY.md` 의 "진행 중 기획" 항목 제거하고 "프로젝트 상태" 에 새 entry 추가:

```
- **2026-04-24 Edit 비교 분석 완료** — qwen2.5vl 5축 평가 (face_id/body_pose/attire/background/intent_fidelity) · /api/studio/compare-analyze · ComparisonAnalysisCard + Modal · 자동 토글 + VRAM>13GB 안전장치 · history_db 영구 저장
```

QA 완료 마커 커밋 없음 — 작업 자체는 Task 14 까지 코드 커밋으로 이미 끝남.

---

## Self-Review (writing-plans 마지막 단계)

- **Spec coverage:** §2 결정사항 13건, §3 컴포넌트, §4 UI 4-state + 모달, §5 타입 + DB 마이그레이션, §6 백엔드 API + 비전/번역, §7 트리거 + VRAM, §8 에러 시나리오 9개, §9 보안 → 모두 task 1~15 에 매핑됨. ✅
- **Placeholder scan:** TODO / TBD / "implement later" 검색 → 없음. 모든 step 에 실제 코드 또는 명령. ✅
- **Type consistency:** `ComparisonAnalysisResult` (Python dataclass) vs `ComparisonAnalysis` (TS interface) — Python `to_dict()` 가 TS shape 으로 매핑 (snake_case 필드 그대로 + analyzedAt/visionModel 만 camelCase). 의도된 비대칭. `_TASK_ID_RE` 는 Task 5 에서 정의 → Task 6 에서 재사용. ✅
- **에러 처리 보강:** §8 의 "동일 item 중복 분석 (race)" 은 백엔드 mutex + 프론트 per-item busy set 양쪽으로 막힘. "timeout 30s" 는 백엔드 `_COMPARE_LOCK_TIMEOUT_SEC` + httpx `DEFAULT_TIMEOUT(240s)` 로 커버. ✅

Plan complete.
