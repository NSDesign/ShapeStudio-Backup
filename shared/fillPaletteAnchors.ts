export type FillPaletteDistribution = 'manual' | 'even' | 'logarithmic' | 'exponential';
export type FillPaletteInterpolation = 'linear' | 'sine' | 'exponential' | 'logarithmic' | 'bounce' | 'zigzag' | 'sawtooth';
export interface FillPaletteAssignment {
  shapeNumber: number; // 1-based within one generated set
  paletteIndex: number; // 0-based index in the current palette
}

export function removePaletteColourAssignments(assignments: FillPaletteAssignment[], removedIndex: number): FillPaletteAssignment[] {
  return assignments
    .filter(assignment => assignment.paletteIndex !== removedIndex)
    .map(assignment => ({
      ...assignment,
      paletteIndex: assignment.paletteIndex > removedIndex ? assignment.paletteIndex - 1 : assignment.paletteIndex,
    }));
}

export function validateFillPaletteAssignments(assignments: FillPaletteAssignment[], paletteLength: number): string | null {
  if (!paletteLength) return 'Add at least one palette colour.';
  if (!assignments.length) return 'Assign at least one palette colour to a shape.';
  const seen = new Set<number>();
  for (const { shapeNumber, paletteIndex } of assignments) {
    if (!Number.isSafeInteger(shapeNumber) || shapeNumber < 1) return 'Shape positions must be positive whole numbers (starting at 1).';
    if (!Number.isSafeInteger(paletteIndex) || paletteIndex < 0 || paletteIndex >= paletteLength) return 'An assignment refers to a missing palette colour.';
    if (seen.has(shapeNumber)) return `Shape ${shapeNumber} has more than one assigned colour.`;
    seen.add(shapeNumber);
  }
  return null;
}

function spacing(t: number, mode: FillPaletteDistribution): number {
  // Logarithmic distribution packs anchor positions near the beginning;
  // exponential packs them near the end. These are intentionally opposite
  // the corresponding interpolation curves (which describe blend progress).
  if (mode === 'logarithmic') return (Math.pow(10, t) - 1) / 9;
  if (mode === 'exponential') return Math.log1p(9 * t) / Math.log(10);
  return t;
}

export function distributeFillPaletteAnchors(paletteLength: number, shapeCount: number, mode: Exclude<FillPaletteDistribution, 'manual'>): FillPaletteAssignment[] {
  if (!Number.isSafeInteger(shapeCount) || shapeCount < paletteLength) {
    throw new Error(`Cannot assign ${paletteLength} palette colours to ${shapeCount} shapes; add shapes or remove colours.`);
  }
  if (paletteLength === 0) return [];
  if (paletteLength === 1) return [{ shapeNumber: 1, paletteIndex: 0 }];
  const anchors: FillPaletteAssignment[] = [];
  for (let i = 0; i < paletteLength; i++) {
    const ideal = 1 + Math.round(spacing(i / (paletteLength - 1), mode) * (shapeCount - 1));
    const previous = anchors.at(-1)?.shapeNumber ?? 0;
    anchors.push({
      shapeNumber: Math.max(previous + 1, Math.min(ideal, shapeCount - (paletteLength - i - 1))),
      paletteIndex: i,
    });
  }
  return anchors;
}

export function fillPaletteCurve(t: number, mode: FillPaletteInterpolation): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  switch (mode) {
    case 'sine': return (1 - Math.cos(Math.PI * t)) / 2;
    case 'exponential': return (Math.pow(10, t) - 1) / 9;
    case 'logarithmic': return Math.log1p(9 * t) / Math.log(10);
    case 'bounce': {
      const n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
      return n * (t -= 2.625 / d) * t + 0.984375;
    }
    case 'zigzag': return t < 1 / 3 ? 3 * t : t < 2 / 3 ? 2 - 3 * t : 3 * t - 2;
    case 'sawtooth': return (t * 3) % 1;
    default: return t;
  }
}

function hexHsl(hex: string): { h: number; s: number; l: number } {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Invalid palette colour: ${hex}`);
  const [r, g, b] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const l = (max + min) / 2;
  if (!delta) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

function hslHex(h: number, s: number, l: number): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - chroma / 2;
  const sector = Math.floor(h / 60) % 6;
  const [r, g, b] = ([
    [chroma, x, 0], [x, chroma, 0], [0, chroma, x],
    [0, x, chroma], [x, 0, chroma], [chroma, 0, x],
  ][sector]).map(value => Math.round((value + m) * 255));
  return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

export function resolveFillPaletteColour(
  palette: string[],
  shapeIndex: number,
  shapeCount: number,
  distribution: FillPaletteDistribution,
  assignments: FillPaletteAssignment[],
  interpolation: FillPaletteInterpolation,
): string {
  const anchors = distribution === 'manual'
    ? [...assignments].sort((a, b) => a.shapeNumber - b.shapeNumber)
    : distributeFillPaletteAnchors(palette.length, shapeCount, distribution);
  const error = validateFillPaletteAssignments(anchors, palette.length);
  if (error) throw new Error(error);
  const position = shapeIndex + 1;
  if (position <= anchors[0].shapeNumber) return palette[anchors[0].paletteIndex];
  for (let i = 1; i < anchors.length; i++) {
    const next = anchors[i];
    if (position === next.shapeNumber) return palette[next.paletteIndex];
    if (position < next.shapeNumber) {
      const prev = anchors[i - 1];
      const t = fillPaletteCurve((position - prev.shapeNumber) / (next.shapeNumber - prev.shapeNumber), interpolation);
      const a = hexHsl(palette[prev.paletteIndex]), b = hexHsl(palette[next.paletteIndex]);
      const delta = ((b.h - a.h + 540) % 360) - 180;
      return hslHex((a.h + delta * t + 360) % 360, a.s + (b.s - a.s) * t, a.l + (b.l - a.l) * t);
    }
  }
  return palette[anchors[anchors.length - 1].paletteIndex];
}