# Edit Reference Template Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit 모드의 reference 이미지 (image2) 를 라이브러리 형식으로 영구 저장 + 재사용 + 비전 자동 분석 + 잘 안 나오는 템플릿 삭제 기능.

**Architecture:** 별도 SQLite 테이블 `reference_templates` + `data/images/studio/reference-templates/` 영구 저장 폴더. 사용자 명시적 저장 토글 ("템플릿으로 저장" ON 시만), 저장 시점에 qwen2.5vl 1회 동기 호출로 비전 description 자동 생성. Drawer/Modal UI 로 라이브러리 grid 노출, 픽 시 두번째 SourceImageCard 자동 채움 + last_used_at 갱신.

**Tech Stack:** FastAPI · aiosqlite · PIL · Next.js 16 · React 19 · Zustand 5

**선행 조건:** [Edit Multi-Reference Plan](2026-04-27-edit-multi-reference.md) 의 Phase 1-5 (multi-ref 토글 자체) 가 master 머지되고 안정화 검증 완료된 후 진행.

---

## ⏸️ 진입 조건 — Multi-Reference 안정화 검증

다음 중 하나 이상 만족 시 이 plan 진입:

1. 같은 reference 이미지 (예: 자주 쓰는 옷) 를 *2회 이상 재업로드* 하는 케이스 발견
2. role 별 결과 품질 평균 ≥ 3/5 (acceptable)
3. 사용자 명시적 "라이브러리 추가하자" 결정

조건 미달 시 보류 — multi-ref 가 충분한 가치 제공하지 못하면 라이브러리 의미 없음.

---

## 디자인 결정 (브레인스토밍 합의 · Codex 1차 + 2차 리뷰 반영)

