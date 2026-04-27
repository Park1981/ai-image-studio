# AI Image Studio Full Refactor Review for Claude

Date: 2026-04-26  
Reviewer: Codex / 하루  
Audience: Claude or another implementation agent  
Scope: Full-project refactor review, not a diff review

---

## 1. Purpose

This document packages the full-project refactor review into an actionable handoff for Claude.

The goal is not to judge individual recent diffs. The goal is to identify the structural risks, runtime correctness gaps, and refactoring sequence that will make the project easier to operate, extend, and verify.

Use this as a planning and execution guide. Before editing, re-check the current files because the workspace is already dirty and line numbers may move.

---

## 2. Review Assumptions

- The review was performed against the current workspace state at `D:\AI-Image-Studio`.
- Existing dirty working tree changes are treated as user or prior-agent work and must not be reverted.
- No code changes were made as part of the review, except this documentation file.
- The request explicitly excluded diff-style review.
- The project is a local AI image/video studio using:
  - FastAPI backend
  - Next.js frontend
  - ComfyUI
  - Ollama / Claude CLI fallback
  - SQLite history storage

### Current Dirty Worktree

At review time, many files were already modified or newly added, including:

- `CLAUDE.md`
- multiple files under `backend/studio/`
- multiple tests under `backend/tests/studio/`
- multiple frontend files under `frontend/app`, `frontend/components`, `frontend/hooks`, and `frontend/lib/api`

Claude should not assume a clean tree. Review current `git status --short` before making patches.

---

## 3. Verification Snapshot

Commands run during review:

```powershell
cd backend
..\.venv\Scripts\python.exe -m pytest
```

Result:

- `261 passed`

```powershell
cd frontend
npm test
```

Result:

- `1 test file passed`
- `23 tests passed`

```powershell
cd frontend
npm run lint
```

Result:

- Passed

```powershell
cd frontend
npm run build
```

Result:

- Passed
- Next.js production build completed successfully

```powershell
cd backend
..\.venv\Scripts\python.exe -m ruff check .
```

Result:

- Failed with 29 lint errors
- Most are cleanup-level issues, but two are correctness-relevant:
  - undefined `logger` in `backend/studio/router.py`
  - duplicate `comfyui_pid` property in `backend/services/process_manager.py`

---

## 4. Executive Summary

The project is functional and has meaningful backend coverage. The backend test suite is strong for the current feature set, and the frontend builds cleanly.

The main issue is architectural accumulation. The newer `/api/studio/*` system coexists with older `/api/generate`, WebSocket, `generations` DB, and `useAppStore` paths. This creates duplicated behavior, stale tests, and inconsistent operational state.

The highest-risk backend file is:

- `backend/studio/router.py`

It currently owns too many responsibilities:

- request schemas
- task registry
- SSE streaming
- generate/edit/video pipelines
- ComfyUI dispatch
- file persistence and cleanup
- history CRUD
- model listing
- process status
- process actions
- vision analysis
- comparison analysis

The most important refactor is to split this into bounded modules without changing behavior first.

---

## 5. Priority Legend

- P0: Must fix before relying on long-running real generation/video workflows.
- P1: Structural refactor that materially reduces future regression risk.
- P2: Quality, maintainability, and workflow improvements.

Each finding includes:

- Evidence
- Why it matters
- Recommended action
- Acceptance criteria
- Comment space

---

## 6. P0 Findings

### P0-1. Task TTL Can Cancel Active Long-Running Jobs

Evidence:

- `backend/studio/router.py`
  - `TASK_TTL_SEC = 600`
  - `_cleanup_stale_tasks()` removes tasks based only on age.
  - Long-running video dispatch uses longer ComfyUI timeouts, including a hard timeout around 1 hour.

Why it matters:

The cleanup loop can cancel a still-running task after 10 minutes even if ComfyUI is legitimately working. This is especially risky for video and high-quality image generation on 16GB VRAM where swap or model load can be slow.

Recommended action:

Refactor task cleanup semantics:

- Do not cancel active tasks by `created_at` alone.
- Track task lifecycle explicitly:
  - `created`
  - `stream_connected`
  - `last_event_at`
  - `closed_at`
  - `worker.done()`
- Apply TTL only to:
  - closed tasks
  - tasks whose worker is done
  - orphaned tasks that never received a stream connection and exceeded a short startup grace period
- Use a separate hard cap per mode only if it matches pipeline timeout settings.

Suggested acceptance criteria:

