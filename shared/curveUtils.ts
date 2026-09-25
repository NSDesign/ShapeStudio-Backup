// Shared curve pattern math used by both the client (`client/src/lib/shapes.ts`)
// and the server (`server/lib/shapeGenerator.ts`) so that batch / high-resolution
// / tiled server exports generate the exact same curve geometry as the live
// client preview. Keep this file as the single source of truth for curve pattern
// layout and stroke-cap selection so the two sides never drift again.

export interface CurvePoint {
  x: number;
  y: number;
}

export interface CurvePatternControls {
  waveHeight?: number;
  waveFrequency?: number;
  wavePhase?: number;
  spiralTurns?: number;
  spiralTightness?: number;
  arcSweep?: number;
  organicJitter?: number;
  // --- Directional jitter controls -------------------------------------------
  // "Away from curve": when true, the Point Jitter magnitude displaces each
  // anchor point along its curve normal (perpendicular to the local direction
  // of travel) instead of the pattern's native random axis. This is the
  // "inflate / deflate the curve" behaviour.
  jitterAlongNormal?: boolean;
  // Sign of the jitter. 'both' (default) = random ± (the historical behaviour);
  // 'outward' = one-sided positive (push away from the curve / grow radius);
  // 'inward' = one-sided negative (pull toward the curve / shrink radius).
  // When jitterAlongNormal is false AND jitterDirection is 'both', point layout
  // is identical to the original generator.
  jitterDirection?: 'both' | 'outward' | 'inward';
}

/**
 * Shared curve pattern point generator used by Cubic, Bezier and Smooth Spline.
 * Lays out anchor points for the selected pattern (Spiral / Wave / Organic / Arc),
 * scaled by `spread` (overall size) with `curvature` controlling random wobble.
 * Per-pattern artistic controls (wave height/frequency/phase, spiral turns/tightness,
 * arc sweep, organic jitter) are read from `controls` with safe fallbacks so older
 * saved data keeps its previous look.
 */