- **저장 정책**: 명시적 ("템플릿으로 저장" 토글 ON 시만)
- **비전 분석**: 저장 시 1회 (qwen2.5vl 동기 — 사용자 5-10초 대기). `_describe_image` 의 기존 `system_prompt` 파라미터 재사용.
- **삭제 정책**: Soft (DB row + 이미지 파일 삭제, 옛 history row 의 reference_ref URL 보존 — 이미지만 깨짐 표시)
- **중복 검출**: 무관 (같은 옷 다른 시각도 별도 템플릿 가능)
- **DB 컬럼 의미 고정**: `image_ref` (reference_templates) = `/images/studio/reference-templates/<uuid>.<ext>` *영구 URL only*. ComfyUI 임시 filename 은 별도 처리.
- **DB insert 실패 시 파일 롤백**: 저장된 reference 파일 unlink (orphan 방지)
- **이미지 PIL 재인코딩**: 저장 시 PIL 로 검증 + 재인코딩 (메타데이터/확장자 일치)
- **production DB 오염 방지**: 모든 테스트는 temp DB monkeypatch 패턴
- **URL 정규화** (Codex 2차 리뷰 fix #6): API 가 반환하는 상대 path 를 frontend 에서 `STUDIO_BASE` prefix 로 절대 URL 변환 — `normalizeReferenceTemplate` helper.

### history.referenceRef 저장 정책 (Codex 2차 리뷰 fix #5)

> Multi-reference 본 plan 에서 `history.referenceRef` 의 의미를 *영구 URL only* 로 고정함. Library plan 은 그 결정을 *어떻게 채우는지* 명시 필요.

**선택한 정책: 옵션 A (간소함 우선)**

| 케이스 | 첫 실행 (사용자가 새 이미지 + saveAsTemplate ON) | 다음 실행 (라이브러리 픽 후 사용) |
|--------|------------------------------------------------|--------------------------------|
| `history.referenceRef` 값 | `null` (영구 URL 아직 없음) | 영구 URL (`/images/studio/reference-templates/<uuid>.<ext>`) |
| 이유 | "edit 완료 후 템플릿 저장" 흐름이라 첫 실행 시점에는 영구 파일 없음 | 라이브러리 픽 = 이미 영구 저장된 URL 보유 |

**옵션 B (영구 URL 우선)** 거부 이유:
- "템플릿을 먼저 저장한 뒤 edit 실행" 으로 바꾸면 사용자가 *추가 클릭/대기* 단계 거쳐야 함 (UX 후퇴).
- 첫 실행 시점에 vision 분석 5-10초 + 저장 5-10초 추가 대기 → 무거움.
- 사용자는 *결과 보고 나서* 좋으면 라이브러리에 저장하는 흐름이 자연스러움 (저장 가치 평가 후 결정).

**옵션 A 의 trade-off**: 첫 실행 history 는 reference 정보 추적 어려움. 단 `referenceRole` 은 항상 저장됨 (multi-ref 본 plan). 미래에 첫 실행 history 재현 필요 시 사용자가 라이브러리에서 동일 템플릿 픽해서 다시 실행 가능.

**저장 흐름 — 라이브러리 픽 케이스:**

```
[사용자] 라이브러리 Drawer 에서 템플릿 클릭
   │
   ▼
[Frontend] useEditStore.setPickedTemplateId(t.id) + setPickedTemplateRef(t.imageRef)
                                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                    Codex fix #5: 프론트 fetch/display 용 URL 보관
   │
   ▼ 사용자 [수정 생성]
   │
[Frontend] editImageStream meta 에 { referenceTemplateId: t.id }
   │        (referenceRef 는 보내더라도 backend 가 DB 저장 근거로 신뢰하지 않음)
   │
   ▼
[Backend] routes/streams.py — referenceTemplateId 로 DB template 조회
   │
   ▼ pipelines/edit.py 에서:
   │   - multipart reference_image bytes 를 ComfyUI input/ 에 *임시 업로드* (extra_uploads)
   │   - history item 에 "referenceRef": <DB image_ref 상대 URL>, "referenceRole": <role> 저장
   │   - referenceTemplateId 가 있으면 touch_reference_template() 호출 (last_used_at 갱신)
   │
   ▼
[DB] history row 의 reference_ref 컬럼 = DB template.image_ref (예: /images/studio/reference-templates/...) 저장
```

> ⚠️ **Codex 3차 리뷰 fix:** Frontend 의 `ReferenceTemplate.imageRef` 는 URL 정규화 후
> `http://localhost:8001/images/...` 같은 절대 URL 이 될 수 있음. DB `history.referenceRef`
> 정책은 *영구 상대 URL only* 이므로, backend 는 클라이언트가 보낸 `referenceRef` 를 DB 저장
> 근거로 신뢰하지 않는다. `referenceTemplateId` 로 DB 를 조회해 `image_ref` 를 결정한다.

---

## File Structure

### Backend (modify + 2 new)

- `backend/studio/history_db.py` — schema v7→v8 + reference_templates CRUD 함수 (list/get/insert/delete/touch)
- `backend/studio/reference_storage.py` — **NEW**. 영구 저장 + path 검증 + 비전 분석 헬퍼
- `backend/studio/routes/reference_templates.py` — **NEW**. GET/POST/DELETE/touch endpoints
- `backend/studio/routes/__init__.py` — 신규 라우터 등록 (`studio_router.include_router(reference_templates.router)`). `backend/studio/router.py` 는 facade/re-export 라 *직접 등록 대상 아님* (Codex 2차 리뷰 fix #7).

### Frontend (modify + 2 new)

- `frontend/lib/api/reference-templates.ts` — **NEW**. CRUD API 클라이언트
- `frontend/lib/api/types.ts` — `ReferenceTemplate` interface 추가
- `frontend/components/studio/edit/ReferenceLibraryDrawer.tsx` — **NEW**. 라이브러리 grid + 픽/삭제 액션
- `frontend/components/studio/edit/EditLeftPanel.tsx` — 라이브러리 버튼 + 저장 토글 통합
- `frontend/stores/useEditStore.ts` — saveAsTemplate / templateName / pickedTemplateId 필드
- `frontend/hooks/useEditPipeline.ts` — done 콜백에서 template 자동 저장 hook

### Tests (1 new)

- `backend/tests/studio/test_reference_templates.py` — **NEW**. CRUD + path traversal 보안 테스트

---

## Task 1: reference_templates 테이블 스키마 (v7→v8)

**Files:**
- Modify: `backend/studio/history_db.py`

- [ ] **Step 1: 변경 전 baseline**

Run: `cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `222 passed` (Multi-Reference plan Phase 1-5 머지된 상태)

- [ ] **Step 2: SCHEMA_VERSION 7→8 + 테이블/인덱스 정의**

`backend/studio/history_db.py:51` 부근:

```python
SCHEMA_VERSION = 8
```

CREATE_TABLE 정의 다음에 추가:

```python
CREATE_REFERENCE_TEMPLATES = """
CREATE TABLE IF NOT EXISTS reference_templates (
  id TEXT PRIMARY KEY,
  image_ref TEXT NOT NULL,
  name TEXT NOT NULL,
  vision_description TEXT,
  user_intent TEXT,
  role_default TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
"""
CREATE_IDX_REF_LASTUSED = (
    "CREATE INDEX IF NOT EXISTS idx_reference_templates_lastused "
    "ON reference_templates(last_used_at DESC)"
)
```

- [ ] **Step 3: 마이그레이션 함수 + init_studio_history_db 호출**

```python
async def _migrate_create_reference_templates(db: aiosqlite.Connection) -> None:
    """v8 (2026-04-27): reference_templates 테이블 + 인덱스. idempotent (CREATE IF NOT EXISTS)."""
    await db.execute(CREATE_REFERENCE_TEMPLATES)
    await db.execute(CREATE_IDX_REF_LASTUSED)
    await db.commit()
```

`init_studio_history_db` 함수 내부의 마지막 마이그레이션 호출 후 + `_set_schema_version` 호출 *전*:

```python
        if current_version < 8:
            await _migrate_create_reference_templates(db)
        # ... 모든 마이그레이션 후
        if current_version < SCHEMA_VERSION:
            await _set_schema_version(db, SCHEMA_VERSION)
```

- [ ] **Step 4: 검증**

Run: `D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `222 passed`

- [ ] **Step 5: Commit (사용자 승인 후만)**

```bash
git add backend/studio/history_db.py
git commit -m "feat(edit-lib): history_db v8 — reference_templates 테이블 + 인덱스"
```

---

## Task 2: reference_templates CRUD 함수

**Files:**
- Modify: `backend/studio/history_db.py`
- Test: `backend/tests/studio/test_reference_templates.py` (**NEW**)

- [ ] **Step 1: temp DB monkeypatch 패턴 conftest 확인**

`backend/tests/conftest.py` 확인 — production DB (`./data/history.db`) 사용 안 하도록 fixture 또는 monkeypatch 패턴 파악. 기존 `test_history_db.py` 가 어떻게 격리하는지 참조.

- [ ] **Step 2: CRUD async 함수 5개 추가**

`backend/studio/history_db.py` 끝부분:

```python
import time
import uuid


async def list_reference_templates() -> list[dict[str, Any]]:
    """저장된 reference templates 목록 — last_used_at 내림차순 (최근 사용 먼저).

    NULL last_used_at 은 created_at 으로 정렬 보장 (SQLite NULLS LAST).
    """
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM reference_templates "
            "ORDER BY COALESCE(last_used_at, 0) DESC, created_at DESC"
        )
        rows = await cur.fetchall()
    return [_row_to_reference_template(r) for r in rows]


async def get_reference_template(template_id: str) -> dict[str, Any] | None:
    """단일 reference template 조회 — backend 가 referenceTemplateId 를 신뢰 근거로 사용.

    Codex 3차 리뷰 fix: 클라이언트의 정규화된 absolute referenceRef 를 DB 저장 근거로
    쓰지 않고, template id 로 DB 의 상대 image_ref 를 다시 조회한다.
    """
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM reference_templates WHERE id = ?",
            (template_id,),
        )
        row = await cur.fetchone()
    return _row_to_reference_template(row) if row else None


async def insert_reference_template(item: dict[str, Any]) -> str:
    """새 template 저장 — image_ref 는 호출 측에서 이미 영구 저장된 URL.

    Returns: 신규 id (tpl-<uuid8>).
    """
    new_id = item.get("id") or f"tpl-{uuid.uuid4().hex[:8]}"
    async with aiosqlite.connect(_DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO reference_templates (
                id, image_ref, name, vision_description, user_intent,
                role_default, created_at, last_used_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id,
                item["imageRef"],
                item["name"],
                item.get("visionDescription"),
                item.get("userIntent"),
                item.get("roleDefault"),
                int(time.time() * 1000),
                None,
            ),
        )
        await db.commit()
    return new_id


async def delete_reference_template(template_id: str) -> tuple[bool, str | None]:
    """삭제 + 해당 image_ref 반환 (orphan 파일 정리용).

    Returns: (deleted, image_ref). deleted=False 면 image_ref 도 None.
    """
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT image_ref FROM reference_templates WHERE id = ?",
            (template_id,),
        )
        row = await cur.fetchone()
        if row is None:
            return (False, None)
        image_ref = row["image_ref"]
        del_cur = await db.execute(
            "DELETE FROM reference_templates WHERE id = ?", (template_id,)
        )
        await db.commit()
        return (del_cur.rowcount > 0, image_ref)


async def touch_reference_template(template_id: str) -> bool:
    """last_used_at 갱신 — 사용자가 이 템플릿으로 수정 실행 시 호출."""
    async with aiosqlite.connect(_DB_PATH) as db:
        cur = await db.execute(
            "UPDATE reference_templates SET last_used_at = ? WHERE id = ?",
            (int(time.time() * 1000), template_id),
        )
        await db.commit()
        return cur.rowcount > 0


def _row_to_reference_template(row: aiosqlite.Row) -> dict[str, Any]:
    """DB row → frontend ReferenceTemplate shape (camelCase)."""
    return {
        "id": row["id"],
        "imageRef": row["image_ref"],
        "name": row["name"],
        "visionDescription": row["vision_description"],
        "userIntent": row["user_intent"],
        "roleDefault": row["role_default"],
        "createdAt": row["created_at"],
        "lastUsedAt": row["last_used_at"],
    }
```

- [ ] **Step 3: 단위 테스트 작성 (temp DB 격리)**

`backend/tests/studio/test_reference_templates.py` 신규:

```python
"""reference_templates CRUD + 보안 단위 테스트.

production DB 오염 방지 — tmp_path fixture + _DB_PATH monkeypatch.
"""

import pytest

from studio import history_db


@pytest.fixture
async def temp_db(tmp_path, monkeypatch):
    """각 테스트마다 격리된 임시 DB."""
    db_path = str(tmp_path / "test_history.db")
    monkeypatch.setattr(history_db, "_DB_PATH", db_path)
    await history_db.init_studio_history_db()
    yield db_path


@pytest.mark.asyncio
async def test_insert_and_list(temp_db):
    new_id = await history_db.insert_reference_template({
        "imageRef": "/images/studio/reference-templates/test1.png",
        "name": "검정 드레스",
        "visionDescription": "Black mini dress",
        "userIntent": "이 옷 스타일로",
        "roleDefault": "outfit",
    })
    assert new_id.startswith("tpl-")
    items = await history_db.list_reference_templates()
    assert any(i["id"] == new_id for i in items)
    item = next(i for i in items if i["id"] == new_id)
    assert item["name"] == "검정 드레스"
    assert item["roleDefault"] == "outfit"


@pytest.mark.asyncio
async def test_delete_returns_image_ref(temp_db):
    new_id = await history_db.insert_reference_template({
        "imageRef": "/images/studio/reference-templates/test2.png",
        "name": "테스트",
    })
    deleted, image_ref = await history_db.delete_reference_template(new_id)
    assert deleted is True
    assert image_ref == "/images/studio/reference-templates/test2.png"


@pytest.mark.asyncio
async def test_delete_nonexistent_returns_false(temp_db):
    deleted, image_ref = await history_db.delete_reference_template(
        "tpl-nonexistent"
    )
    assert deleted is False
    assert image_ref is None


@pytest.mark.asyncio
async def test_touch_updates_last_used(temp_db):
    new_id = await history_db.insert_reference_template({
        "imageRef": "/images/studio/reference-templates/test3.png",
        "name": "터치",
    })
    items_before = await history_db.list_reference_templates()
    assert next(i for i in items_before if i["id"] == new_id)["lastUsedAt"] is None

    ok = await history_db.touch_reference_template(new_id)
    assert ok is True

    items_after = await history_db.list_reference_templates()
    item = next(i for i in items_after if i["id"] == new_id)
    assert item["lastUsedAt"] is not None
```

- [ ] **Step 4: 테스트 실행**

Run: `cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/studio/test_reference_templates.py -v`
Expected: `4 passed`

- [ ] **Step 5: 전체 pytest**

Run: `D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `226 passed` (222 + 4)

- [ ] **Step 6: Commit (사용자 승인 후만)**

```bash
git add backend/studio/history_db.py backend/tests/studio/test_reference_templates.py
git commit -m "feat(edit-lib): reference_templates CRUD + 단위 테스트 (temp DB 격리)"
```

---

## Task 3: reference 영구 저장 + path traversal 보안

**Files:**
- Create: `backend/studio/reference_storage.py` (**NEW**)

- [ ] **Step 1: 모듈 작성 (PIL 재인코딩 + path 검증)**

```python
"""
reference_storage.py — reference template 이미지 영구 저장 + vision 분석 (Phase 6).

저장 위치: data/images/studio/reference-templates/<uuid32>.<ext>
URL prefix: /images/studio/reference-templates/<filename>

PIL 재인코딩: 업로드 bytes 를 PIL.Image 로 한번 열어 검증 + 같은 포맷으로 재저장
(메타데이터 정리 + 확장자 일치 보장).

비전 분석: vision_pipeline._describe_image (기존 system_prompt 파라미터 재사용).
실패 graceful (description=None 으로 저장 진행).
"""

from __future__ import annotations

import io
import logging
import re
import uuid
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from .presets import DEFAULT_OLLAMA_ROLES
from .storage import STUDIO_OUTPUT_DIR, STUDIO_URL_PREFIX
from .vision_pipeline import _describe_image

log = logging.getLogger(__name__)

REFERENCE_DIR = STUDIO_OUTPUT_DIR / "reference-templates"
REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
REFERENCE_URL_PREFIX = f"{STUDIO_URL_PREFIX}/reference-templates"

# PIL 형식 → 확장자 매핑 (재인코딩 시 일관성)
_FORMAT_TO_EXT = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}
_VALID_EXTS = ("png", "jpg", "jpeg", "webp")
_FILENAME_RE = re.compile(r"^[0-9a-f]{32}\.(png|jpg|jpeg|webp)$")


def save_reference_image(image_bytes: bytes) -> str:
    """이미지 bytes 를 PIL 재인코딩 후 영구 저장 → URL 반환.

    PIL 로 한번 열어서 형식 검증 + 같은 포맷으로 재저장 (메타데이터 정리).
    실패 시 UnidentifiedImageError 전파.

    Returns:
        URL 형식 (/images/studio/reference-templates/<uuid32>.<ext>)
    """
    with Image.open(io.BytesIO(image_bytes)) as im:
        fmt = (im.format or "PNG").upper()
        ext = _FORMAT_TO_EXT.get(fmt, "png")
        new_name = f"{uuid.uuid4().hex}.{ext}"
        save_path = REFERENCE_DIR / new_name
        # PIL 재인코딩 — 메타데이터 EXIF 등 정리 + RGB 변환 (RGBA 보존은 PNG/WebP 만)
        save_kwargs: dict = {}
        save_format = "PNG" if ext == "png" else ("JPEG" if ext == "jpg" else "WEBP")
        if save_format == "JPEG" and im.mode != "RGB":
            im = im.convert("RGB")
        im.save(save_path, format=save_format, **save_kwargs)
    return f"{REFERENCE_URL_PREFIX}/{new_name}"


def reference_path_from_url(url: str) -> Path | None:
    """URL → 실 파일 경로 변환 (path traversal 방어).

    storage._result_path_from_url 패턴 동일.
    허용: /images/studio/reference-templates/<uuid32>.<ext>
    거부: ../, %2f, backslash, query/hash, bad prefix, depth >= 2
    """
    if not url:
        return None
    prefix = REFERENCE_URL_PREFIX + "/"
    if not url.startswith(prefix):
        return None
    rel = url[len(prefix):].split("?", 1)[0].split("#", 1)[0]
    if "\\" in rel or "/" in rel:
        return None
    if not _FILENAME_RE.match(rel):
        return None
    candidate = (REFERENCE_DIR / rel).resolve()
    try:
        if not candidate.is_relative_to(REFERENCE_DIR.resolve()):
            return None
    except (OSError, ValueError):
        return None
    return candidate


def delete_reference_file(url: str) -> bool:
    """파일 삭제 — URL 검증 후 unlink. 실패 graceful (False 반환)."""
    path = reference_path_from_url(url)
    if path is None or not path.exists():
        return False
    try:
        path.unlink()
        return True
    except OSError as e:
        log.warning("reference 파일 삭제 실패: %s", e)
        return False


async def analyze_reference(
    image_bytes: bytes,
    role: str | None,
    user_intent: str | None,
    vision_model: str | None = None,
    ollama_url: str | None = None,
) -> str | None:
    """qwen2.5vl 1회 호출 — reference 의 핵심 description 생성 (영문).

    role + user_intent 컨텍스트를 system_prompt 에 주입 → 사용자가 *원하는 측면*
    위주로 묘사. _describe_image 의 기존 system_prompt 파라미터 재사용.

    Returns: 영문 description 또는 None (실패 시).
    """
    resolved_vision = vision_model or DEFAULT_OLLAMA_ROLES.vision
    role_clause = f"User wants to use this as a {role} reference. " if role else ""
    intent_clause = f"User intent: {user_intent}. " if user_intent else ""
    system_prompt = (
        f"{role_clause}{intent_clause}"
        "Describe the key visual elements of this image in 1-2 short sentences "
        "that are relevant to the user's intended use. Focus on concrete features. "
        "Output English only, no markdown."
    )
    try:
        desc = await _describe_image(
            image_bytes,
            vision_model=resolved_vision,
            timeout=60.0,
            ollama_url=ollama_url,
            system_prompt=system_prompt,
        )
        return desc.strip() or None
    except Exception as e:
        log.warning("reference vision 분석 실패: %s", e)
        return None
```

> ⚠️ **참고:** `_describe_image` 의 정확한 시그니처는 `vision_pipeline.py:531` 부근 확인. `system_prompt: str = VISION_SYSTEM` 형태로 이미 받음 (Codex 리뷰 검증). keyword-only 호출.

- [ ] **Step 2: 단위 테스트 — path traversal 보안 + 정상 경로**

`backend/tests/studio/test_reference_templates.py` 에 추가:

```python
from studio.reference_storage import (
    delete_reference_file,
    reference_path_from_url,
    save_reference_image,
)
from PIL import Image
import io


def _make_png_bytes(width: int = 100, height: int = 100) -> bytes:
    """단순 단색 PNG bytes 생성 — 테스트용."""
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color="red").save(buf, format="PNG")
    return buf.getvalue()


