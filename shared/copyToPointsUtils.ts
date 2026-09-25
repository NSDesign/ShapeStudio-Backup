/**
 * Shared utilities for Copy-to-Points distribution layout.
 * Used by both client (useShapeEditor.ts) and server (batchConfigProcessor.ts).
 *
 * Per-property influence pipeline (per placed shape, per enabled PointPropertyConfig):
 *  1. targetVal = evaluate mode:
 *       fixed       → fixedValue constant
 *       random-range → Math.random() between rangeMin and rangeMax (index-agnostic)
 *       range        → rangeSubMode='point-index': lerp(min, max, pointIndex/total); others TBD
 *       incremental → (incrementalStart + incrementalStep × pointIndex) mod incrementalWrap
 *  2. if remapEnabled: targetVal = remap(targetVal, remapFrom → remapTo)
 *  3. blendedVal = blend(srcVal, targetVal, blendMode)
 *  4. amount = amountMode==='fixed' ? amountFixed : rand(amountRangeMin, amountRangeMax)
 *  5. finalVal = lerp(srcVal, blendedVal, amount)
 *  6. write finalVal → cloned shape property
 *
 * Position Cartesian/Polar sub-mode (positionSubMode — applies when key is posX or posY):
 *  cartesian — influences X and Y directly as canvas coordinates
 *  polar     — posX drives angle (°), posY drives radius from (0,0);
 *              get/set convert between polar and cartesian automatically
 */

import {
  CopyToPointsConfig,
  DEFAULT_COPY_TO_POINTS_CONFIG,
  CopyToPointsTargetConfig,
  DEFAULT_CTP_TARGET_CONFIG,
  PointPropertyConfig,
  PointPropertyKey,
  PointPropertyBlendMode,
} from './schema';

export interface HarvestedPoint {
  x: number;
  y: number;
  /** Index of this point within its source destination shape (0-based) */
  shapeLocalIndex: number;
  /** Total points harvested from the same source destination shape */
  shapeLocalTotal: number;
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

function resamplePolyline(
  pts: Array<{ x: number; y: number }>,
  count: number,
  closed = false
): Array<{ x: number; y: number }> {
  if (pts.length === 0 || count < 1) return [];
  if (pts.length === 1) return Array(count).fill({ x: pts[0].x, y: pts[0].y });

  const arc: number[] = [0];
  const loop = closed ? [...pts, pts[0]] : pts;
  for (let i = 1; i < loop.length; i++) {
    arc.push(arc[i - 1] + dist(loop[i - 1].x, loop[i - 1].y, loop[i].x, loop[i].y));
  }
  const totalLen = arc[arc.length - 1];
  if (totalLen === 0) return Array(count).fill({ x: pts[0].x, y: pts[0].y });

  const result: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < count; k++) {
    const target = (k / count) * totalLen;
    let lo = 0;
    let hi = arc.length - 2;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arc[mid + 1] < target) lo = mid + 1;
      else hi = mid;
    }
    const segLen = arc[lo + 1] - arc[lo];
    const t = segLen === 0 ? 0 : (target - arc[lo]) / segLen;
    result.push({
      x: loop[lo].x + t * (loop[lo + 1].x - loop[lo].x),
      y: loop[lo].y + t * (loop[lo + 1].y - loop[lo].y)
    });
  }
  return result;
}

/**
 * Transform a local-space point to world space:
 * scale → rotate → translate (shape centroid).
 */