export function generateCurvePatternPoints(
  pointCount: number,
  spread: number,
  curvature: number,
  patternType: number,
  controls: CurvePatternControls = {}
): CurvePoint[] {
  const points: CurvePoint[] = [];
  const count = Math.max(2, Math.round(pointCount));
  const alongNormal = controls.jitterAlongNormal ?? false;
  const direction = controls.jitterDirection ?? 'both';

  // Native-axis random term. Replaces the historical `(Math.random() - 0.5)`
  // (range [-0.5, 0.5]). When direction is 'both' this is byte-for-byte the old
  // behaviour; 'outward'/'inward' bias the jitter to one side only while keeping
  // the same magnitude scale.
  const nativeRand = (): number => {
    if (direction === 'outward') return Math.random() * 0.5; // [0, 0.5]
    if (direction === 'inward') return -Math.random() * 0.5; // [-0.5, 0]
    return Math.random() - 0.5; // [-0.5, 0.5]
  };

  // "Away from curve" mode: lay down the deterministic base of the pattern, then
  // displace each point along its curve normal by the Point Jitter magnitude.
  // 'both' = random ± wobble across the line; 'outward'/'inward' = one-sided
  // inflate / deflate. When direction is 'both' the spread of magnitudes matches
  // the historical perpendicular wobble feel (full factor in [-1, 1]).
  if (alongNormal) {
    const fullFactor = (): number => {
      if (direction === 'outward') return Math.random(); // [0, 1]
      if (direction === 'inward') return -Math.random(); // [-1, 0]
      return (Math.random() - 0.5) * 2; // [-1, 1]
    };

    const base: CurvePoint[] = [];
    switch (patternType) {
      case 0: { // Spiral
        const turns = controls.spiralTurns ?? 2.5;
        const tightness = controls.spiralTightness ?? 1;
        for (let i = 0; i < count; i++) {
          const t = i / (count - 1);
          const angle = t * Math.PI * 2 * turns;
          const radius = Math.pow(t, tightness) * spread;
          base.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
        }
        break;
      }
      case 1: { // Wave
        const width = spread * 1.5;
        const height = controls.waveHeight ?? spread * 0.6;
        const frequency = controls.waveFrequency ?? 1;
        const phaseRad = ((controls.wavePhase ?? 0) * Math.PI) / 180;
        for (let i = 0; i < count; i++) {
          // Sample segment centres ((i+0.5)/count) instead of i/(count-1). The
          // latter forces the first and last points onto t=0 and t=1 — the SAME
          // phase for an integer frequency — and for low point counts (e.g. 3
          // points at frequency 1: t=0,0.5,1) every sample lands on a sine
          // zero-crossing, collapsing the wave to a flat row. Segment-centre
          // sampling spreads points across the period so the wave is visible at
          // any point count and closed waves don't get coincident endpoints.
          const t = (i + 0.5) / count;
          const x = (t - 0.5) * width;
          const y = Math.sin(t * Math.PI * 2 * frequency + phaseRad) * height;
          base.push({ x, y });
        }
        break;
      }
      case 3: { // Arc
        const radius = spread;
        const sweepRad = ((controls.arcSweep ?? 135) * Math.PI) / 180;
        const startAngle = Math.random() * Math.PI * 2;
        for (let i = 0; i < count; i++) {
          const t = i / (count - 1);
          const angle = startAngle + t * sweepRad;
          base.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
        }
        break;
      }
      case 2:
      default: { // Organic — smooth deterministic base arc
        for (let i = 0; i < count; i++) {
          const t = i / (count - 1);
          const angle = t * Math.PI * 1.8 - Math.PI * 0.9;
          const radius = spread * (0.55 + 0.45 * Math.sin(t * Math.PI));
          base.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
        }
        break;
      }
    }

    // Centroid of the base points. Used to give "outward"/"inward" a consistent
    // meaning regardless of how a pattern is parameterised (CW vs CCW): the
    // normal is oriented to point away from the centroid, so 'outward' always
    // grows the shape and 'inward' always shrinks it. For 'both' the sign is
    // random anyway, so orientation doesn't matter.
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < count; i++) {
      cx += base[i].x;
      cy += base[i].y;
    }
    cx /= count;
    cy /= count;
    const orient = direction !== 'both';

    // Displace each base point along its local normal. The normal is taken
    // perpendicular to the chord between the two neighbouring points so it
    // tracks the curve's direction of travel (endpoints use a one-sided chord).
    const mag = curvature * spread;
    for (let i = 0; i < count; i++) {
      const prev = base[Math.max(0, i - 1)];
      const next = base[Math.min(count - 1, i + 1)];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      let normX = -dy / len;
      let normY = dx / len;
      // Flip the normal so positive points away from the centroid (outward).
      if (orient && normX * (base[i].x - cx) + normY * (base[i].y - cy) < 0) {
        normX = -normX;
        normY = -normY;
      }
      const amount = fullFactor() * mag;
      points.push({ x: base[i].x + normX * amount, y: base[i].y + normY * amount });
    }
    return points;
  }

  switch (patternType) {
    case 0: { // Spiral
      const turns = controls.spiralTurns ?? 2.5;
      const tightness = controls.spiralTightness ?? 1;
      const maxRadius = spread;
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const angle = t * Math.PI * 2 * turns;
        // Jitter scales with maxRadius so curvature=0.15 → ±15% of spread
        const rawRadius =
          Math.pow(t, tightness) * maxRadius + nativeRand() * curvature * maxRadius;
        const radius = Math.max(0, rawRadius);
        points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      }
      break;
    }
    case 1: { // Wave
      const width = spread * 1.5;
      const height = controls.waveHeight ?? spread * 0.6;
      const frequency = controls.waveFrequency ?? 1;
      const phaseRad = ((controls.wavePhase ?? 0) * Math.PI) / 180;
      for (let i = 0; i < count; i++) {
        // Sample segment centres so the wave is visible at any point count — see
        // the matching note in the along-normal branch above. i/(count-1) makes
        // low point counts (3 pts @ freq 1) land on sine zero-crossings → flat row.
        const t = (i + 0.5) / count;
        const x = (t - 0.5) * width;
        const baseY = Math.sin(t * Math.PI * 2 * frequency + phaseRad) * height;
        // Jitter scales with spread (the overall footprint), NOT the wave height,
        // so point variation stays consistent with every other pattern (spiral/
        // arc/organic all scale jitter by spread/radius). Crucially this keeps a
        // wave from collapsing to a perfectly flat y=0 line when waveHeight is 0 —
        // curvature still produces wobble. spread*1.2 == the previous height*2 at
        // the default amplitude (spread*0.6), so normal waves are unchanged.
        const y = baseY + nativeRand() * curvature * spread * 1.2;
        points.push({ x, y });
      }
      break;
    }
    case 3: { // Arc
      const radius = spread;
      const sweepRad = ((controls.arcSweep ?? 135) * Math.PI) / 180;
      const startAngle = Math.random() * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const angle = startAngle + t * sweepRad;
        // Jitter scales with radius so curvature=0.15 → ±15% of arc radius
        const r = radius + nativeRand() * curvature * radius * 2;
        points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
      }
      break;
    }
    case 2:
    default: { // Organic scatter
      const jitter = controls.organicJitter ?? 1;
      // 1) Lay down a smooth base arc so points keep a clear order along the
      //    curve. A gently varying radius gives an organic bulge without the
      //    per-point random radius that previously let points jump and cross.
      const base: CurvePoint[] = [];
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const angle = t * Math.PI * 1.8 - Math.PI * 0.9;
        const radius = spread * (0.55 + 0.45 * Math.sin(t * Math.PI));
        base.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      }
      // 2) Wobble each point perpendicular to the local direction of travel,
      //    bounded by the spacing to its neighbours so adjacent points can
      //    never cross or reorder. Keeping the offset perpendicular means the
      //    derived tangent handles stay pointing along the curve (no cusps).
      for (let i = 0; i < count; i++) {
        const prev = base[Math.max(0, i - 1)];
        const next = base[Math.min(count - 1, i + 1)];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const perpX = -dy / len;
        const perpY = dx / len;
        const distPrev = Math.sqrt(
          Math.pow(base[i].x - prev.x, 2) + Math.pow(base[i].y - prev.y, 2)
        ) || len;
        const distNext = Math.sqrt(
          Math.pow(next.x - base[i].x, 2) + Math.pow(next.y - base[i].y, 2)
        ) || len;
        const maxOffset = Math.min(distPrev, distNext) * 0.45;
        // Jitter scales with spread so curvature=0.15 → up to ±15% of spread
        const desired = curvature * spread * 0.5 * jitter;
        // nativeRand()*2 keeps the historical [-1,1] factor when direction is
        // 'both', and biases to one side for 'outward'/'inward'.
        const amount = nativeRand() * 2 * Math.min(desired, maxOffset);
        points.push({ x: base[i].x + perpX * amount, y: base[i].y + perpY * amount });
      }
      break;
    }
  }

  return points;
}

