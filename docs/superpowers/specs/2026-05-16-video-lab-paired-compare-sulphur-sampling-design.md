# Video Lab Paired Compare + Sulphur Official-I2V Fix

**Date**: 2026-05-16  
**Status**: Draft v2 after Claude validation  
**Scope**: `/lab/video` only. Production `/video` must remain unchanged.  
**Related spec**: `docs/superpowers/specs/2026-05-15-video-lab-framework-sulphur-design.md`

---

## 0. Summary

Current Lab Sulphur is useful as a single-model smoke test, but it is not yet a good model comparison tool. The next iteration should do two things:

1. Fix Sulphur Lab to use a Lab-only **official-ish i2v profile**:
   - base stage uses `LTXVScheduler`, not the 9-value production LTX upscale sigma list
   - upscale stage uses `ManualSigmas = "0.85, 0.7250, 0.4219, 0.0"`
   - both stages use `euler_ancestral_cfg_pp`
   - stage-specific LoRA chains are used instead of one shared `model_ref`
2. Add a **paired comparison flow**:
   - one source image
   - one user instruction
   - one AI prompt enhancement pass
   - generate Wan first
   - generate Sulphur second with the same enhanced prompt
   - show both results side-by-side

The shared enhanced prompt should follow the provided **AI Video Director / 5-beat Image-to-Video prompt guide** by default. This keeps the comparison controlled while using a prompt shape Sulphur is expected to handle well.

---

## 1. Objective

Make `/lab/video` a real validation page for model comparison, not just a Sulphur single-run page.

### Done Condition

- Sulphur Lab has a new Lab-only profile, `official_i2v_v1`.
- `official_i2v_v1` uses:
  - base sampler `euler_ancestral_cfg_pp`
  - base `LTXVScheduler(steps=8, max_shift=4, base_shift=1.5, stretch=true, terminal=0.1)`
  - upscale sampler `euler_ancestral_cfg_pp`
  - upscale `ManualSigmas("0.85, 0.7250, 0.4219, 0.0")`
  - base `LTXVImgToVideoInplace.strength = 0.8`
  - upscale `LTXVImgToVideoInplace.strength = 1.0`
  - `fps = 24`
  - `frame_count = 121`
- Production `/video` LTX/Wan behavior is unchanged.
- A user can set image + instruction once, click one button, and receive:
  - Wan result
  - Sulphur result
  - shared enhanced prompt used by both
  - side-by-side comparison UI

---

## 2. Current Problem

### 2.1 Current Lab Sulphur Is Not a Controlled Comparison

Current `/lab/video` runs Sulphur only. To compare with Wan, the user has to run `/video` separately and manually keep inputs aligned.

That leaves too many uncontrolled variables:

- prompt enhancement may differ per run
- seed is generated separately
- model settings are not visible in one comparison surface
- results are not paired in UI
- user has to remember which output belongs to which setup

### 2.2 Current Sulphur Lab Reuses Production LTX Sampling

Current Sulphur Lab is built by adapting the production LTX builder. That kept integration risk low, but it inherited LTX sampling assumptions that are not the target Sulphur setup.

Important current limitations:

- one shared `model_ref` is used for both base and upscale stages
- Lab LoRA options expand into one sequential chain, not stage-specific chains
- Sulphur LoRA default strength is `0.7`, while official-ish i2v should use Sulphur LoRA `1.0`
- production LTX sampling values can be accidentally reused in the wrong Sulphur stage

---

## 3. Claude-Validated Sampling Target

### 3.1 Corrected Decision

Claude validation found that the previous draft was wrong: the 9-value sigma list below is the **production LTX upscale** list, not the Sulphur official base value.

```text
1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0
```

Do not use that 9-value list as the default Sulphur base stage.

The default Sulphur Lab profile should use this mapping:

| Stage | Scheduler / sigmas | Notes |
|---|---|---|
| Base | `LTXVScheduler(steps=8, max_shift=4, base_shift=1.5, stretch=true, terminal=0.1)` | official-ish target |
| Upscale | `ManualSigmas("0.85, 0.7250, 0.4219, 0.0")` | official-ish target |

Both stages should use `euler_ancestral_cfg_pp`.

