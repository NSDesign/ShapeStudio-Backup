// Stroke profile types for parameterised stroke width variation
export type StrokeProfileType =
  | 'ramp-asc'
  | 'ramp-desc'
  | 'wave'
  | 'hump-smooth'
  | 'hump-sharp'
  | 'zigzag';

export interface StrokeProfile {
  profileType: StrokeProfileType;
  profileFrequency: number;   // How many cycles along the path (1 = one wave per perimeter)
  profilePhaseOffset: number; // Phase offset in radians
  profileScale: number;       // 0..1 — amount of width variation (0 = uniform, 1 = full swing)
}

/**
 * Evaluate a stroke profile at normalised path position t ∈ [0, 1].
 * Returns a width multiplier. Always ≥ 0.05 to avoid zero-width segments.
 *
 * With profileScale = 0.5 the multiplier swings between 0.5× and 1.5× baseWidth.
 * With profileScale = 1.0 it swings between 0× and 2× (clamped to 0.05×).
 */
export function evaluateStrokeProfile(t: number, profile: StrokeProfile): number {
  const { profileType, profileFrequency, profilePhaseOffset, profileScale } = profile;

  const f = Math.max(0.01, profileFrequency);
  const phase = profilePhaseOffset;

  let raw: number; // 0..1 range before scaling

  switch (profileType) {
    case 'ramp-asc':
      raw = t;
      break;
    case 'ramp-desc':
      raw = 1 - t;
      break;
    case 'wave':
      raw = 0.5 + 0.5 * Math.sin(2 * Math.PI * f * t + phase);
      break;
    case 'hump-smooth': {
      const center = 0.5;
      const sigma = 0.18;
      raw = Math.exp(-((t - center) ** 2) / (2 * sigma * sigma));
      break;
    }
    case 'hump-sharp':
      raw = 1 - Math.abs(2 * t - 1);
      break;
    case 'zigzag': {
      const cyclePos = ((t * f + phase / (2 * Math.PI)) % 1 + 1) % 1;
      raw = Math.abs(cyclePos - 0.5) * 2;
      break;
    }
    default:
      raw = 1;
  }

  // Map raw [0,1] to multiplier centred on 1.0
  // At profileScale=0: always 1.0 (uniform)
  // At profileScale=1: multiplier range [0, 2] from raw [0,1]
  const multiplier = 1.0 + (raw - 0.5) * 2 * profileScale;
  return Math.max(0.05, multiplier);
}

// ─── Stroke pattern types ────────────────────────────────────────────────────
export type StrokePatternType = 'none' | 'dash' | 'dot' | 'squiggle';

export interface StrokePatternConfig {
  pattern: StrokePatternType;
  dashLength: number;    // px
  dashGap: number;       // px
  dotSpacing: number;    // px (gap between dots)
  squiggleAmplitude: number;  // px offset
  squiggleFrequency: number;  // cycles per pixel of arc length
  squigglePhase: number;      // radians
}

/**
 * Compute outward unit normals for a closed contour.
 * Each normal points perpendicular to the path tangent, outward from the centroid.
 */
export function computeNormals(pts: { x: number; y: number }[]): { nx: number; ny: number }[] {
  const n = pts.length;
  const normals: { nx: number; ny: number }[] = [];

  // Compute centroid for consistent outward orientation
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    // Tangent from prev→next
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty);
    if (len > 0) { tx /= len; ty /= len; }
    // Normal: perpendicular to tangent
    let nx = -ty;
    let ny = tx;
    // Flip if pointing inward
    const toCX = cx - pts[i].x;
    const toCY = cy - pts[i].y;
    if (nx * toCX + ny * toCY > 0) { nx = -nx; ny = -ny; }
    normals.push({ nx, ny });
  }
  return normals;
}

/**
 * Compute cumulative arc lengths for a closed contour (length[i] = arc length to pts[i]).
 * Returns array of length n+1 where last element = total perimeter.
 */
export function computeArcLengths(pts: { x: number; y: number }[]): number[] {
  const n = pts.length;
  const arcLen: number[] = [0];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    arcLen.push(arcLen[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return arcLen;
}
