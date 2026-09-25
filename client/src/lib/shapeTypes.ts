import { 
  GridOffsetsConfig, 
  GridOffsetAxisConfig, 
  DEFAULT_GRID_OFFSETS, 
  ShapeMaskingConfig, 
  DEFAULT_SHAPE_MASKING, 
  CellConstraintsConfig, 
  DEFAULT_CELL_CONSTRAINTS,
  CellAnchor,
  CELL_ANCHOR_UV,
  // Print configuration types
  PrintUnitType,
  BackgroundMode,
  OutputSpecs,
  BleedSettings,
  SafeZoneSettings,
  PrintMarksSettings,
  BackgroundExportSettings,
  PrintableOverlays,
  PrintConfig,
  DEFAULT_PRINT_CONFIG,
} from '@shared/schema';
import { 
  calculateGridOffsetAmount, 
  calculateGridOffsets,
  isGridPositionMasked 
} from '@shared/gridOffsetUtils';
import { resolveScalarSeries } from '@shared/batchUtils';
import { getGridTraversalPositions, type GridTraversalOptions } from '@shared/gridTraversal';

// Re-export print types for convenience
export type { 
  PrintUnitType, 
  BackgroundMode, 
  OutputSpecs, 
  BleedSettings, 
  SafeZoneSettings, 
  PrintMarksSettings, 
  BackgroundExportSettings, 
  PrintableOverlays, 
  PrintConfig 
};
export { DEFAULT_PRINT_CONFIG };

// Helper function to convert print units to pixels
export function printUnitsToPixels(value: number, unit: PrintUnitType, dpi: number): number {
  switch (unit) {
    case 'pixels':
      return value;
    case 'inches':
      return value * dpi;
    case 'mm':
      return (value / 25.4) * dpi;
    case 'cm':
      return (value / 2.54) * dpi;
    default:
      return value;
  }
}

// Helper function to convert pixels to print units
export function pixelsToPrintUnits(pixels: number, unit: PrintUnitType, dpi: number): number {
  switch (unit) {
    case 'pixels':
      return pixels;
    case 'inches':
      return pixels / dpi;
    case 'mm':
      return (pixels / dpi) * 25.4;
    case 'cm':
      return (pixels / dpi) * 2.54;
    default:
      return pixels;
  }
}

// Helper function to get effective print config from artboard (merges legacy fields)
export function getEffectivePrintConfig(artboard: {
  dpi?: number;
  unitType?: PrintUnitType;
  backgroundColor?: string;
  printConfig?: PrintConfig;
}): PrintConfig {
  const existing = artboard.printConfig;

  // Artboard DPI and unit are authoritative. Deep-clone/merge every nested
  // section so callers never retain references to DEFAULT_PRINT_CONFIG and
  // older partial configs keep all current fields.
  return {
    outputSpecs: {
      ...DEFAULT_PRINT_CONFIG.outputSpecs,
      ...existing?.outputSpecs,
      dpi: artboard.dpi ?? existing?.outputSpecs?.dpi ?? DEFAULT_PRINT_CONFIG.outputSpecs.dpi,
      unitType: artboard.unitType ?? existing?.outputSpecs?.unitType ?? DEFAULT_PRINT_CONFIG.outputSpecs.unitType,
    },
    overlays: {
      ...DEFAULT_PRINT_CONFIG.overlays,
      ...existing?.overlays,
      bleed: {
        ...DEFAULT_PRINT_CONFIG.overlays.bleed,
        ...existing?.overlays?.bleed,
      },
      safeZone: {
        ...DEFAULT_PRINT_CONFIG.overlays.safeZone,
        ...existing?.overlays?.safeZone,
      },
      printMarks: {
        ...DEFAULT_PRINT_CONFIG.overlays.printMarks,
        ...existing?.overlays?.printMarks,
      },
      background: {
        ...DEFAULT_PRINT_CONFIG.overlays.background,
        ...existing?.overlays?.background,
        ...(!existing && artboard.backgroundColor
          ? { customColor: artboard.backgroundColor }
          : {}),
      },
    },
  };
}

// Helper function to calculate bleed in pixels for an artboard
export function getBleedPixels(artboard: { printConfig?: PrintConfig; dpi?: number }): number {
  const config = getEffectivePrintConfig(artboard);
  const bleed = config.overlays.bleed;
  const overlayUnit = config.overlays.overlayUnit ?? 'pixels';
  return printUnitsToPixels(bleed.amount, overlayUnit, config.outputSpecs.dpi);
}

// Helper function to calculate safe zone in pixels for an artboard
export function getSafeZonePixels(artboard: { printConfig?: PrintConfig; dpi?: number }): number {
  const config = getEffectivePrintConfig(artboard);
  const safeZone = config.overlays.safeZone;
  const overlayUnit = config.overlays.overlayUnit ?? 'pixels';
  return printUnitsToPixels(safeZone.amount, overlayUnit, config.outputSpecs.dpi);
}

// ============================================================================
// Core Shape Types
// ============================================================================

export interface Point {
  x: number;
  y: number;
}

export interface TangentHandle {
  in: Point;   // Incoming tangent handle
  out: Point;  // Outgoing tangent handle
  linked: boolean; // Whether handles maintain collinearity
  smooth: boolean; // Whether this point creates smooth continuity
}

export interface GridPosition {
  x: number;
  y: number;
  row: number;
  column: number;
}

export interface DistributionConfig extends GridTraversalOptions {
  enabled: boolean;
  pattern: 'grid' | 'wave' | 'ellipse' | 'spiral' | 'auto-distribute' | 'copy-to-points';
  gridRows: number;
  gridColumns: number;
  gridStartX?: number;
  gridStartY?: number;
  gridRowOffset: number;
  gridColumnOffset: number;
  gridMarginEnabled?: boolean;
  gridMarginMode?: 'absolute' | 'relative';
  gridMarginUnit?: 'px' | '%';
  gridMarginTop?: number;
  gridMarginRight?: number;
  gridMarginBottom?: number;
  gridMarginLeft?: number;
  gridGutterEnabled?: boolean;
  gridGutterX?: number;
  gridGutterY?: number;
  gridSortBy: 'layer' | 'id' | 'shape-type' | 'fill-color' | 'opacity' | 'size' | 'angle' | 'creation-time' | 'none' | 
    'corner-radius' | 'point-count' | 'edge-count' | 'inner-radius' | 'segment-count' | 
    'direction' | 'length' | 'centroid' | 'spread' | 'curvature';
  gridSortScope: 'per-generation' | 'per-batch';
  gridSortOrder: 'ascending' | 'descending';
  gridGroupByShapeType?: boolean;
  gridReverseGroups?: boolean;
  gridXRandomization: number;
  gridYRandomization: number;
  gridOffsets?: GridOffsetsConfig;
  shapeMasking?: ShapeMaskingConfig;
  cellConstraints?: CellConstraintsConfig;
  waveType?: 'sine' | 'triangle' | 'square' | 'sawtooth';
  waveAmplitude?: number;
  waveFrequency?: number;
  waveDirection?: 'horizontal' | 'vertical';
  wavePhaseOffset?: number;
  ellipseXRadius?: [number, number];
  ellipseYRadius?: [number, number];
  ellipseRingCount?: number;
  ellipseRingSpacing?: 'even' | 'progressive';
  ellipseRotation?: number;
  ellipseRotationAlignment?: 'uniform' | 'progressive';
  ellipseAlignToRing?: boolean;
  ellipseFlipInward?: boolean;
  ellipseAdditionalRotation?: number;
  ellipseShapeRotationMode?: 'none' | 'fixed' | 'range' | 'incremental' | 'series';
  ellipseRotationFixed?: number;
  ellipseRotationRange?: [number, number];
  ellipseRotationIncrementalStart?: number;
  ellipseRotationIncrementalStep?: number;
  ellipseShapeRotationSeriesItems?: Array<{ mode: 'fixed'; value: number } | { mode: 'range'; valueRange: [number, number] }>;
  ellipseShapeRotationSeriesSelection?: 'sequential' | 'random';
  ellipseShapeRotationSeriesExhaustion?: 'cycle' | 'bounce';
  ellipseShapeRotationSeriesDriver?: 'shape-index' | 'set-rep-index';
  _setRepIndex?: number;
  spiralTurnCount?: number;
  spiralSpacingMode?: 'linear' | 'logarithmic';
  spiralDirection?: 'clockwise' | 'counterclockwise';
  spiralStartAngle?: number;
  spiralTightness?: number;
  tangentAlignment?: boolean;
  segmentDistribution?: 'even' | 'clustered';
  reverseDirection?: boolean;
}

export interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  skewX: number;
  skewY: number;
}

export type BlendMode = 
  | 'source-over' 
  | 'multiply' 
  | 'screen' 
  | 'overlay' 
  | 'darken' 
  | 'lighten' 
  | 'color-dodge' 
  | 'color-burn' 
  | 'hard-light' 
  | 'soft-light' 
  | 'difference' 
  | 'exclusion' 
  | 'hue' 
  | 'saturation' 
  | 'color' 
  | 'luminosity'
  // Compositing operations for masking effects
  | 'source-in'
  | 'source-out'
  | 'source-atop'
  | 'destination-over'
  | 'destination-in'
  | 'destination-out'
  | 'destination-atop'
  | 'lighter'
  | 'copy'
  | 'xor';

export type BooleanOperation = 
  | 'union' 
  | 'subtract' 
  | 'intersect' 
  | 'exclude';

export interface HSLShift {
  hue: number; // -180 to 180 degrees
  saturation: number; // -100 to 100 percent
  lightness: number; // -100 to 100 percent
  enabled: boolean;
}

export interface ColorRemapping {
  sourceColor: string;
  targetColor: string;
  tolerance: number; // 0-100, how close colors need to be to match
}

export interface ColorManipulation {
  mode: 'shift' | 'remap';
  hslShift?: HSLShift;
  remappings?: ColorRemapping[];
  affectFill: boolean;
  affectStroke: boolean;
}

export interface ShapeProperties {
  fillColor: string | 'none';
  fillOpacity: number;
  strokeColor: string | 'none';
  strokeWidth: number;
  strokeOpacity: number;
  blendMode: BlendMode;
  zIndex: number;
  blurRadius: number; // 0 = no blur, >0 = blur in pixels
  blurType?: 'box' | 'gaussian'; // Missing on existing shapes = legacy box blur
  gradient?: {
    type: 'linear' | 'radial' | 'conic' | 'diamond';
    stops: { offset: number; color: string }[];
    // Linear gradient specific parameters
    angle?: number; // Angle in degrees (0-360)
    linearCenterX?: number;
    linearCenterY?: number;
    linearScale?: number; // Scale percentage; 100 preserves the current rendering
    // Radial gradient specific parameters
    radialCenterX?: number; // Center X as percentage of shape bounds (0-100)
    radialCenterY?: number; // Center Y as percentage of shape bounds (0-100)
    radialScale?: number; // Scale percentage; 100 preserves the current rendering
    // Conic gradient specific parameters
    conicAngle?: number; // Start angle in radians (0-2π)
    conicCenterX?: number; // Center X as percentage of shape bounds (0-100)
    conicCenterY?: number; // Center Y as percentage of shape bounds (0-100)
    diamondCenterX?: number; // Center X as percentage of shape bounds (0-100)
    diamondCenterY?: number; // Center Y as percentage of shape bounds (0-100)
    diamondAngle?: number; // Rotation angle in degrees
    diamondScale?: number; // Scale percentage; 100 preserves the current rendering
    diamondScaleEdgeMode?: 'streak' | 'repeat';
  };
  openCurveFilled?: boolean; // When false, open curve shapes skip ctx.fill()
  // Boolean operation properties
  booleanOperation?: 'union' | 'subtract' | 'intersect' | 'exclude';
  booleanTarget?: string; // ID of target shape for boolean operation
  // Color manipulation properties
  colorShift?: {
    hue: number;
    saturation: number;
    lightness: number;
    enabled: boolean;
  };
  // Drop Shadow effect
  dropShadow?: {
    enabled: boolean;
    offsetX: number;
    offsetY: number;
    blur: number;
    spread: number;
    color: string; // Computed color (from auto or custom)
    opacity: number; // 0-100
    blendMode: 'multiply' | 'darken' | 'overlay';
  };
  // Outer Glow effect
  outerGlow?: {
    enabled: boolean;
    blur: number;
    spread: number;
    color: string; // Computed color (from auto or custom)
    opacity: number; // 0-100
    blendMode: 'screen' | 'add' | 'soft-light' | 'color-dodge' | 'lighter';
  };
  // Inner Shadow effect
  innerShadow?: {
    enabled: boolean;
    offsetX: number;
    offsetY: number;
    blur: number;
    color: string; // Computed color (from auto or custom)
    opacity: number; // 0-100
    blendMode: 'multiply' | 'darken' | 'overlay';
  };
  // Inner Glow effect
  innerGlow?: {
    enabled: boolean;
    blur: number;
    spread: number;
    color: string; // Computed color (from auto or custom)
    opacity: number; // 0-100
    blendMode: 'screen' | 'add' | 'soft-light' | 'color-dodge' | 'lighter';
  };
}

export type ShapeType = 
  | 'rectangle' 
  | 'rounded-rectangle'
  | 'square' 
  | 'rounded-square'
  | 'circle' 
  | 'ellipse' 
  | 'triangle'
  | 'right-triangle'
  | 'trapezoid'
  | 'pentagon'
  | 'hexagon'
  | 'rhombus'
  | 'parallelogram'
  | 'kite'
  | 'semicircle'
  | 'heart'
  | 'arrow'
  | 'cross'
  | 'line' 
  | 'line-vector'
  | 'polygon' 
  | 'star' 
  | 'chunk' 
  | 'blob'
  | 'ring'
  | 'cubic'
  | 'bezier'
  | 'smooth-spline'
  | 'spline-circle'
  | 'spline-ellipse'
  | 'spline-ring';

export interface BaseShape {
  id: string;
  type: ShapeType;
  transform: Transform;
  properties: ShapeProperties;
  selected: boolean;
  points?: Point[];
  sides?: number;
  radius?: number;
  innerRadius?: number;
  width?: number;
  height?: number;
  controlPoints?: Point[];
  tangentHandles?: { in: Point; out: Point }[]; // Bezier tangent handles for each point
  smoothPoints?: boolean[]; // Track which points are smooth (continuous tangents) vs sharp
  closed?: boolean;
  segments?: number; // Number of segments for smooth curves
  renderType?: 'polygon' | 'bezier' | 'cubic' | 'smooth' | 'roundRect'; // How to render the shape
}

export interface ShapeGroup {
  id: string;
  shapes: BaseShape[];
  transform: Transform;
  selected: boolean;
}

export type DistributionPattern = 
  | 'random' 
  | 'grid' 
  | 'circle' 
  | 'spiral' 
  | 'organic' 
  | 'physics' 
  | 'wave' 
  | 'cluster';

export interface DistributionSettings {
  pattern: DistributionPattern;
  spacing: number;
  randomness: number;
  rotation: number;
  scale: number;
  density: number;
  avoidOverlap: boolean;
  respectBounds: boolean;
}

// Mode configuration types for line-vector properties
export type ModeKind = 'incremental' | 'range' | 'fixed';

export interface IncrementalMode<T> { 
  kind: 'incremental'; 
  startValue: T; 
  increment: T;
}

export interface RangeMode<T> { 
  kind: 'range'; 
  min: T; 
  max: T; 
  step?: T; 
  distribution?: 'uniform' | 'normal';
}

export interface FixedMode<T> { 
  kind: 'fixed'; 
  value: T;
}

export type ScalarMode<T> = IncrementalMode<T> | RangeMode<T> | FixedMode<T>;

export interface ShapeSpecificSettings {
  polygon: {
    edgeCountRange: [number, number];
  };
  circle: {
    segmentCountRange: [number, number];
  };
  ellipse: {
    segmentCountRange: [number, number];
  };
  bezier: {
    pointCountRange: [number, number];
    openProbability: number;
    strokeCapProbabilities: { round: number; square: number; butt: number };
    curvatureRange?: [number, number];
    spreadRange?: [number, number];
    patternType?: number;
    waveHeight?: number;
    waveFrequency?: number;
    wavePhase?: number;
    spiralTurns?: number;
    spiralTightness?: number;
    arcSweep?: number;
    organicJitter?: number;
    debugOverlay?: boolean;
    jitterAlongNormal?: boolean;
    jitterDirection?: 'both' | 'outward' | 'inward';
    pointCountBoundMin?: number;
    pointCountBoundMax?: number;
    endpointContinuous?: boolean;
    closeAverageProbability?: number;
    curveTension?: number;
    curveTensionMode?: 'range' | 'fixed';
    curveTensionValue?: number;
    curveTensionRange?: [number, number];
    curveLengthRange?: [number, number];
    curveLengthMode?: 'range' | 'fixed' | 'incremental';
    curveLengthValue?: number;
    curveLengthStartValue?: number;
    curveLengthIncrement?: number;
  };

