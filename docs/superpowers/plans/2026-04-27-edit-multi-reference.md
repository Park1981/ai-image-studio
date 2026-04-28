# Edit Multi-Reference Image Implementation Plan

> **🚨 For agentic workers (REQUIRED · 2026-04-28 보강):**
> 이 plan 은 19 task / ~190 step 규모라 main 세션 컨텍스트로 들고가면 안 됨.
> **superpowers:subagent-driven-development 스킬 *강제*** — 각 task 단위로 sub-session 분리.
> 단순 `executing-plans` 는 step 단위 체크포인트라 컨텍스트 폭발 위험 → 비권장.

**Goal:** Edit 모드에 토글 기반 두번째 참조 이미지 (image2) 입력 + role 명시 기능 추가. 기본 OFF 상태에서는 옛 단일 이미지 흐름 100% 보존, ON 시에만 multi-reference 코드 path 활성.

**Architecture:** Feature flag (toggle) 패턴으로 옛 코드 path early-return 분기. `backend/studio/comfy_api_builder.py` 의 `EditApiInput`/builder, routes/streams, pipelines/edit, prompt_pipeline, history_db 모두 optional 파라미터 추가. frontend useEditStore + EditLeftPanel 에 토글 + 조건부 두번째 SourceImageCard + role chip selector. Phase 단계 분리 (각 phase 끝에 검증, commit 은 사용자 승인 후만) 으로 회귀 위험 0 유지.

**Tech Stack:** FastAPI · Python 3.13 · ComfyUI Qwen Image Edit 2511 (TextEncodeQwenImageEditPlus 의 image1/image2 multi-ref 슬롯) · aiosqlite · Next.js 16 · React 19 · Zustand 5

---

## 🚦 Merge 단위 정책 (2026-04-28 보강 — Phase 1-4 의 dead-code 위험 방지)

> ⚠️ **Phase 1-4 는 *한 PR / 한 master merge 단위*** — 중간 phase 만 떼서 master merge 금지.
>
> **이유:** Phase 1-3 까지는 `_build_edit_api_multi_ref` 가 stub (single 로 폴백) 이고, frontend 토글이 dispatch 되지 않음. 이 상태로 master 머지하면 *호출되지 않는 dead code* 가 누적됨. Phase 4 의 진짜 노드 체인까지 완성된 시점에야 사용자가 multi-ref 결과를 *볼 수 있음* — 그 전에 머지해도 의미 0.
>
> **권장 흐름:**
> ```
> claude/edit-multi-ref 브랜치 생성
>    → Phase 1 → 회귀 215 검증 → 브랜치 commit only (no master merge)
>    → Phase 2 → 회귀 215 검증 → 브랜치 commit only
>    → Phase 3 → 회귀 215 검증 → 브랜치 commit only
>    → Phase 4 → 회귀 215 검증 + 사용자 multi-ref 동작 확인
>    → Phase 5 → 통합 검증 + 문서화
>    → 사용자 명시 승인 → master merge (Phase 1-5 한번에)
> ```
>
> Phase 5 의 통합 검증 통과 + 사용자가 *진짜 ON 토글로 결과 확인* 후에만 master merge 진행.

---

## Scope Check

이 플랜은 단일 서브시스템 (`/edit` 페이지) 만 다룸. 다른 모드 (Generate/Video/Vision/Compare) 영향 0.

## File Structure

### Backend (모두 modify)

- `backend/studio/comfy_api_builder.py` — `EditApiInput` dataclass 에 reference_image_filename / reference_role 필드 추가 + `build_edit_api` 분기 (early return 옛 path · 새 path 는 image2 LoadImage + FluxKontextImageScale + image2 슬롯 연결)
- `backend/studio/routes/streams.py` — `create_edit_task` multipart 에 reference_image 파일 + meta 의 use_reference_image / reference_role 받기
- `backend/studio/pipelines/edit.py` — `_run_edit_pipeline` 시그니처 확장 + dispatch 흐름에 reference 파라미터 전달
- `backend/studio/prompt_pipeline.py` — SYSTEM_EDIT 동적 분기 + `ROLE_INSTRUCTIONS` 매핑 신규 + `upgrade_edit_prompt` 시그니처 확장
- `backend/studio/vision_pipeline.py` — `run_vision_pipeline` 시그니처에 reference_role 파라미터 (image2 자체는 비전 분석 안 함, 사용자 명시 role 만 upgrade 단계에 전달)
- `backend/studio/history_db.py` — schema v6→v7. `reference_ref` + `reference_role` 컬럼 추가 + `_row_to_item` 매핑 + insert 처리

### Frontend (modify + 1 new)

- `frontend/stores/useEditStore.ts` — useReferenceImage(boolean) / referenceImage(string|null) / referenceLabel(string) / referenceWidth(number|null) / referenceHeight(number|null) / referenceRole(RoleId) / referenceRoleCustom(string) 추가
- `frontend/components/studio/SourceImageCard.tsx` — `pasteRequireHover` prop 추가 (multi-ref ON 시 paste 충돌 방지)
- `frontend/components/studio/edit/EditLeftPanel.tsx` — 토글 + 조건부 두번째 SourceImageCard + ReferenceRoleSelect
- `frontend/components/studio/edit/ReferenceRoleSelect.tsx` — **NEW**. preset chip 5개 (얼굴/의상/스타일/배경/직접) + 직접 선택 시 텍스트 입력
- `frontend/hooks/useEditPipeline.ts` — multipart 에 reference 파일 + meta 추가
- `frontend/lib/api/edit.ts` — `editImageStream` multipart 변경
- `frontend/lib/api/types.ts` — EditRequest 확장 + RoleId 타입 + HistoryItem 의 referenceRef/referenceRole 추가
- `frontend/lib/api/client.ts` — `normalizeItem()` 에 referenceRef 절대 URL 정규화 추가
- `frontend/lib/api/openapi.json` + `frontend/lib/api/generated.ts` — `npm run gen:types` 자동 갱신

### Tests

- `backend/tests/studio/test_multi_ref_edit.py` — **NEW** Multi-ref 케이스 단위 테스트
- `backend/tests/studio/test_dispatch_extra_uploads.py` — **NEW** `_dispatch_to_comfy.extra_uploads` 회귀 테스트
- `backend/tests/_snapshots/openapi.json` — OpenAPI 스냅샷 갱신
- `frontend/__tests__/source-image-card-paste.test.ts` — **NEW** SourceImageCard paste hover prop 테스트
- `frontend/__tests__/edit-multi-ref.test.ts` — **NEW** Frontend store + multipart 단위 테스트

---

## Phase 1: Backend 토글 기반 + DB 스키마 (회귀 위험 0)

목표: backend 가 image2 optional 파라미터 받지만 OFF 일 때 옛 코드 path 100% 동일 유지. pytest 215 회귀 0 검증.

### Task 1: EditApiInput 에 reference 필드 추가

**Files:**
- Modify: `backend/studio/comfy_api_builder.py:395-414` (확정 위치 — `@dataclass class EditApiInput`)

> ⚠️ **Codex 2차 리뷰 fix #1:** 이전 plan 은 `presets.py` 라고 적혀있었지만 실제 `EditApiInput` 은 `comfy_api_builder.py:396` 에 정의돼 있음. `presets.py` 에는 없음.

- [ ] **Step 1: 변경 전 baseline 검증**

Run: `cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `215 passed`

- [ ] **Step 2: EditApiInput 에 옵셔널 필드 추가**

`backend/studio/comfy_api_builder.py` 의 `class EditApiInput` (line 396) dataclass 에 다음 두 필드 추가 (기존 `filename_prefix` 직전 위치):

```python
    extra_loras: list[LoraEntry]
    lightning_lora_name: str | None = None
    # Multi-reference (2026-04-27): image2 추가 입력 — 토글 OFF 면 None.
    # ON 시 ComfyUI input/ 에 업로드된 두번째 파일명 + role 명시.
    reference_image_filename: str | None = None
    reference_role: str | None = None
    filename_prefix: str = "AIS-Edit"
```

- [ ] **Step 3: 검증 — pytest 그대로 통과**

Run: `cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `215 passed` (옛 코드 모두 None 으로 채워져 영향 0)

- [ ] **Step 4: Commit (사용자 승인 후만)**

