# Active-Set Live Preview Implementation Plan

**Date:** 2026-09-19  
**Based on:** `docs/superpowers/specs/2026-09-19-active-set-live-preview-design.md`

## Objective

Implement session-only Live Preview across Shape Types, Batch Configuration, and Set Manager. Draft changes regenerate only the active set on the live canvas, while Apply remains the explicit configuration commit.

The work is divided into independently verifiable stages. Each stage must pass its tests before the next stage begins.

## Guiding constraints

- Do not run the full normal generation side-effect path for every control event.
- Do not clear active-set shapes before a replacement is complete.
- Do not mutate unrelated sets or shapes.
- Do not persist draft settings.
- Do not allow stale or post-close generation results to update the canvas.
- Do not implement mobile Preview View until the core desktop/session path is stable.
- Preserve current behaviour when Live Preview is off.

## Phase 0 — Establish baseline and instrumentation

### Work

1. Document the current Generate path from the sidebar through shape creation and canvas commit.
2. Confirm how generated shapes identify their source generation set.
3. Record representative light, medium, and heavy active-set configurations.
4. Add development-only timing around current active-set generation.
5. Capture baseline:
   - generation duration;
   - main-thread long tasks;
   - canvas commit duration;
   - shape counts;
   - memory before and after repeated Generate operations.

### Likely files

- `client/src/components/Sidebar.tsx`
- `client/src/hooks/useShapeEditor.ts`
- generation/scatter helpers identified during implementation
- shape type definitions in `shared/`

### Verification gate

- Existing Generate and batch generation behave unchanged.
- Baseline timings are reproducible.
- Every generated shape can be mapped reliably to its source set, or Phase 1 includes explicit provenance.

## Phase 1 — Canonical active-set draft model

### Work

1. Define a canonical draft type representing all settings editable through:
   - Shape Types;
   - Batch Configuration;
   - Set Manager/current-set editing.
2. Add conversion helpers:
   - committed set to draft;
   - current editor state to draft where legacy state is still required;
   - validated draft to generation request;
   - validated draft to committed generation set.
3. Introduce one session reducer/hook that owns:
   - committed snapshot;
   - draft;
   - dirty comparison;
   - active set ID;
   - original active-set shapes;
   - preview seed;
   - revision counters;
   - session lifecycle.
4. Route all three combined tabs through the shared draft.
5. Preserve existing Apply behaviour while Live Preview remains unavailable.
6. Stop controls from mutating the persisted active set before Apply.
7. Handle active-set switching:
   - clean draft switches immediately;
   - dirty draft requires Apply, Discard, or Continue.

### Likely files

- new focused hook/module such as `client/src/hooks/useLivePreviewSession.ts`
- new draft helpers under `client/src/lib/`
- `client/src/components/ShapeSetsTabbedDialog.tsx`
- `client/src/components/BatchConfigDialog.tsx`
- `client/src/components/SetsManagerDialog.tsx`
- `client/src/components/GenerationSetsInterface.tsx`
- `client/src/components/Sidebar.tsx`

### Tests

- committed settings are not changed by draft edits;
- Shape Types, Batch Configuration, and Set Manager update the same draft;
- Apply commits the complete draft once;
- Discard restores the committed draft;
- dirty set switching requires resolution;
- clean set switching creates a fresh session.

### Verification gate

- With Live Preview absent/off, users see no regression in existing Apply flows.
- Closing without changes remains immediate.
- No draft edit reaches persistence before Apply.

## Phase 2 — Pure active-set generation boundary

### Work

1. Separate active-set shape calculation from UI side effects.
2. Define an immutable generation request containing:
   - session/revision metadata;
   - active set ID;
   - stable seed;
   - complete validated draft;
   - required artboard and generation context.
3. Define a pure or controlled async result containing generated active-set shapes.
4. Keep outside this boundary:
   - React state commits;
   - persistence;
   - toasts;
   - selection changes;
   - generation history;
   - unrelated set generation.
5. Reuse the same shape-generation rules as sidebar Generate.
6. Add explicit `generationSetId` provenance if shape ownership is not currently reliable.

### Likely files

- current generation/scatter helpers found in Phase 0
- `client/src/hooks/useShapeEditor.ts`
- shared shape types
- new `client/src/lib/activeSetGeneration.ts`

### Tests

- same seed + config + context produces equivalent output through normal Generate and the active-set function;
- result shapes carry correct set provenance;
- active-set generation has no persistence or UI side effects;
- other sets are never included.

### Verification gate

- Normal Generate still produces the same output.
- Preview-compatible generation can run without mutating React state.

## Phase 3 — Atomic active-set replacement

