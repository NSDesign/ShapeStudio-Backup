# Active-Set Live Preview Design

**Date:** 2026-09-19  
**Status:** Proposed for review  
**Priority:** Core live preview first; small-screen focused mode second

## 1. Purpose

Shape Studio currently requires users to:

1. edit settings in Shape Types, Batch Configuration, or Set Manager;
2. press Apply;
3. press Generate in the sidebar;
4. inspect the result;
5. repeat until satisfied;
6. finally run a batch generation.

This separates control changes from their visible effect. The separation is especially disruptive for generative settings, where a user needs repeated visual feedback to understand a value.

The proposed feature adds an explicit **Live Preview** mode to the shared Shape Set Configuration workflow. While enabled, draft changes regenerate only the active shape set on the existing canvas. Other sets and generated work remain untouched.

This design intentionally removes the previously considered dedicated preview panel. The existing canvas is the preview surface.

## 2. Goals

1. Let value and property changes produce visible feedback without pressing Apply.
2. Regenerate only shapes belonging to the active set.
3. Preserve Apply as the explicit action that commits draft settings.
4. Keep normal Generate, Regenerate, and batch-generation workflows intact.
5. Prevent high-frequency controls from flooding generation work.
6. Avoid blank frames, flicker, stale results, and post-close updates.
7. Preserve unrelated generated shapes, selections, sets, and post-generation edits.
8. Provide a later small-screen mode that exposes the canvas while retaining access to the active control.

## 3. Non-goals

- A dedicated preview panel.
- A separate preview destination chooser.
- Live preview of all enabled sets at once.
- Automatically changing or reducing configured shape counts for performance.
- Replacing normal Generate or batch generation.
- Persisting the footer Live Preview toggle in the first release.
- Reworking the shape-generation algorithms themselves unless required to make generation side-effect-free.
- Shipping the mobile focused mode before the core live-generation path is reliable.

## 4. User experience

### 4.1 Footer control

The combined Shape Set Configuration dialog has a persistent footer:

```text
[ Live Preview  ○ ]                       [ Close ] [ Apply ]
```

When enabled:

```text
[ Live Preview  ●  Updating… ]            [ Close ] [ Apply ]
```

The control is a boolean switch with a visible label, not a second Apply-style button. It remains visible while moving among Shape Types, Batch Configuration, and Set Manager.

Standalone Batch Configuration and Set Manager dialogs use the same footer pattern.

Live Preview starts off whenever a new dialog session opens.

If Live Preview is enabled before the active set has generated shapes, it immediately creates an active-set result using the current draft, stable preview seed, and normal Generate rules. The empty active-set result is retained as the restore snapshot.

If no settings changed, the generated result represents the already committed configuration and may remain when the dialog closes. If settings changed and the user discards them, restoring the empty snapshot removes the preview-generated shapes.

### 4.2 Status

The footer may show these states:

- **Off** — draft changes do not regenerate shapes.
- **Ready** — enabled and the latest draft is represented on the canvas.
- **Waiting** — a continuous input is still changing or inside the coalescing interval.
- **Updating** — active-set generation is in progress.
- **Paused** — preview has been paused after repeated slow or failed updates.
- **Failed** — the last preview attempt failed; existing shapes remain visible.

Status text must not cause the footer layout to jump.

### 4.3 Draft and committed settings

All three tabs edit one shared draft configuration for the active set.

- **Live Preview off:** controls update only the draft.
- **Live Preview on:** controls update the draft and schedule active-set regeneration.
- **Apply:** validates and commits the draft to the active set.
- **Generate:** remains the normal explicit generation action.
- **Batch Generate:** remains the final production workflow.

The current mixed behaviour—some controls using local draft state, some immediately updating editor state, and some mutating the active set before Apply—must be replaced by this consistent model for settings covered by the dialog.

### 4.4 Closing with uncommitted changes

Close, Cancel, the dialog X, and Escape open one decision dialog when either:

- the draft differs from the committed set; or
- the live-preview session changed the active set's canvas result in a way that requires an explicit keep-or-restore decision.

#### Apply changes and keep preview

- Validate and commit the draft.
- Keep the latest valid preview result.
- If no valid result represents the final draft, commit settings without silently running normal generation.

#### Discard changes and restore previous result

- Discard the draft.
- Restore the pre-dialog active-set shape snapshot.
- Leave all other sets and shapes unchanged.

#### Continue editing

- Close the decision dialog.
- Return to the settings dialog without changing draft or canvas state.

The UI must not offer “keep previewed shapes but discard settings,” because those shapes would no longer be reproducible from the active-set configuration.

