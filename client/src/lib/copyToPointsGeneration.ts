import type { BatchConfigSettings, GenerationSet } from '@shared/schema';
import { DEFAULT_CTP_TARGET_CONFIG } from '@shared/schema';
import { applyCopyToPointsDistribution, harvestDestinationPoints } from '@shared/copyToPointsUtils';
import type { ScatterSettings } from './shapeTypes';

type CopySet = Pick<GenerationSet, 'id' | 'name' | 'generationOrder' | 'batchConfig'>;
type ConfigForSet<T extends CopySet> = (set: T) => BatchConfigSettings | undefined;

/** The selected set reads live scatter settings from the generator's closure. */
export function batchSetScatterOverride(
  set: GenerationSet,
  isCurrentSet: boolean,
  count: number,
): Partial<ScatterSettings> {
  if (isCurrentSet) return {};
  return {
    shapeCountMode: set.shapeCountMode,
    fixedShapeCount: count,
    minCount: set.shapeCountRange[0],
    maxCount: set.shapeCountRange[1],
    shapeSpecific: set.shapeSpecificProperties as ScatterSettings['shapeSpecific'],
  };
}

/** Keep dependency order independent from rendering/z-index order. */
export function sortCopyToPointsSets<T extends CopySet>(
  sets: T[],
  configForSet: ConfigForSet<T> = set => set.batchConfig,
): { sorted: T[]; cycleSetIds: Set<string> } {
  const ordered = [...sets].sort((a, b) => a.generationOrder - b.generationOrder);
  const byId = new Map(sets.map(set => [set.id, set]));
  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const cycleSetIds = new Set<string>();
  const sorted: T[] = [];
  function visit(set: T) {
    if (visited.has(set.id)) return;
    if (inProgress.has(set.id)) {
      cycleSetIds.add(set.id);
      return;
    }
    inProgress.add(set.id);
    const config = configForSet(set);
    const destinationId = config?.copyToPointsEnabled ? config.copyToPointsConfig?.destinationSetId : undefined;
    const destination = destinationId ? byId.get(destinationId) : undefined;
    if (destination) visit(destination);
    inProgress.delete(set.id);
    visited.add(set.id);
    sorted.push(set);
  }
  ordered.forEach(visit);
  if (cycleSetIds.size) {
    console.warn(`[CTP] Circular dependency detected involving set(s): ${Array.from(cycleSetIds).join(', ')}`);
    return { sorted: ordered, cycleSetIds };
  }
  return { sorted, cycleSetIds };
}

/** Call after set transforms and alignment, before Echo and rendering. */
export function placeCopyToPointsShapes<T extends { transform: unknown }, S extends CopySet>(
  set: S,
  shapes: T[],
  shapesBySetId: Map<string, T[]>,
  sets: S[],
  configForSet: ConfigForSet<S> = entry => entry.batchConfig,
): T[] {
  shapesBySetId.set(set.id, [...(shapesBySetId.get(set.id) ?? []), ...shapes]);
  const config = configForSet(set);
  if (!config?.copyToPointsEnabled || !config.copyToPointsConfig) return shapes;

  const destinationShapes = shapesBySetId.get(config.copyToPointsConfig.destinationSetId);
  if (!destinationShapes?.length) {
    console.warn(`[CTP] No generated destination shapes for set "${set.name}"`);
    return shapes;
  }
  const destination = sets.find(entry => entry.id === config.copyToPointsConfig?.destinationSetId);
  const target = (destination && configForSet(destination)?.copyToPointsTargetConfig) ?? DEFAULT_CTP_TARGET_CONFIG;
  const points = harvestDestinationPoints(destinationShapes, target);
  if (!points.length) return shapes;
  const placed = applyCopyToPointsDistribution(shapes, points, config.copyToPointsConfig, target) as T[];
  shapesBySetId.set(set.id, placed);
  return placed;
}

export function hideCopyToPointsSource<T extends CopySet>(
  set: T,
  enabledSets: T[],
  configForSet: ConfigForSet<T> = entry => entry.batchConfig,
): boolean {
  return !!set.batchConfig?.hideWhenUsedAsPointSource && enabledSets.some(entry =>
    entry.id !== set.id &&
    configForSet(entry)?.copyToPointsEnabled &&
    configForSet(entry)?.copyToPointsConfig?.destinationSetId === set.id
  );
}

/** Apply the same post-generator positioning to live and batch shapes before harvesting. */
export function positionGenerationSetShapes<T extends { transform: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }; width?: number; height?: number }>(
  shapes: T[],
  set: Pick<GenerationSet, 'setTransform' | 'artboardAlignment'>,
  artboard?: { x: number; y: number; width: number; height: number },
): void {
  const transform = set.setTransform;
  if (transform) {
    shapes.forEach(shape => {
      shape.transform.x += transform.x;
      shape.transform.y += transform.y;
      shape.transform.rotation += transform.rotation;
      shape.transform.scaleX *= transform.scaleX;
      shape.transform.scaleY *= transform.scaleY;
    });
  }
  const alignment = set.artboardAlignment;
  if (!artboard || !shapes.length || !alignment || alignment.fitToArtboard || alignment.alignTo === 'none') return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  shapes.forEach(shape => {
    minX = Math.min(minX, shape.transform.x - (shape.width || 50) / 2);
    minY = Math.min(minY, shape.transform.y - (shape.height || 50) / 2);
    maxX = Math.max(maxX, shape.transform.x + (shape.width || 50) / 2);
    maxY = Math.max(maxY, shape.transform.y + (shape.height || 50) / 2);
  });
  const margin = alignment.margin || 0;
  const top = typeof margin === 'number' ? margin : margin.top;
  const bottom = typeof margin === 'number' ? margin : margin.bottom;
  const left = typeof margin === 'number' ? margin : margin.left;
  const right = typeof margin === 'number' ? margin : margin.right;
  let targetX = artboard.x + artboard.width / 2;
  let targetY = artboard.y + artboard.height / 2;
  switch (alignment.alignmentType) {
    case 'top-left': targetX = artboard.x + left; targetY = artboard.y + top; break;
    case 'top-center': targetY = artboard.y + top; break;
    case 'top-right': targetX = artboard.x + artboard.width - right; targetY = artboard.y + top; break;
    case 'center-left': targetX = artboard.x + left; break;
    case 'center-right': targetX = artboard.x + artboard.width - right; break;
    case 'bottom-left': targetX = artboard.x + left; targetY = artboard.y + artboard.height - bottom; break;
    case 'bottom-center': targetY = artboard.y + artboard.height - bottom; break;
    case 'bottom-right': targetX = artboard.x + artboard.width - right; targetY = artboard.y + artboard.height - bottom; break;
  }
  const dx = targetX - (minX + maxX) / 2;
  const dy = targetY - (minY + maxY) / 2;
  shapes.forEach(shape => { shape.transform.x += dx; shape.transform.y += dy; });
}