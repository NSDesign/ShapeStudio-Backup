// The existing three-pass box blur remains the default for saved shapes.
export type ShapeBlurType = 'box' | 'gaussian';

export function blurShapePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  type: ShapeBlurType = 'box',
): void {
  if (!Number.isFinite(radius) || radius <= 0 || width === 0 || height === 0) return;
  if (type === 'gaussian') {
    gaussianBlurPixels(data, width, height, radius);
    return;
  }
  const boxRadius = radius / 3;
  if (boxRadius <= 0 || width === 0 || height === 0) return;

  const whole = Math.floor(boxRadius);
  const fraction = boxRadius - whole;
  const weight = 2 * whole + 1 + 2 * fraction;
  const temp = new Uint8ClampedArray(data.length);

  function pass(horizontal: boolean): void {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let i = -whole - 1; i <= whole + 1; i++) {
          const sampleWeight = Math.abs(i) <= whole ? 1 : fraction;
          if (!sampleWeight) continue;
          const sx = horizontal ? Math.max(0, Math.min(width - 1, x + i)) : x;
          const sy = horizontal ? y : Math.max(0, Math.min(height - 1, y + i));
          const index = (sy * width + sx) * 4;
          const alpha = data[index + 3] * sampleWeight;
          r += data[index] * alpha;
          g += data[index + 1] * alpha;
          b += data[index + 2] * alpha;
          a += alpha;
        }
        const index = (y * width + x) * 4;
        temp[index] = a ? r / a : 0;
        temp[index + 1] = a ? g / a : 0;
        temp[index + 2] = a ? b / a : 0;
        temp[index + 3] = a / weight;
      }
    }
    data.set(temp);
  }

  pass(true);
  pass(false);
  pass(true);
}

/** Separable, alpha-aware Gaussian: sigma matches the effective spread of the legacy box passes. */
function gaussianBlurPixels(data: Uint8ClampedArray, width: number, height: number, radius: number): void {
  const sigma = radius / 3;
  const support = Math.min(Math.ceil(radius), Math.max(width, height) - 1);
  if (support <= 0) return;
  const weights = new Float64Array(support + 1);
  for (let i = 0; i <= support; i++) weights[i] = Math.exp(-i * i / (2 * sigma * sigma));
  const temp = new Uint8ClampedArray(data.length);

  function pass(horizontal: boolean): void {
    const extent = horizontal ? width : height;
    const limit = Math.min(support, extent - 1);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let red = 0, green = 0, blue = 0, alpha = 0, totalWeight = 0;
        for (let offset = -limit; offset <= limit; offset++) {
          const sampleX = horizontal ? Math.max(0, Math.min(width - 1, x + offset)) : x;
          const sampleY = horizontal ? y : Math.max(0, Math.min(height - 1, y + offset));
          const index = (sampleY * width + sampleX) * 4;
          const weight = weights[Math.abs(offset)];
          const weightedAlpha = data[index + 3] * weight;
          red += data[index] * weightedAlpha;
          green += data[index + 1] * weightedAlpha;
          blue += data[index + 2] * weightedAlpha;
          alpha += weightedAlpha;
          totalWeight += weight;
        }
        const index = (y * width + x) * 4;
        temp[index] = alpha ? red / alpha : 0;
        temp[index + 1] = alpha ? green / alpha : 0;
        temp[index + 2] = alpha ? blue / alpha : 0;
        temp[index + 3] = alpha / totalWeight;
      }
    }
    data.set(temp);
  }

  pass(true);
  pass(false);
}

// Reuse the same implementations in the browser-download renderer without maintaining
// a second copy of the pixel algorithms inside its injected JavaScript string.
export const SHAPE_BLUR_JS = `
// tsx may add a name helper to nested functions when converting TypeScript to JavaScript.
var __name = function(fn) { return fn; };
${gaussianBlurPixels.toString()}
${blurShapePixels.toString()}
`;