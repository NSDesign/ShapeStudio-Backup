/**
 * Distribution Layout Functions for Server-side Shape Generation
 * Ported from client/src/lib/shapeTypes.ts
 * 
 * These functions apply advanced distribution patterns to shapes:
 * - Grid distribution with sorting and randomization
 * - Wave patterns (sine, triangle, square, sawtooth)
 * - Ellipse/ring patterns with rotation
 * - Spiral patterns with configurable tightness
 * - Auto-distribution for even spacing
 */

import type { GridDistributionResult } from '../../shared/distributionTypes';
import { resolveScalarSeries } from '../../shared/batchUtils';
import type { 
  ShapeMaskingConfig, 
  CellConstraintsConfig, 
  GridOffsetsConfig,
  GridOffsetAxisConfig 
} from '../../shared/schema';
import { DEFAULT_CELL_CONSTRAINTS } from '../../shared/schema';
import { getGridTraversalPositions, type GridTraversalOptions } from '../../shared/gridTraversal';
import {
  calculateGridOffsets,
  isGridPositionMasked
} from '../../shared/gridOffsetUtils';

const DEFAULT_GRID_OFFSETS: GridOffsetsConfig = {
  enabled: false,
  mode: 'alternating',
  preset: 'custom',
  row: {
    enabled: false,
    amountMode: 'fixed',
    amount: 0,
    amountMin: 0,
    amountMax: 50,
    amountBase: 0,
    amountIncrement: 10,
    startIndex: 0,
    direction: 'right',
    pattern: [],
    patternInverse: false
  },
  column: {
    enabled: false,
    amountMode: 'fixed',
    amount: 0,
    amountMin: 0,
    amountMax: 50,
    amountBase: 0,
    amountIncrement: 10,
    startIndex: 0,
    direction: 'down',
    pattern: [],
    patternInverse: false
  }
};

interface DistributionConfig extends GridTraversalOptions {
  enabled: boolean;
  pattern: 'grid' | 'wave' | 'ellipse' | 'spiral' | 'auto-distribute';
  
  // Grid Layout Settings
  gridRows?: number;
  gridColumns?: number;
  gridStartX?: number;
  gridStartY?: number;
  gridRowOffset?: number;
  gridColumnOffset?: number;
  gridMarginEnabled?: boolean;
  gridMarginMode?: 'absolute' | 'relative';
  gridMarginUnit?: 'px' | '%';
  gridMarginTop?: number;
  gridMarginRight?: number;
  gridMarginBottom?: number;
  gridMarginLeft?: number;
  gridSortBy?: string;
  gridSortScope?: 'per-generation' | 'per-batch';
  gridSortOrder?: 'ascending' | 'descending';
  gridGroupByShapeType?: boolean;
  gridReverseGroups?: boolean;
  gridXRandomization?: number;
  gridYRandomization?: number;
  
  // Shape Masking Settings
  shapeMasking?: ShapeMaskingConfig;
  
  // Cell Constraints Settings
  cellConstraints?: CellConstraintsConfig;
  
  // Grid Offsets Settings
  gridOffsets?: GridOffsetsConfig;
  
  // Auto Distribute Settings
  autoDistributeXCount?: number;
  autoDistributeYCount?: number;
  
  // Wave Pattern Settings
  waveType?: 'sine' | 'triangle' | 'square' | 'sawtooth';
  waveAmplitude?: number;
  waveFrequency?: number;
  waveDirection?: 'horizontal' | 'vertical';
  wavePhaseOffset?: number;
  
  // Ellipse Pattern Settings
  ellipseXRadius?: [number, number];
  ellipseYRadius?: [number, number];
  ellipseRingCount?: number;
  ellipseRingSpacing?: 'even' | 'progressive';
  ellipseRotation?: number;
  ellipseRotationAlignment?: 'uniform' | 'progressive';
  ellipseAlignToRing?: boolean;
  ellipseFlipInward?: boolean;
  ellipseAdditionalRotation?: number;
  ellipseShapeRotationMode?: 'none' | 'fixed' | 'range' | 'incremental' | 'series';
  ellipseRotationFixed?: number;
  ellipseRotationRange?: [number, number];
  ellipseRotationIncrementalStart?: number;
  ellipseRotationIncrementalStep?: number;
  ellipseShapeRotationSeriesItems?: Array<{ mode: 'fixed'; value: number } | { mode: 'range'; valueRange: [number, number] }>;
  ellipseShapeRotationSeriesSelection?: 'sequential' | 'random';
  ellipseShapeRotationSeriesExhaustion?: 'cycle' | 'bounce';
  ellipseShapeRotationSeriesDriver?: 'shape-index' | 'set-rep-index';
  _setRepIndex?: number;
  