> ⚠️ **AGENTS 규칙 (Codex 2차 리뷰 fix #9):** commit / merge / push 는 사용자가 명시적으로 요청한 경우에만 수행. 아래 명령어는 *예시* — 자동 실행 X.

```bash
# 사용자 "커밋해" 명시 후에만:
git add backend/studio/comfy_api_builder.py
git commit -m "feat(edit): EditApiInput 에 reference_image_filename / reference_role 옵셔널 필드"
```

### Task 2: build_edit_api early-return 분기

**Files:**
- Modify: `backend/studio/comfy_api_builder.py:417-535` (`build_edit_api` 함수)

- [ ] **Step 1: build_edit_api 의 진입부에 early return 추가**

`backend/studio/comfy_api_builder.py:417` 의 함수 시작 직후:

```python
def build_edit_api(v: EditApiInput) -> ApiPrompt:
    """Edit 워크플로우 API 포맷 조립 (Qwen Image Edit 2511)."""
    # Multi-ref 분기 (2026-04-27): reference 미사용이면 옛 단일 이미지 path 그대로.
    # reference_image_filename 이 None 이면 옛 코드와 100% 동일한 결과 반환 → 회귀 위험 0.
    if v.reference_image_filename is None:
        return _build_edit_api_single(v)
    return _build_edit_api_multi_ref(v)


def _build_edit_api_single(v: EditApiInput) -> ApiPrompt:
    """옛 단일 이미지 흐름 (image1 만). build_edit_api 본체 그대로."""
    api: ApiPrompt = {}
    # ... (기존 build_edit_api 본문 전체 이동)
```

기존 `build_edit_api` 본문 (api 빌드 코드) 을 `_build_edit_api_single` 함수 안으로 그대로 이동. 새 `_build_edit_api_multi_ref` 는 Phase 4 에서 작성 (지금은 stub).

stub:
```python
def _build_edit_api_multi_ref(v: EditApiInput) -> ApiPrompt:
    """이미지 + 참조 이미지 (image1+image2) 다중 참조 흐름.
    Phase 4 에서 구현. Phase 1 단계에선 단일 흐름으로 폴백."""
    # TEMP: Phase 1 검증용 폴백. Phase 4 에서 진짜 multi-ref 노드 체인 작성.
    return _build_edit_api_single(v)
```

- [ ] **Step 2: 검증**

Run: `cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `215 passed` (옛 호출 모두 reference_image_filename=None → 단일 path 폴백)

- [ ] **Step 3: Commit (사용자 승인 후만)**

```bash
git add backend/studio/comfy_api_builder.py
git commit -m "refactor(edit): build_edit_api 단일/멀티 ref 분기 (early return) — 옛 흐름 보존"
```

### Task 3: routes/streams.py 가 reference image 수신 (UI 미사용 단계)

**Files:**
- Modify: `backend/studio/routes/streams.py:80-148` (`create_edit_task` 함수)

- [ ] **Step 1: multipart 에 optional reference_image 파일 받기**

`backend/studio/routes/streams.py:80` 의 `create_edit_task` 시그니처:

```python
@router.post("/edit", response_model=TaskCreated)
async def create_edit_task(
    image: UploadFile = File(...),
    meta: str = Form(...),
    reference_image: UploadFile | None = File(None),
):
    """수정 요청 (multipart): image 파일 + meta JSON + 옵션 reference_image."""
```

- [ ] **Step 2: meta 에서 use_reference_image / reference_role 파싱**

`prompt = meta_obj.get("prompt", "").strip()` 직후:

```python
    use_reference_image = bool(meta_obj.get("useReferenceImage", False))
    reference_role_raw = meta_obj.get("referenceRole")
    reference_role: str | None = (
        reference_role_raw.strip() if isinstance(reference_role_raw, str) and reference_role_raw.strip() else None
    )
```

- [ ] **Step 3: reference 이미지 bytes 읽기 (조건부)**

`image_bytes = await image.read()` 직후:

```python
    reference_bytes: bytes | None = None
    reference_filename: str | None = None
    if use_reference_image and reference_image is not None:
        reference_bytes = await reference_image.read()
        if reference_bytes:
            if len(reference_bytes) > STUDIO_MAX_IMAGE_BYTES:
                raise HTTPException(
                    413,
                    f"reference image too large: {len(reference_bytes)} bytes "
                    f"(max {STUDIO_MAX_IMAGE_BYTES})",
                )
            try:
                with Image.open(io.BytesIO(reference_bytes)) as ref_im:
                    _ = ref_im.size  # 손상 검증만
            except UnidentifiedImageError as e:
                raise HTTPException(400, f"invalid reference image format: {e}") from e
            reference_filename = reference_image.filename or "reference.png"
        else:
            reference_bytes = None  # 빈 파일은 무시

    # ⚠️ Backend 게이트 (Codex 리뷰 — zero-regression 보장):
    # reference_bytes 가 None 이면 reference_role 도 None 강제.
    # 옛 단일 이미지 흐름에서 role 이 누수되어 SYSTEM_EDIT 에 multi-ref clause 가
    # 들어가는 위험 차단. Backend 가 *최종 게이트* — 프론트가 보내든 말든 무관.
    if reference_bytes is None:
        reference_role = None

    # ⚠️ Codex 2차 리뷰 fix #4: useReferenceImage=true 인데 파일 없는 케이스 거부.
    # 조용히 단일 흐름으로 폴백하면 사용자 의도/데이터 의미가 깨짐.
    # 명시적 400 으로 거부 → 프론트는 CTA 비활성으로 미리 차단 (Task 11 에서).
    if use_reference_image and reference_bytes is None:
        raise HTTPException(
            400,
            "참조 이미지 토글이 켜져 있는데 reference_image 파일이 없거나 비어있습니다.",
        )
```

- [ ] **Step 4: _run_edit_pipeline 호출에 reference 파라미터 전달**

`task.worker = _spawn(_run_edit_pipeline(...))` 호출에 keyword arg 추가:

```python
    task.worker = _spawn(
        _run_edit_pipeline(
            task,
            image_bytes,
            prompt,
            lightning,
            image.filename or "input.png",
            ollama_model_override,
            vision_model_override,
            source_width=source_w,
            source_height=source_h,
            reference_bytes=reference_bytes,
            reference_filename=reference_filename,
            reference_role=reference_role,
        )
    )
```

- [ ] **Step 5: pipelines/edit.py 의 _run_edit_pipeline 시그니처 확장**

`backend/studio/pipelines/edit.py` 의 `_run_edit_pipeline` 함수 시그니처에 옵셔널 파라미터 추가 (실제 dispatch 는 Phase 4 에서 처리, 지금은 받기만):

```python
async def _run_edit_pipeline(
    task: Task,
    image_bytes: bytes,
    prompt: str,
    lightning: bool,
    filename: str,
    ollama_model_override: str | None = None,
    vision_model_override: str | None = None,
    *,
    source_width: int = 0,
    source_height: int = 0,
    # Multi-ref (2026-04-27): Phase 1 은 받기만 · Phase 4 에서 실 dispatch.
    reference_bytes: bytes | None = None,
    reference_filename: str | None = None,
    reference_role: str | None = None,
) -> None:
```

함수 본문은 *지금 단계에선 reference 파라미터 사용 X*. 받기만 하고 무시.

- [ ] **Step 6: pytest 회귀 검증**

Run: `cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `215 passed`

- [ ] **Step 7: OpenAPI snapshot 갱신 (Codex 2차 리뷰 fix #8 — 순서 명시)**

> ⚠️ **타이밍:** backend route/multipart schema 가 변경된 *직후* snapshot 갱신.
> Frontend `npm run gen:types` 는 이 step 다음 — 즉 backend 부터 frontend 순서.
> 옛 코드 (단일 이미지 흐름) 은 schema 변경 영향 0 이라 회귀 위험 없음.

Run: `UPDATE_OPENAPI_SNAPSHOT=1 D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/studio/test_openapi_contract.py -q`
Expected: `1 passed`

OpenAPI 응답이 변경됐을 가능성 (multipart 의 새 reference_image 필드 + meta 의 useReferenceImage). snapshot 갱신 후 다시 전체 pytest:

Run: `D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `215 passed`

- [ ] **Step 8: Backend 검증 단위 테스트 — useReferenceImage=true + no file (Codex 2차 리뷰 fix #4)**

`backend/tests/studio/test_multi_ref_edit.py` 에 추가 (또는 신규 routes 테스트 파일):

```python
@pytest.mark.asyncio
async def test_edit_endpoint_rejects_useref_true_without_file() -> None:
    """useReferenceImage=true 인데 reference_image 파일 미동봉 → 400."""
    import io
    from httpx import ASGITransport, AsyncClient
    from main import app  # type: ignore

    # 정상 source 이미지만 동봉, reference_image 없음
    src_bytes = _make_png_bytes()  # 헬퍼
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post(
            "/api/studio/edit",
            files={"image": ("src.png", io.BytesIO(src_bytes), "image/png")},
            data={
                "meta": json.dumps({
                    "prompt": "test",
                    "useReferenceImage": True,  # ← 토글 ON
                    "referenceRole": "face",
                    # reference_image 파일 안 보냄
                }),
            },
        )
    assert response.status_code == 400
    assert "참조 이미지" in response.json().get("detail", "")


@pytest.mark.asyncio
async def test_edit_endpoint_rejects_useref_true_with_empty_file() -> None:
    """useReferenceImage=true 인데 reference_image 가 0바이트 파일 → 400."""
    import io
    from httpx import ASGITransport, AsyncClient
    from main import app  # type: ignore

    src_bytes = _make_png_bytes()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post(
            "/api/studio/edit",
            files={
                "image": ("src.png", io.BytesIO(src_bytes), "image/png"),
                "reference_image": ("ref.png", io.BytesIO(b""), "image/png"),  # 빈 파일
            },
            data={
                "meta": json.dumps({
                    "prompt": "test",
                    "useReferenceImage": True,
                    "referenceRole": "face",
                }),
            },
        )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_edit_endpoint_role_ignored_when_useref_false(monkeypatch) -> None:
    """useReferenceImage=false 면 referenceRole 도 게이트로 None 강제 (누수 방지)."""
    import io
    from httpx import ASGITransport, AsyncClient
    from main import app  # type: ignore

    # _run_edit_pipeline 호출 캡처해서 reference_role 검증.
    captured_kwargs = {}
    def _fake_run_edit(*args, **kwargs):
        # Codex 3차 리뷰 fix: async body 에서 캡처하면 background task 실행 타이밍에
        # 의존하므로, sync wrapper 가 호출 즉시 kwargs 를 저장하고 noop coroutine 반환.
        captured_kwargs.update(kwargs)
        async def _noop():
            return None
        return _noop()

    monkeypatch.setattr(
        "studio.routes.streams._run_edit_pipeline", _fake_run_edit
    )

    src_bytes = _make_png_bytes()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post(
            "/api/studio/edit",
            files={"image": ("src.png", io.BytesIO(src_bytes), "image/png")},
            data={
                "meta": json.dumps({
                    "prompt": "test",
                    "useReferenceImage": False,  # OFF
                    "referenceRole": "face",  # 누수 시도
                }),
            },
        )
    # task 생성은 성공해야 (200) — 하지만 role 은 None 으로 강제
    assert response.status_code == 200
    assert captured_kwargs.get("reference_role") is None
```

> Codex 3차 리뷰 fix: repo 의 기존 route 테스트 패턴에 맞춰 `client` fixture 가 아니라
> `httpx.AsyncClient + ASGITransport(app=app)` 를 사용. `_make_png_bytes` 헬퍼는 동일 파일에 정의.

Run: `D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/studio/test_multi_ref_edit.py -v`
Expected: `5 passed` (Phase 1 베이스라인 2 + 신규 3)

- [ ] **Step 9: Commit (사용자 승인 후만)**

```bash
# 사용자 "커밋해" 명시 후에만:
git add backend/studio/routes/streams.py backend/studio/pipelines/edit.py backend/tests/_snapshots/openapi.json backend/tests/studio/test_multi_ref_edit.py
git commit -m "feat(edit): /edit 엔드포인트 reference_image multipart + 검증 + 게이트 테스트"
```

### Task 4: history_db schema v6→v7 마이그레이션

**Files:**
- Modify: `backend/studio/history_db.py` (CREATE_TABLE / SCHEMA_VERSION / init_studio_history_db / insert_item / _row_to_item)

- [ ] **Step 1: SCHEMA_VERSION 6→7 + 마이그레이션 함수 추가**

`backend/studio/history_db.py:51` 부근:

```python
# Schema version — 2026-04-27 (C2-P2-3) 도입.
# 신규 마이그레이션 추가 시 + 1 + init 함수에 idempotent 적용 함수 추가.
SCHEMA_VERSION = 7
```

기존 마이그레이션 함수 (`_migrate_*`) 패턴 따라 새 함수 추가:

```python
async def _migrate_add_reference_columns(db: aiosqlite.Connection) -> None:
    """v7 (2026-04-27): reference_ref + reference_role 컬럼 추가.

    Edit 모드 multi-reference 기능용. ALTER ADD COLUMN 은 idempotent —
    이미 존재하면 OperationalError 발생, try/except 로 무시.
    """
    for sql in (
        "ALTER TABLE studio_history ADD COLUMN reference_ref TEXT",
        "ALTER TABLE studio_history ADD COLUMN reference_role TEXT",
    ):
        try:
            await db.execute(sql)
        except aiosqlite.OperationalError as e:
            # "duplicate column" 만 idempotent 무시
            if "duplicate column" not in str(e).lower():
                raise
    await db.commit()
```

- [ ] **Step 2: CREATE_TABLE 도 새 컬럼 포함하게 갱신**

`CREATE_TABLE = """..."""` (line 67) 의 끝 컬럼들 직전에 추가:

```python
CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS studio_history (
  id TEXT PRIMARY KEY,
  ...
  adult INTEGER,
  duration_sec REAL,
  fps INTEGER,
  frame_count INTEGER,
  reference_ref TEXT,
  reference_role TEXT
);
"""
```

- [ ] **Step 3: init_studio_history_db 에서 v7 마이그레이션 호출**

`init_studio_history_db` 함수 안에 다음 추가 (다른 마이그레이션 함수 호출 직후):

```python
        if current_version < 7:
            await _migrate_add_reference_columns(db)
```

(정확한 위치는 `_migrate_*` 호출 시퀀스 끝)

- [ ] **Step 4: insert_item INSERT SQL 확장 (v6 의 refined_intent 컬럼 유지 ⚠️)**

> ⚠️ **Codex 리뷰 반영:** 옛 v6 의 `refined_intent` 컬럼이 *반드시 유지*되어야 함.
> `history_db.py:273-279` 의 현재 INSERT 가 이미 `refined_intent` 포함 — 그 SQL 의
> 컬럼 목록 끝에 `reference_ref, reference_role` *추가만*. 전면 재작성 X.

실제 작업 패턴:

```python
# 작업 절차:
# 1. history_db.py 의 insert_item 함수 본문에서 현재 INSERT SQL 확인 (line ~273-310).
# 2. 그 SQL 의 컬럼 목록 끝에 ", reference_ref, reference_role" 추가.
# 3. VALUES 의 placeholder 개수에 맞춰 ", ?, ?" 추가.
# 4. params 튜플 끝에 다음 두 값 추가 (기존 모든 값 + refined_intent 보존):
#       item.get("referenceRef"),
#       item.get("referenceRole"),
# 5. refined_intent / source_ref / comparison_analysis 등 기존 컬럼은 모두 그대로.
```

(정확한 SQL/params 는 작업 시 실 코드 base 로 두 컬럼만 추가 — Codex 검증 항목)

- [ ] **Step 5: _row_to_item 에 두 필드 매핑 추가**

`_row_to_item` 함수 끝 부분의 dict 반환에 추가:

```python
    return {
        ...,  # 기존 필드들
        "referenceRef": row["reference_ref"],
        "referenceRole": row["reference_role"],
    }
```

(camelCase 로 — frontend HistoryItem 타입과 일관)

- [ ] **Step 6: 검증**

Run: `cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `215 passed`. 옛 row 들은 reference_ref=NULL / reference_role=NULL 로 매핑됨. 깨짐 0.

- [ ] **Step 7: Commit (사용자 승인 후만)**

```bash
git add backend/studio/history_db.py
git commit -m "feat(edit): history_db v7 — reference_ref + reference_role 컬럼 (multi-ref 준비)"
```

### Task 5: Phase 1 회귀 베이스라인 — 옛 단일 이미지 흐름 100% 동일 검증

**Files:**
- Test: `backend/tests/studio/test_multi_ref_edit.py` (**NEW**)

- [ ] **Step 1: 단위 테스트 — reference_image_filename=None 일 때 옛 path 동일**

`backend/tests/studio/test_multi_ref_edit.py` 신규 파일:

```python
"""Edit Multi-Reference 테스트.

Phase 1: reference_image_filename=None 일 때 build_edit_api 가 옛 코드 path 와
완전히 동일한 결과 반환하는지 검증. 회귀 위험 0 보장.
"""

from __future__ import annotations

import pytest

from studio.comfy_api_builder import build_edit_api
from studio.presets import EDIT_MODEL


def _make_input(reference_filename: str | None = None, reference_role: str | None = None):
    """EditApiInput 헬퍼 — 기본값으로 채우고 reference 만 override."""
    from studio.comfy_api_builder import EditApiInput

    d = EDIT_MODEL.defaults
    return EditApiInput(
        prompt="test prompt",
        source_image_filename="src.png",
        seed=42,
        steps=d.steps,
        cfg=d.cfg,
        sampler=d.sampler,
        scheduler=d.scheduler,
        shift=d.shift,
        lightning=False,
        unet_name=EDIT_MODEL.files.unet,
        clip_name=EDIT_MODEL.files.clip,
        vae_name=EDIT_MODEL.files.vae,
        extra_loras=[],
        lightning_lora_name=None,
        reference_image_filename=reference_filename,
        reference_role=reference_role,
    )


def test_no_reference_returns_single_path():
    """reference_image_filename=None 이면 옛 path 와 동일한 노드 dict 반환."""
    inp = _make_input(reference_filename=None)
    api = build_edit_api(inp)

    # 옛 path 의 핵심 노드 존재 확인
    classes = {node["class_type"] for node in api.values()}
    assert "LoadImage" in classes
    assert "FluxKontextImageScale" in classes
    assert "TextEncodeQwenImageEditPlus" in classes
    assert "VAEEncode" in classes
    assert "KSampler" in classes
    assert "SaveImage" in classes

    # 단일 이미지 path 라 LoadImage 가 정확히 1개여야 함
    load_count = sum(1 for n in api.values() if n["class_type"] == "LoadImage")
    assert load_count == 1


def test_reference_filename_with_stub_returns_same_as_single():
    """Phase 1: _build_edit_api_multi_ref 가 stub 폴백 → 단일 path 와 동일.

    Phase 4 에서 진짜 multi-ref 노드 체인 작성 시 이 테스트는 갱신.
    """
    inp_single = _make_input(reference_filename=None)
    inp_multi = _make_input(reference_filename="ref.png", reference_role="face")

    api_single = build_edit_api(inp_single)
    api_multi = build_edit_api(inp_multi)

    # Phase 1 stub: multi-ref 도 단일 path 와 동일한 키 셋
    assert set(api_single.keys()) == set(api_multi.keys())
```

- [ ] **Step 2: 테스트 실행 — 두 케이스 모두 통과**

Run: `cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/studio/test_multi_ref_edit.py -v`
Expected: `2 passed`

- [ ] **Step 3: 전체 pytest 한 번 더**

Run: `D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `217 passed` (215 + 2 신규)

- [ ] **Step 4: Commit (사용자 승인 후만)**

```bash
git add backend/tests/studio/test_multi_ref_edit.py
git commit -m "test(edit): Phase 1 회귀 베이스라인 — 옛 단일 path 동일 보장"
```

---

## Phase 2: Frontend 토글 UI scaffolding (백엔드 dispatch 미사용)

목표: Frontend 에 토글 + state 추가. 토글 OFF 시 옛 UI 100% 동일. 토글 ON 시 두번째 카드 conditional render 만 (실제 multipart 전송 X).

### Task 6: useEditStore 에 reference 필드 추가

**Files:**
- Modify: `frontend/stores/useEditStore.ts`

- [ ] **Step 1: 변경 전 baseline**

Run: `cd /d/AI-Image-Studio/frontend && npm test 2>&1 | tail -3`
Expected: `50 passed`

- [ ] **Step 2: store interface + state 확장**

`frontend/stores/useEditStore.ts` 의 EditState interface 에 추가:

```typescript
export type ReferenceRoleId = "face" | "outfit" | "style" | "background" | "custom";

export interface EditState {
  // ... 기존 필드들

  /** Multi-reference (2026-04-27): 두번째 이미지 입력 사용 여부 */
  useReferenceImage: boolean;
  /** 두번째 이미지 — data URL */
  referenceImage: string | null;
  referenceLabel: string;
  referenceWidth: number | null;
  referenceHeight: number | null;
  /** 사용자 명시 role — preset 5개 중 하나 */
  referenceRole: ReferenceRoleId;
  /** referenceRole === "custom" 일 때만 사용 — 사용자 자유 입력 */
  referenceRoleCustom: string;

  // ... 기존 액션들
  setUseReferenceImage: (v: boolean) => void;
  setReferenceImage: (
    image: string | null,
    label?: string,
    w?: number,
    h?: number,
  ) => void;
  setReferenceRole: (role: ReferenceRoleId) => void;
  setReferenceRoleCustom: (text: string) => void;
}
```

create 안의 기본값 + setter 구현:

```typescript
  // 기본값
  useReferenceImage: false,
  referenceImage: null,
  referenceLabel: "참조 이미지를 업로드해 주세요",
  referenceWidth: null,
  referenceHeight: null,
  referenceRole: "face",
  referenceRoleCustom: "",

  // 액션
  setUseReferenceImage: (v) => set({ useReferenceImage: v }),
  setReferenceImage: (image, label, w, h) =>
    set({
      referenceImage: image,
      referenceLabel: label ?? "참조 이미지를 업로드해 주세요",
      referenceWidth: w ?? null,
      referenceHeight: h ?? null,
    }),
  setReferenceRole: (role) => set({ referenceRole: role }),
  setReferenceRoleCustom: (text) => set({ referenceRoleCustom: text }),
```

- [ ] **Step 3: ~~persist partialize 갱신~~ — useEditStore 에 persist 없음 (Codex 리뷰 반영)**

> ⚠️ **Codex 리뷰:** useEditStore 는 현재 persist 미들웨어를 사용하지 않음 (`useEditStore.ts:54` 주석 — "persist X"). 따라서 partialize 갱신 *불필요*.
> 모든 reference 필드는 *세션 한정* — 새로고침 시 default (false / null / "face") 로 복귀.
> 이게 더 안전 (옛 케이스의 토글이 다음 세션에 살아있어 깜빡 멀티-ref 모드로 진입하는 위험 회피).

> ~~persist 도입은 별도 결정 사항~~. 만약 미래에 사용자 요청 시 그때 useEditStore 전체에 persist 도입 + 모든 영속 필드 동시 결정.

이 step 은 **skip**. Task 6 의 다른 step 만 진행.

```typescript
// (참고용 — 이 코드 블록은 적용하지 않음)
// 옛 plan 의 partialize 변경은 persist 미들웨어가 있어야 작동.
// useEditStore 는 persist 없으니 모든 필드 자동 세션 한정.
      partialize: (s) => ({
        prompt: s.prompt,
        lightning: s.lightning,
        // ... 기존 영속 필드들
        useReferenceImage: s.useReferenceImage,
        referenceRole: s.referenceRole,
        referenceRoleCustom: s.referenceRoleCustom,
      }),
```

(referenceImage 자체는 페이지 진입 시 빈 상태에서 시작)

- [ ] **Step 4: useEditInputs selector 에 reference 필드 노출**

`useEditInputs` (useShallow selector) 에 새 필드 + setter 추가.

- [ ] **Step 5: 검증**

Run: `npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -3`
Expected: `50 passed` + tsc/lint clean

- [ ] **Step 6: Commit (사용자 승인 후만)**

```bash
git add frontend/stores/useEditStore.ts
git commit -m "feat(edit): useEditStore 에 reference 필드 (토글 + role 영속)"
```

### Task 7: ReferenceRoleSelect 컴포넌트 신규

**Files:**
- Create: `frontend/components/studio/edit/ReferenceRoleSelect.tsx` (**NEW**)

- [ ] **Step 1: 컴포넌트 작성**

```typescript
/**
 * ReferenceRoleSelect — Multi-reference Edit 모드의 참조 역할 선택.
 *
 * preset 5개 (얼굴 / 의상 / 스타일 / 배경 / 직접) chip 형식.
 * "직접" 선택 시 자유 텍스트 입력 박스 노출.
 *
 * 2026-04-27 (Edit Multi-Reference Phase 2).
 */

"use client";

import type { ReferenceRoleId } from "@/stores/useEditStore";

interface RolePreset {
  id: ReferenceRoleId;
  emoji: string;
  label: string;
  desc: string;
}

const ROLE_PRESETS: RolePreset[] = [
  { id: "face",       emoji: "👤", label: "얼굴",   desc: "얼굴 정체성 유지" },
  { id: "outfit",     emoji: "👗", label: "의상",   desc: "옷/액세서리만 차용" },
  { id: "style",      emoji: "🎨", label: "스타일", desc: "색감/조명/톤" },
  { id: "background", emoji: "🏞️", label: "배경",   desc: "환경/배경" },
  { id: "custom",     emoji: "✏️", label: "직접",   desc: "자유 텍스트 입력" },
];

interface Props {
  selected: ReferenceRoleId;
  onSelect: (id: ReferenceRoleId) => void;
  customText: string;
  onCustomTextChange: (text: string) => void;
}

export default function ReferenceRoleSelect({
  selected,
  onSelect,
  customText,
  onCustomTextChange,
}: Props) {
  const activeDesc =
    ROLE_PRESETS.find((p) => p.id === selected)?.desc ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          fontSize: 11.5,
          color: "var(--ink-3)",
          fontWeight: 500,
        }}
      >
        참조 역할
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ROLE_PRESETS.map((p) => {
          const active = selected === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              title={p.desc}
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "5px 10px",
                fontSize: 11.5,
                fontWeight: 600,
                borderRadius: "var(--radius-full)",
                border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                background: active ? "var(--accent-soft)" : "var(--bg)",
                color: active ? "var(--accent-ink)" : "var(--ink-2)",
                transition: "all .15s",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span aria-hidden>{p.emoji}</span>
              {p.label}
            </button>
          );
        })}
      </div>

      {selected === "custom" ? (
        <input
          type="text"
          value={customText}
          onChange={(e) => onCustomTextChange(e.target.value)}
          placeholder="예: 헤어스타일 참조 / 손 포즈 참조 / 배경 분위기"
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
      ) : (
        <div
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            paddingLeft: 2,
          }}
        >
          {activeDesc}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: tsc + lint clean 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 출력 0 (clean)

- [ ] **Step 3: Commit (사용자 승인 후만)**

```bash
# 사용자 "커밋해" 명시 후에만:
git add frontend/components/studio/edit/ReferenceRoleSelect.tsx
git commit -m "feat(edit): ReferenceRoleSelect 컴포넌트 — 참조 역할 chip selector"
```

### Task 7b: SourceImageCard 에 pasteRequireHover prop 추가 (Codex 2차 리뷰 fix #3)

**Files:**
- Modify: `frontend/components/studio/SourceImageCard.tsx`
- Test: `frontend/__tests__/source-image-card-paste.test.ts` (**NEW**)

> ⚠️ **Codex 2차 리뷰 fix #3:** Multi-ref ON 상태에서 EditLeftPanel 안에 SourceImageCard 가 *2개* 마운트됨. 현재 SourceImageCard 는 `pasteEnabled` 만 (호버 무관 전역 paste) 사용 → 두 카드가 같은 Ctrl+V 이벤트를 동시에 잡아 *어느 카드에 붙을지 비결정적*. CompareImageSlot 에서 이미 쓰던 `pasteRequireHover` 패턴 (StudioUploadSlot 가 이미 지원) 을 SourceImageCard 에도 prop 으로 노출.

- [ ] **Step 1: SourceImageCard 인터페이스 확장**

`frontend/components/studio/SourceImageCard.tsx:20-31` 의 `SourceImageCardProps` 에 추가:

```typescript
interface SourceImageCardProps {
  sourceImage: string | null;
  sourceLabel: string;
  sourceWidth: number | null;
  sourceHeight: number | null;
  /** 업로드/변경 완료 시 */
  onChange: (image: string, label: string, w: number, h: number) => void;
  /** × 해제 */
  onClear: () => void;
  /** 업로드 실패 시 토스트 노출용 — 부모가 레벨(error/warn) 판단 */
  onError: (message: string) => void;
  /** Multi-ref 등 멀티 슬롯 페이지에서 paste 충돌 방지 — 호버한 카드만 paste 수용.
   *  default false (옛 동작 유지 — 단일 슬롯 페이지 호환). */
  pasteRequireHover?: boolean;
}
```

- [ ] **Step 2: StudioUploadSlot 으로 prop 전달**

기존 `<StudioUploadSlot ... pasteEnabled />` 호출에 `pasteRequireHover` 전달:

```typescript
      <StudioUploadSlot
        filled={!!sourceImage}
        height={256}
        onFiles={handleFiles}
        acceptDropWhenFilled
        pasteEnabled
        pasteRequireHover={pasteRequireHover}  // ← 추가
        onReady={(pick) => setPickFn(() => pick)}
        emptyContent={...}
      >
```

- [ ] **Step 3: 컴포넌트 함수 시그니처 갱신**

```typescript
export default function SourceImageCard({
  sourceImage,
  sourceLabel,
  sourceWidth,
  sourceHeight,
  onChange,
  onClear,
  onError,
  pasteRequireHover = false,  // ← default false (옛 호출 호환)
}: SourceImageCardProps) {
```

- [ ] **Step 4: 단위 테스트 — paste 충돌 방지 동작 검증**

`frontend/__tests__/source-image-card-paste.test.ts` (**NEW**):

```typescript
/**
 * SourceImageCard 의 pasteRequireHover prop 동작 단위 테스트.
 * Multi-ref 페이지에서 두 카드가 paste 충돌 안 하도록 StudioUploadSlot 에
 * prop 이 정확히 전달되는지 검증.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import SourceImageCard from "@/components/studio/SourceImageCard";

const slotState = vi.hoisted(() => ({
  lastProps: null as null | { pasteRequireHover?: boolean },
}));

vi.mock("@/components/studio/StudioUploadSlot", () => ({
  default: (props: { pasteRequireHover?: boolean }) => {
    slotState.lastProps = props;
    return <div data-testid="studio-upload-slot" />;
  },
}));

describe("SourceImageCard - pasteRequireHover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    slotState.lastProps = null;
  });

  it("default false: StudioUploadSlot 에 pasteRequireHover=false 전달", () => {
    const onChange = vi.fn();
    render(
      <SourceImageCard
        sourceImage={null}
        sourceLabel=""
        sourceWidth={null}
        sourceHeight={null}
        onChange={onChange}
        onClear={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(slotState.lastProps?.pasteRequireHover).toBe(false);
  });

  it("pasteRequireHover=true: StudioUploadSlot 에 true 전달", () => {
    const onChange = vi.fn();
    render(
      <SourceImageCard
        sourceImage={null}
        sourceLabel=""
        sourceWidth={null}
        sourceHeight={null}
        onChange={onChange}
        onClear={vi.fn()}
        onError={vi.fn()}
        pasteRequireHover
      />,
    );
    expect(slotState.lastProps?.pasteRequireHover).toBe(true);
  });
});
```

> Codex 3차 리뷰 fix: 단순 `container` truthy 검증은 의미가 약하므로
> `StudioUploadSlot` 을 mock 해서 `pasteRequireHover` prop 값을 직접 assert.

- [ ] **Step 5: 기존 SourceImageCard 호출자 영향 0 검증**

```bash
cd /d/AI-Image-Studio/frontend && grep -rn "<SourceImageCard" --include="*.tsx" components/ app/ hooks/
```

기존 호출자 (Edit / Video / Vision) 모두 `pasteRequireHover` 안 넘김 → default `false` → 옛 동작 그대로.

- [ ] **Step 6: 검증**

Run: `npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -3`
Expected: clean + 테스트 통과

- [ ] **Step 7: Commit (사용자 승인 후만)**

```bash
# 사용자 "커밋해" 명시 후에만:
git add frontend/components/studio/SourceImageCard.tsx frontend/__tests__/source-image-card-paste.test.ts
git commit -m "feat(ui): SourceImageCard pasteRequireHover prop — 멀티 슬롯 paste 충돌 방지"
```

### Task 8: EditLeftPanel 에 토글 + 조건부 두번째 카드

**Files:**
- Modify: `frontend/components/studio/edit/EditLeftPanel.tsx`

- [ ] **Step 1: import 추가**

```typescript
import ReferenceRoleSelect from "./ReferenceRoleSelect";
```

- [ ] **Step 2: store hook 에서 reference 필드 가져오기**

```typescript
  const {
    sourceImage, sourceLabel, sourceWidth, sourceHeight, setSource,
    prompt, setPrompt,
    lightning, setLightning,
    useReferenceImage, setUseReferenceImage,
    referenceImage, referenceLabel, referenceWidth, referenceHeight,
    setReferenceImage,
    referenceRole, setReferenceRole,
    referenceRoleCustom, setReferenceRoleCustom,
  } = useEditInputs();
```

- [ ] **Step 3: 자동 비교 분석 토글 다음 (Lightning 토글 다음 위치) 에 참조 토글 + 조건부 카드 추가**

자동 비교 분석 Toggle 직후에 추가:

```tsx
      {/* Multi-reference (2026-04-27): 두번째 이미지 토글 + 조건부 슬롯 */}
      <Toggle
        checked={useReferenceImage}
        onChange={setUseReferenceImage}
        align="right"
        label="🖼️ 참조 이미지 사용 (실험적)"
        desc={
          useReferenceImage
            ? "두번째 이미지를 참조로 사용 — 역할 명시 필요"
            : "OFF · 단일 이미지 수정 (기본)"
        }
      />

      {useReferenceImage && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="ais-field-header">
            <label
              className="ais-field-label"
              style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
            >
              <SectionAccentBar accent="violet" />
              참조 이미지
            </label>
            <span className="mono ais-field-meta">
              {referenceWidth && referenceHeight
                ? `${referenceWidth}×${referenceHeight}`
                : "—"}
            </span>
          </div>
          <SourceImageCard
            sourceImage={referenceImage}
            sourceLabel={referenceLabel}
            sourceWidth={referenceWidth}
            sourceHeight={referenceHeight}
            onChange={(image, label, w, h) => {
              setReferenceImage(image, label, w, h);
              toast.success("참조 이미지 업로드", label.split(" · ")[0]);
            }}
            onClear={() => {
              setReferenceImage(null);
              toast.info("참조 이미지 해제됨");
            }}
            onError={(msg) => toast.error(msg)}
            pasteRequireHover  // ← Codex 2차 리뷰 fix #3 — 멀티 슬롯 paste 충돌 방지
          />
          <ReferenceRoleSelect
            selected={referenceRole}
            onSelect={setReferenceRole}
            customText={referenceRoleCustom}
            onCustomTextChange={setReferenceRoleCustom}
          />
        </div>
      )}
```

- [ ] **Step 4: 첫번째 SourceImageCard (원본) 도 multi-ref ON 시 hover 모드로 (Codex 2차 리뷰 fix #3)**

기존 EditLeftPanel 의 첫번째 SourceImageCard 호출 (원본 이미지) 에 `pasteRequireHover={useReferenceImage}` prop 추가:

```tsx
        <SourceImageCard
          sourceImage={sourceImage}
          sourceLabel={sourceLabel}
          sourceWidth={sourceWidth}
          sourceHeight={sourceHeight}
          onChange={handleSourceChange}
          onClear={handleClearSource}
          onError={(msg) => toast.error(msg)}
          pasteRequireHover={useReferenceImage}  // ← multi-ref ON 시만 hover 모드
        />
```

→ Multi-ref OFF: 옛 동작 (전역 paste · 옛 사용자 영향 0). Multi-ref ON: 두 카드 모두 호버 기반 paste → 충돌 0.

- [ ] **Step 5: useReferenceImage 토글 ON + referenceImage 없을 때 CTA 비활성 (Codex 2차 리뷰 fix #4)**

generate / submit CTA 버튼 disabled 조건에 추가:

```tsx
const ctaDisabled =
  running ||
  !sourceImage ||
  !prompt.trim() ||
  // Multi-ref ON 인데 reference 파일 없음 → 차단 (백엔드 400 미리 방지)
  (useReferenceImage && !referenceImage);
```

또는 (CTA 디자인 따라) 호버 시 warning tooltip:

```tsx
title={
  useReferenceImage && !referenceImage
    ? "참조 이미지를 업로드하거나 토글을 끄세요"
    : undefined
}
```

- [ ] **Step 6: 검증 — tsc/lint/vitest clean + UI 시각 확인**

Run: `npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -3`
Expected: `50 passed` (Phase 2 의 신규 테스트는 Task 9 에서 추가)

브라우저 UI 확인 사항 (수동):
- 토글 OFF: 두번째 카드 + role chip 모두 안 보임
- 토글 ON + 참조 이미지 없음: CTA 비활성
- 토글 ON + 참조 이미지 있음: CTA 활성, paste 시 호버한 카드만 수용
- 옛 단일 이미지 모드 (토글 OFF): paste 호버 무관 — 옛 동작 그대로

- [ ] **Step 7: Commit (사용자 승인 후만)**

```bash
# 사용자 "커밋해" 명시 후에만:
git add frontend/components/studio/edit/EditLeftPanel.tsx
git commit -m "feat(edit): EditLeftPanel 토글 + 두번째 카드 + paste hover + CTA 검증"
```

### Task 9: Phase 2 회귀 베이스라인 — Frontend

**Files:**
- Test: `frontend/__tests__/edit-multi-ref.test.ts` (**NEW**)

- [ ] **Step 1: 단위 테스트 — store 기본값 + setter 동작**

```typescript
/**
 * Edit Multi-Reference store + multipart 단위 테스트 (Phase 2/3 검증).
 */

import { describe, expect, it, beforeEach } from "vitest";
import { useEditStore } from "@/stores/useEditStore";

describe("useEditStore - reference fields", () => {
  beforeEach(() => {
    // 각 테스트 전에 store 초기화
    useEditStore.setState({
      useReferenceImage: false,
      referenceImage: null,
      referenceLabel: "참조 이미지를 업로드해 주세요",
      referenceWidth: null,
      referenceHeight: null,
      referenceRole: "face",
      referenceRoleCustom: "",
    });
  });

  it("default values are safe (toggle OFF)", () => {
    const s = useEditStore.getState();
    expect(s.useReferenceImage).toBe(false);
    expect(s.referenceImage).toBeNull();
    expect(s.referenceRole).toBe("face");
  });

  it("setUseReferenceImage toggles flag", () => {
    useEditStore.getState().setUseReferenceImage(true);
    expect(useEditStore.getState().useReferenceImage).toBe(true);
  });

  it("setReferenceImage sets all fields", () => {
    useEditStore
      .getState()
      .setReferenceImage("data:image/png;base64,xxx", "ref.png", 1024, 768);
    const s = useEditStore.getState();
    expect(s.referenceImage).toBe("data:image/png;base64,xxx");
    expect(s.referenceLabel).toBe("ref.png");
    expect(s.referenceWidth).toBe(1024);
    expect(s.referenceHeight).toBe(768);
  });

  it("setReferenceRole accepts all 5 presets", () => {
    const presets = ["face", "outfit", "style", "background", "custom"] as const;
    for (const p of presets) {
      useEditStore.getState().setReferenceRole(p);
      expect(useEditStore.getState().referenceRole).toBe(p);
    }
  });

  it("setReferenceRoleCustom captures user input", () => {
    useEditStore.getState().setReferenceRoleCustom("헤어스타일 참조");
    expect(useEditStore.getState().referenceRoleCustom).toBe("헤어스타일 참조");
  });
});

// ── FormData / API 통합 테스트 (Codex 2차 리뷰 추가) ──
import { editImageStream } from "@/lib/api/edit";

describe("editImageStream - FormData 검증 (Codex 2차 리뷰 fix #4)", () => {
  beforeEach(() => {
    // fetch mock — multipart body 만 캡처, 실 백엔드 무관
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ task_id: "tsk-test", stream_url: "/x" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    ) as unknown as typeof fetch;
  });

  it("multi-ref OFF: FormData 에 reference_image 없음", async () => {
    const gen = editImageStream({
      // Codex 3차 리뷰 fix: data URL 은 edit.ts 내부에서 먼저 fetch 되므로
      // FormData 검증 테스트에서는 File 을 사용해 첫 fetch 가 /edit 생성 요청이 되게 함.
      sourceImage: new File([new Uint8Array([1])], "src.png", { type: "image/png" }),
      prompt: "test",
      lightning: false,
      useReferenceImage: false,  // OFF
    });
    // 처음 yield 까지만 진행 — 실 SSE 무시
    try { await gen.next(); } catch { /* ok */ }

    // fetch 가 받은 FormData 검증
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0];
    const form = init?.body as FormData;
    expect(form.has("reference_image")).toBe(false);

    // meta JSON 의 useReferenceImage 도 false / 또는 미포함
    const metaStr = form.get("meta") as string;
    const meta = JSON.parse(metaStr);
    expect(meta.useReferenceImage).toBeFalsy();
    expect(meta.referenceRole).toBeUndefined();
  });

  it("multi-ref ON: FormData 에 reference_image + meta 포함", async () => {
    const gen = editImageStream({
      // Codex 3차 리뷰 fix: source/reference 모두 File 로 전달해 이미지 fetch call 과
      // /edit 생성 fetch call 이 섞이지 않게 함.
      sourceImage: new File([new Uint8Array([1])], "src.png", { type: "image/png" }),
      prompt: "test",
      lightning: false,
      useReferenceImage: true,
      referenceImage: new File([new Uint8Array([2])], "ref.png", { type: "image/png" }),
      referenceRole: "face",
    });
    try { await gen.next(); } catch { /* ok */ }

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0];
    const form = init?.body as FormData;

    expect(form.has("reference_image")).toBe(true);
    const metaStr = form.get("meta") as string;
    const meta = JSON.parse(metaStr);
    expect(meta.useReferenceImage).toBe(true);
    expect(meta.referenceRole).toBe("face");
  });
});

// ── EditLeftPanel CTA 비활성 동작 (간접 — store/derived 검증) ──
describe("EditLeftPanel CTA disabled (Codex 2차 리뷰 fix #4)", () => {
  it("multi-ref ON + referenceImage null → CTA 차단 조건 true", () => {
    useEditStore.setState({
      useReferenceImage: true,
      referenceImage: null,
    });
    const s = useEditStore.getState();
    // EditLeftPanel 의 ctaDisabled 조건:
    //   useReferenceImage && !referenceImage
    const blocked = s.useReferenceImage && !s.referenceImage;
    expect(blocked).toBe(true);
  });

  it("multi-ref ON + referenceImage 있음 → CTA 차단 false", () => {
    useEditStore.setState({
      useReferenceImage: true,
      referenceImage: "data:image/png;base64,xxx",
    });
    const s = useEditStore.getState();
    const blocked = s.useReferenceImage && !s.referenceImage;
    expect(blocked).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행**

Run: `npm test -- edit-multi-ref 2>&1 | tail -10`
Expected: `9 passed` (store 5 + FormData 2 + CTA 2)

- [ ] **Step 3: 전체 vitest**

Run: `npm test 2>&1 | tail -3`
Expected: `59 passed` (50 + 9 신규)

- [ ] **Step 4: Commit (사용자 승인 후만)**

```bash
# 사용자 "커밋해" 명시 후에만:
git add frontend/__tests__/edit-multi-ref.test.ts
git commit -m "test(edit): useEditStore + FormData + CTA 검증 (9건)"
```

---

## Phase 3: Frontend → Backend multipart 배선

목표: Frontend 가 reference 이미지 + role 을 multipart 로 백엔드에 전송. 백엔드는 받지만 dispatch 안 함 (Phase 4 까지).

### Task 10: lib/api/edit.ts 의 multipart 확장

**Files:**
- Modify: `frontend/lib/api/edit.ts`
- Modify: `frontend/lib/api/types.ts` (EditRequest 확장)
- Modify: `frontend/lib/api/client.ts` (`normalizeItem` referenceRef 정규화)

- [ ] **Step 1: types.ts 의 EditRequest 확장**

`frontend/lib/api/types.ts` 의 `EditRequest` interface 에 추가:

```typescript
export interface EditRequest {
  // ... 기존 필드들

  /** Multi-reference (2026-04-27): 두번째 이미지 토글 ON 시 사용 */
  useReferenceImage?: boolean;
  /** 두번째 이미지 — data URL 또는 File */
  referenceImage?: string | File | null;
  /** 사용자 명시 role — "face" | "outfit" | "style" | "background" | 자유 텍스트 */
  referenceRole?: string;
}
```

- [ ] **Step 1b: HistoryItem + normalizeItem 확장 (Codex 3차 리뷰 fix)**

> `history_db.py` 가 `referenceRef` / `referenceRole` 을 반환하므로 Frontend `HistoryItem`
> 타입도 같이 확장. `referenceRef` 는 `/images/studio/...` 상대 URL 로 올 수 있어
> `normalizeItem()` 에서 `imageRef` / `sourceRef` 와 같은 방식으로 절대 URL 정규화.

`frontend/lib/api/types.ts` 의 `HistoryItem` 에 추가:

```typescript
  /** Edit multi-reference: 참조 이미지 영구 URL (라이브러리 픽 케이스만). */
  referenceRef?: string | null;
  /** Edit multi-reference: reference role preset/custom text. */
  referenceRole?: string | null;
```

`frontend/lib/api/client.ts` 의 `normalizeItem()` 에 추가:

```typescript
    referenceRef: item.referenceRef
      ? normalizeImageRef(item.referenceRef)
      : item.referenceRef,
```

- [ ] **Step 2: editImageStream 의 multipart 빌드 확장**

`frontend/lib/api/edit.ts` 의 `editImageStream` 또는 `realEditStream` 함수의 FormData 빌드 부분:

```typescript
  // 기존 image 추가 후 reference 추가 (옵션)
  // Codex 리뷰: res.ok 체크 누락 fix — edit.ts:56-60 패턴과 동일 처리.
  if (req.useReferenceImage && req.referenceImage) {
    if (typeof req.referenceImage === "string") {
      try {
        const res = await fetch(req.referenceImage);
        if (!res.ok) {
          throw new Error(
            `image fetch ${res.status}: ${req.referenceImage.slice(0, 80)}`,
          );
        }
        const blob = await res.blob();
        form.append("reference_image", blob, "reference.png");
      } catch (err) {
        throw new Error(
          `참조 이미지 로드 실패: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      form.append("reference_image", req.referenceImage);
    }
  }

  form.append(
    "meta",
    JSON.stringify({
      prompt: req.prompt,
      lightning: req.lightning ?? false,
      ollamaModel: req.ollamaModel,
      visionModel: req.visionModel,
      // Multi-reference (Phase 3 신규)
      useReferenceImage: req.useReferenceImage ?? false,
      referenceRole: req.useReferenceImage ? req.referenceRole : undefined,
    }),
  );
```

- [ ] **Step 3: gen:types 갱신 (Codex 3차 리뷰 fix — 실제 실행 step 명시)**

> ⚠️ Backend Task 3 Step 7 에서 OpenAPI snapshot 을 먼저 갱신한 뒤 실행.
> route/multipart schema 변경이 generated 타입에 반영되도록 Backend → Frontend 순서 유지.

Run: `cd frontend && npm run gen:types`
Expected: 0 에러

- [ ] **Step 4: 검증 — tsc clean**

Run: `npx tsc --noEmit; echo EXIT=$?`
Expected: `EXIT=0`

- [ ] **Step 5: Commit (사용자 승인 후만)**

```bash
git add frontend/lib/api/edit.ts frontend/lib/api/types.ts frontend/lib/api/client.ts frontend/lib/api/openapi.json frontend/lib/api/generated.ts
git commit -m "feat(edit): editImageStream multipart 에 reference_image + role 추가"
```

### Task 11: useEditPipeline 에서 reference 전송

**Files:**
- Modify: `frontend/hooks/useEditPipeline.ts`

- [ ] **Step 1: store 구독 + EditRequest 에 reference 전달**

`frontend/hooks/useEditPipeline.ts` 의 store 구독:

```typescript
  const useReferenceImage = useEditStore((s) => s.useReferenceImage);
  const referenceImage = useEditStore((s) => s.referenceImage);
  const referenceRole = useEditStore((s) => s.referenceRole);
  const referenceRoleCustom = useEditStore((s) => s.referenceRoleCustom);
```

editImageStream 호출 시:

```typescript
  // Role 최종 문자열 — "custom" 이면 자유 텍스트, 아니면 preset id 그대로.
  const effectiveRole = referenceRole === "custom"
    ? (referenceRoleCustom.trim() || "general")
    : referenceRole;

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
    }),
    ...
  );
```

- [ ] **Step 2: 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean

- [ ] **Step 3: 토글 OFF 동작 검증 (수동)**

브라우저에서:
- 토글 OFF 상태로 일반 수정 한 번 — 정상 동작 확인 (옛 흐름)
- Network 탭에서 multipart 안에 reference_image / useReferenceImage 가 전송 안 되는지 확인

- [ ] **Step 4: Commit (사용자 승인 후만)**

```bash
git add frontend/hooks/useEditPipeline.ts
git commit -m "feat(edit): useEditPipeline 에서 reference 이미지 + role 전송"
```

---

## Phase 4: Backend ComfyUI multi-ref 노드 체인 + SYSTEM_EDIT 분기

목표: 진짜 multi-reference dispatch 동작. ComfyUI 가 image1 + image2 둘 다 받아서 처리. SYSTEM_EDIT 에 role-specific instruction 주입.

### Task 12: ROLE_INSTRUCTIONS 매핑 정의

**Files:**
- Modify: `backend/studio/prompt_pipeline.py`

- [ ] **Step 1: ROLE_INSTRUCTIONS 상수 + 헬퍼 추가**

`SYSTEM_EDIT` 정의 직후 (line 96 부근):

```python
# Multi-reference role 별 SYSTEM_EDIT 추가 instruction (2026-04-27).
# 사용자가 명시한 reference_role 에 따라 동적 주입 — Qwen Edit 가
# image2 의 어떤 측면을 참조로 사용할지 명확히.
ROLE_INSTRUCTIONS: dict[str, str] = {
    "face": (
        "Reference image (image2) provides FACE IDENTITY. "
        "Preserve facial structure, features, and expression from image2 "
        "while applying user's edit to the rest. Do not transfer makeup or hair "
        "unless user explicitly mentions."
    ),
    "outfit": (
        "Reference image (image2) provides CLOTHING/ACCESSORIES reference. "
        "Apply only the outfit, garments, or accessories from image2 onto the "
        "subject in image1. Keep face, pose, and background of image1."
    ),
    "style": (
        "Reference image (image2) provides STYLE REFERENCE — color palette, "
        "lighting tone, and mood. Match these aesthetics on image1 without "
        "altering the subject's identity or composition."
    ),
    "background": (
        "Reference image (image2) provides BACKGROUND/ENVIRONMENT reference. "
        "Replace or blend image1's background with the environment shown in "
        "image2, keeping the subject's pose and identity intact."
    ),
}


def build_reference_clause(reference_role: str | None) -> str:
    """role 별 SYSTEM_EDIT 추가 clause 빌드.

    - None / 빈 문자열: 빈 문자열 반환 (옛 동작 동일)
    - preset id 매칭: ROLE_INSTRUCTIONS 의 정의된 instruction
    - 알 수 없는 값 (자유 텍스트): "User-described role: {text}" 로 그대로 주입

    반환값은 SYSTEM_EDIT 의 끝에 \\n\\n 으로 append 됨.
    """
    if not reference_role:
        return ""
    preset = ROLE_INSTRUCTIONS.get(reference_role)
    if preset:
        return f"\n\nMULTI-REFERENCE MODE:\n{preset}"
    # 자유 텍스트 — 사용자 입력 그대로 전달 (악성 토큰 위험 낮음 · 길이 제한)
    safe_text = reference_role.strip()[:200]
    return (
        "\n\nMULTI-REFERENCE MODE:\n"
        f"Reference image (image2) provides: {safe_text}. "
        "Use this reference as guidance for the edit, "
        "applying to image1 the aspects implied by the user description."
    )
```

- [ ] **Step 2: upgrade_edit_prompt 시그니처에 reference_role 추가**

`upgrade_edit_prompt` 함수 (line 620 부근) 의 시그니처에 옵셔널 파라미터 추가:

```python
async def upgrade_edit_prompt(
    edit_instruction: str,
    image_description: str,
    model: str = "gemma4-un:latest",
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    include_translation: bool = True,
    *,
    analysis: Any = None,
    reference_role: str | None = None,
) -> UpgradeResult:
```

> ⚠️ **Codex 3차 리뷰 fix:** 기존 `include_translation: bool = True` 파라미터를 반드시 유지.
> `reference_role` 만 keyword-only 영역에 추가한다. 기존 positional/keyword 호출 호환성 보존.

함수 본문 안에서 SYSTEM_EDIT 사용 부분에 reference clause 추가:

```python
    system_with_ref = SYSTEM_EDIT + build_reference_clause(reference_role)
    # ... ollama 호출 시 system=system_with_ref 사용
```

(기존에 `system=SYSTEM_EDIT` 였던 부분을 `system=system_with_ref` 로 교체. 정확한 위치는 line 657 부근 — ollama_chat 호출.)

- [ ] **Step 3: 단위 테스트 — build_reference_clause**

`backend/tests/studio/test_multi_ref_edit.py` 에 추가:

```python
from studio.prompt_pipeline import build_reference_clause


def test_build_reference_clause_none_returns_empty():
    assert build_reference_clause(None) == ""
    assert build_reference_clause("") == ""


def test_build_reference_clause_face_preset():
    out = build_reference_clause("face")
    assert "MULTI-REFERENCE MODE" in out
    assert "FACE IDENTITY" in out


def test_build_reference_clause_custom_text():
    out = build_reference_clause("헤어스타일 참조")
    assert "MULTI-REFERENCE MODE" in out
    assert "헤어스타일 참조" in out


def test_build_reference_clause_truncates_long_text():
    long_text = "x" * 500
    out = build_reference_clause(long_text)
    # 200자 cap 검증
    assert len(out) < 1000
    assert "x" * 200 in out
```

- [ ] **Step 4: 테스트 실행**

Run: `cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/studio/test_multi_ref_edit.py -v`
Expected: `6 passed` (2 from Phase 1 + 4 신규)

- [ ] **Step 5: 전체 pytest**

Run: `D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `221 passed` (217 + 4)

- [ ] **Step 6: Commit (사용자 승인 후만)**

```bash
git add backend/studio/prompt_pipeline.py backend/tests/studio/test_multi_ref_edit.py
git commit -m "feat(edit): ROLE_INSTRUCTIONS + build_reference_clause + upgrade_edit_prompt 시그니처 확장"
```

### Task 13: vision_pipeline 에 reference_role 전달

**Files:**
- Modify: `backend/studio/vision_pipeline.py`

- [ ] **Step 1: run_vision_pipeline 시그니처에 reference_role 추가**

`backend/studio/vision_pipeline.py` 의 `run_vision_pipeline` 시그니처:

```python
async def run_vision_pipeline(
    image_path: Path | str | bytes,
    edit_instruction: str,
    vision_model: str = "gemma4-heretic:vision-q4km",
    text_model: str = "gemma4-un:latest",
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    *,
    width: int = 0,
    height: int = 0,
    reference_role: str | None = None,
) -> VisionPipelineResult:
```

- [ ] **Step 2: upgrade_edit_prompt 호출 시 reference_role 전달**

함수 본문의 `upgrade_edit_prompt(...)` 호출 부분 (line 514 부근):

```python
    upgrade = await upgrade_edit_prompt(
        edit_instruction=edit_instruction,
        image_description=upgrade_input,
        model=text_model,
        timeout=timeout,
        ollama_url=resolved_url,
        analysis=analysis if analysis_ok else None,
        reference_role=reference_role,
    )
```

- [ ] **Step 3: 검증**

Run: `cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `221 passed`

- [ ] **Step 4: Commit (사용자 승인 후만)**

```bash
git add backend/studio/vision_pipeline.py
git commit -m "feat(edit): run_vision_pipeline 에서 reference_role 을 upgrade 단계로 전달"
```

### Task 14: pipelines/edit.py 에서 reference 흐름 연결 (Codex 반영)

**Files:**
- Modify: `backend/studio/pipelines/_dispatch.py` — `_dispatch_to_comfy` 시그니처 확장
- Modify: `backend/studio/pipelines/edit.py` — reference 흐름 연결
- Modify: `backend/studio/comfy_api_builder.py` — `build_edit_from_request` 확장

> ⚠️ **Codex 리뷰 반영 (Critical):**
> 이전 plan 의 `comfy_transport.upload_image(...)` 형식은 틀림. 실제로는
> `ComfyUITransport.upload_image()` 가 *인스턴스 메서드* 이고 `_dispatch_to_comfy`
> 내부에서 단일 source 만 업로드함. `_dispatch_to_comfy` 에 `extra_uploads`
> 옵션을 추가해서 같은 GPU gate / ComfyUI session 안에서 source+reference 둘
> 다 업로드 + factory 에 두 filename 모두 넘기는 패턴으로 갱신.

> 🔴 **VRAM 회귀 방지 (2026-04-28 보강 · CLAUDE.md 🔴 Critical 규칙):**
> Edit pipeline 의 *기존* Ollama unload 호출 경로 (vision 분석 → unload → upgrade → unload → ComfyUI dispatch) 가 multi-ref 분기에서도 100% 보존되어야 함. 16GB VRAM 환경에서 unload 빠지면 qwen2.5vl + gemma4-un + ComfyUI Qwen Edit 동시 점유 → swap → ComfyUI sampling 매우 느려짐.
>
> **Step 4 검증 항목 (필수):** Multi-ref ON 케이스에서:
> 1. `vision_pipeline.run_vision_pipeline()` 직후 `ollama_unload.unload_model("qwen2.5vl:7b")` 호출되는가?
> 2. `prompt_pipeline.upgrade_edit_prompt()` 직후 `ollama_unload.unload_model("gemma4-un:latest")` 호출되는가?
> 3. `_dispatch_to_comfy()` 가 호출 직전 `force_unload_all_loaded_models()` 호출되는가?
>
> 셋 중 하나라도 multi-ref 분기에서 빠지면 *반드시 추가*. 옛 single 흐름 코드를 그대로 따라가면 자동 보존되지만, role 분기 / extra_uploads 추가 시 실수로 빠질 위험 있음. **테스트로도 검증** — Step 4b 의 `_make_edit_prompt` 단위 테스트와 별개로, multi-ref pipeline 통합 테스트에서 unload 호출 횟수 assert.

- [ ] **Step 1: `_dispatch_to_comfy` 에 `extra_uploads` 파라미터 추가**

`backend/studio/pipelines/_dispatch.py` 의 `_dispatch_to_comfy` 시그니처 + 본문 확장:

```python
async def _dispatch_to_comfy(
    task: "Task",
    api_prompt_factory: Callable[..., dict[str, Any]],  # ← 가변 인자로 확장
    *,
    mode: str,
    progress_start: int,
    progress_span: int,
    client_prefix: str = "ais",
    upload_bytes: bytes | None = None,
    upload_filename: str | None = None,
    # Multi-ref (2026-04-27): 추가 업로드 (현재는 1건만 — reference). 미래 확장 가능.
    extra_uploads: list[tuple[bytes, str]] | None = None,
    save_output: SaveOutputFn | None = None,
    idle_timeout: float = 1200.0,
    hard_timeout: float = 7200.0,
) -> ComfyDispatchResult:
```

본문 안에서 source 업로드 직후 extra 업로드 + factory 호출 변경:

> ⚠️ **Codex 2차 리뷰 fix #2:** factory 호출 시 `extra_uploaded_names` keyword 를
> *항상* 넘기면 기존 generate / video factory (positional `(uploaded_name)` 만 받음)
> 가 깨짐. **`extra_uploads` 가 있을 때만 keyword 전달** 패턴으로 분기.

```python
        async with ComfyUITransport() as comfy:
            uploaded_name: str | None = None
            if upload_bytes is not None:
                uploaded_name = await comfy.upload_image(
                    upload_bytes, upload_filename or "input.png"
                )
            # Multi-ref: extra 업로드 (있으면 순차) — extra_uploads None 이면 옛 흐름.
            if extra_uploads:
                extra_uploaded_names: list[str] = []
                for extra_bytes, extra_filename in extra_uploads:
                    extra_name = await comfy.upload_image(
                        extra_bytes, extra_filename or "extra.png"
                    )
                    extra_uploaded_names.append(extra_name)
                # 새 factory 시그니처 — keyword extra_uploaded_names 받음
                api_prompt = api_prompt_factory(
                    uploaded_name, extra_uploaded_names=extra_uploaded_names,
                )
            else:
                # 옛 factory 시그니처 — positional 1개만. Generate / Video 영향 0.
                api_prompt = api_prompt_factory(uploaded_name)
            ...  # 기존 흐름 그대로
```

> ✅ **회귀 안전성:** `extra_uploads=None` (기본) 이면 옛 호출 path 100% 동일.
> Generate / Video 의 factory 는 positional `(uploaded_name)` 그대로 받음.
> Edit 의 새 factory 만 keyword-only `extra_uploaded_names` 추가 받음.

- [ ] **Step 1b (회귀 테스트 신규):** Codex 2차 리뷰 추가 요구

`backend/tests/studio/test_dispatch_extra_uploads.py` (**NEW**) — `_dispatch_to_comfy` 의 factory 호출 분기 단위 테스트:

```python
"""_dispatch_to_comfy 의 factory 호출 분기 회귀 테스트.

extra_uploads=None 이면 옛 (positional 1개) factory 형태가 깨지지 않아야 하고,
extra_uploads 가 있으면 새 (keyword) factory 형태가 정확히 호출돼야 함.

ComfyUITransport 자체는 mock — 실 ComfyUI 무관 단위 테스트.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from studio.pipelines._dispatch import _dispatch_to_comfy


@pytest.mark.asyncio
async def test_factory_called_positional_when_no_extra_uploads():
    """기존 generate/video factory 시그니처 회귀 검증."""
    # factory 가 positional 1개만 받는 옛 시그니처 시뮬레이션
    factory = MagicMock(return_value={"node1": {"class_type": "Test"}})
    task = AsyncMock()

    async def _empty_listen(*args, **kwargs):
        if False:
            yield None

    async def _save_output(_comfy, _prompt_id, _mode):
        return ("/images/studio/test.png", 1, 1)

    with patch(
        "studio.pipelines._dispatch.ComfyUITransport"
    ) as TransportCls, patch(
        "studio.pipelines._dispatch.acquire_gpu_slot", new=AsyncMock()
    ), patch(
        # Codex 3차 리뷰 fix: release_gpu_slot 은 sync 함수라 MagicMock 사용.
        "studio.pipelines._dispatch.release_gpu_slot", new=MagicMock()
    ), patch(
        "studio.pipelines._dispatch._ensure_comfyui_ready", new=AsyncMock()
    ), patch(
        "studio.pipelines._dispatch.ollama_unload.force_unload_all_loaded_models",
        new=AsyncMock(),
    ):
        comfy = AsyncMock()
        comfy.upload_image = AsyncMock(return_value="src.png")
        comfy.submit = AsyncMock(return_value="prompt-id")
        # Codex 3차 리뷰 fix: listen 은 async iterator 여야 함.
        comfy.listen = _empty_listen
        TransportCls.return_value.__aenter__.return_value = comfy
        TransportCls.return_value.__aexit__.return_value = None

        # extra_uploads None — 옛 factory 호출 path
        await _dispatch_to_comfy(
            task,
            factory,
            mode="edit",
            progress_start=10,
            progress_span=80,
            upload_bytes=b"x",
            upload_filename="src.png",
            extra_uploads=None,
            save_output=_save_output,
        )

    # factory 가 positional 1개로 호출됐는지 — keyword extra_uploaded_names 없음
    factory.assert_called_once_with("src.png")
    # 호출 kwargs 가 비어있어야 함 (옛 시그니처와 호환)
    args, kwargs = factory.call_args
    assert "extra_uploaded_names" not in kwargs


@pytest.mark.asyncio
async def test_factory_called_with_extra_when_uploads_present():
    """extra_uploads 가 있으면 keyword extra_uploaded_names 가 정확히 전달."""
    factory = MagicMock(return_value={"node1": {"class_type": "Test"}})
    task = AsyncMock()

    async def _empty_listen(*args, **kwargs):
        if False:
            yield None

    async def _save_output(_comfy, _prompt_id, _mode):
        return ("/images/studio/test.png", 1, 1)

    with patch(
        "studio.pipelines._dispatch.ComfyUITransport"
    ) as TransportCls, patch(
        "studio.pipelines._dispatch.acquire_gpu_slot", new=AsyncMock()
    ), patch(
        # Codex 3차 리뷰 fix: release_gpu_slot 은 sync 함수라 MagicMock 사용.
        "studio.pipelines._dispatch.release_gpu_slot", new=MagicMock()
    ), patch(
        "studio.pipelines._dispatch._ensure_comfyui_ready", new=AsyncMock()
    ), patch(
        "studio.pipelines._dispatch.ollama_unload.force_unload_all_loaded_models",
        new=AsyncMock(),
    ):
        comfy = AsyncMock()
        # 첫 호출 = src, 두번째 = ref
        comfy.upload_image = AsyncMock(side_effect=["src.png", "ref.png"])
        comfy.submit = AsyncMock(return_value="prompt-id")
        # Codex 3차 리뷰 fix: listen 은 async iterator 여야 함.
        comfy.listen = _empty_listen
        TransportCls.return_value.__aenter__.return_value = comfy
        TransportCls.return_value.__aexit__.return_value = None

        await _dispatch_to_comfy(
            task,
            factory,
            mode="edit",
            progress_start=10,
            progress_span=80,
            upload_bytes=b"x",
            upload_filename="src.png",
            extra_uploads=[(b"y", "ref.png")],
            save_output=_save_output,
        )

    # factory 호출 검증 — positional 1 + keyword extra_uploaded_names
    args, kwargs = factory.call_args
    assert args == ("src.png",)
    assert kwargs == {"extra_uploaded_names": ["ref.png"]}
```

이 테스트는 `_dispatch_to_comfy` 변경 직후 즉시 실행해서 옛/새 factory 둘 다 보장.

- [ ] **Step 1c: 회귀 테스트 실행**

Run: `cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/studio/test_dispatch_extra_uploads.py -v`
Expected: `2 passed`

- [ ] **Step 2: vision pipeline 호출에 reference_role 전달**

`pipelines/edit.py` 안에서:

```python
        vision_result = await run_vision_pipeline(
            image_bytes,
            edit_instruction=prompt,
            vision_model=vision_model_override or DEFAULT_OLLAMA_ROLES.vision,
            text_model=ollama_model_override or DEFAULT_OLLAMA_ROLES.text,
            width=source_width,
            height=source_height,
            reference_role=reference_role,
        )
```

- [ ] **Step 3: `build_edit_from_request` 시그니처 + factory 확장**

`comfy_api_builder.py` 의 `build_edit_from_request`:

```python
def build_edit_from_request(
    *,
    prompt: str,
    source_filename: str,
    seed: int,
    lightning: bool,
    reference_image_filename: str | None = None,
    reference_role: str | None = None,
) -> ApiPrompt:
    """기존과 동일 + reference 파라미터. Phase 1 의 build_edit_api 분기로 자동 전달."""
    inp = EditApiInput(
        # ... 기존 필드 모두 그대로
        reference_image_filename=reference_image_filename,
        reference_role=reference_role,
    )
    return build_edit_api(inp)
```

- [ ] **Step 4: `pipelines/edit.py` 의 _dispatch_to_comfy 호출 갱신**

```python
        # Reference 이미지가 있으면 extra_uploads 로 전달.
        # ⚠️ Backend 게이트: reference_bytes 가 None 이면 reference_role 도 None 강제.
        #    (zero-regression — 라우트에서 누수 방지 + Codex 리뷰 항목)
        effective_role = reference_role if reference_bytes is not None else None

        extra_uploads_list: list[tuple[bytes, str]] | None = None
        if reference_bytes is not None and reference_filename:
            extra_uploads_list = [(reference_bytes, reference_filename)]

        def _make_edit_prompt(
            uploaded_name: str | None,
            *,
            extra_uploaded_names: list[str] | None = None,
        ) -> dict[str, Any]:
            ref_uploaded = (
                extra_uploaded_names[0]
                if extra_uploaded_names and extra_uploaded_names
                else None
            )
            return build_edit_from_request(
                prompt=vision_result.final_prompt,
                source_filename=uploaded_name or "input.png",
                seed=actual_seed,
                lightning=lightning,
                reference_image_filename=ref_uploaded,
                reference_role=effective_role,
            )

        dispatch = await _dispatch_to_comfy(
            task,
            _make_edit_prompt,
            mode="edit",
            progress_start=...,
            progress_span=...,
            client_prefix="ais-e",
            upload_bytes=image_bytes,
            upload_filename=filename,
            extra_uploads=extra_uploads_list,
        )
```

(progress_start/span 등은 기존 edit pipeline 의 값 그대로)

- [ ] **Step 4b: `_make_edit_prompt` 단위 테스트 (Codex 2차 리뷰 추가)**

`backend/tests/studio/test_multi_ref_edit.py` 에 추가:

```python
def test_make_edit_prompt_passes_extra_upload_to_builder():
    """edit pipeline 의 _make_edit_prompt factory 가 extra_uploaded_names[0] 을
    build_edit_from_request 의 reference_image_filename 으로 정확히 전달."""
    from studio.comfy_api_builder import build_edit_from_request

    # build_edit_from_request 직접 호출로 검증 (factory 는 단순 wrapper)
    api = build_edit_from_request(
        prompt="test",
        source_filename="src.png",
        seed=1,
        lightning=False,
        reference_image_filename="ref.png",
        reference_role="face",
    )

    # multi-ref path 로 분기됐는지 — LoadImage 노드 2개 (src + ref)
    load_nodes = [n for n in api.values() if n["class_type"] == "LoadImage"]
    assert len(load_nodes) == 2
    image_inputs = [n["inputs"]["image"] for n in load_nodes]
    assert "src.png" in image_inputs
    assert "ref.png" in image_inputs


def test_make_edit_prompt_no_extra_returns_single_path():
    """extra_uploaded_names 가 비어있으면 단일 path (LoadImage 1개)."""
    from studio.comfy_api_builder import build_edit_from_request

    api = build_edit_from_request(
        prompt="test",
        source_filename="src.png",
        seed=1,
        lightning=False,
        reference_image_filename=None,
        reference_role=None,
    )

    load_nodes = [n for n in api.values() if n["class_type"] == "LoadImage"]
    assert len(load_nodes) == 1
```

Run: `cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/studio/test_multi_ref_edit.py -v`
Expected: 2 신규 + 기존 통과

- [ ] **Step 5: history item 저장 — referenceRef 의미 확정**

> ⚠️ **Codex 리뷰 반영:** `referenceRef` DB 컬럼 의미 = *영구 URL only*. Phase 5
> (이 plan) 에서는 *임시 ComfyUI dispatch filename* 을 *DB 에 저장하지 않음*.
> 임시 filename 은 dispatch 안에서만 살고 끝. 영구 URL 은 Phase 6 라이브러리에서만.

```python
        item = {
            # ... 기존 필드 모두
            # 라이브러리 픽 케이스 (Phase 6) 가 아니면 None.
            # Phase 5 단계에선 항상 None — 라이브러리 영구 URL 가 없음.
            "referenceRef": None,
            "referenceRole": effective_role,
        }
```

- [ ] **Step 6: 검증**

Run: `cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `221 passed`

- [ ] **Step 7: Commit (사용자 승인 후만)**

```bash
git add backend/studio/pipelines/_dispatch.py backend/studio/pipelines/edit.py backend/studio/comfy_api_builder.py
git commit -m "feat(edit): _dispatch_to_comfy extra_uploads + edit reference 배선 + role 게이트"
```

### Task 15: _build_edit_api_multi_ref 진짜 노드 체인 작성

**Files:**
- Modify: `backend/studio/comfy_api_builder.py`

- [ ] **Step 1: stub 을 실제 multi-ref 노드 체인으로 교체**

`_build_edit_api_multi_ref` 함수를 옛 `_build_edit_api_single` 에서 시작해 image2 노드 추가:

```python
def _build_edit_api_multi_ref(v: EditApiInput) -> ApiPrompt:
    """Multi-reference 흐름 — image1 + image2 둘 다 LoadImage + FluxKontextImageScale.

    TextEncodeQwenImageEditPlus 의 image1/image2 슬롯 둘 다 채움.
    KSampler latent 는 image1 (편집 대상) 만 별도 VAEEncode.
    image2 는 TextEncodeQwenImageEditPlus 내부에서 vae 인자로 reference latent 자동 인코딩
    (ComfyUI 의 Qwen Edit Plus 노드 동작 — Codex 리뷰 검증).
    """
    api: ApiPrompt = {}
    nid = _make_id_gen()

    # Loaders (공통 헬퍼)
    unet_id, clip_id, vae_id = _build_loaders(
        api, nid,
        unet_name=v.unet_name, clip_name=v.clip_name, vae_name=v.vae_name,
    )

    # Image1 (편집 대상) — LoadImage + FluxKontextImageScale
    load1_id = nid()
    api[load1_id] = {
        "class_type": "LoadImage",
        "inputs": {"image": v.source_image_filename, "upload": "image"},
    }
    scale1_id = nid()
    api[scale1_id] = {
        "class_type": "FluxKontextImageScale",
        "inputs": {"image": [load1_id, 0]},
    }

    # Image2 (참조) — 동일 패턴.
    # reference_image_filename 은 None 이 아닌 게 보장됨 (build_edit_api 분기에서).
    assert v.reference_image_filename is not None
    load2_id = nid()
    api[load2_id] = {
        "class_type": "LoadImage",
        "inputs": {"image": v.reference_image_filename, "upload": "image"},
    }
    scale2_id = nid()
    api[scale2_id] = {
        "class_type": "FluxKontextImageScale",
        "inputs": {"image": [load2_id, 0]},
    }

    # Model chain (단일 path 와 동일)
    model_ref = _build_lora_chain(
        api, nid,
        base_model=[unet_id, 0],
        lightning=v.lightning,
        lightning_lora_name=v.lightning_lora_name,
        extra_loras=v.extra_loras,
    )
    model_ref = _apply_model_sampling(api, nid, model_ref=model_ref, shift=v.shift)
    cfgnorm_id = nid()
    api[cfgnorm_id] = {
        "class_type": "CFGNorm",
        "inputs": {"model": model_ref, "strength": 1.0},
    }
    model_ref = [cfgnorm_id, 0]

    # TextEncodeQwenImageEditPlus × 2 (pos+neg) — image1 + image2 둘 다 슬롯에 연결.
    pos_enc_id = nid()
    api[pos_enc_id] = {
        "class_type": "TextEncodeQwenImageEditPlus",
        "_meta": {"title": "Positive"},
        "inputs": {
            "clip": [clip_id, 0],
            "vae": [vae_id, 0],
            "image1": [scale1_id, 0],
            "image2": [scale2_id, 0],
            "prompt": v.prompt,
        },
    }
    neg_enc_id = nid()
    api[neg_enc_id] = {
        "class_type": "TextEncodeQwenImageEditPlus",
        "_meta": {"title": "Negative"},
        "inputs": {
            "clip": [clip_id, 0],
            "vae": [vae_id, 0],
            "image1": [scale1_id, 0],
            "image2": [scale2_id, 0],
            "prompt": "",
        },
    }

    # FluxKontextMultiReferenceLatentMethod × 2 (단일 path 와 동일)
    pos_ref_id = nid()
    api[pos_ref_id] = {
        "class_type": "FluxKontextMultiReferenceLatentMethod",
        "inputs": {
            "conditioning": [pos_enc_id, 0],
            "reference_latents_method": "index_timestep_zero",
        },
    }
    neg_ref_id = nid()
    api[neg_ref_id] = {
        "class_type": "FluxKontextMultiReferenceLatentMethod",
        "inputs": {
            "conditioning": [neg_enc_id, 0],
            "reference_latents_method": "index_timestep_zero",
        },
    }

    # VAEEncode — KSampler latent 는 image1 만. (image2 는 TextEncode 내부에서 reference 인코딩)
    encode_id = nid()
    api[encode_id] = {
        "class_type": "VAEEncode",
        "inputs": {"pixels": [scale1_id, 0], "vae": [vae_id, 0]},
    }

    # KSampler + VAEDecode + SaveImage (단일 path 와 동일)
    ksam_id = nid()
    api[ksam_id] = {
        "class_type": "KSampler",
        "inputs": {
            "seed": int(v.seed),
            "steps": int(v.steps),
            "cfg": float(v.cfg),
            "sampler_name": v.sampler,
            "scheduler": v.scheduler,
            "denoise": 1.0,
            "model": model_ref,
            "positive": [pos_ref_id, 0],
            "negative": [neg_ref_id, 0],
            "latent_image": [encode_id, 0],
        },
    }

    decode_id = nid()
    api[decode_id] = {
        "class_type": "VAEDecode",
        "inputs": {"samples": [ksam_id, 0], "vae": [vae_id, 0]},
    }

    save_id = nid()
    api[save_id] = {
        "class_type": "SaveImage",
        "inputs": {
            "images": [decode_id, 0],
            "filename_prefix": v.filename_prefix,
        },
    }

    return api
```

- [ ] **Step 2: Phase 1 의 Phase 1 stub 테스트 갱신 — multi-ref 가 진짜 노드 추가하는지 확인**

`backend/tests/studio/test_multi_ref_edit.py` 의 `test_reference_filename_with_stub_returns_same_as_single` 를 갱신:

```python
def test_reference_returns_extra_load_image_node():
    """Phase 4: multi-ref 케이스는 LoadImage 노드가 2개 (image1 + image2).
    
    옛 stub 테스트를 진짜 검증으로 교체."""
    inp_single = _make_input(reference_filename=None)
    inp_multi = _make_input(reference_filename="ref.png", reference_role="face")

    api_single = build_edit_api(inp_single)
    api_multi = build_edit_api(inp_multi)

    load_count_single = sum(
        1 for n in api_single.values() if n["class_type"] == "LoadImage"
    )
    load_count_multi = sum(
        1 for n in api_multi.values() if n["class_type"] == "LoadImage"
    )

    assert load_count_single == 1
    assert load_count_multi == 2

    scale_count_multi = sum(
        1 for n in api_multi.values() if n["class_type"] == "FluxKontextImageScale"
    )
    assert scale_count_multi == 2

    # TextEncodeQwenImageEditPlus 의 image2 슬롯에도 연결됐는지
    encode_nodes = [
        n for n in api_multi.values()
        if n["class_type"] == "TextEncodeQwenImageEditPlus"
    ]
    assert len(encode_nodes) == 2  # pos + neg
    for enc in encode_nodes:
        assert "image1" in enc["inputs"]
        assert "image2" in enc["inputs"]
```

- [ ] **Step 3: 테스트 실행**

Run: `cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/studio/test_multi_ref_edit.py -v`
Expected: `7 passed` (1 갱신 + 6 기존)

- [ ] **Step 4: 전체 pytest**

Run: `D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q`
Expected: `222 passed` (221 + 1 신규)

- [ ] **Step 5: Commit (사용자 승인 후만)**

```bash
git add backend/studio/comfy_api_builder.py backend/tests/studio/test_multi_ref_edit.py
git commit -m "feat(edit): _build_edit_api_multi_ref 진짜 노드 체인 (image1+image2 슬롯)"
```

---

## Phase 5: 통합 검증 + 문서화

### Task 16: 실제 ComfyUI 로 multi-ref 케이스 1회 검증 (수동)

이 태스크는 자동화 없음 — 사용자가 브라우저에서 직접 테스트.

- [ ] **Step 1: backend 재시작**

토글 OFF 상태로 평소 수정 한 번 — 옛 동작 그대로 보장 확인.

- [ ] **Step 2: 토글 ON + 두번째 이미지 + role=face 케이스**

브라우저에서:
1. 원본 이미지 업로드
2. "🖼️ 참조 이미지 사용" 토글 ON
3. 두번째 이미지 업로드 (다른 사람 얼굴)
4. role chip = "👤 얼굴"
5. 프롬프트 = "make this person smile"
6. [수정 생성] 클릭
7. 결과 확인 — 얼굴이 reference 의 얼굴로 일관성 있게 유지되는지

- [ ] **Step 3: role 별 케이스 테스트 (각 1회)**

각 role 셋 동안 1회 테스트:
- outfit: 의상만 차용
- style: 스타일/색감
- background: 배경 교체
- custom: "헤어스타일 참조"

각 케이스 결과 스크린샷 보관.

- [ ] **Step 4: 결과 평가 표 작성**

`docs/superpowers/specs/2026-04-27-edit-multi-reference-results.md` (수동):

```markdown
# Multi-Reference Edit 검증 결과 (2026-04-27)

| Role | 입력 케이스 | 결과 품질 (1-5) | 코멘트 |
|------|-------------|----------------|--------|
| face | smile | _ | _ |
| outfit | red dress | _ | _ |
| style | warm tone | _ | _ |
| background | beach | _ | _ |
| custom | "hair color blue" | _ | _ |
```

각 role 의 품질이 *acceptable* (>= 3/5) 이어야 ON 추천. 미만이면 SYSTEM_EDIT 의 ROLE_INSTRUCTIONS 추가 튜닝 필요.

### Task 17: 문서 업데이트

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/changelog.md`

- [ ] **Step 1: CLAUDE.md 의 Edit 모드 섹션에 multi-ref 안내**

`CLAUDE.md` 의 "수정 모드 — Qwen Image Edit 2511" 섹션 끝에 추가:

```markdown
- **Multi-reference 토글** (2026-04-27): 두번째 이미지 + role 명시 옵션.
  TextEncodeQwenImageEditPlus 의 image1/image2 슬롯 활용. role preset:
  face/outfit/style/background/custom (자유 텍스트). store useEditStore 의
  useReferenceImage=true 일 때만 활성, OFF 면 옛 단일 이미지 흐름 100% 동일.
  SYSTEM_EDIT 에 ROLE_INSTRUCTIONS 동적 주입 (`prompt_pipeline.build_reference_clause`).
```

- [ ] **Step 2: docs/changelog.md 추가**

최상단 (`## 2026-04-27` 섹션 안) 에 추가:

```markdown
- **Edit Multi-Reference** (`claude/edit-multi-ref` · 신규). 두번째 이미지 (참조)
  + role 토글 기능. 토글 OFF 면 옛 단일 흐름 100% 동일 (회귀 위험 0). ON 시
  TextEncodeQwenImageEditPlus 의 image2 슬롯 활성 + ROLE_INSTRUCTIONS 5개
  preset (face/outfit/style/background/custom). DB schema v6→v7
  (reference_ref + reference_role). pytest 222 / vitest 55 / tsc / lint clean.
```

- [ ] **Step 3: Commit (사용자 승인 후만)**

```bash
git add CLAUDE.md docs/changelog.md
git commit -m "docs(edit): multi-reference 토글 + role 안내 + changelog"
```

### Task 18: 최종 검증 + master merge

- [ ] **Step 1: 전체 회귀 검증**

```bash
cd backend && D:/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ -q
cd ../frontend && npx tsc --noEmit && npm run lint && npm test
```

Expected:
- pytest: `222 passed`
- vitest: `55 passed`
- tsc: clean
- lint: clean

- [ ] **Step 2: 토글 OFF 회귀 시각 검증 (수동)**

브라우저에서 토글 OFF 상태로 옛 단일 수정 흐름 1회 — 결과 + 진행 모달 + 히스토리 동일 동작 확인.

- [ ] **Step 3: master 머지 (별도 승인 후)**

> ⚠️ **AGENTS 규칙 (Codex 2차 리뷰 fix #9):** master merge / push 는 *별도 사용자 승인* 후만 수행. 자동 실행 X. 아래 명령어는 *예시*.

```bash
# 사용자 "master 머지 + 푸시" 명시 후에만:
git checkout master
git merge --no-ff claude/edit-multi-ref -m "Merge branch 'claude/edit-multi-ref': Edit 모드 multi-reference 토글 + role"
git push origin master
```

---

## ⏸️ Phase 6 (Reference Template Library) — 별도 plan 분리

이 plan 의 Phase 6 (라이브러리) 은 **별도 plan 으로 분리됨** (Codex 리뷰 권장).

→ **`docs/superpowers/plans/2026-04-27-edit-reference-library.md`** 참조

진입 조건 (Phase 1-5 머지 후 안정화 검증):
1. 같은 reference 이미지 재업로드 케이스 발견 (2회+)
2. role 별 결과 품질 평균 ≥ 3/5
3. 사용자 명시적 "라이브러리 추가" 결정

---

## Self-Review (Codex 2차 리뷰 반영 · 2026-04-27)

### 1. Spec coverage

| 요구사항 | 구현 태스크 |
|---------|-----------|
| 토글 (default OFF) | Task 6 (store) + Task 8 (UI) |
| 두번째 이미지 추가 | Task 8 (UI) + Task 10 (multipart) + Task 14 (backend dispatch) |
| Role 명시 (preset 5개) | Task 7 (컴포넌트) + Task 8 (조립) |
| SYSTEM_EDIT 동적 분기 | Task 12 (ROLE_INSTRUCTIONS + build_reference_clause) |
| vision 분석 image1 만 | Task 13 (run_vision_pipeline 시그니처만 추가, image2 분석 X) |
| Phase 단계 분리 + 중간 텀 | Phase 1-5 + ⏸️ Phase 6 별도 plan 분리 |
| 옛 흐름 회귀 0 | Task 2 (early return) + Task 3 (backend role 게이트) + Task 5 (회귀 베이스라인 테스트) |
| DB 마이그레이션 v6→v7 (refined_intent 보존) | Task 4 |
| Multi-image 업로드 dispatch | Task 14 (`_dispatch_to_comfy.extra_uploads` + 분기 호출) |
| Paste 충돌 방지 (Codex 2차 fix #3) | Task 7b (SourceImageCard pasteRequireHover) + Task 8 Step 4 |
| useReferenceImage=true + no file 거부 (fix #4) | Task 3 Step 3 (백엔드 400) + Task 8 Step 5 (프론트 CTA 비활성) |

### 2. Type consistency

- `ReferenceRoleId` = `"face" | "outfit" | "style" | "background" | "custom"` — Task 6 정의, Task 7-11 일관 사용
- `reference_image_filename` (snake_case Python · ComfyUI dispatch filename) ↔ `referenceImage` (camelCase TS · data URL/File) — 다른 의미 명확 구분
- `reference_role` (snake) ↔ `referenceRole` (camel) — JSON 매핑 layer 에서 변환
- `referenceRef` DB 컬럼 = 영구 URL only (Phase 5 = None / Phase 6 = `/images/studio/reference-templates/...`)

### 3. 남은 우려 (실 코드 작업 시 검증 필요)

- Task 4 의 INSERT SQL — 작업 시 `history_db.py` 의 실 INSERT 컬럼 순서/값을 *읽어서* 그 base 로 두 컬럼만 추가. plan 의 가이드 그대로 복붙 X.
- Task 14 의 progress_start/progress_span — 기존 edit pipeline 코드의 값 그대로 유지.
- Task 15 의 새 노드 체인 — 실 ComfyUI 에서 dispatch 검증 필요 (수동).

---

## Revision Summary (Codex 2차 리뷰 반영 — 2026-04-27 후속2)

| # | Codex 2차 리뷰 항목 | 반영 위치 | 상태 |
|---|---------------------|----------|------|
| 1 | EditApiInput 파일 경로 (`presets.py` → `comfy_api_builder.py`) | Task 1 헤더 + Step 2 | ✅ |
| 2 | `_dispatch_to_comfy` extra_uploads — 분기 호출 패턴 + 회귀 테스트 | Task 14 Step 1 + 신규 Step 1b/1c | ✅ |
| 2-회귀 | 회귀 테스트 — 옛 generate/video factory 영향 0 | Task 14 Step 1b (`test_dispatch_extra_uploads.py`) | ✅ |
| 2-multi | 회귀 테스트 — extra upload filename 이 build_edit_from_request 로 전달 | Task 14 Step 4b | ✅ |
| 3 | SourceImageCard `pasteRequireHover?: boolean` prop | 신규 Task 7b 전체 | ✅ |
| 3-MultiON | Multi-ref ON 시 두 카드 모두 hover 모드 | Task 7b + Task 8 Step 4 | ✅ |
| 3-test | 관련 frontend 테스트 (`source-image-card-paste.test.ts`) | Task 7b Step 4 | ✅ |
| 4 | `useReferenceImage=true` + no `reference_image` 검증 (백엔드 400) | Task 3 Step 3 (게이트 코드 추가) | ✅ |
| 4-frontend | 프론트 CTA 비활성 / warning | Task 8 Step 5 | ✅ |
| 4-test | 관련 백엔드/프론트 테스트 | Task 3 Step 8 + Task 9 신규 describe blocks | ✅ |
| 5 | (라이브러리 plan) referenceRef 저장 흐름 보강 | (별도 plan 갱신) | ✅ |
| 6 | (라이브러리 plan) URL 정규화 helper 추가 | (별도 plan 갱신) | ✅ |
| 7 | (라이브러리 plan) router 등록 → `routes/__init__.py` | (별도 plan 갱신) | ✅ |
| 8 | OpenAPI/typegen 순서 보강 | Task 3 Step 7 (OpenAPI 갱신 타이밍 명시) + Phase 3 진입 시 `npm run gen:types` 명시 | ✅ |
| 9 | Commit/merge/push → "사용자 승인 후" | 모든 commit step 헤더 일괄 갱신 + master merge step | ✅ |

### Codex 3차 보강 코멘트

| # | 보강 항목 | 반영 위치 | 상태 |
|---|----------|----------|------|
| 3-1 | 상단 File Structure 의 `presets.py` 잔존 오기 제거 | File Structure / Architecture | ✅ |
| 3-2 | `upgrade_edit_prompt` 기존 `include_translation` 파라미터 보존 | Task 12 Step 2 | ✅ |
| 3-3 | FormData 테스트가 image fetch call 과 `/edit` call 을 혼동하지 않도록 File 사용 | Task 9 FormData 테스트 | ✅ |
| 3-4 | `_dispatch_to_comfy` 테스트에서 sync `release_gpu_slot` 은 MagicMock, `listen` 은 async iterator stub 사용 | Task 14 Step 1b | ✅ |
| 3-5 | route 테스트를 repo 패턴인 `AsyncClient + ASGITransport` 로 정렬 | Task 3 Step 8 | ✅ |
| 3-6 | SourceImageCard paste 테스트를 단순 truthy 검증 → `StudioUploadSlot` prop assert 로 강화 | Task 7b Step 4 | ✅ |
| 3-7 | `HistoryItem.referenceRef/referenceRole` + `normalizeItem(referenceRef)` 명시 | Task 10 Step 1b | ✅ |
| 3-8 | `npm run gen:types` 를 Phase 3 의 실제 실행 step 으로 명시 | Task 10 Step 3 | ✅ |

### 추가 테스트 매트릭스 (Codex 2차 리뷰 요구)

| 케이스 | 위치 | 상태 |
|--------|------|------|
| Backend: `useReferenceImage=true` + no file → 400 | Task 3 Step 8 | ✅ |
| Backend: `reference_role` 은 reference_bytes 있을 때만 pipeline 전달 | Task 3 Step 8 (`test_edit_endpoint_role_ignored_when_useref_false`) | ✅ |
| Backend: `_dispatch_to_comfy` 기존 호출자 회귀 0 | Task 14 Step 1b | ✅ |
| Backend: multi-ref build 결과 LoadImage 2개 / Scale 2개 / image1+image2 슬롯 | Task 14 Step 4b + Task 15 의 갱신 테스트 | ✅ |
| Backend: history row referenceRef/referenceRole round-trip | Task 4 (이미 _row_to_item 매핑 명시) | ✅ |
| Frontend: multi-ref OFF → FormData 에 `reference_image` 없음 | Task 9 신규 describe (`editImageStream - FormData 검증`) | ✅ |
| Frontend: multi-ref ON → FormData 에 `reference_image` + meta 포함 | Task 9 신규 describe | ✅ |
| Frontend: ON 인데 referenceImage 없음 → CTA 차단 | Task 9 신규 describe (`EditLeftPanel CTA disabled`) | ✅ |
| Frontend: library template imageRef 정규화 | (별도 plan) | ✅ |
| Frontend: library pick 후 edit request meta 에 referenceRef/templateId 전달 | (별도 plan) | ✅ |

---

## Execution Handoff

Plan complete and saved to:
- **Multi-reference 본 plan**: `docs/superpowers/plans/2026-04-27-edit-multi-reference.md` (이 파일)
- **Phase 6 라이브러리 별도 plan**: `docs/superpowers/plans/2026-04-27-edit-reference-library.md`

**총 19 task / 5 phase / ~7-9h** (Codex 2차 추가 항목 포함 약간 증가).

**Verdict (Codex 3차 보강 후):**

✅ **Ready for implementation** (단, 실제 작업 중 Task 4 INSERT SQL 과 Task 14 progress 값은 실 코드 확인 후 적용)

이번 갱신에서 Codex 2차 리뷰의 9개 항목 + Codex 3차 보강 항목 모두 plan 에 반영됨. 다만 *plan 자체의 정확성* 만 보장 — 실 코드 작업 시 다음 두 가지 케이스에서 plan 이 작은 갱신 필요할 수도:

1. Task 4 의 INSERT SQL 정확값 (실 history_db.py 코드 base 로 결정)
2. Task 14 의 progress_start/progress_span (실 edit pipeline 의 정확값)

**다음 단계:**

사용자 승인 후 Phase 1 부터 구현 진입 가능. 구현 중에도 각 task 의 검증 command 를 통과해야 다음 task 로 이동.

**진행 흐름:**

```
[지금] Plan 작성 + Codex 1차 + 2차 + 3차 보강 반영 완료
   │
   ▼
[Phase 1-5] Multi-reference 토글 + role (이 plan)
   │
   ▼ 사용자 명시적 master 머지 + 푸시 승인 후
   │
[⏸️ 안정화 기간] 실 사용 검증 (수일~1주)
   │
   ▼ 진입 조건 충족 + 사용자 결정
   │
[Reference Library plan] 별도 진행
   │
   ▼ 사용자 명시적 머지 + 푸시 승인 후
   │
[완료] Edit Multi-Reference 풀 기능
```
