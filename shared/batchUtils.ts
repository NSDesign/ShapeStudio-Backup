import type { BatchConfigSettings, ScalarSeriesItem, ScalarSeriesSelection, ScalarSeriesExhaustion, ScalarSeriesDriver } from './schema';

export type LinearGradientPredefined = 'horizontal' | 'vertical' | 'diagonal-down' | 'diagonal-up';

function predefinedToAngle(predefined: string): number {
  switch (predefined as LinearGradientPredefined) {
    case 'horizontal': return 0;
    case 'vertical': return 90;
    case 'diagonal-down': return 135;
    case 'diagonal-up': return 45;
    default: return 0;
  }
}

function resolveSeriesItem(
  settings: BatchConfigSettings,
  driverIndex: number
): { direction: 'fixed' | 'range' | 'predefined'; angle?: number; angleRange?: [number, number]; predefined?: string } | null {
  const items = settings.fillGradientLinearSeriesItems;
  if (!items || items.length === 0) return null;

  const selection = settings.fillGradientLinearSeriesSelection || 'sequential';
  const exhaustion = settings.fillGradientLinearSeriesExhaustion || 'cycle';

  if (selection === 'random') {
    return items[Math.floor(Math.random() * items.length)];
  }

  // Sequential
  const len = items.length;
  let idx: number;
  if (exhaustion === 'bounce' && len > 1) {
    const period = (len - 1) * 2;
    const pos = ((driverIndex % period) + period) % period;
    idx = pos < len ? pos : period - pos;
  } else {
    idx = ((driverIndex % len) + len) % len;
  }
  return items[idx];
}

export function calculateLinearAngle(settings: BatchConfigSettings, shapeIndex: number, setRepIndex: number = 0): number {
  let angleDegrees: number;
  
  if (!settings.fillGradientTypeDirectionEnabled) {
    return 45;
  }
  
  switch (settings.fillGradientLinearDirection) {
    case 'fixed':
      angleDegrees = settings.fillGradientLinearAngle ?? 45;
      break;
    
    case 'predefined':
      angleDegrees = predefinedToAngle(settings.fillGradientLinearPredefined ?? 'diagonal-down');
      break;
    
    case 'series': {
      const driver = settings.fillGradientLinearSeriesDriver || 'shape-index';
      const driverIndex = driver === 'set-rep-index' ? setRepIndex : shapeIndex;
      const item = resolveSeriesItem(settings, driverIndex);
      if (!item) {
        angleDegrees = 45;
        break;
      }
      switch (item.direction) {
        case 'fixed':
          angleDegrees = item.angle ?? 45;
          break;
        case 'predefined':
          angleDegrees = predefinedToAngle(item.predefined ?? 'horizontal');
          break;
        case 'range':
        default: {
          const [minA, maxA] = item.angleRange || [0, 360];
          angleDegrees = minA + Math.random() * (maxA - minA);
          break;
        }
      }
      break;
    }
    
    case 'range':
    default: {
      const [minAngle, maxAngle] = settings.fillGradientLinearAngleRange || [0, 360];
      angleDegrees = minAngle + Math.random() * (maxAngle - minAngle);
      break;
    }
  }
  
  angleDegrees = ((angleDegrees % 360) + 360) % 360;
  
  return angleDegrees;
}

type GradientPositionSettings = BatchConfigSettings & Record<string, any>;