// ---------------------------------------------------------------------------
// Resolution utilities — single source of truth for both client and server.
// Import these instead of duplicating the logic in shapes.ts / shapeGenerator.ts.
// ---------------------------------------------------------------------------

/**
 * Resolve a single pattern-parameter field that may be stored in
 * fixed / range / incremental mode.
 * Reads `${fieldName}Mode`, `${fieldName}Value`, `${fieldName}Range`,
 * `${fieldName}StartValue`, `${fieldName}Increment`.
 * Falls back to the legacy plain `settings[fieldName]` field and then to `defaultVal`.
 */
export function resolvePatternSetting(
  settings: any,
  fieldName: string,
  defaultVal: number,
  generationIndex = 0,
): number {
  const mode = settings?.[`${fieldName}Mode`] ?? 'fixed';
  if (mode === 'range') {
    const r = settings?.[`${fieldName}Range`] as [number, number] | undefined;
    if (r) return r[0] + Math.random() * (r[1] - r[0]);
  } else if (mode === 'incremental') {
    const start = settings?.[`${fieldName}StartValue`] ?? defaultVal;
    const inc   = settings?.[`${fieldName}Increment`]  ?? 0;
    return start + inc * generationIndex;
  }
  return settings?.[`${fieldName}Value`] ?? settings?.[fieldName] ?? defaultVal;
}

/**
 * Resolve the effective curve-direction angle from settings.
 * 'range' mode: random in [curveDirectionMin, curveDirectionMax].
 * Default / 'fixed' mode: returns curveDirectionAngle (0 when absent).
 */
export function resolveCurveDirectionAngle(settings: any): number {
  if (!settings) return 0;
  if (settings.curveDirectionMode === 'range') {
    const dMin = settings.curveDirectionMin ?? 0;
    const dMax = settings.curveDirectionMax ?? 0;
    return dMin + Math.random() * (dMax - dMin);
  }
  return settings.curveDirectionAngle ?? 0;
}

/**
 * Rotate a CurvePoint array in-place around its centroid by `angleDeg` degrees.
 */
export function rotateCurvePoints(points: CurvePoint[], angleDeg: number): void {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  for (const pt of points) {
    const dx = pt.x - cx, dy = pt.y - cy;
    pt.x = cx + dx * cos - dy * sin;
    pt.y = cy + dx * sin + dy * cos;
  }
}

/**
 * Compute the ideal auto-resample anchor count driven by the pattern geometry.
 * Targets a fixed pixel spacing between points.
 */
