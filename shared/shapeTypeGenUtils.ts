import type { SupportedShapeType } from './schema';

export type ShapeTypeGenMode = 'random' | 'weighted' | 'fixed' | 'sequence';

function weightedRandom(items: SupportedShapeType[], weights: number[]): SupportedShapeType {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let rand = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function pickShapeType(
  mode: ShapeTypeGenMode | undefined,
  enabledTypes: SupportedShapeType[],
  weights: Partial<Record<SupportedShapeType, number>> | undefined,
  sequence: SupportedShapeType[] | undefined,
  shapeIndex: number,
): SupportedShapeType {
  if (enabledTypes.length === 0) return 'rectangle';
  switch (mode ?? 'random') {
    case 'weighted': {
      const w = enabledTypes.map(t => Math.max(0, weights?.[t] ?? 1));
      return weightedRandom(enabledTypes, w);
    }
    case 'sequence': {
      const seq = (sequence ?? []).filter(t => enabledTypes.includes(t));
      if (seq.length === 0) return enabledTypes[shapeIndex % enabledTypes.length];
      return seq[shapeIndex % seq.length];
    }
    default:
      return enabledTypes[Math.floor(Math.random() * enabledTypes.length)];
  }
}

export function buildFixedTypeList(
  enabledTypes: SupportedShapeType[],
  fixedCounts: Partial<Record<SupportedShapeType, number>> | undefined,
): SupportedShapeType[] {
  const list: SupportedShapeType[] = [];
  for (const t of enabledTypes) {
    const count = Math.max(0, Math.floor(fixedCounts?.[t] ?? 1));
    for (let i = 0; i < count; i++) list.push(t);
  }
  if (list.length === 0) return enabledTypes.length ? [enabledTypes[0]] : ['rectangle'];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export function fixedModeCount(
  enabledTypes: SupportedShapeType[],
  fixedCounts: Partial<Record<SupportedShapeType, number>> | undefined,
): number {
  return Math.max(1, enabledTypes.reduce(
    (sum, t) => sum + Math.max(0, Math.floor(fixedCounts?.[t] ?? 1)),
    0
  ));
}
