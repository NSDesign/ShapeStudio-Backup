import { Shape } from './shapes';
import { 
  calculateLinearGradientCoords,
  calculateRadialGradientCoords,
  calculateConicGradientCoords,
  calculateDiamondGradientTexture
} from '@shared/gradientUtils';
import { applyLocalJitter, shapeIdToHash } from '@shared/roughnessUtils';
import { evaluateStrokeProfile, computeNormals, computeArcLengths, type StrokeProfile } from '@shared/strokeUtils';
import { addSmooth, resampleContour, resampleOpenContour, drawContourWithConfig, drawWirePass } from '@shared/renderModeUtils';

export function renderShape(ctx: CanvasRenderingContext2D, shape: Shape, zoom: number, skipSelectionAdornments = false): void {
  if (!shape.points || shape.points.length === 0) {
    return;
  }
  
  ctx.save();
  
  // Apply blend mode
  ctx.globalCompositeOperation = shape.properties.blendMode;
  
  // Apply transform
  ctx.translate(shape.transform.x, shape.transform.y);
  ctx.rotate(shape.transform.rotation * Math.PI / 180);
  ctx.scale(shape.transform.scaleX, shape.transform.scaleY);
  ctx.transform(1, shape.transform.skewX, shape.transform.skewY, 1, 0, 0);
  
  // Draw shape
  drawShape(ctx, shape);
  
  // Draw selection indicator (skip when rendering to offscreen canvas for compositing)
  if (shape.selected && !skipSelectionAdornments) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#2563EB';
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([5 / zoom, 5 / zoom]);
    drawSelectionBounds(ctx, shape);
    ctx.setLineDash([]);
  }
  
  ctx.restore();
}

// addSmooth, resampleContour, and drawContourWithConfig are imported from
// @shared/renderModeUtils — single canonical implementation shared across
// all four renderers for parity.

