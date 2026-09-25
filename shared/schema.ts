import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().notNull(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
});

export type UpsertUser = typeof users.$inferInsert;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ===== USER PREFERENCES =====
// Sidebar section visibility preferences
export const userPreferences = pgTable("user_preferences", {
  id: varchar("id").primaryKey().notNull(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Sidebar section visibility settings
  sidebarSections: jsonb("sidebar_sections").notNull().default('{}'),
  // Generation sets persistence
  generationSets: jsonb("generation_sets").notNull().default('[]'),
  currentGenerationSetId: varchar("current_generation_set_id"),
  // Export settings persistence
  exportSettings: jsonb("export_settings").notNull().default('{}'),
  // App settings defaults (export format, artboard dimensions, etc.)
  appSettingsDefaults: jsonb("app_settings_defaults"),
  // Load project dialog preference - skip dialog if user checked "don't ask again"
  skipLoadProjectDialog: boolean("skip_load_project_dialog").notNull().default(false),
  // Overlay manager state (visibility toggles, CTP property colors/sizes, debug grid entries)
  overlayManagerState: jsonb("overlay_manager_state"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Sidebar section item configuration
export interface SidebarSectionItem {
  enabled: boolean;
  displayOrder: number;
}

// Sidebar section configuration type
export interface SidebarSectionConfig {
  shapes: SidebarSectionItem;           // Shape Types - enabled by default
  selection: SidebarSectionItem;        // Selection Modes - disabled by default  
  layers: SidebarSectionItem;           // Layers - disabled by default
  properties: SidebarSectionItem;       // Properties - disabled by default
  composition: SidebarSectionItem;      // Composition - disabled by default
  'align-distribute': SidebarSectionItem; // Align & Distribute - disabled by default
  artboards: SidebarSectionItem;        // Artboards - enabled by default
  colors: SidebarSectionItem;           // Color Manipulation - disabled by default
  project: SidebarSectionItem;          // Project Management - enabled by default
  export: SidebarSectionItem;           // Export & Save - enabled by default
  'overlay-manager': SidebarSectionItem; // Overlay Manager - enabled by default
}

// Default sidebar section configuration
export const DEFAULT_SIDEBAR_SECTIONS: SidebarSectionConfig = {
  shapes: { enabled: true, displayOrder: 1 },              // Shape Types - enabled by default
  layers: { enabled: false, displayOrder: 2 },             // Layers - disabled by default
  properties: { enabled: false, displayOrder: 3 },         // Properties - disabled by default
  artboards: { enabled: true, displayOrder: 4 },           // Artboards - enabled by default
  project: { enabled: true, displayOrder: 5 },             // Project Management - enabled by default
  export: { enabled: true, displayOrder: 6 },              // Export & Save - enabled by default
  selection: { enabled: false, displayOrder: 7 },          // Selection Modes - disabled by default
  composition: { enabled: false, displayOrder: 8 },        // Composition - disabled by default
  'align-distribute': { enabled: false, displayOrder: 9 }, // Align & Distribute - disabled by default
  colors: { enabled: false, displayOrder: 10 },            // Color Manipulation - disabled by default
  'overlay-manager': { enabled: true, displayOrder: 11 },  // Overlay Manager - enabled by default
};

// ===== OVERLAY MANAGER STATE =====
// Controls visibility of the three overlay canvas layers above the shapes layer

// Per-set debug overlay entry — stored in overlayManagerState.debugGrid.sets[setId]
// overlayManagerState is authoritative at runtime; color/opacity also persisted to
// cellConstraints as a side-effect so settings survive session reloads.
export interface DebugOverlayEntry {
  visible: boolean; // Whether this set's debug grid is shown
  color: string;    // Hex color for grid lines (e.g. '#FF4444')
  opacity: number;  // Opacity multiplier 0–1
  order: number;    // Draw order index (lower drawn first)
}

/** Per-shape-type per-property overlay state for CTP point labels. Key: `${setId}:${shapeType}:${propKey}` */
export interface CtpPropertyOverride {
  visible: boolean;
  color?: string;   // CSS hex; overrides PointPropertyConfig.labelColor when set
  size?: number;    // px before zoom; overrides PointPropertyConfig.labelFontSize when set
}

export interface OverlayManagerState {
  allVisible: boolean;            // Master toggle — hides all overlays when false

  // Layer 4: Print Marks canvas — layer-level visibility (CSS display)
  // Sub-toggles (bleed/safeZone/cropMarks) live in printConfig.overlays.*.display
  printMarksVisible: boolean;

  // Layer 5: Artboard Labels canvas — layer-level visibility (CSS display)
  // Sub-toggles (name/dims/dpi) live in artboard.displayName/displayDimensions/displayResolution
  artboardLabelsVisible: boolean;

  // Layer 6: Debug Grid — global toggle for all per-set debug grid overlays
  // Per-set state lives in generationSet.batchConfig.cellConstraints (persisted)
  debugGridVisible: boolean;
  debugGrid: {
    sets: Record<string, DebugOverlayEntry>; // Keyed by GenerationSet.id
  };
  // Layer 7: CTP Point Labels — master toggle + per-property overrides
  ctpPointLabelsVisible: boolean;
  ctpProperties: Record<string, CtpPropertyOverride>; // Key: `${setId}:${shapeType}:${propKey}`
}

export const DEFAULT_OVERLAY_MANAGER_STATE: OverlayManagerState = {
  allVisible: true,
  printMarksVisible: true,
  artboardLabelsVisible: true,
  debugGridVisible: true,
  debugGrid: { sets: {} },
  ctpPointLabelsVisible: true,
  ctpProperties: {},
};

// Export background mode type (transparent ignores artboard background, artboard uses artboard's configured color)
export type ExportBackgroundMode = 'transparent' | 'artboard';

// Render mode for exports - determines whether to use client-side or server-side rendering
export type ExportRenderMode = 'auto' | 'client' | 'server';

// Export settings configuration type
export interface ExportSettingsConfig {
  exportBatchModeEnabled: boolean;    // Whether batch export mode is enabled
  generationSetsEnabled: boolean;     // Whether generation sets toggle is enabled
  batchExportCount: number;           // Current batch export count setting
  generationCountMode: string;        // Current generation count mode ('fixed', 'range', etc)
  edgeCaseStrategy?: 'hold' | 'cycle' | 'random' | 'stop';  // Strategy when set count < batch export count
  exportSaveProjectFiles: boolean;    // Whether to export generated project files (.generated.json) alongside images
  exportSaveGeneratorFiles: boolean;  // Whether to export one generator file (.generator.json) per batch
  packageAsZip: boolean;              // Whether to package exports as ZIP file
  skipTiffPreflightModal: boolean;    // Skip pre-flight confirmation modal for TIFF batch exports
  exportBackgroundMode: ExportBackgroundMode;  // Export background: transparent or artboard color
  exportBackgroundColor?: string;     // @deprecated - legacy field, ignored (artboard background is configured in Artboard section)
  tiffBitDepth: 8 | 16;               // TIFF bit depth: 8-bit (default) or 16-bit for professional printing
  tiffCompression: 'none' | 'deflate'; // TIFF compression: 'none' for uncompressed, 'deflate' for ZIP/Deflate (requires Pako.js)
  embedIccProfile: boolean;           // Embed sRGB ICC profile in TIFF/PNG/JPEG exports (POD requirement)
  renderMode: ExportRenderMode;       // Render mode: 'auto' (smart detection), 'client' (browser), 'server' (headless)
  flattenToRgb: boolean;              // Flatten to RGB (drop alpha) for ~10-20% smaller files; auto-enabled when background is artboard
  matteColor: string;                 // Matte color for flattening transparent images to RGB (default: white)
  copyrightText: string;              // Copyright text to embed in exported images (EXIF/XMP metadata)
  // Image metadata fields for export
  artistName: string;                 // Artist/Creator name (pre-filled from logged-in user, editable)
  imageTitle: string;                 // Image title (editable with default template)
  imageDescription: string;           // Image description (editable with default template)
}

// Default export settings configuration
export const DEFAULT_EXPORT_SETTINGS: ExportSettingsConfig = {
  exportBatchModeEnabled: false,      // Batch export disabled by default
  generationSetsEnabled: false,       // Generation sets disabled by default
  batchExportCount: 10,               // 10 exports by default
  generationCountMode: 'fixed',       // Fixed count mode by default
  edgeCaseStrategy: 'cycle',          // Default edge case strategy
  exportSaveProjectFiles: false,      // Generated project files disabled by default
  exportSaveGeneratorFiles: false,    // Generator file disabled by default
  packageAsZip: false,                // ZIP packaging disabled by default
  skipTiffPreflightModal: false,      // Show TIFF pre-flight modal by default
  exportBackgroundMode: 'transparent', // Transparent background by default
  tiffBitDepth: 8,                    // 8-bit by default (smaller files, most common)
  tiffCompression: 'none',            // No compression by default (Deflate requires Pako.js)
  embedIccProfile: true,              // Embed sRGB ICC profile by default for POD compliance
  renderMode: 'auto',                 // Auto mode by default - smart detection of client vs server
  flattenToRgb: false,                // Off by default - user can enable for smaller files when transparency not needed
  matteColor: '#ffffff',              // White matte color by default
  copyrightText: '',                  // Empty by default - user can add their copyright notice
  // Image metadata defaults
  artistName: '',                     // Empty by default - pre-filled from user profile on first load
  imageTitle: 'Untitled Artwork',     // Default title template
  imageDescription: 'Created with Shape Editor', // Default description template
};

// Saved artboard configuration for persistence
export interface SavedArtboard {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dpi: number;
  unitType: 'pixels' | 'mm' | 'cm' | 'inches';
  backgroundColor: string;
  gridColor?: string;
  displayGrid: boolean;
  displayBorder: boolean;
  displayName: boolean;
  displayDimensions: boolean;
  displayResolution: boolean;
  preset?: string;
  category?: string;
  linkedDimensions?: boolean;
  aspectRatio?: string;
  printConfig?: PrintConfig;
}

// App settings defaults configuration type
export interface AppSettingsDefaults {
  // Export settings
  exportFormat: 'png' | 'jpg' | 'webp' | 'avif' | 'bmp' | 'pdf' | 'tiff';
  exportQuality: number;              // 10-100 for lossy formats
  exportScale: number;                // 0.1-20x scaling (up to 1200dpi)
  exportMode: 'selection' | 'artboard' | 'artboard-extended' | 'all';
  
  // All artboards (persisted)
  savedArtboards?: SavedArtboard[];   // All artboards for persistence
  activeArtboardId?: string;          // Currently active artboard ID
  
  // Legacy artboard settings (for backward compatibility)
  artboardName: string;
  artboardWidth: number;
  artboardHeight: number;
  artboardDpi: number;
  artboardUnitType: 'pixels' | 'mm' | 'cm' | 'inches';
  artboardBackgroundColor: string;
  artboardGridColor: string;
  artboardDisplayGrid: boolean;
  artboardDisplayBorder: boolean;
  artboardDisplayName: boolean;
  artboardDisplayDimensions: boolean;
  artboardDisplayResolution: boolean;
  
  // Canvas settings
  canvasPanX: number;
  canvasPanY: number;
  canvasZoom: number;
  
  // UI settings
  sidebarCollapsed: boolean;
  
  // Selection UI visibility settings
  showMultiSelectButton: boolean;
  showSelectedCount: boolean;
  
  // Print configuration settings (applied to new artboards)
  printOverlayUnit: PrintUnitType;   // Unified unit for all overlays (bleed, safe zone, print marks)
  printBleedAmount: number;
  printBleedDisplay: boolean;
  printBleedRender: boolean;
  printBleedColor: string;           // Bleed overlay color (default: cyan #00FFFF)
  printSafeZoneAmount: number;
  printSafeZoneDisplay: boolean;
  printSafeZoneColor: string;        // Safe zone overlay color (default: magenta #FF00FF)
  printMarksCropMarks: boolean;
  printMarksRegistrationMarks: boolean;
  printMarksMarkLength: number;
  printMarksMarkOffset: number;
  printMarksDisplay: boolean;
  printMarksRender: boolean;
  printMarksScaleMode?: PrintMarksScaleMode;  // 'none' = use overlayUnit, 'percent' = scale relative to artboard
  printMarksColor?: string;  // Print marks color (default: black #000000)
  printBackgroundMode?: BackgroundMode;
  printBackgroundCustomColor?: string;
  printBackgroundDisplay?: boolean;
  printBackgroundRender?: boolean;
}

// Default app settings
export const DEFAULT_APP_SETTINGS: AppSettingsDefaults = {
  exportFormat: 'png',
  exportQuality: 90,
  exportScale: 1,
  exportMode: 'all',
  artboardName: 'Artboard 1',
  artboardWidth: 400,
  artboardHeight: 400,
  artboardDpi: 72,
  artboardUnitType: 'pixels',
  artboardBackgroundColor: '#ffffff',
  artboardGridColor: '#cccccc',
  artboardDisplayGrid: false,
  artboardDisplayBorder: true,
  artboardDisplayName: true,
  artboardDisplayDimensions: false,
  artboardDisplayResolution: false,
  canvasPanX: 0,
  canvasPanY: 0,
  canvasZoom: 1,
  sidebarCollapsed: false,
  showMultiSelectButton: true,
  showSelectedCount: true,
  printOverlayUnit: 'mm',
  printBleedAmount: 3,
  printBleedDisplay: false,
  printBleedRender: false,
  printBleedColor: '#00FFFF',
  printSafeZoneAmount: 5,
  printSafeZoneDisplay: false,
  printSafeZoneColor: '#FF00FF',
  printMarksCropMarks: true,
  printMarksRegistrationMarks: true,
  printMarksMarkLength: 5,
  printMarksMarkOffset: 3,
  printMarksDisplay: false,
  printMarksRender: false,
  printMarksScaleMode: 'none',
  printMarksColor: '#000000',
  printBackgroundMode: 'artboard',
  printBackgroundCustomColor: '#ffffff',
  printBackgroundDisplay: true,
  printBackgroundRender: true,
};

// User preferences schemas
export const insertUserPreferencesSchema = createInsertSchema(userPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateUserPreferencesSchema = insertUserPreferencesSchema.partial().omit({
  userId: true,
});

export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type UpdateUserPreferences = z.infer<typeof updateUserPreferencesSchema>;
export type UserPreferences = typeof userPreferences.$inferSelect;

// ===== SHAPE SET PRESETS =====
// Table for storing user's shape set preset configurations
export const shapeSetPresets = pgTable("shape_set_presets", {
  id: varchar("id").primaryKey().notNull(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  presetName: varchar("preset_name").notNull(),
  generationSetsData: jsonb("generation_sets_data").notNull(),
  currentSetId: varchar("current_set_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertShapeSetPresetSchema = createInsertSchema(shapeSetPresets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertShapeSetPreset = z.infer<typeof insertShapeSetPresetSchema>;
export type ShapeSetPreset = typeof shapeSetPresets.$inferSelect;

// ===== BATCH CONFIGURATION SETTINGS =====
// Moved from client/src/components/BatchConfigDialog.tsx to shared for type safety

// BlendMode type definition (moved from client shapeTypes)
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
  | 'luminosity';

// Compositing operation type for advanced masking and compositing effects
export type CompositingOperation = 
  | 'source-over'     // Default - draw new on top
  | 'source-in'       // Keep new where it overlaps existing  
  | 'source-out'      // Keep new where it doesn't overlap existing
  | 'source-atop'     // Keep new on top of existing only
  | 'destination-over'  // Draw new behind existing
  | 'destination-in'    // Keep existing where new overlaps
  | 'destination-out'   // Remove existing where new overlaps  
  | 'destination-atop'  // Keep existing on top of new only
  | 'lighter'         // Add colors together
  | 'copy'           // Replace with new
  | 'xor';           // Keep where they don't overlap

// Incremental Index Driver - determines which index to use for incremental calculations
// shapeIndex: Uses the shape's index within the generation (0, 1, 2, ...)
// setRepIndex: Uses the set's repetition index across batch generations (0, 1, 2, ...)
export type IncrementalIndexDriver = 'shapeIndex' | 'setRepIndex';

// ===== SCALAR SERIES TYPES =====
// Shared types used by every property that supports series mode.
// A series is an explicit ordered list of items; each item resolves to a single number.

/** One item in a scalar series — either a fixed value or a random pick within a range. */
export type ScalarSeriesItem =
  | { mode: 'fixed'; value: number }
  | { mode: 'range'; valueRange: [number, number] };

/** How items are picked from the series list. */
export type ScalarSeriesSelection = 'sequential' | 'random';

/** What to do when a sequential series reaches the end. */
export type ScalarSeriesExhaustion = 'cycle' | 'bounce';

/** Which index drives the position in the series. */
export type ScalarSeriesDriver = 'shape-index' | 'set-rep-index';

// Set transform configuration
export interface SetTransform {
  x: number;                    // X position offset
  y: number;                    // Y position offset  
  rotation: number;             // Rotation in degrees
  scaleX: number;               // Scale factor for X axis (1.0 = 100%)
  scaleY: number;               // Scale factor for Y axis (1.0 = 100%)
  transformOrigin: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

// Fit target for artboard alignment
export type FitTarget = 'none' | 'artboard' | 'bleed';

// Artboard alignment configuration  
export interface ArtboardAlignment {
  fitToArtboard: boolean;       // DEPRECATED: Use fitTarget instead. Kept for backward compatibility.
  fitTarget: FitTarget;         // What to fit shapes to: 'none', 'artboard', or 'bleed' (includes bleed area)
  fitMode: 'contain' | 'fill';  // contain = maintain aspect ratio, fill = stretch to fill both axes
  alignTo: 'artboard' | 'set' | 'none'; // What to align to
  alignmentType: 'center' | 'top-left' | 'top-center' | 'top-right' | 
                 'center-left' | 'center-right' | 'bottom-left' | 
                 'bottom-center' | 'bottom-right';
  targetSetId?: string;         // ID of set to align to (when alignTo = 'set')
  margin: number | { top: number; bottom: number; left: number; right: number }; // Margin from alignment target in pixels (uniform or individual)
}

// Set visibility and opacity configuration
export interface SetVisibility {
  visible: boolean;            // Whether this set is visible
  opacity: number;             // Overall opacity for the set (0-1)
  opacityVariance: number;     // Random variance in opacity (0-1)
}

// Set locks configuration - granular control over which operations can affect this set
export interface SetLocks {
  composite: boolean;          // Prevents compositing operations from affecting this set (protects backgrounds)
}

// ============================================================================
// Print Configuration Types (for Print-on-Demand export)
// ============================================================================

// Unit type for print measurements
export type PrintUnitType = 'pixels' | 'mm' | 'cm' | 'inches';

// Background mode for export
export type BackgroundMode = 'transparent' | 'artboard' | 'custom';

// Output specifications (non-visual print parameters)
export interface OutputSpecs {
  dpi: number;
  unitType: PrintUnitType;
}

// Bleed settings
export interface BleedSettings {
  amount: number;
  display: boolean;  // Show on canvas
  render: boolean;   // Include in export
  color: string;     // Display/render color (default: cyan #00FFFF)
}

// Safe zone settings
export interface SafeZoneSettings {
  amount: number;
  display: boolean;  // Show on canvas (no render - purely visual)
  color: string;     // Display color (default: magenta #FF00FF)
}

// Print marks scale mode - controls how mark dimensions scale with artboard
export type PrintMarksScaleMode = 'none' | 'percent';

// Print marks settings
export interface PrintMarksSettings {
  display: boolean;  // Show on canvas
  render: boolean;   // Include in export
  cropMarks: boolean;
  registrationMarks: boolean;
  markLength: number;  // Length of crop marks (uses unified overlayUnit, or percentage if scaleMode is 'percent')
  markOffset: number;  // Offset from bleed edge (uses unified overlayUnit, or percentage if scaleMode is 'percent')
  scaleMode?: PrintMarksScaleMode;  // 'none' = use overlayUnit, 'percent' = scale relative to artboard size
  color: string;     // Print marks color (default: black #000000)
}

// Background settings for export
export interface BackgroundExportSettings {
  mode: BackgroundMode;
  customColor: string;
  display: boolean;  // Show on canvas
  render: boolean;   // Include in export
}

// Printable elements (overlays that can be rendered)
export interface PrintableOverlays {
  overlayUnit: PrintUnitType;  // Unified unit for all overlay measurements (bleed, safe zone, print marks)
  bleed: BleedSettings;
  safeZone: SafeZoneSettings;
  printMarks: PrintMarksSettings;
  background: BackgroundExportSettings;
}

// Complete print configuration
export interface PrintConfig {
  outputSpecs: OutputSpecs;
  overlays: PrintableOverlays;
}

// Default print configuration values
export const DEFAULT_PRINT_CONFIG: PrintConfig = {
  outputSpecs: {
    dpi: 72,
    unitType: 'pixels',
  },
  overlays: {
    overlayUnit: 'pixels',  // Unified unit for all overlay measurements
    bleed: {
      amount: 0,
      display: false,
      render: false,
      color: '#00FFFF',  // Cyan
    },
    safeZone: {
      amount: 0,
      display: false,
      color: '#FF00FF',  // Magenta
    },
    printMarks: {
      display: false,
      render: false,
      cropMarks: true,
      registrationMarks: true,
      markLength: 12,
      markOffset: 3,
      scaleMode: 'none',
      color: '#000000',  // Black
    },
    background: {
      mode: 'artboard',
      customColor: '#ffffff',
      display: true,
      render: true,
    },
  },
};

// Zod schemas for print configuration validation
export const PrintUnitTypeSchema = z.enum(['pixels', 'mm', 'cm', 'inches']);
export const BackgroundModeSchema = z.enum(['transparent', 'artboard', 'custom']);

export const OutputSpecsSchema = z.object({
  dpi: z.number().min(1).max(1200),
  unitType: PrintUnitTypeSchema,
});

export const BleedSettingsSchema = z.object({
  amount: z.number().min(0),
  display: z.boolean(),
  render: z.boolean(),
  color: z.string(),
});

export const SafeZoneSettingsSchema = z.object({
  amount: z.number().min(0),
  display: z.boolean(),
  color: z.string(),
});

export const PrintMarksScaleModeSchema = z.enum(['none', 'percent']);

export const PrintMarksSettingsSchema = z.object({
  display: z.boolean(),
  render: z.boolean(),
  cropMarks: z.boolean(),
  registrationMarks: z.boolean(),
  markLength: z.number().min(0).max(100),  // Allow 0-100 for percentage mode
  markOffset: z.number().min(0).max(50),
  scaleMode: PrintMarksScaleModeSchema.optional(),
  color: z.string(),  // Print marks color
});

export const BackgroundExportSettingsSchema = z.object({
  mode: BackgroundModeSchema,
  customColor: z.string(),
  display: z.boolean(),
  render: z.boolean(),
});

export const PrintableOverlaysSchema = z.object({
  overlayUnit: PrintUnitTypeSchema,  // Unified unit for all overlay measurements
  bleed: BleedSettingsSchema,
  safeZone: SafeZoneSettingsSchema,
  printMarks: PrintMarksSettingsSchema,
  background: BackgroundExportSettingsSchema,
});

export const PrintConfigSchema = z.object({
  outputSpecs: OutputSpecsSchema,
  overlays: PrintableOverlaysSchema,
});

// ============================================================================

// Grid offset axis configuration (for row or column)
export interface GridOffsetAxisConfig {
  enabled: boolean;
  amountMode: 'fixed' | 'range' | 'incremental';  // Value mode for amount
  amount: number;                    // Pixels to offset (for fixed mode)
  amountMin: number;                 // Min offset for range mode
  amountMax: number;                 // Max offset for range mode
  amountBase: number;                // Base offset for incremental mode
  amountIncrement: number;           // Increment per alternating row/col for incremental mode
  startIndex: number;                // Which row/column starts the offset (0-indexed)
  direction: 'left' | 'right' | 'up' | 'down';  // Direction of offset
  pattern: number[];                 // For pattern mode: explicit indices to offset
  patternInverse: boolean;           // When true, offset every row/col NOT in pattern
}

// Grid offsets configuration for alternating/pattern offsets
export interface GridOffsetsConfig {
  enabled: boolean;
  mode: 'alternating' | 'pattern';
  preset: 'custom' | 'none' | 'brick' | 'honeycomb' | 'staircase' | 'zigzag' | 'diamond';  // Track selected preset
  row: GridOffsetAxisConfig;         // Row offset affects X position (shifts left/right)
  column: GridOffsetAxisConfig;      // Column offset affects Y position (shifts up/down)
}

// Default grid offsets configuration
export const DEFAULT_GRID_OFFSETS: GridOffsetsConfig = {
  enabled: false,
  mode: 'alternating',
  preset: 'custom',
  row: {
    enabled: false,
    amountMode: 'fixed',
    amount: 0,
    amountMin: 0,
    amountMax: 50,
    amountBase: 0,
    amountIncrement: 10,
    startIndex: 0,
    direction: 'right',
    pattern: [],
    patternInverse: false
  },
  column: {
    enabled: false,
    amountMode: 'fixed',
    amount: 0,
    amountMin: 0,
    amountMax: 50,
    amountBase: 0,
    amountIncrement: 10,
    startIndex: 0,
    direction: 'down',
    pattern: [],
    patternInverse: false
  }
};

// Shape masking configuration for controlling which grid positions render shapes
export interface ShapeMaskingGridConfig {
  enabled: boolean;
  mode: 'alternating' | 'pattern';
  invert: boolean;                    // false = exclude matched, true = render only matched
  priority: 'row-first' | 'column-first';
  
  // Alternating mode settings
  alternating: {
    skipEvery: number;                // Skip every Nth row/column (2 = every other)
    startIndex: number;               // Where alternation begins (0-indexed)
  };
  
  // Pattern mode settings - explicit row/column combinations to mask
  pattern: Array<{
    row: number;
    columns: number[];                // Which columns to mask for this row
  }>;
}

// Shape masking configuration (Phase 3)
export interface ShapeMaskingConfig {
  enabled: boolean;
  grid: ShapeMaskingGridConfig;
}

// Default shape masking configuration
export const DEFAULT_SHAPE_MASKING: ShapeMaskingConfig = {
  enabled: false,
  grid: {
    enabled: false,
    mode: 'alternating',
    invert: false,
    priority: 'row-first',
    alternating: {
      skipEvery: 2,
      startIndex: 0
    },
    pattern: []
  }
};

// Cell constraints configuration for cell-based rendering (Phase 4)
// ─── Cell Anchor Types ────────────────────────────────────────────────────────
// The 9 compass positions used for cell alignment (shape anchor + cell anchor)
export type CellAnchor = 'nw' | 'n' | 'ne' | 'w' | 'center' | 'e' | 'sw' | 's' | 'se';
export type CellAnchorMode = 'fixed' | 'range' | 'incremental' | 'sequence';

// UV coordinates (0–1) for each anchor: (0,0) = top-left, (1,1) = bottom-right
export const CELL_ANCHOR_UV: Record<CellAnchor, { uvX: number; uvY: number }> = {
  nw:     { uvX: 0,   uvY: 0   },
  n:      { uvX: 0.5, uvY: 0   },
  ne:     { uvX: 1,   uvY: 0   },
  w:      { uvX: 0,   uvY: 0.5 },
  center: { uvX: 0.5, uvY: 0.5 },
  e:      { uvX: 1,   uvY: 0.5 },
  sw:     { uvX: 0,   uvY: 1   },
  s:      { uvX: 0.5, uvY: 1   },
  se:     { uvX: 1,   uvY: 1   },
};

export interface CellConstraintsConfig {
  enabled: boolean;
  renderMode: 'cell-center' | 'cell-corners';
  // - cell-center: Shapes centered in cells (rows × cols cells); gridRows × gridColumns = cell count
  // - cell-corners: Shapes at grid-line intersections ((rows+1) × (cols+1) points)
  
  // Cell/Cell-Point mode settings - how shapes fit within cells
  fitMode: 'none' | 'fill' | 'contain' | 'cover';
  // - none: Use original shape size, just center in cell
  // - fill: Stretch to fill cell (may distort aspect ratio)
  // - contain: Scale to fit within cell (maintain aspect ratio, may have gaps)
  // - cover: Scale to cover cell (maintain aspect ratio, may overflow)
  
  maintainAspectRatio: boolean;   // Legacy field, no longer used (fill always stretches)
  paddingUnit: 'px' | '%';        // Pixel or percentage of cell size
  paddingTop: number;             // Top inset from cell edge
  paddingRight: number;           // Right inset
  paddingBottom: number;          // Bottom inset
  paddingLeft: number;            // Left inset

  // ─── Cell Alignment ───────────────────────────────────────────────────────
  // Positions a specific point on the shape at a specific point in the cell.
  // Applies to Cell and Cell-Point render modes.
  cellAlignmentEnabled?: boolean;

  // Shape anchor — which point of the shape's bounding box is the "handle"
  shapeAnchorMode?: CellAnchorMode;
  shapeAnchorFixed?: CellAnchor;          // Fixed mode: single anchor
  shapeAnchorOptions?: CellAnchor[];      // Range/Incremental: pool to draw from
  shapeAnchorSequence?: CellAnchor[];     // Sequence: ordered list (repeats allowed)
  shapeAnchorCustomUV?: boolean;          // Fixed mode only: use UV instead of preset
  shapeAnchorCustomUVX?: number;          // 0–1, shape bounding-box X fraction
  shapeAnchorCustomUVY?: number;          // 0–1, shape bounding-box Y fraction

  // Cell anchor — which point of the cell the handle snaps to
  cellAnchorMode?: CellAnchorMode;
  cellAnchorFixed?: CellAnchor;
  cellAnchorOptions?: CellAnchor[];
  cellAnchorSequence?: CellAnchor[];

  // Debug visualization
  showDebugGrid: boolean;         // Show semi-transparent grid lines for debugging
  debugGridColor?: string;        // Color for debug grid lines (default: rgba(255,0,0,0.4))
  debugGridOpacity?: number;      // Opacity multiplier 0-1 (default: 1)
}

// Default cell constraints configuration
export const DEFAULT_CELL_CONSTRAINTS: CellConstraintsConfig = {
  enabled: false,
  renderMode: 'cell-center',
  fitMode: 'contain',
  maintainAspectRatio: true,
  paddingUnit: 'px',
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  showDebugGrid: false,
  debugGridOpacity: 0.4,
  // debugGridColor intentionally omitted — undefined means 'use set default palette'
};

// ===== ECHO/MOTION TRAILS CONFIGURATION =====
// Echo/Motion Trails creates trailing copies of shapes with progressive effects
// Project A: Set-Level only (scope locked to 'set', driver is setRepIndex)

// Echo direction mode - how the echo direction is determined
export type EchoDirectionMode = 'fixed-vector' | 'auto-motion' | 'absolute-position';

// Echo scope - which level echoes apply to (Project A: only 'set' is enabled)
export type EchoScope = 'set' | 'shape' | 'both';

// Echo driver - what determines echo progression (Project A: only 'setRepIndex' active)
export type EchoDriver = 'setRepIndex' | 'shapeIndex' | 'combined';

// Per-effect jitter mode
export type EchoPerEffectJitterMode = 'fixed' | 'range';

// Per-effect jitter settings (applies to individual effects for granular control)
export interface EchoPerEffectJitterConfig {
  enabled: boolean;
  mode: EchoPerEffectJitterMode;  // 'fixed' uses fixedAmount, 'range' randomizes between min/max
  fixedAmount: number;            // Fixed jitter amount (used in 'fixed' mode)
  rangeMin: number;               // Minimum jitter (used in 'range' mode)
  rangeMax: number;               // Maximum jitter (used in 'range' mode)
}

// Per-echo opacity settings
export interface EchoOpacityConfig {
  enabled?: boolean;         // Whether opacity effect is enabled (defaults to true for backward compat)
  startOpacity: number;      // 0-100% - starting opacity for first echo
  falloffRate: number;       // 0-100% - how fast opacity decreases per echo
  minOpacity: number;        // 0-100% - minimum opacity floor
  jitter: EchoPerEffectJitterConfig; // Opacity-specific jitter
}

// Per-echo blur settings
export interface EchoBlurConfig {
  enabled: boolean;
  startBlur: number;         // 0-50px - starting blur for first echo
  blurDelta: number;         // 0-20px - blur increase per echo
  maxBlur: number;           // 0-100px - maximum blur cap
  jitter: EchoPerEffectJitterConfig; // Blur-specific jitter
}

// Per-echo scale settings
export interface EchoScaleConfig {
  enabled: boolean;
  startScale: number;        // 10-200% - starting scale for first echo
  scaleDelta: number;        // -50 to +50% - scale change per echo
  minScale: number;          // 1-100% - minimum scale floor
  maxScale: number;          // 100-500% - maximum scale cap
  jitter: EchoPerEffectJitterConfig; // Scale-specific jitter
}

// Per-echo rotation settings
export interface EchoRotationConfig {
  enabled: boolean;
  startRotation: number;     // 0-360° - starting rotation for first echo
  rotationDelta: number;     // -180 to +180° - rotation change per echo
  minRotation: number;       // -360 to 0° - minimum rotation floor
  maxRotation: number;       // 0 to 360° - maximum rotation cap
  jitter: EchoPerEffectJitterConfig; // Rotation-specific jitter
}

// Echo jitter settings for organic variation (position/direction jitter)
export interface EchoJitterConfig {
  enabled: boolean;
  distanceRange: number;     // 0-100px - random distance variation
  angleRange: number;        // 0-180° - random angle variation
}

// Per-echo color shift settings (Project B: color progression)
export interface EchoColorShiftConfig {
  enabled: boolean;
  hueDelta: number;          // -180 to +180° - hue change per echo
  saturationDelta: number;   // -50 to +50% - saturation change per echo
  lightnessDelta: number;    // -50 to +50% - lightness change per echo
  jitter: EchoPerEffectJitterConfig; // Color-specific jitter (applied to hue)
}

// Fixed-vector mode settings
export interface EchoFixedVectorConfig {
  angle: number;             // 0-360° - direction of echoes
  distance: number;          // 0-500px - distance between echoes
}

// Auto-motion mode settings
export interface EchoAutoMotionConfig {
  fallbackAngle: number;     // 0-360° - angle when no motion detected
  distanceMultiplier: number; // 0.1-5.0 - multiplier for detected motion
}

// Artboard target presets for absolute-position mode
export type EchoArtboardTarget = 'center' | 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left' | 'custom';

// Absolute-position mode settings (Project B: converging/diverging effects)
export interface EchoAbsolutePositionConfig {
  targetX: number;           // Target X coordinate (artboard-relative, used when artboardTarget='custom')
  targetY: number;           // Target Y coordinate (artboard-relative, used when artboardTarget='custom')
  artboardTarget: EchoArtboardTarget; // Predefined artboard location or custom coordinates
  mode: 'converge' | 'diverge'; // Converge toward target or diverge away from it
}

// Echo ApplyTo filter selector mode
export type EchoApplyToSelector = 'all' | 'even' | 'odd' | 'step';

// Echo ApplyTo filter configuration (Project B: shape filtering for echoes)
export interface EchoApplyToConfig {
  enabled: boolean;
  shapeTypes?: string[];      // Only apply to these shape types (if empty/undefined, apply to all)
  indices?: number[];         // Specific shape indices to apply to
  selector: EchoApplyToSelector;  // Index-based selection mode
  indexStep?: number;         // Step interval when selector='step' (default: 2)
  probability?: number;       // 0-100 probability of applying to each matching shape
}

// Default ApplyTo config (apply to all)
export const DEFAULT_ECHO_APPLY_TO_CONFIG: EchoApplyToConfig = {
  enabled: false,
  shapeTypes: [],
  indices: [],
  selector: 'all',
  indexStep: 2,
  probability: 100
};

// Main Echo/Motion Trails configuration
export interface EchoSpreadConfig {
  version: number;           // Schema version for migrations (starts at 1)
  enabled: boolean;
  
  // Scope and driver (Project A: scope locked to 'set', driver to 'setRepIndex')
  scope: EchoScope;
  driver: EchoDriver;
  syncBothScopes?: boolean;  // When scope='both', sync settings between Set and Shape levels (default: true)
  
  // Echo count
  echoCount: number;         // 1-20 - number of echo copies
  
  // Direction mode
  directionMode: EchoDirectionMode;
  fixedVector: EchoFixedVectorConfig;
  autoMotion: EchoAutoMotionConfig;
  absolutePosition?: EchoAbsolutePositionConfig;
  
  // Per-echo effects
  opacity: EchoOpacityConfig;
  blur: EchoBlurConfig;
  scale: EchoScaleConfig;
  rotation: EchoRotationConfig;
  colorShift?: EchoColorShiftConfig; // Optional color progression (Project B)
  
  // Jitter for organic variation (position/direction)
  jitter: EchoJitterConfig;
  
  // ApplyTo filters (Project B: shape-level filtering)
  applyTo?: EchoApplyToConfig;
}

// Default per-effect jitter config
export const DEFAULT_ECHO_PER_EFFECT_JITTER: EchoPerEffectJitterConfig = {
  enabled: false,
  mode: 'fixed',
  fixedAmount: 0,
  rangeMin: 0,
  rangeMax: 0
};

// Default echo/motion trails configuration
export const DEFAULT_ECHO_SPREAD_CONFIG: EchoSpreadConfig = {
  version: 2,                // Schema version 2: per-effect jitter + rotation config
  enabled: false,
  
  scope: 'set',              // Project A: locked to 'set'
  driver: 'setRepIndex',     // Project A: locked to 'setRepIndex'
  
  echoCount: 3,
  
  directionMode: 'fixed-vector',
  fixedVector: {
    angle: 225,              // Default: trailing behind (up-left)
    distance: 20
  },
  autoMotion: {
    fallbackAngle: 225,
    distanceMultiplier: 1.0
  },
  absolutePosition: {
    targetX: 0,
    targetY: 0,
    artboardTarget: 'center',
    mode: 'converge'
  },
  
  opacity: {
    startOpacity: 80,
    falloffRate: 25,
    minOpacity: 10,
    jitter: { enabled: false, mode: 'fixed', fixedAmount: 0, rangeMin: 0, rangeMax: 0 }
  },
  blur: {
    enabled: false,
    startBlur: 0,
    blurDelta: 2,
    maxBlur: 20,
    jitter: { enabled: false, mode: 'fixed', fixedAmount: 0, rangeMin: 0, rangeMax: 0 }
  },
  scale: {
    enabled: false,
    startScale: 100,
    scaleDelta: -5,
    minScale: 20,
    maxScale: 200,
    jitter: { enabled: false, mode: 'fixed', fixedAmount: 0, rangeMin: 0, rangeMax: 0 }
  },
  rotation: {
    enabled: false,
    startRotation: 0,
    rotationDelta: 0,
    minRotation: -360,
    maxRotation: 360,
    jitter: { enabled: false, mode: 'fixed', fixedAmount: 0, rangeMin: 0, rangeMax: 0 }
  },
  colorShift: {
    enabled: false,
    hueDelta: 0,
    saturationDelta: 0,
    lightnessDelta: 0,
    jitter: { enabled: false, mode: 'fixed', fixedAmount: 0, rangeMin: 0, rangeMax: 0 }
  },
  
  jitter: {
    enabled: false,
    distanceRange: 0,
    angleRange: 0
  },
  
  applyTo: DEFAULT_ECHO_APPLY_TO_CONFIG
};

// Copy-to-Points distribution configuration
// ── Copy-to-Points per-property influence system ─────────────────────────────

/** Sub-mode for range-driven point property evaluation. */
export type RangeSubMode = 'point-index' | 'shape-index' | 'set-rep-index' | 'random';

/** Which shape property a PointPropertyConfig entry drives. */
export type PointPropertyKey =
  | 'posX' | 'posY'
  | 'scaleX' | 'scaleY' | 'uniformScale'
  | 'skewX' | 'skewY'
  | 'rotation'
  | 'fillOpacity'
  | 'fillR' | 'fillG' | 'fillB';

/** How the blended value is combined with the source shape value. */
export type PointPropertyBlendMode = 'normal' | 'multiply' | 'add' | 'subtract' | 'divide';

/**
 * How the target value for blending is derived:
 *  fixed        — constant `fixedValue` regardless of point index
 *  random-range — Math.random() between rangeMin and rangeMax; evaluatePoints controls whether
 *                 one random draw is shared per global point index ('all-points') or per local
 *                 index within each destination shape ('points-per-shape')
 *  range        — deterministic linear sweep driven by `rangeSubMode`:
 *                   'point-index'   → lerp(rangeMin, rangeMax, pointIndex / max(total-1, 1))
 *                   'shape-index'   → deterministic by shape order (future)
 *                   'set-rep-index' → deterministic by rep index (future)
 *  incremental  — value = incrementalStart + incrementalStep × pointIndex
 *                         (optionally wraps at `incrementalWrap` if > 0)
 */
export type PointPropertyMode = 'fixed' | 'random-range' | 'range' | 'incremental';

/**
 * Per-property blending configuration for copy-to-points influence.
 *
 * Evaluation pipeline (per placed shape):
 *  1. targetVal = evaluate(mode):
 *       fixed       → fixedValue
 *       range       → lerp(rangeMin, rangeMax, pointIndex / max(totalPoints-1, 1))
 *       incremental → incrementalStart + incrementalStep × pointIndex
 *                     (if incrementalWrap > 0: modulo incrementalWrap)
 *  2. if remapEnabled: targetVal = remap(targetVal, remapFrom → remapTo)
 *  3. blendedVal = blend(srcVal, targetVal, blendMode)
 *  4. amount     = amountMode==='fixed' ? amountFixed : rand(amountRangeMin, amountRangeMax)
 *  5. finalVal   = lerp(srcVal, blendedVal, amount)
 *  6. write finalVal to cloned shape's property
 */
export interface PointPropertyConfig {
  enabled: boolean;
  key: PointPropertyKey;
  mode: PointPropertyMode;
  /**
   * Position sub-mode (only meaningful when key === 'posX' or key === 'posY').
   * cartesian — target X/Y values interpreted as absolute canvas coordinates
   * polar     — X drives angle (degrees), Y drives radius from origin (0,0)
   */
  positionSubMode: 'cartesian' | 'polar';
  /**
   * Controls which point index is used when evaluating this property.
   * 'all-points'      — global index across all harvested points from all destination shapes
   * 'points-per-shape' — local index within each individual destination shape's point list
   */
  evaluatePoints: 'all-points' | 'points-per-shape';
  /** Used when mode === 'fixed': constant target value applied to every placed shape. */
  fixedValue: number;
  /** Used when mode === 'range': value at point index 0. */
  rangeMin: number;
  /** Used when mode === 'range': value at the last point index. */
  rangeMax: number;
  /**
   * Used when mode === 'range': controls what drives the lerp parameter.
   * 'point-index'   — destination point index (evaluatePoints setting applies)
   * 'shape-index'   — index of each shape within its source/generation set (0..N-1)
   * 'set-rep-index' — which repetition of the full set (0..repCount-1)
   * 'random'        — Math.random() per placed shape (original behaviour)
   */
  rangeSubMode: RangeSubMode;
  /** Used when mode === 'incremental': starting value. */
  incrementalStart: number;
  /** Used when mode === 'incremental': per-point additive step. */
  incrementalStep: number;
  /**
   * Used when mode === 'incremental': modulo wrap threshold.
   * 0 (or falsy) = no wrapping.  e.g. set to 360 for rotation cycling.
   */
  incrementalWrap: number;
  /**
   * When true, maps the evaluated target value through remapFrom → remapTo.
   * Applies to all modes.
   */
  remapEnabled: boolean;
  remapFrom: [number, number];
  remapTo: [number, number];
  blendMode: PointPropertyBlendMode;
  /** 'fixed' uses amountFixed; 'range' samples uniformly from [amountRangeMin, amountRangeMax]. */
  amountMode: 'fixed' | 'range';
  amountFixed: number;        // 0..1
  amountRangeMin: number;     // 0..1
  amountRangeMax: number;     // 0..1
  /** When true, render the computed value at each destination point as a canvas label. */
  showOnPoints: boolean;
  /** CSS hex color for the point label (e.g. '#22d3ee'). Defaults to cyan for deterministic, amber for approximate if not set. */
  labelColor: string;
  /** Font size for the point label in px (before zoom compensation). Defaults to 10. */
  labelFontSize: number;
}

export const DEFAULT_POINT_PROPERTY_CONFIG: PointPropertyConfig = {
  enabled: false,
  key: 'fillOpacity',
  mode: 'fixed',
  positionSubMode: 'cartesian',
  evaluatePoints: 'all-points',
  fixedValue: 1,
  rangeMin: 0,
  rangeMax: 1,
  rangeSubMode: 'point-index' as RangeSubMode,
  incrementalStart: 0,
  incrementalStep: 0.1,
  incrementalWrap: 0,
  remapEnabled: false,
  remapFrom: [0, 1],
  remapTo: [0, 1],
  blendMode: 'normal',
  amountMode: 'fixed',
  amountFixed: 1,
  amountRangeMin: 0,
  amountRangeMax: 1,
  showOnPoints: false,
  labelColor: '#22d3ee',
  labelFontSize: 10,
};

export interface CopyToPointsConfig {
  // Which generation set to harvest points from
  destinationSetId: string;
  // How source shapes are assigned to destination points
  // 'shape-copy' — each point gets one source shape, cycling through pool in order
  // 'set-copy'   — the entire source set (all shapes with relative offsets preserved) is
  //                cloned as a group at each destination point
  copyMode: 'shape-copy' | 'set-copy';
  // What to do when points > shapes or shapes > points (shape-copy mode only)
  // 'wrap'              — cycle source shapes back to start
  // 'clamp'             — stop producing output once either list is exhausted
  // 'distribute-evenly' — spread shapes evenly across points regardless of count
  overflowMode: 'wrap' | 'clamp' | 'distribute-evenly';
}

export const DEFAULT_COPY_TO_POINTS_CONFIG: CopyToPointsConfig = {
  destinationSetId: '',
  copyMode: 'shape-copy',
  overflowMode: 'wrap',
};

/**
 * Target-side harvest/influence config: controls how the destination set exposes
 * its points when used as a CTP destination.
 * Stored on the destination set's batchConfig.copyToPointsTargetConfig.
 */
export interface CopyToPointsTargetConfig {
  // Which point types to harvest from destination shapes
  includeVertices: boolean;
  includeCentroid: boolean;
  // Sample stride: 1=all vertices, 2=every other, 3=every third, etc.
  vertexSampleStride: number;
  // Resample points evenly along the shape outline (overrides vertex-only sampling)
  resampleOutline: boolean;
  resampleCount: number;
  // Per-property blending from destination shapes into placed source shapes
  pointProperties: PointPropertyConfig[];
  // Controls how points are distributed across multiple source shapes (set-copy mode)
  // 'all-points': full set placed at every destination point (N shapes × M points total)
  // 'points-per-shape': points divided among source shapes (M total — one per point)
  pointsMode: 'all-points' | 'points-per-shape';
}

export const DEFAULT_CTP_TARGET_CONFIG: CopyToPointsTargetConfig = {
  includeVertices: true,
  includeCentroid: false,
  vertexSampleStride: 1,
  resampleOutline: false,
  resampleCount: 8,
  pointProperties: [],
  pointsMode: 'all-points',
};

export interface BatchConfigSettings {
  // Preset Selection
  selectedPreset: string;
  
  // Distribution Layout
  distributionLayoutEnabled: boolean;
  distributionPattern: 'grid' | 'wave' | 'ellipse' | 'spiral' | 'auto-distribute';

  // Copy-to-Points (independent section — can coexist with distribution layout)
  copyToPointsEnabled: boolean;
  autoDistributeXCount?: number;
  autoDistributeYCount?: number;
  
  // Grid Layout Settings
  gridRows: number;
  gridColumns: number;
  gridCreationOrder: 'rows' | 'columns';
  gridHorizontalDirection: 'left-to-right' | 'right-to-left';
  gridVerticalDirection: 'top-to-bottom' | 'bottom-to-top';
  gridFillEnabled: boolean; // When true, count is forced to gridRows × gridColumns
  gridStartX: number; // Start position offset X
  gridStartY: number; // Start position offset Y
  gridRowOffset: number;
  gridColumnOffset: number;
  gridMarginEnabled: boolean; // Enable custom margin for auto-centered mode
  gridMarginMode: 'absolute' | 'relative'; // absolute = from artboard edges, relative = from natural auto-centered positions
  gridMarginUnit: 'px' | '%'; // Unit for margin values
  gridMarginTop: number;    // Top margin (positive = inward, negative = outward)
  gridMarginRight: number;  // Right margin
  gridMarginBottom: number; // Bottom margin
  gridMarginLeft: number;   // Left margin
  gridGutterEnabled: boolean; // Enable column/row gutters
  gridGutterX: number;      // Horizontal gutter between columns (px)
  gridGutterY: number;      // Vertical gutter between rows (px)
  gridSortBy: 'layer' | 'id' | 'shape-type' | 'fill-color' | 'opacity' | 'size' | 'angle' | 'creation-time' | 'none' | 
    'corner-radius' | 'point-count' | 'edge-count' | 'inner-radius' | 'segment-count' | 
    'direction' | 'length' | 'centroid' | 'spread' | 'curvature';
  gridSortScope: 'per-generation' | 'per-batch'; // Sort within each generation or across entire batch
  gridSortOrder: 'ascending' | 'descending'; // Sort direction
  gridGroupByShapeType: boolean; // Group shapes by type before sorting
  gridReverseGroups: boolean; // Reverse the order of shape-type groups
  // Grid randomization amounts (additive pixel offsets)
  gridXRandomization: number; // 0-200 pixels additive randomization in X direction
  gridYRandomization: number; // 0-200 pixels additive randomization in Y direction
  
  // Grid alternating/pattern offsets (Phase 1: alternating, Phase 2: pattern)
  gridOffsets: GridOffsetsConfig;
  
  // Shape masking for grid positions (Phase 3)
  shapeMasking: ShapeMaskingConfig;
  
  // Cell constraints for cell-based rendering (Phase 4)
  cellConstraints: CellConstraintsConfig;
  
  
  // Wave Pattern Settings
  waveType: 'sine' | 'triangle' | 'square' | 'sawtooth';
  waveAmplitude: number; // Wave height in pixels (0-200)
  waveFrequency: number; // Number of complete waves or wavelength
  waveDirection: 'horizontal' | 'vertical';
  wavePhaseOffset: number; // Start position along wave (0-360 degrees)
  
  // Ellipse/Ring Pattern Settings
  ellipseXRadius: [number, number]; // X radius range in pixels
  ellipseYRadius: [number, number]; // Y radius range in pixels
  ellipseRingCount: number; // Number of concentric rings (1-10)
  ellipseRingSpacing: 'even' | 'progressive'; // Spacing mode between rings
  ellipseRotation: number; // Ellipse rotation angle (0-360 degrees)
  ellipseRotationAlignment: 'uniform' | 'progressive'; // All rings same rotation or progressive
  ellipseAlignToRing: boolean; // Align shapes to ellipse tangent
  ellipseFlipInward: boolean; // Flip alignment inward vs outward
  ellipseAdditionalRotation: number; // Additional rotation added to alignment (degrees)
  ellipseShapeRotationMode: 'none' | 'fixed' | 'range' | 'incremental' | 'series'; // Shape rotation mode
  ellipseRotationFixed: number; // Fixed rotation value (degrees)
  ellipseRotationRange: [number, number]; // Random rotation range (degrees)
  ellipseRotationIncrementalStart: number; // Starting rotation (degrees)
  ellipseRotationIncrementalStep: number; // Rotation increment per shape (degrees)

  // Ellipse Shape Rotation Series Mode
  ellipseShapeRotationSeriesItems: ScalarSeriesItem[];
  ellipseShapeRotationSeriesSelection: ScalarSeriesSelection;
  ellipseShapeRotationSeriesExhaustion: ScalarSeriesExhaustion;
  ellipseShapeRotationSeriesDriver: ScalarSeriesDriver;
  ellipseShapeRotationSeriesStagingMode: 'fixed' | 'range';
  
  // Spiral Pattern Settings
  spiralTurnCount: number; // Number of complete rotations (1-20)
  spiralSpacingMode: 'linear' | 'logarithmic'; // Spacing growth mode
  spiralDirection: 'clockwise' | 'counterclockwise';
  spiralStartAngle: number; // Initial rotation offset (0-360 degrees)
  spiralTightness: number; // How compact/spread the spiral is (0.1-2.0)
  
  // Shared Pattern Enhancements
  tangentAlignment: boolean; // Orient shapes to follow curve tangent
  segmentDistribution: 'even' | 'clustered'; // Shape distribution along path
  reverseDirection: boolean; // Reverse pattern direction
  
  // Copy-to-Points configuration (used when copyToPointsEnabled === true)
  copyToPointsConfig?: CopyToPointsConfig;
  // Destination-side harvest/influence config — stored on the destination set, not the source
  copyToPointsTargetConfig?: CopyToPointsTargetConfig;
  // Whether the "Expose as Point Source" section is enabled in BatchConfigDialog
  copyToPointsTargetEnabled?: boolean;
  // When true, this set's own shapes are hidden and only serve as point positions
  hideWhenUsedAsPointSource?: boolean;
  
  // Generation Count Controls
  generationCountMode: 'range' | 'fixed' | 'incremental';
  generationCountDefine: number;
  generationCountStartValue: number;
  generationCountIncrement: number;
  generationCountResetPerBatch: boolean;
  generationCountModulationEnabled: boolean;
  generationCountModulationValue: number;

  // Blend Mode Control
  blendModeEnabled: boolean;
  enabledBlendModes: { [key in BlendMode]?: number }; // weight 0-100
  
  // Compositing Operations Control
  compositingOperationsEnabled: boolean;
  enabledCompositingOperations: { [key: string]: number }; // weight 0-100
  
  // Properties Section
  propertiesEnabled: boolean;
  
  // Shape Properties
  shapePropertiesEnabled: boolean;
  shapePropertiesDimensionsEnabled: boolean;
  shapePropertiesPositionEnabled: boolean;
  widthRange: [number, number];
  heightRange: [number, number];
  xPositionRange: [number, number];
  yPositionRange: [number, number];
  
  // Enhanced Width and Height Properties
  widthMode: 'range' | 'value' | 'incremental' | 'series';
  heightMode: 'range' | 'value' | 'incremental' | 'series';
  
  // Width/Height Mode Toggles
  sizeIncrementalResetPerBatch: boolean; // true: reset count per batch, false: continuous increment
  
  // Size Constraint Mode - determines how width/height are constrained
  sizeConstraintMode: 'none' | 'min' | 'max' | 'avg'; // 'none': independent W/H, 'min/max/avg': constrain both dimensions
  // When true, polygon/radius shapes (triangle, hexagon, semicircle, etc.) are stretched
  // to fill the configured width × height bounding box exactly. When false (default),
  // they keep their natural proportions and are sized by radius (diameter = constrainedSize).
  stretchShapeToDimensions: boolean;
  
  // Width/Height Value Mode
  widthValue: number;
  heightValue: number;
  
  // Width/Height Incremental Mode
  widthIncrement: number;
  heightIncrement: number;
  widthStartValue: number; // Individual start values
  heightStartValue: number;
  widthModulationEnabled: boolean; // Enable modulation for width
  widthModulationValue: number; // Modulation value for width
  widthStartOffset: number; // Per-cycle start shift for width modulation (px)
  widthStartOffsetCompound: boolean; // If true, offset grows quadratically with wrap count
  widthWrapOffset: number; // Per-cycle shift applied to the wrap threshold for width modulation (px)
  widthWrapOffsetCompound: boolean;
  widthModulationBounce: boolean; // true = triangle-wave bounce, false = sawtooth cycle
  heightModulationEnabled: boolean; // Enable modulation for height
  heightModulationValue: number; // Modulation value for height
  heightStartOffset: number; // Per-cycle start shift for height modulation (px)
  heightStartOffsetCompound: boolean; // If true, offset grows quadratically with wrap count
  heightWrapOffset: number; // Per-cycle shift applied to the wrap threshold for height modulation (px)
  heightWrapOffsetCompound: boolean;
  heightModulationBounce: boolean; // true = triangle-wave bounce, false = sawtooth cycle
  sizeIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for width/height incremental mode
  
  // Width Series Mode
  widthSeriesItems: ScalarSeriesItem[];
  widthSeriesSelection: ScalarSeriesSelection;
  widthSeriesExhaustion: ScalarSeriesExhaustion;
  widthSeriesDriver: ScalarSeriesDriver;
  widthSeriesStagingMode: 'fixed' | 'range';

  // Height Series Mode
  heightSeriesItems: ScalarSeriesItem[];
  heightSeriesSelection: ScalarSeriesSelection;
  heightSeriesExhaustion: ScalarSeriesExhaustion;
  heightSeriesDriver: ScalarSeriesDriver;
  heightSeriesStagingMode: 'fixed' | 'range';
  
  // Size Constraints
  minimumSize: number; // absolute minimum size to prevent invisible shapes
  maximumSize: number; // absolute maximum size constraint
  
  // Position coordinate system
  positionCoordSystem: 'cartesian' | 'polar';

  // Enhanced Position Properties
  xPositionMode: 'range' | 'value' | 'incremental' | 'series';
  yPositionMode: 'range' | 'value' | 'incremental' | 'series';

  // Position Mode Toggles
  incrementalResetPerBatch: boolean; // true: reset count per batch, false: continuous increment
  directionalEvenDistribution: boolean; // kept for server compat
  directionalClusterAngle: number; // kept for server compat

  // Position Value Mode
  xPositionValue: number;
  yPositionValue: number;

  // Position Directional Mode (kept for server compat)
  positionDirectionalMode: 'outward-center' | 'outward-edge' | 'angle-based';
  positionDirectionalAngle: number;
  positionDirectionalDistance: number;

  // Position Incremental Mode
  xPositionIncrement: number;
  yPositionIncrement: number;
  xPositionStartValue: number;
  yPositionStartValue: number;
  xPositionModulationMode: 'off' | 'grid-col' | 'pixel-value' | 'shape-count';
  xPositionModulationValue: number;
  yPositionModulationMode: 'off' | 'grid-row' | 'pixel-value' | 'shape-count';
  yPositionModulationValue: number;
  positionIncrementalIndexDriver: IncrementalIndexDriver;

  // X Position Series Mode
  xPositionSeriesItems: ScalarSeriesItem[];
  xPositionSeriesSelection: ScalarSeriesSelection;
  xPositionSeriesExhaustion: ScalarSeriesExhaustion;
  xPositionSeriesDriver: ScalarSeriesDriver;
  xPositionSeriesStagingMode: 'fixed' | 'range';

  // Y Position Series Mode
  yPositionSeriesItems: ScalarSeriesItem[];
  yPositionSeriesSelection: ScalarSeriesSelection;
  yPositionSeriesExhaustion: ScalarSeriesExhaustion;
  yPositionSeriesDriver: ScalarSeriesDriver;
  yPositionSeriesStagingMode: 'fixed' | 'range';

  // Polar position fields
  polarAngleMode: 'value' | 'range' | 'incremental' | 'series';
  polarAngleValue: number;
  polarAngleRange: [number, number];
  polarAngleStartValue: number;
  polarAngleIncrement: number;
  polarAngleModulationMode: 'off' | 'grid-col' | 'pixel-value' | 'shape-count';
  polarAngleModulationValue: number;

  // Polar Angle Series Mode
  polarAngleSeriesItems: ScalarSeriesItem[];
  polarAngleSeriesSelection: ScalarSeriesSelection;
  polarAngleSeriesExhaustion: ScalarSeriesExhaustion;
  polarAngleSeriesDriver: ScalarSeriesDriver;
  polarAngleSeriesStagingMode: 'fixed' | 'range';

  polarRadiusMode: 'value' | 'range' | 'incremental' | 'series';
  polarRadiusValue: number;
  polarRadiusRange: [number, number];
  polarRadiusStartValue: number;
  polarRadiusIncrement: number;
  polarRadiusModulationMode: 'off' | 'grid-col' | 'pixel-value' | 'shape-count';
  polarRadiusModulationValue: number;

  // Polar Radius Series Mode
  polarRadiusSeriesItems: ScalarSeriesItem[];
  polarRadiusSeriesSelection: ScalarSeriesSelection;
  polarRadiusSeriesExhaustion: ScalarSeriesExhaustion;
  polarRadiusSeriesDriver: ScalarSeriesDriver;
  polarRadiusSeriesStagingMode: 'fixed' | 'range';

  // Position reference anchor (defines artboard origin for position values)
  positionAnchorMode: 'fixed' | 'range' | 'incremental' | 'sequence';
  positionAnchorFixed: string;
  positionAnchorFrom: string;
  positionAnchorTo: string;
  positionAnchorSequence: string[];
  positionAnchorIncrementalStart: number;
  positionAnchorIncrementalStep: number;
  positionRotateToDirection: boolean;
  
  // Rectangle-specific Properties
  rectangleCornerRadiusMode: 'range' | 'define' | 'incremental' | 'series';
  rectangleCornerRadiusRange: [number, number];
  rectangleCornerRadiusDefine: number;
  rectangleCornerRadiusStartValue: number;
  rectangleCornerRadiusIncrement: number;
  rectangleCornerRadiusModulationEnabled: boolean;
  rectangleCornerRadiusModulationValue: number;
  rectangleCornerRadiusIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for corner radius incremental mode

  // Rectangle Corner Radius Series Mode
  rectangleCornerRadiusSeriesItems: ScalarSeriesItem[];
  rectangleCornerRadiusSeriesSelection: ScalarSeriesSelection;
  rectangleCornerRadiusSeriesExhaustion: ScalarSeriesExhaustion;
  rectangleCornerRadiusSeriesDriver: ScalarSeriesDriver;
  rectangleCornerRadiusSeriesStagingMode: 'fixed' | 'range';
  
  // Star-specific Properties
  starInnerRadiusMode: 'range' | 'define' | 'incremental' | 'series';
  starInnerRadiusRange: [number, number];
  starInnerRadiusDefine: number;
  starInnerRadiusStartValue: number;
  starInnerRadiusIncrement: number;
  starInnerRadiusModulationEnabled: boolean;
  starInnerRadiusModulationValue: number;
  starInnerRadiusIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for star inner radius incremental mode

  // Star Inner Radius Series Mode
  starInnerRadiusSeriesItems: ScalarSeriesItem[];
  starInnerRadiusSeriesSelection: ScalarSeriesSelection;
  starInnerRadiusSeriesExhaustion: ScalarSeriesExhaustion;
  starInnerRadiusSeriesDriver: ScalarSeriesDriver;
  starInnerRadiusSeriesStagingMode: 'fixed' | 'range';
  
  // Ring-specific Properties
  ringInnerRadiusMode: 'range' | 'define' | 'incremental' | 'series';
  ringInnerRadiusRange: [number, number];
  ringInnerRadiusDefine: number;
  ringInnerRadiusStartValue: number;
  ringInnerRadiusIncrement: number;
  ringInnerRadiusModulationEnabled: boolean;
  ringInnerRadiusModulationValue: number;
  ringInnerRadiusIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for ring inner radius incremental mode

  // Ring Inner Radius Series Mode
  ringInnerRadiusSeriesItems: ScalarSeriesItem[];
  ringInnerRadiusSeriesSelection: ScalarSeriesSelection;
  ringInnerRadiusSeriesExhaustion: ScalarSeriesExhaustion;
  ringInnerRadiusSeriesDriver: ScalarSeriesDriver;
  ringInnerRadiusSeriesStagingMode: 'fixed' | 'range';
  
  // Fill Properties - Controls solid vs gradient vs pattern
  fillEnabled: boolean;
  fillSolidEnabled: boolean; // Enable/disable solid fill section
  fillStyleProbability: number; // 0-100% - probability for solid fill vs gradient fill
  
  // Fill Color Settings (for solid fills)
  fillColorMode: 'range' | 'palette' | 'define' | 'series';
  fillColorRange: [string, string]; // For range mode (HSL interpolation)
  fillColorRangeFlip: boolean; // Toggle to flip color range direction (short vs long path around hue wheel)
  fillColorPalette: string[]; // For palette mode
  fillColorPaletteBehavior: 'cycle' | 'blend';
  fillColorPaletteDistribution: 'manual' | 'even' | 'logarithmic' | 'exponential';
  fillColorPaletteInterpolation: 'linear' | 'sine' | 'exponential' | 'logarithmic' | 'bounce' | 'zigzag' | 'sawtooth';
  fillColorPaletteAssignments: { shapeNumber: number; paletteIndex: number }[];
  fillColorDefine: string; // For define mode
  // Additional HSL controls for range mode
  fillColorSaturationMode: 'fixed' | 'range'; // Whether saturation is fixed or a range
  fillColorSaturationFixed: number; // 0-100% for fixed mode
  fillColorSaturationRange: [number, number]; // 0-100% for range mode
  fillColorLightnessMode: 'fixed' | 'range'; // Whether lightness is fixed or a range
  fillColorLightnessFixed: number; // 0-100% for fixed mode
  fillColorLightnessRange: [number, number]; // 0-100% for range mode
  
  // Fill Gradient Settings
  fillGradientEnabled: boolean; // Enable/disable gradients
  // Individual gradient type probabilities (must sum to 100 when enabled)
  fillGradientLinearProbability: number; // 0-100% probability for linear gradients
  fillGradientRadialProbability: number; // 0-100% probability for radial gradients
  fillGradientConicProbability: number; // 0-100% probability for conic gradients
  fillGradientDiamondProbability: number; // 0-100% probability for diamond gradients
  
  fillGradientColorMode: 'range' | 'palette' | 'define';
  fillGradientColorRange: [string, string]; // For range mode (HSL interpolation)
  fillGradientColorRangeFlip: boolean; // Toggle to flip color range direction (short vs long path around hue wheel)
  fillGradientColorPalette: string[]; // For palette mode
  fillGradientColorDefine: string[]; // For define mode - array based on max stops
  // Additional HSL controls for range mode
  fillGradientColorSaturationRange: [number, number]; // 0-100% for range mode
  fillGradientColorLightnessRange: [number, number]; // 0-100% for range mode
  fillGradientStopsMode: 'fixed' | 'range'; // Mode for color stops count
  fillGradientStopsCount: number; // Fixed mode: exact number of color stops
  fillGradientStopsRange: [number, number]; // Range mode: min-max color stops
  // Stop Position Distribution Controls
  fillGradientStopDistribution: 'even' | 'random'; // How stops are positioned
  fillGradientStopsReverse: boolean; // Reverse the color order of stops
  // Enhanced Gradient Type & Direction Controls
  fillGradientLinearDirection: 'fixed' | 'range' | 'predefined' | 'series'; // Linear direction mode
  fillGradientLinearAngle: number; // Fixed mode: exact angle in degrees
  fillGradientLinearAngleRange: [number, number]; // Range mode: min-max angle range
  fillGradientLinearPredefined: 'horizontal' | 'vertical' | 'diagonal-down' | 'diagonal-up'; // Predefined directions
  fillGradientLinearAlignToShape: boolean; // Whether to align gradient to shape orientation/rotation
  // Series mode
  fillGradientLinearSeriesItems: Array<{
    direction: 'fixed' | 'range' | 'predefined';
    angle?: number;
    angleRange?: [number, number];
    predefined?: string;
  }>;
  fillGradientLinearSeriesMixed: boolean; // Allow mixed modes in series
  fillGradientLinearSeriesStagingMode: 'fixed' | 'range' | 'predefined'; // Mode for staging area when mixed is on
  fillGradientLinearSeriesSelection: 'sequential' | 'random';
  fillGradientLinearSeriesExhaustion: 'cycle' | 'bounce';
  fillGradientLinearSeriesDriver: 'shape-index' | 'set-rep-index';
  fillGradientLinearCenter: 'center' | 'corners' | 'midpoints' | 'coordinates';
  fillGradientLinearCorners: { topLeft: boolean; topRight: boolean; bottomLeft: boolean; bottomRight: boolean };
  fillGradientLinearMidpoints: { top: boolean; right: boolean; bottom: boolean; left: boolean };
  fillGradientLinearSelectionMode: 'random' | 'cycle';
  fillGradientLinearCenterXMode: 'fixed' | 'range' | 'incremental' | 'series';
  fillGradientLinearCenterX: number;
  fillGradientLinearCenterXRange: [number, number];
  fillGradientLinearCenterXStartValue: number;
  fillGradientLinearCenterXIncrement: number;
  fillGradientLinearCenterXModulationEnabled: boolean;
  fillGradientLinearCenterXModulationValue: number;
  fillGradientLinearCenterXSeriesItems: ScalarSeriesItem[];
  fillGradientLinearCenterXSeriesSelection: ScalarSeriesSelection;
  fillGradientLinearCenterXSeriesExhaustion: ScalarSeriesExhaustion;
  fillGradientLinearCenterXSeriesDriver: ScalarSeriesDriver;
  fillGradientLinearCenterXSeriesStagingMode: 'fixed' | 'range';
  fillGradientLinearCenterYMode: 'fixed' | 'range' | 'incremental' | 'series';
  fillGradientLinearCenterY: number;
  fillGradientLinearCenterYRange: [number, number];
  fillGradientLinearCenterYStartValue: number;
  fillGradientLinearCenterYIncrement: number;
  fillGradientLinearCenterYModulationEnabled: boolean;
  fillGradientLinearCenterYModulationValue: number;
  fillGradientLinearCenterYSeriesItems: ScalarSeriesItem[];
  fillGradientLinearCenterYSeriesSelection: ScalarSeriesSelection;
  fillGradientLinearCenterYSeriesExhaustion: ScalarSeriesExhaustion;
  fillGradientLinearCenterYSeriesDriver: ScalarSeriesDriver;
  fillGradientLinearCenterYSeriesStagingMode: 'fixed' | 'range';
  fillGradientLinearScaleMode: 'fixed' | 'range' | 'incremental' | 'series';
  fillGradientLinearScale: number;
  fillGradientLinearScaleRange: [number, number];
  fillGradientLinearScaleStartValue: number;
  fillGradientLinearScaleIncrement: number;
  fillGradientLinearScaleSeriesItems: ScalarSeriesItem[];
  fillGradientLinearScaleSeriesSelection: ScalarSeriesSelection;
  fillGradientLinearScaleSeriesExhaustion: ScalarSeriesExhaustion;
  fillGradientLinearScaleSeriesDriver: ScalarSeriesDriver;
  fillGradientLinearScaleSeriesStagingMode: 'fixed' | 'range';
  fillGradientRadialCenter: 'center' | 'corners' | 'midpoints' | 'coordinates'; // Radial center positioning
  
  // Radial Gradient Center X (0-100% of shape bounds)
  fillGradientRadialCenterXMode: 'fixed' | 'range' | 'incremental' | 'series';
  fillGradientRadialCenterX: number; // Fixed mode value
  fillGradientRadialCenterXRange: [number, number]; // Range mode min/max
  fillGradientRadialCenterXStartValue: number; // Incremental mode start
  fillGradientRadialCenterXIncrement: number; // Incremental mode step
  fillGradientRadialCenterXModulationEnabled: boolean; // Enable modulation
  fillGradientRadialCenterXModulationValue: number; // Modulation value
  fillGradientRadialCenterXSeriesItems: ScalarSeriesItem[];
  fillGradientRadialCenterXSeriesSelection: ScalarSeriesSelection;
  fillGradientRadialCenterXSeriesExhaustion: ScalarSeriesExhaustion;
  fillGradientRadialCenterXSeriesDriver: ScalarSeriesDriver;
  fillGradientRadialCenterXSeriesStagingMode: 'fixed' | 'range';
  
  // Radial Gradient Center Y (0-100% of shape bounds)
  fillGradientRadialCenterYMode: 'fixed' | 'range' | 'incremental' | 'series';
  fillGradientRadialCenterY: number; // Fixed mode value
  fillGradientRadialCenterYRange: [number, number]; // Range mode min/max
  fillGradientRadialCenterYStartValue: number; // Incremental mode start
  fillGradientRadialCenterYIncrement: number; // Incremental mode step
  fillGradientRadialCenterYModulationEnabled: boolean; // Enable modulation
  fillGradientRadialCenterYModulationValue: number; // Modulation value
  fillGradientRadialCenterYSeriesItems: ScalarSeriesItem[];
  fillGradientRadialCenterYSeriesSelection: ScalarSeriesSelection;
  fillGradientRadialCenterYSeriesExhaustion: ScalarSeriesExhaustion;
  fillGradientRadialCenterYSeriesDriver: ScalarSeriesDriver;
  fillGradientRadialCenterYSeriesStagingMode: 'fixed' | 'range';
  fillGradientRadialScaleMode: 'fixed' | 'range' | 'incremental' | 'series';
  fillGradientRadialScale: number;
  fillGradientRadialScaleRange: [number, number];
  fillGradientRadialScaleStartValue: number;
  fillGradientRadialScaleIncrement: number;
  fillGradientRadialScaleSeriesItems: ScalarSeriesItem[];
  fillGradientRadialScaleSeriesSelection: ScalarSeriesSelection;
  fillGradientRadialScaleSeriesExhaustion: ScalarSeriesExhaustion;
  fillGradientRadialScaleSeriesDriver: ScalarSeriesDriver;
  fillGradientRadialScaleSeriesStagingMode: 'fixed' | 'range';
  fillGradientRadialCorners: {
    topLeft: boolean;
    topRight: boolean;
    bottomLeft: boolean;
    bottomRight: boolean;
  }; // Which corners can be selected
  fillGradientRadialMidpoints: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  }; // Which midpoints can be selected
  fillGradientRadialSelectionMode: 'random' | 'cycle'; // How to select from enabled corners/midpoints
  fillGradientRadialShape: 'circle' | 'ellipse' | 'auto'; // Radial gradient shape
  fillGradientRadialCircleProbability: number; // 0-100% probability for circle shape
  fillGradientRadialEllipseProbability: number; // 0-100% probability for ellipse shape
  fillGradientMatchShape: boolean; // Whether gradient type should match shape type
  fillGradientTypeDirectionEnabled: boolean; // Whether the Gradient Type & Direction section overrides main gradient probabilities

  // Diamond Gradient Position
  fillGradientDiamondCenter: 'center' | 'corners' | 'midpoints' | 'coordinates';
  fillGradientDiamondCorners: { topLeft: boolean; topRight: boolean; bottomLeft: boolean; bottomRight: boolean; };
  fillGradientDiamondMidpoints: { top: boolean; right: boolean; bottom: boolean; left: boolean; };
  fillGradientDiamondSelectionMode: 'random' | 'cycle';

  // Diamond Gradient Angle
  fillGradientDiamondAngleMode: 'fixed' | 'range' | 'incremental' | 'series';
  fillGradientDiamondAngle: number;
  fillGradientDiamondAngleRange: [number, number];
  fillGradientDiamondAngleStartValue: number;
  fillGradientDiamondAngleIncrement: number;
  fillGradientDiamondAngleModulationEnabled: boolean;
  fillGradientDiamondAngleModulationValue: number;
  fillGradientDiamondAngleModulationBounce: boolean;
  fillGradientDiamondAngleSeriesItems: ScalarSeriesItem[];
  fillGradientDiamondAngleSeriesSelection: ScalarSeriesSelection;
  fillGradientDiamondAngleSeriesExhaustion: ScalarSeriesExhaustion;
  fillGradientDiamondAngleSeriesDriver: ScalarSeriesDriver;
  fillGradientDiamondAngleSeriesStagingMode: 'fixed' | 'range';

  // Diamond Gradient Center X (for Coordinates mode)
  fillGradientDiamondCenterXMode: 'fixed' | 'range' | 'incremental' | 'series';
  fillGradientDiamondCenterX: number;
  fillGradientDiamondCenterXRange: [number, number];
  fillGradientDiamondCenterXStartValue: number;
  fillGradientDiamondCenterXIncrement: number;
  fillGradientDiamondCenterXModulationEnabled: boolean;
  fillGradientDiamondCenterXModulationValue: number;
  fillGradientDiamondCenterXSeriesItems: ScalarSeriesItem[];
  fillGradientDiamondCenterXSeriesSelection: ScalarSeriesSelection;
  fillGradientDiamondCenterXSeriesExhaustion: ScalarSeriesExhaustion;
  fillGradientDiamondCenterXSeriesDriver: ScalarSeriesDriver;
  fillGradientDiamondCenterXSeriesStagingMode: 'fixed' | 'range';

  // Diamond Gradient Center Y (for Coordinates mode)
  fillGradientDiamondCenterYMode: 'fixed' | 'range' | 'incremental' | 'series';
  fillGradientDiamondCenterY: number;
  fillGradientDiamondCenterYRange: [number, number];
  fillGradientDiamondCenterYStartValue: number;
  fillGradientDiamondCenterYIncrement: number;
  fillGradientDiamondCenterYModulationEnabled: boolean;
  fillGradientDiamondCenterYModulationValue: number;
  fillGradientDiamondCenterYSeriesItems: ScalarSeriesItem[];
  fillGradientDiamondCenterYSeriesSelection: ScalarSeriesSelection;
  fillGradientDiamondCenterYSeriesExhaustion: ScalarSeriesExhaustion;
  fillGradientDiamondCenterYSeriesDriver: ScalarSeriesDriver;
  fillGradientDiamondCenterYSeriesStagingMode: 'fixed' | 'range';
  fillGradientDiamondScaleMode: 'fixed' | 'range' | 'incremental' | 'series';
  fillGradientDiamondScale: number;
  fillGradientDiamondScaleRange: [number, number];
  fillGradientDiamondScaleStartValue: number;
  fillGradientDiamondScaleIncrement: number;
  fillGradientDiamondScaleSeriesItems: ScalarSeriesItem[];
  fillGradientDiamondScaleSeriesSelection: ScalarSeriesSelection;
  fillGradientDiamondScaleSeriesExhaustion: ScalarSeriesExhaustion;
  fillGradientDiamondScaleSeriesDriver: ScalarSeriesDriver;
  fillGradientDiamondScaleSeriesStagingMode: 'fixed' | 'range';
  fillGradientDiamondScaleEdgeMode: 'streak' | 'repeat';
  gradientScaleIncrementalIndexDriver: IncrementalIndexDriver;

  // Conic gradient controls
  fillGradientConicCenter: 'center' | 'corners' | 'midpoints' | 'coordinates'; // Conic center positioning (matching radial structure)
  fillGradientConicCorners: {
    topLeft: boolean;
    topRight: boolean;
    bottomLeft: boolean;
    bottomRight: boolean;
  }; // Which corners can be selected
  fillGradientConicMidpoints: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  }; // Which midpoints can be selected
  fillGradientConicSelectionMode: 'random' | 'cycle'; // How to select from enabled corners/midpoints
  
  // Conic Gradient Start Angle (0-360°)
  fillGradientConicAngleMode: 'fixed' | 'range' | 'incremental' | 'series';
  fillGradientConicAngle: number; // Fixed mode value
  fillGradientConicAngleRange: [number, number]; // Range mode min/max
  fillGradientConicAngleStartValue: number; // Incremental mode start
  fillGradientConicAngleIncrement: number; // Incremental mode step
  fillGradientConicAngleModulationEnabled: boolean; // Enable modulation
  fillGradientConicAngleModulationValue: number; // Modulation value (wraps at this value)
  fillGradientConicAngleModulationBounce: boolean;
  fillGradientConicAngleSeriesItems: ScalarSeriesItem[];
  fillGradientConicAngleSeriesSelection: ScalarSeriesSelection;
  fillGradientConicAngleSeriesExhaustion: ScalarSeriesExhaustion;
  fillGradientConicAngleSeriesDriver: ScalarSeriesDriver;
  fillGradientConicAngleSeriesStagingMode: 'fixed' | 'range';
  
  // Conic Gradient Center X (0-100% of shape bounds)
  fillGradientConicCenterXMode: 'fixed' | 'range' | 'incremental' | 'series';
  fillGradientConicCenterX: number; // Fixed mode value
  fillGradientConicCenterXRange: [number, number]; // Range mode min/max
  fillGradientConicCenterXStartValue: number; // Incremental mode start
  fillGradientConicCenterXIncrement: number; // Incremental mode step
  fillGradientConicCenterXModulationEnabled: boolean; // Enable modulation
  fillGradientConicCenterXModulationValue: number; // Modulation value
  fillGradientConicCenterXSeriesItems: ScalarSeriesItem[];
  fillGradientConicCenterXSeriesSelection: ScalarSeriesSelection;
  fillGradientConicCenterXSeriesExhaustion: ScalarSeriesExhaustion;
  fillGradientConicCenterXSeriesDriver: ScalarSeriesDriver;
  fillGradientConicCenterXSeriesStagingMode: 'fixed' | 'range';
  
  // Conic Gradient Center Y (0-100% of shape bounds)
  fillGradientConicCenterYMode: 'fixed' | 'range' | 'incremental' | 'series';
  fillGradientConicCenterY: number; // Fixed mode value
  fillGradientConicCenterYRange: [number, number]; // Range mode min/max
  fillGradientConicCenterYStartValue: number; // Incremental mode start
  fillGradientConicCenterYIncrement: number; // Incremental mode step
  fillGradientConicCenterYModulationEnabled: boolean; // Enable modulation
  fillGradientConicCenterYModulationValue: number; // Modulation value
  fillGradientConicCenterYSeriesItems: ScalarSeriesItem[];
  fillGradientConicCenterYSeriesSelection: ScalarSeriesSelection;
  fillGradientConicCenterYSeriesExhaustion: ScalarSeriesExhaustion;
  fillGradientConicCenterYSeriesDriver: ScalarSeriesDriver;
  fillGradientConicCenterYSeriesStagingMode: 'fixed' | 'range';
  gradientCenterIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for gradient center incremental modes (radial/conic)
  
  // Fill Opacity Settings
  fillOpacityEnabled: boolean;
  fillOpacityMode: 'range' | 'define' | 'incremental' | 'palette' | 'series';
  fillOpacityRange: [number, number]; // For range mode
  fillOpacityDefine: number; // For define mode
  fillOpacityPalette: number[]; // For palette mode (discrete opacity values shapes cycle through)
  fillOpacityStartValue: number; // For incremental mode
  fillOpacityIncrement: number; // For incremental mode
  fillOpacityModulationEnabled: boolean; // Enable modulation
  fillOpacityModulationValue: number; // Modulation value
  fillOpacityModulationBounce: boolean;
  fillOpacityIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for fill opacity incremental mode
  fillOpacitySeriesItems: ScalarSeriesItem[];
  fillOpacitySeriesSelection: ScalarSeriesSelection;
  fillOpacitySeriesExhaustion: ScalarSeriesExhaustion;
  fillOpacitySeriesDriver: ScalarSeriesDriver;
  fillOpacitySeriesStagingMode: 'fixed' | 'range';
  openCurveFillProbability: number; // 0-100% probability that open curves receive fill (100 = always fill)
  
  // Blur Properties
  blurEnabled: boolean;
  blurType: 'box' | 'gaussian';
  blurProbability: number; // 0-100%
  blurMode: 'range' | 'define' | 'incremental' | 'series';
  blurRange: [number, number]; // For range mode (e.g., [2, 15])
  blurDefine: number; // For define mode (e.g., 8)
  blurStartValue: number; // For incremental mode
  blurIncrement: number; // For incremental mode
  blurModulationEnabled: boolean; // Enable modulation
  blurModulationValue: number; // Modulation value
  blurStartOffset: number; // Per-cycle start shift for blur modulation
  blurStartOffsetCompound: boolean; // If true, offset grows quadratically with wrap count
  blurWrapOffset: number; // Per-cycle shift applied to the wrap threshold for blur modulation
  blurWrapOffsetCompound: boolean;
  blurModulationBounce: boolean;
  blurIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for blur incremental mode
  blurSeriesItems: ScalarSeriesItem[];
  blurSeriesSelection: ScalarSeriesSelection;
  blurSeriesExhaustion: ScalarSeriesExhaustion;
  blurSeriesDriver: ScalarSeriesDriver;
  blurSeriesStagingMode: 'fixed' | 'range';
  
  // Drop Shadow Properties
  dropShadowEnabled: boolean;
  dropShadowProbability: number; // 0-100%
  dropShadowColorMode: 'auto' | 'custom'; // auto = derive from shape color
  dropShadowCustomColor: string; // Custom color when colorMode is 'custom'
  dropShadowColorDarken: number; // For auto mode - how much to darken (0-100%)
  dropShadowBlendMode: 'multiply' | 'darken' | 'overlay'; // Blend modes for shadows
  dropShadowOffsetXMode: 'range' | 'define' | 'incremental' | 'series';
  dropShadowOffsetX: number; // Fixed value
  dropShadowOffsetXRange: [number, number]; // Range mode
  dropShadowOffsetXStartValue: number; // Incremental mode
  dropShadowOffsetXIncrement: number;
  dropShadowOffsetXSeriesItems: ScalarSeriesItem[];
  dropShadowOffsetXSeriesSelection: ScalarSeriesSelection;
  dropShadowOffsetXSeriesExhaustion: ScalarSeriesExhaustion;
  dropShadowOffsetXSeriesDriver: ScalarSeriesDriver;
  dropShadowOffsetXSeriesStagingMode: 'fixed' | 'range';
  dropShadowOffsetYMode: 'range' | 'define' | 'incremental' | 'series';
  dropShadowOffsetY: number; // Fixed value
  dropShadowOffsetYRange: [number, number]; // Range mode
  dropShadowOffsetYStartValue: number; // Incremental mode
  dropShadowOffsetYIncrement: number;
  dropShadowOffsetYSeriesItems: ScalarSeriesItem[];
  dropShadowOffsetYSeriesSelection: ScalarSeriesSelection;
  dropShadowOffsetYSeriesExhaustion: ScalarSeriesExhaustion;
  dropShadowOffsetYSeriesDriver: ScalarSeriesDriver;
  dropShadowOffsetYSeriesStagingMode: 'fixed' | 'range';
  dropShadowBlurMode: 'range' | 'define' | 'incremental' | 'series';
  dropShadowBlur: number; // Fixed value
  dropShadowBlurRange: [number, number]; // Range mode
  dropShadowBlurStartValue: number; // Incremental mode
  dropShadowBlurIncrement: number;
  dropShadowBlurSeriesItems: ScalarSeriesItem[];
  dropShadowBlurSeriesSelection: ScalarSeriesSelection;
  dropShadowBlurSeriesExhaustion: ScalarSeriesExhaustion;
  dropShadowBlurSeriesDriver: ScalarSeriesDriver;
  dropShadowBlurSeriesStagingMode: 'fixed' | 'range';
  dropShadowSpreadMode: 'range' | 'define' | 'incremental' | 'series';
  dropShadowSpread: number; // Fixed value
  dropShadowSpreadRange: [number, number]; // Range mode
  dropShadowSpreadStartValue: number; // Incremental mode
  dropShadowSpreadIncrement: number;
  dropShadowSpreadSeriesItems: ScalarSeriesItem[];
  dropShadowSpreadSeriesSelection: ScalarSeriesSelection;
  dropShadowSpreadSeriesExhaustion: ScalarSeriesExhaustion;
  dropShadowSpreadSeriesDriver: ScalarSeriesDriver;
  dropShadowSpreadSeriesStagingMode: 'fixed' | 'range';
  dropShadowOpacity: number; // 0-100%
  dropShadowIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for all drop shadow incremental properties
  
  // Outer Glow Properties
  outerGlowEnabled: boolean;
  outerGlowProbability: number; // 0-100%
  outerGlowColorMode: 'auto' | 'custom'; // auto = derive from shape color
  outerGlowCustomColor: string; // Custom color when colorMode is 'custom'
  outerGlowColorSaturate: number; // For auto mode - boost saturation (0-100%)
  outerGlowBlendMode: 'screen' | 'add' | 'soft-light' | 'color-dodge' | 'lighter'; // Blend modes for glows
  outerGlowBlurMode: 'range' | 'define' | 'incremental' | 'series';
  outerGlowBlur: number; // Fixed value
  outerGlowBlurRange: [number, number]; // Range mode
  outerGlowBlurStartValue: number; // Incremental mode
  outerGlowBlurIncrement: number;
  outerGlowBlurSeriesItems: ScalarSeriesItem[];
  outerGlowBlurSeriesSelection: ScalarSeriesSelection;
  outerGlowBlurSeriesExhaustion: ScalarSeriesExhaustion;
  outerGlowBlurSeriesDriver: ScalarSeriesDriver;
  outerGlowBlurSeriesStagingMode: 'fixed' | 'range';
  outerGlowSpreadMode: 'range' | 'define' | 'incremental' | 'series';
  outerGlowSpread: number; // Fixed value
  outerGlowSpreadRange: [number, number]; // Range mode
  outerGlowSpreadStartValue: number; // Incremental mode
  outerGlowSpreadIncrement: number;
  outerGlowSpreadSeriesItems: ScalarSeriesItem[];
  outerGlowSpreadSeriesSelection: ScalarSeriesSelection;
  outerGlowSpreadSeriesExhaustion: ScalarSeriesExhaustion;
  outerGlowSpreadSeriesDriver: ScalarSeriesDriver;
  outerGlowSpreadSeriesStagingMode: 'fixed' | 'range';
  outerGlowOpacity: number; // 0-100%
  outerGlowIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for all outer glow incremental properties
  
  // Inner Shadow Properties
  innerShadowEnabled: boolean;
  innerShadowProbability: number; // 0-100%
  innerShadowColorMode: 'auto' | 'custom'; // auto = derive from shape color
  innerShadowCustomColor: string; // Custom color when colorMode is 'custom'
  innerShadowColorDarken: number; // For auto mode - how much to darken (0-100%)
  innerShadowBlendMode: 'multiply' | 'darken' | 'overlay'; // Blend modes for shadows
  innerShadowOffsetXMode: 'range' | 'define' | 'incremental' | 'series';
  innerShadowOffsetX: number; // Fixed value
  innerShadowOffsetXRange: [number, number]; // Range mode
  innerShadowOffsetXStartValue: number; // Incremental mode
  innerShadowOffsetXIncrement: number;
  innerShadowOffsetXSeriesItems: ScalarSeriesItem[];
  innerShadowOffsetXSeriesSelection: ScalarSeriesSelection;
  innerShadowOffsetXSeriesExhaustion: ScalarSeriesExhaustion;
  innerShadowOffsetXSeriesDriver: ScalarSeriesDriver;
  innerShadowOffsetXSeriesStagingMode: 'fixed' | 'range';
  innerShadowOffsetYMode: 'range' | 'define' | 'incremental' | 'series';
  innerShadowOffsetY: number; // Fixed value
  innerShadowOffsetYRange: [number, number]; // Range mode
  innerShadowOffsetYStartValue: number; // Incremental mode
  innerShadowOffsetYIncrement: number;
  innerShadowOffsetYSeriesItems: ScalarSeriesItem[];
  innerShadowOffsetYSeriesSelection: ScalarSeriesSelection;
  innerShadowOffsetYSeriesExhaustion: ScalarSeriesExhaustion;
  innerShadowOffsetYSeriesDriver: ScalarSeriesDriver;
  innerShadowOffsetYSeriesStagingMode: 'fixed' | 'range';
  innerShadowBlurMode: 'range' | 'define' | 'incremental' | 'series';
  innerShadowBlur: number; // Fixed value
  innerShadowBlurRange: [number, number]; // Range mode
  innerShadowBlurStartValue: number; // Incremental mode
  innerShadowBlurIncrement: number;
  innerShadowBlurSeriesItems: ScalarSeriesItem[];
  innerShadowBlurSeriesSelection: ScalarSeriesSelection;
  innerShadowBlurSeriesExhaustion: ScalarSeriesExhaustion;
  innerShadowBlurSeriesDriver: ScalarSeriesDriver;
  innerShadowBlurSeriesStagingMode: 'fixed' | 'range';
  innerShadowOpacity: number; // 0-100%
  innerShadowIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for all inner shadow incremental properties
  
  // Inner Glow Properties
  innerGlowEnabled: boolean;
  innerGlowProbability: number; // 0-100%
  innerGlowColorMode: 'auto' | 'custom'; // auto = derive from shape color
  innerGlowCustomColor: string; // Custom color when colorMode is 'custom'
  innerGlowColorSaturate: number; // For auto mode - boost saturation (0-100%)
  innerGlowBlendMode: 'screen' | 'add' | 'soft-light' | 'color-dodge' | 'lighter'; // Blend modes for glows
  innerGlowBlurMode: 'range' | 'define' | 'incremental' | 'series';
  innerGlowBlur: number; // Fixed value
  innerGlowBlurRange: [number, number]; // Range mode
  innerGlowBlurStartValue: number; // Incremental mode
  innerGlowBlurIncrement: number;
  innerGlowBlurSeriesItems: ScalarSeriesItem[];
  innerGlowBlurSeriesSelection: ScalarSeriesSelection;
  innerGlowBlurSeriesExhaustion: ScalarSeriesExhaustion;
  innerGlowBlurSeriesDriver: ScalarSeriesDriver;
  innerGlowBlurSeriesStagingMode: 'fixed' | 'range';
  innerGlowSpreadMode: 'range' | 'define' | 'incremental' | 'series';
  innerGlowSpread: number; // Fixed value
  innerGlowSpreadRange: [number, number]; // Range mode
  innerGlowSpreadStartValue: number; // Incremental mode
  innerGlowSpreadIncrement: number;
  innerGlowSpreadSeriesItems: ScalarSeriesItem[];
  innerGlowSpreadSeriesSelection: ScalarSeriesSelection;
  innerGlowSpreadSeriesExhaustion: ScalarSeriesExhaustion;
  innerGlowSpreadSeriesDriver: ScalarSeriesDriver;
  innerGlowSpreadSeriesStagingMode: 'fixed' | 'range';
  innerGlowOpacity: number; // 0-100%
  innerGlowIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for all inner glow incremental properties
  
  // Stroke Properties  
  strokeEnabled: boolean;
  strokeProbability: number; // 0-100%
  strokeOnlyUnfilled: boolean; // When true, suppress stroke on any shape that has fill
  
  // Stroke Color Settings
  strokeColorMode: 'range' | 'palette' | 'define' | 'match-fill' | 'series';
  strokeColorRange: [string, string]; // For range mode (HSL interpolation)
  strokeColorRangeFlip: boolean; // Toggle to flip color range direction (short vs long path around hue wheel)
  strokeColorPalette: string[]; // For palette mode
  strokeColorDefine: string; // For define mode
  // Additional HSL controls for range mode
  strokeColorSaturationMode: 'fixed' | 'range' | 'match-fill'; // Method for saturation
  strokeColorSaturationFixed: number; // 0-100% for fixed mode
  strokeColorSaturationRange: [number, number]; // 0-100% for range mode
  strokeColorLightnessMode: 'fixed' | 'range' | 'match-fill'; // Method for lightness
  strokeColorLightnessFixed: number; // 0-100% for fixed mode
  strokeColorLightnessRange: [number, number]; // 0-100% for range mode
  strokeColorEnabled: boolean; // Enable/disable stroke color configuration
  
  // Stroke Opacity Settings
  strokeOpacityEnabled: boolean;
  strokeOpacityMode: 'range' | 'define' | 'incremental' | 'match-fill' | 'palette' | 'series';
  strokeOpacityRange: [number, number]; // For range mode
  strokeOpacityDefine: number; // For define mode
  strokeOpacityPalette: number[]; // For palette mode (discrete opacity values shapes cycle through)
  strokeOpacityStartValue: number; // For incremental mode
  strokeOpacityIncrement: number; // For incremental mode
  strokeOpacityModulationEnabled: boolean; // Enable modulation
  strokeOpacityModulationValue: number; // Modulation value
  strokeOpacityModulationBounce: boolean;
  strokeOpacitySeriesItems: ScalarSeriesItem[];
  strokeOpacitySeriesSelection: ScalarSeriesSelection;
  strokeOpacitySeriesExhaustion: ScalarSeriesExhaustion;
  strokeOpacitySeriesDriver: ScalarSeriesDriver;
  strokeOpacitySeriesStagingMode: 'fixed' | 'range';
  
  // Stroke Width Settings
  strokeWidthEnabled: boolean;
  strokeWidthMode: 'range' | 'define' | 'incremental' | 'parameterised' | 'series';
  strokeWidthRange: [number, number];
  strokeWidthDefine: number; // For define mode
  strokeWidthStartValue: number; // For incremental mode
  strokeWidthIncrement: number; // For incremental mode
  strokeWidthModulationEnabled: boolean; // Enable modulation
  strokeWidthModulationValue: number; // Modulation value
  strokeWidthModulationBounce: boolean;
  strokeIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for stroke opacity/width incremental modes
  strokeWidthSeriesItems: ScalarSeriesItem[];
  strokeWidthSeriesSelection: ScalarSeriesSelection;
  strokeWidthSeriesExhaustion: ScalarSeriesExhaustion;
  strokeWidthSeriesDriver: ScalarSeriesDriver;
  strokeWidthSeriesStagingMode: 'fixed' | 'range';

  // Stroke Profile (used when strokeWidthMode === 'parameterised')
  strokeProfileType: 'ramp-asc' | 'ramp-desc' | 'wave' | 'hump-smooth' | 'hump-sharp' | 'zigzag';
  strokeProfileFrequency: number;   // Cycles along the contour (e.g. 1 = one full wave)
  strokeProfilePhaseOffset: number; // Phase offset in radians
  strokeProfileScale: number;       // Variation strength 0..1

  // Stroke Pattern
  strokePattern: 'none' | 'dash' | 'dot' | 'squiggle';
  strokeDashLength: number;          // px — length of each dash
  strokeDashGap: number;             // px — gap between dashes
  strokeDotSpacing: number;          // px — spacing between dot centres
  // Squiggle stroke — each numeric parameter has its own value-mode sub-fields
  strokeSquiggleAmplitudeMode: 'range' | 'define' | 'incremental' | 'series';
  strokeSquiggleAmplitudeRange: [number, number];
  strokeSquiggleAmplitudeDefine: number;
  strokeSquiggleAmplitudeStartValue: number;
  strokeSquiggleAmplitudeIncrement: number;
  strokeSquiggleAmplitudeModulationEnabled: boolean;
  strokeSquiggleAmplitudeModulationValue: number;
  strokeSquiggleAmplitudeSeriesItems: ScalarSeriesItem[];
  strokeSquiggleAmplitudeSeriesSelection: ScalarSeriesSelection;
  strokeSquiggleAmplitudeSeriesExhaustion: ScalarSeriesExhaustion;
  strokeSquiggleAmplitudeSeriesDriver: ScalarSeriesDriver;
  strokeSquiggleAmplitudeSeriesStagingMode: 'fixed' | 'range';
  strokeSquiggleFrequencyMode: 'range' | 'define' | 'incremental' | 'series';
  strokeSquiggleFrequencyRange: [number, number];
  strokeSquiggleFrequencyDefine: number;
  strokeSquiggleFrequencyStartValue: number;
  strokeSquiggleFrequencyIncrement: number;
  strokeSquiggleFrequencyModulationEnabled: boolean;
  strokeSquiggleFrequencyModulationValue: number;
  strokeSquiggleFrequencySeriesItems: ScalarSeriesItem[];
  strokeSquiggleFrequencySeriesSelection: ScalarSeriesSelection;
  strokeSquiggleFrequencySeriesExhaustion: ScalarSeriesExhaustion;
  strokeSquiggleFrequencySeriesDriver: ScalarSeriesDriver;
  strokeSquiggleFrequencySeriesStagingMode: 'fixed' | 'range';
  strokeSquigglePhaseMode: 'range' | 'define' | 'incremental' | 'series';
  strokeSquigglePhaseRange: [number, number];
  strokeSquigglePhaseDefine: number;
  strokeSquigglePhaseStartValue: number;
  strokeSquigglePhaseIncrement: number;
  strokeSquigglePhaseModulationEnabled: boolean;
  strokeSquigglePhaseModulationValue: number;
  strokeSquigglePhaseSeriesItems: ScalarSeriesItem[];
  strokeSquigglePhaseSeriesSelection: ScalarSeriesSelection;
  strokeSquigglePhaseSeriesExhaustion: ScalarSeriesExhaustion;
  strokeSquigglePhaseSeriesDriver: ScalarSeriesDriver;
  strokeSquigglePhaseSeriesStagingMode: 'fixed' | 'range';
  strokeSquiggleAlignMode: 'range' | 'define' | 'incremental' | 'series';
  strokeSquiggleAlignRange: [number, number];
  strokeSquiggleAlignDefine: number;
  strokeSquiggleAlignStartValue: number;
  strokeSquiggleAlignIncrement: number;
  strokeSquiggleAlignModulationEnabled: boolean;
  strokeSquiggleAlignModulationValue: number;
  strokeSquiggleAlignSeriesItems: ScalarSeriesItem[];
  strokeSquiggleAlignSeriesSelection: ScalarSeriesSelection;
  strokeSquiggleAlignSeriesExhaustion: ScalarSeriesExhaustion;
  strokeSquiggleAlignSeriesDriver: ScalarSeriesDriver;
  strokeSquiggleAlignSeriesStagingMode: 'fixed' | 'range';
  strokeSquiggleAbs: boolean;
  strokeSquiggleFlip: boolean;
  strokeSquigglePerturbType: 'jitter' | 'noise';
  strokeSquiggleJitterMode: 'range' | 'define' | 'incremental' | 'series';
  strokeSquiggleJitterRange: [number, number];
  strokeSquiggleJitterDefine: number;
  strokeSquiggleJitterStartValue: number;
  strokeSquiggleJitterIncrement: number;
  strokeSquiggleJitterModulationEnabled: boolean;
  strokeSquiggleJitterModulationValue: number;
  strokeSquiggleJitterSeriesItems: ScalarSeriesItem[];
  strokeSquiggleJitterSeriesSelection: ScalarSeriesSelection;
  strokeSquiggleJitterSeriesExhaustion: ScalarSeriesExhaustion;
  strokeSquiggleJitterSeriesDriver: ScalarSeriesDriver;
  strokeSquiggleJitterSeriesStagingMode: 'fixed' | 'range';
  strokeSquiggleJitterDir: 'normal' | 'xy';
  strokeSquiggleJitterSeedMode: 'range' | 'define' | 'incremental' | 'series';
  strokeSquiggleJitterSeedRange: [number, number];
  strokeSquiggleJitterSeedDefine: number;
  strokeSquiggleJitterSeedStartValue: number;
  strokeSquiggleJitterSeedIncrement: number;
  strokeSquiggleJitterSeedModulationEnabled: boolean;
  strokeSquiggleJitterSeedModulationValue: number;
  strokeSquiggleJitterSeedSeriesItems: ScalarSeriesItem[];
  strokeSquiggleJitterSeedSeriesSelection: ScalarSeriesSelection;
  strokeSquiggleJitterSeedSeriesExhaustion: ScalarSeriesExhaustion;
  strokeSquiggleJitterSeedSeriesDriver: ScalarSeriesDriver;
  strokeSquiggleJitterSeedSeriesStagingMode: 'fixed' | 'range';
  strokeSquiggleNoiseMode: 'range' | 'define' | 'incremental' | 'series';
  strokeSquiggleNoiseRange: [number, number];
  strokeSquiggleNoiseDefine: number;
  strokeSquiggleNoiseStartValue: number;
  strokeSquiggleNoiseIncrement: number;
  strokeSquiggleNoiseModulationEnabled: boolean;
  strokeSquiggleNoiseModulationValue: number;
  strokeSquiggleNoiseSeriesItems: ScalarSeriesItem[];
  strokeSquiggleNoiseSeriesSelection: ScalarSeriesSelection;
  strokeSquiggleNoiseSeriesExhaustion: ScalarSeriesExhaustion;
  strokeSquiggleNoiseSeriesDriver: ScalarSeriesDriver;
  strokeSquiggleNoiseSeriesStagingMode: 'fixed' | 'range';
  strokeSquiggleNoiseFreqMode: 'range' | 'define' | 'incremental' | 'series';
  strokeSquiggleNoiseFreqRange: [number, number];
  strokeSquiggleNoiseFreqDefine: number;
  strokeSquiggleNoiseFreqStartValue: number;
  strokeSquiggleNoiseFreqIncrement: number;
  strokeSquiggleNoiseFreqModulationEnabled: boolean;
  strokeSquiggleNoiseFreqModulationValue: number;
  strokeSquiggleNoiseFreqSeriesItems: ScalarSeriesItem[];
  strokeSquiggleNoiseFreqSeriesSelection: ScalarSeriesSelection;
  strokeSquiggleNoiseFreqSeriesExhaustion: ScalarSeriesExhaustion;
  strokeSquiggleNoiseFreqSeriesDriver: ScalarSeriesDriver;
  strokeSquiggleNoiseFreqSeriesStagingMode: 'fixed' | 'range';
  strokeSquiggleIncrementalIndexDriver: IncrementalIndexDriver;
  strokeSquiggleBounce: boolean;
  strokeSquiggleSampleMode: 'auto' | 'define' | 'range';
  strokeSquiggleSampleDefine: number;
  strokeSquiggleSampleRange: [number, number];
  strokeSquiggleUseCurveResample: boolean;
  strokeSquiggleSmoothCurves: boolean;

  // Polygon Shape Properties
  polygonPropertiesEnabled: boolean;
  segmentCountMode: 'range' | 'define' | 'incremental';
  segmentCountRange: [number, number];
  segmentCountDefine: number;
  segmentCountStartValue: number;
  segmentCountIncrement: number;
  segmentCountModulationEnabled: boolean;
  segmentCountModulationValue: number;
  polygonIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for polygon segment count incremental mode
  
  // Line Properties
  linePropertiesEnabled: boolean;
  pointCountMode: 'range' | 'define' | 'incremental';
  pointCountRange: [number, number];
  pointCountDefine: number;
  pointCountStartValue: number;
  pointCountIncrement: number;
  pointCountModulationEnabled: boolean;
  pointCountModulationValue: number;
  
  pointPositionMode: 'range' | 'define' | 'incremental';
  pointPositionRange: [number, number];
  pointPositionDefine: number;
  pointPositionStartValue: number;
  pointPositionIncrement: number;
  pointPositionModulationEnabled: boolean;
  pointPositionModulationValue: number;
  lineIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for line point count/position incremental modes
  
  // Spline Curve Properties
  splinePropertiesEnabled: boolean;
  splinePointCountMode: 'range' | 'define' | 'incremental';
  splinePointCountRange: [number, number];
  splinePointCountDefine: number;
  splinePointCountStartValue: number;
  splinePointCountIncrement: number;
  splinePointCountModulationEnabled: boolean;
  splinePointCountModulationValue: number;
  
  splinePointPositionMode: 'range' | 'define' | 'incremental';
  splinePointPositionRange: [number, number];
  splinePointPositionDefine: number;
  splinePointPositionStartValue: number;
  splinePointPositionIncrement: number;
  splinePointPositionModulationEnabled: boolean;
  splinePointPositionModulationValue: number;
  
  splineControlPointMode: 'range' | 'define' | 'incremental';
  splineControlPointRange: [number, number];
  splineControlPointDefine: number;
  splineControlPointStartValue: number;
  splineControlPointIncrement: number;
  splineControlPointModulationEnabled: boolean;
  splineControlPointModulationValue: number;
  splineIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for spline point/control incremental modes
  
  // Shape Transforms
  transformsEnabled: boolean;
  transformsPostPlacement: boolean; // When true, transforms fire after grid/distribution placement
  transformsTranslationPostPlacement: boolean; // Gate translation in post-placement path
  transformsScalePostPlacement: boolean; // Gate scale in post-placement path
  transformsRotationPostPlacement: boolean; // Gate rotation in post-placement path
  transformsOriginPostPlacement: boolean; // Gate transform origin in post-placement path
  transformsRandomisationPostPlacement: boolean; // Gate randomisation in post-placement path
  transformsArtboardAware: boolean; // Scale transform values relative to artboard dimensions
  translateXRange: [number, number];
  translateYRange: [number, number];
  scaleUniform: boolean;
  scaleRange: [number, number];
  scaleXRange: [number, number];
  scaleYRange: [number, number];
  rotationRange: [number, number];
  skewXRange: [number, number];
  skewYRange: [number, number];
  
  // Enhanced Transform Properties  
  // Position Enhanced Modes
  xTransformMode: 'range' | 'value' | 'incremental' | 'align' | 'series';
  yTransformMode: 'range' | 'value' | 'incremental' | 'align' | 'series';
  xTransformValue: number;
  yTransformValue: number;
  xTransformIncrement: number;
  yTransformIncrement: number;
  xTransformStartValue: number;
  yTransformStartValue: number;
  xTransformModulationEnabled: boolean;
  xTransformModulationValue: number;
  xTransformStartOffset: number; // Per-cycle start shift for xTransform modulation (px)
  xTransformStartOffsetCompound: boolean;
  xTransformWrapOffset: number; // Per-cycle shift applied to the wrap threshold for xTransform modulation (px)
  xTransformWrapOffsetCompound: boolean;
  xTransformModulationBounce: boolean;
  yTransformModulationEnabled: boolean;
  yTransformModulationValue: number;
  yTransformStartOffset: number; // Per-cycle start shift for yTransform modulation (px)
  yTransformStartOffsetCompound: boolean;
  yTransformWrapOffset: number; // Per-cycle shift applied to the wrap threshold for yTransform modulation (px)
  yTransformWrapOffsetCompound: boolean;
  yTransformModulationBounce: boolean;
  xTransformSeriesItems: ScalarSeriesItem[];
  xTransformSeriesSelection: ScalarSeriesSelection;
  xTransformSeriesExhaustion: ScalarSeriesExhaustion;
  xTransformSeriesDriver: ScalarSeriesDriver;
  xTransformSeriesStagingMode: 'fixed' | 'range';
  yTransformSeriesItems: ScalarSeriesItem[];
  yTransformSeriesSelection: ScalarSeriesSelection;
  yTransformSeriesExhaustion: ScalarSeriesExhaustion;
  yTransformSeriesDriver: ScalarSeriesDriver;
  yTransformSeriesStagingMode: 'fixed' | 'range';
  
  // Position Alignment (when mode is 'align')
  // X Alignment - Shape Anchor
  xShapeAnchorMode: 'predefined' | 'define';
  xShapeAnchorPredefined: 'left' | 'center' | 'right';
  xShapeAnchorDefine: number;
  // X Alignment - Artboard Anchor
  xArtboardAnchorMode: 'predefined' | 'define';
  xArtboardAnchorPredefined: 'left' | 'center' | 'right';
  xArtboardAnchorDefine: number;
  
  // Y Alignment - Shape Anchor
  yShapeAnchorMode: 'predefined' | 'define';
  yShapeAnchorPredefined: 'top' | 'center' | 'bottom';
  yShapeAnchorDefine: number;
  // Y Alignment - Artboard Anchor
  yArtboardAnchorMode: 'predefined' | 'define';
  yArtboardAnchorPredefined: 'top' | 'center' | 'bottom';
  yArtboardAnchorDefine: number;
  
  // Scale Enhanced Modes
  scaleXMode: 'range' | 'value' | 'incremental' | 'series';
  scaleYMode: 'range' | 'value' | 'incremental' | 'series';
  scaleXValue: number;
  scaleYValue: number;
  scaleXIncrement: number;
  scaleYIncrement: number;
  scaleXStartValue: number;
  scaleYStartValue: number;
  scaleXModulationEnabled: boolean;
  scaleXModulationValue: number;
  scaleXStartOffset: number; // Per-cycle start shift for scaleX modulation (%)
  scaleXStartOffsetCompound: boolean;
  scaleXWrapOffset: number; // Per-cycle shift applied to the wrap threshold for scaleX modulation (%)
  scaleXWrapOffsetCompound: boolean;
  scaleXModulationBounce: boolean;
  scaleYModulationEnabled: boolean;
  scaleYModulationValue: number;
  scaleYStartOffset: number; // Per-cycle start shift for scaleY modulation (%)
  scaleYStartOffsetCompound: boolean;
  scaleYWrapOffset: number; // Per-cycle shift applied to the wrap threshold for scaleY modulation (%)
  scaleYWrapOffsetCompound: boolean;
  scaleYModulationBounce: boolean;
  maintainScaleAspectRatio: boolean; // Link scale X and Y
  scaleXSeriesItems: ScalarSeriesItem[];
  scaleXSeriesSelection: ScalarSeriesSelection;
  scaleXSeriesExhaustion: ScalarSeriesExhaustion;
  scaleXSeriesDriver: ScalarSeriesDriver;
  scaleXSeriesStagingMode: 'fixed' | 'range';
  scaleYSeriesItems: ScalarSeriesItem[];
  scaleYSeriesSelection: ScalarSeriesSelection;
  scaleYSeriesExhaustion: ScalarSeriesExhaustion;
  scaleYSeriesDriver: ScalarSeriesDriver;
  scaleYSeriesStagingMode: 'fixed' | 'range';
  
  // Rotation Enhanced Mode
  rotationMode: 'range' | 'value' | 'incremental' | 'series';
  rotationValue: number;
  rotationIncrement: number;
  rotationIncrementStep: number; // Step amount for rotation increment slider (1-90)
  rotationStartValue: number; // Starting rotation value for incremental mode
  rotationModulation: number; // Modulation value (e.g., 360 for full circle reset)
  rotationModulationEnabled: boolean; // Toggle to enable/disable modulation
  setTransformIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for set transform incremental modes (position, scale, rotation)
  rotationSeriesItems: ScalarSeriesItem[];
  rotationSeriesSelection: ScalarSeriesSelection;
  rotationSeriesExhaustion: ScalarSeriesExhaustion;
  rotationSeriesDriver: ScalarSeriesDriver;
  rotationSeriesStagingMode: 'fixed' | 'range';
  
  // Transform Randomization Scaling (0-100%)
  scaleRandomizationScale: number; // Scale for scale randomization  
  rotationRandomizationScale: number; // Scale for rotation randomization
  translationXRandomizationScale: number; // Percentage variation of configured X translation
  translationYRandomizationScale: number; // Percentage variation of configured Y translation
  widthRandomizationScale: number; // Scale for width randomization in range mode
  heightRandomizationScale: number; // Scale for height randomization in range mode
  
  // Transform Origin
  transformOriginMode: 'define' | 'predefined-artboard' | 'current-shape' | 'shape-reference';
  
  // Define mode sub-modes
  transformOriginDefineMode: 'fixed' | 'range' | 'incremental' | 'series';
  transformOriginX: number; // Fixed mode X value
  transformOriginY: number; // Fixed mode Y value
  
  // Range mode
  transformOriginXMin: number;
  transformOriginXMax: number;
  transformOriginYMin: number;
  transformOriginYMax: number;
  
  // Incremental mode
  transformOriginXStartValue: number;
  transformOriginXIncrement: number;
  transformOriginXModulationEnabled: boolean;
  transformOriginXModulationValue: number;
  transformOriginXStartOffset: number; // Per-cycle start shift for transformOriginX modulation (px)
  transformOriginXStartOffsetCompound: boolean;
  transformOriginXWrapOffset: number; // Per-cycle shift applied to the wrap threshold for transformOriginX modulation (px)
  transformOriginXWrapOffsetCompound: boolean;
  transformOriginXModulationBounce: boolean;
  transformOriginYStartValue: number;
  transformOriginYIncrement: number;
  transformOriginYModulationEnabled: boolean;
  transformOriginYModulationValue: number;
  transformOriginYStartOffset: number; // Per-cycle start shift for transformOriginY modulation (px)
  transformOriginYStartOffsetCompound: boolean;
  transformOriginYWrapOffset: number; // Per-cycle shift applied to the wrap threshold for transformOriginY modulation (px)
  transformOriginYWrapOffsetCompound: boolean;
  transformOriginYModulationBounce: boolean;
  transformOriginXIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for transform origin X incremental mode
  transformOriginYIncrementalIndexDriver: IncrementalIndexDriver; // Index driver for transform origin Y incremental mode
  transformOriginXSeriesItems: ScalarSeriesItem[];
  transformOriginXSeriesSelection: ScalarSeriesSelection;
  transformOriginXSeriesExhaustion: ScalarSeriesExhaustion;
  transformOriginXSeriesDriver: ScalarSeriesDriver;
  transformOriginXSeriesStagingMode: 'fixed' | 'range';
  transformOriginYSeriesItems: ScalarSeriesItem[];
  transformOriginYSeriesSelection: ScalarSeriesSelection;
  transformOriginYSeriesExhaustion: ScalarSeriesExhaustion;
  transformOriginYSeriesDriver: ScalarSeriesDriver;
  transformOriginYSeriesStagingMode: 'fixed' | 'range';
  
  // Predefined anchor points (for predefined-artboard and current-shape modes)
  transformOriginPredefined: 'center' | 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  
  // Shape reference mode
  transformOriginShapeReference: 'current' | 'previous' | 'next' | 'first' | 'last' | 'specific';
  transformOriginShapeIndex: number; // Used when shapeReference is 'specific'
  transformOriginShapeAnchor: 'center' | 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  
  // Shape Effects
  shapeEffectsEnabled: boolean;
  
  // Echo/Motion Trails (Project A: Set-Level)
  echoSpread: EchoSpreadConfig;
  
  // Color Harmony
  colorHarmonyEnabled: boolean;
  harmonyType: 'monochromatic' | 'analogous' | 'complementary' | 'triadic' | 'split-complementary' | 'tetradic';
  baseColor: string;
  hueVariance: number;
  saturationRange: [number, number];
  lightnessRange: [number, number];
  
  // Harmony-specific settings
  monochromaticSettings: {
    lightnessSteps: number;
    saturationSteps: number;
    includeNeutrals: boolean;
  };
  analogousSettings: {
    hueRange: number;
    colorCount: number;
  };
  complementarySettings: {
    includeNearComplements: boolean;
    complementOffset: number;
  };
  triadicSettings: {
    rotationOffset: number;
    useEqualSpacing: boolean;
  };
  splitComplementarySettings: {
    splitAngle: number;
    balanceWeights: boolean;
  };
  tetradicSettings: {
    squareHarmony: boolean;
    rectangleRatio: number;
  };
  
  // Physics Simulation
  physicsEnabled: boolean;
  physicsType: 'none' | 'gravity' | 'magnetic' | 'collision' | 'flocking';
  gravityDirection: number; // degrees
  gravityStrength: number;
  magneticType: 'attraction' | 'repulsion';
  magneticStrength: number;
  collisionDistance: number;
  collisionBounce: number;
  simulationSteps: number;
  
  // Shape Render Mode
  shapeRenderMode: 'smooth' | 'sharp'; // 'points' removed; wire-mode is a separate follow-up
  shapeRenderSegments: number; // Sharp: number of sample points (default 32)
  shapeRenderDotSize: number; // Points: dot diameter in pixels (default 4)
  // New structured render mode override (tension + resample)
  renderModeOverride: import('@shared/renderModeUtils').RenderModeOverride;
  // Wire post-pass: vertex dots and/or connection lines drawn on top of fill+stroke
  wireConfig?: import('@shared/renderModeUtils').WireConfig;

  // Shape Roughness & Jitter
  globalJitterEnabled: boolean;
  globalJitterAmount: number;       // pixels, max displacement
  globalJitterBiasX: number;        // directional bias on X axis (-1 to 1)
  globalJitterBiasY: number;        // directional bias on Y axis (-1 to 1)
  globalJitterBiasZ: number;        // rotation bias (-1 to 1), maps to ±15° rotation
  globalJitterPositiveOnly: boolean;
  globalJitterReverse: boolean;
  localJitterEnabled: boolean;
  localJitterEnabledX: boolean;
  localJitterEnabledY: boolean;
  localJitterEnabledZ: boolean;     // tangential (along-boundary) displacement
  localJitterModeX: 'axial' | 'from-center';
  localJitterModeY: 'axial' | 'from-center';
  localJitterAmountX: number;
  localJitterAmountY: number;
  localJitterAmountZ: number;       // tangential displacement amount
  localJitterPositiveOnlyX: boolean;
  localJitterPositiveOnlyY: boolean;
  localJitterPositiveOnlyZ: boolean;
  localJitterReverseX: boolean;
  localJitterReverseY: boolean;
  localJitterReverseZ: boolean;
  jitterDriver: 'random' | 'simplex';
  jitterScale: number;              // noise coordinate scale
  jitterOctaves: number;            // FBM octaves for simplex
  jitterLacunarity: number;         // frequency multiplier per octave
  jitterGain: number;               // amplitude multiplier per octave
  jitterResampleEnabled: boolean;
  jitterResampleDensity: number;    // points per unit length (lower = more points)

  // Temporal Variation (DISABLED - Future Feature)
  temporalEnabled: false; // Always disabled for now
  evolutionMode: 'none'; // Always none for now
  seedIncrement: number;
  evolutionTargets: {
    position: boolean;
    rotation: boolean;
    scale: boolean;
    color: boolean;
    opacity: boolean;
  };
}

// Default settings for BatchConfigSettings (moved from client)
export const defaultBatchConfigSettings: BatchConfigSettings = {
  selectedPreset: 'custom',
  
  distributionLayoutEnabled: false,
  distributionPattern: 'grid',
  copyToPointsEnabled: false,
  gridRows: 3,
  gridColumns: 3,
  gridCreationOrder: 'rows',
  gridHorizontalDirection: 'left-to-right',
  gridVerticalDirection: 'top-to-bottom',
  gridFillEnabled: false,
  gridStartX: 0,
  gridStartY: 0,
  gridRowOffset: 120,
  gridColumnOffset: 120,
  gridMarginEnabled: false,
  gridMarginMode: 'absolute',
  gridMarginUnit: 'px',
  gridMarginTop: 50,
  gridMarginRight: 50,
  gridMarginBottom: 50,
  gridMarginLeft: 50,
  gridGutterEnabled: false,
  gridGutterX: 0,
  gridGutterY: 0,
  gridSortBy: 'none',
  gridSortScope: 'per-generation',
  gridSortOrder: 'ascending',
  gridGroupByShapeType: false,
  gridReverseGroups: false,
  gridXRandomization: 0,
  gridYRandomization: 0,
  
  // Grid alternating/pattern offsets
  gridOffsets: DEFAULT_GRID_OFFSETS,
  
  // Shape masking for grid positions
  shapeMasking: DEFAULT_SHAPE_MASKING,
  
  // Cell constraints for cell-based rendering
  cellConstraints: DEFAULT_CELL_CONSTRAINTS,
  
  waveType: 'sine',
  waveAmplitude: 50,
  waveFrequency: 2,
  waveDirection: 'horizontal',
  wavePhaseOffset: 0,
  
  ellipseXRadius: [80, 120],
  ellipseYRadius: [80, 120],
  ellipseRingCount: 1,
  ellipseRingSpacing: 'even',
  ellipseRotation: 0,
  ellipseRotationAlignment: 'uniform',
  ellipseAlignToRing: false,
  ellipseFlipInward: false,
  ellipseAdditionalRotation: 0,
  ellipseShapeRotationMode: 'none',
  ellipseRotationFixed: 0,
  ellipseRotationRange: [0, 360],
  ellipseRotationIncrementalStart: 0,
  ellipseRotationIncrementalStep: 10,
  ellipseShapeRotationSeriesItems: [] as ScalarSeriesItem[],
  ellipseShapeRotationSeriesSelection: 'sequential' as ScalarSeriesSelection,
  ellipseShapeRotationSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  ellipseShapeRotationSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  ellipseShapeRotationSeriesStagingMode: 'fixed' as 'fixed' | 'range',
  
  spiralTurnCount: 3,
  spiralSpacingMode: 'linear',
  spiralDirection: 'clockwise',
  spiralStartAngle: 0,
  spiralTightness: 1.0,
  
  tangentAlignment: false,
  segmentDistribution: 'even',
  reverseDirection: false,
  
  // Generation Count Controls
  generationCountMode: 'range',
  generationCountDefine: 5,
  generationCountStartValue: 1,
  generationCountIncrement: 1,
  generationCountResetPerBatch: true,
  generationCountModulationEnabled: false,
  generationCountModulationValue: 3,
  
  blendModeEnabled: false,
  enabledBlendModes: { 'source-over': 100 },
  
  compositingOperationsEnabled: false,
  enabledCompositingOperations: {},
  
  propertiesEnabled: false,
  
  // Shape Properties
  shapePropertiesEnabled: false,
  shapePropertiesDimensionsEnabled: true,
  shapePropertiesPositionEnabled: true,
  widthRange: [50, 200],
  heightRange: [50, 200],
  xPositionRange: [-100, 100],
  yPositionRange: [-100, 100],
  
  // Enhanced Width and Height Properties
  widthMode: 'range',
  heightMode: 'range',
  
  // Width/Height Mode Toggles
  sizeIncrementalResetPerBatch: true, // Default: reset count per batch
  
  // Size Constraint Mode
  sizeConstraintMode: 'none', // Default: independent width/height (no constraint)
  stretchShapeToDimensions: false,
  
  // Width/Height Value Mode
  widthValue: 100,
  heightValue: 100,
  
  // Width/Height Incremental Mode
  widthIncrement: 10,
  heightIncrement: 10,
  widthStartValue: 50,
  heightStartValue: 50,
  widthModulationEnabled: false,
  widthModulationValue: 500,
  widthStartOffset: 0,
  widthStartOffsetCompound: false,
  widthWrapOffset: 0,
  widthWrapOffsetCompound: false,
  widthModulationBounce: false,
  heightModulationEnabled: false,
  heightModulationValue: 500,
  heightStartOffset: 0,
  heightStartOffsetCompound: false,
  heightWrapOffset: 0,
  heightWrapOffsetCompound: false,
  heightModulationBounce: false,
  sizeIncrementalIndexDriver: 'shapeIndex', // Default: use shape index for size incremental

  // Width Series Mode
  widthSeriesItems: [] as ScalarSeriesItem[],
  widthSeriesSelection: 'sequential' as ScalarSeriesSelection,
  widthSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  widthSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  widthSeriesStagingMode: 'fixed' as 'fixed' | 'range',

  // Height Series Mode
  heightSeriesItems: [] as ScalarSeriesItem[],
  heightSeriesSelection: 'sequential' as ScalarSeriesSelection,
  heightSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  heightSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  heightSeriesStagingMode: 'fixed' as 'fixed' | 'range',
  
  // Size Constraints
  minimumSize: 10, // Minimum size to prevent invisible shapes
  maximumSize: 500, // Maximum size constraint
  
  // Position coordinate system
  positionCoordSystem: 'cartesian',

  // Enhanced Position Properties
  xPositionMode: 'range',
  yPositionMode: 'range',

  // Position Mode Toggles
  incrementalResetPerBatch: true,
  directionalEvenDistribution: true,
  directionalClusterAngle: 30,

  // Position Value Mode
  xPositionValue: 0,
  yPositionValue: 0,

  // Position Directional Mode (kept for server compat)
  positionDirectionalMode: 'outward-center',
  positionDirectionalAngle: 0,
  positionDirectionalDistance: 100,

  // Position Incremental Mode
  xPositionIncrement: 50,
  yPositionIncrement: 50,
  xPositionStartValue: 0,
  yPositionStartValue: 0,
  xPositionModulationMode: 'off',
  xPositionModulationValue: 200,
  yPositionModulationMode: 'off',
  yPositionModulationValue: 200,
  positionIncrementalIndexDriver: 'shapeIndex',

  // X Position Series Mode
  xPositionSeriesItems: [] as ScalarSeriesItem[],
  xPositionSeriesSelection: 'sequential' as ScalarSeriesSelection,
  xPositionSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  xPositionSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  xPositionSeriesStagingMode: 'fixed' as 'fixed' | 'range',

  // Y Position Series Mode
  yPositionSeriesItems: [] as ScalarSeriesItem[],
  yPositionSeriesSelection: 'sequential' as ScalarSeriesSelection,
  yPositionSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  yPositionSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  yPositionSeriesStagingMode: 'fixed' as 'fixed' | 'range',

  // Polar position fields
  polarAngleMode: 'range',
  polarAngleValue: 0,
  polarAngleRange: [0, 360] as [number, number],
  polarAngleStartValue: 0,
  polarAngleIncrement: 45,
  polarAngleModulationMode: 'off',
  polarAngleModulationValue: 360,
  polarAngleSeriesItems: [] as ScalarSeriesItem[],
  polarAngleSeriesSelection: 'sequential' as ScalarSeriesSelection,
  polarAngleSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  polarAngleSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  polarAngleSeriesStagingMode: 'fixed' as 'fixed' | 'range',
  polarRadiusMode: 'range',
  polarRadiusValue: 100,
  polarRadiusRange: [50, 200] as [number, number],
  polarRadiusStartValue: 0,
  polarRadiusIncrement: 50,
  polarRadiusModulationMode: 'off',
  polarRadiusModulationValue: 500,
  polarRadiusSeriesItems: [] as ScalarSeriesItem[],
  polarRadiusSeriesSelection: 'sequential' as ScalarSeriesSelection,
  polarRadiusSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  polarRadiusSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  polarRadiusSeriesStagingMode: 'fixed' as 'fixed' | 'range',

  // Position reference anchor
  positionAnchorMode: 'fixed',
  positionAnchorFixed: 'center',
  positionAnchorFrom: 'nw',
  positionAnchorTo: 'se',
  positionAnchorSequence: ['nw', 'ne', 'sw', 'se'],
  positionAnchorIncrementalStart: 4,
  positionAnchorIncrementalStep: 1,
  positionRotateToDirection: false,
  
  // Rectangle-specific Properties
  rectangleCornerRadiusMode: 'range',
  rectangleCornerRadiusRange: [0, 20],
  rectangleCornerRadiusDefine: 10,
  rectangleCornerRadiusStartValue: 0,
  rectangleCornerRadiusIncrement: 2,
  rectangleCornerRadiusModulationEnabled: false,
  rectangleCornerRadiusModulationValue: 50,
  rectangleCornerRadiusIncrementalIndexDriver: 'shapeIndex', // Default: use shape index
  rectangleCornerRadiusSeriesItems: [] as ScalarSeriesItem[],
  rectangleCornerRadiusSeriesSelection: 'sequential' as ScalarSeriesSelection,
  rectangleCornerRadiusSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  rectangleCornerRadiusSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  rectangleCornerRadiusSeriesStagingMode: 'fixed' as 'fixed' | 'range',
  
  // Star-specific Properties
  starInnerRadiusMode: 'range',
  starInnerRadiusRange: [0.3, 0.7],
  starInnerRadiusDefine: 0.5,
  starInnerRadiusStartValue: 0.3,
  starInnerRadiusIncrement: 0.05,
  starInnerRadiusModulationEnabled: false,
  starInnerRadiusModulationValue: 1.0,
  starInnerRadiusIncrementalIndexDriver: 'shapeIndex', // Default: use shape index
  starInnerRadiusSeriesItems: [] as ScalarSeriesItem[],
  starInnerRadiusSeriesSelection: 'sequential' as ScalarSeriesSelection,
  starInnerRadiusSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  starInnerRadiusSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  starInnerRadiusSeriesStagingMode: 'fixed' as 'fixed' | 'range',
  
  // Ring-specific Properties
  ringInnerRadiusMode: 'range',
  ringInnerRadiusRange: [0.4, 0.8],
  ringInnerRadiusDefine: 0.6,
  ringInnerRadiusStartValue: 0.4,
  ringInnerRadiusIncrement: 0.05,
  ringInnerRadiusModulationEnabled: false,
  ringInnerRadiusModulationValue: 1.0,
  ringInnerRadiusIncrementalIndexDriver: 'shapeIndex', // Default: use shape index
  ringInnerRadiusSeriesItems: [] as ScalarSeriesItem[],
  ringInnerRadiusSeriesSelection: 'sequential' as ScalarSeriesSelection,
  ringInnerRadiusSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  ringInnerRadiusSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  ringInnerRadiusSeriesStagingMode: 'fixed' as 'fixed' | 'range',
  
  // Fill Properties
  fillEnabled: true,
  fillSolidEnabled: true, // Solid fill section enabled by default
  fillStyleProbability: 60, // 60% solid fill, 40% gradient fill
  
  // Fill Color Settings
  fillColorMode: 'range',
  fillColorRange: ['#3b82f6', '#8b5cf6'],
  fillColorRangeFlip: false,
  fillColorPalette: ['#3b82f6', '#8b5cf6', '#ef4444', '#10b981', '#f59e0b'],
  fillColorPaletteBehavior: 'cycle',
  fillColorPaletteDistribution: 'even',
  fillColorPaletteInterpolation: 'linear',
  fillColorPaletteAssignments: [],
  fillColorDefine: '#3b82f6',
  // HSL controls for range mode
  fillColorSaturationMode: 'range' as const,
  fillColorSaturationFixed: 75,
  fillColorSaturationRange: [50, 100],
  fillColorLightnessMode: 'range' as const,
  fillColorLightnessFixed: 50,
  fillColorLightnessRange: [30, 70],
  
  // Fill Gradient Settings
  fillGradientEnabled: true,
  // Individual gradient type probabilities
  fillGradientLinearProbability: 50, // 50% of gradients are linear
  fillGradientRadialProbability: 40, // 40% of gradients are radial
  fillGradientConicProbability: 10,  // 10% of gradients are conic
  fillGradientDiamondProbability: 0, // 0% of gradients are diamond (opt-in)
  fillGradientColorMode: 'range',
  fillGradientColorRange: ['#3b82f6', '#8b5cf6'],
  fillGradientColorRangeFlip: false,
  fillGradientColorPalette: ['#3b82f6', '#8b5cf6', '#ef4444', '#10b981', '#f59e0b'],
  fillGradientColorDefine: ['#3b82f6', '#8b5cf6', '#ef4444'],
  // HSL range controls for range mode
  fillGradientColorSaturationRange: [40, 90],
  fillGradientColorLightnessRange: [20, 80],
  fillGradientStopsMode: 'range',
  fillGradientStopsCount: 3,
  fillGradientStopsRange: [2, 4],
  fillGradientStopDistribution: 'even',
  fillGradientStopsReverse: false,
  
  // Enhanced Gradient Type & Direction Controls
  fillGradientLinearDirection: 'range', // Default to range control
  fillGradientLinearAngle: 45, // Default fixed angle (diagonal)
  fillGradientLinearAngleRange: [0, 360], // Default full angle range
  fillGradientLinearPredefined: 'diagonal-down', // Default predefined direction
  fillGradientLinearAlignToShape: false, // Default: don't align to shape
  fillGradientLinearSeriesItems: [],
  fillGradientLinearSeriesMixed: false,
  fillGradientLinearSeriesStagingMode: 'predefined' as const,
  fillGradientLinearSeriesSelection: 'sequential' as const,
  fillGradientLinearSeriesExhaustion: 'cycle' as const,
  fillGradientLinearSeriesDriver: 'shape-index' as const,
  fillGradientLinearCenter: 'center',
  fillGradientLinearCorners: { topLeft: true, topRight: true, bottomLeft: true, bottomRight: true },
  fillGradientLinearMidpoints: { top: true, right: true, bottom: true, left: true },
  fillGradientLinearSelectionMode: 'random',
  fillGradientLinearCenterXMode: 'fixed',
  fillGradientLinearCenterX: 50,
  fillGradientLinearCenterXRange: [25, 75],
  fillGradientLinearCenterXStartValue: 50,
  fillGradientLinearCenterXIncrement: 10,
  fillGradientLinearCenterXModulationEnabled: false,
  fillGradientLinearCenterXModulationValue: 100,
  fillGradientLinearCenterXSeriesItems: [] as ScalarSeriesItem[],
  fillGradientLinearCenterXSeriesSelection: 'sequential' as const,
  fillGradientLinearCenterXSeriesExhaustion: 'cycle' as const,
  fillGradientLinearCenterXSeriesDriver: 'shape-index' as const,
  fillGradientLinearCenterXSeriesStagingMode: 'fixed' as const,
  fillGradientLinearCenterYMode: 'fixed',
  fillGradientLinearCenterY: 50,
  fillGradientLinearCenterYRange: [25, 75],
  fillGradientLinearCenterYStartValue: 50,
  fillGradientLinearCenterYIncrement: 10,
  fillGradientLinearCenterYModulationEnabled: false,
  fillGradientLinearCenterYModulationValue: 100,
  fillGradientLinearCenterYSeriesItems: [] as ScalarSeriesItem[],
  fillGradientLinearCenterYSeriesSelection: 'sequential' as const,
  fillGradientLinearCenterYSeriesExhaustion: 'cycle' as const,
  fillGradientLinearCenterYSeriesDriver: 'shape-index' as const,
  fillGradientLinearCenterYSeriesStagingMode: 'fixed' as const,
  fillGradientLinearScaleMode: 'fixed',
  fillGradientLinearScale: 100,
  fillGradientLinearScaleRange: [50, 150],
  fillGradientLinearScaleStartValue: 100,
  fillGradientLinearScaleIncrement: 10,
  fillGradientLinearScaleSeriesItems: [] as ScalarSeriesItem[],
  fillGradientLinearScaleSeriesSelection: 'sequential' as const,
  fillGradientLinearScaleSeriesExhaustion: 'cycle' as const,
  fillGradientLinearScaleSeriesDriver: 'shape-index' as const,
  fillGradientLinearScaleSeriesStagingMode: 'fixed' as const,
  fillGradientRadialCenter: 'center', // Default center positioning
  
  // Radial Gradient Center X
  fillGradientRadialCenterXMode: 'fixed',
  fillGradientRadialCenterX: 50,
  fillGradientRadialCenterXRange: [25, 75],
  fillGradientRadialCenterXStartValue: 50,
  fillGradientRadialCenterXIncrement: 10,
  fillGradientRadialCenterXModulationEnabled: false,
  fillGradientRadialCenterXModulationValue: 100,
  fillGradientRadialCenterXSeriesItems: [] as ScalarSeriesItem[],
  fillGradientRadialCenterXSeriesSelection: 'sequential' as const,
  fillGradientRadialCenterXSeriesExhaustion: 'cycle' as const,
  fillGradientRadialCenterXSeriesDriver: 'shape-index' as const,
  fillGradientRadialCenterXSeriesStagingMode: 'fixed' as const,
  
  // Radial Gradient Center Y
  fillGradientRadialCenterYMode: 'fixed',
  fillGradientRadialCenterY: 50,
  fillGradientRadialCenterYRange: [25, 75],
  fillGradientRadialCenterYStartValue: 50,
  fillGradientRadialCenterYIncrement: 10,
  fillGradientRadialCenterYModulationEnabled: false,
  fillGradientRadialCenterYModulationValue: 100,
  fillGradientRadialCenterYSeriesItems: [] as ScalarSeriesItem[],
  fillGradientRadialCenterYSeriesSelection: 'sequential' as const,
  fillGradientRadialCenterYSeriesExhaustion: 'cycle' as const,
  fillGradientRadialCenterYSeriesDriver: 'shape-index' as const,
  fillGradientRadialCenterYSeriesStagingMode: 'fixed' as const,
  fillGradientRadialScaleMode: 'fixed',
  fillGradientRadialScale: 100,
  fillGradientRadialScaleRange: [50, 150],
  fillGradientRadialScaleStartValue: 100,
  fillGradientRadialScaleIncrement: 10,
  fillGradientRadialScaleSeriesItems: [] as ScalarSeriesItem[],
  fillGradientRadialScaleSeriesSelection: 'sequential' as const,
  fillGradientRadialScaleSeriesExhaustion: 'cycle' as const,
  fillGradientRadialScaleSeriesDriver: 'shape-index' as const,
  fillGradientRadialScaleSeriesStagingMode: 'fixed' as const,
  
  fillGradientRadialCorners: {
    topLeft: true,
    topRight: true,
    bottomLeft: true,
    bottomRight: true,
  }, // All corners enabled by default
  fillGradientRadialMidpoints: {
    top: true,
    right: true,
    bottom: true,
    left: true,
  }, // All midpoints enabled by default
  fillGradientRadialSelectionMode: 'random', // Default to random selection
  fillGradientRadialShape: 'auto', // Auto-determine based on shape
  fillGradientRadialCircleProbability: 60, // 60% circle probability
  fillGradientRadialEllipseProbability: 40, // 40% ellipse probability
  fillGradientMatchShape: false, // Default: don't match shape type
  fillGradientTypeDirectionEnabled: false, // Default: disabled - use main gradient probabilities

  // Diamond Gradient Position
  fillGradientDiamondCenter: 'center',
  fillGradientDiamondCorners: { topLeft: true, topRight: true, bottomLeft: true, bottomRight: true },
  fillGradientDiamondMidpoints: { top: true, right: true, bottom: true, left: true },
  fillGradientDiamondSelectionMode: 'random',

  // Diamond Gradient Angle
  fillGradientDiamondAngleMode: 'fixed',
  fillGradientDiamondAngle: 0,
  fillGradientDiamondAngleRange: [0, 360],
  fillGradientDiamondAngleStartValue: 0,
  fillGradientDiamondAngleIncrement: 30,
  fillGradientDiamondAngleModulationEnabled: false,
  fillGradientDiamondAngleModulationValue: 360,
  fillGradientDiamondAngleModulationBounce: false,
  fillGradientDiamondAngleSeriesItems: [] as ScalarSeriesItem[],
  fillGradientDiamondAngleSeriesSelection: 'sequential' as const,
  fillGradientDiamondAngleSeriesExhaustion: 'cycle' as const,
  fillGradientDiamondAngleSeriesDriver: 'shape-index' as const,
  fillGradientDiamondAngleSeriesStagingMode: 'fixed' as const,

  // Diamond Gradient Center X
  fillGradientDiamondCenterXMode: 'fixed',
  fillGradientDiamondCenterX: 50,
  fillGradientDiamondCenterXRange: [25, 75],
  fillGradientDiamondCenterXStartValue: 50,
  fillGradientDiamondCenterXIncrement: 10,
  fillGradientDiamondCenterXModulationEnabled: false,
  fillGradientDiamondCenterXModulationValue: 100,
  fillGradientDiamondCenterXSeriesItems: [] as ScalarSeriesItem[],
  fillGradientDiamondCenterXSeriesSelection: 'sequential' as const,
  fillGradientDiamondCenterXSeriesExhaustion: 'cycle' as const,
  fillGradientDiamondCenterXSeriesDriver: 'shape-index' as const,
  fillGradientDiamondCenterXSeriesStagingMode: 'fixed' as const,

  // Diamond Gradient Center Y
  fillGradientDiamondCenterYMode: 'fixed',
  fillGradientDiamondCenterY: 50,
  fillGradientDiamondCenterYRange: [25, 75],
  fillGradientDiamondCenterYStartValue: 50,
  fillGradientDiamondCenterYIncrement: 10,
  fillGradientDiamondCenterYModulationEnabled: false,
  fillGradientDiamondCenterYModulationValue: 100,
  fillGradientDiamondCenterYSeriesItems: [] as ScalarSeriesItem[],
  fillGradientDiamondCenterYSeriesSelection: 'sequential' as const,
  fillGradientDiamondCenterYSeriesExhaustion: 'cycle' as const,
  fillGradientDiamondCenterYSeriesDriver: 'shape-index' as const,
  fillGradientDiamondCenterYSeriesStagingMode: 'fixed' as const,
  fillGradientDiamondScaleMode: 'fixed',
  fillGradientDiamondScale: 100,
  fillGradientDiamondScaleRange: [50, 150],
  fillGradientDiamondScaleStartValue: 100,
  fillGradientDiamondScaleIncrement: 10,
  fillGradientDiamondScaleSeriesItems: [] as ScalarSeriesItem[],
  fillGradientDiamondScaleSeriesSelection: 'sequential' as const,
  fillGradientDiamondScaleSeriesExhaustion: 'cycle' as const,
  fillGradientDiamondScaleSeriesDriver: 'shape-index' as const,
  fillGradientDiamondScaleSeriesStagingMode: 'fixed' as const,
  fillGradientDiamondScaleEdgeMode: 'streak',
  gradientScaleIncrementalIndexDriver: 'shapeIndex',

  // Conic gradient controls
  fillGradientConicCenter: 'center', // Default center positioning (matching radial)
  fillGradientConicCorners: {
    topLeft: true,
    topRight: true,
    bottomLeft: true,
    bottomRight: true,
  }, // All corners enabled by default
  fillGradientConicMidpoints: {
    top: true,
    right: true,
    bottom: true,
    left: true,
  }, // All midpoints enabled by default
  fillGradientConicSelectionMode: 'random', // Default to random selection
  
  // Conic Gradient Start Angle
  fillGradientConicAngleMode: 'fixed',
  fillGradientConicAngle: 0,
  fillGradientConicAngleRange: [0, 360],
  fillGradientConicAngleStartValue: 0,
  fillGradientConicAngleIncrement: 30,
  fillGradientConicAngleModulationEnabled: false,
  fillGradientConicAngleModulationValue: 360,
  fillGradientConicAngleModulationBounce: false,
  fillGradientConicAngleSeriesItems: [] as ScalarSeriesItem[],
  fillGradientConicAngleSeriesSelection: 'sequential' as const,
  fillGradientConicAngleSeriesExhaustion: 'cycle' as const,
  fillGradientConicAngleSeriesDriver: 'shape-index' as const,
  fillGradientConicAngleSeriesStagingMode: 'fixed' as const,
  
  // Conic Gradient Center X
  fillGradientConicCenterXMode: 'fixed',
  fillGradientConicCenterX: 50,
  fillGradientConicCenterXRange: [25, 75],
  fillGradientConicCenterXStartValue: 50,
  fillGradientConicCenterXIncrement: 10,
  fillGradientConicCenterXModulationEnabled: false,
  fillGradientConicCenterXModulationValue: 100,
  fillGradientConicCenterXSeriesItems: [] as ScalarSeriesItem[],
  fillGradientConicCenterXSeriesSelection: 'sequential' as const,
  fillGradientConicCenterXSeriesExhaustion: 'cycle' as const,
  fillGradientConicCenterXSeriesDriver: 'shape-index' as const,
  fillGradientConicCenterXSeriesStagingMode: 'fixed' as const,
  
  // Conic Gradient Center Y
  fillGradientConicCenterYMode: 'fixed',
  fillGradientConicCenterY: 50,
  fillGradientConicCenterYRange: [25, 75],
  fillGradientConicCenterYStartValue: 50,
  fillGradientConicCenterYIncrement: 10,
  fillGradientConicCenterYModulationEnabled: false,
  fillGradientConicCenterYModulationValue: 100,
  fillGradientConicCenterYSeriesItems: [] as ScalarSeriesItem[],
  fillGradientConicCenterYSeriesSelection: 'sequential' as const,
  fillGradientConicCenterYSeriesExhaustion: 'cycle' as const,
  fillGradientConicCenterYSeriesDriver: 'shape-index' as const,
  fillGradientConicCenterYSeriesStagingMode: 'fixed' as const,
  gradientCenterIncrementalIndexDriver: 'shapeIndex', // Default: use shape index for gradient center incremental
  
  // Fill Opacity Settings
  fillOpacityEnabled: true,
  fillOpacityMode: 'range',
  fillOpacityRange: [70, 100],
  fillOpacityDefine: 80,
  fillOpacityPalette: [25, 50, 75, 100],
  fillOpacityStartValue: 70,
  fillOpacityIncrement: 5,
  fillOpacityModulationEnabled: false,
  fillOpacityModulationValue: 100,
  fillOpacityModulationBounce: false,
  fillOpacityIncrementalIndexDriver: 'shapeIndex', // Default: use shape index for fill opacity incremental
  fillOpacitySeriesItems: [] as ScalarSeriesItem[],
  fillOpacitySeriesSelection: 'sequential' as const,
  fillOpacitySeriesExhaustion: 'cycle' as const,
  fillOpacitySeriesDriver: 'shape-index' as const,
  fillOpacitySeriesStagingMode: 'fixed' as const,
  openCurveFillProbability: 100, // Default: all open curves get filled
  
  // Blur Properties
  blurEnabled: false,
  blurType: 'box',
  blurProbability: 50,
  blurMode: 'range',
  blurRange: [2, 15],
  blurDefine: 8,
  blurStartValue: 2,
  blurIncrement: 1,
  blurModulationEnabled: false,
  blurModulationValue: 20,
  blurStartOffset: 0,
  blurStartOffsetCompound: false,
  blurWrapOffset: 0,
  blurWrapOffsetCompound: false,
  blurModulationBounce: false,
  blurIncrementalIndexDriver: 'shapeIndex', // Default: use shape index for blur incremental
  blurSeriesItems: [] as ScalarSeriesItem[],
  blurSeriesSelection: 'sequential' as const,
  blurSeriesExhaustion: 'cycle' as const,
  blurSeriesDriver: 'shape-index' as const,
  blurSeriesStagingMode: 'fixed' as const,
  
  // Drop Shadow Properties
  dropShadowEnabled: false,
  dropShadowProbability: 100,
  dropShadowColorMode: 'auto',
  dropShadowCustomColor: '#000000',
  dropShadowColorDarken: 50,
  dropShadowBlendMode: 'multiply',
  dropShadowOffsetXMode: 'define',
  dropShadowOffsetX: 4,
  dropShadowOffsetXRange: [2, 8],
  dropShadowOffsetXStartValue: 2,
  dropShadowOffsetXIncrement: 1,
  dropShadowOffsetYMode: 'define',
  dropShadowOffsetY: 4,
  dropShadowOffsetYRange: [2, 8],
  dropShadowOffsetYStartValue: 2,
  dropShadowOffsetYIncrement: 1,
  dropShadowBlurMode: 'define',
  dropShadowBlur: 6,
  dropShadowBlurRange: [2, 12],
  dropShadowBlurStartValue: 2,
  dropShadowBlurIncrement: 1,
  dropShadowSpreadMode: 'define',
  dropShadowSpread: 0,
  dropShadowSpreadRange: [0, 10],
  dropShadowSpreadStartValue: 0,
  dropShadowSpreadIncrement: 1,
  dropShadowOpacity: 50,
  dropShadowIncrementalIndexDriver: 'shapeIndex',
  dropShadowOffsetXSeriesItems: [],
  dropShadowOffsetXSeriesSelection: 'sequential' as const,
  dropShadowOffsetXSeriesExhaustion: 'cycle' as const,
  dropShadowOffsetXSeriesDriver: 'shape-index' as const,
  dropShadowOffsetXSeriesStagingMode: 'fixed' as const,
  dropShadowOffsetYSeriesItems: [],
  dropShadowOffsetYSeriesSelection: 'sequential' as const,
  dropShadowOffsetYSeriesExhaustion: 'cycle' as const,
  dropShadowOffsetYSeriesDriver: 'shape-index' as const,
  dropShadowOffsetYSeriesStagingMode: 'fixed' as const,
  dropShadowBlurSeriesItems: [],
  dropShadowBlurSeriesSelection: 'sequential' as const,
  dropShadowBlurSeriesExhaustion: 'cycle' as const,
  dropShadowBlurSeriesDriver: 'shape-index' as const,
  dropShadowBlurSeriesStagingMode: 'fixed' as const,
  dropShadowSpreadSeriesItems: [],
  dropShadowSpreadSeriesSelection: 'sequential' as const,
  dropShadowSpreadSeriesExhaustion: 'cycle' as const,
  dropShadowSpreadSeriesDriver: 'shape-index' as const,
  dropShadowSpreadSeriesStagingMode: 'fixed' as const,
  
  // Outer Glow Properties
  outerGlowEnabled: false,
  outerGlowProbability: 100,
  outerGlowColorMode: 'auto',
  outerGlowCustomColor: '#ffffff',
  outerGlowColorSaturate: 20,
  outerGlowBlendMode: 'screen',
  outerGlowBlurMode: 'define',
  outerGlowBlur: 10,
  outerGlowBlurRange: [5, 20],
  outerGlowBlurStartValue: 5,
  outerGlowBlurIncrement: 2,
  outerGlowSpreadMode: 'define',
  outerGlowSpread: 0,
  outerGlowSpreadRange: [0, 10],
  outerGlowSpreadStartValue: 0,
  outerGlowSpreadIncrement: 1,
  outerGlowOpacity: 75,
  outerGlowIncrementalIndexDriver: 'shapeIndex',
  outerGlowBlurSeriesItems: [],
  outerGlowBlurSeriesSelection: 'sequential' as const,
  outerGlowBlurSeriesExhaustion: 'cycle' as const,
  outerGlowBlurSeriesDriver: 'shape-index' as const,
  outerGlowBlurSeriesStagingMode: 'fixed' as const,
  outerGlowSpreadSeriesItems: [],
  outerGlowSpreadSeriesSelection: 'sequential' as const,
  outerGlowSpreadSeriesExhaustion: 'cycle' as const,
  outerGlowSpreadSeriesDriver: 'shape-index' as const,
  outerGlowSpreadSeriesStagingMode: 'fixed' as const,
  
  // Inner Shadow Properties
  innerShadowEnabled: false,
  innerShadowProbability: 100,
  innerShadowColorMode: 'auto',
  innerShadowCustomColor: '#000000',
  innerShadowColorDarken: 50,
  innerShadowBlendMode: 'multiply',
  innerShadowOffsetXMode: 'define',
  innerShadowOffsetX: 2,
  innerShadowOffsetXRange: [1, 5],
  innerShadowOffsetXStartValue: 1,
  innerShadowOffsetXIncrement: 1,
  innerShadowOffsetYMode: 'define',
  innerShadowOffsetY: 2,
  innerShadowOffsetYRange: [1, 5],
  innerShadowOffsetYStartValue: 1,
  innerShadowOffsetYIncrement: 1,
  innerShadowBlurMode: 'define',
  innerShadowBlur: 4,
  innerShadowBlurRange: [2, 8],
  innerShadowBlurStartValue: 2,
  innerShadowBlurIncrement: 1,
  innerShadowOpacity: 50,
  innerShadowIncrementalIndexDriver: 'shapeIndex',
  innerShadowOffsetXSeriesItems: [],
  innerShadowOffsetXSeriesSelection: 'sequential' as const,
  innerShadowOffsetXSeriesExhaustion: 'cycle' as const,
  innerShadowOffsetXSeriesDriver: 'shape-index' as const,
  innerShadowOffsetXSeriesStagingMode: 'fixed' as const,
  innerShadowOffsetYSeriesItems: [],
  innerShadowOffsetYSeriesSelection: 'sequential' as const,
  innerShadowOffsetYSeriesExhaustion: 'cycle' as const,
  innerShadowOffsetYSeriesDriver: 'shape-index' as const,
  innerShadowOffsetYSeriesStagingMode: 'fixed' as const,
  innerShadowBlurSeriesItems: [],
  innerShadowBlurSeriesSelection: 'sequential' as const,
  innerShadowBlurSeriesExhaustion: 'cycle' as const,
  innerShadowBlurSeriesDriver: 'shape-index' as const,
  innerShadowBlurSeriesStagingMode: 'fixed' as const,
  
  // Inner Glow Properties
  innerGlowEnabled: false,
  innerGlowProbability: 100,
  innerGlowColorMode: 'auto',
  innerGlowCustomColor: '#ffffff',
  innerGlowColorSaturate: 20,
  innerGlowBlendMode: 'screen',
  innerGlowBlurMode: 'define',
  innerGlowBlur: 8,
  innerGlowBlurRange: [4, 16],
  innerGlowBlurStartValue: 4,
  innerGlowBlurIncrement: 2,
  innerGlowSpreadMode: 'define',
  innerGlowSpread: 0,
  innerGlowSpreadRange: [0, 8],
  innerGlowSpreadStartValue: 0,
  innerGlowSpreadIncrement: 1,
  innerGlowOpacity: 75,
  innerGlowIncrementalIndexDriver: 'shapeIndex',
  innerGlowBlurSeriesItems: [],
  innerGlowBlurSeriesSelection: 'sequential' as const,
  innerGlowBlurSeriesExhaustion: 'cycle' as const,
  innerGlowBlurSeriesDriver: 'shape-index' as const,
  innerGlowBlurSeriesStagingMode: 'fixed' as const,
  innerGlowSpreadSeriesItems: [],
  innerGlowSpreadSeriesSelection: 'sequential' as const,
  innerGlowSpreadSeriesExhaustion: 'cycle' as const,
  innerGlowSpreadSeriesDriver: 'shape-index' as const,
  innerGlowSpreadSeriesStagingMode: 'fixed' as const,
  
  // Stroke Properties
  strokeEnabled: true,
  strokeProbability: 60,
  strokeOnlyUnfilled: false,
  
  // Stroke Color Settings
  strokeColorMode: 'range',
  strokeColorRange: ['#ef4444', '#f59e0b'],
  strokeColorRangeFlip: false,
  strokeColorPalette: ['#ef4444', '#f59e0b', '#8b5cf6', '#10b981', '#3b82f6'],
  strokeColorDefine: '#ef4444',
  // HSL controls for range mode
  strokeColorSaturationMode: 'range' as const,
  strokeColorSaturationFixed: 80,
  strokeColorSaturationRange: [60, 100],
  strokeColorLightnessMode: 'range' as const,
  strokeColorLightnessFixed: 40,
  strokeColorLightnessRange: [20, 60],
  strokeColorEnabled: true,
  
  // Stroke Opacity Settings
  strokeOpacityEnabled: true,
  strokeOpacityMode: 'range',
  strokeOpacityRange: [40, 100],
  strokeOpacityDefine: 80,
  strokeOpacityPalette: [25, 50, 75, 100],
  strokeOpacityStartValue: 40,
  strokeOpacityIncrement: 10,
  strokeOpacityModulationEnabled: false,
  strokeOpacityModulationValue: 100,
  strokeOpacityModulationBounce: false,
  strokeOpacitySeriesItems: [] as ScalarSeriesItem[],
  strokeOpacitySeriesSelection: 'sequential' as const,
  strokeOpacitySeriesExhaustion: 'cycle' as const,
  strokeOpacitySeriesDriver: 'shape-index' as const,
  strokeOpacitySeriesStagingMode: 'fixed' as const,
  
  // Stroke Width Settings
  strokeWidthEnabled: true,
  strokeWidthMode: 'range',
  strokeWidthRange: [1, 5],
  strokeWidthDefine: 3,
  strokeWidthStartValue: 1,
  strokeWidthIncrement: 0.5,
  strokeWidthModulationEnabled: false,
  strokeWidthModulationValue: 10,
  strokeWidthModulationBounce: false,
  strokeIncrementalIndexDriver: 'shapeIndex', // Default: use shape index for stroke incremental
  strokeWidthSeriesItems: [] as ScalarSeriesItem[],
  strokeWidthSeriesSelection: 'sequential' as const,
  strokeWidthSeriesExhaustion: 'cycle' as const,
  strokeWidthSeriesDriver: 'shape-index' as const,
  strokeWidthSeriesStagingMode: 'fixed' as const,

  // Stroke Profile defaults (parameterised mode)
  strokeProfileType: 'wave',
  strokeProfileFrequency: 2,
  strokeProfilePhaseOffset: 0,
  strokeProfileScale: 0.5,

  // Stroke Pattern defaults
  strokePattern: 'none',
  strokeDashLength: 10,
  strokeDashGap: 6,
  strokeDotSpacing: 8,
  strokeSquiggleAmplitudeMode: 'define' as const,
  strokeSquiggleAmplitudeRange: [2, 10] as [number, number],
  strokeSquiggleAmplitudeDefine: 4,
  strokeSquiggleAmplitudeStartValue: 2,
  strokeSquiggleAmplitudeIncrement: 1,
  strokeSquiggleAmplitudeModulationEnabled: false,
  strokeSquiggleAmplitudeModulationValue: 10,
  strokeSquiggleAmplitudeSeriesItems: [] as ScalarSeriesItem[],
  strokeSquiggleAmplitudeSeriesSelection: 'sequential' as ScalarSeriesSelection,
  strokeSquiggleAmplitudeSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  strokeSquiggleAmplitudeSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  strokeSquiggleAmplitudeSeriesStagingMode: 'fixed' as 'fixed' | 'range',
  strokeSquiggleFrequencyMode: 'define' as const,
  strokeSquiggleFrequencyRange: [0.5, 5] as [number, number],
  strokeSquiggleFrequencyDefine: 1,
  strokeSquiggleFrequencyStartValue: 1,
  strokeSquiggleFrequencyIncrement: 0.5,
  strokeSquiggleFrequencyModulationEnabled: false,
  strokeSquiggleFrequencyModulationValue: 10,
  strokeSquiggleFrequencySeriesItems: [] as ScalarSeriesItem[],
  strokeSquiggleFrequencySeriesSelection: 'sequential' as ScalarSeriesSelection,
  strokeSquiggleFrequencySeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  strokeSquiggleFrequencySeriesDriver: 'shape-index' as ScalarSeriesDriver,
  strokeSquiggleFrequencySeriesStagingMode: 'fixed' as 'fixed' | 'range',
  strokeSquigglePhaseMode: 'define' as const,
  strokeSquigglePhaseRange: [0, 3.14] as [number, number],
  strokeSquigglePhaseDefine: 0,
  strokeSquigglePhaseStartValue: 0,
  strokeSquigglePhaseIncrement: 0.5,
  strokeSquigglePhaseModulationEnabled: false,
  strokeSquigglePhaseModulationValue: 6.28,
  strokeSquigglePhaseSeriesItems: [] as ScalarSeriesItem[],
  strokeSquigglePhaseSeriesSelection: 'sequential' as ScalarSeriesSelection,
  strokeSquigglePhaseSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  strokeSquigglePhaseSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  strokeSquigglePhaseSeriesStagingMode: 'fixed' as 'fixed' | 'range',
  strokeSquiggleAlignMode: 'define' as const,
  strokeSquiggleAlignRange: [50, 100] as [number, number],
  strokeSquiggleAlignDefine: 100,
  strokeSquiggleAlignStartValue: 100,
  strokeSquiggleAlignIncrement: -5,
  strokeSquiggleAlignModulationEnabled: false,
  strokeSquiggleAlignModulationValue: 100,
  strokeSquiggleAlignSeriesItems: [] as ScalarSeriesItem[],
  strokeSquiggleAlignSeriesSelection: 'sequential' as ScalarSeriesSelection,
  strokeSquiggleAlignSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  strokeSquiggleAlignSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  strokeSquiggleAlignSeriesStagingMode: 'fixed' as 'fixed' | 'range',
  strokeSquiggleAbs: false,
  strokeSquiggleFlip: false,
  strokeSquigglePerturbType: 'jitter' as const,
  strokeSquiggleJitterMode: 'define' as const,
  strokeSquiggleJitterRange: [0, 5] as [number, number],
  strokeSquiggleJitterDefine: 0,
  strokeSquiggleJitterStartValue: 0,
  strokeSquiggleJitterIncrement: 1,
  strokeSquiggleJitterModulationEnabled: false,
  strokeSquiggleJitterModulationValue: 20,
  strokeSquiggleJitterSeriesItems: [] as ScalarSeriesItem[],
  strokeSquiggleJitterSeriesSelection: 'sequential' as ScalarSeriesSelection,
  strokeSquiggleJitterSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  strokeSquiggleJitterSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  strokeSquiggleJitterSeriesStagingMode: 'fixed' as 'fixed' | 'range',
  strokeSquiggleJitterDir: 'normal' as const,
  strokeSquiggleJitterSeedMode: 'define' as const,
  strokeSquiggleJitterSeedRange: [0, 100] as [number, number],
  strokeSquiggleJitterSeedDefine: 0,
  strokeSquiggleJitterSeedStartValue: 0,
  strokeSquiggleJitterSeedIncrement: 1,
  strokeSquiggleJitterSeedModulationEnabled: false,
  strokeSquiggleJitterSeedModulationValue: 9999,
  strokeSquiggleJitterSeedSeriesItems: [] as ScalarSeriesItem[],
  strokeSquiggleJitterSeedSeriesSelection: 'sequential' as ScalarSeriesSelection,
  strokeSquiggleJitterSeedSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  strokeSquiggleJitterSeedSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  strokeSquiggleJitterSeedSeriesStagingMode: 'fixed' as 'fixed' | 'range',
  strokeSquiggleNoiseMode: 'define' as const,
  strokeSquiggleNoiseRange: [0, 5] as [number, number],
  strokeSquiggleNoiseDefine: 0,
  strokeSquiggleNoiseStartValue: 0,
  strokeSquiggleNoiseIncrement: 1,
  strokeSquiggleNoiseModulationEnabled: false,
  strokeSquiggleNoiseModulationValue: 20,
  strokeSquiggleNoiseSeriesItems: [] as ScalarSeriesItem[],
  strokeSquiggleNoiseSeriesSelection: 'sequential' as ScalarSeriesSelection,
  strokeSquiggleNoiseSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  strokeSquiggleNoiseSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  strokeSquiggleNoiseSeriesStagingMode: 'fixed' as 'fixed' | 'range',
  strokeSquiggleNoiseFreqMode: 'define' as const,
  strokeSquiggleNoiseFreqRange: [0.5, 5] as [number, number],
  strokeSquiggleNoiseFreqDefine: 1,
  strokeSquiggleNoiseFreqStartValue: 1,
  strokeSquiggleNoiseFreqIncrement: 0.5,
  strokeSquiggleNoiseFreqModulationEnabled: false,
  strokeSquiggleNoiseFreqModulationValue: 10,
  strokeSquiggleNoiseFreqSeriesItems: [] as ScalarSeriesItem[],
  strokeSquiggleNoiseFreqSeriesSelection: 'sequential' as ScalarSeriesSelection,
  strokeSquiggleNoiseFreqSeriesExhaustion: 'cycle' as ScalarSeriesExhaustion,
  strokeSquiggleNoiseFreqSeriesDriver: 'shape-index' as ScalarSeriesDriver,
  strokeSquiggleNoiseFreqSeriesStagingMode: 'fixed' as 'fixed' | 'range',
  strokeSquiggleIncrementalIndexDriver: 'shapeIndex' as const,
  strokeSquiggleBounce: false,
  strokeSquiggleSampleMode: 'auto' as const,
  strokeSquiggleSampleDefine: 256,
  strokeSquiggleSampleRange: [128, 512] as [number, number],
  strokeSquiggleUseCurveResample: true,
  strokeSquiggleSmoothCurves: true,

  // Polygon Shape Properties
  polygonPropertiesEnabled: false,
  segmentCountMode: 'range',
  segmentCountRange: [3, 12],
  segmentCountDefine: 6,
  segmentCountStartValue: 3,
  segmentCountIncrement: 1,
  segmentCountModulationEnabled: false,
  segmentCountModulationValue: 20,
  polygonIncrementalIndexDriver: 'shapeIndex', // Default: use shape index for polygon incremental
  
  // Line Properties
  linePropertiesEnabled: false,
  pointCountMode: 'range',
  pointCountRange: [3, 8],
  pointCountDefine: 4,
  pointCountStartValue: 3,
  pointCountIncrement: 1,
  pointCountModulationEnabled: false,
  pointCountModulationValue: 15,
  
  pointPositionMode: 'range',
  pointPositionRange: [-50, 50],
  pointPositionDefine: 0,
  pointPositionStartValue: -50,
  pointPositionIncrement: 10,
  pointPositionModulationEnabled: false,
  pointPositionModulationValue: 200,
  lineIncrementalIndexDriver: 'shapeIndex', // Default: use shape index for line incremental
  
  // Spline Curve Properties
  splinePropertiesEnabled: false,
  splinePointCountMode: 'range',
  splinePointCountRange: [3, 6],
  splinePointCountDefine: 4,
  splinePointCountStartValue: 3,
  splinePointCountIncrement: 1,
  splinePointCountModulationEnabled: false,
  splinePointCountModulationValue: 10,
  
  splinePointPositionMode: 'range',
  splinePointPositionRange: [-50, 50],
  splinePointPositionDefine: 0,
  splinePointPositionStartValue: -50,
  splinePointPositionIncrement: 10,
  splinePointPositionModulationEnabled: false,
  splinePointPositionModulationValue: 200,
  
  splineControlPointMode: 'range',
  splineControlPointRange: [-25, 25],
  splineControlPointDefine: 0,
  splineControlPointStartValue: -25,
  splineControlPointIncrement: 5,
  splineControlPointModulationEnabled: false,
  splineControlPointModulationValue: 100,
  splineIncrementalIndexDriver: 'shapeIndex', // Default: use shape index for spline incremental
  
  // Shape Transforms
  transformsEnabled: false,
  transformsPostPlacement: false, // When true, transforms fire after grid/distribution placement
  transformsTranslationPostPlacement: true,
  transformsScalePostPlacement: true,
  transformsRotationPostPlacement: true,
  transformsOriginPostPlacement: true,
  transformsRandomisationPostPlacement: true,
  transformsArtboardAware: false, // When enabled, translate ranges dynamically match artboard bounds
  translateXRange: [-50, 50],
  translateYRange: [-50, 50],
  scaleUniform: true,
  scaleRange: [50, 200],
  scaleXRange: [50, 200],
  scaleYRange: [50, 200],
  rotationRange: [0, 360],
  skewXRange: [0, 0],
  skewYRange: [0, 0],
  
  // Enhanced Transform Properties
  // Position Enhanced Modes
  xTransformMode: 'range',
  yTransformMode: 'range',
  xTransformValue: 0,
  yTransformValue: 0,
  xTransformIncrement: 10,
  yTransformIncrement: 10,
  xTransformStartValue: 0,
  yTransformStartValue: 0,
  xTransformModulationEnabled: false,
  xTransformModulationValue: 100,
  xTransformStartOffset: 0,
  xTransformStartOffsetCompound: false,
  xTransformWrapOffset: 0,
  xTransformWrapOffsetCompound: false,
  xTransformModulationBounce: false,
  yTransformModulationEnabled: false,
  yTransformModulationValue: 100,
  yTransformStartOffset: 0,
  yTransformStartOffsetCompound: false,
  yTransformWrapOffset: 0,
  yTransformWrapOffsetCompound: false,
  yTransformModulationBounce: false,
  xTransformSeriesItems: [{ mode: 'fixed' as const, value: 0 }],
  xTransformSeriesSelection: 'sequential' as const,
  xTransformSeriesExhaustion: 'cycle' as const,
  xTransformSeriesDriver: 'shape-index' as const,
  xTransformSeriesStagingMode: 'fixed' as const,
  yTransformSeriesItems: [{ mode: 'fixed' as const, value: 0 }],
  yTransformSeriesSelection: 'sequential' as const,
  yTransformSeriesExhaustion: 'cycle' as const,
  yTransformSeriesDriver: 'shape-index' as const,
  yTransformSeriesStagingMode: 'fixed' as const,
  
  // Position Alignment (when mode is 'align')
  xShapeAnchorMode: 'predefined',
  xShapeAnchorPredefined: 'center',
  xShapeAnchorDefine: 0,
  xArtboardAnchorMode: 'predefined',
  xArtboardAnchorPredefined: 'center',
  xArtboardAnchorDefine: 0,
  
  yShapeAnchorMode: 'predefined',
  yShapeAnchorPredefined: 'center',
  yShapeAnchorDefine: 0,
  yArtboardAnchorMode: 'predefined',
  yArtboardAnchorPredefined: 'center',
  yArtboardAnchorDefine: 0,
  
  // Scale Enhanced Modes
  scaleXMode: 'range',
  scaleYMode: 'range',
  scaleXValue: 100,
  scaleYValue: 100,
  scaleXIncrement: 10,
  scaleYIncrement: 10,
  scaleXStartValue: 100,
  scaleYStartValue: 100,
  scaleXModulationEnabled: false,
  scaleXModulationValue: 200,
  scaleXStartOffset: 0,
  scaleXStartOffsetCompound: false,
  scaleXWrapOffset: 0,
  scaleXWrapOffsetCompound: false,
  scaleXModulationBounce: false,
  scaleYModulationEnabled: false,
  scaleYModulationValue: 200,
  scaleYStartOffset: 0,
  scaleYStartOffsetCompound: false,
  scaleYWrapOffset: 0,
  scaleYWrapOffsetCompound: false,
  scaleYModulationBounce: false,
  maintainScaleAspectRatio: true,
  scaleXSeriesItems: [{ mode: 'fixed' as const, value: 100 }],
  scaleXSeriesSelection: 'sequential' as const,
  scaleXSeriesExhaustion: 'cycle' as const,
  scaleXSeriesDriver: 'shape-index' as const,
  scaleXSeriesStagingMode: 'fixed' as const,
  scaleYSeriesItems: [{ mode: 'fixed' as const, value: 100 }],
  scaleYSeriesSelection: 'sequential' as const,
  scaleYSeriesExhaustion: 'cycle' as const,
  scaleYSeriesDriver: 'shape-index' as const,
  scaleYSeriesStagingMode: 'fixed' as const,
  
  // Rotation Enhanced Mode
  rotationMode: 'range',
  rotationValue: 0,
  rotationIncrement: 15,
  rotationIncrementStep: 15,
  rotationStartValue: 0,
  rotationModulation: 360,
  rotationModulationEnabled: false,
  setTransformIncrementalIndexDriver: 'shapeIndex', // Default: use shape index for set transform incremental
  rotationSeriesItems: [{ mode: 'fixed' as const, value: 0 }],
  rotationSeriesSelection: 'sequential' as const,
  rotationSeriesExhaustion: 'cycle' as const,
  rotationSeriesDriver: 'shape-index' as const,
  rotationSeriesStagingMode: 'fixed' as const,
  
  // Transform Randomization Scaling (0-100%)
  scaleRandomizationScale: 50,
  rotationRandomizationScale: 50,
  translationXRandomizationScale: 0,
  translationYRandomizationScale: 0,
  widthRandomizationScale: 100,
  heightRandomizationScale: 100,
  
  // Transform Origin
  transformOriginMode: 'predefined-artboard',
  
  // Define mode sub-modes
  transformOriginDefineMode: 'fixed',
  transformOriginX: 0,
  transformOriginY: 0,
  
  // Range mode
  transformOriginXMin: -100,
  transformOriginXMax: 100,
  transformOriginYMin: -100,
  transformOriginYMax: 100,
  
  // Incremental mode
  transformOriginXStartValue: 0,
  transformOriginXIncrement: 10,
  transformOriginXModulationEnabled: false,
  transformOriginXModulationValue: 100,
  transformOriginXStartOffset: 0,
  transformOriginXStartOffsetCompound: false,
  transformOriginXWrapOffset: 0,
  transformOriginXWrapOffsetCompound: false,
  transformOriginXModulationBounce: false,
  transformOriginYStartValue: 0,
  transformOriginYIncrement: 10,
  transformOriginYModulationEnabled: false,
  transformOriginYModulationValue: 100,
  transformOriginYStartOffset: 0,
  transformOriginYStartOffsetCompound: false,
  transformOriginYWrapOffset: 0,
  transformOriginYWrapOffsetCompound: false,
  transformOriginYModulationBounce: false,
  transformOriginXIncrementalIndexDriver: 'shapeIndex', // Default: use shape index for transform origin X incremental
  transformOriginYIncrementalIndexDriver: 'shapeIndex', // Default: use shape index for transform origin Y incremental
  transformOriginXSeriesItems: [{ mode: 'fixed' as const, value: 0 }],
  transformOriginXSeriesSelection: 'sequential' as const,
  transformOriginXSeriesExhaustion: 'cycle' as const,
  transformOriginXSeriesDriver: 'shape-index' as const,
  transformOriginXSeriesStagingMode: 'fixed' as const,
  transformOriginYSeriesItems: [{ mode: 'fixed' as const, value: 0 }],
  transformOriginYSeriesSelection: 'sequential' as const,
  transformOriginYSeriesExhaustion: 'cycle' as const,
  transformOriginYSeriesDriver: 'shape-index' as const,
  transformOriginYSeriesStagingMode: 'fixed' as const,
  
  // Predefined anchor points
  transformOriginPredefined: 'center',
  
  // Shape reference mode
  transformOriginShapeReference: 'current',
  transformOriginShapeIndex: 0,
  transformOriginShapeAnchor: 'center',
  
  // Shape Effects
  shapeEffectsEnabled: false,
  
  // Echo/Motion Trails
  echoSpread: DEFAULT_ECHO_SPREAD_CONFIG,
  
  colorHarmonyEnabled: false,
  harmonyType: 'complementary',
  baseColor: '#3b82f6',
  hueVariance: 15,
  saturationRange: [0, 100],
  lightnessRange: [0, 100],
  
  // Harmony-specific defaults
  monochromaticSettings: {
    lightnessSteps: 5,
    saturationSteps: 3,
    includeNeutrals: true,
  },
  analogousSettings: {
    hueRange: 60,
    colorCount: 3,
  },
  complementarySettings: {
    includeNearComplements: false,
    complementOffset: 0,
  },
  triadicSettings: {
    rotationOffset: 0,
    useEqualSpacing: true,
  },
  splitComplementarySettings: {
    splitAngle: 30,
    balanceWeights: true,
  },
  tetradicSettings: {
    squareHarmony: true,
    rectangleRatio: 60,
  },
  
  physicsEnabled: false,
  physicsType: 'none',
  gravityDirection: 270,
  gravityStrength: 50,
  magneticType: 'attraction',
  magneticStrength: 50,
  collisionDistance: 20,
  collisionBounce: 0.5,
  simulationSteps: 100,
  
  // Shape Render Mode
  shapeRenderMode: 'smooth',
  shapeRenderSegments: 32,
  shapeRenderDotSize: 4,
  renderModeOverride: { enabled: false, tension: 1, resample: { enabled: false, count: 32 } },
  wireConfig: { enabled: false, render: 'points', points: { colorSource: 'explicit', color: '#ffffff', opacity: 1, opacitySource: 'explicit', size: 4 }, connections: { colorSource: 'explicit', color: '#ffffff', opacity: 1, opacitySource: 'explicit', thickness: 1 } },

  // Shape Roughness & Jitter
  globalJitterEnabled: false,
  globalJitterAmount: 20,
  globalJitterBiasX: 0,
  globalJitterBiasY: 0,
  globalJitterBiasZ: 0,
  globalJitterPositiveOnly: false,
  globalJitterReverse: false,
  localJitterEnabled: false,
  localJitterEnabledX: true,
  localJitterEnabledY: true,
  localJitterEnabledZ: false,
  localJitterModeX: 'axial' as const,
  localJitterModeY: 'axial' as const,
  localJitterAmountX: 10,
  localJitterAmountY: 10,
  localJitterAmountZ: 10,
  localJitterPositiveOnlyX: false,
  localJitterPositiveOnlyY: false,
  localJitterPositiveOnlyZ: false,
  localJitterReverseX: false,
  localJitterReverseY: false,
  localJitterReverseZ: false,
  jitterDriver: 'random' as const,
  jitterScale: 0.05,
  jitterOctaves: 3,
  jitterLacunarity: 2.0,
  jitterGain: 0.5,
  jitterResampleEnabled: false,
  jitterResampleDensity: 0.1,

  temporalEnabled: false, // Always false (disabled)
  evolutionMode: 'none', // Always none (disabled)
  seedIncrement: 1,
  evolutionTargets: {
    position: false,
    rotation: false,
    scale: false,
    color: false,
    opacity: false
  }
};

// ===== GENERATION SETS DATA STRUCTURES =====

// Mode enumeration for generation sets
export enum GenerationSetMode {
  SINGLE = "single",
  MULTI = "multi"
}

// Shape count mode for individual generation sets
export enum ShapeCountMode {
  FIXED = "fixed",
  RANGE = "range"
}

// Z-index management for layering
export interface ZIndexConfig {
  baseOffset: number;           // Base z-index offset for this generation set
  incrementPerShape: number;    // Z-index increment between shapes within set
  incrementPerGeneration: number; // Z-index increment between generation sets
}

// Updated shape types to match client ShapeType from lib/shapeTypes.ts (complete coverage)
export type SupportedShapeType = 
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

// Shape-specific properties for different shape types (complete coverage)
export interface ShapeSpecificProperties {
  // Rectangle properties
  rectangle?: {
    // Standard rectangle has no special properties
  };
  
  // Rounded rectangle properties  
  'rounded-rectangle'?: {
    cornerRadiusRange?: [number, number];
    cornerRadiusMode?: 'range' | 'fixed';
    cornerRadiusValue?: number;
  };
  
  // Square properties
  square?: {
    // Standard square has no special properties
  };
  
  // Rounded square properties
  'rounded-square'?: {
    cornerRadiusRange?: [number, number];
    cornerRadiusMode?: 'range' | 'fixed';
    cornerRadiusValue?: number;
  };
  
  // Circle and ellipse properties
  circle?: {
    segmentCountRange?: [number, number];
    segmentCountMode?: 'range' | 'fixed';
    segmentCountValue?: number;
  };
  ellipse?: {
    segmentCountRange?: [number, number];
    segmentCountMode?: 'range' | 'fixed';
    segmentCountValue?: number;
  };
  
  // Geometric shape properties
  triangle?: {
    // Standard triangle has no special properties
  };
  'right-triangle'?: {
    // Standard right triangle has no special properties
  };
  trapezoid?: {
    // Standard trapezoid has no special properties
  };
  pentagon?: {
    // Standard pentagon has no special properties
  };
  hexagon?: {
    // Standard hexagon has no special properties
  };
  rhombus?: {
    // Standard rhombus has no special properties
  };
  parallelogram?: {
    // Standard parallelogram has no special properties
  };
  kite?: {
    // Standard kite has no special properties
  };
  semicircle?: {
    // Standard semicircle has no special properties
  };
  heart?: {
    // Standard heart has no special properties
  };
  arrow?: {
    // Standard arrow has no special properties
  };
  cross?: {
    // Standard cross has no special properties
  };
  
  // Polygon properties
  polygon?: {
    pointCountRange?: [number, number];
    pointCountMode?: 'range' | 'fixed';
    pointCountValue?: number;
  };
  
  // Star properties
  star?: {
    pointCountRange?: [number, number];
    pointCountMode?: 'range' | 'fixed';
    pointCountValue?: number;
    innerRadiusRange?: [number, number];
    innerRadiusMode?: 'range' | 'fixed';
    innerRadiusValue?: number;
  };
  
  // Ring properties
  ring?: {
    innerRadiusRange?: [number, number];
    innerRadiusMode?: 'range' | 'fixed';
    innerRadiusValue?: number;
  };
  
  // Line properties
  line?: {
    pointCountRange?: [number, number];
    pointCountMode?: 'range' | 'fixed';
    pointCountValue?: number;
    strokeCapProbabilities?: {
      round: number;
      square: number;
      butt: number;
    };
  };
  
  // Line vector properties
  'line-vector'?: {
    directionMode?: 'range' | 'fixed' | 'incremental';
    directionRange?: [number, number]; // For range mode (0-360 degrees)
    directionValue?: number; // For fixed mode
    directionStartValue?: number; // For incremental mode
    directionIncrement?: number; // For incremental mode
    
    lengthMode?: 'range' | 'fixed' | 'incremental';
    lengthRange?: [number, number]; // For range mode (5-500)
    lengthValue?: number; // For fixed mode
    lengthStartValue?: number; // For incremental mode
    lengthIncrement?: number; // For incremental mode
    
    centroidMode?: 'range' | 'fixed' | 'incremental';
    centroidRange?: [number, number]; // For range mode (0-1)
    centroidValue?: number; // For fixed mode
    centroidStartValue?: number; // For incremental mode
    centroidIncrement?: number; // For incremental mode
    
    strokeCapProbabilities?: {
      round: number;
      square: number;
      butt: number;
    };
  };
  
  // Bezier curve properties
  bezier?: {
    pointCountRange?: [number, number];
    pointCountMode?: 'range' | 'fixed';
    pointCountValue?: number;
    openProbability?: number;
    strokeCapProbabilities?: {
      round: number;
      square: number;
      butt: number;
    };
    // Shared curve pattern controls
    curvatureRange?: [number, number];
    curvatureMode?: 'range' | 'fixed';
    curvatureValue?: number;
    spreadRange?: [number, number];
    spreadMode?: 'range' | 'fixed';
    spreadValue?: number;
    patternType?: number;
    // Per-pattern artistic controls
    waveHeight?: number;
    waveFrequency?: number;
    wavePhase?: number;
    spiralTurns?: number;
    spiralTightness?: number;
    arcSweep?: number;
    organicJitter?: number;
    // Curve Length
    curveLengthRange?: [number, number];
    curveLengthMode?: 'range' | 'fixed' | 'incremental';
    curveLengthValue?: number;
    curveLengthStartValue?: number;
    curveLengthIncrement?: number;
    // Pattern Resample
    patternResample?: boolean;
    patternResampleManual?: boolean;
    patternResampleAmountMode?: 'fixed' | 'range';
    patternResampleAmountValue?: number;
    patternResampleAmountRange?: [number, number];
  };
  
  // Cubic curve properties
  cubic?: {
    pointCountRange?: [number, number];
    pointCountMode?: 'range' | 'fixed';
    pointCountValue?: number;
    openProbability?: number;
    curvatureRange?: [number, number];
    curvatureMode?: 'range' | 'fixed';
    curvatureValue?: number;
    spreadRange?: [number, number];
    spreadMode?: 'range' | 'fixed';
    spreadValue?: number;
    patternType?: number;
    // Per-pattern artistic controls
    waveHeight?: number;
    waveFrequency?: number;
    wavePhase?: number;
    spiralTurns?: number;
    spiralTightness?: number;
    arcSweep?: number;
    organicJitter?: number;
    closeAverageProbability?: number;
    curveTension?: number;
    curveTensionMode?: 'range' | 'fixed';
    curveTensionValue?: number;
    curveTensionRange?: [number, number];
    endpointContinuous?: boolean;
    jitterAlongNormal?: boolean;
    jitterDirection?: 'both' | 'outward' | 'inward';
    // Pattern Resample
    patternResample?: boolean;
    patternResampleManual?: boolean;
    patternResampleAmountMode?: 'fixed' | 'range';
    patternResampleAmountValue?: number;
    patternResampleAmountRange?: [number, number];
  };
  
  // Smooth spline properties
  'smooth-spline'?: {
    pointCountRange?: [number, number];
    pointCountMode?: 'range' | 'fixed';
    pointCountValue?: number;
    openProbability?: number;
    strokeCapProbabilities?: {
      round: number;
      square: number;
      butt: number;
    };
    // Shared curve pattern controls
    curvatureRange?: [number, number];
    curvatureMode?: 'range' | 'fixed';
    curvatureValue?: number;
    spreadRange?: [number, number];
    spreadMode?: 'range' | 'fixed';
    spreadValue?: number;
    patternType?: number;
    // Per-pattern artistic controls
    waveHeight?: number;
    waveFrequency?: number;
    wavePhase?: number;
    spiralTurns?: number;
    spiralTightness?: number;
    arcSweep?: number;
    organicJitter?: number;
    // Curve Length
    curveLengthRange?: [number, number];
    curveLengthMode?: 'range' | 'fixed' | 'incremental';
    curveLengthValue?: number;
    curveLengthStartValue?: number;
    curveLengthIncrement?: number;
    // Pattern Resample
    patternResample?: boolean;
    patternResampleManual?: boolean;
    patternResampleAmountMode?: 'fixed' | 'range';
    patternResampleAmountValue?: number;
    patternResampleAmountRange?: [number, number];
  };
  
  // Advanced shapes
  chunk?: {
    // Chunk has no special properties
  };
  blob?: {
    // Blob has no special properties
  };
  
  // Spline shapes
  'spline-circle'?: {
    // Spline-circle has no configurable properties
  };
  'spline-ellipse'?: {
    // Spline-ellipse has no configurable properties
  };
  'spline-ring'?: {
    innerRadiusRange?: [number, number];
    innerRadiusMode?: 'range' | 'fixed';
    innerRadiusValue?: number;
  };
}

// Individual generation set configuration
export interface GenerationSet {
  id: string;                           // Unique identifier for the set
  name: string;                         // Display name for the set
  enabled: boolean;                     // Whether this set is active
  
  // Shape types enabled for this generation set (JSON-serializable array)
  enabledShapeTypes: SupportedShapeType[]; // e.g., ['rectangle', 'circle', 'polygon']
  
  // Shape count configuration
  shapeCountMode: ShapeCountMode;       // Fixed or range mode
  shapeCountFixed: number;              // Fixed number of shapes (when mode is FIXED)
  shapeCountRange: [number, number];    // Min/max shapes (when mode is RANGE)
  
  // Shape-specific properties for this generation set
  shapeSpecificProperties: ShapeSpecificProperties;
  
  // Z-index configuration for layering (per-set customization)
  // NOTE: This is used for per-set customization only.
  // If EnhancedBatchConfig.globalSettings.globalZIndexSettings.useGlobalSettings is true,
  // this configuration is ignored in favor of global settings.
  zIndexConfig: ZIndexConfig;
  
  // Complete batch configuration settings for this generation set
  // Properly typed instead of Record<string, any>
  batchConfig: BatchConfigSettings;
  
  // SET-LEVEL FEATURES FOR ADVANCED COMPOSITION
  
  // Set visibility and opacity controls
  setVisibility: SetVisibility;
  
  // Set-level blend mode and compositing operation
  setBlendMode: BlendMode;              // Blend mode applied to entire set
  compositingOperation: CompositingOperation; // Compositing operation for masking effects
  
  // Set positioning and transform controls
  setTransform: SetTransform;           // Position, rotation, scale for the entire set
  
  // Artboard alignment and fitting
  artboardAlignment: ArtboardAlignment; // How this set aligns to artboard or other sets
  
  // Generation-specific metadata
  generationOrder: number;              // Order in which this set should be generated
  description?: string;                 // Optional description for the set
  
  // Per-set repetition settings (overrides global settings)
  repetitionMode: 'use-global' | 'fixed' | 'range';  // Use global, fixed count, or range mode
  repetitionValue: number;              // Count when mode is 'fixed'
  repetitionRange: [number, number];    // Min/max when mode is 'range'
  
  // Set locks - granular control over operations
  locks: SetLocks;                      // Lock states for this set (composite, blend, transform, etc.)
  
  // Per-set echo override (Project B feature)
  echoOverride?: {
    enabled: boolean;                   // Whether to override global echo settings
    config?: EchoSpreadConfig;          // Custom echo config for this set (if enabled)
  };

  // Shape type generation control
  shapeTypeGenMode?: 'random' | 'weighted' | 'fixed' | 'sequence';
  shapeTypeWeights?: Partial<Record<SupportedShapeType, number>>;
  shapeTypeFixedCounts?: Partial<Record<SupportedShapeType, number>>;
  shapeTypeSequence?: SupportedShapeType[];

  // (useAsPointSource and hideWhenUsedAsPointSource moved to batchConfig)
}

// Enhanced batch configuration supporting both single and multi-generation modes
export interface EnhancedBatchConfig {
  // Mode selection
  mode: GenerationSetMode;              // Single or multi-generation mode
  
  // Backward compatibility: single generation settings
  // When mode is SINGLE, these settings are used directly
  legacyBatchConfig?: BatchConfigSettings; // Properly typed instead of Record<string, any>
  
  // Multi-generation settings
  // When mode is MULTI, these settings control the generation sets
  generationSets: GenerationSet[];     // Array of generation sets
  
  // Global settings that apply to all generation sets
  globalSettings: {
    // Canvas and artboard settings
    canvasWidth: number;
    canvasHeight: number;
    artboardSettings?: {
      enabled: boolean;
      width: number;
      height: number;
      backgroundColor: string;
    };
    
    // Edge case strategy for when generation sets count < batch export count
    edgeCaseStrategy: 'hold' | 'cycle' | 'random' | 'stop';
    
    // Export settings
    exportFormat: 'png' | 'jpeg' | 'webp' | 'avif' | 'bmp';
    exportQuality: number;            // 0-100 for image formats
    
    // Global z-index management (single source of truth)
    // NOTE: This is the authoritative z-index configuration.
    // Individual GenerationSet.zIndexConfig is for per-set customization only.
    globalZIndexSettings: {
      startingZIndex: number;         // Base z-index to start from
      setSpacing: number;             // Z-index spacing between generation sets
      preventOverlap: boolean;        // Ensure sets don't overlap in z-space
      useGlobalSettings: boolean;     // If true, ignore per-set zIndexConfig
    };
    
    // Global repetition settings (applies to all sets unless overridden)
    globalRepetitionSettings: {
      repetitionMode: 'fixed' | 'range';  // Fixed count or range mode
      repetitionValue: number;            // Count when mode is 'fixed'
      repetitionRange: [number, number];  // Min/max when mode is 'range'
    };
  };
  
  // Mode restrictions and validation
  modeRestrictions: {
    // Multi-generation mode restrictions
    multiGenerationOnlyForFixedCount: boolean;  // Restrict multi-generation to fixed count only
    maxGenerationSets: number;                  // Maximum allowed generation sets
    minShapesPerSet: number;                    // Minimum shapes per generation set
    maxShapesPerSet: number;                    // Maximum shapes per generation set
  };
  
  // Metadata (using ISO string timestamps for JSON serialization)
  createdAt: string;                    // ISO timestamp string
  updatedAt: string;                    // ISO timestamp string
  version: string;                      // Version for migration/compatibility
}

// ===== HELPER TYPES AND UTILITIES =====

// Default values for generation set configuration
export const DEFAULT_Z_INDEX_CONFIG: ZIndexConfig = {
  baseOffset: 1000,
  incrementPerShape: 1,
  incrementPerGeneration: 1000
};

export const DEFAULT_GENERATION_SET_LIMITS = {
  maxGenerationSets: 20,
  minShapesPerSet: 1,
  maxShapesPerSet: 1000,
  defaultShapesPerSet: 10
};

// ===== VALIDATION SCHEMAS USING ZOD =====

export const GenerationSetModeSchema = z.nativeEnum(GenerationSetMode);
export const ShapeCountModeSchema = z.nativeEnum(ShapeCountMode);

export const BlendModeSchema = z.enum([
  'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity'
]);

export const CompositingOperationSchema = z.enum([
  'source-over', 'source-in', 'source-out', 'source-atop',
  'destination-over', 'destination-in', 'destination-out', 'destination-atop',
  'lighter', 'copy', 'xor'
]);

export const IncrementalIndexDriverSchema = z.enum(['shapeIndex', 'setRepIndex']);

export const SetTransformSchema = z.object({
  x: z.number(),
  y: z.number(),
  rotation: z.number(),
  scaleX: z.number().positive(),
  scaleY: z.number().positive(),
  transformOrigin: z.enum(['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'])
});

export const ArtboardAlignmentSchema = z.object({
  fitToArtboard: z.boolean(),
  fitTarget: z.enum(['none', 'artboard', 'bleed']).optional(),
  fitMode: z.enum(['contain', 'fill']).optional(),
  alignTo: z.enum(['artboard', 'set', 'none']),
  alignmentType: z.enum([
    'center', 'top-left', 'top-center', 'top-right',
    'center-left', 'center-right', 'bottom-left', 
    'bottom-center', 'bottom-right'
  ]),
  targetSetId: z.string().optional(),
  margin: z.union([
    z.number().min(0),
    z.object({
      top: z.number().min(0),
      bottom: z.number().min(0),
      left: z.number().min(0),
      right: z.number().min(0)
    })
  ])
});

export const SetVisibilitySchema = z.object({
  visible: z.boolean(),
  opacity: z.number().min(0).max(1),
  opacityVariance: z.number().min(0).max(1)
});

export const SetLocksSchema = z.object({
  composite: z.boolean()
});

export const SupportedShapeTypeSchema = z.enum([
  'rectangle', 'rounded-rectangle', 'square', 'rounded-square', 'circle', 
  'ellipse', 'triangle', 'right-triangle', 'trapezoid', 'pentagon', 'hexagon', 
  'rhombus', 'parallelogram', 'kite', 'semicircle', 'heart', 'arrow', 'cross',
  'line-vector', 'line', 'polygon', 'star', 'chunk', 'blob', 'ring', 'cubic', 'bezier', 
  'smooth-spline', 'spline-circle', 'spline-ellipse', 'spline-ring'
]);

export const ZIndexConfigSchema = z.object({
  baseOffset: z.number().min(0),
  incrementPerShape: z.number().min(0),
  incrementPerGeneration: z.number().min(0)
});

export const ShapeSpecificPropertiesSchema = z.object({
  rectangle: z.object({}).optional(),
  'rounded-rectangle': z.object({
    cornerRadiusRange: z.tuple([z.number(), z.number()]).optional(),
    cornerRadiusMode: z.enum(['range', 'fixed']).optional(),
    cornerRadiusValue: z.number().optional()
  }).optional(),
  square: z.object({}).optional(),
  'rounded-square': z.object({
    cornerRadiusRange: z.tuple([z.number(), z.number()]).optional(),
    cornerRadiusMode: z.enum(['range', 'fixed']).optional(),
    cornerRadiusValue: z.number().optional()
  }).optional(),
  circle: z.object({
    segmentCountRange: z.tuple([z.number(), z.number()]).optional(),
    segmentCountMode: z.enum(['range', 'fixed']).optional(),
    segmentCountValue: z.number().optional()
  }).optional(),
  ellipse: z.object({
    segmentCountRange: z.tuple([z.number(), z.number()]).optional(),
    segmentCountMode: z.enum(['range', 'fixed']).optional(),
    segmentCountValue: z.number().optional()
  }).optional(),
  triangle: z.object({}).optional(),
  'right-triangle': z.object({}).optional(),
  trapezoid: z.object({}).optional(),
  pentagon: z.object({}).optional(),
  hexagon: z.object({}).optional(),
  rhombus: z.object({}).optional(),
  parallelogram: z.object({}).optional(),
  kite: z.object({}).optional(),
  semicircle: z.object({}).optional(),
  heart: z.object({}).optional(),
  arrow: z.object({}).optional(),
  cross: z.object({}).optional(),
  polygon: z.object({
    pointCountRange: z.tuple([z.number(), z.number()]).optional(),
    pointCountMode: z.enum(['range', 'fixed']).optional(),
    pointCountValue: z.number().optional()
  }).optional(),
  star: z.object({
    pointCountRange: z.tuple([z.number(), z.number()]).optional(),
    pointCountMode: z.enum(['range', 'fixed']).optional(),
    pointCountValue: z.number().optional(),
    innerRadiusRange: z.tuple([z.number(), z.number()]).optional(),
    innerRadiusMode: z.enum(['range', 'fixed']).optional(),
    innerRadiusValue: z.number().optional()
  }).optional(),
  ring: z.object({
    innerRadiusRange: z.tuple([z.number(), z.number()]).optional(),
    innerRadiusMode: z.enum(['range', 'fixed']).optional(),
    innerRadiusValue: z.number().optional()
  }).optional(),
  line: z.object({
    pointCountRange: z.tuple([z.number(), z.number()]).optional(),
    pointCountMode: z.enum(['range', 'fixed']).optional(),
    pointCountValue: z.number().optional(),
    strokeCapProbabilities: z.object({
      round: z.number(),
      square: z.number(),
      butt: z.number()
    }).optional()
  }).optional(),
  bezier: z.object({
    pointCountRange: z.tuple([z.number(), z.number()]).optional(),
    pointCountMode: z.enum(['range', 'fixed']).optional(),
    pointCountValue: z.number().optional(),
    openProbability: z.number().optional(),
    strokeCapProbabilities: z.object({
      round: z.number(),
      square: z.number(),
      butt: z.number()
    }).optional(),
    curvatureRange: z.tuple([z.number(), z.number()]).optional(),
    curvatureMode: z.enum(['range', 'fixed']).optional(),
    curvatureValue: z.number().optional(),
    spreadRange: z.tuple([z.number(), z.number()]).optional(),
    spreadMode: z.enum(['range', 'fixed']).optional(),
    spreadValue: z.number().optional(),
    patternType: z.number().optional(),
    waveHeight: z.number().optional(),
    waveFrequency: z.number().optional(),
    wavePhase: z.number().optional(),
    spiralTurns: z.number().optional(),
    spiralTightness: z.number().optional(),
    arcSweep: z.number().optional(),
    organicJitter: z.number().optional(),
    patternResample: z.boolean().optional(),
    patternResampleManual: z.boolean().optional(),
    patternResampleAmountMode: z.enum(['fixed', 'range']).optional(),
    patternResampleAmountValue: z.number().optional(),
    patternResampleAmountRange: z.tuple([z.number(), z.number()]).optional(),
    curveLengthRange: z.tuple([z.number(), z.number()]).optional(),
    curveLengthMode: z.enum(['range', 'fixed', 'incremental']).optional(),
    curveLengthValue: z.number().optional(),
    curveLengthStartValue: z.number().optional(),
    curveLengthIncrement: z.number().optional()
  }).optional(),
  cubic: z.object({
    pointCountRange: z.tuple([z.number(), z.number()]).optional(),
    pointCountMode: z.enum(['range', 'fixed']).optional(),
    pointCountValue: z.number().optional(),
    openProbability: z.number().optional(),
    curvatureRange: z.tuple([z.number(), z.number()]).optional(),
    curvatureMode: z.enum(['range', 'fixed']).optional(),
    curvatureValue: z.number().optional(),
    spreadRange: z.tuple([z.number(), z.number()]).optional(),
    spreadMode: z.enum(['range', 'fixed']).optional(),
    spreadValue: z.number().optional(),
    patternType: z.number().optional(),
    waveHeight: z.number().optional(),
    waveFrequency: z.number().optional(),
    wavePhase: z.number().optional(),
    spiralTurns: z.number().optional(),
    spiralTightness: z.number().optional(),
    arcSweep: z.number().optional(),
    organicJitter: z.number().optional(),
    closeAverageProbability: z.number().optional(),
    curveTension: z.number().optional(),
    curveTensionMode: z.enum(['range', 'fixed']).optional(),
    curveTensionValue: z.number().optional(),
    curveTensionRange: z.tuple([z.number(), z.number()]).optional(),
    endpointContinuous: z.boolean().optional(),
    jitterAlongNormal: z.boolean().optional(),
    jitterDirection: z.enum(['both', 'outward', 'inward']).optional(),
    strokeCapProbabilities: z.object({
      round: z.number(),
      square: z.number(),
      butt: z.number()
    }).optional(),
    patternResample: z.boolean().optional(),
    patternResampleManual: z.boolean().optional(),
    patternResampleAmountMode: z.enum(['fixed', 'range']).optional(),
    patternResampleAmountValue: z.number().optional(),
    patternResampleAmountRange: z.tuple([z.number(), z.number()]).optional()
  }).optional(),
  'smooth-spline': z.object({
    pointCountRange: z.tuple([z.number(), z.number()]).optional(),
    pointCountMode: z.enum(['range', 'fixed']).optional(),
    pointCountValue: z.number().optional(),
    openProbability: z.number().optional(),
    strokeCapProbabilities: z.object({
      round: z.number(),
      square: z.number(),
      butt: z.number()
    }).optional(),
    curvatureRange: z.tuple([z.number(), z.number()]).optional(),
    curvatureMode: z.enum(['range', 'fixed']).optional(),
    curvatureValue: z.number().optional(),
    spreadRange: z.tuple([z.number(), z.number()]).optional(),
    spreadMode: z.enum(['range', 'fixed']).optional(),
    spreadValue: z.number().optional(),
    patternType: z.number().optional(),
    waveHeight: z.number().optional(),
    waveFrequency: z.number().optional(),
    wavePhase: z.number().optional(),
    spiralTurns: z.number().optional(),
    spiralTightness: z.number().optional(),
    arcSweep: z.number().optional(),
    organicJitter: z.number().optional(),
    patternResample: z.boolean().optional(),
    patternResampleManual: z.boolean().optional(),
    patternResampleAmountMode: z.enum(['fixed', 'range']).optional(),
    patternResampleAmountValue: z.number().optional(),
    patternResampleAmountRange: z.tuple([z.number(), z.number()]).optional(),
    curveLengthRange: z.tuple([z.number(), z.number()]).optional(),
    curveLengthMode: z.enum(['range', 'fixed', 'incremental']).optional(),
    curveLengthValue: z.number().optional(),
    curveLengthStartValue: z.number().optional(),
    curveLengthIncrement: z.number().optional()
  }).optional(),
  chunk: z.object({}).optional(),
  blob: z.object({}).optional(),
  'spline-circle': z.object({
    // Spline-circle has no configurable properties
  }).optional(),
  'spline-ellipse': z.object({
    // Spline-ellipse has no configurable properties
  }).optional(),
  'spline-ring': z.object({
    innerRadiusRange: z.tuple([z.number(), z.number()]).optional(),
    innerRadiusMode: z.enum(['range', 'fixed']).optional(),
    innerRadiusValue: z.number().optional()
  }).optional()
});

// Comprehensive BatchConfigSettings Zod schema
export const BatchConfigSettingsSchema = z.object({
  selectedPreset: z.string(),
  
  // Distribution settings
  distributionLayoutEnabled: z.boolean(),
  distributionPattern: z.enum(['grid', 'wave', 'ellipse', 'spiral', 'auto-distribute']),
  copyToPointsEnabled: z.boolean().default(false),
  autoDistributeXCount: z.number().optional(),
  autoDistributeYCount: z.number().optional(),
  gridRows: z.number(),
  gridColumns: z.number(),
  gridCreationOrder: z.enum(['rows', 'columns']).default('rows'),
  gridHorizontalDirection: z.enum(['left-to-right', 'right-to-left']).default('left-to-right'),
  gridVerticalDirection: z.enum(['top-to-bottom', 'bottom-to-top']).default('top-to-bottom'),
  gridFillEnabled: z.boolean().default(false),
  gridStartX: z.number(),
  gridStartY: z.number(),
  gridRowOffset: z.number(),
  gridColumnOffset: z.number(),
  gridMarginEnabled: z.boolean(),
  gridMarginMode: z.enum(['absolute', 'relative']).default('absolute'),
  gridMarginUnit: z.enum(['px', '%']).default('px'),
  gridMarginTop: z.number(),
  gridMarginRight: z.number(),
  gridMarginBottom: z.number(),
  gridMarginLeft: z.number(),
  gridGutterEnabled: z.boolean().default(false),
  gridGutterX: z.number().default(0),
  gridGutterY: z.number().default(0),
  gridSortBy: z.enum(['layer', 'id', 'shape-type', 'fill-color', 'opacity', 'size', 'angle', 'creation-time', 'none',
    'corner-radius', 'point-count', 'edge-count', 'inner-radius', 'segment-count', 
    'direction', 'length', 'centroid', 'spread', 'curvature']),
  gridSortScope: z.enum(['per-generation', 'per-batch']),
  gridSortOrder: z.enum(['ascending', 'descending']),
  gridGroupByShapeType: z.boolean(),
  gridReverseGroups: z.boolean(),
  gridXRandomization: z.number(),
  gridYRandomization: z.number(),
  
  waveType: z.enum(['sine', 'triangle', 'square', 'sawtooth']),
  waveAmplitude: z.number(),
  waveFrequency: z.number(),
  waveDirection: z.enum(['horizontal', 'vertical']),
  wavePhaseOffset: z.number(),
  
  ellipseXRadius: z.tuple([z.number(), z.number()]),
  ellipseYRadius: z.tuple([z.number(), z.number()]),
  ellipseRingCount: z.number(),
  ellipseRingSpacing: z.enum(['even', 'progressive']),
  ellipseRotation: z.number(),
  ellipseRotationAlignment: z.enum(['uniform', 'progressive']),
  ellipseAlignToRing: z.boolean(),
  ellipseFlipInward: z.boolean(),
  ellipseAdditionalRotation: z.number(),
  ellipseShapeRotationMode: z.enum(['none', 'fixed', 'range', 'incremental', 'series']),
  ellipseRotationFixed: z.number(),
  ellipseRotationRange: z.tuple([z.number(), z.number()]),
  ellipseRotationIncrementalStart: z.number(),
  ellipseRotationIncrementalStep: z.number(),
  ellipseShapeRotationSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])),
  ellipseShapeRotationSeriesSelection: z.enum(['sequential', 'random']),
  ellipseShapeRotationSeriesExhaustion: z.enum(['cycle', 'bounce']),
  ellipseShapeRotationSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  ellipseShapeRotationSeriesStagingMode: z.enum(['fixed', 'range']),
  
  spiralTurnCount: z.number(),
  spiralSpacingMode: z.enum(['linear', 'logarithmic']),
  spiralDirection: z.enum(['clockwise', 'counterclockwise']),
  spiralStartAngle: z.number(),
  spiralTightness: z.number(),
  
  tangentAlignment: z.boolean(),
  segmentDistribution: z.enum(['even', 'clustered']),
  reverseDirection: z.boolean(),
  
  // Generation count
  generationCountMode: z.enum(['range', 'fixed', 'incremental']),
  generationCountDefine: z.number(),
  generationCountStartValue: z.number(),
  generationCountIncrement: z.number(),
  generationCountResetPerBatch: z.boolean(),
  generationCountModulationEnabled: z.boolean(),
  generationCountModulationValue: z.number(),
  
  // Blend modes
  blendModeEnabled: z.boolean(),
  enabledBlendModes: z.record(BlendModeSchema, z.number().min(0).max(100)).optional(),
  
  // Compositing operations
  compositingOperationsEnabled: z.boolean(),
  enabledCompositingOperations: z.record(z.string(), z.number().min(0).max(100)).optional(),
  
  // Properties
  propertiesEnabled: z.boolean(),
  shapePropertiesEnabled: z.boolean(),
  shapePropertiesDimensionsEnabled: z.boolean(),
  shapePropertiesPositionEnabled: z.boolean(),
  
  // Basic shape properties
  widthRange: z.tuple([z.number(), z.number()]),
  heightRange: z.tuple([z.number(), z.number()]),
  xPositionRange: z.tuple([z.number(), z.number()]),
  yPositionRange: z.tuple([z.number(), z.number()]),
  
  // Enhanced width/height
  widthMode: z.enum(['range', 'value', 'incremental', 'series']),
  heightMode: z.enum(['range', 'value', 'incremental', 'series']),
  sizeIncrementalResetPerBatch: z.boolean(),
  sizeConstraintMode: z.enum(['none', 'min', 'max', 'avg']),
  stretchShapeToDimensions: z.boolean(),
  widthValue: z.number(),
  heightValue: z.number(),
  widthIncrement: z.number(),
  heightIncrement: z.number(),
  widthStartValue: z.number(),
  heightStartValue: z.number(),
  widthModulationEnabled: z.boolean(),
  widthModulationValue: z.number(),
  widthStartOffset: z.number().optional().default(0),
  widthStartOffsetCompound: z.boolean().optional().default(false),
  widthWrapOffset: z.number().optional().default(0),
  widthWrapOffsetCompound: z.boolean().optional().default(false),
  widthModulationBounce: z.boolean().optional().default(false),
  heightModulationEnabled: z.boolean(),
  heightModulationValue: z.number(),
  heightStartOffset: z.number().optional().default(0),
  heightStartOffsetCompound: z.boolean().optional().default(false),
  heightWrapOffset: z.number().optional().default(0),
  heightWrapOffsetCompound: z.boolean().optional().default(false),
  heightModulationBounce: z.boolean().optional().default(false),
  sizeIncrementalIndexDriver: IncrementalIndexDriverSchema,
  widthSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])),
  widthSeriesSelection: z.enum(['sequential', 'random']),
  widthSeriesExhaustion: z.enum(['cycle', 'bounce']),
  widthSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  widthSeriesStagingMode: z.enum(['fixed', 'range']),
  heightSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])),
  heightSeriesSelection: z.enum(['sequential', 'random']),
  heightSeriesExhaustion: z.enum(['cycle', 'bounce']),
  heightSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  heightSeriesStagingMode: z.enum(['fixed', 'range']),
  minimumSize: z.number(),
  maximumSize: z.number(),
  
  // Enhanced positions
  positionCoordSystem: z.enum(['cartesian', 'polar']),
  xPositionMode: z.enum(['range', 'value', 'incremental', 'series']),
  yPositionMode: z.enum(['range', 'value', 'incremental', 'series']),
  incrementalResetPerBatch: z.boolean(),
  directionalEvenDistribution: z.boolean(),
  directionalClusterAngle: z.number(),
  xPositionValue: z.number(),
  yPositionValue: z.number(),
  positionDirectionalMode: z.enum(['outward-center', 'outward-edge', 'angle-based']),
  positionDirectionalAngle: z.number(),
  positionDirectionalDistance: z.number(),
  xPositionIncrement: z.number(),
  yPositionIncrement: z.number(),
  xPositionStartValue: z.number(),
  yPositionStartValue: z.number(),
  xPositionModulationMode: z.enum(['off', 'grid-col', 'pixel-value', 'shape-count']),
  xPositionModulationValue: z.number(),
  yPositionModulationMode: z.enum(['off', 'grid-row', 'pixel-value', 'shape-count']),
  yPositionModulationValue: z.number(),
  positionIncrementalIndexDriver: IncrementalIndexDriverSchema,
  xPositionSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])),
  xPositionSeriesSelection: z.enum(['sequential', 'random']),
  xPositionSeriesExhaustion: z.enum(['cycle', 'bounce']),
  xPositionSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  xPositionSeriesStagingMode: z.enum(['fixed', 'range']),
  yPositionSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])),
  yPositionSeriesSelection: z.enum(['sequential', 'random']),
  yPositionSeriesExhaustion: z.enum(['cycle', 'bounce']),
  yPositionSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  yPositionSeriesStagingMode: z.enum(['fixed', 'range']),
  polarAngleMode: z.enum(['value', 'range', 'incremental', 'series']),
  polarAngleValue: z.number(),
  polarAngleRange: z.tuple([z.number(), z.number()]),
  polarAngleStartValue: z.number(),
  polarAngleIncrement: z.number(),
  polarAngleModulationMode: z.enum(['off', 'grid-col', 'pixel-value', 'shape-count']),
  polarAngleModulationValue: z.number(),
  polarAngleSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])),
  polarAngleSeriesSelection: z.enum(['sequential', 'random']),
  polarAngleSeriesExhaustion: z.enum(['cycle', 'bounce']),
  polarAngleSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  polarAngleSeriesStagingMode: z.enum(['fixed', 'range']),
  polarRadiusMode: z.enum(['value', 'range', 'incremental', 'series']),
  polarRadiusValue: z.number(),
  polarRadiusRange: z.tuple([z.number(), z.number()]),
  polarRadiusStartValue: z.number(),
  polarRadiusIncrement: z.number(),
  polarRadiusModulationMode: z.enum(['off', 'grid-col', 'pixel-value', 'shape-count']),
  polarRadiusModulationValue: z.number(),
  polarRadiusSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])),
  polarRadiusSeriesSelection: z.enum(['sequential', 'random']),
  polarRadiusSeriesExhaustion: z.enum(['cycle', 'bounce']),
  polarRadiusSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  polarRadiusSeriesStagingMode: z.enum(['fixed', 'range']),
  positionAnchorMode: z.enum(['fixed', 'range', 'incremental', 'sequence']),
  positionAnchorFixed: z.string(),
  positionAnchorFrom: z.string(),
  positionAnchorTo: z.string(),
  positionAnchorSequence: z.array(z.string()),
  positionAnchorIncrementalStart: z.number(),
  positionAnchorIncrementalStep: z.number(),
  positionRotateToDirection: z.boolean(),
  
  // Shape-specific properties
  rectangleCornerRadiusMode: z.enum(['range', 'define', 'incremental', 'series']),
  rectangleCornerRadiusRange: z.tuple([z.number(), z.number()]),
  rectangleCornerRadiusDefine: z.number(),
  rectangleCornerRadiusStartValue: z.number(),
  rectangleCornerRadiusIncrement: z.number(),
  rectangleCornerRadiusModulationEnabled: z.boolean(),
  rectangleCornerRadiusModulationValue: z.number(),
  rectangleCornerRadiusIncrementalIndexDriver: IncrementalIndexDriverSchema,
  rectangleCornerRadiusSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])),
  rectangleCornerRadiusSeriesSelection: z.enum(['sequential', 'random']),
  rectangleCornerRadiusSeriesExhaustion: z.enum(['cycle', 'bounce']),
  rectangleCornerRadiusSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  rectangleCornerRadiusSeriesStagingMode: z.enum(['fixed', 'range']),
  
  starInnerRadiusMode: z.enum(['range', 'define', 'incremental', 'series']),
  starInnerRadiusRange: z.tuple([z.number(), z.number()]),
  starInnerRadiusDefine: z.number(),
  starInnerRadiusStartValue: z.number(),
  starInnerRadiusIncrement: z.number(),
  starInnerRadiusModulationEnabled: z.boolean(),
  starInnerRadiusModulationValue: z.number(),
  starInnerRadiusIncrementalIndexDriver: IncrementalIndexDriverSchema,
  starInnerRadiusSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])),
  starInnerRadiusSeriesSelection: z.enum(['sequential', 'random']),
  starInnerRadiusSeriesExhaustion: z.enum(['cycle', 'bounce']),
  starInnerRadiusSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  starInnerRadiusSeriesStagingMode: z.enum(['fixed', 'range']),
  
  ringInnerRadiusMode: z.enum(['range', 'define', 'incremental', 'series']),
  ringInnerRadiusRange: z.tuple([z.number(), z.number()]),
  ringInnerRadiusDefine: z.number(),
  ringInnerRadiusStartValue: z.number(),
  ringInnerRadiusIncrement: z.number(),
  ringInnerRadiusModulationEnabled: z.boolean(),
  ringInnerRadiusModulationValue: z.number(),
  ringInnerRadiusIncrementalIndexDriver: IncrementalIndexDriverSchema,
  ringInnerRadiusSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])),
  ringInnerRadiusSeriesSelection: z.enum(['sequential', 'random']),
  ringInnerRadiusSeriesExhaustion: z.enum(['cycle', 'bounce']),
  ringInnerRadiusSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  ringInnerRadiusSeriesStagingMode: z.enum(['fixed', 'range']),
  
  // Fill properties
  fillEnabled: z.boolean(),
  fillSolidEnabled: z.boolean(),
  fillStyleProbability: z.number(),
  fillColorMode: z.enum(['range', 'palette', 'define', 'series']),
  fillColorRange: z.tuple([z.string(), z.string()]),
  fillColorRangeFlip: z.boolean(),
  fillColorPalette: z.array(z.string()),
  fillColorPaletteBehavior: z.enum(['cycle', 'blend']).optional().default('cycle'),
  fillColorPaletteDistribution: z.enum(['manual', 'even', 'logarithmic', 'exponential']).optional().default('even'),
  fillColorPaletteInterpolation: z.enum(['linear', 'sine', 'exponential', 'logarithmic', 'bounce', 'zigzag', 'sawtooth']).optional().default('linear'),
  fillColorPaletteAssignments: z.array(z.object({
    shapeNumber: z.number().int().positive(),
    paletteIndex: z.number().int().nonnegative(),
  })).optional().default([]),
  fillColorDefine: z.string(),
  fillColorSaturationMode: z.enum(['fixed', 'range']).optional().default('range'),
  fillColorSaturationFixed: z.number().optional().default(75),
  fillColorSaturationRange: z.tuple([z.number(), z.number()]),
  fillColorLightnessMode: z.enum(['fixed', 'range']).optional().default('range'),
  fillColorLightnessFixed: z.number().optional().default(50),
  fillColorLightnessRange: z.tuple([z.number(), z.number()]),
  
  // Fill gradient properties
  fillGradientEnabled: z.boolean(),
  fillGradientLinearProbability: z.number(),
  fillGradientRadialProbability: z.number(),
  fillGradientConicProbability: z.number(),
  fillGradientDiamondProbability: z.number().optional().default(0),
  fillGradientColorMode: z.enum(['range', 'palette', 'define']),
  fillGradientColorRange: z.tuple([z.string(), z.string()]),
  fillGradientColorRangeFlip: z.boolean(),
  fillGradientColorPalette: z.array(z.string()),
  fillGradientColorDefine: z.array(z.string()),
  fillGradientColorSaturationRange: z.tuple([z.number(), z.number()]),
  fillGradientColorLightnessRange: z.tuple([z.number(), z.number()]),
  fillGradientStopsMode: z.enum(['fixed', 'range']),
  fillGradientStopsCount: z.number(),
  fillGradientStopsRange: z.tuple([z.number(), z.number()]),
  fillGradientStopDistribution: z.enum(['even', 'random']),
  fillGradientStopsReverse: z.boolean(),
  fillGradientLinearDirection: z.enum(['fixed', 'range', 'predefined', 'series']),
  fillGradientLinearAngle: z.number(),
  fillGradientLinearAngleRange: z.tuple([z.number(), z.number()]),
  fillGradientLinearPredefined: z.enum(['horizontal', 'vertical', 'diagonal-down', 'diagonal-up']),
  fillGradientLinearAlignToShape: z.boolean(),
  fillGradientLinearSeriesItems: z.array(z.object({
    direction: z.enum(['fixed', 'range', 'predefined']),
    angle: z.number().optional(),
    angleRange: z.tuple([z.number(), z.number()]).optional(),
    predefined: z.string().optional(),
  })),
  fillGradientLinearSeriesMixed: z.boolean(),
  fillGradientLinearSeriesStagingMode: z.enum(['fixed', 'range', 'predefined']),
  fillGradientLinearSeriesSelection: z.enum(['sequential', 'random']),
  fillGradientLinearSeriesExhaustion: z.enum(['cycle', 'bounce']),
  fillGradientLinearSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  fillGradientLinearCenter: z.enum(['center', 'corners', 'midpoints', 'coordinates']).optional().default('center'),
  fillGradientLinearCorners: z.object({ topLeft: z.boolean(), topRight: z.boolean(), bottomLeft: z.boolean(), bottomRight: z.boolean() }).optional().default({ topLeft: true, topRight: true, bottomLeft: true, bottomRight: true }),
  fillGradientLinearMidpoints: z.object({ top: z.boolean(), right: z.boolean(), bottom: z.boolean(), left: z.boolean() }).optional().default({ top: true, right: true, bottom: true, left: true }),
  fillGradientLinearSelectionMode: z.enum(['random', 'cycle']).optional().default('random'),
  fillGradientLinearCenterXMode: z.enum(['fixed', 'range', 'incremental', 'series']).optional().default('fixed'),
  fillGradientLinearCenterX: z.number().optional().default(50),
  fillGradientLinearCenterXRange: z.tuple([z.number(), z.number()]).optional().default([25, 75]),
  fillGradientLinearCenterXStartValue: z.number().optional().default(50),
  fillGradientLinearCenterXIncrement: z.number().optional().default(10),
  fillGradientLinearCenterXModulationEnabled: z.boolean().optional().default(false),
  fillGradientLinearCenterXModulationValue: z.number().optional().default(100),
  fillGradientLinearCenterXSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  fillGradientLinearCenterXSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  fillGradientLinearCenterXSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  fillGradientLinearCenterXSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  fillGradientLinearCenterXSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  fillGradientLinearCenterYMode: z.enum(['fixed', 'range', 'incremental', 'series']).optional().default('fixed'),
  fillGradientLinearCenterY: z.number().optional().default(50),
  fillGradientLinearCenterYRange: z.tuple([z.number(), z.number()]).optional().default([25, 75]),
  fillGradientLinearCenterYStartValue: z.number().optional().default(50),
  fillGradientLinearCenterYIncrement: z.number().optional().default(10),
  fillGradientLinearCenterYModulationEnabled: z.boolean().optional().default(false),
  fillGradientLinearCenterYModulationValue: z.number().optional().default(100),
  fillGradientLinearCenterYSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  fillGradientLinearCenterYSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  fillGradientLinearCenterYSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  fillGradientLinearCenterYSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  fillGradientLinearCenterYSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  fillGradientLinearScaleMode: z.enum(['fixed', 'range', 'incremental', 'series']).optional().default('fixed'),
  fillGradientLinearScale: z.number().optional().default(100),
  fillGradientLinearScaleRange: z.tuple([z.number(), z.number()]).optional().default([50, 150]),
  fillGradientLinearScaleStartValue: z.number().optional().default(100),
  fillGradientLinearScaleIncrement: z.number().optional().default(10),
  fillGradientLinearScaleSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  fillGradientLinearScaleSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  fillGradientLinearScaleSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  fillGradientLinearScaleSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  fillGradientLinearScaleSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  fillGradientRadialCenter: z.enum(['center', 'corners', 'midpoints', 'coordinates']),
  
  // Radial Gradient Center X
  fillGradientRadialCenterXMode: z.enum(['fixed', 'range', 'incremental', 'series']),
  fillGradientRadialCenterX: z.number(),
  fillGradientRadialCenterXRange: z.tuple([z.number(), z.number()]),
  fillGradientRadialCenterXStartValue: z.number(),
  fillGradientRadialCenterXIncrement: z.number(),
  fillGradientRadialCenterXModulationEnabled: z.boolean(),
  fillGradientRadialCenterXModulationValue: z.number(),
  fillGradientRadialCenterXSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])).optional().default([]),
  fillGradientRadialCenterXSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  fillGradientRadialCenterXSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  fillGradientRadialCenterXSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  fillGradientRadialCenterXSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  
  // Radial Gradient Center Y
  fillGradientRadialCenterYMode: z.enum(['fixed', 'range', 'incremental', 'series']),
  fillGradientRadialCenterY: z.number(),
  fillGradientRadialCenterYRange: z.tuple([z.number(), z.number()]),
  fillGradientRadialCenterYStartValue: z.number(),
  fillGradientRadialCenterYIncrement: z.number(),
  fillGradientRadialCenterYModulationEnabled: z.boolean(),
  fillGradientRadialCenterYModulationValue: z.number(),
  fillGradientRadialCenterYSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])).optional().default([]),
  fillGradientRadialCenterYSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  fillGradientRadialCenterYSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  fillGradientRadialCenterYSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  fillGradientRadialCenterYSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  fillGradientRadialScaleMode: z.enum(['fixed', 'range', 'incremental', 'series']).optional().default('fixed'),
  fillGradientRadialScale: z.number().optional().default(100),
  fillGradientRadialScaleRange: z.tuple([z.number(), z.number()]).optional().default([50, 150]),
  fillGradientRadialScaleStartValue: z.number().optional().default(100),
  fillGradientRadialScaleIncrement: z.number().optional().default(10),
  fillGradientRadialScaleSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  fillGradientRadialScaleSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  fillGradientRadialScaleSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  fillGradientRadialScaleSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  fillGradientRadialScaleSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  
  fillGradientRadialCorners: z.object({
    topLeft: z.boolean(),
    topRight: z.boolean(),
    bottomLeft: z.boolean(),
    bottomRight: z.boolean()
  }),
  fillGradientRadialMidpoints: z.object({
    top: z.boolean(),
    right: z.boolean(),
    bottom: z.boolean(),
    left: z.boolean()
  }),
  fillGradientRadialSelectionMode: z.enum(['random', 'cycle']),
  fillGradientRadialShape: z.enum(['circle', 'ellipse', 'auto']),
  fillGradientRadialCircleProbability: z.number(),
  fillGradientRadialEllipseProbability: z.number(),
  fillGradientMatchShape: z.boolean(),
  fillGradientTypeDirectionEnabled: z.boolean(),

  // Diamond Gradient Position
  fillGradientDiamondCenter: z.enum(['center', 'corners', 'midpoints', 'coordinates']).optional().default('center'),
  fillGradientDiamondCorners: z.object({ topLeft: z.boolean(), topRight: z.boolean(), bottomLeft: z.boolean(), bottomRight: z.boolean() }).optional().default({ topLeft: true, topRight: true, bottomLeft: true, bottomRight: true }),
  fillGradientDiamondMidpoints: z.object({ top: z.boolean(), right: z.boolean(), bottom: z.boolean(), left: z.boolean() }).optional().default({ top: true, right: true, bottom: true, left: true }),
  fillGradientDiamondSelectionMode: z.enum(['random', 'cycle']).optional().default('random'),

  // Diamond Gradient Angle
  fillGradientDiamondAngleMode: z.enum(['fixed', 'range', 'incremental', 'series']).optional().default('fixed'),
  fillGradientDiamondAngle: z.number().optional().default(0),
  fillGradientDiamondAngleRange: z.tuple([z.number(), z.number()]).optional().default([0, 360]),
  fillGradientDiamondAngleStartValue: z.number().optional().default(0),
  fillGradientDiamondAngleIncrement: z.number().optional().default(30),
  fillGradientDiamondAngleModulationEnabled: z.boolean().optional().default(false),
  fillGradientDiamondAngleModulationValue: z.number().optional().default(360),
  fillGradientDiamondAngleModulationBounce: z.boolean().optional().default(false),
  fillGradientDiamondAngleSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])).optional().default([]),
  fillGradientDiamondAngleSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  fillGradientDiamondAngleSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  fillGradientDiamondAngleSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  fillGradientDiamondAngleSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),

  // Diamond Gradient Center X
  fillGradientDiamondCenterXMode: z.enum(['fixed', 'range', 'incremental', 'series']).optional().default('fixed'),
  fillGradientDiamondCenterX: z.number().optional().default(50),
  fillGradientDiamondCenterXRange: z.tuple([z.number(), z.number()]).optional().default([25, 75]),
  fillGradientDiamondCenterXStartValue: z.number().optional().default(50),
  fillGradientDiamondCenterXIncrement: z.number().optional().default(10),
  fillGradientDiamondCenterXModulationEnabled: z.boolean().optional().default(false),
  fillGradientDiamondCenterXModulationValue: z.number().optional().default(100),
  fillGradientDiamondCenterXSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])).optional().default([]),
  fillGradientDiamondCenterXSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  fillGradientDiamondCenterXSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  fillGradientDiamondCenterXSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  fillGradientDiamondCenterXSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),

  // Diamond Gradient Center Y
  fillGradientDiamondCenterYMode: z.enum(['fixed', 'range', 'incremental', 'series']).optional().default('fixed'),
  fillGradientDiamondCenterY: z.number().optional().default(50),
  fillGradientDiamondCenterYRange: z.tuple([z.number(), z.number()]).optional().default([25, 75]),
  fillGradientDiamondCenterYStartValue: z.number().optional().default(50),
  fillGradientDiamondCenterYIncrement: z.number().optional().default(10),
  fillGradientDiamondCenterYModulationEnabled: z.boolean().optional().default(false),
  fillGradientDiamondCenterYModulationValue: z.number().optional().default(100),
  fillGradientDiamondCenterYSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])).optional().default([]),
  fillGradientDiamondCenterYSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  fillGradientDiamondCenterYSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  fillGradientDiamondCenterYSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  fillGradientDiamondCenterYSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  fillGradientDiamondScaleMode: z.enum(['fixed', 'range', 'incremental', 'series']).optional().default('fixed'),
  fillGradientDiamondScale: z.number().optional().default(100),
  fillGradientDiamondScaleRange: z.tuple([z.number(), z.number()]).optional().default([50, 150]),
  fillGradientDiamondScaleStartValue: z.number().optional().default(100),
  fillGradientDiamondScaleIncrement: z.number().optional().default(10),
  fillGradientDiamondScaleSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  fillGradientDiamondScaleSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  fillGradientDiamondScaleSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  fillGradientDiamondScaleSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  fillGradientDiamondScaleSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  fillGradientDiamondScaleEdgeMode: z.enum(['streak', 'repeat']).optional().default('streak'),
  gradientScaleIncrementalIndexDriver: IncrementalIndexDriverSchema.optional().default('shapeIndex'),

  fillGradientConicCenter: z.enum(['center', 'corners', 'midpoints', 'coordinates']),
  fillGradientConicCorners: z.object({
    topLeft: z.boolean(),
    topRight: z.boolean(),
    bottomLeft: z.boolean(),
    bottomRight: z.boolean()
  }),
  fillGradientConicMidpoints: z.object({
    top: z.boolean(),
    right: z.boolean(),
    bottom: z.boolean(),
    left: z.boolean()
  }),
  fillGradientConicSelectionMode: z.enum(['random', 'cycle']),
  
  // Conic Gradient Start Angle
  fillGradientConicAngleMode: z.enum(['fixed', 'range', 'incremental', 'series']),
  fillGradientConicAngle: z.number(),
  fillGradientConicAngleRange: z.tuple([z.number(), z.number()]),
  fillGradientConicAngleStartValue: z.number(),
  fillGradientConicAngleIncrement: z.number(),
  fillGradientConicAngleModulationEnabled: z.boolean(),
  fillGradientConicAngleModulationValue: z.number(),
  fillGradientConicAngleModulationBounce: z.boolean().optional().default(false),
  fillGradientConicAngleSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])).optional().default([]),
  fillGradientConicAngleSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  fillGradientConicAngleSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  fillGradientConicAngleSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  fillGradientConicAngleSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  
  // Conic Gradient Center X
  fillGradientConicCenterXMode: z.enum(['fixed', 'range', 'incremental', 'series']),
  fillGradientConicCenterX: z.number(),
  fillGradientConicCenterXRange: z.tuple([z.number(), z.number()]),
  fillGradientConicCenterXStartValue: z.number(),
  fillGradientConicCenterXIncrement: z.number(),
  fillGradientConicCenterXModulationEnabled: z.boolean(),
  fillGradientConicCenterXModulationValue: z.number(),
  fillGradientConicCenterXSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])).optional().default([]),
  fillGradientConicCenterXSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  fillGradientConicCenterXSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  fillGradientConicCenterXSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  fillGradientConicCenterXSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  
  // Conic Gradient Center Y
  fillGradientConicCenterYMode: z.enum(['fixed', 'range', 'incremental', 'series']),
  fillGradientConicCenterY: z.number(),
  fillGradientConicCenterYRange: z.tuple([z.number(), z.number()]),
  fillGradientConicCenterYStartValue: z.number(),
  fillGradientConicCenterYIncrement: z.number(),
  fillGradientConicCenterYModulationEnabled: z.boolean(),
  fillGradientConicCenterYModulationValue: z.number(),
  fillGradientConicCenterYSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])).optional().default([]),
  fillGradientConicCenterYSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  fillGradientConicCenterYSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  fillGradientConicCenterYSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  fillGradientConicCenterYSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  gradientCenterIncrementalIndexDriver: IncrementalIndexDriverSchema,
  
  // Fill opacity
  fillOpacityEnabled: z.boolean(),
  fillOpacityMode: z.enum(['range', 'define', 'incremental', 'palette', 'series']),
  fillOpacityRange: z.tuple([z.number(), z.number()]),
  fillOpacityDefine: z.number(),
  fillOpacityPalette: z.array(z.number()).optional().default([25, 50, 75, 100]),
  fillOpacityStartValue: z.number(),
  fillOpacityIncrement: z.number(),
  fillOpacityModulationEnabled: z.boolean(),
  fillOpacityModulationValue: z.number(),
  fillOpacityModulationBounce: z.boolean().optional().default(false),
  fillOpacityIncrementalIndexDriver: IncrementalIndexDriverSchema,
  fillOpacitySeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])).optional().default([]),
  fillOpacitySeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  fillOpacitySeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  fillOpacitySeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  fillOpacitySeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  openCurveFillProbability: z.number().optional().default(100),
  
  // Blur properties
  blurEnabled: z.boolean(),
  blurType: z.enum(['box', 'gaussian']).default('box'),
  blurProbability: z.number(),
  blurMode: z.enum(['range', 'define', 'incremental', 'series']),
  blurRange: z.tuple([z.number(), z.number()]),
  blurDefine: z.number(),
  blurStartValue: z.number(),
  blurIncrement: z.number(),
  blurModulationEnabled: z.boolean(),
  blurModulationValue: z.number(),
  blurStartOffset: z.number().optional().default(0),
  blurStartOffsetCompound: z.boolean().optional().default(false),
  blurWrapOffset: z.number().optional().default(0),
  blurWrapOffsetCompound: z.boolean().optional().default(false),
  blurModulationBounce: z.boolean().optional().default(false),
  blurIncrementalIndexDriver: IncrementalIndexDriverSchema,
  blurSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])).optional().default([]),
  blurSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  blurSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  blurSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  blurSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  
  // Drop Shadow properties
  dropShadowEnabled: z.boolean(),
  dropShadowProbability: z.number(),
  dropShadowColorMode: z.enum(['auto', 'custom']),
  dropShadowCustomColor: z.string(),
  dropShadowColorDarken: z.number(),
  dropShadowBlendMode: z.enum(['multiply', 'darken', 'overlay']),
  dropShadowOffsetXMode: z.enum(['range', 'define', 'incremental', 'series']),
  dropShadowOffsetX: z.number(),
  dropShadowOffsetXRange: z.tuple([z.number(), z.number()]),
  dropShadowOffsetXStartValue: z.number(),
  dropShadowOffsetXIncrement: z.number(),
  dropShadowOffsetXSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  dropShadowOffsetXSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  dropShadowOffsetXSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  dropShadowOffsetXSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  dropShadowOffsetXSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  dropShadowOffsetYMode: z.enum(['range', 'define', 'incremental', 'series']),
  dropShadowOffsetY: z.number(),
  dropShadowOffsetYRange: z.tuple([z.number(), z.number()]),
  dropShadowOffsetYStartValue: z.number(),
  dropShadowOffsetYIncrement: z.number(),
  dropShadowOffsetYSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  dropShadowOffsetYSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  dropShadowOffsetYSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  dropShadowOffsetYSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  dropShadowOffsetYSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  dropShadowBlurMode: z.enum(['range', 'define', 'incremental', 'series']),
  dropShadowBlur: z.number(),
  dropShadowBlurRange: z.tuple([z.number(), z.number()]),
  dropShadowBlurStartValue: z.number(),
  dropShadowBlurIncrement: z.number(),
  dropShadowBlurSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  dropShadowBlurSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  dropShadowBlurSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  dropShadowBlurSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  dropShadowBlurSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  dropShadowSpreadMode: z.enum(['range', 'define', 'incremental', 'series']),
  dropShadowSpread: z.number(),
  dropShadowSpreadRange: z.tuple([z.number(), z.number()]),
  dropShadowSpreadStartValue: z.number(),
  dropShadowSpreadIncrement: z.number(),
  dropShadowSpreadSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  dropShadowSpreadSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  dropShadowSpreadSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  dropShadowSpreadSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  dropShadowSpreadSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  dropShadowOpacity: z.number(),
  dropShadowIncrementalIndexDriver: IncrementalIndexDriverSchema,
  
  // Outer Glow properties
  outerGlowEnabled: z.boolean(),
  outerGlowProbability: z.number(),
  outerGlowColorMode: z.enum(['auto', 'custom']),
  outerGlowCustomColor: z.string(),
  outerGlowColorSaturate: z.number(),
  outerGlowBlendMode: z.enum(['screen', 'add', 'soft-light', 'color-dodge', 'lighter']),
  outerGlowBlurMode: z.enum(['range', 'define', 'incremental', 'series']),
  outerGlowBlur: z.number(),
  outerGlowBlurRange: z.tuple([z.number(), z.number()]),
  outerGlowBlurStartValue: z.number(),
  outerGlowBlurIncrement: z.number(),
  outerGlowBlurSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  outerGlowBlurSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  outerGlowBlurSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  outerGlowBlurSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  outerGlowBlurSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  outerGlowSpreadMode: z.enum(['range', 'define', 'incremental', 'series']),
  outerGlowSpread: z.number(),
  outerGlowSpreadRange: z.tuple([z.number(), z.number()]),
  outerGlowSpreadStartValue: z.number(),
  outerGlowSpreadIncrement: z.number(),
  outerGlowSpreadSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  outerGlowSpreadSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  outerGlowSpreadSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  outerGlowSpreadSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  outerGlowSpreadSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  outerGlowOpacity: z.number(),
  outerGlowIncrementalIndexDriver: IncrementalIndexDriverSchema,
  
  // Inner Shadow properties
  innerShadowEnabled: z.boolean(),
  innerShadowProbability: z.number(),
  innerShadowColorMode: z.enum(['auto', 'custom']),
  innerShadowCustomColor: z.string(),
  innerShadowColorDarken: z.number(),
  innerShadowBlendMode: z.enum(['multiply', 'darken', 'overlay']),
  innerShadowOffsetXMode: z.enum(['range', 'define', 'incremental', 'series']),
  innerShadowOffsetX: z.number(),
  innerShadowOffsetXRange: z.tuple([z.number(), z.number()]),
  innerShadowOffsetXStartValue: z.number(),
  innerShadowOffsetXIncrement: z.number(),
  innerShadowOffsetXSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  innerShadowOffsetXSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  innerShadowOffsetXSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  innerShadowOffsetXSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  innerShadowOffsetXSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  innerShadowOffsetYMode: z.enum(['range', 'define', 'incremental', 'series']),
  innerShadowOffsetY: z.number(),
  innerShadowOffsetYRange: z.tuple([z.number(), z.number()]),
  innerShadowOffsetYStartValue: z.number(),
  innerShadowOffsetYIncrement: z.number(),
  innerShadowOffsetYSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  innerShadowOffsetYSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  innerShadowOffsetYSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  innerShadowOffsetYSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  innerShadowOffsetYSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  innerShadowBlurMode: z.enum(['range', 'define', 'incremental', 'series']),
  innerShadowBlur: z.number(),
  innerShadowBlurRange: z.tuple([z.number(), z.number()]),
  innerShadowBlurStartValue: z.number(),
  innerShadowBlurIncrement: z.number(),
  innerShadowBlurSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  innerShadowBlurSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  innerShadowBlurSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  innerShadowBlurSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  innerShadowBlurSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  innerShadowOpacity: z.number(),
  innerShadowIncrementalIndexDriver: IncrementalIndexDriverSchema,
  
  // Inner Glow properties
  innerGlowEnabled: z.boolean(),
  innerGlowProbability: z.number(),
  innerGlowColorMode: z.enum(['auto', 'custom']),
  innerGlowCustomColor: z.string(),
  innerGlowColorSaturate: z.number(),
  innerGlowBlendMode: z.enum(['screen', 'add', 'soft-light', 'color-dodge', 'lighter']),
  innerGlowBlurMode: z.enum(['range', 'define', 'incremental', 'series']),
  innerGlowBlur: z.number(),
  innerGlowBlurRange: z.tuple([z.number(), z.number()]),
  innerGlowBlurStartValue: z.number(),
  innerGlowBlurIncrement: z.number(),
  innerGlowBlurSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  innerGlowBlurSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  innerGlowBlurSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  innerGlowBlurSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  innerGlowBlurSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  innerGlowSpreadMode: z.enum(['range', 'define', 'incremental', 'series']),
  innerGlowSpread: z.number(),
  innerGlowSpreadRange: z.tuple([z.number(), z.number()]),
  innerGlowSpreadStartValue: z.number(),
  innerGlowSpreadIncrement: z.number(),
  innerGlowSpreadSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])).optional().default([]),
  innerGlowSpreadSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  innerGlowSpreadSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  innerGlowSpreadSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  innerGlowSpreadSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  innerGlowOpacity: z.number(),
  innerGlowIncrementalIndexDriver: IncrementalIndexDriverSchema,
  
  // Stroke properties
  strokeEnabled: z.boolean(),
  strokeProbability: z.number(),
  strokeOnlyUnfilled: z.boolean().optional(),
  strokeColorMode: z.enum(['range', 'palette', 'define', 'match-fill', 'series']),
  strokeColorRange: z.tuple([z.string(), z.string()]),
  strokeColorRangeFlip: z.boolean(),
  strokeColorPalette: z.array(z.string()),
  strokeColorDefine: z.string(),
  strokeColorSaturationMode: z.enum(['fixed', 'range', 'match-fill']).optional().default('range'),
  strokeColorSaturationFixed: z.number().optional().default(80),
  strokeColorSaturationRange: z.tuple([z.number(), z.number()]),
  strokeColorLightnessMode: z.enum(['fixed', 'range', 'match-fill']).optional().default('range'),
  strokeColorLightnessFixed: z.number().optional().default(40),
  strokeColorLightnessRange: z.tuple([z.number(), z.number()]),
  strokeColorEnabled: z.boolean(),
  strokeOpacityEnabled: z.boolean(),
  strokeOpacityMode: z.enum(['range', 'define', 'incremental', 'match-fill', 'palette', 'series']),
  strokeOpacityRange: z.tuple([z.number(), z.number()]),
  strokeOpacityDefine: z.number(),
  strokeOpacityPalette: z.array(z.number()).optional().default([25, 50, 75, 100]),
  strokeOpacityStartValue: z.number(),
  strokeOpacityIncrement: z.number(),
  strokeOpacityModulationEnabled: z.boolean(),
  strokeOpacityModulationValue: z.number(),
  strokeOpacityModulationBounce: z.boolean().optional().default(false),
  strokeOpacitySeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])).optional().default([]),
  strokeOpacitySeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  strokeOpacitySeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  strokeOpacitySeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  strokeOpacitySeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),
  strokeWidthEnabled: z.boolean(),
  strokeWidthMode: z.enum(['range', 'define', 'incremental', 'parameterised', 'series']),
  strokeWidthRange: z.tuple([z.number(), z.number()]),
  strokeWidthDefine: z.number(),
  strokeWidthStartValue: z.number(),
  strokeWidthIncrement: z.number(),
  strokeWidthModulationEnabled: z.boolean(),
  strokeWidthModulationValue: z.number(),
  strokeWidthModulationBounce: z.boolean().optional().default(false),
  strokeIncrementalIndexDriver: IncrementalIndexDriverSchema,
  strokeWidthSeriesItems: z.array(z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.number() }),
    z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) }),
  ])).optional().default([]),
  strokeWidthSeriesSelection: z.enum(['sequential', 'random']).optional().default('sequential'),
  strokeWidthSeriesExhaustion: z.enum(['cycle', 'bounce']).optional().default('cycle'),
  strokeWidthSeriesDriver: z.enum(['shape-index', 'set-rep-index']).optional().default('shape-index'),
  strokeWidthSeriesStagingMode: z.enum(['fixed', 'range']).optional().default('fixed'),

  // Stroke Profile (parameterised mode)
  strokeProfileType: z.enum(['ramp-asc', 'ramp-desc', 'wave', 'hump-smooth', 'hump-sharp', 'zigzag']),
  strokeProfileFrequency: z.number(),
  strokeProfilePhaseOffset: z.number(),
  strokeProfileScale: z.number(),

  // Stroke Pattern
  strokePattern: z.enum(['none', 'dash', 'dot', 'squiggle']),
  strokeDashLength: z.number(),
  strokeDashGap: z.number(),
  strokeDotSpacing: z.number(),
  strokeSquiggleAmplitudeMode: z.enum(['range', 'define', 'incremental', 'series']),
  strokeSquiggleAmplitudeRange: z.tuple([z.number(), z.number()]),
  strokeSquiggleAmplitudeDefine: z.number(),
  strokeSquiggleAmplitudeStartValue: z.number(),
  strokeSquiggleAmplitudeIncrement: z.number(),
  strokeSquiggleAmplitudeModulationEnabled: z.boolean(),
  strokeSquiggleAmplitudeModulationValue: z.number(),
  strokeSquiggleAmplitudeSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])),
  strokeSquiggleAmplitudeSeriesSelection: z.enum(['sequential', 'random']),
  strokeSquiggleAmplitudeSeriesExhaustion: z.enum(['cycle', 'bounce']),
  strokeSquiggleAmplitudeSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  strokeSquiggleAmplitudeSeriesStagingMode: z.enum(['fixed', 'range']),
  strokeSquiggleFrequencyMode: z.enum(['range', 'define', 'incremental', 'series']),
  strokeSquiggleFrequencyRange: z.tuple([z.number(), z.number()]),
  strokeSquiggleFrequencyDefine: z.number(),
  strokeSquiggleFrequencyStartValue: z.number(),
  strokeSquiggleFrequencyIncrement: z.number(),
  strokeSquiggleFrequencyModulationEnabled: z.boolean(),
  strokeSquiggleFrequencyModulationValue: z.number(),
  strokeSquiggleFrequencySeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])),
  strokeSquiggleFrequencySeriesSelection: z.enum(['sequential', 'random']),
  strokeSquiggleFrequencySeriesExhaustion: z.enum(['cycle', 'bounce']),
  strokeSquiggleFrequencySeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  strokeSquiggleFrequencySeriesStagingMode: z.enum(['fixed', 'range']),
  strokeSquigglePhaseMode: z.enum(['range', 'define', 'incremental', 'series']),
  strokeSquigglePhaseRange: z.tuple([z.number(), z.number()]),
  strokeSquigglePhaseDefine: z.number(),
  strokeSquigglePhaseStartValue: z.number(),
  strokeSquigglePhaseIncrement: z.number(),
  strokeSquigglePhaseModulationEnabled: z.boolean(),
  strokeSquigglePhaseModulationValue: z.number(),
  strokeSquigglePhaseSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])),
  strokeSquigglePhaseSeriesSelection: z.enum(['sequential', 'random']),
  strokeSquigglePhaseSeriesExhaustion: z.enum(['cycle', 'bounce']),
  strokeSquigglePhaseSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  strokeSquigglePhaseSeriesStagingMode: z.enum(['fixed', 'range']),
  strokeSquiggleAlignMode: z.enum(['range', 'define', 'incremental', 'series']),
  strokeSquiggleAlignRange: z.tuple([z.number(), z.number()]),
  strokeSquiggleAlignDefine: z.number(),
  strokeSquiggleAlignStartValue: z.number(),
  strokeSquiggleAlignIncrement: z.number(),
  strokeSquiggleAlignModulationEnabled: z.boolean(),
  strokeSquiggleAlignModulationValue: z.number(),
  strokeSquiggleAlignSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])),
  strokeSquiggleAlignSeriesSelection: z.enum(['sequential', 'random']),
  strokeSquiggleAlignSeriesExhaustion: z.enum(['cycle', 'bounce']),
  strokeSquiggleAlignSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  strokeSquiggleAlignSeriesStagingMode: z.enum(['fixed', 'range']),
  strokeSquiggleAbs: z.boolean(),
  strokeSquiggleFlip: z.boolean(),
  strokeSquigglePerturbType: z.enum(['jitter', 'noise']),
  strokeSquiggleJitterMode: z.enum(['range', 'define', 'incremental', 'series']),
  strokeSquiggleJitterRange: z.tuple([z.number(), z.number()]),
  strokeSquiggleJitterDefine: z.number(),
  strokeSquiggleJitterStartValue: z.number(),
  strokeSquiggleJitterIncrement: z.number(),
  strokeSquiggleJitterModulationEnabled: z.boolean(),
  strokeSquiggleJitterModulationValue: z.number(),
  strokeSquiggleJitterSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])),
  strokeSquiggleJitterSeriesSelection: z.enum(['sequential', 'random']),
  strokeSquiggleJitterSeriesExhaustion: z.enum(['cycle', 'bounce']),
  strokeSquiggleJitterSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  strokeSquiggleJitterSeriesStagingMode: z.enum(['fixed', 'range']),
  strokeSquiggleJitterDir: z.enum(['normal', 'xy']),
  strokeSquiggleJitterSeedMode: z.enum(['range', 'define', 'incremental', 'series']),
  strokeSquiggleJitterSeedRange: z.tuple([z.number(), z.number()]),
  strokeSquiggleJitterSeedDefine: z.number(),
  strokeSquiggleJitterSeedStartValue: z.number(),
  strokeSquiggleJitterSeedIncrement: z.number(),
  strokeSquiggleJitterSeedModulationEnabled: z.boolean(),
  strokeSquiggleJitterSeedModulationValue: z.number(),
  strokeSquiggleJitterSeedSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])),
  strokeSquiggleJitterSeedSeriesSelection: z.enum(['sequential', 'random']),
  strokeSquiggleJitterSeedSeriesExhaustion: z.enum(['cycle', 'bounce']),
  strokeSquiggleJitterSeedSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  strokeSquiggleJitterSeedSeriesStagingMode: z.enum(['fixed', 'range']),
  strokeSquiggleNoiseMode: z.enum(['range', 'define', 'incremental', 'series']),
  strokeSquiggleNoiseRange: z.tuple([z.number(), z.number()]),
  strokeSquiggleNoiseDefine: z.number(),
  strokeSquiggleNoiseStartValue: z.number(),
  strokeSquiggleNoiseIncrement: z.number(),
  strokeSquiggleNoiseModulationEnabled: z.boolean(),
  strokeSquiggleNoiseModulationValue: z.number(),
  strokeSquiggleNoiseSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])),
  strokeSquiggleNoiseSeriesSelection: z.enum(['sequential', 'random']),
  strokeSquiggleNoiseSeriesExhaustion: z.enum(['cycle', 'bounce']),
  strokeSquiggleNoiseSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  strokeSquiggleNoiseSeriesStagingMode: z.enum(['fixed', 'range']),
  strokeSquiggleNoiseFreqMode: z.enum(['range', 'define', 'incremental', 'series']),
  strokeSquiggleNoiseFreqRange: z.tuple([z.number(), z.number()]),
  strokeSquiggleNoiseFreqDefine: z.number(),
  strokeSquiggleNoiseFreqStartValue: z.number(),
  strokeSquiggleNoiseFreqIncrement: z.number(),
  strokeSquiggleNoiseFreqModulationEnabled: z.boolean(),
  strokeSquiggleNoiseFreqModulationValue: z.number(),
  strokeSquiggleNoiseFreqSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])),
  strokeSquiggleNoiseFreqSeriesSelection: z.enum(['sequential', 'random']),
  strokeSquiggleNoiseFreqSeriesExhaustion: z.enum(['cycle', 'bounce']),
  strokeSquiggleNoiseFreqSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  strokeSquiggleNoiseFreqSeriesStagingMode: z.enum(['fixed', 'range']),
  strokeSquiggleIncrementalIndexDriver: IncrementalIndexDriverSchema,
  strokeSquiggleBounce: z.boolean().optional().default(false),
  strokeSquiggleSampleMode: z.enum(['auto', 'define', 'range']),
  strokeSquiggleSampleDefine: z.number(),
  strokeSquiggleSampleRange: z.tuple([z.number(), z.number()]),
  strokeSquiggleUseCurveResample: z.boolean(),
  strokeSquiggleSmoothCurves: z.boolean(),

  // Shape-specific properties
  polygonPropertiesEnabled: z.boolean(),
  segmentCountMode: z.enum(['range', 'define', 'incremental']),
  segmentCountRange: z.tuple([z.number(), z.number()]),
  segmentCountDefine: z.number(),
  segmentCountStartValue: z.number(),
  segmentCountIncrement: z.number(),
  segmentCountModulationEnabled: z.boolean(),
  segmentCountModulationValue: z.number(),
  polygonIncrementalIndexDriver: IncrementalIndexDriverSchema,
  
  linePropertiesEnabled: z.boolean(),
  pointCountMode: z.enum(['range', 'define', 'incremental']),
  pointCountRange: z.tuple([z.number(), z.number()]),
  pointCountDefine: z.number(),
  pointCountStartValue: z.number(),
  pointCountIncrement: z.number(),
  pointCountModulationEnabled: z.boolean(),
  pointCountModulationValue: z.number(),
  pointPositionMode: z.enum(['range', 'define', 'incremental']),
  pointPositionRange: z.tuple([z.number(), z.number()]),
  pointPositionDefine: z.number(),
  pointPositionStartValue: z.number(),
  pointPositionIncrement: z.number(),
  pointPositionModulationEnabled: z.boolean(),
  pointPositionModulationValue: z.number(),
  lineIncrementalIndexDriver: IncrementalIndexDriverSchema,
  
  splinePropertiesEnabled: z.boolean(),
  splinePointCountMode: z.enum(['range', 'define', 'incremental']),
  splinePointCountRange: z.tuple([z.number(), z.number()]),
  splinePointCountDefine: z.number(),
  splinePointCountStartValue: z.number(),
  splinePointCountIncrement: z.number(),
  splinePointCountModulationEnabled: z.boolean(),
  splinePointCountModulationValue: z.number(),
  splinePointPositionMode: z.enum(['range', 'define', 'incremental']),
  splinePointPositionRange: z.tuple([z.number(), z.number()]),
  splinePointPositionDefine: z.number(),
  splinePointPositionStartValue: z.number(),
  splinePointPositionIncrement: z.number(),
  splinePointPositionModulationEnabled: z.boolean(),
  splinePointPositionModulationValue: z.number(),
  splineControlPointMode: z.enum(['range', 'define', 'incremental']),
  splineControlPointRange: z.tuple([z.number(), z.number()]),
  splineControlPointDefine: z.number(),
  splineControlPointStartValue: z.number(),
  splineControlPointIncrement: z.number(),
  splineControlPointModulationEnabled: z.boolean(),
  splineControlPointModulationValue: z.number(),
  splineIncrementalIndexDriver: IncrementalIndexDriverSchema,
  
  // Transform properties
  transformsEnabled: z.boolean(),
  transformsArtboardAware: z.boolean(),
  translateXRange: z.tuple([z.number(), z.number()]),
  translateYRange: z.tuple([z.number(), z.number()]),
  scaleUniform: z.boolean(),
  scaleRange: z.tuple([z.number(), z.number()]),
  scaleXRange: z.tuple([z.number(), z.number()]),
  scaleYRange: z.tuple([z.number(), z.number()]),
  rotationRange: z.tuple([z.number(), z.number()]),
  skewXRange: z.tuple([z.number(), z.number()]),
  skewYRange: z.tuple([z.number(), z.number()]),
  
  // Enhanced transform properties
  xTransformMode: z.enum(['range', 'value', 'incremental', 'align', 'series']),
  yTransformMode: z.enum(['range', 'value', 'incremental', 'align', 'series']),
  xTransformValue: z.number(),
  yTransformValue: z.number(),
  xTransformIncrement: z.number(),
  yTransformIncrement: z.number(),
  xTransformStartValue: z.number(),
  yTransformStartValue: z.number(),
  xTransformModulationEnabled: z.boolean(),
  xTransformModulationValue: z.number(),
  xTransformStartOffset: z.number().optional().default(0),
  xTransformStartOffsetCompound: z.boolean().optional().default(false),
  xTransformWrapOffset: z.number().optional().default(0),
  xTransformWrapOffsetCompound: z.boolean().optional().default(false),
  xTransformModulationBounce: z.boolean().optional().default(false),
  yTransformModulationEnabled: z.boolean(),
  yTransformModulationValue: z.number(),
  yTransformStartOffset: z.number().optional().default(0),
  yTransformStartOffsetCompound: z.boolean().optional().default(false),
  yTransformWrapOffset: z.number().optional().default(0),
  yTransformWrapOffsetCompound: z.boolean().optional().default(false),
  yTransformModulationBounce: z.boolean().optional().default(false),
  xTransformSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])),
  xTransformSeriesSelection: z.enum(['sequential', 'random']),
  xTransformSeriesExhaustion: z.enum(['cycle', 'bounce']),
  xTransformSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  xTransformSeriesStagingMode: z.enum(['fixed', 'range']),
  yTransformSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])),
  yTransformSeriesSelection: z.enum(['sequential', 'random']),
  yTransformSeriesExhaustion: z.enum(['cycle', 'bounce']),
  yTransformSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  yTransformSeriesStagingMode: z.enum(['fixed', 'range']),
  
  // Position Alignment (when mode is 'align')
  xShapeAnchorMode: z.enum(['predefined', 'define']),
  xShapeAnchorPredefined: z.enum(['left', 'center', 'right']),
  xShapeAnchorDefine: z.number(),
  xArtboardAnchorMode: z.enum(['predefined', 'define']),
  xArtboardAnchorPredefined: z.enum(['left', 'center', 'right']),
  xArtboardAnchorDefine: z.number(),
  
  yShapeAnchorMode: z.enum(['predefined', 'define']),
  yShapeAnchorPredefined: z.enum(['top', 'center', 'bottom']),
  yShapeAnchorDefine: z.number(),
  yArtboardAnchorMode: z.enum(['predefined', 'define']),
  yArtboardAnchorPredefined: z.enum(['top', 'center', 'bottom']),
  yArtboardAnchorDefine: z.number(),
  
  scaleXMode: z.enum(['range', 'value', 'incremental', 'series']),
  scaleYMode: z.enum(['range', 'value', 'incremental', 'series']),
  scaleXValue: z.number(),
  scaleYValue: z.number(),
  scaleXIncrement: z.number(),
  scaleYIncrement: z.number(),
  scaleXStartValue: z.number(),
  scaleYStartValue: z.number(),
  scaleXModulationEnabled: z.boolean(),
  scaleXModulationValue: z.number(),
  scaleXStartOffset: z.number().optional().default(0),
  scaleXStartOffsetCompound: z.boolean().optional().default(false),
  scaleXWrapOffset: z.number().optional().default(0),
  scaleXWrapOffsetCompound: z.boolean().optional().default(false),
  scaleXModulationBounce: z.boolean().optional().default(false),
  scaleYModulationEnabled: z.boolean(),
  scaleYModulationValue: z.number(),
  scaleYStartOffset: z.number().optional().default(0),
  scaleYStartOffsetCompound: z.boolean().optional().default(false),
  scaleYWrapOffset: z.number().optional().default(0),
  scaleYWrapOffsetCompound: z.boolean().optional().default(false),
  scaleYModulationBounce: z.boolean().optional().default(false),
  maintainScaleAspectRatio: z.boolean(),
  scaleXSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])),
  scaleXSeriesSelection: z.enum(['sequential', 'random']),
  scaleXSeriesExhaustion: z.enum(['cycle', 'bounce']),
  scaleXSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  scaleXSeriesStagingMode: z.enum(['fixed', 'range']),
  scaleYSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])),
  scaleYSeriesSelection: z.enum(['sequential', 'random']),
  scaleYSeriesExhaustion: z.enum(['cycle', 'bounce']),
  scaleYSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  scaleYSeriesStagingMode: z.enum(['fixed', 'range']),
  
  rotationMode: z.enum(['range', 'value', 'incremental', 'series']),
  rotationValue: z.number(),
  rotationIncrement: z.number(),
  rotationIncrementStep: z.number().min(1).max(90),
  rotationStartValue: z.number(),
  rotationModulation: z.number(),
  rotationModulationEnabled: z.boolean(),
  setTransformIncrementalIndexDriver: IncrementalIndexDriverSchema,
  rotationSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])),
  rotationSeriesSelection: z.enum(['sequential', 'random']),
  rotationSeriesExhaustion: z.enum(['cycle', 'bounce']),
  rotationSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  rotationSeriesStagingMode: z.enum(['fixed', 'range']),
  
  scaleRandomizationScale: z.number(),
  rotationRandomizationScale: z.number(),
  translationXRandomizationScale: z.number(),
  translationYRandomizationScale: z.number(),
  widthRandomizationScale: z.number(),
  heightRandomizationScale: z.number(),
  
  // Transform Origin
  transformOriginMode: z.enum(['define', 'predefined-artboard', 'current-shape', 'shape-reference']),
  
  // Define mode sub-modes
  transformOriginDefineMode: z.enum(['fixed', 'range', 'incremental', 'series']),
  transformOriginX: z.number(),
  transformOriginY: z.number(),
  
  // Range mode
  transformOriginXMin: z.number(),
  transformOriginXMax: z.number(),
  transformOriginYMin: z.number(),
  transformOriginYMax: z.number(),
  
  // Incremental mode
  transformOriginXStartValue: z.number(),
  transformOriginXIncrement: z.number(),
  transformOriginXModulationEnabled: z.boolean(),
  transformOriginXModulationValue: z.number(),
  transformOriginXStartOffset: z.number().optional().default(0),
  transformOriginXStartOffsetCompound: z.boolean().optional().default(false),
  transformOriginXWrapOffset: z.number().optional().default(0),
  transformOriginXWrapOffsetCompound: z.boolean().optional().default(false),
  transformOriginXModulationBounce: z.boolean().optional().default(false),
  transformOriginYStartValue: z.number(),
  transformOriginYIncrement: z.number(),
  transformOriginYModulationEnabled: z.boolean(),
  transformOriginYModulationValue: z.number(),
  transformOriginYStartOffset: z.number().optional().default(0),
  transformOriginYStartOffsetCompound: z.boolean().optional().default(false),
  transformOriginYWrapOffset: z.number().optional().default(0),
  transformOriginYWrapOffsetCompound: z.boolean().optional().default(false),
  transformOriginYModulationBounce: z.boolean().optional().default(false),
  transformOriginXIncrementalIndexDriver: IncrementalIndexDriverSchema,
  transformOriginYIncrementalIndexDriver: IncrementalIndexDriverSchema,
  transformOriginXSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])),
  transformOriginXSeriesSelection: z.enum(['sequential', 'random']),
  transformOriginXSeriesExhaustion: z.enum(['cycle', 'bounce']),
  transformOriginXSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  transformOriginXSeriesStagingMode: z.enum(['fixed', 'range']),
  transformOriginYSeriesItems: z.array(z.discriminatedUnion('mode', [z.object({ mode: z.literal('fixed'), value: z.number() }), z.object({ mode: z.literal('range'), valueRange: z.tuple([z.number(), z.number()]) })])),
  transformOriginYSeriesSelection: z.enum(['sequential', 'random']),
  transformOriginYSeriesExhaustion: z.enum(['cycle', 'bounce']),
  transformOriginYSeriesDriver: z.enum(['shape-index', 'set-rep-index']),
  transformOriginYSeriesStagingMode: z.enum(['fixed', 'range']),
  
  // Predefined anchor points
  transformOriginPredefined: z.enum(['center', 'top-left', 'top-center', 'top-right', 'center-left', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right']),
  
  // Shape reference mode
  transformOriginShapeReference: z.enum(['current', 'previous', 'next', 'first', 'last', 'specific']),
  transformOriginShapeIndex: z.number(),
  transformOriginShapeAnchor: z.enum(['center', 'top-left', 'top-center', 'top-right', 'center-left', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right']),
  
  // Shape effects
  shapeEffectsEnabled: z.boolean(),
  
  // Echo/Motion Trails (Project A: Set-Level)
  echoSpread: z.object({
    version: z.number(),
    enabled: z.boolean(),
    scope: z.enum(['set', 'shape', 'both']),
    driver: z.enum(['setRepIndex', 'shapeIndex', 'combined']),
    echoCount: z.number().min(1).max(20),
    directionMode: z.enum(['fixed-vector', 'auto-motion', 'absolute-position']),
    fixedVector: z.object({
      angle: z.number().min(0).max(360),
      distance: z.number().min(0).max(500)
    }),
    autoMotion: z.object({
      fallbackAngle: z.number().min(0).max(360),
      distanceMultiplier: z.number().min(0.1).max(5)
    }),
    absolutePosition: z.object({
      targetX: z.number(),
      targetY: z.number(),
      artboardTarget: z.enum(['center', 'top-left', 'top-right', 'bottom-right', 'bottom-left', 'custom']),
      mode: z.enum(['converge', 'diverge'])
    }).optional(),
    opacity: z.object({
      startOpacity: z.number().min(0).max(100),
      falloffRate: z.number().min(0).max(100),
      minOpacity: z.number().min(0).max(100),
      jitter: z.object({
        enabled: z.boolean(),
        range: z.number().min(0).max(100)
      })
    }),
    blur: z.object({
      enabled: z.boolean(),
      startBlur: z.number().min(0).max(50),
      blurDelta: z.number().min(0).max(20),
      maxBlur: z.number().min(0).max(100),
      jitter: z.object({
        enabled: z.boolean(),
        range: z.number().min(0).max(50)
      })
    }),
    scale: z.object({
      enabled: z.boolean(),
      startScale: z.number().min(10).max(200),
      scaleDelta: z.number().min(-50).max(50),
      minScale: z.number().min(1).max(100),
      maxScale: z.number().min(100).max(500),
      jitter: z.object({
        enabled: z.boolean(),
        range: z.number().min(0).max(100)
      })
    }),
    rotation: z.object({
      enabled: z.boolean(),
      startRotation: z.number().min(0).max(360),
      rotationDelta: z.number().min(-180).max(180),
      minRotation: z.number().min(-360).max(0),
      maxRotation: z.number().min(0).max(360),
      jitter: z.object({
        enabled: z.boolean(),
        range: z.number().min(0).max(180)
      })
    }),
    colorShift: z.object({
      enabled: z.boolean(),
      hueDelta: z.number().min(-180).max(180),
      saturationDelta: z.number().min(-50).max(50),
      lightnessDelta: z.number().min(-50).max(50),
      jitter: z.object({
        enabled: z.boolean(),
        range: z.number().min(0).max(180)
      })
    }).optional(),
    jitter: z.object({
      enabled: z.boolean(),
      distanceRange: z.number().min(0).max(100),
      angleRange: z.number().min(0).max(180)
    }),
    applyTo: z.object({
      enabled: z.boolean(),
      shapeTypes: z.array(z.string()).optional(),
      indices: z.array(z.number()).optional(),
      selector: z.enum(['all', 'even', 'odd', 'step']),
      indexStep: z.number().min(1).max(100).optional(),
      probability: z.number().min(0).max(100).optional()
    }).optional()
  }),
  
  // Color harmony
  colorHarmonyEnabled: z.boolean(),
  harmonyType: z.enum(['monochromatic', 'analogous', 'complementary', 'triadic', 'split-complementary', 'tetradic']),
  baseColor: z.string(),
  hueVariance: z.number(),
  saturationRange: z.tuple([z.number(), z.number()]),
  lightnessRange: z.tuple([z.number(), z.number()]),
  monochromaticSettings: z.object({
    lightnessSteps: z.number(),
    saturationSteps: z.number(),
    includeNeutrals: z.boolean()
  }),
  analogousSettings: z.object({
    hueRange: z.number(),
    colorCount: z.number()
  }),
  complementarySettings: z.object({
    includeNearComplements: z.boolean(),
    complementOffset: z.number()
  }),
  triadicSettings: z.object({
    rotationOffset: z.number(),
    useEqualSpacing: z.boolean()
  }),
  splitComplementarySettings: z.object({
    splitAngle: z.number(),
    balanceWeights: z.boolean()
  }),
  tetradicSettings: z.object({
    squareHarmony: z.boolean(),
    rectangleRatio: z.number()
  }),
  
  // Physics simulation
  physicsEnabled: z.boolean(),
  physicsType: z.enum(['none', 'gravity', 'magnetic', 'collision', 'flocking']),
  gravityDirection: z.number(),
  gravityStrength: z.number(),
  magneticType: z.enum(['attraction', 'repulsion']),
  magneticStrength: z.number(),
  collisionDistance: z.number(),
  collisionBounce: z.number(),
  simulationSteps: z.number(),
  
  // Shape Render Mode
  shapeRenderMode: z.enum(['smooth', 'sharp', 'faceted']),
  shapeRenderSegments: z.number(),
  shapeRenderDotSize: z.number(),
  renderModeOverride: z.object({
    enabled: z.boolean(),
    tension: z.number(),
    passes: z.number().optional(),
    smoothAlgorithm: z.enum(['chaikin', 'catmull-rom', 'natural-cubic']).optional(),
    catmullAlpha: z.number().min(0).max(1).optional(),
    naturalCubicClamped: z.boolean().optional(),
    resample: z.object({ enabled: z.boolean(), count: z.number() }),
  }).optional(),
  wireConfig: z.object({
    enabled: z.boolean(),
    render: z.enum(['points', 'connections', 'combined']),
    points: z.object({
      colorSource: z.enum(['explicit', 'inherit-fill', 'inherit-stroke']),
      color: z.string(),
      opacity: z.number(),
      size: z.number(),
    }),
    connections: z.object({
      colorSource: z.enum(['explicit', 'inherit-fill', 'inherit-stroke']),
      color: z.string(),
      opacity: z.number(),
      thickness: z.number(),
    }),
  }).optional(),

  // Shape Roughness & Jitter
  globalJitterEnabled: z.boolean(),
  globalJitterAmount: z.number(),
  globalJitterBiasX: z.number(),
  globalJitterBiasY: z.number(),
  globalJitterBiasZ: z.number(),
  globalJitterPositiveOnly: z.boolean(),
  globalJitterReverse: z.boolean(),
  localJitterEnabled: z.boolean(),
  localJitterEnabledX: z.boolean(),
  localJitterEnabledY: z.boolean(),
  localJitterEnabledZ: z.boolean(),
  localJitterModeX: z.enum(['axial', 'from-center']),
  localJitterModeY: z.enum(['axial', 'from-center']),
  localJitterAmountX: z.number(),
  localJitterAmountY: z.number(),
  localJitterAmountZ: z.number(),
  localJitterPositiveOnlyX: z.boolean(),
  localJitterPositiveOnlyY: z.boolean(),
  localJitterPositiveOnlyZ: z.boolean(),
  localJitterReverseX: z.boolean(),
  localJitterReverseY: z.boolean(),
  localJitterReverseZ: z.boolean(),
  jitterDriver: z.enum(['random', 'simplex']),
  jitterScale: z.number(),
  jitterOctaves: z.number(),
  jitterLacunarity: z.number(),
  jitterGain: z.number(),
  jitterResampleEnabled: z.boolean(),
  jitterResampleDensity: z.number(),

  // Temporal variation
  temporalEnabled: z.literal(false),
  evolutionMode: z.literal('none'),
  seedIncrement: z.number(),
  evolutionTargets: z.object({
    position: z.boolean(),
    rotation: z.boolean(),
    scale: z.boolean(),
    color: z.boolean(),
    opacity: z.boolean()
  }),

  // Copy-to-Points source config (stored on source set)
  copyToPointsConfig: z.object({
    destinationSetId: z.string(),
    copyMode: z.enum(['shape-copy', 'set-copy']),
    overflowMode: z.enum(['wrap', 'clamp', 'distribute-evenly']),
  }).optional(),

  // Copy-to-Points target config (stored on destination set)
  copyToPointsTargetConfig: z.object({
    includeVertices: z.boolean(),
    includeCentroid: z.boolean(),
    vertexSampleStride: z.number().min(1),
    resampleOutline: z.boolean(),
    resampleCount: z.number().min(2),
    pointProperties: z.array(z.object({
      enabled: z.boolean(),
      key: z.enum(['posX', 'posY', 'scaleX', 'scaleY', 'uniformScale', 'skewX', 'skewY', 'rotation', 'fillOpacity', 'fillR', 'fillG', 'fillB']),
      mode: z.preprocess(
        (v) => v === 'dest-value' ? 'fixed' : v,
        z.enum(['fixed', 'random-range', 'range', 'incremental'])
      ),
      positionSubMode: z.enum(['cartesian', 'polar']),
      evaluatePoints: z.enum(['all-points', 'points-per-shape']).optional(),
      fixedValue: z.number(),
      rangeMin: z.number(),
      rangeMax: z.number(),
      rangeSubMode: z.enum(['point-index', 'shape-index', 'set-rep-index', 'random']).optional(),
      incrementalStart: z.number(),
      incrementalStep: z.number(),
      incrementalWrap: z.number(),
      remapEnabled: z.boolean(),
      remapFrom: z.tuple([z.number(), z.number()]),
      remapTo: z.tuple([z.number(), z.number()]),
      blendMode: z.enum(['normal', 'multiply', 'add', 'subtract', 'divide']),
      amountMode: z.enum(['fixed', 'range']),
      amountFixed: z.number().min(0).max(1),
      amountRangeMin: z.number().min(0).max(1),
      amountRangeMax: z.number().min(0).max(1)
    })),
    pointsMode: z.enum(['all-points', 'points-per-shape']).optional()
  }).optional(),
  copyToPointsTargetEnabled: z.boolean().optional(),
  hideWhenUsedAsPointSource: z.boolean().optional()
});

export const GenerationSetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  enabledShapeTypes: z.array(SupportedShapeTypeSchema), // Fixed: now uses array instead of Set
  shapeCountMode: ShapeCountModeSchema,
  shapeCountFixed: z.number().min(1),
  shapeCountRange: z.tuple([z.number().min(1), z.number().min(1)]),
  shapeSpecificProperties: ShapeSpecificPropertiesSchema,
  zIndexConfig: ZIndexConfigSchema,
  batchConfig: BatchConfigSettingsSchema, // Fixed: now properly typed instead of z.any()
  // New set-level features
  setVisibility: SetVisibilitySchema,
  setBlendMode: BlendModeSchema,
  compositingOperation: CompositingOperationSchema,
  setTransform: SetTransformSchema,
  artboardAlignment: ArtboardAlignmentSchema,
  // Metadata
  generationOrder: z.number().min(0),
  description: z.string().optional(),
  // Repetition settings
  repetitionMode: z.enum(['use-global', 'fixed', 'range']),
  repetitionValue: z.number().min(0),
  repetitionRange: z.tuple([z.number().min(0), z.number().min(0)]),
  // Lock settings
  locks: SetLocksSchema,
  // Per-set echo override (Project B feature)
  echoOverride: z.object({
    enabled: z.boolean(),
    config: z.any().optional()
  }).optional(),
  // useAsPointSource removed; hideWhenUsedAsPointSource moved to batchConfig
});

