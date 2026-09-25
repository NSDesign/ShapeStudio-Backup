import { describe, expect, it } from 'vitest';
import { GenerationSetUtils } from '@shared/schema';
import type { GenerationSet } from '@shared/schema';
import {
  createShapeSetsTransport,
  createArtboardsTransport,
  parseConfigImportJson,
  validateShapeSetsDocument,
  planArtboardImport,
  planShapeSetImport,
  remapOverlayManagerState,
  remapGenerationSetReferences,
} from './configImport';
import { DEFAULT_OVERLAY_MANAGER_STATE } from '@shared/schema';
import type { Artboard } from './shapeTypes';

function set(id: string, name: string): GenerationSet {
  return { ...GenerationSetUtils.createDefault(id, name), enabledShapeTypes: ['circle'] as any, generationOrder: 0 };
}

function board(id: string, name: string): Artboard {
  return {
    id, name, x: 10, y: 20, width: 400, height: 300, dpi: 72, unitType: 'pixels',
    backgroundColor: '#fff', displayGrid: false, displayBorder: true,
  };
}

describe('portable configuration imports', () => {
  it('round-trips a shape-set transport without mutating source data', () => {
    const source = [set('source', 'Dots')];
    const document = createShapeSetsTransport(source, 'source');
    source[0].name = 'Changed locally';
    expect(document.sets[0].name).toBe('Dots');
  });

  it('filters current IDs and overlay entries to the exported shape-set subset', () => {
    const overlay = {
      ...DEFAULT_OVERLAY_MANAGER_STATE,
      debugGrid: { sets: { included: { visible: true } as any, omitted: { visible: true } as any } },
      ctpProperties: { 'included:point': { visible: true }, 'omitted:point': { visible: true } },
    };
    const document = createShapeSetsTransport([set('included', 'Included')], 'omitted', 'Subset', overlay);
    expect(document.currentSetId).toBeNull();
    expect(Object.keys(document.overlayManagerState?.debugGrid?.sets ?? {})).toEqual(['included']);
    expect(Object.keys(document.overlayManagerState?.ctpProperties ?? {})).toEqual(['included:point']);
  });

  it('filters the active artboard ID to the exported artboard subset', () => {
    const document = createArtboardsTransport([board('included', 'Included')], 'omitted');
    expect(document.activeArtboardId).toBeNull();
  });

  it('warns when imported shape sets reference sets outside the file', () => {
    const source = set('source', 'Source');
    source.batchConfig = {
      ...(source.batchConfig as any),
      copyToPointsConfig: {
        ...(source.batchConfig as any).copyToPointsConfig,
        destinationSetId: 'omitted',
      },
    } as any;
    source.artboardAlignment = { ...(source.artboardAlignment as any), targetSetId: 'also-omitted' } as any;
    const result = validateShapeSetsDocument(createShapeSetsTransport([source], 'source'));
    expect(result.diagnostics.filter(d => d.code === 'external-set-reference')).toHaveLength(2);
  });

  it('remaps every known set reference and prunes skipped overlay keys', () => {
    const source = set('remote', 'Remote');
    source.artboardAlignment = { ...(source.artboardAlignment as any), targetSetId: 'remote' } as any;
    source.batchConfig = { copyToPointsConfig: { destinationSetId: 'remote' } } as any;
    const remapped = remapGenerationSetReferences(source, { remote: 'local' }, new Set(['remote']));
    expect((remapped.artboardAlignment as any).targetSetId).toBe('local');
    expect((remapped.batchConfig as any).copyToPointsConfig.destinationSetId).toBe('local');
    const overlay = remapOverlayManagerState({
      ...DEFAULT_OVERLAY_MANAGER_STATE,
      debugGrid: { sets: { remote: { visible: true } as any, gone: { visible: true } as any } },
      ctpProperties: { remote: { opacity: 1 } as any, 'gone:point': { opacity: 1 } as any },
    }, { remote: 'local' }, new Set(['local']));
    expect(overlay.debugGrid.sets.local).toBeDefined();
    expect(overlay.debugGrid.sets.gone).toBeUndefined();
    expect(overlay.ctpProperties['local']).toBeDefined();
    expect(overlay.ctpProperties['gone:point']).toBeUndefined();
  });

  it('does not inherit stale per-set overlay entries on replacement', () => {
    const stale = { ...DEFAULT_OVERLAY_MANAGER_STATE, debugGrid: { sets: { same: { visible: true } as any } }, ctpProperties: { same: { opacity: 1 } as any } };
    const plan = planShapeSetImport([set('same', 'New')], [set('same', 'Old')], 'replace', {}, 'same', 'same', stale);
    expect(plan.overlayManagerState?.debugGrid.sets).toEqual({});
    expect(plan.overlayManagerState?.ctpProperties).toEqual({});
    expect(plan.overlayManagerState?.debugGridVisible).toBe(stale.debugGridVisible);
  });

  it('rejects duplicate source IDs before planning', () => {
    const result = validateShapeSetsDocument(createShapeSetsTransport([set('same', 'A'), set('same', 'B')], null));
    expect(result.success).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'duplicate-set-id')).toBe(true);
  });

  it('plans append conflicts with deterministic IDs and names', () => {
    const incoming = [set('same', 'Dots'), set('new', 'Dots')];
    const existing = [set('same', 'Dots')];
    const plan = planShapeSetImport(incoming, existing, 'append', { '0': 'replace', '1': 'keep-both' }, 'same', 'local-current');
    expect(plan.generationSets.map(item => item.id)).toEqual(['same', 'new']);
    expect(plan.generationSets[1].name).toBe('Dots (2)');
    expect(plan.currentSetId).toBe('local-current');
    expect(plan.idMap).toEqual({ same: 'same', new: 'new' });
  });

  it('remaps CTP and overlay keys when set IDs change', () => {
    const incoming = [
      set('source', 'Source'),
      { ...set('target', 'Target'), batchConfig: { copyToPointsConfig: { destinationSetId: 'source' } } } as GenerationSet,
    ];
    const plan = planShapeSetImport(incoming, [set('source', 'Existing')], 'append', {}, 'target');
    const importedTarget = plan.generationSets.find(item => item.name === 'Target');
    expect((importedTarget?.batchConfig as any).copyToPointsConfig.destinationSetId).toBe('import-source-0');
    const overlay = {
      ...DEFAULT_OVERLAY_MANAGER_STATE,
      debugGrid: { sets: { source: { visible: true, color: '#fff', opacity: 1, order: 0 } } },
      ctpProperties: { 'source:circle:radius': { visible: true } },
    };
    const remapped = remapOverlayManagerState(overlay, { source: 'local-source' });
    expect(remapped.debugGrid.sets['local-source']).toBeDefined();
    expect(remapped.ctpProperties['local-source:circle:radius']).toBeDefined();
  });

  it('supports skip mode while preserving existing input', () => {
    const existing = [set('local', 'Local')];
    const plan = planShapeSetImport([set('remote', 'Remote')], existing, 'skip');
    expect(plan.generationSets).toEqual(existing);
    expect(plan.skippedIds).toEqual(['remote']);
    expect(existing[0].name).toBe('Local');
  });

  it('adds artboards without mutating existing boards and remaps collisions', () => {
    const existing = [board('board-1', 'Canvas')];
    const plan = planArtboardImport([board('board-1', 'Canvas')], existing, 'board-1', 'add', 'board-1');
    expect(plan.artboards).toHaveLength(2);
    expect(plan.artboards[1].id).toBe('import-board-1-0');
    expect(plan.artboards[1].name).toBe('Canvas (2)');
    expect(existing[0].id).toBe('board-1');
  });

  it('replaces the active artboard while preserving its local identity', () => {
    const plan = planArtboardImport([board('remote', 'Remote')], [board('local', 'Local')], 'local', 'replace-active', 'remote');
    expect(plan.artboards).toHaveLength(1);
    expect(plan.artboards[0].id).toBe('local');
    expect(plan.artboards[0].name).toBe('Remote');
    expect(plan.idMap).toEqual({ remote: 'local' });
  });

  it('uses the imported active artboard for add and replace-all modes', () => {
    const plan = planArtboardImport(
      [board('first', 'First'), board('second', 'Second')],
      [board('local', 'Local')],
      'local',
      'replace-all',
      'second',
    );
    expect(plan.activeArtboardId).toBe('second');
    expect(plan.artboards.map(item => item.id)).toEqual(['first', 'second']);
  });

  it('returns structured diagnostics for malformed JSON', () => {
    const result = parseConfigImportJson('{not-json');
    expect(result.success).toBe(false);
    expect(result.diagnostics[0].code).toBe('invalid-json');
  });
});