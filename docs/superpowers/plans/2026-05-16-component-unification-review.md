# Component Unification Review

Date: 2026-05-16
Scope: frontend component reuse and duplicate UI patterns only.
Excluded: Lab, legacy, backend runtime, functional correctness, model behavior.

## Checklist

1. Common layout, section, and CTA components
2. Generate/Edit/Video/Compare left panel duplication
3. Image cards, history, and result viewer reuse
4. ProgressModal/PipelineTimeline duplication
5. Message/toast/empty-state copy management
6. CSS/inline style duplication and common class quality
7. Refactor priority

## Step 1 - Common Layout, Section, CTA

Status: reviewed.

Verdict: common foundations are good, but ownership boundaries are inconsistent.

Findings:

- P2: Page composition ownership differs by mode.
  Generate/Edit/Video panels own `StudioLeftPanel` and `StudioRightPanel`, while Compare wraps its panel from the page and Vision inlines the whole left/right content in the page.
  This makes layout policy changes require different edit locations by mode.
- P2: Left field headers are not componentized.
  The repeated pattern is `ais-field-header` + `ais-field-label` + inline flex alignment + `SectionAccentBar`.
  A `StudioFieldHeader` component would reduce drift across Generate/Edit/Video/Compare/Vision.
- P3: `ProcessingCTA` is well shared, but every mode repeats the sticky wrapper.
  A `StickyProcessingCTA` or `sticky` prop would make CTA placement policy one-source.

Keep:

- `StudioLayout` primitives are useful and should remain the page layout source.
- `StudioModeHeader`, `StudioResultHeader`, and `ProcessingCTA` are effective shared components.

Refactor candidates from Step 1:

1. Add `StudioFieldHeader`.
2. Add `StickyProcessingCTA` or a sticky option on `ProcessingCTA`.
3. Normalize panel ownership so each mode follows one composition pattern.

## Step 2 - Left Panel Duplication

Status: reviewed.

Verdict: shared components are used, but repeated wrapper patterns still make left panels larger than necessary.

Evidence:

- `GenerateLeftPanel.tsx`: 328 lines.
- `EditLeftPanel.tsx`: 448 lines.
- `VideoLeftPanel.tsx`: 456 lines.
- `CompareLeftPanel.tsx`: 283 lines.

Findings:

- P2: Prompt input shells are repeated across all four left panels.
  The recurring pattern is field header, `ais-prompt-shell`, `PromptHistoryPeek`, textarea, clear icon, and sometimes prompt tools.
  Generate/Edit/Video also repeat `PromptToolsButtons` and `PromptToolsResults`; Compare uses the same shell without tools.
  This should become a `StudioPromptInput`-style component with optional history, tools, clear button, disabled state, and placeholder props.
- P2: Toggle cards are only half-abstracted.
  `V5MotionCard` and `Toggle` are shared, but each panel still manually wires `className`, `data-active`, `onClick`, tooltip, icon, label, and nested controls.
  AI prompt correction and quality mode cards repeat strongly across Generate/Edit/Video.
  A thin `StudioToggleCard` would reduce visual drift without hiding mode-specific logic.
- P3: Header action buttons are repeated inline.
  Image history and library buttons share the same unset-button style, icon size, font size, gap, and color.
  This should be handled through `StudioFieldHeader` actions or a `FieldHeaderActionButton`.
- P3: File size is not the main problem, but responsibility density is.
  Edit and Video left panels combine store wiring, local modal state, section layout, CTA, prompt input, source image selection, toggle cards, and mode-specific controls.
  Extract only the repeated UI shells first; do not split mode-specific behavior prematurely.

Keep:

- `SourceImageCard`, `CompareImageSlot`, `PromptHistoryPeek`, `PromptToolsButtons`, `PromptToolsResults`, `PromptModeRadio`, `V5MotionCard`, and `ProcessingCTA` are legitimate shared building blocks.
- Mode-specific controls such as video NSFW, edit reference image, and generate snippet library behavior should stay owned by their mode until repeated elsewhere.

Refactor candidates from Step 2:

