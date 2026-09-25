/**
 * Shared Shape Roughness & Jitter Utilities
 * Used by both client-side (shapeRenderer.ts, useShapeEditor.ts)
 * and server-side (canvasRenderer.ts, batchConfigProcessor.ts)
 */

import { createNoise2D } from 'simplex-noise';

export interface LocalJitterConfig {
  enabled: boolean;
  enabledX: boolean;
  enabledY: boolean;
  enabledZ: boolean;           // Tangential (along-boundary) displacement
  modeX: 'axial' | 'from-center';
  modeY: 'axial' | 'from-center';
  amountX: number;
  amountY: number;
  amountZ: number;             // Tangential displacement amount
  positiveOnlyX: boolean;
  positiveOnlyY: boolean;
  positiveOnlyZ: boolean;
  reverseX: boolean;
  reverseY: boolean;
  reverseZ: boolean;
  driver: 'random' | 'simplex';
  scale: number;
  octaves: number;
  lacunarity: number;
  gain: number;
  resampleEnabled: boolean;
  resampleDensity: number;
}

export interface GlobalJitterConfig {
  enabled: boolean;
  amount: number;
  biasX: number;
  biasY: number;
  biasZ: number;               // Rotation bias (-1 to 1) → maps to rotation displacement
  positiveOnly: boolean;
  reverse: boolean;
  driver: 'random' | 'simplex';
  scale: number;
  octaves: number;
  lacunarity: number;
  gain: number;
}

// Simple 32-bit hash for seeding from string IDs
function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

// Seeded PRNG (mulberry32) for deterministic random jitter
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build a seeded noise2D function
function makeNoise2D(seed: number) {
  const prng = mulberry32(seed);
  return createNoise2D(prng);
}

/**
 * Octave noise composition (FBM - fractal brownian motion)
 */
function computeOctaveNoise(
  noise2D: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves: number,
  lacunarity: number,
  gain: number
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += noise2D(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return maxValue > 0 ? value / maxValue : 0;
}

/**
 * Shared noise fields for global jitter — fixed seeds so all shapes in a
 * generation share the SAME noise field, producing spatially correlated
 * (smooth / organic) displacement across the layout.
 *
 * Shapes sample these fields at positions derived from their index, which
 * means adjacent shapes get adjacent samples → correlated output.
 *
 * Use separate fields for X, Y, and Z so axes are independent.
 */
const GLOBAL_NOISE_X = makeNoise2D(0x4a7c15f2);
const GLOBAL_NOISE_Y = makeNoise2D(0x9d3eb7a1);
const GLOBAL_NOISE_Z = makeNoise2D(0x2f86c3d4);

/**
 * Apply global jitter to a shape position.
 * Returns dx/dy offsets (pixels) and dz offset (degrees) for rotation.
 *
 * Simplex mode: samples a shared noise field at positions determined by
 * shapeIndex, so adjacent shapes receive correlated (smooth) displacement.
 *
 * Random mode: seeded deterministically per shape for uncorrelated output.
 */
export function computeGlobalJitter(
  config: GlobalJitterConfig,
  shapeIndex: number,
  shapeId: string
): { dx: number; dy: number; dz: number } {
  if (!config.enabled || config.amount <= 0) return { dx: 0, dy: 0, dz: 0 };

  let rawX: number;
  let rawY: number;
  let rawZ: number;

  if (config.driver === 'simplex') {
    // Sample the SHARED noise field at positions based on shapeIndex.
    // All shapes share the same field → spatial coherence across the layout.
    // config.scale controls the "correlation distance": smaller scale = more gradual transitions.
    const t = shapeIndex * config.scale;
    rawX = computeOctaveNoise(GLOBAL_NOISE_X, t, 0, config.octaves, config.lacunarity, config.gain);
    rawY = computeOctaveNoise(GLOBAL_NOISE_Y, 0, t, config.octaves, config.lacunarity, config.gain);
    rawZ = computeOctaveNoise(GLOBAL_NOISE_Z, t, t, config.octaves, config.lacunarity, config.gain);
  } else {
    // Deterministic random seeded per shape — each shape is independent
    const rand = mulberry32(hashString(shapeId));
    rawX = (rand() * 2) - 1;
    rawY = (rand() * 2) - 1;
    rawZ = (rand() * 2) - 1;
  }

  // Apply bias: shifts the center of the displacement distribution
  let dx = rawX + config.biasX;
  let dy = rawY + config.biasY;
  let dz = rawZ + config.biasZ;

  // Apply positive-only clamping
  if (config.positiveOnly) {
    dx = Math.abs(dx);
    dy = Math.abs(dy);
    dz = Math.abs(dz);
  }

  // Apply reverse
  if (config.reverse) {
    dx = -dx;
    dy = -dy;
    dz = -dz;
  }

  // Scale X/Y to pixel amount; Z to degrees (max ±15° per unit)
  dx *= config.amount;
  dy *= config.amount;
  dz *= 15;

  return { dx, dy, dz };
}

/**
 * Resample a path by density: ensures no edge is longer than 1/density units.
 * Returns new array with linearly interpolated intermediate points.
 */
export function resamplePathByDensity(
  points: { x: number; y: number }[],
  density: number
): { x: number; y: number }[] {
  if (points.length < 2 || density <= 0) return points;

  const result: { x: number; y: number }[] = [];
  const n = points.length;
  const maxSegLen = 1 / density;

  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    result.push(a);

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const edgeLen = Math.hypot(dx, dy);

    if (edgeLen > maxSegLen) {
      const subCount = Math.ceil(edgeLen / maxSegLen);
      for (let j = 1; j < subCount; j++) {
        const t = j / subCount;
        result.push({ x: a.x + dx * t, y: a.y + dy * t });
      }
    }
  }

  return result;
}