def test_save_reference_image_returns_valid_url(tmp_path, monkeypatch):
    from studio import reference_storage
    monkeypatch.setattr(reference_storage, "REFERENCE_DIR", tmp_path)

    url = reference_storage.save_reference_image(_make_png_bytes())
    assert url.startswith(reference_storage.REFERENCE_URL_PREFIX + "/")
    assert url.endswith(".png")


def test_save_reference_image_rejects_invalid_bytes():
    from studio.reference_storage import save_reference_image
    with pytest.raises(UnidentifiedImageError):
        save_reference_image(b"not an image")


@pytest.mark.parametrize("evil_url", [
    "../../etc/passwd",
    "/images/studio/reference-templates/../leak.png",
    "/images/studio/reference-templates/%2e%2e/leak.png",
    "/images/studio/reference-templates/file.png?query=1",
    "/images/studio/reference-templates/file.png#hash",
    "/images/studio/reference-templates/sub/file.png",
    "/images/studio/reference-templates/file.exe",
    "/images/studio/edit-source/file.png",  # 다른 prefix
    "/images/studio/reference-templates/" + "x" * 10 + ".png",  # uuid32 아님
    "/images/studio/reference-templates/abc\\evil.png",  # backslash
])
def test_reference_path_from_url_rejects_evil(evil_url):
    """Path traversal 공격 벡터 거부."""
    assert reference_path_from_url(evil_url) is None


def test_reference_path_from_url_accepts_valid_uuid32():
    """정상 uuid32 + 허용 확장자만 통과."""
    valid_url = (
        "/images/studio/reference-templates/"
        + "0" * 32 + ".png"
    )
    # 실제 파일이 없어도 path 자체는 반환됨 (호출 측이 .exists() 체크)
    result = reference_path_from_url(valid_url)
    assert result is not None
    assert result.name == "0" * 32 + ".png"


def test_delete_reference_file_evil_url_returns_false():
    """악성 URL 은 False 반환 (404 보호)."""
    from studio.reference_storage import delete_reference_file
    assert delete_reference_file("../../etc/passwd") is False