1. Add `StudioPromptInput`.
2. Add `StudioToggleCard` as a wrapper around `V5MotionCard` + `Toggle`.
3. Add `FieldHeaderActionButton`, preferably as part of `StudioFieldHeader`.
4. Keep mode-specific cards local unless a second mode needs the same behavior.

## Step 3 - Image Cards, History, Result Viewer Reuse

Status: reviewed.

Verdict: result and history reuse is strong; upload-card overlays and result captions still have avoidable duplication.

Evidence:

- `SourceImageCard.tsx`: 242 lines.
- `CompareImageSlot.tsx`: 269 lines.
- `HistoryGallery.tsx`: 288 lines.
- `HistoryTile.tsx`: 244 lines.
- `ResultBox.tsx`: 197 lines.
- `GenerateContent.tsx`: 224 lines.
- `EditContent.tsx`: 354 lines.
- `VideoContent.tsx`: 129 lines.

Findings:

- P2: `SourceImageCard` and `CompareImageSlot` correctly share `StudioUploadSlot`, but both still duplicate filled-state overlay primitives.
  The duplicate parts are image rendering, bottom filename/size strip, and frosted round icon buttons.
  A shared `UploadImagePreview`, `UploadSlotOverlayBar`, and `RoundIconButton` would remove the remaining duplication while keeping A/B badge behavior local to Compare.
- P2: Result caption rendering is duplicated across Generate/Edit/Video right panels.
  Each mode renders `ais-result-caption` and `ais-result-caption-prompt` around `upgradedPrompt || prompt`.
  This should be a tiny `ResultPromptCaption` component.
- P3: Lightbox mounting is repeated at page level for Generate/Edit/Video.
  The repetition is not severe, but filename/download/onUseAsSource wiring is similar enough that a small helper hook or wrapper could reduce drift.
- P3: Vision history is intentionally separate from `HistoryGallery`.
  `VisionHistoryList` uses a different localStorage-backed item shape and text-heavy tile, so forcing it into `HistoryGallery` would likely be premature.

Keep:

- `ResultBox` is a good shared result-shell abstraction. It owns idle/loading/done rendering, loading placeholder, fade transitions, and stable-height behavior.
- `HistoryGallery` and `HistoryTile` are legitimate shared components for persisted generate/edit/video history.
- `StudioUploadSlot` is the right low-level upload shell. It should remain variant-agnostic.
- Mode-specific result bodies (`GenerateContent`, `EditContent`, `VideoContent`, `VisionContent`, `CompareAnalysisPanel`) should stay separate because their interactions differ.

Refactor candidates from Step 3:

1. Add shared upload overlay primitives used by `SourceImageCard` and `CompareImageSlot`.
2. Add `ResultPromptCaption`.
3. Optionally add a lightbox helper after captions/upload overlays are cleaned.

## Step 4 - ProgressModal/PipelineTimeline Duplication

Status: reviewed.

Verdict: stage definitions are centralized well, but runtime adapter logic is duplicated across modal/timeline/hooks.

Evidence:

- `ProgressModal.tsx`: 484 lines.
- `PipelineTimeline.tsx`: 356 lines.
- `pipeline-defs.tsx`: 513 lines.
- `usePipelineStream.ts`: 98 lines.
- `createStageSlice.ts`: 86 lines.

Findings:

- P2: `ProgressModal` repeats mode-to-store selection in several local helpers.
  `useComfyInterruptAvailability`, `usePipelineRunning`, and `StatusBar` each subscribe to mode stores and branch by mode.
  The hook-rule constraint is real, but the mapping itself should live in one adapter, not be re-authored per subcomponent.
- P2: `PipelineTimeline` has its own mode runtime/context adapter.
  It repeats store subscription and mode branching for `stageHistory`, `running`, prompt mode, hide prompt flags, model labels, and context values.
  This overlaps conceptually with `ProgressModal.StatusBar`, but they are separate implementations.
- P2: Stage event normalization is still repeated in pipeline hooks.
  `consumePipelineStream` centralizes stream lifecycle, but Generate/Edit/Video/Vision/Compare still push progress/stage payloads differently.
  Edit and Video have near-identical `stageType/progress/stageLabel/sampling*` stripping logic.
- P3: Compare page does not use `useAutoCloseModal`.
  Generate/Edit/Video/Vision use the shared hook; Compare manually keeps `progressOpen` and timeout logic.