### Work

1. Add one canvas-state operation that replaces only shapes owned by the active set.
2. Preserve:
   - other-set shapes;
   - their order;
   - post-generation edits;
   - unrelated selection state.
3. Build the next shape collection before committing.
4. Keep old active-set shapes displayed until the replacement is ready.
5. Define selection behaviour for replaced active-set shapes:
   - remove stale selected IDs;
   - preserve selection only where stable IDs are intentionally retained.
6. Add restore operation using the session's original shape snapshot.
7. Support an originally empty active set.

### Likely files

- `client/src/hooks/useShapeEditor.ts`
- canvas/selection state helpers
- new focused replacement helper and tests

### Tests

- only active-set shapes are replaced;
- other sets remain byte-for-byte equivalent;
- an empty active set can receive a generated result;
- restoring an empty snapshot removes preview-created shapes;
- restore returns pre-dialog shape data and ordering;
- invalid selected IDs are removed safely.

### Verification gate

- No canvas clear/flicker occurs during replacement.
- Restore is synchronous from the captured snapshot.

## Phase 4 — Revisioned preview scheduler

### Work

1. Implement a scheduler independent of React rendering.
2. Classify events:
   - discrete: immediate scheduling;
   - continuous: trailing coalescing, initially 80–120 ms.
3. Increment revision on every valid draft change.
4. Permit at most one expensive generation run at once.
5. Retain only one latest pending request.
6. Reject results when:
   - session ID is stale;
   - session is closed;
   - active set changed;
   - revision is not latest.
7. Track duration and consecutive slow/failing runs.
8. Pause after measured thresholds are exceeded.
9. Expose status:
   - off;
   - ready;
   - waiting;
   - updating;
   - paused;
   - failed.
10. Ensure teardown clears timers and prevents late commits.

### Likely files

- new `client/src/lib/livePreviewScheduler.ts`
- new `client/src/hooks/useActiveSetLivePreview.ts`
- session hook from Phase 1

### Tests

Use fake timers and controlled promises to verify:

- continuous events collapse to the latest request;
- discrete events schedule immediately;
- intermediate revisions are skipped;
- stale completions cannot commit;
- a late completion after close cannot commit;
- one latest pending run starts after the current run;
- pause and resume use the latest valid draft;
- timers and retained snapshots are released on teardown.

### Verification gate

- Scheduler tests are deterministic.
- Rapid synthetic slider events produce bounded generation calls.

## Phase 5 — Live Preview footer and initial generation

### Work

1. Add a session-only Live Preview switch to the shared footer.
2. Match existing control standards:
   - labelled boolean switch;
   - cyan enabled state;
   - stable status area;
   - accessible description.
3. Keep the switch active while navigating among the three tabs.
4. Reset it when the combined dialog session closes.
5. Add the same semantics to standalone Batch Configuration and Set Manager dialogs.
6. On enable:
   - capture/reuse the session seed;
   - if the active set has no shapes, generate an initial result immediately;
   - otherwise wait for a draft change unless product testing shows immediate refresh is clearer.
7. Route valid draft changes into the scheduler.
8. Prevent invalid drafts from scheduling.
9. Add Resume action for paused preview.

### Likely files

- `client/src/components/ShapeSetsTabbedDialog.tsx`
- `client/src/components/BatchConfigDialog.tsx`
- `client/src/components/SetsManagerDialog.tsx`
- footer/status component extracted to a reusable file

### Tests

- preview starts off for every new session;
- enabling persists across the three tabs;
- closing resets it;
- empty active set generates immediately;
- invalid draft leaves the last valid result visible;
- footer status follows scheduler state;
- standalone and combined dialogs share semantics.

### Verification gate

- Existing behaviour is unchanged while the switch is off.
- Enabling preview never changes another set.

## Phase 6 — Apply, close, discard, and persistence transaction

### Work

1. Track two independent change conditions:
   - draft differs from committed settings;
   - preview changed the active-set canvas result and may require restoration.
2. Intercept:
   - Close button;
   - Cancel;
   - dialog X;
   - Escape;
   - backdrop close.
3. Show one decision dialog with:
   - Apply changes and keep preview;
   - Discard changes and restore previous result;
   - Continue editing.
4. Apply:
   - validate draft;
   - commit to active set;
   - persist through existing set persistence;
   - retain a matching accepted preview;
   - do not regenerate if the accepted revision is current.
5. Discard:
   - restore committed draft;
   - restore original active-set shape snapshot;
   - invalidate pending work;
   - close.
6. Continue:
   - retain draft and preview;
   - return focus to the dialog.