function calculateGradientCenterAxis(
  settings: GradientPositionSettings,
  prefix: 'Linear' | 'Radial' | 'Diamond',
  axis: 'X' | 'Y',
  shapeIndex: number,
  setRepIndex: number
): number {
  const s = settings as any;
  const mode = s[`fillGradient${prefix}Center${axis}Mode`];
  const driver = s.gradientCenterIncrementalIndexDriver || 'shapeIndex';
  const effectiveIndex = driver === 'setRepIndex' ? setRepIndex : shapeIndex;
  let result = s[`fillGradient${prefix}Center${axis}`] ?? 50;
  if (mode === 'range') {
    const [lo, hi] = s[`fillGradient${prefix}Center${axis}Range`] || [25, 75];
    result = lo + Math.random() * (hi - lo);
  } else if (mode === 'incremental') {
    result = (s[`fillGradient${prefix}Center${axis}StartValue`] ?? 50) +
      (s[`fillGradient${prefix}Center${axis}Increment`] || 0) * effectiveIndex;
    if (s[`fillGradient${prefix}Center${axis}ModulationEnabled`] &&
        (s[`fillGradient${prefix}Center${axis}ModulationValue`] || 0) > 0) {
      const modulation = s[`fillGradient${prefix}Center${axis}ModulationValue`];
      result = ((result % modulation) + modulation) % modulation;
    }
  } else if (mode === 'series') {
    const value = resolveScalarSeries(
      s[`fillGradient${prefix}Center${axis}SeriesItems`] || [],
      s[`fillGradient${prefix}Center${axis}SeriesSelection`] || 'sequential',
      s[`fillGradient${prefix}Center${axis}SeriesExhaustion`] || 'cycle',
      s[`fillGradient${prefix}Center${axis}SeriesDriver`] || 'shape-index',
      shapeIndex,
      setRepIndex
    );
    if (!isNaN(value)) result = value;
  }
  return Math.max(0, Math.min(100, result));
}

export function calculateLinearCenterX(settings: BatchConfigSettings, shapeIndex: number, setRepIndex = 0): number {
  return calculateGradientCenterAxis(settings as GradientPositionSettings, 'Linear', 'X', shapeIndex, setRepIndex);
}

export function calculateLinearCenterY(settings: BatchConfigSettings, shapeIndex: number, setRepIndex = 0): number {
  return calculateGradientCenterAxis(settings as GradientPositionSettings, 'Linear', 'Y', shapeIndex, setRepIndex);
}

/** Resolve a positive gradient scale in percent. Defaults to 100 so old configs render identically. */
export function calculateGradientScale(
  settings: BatchConfigSettings,
  type: 'Linear' | 'Radial' | 'Diamond',
  shapeIndex: number,
  setRepIndex = 0
): number {
  const s = settings as any;
  const mode = s[`fillGradient${type}ScaleMode`] || 'fixed';
  const clamp = (value: number) => Math.max(1, Math.min(1000, Number.isFinite(value) ? value : 100));
  let result = s[`fillGradient${type}Scale`] ?? 100;
  if (mode === 'range') {
    const range = s[`fillGradient${type}ScaleRange`] ?? [50, 150];
    // Treat the endpoints as an unordered bounded range. This keeps malformed
    // imported configs from producing an inverted or negative scale.
    const lo = Math.min(range[0], range[1]);
    const hi = Math.max(range[0], range[1]);
    result = lo + Math.random() * (hi - lo);
  } else if (mode === 'incremental') {
    const driver = s.gradientScaleIncrementalIndexDriver || s.gradientCenterIncrementalIndexDriver || 'shapeIndex';
    const index = driver === 'setRepIndex' ? setRepIndex : shapeIndex;
    result = (s[`fillGradient${type}ScaleStartValue`] ?? 100) +
      (s[`fillGradient${type}ScaleIncrement`] ?? 10) * index;
  } else if (mode === 'series') {
    const value = resolveScalarSeries(
      s[`fillGradient${type}ScaleSeriesItems`] || [],
      s[`fillGradient${type}ScaleSeriesSelection`] || 'sequential',
      s[`fillGradient${type}ScaleSeriesExhaustion`] || 'cycle',
      s[`fillGradient${type}ScaleSeriesDriver`] || 'shape-index',
      shapeIndex,
      setRepIndex
    );
    if (!isNaN(value)) result = value;
  }
  return clamp(result);
}

