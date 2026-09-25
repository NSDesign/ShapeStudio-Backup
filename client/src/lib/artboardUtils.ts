/**
 * Artboard utility functions for DPI and unit conversions
 */

export type UnitType = 'pixels' | 'mm' | 'cm' | 'inches';

/**
 * Convert pixels to physical units based on DPI
 */
export function pixelsToUnit(pixels: number, dpi: number, unit: UnitType): number {
  if (unit === 'pixels') return pixels;
  
  const inches = pixels / dpi;
  
  switch (unit) {
    case 'inches':
      return inches;
    case 'mm':
      return inches * 25.4;
    case 'cm':
      return inches * 2.54;
    default:
      return pixels;
  }
}

/**
 * Convert physical units to pixels based on DPI
 */
export function unitToPixels(value: number, dpi: number, unit: UnitType): number {
  if (unit === 'pixels') return value;
  
  let inches: number;
  
  switch (unit) {
    case 'inches':
      inches = value;
      break;
    case 'mm':
      inches = value / 25.4;
      break;
    case 'cm':
      inches = value / 2.54;
      break;
    default:
      inches = 0;
  }
  
  return inches * dpi;
}

/**
 * Format dimension value with appropriate decimal places for the unit
 */
export function formatDimension(value: number, unit: UnitType): string {
  if (unit === 'pixels') {
    return Math.round(value).toString();
  }
  
  // For physical units, show 2 decimal places
  return value.toFixed(2);
}

/**
 * Get unit label for display
 */
export function getUnitLabel(unit: UnitType): string {
  const labels: Record<UnitType, string> = {
    'pixels': 'px',
    'mm': 'mm',
    'cm': 'cm',
    'inches': 'in'
  };
  return labels[unit] || 'px';
}

/**
 * Convert artboard dimensions to display units
 */
export function getArtboardDisplayDimensions(
  widthPixels: number,
  heightPixels: number,
  dpi: number = 72,
  unit: UnitType = 'pixels'
): { width: number; height: number; widthFormatted: string; heightFormatted: string } {
  const width = pixelsToUnit(widthPixels, dpi, unit);
  const height = pixelsToUnit(heightPixels, dpi, unit);
  
  return {
    width,
    height,
    widthFormatted: formatDimension(width, unit),
    heightFormatted: formatDimension(height, unit)
  };
}

/**
 * Calculate pixel dimensions from physical dimensions
 */
export function calculatePixelDimensions(
  width: number,
  height: number,
  dpi: number = 72,
  unit: UnitType = 'pixels'
): { widthPixels: number; heightPixels: number } {
  return {
    widthPixels: Math.round(unitToPixels(width, dpi, unit)),
    heightPixels: Math.round(unitToPixels(height, dpi, unit))
  };
}

/**
 * Common DPI presets
 */
export const DPI_PRESETS = [
  { label: 'Screen (72 DPI)', value: 72 },
  { label: 'Web (96 DPI)', value: 96 },
  { label: 'Print Draft (150 DPI)', value: 150 },
  { label: 'Print Standard (300 DPI)', value: 300 },
  { label: 'Print High (600 DPI)', value: 600 },
  { label: 'Print Ultra (1200 DPI)', value: 1200 },
] as const;

/**
 * Get effective translate range for shape transforms based on artboard-aware setting
 * 
 * When transformsArtboardAware is enabled, returns artboard bounds.
 * Otherwise, returns the user's manual translate range settings.
 */
export function getEffectiveTranslateRange(
  axis: 'x' | 'y',
  settings: { 
    transformsArtboardAware: boolean; 
    translateXRange?: [number, number]; 
    translateYRange?: [number, number];
  },
  artboard: { x: number; y: number; width: number; height: number }
): [number, number] {
  if (!settings.transformsArtboardAware) {
    // Use manual ranges when toggle is OFF
    return axis === 'x' 
      ? (settings.translateXRange || [-50, 50])
      : (settings.translateYRange || [-50, 50]);
  }
  
  // Use artboard bounds when toggle is ON
  return axis === 'x'
    ? [artboard.x, artboard.x + artboard.width]
    : [artboard.y, artboard.y + artboard.height];
}