Keep:

- `PIPELINE_DEFS` is the right source for stage order, labels, enabled gates, and detail renderers.
- `PipelineTimeline`'s generic row computation and payload merge logic are strong and should stay centralized.
- `createStageSlice` is a good stage/sampling helper for Generate/Edit/Video.
- `usePipelineStream` is a good lifecycle helper for async stream consumption.

Refactor candidates from Step 4:

1. Add a `usePipelineRuntime(mode)` adapter shared by `ProgressModal` and `PipelineTimeline`.
2. Add a `usePipelineStatus(mode)` or selector helper for startedAt/progress/sampling/running.
3. Extract shared stage-event normalization for Edit/Video first.
4. Move Compare progress modal opening to `useAutoCloseModal`.

## Step 5 - Message, Toast, Empty-State Copy Management

Status: reviewed.

Verdict: toast rendering is centralized, but user-facing copy is still scattered and partly inconsistent.

Evidence:

- `useToastStore.ts`: `toast.info/success/warn/error` centralizes toast dispatch only; message text is supplied by callers.
- `useGeneratePipeline.ts`, `useEditPipeline.ts`, and `useVideoPipeline.ts` each define their own success, fallback, history-save, stream-incomplete, and failure messages.
- `loadImageFile` emits reusable error codes, but `SourceImageCard`, `CompareImageSlot`, `ReferenceImageBox`, and `app/vision/compare/page.tsx` each map those codes to Korean copy separately.
- `ResultBox` accepts `emptyState` and `loadingLabel`, but Generate/Edit/Video/Vision/Compare each inline result empty-state copy.

Findings:

- P2: Pipeline toast copy is repeated by mode instead of being config-driven.
  Generate/Edit/Video have the same semantic branches: validation warning, success, ComfyUI mock fallback, precise-prompt fallback, gemma4 fallback, history DB save failure, stream incomplete, and hard failure.
  The exact strings differ in small ways, so later copy changes require touching several pipeline hooks.
- P2: Image upload error messages are duplicated and inconsistent.
  `loadImageFile` already standardizes error codes, but callers translate them independently.
  Current visible differences include `이미지 파일만 업로드 가능`, `이미지 파일만 업로드 가능합니다.`, and `이미지 파일만 업로드할 수 있습니다.`
  This should be a shared `formatImageFileError(code)` or `IMAGE_UPLOAD_MESSAGES` helper.
- P3: Empty-state copy uses a shared component but not shared copy policy.
  The current inline copy is acceptable because each mode has different guidance, but the result-shell modes already follow a predictable shape.
  A small `RESULT_EMPTY_COPY[mode]` config would make future tone or wording changes safer without over-abstracting the UI.
- P3: Copy/clipboard toast handling is repeated across prompt, compare, and vision result components.
  The repeated pattern is empty-text guard, `navigator.clipboard.writeText`, success with character count, and generic copy failure.
  A `copyTextWithToast` helper would reduce boilerplate and keep copy feedback consistent.
- P3: User-facing tone is not fully consistent.
  Some messages use formal operational Korean, while others use casual wording such as `Mock 은 그대로 돌아가` or `백엔드 상태를 확인해줘`.
  The product should choose one tone for in-app copy and enforce it through shared messages.

Keep:

- `useToastStore` should remain the rendering/queue mechanism. It is intentionally small and should not become a copy catalog itself.
- Mode-specific empty-state descriptions can remain local until a common result copy map is introduced.
- Deep centralization of every text string is not needed now; start with repeated operational messages.

Refactor candidates from Step 5:

1. Add `PIPELINE_TOAST_COPY` keyed by mode and event type.
2. Add `formatImageFileError(code)` or `IMAGE_UPLOAD_ERROR_COPY`.
3. Add `copyTextWithToast` for repeated clipboard actions.
4. Optionally add `RESULT_EMPTY_COPY` for Generate/Edit/Video/Vision/Compare result shells.
5. Define one in-app Korean tone rule before bulk-changing copy.

## Step 6 - CSS, Inline Style, Common Class Quality

Status: reviewed.

Verdict: design tokens and several shared classes are strong, but inline styles have grown past the point where style policy is easy to maintain.

