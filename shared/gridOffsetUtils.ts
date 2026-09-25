/**
 * Shared Grid Offset Utilities
 * 
 * These functions calculate grid offsets and position masking for grid distribution.
 * Used by both client and server for consistent behavior.
 */

import type { GridOffsetAxisConfig, GridOffsetsConfig, ShapeMaskingConfig } from './schema';

/**
 * Calculate offset amount based on axis configuration mode
 * Supports fixed, range, and incremental modes
 */
export function calculateGridOffsetAmount(
  axisConfig: GridOffsetAxisConfig,
  occurrenceIndex: number
): number {
  const amountMode = axisConfig.amountMode ?? 'fixed';
  
  if (amountMode === 'fixed') {
    return axisConfig.amount ?? 0;
  } else if (amountMode === 'range') {
    const min = axisConfig.amountMin ?? 0;
    const max = axisConfig.amountMax ?? 50;
    return min + Math.random() * (max - min);
  } else if (amountMode === 'incremental') {
    const base = axisConfig.amountBase ?? 0;
    const increment = axisConfig.amountIncrement ?? 10;
    return base + (increment * occurrenceIndex);
  }
  return 0;
}

/**
 * Result of grid offset calculation
 */
export interface GridOffsetResult {
  offsetX: number;
  offsetY: number;
}

/**
 * Calculate grid offsets for a given row and column position
 * Row offset affects X position (shifts rows left/right)
 * Column offset affects Y position (shifts columns up/down)
 */
export function calculateGridOffsets(
  row: number,
  col: number,
  gridOffsets?: GridOffsetsConfig
): GridOffsetResult {
  let offsetX = 0;
  let offsetY = 0;
  
  if (!gridOffsets?.enabled) {
    return { offsetX, offsetY };
  }
  
  const mode = gridOffsets.mode ?? 'alternating';
  
  // Row offset affects X position (shifts rows left/right)
  if (gridOffsets.row?.enabled) {
    let shouldApplyRowOffset = false;
    let rowOccurrenceIndex = 0;
    
    if (mode === 'alternating') {
      const startIndex = gridOffsets.row.startIndex ?? 0;
      shouldApplyRowOffset = (row % 2) === startIndex;
      if (shouldApplyRowOffset) {
        rowOccurrenceIndex = Math.floor((row - startIndex) / 2);
      }
    } else if (mode === 'pattern') {
      const rowPattern = gridOffsets.row.pattern ?? [];
      const inverse = gridOffsets.row.patternInverse ?? false;
      if (inverse) {
        shouldApplyRowOffset = !rowPattern.includes(row);
        if (shouldApplyRowOffset) {
          rowOccurrenceIndex = row - rowPattern.filter(p => p < row).length;
        }
      } else {
        const patternIndex = rowPattern.indexOf(row);
        shouldApplyRowOffset = patternIndex >= 0;
        if (shouldApplyRowOffset) {
          rowOccurrenceIndex = patternIndex;
        }
      }
    }
    
    if (shouldApplyRowOffset) {
      const amount = calculateGridOffsetAmount(gridOffsets.row, rowOccurrenceIndex);
      offsetX = gridOffsets.row.direction === 'right' ? amount : -amount;
    }
  }
  
  // Column offset affects Y position (shifts columns up/down)
  if (gridOffsets.column?.enabled) {
    let shouldApplyColumnOffset = false;
    let columnOccurrenceIndex = 0;
    
    if (mode === 'alternating') {
      const startIndex = gridOffsets.column.startIndex ?? 0;
      shouldApplyColumnOffset = (col % 2) === startIndex;
      if (shouldApplyColumnOffset) {
        columnOccurrenceIndex = Math.floor((col - startIndex) / 2);
      }
    } else if (mode === 'pattern') {
      const columnPattern = gridOffsets.column.pattern ?? [];
      const inverse = gridOffsets.column.patternInverse ?? false;
      if (inverse) {
        shouldApplyColumnOffset = !columnPattern.includes(col);
        if (shouldApplyColumnOffset) {
          columnOccurrenceIndex = col - columnPattern.filter(p => p < col).length;
        }
      } else {
        const patternIndex = columnPattern.indexOf(col);
        shouldApplyColumnOffset = patternIndex >= 0;
        if (shouldApplyColumnOffset) {
          columnOccurrenceIndex = patternIndex;
        }
      }
    }
    
    if (shouldApplyColumnOffset) {
      const amount = calculateGridOffsetAmount(gridOffsets.column, columnOccurrenceIndex);
      offsetY = gridOffsets.column.direction === 'down' ? amount : -amount;
    }
  }
  
  return { offsetX, offsetY };
}

/**
 * Determines if a grid position should be masked (excluded from shape rendering)
 * @param row - Row index (0-indexed)
 * @param column - Column index (0-indexed)
 * @param shapeMasking - Shape masking configuration
 * @returns true if the position should be masked (no shape rendered), false if shape should render
 */
export function isGridPositionMasked(
  row: number,
  column: number,
  shapeMasking?: ShapeMaskingConfig
): boolean {
  // If masking is not enabled or not provided, render all positions
  if (!shapeMasking?.enabled || !shapeMasking?.grid?.enabled) {
    return false;
  }
  
  const grid = shapeMasking.grid;
  const mode = grid.mode ?? 'alternating';
  const invert = grid.invert ?? false;
  
  let isMatched = false;
  
  if (mode === 'alternating') {
    const skipEvery = grid.alternating?.skipEvery ?? 2;
    const startIndex = grid.alternating?.startIndex ?? 0;
    
    // In row-first priority, determine masking based on row index first
    // In column-first priority, determine masking based on column index first
    if (grid.priority === 'row-first') {
      // Row determines if the entire row is masked
      isMatched = ((row - startIndex) % skipEvery) === 0 && row >= startIndex;
    } else {
      // Column determines if the entire column is masked
      isMatched = ((column - startIndex) % skipEvery) === 0 && column >= startIndex;
    }
  } else if (mode === 'pattern') {
    // Pattern mode: check explicit row/column combinations
    const patterns = grid.pattern ?? [];
    
    for (const patternEntry of patterns) {
      if (patternEntry.row === row) {
        // Check if this column is in the columns array for this row
        if (patternEntry.columns.includes(column)) {
          isMatched = true;
          break;
        }
      }
    }
  }
  
  // invert=false: matched positions are excluded (masked)
  // invert=true: only matched positions are rendered (non-matched are masked)
  return invert ? !isMatched : isMatched;
}