  // Spiral Pattern Settings
  spiralTurnCount?: number;
  spiralSpacingMode?: 'linear' | 'logarithmic';
  spiralDirection?: 'clockwise' | 'counterclockwise';
  spiralStartAngle?: number;
  spiralTightness?: number;
  
  // Shared Settings
  tangentAlignment?: boolean;
  segmentDistribution?: 'even' | 'clustered';
  reverseDirection?: boolean;
}

/**
 * Check if a grid position should be masked (excluded from rendering)
 * Uses shared utility for consistent client/server behavior
 * Returns true if the position should be masked, false if it should render
 */
function isPositionMasked(
  row: number,
  column: number,
  shapeMasking?: ShapeMaskingConfig
): boolean {
  return isGridPositionMasked(row, column, shapeMasking);
}

/**
 * Helper function to sort shapes for grid distribution
 */
function sortShapesForGrid(
  shapes: any[],
  sortBy: string = 'none',
  order: 'ascending' | 'descending' = 'ascending',
  groupByShapeType: boolean = false,
  reverseGroups: boolean = false
): any[] {
  if (sortBy === 'none' && !groupByShapeType) return shapes;

  let sortedShapes = [...shapes];
  
  // Group by shape type if requested
  if (groupByShapeType) {
    const groups = new Map<string, any[]>();
    
    shapes.forEach(shape => {
      const type = shape.type || 'unknown';
      if (!groups.has(type)) {
        groups.set(type, []);
      }
      groups.get(type)!.push(shape);
    });
    
    // Sort within each group
    groups.forEach((groupShapes, type) => {
      groups.set(type, sortShapesWithinGroup(groupShapes, sortBy, order));
    });
    
    // Combine groups back together
    const groupEntries = Array.from(groups.entries());
    
    // Optionally reverse the order of groups
    if (reverseGroups) {
      groupEntries.reverse();
    }
    
    sortedShapes = groupEntries.flatMap(([_, groupShapes]) => groupShapes);
  } else {
    sortedShapes = sortShapesWithinGroup(sortedShapes, sortBy, order);
  }
  
  return sortedShapes;
}

/**
 * Helper to sort shapes within a group
 */
function sortShapesWithinGroup(
  shapes: any[],
  sortBy: string,
  order: 'ascending' | 'descending'
): any[] {
  if (sortBy === 'none') return shapes;
  
  const sorted = [...shapes].sort((a, b) => {
    let compareValue = 0;
    
    switch (sortBy) {
      case 'layer':
        compareValue = (a.properties?.zIndex || 0) - (b.properties?.zIndex || 0);
        break;
      case 'creation-time':
        compareValue = a.id.localeCompare(b.id);
        break;
      case 'shape-type':
        compareValue = (a.type || '').localeCompare(b.type || '');
        break;
      case 'size':
        const sizeA = (a.width || 0) * (a.height || 0) || (a.radius || 0) * (a.radius || 0) * Math.PI;
        const sizeB = (b.width || 0) * (b.height || 0) || (b.radius || 0) * (b.radius || 0) * Math.PI;
        compareValue = sizeA - sizeB;
        break;
      case 'fill-color':
        compareValue = (a.properties?.fillColor || '').localeCompare(b.properties?.fillColor || '');
        break;
      case 'opacity':
        compareValue = (a.properties?.fillOpacity || 0) - (b.properties?.fillOpacity || 0);
        break;
      case 'angle':
        compareValue = (a.transform?.rotation || 0) - (b.transform?.rotation || 0);
        break;
      case 'id':
        compareValue = a.id.localeCompare(b.id);
        break;
      case 'corner-radius':
        compareValue = (a.cornerRadius || 0) - (b.cornerRadius || 0);
        break;
      case 'point-count':
        compareValue = (a.points?.length || 0) - (b.points?.length || 0);
        break;
      case 'edge-count':
        compareValue = (a.sides || 0) - (b.sides || 0);
        break;
      case 'inner-radius':
        compareValue = (a.innerRadius || 0) - (b.innerRadius || 0);
        break;
      case 'segment-count':
        compareValue = (a.segments || 0) - (b.segments || 0);
        break;
      case 'direction':
        // For line-vector shapes
        compareValue = 0;
        break;
      case 'length':
        // For line shapes
        if (a.points?.length >= 2 && b.points?.length >= 2) {
          const lengthA = Math.sqrt(
            Math.pow(a.points[1].x - a.points[0].x, 2) + 
            Math.pow(a.points[1].y - a.points[0].y, 2)
          );
          const lengthB = Math.sqrt(
            Math.pow(b.points[1].x - b.points[0].x, 2) + 
            Math.pow(b.points[1].y - b.points[0].y, 2)
          );
          compareValue = lengthA - lengthB;
        }
        break;
      case 'centroid':
        compareValue = 0;
        break;
      case 'spread':
      case 'curvature':
        compareValue = 0;
        break;
    }
    
    return order === 'ascending' ? compareValue : -compareValue;
  });
  
  return sorted;
}