```

- [ ] **Step 3: 테스트 실행**

Run: `D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/studio/test_reference_templates.py -v`
Expected: 모든 path traversal 케이스 + 정상 케이스 통과 (총 ~16 테스트)

- [ ] **Step 4: Commit (사용자 승인 후만)**

```bash
git add backend/studio/reference_storage.py backend/tests/studio/test_reference_templates.py
git commit -m "feat(edit-lib): reference_storage 영구 저장 + path traversal 보안 + PIL 재인코딩"
```

---

## Task 4: Backend reference templates 라우트

**Files:**
- Create: `backend/studio/routes/reference_templates.py` (**NEW**)
- Modify: `backend/studio/routes/__init__.py` (라우터 등록 — Codex 2차 리뷰 fix #7)

> ⚠️ **Codex 2차 리뷰 fix #7:** 등록 위치는 `backend/studio/routes/__init__.py` 의 `studio_router.include_router(...)` 패턴. `backend/studio/router.py` 는 facade/re-export (`from .routes import studio_router as router`) 라 직접 등록 대상 아님 — 건드리지 않음.

- [ ] **Step 1: 라우터 4 endpoints (insert 실패 시 파일 롤백 포함)**

```python
"""
studio.routes.reference_templates — Edit reference template 라이브러리 CRUD.

DB insert 실패 시 방금 저장한 reference 파일 자동 unlink (orphan 방지).
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from PIL import UnidentifiedImageError

from .. import history_db
from ..reference_storage import (
    analyze_reference,
    delete_reference_file,
    save_reference_image,
)
from ..storage import STUDIO_MAX_IMAGE_BYTES

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/reference-templates")
async def list_templates():
    """저장된 reference templates — last_used_at 내림차순."""
    items = await history_db.list_reference_templates()
    return {"items": items}


@router.post("/reference-templates")
async def create_template(
    image: UploadFile = File(...),
    meta: str = Form(...),
):
    """신규 template 저장 — 이미지 + 메타 + 자동 vision 분석.

    meta = { name: str, role: str?, userIntent: str?, visionModel: str? }

    실패 정책:
      - 이미지 invalid: 400 (저장 X)
      - PIL 재인코딩 실패: 400 (저장 X)
      - DB insert 실패: 저장된 파일 unlink + 500 (orphan 방지)
      - vision 분석 실패: graceful — visionDescription=None 으로 저장 계속
    """
    try:
        meta_obj = json.loads(meta)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"meta JSON invalid: {e}") from e

    name = (meta_obj.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    role = meta_obj.get("role")
    user_intent = meta_obj.get("userIntent")
    vision_model = meta_obj.get("visionModel")

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(400, "empty image")
    if len(image_bytes) > STUDIO_MAX_IMAGE_BYTES:
        raise HTTPException(
            413,
            f"image too large: {len(image_bytes)} bytes (max {STUDIO_MAX_IMAGE_BYTES})",
        )

    # 1) PIL 검증 + 영구 저장
    try:
        image_url = save_reference_image(image_bytes)
    except UnidentifiedImageError as e:
        raise HTTPException(400, f"invalid image format: {e}") from e

    # 2) Vision 분석 (실패 graceful)
    try:
        vision_desc = await analyze_reference(
            image_bytes, role, user_intent, vision_model=vision_model
        )
    except Exception as e:
        log.warning("vision 분석 예외 (graceful): %s", e)
        vision_desc = None

    # 3) DB insert — 실패 시 파일 롤백
    try:
        new_id = await history_db.insert_reference_template({
            "imageRef": image_url,
            "name": name,
            "visionDescription": vision_desc,
            "userIntent": user_intent,
            "roleDefault": role,
        })
    except Exception as e:
        # Orphan 방지 — 방금 저장한 파일 정리
        delete_reference_file(image_url)
        log.exception("reference template DB insert 실패 — 파일 롤백")
        raise HTTPException(500, f"db insert failed: {e}") from e

    items = await history_db.list_reference_templates()
    saved = next((i for i in items if i["id"] == new_id), None)
    return {"item": saved}


@router.delete("/reference-templates/{template_id}")
async def delete_template(template_id: str):
    """삭제 — DB row + 이미지 파일 모두 정리. Soft 삭제 (옛 history 의 reference_ref 보존)."""
    deleted, image_ref = await history_db.delete_reference_template(template_id)
    if not deleted:
        raise HTTPException(404, "template not found")
    if image_ref:
        delete_reference_file(image_ref)
    return {"ok": True}


@router.post("/reference-templates/{template_id}/touch")
async def touch_template(template_id: str):
    """last_used_at 갱신 — 사용자가 이 템플릿으로 수정 실행 시."""
    ok = await history_db.touch_reference_template(template_id)
    if not ok:
        raise HTTPException(404, "template not found")
    return {"ok": True}
```

- [ ] **Step 2: 라우터 등록 (`routes/__init__.py` only)**

`backend/studio/routes/__init__.py` 의 기존 `include_router` 블록 끝에 추가:

```python
# 기존:
from . import compare, prompt, streams, system, vision

studio_router = APIRouter(prefix="/api/studio", tags=["studio"])

studio_router.include_router(streams.router)
studio_router.include_router(prompt.router)
studio_router.include_router(vision.router)
studio_router.include_router(compare.router)
studio_router.include_router(system.router)

# 추가 (2026-04-27 Phase 6):
from . import reference_templates  # noqa: E402

studio_router.include_router(reference_templates.router)
```

> ⚠️ `backend/studio/router.py` 는 *수정 X* — facade `from .routes import studio_router as router` 자체는 그대로.

- [ ] **Step 3: OpenAPI snapshot 갱신 (Codex 2차 리뷰 fix #8 — 순서 명시)**

> ⚠️ **타이밍:** 새 라우트 추가 직후 backend OpenAPI snapshot 갱신.
> Frontend `npm run gen:types` 는 그 *다음* (Task 5 의 Step 3). 즉 Backend → Frontend 순.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/studio/test_openapi_contract.py -q`
Expected: `1 passed`

- [ ] **Step 4: 전체 pytest**

Run: `D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `226+ passed`

- [ ] **Step 5: Commit (사용자 승인 후만)**

```bash
# 사용자 "커밋해" 명시 후에만:
git add backend/studio/routes/reference_templates.py backend/studio/routes/__init__.py backend/tests/_snapshots/openapi.json
git commit -m "feat(edit-lib): /reference-templates 라우트 — list/create/delete/touch + 파일 롤백"
```

---

## Task 5: Frontend types + API 클라이언트

**Files:**
- Modify: `frontend/lib/api/types.ts` — `ReferenceTemplate` interface
- Create: `frontend/lib/api/reference-templates.ts` (**NEW**)

- [ ] **Step 1: types.ts 의 ReferenceTemplate interface**

```typescript
export interface ReferenceTemplate {
  id: string;
  imageRef: string;
  name: string;
  visionDescription: string | null;
  userIntent: string | null;
  roleDefault: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}
```

- [ ] **Step 2: API 클라이언트 4 함수 + URL 정규화 helper (Codex 2차 리뷰 fix #6)**

> ⚠️ **Codex 2차 리뷰 fix #6:** API 가 `/images/studio/...` 같은 *상대 URL* 반환할 수 있음. Frontend 가 이걸 그대로 `<img src=...>` 에 쓰면 Next.js origin 으로 fetch 됨 (백엔드 origin 아님). `normalizeItem()` 패턴을 따라 `STUDIO_BASE` 기준으로 절대 URL 변환하는 helper 추가.

```typescript
/**
 * lib/api/reference-templates.ts — Edit reference template 라이브러리 API.
 */

import { STUDIO_BASE, USE_MOCK } from "./client";
import type { ReferenceTemplate } from "./types";

/** ReferenceTemplate 의 imageRef 를 STUDIO_BASE 기준 절대 URL 로 정규화.
 *  Codex 2차 리뷰 fix #6 — `normalizeItem()` 과 동일 패턴.
 *  - mock-seed:// 또는 absolute URL (http/https) 은 그대로
 *  - /images/studio/... 같은 상대 path 는 STUDIO_BASE prefix 추가
 */
function normalizeReferenceTemplate(t: ReferenceTemplate): ReferenceTemplate {
  let ref = t.imageRef;
  if (
    ref &&
    !ref.startsWith("http://") &&
    !ref.startsWith("https://") &&
    !ref.startsWith("data:") &&
    !ref.startsWith("mock-seed://")
  ) {
    // 상대 path → STUDIO_BASE prefix
    ref = `${STUDIO_BASE}${ref.startsWith("/") ? "" : "/"}${ref}`;
  }
  return { ...t, imageRef: ref };
}

export async function listReferenceTemplates(): Promise<ReferenceTemplate[]> {
  if (USE_MOCK) return [];
  try {
    const res = await fetch(`${STUDIO_BASE}/api/studio/reference-templates`);
    if (!res.ok) return [];
    const data = (await res.json()) as { items: ReferenceTemplate[] };
    // Codex fix #6: 모든 imageRef 정규화
    return data.items.map(normalizeReferenceTemplate);
  } catch {
    return [];
  }
}

export async function createReferenceTemplate(req: {
  imageFile: File | string; // File 또는 data URL
  name: string;
  role?: string;
  userIntent?: string;
  visionModel?: string;
}): Promise<ReferenceTemplate | null> {
  if (USE_MOCK) return null;
  const form = new FormData();
  if (typeof req.imageFile === "string") {
    const res = await fetch(req.imageFile);
    if (!res.ok) {
      throw new Error(`image fetch ${res.status}: ${req.imageFile.slice(0, 80)}`);
    }
    const blob = await res.blob();
    form.append("image", blob, "reference.png");
  } else {
    form.append("image", req.imageFile);
  }
  form.append(
    "meta",
    JSON.stringify({
      name: req.name,
      role: req.role,
      userIntent: req.userIntent,
      visionModel: req.visionModel,
    }),
  );
  const res = await fetch(`${STUDIO_BASE}/api/studio/reference-templates`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`create template failed: ${res.status}`);
  }
  const data = (await res.json()) as { item: ReferenceTemplate };
  // Codex fix #6: 반환 시점에도 정규화
  return normalizeReferenceTemplate(data.item);
}

export async function deleteReferenceTemplate(id: string): Promise<boolean> {
  if (USE_MOCK) return true;
  const res = await fetch(`${STUDIO_BASE}/api/studio/reference-templates/${id}`, {
    method: "DELETE",
  });
  return res.ok;
}

export async function touchReferenceTemplate(id: string): Promise<boolean> {
  if (USE_MOCK) return true;
  try {
    const res = await fetch(
      `${STUDIO_BASE}/api/studio/reference-templates/${id}/touch`,
      { method: "POST" },
    );
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: gen:types 갱신 (Codex 2차 리뷰 fix #8 — 순서 명시)**

> ⚠️ **타이밍:** Backend Task 4 의 OpenAPI snapshot 갱신 *이후* 실행. 즉 backend → frontend 순. 그렇지 않으면 generated.ts 가 옛 schema 로 남아있음.

Run: `cd frontend && npm run gen:types`
Expected: 0 에러

- [ ] **Step 4: tsc clean 검증**

Run: `npx tsc --noEmit; echo EXIT=$?`
Expected: `EXIT=0`

- [ ] **Step 5: 단위 테스트 — URL 정규화 동작**

`frontend/__tests__/reference-templates-api.test.ts` (**NEW**):

```typescript
import { describe, expect, it, vi } from "vitest";
import { listReferenceTemplates } from "@/lib/api/reference-templates";

describe("listReferenceTemplates - URL 정규화 (Codex 2차 리뷰 fix #6)", () => {
  it("상대 path 는 STUDIO_BASE prefix 추가", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({
        items: [{
          id: "tpl-1",
          imageRef: "/images/studio/reference-templates/abc.png",
          name: "test",
          visionDescription: null,
          userIntent: null,
          roleDefault: null,
          createdAt: 0,
          lastUsedAt: null,
        }]
      }), { status: 200 }))
    ) as unknown as typeof fetch;

    const items = await listReferenceTemplates();
    // 절대 URL 로 변환됐는지 (http://localhost:8001 같은 prefix)
    expect(items[0].imageRef).toMatch(/^https?:\/\/.+\/images\/studio\/reference-templates\/abc\.png$/);
  });

  it("이미 절대 URL 이면 그대로", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({
        items: [{
          id: "tpl-2",
          imageRef: "https://example.com/x.png",
          name: "test",
          visionDescription: null,
          userIntent: null,
          roleDefault: null,
          createdAt: 0,
          lastUsedAt: null,
        }]
      }), { status: 200 }))
    ) as unknown as typeof fetch;

    const items = await listReferenceTemplates();
    expect(items[0].imageRef).toBe("https://example.com/x.png");
  });
});
```

Run: `npm test -- reference-templates-api 2>&1 | tail -3`
Expected: `2 passed`

- [ ] **Step 6: Commit (사용자 승인 후만)**

```bash
# 사용자 "커밋해" 명시 후에만:
git add frontend/lib/api/reference-templates.ts frontend/lib/api/types.ts frontend/lib/api/openapi.json frontend/lib/api/generated.ts frontend/__tests__/reference-templates-api.test.ts
git commit -m "feat(edit-lib): frontend reference-templates API + URL 정규화 + 타입"
```

---

## Task 6: ReferenceLibraryDrawer 컴포넌트

> ⚠️ **Soft delete fallback UX (2026-04-28 보강):**
> 이 plan 의 삭제 정책은 Soft — DB row + 이미지 파일 삭제 후, 옛 `history.referenceRef` URL 은 보존. 그래서 *옛 history 행* 의 이미지 fetch 가 404 가 됨.
>
> **검증 필수:** TemplateCard / history 의 Before/After 슬라이더 / ResultInfoModal 등 `referenceRef` 를 표시하는 모든 `<img>` 에 `onError` fallback 처리 추가 — 빈 박스 + "삭제된 템플릿" 안내 문구 표시. console error spam 방지.
>
> **이 Task 의 TemplateCard 자체는 살아있는 템플릿만 표시 (404 케이스 0)** — 다만 Multi-Reference 본 plan 의 `BeforeAfterSlider` / `ResultInfoModal` / `HistoryGallery` 가 history.referenceRef 를 fetch 할 때 fallback 필요. 이 plan 의 후속 verification step 에서 *grep `referenceRef` → `<img>` 사용 site* 모두 onError 추가했는지 확인.

**Files:**
- Create: `frontend/components/studio/edit/ReferenceLibraryDrawer.tsx` (**NEW**)

- [ ] **Step 1: Drawer 컴포넌트 작성**

(Multi-Reference plan 의 Task 24 코드 그대로 사용. 대표 코드만 표시)

```typescript
/**
 * ReferenceLibraryDrawer — 저장된 reference templates 라이브러리 뷰어 (Phase 6).
 *
 * 사용 흐름:
 *  1. 저장된 templates grid 표시 (이름 + 썸네일 + role + 사용 빈도)
 *  2. 클릭 → 두번째 SourceImageCard 자동 채움 + drawer 닫음
 *  3. 우측 [×] → 확인 모달 후 삭제
 *  4. 픽 시 last_used_at 자동 갱신 (touch endpoint)
 */

"use client";

import { useEffect, useState } from "react";
import {
  deleteReferenceTemplate,
  listReferenceTemplates,
  touchReferenceTemplate,
} from "@/lib/api/reference-templates";
import type { ReferenceTemplate } from "@/lib/api/types";
import { toast } from "@/stores/useToastStore";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (template: ReferenceTemplate) => void;
}

export default function ReferenceLibraryDrawer({
  open,
  onClose,
  onPick,
}: Props) {
  const [templates, setTemplates] = useState<ReferenceTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const list = await listReferenceTemplates();
      if (!cancelled) {
        setTemplates(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handlePick = async (t: ReferenceTemplate) => {
    onPick(t);
    onClose();
    void touchReferenceTemplate(t.id); // 결과 무시 (실패해도 UX 영향 X)
  };

  const handleDelete = async (t: ReferenceTemplate) => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `"${t.name}" 템플릿을 삭제할까요? (되돌릴 수 없음)`,
      );
      if (!ok) return;
    }
    const success = await deleteReferenceTemplate(t.id);
    if (!success) {
      toast.error("삭제 실패");
      return;
    }
    setTemplates((prev) => prev.filter((p) => p.id !== t.id));
    toast.success("템플릿 삭제됨");
  };

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(23,20,14,.32)",
          zIndex: 50,
        }}
      />
      {/* Drawer */}
      <aside
        role="dialog"
        aria-label="참조 템플릿 라이브러리"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          maxWidth: "100vw",
          background: "var(--bg)",
          borderLeft: "1px solid var(--line)",
          boxShadow: "var(--shadow-lg)",
          zIndex: 51,
          display: "flex",
          flexDirection: "column",
          padding: "20px 24px",
          gap: 14,
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", margin: 0 }}>
            📂 참조 템플릿 라이브러리
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{ all: "unset", cursor: "pointer", fontSize: 18, color: "var(--ink-3)" }}
          >
            ×
          </button>
        </div>

        {loading && (
          <div style={{ fontSize: 12, color: "var(--ink-4)" }}>불러오는 중…</div>
        )}

        {!loading && templates.length === 0 && (
          <div
            style={{
              padding: "30px 20px",
              textAlign: "center",
              fontSize: 12.5,
              color: "var(--ink-4)",
              border: "1px dashed var(--line-2)",
              borderRadius: "var(--radius)",
            }}
          >
            저장된 템플릿이 없어요.<br />
            참조 이미지 사용 시 "템플릿으로 저장" 으로 추가하세요.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onPick={() => handlePick(t)}
              onDelete={() => handleDelete(t)}
            />
          ))}
        </div>
      </aside>
    </>
  );
}

function TemplateCard({
  template,
  onPick,
  onDelete,
}: {
  template: ReferenceTemplate;
  onPick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        position: "relative",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        cursor: "pointer",
      }}
      onClick={onPick}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={template.imageRef}
        alt={template.name}
        style={{
          width: "100%",
          height: 140,
          objectFit: "cover",
          display: "block",
          background: "var(--bg-2)",
        }}
      />
      <div style={{ padding: "8px 10px" }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {template.name}
        </div>
        {template.roleDefault && (
          <div style={{ fontSize: 10, color: "var(--ink-4)", marginTop: 2 }}>
            {template.roleDefault}
          </div>
        )}
        {template.visionDescription && (
          <div
            style={{
              fontSize: 10.5,
              color: "var(--ink-3)",
              marginTop: 4,
              lineHeight: 1.4,
              maxHeight: 28,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={template.visionDescription}
          >
            {template.visionDescription}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="삭제"
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "rgba(0,0,0,.55)",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          fontSize: 12,
          display: "grid",
          placeItems: "center",
        }}
      >
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 2: tsc + lint clean**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean

- [ ] **Step 3: Commit (사용자 승인 후만)**

```bash
git add frontend/components/studio/edit/ReferenceLibraryDrawer.tsx
git commit -m "feat(edit-lib): ReferenceLibraryDrawer — 라이브러리 grid + pick/delete"
```

---

## Task 7: useEditStore 확장 + EditLeftPanel 통합

**Files:**
- Modify: `frontend/stores/useEditStore.ts`
- Modify: `frontend/components/studio/edit/EditLeftPanel.tsx`

- [ ] **Step 1: store 에 라이브러리 관련 필드 + setter (Codex 2차 리뷰 fix #5 — `pickedTemplateRef` 추가)**

```typescript
  /** 사용자가 새 reference 사용 시 라이브러리에 저장할지 토글 */
  saveAsTemplate: boolean;
  templateName: string;
  /** 라이브러리에서 픽한 template id (있으면 saveAsTemplate 자동 비활성) */
  pickedTemplateId: string | null;
  /** 라이브러리에서 픽한 template 의 영구 imageRef URL.
   *  Codex 2차 리뷰 fix #5 — history.referenceRef 에 영구 URL 저장하기 위해
   *  store 에서 함께 보관 후 multipart meta 로 백엔드에 전달.
   *  pickedTemplateId 와 짝 — 둘 다 null 이거나 둘 다 set. */
  pickedTemplateRef: string | null;

  setSaveAsTemplate: (v: boolean) => void;
  setTemplateName: (v: string) => void;
  setPickedTemplateId: (id: string | null) => void;
  setPickedTemplateRef: (ref: string | null) => void;
```

기본값 `false / "" / null / null`. 액션 setter 단순.

`setReferenceImage` 에 한 가지 보조 동작 — 사용자가 새 이미지 직접 업로드 시 `pickedTemplateId` + `pickedTemplateRef` 자동 null:

```typescript
  setReferenceImage: (image, label, w, h) =>
    set({
      referenceImage: image,
      referenceLabel: label ?? "참조 이미지를 업로드해 주세요",
      referenceWidth: w ?? null,
      referenceHeight: h ?? null,
      pickedTemplateId: null,
      pickedTemplateRef: null,  // 새 업로드 → 라이브러리 픽 상태 둘 다 해제
    }),
```

- [ ] **Step 2: EditLeftPanel 에 라이브러리 버튼 + Drawer + 저장 토글**

import:
```typescript
import { useState } from "react";
import ReferenceLibraryDrawer from "./ReferenceLibraryDrawer";
import type { ReferenceRoleId } from "@/stores/useEditStore";
```

컴포넌트 상태:
```typescript
const [libraryOpen, setLibraryOpen] = useState(false);
```

두번째 SourceImageCard 직후 + ReferenceRoleSelect 직전에 라이브러리 버튼:

```tsx
<button
  type="button"
  onClick={() => setLibraryOpen(true)}
  style={{
    all: "unset",
    cursor: "pointer",
    padding: "6px 12px",
    fontSize: 11.5,
    fontWeight: 500,
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--line)",
    background: "var(--bg)",
    color: "var(--ink-2)",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
  }}
>
  📂 라이브러리에서 선택
</button>
```

ReferenceRoleSelect 직후 (또는 referenceImage 있고 pickedTemplateId === null 일 때만):

```tsx
{referenceImage && pickedTemplateId === null && (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <Toggle
      checked={saveAsTemplate}
      onChange={setSaveAsTemplate}
      align="right"
      label="📌 라이브러리에 저장"
      desc={
        saveAsTemplate
          ? "수정 실행 시 템플릿으로 저장 + 비전 분석"
          : "이번만 사용 (저장 X)"
      }
    />
    {saveAsTemplate && (
      <input
        type="text"
        value={templateName}
        onChange={(e) => setTemplateName(e.target.value)}
        placeholder="템플릿 이름 (예: 검정 미니 드레스)"
        style={{
          all: "unset",
          display: "block",
          width: "100%",
          boxSizing: "border-box",
          padding: "8px 10px",
          fontSize: 12,
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-sm)",
          background: "var(--surface)",
          color: "var(--ink)",
        }}
      />
    )}
  </div>
)}
```

Drawer 마운트 (컴포넌트 return JSX 끝):

```tsx
<ReferenceLibraryDrawer
  open={libraryOpen}
  onClose={() => setLibraryOpen(false)}
  onPick={(t) => {
    // 라이브러리에서 픽 — 두번째 카드 자동 채움 + 재저장 OFF.
    // setReferenceImage 가 pickedTemplateId/Ref 둘 다 null 로 초기화하므로
    // 그 *직후* picked 두 값을 다시 설정해야 함 (순서 중요).
    setReferenceImage(t.imageRef, t.name, /* w */ 0, /* h */ 0);
    if (t.roleDefault && ["face", "outfit", "style", "background", "custom"].includes(t.roleDefault)) {
      setReferenceRole(t.roleDefault as ReferenceRoleId);
    }
    setPickedTemplateId(t.id);
    setPickedTemplateRef(t.imageRef);  // ← Codex 2차 리뷰 fix #5: 영구 URL 보관
    setSaveAsTemplate(false);
    toast.success("템플릿 적용", t.name);
  }}
/>
```

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -3`
Expected: clean + `55 passed`

- [ ] **Step 4: Commit (사용자 승인 후만)**

```bash
# 사용자 "커밋해" 명시 후에만:
git add frontend/stores/useEditStore.ts frontend/components/studio/edit/EditLeftPanel.tsx
git commit -m "feat(edit-lib): EditLeftPanel — 라이브러리 버튼 + Drawer + 저장 토글 통합 + pickedTemplateRef"
```

---

## Task 7b: editImageStream meta 에 referenceTemplateId 전송 + backend referenceRef 조회 (Codex 2차/3차 리뷰 fix)

**Files:**
- Modify: `frontend/lib/api/types.ts` (`EditRequest` 확장)
- Modify: `frontend/lib/api/edit.ts` (multipart meta 빌드)
- Modify: `frontend/hooks/useEditPipeline.ts` (store 구독 + 전송)
- Modify: `backend/studio/routes/streams.py` (meta 에서 추출)
- Modify: `backend/studio/pipelines/edit.py` (history item 에 저장 + touch 호출)

> ⚠️ **Codex 2차 리뷰 fix #5:** Multi-reference 본 plan 의 history.referenceRef 가
> Phase 5 에서는 항상 None. Library plan 진입 후 *라이브러리 픽 케이스* 에서만
> 영구 URL 이 전달됨. 그 흐름을 명시.

- [ ] **Step 1: types.ts EditRequest 확장**

```typescript
export interface EditRequest {
  // ... 기존 필드 (Multi-Reference plan 에서 추가된 useReferenceImage / referenceImage / referenceRole 포함)

  /** Library 픽 케이스 (Phase 6) — 프론트 fetch/display 용 URL.
   *  Codex 3차 리뷰 fix: backend 는 이 값을 DB 저장 근거로 신뢰하지 않음.
   *  absolute URL 일 수 있으므로 history.referenceRef 는 referenceTemplateId 로 DB 조회해 결정. */
  referenceRef?: string;
  /** Library 픽 케이스 — template id. 백엔드가 DB image_ref 조회 + last_used_at touch 에 사용. */
  referenceTemplateId?: string;
}
```

- [ ] **Step 2: edit.ts 의 multipart meta 빌드 갱신**

`frontend/lib/api/edit.ts` 의 meta JSON 에 두 필드 추가 (조건부):

```typescript
  form.append(
    "meta",
    JSON.stringify({
      prompt: req.prompt,
      lightning: req.lightning ?? false,
      ollamaModel: req.ollamaModel,
      visionModel: req.visionModel,
      useReferenceImage: req.useReferenceImage ?? false,
      referenceRole: req.useReferenceImage ? req.referenceRole : undefined,
      // Codex 2차/3차 리뷰 fix — library 픽 케이스만 (Phase 6).
      // referenceRef 는 프론트 디버그/호환용. backend DB 저장은 referenceTemplateId 조회가 권위.
      referenceRef: req.useReferenceImage ? req.referenceRef : undefined,
      referenceTemplateId: req.useReferenceImage ? req.referenceTemplateId : undefined,
    }),
  );
```

- [ ] **Step 3: useEditPipeline 에서 store → editImageStream**

```typescript
const pickedTemplateId = useEditStore((s) => s.pickedTemplateId);
const pickedTemplateRef = useEditStore((s) => s.pickedTemplateRef);

// editImageStream 호출 시:
await consumePipelineStream(
  editImageStream({
    sourceImage,
    prompt,
    lightning,
    ollamaModel: ollamaModelSel,
    visionModel: visionModelSel,
    useReferenceImage,
    referenceImage: useReferenceImage ? referenceImage : undefined,
    referenceRole: useReferenceImage ? effectiveRole : undefined,
    // Codex 3차 리뷰 fix: 토글 OFF 면 stale pickedTemplate 값이 있어도 전송하지 않음.
    // referenceRef 는 absolute URL 일 수 있어 backend DB 저장 근거로 쓰지 않음.
    referenceRef: useReferenceImage ? (pickedTemplateRef ?? undefined) : undefined,
    referenceTemplateId: useReferenceImage ? (pickedTemplateId ?? undefined) : undefined,
  }),
  ...
);
```

- [ ] **Step 4: Backend routes/streams.py 에서 meta 추출**

`backend/studio/routes/streams.py` 에 `history_db` import 추가:

```python
from .. import history_db
```

```python
# create_edit_task 안에서 — Multi-ref plan 의 reference_bytes 검증/게이트 직후:
# (reference_bytes 변수가 정의된 뒤여야 stale template meta 무효화가 가능)
reference_ref_meta = meta_obj.get("referenceRef")
reference_template_id = meta_obj.get("referenceTemplateId")
# 두 값 모두 string or None.
# referenceRef 는 프론트 정규화 때문에 absolute URL 일 수 있어 DB 저장 근거로 신뢰하지 않음.
# 빈 문자열은 None 으로 정규화하고, 로깅/호환용으로만 유지.
if isinstance(reference_ref_meta, str):
    reference_ref_meta = reference_ref_meta.strip() or None
else:
    reference_ref_meta = None
if isinstance(reference_template_id, str):
    reference_template_id = reference_template_id.strip() or None
else:
    reference_template_id = None

reference_ref_url: str | None = None
if use_reference_image and reference_template_id:
    # Codex 3차 리뷰 fix: DB 저장용 referenceRef 는 template id 로 DB 에서 다시 조회.
    # 클라이언트가 보낸 referenceRef 는 absolute URL 일 수 있고 조작 가능하므로 권위 없음.
    tpl = await history_db.get_reference_template(reference_template_id)
    if tpl is None:
        raise HTTPException(404, "reference template not found")
    reference_ref_url = tpl["imageRef"]  # DB 의 상대 영구 URL (/images/studio/...)

# 토글 OFF 또는 reference_image bytes 없음이면 stale template/ref 메타도 무효화.
if not use_reference_image or reference_bytes is None:
    reference_ref_url = None
    reference_template_id = None
```

`_run_edit_pipeline` 호출에 두 값 전달 (keyword):

```python
    task.worker = _spawn(
        _run_edit_pipeline(
            task,
            ...,  # 기존 인자
            reference_bytes=reference_bytes,
            reference_filename=reference_filename,
            reference_role=reference_role,
            reference_ref_url=reference_ref_url,  # 신규 — DB 조회로 얻은 상대 영구 URL
            reference_template_id=reference_template_id,  # 신규
        )
    )
```

- [ ] **Step 5: pipelines/edit.py — history.referenceRef 저장 + touch 호출**

`_run_edit_pipeline` 시그니처 확장:

```python
async def _run_edit_pipeline(
    ...,  # 기존
    reference_bytes: bytes | None = None,
    reference_filename: str | None = None,
    reference_role: str | None = None,
    reference_ref_url: str | None = None,  # 영구 URL (라이브러리 픽 케이스만)
    reference_template_id: str | None = None,  # 라이브러리 템플릿 id
) -> None:
```

dispatch 후 history item 빌드 시점에 `referenceRef` 채우기:

```python
        item = {
            ...,  # 기존 필드
            # Codex 2차 리뷰 fix #5 — 라이브러리 픽 케이스만 영구 URL 저장.
            # 옵션 A: 새 업로드 + saveAsTemplate ON 케이스도 첫 실행 history 는 None.
            "referenceRef": reference_ref_url,
            "referenceRole": effective_role,
        }

        # 라이브러리 템플릿 사용 시 last_used_at 갱신 (실패 graceful)
        if reference_template_id:
            try:
                await history_db.touch_reference_template(reference_template_id)
            except Exception as e:
                log.warning("touch_reference_template 실패 (graceful): %s", e)
```

- [ ] **Step 6: 단위 테스트 — library pick 케이스의 referenceRef round-trip**

`backend/tests/studio/test_reference_templates.py` 에 추가:

```python
@pytest.mark.asyncio
async def test_library_pick_history_referenceref_roundtrip(temp_db):
    """라이브러리 픽 후 edit history 에 referenceRef 영구 URL 저장 → list 조회 시 유지."""
    # 1. 템플릿 저장
    new_id = await history_db.insert_reference_template({
        "imageRef": "/images/studio/reference-templates/abc123.png",
        "name": "검정 드레스",
        "roleDefault": "outfit",
    })

    # 2. edit history insert (라이브러리 픽 케이스 — referenceRef 영구 URL)
    await history_db.insert_item({
        "id": "test-edit-1",
        "mode": "edit",
        "prompt": "wear this",
        "label": "test",
        "width": 1024,
        "height": 1024,
        "createdAt": 1234567890,
        "imageRef": "/images/studio/edit/2026-04-27/edit-1.png",
        "referenceRef": "/images/studio/reference-templates/abc123.png",
        "referenceRole": "outfit",
    })

    # 3. 조회 — referenceRef + referenceRole 보존 검증
    items = await history_db.list_items(mode="edit")
    item = next(i for i in items if i["id"] == "test-edit-1")
    assert item["referenceRef"] == "/images/studio/reference-templates/abc123.png"
    assert item["referenceRole"] == "outfit"
```

Run: `D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/studio/test_reference_templates.py -v`
Expected: 신규 통과

- [ ] **Step 6b: Backend route 단위 테스트 — referenceTemplateId 가 DB image_ref 를 결정**

`backend/tests/studio/test_reference_templates.py` 또는 edit route 테스트 파일에 추가:

```python
@pytest.mark.asyncio
async def test_edit_route_reference_template_id_overrides_client_referenceref(monkeypatch):
    """클라이언트 referenceRef(absolute/조작 가능) 대신 DB template.imageRef 를 history 용으로 전달."""
    import io
    import json
    from unittest.mock import AsyncMock
    from httpx import ASGITransport, AsyncClient
    from PIL import Image
    from main import app  # type: ignore

    def _png_bytes() -> bytes:
        buf = io.BytesIO()
        Image.new("RGB", (16, 16), color="red").save(buf, format="PNG")
        return buf.getvalue()

    monkeypatch.setattr(
        "studio.history_db.get_reference_template",
        AsyncMock(return_value={
            "id": "tpl-test",
            "imageRef": "/images/studio/reference-templates/db-relative.png",
            "name": "db",
        }),
    )

    captured_kwargs: dict[str, object] = {}
    def _fake_run_edit(*args, **kwargs):
        captured_kwargs.update(kwargs)
        async def _noop():
            return None
        return _noop()
    monkeypatch.setattr("studio.routes.streams._run_edit_pipeline", _fake_run_edit)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/edit",
            files={
                "image": ("src.png", io.BytesIO(_png_bytes()), "image/png"),
                "reference_image": ("ref.png", io.BytesIO(_png_bytes()), "image/png"),
            },
            data={"meta": json.dumps({
                "prompt": "test",
                "useReferenceImage": True,
                "referenceRole": "outfit",
                "referenceTemplateId": "tpl-test",
                "referenceRef": "http://evil.example/images/studio/reference-templates/wrong.png",
            })},
        )

    assert resp.status_code == 200
    assert captured_kwargs["reference_ref_url"] == "/images/studio/reference-templates/db-relative.png"
    assert captured_kwargs["reference_template_id"] == "tpl-test"
```

> Codex 3차 리뷰 fix: absolute `referenceRef` 가 DB 에 저장되는 회귀를 이 테스트로 차단.

- [ ] **Step 7: Frontend 단위 테스트 — meta 전송 검증**

`frontend/__tests__/edit-multi-ref.test.ts` 또는 `reference-templates-api.test.ts` 에 추가:

```typescript
it("library pick 후 editImageStream meta 에 referenceRef + referenceTemplateId 전달", async () => {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ task_id: "x", stream_url: "/x" }), { status: 200 }))
  ) as unknown as typeof fetch;

  const gen = editImageStream({
    // Codex 3차 리뷰 fix: File 사용으로 이미지 fetch call 과 /edit 생성 fetch call 혼동 방지.
    sourceImage: new File([new Uint8Array([1])], "src.png", { type: "image/png" }),
    prompt: "test",
    lightning: false,
    useReferenceImage: true,
    referenceImage: new File([new Uint8Array([2])], "ref.png", { type: "image/png" }),
    referenceRole: "outfit",
    // referenceRef 는 frontend 호환/디버그용으로 보낼 수 있으나 backend DB 저장 근거는 아님.
    referenceRef: "/images/studio/reference-templates/abc.png",
    referenceTemplateId: "tpl-test",
  });
  try { await gen.next(); } catch { /* ok */ }

  const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
  const [, init] = fetchMock.mock.calls[0];
  const form = init?.body as FormData;
  const meta = JSON.parse(form.get("meta") as string);

  expect(meta.referenceRef).toBe("/images/studio/reference-templates/abc.png");
  expect(meta.referenceTemplateId).toBe("tpl-test");
});
```

Run: `npm test -- edit-multi-ref 2>&1 | tail -3`
Expected: 신규 통과

- [ ] **Step 8: Commit (사용자 승인 후만)**

```bash
# 사용자 "커밋해" 명시 후에만:
git add frontend/lib/api/types.ts frontend/lib/api/edit.ts frontend/hooks/useEditPipeline.ts backend/studio/routes/streams.py backend/studio/pipelines/edit.py backend/tests/studio/test_reference_templates.py frontend/__tests__/edit-multi-ref.test.ts
git commit -m "feat(edit-lib): editImageStream meta 에 referenceRef + templateId 전송 + history 저장 + touch"
```

---

## Task 8: useEditPipeline 의 done 콜백에서 자동 저장

**Files:**
- Modify: `frontend/hooks/useEditPipeline.ts`

- [ ] **Step 1: store 구독 추가**

```typescript
const saveAsTemplate = useEditStore((s) => s.saveAsTemplate);
const templateName = useEditStore((s) => s.templateName);
const referenceImage = useEditStore((s) => s.referenceImage);
const referenceRole = useEditStore((s) => s.referenceRole);
// ... 기존 use_reference / 등
```

- [ ] **Step 2: import 추가**

```typescript
import { createReferenceTemplate } from "@/lib/api/reference-templates";
```

- [ ] **Step 3: done 콜백에서 자동 저장**

수정 성공 후 (`done` 핸들러 안):

```typescript
done: (e) => {
  // ... 기존 done 처리

  // 라이브러리 자동 저장 (saveAsTemplate ON 케이스)
  if (
    saveAsTemplate &&
    referenceImage &&
    templateName.trim()
  ) {
    void createReferenceTemplate({
      imageFile: referenceImage,
      name: templateName.trim(),
      role: effectiveRole,
      userIntent: prompt,
      visionModel: visionModelSel,
    })
      .then((tpl) => {
        if (tpl) toast.success("템플릿 저장됨", tpl.name);
      })
      .catch((err) => {
        toast.warn("템플릿 저장 실패", err instanceof Error ? err.message : "");
      });
  }
},
```

(`effectiveRole` / `visionModelSel` 등은 useEditPipeline 의 기존 로직에서 이미 계산된 값 재사용)

- [ ] **Step 4: 검증**

Run: `npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -3`
Expected: clean + `55 passed`

- [ ] **Step 5: Commit (사용자 승인 후만)**

```bash
git add frontend/hooks/useEditPipeline.ts
git commit -m "feat(edit-lib): useEditPipeline done 콜백 — 라이브러리 자동 저장"
```

---

## Task 9: 통합 검증 + 머지

- [ ] **Step 1: 회귀 검증**

```bash
cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q
cd ../frontend && npx tsc --noEmit && npm run lint && npm test
```

Expected:
- pytest: 226+ passed
- vitest: 55 passed
- tsc/lint: clean

- [ ] **Step 2: 실 사용 시각 검증 (수동)**

브라우저:
1. 토글 ON + 새 이미지 + saveAsTemplate ON + 이름 "검정 드레스" → 수정 실행
2. 결과 후 라이브러리 열어서 저장 확인 + visionDescription 자동 채워졌는지 확인
3. 새 세션 — 라이브러리에서 픽 → 두번째 카드 자동 채워짐 + role 자동 적용 확인
4. 그 템플릿으로 한 번 더 수정
5. 라이브러리 다시 열어 lastUsedAt 갱신 확인 (정렬 위로)
6. 실패한 템플릿 [×] 삭제 + 옛 history 의 그 reference 사용한 row 의 이미지가 *깨짐 표시* 되는지 확인 (Soft 삭제 검증)

- [ ] **Step 3: 문서 갱신**

`CLAUDE.md` 의 Edit 모드 섹션 + `docs/changelog.md` 에 라이브러리 기능 안내 추가.

- [ ] **Step 4: master 머지 (별도 승인 후)**

> ⚠️ **AGENTS 규칙 (Codex 2차 리뷰 fix #9):** master merge / push 는 *별도 사용자 승인* 후만. 자동 X.

```bash
# 사용자 "master 머지 + 푸시" 명시 후에만:
git checkout master
git merge --no-ff claude/edit-reference-library -m "Merge branch 'claude/edit-reference-library': reference template 라이브러리"
git push origin master
```

---

## Self-Review (Codex 2차 리뷰 반영 · 2026-04-27)

### 1. Spec coverage

| 요구사항 | 구현 태스크 |
|---------|-----------|
| 명시적 저장 토글 | Task 7 (saveAsTemplate + 이름 입력) |
| 비전 자동 분석 (저장 시 1회) | Task 3 (analyze_reference) + Task 4 (POST 안 호출) |
| 라이브러리 목록 + grid | Task 6 (ReferenceLibraryDrawer) |
| 템플릿 픽 → 자동 채움 | Task 7 (onPick 콜백) |
| 안 좋은 템플릿 삭제 | Task 4 (DELETE) + Task 6 (TemplateCard [×]) |
| Soft 삭제 (옛 history 보존) | Task 4 (DB row + 파일만 삭제) |
| 사용 빈도 (last_used_at) | Task 2 (touch) + Task 6 (handlePick 자동) + Task 7b (백엔드 dispatch 시 touch) |
| DB 마이그레이션 v7→v8 | Task 1 |
| Path traversal 보안 | Task 3 (reference_path_from_url + parametrized 테스트) |
| DB insert 실패 시 롤백 | Task 4 (delete_reference_file 호출) |
| PIL 재인코딩 | Task 3 (save_reference_image) |
| Production DB 오염 방지 | Task 2 (temp DB monkeypatch fixture) |
| **referenceRef 저장 흐름** (Codex 2차/3차 fix) | 디자인 결정 표 + Task 7 (store pickedTemplateRef) + Task 7b (templateId 전송 + backend DB 조회 + history 저장) |
| **URL 정규화** (Codex 2차 fix #6) | Task 5 Step 2 (normalizeReferenceTemplate helper) + Step 5 (단위 테스트) |
| **router 등록 위치** (Codex 2차 fix #7) | Task 4 헤더 + Step 2 (`routes/__init__.py` only) |
| **OpenAPI/typegen 순서** (Codex 2차 fix #8) | Task 4 Step 3 (backend snapshot 먼저) + Task 5 Step 3 (frontend gen:types 다음) |

---

## Revision Summary (Codex 2차 리뷰 반영 — Library Plan)

| # | Codex 2차 리뷰 항목 | 반영 위치 | 상태 |
|---|---------------------|----------|------|
| 5 | referenceRef 저장 흐름 + 옵션 A/B 결정 | 디자인 결정 섹션 + Task 7 store + Task 7b 신규 (templateId 전송 + backend DB 조회 + history 저장 + touch) | ✅ |
| 5-store | `pickedTemplateRef` store 필드 + setter 추가 | Task 7 Step 1 | ✅ |
| 5-meta | `editImageStream` meta 에 `referenceTemplateId` 전송 (`referenceRef` 는 호환/디버그용, DB 권위 아님) | Task 7b Step 2/3/4 | ✅ |
| 5-backend | Backend route 가 meta 받아서 history 에 저장 + touch 호출 | Task 7b Step 4/5 | ✅ |
| 5-test | history round-trip + frontend meta 전송 테스트 | Task 7b Step 6/7 | ✅ |
| 5-policy | 옵션 A 채택 (첫 실행 referenceRef None / 다음부터 영구 URL) | 디자인 결정 표 | ✅ |
| 5-authority | Backend 가 `referenceTemplateId` 로 DB `image_ref` 재조회 (absolute URL 저장 방지) | 디자인 결정 + Task 7b Step 4 | ✅ |
| 6 | `normalizeReferenceTemplate` helper 추가 | Task 5 Step 2 | ✅ |
| 6-listcreate | listReferenceTemplates / createReferenceTemplate 반환 정규화 | Task 5 Step 2 (둘 다 적용) | ✅ |
| 6-test | URL 정규화 단위 테스트 | Task 5 Step 5 | ✅ |
| 7 | router 등록 → `routes/__init__.py` only | Task 4 헤더 + Step 2 | ✅ |
| 8 | OpenAPI snapshot → frontend gen:types 순서 명시 | Task 4 Step 3 + Task 5 Step 3 | ✅ |
| 9 | Commit/merge/push → "사용자 승인 후" | 모든 commit step + master merge step | ✅ |

### Codex 3차 보강 코멘트

| # | 보강 항목 | 반영 위치 | 상태 |
|---|----------|----------|------|
| 3-1 | `referenceTemplateId` 를 DB 저장 권위로 사용하고, 클라이언트 `referenceRef` 는 신뢰하지 않음 | 디자인 결정 + Task 7b Step 4 | ✅ |
| 3-2 | `get_reference_template()` CRUD 함수 추가 | Task 2 Step 2 | ✅ |
| 3-3 | 토글 OFF / reference bytes 없음이면 stale template meta 무효화 | Task 7b Step 4 | ✅ |
| 3-4 | route 테스트로 absolute client `referenceRef` 저장 회귀 차단 | Task 7b Step 6b | ✅ |
| 3-5 | frontend meta 테스트에서 File 사용으로 image fetch call 과 `/edit` call 혼동 제거 | Task 7b Step 7 | ✅ |

### 추가 테스트 (Library plan)

| 케이스 | 위치 | 상태 |
|--------|------|------|
| Library template imageRef 정규화 (상대 → 절대) | Task 5 Step 5 | ✅ |
| Library pick 후 edit meta 에 templateId 전달 + referenceRef 호환 필드 검증 | Task 7b Step 7 | ✅ |
| history.referenceRef + referenceRole round-trip | Task 7b Step 6 | ✅ |
| absolute client referenceRef 대신 DB image_ref 사용 | Task 7b Step 6b | ✅ |

### 미해결 우려사항 (실 코드 작업 시 검증 필요)

- `_describe_image` 의 정확한 시그니처 — `vision_pipeline.py:531-539` 가 `system_prompt: str = VISION_SYSTEM` 형태 (Codex 2차 리뷰 검증) → keyword 로 호출.
- 라이브러리 픽 케이스의 ComfyUI 임시 업로드 흐름 — Multi-Reference plan 의 Task 14 의 `extra_uploads` 와 자연스럽게 연결됨. 단, 픽 케이스는 frontend 가 영구 URL → fetch → blob → multipart 의 reference_image 파일로 업로드 (Multi-ref plan Task 10 의 `editImageStream` 패턴 그대로).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-27-edit-reference-library.md`.

**선행 조건**: Multi-Reference plan (`2026-04-27-edit-multi-reference.md`) 의 Phase 1-5 완료 + 안정화 검증 후 진행.

**총 10 task (Task 7b 추가) / ~5-6h** (Codex 2차 리뷰 fix #5 의 referenceRef 흐름 보강 task 추가).

**Verdict (Codex 3차 보강 후):**

✅ **Ready for implementation after Multi-Reference stabilization**

이번 갱신에서 Codex 2차 리뷰의 5/6/7/8/9 항목 + Codex 3차 보강 항목 모두 반영됨 (1-4 는 multi-ref 본 plan).

**다음 단계:**

Multi-Reference plan 의 Phase 1-5 완료 + 안정화 검증 후, 사용자 승인으로 이 library plan 진입.
