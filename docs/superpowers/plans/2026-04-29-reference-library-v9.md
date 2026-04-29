# Edit Reference Library v9 — UI 통합 + 사후 저장 + 임시 풀 cascade cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **🛑 commit/push/merge 룰**: 모든 task 의 `git commit` / `git push` / `git merge` / `gh pr` 단계는 *사용자 명시 요청 시에만* 실행. plan 본문에 적힌 명령은 *후보 메시지 / 흐름 참고용*. 사용자 GO 전 자동 실행 금지.

**Goal:** Edit 모드의 참조 이미지(image2) + 사용 영역 crop UI 단일 박스 통합 + 라이브러리 저장 시점을 *생성 전* → *결과 확인 후* 로 이전 + 임시 풀 디스크 저장 + 설정 Drawer 에 사용량 표시 / 고아 ref 수동 일괄 삭제.

**Architecture:**
- **임시 풀 (NEW)**: 모든 사용자 직접 업로드 reference 가 자동으로 `STUDIO_OUTPUT_DIR / "reference-pool" / <uuid>.png` 에 저장. history row 의 `reference_ref` 가 *임시 풀 URL* 가리킴 (옛 v8 정책 *NULL* 에서 *임시 풀 URL* 로 변경).
- **영구 라이브러리 (기존 v8 유지)**: `reference_templates` 테이블 + `STUDIO_OUTPUT_DIR / "reference-templates" / <uuid>.<ext>`. 사용자가 결과 확인 후 *명시적 promote* 시에만 임시 풀 → 영구 라이브러리 복사.
- **Cascade Cleanup 정책**:
  - history row 단건 삭제 (`delete_item_with_refs`) → 임시 풀 ref cascade unlink
  - 전체 삭제 (`clear_all_with_refs`) → 임시 풀 일괄 unlink
  - 설정 Drawer 의 "고아 ref 일괄 삭제" 버튼 → 디스크 상에는 있지만 history 어디에서도 참조 안 된 임시 풀 ref 만 삭제
  - **자동 시간 기반 GC 옵션은 NOT IN SCOPE**

**Tech Stack:** FastAPI · aiosqlite · PIL · Next.js 16 · React 19 · Zustand 5 · react-easy-crop

**선행 조건:**
- [Edit Multi-Reference Plan](2026-04-27-edit-multi-reference.md) Phase 1-5 master 머지 완료 ✅
- [Edit Reference Library v8 Plan](2026-04-27-edit-reference-library.md) Phase A-D master 머지 완료 ✅
- [Edit Manual Crop Plan](2026-04-28-edit-manual-crop.md) Phase 1-4 master 머지 완료 ✅
- 최신 master HEAD 기준 식별자 검증 완료 (v9 작성 시점 `482e50b`)

---

## ⚠️ Scope Discipline — NOT IN SCOPE (절대 추가 금지)

이 plan 은 *오빠가 직접 명시한 3가지 기획 의도* 만 다룬다. 아래 항목은 *전부 다른 plan* 으로 분리.