/**
 * Apply local jitter to a list of polygon points.
 * Returns a new array with displaced vertices.
 * shapeHash: a stable numeric seed derived from shape ID.
 *
 * Axes:
 *  X — world-space horizontal displacement
 *  Y — world-space vertical displacement
 *  Z — tangential displacement (along the boundary, perpendicular to the radial direction)
 */
export function applyLocalJitter(
  points: { x: number; y: number }[],
  config: LocalJitterConfig,
  shapeHash: number
): { x: number; y: number }[] {
  if (!config.enabled || points.length === 0) return points;

  // Resample first if enabled
  let pts = config.resampleEnabled
    ? resamplePathByDensity(points, config.resampleDensity)
    : points;

  if (!config.enabledX && !config.enabledY && !config.enabledZ) return pts;

  const n = pts.length;

  // Build noise2D seeded per shape for consistent frames
  const noise2D = config.driver === 'simplex' ? makeNoise2D(shapeHash) : null;

  return pts.map((pt, vi) => {
    let dispX = 0;
    let dispY = 0;

    if (config.enabledX) {
      let rawX: number;
      if (config.driver === 'simplex' && noise2D) {
        rawX = computeOctaveNoise(
          noise2D,
          pt.x * config.scale,
          pt.y * config.scale,
          config.octaves,
          config.lacunarity,
          config.gain
        );
      } else {
        const vrand = mulberry32((shapeHash + vi * 2654435761) >>> 0);
        rawX = (vrand() * 2) - 1;
      }

      if (config.modeX === 'from-center') {
        const dist = Math.hypot(pt.x, pt.y);
        const dirX = dist > 0 ? pt.x / dist : 0;
        rawX = rawX * dirX;
      }

      if (config.positiveOnlyX) rawX = Math.abs(rawX);
      if (config.reverseX) rawX = -rawX;
      dispX = rawX * config.amountX;
    }

    if (config.enabledY) {
      let rawY: number;
      if (config.driver === 'simplex' && noise2D) {
        rawY = computeOctaveNoise(
          noise2D,
          pt.y * config.scale,
          pt.x * config.scale,
          config.octaves,
          config.lacunarity,
          config.gain
        );
      } else {
        const vrand = mulberry32((shapeHash + vi * 2654435761 + 1) >>> 0);
        rawY = (vrand() * 2) - 1;
      }

      if (config.modeY === 'from-center') {
        const dist = Math.hypot(pt.x, pt.y);
        const dirY = dist > 0 ? pt.y / dist : 0;
        rawY = rawY * dirY;
      }

      if (config.positiveOnlyY) rawY = Math.abs(rawY);
      if (config.reverseY) rawY = -rawY;
      dispY = rawY * config.amountY;
    }

    // Z axis: tangential displacement (along the boundary of the shape)
    if (config.enabledZ && n >= 2) {
      const next = pts[(vi + 1) % n];
      const prev = pts[(vi - 1 + n) % n];
      // Compute tangent direction as average of (next-pt) and (pt-prev)
      const tdx = (next.x - prev.x);
      const tdy = (next.y - prev.y);
      const tLen = Math.hypot(tdx, tdy);
      if (tLen > 0) {
        const tx = tdx / tLen;
        const ty = tdy / tLen;

        let rawZ: number;
        if (config.driver === 'simplex' && noise2D) {
          rawZ = computeOctaveNoise(
            noise2D,
            pt.x * config.scale + 100,
            pt.y * config.scale + 100,
            config.octaves,
            config.lacunarity,
            config.gain
          );
        } else {
          const vrand = mulberry32((shapeHash + vi * 2654435761 + 2) >>> 0);
          rawZ = (vrand() * 2) - 1;
        }

        if (config.positiveOnlyZ) rawZ = Math.abs(rawZ);
        if (config.reverseZ) rawZ = -rawZ;

        dispX += tx * rawZ * config.amountZ;
        dispY += ty * rawZ * config.amountZ;
      }
    }

    return { x: pt.x + dispX, y: pt.y + dispY };
  });
}