- A video task can run longer than 10 minutes without being cancelled by stale cleanup.
- Closed tasks are still removed eventually.
- Tests cover:
  - closed task cleanup
  - active long-running task not cleaned
  - orphaned task cleanup

Comment space:

```text
Claude notes:

Decision:

Implementation status:

Residual risk:
```

---

### P0-2. `backend/studio/router.py` Uses Undefined `logger`

Evidence:

- `backend/studio/router.py` defines `log = logging.getLogger(__name__)`.
- In `process_status()`, the code calls `logger.warning(...)`.
- Ruff reports `F821 Undefined name logger`.

Why it matters:

If `get_system_metrics()` or `get_vram_breakdown()` raises, the exception handler itself can raise `NameError`, turning a graceful metrics fallback into a 500 response.

Recommended action:

- Replace `logger.warning(...)` with `log.warning(...)` in `backend/studio/router.py`.
- Add or adjust a narrow test that simulates metrics failure and verifies `/api/studio/process/status` still returns 200.

Suggested acceptance criteria:

- `ruff check backend/studio/router.py` no longer reports `F821`.
- `/api/studio/process/status` returns a graceful payload when metrics helpers fail.

Comment space:

```text
Claude notes:

Decision:

Implementation status:

Residual risk:
```

---

### P0-3. Duplicate `comfyui_pid` Property Overrides Safer Logic

Evidence:

- `backend/services/process_manager.py` has `comfyui_pid` near the top of `ProcessManager`.
- The same property is redefined near the bottom of the class.
- Ruff reports `F811 Redefinition`.
- The first implementation checks `proc.poll()` and returns `None` for exited processes.
- The later implementation only checks whether `_comfyui_process` is `None`.

Why it matters:

The later property overrides the safer one. VRAM breakdown can receive a stale PID after ComfyUI exits, causing incorrect process attribution in the UI.

Recommended action:

- Keep only one `comfyui_pid` property.
- Use the safer implementation that checks:
  - process object exists
  - process has not exited
- Add a unit test if practical.

Suggested acceptance criteria:

- Ruff no longer reports `F811`.
- `comfyui_pid` returns `None` when the process has exited.

Comment space:

```text
Claude notes:

Decision:

Implementation status:

Residual risk:
```

---

### P0-4. Studio Pipelines Do Not Mark Generation Complete for Idle Shutdown

Evidence:

- `backend/main.py` starts `_idle_shutdown_loop()` and calls `process_manager.check_idle_shutdown()` every 60 seconds.
- `process_manager.mark_generation_complete()` is called in legacy `backend/routers/generate.py`.
- No matching call was found in the Studio pipelines under `backend/studio/router.py`.

Why it matters:

The current primary frontend appears to use `/api/studio/*`, not the legacy `/api/generate` route. If Studio jobs do not mark generation completion, the idle shutdown timer may not start after real Studio generation/edit/video runs.

Recommended action:

- Call `process_manager.mark_generation_complete()` after successful ComfyUI completion in Studio generate/edit/video pipelines.
- Consider whether mock fallback should mark completion. Recommended:
  - real ComfyUI output: yes
  - ComfyUI error with mock fallback: probably yes if ComfyUI was running or attempted
  - pure mock frontend path: no backend call, not relevant

Suggested acceptance criteria:

- After Studio generate/edit/video completion, `_last_generation_at` is updated.
- Idle shutdown behavior is documented and tested with a mocked process manager.

Comment space:

```text
Claude notes:

Decision:

Implementation status:

Residual risk:
```

---

### P0-5. Frontend AutoStartBoot Sets UI State Without Starting Backend Process

Evidence:

- `frontend/components/app/AppShell.tsx`
  - `AutoStartBoot()` reads `autoStartComfy`.
  - It calls `setComfyui("running")`.
  - It does not call the backend `/api/studio/process/comfyui/start` endpoint.

Why it matters:

The UI can show ComfyUI as running even when nothing was started. This creates user-facing false state and can hide real startup failure.

Recommended action:

Replace UI-only state mutation with real process action:

- call `setProcessStatus("comfyui", "start")`
- then call or wait for `fetchProcessStatus()`
- only set store state from actual status response
- toast success/failure based on the result

Suggested acceptance criteria:

- Enabling auto-start triggers a real backend process action.
- UI does not show `running` unless backend status confirms it.
- Failure path displays a clear toast.

Comment space:

```text
Claude notes:

Decision:

Implementation status:

Residual risk:
```

---

## 7. P1 Structural Refactors

### P1-1. Split `backend/studio/router.py` Into Bounded Modules

