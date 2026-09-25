import { describe, expect, it } from 'vitest';
import { blurShapePixels } from '../shared/shapeBlur';
import { createCanvas, DOMMatrix } from 'canvas';
import { renderShape } from '../server/lib/canvasRenderer';
import type { Shape } from '../server/lib/shapeGenerator';
import { SHAPE_RENDERER_JS } from '../shared/shapeRenderer';
import { BatchConfigSettingsSchema } from '../shared/schema';

function blurred(radius: number): Uint8ClampedArray {
  const width = 201;
  const data = new Uint8ClampedArray(width * width * 4);
  // Opaque white square with transparent padding on every side.
  for (let y = 80; y < 121; y++) {
    for (let x = 80; x < 121; x++) {
      const i = (y * width + x) * 4;
      data.set([255, 255, 255, 255], i);
    }
  }
  blurShapePixels(data, width, width, radius);
  return data;
}

describe('shape blur', () => {
  it('leaves zero-radius pixels untouched', () => {
    const data = new Uint8ClampedArray([255, 128, 64, 255, 0, 0, 0, 0]);
    blurShapePixels(data, 2, 1, 0);
    expect([...data]).toEqual([255, 128, 64, 255, 0, 0, 0, 0]);
  });

  it('makes adjacent values distinct and large values progressively softer', () => {
    const outsideAlpha = (data: Uint8ClampedArray) =>
      Array.from({ length: 20 }, (_, x) => data[(100 * 201 + 60 + x) * 4 + 3])
        .reduce((sum, alpha) => sum + alpha, 0);
    const levels = [10, 11, 12, 20, 35, 50].map(radius => outsideAlpha(blurred(radius)));
    expect(levels.every((alpha, i) => i === 0 || alpha > levels[i - 1])).toBe(true);
  });

  it('preserves color without dark fringes on transparency', () => {
    const result = blurred(50);
    const index = (100 * 201 + 65) * 4;
    expect(result[index + 3]).toBeGreaterThan(0);
    expect(result[index]).toBe(255);
  });

  it('renders stronger blur at 50 than 20 in the server export canvas', () => {
    const shape = {
      type: 'rectangle',
      points: [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }],
      width: 40, height: 40,
      transform: { x: 100, y: 100, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
      properties: { fillColor: '#ffffff', fillOpacity: 1, strokeColor: 'none', strokeWidth: 0, blurRadius: 20, blendMode: 'source-over' },
    } as unknown as Shape;
    const measure = (radius: number) => {
      shape.properties.blurRadius = radius;
      const canvas = createCanvas(201, 201);
      renderShape(canvas.getContext('2d'), shape);
      return canvas.getContext('2d').getImageData(65, 100, 1, 1).data[3];
    };
    expect(measure(50)).toBeGreaterThan(measure(20));
  });

  it('defaults older settings to Box and does not clamp typed radii at 50', () => {
    expect(BatchConfigSettingsSchema.pick({ blurType: true }).parse({}).blurType).toBe('box');
    expect([...blurred(60)]).not.toEqual([...blurred(50)]);
  });

  it('gives Gaussian a continuous, distinct profile from Box without dark edges', () => {
    const gaussian = (radius: number) => {
      const pixels = new Uint8ClampedArray(201 * 201 * 4);
      for (let y = 80; y < 121; y++) {
        for (let x = 80; x < 121; x++) pixels.set([255, 255, 255, 255], (y * 201 + x) * 4);
      }
      blurShapePixels(pixels, 201, 201, radius, 'gaussian');
      return pixels;
    };
    const ten = gaussian(10), eleven = gaussian(11), box = blurred(10);
    expect([...ten]).not.toEqual([...eleven]);
    expect([...ten]).not.toEqual([...box]);
    const edge = (100 * 201 + 78) * 4;
    expect(ten[edge + 3]).toBeGreaterThan(0);
    expect(ten[edge]).toBe(255);
  });

  it('uses the selected blur type in both server and browser-download renders', () => {
    const browserRender = new Function(
      'RENDER_DATA', 'DOMMatrix', 'document', `${SHAPE_RENDERER_JS}; return renderShape;`,
    )(
      { artboard: { x: 0, y: 0 } },
      DOMMatrix,
      { createElement: () => createCanvas(1, 1) },
    ) as typeof renderShape;
    const shape = {
      type: 'rectangle',
      points: [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }],
      width: 40, height: 40,
      transform: { x: 100, y: 100, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
      properties: {
        fillColor: '#ffffff', fillOpacity: 1, strokeColor: 'none', strokeWidth: 0,
        blurRadius: 20, blurType: 'box' as 'box' | 'gaussian', blendMode: 'source-over',
      },
    } as unknown as Shape;
    const results: number[] = [];
    for (const type of ['box', 'gaussian'] as const) {
      shape.properties.blurType = type;
      const server = createCanvas(201, 201);
      const browser = createCanvas(201, 201);
      renderShape(server.getContext('2d'), shape);
      browserRender(browser.getContext('2d') as any, shape);
      for (const x of [65, 75, 78, 80, 85, 100]) {
        const serverAlpha = server.getContext('2d').getImageData(x, 100, 1, 1).data[3];
        const browserAlpha = browser.getContext('2d').getImageData(x, 100, 1, 1).data[3];
        expect(browserAlpha).toBe(serverAlpha);
        if (x === 75) results.push(serverAlpha);
      }
    }
    expect(results[0]).not.toBe(results[1]);
  });
});