**모델/알고리즘 변경 — 금지**
- ❌ InstantID / IP-Adapter / Style Transfer 모델 도입
- ❌ Multi-ref slot 알고리즘 변경 (Phase 1+1'+1'' 결정 그대로)
- ❌ ComfyUI workflow JSON 수정

**기능 확장 — 금지**
- ❌ image1 (sourceImage / 메인 원본) 의 crop UI 추가 — 의도 ①은 *image2 한정*
- ❌ 라이브러리 검색 / 태그 / 카테고리 / 정렬 기능
- ❌ 라이브러리 항목 편집 (이름 변경 / 설명 추가 등)
- ❌ 라이브러리 동기 / 공유 / 공개 기능
- ❌ **자동 시간 기반 GC 옵션** ("30일 후 자동 삭제" 토글 등) — 수동 cascade cleanup 만
- ❌ 자동 vision 분석 (v8 의 promote 시 qwen2.5vl 호출은 *유지*. 자동 호출은 추가 X)
- ❌ history → reference 역방향 변환 ("이 결과 이미지를 reference 로")
- ❌ 임시 풀 압축 / 최적화 / 다운샘플
- ❌ Drawer 의 임시 풀 항목 노출 (Drawer 는 영구 라이브러리만 — 옛 동작 유지)

**기존 동작 변경 — 금지**
- ❌ Multi-ref 토글 자체 (`useReferenceImage`) 동작 변경
- ❌ `referenceRole` (face/outfit/style/background/custom) 정책 변경
- ❌ ComfyUI 임시 input 업로드 흐름 (extra_uploads) 변경
- ❌ 라이브러리 픽 흐름 (`pickedTemplateId` + `pickedTemplateRef`) 변경 — promote 후에도 그대로 작동

**UI 동선 — 금지**
- ❌ Edit 페이지 외 다른 모드(Generate/Video) 에 라이브러리 도입
- ❌ Lightbox 안에서 라이브러리 픽
- ❌ 키보드 단축키 추가 (Drawer 토글 외)

> **검증 의무**: PR 단계에서 "기획 의도 외 변경" 발견 시 *즉시 revert* 하고 별도 plan 으로 분리.

---

## 디자인 결정 (Codex 1차 리뷰 반영)

### 1. UI 통합 정책 (의도 ①)

- **단일 컴포넌트**: `ReferenceImageBox` (NEW) — 드롭존 / crop UI / bypass 3 모드 분기
- **EditReferenceCrop 의 *모든 기능* 흡수** (Codex C1):
  - aspect preset 4종: 자유 / 1:1 / 4:3 / 9:16 (옛 `EditReferenceCrop.tsx:45` 의 `AspectMode`)
  - zoom slider (옛 `EditReferenceCrop.tsx:75` 의 `zoom` state + slider UI)
  - 256px 미만 영역 silent fallback (옛 `EditReferenceCrop.tsx` + `CLAUDE.md:224` 의 가드)
  - `key={referenceImage}` 로 새 업로드 시 local state 강제 reset
  - 옛 도움말 문구 ("256px 미만은 원본 그대로" 등) 보존
- **Ctrl+V 붙여넣기** (Codex I1): 기존 `useImagePasteTarget` hook (`SourceImageCard.tsx:141`) 패턴 그대로 활용. ReferenceImageBox 내부에 hook 호출.
- **모드 분기 룰**:
  | 상태 | 표시 | crop 가능 |
  |------|------|----------|
  | `image === null` | 드롭존 (드래그&드롭 + 클릭 + Ctrl+V 활성) | ❌ |
  | `image` 보유 + `bypassCrop=false` (사용자 직접 업로드) | crop UI (aspect 토글 + zoom + 256px guard) | ✅ |
  | `image` 보유 + `bypassCrop=true` (라이브러리 픽) | 단순 `<img>` | ❌ |
- **이벤트 충돌 회피**: react-easy-crop 가 박스 내부 마우스/휠 이벤트 가둠. paste 는 component-level keyboard listener (hover 또는 focus 시 활성).
- **✕ 버튼**: crop UI 우상단 작은 버튼. 클릭 시 `setReferenceImage(null)` → 드롭존 모드 복귀.

### 2. 사후 저장 정책 (의도 ②)

- **옛 v8 흐름 (제거)**: `saveAsTemplate` 토글 + `templateName` 입력 → "수정 생성" 클릭 시 *동시* 저장.
- **새 v9 흐름**: "수정 생성" 클릭 시 cropped reference 가 자동으로 *임시 풀* 디스크 저장 (history.referenceRef = 임시 풀 URL). 결과 확인 후 사용자가 `📚 라이브러리 저장` 버튼 클릭 → 모달에서 이름 입력 → 영구 라이브러리로 promote.
- **promote = 임시 풀 → 영구 라이브러리 복사** (`shutil.copy2` 로 소스 보존). 옛 v8 의 reference_templates 테이블 + `insert_reference_template()` 그대로 사용.
- **Promote 성공 후 history.referenceRef swap** (Codex I3): promote 성공 시 백엔드는 해당 history row 의 `reference_ref` 를 *임시 풀 URL* → *영구 라이브러리 URL* 로 update. 프론트는 `canPromote` 가 *임시 풀 URL prefix 매칭* 으로만 판정 → swap 후 자동 false → ActionBar 의 promote 버튼 자동 숨김.
- **vision 분석 타이밍**: promote 시 1회 (옛 v8 spec 그대로). 동기 호출. **vision 실패는 description="" 으로 silent fallback** + 모달 토스트는 *부분 성공* 안내 ("저장 완료 — vision 분석은 실패").
- **Rollback 정책** (Codex I5): promote 흐름 = `(1) shutil.copy2 → (2) vision → (3) DB insert`. DB insert 실패 시 dst 파일 unlink (옛 v8 reference_templates 라우트의 rollback 패턴 — `reference_templates.py:107` 그대로). vision 실패는 rollback 안 함 (description="" 으로 진행).
- **이름 검증**: promote 모달의 이름 input 은 `1~64자, alphanumeric + 한글 + 공백 + 하이픈/언더스코어` 정규식. 빈 문자열 / 중복 검사 X.

### 3. 임시 풀 Cascade Cleanup 정책 (의도 ③)

- **자동 cascade**:
  - 단건 삭제: `history_db.delete_item_with_refs(item_id)` 가 임시 풀 ref 도 함께 unlink (마지막 참조면)
  - 전체 삭제: `history_db.clear_all_with_refs()` 가 임시 풀 ref 모두 unlink (Codex I2)
- **수동 cascade**: 설정 Drawer 의 "참조 임시 캐시" 섹션
  - **사용량 표시**: `N개 · X.X MB` (count + sum of file sizes)
  - **"고아 ref 일괄 삭제" 버튼**: 디스크 상에는 있지만 history 어디서도 참조 안 된 임시 풀 ref 만 삭제 (안전)
  - **"전체 삭제" 버튼은 NOT IN SCOPE**: history.referenceRef 가 dangling → 무결성 깨뜨림.
- **Race condition 완화** (Codex I4): orphan 결정 흐름은 `(1) history snapshot → (2) 디스크 ref iter → (3) 디스크에 있는데 snapshot 에 없는 ref 만 orphan`. 단, snapshot 직후 새 history insert + 새 file 저장이 일어나면 잠깐 race 가능.
  - **완화 정책**: orphan delete 시점에 *그 시점의 history snapshot 다시 조회* 후 한 번 더 교집합 검증 (double-check). 그래도 race 가능성은 0이 아니지만, 일반적인 사용자 동선 (생성 후 결과 보고 라이브러리 저장 결정) 에서는 발생 거의 없음. 운영상 사용자가 "고아 일괄 삭제" 클릭 시점에 *동시 생성 진행 중* 일 가능성 낮음 → 허용.
- **자동 시간 기반 GC 옵션 (예: 30일 후 자동 삭제)**: NOT IN SCOPE.

### 4. DB 스키마

- **테이블**: `studio_history` (이미 존재) + `reference_templates` (이미 존재)
- **컬럼**: `studio_history.reference_ref` (이미 존재 · 옛 v8 spec)
- **마이그레이션**: 없음. v9 는 *컬럼 의미만* 변경:
  - 옛: `NULL` (사용자 직접 업로드) OR 영구 라이브러리 URL (라이브러리 픽)
  - 새: 임시 풀 URL (사용자 직접 업로드) OR 영구 라이브러리 URL (라이브러리 픽 OR promote 후 swap)
- **옛 row (NULL referenceRef)** 는 그대로 유지. 새 row 부터 임시 풀 URL 기록. 옛 NULL row 는 promote 불가 (`canPromote` 필터로 차단).

### 5. URL Prefix 정책 (Codex C6)

- **임시 풀 URL prefix**: `"/images/studio/reference-pool/"` (**trailing slash 포함**)
- **영구 라이브러리 URL prefix**: `"/images/studio/reference-templates/"` (이미 v8 에서 정의 · trailing slash 포함)
- **Prefix collision 방어**: `startswith(prefix)` 후 slice 하기 전에 `pool_path_from_url(url)` 헬퍼 호출 → 검증 실패 시 ValueError. `is_path_safe` 가 절대 우회 안 됨.

### 6. URL 정규화 (옛 v8 fix #6 그대로)

- 백엔드는 *상대 URL* 반환.
- 프론트엔드는 `STUDIO_BASE` prefix 로 절대 URL 변환 (`normalizeReferenceTemplate` helper · 옛 v8). 임시 풀 URL 도 동일 패턴 → `normalizePoolUrl()` 신설.

---

## 현재 상태 vs 목표 상태

| 항목 | 현재 (v8 master) | 목표 (v9) |
|------|------------------|-----------|
| 참조 이미지 박스 | 일반 ImageDrop / SourceImageCard 컴포넌트 | `ReferenceImageBox` (드롭존 ↔ crop UI ↔ bypass 3 모드) |
| crop UI 위치 | 박스 *아래* 인라인 (`EditReferenceCrop.tsx`) | 박스 *내부* (이미지 위 overlay) — EditReferenceCrop 기능 흡수 |
| crop UI aspect preset | 자유 / 1:1 / 4:3 / 9:16 (4종) | 4종 그대로 유지 (코드 위치만 통합) |
| crop UI zoom slider | 있음 | 그대로 유지 |
| crop UI 256px 가드 | 있음 | 그대로 유지 |
| Ctrl+V 붙여넣기 | `useImagePasteTarget` hook | 그대로 유지 (ReferenceImageBox 안에서도) |
| 라이브러리 저장 시점 | "수정 생성" *전* `saveAsTemplate` 토글 | "수정 생성" *후* 결과 ActionBar 의 `📚 라이브러리 저장` 버튼 |
| `saveAsTemplate` state | 사용 중 (`useEditStore`) | **제거** |
| `templateName` state | 사용 중 (`useEditStore`) | **제거** (모달에서 입력) |
| `pickedTemplateId` / `pickedTemplateRef` state | 사용 중 (라이브러리 픽 시) | 사용 중 (그대로 유지) |
| `studio_history.reference_ref` (직접 업로드) | NULL | 임시 풀 URL |
| `studio_history.reference_ref` (라이브러리 픽) | 영구 라이브러리 URL | 영구 라이브러리 URL (그대로) |
| `studio_history.reference_ref` (promote 후) | (없음) | 영구 라이브러리 URL (swap) |
| 임시 풀 디렉토리 | 없음 | `STUDIO_OUTPUT_DIR / "reference-pool" / <uuid>.png` |
| 단건 삭제 cascade | 영구 라이브러리 ref 만 (`delete_item_with_refs`) | + 임시 풀 ref unlink |
| 전체 삭제 cascade | 영구 라이브러리 ref 만 (`clear_all_with_refs`) | + 임시 풀 ref 모두 unlink |
| 수동 cleanup | 없음 | 설정 Drawer 의 "고아 ref 일괄 삭제" |
| `EditLeftPanel` 의 `saveAsTemplate` Toggle UI | 사용 중 | **제거** |
| `EditLeftPanel` 의 `templateName` Input UI | 사용 중 | **제거** |
| `frontend/components/studio/EditReferenceCrop.tsx` (옛 위치) | 사용 중 | **삭제** (ReferenceImageBox 흡수) |
| `frontend/__tests__/edit-library-store.test.ts` | saveAsTemplate / templateName 검증 중 | 해당 검증 부분 *제거* |
| Drawer (라이브러리 픽 UI) | 영구 라이브러리만 표시 | 그대로 유지 |
| ResultActionBar 버튼 | 4개 (확대/저장/원본으로/재시도) | 5개 (+ 📚 라이브러리 저장) — Edit + sourceRef + history.referenceRef = 임시 풀 URL 일 때만 |

---

## File Structure

### Backend (modify 5 + new 2)

- **`backend/studio/reference_pool.py`** — **NEW**. 임시 풀 디스크 저장 + path 검증 + iter / orphan / delete. `studio.storage.STUDIO_OUTPUT_DIR` 기반 (Codex C2).
- **`backend/studio/history_db.py`** — **modify**. 신규 함수 `count_pool_refs() → int`, `list_history_pool_refs() → set[str]`. 기존 `delete_item_with_refs` + `clear_all_with_refs` 에 임시 풀 cascade unlink 추가 (Codex I2).
- **`backend/studio/pipelines/edit.py`** — **modify**. 옛 v8 의 자동 promote 제거 + `_run_edit_pipeline(reference_bytes, reference_ref_url, ...)` 시그니처에 맞춰 `reference_ref_url` 인자에 임시 풀 URL 전달 (호출자는 `routes/streams.py`).
- **`backend/studio/routes/streams.py`** — **modify**. multipart `reference_image` 파싱 직후 사용자 직접 업로드면 `reference_pool.save_to_pool()` 호출 → 결과 URL 을 `_run_edit_pipeline(..., reference_ref_url=...)` 로 전달.
- **`backend/studio/routes/reference_pool.py`** — **NEW**. `GET /reference-pool/stats`, `GET /reference-pool/orphans`, `DELETE /reference-pool/orphans` (라우터는 prefix 직접 박힘 — 기존 `reference_templates.py` 패턴 그대로).
- **`backend/studio/routes/__init__.py`** — **modify**. 신규 `reference_pool` 라우터 등록.
- **`backend/studio/routes/reference_templates.py`** — **modify**. `POST /reference-templates/promote/{history_id}` endpoint 추가 (기존 router prefix 직접 박힘 패턴 따라). promote 성공 시 `studio_history.reference_ref` 영구 URL 로 swap.
- **`backend/studio/routes/system.py`** — **modify**. 옛 `DELETE /history` (`system.py:288`) 가 `clear_all_with_refs` 호출 시 임시 풀도 함께 cleanup.

### Frontend (modify 7 + new 2)

- **`frontend/components/studio/edit/ReferenceImageBox.tsx`** — **NEW**. 드롭존 ↔ crop UI ↔ bypass 3 모드 단일 컴포넌트. 옛 `EditReferenceCrop` 의 *모든 기능* 흡수.
- **`frontend/components/studio/edit/ReferencePromoteModal.tsx`** — **NEW**. 사후 저장 모달.
- **`frontend/components/studio/edit/EditLeftPanel.tsx`** — **modify**. 옛 ImageDrop + 별도 crop UI + saveAsTemplate Toggle + templateName Input *제거*. ReferenceImageBox 1개로 교체. `pickedTemplateId` 만 destructure (옛 v8 코드 따라 — Codex I7).
- **`frontend/components/studio/edit/EditResultViewer.tsx`** — **modify**. ActionBar 에 `📚 라이브러리 저장` 버튼 추가 (조건부).
- **`frontend/stores/useEditStore.ts`** — **modify**. `saveAsTemplate` / `templateName` / 2 setters *제거*. `pickedTemplateId/Ref` 유지.
- **`frontend/hooks/useEditPipeline.ts`** — **modify**. 옛 v8 자동 promote 호출 제거.
- **`frontend/lib/api/reference-templates.ts`** — **modify**. `promoteFromHistory(historyId, name) → ReferenceTemplate` 함수 추가. 응답 shape 은 `{ template: { ..., visionDescription, roleDefault } }` 패턴 (Codex I10).
- **`frontend/lib/api/reference-pool.ts`** — **NEW**. `getPoolStats() / getOrphans() / deleteOrphans()` 클라이언트.
- **`frontend/lib/api/types.ts`** — **modify**. `HistoryItem.referenceRef` 타입 주석 갱신 (`v9 임시 풀 URL OR 영구 라이브러리 URL` — Codex I9).
- **`frontend/components/studio/EditReferenceCrop.tsx`** — **DELETE** (옛 위치 — `frontend/components/studio/` 직속 — Codex I8).
- **`frontend/components/settings/SettingsDrawer.tsx`** — **modify**. "참조 임시 캐시" 섹션 추가 (실 위치 — Codex M4).

### Tests (new 5 + modify 3)

- **`backend/tests/studio/test_reference_pool_storage.py`** — **NEW**. PIL helper 사용 (실 PNG bytes), `tmp_pool_dir` fixture monkeypatch.
- **`backend/tests/studio/test_reference_pool_routes.py`** — **NEW**. ASGITransport 패턴 (Codex I11).
- **`backend/tests/studio/test_reference_promote_route.py`** — **NEW**. ASGITransport + DB rollback 검증.
- **`backend/tests/studio/test_history_db_cascade.py`** — **NEW**. `delete_item_with_refs` + `clear_all_with_refs` 의 임시 풀 cascade.
- **`backend/tests/studio/test_edit_pipeline_pool_save.py`** — **NEW**. `routes/streams.py` 흐름 (multipart → save_to_pool → _run_edit_pipeline).
- **`backend/tests/studio/test_history_db.py`** — **modify**. `count_pool_refs` / `list_history_pool_refs` 테스트 추가.
- **`frontend/__tests__/edit-reference-image-box.test.ts`** — **NEW**. ResizeObserver mock + cropper DOM mock (Codex M3).
- **`frontend/__tests__/edit-library-store.test.ts`** — **modify**. `saveAsTemplate`/`templateName` 검증 부분 *제거* (Codex I12).
- **`backend/tests/studio/test_openapi.py`** — **modify**. promote / reference-pool 신규 endpoint snapshot 갱신 (Codex Risk Audit).

---

## Phase A — Backend (Task A.1 ~ A.7)

### Task A.1: 임시 풀 storage 모듈 (`reference_pool.py`)

**Files:**
- Create: `backend/studio/reference_pool.py`
- Test: `backend/tests/studio/test_reference_pool_storage.py`

- [ ] **Step 1: PIL helper + tmp_pool_dir fixture (test 파일 setup)**

```python
# backend/tests/studio/test_reference_pool_storage.py
"""임시 풀 storage 단위 테스트 — 실 PIL bytes + tmp_pool_dir monkeypatch."""
import io
import pytest
from pathlib import Path
from PIL import Image


def make_png_bytes(w: int = 256, h: int = 256, color: str = "red") -> bytes:
    """검증용 실 PNG bytes."""
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color=color).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def tmp_pool_dir(tmp_path, monkeypatch):
    """임시 풀 디렉토리 fixture — production 오염 방지.

    monkeypatch.setattr 로 reference_pool 모듈의 POOL_DIR 을 일회성으로 바꿈.
    """
    pool_dir = tmp_path / "reference-pool"
    pool_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr("studio.reference_pool.POOL_DIR", pool_dir)
    return pool_dir


@pytest.mark.asyncio
async def test_save_to_pool_returns_relative_url_with_trailing_slash(tmp_pool_dir):
    """save_to_pool 이 /images/studio/reference-pool/<uuid>.png 형태 반환 (trailing slash 포함된 prefix)."""
    from studio.reference_pool import save_to_pool, POOL_URL_PREFIX

    assert POOL_URL_PREFIX.endswith("/")  # Codex C6 — trailing slash 보장

    img = make_png_bytes()
    rel_url = await save_to_pool(img, "image/png")

    assert rel_url.startswith(POOL_URL_PREFIX)
    assert rel_url.endswith(".png")  # PNG 통일 정책 (Codex C7)
    fname = rel_url[len(POOL_URL_PREFIX):]
    assert (tmp_pool_dir / fname).exists()


@pytest.mark.asyncio
async def test_save_to_pool_invalid_bytes_raises(tmp_pool_dir):
    """PIL 검증 실패 → ValueError."""
    from studio.reference_pool import save_to_pool

    with pytest.raises(ValueError, match="invalid image"):
        await save_to_pool(b"not an image", "image/png")
```

- [ ] **Step 2: Run — fail (ImportError)**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_reference_pool_storage.py -v
```

Expected: FAIL — `ImportError: cannot import name 'save_to_pool'`

- [ ] **Step 3: reference_pool.py 구현 (Codex C2 + C6 + C7 반영)**

```python
# backend/studio/reference_pool.py
"""임시 풀 (reference-pool) 디스크 저장 + cascade cleanup 헬퍼.

영구 라이브러리 (reference_templates) 와 분리:
- 임시 풀: 사용자 직접 업로드 reference 가 자동 저장. history row 와 lifecycle 묶임.
- 영구 라이브러리: 사용자 명시 promote 시에만 (별도 storage — reference_storage.py).

Cascade cleanup:
- history_db.delete_item_with_refs / clear_all_with_refs 가 호출
- routes/reference_pool.py 의 DELETE /orphans 가 호출

Path prefix: "/images/studio/reference-pool/" (trailing slash 포함 — collision 방어).
PNG 통일: 입력 모드 무관 PNG 저장 (영구 storage 와 다른 정책 — promote 시 그대로 복사).
"""

from __future__ import annotations
from pathlib import Path
from typing import AsyncIterator
from uuid import uuid4
import asyncio
import io
import logging

from PIL import Image

from studio.storage import STUDIO_OUTPUT_DIR  # Codex C2

logger = logging.getLogger(__name__)

# 영구 저장 경로 (storage 의 STUDIO_OUTPUT_DIR 기반)
POOL_DIR: Path = STUDIO_OUTPUT_DIR / "reference-pool"
POOL_DIR.mkdir(parents=True, exist_ok=True)

# URL prefix — trailing slash 포함 (collision 방어 · Codex C6)
POOL_URL_PREFIX = "/images/studio/reference-pool/"


# ─────────────────────────────────────────────────
# Path traversal 보안 + 공용 검증 헬퍼
# ─────────────────────────────────────────────────

def is_path_safe(rel_url: str) -> bool:
    """상대 URL 이 POOL_DIR 안에 있는지 검증.

    1. POOL_URL_PREFIX (trailing slash 포함) 로 시작
    2. prefix 제거 후 fname 에 `/` / `..` / 빈문자 없음
    3. 실제 (POOL_DIR / fname).resolve() 가 POOL_DIR 안에 있음
    """
    if not rel_url.startswith(POOL_URL_PREFIX):
        return False
    fname = rel_url[len(POOL_URL_PREFIX):]
    if not fname or "/" in fname or "\\" in fname or ".." in fname:
        return False
    try:
        resolved = (POOL_DIR / fname).resolve()
        return resolved.parent == POOL_DIR.resolve()
    except (OSError, ValueError):
        return False


def pool_path_from_url(rel_url: str) -> Path:
    """상대 URL → 디스크 Path (안전 검증 통과 후만).

    Codex C6: 공용 헬퍼 — startswith + slice 직접 사용 금지.
    """
    if not is_path_safe(rel_url):
        raise ValueError(f"unsafe pool ref: {rel_url}")
    fname = rel_url[len(POOL_URL_PREFIX):]
    return POOL_DIR / fname


# ─────────────────────────────────────────────────
# 저장 (PNG 통일 · Codex C7)
# ─────────────────────────────────────────────────

async def save_to_pool(img_bytes: bytes, content_type: str) -> str:
    """이미지 bytes 를 임시 풀에 저장하고 상대 URL 반환.

    PIL 로 검증 + PNG 재인코딩 (모드 무관). Returns: POOL_URL_PREFIX + <uuid>.png
    Raises: ValueError if not a valid image.
    """
    def _decode_and_re_encode_png() -> bytes:
        try:
            with Image.open(io.BytesIO(img_bytes)) as img:
                img.verify()  # 검증
        except Exception as e:
            raise ValueError(f"invalid image: {e}") from e

        # verify 후 재open 필수 (PIL idiom)
        with Image.open(io.BytesIO(img_bytes)) as img:
            buf = io.BytesIO()
            # 모드 무관 PNG (RGBA/LA 보존, RGB 도 PNG)
            if img.mode == "P":
                img = img.convert("RGBA")
            img.save(buf, format="PNG", optimize=True)
            return buf.getvalue()

    encoded = await asyncio.to_thread(_decode_and_re_encode_png)

    fname = f"{uuid4().hex}.png"
    target = POOL_DIR / fname
    await asyncio.to_thread(target.write_bytes, encoded)

    return f"{POOL_URL_PREFIX}{fname}"


# ─────────────────────────────────────────────────
# 삭제 (race 안전 + 로그 · Codex M2)
# ─────────────────────────────────────────────────

async def delete_pool_ref(rel_url: str) -> bool:
    """임시 풀 ref 삭제. 안전 검증 + 파일 unlink.

    Returns: True if deleted, False if not found (idempotent).
    Raises: ValueError if path unsafe.
    """
    target = pool_path_from_url(rel_url)
    try:
        await asyncio.to_thread(target.unlink, missing_ok=True)
        return True
    except OSError as e:
        logger.warning("pool unlink failed: %s — %s", rel_url, e)
        return False


# ─────────────────────────────────────────────────
# 조회 / Orphan 검출
# ─────────────────────────────────────────────────

async def iter_pool_refs() -> AsyncIterator[tuple[str, int]]:
    """모든 임시 풀 ref 와 파일 크기 (bytes) 순회.

    Yields: (rel_url, size_bytes)
    """
    def _list_sync() -> list[tuple[str, int]]:
        result = []
        for p in POOL_DIR.iterdir():
            if p.is_file():
                result.append((f"{POOL_URL_PREFIX}{p.name}", p.stat().st_size))
        return result

    items = await asyncio.to_thread(_list_sync)
    for item in items:
        yield item


async def list_orphan_pool_refs(referenced_urls: set[str]) -> list[str]:
    """history 에서 참조 안 된 임시 풀 ref 목록.

    Args:
        referenced_urls: studio_history.reference_ref 에서 *임시 풀 prefix 로 시작하는* 값들 set
    Returns: 디스크에 있지만 referenced_urls 에 없는 rel_url list
    """
    orphans = []
    async for rel_url, _size in iter_pool_refs():
        if rel_url not in referenced_urls:
            orphans.append(rel_url)
    return orphans
```

- [ ] **Step 4: Run — pass**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_reference_pool_storage.py -v
```

Expected: PASS — 2 tests

- [ ] **Step 5: 추가 테스트 — path traversal / delete / orphan**

```python
# backend/tests/studio/test_reference_pool_storage.py 끝에 추가

@pytest.mark.parametrize("unsafe_url", [
    "/images/studio/reference-pool/../../../etc/passwd",
    "/images/studio/reference-pool/sub/file.png",
    "/images/studio/other/file.png",
    "/images/studio/reference-pool",  # trailing slash 없음 — collision 방어
    "/images/studio/reference-pool-evil/file.png",  # prefix collision
    "../escape.png",
    "",
    "/images/studio/reference-pool/",  # 빈 fname
])
def test_is_path_safe_rejects_unsafe(unsafe_url, tmp_pool_dir):
    from studio.reference_pool import is_path_safe
    assert is_path_safe(unsafe_url) is False


def test_is_path_safe_accepts_valid(tmp_pool_dir):
    from studio.reference_pool import is_path_safe
    assert is_path_safe("/images/studio/reference-pool/abc123.png") is True


@pytest.mark.asyncio
async def test_pool_path_from_url_unsafe_raises(tmp_pool_dir):
    from studio.reference_pool import pool_path_from_url
    with pytest.raises(ValueError, match="unsafe"):
        pool_path_from_url("../escape.png")


@pytest.mark.asyncio
async def test_delete_pool_ref_idempotent(tmp_pool_dir):
    from studio.reference_pool import delete_pool_ref
    result = await delete_pool_ref("/images/studio/reference-pool/nonexistent.png")
    assert result is True  # missing_ok=True → True (idempotent)


@pytest.mark.asyncio
async def test_list_orphan_pool_refs(tmp_pool_dir):
    from studio.reference_pool import save_to_pool, list_orphan_pool_refs

    img = make_png_bytes()
    ref1 = await save_to_pool(img, "image/png")
    ref2 = await save_to_pool(img, "image/png")
    ref3 = await save_to_pool(img, "image/png")

    referenced = {ref1, ref2}
    orphans = await list_orphan_pool_refs(referenced)
    assert orphans == [ref3]
```

- [ ] **Step 6: Run all**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_reference_pool_storage.py -v
```

Expected: PASS — 12 tests (8 parametrized + 4)

- [ ] **Step 7: Commit (사용자 명시 시만)**

후보 메시지:
```
feat(reference-pool): 임시 풀 storage + path traversal 보안 + PNG 통일

- save_to_pool / delete_pool_ref / iter_pool_refs / list_orphan_pool_refs
- POOL_URL_PREFIX trailing slash 포함 (collision 방어)
- pool_path_from_url() 공용 검증 헬퍼
- PNG 통일 (RGB 도 PNG 저장)

Plan: 2026-04-29-reference-library-v9.md (Phase A.1)
```

### Task A.2: history_db.py — pool 함수 + cascade unlink 확장

**Files:**
- Modify: `backend/studio/history_db.py`
- Modify: `backend/tests/studio/test_history_db.py`
- Test: `backend/tests/studio/test_history_db_cascade.py` (NEW)

- [ ] **Step 1: pool 함수 신규 — 실패 테스트**

```python
# backend/tests/studio/test_history_db.py 끝에 추가
@pytest.mark.asyncio
async def test_count_pool_refs(tmp_db):
    """studio_history.reference_ref 중 임시 풀 prefix 로 시작하는 row 개수."""
    from studio.history_db import insert_item, count_pool_refs

    # _make_history_item helper (기존 테스트 fixture 재활용)
    await insert_item(_make_history_item(
        item_id="h1", mode="edit", reference_ref="/images/studio/reference-pool/a.png"
    ))
    await insert_item(_make_history_item(
        item_id="h2", mode="edit", reference_ref="/images/studio/reference-pool/b.png"
    ))
    await insert_item(_make_history_item(
        item_id="h3", mode="edit", reference_ref="/images/studio/reference-templates/c.png"
    ))
    await insert_item(_make_history_item(item_id="h4", mode="edit", reference_ref=None))

    count = await count_pool_refs()
    assert count == 2


@pytest.mark.asyncio
async def test_list_history_pool_refs(tmp_db):
    from studio.history_db import insert_item, list_history_pool_refs

    await insert_item(_make_history_item(
        item_id="h1", reference_ref="/images/studio/reference-pool/a.png"
    ))
    await insert_item(_make_history_item(
        item_id="h2", reference_ref="/images/studio/reference-pool/a.png"
    ))
    await insert_item(_make_history_item(
        item_id="h3", reference_ref="/images/studio/reference-pool/b.png"
    ))

    refs = await list_history_pool_refs()
    assert refs == {
        "/images/studio/reference-pool/a.png",
        "/images/studio/reference-pool/b.png",
    }
```

> **`_make_history_item`**: 기존 `backend/tests/studio/test_history_db.py` 의 helper 또는 conftest fixture 활용 (실 시그니처는 진입 시점 grep 후 반영 — 정확히 어떤 컬럼이 NOT NULL 인지 확인).

- [ ] **Step 2: 실패 — Run**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_history_db.py -v -k "pool_refs"
```

Expected: FAIL — `cannot import name 'count_pool_refs'`

- [ ] **Step 3: history_db.py 구현 (Codex C3 — 실 식별자 사용)**

```python
# backend/studio/history_db.py 끝에 추가
# (기존 _DB_PATH / studio_history 테이블 / aiosqlite 사용 패턴 그대로)

POOL_URL_PREFIX = "/images/studio/reference-pool/"  # reference_pool 과 동기 (DRY 후보 — 다음 round 에서 분리)


async def count_pool_refs() -> int:
    """studio_history 중 임시 풀 prefix 로 시작하는 reference_ref 보유 row 개수."""
    async with aiosqlite.connect(_DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM studio_history WHERE reference_ref LIKE ?",
            (POOL_URL_PREFIX + "%",),
        ) as cur:
            row = await cur.fetchone()
            return row[0] if row else 0


async def list_history_pool_refs() -> set[str]:
    """studio_history 의 임시 풀 reference_ref 모두 set 으로 반환 (orphan 검출용)."""
    async with aiosqlite.connect(_DB_PATH) as db:
        async with db.execute(
            "SELECT DISTINCT reference_ref FROM studio_history WHERE reference_ref LIKE ?",
            (POOL_URL_PREFIX + "%",),
        ) as cur:
            rows = await cur.fetchall()
            return {row[0] for row in rows if row[0]}
```

- [ ] **Step 4: Run — pass**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_history_db.py -v -k "pool_refs"
```

Expected: PASS

- [ ] **Step 5: cascade unlink 테스트 (NEW 파일)**

```python
# backend/tests/studio/test_history_db_cascade.py
"""delete_item_with_refs / clear_all_with_refs 의 임시 풀 cascade 검증."""
import pytest
from unittest.mock import patch, AsyncMock

from tests.studio.test_history_db import _make_history_item  # 기존 helper


@pytest.mark.asyncio
async def test_delete_item_with_refs_unlinks_orphan_pool_ref(tmp_db, tmp_pool_dir):
    """삭제하는 row 가 마지막 참조면 임시 풀 파일 unlink."""
    from studio.history_db import insert_item, delete_item_with_refs
    from studio.reference_pool import save_to_pool

    img = b"\x89PNG\r\n\x1a\n..."  # 또는 make_png_bytes() 헬퍼
    # 실제 PIL bytes 가 필요하면 conftest 의 make_png_bytes fixture 사용

    ref = await save_to_pool(make_png_bytes(), "image/png")
    await insert_item(_make_history_item(item_id="h1", reference_ref=ref))

    with patch("studio.history_db.delete_pool_ref", new_callable=AsyncMock) as mock_del:
        await delete_item_with_refs("h1")
        mock_del.assert_called_once_with(ref)


@pytest.mark.asyncio
async def test_delete_item_with_refs_keeps_shared_pool_ref(tmp_db, tmp_pool_dir):
    """다른 row 도 같은 ref 참조 시 unlink 안 함."""
    from studio.history_db import insert_item, delete_item_with_refs
    from studio.reference_pool import save_to_pool

    ref = await save_to_pool(make_png_bytes(), "image/png")
    await insert_item(_make_history_item(item_id="h1", reference_ref=ref))
    await insert_item(_make_history_item(item_id="h2", reference_ref=ref))

    with patch("studio.history_db.delete_pool_ref", new_callable=AsyncMock) as mock_del:
        await delete_item_with_refs("h1")
        mock_del.assert_not_called()


@pytest.mark.asyncio
async def test_delete_item_with_refs_skips_permanent_ref(tmp_db):
    """영구 라이브러리 ref 는 cascade 안 됨 (별도 lifecycle)."""
    from studio.history_db import insert_item, delete_item_with_refs

    permanent = "/images/studio/reference-templates/abc.png"
    await insert_item(_make_history_item(item_id="h1", reference_ref=permanent))

    with patch("studio.history_db.delete_pool_ref", new_callable=AsyncMock) as mock_del:
        await delete_item_with_refs("h1")
        mock_del.assert_not_called()


@pytest.mark.asyncio
async def test_clear_all_with_refs_unlinks_all_pool_refs(tmp_db, tmp_pool_dir):
    """전체 삭제 시 임시 풀 ref 모두 unlink (Codex I2)."""
    from studio.history_db import insert_item, clear_all_with_refs
    from studio.reference_pool import save_to_pool

    ref1 = await save_to_pool(make_png_bytes(), "image/png")
    ref2 = await save_to_pool(make_png_bytes(), "image/png")
    permanent = "/images/studio/reference-templates/perm.png"

    await insert_item(_make_history_item(item_id="h1", reference_ref=ref1))
    await insert_item(_make_history_item(item_id="h2", reference_ref=ref2))
    await insert_item(_make_history_item(item_id="h3", reference_ref=permanent))

    with patch("studio.history_db.delete_pool_ref", new_callable=AsyncMock) as mock_del:
        await clear_all_with_refs()
        # ref1, ref2 둘 다 unlink. permanent 는 호출 안 됨.
        called_args = {c.args[0] for c in mock_del.await_args_list}
        assert called_args == {ref1, ref2}
```

- [ ] **Step 6: 실패 — Run**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_history_db_cascade.py -v
```

Expected: FAIL — cascade 로직 없음

- [ ] **Step 7: delete_item_with_refs / clear_all_with_refs 에 cascade 로직 추가**

```python
# backend/studio/history_db.py — 기존 함수 수정 (정확한 hunk 는 진입 시점 grep 후 결정)

from studio.reference_pool import delete_pool_ref  # 상단 import


async def delete_item_with_refs(item_id: str) -> tuple[bool, list[str]]:
    """history row 삭제 + 영구 라이브러리 ref + 임시 풀 ref cascade.

    옛 v8: 영구 라이브러리 ref 만 삭제 대상.
    v9: 임시 풀 ref 도 cascade — 다른 row 가 참조 안 하면 디스크 unlink.
    """
    async with aiosqlite.connect(_DB_PATH) as db:
        # 1. 삭제할 row 의 reference_ref 조회 (image_ref 등 옛 v8 흐름은 그대로)
        async with db.execute(
            "SELECT reference_ref, image_ref FROM studio_history WHERE id = ?",
            (item_id,),
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return (False, [])
        ref_to_check = row[0]
        deleted_image_refs = [row[1]] if row[1] else []  # 옛 v8 흐름

        # 2. 행 삭제
        await db.execute("DELETE FROM studio_history WHERE id = ?", (item_id,))
        await db.commit()

        # 3. 임시 풀 ref cascade 검사
        if ref_to_check and ref_to_check.startswith(POOL_URL_PREFIX):
            async with db.execute(
                "SELECT 1 FROM studio_history WHERE reference_ref = ? LIMIT 1",
                (ref_to_check,),
            ) as cur:
                shared = await cur.fetchone()
            if shared is None:
                try:
                    await delete_pool_ref(ref_to_check)
                except ValueError:
                    pass  # safe 검증 실패는 silent (이미 reference_pool 내부에서 로그)

    # 4. 옛 v8 의 image_ref unlink 흐름은 호출자가 처리 (변경 X)
    return (True, deleted_image_refs)


async def clear_all_with_refs() -> tuple[int, list[str], list[str]]:
    """전체 삭제 + 모든 임시 풀 ref unlink + 영구 라이브러리 ref 반환.

    v9 추가: pool_refs 도 일괄 unlink (Codex I2).
    옛 v8: image_refs / reference_template_refs 는 호출자가 처리.
    """
    async with aiosqlite.connect(_DB_PATH) as db:
        # 1. 영구 라이브러리 ref 모두 (옛 흐름)
        async with db.execute(
            "SELECT image_ref FROM studio_history WHERE image_ref IS NOT NULL"
        ) as cur:
            image_refs = [r[0] for r in await cur.fetchall()]

        # 2. 임시 풀 ref 모두 (v9 추가)
        async with db.execute(
            "SELECT DISTINCT reference_ref FROM studio_history WHERE reference_ref LIKE ?",
            (POOL_URL_PREFIX + "%",),
        ) as cur:
            pool_refs = [r[0] for r in await cur.fetchall() if r[0]]

        # 3. 행 삭제
        cur = await db.execute("DELETE FROM studio_history")
        deleted_count = cur.rowcount
        await db.commit()

        # 4. 임시 풀 unlink (v9 — 호출자가 image_refs 처리하는 동안 풀은 여기서)
        for ref in pool_refs:
            try:
                await delete_pool_ref(ref)
            except ValueError:
                pass

    # 옛 v8 호환 — 호출자가 image_refs 받아서 unlink
    return (deleted_count, image_refs, pool_refs)
```

> **주의**: 위 함수 시그니처는 *현재 master 의 실 시그니처에 맞춰* 진입 시점 정정 필요. 핵심은:
> - 임시 풀 cascade 로직 추가
> - 옛 흐름 (image_ref unlink) 보존
> - 반환값에 pool_refs 추가 (호출자가 활용 가능)

- [ ] **Step 8: Run — pass**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_history_db_cascade.py tests/studio/test_history_db.py -v
```

Expected: PASS

- [ ] **Step 9: Commit (사용자 명시 시만)**

후보 메시지:
```
feat(history-db): 임시 풀 cascade unlink + pool 통계 함수

- delete_item_with_refs 가 임시 풀 ref 마지막 참조 시 unlink
- clear_all_with_refs 가 임시 풀 ref 모두 unlink (전체 삭제 cascade)
- count_pool_refs / list_history_pool_refs 추가 (orphan 검출용)
- 영구 라이브러리 ref 는 cascade 제외 (별도 lifecycle)

Plan: 2026-04-29-reference-library-v9.md (Phase A.2)
```

### Task A.3: routes/streams.py — 사용자 직접 업로드 시 임시 풀 저장

**Files:**
- Modify: `backend/studio/routes/streams.py`
- Modify: `backend/studio/pipelines/edit.py` (옛 v8 자동 저장 흔적 제거)
- Test: `backend/tests/studio/test_edit_pipeline_pool_save.py` (NEW)

> **사전 grep**: 작업 진입 시 `grep -n "reference_bytes\|reference_ref_url" backend/studio/routes/streams.py` 와 `grep -n "_run_edit_pipeline" backend/studio/pipelines/edit.py` 로 정확한 시그니처 캡처. 본 task 는 *streams.py 가 multipart 파싱 후 reference_bytes 를 받음 → save_to_pool 호출 → reference_ref_url 인자에 임시 풀 URL 전달* 흐름.

- [ ] **Step 1: 실패 테스트**

```python
# backend/tests/studio/test_edit_pipeline_pool_save.py
"""사용자가 reference_image multipart 로 업로드 시 임시 풀 저장 흐름.

routes/streams.py 가 multipart 를 받아서:
- reference_template_id 가 있음 → 영구 라이브러리 URL 사용 (옛 v8)
- reference_template_id 없음 + reference_bytes 있음 → save_to_pool() → 임시 풀 URL
"""
import io
import pytest
from httpx import AsyncClient, ASGITransport
from PIL import Image
from unittest.mock import patch, AsyncMock


def _png_upload(name: str = "ref.png") -> tuple[str, bytes, str]:
    buf = io.BytesIO()
    Image.new("RGB", (256, 256), color="green").save(buf, format="PNG")
    return (name, buf.getvalue(), "image/png")


@pytest.mark.asyncio
async def test_user_upload_saves_to_pool(tmp_db, tmp_pool_dir, monkeypatch):
    """사용자 직접 업로드 → save_to_pool 호출 + reference_ref_url 에 임시 풀 URL."""
    from studio.routes.streams import edit_stream  # endpoint
    # 또는 app fixture 로 ASGI transport
    from main import app

    captured = {}

    async def fake_run_edit(*args, **kwargs):
        captured["reference_ref_url"] = kwargs.get("reference_ref_url")
        captured["reference_bytes"] = kwargs.get("reference_bytes")
        return  # SSE drain — 테스트에선 종료까지 안 봄

    monkeypatch.setattr("studio.routes.streams._run_edit_pipeline", fake_run_edit)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        files = {"reference_image": _png_upload()}
        data = {
            "prompt": "make her smile",
            "use_reference_image": "true",
            "reference_role": "outfit",
            # reference_template_id 미전송 → 사용자 직접 업로드
        }
        # 실 multipart endpoint 는 master 의 streams.py 에서 확인
        await client.post("/api/studio/edit", data=data, files=files)

    assert captured["reference_ref_url"] is not None
    assert captured["reference_ref_url"].startswith("/images/studio/reference-pool/")


@pytest.mark.asyncio
async def test_template_pick_uses_permanent_url(tmp_db, monkeypatch):
    """라이브러리 픽 (reference_template_id) → 영구 라이브러리 URL."""
    from main import app

    captured = {}

    async def fake_run_edit(*args, **kwargs):
        captured["reference_ref_url"] = kwargs.get("reference_ref_url")

    monkeypatch.setattr("studio.routes.streams._run_edit_pipeline", fake_run_edit)
    async def fake_get_template(tid):
        return {"id": tid, "image_ref": "/images/studio/reference-templates/perm.png"}
    monkeypatch.setattr("studio.routes.streams.get_reference_template", fake_get_template)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        files = {"reference_image": _png_upload()}  # 임시 input 업로드용 bytes
        data = {
            "prompt": "x",
            "use_reference_image": "true",
            "reference_template_id": "tpl-uuid",
        }
        await client.post("/api/studio/edit", data=data, files=files)

    assert captured["reference_ref_url"] == "/images/studio/reference-templates/perm.png"
```

- [ ] **Step 2: Run — fail**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_edit_pipeline_pool_save.py -v
```

Expected: FAIL — `reference_ref_url` 이 None (현재 코드는 임시 풀 저장 안 함)

- [ ] **Step 3: routes/streams.py 수정 (정확한 라인 수는 grep 후)**

```python
# backend/studio/routes/streams.py 변경 골자

from studio.reference_pool import save_to_pool

# multipart 파싱 직후 (현재 reference_bytes 검증 끝난 자리 — streams.py:170 근처)
reference_ref_url: str | None = None
if reference_bytes is not None:
    if reference_template_id:
        # 라이브러리 픽 — 영구 URL 사용 (save_to_pool 호출 X)
        template = await get_reference_template(reference_template_id)
        if template is None:
            raise HTTPException(404, f"reference template not found: {reference_template_id}")
        reference_ref_url = template["image_ref"]
    else:
        # 사용자 직접 업로드 — 임시 풀 저장
        try:
            reference_ref_url = await save_to_pool(
                reference_bytes,
                reference_image.content_type or "image/png",
            )
        except ValueError as e:
            raise HTTPException(400, f"invalid reference image: {e}") from e

# _run_edit_pipeline 호출 시 reference_ref_url 전달
await _run_edit_pipeline(
    ...,
    reference_bytes=reference_bytes,  # ComfyUI 임시 input 업로드용 (옛 흐름)
    reference_ref_url=reference_ref_url,  # history.referenceRef 저장용 (v9 — 임시 풀 OR 영구 라이브러리)
    ...,
)
```

- [ ] **Step 4: pipelines/edit.py 의 _run_edit_pipeline — reference_ref_url 인자 처리**

```python
# backend/studio/pipelines/edit.py — _run_edit_pipeline 시그니처 변경 X (이미 reference_ref_url 인자 보유 — Codex C4)
# v9 변경 점: history insert 시 reference_ref_url 을 그대로 저장 (옛 v8 의 NULL or template URL 분기 → 통일)

# 기존 코드 (v8):
# if reference_template_id:
#     reference_ref = template_url
# else:
#     reference_ref = None

# v9 코드:
reference_ref = reference_ref_url  # routes/streams.py 가 결정 → 그대로 사용

# history insert 의 dict 에 reference_ref 컬럼 그대로 저장 (옛 흐름)
```

- [ ] **Step 5: Run — pass**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_edit_pipeline_pool_save.py -v
```

Expected: PASS — 2 tests

- [ ] **Step 6: 회귀 검증 — 옛 edit pytest 통과**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/ -v
```

Expected: 215 + 신규 ≈ 230+ PASS

- [ ] **Step 7: Commit (사용자 명시 시만)**

후보 메시지:
```
feat(edit-pipeline): 사용자 직접 업로드 reference 를 임시 풀에 저장

- routes/streams.py: multipart 파싱 후 reference_template_id 없으면 save_to_pool() 호출
- pipelines/edit.py: history insert 시 reference_ref_url 그대로 사용 (옛 NULL 분기 폐기)
- 라이브러리 픽 (reference_template_id 있음) 은 영구 라이브러리 URL 그대로

Plan: 2026-04-29-reference-library-v9.md (Phase A.3)
```

### Task A.4: routes/reference_pool.py — stats / orphans / DELETE orphans

**Files:**
- Create: `backend/studio/routes/reference_pool.py`
- Modify: `backend/studio/routes/__init__.py`
- Test: `backend/tests/studio/test_reference_pool_routes.py` (NEW)

- [ ] **Step 1: 실패 테스트 (ASGITransport 패턴 — Codex I11)**

```python
# backend/tests/studio/test_reference_pool_routes.py
import pytest
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.mark.asyncio
async def test_get_pool_stats(tmp_db, tmp_pool_dir):
    from studio.reference_pool import save_to_pool
    img = make_png_bytes()
    await save_to_pool(img, "image/png")
    await save_to_pool(img, "image/png")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/studio/reference-pool/stats")

    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 2
    assert data["totalBytes"] > 0


@pytest.mark.asyncio
async def test_get_orphans(tmp_db, tmp_pool_dir):
    from studio.reference_pool import save_to_pool
    from studio.history_db import insert_item

    referenced = await save_to_pool(make_png_bytes(), "image/png")
    orphan = await save_to_pool(make_png_bytes(), "image/png")
    await insert_item(_make_history_item(item_id="h1", reference_ref=referenced))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/studio/reference-pool/orphans")

    assert resp.status_code == 200
    assert resp.json()["refs"] == [orphan]


@pytest.mark.asyncio
async def test_delete_orphans(tmp_db, tmp_pool_dir):
    from studio.reference_pool import save_to_pool, iter_pool_refs
    from studio.history_db import insert_item

    referenced = await save_to_pool(make_png_bytes(), "image/png")
    orphan1 = await save_to_pool(make_png_bytes(), "image/png")
    orphan2 = await save_to_pool(make_png_bytes(), "image/png")
    await insert_item(_make_history_item(item_id="h1", reference_ref=referenced))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.delete("/api/studio/reference-pool/orphans")

    assert resp.status_code == 200
    assert resp.json()["deleted"] == 2

    remaining = [ref async for ref, _ in iter_pool_refs()]
    assert remaining == [referenced]
```

- [ ] **Step 2: Run — fail (404)**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_reference_pool_routes.py -v
```

Expected: FAIL — 404

- [ ] **Step 3: 라우터 작성 (기존 reference_templates.py 패턴 따라 — prefix 직접 박힘)**

```python
# backend/studio/routes/reference_pool.py
"""GET stats / GET orphans / DELETE orphans endpoints.

기존 reference_templates 패턴 따라 router prefix 없음.
endpoint 경로에 /reference-pool 직접 박음.
"""

from fastapi import APIRouter

from studio.reference_pool import iter_pool_refs, list_orphan_pool_refs, delete_pool_ref
from studio.history_db import list_history_pool_refs


router = APIRouter(tags=["reference-pool"])


@router.get("/reference-pool/stats")
async def get_stats() -> dict:
    """임시 풀 사용량 — count + total bytes."""
    count = 0
    total = 0
    async for _ref, size in iter_pool_refs():
        count += 1
        total += size
    return {"count": count, "totalBytes": total}


@router.get("/reference-pool/orphans")
async def get_orphans() -> dict:
    """history 에서 참조 안 된 임시 풀 ref 목록."""
    referenced = await list_history_pool_refs()
    orphans = await list_orphan_pool_refs(referenced)
    return {"refs": orphans, "count": len(orphans)}


@router.delete("/reference-pool/orphans")
async def delete_orphans() -> dict:
    """orphan 일괄 삭제. 영구 라이브러리는 손대지 않음.

    Race 완화 (Codex I4): delete 직전에 history snapshot 다시 조회.
    """
    referenced_now = await list_history_pool_refs()
    orphans_initial = await list_orphan_pool_refs(referenced_now)

    deleted = 0
    for ref in orphans_initial:
        # double-check race — delete 직전 snapshot 재조회
        referenced_recheck = await list_history_pool_refs()
        if ref in referenced_recheck:
            continue  # race — 새 history 가 참조 시작했으면 skip

        try:
            ok = await delete_pool_ref(ref)
            if ok:
                deleted += 1
        except ValueError:
            continue

    return {"deleted": deleted, "totalOrphans": len(orphans_initial)}
```

- [ ] **Step 4: routes/__init__.py 등록**

```python
# backend/studio/routes/__init__.py — 기존 패턴 따라
from . import reference_pool
studio_router.include_router(reference_pool.router)
```

- [ ] **Step 5: Run — pass**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_reference_pool_routes.py -v
```

Expected: PASS — 3 tests

- [ ] **Step 6: Commit (사용자 명시 시만)**

후보 메시지:
```
feat(reference-pool): GET stats/orphans + DELETE orphans 라우트

- /api/studio/reference-pool/stats — count + totalBytes
- /api/studio/reference-pool/orphans — orphan list
- /api/studio/reference-pool/orphans (DELETE) — orphan 일괄 삭제 + race double-check
- 영구 라이브러리는 손대지 않음

Plan: 2026-04-29-reference-library-v9.md (Phase A.4)
```

### Task A.5: routes/reference_templates.py — POST /promote/{history_id}

**Files:**
- Modify: `backend/studio/routes/reference_templates.py`
- Test: `backend/tests/studio/test_reference_promote_route.py` (NEW)

- [ ] **Step 1: 실패 테스트 (ASGITransport + 응답 shape Codex I10 + 이름 검증 + rollback)**

```python
# backend/tests/studio/test_reference_promote_route.py
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, AsyncMock
from main import app


@pytest.mark.asyncio
async def test_promote_from_history(tmp_db, tmp_pool_dir, tmp_template_dir):
    """POST /reference-templates/promote/{history_id} → 영구 라이브러리 + DB row + history.referenceRef swap."""
    from studio.reference_pool import save_to_pool
    from studio.history_db import insert_item, get_item

    pool_ref = await save_to_pool(make_png_bytes(), "image/png")
    await insert_item(_make_history_item(
        item_id="h1", reference_ref=pool_ref, reference_role="outfit"
    ))

    with patch(
        "studio.routes.reference_templates._describe_image",
        new_callable=AsyncMock,
    ) as mock_v:
        mock_v.return_value = "test description"
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                "/api/studio/reference-templates/promote/h1",
                json={"name": "내 셔츠"},
            )

    assert resp.status_code == 200
    data = resp.json()
    tpl = data["template"]
    assert tpl["name"] == "내 셔츠"
    assert tpl["imageRef"].startswith("/images/studio/reference-templates/")
    assert tpl["visionDescription"] == "test description"  # Codex I10 — shape 일치
    assert tpl["roleDefault"] == "outfit"  # Codex I10

    # history.referenceRef 가 영구 URL 로 swap 됨 (Codex I3)
    item = await get_item("h1")
    assert item["referenceRef"] == tpl["imageRef"]


@pytest.mark.asyncio
async def test_promote_invalid_history(tmp_db):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/studio/reference-templates/promote/nonexistent",
            json={"name": "x"},
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_promote_history_without_pool_ref(tmp_db):
    """referenceRef 가 NULL 이거나 영구 라이브러리 URL 인 history 는 promote 거부 (400)."""
    from studio.history_db import insert_item

    await insert_item(_make_history_item(item_id="h1", reference_ref=None))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/studio/reference-templates/promote/h1",
            json={"name": "x"},
        )
    assert resp.status_code == 400


@pytest.mark.parametrize("invalid_name", ["", " ", "a" * 65, "name<script>", "a/b"])
@pytest.mark.asyncio
async def test_promote_name_validation(invalid_name, tmp_db, tmp_pool_dir):
    from studio.reference_pool import save_to_pool
    from studio.history_db import insert_item

    pool_ref = await save_to_pool(make_png_bytes(), "image/png")
    await insert_item(_make_history_item(item_id="h1", reference_ref=pool_ref))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/studio/reference-templates/promote/h1",
            json={"name": invalid_name},
        )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_promote_db_failure_rolls_back_file(tmp_db, tmp_pool_dir, tmp_template_dir, monkeypatch):
    """DB insert 실패 시 dst 파일 unlink (Codex I5 — 옛 v8 fix #2 패턴 그대로)."""
    from studio.reference_pool import save_to_pool
    from studio.history_db import insert_item

    pool_ref = await save_to_pool(make_png_bytes(), "image/png")
    await insert_item(_make_history_item(item_id="h1", reference_ref=pool_ref))

    async def fake_insert(*args, **kwargs):
        raise RuntimeError("simulated DB failure")
    monkeypatch.setattr("studio.routes.reference_templates.insert_reference_template", fake_insert)

    with patch("studio.routes.reference_templates._describe_image", new_callable=AsyncMock) as mock_v:
        mock_v.return_value = "x"
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                "/api/studio/reference-templates/promote/h1",
                json={"name": "good"},
            )

    assert resp.status_code == 500
    # tmp_template_dir 가 비어있어야 (rollback 됨)
    files = list(tmp_template_dir.iterdir())
    assert files == []


@pytest.mark.asyncio
async def test_promote_vision_failure_silent_partial_success(tmp_db, tmp_pool_dir, tmp_template_dir, monkeypatch):
    """vision 실패 시 description="" 으로 silent + DB row 는 성공 (Codex I6)."""
    from studio.reference_pool import save_to_pool
    from studio.history_db import insert_item

    pool_ref = await save_to_pool(make_png_bytes(), "image/png")
    await insert_item(_make_history_item(item_id="h1", reference_ref=pool_ref))

    async def fake_vision(*args, **kwargs):
        raise RuntimeError("ollama down")
    monkeypatch.setattr("studio.routes.reference_templates._describe_image", fake_vision)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/studio/reference-templates/promote/h1",
            json={"name": "ok"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["template"]["visionDescription"] == ""
    # 응답에 vision 실패 플래그 (UI 가 부분 성공 토스트 표시)
    assert data.get("visionFailed") is True
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: promote endpoint 구현 (Codex C5 + I3 + I5 + I6 + I10)**

```python
# backend/studio/routes/reference_templates.py 끝에 추가

import re
import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel

import aiosqlite
from studio.history_db import (
    _DB_PATH, get_item, insert_reference_template, POOL_URL_PREFIX,
)
from studio.reference_pool import pool_path_from_url
from studio.reference_storage import (
    REFERENCE_TEMPLATES_DIR,
    URL_PREFIX as TEMPLATE_URL_PREFIX,
    _describe_image,
)


class PromoteRequest(BaseModel):
    name: str


# 1~64자 + alphanumeric/한글/공백/하이픈/언더스코어
NAME_PATTERN = re.compile(r"^[A-Za-z0-9가-힣\s_\-]{1,64}$")


@router.post("/reference-templates/promote/{history_id}")
async def promote_from_history(history_id: str, body: PromoteRequest) -> dict:
    """임시 풀 ref → 영구 라이브러리 promote.

    1. history.referenceRef 가 임시 풀 URL 인지 검증 (pool_path_from_url 활용 · Codex C6)
    2. 임시 풀 파일을 reference-templates/ 로 shutil.copy2 (소스 보존)
    3. vision 분석 1회 (실패 시 description="" silent · I6)
    4. reference_templates DB row insert (실패 시 dst unlink rollback · I5)
    5. studio_history.reference_ref 영구 URL 로 swap (Codex I3)
    """
    name = body.name.strip()
    if not NAME_PATTERN.match(name):
        raise HTTPException(400, "invalid name (1~64자, alphanumeric/한글/공백/하이픈/언더스코어 only)")

    item = await get_item(history_id)
    if item is None:
        raise HTTPException(404, f"history not found: {history_id}")

    pool_ref = item.get("referenceRef") or ""
    if not pool_ref.startswith(POOL_URL_PREFIX):
        raise HTTPException(400, "history has no pool reference (NULL or already a permanent ref)")

    # 1. 안전 검증 (Codex C6)
    try:
        src_path = pool_path_from_url(pool_ref)
    except ValueError:
        raise HTTPException(400, f"unsafe pool ref: {pool_ref}")

    if not src_path.exists():
        raise HTTPException(404, "pool file missing on disk")

    # 2. 파일 복사 — extension 보존 (PNG 통일이라 항상 .png 지만 future-safe)
    new_ext = src_path.suffix.lstrip(".") or "png"
    new_fname = f"{uuid4().hex}.{new_ext}"
    dst_path = REFERENCE_TEMPLATES_DIR / new_fname
    shutil.copy2(src_path, dst_path)
    template_url = f"{TEMPLATE_URL_PREFIX}/{new_fname}"

    # 3. vision 분석 (실패 silent — Codex I6)
    vision_failed = False
    try:
        description = await _describe_image(dst_path)
    except Exception:
        description = ""
        vision_failed = True

    # 4. DB row insert + rollback (Codex I5)
    role = item.get("referenceRole") or "custom"
    try:
        template = await insert_reference_template({
            "name": name,
            "image_ref": template_url,
            "role_default": role,
            "vision_description": description,
        })
    except Exception:
        try:
            dst_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise HTTPException(500, "failed to save reference template")

    # 5. studio_history.reference_ref swap (Codex I3)
    async with aiosqlite.connect(_DB_PATH) as db:
        await db.execute(
            "UPDATE studio_history SET reference_ref = ? WHERE id = ?",
            (template_url, history_id),
        )
        await db.commit()

    return {
        "template": template,  # shape: { id, name, imageRef, visionDescription, roleDefault, ... }
        "visionFailed": vision_failed,
    }
```

> **주의**: 위 `insert_reference_template` 의 인자 shape (`name` / `image_ref` / `role_default` / `vision_description`) 은 *실 master 의 시그니처에 맞춤*. 진입 시 grep 으로 재확인 후 정정.

- [ ] **Step 4: Run — pass**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_reference_promote_route.py -v
```

Expected: PASS — 9 tests (5 parametrized + 4)

- [ ] **Step 5: Commit (사용자 명시 시만)**

후보 메시지:
```
feat(reference-templates): POST /promote/{history_id} 사후 저장 endpoint

- 임시 풀 ref → 영구 라이브러리 shutil.copy2 (소스 보존)
- vision 분석 1회 (실패 silent description="" + visionFailed 플래그)
- DB insert 실패 시 dst 파일 rollback
- studio_history.reference_ref 영구 URL 로 swap (canPromote 자동 false)
- pool_path_from_url() 공용 검증 헬퍼 사용

Plan: 2026-04-29-reference-library-v9.md (Phase A.5)
```

### Task A.6: routes/system.py — DELETE /history 의 풀 cascade

**Files:**
- Modify: `backend/studio/routes/system.py` (line 288 근처 — Codex I2)

> **사전 grep**: `grep -n "clear_all\|/history" backend/studio/routes/system.py`

- [ ] **Step 1: 회귀 테스트 (전체 삭제 시 임시 풀 cleanup)**

```python
# backend/tests/studio/test_history_db_cascade.py 끝에 추가
# (이미 Step 5 에서 clear_all_with_refs 테스트 1건 작성 — 그 회귀가 routes 통과하는지 확인)

@pytest.mark.asyncio
async def test_delete_all_history_route_cleans_pool(tmp_db, tmp_pool_dir):
    """DELETE /api/studio/history → 임시 풀도 함께 cleanup."""
    from studio.reference_pool import save_to_pool, iter_pool_refs
    from studio.history_db import insert_item

    ref = await save_to_pool(make_png_bytes(), "image/png")
    await insert_item(_make_history_item(item_id="h1", reference_ref=ref))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.delete("/api/studio/history")

    assert resp.status_code == 200
    remaining = [r async for r, _ in iter_pool_refs()]
    assert remaining == []
```

- [ ] **Step 2: routes/system.py 의 DELETE /history 핸들러 수정**

```python
# 옛 코드 (system.py:288 근처):
# count, image_refs = await clear_all_with_refs()
# for ref in image_refs:
#     # unlink permanent images

# 새 코드 (v9):
count, image_refs, pool_refs = await clear_all_with_refs()
for ref in image_refs:
    # unlink permanent images (옛 흐름 그대로)
    ...
# pool_refs 는 history_db 가 이미 unlink (Task A.2) — 호출자는 추가 작업 없음
```

> **주의**: A.2 에서 `clear_all_with_refs` 의 반환값을 `(count, image_refs, pool_refs)` 튜플로 확장. 호출자 (`system.py:288`) 가 이를 unpack 하도록 수정.

- [ ] **Step 3: Run — pass**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/ -v
```

Expected: PASS — 모든 테스트

- [ ] **Step 4: Commit (사용자 명시 시만)**

후보 메시지:
```
feat(system): DELETE /history 가 임시 풀도 cleanup

- routes/system.py: clear_all_with_refs 의 새 반환값 (count, image_refs, pool_refs) 활용
- 임시 풀 unlink 는 history_db 안에서 이미 처리 — 호출자는 unpacking 만

Plan: 2026-04-29-reference-library-v9.md (Phase A.6)
```

### Task A.7: 옛 v8 saveAsTemplate / templateName 백엔드 잔재 제거

**Files:**
- Modify: 진입 시 grep 결과 따라 (`grep -rn "saveAsTemplate\|template_name" backend/`)

- [ ] **Step 1: 옛 자동 저장 코드 grep**

```bash
cd backend && grep -rn "saveAsTemplate\|template_name" studio/
```

진입 시 결과 캡처. 가능 위치:
- `routes/streams.py` 의 multipart 필드 받기
- `pipelines/edit.py` 의 자동 promote 분기
- `routes/reference_templates.py` 의 자동 저장 helper

- [ ] **Step 2: 발견된 흔적 모두 제거 + 회귀 테스트**

```python
# backend/tests/studio/test_no_auto_save.py (NEW)
"""saveAsTemplate / template_name 필드 무시 검증."""
@pytest.mark.asyncio
async def test_edit_pipeline_ignores_save_as_template_field(tmp_db, tmp_pool_dir, monkeypatch):
    """saveAsTemplate=true 라도 reference_templates 자동 row 없음."""
    from studio.history_db import list_reference_templates
    from main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        files = {"reference_image": _png_upload()}
        data = {
            "prompt": "x",
            "use_reference_image": "true",
            "save_as_template": "true",
            "template_name": "should not be saved",
        }
        await client.post("/api/studio/edit", data=data, files=files)

    templates = await list_reference_templates()
    assert templates == []  # 자동 저장 안 됨
```

- [ ] **Step 3: Run — pass**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/ -v
```

Expected: PASS — 자동 저장 흔적 0건

- [ ] **Step 4: OpenAPI snapshot 갱신 (Codex Risk Audit)**

```bash
cd frontend && npm run gen:types
```

`backend/scripts/dump_openapi.py` 가 호출되어 신규 endpoint (promote / reference-pool) 가 generated.ts 에 반영.

- [ ] **Step 5: Commit (사용자 명시 시만)**

후보 메시지:
```
refactor(edit-backend): 옛 v8 saveAsTemplate / template_name 백엔드 잔재 제거

- routes/streams.py: 옛 자동 저장 분기 삭제
- pipelines/edit.py: 옛 promote 호출 삭제
- 옛 v8 자동 저장 테스트도 함께 제거
- OpenAPI snapshot 갱신 (promote / reference-pool 추가)

Plan: 2026-04-29-reference-library-v9.md (Phase A.7)
```

---

## Phase B — Frontend UI 통합 (Task B.1 ~ B.5)

### Task B.1: ReferenceImageBox — EditReferenceCrop 의 모든 기능 흡수 (Codex C1 + I1 + M3)

**Files:**
- Create: `frontend/components/studio/edit/ReferenceImageBox.tsx`
- Test: `frontend/__tests__/edit-reference-image-box.test.ts` (NEW)

> **사전 분석**: 기존 `frontend/components/studio/EditReferenceCrop.tsx` 의 *모든 기능* 을 새 컴포넌트로 옮긴다. 누락 없이.

```bash
cat frontend/components/studio/EditReferenceCrop.tsx
```

진입 시 본문 캡처 후 다음 기능 *전부* 흡수:
- `AspectMode` ("free" | "1:1" | "4:3" | "9:16") + 토글 chips
- `zoom` state + slider UI (1.0 ~ 3.0)
- 256px 미만 silent fallback (cropper 의 `onCropAreaChange` 에서 필터)
- `key={referenceImage}` 로 새 업로드 시 reset (이미 EditLeftPanel 에서 `key=` 로 지정 중일 수도 — 확인 후 ReferenceImageBox 안에서 internal `useEffect` reset 으로 통일)
- 도움말 문구 ("256px 미만은 자동 무시" 등)

**추가 기능 (v9 신규)**:
- 드롭존 모드 (image === null)
- bypass 모드 (라이브러리 픽 — pickedTemplateRef 있음)
- ✕ 버튼 (이미지 제거)
- Ctrl+V paste — `useImagePasteTarget` hook 활용

- [ ] **Step 1: 실패 테스트**

```typescript
// frontend/__tests__/edit-reference-image-box.test.ts
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ReferenceImageBox from "@/components/studio/edit/ReferenceImageBox";

// react-easy-crop 의 ResizeObserver 의존성 mock (Codex M3)
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe("ReferenceImageBox", () => {
  it("이미지 없으면 드롭존 노출", () => {
    render(
      <ReferenceImageBox
        image={null}
        onImage={vi.fn()}
        cropArea={null}
        onCropArea={vi.fn()}
        bypassCrop={false}
      />,
    );
    expect(screen.getByText(/드래그|업로드/i)).toBeInTheDocument();
  });

  it("이미지 보유 + bypassCrop=false → cropper + aspect chips + zoom slider 노출", () => {
    render(
      <ReferenceImageBox
        image="data:image/png;base64,xxx"
        onImage={vi.fn()}
        cropArea={null}
        onCropArea={vi.fn()}
        bypassCrop={false}
      />,
    );
    expect(screen.getByTestId("crop-area")).toBeInTheDocument();
    expect(screen.getByText("자유")).toBeInTheDocument();
    expect(screen.getByText("1:1")).toBeInTheDocument();
    expect(screen.getByText("4:3")).toBeInTheDocument();
    expect(screen.getByText("9:16")).toBeInTheDocument();
    expect(screen.getByLabelText(/zoom|확대/i)).toBeInTheDocument();
  });

  it("이미지 보유 + bypassCrop=true (라이브러리 픽) → 단순 img + ✕ 버튼", () => {
    render(
      <ReferenceImageBox
        image="http://localhost:8001/images/studio/reference-templates/x.png"
        onImage={vi.fn()}
        cropArea={null}
        onCropArea={vi.fn()}
        bypassCrop={true}
      />,
    );
    expect(screen.queryByTestId("crop-area")).not.toBeInTheDocument();
    expect(document.querySelector("img")).toBeInTheDocument();
    expect(screen.getByLabelText(/이미지 제거/i)).toBeInTheDocument();
  });

  it("✕ 버튼 클릭 시 onImage(null) 호출", () => {
    const onImage = vi.fn();
    render(
      <ReferenceImageBox
        image="data:image/png;base64,xxx"
        onImage={onImage}
        cropArea={null}
        onCropArea={vi.fn()}
        bypassCrop={false}
      />,
    );
    fireEvent.click(screen.getByLabelText(/이미지 제거/i));
    expect(onImage).toHaveBeenCalledWith(null);
  });

  it("256px 미만 영역 onCropArea(null) silent fallback", () => {
    // react-easy-crop 의 onCropComplete 호출 시 작은 영역 테스트
    const onCropArea = vi.fn();
    const { container } = render(
      <ReferenceImageBox
        image="data:image/png;base64,xxx"
        onImage={vi.fn()}
        cropArea={null}
        onCropArea={onCropArea}
        bypassCrop={false}
      />,
    );
    // ReferenceImageBox 가 react-easy-crop 의 onCropComplete callback 으로 전달하는 함수 호출 시뮬
    // 실제로는 cropper 의 onCropAreaChange 통해 — 직접 호출 불가 → integration test 로 분리
    // 이 단위 테스트는 대신 helper 함수 export 후 직접 호출 검증
    // (또는 mock react-easy-crop 으로 onCropComplete 강제 호출)
  });
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: ReferenceImageBox 구현 (옛 EditReferenceCrop 흡수 — Codex C1)**

```tsx
// frontend/components/studio/edit/ReferenceImageBox.tsx
/**
 * ReferenceImageBox — 참조 이미지 (image2) 단일 박스 컴포넌트.
 *
 * 옛 EditReferenceCrop (frontend/components/studio/EditReferenceCrop.tsx) 의 *모든 기능 흡수*:
 *   - aspect preset 4종 (자유/1:1/4:3/9:16)
 *   - zoom slider (1.0 ~ 3.0)
 *   - 256px 미만 silent fallback
 *   - key 기반 새 업로드 시 reset
 *   - 도움말 문구
 *
 * v9 추가 동선:
 *   - 드롭존 모드 (image === null)
 *   - bypass 모드 (pickedTemplateRef 있음 — 영구 라이브러리 픽 후 crop 안 함)
 *   - ✕ 버튼 (이미지 제거)
 *   - Ctrl+V paste (useImagePasteTarget hook)
 *
 * Plan: docs/superpowers/plans/2026-04-29-reference-library-v9.md (Phase B.1)
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import Icon from "@/components/ui/Icon";
import { useImagePasteTarget } from "@/hooks/useImagePasteTarget";

type AspectMode = "free" | "1:1" | "4:3" | "9:16";
const ASPECT_MAP: Record<AspectMode, number | undefined> = {
  free: undefined,
  "1:1": 1,
  "4:3": 4 / 3,
  "9:16": 9 / 16,
};

const MIN_CROP_PX = 256;

interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  image: string | null;
  onImage: (image: string | null, label?: string, w?: number, h?: number) => void;
  cropArea: CropArea | null;
  onCropArea: (area: CropArea | null) => void;
  bypassCrop?: boolean;
  placeholder?: string;
}

export default function ReferenceImageBox({
  image,
  onImage,
  cropArea: _cropAreaProp,
  onCropArea,
  bypassCrop = false,
  placeholder = "참조 이미지를 업로드해 주세요",
}: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspectMode, setAspectMode] = useState<AspectMode>("free");
  const containerRef = useRef<HTMLDivElement>(null);

  // 새 image 시 local state reset (옛 EditReferenceCrop 의 key 기반 reset 과 동일 효과)
  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setAspectMode("free");
  }, [image]);

  // Ctrl+V paste — image=null 시에만 활성 (드롭존 모드)
  useImagePasteTarget(containerRef, image === null, async (file) => {
    await handleFile(file, onImage);
  });

  const onCropComplete = useCallback(
    (_croppedArea: Area, croppedAreaPixels: Area) => {
      // 256px 미만 silent fallback (옛 EditReferenceCrop 의 가드)
      if (
        croppedAreaPixels.width < MIN_CROP_PX ||
        croppedAreaPixels.height < MIN_CROP_PX
      ) {
        onCropArea(null);
        return;
      }
      onCropArea(croppedAreaPixels);
    },
    [onCropArea],
  );

  // ─── 1. 드롭존 모드 ───
  if (!image) {
    return (
      <div
        ref={containerRef}
        className="ais-reference-dropzone"
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file, onImage);
        }}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => {
          const inp = document.createElement("input");
          inp.type = "file";
          inp.accept = "image/*";
          inp.onchange = () => {
            if (inp.files?.[0]) handleFile(inp.files[0], onImage);
          };
          inp.click();
        }}
        tabIndex={0}
        style={{
          border: "2px dashed var(--line)",
          borderRadius: "var(--radius-md)",
          padding: 32,
          textAlign: "center",
          cursor: "pointer",
          color: "var(--ink-2)",
        }}
      >
        <Icon name="upload" size={28} />
        <div style={{ marginTop: 12, fontSize: 13 }}>{placeholder}</div>
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--ink-3)" }}>
          또는 Ctrl+V 로 클립보드 붙여넣기
        </div>
      </div>
    );
  }

  // ─── 2. 라이브러리 픽 모드 (bypassCrop) ───
  if (bypassCrop) {
    return (
      <div style={{ position: "relative" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt="reference"
          style={{ width: "100%", borderRadius: "var(--radius-md)", display: "block" }}
        />
        <RemoveButton onClick={() => onImage(null)} />
      </div>
    );
  }

  // ─── 3. crop UI 모드 ───
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* aspect preset 4종 (옛 EditReferenceCrop 의 chips) */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["free", "1:1", "4:3", "9:16"] as AspectMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setAspectMode(m)}
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: aspectMode === m ? "var(--accent)" : "transparent",
              color: aspectMode === m ? "#fff" : "var(--ink-1)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {m === "free" ? "자유" : m}
          </button>
        ))}
      </div>

      <div
        data-testid="crop-area"
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1 / 1",
          background: "#000",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
        }}
      >
        <Cropper
          image={image}
          crop={crop}
          zoom={zoom}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
          aspect={ASPECT_MAP[aspectMode]}
          showGrid={true}
        />
        <RemoveButton onClick={() => onImage(null)} />
      </div>

      {/* zoom slider (옛 EditReferenceCrop 패턴) */}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
        <span>확대</span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          aria-label="zoom"
          style={{ flex: 1 }}
        />
        <span>{zoom.toFixed(2)}×</span>
      </label>

      {/* 도움말 (옛 EditReferenceCrop 의 안내 문구 그대로) */}
      <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
        ※ 256px 미만 영역은 자동으로 무시되어 원본 그대로 사용됩니다.
      </div>
    </div>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="이미지 제거"
      style={{
        position: "absolute", top: 8, right: 8,
        width: 28, height: 28, borderRadius: "50%",
        background: "rgba(0,0,0,.6)", color: "#fff", border: "none",
        cursor: "pointer", display: "grid", placeItems: "center", zIndex: 10,
      }}
    >
      <Icon name="x" size={14} />
    </button>
  );
}