/**
 * Compute a stable hash from a shape ID string.
 */
export function shapeIdToHash(id: string): number {
  return hashString(id);
}

/**
 * Extract LocalJitterConfig from BatchConfigSettings (or any object with roughness fields).
 * Provides safe defaults for all fields.
 */
export function extractLocalJitterConfig(settings: any): LocalJitterConfig {
  return {
    enabled: settings.localJitterEnabled ?? false,
    enabledX: settings.localJitterEnabledX ?? true,
    enabledY: settings.localJitterEnabledY ?? true,
    enabledZ: settings.localJitterEnabledZ ?? false,
    modeX: settings.localJitterModeX ?? 'axial',
    modeY: settings.localJitterModeY ?? 'axial',
    amountX: settings.localJitterAmountX ?? 10,
    amountY: settings.localJitterAmountY ?? 10,
    amountZ: settings.localJitterAmountZ ?? 10,
    positiveOnlyX: settings.localJitterPositiveOnlyX ?? false,
    positiveOnlyY: settings.localJitterPositiveOnlyY ?? false,
    positiveOnlyZ: settings.localJitterPositiveOnlyZ ?? false,
    reverseX: settings.localJitterReverseX ?? false,
    reverseY: settings.localJitterReverseY ?? false,
    reverseZ: settings.localJitterReverseZ ?? false,
    driver: settings.jitterDriver ?? 'random',
    scale: settings.jitterScale ?? 0.05,
    octaves: settings.jitterOctaves ?? 3,
    lacunarity: settings.jitterLacunarity ?? 2.0,
    gain: settings.jitterGain ?? 0.5,
    resampleEnabled: settings.jitterResampleEnabled ?? false,
    resampleDensity: settings.jitterResampleDensity ?? 0.1,
  };
}

/**
 * Extract GlobalJitterConfig from BatchConfigSettings.
 */
export function extractGlobalJitterConfig(settings: any): GlobalJitterConfig {
  return {
    enabled: settings.globalJitterEnabled ?? false,
    amount: settings.globalJitterAmount ?? 20,
    biasX: settings.globalJitterBiasX ?? 0,
    biasY: settings.globalJitterBiasY ?? 0,
    biasZ: settings.globalJitterBiasZ ?? 0,
    positiveOnly: settings.globalJitterPositiveOnly ?? false,
    reverse: settings.globalJitterReverse ?? false,
    driver: settings.jitterDriver ?? 'random',
    scale: settings.jitterScale ?? 0.05,
    octaves: settings.jitterOctaves ?? 3,
    lacunarity: settings.jitterLacunarity ?? 2.0,
    gain: settings.jitterGain ?? 0.5,
  };
}
