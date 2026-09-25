import { SHAPE_BLUR_JS } from './shapeBlur';

/**
 * shared/shapeRenderer.ts
 *
 * Unified shape rendering logic shared across three rendering paths:
 *   1. TypeScript import — used by server/lib/canvasRenderer.ts (node-canvas)
 *   2. Client import    — used by client/src/lib/shapes.ts (browser CanvasRenderingContext2D)
 *   3. Puppeteer inject — SHAPE_RENDERER_JS string injected into the export HTML page
 *
 * The SHAPE_RENDERER_JS string assumes RENDER_MODE_UTILS_JS is already injected and
 * that a RENDER_DATA global is available (standard for the Puppeteer export templates).
 *
 * Divergences fixed vs. the old inline Puppeteer renderShape:
 *   - Diamond gradient now supported (browser document.createElement path)
 *   - Stroke patterns: dash, dot
 *   - Fill rule: evenodd only for ring / spline-ring (not all shapes)
 *   - Proper angle-based linear gradient (matches client gradientUtils)
 *   - blob / chunk / cubic shape types rendered correctly
 *   - drawLine supports renderModeOverride (catmull-rom / natural-cubic)
 *   - rounded-rectangle uses ctx.roundRect() like the client
 */

import {
  calculateLinearGradientCoords,
  calculateRadialGradientCoords,
  calculateConicGradientCoords,
  calculateDiamondGradientTexture,
  type GradientConfig,
  type Bounds,
} from './gradientUtils';
import {
  addSmooth,
  drawContourWithConfig,
  drawWirePass,
  applyCatmullRom,
  applyNaturalCubicSpline,
  resampleContour,
  resampleOpenContour,
} from './renderModeUtils';
import { applyLocalJitter, shapeIdToHash } from './roughnessUtils';

// ─── Minimal shape-data type ─────────────────────────────────────────────────
// This matches the shape data structure used at runtime (client Shape class and
// the plain-object shapes produced by the server generator / batch processor).
export interface ShapePoint { x: number; y: number }
export interface TangentHandle { in: ShapePoint; out: ShapePoint }

export interface ShapeRenderData {
  id?: string;
  type: string;
  points: ShapePoint[];
  controlPoints?: ShapePoint[];
  tangentHandles?: TangentHandle[];
  closed?: boolean;
  radius?: number;
  width?: number;
  height?: number;
  cornerRadius?: number;
  renderType?: string;
  shapeRenderMode?: string;
  renderModeOverride?: any;
  localJitterConfig?: any;
  wireConfig?: any;
  strokePattern?: string;
  strokeCap?: CanvasLineCap;
  strokeDashLength?: number;
  strokeDashGap?: number;
  strokeDotSpacing?: number;
  strokeProfile?: any;
  strokeSquiggleAmplitude?: number;
  strokeSquiggleFrequency?: number;
  strokeSquigglePhase?: number;
  strokeSquiggleAlign?: number;
  strokeSquiggleAbs?: boolean;
  strokeSquiggleFlip?: boolean;
  strokeSquiggleJitter?: number;
  strokeSquiggleJitterSeed?: number;
  strokeSquiggleNoise?: number;
  strokeSquiggleNoiseFreq?: number;
  strokeSquiggleJitterMode?: 'normal' | 'xy';  // 'normal'=along curve normal, 'xy'=screen space
  strokeSquiggleSampleCount?: number;           // undefined = auto-calculated from perimeter
  strokeSquiggleSmoothCurves?: boolean;         // true = fit bezier curves through displaced points
  properties: {
    fillColor: string;
    strokeColor: string;
    strokeWidth: number;
    fillOpacity: number;
    strokeOpacity: number;
    blendMode?: string;
    blurRadius?: number;
    blurType?: 'box' | 'gaussian';
    gradient?: GradientConfig | null;
    openCurveFilled?: boolean;
  };
}

/** Factory used to create an offscreen canvas for diamond gradient texture.
 *  Browser path: (w, h) => document.createElement('canvas')
 *  node-canvas path: (w, h) => createCanvas(w, h)  (imported by canvasRenderer.ts)
 */
export type OffscreenCanvasFactory = (w: number, h: number) => {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
};

// ─── Bounds helper ────────────────────────────────────────────────────────────

export function getShapeBoundsFromPoints(points: ShapePoint[]): Bounds {
  if (!points || points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ─── Path-building helpers (TypeScript) ──────────────────────────────────────

function tsDrawLine(ctx: CanvasRenderingContext2D, shape: ShapeRenderData): void {
  const pts = shape.points;
  if (!pts || pts.length < 2) return;
  const rmo = shape.renderModeOverride;
  if (rmo?.enabled) {
    if (rmo.smoothAlgorithm === 'catmull-rom') {
      applyCatmullRom(ctx as any, pts, rmo.catmullAlpha ?? 0.5, false, rmo.tension ?? 1);
      return;
    }
    if (rmo.smoothAlgorithm === 'natural-cubic') {
      applyNaturalCubicSpline(ctx as any, pts, false, rmo.naturalCubicClamped ?? false);
      return;
    }
  }
  pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
}

function tsDrawSmoothSpline(ctx: CanvasRenderingContext2D, shape: ShapeRenderData): void {
  const pts = shape.points;
  if (!pts || pts.length < 2) return;
  const rmo = shape.renderModeOverride;
  if (rmo?.enabled) {
    if (rmo.smoothAlgorithm === 'catmull-rom') {
      applyCatmullRom(ctx as any, pts, rmo.catmullAlpha ?? 0.5, shape.closed ?? false, rmo.tension ?? 1);
      return;
    }
    if (rmo.smoothAlgorithm === 'natural-cubic') {
      applyNaturalCubicSpline(ctx as any, pts, shape.closed ?? false, rmo.naturalCubicClamped ?? false);
      return;
    }
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  const handles = shape.tangentHandles;
  if (handles && handles.length >= pts.length) {
    for (let i = 0; i < pts.length - 1; i++) {
      ctx.bezierCurveTo(handles[i].out.x, handles[i].out.y, handles[i + 1].in.x, handles[i + 1].in.y, pts[i + 1].x, pts[i + 1].y);
    }
    if (shape.closed && pts.length > 2) {
      const li = pts.length - 1;
      ctx.bezierCurveTo(handles[li].out.x, handles[li].out.y, handles[0].in.x, handles[0].in.y, pts[0].x, pts[0].y);
    }
  } else {
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 2] ?? pts[i - 1], p1 = pts[i - 1], p2 = pts[i], p3 = pts[i + 1] ?? pts[i];
      ctx.bezierCurveTo(p1.x + (p2.x - p0.x) * 0.3, p1.y + (p2.y - p0.y) * 0.3, p2.x - (p3.x - p1.x) * 0.3, p2.y - (p3.y - p1.y) * 0.3, p2.x, p2.y);
    }
  }
  if (shape.closed) ctx.closePath();
}

function tsDrawCubicCurve(ctx: CanvasRenderingContext2D, shape: ShapeRenderData): void {
  const pts = shape.points;
  if (!pts || pts.length < 2) return;
  const rmo = shape.renderModeOverride;
  if (rmo?.enabled) {
    if (rmo.smoothAlgorithm === 'catmull-rom') { applyCatmullRom(ctx as any, pts, rmo.catmullAlpha ?? 0.5, shape.closed ?? false, rmo.tension ?? 1); return; }
    if (rmo.smoothAlgorithm === 'natural-cubic') { applyNaturalCubicSpline(ctx as any, pts, shape.closed ?? false, rmo.naturalCubicClamped ?? false); return; }
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  const handles = shape.tangentHandles;
  if (handles && handles.length > 0) {
    for (let i = 0; i < pts.length - 1; i++) {
      const h1 = handles[i], h2 = handles[i + 1];
      if (h1?.out && h2?.in) ctx.bezierCurveTo(h1.out.x, h1.out.y, h2.in.x, h2.in.y, pts[i + 1].x, pts[i + 1].y);
      else ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
    }
  } else {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }
  if (shape.closed) ctx.closePath();
}

function tsDrawBezierCurve(ctx: CanvasRenderingContext2D, shape: ShapeRenderData): void {
  const pts = shape.points;
  if (!pts || pts.length < 2) return;
  const rmo = shape.renderModeOverride;
  if (rmo?.enabled) {
    if (rmo.smoothAlgorithm === 'catmull-rom') { applyCatmullRom(ctx as any, pts, rmo.catmullAlpha ?? 0.5, shape.closed ?? false, rmo.tension ?? 1); return; }
    if (rmo.smoothAlgorithm === 'natural-cubic') { applyNaturalCubicSpline(ctx as any, pts, shape.closed ?? false, rmo.naturalCubicClamped ?? false); return; }
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  const cps = shape.controlPoints, handles = shape.tangentHandles;
  const n = pts.length;
  // "Average endpoints" close mode moves the first & last point to a shared
  // midpoint; in that case the segments already close on themselves, so a wrap
  // segment would trace a redundant loop. Detect coincident endpoints and skip it.
  const closeCoincident = n > 1 && Math.abs(pts[n - 1].x - pts[0].x) < 1e-6 && Math.abs(pts[n - 1].y - pts[0].y) < 1e-6;
  if (cps && cps.length >= (n - 1) * 2) {
    for (let i = 1; i < n; i++) {
      const ci1 = (i - 1) * 2, ci2 = ci1 + 1;
      if (ci1 < cps.length && ci2 < cps.length) ctx.bezierCurveTo(cps[ci1].x, cps[ci1].y, cps[ci2].x, cps[ci2].y, pts[i].x, pts[i].y);
      else ctx.lineTo(pts[i].x, pts[i].y);
    }
    // Closed bezier: draw the wrap-around segment as a real curve when control
    // points for it exist, otherwise fall back to a straight close.
    if (shape.closed) {
      const cc1 = (n - 1) * 2, cc2 = cc1 + 1;
      if (n > 2 && !closeCoincident && cc2 < cps.length) ctx.bezierCurveTo(cps[cc1].x, cps[cc1].y, cps[cc2].x, cps[cc2].y, pts[0].x, pts[0].y);
      else ctx.closePath();
    }
  } else if (handles && handles.length >= n) {
    for (let i = 0; i < n - 1; i++) {
      const h1 = handles[i], h2 = handles[i + 1];
      if (h1?.out && h2?.in) ctx.bezierCurveTo(h1.out.x, h1.out.y, h2.in.x, h2.in.y, pts[i + 1].x, pts[i + 1].y);
      else ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
    }
    // Closed bezier: draw the wrap-around segment (last point -> first point) as
    // a real curve using the wrap tangents instead of a straight closePath.
    if (shape.closed) {
      const hl = handles[n - 1], hf = handles[0];
      if (n > 2 && !closeCoincident && hl?.out && hf?.in) ctx.bezierCurveTo(hl.out.x, hl.out.y, hf.in.x, hf.in.y, pts[0].x, pts[0].y);
      else ctx.closePath();
    }
  } else {
    for (let i = 1; i < n; i++) {
      const prev = pts[i - 1], cur = pts[i], next = pts[i + 1] ?? (shape.closed ? pts[0] : cur);
      ctx.quadraticCurveTo(cur.x + (next.x - prev.x) * 0.3, cur.y + (next.y - prev.y) * 0.3, cur.x, cur.y);
    }
    if (shape.closed) ctx.closePath();
  }
}

function tsDrawBlob(ctx: CanvasRenderingContext2D, shape: ShapeRenderData): void {
  const pts = shape.points;
  if (!pts || pts.length < 3) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  const handles = shape.tangentHandles;
  if (handles && handles.length === pts.length) {
    for (let i = 0; i < pts.length; i++) {
      const next = pts[(i + 1) % pts.length], nh = handles[(i + 1) % pts.length];
      ctx.bezierCurveTo(handles[i].out.x, handles[i].out.y, nh.in.x, nh.in.y, next.x, next.y);
    }
  } else {
    for (let i = 1; i < pts.length; i++) {
      const cur = pts[i], nxt = pts[(i + 1) % pts.length];
      ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + nxt.x) / 2, (cur.y + nxt.y) / 2);
    }
  }
  ctx.closePath();
}

function tsDrawChunk(ctx: CanvasRenderingContext2D, shape: ShapeRenderData): void {
  const pts = shape.points;
  if (!pts || pts.length < 3) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  const cps = shape.controlPoints;
  if (cps && cps.length > 0) {
    for (let i = 1; i < pts.length; i++) {
      const ci = (i - 1) % cps.length;
      ctx.quadraticCurveTo(cps[ci].x, cps[ci].y, pts[i].x, pts[i].y);
    }
    ctx.quadraticCurveTo(cps[cps.length - 1].x, cps[cps.length - 1].y, pts[0].x, pts[0].y);
  } else {
    for (let i = 1; i < pts.length; i++) {
      const cur = pts[i], nxt = pts[(i + 1) % pts.length];
      ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + nxt.x) / 2, (cur.y + nxt.y) / 2);
    }
  }
  ctx.closePath();
}