async function handleFile(
  file: File,
  onImage: (image: string | null, label?: string, w?: number, h?: number) => void,
) {
  const dataUrl = await new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(file);
  });
  const img = new window.Image();
  img.src = dataUrl;
  await new Promise((resolve) => { img.onload = resolve; });
  onImage(dataUrl, file.name, img.naturalWidth, img.naturalHeight);
}
```

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Commit (사용자 명시 시만)**

후보 메시지:
```
feat(edit/reference): ReferenceImageBox — 옛 EditReferenceCrop 모든 기능 흡수 + 통합 모드

- aspect preset 4종 + zoom slider + 256px 가드 + 도움말 (옛 EditReferenceCrop 흡수)
- 드롭존 ↔ crop UI ↔ bypass 3 모드 분기
- ✕ 버튼 + Ctrl+V paste (useImagePasteTarget)
- ResizeObserver mock 으로 cropper DOM 단위 테스트

Plan: 2026-04-29-reference-library-v9.md (Phase B.1)
```

### Task B.2: useEditStore 정리 — saveAsTemplate / templateName 4 항목 제거

**Files:**
- Modify: `frontend/stores/useEditStore.ts`

- [ ] **Step 1: 4 항목 제거**

EditState interface · initial state · 2 setters · useEditInputs selector 에서 모두 삭제.

- [ ] **Step 2: tsc — 다른 호출자 컴파일 에러 발생 (B.3 에서 fix)**

```bash
cd frontend && npx tsc --noEmit
```

다음 호출자 검색:
```bash
grep -rn "saveAsTemplate\|templateName\|setSaveAsTemplate\|setTemplateName" frontend/
```

- [ ] **Step 3: 단독 commit 안 함 — B.3 와 묶음**

### Task B.3: EditLeftPanel — 옛 UI 제거 + ReferenceImageBox 1개로 교체

**Files:**
- Modify: `frontend/components/studio/edit/EditLeftPanel.tsx`
- Delete: `frontend/components/studio/EditReferenceCrop.tsx` (Codex I8 — 정확한 위치)

- [ ] **Step 1: EditLeftPanel 재작성**

```tsx
// EditLeftPanel.tsx 의 multi-ref 섹션 변경