/**
 * Apply grid distribution to shapes
 * Returns GridDistributionResult[] with grid context for modulation
 */
export function applyGridDistribution(
  shapes: any[], 
  config: DistributionConfig,
  canvasCenter = { x: 0, y: 0 },
  generationInfo?: { currentGeneration?: number, totalGenerations?: number, shapesPerGeneration?: number },
  artboardBounds?: { x: number; y: number; width: number; height: number },
  globalIndexOffset = 0
): GridDistributionResult[] {
  // Early return: wrap shapes in result structure with default grid context
  if (!config.enabled || config.pattern !== 'grid') {
    return shapes.map((shape, index) => ({
      shape,
      rowIndex: 0,
      colIndex: index,
      generationIndex: index,
      batchIndex: globalIndexOffset + index
    }));
  }
  
  const rows = config.gridRows || 3;
  const columns = config.gridColumns || 3;
  const startX = config.gridStartX || 0;
  const startY = config.gridStartY || 0;
  
  let sortedShapes: any[];
  
  if (config.gridSortScope === 'per-generation' && generationInfo) {
    const { shapesPerGeneration = shapes.length, totalGenerations = 1 } = generationInfo;
    sortedShapes = [];
    
    for (let gen = 0; gen < totalGenerations; gen++) {
      const startIndex = gen * shapesPerGeneration;
      const endIndex = Math.min(startIndex + shapesPerGeneration, shapes.length);
      const generationShapes = shapes.slice(startIndex, endIndex);
      
      const sortedGeneration = sortShapesForGrid(
        generationShapes, 
        config.gridSortBy, 
        config.gridSortOrder,
        config.gridGroupByShapeType || false,
        config.gridReverseGroups || false
      );
      
      sortedShapes.push(...sortedGeneration);
    }
  } else {
    sortedShapes = sortShapesForGrid(
      shapes, 
      config.gridSortBy, 
      config.gridSortOrder,
      config.gridGroupByShapeType || false,
      config.gridReverseGroups || false
    );
  }
  
  // Cell constraints for cell-based rendering (matches client)
  const cellConstraints = config.cellConstraints || DEFAULT_CELL_CONSTRAINTS;
  const isCellCenterMode = cellConstraints.renderMode === 'cell-center';
  const isCellCornersMode = cellConstraints.renderMode === 'cell-corners';
  const hasFitConstraints = cellConstraints.enabled && (isCellCenterMode || isCellCornersMode);
  
  // Position count depends on mode (matches client):
  // - Cell center mode: rows × cols cells (gridRows × gridColumns = cell count)
  // - Cell corners mode: (rows+1) × (cols+1) intersection points
  const effectiveRows = isCellCornersMode ? rows + 1 : rows;
  const effectiveCols = isCellCornersMode ? columns + 1 : columns;
  
  // Build list of valid (non-masked) grid positions
  const validPositions: Array<{ rowIndex: number; colIndex: number; linearIndex: number }> = [];
  for (const { rowIndex, colIndex, linearIndex } of getGridTraversalPositions(effectiveRows, effectiveCols, config)) {
    // Check if this position is masked
    if (!isPositionMasked(rowIndex, colIndex, config.shapeMasking)) {
      validPositions.push({ rowIndex, colIndex, linearIndex });
    }
  }
  
  // Use ALL generated shapes — excess shapes cycle back through valid positions (matches client)
  const shapesToPlace = sortedShapes;

  // Cell dimensions: artboard divided evenly (edge-to-edge model)
  const cellWidth = artboardBounds ? artboardBounds.width / columns : (config.gridColumnOffset || 50);
  const cellHeight = artboardBounds ? artboardBounds.height / rows : (config.gridRowOffset || 50);

  // Fallback centering for non-cell mode without artboard bounds
  const artboardCenterX = artboardBounds
    ? artboardBounds.x + artboardBounds.width / 2
    : canvasCenter.x;
  const artboardCenterY = artboardBounds
    ? artboardBounds.y + artboardBounds.height / 2
    : canvasCenter.y;

  // Map shapes to grid positions, cycling when count exceeds number of valid positions (matches client)
  return shapesToPlace.map((shape, index) => {
    const positionEntry = validPositions.length > 0
      ? validPositions[index % validPositions.length]
      : { rowIndex: 0, colIndex: 0, linearIndex: 0 };
    const { rowIndex, colIndex } = positionEntry;
    const row = rowIndex;
    const col = colIndex;

    // Compute position using new cell model (edge-to-edge)
    let gridPosX: number;
    let gridPosY: number;
    if (artboardBounds && isCellCenterMode) {
      gridPosX = artboardBounds.x + (col + 0.5) * cellWidth;
      gridPosY = artboardBounds.y + (row + 0.5) * cellHeight;
      const { offsetX: gox, offsetY: goy } = calculateGridOffsets(row, col, config.gridOffsets);
      gridPosX += gox;
      gridPosY += goy;
    } else if (artboardBounds && isCellCornersMode) {
      gridPosX = artboardBounds.x + col * cellWidth;
      gridPosY = artboardBounds.y + row * cellHeight;
      const { offsetX: gox, offsetY: goy } = calculateGridOffsets(row, col, config.gridOffsets);
      gridPosX += gox;
      gridPosY += goy;
    } else {
      // No cell mode: use define-mode centering with gridColumnOffset/gridRowOffset
      const colSpacing = config.gridColumnOffset || 50;
      const rowSpacing = config.gridRowOffset || 50;
      gridPosX = artboardCenterX - ((columns - 1) * colSpacing) / 2 + (config.gridStartX || 0) + col * colSpacing;
      gridPosY = artboardCenterY - ((rows - 1) * rowSpacing) / 2 + (config.gridStartY || 0) + row * rowSpacing;
      const { offsetX: gox, offsetY: goy } = calculateGridOffsets(row, col, config.gridOffsets);
      gridPosX += gox;
      gridPosY += goy;
    }

    // Cell center mode: gridPos is at cell center, base cellOffset is 0.
    // Cell corners mode: gridPos is at intersection, base cellOffset stays 0.
    let cellOffsetX = 0;
    let cellOffsetY = 0;

    // Resolve per-side cell padding to pixels
    const padUnit = cellConstraints.paddingUnit ?? 'px';
    const pL = padUnit === '%' ? ((cellConstraints.paddingLeft   ?? 0) / 100) * cellWidth  : (cellConstraints.paddingLeft   ?? 0);
    const pR = padUnit === '%' ? ((cellConstraints.paddingRight  ?? 0) / 100) * cellWidth  : (cellConstraints.paddingRight  ?? 0);
    const pT = padUnit === '%' ? ((cellConstraints.paddingTop    ?? 0) / 100) * cellHeight : (cellConstraints.paddingTop    ?? 0);
    const pB = padUnit === '%' ? ((cellConstraints.paddingBottom ?? 0) / 100) * cellHeight : (cellConstraints.paddingBottom ?? 0);

    // Apply fit mode scaling for cell modes
    if (hasFitConstraints && cellConstraints.fitMode !== 'none') {
      const availableWidth  = Math.max(1, cellWidth  - pL - pR);
      const availableHeight = Math.max(1, cellHeight - pT - pB);

      let shapeWidth: number;
      let shapeHeight: number;

      if (shape.radius !== undefined && shape.radius > 0) {
        shapeWidth = shape.radius * 2;
        shapeHeight = shape.radius * 2;
      } else if (shape.width !== undefined && shape.height !== undefined) {
        shapeWidth = shape.width;
        shapeHeight = shape.height;
      } else if (shape.points && shape.points.length > 0) {
        const xs = shape.points.map((p: any) => p.x);
        const ys = shape.points.map((p: any) => p.y);
        shapeWidth  = Math.max(10, Math.max(...xs) - Math.min(...xs));
        shapeHeight = Math.max(10, Math.max(...ys) - Math.min(...ys));
      } else {
        shapeWidth = 50;
        shapeHeight = 50;
      }

      let scaleX = 1;
      let scaleY = 1;

      switch (cellConstraints.fitMode) {
        case 'contain': {
          const s = Math.min(availableWidth / shapeWidth, availableHeight / shapeHeight);
          scaleX = scaleY = s;
          break;
        }
        case 'cover': {
          const s = Math.max(availableWidth / shapeWidth, availableHeight / shapeHeight);
          scaleX = scaleY = s;
          break;
        }
        case 'fill':
          scaleX = availableWidth / shapeWidth;
          scaleY = availableHeight / shapeHeight;
          break;
      }

      shape.transform.scaleX = (shape.transform.scaleX || 1) * scaleX;
      shape.transform.scaleY = (shape.transform.scaleY || 1) * scaleY;

      const modeLabel = isCellCenterMode ? 'CELL-CENTER' : 'CELL-CORNERS';
      console.log(`🔲 [SERVER ${modeLabel} MODE] Shape ${index}: fitMode=${cellConstraints.fitMode}, scale=${scaleX.toFixed(2)}x${scaleY.toFixed(2)}, cellSize=${cellWidth.toFixed(0)}x${cellHeight.toFixed(0)}, shapeSize=${shapeWidth}x${shapeHeight}`);
    }

    // Apply additive random offset
    const randomX = (Math.random() - 0.5) * 2 * (config.gridXRandomization || 0);
    const randomY = (Math.random() - 0.5) * 2 * (config.gridYRandomization || 0);

    const positionOffsetX = shape.transform?.x || 0;
    const positionOffsetY = shape.transform?.y || 0;

    shape.transform.x = gridPosX + positionOffsetX + randomX + cellOffsetX;
    shape.transform.y = gridPosY + positionOffsetY + randomY + cellOffsetY;

    return {
      shape,
      rowIndex,
      colIndex,
      generationIndex: index,
      batchIndex: globalIndexOffset + index
    };
  });
}