export const EnhancedBatchConfigSchema = z.object({
  mode: GenerationSetModeSchema,
  legacyBatchConfig: BatchConfigSettingsSchema.optional(), // Fixed: now properly typed instead of z.any()
  generationSets: z.array(GenerationSetSchema),
  globalSettings: z.object({
    canvasWidth: z.number().positive(),
    canvasHeight: z.number().positive(),
    artboardSettings: z.object({
      enabled: z.boolean(),
      width: z.number().positive(),
      height: z.number().positive(),
      backgroundColor: z.string()
    }).optional(),
    edgeCaseStrategy: z.enum(['hold', 'cycle', 'random', 'stop']),
    exportFormat: z.enum(['png', 'jpeg', 'webp', 'avif', 'bmp']),
    exportQuality: z.number().min(0).max(100),
    globalZIndexSettings: z.object({
      startingZIndex: z.number(),
      setSpacing: z.number().positive(),
      preventOverlap: z.boolean(),
      useGlobalSettings: z.boolean() // Added for z-index precedence control
    })
  }),
  modeRestrictions: z.object({
    multiGenerationOnlyForFixedCount: z.boolean(),
    maxGenerationSets: z.number().positive(),
    minShapesPerSet: z.number().positive(),
    maxShapesPerSet: z.number().positive()
  }),
  createdAt: z.string().datetime(), // Fixed: now uses ISO string instead of z.date()
  updatedAt: z.string().datetime(), // Fixed: now uses ISO string instead of z.date()
  version: z.string()
}).refine((data) => {
  // Validation refinement: Multi-generation mode requires fixed generation count when restriction is enabled
  if (data.mode === GenerationSetMode.MULTI && data.modeRestrictions.multiGenerationOnlyForFixedCount) {
    return data.generationSets.every(set => set.shapeCountMode === ShapeCountMode.FIXED);
  }
  return true;
}, {
  message: "Multi-generation mode with multiGenerationOnlyForFixedCount restriction requires all generation sets to use fixed shape count mode",
  path: ["generationSets"]
});

