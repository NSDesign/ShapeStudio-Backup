/**
 * Position Modulation Resolver
 * 
 * Handles incremental position modulation calculations after grid distribution/sorting.
 * Supports multiple modulation modes: pixel-value, shape-count, grid-row.
 */

import type { GridDistributionResult } from '../../shared/distributionTypes';

export interface ModulationContext {
  // Index within the current generation (0-based)
  generationIndex: number;
  
  // Index across all generations (for per-batch scope)
  globalIndex: number;
  
  // Grid cell information (available after grid distribution)
  gridCellIndex?: number;  // Linear grid index (0-based)
  gridRowIndex?: number;   // Row within grid (0-based)
  gridColIndex?: number;   // Column within grid (0-based)
  gridColumns?: number;    // Total columns in grid
}

export interface IncrementalSettings {
  startValue: number;
  increment: number;
  modulationMode: 'off' | 'pixel-value' | 'shape-count' | 'grid-row' | 'grid-col';
  modulationValue: number;
  resetPerBatch: boolean;
  // Future: incrementScope: 'per-generation' | 'per-batch'
}

/**
 * Calculate incremental position value with modulation support
 */
export function calculateIncrementalPosition(
  settings: IncrementalSettings,
  context: ModulationContext
): number {
  // Determine which index to use based on reset-per-batch setting
  const effectiveIndex = settings.resetPerBatch 
    ? context.generationIndex 
    : context.globalIndex;
  
  // Calculate base incremental value
  let value = settings.startValue + (effectiveIndex * settings.increment);
  
  // Apply modulation based on mode
  switch (settings.modulationMode) {
    case 'pixel-value':
      // Modulate by pixel value (legacy behavior)
      if (settings.modulationValue > 0) {
        value = value % settings.modulationValue;
      }
      break;
      
    case 'shape-count':
      // Modulate by shape count (reset every N shapes)
      if (settings.modulationValue > 0) {
        const moduloIndex = effectiveIndex % settings.modulationValue;
        value = settings.startValue + (moduloIndex * settings.increment);
      }
      break;
      
    case 'grid-row':
      // Modulate by grid row (reset at end of each row)
      // This mode REQUIRES grid context information
      if (context.gridColIndex !== undefined && context.gridColumns !== undefined) {
        // Use column index within the row instead of global index
        value = settings.startValue + (context.gridColIndex * settings.increment);
      } else {
        // Fallback to regular incremental if grid context not available
        console.warn('[Position Modulation] grid-row mode requires grid context');
        value = settings.startValue + (effectiveIndex * settings.increment);
      }
      break;
      
    case 'off':
    default:
      // No modulation, value already calculated
      break;
  }
  
  return value;
}

/**
 * Apply incremental position modulation to grid distribution results
 * 
 * Accepts GridDistributionResult[] with embedded grid context, applies X/Y position
 * adjustments based on incremental settings with modulation support, and returns
 * unwrapped shapes.
 */
export function applyIncrementalPositionToShapes(
  gridResults: GridDistributionResult[],
  xSettings: IncrementalSettings | null,
  ySettings: IncrementalSettings | null,
  options: {
    globalIndexOffset?: number;  // Offset for cross-batch calculations
    gridColumns?: number;        // For grid-row modulation
  } = {}
): any[] {
  const globalIndexOffset = options.globalIndexOffset || 0;
  const gridColumns = options.gridColumns;
  
  return gridResults.map((result, index) => {
    const { shape, rowIndex, colIndex, generationIndex, batchIndex } = result;
    
    // Use batchIndex when available (includes cross-generation offset), otherwise fallback
    const effectiveGlobalIndex = batchIndex ?? (globalIndexOffset + generationIndex);
    
    // Build modulation context using grid metadata from distribution result
    const context: ModulationContext = {
      generationIndex,
      globalIndex: effectiveGlobalIndex,
      gridCellIndex: generationIndex,
      gridRowIndex: rowIndex,
      gridColIndex: colIndex,
      gridColumns
    };
    
    // Apply X position modulation if enabled
    if (xSettings) {
      const xOffset = calculateIncrementalPosition(xSettings, context);
      const originalX = shape.transform?.x || 0;
      shape.transform.x = originalX + xOffset;
      
      if (index < 3) {
        console.log(`📐 [SERVER] Shape ${index}: mode=${xSettings.modulationMode}, genIdx=${generationIndex}, col=${colIndex}, xOffset=${xOffset}, gridX=${originalX}, finalX=${shape.transform.x}`);
      }
    }
    
    // Apply Y position modulation if enabled
    if (ySettings) {
      const yOffset = calculateIncrementalPosition(ySettings, context);
      shape.transform.y = (shape.transform?.y || 0) + yOffset;
    }
    
    // Return unwrapped shape
    return shape;
  });
}