/**
 * Apply wave distribution to shapes
 */
export function applyWaveDistribution(
  shapes: any[],
  config: DistributionConfig,
  canvasCenter = { x: 0, y: 0 },
  artboardBounds?: { x: number; y: number; width: number; height: number }
): any[] {
  if (!config.enabled || config.pattern !== 'wave') return shapes;
  
  const waveType = config.waveType || 'sine';
  const amplitude = config.waveAmplitude || 50;
  const frequency = config.waveFrequency || 2;
  const direction = config.waveDirection || 'horizontal';
  const phaseOffset = (config.wavePhaseOffset || 0) * (Math.PI / 180);
  
  const artboardCenterX = artboardBounds 
    ? artboardBounds.x + artboardBounds.width / 2 
    : canvasCenter.x;
  const artboardCenterY = artboardBounds 
    ? artboardBounds.y + artboardBounds.height / 2 
    : canvasCenter.y;
  
  const pathLength = direction === 'horizontal' 
    ? (artboardBounds?.width || 400)
    : (artboardBounds?.height || 400);
  
  const totalShapes = shapes.length;
  const spacing = pathLength / (totalShapes + 1);
  
  return shapes.map((shape, index) => {
    const t = (index + 1) * spacing;
    const phase = (t / pathLength) * frequency * 2 * Math.PI + phaseOffset;
    
    let waveOffset = 0;
    switch (waveType) {
      case 'sine':
        waveOffset = Math.sin(phase) * amplitude;
        break;
      case 'triangle':
        waveOffset = (2 * amplitude / Math.PI) * Math.asin(Math.sin(phase));
        break;
      case 'square':
        waveOffset = Math.sign(Math.sin(phase)) * amplitude;
        break;
      case 'sawtooth':
        waveOffset = (2 * amplitude / Math.PI) * (phase % (2 * Math.PI) - Math.PI);
        break;
    }
    
    let x, y;
    if (direction === 'horizontal') {
      x = artboardCenterX - pathLength / 2 + t;
      y = artboardCenterY + waveOffset;
    } else {
      x = artboardCenterX + waveOffset;
      y = artboardCenterY - pathLength / 2 + t;
    }
    
    const randomX = (Math.random() - 0.5) * 2 * (config.gridXRandomization || 0);
    const randomY = (Math.random() - 0.5) * 2 * (config.gridYRandomization || 0);
    
    // Always apply position offsets additively
    const positionOffsetX = shape.transform?.x || 0;
    const positionOffsetY = shape.transform?.y || 0;
    const finalX = x + randomX + positionOffsetX;
    const finalY = y + randomY + positionOffsetY;
    
    shape.transform.x = finalX;
    shape.transform.y = finalY;
    
    return shape;
  });
}

