# Plan - Video Lab Paired Compare + Sulphur Official-I2V Fix

**Spec**: `docs/superpowers/specs/2026-05-16-video-lab-paired-compare-sulphur-sampling-design.md`  
**Status**: Draft v2 after Claude validation  
**Goal**: Add a Lab-only Sulphur official-ish i2v profile and Wan -> Sulphur paired comparison using one shared AI-enhanced 5-beat prompt.

---

## Guardrails

- Do not modify production `/video` behavior.
- Do not mutate `LTX_VIDEO_PRESET` defaults for production.
- Keep history DB schema unchanged.
- Use one GPU job at a time: Wan first, Sulphur second.
- Generate the shared enhanced prompt once.
- Lock tests so the wrong 9-value production LTX upscale sigma list cannot be used as Sulphur base.
- Define partial failure and interrupt behavior before UI work.

---

## Task 0 - Apply Claude Validation Decisions

Claude validation changed the sampling target:

- [x] Previous draft base `ManualSigmas("1.0, ... 0.0")` was wrong.
- [x] That 9-value list is production LTX upscale behavior, not Sulphur official base.
- [x] Default Sulphur profile should use base `LTXVScheduler`.
- [x] Upscale should use `ManualSigmas("0.85, 0.7250, 0.4219, 0.0")`.
- [x] Stage-specific LoRA chains are valid and should be implemented.
- [x] Shared 5-beat paired comparison is valid.

Implementation profile name:

```text
official_i2v_v1
```

Do not implement `manual_sigmas_v1` as the default profile.

---

## Task 1 - Add Failing Builder Tests for Sulphur Official Profile

**Files**:
- Modify:
  - `backend/tests/studio/test_video_lab_builder.py`

Add tests before implementation:

- [ ] `test_sulphur_official_profile_base_uses_ltxv_scheduler_not_production_upscale_sigmas`
  - build Lab Sulphur workflow with `official_i2v_v1`
  - assert base sampler uses `euler_ancestral_cfg_pp`
  - assert base sigmas input comes from `LTXVScheduler`
  - assert scheduler widgets:
    - `steps=8`
    - `max_shift=4`
    - `base_shift=1.5`
    - `stretch=True`
    - `terminal=0.1`
  - assert base stage does not use:
    - `1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0`
- [ ] `test_sulphur_official_profile_upscale_uses_short_manual_sigmas`
  - assert upscale sampler uses `euler_ancestral_cfg_pp`
  - assert upscale `ManualSigmas` equals `0.85, 0.7250, 0.4219, 0.0`
- [ ] `test_sulphur_official_profile_uses_stage_specific_lora_chains`
  - base chain and upscale chain must not point to the same `model_ref`
  - base chain should include distill `0.7` then Sulphur `1.0`
  - upscale chain should include Sulphur `1.0` then distill `0.5`
- [ ] `test_sulphur_official_profile_uses_local_sulphur_lora_basename`
  - assert `sulphur_lora_rank_768.safetensors`
  - assert no `sulphur_final.safetensors`
- [ ] `test_sulphur_official_profile_i2v_strength_fps_and_frame_count`
  - base `LTXVImgToVideoInplace.strength == 0.8`
  - upscale `LTXVImgToVideoInplace.strength == 1.0`
  - fps `24`
  - frame count `121`
- [ ] `test_production_ltx_builder_keeps_existing_sampling`
  - build production LTX workflow
  - assert existing production values did not change

Expected result before implementation: tests fail.

---

## Task 2 - Implement Lab-Only Sulphur Official Profile

**Files**:
- Modify:
  - `backend/studio/lab_presets.py`
  - `backend/studio/comfy_api_builder/video_lab.py`
- Possibly modify:
  - `backend/studio/comfy_api_builder/video.py`

Implementation notes:

- [ ] Add Lab-only profile config:

```python
SULPHUR_OFFICIAL_PROFILE_ID = "official_i2v_v1"
SULPHUR_BASE_SCHEDULER = {
    "steps": 8,
    "max_shift": 4,
    "base_shift": 1.5,
    "stretch": True,
    "terminal": 0.1,
}
SULPHUR_UPSCALE_SIGMAS = "0.85, 0.7250, 0.4219, 0.0"
```

- [ ] Build separate model refs:
  - `base_model_ref`
  - `upscale_model_ref`
