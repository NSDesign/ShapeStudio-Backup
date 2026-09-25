/**
 * Shared Shape Property Calculation Utilities
 *
 * Single canonical implementation of every per-shape property calculation.
 * Both the client (useShapeEditor.ts) and the server (batchConfigProcessor.ts)
 * import from here so divergences between the two are structurally impossible.
 *
 * All functions are pure: no closures, no global state.
 * `lastIncrementalIndex` (cross-batch offset) is an explicit param (default 0).
 */

import type { BatchConfigSettings } from './schema';
import { calculateIncrementalValue, applyThresholdModulation, type IncrementalConfig, type IncrementalContext } from './incrementalUtils';
import { resolveScalarSeries } from './batchUtils';

// ─── Effect Colour Helper ────────────────────────────────────────────────────

export function deriveEffectColor(
  baseColor: string,
  mode: 'darken' | 'lighten',
  amount: number = 30
): string {
  if (!baseColor || baseColor === 'none' || baseColor === 'transparent') {
    return mode === 'darken' ? '#000000' : '#ffffff';
  }
  const hexMatch = baseColor.match(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/);
  if (!hexMatch) return mode === 'darken' ? '#000000' : '#ffffff';

  let hex = hexMatch[1];
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const r = parseInt(hex.substring(0,2),16);
  const g = parseInt(hex.substring(2,4),16);
  const b = parseInt(hex.substring(4,6),16);

  const rN = r/255, gN = g/255, bN = b/255;
  const max = Math.max(rN,gN,bN), min = Math.min(rN,gN,bN);
  let h = 0, s = 0, l = (max+min)/2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch (max) {
      case rN: h = ((gN-bN)/d + (gN<bN?6:0))/6; break;
      case gN: h = ((bN-rN)/d + 2)/6; break;
      case bN: h = ((rN-gN)/d + 4)/6; break;
    }
  }
  l = mode === 'darken' ? Math.max(0, l - amount/100) : Math.min(1, l + amount/100);

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t<0) t+=1; if (t>1) t-=1;
    if (t<1/6) return p+(q-p)*6*t;
    if (t<1/2) return q;
    if (t<2/3) return p+(q-p)*(2/3-t)*6;
    return p;
  };
  const q = l<0.5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
  const toHex = (n: number) => Math.round(hue2rgb(p,q,n)*255).toString(16).padStart(2,'0');
  return `#${toHex(h+1/3)}${toHex(h)}${toHex(h-1/3)}`;
}

// ─── Blur ────────────────────────────────────────────────────────────────────

export function calculateBlur(
  settings: BatchConfigSettings,
  shapeIndex: number,
  setRepIndex: number = 0
): number {
  switch (settings.blurMode) {
    case 'range': {
      const [minBlur, maxBlur] = settings.blurRange;
      return minBlur + Math.random() * (maxBlur - minBlur);
    }
    case 'define':
      return settings.blurDefine;
    case 'incremental': {
      const driver = settings.blurIncrementalIndexDriver || 'shapeIndex';
      const context: IncrementalContext = { shapeIndex, setRepIndex };
      const config: IncrementalConfig = {
        startValue: settings.blurStartValue,
        increment: settings.blurIncrement || 0,
        modulationEnabled: settings.blurModulationEnabled,
        modulationValue: settings.blurModulationValue,
        startOffset: settings.blurStartOffset ?? 0,
        startOffsetCompound: settings.blurStartOffsetCompound ?? false,
        wrapOffset: settings.blurWrapOffset ?? 0,
        wrapOffsetCompound: settings.blurWrapOffsetCompound ?? false,
        bounce: settings.blurModulationBounce ?? false,
      };
      return calculateIncrementalValue(config, driver, context);
    }
    case 'series': {
      const val = resolveScalarSeries(
        settings.blurSeriesItems || [],
        settings.blurSeriesSelection || 'sequential',
        settings.blurSeriesExhaustion || 'cycle',
        settings.blurSeriesDriver || 'shape-index',
        shapeIndex,
        setRepIndex
      );
      return isNaN(val) ? settings.blurDefine : val;
    }
    default:
      return 0;
  }
}

// ─── Stroke Width ────────────────────────────────────────────────────────────

export function calculateStrokeWidth(
  settings: BatchConfigSettings,
  shapeIndex: number,
  setRepIndex: number = 0
): number {
  if (settings.strokeWidthEnabled === false) return 1;
  const driver = settings.strokeIncrementalIndexDriver || 'shapeIndex';
  const effectiveIndex = driver === 'setRepIndex' ? setRepIndex : shapeIndex;
  switch (settings.strokeWidthMode) {
    case 'range': {
      const [minW, maxW] = settings.strokeWidthRange ?? [1, 5];
      return minW + Math.random() * (maxW - minW);
    }
    case 'define':
      return settings.strokeWidthDefine ?? 3;
    case 'incremental': {
      const swStart = settings.strokeWidthStartValue ?? 1;
      const swInc = settings.strokeWidthIncrement ?? 0.5;
      if (settings.strokeWidthModulationEnabled && settings.strokeWidthModulationValue !== undefined && swInc !== 0)
        return applyThresholdModulation(effectiveIndex, swStart, swInc, settings.strokeWidthModulationValue, 0, false, 0, false, settings.strokeWidthModulationBounce ?? false);
      return swStart + swInc * effectiveIndex;
    }
    case 'series': {
      const val = resolveScalarSeries(
        settings.strokeWidthSeriesItems || [],
        settings.strokeWidthSeriesSelection || 'sequential',
        settings.strokeWidthSeriesExhaustion || 'cycle',
        settings.strokeWidthSeriesDriver || 'shape-index',
        shapeIndex,
        setRepIndex
      );
      return isNaN(val) ? (settings.strokeWidthDefine ?? 3) : val;
    }
    default:
      return 1;
  }
}

// ─── Fill Opacity ─────────────────────────────────────────────────────────────

export function calculateFillOpacity(
  settings: BatchConfigSettings,
  shapeIndex: number,
  setRepIndex: number = 0
): number {
  if (settings.fillOpacityEnabled === false) return 1;
  const driver = settings.fillOpacityIncrementalIndexDriver || 'shapeIndex';
  const effectiveIndex = driver === 'setRepIndex' ? setRepIndex : shapeIndex;
  switch (settings.fillOpacityMode) {
    case 'range': {
      const [minOp, maxOp] = settings.fillOpacityRange ?? [60, 100];
      return (minOp + Math.random() * (maxOp - minOp)) / 100;
    }
    case 'define':
      return (settings.fillOpacityDefine ?? 80) / 100;
    case 'incremental': {
      const foStart = settings.fillOpacityStartValue ?? 70;
      const foInc = settings.fillOpacityIncrement ?? 5;
      let foValue: number;
      if (settings.fillOpacityModulationEnabled && settings.fillOpacityModulationValue !== undefined && foInc !== 0)
        foValue = applyThresholdModulation(effectiveIndex, foStart, foInc, settings.fillOpacityModulationValue, 0, false, 0, false, settings.fillOpacityModulationBounce ?? false);
      else
        foValue = foStart + foInc * effectiveIndex;
      return Math.max(0, Math.min(100, foValue)) / 100;
    }
    case 'series': {
      const val = resolveScalarSeries(
        settings.fillOpacitySeriesItems || [],
        settings.fillOpacitySeriesSelection || 'sequential',
        settings.fillOpacitySeriesExhaustion || 'cycle',
        settings.fillOpacitySeriesDriver || 'shape-index',
        shapeIndex,
        setRepIndex
      );
      return isNaN(val) ? (settings.fillOpacityDefine ?? 80) / 100 : Math.max(0, Math.min(100, val)) / 100;
    }
    default:
      return 1;
  }
}