Evidence:

- `backend/studio/router.py` is around 1,800+ lines.
- It contains route handlers, task infrastructure, file storage, history operations, ComfyUI dispatch, process status, and pipeline orchestration.

Why it matters:

This makes changes risky because unrelated concerns are coupled in one file. A small edit to process status or file cleanup requires loading the whole Studio pipeline mentally.

Recommended module split:

```text
backend/studio/
  schemas.py
  routes/
    __init__.py
    generate.py
    edit.py
    video.py
    vision.py
    compare.py
    history.py
    process.py
    models.py
  tasks.py
  sse.py
  storage.py
  pipelines/
    __init__.py
    generate.py
    edit.py
    video.py
  history_db.py
  comfy_transport.py
  comfy_api_builder.py
```

Important sequencing:

1. Extract without behavior changes.
2. Keep route URLs unchanged.
3. Keep existing tests passing after each extraction.
4. Only then make behavior fixes.

Suggested acceptance criteria:

- `studio/router.py` becomes a small router composition file.
- No route path changes.
- Existing backend tests pass.
- Ruff passes on touched modules.

Comment space:

```text
Claude notes:

Decision:

Implementation status:

Residual risk:
```

---

### P1-2. Decide and Remove or Quarantine Legacy API Path

Evidence:

Legacy stack still exists:

- `backend/routers/generate.py`
- `backend/database.py` with `generations`
- `frontend/stores/useAppStore.ts`
- many legacy components and hooks importing `useAppStore`

Newer active Studio stack exists:

- `/api/studio/*`
- `backend/studio/history_db.py`
- `frontend/lib/api/*`
- `frontend/stores/useGenerateStore.ts`
- `frontend/stores/useEditStore.ts`
- `frontend/stores/useVideoStore.ts`
- `frontend/stores/useHistoryStore.ts`

Why it matters:

Two systems create duplicated state, stale tests, and confusion around which behavior is authoritative.

Recommended action:

Choose one of two paths:

Option A: Remove legacy path.

- Delete or archive old API routes and old frontend stores/components after confirming no active route imports them.
- Migrate any useful tests to Studio stores/API.

Option B: Quarantine legacy path.

- Mark old route/store/components as legacy.
- Move old frontend pieces under an archive folder or remove from active imports.
- Keep only if needed for reference.

Suggested acceptance criteria:

- One clearly documented primary API contract.
- Tests cover the primary path, not the inactive path.
- No dead UI components are imported by active pages.

Comment space:

```text
Claude notes:

Decision:

Implementation status:

Residual risk:
```

---

### P1-3. Consolidate Model Presets Into One Source of Truth

Evidence:

- `backend/studio/presets.py` says it mirrors frontend presets.
- `frontend/lib/model-presets.ts` says it mirrors backend/workflow data.
- `/api/studio/models` exists but frontend still primarily imports local constants.

Why it matters:

Manual mirroring guarantees drift. A sampling value, LoRA name, or default model can diverge silently.

Recommended action:

Prefer one source:

- shared JSON/YAML manifest checked into repo, loaded by backend and generated/validated for frontend
- or backend `/api/studio/models` as authoritative runtime source

Pragmatic path:

1. Add a script/test that compares backend preset output to frontend constants.
2. Later replace frontend constants with fetched model config where feasible.

Suggested acceptance criteria:

- A CI test fails if backend and frontend presets drift.
- `DEFAULT_OLLAMA_ROLES` and frontend `DEFAULT_OLLAMA_MODELS` cannot diverge silently.

Comment space:

```text
Claude notes:

Decision:

Implementation status:

Residual risk:
```

---

### P1-4. Make Mock Fallback an Explicit Environment Policy

Evidence:

- `backend/studio/router.py` has `COMFY_MOCK_FALLBACK = True`.
- `frontend/lib/api/client.ts` defaults `USE_MOCK` to true unless `NEXT_PUBLIC_USE_MOCK=false`.
- `start.ps1` sets frontend mock false, but direct `npm run dev` does not.

Why it matters:

Mock fallback can make failures look like success. This is useful for UI development but dangerous for real generation workflows.

Recommended action:

- Move backend `COMFY_MOCK_FALLBACK` to `settings`.
- Default real backend fallback to false unless explicitly enabled.
- Make frontend mock mode visible in the UI when enabled.
- Document dev commands clearly.

Suggested acceptance criteria:

- Real backend ComfyUI failures return clear errors by default.
- Mock mode requires explicit opt-in.
- UI visibly indicates mock mode.

Comment space:

```text
Claude notes:

Decision:

Implementation status:

Residual risk:
```

---

### P1-5. Normalize Upload Size and Image Validation

Evidence:

- Vision and Video endpoints enforce 20 MB image limits.
- Edit endpoint reads the whole uploaded image and only checks empty bytes.

Why it matters:

Edit can consume too much memory or process invalid/non-image data. The behavior is inconsistent with Vision/Video.

Recommended action:

- Add `_EDIT_MAX_IMAGE_BYTES`, probably 20 MB for consistency.
- Validate uploaded bytes with PIL before pipeline work.
- Return 413 for oversized files.
- Return 400 for invalid images.

Suggested acceptance criteria:

- Edit rejects oversized input.
- Edit rejects non-image input.
- Tests cover both cases.

Comment space:

```text
Claude notes:

Decision:

Implementation status:

Residual risk:
```

---

### P1-6. Replace Ad Hoc SQLite Migrations With Versioned Migrations

Evidence:

- `backend/studio/history_db.py` performs repeated `ALTER TABLE ... ADD COLUMN` in code.
- Some schema changes require table recreation due to SQLite CHECK constraints.

Why it matters:

The current pattern works for a small local app, but it becomes fragile as schema evolution continues. It is hard to know what schema version a DB is at.

Recommended action:

Minimum viable migration system:

- Add `schema_version` table.
- Store current version.
- Apply ordered migration functions.
- Make migrations idempotent and tested.

Suggested acceptance criteria:

- Fresh DB creates latest schema.
- Old DB migrates in order.
- Migration version is queryable.

Comment space:

```text
Claude notes:

Decision:

Implementation status:

Residual risk:
```

---

### P1-7. Align Tests With Active Product Path

Evidence:

- Backend tests are strong and current Studio tests cover many edge cases.
- Frontend test suite mainly tests `useAppStore`, while active pages use newer stores like `useGenerateStore`, `useEditStore`, `useVideoStore`, and `useHistoryStore`.

Why it matters:

Frontend tests can pass while the actual user-facing pages regress.

Recommended action:

Add tests for:

- `useGenerateStore` dimension snapping and aspect lock behavior
- `useGeneratePipeline` stream handling
- `useEditPipeline` done/error handling
- `useVideoPipeline` done/error handling
- `useHistoryStore` server hydration and deletion behavior
- API client SSE parser behavior

Suggested acceptance criteria:

- Tests cover active app stores/hooks.
- Legacy `useAppStore` tests are removed or moved to legacy coverage only.

Comment space:

```text
Claude notes:

Decision:

Implementation status:

Residual risk:
```

---

## 8. P2 Improvements

### P2-1. Add Contract Validation Between Backend and Frontend

Recommended action:

- Generate OpenAPI from FastAPI.
- Either generate TypeScript types or validate frontend types against representative backend responses.
- Consider lightweight runtime parsing for API responses.

Comment space:

```text
Claude notes:

Decision:

Implementation status:
```

---

### P2-2. Add CI Quality Gate

Recommended command set:

```powershell
cd backend
..\.venv\Scripts\python.exe -m pytest
..\.venv\Scripts\python.exe -m ruff check .

cd ..\frontend
npm test
npm run lint
npm run build
```

Recommended action:

- Add GitHub Actions or local `scripts/check.ps1`.
- Treat Ruff failure as blocking after current lint issues are fixed.

Comment space:

```text
Claude notes:

Decision:

Implementation status:
```

---

### P2-3. Improve Startup Script Configurability

Evidence:

- `start.ps1` hardcodes `$OllamaExe = "C:\ollama\ollama.exe"`.
- `start.ps1` hardcodes frontend env values.

Recommended action:

- Read Ollama path from `.env` or `OLLAMA_EXECUTABLE`.
- Read frontend port/API URL from config or script params.
- Keep defaults, but allow override.

Comment space:

```text
Claude notes:

Decision:

Implementation status:
```

---

### P2-4. Add Real Workflow Smoke Tests or Manual QA Checklist

The automated tests avoid real ComfyUI/Ollama, which is correct for unit tests. But this app depends on local GPU and external processes, so a manual or semi-automated QA checklist is still needed.

Recommended checklist:

- Start app via `start.ps1`.
- Verify frontend connects with `NEXT_PUBLIC_USE_MOCK=false`.
- Run Generate with Lightning on/off.
- Run Edit with valid image and oversized image.
- Run Video with short prompt and default longer edge.
- Interrupt a running task.
- Delete history item and verify output/source cleanup.
- Wait for idle shutdown and verify ComfyUI exits.