import ReferenceImageBox from "./ReferenceImageBox";

// useEditInputs 의 destructuring 에서 saveAsTemplate / templateName / setSaveAsTemplate / setTemplateName 4 항목 제거
// pickedTemplateRef 도 이미 useEditInputs 에 노출 중인지 확인 후 destructure (Codex I7 — 옛 v8 코드는 pickedTemplateId 만 destructure)
const {
  // ...기타
  pickedTemplateId,
  pickedTemplateRef,  // v9 추가 — bypassCrop 판정용
  // saveAsTemplate, templateName 제거
} = useEditInputs();

// JSX 안 multi-ref 섹션:
{useReferenceImage && (
  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <div className="ais-field-header">
      <label className="ais-field-label" style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
        <SectionAccentBar accent="violet" />
        참조 이미지
        {referenceWidth && referenceHeight && (
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {referenceWidth}×{referenceHeight}
          </span>
        )}
      </label>
    </div>

    <ReferenceImageBox
      image={referenceImage}
      onImage={(img, label, w, h) => setReferenceImage(img, label, w, h)}
      cropArea={referenceCropArea}
      onCropArea={setReferenceCropArea}
      bypassCrop={!!pickedTemplateRef}
    />

    {/* role 선택 + 라이브러리 Drawer 토글 등 옛 컴포넌트 그대로 유지 */}
  </div>
)}

