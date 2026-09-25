import { createCanvas, CanvasRenderingContext2D, Canvas as NodeCanvas } from 'canvas';
import { Shape } from './shapeGenerator';
import { drawShapeToContext, type ShapeRenderData, type OffscreenCanvasFactory } from '../../shared/shapeRenderer';
import { applyLocalJitter, shapeIdToHash } from '../../shared/roughnessUtils';
import { evaluateStrokeProfile, computeNormals, computeArcLengths } from '../../shared/strokeUtils';
import { resampleContour, drawWirePass } from '../../shared/renderModeUtils';
import { blurShapePixels, type ShapeBlurType } from '../../shared/shapeBlur';

/**
 * Main rendering function for shapes on the server-side using node-canvas
 * This matches the client-side rendering pixel-perfect
 */
export function renderShape(ctx: CanvasRenderingContext2D, shape: Shape, skipSelectionAdornments = false): void {
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
  
  // Check if blur should be applied
  if (shape.properties.blurRadius > 0) {
    renderWithCanvasBlur(ctx, shape);
  } else {
    // Draw shape normally
    drawShape(ctx, shape);
  }
  
  ctx.restore();
}

/**
 * Render shape with blur effect using box blur approximation
 */
function renderWithCanvasBlur(ctx: CanvasRenderingContext2D, shape: Shape): void {
  // Get the bounds of the shape for blur calculation
  const bounds = getBounds(shape);
  const blurRadius = Math.max(0, shape.properties.blurRadius);
  
  // Expand bounds to account for blur effect
  const expandedBounds = {
    x: bounds.x - blurRadius * 2,
    y: bounds.y - blurRadius * 2,
    width: bounds.width + blurRadius * 4,
    height: bounds.height + blurRadius * 4
  };
  
  // Create temporary canvas for shape rendering using node-canvas
  const tempCanvas = createCanvas(expandedBounds.width, expandedBounds.height);
  const tempCtx = tempCanvas.getContext('2d');
  
  // Save current transform and translate temp context
  tempCtx.translate(-expandedBounds.x, -expandedBounds.y);
  
  // Draw shape on temporary canvas without transforms (they're already applied)
  tempCtx.save();
  drawShape(tempCtx, shape);
  tempCtx.restore();
  
  // Apply blur effect to the temporary canvas
  const blurredImageData = applyGaussianBlur(tempCtx, tempCanvas.width, tempCanvas.height, blurRadius, shape.properties.blurType ?? 'box');
  
  // Draw the blurred result back to the main canvas
  const blurredCanvas = createCanvas(tempCanvas.width, tempCanvas.height);
  const blurredCtx = blurredCanvas.getContext('2d');
  blurredCtx.putImageData(blurredImageData, 0, 0);
  
  // Draw blurred result to main canvas
  ctx.drawImage(blurredCanvas, expandedBounds.x, expandedBounds.y);
}

/**
 * Apply Gaussian blur using box blur approximation (3 passes)
 */
function applyGaussianBlur(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number, type: ShapeBlurType = 'box') {
  const imageData = ctx.getImageData(0, 0, width, height);
  blurShapePixels(imageData.data, width, height, radius, type);
  return imageData;
}

/**
 * Main shape drawing function - delegates to shared renderer
 */
function drawShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  const nodeCanvasFactory: OffscreenCanvasFactory = (w, h) =>
    createCanvas(w, h) as unknown as ReturnType<OffscreenCanvasFactory>;

  // Shapes with server-specific stroke overrides (parameterised profile / squiggle) must
  // suppress the standard applyShapeStroke call inside drawShapeToContext so the shared
  // renderer doesn't draw a plain outline before we apply the correct stroke type below.
  const hasSpecialStroke =
    !!shape.strokeProfile || (shape.strokePattern ?? 'none') === 'squiggle';

  const shapeForContext: ShapeRenderData = hasSpecialStroke
    ? { ...(shape as unknown as ShapeRenderData), properties: { ...(shape.properties as any), strokeColor: 'none' } }
    : (shape as unknown as ShapeRenderData);

  drawShapeToContext(ctx as any, shapeForContext, nodeCanvasFactory);

  // Server-specific stroke overrides (parameterised profile / squiggle).
  if (hasSpecialStroke && shape.properties.strokeColor !== 'none' && shape.properties.strokeWidth > 0) {
    ctx.globalAlpha = shape.properties.strokeOpacity;
    ctx.strokeStyle = shape.properties.strokeColor;
    if (shape.strokeProfile) {
      drawParameterisedStroke(ctx, shape);
    } else {
      ctx.lineWidth = shape.properties.strokeWidth;
      ctx.lineCap = 'round';
      (ctx as any).setLineDash([]);
      drawSquiggleStroke(ctx, shape);
    }
  }

  // Wire post-pass — canonical call handles resample, open/closed, per-vertex gradient sampling.
  const wireConfig = (shape as any).wireConfig;
  if (wireConfig?.enabled) {
    ctx.globalAlpha = 1;
    drawWirePass(ctx as any, shape as any, wireConfig, (shape as any).renderModeOverride);
  }
}

// ─── Parameterised stroke helpers (server mirror of client shapeRenderer) ─────
function getServerShapeBoundaryPoints(shape: Shape): { x: number; y: number }[] {
  if (!shape.points || shape.points.length === 0) return [];
  const n = Math.max(48, shape.shapeRenderSegments ?? 48);
  const jitterCfg = shape.localJitterConfig;

  if (shape.type === 'ring') {
    const half = Math.floor(shape.points.length / 2);
    return resampleContour(shape.points.slice(0, half), n);
  }

  let pts: { x: number; y: number }[] = shape.points;
  if (jitterCfg?.enabled) {
    pts = applyLocalJitter(pts, jitterCfg, shapeIdToHash(shape.id));
  }
  return resampleContour(pts, n);
}

function drawParameterisedStroke(ctx: CanvasRenderingContext2D, shape: Shape): void {
  const pts = getServerShapeBoundaryPoints(shape);
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

function drawSquiggleStroke(ctx: CanvasRenderingContext2D, shape: Shape): void {
  const pts = getServerShapeBoundaryPoints(shape);
  if (pts.length < 2) return;

  const amplitude = (shape.strokeSquiggleAmplitude ?? 4) as number;
  const frequency = (shape.strokeSquiggleFrequency ?? 1) as number;
  const phase = (shape.strokeSquigglePhase ?? 0) as number;

  const normals = computeNormals(pts);
  const arcLens = computeArcLengths(pts);
  const n = pts.length;

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const offset = amplitude * Math.sin(2 * Math.PI * (frequency * arcLens[i] / 100) + phase);
    const { nx, ny } = normals[i];
    const x = pts[i].x + nx * offset;
    const y = pts[i].y + ny * offset;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}

/**
 * Get bounding box from shape points
 */
function getBounds(shape: Shape): { x: number; y: number; width: number; height: number } {
  if (shape.points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  // Calculate bounds ONLY from actual shape points, not control handles
  const xs = shape.points.map(p => p.x);
  const ys = shape.points.map(p => p.y);
  
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}