function tsDrawSplineCircle(ctx: CanvasRenderingContext2D, shape: ShapeRenderData): void {
  const pts = shape.points, cps = shape.controlPoints;
  if (!pts || pts.length < 4) return;
  if (!cps || cps.length < 8) { pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); return; }
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < 4; i++) {
    const ep = pts[(i + 1) % 4], cp1 = cps[i * 2], cp2 = cps[i * 2 + 1];
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, ep.x, ep.y);
  }
  if (shape.closed !== false) ctx.closePath();
}

function tsDrawSplineRing(ctx: CanvasRenderingContext2D, shape: ShapeRenderData): void {
  const pts = shape.points, cps = shape.controlPoints;
  if (!pts || pts.length < 8) return;
  if (!cps || cps.length < 16) { pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); return; }
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < 4; i++) {
    const ep = pts[(i + 1) % 4], cp1 = cps[i * 2], cp2 = cps[i * 2 + 1];
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, ep.x, ep.y);
  }
  ctx.closePath();
  ctx.moveTo(pts[4].x, pts[4].y);
  for (let i = 0; i < 4; i++) {
    const ep = pts[4 + ((i + 1) % 4)], cp1 = cps[8 + i * 2], cp2 = cps[8 + i * 2 + 1];
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, ep.x, ep.y);
  }
  ctx.closePath();
}

function tsDrawPolygonFlat(ctx: CanvasRenderingContext2D, pts: ShapePoint[]): void {
  pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.closePath();
}

// ─── Build path (TypeScript) ──────────────────────────────────────────────────

function applyJitter(shape: ShapeRenderData, pts?: ShapePoint[], hashOffset = 0): ShapePoint[] {
  const src = pts ?? shape.points;
  if (shape.localJitterConfig?.enabled && shape.id) {
    return applyLocalJitter(src, shape.localJitterConfig, shapeIdToHash(shape.id) + hashOffset);
  }
  return src;
}

export function buildShapePath(ctx: CanvasRenderingContext2D, shape: ShapeRenderData): void {
  const t = shape.type;
  const rmo = shape.renderModeOverride;

  ctx.beginPath();

  if (t === 'line' || t === 'line-vector') {
    tsDrawLine(ctx, shape);
  } else if (t === 'spline-circle' || t === 'spline-ellipse') {
    tsDrawSplineCircle(ctx, shape);
  } else if (t === 'spline-ring') {
    tsDrawSplineRing(ctx, shape);
  } else if (t === 'bezier') {
    tsDrawBezierCurve(ctx, shape);
    if (shape.closed) ctx.closePath();
  } else if (t === 'smooth-spline') {
    tsDrawSmoothSpline(ctx, shape);
  } else if (t === 'cubic') {
    tsDrawCubicCurve(ctx, shape);
  } else if (t === 'blob') {
    tsDrawBlob(ctx, shape);
  } else if (t === 'chunk') {
    tsDrawChunk(ctx, shape);
  } else if (t === 'circle') {
    // Canonical client rule: polygonize when rmo.enabled; native arc otherwise
    if (rmo?.enabled) { drawContourWithConfig(ctx as any, applyJitter(shape), rmo); }
    else { ctx.arc(0, 0, shape.radius ?? (shape.width ?? 0) / 2, 0, Math.PI * 2); }
  } else if (t === 'ellipse') {
    if (rmo?.enabled) { drawContourWithConfig(ctx as any, applyJitter(shape), rmo); }
    else { ctx.ellipse(0, 0, (shape.width ?? 0) / 2, (shape.height ?? 0) / 2, 0, 0, Math.PI * 2); }
  } else if (t === 'rectangle' || t === 'square') {
    if (rmo?.enabled) { drawContourWithConfig(ctx as any, applyJitter(shape), rmo); }
    else { ctx.rect(-(shape.width ?? 0) / 2, -(shape.height ?? 0) / 2, shape.width ?? 0, shape.height ?? 0); }
  } else if (t === 'rounded-rectangle' || t === 'rounded-square') {
    // Canonical client rule: use drawContourWithConfig when rmo.enabled; roundRect otherwise
    if (rmo?.enabled) { drawContourWithConfig(ctx as any, applyJitter(shape), rmo); }
    else if (shape.renderType === 'roundRect' && shape.cornerRadius && (ctx as any).roundRect) {
      const w = (shape.width ?? 0) / 2, h = (shape.height ?? 0) / 2;
      (ctx as any).roundRect(-w, -h, shape.width ?? 0, shape.height ?? 0, shape.cornerRadius);
    } else { tsDrawPolygonFlat(ctx, applyJitter(shape)); }
  } else if (t === 'ring') {
    const half = Math.floor(shape.points.length / 2);
    const outerPts = applyJitter(shape, shape.points.slice(0, half), 0);
    const innerPts = applyJitter(shape, shape.points.slice(half), 999983);
    if (rmo?.enabled) {
      drawContourWithConfig(ctx as any, outerPts, rmo);
      drawContourWithConfig(ctx as any, innerPts, rmo);
    } else {
      outerPts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.closePath();
      innerPts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.closePath();
    }
  } else {
    // All other polygon shapes (triangle, hexagon, polygon, star, etc.)
    // Canonical client rule: drawContourWithConfig when rmo.enabled; flat polygon otherwise
    const pts = applyJitter(shape);
    if (rmo?.enabled) { drawContourWithConfig(ctx as any, pts, rmo); }
    else { tsDrawPolygonFlat(ctx, pts); }
  }
}

// ─── Apply fill (TypeScript) ──────────────────────────────────────────────────

