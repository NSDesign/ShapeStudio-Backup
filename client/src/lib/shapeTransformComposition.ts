import type { Transform } from './shapeTypes';

export interface TransformAmounts {
  translationX: number;
  translationY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

interface RandomizationOptions {
  scale: number;
  rotation: number;
  translationX: number;
  translationY: number;
  maintainScaleAspectRatio: boolean;
  applyScale: boolean;
  applyRotation: boolean;
  applyTranslation: boolean;
  enabled: boolean;
}

/** Randomization percentages vary the configured transform, never create a new one from zero. */
export function randomizeTransformAmounts(
  amounts: TransformAmounts,
  options: RandomizationOptions,
  random: () => number = Math.random,
): TransformAmounts {
  if (!options.enabled) return amounts;
  const vary = (base: number, strength: number) =>
    base === 0 || strength <= 0 ? base : base * (1 + (random() * 2 - 1) * strength / 100);
  const scale = (base: number, strength: number) =>
    base === 1 || strength <= 0 ? base : Math.max(0.1, 1 + (base - 1) * (1 + (random() * 2 - 1) * strength / 100));

  const scaleX = options.applyScale ? scale(amounts.scaleX, options.scale) : amounts.scaleX;
  return {
    translationX: options.applyTranslation ? vary(amounts.translationX, options.translationX) : amounts.translationX,
    translationY: options.applyTranslation ? vary(amounts.translationY, options.translationY) : amounts.translationY,
    scaleX,
    scaleY: options.applyScale
      ? (options.maintainScaleAspectRatio ? scaleX : scale(amounts.scaleY, options.scale))
      : amounts.scaleY,
    rotation: options.applyRotation ? vary(amounts.rotation, options.rotation) : amounts.rotation,
  };
}

interface PerShapeTransformOptions {
  originX: number;
  originY: number;
  translationX: number;
  translationY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  applyScale: boolean;
  applyRotation: boolean;
  postPlacement: boolean;
}

/** Compose a per-shape transform with the existing geometry and layout transform. */
export function composePerShapeTransform(
  transform: Transform,
  options: PerShapeTransformOptions,
): Pick<Transform, 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation'> {
  const {
    originX, originY, translationX, translationY, scaleX, scaleY,
    rotation, applyScale, applyRotation, postPlacement,
  } = options;
  // The requested scale is a multiplier for the position around the pivot.
  // In post-placement mode it must also multiply the cell-fit scale, not replace it.
  const relativeX = (transform.x - originX) * (applyScale ? scaleX : 1);
  const relativeY = (transform.y - originY) * (applyScale ? scaleY : 1);
  const angle = (applyRotation ? rotation : 0) * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: originX + relativeX * cos - relativeY * sin + translationX,
    y: originY + relativeX * sin + relativeY * cos + translationY,
    scaleX: applyScale ? (postPlacement ? transform.scaleX * scaleX : scaleX) : transform.scaleX,
    scaleY: applyScale ? (postPlacement ? transform.scaleY * scaleY : scaleY) : transform.scaleY,
    rotation: applyRotation ? (postPlacement ? transform.rotation + rotation : rotation) : transform.rotation,
  };
}