Evidence:

- Non-Lab/non-legacy frontend search found 575 `style={{ ... }}` occurrences under `frontend/app` and `frontend/components/studio`.
- Largest inline-style hotspots:
  - `ComparisonAnalysisModal.tsx`: 37
  - `lightbox/InfoPanel.tsx`: 27
  - `SnippetRegisterModal.tsx`: 26
  - `app/loading/page.tsx`: 21
  - `ImageHistoryPickerDrawer.tsx`: 20
  - `PromptHistoryPeek.tsx`: 19
  - `SnippetLibraryModal.tsx`: 18
  - `UpgradeConfirmModal.tsx`: 18
  - `lightbox/LightboxInner.tsx`: 17
- `frontend/app/globals.css` is 4,155 lines. The only other CSS file found is `components/prompt-flow/prompt-flow.module.css`.
- `globals.css` already defines useful tokens and shared classes such as `--bg`, `--surface`, `--accent`, `--green`, `--amber`, radius tokens, `ais-field-header`, `ais-prompt-shell`, `ais-cta-sticky-top`, result/action/history classes, drawer header classes, and section header classes.

Findings:

- P2: Inline style volume is too high for a project trying to keep component styling unified.
  Some inline styles are valid because they are data-driven, such as dynamic bar width, dynamic score color, or measured dimensions.
  But many are static layout, typography, spacing, overlay, modal, drawer, and button styles. Those should be class-driven to preserve hover/focus states and visual consistency.
- P2: `globals.css` is doing too many jobs.
  It contains core tokens, prompt shell styles, CTA styles, result viewer styles, history tiles, vision result styles, app header, settings drawer, cache UI, and other feature-level styling in one file.
  This works at runtime, but it makes ownership hard: a mode-specific style change can accidentally affect unrelated surfaces.
- P2: Field-header micro-layout is duplicated even though `ais-field-header` exists.
  The exact inline pattern `display: inline-flex`, `alignItems: baseline`, `gap: 8` appears repeatedly in Generate/Edit/Video/Compare/Vision field labels.
  This should move into the `StudioFieldHeader` candidate from Step 1 rather than remaining as local inline style.
- P2: Overlay/action-button styling is split between good shared CSS and local inline recreations.
  `ais-result-action-btn` and `ais-tile-action-btn` are strong examples: state is passed through data attributes and CSS owns hover/focus/disabled styling.
  Upload overlays, drawer close buttons, compare detail buttons, modal buttons, and image-picker cards often recreate similar styling inline instead of using the same pattern.
- P3: Hard-coded colors remain in TSX despite the token system.
  Examples include direct `#fff`, red/danger values, score fallbacks, and many `rgba(...)` overlays.
  Dark media overlays are sometimes justified, but danger/red and overlay tokens should be first-class if they are used repeatedly.
- P3: Some shared classes are high quality and should be preserved.
  `ais-result-action-btn`/`ais-tile-action-btn`, result shell classes, history grid/tile classes, CTA classes, and design tokens show the right direction.
  The goal should be to extend this pattern, not replace the styling system wholesale.

Keep:

- Keep root design tokens and the existing `ais-*` shared class strategy.
- Keep data-attribute driven styling for component states.
- Keep truly dynamic inline values where CSS variables or classes would make the code less clear.

Refactor candidates from Step 6:

1. Split `globals.css` by ownership, or import smaller global CSS files from the root stylesheet.
2. Add/extend shared classes for field label clusters, overlay bars, frosted icon buttons, drawer panels, modal shells, and danger buttons.
3. Replace static inline style hotspots incrementally, starting with `ComparisonAnalysisModal`, `ImageHistoryPickerDrawer`, upload overlays, and repeated left-panel field labels.
4. Add semantic tokens for repeated danger/red and overlay colors.
5. Keep dynamic measurement/progress styles inline unless they repeat across components.

## Step 7 - Refactor Priority

Status: reviewed.

Verdict: this project is not missing shared components; it has several good ones already. The main issue is that newer surfaces keep rebuilding common shells around those components.

Priority order:

1. P1: Normalize left-panel field, prompt, and CTA shells.
   - Add `StudioFieldHeader`.
   - Add `FieldHeaderActionButton`.
   - Add `StudioPromptInput`.
   - Add `StickyProcessingCTA` or a sticky option on `ProcessingCTA`.
   - Also move the repeated field-label micro inline style into the component/class layer.
   - Reason: highest reuse gain, low runtime risk, and it reduces Generate/Edit/Video/Compare/Vision drift immediately.

2. P1: Extract upload/result micro-primitives.
   - Add `UploadImagePreview`, `UploadSlotOverlayBar`, and shared frosted `RoundIconButton`.
   - Add `ResultPromptCaption`.
   - Add shared image upload error copy mapping.
   - Reason: removes duplicated visible UI around source images, compare slots, and result captions without touching generation behavior.

3. P2: Consolidate pipeline runtime adapters.
   - Add `usePipelineRuntime(mode)` for `ProgressModal` and `PipelineTimeline`.
   - Add `usePipelineStatus(mode)` or a selector helper.
   - Extract shared Edit/Video stage-event normalization.
   - Move Compare modal opening to `useAutoCloseModal`.
   - Reason: meaningful maintenance win, but higher hook/store regression risk than the UI shell work.

4. P2: Centralize repeated operational copy.
   - Add `PIPELINE_TOAST_COPY`.
   - Add `copyTextWithToast`.
   - Optionally add `RESULT_EMPTY_COPY`.
   - Define one in-app Korean tone rule before changing existing text.
   - Reason: improves consistency and future changes, but broad copy edits should be staged to avoid noisy diffs.

5. P2/P3: Reduce CSS debt incrementally.
   - Split or segment `globals.css` by ownership.
   - Replace static inline styles in the biggest hotspots.
   - Add danger/red and overlay tokens.
   - Reason: important for long-term maintainability, but visual regression risk is higher. Do this after shared component boundaries are clearer.

Do not prioritize:

- Do not merge mode-specific result bodies into one mega component.
- Do not force Vision history into `HistoryGallery`.
- Do not centralize every text string at once.
- Do not rewrite `globals.css` wholesale.
- Do not include Lab-specific cleanup in this review scope.

Recommended first implementation batch:

1. `StudioFieldHeader` + `FieldHeaderActionButton`.
2. `StudioPromptInput`.
3. `StickyProcessingCTA`.
4. `formatImageFileError`.

This batch is the cleanest first move because it reduces duplication across the highest-traffic screens while staying mostly presentation-layer only.

## Addendum - Architecture Checks 1-4

Status: reviewed.

Scope: non-Lab, non-legacy architecture checks requested after the component review. This addendum intentionally goes beyond the original component-only scope and covers state/hook ownership, API contracts, failure/cancel flow, and render efficiency. Review method was static source inspection only.

### A1 - State Management and Hook Ownership

Verdict: usable, but orchestration ownership is not uniform enough for easy maintenance.

Findings:

- P2: Pipeline orchestration has no single ownership pattern.
  Generate/Edit/Video use dedicated hooks with `consumePipelineStream` (`frontend/hooks/useGeneratePipeline.ts:114`, `frontend/hooks/useEditPipeline.ts:143`, `frontend/hooks/useVideoPipeline.ts:103`), but Vision Compare still owns analysis orchestration directly in the page (`frontend/app/vision/compare/page.tsx:138`).
  This makes lifecycle policy changes, modal handling, and failure handling mode-specific instead of reusable.
- P2: Running/progress shape differs by mode.
  Generate uses `setRunning(generating, progress, stage)` (`frontend/stores/useGenerateStore.ts:82`), while Edit/Video use a bool plus separate pipeline fields (`frontend/stores/useEditStore.ts:128`, `frontend/stores/useVideoStore.ts:139`), and Vision/Compare derive more state from `stageHistory` (`frontend/stores/useVisionStore.ts:130`, `frontend/stores/useVisionCompareStore.ts:136`).
  The shared `createStageActions` foundation is good, but runtime adapters still need mode-specific glue.
- P3: Pipeline hooks mix API calls, store mutation, toast copy, history insertion, prompt history, and stage normalization.
  The current size is manageable, but tests and future reuse would improve if API lifecycle and UI side effects were separated after the UI component cleanup.

Keep:

- Keep `createStageSlice` / `createStageActions` as the shared stage foundation (`frontend/stores/createStageSlice.ts:63`).
- Keep grouped Zustand selectors with `useShallow` for common input/runtime bundles (`frontend/stores/useGenerateStore.ts:277`, `frontend/stores/useEditStore.ts:254`, `frontend/stores/useVideoStore.ts:261`).
- Keep the per-image prompt invariant in Compare: `setPerImagePrompt` clears the matching `inFlight` slot (`frontend/stores/useVisionCompareStore.ts:143`) and has focused test coverage (`frontend/__tests__/use-vision-compare-store-per-image.test.ts:104`).

Recommended cleanup:

1. Extract `useVisionComparePipeline` so Compare analysis follows the same page -> hook -> API pattern.
2. Add a small `PipelineRuntime` selector/helper per mode before changing `ProgressModal` or `PipelineTimeline`.
3. Keep store state mode-specific where behavior genuinely differs; normalize only lifecycle/read-model access.

### A2 - API Types and Data Contract Alignment

Verdict: the live camelCase contract looks mostly consistent, but drift protection is weaker than it should be because many frontend contracts are still manual.

Findings:

- P2: Generated OpenAPI types exist, but manual app-level types still carry much of the contract.
  `TaskCreated` is imported from generated helpers in API clients (`frontend/lib/api/generate.ts:117`, `frontend/lib/api/compare.ts:146`), while `HistoryItem`, `VisionCompareAnalysisV4`, request types, and stage event types are manually maintained in `frontend/lib/api/types.ts:231` and `frontend/lib/api/types.ts:269`.
  This is not broken, but schema drift will not be caught uniformly.
- P2: API error parsing is duplicated and inconsistent.
  Generate/Compare throw status-only errors for create failures (`frontend/lib/api/generate.ts:114`, `frontend/lib/api/compare.ts:143`), while other clients have their own parsing behavior.
  A shared `readApiError` or `apiFetch` wrapper would improve user-facing error quality and reduce repeated code.
- P3: SSE payload validation is uneven.
  `compareAnalyze` validates malformed `done` payloads (`frontend/lib/api/compare.ts:179`), but other stream clients mostly cast event data after `parseSSE` (`frontend/lib/api/client.ts:91`, `frontend/lib/api/generate.ts:128`).
  Lightweight guards for `done.item`, `imageRef`, and `savedToHistory` would catch backend/frontend drift earlier.

Keep:

- Keep the backend-to-frontend camelCase history mapping.
  Backend persistence returns `imageRef`, `sourceRef`, `comparisonAnalysis`, `autoNsfw`, and `nsfwIntensity` in frontend shape (`backend/studio/history_db/items.py:220`, `backend/studio/history_db/items.py:227`, `backend/studio/history_db/items.py:228`, `backend/studio/history_db/items.py:251`).
- Keep dual `promptMode` / `prompt_mode` tolerance at backend boundaries for compatibility (`backend/studio/routes/streams.py:102`, `backend/studio/routes/streams.py:351`).

Recommended cleanup:

1. Prefer generated OpenAPI helper types where the schema already covers the route.
2. Keep manual types only for SSE `done` payloads that OpenAPI cannot describe well, and add focused contract tests for those.
3. Centralize API error detail extraction before changing toast text globally.

### A3 - Error, Partial Failure, and Cancel Flow

Verdict: backend cancellation and the main stream lifecycle are solid. Frontend consistency is the main issue.

Findings:

- P2: Main generation modes share good stream lifecycle behavior, but Compare analysis bypasses the shared helper.
  `consumePipelineStream` guarantees `onIncomplete`, `onError`, and `onFinally` paths (`frontend/hooks/usePipelineStream.ts:71`), and Generate/Edit/Video use it.
  Compare analysis instead implements lifecycle handling in the page and API client (`frontend/app/vision/compare/page.tsx:151`, `frontend/lib/api/compare.ts:157`), so future lifecycle fixes must be duplicated.
- P2: Partial-success copy is handled locally per hook.
  Generate/Edit/Video each inspect `savedToHistory` or fallback metadata and emit their own success/warn text (`frontend/hooks/useGeneratePipeline.ts:139`, `frontend/hooks/useEditPipeline.ts:225`, `frontend/hooks/useVideoPipeline.ts:166`).
  This matches current behavior, but it should be part of the planned message/toast copy map before more modes are added.