Comment space:

```text
Claude notes:

Decision:

Implementation status:
```

---

## 9. Recommended Refactor Plan

### Phase 0. Stabilize Runtime Bugs

Goal:

Fix issues that can break real usage without changing architecture.

Tasks:

1. Fix `logger` to `log` in `backend/studio/router.py`.
2. Remove duplicate `comfyui_pid` property and keep the safer implementation.
3. Adjust Studio task cleanup so active long-running tasks are not cancelled by age alone.
4. Add Studio completion calls to `process_manager.mark_generation_complete()`.
5. Make `AutoStartBoot` call actual backend process start or remove the misleading feature.
6. Add Edit upload size/image validation.
7. Run:
   - backend pytest
   - backend ruff
   - frontend lint/build/test

Expected result:

The app is safer for long-running local generation and no longer has known lint-reported correctness issues.

Comment space:

```text
Claude notes:

Decision:

Implementation status:
```

---

### Phase 1. Extract Studio Router Without Behavior Changes

Goal:

Reduce blast radius while preserving API behavior.

Suggested extraction order:

1. `tasks.py`
2. `sse.py`
3. `storage.py`
4. `schemas.py`
5. `pipelines/generate.py`
6. `pipelines/edit.py`
7. `pipelines/video.py`
8. `routes/*.py`
9. leave `router.py` as composition only

Rules:

- No endpoint path changes.
- No frontend changes required.
- Run backend tests after each meaningful extraction.
- Avoid refactoring pipeline behavior during extraction.

Expected result:

Claude and future agents can reason about one concern at a time.

Comment space:

```text
Claude notes:

Decision:

Implementation status:
```

---

### Phase 2. Contract and Preset Consolidation

Goal:

Stop backend/frontend drift.

Tasks:

1. Add backend/frontend preset parity test.
2. Decide whether `/api/studio/models` or a shared manifest is authoritative.
3. Update frontend to consume authoritative model config where practical.
4. Add response type validation or generated TypeScript types.

Expected result:

Model defaults, LoRA names, sampling settings, and API types stay synchronized.

Comment space:

```text
Claude notes:

Decision:

Implementation status:
```

---

### Phase 3. Remove or Archive Legacy Code

Goal:

Reduce maintenance burden.

Tasks:

1. Identify all active imports from:
   - `useAppStore`
   - legacy `frontend/components/creation/*`
   - legacy `frontend/hooks/useGenerate.ts`
   - legacy backend `/api/generate`
2. Confirm whether any route still uses the old flow.
3. Either remove or move to an archive namespace.
4. Migrate useful tests to active stores/hooks.

Expected result:

There is one primary product path.

Comment space:

```text
Claude notes:

Decision:

Implementation status:
```

---

## 10. Suggested Claude Task Prompts

### Prompt A. P0 Runtime Stabilization

```text
You are working in D:\AI-Image-Studio. Do not revert existing user changes.

Implement Phase 0 from docs/refactor-review-for-claude-2026-04-26.md:

1. Fix undefined logger usage in backend/studio/router.py.
2. Remove duplicate comfyui_pid in backend/services/process_manager.py, keeping the implementation that returns None if the process exited.
3. Refactor Studio task cleanup so active long-running tasks are not cancelled only because created_at exceeds 600 seconds.
4. Ensure successful Studio generate/edit/video completions update process_manager.mark_generation_complete().
5. Replace or remove frontend AutoStartBoot's fake "running" state behavior.
6. Add Edit upload size/image validation consistent with Vision/Video.

Keep changes minimal and behavior-compatible. Add focused tests for each behavior where practical.

Run:
- backend pytest
- backend ruff check
- frontend npm test
- frontend npm run lint
- frontend npm run build

Report changed files, test results, and any residual risks.
```

### Prompt B. Router Extraction

```text
You are working in D:\AI-Image-Studio. Do not revert existing user changes.

Implement Phase 1 from docs/refactor-review-for-claude-2026-04-26.md.

Extract backend/studio/router.py into bounded modules without changing endpoint paths or behavior:

- tasks.py
- sse.py
- storage.py
- schemas.py
- pipelines/generate.py
- pipelines/edit.py
- pipelines/video.py
- routes/*.py

Make router.py a small composition module that includes all Studio routes.

Do not combine behavior changes with extraction unless required to preserve tests.
Run backend tests after extraction and report any route/API compatibility risks.
```

### Prompt C. Preset and Contract Consolidation

