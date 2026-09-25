export interface GradientStop {
  offset: number;
  color: string;
}

export interface GradientConfig {
  type: 'linear' | 'radial' | 'conic' | 'diamond';
  stops: GradientStop[];
  angle?: number;
  conicAngle?: number;
  conicCenterX?: number;
  conicCenterY?: number;
  radialCenterX?: number;
  radialCenterY?: number;
  diamondCenterX?: number;
  diamondCenterY?: number;
  diamondAngle?: number;
  linearCenterX?: number;
  linearCenterY?: number;
  linearScale?: number;
  radialScale?: number;
  diamondScale?: number;
  diamondScaleEdgeMode?: 'streak' | 'repeat';
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LinearGradientCoords {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RadialGradientCoords {
  centerX: number;
  centerY: number;
  innerRadius: number;
  outerRadius: number;
}

export interface ConicGradientCoords {
  centerX: number;
  centerY: number;
  startAngle: number;
}

export function calculateLinearGradientCoords(
  bounds: Bounds,
  angleDegrees: number,
  centerXPercent: number = 50,
  centerYPercent: number = 50,
  scalePercent: number = 100
): LinearGradientCoords {
  const angle = (angleDegrees || 0) * Math.PI / 180;
  const cx = bounds.x + bounds.width * centerXPercent / 100;
  const cy = bounds.y + bounds.height * centerYPercent / 100;
  const length = Math.max(bounds.width, bounds.height) / 2 * (Math.max(1, scalePercent) / 100);
  
  return {
    x1: cx - Math.cos(angle) * length,
    y1: cy - Math.sin(angle) * length,
    x2: cx + Math.cos(angle) * length,
    y2: cy + Math.sin(angle) * length
  };
}

export function calculateRadialGradientCoords(
  bounds: Bounds, 
  centerXPercent: number = 50, 
  centerYPercent: number = 50,
  scalePercent: number = 100
): RadialGradientCoords {
  const centerX = bounds.x + (bounds.width * centerXPercent / 100);
  const centerY = bounds.y + (bounds.height * centerYPercent / 100);
  const radius = Math.max(bounds.width, bounds.height) / 2 * (scalePercent / 100);
  
  return {
    centerX,
    centerY,
    innerRadius: 0,
    outerRadius: radius
  };
}

export function calculateConicGradientCoords(
  bounds: Bounds, 
  centerXPercent: number = 50, 
  centerYPercent: number = 50,
  startAngle: number = 0
): ConicGradientCoords {
  const centerX = bounds.x + (bounds.width * centerXPercent / 100);
  const centerY = bounds.y + (bounds.height * centerYPercent / 100);
  
  return {
    centerX,
    centerY,
    startAngle
  };
}

export interface ParsedGradientStop {
  offset: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Compute the Chebyshev (L∞) distance diamond gradient pixel data.
 * t = max(|px - cx| / halfWidth, |py - cy| / halfHeight), clamped [0,1].
 * This matches Photoshop's "Diamond" gradient algorithm.
 *
 * Callers must pre-parse CSS color strings into ParsedGradientStop RGBA values
 * (each 0-255) before calling this function. The stops must be sorted by offset.
 *
 * Returns a flat RGBA Uint8ClampedArray of length width * height * 4.
 */
export function calculateDiamondGradientTexture(
  parsedStops: ParsedGradientStop[],
  width: number,
  height: number,
  centerXPercent: number = 50,
  centerYPercent: number = 50,
  angleDegrees: number = 0,
  scalePercent: number = 100,
  edgeMode: 'streak' | 'repeat' = 'streak'
): Uint8ClampedArray {
  const bw = Math.max(1, width);
  const bh = Math.max(1, height);
  const data = new Uint8ClampedArray(bw * bh * 4);

  const cx = bw * centerXPercent / 100;
  const cy = bh * centerYPercent / 100;
  const halfW = Math.max(1, Math.max(cx, bw - cx));
  const halfH = Math.max(1, Math.max(cy, bh - cy));

  const rad = (angleDegrees * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const useRotation = angleDegrees !== 0;

  for (let py = 0; py < bh; py++) {
    for (let px = 0; px < bw; px++) {
      let tx: number, ty: number;
      if (useRotation) {
        const dx = px - cx;
        const dy = py - cy;
        const rx = dx * cosA + dy * sinA;
        const ry = -dx * sinA + dy * cosA;
        tx = Math.abs(rx) / halfW;
        ty = Math.abs(ry) / halfH;
      } else {
        tx = Math.abs(px - cx) / halfW;
        ty = Math.abs(py - cy) / halfH;
      }
      const rawT = Math.max(tx, ty) * (100 / Math.max(1, scalePercent));
      // At the neutral/default scale, repeat must not alter the historical
      // single-gradient appearance. Repetition is only meaningful when the
      // source is compressed below the available shape.
      const t = edgeMode === 'repeat' && scalePercent < 100
        ? ((rawT % 1) + 1) % 1
        : Math.min(1, Math.max(0, rawT));

      let r = 0, g = 0, b = 0, a = 0;

      if (parsedStops.length === 0) {
        // transparent
      } else if (parsedStops.length === 1 || t <= parsedStops[0].offset) {
        ({ r, g, b, a } = parsedStops[0]);
      } else if (t >= parsedStops[parsedStops.length - 1].offset) {
        ({ r, g, b, a } = parsedStops[parsedStops.length - 1]);
      } else {
        for (let s = 0; s < parsedStops.length - 1; s++) {
          if (t >= parsedStops[s].offset && t <= parsedStops[s + 1].offset) {
            const range = parsedStops[s + 1].offset - parsedStops[s].offset;
            const f = range > 0 ? (t - parsedStops[s].offset) / range : 0;
            r = Math.round(parsedStops[s].r + f * (parsedStops[s + 1].r - parsedStops[s].r));
            g = Math.round(parsedStops[s].g + f * (parsedStops[s + 1].g - parsedStops[s].g));
            b = Math.round(parsedStops[s].b + f * (parsedStops[s + 1].b - parsedStops[s].b));
            a = Math.round(parsedStops[s].a + f * (parsedStops[s + 1].a - parsedStops[s].a));
            break;
          }
        }
      }

      const idx = (py * bw + px) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }

  return data;
}

export function getGradientCoords(gradient: GradientConfig, bounds: Bounds) {
  if (gradient.type === 'linear') {
    return {
      type: 'linear' as const,
      coords: calculateLinearGradientCoords(
        bounds,
        gradient.angle || 0,
        gradient.linearCenterX ?? 50,
        gradient.linearCenterY ?? 50,
        gradient.linearScale ?? 100
      )
    };
  } else if (gradient.type === 'conic') {
    return {
      type: 'conic' as const,
      coords: calculateConicGradientCoords(
        bounds,
        gradient.conicCenterX ?? 50,
        gradient.conicCenterY ?? 50,
        gradient.conicAngle ?? 0
      )
    };
  } else {
    return {
      type: 'radial' as const,
      coords: calculateRadialGradientCoords(
        bounds,
        gradient.radialCenterX ?? 50,
        gradient.radialCenterY ?? 50,
        gradient.radialScale ?? 100
      )
    };
  }
}