If the draft is unchanged, the dialog closes normally without prompting.

## 5. Session model

Opening a supported dialog creates one `LivePreviewSession`.

Conceptual session state:

```ts
type LivePreviewSession = {
  sessionId: string;
  activeSetId: string;
  committedConfig: GenerationSetDraft;
  draftConfig: GenerationSetDraft;
  originalShapes: Shape[];
  previewSeed: number;
  draftRevision: number;
  acceptedRevision: number | null;
  acceptedShapes: Shape[] | null;
  status: 'off' | 'ready' | 'waiting' | 'updating' | 'paused' | 'failed';
  isClosed: boolean;
};
```

The exact types may differ, but these responsibilities must remain explicit.

### 5.1 Session creation

Capture:

- the active set ID;
- a complete committed configuration snapshot;
- a mutable draft initialized from that snapshot;
- the current canvas shapes belonging to the active set;
- one stable preview seed;
- any immutable generation context required by the normal Generate path.

Other shapes are not copied into the preview session.

### 5.2 Active-set changes while open

Changing the selected active set is a transaction boundary.

If the current set has uncommitted draft changes, the user must resolve them with the same Apply/Discard/Continue decision before switching sets.

After resolution, create a new preview session for the newly active set. Pending work from the previous session is invalidated.

### 5.3 Stable randomness

The session captures one preview seed when Live Preview is enabled for the first time.

Every preview generated in that session reuses the seed. This lets users see the effect of the changed setting rather than an unrelated random arrangement.

A future “New variation” action may replace the preview seed explicitly, but it is not required for the first release.

## 6. Generation architecture

### 6.1 Isolated generation request

The preview scheduler passes a complete immutable request to the generation layer:

```ts
type ActiveSetPreviewRequest = {
  sessionId: string;
  revision: number;
  setId: string;
  seed: number;
  config: GenerationSetDraft;
  generationContext: PreviewGenerationContext;
};
```

Generation must not read mutable React closures to obtain the current settings. The request is the source of truth for that run.

### 6.2 Reuse normal generation rules

Preview output should match what the sidebar Generate action would produce for that active set and configuration.

The implementation should extract or reuse pure generation functions rather than duplicating shape math. Preview-specific code owns scheduling and result adoption, not an alternative renderer.

Any side effects currently embedded in normal Generate—persistence, selection mutation, toast notifications, generated-history updates, or unrelated set generation—must remain outside the pure generation function.

### 6.3 Active-set ownership

The implementation needs a reliable way to identify shapes generated by each set. If shapes already carry this ownership, preview replacement must use it. If ownership is currently inferred or absent, explicit non-visual set provenance must be added before preview replacement is enabled.

Only shapes owned by `activeSetId` may be replaced.

### 6.4 Atomic visual replacement

Existing active-set shapes stay on the canvas while a preview request runs.

When a valid result finishes:

1. confirm the session is still open;
2. confirm the result session ID matches the current session;
3. confirm its revision matches the latest draft revision;
4. construct the next canvas shape collection away from displayed state;
5. replace the active set’s shapes in one state commit.

The canvas must never be cleared while generation is pending.

## 7. Scheduling and performance

### 7.1 Event classes

#### Discrete controls

Examples:

- switches;
- dropdown selections;
- shape-type enable/disable;
- mode changes;
- palette selections.

These schedule a preview immediately, while still passing through revision checks.

#### Continuous controls

Examples:

- slider movement;
- range handles;
- numeric input typing;
- colour-drag interactions.

These update the draft immediately but use a trailing coalescing interval, initially targeted at 80–120 ms.

The final interval should be measured in the real app rather than hardcoded from this specification.

### 7.2 Latest revision wins

Every draft change increments `draftRevision`.

Only a result matching the latest revision may update the canvas. Earlier results are stale and discarded.

If the underlying generation function cannot be cancelled safely, stale work may finish, but it must not commit.

### 7.3 Work concurrency

At most one active-set preview generation should perform expensive work at a time.

If changes arrive while work is running:

- record only the latest pending revision;
- when the current run finishes, discard it if stale;
- start one new run for the latest snapshot;
- do not replay intermediate revisions.

### 7.4 Slow-preview protection

Instrument generation duration.

Pause Live Preview when repeated requests exceed an agreed threshold or fail repeatedly. Preserve current canvas shapes and show a clear footer message:

> Live Preview paused because this set is taking too long to update.

The user can resume manually.

Do not silently lower shape count, disable effects, or substitute a simplified rendering because the preview must remain representative of normal Generate.

### 7.5 Cleanup

