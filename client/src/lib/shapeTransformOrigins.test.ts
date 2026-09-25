import { describe, expect, it } from 'vitest';
import { Shape } from './shapes';
import { composePerShapeTransform } from './shapeTransformComposition';
import { applyShapeTransformsInReferenceOrder, resolveShapeReferenceOrigin } from './shapeTransformOrigins';

function square(x: number): Shape {
  const shape = new Shape('square', x, 0, { propertiesEnabled: true });
  shape.points = [
    { x: -10, y: -10 }, { x: 10, y: -10 },
    { x: 10, y: 10 }, { x: -10, y: 10 },
  ];
  return shape;
}

function rotateInReferenceOrder(shapes: Shape[], reference: 'previous' | 'next', postPlacement: boolean) {
  applyShapeTransformsInReferenceOrder(shapes, reference, (shape, index) => {
    const origin = resolveShapeReferenceOrigin(shapes, index, reference, 'center');
    Object.assign(shape.transform, composePerShapeTransform(shape.transform, {
      originX: origin.x, originY: origin.y,
      translationX: 0, translationY: 0,
      scaleX: 1, scaleY: 1, rotation: 90,
      applyScale: true, applyRotation: true, postPlacement,
    }));
  });
}

describe('shape reference transform origins', () => {
  it.each([false, true])('uses progressively transformed previous shapes (post-placement: %s)', postPlacement => {
    const shapes = [square(0), square(100), square(200)];
    rotateInReferenceOrder(shapes, 'previous', postPlacement);
    [[0, 0], [0, 100], [100, 300]].forEach(([x, y], i) => {
      expect(shapes[i].transform.x).toBeCloseTo(x);
      expect(shapes[i].transform.y).toBeCloseTo(y);
    });
  });

  it.each([false, true])('uses progressively transformed next shapes (post-placement: %s)', postPlacement => {
    const shapes = [square(0), square(100), square(200)];
    rotateInReferenceOrder(shapes, 'next', postPlacement);
    expect(shapes.map(s => [s.transform.x, s.transform.y])).toEqual([[100, -300], [200, -100], [200, 0]]);
  });

  it('uses the current shape and selected anchor at both missing-neighbour boundaries', () => {
    const shapes = [square(50), square(100)];
    expect(resolveShapeReferenceOrigin(shapes, 0, 'previous', 'top-left')).toEqual({ x: 40, y: -10 });
    expect(resolveShapeReferenceOrigin(shapes, 1, 'next', 'bottom-right')).toEqual({ x: 110, y: 10 });
    expect(resolveShapeReferenceOrigin(shapes, 1, 'specific', 'top-left', 99)).toEqual({ x: 90, y: -10 });
  });

  it.each(['previous', 'next'] as const)('transforms an isolated shape around its own selected anchor for %s', reference => {
    const shape = square(0);
    const origin = resolveShapeReferenceOrigin([shape], 0, reference, 'top-left');
    const transformed = composePerShapeTransform(shape.transform, {
      originX: origin.x, originY: origin.y, translationX: 0, translationY: 0,
      scaleX: 1, scaleY: 1, rotation: 90, applyScale: true, applyRotation: true, postPlacement: true,
    });
    expect(transformed.x).toBeCloseTo(-20);
    expect(transformed.y).toBeCloseTo(0);
  });

  it('supports first, last, current, and indexed shape references in world space', () => {
    const shapes = [square(50), square(100), square(200)];
    expect(resolveShapeReferenceOrigin(shapes, 1, 'first', 'center')).toEqual({ x: 50, y: 0 });
    expect(resolveShapeReferenceOrigin(shapes, 0, 'last', 'center')).toEqual({ x: 200, y: 0 });
    expect(resolveShapeReferenceOrigin(shapes, 2, 'specific', 'top-right', 1)).toEqual({ x: 110, y: -10 });
    expect(resolveShapeReferenceOrigin(shapes, 1, 'current', 'center')).toEqual({ x: 100, y: 0 });
    shapes[0].transform.x = 75;
    expect(resolveShapeReferenceOrigin(shapes, 1, 'first', 'center')).toEqual({ x: 75, y: 0 });
  });

  it('keeps current-shape and artboard centers distinct when rotating a placed shape', () => {
    const shape = square(100);
    const self = resolveShapeReferenceOrigin([shape], 0, 'current', 'center');
    const rotate = (origin: { x: number; y: number }) => composePerShapeTransform(shape.transform, {
      originX: origin.x, originY: origin.y, translationX: 0, translationY: 0,
      scaleX: 1, scaleY: 1, rotation: 90, applyScale: true, applyRotation: true, postPlacement: true,
    });
    expect([rotate(self).x, rotate(self).y]).toEqual([100, 0]);
    expect(rotate({ x: 0, y: 0 }).x).toBeCloseTo(0);
    expect(rotate({ x: 0, y: 0 }).y).toBeCloseTo(100);
  });
});