### 3.2 Optional Non-Official Experiment

If we later want to test the 9-value list as an identity or speed experiment, it must be a separate profile such as `experimental_manual_base_v1`.

It must not be named or documented as official Sulphur behavior.

### 3.3 Builder Requirements

Sulphur Lab should not mutate `LTX_VIDEO_PRESET` or production `_build_ltx` behavior.

Recommended implementation:

- add a Lab-only Sulphur builder path
- add explicit Lab-only constants/config:
  - `SULPHUR_BASE_SCHEDULER = {steps=8, max_shift=4, base_shift=1.5, stretch=True, terminal=0.1}`
  - `SULPHUR_UPSCALE_SIGMAS = "0.85, 0.7250, 0.4219, 0.0"`
- make tests assert the generated graph connects:
  - base sampler to an `LTXVScheduler` node with the exact widget values
  - upscale sampler to a `ManualSigmas` node with the exact sigma string
- add `_meta.title` labels or helper structure if needed so tests can identify stages reliably

---

## 4. Sulphur Stage Settings

### 4.1 Sampling

Target for `official_i2v_v1`:

```text
base_sampler = "euler_ancestral_cfg_pp"
base_scheduler = LTXVScheduler(
  steps=8,
  max_shift=4,
  base_shift=1.5,
  stretch=true,
  terminal=0.1
)

upscale_sampler = "euler_ancestral_cfg_pp"
upscale_sigmas = "0.85, 0.7250, 0.4219, 0.0"
```

Rationale:

- base follows the official-ish Sulphur graph behavior
- upscale uses a lower-start short schedule to avoid redrawing the face too aggressively
- the 9-value production LTX upscale list is intentionally excluded from the default Sulphur profile

### 4.2 LoRA Chain

Current Lab can only create one LoRA chain shared by base and upscale. That is not enough for Sulphur.

Claude validation confirmed this target matches the official graph structure:

| Stage | Apply order from checkpoint | Strength |
|---|---|---|
| Base | Sulphur distill LoRA, then Sulphur adult LoRA | `0.7`, then `1.0` |
| Upscale | Sulphur adult LoRA, then Sulphur distill LoRA | `1.0`, then `0.5` |

File names:

```text
sulphur_lora_rank_768.safetensors
ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors
```

Notes:

- The official HF workflow references `sulphur_final.safetensors`; local Lab uses `sulphur_lora_rank_768.safetensors`.
- Claude validation judged this substitution reasonable because `sulphur_final` is a workflow placeholder name.
- Full Sulphur checkpoint and Sulphur LoRA must remain mutually exclusive.
- Existing `adult_eros` can stay available as an experimental single-run toggle, but the paired default should be Sulphur-only to keep the comparison interpretable.

### 4.3 Image-to-Video Anchoring

Claude validation confirmed this official target:

```text
base LTXVImgToVideoInplace strength = 0.8
upscale LTXVImgToVideoInplace strength = 1.0
```

Reason:

- base can move enough to start the action
- upscale reanchors to the source image strongly

### 4.4 FPS and Duration

Claude validation confirmed this official target:

```text
fps = 24
duration = 5 sec
frame_count = 121  # 5 * 24 + 1
```

If this creates ComfyUI node or playback issues, record the reason in the plan result before falling back.

### 4.5 Preprocess Compression

Official workflow uses:

```text
LTXVPreprocess.img_compression = 38
```

Current Lab inherited value is:

```text
LTXVPreprocess.img_compression = 12
```

Decision for this phase:

- keep `12` as a deliberate face-preservation policy
- document it as a non-official deviation
- add a follow-up experiment for official `38`

### 4.6 Deliberate Non-Changes

Keep these unchanged in the first patch unless validation proves they are the cause:

- production `/video` presets
- production LTX sampling
- history DB schema
- output storage paths
- common dispatch / SSE transport
- source image upload path

---

## 5. Paired Comparison Flow

### 5.1 Default User Flow

```text
User uploads image
User writes one instruction
User selects "Wan vs Sulphur"
User clicks "Run Pair"
Backend analyzes image once
Backend creates one shared 5-beat English prompt
Backend runs Wan first
Backend runs Sulphur second using the same shared prompt
Frontend shows both videos side-by-side
```