- P3: Compare per-image prompt failure handling is okay, but it lives at page level.
  The success path clears `inFlight` in the store (`frontend/stores/useVisionCompareStore.ts:143`), and the error path clears it in the page catch block (`frontend/app/vision/compare/page.tsx:212`).
  This is correct now, but moving the orchestration into a hook would make the invariant easier to protect.

Keep:

- Keep backend SSE disconnect cancellation.
  `_stream_task` checks disconnects and calls `task.cancel()` (`backend/studio/routes/_common.py:84`), and cancellation also runs on generator cancellation (`backend/studio/routes/_common.py:101`).
- Keep task close/cancel draining semantics (`backend/studio/tasks.py:78`, `backend/studio/tasks.py:88`).
- Keep pipeline `CancelledError` re-raise plus `close()` in `finally` for Generate/Edit/Video (`backend/studio/pipelines/generate.py:227`, `backend/studio/pipelines/edit.py:267`, `backend/studio/pipelines/video.py:306`).

Recommended cleanup:

1. Move Compare analysis into a hook and reuse `consumePipelineStream` semantics where practical.
2. Add one shared message mapping for saved-to-history failure, fallback provider, incomplete stream, and retryable API failure.
3. Keep cancellation behavior backend-owned; frontend should only present a clear interrupted/incomplete state.

### A4 - Render Efficiency and Subscription Scope

Verdict: no immediate performance blocker found. The main inefficiency is repeated filtering/subscription work around shared runtime components.

Findings:

- P3: History filtering is inconsistent across right panels.
  Generate memoizes filtered history (`frontend/components/studio/generate/GenerateRightPanel.tsx:57`), while Edit and Video filter inline on every render (`frontend/components/studio/edit/EditRightPanel.tsx:64`, `frontend/components/studio/video/VideoRightPanel.tsx:39`).
  With the 2000-item cap this is not urgent, but it is an easy consistency fix.
- P3: `ProgressModal` and `PipelineTimeline` subscribe broadly across mode stores.
  `PipelineTimeline` intentionally subscribes to all mode runtimes and branches by `mode` (`frontend/components/studio/progress/PipelineTimeline.tsx:176`), while `ProgressModal` repeats broad runtime/status subscriptions (`frontend/components/studio/ProgressModal.tsx:120`, `frontend/components/studio/ProgressModal.tsx:156`, `frontend/components/studio/ProgressModal.tsx:180`).
  The arrays are small, but this reinforces the need for a runtime adapter before more modes are added.
- P3: Timeline computation rebuilds lookup maps and scans stage history every live tick.
  The tick runs every 200ms while active (`frontend/components/studio/progress/PipelineTimeline.tsx:44`), and each render rebuilds maps and repeated `some`/`findIndex` scans (`frontend/components/studio/progress/PipelineTimeline.tsx:58`, `frontend/components/studio/progress/PipelineTimeline.tsx:232`, `frontend/components/studio/progress/PipelineTimeline.tsx:294`).
  Current stage histories are small, so this is cleanup-level, not a blocker.

Keep:

- Keep `HistoryGallery` grouping and masonry memoization (`frontend/components/studio/HistoryGallery.tsx:85`, `frontend/components/studio/HistoryGallery.tsx:219`).
- Keep `ImageHistoryPickerDrawer` memoized filtering and visible item cap (`frontend/components/studio/ImageHistoryPickerDrawer.tsx:87`, `frontend/components/studio/ImageHistoryPickerDrawer.tsx:104`, `frontend/components/studio/ImageHistoryPickerDrawer.tsx:124`).
- Keep the bounded history persistence rationale; 2000 URL-only rows are documented as acceptable (`frontend/stores/useHistoryStore.ts:12`).

Recommended cleanup:

1. Normalize Edit/Video history filtering to the Generate pattern, or expose memo-friendly selectors.
2. Memoize derived timeline maps/context after introducing a `PipelineRuntime` helper.
3. Treat render efficiency as a follow-up to component/runtime unification, not the first implementation batch.