/**
 * Apply ellipse distribution to shapes
 */
export function applyEllipseDistribution(
  shapes: any[],
  config: DistributionConfig,
  canvasCenter = { x: 0, y: 0 },
  artboardBounds?: { x: number; y: number; width: number; height: number }
): any[] {
  if (!config.enabled || config.pattern !== 'ellipse') return shapes;
  
  const xRadiusRange = config.ellipseXRadius || [80, 120];
  const yRadiusRange = config.ellipseYRadius || [80, 120];
  const ringCount = config.ellipseRingCount || 1;
  const ringSpacing = config.ellipseRingSpacing || 'even';
  const rotation = (config.ellipseRotation || 0) * (Math.PI / 180);
  const rotationAlignment = config.ellipseRotationAlignment || 'uniform';
  const alignToRing = config.ellipseAlignToRing || false;
  const flipInward = config.ellipseFlipInward || false;
  const additionalRotation = (config.ellipseAdditionalRotation || 0) * (Math.PI / 180);
  const shapeRotationMode = config.ellipseShapeRotationMode || 'none';
  const rotationFixed = (config.ellipseRotationFixed || 0) * (Math.PI / 180);
  const rotationRange = config.ellipseRotationRange || [0, 360];
  const rotationIncrementalStart = (config.ellipseRotationIncrementalStart || 0) * (Math.PI / 180);
  const rotationIncrementalStep = (config.ellipseRotationIncrementalStep || 10) * (Math.PI / 180);
  
  const artboardCenterX = artboardBounds 
    ? artboardBounds.x + artboardBounds.width / 2 
    : canvasCenter.x;
  const artboardCenterY = artboardBounds 
    ? artboardBounds.y + artboardBounds.height / 2 
    : canvasCenter.y;
  
  const totalShapes = shapes.length;
  
  // Calculate descending arithmetic sequence for smooth distribution
  // Formula: a = (N + R×(R-1)/2) / R
  // Example: 50 shapes, 4 rings -> a = (50 + 6)/4 = 14 -> [14, 13, 12, 11]
  const startingCount = Math.round((totalShapes + ringCount * (ringCount - 1) / 2) / ringCount);
  const ringAllocations: number[] = [];
  
  for (let i = 0; i < ringCount; i++) {
    ringAllocations[i] = Math.max(0, startingCount - i);
  }
  
  // Adjust for rounding errors by distributing any difference
  const currentTotal = ringAllocations.reduce((sum, count) => sum + count, 0);
  const difference = totalShapes - currentTotal;
  
  if (difference !== 0) {
    // Distribute the difference across rings to match exactly
    for (let i = 0; i < Math.abs(difference); i++) {
      const ringIndex = i % ringCount;
      ringAllocations[ringIndex] += difference > 0 ? 1 : -1;
    }
  }
  
  // Group shapes by ring using the calculated allocations
  const shapesByRing: any[][] = [];
  for (let i = 0; i < ringCount; i++) {
    shapesByRing[i] = [];
  }
  
  let shapeIndex = 0;
  for (let ringIdx = 0; ringIdx < ringCount; ringIdx++) {
    for (let i = 0; i < ringAllocations[ringIdx]; i++) {
      if (shapeIndex < totalShapes) {
        shapesByRing[ringIdx].push({ shape: shapes[shapeIndex], originalIndex: shapeIndex });
        shapeIndex++;
      }
    }
  }
  
  return shapes.map((shape, index) => {
    // Find which ring this shape belongs to
    let ringIndex = 0;
    let cumulativeCount = 0;
    for (let i = 0; i < ringCount; i++) {
      if (index < cumulativeCount + ringAllocations[i]) {
        ringIndex = i;
        break;
      }
      cumulativeCount += ringAllocations[i];
    }
    
    // Calculate index within the ring
    cumulativeCount = 0;
    for (let i = 0; i < ringIndex; i++) {
      cumulativeCount += ringAllocations[i];
    }
    const indexInRing = index - cumulativeCount;
    
    // Calculate angle step based on actual number of shapes in this ring
    const shapesInThisRing = shapesByRing[ringIndex].length;
    const angleStep = (2 * Math.PI) / shapesInThisRing;
    const angle = indexInRing * angleStep;
    
    let ringProgress;
    if (ringSpacing === 'progressive') {
      ringProgress = Math.pow(ringIndex / Math.max(ringCount - 1, 1), 1.5);
    } else {
      ringProgress = ringIndex / Math.max(ringCount - 1, 1);
    }
    
    const xRadius = xRadiusRange[0] + (xRadiusRange[1] - xRadiusRange[0]) * ringProgress;
    const yRadius = yRadiusRange[0] + (yRadiusRange[1] - yRadiusRange[0]) * ringProgress;
    
    const shapeRotation = rotationAlignment === 'progressive' 
      ? rotation * Math.pow(ringIndex / Math.max(ringCount - 1, 1), 1.5)
      : rotation;
    
    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);
    const cosRot = Math.cos(shapeRotation);
    const sinRot = Math.sin(shapeRotation);
    
    const x = artboardCenterX + (xRadius * cosAngle * cosRot - yRadius * sinAngle * sinRot);
    const y = artboardCenterY + (xRadius * cosAngle * sinRot + yRadius * sinAngle * cosRot);
    
    const randomX = (Math.random() - 0.5) * 2 * (config.gridXRandomization || 0);
    const randomY = (Math.random() - 0.5) * 2 * (config.gridYRandomization || 0);
    
    // Always apply position offsets additively
    const positionOffsetX = shape.transform?.x || 0;
    const positionOffsetY = shape.transform?.y || 0;
    const finalX = x + randomX + positionOffsetX;
    const finalY = y + randomY + positionOffsetY;
    
    shape.transform.x = finalX;
    shape.transform.y = finalY;
    
    // Apply align-to-ring tangent rotation
    let finalRotation = 0;
    if (alignToRing) {
      // Calculate tangent angle at this point on the ellipse
      // For an ellipse, the tangent angle is perpendicular to the normal
      // The normal direction from center to point is angle, so tangent is angle + 90°
      let tangentAngle = angle + shapeRotation + Math.PI / 2;
      
      // Flip inward reverses the tangent direction
      if (flipInward) {
        tangentAngle += Math.PI;
      }
      
      // Add additional rotation offset
      finalRotation = tangentAngle + additionalRotation;
    }
    
    // Apply shape rotation mode on top of align-to-ring rotation
    if (shapeRotationMode === 'fixed') {
      finalRotation += rotationFixed;
    } else if (shapeRotationMode === 'range') {
      const minRot = rotationRange[0] * (Math.PI / 180);
      const maxRot = rotationRange[1] * (Math.PI / 180);
      finalRotation += minRot + Math.random() * (maxRot - minRot);
    } else if (shapeRotationMode === 'incremental') {
      finalRotation += rotationIncrementalStart + (index * rotationIncrementalStep);
    } else if (shapeRotationMode === 'series') {
      const items = config.ellipseShapeRotationSeriesItems ?? [];
      const selection = config.ellipseShapeRotationSeriesSelection ?? 'sequential';
      const exhaustion = config.ellipseShapeRotationSeriesExhaustion ?? 'cycle';
      const driver = config.ellipseShapeRotationSeriesDriver ?? 'shape-index';
      const setRepIdx = config._setRepIndex ?? 0;
      const seriesVal = resolveScalarSeries(items, selection, exhaustion, driver, index, setRepIdx);
      if (!isNaN(seriesVal)) finalRotation += seriesVal * (Math.PI / 180);
    }
    
    // Convert rotation back to degrees and apply to shape
    shape.transform.rotation = finalRotation * (180 / Math.PI);
    
    return shape;
  });
}