Wan first is intentional:

- avoids running two large video models concurrently on one GPU
- gives the user a baseline quickly
- keeps failure handling simpler

### 5.2 Shared Prompt Rule

The comparison default should be **same enhanced prompt for both models**.

This means:

- do not run prompt enhancement separately for Wan and Sulphur
- do not let the Sulphur run rewrite the Wan prompt
- do not let auto-NSFW or model-specific prompt logic diverge silently
- store/show the shared final prompt in the pair UI

### 5.3 Sulphur-Compatible Shared Prompt Guide

Use this as the default paired Lab prompt shape:

```text
Preserve the exact identity, same face, same facial proportions, same hairstyle, same body proportions, same outfit details from the reference image. No face swap, no identity drift.

[Subject Description based on image], [Environment/Context].
Beat 1: [Initial reaction or preparation action]
Beat 2: [Action intensifies or changes body posture significantly]
Beat 3: [Major movement]
Beat 4: [Further development of the movement]
Beat 5: [Final resolution or lingering expression]
Camera work: [Specific camera movement matching the action]
Acting should be emotional and realistic.
4K details, natural color, cinematic lighting and shadows, crisp textures, clean edges, fine material detail, high microcontrast, realistic shading, accurate tone mapping, smooth gradients, realistic highlights, detailed fabric and hair, sharp and natural.
```

Important:

- This is a shared pair prompt, not a Sulphur-only rewrite.
- It keeps the comparison fair while using the action-beat structure Sulphur likely expects.
- The prompt generator must keep actions plausible within 5 seconds.
- Avoid overly large action changes when identity preservation is the goal.

### 5.4 Future Optional Prompt Modes

Not required in first implementation, but the API should leave room for:

| Mode | Meaning |
|---|---|
| `shared_5beat` | One Sulphur-compatible 5-beat prompt shared by both models. Recommended default. |
| `shared_plain` | One existing neutral video prompt shared by both models. Useful for regression comparisons. |
| `model_native` | Same image/instruction, but each model gets its own adapter. Better for best-output comparisons, not strict model-only comparison. |

First implementation should only ship `shared_5beat` unless scope pressure is low.

---

## 6. Backend API Shape

Add a new route rather than overloading the existing single Sulphur route:

```text
POST /api/studio/lab/video/pair
GET  /api/studio/lab/video/pair/stream/{task_id}
```

Request meta draft:

```json
{
  "prompt": "user instruction",
  "promptMode": "fast",
  "pairMode": "shared_5beat",
  "models": ["wan22", "ltx-sulphur"],
  "longerEdge": 1024,
  "seed": 123456789,
  "sulphurProfile": "official_i2v_v1"
}
```

Response stream should emit model-scoped stages:

```json
{
  "type": "pair-model-stage",
  "modelId": "wan22",
  "progress": 45,
  "stageLabel": "Wan sampling"
}
```

Final `done` should include both items:

```json
{
  "items": {
    "wan22": { "id": "...", "imageRef": "..." },
    "ltx-sulphur": { "id": "...", "imageRef": "..." }
  },
  "sharedPrompt": "...",
  "sharedPromptKo": "...",
  "pairMode": "shared_5beat",
  "sulphurProfile": "official_i2v_v1"
}
```

History DB should still store each output as normal `mode="video"` rows. Pair grouping can remain frontend/runtime-only for this phase to avoid schema migration.

### 6.1 Partial Failure and Interrupt

The pair route must define behavior for partial failure:

- If Wan fails before producing an item:
  - do not run Sulphur
  - emit an error with `failedModelId="wan22"`
- If Wan succeeds and Sulphur fails:
  - keep/persist the Wan item
  - emit a partial done/error payload with `failedModelId="ltx-sulphur"`
  - frontend should show Wan result and Sulphur failure state
- If user interrupts during Wan:
  - stop the current dispatch
  - mark both outputs incomplete
- If user interrupts during Sulphur:
  - keep Wan result
  - mark Sulphur incomplete

This is required because paired generation is sequential and long-running.

---

## 7. Frontend UX

### 7.1 Controls