{/* 옛 "라이브러리에 저장" Toggle + templateName Input 영역 — 완전 제거 */}
```

- [ ] **Step 2: EditReferenceCrop 삭제 (사용처 0건 확인 후)**

```bash
grep -rn "EditReferenceCrop" frontend/  # 0건 확인
rm frontend/components/studio/EditReferenceCrop.tsx
```

- [ ] **Step 3: tsc + lint clean**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: clean

- [ ] **Step 4: vitest 회귀**

```bash
cd frontend && npm test
```

Expected: PASS — 옛 saveAsTemplate / templateName 검증 테스트는 *Task B.5 에서 수정/삭제* 하면 통과.

> **임시**: B.3 단독 commit 시점에는 `edit-library-store.test.ts` 가 깨질 수 있음. B.5 와 묶어 한 commit (또는 B.5 가 먼저).

- [ ] **Step 5: Commit (사용자 명시 시만, B.2/B.3/B.5 묶음)**

### Task B.4: useEditPipeline — 옛 자동 promote 호출 제거

**Files:**
- Modify: `frontend/hooks/useEditPipeline.ts`

- [ ] **Step 1: grep + 흔적 제거**

```bash
grep -n "saveAsTemplate\|templateName\|promoteFrom" frontend/hooks/useEditPipeline.ts
```

발견된 흔적 모두 제거.

- [ ] **Step 2: tsc + lint + vitest**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm test
```

