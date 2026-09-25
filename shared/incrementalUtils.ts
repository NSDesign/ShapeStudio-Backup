/**
 * Shared Incremental Value Utilities
 *
 * These functions calculate incremental values based on index driver selection.
 * Used by both client and server for consistent behavior in shape generation.
 *
 * The Index Driver feature allows users to choose whether incremental calculations
 * should be based on shape index (within a set) or set repetition index (generation count).
 */

import type { IncrementalIndexDriver } from './schema';

/**
 * Context for incremental calculations - contains both possible index values
 */
export interface IncrementalContext {
  shapeIndex: number;
  setRepIndex: number;
}

/**
 * Configuration for an incremental value calculation
 */
export interface IncrementalConfig {
  startValue: number;
  increment: number;
  modulationEnabled?: boolean;
  modulationValue?: number;
  startOffset?: number;        // per-cycle shift applied to the start value
  startOffsetCompound?: boolean;
  wrapOffset?: number;         // per-cycle shift applied to the wrap threshold
  wrapOffsetCompound?: boolean;
  bounce?: boolean;            // true = triangle-wave (bounce), false = sawtooth (cycle)
}

/**
 * Get the effective index based on the selected driver
 */
export function getEffectiveIndex(
  driver: IncrementalIndexDriver,
  context: IncrementalContext
): number {
  return driver === 'setRepIndex' ? context.setRepIndex : context.shapeIndex;
}

/**
 * Apply threshold-based modulation with optional per-cycle start and wrap offsets.
 *
 * Cycle mode (bounce=false, default): sawtooth wave
 *   steps          = floor(|startValue − threshold| / |increment|) + 1
 *   effectiveIndex = rawIndex % steps
 *   value          = startValue + increment × effectiveIndex
 *
 * Bounce mode (bounce=true): triangle wave
 *   period         = 2 × (steps − 1)
 *   localIndex     = rawIndex % period
 *   if localIndex < steps: value = startValue + increment × localIndex
 *   else:                  value = startValue + increment × (period − localIndex)
 *
 * With startOffset: each cycle's start shifts by
 *   startOffset × wrapCount        (linear)
 *   startOffset × wrapCount²       (compound)
 *
 * With wrapOffset: each cycle's threshold shifts by
 *   wrapOffset × wrapCount        (linear)
 *   wrapOffset × wrapCount²       (compound)
 *
 * wrapCount is 0 for the first cycle/leg, 1 for the second, etc.
 * In bounce mode each direction reversal increments wrapCount.
 * Both offsets can be used simultaneously.
 *
 * Returns startValue unchanged when increment is 0.
 */
export function applyThresholdModulation(
  rawIndex: number,
  startValue: number,
  increment: number,
  threshold: number,
  startOffset: number = 0,
  startOffsetCompound: boolean = false,
  wrapOffset: number = 0,
  wrapOffsetCompound: boolean = false,
  bounce: boolean = false
): number {
  if (increment === 0) return startValue;

  if (!bounce) {
    // ── Cycle (sawtooth) mode ──────────────────────────────────────────────
    if (startOffset === 0 && wrapOffset === 0) {
      const range = Math.abs(startValue - threshold);
      const steps = Math.floor(range / Math.abs(increment)) + 1;
      if (steps <= 0) return startValue;
      const effectiveIndex = rawIndex % steps;
      return startValue + increment * effectiveIndex;
    }

    let accumulated = 0;
    let wrapCount = 0;
    for (let safety = 0; safety < 100000; safety++) {
      const startTotalOffset = startOffsetCompound
        ? startOffset * wrapCount * wrapCount
        : startOffset * wrapCount;
      const effectiveStart = startValue + startTotalOffset;

      const wrapTotalOffset = wrapOffsetCompound
        ? wrapOffset * wrapCount * wrapCount
        : wrapOffset * wrapCount;
      const effectiveThreshold = threshold + wrapTotalOffset;

      const range = Math.abs(effectiveStart - effectiveThreshold);
      const steps = Math.floor(range / Math.abs(increment)) + 1;

      if (rawIndex < accumulated + steps) {
        const localIndex = rawIndex - accumulated;
        return effectiveStart + increment * localIndex;
      }
      accumulated += steps;
      wrapCount++;
    }
    return startValue;
  }

  // ── Bounce (triangle-wave) mode ─────────────────────────────────────────
  if (startOffset === 0 && wrapOffset === 0) {
    const range = Math.abs(startValue - threshold);
    const steps = Math.floor(range / Math.abs(increment)) + 1;
    if (steps <= 1) return startValue;
    const period = 2 * (steps - 1);
    const localIndex = rawIndex % period;
    if (localIndex < steps) {
      return startValue + increment * localIndex;
    } else {
      return startValue + increment * (period - localIndex);
    }
  }

  // Bounce with per-cycle offsets: each half-period (leg) increments wrapCount.
  // Even legs go forward (start→threshold), odd legs go backward (threshold→start).
  let accumulated = 0;
  let wrapCount = 0;
  let goingForward = true;

  for (let safety = 0; safety < 100000; safety++) {
    const startTotalOffset = startOffsetCompound
      ? startOffset * wrapCount * wrapCount
      : startOffset * wrapCount;
    const effectiveStart = startValue + startTotalOffset;

    const wrapTotalOffset = wrapOffsetCompound
      ? wrapOffset * wrapCount * wrapCount
      : wrapOffset * wrapCount;
    const effectiveThreshold = threshold + wrapTotalOffset;

    const range = Math.abs(effectiveStart - effectiveThreshold);
    const steps = Math.floor(range / Math.abs(increment)) + 1;

    if (rawIndex < accumulated + steps) {
      const localIndex = rawIndex - accumulated;
      if (goingForward) {
        return effectiveStart + increment * localIndex;
      } else {
        return effectiveThreshold - increment * localIndex;
      }
    }
    accumulated += steps;
    wrapCount++;
    goingForward = !goingForward;
  }

  return startValue;
}

/**
 * Calculate an incremental value based on the selected index driver.
 *
 * When modulation is enabled, uses the threshold formula via applyThresholdModulation.
 * Passes through startOffset, startOffsetCompound, wrapOffset, wrapOffsetCompound, bounce from config.
 */
export function calculateIncrementalValue(
  config: IncrementalConfig,
  driver: IncrementalIndexDriver,
  context: IncrementalContext
): number {
  const index = getEffectiveIndex(driver, context);

  if (
    config.modulationEnabled &&
    config.modulationValue !== undefined &&
    config.increment !== 0
  ) {
    return applyThresholdModulation(
      index,
      config.startValue,
      config.increment,
      config.modulationValue,
      config.startOffset ?? 0,
      config.startOffsetCompound ?? false,
      config.wrapOffset ?? 0,
      config.wrapOffsetCompound ?? false,
      config.bounce ?? false
    );
  }

  return config.startValue + (config.increment * index);
}

/**
 * Calculate an incremental value with clamping support
 */
export function calculateIncrementalValueClamped(
  config: IncrementalConfig,
  driver: IncrementalIndexDriver,
  context: IncrementalContext,
  min: number,
  max: number
): number {
  const value = calculateIncrementalValue(config, driver, context);
  return Math.max(min, Math.min(max, value));
}

/**
 * Create an IncrementalContext from shape generation parameters
 */
export function createIncrementalContext(
  shapeIndex: number,
  setRepIndex: number
): IncrementalContext {
  return { shapeIndex, setRepIndex };
}

export const DEFAULT_INDEX_DRIVER: IncrementalIndexDriver = 'shapeIndex';