/**
 * Apply spiral distribution to shapes
 */
export function applySpiralDistribution(
  shapes: any[],
  config: DistributionConfig,
  canvasCenter = { x: 0, y: 0 },
  artboardBounds?: { x: number; y: number; width: number; height: number }
): any[] {
  if (!config.enabled || config.pattern !== 'spiral') return shapes;
  
  const turnCount = config.spiralTurnCount || 3;
  const spacingMode = config.spiralSpacingMode || 'linear';
  const direction = config.spiralDirection || 'clockwise';
  const startAngle = (config.spiralStartAngle || 0) * (Math.PI / 180);
  const tightness = config.spiralTightness || 1.0;
  
  const artboardCenterX = artboardBounds 
    ? artboardBounds.x + artboardBounds.width / 2 
    : canvasCenter.x;
  const artboardCenterY = artboardBounds 
    ? artboardBounds.y + artboardBounds.height / 2 
    : canvasCenter.y;
  
  const totalShapes = shapes.length;
  const totalAngle = turnCount * 2 * Math.PI;
  const maxRadius = Math.min(
    artboardBounds?.width || 400, 
    artboardBounds?.height || 400
  ) / 2 * 0.8;
  
  return shapes.map((shape, index) => {
    const progress = index / Math.max(totalShapes - 1, 1);
    
    const angle = direction === 'clockwise'
      ? startAngle + (progress * totalAngle)
      : startAngle - (progress * totalAngle);
    
    let radius;
    if (spacingMode === 'logarithmic') {
      radius = maxRadius * Math.pow(progress, tightness);
    } else {
      radius = maxRadius * progress * tightness;
    }
    
    const x = artboardCenterX + radius * Math.cos(angle);
    const y = artboardCenterY + radius * Math.sin(angle);
    
    const randomX = (Math.random() - 0.5) * 2 * (config.gridXRandomization || 0);
    const randomY = (Math.random() - 0.5) * 2 * (config.gridYRandomization || 0);
    
    // Always apply position offsets additively
    const positionOffsetX = shape.transform?.x || 0;
    const positionOffsetY = shape.transform?.y || 0;
    const finalX = x + randomX + positionOffsetX;
    const finalY = y + randomY + positionOffsetY;
    
    shape.transform.x = finalX;
    shape.transform.y = finalY;
    
    return shape;
  });
}