// ─── Stroke Opacity ──────────────────────────────────────────────────────────

export function calculateStrokeOpacity(
  settings: BatchConfigSettings,
  shapeIndex: number,
  setRepIndex: number = 0
): number {
  if (settings.strokeOpacityEnabled === false) return 1;
  const driver = settings.strokeIncrementalIndexDriver || 'shapeIndex';
  const effectiveIndex = driver === 'setRepIndex' ? setRepIndex : shapeIndex;
  switch (settings.strokeOpacityMode) {
    case 'range': {
      const [minOp, maxOp] = settings.strokeOpacityRange ?? [40, 100];
      return (minOp + Math.random() * (maxOp - minOp)) / 100;
    }
    case 'define':
      return (settings.strokeOpacityDefine ?? 80) / 100;
    case 'incremental': {
      const soStart = settings.strokeOpacityStartValue ?? 40;
      const soInc = settings.strokeOpacityIncrement ?? 10;
      let soValue: number;
      if (settings.strokeOpacityModulationEnabled && settings.strokeOpacityModulationValue !== undefined && soInc !== 0)
        soValue = applyThresholdModulation(effectiveIndex, soStart, soInc, settings.strokeOpacityModulationValue, 0, false, 0, false, settings.strokeOpacityModulationBounce ?? false);
      else
        soValue = soStart + soInc * effectiveIndex;
      return Math.max(0, Math.min(100, soValue)) / 100;
    }
    case 'series': {
      const val = resolveScalarSeries(
        settings.strokeOpacitySeriesItems || [],
        settings.strokeOpacitySeriesSelection || 'sequential',
        settings.strokeOpacitySeriesExhaustion || 'cycle',
        settings.strokeOpacitySeriesDriver || 'shape-index',
        shapeIndex,
        setRepIndex
      );
      return isNaN(val) ? (settings.strokeOpacityDefine ?? 80) / 100 : Math.max(0, Math.min(100, val)) / 100;
    }
    default:
      return 1;
  }
}

// ─── Conic Angle ─────────────────────────────────────────────────────────────

/** Returns radians */
export function calculateConicAngle(
  settings: BatchConfigSettings,
  shapeIndex: number,
  setRepIndex: number = 0
): number {
  const driver = settings.gradientCenterIncrementalIndexDriver || 'shapeIndex';
  const effectiveIndex = driver === 'setRepIndex' ? setRepIndex : shapeIndex;
  let angleDegrees: number;

  switch (settings.fillGradientConicAngleMode) {
    case 'range': {
      const [minA, maxA] = settings.fillGradientConicAngleRange || [0, 360];
      angleDegrees = minA + Math.random() * (maxA - minA);
      break;
    }
    case 'incremental': {
      const caStart = settings.fillGradientConicAngleStartValue || 0;
      const caInc = settings.fillGradientConicAngleIncrement || 0;
      if (settings.fillGradientConicAngleModulationEnabled && settings.fillGradientConicAngleModulationValue !== undefined && caInc !== 0)
        angleDegrees = applyThresholdModulation(effectiveIndex, caStart, caInc, settings.fillGradientConicAngleModulationValue, 0, false, 0, false, settings.fillGradientConicAngleModulationBounce ?? false);
      else
        angleDegrees = caStart + caInc * effectiveIndex;
      break;
    }
    case 'series': {
      const items = settings.fillGradientConicAngleSeriesItems ?? [];
      const resolved = resolveScalarSeries(
        items,
        settings.fillGradientConicAngleSeriesSelection ?? 'sequential',
        settings.fillGradientConicAngleSeriesExhaustion ?? 'cycle',
        settings.fillGradientConicAngleSeriesDriver ?? 'shape-index',
        shapeIndex,
        setRepIndex
      );
      angleDegrees = isNaN(resolved) ? 0 : resolved;
      break;
    }
    case 'fixed':
    default:
      angleDegrees = settings.fillGradientConicAngle || 0;
      break;
  }

  angleDegrees = ((angleDegrees % 360) + 360) % 360;
  return (angleDegrees * Math.PI) / 180;
}

export function calculateDiamondAngle(
  settings: BatchConfigSettings,
  shapeIndex: number,
  setRepIndex: number = 0
): number {
  const driver = settings.gradientCenterIncrementalIndexDriver || 'shapeIndex';
  const effectiveIndex = driver === 'setRepIndex' ? setRepIndex : shapeIndex;
  let angleDegrees: number;

  switch (settings.fillGradientDiamondAngleMode) {
    case 'range': {
      const [minA, maxA] = settings.fillGradientDiamondAngleRange || [0, 360];
      angleDegrees = minA + Math.random() * (maxA - minA);
      break;
    }
    case 'incremental': {
      const daStart = settings.fillGradientDiamondAngleStartValue || 0;
      const daInc = settings.fillGradientDiamondAngleIncrement || 0;
      if (settings.fillGradientDiamondAngleModulationEnabled && settings.fillGradientDiamondAngleModulationValue !== undefined && daInc !== 0)
        angleDegrees = applyThresholdModulation(effectiveIndex, daStart, daInc, settings.fillGradientDiamondAngleModulationValue, 0, false, 0, false, settings.fillGradientDiamondAngleModulationBounce ?? false);
      else
        angleDegrees = daStart + daInc * effectiveIndex;
      break;
    }
    case 'series': {
      const items = settings.fillGradientDiamondAngleSeriesItems ?? [];
      const resolved = resolveScalarSeries(
        items,
        settings.fillGradientDiamondAngleSeriesSelection ?? 'sequential',
        settings.fillGradientDiamondAngleSeriesExhaustion ?? 'cycle',
        settings.fillGradientDiamondAngleSeriesDriver ?? 'shape-index',
        shapeIndex,
        setRepIndex
      );
      angleDegrees = isNaN(resolved) ? 0 : resolved;
      break;
    }
    case 'fixed':
    default:
      angleDegrees = settings.fillGradientDiamondAngle || 0;
      break;
  }

  angleDegrees = ((angleDegrees % 360) + 360) % 360;
  return angleDegrees;
}

// ─── Size Constraint ─────────────────────────────────────────────────────────

export function calculateConstrainedSize(
  settings: BatchConfigSettings,
  width: number,
  height: number
): number {
  switch (settings.sizeConstraintMode) {
    case 'min':  return Math.min(width, height);
    case 'max':  return Math.max(width, height);
    case 'avg':  return (width + height) / 2;
    case 'none':
    default:     return Math.max(width, height);
  }
}

// ─── Width ───────────────────────────────────────────────────────────────────