Closing the session must:

- clear scheduler timers;
- mark the session closed;
- invalidate pending revisions;
- release retained shape/config snapshots;
- remove any session-level event listeners;
- prevent late async results from committing.

No timer, worker callback, or animation loop may survive its owning session.

## 8. Apply behaviour

Apply validates the draft using the same rules as the existing configuration path.

If the latest accepted preview matches the current:

- session ID;
- active set ID;
- draft revision;
- preview seed;

then Apply commits the draft and keeps the accepted canvas shapes without regenerating.

If no valid accepted preview exists, Apply commits the settings but does not automatically invoke normal Generate. The footer should not imply that the canvas represents the newly committed settings.

Persistence continues through the existing generation-set persistence layer after the in-memory commit.

## 9. Error handling

### Validation error

- Keep the dialog open.
- Show the existing validation treatment near the relevant control and/or footer.
- Do not schedule generation for an invalid draft.
- Preserve the last valid canvas result.

### Generation error

- Preserve existing active-set shapes.
- Mark the preview as failed.
- Keep the draft editable.
- Allow retry after the next valid change or explicit resume.
- Do not commit partial shape output.

### Apply persistence error

- Keep the dialog open.
- Keep the draft and latest valid preview available.
- Report that settings were not saved.
- Do not claim Apply succeeded.

### Restore error

Original active-set shapes are held in session memory, so discard should normally restore synchronously. If restoration cannot complete, keep the current canvas unchanged and report the failure rather than deleting shapes.

### Active set removed externally

Invalidate the preview session, stop pending work, preserve current canvas, and ask the user to close or select another set. Do not redirect preview output to another set.

## 10. Small-screen focused mode

This is a later milestone and must not block the core preview engine.

### 10.1 Entry

When Live Preview is enabled on a small screen, the footer exposes **Preview View**.

Entering Preview View is explicit in the first release. Focusing a control does not automatically collapse the dialog.

### 10.2 Layout

Preview View changes the dialog presentation into a bottom sheet:

- the existing canvas is visible above it;
- the sheet displays the currently focused control group;
- a breadcrumb identifies dialog tab, section, and setting;
- Previous and Next move between control groups;
- All Settings restores the full dialog;
- Live Preview status, Close, and Apply remain available.

The sheet remains at a stable height while the user drags a slider.

### 10.3 Shared state

The full dialog and focused sheet must use the same mounted draft/session state.

Do not create a second settings form or synchronize two draft copies. Presentation may change; ownership does not.

Where possible, keep controls mounted and change visibility/presentation. If a control must move between portals, preserve its value, focus target, and buffered input state explicitly.

### 10.4 Accessibility

Use the existing Radix Sheet/Dialog primitives rather than another custom overlay.

Required behaviour:

- accessible dialog name;
- focus trap;
- visible close control;
- Escape/back support;
- focus restoration to the Preview View trigger;
- one sheet scroll region;
- safe-area bottom padding;
- no gesture-only operation;
- logical keyboard order;
- no timer-driven automatic expansion.

## 11. Preferences

The first release does not persist Live Preview state.

- Every new dialog session starts with Live Preview off.
- The footer switch affects only the current dialog session.
- Moving between the three combined tabs retains the current session state.
- Closing the combined dialog resets the switch.

If later usage supports persistence, add an explicit user-level preference through the existing User Settings system. Do not create a separate device-preference store solely for Live Preview.

Runtime safeguards such as pause state, scheduler timing, and stale-result rejection are not user preferences.

## 12. Existing code integration points

Likely integration areas include:

- `client/src/components/ShapeSetsTabbedDialog.tsx`
  - shared dialog session and footer;
  - tab transitions;
  - close decision routing.
- `client/src/components/BatchConfigDialog.tsx`
  - existing local draft;
  - existing `onLiveSettingsChange` seam;
  - validation and control event classification.
- `client/src/components/SetsManagerDialog.tsx`
  - Apply/close flow;
  - current-set transitions.
- `client/src/components/GenerationSetsInterface.tsx`
  - direct set mutations that must be routed through the shared draft.
- `client/src/components/Sidebar.tsx`
  - dialog wiring;
  - current Generate path;
  - active-set context.
- `client/src/hooks/useShapeEditor.ts`
  - generation configuration state;
  - shape ownership and atomic replacement;
  - extraction of a side-effect-free active-set generation request.
- `client/src/hooks/useGenerationSetsPersistence.ts`
  - persistence after Apply, not during draft preview.

These are design pointers, not a mandate to place all new logic in these files. The scheduler and session reducer should be isolated in focused modules/hooks rather than enlarging `Sidebar.tsx` or the dialog components.

