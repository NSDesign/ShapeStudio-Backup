# Shape Editor - Replit Development Guide

## Overview
Shape Editor is a web-based application for creating, manipulating, and composing geometric shapes. It provides a comprehensive toolset for digital artists and designers to create complex graphic compositions, targeting creative professionals and hobbyists, with features like procedural generation, boolean operations, and smart distribution algorithms.

## User Preferences
Preferred communication style: Simple, everyday language. Responses must be concise — use bullet points wherever possible, avoid verbose explanations. Less is more.

**Before every task — check available skills**: Review the skills list and load any skill whose description matches the work being done. Do this before writing code, not after. Skills cover UI standards, PDF handling, design patterns, and more — if a relevant skill exists, it must be read first.

**No backward compatibility with saved projects**: Do not add legacy fallbacks, migration shims, or "old saved projects" compatibility code. Ever. If a field name or data shape changes, just change it — do not write fallback reads for the old field. This applies to all shapeSpecific state, schema fields, and any other persisted data.

**Scroll preservation in nested scrollable components**: When a scrollable container (a panel, list, or accordion with `overflow-y-auto`) resets its scroll position on value changes, the root cause is almost always a component being declared *inside* another component's function body — React sees a new function identity on every parent render, remounts the inner component, and scroll resets to top. Two solutions exist; always prefer Solution 1.

- **Solution 1 — Extract to module level (preferred)**: Move the component definition to the top of the file, *outside* any other function. Pass all dependencies as explicit props and wrap with `React.memo`. The reference implementation is `ShapeTypesContent` / `ShapeTypesContentMemo` in `Sidebar.tsx` (see the `// Memoized ShapeTypesContent - extracted to top level to prevent remounting on parent re-renders` comment). When consumed, render it as a normal JSX element — React will reconcile it in-place instead of remounting.

- **Solution 2 — Scroll-position lock (fallback when extraction is impractical)**: Attach a `ref` to the scrollable `<div>`, then use three refs (`scrollPositionRef`, `scrollLockEndTimeRef`, `scrollLockRafRef`) and a `saveScrollPosition` callback that captures `scrollTop` and sets a 100 ms time-based lock. A `useLayoutEffect` (runs after every render, no dependency array) checks whether the lock is still active and uses `requestAnimationFrame` to keep restoring `scrollTop` until the lock expires. Wire `saveScrollPosition` to `onPointerDown`, `onFocusCapture`, and `onKeyDown` on the scroll container. The reference implementation is at lines ~7992–8035 and ~10325–10330 in `Sidebar.tsx`.

**Before any UI work — mandatory**: Read `.agents/skills/ui-control-standards/SKILL.md` in full before touching any control, dialog, or sidebar component. The three most common violations are: (1) Radix portals inside dialogs missing `style={{ zIndex: 10002 }}`, (2) numeric inputs rendered without their paired slider as one visually-connected unit, (3) new grey/colour tokens not already present in the file.

**Accordion default — when in doubt, apply one**: Sections in dialogs and sidebars should be collapsible by default. It is better to have an accordion on a section than not — collapsing long sections is critical for vertical space on mobile and keeps the UI consistent. If a section has no enable/disable switch, use the chevron-only pattern (plain `<button>` + `ChevronDown`) rather than `AccordionSectionHeader`.

**Client-Side First**: All new features must be fully implemented and tested on the client-side before any server-side implementation begins. Server-side parity work is deferred until the complete feature set is working correctly in the frontend preview. Do not implement server-side code for new features until explicitly requested after client testing passes.

**Do not propose server-side Puppeteer renderer parity as a follow-up task**: Never suggest porting client-side features to the server-side Puppeteer renderer (`shared/shapeRenderer.ts` SHAPE_RENDERER_JS string) as a follow-up task. This work is explicitly out of scope and unwanted as a suggestion.

## Known UI Gotchas

**Dialog Dropdown Z-Index**: Every Radix UI portal component rendered inside a dialog MUST use an inline `style={{ zIndex: 10002 }}` prop — not a Tailwind `z-[...]` class. This covers `<SelectContent>`, `<PopoverContent>`, `<TooltipContent>`, `<DropdownMenuContent>`, and any other component that renders through a Radix portal. Tailwind z-index classes are silently capped below the dialog overlay (z-index 10001) because Radix's portal wrapper can establish its own stacking context. The inline `style` prop always wins. Applies to every file, including reusable components that may be used inside a dialog.

**NumericInput Focus Loss on Keystroke**: `NumericInput` calls `onChange` on every keystroke, triggering parent state updates that flow back as a new `value` prop. Guard against this with `isFocusedRef` — when focused, ignore external `value` changes. Any new numeric input that calls `onChange` immediately MUST use this pattern. `BufferedNumericInput` (same file) uses `isEditingRef` for the same purpose and is preferred when commit-on-blur behaviour is acceptable.

**Generation Set Live Settings vs. Saved Snapshots**: For the *currently-selected* generation set, pass `undefined` for the `shapeSpecificProperties` and `batchConfig` overrides in `generateRandomShapes()` so the function falls back to live sidebar values. Non-selected sets use their saved snapshots. Never remove the `isCurrentSet` conditional — doing so makes sidebar changes have no visible effect until the user presses Apply.

## Removed Features
- **Auto-scale-from-DPI (removed 2026-05)**: Fully removed. Artboard pixel dimensions are the single source of truth for export size. Do not re-introduce.
- **`/api/live/sets/execute` (deprecated 2026-05)**: Returns HTTP 410 Gone. Use `/api/live/execute` or the UI batch export instead.

## Known Limitations
- **Browser Canvas Size Ceiling**: Client-side exports are capped at ~220 megapixels — `canvas.toDataURL()` silently returns blank beyond this. The app detects this and offers a server export fallback (Puppeteer-based, no size limit).