export function calculateWidth(
  settings: BatchConfigSettings,
  shapeIndex: number,
  artboardWidth: number,
  artboardHeight: number,
  batchSize: number,
  setRepIndex: number = 0
): number {
  if (!settings.propertiesEnabled || !settings.shapePropertiesEnabled || !settings.shapePropertiesDimensionsEnabled) {
    return 100;
  }
  let baseWidth = 0;
  switch (settings.widthMode) {
    case 'range': {
      const [minW, maxW] = settings.widthRange;
      const center = minW + (maxW - minW) / 2;
      const half   = (maxW - minW) / 2;
      baseWidth = center + ((Math.random() - 0.5) * 2) * (settings.widthRandomizationScale / 100) * half;
      break;
    }
    case 'value':
      baseWidth = settings.widthValue;
      break;
    case 'incremental': {
      const driver = settings.sizeIncrementalIndexDriver || 'shapeIndex';
      const context: IncrementalContext = { shapeIndex, setRepIndex };
      const config: IncrementalConfig = {
        startValue: settings.widthStartValue,
        increment: settings.widthIncrement,
        modulationEnabled: settings.widthModulationEnabled,
        modulationValue: settings.widthModulationValue,
        startOffset: settings.widthStartOffset ?? 0,
        startOffsetCompound: settings.widthStartOffsetCompound ?? false,
        wrapOffset: settings.widthWrapOffset ?? 0,
        wrapOffsetCompound: settings.widthWrapOffsetCompound ?? false,
        bounce: settings.widthModulationBounce ?? false,
      };
      baseWidth = calculateIncrementalValue(config, driver, context);
      break;
    }
    case 'series': {
      const items = settings.widthSeriesItems ?? [];
      const resolved = resolveScalarSeries(
        items,
        settings.widthSeriesSelection ?? 'sequential',
        settings.widthSeriesExhaustion ?? 'cycle',
        settings.widthSeriesDriver ?? 'shape-index',
        shapeIndex,
        setRepIndex
      );
      baseWidth = isNaN(resolved) ? 100 : resolved;
      break;
    }
    default:
      baseWidth = 100;
  }
  return Math.max(1, baseWidth);
}

// ─── Height ──────────────────────────────────────────────────────────────────

export function calculateHeight(
  settings: BatchConfigSettings,
  shapeIndex: number,
  artboardWidth: number,
  artboardHeight: number,
  batchSize: number,
  setRepIndex: number = 0
): number {
  if (!settings.propertiesEnabled || !settings.shapePropertiesEnabled || !settings.shapePropertiesDimensionsEnabled) {
    return 100;
  }
  let baseHeight = 0;
  switch (settings.heightMode) {
    case 'range': {
      const [minH, maxH] = settings.heightRange;
      const center = minH + (maxH - minH) / 2;
      const half   = (maxH - minH) / 2;
      baseHeight = center + ((Math.random() - 0.5) * 2) * (settings.heightRandomizationScale / 100) * half;
      break;
    }
    case 'value':
      baseHeight = settings.heightValue;
      break;
    case 'incremental': {
      const driver = settings.sizeIncrementalIndexDriver || 'shapeIndex';
      const context: IncrementalContext = { shapeIndex, setRepIndex };
      const config: IncrementalConfig = {
        startValue: settings.heightStartValue,
        increment: settings.heightIncrement,
        modulationEnabled: settings.heightModulationEnabled,
        modulationValue: settings.heightModulationValue,
        startOffset: settings.heightStartOffset ?? 0,
        startOffsetCompound: settings.heightStartOffsetCompound ?? false,
        wrapOffset: settings.heightWrapOffset ?? 0,
        wrapOffsetCompound: settings.heightWrapOffsetCompound ?? false,
        bounce: settings.heightModulationBounce ?? false,
      };
      baseHeight = calculateIncrementalValue(config, driver, context);
      break;
    }
    case 'series': {
      const items = settings.heightSeriesItems ?? [];
      const resolved = resolveScalarSeries(
        items,
        settings.heightSeriesSelection ?? 'sequential',
        settings.heightSeriesExhaustion ?? 'cycle',
        settings.heightSeriesDriver ?? 'shape-index',
        shapeIndex,
        setRepIndex
      );
      baseHeight = isNaN(resolved) ? 100 : resolved;
      break;
    }
    default:
      baseHeight = 100;
  }
  return Math.max(1, baseHeight);
}

// ─── Directional Position ────────────────────────────────────────────────────

export function calculateDirectionalPosition(
  settings: BatchConfigSettings,
  shapeIndex: number,
  artboardWidth: number,
  artboardHeight: number,
  batchSize: number
): { x: number; y: number } {
  let angle = 0;
  const distance = settings.positionDirectionalDistance;

  switch (settings.positionDirectionalMode) {
    case 'outward-center':
      if (settings.directionalEvenDistribution) {
        angle = (shapeIndex * 360 / Math.max(1, batchSize)) * (Math.PI / 180);
      } else {
        const cr = settings.directionalClusterAngle * (Math.PI / 180);
        angle = (shapeIndex * cr / Math.max(1, batchSize - 1)) - (cr / 2);
      }
      break;
    case 'outward-edge': {
      const edgeAngle = Math.atan2(artboardHeight, artboardWidth);
      if (settings.directionalEvenDistribution) {
        angle = (shapeIndex * 2 * Math.PI / Math.max(1, batchSize)) + edgeAngle;
      } else {
        const cr = settings.directionalClusterAngle * (Math.PI / 180);
        angle = (shapeIndex * cr / Math.max(1, batchSize - 1)) - (cr / 2) + edgeAngle;
      }
      break;
    }
    case 'angle-based': {
      const baseAngle = settings.positionDirectionalAngle * (Math.PI / 180);
      if (settings.directionalEvenDistribution) {
        angle = baseAngle;
      } else {
        const cr = settings.directionalClusterAngle * (Math.PI / 180);
        angle = baseAngle + (shapeIndex * cr / Math.max(1, batchSize - 1)) - (cr / 2);
      }
      break;
    }
  }

  return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
}

// ─── Position Anchor ─────────────────────────────────────────────────────────

const ANCHOR_SEQUENCE = ['nw', 'n', 'ne', 'w', 'center', 'e', 'sw', 's', 'se'] as const;

function anchorToFraction(pt: string): { cx: number; cy: number } {
  const col = (pt === 'nw' || pt === 'w' || pt === 'sw') ? 0
            : (pt === 'n'  || pt === 'center' || pt === 's') ? 0.5
            : 1;
  const row = (pt === 'nw' || pt === 'n' || pt === 'ne') ? 0
            : (pt === 'w'  || pt === 'center' || pt === 'e') ? 0.5
            : 1;
  return { cx: col, cy: row };
}

