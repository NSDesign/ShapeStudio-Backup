import { describe, expect, it } from 'vitest';
import { DEFAULT_ECHO_SPREAD_CONFIG, defaultBatchConfigSettings, type EchoSpreadConfig } from '@shared/schema';
import { calculateEchoTransforms } from '@shared/echoUtils';
import { generateShapesWithBatchConfig as generateServerShapes } from '../../../server/lib/batchConfigProcessor';
import { Shape } from './shapes';
import { addEchoesToShapes, resolveEchoConfig } from './echoGeneration';

const bounds = { x: -100, y: -100, width: 200, height: 200 };

function shape(x = 0, y = 0): Shape {
  const result = new Shape('rectangle', x, y);
  result.properties.zIndex = 100;
  result.properties.fillColor = '#ff0000';
  result.properties.strokeColor = '#0000ff';
  result.properties.fillOpacity = 0.8;
  result.properties.strokeOpacity = 0.6;
  return result;
}

function config(scope: EchoSpreadConfig['scope'], echoCount = 2): EchoSpreadConfig {
  return {
    ...structuredClone(DEFAULT_ECHO_SPREAD_CONFIG),
    enabled: true,
    scope,
    echoCount,
    fixedVector: { angle: 0, distance: 10 },
  };
}

describe('Echo generation for live and batch shape collection', () => {
  it('leaves disabled generations and already-formed single exports unchanged', () => {
    const originals = [shape()];
    expect(addEchoesToShapes(originals, DEFAULT_ECHO_SPREAD_CONFIG, 0, bounds).shapes).toBe(originals);
    expect(addEchoesToShapes(originals, config('set', 0), 0, bounds).shapes).toBe(originals);
    // The single-export branch directly uses preformed shapes; no Echo generation is called.
    const preformedShapes = addEchoesToShapes(originals, config('set'), 0, bounds).shapes;
    expect([...preformedShapes].filter(s => (s as any)._isEcho)).toHaveLength(2);
  });

  it.each([
    ['set', 4, ['set']],
    ['shape', 4, ['shape']],
    ['both', 8, ['both-set', 'both-shape']],
  ] as const)('collects %s echoes behind originals across two repetitions', (scope, perRep, echoScopes) => {
    const selectedConfig = config(scope, 1);
    let previousCentroid: { x: number; y: number } | undefined;
    const collected: Shape[] = [];
    for (let repIndex = 0; repIndex < 2; repIndex++) {
      const originals = [shape(10 + repIndex * 5), shape(25 + repIndex * 5)];
      const result = addEchoesToShapes(originals, selectedConfig, repIndex, bounds, previousCentroid);
      previousCentroid = result.previousCentroid;
      expect(result.shapes.slice(-2)).toEqual(originals);
      expect(result.shapes.slice(0, -2).every(s => s.properties.zIndex < 100)).toBe(true);
      collected.push(...result.shapes);
    }
    expect(collected.filter(s => (s as any)._isEcho)).toHaveLength(perRep);
    expect(new Set(collected.filter(s => (s as any)._isEcho).map(s => (s as any)._echoScope)))
      .toEqual(new Set(echoScopes));
  });

  it('uses an enabled per-set override and falls back when it is disabled', () => {
    const saved = config('set', 1);
    const override = config('shape', 3);
    const effective = resolveEchoConfig({ echoSpread: saved }, { enabled: true, config: override });
    expect(addEchoesToShapes([shape()], effective, 0, bounds).shapes).toHaveLength(4);
    expect(resolveEchoConfig({ echoSpread: saved }, { enabled: false, config: override })).toBe(saved);
    expect(resolveEchoConfig({ echoSpread: DEFAULT_ECHO_SPREAD_CONFIG })).toBe(DEFAULT_ECHO_SPREAD_CONFIG);
  });

  it('preserves configured offset, opacity, scale, rotation, blur and colour on clones', () => {
    const settings = config('set', 1);
    settings.opacity = { ...settings.opacity, startOpacity: 50 };
    settings.scale = { ...settings.scale, enabled: true, startScale: 80 };
    settings.rotation = { ...settings.rotation, enabled: true, startRotation: 15 };
    settings.blur = { ...settings.blur, enabled: true, startBlur: 5 };
    settings.colorShift = { ...settings.colorShift!, enabled: true, hueDelta: 120 };
    const original = shape();
    const echo = addEchoesToShapes([original], settings, 0, bounds).shapes[0];
    const expected = calculateEchoTransforms(settings, 0)[0];
    expect(echo.transform.x).toBeCloseTo(original.transform.x + 10);
    expect(echo.properties.fillOpacity).toBeCloseTo(original.properties.fillOpacity * expected.opacity);
    expect(echo.transform.scaleX).toBeCloseTo(expected.scale);
    expect(echo.transform.rotation).toBeCloseTo(expected.rotation);
    expect(echo.properties.blurRadius).toBeCloseTo(expected.blur);
    expect(echo.properties.fillColor).not.toBe(original.properties.fillColor);
    expect(original.transform.x).toBe(0);
  });

  it('uses the previous repetition centroid for auto-motion, never another set or artwork', () => {
    const settings = config('set', 1);
    settings.directionMode = 'auto-motion';
    const first = addEchoesToShapes([shape(0)], settings, 0, bounds);
    const repeated = addEchoesToShapes([shape(30)], settings, 1, bounds, first.previousCentroid);
    const fresh = addEchoesToShapes([shape(30)], settings, 1, bounds);
    expect(repeated.shapes[0].transform.x).not.toBeCloseTo(fresh.shapes[0].transform.x);
  });

  it('server generation still includes Echo clones and respects per-set override', () => {
    const saved = config('set', 1);
    const override = config('shape', 2);
    const options = {
      enabledShapeTypes: ['rectangle' as const],
      batchConfig: { ...defaultBatchConfigSettings, echoSpread: saved },
      echoOverride: { enabled: true, config: override },
    };
    const { shapes } = generateServerShapes(1, bounds, options, { generationIndex: 0, startIndex: 0 });
    expect(shapes.filter(s => (s as any)._isEcho)).toHaveLength(2);
    expect(shapes).toHaveLength(3);
  });
});