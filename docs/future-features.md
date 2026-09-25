# Future Features & Enhancements

This document outlines complex features that have been identified for future development. These features represent significant enhancements to the Shape Editor's capabilities and require careful planning and implementation.

---

## Implementation Status Summary

| Feature | Status | Section |
|---------|--------|---------|
| **Batch Export Queue** | ❌ Not Implemented | [Section 1](#1-batch-export-queue) |
| **Multi-format Batch Processing** | ❌ Not Implemented | [Section 2](#2-multi-format-batch-processing) |
| **Set Repetition Index Control** | ❌ Not Implemented | [Section 3](#3-set-repetition-index-control) |
| **Extended Locking System** | 🔶 Partial | [Section 4](#4-extended-locking-system-for-generation-sets) |
| **Grid Offset System - Phase 1 (Alternating)** | ✅ Implemented | [Section 5](#5-grid-layout-enhancements) |
| **Grid Offset System - Phase 2 (Patterns)** | ✅ Implemented | [Section 5](#phase-2-pattern-based-offsets--implemented) |
| **Shape Masking - Grid Position (Phase 3)** | ✅ Implemented | [Section 5](#phase-3-shape-masking-grid-based--implemented) |
| **Grid Render Mode (Phase 4)** | ✅ Implemented | [Section 5](#phase-4-grid-render-mode--implemented) |
| **Grid Offset Presets (Phase 5)** | ✅ Implemented | [Section 5](#phase-5-grid-offset-presets--completed) |
| **Grid Offset Value Modes (Phase 6)** | ✅ Implemented | [Section 5](#phase-6-grid-offset-value-modes--completed) |
| **Future Shape Masking Filters (Phase 7)** | 📋 Planned | [Section 5](#phase-7-future-shape-masking-filter-types--future) |
| **Echo/Motion Trails - Project A (Set-Level)** | ✅ Implemented | [Section 6](#project-a-set-level-echomotion-trails) |
| **Echo/Motion Trails - Project B (Shape-Level)** | ✅ Implemented | [Section 6](#project-b-shape-level-echomotion-trails) |
| **Advanced Multi-Filter System** | ❌ Not Implemented | [Section 7](#7-advanced-multi-filter-system-for-shape-sets) |
| **Shape Effects - Blur** | ✅ Implemented | [Section 8](#8-shape-effects) |
| **Shape Effects - Shadow/Glow** | 📋 Planned | [Section 8](#8-shape-effects) |
| **Server-Side High-Resolution Export** | ✅ Complete | [Section 9](#9-server-side-high-resolution-export) |
| **SSE Streaming for Export Progress** | ✅ Implemented | [Section 9.1](#91-sse-streaming-for-real-time-tile-progress-updates--implemented) |
| **Shape Selection Groups** | 📋 Planned | [Section 10](#10-shape-selection-groups-future-abstraction) |
| **Export Metadata Audit & Settings Sync** | 📋 Planned | [Section 11](#11-export-metadata-embedding-audit--settings-sync--planned) |
| **Export & Save Contextual UI** | 📋 Planned | [Section 12](#12-export--save-section-contextual-ui--planned) |

### Status Legend
- ✅ **Implemented**: Feature is fully functional in the codebase
- 🔶 **Partial**: Some sub-features implemented, others pending
- ❌ **Not Implemented**: Feature is documented but not yet built
- 📋 **Planned**: Feature is planned for future development

---

## 1. Batch Export Queue ❌ NOT IMPLEMENTED

### Overview
A comprehensive batch export system that allows users to queue multiple export operations and process them sequentially with progress tracking and batch packaging options.

### Current State
The application currently supports:
- Single-file exports (all shapes, selected shapes, or artboard content)
- One format at a time
- Manual export initiation for each operation

Users must manually export each configuration separately, which is inefficient for workflows requiring multiple variations.

### Proposed Feature

#### Core Functionality
1. **Export Queue Management**
   - Add multiple export jobs to a queue
   - Each job specifies: format, quality, scale, scope, naming options
   - Queue visualization showing pending, in-progress, and completed jobs
   - Ability to reorder, edit, or remove queued jobs before processing

2. **Batch Processing**
   - Process queued exports sequentially
   - Real-time progress tracking for each job
   - Overall progress indicator (e.g., "3 of 10 exports complete")
   - Pause/resume capability
   - Error handling with retry options

3. **Packaging Options**
   - Option to package all exports as a ZIP file
   - Automatic filename generation with configurable patterns
   - Optional project file (.json) inclusion
   - Subfolder organization by format or export scope

#### Technical Requirements

**Frontend:**
- Queue state management (could use React Context or Zustand)
- Queue UI component with drag-and-drop reordering
- Progress indicators and status badges
- Background processing that doesn't block UI interactions

**Backend:**
- Queue processing endpoint that handles multiple exports
- Stream-based ZIP generation for memory efficiency
- Progress tracking via WebSocket or Server-Sent Events
- Temporary file management and cleanup

**Data Model:**
```typescript
interface ExportJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  settings: {
    format: ImageFormat;
    quality: number;
    scale: number;
    scope: 'all' | 'selected' | 'artboard';
    includeBackground: boolean;
    backgroundColor: string;
    // ... other export options
  };
  filename: string;
  progress?: number; // 0-100
  error?: string;
  resultUrl?: string;
}

interface ExportQueue {
  jobs: ExportJob[];
  packageAsZip: boolean;
  zipFilename?: string;
  includeProjectFile: boolean;
}
```

#### UI/UX Considerations
- **Queue Panel**: Collapsible sidebar or modal showing all queued jobs
- **Quick Actions**: Templates for common batch scenarios (e.g., "Export all formats at 1x, 2x, 4x")
- **Job Templates**: Save queue configurations for reuse
- **Notifications**: Toast notifications for completion/errors
- **Download Management**: Option to auto-download or save to project folder

#### Implementation Phases
1. **Phase 1**: Basic queue UI and single-job sequential processing
2. **Phase 2**: ZIP packaging and progress tracking
3. **Phase 3**: Job templates and advanced queue management
4. **Phase 4**: Background/async processing with notifications

---

## 2. Multi-format Batch Processing ❌ NOT IMPLEMENTED

### Overview
Allow users to export the same content in multiple image formats simultaneously, streamlining workflows that require the same design in various formats.

### Current State
Users can only export one format at a time. To get the same design in multiple formats (e.g., PNG, JPEG, WebP), they must:
1. Export as PNG
2. Change format setting
3. Export as JPEG
4. Change format setting
5. Export as WebP
6. Etc.

This is tedious and time-consuming for multi-format delivery requirements.

### Proposed Feature

#### Core Functionality
1. **Multi-format Selection**
   - Checkbox-based format selector in export dialog
   - Select multiple formats simultaneously (e.g., PNG + JPEG + WebP)
   - Per-format quality settings (since JPEG/WebP/AVIF support quality)
   - Unified naming scheme across all formats

2. **Format-Specific Settings**
   - Quality slider for each lossy format
   - Transparency handling (auto-disable for JPEG, add background)
   - Format-specific optimization toggles

3. **Batch Generation**
   - Generate all selected formats in a single operation
   - Show progress across all formats
   - Package results together or download individually

#### Technical Requirements

**Frontend:**
- Multi-select format UI component
- Conditional settings panels based on selected formats
- Format-specific validation (e.g., warn if transparency selected with JPEG)
- Batch progress indicator showing per-format status

**Backend:**
- Parallel or sequential format generation from single canvas
- Efficient canvas reuse (render once, export to multiple formats)
- Memory-optimized processing for large batches
- ZIP packaging for multi-format downloads

**Data Model:**
```typescript
interface MultiFormatExportSettings {
  formats: {
    format: ImageFormat;
    quality?: number; // For lossy formats
    enabled: boolean;
  }[];
  commonSettings: {
    scale: number;
    scope: 'all' | 'selected' | 'artboard';
    includeBackground: boolean;
    backgroundColor: string;
    // ... other shared options
  };
  packaging: {
    zipEnabled: boolean;
    individualDownloads: boolean;
  };
  naming: {
    baseFilename: string;
    includeFormat: boolean; // Append format to filename
    includeTimestamp: boolean;
  };
}
```

#### UI/UX Considerations
- **Format Grid**: Visual grid of format checkboxes with icons/descriptions
- **Smart Defaults**: Auto-adjust settings when formats selected (e.g., add background if JPEG selected)
- **Preview Matrix**: Show thumbnail preview of each format side-by-side
- **Size Estimates**: Display estimated file sizes for each format
- **Conflict Detection**: Warn about incompatible settings (e.g., transparency + JPEG)

#### Implementation Phases
1. **Phase 1**: Basic multi-format selection and export
2. **Phase 2**: Format-specific quality settings
3. **Phase 3**: Preview matrix and size estimates
4. **Phase 4**: Advanced optimization and comparison tools

#### Synergy with Batch Export Queue
These two features work well together:
- Multi-format exports could be added as a single queue job
- Queue could show sub-items for each format being processed
- Format templates could be saved and reused in queue

---

## Integration Notes

### Relationship to Existing Features
Both features build upon the current export system:
- Use existing `ImageExporter` class as foundation
- Leverage current format support (PNG, JPEG, WebP, AVIF, BMP)
- Extend existing export options rather than replacing them

### API Parity Considerations
When implementing these features:
- Ensure both client and server support the same capabilities
- Server API should support batch requests
- Consider WebSocket/SSE for real-time progress updates
- Maintain JSON parity between client and API exports

### Performance Considerations
- Memory management for large batch operations
- Canvas reuse strategies to avoid redundant rendering
- Stream-based processing for ZIP generation
- Background/worker thread processing where possible

---

## 3. Set Repetition Index Control ❌ NOT IMPLEMENTED

### Overview
A powerful parameter control system that allows shape properties to change predictably based on the repetition index, enabling controlled progressions, sequences, and patterns instead of random variations. When a shape set is repeated multiple times, each repetition can have properties that increment, decrement, or modulate according to its position in the sequence (index 0, 1, 2, 3...).

### Concept
Currently, shape sets support three repetition behaviors:
- **Use Global**: Inherit global repetition settings
- **Fixed**: Repeat the set N times with fresh random values each time
- **Range**: Repeat a random count within a range, with fresh random values each time

Set Repetition Index Control would add a fourth mode for numeric properties: **Set Rep Index**, where property values are calculated based on the repetition index using a formula: `value = base + (index × increment)`.

This transforms repetition from purely random variation to controlled, mathematical progression.

### Use Cases

#### A. Generation Config Settings
Numeric properties in the main generation configuration that could be controlled by repetition index:

**Position:**
- X/Y offset: Create echo/trail effects with predictable spacing
- Example: Base X=0, Increment +5 → Each rep shifts 5px right (0px, 5px, 10px, 15px...)

**Size (Width/Height):**
- Progressive scaling: Shapes growing or shrinking systematically
- Example: Base radius=50, Increment +10 → Concentric circles (50px, 60px, 70px, 80px...)

**Rotation:**
- Angular progression: Create radial patterns or rotation sequences
- Example: Base 0°, Increment +15° → Creates 24-spoke radial pattern

**Opacity:**
- Fade sequences: Linear fade-in or fade-out progressions
- Example: Base 100%, Increment -10% → Fade out (100%, 90%, 80%, 70%...)

**Colors (Fill/Stroke):**
- Hue rotation: Smooth color wheel progressions
- Example: Base hue=0°, Increment +30° → Rainbow sequence (red → orange → yellow → green...)
- Saturation/Lightness ramps: Colors becoming more vivid or desaturated
- Example: Base saturation=50%, Increment +10% → Increasing color intensity

**Blur Radius:**
- Progressive blur: Sharp to blurry or vice versa
- Example: Base 0px, Increment +2px → Increasing blur effect (0px, 2px, 4px, 6px...)

**Stroke Width:**
- Line thickness progression: Lines getting thicker or thinner
- Example: Base 1px, Increment +0.5px → Growing stroke weight

#### B. Shape-Specific Properties
Type-specific parameters that could be controlled by repetition index:

**Line-Vector:**
- Direction angle: Each repetition rotates by fixed degrees (creates radial burst patterns)
- Length: Progressively longer or shorter lines
- Centroid position: Animating the line's center point along a path
- Example: Base direction=0°, Increment +15° → 24 lines radiating from center

**Polygon:**
- Edge count: Triangle → square → pentagon → hexagon (morphing sequence)
- Example: Base edges=3, Increment +1 → Shape complexity increases per rep

**Star:**
- Point count: 5-pointed → 8-pointed → 12-pointed progression
- Inner radius ratio: Stars getting sharper (lower ratio) or blunter (higher ratio)
- Example: Base points=5, Increment +2 → Increasingly complex stars

**Circle/Ellipse:**
- Segment count: Low-poly to high-poly progression (blocky → smooth)
- Example: Base segments=6, Increment +4 → Visual quality increases (6, 10, 14, 18...)

**Bezier/Cubic/Smooth-Spline:**
- Point count: Curves getting more complex per repetition
- Curvature: Progressively more curved or straighter paths
- Spread (for cubic splines): Tightening or expanding spread patterns

**Ring/Spline-Ring:**
- Inner radius: Rings getting thicker or thinner progressively
- Example: Base inner=0.2, Increment +0.1 → Varying ring thickness

#### C. Visual Effects
Additional visual properties that could be index-controlled:

**Gradient Angle:**
- Rotating gradients: Each rep's gradient rotates systematically
- Example: Base 0°, Increment +45° → Gradient rotates through orientations

**Shadow Offset/Intensity:**
- Creating depth progression with shadow effects
- Example: Base offset=2px, Increment +1px → Increasing shadow depth

#### D. Layering & Compositing
Compositional properties controlled by index:

**Blend Mode Cycling:**
- Each repetition uses a different blend mode from a sequence
- Example: source-over → multiply → screen → overlay (repeating pattern)

**Opacity Steps:**
- Controlled fade-in or fade-out progressions (different from random opacity)
- Example: Base 20%, Increment +20% → 5 reps create full fade-in

**Z-Index:**
- Explicit layer ordering tied to repetition sequence
- Example: Base z=100, Increment +10 → Clear stacking order

#### E. Color Systems (Advanced)
Complex color manipulations based on index:

**Hue Rotation:**
- Color wheel progression (red → orange → yellow → green → cyan → blue → magenta)
- Example: Base hue=0°, Increment +30° → 12 reps complete full color wheel

**Saturation/Lightness Ramps:**
- Colors becoming more vivid (saturation up) or desaturated (saturation down)
- Colors becoming lighter or darker (lightness up/down)
- Example: Base saturation=30%, Increment +10% → Progressive color intensity

**Color Harmony Cycling:**
- Cycle through color harmony relationships (complementary → triadic → tetradic)
- Each rep uses a different harmonic relationship to base color

#### F. Transform Properties
Transform-related parameters controlled by index:

**Transform Origin:**
- Shifting the pivot point progressively
- Example: Base origin-x=0%, Increment +10% → Pivot shifts left to right

**Combined Transforms:**
- Rotation + scale + position all tied to index for complex motion paths
- Example: Spiral effect with simultaneous rotation, scaling, and position offset

#### G. Distribution Parameters
Distribution layout settings controlled by index:

**Grid Spacing:**
- Cells getting larger or smaller progressively
- Example: Base spacing=50px, Increment +10px → Expanding grid

**Wave Amplitude/Frequency:**
- Modulating wave parameters for evolving wave patterns
- Base amplitude=20px, Increment +5px → Increasingly dramatic waves

**Spiral Tightness:**
- Changing the spacing between spiral arms
- Example: Base spacing=10px, Increment +2px → Loosening spiral

**Ellipse Radii:**
- Progressive ellipse size changes
- Example: Base radius=100px, Increment +20px → Expanding concentric ellipses

### Technical Implementation

#### Parameters Required
For each property supporting "Set Rep Index" mode:

1. **Base Value** (required)
   - Starting point for index 0
   - Example: 50px, 0°, 100%, #ff0000

2. **Increment** (required)
   - Amount to add/subtract per index
   - Can be positive (increasing) or negative (decreasing)
   - Example: +10px, -5°, +15%

3. **Multiplier** (optional, default: 1)
   - Scale the index before applying increment
   - Useful for faster/slower progressions
   - Example: Multiplier 2 → index 0,2,4,6... instead of 0,1,2,3...

4. **Offset** (optional, default: 0)
   - Start from a different index value
   - Example: Offset 3 → indices start at 3,4,5,6... instead of 0,1,2,3...

5. **Modulation** (optional, default: linear)
   - How the value changes over indices
   - Types:
     - **Linear** (default): Direct increment (value = base + increment × index)
     - **Exponential**: Accelerating change (value = base + increment × index²)
     - **Sine Wave**: Oscillating pattern (value = base + amplitude × sin(index × frequency))
     - **Ease In/Out**: Smooth acceleration/deceleration curves
     - **Step**: Discrete jumps at intervals

#### Calculation Formula
```
effectiveIndex = (actualIndex + offset) × multiplier

switch (modulationType) {
  case 'linear':
    value = base + (increment × effectiveIndex)
  case 'exponential':
    value = base + (increment × effectiveIndex²)
  case 'sine':
    value = base + (increment × sin(effectiveIndex × frequency))
  // ... other modulation types
}
```

#### Data Model
```typescript
type PropertyMode = 'fixed' | 'range' | 'use-global' | 'set-rep-index';

interface SetRepIndexConfig {
  mode: 'set-rep-index';
  base: number;           // Starting value
  increment: number;      // Amount per index (can be negative)
  multiplier?: number;    // Default: 1
  offset?: number;        // Default: 0
  modulation?: 'linear' | 'exponential' | 'sine' | 'ease-in' | 'ease-out' | 'step';
  modulationParams?: {
    frequency?: number;   // For sine wave
    stepInterval?: number; // For step modulation
  };
  clamp?: {              // Optional value clamping
    min?: number;
    max?: number;
  };
}

// Example usage in generation config
interface PositionConfig {
  x: {
    mode: 'set-rep-index';
    base: 0;
    increment: 5;
    // Results: 0px, 5px, 10px, 15px...
  };
  y: {
    mode: 'fixed';
    value: 100;
    // Results: All reps at 100px
  };
}

interface ColorConfig {
  hue: {
    mode: 'set-rep-index';
    base: 0;
    increment: 30;
    modulation: 'linear';
    clamp: { min: 0, max: 360 };
    // Results: 0°, 30°, 60°, 90°, 120°... (wraps at 360°)
  };
}

// Example usage in shape-specific properties
interface PolygonProperties {
  edgeCount: {
    mode: 'set-rep-index';
    base: 3;
    increment: 1;
    clamp: { min: 3, max: 12 };
    // Results: triangle, square, pentagon, hexagon...
  };
}
```

### Concrete Examples

#### Example 1: Concentric Circles
**Goal:** Create 5 concentric circles with increasing radius

**Setup:**
- Shape type: Circle
- Repetition: Fixed, count = 5
- Circle radius (width/height):
  - Mode: Set Rep Index
  - Base: 50px
  - Increment: 20px

**Result:**
- Rep 0: 50px radius
- Rep 1: 70px radius
- Rep 2: 90px radius
- Rep 3: 110px radius
- Rep 4: 130px radius

#### Example 2: Radial Line Burst
**Goal:** 24 lines radiating from center point

**Setup:**
- Shape type: Line-Vector
- Repetition: Fixed, count = 24
- Line direction:
  - Mode: Set Rep Index
  - Base: 0°
  - Increment: 15°
- Line length: Fixed at 100px
- Line centroid: Fixed at 0

**Result:**
- Rep 0: 0° direction
- Rep 1: 15° direction
- Rep 2: 30° direction
- ...
- Rep 23: 345° direction

Creates perfect radial burst with evenly spaced lines.

#### Example 3: Polygon Morphing Sequence
**Goal:** Shapes morphing from triangle to dodecagon

**Setup:**
- Shape type: Polygon
- Repetition: Fixed, count = 10
- Edge count:
  - Mode: Set Rep Index
  - Base: 3
  - Increment: 1
  - Clamp: min=3, max=12

**Result:**
- Rep 0: Triangle (3 edges)
- Rep 1: Square (4 edges)
- Rep 2: Pentagon (5 edges)
- ...
- Rep 9: Dodecagon (12 edges)

#### Example 4: Rainbow Color Progression
**Goal:** Full color wheel progression across 12 repetitions

**Setup:**
- Shape type: Circle
- Repetition: Fixed, count = 12
- Fill color hue:
  - Mode: Set Rep Index
  - Base: 0°
  - Increment: 30°
  - Modulation: Linear
- Saturation: Fixed at 100%
- Lightness: Fixed at 50%

**Result:**
- Rep 0: Red (0°)
- Rep 1: Orange (30°)
- Rep 2: Yellow (60°)
- Rep 3: Chartreuse (90°)
- Rep 4: Green (120°)
- ...
- Rep 11: Magenta (330°)

#### Example 5: Fade-Out Sequence
**Goal:** 10 shapes fading from opaque to transparent

**Setup:**
- Shape type: Rectangle
- Repetition: Fixed, count = 10
- Opacity:
  - Mode: Set Rep Index
  - Base: 100%
  - Increment: -10%
  - Clamp: min=0%, max=100%

**Result:**
- Rep 0: 100% opacity
- Rep 1: 90% opacity
- Rep 2: 80% opacity
- ...
- Rep 9: 10% opacity

#### Example 6: Spiral with Combined Properties
**Goal:** Spiral pattern using rotation + position offset

**Setup:**
- Shape type: Circle
- Repetition: Fixed, count = 20
- Rotation:
  - Mode: Set Rep Index
  - Base: 0°
  - Increment: 18°
- Position X:
  - Mode: Set Rep Index
  - Base: 200px (artboard center)
  - Increment: 5px (radius grows)
  - Modulation: Linear
- Use polar coordinate calculation: x = centerX + radius × cos(angle), y = centerY + radius × sin(angle)

**Result:** Shapes arranged in expanding spiral pattern

### Synergies with Existing Features

#### Echo/Spread Effect (Future Feature)
Documented in replit.md, this feature provides controlled position offsets between repetitions. When combined with Set Rep Index:
- **Echo effect** provides predictable X/Y offsets
- **Set Rep Index** adds other property progressions (size, color, opacity, rotation)
- **Result:** Motion blur trails with color shifts, size changes, or rotation

Example: Drop shadow effect with color fade
- Echo: +3px X, +3px Y per rep
- Set Rep Index opacity: 100% → 50% (decreasing)
- Set Rep Index blur: 0px → 5px (increasing)

#### Randomization Per Repetition (Future Feature)
Also documented in replit.md, allows each repetition to get fresh random values. These features complement each other:
- **Set Rep Index:** Controls specific properties predictably (e.g., rotation angle)
- **Randomization:** Other properties remain random (e.g., position, size)
- **Result:** Controlled + chaotic = Radial burst where angle is precise but line length/color are random

Example: Color wheel with random sizes
- Set Rep Index hue: 0° → 360° (precise color progression)
- Random size: 20-80px (varied shapes)
- Random position: scattered placement

#### Global Repetition Override (Future Feature)
Also documented in replit.md, forces global repetition settings across all sets. Interaction:
- When override enabled, all sets use global repetition count
- Set Rep Index calculations still use per-set configurations
- Allows quick testing of index-based progressions at different repetition counts

### UI/UX Considerations

#### Mode Selection
For each property supporting modes (fixed/range/set-rep-index):
- **Dropdown or segmented control** to select mode
- **Conditional UI** showing relevant inputs based on mode:
  - Fixed: Single value input
  - Range: Min/max inputs
  - Set Rep Index: Base, increment, and optional advanced params

#### Basic vs Advanced Parameters
- **Basic view:** Show base and increment only (covers 90% of use cases)
- **Advanced toggle:** Reveals multiplier, offset, modulation options
- **Presets:** Common patterns (linear increase, linear decrease, color wheel, fade in/out)

#### Visual Feedback
- **Preview indicator:** Show calculated values for first 3-5 repetitions
  - Example: "50px → 70px → 90px → 110px..."
- **Graph visualization:** Plot the progression curve for modulated types
- **Real-time preview:** Update canvas as parameters change

#### Property Compatibility
Not all properties make sense for Set Rep Index:
- **Good candidates:** Numeric values (position, size, angles, counts, percentages)
- **Poor candidates:** Boolean flags, categorical selections (unless cycled)
- **Special handling:** Colors need HSL decomposition (control H, S, or L independently)

### Implementation Phases

#### Phase 1: Core Functionality
- Add "set-rep-index" mode to schema for numeric properties
- Implement basic calculation (base + increment × index)
- UI for base and increment inputs
- Support in generation config for position, size, rotation, opacity
- Linear modulation only

**Deliverable:** Users can create concentric circles, radial bursts, fade sequences

#### Phase 2: Shape-Specific Properties
- Extend to shape-specific numeric properties:
  - Polygon: edge count
  - Star: point count, inner radius
  - Line-vector: direction, length, centroid
  - Circle/Ellipse: segment count
  - Bezier/Cubic/Spline: point count, curvature, spread
- UI integration in shape-specific controls

**Deliverable:** Users can create polygon morphing, complexity progressions

#### Phase 3: Advanced Modulation
- Add modulation types: exponential, sine, ease-in, ease-out, step
- Multiplier and offset parameters
- Value clamping with min/max
- UI for advanced parameter panel (collapsible)

**Deliverable:** Users can create wave patterns, accelerating progressions, oscillations

#### Phase 4: Color & Effects
- HSL decomposition for color controls (hue, saturation, lightness independently)
- Gradient angle control
- Blur radius progression
- Stroke width progression
- Shadow parameters

**Deliverable:** Users can create color wheels, blur progressions, dynamic strokes

#### Phase 5: Distribution & Transforms
- Grid spacing control
- Wave amplitude/frequency control
- Spiral tightness
- Transform origin shifts
- Ellipse distribution radii

**Deliverable:** Users can create dynamic distribution layouts

### Edge Cases & Constraints

#### Value Boundaries
- **Clamping:** Ensure values stay within valid ranges
  - Opacity: 0-100%
  - Hue: 0-360° (wrapping)
  - Edge counts: Minimum 3 for polygons
  - Segment counts: Minimum 3 for circles

#### Negative Increments
- Support decreasing progressions (increment < 0)
- Clamp to minimum values to prevent invalid results
- Example: Opacity 100% → 0% requires increment = -10% with clamp min=0%

#### Large Repetition Counts
- With 100 repetitions and increment +10px, final value = 1000px
- Warn user if calculated values exceed reasonable bounds
- Provide visual feedback showing value range

#### Fractional Indices
- Some properties require integers (edge counts, point counts)
- Round calculated values to nearest integer where appropriate

### Performance Considerations
- Calculations are simple arithmetic (no performance concern)
- Pre-calculate values for all repetitions during generation setup
- Cache calculated values to avoid redundant computation
- Modulation functions (sine, exponential) use standard Math library

### Estimated Complexity
**Overall: High** (comprehensive feature touching many systems)

**By Phase:**
- Phase 1 (Core): **Medium** - Schema changes, basic UI, calculation logic
- Phase 2 (Shape-Specific): **Medium** - Extend to type-specific properties
- Phase 3 (Advanced Modulation): **Low** - Additive complexity to existing system
- Phase 4 (Color & Effects): **Medium** - HSL decomposition, new property types
- Phase 5 (Distribution): **Low** - Apply existing pattern to distribution params

### Priority Rationale
This feature significantly expands creative control over repetition:
- Enables entire new categories of designs (radial patterns, progressions, sequences)
- Complements randomization (predictable + chaotic combinations)
- Natural extension of existing repetition system
- High user demand for controlled patterns vs pure randomness

---

## Priority & Timeline

These features are marked for future development. Priority should be determined based on:
- User demand and feedback
- Impact on workflow efficiency
- Technical complexity and resource availability
- Dependencies on other system improvements

**Estimated Complexity:**
- Batch Export Queue: **High** (requires queue management, progress tracking, packaging)
- Multi-format Batch Processing: **Medium** (extends existing export, format-specific settings)
- Set Repetition Index Control: **High** (comprehensive feature touching many systems, phased implementation)

---

## 4. Extended Locking System for Generation Sets

### Overview
A granular control system that allows users to selectively protect individual generation sets from specific operations, preventing unwanted interactions between layers while maintaining flexibility for intentional effects.

### Current Implementation: Composite Lock ✅

**Status:** Implemented (November 2025)

The composite lock feature provides protection from compositing operations for specific generation sets. This is particularly useful for background layers or base elements that should remain unchanged regardless of foreground compositing effects.

#### Functionality
- **Purpose**: Prevent compositing operations (destination-in, destination-out, etc.) from affecting protected sets
- **Default State**: All locks disabled (composite = false)
- **Rendering Strategy**: 
  - Locked sets render first with `source-over` (normal blending)
  - Unlocked sets render after, with their configured compositing operations
  - Compositing operations only affect other unlocked sets
- **Use Cases**:
  - Protecting background layers from foreground masking operations
  - Preserving base shapes while applying destructive compositing to overlays
  - Maintaining specific layer integrity in complex compositions

#### Implementation Details
- **Data Model**: `GenerationSet.locks.composite: boolean`
- **UI**: Lock button on set cards (Lock + "|" + Layers2 icons)
  - Blue background when locked
  - Slate background when unlocked
  - Positioned top-right on set card header
- **Client Rendering**: `client/src/lib/offscreenRenderer.ts`
- **Server Rendering**: `server/lib/generationSetProcessor.ts`
- **Persistence**: Automatically saved/loaded via `useGenerationSetsPersistence`

#### Example Workflow
```
Set 1: Background (LOCKED for composite)
  └─ Rectangle, full artboard, blue fill
  
Set 2: Foreground (UNLOCKED)
  └─ Circle, compositing op: destination-in
  
Result: Circle cuts itself out against unlocked content,
        but Background set remains completely untouched
```

### Future Lock Types

The composite lock is the foundation of a planned granular locking system. Future implementations may include:

#### 1. Blend Lock 🔒
**Purpose**: Prevent blend modes from affecting this set

**Functionality**:
- Locked sets always use `source-over` blend mode
- Protects from global or probability-based blend mode changes
- Useful for maintaining pure color appearance

**Icon**: Lock + "|" + Droplet (or Palette)

#### 2. Transform Lock 🔒
**Purpose**: Prevent moving, scaling, or rotating the set

**Functionality**:
- Locks position (X/Y), rotation, and scale transforms
- Set cannot be moved via Set Transform controls
- Prevents accidental repositioning of fixed layouts

**Icon**: Lock + "|" + Move (or Maximize2)

**Granularity Options**:
- Lock all transforms (position + rotation + scale)
- Lock position only
- Lock rotation only
- Lock scale only

#### 3. Point Edit Lock 🔒
**Purpose**: Protect point-level geometry modifications

**Functionality**:
- Prevents adding, removing, or moving individual control points
- Protects against point-level editing operations
- Maintains exact shape geometry

**Icon**: Lock + "|" + Edit3 (or PenTool)

#### 4. Segment Edit Lock 🔒
**Purpose**: Protect segment-level geometry modifications

**Functionality**:
- Prevents modifying curve segments between points
- Locks tangent handles and curve tension
- Maintains exact path curvature

**Icon**: Lock + "|" + BezierCurve

### Technical Implementation (Future)

#### Data Model Extension
```typescript
interface SetLocks {
  composite: boolean;      // Currently implemented
  blend?: boolean;         // Future: blend mode protection
  transform?: boolean;     // Future: transform protection
  pointEdit?: boolean;     // Future: point-level edit protection
  segmentEdit?: boolean;   // Future: segment-level edit protection
}
```

#### UI Design Patterns
All lock buttons follow the same visual pattern:
- **Container**: Rounded rectangle button
- **Icons**: Lock icon + "|" + operation-specific icon
- **States**: 
  - Unlocked: Slate/transparent background, outline style
  - Locked: Blue/accent background, solid appearance
- **Position**: Top-right on set card, left-to-right order
- **Interaction**: Click to toggle, tooltip on hover

#### Rendering Pipeline Considerations
Each lock type requires different handling:
- **Composite Lock**: Applied during canvas compositing (implemented)
- **Blend Lock**: Applied before shape rendering
- **Transform Lock**: UI-level prevention of transform controls
- **Edit Locks**: Tool-level prevention of geometry editing

### Priority & Complexity

**Composite Lock**: ✅ **Implemented** - Foundation for system

**Future Locks:**
- **Blend Lock**: **Low Complexity** - Similar to composite lock, affects blend mode application
- **Transform Lock**: **Low Complexity** - UI-level control disabling
- **Edit Locks**: **Medium Complexity** - Requires tool-level integration

**Priority Rationale:**
- Composite lock solves the most critical use case (background protection)
- Other locks are valuable but less urgent
- Can be added incrementally as user demand grows
- Architecture supports easy extension via `locks` object

### Synergy with Existing Features
- **Set Visibility**: Locks work alongside visibility controls
- **Set Blending**: Blend lock would complement existing blend mode system
- **Set Transform**: Transform lock would protect against accidental changes
- **Compositing Operations**: Composite lock (implemented) protects from these

---

## 5. Grid Layout Enhancements

### Overview
A comprehensive set of enhancements to the grid distribution layout system, adding advanced offset controls, shape masking capabilities, and cell-based rendering options. These features enable more creative and precise control over how shapes are positioned and rendered within grid structures.

### Current State
The grid layout system currently supports:
- Fixed rows and columns with customizable spacing
- Start position offsets (X/Y)
- Three spacing modes: Define, Auto-Centered, Auto-Edge-to-Edge
- Sorting and grouping options
- X/Y randomization for position jitter
- ✅ Grid Offsets (Alternating & Pattern modes)
- ✅ Shape Masking (Grid Position filtering)
- ✅ Grid Render Mode (Point, Cell, and Cell Points positioning)

### Implementation Status
| Phase | Feature | Status |
|-------|---------|--------|
| Phase 1 | Alternating Grid Offsets | ✅ Implemented |
| Phase 2 | Pattern-Based Offsets | ✅ Implemented |
| Phase 3 | Shape Masking (Grid-Based) | ✅ Implemented |
| Phase 4 | Grid Render Mode (Point, Cell, Cell Points) | ✅ Implemented |
| Phase 5 | Grid Offset Presets | ✅ Completed |
| Phase 6 | Grid Offset Value Modes | ✅ Completed |
| Phase 7 | Future Shape Masking Filter Types | 📋 Future |
| Phase 8 | No-Overlap/Distance Maintenance | 📋 Future |

### Phased Implementation Plan

---

### Phase 1: Alternating Grid Offsets ✅ IMPLEMENTED

#### Overview
Add the ability to offset every second row or column by a fixed pixel amount, with control over which row/column the alternation starts from.

**Implementation Status**: Complete  
**Location**: Grid Layout section in BatchConfigDialog.tsx

#### Use Cases
- Brick/honeycomb patterns where rows are staggered
- Hexagonal-style layouts
- Visual rhythm variations in grid compositions

#### Data Model
```typescript
gridOffsets: {
  enabled: boolean;
  mode: 'alternating';  // Phase 1 only supports alternating
  row: {
    enabled: boolean;
    amount: number;           // Pixels to offset
    startIndex: 0 | 1;        // Which row starts the offset (0 = first row, 1 = second row)
    direction: 'left' | 'right';  // Direction of offset
  };
  column: {
    enabled: boolean;
    amount: number;           // Pixels to offset
    startIndex: 0 | 1;        // Which column starts the offset
    direction: 'up' | 'down';     // Direction of offset
  };
}
```

#### Offset Calculation Logic
```typescript
// For each shape at grid position (row, col):
let offsetX = 0;
let offsetY = 0;

// Row offset affects X position (shifts row left/right)
if (gridOffsets.row.enabled) {
  const isOffsetRow = (row % 2) === gridOffsets.row.startIndex;
  if (isOffsetRow) {
    offsetX = gridOffsets.row.direction === 'right' 
      ? gridOffsets.row.amount 
      : -gridOffsets.row.amount;
  }
}

// Column offset affects Y position (shifts column up/down)
if (gridOffsets.column.enabled) {
  const isOffsetColumn = (col % 2) === gridOffsets.column.startIndex;
  if (isOffsetColumn) {
    offsetY = gridOffsets.column.direction === 'down' 
      ? gridOffsets.column.amount 
      : -gridOffsets.column.amount;
  }
}

finalX = baseX + offsetX;
finalY = baseY + offsetY;
```

#### UI Controls
Within the Grid Layout section:
- **Grid Offsets** accordion/collapsible
  - Enable toggle
  - **Row Offset** subsection:
    - Enable toggle
    - Amount input (px)
    - Start index: dropdown (0 or 1) with labels "1st row" / "2nd row"
    - Direction: dropdown (left/right)
  - **Column Offset** subsection:
    - Enable toggle
    - Amount input (px)
    - Start index: dropdown (0 or 1) with labels "1st column" / "2nd column"
    - Direction: dropdown (up/down)

---

### Phase 2: Pattern-Based Offsets ✅ IMPLEMENTED

#### Overview
Extend the offset system to support explicit patterns defining which rows/columns receive offsets, rather than simple alternation.

**Implementation Status**: Complete  
**Location**: Grid Layout section in BatchConfigDialog.tsx (Grid Offsets subsection)

#### Use Cases
- Complex staggered patterns (e.g., offset rows 0, 2, 3, 5 but not 1, 4)
- Asymmetric visual rhythms
- Architectural/design patterns requiring specific offset sequences

#### Data Model Extension
```typescript
gridOffsets: {
  enabled: boolean;
  mode: 'alternating' | 'pattern';
  row: {
    enabled: boolean;
    amount: number;
    startIndex: 0 | 1;        // For alternating mode
    direction: 'left' | 'right';
    pattern: number[];        // For pattern mode: [0, 2, 3, 5] = offset these row indices
  };
  column: {
    enabled: boolean;
    amount: number;
    startIndex: 0 | 1;
    direction: 'up' | 'down';
    pattern: number[];        // For pattern mode
  };
}
```

#### Pattern Input
- **Absolute indices**: Pattern `[0, 2, 3, 5]` means exactly rows/columns 0, 2, 3, and 5 receive offset
- **No repetition**: Patterns don't cycle - only specified indices are affected
- **Input format**: Comma-separated numbers in text field (e.g., "0, 2, 3, 5")
- **Future enhancement**: Could support range syntax like "0-3, 5, 7-10"

#### Pattern Calculation Logic
```typescript
if (gridOffsets.mode === 'pattern') {
  // Row offset
  if (gridOffsets.row.enabled && gridOffsets.row.pattern.includes(row)) {
    offsetX = gridOffsets.row.direction === 'right' 
      ? gridOffsets.row.amount 
      : -gridOffsets.row.amount;
  }
  
  // Column offset
  if (gridOffsets.column.enabled && gridOffsets.column.pattern.includes(col)) {
    offsetY = gridOffsets.column.direction === 'down' 
      ? gridOffsets.column.amount 
      : -gridOffsets.column.amount;
  }
}
```

---

### Phase 3: Shape Masking (Grid-Based) ✅ IMPLEMENTED

#### Overview
A standalone top-level section for controlling which grid positions render shapes and which are excluded. Named "Shape Masking" to accommodate future masking methods beyond grid-based exclusion.

**Implementation Status**: Complete  
**Location**: BatchConfigDialog.tsx - Standalone section between Distribution Layout and Properties

#### Architecture Design
Shape Masking is structured as an independent filtering layer that operates separately from Distribution Layout:

```typescript
shapeMasking: {
  enabled: boolean;              // Master toggle for all masking
  
  // Grid Position Filter (IMPLEMENTED)
  grid: {
    enabled: boolean;            // Toggle for grid-based masking specifically
    mode: 'alternating' | 'pattern';
    invert: boolean;              // false = exclude matched, true = render only matched
    priority: 'row-first' | 'column-first';
    
    // Alternating mode settings
    alternating: {
      skipEvery: number;          // Skip every Nth row/column (1-10)
      startIndex: number;         // Where alternation begins (0-indexed)
    };
    
    // Pattern mode settings
    pattern: Array<{
      row: number;
      columns: number[];          // Which columns to mask for this row
    }>;
  };
  
  // Future Filter Types (PLANNED)
  position: { ... };    // Filter by X/Y range, distance from center/edges
  count: { ... };       // Filter by shape index, random percentage
  color: { ... };       // Filter by hue range, saturation, lightness
  size: { ... };        // Filter by shape dimensions
  rotation: { ... };    // Filter by rotation angle ranges
  opacity: { ... };     // Filter by opacity thresholds
}
```

#### Key Design Decisions

1. **Standalone Section**: Shape Masking is NOT nested inside Distribution Layout. It appears as its own top-level section in the BatchConfigDialog, positioned between Distribution Layout and Properties sections.

2. **Dual Enable Toggles**: 
   - Master toggle enables/disables the entire Shape Masking feature
   - Each filter type (grid, position, etc.) has its own enable toggle
   - This allows enabling Shape Masking while selectively activating filter types

3. **Grid-Specific Application**: Grid Position masking only applies when Distribution Layout is set to "grid" pattern. For non-grid layouts (wave, spiral, ellipse, auto-distribute), the grid filter has no effect since there are no row/column concepts.

4. **Future Extensibility**: The architecture supports adding new filter types as subsections. Each filter type will have its own configuration panel and enable toggle.

#### Inversion Toggle
- **Invert OFF (default)**: Matched positions are EXCLUDED (shapes don't render at those positions)
- **Invert ON**: Matched positions are the ONLY ones that render (non-matched are excluded)

#### Implemented UI Controls

**Shape Masking Section** (Top-level, between Distribution Layout and Properties):
- Master enable checkbox with label "Shape Masking"
- Mode indicator showing current mode (Skip every N) or (Pattern)

**Grid Position Subsection** (when Shape Masking enabled):
- Enable checkbox with label "Grid Position" and description "Filter by row/column indices"
- **Mode dropdown**: Alternating or Pattern
- **Priority dropdown**: Row First or Column First
- **Invert checkbox**: Dynamic label showing current behavior
- **Alternating Settings** (when mode = alternating):
  - Skip Every N: Number input (1-10)
  - Start Index: Number input (0 to skipEvery-1)
  - Helper text showing which indices will be masked
- **Pattern Settings** (when mode = pattern):
  - Dynamic list of row/column pattern entries
  - Each entry: Row index input + Columns input (comma-separated)
  - Add/Remove buttons for pattern entries
  - Helper text explaining pattern usage

**Future Filters Placeholder**:
- Informational text: "Additional filter types (Position, Color, Size) coming soon"

#### Masking Logic (isPositionMasked function)

Located in `client/src/lib/shapeTypes.ts`:

```typescript
export function isPositionMasked(
  row: number,
  column: number,
  shapeMasking?: ShapeMaskingConfig
): boolean {
  // Returns true if position should be masked (excluded from rendering)
  
  // Early return if masking disabled
  if (!shapeMasking?.enabled || !shapeMasking?.grid?.enabled) {
    return false;
  }
  
  const grid = shapeMasking.grid;
  let isMatched = false;
  
  if (grid.mode === 'alternating') {
    // Check if row/column matches alternating pattern
    const { skipEvery, startIndex } = grid.alternating;
    if (grid.priority === 'row-first') {
      isMatched = ((row - startIndex) % skipEvery) === 0 && row >= startIndex;
    } else {
      isMatched = ((column - startIndex) % skipEvery) === 0 && column >= startIndex;
    }
  } else if (grid.mode === 'pattern') {
    // Check explicit row/column combinations
    for (const entry of grid.pattern) {
      if (entry.row === row && entry.columns.includes(column)) {
        isMatched = true;
        break;
      }
    }
  }
  
  // Apply inversion
  return grid.invert ? !isMatched : isMatched;
}
```

#### Usage in Distribution

The `applyGridDistribution` function in `shapeTypes.ts` uses masking:

```typescript
// Build list of valid (non-masked) grid positions
const validPositions = [];
for (let i = 0; i < totalPositions; i++) {
  const rowIndex = Math.floor(i / config.gridColumns);
  const colIndex = i % config.gridColumns;
  
  // Check if this position is masked
  if (!isPositionMasked(rowIndex, colIndex, config.shapeMasking)) {
    validPositions.push({ rowIndex, colIndex, linearIndex: i });
  }
}

// Map shapes to valid positions only
return sortedShapes.map((shape, index) => {
  const position = validPositions[index % validPositions.length];
  // Apply position to shape...
});
```

#### Interaction with Other Features
- Shape Masking applies to grid distribution specifically
- Works with Grid Offsets (Phase 1 & 2) - offsets are applied to non-masked positions
- Will work with Cell-Based Rendering (Phase 4) - defines valid cells for placement

#### Future Filter Types (Planned)

**Position-Based Masking**:
- Filter by absolute X/Y coordinate ranges
- Filter by distance from artboard center/edges
- Filter by quadrant or region

**Count-Based Masking**:
- Filter every Nth shape regardless of grid position
- Random percentage filtering
- First N / Last N shapes only

**Color-Based Masking**:
- Filter by hue range
- Filter by saturation/lightness thresholds
- Filter by specific color match

**Size-Based Masking**:
- Filter by shape dimensions (width/height)
- Filter by area
- Filter by aspect ratio

**Rotation-Based Masking**:
- Filter by rotation angle ranges
- Filter by specific angle values

**Opacity-Based Masking**:
- Filter by opacity thresholds
- Filter transparent/opaque shapes

#### Future Enhancement: Masked Shape Operations

**Concept**: The current shape masking system identifies shapes at specific grid positions and excludes them from rendering. Using the same selection logic, we could apply various transformations to these shapes instead of simply removing them. This transforms Shape Masking from a binary "show/hide" system into a powerful selective modification tool.

**Operation Types**:

**Transform Operations**:
- **Move/Translate**: Shift matched shapes by X/Y offset (create staggered effects)
- **Scale**: Resize matched shapes (alternating large/small patterns)
- **Rotate**: Apply rotation to matched shapes (directional emphasis)
- **Skew**: Apply skew transformations to matched shapes

**Visual Operations**:
- **Recolor Fill**: Change fill color of matched shapes (checkerboard color patterns)
- **Recolor Stroke**: Change stroke color/width of matched shapes
- **Adjust Opacity**: Modify opacity of matched shapes (fade alternate rows/columns)
- **Apply Blur**: Add blur effect to matched shapes (depth-of-field effects)
- **Apply Gradient**: Override gradient on matched shapes

**Compositional Operations**:
- **Change Blend Mode**: Apply different blend mode to matched shapes
- **Change Compositing**: Apply different compositing operation
- **Adjust Z-Index**: Modify layer order of matched shapes

**Shape Operations**:
- **Change Shape Type**: Transform matched shapes to a different type
- **Modify Properties**: Adjust shape-specific properties (corner radius, point count, etc.)

**Implementation Approach**:
```typescript
interface ShapeMaskingOperation {
  mode: 'exclude' | 'transform';  // Current 'exclude' is default
  
  // When mode is 'transform', apply these operations to matched shapes
  operations?: {
    translate?: { x: number; y: number };
    scale?: { x: number; y: number };
    rotate?: number;
    fillColor?: string;
    strokeColor?: string;
    opacity?: number;
    blur?: number;
    blendMode?: string;
    // ... additional operation types
  };
}
```

**UI Considerations**:
- Mode selector: "Exclude Shapes" (current) vs "Transform Shapes"
- When "Transform" mode selected, show operation configuration panel
- Multiple operations can be stacked (e.g., scale + recolor + rotate)
- Preview shows matched shapes with operations applied

**Use Cases**:
1. **Checkerboard patterns**: Alternate shapes with different colors/sizes
2. **Emphasis effects**: Scale up or highlight shapes at specific positions
3. **Depth simulation**: Reduce opacity/apply blur to create layered depth
4. **Pattern variation**: Rotate alternate shapes for visual interest
5. **Color gradients across grid**: Progressive color changes based on position

**Synergy with Existing Features**:
- Combines with all existing filter types (alternating, pattern, position, color, size, count)
- Works with Set Repetition Index Control for index-based operations
- Enables complex visual patterns without creating multiple shape sets

---

### Phase 4: Grid Render Mode ✅ IMPLEMENTED

#### Overview
Controls how shapes are positioned within grid cells with three distinct modes: Point (intersection-based), Cell (cell-centered), and Cell Points (hybrid approach).

**Implementation Status**: Complete  
**Location**: Part of Grid distribution settings in Distribution Layout section of BatchConfigDialog.tsx

#### Render Modes
| Mode | Position | Size Control | Position Count | Use Case |
|------|----------|-------------|----------------|----------|
| Point | Grid intersection points | Independent of grid | rows × cols | Traditional grid positioning |
| Cell | Center of cell area | Constrained by cell dimensions | (rows-1) × (cols-1) | Shapes filling cells between grid lines |
| Cell Points | Grid intersection points | Constrained by cell dimensions | rows × cols | Hybrid: intersection positioning with fit constraints |

#### Data Model
```typescript
cellConstraints: {
  enabled: boolean;           // Auto-set based on renderMode (true for cell/cell-point)
  renderMode: 'point' | 'cell' | 'cell-point';
  
  // Cell/Cell-Point mode settings (active when renderMode !== 'point')
  fitMode: 'none' | 'fill' | 'contain' | 'cover';
  // - none: Use original shape size, just center in cell
  // - contain: Scale to fit within cell (maintain aspect ratio)
  // - cover: Scale to cover cell (maintain aspect ratio)
  // - fill: Stretch to fill cell (configurable aspect ratio)
  
  maintainAspectRatio: boolean;   // For 'fill' mode - uses Math.max (cover ratio) when true
  padding: number;                // Inset from cell edges
  paddingUnit: 'px' | '%';        // Pixel or percentage of cell size
  showDebugGrid: boolean;         // Toggle debug overlay visualization
}
```

#### Key Differences Between Modes

**Point Mode:**
- Shapes positioned at grid intersection points
- No size constraints applied
- Count: rows × cols positions

**Cell Mode:**
- Shapes centered in cells BETWEEN grid lines
- Cell top-left corner aligns with intersection point
- Fit constraints (contain/cover/fill) applied based on cell size
- Count: (rows-1) × (cols-1) positions (fewer than Point mode)

**Cell Points Mode:**
- Shapes positioned at grid intersection points (like Point mode)
- Cells are CENTERED on intersection points (not between them)
- Fit constraints applied (like Cell mode)
- Count: rows × cols positions (same as Point mode)
- Note: Edge cells extend beyond artboard boundaries

#### Implementation Details
- **UI Location**: Render Mode dropdown within Grid distribution settings, after Grid Offsets
- **Client-side**: Full implementation in `shapeTypes.ts` with live preview
- **Server-side**: Full implementation in `distributionLayouts.ts` for export parity
- **Debug Grid**: Shows cell boundaries and position markers for all three modes
- **Fill Mode Fix**: When `maintainAspectRatio=true`, uses `Math.max` (cover ratio) to ensure shape fills entire cell

#### Cell Calculation Logic

**Cell Mode:**
```typescript
// Cell dimensions based on grid spacing
const cellWidth = gridSpacingX;
const cellHeight = gridSpacingY;

// Cell center position (cell starts at intersection, center is offset by half)
const cellCenterX = gridStartX + (col * cellWidth) + (cellWidth / 2);
const cellCenterY = gridStartY + (row * cellHeight) + (cellHeight / 2);
```

**Cell Points Mode:**
```typescript
// Cell dimensions same as grid spacing
const cellWidth = gridSpacingX;
const cellHeight = gridSpacingY;

// Position is AT the intersection point (cell is centered ON it)
const positionX = gridStartX + (col * cellWidth);
const positionY = gridStartY + (row * cellHeight);
// No offset needed - shape placed directly at intersection
```

#### Debug Grid Visualization
The debug grid renders on the shapes layer (top) and shows:
- **Point Mode**: Red dots at intersection points, red grid lines
- **Cell Mode**: Orange dashed cell rectangles between lines, green crosses at cell centers
- **Cell Points Mode**: Orange dashed cell rectangles centered ON intersections, combined green cross + red dot markers

#### Interaction with Shape Masking
Shape Masking (Phase 3) defines which cells are valid for rendering. Grid Render Mode then determines HOW shapes are placed within those valid cells.

---

### Phase 5: Grid Offset Presets ✅ COMPLETED

#### Overview
Pre-configured offset patterns that allow users to quickly apply common visual arrangements with a single click. These presets combine row and column offset settings to create recognizable patterns used in design, architecture, and nature.

**Implementation Status**: Planned  
**Location**: Within Grid Offsets section in BatchConfigDialog.tsx

#### Preset Definitions

| Preset | Description | Row Offset | Column Offset |
|--------|-------------|------------|---------------|
| None | Clear all offsets | Disabled | Disabled |
| Brick | Classic brick wall layout | 50% spacing, alternating rows | Disabled |
| Honeycomb | Hexagonal-style arrangement | 50% spacing, alternating rows | 25% spacing, alternating cols |
| Staircase | Progressive diagonal arrangement | Fixed step amount, alternating | Disabled |
| Zigzag | Alternating offset directions | Column-based vertical zigzag | Enabled |
| Diamond | Combined row/column offsets | 50% spacing, alternating | 50% spacing, alternating |

#### UI Implementation
- **Location**: Dropdown/button group above manual offset controls
- **Behavior**: 
  1. User selects a preset
  2. Offset controls update to show preset values (calculated from current grid spacing)
  3. User can modify values after applying (exits "preset mode")
  4. Selecting "None" clears all offsets

#### Preset Application Logic
```typescript
function applyOffsetPreset(preset: string, gridSpacingX: number, gridSpacingY: number): GridOffsets {
  switch (preset) {
    case 'brick':
      return {
        enabled: true,
        mode: 'alternating',
        row: { enabled: true, amount: gridSpacingX / 2, startIndex: 1, direction: 'right' },
        column: { enabled: false, amount: 0, startIndex: 0, direction: 'down' }
      };
    case 'honeycomb':
      return {
        enabled: true,
        mode: 'alternating',
        row: { enabled: true, amount: gridSpacingX / 2, startIndex: 1, direction: 'right' },
        column: { enabled: true, amount: gridSpacingY / 4, startIndex: 1, direction: 'down' }
      };
    case 'diamond':
      return {
        enabled: true,
        mode: 'alternating',
        row: { enabled: true, amount: gridSpacingX / 2, startIndex: 1, direction: 'right' },
        column: { enabled: true, amount: gridSpacingY / 2, startIndex: 1, direction: 'down' }
      };
    // ... other presets
  }
}
```

---

### Phase 6: Grid Offset Value Modes ✅ COMPLETED

#### Overview
Apply the standard value mode pattern (fixed/range/incremental) to the Grid Offset Amount property, enabling more dynamic and varied offset patterns.

**Implementation Status**: Completed  
**Location**: Within Grid Offsets row/column Amount controls

#### Value Modes
| Mode | Description | Example |
|------|-------------|---------|
| Fixed | Single value (current behavior) | 20px offset for all alternating rows |
| Range | Random value within min/max bounds | 10-30px offset, varies per row |
| Incremental | Progressive offset that grows | 1st row: 10px, 3rd row: 20px, 5th row: 30px |

#### Use Cases
- **Range mode**: More organic, irregular offset patterns with random variation
- **Incremental mode**: Progressively shifting offset patterns creating perspective or wave effects

#### Data Model Extension
```typescript
// Extend existing amount property
row: {
  enabled: boolean;
  amountMode: 'fixed' | 'range' | 'incremental';
  amount: number;              // For fixed mode
  amountMin: number;           // For range mode
  amountMax: number;           // For range mode
  amountBase: number;          // For incremental mode
  amountIncrement: number;     // For incremental mode
  startIndex: 0 | 1;
  direction: 'left' | 'right';
  pattern: number[];
}
```

#### Implementation Notes
- Follow established pattern used elsewhere in the application for value modes
- UI changes: Add mode selector and conditional inputs for range (min/max) or incremental (base/increment)
- Generation logic: Calculate offset based on mode and row/column index

---

### Phase 7: Future Shape Masking Filter Types 📋 FUTURE

#### Overview
Extend the Shape Masking system with additional filter types beyond grid position filtering.

**Implementation Status**: Future  
**Priority**: Low - depends on user demand

#### Planned Filter Types

**Position-Based Masking**:
- Filter by absolute X/Y coordinate ranges
- Filter by distance from artboard center/edges
- Filter by quadrant or region

**Count-Based Masking**:
- Filter every Nth shape regardless of grid position
- Random percentage filtering
- First N / Last N shapes only

**Color-Based Masking**:
- Filter by hue range
- Filter by saturation/lightness thresholds
- Filter by specific color match

**Size-Based Masking**:
- Filter by shape dimensions (width/height)
- Filter by area
- Filter by aspect ratio

**Rotation-Based Masking**:
- Filter by rotation angle ranges
- Filter by specific angle values

**Opacity-Based Masking**:
- Filter by opacity thresholds
- Filter transparent/opaque shapes

#### Masked Shape Operations Enhancement
Transform matched shapes instead of simply excluding them:

**Operation Types**:
- **Transform**: Move, scale, rotate, skew matched shapes
- **Visual**: Recolor fill/stroke, adjust opacity, apply blur, override gradient
- **Compositional**: Change blend mode, compositing operation, z-index
- **Shape**: Change shape type, modify type-specific properties

---

### Phase 8: No-Overlap/Distance Maintenance 📋 FUTURE

#### Overview
Advanced collision detection and resolution to ensure offset shapes don't overlap or maintain minimum distance from adjacent shapes.

**Implementation Status**: Future  
**Priority**: Low - significant complexity

#### Complexity
This phase involves:
- Collision detection between shapes
- Iterative position adjustment algorithms
- Performance considerations for large shape counts
- Edge case handling (when collision-free placement is impossible)

#### Potential Approaches
1. **Simple distance check**: Ensure minimum gap between shape bounds
2. **Collision resolution**: Iteratively push overlapping shapes apart
3. **Constraint-based placement**: Pre-calculate valid positions before placement
4. **Fallback strategies**: What happens when shapes can't fit without overlap?

#### Deferred Rationale
This phase is deferred due to:
- Significant algorithmic complexity
- Performance implications
- Need to establish Phases 1-4 first as foundation
- User demand will inform priority

---

### Technical Considerations

#### Client/Server Parity
All offset and masking calculations must be identical on client (preview) and server (export) to ensure what users see matches what they export.

#### Default Values
```typescript
// gridOffsets defaults
gridOffsets: {
  enabled: false,
  mode: 'alternating',
  row: { enabled: false, amount: 0, startIndex: 0, direction: 'right', pattern: [] },
  column: { enabled: false, amount: 0, startIndex: 0, direction: 'down', pattern: [] }
}

// shapeMasking defaults
shapeMasking: {
  enabled: false,
  grid: {
    enabled: false,
    mode: 'alternating',
    invert: false,
    priority: 'row-first',
    alternating: { skipEvery: 2, startIndex: 0 },
    pattern: []
  }
}

// cellConstraints defaults
cellConstraints: {
  enabled: false,
  renderMode: 'point',        // 'point' | 'cell' | 'cell-point'
  fitMode: 'contain',
  maintainAspectRatio: true,
  padding: 0,
  paddingUnit: 'px',
  showDebugGrid: false
}
```

#### Migration Strategy
New properties should be added with defaults that preserve existing behavior:
- `gridOffsets.enabled: false` → No offsets applied (current behavior)
- `shapeMasking.enabled: false` → All positions render (current behavior)
- `cellConstraints.renderMode: 'point'` → Current behavior (shapes at intersection points)

---

## Grid Offset Presets (Phase 5 Reference)

> **Note**: This section provides detailed documentation for Phase 5 implementation. See [Phase 5: Grid Offset Presets](#phase-5-grid-offset-presets--planned) above for the summary.

### Implementation Context
Grid Offset Presets build upon the Phase 1 Grid Offsets implementation, providing pre-defined configurations for the existing offset controls (enabled state, amount, startIndex, direction for both row and column axes).

### Preset Definitions

#### 1. Brick Pattern
**Description:** Classic brick wall or masonry layout where alternating rows are horizontally offset by half the column spacing.

**Configuration:**
```typescript
{
  row: {
    enabled: true,
    amount: gridSpacingX / 2,  // Half the horizontal grid spacing
    startIndex: 1,              // Start offset on 2nd row
    direction: 'right'
  },
  column: {
    enabled: false
  }
}
```

**Visual Effect:**
```
[*] [*] [*] [*]        Row 0 (not offset)
   [*] [*] [*] [*]     Row 1 (offset right by 50%)
[*] [*] [*] [*]        Row 2 (not offset)
   [*] [*] [*] [*]     Row 3 (offset right by 50%)
```

**Use Cases:**
- Brick wall textures
- Tiled floor patterns
- Running bond layouts
- Offset photo grids

---

#### 2. Honeycomb Pattern
**Description:** Hexagonal-style arrangement mimicking natural honeycomb structure. Alternating rows offset horizontally AND alternating columns offset vertically to create interlocking pattern.

**Configuration:**
```typescript
{
  row: {
    enabled: true,
    amount: gridSpacingX / 2,  // Half horizontal spacing
    startIndex: 1,
    direction: 'right'
  },
  column: {
    enabled: true,
    amount: gridSpacingY / 4,  // Quarter vertical spacing
    startIndex: 1,
    direction: 'down'
  }
}
```

**Visual Effect:**
```
[*]   [*]   [*]   [*]      Row 0
   [*]   [*]   [*]   [*]   Row 1 (offset right + down)
[*]   [*]   [*]   [*]      Row 2
   [*]   [*]   [*]   [*]   Row 3 (offset right + down)
```

**Use Cases:**
- Hexagonal grids
- Organic/natural patterns
- Efficient packing layouts
- Scientific/molecular diagrams

---

#### 3. Staircase Pattern
**Description:** Progressive diagonal arrangement where each row offsets further in the same direction, creating a descending or ascending stair effect.

**Configuration (Descending Right):**
```typescript
{
  row: {
    enabled: true,
    amount: 20,           // Fixed step amount (or gridSpacingX / 4)
    startIndex: 1,        // Apply to all rows from 2nd onwards
    direction: 'right'    // or 'left' for descending left
  },
  column: {
    enabled: false
  }
}
```

**Note:** True staircase requires incremental offset mode (Phase 2 enhancement) where amount increases per row. With alternating mode, this creates a simpler two-step pattern.

**Visual Effect (with alternating mode):**
```
[*] [*] [*] [*]           Row 0
    [*] [*] [*] [*]       Row 1 (offset)
[*] [*] [*] [*]           Row 2 (back to baseline)
    [*] [*] [*] [*]       Row 3 (offset)
```

**Use Cases:**
- Cascade layouts
- Timeline visualizations
- Hierarchical diagrams
- Motion/sequence illustrations

---

#### 4. Zigzag/Wave Pattern
**Description:** Alternating offset direction creating a zigzag or wave-like visual rhythm. Odd rows offset one direction, even rows offset the opposite direction.

**Configuration:**
```typescript
// Note: Current implementation doesn't support alternating direction per row.
// This preset would require Phase 2 pattern-based offsets or direction alternation.

// Workaround using column offset for vertical zigzag:
{
  row: {
    enabled: false
  },
  column: {
    enabled: true,
    amount: gridSpacingY / 2,
    startIndex: 1,
    direction: 'down'  // Creates vertical zigzag
  }
}
```

**True Zigzag (requires Phase 2):**
```
   [*] [*] [*] [*]        Row 0 (offset right)
[*] [*] [*] [*]           Row 1 (offset left)
   [*] [*] [*] [*]        Row 2 (offset right)
[*] [*] [*] [*]           Row 3 (offset left)
```

**Use Cases:**
- Chevron patterns
- Wave/water effects
- Dynamic visual rhythm
- Art deco styling

---

#### 5. Diamond/Checkerboard Pattern
**Description:** Combined row and column offsets that create a diamond or checkerboard-like arrangement with shapes at diagonal intersections.

**Configuration:**
```typescript
{
  row: {
    enabled: true,
    amount: gridSpacingX / 2,
    startIndex: 1,
    direction: 'right'
  },
  column: {
    enabled: true,
    amount: gridSpacingY / 2,
    startIndex: 1,
    direction: 'down'
  }
}
```

**Visual Effect:**
```
[*]     [*]     [*]        Row 0
    [*]     [*]     [*]    Row 1 (offset right + down)
[*]     [*]     [*]        Row 2
    [*]     [*]     [*]    Row 3 (offset right + down)
```

**Use Cases:**
- Argyle patterns
- Diamond tiling
- Decorative geometric designs
- Playing card patterns

---

### UI/UX Implementation

#### Preset Selector
- **Location:** Within Grid Offsets section, above manual controls
- **Format:** Dropdown or button group with preset names and icons
- **Options:** "None", "Brick", "Honeycomb", "Staircase", "Zigzag", "Diamond"

#### Behavior
1. User selects a preset
2. Offset controls update to show preset values
3. User can modify values after applying preset (exits "preset mode")
4. Selecting "None" clears all offsets

#### Visual Preview
- Small icon/thumbnail next to each preset option showing the pattern
- Tooltip with description on hover

#### Smart Defaults
- Preset amounts calculated from current grid spacing when possible
- If grid spacing is 0 or undefined, use sensible pixel values (e.g., 20px)

### Technical Notes

#### Preset Application Logic
```typescript
function applyOffsetPreset(preset: string, gridSpacingX: number, gridSpacingY: number): GridOffsets {
  switch (preset) {
    case 'brick':
      return {
        enabled: true,
        mode: 'alternating',
        row: { enabled: true, amount: gridSpacingX / 2, startIndex: 1, direction: 'right' },
        column: { enabled: false, amount: 0, startIndex: 0, direction: 'down' }
      };
    case 'honeycomb':
      return {
        enabled: true,
        mode: 'alternating',
        row: { enabled: true, amount: gridSpacingX / 2, startIndex: 1, direction: 'right' },
        column: { enabled: true, amount: gridSpacingY / 4, startIndex: 1, direction: 'down' }
      };
    case 'diamond':
      return {
        enabled: true,
        mode: 'alternating',
        row: { enabled: true, amount: gridSpacingX / 2, startIndex: 1, direction: 'right' },
        column: { enabled: true, amount: gridSpacingY / 2, startIndex: 1, direction: 'down' }
      };
    // ... other presets
  }
}
```

#### Future Enhancements
- User-defined presets (save current offset configuration as named preset)
- Preset variations (e.g., "Brick Left", "Brick Right")
- Preset combinations with pattern mode (Phase 2)
- Animated preview showing pattern effect

---

## Grid Offset Value Modes (Phase 6 Reference)

> **Note**: This section provides detailed documentation for Phase 6 implementation. See [Phase 6: Grid Offset Value Modes](#phase-6-grid-offset-value-modes--planned) above for the summary.

### Value Mode Pattern for Offset Properties
**Current:** Amount uses a simple fixed value.

**Enhancement:** Apply the standard value mode pattern (fixed/range/incremental) to the Amount property:

#### Amount Value Modes:
- **Fixed:** Single value (current behavior) - e.g., 20px offset
- **Range:** Random value within min/max bounds - e.g., 10-30px offset per alternating row
- **Incremental:** Progressive offset that grows - e.g., 1st row offset=10px, 3rd row offset=20px, 5th row offset=30px

**Use Cases:**
- Range mode: More organic, irregular offset patterns with random variation
- Incremental mode: Progressively shifting offset patterns creating perspective or wave effects

**Implementation Notes:**
- Would follow the established pattern used elsewhere in the application for value modes
- Requires UI changes to add mode selector and conditional inputs for range (min/max) or incremental (base/increment/modulation)
- Generation logic would need to calculate offset based on mode and row/column index

---

## 6. Echo/Motion Trails 🔶 PARTIAL (Project A Complete)

### Overview
A temporal/instancing effect system that creates multiple copies of shapes with progressive visual changes, producing motion blur trails, echo patterns, depth illusions, and kinetic effects. Unlike Shape Effects (blur, shadow, glow) which modify individual shape appearance, Echo/Motion Trails creates deliberate multi-copy arrangements with controlled property variations per echo.

### Current State
Shape Set repetitions are currently positioned identically—each repetition overlays exactly on top of previous instances. Users cannot create predictable offset patterns between repetitions without manually creating separate sets with different positions.

### Relationship to Other Features
- **Separate from Shape Effects:** Echo/Motion Trails is a temporal/instancing effect, not a per-shape shading effect. It can stack with Shape Effects (e.g., each echo copy can have blur applied).
- **Complements Set Repetition Index Control:** While Set Repetition Index Control modifies properties based on repetition index, Echo/Motion Trails specifically creates visual trails with position offsets and progressive fading.
- **Works at Shape or Set Level:** Can operate on individual shapes (per shapeIndex) or entire sets (per setRepIndex) for different creative results.

---

### Configuration Architecture

#### Scope and Driver System

| Parameter | Options | Description |
|-----------|---------|-------------|
| **scope** | `set` / `shape` / `both` | Whether echoes apply to entire set repetitions or individual shapes |
| **driver** | `shapeIndex` / `setRepIndex` / `combined` | Which index drives the echo offset calculation |

- **Set Scope:** Echoes entire set repetitions—useful for simple motion trails of complete compositions
- **Shape Scope:** Echoes individual shapes—enables per-shape trails with probability/filters for fine-grained control
- **Combined Driver:** Uses both indices for complex layered effects

---

### Offset/Direction Modes

#### Mode 1: Fixed Vector
User defines angle + distance per echo. Offsets accumulate (echo 1 at distance, echo 2 at 2×distance, etc.).

```typescript
mode: 'fixed-vector';
angle: number;              // Direction in degrees (0-360)
distancePerEcho: number;    // Pixels per echo step
```

**Use Case:** Consistent directional trails (motion blur, drop shadow stacks)

#### Mode 2: Auto-Motion
Derives direction from the delta between successive shapes (by shapeIndex or setRepIndex). Creates "follow the path" motion blur without manual angle configuration.

```typescript
mode: 'auto-motion';
distancePerEcho: number;    // Magnitude of offset per echo
fallbackAngle?: number;     // Used when no motion delta detected (default: 0)
```

**Use Case:** Automatic motion trails that follow incremental position changes in the generation config

#### Mode 3: Absolute Position
All echoes target a fixed position (no accumulation). Each echo moves toward the target with progressive fade/scale.

```typescript
mode: 'absolute-position';
target: { x: number; y: number };  // Fixed target coordinates
```

**Use Case:** Converging/diverging effects, gravity-like pulls toward a point

---

### Range-Based Jitter Modifier

Jitter adds randomness on top of any direction mode. Uses min/max range for consistency with other system properties.

```typescript
jitter?: {
  distance?: { min: number; max: number };  // Random ± variation to distance per echo
  angle?: { min: number; max: number };     // Random ± variation to angle per echo
};
```

**Behavior:**
- Per-echo random sampling between min and max values
- If omitted, no jitter applied
- Layers on top of fixed-vector, auto-motion, or absolute-position modes
- Creates organic, less mechanical echo patterns

---

### Per-Echo Effects

Each echo copy receives progressive visual modifications:

| Effect | Parameters | Description |
|--------|------------|-------------|
| **Opacity** | `start`, `falloff`, `min?` | Each echo fades by falloff amount; stops at min |
| **Blur** | `start`, `delta`, `max?` | Each echo gains blur; caps at max |
| **Scale** | `start`, `delta`, `min?`, `max?` | Each echo shrinks/grows by delta |
| **Rotation** | `delta` | Each echo rotates by delta degrees |
| **Color Shift** | `hue`, `saturation`, `lightness` | Progressive color tinting per echo |

---

### Apply-To Filters

Control which shapes receive the echo effect:

```typescript
applyTo?: {
  shapeTypes?: ShapeType[];           // Only these shape types
  indices?: number[];                 // Specific shape indices
  selector?: 'all' | 'even' | 'odd' | 'step';  // Index-based selection
  step?: number;                      // For 'step' selector: every Nth shape
  probability?: number;               // 0-100% chance per shape
};
```

---

### Complete TypeScript Schema

```typescript
interface EchoSpreadConfig {
  enabled: boolean;
  
  // Scope and Driver
  scope: 'set' | 'shape' | 'both';
  driver: 'shapeIndex' | 'setRepIndex' | 'combined';
  count: number;  // Number of echo copies (1-20)
  
  // Direction Mode
  mode: 'fixed-vector' | 'auto-motion' | 'absolute-position';
  
  // Fixed Vector mode
  angle?: number;              // Degrees (0-360)
  distancePerEcho?: number;    // Pixels per echo
  
  // Auto-Motion mode
  fallbackAngle?: number;      // When no delta detected (degrees)
  
  // Absolute Position mode
  target?: { x: number; y: number };
  
  // Jitter (range-based modifier)
  jitter?: {
    distance?: { min: number; max: number };
    angle?: { min: number; max: number };
  };
  
  // Per-Echo Effects
  opacity: {
    start: number;      // Initial opacity (0-1)
    falloff: number;    // Reduction per echo (0-1)
    min?: number;       // Minimum opacity floor
  };
  blur: {
    start: number;      // Initial blur radius (px)
    delta: number;      // Increase per echo (px)
    max?: number;       // Maximum blur cap
  };
  scale: {
    start: number;      // Initial scale multiplier (1.0 = 100%)
    delta: number;      // Change per echo (e.g., -0.1 for shrinking)
    min?: number;       // Minimum scale
    max?: number;       // Maximum scale
  };
  rotationDelta?: number;  // Degrees per echo
  colorShift?: {
    hue?: number;          // Hue shift per echo (degrees)
    saturation?: number;   // Saturation change per echo
    lightness?: number;    // Lightness change per echo
  };
  
  // Filters
  applyTo?: {
    shapeTypes?: ShapeType[];
    indices?: number[];
    selector?: 'all' | 'even' | 'odd' | 'step';
    step?: number;
    probability?: number;
  };
}
```

---

### Rendering Logic

```typescript
function generateEchoes(
  shape: Shape,
  shapeIndex: number,
  setRepIndex: number,
  config: EchoSpreadConfig,
  prevShapePosition?: { x: number; y: number }
): Shape[] {
  if (!config.enabled) return [shape];
  
  // Check filters
  if (!shouldApplyEcho(shape, shapeIndex, config.applyTo)) {
    return [shape];
  }
  
  const echoes: Shape[] = [];
  
  // Determine base direction
  let baseAngle: number;
  let baseDistance = config.distancePerEcho ?? 10;
  
  switch (config.mode) {
    case 'fixed-vector':
      baseAngle = config.angle ?? 0;
      break;
    case 'auto-motion':
      if (prevShapePosition) {
        const dx = shape.x - prevShapePosition.x;
        const dy = shape.y - prevShapePosition.y;
        baseAngle = Math.atan2(dy, dx) * (180 / Math.PI);
      } else {
        baseAngle = config.fallbackAngle ?? 0;
      }
      break;
    case 'absolute-position':
      // Direction toward target
      const tx = (config.target?.x ?? 0) - shape.x;
      const ty = (config.target?.y ?? 0) - shape.y;
      baseAngle = Math.atan2(ty, tx) * (180 / Math.PI);
      baseDistance = Math.sqrt(tx * tx + ty * ty) / config.count;
      break;
  }
  
  // Generate echo copies
  for (let i = 0; i < config.count; i++) {
    const echoIndex = i + 1;
    
    // Apply jitter
    let angle = baseAngle;
    let distance = baseDistance * echoIndex;
    
    if (config.jitter) {
      if (config.jitter.angle) {
        angle += randomInRange(config.jitter.angle.min, config.jitter.angle.max);
      }
      if (config.jitter.distance) {
        distance += randomInRange(config.jitter.distance.min, config.jitter.distance.max);
      }
    }
    
    // Calculate position
    const offsetX = Math.cos(angle * Math.PI / 180) * distance;
    const offsetY = Math.sin(angle * Math.PI / 180) * distance;
    
    // Calculate per-echo effects
    const opacity = Math.max(
      config.opacity.min ?? 0,
      config.opacity.start - (config.opacity.falloff * echoIndex)
    );
    const blur = Math.min(
      config.blur.max ?? 100,
      config.blur.start + (config.blur.delta * echoIndex)
    );
    const scale = clamp(
      config.scale.start + (config.scale.delta * echoIndex),
      config.scale.min ?? 0.1,
      config.scale.max ?? 10
    );
    const rotation = shape.rotation + ((config.rotationDelta ?? 0) * echoIndex);
    
    echoes.push({
      ...shape,
      x: shape.x + offsetX,
      y: shape.y + offsetY,
      opacity,
      blur,
      width: shape.width * scale,
      height: shape.height * scale,
      rotation,
      // Apply color shift if configured
      fill: config.colorShift 
        ? shiftColor(shape.fill, config.colorShift, echoIndex)
        : shape.fill,
    });
  }
  
  // Return echoes first (behind), then original shape (on top)
  return [...echoes.reverse(), shape];
}
```

---

### UI/UX Design

#### Location
New "Echo / Motion Trails" section in BatchConfigDialog, positioned after Shape Effects section. Also accessible via Sets Manager for per-set overrides.

#### Tab Structure
| Tab | Purpose |
|-----|---------|
| **Basic** | Set-level trails with simple controls (count, direction, fade) |
| **Advanced** | Shape-level control with filters, jitter, all per-echo effects |

#### Control Groupings

**Direction Group:**
- Mode selector: Fixed Vector / Auto-Motion / Absolute Position
- Angle input (for Fixed Vector)
- Distance per echo slider
- Jitter toggles and range inputs

**Effects Group:**
- Opacity: Start slider, Falloff slider, Min input
- Blur: Start, Delta, Max inputs
- Scale: Start, Delta, Min/Max inputs
- Rotation: Delta input
- Color Shift: Hue/Sat/Light sliders

**Filters Group:**
- Scope selector: Set / Shape / Both
- Driver selector: Shape Index / Set Rep Index / Combined
- Shape type multi-select
- Probability slider
- Index selector (all/even/odd/step)

#### Visual Indicators
- Badge: "Echo: 5 copies @ 45°" summary
- Ghost preview lines showing echo direction on canvas
- Count indicator with echo pattern thumbnail

---

### Use Cases

1. **Motion Blur Trails:** Auto-motion mode following position increments creates realistic motion blur
2. **Drop Shadow Stacks:** Fixed vector at 45° with opacity fade simulates layered shadows
3. **Neon Glow Trails:** Blur + opacity fade creates glowing trail effects
4. **Vintage Print Misregistration:** Small jitter + color shift simulates CMYK registration errors
5. **Kinetic Typography:** Suggest motion through positioned echo copies
6. **Depth Cascade:** Scale reduction + opacity fade creates receding perspective
7. **Radial Burst:** Multiple echoes with rotation delta creates starburst patterns
8. **Gravity Effects:** Absolute position mode pulls echoes toward a focal point

---

### Implementation Roadmap

Echo/Motion Trails is split into two sequential projects to reduce risk and validate core logic before adding complexity.

---

#### Project A: Set-Level Echo/Motion Trails ✅ IMPLEMENTED

**Goal:** Implement echo effects that operate on entire set repetitions, building on existing set repetition infrastructure.

**Implementation Date:** December 2025

**What was implemented:**

**Scope:** `scope` locked to `'set'` only. UI shows scope selector but "Shape" and "Both" options are disabled with tooltip explaining they're coming in a future update.

**Driver:** Uses `setRepIndex` driver. Combined mode stubbed but not active.

**Features Included:**
| Feature | Description |
|---------|-------------|
| Core Renderer | Echo generation logic with position offset calculations |
| Fixed-Vector Mode | User-defined angle + distance per echo |
| Auto-Motion Mode | Direction derived from set position deltas, with fallback angle |
| Per-Echo Effects | Opacity (start/falloff/min), blur (start/delta/max), scale (start/delta/min/max) |
| Rotation Delta | Progressive rotation per echo |
| Basic Jitter | Range-based distance and angle randomization |
| UI Section | "Echo / Motion Trails" in BatchConfigSettings with scope locked to Set |

**Deliverables:**
1. `EchoSpreadConfig` schema in `shared/schema.ts`
2. Echo rendering logic in generation pipeline (client-side)
3. UI controls in BatchConfigSettings
4. Canvas preview of echo trails
5. Persistence in project save/load
6. Server-side parity in `batchConfigProcessor.ts` for batch exports

**Server Parity Notes:**
- Fixed-vector mode: Full parity with client
- Auto-motion mode: Simulated on server (previous centroid not tracked across batch calls); fallback angle used
- All per-echo effects (opacity, blur, scale, rotation) with jitter: Full parity

**Success Criteria:**
- Set repetitions show trailing echoes with progressive fade/blur/scale
- Fixed-vector and auto-motion modes work correctly
- Jitter adds organic variation
- Performance acceptable for sets with 10+ repetitions and 5+ echoes each

---

#### Project B: Shape-Level Echo/Motion Trails ✅ IMPLEMENTED

**Goal:** Extend echo system to operate on individual shapes within sets, enabling fine-grained creative control.

**Scope:** Unlocks `scope: 'shape'` and `scope: 'both'` in UI.

**Driver:** Full support for `shapeIndex`, `setRepIndex`, and `combined` drivers.

**Features Included:**
| Feature | Description |
|---------|-------------|
| Shape-Level Echoes | Per-shape duplication with individual echo trails |
| Combined Driver | Uses both shape index and set rep index for complex effects |
| Granular applyTo Filters | Target by shape type, specific indices, even/odd/step selectors |
| Probability Filter | Random chance per shape to receive echoes |
| Absolute-Position Mode | All echoes converge toward/diverge from a fixed point |
| Color Shift | Progressive hue/saturation/lightness changes per echo |
| Per-Set Overrides | Override global echo config in Sets Manager |

**Performance Considerations:**
- Shape-level echoes can multiply shape count significantly (100 shapes × 5 echoes = 500 rendered shapes)
- Implement echo count warnings when total exceeds threshold
- Consider lazy echo generation or level-of-detail culling for canvas preview
- Server-side export may need batching for very large echo counts

**Deliverables:**
1. Extended renderer supporting shape-level echo generation
2. Full `applyTo` filter implementation with UI controls
3. Scope/driver selector fully enabled
4. Per-set override UI in Sets Manager
5. Performance monitoring and warnings

**Success Criteria:**
- Individual shapes can have independent echo trails
- Filters correctly target subsets of shapes
- Combined driver creates complex layered effects
- Performance remains acceptable with reasonable echo counts

**Relationship to Shape Selection Groups:**
The `applyTo` filter in Project B uses field names designed for future migration to the unified Shape Selection Groups system (Section 10). When that abstraction is built, echo filtering will reference reusable selection group IDs instead of embedding filter rules directly.

---

#### Forward Compatibility & Persistence Notes

**Schema Versioning:**
- `EchoSpreadConfig` will include a `version` field starting at `1`
- Project files will store echo config in `batchConfig.echoSpread`
- Backward compatibility: Projects without `echoSpread` default to `{ enabled: false }`

**Field Naming for Future Migration:**
The `applyTo` sub-object uses field names aligned with the future Shape Selection Groups abstraction:

| Echo Field | Future Selection Group Field | Purpose |
|------------|------------------------------|---------|
| `applyTo.shapeTypes` | `filter.shapeTypes` | Target specific shape types |
| `applyTo.indexMode` | `filter.indexMode` | all/even/odd/step selection |
| `applyTo.indexStep` | `filter.indexStep` | Step interval for step mode |
| `applyTo.probability` | `filter.probability` | Random sampling chance |

This alignment enables automated migration when Shape Selection Groups are implemented.

**Client/Server Parity:**
- Echo rendering logic will be implemented in shared utilities (`shared/echoUtils.ts`)
- Both client preview and server export use identical calculation functions
- Similar pattern to existing `shared/gridOffsetUtils.ts` and `shared/batchUtils.ts`

---

## 7. Advanced Multi-Filter System for Shape Sets ❌ NOT IMPLEMENTED

### Overview
A comprehensive filtering system for the Sets Manager dialog that enables efficient management of large numbers of shape sets through name-based and property-based filtering.

### Current State
The Sets Manager dialog displays all shape sets in a flat list. As projects grow to include dozens of sets, finding and managing specific sets becomes increasingly difficult. Users must scroll through the entire list to find sets with specific characteristics.

### Proposed Feature

#### Core Functionality

1. **Dual Filter Approach**
   - **Name Filter:** Quick-access dropdown showing all set names for direct selection
   - **Property Filters:** Combinable filter criteria that work as removable chips/badges

2. **Filter Categories**

   | Category | Options |
   |----------|---------|
   | Hidden Status | Hidden, Not Hidden |
   | Shape Types | Multi-select: rectangle, circle, polygon, star, etc. |
   | Lock Status | Locked, Unlocked |
   | Count Mode | Fixed, Range |
   | Blending | Enabled, Disabled |
   | Transforms | Enabled, Disabled |
   | Distribution Layout | Grid, Spiral, Wave, Ellipse, Auto-Distribute, None |
   | Z-index Range | Min/Max value inputs |
   | Repetition Mode | Use Global, Fixed, Range |
   | Has Pattern | Gradient, Solid, None |

3. **Multi-Filter Logic**
   - Filters combine with AND logic (sets must match ALL active filters)
   - Each filter category is independent
   - Clear visual indication of active filters

4. **Filter Management**
   - Add filters via dropdown + value selector → appears as removable chip
   - "Clear All Filters" button when filters are active
   - Live count display: "5 of 20 sets shown"
   - Filters persist during session (optional: save with project)

#### Technical Requirements

**Schema Extensions:**
```typescript
interface SetFilter {
  id: string;
  category: FilterCategory;
  value: string | number | boolean | string[];
  operator?: 'equals' | 'contains' | 'greater' | 'less' | 'range';
}

type FilterCategory = 
  | 'hidden' 
  | 'shape-types' 
  | 'locked' 
  | 'count-mode'
  | 'blending'
  | 'transforms'
  | 'distribution'
  | 'z-index-min'
  | 'z-index-max'
  | 'repetition-mode'
  | 'name';

interface FilterState {
  activeFilters: SetFilter[];
  nameSearch: string;
  showFilteredCount: boolean;
}
```

**Filter Logic Implementation:**
```typescript
function applyFilters(
  sets: GenerationSet[],
  filters: FilterState
): GenerationSet[] {
  return sets.filter(set => {
    // Name search (partial match)
    if (filters.nameSearch && !set.name.toLowerCase().includes(filters.nameSearch.toLowerCase())) {
      return false;
    }
    
    // Apply each active filter
    for (const filter of filters.activeFilters) {
      if (!matchesFilter(set, filter)) {
        return false;
      }
    }
    
    return true;
  });
}

function matchesFilter(set: GenerationSet, filter: SetFilter): boolean {
  switch (filter.category) {
    case 'hidden':
      return set.hidden === (filter.value === 'hidden');
    case 'locked':
      return set.locked === (filter.value === 'locked');
    case 'shape-types':
      const filterTypes = filter.value as string[];
      return set.shapeTypes.some(type => filterTypes.includes(type));
    case 'distribution':
      return set.batchConfig.distributionPattern === filter.value;
    case 'z-index-min':
      return set.zIndexOffset >= (filter.value as number);
    case 'z-index-max':
      return set.zIndexOffset <= (filter.value as number);
    case 'count-mode':
      return set.batchConfig.generationCountMode === filter.value;
    case 'blending':
      return set.batchConfig.setBlendingEnabled === (filter.value === 'enabled');
    case 'transforms':
      return set.batchConfig.setTransformEnabled === (filter.value === 'enabled');
    default:
      return true;
  }
}
```

#### UI/UX Design

**Filter Bar Layout:**
```
┌────────────────────────────────────────────────────────────────┐
│ 🔍 [Search by name...  ▼]  [+ Add Filter ▼]  [Clear All]      │
├────────────────────────────────────────────────────────────────┤
│ Active: [Hidden: Yes ✕] [Shape: Circle ✕] [Layout: Grid ✕]   │
├────────────────────────────────────────────────────────────────┤
│                    Showing 5 of 20 sets                        │
└────────────────────────────────────────────────────────────────┘
```

**Filter Chip Component:**
```tsx
function FilterChip({ filter, onRemove }: FilterChipProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-blue-600/20 
                    border border-blue-500/50 rounded-full text-xs">
      <span className="text-slate-400">{filter.category}:</span>
      <span className="text-slate-200">{filter.value}</span>
      <button onClick={onRemove} className="ml-1 hover:text-red-400">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
```

**Add Filter Dropdown:**
1. Click "+ Add Filter" → opens category selector
2. Select category (e.g., "Distribution Layout")
3. Shows value options for that category
4. Selecting value adds the filter chip immediately

#### Quick Filter Presets
Pre-defined filter combinations for common workflows:

| Preset Name | Filters Applied |
|-------------|-----------------|
| Show Hidden Only | hidden = true |
| Grid Layouts Only | distribution = grid |
| Active Sets | hidden = false, locked = false |
| Complex Sets | blending = enabled OR transforms = enabled |
| High Z-Index | z-index-min = 1000 |

#### Persistence Options
- **Session Only:** Filters reset when dialog closes (default)
- **Remember:** Filters persist across dialog open/close
- **Save with Project:** Filter state saved in project file

#### Implementation Phases

1. **Phase 1: Core Filtering**
   - Name search with partial matching
   - Basic filter categories: hidden, locked, shape-types
   - Filter chip UI with add/remove functionality
   - Live count display

2. **Phase 2: Extended Filters**
   - Distribution layout filter
   - Count mode filter
   - Blending/transforms enabled filters
   - Z-index range filters

3. **Phase 3: Advanced Features**
   - Quick filter presets
   - Filter persistence options
   - Bulk actions on filtered results
   - Export filtered set list

4. **Phase 4: UX Enhancements**
   - Filter suggestions based on current sets
   - Recently used filters
   - Keyboard shortcuts for common filters
   - Filter combinations saved as named presets

#### Benefits
1. **Efficiency:** Quickly isolate sets by specific criteria
2. **Organization:** Manage complex projects with many sets
3. **Workflow:** Create focused views for different tasks
4. **Discoverability:** Find sets with specific properties easily

---

## 7. Grid Render Mode: Cell Points

### Overview
A hybrid grid positioning mode that combines the positioning of Point mode (shapes at intersection points) with the fit constraints of Cell mode (shapes sized relative to cells). This provides the best of both worlds: maintaining the expected rows × cols shape count while enabling automatic shape sizing.

### Current State (Implemented)
The Grid Render Mode currently supports two modes:

1. **Point Mode** (Traditional)
   - Shapes positioned at grid intersection points
   - rows × cols positions (e.g., 5×4 = 20 shapes)
   - No automatic sizing constraints
   - Debug grid shows intersection markers

2. **Cell Mode**
   - Shapes positioned in cells between grid lines
   - (rows-1) × (cols-1) cells (e.g., 5×4 grid = 4×3 = 12 cells)
   - Fit mode constraints (contain, cover, fill)
   - Debug grid shows cell rectangles between lines

### Proposed Feature: Cell Points Mode

**Concept:** Shapes positioned at intersection points (like Point), but each position treated as a cell center with fit constraints applied (like Cell).

**Key Characteristics:**
- **Position count:** rows × cols (same as Point mode)
- **Cell size:** columnSpacing × rowSpacing (same spacing as between grid points)
- **Cell alignment:** Cells centered ON intersection points, not between them
- **Edge behavior:** Edge cells extend beyond artboard by half a cell width/height
- **Fit modes:** All fit modes available (none, contain, cover, fill)

### Comparison Table

| Aspect | Point | Cell | Cell Points |
|--------|-------|------|-------------|
| Positions | rows × cols | (rows-1) × (cols-1) | rows × cols |
| Cell constraints | None | Yes | Yes |
| Cell location | N/A | Between lines | Centered on points |
| Cell size | N/A | spacing × spacing | spacing × spacing |
| Edge overflow | No | No | Yes (half cell) |
| Debug grid | Intersection markers | Cell rectangles between lines | Cell rectangles on points |

### Technical Implementation

#### Position Calculation
Cell Points uses the same position formula as Point mode:
```typescript
// Point/Cell Points: shapes at intersection points
const x = startX + (col * columnSpacing);
const y = startY + (row * rowSpacing);
```

#### Cell Size Calculation
```typescript
// Cell size equals the grid spacing
const cellWidth = columnSpacing;
const cellHeight = rowSpacing;

// Cell bounds are centered on the grid point
const cellLeft = x - (cellWidth / 2);
const cellTop = y - (cellHeight / 2);
const cellRight = x + (cellWidth / 2);
const cellBottom = y + (cellHeight / 2);
```

#### Debug Grid Rendering
For Cell Points mode, the debug grid shows cell rectangles centered on each intersection point:
```typescript
if (renderMode === 'cell-point') {
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = startX + (col * columnSpacing);
      const y = startY + (row * rowSpacing);
      
      // Draw cell rectangle centered on point
      ctx.strokeRect(
        x - cellWidth / 2,
        y - cellHeight / 2,
        cellWidth,
        cellHeight
      );
      
      // Optionally mark center point
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
  }
}
```

### Use Cases

1. **Consistent Shape Count:** User wants exactly rows × cols shapes, but also wants automatic sizing
2. **Tile-like Layouts:** Creating tile patterns where shapes should fill their allocated space
3. **Responsive Grids:** Shapes that automatically scale to grid density changes
4. **Edge-to-Edge Designs:** Compositions where edge shapes intentionally extend beyond artboard

### UI/UX

**Dropdown Options:**
- Point (at intersections)
- Cell (between lines)
- Cell Points (at intersections, with fit)

**Tooltip Descriptions:**
- Point: "Shapes at grid intersection points, original size"
- Cell: "Shapes in cells between grid lines, with size constraints"
- Cell Points: "Shapes at intersections with cell-based size constraints"

### Implementation Status
**Status:** ✅ Implemented (November 2025) - Cell Points mode is now fully functional.

---

## 8. Shape Effects

### Overview
Visual effects that can be applied to individual shapes to enhance their appearance, create depth, or add artistic flair. These effects are applied during the rendering process and affect how shapes appear on the canvas and in exports.

### Implementation Status

| Effect | Status | Description |
|--------|--------|-------------|
| **Gaussian Blur** | ✅ Implemented | Canvas-based pixel manipulation blur with configurable radius |
| **Drop Shadow** | 📋 Planned | Offset shadow beneath shapes for depth effect |
| **Inner Shadow** | 📋 Planned | Shadow inside shape edges for inset effect |
| **Outer Glow** | 📋 Planned | Soft glow emanating outward from shape edges |
| **Inner Glow** | 📋 Planned | Soft glow emanating inward from shape edges |

---

### Gaussian Blur ✅ IMPLEMENTED

#### Overview
A canvas-based blur effect that applies Gaussian blur to individual shapes using pixel manipulation. This effect softens the edges and details of shapes, useful for creating depth, focus effects, or atmospheric elements.

**Implementation Status**: Complete  
**Location**: `client/src/lib/shapes.ts` - `renderWithCanvasBlur()` method

#### Technical Implementation
The blur effect uses a three-pass box blur approximation for Gaussian-like results:

```typescript
// Blur configuration in BatchConfigSettings
blurEnabled: boolean;          // Master toggle
blurProbability: number;       // 0-100% chance per shape
blurMode: 'range' | 'define' | 'incremental';
blurRange: [number, number];   // For range mode (e.g., [2, 15])
blurDefine: number;            // For define mode (fixed value)
blurIncremental: {             // For incremental mode
  startValue: number;
  increment: number;
};
```

#### Rendering Process
1. Shape is rendered to a temporary canvas
2. Expanded bounds calculated to accommodate blur spread
3. Three-pass box blur applied (horizontal → vertical → horizontal)
4. Blurred result composited back to main canvas

#### Value Modes
- **Range**: Random blur radius between min/max values
- **Define**: Fixed blur radius for all shapes
- **Incremental**: Progressive blur that increases per shape index

#### Limitations
- Maximum blur radius clamped to 20px for performance
- Canvas-based approach (not CSS filter) for export compatibility
- CPU-intensive for large blur radii on complex shapes

---

### Drop Shadow 📋 PLANNED

#### Overview
A shadow effect rendered beneath shapes, offset by configurable X/Y distance with adjustable blur and color.

#### Proposed Configuration
```typescript
dropShadow: {
  enabled: boolean;
  offsetX: number;           // Horizontal offset (pixels)
  offsetY: number;           // Vertical offset (pixels)
  blur: number;              // Blur radius (pixels)
  spread: number;            // Spread radius (pixels)
  color: string;             // Shadow color (RGBA)
  opacity: number;           // Shadow opacity (0-1)
};
```

#### Use Cases
- Depth and elevation effects
- Floating UI element styling
- 3D-like layering illusions
- Print-ready designs requiring shadow effects

---

### Inner Shadow 📋 PLANNED

#### Overview
A shadow effect rendered inside shape edges, creating an inset or carved appearance.

#### Proposed Configuration
```typescript
innerShadow: {
  enabled: boolean;
  offsetX: number;           // Horizontal offset (pixels)
  offsetY: number;           // Vertical offset (pixels)
  blur: number;              // Blur radius (pixels)
  color: string;             // Shadow color (RGBA)
  opacity: number;           // Shadow opacity (0-1)
};
```

#### Use Cases
- Debossed/pressed appearance
- Carved text or shapes
- Subtle depth variations
- Realistic material effects

---

### Outer Glow 📋 PLANNED

#### Overview
A soft luminous effect emanating outward from shape edges, commonly used for highlighting, neon effects, or magical elements.

#### Proposed Configuration
```typescript
outerGlow: {
  enabled: boolean;
  spread: number;            // Glow spread distance (pixels)
  blur: number;              // Glow blur radius (pixels)
  color: string;             // Glow color (RGBA)
  opacity: number;           // Glow opacity (0-1)
  technique: 'softer' | 'precise';  // Rendering technique
};
```

#### Use Cases
- Neon sign effects
- Magical/mystical elements
- Selection/highlight indicators
- Atmospheric lighting effects

---

### Inner Glow 📋 PLANNED

#### Overview
A soft luminous effect emanating inward from shape edges toward the center.

#### Proposed Configuration
```typescript
innerGlow: {
  enabled: boolean;
  size: number;              // Glow size from edge (pixels)
  blur: number;              // Glow blur radius (pixels)
  color: string;             // Glow color (RGBA)
  opacity: number;           // Glow opacity (0-1)
  source: 'edge' | 'center'; // Glow emanates from edge or center
};
```

#### Use Cases
- Glass or translucent material effects
- Glowing buttons or UI elements
- Energy/plasma effects
- Subtle edge highlighting

---

### Implementation Considerations

#### Rendering Order
Effects should be applied in a specific order for predictable results:
1. Drop Shadow (rendered beneath shape)
2. Outer Glow (rendered beneath shape, above shadow)
3. Shape fill and stroke
4. Inner Shadow (rendered inside shape)
5. Inner Glow (rendered inside shape)
6. Gaussian Blur (applied to entire rendered shape)

#### Performance Optimization
- Effects should be cached when shape properties don't change
- Consider using WebGL for GPU-accelerated rendering of effects
- Batch similar effects together for efficiency
- Provide quality presets (draft/normal/high) for different use cases

#### Export Compatibility
All effects must render identically in:
- Canvas display (real-time preview)
- Single image export (PNG, JPEG, etc.)
- Batch export operations
- Server-side rendering (API exports)

---

## 9. Server-Side High-Resolution Export ✅ COMPLETE - TESTING

### Overview
A server-side rendering system using Headless Chromium + Sharp library to overcome browser canvas memory limitations and produce professional print-quality exports (A4+ at 300+ DPI, 16-bit TIFF with sRGB ICC profiles).

### Problem Statement
Browser-based canvas rendering has inherent limitations:
- **Memory ceiling**: ~600 MB per tab, limiting canvas size to approximately 8000×8000 pixels
- **Bit depth**: Browser canvas only supports 8-bit color (256 levels per channel)
- **ICC profiles**: No native support for embedding color profiles in exports
- **Large exports**: A4 at 300 DPI (2480×3508 pixels) works, but A3/A2 at 300+ DPI exceeds browser limits

### Solution: Headless Chromium + Sharp Pipeline
Server-side rendering that:
1. Receives serialized shape/artboard data from the frontend
2. Renders shapes in headless Chrome using existing rendering logic
3. Captures canvas as PNG buffer
4. Pipes through Sharp for 16-bit TIFF conversion with sRGB ICC profiles and DPI metadata

### Implementation Status ✅ COMPLETE - TESTING (December 2025)

All validation tests passed successfully:

| Phase | Test | Result | Details |
|-------|------|--------|---------|
| **1** | Puppeteer (Headless Chrome) | ✅ PASSED | Screenshot: 212 KB, uses system Chromium |
| **2a** | Sharp 16-bit TIFF | ✅ PASSED | Depth: ushort (16-bit), DPI: 300, ICC: embedded |
| **2b** | Sharp Large Image (A4 @ 300 DPI) | ✅ PASSED | 2480×3508px, 0.06 MB, 306ms |
| **3** | Full Integration Pipeline | ✅ PASSED | Canvas→PNG→16-bit TIFF, 0.19 MB, 5s total |

**Key Technical Findings:**
- Sharp uses `.toColourspace('rgb16')` for true 16-bit output
- Sharp reports 16-bit as `depth: 'ushort'` (unsigned short)
- Use `.withMetadata()` to preserve ICC profiles (default strips them)
- Use deflate compression for 16-bit TIFF (LZW increases file size)
- Puppeteer requires `--no-sandbox` and `--disable-setuid-sandbox` flags on Replit

### Implementation Phases

#### Phase 1: Core Server Export Service ✅ COMPLETE
Created the server-side rendering engine:

**Files:**
- `server/services/exportService.ts` - HighResolutionExportService class with headless Chrome rendering
- `server/routes/export.ts` - POST /api/export/high-resolution endpoint

**Functionality:**
- Accept serialized shape/artboard data with full geometry (matching projectManager format)
- Launch headless Chrome with embedded rendering logic
- Capture canvas at requested DPI/resolution including bleed and print marks
- Pipe through Sharp for 16-bit TIFF with sRGB ICC profiles
- Memory management and cleanup

**Data Flow:**
```
Frontend → POST /api/export/high-resolution
         → { shapes, groups, artboard, exportSettings }
         → Server renders in headless Chrome
         → Sharp converts to 16-bit TIFF
         → Returns TIFF file as download
```

#### Phase 2: Seamless Export Integration ✅ COMPLETE
Integrated with existing export flow transparently:

**Auto-Detection Logic (requiresServerExport in imageExport.ts):**
```typescript
// Calculates scaled dimensions with DPI and bleed/print mark expansion
const dpiScale = dpi / 72;  // Base 72 DPI
const scaledWidth = width * dpiScale;
const scaledHeight = height * dpiScale;

// Server export triggers:
const needsServerExport = (
  scaledWidth > 32767 || scaledHeight > 32767 ||  // Canvas dimension limit
  totalPixels > 268_000_000 ||  // Browser pixel limit
  memoryMB > 500 ||  // Memory threshold
  format === 'tiff' && bitDepth === 16  // 16-bit TIFF required
);
```

**Enhanced Preflight Dialog (TiffPreflightModal.tsx):**
- Detects when server processing is required
- Shows purple "Server Processing Required" section
- Displays estimated processing time and file size
- Shows reason why server processing is needed
- Maintains existing "Don't show again" functionality

**Seamless Routing:**
- User clicks export as normal
- System automatically routes to server when needed
- Falls back to client-side for smaller exports (faster)
- Works for both single image and batch exports
- Global loading state prevents UI inconsistencies

#### Phase 3: Testing & Polish ✅ COMPLETE
- Tested various export scenarios (different sizes, DPIs, formats)
- Verified visual parity between client and server renders
- Full shape serialization matching projectManager format (id, type, transform, properties, points, geometry, render settings)
- Group serialization includes transform property
- Consolidated loading state management (isServerExportingGlobal only)
- DPI scaling applied before threshold checks
- Bleed and print marks expansion included in dimension calculations

### Technical Specifications

#### Supported Output Formats (Server-Side)
| Format | Bit Depth | ICC Profile | Compression | Use Case |
|--------|-----------|-------------|-------------|----------|
| TIFF | 16-bit | sRGB embedded | Deflate | Professional printing |
| PNG | 8-bit | sRGB embedded | Default | Web/digital |

#### Size Limits
| Paper Size | DPI | Dimensions (px) | Memory Est. | Server Required |
|------------|-----|-----------------|-------------|-----------------|
| A4 | 300 | 2480×3508 | ~35 MB | No (but recommended) |
| A3 | 300 | 3508×4960 | ~70 MB | Recommended |
| A2 | 300 | 4960×7016 | ~139 MB | Yes |
| A4 | 600 | 4960×7016 | ~139 MB | Yes |
| A1 | 300 | 7016×9933 | ~279 MB | Yes |

#### Performance Expectations
- Canvas render in headless Chrome: 1-3 seconds
- Sharp 16-bit TIFF conversion: 0.3-1 second
- Total pipeline: 2-5 seconds for typical print sizes
- Memory-safe processing with proper cleanup

### Files Created for Validation
Located in `server/validation/` (isolated, can be deleted after implementation):
- `puppeteer-test.ts` - Headless Chrome validation
- `sharp-test.ts` - 16-bit TIFF with ICC profile validation
- `integration-test.ts` - Full pipeline validation
- `run-all-tests.ts` - Test runner
- `output/` - Generated test files and validation report

### Dependencies Added
- `puppeteer-core` - Headless Chrome automation (uses system Chromium)
- `sharp` - High-performance image processing with 16-bit support
- System: `chromium` (added to replit.nix)

### UX Flow (Final Implementation)

1. **User initiates export** (existing UI, no changes)
2. **System checks requirements**:
   - If within browser limits → client-side export (instant)
   - If exceeds limits → show preflight dialog
3. **Preflight dialog** (when server needed):
   - "This export requires server processing for professional print quality"
   - Shows estimated time
   - "Continue" / "Cancel" buttons
4. **Server processing**:
   - Progress indicator shown
   - Shapes rendered in headless Chrome
   - Converted to 16-bit TIFF via Sharp
5. **Download** - File downloads automatically

### Synergy with Existing Features

**Print-on-Demand Configuration:**
- Bleed, safe zone, and print marks render correctly at any DPI
- Background mode (transparent, artboard color, custom) supported
- Unit conversion (px/mm/cm/in) based on artboard DPI

**Batch Export:**
- Server export works transparently in batch mode
- Each image processed sequentially with memory cleanup
- Existing batch progress UI shows server processing status

### Implemented Enhancements

#### 9.1 SSE Streaming for Real-Time Tile Progress Updates ✅ IMPLEMENTED

**Implementation Date:** December 6, 2025

**Overview:** Server-Sent Events (SSE) streaming for real-time progress updates during high-resolution exports, especially for very large exports that use tiled rendering (A0+ at 600+ DPI).

**Architecture:**
1. **Start Endpoint** (`POST /api/export/highres/start`): Initiates export session, returns `exportId` and stream URLs
2. **Stream Endpoint** (`GET /api/export/highres/stream`): SSE connection for real-time progress events
3. **Download Endpoint** (`GET /api/export/highres/download/:exportId`): Retrieves completed export file
4. **Cancel Endpoint** (`DELETE /api/export/highres/:exportId`): Cancels ongoing export

**Event Types:**
```typescript
// Phase events - major processing stages
{ type: 'phase', phase: 'preparing' | 'rendering' | 'stitching' | 'encoding', message: string }

// Tile events - individual tile progress for tiled exports
{ type: 'tile', tileIndex: number, totalTiles: number, step: 'render' | 'stitch', progressPct: number }

// Progress events - overall progress updates
{ type: 'progress', progressPct: number, status: string, estimatedSecondsRemaining?: number }

// Complete event - export finished successfully
{ type: 'complete', downloadUrl: string, filename: string, sizeBytes: number }

// Error event - export failed
{ type: 'error', message: string }

// Heartbeat event - keep connection alive
{ type: 'heartbeat' }
```

**Client Implementation:**
```typescript
import { executeServerExportWithSSE } from '@/lib/imageExport';

const result = await executeServerExportWithSSE(
  request,
  {
    onPhase: (phase, message) => setStatus(message),
    onTile: (tileIndex, totalTiles, step, progressPct) => {
      setStatus(`${step === 'render' ? 'Rendering' : 'Stitching'} tile ${tileIndex} of ${totalTiles}...`);
      setProgress(progressPct);
    },
    onProgress: (progressPct, status, estimatedRemaining) => {
      setProgress(progressPct);
      setStatus(status);
    },
    onComplete: (downloadUrl, filename, sizeBytes) => {
      // Download handled automatically
    },
    onError: (message) => setError(message)
  },
  abortController.signal
);
```

**Benefits:**
- Real-time tile progress updates visible in the client UI
- Better UX for long-running exports (minutes for very large prints)
- Detailed phase information (Preparing tiles, Rendering, Stitching, Encoding)
- Seamless integration with ExportProgressOverlay component
- Cancellation support via AbortController

### Known Limitations

#### 9.A Print Marks for Very Large Exports (300M+ Pixels) 🔶 WORKAROUND NEEDED

**Problem:** Sharp's composite operation fails with "Input image exceeds pixel limit" for images above ~250-300 megapixels, even with `limitInputPixels: false` and file-based I/O. This affects print marks overlay for A3+ exports at 300 DPI when bleed/print marks expand the canvas beyond the limit.

**Current Workaround:** Print marks are automatically skipped for exports exceeding 250M pixels with a console warning. The exported image is complete but without crop/registration marks.

**Root Cause:** Sharp/libvips needs to decode the entire image into memory to apply a composite overlay. For 339 megapixel images (e.g., A3 @ 300 DPI with bleed), this is ~1.36 GB of raw pixel data which exceeds internal limits.

**Important Note:** Print-on-demand services (IngramSpark, BookBaby, PublishDrive, etc.) explicitly require NO crop/registration marks. Their automated digital presses handle alignment internally. The current behavior (skipping print marks for large exports) is actually correct for POD workflows.

**Proposed Solutions (Priority Order):**

1. **Per-Tile Print Marks Composite** 📋 RECOMMENDED
   - Each tile is only ~64 megapixels (8000×8000), well under Sharp's 250M limit
   - After capturing each tile from Puppeteer:
     1. Generate a print marks SVG clipped to that tile's region
     2. Use Sharp's `composite()` on each individual tile (64M pixels - no problem!)
     3. Stitch the already-composited tiles together
   - Avoids ever hitting the pixel limit since composite happens per-tile
   - Complexity: Medium - requires calculating which marks fall within each tile's bounds
   - Example flow:
     ```
     Tile 1 (0,0) 8000×8000      →  composite with marks for region (0,0,8000,8000)
     Tile 2 (8000,0) 7651×8000   →  composite with marks for region (8000,0,...)
     ...then stitch tile1_with_marks + tile2_with_marks → final image
     ```

2. **Render Print Marks in Puppeteer Tiles** 📋 ALTERNATIVE
   - Calculate which print marks intersect each tile
   - Render them directly in the Puppeteer tile HTML
   - No post-composite needed - print marks become part of the tile render
   - Complexity: Medium - requires tile-aware print mark generation in HTML

3. **Raw Pixel Mosaic Writer** 📋 COMPLEX ALTERNATIVE
   - Extract raw RGBA pixels from each tile using `sharp(tile).raw().toBuffer()`
   - Write directly to a raw RGBA file at calculated byte offsets (row by row)
   - Stream the raw file through Sharp for format conversion
   - Avoids Sharp's composite entirely
   - Complexity: High - requires manual byte offset calculation

4. **jemalloc Memory Allocator** ✅ IMPLEMENTED
   - Install jemalloc: `nix install jemalloc`
   - Start Node with: `LD_PRELOAD=/path/to/libjemalloc.so node app.js`
   - Reduces memory fragmentation in multi-threaded Sharp operations
   - Helps overall memory stability but doesn't solve the pixel limit issue
   - Reference: https://sharp.pixelplumbing.com/install/#linux-memory-allocator

5. **Streaming Pipeline** 📋 FUTURE
   - Use Node.js streams throughout: `fs.createReadStream().pipe(sharp()).pipe(fs.createWriteStream())`
   - Prevents Node.js from holding entire image in memory
   - Reference: https://www.brand.dev/blog/preventing-memory-issues-in-node-js-sharp-a-journey

**Technical Resources:**
- Sharp Memory Issues: https://github.com/lovell/sharp/issues/3052
- Sharp Linux Allocator: https://sharp.pixelplumbing.com/install/#linux-memory-allocator
- Memory Optimization Guide: https://www.brand.dev/blog/preventing-memory-issues-in-node-js-sharp-a-journey

---

### Future Enhancements (Planned)

#### 9.2 Estimated Time Display in Progress Overlay 📋 PLANNED

**Problem:** During exports, users see elapsed time but have no indication of how long the export will take. This creates uncertainty for large exports that may take minutes.

**Proposed Solution:** Display estimated completion time alongside elapsed time in the progress overlay:

**UI Format:** `Elapsed: 00:45 / Est: ~02:30`

**Implementation Approach:**
1. Fetch estimate before starting server export (endpoint already exists: `/api/export/high-resolution/estimate`)
2. Pass `estimatedDuration` to ExportProgressOverlay component
3. Display formatted estimate alongside elapsed time
4. Optionally: Refine estimate during export based on actual progress

**Enhanced Estimate Calculation:**
```typescript
interface ServerExportEstimate {
  requiresServerExport: boolean;
  reason: string | null;
  estimatedDuration: number;  // milliseconds
  estimatedFileSizeMB: number;
  canvasWidth: number;
  canvasHeight: number;
  memoryRequiredMB: number;
  needsTiling: boolean;      // New: whether tiled rendering is needed
  tileCount: number;         // New: number of tiles if tiling
}

// Enhanced estimate formula
const baseRenderTime = pixelCount / 100_000_000 * 3000; // ~3s per 100MP
const tileOverhead = needsTiling ? tileCount * 500 : 0;  // ~500ms per tile
const stitchTime = needsTiling ? tileCount * 200 : 0;    // ~200ms per tile stitch
const encodeTime = format === 'tiff' && bitDepth === 16 ? 2000 : 500;
const estimatedDuration = baseRenderTime + tileOverhead + stitchTime + encodeTime;
```

**ExportProgressOverlay Enhancement:**
```typescript
interface ExportProgressOverlayProps {
  // ... existing props
  estimatedTime?: number;  // New: estimated duration in seconds
}

// Display format
<div className="flex items-center gap-2 text-slate-400">
  <Clock className="w-4 h-4" />
  <span className="font-mono">
    {formatElapsedTime(elapsedTime)}
    {estimatedTime && ` / Est: ~${formatElapsedTime(estimatedTime)}`}
  </span>
</div>
```

**Benefits:**
- Users can plan around export times for large prints
- Reduces anxiety during long exports
- Provides realistic expectations for A0+ exports at 600 DPI
- Natural fit with existing elapsed time display

---

## 10. Shape Selection Groups (Future Abstraction) 📋 PLANNED

### Overview

Shape Selection Groups is a proposed abstraction that unifies how different features target subsets of shapes. Currently, filtering logic is embedded directly in each feature (Shape Masking, Echo/Motion Trails applyTo, future effects). This creates duplication and prevents filter reuse across features.

### Problem Statement

Multiple features need to select subsets of shapes:

| Feature | Current Filter Location | Filter Capabilities |
|---------|------------------------|---------------------|
| Shape Masking | `shapeMaskingConfig` at top-level | Grid position (alternating, pattern), invert, priority |
| Echo/Motion Trails | `echoSpread.applyTo` in BatchConfig | Shape types, indices, probability |
| Future Effects | (not yet built) | Would need similar filtering |

Each feature reimplements similar concepts:
- Index-based selection (all, even, odd, step)
- Type-based filtering (rectangle, circle, etc.)
- Probability/random sampling
- Boolean logic (invert, combine)

### Proposed Solution

Create reusable **Shape Selection Groups** that can be:
1. Defined once with a name and filter rules
2. Referenced by ID in any feature that needs shape filtering
3. Managed in a dedicated UI section
4. Persisted and shared across features

### Prospective API

```typescript
interface ShapeSelectionGroup {
  id: string;
  name: string;                      // User-friendly name
  description?: string;              // Optional notes
  
  filters: ShapeSelectionFilter[];
  combineMode: 'all' | 'any';        // AND vs OR logic
  invert: boolean;                   // Flip selection
}

interface ShapeSelectionFilter {
  type: 'shapeType' | 'index' | 'gridPosition' | 'probability' | 'setId' | 'property';
  
  // Type-specific config (union type)
  shapeTypes?: ShapeType[];          // For 'shapeType' filter
  indexMode?: 'all' | 'even' | 'odd' | 'step' | 'specific';
  indexStep?: number;                // For step mode
  specificIndices?: number[];        // For specific mode
  gridPattern?: GridPositionPattern; // For 'gridPosition' filter
  probability?: number;              // For 'probability' filter (0-1)
  setIds?: string[];                 // For 'setId' filter
  propertyName?: string;             // For 'property' filter
  propertyComparator?: 'eq' | 'gt' | 'lt' | 'range';
  propertyValue?: number | string | [number, number];
}

// Usage in Echo/Motion Trails
interface EchoSpreadConfig {
  enabled: boolean;
  // ... other fields
  
  // Future: Replace embedded applyTo with reference
  selectionGroupId?: string;         // Reference to ShapeSelectionGroup
  
  // Legacy: Keep for backward compatibility during migration
  applyTo?: EchoApplyToConfig;       // Deprecated after migration
}

// Usage in Shape Masking
interface ShapeMaskingConfig {
  enabled: boolean;
  
  // Future: Reference selection group
  selectionGroupId?: string;
  
  // Legacy: Keep current embedded config
  gridPositionFilter?: GridPositionFilter;  // Deprecated after migration
}
```

### UI Concept

**Selection Groups Manager (new section in Sidebar):**
- List of defined selection groups
- Create/Edit/Delete groups
- Preview which shapes a group selects
- Duplicate groups for variations

**Feature Integration:**
- Features show dropdown to select existing group
- "Create New Group" option in dropdown
- "Edit" link to modify referenced group
- Visual indicator showing group name and match count

### Migration Strategy

1. **Phase 1: Build Infrastructure**
   - Implement `ShapeSelectionGroup` schema and storage
   - Build Selection Groups Manager UI
   - No feature integration yet

2. **Phase 2: Add to New Features First**
   - Echo/Motion Trails Project B uses selection groups natively
   - Any new effects use selection groups from start

3. **Phase 3: Migrate Existing Features**
   - Add `selectionGroupId` field to Shape Masking
   - Auto-migrate embedded filters to selection groups on project load
   - Deprecation warnings for direct filter usage

4. **Phase 4: Remove Legacy**
   - Remove embedded filter fields from features
   - Selection groups become the only way to filter shapes

### Benefits

| Benefit | Description |
|---------|-------------|
| Reusability | Define once, use in Echo, Masking, future effects |
| Consistency | All features use same filter logic and UI patterns |
| Composability | Combine groups with AND/OR logic |
| Discoverability | Central place to see all filter definitions |
| Maintainability | Filter logic in one place, not spread across features |

### Implementation Timeline

Shape Selection Groups is planned for implementation **after** Echo/Motion Trails Project B completes. The Echo `applyTo` field names are designed to map cleanly to this abstraction when migration occurs.

**Dependencies:**
- Echo/Motion Trails Project A: No dependency (uses set-level only)
- Echo/Motion Trails Project B: Uses `applyTo` with forward-compatible naming
- Shape Selection Groups: Built as standalone, then connected to existing features

---

## 11. Export Metadata Embedding Audit & Settings Sync 📋 PLANNED

### Overview
This section documents the current state of metadata embedding in exported images and outlines a plan for synchronizing export settings between User Settings and the Sidebar export section.

### Current Metadata Embedding Status (Audit: December 2025)

#### Server-Side Exports

| Format | DPI | ICC Profile | Artist/Copyright/Title | Bit Depth | Notes |
|--------|-----|-------------|----------------------|-----------|-------|
| **TIFF** | ✅ | ✅ sRGB | ✅ EXIF tags | ✅ 8/16-bit | Full metadata support |
| **PNG** | ✅ | ✅ sRGB | ✅ EXIF tags | 8-bit only* | *16-bit possible but not wired up |
| **JPEG** | ✅ | ✅ sRGB | ✅ EXIF tags | N/A (lossy) | Quality setting supported |
| **WebP** | ❌ | ✅ sRGB only | ❌ EXIF stripped | N/A | Limited metadata support |
| **PDF** | ✅ | ❌ | ✅ PDF properties | N/A | Uses jsPDF document properties |

#### Client-Side (Browser) Exports

| Format | DPI | ICC Profile | Artist/Copyright/Title | Notes |
|--------|-----|-------------|----------------------|-------|
| **TIFF** | ✅ | ✅ | ❌ No EXIF | UTIF library doesn't support EXIF |
| **PNG** | ✅ | ✅ | ❌ No EXIF | Only ICC embedding supported |
| **JPEG** | ✅ | ✅ | ❌ No EXIF | Only ICC embedding supported |

#### Key Findings

1. **Server exports embed full metadata** - TIFF/PNG/JPEG support artist, copyright, title via EXIF
2. **Client exports only embed ICC profiles** - No EXIF metadata capability in browser
3. **WebP has limited support** - Only ICC profile, no EXIF due to format limitations
4. **PDF uses document properties** - Title, author, creator, subject, keywords

### Proposed: Settings Synchronization

#### Current Problem
- **User Settings → Export section** has POD (Print-on-Demand) settings
- **Sidebar → Export & Save section** has TIFF-specific options
- These are independent and don't sync with each other

#### Proposed Solution

1. **Rename "TIFF Bit Depth" to "Bit Depth"** - It's format-agnostic (applies to PNG 16-bit, etc.)

2. **Bidirectional Sync**
   - Changes in User Settings → Export should update Sidebar values
   - Changes in Sidebar should update User Settings defaults
   
3. **Hierarchical Override System** (Future)
   ```
   Document Level → Artboard Level (overrides) → Export Session (overrides)
   ```
   - Document: Default bit depth, ICC profile, metadata
   - Artboard: Can override document defaults
   - Export: One-time override for current export only

4. **User Settings Export Section Rework**
   - Add file type dropdown (TIFF, PNG, JPEG, etc.)
   - Show type-specific settings when selected
   - Keep type-agnostic metadata (artist, copyright) always visible

5. **Toggle Controls in Export Section**
   - ICC Profile: Enable/disable inclusion in exported image
   - Metadata: Enable/disable EXIF embedding
   - Always included in project JSON regardless of toggle state

### Implementation Priority

| Task | Priority | Complexity |
|------|----------|------------|
| Rename TIFF Bit Depth → Bit Depth | High | Low |
| Bidirectional settings sync | Medium | Medium |
| User Settings file type dropdown | Medium | Medium |
| Hierarchical override system | Low | High |

---

## 12. Export & Save Section Contextual UI 📋 PLANNED

### Overview
Clean up the Export & Save sidebar section to show/hide options based on the selected format, document dimensions, and resolution. This reduces cognitive load by only displaying relevant options.

### Current Issues

1. **Irrelevant options visible** - "Export Project Files" and "Package as ZIP" shown for server exports (they only apply to browser exports)
2. **Browser/Auto options for large files** - When dimensions require server processing, browser/auto options are redundant
3. **"Export all images" when count=1** - Unnecessary option when only one image is being generated
4. **Format-specific vs universal options** - Not clear which settings apply to which formats

### Proposed Logic

#### Format Detection
```
Web Formats (browser-capable): PNG, JPEG, WebP, AVIF at reasonable sizes
Print Formats (server-required): TIFF, PDF, or any format at high resolution
```

#### Dimension/Resolution Thresholds
```javascript
// Megapixels calculation
const megapixels = (width * height * scale * scale * (dpi/72)^2) / 1_000_000;

// Server required if:
// - Format is TIFF or PDF
// - megapixels > 100 (browser memory limit)
// - 16-bit depth requested
```

#### UI Behavior

| Condition | Render Mode Selector | Browser Export Options | Server Options |
|-----------|---------------------|----------------------|----------------|
| Small web format | Show all (Browser/Auto/Server) | Show all | Show 7z compression |
| Large print format | Auto-select Server, grey out others | Hide | Show 7z compression |
| TIFF/PDF any size | Auto-select Server, grey out others | Hide | Show 7z compression |

#### Option Visibility Rules

1. **"Export Project Files" + "Package as ZIP"**
   - Show: Only for browser-processed exports
   - Hide: For server-processed exports (has separate 7z option)

2. **"Number of Exports" / Batch Count**
   - Show: Always (applies to both paths)

3. **Render Mode Selector (Browser/Auto/Server)**
   - Full selector: When browser is viable option
   - Server-only badge: When server is required (hide other options entirely)

4. **Format-Specific Options**
   - TIFF: Bit depth, compression, flatten-to-RGB, matte color
   - JPEG/WebP/AVIF: Quality slider
   - PDF: Metadata info panel
   - PNG: (minimal - just compression level if added)

### Alternative Approach: Server Badge

Instead of greying out Browser/Auto options, display "Server" as a non-interactive badge/label when server processing is required. This provides a cleaner UI without confusing disabled options.

**Pros:**
- Cleaner appearance
- No "why can't I click this?" confusion

**Cons:**
- User doesn't see that other options exist
- Might be confusing if they've previously seen the full selector

### Implementation Phases

1. **Phase 1: Basic Show/Hide**
   - Hide browser export options when server is required
   - Auto-select server render mode for large/print formats

2. **Phase 2: Format-Specific Blocks**
   - Organize options into collapsible format-specific sections
   - Only show section for currently selected format

3. **Phase 3: Smart Defaults**
   - Auto-detect optimal settings based on artboard size and DPI
   - Suggest server export when approaching browser limits

---

## Notes

This document will be updated as requirements evolve and technical constraints are identified. Implementation details may change based on user feedback and architectural decisions.

Last updated: December 12, 2025
