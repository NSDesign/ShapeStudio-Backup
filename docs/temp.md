# Shape Editor - Temporary Notes & Feature Tracker

## Known Issues

### Set Visibility Toggle Bug (Needs Reproduction)

#### Description
When toggling the visibility of one generation set, other sets may revert to their old rendering appearance even though their generation configuration settings still show the updated values.

#### Observed Behavior
1. Set 12 configured with new settings (grid layout, position X incremental, transform translate X)
2. Settings applied correctly and rendered as expected
3. Toggled Set 11 visibility off
4. **Bug**: Set 12 reverted to old appearance (prior settings)
5. Checked Set 12's generation configuration - still shows new settings correctly
6. Re-applied the same configuration settings
7. Set 12 rendered correctly again

#### Root Cause Hypothesis
- Visibility toggle may be triggering a re-render of all enabled sets
- The re-render might be using stale/cached generation configs instead of current ones
- Possible state management issue where visibility changes cause state restoration from persistence
- May involve timing issue between state updates and render triggers

#### Next Steps
- Attempt to consistently reproduce the issue
- Investigate visibility toggle handler and its effects on other sets
- Check state management flow during visibility changes
- Look for any cache/restore logic triggered by visibility toggles

#### Priority
Medium - Need to reproduce consistently before investigating further

---

### Position Incremental + Grid Distribution Issues (RESOLVED)

#### Problem
When using grid distribution with incremental position mode and modulation, the pattern breaks after the first row. Expected pattern should reset at each grid row, but currently uses shape generation index instead of grid cell index.

#### Solution
Implemented grid-aware modulation mode system:
- X Position uses 'grid-col' mode (column-based wrapping)
- Y Position uses 'grid-row' mode (row-based wrapping)
- Each axis has independent modulation settings and Index Driver selection

---

## Feature Implementation Tracker

### Size Constraints System

#### Phase 1: Unified Size Constraints (✅ COMPLETED)

**Completed**: November 10, 2025

**Description**: Replaced the complex checkbox system (use min/max/avg + Force 1:1 aspect ratio) with a simple radio button system that applies to ALL shape types.

**Changes**:
- **UI**: Four radio buttons (None, Min, Max, Avg) replace three checkboxes and "Force 1:1" toggle
- **Schema**: Single `sizeConstraintMode` field ('none' | 'min' | 'max' | 'avg') replaces four boolean fields
- **Behavior**: When constraint is active (min/max/avg), the constrained size applies to BOTH dimensions for ALL shapes
- **Migration**: Automatic backward compatibility for old project files via `migrateSizeConstraintMode()` helper

**Files Modified**:
- `shared/schema.ts`: Added `sizeConstraintMode`, removed legacy fields, added migration helper
- `client/src/components/BatchConfigDialog.tsx`: Radio buttons UI
- `client/src/hooks/useShapeEditor.ts`: Simplified constraint logic
- `client/src/hooks/useGenerationSetsPersistence.ts`: Wired up migration on load
- `server/lib/batchConfigProcessor.ts`: Server-side constraint logic

**Constraint Modes**:
- **None**: Independent width/height (rectangles can be non-square)
- **Min**: Uses smaller of width/height for both dimensions → creates squares/circles at smaller size
- **Max**: Uses larger of width/height for both dimensions → creates squares/circles at larger size
- **Avg**: Uses average of width/height for both dimensions → creates squares/circles at average size

---

#### Phase 2: Aspect Ratio Post-Scaling (⏳ PLANNED)

**Status**: Not yet implemented

**Description**: Add aspect ratio options that post-scale shapes after the size constraint is applied, enabling creation of shapes with specific aspect ratios (e.g., 16:9, 4:3, 21:9).

**Proposed Design**:

**Two-Phase Sizing System**:
1. **Phase 1 - Size Constraint** (determines base size):
   - None → use independent width/height as-is
   - Min/Max/Avg → calculate a single base size value

2. **Phase 2 - Aspect Ratio Scaling** (reshapes the result):
   - If "None" constraint: aspect ratio applies to existing width/height
   - If Min/Max/Avg: aspect ratio scales from the base size

**UI Changes**:
- Aspect ratio dropdown only enabled when size constraint is Min/Max/Avg (not None)
- Dropdown options:
  - **1:1** - Square (default, no scaling)
  - **16:9** - Widescreen
  - **4:3** - Classic
  - **3:2** - Photo
  - **21:9** - Ultrawide
  - **9:16** - Portrait (vertical 16:9)
  - **2:3** - Portrait photo
  - **Custom** - User-defined ratio (two input fields)

**Schema Changes**:
```typescript
// Add to BatchConfigSettings
aspectRatioMode: '1:1' | '16:9' | '4:3' | '3:2' | '21:9' | '9:16' | '2:3' | 'custom';
aspectRatioCustomWidth: number; // For custom mode
aspectRatioCustomHeight: number; // For custom mode
```

**Use Cases**:
- Video thumbnails (16:9)
- Phone screen mockups (9:16)
- Print layouts (4:3, 3:2)
- Ultrawide banners (21:9)
- Custom brand ratios

---

### Other Planned Features

#### Global Repetition Override (⏳ PLANNED)

**Description**: A toggle feature that forces global repetition settings across all shape sets while preserving individual set configurations.

**Concept**: Temporarily override all per-set repetition settings with global values without losing the individual set configurations.

**Use Case**: Quickly test different repetition counts across all sets without manually changing each one.

**Behavior**: 
- When enabled, all sets use global repetition settings regardless of their individual repetitionMode setting
- Individual set repetition configurations remain intact and are restored when override is disabled

**UI Implementation**: Simple checkbox/toggle in the Set Manager dialog near global repetition settings.

**Difference from Use-Global Mode**: Sets retain their current mode (fixed/range/use-global) but temporarily act as if all are set to use-global.

**Benefits**: Rapid experimentation with different repetition counts across entire composition without modifying individual set configurations.

---

#### Echo/Motion Trails System (✅ COMPLETED)

**Completed**: December 2025

See replit.md for full feature documentation. Implements motion trail effects behind shapes with:
- Scope options (Set-level, Shape-level, Both)
- Direction modes (Fixed-vector, Auto-motion, Absolute-position)
- Per-echo effects (opacity, blur, scale, rotation)
- Color shift and jitter systems
- Full client/server parity

---

#### Randomization Per Repetition (⏳ PLANNED)

**Description**: When generating multiple repetitions of a shape set, each repetition receives independent random values for enhanced variety.

**Features**:
- **Random Positions**: Each repetition uses fresh random scatter/distribution coordinates
- **Random Colors**: Independent color selection from ranges or palettes per repetition
- **Random Sizes**: Separate scale randomization with min/max ranges for each instance
- **Random Rotations**: Unique rotation angles within defined ranges per repetition
- **Random Shape Counts**: When count mode is "range", each repetition gets its own random count
- **Fresh Random Seeds**: Each repetition generates with a new random seed, ensuring complete independence of all random properties (gradients, blur, effects, etc.)

**Result**: Multiple repetitions would create truly diverse variations rather than duplicates, useful for creating organic, natural-looking compositions.

---

## Implementation Notes

- All planned features are documented for future implementation
- Completed features are marked with ✅ and include completion dates
- See replit.md for comprehensive system documentation