export function applyShapeFill(
  ctx: CanvasRenderingContext2D,
  shape: ShapeRenderData,
  bounds: Bounds,
  createOffscreenCanvas?: OffscreenCanvasFactory,
): void {
  const t = shape.type;
  if (t === 'line') return;
  if (shape.properties.fillColor === 'none') return;
  if (shape.properties.openCurveFilled === false) return;

  ctx.globalAlpha = shape.properties.fillOpacity;

  if (shape.properties.gradient) {
    const grad = shape.properties.gradient;
    if (grad.type === 'diamond' && createOffscreenCanvas) {
      const bw = Math.max(1, Math.round(bounds.width)), bh = Math.max(1, Math.round(bounds.height));
      const offCanvas = createOffscreenCanvas(bw, bh);
      const offCtx = offCanvas.getContext('2d');
      if (offCtx) {
        const parsedStops = grad.stops.map(stop => {
          const tmp = createOffscreenCanvas(1, 1);
          const tc = tmp.getContext('2d')!;
          tc.fillStyle = stop.color;
          tc.fillRect(0, 0, 1, 1);
          const d = tc.getImageData(0, 0, 1, 1).data;
          return { offset: stop.offset, r: d[0], g: d[1], b: d[2], a: d[3] };
        }).sort((a, b) => a.offset - b.offset);
        const pixelData = calculateDiamondGradientTexture(parsedStops, bw, bh, grad.diamondCenterX ?? 50, grad.diamondCenterY ?? 50, grad.diamondAngle ?? 0, grad.diamondScale ?? 100, grad.diamondScaleEdgeMode ?? 'streak');
        const imgData = offCtx.createImageData(bw, bh);
        imgData.data.set(pixelData);
        offCtx.putImageData(imgData, 0, 0);
        const pattern = ctx.createPattern(offCanvas as any, 'no-repeat');
        if (pattern) {
          // DOMMatrix is available in browsers and Node ≥ 19; fall back to SVGMatrix-like
          // plain object (accepted by node-canvas pattern.setTransform) for older Node.
          if (typeof DOMMatrix !== 'undefined') {
            pattern.setTransform(new DOMMatrix().translateSelf(bounds.x, bounds.y));
          } else {
            (pattern as any).setTransform({ a: 1, b: 0, c: 0, d: 1, e: bounds.x, f: bounds.y });
          }
          ctx.fillStyle = pattern;
        } else {
          ctx.fillStyle = grad.stops[0]?.color ?? '#000000';
        }
      } else {
        ctx.fillStyle = grad.stops[0]?.color ?? '#000000';
      }
    } else if (grad.type === 'diamond') {
      ctx.fillStyle = grad.stops[0]?.color ?? '#000000';
    } else if (grad.type === 'linear') {
      const coords = calculateLinearGradientCoords(bounds, grad.angle ?? 0, grad.linearCenterX ?? 50, grad.linearCenterY ?? 50, grad.linearScale ?? 100);
      const g = ctx.createLinearGradient(coords.x1, coords.y1, coords.x2, coords.y2);
      grad.stops.forEach(s => g.addColorStop(s.offset, s.color));
      ctx.fillStyle = g;
    } else if (grad.type === 'conic') {
      const coords = calculateConicGradientCoords(bounds, grad.conicCenterX ?? 50, grad.conicCenterY ?? 50, grad.conicAngle ?? 0);
      try {
        if (typeof (ctx as any).createConicGradient === 'function') {
          const g = (ctx as any).createConicGradient(coords.startAngle, coords.centerX, coords.centerY);
          grad.stops.forEach((s: any) => g.addColorStop(s.offset, s.color));
          ctx.fillStyle = g;
        } else {
          const coords2 = calculateRadialGradientCoords(bounds, grad.conicCenterX ?? 50, grad.conicCenterY ?? 50);
          const g = ctx.createRadialGradient(coords2.centerX, coords2.centerY, coords2.innerRadius, coords2.centerX, coords2.centerY, coords2.outerRadius);
          grad.stops.forEach((s: any) => g.addColorStop(s.offset, s.color));
          ctx.fillStyle = g;
        }
      } catch {
        const coords2 = calculateRadialGradientCoords(bounds, 50, 50);
        const g = ctx.createRadialGradient(coords2.centerX, coords2.centerY, coords2.innerRadius, coords2.centerX, coords2.centerY, coords2.outerRadius);
        grad.stops.forEach((s: any) => g.addColorStop(s.offset, s.color));
        ctx.fillStyle = g;
      }
    } else {
      const coords = calculateRadialGradientCoords(bounds, grad.radialCenterX ?? 50, grad.radialCenterY ?? 50, grad.radialScale ?? 100);
      const g = ctx.createRadialGradient(coords.centerX, coords.centerY, coords.innerRadius, coords.centerX, coords.centerY, coords.outerRadius);
      grad.stops.forEach(s => g.addColorStop(s.offset, s.color));
      ctx.fillStyle = g;
    }
  } else {
    ctx.fillStyle = shape.properties.fillColor;
  }

  if (t === 'ring' || t === 'spline-ring') {
    ctx.fill('evenodd');
  } else {
    ctx.fill();
  }
}

// ─── Squiggle stroke helpers (TypeScript) ────────────────────────────────────

// LCG deterministic pseudo-random → 0..1
function _sqLcg(seed: number): number {
  const s = (Math.imul(1664525, seed | 0) + 1013904223) | 0;
  return ((s >>> 0) & 0x7fffffff) / 0x7fffffff;
}

// Smooth coherent noise at normalised position pos ∈ [0,1] over nPts lattice
function _sqNoise(pos: number, nPts: number, seed: number): number {
  const scaled = pos * nPts;
  const i0 = Math.floor(scaled);
  const frac = scaled - i0;
  const cf = (1 - Math.cos(frac * Math.PI)) * 0.5;
  const a = _sqLcg(seed * 7919 + (i0 & 0x3fff)) * 2 - 1;
  const b = _sqLcg(seed * 7919 + ((i0 + 1) & 0x3fff)) * 2 - 1;
  return a * (1 - cf) + b * cf;
}

// Rolling-average smooth; w = half-window. isOpen = clamp endpoints instead of wrap.
function _sqSmooth(pts: { x: number; y: number }[], w: number, isOpen = false): { x: number; y: number }[] {
  if (w <= 0) return pts;
  const n = pts.length;
  const cnt = 2 * w + 1;
  return pts.map((_, i) => {
    let sx = 0, sy = 0;
    for (let d = -w; d <= w; d++) {
      const j = isOpen ? Math.max(0, Math.min(n - 1, i + d)) : (i + d + n) % n;
      sx += pts[j].x; sy += pts[j].y;
    }
    return { x: sx / cnt, y: sy / cnt };
  });
}

// Evaluate bezier/cubic curve into dense polyline via tangentHandles or controlPoints.
// Falls back to shape.points for shapes that are already a polygon boundary.
function _evaluateShapeCurve(shape: ShapeRenderData, targetCount: number): ShapePoint[] {
  const pts = shape.points;
  if (!pts || pts.length < 2) return pts ?? [];
  const handles = shape.tangentHandles;
  const cps = shape.controlPoints;
  const closed = shape.closed !== false;
  if (handles && handles.length >= pts.length) {
    const segCount = closed ? pts.length : pts.length - 1;
    if (segCount < 1) return pts;
    const sps = Math.max(4, Math.ceil(targetCount / segCount));
    const out: ShapePoint[] = [];
    for (let i = 0; i < segCount; i++) {
      const p0 = pts[i], p3 = pts[(i + 1) % pts.length];
      const h0 = handles[i], h1 = handles[(i + 1) % pts.length];
      const cp1 = h0?.out ?? p0, cp2 = h1?.in ?? p3;
      for (let j = 0; j < sps; j++) {
        const t = j / sps, u = 1 - t;
        out.push({ x: u*u*u*p0.x + 3*u*u*t*cp1.x + 3*u*t*t*cp2.x + t*t*t*p3.x,
                   y: u*u*u*p0.y + 3*u*u*t*cp1.y + 3*u*t*t*cp2.y + t*t*t*p3.y });
      }
    }
    if (!closed) out.push({ ...pts[pts.length - 1] });
    return out;
  }
  if (cps && cps.length >= (pts.length - 1) * 2) {
    const hasWrapSeg = closed && cps.length >= pts.length * 2;
    const segCount = hasWrapSeg ? pts.length : pts.length - 1;
    const sps = Math.max(4, Math.ceil(targetCount / segCount));
    const out: ShapePoint[] = [];
    for (let i = 0; i < segCount; i++) {
      const p0 = pts[i], p3 = pts[(i + 1) % pts.length];
      const cp1 = cps[i * 2] ?? p0, cp2 = cps[i * 2 + 1] ?? p3;
      for (let j = 0; j < sps; j++) {
        const t = j / sps, u = 1 - t;
        out.push({ x: u*u*u*p0.x + 3*u*u*t*cp1.x + 3*u*t*t*cp2.x + t*t*t*p3.x,
                   y: u*u*u*p0.y + 3*u*u*t*cp1.y + 3*u*t*t*cp2.y + t*t*t*p3.y });
      }
    }
    if (!hasWrapSeg) out.push({ ...pts[pts.length - 1] });
    return out;
  }
  return pts;
}

// Estimate sample count from shape perimeter, frequency, and align.
// More perimeter → more samples; lower align → hugs shape boundary → needs more for smooth result.
function _sqAutoCount(rawPts: { x: number; y: number }[], frequency: number, align: number): number {
  let perim = 0;
  for (let i = 0; i < rawPts.length - 1; i++)
    perim += Math.hypot(rawPts[i + 1].x - rawPts[i].x, rawPts[i + 1].y - rawPts[i].y);
  const alignFactor = 1 + (1 - Math.max(0, Math.min(100, align)) / 100) * 0.5;
  return Math.max(128, Math.min(4096, Math.ceil(Math.max(perim * 0.2, frequency * 24) * alignFactor)));
}