```text
You are working in D:\AI-Image-Studio. Do not revert existing user changes.

Implement Phase 2 from docs/refactor-review-for-claude-2026-04-26.md.

Goal:
Stop backend/frontend preset and API contract drift.

Tasks:
1. Add a parity test comparing backend/studio/presets.py output with frontend/lib/model-presets.ts values, or introduce a shared manifest.
2. Decide and document the authoritative source.
3. Add a lightweight API contract validation path for the main Studio responses.

Keep the first patch small. Prefer a test that catches drift before a full architecture migration.
```

---

## 11. Global Comment Area

Use this section for Claude or human reviewer notes that do not belong to a single finding.

```text
Reviewer / Claude:

Date:

Context:

Decision:

Follow-up:
```

```text
Reviewer / Human:

Date:

Context:

Decision:

Follow-up:
```

```text
Open questions:

1.
2.
3.
```

---

## 12. Final Recommendation

Do not start with the large router split. Start with Phase 0.

Reason:

The project already has a broad test suite, but there are a few small correctness issues that can affect real workflows. Fixing those first gives a safer baseline. After that, the router extraction can be done as a behavior-preserving refactor with much lower risk.

Most important first commit or patch:

1. Task cleanup semantics
2. `logger` fix
3. duplicate `comfyui_pid` fix
4. Studio idle shutdown integration
5. frontend auto-start truthfulness

---

## 13. Claude Cross-Review (2026-04-26)

작성: Claude (Opus 4.7, 1M ctx)
방식: Codex 리뷰를 보지 않은 상태에서 backend/studio 전체 독립 스캔 → 본 문서와 cross-validate.
검증 명령: `pytest backend/tests/studio` (197/197) · 본 리뷰는 정적 분석 + 아키텍처 추론만 사용했음.

### 13.1 Codex 리뷰에 대한 동의 (P0)

다섯 P0 모두 Claude 독립 리뷰에서도 같은 시그널을 봤거나 합리적 위험으로 판단됨. 우선순위 그대로 유지 권장:

| 항목 | Claude 검증 | 코멘트 |
|------|-------------|--------|
| P0-1 Task TTL이 long-running 작업 cancel | **검증** | Claude 독립 리뷰는 이걸 못 잡음 (내 분석은 router.py 길이/lock 패턴 위주). 비디오 51분+ 케이스가 실제 시나리오라 Codex 발견이 더 중요. **즉시 fix 1순위.** |
| P0-2 `logger` undefined (F821) | **검증** | ruff가 정확히 잡은 건. metrics 폴백 자체가 graceful하게 설계됐는데 NameError로 500 떨어지는 건 모순. one-liner fix. |
| P0-3 duplicate `comfyui_pid` (F811) | **검증** | 두 번째 정의가 첫 번째 안전 정의를 덮어씀. VRAM breakdown 헤더가 stale PID 받으면 사용자 표시가 틀어짐 (2026-04-26 spec 19에서 추가한 기능이라 회귀 위험 직접). |
| P0-4 Studio가 `mark_generation_complete()` 안 부름 | **검증** | 운영 버그. Studio 가 primary path인데 idle shutdown loop 가 legacy 만 듣고 있음. 16GB VRAM 환경에서 Ollama/ComfyUI 가 idle 후에도 점유 → 다음 작업 swap 회귀 가능. **spec 19의 keep_alive=0 정책과 한쌍으로 묶여야 의미.** |
| P0-5 AutoStartBoot fake running | **검증** | 사용자에게 거짓 상태 표시. SystemStatusChip 의 "준비 완료" 표시가 실제 backend 상태와 어긋날 수 있음. Codex 권장(real action 호출)이 정답. |

### 13.2 Codex 리뷰에 대한 동의 (P1/P2)

