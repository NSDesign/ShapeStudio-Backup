import { describe, expect, it } from 'vitest';
import { calculateGradientScale, calculateLinearCenterX, calculateLinearCenterY } from '../shared/batchUtils';
import { BatchConfigSettingsSchema, defaultBatchConfigSettings } from '../shared/schema';

describe('gradient control settings', () => {
  it('accepts old saved settings without the new gradient fields', () => {
    const legacy = { ...defaultBatchConfigSettings } as Record<string, unknown>;
    for (const key of Object.keys(legacy)) {
      if (key.startsWith('fillGradientLinearCenter') ||
          /^fillGradient(Linear|Radial|Diamond)Scale/.test(key) ||
          key === 'gradientScaleIncrementalIndexDriver') {
        delete legacy[key];
      }
    }
    delete legacy.fillGradientLinearCorners;
    delete legacy.fillGradientLinearMidpoints;
    delete legacy.fillGradientLinearSelectionMode;
    // The full application's defaults include unrelated legacy echo fields that
    // do not satisfy the standalone schema; validate the gradient slice here.
    const gradientFields = BatchConfigSettingsSchema.pick({
      fillGradientLinearCenter: true,
      fillGradientLinearScale: true,
      fillGradientRadialScale: true,
      fillGradientDiamondScale: true,
      fillGradientDiamondScaleEdgeMode: true,
    });
    const parsed = gradientFields.parse(legacy);
    expect(parsed.fillGradientLinearCenter).toBe('center');
    expect(parsed.fillGradientLinearScale).toBe(100);
    expect(parsed.fillGradientRadialScale).toBe(100);
    expect(parsed.fillGradientDiamondScale).toBe(100);
    expect(parsed.fillGradientDiamondScaleEdgeMode).toBe('streak');
  });

  it('resolves linear coordinates from their selected mode', () => {
    const settings = {
      ...defaultBatchConfigSettings,
      fillGradientLinearCenterXMode: 'incremental' as const,
      fillGradientLinearCenterXStartValue: 20,
      fillGradientLinearCenterXIncrement: 15,
      fillGradientLinearCenterYMode: 'series' as const,
      fillGradientLinearCenterYSeriesItems: [
        { mode: 'fixed' as const, value: 35 },
        { mode: 'fixed' as const, value: 75 },
      ],
    };
    expect(calculateLinearCenterX(settings, 2)).toBe(50);
    expect(calculateLinearCenterY(settings, 1)).toBe(75);
  });

  it('resolves scale modes and honors zero increment and the set-rep driver', () => {
    const fixed = { ...defaultBatchConfigSettings, fillGradientLinearScale: 125 };
    expect(calculateGradientScale(fixed, 'Linear', 0)).toBe(125);

    const incremental = {
      ...fixed,
      fillGradientLinearScaleMode: 'incremental' as const,
      fillGradientLinearScaleStartValue: 70,
      fillGradientLinearScaleIncrement: 5,
      gradientScaleIncrementalIndexDriver: 'setRepIndex' as const,
    };
    expect(calculateGradientScale(incremental, 'Linear', 8, 3)).toBe(85);
    expect(calculateGradientScale({ ...incremental, fillGradientLinearScaleIncrement: 0 }, 'Linear', 8, 3)).toBe(70);

    const series = {
      ...defaultBatchConfigSettings,
      fillGradientDiamondScaleMode: 'series' as const,
      fillGradientDiamondScaleSeriesItems: [
        { mode: 'fixed' as const, value: 65 },
        { mode: 'fixed' as const, value: 145 },
      ],
    };
    expect(calculateGradientScale(series, 'Diamond', 1)).toBe(145);
  });
});