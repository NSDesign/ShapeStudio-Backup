// Canonical shape-rendering utilities — shared by all four renderers.
// Uses a minimal DrawCtx interface so it works with browser CanvasRenderingContext2D
// and node-canvas CanvasRenderingContext2D without importing either.

export interface Point2D {
  x: number;
  y: number;
}

export interface RenderModeOverride {
  enabled: boolean;
  tension: number;           // 0.0 = sharp (straight lines), 1.0 = smooth (midpoint Bézier)
  passes?: number;           // 1–6, default 1; Chaikin subdivision passes (chaikin algorithm only)
  smoothAlgorithm?: 'chaikin' | 'catmull-rom' | 'natural-cubic'; // default 'chaikin'
  catmullAlpha?: number;     // 0=uniform, 0.5=centripetal (default), 1=chordal (catmull-rom only)
  naturalCubicClamped?: boolean; // true = clamped (zero-slope) endpoints for open shapes (natural-cubic only)
  resample: {
    enabled: boolean;
    count: number;           // target vertex count after resampling
  };
}

export const DEFAULT_RENDER_MODE_OVERRIDE: RenderModeOverride = {
  enabled: false,
  tension: 1,
  passes: 1,
  smoothAlgorithm: 'chaikin',
  catmullAlpha: 0.5,
  resample: { enabled: false, count: 32 },
};

// ─── Wire Pass ───────────────────────────────────────────────────────────────

export interface WireColorSection {
  colorSource: 'explicit' | 'inherit-fill' | 'inherit-stroke';
  color: string;
  opacity: number;
  opacitySource?: 'explicit' | 'inherit-fill' | 'inherit-stroke';
}

export interface WirePointsSection extends WireColorSection {
  size: number;
}

export interface WireConnectionsSection extends WireColorSection {
  thickness: number;
}

export interface WireConfig {
  enabled: boolean;
  render: 'points' | 'connections' | 'combined';
  points: WirePointsSection;
  connections: WireConnectionsSection;
}

export const DEFAULT_WIRE_CONFIG: WireConfig = {
  enabled: false,
  render: 'points',
  points: { colorSource: 'explicit', color: '#ffffff', opacity: 1, size: 4 },
  connections: { colorSource: 'explicit', color: '#ffffff', opacity: 1, thickness: 1 },
};

// Minimal drawing interface compatible with both browser and node-canvas contexts.
export interface DrawCtx {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  closePath(): void;
}

// Extended context interface required by the wire pass.
// Compatible with both browser CanvasRenderingContext2D and node-canvas.
export interface WireCtx extends DrawCtx {
  beginPath(): void;
  arc(x: number, y: number, r: number, startAngle: number, endAngle: number): void;
  fill(): void;
  stroke(): void;
  globalAlpha: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fillStyle: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  strokeStyle: any;
  lineWidth: number;
}

// Resolve a wire color source to a CSS color string.
// Caller passes the shape's effective fill / stroke colors as plain strings.
export function resolveWireColor(
  colorSource: 'explicit' | 'inherit-fill' | 'inherit-stroke',
  explicitColor: string,
  fillColor: string,
  strokeColor: string,
): string {
  switch (colorSource) {
    case 'inherit-stroke': return (strokeColor && strokeColor !== 'none') ? strokeColor : '#000000';
    case 'inherit-fill':   return (fillColor   && fillColor   !== 'none') ? fillColor   : '#ffffff';
    default:               return explicitColor;
  }
}

// Resolve wire opacity from source setting (mirrors resolveWireColor for opacity).
export function resolveWireOpacity(
  opacitySource: 'explicit' | 'inherit-fill' | 'inherit-stroke' | undefined,
  explicitOpacity: number,
  fillOpacity: number,
  strokeOpacity: number,
): number {
  switch (opacitySource) {
    case 'inherit-fill':   return fillOpacity   ?? 1;
    case 'inherit-stroke': return strokeOpacity ?? 1;
    default:               return explicitOpacity ?? 1;
  }
}