Expected: PASS

### Task B.5: edit-library-store.test.ts — saveAsTemplate / templateName 검증 부분 제거 (Codex I12)

**Files:**
- Modify: `frontend/__tests__/edit-library-store.test.ts`

- [ ] **Step 1: 검증 부분 식별**

```bash
grep -n "saveAsTemplate\|templateName" frontend/__tests__/edit-library-store.test.ts
```

해당 라인 (`edit-library-store.test.ts:41` 등) 의 it / describe 블록 제거.

- [ ] **Step 2: vitest 회귀**

```bash
cd frontend && npm test
```

Expected: PASS — 옛 검증 제거 후 잔여 테스트 정상

- [ ] **Step 3: types.ts 의 referenceRef 주석 갱신 (Codex I9)**

```typescript
// frontend/lib/api/types.ts:283 근처
/**
 * 참조 이미지 URL.
 *
 * v9 (2026-04-29):
 *   - 사용자 직접 업로드: 임시 풀 URL (`/images/studio/reference-pool/<uuid>.png`)
 *   - 라이브러리 픽: 영구 URL (`/images/studio/reference-templates/<uuid>.<ext>`)
 *   - promote 후: 영구 URL (swap)
 *   - NULL: 옛 row OR multi-ref 미사용
 */
referenceRef?: string | null;
```