## 13. Testing strategy

### 13.1 Pure scheduler tests

Verify:

- continuous events coalesce into one latest request;
- discrete events schedule immediately;
- stale revisions never commit;
- only one expensive run is active;
- one latest pending run follows an obsolete run;
- closing invalidates pending timers and results;
- repeated slow/failing work pauses preview;
- resume starts from the latest valid draft.

Use deterministic fake timers and controlled generation promises.

### 13.2 Session reducer tests

Verify:

- session captures committed config and original active-set shapes;
- draft changes do not alter committed config;
- Apply commits the current draft;
- Discard restores original shapes/config;
- switching active sets requires resolution;
- other sets remain unchanged;
- stable preview seed is reused within a session.

### 13.3 Generation parity tests

For the same seed, active set, configuration, and context:

- normal active-set Generate and Live Preview produce equivalent shape output;
- preview generation has no persistence, toast, selection, or unrelated-set side effects.

### 13.4 Component tests

Verify:

- footer switch and status across all three tabs;
- Live Preview resets after dialog close;
- invalid controls do not schedule generation;
- Apply adopts a matching accepted preview;
- close decision has Apply, Discard, and Continue actions;
- standalone dialogs use the same semantics.

### 13.5 Integration tests

Verify:

- only active-set shapes are replaced;
- other set shapes and post-generation edits remain unchanged;
- old shapes remain visible until an accepted result is ready;
- rapid slider movement commits only the final revision;
- a late result after close cannot update the canvas;
- failed generation preserves the previous result;
- Apply persistence failure keeps the draft recoverable.

### 13.6 Performance checks

Measure with representative light, medium, and heavy active sets:

- input-to-preview latency;
- generation duration;
- main-thread blocking;
- dropped frames while dragging;
- memory before, during, and after repeated dialog sessions;
- retained timers/listeners after close.

Define the pause threshold from these measurements.

### 13.7 Mobile tests

For the later focused-mode milestone:

- viewport resizing and browser chrome changes;
- soft keyboard opening;
- focus restoration;
- safe-area padding;
- sheet scroll behaviour;
- slider dragging without sheet-height movement;
- switching between Preview View and All Settings without draft loss.

## 14. Delivery stages

### Stage 1 — Shared draft contract

- Define a canonical active-set draft.
- Route the three tabs through it.
- Preserve existing Apply behaviour.
- Add tests before enabling live generation.

### Stage 2 — Pure active-set generation

- Isolate reusable generation logic from UI and persistence side effects.
- Establish explicit shape-to-set ownership.
- Verify parity with normal Generate.

### Stage 3 — Scheduler and atomic replacement

- Add revisioned scheduling and event coalescing.
- Keep old shapes visible until atomic replacement.
- Add cleanup and stale-result protection.

### Stage 4 — Live Preview footer and close transaction

- Add session-only switch and status.
- Add Apply/Discard/Continue close decision.
- Add pause/retry behaviour.

### Stage 5 — Performance validation

- Profile representative configurations.
- Set measured timing and pause thresholds.
- Resolve leaks, long tasks, or canvas flicker before wider rollout.

### Stage 6 — Small-screen Preview View

- Add explicit focused bottom-sheet presentation.
- Preserve shared draft/session state.
- Complete accessibility and mobile interaction testing.

### Stage 7 — Optional persistent preference

- Consider only after observing actual usage.
- If justified, add it to existing user settings.

## 15. Acceptance criteria

The core feature is ready when:

1. Live Preview starts off and can be enabled from the shared dialog footer.
2. Valid edits across all three tabs visibly regenerate only the active set.
3. Rapid slider movement does not launch one generation per raw event.
4. Existing active-set shapes remain visible until a complete replacement is ready.
5. Stale or post-close results cannot change the canvas.
6. Other sets and unrelated generated work remain unchanged.
7. Apply commits the draft and reuses a matching preview result.
8. Closing with changes offers Apply, Discard, and Continue.
9. Discard restores the pre-dialog active-set shapes.
10. Generation failure preserves the previous canvas result.
11. Repeated slow updates pause preview with a clear recovery action.
12. Tests cover scheduling, stale results, cleanup, parity, Apply, and restore behaviour.
13. Enabling Live Preview with no active-set shapes generates an initial active-set result.
14. Discarding an edited initial preview restores the original empty active-set result.

The small-screen milestone is ready when the active control can be edited in a stable bottom sheet while the canvas remains visible, without duplicating draft state or breaking keyboard/focus behaviour.