| 항목 | Claude 검증 | 코멘트 |
|------|-------------|--------|
| P1-1 router.py 분리 | **강한 동의** | 2,141줄 (Codex가 1,800+ 으로 본 건 워크트리 차이) — Phase 1 순서대로 하면 위험 적음. Claude 추천 추가: `_ollama_client.py` 도 같이 분리 (13.3-A 참고). |
| P1-2 legacy 정리 | **동의** | useAppStore 466줄 보존은 사용자 명시 의지 (CLAUDE.md/메모리). **현실안: 옵션 B(quarantine)** — `frontend/legacy/` 로 이동하되 active import 0건 보장. CLAUDE.md `Rules`에 "수정 금지" 라인 이미 있음. |
| P1-3 preset parity test | **동의** | 백엔드 + 프론트 동기화 사고가 이미 두 번 (Lightning 8/1.5 첫 시도 백엔드만 + extra LoRA 교체). drift detection 자체는 작은 pytest 한 개로 충분 (frontend/lib/model-presets.ts → JSON으로 export 후 backend 비교). |
| P1-4 mock 정책 명시 | **동의** | 단, 현재 운영은 실 ComfyUI 만 쓰고 mock은 dev 만 — 우선순위 P2 정도로 낮춰도 됨. |
| P1-5 Edit upload validation | **동의 + 보강** | `_VIDEO/_VISION/_COMPARE_MAX_IMAGE_BYTES` 3중 상수도 통합 필요 (메모리에 이미 적힘). `_STUDIO_MAX_IMAGE_BYTES` 단일화 추천. |
| P1-6 versioned migrations | **약한 동의** | v1~v6 ALTER 가 idempotent 하게 잘 짜여있음. 부담은 낮은 편. P2 로 강등 가능. |
| P1-7 active path test | **강한 동의** | 프론트 vitest 23개가 거의 useAppStore 만 보고 있음 (실제 페이지 회귀 0% 커버). Codex 권장 5개 hook 테스트가 적절. |

### 13.3 Codex가 다루지 않은 항목 (Claude 추가 발견)

Codex 리뷰는 **운영/구조 결함**에 강하지만, **DRY/타입/동시성 갭**은 약하게 다룸. Claude 독립 리뷰에서 잡은 보완 항목:

#### A. Ollama 호출 분산 (P1)
**파일**: `prompt_pipeline.py`, `vision_pipeline.py`, `comparison_pipeline.py`
**문제**: 세 모듈이 각각 `httpx.AsyncClient` + `/api/chat` payload + base64 인코딩 + JSON 파싱을 독립 구현. `_DEFAULT_OLLAMA_URL` 도 3회 재정의. spec 19의 `ollama_unload.py` 도입했지만 호출부는 여전히 산재.
**수정안**: `backend/studio/_ollama_client.py` 신설 — 싱글톤 `AsyncClient` 풀 + `call_chat(model, system, user, images=None, format=None, keep_alive="0")` 통합 헬퍼. `_json_utils.parse_strict_json` 과 같은 모듈 패키지 위치.
**효과**: keep_alive 형식 통일 (string vs int 혼선 차단), httpx connection 재사용, P1-1 router 분리 후 의존성 단순화.

#### B. `_TASKS_LOCK` 부분 적용 (P1)
**파일**: `backend/studio/router.py`
**문제**: `_TASKS_LOCK` 이 정의되어 있지만 일부 `TASKS.get()` / `TASKS.pop()` 호출이 lock 밖에서 실행됨. SSE cleanup loop 와 새 task 등록 사이 race 가능.
**수정안**: P1-1 router 분리 시 `tasks.py` 로 이동하면서 모든 mutation 을 `async with _TASKS_LOCK:` 으로 감쌈. read-only `.get()` 도 일관 적용.
**관계**: P0-1 Task TTL 수정 시 함께 처리하면 회귀 줄임.

#### C. 동적 import 순환 의존 (P2)
**파일**: `backend/studio/router.py:710` 부근 (`from .prompt_pipeline import UpgradeResult` 함수 내부)
**문제**: 모듈 상단 로드 충돌 회피용 지연 import. 가독성 저하 + 매 호출 시 import lookup. P1-1 분리 시 `schemas.py` 로 `UpgradeResult` 이동하면 자연 해소.

#### D. 타입 안전 갭 (P2)
**문제**: `dict[str, Any]` 가 EditVisionAnalysis / ComparisonAnalysisResult 응답에서 광범위 사용. `mode = "generate"|"edit"|"video"` 문자열이 backend 5+ 곳, frontend 4+ 곳에 흩뿌려짐.
**수정안**: `backend/studio/types.py` 에 `Mode = Literal["generate","edit","video"]` + 응답 TypedDict 정의. P1-3 preset parity 와 같이 TypeScript 타입 자동 생성으로 frontend 동기화.

#### E. 함수 중복 (P2)
**파일**: `prompt_pipeline.py`
**문제**: `upgrade_generate_prompt` / `upgrade_edit_prompt` / `upgrade_video_prompt` 세 함수의 system+user 메시지 조립 + 응답 파싱 로직이 ~80% 동일. SYSTEM 프롬프트와 mode 별 metadata 만 차이.
**수정안**: `_build_upgrade_call(mode, system_prompt, user_blocks, ...)` 공통 헬퍼. P1-1 분리 시 `pipelines/_upgrade_common.py` 추천.