export function resolveAnchorOffset(
  settings: BatchConfigSettings,
  artboardWidth: number,
  artboardHeight: number,
  artboardX: number,
  artboardY: number,
  shapeIndex: number
): { x: number; y: number } {
  const apply = (pt: string) => {
    const { cx, cy } = anchorToFraction(pt);
    return { x: artboardX + cx * artboardWidth, y: artboardY + cy * artboardHeight };
  };

  switch (settings.positionAnchorMode ?? 'fixed') {
    case 'fixed':
      return apply(settings.positionAnchorFixed ?? 'center');
    case 'range': {
      const from = anchorToFraction(settings.positionAnchorFrom ?? 'nw');
      const to   = anchorToFraction(settings.positionAnchorTo ?? 'se');
      const t = Math.random();
      return {
        x: artboardX + (from.cx + t * (to.cx - from.cx)) * artboardWidth,
        y: artboardY + (from.cy + t * (to.cy - from.cy)) * artboardHeight
      };
    }
    case 'incremental': {
      const start = Math.round(settings.positionAnchorIncrementalStart ?? 4);
      const step  = settings.positionAnchorIncrementalStep ?? 1;
      const idx   = Math.abs(start + shapeIndex * step) % ANCHOR_SEQUENCE.length;
      return apply(ANCHOR_SEQUENCE[idx]);
    }
    case 'sequence': {
      const seq = settings.positionAnchorSequence;
      if (!seq || seq.length === 0) return apply('center');
      return apply(seq[shapeIndex % seq.length]);
    }
    default:
      return apply('center');
  }
}

// ─── Polar component helper ───────────────────────────────────────────────────

function calcPolarComponent(
  settings: BatchConfigSettings,
  component: 'angle' | 'radius',
  shapeIndex: number,
  lastIncrementalIndex: number,
  setRepIndex: number
): number {
  const isAngle = component === 'angle';
  const mode = isAngle ? (settings.polarAngleMode ?? 'range') : (settings.polarRadiusMode ?? 'range');

  switch (mode) {
    case 'value':
      return isAngle ? (settings.polarAngleValue ?? 0) : (settings.polarRadiusValue ?? 100);
    case 'range': {
      const [lo, hi] = isAngle ? (settings.polarAngleRange ?? [0, 360]) : (settings.polarRadiusRange ?? [50, 200]);
      return lo + Math.random() * (hi - lo);
    }
    case 'incremental': {
      const driver = settings.positionIncrementalIndexDriver ?? 'shapeIndex';
      const driverIndex = driver === 'setRepIndex' ? setRepIndex : shapeIndex;
      const adjusted = settings.incrementalResetPerBatch ? driverIndex : (driverIndex + lastIncrementalIndex);
      const startValue = isAngle ? (settings.polarAngleStartValue ?? 0) : (settings.polarRadiusStartValue ?? 0);
      const increment  = isAngle ? (settings.polarAngleIncrement ?? 45) : (settings.polarRadiusIncrement ?? 50);
      const modMode    = isAngle ? (settings.polarAngleModulationMode ?? 'off') : (settings.polarRadiusModulationMode ?? 'off');
      const modValue   = isAngle ? (settings.polarAngleModulationValue ?? 360) : (settings.polarRadiusModulationValue ?? 500);
      let value = startValue + adjusted * increment;
      if (modMode === 'pixel-value' && modValue > 0) {
        value = value % modValue;
      } else if (modMode === 'shape-count' && modValue > 0) {
        const mi = adjusted % modValue;
        value = startValue + mi * increment;
      }
      return value;
    }
    case 'series': {
      const items      = isAngle ? (settings.polarAngleSeriesItems ?? []) : (settings.polarRadiusSeriesItems ?? []);
      const selection  = isAngle ? (settings.polarAngleSeriesSelection ?? 'sequential') : (settings.polarRadiusSeriesSelection ?? 'sequential');
      const exhaustion = isAngle ? (settings.polarAngleSeriesExhaustion ?? 'cycle') : (settings.polarRadiusSeriesExhaustion ?? 'cycle');
      const driver     = isAngle ? (settings.polarAngleSeriesDriver ?? 'shape-index') : (settings.polarRadiusSeriesDriver ?? 'shape-index');
      const fallback   = isAngle ? (settings.polarAngleValue ?? 0) : (settings.polarRadiusValue ?? 100);
      const val = resolveScalarSeries(items, selection, exhaustion, driver, shapeIndex, setRepIndex);
      return isNaN(val) ? fallback : val;
    }
    default:
      return 0;
  }
}

// ─── Combined Position XY (client-side, handles both coord systems + anchor) ─

export function calculatePositionXY(
  settings: BatchConfigSettings,
  shapeIndex: number,
  artboardWidth: number,
  artboardHeight: number,
  batchSize: number,
  lastIncrementalIndex: number = 0,
  setRepIndex: number = 0,
  artboardX: number = 0,
  artboardY: number = 0
): { x: number; y: number; anchorX: number; anchorY: number; angleDeg?: number } {
  if (!settings.propertiesEnabled || !settings.shapePropertiesEnabled || !settings.shapePropertiesPositionEnabled) {
    return { x: 0, y: 0, anchorX: 0, anchorY: 0 };
  }

  const anchor = resolveAnchorOffset(settings, artboardWidth, artboardHeight, artboardX, artboardY, shapeIndex);
  const coordSystem = settings.positionCoordSystem ?? 'cartesian';

  if (coordSystem === 'polar') {
    const angleDeg = calcPolarComponent(settings, 'angle', shapeIndex, lastIncrementalIndex, setRepIndex);
    const radius   = calcPolarComponent(settings, 'radius', shapeIndex, lastIncrementalIndex, setRepIndex);
    const rad = angleDeg * (Math.PI / 180);
    return {
      x: anchor.x + Math.cos(rad) * radius,
      y: anchor.y + Math.sin(rad) * radius,
      anchorX: anchor.x,
      anchorY: anchor.y,
      angleDeg
    };
  }

  // Cartesian: compute per-axis offsets from anchor
  const x = calculatePositionX(settings, shapeIndex, artboardWidth, artboardHeight, batchSize, lastIncrementalIndex, setRepIndex);
  const y = calculatePositionY(settings, shapeIndex, artboardWidth, artboardHeight, batchSize, lastIncrementalIndex, setRepIndex);
  return { x: anchor.x + x, y: anchor.y + y, anchorX: anchor.x, anchorY: anchor.y };
}

// ─── Position X ──────────────────────────────────────────────────────────────

export function calculatePositionX(
  settings: BatchConfigSettings,
  shapeIndex: number,
  artboardWidth: number,
  artboardHeight: number,
  batchSize: number,
  lastIncrementalIndex: number = 0,
  setRepIndex: number = 0
): number {
  if (!settings.propertiesEnabled || !settings.shapePropertiesEnabled || !settings.shapePropertiesPositionEnabled) {
    return 0;
  }
  switch (settings.xPositionMode) {
    case 'range': {
      const [minX, maxX] = settings.xPositionRange;
      return minX + Math.random() * (maxX - minX);
    }
    case 'value':
      return settings.xPositionValue;
    case 'incremental': {
      const driver = settings.positionIncrementalIndexDriver || 'shapeIndex';
      const driverIndex = driver === 'setRepIndex' ? setRepIndex : shapeIndex;
      const adjusted = settings.incrementalResetPerBatch ? driverIndex : (driverIndex + lastIncrementalIndex);
      let value = settings.xPositionStartValue + (adjusted * settings.xPositionIncrement);
      if (settings.xPositionModulationMode === 'pixel-value' && settings.xPositionModulationValue > 0) {
        value = value % settings.xPositionModulationValue;
      } else if (settings.xPositionModulationMode === 'shape-count' && settings.xPositionModulationValue > 0) {
        const mi = adjusted % settings.xPositionModulationValue;
        value = settings.xPositionStartValue + (mi * settings.xPositionIncrement);
      }
      return value;
    }
    case 'series': {
      const items = settings.xPositionSeriesItems ?? [];
      const resolved = resolveScalarSeries(
        items,
        settings.xPositionSeriesSelection ?? 'sequential',
        settings.xPositionSeriesExhaustion ?? 'cycle',
        settings.xPositionSeriesDriver ?? 'shape-index',
        shapeIndex,
        setRepIndex
      );
      return isNaN(resolved) ? 0 : resolved;
    }
    default:
      return 0;
  }
}