function drawRoundedRectangle(ctx: CanvasRenderingContext2D, shape: Shape): void {
  if (!shape.width || !shape.height || !shape.cornerRadius) return;
  const w = shape.width / 2;
  const h = shape.height / 2;
  const radius = Math.min(shape.cornerRadius, Math.min(w, h));
  ctx.roundRect(-w, -h, shape.width, shape.height, radius);
}

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  // renderModeOverride is the single gate: ALL polygon paths are only
  // reachable when it is explicitly enabled. When disabled every shape reverts
  // to its original native canvas primitive, exactly as before the feature existed.
  const rmo = shape.renderModeOverride;

  ctx.beginPath();
  
  switch (shape.type) {
    case 'rectangle':
    case 'square':
      if (rmo?.enabled) {
        drawPolygon(ctx, shape);
      } else {
        ctx.rect(-(shape.width ?? 0) / 2, -(shape.height ?? 0) / 2, shape.width ?? 0, shape.height ?? 0);
      }
      break;
    case 'rounded-rectangle':
    case 'rounded-square':
      if (rmo?.enabled) {
        drawPolygon(ctx, shape);
      } else {
        drawRoundedRectangle(ctx, shape);
      }
      break;
    case 'circle': {
      if (rmo?.enabled) {
        drawPolygon(ctx, shape);
      } else {
        const r = shape.radius ?? (shape.width ?? 0) / 2;
        ctx.arc(0, 0, r, 0, Math.PI * 2);
      }
      break;
    }
    case 'ellipse':
      if (rmo?.enabled) {
        drawPolygon(ctx, shape);
      } else {
        ctx.ellipse(0, 0, (shape.width ?? 0) / 2, (shape.height ?? 0) / 2, 0, 0, Math.PI * 2);
      }
      break;
    case 'triangle':
    case 'right-triangle':
    case 'trapezoid':
    case 'pentagon':
    case 'hexagon':
    case 'rhombus':
    case 'parallelogram':
    case 'kite':
    case 'semicircle':
    case 'heart':
    case 'arrow':
    case 'cross':
    case 'polygon':
    case 'star':
    case 'ring':
      if (rmo?.enabled) {
        drawPolygon(ctx, shape);
      } else {
        drawPolygonFlat(ctx, shape);
      }
      break;
    case 'line':
    case 'line-vector':
      drawLine(ctx, shape);
      break;
    case 'cubic':
      drawCubicCurve(ctx, shape);
      break;
    case 'bezier':
    case 'smooth-spline':
      drawSmoothSpline(ctx, shape);
      break;
    case 'chunk':
      drawChunk(ctx, shape);
      break;
    case 'blob':
      drawBlob(ctx, shape);
      break;
    case 'spline-circle':
    case 'spline-ellipse':
    case 'spline-ring':
      drawSplineCubicBezier(ctx, shape);
      break;
  }
  
  // Fill shape
  if (shape.type !== 'line' && shape.properties.fillColor !== 'none' && shape.properties.openCurveFilled !== false) {
    if (shape.properties.gradient) {
      const bounds = shape.getBounds();

      if (shape.properties.gradient.type === 'diamond') {
        ctx.fillStyle = createDiamondPattern(
          ctx, bounds, shape.properties.gradient.stops,
          shape.properties.gradient.diamondCenterX ?? 50,
          shape.properties.gradient.diamondCenterY ?? 50,
          shape.properties.gradient.diamondAngle ?? 0
        );
      } else {
        let gradient: CanvasGradient;
        
        if (shape.properties.gradient.type === 'linear') {
          const coords = calculateLinearGradientCoords(bounds, shape.properties.gradient.angle || 0);
          gradient = ctx.createLinearGradient(coords.x1, coords.y1, coords.x2, coords.y2);
        } else if (shape.properties.gradient.type === 'radial') {
          const coords = calculateRadialGradientCoords(
            bounds,
            shape.properties.gradient.radialCenterX ?? 50,
            shape.properties.gradient.radialCenterY ?? 50
          );
          gradient = ctx.createRadialGradient(
            coords.centerX, coords.centerY, coords.innerRadius,
            coords.centerX, coords.centerY, coords.outerRadius
          );
        } else if (shape.properties.gradient.type === 'conic') {
          const coords = calculateConicGradientCoords(
            bounds,
            shape.properties.gradient.conicCenterX ?? 50,
            shape.properties.gradient.conicCenterY ?? 50,
            shape.properties.gradient.conicAngle ?? 0
          );
          gradient = ctx.createConicGradient(coords.startAngle, coords.centerX, coords.centerY);
        } else {
          const coords = calculateRadialGradientCoords(
            bounds,
            shape.properties.gradient.radialCenterX ?? 50,
            shape.properties.gradient.radialCenterY ?? 50
          );
          gradient = ctx.createRadialGradient(
            coords.centerX, coords.centerY, coords.innerRadius,
            coords.centerX, coords.centerY, coords.outerRadius
          );
        }
        
        shape.properties.gradient.stops.forEach(stop => {
          gradient.addColorStop(stop.offset, stop.color);
        });
        
        ctx.fillStyle = gradient;
      }
    } else {
      ctx.fillStyle = shape.properties.fillColor;
    }
    ctx.globalAlpha = shape.properties.fillOpacity;
    ctx.fill('evenodd');
  }
  
  // Stroke shape
  if (shape.properties.strokeColor !== 'none' && shape.properties.strokeWidth > 0) {
    ctx.globalAlpha = shape.properties.strokeOpacity;
    ctx.strokeStyle = shape.properties.strokeColor;

    const hasProfile = !!shape.strokeProfile;
    const pattern = shape.strokePattern ?? 'none';

    if (hasProfile) {
      // Parameterised stroke: draw trapezoid fills along the boundary
      drawParameterisedStroke(ctx, shape);
    } else if (pattern === 'squiggle') {
      // Squiggle: synthesize a wiggly offset path, stroke normally
      ctx.lineWidth = shape.properties.strokeWidth;
      ctx.lineCap = shape.strokeCap ?? 'round';
      ctx.setLineDash([]);
      drawSquiggleStroke(ctx, shape);
    } else {
      ctx.lineWidth = shape.properties.strokeWidth;
      ctx.lineCap = shape.strokeCap ?? 'butt';
      if (pattern === 'dash') {
        const dl = shape.strokeDashLength ?? 10;
        const dg = shape.strokeDashGap ?? 6;
        ctx.setLineDash([dl, dg]);
      } else if (pattern === 'dot') {
        const sp = shape.strokeDotSpacing ?? 8;
        ctx.lineCap = 'round';
        ctx.setLineDash([0.5, sp]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Wire post-pass — canonical call handles resample, open/closed, per-vertex gradient sampling.
  const wireConfig = shape.wireConfig;
  if (wireConfig?.enabled) {
    ctx.globalAlpha = 1;
    drawWirePass(ctx as any, shape as any, wireConfig, shape.renderModeOverride);
  }
}

// ─── Parameterised stroke: filled trapezoids along the boundary ───────────────
function getShapeBoundaryPoints(shape: Shape): { x: number; y: number }[] {
  if (!shape.points || shape.points.length === 0) return [];
  const renderMode = shape.shapeRenderMode ?? 'sharp';
  const n = Math.max(48, shape.shapeRenderSegments ?? 48);

  if (shape.type === 'ring') {
    const half = Math.floor(shape.points.length / 2);
    return resampleContour(shape.points.slice(0, half), n);
  }

  let pts = shape.points;
  if (shape.localJitterConfig?.enabled) {
    pts = applyLocalJitter(pts, shape.localJitterConfig, shapeIdToHash(shape.id));
  }
  if (renderMode === 'sharp') {
    return resampleContour(pts, n);
  }
  return resampleContour(pts, n);
}

function drawParameterisedStroke(ctx: CanvasRenderingContext2D, shape: Shape): void {
  const pts = getShapeBoundaryPoints(shape);
  if (pts.length < 2) return;

  const profile = shape.strokeProfile!;
  const baseWidth = shape.properties.strokeWidth;
  const normals = computeNormals(pts);
  const arcLens = computeArcLengths(pts);
  const totalLen = arcLens[arcLens.length - 1];
  if (totalLen === 0) return;

  const n = pts.length;
  ctx.save();
  ctx.fillStyle = shape.properties.strokeColor;
  ctx.globalAlpha = shape.properties.strokeOpacity;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const t0 = arcLens[i] / totalLen;
    const t1 = arcLens[j === 0 ? n : j] / totalLen;

    const w0 = evaluateStrokeProfile(t0, profile) * baseWidth;
    const w1 = evaluateStrokeProfile(t1, profile) * baseWidth;

    const p0 = pts[i];
    const p1 = pts[j];
    const { nx: nx0, ny: ny0 } = normals[i];
    const { nx: nx1, ny: ny1 } = normals[j];

    const half0 = w0 / 2;
    const half1 = w1 / 2;

    // Trapezoid corners: outer side then inner side (reversed)
    ctx.beginPath();
    ctx.moveTo(p0.x + nx0 * half0, p0.y + ny0 * half0);
    ctx.lineTo(p1.x + nx1 * half1, p1.y + ny1 * half1);
    ctx.lineTo(p1.x - nx1 * half1, p1.y - ny1 * half1);
    ctx.lineTo(p0.x - nx0 * half0, p0.y - ny0 * half0);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

// Estimate sample count from shape perimeter, frequency, and align.
function _sqAutoCount(rawPts: { x: number; y: number }[], frequency: number, align: number): number {
  let perim = 0;
  for (let i = 0; i < rawPts.length - 1; i++)
    perim += Math.hypot(rawPts[i + 1].x - rawPts[i].x, rawPts[i + 1].y - rawPts[i].y);
  const alignFactor = 1 + (1 - Math.max(0, Math.min(100, align)) / 100) * 0.5;
  return Math.max(128, Math.min(4096, Math.ceil(Math.max(perim * 0.2, frequency * 24) * alignFactor)));
}

// ─── Squiggle stroke: full-featured sinusoidal + jitter + noise path ─────────
function drawSquiggleStroke(ctx: CanvasRenderingContext2D, shape: Shape): void {
  const amplitude  = (shape as any).strokeSquiggleAmplitude  ?? 4;
  const frequency  = (shape as any).strokeSquiggleFrequency  ?? 1;
  const phase      = (shape as any).strokeSquigglePhase      ?? 0;
  const align      = (shape as any).strokeSquiggleAlign      ?? 100;
  const absWave    = (shape as any).strokeSquiggleAbs        ?? false;
  const flipWave   = (shape as any).strokeSquiggleFlip       ?? false;
  const jitter     = (shape as any).strokeSquiggleJitter     ?? 0;
  const jSeed      = (shape as any).strokeSquiggleJitterSeed ?? 0;
  const noise      = (shape as any).strokeSquiggleNoise      ?? 0;
  const noiseFreq  = (shape as any).strokeSquiggleNoiseFreq  ?? 1;
  const jMode      = (shape as any).strokeSquiggleJitterMode ?? 'normal';

  // LCG pseudo-random
  const sqLcg = (s: number) => { const r = (Math.imul(1664525, s | 0) + 1013904223) | 0; return ((r >>> 0) & 0x7fffffff) / 0x7fffffff; };
  // Coherent lattice noise
  const sqNoise = (pos: number, nPts: number, seed: number) => {
    const scaled = pos * nPts, i0 = Math.floor(scaled), frac = scaled - i0;
    const cf = (1 - Math.cos(frac * Math.PI)) * 0.5;
    return (sqLcg(seed * 7919 + (i0 & 0x3fff)) * (1 - cf) + sqLcg(seed * 7919 + ((i0 + 1) & 0x3fff)) * cf) * 2 - 1;
  };

  const isOpen = (shape as any).closed === false;

  // Get baseline: evaluate actual bezier/cubic curve if handles present, else boundary polygon
  let rawPts: { x: number; y: number }[];
  const handles = (shape as any).tangentHandles as Array<{ in: {x:number;y:number}; out: {x:number;y:number} }> | undefined;
  const cps = (shape as any).controlPoints as Array<{x:number;y:number}> | undefined;
  if (handles && handles.length >= shape.points.length && shape.points.length >= 2) {
    const basePts = shape.localJitterConfig?.enabled
      ? applyLocalJitter(shape.points, shape.localJitterConfig, shapeIdToHash(shape.id))
      : shape.points;
    const target = 512;
    const segCount = isOpen ? basePts.length - 1 : basePts.length;
    if (segCount < 1) { rawPts = basePts; }
    else {
      const sps = Math.max(4, Math.ceil(target / segCount));
      rawPts = [];
      for (let i = 0; i < segCount; i++) {
        const p0 = basePts[i], p3 = basePts[(i + 1) % basePts.length];
        const h0 = handles[i], h1 = handles[(i + 1) % basePts.length];
        const cp1 = h0?.out ?? p0, cp2 = h1?.in ?? p3;
        for (let j = 0; j < sps; j++) {
          const t = j / sps, u = 1 - t;
          rawPts.push({ x: u*u*u*p0.x + 3*u*u*t*cp1.x + 3*u*t*t*cp2.x + t*t*t*p3.x,
                        y: u*u*u*p0.y + 3*u*u*t*cp1.y + 3*u*t*t*cp2.y + t*t*t*p3.y });
        }
      }
      if (isOpen) rawPts.push({ ...basePts[basePts.length - 1] });
    }
  } else if (cps && cps.length >= (shape.points.length - 1) * 2 && shape.points.length >= 2) {
    const basePts = shape.localJitterConfig?.enabled
      ? applyLocalJitter(shape.points, shape.localJitterConfig, shapeIdToHash(shape.id))
      : shape.points;
    const target = 512;
    const hasWrapSeg = !isOpen && cps.length >= basePts.length * 2;
    const segCount = hasWrapSeg ? basePts.length : basePts.length - 1;
    const sps = Math.max(4, Math.ceil(target / segCount));
    rawPts = [];
    for (let i = 0; i < segCount; i++) {
      const p0 = basePts[i], p3 = basePts[(i + 1) % basePts.length];
      const cp1 = cps[i * 2] ?? p0, cp2 = cps[i * 2 + 1] ?? p3;
      for (let j = 0; j < sps; j++) {
        const t = j / sps, u = 1 - t;
        rawPts.push({ x: u*u*u*p0.x + 3*u*u*t*cp1.x + 3*u*t*t*cp2.x + t*t*t*p3.x,
                      y: u*u*u*p0.y + 3*u*u*t*cp1.y + 3*u*t*t*cp2.y + t*t*t*p3.y });
      }
    }
    if (!hasWrapSeg) rawPts.push({ ...basePts[basePts.length - 1] });
  } else {
    rawPts = getShapeBoundaryPoints(shape);
  }

  if (!rawPts || rawPts.length < 2) return;
  const sampleCount = (shape as any).strokeSquiggleSampleCount ?? _sqAutoCount(rawPts, frequency, align);
  let pts = isOpen ? resampleOpenContour(rawPts, sampleCount) : resampleContour(rawPts, sampleCount);
  const n = pts.length;
  if (n < 2) return;

  // Shape-align: smooth the baseline (align=100 → exact shape, align=0 → max smooth)
  const smoothW = Math.round((1 - align / 100) * n * 0.15);
  if (smoothW > 0) {
    const cnt = 2 * smoothW + 1;
    pts = pts.map((_, i) => {
      let sx = 0, sy = 0;
      for (let d = -smoothW; d <= smoothW; d++) {
        const j = isOpen ? Math.max(0, Math.min(n - 1, i + d)) : (i + d + n) % n;
        sx += pts[j].x; sy += pts[j].y;
      }
      return { x: sx / cnt, y: sy / cnt };
    });
  }

  // Centroid for outward-normal orientation
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;

  const normals: { nx: number; ny: number }[] = [];
  for (let i = 0; i < n; i++) {
    const prev = isOpen ? pts[Math.max(0, i - 1)] : pts[(i - 1 + n) % n];
    const next = isOpen ? pts[Math.min(n - 1, i + 1)] : pts[(i + 1) % n];
    let tx = next.x - prev.x, ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty);
    if (tl > 0) { tx /= tl; ty /= tl; }
    let nx = -ty, ny = tx;
    if (nx * (cx - pts[i].x) + ny * (cy - pts[i].y) > 0) { nx = -nx; ny = -ny; }
    normals.push({ nx, ny });
  }

  // Cumulative arc lengths → normalised t ∈ [0,1]
  const arcLens: number[] = [0];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = isOpen ? pts[Math.min(i + 1, n - 1)] : pts[(i + 1) % n];
    arcLens.push(arcLens[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const totalLen = isOpen ? arcLens[n - 1] : arcLens[n];
  const noiseLattice = Math.max(4, Math.round(noiseFreq * 16));

  // Collect displaced points
  const dpts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = totalLen > 0 ? arcLens[i] / totalLen : 0;
    const sinOff = amplitude * Math.sin(2 * Math.PI * frequency * t + phase);
    const jRaw  = jitter > 0 ? (sqLcg(jSeed * 65537 + i) * 2 - 1) * jitter : 0;
    const jRawX = (jitter > 0 && jMode === 'xy') ? (sqLcg(jSeed * 65537 + i + 99991) * 2 - 1) * jitter : 0;
    const jRawY = (jitter > 0 && jMode === 'xy') ? (sqLcg(jSeed * 65537 + i + 199933) * 2 - 1) * jitter : 0;
    const nRaw  = noise > 0 ? sqNoise(t, noiseLattice, jSeed + 1) * noise : 0;
    const nRawX = (noise > 0 && jMode === 'xy') ? sqNoise(t, noiseLattice, jSeed + 2) * noise : 0;
    const nRawY = (noise > 0 && jMode === 'xy') ? sqNoise(t, noiseLattice, jSeed + 3) * noise : 0;
    const { nx, ny } = normals[i];
    let x: number, y: number;
    if (jMode === 'xy') {
      let totalX = nx * sinOff + jRawX + nRawX;
      let totalY = ny * sinOff + jRawY + nRawY;
      if (absWave) { totalX = Math.abs(totalX); totalY = Math.abs(totalY); }
      if (flipWave) { totalX = -totalX; totalY = -totalY; }
      x = pts[i].x + totalX;
      y = pts[i].y + totalY;
    } else {
      let totalOff = sinOff + jRaw + nRaw;
      if (absWave) totalOff = Math.abs(totalOff);
      if (flipWave) totalOff = -totalOff;
      x = pts[i].x + nx * totalOff;
      y = pts[i].y + ny * totalOff;
    }
    dpts.push({ x, y });
  }

  // Draw: smooth Catmull-Rom bezier or plain polyline
  // Only apply smooth bezier when the shape has actual bezier curve data
  const _hasCurveData = !!(handles?.length || cps?.length);
  const smoothCurves = _hasCurveData && (shape as any).strokeSquiggleSmoothCurves !== false;
  ctx.beginPath();
  ctx.moveTo(dpts[0].x, dpts[0].y);
  if (smoothCurves) {
    const segCount = isOpen ? n - 1 : n;
    for (let i = 0; i < segCount; i++) {
      const p0 = dpts[isOpen ? Math.max(0, i - 1) : (i - 1 + n) % n];
      const p1 = dpts[i];
      const p2 = dpts[(i + 1) % n];
      const p3 = dpts[isOpen ? Math.min(n - 1, i + 2) : (i + 2) % n];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
  } else {
    for (let i = 1; i < n; i++) ctx.lineTo(dpts[i].x, dpts[i].y);
  }
  if (!isOpen) ctx.closePath();
  ctx.stroke();
}

// ─── Diamond gradient: pixel-fills an offscreen canvas using Chebyshev distance ─
function createDiamondPattern(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; width: number; height: number },
  stops: { offset: number; color: string }[],
  centerXPercent: number = 50,
  centerYPercent: number = 50,
  angleDegrees: number = 0
): CanvasPattern | string {
  const bw = Math.max(1, Math.round(bounds.width));
  const bh = Math.max(1, Math.round(bounds.height));

  // Parse CSS color strings to RGBA via a 1×1 canvas
  const parsedStops = stops.map(stop => {
    const tmp = document.createElement('canvas');
    tmp.width = 1; tmp.height = 1;
    const tc = tmp.getContext('2d')!;
    tc.fillStyle = stop.color;
    tc.fillRect(0, 0, 1, 1);
    const d = tc.getImageData(0, 0, 1, 1).data;
    return { offset: stop.offset, r: d[0], g: d[1], b: d[2], a: d[3] };
  }).sort((a, b) => a.offset - b.offset);

  // Delegate pixel math to the shared Chebyshev algorithm
  const pixelData = calculateDiamondGradientTexture(parsedStops, bw, bh, centerXPercent, centerYPercent, angleDegrees);

  const offCanvas = document.createElement('canvas');
  offCanvas.width = bw;
  offCanvas.height = bh;
  const offCtx = offCanvas.getContext('2d')!;
  const imgData = offCtx.createImageData(bw, bh);
  imgData.data.set(pixelData);
  offCtx.putImageData(imgData, 0, 0);

  const result = ctx.createPattern(offCanvas, 'no-repeat');
  if (!result) return '#000000';
  result.setTransform(new DOMMatrix().translateSelf(bounds.x, bounds.y));
  return result;
}

// ─── Flat polygon rendering (no smoothing or resampling — original behaviour) ──
// Used for all polygon-based shapes when renderModeOverride is disabled.
// Handles jitter but draws straight lineTo segments between each geometry point.
function drawPolygonFlat(ctx: CanvasRenderingContext2D, shape: Shape): void {
  if (!shape.points || shape.points.length === 0) return;

  const jitterCfg = shape.localJitterConfig;
  const useJitter = jitterCfg?.enabled ?? false;
  const shapeHash = useJitter ? shapeIdToHash(shape.id) : 0;

  if (shape.type === 'ring') {
    const halfPoints = Math.floor(shape.points.length / 2);
    let outerPts: { x: number; y: number }[] = shape.points.slice(0, halfPoints);
    let innerPts: { x: number; y: number }[] = shape.points.slice(halfPoints);
    if (useJitter && jitterCfg) {
      outerPts = applyLocalJitter(outerPts, jitterCfg, shapeHash);
      innerPts = applyLocalJitter(innerPts, jitterCfg, shapeHash + 999983);
    }
    outerPts.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
    ctx.closePath();
    innerPts.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
    ctx.closePath();
  } else {
    let pts: { x: number; y: number }[] = shape.points;
    if (useJitter && jitterCfg) {
      pts = applyLocalJitter(pts, jitterCfg, shapeHash);
    }
    pts.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
    ctx.closePath();
  }
}

// ─── Polygon rendering via renderModeOverride ────────────────────────────────
// Only called when renderModeOverride.enabled === true.
function drawPolygon(ctx: CanvasRenderingContext2D, shape: Shape): void {
  if (!shape.points || shape.points.length === 0) return;

  const jitterCfg = shape.localJitterConfig;
  const useJitter = jitterCfg?.enabled ?? false;
  const shapeHash = useJitter ? shapeIdToHash(shape.id) : 0;
  const rmo = shape.renderModeOverride!;

  if (shape.type === 'ring') {
    const halfPoints = Math.floor(shape.points.length / 2);
    let outerPts: { x: number; y: number }[] = shape.points.slice(0, halfPoints);
    let innerPts: { x: number; y: number }[] = shape.points.slice(halfPoints);

    if (useJitter && jitterCfg) {
      outerPts = applyLocalJitter(outerPts, jitterCfg, shapeHash);
      innerPts = applyLocalJitter(innerPts, jitterCfg, shapeHash + 999983);
    }

    drawContourWithConfig(ctx, outerPts, rmo);
    drawContourWithConfig(ctx, innerPts, rmo);
  } else {
    let pts: { x: number; y: number }[] = shape.points;
    if (useJitter && jitterCfg) {
      pts = applyLocalJitter(pts, jitterCfg, shapeHash);
    }
    drawContourWithConfig(ctx, pts, rmo);
  }
}


function drawLine(ctx: CanvasRenderingContext2D, shape: Shape): void {
  shape.points.forEach((point, i) => {
    if (i === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
}

function drawCurve(ctx: CanvasRenderingContext2D, shape: Shape): void {
  if (shape.points.length < 2) return;
  
  ctx.moveTo(shape.points[0].x, shape.points[0].y);
  
  const renderType = shape.renderType || 'polygon';
  
  if (renderType === 'bezier' || renderType === 'cubic' || renderType === 'smooth') {
    if ((shape.type === 'bezier' || shape.type === 'cubic' || shape.type === 'smooth-spline') && shape.tangentHandles && shape.points.length >= 2) {
      for (let i = 0; i < shape.points.length - 1; i++) {
        const p2 = shape.points[i + 1];
        
        if (i < shape.tangentHandles.length && (i + 1) < shape.tangentHandles.length) {
          const cp1 = shape.tangentHandles[i].out;
          const cp2 = shape.tangentHandles[i + 1].in;
          ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
        } else {
          ctx.lineTo(p2.x, p2.y);
        }
      }
      
      if (shape.closed && shape.points.length > 2) {
        const lastIndex = shape.points.length - 1;
        const firstPoint = shape.points[0];
        
        if (lastIndex < shape.tangentHandles.length && shape.tangentHandles.length > 0) {
          const cp1 = shape.tangentHandles[lastIndex].out;
          const cp2 = shape.tangentHandles[0].in;
          ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, firstPoint.x, firstPoint.y);
        }
      }
    } else if (shape.controlPoints && shape.controlPoints.length > 0) {
      for (let i = 1; i < shape.points.length; i++) {
        const controlIndex1 = (i - 1) * 2;
        const controlIndex2 = controlIndex1 + 1;
        
        if (controlIndex1 < shape.controlPoints.length && controlIndex2 < shape.controlPoints.length) {
          ctx.bezierCurveTo(
            shape.controlPoints[controlIndex1].x,
            shape.controlPoints[controlIndex1].y,
            shape.controlPoints[controlIndex2].x,
            shape.controlPoints[controlIndex2].y,
            shape.points[i].x,
            shape.points[i].y
          );
        } else {
          ctx.lineTo(shape.points[i].x, shape.points[i].y);
        }
      }
    } else {
      for (let i = 1; i < shape.points.length; i++) {
        const p0 = shape.points[i - 2] || shape.points[i - 1];
        const p1 = shape.points[i - 1];
        const p2 = shape.points[i];
        const p3 = shape.points[i + 1] || shape.points[i];
        
        const tension = 0.3;
        const cp1x = p1.x + (p2.x - p0.x) * tension;
        const cp1y = p1.y + (p2.y - p0.y) * tension;
        const cp2x = p2.x - (p3.x - p1.x) * tension;
        const cp2y = p2.y - (p3.y - p1.y) * tension;
        
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
    }
  } else {
    for (let i = 1; i < shape.points.length; i++) {
      ctx.lineTo(shape.points[i].x, shape.points[i].y);
    }
  }
  
  if (shape.closed) ctx.closePath();
}

function drawChunk(ctx: CanvasRenderingContext2D, shape: Shape): void {
  if (shape.points.length < 3) return;
  
  ctx.moveTo(shape.points[0].x, shape.points[0].y);
  
  if (shape.controlPoints && shape.controlPoints.length > 0) {
    for (let i = 1; i < shape.points.length; i++) {
      const controlIndex = (i - 1) % shape.controlPoints.length;
      ctx.quadraticCurveTo(
        shape.controlPoints[controlIndex].x,
        shape.controlPoints[controlIndex].y,
        shape.points[i].x,
        shape.points[i].y
      );
    }
    if (shape.controlPoints.length > 0) {
      const lastControlIndex = shape.controlPoints.length - 1;
      ctx.quadraticCurveTo(
        shape.controlPoints[lastControlIndex].x,
        shape.controlPoints[lastControlIndex].y,
        shape.points[0].x,
        shape.points[0].y
      );
    }
  } else {
    for (let i = 1; i < shape.points.length; i++) {
      const current = shape.points[i];
      const next = shape.points[(i + 1) % shape.points.length];
      const cp1x = current.x;
      const cp1y = current.y;
      const cp2x = (current.x + next.x) / 2;
      const cp2y = (current.y + next.y) / 2;
      
      ctx.quadraticCurveTo(cp1x, cp1y, cp2x, cp2y);
    }
  }
  
  ctx.closePath();
}

function drawBlob(ctx: CanvasRenderingContext2D, shape: Shape): void {
  if (shape.points.length < 3) return;
  
  ctx.moveTo(shape.points[0].x, shape.points[0].y);
  
  if (shape.tangentHandles && shape.tangentHandles.length === shape.points.length) {
    for (let i = 0; i < shape.points.length; i++) {
      const next = shape.points[(i + 1) % shape.points.length];
      const currentHandle = shape.tangentHandles[i];
      const nextHandle = shape.tangentHandles[(i + 1) % shape.tangentHandles.length];
      
      ctx.bezierCurveTo(
        currentHandle.out.x,
        currentHandle.out.y,
        nextHandle.in.x,
        nextHandle.in.y,
        next.x,
        next.y
      );
    }
  } else {
    for (let i = 1; i < shape.points.length; i++) {
      const current = shape.points[i];
      const next = shape.points[(i + 1) % shape.points.length];
      const cp1x = current.x;
      const cp1y = current.y;
      const cp2x = (current.x + next.x) / 2;
      const cp2y = (current.y + next.y) / 2;
      
      ctx.quadraticCurveTo(cp1x, cp1y, cp2x, cp2y);
    }
  }
  
  ctx.closePath();
}

function drawCubicCurve(ctx: CanvasRenderingContext2D, shape: Shape): void {
  if (!shape.points || shape.points.length < 2) return;
  
  ctx.moveTo(shape.points[0].x, shape.points[0].y);

  if (shape.tangentHandles && shape.tangentHandles.length > 0) {
    for (let i = 0; i < shape.points.length - 1; i++) {
      const p2 = shape.points[i + 1];
      const handle1 = shape.tangentHandles[i];
      const handle2 = shape.tangentHandles[i + 1];
      
      if (handle1 && handle2 && 'out' in handle1 && 'in' in handle2) {
        ctx.bezierCurveTo(
          handle1.out.x, handle1.out.y,
          handle2.in.x, handle2.in.y,
          p2.x, p2.y
        );
      } else {
        ctx.lineTo(p2.x, p2.y);
      }
    }
  } else {
    for (let i = 1; i < shape.points.length; i++) {
      ctx.lineTo(shape.points[i].x, shape.points[i].y);
    }
  }

  if (shape.closed) {
    ctx.closePath();
  }
}

function drawSmoothSpline(ctx: CanvasRenderingContext2D, shape: Shape): void {
  if (!shape.points || shape.points.length < 2) return;
  if (!shape.controlPoints || shape.controlPoints.length === 0) return;

  ctx.moveTo(shape.points[0].x, shape.points[0].y);

  const numSegments = shape.closed ? shape.points.length : shape.points.length - 1;
  
  for (let i = 0; i < numSegments; i++) {
    const nextPoint = shape.points[(i + 1) % shape.points.length];
    const cp1 = shape.controlPoints[i * 2];
    const cp2 = shape.controlPoints[i * 2 + 1];
    
    if (cp1 && cp2) {
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, nextPoint.x, nextPoint.y);
    } else {
      ctx.lineTo(nextPoint.x, nextPoint.y);
    }
  }

  if (shape.closed) {
    ctx.closePath();
  }
}

function drawSplineCubicBezier(ctx: CanvasRenderingContext2D, shape: Shape): void {
  if (!shape.controlPoints || !shape.points) return;
  
  if (shape.type === 'spline-circle' || shape.type === 'spline-ellipse') {
    ctx.moveTo(shape.points[0].x, shape.points[0].y);
    
    for (let i = 0; i < 4; i++) {
      const endPoint = shape.points[(i + 1) % 4];
      const cp1 = shape.controlPoints[i * 2];
      const cp2 = shape.controlPoints[i * 2 + 1];
      
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, endPoint.x, endPoint.y);
    }
    
    if (shape.closed) {
      ctx.closePath();
    }
  } else if (shape.type === 'spline-ring') {
    // Outer ring
    ctx.moveTo(shape.points[0].x, shape.points[0].y);
    
    for (let i = 0; i < 4; i++) {
      const endPoint = shape.points[(i + 1) % 4];
      const cp1 = shape.controlPoints[i * 2];
      const cp2 = shape.controlPoints[i * 2 + 1];
      
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, endPoint.x, endPoint.y);
    }
    ctx.closePath();
    
    // Inner ring
    ctx.moveTo(shape.points[4].x, shape.points[4].y);
    
    for (let i = 0; i < 4; i++) {
      const endPoint = shape.points[4 + ((i + 1) % 4)];
      const cp1 = shape.controlPoints[8 + i * 2];
      const cp2 = shape.controlPoints[8 + i * 2 + 1];
      
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, endPoint.x, endPoint.y);
    }
    ctx.closePath();
  }
}

function drawSelectionBounds(ctx: CanvasRenderingContext2D, shape: Shape): void {
  const bounds = shape.getBounds();
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  
  const cornerSize = 6;
  const corners = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.width, bounds.y],
    [bounds.x + bounds.width, bounds.y + bounds.height],
    [bounds.x, bounds.y + bounds.height]
  ];
  
  ctx.fillStyle = '#2563EB';
  corners.forEach(([x, y]) => {
    ctx.fillRect(x - cornerSize/2, y - cornerSize/2, cornerSize, cornerSize);
  });
}