export function calculateConicCenterX(settings: BatchConfigSettings, shapeIndex: number, setRepIndex: number = 0): number {
  let result: number;
  
  // Get the effective index based on Index Driver setting
  const driver = settings.gradientCenterIncrementalIndexDriver || 'shapeIndex';
  const effectiveIndex = driver === 'setRepIndex' ? setRepIndex : shapeIndex;
  
  switch (settings.fillGradientConicCenterXMode) {
    case 'range':
      const [minX, maxX] = settings.fillGradientConicCenterXRange || [25, 75];
      result = minX + Math.random() * (maxX - minX);
      break;
    
    case 'incremental':
      const startX = settings.fillGradientConicCenterXStartValue ?? 50;
      const incrementX = (settings.fillGradientConicCenterXIncrement || 0) * effectiveIndex;
      result = startX + incrementX;
      
      if (settings.fillGradientConicCenterXModulationEnabled && settings.fillGradientConicCenterXModulationValue > 0) {
        const m = settings.fillGradientConicCenterXModulationValue;
        result = ((result % m) + m) % m;
      }
      break;

    case 'series': {
      const val = resolveScalarSeries(
        settings.fillGradientConicCenterXSeriesItems || [],
        settings.fillGradientConicCenterXSeriesSelection || 'sequential',
        settings.fillGradientConicCenterXSeriesExhaustion || 'cycle',
        settings.fillGradientConicCenterXSeriesDriver || 'shape-index',
        shapeIndex,
        setRepIndex
      );
      result = isNaN(val) ? (settings.fillGradientConicCenterX ?? 50) : val;
      break;
    }
    
    case 'fixed':
    default:
      result = settings.fillGradientConicCenterX ?? 50;
      break;
  }
  
  return Math.max(0, Math.min(100, result));
}

export function calculateConicCenterY(settings: BatchConfigSettings, shapeIndex: number, setRepIndex: number = 0): number {
  let result: number;
  
  // Get the effective index based on Index Driver setting
  const driver = settings.gradientCenterIncrementalIndexDriver || 'shapeIndex';
  const effectiveIndex = driver === 'setRepIndex' ? setRepIndex : shapeIndex;
  
  switch (settings.fillGradientConicCenterYMode) {
    case 'range':
      const [minY, maxY] = settings.fillGradientConicCenterYRange || [25, 75];
      result = minY + Math.random() * (maxY - minY);
      break;
    
    case 'incremental':
      const startY = settings.fillGradientConicCenterYStartValue ?? 50;
      const incrementY = (settings.fillGradientConicCenterYIncrement || 0) * effectiveIndex;
      result = startY + incrementY;
      
      if (settings.fillGradientConicCenterYModulationEnabled && settings.fillGradientConicCenterYModulationValue > 0) {
        const m = settings.fillGradientConicCenterYModulationValue;
        result = ((result % m) + m) % m;
      }
      break;

    case 'series': {
      const val = resolveScalarSeries(
        settings.fillGradientConicCenterYSeriesItems || [],
        settings.fillGradientConicCenterYSeriesSelection || 'sequential',
        settings.fillGradientConicCenterYSeriesExhaustion || 'cycle',
        settings.fillGradientConicCenterYSeriesDriver || 'shape-index',
        shapeIndex,
        setRepIndex
      );
      result = isNaN(val) ? (settings.fillGradientConicCenterY ?? 50) : val;
      break;
    }
    
    case 'fixed':
    default:
      result = settings.fillGradientConicCenterY ?? 50;
      break;
  }
  
  return Math.max(0, Math.min(100, result));
}

export function calculateRadialCenterX(settings: BatchConfigSettings, shapeIndex: number, setRepIndex: number = 0): number {
  let result: number;
  
  // Get the effective index based on Index Driver setting
  const driver = settings.gradientCenterIncrementalIndexDriver || 'shapeIndex';
  const effectiveIndex = driver === 'setRepIndex' ? setRepIndex : shapeIndex;
  
  switch (settings.fillGradientRadialCenterXMode) {
    case 'range':
      const [minX, maxX] = settings.fillGradientRadialCenterXRange || [25, 75];
      result = minX + Math.random() * (maxX - minX);
      break;
    
    case 'incremental':
      const startX = settings.fillGradientRadialCenterXStartValue ?? 50;
      const incrementX = (settings.fillGradientRadialCenterXIncrement || 0) * effectiveIndex;
      result = startX + incrementX;
      
      if (settings.fillGradientRadialCenterXModulationEnabled && settings.fillGradientRadialCenterXModulationValue > 0) {
        const m = settings.fillGradientRadialCenterXModulationValue;
        result = ((result % m) + m) % m;
      }
      break;

    case 'series': {
      const val = resolveScalarSeries(
        settings.fillGradientRadialCenterXSeriesItems || [],
        settings.fillGradientRadialCenterXSeriesSelection || 'sequential',
        settings.fillGradientRadialCenterXSeriesExhaustion || 'cycle',
        settings.fillGradientRadialCenterXSeriesDriver || 'shape-index',
        shapeIndex,
        setRepIndex
      );
      result = isNaN(val) ? (settings.fillGradientRadialCenterX ?? 50) : val;
      break;
    }
    
    case 'fixed':
    default:
      result = settings.fillGradientRadialCenterX ?? 50;
      break;
  }
  
  return Math.max(0, Math.min(100, result));
}