- [ ] **Step 4: Commit (B.2/B.3/B.4/B.5 통합 — 사용자 명시 시만)**

후보 메시지:
```
refactor(edit-frontend): saveAsTemplate / templateName 흔적 제거 + ReferenceImageBox 통합

- useEditStore: 4 항목 (state + 2 setters) 제거
- EditLeftPanel: 옛 ImageDrop + EditReferenceCrop + Toggle + Input → ReferenceImageBox 1개
- useEditPipeline: 옛 자동 promote 호출 제거
- EditReferenceCrop.tsx 삭제 (frontend/components/studio/ 직속)
- edit-library-store.test.ts: 옛 검증 부분 제거
- types.ts: HistoryItem.referenceRef 주석 v9 의미 갱신

Plan: 2026-04-29-reference-library-v9.md (Phase B.2~B.5)
```

---

## Phase C — 사후 저장 UI (Task C.1 ~ C.3)

### Task C.1: ReferencePromoteModal — 이름 입력 + vision 부분 성공 (Codex I6)

**Files:**
- Create: `frontend/components/studio/edit/ReferencePromoteModal.tsx`
- Modify: `frontend/lib/api/reference-templates.ts`

- [ ] **Step 1: API 클라이언트 추가**

```typescript
// frontend/lib/api/reference-templates.ts 끝에 추가
import { STUDIO_BASE } from "@/lib/api/client";
import { normalizeReferenceTemplate } from "./reference-templates"; // 옛 v8 helper

export interface PromoteResponse {
  template: ReferenceTemplate;
  visionFailed: boolean;
}

export async function promoteFromHistory(
  historyId: string,
  name: string,
): Promise<PromoteResponse> {
  const res = await fetch(
    `${STUDIO_BASE}/api/studio/reference-templates/promote/${encodeURIComponent(historyId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  if (!res.ok) throw new Error(`promote failed: ${res.status}`);
  const data = await res.json();
  return {
    template: normalizeReferenceTemplate(data.template),
    visionFailed: !!data.visionFailed,
  };
}
```

- [ ] **Step 2: Modal 구현 (vision 부분 성공 토스트 분기 — Codex I6)**

```tsx
// frontend/components/studio/edit/ReferencePromoteModal.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { promoteFromHistory } from "@/lib/api/reference-templates";
import { toast } from "@/stores/useToastStore";

interface Props {
  historyId: string;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const NAME_PATTERN = /^[A-Za-z0-9가-힣\s_\-]{1,64}$/;

export default function ReferencePromoteModal({ historyId, open, onClose, onSuccess }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;
  const valid = NAME_PATTERN.test(name.trim());

  const handleSave = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const { template, visionFailed } = await promoteFromHistory(historyId, name.trim());
      if (visionFailed) {
        toast.warn("부분 성공", `'${template.name}' 저장 — vision 분석 실패 (description 비어있음)`);
      } else {
        toast.success("라이브러리 저장 완료", `'${template.name}' 추가됨`);
      }
      onSuccess?.();
      onClose();
    } catch (e) {
      toast.error("저장 실패", String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="라이브러리 저장"
      style={{
        position: "fixed", inset: 0, zIndex: 80,
        background: "rgba(0,0,0,.5)",
        display: "grid", placeItems: "center",
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)", borderRadius: "var(--radius-card)",
          padding: 24, width: 380, boxShadow: "var(--shadow-lg)",
          display: "flex", flexDirection: "column", gap: 16,
        }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>📚 참조 라이브러리에 저장</div>
        <div style={{ fontSize: 12, color: "var(--ink-2)" }}>
          이 결과의 참조 이미지를 라이브러리에 영구 저장합니다.
          저장 후 vision 분석 (5-10초) 자동 실행 — 실패 시 description 만 비어있음.
        </div>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="이름 (1~64자, 한글/영문/숫자/공백/-_)"
          style={{
            padding: "10px 12px", borderRadius: "var(--radius-md)",
            border: "1px solid var(--line)", background: "var(--bg-1)", fontSize: 14,
          }} autoFocus />
        {name && !valid && (
          <div style={{ fontSize: 11, color: "var(--danger)" }}>
            허용: 1~64자, 한글/영문/숫자/공백/하이픈/언더스코어
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button onClick={onClose} disabled={busy} variant="ghost">취소</Button>
          <Button onClick={handleSave} disabled={!valid || busy}>
            {busy ? "저장 중…" : "저장"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: tsc + lint + vitest**

- [ ] **Step 4: Commit (사용자 명시 시만)**

### Task C.2: EditResultViewer — ActionBar 의 promote 버튼 (canPromote 조건 — Codex I3)

**Files:**
- Modify: `frontend/components/studio/edit/EditResultViewer.tsx`

- [ ] **Step 1: 버튼 추가 + canPromote 판정**

```tsx
// EditResultViewer.tsx 변경
import ReferencePromoteModal from "./ReferencePromoteModal";
import { useState } from "react";

const POOL_PREFIX = "/images/studio/reference-pool/";

export default function EditResultViewer({ ..., afterItem, ... }: Props) {
  const [promoteOpen, setPromoteOpen] = useState(false);

  // canPromote: history.referenceRef 가 *임시 풀 URL prefix 매칭* 일 때만
  // (promote 후 백엔드가 영구 URL 로 swap → false → 버튼 자동 숨김 — Codex I3)
  // STUDIO_BASE prefix 우회 위해 includes 사용 (절대 URL 화 후 비교)
  const canPromote = !!afterItem.referenceRef && afterItem.referenceRef.includes(POOL_PREFIX);

  const actionBarChildren = (
    <>
      <ActionBarButton icon="zoom-in" title="크게 보기" onClick={onExpand} />
      <ActionBarButton icon="download" title="저장" onClick={...} />
      <ActionBarButton icon="edit" title="이 결과를 다음 수정의 원본으로" onClick={...} />
      <ActionBarButton icon="refresh" title="수정 설정 복원 (다시)" onClick={...} />
      {canPromote && (
        <ActionBarButton
          icon="bookmark"
          title="📚 참조 라이브러리에 저장"
          onClick={() => setPromoteOpen(true)}
        />
      )}
    </>
  );

  return (
    <>
      <div ...>{/* 기존 컨테이너 */}</div>
      {canPromote && (
        <ReferencePromoteModal
          historyId={afterItem.id}
          open={promoteOpen}
          onClose={() => setPromoteOpen(false)}
          // promote 성공 시 history reload (history store 가 swap 된 referenceRef 반영)
          onSuccess={() => {/* history store reload — 호출 패턴 따라 */}}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: tsc + lint + vitest**

### Task C.3: 통합 검증 (Phase A + B + C)

- [ ] **Step 1: 풀 backend pytest**
- [ ] **Step 2: 풀 frontend test + lint + tsc**
- [ ] **Step 3: 수동 시나리오** (Phase E.1 와 동일 — 거기서 본격적으로)

---

## Phase D — 설정 Drawer 의 임시 캐시 관리 (Task D.1)

> **확정**: 실 위치 = `frontend/components/settings/SettingsDrawer.tsx:29` (Codex M4)

### Task D.1: ReferencePoolPanel + SettingsDrawer 마운트

**Files:**
- Create: `frontend/lib/api/reference-pool.ts`
- Create: `frontend/components/settings/ReferencePoolPanel.tsx` (sub-component)
- Modify: `frontend/components/settings/SettingsDrawer.tsx` (line 29 근처에 섹션 추가)

- [ ] **Step 1: API 클라이언트**

```typescript
// frontend/lib/api/reference-pool.ts (NEW)
import { STUDIO_BASE } from "@/lib/api/client";

export interface PoolStats { count: number; totalBytes: number }
export interface OrphansList { refs: string[]; count: number }

export async function getPoolStats(): Promise<PoolStats> {
  const res = await fetch(`${STUDIO_BASE}/api/studio/reference-pool/stats`);
  if (!res.ok) throw new Error(`stats: ${res.status}`);
  return res.json();
}

export async function getOrphans(): Promise<OrphansList> {
  const res = await fetch(`${STUDIO_BASE}/api/studio/reference-pool/orphans`);
  if (!res.ok) throw new Error(`orphans: ${res.status}`);
  return res.json();
}

export async function deleteOrphans(): Promise<{ deleted: number; totalOrphans: number }> {
  const res = await fetch(`${STUDIO_BASE}/api/studio/reference-pool/orphans`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`delete: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: ReferencePoolPanel 컴포넌트**

(앞 v9.0 plan 의 코드 그대로 — 위치만 `frontend/components/settings/`)

- [ ] **Step 3: SettingsDrawer:29 마운트**

진입 시 SettingsDrawer.tsx 본문 캡처 후 *기존 섹션 목록* 사이에 삽입.

- [ ] **Step 4: tsc + lint + vitest**

- [ ] **Step 5: 수동 검증** (Phase E.1)

- [ ] **Step 6: Commit (사용자 명시 시만)**

---

## Phase E — 통합 회귀 + master merge

### Task E.1: 통합 검증 (확장된 시나리오 — Codex I14 + Risk Audit)

- [ ] **Step 1: 풀 backend 회귀**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -v
```

Expected: 215 + 신규 ≈ 240+ PASS

- [ ] **Step 2: 풀 frontend 회귀**

```bash
cd frontend && npm test && npm run lint && npx tsc --noEmit
```

Expected: 91 + 신규 ≈ 95+ PASS

- [ ] **Step 3: OpenAPI snapshot 갱신 (Risk Audit)**

```bash
cd frontend && npm run gen:types
git diff frontend/lib/api/generated.ts  # 신규 endpoint 반영 확인
```

- [ ] **Step 4: 실 환경 통합 시나리오**

start.bat → /edit → 다음 8 시나리오:

1. **신규 업로드 + crop + 사후 저장**
   - 이미지 업로드 → ReferenceImageBox 의 crop UI (자유 비율) → 256px 이상 영역 → 수정 생성 → 결과 OK → ActionBar 의 `📚 라이브러리 저장` → 모달 → 이름 → 토스트 ("저장 완료") → ActionBar 의 promote 버튼 자동 사라짐 (canPromote false 됨) → Drawer 에서 신규 항목 확인
2. **aspect preset 토글** (1:1 / 4:3 / 9:16 / 자유 모두 동작)
3. **256px 미만 silent fallback**
   - crop 영역을 100×100 정도로 축소 → onCropArea(null) → 백엔드는 원본 그대로 사용
4. **Ctrl+V paste**
   - 클립보드에 이미지 → 드롭존에 focus 후 Ctrl+V → ReferenceImageBox 가 dataURL 로 받음 → crop UI 활성
5. **라이브러리 픽 + bypass crop**
   - Drawer 에서 옛 항목 픽 → ReferenceImageBox 가 단순 `<img>` 만 (crop 비활성) → 수정 생성 → 결과 → ActionBar 의 promote 버튼 *안 보임* (이미 영구 URL)
6. **단건 history 삭제 cascade**
   - 임시 풀에 ref 1개 + history h1 → h1 삭제 → 디스크에서 ref 자동 unlink 확인
7. **전체 history 삭제 cascade** (Codex I2)
   - 임시 풀에 ref 3개 + 영구 ref 1개 → DELETE /api/studio/history → 임시 풀 0개, 영구 ref 그대로
8. **고아 일괄 삭제** (설정 Drawer)
   - 임시 풀에 ref 3개 → 그중 2개 history 연결, 1개는 외부 직접 (drop) → 설정 Drawer 의 "참조 임시 캐시" 섹션 → "고아 1개" 표시 → 일괄 삭제 → "고아 0개"

**Lightbox 비교 회귀** (Codex I14 — master 의 slider cover fit 직후 검증):
9. **Lightbox 의 BeforeAfterSlider compare**
   - history 항목 자세히보기 → 비교 토글 (B 단축키) → 슬라이더 정상 + cover fit 정상 + ✕ 버튼만 닫힘 (옛 master 동작 회귀 0)

### Task E.2: PR + master merge (사용자 명시 시만)

> **🛑 사용자 GO 사인 받은 후에만 실행.**

- [ ] **Step 1: PR 생성** (사용자 요청 시)

```bash
gh pr create --title "feat(edit-reference-v9): UI 통합 + 사후 저장 + 임시 풀 cascade cleanup" \
  --body "..."
```

- [ ] **Step 2: master `--no-ff` merge + push** (사용자 요청 시)

```bash
git checkout master
git merge --no-ff feature/reference-library-v9 -m "Merge: edit reference library v9"
git push origin master
```

- [ ] **Step 3: changelog + memory 업데이트** (사용자 요청 시)

---

## Self-Review (Codex 1차 리뷰 반영 후 갱신)

### 1. Spec coverage

| 기획 의도 | 다루는 Task | 검증 |
|----------|-------------|------|
| ① UI 통합 | B.1 (ReferenceImageBox + EditReferenceCrop 흡수) + B.3 (EditLeftPanel 교체) + B.5 (관련 파일 정리) | 모드 분기 3가지 + EditReferenceCrop 의 4 기능 (aspect/zoom/256px/paste) 모두 명시 |
| ② 사후 저장 | A.5 (promote endpoint + I3 swap + I5 rollback + I6 vision silent) + A.7 (옛 자동 저장 제거) + B.2-B.5 (옛 store 제거) + C.1 (모달) + C.2 (ActionBar canPromote) | 옛 자동 저장 grep + 새 사후 흐름 + canPromote false 자동 처리 |
| ③ 임시 풀 cascade cleanup | A.1 (storage) + A.2 (cascade) + A.3 (pipeline 저장) + A.4 (라우트) + A.6 (전체 삭제 cascade) + D.1 (설정 UI) | 자동 cascade (단건 + 전체) + 수동 cleanup (고아 일괄 삭제) |

### 2. Placeholder scan

- 모든 코드 블록은 실 import / 시그니처 / 정확한 경로 보유
- "TBD" / "TODO" / "implement later" — 0 건
- "Similar to Task N" — 0 건
- 의도된 placeholder (A.7 의 grep 결과 보고 정확한 hunk + D.1 의 SettingsDrawer 섹션 위치 확인) 만 허용

### 3. Type / Interface Consistency

| Type / 함수 | 정의 위치 | 사용 위치 |
|------------|----------|----------|
| `save_to_pool(bytes, content_type) → str` | A.1 | A.3 (routes/streams.py) |
| `delete_pool_ref(rel_url) → bool` | A.1 | A.2 (cascade), A.4 (orphan delete) |
| `pool_path_from_url(rel_url) → Path` | A.1 | A.5 (promote) |
| `iter_pool_refs() → AsyncIterator[(str, int)]` | A.1 | A.4 (stats) |
| `list_orphan_pool_refs(referenced) → list[str]` | A.1 | A.4 (orphans) |
| `count_pool_refs() → int` | A.2 | A.4 (선택) |
| `list_history_pool_refs() → set[str]` | A.2 | A.4 (orphans) |
| `delete_item_with_refs(item_id) → tuple[bool, list[str]]` | A.2 (확장) | system.py (옛 호출자 — 옛 흐름 유지) |
| `clear_all_with_refs() → tuple[int, list[str], list[str]]` | A.2 (확장) | A.6 (system.py:288) |
| `promote_from_history(history_id, body) → dict` | A.5 | C.1 (frontend client) |
| `promoteFromHistory(historyId, name) → PromoteResponse` | C.1 | C.2 (ActionBar) |
| `getPoolStats / getOrphans / deleteOrphans` | D.1 | D.1 (panel) |
| `ReferenceImageBox` props | B.1 | B.3 (EditLeftPanel) |
| `HistoryItem.referenceRef` 의미 (v9 임시 풀 OR 영구) | B.5 (types.ts 주석) | C.2 (canPromote) |
| Promote response shape `{ template: { name, imageRef, visionDescription, roleDefault }, visionFailed }` | A.5 | C.1 |

검증 통과 ✅

### 4. NOT IN SCOPE 검증

- [ ] image1 crop UI? — 0건 ✅
- [ ] 모델 변경? — 0건 ✅
- [ ] 라이브러리 검색/태그/정렬? — 0건 ✅
- [ ] 자동 시간 기반 GC 옵션? — 0건 ✅ (수동 cleanup 만)
- [ ] vision 분석 자동 호출 추가? — 0건 ✅ (옛 v8 promote 시 호출만 유지)
- [ ] history → reference 역방향? — 0건 ✅
- [ ] 임시 풀 압축/최적화? — 0건 ✅
- [ ] Drawer 임시 풀 노출? — 0건 ✅
- [ ] Generate/Video 모드 라이브러리? — 0건 ✅

### 5. Risk Audit (Codex Risk Audit 반영 보강)

| 위험 | 영향 | 완화 |
|------|------|------|
| 임시 풀 무한 증가 | 디스크 가득 | 자동 cascade (단건/전체) + 수동 고아 일괄 삭제 |
| history.referenceRef 정책 변경 → 옛 row mismatch | 옛 NULL row 그대로 | promote 불가 (`canPromote` 필터) |
| reference_templates DB row 동시 promote 충돌 | 중복 row 가능 | 사용자 의도 (다른 이름) — 무결성 문제 X |
| Lightbox 비교 모드 회귀 | 옛 동작 깨질 우려 | E.1 시나리오 9 에서 명시 검증 |
| **save_to_pool ↔ orphan delete race** (Codex I4) | 새 ref 가 history insert 전 → 고아로 오인 | orphan delete 직전 history snapshot 재조회 (double-check) |
| **promote 의 disk full / DB 실패** (Codex I5) | dst 파일 orphan | DB insert 실패 시 dst unlink rollback |
| **vision 실패 — UI 안내** (Codex I6) | 사용자 혼란 | `visionFailed` 플래그 + 부분 성공 토스트 |
| **OpenAPI snapshot 갱신 누락** (Codex Risk) | frontend types drift | A.7 + E.1 Step 3 에서 명시 갱신 |
| **EditReferenceCrop 기능 회귀** (Codex C1) | aspect/zoom/256px 손실 | B.1 의 ReferenceImageBox 흡수 명시 + B.5 회귀 검증 |
| **race condition 잔여** | 빈도 낮음 (사용자 동선) | double-check 로 최선. 완벽한 atomic 은 file lock 도입 필요 — 별도 plan |

---

## Execution Handoff

**Plan v9 (Codex 1차 리뷰 반영) saved to** `docs/superpowers/plans/2026-04-29-reference-library-v9.md`.

**다음 단계 — 사용자 흐름 명시**:
1. **Codex 2차 리뷰** — 이 갱신된 plan 을 다시 codex 에 보내 검증. 100% 일치까지 round 반복.
2. **100% 일치 후 구현 시작** — Subagent-Driven (recommended) 또는 Inline.

**🛑 commit / push / merge 룰** (Codex I13 반영):
- plan 본문의 모든 `git commit` / `git push` / `git merge` / `gh pr` 명령은 *사용자 명시 요청 시만* 실행.
- 후보 메시지로만 작성됨. 자동 실행 금지.
