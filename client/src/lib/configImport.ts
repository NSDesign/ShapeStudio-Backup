import { z } from 'zod';
import { GenerationSetSchema, migrateSizeConstraintMode } from '@shared/schema';
import type { GenerationSet, SavedArtboard, OverlayManagerState } from '@shared/schema';
import { getEffectivePrintConfig, DEFAULT_PRINT_CONFIG } from './shapeTypes';
import type { Artboard, PrintConfig } from './shapeTypes';

export const CONFIG_IMPORT_VERSION = '1.0.0' as const;
export const CONFIG_IMPORT_LIMITS = {
  maxDocumentBytes: 10 * 1024 * 1024,
  maxSets: 500,
  maxArtboards: 100,
} as const;

export type ImportDiagnostic = {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  path?: string;
};

export type ValidationResult<T> =
  | { success: true; data: T; diagnostics: ImportDiagnostic[] }
  | { success: false; data: null; diagnostics: ImportDiagnostic[] };

export type PortableOverlayState = Pick<OverlayManagerState, 'debugGrid' | 'ctpProperties'>;

const unit = z.enum(['pixels', 'mm', 'cm', 'inches']);
const printConfig = z.object({
  outputSpecs: z.object({ dpi: z.number().finite().min(1).max(1200), unitType: unit }),
  overlays: z.object({
    overlayUnit: unit,
    bleed: z.object({ amount: z.number().finite().min(0), display: z.boolean(), render: z.boolean(), color: z.string() }),
    safeZone: z.object({ amount: z.number().finite().min(0), display: z.boolean(), color: z.string() }),
    printMarks: z.object({
      display: z.boolean(), render: z.boolean(), cropMarks: z.boolean(), registrationMarks: z.boolean(),
      markLength: z.number().finite().min(0).max(100), markOffset: z.number().finite().min(0).max(50),
      scaleMode: z.enum(['none', 'percent']).optional(), color: z.string(),
    }),
    background: z.object({
      mode: z.enum(['transparent', 'artboard', 'custom']), customColor: z.string(),
      display: z.boolean(), render: z.boolean(),
    }),
  }),
}).passthrough();

const generationSet = z.object({
  id: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(512),
  enabled: z.boolean(),
  enabledShapeTypes: z.array(z.string()).max(200),
  shapeCountMode: z.string(),
  shapeCountFixed: z.number().finite().nonnegative(),
  shapeCountRange: z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative()]),
  shapeSpecificProperties: z.record(z.unknown()),
  zIndexConfig: z.record(z.unknown()),
  batchConfig: z.record(z.unknown()),
  setVisibility: z.record(z.unknown()),
  setBlendMode: z.string(),
  compositingOperation: z.string(),
  setTransform: z.record(z.unknown()),
  artboardAlignment: z.record(z.unknown()),
  generationOrder: z.number().finite(),
  repetitionMode: z.string(),
  repetitionValue: z.number().finite(),
  repetitionRange: z.tuple([z.number().finite(), z.number().finite()]),
  locks: z.record(z.unknown()),
}).passthrough();

const portableArtboard = z.object({
  id: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(512),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive().max(100000),
  height: z.number().finite().positive().max(100000),
  dpi: z.number().finite().min(1).max(1200),
  unitType: unit,
  backgroundColor: z.string(),
  gridColor: z.string().optional(),
  displayGrid: z.boolean(),
  displayBorder: z.boolean(),
  displayName: z.boolean(),
  displayDimensions: z.boolean(),
  displayResolution: z.boolean(),
  preset: z.string().optional(),
  category: z.string().optional(),
  linkedDimensions: z.boolean().optional(),
  aspectRatio: z.string().optional(),
  printConfig: printConfig.optional(),
}).passthrough();

export const shapeSetsTransportSchema = z.object({
  type: z.literal('shape-sets'),
  version: z.literal(CONFIG_IMPORT_VERSION),
  timestamp: z.string(),
  name: z.string().max(512),
  sets: z.array(generationSet).max(CONFIG_IMPORT_LIMITS.maxSets),
  currentSetId: z.string().nullable(),
  overlayManagerState: z.object({
    debugGrid: z.object({ sets: z.record(z.unknown()) }).optional(),
    ctpProperties: z.record(z.unknown()).optional(),
  }).optional(),
}).passthrough();