- [ ] Apply stage-specific LoRA chains:
  - base: distill `0.7`, Sulphur `1.0`
  - upscale: Sulphur `1.0`, distill `0.5`
- [ ] Use `base_model_ref` in base `CFGGuider`.
- [ ] Use `upscale_model_ref` in upscale `CFGGuider`.
- [ ] Use base `LTXVScheduler` instead of `ManualSigmas`.
- [ ] Use upscale `ManualSigmas("0.85, 0.7250, 0.4219, 0.0")`.
- [ ] Use `euler_ancestral_cfg_pp` in both stages.
- [ ] Use i2v strengths `0.8` and `1.0`.
- [ ] Use `fps=24`, `frame_count=121`.
- [ ] Keep `img_compression=12` for now and document as an intentional non-official face-preservation deviation.
- [ ] Add `_meta.title` or internal helper labels if needed to make tests robust.
- [ ] Keep production `_build_ltx` behavior unchanged.

Run:

```powershell
Push-Location backend
..\.venv\Scripts\python.exe -m pytest tests\studio\test_video_lab_builder.py -q
Pop-Location
```

Done when builder tests pass.

---

## Task 3 - Add Shared 5-Beat Prompt Adapter

**Files**:
- Modify or create:
  - `backend/studio/pipelines/video_lab.py`
  - possibly `backend/studio/prompt_pipeline/`
  - backend tests under `backend/tests/studio/`

Behavior:

- [ ] Analyze the source image once.
- [ ] Generate one English 5-beat Director prompt from:
  - image analysis
  - user instruction
  - identity preservation rules
- [ ] Use the exact same final prompt for Wan and Sulphur in paired mode.
- [ ] Do not run model-specific prompt rewrites in `shared_5beat` mode.

Prompt skeleton:

```text
Preserve the exact identity, same face, same facial proportions, same hairstyle, same body proportions, same outfit details from the reference image. No face swap, no identity drift.

[Subject Description based on image], [Environment/Context].
Beat 1: ...
Beat 2: ...
Beat 3: ...
Beat 4: ...
Beat 5: ...
Camera work: ...
Acting should be emotional and realistic.
4K details, natural color, cinematic lighting and shadows, crisp textures, clean edges, fine material detail, high microcontrast, realistic shading, accurate tone mapping, smooth gradients, realistic highlights, detailed fabric and hair, sharp and natural.
```

Tests:

- [ ] prompt adapter emits `Beat 1` through `Beat 5`
- [ ] identity preservation sentence is present
- [ ] prompt is English
- [ ] pair pipeline calls adapter once

---

## Task 4 - Backend Pair Route and Pipeline

**Files**:
- Modify:
  - `backend/studio/routes/lab.py`
  - `backend/studio/pipelines/video_lab.py`
  - `backend/studio/comfy_api_builder/__init__.py` if exports are needed
- Tests:
  - `backend/tests/studio/test_video_lab_routes.py`
  - new `backend/tests/studio/test_video_lab_pair_pipeline.py`

Add routes:

```text
POST /api/studio/lab/video/pair
GET  /api/studio/lab/video/pair/stream/{task_id}
```

Pipeline:

- [ ] Parse one image + one meta object.
- [ ] Validate Wan and Sulphur model availability.
- [ ] Validate Sulphur LoRA files.
- [ ] Create shared prompt once.
- [ ] Dispatch Wan first.
- [ ] Persist Wan result as `mode="video"`.
- [ ] Dispatch Sulphur second with `official_i2v_v1`.
- [ ] Persist Sulphur result as `mode="video"`.
- [ ] Final SSE `done` includes both items and shared prompt.

Partial failure and interrupt:

- [ ] If Wan fails before output, do not run Sulphur.
- [ ] If Sulphur fails after Wan succeeded, keep and return Wan result plus Sulphur error.
- [ ] If interrupted during Wan, mark both outputs incomplete.
- [ ] If interrupted during Sulphur, keep Wan result and mark Sulphur incomplete.

Tests:

- [ ] pair route creates task
- [ ] dispatch order is Wan then Sulphur
- [ ] shared prompt is reused exactly
- [ ] two history items are persisted on full success
- [ ] final payload contains both result keys on full success
- [ ] Wan failure prevents Sulphur dispatch
- [ ] Sulphur failure preserves Wan result
- [ ] interrupt behavior is model-scoped

Run:

```powershell
Push-Location backend
..\.venv\Scripts\python.exe -m pytest tests\studio\test_video_lab_routes.py tests\studio\test_video_lab_pair_pipeline.py -q
Pop-Location
```