function transformLocalPoint(lx: number, ly: number, shape: any): { x: number; y: number } {
  const cx = shape.transform?.x ?? 0;
  const cy = shape.transform?.y ?? 0;
  const sx = shape.transform?.scaleX ?? 1;
  const sy = shape.transform?.scaleY ?? 1;
  const rot = ((shape.transform?.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const wx = lx * sx;
  const wy = ly * sy;
  return { x: cx + wx * cos - wy * sin, y: cy + wx * sin + wy * cos };
}

/** Bounding-box polygon in world space for shapes without an explicit points array. */
function bboxPolygonWorld(shape: any): Array<{ x: number; y: number }> {
  const cx: number = shape.transform?.x ?? 0;
  const cy: number = shape.transform?.y ?? 0;
  const w: number = shape.width ?? (shape.radius != null ? shape.radius * 2 : 50);
  const h: number = shape.height ?? (shape.radius != null ? shape.radius * 2 : 50);
  const sx = shape.transform?.scaleX ?? 1;
  const sy = shape.transform?.scaleY ?? 1;
  const hw = (w * sx) / 2;
  const hh = (h * sy) / 2;
  const rot = ((shape.transform?.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return [
    { lx: -hw, ly: -hh }, { lx: hw, ly: -hh },
    { lx:  hw, ly:  hh }, { lx: -hw, ly:  hh },
  ].map(({ lx, ly }) => ({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos }));
}

// ── Point harvesting ──────────────────────────────────────────────────────────

export function harvestShapePoints(
  shape: any,
  config: Pick<
    CopyToPointsTargetConfig,
    'includeVertices' | 'includeCentroid' | 'vertexSampleStride' | 'resampleOutline' | 'resampleCount'
  >
): HarvestedPoint[] {
  const raw: Array<{ x: number; y: number }> = [];
  const cx: number = shape.transform?.x ?? 0;
  const cy: number = shape.transform?.y ?? 0;

  if (config.resampleOutline) {
    const count = Math.max(2, Math.round(config.resampleCount));
    const stride = Math.max(1, Math.round(config.vertexSampleStride));
    const polyPts = (shape.points && shape.points.length > 1)
      ? shape.points.map((p: any) => transformLocalPoint(p.x ?? 0, p.y ?? 0, shape))
      : bboxPolygonWorld(shape);
    const resampled = resamplePolyline(polyPts, count, true);
    for (let i = 0; i < resampled.length; i += stride) {
      raw.push({ x: resampled[i].x, y: resampled[i].y });
    }
  } else {
    if (config.includeCentroid) {
      raw.push({ x: cx, y: cy });
    }
    if (config.includeVertices) {
      const stride = Math.max(1, Math.round(config.vertexSampleStride));
      if (shape.points && shape.points.length > 0) {
        for (let i = 0; i < shape.points.length; i += stride) {
          const wp = transformLocalPoint(shape.points[i].x ?? 0, shape.points[i].y ?? 0, shape);
          raw.push({ x: wp.x, y: wp.y });
        }
      } else {
        const bbox = bboxPolygonWorld(shape);
        for (let i = 0; i < bbox.length; i += stride) {
          raw.push({ x: bbox[i].x, y: bbox[i].y });
        }
      }
    }
  }

  // Annotate each point with its local index within this shape
  return raw.map((pt, i) => ({
    ...pt,
    shapeLocalIndex: i,
    shapeLocalTotal: raw.length,
  }));
}

export function harvestDestinationPoints(
  destShapes: any[],
  config: Pick<
    CopyToPointsTargetConfig,
    'includeVertices' | 'includeCentroid' | 'vertexSampleStride' | 'resampleOutline' | 'resampleCount'
  >
): HarvestedPoint[] {
  const all: HarvestedPoint[] = [];
  for (const shape of destShapes) all.push(...harvestShapePoints(shape, config));
  return all;
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.trim().replace(/^#/, '');
  if (h.length === 6)
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
  if (h.length === 3)
    return { r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16) };
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');
  return '#' + c(r) + c(g) + c(b);
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

// ── Per-property value access (aware of positionSubMode) ─────────────────────

/**
 * Read a property value from `shape`.
 * When key is posX/posY and positionSubMode is 'polar', returns polar coordinates instead:
 *   posX → angle in degrees (atan2(y, x))
 *   posY → radius (sqrt(x²+y²))
 */
export function getPropertyValue(shape: any, key: PointPropertyKey, prop?: PointPropertyConfig): number {
  const polar = prop && (key === 'posX' || key === 'posY') && prop.positionSubMode === 'polar';
  if (polar) {
    const px = shape.transform?.x ?? 0;
    const py = shape.transform?.y ?? 0;
    if (key === 'posX') return (Math.atan2(py, px) * 180) / Math.PI;
    if (key === 'posY') return Math.sqrt(px * px + py * py);
  }
  switch (key) {
    case 'posX':         return shape.transform?.x ?? 0;
    case 'posY':         return shape.transform?.y ?? 0;
    case 'scaleX':       return shape.transform?.scaleX ?? 1;
    case 'scaleY':       return shape.transform?.scaleY ?? 1;
    case 'uniformScale': return 1;
    case 'skewX':        return shape.transform?.skewX ?? 0;
    case 'skewY':        return shape.transform?.skewY ?? 0;
    case 'rotation':     return shape.transform?.rotation ?? 0;
    case 'fillOpacity':  return (shape.properties?.fillOpacity ?? 1) * 100;
    case 'fillR': { const rgb = hexToRgb(shape.properties?.fillColor ?? '#808080'); return rgb ? rgb.r : 128; }
    case 'fillG': { const rgb = hexToRgb(shape.properties?.fillColor ?? '#808080'); return rgb ? rgb.g : 128; }
    case 'fillB': { const rgb = hexToRgb(shape.properties?.fillColor ?? '#808080'); return rgb ? rgb.b : 128; }
    default:             return 0;
  }
}

/**
 * Write a property value to `shape`.
 * When key is posX/posY and positionSubMode is 'polar', interprets the value as polar
 * and converts back to cartesian (keeping the other axis coordinate unchanged):
 *   posX → angle (°): recompute x = cos(angle)*radius, y = sin(angle)*radius
 *   posY → radius:    recompute x = cos(angle)*radius, y = sin(angle)*radius
 */
function setPropertyValue(shape: any, key: PointPropertyKey, value: number, prop?: PointPropertyConfig): void {
  const c01  = (v: number) => Math.max(0, Math.min(1,   v));
  const c255 = (v: number) => Math.max(0, Math.min(255, v));
  if (!shape.transform)  shape.transform  = {};
  if (!shape.properties) shape.properties = {};

  const polar = prop && (key === 'posX' || key === 'posY') && prop.positionSubMode === 'polar';
  if (polar) {
    const px = shape.transform.x ?? 0;
    const py = shape.transform.y ?? 0;
    const currentAngle = Math.atan2(py, px);
    const currentRadius = Math.sqrt(px * px + py * py);
    if (key === 'posX') {
      // value is new angle in degrees
      const angleRad = (value * Math.PI) / 180;
      shape.transform.x = Math.cos(angleRad) * currentRadius;
      shape.transform.y = Math.sin(angleRad) * currentRadius;
    } else {
      // value is new radius
      shape.transform.x = Math.cos(currentAngle) * value;
      shape.transform.y = Math.sin(currentAngle) * value;
    }
    return;
  }

  switch (key) {
    case 'posX':         shape.transform.x        = value; break;
    case 'posY':         shape.transform.y        = value; break;
    case 'scaleX':       shape.transform.scaleX   = Math.max(0, value); break;
    case 'scaleY':       shape.transform.scaleY   = Math.max(0, value); break;
    case 'uniformScale': {
                         const sx = shape.transform.scaleX ?? 1;
                         const sy = shape.transform.scaleY ?? 1;
                         shape.transform.scaleX = Math.max(0, sx * value);
                         shape.transform.scaleY = Math.max(0, sy * value);
                         break; }
    case 'skewX':        shape.transform.skewX    = value; break;
    case 'skewY':        shape.transform.skewY    = value; break;
    case 'rotation':     shape.transform.rotation = value; break;
    case 'fillOpacity':  shape.properties.fillOpacity = c01(value / 100); break;
    case 'fillR': {
      const rgb = hexToRgb(shape.properties.fillColor ?? '#808080') ?? { r:128, g:128, b:128 };
      shape.properties.fillColor = rgbToHex(c255(value), rgb.g, rgb.b); break;
    }
    case 'fillG': {
      const rgb = hexToRgb(shape.properties.fillColor ?? '#808080') ?? { r:128, g:128, b:128 };
      shape.properties.fillColor = rgbToHex(rgb.r, c255(value), rgb.b); break;
    }
    case 'fillB': {
      const rgb = hexToRgb(shape.properties.fillColor ?? '#808080') ?? { r:128, g:128, b:128 };
      shape.properties.fillColor = rgbToHex(rgb.r, rgb.g, c255(value)); break;
    }
  }
}

// ── Blending + remap ──────────────────────────────────────────────────────────

function remapValue(val: number, from: [number, number], to: [number, number]): number {
  if (from[0] === from[1]) return to[0];
  const t = Math.max(0, Math.min(1, (val - from[0]) / (from[1] - from[0])));
  return lerp(to[0], to[1], t);
}

function multiplyNorm(key: PointPropertyKey): number {
  return (key === 'fillR' || key === 'fillG' || key === 'fillB') ? 255 : 1;
}

function blendValue(src: number, dst: number, mode: PointPropertyBlendMode, key: PointPropertyKey): number {
  switch (mode) {
    case 'normal':   return dst;
    case 'multiply': return (src * dst) / multiplyNorm(key);
    case 'add':      return src + dst;
    case 'subtract': return src - dst;
    case 'divide':   return dst === 0 ? src : src / dst;
    default:         return dst;
  }
}

/**
 * Neutral "source" property value for each key — used as the blending baseline
 * when computing CTP point labels without access to actual source shapes.
 * Matches the default/identity value each property starts at before any influence.
 * (fillOpacity is stored internally as 0-100, matching getPropertyValue.)
 */
const CTP_NEUTRAL_SRC: Partial<Record<PointPropertyKey, number>> = {
  posX: 0, posY: 0,
  scaleX: 1, scaleY: 1, uniformScale: 1,
  skewX: 0, skewY: 0,
  rotation: 0,
  fillOpacity: 100,
  fillR: 128, fillG: 128, fillB: 128,
};

/**
 * Compute the final property value that a CTP influence would produce at a given
 * destination point, running the complete 5-step applyInfluence pipeline.
 *
 * `srcVal` should be the actual source shape's property value read via
 * `getPropertyValue(srcShape, prop.key, prop)`. Callers that cannot identify
 * the source shape (e.g. no source set found) may pass `undefined`, in which
 * case the property-key neutral default (identity value before any influence)
 * is used as a fallback.
 *
 * For `random-range` mode and `amountMode='range'` the midpoint of the
 * respective range is substituted because non-deterministic draws cannot be
 * represented as a static label; callers should mark those labels with "~".
 *
 * Exported so Canvas.tsx can call this without duplicating the pipeline logic.
 */
export function computeCtpLabelVal(
  prop: PointPropertyConfig,
  pointIndex: number,
  total: number,
  srcVal?: number,
): number {
  // Step 1: evaluate targetVal
  let targetVal: number;
  switch (prop.mode) {
    case 'fixed':
      targetVal = prop.fixedValue;
      break;
    case 'random-range':
      // Non-deterministic — use midpoint as representative label value
      targetVal = (prop.rangeMin + prop.rangeMax) / 2;
      break;
    case 'range':
      targetVal = prop.rangeMin + (prop.rangeMax - prop.rangeMin) * (pointIndex / Math.max(total - 1, 1));
      break;
    case 'incremental':
    default: {
      let offset = prop.incrementalStep * pointIndex;
      if (prop.incrementalWrap > 0)
        offset = ((offset % prop.incrementalWrap) + prop.incrementalWrap) % prop.incrementalWrap;
      targetVal = prop.incrementalStart + offset;
      break;
    }
  }

  // Step 2: optional remap
  if (prop.remapEnabled) {
    targetVal = remapValue(targetVal, prop.remapFrom, prop.remapTo);
  }

  // Step 3: blend with source value (actual or neutral fallback)
  const resolvedSrc = srcVal ?? (CTP_NEUTRAL_SRC[prop.key] ?? 0);
  const blendedVal = blendValue(resolvedSrc, targetVal, prop.blendMode, prop.key);

  // Step 4: resolve amount (use range midpoint for amount-range mode)
  let amount: number;
  if (prop.amountMode === 'range') {
    amount = (prop.amountRangeMin + prop.amountRangeMax) / 2;
  } else {
    amount = prop.amountFixed;
  }
  amount = Math.max(0, Math.min(1, amount));

  // Step 5: lerp between resolvedSrc and blendedVal
  return resolvedSrc + (blendedVal - resolvedSrc) * amount;
}

// ── Clone helper ──────────────────────────────────────────────────────────────

function cloneShape(srcShape: any, suffix: string): any {
  const cloned: any = typeof srcShape.clone === 'function'
    ? srcShape.clone()
    : JSON.parse(JSON.stringify(srcShape));
  cloned.id = `ctp_${Date.now()}_${suffix}_${Math.random().toString(36).substr(2,6)}`;
  return cloned;
}

// ── Per-property influence pipeline ──────────────────────────────────────────

/**
 * Build a per-property random-value cache for `random-range` mode.
 * Each map is keyed by the effective point index (global or local per `evaluatePoints`).
 * Random values are sampled once per unique index so every shape placed at the
 * same effective point receives the same draw — consistent with how `range` and
 * `incremental` modes work.
 *
 * Returns one Map per property (parallel to `props`); empty Map for non-random-range props.
 */
function buildRandomTargetCache(
  props: ReadonlyArray<PointPropertyConfig>,
  harvestedPoints: HarvestedPoint[],
): Map<number, number>[] {
  return props.map(prop => {
    const cache = new Map<number, number>();
    if (!prop.enabled || prop.mode !== 'random-range') return cache;
    const useLocal = (prop.evaluatePoints ?? 'all-points') === 'points-per-shape';
    harvestedPoints.forEach((pt, ptIdx) => {
      const key = useLocal ? pt.shapeLocalIndex : ptIdx;
      if (!cache.has(key)) {
        cache.set(key, prop.rangeMin + Math.random() * (prop.rangeMax - prop.rangeMin));
      }
    });
    return cache;
  });
}

/**
 * Apply the full per-property influence pipeline to `cloned`.
 *
 * @param cloned            - The placed (cloned) shape to mutate
 * @param targetConfig      - CopyToPointsTargetConfig (pointProperties array)
 * @param globalIndex       - Zero-based placement index across all destination points
 * @param globalTotal       - Total placements across all destination points
 * @param localIndex        - Index of this point within its source destination shape
 * @param localTotal        - Total points from this source destination shape
 * @param randomTargetCache - Pre-sampled random values per property for random-range mode.
 *                            Built by buildRandomTargetCache(); keyed by global or local
 *                            index per prop.evaluatePoints.
 */
function applyInfluence(
  cloned: any,
  targetConfig: Pick<CopyToPointsTargetConfig, 'pointProperties'>,
  globalIndex: number,
  globalTotal: number,
  localIndex: number,
  localTotal: number,
  randomTargetCache?: Map<number, number>[],
): void {
  if (!targetConfig.pointProperties || targetConfig.pointProperties.length === 0) return;

  targetConfig.pointProperties.forEach((prop: PointPropertyConfig, propIdx: number) => {
    if (!prop.enabled) return;

    // Each property picks its own index system based on its evaluatePoints setting
    const useLocal = (prop.evaluatePoints ?? 'all-points') === 'points-per-shape';
    const pointIndex = useLocal ? localIndex : globalIndex;

    // 1. Evaluate target value
    const totalForLerp = useLocal ? localTotal : globalTotal;
    let targetVal: number;
    switch (prop.mode) {
      case 'fixed':
        targetVal = prop.fixedValue;
        break;
      case 'random-range': {
        // Use pre-sampled cache (keyed by global or local index per evaluatePoints)
        // so all shapes at the same effective point share one random draw.
        const cacheKey = useLocal ? localIndex : globalIndex;
        const cached = randomTargetCache?.[propIdx]?.get(cacheKey);
        targetVal = cached !== undefined
          ? cached
          : prop.rangeMin + Math.random() * (prop.rangeMax - prop.rangeMin);
        break;
      }
      case 'range':
        // Deterministic linear sweep: min→max across the point sequence
        targetVal = prop.rangeMin + (prop.rangeMax - prop.rangeMin) * (pointIndex / Math.max(totalForLerp - 1, 1));
        break;
      case 'incremental':
      default: {
        // Wrap the offset (step × index) only, then add start.
        // This ensures the cycle always returns to incrementalStart, not to 0.
        let offset = prop.incrementalStep * pointIndex;
        if (prop.incrementalWrap > 0) {
          offset = ((offset % prop.incrementalWrap) + prop.incrementalWrap) % prop.incrementalWrap;
        }
        targetVal = prop.incrementalStart + offset;
        break;
      }
    }

    // 2. Optional remap
    if (prop.remapEnabled) {
      targetVal = remapValue(targetVal, prop.remapFrom, prop.remapTo);
    }

    // 3. Read source value and blend
    const srcVal = getPropertyValue(cloned, prop.key, prop);
    const blendedVal = blendValue(srcVal, targetVal, prop.blendMode, prop.key);

    // 4. Resolve amount
    let amount: number;
    if (prop.amountMode === 'range') {
      amount = prop.amountRangeMin + Math.random() * (prop.amountRangeMax - prop.amountRangeMin);
    } else {
      amount = prop.amountFixed;
    }
    amount = Math.max(0, Math.min(1, amount));

    // 5. Lerp and write
    setPropertyValue(cloned, prop.key, lerp(srcVal, blendedVal, amount), prop);
  });
}

// ── Core distribution ─────────────────────────────────────────────────────────

export function applyCopyToPointsDistribution(
  sourceShapes: any[],
  harvestedPoints: HarvestedPoint[],
  sourceConfigPartial: Partial<CopyToPointsConfig>,
  targetConfigPartial: Partial<CopyToPointsTargetConfig> = {}
): any[] {
  const config: CopyToPointsConfig = { ...DEFAULT_COPY_TO_POINTS_CONFIG, ...sourceConfigPartial };
  const tConfig: CopyToPointsTargetConfig = { ...DEFAULT_CTP_TARGET_CONFIG, ...targetConfigPartial };
  if (harvestedPoints.length === 0 || sourceShapes.length === 0) return [];

  const output: any[] = [];
  const totalPoints = harvestedPoints.length;

  // Pre-sample random values for random-range properties once per effective point index
  // so all shapes at the same point receive the same draw (respects evaluatePoints).
  const randomTargetCache = buildRandomTargetCache(tConfig.pointProperties ?? [], harvestedPoints);

  // ── set-copy mode: full source set placed at every destination point → N×M total ──
  if (config.copyMode === 'set-copy') {
    const poolCX = sourceShapes.reduce((s, sh) => s + (sh.transform?.x ?? 0), 0) / sourceShapes.length;
    const poolCY = sourceShapes.reduce((s, sh) => s + (sh.transform?.y ?? 0), 0) / sourceShapes.length;

    const hasRotationProp = (tConfig.pointProperties ?? []).some(p => p.key === 'rotation' && p.enabled);

    harvestedPoints.forEach((pt, ptIdx) => {
      sourceShapes.forEach((srcShape, shIdx) => {
        const cloned = cloneShape(srcShape, `${ptIdx}_${shIdx}`);
        const offsetX = (srcShape.transform?.x ?? 0) - poolCX;
        const offsetY = (srcShape.transform?.y ?? 0) - poolCY;
        // Apply influence BEFORE positioning so the resolved rotation value is available.
        // All source shapes placed at the same destination point share the same index —
        // ptIdx drives the step so every shape in the set gets the same property value at that point.
        applyInfluence(cloned, tConfig, ptIdx, totalPoints, pt.shapeLocalIndex, pt.shapeLocalTotal, randomTargetCache);
        // Position the clone: when a rotation property is active, rotate the cluster offset
        // around the destination point so the entire set instance visually rotates as a group.
        if (hasRotationProp) {
          const rotRad = (cloned.transform.rotation ?? 0) * Math.PI / 180;
          cloned.transform.x = pt.x + offsetX * Math.cos(rotRad) - offsetY * Math.sin(rotRad);
          cloned.transform.y = pt.y + offsetX * Math.sin(rotRad) + offsetY * Math.cos(rotRad);
        } else {
          cloned.transform.x = pt.x + offsetX;
          cloned.transform.y = pt.y + offsetY;
        }
        output.push(cloned);
      });
    });
    return output;
  }

  // ── shape-copy: build pairs ───────────────────────────────────────────────
  let pairs: Array<{ ptIdx: number; srcIdx: number }>;
  if (config.overflowMode === 'clamp') {
    const limit = Math.min(totalPoints, sourceShapes.length);
    pairs = Array.from({ length: limit }, (_, i) => ({ ptIdx: i, srcIdx: i }));
  } else if (config.overflowMode === 'distribute-evenly') {
    pairs = harvestedPoints.map((_, i) => ({
      ptIdx: i,
      srcIdx: sourceShapes.length === 1
        ? 0
        : Math.round((i / (totalPoints - 1 || 1)) * (sourceShapes.length - 1))
    }));
  } else {
    // 'wrap' (default)
    pairs = harvestedPoints.map((_, i) => ({ ptIdx: i, srcIdx: i % sourceShapes.length }));
  }

  pairs.forEach(({ ptIdx, srcIdx }) => {
    const pt = harvestedPoints[ptIdx];
    const cloned = cloneShape(sourceShapes[srcIdx], `${ptIdx}`);
    cloned.transform.x = pt.x;
    cloned.transform.y = pt.y;
    // Pass both global (ptIdx) and local (shapeLocalIndex) — each property picks via evaluatePoints
    applyInfluence(cloned, tConfig, ptIdx, totalPoints, pt.shapeLocalIndex, pt.shapeLocalTotal, randomTargetCache);
    output.push(cloned);
  });

  return output;
}