  cubic: {
    pointCountRange: [number, number];
    curvatureRange: [number, number];
    spreadRange?: [number, number];
    patternType: number;
    openProbability: number;
    waveHeight?: number;
    waveFrequency?: number;
    wavePhase?: number;
    spiralTurns?: number;
    spiralTightness?: number;
    arcSweep?: number;
    organicJitter?: number;
    pointCountBoundMin?: number;
    pointCountBoundMax?: number;
    debugOverlay?: boolean;
    strokeCapProbabilities?: { round: number; square: number; butt: number };
    closeAverageProbability?: number; // 0-100: chance a closed curve closes by averaging ends vs straight join
    curveTension?: number;            // 0-100: legacy single handle-length percentage (30 = historical 0.3)
    curveTensionMode?: 'range' | 'fixed';
    curveTensionValue?: number;       // 0-100: fixed handle-length percentage
    curveTensionRange?: [number, number]; // 0-100: min/max handle-length percentage for range mode
    endpointContinuous?: boolean;     // open-curve endpoints flow continuously instead of curling toward neighbour
    jitterAlongNormal?: boolean;      // displace point-jitter along each point's curve normal (away from curve) instead of the pattern's native axis
    jitterDirection?: 'both' | 'outward' | 'inward'; // jitter sign: both = random ± (current); outward = away from curve; inward = toward curve
    curveLengthRange?: [number, number];
    curveLengthMode?: 'range' | 'fixed' | 'incremental';
    curveLengthValue?: number;
    curveLengthStartValue?: number;
    curveLengthIncrement?: number;
  };

  'smooth-spline': {
    pointCountRange: [number, number];
    openProbability: number;
    strokeCapProbabilities: { round: number; square: number; butt: number };
    curvatureRange?: [number, number];
    spreadRange?: [number, number];
    patternType?: number;
    waveHeight?: number;
    waveFrequency?: number;
    wavePhase?: number;
    spiralTurns?: number;
    spiralTightness?: number;
    arcSweep?: number;
    organicJitter?: number;
    debugOverlay?: boolean;
    jitterAlongNormal?: boolean;
    jitterDirection?: 'both' | 'outward' | 'inward';
    pointCountBoundMin?: number;
    pointCountBoundMax?: number;
    endpointContinuous?: boolean;
    closeAverageProbability?: number;
    curveTension?: number;
    curveTensionMode?: 'range' | 'fixed';
    curveTensionValue?: number;
    curveTensionRange?: [number, number];
    curveLengthRange?: [number, number];
    curveLengthMode?: 'range' | 'fixed' | 'incremental';
    curveLengthValue?: number;
    curveLengthStartValue?: number;
    curveLengthIncrement?: number;
  };
  star: {
    pointCountRange: [number, number];
    innerRadiusRange: [number, number];
  };
  ring: {
    innerRadiusRange: [number, number];
  };
  'spline-ring': {
    innerRadiusRange: [number, number];
    segmentCountRange: [number, number];
  };
  line: {
    pointCountRange: [number, number];
    strokeCapProbabilities: { round: number; square: number; butt: number };
  };
  'line-vector': {
    direction: ScalarMode<number>;
    length: ScalarMode<number>;
    centroid: ScalarMode<number>;
    strokeCapProbabilities: { round: number; square: number; butt: number };
  };
  rectangle: {
    // Standard rectangle with no rounded corners
  };
  'rounded-rectangle': {
    cornerRadiusRange: [number, number];
    cornerRadiusMode?: 'range' | 'fixed';
    cornerRadiusValue?: number;
  };
  square: {
    // Standard square with sharp corners - no properties
  };
  'rounded-square': {
    cornerRadiusRange: [number, number];
    cornerRadiusMode?: 'range' | 'fixed';
    cornerRadiusValue?: number;
  };
}

export interface ScatterSettings {
  onPoints: boolean;
  insideArea: boolean;
  count: number;
  minCount: number;
  maxCount: number;
  shapeCountMode: 'range' | 'fixed'; // Mode for shape count generation
  fixedShapeCount: number; // Fixed number when using fixed mode
  randomness: number;
  distribution: DistributionSettings;
  shapeSpecific: Partial<ShapeSpecificSettings>;
}

export interface CanvasSettings {
  width: number;
  height: number;
  zoom: number;
  panX: number;
  panY: number;
  backgroundColor: string;
  showGrid: boolean;
}

export interface Artboard {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;  // Always stored in pixels internally
  height: number; // Always stored in pixels internally
  // Legacy fields (maintained for backward compatibility, prefer printConfig)
  dpi?: number;   // Resolution in dots per inch (default 72)
  unitType?: 'pixels' | 'mm' | 'cm' | 'inches'; // Display unit (default 'pixels')
  backgroundColor?: string;
  gridColor?: string;
  displayGrid?: boolean;
  displayBorder?: boolean;
  displayName?: boolean;
  displayDimensions?: boolean;
  displayResolution?: boolean;
  preset?: string;
  category?: string;
  linkedDimensions?: boolean;  // Whether width/height changes maintain aspect ratio
  aspectRatio?: string;        // Current aspect ratio preset (e.g., '2:3', '3:4', '4:5', '1:1', 'custom')
  // Print configuration (new unified structure)
  printConfig?: PrintConfig;
}

export interface ArtboardPreset {
  name: string;
  width: number;
  height: number;
  category: 'social' | 'print' | 'web' | 'tv' | 'mobile' | 'custom';
  description?: string;
}

export const ARTBOARD_PRESETS: ArtboardPreset[] = [
  // Social Media
  { name: 'Instagram Post', width: 1080, height: 1080, category: 'social', description: '1:1 Square' },
  { name: 'Instagram Story', width: 1080, height: 1920, category: 'social', description: '9:16 Vertical' },
  { name: 'Facebook Post', width: 1200, height: 630, category: 'social', description: '1.91:1 Landscape' },
  { name: 'Facebook Cover', width: 1640, height: 859, category: 'social', description: 'Profile cover' },
  { name: 'Twitter Post', width: 1200, height: 675, category: 'social', description: '16:9 Landscape' },
  { name: 'Twitter Header', width: 1500, height: 500, category: 'social', description: '3:1 Header' },
  { name: 'LinkedIn Post', width: 1200, height: 627, category: 'social', description: '1.91:1 Landscape' },
  { name: 'YouTube Thumbnail', width: 1280, height: 720, category: 'social', description: '16:9 HD' },
  { name: 'TikTok Video', width: 1080, height: 1920, category: 'social', description: '9:16 Vertical' },
  
  // Print
  { name: 'US Letter', width: 2550, height: 3300, category: 'print', description: 'US Standard at 300 DPI' },
  { name: 'A4', width: 2480, height: 3508, category: 'print', description: 'International at 300 DPI' },
  { name: 'Business Card', width: 1050, height: 600, category: 'print', description: '3.5×2" at 300 DPI' },
  { name: 'Postcard', width: 1200, height: 1800, category: 'print', description: 'Standard at 300 DPI' },
  { name: 'Poster — Medium', width: 5400, height: 7200, category: 'print', description: 'Medium poster at 300 DPI' },
  { name: 'Flyer', width: 2550, height: 3300, category: 'print', description: 'Letter size at 300 DPI' },
  { name: 'Banner', width: 10800, height: 7200, category: 'print', description: 'Large banner at 300 DPI' },
  
  // Web
  { name: 'Desktop HD', width: 1920, height: 1080, category: 'web', description: '1920×1080 Full HD' },
  { name: 'Desktop 4K', width: 3840, height: 2160, category: 'web', description: '4K Ultra HD' },
  { name: 'Laptop', width: 1366, height: 768, category: 'web', description: 'Common laptop resolution' },
  { name: 'Tablet Portrait', width: 768, height: 1024, category: 'web', description: 'iPad portrait' },
  { name: 'Tablet Landscape', width: 1024, height: 768, category: 'web', description: 'iPad landscape' },
  { name: 'Web Banner', width: 728, height: 90, category: 'web', description: 'Leaderboard banner' },
  { name: 'Square Ad', width: 300, height: 300, category: 'web', description: 'Medium rectangle' },
  
  // TV & Digital Displays
  { name: 'Full HD (1080p)', width: 1920, height: 1080, category: 'tv', description: '16:9 Full HD' },
  { name: '4K UHD', width: 3840, height: 2160, category: 'tv', description: '16:9 Ultra HD' },
  { name: '8K UHD', width: 7680, height: 4320, category: 'tv', description: '16:9 8K' },
  { name: 'Cinema 4K', width: 4096, height: 2160, category: 'tv', description: 'DCI 4K' },
  { name: 'Digital Signage', width: 1920, height: 1080, category: 'tv', description: 'Standard display' },
  
  // Mobile
  { name: 'iPhone 14 Pro', width: 1179, height: 2556, category: 'mobile', description: 'iPhone 14 Pro screen' },
  { name: 'iPhone SE', width: 750, height: 1334, category: 'mobile', description: 'iPhone SE screen' },
  { name: 'Android Phone', width: 1080, height: 1920, category: 'mobile', description: 'Common Android resolution' },
  { name: 'Mobile Banner', width: 320, height: 50, category: 'mobile', description: 'Mobile web banner' },
];