// ─── Position Y ──────────────────────────────────────────────────────────────

export function calculatePositionY(
  settings: BatchConfigSettings,
  shapeIndex: number,
  artboardWidth: number,
  artboardHeight: number,
  batchSize: number,
  lastIncrementalIndex: number = 0,
  setRepIndex: number = 0
): number {
  if (!settings.propertiesEnabled || !settings.shapePropertiesEnabled || !settings.shapePropertiesPositionEnabled) {
    return 0;
  }
  switch (settings.yPositionMode) {
    case 'range': {
      const [minY, maxY] = settings.yPositionRange;
      return minY + Math.random() * (maxY - minY);
    }
    case 'value':
      return settings.yPositionValue;
    case 'incremental': {
      const driver = settings.positionIncrementalIndexDriver || 'shapeIndex';
      const driverIndex = driver === 'setRepIndex' ? setRepIndex : shapeIndex;
      const adjusted = settings.incrementalResetPerBatch ? driverIndex : (driverIndex + lastIncrementalIndex);
      let value = settings.yPositionStartValue + (adjusted * settings.yPositionIncrement);
      if (settings.yPositionModulationMode === 'pixel-value' && settings.yPositionModulationValue > 0) {
        value = value % settings.yPositionModulationValue;
      } else if (settings.yPositionModulationMode === 'shape-count' && settings.yPositionModulationValue > 0) {
        const mi = adjusted % settings.yPositionModulationValue;
        value = settings.yPositionStartValue + (mi * settings.yPositionIncrement);
      }
      return value;
    }
    case 'series': {
      const items = settings.yPositionSeriesItems ?? [];
      const resolved = resolveScalarSeries(
        items,
        settings.yPositionSeriesSelection ?? 'sequential',
        settings.yPositionSeriesExhaustion ?? 'cycle',
        settings.yPositionSeriesDriver ?? 'shape-index',
        shapeIndex,
        setRepIndex
      );
      return isNaN(resolved) ? 0 : resolved;
    }
    default:
      return 0;
  }
}

// ─── Drop Shadow ─────────────────────────────────────────────────────────────

export type DropShadowResult = {
  enabled: true;
  offsetX: number; offsetY: number;
  blur: number; spread: number;
  color: string; opacity: number;
  blendMode: 'multiply' | 'darken' | 'overlay';
};

export function calculateDropShadow(
  settings: BatchConfigSettings,
  shapeIndex: number,
  setRepIndex: number,
  fillColor: string
): DropShadowResult | undefined {
  if (!settings.dropShadowEnabled) return undefined;
  if (Math.random() * 100 > settings.dropShadowProbability) return undefined;

  const driver = settings.dropShadowIncrementalIndexDriver || 'shapeIndex';
  const idx = driver === 'setRepIndex' ? setRepIndex : shapeIndex;

  let offsetX = 0;
  switch (settings.dropShadowOffsetXMode) {
    case 'range': { const [a,b] = settings.dropShadowOffsetXRange; offsetX = a + Math.random()*(b-a); break; }
    case 'define': offsetX = settings.dropShadowOffsetX; break;
    case 'incremental': offsetX = settings.dropShadowOffsetXStartValue + idx * settings.dropShadowOffsetXIncrement; break;
    case 'series': { const v = resolveScalarSeries(settings.dropShadowOffsetXSeriesItems||[], settings.dropShadowOffsetXSeriesSelection||'sequential', settings.dropShadowOffsetXSeriesExhaustion||'cycle', settings.dropShadowOffsetXSeriesDriver||'shape-index', shapeIndex, setRepIndex); offsetX = isNaN(v) ? settings.dropShadowOffsetX : v; break; }
  }

  let offsetY = 0;
  switch (settings.dropShadowOffsetYMode) {
    case 'range': { const [a,b] = settings.dropShadowOffsetYRange; offsetY = a + Math.random()*(b-a); break; }
    case 'define': offsetY = settings.dropShadowOffsetY; break;
    case 'incremental': offsetY = settings.dropShadowOffsetYStartValue + idx * settings.dropShadowOffsetYIncrement; break;
    case 'series': { const v = resolveScalarSeries(settings.dropShadowOffsetYSeriesItems||[], settings.dropShadowOffsetYSeriesSelection||'sequential', settings.dropShadowOffsetYSeriesExhaustion||'cycle', settings.dropShadowOffsetYSeriesDriver||'shape-index', shapeIndex, setRepIndex); offsetY = isNaN(v) ? settings.dropShadowOffsetY : v; break; }
  }

  let blur = 0;
  switch (settings.dropShadowBlurMode) {
    case 'range': { const [a,b] = settings.dropShadowBlurRange; blur = a + Math.random()*(b-a); break; }
    case 'define': blur = settings.dropShadowBlur; break;
    case 'incremental': blur = settings.dropShadowBlurStartValue + idx * settings.dropShadowBlurIncrement; break;
    case 'series': { const v = resolveScalarSeries(settings.dropShadowBlurSeriesItems||[], settings.dropShadowBlurSeriesSelection||'sequential', settings.dropShadowBlurSeriesExhaustion||'cycle', settings.dropShadowBlurSeriesDriver||'shape-index', shapeIndex, setRepIndex); blur = isNaN(v) ? settings.dropShadowBlur : v; break; }
  }

  let spread = 0;
  switch (settings.dropShadowSpreadMode) {
    case 'range': { const [a,b] = settings.dropShadowSpreadRange; spread = a + Math.random()*(b-a); break; }
    case 'define': spread = settings.dropShadowSpread; break;
    case 'incremental': spread = settings.dropShadowSpreadStartValue + idx * settings.dropShadowSpreadIncrement; break;
    case 'series': { const v = resolveScalarSeries(settings.dropShadowSpreadSeriesItems||[], settings.dropShadowSpreadSeriesSelection||'sequential', settings.dropShadowSpreadSeriesExhaustion||'cycle', settings.dropShadowSpreadSeriesDriver||'shape-index', shapeIndex, setRepIndex); spread = isNaN(v) ? settings.dropShadowSpread : v; break; }
  }

  let color = settings.dropShadowCustomColor;
  if (settings.dropShadowColorMode === 'auto' && fillColor && fillColor !== 'none')
    color = deriveEffectColor(fillColor, 'darken', settings.dropShadowColorDarken);

  return { enabled: true, offsetX, offsetY, blur, spread, color, opacity: settings.dropShadowOpacity, blendMode: settings.dropShadowBlendMode };
}

// ─── Outer Glow ──────────────────────────────────────────────────────────────

export type OuterGlowResult = {
  enabled: true;
  blur: number; spread: number;
  color: string; opacity: number;
  blendMode: 'screen' | 'add' | 'soft-light' | 'color-dodge' | 'lighter';
};

