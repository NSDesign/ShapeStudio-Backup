import { describe, expect, it, vi } from 'vitest';
import {
  distributeFillPaletteAnchors, fillPaletteCurve, removePaletteColourAssignments,
  resolveFillPaletteColour, validateFillPaletteAssignments,
  type FillPaletteInterpolation,
} from '../shared/fillPaletteAnchors';
import { BatchConfigSettingsSchema, defaultBatchConfigSettings } from '../shared/schema';
import { generateShapesWithBatchConfig } from '../server/lib/batchConfigProcessor';
import { generateColor as serverGenerateColor } from '../server/lib/colorUtils';
import { generateColor as clientGenerateColor } from '../client/src/lib/hslColor';

const three = ['#ff0000', '#0000ff', '#ffff00'];
const resolve = (
  index: number,
  count: number,
  mode: 'manual' | 'even' | 'logarithmic' | 'exponential' = 'manual',
  assignments = [
    { shapeNumber: 1, paletteIndex: 0 },
    { shapeNumber: 5, paletteIndex: 1 },
    { shapeNumber: 8, paletteIndex: 2 },
  ],
  interpolation: FillPaletteInterpolation = 'linear',
) => resolveFillPaletteColour(three, index, count, mode, assignments, interpolation);

describe('fill palette anchors', () => {
  it('uses exact manual colours and interpolates each span with a shortest-hue HSL path', () => {
    expect(resolve(0, 20)).toBe('#ff0000');
    expect(resolve(4, 20)).toBe('#0000ff');
    expect(resolve(7, 20)).toBe('#ffff00');
    expect(resolve(5, 20)).not.toBe(three[1]);
    // Blue to yellow follows the cyan/green route (not magenta/red).
    const midpoint = resolveFillPaletteColour(['#0000ff', '#ffff00'], 2, 5, 'even', [], 'linear');
    expect(midpoint).toBe('#00ff80');
  });

  it('holds the nearest colour outside manual assignments, including when an anchor is beyond this set', () => {
    const assignments = [{ shapeNumber: 4, paletteIndex: 0 }, { shapeNumber: 20, paletteIndex: 1 }];
    expect(resolve(0, 8, 'manual', assignments)).toBe('#ff0000');
    expect(resolve(3, 8, 'manual', assignments)).toBe('#ff0000');
    expect(resolve(7, 8, 'manual', assignments)).not.toBe('#0000ff');
    expect(resolve(19, 20, 'manual', assignments)).toBe('#0000ff');
    expect(resolve(0, 30, 'manual', [{ shapeNumber: 10, paletteIndex: 2 }])).toBe('#ffff00');
    expect(resolve(29, 30, 'manual', [{ shapeNumber: 10, paletteIndex: 2 }])).toBe('#ffff00');
  });

  it('places all colours in order at distinct positions in a 100-shape set', () => {
    const even = distributeFillPaletteAnchors(10, 100, 'even');
    const log = distributeFillPaletteAnchors(10, 100, 'logarithmic');
    const exp = distributeFillPaletteAnchors(10, 100, 'exponential');
    for (const anchors of [even, log, exp]) {
      expect(anchors).toHaveLength(10);
      expect(anchors.map(a => a.paletteIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(anchors[0].shapeNumber).toBe(1);
      expect(anchors[9].shapeNumber).toBe(100);
      expect(new Set(anchors.map(a => a.shapeNumber)).size).toBe(10);
    }
    expect(log[1].shapeNumber).toBeLessThan(even[1].shapeNumber);
    expect(exp[1].shapeNumber).toBeGreaterThan(even[1].shapeNumber);
    expect(distributeFillPaletteAnchors(10, 10, 'logarithmic').map(a => a.shapeNumber))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(() => distributeFillPaletteAnchors(10, 9, 'even')).toThrow(/Cannot assign/);
  });

  it('uses actual per-set shape count, with numbering resetting for every repetition', () => {
    expect(resolve(4, 5, 'even')).toBe('#ffff00');
    expect(resolve(7, 8, 'even')).toBe('#ffff00');
    expect(resolve(0, 8, 'even')).toBe('#ff0000');
    expect(resolve(0, 5, 'even')).toBe('#ff0000');
  });

  it('preserves exact anchor colours for every interpolation mode', () => {
    const modes: FillPaletteInterpolation[] =
      ['linear', 'sine', 'exponential', 'logarithmic', 'bounce', 'zigzag', 'sawtooth'];
    for (const mode of modes) {
      expect(fillPaletteCurve(0, mode)).toBe(0);
      expect(fillPaletteCurve(1, mode)).toBe(1);
      expect(fillPaletteCurve(0.4, mode)).toBeGreaterThanOrEqual(0);
      expect(fillPaletteCurve(0.4, mode)).toBeLessThanOrEqual(1);
      expect(resolve(0, 8, 'manual', undefined, mode)).toBe('#ff0000');
      expect(resolve(4, 8, 'manual', undefined, mode)).toBe('#0000ff');
      expect(resolve(7, 8, 'manual', undefined, mode)).toBe('#ffff00');
    }
    expect(fillPaletteCurve(0.25, 'logarithmic')).toBeGreaterThan(0.25);
    expect(fillPaletteCurve(0.25, 'exponential')).toBeLessThan(0.25);
    expect(fillPaletteCurve(0.25, 'sine')).toBeLessThan(0.25);
    expect(fillPaletteCurve(0.5, 'zigzag')).toBeCloseTo(0.5);
    expect(fillPaletteCurve(0.4, 'sawtooth')).toBeCloseTo(0.2);
  });

  it('validates manual entries and remaps them after removing a palette swatch', () => {
    expect(validateFillPaletteAssignments([], 2)).toMatch(/at least one/);
    expect(validateFillPaletteAssignments([{ shapeNumber: 1.5, paletteIndex: 0 }], 2)).toMatch(/whole numbers/);
    expect(validateFillPaletteAssignments([{ shapeNumber: 1, paletteIndex: 0 }, { shapeNumber: 1, paletteIndex: 1 }], 2)).toMatch(/more than one/);
    expect(validateFillPaletteAssignments([{ shapeNumber: 1, paletteIndex: 3 }], 2)).toMatch(/missing/);
    const before = [
      { shapeNumber: 1, paletteIndex: 0 },
      { shapeNumber: 3, paletteIndex: 1 },
      { shapeNumber: 5, paletteIndex: 2 },
      { shapeNumber: 8, paletteIndex: 1 },
    ];
    expect(removePaletteColourAssignments(before, 1)).toEqual([
      { shapeNumber: 1, paletteIndex: 0 }, { shapeNumber: 5, paletteIndex: 1 },
    ]);
    expect(resolveFillPaletteColour(['#ff0000', '#0000ff'], 4, 8, 'manual',
      removePaletteColourAssignments(before, 1), 'linear')).toBe('#0000ff');
  });

  it('defaults old saved configs to cycling without changing Series, Range, or Constant', () => {
    const gradientAndPalette = BatchConfigSettingsSchema.pick({
      fillColorMode: true, fillColorPalette: true, fillColorPaletteBehavior: true,
      fillColorPaletteDistribution: true, fillColorPaletteInterpolation: true,
      fillColorPaletteAssignments: true,
    });
    const legacy = { ...defaultBatchConfigSettings } as Record<string, unknown>;
    delete legacy.fillColorPaletteBehavior;
    delete legacy.fillColorPaletteDistribution;
    delete legacy.fillColorPaletteInterpolation;
    delete legacy.fillColorPaletteAssignments;
    const parsed = gradientAndPalette.parse(legacy);
    expect(parsed.fillColorPaletteBehavior).toBe('cycle');
    expect(parsed.fillColorPaletteAssignments).toEqual([]);
    for (const generator of [clientGenerateColor, serverGenerateColor]) {
      expect(generator('palette', undefined, three, undefined, 4)).toBe('#0000ff');
      expect(generator('series', undefined, three, undefined, 4)).toBe('#0000ff');
      expect(generator('define', undefined, three, '#123456')).toBe('#123456');
    }
  });

  it('applies the shared resolver in server batch generation for each set repetition', () => {
    const settings = {
      ...defaultBatchConfigSettings,
      propertiesEnabled: true,
      fillGradientEnabled: false,
      fillColorMode: 'palette' as const,
      fillColorPaletteBehavior: 'blend' as const,
      fillColorPaletteDistribution: 'manual' as const,
      fillColorPalette: three,
      fillColorPaletteAssignments: [
        { shapeNumber: 1, paletteIndex: 0 },
        { shapeNumber: 5, paletteIndex: 1 },
        { shapeNumber: 8, paletteIndex: 2 },
      ],
      // Explicit fill palette anchors win over harmony on both client and server.
      colorHarmonyEnabled: true,
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      for (const repetition of [0, 1]) {
        const { shapes } = generateShapesWithBatchConfig(8,
          { x: 0, y: 0, width: 300, height: 300 },
          { enabledShapeTypes: ['rectangle'], batchConfig: settings, distributionEnabled: false },
          { generationIndex: repetition, startIndex: repetition * 8 });
        expect(shapes).toHaveLength(8);
        shapes.forEach((shape, index) =>
          expect(shape.properties.fillColor).toBe(resolve(index, 8)));
      }
      const autoSettings = {
        ...settings,
        fillColorPaletteDistribution: 'even' as const,
      };
      for (const count of [5, 12]) {
        const { shapes } = generateShapesWithBatchConfig(count,
          { x: 0, y: 0, width: 300, height: 300 },
          { enabledShapeTypes: ['rectangle'], batchConfig: autoSettings, distributionEnabled: false });
        expect(shapes).toHaveLength(count);
        shapes.forEach((shape, index) =>
          expect(shape.properties.fillColor).toBe(resolve(index, count, 'even')));
      }
    } finally {
      log.mockRestore();
    }
  });

  it('counts corner grid intersections on the server before placing automatic anchors', () => {
    const settings = {
      ...defaultBatchConfigSettings,
      propertiesEnabled: true,
      fillGradientEnabled: false,
      fillColorMode: 'palette' as const,
      fillColorPaletteBehavior: 'blend' as const,
      fillColorPaletteDistribution: 'even' as const,
      fillColorPalette: ['#ff0000', '#00ff00', '#0000ff', '#ffff00'],
      distributionLayoutEnabled: true,
      distributionPattern: 'grid' as const,
      gridFillEnabled: true,
      gridRows: 1,
      gridColumns: 1,
      cellConstraints: {
        ...defaultBatchConfigSettings.cellConstraints,
        enabled: true,
        renderMode: 'cell-corners' as const,
      },
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { shapes } = generateShapesWithBatchConfig(1,
        { x: 0, y: 0, width: 300, height: 300 },
        { enabledShapeTypes: ['rectangle'], batchConfig: settings, distributionEnabled: false });
      expect(shapes).toHaveLength(4);
      expect(shapes.map(shape => shape.properties.fillColor)).toEqual(settings.fillColorPalette);
    } finally {
      log.mockRestore();
    }
  });
});