Add a paired comparison panel on `/lab/video`:

- source image
- instruction prompt
- AI prompt mode
- longer edge
- `Run Wan + Sulphur`
- Sulphur profile label: `Official i2v v1`

Avoid exposing too many expert toggles in the first paired UI. Advanced per-model toggles can stay in the existing single-run Lab controls.

### 7.2 Result Layout

Side-by-side:

```text
Wan 2.2 i2v                  LTX 2.3 - Sulphur Lab
video                         video
seed / fps / frames / size    seed / fps / frames / size

Shared final prompt
```

The result must clearly show:

- both outputs came from one shared prompt
- which model ran first/second
- if Sulphur used `official_i2v_v1`
- partial failure state, if one side failed

---

## 8. Verification

### 8.1 Static Tests

Add backend builder tests:

- Sulphur base sampler uses `euler_ancestral_cfg_pp`.
- Sulphur base scheduler uses:
  - class_type `LTXVScheduler`
  - `steps=8`
  - `max_shift=4`
  - `base_shift=1.5`
  - `stretch=true`
  - `terminal=0.1`
- Sulphur base stage does **not** use the 9-value production LTX upscale sigma list.
- Sulphur upscale sampler uses:
  - `euler_ancestral_cfg_pp`
  - `ManualSigmas("0.85, 0.7250, 0.4219, 0.0")`
- Stage-specific LoRA chains are separate.
- LoRA basename substitution is correct:
  - `sulphur_lora_rank_768.safetensors`
  - not `sulphur_final.safetensors`
- `LTXVImgToVideoInplace` strengths are:
  - base `0.8`
  - upscale `1.0`
- `fps=24` and `frame_count=121`.
- Production LTX builder output remains unchanged.

Add route/pipeline tests:

- pair route creates one task
- shared prompt is generated once
- Wan dispatch runs before Sulphur dispatch
- final done payload includes both items
- history persistence called twice with `mode="video"`
- Wan failure prevents Sulphur run
- Sulphur failure preserves Wan result
- interrupt during Wan vs Sulphur has defined behavior

### 8.2 Runtime Smoke

Add a smoke script or manual checklist:

- run pair with one small source
- confirm Wan mp4 saved
- confirm Sulphur mp4 saved
- confirm no ComfyUI execution error
- confirm side-by-side UI loads both videos

### 8.3 Visual Acceptance

For first user validation:

- same source image
- same shared 5-beat prompt
- compare face identity
- compare motion coherence
- compare prompt obedience
- compare artifacts

The result is successful if the user can clearly decide whether Sulphur is better, worse, or only better under certain prompts/settings.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Reintroducing wrong 9-value base sigmas | Tests assert official base uses `LTXVScheduler`, not 9-value ManualSigmas. |
| Pair route takes long | Sequential execution is expected; show model-scoped progress. |
| Prompt guide improves Sulphur but harms Wan | It is still fair if shared. Future `model_native` can compare best-output mode. |
| Stage-specific builder becomes invasive | Keep it Lab-only and do not mutate production LTX builder. |
| History lacks pair grouping | Accept for phase 1; frontend can show current pair from stream response. |
| Sulphur fails after Wan succeeds | Partial result behavior is specified and tested. |
| Interrupt behavior is ambiguous | Define model-scoped interrupt semantics before implementation. |

---

## 10. Final Decisions From Claude Validation

| Topic | Decision |
|---|---|
| Base sampling | Use `LTXVScheduler`, not 9-value ManualSigmas. |
| Upscale sampling | Use `ManualSigmas("0.85, 0.7250, 0.4219, 0.0")`. |
| Sampler | Use `euler_ancestral_cfg_pp` for both stages. |
| LoRA chains | Use stage-specific chains. |
| LoRA basename | Use `sulphur_lora_rank_768.safetensors`; treat `sulphur_final` as placeholder. |
| i2v strength | Base `0.8`, upscale `1.0`. |
| FPS / frames | `24 fps`, `121 frames`. |
| img_compression | Keep `12` for face preservation in this phase; document as non-official. |
| Paired compare | Use shared 5-beat prompt, Wan first, Sulphur second. |
| DB grouping | Do not add pair grouping schema in this phase. |