export function calculateOuterGlow(
  settings: BatchConfigSettings,
  shapeIndex: number,
  setRepIndex: number,
  fillColor: string
): OuterGlowResult | undefined {
  if (!settings.outerGlowEnabled) return undefined;
  if (Math.random() * 100 > settings.outerGlowProbability) return undefined;

  const driver = settings.outerGlowIncrementalIndexDriver || 'shapeIndex';
  const idx = driver === 'setRepIndex' ? setRepIndex : shapeIndex;

  let blur = 0;
  switch (settings.outerGlowBlurMode) {
    case 'range': { const [a,b] = settings.outerGlowBlurRange; blur = a + Math.random()*(b-a); break; }
    case 'define': blur = settings.outerGlowBlur; break;
    case 'incremental': blur = settings.outerGlowBlurStartValue + idx * settings.outerGlowBlurIncrement; break;
    case 'series': { const v = resolveScalarSeries(settings.outerGlowBlurSeriesItems||[], settings.outerGlowBlurSeriesSelection||'sequential', settings.outerGlowBlurSeriesExhaustion||'cycle', settings.outerGlowBlurSeriesDriver||'shape-index', shapeIndex, setRepIndex); blur = isNaN(v) ? settings.outerGlowBlur : v; break; }
  }

  let spread = 0;
  switch (settings.outerGlowSpreadMode) {
    case 'range': { const [a,b] = settings.outerGlowSpreadRange; spread = a + Math.random()*(b-a); break; }
    case 'define': spread = settings.outerGlowSpread; break;
    case 'incremental': spread = settings.outerGlowSpreadStartValue + idx * settings.outerGlowSpreadIncrement; break;
    case 'series': { const v = resolveScalarSeries(settings.outerGlowSpreadSeriesItems||[], settings.outerGlowSpreadSeriesSelection||'sequential', settings.outerGlowSpreadSeriesExhaustion||'cycle', settings.outerGlowSpreadSeriesDriver||'shape-index', shapeIndex, setRepIndex); spread = isNaN(v) ? settings.outerGlowSpread : v; break; }
  }

  let color = settings.outerGlowCustomColor;
  if (settings.outerGlowColorMode === 'auto' && fillColor && fillColor !== 'none')
    color = deriveEffectColor(fillColor, 'lighten', settings.outerGlowColorSaturate);

  return { enabled: true, blur, spread, color, opacity: settings.outerGlowOpacity, blendMode: settings.outerGlowBlendMode };
}

// ─── Inner Shadow ────────────────────────────────────────────────────────────

export type InnerShadowResult = {
  enabled: true;
  offsetX: number; offsetY: number;
  blur: number;
  color: string; opacity: number;
  blendMode: 'multiply' | 'darken' | 'overlay';
};

export function calculateInnerShadow(
  settings: BatchConfigSettings,
  shapeIndex: number,
  setRepIndex: number,
  fillColor: string
): InnerShadowResult | undefined {
  if (!settings.innerShadowEnabled) return undefined;
  if (Math.random() * 100 > settings.innerShadowProbability) return undefined;

  const driver = settings.innerShadowIncrementalIndexDriver || 'shapeIndex';
  const idx = driver === 'setRepIndex' ? setRepIndex : shapeIndex;

  let offsetX = 0;
  switch (settings.innerShadowOffsetXMode) {
    case 'range': { const [a,b] = settings.innerShadowOffsetXRange; offsetX = a + Math.random()*(b-a); break; }
    case 'define': offsetX = settings.innerShadowOffsetX; break;
    case 'incremental': offsetX = settings.innerShadowOffsetXStartValue + idx * settings.innerShadowOffsetXIncrement; break;
    case 'series': { const v = resolveScalarSeries(settings.innerShadowOffsetXSeriesItems||[], settings.innerShadowOffsetXSeriesSelection||'sequential', settings.innerShadowOffsetXSeriesExhaustion||'cycle', settings.innerShadowOffsetXSeriesDriver||'shape-index', shapeIndex, setRepIndex); offsetX = isNaN(v) ? settings.innerShadowOffsetX : v; break; }
  }

  let offsetY = 0;
  switch (settings.innerShadowOffsetYMode) {
    case 'range': { const [a,b] = settings.innerShadowOffsetYRange; offsetY = a + Math.random()*(b-a); break; }
    case 'define': offsetY = settings.innerShadowOffsetY; break;
    case 'incremental': offsetY = settings.innerShadowOffsetYStartValue + idx * settings.innerShadowOffsetYIncrement; break;
    case 'series': { const v = resolveScalarSeries(settings.innerShadowOffsetYSeriesItems||[], settings.innerShadowOffsetYSeriesSelection||'sequential', settings.innerShadowOffsetYSeriesExhaustion||'cycle', settings.innerShadowOffsetYSeriesDriver||'shape-index', shapeIndex, setRepIndex); offsetY = isNaN(v) ? settings.innerShadowOffsetY : v; break; }
  }

  let blur = 0;
  switch (settings.innerShadowBlurMode) {
    case 'range': { const [a,b] = settings.innerShadowBlurRange; blur = a + Math.random()*(b-a); break; }
    case 'define': blur = settings.innerShadowBlur; break;
    case 'incremental': blur = settings.innerShadowBlurStartValue + idx * settings.innerShadowBlurIncrement; break;
    case 'series': { const v = resolveScalarSeries(settings.innerShadowBlurSeriesItems||[], settings.innerShadowBlurSeriesSelection||'sequential', settings.innerShadowBlurSeriesExhaustion||'cycle', settings.innerShadowBlurSeriesDriver||'shape-index', shapeIndex, setRepIndex); blur = isNaN(v) ? settings.innerShadowBlur : v; break; }
  }

  let color = settings.innerShadowCustomColor;
  if (settings.innerShadowColorMode === 'auto' && fillColor && fillColor !== 'none')
    color = deriveEffectColor(fillColor, 'darken', settings.innerShadowColorDarken);

  return { enabled: true, offsetX, offsetY, blur, color, opacity: settings.innerShadowOpacity, blendMode: settings.innerShadowBlendMode };
}

// ─── Inner Glow ──────────────────────────────────────────────────────────────

export type InnerGlowResult = {
  enabled: true;
  blur: number; spread: number;
  color: string; opacity: number;
  blendMode: 'screen' | 'add' | 'soft-light' | 'color-dodge' | 'lighter';
};