function drawSquiggleStrokeShared(ctx: CanvasRenderingContext2D, shape: ShapeRenderData): void {
  const amplitude  = shape.strokeSquiggleAmplitude  ?? 4;
  const frequency  = shape.strokeSquiggleFrequency  ?? 1;
  const phase      = shape.strokeSquigglePhase      ?? 0;
  const align      = shape.strokeSquiggleAlign      ?? 100;
  const absWave    = shape.strokeSquiggleAbs        ?? false;
  const flipWave   = shape.strokeSquiggleFlip       ?? false;
  const jitter     = shape.strokeSquiggleJitter     ?? 0;
  const jSeed      = shape.strokeSquiggleJitterSeed ?? 0;
  const noise      = shape.strokeSquiggleNoise      ?? 0;
  const noiseFreq  = shape.strokeSquiggleNoiseFreq  ?? 1;
  const jMode      = shape.strokeSquiggleJitterMode ?? 'normal';

  const isOpen = shape.closed === false;
  const rawPts = _evaluateShapeCurve(shape, 512);
  if (!rawPts || rawPts.length < 2) return;
  const sampleCount = shape.strokeSquiggleSampleCount ?? _sqAutoCount(rawPts, frequency, align);
  let pts = isOpen ? resampleOpenContour(rawPts, sampleCount) : resampleContour(rawPts, sampleCount);
  const n = pts.length;
  if (n < 2) return;

  // Shape-align: smooth the baseline (align=100 → exact shape, align=0 → max smooth)
  const smoothW = Math.round((1 - align / 100) * n * 0.15);
  if (smoothW > 0) pts = _sqSmooth(pts, smoothW, isOpen);

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

    // Sine wave
    const sinOff = amplitude * Math.sin(2 * Math.PI * frequency * t + phase);

    // Per-point jitter (seeded LCG)
    const jRaw  = jitter > 0 ? (_sqLcg(jSeed * 65537 + i) * 2 - 1) * jitter : 0;
    const jRawX = (jitter > 0 && jMode === 'xy') ? (_sqLcg(jSeed * 65537 + i + 99991) * 2 - 1) * jitter : 0;
    const jRawY = (jitter > 0 && jMode === 'xy') ? (_sqLcg(jSeed * 65537 + i + 199933) * 2 - 1) * jitter : 0;

    // Coherent noise
    const nRaw  = noise > 0 ? _sqNoise(t, noiseLattice, jSeed + 1) * noise : 0;
    const nRawX = (noise > 0 && jMode === 'xy') ? _sqNoise(t, noiseLattice, jSeed + 2) * noise : 0;
    const nRawY = (noise > 0 && jMode === 'xy') ? _sqNoise(t, noiseLattice, jSeed + 3) * noise : 0;

    // abs/flip apply to the combined offset (sine + jitter + noise)
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
  // Only apply smooth bezier when the shape has actual curve data (handles or control points)
  const _hasCurveData = !!((shape.tangentHandles && shape.tangentHandles.length) || (shape.controlPoints && shape.controlPoints.length));
  const smoothCurves = _hasCurveData && shape.strokeSquiggleSmoothCurves !== false;
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

// ─── Apply stroke (TypeScript) ────────────────────────────────────────────────

export function applyShapeStroke(ctx: CanvasRenderingContext2D, shape: ShapeRenderData): void {
  if (shape.properties.strokeColor === 'none' || !(shape.properties.strokeWidth > 0)) return;
  ctx.globalAlpha = shape.properties.strokeOpacity;
  ctx.strokeStyle = shape.properties.strokeColor;
  ctx.lineWidth = shape.properties.strokeWidth;
  if (shape.strokeCap) ctx.lineCap = shape.strokeCap;
  const pat = shape.strokePattern ?? 'none';
  if (pat === 'squiggle') {
    ctx.lineCap = shape.strokeCap ?? 'round';
    (ctx as any).setLineDash([]);
    drawSquiggleStrokeShared(ctx, shape);
    return;
  }
  if (pat === 'dash') {
    (ctx as any).setLineDash([shape.strokeDashLength ?? 10, shape.strokeDashGap ?? 6]);
  } else if (pat === 'dot') {
    ctx.lineCap = 'round';
    (ctx as any).setLineDash([0.5, shape.strokeDotSpacing ?? 8]);
  } else {
    (ctx as any).setLineDash([]);
  }
  ctx.stroke();
  (ctx as any).setLineDash([]);
}

// ─── Main TypeScript draw function ────────────────────────────────────────────

/**
 * Draw shape path + fill + stroke onto ctx, without applying any transforms.
 * The caller is responsible for setting up translate/rotate/scale/skew before
 * calling this function (same contract as canvasRenderer.drawShape).
 */
export function drawShapeToContext(
  ctx: CanvasRenderingContext2D,
  shape: ShapeRenderData,
  createOffscreenCanvas?: OffscreenCanvasFactory,
): void {
  buildShapePath(ctx, shape);
  const bounds = getShapeBoundsFromPoints(shape.points);
  applyShapeFill(ctx, shape, bounds, createOffscreenCanvas);
  applyShapeStroke(ctx, shape);
  // Wire pass is intentionally excluded here — callers own the wire pass so they
  // can apply it outside shape transforms/effects contexts to avoid distortion.
}

// ─── SHAPE_RENDERER_JS ────────────────────────────────────────────────────────
// Plain JavaScript string for injection into Puppeteer export HTML pages.
// Assumes RENDER_MODE_UTILS_JS is already injected (provides addSmooth,
// drawContourWithConfig, drawWirePass, applyCatmullRom, applyNaturalCubicSpline,
// resampleContour).  Also assumes a RENDER_DATA global exists.
//
// Includes:
//   getShapeBounds(points)          — bounding-box helper
//   drawPolygon(ctx, pts)           — flat polygon (lineTo)
//   drawPolygonRing(ctx, pts)       — outer + inner ring contours
//   drawLine(ctx, shape)            — line with rmo support
//   drawSmoothSpline(ctx, shape)    — smooth-spline / fallback catmull-rom
//   drawCubicCurve(ctx, shape)      — cubic with tangent handles
//   drawBezierCurve(ctx, shape)     — bezier with control points / tangent handles
//   drawBlob(ctx, shape)            — blob with tangent handles
//   drawChunk(ctx, shape)           — chunk with control points
//   drawSplineCircle(ctx,pts,cps,closed)
//   drawSplineRing(ctx,pts,cps)
//   _calcDiamondTexture(...)        — Chebyshev L∞ diamond gradient pixel data
//   _applyDiamondFill(ctx,bnds,g)   — diamond gradient via browser document.createElement
//   renderShape(ctx, shape)         — complete render (path + fill + stroke + wire)

export const SHAPE_RENDERER_JS: string = `
${SHAPE_BLUR_JS}
function getShapeBounds(points) {
  if (!points || points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (var i = 0; i < points.length; i++) {
    if (points[i].x < minX) minX = points[i].x; if (points[i].x > maxX) maxX = points[i].x;
    if (points[i].y < minY) minY = points[i].y; if (points[i].y > maxY) maxY = points[i].y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function drawPolygon(ctx, points) {
  if (!points || points.length === 0) return;
  for (var i = 0; i < points.length; i++) {
    if (i === 0) ctx.moveTo(points[i].x, points[i].y); else ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
}

function drawPolygonRing(ctx, points) {
  var half = Math.floor(points.length / 2);
  var outer = points.slice(0, half), inner = points.slice(half);
  for (var i = 0; i < outer.length; i++) {
    if (i === 0) ctx.moveTo(outer[i].x, outer[i].y); else ctx.lineTo(outer[i].x, outer[i].y);
  }
  ctx.closePath();
  for (var j = 0; j < inner.length; j++) {
    if (j === 0) ctx.moveTo(inner[j].x, inner[j].y); else ctx.lineTo(inner[j].x, inner[j].y);
  }
  ctx.closePath();
}

// ─── Jitter helpers (full parity with shared/roughnessUtils.ts) ──────────────
// Inlines simplex-noise createNoise2D so Puppeteer path matches TS exactly.
function _hashStr(str) {
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h;
}
function _mulberry32(seed) {
  return function() {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// simplex-noise buildPermutationTable (MIT © Jonas Wagner)
function _buildPermTable(random) {
  var tableSize = 512, p = new Uint8Array(tableSize);
  for (var i = 0; i < 256; i++) p[i] = i;
  for (var i = 0; i < 255; i++) { var r = i + ~~(random() * (256 - i)), aux = p[i]; p[i] = p[r]; p[r] = aux; }
  for (var i = 256; i < tableSize; i++) p[i] = p[i - 256];
  return p;
}
// simplex-noise createNoise2D (MIT © Jonas Wagner)
function _createNoise2D(random) {
  var SQRT3 = Math.sqrt(3), F2 = 0.5*(SQRT3-1), G2 = (3-SQRT3)/6;
  var g2 = new Float64Array([1,1,-1,1,1,-1,-1,-1,1,0,-1,0,1,0,-1,0,0,1,0,-1,0,1,0,-1]);
  var perm = _buildPermTable(random);
  var pgx = new Float64Array(perm).map(function(v){ return g2[(v%12)*2]; });
  var pgy = new Float64Array(perm).map(function(v){ return g2[(v%12)*2+1]; });
  return function(x, y) {
    var n0=0,n1=0,n2=0;
    var s=(x+y)*F2, i=Math.floor(x+s)|0, j=Math.floor(y+s)|0;
    var t=(i+j)*G2, X0=i-t, Y0=j-t, x0=x-X0, y0=y-Y0;
    var i1=x0>y0?1:0, j1=x0>y0?0:1;
    var x1=x0-i1+G2, y1=y0-j1+G2, x2=x0-1+2*G2, y2=y0-1+2*G2;
    var ii=i&255, jj=j&255;
    var t0=0.5-x0*x0-y0*y0;
    if(t0>=0){var gi0=ii+perm[jj];t0*=t0;n0=t0*t0*(pgx[gi0]*x0+pgy[gi0]*y0);}
    var t1=0.5-x1*x1-y1*y1;
    if(t1>=0){var gi1=ii+i1+perm[jj+j1];t1*=t1;n1=t1*t1*(pgx[gi1]*x1+pgy[gi1]*y1);}
    var t2=0.5-x2*x2-y2*y2;
    if(t2>=0){var gi2=ii+1+perm[jj+1];t2*=t2;n2=t2*t2*(pgx[gi2]*x2+pgy[gi2]*y2);}
    return 70*(n0+n1+n2);
  };
}
function _makeNoise2D(seed) { return _createNoise2D(_mulberry32(seed)); }
function _octaveNoise(noise2D, x, y, octaves, lacunarity, gain) {
  var value=0, amplitude=1, frequency=1, maxValue=0;
  for (var i=0; i<octaves; i++) {
    value+=noise2D(x*frequency, y*frequency)*amplitude;
    maxValue+=amplitude; amplitude*=gain; frequency*=lacunarity;
  }
  return maxValue>0 ? value/maxValue : 0;
}
function _resamplePath(points, density) {
  if (points.length < 2 || density <= 0) return points;
  var result=[], n=points.length, maxLen=1/density;
  for (var i=0; i<n; i++) {
    var a=points[i], b=points[(i+1)%n]; result.push(a);
    var dx=b.x-a.x, dy=b.y-a.y, edgeLen=Math.sqrt(dx*dx+dy*dy);
    if (edgeLen>maxLen) {
      var sub=Math.ceil(edgeLen/maxLen);
      for (var j=1; j<sub; j++) { var tt=j/sub; result.push({x:a.x+dx*tt, y:a.y+dy*tt}); }
    }
  }
  return result;
}
function _applyLocalJitter(pts, cfg, hash) {
  if (!cfg || !cfg.enabled || pts.length===0) return pts;
  var src = cfg.resampleEnabled ? _resamplePath(pts, cfg.resampleDensity) : pts;
  if (!cfg.enabledX && !cfg.enabledY && !cfg.enabledZ) return src;
  var n=src.length;
  var noise2D = cfg.driver==='simplex' ? _makeNoise2D(hash) : null;
  return src.map(function(pt, vi) {
    var dispX=0, dispY=0;
    if (cfg.enabledX) {
      var rx;
      if (noise2D) { rx=_octaveNoise(noise2D, pt.x*cfg.scale, pt.y*cfg.scale, cfg.octaves, cfg.lacunarity, cfg.gain); }
      else { rx=(_mulberry32((hash+vi*2654435761)>>>0)()*2)-1; }
      if (cfg.modeX==='from-center') { var d=Math.sqrt(pt.x*pt.x+pt.y*pt.y); rx=d>0?rx*(pt.x/d):0; }
      if (cfg.positiveOnlyX) rx=Math.abs(rx); if (cfg.reverseX) rx=-rx;
      dispX=rx*cfg.amountX;
    }
    if (cfg.enabledY) {
      var ry;
      if (noise2D) { ry=_octaveNoise(noise2D, pt.y*cfg.scale, pt.x*cfg.scale, cfg.octaves, cfg.lacunarity, cfg.gain); }
      else { ry=(_mulberry32((hash+vi*2654435761+1)>>>0)()*2)-1; }
      if (cfg.modeY==='from-center') { var d=Math.sqrt(pt.x*pt.x+pt.y*pt.y); ry=d>0?ry*(pt.y/d):0; }
      if (cfg.positiveOnlyY) ry=Math.abs(ry); if (cfg.reverseY) ry=-ry;
      dispY=ry*cfg.amountY;
    }
    if (cfg.enabledZ && n>=2) {
      var nxt=src[(vi+1)%n], prv=src[(vi-1+n)%n];
      var tdx=nxt.x-prv.x, tdy=nxt.y-prv.y, tLen=Math.sqrt(tdx*tdx+tdy*tdy);
      if (tLen>0) {
        var rz;
        if (noise2D) { rz=_octaveNoise(noise2D, pt.x*cfg.scale+100, pt.y*cfg.scale+100, cfg.octaves, cfg.lacunarity, cfg.gain); }
        else { rz=(_mulberry32((hash+vi*2654435761+2)>>>0)()*2)-1; }
        if (cfg.positiveOnlyZ) rz=Math.abs(rz); if (cfg.reverseZ) rz=-rz;
        dispX+=(tdx/tLen)*rz*cfg.amountZ; dispY+=(tdy/tLen)*rz*cfg.amountZ;
      }
    }
    return { x:pt.x+dispX, y:pt.y+dispY };
  });
}
function _jitter(shape, pts, hashOffset) {
  var src = pts || shape.points;
  var cfg = shape.localJitterConfig;
  if (cfg && cfg.enabled && shape.id) {
    return _applyLocalJitter(src, cfg, _hashStr(shape.id) + (hashOffset || 0));
  }
  return src;
}

function drawLine(ctx, shape) {
  var pts = shape.points;
  if (!pts || pts.length < 2) return;
  var rmo = shape.renderModeOverride;
  if (rmo && rmo.enabled) {
    if (rmo.smoothAlgorithm === 'catmull-rom') {
      applyCatmullRom(ctx, pts, rmo.catmullAlpha != null ? rmo.catmullAlpha : 0.5, false, rmo.tension != null ? rmo.tension : 1);
      return;
    }
    if (rmo.smoothAlgorithm === 'natural-cubic') {
      applyNaturalCubicSpline(ctx, pts, false, rmo.naturalCubicClamped || false);
      return;
    }
  }
  for (var i = 0; i < pts.length; i++) {
    if (i === 0) ctx.moveTo(pts[i].x, pts[i].y); else ctx.lineTo(pts[i].x, pts[i].y);
  }
}

function drawSmoothSpline(ctx, shape) {
  var pts = shape.points;
  if (!pts || pts.length < 2) return;
  var rmo = shape.renderModeOverride;
  if (rmo && rmo.enabled) {
    if (rmo.smoothAlgorithm === 'catmull-rom') {
      applyCatmullRom(ctx, pts, rmo.catmullAlpha != null ? rmo.catmullAlpha : 0.5, shape.closed || false, rmo.tension != null ? rmo.tension : 1);
      return;
    }
    if (rmo.smoothAlgorithm === 'natural-cubic') {
      applyNaturalCubicSpline(ctx, pts, shape.closed || false, rmo.naturalCubicClamped || false);
      return;
    }
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  var handles = shape.tangentHandles;
  if (handles && handles.length >= pts.length) {
    for (var i = 0; i < pts.length - 1; i++) {
      ctx.bezierCurveTo(handles[i].out.x, handles[i].out.y, handles[i+1].in.x, handles[i+1].in.y, pts[i+1].x, pts[i+1].y);
    }
    if (shape.closed && pts.length > 2) {
      var li = pts.length - 1;
      ctx.bezierCurveTo(handles[li].out.x, handles[li].out.y, handles[0].in.x, handles[0].in.y, pts[0].x, pts[0].y);
    }
  } else {
    for (var i = 1; i < pts.length; i++) {
      var p0 = pts[i-2] || pts[i-1], p1 = pts[i-1], p2 = pts[i], p3 = pts[i+1] || pts[i];
      ctx.bezierCurveTo(p1.x+(p2.x-p0.x)*0.3, p1.y+(p2.y-p0.y)*0.3, p2.x-(p3.x-p1.x)*0.3, p2.y-(p3.y-p1.y)*0.3, p2.x, p2.y);
    }
  }
  if (shape.closed) ctx.closePath();
}

function drawCubicCurve(ctx, shape) {
  var pts = shape.points;
  if (!pts || pts.length < 2) return;
  var rmo = shape.renderModeOverride;
  if (rmo && rmo.enabled) {
    if (rmo.smoothAlgorithm === 'catmull-rom') { applyCatmullRom(ctx, pts, rmo.catmullAlpha != null ? rmo.catmullAlpha : 0.5, shape.closed || false, rmo.tension != null ? rmo.tension : 1); return; }
    if (rmo.smoothAlgorithm === 'natural-cubic') { applyNaturalCubicSpline(ctx, pts, shape.closed || false, rmo.naturalCubicClamped || false); return; }
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  var handles = shape.tangentHandles;
  if (handles && handles.length > 0) {
    for (var i = 0; i < pts.length - 1; i++) {
      var h1 = handles[i], h2 = handles[i+1];
      if (h1 && h2 && h1.out && h2.in) ctx.bezierCurveTo(h1.out.x, h1.out.y, h2.in.x, h2.in.y, pts[i+1].x, pts[i+1].y);
      else ctx.lineTo(pts[i+1].x, pts[i+1].y);
    }
  } else {
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }
  if (shape.closed) ctx.closePath();
}

function drawBezierCurve(ctx, shape) {
  var pts = shape.points;
  if (!pts || pts.length < 2) return;
  var rmo = shape.renderModeOverride;
  if (rmo && rmo.enabled) {
    if (rmo.smoothAlgorithm === 'catmull-rom') { applyCatmullRom(ctx, pts, rmo.catmullAlpha != null ? rmo.catmullAlpha : 0.5, shape.closed || false, rmo.tension != null ? rmo.tension : 1); return; }
    if (rmo.smoothAlgorithm === 'natural-cubic') { applyNaturalCubicSpline(ctx, pts, shape.closed || false, rmo.naturalCubicClamped || false); return; }
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  var cps = shape.controlPoints, handles = shape.tangentHandles;
  var n = pts.length;
  // "Average endpoints" close mode moves the first & last point to a shared
  // midpoint; in that case the segments already close on themselves, so a wrap
  // segment would trace a redundant loop. Detect coincident endpoints and skip it.
  var closeCoincident = n > 1 && Math.abs(pts[n-1].x - pts[0].x) < 1e-6 && Math.abs(pts[n-1].y - pts[0].y) < 1e-6;
  if (cps && cps.length >= (n - 1) * 2) {
    for (var i = 1; i < n; i++) {
      var ci1 = (i-1)*2, ci2 = ci1+1;
      if (ci1 < cps.length && ci2 < cps.length) ctx.bezierCurveTo(cps[ci1].x, cps[ci1].y, cps[ci2].x, cps[ci2].y, pts[i].x, pts[i].y);
      else ctx.lineTo(pts[i].x, pts[i].y);
    }
    // Closed bezier: draw the wrap-around segment as a real curve when control
    // points for it exist, otherwise fall back to a straight close.
    if (shape.closed) {
      var cc1 = (n-1)*2, cc2 = cc1+1;
      if (n > 2 && !closeCoincident && cc2 < cps.length) ctx.bezierCurveTo(cps[cc1].x, cps[cc1].y, cps[cc2].x, cps[cc2].y, pts[0].x, pts[0].y);
      else ctx.closePath();
    }
  } else if (handles && handles.length >= n) {
    for (var i = 0; i < n - 1; i++) {
      var h1 = handles[i], h2 = handles[i+1];
      if (h1 && h2 && h1.out && h2.in) ctx.bezierCurveTo(h1.out.x, h1.out.y, h2.in.x, h2.in.y, pts[i+1].x, pts[i+1].y);
      else ctx.lineTo(pts[i+1].x, pts[i+1].y);
    }
    // Closed bezier: draw the wrap-around segment (last point -> first point)
    // as a real curve using the wrap tangents instead of a straight closePath.
    if (shape.closed) {
      var hl = handles[n-1], hf = handles[0];
      if (n > 2 && !closeCoincident && hl && hf && hl.out && hf.in) ctx.bezierCurveTo(hl.out.x, hl.out.y, hf.in.x, hf.in.y, pts[0].x, pts[0].y);
      else ctx.closePath();
    }
  } else {
    for (var i = 1; i < n; i++) {
      var prev = pts[i-1], cur = pts[i], next = pts[i+1] || (shape.closed ? pts[0] : cur);
      ctx.quadraticCurveTo(cur.x+(next.x-prev.x)*0.3, cur.y+(next.y-prev.y)*0.3, cur.x, cur.y);
    }
    if (shape.closed) ctx.closePath();
  }
}

function drawBlob(ctx, shape) {
  var pts = shape.points;
  if (!pts || pts.length < 3) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  var handles = shape.tangentHandles;
  if (handles && handles.length === pts.length) {
    for (var i = 0; i < pts.length; i++) {
      var next = pts[(i+1)%pts.length], nh = handles[(i+1)%pts.length];
      ctx.bezierCurveTo(handles[i].out.x, handles[i].out.y, nh.in.x, nh.in.y, next.x, next.y);
    }
  } else {
    for (var i = 1; i < pts.length; i++) {
      var cur = pts[i], nxt = pts[(i+1)%pts.length];
      ctx.quadraticCurveTo(cur.x, cur.y, (cur.x+nxt.x)/2, (cur.y+nxt.y)/2);
    }
  }
  ctx.closePath();
}

function drawChunk(ctx, shape) {
  var pts = shape.points;
  if (!pts || pts.length < 3) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  var cps = shape.controlPoints;
  if (cps && cps.length > 0) {
    for (var i = 1; i < pts.length; i++) {
      var ci = (i-1) % cps.length;
      ctx.quadraticCurveTo(cps[ci].x, cps[ci].y, pts[i].x, pts[i].y);
    }
    ctx.quadraticCurveTo(cps[cps.length-1].x, cps[cps.length-1].y, pts[0].x, pts[0].y);
  } else {
    for (var i = 1; i < pts.length; i++) {
      var cur = pts[i], nxt = pts[(i+1)%pts.length];
      ctx.quadraticCurveTo(cur.x, cur.y, (cur.x+nxt.x)/2, (cur.y+nxt.y)/2);
    }
  }
  ctx.closePath();
}

function drawSplineCircle(ctx, points, controlPoints, closed) {
  if (!points || points.length < 4) return;
  if (!controlPoints || controlPoints.length < 8) { drawPolygon(ctx, points); return; }
  ctx.moveTo(points[0].x, points[0].y);
  for (var i = 0; i < 4; i++) {
    var ep = points[(i+1)%4], cp1 = controlPoints[i*2], cp2 = controlPoints[i*2+1];
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, ep.x, ep.y);
  }
  if (closed !== false) ctx.closePath();
}

function drawSplineRing(ctx, points, controlPoints) {
  if (!points || points.length < 8) return;
  if (!controlPoints || controlPoints.length < 16) { drawPolygon(ctx, points); return; }
  ctx.moveTo(points[0].x, points[0].y);
  for (var i = 0; i < 4; i++) {
    var ep = points[(i+1)%4], cp1 = controlPoints[i*2], cp2 = controlPoints[i*2+1];
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, ep.x, ep.y);
  }
  ctx.closePath();
  ctx.moveTo(points[4].x, points[4].y);
  for (var i = 0; i < 4; i++) {
    var ep = points[4+((i+1)%4)], cp1 = controlPoints[8+i*2], cp2 = controlPoints[8+i*2+1];
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, ep.x, ep.y);
  }
  ctx.closePath();
}

// Diamond gradient — Chebyshev L∞ distance, matches Photoshop diamond algorithm
function _calcDiamondTexture(parsedStops, w, h, cxPct, cyPct, angleDeg, scalePct, edgeMode) {
  var bw = Math.max(1, w|0), bh = Math.max(1, h|0);
  var data = new Uint8ClampedArray(bw * bh * 4);
  var cx = bw * cxPct / 100, cy = bh * cyPct / 100;
  var halfW = Math.max(1, Math.max(cx, bw-cx)), halfH = Math.max(1, Math.max(cy, bh-cy));
  var rad = ((angleDeg || 0) * Math.PI) / 180;
  var cosA = Math.cos(rad), sinA = Math.sin(rad);
  var useRot = angleDeg && angleDeg !== 0;
  var ns = parsedStops.length;
  for (var py = 0; py < bh; py++) {
    for (var px = 0; px < bw; px++) {
      var tx, ty;
      if (useRot) {
        var dx = px-cx, dy = py-cy;
        tx = Math.abs(dx*cosA + dy*sinA) / halfW;
        ty = Math.abs(-dx*sinA + dy*cosA) / halfH;
      } else {
        tx = Math.abs(px-cx)/halfW;
        ty = Math.abs(py-cy)/halfH;
      }
      var rawT = Math.max(tx, ty) * (100 / Math.max(1, scalePct || 100));
      // Keep the neutral/default scale identical to the historical one-shot
      // gradient even when repeat is selected; repeat only applies below 100%.
      var t = edgeMode === 'repeat' && (scalePct || 100) < 100 ? ((rawT % 1) + 1) % 1 : Math.min(1, Math.max(0, rawT));
      var r=0, g=0, b=0, a=0;
      if (ns > 0) {
        if (ns === 1 || t <= parsedStops[0].offset) { r=parsedStops[0].r; g=parsedStops[0].g; b=parsedStops[0].b; a=parsedStops[0].a; }
        else if (t >= parsedStops[ns-1].offset) { r=parsedStops[ns-1].r; g=parsedStops[ns-1].g; b=parsedStops[ns-1].b; a=parsedStops[ns-1].a; }
        else {
          for (var s = 0; s < ns-1; s++) {
            if (t >= parsedStops[s].offset && t <= parsedStops[s+1].offset) {
              var range = parsedStops[s+1].offset - parsedStops[s].offset;
              var f = range > 0 ? (t - parsedStops[s].offset) / range : 0;
              r = Math.round(parsedStops[s].r + f*(parsedStops[s+1].r-parsedStops[s].r));
              g = Math.round(parsedStops[s].g + f*(parsedStops[s+1].g-parsedStops[s].g));
              b = Math.round(parsedStops[s].b + f*(parsedStops[s+1].b-parsedStops[s].b));
              a = Math.round(parsedStops[s].a + f*(parsedStops[s+1].a-parsedStops[s].a));
              break;
            }
          }
        }
      }
      var idx = (py*bw+px)*4;
      data[idx]=r; data[idx+1]=g; data[idx+2]=b; data[idx+3]=a;
    }
  }
  return data;
}

function _applyDiamondFill(ctx, bounds, gradient) {
  var bw = Math.max(1, Math.round(bounds.width)), bh = Math.max(1, Math.round(bounds.height));
  var parsedStops = gradient.stops.map(function(stop) {
    var tmp = document.createElement('canvas'); tmp.width = 1; tmp.height = 1;
    var tc = tmp.getContext('2d'); tc.fillStyle = stop.color; tc.fillRect(0, 0, 1, 1);
    var d = tc.getImageData(0, 0, 1, 1).data;
    return { offset: stop.offset, r: d[0], g: d[1], b: d[2], a: d[3] };
  }).sort(function(a, b) { return a.offset - b.offset; });
  var pixelData = _calcDiamondTexture(parsedStops, bw, bh,
    gradient.diamondCenterX != null ? gradient.diamondCenterX : 50,
    gradient.diamondCenterY != null ? gradient.diamondCenterY : 50,
    gradient.diamondAngle != null ? gradient.diamondAngle : 0,
    gradient.diamondScale != null ? gradient.diamondScale : 100,
    gradient.diamondScaleEdgeMode || 'streak');
  var offCanvas = document.createElement('canvas'); offCanvas.width = bw; offCanvas.height = bh;
  var offCtx = offCanvas.getContext('2d');
  var imgData = offCtx.createImageData(bw, bh);
  imgData.data.set(pixelData);
  offCtx.putImageData(imgData, 0, 0);
  var pattern = ctx.createPattern(offCanvas, 'no-repeat');
  if (pattern) {
    pattern.setTransform(new DOMMatrix().translateSelf(bounds.x, bounds.y));
    ctx.fillStyle = pattern;
  } else {
    ctx.fillStyle = gradient.stops[0] ? gradient.stops[0].color : '#000000';
  }
}

function renderBlurredShape(ctx, shape) {
  var radius = shape.properties.blurRadius;
  var originX = RENDER_DATA.originX !== undefined ? RENDER_DATA.originX : (RENDER_DATA.artboard.x || 0);
  var originY = RENDER_DATA.originY !== undefined ? RENDER_DATA.originY : (RENDER_DATA.artboard.y || 0);
  var matrix = ctx.getTransform()
    .translate(shape.transform.x - originX, shape.transform.y - originY)
    .rotate(shape.transform.rotation || 0)
    .scale(shape.transform.scaleX || 1, shape.transform.scaleY || 1)
    .multiply(new DOMMatrix([1, shape.transform.skewX || 0, shape.transform.skewY || 0, 1, 0, 0]));
  var blurPoints = shape.points.slice();
  if (shape.controlPoints) blurPoints.push.apply(blurPoints, shape.controlPoints);
  if (shape.tangentHandles) shape.tangentHandles.forEach(function(handle) {
    blurPoints.push(handle.in, handle.out);
  });
  var bounds = getShapeBounds(blurPoints);
  var corners = [
    matrix.transformPoint({ x: bounds.x, y: bounds.y }),
    matrix.transformPoint({ x: bounds.x + bounds.width, y: bounds.y }),
    matrix.transformPoint({ x: bounds.x, y: bounds.y + bounds.height }),
    matrix.transformPoint({ x: bounds.x + bounds.width, y: bounds.y + bounds.height })
  ];
  var scale = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
  var padding = (radius * 2 + (shape.properties.strokeWidth || 0) + 10) * scale;
  var left = Math.max(0, Math.floor(Math.min.apply(null, corners.map(function(p) { return p.x; })) - padding));
  var top = Math.max(0, Math.floor(Math.min.apply(null, corners.map(function(p) { return p.y; })) - padding));
  var right = Math.min(ctx.canvas.width, Math.ceil(Math.max.apply(null, corners.map(function(p) { return p.x; })) + padding));
  var bottom = Math.min(ctx.canvas.height, Math.ceil(Math.max.apply(null, corners.map(function(p) { return p.y; })) + padding));
  if (right <= left || bottom <= top) return;

  var offscreen = document.createElement('canvas');
  offscreen.width = right - left;
  offscreen.height = bottom - top;
  var offCtx = offscreen.getContext('2d');
  var original = ctx.getTransform();
  offCtx.setTransform(original.a, original.b, original.c, original.d, original.e - left, original.f - top);
  var unblurred = Object.assign({}, shape, {
    properties: Object.assign({}, shape.properties, { blurRadius: 0 })
  });
  renderShape(offCtx, unblurred);
  var image = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
  blurShapePixels(image.data, offscreen.width, offscreen.height, radius * scale, shape.properties.blurType || 'box');
  offCtx.putImageData(image, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = shape.properties.blendMode || 'source-over';
  ctx.drawImage(offscreen, left, top);
  ctx.restore();
}

function renderShape(ctx, shape) {
  if (!shape.points || shape.points.length === 0) return;
  if (shape.properties.blurRadius > 0) {
    renderBlurredShape(ctx, shape);
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = shape.properties.blendMode || 'source-over';

  var originX = (RENDER_DATA.originX !== undefined) ? RENDER_DATA.originX : (RENDER_DATA.artboard.x || 0);
  var originY = (RENDER_DATA.originY !== undefined) ? RENDER_DATA.originY : (RENDER_DATA.artboard.y || 0);
  ctx.translate(shape.transform.x - originX, shape.transform.y - originY);
  ctx.rotate((shape.transform.rotation || 0) * Math.PI / 180);
  ctx.scale(shape.transform.scaleX || 1, shape.transform.scaleY || 1);
  ctx.transform(1, shape.transform.skewX || 0, shape.transform.skewY || 0, 1, 0, 0);

  ctx.beginPath();
  var t = shape.type, rmo = shape.renderModeOverride, renderMode = shape.shapeRenderMode || 'smooth';

  if (t === 'line' || t === 'line-vector') {
    drawLine(ctx, shape);
  } else if (t === 'spline-circle' || t === 'spline-ellipse') {
    drawSplineCircle(ctx, shape.points, shape.controlPoints, shape.closed);
  } else if (t === 'spline-ring') {
    drawSplineRing(ctx, shape.points, shape.controlPoints);
  } else if (t === 'bezier') {
    drawBezierCurve(ctx, shape);
    if (shape.closed) ctx.closePath();
  } else if (t === 'smooth-spline') {
    drawSmoothSpline(ctx, shape);
  } else if (t === 'cubic') {
    drawCubicCurve(ctx, shape);
  } else if (t === 'blob') {
    drawBlob(ctx, shape);
  } else if (t === 'chunk') {
    drawChunk(ctx, shape);
  } else if (t === 'circle') {
    // Canonical rule: polygonize when rmo.enabled; native arc otherwise
    if (rmo && rmo.enabled) { drawContourWithConfig(ctx, _jitter(shape), rmo); }
    else { ctx.arc(0, 0, shape.radius || (shape.width || 0) / 2, 0, Math.PI * 2); }
  } else if (t === 'ellipse') {
    if (rmo && rmo.enabled) { drawContourWithConfig(ctx, _jitter(shape), rmo); }
    else { ctx.ellipse(0, 0, (shape.width || 0) / 2, (shape.height || 0) / 2, 0, 0, Math.PI * 2); }
  } else if (t === 'rectangle' || t === 'square') {
    if (rmo && rmo.enabled) { drawContourWithConfig(ctx, _jitter(shape), rmo); }
    else { ctx.rect(-(shape.width || 0) / 2, -(shape.height || 0) / 2, shape.width || 0, shape.height || 0); }
  } else if (t === 'rounded-rectangle' || t === 'rounded-square') {
    // Canonical rule: use drawContourWithConfig when rmo.enabled; roundRect otherwise
    if (rmo && rmo.enabled) { drawContourWithConfig(ctx, _jitter(shape), rmo); }
    else if (shape.renderType === 'roundRect' && shape.cornerRadius && ctx.roundRect) {
      ctx.roundRect(-(shape.width || 0) / 2, -(shape.height || 0) / 2, shape.width || 0, shape.height || 0, shape.cornerRadius);
    } else { drawPolygon(ctx, _jitter(shape)); }
  } else if (t === 'ring') {
    var half = Math.floor(shape.points.length / 2);
    var outerPts = _jitter(shape, shape.points.slice(0, half), 0);
    var innerPts = _jitter(shape, shape.points.slice(half), 999983);
    if (rmo && rmo.enabled) {
      drawContourWithConfig(ctx, outerPts, rmo);
      drawContourWithConfig(ctx, innerPts, rmo);
    } else {
      for (var _oi = 0; _oi < outerPts.length; _oi++) { if (_oi === 0) ctx.moveTo(outerPts[_oi].x, outerPts[_oi].y); else ctx.lineTo(outerPts[_oi].x, outerPts[_oi].y); } ctx.closePath();
      for (var _ii = 0; _ii < innerPts.length; _ii++) { if (_ii === 0) ctx.moveTo(innerPts[_ii].x, innerPts[_ii].y); else ctx.lineTo(innerPts[_ii].x, innerPts[_ii].y); } ctx.closePath();
    }
  } else {
    // All other polygon shapes — flat polygon default (matching client canonical)
    var _pts = _jitter(shape);
    if (rmo && rmo.enabled) { drawContourWithConfig(ctx, _pts, rmo); }
    else { drawPolygon(ctx, _pts); }
  }

  // Fill
  var isLine = (t === 'line');
  if (!isLine && shape.properties.fillColor !== 'none' && shape.properties.openCurveFilled !== false) {
    ctx.globalAlpha = shape.properties.fillOpacity || 1;
    if (shape.properties.gradient) {
      var bounds = getShapeBounds(shape.points);
      var gradType = shape.properties.gradient.type;
      if (gradType === 'diamond') {
        _applyDiamondFill(ctx, bounds, shape.properties.gradient);
      } else if (gradType === 'linear') {
        var angle = (shape.properties.gradient.angle || 0) * Math.PI / 180;
        var gcx = bounds.x + bounds.width * (shape.properties.gradient.linearCenterX != null ? shape.properties.gradient.linearCenterX : 50) / 100;
        var gcy = bounds.y + bounds.height * (shape.properties.gradient.linearCenterY != null ? shape.properties.gradient.linearCenterY : 50) / 100;
        var len = Math.max(bounds.width, bounds.height) / 2 * (Math.max(1, shape.properties.gradient.linearScale || 100) / 100);
        var grad = ctx.createLinearGradient(gcx - Math.cos(angle)*len, gcy - Math.sin(angle)*len, gcx + Math.cos(angle)*len, gcy + Math.sin(angle)*len);
        for (var si = 0; si < shape.properties.gradient.stops.length; si++) {
          grad.addColorStop(shape.properties.gradient.stops[si].offset, shape.properties.gradient.stops[si].color);
        }
        ctx.fillStyle = grad;
      } else if (gradType === 'conic') {
        var cxPct = shape.properties.gradient.conicCenterX != null ? shape.properties.gradient.conicCenterX : 50;
        var cyPct = shape.properties.gradient.conicCenterY != null ? shape.properties.gradient.conicCenterY : 50;
        var conicCx = bounds.x + bounds.width*cxPct/100, conicCy = bounds.y + bounds.height*cyPct/100;
        var conicGrad = ctx.createConicGradient(shape.properties.gradient.conicAngle || 0, conicCx, conicCy);
        for (var si = 0; si < shape.properties.gradient.stops.length; si++) {
          conicGrad.addColorStop(shape.properties.gradient.stops[si].offset, shape.properties.gradient.stops[si].color);
        }
        ctx.fillStyle = conicGrad;
      } else {
        var rcxPct = shape.properties.gradient.radialCenterX != null ? shape.properties.gradient.radialCenterX : 50;
        var rcyPct = shape.properties.gradient.radialCenterY != null ? shape.properties.gradient.radialCenterY : 50;
        var radCx = bounds.x + bounds.width*rcxPct/100, radCy = bounds.y + bounds.height*rcyPct/100;
        var radRadius = Math.max(bounds.width, bounds.height) / 2 * ((shape.properties.gradient.radialScale || 100) / 100);
        var radGrad = ctx.createRadialGradient(radCx, radCy, 0, radCx, radCy, radRadius);
        for (var si = 0; si < shape.properties.gradient.stops.length; si++) {
          radGrad.addColorStop(shape.properties.gradient.stops[si].offset, shape.properties.gradient.stops[si].color);
        }
        ctx.fillStyle = radGrad;
      }
    } else {
      ctx.fillStyle = shape.properties.fillColor;
    }
    if (t === 'ring' || t === 'spline-ring') { ctx.fill('evenodd'); } else { ctx.fill(); }
  }

  // Stroke
  if (shape.properties.strokeColor !== 'none' && shape.properties.strokeWidth > 0) {
    ctx.globalAlpha = shape.properties.strokeOpacity || 1;
    ctx.strokeStyle = shape.properties.strokeColor;
    ctx.lineWidth = shape.properties.strokeWidth;
    if (shape.strokeCap) ctx.lineCap = shape.strokeCap;
    var pat = shape.strokePattern || 'none';
    if (pat === 'squiggle') {
      ctx.lineCap = shape.strokeCap || 'round';
      ctx.setLineDash([]);
      (function(ctx, shape) {
        var amplitude  = shape.strokeSquiggleAmplitude  != null ? shape.strokeSquiggleAmplitude  : 4;
        var frequency  = shape.strokeSquiggleFrequency  != null ? shape.strokeSquiggleFrequency  : 1;
        var phase      = shape.strokeSquigglePhase      != null ? shape.strokeSquigglePhase      : 0;
        var align      = shape.strokeSquiggleAlign      != null ? shape.strokeSquiggleAlign      : 100;
        var absWave    = !!shape.strokeSquiggleAbs;
        var flipWave   = !!shape.strokeSquiggleFlip;
        var jitter     = shape.strokeSquiggleJitter     != null ? shape.strokeSquiggleJitter     : 0;
        var jSeed      = shape.strokeSquiggleJitterSeed != null ? shape.strokeSquiggleJitterSeed : 0;
        var noise      = shape.strokeSquiggleNoise      != null ? shape.strokeSquiggleNoise      : 0;
        var noiseFreq  = shape.strokeSquiggleNoiseFreq  != null ? shape.strokeSquiggleNoiseFreq  : 1;
        var jMode      = shape.strokeSquiggleJitterMode || 'normal';
        function sqLcg(s) { s = (Math.imul(1664525, s | 0) + 1013904223) | 0; return ((s >>> 0) & 0x7fffffff) / 0x7fffffff; }
        function sqNoise(pos, nPts, seed) {
          var scaled = pos * nPts, i0 = Math.floor(scaled), frac = scaled - i0;
          var cf = (1 - Math.cos(frac * Math.PI)) * 0.5;
          return (sqLcg(seed * 7919 + (i0 & 0x3fff)) * (1 - cf) + sqLcg(seed * 7919 + ((i0 + 1) & 0x3fff)) * cf) * 2 - 1;
        }
        function evalCurve(sh, target) {
          var pts = sh.points;
          if (!pts || pts.length < 2) return pts || [];
          var handles = sh.tangentHandles, cps = sh.controlPoints;
          var closed = sh.closed !== false;
          if (handles && handles.length >= pts.length) {
            var segCount = closed ? pts.length : pts.length - 1;
            if (segCount < 1) return pts;
            var sps = Math.max(4, Math.ceil(target / segCount)), out = [];
            for (var i = 0; i < segCount; i++) {
              var p0 = pts[i], p3 = pts[(i + 1) % pts.length];
              var h0 = handles[i], h1 = handles[(i + 1) % pts.length];
              var cp1 = (h0 && h0.out) ? h0.out : p0, cp2 = (h1 && h1.in) ? h1.in : p3;
              for (var j = 0; j < sps; j++) {
                var tt = j / sps, uu = 1 - tt;
                out.push({ x: uu*uu*uu*p0.x + 3*uu*uu*tt*cp1.x + 3*uu*tt*tt*cp2.x + tt*tt*tt*p3.x,
                           y: uu*uu*uu*p0.y + 3*uu*uu*tt*cp1.y + 3*uu*tt*tt*cp2.y + tt*tt*tt*p3.y });
              }
            }
            if (!closed) out.push({ x: pts[pts.length-1].x, y: pts[pts.length-1].y });
            return out;
          }
          if (cps && cps.length >= (pts.length - 1) * 2) {
            var hasWrapSeg = closed && cps.length >= pts.length * 2;
            var segCount = hasWrapSeg ? pts.length : pts.length - 1;
            var sps = Math.max(4, Math.ceil(target / segCount)), out = [];
            for (var i = 0; i < segCount; i++) {
              var p0 = pts[i], p3 = pts[(i + 1) % pts.length];
              var cp1 = cps[i*2] || p0, cp2 = cps[i*2+1] || p3;
              for (var j = 0; j < sps; j++) {
                var tt = j / sps, uu = 1 - tt;
                out.push({ x: uu*uu*uu*p0.x + 3*uu*uu*tt*cp1.x + 3*uu*tt*tt*cp2.x + tt*tt*tt*p3.x,
                           y: uu*uu*uu*p0.y + 3*uu*uu*tt*cp1.y + 3*uu*tt*tt*cp2.y + tt*tt*tt*p3.y });
              }
            }
            if (!hasWrapSeg) out.push({ x: pts[pts.length-1].x, y: pts[pts.length-1].y });
            return out;
          }
          return pts;
        }
        var isOpen = shape.closed === false;
        var rawPts = evalCurve(shape, 512);
        if (!rawPts || rawPts.length < 2) return;
        function sqAutoCount(rp, freq, aln) {
          var perim = 0;
          for (var _i = 0; _i < rp.length - 1; _i++) perim += Math.hypot(rp[_i+1].x-rp[_i].x, rp[_i+1].y-rp[_i].y);
          var af = 1 + (1 - Math.max(0, Math.min(100, aln)) / 100) * 0.5;
          return Math.max(128, Math.min(4096, Math.ceil(Math.max(perim * 0.2, freq * 24) * af)));
        }
        var sampleCount = (shape.strokeSquiggleSampleCount != null) ? shape.strokeSquiggleSampleCount : sqAutoCount(rawPts, frequency, align);
        var pts = isOpen ? _resampleOpenContour(rawPts, sampleCount) : resampleContour(rawPts, sampleCount);
        var n = pts.length;
        if (n < 2) return;
        var smoothW = Math.round((1 - align / 100) * n * 0.15);
        if (smoothW > 0) {
          var smoothed = [], cnt = 2 * smoothW + 1;
          for (var qi = 0; qi < n; qi++) {
            var sx = 0, sy = 0;
            for (var d = -smoothW; d <= smoothW; d++) {
              var jj = isOpen ? Math.max(0, Math.min(n-1, qi+d)) : (qi + d + n) % n;
              sx += pts[jj].x; sy += pts[jj].y;
            }
            smoothed.push({ x: sx / cnt, y: sy / cnt });
          }
          pts = smoothed;
        }
        var cx = 0, cy = 0;
        for (var qi = 0; qi < n; qi++) { cx += pts[qi].x; cy += pts[qi].y; }
        cx /= n; cy /= n;
        var normals = [];
        for (var qi = 0; qi < n; qi++) {
          var prev = isOpen ? pts[Math.max(0, qi-1)] : pts[(qi - 1 + n) % n];
          var next = isOpen ? pts[Math.min(n-1, qi+1)] : pts[(qi + 1) % n];
          var tx = next.x - prev.x, ty = next.y - prev.y;
          var tlen = Math.hypot(tx, ty);
          if (tlen > 0) { tx /= tlen; ty /= tlen; }
          var nx = -ty, ny = tx;
          if (nx * (cx - pts[qi].x) + ny * (cy - pts[qi].y) > 0) { nx = -nx; ny = -ny; }
          normals.push({ nx: nx, ny: ny });
        }
        var arcLens = [0];
        for (var qi = 0; qi < n; qi++) {
          var aa = pts[qi], bb = isOpen ? pts[Math.min(qi+1, n-1)] : pts[(qi + 1) % n];
          arcLens.push(arcLens[qi] + Math.hypot(bb.x - aa.x, bb.y - aa.y));
        }
        var totalLen = isOpen ? arcLens[n-1] : arcLens[n];
        var noiseLattice = Math.max(4, Math.round(noiseFreq * 16));
        var dpts = [];
        for (var qi = 0; qi < n; qi++) {
          var t = totalLen > 0 ? arcLens[qi] / totalLen : 0;
          var sinOff = amplitude * Math.sin(2 * Math.PI * frequency * t + phase);
          var jRaw  = jitter > 0 ? (sqLcg(jSeed * 65537 + qi) * 2 - 1) * jitter : 0;
          var jRawX = (jitter > 0 && jMode === 'xy') ? (sqLcg(jSeed * 65537 + qi + 99991) * 2 - 1) * jitter : 0;
          var jRawY = (jitter > 0 && jMode === 'xy') ? (sqLcg(jSeed * 65537 + qi + 199933) * 2 - 1) * jitter : 0;
          var nRaw  = noise > 0 ? sqNoise(t, noiseLattice, jSeed + 1) * noise : 0;
          var nRawX = (noise > 0 && jMode === 'xy') ? sqNoise(t, noiseLattice, jSeed + 2) * noise : 0;
          var nRawY = (noise > 0 && jMode === 'xy') ? sqNoise(t, noiseLattice, jSeed + 3) * noise : 0;
          var nm = normals[qi], dx, dy;
          if (jMode === 'xy') {
            var totalX = nm.nx * sinOff + jRawX + nRawX;
            var totalY = nm.ny * sinOff + jRawY + nRawY;
            if (absWave) { totalX = Math.abs(totalX); totalY = Math.abs(totalY); }
            if (flipWave) { totalX = -totalX; totalY = -totalY; }
            dx = pts[qi].x + totalX;
            dy = pts[qi].y + totalY;
          } else {
            var totalOff = sinOff + jRaw + nRaw;
            if (absWave) totalOff = Math.abs(totalOff);
            if (flipWave) totalOff = -totalOff;
            dx = pts[qi].x + nm.nx * totalOff;
            dy = pts[qi].y + nm.ny * totalOff;
          }
          dpts.push({ x: dx, y: dy });
        }
        var hasCurveData = !!((shape.tangentHandles && shape.tangentHandles.length) || (shape.controlPoints && shape.controlPoints.length));
        var smoothCurves = hasCurveData && shape.strokeSquiggleSmoothCurves !== false;
        ctx.beginPath();
        ctx.moveTo(dpts[0].x, dpts[0].y);
        if (smoothCurves) {
          var segCount = isOpen ? n - 1 : n;
          for (var si = 0; si < segCount; si++) {
            var sp0 = dpts[isOpen ? Math.max(0, si - 1) : (si - 1 + n) % n];
            var sp1 = dpts[si];
            var sp2 = dpts[(si + 1) % n];
            var sp3 = dpts[isOpen ? Math.min(n - 1, si + 2) : (si + 2) % n];
            var cp1x = sp1.x + (sp2.x - sp0.x) / 6;
            var cp1y = sp1.y + (sp2.y - sp0.y) / 6;
            var cp2x = sp2.x - (sp3.x - sp1.x) / 6;
            var cp2y = sp2.y - (sp3.y - sp1.y) / 6;
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, sp2.x, sp2.y);
          }
        } else {
          for (var li = 1; li < n; li++) ctx.lineTo(dpts[li].x, dpts[li].y);
        }
        if (!isOpen) ctx.closePath();
        ctx.stroke();
      })(ctx, shape);
    } else if (pat === 'dash') {
      ctx.setLineDash([shape.strokeDashLength || 10, shape.strokeDashGap || 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (pat === 'dot') {
      ctx.lineCap = 'round';
      ctx.setLineDash([0.5, shape.strokeDotSpacing || 8]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.setLineDash([]);
      ctx.stroke();
    }
  }

  // Wire post-pass
  if (shape.wireConfig && shape.wireConfig.enabled) {
    ctx.globalAlpha = 1;
    drawWirePass(ctx, shape, shape.wireConfig, shape.renderModeOverride);
  }

  ctx.restore();
}
`;
