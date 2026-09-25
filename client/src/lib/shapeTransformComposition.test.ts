import { describe, expect, it } from 'vitest';
import { Shape } from './shapes';
import { applyGridDistribution, applyWaveDistribution, type DistributionConfig } from './shapeTypes';
import { composePerShapeTransform, randomizeTransformAmounts, type TransformAmounts } from './shapeTransformComposition';
import { DEFAULT_CELL_CONSTRAINTS } from '@shared/schema';

const artboard = { x: -250, y: -50, width: 500, height: 100 };
const grid: DistributionConfig = {
  enabled: true,
  pattern: 'grid',
  gridRows: 1,
  gridColumns: 5,
  gridRowOffset: 100,
  gridColumnOffset: 100,
  gridSortBy: 'none',
  gridSortScope: 'per-generation',
  gridSortOrder: 'ascending',
  gridXRandomization: 0,
  gridYRandomization: 0,
  cellConstraints: { ...DEFAULT_CELL_CONSTRAINTS, enabled: true, fitMode: 'fill' },
};

function circle() {
  const shape = new Shape('circle', 0, 0, { propertiesEnabled: true });
  shape.radius = 25;
  shape.width = 50;
  shape.height = 50;
  return shape;
}

function transform(shape: Shape, overrides: Partial<Parameters<typeof composePerShapeTransform>[1]> = {}) {
  Object.assign(shape.transform, composePerShapeTransform(shape.transform, {
    originX: 0, originY: 0, translationX: 0, translationY: 0,
    scaleX: 1, scaleY: 1, rotation: 0,
    applyScale: true, applyRotation: true, postPlacement: true,
    ...overrides,
  }));
}

const randomization = {
  scale: 100, rotation: 100, translationX: 200, translationY: 200,
  maintainScaleAspectRatio: true,
  applyScale: true, applyRotation: true, applyTranslation: true, enabled: true,
};