export function calculateInnerGlow(
  settings: BatchConfigSettings,
  shapeIndex: number,
  setRepIndex: number,
  fillColor: string
): InnerGlowResult | undefined {
  if (!settings.innerGlowEnabled) return undefined;
  if (Math.random() * 100 > settings.innerGlowProbability) return undefined;

  const driver = settings.innerGlowIncrementalIndexDriver || 'shapeIndex';
  const idx = driver === 'setRepIndex' ? setRepIndex : shapeIndex;

  let blur = 0;
  switch (settings.innerGlowBlurMode) {
    case 'range': { const [a,b] = settings.innerGlowBlurRange; blur = a + Math.random()*(b-a); break; }
    case 'define': blur = settings.innerGlowBlur; break;
    case 'incremental': blur = settings.innerGlowBlurStartValue + idx * settings.innerGlowBlurIncrement; break;
    case 'series': { const v = resolveScalarSeries(settings.innerGlowBlurSeriesItems||[], settings.innerGlowBlurSeriesSelection||'sequential', settings.innerGlowBlurSeriesExhaustion||'cycle', settings.innerGlowBlurSeriesDriver||'shape-index', shapeIndex, setRepIndex); blur = isNaN(v) ? settings.innerGlowBlur : v; break; }
  }

  let spread = 0;
  switch (settings.innerGlowSpreadMode) {
    case 'range': { const [a,b] = settings.innerGlowSpreadRange; spread = a + Math.random()*(b-a); break; }
    case 'define': spread = settings.innerGlowSpread; break;
    case 'incremental': spread = settings.innerGlowSpreadStartValue + idx * settings.innerGlowSpreadIncrement; break;
    case 'series': { const v = resolveScalarSeries(settings.innerGlowSpreadSeriesItems||[], settings.innerGlowSpreadSeriesSelection||'sequential', settings.innerGlowSpreadSeriesExhaustion||'cycle', settings.innerGlowSpreadSeriesDriver||'shape-index', shapeIndex, setRepIndex); spread = isNaN(v) ? settings.innerGlowSpread : v; break; }
  }

  let color = settings.innerGlowCustomColor;
  if (settings.innerGlowColorMode === 'auto' && fillColor && fillColor !== 'none')
    color = deriveEffectColor(fillColor, 'lighten', settings.innerGlowColorSaturate);

  return { enabled: true, blur, spread, color, opacity: settings.innerGlowOpacity, blendMode: settings.innerGlowBlendMode };
}

// ─── Squiggle Stroke Parameters ──────────────────────────────────────────────

function _calcSquiggle(
  mode: 'range' | 'define' | 'incremental',
  range: [number, number],
  define: number,
  startValue: number,
  increment: number,
  modulationEnabled: boolean,
  modulationValue: number,
  driver: import('./schema').IncrementalIndexDriver,
  shapeIndex: number,
  setRepIndex: number,
  clampMin?: number,
  clampMax?: number,
  bounce?: boolean
): number {
  let result: number;
  switch (mode) {
    case 'range':
      result = range[0] + Math.random() * (range[1] - range[0]);
      break;
    case 'incremental': {
      const idx = driver === 'setRepIndex' ? setRepIndex : shapeIndex;
      if (modulationEnabled && modulationValue > 0 && increment !== 0) {
        if (bounce) {
          const absInc = Math.abs(increment);
          const period = 2 * modulationValue;
          const rawPos = (absInc * idx) % period;
          const trianglePos = rawPos <= modulationValue ? rawPos : period - rawPos;
          result = startValue + Math.sign(increment) * trianglePos;
        } else {
          result = startValue + ((increment * idx) % modulationValue);
        }
      } else {
        result = startValue + increment * idx;
      }
      break;
    }
    case 'define':
    default:
      result = define;
  }
  if (clampMin !== undefined && clampMax !== undefined)
    result = Math.max(clampMin, Math.min(clampMax, result));
  return result;
}

export function calculateSquiggleAmplitude(s: BatchConfigSettings, shapeIndex: number, setRepIndex = 0): number {
  const mode = s.strokeSquiggleAmplitudeMode;
  if (mode === 'series') {
    const val = resolveScalarSeries(s.strokeSquiggleAmplitudeSeriesItems ?? [], s.strokeSquiggleAmplitudeSeriesSelection ?? 'sequential', s.strokeSquiggleAmplitudeSeriesExhaustion ?? 'cycle', s.strokeSquiggleAmplitudeSeriesDriver ?? 'shape-index', shapeIndex, setRepIndex);
    const result = isNaN(val) ? (s.strokeSquiggleAmplitudeDefine ?? 4) : val;
    return Math.max(0, Math.min(100, result));
  }
  return _calcSquiggle(mode, s.strokeSquiggleAmplitudeRange ?? [2,10], s.strokeSquiggleAmplitudeDefine ?? 4, s.strokeSquiggleAmplitudeStartValue ?? 2, s.strokeSquiggleAmplitudeIncrement ?? 1, s.strokeSquiggleAmplitudeModulationEnabled ?? false, s.strokeSquiggleAmplitudeModulationValue ?? 10, s.strokeSquiggleIncrementalIndexDriver ?? 'shapeIndex', shapeIndex, setRepIndex, 0, 100, s.strokeSquiggleBounce ?? false);
}

export function calculateSquiggleFrequency(s: BatchConfigSettings, shapeIndex: number, setRepIndex = 0): number {
  const mode = s.strokeSquiggleFrequencyMode;
  if (mode === 'series') {
    const val = resolveScalarSeries(s.strokeSquiggleFrequencySeriesItems ?? [], s.strokeSquiggleFrequencySeriesSelection ?? 'sequential', s.strokeSquiggleFrequencySeriesExhaustion ?? 'cycle', s.strokeSquiggleFrequencySeriesDriver ?? 'shape-index', shapeIndex, setRepIndex);
    const result = isNaN(val) ? (s.strokeSquiggleFrequencyDefine ?? 1) : val;
    return Math.max(0.01, Math.min(100, result));
  }
  return _calcSquiggle(mode, s.strokeSquiggleFrequencyRange ?? [0.5,5], s.strokeSquiggleFrequencyDefine ?? 1, s.strokeSquiggleFrequencyStartValue ?? 1, s.strokeSquiggleFrequencyIncrement ?? 0.5, s.strokeSquiggleFrequencyModulationEnabled ?? false, s.strokeSquiggleFrequencyModulationValue ?? 10, s.strokeSquiggleIncrementalIndexDriver ?? 'shapeIndex', shapeIndex, setRepIndex, 0.01, 100, s.strokeSquiggleBounce ?? false);
}

export function calculateSquigglePhase(s: BatchConfigSettings, shapeIndex: number, setRepIndex = 0): number {
  const mode = s.strokeSquigglePhaseMode;
  if (mode === 'series') {
    const val = resolveScalarSeries(s.strokeSquigglePhaseSeriesItems ?? [], s.strokeSquigglePhaseSeriesSelection ?? 'sequential', s.strokeSquigglePhaseSeriesExhaustion ?? 'cycle', s.strokeSquigglePhaseSeriesDriver ?? 'shape-index', shapeIndex, setRepIndex);
    return isNaN(val) ? (s.strokeSquigglePhaseDefine ?? 0) : val;
  }
  return _calcSquiggle(mode, s.strokeSquigglePhaseRange ?? [0,3.14], s.strokeSquigglePhaseDefine ?? 0, s.strokeSquigglePhaseStartValue ?? 0, s.strokeSquigglePhaseIncrement ?? 0.5, s.strokeSquigglePhaseModulationEnabled ?? false, s.strokeSquigglePhaseModulationValue ?? 6.28, s.strokeSquiggleIncrementalIndexDriver ?? 'shapeIndex', shapeIndex, setRepIndex, undefined, undefined, s.strokeSquiggleBounce ?? false);
}

