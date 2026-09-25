import type { EchoSpreadConfig } from '@shared/schema';
import { DEFAULT_ECHO_SPREAD_CONFIG } from '@shared/schema';
import {
  calculateEchoTransforms,
  isEchoEnabled,
  shouldApplyEchoToShape,
  type AbsolutePositionContext,
  type AutoMotionContext,
  type EchoTransform,
} from '@shared/echoUtils';
import { Shape } from './shapes';
import { ColorUtils } from './colorManipulation';

type Bounds = { x: number; y: number; width: number; height: number };
type Centroid = { x: number; y: number };
type EchoOverride = { enabled: boolean; config?: EchoSpreadConfig };

/** Select the same per-set override used by the server generator. */
export function resolveEchoConfig(
  batchConfig: { echoSpread?: EchoSpreadConfig } | undefined,
  override?: EchoOverride,
): EchoSpreadConfig {
  return override?.enabled && override.config
    ? override.config
    : (batchConfig?.echoSpread ?? DEFAULT_ECHO_SPREAD_CONFIG);
}

function makeEcho(
  original: Shape,
  transform: EchoTransform,
  index: number,
  scope: 'set' | 'shape' | 'both-set' | 'both-shape',
): Shape {
  const echo = original.clone();
  (echo as any)._isEcho = true;
  (echo as any)._echoIndex = index;
  (echo as any)._sourceShapeId = original.id;
  (echo as any)._echoScope = scope;

  echo.transform.x += transform.offsetX;
  echo.transform.y += transform.offsetY;
  echo.transform.scaleX *= transform.scale;
  echo.transform.scaleY *= transform.scale;
  echo.transform.rotation += transform.rotation;
  echo.properties.fillOpacity *= transform.opacity;
  echo.properties.strokeOpacity *= transform.opacity;
  if (transform.blur > 0) echo.properties.blurRadius = transform.blur;

  if (transform.hueShift || transform.saturationShift || transform.lightnessShift) {
    const shift = {
      enabled: true,
      hue: transform.hueShift,
      saturation: transform.saturationShift,
      lightness: transform.lightnessShift,
    };
    if (echo.properties.fillColor && echo.properties.fillColor !== 'none') {
      echo.properties.fillColor = ColorUtils.applyHSLShift(echo.properties.fillColor, shift);
    }
    if (echo.properties.strokeColor && echo.properties.strokeColor !== 'none') {
      echo.properties.strokeColor = ColorUtils.applyHSLShift(echo.properties.strokeColor, shift);
    }
  }
  echo.properties.zIndex -= (index + 1) * (scope === 'both-shape' ? 0.05 : 0.1);
  return echo;
}

/**
 * Apply Echo only to finalized originals; never feed echoed shapes back into this step.
 * The returned previousCentroid belongs to one set's repetition sequence and must be
 * reset for a new set or artwork (no cross-export window/global state).
 */
export function addEchoesToShapes(
  originals: Shape[],
  config: EchoSpreadConfig | undefined,
  repIndex: number,
  bounds: Bounds,
  previousCentroid?: Centroid,
): { shapes: Shape[]; previousCentroid?: Centroid } {
  if (!isEchoEnabled(config) || originals.length === 0) {
    return { shapes: originals, previousCentroid };
  }
  const echoConfig = config!;
  const scope = echoConfig.scope ?? 'set';
  const driver = echoConfig.driver ?? 'setRepIndex';
  const echoes: Shape[] = [];
  const centroid = {
    x: originals.reduce((sum, shape) => sum + shape.transform.x, 0) / originals.length,
    y: originals.reduce((sum, shape) => sum + shape.transform.y, 0) / originals.length,
  };
  const absoluteContext = (point: Centroid): AbsolutePositionContext | undefined =>
    echoConfig.directionMode === 'absolute-position'
      ? {
          shapeX: point.x, shapeY: point.y,
          artboardX: bounds.x, artboardY: bounds.y,
          artboardWidth: bounds.width, artboardHeight: bounds.height,
        }
      : undefined;

  if (scope === 'set' || scope === 'both') {
    const motion: AutoMotionContext | undefined = repIndex > 0 && previousCentroid
      ? { prevX: previousCentroid.x, prevY: previousCentroid.y, currentX: centroid.x, currentY: centroid.y }
      : undefined;
    const transforms = calculateEchoTransforms(echoConfig, repIndex, motion, absoluteContext(centroid));
    originals.forEach(shape => transforms.forEach((transform, index) => {
      echoes.push(makeEcho(shape, transform, index, scope === 'both' ? 'both-set' : 'set'));
    }));
  }

  if (scope === 'shape' || scope === 'both') {
    originals.forEach((shape, shapeIndex) => {
      if (!shouldApplyEchoToShape(shapeIndex, shape.type, echoConfig.applyTo, scope === 'both' ? undefined : shapeIndex)) return;
      const driverIndex = driver === 'combined'
        ? shapeIndex + repIndex * originals.length
        : driver === 'shapeIndex' ? shapeIndex : repIndex;
      const previous = originals[shapeIndex - 1];
      const motion: AutoMotionContext | undefined = shapeIndex > 0 && echoConfig.directionMode === 'auto-motion'
        ? { prevX: previous.transform.x, prevY: previous.transform.y, currentX: shape.transform.x, currentY: shape.transform.y }
        : undefined;
      const transforms = calculateEchoTransforms(
        echoConfig, driverIndex, motion,
        absoluteContext({ x: shape.transform.x, y: shape.transform.y }),
      );
      transforms.forEach((transform, index) => {
        echoes.push(makeEcho(shape, transform, index, scope === 'both' ? 'both-shape' : 'shape'));
      });
    });
  }

  return { shapes: [...echoes, ...originals], previousCentroid: centroid };
}