export function computeAutoResampleCount(
  patternType: number,
  spread: number,
  settings: any,
): number {
  const SPACING = 15;
  let count: number;
  if (patternType === 1) {
    const freq = resolvePatternSetting(settings, 'waveFrequency', 1);
    count = Math.max(4, Math.ceil(freq * spread * 1.5 / SPACING));
  } else if (patternType === 0) {
    const turns = resolvePatternSetting(settings, 'spiralTurns', 2.5);
    count = Math.max(6, Math.ceil(turns * 2 * Math.PI * spread / SPACING));
  } else if (patternType === 3) {
    const sweepDeg = resolvePatternSetting(settings, 'arcSweep', 135);
    count = Math.max(3, Math.ceil((sweepDeg / 360) * 2 * Math.PI * spread / SPACING));
  } else {
    count = 20;
  }
  return Math.max(2, Math.min(200, count));
}

/**
 * Resolve the pattern-resample override point count.
 * Returns `undefined` when pattern resample is disabled.
 */
export function resolvePatternResampleCount(
  settings: any,
  patternType: number,
  spread: number,
  generationIndex: number,
): number | undefined {
  if (!settings?.patternResample) return undefined;
  if (settings.patternResampleManual) {
    if (
      settings.patternResampleAmountMode === 'range' &&
      Array.isArray(settings.patternResampleAmountRange)
    ) {
      const [lo, hi] = settings.patternResampleAmountRange;
      return Math.max(2, Math.min(200, Math.round(lo + Math.random() * (hi - lo))));
    }
    return Math.max(
      2,
      Math.min(
        200,
        Math.round(
          settings.patternResampleAmountValue ??
            computeAutoResampleCount(patternType, spread, settings),
        ),
      ),
    );
  }
  return computeAutoResampleCount(patternType, spread, settings);
}

/**
 * Apply curve-length rescaling to a point array in-place.
 * Supports curveLengthMode: 'fixed' | 'range' | 'incremental'.
 * Returns true when a rescale was applied.
 */
export function applyCurveLengthToPoints(
  points: CurvePoint[],
  settings: any,
  generationIndex: number,
): boolean {
  if (!settings || points.length < 2) return false;
  let target: number | undefined;
  if (settings.curveLengthMode === 'incremental') {
    const start = settings.curveLengthStartValue;
    if (start !== undefined) {
      target = Math.max(0, start + (settings.curveLengthIncrement ?? 0) * generationIndex);
    }
  } else if (settings.curveLengthMode === 'fixed' && settings.curveLengthValue !== undefined) {
    target = settings.curveLengthValue;
  } else if (settings.curveLengthRange) {
    const [lo, hi] = settings.curveLengthRange;
    target = lo + Math.random() * (hi - lo);
  }
  if (target === undefined) return false;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const dominant = Math.max(maxX - minX, maxY - minY);
  if (dominant <= 0) return false;
  const sc = target / dominant;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const pt of points) {
    pt.x = cx + (pt.x - cx) * sc;
    pt.y = cy + (pt.y - cy) * sc;
  }
  return true;
}

/**
 * Build the resolved CurvePatternControls object from a settings object.
 * All seven per-pattern parameters are resolved through `resolvePatternSetting`
 * so fixed / range / incremental modes stored by the UI are honoured.
 * This is the single canonical place for that resolution — import it on both
 * client and server instead of duplicating inline.
 */
export function buildPatternControls(
  settings: any,
  spread: number,
  generationIndex: number,
): CurvePatternControls {
  return {
    ...(settings || {}),
    waveHeight:      resolvePatternSetting(settings, 'waveHeight',      spread * 0.6, generationIndex),
    waveFrequency:   resolvePatternSetting(settings, 'waveFrequency',   1,            generationIndex),
    wavePhase:       resolvePatternSetting(settings, 'wavePhase',       0,            generationIndex),
    spiralTurns:     resolvePatternSetting(settings, 'spiralTurns',     2.5,          generationIndex),
    spiralTightness: resolvePatternSetting(settings, 'spiralTightness', 1,            generationIndex),
    arcSweep:        resolvePatternSetting(settings, 'arcSweep',        135,          generationIndex),
    organicJitter:   resolvePatternSetting(settings, 'organicJitter',   1,            generationIndex),
  };
}

/**
 * Normalize raw stroke-cap slider weights and pick a cap. Shared so server
 * curve generation matches the client's stroke-cap distribution exactly.
 */
export function selectStrokeCap(
  probabilities: { round: number; square: number; butt: number }
): 'round' | 'square' | 'butt' {
  const { round, square, butt } = probabilities;
  const total = round + square + butt;

  if (total === 0) {
    return 'butt';
  }

  const roundPercent = (round / total) * 100;
  const squarePercent = (square / total) * 100;

  const rand = Math.random() * 100;

  if (rand < roundPercent) {
    return 'round';
  } else if (rand < roundPercent + squarePercent) {
    return 'square';
  } else {
    return 'butt';
  }
}