export function calculateRadialCenterY(settings: BatchConfigSettings, shapeIndex: number, setRepIndex: number = 0): number {
  let result: number;
  
  // Get the effective index based on Index Driver setting
  const driver = settings.gradientCenterIncrementalIndexDriver || 'shapeIndex';
  const effectiveIndex = driver === 'setRepIndex' ? setRepIndex : shapeIndex;
  
  switch (settings.fillGradientRadialCenterYMode) {
    case 'range':
      const [minY, maxY] = settings.fillGradientRadialCenterYRange || [25, 75];
      result = minY + Math.random() * (maxY - minY);
      break;
    
    case 'incremental':
      const startY = settings.fillGradientRadialCenterYStartValue ?? 50;
      const incrementY = (settings.fillGradientRadialCenterYIncrement || 0) * effectiveIndex;
      result = startY + incrementY;
      
      if (settings.fillGradientRadialCenterYModulationEnabled && settings.fillGradientRadialCenterYModulationValue > 0) {
        const m = settings.fillGradientRadialCenterYModulationValue;
        result = ((result % m) + m) % m;
      }
      break;

    case 'series': {
      const val = resolveScalarSeries(
        settings.fillGradientRadialCenterYSeriesItems || [],
        settings.fillGradientRadialCenterYSeriesSelection || 'sequential',
        settings.fillGradientRadialCenterYSeriesExhaustion || 'cycle',
        settings.fillGradientRadialCenterYSeriesDriver || 'shape-index',
        shapeIndex,
        setRepIndex
      );
      result = isNaN(val) ? (settings.fillGradientRadialCenterY ?? 50) : val;
      break;
    }
    
    case 'fixed':
    default:
      result = settings.fillGradientRadialCenterY ?? 50;
      break;
  }
  
  return Math.max(0, Math.min(100, result));
}

export function calculateDiamondCenterX(settings: BatchConfigSettings, shapeIndex: number, setRepIndex: number = 0): number {
  let result: number;

  const driver = settings.gradientCenterIncrementalIndexDriver || 'shapeIndex';
  const effectiveIndex = driver === 'setRepIndex' ? setRepIndex : shapeIndex;

  switch (settings.fillGradientDiamondCenterXMode) {
    case 'range': {
      const [minX, maxX] = settings.fillGradientDiamondCenterXRange || [25, 75];
      result = minX + Math.random() * (maxX - minX);
      break;
    }
    case 'incremental': {
      const startX = settings.fillGradientDiamondCenterXStartValue ?? 50;
      const incrementX = (settings.fillGradientDiamondCenterXIncrement || 0) * effectiveIndex;
      result = startX + incrementX;
      if (settings.fillGradientDiamondCenterXModulationEnabled && settings.fillGradientDiamondCenterXModulationValue > 0) {
        const m = settings.fillGradientDiamondCenterXModulationValue;
        result = ((result % m) + m) % m;
      }
      break;
    }
    case 'series': {
      const val = resolveScalarSeries(
        settings.fillGradientDiamondCenterXSeriesItems || [],
        settings.fillGradientDiamondCenterXSeriesSelection || 'sequential',
        settings.fillGradientDiamondCenterXSeriesExhaustion || 'cycle',
        settings.fillGradientDiamondCenterXSeriesDriver || 'shape-index',
        shapeIndex,
        setRepIndex
      );
      result = isNaN(val) ? (settings.fillGradientDiamondCenterX ?? 50) : val;
      break;
    }
    case 'fixed':
    default:
      result = settings.fillGradientDiamondCenterX ?? 50;
      break;
  }

  return Math.max(0, Math.min(100, result));
}