/**
 * Grid settings that can be recalculated when artboard dimensions change
 */
export interface GridRecalculationInput {
  gridRows: number;
  gridColumns: number;
  gridStartX: number;
  gridStartY: number;
  gridRowOffset: number;
  gridColumnOffset: number;
  gridMarginEnabled?: boolean;
  gridMarginMode?: 'absolute' | 'relative';
  gridMarginUnit?: 'px' | '%';
  gridMarginTop?: number;
  gridMarginRight?: number;
  gridMarginBottom?: number;
  gridMarginLeft?: number;
}

export interface GridRecalculationOutput {
  gridStartX: number;
  gridStartY: number;
  gridRowOffset: number;
  gridColumnOffset: number;
  gridMarginTop?: number;
  gridMarginRight?: number;
  gridMarginBottom?: number;
  gridMarginLeft?: number;
}

/**
 * Recalculate grid settings when switching to an artboard with different dimensions.
 * 
 * For 'define' mode: Scale spacing values proportionally based on dimension ratio
 * For 'auto-centered' and 'auto-edge-to-edge': No changes needed (auto-calculated from artboard)
 * 
 * @param currentSettings - Current grid settings
 * @param oldDimensions - Previous artboard dimensions
 * @param newDimensions - New artboard dimensions
 * @returns Updated grid settings
 */
export function recalculateGridForArtboard(
  currentSettings: GridRecalculationInput,
  oldDimensions: { width: number; height: number },
  newDimensions: { width: number; height: number }
): GridRecalculationOutput {
  // Calculate scale ratios
  const scaleX = oldDimensions.width > 0 ? newDimensions.width / oldDimensions.width : 1;
  const scaleY = oldDimensions.height > 0 ? newDimensions.height / oldDimensions.height : 1;
  
  // Start positions always need scaling as they're pixel offsets
  const newStartX = Math.round(currentSettings.gridStartX * scaleX);
  const newStartY = Math.round(currentSettings.gridStartY * scaleY);
  
  // For 'define' mode, scale the spacing values
  // For auto modes, the spacing is calculated from artboard bounds automatically
  let newColumnOffset = currentSettings.gridColumnOffset;
  let newRowOffset = currentSettings.gridRowOffset;
  
  if (true) {
    newColumnOffset = Math.round(currentSettings.gridColumnOffset * scaleX);
  }
  
  if (true) {
    newRowOffset = Math.round(currentSettings.gridRowOffset * scaleY);
  }
  
  // Scale per-side margin values if enabled and unit is px (% margins are dimension-relative, no scaling needed)
  let newMarginTop    = currentSettings.gridMarginTop;
  let newMarginRight  = currentSettings.gridMarginRight;
  let newMarginBottom = currentSettings.gridMarginBottom;
  let newMarginLeft   = currentSettings.gridMarginLeft;
  if (currentSettings.gridMarginEnabled && (currentSettings.gridMarginUnit ?? 'px') === 'px') {
    if (newMarginTop    !== undefined) newMarginTop    = Math.round(newMarginTop    * scaleY);
    if (newMarginBottom !== undefined) newMarginBottom = Math.round(newMarginBottom * scaleY);
    if (newMarginLeft   !== undefined) newMarginLeft   = Math.round(newMarginLeft   * scaleX);
    if (newMarginRight  !== undefined) newMarginRight  = Math.round(newMarginRight  * scaleX);
  }

  return {
    gridStartX: newStartX,
    gridStartY: newStartY,
    gridRowOffset: newRowOffset,
    gridColumnOffset: newColumnOffset,
    gridMarginTop:    newMarginTop,
    gridMarginRight:  newMarginRight,
    gridMarginBottom: newMarginBottom,
    gridMarginLeft:   newMarginLeft,
  };
}