---

## Task 5 - Frontend API, Store, and Hook

**Files**:
- Modify:
  - `frontend/lib/api/lab.ts`
  - `frontend/stores/useVideoLabStore.ts`
  - `frontend/hooks/useVideoLabPipeline.ts`
- Possibly create:
  - `frontend/hooks/useVideoLabPairPipeline.ts`

Add client function:

```ts
labVideoPairStream(req: LabVideoPairRequest)
```

Store additions:

- [ ] pair running state
- [ ] pair progress per model
- [ ] pair result refs
- [ ] pair error per model
- [ ] partial result state
- [ ] shared final prompt
- [ ] pair mode, default `shared_5beat`
- [ ] Sulphur profile label, default `official_i2v_v1`

Hook:

- [ ] prevent duplicate runs
- [ ] send one source + prompt
- [ ] consume model-scoped SSE events
- [ ] store Wan result when done
- [ ] store Sulphur result when done
- [ ] handle Sulphur failure after Wan success
- [ ] add persisted history items to local history store

Tests:

- [ ] API request serializes `pairMode`
- [ ] API request serializes `sulphurProfile="official_i2v_v1"`
- [ ] hook handles staged Wan/Sulphur events
- [ ] final done stores both items
- [ ] partial failure stores available result and error state

---

## Task 6 - Frontend Pair Compare UI

**Files**:
- Modify:
  - `frontend/components/studio/lab/VideoLabLeftPanel.tsx`
  - `frontend/components/studio/lab/VideoLabRightPanel.tsx`
- Possibly create:
  - `frontend/components/studio/lab/VideoLabPairCompare.tsx`
  - `frontend/components/studio/lab/VideoLabSharedPromptCard.tsx`

UI requirements:

- [ ] One primary button: `Wan + Sulphur 비교 생성`
- [ ] Show queue state:
  - Wan waiting/running/done/error
  - Sulphur waiting/running/done/error
- [ ] Show partial result state if one side fails.
- [ ] Show results side-by-side.
- [ ] Show shared final prompt below the videos.
- [ ] Show metadata:
  - model name
  - fps
  - frame count
  - resolution
  - seed
  - Sulphur profile `official_i2v_v1`

Keep the existing single-run Sulphur controls available, but do not make the pair flow depend on every experimental toggle.

---

## Task 7 - Verification

Backend:

```powershell
Push-Location backend
..\.venv\Scripts\python.exe -m pytest tests\test_lab_presets.py tests\studio\test_video_lab_builder.py tests\studio\test_video_lab_pipeline.py tests\studio\test_video_lab_routes.py tests\studio\test_video_lab_pair_pipeline.py -q
Pop-Location
```

Frontend:

```powershell
Push-Location frontend
npm test -- --run
Pop-Location
```

Runtime:

- [ ] Start backend/frontend normally.
- [ ] Open `/lab/video`.
- [ ] Upload one image.
- [ ] Enter one instruction.
- [ ] Run pair.
- [ ] Confirm Wan output saved.
- [ ] Confirm Sulphur output saved.
- [ ] Confirm side-by-side UI displays both.
- [ ] Confirm shared prompt is identical for both results.
- [ ] Confirm Sulphur generated workflow uses:
  - base `LTXVScheduler(steps=8, max_shift=4, base_shift=1.5, stretch=true, terminal=0.1)`
  - upscale `ManualSigmas("0.85, 0.7250, 0.4219, 0.0")`
  - no base use of the 9-value production LTX upscale sigma list
  - `euler_ancestral_cfg_pp` in both stages
  - i2v strengths `0.8` and `1.0`
  - `fps=24`, `frame_count=121`

---

## Task 8 - Result Documentation

**Files**:
- Create:
  - `docs/superpowers/plans/2026-05-16-video-lab-paired-compare-sulphur-sampling-results.md`

Record:

- Claude validation outcome
- final scheduler/sigma mapping
- final LoRA chain decision
- test results
- runtime smoke output paths
- known limitations
- whether face identity improved in first visual check
- partial failure behavior observed, if tested

---

## Rollback Plan

Because production `/video` is untouched, rollback should be low risk:

- disable or hide pair button in frontend
- keep existing single Sulphur Lab route working
- remove new pair route registration if needed
- keep docs and tests for follow-up

Do not revert unrelated user changes.