describe('cell-fit and per-shape transforms', () => {
  it('keeps five filled circles at their cell size and centers at 100% post-placement', () => {
    const shapes = applyGridDistribution(Array.from({ length: 5 }, circle), grid, { x: 0, y: 0 }, undefined, artboard).map(r => r.shape as Shape);
    expect(shapes.map(s => s.transform.scaleX)).toEqual([2, 2, 2, 2, 2]);
    shapes.forEach(s => transform(s));
    expect(shapes.map(s => s.radius! * 2 * s.transform.scaleX)).toEqual([100, 100, 100, 100, 100]);
    expect(shapes.map(s => s.transform.x)).toEqual([-200, -100, 0, 100, 200]);
    expect(shapes.map(s => s.transform.y)).toEqual([0, 0, 0, 0, 0]);
  });

  it('scales an already fitted circle by 150% around its origin without replacing fit scale', () => {
    const shape = applyGridDistribution([circle()], grid, { x: 0, y: 0 }, undefined, artboard)[0].shape as Shape;
    transform(shape, { scaleX: 1.5, scaleY: 1.5 });
    expect(shape.transform.scaleX).toBe(3);
    expect(shape.radius! * 2 * shape.transform.scaleX).toBe(150);
    expect(shape.transform.x).toBe(-300); // intentional orbit around artboard center
  });

  it('keeps neutral pre-placement transforms neutral and lets the grid fit afterward', () => {
    const shape = circle();
    transform(shape, { postPlacement: false, originX: 200, originY: 100 });
    expect(shape.transform.x).toBe(0);
    const fitted = applyGridDistribution([shape], grid, { x: 0, y: 0 }, undefined, artboard)[0].shape as Shape;
    expect(fitted.transform.scaleX).toBe(2);
    expect(fitted.transform.x).toBe(-200);
  });

  it('preserves a configured pre-placement offset when the grid adds its cell position', () => {
    const shape = circle();
    transform(shape, { postPlacement: false, translationX: 12, translationY: -7 });
    const fitted = applyGridDistribution([shape], grid, { x: 0, y: 0 }, undefined, artboard)[0].shape as Shape;
    expect([fitted.transform.x, fitted.transform.y]).toEqual([-188, -7]);
  });

  it('keeps cell-filled spline circles at their fitted size after post-placement scaling', () => {
    const shape = new Shape('spline-circle', 0, 0, { propertiesEnabled: true });
    shape.points = [{ x: -25, y: 0 }, { x: 0, y: -25 }, { x: 25, y: 0 }, { x: 0, y: 25 }];
    const fitted = applyGridDistribution([shape], grid, { x: 0, y: 0 }, undefined, artboard)[0].shape as Shape;
    const sizeBefore = fitted.getBounds().width * fitted.transform.scaleX;
    transform(fitted);
    expect(fitted.getBounds().width * fitted.transform.scaleX).toBe(sizeBefore);
    expect(fitted.transform.x).toBe(-200);
  });

  it('does not shift a grid with neutral position settings, but retains intentional movement', () => {
    const neutral = applyGridDistribution([circle()], grid, { x: 0, y: 0 }, undefined, artboard)[0].shape as Shape;
    transform(neutral, { originX: 75, originY: -90, applyScale: false, applyRotation: false });
    expect([neutral.transform.x, neutral.transform.y]).toEqual([-200, 0]);

    const moved = applyGridDistribution([circle()], grid, { x: 0, y: 0 }, undefined, artboard)[0].shape as Shape;
    transform(moved, { translationX: 12, translationY: -7, rotation: 90, applyScale: false });
    expect(moved.transform.x).toBeCloseTo(12);
    expect(moved.transform.y).toBeCloseTo(-207);
  });

  it('also preserves size and placement on the shared wave transform path', () => {
    const shape = applyWaveDistribution([circle()], { ...grid, pattern: 'wave', waveAmplitude: 20, waveFrequency: 1 }, { x: 0, y: 0 }, artboard)[0] as Shape;
    shape.transform.scaleX = 1.25;
    shape.transform.rotation = 30;
    const before = { ...shape.transform };
    transform(shape);
    expect(shape.transform).toMatchObject(before);
  });

  it.each([false, true])('keeps neutral values neutral despite maximum randomization (post-placement: %s)', postPlacement => {
    const shapes = Array.from({ length: 5 }, circle);
    if (postPlacement) applyGridDistribution(shapes, grid, { x: 0, y: 0 }, undefined, artboard);
    shapes.forEach(shape => {
      const amounts = randomizeTransformAmounts(
        { translationX: 0, translationY: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        randomization,
        () => 0.9,
      );
      transform(shape, { ...amounts, postPlacement });
    });
    if (!postPlacement) applyGridDistribution(shapes, grid, { x: 0, y: 0 }, undefined, artboard);
    expect(shapes.map(s => [s.transform.x, s.transform.y])).toEqual([
      [-200, 0], [-100, 0], [0, 0], [100, 0], [200, 0],
    ]);
    expect(shapes.map(s => s.transform.scaleX)).toEqual([2, 2, 2, 2, 2]);
    expect(shapes.map(s => s.transform.rotation)).toEqual([0, 0, 0, 0, 0]);
  });

  it('varies nonzero translation, rotation and scale as percentages of their base amounts', () => {
    const base: TransformAmounts = { translationX: 20, translationY: -10, scaleX: 1.5, scaleY: 1.5, rotation: 90 };
    const varied = randomizeTransformAmounts(base, { ...randomization, scale: 50, rotation: 50, translationX: 50, translationY: 50 }, () => 1);
    expect(varied).toEqual({
      translationX: 30, translationY: -15,
      scaleX: 1.75, scaleY: 1.75, rotation: 135,
    });
    const shape = circle();
    transform(shape, { ...varied });
    expect(shape.transform.rotation).toBe(135);
    expect([shape.transform.x, shape.transform.y]).toEqual([30, -15]);
  });

  it('does not randomize a transform gated off in post-placement mode', () => {
    const base: TransformAmounts = { translationX: 20, translationY: -10, scaleX: 1.5, scaleY: 1.5, rotation: 90 };
    const varied = randomizeTransformAmounts(base, {
      ...randomization, applyRotation: false, applyTranslation: false, applyScale: false,
    }, () => 1);
    expect(varied).toEqual(base);
  });
});