// Utility functions for working with generation sets
export const GenerationSetUtils = {
  // Create a new generation set with default values
  createDefault: (id: string, name: string): GenerationSet => ({
    id,
    name,
    enabled: true,
    enabledShapeTypes: ['rectangle', 'circle'], // Fixed: now uses array instead of Set
    shapeCountMode: ShapeCountMode.FIXED,
    shapeCountFixed: DEFAULT_GENERATION_SET_LIMITS.defaultShapesPerSet,
    shapeCountRange: [1, 10],
    shapeSpecificProperties: {},
    zIndexConfig: { ...DEFAULT_Z_INDEX_CONFIG },
    batchConfig: { ...defaultBatchConfigSettings }, // Fixed: now uses proper default settings
    // New set-level features with sensible defaults
    setVisibility: {
      visible: true,
      opacity: 1.0,
      opacityVariance: 0.0
    },
    setBlendMode: 'source-over',
    compositingOperation: 'source-over',
    setTransform: {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1.0,
      scaleY: 1.0,
      transformOrigin: 'center'
    },
    artboardAlignment: {
      fitToArtboard: false,
      fitTarget: 'none',
      fitMode: 'contain',
      alignTo: 'none',
      alignmentType: 'center',
      margin: 0
    },
    generationOrder: 0,
    description: undefined,
    // Repetition settings (defaults to use-global mode with no repetitions)
    repetitionMode: 'use-global',
    repetitionValue: 0,
    repetitionRange: [0, 0],
    // Lock settings (defaults to all locks disabled/off)
    locks: {
      composite: false
    },
    // Shape type generation control (defaults to random)
    shapeTypeGenMode: 'random',
    shapeTypeWeights: {},
    shapeTypeFixedCounts: {},
    shapeTypeSequence: []
  }),

  // Validate shape count settings
  validateShapeCount: (set: GenerationSet): boolean => {
    if (set.shapeCountMode === ShapeCountMode.FIXED) {
      return set.shapeCountFixed >= DEFAULT_GENERATION_SET_LIMITS.minShapesPerSet &&
             set.shapeCountFixed <= DEFAULT_GENERATION_SET_LIMITS.maxShapesPerSet;
    } else {
      const [min, max] = set.shapeCountRange;
      return min >= DEFAULT_GENERATION_SET_LIMITS.minShapesPerSet &&
             max <= DEFAULT_GENERATION_SET_LIMITS.maxShapesPerSet &&
             min <= max;
    }
  },

  // Calculate total z-index range for a generation set
  calculateZIndexRange: (set: GenerationSet): [number, number] => {
    const maxShapes = set.shapeCountMode === ShapeCountMode.FIXED 
      ? set.shapeCountFixed 
      : set.shapeCountRange[1];
    
    const minZ = set.zIndexConfig.baseOffset;
    const maxZ = minZ + (maxShapes - 1) * set.zIndexConfig.incrementPerShape;
    
    return [minZ, maxZ];
  },

  // Get actual shape count for generation (handles range mode)
  getShapeCount: (set: GenerationSet, randomSeed?: number): number => {
    if (set.shapeCountMode === ShapeCountMode.FIXED) {
      return set.shapeCountFixed;
    }
    
    const [min, max] = set.shapeCountRange;
    if (randomSeed !== undefined) {
      // Use seeded random for reproducible results
      return Math.floor(min + (randomSeed % (max - min + 1)));
    }
    
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  // Convert Set<string> to SupportedShapeType[] for JSON serialization
  convertShapeTypesFromSet: (shapeTypesSet: Set<string>): SupportedShapeType[] => {
    return Array.from(shapeTypesSet).filter(type => 
      SupportedShapeTypeSchema.safeParse(type).success
    ) as SupportedShapeType[];
  },

  // Convert SupportedShapeType[] to Set<string> for backwards compatibility
  convertShapeTypesToSet: (shapeTypesArray: SupportedShapeType[]): Set<string> => {
    return new Set(shapeTypesArray);
  }
};

// Type exports for external usage
export type GenerationSetType = z.infer<typeof GenerationSetSchema>;
export type EnhancedBatchConfigType = z.infer<typeof EnhancedBatchConfigSchema>;
export type ZIndexConfigType = z.infer<typeof ZIndexConfigSchema>;
export type ShapeSpecificPropertiesType = z.infer<typeof ShapeSpecificPropertiesSchema>;
export type BatchConfigSettingsType = z.infer<typeof BatchConfigSettingsSchema>;

// Insert schema for batch config settings
export const insertBatchConfigSettingsSchema = BatchConfigSettingsSchema;
export type InsertBatchConfigSettings = z.infer<typeof insertBatchConfigSettingsSchema>;

// Export all BlendMode values for convenience
export const BLEND_MODES: BlendMode[] = [
  'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity'
];

// Export all supported shape types for convenience
export const SUPPORTED_SHAPE_TYPES: SupportedShapeType[] = [
  'rectangle', 'rounded-rectangle', 'square', 'rounded-square', 'circle', 
  'ellipse', 'triangle', 'right-triangle', 'trapezoid', 'pentagon', 'hexagon', 
  'rhombus', 'parallelogram', 'kite', 'semicircle', 'heart', 'arrow', 'cross',
  'line-vector', 'line', 'polygon', 'star', 'chunk', 'blob', 'ring', 'cubic', 'bezier', 
  'smooth-spline', 'spline-circle', 'spline-ellipse', 'spline-ring'
];

// ===== EXPORT JOBS =====
// Persistent storage for export job status and results
export const exportJobs = pgTable("export_jobs", {
  exportId: varchar("export_id").primaryKey().notNull(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: varchar("status").notNull().default('queued'), // queued, processing, completed, failed
  progress: jsonb("progress").notNull(), // { progress: number, currentStep: string }
  config: jsonb("config").notNull(), // Export configuration (shapes, settings, etc.)
  results: jsonb("results"), // Download URLs, file paths, etc.
  error: text("error"), // Error message if failed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export type ExportJob = typeof exportJobs.$inferSelect;
export type InsertExportJob = typeof exportJobs.$inferInsert;

// ===== MIGRATION UTILITIES =====
/**
 * Migrates legacy size constraint fields to new sizeConstraintMode field
 * This ensures backward compatibility with old project files and generation sets
 * 
 * @param settings - Batch config settings (may have legacy fields)
 * @returns Normalized settings with sizeConstraintMode
 */
export function migrateSizeConstraintMode(settings: Partial<BatchConfigSettings> & {
  useMinWidthHeight?: boolean;
  useMaxWidthHeight?: boolean;
  useAvgWidthHeight?: boolean;
  maintainAspectRatio?: boolean;
}): Partial<BatchConfigSettings> {
  // If already has sizeConstraintMode, no migration needed
  if (settings.sizeConstraintMode) {
    // Remove legacy fields if present
    const { useMinWidthHeight, useMaxWidthHeight, useAvgWidthHeight, maintainAspectRatio, ...rest } = settings as any;
    return rest;
  }
  
  // Determine new sizeConstraintMode based on legacy flags
  let sizeConstraintMode: 'none' | 'min' | 'max' | 'avg' = 'none';
  
  if (settings.useMinWidthHeight) {
    sizeConstraintMode = 'min';
  } else if (settings.useAvgWidthHeight) {
    sizeConstraintMode = 'avg';
  } else if (settings.useMaxWidthHeight) {
    sizeConstraintMode = 'max';
  } else if (settings.maintainAspectRatio) {
    // If maintainAspectRatio was true but no constraint was set, default to 'max'
    sizeConstraintMode = 'max';
  } else {
    // All false or undefined: use 'none' (independent dimensions)
    sizeConstraintMode = 'none';
  }
  
  // Remove legacy fields and add new field
  const { useMinWidthHeight, useMaxWidthHeight, useAvgWidthHeight, maintainAspectRatio, ...rest } = settings as any;
  
  return {
    ...rest,
    sizeConstraintMode
  };
}

/**
 * Migrates rotation settings to ensure rotationIncrementStep has a default value
 * This ensures backward compatibility with configs created before the step amount feature
 * 
 * @param settings - Batch config settings (may be missing rotationIncrementStep)
 * @returns Settings with rotationIncrementStep defaulted to 15
 */
export function migrateRotationSettings(settings: Partial<BatchConfigSettings>): Partial<BatchConfigSettings> {
  return {
    ...settings,
    rotationIncrementStep: settings.rotationIncrementStep ?? 15
  };
}

/**
 * Migrates transform origin settings from legacy 'predefined-shape' to 'current-shape'
 * and ensures all new transform origin fields have default values
 * 
 * @param settings - Batch config settings (may have legacy transformOriginMode)
 * @returns Settings with updated transformOriginMode and default values for new fields
 */
export function migrateTransformOrigin(settings: Partial<BatchConfigSettings> & {
  transformOriginMode?: 'define' | 'predefined-artboard' | 'predefined-shape' | 'current-shape' | 'shape-reference';
}): Partial<BatchConfigSettings> {
  const migrated = { ...settings };
  
  // Rename legacy 'predefined-shape' to 'current-shape'
  if (migrated.transformOriginMode === 'predefined-shape' as any) {
    migrated.transformOriginMode = 'current-shape';
  }
  
  // Ensure new fields have default values
  return {
    ...migrated,
    transformOriginDefineMode: migrated.transformOriginDefineMode ?? 'fixed',
    transformOriginXMin: migrated.transformOriginXMin ?? -100,
    transformOriginXMax: migrated.transformOriginXMax ?? 100,
    transformOriginYMin: migrated.transformOriginYMin ?? -100,
    transformOriginYMax: migrated.transformOriginYMax ?? 100,
    transformOriginXStartValue: migrated.transformOriginXStartValue ?? 0,
    transformOriginXIncrement: migrated.transformOriginXIncrement ?? 10,
    transformOriginXModulationEnabled: migrated.transformOriginXModulationEnabled ?? false,
    transformOriginXModulationValue: migrated.transformOriginXModulationValue ?? 100,
    transformOriginYStartValue: migrated.transformOriginYStartValue ?? 0,
    transformOriginYIncrement: migrated.transformOriginYIncrement ?? 10,
    transformOriginYModulationEnabled: migrated.transformOriginYModulationEnabled ?? false,
    transformOriginYModulationValue: migrated.transformOriginYModulationValue ?? 100,
    transformOriginShapeReference: migrated.transformOriginShapeReference ?? 'current',
    transformOriginShapeIndex: migrated.transformOriginShapeIndex ?? 0,
    transformOriginShapeAnchor: migrated.transformOriginShapeAnchor ?? 'center'
  };
}

/**
 * Helper to migrate a single per-effect jitter config from legacy format
 * Legacy configs had a single 'range' property, new configs have mode/fixedAmount/rangeMin/rangeMax
 */
function migratePerEffectJitter(jitter: any): EchoPerEffectJitterConfig | undefined {
  if (!jitter) return undefined;
  
  // Check for legacy config (has 'range' but not 'mode')
  if (jitter.range !== undefined && jitter.mode === undefined) {
    const legacyRange = jitter.range ?? 0;
    return {
      enabled: jitter.enabled ?? false,
      mode: 'range',
      fixedAmount: 0,
      rangeMin: -legacyRange,  // Symmetric negative bound
      rangeMax: legacyRange    // Symmetric positive bound
    };
  }
  
  // Return as-is if already in new format or missing
  return jitter;
}

/**
 * Migrates echo spread per-effect jitter configs from legacy format
 * Legacy configs had a single 'range' property representing ±range jitter
 * New format uses mode/fixedAmount/rangeMin/rangeMax for more control
 * 
 * IMPORTANT: This function deep-clones all effect configs to avoid shared
 * references that could leak legacy data back into the state.
 * 
 * @param settings - Batch config settings (may have legacy jitter configs)
 * @returns Settings with migrated per-effect jitter configs (deep cloned)
 */
export function migrateEchoJitter(settings: Partial<BatchConfigSettings>): Partial<BatchConfigSettings> {
  if (!settings.echoSpread) return settings;
  
  const echoSpread = settings.echoSpread;
  
  // Start by spreading ALL original echoSpread properties to preserve any fields
  // Then deep clone nested objects to break references
  const updatedEchoSpread: any = {
    ...echoSpread,
    // Deep clone fixedVector config if present
    fixedVector: echoSpread.fixedVector ? { ...echoSpread.fixedVector } : echoSpread.fixedVector,
    // Deep clone autoMotion config if present
    autoMotion: echoSpread.autoMotion ? { ...echoSpread.autoMotion } : echoSpread.autoMotion,
    // Deep clone position jitter config if present
    jitter: echoSpread.jitter ? { ...echoSpread.jitter } : echoSpread.jitter
  };
  
  // Check each effect for legacy jitter config and deep clone
  const effects = ['opacity', 'blur', 'scale', 'rotation'] as const;
  
  for (const effect of effects) {
    const effectConfig = (echoSpread as any)[effect];
    if (effectConfig) {
      // Deep clone the effect config
      const clonedConfig: any = { ...effectConfig };
      
      // Migrate jitter if present
      if (effectConfig.jitter) {
        const migratedJitter = migratePerEffectJitter(effectConfig.jitter);
        // Always deep clone the jitter config
        clonedConfig.jitter = { ...migratedJitter };
      }
      
      updatedEchoSpread[effect] = clonedConfig;
    }
  }
  
  return {
    ...settings,
    echoSpread: updatedEchoSpread
  };
}

/**
 * Normalizes legacy shapeRenderMode values and derives renderModeOverride defaults.
 * - 'points' was removed; treat as 'smooth'.
 * - Derives renderModeOverride from legacy shapeRenderMode when not already set:
 *     smooth  → tension:1, resample:{enabled:false, count:32}
 *     sharp/faceted → tension:0, resample:{enabled:true, count:shapeRenderSegments ?? 32}
 */
function migrateRenderMode(settings: Partial<BatchConfigSettings> & Record<string, any>): Partial<BatchConfigSettings> {
  let shapeRenderMode = settings.shapeRenderMode as any;
  if (shapeRenderMode === 'points') {
    shapeRenderMode = 'smooth';
  }
  // Backward compat: old saved projects may use 'faceted' — normalise to 'sharp'
  if (shapeRenderMode === 'faceted') {
    shapeRenderMode = 'sharp';
  }

  let renderModeOverride = settings.renderModeOverride;
  if (!renderModeOverride) {
    if (shapeRenderMode === 'sharp') {
      renderModeOverride = {
        enabled: false,
        tension: 0,
        resample: { enabled: true, count: (settings.shapeRenderSegments as number | undefined) ?? 32 },
      };
    } else {
      renderModeOverride = {
        enabled: false,
        tension: 1,
        resample: { enabled: false, count: 32 },
      };
    }
  }

  return {
    ...settings,
    ...(shapeRenderMode !== undefined ? { shapeRenderMode } : {}),
    renderModeOverride,
  };
}

/**
 * Master migration function that applies all batch config migrations
 * This should be called at all persistence boundaries (load/save)
 * 
 * @param settings - Batch config settings (may have legacy fields)
 * @returns Fully migrated settings
 */
export function migrateBatchConfigSettings(settings: Partial<BatchConfigSettings> & {
  useMinWidthHeight?: boolean;
  useMaxWidthHeight?: boolean;
  useAvgWidthHeight?: boolean;
  maintainAspectRatio?: boolean;
}): Partial<BatchConfigSettings> {
  // Apply all migrations in sequence
  let migrated = migrateSizeConstraintMode(settings);
  migrated = migrateRotationSettings(migrated);
  migrated = migrateTransformOrigin(migrated);
  migrated = migrateEchoJitter(migrated);
  migrated = migrateRenderMode(migrated);
  
  return migrated;
}

// ===== SSE EXPORT PROGRESS EVENTS =====

/**
 * SSE Export Phase - high-level export phases
 */
export type SSEExportPhase = 'preparing' | 'rendering' | 'rendering-tiles' | 'stitching' | 'encoding' | 'compressing' | 'finalizing';

/**
 * SSE Event Types for export progress streaming
 */
export type SSEEventType = 'phase' | 'tile' | 'progress' | 'complete' | 'error' | 'heartbeat';

/**
 * Base SSE event interface
 */
export interface SSEEventBase {
  type: SSEEventType;
  timestamp: number;
}

/**
 * Phase change event - indicates major export phase transitions
 */
export interface SSEPhaseEvent extends SSEEventBase {
  type: 'phase';
  phase: SSEExportPhase;
  message: string;
}

/**
 * Tile progress event - for tiled rendering updates
 */
export interface SSETileEvent extends SSEEventBase {
  type: 'tile';
  tileIndex: number;
  totalTiles: number;
  step: 'render' | 'stitch';
  message: string;
  progressPct?: number;
}

/**
 * General progress event - overall progress updates
 */
export interface SSEProgressEvent extends SSEEventBase {
  type: 'progress';
  progressPct: number;
  status: string;
  estimatedSecondsRemaining?: number;
}

/**
 * Export complete event - final event with download info
 */
export interface SSECompleteEvent extends SSEEventBase {
  type: 'complete';
  downloadUrl: string;
  filename: string;
  contentType: string;
  sizeBytes?: number;
  dimensions?: { width: number; height: number };
}

/**
 * Error event - export failure
 */
export interface SSEErrorEvent extends SSEEventBase {
  type: 'error';
  message: string;
  code?: string;
}

/**
 * Heartbeat event - keep connection alive
 */
export interface SSEHeartbeatEvent extends SSEEventBase {
  type: 'heartbeat';
}

/**
 * Union type for all SSE events
 */
export type SSEExportEvent = 
  | SSEPhaseEvent 
  | SSETileEvent 
  | SSEProgressEvent 
  | SSECompleteEvent 
  | SSEErrorEvent 
  | SSEHeartbeatEvent;

/**
 * SSE export session state
 */
export interface SSEExportSession {
  exportId: string;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
  startTime: number;
  downloadUrl?: string;
  filename?: string;
  error?: string;
}