export function calculateDiamondCenterY(settings: BatchConfigSettings, shapeIndex: number, setRepIndex: number = 0): number {
  let result: number;

  const driver = settings.gradientCenterIncrementalIndexDriver || 'shapeIndex';
  const effectiveIndex = driver === 'setRepIndex' ? setRepIndex : shapeIndex;

  switch (settings.fillGradientDiamondCenterYMode) {
    case 'range': {
      const [minY, maxY] = settings.fillGradientDiamondCenterYRange || [25, 75];
      result = minY + Math.random() * (maxY - minY);
      break;
    }
    case 'incremental': {
      const startY = settings.fillGradientDiamondCenterYStartValue ?? 50;
      const incrementY = (settings.fillGradientDiamondCenterYIncrement || 0) * effectiveIndex;
      result = startY + incrementY;
      if (settings.fillGradientDiamondCenterYModulationEnabled && settings.fillGradientDiamondCenterYModulationValue > 0) {
        const m = settings.fillGradientDiamondCenterYModulationValue;
        result = ((result % m) + m) % m;
      }
      break;
    }
    case 'series': {
      const val = resolveScalarSeries(
        settings.fillGradientDiamondCenterYSeriesItems || [],
        settings.fillGradientDiamondCenterYSeriesSelection || 'sequential',
        settings.fillGradientDiamondCenterYSeriesExhaustion || 'cycle',
        settings.fillGradientDiamondCenterYSeriesDriver || 'shape-index',
        shapeIndex,
        setRepIndex
      );
      result = isNaN(val) ? (settings.fillGradientDiamondCenterY ?? 50) : val;
      break;
    }
    case 'fixed':
    default:
      result = settings.fillGradientDiamondCenterY ?? 50;
      break;
  }

  return Math.max(0, Math.min(100, result));
}

// ===== SCALAR SERIES RESOLVER =====
// Shared resolver used by every numeric property that supports series mode.
// Takes a list of ScalarSeriesItems and resolves one to a number based on the
// selection strategy, exhaustion strategy, and the appropriate index driver.

/**
 * Resolve a scalar series to a single number for the current shape.
 *
 * @param items       The series item list. Returns NaN if empty.
 * @param selection   'sequential' | 'random'
 * @param exhaustion  'cycle' | 'bounce' — only used when selection is 'sequential'
 * @param driver      'shape-index' | 'set-rep-index'
 * @param shapeIndex  0-based index of the shape within the current generation
 * @param setRepIndex 0-based repetition index of the set across batch generations
 * @returns           A resolved number, or NaN if items is empty
 */
export function resolveScalarSeries(
  items: ScalarSeriesItem[],
  selection: ScalarSeriesSelection,
  exhaustion: ScalarSeriesExhaustion,
  driver: ScalarSeriesDriver,
  shapeIndex: number,
  setRepIndex: number
): number {
  if (!items || items.length === 0) return NaN;

  let item: ScalarSeriesItem;

  if (selection === 'random') {
    item = items[Math.floor(Math.random() * items.length)];
  } else {
    // Sequential
    const len = items.length;
    const driverIndex = driver === 'set-rep-index' ? setRepIndex : shapeIndex;
    let idx: number;
    if (exhaustion === 'bounce' && len > 1) {
      const period = (len - 1) * 2;
      const pos = ((driverIndex % period) + period) % period;
      idx = pos < len ? pos : period - pos;
    } else {
      idx = ((driverIndex % len) + len) % len;
    }
    item = items[idx];
  }

  if (item.mode === 'fixed') return item.value;
  const [lo, hi] = item.valueRange;
  return lo + Math.random() * (hi - lo);
}
