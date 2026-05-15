# AI Image Studio Agent Guide

This guide is repository-local. Follow it together with the global operating
rules from the conversation. If a nearer `AGENTS.md` is added later, the nearer
file overrides the relevant parts.

## Mission

AI Image Studio is a local Windows application for image and video generation:

- Frontend: Next.js 16 App Router, React 19, TypeScript strict, Zustand.
- Backend: FastAPI, Python 3.13, ComfyUI transport, Ollama prompt/vision models.
- Runtime targets: ComfyUI on `127.0.0.1:8000`, backend on `127.0.0.1:8001`,
  frontend on the Next dev port.
- Primary hardware assumption: local single-GPU workstation, 16GB VRAM class.

Optimize for small, verifiable changes. Keep production workflows stable unless
the user explicitly asks to change them.

## Current Priority

The active lab work is:

- `docs/superpowers/specs/2026-05-16-video-lab-paired-compare-sulphur-sampling-design.md`
- `docs/superpowers/plans/2026-05-16-video-lab-paired-compare-sulphur-sampling.md`

Implementation must follow the v2 decisions:

- Do not use the 9-value production LTX upscale sigma list as Sulphur base.
- Sulphur `official_i2v_v1` base uses `LTXVScheduler(steps=8, max_shift=4,
  base_shift=1.5, stretch=true, terminal=0.1)`.
- Sulphur upscale uses `ManualSigmas("0.85, 0.7250, 0.4219, 0.0")`.
- Use `euler_ancestral_cfg_pp` in both Sulphur stages.
- Use stage-specific Sulphur LoRA chains.
- Keep production `/video` behavior unchanged.
- Paired Lab comparison runs Wan first, Sulphur second, with one shared 5-beat
  enhanced prompt.

## Important Paths

Backend:

- `backend/studio/routes/` - FastAPI route modules.
- `backend/studio/pipelines/` - background task orchestration and persistence.
- `backend/studio/comfy_api_builder/` - ComfyUI API graph builders.
- `backend/studio/presets.py` - production model presets. Treat as production
  surface.
- `backend/studio/lab_presets.py` - Lab-only preset definitions.
- `backend/studio/comfy_transport.py` - ComfyUI HTTP/WebSocket transport.
- `backend/studio/history_db/` - SQLite history storage.

Frontend:

- `frontend/app/` - App Router pages.
- `frontend/app/lab/video/page.tsx` - current Lab video page.
- `frontend/components/studio/lab/` - Lab-specific UI.
- `frontend/hooks/useVideoLabPipeline.ts` - Lab video client pipeline hook.
- `frontend/stores/useVideoLabStore.ts` - Lab state.
- `frontend/lib/api/lab.ts` - Lab API client.
- `frontend/lib/lab-presets.ts` - frontend mirror of Lab preset metadata.

Docs:

- `docs/superpowers/specs/` - design specs.
- `docs/superpowers/plans/` - implementation plans and result logs.
- `docs/changelog.md` - user-facing project history.

## Commands

Use PowerShell. Run from the repository root unless the command says otherwise.

```powershell
# Backend tests
Push-Location backend
..\.venv\Scripts\python.exe -m pytest tests -q
Pop-Location

# Targeted backend tests
Push-Location backend
..\.venv\Scripts\python.exe -m pytest tests\studio\test_video_lab_builder.py -q
Pop-Location

# Backend dev server
Push-Location backend
..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --no-access-log
Pop-Location

# Frontend tests / lint / typecheck
Push-Location frontend
npm test -- --run
npm run lint
npx tsc --noEmit
Pop-Location

# Frontend dev with real backend
Push-Location frontend
$env:NEXT_PUBLIC_USE_MOCK="false"
$env:NEXT_PUBLIC_STUDIO_API="http://localhost:8001"
npm run dev
Pop-Location

# OpenAPI type refresh after backend schema changes
Push-Location frontend
npm run gen:types
Pop-Location
```

Prefer the narrowest relevant tests first, then expand when the change touches
shared behavior.

## Change Boundaries

- Do not modify production `/video` model behavior while working on Lab unless
  the user explicitly asks.
- Do not mutate `LTX_VIDEO_PRESET` to satisfy a Lab-only requirement.
- Keep history DB schema unchanged unless a plan explicitly says otherwise.
- Keep pair grouping out of DB for the current paired Lab phase.
- Do not edit `frontend/legacy/` or `backend/legacy/` unless the user explicitly
  asks.
- Do not add dependencies without user approval.
- Do not commit, push, merge, or rewrite history unless the user asks.
- Preserve unrelated user changes in the working tree.

## Backend Rules

- Patch at the lookup module in tests. Prefer direct module imports like
  `studio.routes.lab` or `studio.pipelines.video_lab`.
- Use explicit timeouts and error handling for ComfyUI/Ollama calls.
- Use `ollama_unload` helpers around vision/text model transitions in video/edit
  flows when VRAM pressure matters.
- Use `/api/generate` with integer `keep_alive=0` for forced Ollama unloads.
- For path inputs, validate against traversal and unexpected roots.
- Keep ComfyUI workflow generation in Python builders; do not hand-edit checked
  workflow JSON unless the plan specifically calls for it.

## Frontend Rules

- Use existing design tokens and Studio components before inventing new UI.
- Keep tool surfaces dense and operational. Lab is an experimental workspace,
  not a marketing page.
- Use existing result/history components where practical.
- For paired comparison UI, show both model states, partial failure states, and
  the shared prompt used by both outputs.
- Keep user-facing text Korean and concise.

## Video Lab Rules

- Single-run Sulphur Lab can remain for experimental toggles.
- Paired comparison should be the default comparison path:
  - one source image
  - one user instruction
  - one shared 5-beat enhanced prompt
  - Wan dispatch first
  - Sulphur dispatch second
  - side-by-side results
- Partial failure behavior must be explicit:
  - Wan failure prevents Sulphur.
  - Sulphur failure keeps Wan result.
  - interrupt during Wan marks both incomplete.
  - interrupt during Sulphur keeps Wan and marks Sulphur incomplete.

## Verification Checklist

Before considering a task complete:

- Check `git status --short`.
- Run targeted backend/frontend tests for changed areas.
- Run broader tests when shared builders, stores, routes, or generated API types
  changed.
- State what was verified and what was not.
- If runtime ComfyUI verification was not performed, say so.

## Reporting

Prefer this order when it fits:

1. Overview
2. Logic
3. Optimization
4. Testing
5. Improvements

Keep reports compact and focused on outcomes.