/**
 * Apply auto-distribution to shapes
 */
export function applyAutoDistribution(
  shapes: any[],
  config: DistributionConfig,
  canvasCenter = { x: 0, y: 0 },
  artboardBounds?: { x: number; y: number; width: number; height: number }
): any[] {
  if (!config.enabled || config.pattern !== 'auto-distribute') return shapes;
  
  const xCount = config.autoDistributeXCount || 3;
  const yCount = config.autoDistributeYCount || 3;
  
  const artboardCenterX = artboardBounds 
    ? artboardBounds.x + artboardBounds.width / 2 
    : canvasCenter.x;
  const artboardCenterY = artboardBounds 
    ? artboardBounds.y + artboardBounds.height / 2 
    : canvasCenter.y;
  
  const width = artboardBounds?.width || 400;
  const height = artboardBounds?.height || 400;
  
  const xSpacing = width / (xCount + 1);
  const ySpacing = height / (yCount + 1);
  
  const totalPositions = xCount * yCount;
  const actualShapeCount = shapes.length;
  
  return shapes.map((shape, index) => {
    const positionIndex = index % totalPositions;
    const row = Math.floor(positionIndex / xCount);
    const col = positionIndex % xCount;
    
    const x = artboardCenterX - width / 2 + (col + 1) * xSpacing;
    const y = artboardCenterY - height / 2 + (row + 1) * ySpacing;
    
    const randomX = (Math.random() - 0.5) * 2 * (config.gridXRandomization || 0);
    const randomY = (Math.random() - 0.5) * 2 * (config.gridYRandomization || 0);
    
    // Always apply position offsets additively
    const positionOffsetX = shape.transform?.x || 0;
    const positionOffsetY = shape.transform?.y || 0;
    const finalX = x + randomX + positionOffsetX;
    const finalY = y + randomY + positionOffsetY;
    
    shape.transform.x = finalX;
    shape.transform.y = finalY;
    
    return shape;
  });
}