export function calculateSquiggleAlign(s: BatchConfigSettings, shapeIndex: number, setRepIndex = 0): number {
  const mode = s.strokeSquiggleAlignMode;
  if (mode === 'series') {
    const val = resolveScalarSeries(s.strokeSquiggleAlignSeriesItems ?? [], s.strokeSquiggleAlignSeriesSelection ?? 'sequential', s.strokeSquiggleAlignSeriesExhaustion ?? 'cycle', s.strokeSquiggleAlignSeriesDriver ?? 'shape-index', shapeIndex, setRepIndex);
    const result = isNaN(val) ? (s.strokeSquiggleAlignDefine ?? 100) : val;
    return Math.max(0, Math.min(100, result));
  }
  return _calcSquiggle(mode, s.strokeSquiggleAlignRange ?? [50,100], s.strokeSquiggleAlignDefine ?? 100, s.strokeSquiggleAlignStartValue ?? 100, s.strokeSquiggleAlignIncrement ?? -5, s.strokeSquiggleAlignModulationEnabled ?? false, s.strokeSquiggleAlignModulationValue ?? 100, s.strokeSquiggleIncrementalIndexDriver ?? 'shapeIndex', shapeIndex, setRepIndex, 0, 100, s.strokeSquiggleBounce ?? false);
}

export function calculateSquiggleJitter(s: BatchConfigSettings, shapeIndex: number, setRepIndex = 0): number {
  const mode = s.strokeSquiggleJitterMode;
  if (mode === 'series') {
    const val = resolveScalarSeries(s.strokeSquiggleJitterSeriesItems ?? [], s.strokeSquiggleJitterSeriesSelection ?? 'sequential', s.strokeSquiggleJitterSeriesExhaustion ?? 'cycle', s.strokeSquiggleJitterSeriesDriver ?? 'shape-index', shapeIndex, setRepIndex);
    const result = isNaN(val) ? (s.strokeSquiggleJitterDefine ?? 0) : val;
    return Math.max(0, Math.min(100, result));
  }
  return _calcSquiggle(mode, s.strokeSquiggleJitterRange ?? [0,5], s.strokeSquiggleJitterDefine ?? 0, s.strokeSquiggleJitterStartValue ?? 0, s.strokeSquiggleJitterIncrement ?? 1, s.strokeSquiggleJitterModulationEnabled ?? false, s.strokeSquiggleJitterModulationValue ?? 20, s.strokeSquiggleIncrementalIndexDriver ?? 'shapeIndex', shapeIndex, setRepIndex, 0, 100, s.strokeSquiggleBounce ?? false);
}

export function calculateSquiggleJitterSeed(s: BatchConfigSettings, shapeIndex: number, setRepIndex = 0): number {
  const mode = s.strokeSquiggleJitterSeedMode;
  if (mode === 'series') {
    const val = resolveScalarSeries(s.strokeSquiggleJitterSeedSeriesItems ?? [], s.strokeSquiggleJitterSeedSeriesSelection ?? 'sequential', s.strokeSquiggleJitterSeedSeriesExhaustion ?? 'cycle', s.strokeSquiggleJitterSeedSeriesDriver ?? 'shape-index', shapeIndex, setRepIndex);
    const result = isNaN(val) ? (s.strokeSquiggleJitterSeedDefine ?? 0) : val;
    return Math.round(Math.max(0, Math.min(99999, result)));
  }
  return Math.round(_calcSquiggle(mode, s.strokeSquiggleJitterSeedRange ?? [0,100], s.strokeSquiggleJitterSeedDefine ?? 0, s.strokeSquiggleJitterSeedStartValue ?? 0, s.strokeSquiggleJitterSeedIncrement ?? 1, s.strokeSquiggleJitterSeedModulationEnabled ?? false, s.strokeSquiggleJitterSeedModulationValue ?? 9999, s.strokeSquiggleIncrementalIndexDriver ?? 'shapeIndex', shapeIndex, setRepIndex, 0, 99999, s.strokeSquiggleBounce ?? false));
}

export function calculateSquiggleNoise(s: BatchConfigSettings, shapeIndex: number, setRepIndex = 0): number {
  const mode = s.strokeSquiggleNoiseMode;
  if (mode === 'series') {
    const val = resolveScalarSeries(s.strokeSquiggleNoiseSeriesItems ?? [], s.strokeSquiggleNoiseSeriesSelection ?? 'sequential', s.strokeSquiggleNoiseSeriesExhaustion ?? 'cycle', s.strokeSquiggleNoiseSeriesDriver ?? 'shape-index', shapeIndex, setRepIndex);
    const result = isNaN(val) ? (s.strokeSquiggleNoiseDefine ?? 0) : val;
    return Math.max(0, Math.min(100, result));
  }
  return _calcSquiggle(mode, s.strokeSquiggleNoiseRange ?? [0,5], s.strokeSquiggleNoiseDefine ?? 0, s.strokeSquiggleNoiseStartValue ?? 0, s.strokeSquiggleNoiseIncrement ?? 1, s.strokeSquiggleNoiseModulationEnabled ?? false, s.strokeSquiggleNoiseModulationValue ?? 20, s.strokeSquiggleIncrementalIndexDriver ?? 'shapeIndex', shapeIndex, setRepIndex, 0, 100, s.strokeSquiggleBounce ?? false);
}

export function calculateSquiggleNoiseFreq(s: BatchConfigSettings, shapeIndex: number, setRepIndex = 0): number {
  const mode = s.strokeSquiggleNoiseFreqMode;
  if (mode === 'series') {
    const val = resolveScalarSeries(s.strokeSquiggleNoiseFreqSeriesItems ?? [], s.strokeSquiggleNoiseFreqSeriesSelection ?? 'sequential', s.strokeSquiggleNoiseFreqSeriesExhaustion ?? 'cycle', s.strokeSquiggleNoiseFreqSeriesDriver ?? 'shape-index', shapeIndex, setRepIndex);
    const result = isNaN(val) ? (s.strokeSquiggleNoiseFreqDefine ?? 1) : val;
    return Math.max(0.01, Math.min(100, result));
  }
  return _calcSquiggle(mode, s.strokeSquiggleNoiseFreqRange ?? [0.5,5], s.strokeSquiggleNoiseFreqDefine ?? 1, s.strokeSquiggleNoiseFreqStartValue ?? 1, s.strokeSquiggleNoiseFreqIncrement ?? 0.5, s.strokeSquiggleNoiseFreqModulationEnabled ?? false, s.strokeSquiggleNoiseFreqModulationValue ?? 10, s.strokeSquiggleIncrementalIndexDriver ?? 'shapeIndex', shapeIndex, setRepIndex, 0.01, 100, s.strokeSquiggleBounce ?? false);
}

// Returns undefined when mode is 'auto' (renderer calculates from shape perimeter).
// Returns a resolved integer when mode is 'define' or 'range'.
export function calculateSquiggleSampleCount(s: BatchConfigSettings): number | undefined {
  const mode = s.strokeSquiggleSampleMode ?? 'auto';
  if (mode === 'auto') return undefined;
  if (mode === 'define') return Math.round(Math.max(32, Math.min(4096, s.strokeSquiggleSampleDefine ?? 256)));
  const [lo, hi] = s.strokeSquiggleSampleRange ?? [128, 512];
  return Math.round(Math.max(32, Math.min(4096, lo + Math.random() * (hi - lo))));
}