interface MarginConfig {
  enabled: boolean;
  mode: 'absolute' | 'relative';
  unit: 'px' | '%';
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function resolveMarginPx(value: number, unit: 'px' | '%', dim: number): number {
  return unit === '%' ? (value / 100) * dim : value;
}

// Grid positioning utilities
export function calculateGridPosition(
  index: number, 
  rows: number, 
  columns: number, 
  rowOffset: number, 
  columnOffset: number,
  centerX = 0,
  centerY = 0,
  artboardBounds?: { x: number; y: number; width: number; height: number },
  gridStartX = 0,
  gridStartY = 0,
  _margin?: MarginConfig,
  gridOffsets?: GridOffsetsConfig
): GridPosition {
  const totalPositions = rows * columns;
  const adjustedIndex = index % totalPositions;
  
  const row = Math.floor(adjustedIndex / columns);
  const column = adjustedIndex % columns;
  
  const startX = centerX - ((columns - 1) * columnOffset) / 2 + gridStartX;
  const startY = centerY - ((rows - 1) * rowOffset) / 2 + gridStartY;
  
  let x = startX + (column * columnOffset);
  let y = startY + (row * rowOffset);
  
  const { offsetX, offsetY } = calculateGridOffsets(row, column, gridOffsets);
  x += offsetX;
  y += offsetY;
  
  return { x, y, row, column };
}

/**
 * Determines if a grid position should be masked (excluded from shape rendering)
 * Uses shared utility for consistent client/server behavior
 * @param row - Row index (0-indexed)
 * @param column - Column index (0-indexed)
 * @param shapeMasking - Shape masking configuration
 * @returns true if the position should be masked (no shape rendered), false if shape should render
 */
export function isPositionMasked(
  row: number,
  column: number,
  shapeMasking?: ShapeMaskingConfig
): boolean {
  return isGridPositionMasked(row, column, shapeMasking);
}

/**
 * Detects which shape-specific sort options are available based on enabled shape types
 * @param enabledShapeTypes - Array of enabled shape type strings
 * @returns Object indicating which sort criteria are available
 */
export function getAvailableShapeSpecificSortOptions(enabledShapeTypes: string[]): {
  cornerRadius: boolean;
  pointCount: boolean;
  edgeCount: boolean;
  innerRadius: boolean;
  segmentCount: boolean;
  direction: boolean;
  length: boolean;
  centroid: boolean;
  spread: boolean;
  curvature: boolean;
} {
  const hasRoundedShapes = enabledShapeTypes.some(type => 
    type === 'rounded-rectangle' || type === 'rounded-square'
  );
  
  const hasPointCountShapes = enabledShapeTypes.some(type => 
    type === 'star' || type === 'line' || 
    type === 'bezier' || type === 'cubic' || type === 'smooth-spline'
  );
  
  const hasEdgeCountShapes = enabledShapeTypes.some(type => 
    type === 'polygon'
  );
  
  const hasInnerRadiusShapes = enabledShapeTypes.some(type => 
    type === 'ring' || type === 'star' || type === 'spline-ring'
  );
  
  const hasSegmentCountShapes = enabledShapeTypes.some(type => 
    type === 'circle' || type === 'ellipse' || type === 'spline-ring'
  );
  
  const hasLineVectorShapes = enabledShapeTypes.some(type => 
    type === 'line-vector'
  );
  
  const hasCubicShapes = enabledShapeTypes.some(type => 
    type === 'cubic'
  );
  
  return {
    cornerRadius: hasRoundedShapes,
    pointCount: hasPointCountShapes,
    edgeCount: hasEdgeCountShapes,
    innerRadius: hasInnerRadiusShapes,
    segmentCount: hasSegmentCountShapes,
    direction: hasLineVectorShapes,
    length: hasLineVectorShapes,
    centroid: hasLineVectorShapes,
    spread: hasCubicShapes,
    curvature: hasCubicShapes
  };
}

export function sortShapesForGrid(
  shapes: any[], 
  sortBy: string, 
  sortOrder: 'ascending' | 'descending' = 'ascending',
  groupByShapeType: boolean = false,
  reverseGroups: boolean = false
): any[] {
  if (sortBy === 'none') return shapes;
  
  // If grouping is enabled, group shapes by type first
  if (groupByShapeType) {
    // Group shapes by their type
    const groupedByType: Record<string, any[]> = {};
    shapes.forEach(shape => {
      const type = shape.type || 'unknown';
      if (!groupedByType[type]) {
        groupedByType[type] = [];
      }
      groupedByType[type].push(shape);
    });
    
    // Sort shapes within each group first
    let sortedGroups = Object.entries(groupedByType).map(([type, groupShapes]) => {
      const sorted = sortShapesWithinGroup(groupShapes, sortBy, sortOrder);
      return {
        type,
        shapes: sorted,
        // Use first shape from sorted array as representative
        // For ascending, first is smallest; for descending, first is largest
        representative: sorted[0]
      };
    });
    
    // Sort the groups themselves using the same criteria
    sortedGroups = sortedGroups.sort((groupA, groupB) => {
      // Special case: for shape-type sorting, sort groups by type name
      if (sortBy === 'shape-type') {
        const comparison = groupA.type.localeCompare(groupB.type);
        return sortOrder === 'ascending' ? comparison : -comparison;
      }
      
      // For other criteria, compare representative shapes from each group
      const comparison = getComparisonValue(groupA.representative, groupB.representative, sortBy, sortOrder);
      
      // Add tie-breaker using type name for stable sorting
      if (comparison === 0) {
        return groupA.type.localeCompare(groupB.type);
      }
      
      return comparison;
    });
    
    // Optionally reverse the order of groups
    if (reverseGroups) {
      sortedGroups.reverse();
    }
    
    // Flatten the sorted groups back into a single array
    return sortedGroups.flatMap(group => group.shapes);
  }
  
  // Standard sorting without grouping
  return sortShapesWithinGroup(shapes, sortBy, sortOrder);
}

function getComparisonValue(a: any, b: any, sortBy: string, sortOrder: 'ascending' | 'descending'): number {
  let comparison = 0;
    
    switch (sortBy) {
      case 'layer':
        comparison = (a.properties?.zIndex || a.layerIndex || 0) - (b.properties?.zIndex || b.layerIndex || 0);
        break;
      case 'creation-time':
        // Extract timestamp from shape ID if available, fallback to creation order
        const aTime = extractTimestamp(a.id) || a.creationIndex || 0;
        const bTime = extractTimestamp(b.id) || b.creationIndex || 0;
        comparison = aTime - bTime;
        break;
      case 'shape-type':
        comparison = a.type.localeCompare(b.type);
        break;
      case 'size':
        const aSize = calculateShapeArea(a);
        const bSize = calculateShapeArea(b);
        comparison = aSize - bSize;
        break;
      case 'fill-color':
        const aHue = extractHueFromColor(a.properties?.fillColor || a.fillColor || '#000000');
        const bHue = extractHueFromColor(b.properties?.fillColor || b.fillColor || '#000000');
        comparison = aHue - bHue;
        break;
      case 'opacity':
        const aOpacity = a.properties?.fillOpacity || a.properties?.opacity || a.opacity || 1;
        const bOpacity = b.properties?.fillOpacity || b.properties?.opacity || b.opacity || 1;
        comparison = aOpacity - bOpacity;
        break;
      case 'angle':
        comparison = (a.transform?.rotation || a.rotation || 0) - (b.transform?.rotation || b.rotation || 0);
        break;
      case 'id':
        comparison = a.id.localeCompare(b.id);
        break;
      
      // Shape-specific sort criteria
      case 'corner-radius':
        const aCornerRadius = a.cornerRadius || 0;
        const bCornerRadius = b.cornerRadius || 0;
        comparison = aCornerRadius - bCornerRadius;
        break;
      case 'point-count':
        const aPointCount = a.sides || a.points?.length || 0;
        const bPointCount = b.sides || b.points?.length || 0;
        comparison = aPointCount - bPointCount;
        break;
      case 'edge-count':
        const aEdgeCount = a.sides || 0;
        const bEdgeCount = b.sides || 0;
        comparison = aEdgeCount - bEdgeCount;
        break;
      case 'inner-radius':
        const aInnerRadius = a.innerRadius || 0;
        const bInnerRadius = b.innerRadius || 0;
        comparison = aInnerRadius - bInnerRadius;
        break;
      case 'segment-count':
        const aSegmentCount = a.segments || 0;
        const bSegmentCount = b.segments || 0;
        comparison = aSegmentCount - bSegmentCount;
        break;
      case 'direction':
        const aDirection = a.direction || 0;
        const bDirection = b.direction || 0;
        comparison = aDirection - bDirection;
        break;
      case 'length':
        const aLength = a.length || 0;
        const bLength = b.length || 0;
        comparison = aLength - bLength;
        break;
      case 'centroid':
        const aCentroid = a.centroid || 0;
        const bCentroid = b.centroid || 0;
        comparison = aCentroid - bCentroid;
        break;
      case 'spread':
        const aSpread = a.spread || 0;
        const bSpread = b.spread || 0;
        comparison = aSpread - bSpread;
        break;
      case 'curvature':
        const aCurvature = a.curvature || 0;
        const bCurvature = b.curvature || 0;
        comparison = aCurvature - bCurvature;
        break;
      
      default:
        comparison = 0;
    }
    
    return sortOrder === 'ascending' ? comparison : -comparison;
}

function sortShapesWithinGroup(shapes: any[], sortBy: string, sortOrder: 'ascending' | 'descending'): any[] {
  return [...shapes].sort((a, b) => getComparisonValue(a, b, sortBy, sortOrder));
}

function extractTimestamp(id: string): number | null {
  // Extract timestamp from shape ID format: shape_timestamp_random
  const match = id.match(/shape_(\d+)_/);
  return match ? parseInt(match[1]) : null;
}

function calculateShapeArea(shape: any): number {
  if (!shape.points || shape.points.length === 0) return 0;
  
  // Simple area calculation using bounding box
  const minX = Math.min(...shape.points.map((p: any) => p.x));
  const maxX = Math.max(...shape.points.map((p: any) => p.x));
  const minY = Math.min(...shape.points.map((p: any) => p.y));
  const maxY = Math.max(...shape.points.map((p: any) => p.y));
  
  const width = maxX - minX;
  const height = maxY - minY;
  
  // Apply transform scaling
  const scaleX = shape.transform?.scaleX || 1;
  const scaleY = shape.transform?.scaleY || 1;
  
  return width * height * Math.abs(scaleX) * Math.abs(scaleY);
}

function extractHueFromColor(color: string): number {
  // Extract hue from HSL color string
  const hslMatch = color.match(/hsl\((\d+(?:\.\d+)?),/);
  if (hslMatch) {
    return parseFloat(hslMatch[1]);
  }
  
  // For hex colors, convert to HSL and extract hue
  if (color.startsWith('#')) {
    return hexToHue(color);
  }
  
  return 0;
}

function hexToHue(hex: string): number {
  // Convert hex to RGB
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;
  
  if (diff === 0) return 0;
  
  let hue = 0;
  if (max === r) {
    hue = ((g - b) / diff) % 6;
  } else if (max === g) {
    hue = (b - r) / diff + 2;
  } else {
    hue = (r - g) / diff + 4;
  }
  
  return (hue * 60 + 360) % 360;
}

// Import shared grid distribution result type
import type { GridDistributionResult } from '../../../shared/distributionTypes';

// ─── Cell alignment helpers ───────────────────────────────────────────────────

function _resolveAnchorValue(
  mode: string,
  fixed: CellAnchor,
  options: CellAnchor[],
  sequence: CellAnchor[],
  shapeIndex: number,
): CellAnchor {
  switch (mode) {
    case 'range': {
      const pool = options.length ? options : [fixed];
      return pool[Math.floor(Math.random() * pool.length)];
    }
    case 'incremental': {
      const pool = options.length ? options : [fixed];
      return pool[shapeIndex % pool.length];
    }
    case 'sequence': {
      const seq = sequence.length ? sequence : [fixed];
      return seq[shapeIndex % seq.length];
    }
    default:
      return fixed;
  }
}

function _resolveCellAlignmentUV(
  mode: string,
  fixed: CellAnchor,
  options: CellAnchor[],
  sequence: CellAnchor[],
  customUV: boolean,
  customUVX: number,
  customUVY: number,
  shapeIndex: number,
): { uvX: number; uvY: number } {
  if (customUV && mode === 'fixed') return { uvX: customUVX, uvY: customUVY };
  const anchor = _resolveAnchorValue(mode, fixed, options, sequence, shapeIndex);
  return CELL_ANCHOR_UV[anchor] ?? CELL_ANCHOR_UV['center'];
}

export function applyGridDistribution(
  shapes: any[], 
  config: DistributionConfig,
  canvasCenter = { x: 0, y: 0 },
  generationInfo?: { currentGeneration?: number, totalGenerations?: number, shapesPerGeneration?: number },
  artboardBounds?: { x: number; y: number; width: number; height: number }
): GridDistributionResult[] {
  // Early return: wrap shapes in result structure with default grid context
  if (!config.enabled || config.pattern !== 'grid') {
    return shapes.map((shape, index) => ({
      shape,
      rowIndex: 0,
      colIndex: index,
      generationIndex: index
    }));
  }
  
  let sortedShapes: any[];
  
  if (config.gridSortScope === 'per-generation' && generationInfo) {
    // Sort within each generation separately
    const { shapesPerGeneration = shapes.length, totalGenerations = 1 } = generationInfo;
    sortedShapes = [];
    
    for (let gen = 0; gen < totalGenerations; gen++) {
      const startIndex = gen * shapesPerGeneration;
      const endIndex = Math.min(startIndex + shapesPerGeneration, shapes.length);
      const generationShapes = shapes.slice(startIndex, endIndex);
      
      const sortedGeneration = sortShapesForGrid(
        generationShapes, 
        config.gridSortBy, 
        config.gridSortOrder,
        config.gridGroupByShapeType || false,
        config.gridReverseGroups || false
      );
      
      sortedShapes.push(...sortedGeneration);
    }
  } else {
    // Sort across entire batch
    sortedShapes = sortShapesForGrid(
      shapes, 
      config.gridSortBy, 
      config.gridSortOrder,
      config.gridGroupByShapeType || false,
      config.gridReverseGroups || false
    );
  }
  
  // Calculate cell dimensions for cell-based rendering
  const cellConstraints = config.cellConstraints || DEFAULT_CELL_CONSTRAINTS;
  const isCellCenterMode = cellConstraints.renderMode === 'cell-center';
  const isCellCornersMode = cellConstraints.renderMode === 'cell-corners';
  const hasFitConstraints = cellConstraints.enabled && (isCellCenterMode || isCellCornersMode);
  
  // Position count depends on mode:
  // - Cell center mode: rows × cols cells (gridRows × gridColumns = cell count)
  // - Cell corners mode: (rows+1) × (cols+1) intersection points
  // - No cell mode: rows × cols positions
  const effectiveRows = isCellCornersMode ? config.gridRows + 1 : config.gridRows;
  const effectiveCols = isCellCornersMode ? config.gridColumns + 1 : config.gridColumns;
  
  // Build list of valid (non-masked) grid positions
  const validPositions: Array<{ rowIndex: number; colIndex: number; linearIndex: number }> = [];
  for (const { rowIndex, colIndex, linearIndex } of getGridTraversalPositions(effectiveRows, effectiveCols, config)) {
    // Check if this position is masked
    if (!isPositionMasked(rowIndex, colIndex, config.shapeMasking)) {
      validPositions.push({ rowIndex, colIndex, linearIndex });
    }
  }
  
  // Use ALL generated shapes — excess shapes cycle back through valid positions.
  // The count slider controls how many shapes are generated; the grid controls
  // where they are placed.  Masked positions are simply never visited (validPositions
  // already excludes them), so masking still works correctly with cycling.
  // To get exactly one shape per grid position use the Fill Grid toggle, which
  // forces the count to rows × cols before generation reaches this point.
  const shapesToPlace = sortedShapes;
  
  // Effective artboard bounds after applying margins
  let effectiveBounds = artboardBounds;
  if (artboardBounds && config.gridMarginEnabled) {
    const mUnit = config.gridMarginUnit ?? 'px';
    const mT = mUnit === '%' ? (config.gridMarginTop    ?? 0) / 100 * artboardBounds.height : (config.gridMarginTop    ?? 0);
    const mR = mUnit === '%' ? (config.gridMarginRight  ?? 0) / 100 * artboardBounds.width  : (config.gridMarginRight  ?? 0);
    const mB = mUnit === '%' ? (config.gridMarginBottom ?? 0) / 100 * artboardBounds.height : (config.gridMarginBottom ?? 0);
    const mL = mUnit === '%' ? (config.gridMarginLeft   ?? 0) / 100 * artboardBounds.width  : (config.gridMarginLeft   ?? 0);
    effectiveBounds = { x: artboardBounds.x + mL, y: artboardBounds.y + mT, width: Math.max(1, artboardBounds.width - mL - mR), height: Math.max(1, artboardBounds.height - mT - mB) };
  }
  // Gutter amounts (space inserted between cells)
  const gutterX = (config.gridGutterEnabled && config.gridGutterX) ? config.gridGutterX : 0;
  const gutterY = (config.gridGutterEnabled && config.gridGutterY) ? config.gridGutterY : 0;
  // Cell dimensions: effective artboard divided by cell count, minus total gutter space
  const cellWidth  = effectiveBounds ? (effectiveBounds.width  - gutterX * (config.gridColumns - 1)) / config.gridColumns : config.gridColumnOffset;
  const cellHeight = effectiveBounds ? (effectiveBounds.height - gutterY * (config.gridRows    - 1)) / config.gridRows    : config.gridRowOffset;
  
  // Map shapes to grid positions, cycling when count exceeds number of valid positions
  return shapesToPlace.map((shape, index) => {
    const positionEntry = validPositions.length > 0
      ? validPositions[index % validPositions.length]
      : { rowIndex: 0, colIndex: 0, linearIndex: 0 };
    const { rowIndex, colIndex } = positionEntry;
    
    let cellOffsetX = 0;
    let cellOffsetY = 0;

    // Compute position directly from the new cell model (edge-to-edge)
    let gridPosX: number;
    let gridPosY: number;
    if (effectiveBounds && isCellCenterMode) {
      gridPosX = effectiveBounds.x + colIndex * (cellWidth + gutterX) + cellWidth / 2;
      gridPosY = effectiveBounds.y + rowIndex * (cellHeight + gutterY) + cellHeight / 2;
      const { offsetX, offsetY } = calculateGridOffsets(rowIndex, colIndex, config.gridOffsets);
      gridPosX += offsetX;
      gridPosY += offsetY;
    } else if (effectiveBounds && isCellCornersMode) {
      gridPosX = effectiveBounds.x + colIndex * (cellWidth + gutterX);
      gridPosY = effectiveBounds.y + rowIndex * (cellHeight + gutterY);
      const { offsetX, offsetY } = calculateGridOffsets(rowIndex, colIndex, config.gridOffsets);
      gridPosX += offsetX;
      gridPosY += offsetY;
    } else {
      const linearIndex = rowIndex * effectiveCols + colIndex;
      const gridPos = calculateGridPosition(
        linearIndex,
        config.gridRows,
        config.gridColumns,
        config.gridRowOffset,
        config.gridColumnOffset,
        canvasCenter.x,
        canvasCenter.y,
        artboardBounds,
        config.gridStartX || 0,
        config.gridStartY || 0,
        undefined,
        config.gridOffsets
      );
      gridPosX = gridPos.x;
      gridPosY = gridPos.y;
    }

    // Resolve per-side padding to pixels (used for both cell-offset and fit scaling)
    const paddingUnit = cellConstraints.paddingUnit ?? 'px';
    const pL = paddingUnit === '%' ? ((cellConstraints.paddingLeft   ?? 0) / 100) * cellWidth  : (cellConstraints.paddingLeft   ?? 0);
    const pR = paddingUnit === '%' ? ((cellConstraints.paddingRight  ?? 0) / 100) * cellWidth  : (cellConstraints.paddingRight  ?? 0);
    const pT = paddingUnit === '%' ? ((cellConstraints.paddingTop    ?? 0) / 100) * cellHeight : (cellConstraints.paddingTop    ?? 0);
    const pB = paddingUnit === '%' ? ((cellConstraints.paddingBottom ?? 0) / 100) * cellHeight : (cellConstraints.paddingBottom ?? 0);

    // Cell center mode: gridPos is already the cell center, base cellOffset is 0.
    // Cell corners mode: gridPos is the intersection point, base cellOffset stays 0.
    // Padding and alignment apply additively in the alignment block below.

    // ─── Shape dimensions (shared by fit scaling + alignment) ─────────────────
    // shapeWidth/Height = effective visual size (local dim × existing transform scale).
    // shapeBoundsX/Y   = top-left of the bounding box scaled by the same factor, so
    //                    (shapeBoundsX + shapeWidth * uvX) * fitScaleX correctly yields
    //                    the world-relative-to-transform anchor position for alignment.
    // Using effective size in the divisor means fitScaleX = cell / effectiveSize, and
    // the final transform becomes existingScale × fitScaleX = cell / localDim — which
    // is always the correct renderer scale to make ctx.scale(scaleX)*localDim = cell.
    let shapeWidth = 50;
    let shapeHeight = 50;
    let shapeBoundsX = -25;
    let shapeBoundsY = -25;
    if (hasFitConstraints || cellConstraints.cellAlignmentEnabled) {
      const exScaleX = Math.abs(shape.transform?.scaleX || 1);
      const exScaleY = Math.abs(shape.transform?.scaleY || 1);
      if (shape.radius !== undefined && shape.radius > 0) {
        shapeWidth  = shape.radius * 2 * exScaleX;
        shapeHeight = shape.radius * 2 * exScaleY;
        shapeBoundsX = -shapeWidth  / 2;
        shapeBoundsY = -shapeHeight / 2;
      } else if (typeof shape.getBounds === 'function') {
        // Use the accurate bounds (includes Bézier tangent-handle extrema for curves)
        const b = shape.getBounds();
        shapeWidth  = Math.max(10, b.width)  * exScaleX;
        shapeHeight = Math.max(10, b.height) * exScaleY;
        shapeBoundsX = b.x * exScaleX;
        shapeBoundsY = b.y * exScaleY;
      } else if (shape.width !== undefined && shape.height !== undefined) {
        shapeWidth  = shape.width  * exScaleX;
        shapeHeight = shape.height * exScaleY;
        shapeBoundsX = -shapeWidth  / 2;
        shapeBoundsY = -shapeHeight / 2;
      } else if (shape.points && shape.points.length > 0) {
        const xs = shape.points.map((p: any) => p.x);
        const ys = shape.points.map((p: any) => p.y);
        shapeWidth  = Math.max(10, Math.max(...xs) - Math.min(...xs)) * exScaleX;
        shapeHeight = Math.max(10, Math.max(...ys) - Math.min(...ys)) * exScaleY;
        shapeBoundsX = Math.min(...xs) * exScaleX;
        shapeBoundsY = Math.min(...ys) * exScaleY;
      }
    }

    // Track fit scale applied (used by alignment to compute scaled shape dims)
    let fitScaleX = 1;
    let fitScaleY = 1;

    // ─── Fit mode scaling ─────────────────────────────────────────────────────
    if (hasFitConstraints && cellConstraints.fitMode !== 'none') {
      const availableWidth  = Math.max(1, cellWidth  - pL - pR);
      const availableHeight = Math.max(1, cellHeight - pT - pB);

      switch (cellConstraints.fitMode) {
        case 'contain': {
          const raw = Math.min(availableWidth / shapeWidth, availableHeight / shapeHeight);
          fitScaleX = fitScaleY = raw;
          break;
        }
        case 'cover': {
          fitScaleX = fitScaleY = Math.max(availableWidth / shapeWidth, availableHeight / shapeHeight);
          break;
        }
        case 'fill':
          fitScaleX = availableWidth  / shapeWidth;
          fitScaleY = availableHeight / shapeHeight;
          break;
      }

      shape.transform.scaleX = (shape.transform.scaleX || 1) * fitScaleX;
      shape.transform.scaleY = (shape.transform.scaleY || 1) * fitScaleY;

      const modeLabel = isCellCenterMode ? 'CELL-CENTER' : 'CELL-CORNERS';
      console.log(`🔲 [${modeLabel} MODE] Shape ${index}: fitMode=${cellConstraints.fitMode}, scale=${fitScaleX.toFixed(2)}x${fitScaleY.toFixed(2)}, cellSize=${cellWidth.toFixed(0)}x${cellHeight.toFixed(0)}, shapeSize=${shapeWidth}x${shapeHeight}`);
    }

    // Scaled shape dimensions (after fit scaling, or raw if fit is disabled)
    const scaledShapeWidth  = shapeWidth  * fitScaleX;
    const scaledShapeHeight = shapeHeight * fitScaleY;

    // ─── Cell Alignment ───────────────────────────────────────────────────────
    // Places a specific point on the shape at a specific point in the cell.
    // Only active in Cell or Cell-Point mode and when explicitly enabled.
    if (cellConstraints.cellAlignmentEnabled && (isCellCenterMode || isCellCornersMode)) {
      const shapeUV = _resolveCellAlignmentUV(
        cellConstraints.shapeAnchorMode   ?? 'fixed',
        cellConstraints.shapeAnchorFixed  ?? 'center',
        cellConstraints.shapeAnchorOptions  ?? [],
        cellConstraints.shapeAnchorSequence ?? [],
        cellConstraints.shapeAnchorCustomUV    ?? false,
        cellConstraints.shapeAnchorCustomUVX   ?? 0.5,
        cellConstraints.shapeAnchorCustomUVY   ?? 0.5,
        index,
      );
      const cellUV = _resolveCellAlignmentUV(
        cellConstraints.cellAnchorMode   ?? 'fixed',
        cellConstraints.cellAnchorFixed  ?? 'center',
        cellConstraints.cellAnchorOptions  ?? [],
        cellConstraints.cellAnchorSequence ?? [],
        false, 0.5, 0.5,
        index,
      );

      // Local-space position of the chosen shape anchor point (after fit scaling).
      // Using bounds.x + bounds.width * uvX is correct even when the bounding box
      // is not centered on the local origin (e.g. Bézier curves with asymmetric
      // tangent-handle bulge).
      const shapeAnchorLocalX = (shapeBoundsX + shapeWidth  * shapeUV.uvX) * fitScaleX;
      const shapeAnchorLocalY = (shapeBoundsY + shapeHeight * shapeUV.uvY) * fitScaleY;

      if (isCellCenterMode) {
        // gridPos is cell center; top-left is at (gridPos - cellWidth/2, gridPos - cellHeight/2).
        const alignAvailW = Math.max(1, cellWidth  - pL - pR);
        const alignAvailH = Math.max(1, cellHeight - pT - pB);
        cellOffsetX = -cellWidth / 2 + pL + cellUV.uvX * alignAvailW - shapeAnchorLocalX;
        cellOffsetY = -cellHeight / 2 + pT + cellUV.uvY * alignAvailH - shapeAnchorLocalY;
      } else {
        // Cell corners: cell is centered at the intersection point (gridPos).
        cellOffsetX = (cellUV.uvX - 0.5) * cellWidth  - shapeAnchorLocalX;
        cellOffsetY = (cellUV.uvY - 0.5) * cellHeight - shapeAnchorLocalY;
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Always apply position offsets additively to grid layout
    const positionOffsetX = shape.transform?.x || 0;
    const positionOffsetY = shape.transform?.y || 0;

    const randomX = (Math.random() - 0.5) * 2 * config.gridXRandomization;
    const randomY = (Math.random() - 0.5) * 2 * config.gridYRandomization;

    shape.transform.x = gridPosX + positionOffsetX + randomX + cellOffsetX;
    shape.transform.y = gridPosY + positionOffsetY + randomY + cellOffsetY;

    return { shape, rowIndex, colIndex, generationIndex: index };
  });
}


// Apply wave distribution: shapes positioned along a wave pattern (sine, triangle, square, sawtooth)
export function applyWaveDistribution(
  shapes: any[],
  config: DistributionConfig,
  canvasCenter = { x: 0, y: 0 },
  artboardBounds?: { x: number; y: number; width: number; height: number }
): any[] {
  if (!config.enabled || config.pattern !== 'wave') return shapes;
  
  const waveType = config.waveType || 'sine';
  const amplitude = config.waveAmplitude || 50;
  const frequency = config.waveFrequency || 2;
  const direction = config.waveDirection || 'horizontal';
  const phaseOffset = (config.wavePhaseOffset || 0) * (Math.PI / 180); // Convert to radians
  
  // Calculate artboard center
  const artboardCenterX = artboardBounds 
    ? artboardBounds.x + artboardBounds.width / 2 
    : canvasCenter.x;
  const artboardCenterY = artboardBounds 
    ? artboardBounds.y + artboardBounds.height / 2 
    : canvasCenter.y;
  
  // Calculate wave path length
  const pathLength = direction === 'horizontal' 
    ? (artboardBounds?.width || 400)
    : (artboardBounds?.height || 400);
  
  const totalShapes = shapes.length;
  const spacing = pathLength / (totalShapes + 1);
  
  return shapes.map((shape, index) => {
    const t = (index + 1) * spacing; // Position along the path
    const phase = (t / pathLength) * frequency * 2 * Math.PI + phaseOffset;
    
    // Calculate wave offset based on wave type
    let waveOffset = 0;
    switch (waveType) {
      case 'sine':
        waveOffset = Math.sin(phase) * amplitude;
        break;
      case 'triangle':
        waveOffset = (2 * amplitude / Math.PI) * Math.asin(Math.sin(phase));
        break;
      case 'square':
        waveOffset = Math.sign(Math.sin(phase)) * amplitude;
        break;
      case 'sawtooth':
        waveOffset = (2 * amplitude / Math.PI) * (phase % (2 * Math.PI) - Math.PI);
        break;
    }
    
    let x, y;
    if (direction === 'horizontal') {
      x = artboardCenterX - pathLength / 2 + t;
      y = artboardCenterY + waveOffset;
    } else {
      x = artboardCenterX + waveOffset;
      y = artboardCenterY - pathLength / 2 + t;
    }
    
    // Apply additive random offset
    const randomX = (Math.random() - 0.5) * 2 * config.gridXRandomization;
    const randomY = (Math.random() - 0.5) * 2 * config.gridYRandomization;
    
    // Always apply position offsets additively
    const positionOffsetX = shape.transform?.x || 0;
    const positionOffsetY = shape.transform?.y || 0;
    const finalX = x + randomX + positionOffsetX;
    const finalY = y + randomY + positionOffsetY;
    
    shape.transform.x = finalX;
    shape.transform.y = finalY;
    
    return shape;
  });
}

// Apply ellipse distribution: shapes positioned in concentric ellipse rings
export function applyEllipseDistribution(
  shapes: any[],
  config: DistributionConfig,
  canvasCenter = { x: 0, y: 0 },
  artboardBounds?: { x: number; y: number; width: number; height: number }
): any[] {
  if (!config.enabled || config.pattern !== 'ellipse') return shapes;
  
  const xRadiusRange = config.ellipseXRadius || [80, 120];
  const yRadiusRange = config.ellipseYRadius || [80, 120];
  const ringCount = config.ellipseRingCount || 1;
  const ringSpacing = config.ellipseRingSpacing || 'even';
  const rotation = (config.ellipseRotation || 0) * (Math.PI / 180);
  const rotationAlignment = config.ellipseRotationAlignment || 'uniform';
  const alignToRing = config.ellipseAlignToRing || false;
  const flipInward = config.ellipseFlipInward || false;
  const additionalRotation = (config.ellipseAdditionalRotation || 0) * (Math.PI / 180);
  const shapeRotationMode = config.ellipseShapeRotationMode || 'none';
  const rotationFixed = (config.ellipseRotationFixed || 0) * (Math.PI / 180);
  const rotationRange = config.ellipseRotationRange || [0, 360];
  const rotationIncrementalStart = (config.ellipseRotationIncrementalStart || 0) * (Math.PI / 180);
  const rotationIncrementalStep = (config.ellipseRotationIncrementalStep || 10) * (Math.PI / 180);
  
  // Calculate artboard center
  const artboardCenterX = artboardBounds 
    ? artboardBounds.x + artboardBounds.width / 2 
    : canvasCenter.x;
  const artboardCenterY = artboardBounds 
    ? artboardBounds.y + artboardBounds.height / 2 
    : canvasCenter.y;
  
  const totalShapes = shapes.length;
  
  // Calculate descending arithmetic sequence for smooth distribution
  // Formula: a = (N + R×(R-1)/2) / R
  // Example: 50 shapes, 4 rings -> a = (50 + 6)/4 = 14 -> [14, 13, 12, 11]
  const startingCount = Math.round((totalShapes + ringCount * (ringCount - 1) / 2) / ringCount);
  const ringAllocations: number[] = [];
  
  for (let i = 0; i < ringCount; i++) {
    ringAllocations[i] = Math.max(0, startingCount - i);
  }
  
  // Adjust for rounding errors by distributing any difference
  const currentTotal = ringAllocations.reduce((sum, count) => sum + count, 0);
  const difference = totalShapes - currentTotal;
  
  if (difference !== 0) {
    // Distribute the difference across rings to match exactly
    for (let i = 0; i < Math.abs(difference); i++) {
      const ringIndex = i % ringCount;
      ringAllocations[ringIndex] += difference > 0 ? 1 : -1;
    }
  }
  
  // Group shapes by ring using the calculated allocations
  const shapesByRing: any[][] = [];
  for (let i = 0; i < ringCount; i++) {
    shapesByRing[i] = [];
  }
  
  let shapeIndex = 0;
  for (let ringIdx = 0; ringIdx < ringCount; ringIdx++) {
    for (let i = 0; i < ringAllocations[ringIdx]; i++) {
      if (shapeIndex < totalShapes) {
        shapesByRing[ringIdx].push({ shape: shapes[shapeIndex], originalIndex: shapeIndex });
        shapeIndex++;
      }
    }
  }
  
  return shapes.map((shape, index) => {
    // Find which ring this shape belongs to
    let ringIndex = 0;
    let cumulativeCount = 0;
    for (let i = 0; i < ringCount; i++) {
      if (index < cumulativeCount + ringAllocations[i]) {
        ringIndex = i;
        break;
      }
      cumulativeCount += ringAllocations[i];
    }
    
    // Calculate index within the ring
    cumulativeCount = 0;
    for (let i = 0; i < ringIndex; i++) {
      cumulativeCount += ringAllocations[i];
    }
    const indexInRing = index - cumulativeCount;
    
    // Calculate angle step based on actual number of shapes in this ring
    const shapesInThisRing = shapesByRing[ringIndex].length;
    const angleStep = (2 * Math.PI) / shapesInThisRing;
    const angle = indexInRing * angleStep;
    
    // Calculate ring radius based on spacing mode
    let ringProgress;
    if (ringSpacing === 'progressive') {
      ringProgress = Math.pow(ringIndex / Math.max(ringCount - 1, 1), 1.5);
    } else {
      ringProgress = ringIndex / Math.max(ringCount - 1, 1);
    }
    
    // Interpolate radius based on ring
    const xRadius = xRadiusRange[0] + (xRadiusRange[1] - xRadiusRange[0]) * ringProgress;
    const yRadius = yRadiusRange[0] + (yRadiusRange[1] - yRadiusRange[0]) * ringProgress;
    
    // Calculate rotation based on alignment mode
    const shapeRotation = rotationAlignment === 'progressive' 
      ? rotation * Math.pow(ringIndex / Math.max(ringCount - 1, 1), 1.5)
      : rotation;
    
    // Calculate position on ellipse with rotation
    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);
    const cosRot = Math.cos(shapeRotation);
    const sinRot = Math.sin(shapeRotation);
    
    const x = artboardCenterX + (xRadius * cosAngle * cosRot - yRadius * sinAngle * sinRot);
    const y = artboardCenterY + (xRadius * cosAngle * sinRot + yRadius * sinAngle * cosRot);
    
    // Apply additive random offset
    const randomX = (Math.random() - 0.5) * 2 * config.gridXRandomization;
    const randomY = (Math.random() - 0.5) * 2 * config.gridYRandomization;
    
    // Always apply position offsets additively
    const positionOffsetX = shape.transform?.x || 0;
    const positionOffsetY = shape.transform?.y || 0;
    const finalX = x + randomX + positionOffsetX;
    const finalY = y + randomY + positionOffsetY;
    
    shape.transform.x = finalX;
    shape.transform.y = finalY;
    
    // Apply align-to-ring tangent rotation
    let finalRotation = 0;
    if (alignToRing) {
      // Calculate tangent angle at this point on the ellipse
      // For an ellipse, the tangent angle is perpendicular to the normal
      // The normal direction from center to point is angle, so tangent is angle + 90°
      let tangentAngle = angle + shapeRotation + Math.PI / 2;
      
      // Flip inward reverses the tangent direction
      if (flipInward) {
        tangentAngle += Math.PI;
      }
      
      // Add additional rotation offset
      finalRotation = tangentAngle + additionalRotation;
    }
    
    // Apply shape rotation mode on top of align-to-ring rotation
    if (shapeRotationMode === 'fixed') {
      finalRotation += rotationFixed;
    } else if (shapeRotationMode === 'range') {
      const minRot = rotationRange[0] * (Math.PI / 180);
      const maxRot = rotationRange[1] * (Math.PI / 180);
      finalRotation += minRot + Math.random() * (maxRot - minRot);
    } else if (shapeRotationMode === 'incremental') {
      finalRotation += rotationIncrementalStart + (index * rotationIncrementalStep);
    } else if (shapeRotationMode === 'series') {
      const items = config.ellipseShapeRotationSeriesItems ?? [];
      const selection = config.ellipseShapeRotationSeriesSelection ?? 'sequential';
      const exhaustion = config.ellipseShapeRotationSeriesExhaustion ?? 'cycle';
      const driver = config.ellipseShapeRotationSeriesDriver ?? 'shape-index';
      const setRepIdx = config._setRepIndex ?? 0;
      const seriesVal = resolveScalarSeries(items, selection, exhaustion, driver, index, setRepIdx);
      if (!isNaN(seriesVal)) finalRotation += seriesVal * (Math.PI / 180);
    }
    
    // Convert rotation back to degrees and apply to shape
    shape.transform.rotation = finalRotation * (180 / Math.PI);
    
    return shape;
  });
}

// Apply spiral distribution: shapes positioned along a spiral path
export function applySpiralDistribution(
  shapes: any[],
  config: DistributionConfig,
  canvasCenter = { x: 0, y: 0 },
  artboardBounds?: { x: number; y: number; width: number; height: number }
): any[] {
  if (!config.enabled || config.pattern !== 'spiral') return shapes;
  
  const turnCount = config.spiralTurnCount || 3;
  const spacingMode = config.spiralSpacingMode || 'linear';
  const direction = config.spiralDirection || 'clockwise';
  const startAngle = (config.spiralStartAngle || 0) * (Math.PI / 180); // Convert to radians
  const tightness = config.spiralTightness || 1.0;
  
  // Calculate artboard center
  const artboardCenterX = artboardBounds 
    ? artboardBounds.x + artboardBounds.width / 2 
    : canvasCenter.x;
  const artboardCenterY = artboardBounds 
    ? artboardBounds.y + artboardBounds.height / 2 
    : canvasCenter.y;
  
  const totalShapes = shapes.length;
  const totalAngle = turnCount * 2 * Math.PI;
  const maxRadius = Math.min(
    artboardBounds?.width || 400, 
    artboardBounds?.height || 400
  ) / 2 * 0.8; // Use 80% of available space
  
  return shapes.map((shape, index) => {
    const progress = index / Math.max(totalShapes - 1, 1);
    
    // Calculate angle based on direction
    const angle = direction === 'clockwise'
      ? startAngle + (progress * totalAngle)
      : startAngle - (progress * totalAngle);
    
    // Calculate radius based on spacing mode
    let radius;
    if (spacingMode === 'logarithmic') {
      // Logarithmic: expands outward
      radius = maxRadius * Math.pow(progress, tightness);
    } else {
      // Linear: constant spacing
      radius = maxRadius * progress * tightness;
    }
    
    // Calculate position
    const x = artboardCenterX + radius * Math.cos(angle);
    const y = artboardCenterY + radius * Math.sin(angle);
    
    // Apply additive random offset
    const randomX = (Math.random() - 0.5) * 2 * config.gridXRandomization;
    const randomY = (Math.random() - 0.5) * 2 * config.gridYRandomization;
    
    // Always apply position offsets additively
    const positionOffsetX = shape.transform?.x || 0;
    const positionOffsetY = shape.transform?.y || 0;
    const finalX = x + randomX + positionOffsetX;
    const finalY = y + randomY + positionOffsetY;
    
    shape.transform.x = finalX;
    shape.transform.y = finalY;
    
    return shape;
  });
}

// Helper function to resolve scalar mode to actual value
export const resolveScalar = (config: ScalarMode<number>, index?: number): number => {
  switch (config.kind) {
    case 'fixed':
      return config.value;
    case 'range':
      // For now, return random value in range. Can be enhanced with distribution later
      return Math.random() * (config.max - config.min) + config.min;
    case 'incremental':
      return config.startValue + (config.increment * (index || 0));
    default:
      return 0;
  }
};

// Default configurations for line-vector properties
export const getDefaultLineVectorConfig = () => ({
  direction: { kind: 'range' as const, min: 0, max: 360 },
  length: { kind: 'range' as const, min: 5, max: 500 },
  centroid: { kind: 'fixed' as const, value: 0.5 },
  strokeCapProbabilities: { round: 33, square: 33, butt: 34 }
});