7. Handle persistence failure:
   - keep dialog open;
   - retain draft and valid preview;
   - show failure;
   - do not claim success.
8. If no settings changed and an initial preview represents committed settings, permit normal close while retaining that generated result.

### Likely files

- shared dialog shell
- session hook/reducer
- generation-set persistence hook
- reusable close-decision dialog

### Tests

- every close route invokes the same decision;
- Apply commits once and retains matching preview;
- Discard restores settings and shapes;
- Discard from an originally empty canvas removes preview shapes;
- Continue keeps the session intact;
- persistence failure remains recoverable;
- no prompt appears when neither settings nor restorable canvas state requires a decision.

### Verification gate

- There is no route that silently loses dirty settings.
- Canvas and committed configuration cannot be left knowingly inconsistent.

## Phase 7 — Performance profiling and hardening

### Work

1. Repeat baseline scenarios with Live Preview.
2. Measure:
   - input-to-visible-result latency;
   - generation duration;
   - long tasks;
   - frame drops;
   - canvas commit duration;
   - memory after repeated sessions;
   - retained timers/listeners.
3. Set actual coalescing and pause thresholds from measurements.
4. Profile expensive rendering modes and high shape counts.
5. Confirm no generated result commits after dialog teardown.
6. Add lightweight development diagnostics without production log noise.
7. Run an independent architecture/code safety review before mobile work.

### Verification gate

- No uncontrolled event flood.
- No white/blank canvas flicker.
- No growing retained-memory trend across repeated sessions.
- Slow configurations pause clearly rather than freezing the UI.

## Phase 8 — Small-screen Preview View

### Work

1. Add explicit Preview View action when Live Preview is enabled on a small screen.
2. Use Radix Sheet/Dialog semantics.
3. Show in the bottom sheet:
   - tab/section/control breadcrumb;
   - active control group;
   - Previous and Next control navigation;
   - All Settings;
   - Live Preview status;
   - Close and Apply.
4. Keep the existing canvas visible above the sheet.
5. Keep sheet height stable during continuous input.
6. Reuse the same mounted session/draft state.
7. Define reusable control-group boundaries for navigation.
8. Preserve buffered input state and focus while changing presentation.
9. Add safe-area and mobile keyboard handling.
10. Do not add automatic timeout-based restoration.

### Likely files

- `client/src/components/ShapeSetsTabbedDialog.tsx`
- shared responsive dialog/sheet shell
- control-group wrapper component
- existing Radix sheet primitive
- responsive/mobile tests

### Tests

- Preview View is explicit;
- All Settings restores the full dialog;
- draft and preview state survive both transitions;
- keyboard focus is restored correctly;
- soft keyboard does not cause uncontrolled jumps;
- one scroll region is active;
- slider drag does not resize the sheet;
- Apply/Discard behaviour matches desktop.

### Verification gate

- Canvas remains meaningfully visible on target mobile viewports.
- No duplicated settings state exists.
- Keyboard and screen-reader flows are usable.

## Phase 9 — Optional user preference evaluation

Do not implement initially.

After real usage, decide whether User Settings should expose a persistent default:

- off when a dialog opens;
- on until refresh;
- remembered between sessions.

If added, use the existing user-level settings system. Do not create a separate device-preference store solely for this feature.

## Cross-phase validation commands

Use the project's exact available scripts, with these as the minimum expected checks:

```bash
npx tsc --noEmit
npx vitest run
git diff --check
```

Add focused test commands for the session reducer, scheduler, generation parity, shape replacement, and dialogs as those suites are created.

After code changes:

1. restart the application workflow once per coherent implementation batch;
2. inspect workflow and browser logs;
3. verify the live app visually;
4. test at desktop and mobile viewport sizes for the relevant phase.

## Rollout and rollback boundaries

Each phase should land behind an internal feature flag until Phase 7 passes.

Recommended flags:

- active-set draft refactor;
- live-preview scheduler;
- live-preview footer;
- mobile Preview View.

If a stage causes regressions, disable that stage without reverting the earlier pure draft/generation work.

## Completion definition

The complete discussed feature is delivered when:

- all three dialogs share one draft model;
- session-only Live Preview updates only active-set shapes;
- initial preview works with no existing shapes;
- rapid control changes are coalesced;
- results are stable, revisioned, and flicker-free;
- Apply keeps the latest matching preview;
- close offers Apply, Discard, and Continue when required;
- Discard restores the exact pre-dialog active-set result;
- failed/slow previews preserve usable canvas state;
- no timers or stale results survive close;
- mobile Preview View exposes canvas and active controls without duplicating state;
- all core, integration, performance, and mobile checks pass.