import { describe, expect, it } from 'vitest';
import {
  calculateDiamondGradientTexture,
  calculateLinearGradientCoords,
  calculateRadialGradientCoords,
  type ParsedGradientStop,
} from '../shared/gradientUtils';

const stops: ParsedGradientStop[] = [
  { offset: 0, r: 255, g: 0, b: 0, a: 255 },
  { offset: 1, r: 0, g: 0, b: 255, a: 255 },
];

describe('gradient spatial scale', () => {
  it('scales linear source length outward and inward around its center', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 80 };
    const neutral = calculateLinearGradientCoords(bounds, 0, 50, 50, 100);
    const compressed = calculateLinearGradientCoords(bounds, 0, 50, 50, 50);
    const expanded = calculateLinearGradientCoords(bounds, 0, 50, 50, 150);
    expect(neutral.x2 - neutral.x1).toBe(100);
    expect(compressed.x2 - compressed.x1).toBe(50);
    expect(expanded.x2 - expanded.x1).toBe(150);
  });

  it('scales radial radius by the source scale', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 80 };
    expect(calculateRadialGradientCoords(bounds, 50, 50, 50).outerRadius).toBe(25);
    expect(calculateRadialGradientCoords(bounds, 50, 50, 100).outerRadius).toBe(50);
    expect(calculateRadialGradientCoords(bounds, 50, 50, 150).outerRadius).toBe(75);
  });

  it('repeats by diamond distance only below neutral scale', () => {
    const neutralStreak = calculateDiamondGradientTexture(stops, 101, 101, 50, 50, 0, 100, 'streak');
    const neutralRepeat = calculateDiamondGradientTexture(stops, 101, 101, 50, 50, 0, 100, 'repeat');
    const compressedStreak = calculateDiamondGradientTexture(stops, 101, 101, 50, 50, 0, 50, 'streak');
    const compressedRepeat = calculateDiamondGradientTexture(stops, 101, 101, 50, 50, 0, 50, 'repeat');
    const edge = (data: Uint8ClampedArray) => Array.from(data.slice((50 * 101 + 100) * 4, (50 * 101 + 100) * 4 + 4));
    expect(edge(neutralRepeat)).toEqual(edge(neutralStreak));
    expect(edge(compressedRepeat)).not.toEqual(edge(compressedStreak));
  });
});