export const artboardsTransportSchema = z.object({
  type: z.literal('artboards'),
  version: z.literal(CONFIG_IMPORT_VERSION),
  timestamp: z.string(),
  name: z.string().max(512),
  artboards: z.array(portableArtboard).max(CONFIG_IMPORT_LIMITS.maxArtboards),
  activeArtboardId: z.string().nullable(),
}).passthrough();

export type ShapeSetsTransport = {
  type: 'shape-sets'; version: typeof CONFIG_IMPORT_VERSION; timestamp: string;
  name: string; sets: GenerationSet[]; currentSetId: string | null;
  overlayManagerState?: PortableOverlayState;
};
export type ArtboardsTransport = {
  type: 'artboards'; version: typeof CONFIG_IMPORT_VERSION; timestamp: string;
  name: string; artboards: SavedArtboard[]; activeArtboardId: string | null;
};

function zodDiagnostics(error: z.ZodError): ImportDiagnostic[] {
  return error.issues.map(issue => ({
    severity: 'error' as const,
    code: 'invalid-field',
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

function duplicateDiagnostics(values: string[], label: string): ImportDiagnostic[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.forEach(value => seen.has(value) ? duplicates.add(value) : seen.add(value));
  return Array.from(duplicates).map(value => ({
    severity: 'error' as const, code: `duplicate-${label}`, path: label,
    message: `Duplicate ${label} "${value}" is not allowed.`,
  }));
}

/** Normalize legacy set fields, then validate against the canonical shared schema. */
export function migrateAndValidateGenerationSets(input: unknown): ValidationResult<GenerationSet[]> {
  if (!Array.isArray(input) || input.length > CONFIG_IMPORT_LIMITS.maxSets) {
    return { success: false, data: null, diagnostics: [{ severity: 'error', code: 'invalid-sets', message: 'Generation sets must be an array within the supported limit.' }] };
  }
  const diagnostics: ImportDiagnostic[] = [];
  const migrated = input.map((value: any, index) => {
    const candidate = {
      ...value,
      batchConfig: migrateSizeConstraintMode(value?.batchConfig ?? {}),
      locks: value?.locks && typeof value.locks === 'object' ? value.locks : {},
    };
    const parsed = GenerationSetSchema.safeParse(candidate);
    if (!parsed.success) diagnostics.push(...zodDiagnostics(parsed.error).map(item => ({ ...item, path: `sets.${index}.${item.path ?? ''}` })));
    return parsed.success ? parsed.data as unknown as GenerationSet : candidate as GenerationSet;
  });
  return diagnostics.length
    ? { success: false, data: null, diagnostics }
    : { success: true, data: migrated, diagnostics: [] };
}

export function validateShapeSetsDocument(input: unknown): ValidationResult<ShapeSetsTransport> {
  const parsed = shapeSetsTransportSchema.safeParse(input);
  if (!parsed.success) return { success: false, data: null, diagnostics: zodDiagnostics(parsed.error) };
  const diagnostics = [
    ...duplicateDiagnostics(parsed.data.sets.map(set => set.id), 'set-id'),
    ...duplicateDiagnostics(parsed.data.sets.map(set => set.name), 'set-name'),
  ];
  const migratedSets = migrateAndValidateGenerationSets(parsed.data.sets);
  if (!migratedSets.success) diagnostics.push(...migratedSets.diagnostics);
  if (parsed.data.currentSetId && !parsed.data.sets.some(set => set.id === parsed.data.currentSetId)) {
    diagnostics.push({ severity: 'warning', code: 'missing-current-set', message: 'currentSetId does not identify an imported set.' });
  }
  const exportedSetIds = new Set(parsed.data.sets.map(set => set.id));
  parsed.data.sets.forEach((set, index) => {
    const copyDestinationId = (set.batchConfig as any)?.copyToPointsConfig?.destinationSetId;
    if (copyDestinationId && !exportedSetIds.has(copyDestinationId)) {
      diagnostics.push({
        severity: 'warning',
        code: 'external-set-reference',
        path: `sets.${index}.batchConfig.copyToPointsConfig.destinationSetId`,
        message: `"${set.name}" references shape set "${copyDestinationId}", which is not included in this file.`,
      });
    }
    const alignmentTargetId = (set.artboardAlignment as any)?.targetSetId;
    if (alignmentTargetId && !exportedSetIds.has(alignmentTargetId)) {
      diagnostics.push({
        severity: 'warning',
        code: 'external-set-reference',
        path: `sets.${index}.artboardAlignment.targetSetId`,
        message: `"${set.name}" references shape set "${alignmentTargetId}", which is not included in this file.`,
      });
    }
  });
  Object.keys(parsed.data.overlayManagerState?.debugGrid?.sets ?? {}).forEach(setId => {
    if (!exportedSetIds.has(setId)) diagnostics.push({
      severity: 'warning',
      code: 'external-overlay-reference',
      path: `overlayManagerState.debugGrid.sets.${setId}`,
      message: `A debug-grid overlay references shape set "${setId}", which is not included in this file.`,
    });
  });
  Object.keys(parsed.data.overlayManagerState?.ctpProperties ?? {}).forEach(key => {
    const setId = key.split(':', 1)[0];
    if (!exportedSetIds.has(setId)) diagnostics.push({
      severity: 'warning',
      code: 'external-overlay-reference',
      path: `overlayManagerState.ctpProperties.${key}`,
      message: `A copy-to-points overlay references shape set "${setId}", which is not included in this file.`,
    });
  });
  if (diagnostics.some(d => d.severity === 'error')) return { success: false, data: null, diagnostics };
  return {
    success: true,
    data: { ...(parsed.data as unknown as ShapeSetsTransport), sets: migratedSets.success ? migratedSets.data : parsed.data.sets as unknown as GenerationSet[] },
    diagnostics,
  };
}

export function validateArtboardsDocument(input: unknown): ValidationResult<ArtboardsTransport> {
  const parsed = artboardsTransportSchema.safeParse(input);
  if (!parsed.success) return { success: false, data: null, diagnostics: zodDiagnostics(parsed.error) };
  const diagnostics = [
    ...duplicateDiagnostics(parsed.data.artboards.map(board => board.id), 'artboard-id'),
    ...duplicateDiagnostics(parsed.data.artboards.map(board => board.name), 'artboard-name'),
  ];
  if (parsed.data.activeArtboardId && !parsed.data.artboards.some(board => board.id === parsed.data.activeArtboardId)) {
    diagnostics.push({ severity: 'warning', code: 'missing-active-artboard', message: 'activeArtboardId does not identify an imported artboard.' });
  }
  if (diagnostics.some(d => d.severity === 'error')) return { success: false, data: null, diagnostics };
  return { success: true, data: parsed.data as unknown as ArtboardsTransport, diagnostics };
}

export function createShapeSetsTransport(
  sets: readonly GenerationSet[],
  currentSetId: string | null,
  name = 'Shape sets',
  overlayManagerState?: OverlayManagerState,
): ShapeSetsTransport {
  const exportedSetIds = new Set(sets.map(set => set.id));
  const filteredOverlay = overlayManagerState
    ? remapOverlayManagerState(overlayManagerState, {}, exportedSetIds)
    : undefined;
  return {
    type: 'shape-sets', version: CONFIG_IMPORT_VERSION, timestamp: new Date().toISOString(),
    name, sets: sets.map(clone), currentSetId: currentSetId && exportedSetIds.has(currentSetId) ? currentSetId : null,
    ...(filteredOverlay && {
      overlayManagerState: clone({
        debugGrid: filteredOverlay.debugGrid,
        ctpProperties: filteredOverlay.ctpProperties,
      }),
    }),
  };
}

export function createArtboardsTransport(
  artboards: readonly (SavedArtboard | Artboard)[],
  activeArtboardId: string | null,
  name = 'Artboards',
): ArtboardsTransport {
  const exportedArtboardIds = new Set(artboards.map(artboard => artboard.id));
  return {
    type: 'artboards', version: CONFIG_IMPORT_VERSION, timestamp: new Date().toISOString(),
    name, artboards: artboards.map(normalizePortableArtboard),
    activeArtboardId: activeArtboardId && exportedArtboardIds.has(activeArtboardId) ? activeArtboardId : null,
  };
}

export function parseConfigImportJson(
  text: string,
): ValidationResult<ShapeSetsTransport | ArtboardsTransport> {
  if (text.length > CONFIG_IMPORT_LIMITS.maxDocumentBytes) {
    return { success: false, data: null, diagnostics: [{ severity: 'error', code: 'file-too-large', message: `Configuration files must be smaller than ${CONFIG_IMPORT_LIMITS.maxDocumentBytes} bytes.` }] };
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch {
    return { success: false, data: null, diagnostics: [{ severity: 'error', code: 'invalid-json', message: 'The configuration file is not valid JSON.' }] };
  }
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return { success: false, data: null, diagnostics: [{ severity: 'error', code: 'missing-type', message: 'Configuration file is missing its type.' }] };
  }
  return (value as { type?: unknown }).type === 'shape-sets'
    ? validateShapeSetsDocument(value)
    : (value as { type?: unknown }).type === 'artboards'
      ? validateArtboardsDocument(value)
      : { success: false, data: null, diagnostics: [{ severity: 'error', code: 'unsupported-type', message: 'This is not a portable shape-set or artboard file.' }] };
}

export function normalizePortableArtboard(board: SavedArtboard | Artboard): SavedArtboard {
  const dpi = board.dpi ?? 72;
  const unitType = board.unitType ?? 'pixels';
  return {
    id: board.id, name: board.name, x: board.x ?? 0, y: board.y ?? 0,
    width: board.width, height: board.height, dpi, unitType,
    backgroundColor: board.backgroundColor ?? '#ffffff',
    gridColor: board.gridColor, displayGrid: board.displayGrid ?? false,
    displayBorder: board.displayBorder ?? true, displayName: board.displayName ?? true,
    displayDimensions: board.displayDimensions ?? false, displayResolution: board.displayResolution ?? false,
    preset: board.preset, category: board.category, linkedDimensions: board.linkedDimensions,
    aspectRatio: board.aspectRatio,
    printConfig: getEffectivePrintConfig(board) || DEFAULT_PRINT_CONFIG,
  };
}

export type SetImportMode = 'append' | 'replace' | 'skip';
export type ArtboardImportMode = 'add' | 'replace-active' | 'replace-all' | 'skip';
export type SetConflictResolution = 'replace' | 'keep-both' | 'skip';

export type ShapeSetImportPlan = {
  generationSets: GenerationSet[];
  currentSetId: string | null;
  idMap: Record<string, string>;
  skippedIds: string[];
  diagnostics: ImportDiagnostic[];
  overlayManagerState?: OverlayManagerState;
};

/** Remap all known GenerationSet-id references inside an imported set. */
export function remapGenerationSetReferences(
  source: GenerationSet,
  idMap: Readonly<Record<string, string>>,
  sourceSetIds: ReadonlySet<string> = new Set(),
): GenerationSet {
  const copy = clone(source);
  const batchConfig = copy.batchConfig as Record<string, any>;
  const ctp = batchConfig.copyToPointsConfig as { destinationSetId?: string } | undefined;
  if (ctp?.destinationSetId && idMap[ctp.destinationSetId]) {
    batchConfig.copyToPointsConfig = {
      ...ctp,
      destinationSetId: idMap[ctp.destinationSetId],
    };
  }
  if (ctp?.destinationSetId && sourceSetIds.has(ctp.destinationSetId) && !idMap[ctp.destinationSetId]) {
    const { destinationSetId: _removed, ...rest } = ctp;
    batchConfig.copyToPointsConfig = rest;
  }
  const alignment = copy.artboardAlignment as Record<string, any>;
  if (alignment?.targetSetId && idMap[alignment.targetSetId]) {
    copy.artboardAlignment = { ...alignment, targetSetId: idMap[alignment.targetSetId] } as any;
  } else if (alignment?.targetSetId && sourceSetIds.has(alignment.targetSetId)) {
    const { targetSetId: _removed, ...rest } = alignment;
    copy.artboardAlignment = rest as any;
  }
  return copy;
}

/** Remap the per-set overlay keys when imported IDs are changed. */
export function remapOverlayManagerState(
  state: OverlayManagerState,
  idMap: Readonly<Record<string, string>>,
  validSetIds?: ReadonlySet<string>,
): OverlayManagerState {
  const debugGridSets = Object.fromEntries(
    Object.entries(state.debugGrid?.sets ?? {})
      .map(([id, value]) => [idMap[id] ?? id, value] as const)
      .filter(([id]) => !validSetIds || validSetIds.has(id)),
  );
  const ctpProperties = Object.fromEntries(
    Object.entries(state.ctpProperties ?? {}).flatMap(([key, value]) => {
      const separator = key.indexOf(':');
      const sourceId = separator === -1 ? key : key.slice(0, separator);
      const mappedId = idMap[sourceId] ?? sourceId;
      if (validSetIds && !validSetIds.has(mappedId)) return [];
      return [[`${mappedId}${separator === -1 ? '' : key.slice(separator)}`, value]];
    }),
  );
  return {
    ...clone(state),
    debugGrid: { ...(state.debugGrid ?? { sets: {} }), sets: debugGridSets },
    ctpProperties,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function freshId(sourceId: string, used: Set<string>, index: number): string {
  const base = `import-${sourceId}-${index}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

export function planShapeSetImport(
  incoming: readonly GenerationSet[],
  existing: readonly GenerationSet[],
  mode: SetImportMode,
  resolutions: Readonly<Record<string, SetConflictResolution>> = {},
  incomingCurrentSetId: string | null = null,
  existingCurrentSetId: string | null = null,
  existingOverlay?: OverlayManagerState,
  incomingOverlay?: OverlayManagerState,
): ShapeSetImportPlan {
  if (mode === 'skip') {
    return {
      generationSets: existing.map(clone),
      currentSetId: existingCurrentSetId,
      idMap: {},
      skippedIds: incoming.map(set => set.id),
      diagnostics: [],
      overlayManagerState: existingOverlay
        ? remapOverlayManagerState(existingOverlay, {}, new Set(existing.map(set => set.id)))
        : undefined,
    };
  }
  const result = mode === 'replace' ? [] : existing.map(clone);
  const usedIds = new Set(result.map(set => set.id));
  const usedNames = new Set(result.map(set => set.name));
  const idMap: Record<string, string> = {};
  const skippedIds: string[] = [];
  const diagnostics: ImportDiagnostic[] = [];

  incoming.forEach((source, index) => {
    const conflictIndex = result.findIndex(set => set.id === source.id || set.name === source.name);
    const requested = resolutions[String(index)];
    const resolution = requested ?? (conflictIndex >= 0 ? (mode === 'replace' ? 'replace' : 'keep-both') : 'keep-both');
    if (resolution === 'skip') { skippedIds.push(source.id); return; }
    if (resolution === 'replace' && conflictIndex >= 0) {
      const localId = result[conflictIndex].id;
      idMap[source.id] = localId;
      result[conflictIndex] = clone({ ...source, id: localId });
      usedNames.add(source.name);
      return;
    }
    let id = source.id;
    if (usedIds.has(id)) id = freshId(source.id, usedIds, index);
    let name = source.name;
    if (usedNames.has(name)) {
      let suffix = 2;
      while (usedNames.has(`${name} (${suffix})`)) suffix++;
      name = `${name} (${suffix})`;
    }
    idMap[source.id] = id;
    usedIds.add(id); usedNames.add(name);
    result.push(clone({ ...source, id, name }));
  });
  // Resolve references only after the complete source→local map is known.
  const importedIds = new Set(incoming.map(set => idMap[set.id]).filter(Boolean));
  for (let index = 0; index < result.length; index++) {
    if (importedIds.has(result[index].id)) {
      result[index] = remapGenerationSetReferences(result[index], idMap, new Set(incoming.map(set => set.id)));
    }
  }
  let currentSetId = incomingCurrentSetId ? idMap[incomingCurrentSetId] ?? null : null;
  if (mode === 'append') currentSetId = existingCurrentSetId;
  if (mode === 'replace' && currentSetId === null && result.length) currentSetId = result[0].id;
  const validSetIds = new Set(result.map(set => set.id));
  const baseOverlay = mode === 'append' && existingOverlay
    ? remapOverlayManagerState(existingOverlay, {}, validSetIds)
    : undefined;
  const importedOverlay = incomingOverlay
    ? remapOverlayManagerState(incomingOverlay, idMap, validSetIds)
    : undefined;
  const overlayManagerState = (baseOverlay || importedOverlay || existingOverlay)
    ? {
      ...(existingOverlay || {}),
      ...(baseOverlay || {}),
      ...(importedOverlay || {}),
      debugGrid: importedOverlay?.debugGrid ?? baseOverlay?.debugGrid ?? { ...(existingOverlay?.debugGrid ?? {}), sets: {} },
      ctpProperties: importedOverlay?.ctpProperties ?? baseOverlay?.ctpProperties ?? {},
    } as OverlayManagerState
    : undefined;
  return { generationSets: result, currentSetId, idMap, skippedIds, diagnostics, overlayManagerState };
}

export type ArtboardImportPlan = {
  artboards: SavedArtboard[];
  activeArtboardId: string | null;
  idMap: Record<string, string>;
  diagnostics: ImportDiagnostic[];
};

export function planArtboardImport(
  incoming: readonly (SavedArtboard | Artboard)[],
  existing: readonly Artboard[],
  activeArtboardId: string,
  mode: ArtboardImportMode,
  incomingActiveArtboardId: string | null = null,
): ArtboardImportPlan {
  const normalized = incoming.map(normalizePortableArtboard);
  if (mode === 'skip') return { artboards: existing.map(normalizePortableArtboard), activeArtboardId, idMap: {}, diagnostics: [] };
  if (mode === 'replace-active') {
    const first = normalized[0];
    if (!first) return { artboards: existing.map(normalizePortableArtboard), activeArtboardId, idMap: {}, diagnostics: [{ severity: 'warning', code: 'empty-import', message: 'No artboard was imported.' }] };
    const idMap = { [first.id]: activeArtboardId };
    return { artboards: existing.map(board => board.id === activeArtboardId ? { ...first, id: activeArtboardId } : normalizePortableArtboard(board)), activeArtboardId, idMap, diagnostics: [] };
  }
  if (mode === 'replace-all') {
    const used = new Set<string>();
    const idMap: Record<string, string> = {};
    const boards = normalized.map((board, index) => {
      let id = board.id;
      if (used.has(id)) id = freshId(board.id, used, index);
      used.add(id); idMap[board.id] = id;
      return { ...board, id };
    });
    const nextActive = (incomingActiveArtboardId && idMap[incomingActiveArtboardId])
      ?? boards[0]?.id ?? null;
    return { artboards: boards, activeArtboardId: nextActive, idMap, diagnostics: boards.length ? [] : [{ severity: 'warning', code: 'empty-import', message: 'No artboard was imported.' }] };
  }
  const used = new Set(existing.map(board => board.id));
  const names = new Set(existing.map(board => board.name));
  const idMap: Record<string, string> = {};
  const boards = existing.map(normalizePortableArtboard);
  normalized.forEach((board, index) => {
    const id = used.has(board.id) ? freshId(board.id, used, index) : board.id;
    let name = board.name;
    if (names.has(name)) { let suffix = 2; while (names.has(`${name} (${suffix})`)) suffix++; name = `${name} (${suffix})`; }
    used.add(id); names.add(name); idMap[board.id] = id;
    boards.push({ ...board, id, name });
  });
  return {
    artboards: boards,
    activeArtboardId: incomingActiveArtboardId && idMap[incomingActiveArtboardId]
      ? idMap[incomingActiveArtboardId]
      : activeArtboardId,
    idMap,
    diagnostics: [],
  };
}