#### F. comfy_api_builder LoRA 체인 중복 (P2)
**파일**: `backend/studio/comfy_api_builder.py`
**문제**: `_build_lora_chain` (이미지) 와 `_build_video_lora_chain` (비디오) 가 node_id 생성/체이닝/모델 참조 만 다른 거의 동일 로직. spec 19 의 GENERATE_STYLES 시스템 추가로 향후 분기 더 늘 가능성.
**수정안**: `_apply_loras(loras: list[LoraEntry], anchor: str, prefix: str) -> str` 공통 헬퍼.

#### G. 예외 분류 부재 (P2)
**파일**: 전 pipeline 모듈
**문제**: `except Exception as e:` 5+ 곳. `httpx.TimeoutError` / `httpx.HTTPError` / `json.JSONDecodeError` / vision 모델 OOM 을 같은 로그 레벨로 처리 → 운영 시 진짜 fault 와 transient 구분 불가.
**수정안**: `backend/studio/_errors.py` 에 `OllamaError` / `ComfyError` 도메인 예외 정의 + 호출부에서 구체 예외 매핑.

### 13.4 우선순위 통합 추천 (Codex Phase 0 + Claude 추가)

원래 Codex Phase 0 (5건) 이 즉시 fix 우선이라는 데 동의. 추가만 살짝:

```text
Phase 0 (즉시 — 1-2일):
  P0-2 logger fix (5분, F821)
  P0-3 duplicate comfyui_pid fix (10분, F811)
  P0-1 Task TTL 재설계 (4-6h)
  P0-4 mark_generation_complete (2h)
  P0-5 AutoStartBoot truthfulness (2h)
  + Claude P1-5 보강: _STUDIO_MAX_IMAGE_BYTES 단일 상수 통일 (30m)
  + Claude B: _TASKS_LOCK 일관 적용 (1h, P0-1 같이)

Phase 1 (구조 — 1주):
  P1-1 router.py 분리 (Codex 순서대로)
    - 추가: pipelines/_upgrade_common.py (Claude E)
    - 추가: _ollama_client.py (Claude A)
    - 추가: types.py 의 Mode + TypedDict (Claude D)
    - 추가: _errors.py (Claude G)
  P1-7 active path test (병행)

Phase 2 (drift 차단 — 3일):
  P1-3 preset parity test
  P2-1 OpenAPI 추출

Phase 3 (정리 — 2-3일):
  P1-2 legacy quarantine (옵션 B 권장 — 사용자 보존 의지 존중)
  P1-4 mock 명시화
  P1-6 versioned migrations (선택)
```

### 13.5 Codex 리뷰 신뢰도 평가

| 차원 | 평가 |
|------|------|
| 운영 결함 포착 | **우수** — P0-1 (TTL), P0-4 (idle shutdown) 는 Claude 독립 리뷰에서 못 잡음 |
| ruff/lint 시그널 활용 | **우수** — F821/F811 두 개를 P0 로 끌어올림 |
| 아키텍처 사고 | **우수** — router.py 분리 phase 순서 가 안전 |
| 코드 중복/DRY | 보강 필요 — 함수 중복 / Ollama 분산 / LoRA 체인 미언급 |
| 타입 안전 | 보강 필요 — Literal/TypedDict 관점 누락 |
| 동시성 | 보강 필요 — `_TASKS_LOCK` race 미언급 |

**결론**: Codex 리뷰는 즉시 실행 우선 5건이 정확함. Claude 추가 7건은 Phase 1 router 분리 시 함께 처리하면 회귀 위험 0 으로 끝낼 수 있음. **두 리뷰는 경쟁이 아니라 보완적**.

### 13.6 미해결/오빠 결정 필요

```text
Open questions for human reviewer:

1. P1-2 legacy quarantine 시점:
   - 옵션 A (삭제) vs 옵션 B (격리) 중 사용자 의지는 "보존" (메모리 / CLAUDE.md 명시)
   - quarantine 후 import 0건 보장만 하면 될지?

2. P1-4 mock 정책:
   - 현재 사실상 dev 에서만 쓰임. 우선순위 P2 강등 OK?

3. Codex/Claude 가 보강한 P1+ 작업 (router 분리 Phase 1) 시점:
   - Phase 0 안정화 직후 1주 통째로 진행 vs 점진적 spec-단위 분리?
   - 점진적 권장 (사용자 선호: TDD/소규모 PR)
```