// Minimal shape context passed to drawWirePass — compatible with both client and server Shape.
export interface WireShapeContext {
  type: string;
  points: Point2D[];
  properties: {
    fillColor: string;
    strokeColor: string;
    fillOpacity?: number;
    strokeOpacity?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gradient?: any;
  };
  renderModeOverride?: RenderModeOverride;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

// ─── Gradient color-sampling helpers ─────────────────────────────────────────
// These functions convert gradient definitions into per-point solid hex colors
// so the wire pass can paint each vertex dot / segment midpoint individually.

function _parseColorToRgba(color: string): { r: number; g: number; b: number; a: number } {
  const c = (color || '#ffffff').trim();
  if (c.startsWith('#')) {
    const h = c.slice(1);
    if (h.length === 3 || h.length === 4) {
      return { r: parseInt(h[0]+h[0], 16), g: parseInt(h[1]+h[1], 16), b: parseInt(h[2]+h[2], 16), a: h.length === 4 ? parseInt(h[3]+h[3], 16) / 255 : 1 };
    }
    return { r: parseInt(h.slice(0,2), 16), g: parseInt(h.slice(2,4), 16), b: parseInt(h.slice(4,6), 16), a: h.length >= 8 ? parseInt(h.slice(6,8), 16) / 255 : 1 };
  }
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  return { r: 255, g: 255, b: 255, a: 1 };
}

function _rgbaToHex(c: { r: number; g: number; b: number }): string {
  const r = Math.max(0, Math.min(255, Math.round(c.r)));
  const g = Math.max(0, Math.min(255, Math.round(c.g)));
  const b = Math.max(0, Math.min(255, Math.round(c.b)));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function _lerpRgba(c1: {r:number;g:number;b:number;a:number}, c2: {r:number;g:number;b:number;a:number}, t: number) {
  return { r: c1.r+(c2.r-c1.r)*t, g: c1.g+(c2.g-c1.g)*t, b: c1.b+(c2.b-c1.b)*t, a: c1.a+(c2.a-c1.a)*t };
}

function _sampleGradientStops(stops: { offset: number; color: string }[], t: number): string {
  t = Math.max(0, Math.min(1, t));
  if (!stops || stops.length === 0) return '#ffffff';
  if (stops.length === 1) return stops[0].color;
  if (t <= stops[0].offset) return stops[0].color;
  if (t >= stops[stops.length-1].offset) return stops[stops.length-1].color;
  for (let i = 0; i < stops.length-1; i++) {
    if (t >= stops[i].offset && t <= stops[i+1].offset) {
      const span = stops[i+1].offset - stops[i].offset;
      const lt = span === 0 ? 0 : (t - stops[i].offset) / span;
      return _rgbaToHex(_lerpRgba(_parseColorToRgba(stops[i].color), _parseColorToRgba(stops[i+1].color), lt));
    }
  }
  return stops[stops.length-1].color;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _sampleGradientAtPoint(pt: Point2D, bounds: {x:number;y:number;width:number;height:number}, gradient: any): string {
  const stops = gradient.stops || [];
  if (gradient.type === 'linear') {
    const angle = ((gradient.angle || 0) * Math.PI) / 180;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
    const halfDiag = Math.sqrt(bounds.width * bounds.width + bounds.height * bounds.height) / 2;
    if (halfDiag === 0) return _sampleGradientStops(stops, 0.5);
    const proj = ((pt.x - cx) * dx + (pt.y - cy) * dy) / halfDiag;
    return _sampleGradientStops(stops, (proj + 1) / 2);
  }
  if (gradient.type === 'radial') {
    const rcx = bounds.x + (bounds.width  * (gradient.radialCenterX ?? 50)) / 100;
    const rcy = bounds.y + (bounds.height * (gradient.radialCenterY ?? 50)) / 100;
    const outerR = Math.sqrt(bounds.width * bounds.width + bounds.height * bounds.height) / 2;
    if (outerR === 0) return _sampleGradientStops(stops, 0);
    const dist = Math.sqrt((pt.x - rcx) ** 2 + (pt.y - rcy) ** 2);
    return _sampleGradientStops(stops, dist / outerR);
  }
  return '#ffffff';
}

// Shape types whose vertex list is NOT a closed polygon — the last point should
// NOT be connected back to the first in "connections" mode.
const _OPEN_SHAPE_TYPES = new Set(['line', 'line-vector', 'bezier', 'cubic']);

// Arc-length resampling for open polylines (no wrap-around from last→first).
// Produces exactly n points spread evenly along the chain.
export function resampleOpenContour(pts: Point2D[], n: number): Point2D[] {
  if (n <= 0 || pts.length === 0) return [];
  if (n === 1) return [{ ...pts[0] }];
  if (pts.length === 1) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const segLens: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segLens.push(len);
    totalLen += len;
  }
  if (totalLen === 0) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const result: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * totalLen;
    let accum = 0, si = 0;
    while (si < segLens.length - 1 && accum + segLens[si] < target) { accum += segLens[si]; si++; }
    const t = segLens[si] > 0 ? Math.min(1, (target - accum) / segLens[si]) : 0;
    const a = pts[si], b = pts[si + 1] ?? pts[si];
    result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return result;
}

// Draw wire overlay (vertex dots and/or connection lines) on top of the main shape.
// Called after fill + stroke while the canvas transform is still in the shape's local space.
// Canonical API: pass the full shape context so the function can:
//   - resolve resampled vertex list from renderModeConfig
//   - detect open vs closed shapes (no closing segment for line/bezier/cubic)
//   - sample gradient color per vertex (inherit-fill) for full renderer parity
export function drawWirePass(
  ctx: WireCtx,
  shape: WireShapeContext,
  wireConfig: WireConfig,
  renderModeConfig?: RenderModeOverride,
): void {
  if (!wireConfig?.enabled) return;

  let pts = shape.points;
  if (!pts || pts.length === 0) return;

  const isOpen = _OPEN_SHAPE_TYPES.has(shape.type);

  // Use resampled points if resample is active — use open-chain resampling for open shapes
  const rmc = renderModeConfig ?? shape.renderModeOverride;
  if (rmc?.enabled && rmc?.resample?.enabled && rmc.resample.count >= 3) {
    pts = isOpen ? resampleOpenContour(pts, rmc.resample.count) : resampleContour(pts, rmc.resample.count);
  }
  // Align wire overlay with smoothed outline.
  if (rmc?.enabled && (rmc.smoothAlgorithm ?? 'chaikin') === 'chaikin' && !isOpen) {
    // Chaikin: apply subdivision passes for closed shapes only.
    const extraPasses = Math.max(0, Math.min(5, (rmc.passes ?? 1) - 1));
    for (let i = 0; i < extraPasses; i++) pts = chaikinSubdivide(pts);
  } else if (rmc?.enabled && rmc.smoothAlgorithm === 'catmull-rom') {
    // Catmull-Rom: densify points by sampling the spline so connections trace the curve.
    pts = sampleCatmullRomPoints(pts, Math.max(64, pts.length * 8), rmc.catmullAlpha ?? 0.5, !isOpen, rmc.tension ?? 1);
  } else if (rmc?.enabled && rmc.smoothAlgorithm === 'natural-cubic') {
    pts = sampleNaturalCubicPoints(pts, Math.max(64, pts.length * 8), !isOpen, rmc.naturalCubicClamped ?? false);
  }
  const fillColor    = (shape.properties.fillColor   === 'none') ? '#ffffff' : shape.properties.fillColor;
  const strokeColor  = (shape.properties.strokeColor === 'none') ? '#000000' : shape.properties.strokeColor;
  const fillOpacity  = shape.properties.fillOpacity  ?? 1;
  const strokeOpacity = shape.properties.strokeOpacity ?? 1;
  const gradient    = (shape.properties.gradient?.type && shape.properties.gradient.type !== 'diamond')
    ? shape.properties.gradient as { type: string; stops: {offset:number;color:string}[]; angle?: number; radialCenterX?: number; radialCenterY?: number }
    : undefined;

  // Pre-compute bounds once (needed for gradient sampling)
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  if (gradient) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  const drawConn = wireConfig.render === 'connections' || wireConfig.render === 'combined';
  const drawPts  = wireConfig.render === 'points'      || wireConfig.render === 'combined';

  // ── Connection lines ──────────────────────────────────────────────────────
  if (drawConn && pts.length >= 2) {
    const cfg = wireConfig.connections;
    ctx.lineWidth   = cfg.thickness ?? 1;
    ctx.globalAlpha = resolveWireOpacity(cfg.opacitySource, cfg.opacity ?? 1, fillOpacity, strokeOpacity);

    if (cfg.colorSource === 'inherit-fill' && gradient) {
      // Per-segment midpoint gradient sampling — one ctx call per segment
      const segCount = isOpen ? pts.length - 1 : pts.length;
      for (let i = 0; i < segCount; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const mid: Point2D = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = _sampleGradientAtPoint(mid, bounds, gradient);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = resolveWireColor(cfg.colorSource, cfg.color, fillColor, strokeColor);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (!isOpen) ctx.closePath();
      ctx.stroke();
    }
  }

  // ── Vertex dots ───────────────────────────────────────────────────────────
  if (drawPts && pts.length > 0) {
    const cfg    = wireConfig.points;
    const radius = (cfg.size ?? 4) / 2;
    ctx.globalAlpha = resolveWireOpacity(cfg.opacitySource, cfg.opacity ?? 1, fillOpacity, strokeOpacity);

    if (cfg.colorSource === 'inherit-fill' && gradient) {
      // Per-vertex gradient color sampling
      for (const pt of pts) {
        ctx.fillStyle = _sampleGradientAtPoint(pt, bounds, gradient);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = resolveWireColor(cfg.colorSource, cfg.color, fillColor, strokeColor);
      for (const pt of pts) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// Arc-length uniform resampling: produces exactly n points at equal arc-length
// intervals around the closed contour.  Works for up- and down-sampling.
export function resampleContour(pts: Point2D[], n: number): Point2D[] {
  if (n <= 0 || pts.length === 0) return [];
  if (n === 1) return [{ ...pts[0] }];
  if (pts.length === 1) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const numSegs = pts.length;
  const segLens: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < numSegs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % numSegs];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segLens.push(len);
    totalLen += len;
  }
  if (totalLen === 0) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const result: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const target = (i / n) * totalLen;
    let accum = 0;
    let si = 0;
    while (si < numSegs - 1 && accum + segLens[si] < target) {
      accum += segLens[si];
      si++;
    }
    const t = segLens[si] > 0 ? Math.min(1, (target - accum) / segLens[si]) : 0;
    const a = pts[si];
    const b = pts[(si + 1) % numSegs];
    result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return result;
}

// One pass of Chaikin corner-cutting in point space.
// Each consecutive vertex pair (A, B) produces two new points: ¾A+¼B and ¼A+¾B.
// Returns a closed polygon with 2× the vertex count; input is not mutated.
export function chaikinSubdivide(pts: Point2D[]): Point2D[] {
  const n = pts.length;
  if (n < 3) return pts;
  const out: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
    out.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
  }
  return out;
}

// Tension-parameterised closed-contour drawing.
//   tension = 0 → straight line between midpoints (sharp / polygon look)
//   tension = 1 → midpoint quadratic Bézier (classic addSmooth / Chaikin look)
//   0 < tension < 1 → interpolated between the two
//
// Appends a subpath to ctx; caller must call ctx.beginPath() before and
// ctx.fill()/ctx.stroke() after as needed.
export function applyTension(ctx: DrawCtx, pts: Point2D[], tension: number): void {
  if (pts.length === 0) return;
  if (pts.length < 3) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
    ctx.closePath();
    return;
  }
  const t = Math.max(0, Math.min(1, tension));
  const n = pts.length;
  for (let si = 0; si < n; si++) {
    const p0 = pts[(si - 1 + n) % n];
    const p1 = pts[si];
    const p2 = pts[(si + 1) % n];
    const mx1x = (p0.x + p1.x) / 2;
    const mx1y = (p0.y + p1.y) / 2;
    const mx2x = (p1.x + p2.x) / 2;
    const mx2y = (p1.y + p2.y) / 2;
    if (si === 0) ctx.moveTo(mx1x, mx1y);
    if (t < 0.001) {
      // Pure sharp: straight line to next midpoint
      ctx.lineTo(mx2x, mx2y);
    } else {
      // Interpolate control point between neutral midpoint (t=0) and vertex (t=1)
      const neutralCtrlX = (mx1x + mx2x) / 2;
      const neutralCtrlY = (mx1y + mx2y) / 2;
      const ctrlX = neutralCtrlX + t * (p1.x - neutralCtrlX);
      const ctrlY = neutralCtrlY + t * (p1.y - neutralCtrlY);
      ctx.quadraticCurveTo(ctrlX, ctrlY, mx2x, mx2y);
    }
  }
  ctx.closePath();
}

// Convenience wrapper: alias for applyTension(ctx, pts, 1) — equivalent to the
// original addSmooth implementation.  Used as a drop-in replacement.
export function addSmooth(ctx: DrawCtx, pts: Point2D[]): void {
  applyTension(ctx, pts, 1);
}

// Catmull-Rom → cubic Bézier spline (centripetal / chordal / uniform).
//   alpha = 0   → uniform parameterisation (classic Catmull-Rom)
//   alpha = 0.5 → centripetal (default, avoids cusps on tight turns)
//   alpha = 1   → chordal
//
// Unlike Chaikin/tension (approximating), this is an interpolating spline —
// the curve passes exactly through every control point.
//
// For closed shapes the point list is treated cyclically.
// For open shapes (line/bezier/cubic) phantom endpoints are mirrored so that
// the first and last real vertices still get natural tangents.
export function applyCatmullRom(
  ctx: DrawCtx,
  pts: Point2D[],
  alpha: number,
  closed: boolean,
  tension = 1,
): void {
  const n = pts.length;
  if (n === 0) return;
  if (n < 2) { ctx.moveTo(pts[0].x, pts[0].y); if (closed) ctx.closePath(); return; }
  if (n === 2) {
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    if (closed) ctx.closePath();
    return;
  }

  const a = Math.max(0, Math.min(1, alpha));

  // Knot spacing: Euclidean distance raised to power alpha.
  // alpha=0 → always 1 (uniform); guards against zero-length spans.
  const kd = (p: Point2D, q: Point2D): number => {
    if (a === 0) return 1;
    const dx = q.x - p.x, dy = q.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    return d < 0.0001 ? 0.0001 : Math.pow(d, a);
  };

  // Phantom endpoints for open chains (mirror tangent at each end).
  const pStart: Point2D = { x: 2 * pts[0].x - pts[1].x,         y: 2 * pts[0].y - pts[1].y };
  const pEnd:   Point2D = { x: 2 * pts[n-1].x - pts[n-2].x,     y: 2 * pts[n-1].y - pts[n-2].y };

  const segCount = closed ? n : n - 1;

  ctx.moveTo(pts[0].x, pts[0].y);

  for (let i = 0; i < segCount; i++) {
    const p0: Point2D = closed ? pts[(i - 1 + n) % n]  : (i === 0     ? pStart   : pts[i - 1]);
    const p1: Point2D = pts[i];
    const p2: Point2D = closed ? pts[(i + 1) % n]       : pts[i + 1];
    const p3: Point2D = closed ? pts[(i + 2) % n]       : (i === n - 2 ? pEnd     : pts[i + 2]);

    const dt0 = kd(p0, p1);
    const dt1 = kd(p1, p2);
    const dt2 = kd(p2, p3);

    // Tangent at p1 via Barry-Goldman parameterisation.
    let t1x: number, t1y: number;
    if (dt0 < 0.0001) {
      t1x = (p2.x - p1.x) / dt1;
      t1y = (p2.y - p1.y) / dt1;
    } else {
      t1x = (p1.x - p0.x) / dt0 - (p2.x - p0.x) / (dt0 + dt1) + (p2.x - p1.x) / dt1;
      t1y = (p1.y - p0.y) / dt0 - (p2.y - p0.y) / (dt0 + dt1) + (p2.y - p1.y) / dt1;
    }

    // Tangent at p2.
    let t2x: number, t2y: number;
    if (dt2 < 0.0001) {
      t2x = (p2.x - p1.x) / dt1;
      t2y = (p2.y - p1.y) / dt1;
    } else {
      t2x = (p2.x - p1.x) / dt1 - (p3.x - p1.x) / (dt1 + dt2) + (p3.x - p2.x) / dt2;
      t2y = (p2.y - p1.y) / dt1 - (p3.y - p1.y) / (dt1 + dt2) + (p3.y - p2.y) / dt2;
    }

    // Convert to cubic Bézier control points, scaled by tension.
    // tension=0 → linear, tension=1 → standard CR, tension=2 → exaggerated.
    const cp1x = p1.x + tension * t1x * dt1 / 3;
    const cp1y = p1.y + tension * t1y * dt1 / 3;
    const cp2x = p2.x - tension * t2x * dt1 / 3;
    const cp2y = p2.y - tension * t2y * dt1 / 3;

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }

  if (closed) ctx.closePath();
}

// Sample n points uniformly along a Catmull-Rom spline — used by the wire
// overlay so connections trace the smoothed curve rather than the original
// control polygon.  Uses the same parameterisation as applyCatmullRom.
export function sampleCatmullRomPoints(
  pts: Point2D[],
  n: number,
  alpha: number,
  closed: boolean,
  tension = 1,
): Point2D[] {
  const pnts = pts.length;
  if (pnts < 2 || n < 2) return pts;

  const a = Math.max(0, Math.min(1, alpha));
  const kd = (p: Point2D, q: Point2D): number => {
    if (a === 0) return 1;
    const dx = q.x - p.x, dy = q.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    return d < 0.0001 ? 0.0001 : Math.pow(d, a);
  };

  const pStart: Point2D = { x: 2 * pts[0].x - pts[1].x,       y: 2 * pts[0].y - pts[1].y };
  const pEnd:   Point2D = { x: 2 * pts[pnts-1].x - pts[pnts-2].x, y: 2 * pts[pnts-1].y - pts[pnts-2].y };
  const segCount = closed ? pnts : pnts - 1;
  const sps = Math.max(2, Math.ceil(n / segCount));  // samples per segment
  const result: Point2D[] = [];

  for (let i = 0; i < segCount; i++) {
    const p0 = closed ? pts[(i - 1 + pnts) % pnts] : (i === 0 ? pStart : pts[i - 1]);
    const p1 = pts[i];
    const p2 = closed ? pts[(i + 1) % pnts] : pts[i + 1];
    const p3 = closed ? pts[(i + 2) % pnts] : (i === pnts - 2 ? pEnd : pts[i + 2]);

    const dt0 = kd(p0, p1), dt1 = kd(p1, p2), dt2 = kd(p2, p3);
    let t1x: number, t1y: number, t2x: number, t2y: number;

    if (dt0 < 0.0001) { t1x = (p2.x-p1.x)/dt1; t1y = (p2.y-p1.y)/dt1; }
    else { t1x=(p1.x-p0.x)/dt0-(p2.x-p0.x)/(dt0+dt1)+(p2.x-p1.x)/dt1; t1y=(p1.y-p0.y)/dt0-(p2.y-p0.y)/(dt0+dt1)+(p2.y-p1.y)/dt1; }

    if (dt2 < 0.0001) { t2x = (p2.x-p1.x)/dt1; t2y = (p2.y-p1.y)/dt1; }
    else { t2x=(p2.x-p1.x)/dt1-(p3.x-p1.x)/(dt1+dt2)+(p3.x-p2.x)/dt2; t2y=(p2.y-p1.y)/dt1-(p3.y-p1.y)/(dt1+dt2)+(p3.y-p2.y)/dt2; }

    const cp1x = p1.x + tension * t1x*dt1/3, cp1y = p1.y + tension * t1y*dt1/3;
    const cp2x = p2.x - tension * t2x*dt1/3, cp2y = p2.y - tension * t2y*dt1/3;

    // Omit the last sample on all but the final segment to avoid duplicates.
    const limit = i < segCount - 1 ? sps - 1 : sps;
    for (let j = 0; j < limit; j++) {
      const t = j / (sps - 1);
      const mt = 1 - t;
      result.push({
        x: mt*mt*mt*p1.x + 3*mt*mt*t*cp1x + 3*mt*t*t*cp2x + t*t*t*p2.x,
        y: mt*mt*mt*p1.y + 3*mt*mt*t*cp1y + 3*mt*t*t*cp2y + t*t*t*p2.y,
      });
    }
  }

  return result.length > 0 ? result : pts;
}

// ─── Natural Cubic Spline ─────────────────────────────────────────────────────

// Tridiagonal linear system solver (Thomas algorithm).
// bd=diagonal, bu=upper sub-diagonal, bl=lower sub-diagonal, br=rhs.
// bl[0] is unused (no row above first row).
function _solveTri(
  bd: number[], bu: number[], bl: number[], br: number[],
): number[] {
  const nn = br.length;
  if (nn === 0) return [];
  const c = [...bd], d = [...br], w = [...bu];
  for (let i = 1; i < nn; i++) {
    if (Math.abs(c[i-1]) < 1e-12) continue;
    const m = bl[i] / c[i-1];
    c[i] -= m * w[i-1];
    d[i] -= m * d[i-1];
  }
  const x = new Array(nn).fill(0) as number[];
  if (Math.abs(c[nn-1]) > 1e-12) x[nn-1] = d[nn-1] / c[nn-1];
  for (let i = nn-2; i >= 0; i--) {
    if (Math.abs(c[i]) > 1e-12) x[i] = (d[i] - w[i] * x[i+1]) / c[i];
  }
  return x;
}

// Solve for natural cubic spline second derivatives M_i using chord-length
// parameterisation.  Returns { Mx, My, h (chord lengths), segCount }.
//   closed  → cyclic tridiagonal via Sherman-Morrison (all n M values)
//   clamped → zero-slope endpoints (full n×n system with clamped BCs)
//   natural → M[0]=M[n-1]=0 (interior (n-2)×(n-2) system)
function _solveNaturalCubicM(
  pts: Point2D[],
  closed: boolean,
  clamped: boolean,
): { Mx: number[]; My: number[]; h: number[]; segCount: number } {
  const n = pts.length;
  const segCount = closed ? n : n - 1;
  const h: number[] = [];
  for (let i = 0; i < segCount; i++) {
    const a = pts[i], b = pts[(i+1) % n];
    const dist = Math.sqrt((b.x-a.x)**2 + (b.y-a.y)**2);
    h.push(Math.max(dist, 1e-4));
  }

  const solveDim = (dim: 'x' | 'y'): number[] => {
    const p = pts.map(pt => pt[dim]);

    if (closed) {
      const N = n;
      const diag: number[] = [], upper: number[] = [], lower: number[] = [], rhs: number[] = [];
      for (let i = 0; i < N; i++) {
        const ip = (i-1+N) % N, inext = (i+1) % N;
        diag.push(2*(h[ip]+h[i]));
        upper.push(h[i]);
        lower.push(h[ip]);
        rhs.push(6 * ((p[inext]-p[i])/h[i] - (p[i]-p[ip])/h[ip]));
      }
      if (N === 1) return [0];
      if (N === 2) {
        // 2×2 cyclic: off-diagonal entries double up (column wraps)
        const a00 = diag[0], a01 = upper[0]+lower[0], a10 = upper[1]+lower[1], a11 = diag[1];
        const det = a00*a11 - a01*a10;
        if (Math.abs(det) < 1e-12) return [0, 0];
        return [(a11*rhs[0]-a01*rhs[1])/det, (a00*rhs[1]-a10*rhs[0])/det];
      }
      // Sherman-Morrison: split cyclic coupling into rank-1 correction.
      const gam = -diag[0];
      const Bd = [...diag];
      Bd[0]   = diag[0]   - gam;
      Bd[N-1] = diag[N-1] - upper[N-1]*lower[0]/gam;
      const q    = _solveTri(Bd, upper, lower, rhs);
      const uvec = new Array(N).fill(0) as number[];
      uvec[0] = gam; uvec[N-1] = upper[N-1];
      const z   = _solveTri(Bd, upper, lower, uvec);
      const vtq = q[0] + lower[0]/gam * q[N-1];
      const vtz = z[0] + lower[0]/gam * z[N-1];
      const den = 1 + vtz;
      if (Math.abs(den) < 1e-12) return q;
      const coeff = vtq / den;
      return q.map((qi, i) => qi - coeff * z[i]);

    } else if (clamped) {
      // Not-a-Knot (NaK): 3rd derivative continuous at interior knots 1 and n-2.
      // The cubic polynomial on segment [0,1] matches the one on [1,2] at knot 1,
      // and similarly at knot n-2.  This gives MORE curvature near the endpoints
      // compared to natural (M=0) BCs, which is clearly visible on open shapes.
      // Degenerate fallback to natural for n ≤ 3.
      if (n <= 3) return new Array(n).fill(0) as number[];
      const Ni = n - 2;
      const bd = new Array(Ni).fill(0) as number[];
      const bu = new Array(Ni).fill(0) as number[];
      const bl = new Array(Ni).fill(0) as number[];
      const br = new Array(Ni).fill(0) as number[];
      for (let k = 0; k < Ni; k++) {
        const i = k + 1;
        bl[k] = k > 0    ? h[i-1] : 0;
        bd[k] = 2*(h[i-1]+h[i]);
        bu[k] = k < Ni-1 ? h[i]   : 0;
        br[k] = 6*((p[i+1]-p[i])/h[i] - (p[i]-p[i-1])/h[i-1]);
      }
      // Modify row 0: eliminate M[0] via NaK → M[0] = (1+h0/h1)*M1 − (h0/h1)*M2
      const r0 = h[0] / h[1];
      bd[0] = 3*h[0] + 2*h[1] + h[0]*r0;   // 3h₀+2h₁+h₀²/h₁
      bu[0] = h[1] - h[0]*r0;               // h₁−h₀²/h₁
      // Modify last row: eliminate M[n-1] via NaK → M[n-1] = (1+hL/hL1)*Mn2 − (hL/hL1)*Mn3
      const hL = h[n-2], hL1 = h[n-3];
      const rN = hL / hL1;
      bd[Ni-1] = 2*hL1 + 3*hL + hL*rN;     // 2hL1+3hL+hL²/hL1
      bl[Ni-1] = hL1 - hL*rN;               // hL1−hL²/hL1
      const inner = _solveTri(bd, bu, bl, br);
      // Recover endpoint moments from the NaK constraints
      const M0 = (1 + r0)*inner[0]      - r0*inner[1];
      const MN = (1 + rN)*inner[Ni-1]   - rN*inner[Ni-2];
      return [M0, ...inner, MN];

    } else {
      // Natural BCs: M[0] = M[n-1] = 0; solve for interior points only.
      if (n <= 2) return new Array(n).fill(0) as number[];
      const Ni = n-2;
      const bd = new Array(Ni).fill(0) as number[];
      const bu = new Array(Ni).fill(0) as number[];
      const bl = new Array(Ni).fill(0) as number[];
      const br = new Array(Ni).fill(0) as number[];
      for (let k = 0; k < Ni; k++) {
        bl[k] = k > 0    ? h[k]   : 0;
        bd[k] = 2*(h[k]+h[k+1]);
        bu[k] = k < Ni-1 ? h[k+1] : 0;
        br[k] = 6*((p[k+2]-p[k+1])/h[k+1] - (p[k+1]-p[k])/h[k]);
      }
      const inner = _solveTri(bd, bu, bl, br);
      return [0, ...inner, 0];
    }
  };

  return { Mx: solveDim('x'), My: solveDim('y'), h, segCount };
}

// Natural Cubic Spline — interpolating spline using second-derivative (moment) formulation.
//   closed  → cyclic system via Sherman-Morrison; passes through all points cyclically.
//   clamped → zero first-derivative at both endpoints (open shapes only).
// Renders each segment as a cubic Bézier via bezierCurveTo.
export function applyNaturalCubicSpline(
  ctx: DrawCtx,
  pts: Point2D[],
  closed: boolean,
  clamped: boolean,
): void {
  const n = pts.length;
  if (n === 0) return;
  if (n === 1) { ctx.moveTo(pts[0].x, pts[0].y); return; }
  if (n === 2) {
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    if (closed) ctx.closePath();
    return;
  }
  const { Mx, My, h, segCount } = _solveNaturalCubicM(pts, closed, clamped);
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < segCount; i++) {
    const j = (i+1) % n;
    const pi = pts[i], pj = pts[j], hi = h[i];
    const Mix = Mx[i], Mjx = Mx[j], Miy = My[i], Mjy = My[j];
    // Tangent at pᵢ: (pⱼ-pᵢ)/hᵢ − hᵢ(2Mᵢ+Mⱼ)/6
    const tx1x = (pj.x-pi.x)/hi - hi*(2*Mix+Mjx)/6;
    const tx1y = (pj.y-pi.y)/hi - hi*(2*Miy+Mjy)/6;
    // Tangent at pⱼ: (pⱼ-pᵢ)/hᵢ + hᵢ(Mᵢ+2Mⱼ)/6
    const tx2x = (pj.x-pi.x)/hi + hi*(Mix+2*Mjx)/6;
    const tx2y = (pj.y-pi.y)/hi + hi*(Miy+2*Mjy)/6;
    ctx.bezierCurveTo(
      pi.x + (hi/3)*tx1x, pi.y + (hi/3)*tx1y,
      pj.x - (hi/3)*tx2x, pj.y - (hi/3)*tx2y,
      pj.x, pj.y,
    );
  }
  if (closed) ctx.closePath();
}

// Sample n points uniformly along a natural cubic spline — used by wire overlay.
export function sampleNaturalCubicPoints(
  pts: Point2D[],
  n: number,
  closed: boolean,
  clamped: boolean,
): Point2D[] {
  const np = pts.length;
  if (np < 2 || n < 2) return pts;
  const { Mx, My, h, segCount } = _solveNaturalCubicM(pts, closed, clamped);
  const sps = Math.max(2, Math.ceil(n / segCount));
  const result: Point2D[] = [];
  for (let i = 0; i < segCount; i++) {
    const j = (i+1) % np;
    const pi = pts[i], pj = pts[j], hi = h[i];
    const Mix = Mx[i], Mjx = Mx[j], Miy = My[i], Mjy = My[j];
    const tx1x = (pj.x-pi.x)/hi - hi*(2*Mix+Mjx)/6;
    const tx1y = (pj.y-pi.y)/hi - hi*(2*Miy+Mjy)/6;
    const tx2x = (pj.x-pi.x)/hi + hi*(Mix+2*Mjx)/6;
    const tx2y = (pj.y-pi.y)/hi + hi*(Miy+2*Mjy)/6;
    const cp1x = pi.x+(hi/3)*tx1x, cp1y = pi.y+(hi/3)*tx1y;
    const cp2x = pj.x-(hi/3)*tx2x, cp2y = pj.y-(hi/3)*tx2y;
    const limit = i < segCount-1 ? sps-1 : sps;
    for (let k = 0; k < limit; k++) {
      const t = k/(sps-1), mt = 1-t;
      result.push({
        x: mt*mt*mt*pi.x + 3*mt*mt*t*cp1x + 3*mt*t*t*cp2x + t*t*t*pj.x,
        y: mt*mt*mt*pi.y + 3*mt*mt*t*cp1y + 3*mt*t*t*cp2y + t*t*t*pj.y,
      });
    }
  }
  return result.length > 0 ? result : pts;
}

// Top-level entry point used by all renderers when renderModeOverride is active.
// Branches on smoothAlgorithm: 'catmull-rom' uses applyCatmullRom; 'chaikin'
// (default) uses the existing Chaikin-subdivision + tension path.
export function drawContourWithConfig(
  ctx: DrawCtx,
  pts: Point2D[],
  config: RenderModeOverride,
): void {
  const algo = config.smoothAlgorithm ?? 'chaikin';

  let pts2 =
    config.resample.enabled && config.resample.count >= 3
      ? resampleContour(pts, config.resample.count)
      : pts;

  if (algo === 'catmull-rom') {
    applyCatmullRom(ctx, pts2, config.catmullAlpha ?? 0.5, true, config.tension ?? 1);
    return;
  }

  if (algo === 'natural-cubic') {
    applyNaturalCubicSpline(ctx, pts2, true, config.naturalCubicClamped ?? false);
    return;
  }

  // Chaikin path (default).
  const extraPasses = Math.max(0, Math.min(5, (config.passes ?? 1) - 1));
  for (let i = 0; i < extraPasses; i++) {
    pts2 = chaikinSubdivide(pts2);
  }
  applyTension(ctx, pts2, config.tension);
}

// Canonical JS source for inlining into Puppeteer HTML templates.
// Update this string whenever the algorithm above changes.
export const RENDER_MODE_UTILS_JS = `
function resampleContour(pts, n) {
  if (n <= 0 || !pts || pts.length === 0) return [];
  if (n === 1) return [{ x: pts[0].x, y: pts[0].y }];
  if (pts.length === 1) { var r=[]; for(var i=0;i<n;i++) r.push({x:pts[0].x,y:pts[0].y}); return r; }
  var numSegs=pts.length, segLens=[], totalLen=0;
  for(var i=0;i<numSegs;i++){
    var a=pts[i],b=pts[(i+1)%numSegs];
    var len=Math.sqrt((b.x-a.x)*(b.x-a.x)+(b.y-a.y)*(b.y-a.y));
    segLens.push(len); totalLen+=len;
  }
  if(totalLen===0){ var r=[]; for(var i=0;i<n;i++) r.push({x:pts[0].x,y:pts[0].y}); return r; }
  var result=[];
  for(var i=0;i<n;i++){
    var target=(i/n)*totalLen, accum=0, si=0;
    while(si<numSegs-1 && accum+segLens[si]<target){ accum+=segLens[si]; si++; }
    var t=segLens[si]>0?Math.min(1,(target-accum)/segLens[si]):0;
    var a=pts[si],b=pts[(si+1)%numSegs];
    result.push({x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t});
  }
  return result;
}
function applyTension(ctx, pts, tension) {
  if(!pts||pts.length===0) return;
  if(pts.length<3){
    ctx.moveTo(pts[0].x,pts[0].y);
    for(var k=1;k<pts.length;k++) ctx.lineTo(pts[k].x,pts[k].y);
    ctx.closePath(); return;
  }
  var t=Math.max(0,Math.min(1,tension)), n=pts.length;
  for(var si=0;si<n;si++){
    var p0=pts[(si-1+n)%n], p1=pts[si], p2=pts[(si+1)%n];
    var mx1x=(p0.x+p1.x)/2, mx1y=(p0.y+p1.y)/2;
    var mx2x=(p1.x+p2.x)/2, mx2y=(p1.y+p2.y)/2;
    if(si===0) ctx.moveTo(mx1x,mx1y);
    if(t<0.001){ ctx.lineTo(mx2x,mx2y); }
    else {
      var ncx=(mx1x+mx2x)/2, ncy=(mx1y+mx2y)/2;
      ctx.quadraticCurveTo(ncx+t*(p1.x-ncx), ncy+t*(p1.y-ncy), mx2x, mx2y);
    }
  }
  ctx.closePath();
}
function addSmooth(ctx, pts) { applyTension(ctx, pts, 1); }
function chaikinSubdivide(pts) {
  var n=pts.length; if(n<3) return pts;
  var out=[];
  for(var i=0;i<n;i++){
    var a=pts[i],b=pts[(i+1)%n];
    out.push({x:0.75*a.x+0.25*b.x,y:0.75*a.y+0.25*b.y});
    out.push({x:0.25*a.x+0.75*b.x,y:0.25*a.y+0.75*b.y});
  }
  return out;
}
function applyCatmullRom(ctx, pts, alpha, closed, tension) {
  var tn=(tension!=null)?tension:1;
  var n=pts.length;
  if(n===0) return;
  if(n<2){ctx.moveTo(pts[0].x,pts[0].y);if(closed)ctx.closePath();return;}
  if(n===2){ctx.moveTo(pts[0].x,pts[0].y);ctx.lineTo(pts[1].x,pts[1].y);if(closed)ctx.closePath();return;}
  var a=Math.max(0,Math.min(1,alpha));
  function kd(p,q){if(a===0)return 1;var dx=q.x-p.x,dy=q.y-p.y,d=Math.sqrt(dx*dx+dy*dy);return d<0.0001?0.0001:Math.pow(d,a);}
  var pStart={x:2*pts[0].x-pts[1].x,y:2*pts[0].y-pts[1].y};
  var pEnd={x:2*pts[n-1].x-pts[n-2].x,y:2*pts[n-1].y-pts[n-2].y};
  var segCount=closed?n:n-1;
  ctx.moveTo(pts[0].x,pts[0].y);
  for(var i=0;i<segCount;i++){
    var p0,p1,p2,p3;
    if(closed){p0=pts[(i-1+n)%n];p1=pts[i];p2=pts[(i+1)%n];p3=pts[(i+2)%n];}
    else{p0=i===0?pStart:pts[i-1];p1=pts[i];p2=pts[i+1];p3=i===n-2?pEnd:pts[i+2];}
    var dt0=kd(p0,p1),dt1=kd(p1,p2),dt2=kd(p2,p3);
    var t1x,t1y,t2x,t2y;
    if(dt0<0.0001){t1x=(p2.x-p1.x)/dt1;t1y=(p2.y-p1.y)/dt1;}
    else{t1x=(p1.x-p0.x)/dt0-(p2.x-p0.x)/(dt0+dt1)+(p2.x-p1.x)/dt1;t1y=(p1.y-p0.y)/dt0-(p2.y-p0.y)/(dt0+dt1)+(p2.y-p1.y)/dt1;}
    if(dt2<0.0001){t2x=(p2.x-p1.x)/dt1;t2y=(p2.y-p1.y)/dt1;}
    else{t2x=(p2.x-p1.x)/dt1-(p3.x-p1.x)/(dt1+dt2)+(p3.x-p2.x)/dt2;t2y=(p2.y-p1.y)/dt1-(p3.y-p1.y)/(dt1+dt2)+(p3.y-p2.y)/dt2;}
    var cp1x=p1.x+tn*t1x*dt1/3,cp1y=p1.y+tn*t1y*dt1/3;
    var cp2x=p2.x-tn*t2x*dt1/3,cp2y=p2.y-tn*t2y*dt1/3;
    ctx.bezierCurveTo(cp1x,cp1y,cp2x,cp2y,p2.x,p2.y);
  }
  if(closed)ctx.closePath();
}
function sampleCatmullRomPoints(pts, n, alpha, closed, tension) {
  var tn=(tension!=null)?tension:1;
  var pnts=pts.length;
  if(pnts<2||n<2) return pts;
  var a=Math.max(0,Math.min(1,alpha));
  function kd(p,q){if(a===0)return 1;var dx=q.x-p.x,dy=q.y-p.y,d=Math.sqrt(dx*dx+dy*dy);return d<0.0001?0.0001:Math.pow(d,a);}
  var pStart={x:2*pts[0].x-pts[1].x,y:2*pts[0].y-pts[1].y};
  var pEnd={x:2*pts[pnts-1].x-pts[pnts-2].x,y:2*pts[pnts-1].y-pts[pnts-2].y};
  var segCount=closed?pnts:pnts-1;
  var sps=Math.max(2,Math.ceil(n/segCount));
  var result=[];
  for(var i=0;i<segCount;i++){
    var p0,p1,p2,p3;
    if(closed){p0=pts[(i-1+pnts)%pnts];p1=pts[i];p2=pts[(i+1)%pnts];p3=pts[(i+2)%pnts];}
    else{p0=i===0?pStart:pts[i-1];p1=pts[i];p2=pts[i+1];p3=i===pnts-2?pEnd:pts[i+2];}
    var dt0=kd(p0,p1),dt1=kd(p1,p2),dt2=kd(p2,p3);
    var t1x,t1y,t2x,t2y;
    if(dt0<0.0001){t1x=(p2.x-p1.x)/dt1;t1y=(p2.y-p1.y)/dt1;}
    else{t1x=(p1.x-p0.x)/dt0-(p2.x-p0.x)/(dt0+dt1)+(p2.x-p1.x)/dt1;t1y=(p1.y-p0.y)/dt0-(p2.y-p0.y)/(dt0+dt1)+(p2.y-p1.y)/dt1;}
    if(dt2<0.0001){t2x=(p2.x-p1.x)/dt1;t2y=(p2.y-p1.y)/dt1;}
    else{t2x=(p2.x-p1.x)/dt1-(p3.x-p1.x)/(dt1+dt2)+(p3.x-p2.x)/dt2;t2y=(p2.y-p1.y)/dt1-(p3.y-p1.y)/(dt1+dt2)+(p3.y-p2.y)/dt2;}
    var cp1x=p1.x+tn*t1x*dt1/3,cp1y=p1.y+tn*t1y*dt1/3;
    var cp2x=p2.x-tn*t2x*dt1/3,cp2y=p2.y-tn*t2y*dt1/3;
    var limit=i<segCount-1?sps-1:sps;
    for(var j=0;j<limit;j++){
      var t=j/(sps-1),mt=1-t;
      result.push({x:mt*mt*mt*p1.x+3*mt*mt*t*cp1x+3*mt*t*t*cp2x+t*t*t*p2.x,y:mt*mt*mt*p1.y+3*mt*mt*t*cp1y+3*mt*t*t*cp2y+t*t*t*p2.y});
    }
  }
  return result.length>0?result:pts;
}
function _solveTri(bd,bu,bl,br){var nn=br.length;if(nn===0)return[];var c=bd.slice(),d=br.slice(),w=bu.slice();for(var i=1;i<nn;i++){if(Math.abs(c[i-1])<1e-12)continue;var m=bl[i]/c[i-1];c[i]-=m*w[i-1];d[i]-=m*d[i-1];}var x=new Array(nn).fill(0);if(Math.abs(c[nn-1])>1e-12)x[nn-1]=d[nn-1]/c[nn-1];for(var i=nn-2;i>=0;i--){if(Math.abs(c[i])>1e-12)x[i]=(d[i]-w[i]*x[i+1])/c[i];}return x;}
function _solveNaturalCubicM(pts,closed,clamped){
  var n=pts.length,segCount=closed?n:n-1,h=[];
  for(var i=0;i<segCount;i++){var a=pts[i],b=pts[(i+1)%n],dd=Math.sqrt((b.x-a.x)*(b.x-a.x)+(b.y-a.y)*(b.y-a.y));h.push(Math.max(dd,1e-4));}
  function solveDim(dim){
    var p=pts.map(function(pt){return pt[dim];});
    if(closed){
      var N=n,diag=[],upper=[],lower=[],rhs=[];
      for(var i=0;i<N;i++){var ip=(i-1+N)%N,inxt=(i+1)%N;diag.push(2*(h[ip]+h[i]));upper.push(h[i]);lower.push(h[ip]);rhs.push(6*((p[inxt]-p[i])/h[i]-(p[i]-p[ip])/h[ip]));}
      if(N===1)return[0];
      if(N===2){var a00=diag[0],a01=upper[0]+lower[0],a10=upper[1]+lower[1],a11=diag[1],det=a00*a11-a01*a10;if(Math.abs(det)<1e-12)return[0,0];return[(a11*rhs[0]-a01*rhs[1])/det,(a00*rhs[1]-a10*rhs[0])/det];}
      var gam=-diag[0],Bd=diag.slice();Bd[0]=diag[0]-gam;Bd[N-1]=diag[N-1]-upper[N-1]*lower[0]/gam;
      var q=_solveTri(Bd,upper,lower,rhs),uv=new Array(N).fill(0);uv[0]=gam;uv[N-1]=upper[N-1];
      var z=_solveTri(Bd,upper,lower,uv),vtq=q[0]+lower[0]/gam*q[N-1],vtz=z[0]+lower[0]/gam*z[N-1],den=1+vtz;
      if(Math.abs(den)<1e-12)return q;
      var coeff=vtq/den;return q.map(function(qi,idx){return qi-coeff*z[idx];});
    }else if(clamped){
      if(n<=3)return new Array(n).fill(0);
      var Ni=n-2,bdn=new Array(Ni).fill(0),bun=new Array(Ni).fill(0),bln=new Array(Ni).fill(0),brn=new Array(Ni).fill(0);
      for(var k=0;k<Ni;k++){var ii=k+1;bln[k]=k>0?h[ii-1]:0;bdn[k]=2*(h[ii-1]+h[ii]);bun[k]=k<Ni-1?h[ii]:0;brn[k]=6*((p[ii+1]-p[ii])/h[ii]-(p[ii]-p[ii-1])/h[ii-1]);}
      var r0=h[0]/h[1];bdn[0]=3*h[0]+2*h[1]+h[0]*r0;bun[0]=h[1]-h[0]*r0;
      var hL=h[n-2],hL1=h[n-3],rN=hL/hL1;bdn[Ni-1]=2*hL1+3*hL+hL*rN;bln[Ni-1]=hL1-hL*rN;
      var inner=_solveTri(bdn,bun,bln,brn);
      var M0=(1+r0)*inner[0]-r0*inner[1],MN=(1+rN)*inner[Ni-1]-rN*inner[Ni-2];
      return [M0].concat(inner).concat([MN]);
    }else{
      if(n<=2)return new Array(n).fill(0);
      var Ni=n-2,bdn=new Array(Ni).fill(0),bun=new Array(Ni).fill(0),bln=new Array(Ni).fill(0),brn=new Array(Ni).fill(0);
      for(var k=0;k<Ni;k++){bln[k]=k>0?h[k]:0;bdn[k]=2*(h[k]+h[k+1]);bun[k]=k<Ni-1?h[k+1]:0;brn[k]=6*((p[k+2]-p[k+1])/h[k+1]-(p[k+1]-p[k])/h[k]);}
      var inner=_solveTri(bdn,bun,bln,brn);return[0].concat(inner).concat([0]);
    }
  }
  return{Mx:solveDim('x'),My:solveDim('y'),h:h,segCount:segCount};
}
function applyNaturalCubicSpline(ctx,pts,closed,clamped){
  var n=pts.length;if(n===0)return;
  if(n===1){ctx.moveTo(pts[0].x,pts[0].y);return;}
  if(n===2){ctx.moveTo(pts[0].x,pts[0].y);ctx.lineTo(pts[1].x,pts[1].y);if(closed)ctx.closePath();return;}
  var sol=_solveNaturalCubicM(pts,closed,clamped),Mx=sol.Mx,My=sol.My,h=sol.h,segCount=sol.segCount;
  ctx.moveTo(pts[0].x,pts[0].y);
  for(var i=0;i<segCount;i++){
    var j=(i+1)%n,pi=pts[i],pj=pts[j],hi=h[i],Mix=Mx[i],Mjx=Mx[j],Miy=My[i],Mjy=My[j];
    var tx1x=(pj.x-pi.x)/hi-hi*(2*Mix+Mjx)/6,tx1y=(pj.y-pi.y)/hi-hi*(2*Miy+Mjy)/6;
    var tx2x=(pj.x-pi.x)/hi+hi*(Mix+2*Mjx)/6,tx2y=(pj.y-pi.y)/hi+hi*(Miy+2*Mjy)/6;
    ctx.bezierCurveTo(pi.x+(hi/3)*tx1x,pi.y+(hi/3)*tx1y,pj.x-(hi/3)*tx2x,pj.y-(hi/3)*tx2y,pj.x,pj.y);
  }
  if(closed)ctx.closePath();
}
function sampleNaturalCubicPoints(pts,n,closed,clamped){
  var np=pts.length;if(np<2||n<2)return pts;
  var sol=_solveNaturalCubicM(pts,closed,clamped),Mx=sol.Mx,My=sol.My,h=sol.h,segCount=sol.segCount;
  var sps=Math.max(2,Math.ceil(n/segCount)),result=[];
  for(var i=0;i<segCount;i++){
    var j=(i+1)%np,pi=pts[i],pj=pts[j],hi=h[i],Mix=Mx[i],Mjx=Mx[j],Miy=My[i],Mjy=My[j];
    var tx1x=(pj.x-pi.x)/hi-hi*(2*Mix+Mjx)/6,tx1y=(pj.y-pi.y)/hi-hi*(2*Miy+Mjy)/6;
    var tx2x=(pj.x-pi.x)/hi+hi*(Mix+2*Mjx)/6,tx2y=(pj.y-pi.y)/hi+hi*(Miy+2*Mjy)/6;
    var cp1x=pi.x+(hi/3)*tx1x,cp1y=pi.y+(hi/3)*tx1y,cp2x=pj.x-(hi/3)*tx2x,cp2y=pj.y-(hi/3)*tx2y;
    var limit=i<segCount-1?sps-1:sps;
    for(var k=0;k<limit;k++){var t=k/(sps-1),mt=1-t;result.push({x:mt*mt*mt*pi.x+3*mt*mt*t*cp1x+3*mt*t*t*cp2x+t*t*t*pj.x,y:mt*mt*mt*pi.y+3*mt*mt*t*cp1y+3*mt*t*t*cp2y+t*t*t*pj.y});}
  }
  return result.length>0?result:pts;
}
function drawContourWithConfig(ctx, pts, config) {
  var algo=(config&&config.smoothAlgorithm)?config.smoothAlgorithm:'chaikin';
  var pts2=(config&&config.resample&&config.resample.enabled&&config.resample.count>=3)
    ? resampleContour(pts, config.resample.count) : pts;
  if(algo==='catmull-rom'){
    applyCatmullRom(ctx, pts2, (config&&config.catmullAlpha!=null)?config.catmullAlpha:0.5, true, (config&&config.tension!=null)?config.tension:1);
    return;
  }
  if(algo==='natural-cubic'){
    applyNaturalCubicSpline(ctx, pts2, true, (config&&config.naturalCubicClamped)?config.naturalCubicClamped:false);
    return;
  }
  var extra=Math.max(0,Math.min(5,(config&&config.passes!=null?config.passes:1)-1));
  for(var i=0;i<extra;i++) pts2=chaikinSubdivide(pts2);
  applyTension(ctx, pts2, (config&&config.tension!=null)?config.tension:1);
}
function resolveWireColor(colorSource, explicitColor, fillColor, strokeColor) {
  if (colorSource === 'inherit-stroke') return (strokeColor && strokeColor !== 'none') ? strokeColor : '#000000';
  if (colorSource === 'inherit-fill')   return (fillColor   && fillColor   !== 'none') ? fillColor   : '#ffffff';
  return explicitColor;
}
function resolveWireOpacity(opacitySource, explicitOpacity, fillOpacity, strokeOpacity) {
  if (opacitySource === 'inherit-fill')   return fillOpacity   != null ? fillOpacity   : 1;
  if (opacitySource === 'inherit-stroke') return strokeOpacity != null ? strokeOpacity : 1;
  return explicitOpacity != null ? explicitOpacity : 1;
}
function _parseColorToRgba(color) {
  var c = (color || '#ffffff').trim();
  if (c.charAt(0) === '#') {
    var h = c.slice(1);
    if (h.length === 3 || h.length === 4) {
      return { r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16), a: h.length===4?parseInt(h[3]+h[3],16)/255:1 };
    }
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16), a: h.length>=8?parseInt(h.slice(6,8),16)/255:1 };
  }
  var m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4]!==undefined?+m[4]:1 };
  return { r: 255, g: 255, b: 255, a: 1 };
}
function _rgbaToHex(c) {
  var r=Math.max(0,Math.min(255,Math.round(c.r))); var g=Math.max(0,Math.min(255,Math.round(c.g))); var b=Math.max(0,Math.min(255,Math.round(c.b)));
  return '#'+[r,g,b].map(function(v){var s=v.toString(16);return s.length<2?'0'+s:s;}).join('');
}
function _lerpRgba(c1,c2,t){ return {r:c1.r+(c2.r-c1.r)*t,g:c1.g+(c2.g-c1.g)*t,b:c1.b+(c2.b-c1.b)*t,a:c1.a+(c2.a-c1.a)*t}; }
function _sampleGradientStops(stops, t) {
  t=Math.max(0,Math.min(1,t));
  if(!stops||stops.length===0) return '#ffffff';
  if(stops.length===1) return stops[0].color;
  if(t<=stops[0].offset) return stops[0].color;
  if(t>=stops[stops.length-1].offset) return stops[stops.length-1].color;
  for(var i=0;i<stops.length-1;i++){
    if(t>=stops[i].offset&&t<=stops[i+1].offset){
      var span=stops[i+1].offset-stops[i].offset;
      var lt=span===0?0:(t-stops[i].offset)/span;
      return _rgbaToHex(_lerpRgba(_parseColorToRgba(stops[i].color),_parseColorToRgba(stops[i+1].color),lt));
    }
  }
  return stops[stops.length-1].color;
}
function _sampleGradientAtPoint(pt, bounds, gradient) {
  var stops=gradient.stops||[];
  if(gradient.type==='linear'){
    var angle=((gradient.angle||0)*Math.PI)/180;
    var dx=Math.cos(angle), dy=Math.sin(angle);
    var cx=bounds.x+bounds.width/2, cy=bounds.y+bounds.height/2;
    var halfDiag=Math.sqrt(bounds.width*bounds.width+bounds.height*bounds.height)/2;
    if(halfDiag===0) return _sampleGradientStops(stops,0.5);
    var proj=((pt.x-cx)*dx+(pt.y-cy)*dy)/halfDiag;
    return _sampleGradientStops(stops,(proj+1)/2);
  }
  if(gradient.type==='radial'){
    var rcx=bounds.x+(bounds.width*(gradient.radialCenterX!=null?gradient.radialCenterX:50))/100;
    var rcy=bounds.y+(bounds.height*(gradient.radialCenterY!=null?gradient.radialCenterY:50))/100;
    var outerR=Math.sqrt(bounds.width*bounds.width+bounds.height*bounds.height)/2;
    if(outerR===0) return _sampleGradientStops(stops,0);
    var dist=Math.sqrt((pt.x-rcx)*(pt.x-rcx)+(pt.y-rcy)*(pt.y-rcy));
    return _sampleGradientStops(stops,dist/outerR);
  }
  return '#ffffff';
}
var _OPEN_SHAPE_TYPES = {line:1,'line-vector':1,bezier:1,cubic:1};
function _resampleOpenContour(pts, n) {
  if(n<=0||!pts||pts.length===0) return [];
  if(n===1) return [{x:pts[0].x,y:pts[0].y}];
  if(pts.length===1){var r=[];for(var i=0;i<n;i++) r.push({x:pts[0].x,y:pts[0].y});return r;}
  var segLens=[],totalLen=0;
  for(var i=0;i<pts.length-1;i++){
    var a=pts[i],b=pts[i+1];
    var len=Math.sqrt((b.x-a.x)*(b.x-a.x)+(b.y-a.y)*(b.y-a.y));
    segLens.push(len); totalLen+=len;
  }
  if(totalLen===0){var r=[];for(var i=0;i<n;i++) r.push({x:pts[0].x,y:pts[0].y});return r;}
  var result=[];
  for(var i=0;i<n;i++){
    var target=(i/(n-1))*totalLen, accum=0, si=0;
    while(si<segLens.length-1&&accum+segLens[si]<target){accum+=segLens[si];si++;}
    var t=segLens[si]>0?Math.min(1,(target-accum)/segLens[si]):0;
    var a=pts[si],b=pts[si+1]||pts[si];
    result.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  }
  return result;
}
function drawWirePass(ctx, shape, wireConfig, renderModeConfig) {
  if (!wireConfig || !wireConfig.enabled) return;
  var pts = shape.points;
  if (!pts || pts.length === 0) return;
  var isOpen = !!_OPEN_SHAPE_TYPES[shape.type];
  var rmc = renderModeConfig || shape.renderModeOverride;
  if (rmc && rmc.enabled && rmc.resample && rmc.resample.enabled && rmc.resample.count >= 3) {
    pts = isOpen ? _resampleOpenContour(pts, rmc.resample.count) : resampleContour(pts, rmc.resample.count);
  }
  if (rmc && rmc.enabled && (!rmc.smoothAlgorithm || rmc.smoothAlgorithm === 'chaikin') && !isOpen) {
    var extraPasses=Math.max(0,Math.min(5,(rmc.passes!=null?rmc.passes:1)-1));
    for(var _wpi=0;_wpi<extraPasses;_wpi++) pts=chaikinSubdivide(pts);
  } else if (rmc && rmc.enabled && rmc.smoothAlgorithm === 'catmull-rom') {
    pts=sampleCatmullRomPoints(pts,Math.max(64,pts.length*8),(rmc.catmullAlpha!=null?rmc.catmullAlpha:0.5),!isOpen,(rmc.tension!=null?rmc.tension:1));
  } else if (rmc && rmc.enabled && rmc.smoothAlgorithm === 'natural-cubic') {
    pts=sampleNaturalCubicPoints(pts,Math.max(64,pts.length*8),!isOpen,(rmc.naturalCubicClamped!=null?rmc.naturalCubicClamped:false));
  }
  var fillColor    = (shape.properties.fillColor   === 'none') ? '#ffffff' : shape.properties.fillColor;
  var strokeColor  = (shape.properties.strokeColor === 'none') ? '#000000' : shape.properties.strokeColor;
  var fillOpacity  = shape.properties.fillOpacity  != null ? shape.properties.fillOpacity  : 1;
  var strokeOpacity = shape.properties.strokeOpacity != null ? shape.properties.strokeOpacity : 1;
  var gradient = (shape.properties.gradient && shape.properties.gradient.type && shape.properties.gradient.type !== 'diamond') ? shape.properties.gradient : null;
  var bounds = {x:0,y:0,width:0,height:0};
  if (gradient) {
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(var _bi=0;_bi<pts.length;_bi++){minX=Math.min(minX,pts[_bi].x);minY=Math.min(minY,pts[_bi].y);maxX=Math.max(maxX,pts[_bi].x);maxY=Math.max(maxY,pts[_bi].y);}
    bounds={x:minX,y:minY,width:maxX-minX,height:maxY-minY};
  }
  var drawConn = wireConfig.render === 'connections' || wireConfig.render === 'combined';
  var drawPts  = wireConfig.render === 'points'      || wireConfig.render === 'combined';
  if (drawConn && pts.length >= 2) {
    var ccfg = wireConfig.connections;
    ctx.lineWidth   = ccfg.thickness != null ? ccfg.thickness : 1;
    ctx.globalAlpha = resolveWireOpacity(ccfg.opacitySource, ccfg.opacity != null ? ccfg.opacity : 1, fillOpacity, strokeOpacity);
    if (ccfg.colorSource === 'inherit-fill' && gradient) {
      var segCount = isOpen ? pts.length-1 : pts.length;
      for(var _ci=0;_ci<segCount;_ci++){
        var _ca=pts[_ci], _cb=pts[(_ci+1)%pts.length];
        var _cmid={x:(_ca.x+_cb.x)/2,y:(_ca.y+_cb.y)/2};
        ctx.beginPath(); ctx.moveTo(_ca.x,_ca.y); ctx.lineTo(_cb.x,_cb.y);
        ctx.strokeStyle=_sampleGradientAtPoint(_cmid,bounds,gradient);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = resolveWireColor(ccfg.colorSource, ccfg.color, fillColor, strokeColor);
      ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
      for(var _cli=1;_cli<pts.length;_cli++) ctx.lineTo(pts[_cli].x,pts[_cli].y);
      if(!isOpen) ctx.closePath();
      ctx.stroke();
    }
  }
  if (drawPts && pts.length > 0) {
    var pcfg = wireConfig.points;
    var radius = (pcfg.size != null ? pcfg.size : 4) / 2;
    ctx.globalAlpha = resolveWireOpacity(pcfg.opacitySource, pcfg.opacity != null ? pcfg.opacity : 1, fillOpacity, strokeOpacity);
    if (pcfg.colorSource === 'inherit-fill' && gradient) {
      for(var _pi=0;_pi<pts.length;_pi++){
        ctx.fillStyle=_sampleGradientAtPoint(pts[_pi],bounds,gradient);
        ctx.beginPath(); ctx.arc(pts[_pi].x,pts[_pi].y,radius,0,Math.PI*2); ctx.fill();
      }
    } else {
      ctx.fillStyle = resolveWireColor(pcfg.colorSource, pcfg.color, fillColor, strokeColor);
      for(var _ppi=0;_ppi<pts.length;_ppi++){
        ctx.beginPath(); ctx.arc(pts[_ppi].x,pts[_ppi].y,radius,0,Math.PI*2); ctx.fill();
      }
    }
  }
}
`;
