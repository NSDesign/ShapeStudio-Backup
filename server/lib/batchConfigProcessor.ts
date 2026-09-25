/**
 * Batch Config Processor for Server-side Shape Generation
 * Ported from client/src/hooks/useShapeEditor.ts
 */

import { Shape } from './shapeGenerator';
import { SmartDistributionAlgorithm } from './distributionAlgorithm';
import { ColorUtils, generateColor, generateGradientColors } from './colorUtils';
import type { BatchConfigSettings, EchoSpreadConfig } from '../../shared/schema';
import { resolveFillPaletteColour } from '../../shared/fillPaletteAnchors';
import { DEFAULT_ECHO_SPREAD_CONFIG, DEFAULT_CTP_TARGET_CONFIG } from '../../shared/schema';
import { 
  calculateLinearAngle,
  calculateLinearCenterX,
  calculateLinearCenterY,
  calculateGradientScale,
  calculateConicCenterX,
  calculateConicCenterY,
  calculateRadialCenterX,
  calculateRadialCenterY,
  calculateDiamondCenterX,
  calculateDiamondCenterY
} from '../../shared/batchUtils';
import { harvestDestinationPoints, applyCopyToPointsDistribution } from '../../shared/copyToPointsUtils';
import {
  calculateBlur,
  calculateStrokeWidth,
  calculateFillOpacity,
  calculateStrokeOpacity,
  calculateSquiggleAmplitude,
  calculateSquiggleFrequency,
  calculateSquigglePhase,
  calculateSquiggleAlign,
  calculateSquiggleJitter,
  calculateSquiggleJitterSeed,
  calculateSquiggleNoise,
  calculateSquiggleNoiseFreq,
  calculateSquiggleSampleCount,
  calculateConicAngle,
  calculateDiamondAngle,
  calculateConstrainedSize,
  calculateWidth,
  calculateHeight,
  calculateDirectionalPosition,
  calculatePositionX,
  calculatePositionY,
  calculatePositionXY,
  calculateDropShadow,
  calculateOuterGlow,
  calculateInnerShadow,
  calculateInnerGlow,
  deriveEffectColor,
} from '../../shared/shapePropertyUtils';
import { 
  calculateEchoTransforms, 
  isEchoEnabled,
  shouldApplyEchoToShape,
  type AutoMotionContext,
  type AbsolutePositionContext
} from '../../shared/echoUtils';
import type { ShapeType, Point, DistributionSettings } from '../../client/src/lib/shapeTypes';
import { 
  applyGridDistribution, 
  applyWaveDistribution, 
  applyEllipseDistribution, 
  applySpiralDistribution, 
  applyAutoDistribution 
} from './distributionLayouts';
import { applyIncrementalPositionToShapes } from './positionModulationResolver';
import type { GenerationMetadata } from '../../shared/distributionTypes';
import { getEffectiveTranslateRange } from './artboardUtils';
import { extractLocalJitterConfig, extractGlobalJitterConfig, computeGlobalJitter, shapeIdToHash } from '../../shared/roughnessUtils';
import { type ShapeTypeGenMode, pickShapeType, buildFixedTypeList } from '../../shared/shapeTypeGenUtils';
import type { SupportedShapeType } from '../../shared/schema';

interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GenerationOptions {
  enabledShapeTypes?: ShapeType[];
  batchConfig: BatchConfigSettings;
  distributionEnabled?: boolean;
  scatterSettings?: {
    distribution: DistributionSettings;
    shapeSpecific?: Record<string, any>;
  };
  echoOverride?: {
    enabled: boolean;
    config?: EchoSpreadConfig;
  };
  shapeTypeGenMode?: ShapeTypeGenMode;
  shapeTypeWeights?: Partial<Record<string, number>>;
  shapeTypeFixedCounts?: Partial<Record<string, number>>;
  shapeTypeSequence?: string[];
}


/**
 * Main function to generate shapes with batch configuration
 * Returns both the generated shapes and metadata for tracking generation boundaries
 */
export function generateShapesWithBatchConfig(
  count: number,
  canvasBounds: CanvasBounds,
  options: GenerationOptions,
  generationContext?: {
    generationIndex: number;  // Which generation this is (0, 1, 2... for repetitions)
    startIndex: number;       // Cumulative index where this generation starts
    /** Pre-generated shapes keyed by set ID — used by copy-to-points to look up destination sets */
    destinationShapesMap?: Map<string, Shape[]>;
    /** batchConfig keyed by set ID — used by copy-to-points to read destination set's target config */
    destinationBatchConfigMap?: Map<string, any>;
  }
): { shapes: Shape[]; metadata: GenerationMetadata } {
  const enabledTypes = options.enabledShapeTypes || ['rectangle', 'circle', 'triangle'];
  const batchConfig = options.batchConfig;
  const scatterSettings = options.scatterSettings || { 
    distribution: { 
      pattern: 'random', 
      spacing: 50, 
      randomness: 0.3,
      rotation: 0,
      scale: 1,
      density: 0.5,
      avoidOverlap: false,
      respectBounds: true
    }
  };
  
  // For initial scatter, use SmartDistributionAlgorithm with settings from generation sets
  // The advanced distribution layouts will be applied afterward
  const useSmartDistribution = options.distributionEnabled !== false;

  if (enabledTypes.length === 0) {
    return {
      shapes: [],
      metadata: {
        generationId: `gen_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        generationIndex: generationContext?.generationIndex ?? 0,
        shapeCount: 0,
        startIndex: generationContext?.startIndex ?? 0
      }
    };
  }

  // Shape type generation control setup
  const genMode: ShapeTypeGenMode = (options.shapeTypeGenMode ?? 'random') as ShapeTypeGenMode;
  const genWeights = options.shapeTypeWeights;
  const genSequence = options.shapeTypeSequence as SupportedShapeType[] | undefined;
  const genFixedCounts = options.shapeTypeFixedCounts;

  let actualCount = count;
  let fixedTypeList: SupportedShapeType[] | null = null;
  if (genMode === 'fixed' && enabledTypes.length > 0) {
    fixedTypeList = buildFixedTypeList(enabledTypes as SupportedShapeType[], genFixedCounts as Partial<Record<SupportedShapeType, number>>);
    actualCount = fixedTypeList.length;
  }

  // Grid fill override: corners use the grid intersections, including outer edges.
  const isGridFill = batchConfig.distributionLayoutEnabled &&
                     batchConfig.distributionPattern === 'grid' &&
                     (batchConfig.gridFillEnabled ?? false) &&
                     genMode !== 'fixed';
  if (isGridFill) {
    const corners = batchConfig.cellConstraints?.enabled &&
                    batchConfig.cellConstraints?.renderMode === 'cell-corners' ? 1 : 0;
    const rows = Math.max(1, batchConfig.gridRows) + corners;
    const columns = Math.max(1, batchConfig.gridColumns) + corners;
    const gridCount = rows * columns;
    console.log(`🔲 [SERVER GRID FILL] Overriding count ${actualCount} → ${gridCount} (${rows}×${columns})`);
    actualCount = gridCount;
  }

  // Check if any positioning system is active
  const hasDistributionLayout = batchConfig.distributionLayoutEnabled;
  const hasShapeProperties = batchConfig.propertiesEnabled && batchConfig.shapePropertiesEnabled;
  const hasTransforms = batchConfig.transformsEnabled;
  const anyPositioningSystemActive = hasDistributionLayout || hasShapeProperties || hasTransforms;

  // Phase 1: Generate initial positions using scatter settings from generation sets (matching client)
  // Only use random scatter if NO positioning systems are active (fallback behavior)
  // Otherwise start with deterministic (0, 0) so positioning systems aren't polluted
  console.log(`🎲 [SERVER] Phase 1: Generating initial positions for ${actualCount} shapes (positioning systems active: ${anyPositioningSystemActive})`);
  const positions = anyPositioningSystemActive
    ? Array.from({ length: actualCount }, () => ({ x: 0, y: 0 }))
    : (useSmartDistribution 
        ? SmartDistributionAlgorithm.generatePositions(actualCount, canvasBounds, scatterSettings.distribution)
        : Array.from({ length: actualCount }, () => ({
            x: canvasBounds.x + (Math.random() - 0.5) * (canvasBounds.width * 0.8),
            y: canvasBounds.y + (Math.random() - 0.5) * (canvasBounds.height * 0.8)
          })));
  
  console.log(`✅ [SERVER] Phase 1: Generated ${positions.length} ${anyPositioningSystemActive ? 'deterministic (0,0)' : 'random scatter'} positions`);

  // Get set repetition index for Index Driver support
  const setRepIndex = generationContext?.generationIndex ?? 0;
  
  // Create shapes with initial positions
  const newShapes = positions.map((position, index) => {
    const randomType: SupportedShapeType = genMode === 'fixed'
      ? fixedTypeList![index % fixedTypeList!.length]
      : pickShapeType(genMode, enabledTypes as SupportedShapeType[], genWeights as Partial<Record<SupportedShapeType, number>>, genSequence, index);

    let shapeX = position.x;
    let shapeY = position.y;
    let polarAngleDeg: number | undefined = undefined;

    // Apply batch config position offsets if properties are enabled (additive to distribution position)
    // SKIP incremental positions if grid distribution is enabled - they'll be applied post-distribution
    const isGridDistribution = batchConfig.distributionLayoutEnabled && batchConfig.distributionPattern === 'grid';
    const skipIncrementalForGrid = isGridDistribution && 
                                   (batchConfig.xPositionMode === 'incremental' || 
                                    batchConfig.yPositionMode === 'incremental');

    if (batchConfig.propertiesEnabled && batchConfig.shapePropertiesEnabled &&
        (batchConfig.positionCoordSystem ?? 'cartesian') === 'polar') {
      // Polar mode: additive — add radial offset (relative to anchor) on top of distribution position
      const posResult = calculatePositionXY(batchConfig, index, canvasBounds.width, canvasBounds.height, positions.length, 0, setRepIndex, canvasBounds.x, canvasBounds.y);
      shapeX += posResult.x - posResult.anchorX;
      shapeY += posResult.y - posResult.anchorY;
      polarAngleDeg = posResult.angleDeg;
    } else if (batchConfig.propertiesEnabled && batchConfig.shapePropertiesEnabled && !skipIncrementalForGrid) {
      // Add position offsets from shape properties (additive, not replacement)
      shapeX += calculatePositionX(batchConfig, index, canvasBounds.width, canvasBounds.height, positions.length, 0, setRepIndex);
      shapeY += calculatePositionY(batchConfig, index, canvasBounds.width, canvasBounds.height, positions.length, 0, setRepIndex);
    } else if (batchConfig.propertiesEnabled && batchConfig.shapePropertiesEnabled && skipIncrementalForGrid) {
      // For grid distribution with incremental mode, apply non-incremental position modes only
      const xPosNoIncremental = batchConfig.xPositionMode === 'incremental' ? 0 : 
        calculatePositionX(batchConfig, index, canvasBounds.width, canvasBounds.height, positions.length, 0, setRepIndex);
      const yPosNoIncremental = batchConfig.yPositionMode === 'incremental' ? 0 :
        calculatePositionY(batchConfig, index, canvasBounds.width, canvasBounds.height, positions.length, 0, setRepIndex);
      shapeX += xPosNoIncremental;
      shapeY += yPosNoIncremental;
    }

    let calculatedWidth = calculateWidth(batchConfig, index, canvasBounds.width, canvasBounds.height, positions.length, setRepIndex);
    let calculatedHeight = calculateHeight(batchConfig, index, canvasBounds.width, canvasBounds.height, positions.length, setRepIndex);

    // Calculate constrained size based on mode
    const constrainedSize = calculateConstrainedSize(batchConfig, calculatedWidth, calculatedHeight);
    
    // If constraint mode is active (min/max/avg), use constrained size for BOTH dimensions
    const useConstrainedDimensions = batchConfig.sizeConstraintMode !== 'none';
    
    if (useConstrainedDimensions) {
      calculatedWidth = constrainedSize;
      calculatedHeight = constrainedSize;
    }
    
    // Create combined config matching client: batchConfig + scatterSettings
    const combinedConfig = {
      ...batchConfig,
      scatterSettings: scatterSettings,
      _shapeIndex: index,
      _setRepIndex: setRepIndex
    };
    
    // Pass combinedConfig to Shape constructor like client does
    const shape = new Shape(randomType, shapeX, shapeY, combinedConfig);
    
    // Apply size based on shape type (matching client logic)
    switch (randomType) {
      case 'rectangle':
      case 'rounded-rectangle':
        shape.width = calculatedWidth;
        shape.height = calculatedHeight;
        break;
      case 'square':
      case 'rounded-square':
        // Square always uses constrained size (even in 'none' mode, use calculated size)
        shape.width = constrainedSize;
        shape.height = constrainedSize;
        break;
      case 'circle':
        // True circle: uses ctx.arc in renderer — must stay circular, width drives diameter
        shape.radius = constrainedSize / 2;
        shape.width = constrainedSize;
        shape.height = constrainedSize;
        break;
      case 'spline-circle':
      case 'polygon':
      case 'star':
      case 'ring':
      case 'spline-ring':
      case 'triangle':
      case 'pentagon':
      case 'hexagon':
      case 'semicircle':
        // Point-based radius shapes: generate with width as diameter, then scale
        // y-coordinates after regeneration so the shape respects both width and height.
        shape.radius = calculatedWidth / 2;
        shape.width = calculatedWidth;
        shape.height = calculatedHeight;
        break;
      case 'ellipse':
      case 'spline-ellipse':
        shape.width = calculatedWidth;
        shape.height = calculatedHeight;
        break;
      // Lines and splines would go here if supported on server
      default:
        shape.width = calculatedWidth;
        shape.height = calculatedHeight;
    }

    // Regenerate points after size changes (required for all radius-based and point-based shapes)
    shape.regenerateShapePoints();

    // Normalize point-based radius shapes to exactly fill the target width × height
    // bounding box. Each shape type has its own natural bbox ratio after regeneration
    // (semicircle is 2R×R, equilateral triangle is ~1.73R×0.87R, hexagon is 2R×1.73R,
    // etc.), so a single scaleY=h/w correction is wrong for most of them. Instead:
    // measure the actual bbox, translate points so the bbox is centered at (0,0),
    // then scale x and y independently to match the target dimensions exactly.
    const isScalableRadiusShape = [
      'spline-circle', 'polygon', 'star', 'ring', 'spline-ring',
      'triangle', 'pentagon', 'hexagon', 'semicircle'
    ].includes(randomType);
    if (isScalableRadiusShape && (batchConfig.stretchShapeToDimensions ?? false) && shape.points.length > 0 && calculatedWidth > 0 && calculatedHeight > 0) {
      const xs = shape.points.map((p: { x: number; y: number }) => p.x);
      const ys = shape.points.map((p: { x: number; y: number }) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const actualW = maxX - minX;
      const actualH = maxY - minY;
      if (actualW > 0 && actualH > 0) {
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const sx = calculatedWidth / actualW;
        const sy = calculatedHeight / actualH;
        shape.points = shape.points.map((p: { x: number; y: number }) => ({
          x: (p.x - cx) * sx,
          y: (p.y - cy) * sy
        }));
      }
    }

    const isLineType = randomType === 'line' || randomType === 'line-vector';
    if (batchConfig.propertiesEnabled) {
      // Lines are never filled — skip fill logic entirely for them
      if (batchConfig.fillEnabled && !isLineType) {
        const shouldHaveFill = true; // Always fill when enabled
        
        if (!shouldHaveFill) {
          shape.properties.fillColor = 'transparent';
          shape.properties.fillOpacity = 0;
          shape.properties.gradient = undefined;
        } else {
          // Determine whether to use gradient based on fillStyleProbability
          // If fillSolidEnabled is false, treat solid fill probability as 0
          const effectiveSolidProbability = batchConfig.fillSolidEnabled !== false ? batchConfig.fillStyleProbability : 0;
          const useGradient = batchConfig.fillGradientEnabled && 
                             Math.random() * 100 < (100 - effectiveSolidProbability);
          
          if (useGradient) {
            // Determine stop count based on mode
            let stopCount: number;
            if (batchConfig.fillGradientStopsMode === 'fixed') {
              stopCount = batchConfig.fillGradientStopsCount ?? 3;
            } else {
              const [minStops, maxStops] = batchConfig.fillGradientStopsRange || [2, 5];
              stopCount = Math.floor(minStops + Math.random() * (maxStops - minStops + 1));
            }
            
            let gradientColors = generateGradientColors(
              batchConfig.fillGradientColorMode,
              stopCount,
              batchConfig.fillGradientColorRange,
              batchConfig.fillGradientColorPalette,
              batchConfig.fillGradientColorDefine,
              index,
              batchConfig.fillGradientColorRangeFlip
            );

            // Apply reverse if enabled
            if (batchConfig.fillGradientStopsReverse) {
              gradientColors = gradientColors.reverse();
            }

            // Calculate stop positions based on distribution mode
            let stops = gradientColors.map((color, i) => {
              let offset: number;
              if (batchConfig.fillGradientStopDistribution === 'random' && stopCount > 2) {
                // Random distribution (keep first and last at 0 and 1)
                if (i === 0) {
                  offset = 0;
                } else if (i === stopCount - 1) {
                  offset = 1;
                } else {
                  offset = Math.random();
                }
              } else {
                // Even distribution (default)
                offset = stopCount === 1 ? 0 : i / (stopCount - 1);
              }
              return { offset, color };
            });

            // Sort by offset for random distribution to maintain proper order
            if (batchConfig.fillGradientStopDistribution === 'random') {
              stops = stops.sort((a, b) => a.offset - b.offset);
            }

            // Determine gradient type based on settings
            let gradientType: 'linear' | 'radial' | 'conic' | 'diamond' = 'linear';
            
            // Check if shape-matching mode is enabled
            const useShapeMatching = batchConfig.fillGradientTypeDirectionEnabled && 
                                    batchConfig.fillGradientMatchShape;
            
            if (useShapeMatching) {
              // Match gradient type to shape type - deterministic override of probabilities
              const roundShapes = ['circle', 'ellipse', 'star', 'blob', 'ring', 'spline-circle', 'spline-ring', 'spline-star', 'spline-blob'];
              const isRoundShape = roundShapes.includes(randomType);
              
              if (isRoundShape) {
                // For round shapes: ONLY use radial or conic, never linear
                // Use relative probabilities to determine which one, but exclude linear entirely
                const radialProb = batchConfig.fillGradientRadialProbability;
                const conicProb = batchConfig.fillGradientConicProbability;
                const totalRoundProb = radialProb + conicProb;
                
                if (totalRoundProb > 0) {
                  const random = Math.random() * totalRoundProb;
                  gradientType = random < radialProb ? 'radial' : 'conic';
                } else {
                  // If both radial and conic are 0, default to radial (never linear)
                  gradientType = 'radial';
                }
              } else {
                // For geometric shapes: use linear or diamond (both suit angular shapes)
                const linearProb = batchConfig.fillGradientLinearProbability;
                const diamondProb = batchConfig.fillGradientDiamondProbability ?? 0;
                const totalGeomProb = linearProb + diamondProb;
                
                if (totalGeomProb > 0) {
                  const rand2 = Math.random() * totalGeomProb;
                  gradientType = rand2 < linearProb ? 'linear' : 'diamond';
                } else {
                  gradientType = 'linear';
                }
              }
            } else {
              // Use probability-based selection (original behavior)
              const diamondProb = batchConfig.fillGradientDiamondProbability ?? 0;
              const totalProb = batchConfig.fillGradientLinearProbability + 
                              batchConfig.fillGradientRadialProbability + 
                              batchConfig.fillGradientConicProbability +
                              diamondProb;
              const rand = Math.random() * totalProb;
              
              if (rand < batchConfig.fillGradientLinearProbability) {
                gradientType = 'linear';
              } else if (rand < batchConfig.fillGradientLinearProbability + batchConfig.fillGradientRadialProbability) {
                gradientType = 'radial';
              } else if (rand < batchConfig.fillGradientLinearProbability + batchConfig.fillGradientRadialProbability + batchConfig.fillGradientConicProbability) {
                gradientType = 'conic';
              } else {
                gradientType = 'diamond';
              }
            }

            // Build gradient object with type-specific parameters
            const gradientObj: {
              type: 'linear' | 'radial' | 'conic' | 'diamond';
              stops: { offset: number; color: string }[];
              angle?: number;
              radialCenterX?: number;
              radialCenterY?: number;
              conicAngle?: number;
              conicCenterX?: number;
              conicCenterY?: number;
              diamondCenterX?: number;
              diamondCenterY?: number;
              diamondAngle?: number;
              linearCenterX?: number;
              linearCenterY?: number;
              linearScale?: number;
              radialScale?: number;
              diamondScale?: number;
              diamondScaleEdgeMode?: 'streak' | 'repeat';
            } = {
              type: gradientType,
              stops: stops
            };
            
            // Add linear-specific parameters when gradient type is linear
            if (gradientType === 'linear') {
              gradientObj.angle = calculateLinearAngle(batchConfig, index, setRepIndex);
              const linearPosition = (batchConfig as any).fillGradientLinearCenter ?? 'center';
              if (linearPosition === 'center') {
                gradientObj.linearCenterX = 50;
                gradientObj.linearCenterY = 50;
              } else if (linearPosition === 'corners' || linearPosition === 'midpoints') {
                const points: [number, number][] = [];
                if (linearPosition === 'corners') {
                  const corners = (batchConfig as any).fillGradientLinearCorners ??
                    { topLeft: true, topRight: true, bottomLeft: true, bottomRight: true };
                  if (corners.topLeft) points.push([0, 0]);
                  if (corners.topRight) points.push([100, 0]);
                  if (corners.bottomLeft) points.push([0, 100]);
                  if (corners.bottomRight) points.push([100, 100]);
                } else {
                  const midpoints = (batchConfig as any).fillGradientLinearMidpoints ??
                    { top: true, right: true, bottom: true, left: true };
                  if (midpoints.top) points.push([50, 0]);
                  if (midpoints.right) points.push([100, 50]);
                  if (midpoints.bottom) points.push([50, 100]);
                  if (midpoints.left) points.push([0, 50]);
                }
                const selectionMode = (batchConfig as any).fillGradientLinearSelectionMode ?? 'random';
                const pick = points.length
                  ? (selectionMode === 'cycle'
                    ? points[index % points.length]
                    : points[Math.floor(Math.random() * points.length)])
                  : [50, 50] as [number, number];
                [gradientObj.linearCenterX, gradientObj.linearCenterY] = pick;
              } else {
                gradientObj.linearCenterX = calculateLinearCenterX(batchConfig, index, setRepIndex);
                gradientObj.linearCenterY = calculateLinearCenterY(batchConfig, index, setRepIndex);
              }
              gradientObj.linearScale = calculateGradientScale(batchConfig, 'Linear', index, setRepIndex);
            }
            
            // Add radial-specific parameters when gradient type is radial
            if (gradientType === 'radial') {
              gradientObj.radialCenterX = calculateRadialCenterX(batchConfig, index, setRepIndex);
              gradientObj.radialCenterY = calculateRadialCenterY(batchConfig, index, setRepIndex);
              gradientObj.radialScale = calculateGradientScale(batchConfig, 'Radial', index, setRepIndex);
            }
            
            // Add conic-specific parameters when gradient type is conic
            if (gradientType === 'conic') {
              gradientObj.conicAngle = calculateConicAngle(batchConfig, index, setRepIndex);
              gradientObj.conicCenterX = calculateConicCenterX(batchConfig, index, setRepIndex);
              gradientObj.conicCenterY = calculateConicCenterY(batchConfig, index, setRepIndex);
            }

            // Add diamond-specific parameters when gradient type is diamond
            if (gradientType === 'diamond') {
              const diamondPosition = (batchConfig as any).fillGradientDiamondCenter ?? 'center';
              if (diamondPosition === 'center') {
                gradientObj.diamondCenterX = 50;
                gradientObj.diamondCenterY = 50;
              } else if (diamondPosition === 'corners' || diamondPosition === 'midpoints') {
                const positions: [number, number][] = [];
                if (diamondPosition === 'corners') {
                  const corners = (batchConfig as any).fillGradientDiamondCorners ??
                    { topLeft: true, topRight: true, bottomLeft: true, bottomRight: true };
                  if (corners.topLeft) positions.push([0, 0]);
                  if (corners.topRight) positions.push([100, 0]);
                  if (corners.bottomLeft) positions.push([0, 100]);
                  if (corners.bottomRight) positions.push([100, 100]);
                } else {
                  const midpoints = (batchConfig as any).fillGradientDiamondMidpoints ??
                    { top: true, right: true, bottom: true, left: true };
                  if (midpoints.top) positions.push([50, 0]);
                  if (midpoints.right) positions.push([100, 50]);
                  if (midpoints.bottom) positions.push([50, 100]);
                  if (midpoints.left) positions.push([0, 50]);
                }
                const selectionMode = (batchConfig as any).fillGradientDiamondSelectionMode ?? 'random';
                const pick = positions.length
                  ? (selectionMode === 'cycle'
                    ? positions[index % positions.length]
                    : positions[Math.floor(Math.random() * positions.length)])
                  : [50, 50] as [number, number];
                [gradientObj.diamondCenterX, gradientObj.diamondCenterY] = pick;
              } else {
                gradientObj.diamondCenterX = calculateDiamondCenterX(batchConfig, index, setRepIndex);
                gradientObj.diamondCenterY = calculateDiamondCenterY(batchConfig, index, setRepIndex);
              }
              gradientObj.diamondAngle = calculateDiamondAngle(batchConfig, index, setRepIndex);
              gradientObj.diamondScale = calculateGradientScale(batchConfig, 'Diamond', index, setRepIndex);
              gradientObj.diamondScaleEdgeMode =
                (batchConfig as any).fillGradientDiamondScaleEdgeMode ?? 'streak';
            }
            
            shape.properties.gradient = gradientObj;

            shape.properties.fillColor = gradientColors[0];
            // Apply fill opacity based on mode
            shape.properties.fillOpacity = calculateFillOpacity(batchConfig, index, setRepIndex);
          } else {
            const fillColor = batchConfig.colorHarmonyEnabled &&
              !(batchConfig.fillColorMode === 'palette' && batchConfig.fillColorPaletteBehavior === 'blend')
              ? ColorUtils.generateHarmonyColor({
                  enabled: batchConfig.colorHarmonyEnabled,
                  harmonyType: batchConfig.harmonyType,
                  baseColor: batchConfig.baseColor,
                  hueVariance: batchConfig.hueVariance,
                  saturationRange: batchConfig.saturationRange,
                  lightnessRange: batchConfig.lightnessRange,
                  monochromaticSettings: batchConfig.monochromaticSettings,
                  analogousSettings: batchConfig.analogousSettings,
                  complementarySettings: batchConfig.complementarySettings,
                  triadicSettings: batchConfig.triadicSettings,
                  splitComplementarySettings: batchConfig.splitComplementarySettings,
                  tetradicSettings: batchConfig.tetradicSettings
                })
              : batchConfig.fillColorMode === 'palette' && batchConfig.fillColorPaletteBehavior === 'blend'
              ? resolveFillPaletteColour(
                  batchConfig.fillColorPalette,
                  index,
                  positions.length,
                  batchConfig.fillColorPaletteDistribution ?? 'even',
                  batchConfig.fillColorPaletteAssignments ?? [],
                  batchConfig.fillColorPaletteInterpolation ?? 'linear',
                )
              : generateColor(
                  batchConfig.fillColorMode,
                  batchConfig.fillColorRange,
                  batchConfig.fillColorPalette,
                  batchConfig.fillColorDefine,
                  index,
                  batchConfig.fillColorMode === 'range' ? {
                    saturationRange: ((batchConfig as any).fillColorSaturationMode ?? 'range') === 'fixed'
                      ? [(batchConfig as any).fillColorSaturationFixed ?? 75, (batchConfig as any).fillColorSaturationFixed ?? 75] as [number, number]
                      : batchConfig.fillColorSaturationRange,
                    lightnessRange: ((batchConfig as any).fillColorLightnessMode ?? 'range') === 'fixed'
                      ? [(batchConfig as any).fillColorLightnessFixed ?? 50, (batchConfig as any).fillColorLightnessFixed ?? 50] as [number, number]
                      : batchConfig.fillColorLightnessRange,
                    flip: batchConfig.fillColorRangeFlip
                  } : undefined
                );

            shape.properties.gradient = undefined;
            shape.properties.fillColor = fillColor;
            // Apply fill opacity based on mode
            shape.properties.fillOpacity = calculateFillOpacity(batchConfig, index, setRepIndex);
          }
        }
      } else {
        shape.properties.fillColor = 'transparent';
        shape.properties.fillOpacity = 0;
        shape.properties.gradient = undefined;
      }

      // Open Curve Fill Probability: suppress fill on open curves below threshold
      const openCurveFillProbability = batchConfig.openCurveFillProbability ?? 100;
      if (openCurveFillProbability < 100) {
        const openCurveTypes = ['bezier', 'cubic', 'smooth-spline'];
        if (openCurveTypes.includes(randomType) && shape.closed === false) {
          if (Math.random() * 100 >= openCurveFillProbability) {
            shape.properties.openCurveFilled = false;
          }
        }
      }

      if (batchConfig.strokeEnabled) {
        const shouldHaveStroke = Math.random() * 100 < batchConfig.strokeProbability;
        if (!shouldHaveStroke) {
          shape.properties.strokeColor = 'transparent';
          shape.properties.strokeOpacity = 0;
          shape.properties.strokeWidth = 0;
        } else {
          // Apply stroke width using helper function that supports all modes (range/define/incremental)
          // Only if strokeWidthEnabled is true, otherwise use a default
          if (batchConfig.strokeWidthEnabled !== false) {
            if ((batchConfig.strokeWidthMode as string) === 'parameterised') {
              shape.properties.strokeWidth = batchConfig.strokeWidthDefine ?? 3;
              shape.strokeProfile = {
                profileType: (batchConfig as any).strokeProfileType ?? 'wave',
                profileFrequency: (batchConfig as any).strokeProfileFrequency ?? 2,
                profilePhaseOffset: (batchConfig as any).strokeProfilePhaseOffset ?? 0,
                profileScale: (batchConfig as any).strokeProfileScale ?? 0.5,
              };
            } else {
              shape.properties.strokeWidth = calculateStrokeWidth(batchConfig, index, setRepIndex);
              shape.strokeProfile = undefined;
            }
          } else {
            shape.properties.strokeWidth = 1; // Default stroke width when disabled
            shape.strokeProfile = undefined;
          }

          // Apply stroke pattern
          const pat = (batchConfig as any).strokePattern ?? 'none';
          shape.strokePattern = pat;
          if (pat === 'dash') {
            shape.strokeDashLength = (batchConfig as any).strokeDashLength ?? 10;
            shape.strokeDashGap = (batchConfig as any).strokeDashGap ?? 6;
          } else if (pat === 'dot') {
            shape.strokeDotSpacing = (batchConfig as any).strokeDotSpacing ?? 8;
          } else if (pat === 'squiggle') {
            shape.strokeSquiggleAmplitude  = calculateSquiggleAmplitude(batchConfig, index, setRepIndex);
            shape.strokeSquiggleFrequency  = calculateSquiggleFrequency(batchConfig, index, setRepIndex);
            shape.strokeSquigglePhase      = calculateSquigglePhase(batchConfig, index, setRepIndex);
            shape.strokeSquiggleAlign      = calculateSquiggleAlign(batchConfig, index, setRepIndex);
            shape.strokeSquiggleAbs        = (batchConfig as any).strokeSquiggleAbs  ?? false;
            shape.strokeSquiggleFlip       = (batchConfig as any).strokeSquiggleFlip ?? false;
            const sqPerturbType = (batchConfig as any).strokeSquigglePerturbType ?? 'jitter';
            shape.strokeSquiggleJitter     = sqPerturbType === 'jitter' ? calculateSquiggleJitter(batchConfig, index, setRepIndex) : 0;
            shape.strokeSquiggleJitterSeed = calculateSquiggleJitterSeed(batchConfig, index, setRepIndex);
            shape.strokeSquiggleNoise      = sqPerturbType === 'noise' ? calculateSquiggleNoise(batchConfig, index, setRepIndex) : 0;
            shape.strokeSquiggleNoiseFreq  = calculateSquiggleNoiseFreq(batchConfig, index, setRepIndex);
            shape.strokeSquiggleJitterMode = (batchConfig as any).strokeSquiggleJitterDir ?? 'normal';
            shape.strokeSquiggleSampleCount = calculateSquiggleSampleCount(batchConfig);
            shape.strokeSquiggleSmoothCurves = (batchConfig as any).strokeSquiggleSmoothCurves !== false;
          }

          // Apply stroke opacity based on mode
          if ((batchConfig.strokeOpacityMode as string) === 'match-fill') {
            shape.properties.strokeOpacity = (shape.properties as any).fillOpacity;
          } else {
            shape.properties.strokeOpacity = calculateStrokeOpacity(batchConfig, index, setRepIndex);
          }

          // Apply stroke color
          if ((batchConfig.strokeColorMode as string) === 'match-fill') {
            // Take hue from fill colour; apply sat/light from controls (or match-fill)
            const fillC = shape.properties.gradient
              ? shape.properties.gradient.stops[Math.floor(shape.properties.gradient.stops.length / 2)]?.color ?? (shape.properties as any).fillColor
              : (shape.properties as any).fillColor;
            const fillHex = (fillC && fillC !== 'transparent' && fillC !== 'none') ? fillC : '#808080';
            const fHsl = ColorUtils.hexToHSL(fillHex); // server: h 0-360, s 0-100, l 0-100
            const satMode = (batchConfig as any).strokeColorSaturationMode ?? 'range';
            const lightMode = (batchConfig as any).strokeColorLightnessMode ?? 'range';
            // Sat/light ranges already 0-100; hslToHex also expects 0-100
            const sat = satMode === 'match-fill'
              ? fHsl.s
              : satMode === 'fixed'
              ? ((batchConfig as any).strokeColorSaturationFixed ?? 80)
              : (batchConfig.strokeColorSaturationRange?.[0] ?? 60) +
                  Math.random() * ((batchConfig.strokeColorSaturationRange?.[1] ?? 100) - (batchConfig.strokeColorSaturationRange?.[0] ?? 60));
            const light = lightMode === 'match-fill'
              ? fHsl.l
              : lightMode === 'fixed'
              ? ((batchConfig as any).strokeColorLightnessFixed ?? 40)
              : (batchConfig.strokeColorLightnessRange?.[0] ?? 20) +
                  Math.random() * ((batchConfig.strokeColorLightnessRange?.[1] ?? 60) - (batchConfig.strokeColorLightnessRange?.[0] ?? 20));
            shape.properties.strokeColor = ColorUtils.hslToHex({ h: fHsl.h, s: sat, l: light });
          } else if (batchConfig.strokeColorEnabled !== false) {
            // Resolve sat/lightness ranges — substitute fill HSL components when match-fill mode is set
            let satRange = batchConfig.strokeColorSaturationRange;
            let lightRange = batchConfig.strokeColorLightnessRange;
            const satMode = (batchConfig as any).strokeColorSaturationMode ?? 'range';
            const lightMode = (batchConfig as any).strokeColorLightnessMode ?? 'range';
            if (satMode === 'fixed') satRange = [(batchConfig as any).strokeColorSaturationFixed ?? 80, (batchConfig as any).strokeColorSaturationFixed ?? 80] as [number, number];
            if (lightMode === 'fixed') lightRange = [(batchConfig as any).strokeColorLightnessFixed ?? 40, (batchConfig as any).strokeColorLightnessFixed ?? 40] as [number, number];
            if ((satMode === 'match-fill' || lightMode === 'match-fill') && batchConfig.strokeColorMode === 'range') {
              const fillHex = (shape.properties as any).fillColor ?? '#808080';
              const fHsl = ColorUtils.hexToHSL(fillHex);
              // hexToHSL returns s and l in 0–1 range; sat/lightness ranges expect 0–100
              if (satMode === 'match-fill') satRange = [Math.round(fHsl.s * 100), Math.round(fHsl.s * 100)] as [number, number];
              if (lightMode === 'match-fill') lightRange = [Math.round(fHsl.l * 100), Math.round(fHsl.l * 100)] as [number, number];
            }
            const strokeColor = generateColor(
              batchConfig.strokeColorMode as 'range' | 'define' | 'palette' | 'series',
              batchConfig.strokeColorRange,
              batchConfig.strokeColorPalette,
              batchConfig.strokeColorDefine,
              index,
              batchConfig.strokeColorMode === 'range' ? {
                saturationRange: satRange,
                lightnessRange: lightRange,
                flip: batchConfig.strokeColorRangeFlip
              } : undefined
            );
            shape.properties.strokeColor = strokeColor;
          } else {
            shape.properties.strokeColor = '#000000'; // Default to black when disabled
          }
        }
      } else {
        shape.properties.strokeColor = 'transparent';
        shape.properties.strokeOpacity = 0;
        shape.properties.strokeWidth = 0;
      }

      // Stroke only on unfilled shapes — suppress stroke on any shape that has fill
      if ((batchConfig as any).strokeOnlyUnfilled) {
        const hasFill = (shape.properties as any).fillColor !== 'transparent' &&
                        (shape.properties as any).fillColor !== 'none' &&
                        ((shape.properties as any).fillOpacity ?? 1) > 0;
        if (hasFill) {
          shape.properties.strokeColor = 'transparent';
          shape.properties.strokeOpacity = 0;
          shape.properties.strokeWidth = 0;
        }
      }

      // Handle blur properties - check parent Shape Effects first
      shape.properties.blurType = batchConfig.blurType ?? 'box';
      if (batchConfig.shapeEffectsEnabled && batchConfig.blurEnabled) {
        const shouldHaveBlur = Math.random() * 100 < batchConfig.blurProbability;
        if (shouldHaveBlur) {
          // Apply blur using helper function that supports all modes (range/define/incremental)
          shape.properties.blurRadius = calculateBlur(batchConfig, index, setRepIndex);
        } else {
          shape.properties.blurRadius = 0;
        }
      } else {
        // Shape Effects or Blur section disabled - ensure no blur
        shape.properties.blurRadius = 0;
      }

      // Handle drop shadow, outer glow, inner shadow, inner glow
      if (batchConfig.shapeEffectsEnabled) {
        const fillColor = typeof (shape.properties as any).fillColor === 'string' && (shape.properties as any).fillColor !== 'none'
          ? (shape.properties as any).fillColor
          : '#808080';
        (shape.properties as any).dropShadow = calculateDropShadow(batchConfig, index, setRepIndex, fillColor);
        (shape.properties as any).outerGlow = calculateOuterGlow(batchConfig, index, setRepIndex, fillColor);
        (shape.properties as any).innerShadow = calculateInnerShadow(batchConfig, index, setRepIndex, fillColor);
        (shape.properties as any).innerGlow = calculateInnerGlow(batchConfig, index, setRepIndex, fillColor);
      }

      // Apply shape render mode
      shape.shapeRenderMode = batchConfig.shapeRenderMode ?? 'smooth';
      shape.shapeRenderSegments = batchConfig.shapeRenderSegments ?? 32;
      shape.shapeRenderDotSize = batchConfig.shapeRenderDotSize ?? 4;
      shape.renderModeOverride = batchConfig.renderModeOverride ?? {
        enabled: false, tension: 1, resample: { enabled: false, count: 32 }
      };
      (shape as any).wireConfig = batchConfig.wireConfig ?? undefined;

      // Apply local jitter config (stored on shape for render-time use)
      if (batchConfig.localJitterEnabled) {
        shape.localJitterConfig = extractLocalJitterConfig(batchConfig);
      } else {
        shape.localJitterConfig = undefined;
      }

      if (batchConfig.transformsEnabled) {
        let originX = 0;
        let originY = 0;
        
        if (batchConfig.transformOriginMode === 'define') {
          // Define mode with sub-modes (fixed, range, incremental)
          const defineMode = batchConfig.transformOriginDefineMode || 'fixed';
          
          if (defineMode === 'fixed') {
            // Fixed mode: use custom coordinates
            originX = batchConfig.transformOriginX || 0;
            originY = batchConfig.transformOriginY || 0;
          } else if (defineMode === 'range') {
            // Range mode: random X/Y from ranges
            const xMin = batchConfig.transformOriginXMin ?? -100;
            const xMax = batchConfig.transformOriginXMax ?? 100;
            const yMin = batchConfig.transformOriginYMin ?? -100;
            const yMax = batchConfig.transformOriginYMax ?? 100;
            originX = xMin + Math.random() * (xMax - xMin);
            originY = yMin + Math.random() * (yMax - yMin);
          } else if (defineMode === 'incremental') {
            // Incremental mode: start + increment * index + modulation
            const xStart = batchConfig.transformOriginXStartValue ?? 0;
            const xIncrement = batchConfig.transformOriginXIncrement ?? 10;
            const yStart = batchConfig.transformOriginYStartValue ?? 0;
            const yIncrement = batchConfig.transformOriginYIncrement ?? 10;
            
            let xIncrementAmount = xIncrement * index;
            let yIncrementAmount = yIncrement * index;
            
            // Apply modulation if enabled
            if (batchConfig.transformOriginXModulationEnabled && batchConfig.transformOriginXModulationValue > 0) {
              const m = batchConfig.transformOriginXModulationValue;
              xIncrementAmount = ((xIncrementAmount % m) + m) % m;
            }
            if (batchConfig.transformOriginYModulationEnabled && batchConfig.transformOriginYModulationValue > 0) {
              const m = batchConfig.transformOriginYModulationValue;
              yIncrementAmount = ((yIncrementAmount % m) + m) % m;
            }
            
            originX = xStart + xIncrementAmount;
            originY = yStart + yIncrementAmount;
          }
        } else if (batchConfig.transformOriginMode === 'predefined-artboard') {
          // Use predefined artboard alignment points
          const artboardX = canvasBounds.x;
          const artboardY = canvasBounds.y;
          
          switch (batchConfig.transformOriginPredefined) {
            case 'center':
              originX = artboardX + canvasBounds.width / 2;
              originY = artboardY + canvasBounds.height / 2;
              break;
            case 'top-left':
              originX = artboardX;
              originY = artboardY;
              break;
            case 'top-center':
              originX = artboardX + canvasBounds.width / 2;
              originY = artboardY;
              break;
            case 'top-right':
              originX = artboardX + canvasBounds.width;
              originY = artboardY;
              break;
            case 'center-left':
              originX = artboardX;
              originY = artboardY + canvasBounds.height / 2;
              break;
            case 'center-right':
              originX = artboardX + canvasBounds.width;
              originY = artboardY + canvasBounds.height / 2;
              break;
            case 'bottom-left':
              originX = artboardX;
              originY = artboardY + canvasBounds.height;
              break;
            case 'bottom-center':
              originX = artboardX + canvasBounds.width / 2;
              originY = artboardY + canvasBounds.height;
              break;
            case 'bottom-right':
              originX = artboardX + canvasBounds.width;
              originY = artboardY + canvasBounds.height;
              break;
          }
        } else if (batchConfig.transformOriginMode === 'current-shape') {
          // Current shape mode: use predefined shape alignment points based on shape's own bounds
          const shapeBounds = shape.getBounds();
          const shapeX = shapeBounds.x;
          const shapeY = shapeBounds.y;
          
          switch (batchConfig.transformOriginPredefined) {
            case 'center':
              originX = shapeX + shapeBounds.width / 2;
              originY = shapeY + shapeBounds.height / 2;
              break;
            case 'top-left':
              originX = shapeX;
              originY = shapeY;
              break;
            case 'top-center':
              originX = shapeX + shapeBounds.width / 2;
              originY = shapeY;
              break;
            case 'top-right':
              originX = shapeX + shapeBounds.width;
              originY = shapeY;
              break;
            case 'center-left':
              originX = shapeX;
              originY = shapeY + shapeBounds.height / 2;
              break;
            case 'center-right':
              originX = shapeX + shapeBounds.width;
              originY = shapeY + shapeBounds.height / 2;
              break;
            case 'bottom-left':
              originX = shapeX;
              originY = shapeY + shapeBounds.height;
              break;
            case 'bottom-center':
              originX = shapeX + shapeBounds.width / 2;
              originY = shapeY + shapeBounds.height;
              break;
            case 'bottom-right':
              originX = shapeX + shapeBounds.width;
              originY = shapeY + shapeBounds.height;
              break;
          }
        } else if (batchConfig.transformOriginMode === 'shape-reference') {
          // Shape reference mode: reference another shape's position and use its anchor point
          const referenceType = batchConfig.transformOriginShapeReference || 'current';
          let referencedShape: Shape | undefined;
          
          if (referenceType === 'current') {
            referencedShape = shape;
          } else if (referenceType === 'previous') {
            referencedShape = index > 0 ? finalShapes[index - 1] : undefined;
          } else if (referenceType === 'next') {
            referencedShape = index < finalShapes.length - 1 ? finalShapes[index + 1] : undefined;
          } else if (referenceType === 'specific') {
            const specificIndex = batchConfig.transformOriginShapeIndex ?? 0;
            referencedShape = finalShapes[specificIndex];
          }
          
          // If referenced shape exists, calculate origin based on its bounds and anchor point
          if (referencedShape) {
            const refBounds = referencedShape.getBounds();
            const refWidth = refBounds.width;
            const refHeight = refBounds.height;
            const refX = refBounds.x;
            const refY = refBounds.y;
            
            switch (batchConfig.transformOriginShapeAnchor) {
              case 'center':
                originX = refX + refWidth / 2;
                originY = refY + refHeight / 2;
                break;
              case 'top-left':
                originX = refX;
                originY = refY;
                break;
              case 'top-center':
                originX = refX + refWidth / 2;
                originY = refY;
                break;
              case 'top-right':
                originX = refX + refWidth;
                originY = refY;
                break;
              case 'center-left':
                originX = refX;
                originY = refY + refHeight / 2;
                break;
              case 'center-right':
                originX = refX + refWidth;
                originY = refY + refHeight / 2;
                break;
              case 'bottom-left':
                originX = refX;
                originY = refY + refHeight;
                break;
              case 'bottom-center':
                originX = refX + refWidth / 2;
                originY = refY + refHeight;
                break;
              case 'bottom-right':
                originX = refX + refWidth;
                originY = refY + refHeight;
                break;
            }
          } else {
            // Fallback if referenced shape doesn't exist - use current shape's center
            const shapeBounds = shape.getBounds();
            originX = shapeBounds.x + shapeBounds.width / 2;
            originY = shapeBounds.y + shapeBounds.height / 2;
            console.warn(`⚠️ [TRANSFORM ORIGIN] Shape ${index}: Referenced shape not found (type=${referenceType}), falling back to current shape center`);
          }
        }
        
        const shapeRelativeX = shape.transform.x - originX;
        const shapeRelativeY = shape.transform.y - originY;

        let positionDeltaX = 0;
        if (batchConfig.xTransformMode === 'range') {
          const [minTransX, maxTransX] = getEffectiveTranslateRange('x', batchConfig, canvasBounds);
          positionDeltaX = minTransX + Math.random() * (maxTransX - minTransX);
        } else if (batchConfig.xTransformMode === 'value') {
          positionDeltaX = batchConfig.xTransformValue || 0;
        } else if (batchConfig.xTransformMode === 'incremental') {
          let incrementAmount = (batchConfig.xTransformIncrement || 0) * index;
          const startValue = batchConfig.xTransformStartValue ?? 0;
          if (batchConfig.xTransformModulationEnabled && batchConfig.xTransformModulationValue > 0) {
            const m = batchConfig.xTransformModulationValue;
            incrementAmount = ((incrementAmount % m) + m) % m;
          }
          positionDeltaX = startValue + incrementAmount;
        }

        let positionDeltaY = 0;
        if (batchConfig.yTransformMode === 'range') {
          const [minTransY, maxTransY] = getEffectiveTranslateRange('y', batchConfig, canvasBounds);
          positionDeltaY = minTransY + Math.random() * (maxTransY - minTransY);
        } else if (batchConfig.yTransformMode === 'value') {
          positionDeltaY = batchConfig.yTransformValue || 0;
        } else if (batchConfig.yTransformMode === 'incremental') {
          let incrementAmount = (batchConfig.yTransformIncrement || 0) * index;
          const startValue = batchConfig.yTransformStartValue ?? 0;
          if (batchConfig.yTransformModulationEnabled && batchConfig.yTransformModulationValue > 0) {
            const m = batchConfig.yTransformModulationValue;
            incrementAmount = ((incrementAmount % m) + m) % m;
          }
          positionDeltaY = startValue + incrementAmount;
        }

        let scaleX = shape.transform.scaleX;
        let scaleY = shape.transform.scaleY;
        
        if (batchConfig.maintainScaleAspectRatio) {
          if (batchConfig.scaleXMode === 'range') {
            const [minScale, maxScale] = batchConfig.scaleXRange;
            const randomScale = (minScale + Math.random() * (maxScale - minScale)) / 100;
            scaleX = Math.max(0.1, randomScale);
            scaleY = Math.max(0.1, randomScale);
          } else if (batchConfig.scaleXMode === 'value') {
            const baseScale = (batchConfig.scaleXValue || 100) / 100;
            scaleX = Math.max(0.1, baseScale);
            scaleY = Math.max(0.1, baseScale);
          } else if (batchConfig.scaleXMode === 'incremental') {
            const incrementAmount = ((batchConfig.scaleXIncrement || 0) / 100) * index;
            const startScale = (batchConfig.scaleXStartValue ?? 100) / 100;
            const finalScale = startScale + incrementAmount;
            scaleX = Math.max(0.1, finalScale);
            scaleY = Math.max(0.1, finalScale);
          }
        } else {
          if (batchConfig.scaleXMode === 'range') {
            const [minScaleX, maxScaleX] = batchConfig.scaleXRange;
            const randomScale = (minScaleX + Math.random() * (maxScaleX - minScaleX)) / 100;
            scaleX = Math.max(0.1, randomScale);
          } else if (batchConfig.scaleXMode === 'value') {
            const baseScale = (batchConfig.scaleXValue || 100) / 100;
            scaleX = Math.max(0.1, baseScale);
          } else if (batchConfig.scaleXMode === 'incremental') {
            const incrementAmount = ((batchConfig.scaleXIncrement || 0) / 100) * index;
            const startScale = (batchConfig.scaleXStartValue ?? 100) / 100;
            const finalScale = startScale + incrementAmount;
            scaleX = Math.max(0.1, finalScale);
          }

          if (batchConfig.scaleYMode === 'range') {
            const [minScaleY, maxScaleY] = batchConfig.scaleYRange;
            const randomScale = (minScaleY + Math.random() * (maxScaleY - minScaleY)) / 100;
            scaleY = Math.max(0.1, randomScale);
          } else if (batchConfig.scaleYMode === 'value') {
            const baseScale = (batchConfig.scaleYValue || 100) / 100;
            scaleY = Math.max(0.1, baseScale);
          } else if (batchConfig.scaleYMode === 'incremental') {
            const incrementAmount = ((batchConfig.scaleYIncrement || 0) / 100) * index;
            const startScale = (batchConfig.scaleYStartValue ?? 100) / 100;
            const finalScale = startScale + incrementAmount;
            scaleY = Math.max(0.1, finalScale);
          }
        }

        let rotation = 0;
        if (batchConfig.rotationMode === 'range') {
          const [minRot, maxRot] = batchConfig.rotationRange;
          rotation = minRot + Math.random() * (maxRot - minRot);
        } else if (batchConfig.rotationMode === 'value') {
          rotation = batchConfig.rotationValue || 0;
        } else if (batchConfig.rotationMode === 'incremental') {
          let incrementAmount = (batchConfig.rotationIncrement || 0) * index;
          const startValue = batchConfig.rotationStartValue ?? 0;
          if (batchConfig.rotationModulationEnabled && batchConfig.rotationModulation > 0) {
            const m = batchConfig.rotationModulation;
            incrementAmount = ((incrementAmount % m) + m) % m;
          }
          rotation = startValue + incrementAmount;
        }

        const scaledRelativeX = shapeRelativeX * scaleX;
        const scaledRelativeY = shapeRelativeY * scaleY;
        
        const rotationRad = (rotation * Math.PI) / 180;
        const cosR = Math.cos(rotationRad);
        const sinR = Math.sin(rotationRad);
        const rotatedX = scaledRelativeX * cosR - scaledRelativeY * sinR;
        const rotatedY = scaledRelativeX * sinR + scaledRelativeY * cosR;
        
        shape.transform.x = originX + rotatedX + positionDeltaX;
        shape.transform.y = originY + rotatedY + positionDeltaY;
        shape.transform.scaleX = scaleX;
        shape.transform.scaleY = scaleY;
        shape.transform.rotation = rotation;

        if (batchConfig.skewXRange && batchConfig.skewYRange) {
          const [minSkewX, maxSkewX] = batchConfig.skewXRange;
          const [minSkewY, maxSkewY] = batchConfig.skewYRange;
          shape.transform.skewX = minSkewX + Math.random() * (maxSkewX - minSkewX);
          shape.transform.skewY = minSkewY + Math.random() * (maxSkewY - minSkewY);
        }

        if (batchConfig.rotationRandomizationScale > 0) {
          const randomVariation = (Math.random() * 2 - 1) * 30;
          const scaledVariation = randomVariation * (batchConfig.rotationRandomizationScale / 100);
          
          const relX = shape.transform.x - originX;
          const relY = shape.transform.y - originY;
          
          const newRotation = shape.transform.rotation + scaledVariation;
          
          const totalRotationRad = (newRotation * Math.PI) / 180;
          const cosTotal = Math.cos(totalRotationRad);
          const sinTotal = Math.sin(totalRotationRad);
          
          const oldRotationRad = (shape.transform.rotation * Math.PI) / 180;
          const cosOld = Math.cos(oldRotationRad);
          const sinOld = Math.sin(oldRotationRad);
          
          const unrotatedX = relX * cosOld + relY * sinOld;
          const unrotatedY = -relX * sinOld + relY * cosOld;
          
          const newRelX = unrotatedX * cosTotal - unrotatedY * sinTotal;
          const newRelY = unrotatedX * sinTotal + unrotatedY * cosTotal;
          
          shape.transform.x = originX + newRelX;
          shape.transform.y = originY + newRelY;
          shape.transform.rotation = newRotation;
        }
      }
    }

    // Rotate shape to face its polar direction — independent of transformsEnabled
    if ((batchConfig.positionRotateToDirection ?? false) && polarAngleDeg !== undefined) {
      shape.transform.rotation += polarAngleDeg;
    }

    // Apply blend modes or compositing operations based on probabilities
    if (batchConfig.blendModeEnabled && batchConfig.enabledBlendModes) {
      const enabledModes = Object.entries(batchConfig.enabledBlendModes);
      if (enabledModes.length > 0) {
        const totalWeight = enabledModes.reduce((sum, [_, weight]) => sum + (weight as number), 0);
        if (totalWeight > 0) {
          const random = Math.random() * totalWeight;
          let cumulative = 0;
          
          for (const [mode, weight] of enabledModes) {
            cumulative += (weight as number);
            if (random < cumulative) {
              shape.properties.blendMode = mode as any;
              break;
            }
          }
        }
      }
    } else if (batchConfig.compositingOperationsEnabled && batchConfig.enabledCompositingOperations) {
      const enabledOps = Object.entries(batchConfig.enabledCompositingOperations);
      if (enabledOps.length > 0) {
        const totalWeight = enabledOps.reduce((sum, [_, weight]) => sum + (weight as number), 0);
        if (totalWeight > 0) {
          const random = Math.random() * totalWeight;
          let cumulative = 0;
          
          for (const [op, weight] of enabledOps) {
            cumulative += (weight as number);
            if (random < cumulative) {
              shape.properties.blendMode = op as any;
              break;
            }
          }
        }
      }
    }

    return shape;
  });

  // Phase 2: Apply distribution layouts ONLY if explicitly enabled
  let finalShapes = newShapes;
  
  console.log(`📍 [SERVER] Phase 2 Check: distributionLayoutEnabled=${batchConfig.distributionLayoutEnabled}, pattern=${batchConfig.distributionPattern}`);
  
  if (batchConfig.distributionLayoutEnabled) {
    const distributionConfig = {
      enabled: batchConfig.distributionLayoutEnabled,
      pattern: batchConfig.distributionPattern,
      gridRows: batchConfig.gridRows,
      gridColumns: batchConfig.gridColumns,
      gridCreationOrder: batchConfig.gridCreationOrder,
      gridHorizontalDirection: batchConfig.gridHorizontalDirection,
      gridVerticalDirection: batchConfig.gridVerticalDirection,
      gridStartX: batchConfig.gridStartX,
      gridStartY: batchConfig.gridStartY,
      gridRowOffset: batchConfig.gridRowOffset,
      gridColumnOffset: batchConfig.gridColumnOffset,
      gridMarginEnabled: batchConfig.gridMarginEnabled,
      gridMarginMode:    batchConfig.gridMarginMode,
      gridMarginUnit:    batchConfig.gridMarginUnit,
      gridMarginTop:     batchConfig.gridMarginTop,
      gridMarginRight:   batchConfig.gridMarginRight,
      gridMarginBottom:  batchConfig.gridMarginBottom,
      gridMarginLeft:    batchConfig.gridMarginLeft,
      gridSortBy: batchConfig.gridSortBy,
      gridSortScope: batchConfig.gridSortScope,
      gridSortOrder: batchConfig.gridSortOrder,
      gridXRandomization: batchConfig.gridXRandomization,
      gridYRandomization: batchConfig.gridYRandomization,
      autoDistributeXCount: batchConfig.autoDistributeXCount,
      autoDistributeYCount: batchConfig.autoDistributeYCount,
      waveType: batchConfig.waveType,
      waveAmplitude: batchConfig.waveAmplitude,
      waveFrequency: batchConfig.waveFrequency,
      waveDirection: batchConfig.waveDirection,
      wavePhaseOffset: batchConfig.wavePhaseOffset,
      ellipseXRadius: batchConfig.ellipseXRadius,
      ellipseYRadius: batchConfig.ellipseYRadius,
      ellipseRingCount: batchConfig.ellipseRingCount,
      ellipseRingSpacing: batchConfig.ellipseRingSpacing,
      ellipseRotation: batchConfig.ellipseRotation,
      ellipseRotationAlignment: batchConfig.ellipseRotationAlignment,
      ellipseAlignToRing: batchConfig.ellipseAlignToRing,
      ellipseFlipInward: batchConfig.ellipseFlipInward,
      ellipseAdditionalRotation: batchConfig.ellipseAdditionalRotation,
      ellipseShapeRotationMode: batchConfig.ellipseShapeRotationMode,
      ellipseRotationFixed: batchConfig.ellipseRotationFixed,
      ellipseRotationRange: batchConfig.ellipseRotationRange,
      ellipseRotationIncrementalStart: batchConfig.ellipseRotationIncrementalStart,
      ellipseRotationIncrementalStep: batchConfig.ellipseRotationIncrementalStep,
      ellipseShapeRotationSeriesItems: batchConfig.ellipseShapeRotationSeriesItems,
      ellipseShapeRotationSeriesSelection: batchConfig.ellipseShapeRotationSeriesSelection,
      ellipseShapeRotationSeriesExhaustion: batchConfig.ellipseShapeRotationSeriesExhaustion,
      ellipseShapeRotationSeriesDriver: batchConfig.ellipseShapeRotationSeriesDriver,
      _setRepIndex: setRepIndex,
      spiralTurnCount: batchConfig.spiralTurnCount,
      spiralSpacingMode: batchConfig.spiralSpacingMode,
      spiralDirection: batchConfig.spiralDirection,
      spiralStartAngle: batchConfig.spiralStartAngle,
      spiralTightness: batchConfig.spiralTightness,
      tangentAlignment: batchConfig.tangentAlignment,
      segmentDistribution: batchConfig.segmentDistribution,
      reverseDirection: batchConfig.reverseDirection,
      cellConstraints: batchConfig.cellConstraints
    };

    // Default generation info for single batch
    const generationInfo = {
      currentGeneration: 0,
      totalGenerations: 1,
      shapesPerGeneration: newShapes.length
    };
    
    // Apply the appropriate distribution pattern
    if (batchConfig.copyToPointsEnabled) {
      const c2pCfg = batchConfig.copyToPointsConfig;
      const destMap = generationContext?.destinationShapesMap;
      const destConfigMap = generationContext?.destinationBatchConfigMap;
      const destShapes = c2pCfg?.destinationSetId ? destMap?.get(c2pCfg.destinationSetId) : undefined;
      const destBatchCfg = c2pCfg?.destinationSetId ? destConfigMap?.get(c2pCfg.destinationSetId) : undefined;
      const targetCfg = destBatchCfg?.copyToPointsTargetConfig ?? DEFAULT_CTP_TARGET_CONFIG;

      if (c2pCfg && destShapes && destShapes.length > 0) {
        const pts = harvestDestinationPoints(destShapes, targetCfg);
        if (pts.length > 0) {
          finalShapes = applyCopyToPointsDistribution(newShapes, pts, c2pCfg, targetCfg) as Shape[];
          console.log(`🔵 [SERVER] copy-to-points: placed ${finalShapes.length} shapes at ${pts.length} destination points`);
        } else {
          finalShapes = newShapes;
          console.warn(`🔵 [SERVER] copy-to-points: no points harvested from destination set "${c2pCfg.destinationSetId}"`);
        }
      } else {
        // No destination shapes available — shapes unchanged.
        // This occurs when the set is processed without multi-set context OR the destination
        // set's generationOrder is higher than this set's (meaning it hasn't been generated yet).
        // For Puppeteer-based server exports the client canvas handles copy-to-points automatically.
        finalShapes = newShapes;
        console.log(`🔵 [SERVER] copy-to-points: destination set "${c2pCfg?.destinationSetId ?? '?'}" not in context — shapes unchanged`);
      }
    } else if (batchConfig.distributionPattern === 'auto-distribute') {
      finalShapes = applyAutoDistribution(newShapes, distributionConfig, { x: 0, y: 0 }, canvasBounds);
      console.log(`🎯 [SERVER] Applied auto-distribute: ${batchConfig.autoDistributeXCount} shapes X, ${batchConfig.autoDistributeYCount} shapes Y`);
    } else if (batchConfig.distributionPattern === 'wave') {
      finalShapes = applyWaveDistribution(newShapes, distributionConfig, { x: 0, y: 0 }, canvasBounds);
      console.log(`🌊 [SERVER] Applied wave distribution: ${batchConfig.waveType} wave, amplitude=${batchConfig.waveAmplitude}px, frequency=${batchConfig.waveFrequency}`);
    } else if (batchConfig.distributionPattern === 'ellipse') {
      finalShapes = applyEllipseDistribution(newShapes, distributionConfig, { x: 0, y: 0 }, canvasBounds);
      console.log(`⭕ [SERVER] Applied ellipse distribution: ${batchConfig.ellipseRingCount} rings`);
    } else if (batchConfig.distributionPattern === 'spiral') {
      finalShapes = applySpiralDistribution(newShapes, distributionConfig, { x: 0, y: 0 }, canvasBounds);
      console.log(`🌀 [SERVER] Applied spiral distribution: ${batchConfig.spiralTurnCount} turns`);
    } else {
      // Apply grid distribution and get results with grid context
      const globalIndexOffset = generationContext?.startIndex ?? 0;
      const gridResults = applyGridDistribution(newShapes, distributionConfig, { x: 0, y: 0 }, generationInfo, canvasBounds, globalIndexOffset);
      console.log(`🎯 [SERVER] Applied grid distribution: ${batchConfig.gridRows}×${batchConfig.gridColumns}`);
      
      // Apply incremental position modulation after grid distribution (if enabled)
      const hasXIncremental = batchConfig.propertiesEnabled && batchConfig.shapePropertiesEnabled && 
                             batchConfig.xPositionMode === 'incremental';
      const hasYIncremental = batchConfig.propertiesEnabled && batchConfig.shapePropertiesEnabled && 
                             batchConfig.yPositionMode === 'incremental';
      
      if (hasXIncremental || hasYIncremental) {
        const xSettings = hasXIncremental ? {
          startValue: batchConfig.xPositionStartValue,
          increment: batchConfig.xPositionIncrement,
          modulationMode: batchConfig.xPositionModulationMode,
          modulationValue: batchConfig.xPositionModulationValue,
          resetPerBatch: batchConfig.incrementalResetPerBatch
        } : null;
        
        const ySettings = hasYIncremental ? {
          startValue: batchConfig.yPositionStartValue,
          increment: batchConfig.yPositionIncrement,
          modulationMode: batchConfig.yPositionModulationMode,
          modulationValue: batchConfig.yPositionModulationValue,
          resetPerBatch: batchConfig.incrementalResetPerBatch
        } : null;
        
        // Apply modulation with grid context (globalIndexOffset is already in batchIndex)
        finalShapes = applyIncrementalPositionToShapes(gridResults, xSettings, ySettings, {
          globalIndexOffset: generationContext?.startIndex ?? 0,
          gridColumns: batchConfig.gridColumns || 3
        });
        
        console.log(`📐 [SERVER] Applied incremental position modulation after grid distribution`);
      } else {
        // Extract shapes from grid results (no modulation needed)
        finalShapes = gridResults.map(r => r.shape);
      }
    }
  }

  // Echo/Motion Trails generation (Project A: Set-Level, Project B: Shape-Level)
  // Check for per-set echo override first, fall back to batchConfig.echoSpread
  const echoConfig = (options.echoOverride?.enabled && options.echoOverride?.config) 
    ? options.echoOverride.config 
    : (batchConfig.echoSpread ?? DEFAULT_ECHO_SPREAD_CONFIG);
  if (isEchoEnabled(echoConfig)) {
    const repIndex = generationContext?.generationIndex ?? 0;
    const echoScope = echoConfig.scope ?? 'set';
    const echoDriver = echoConfig.driver ?? 'setRepIndex';
    
    // Calculate set centroid for auto-motion mode (used for set-level)
    let setCentroidX = 0, setCentroidY = 0;
    if (finalShapes.length > 0) {
      finalShapes.forEach(shape => {
        setCentroidX += shape.transform.x;
        setCentroidY += shape.transform.y;
      });
      setCentroidX /= finalShapes.length;
      setCentroidY /= finalShapes.length;
    }
    
    const echoShapes: Shape[] = [];
    
    if (echoScope === 'set') {
      // SET-LEVEL: Use setRepIndex as driver, same echoes for all shapes in set
      const autoMotionContext: AutoMotionContext = {
        prevX: repIndex > 0 ? setCentroidX - 20 : undefined,
        prevY: repIndex > 0 ? setCentroidY - 20 : undefined,
        currentX: setCentroidX,
        currentY: setCentroidY
      };
      
      // Build absolute position context for set-level (use set centroid as shape position)
      const absolutePositionContext: AbsolutePositionContext | undefined = 
        echoConfig.directionMode === 'absolute-position' ? {
          shapeX: setCentroidX,
          shapeY: setCentroidY,
          artboardX: canvasBounds.x,
          artboardY: canvasBounds.y,
          artboardWidth: canvasBounds.width,
          artboardHeight: canvasBounds.height
        } : undefined;
      
      const echoTransforms = calculateEchoTransforms(echoConfig, repIndex, autoMotionContext, absolutePositionContext);
      
      if (echoTransforms.length > 0) {
        console.log(`👻 [SERVER ECHO SET] Generating ${echoTransforms.length} echo copies for ${finalShapes.length} shapes (set-level)`);
        
        finalShapes.forEach((originalShape, shapeIdx) => {
          echoTransforms.forEach((echo, echoIdx) => {
            const echoShape = originalShape.clone();
            
            (echoShape as any)._isEcho = true;
            (echoShape as any)._echoIndex = echoIdx;
            (echoShape as any)._sourceShapeId = originalShape.id;
            (echoShape as any)._echoScope = 'set';
            
            echoShape.transform.x += echo.offsetX;
            echoShape.transform.y += echo.offsetY;
            echoShape.properties.fillOpacity *= echo.opacity;
            echoShape.properties.strokeOpacity *= echo.opacity;
            
            if (echo.scale !== 1.0) {
              echoShape.transform.scaleX *= echo.scale;
              echoShape.transform.scaleY *= echo.scale;
            }
            if (echo.rotation !== 0) {
              echoShape.transform.rotation += echo.rotation;
            }
            if (echo.blur > 0) {
              echoShape.properties.blurRadius = echo.blur;
            }
            
            // Apply color shift if any shift values are non-zero
            if (echo.hueShift !== 0 || echo.saturationShift !== 0 || echo.lightnessShift !== 0) {
              const colorShift = { 
                enabled: true, 
                hue: echo.hueShift, 
                saturation: echo.saturationShift, 
                lightness: echo.lightnessShift 
              };
              if (echoShape.properties.fillColor && echoShape.properties.fillColor !== 'none') {
                echoShape.properties.fillColor = ColorUtils.applyHSLShift(echoShape.properties.fillColor, colorShift);
              }
              if (echoShape.properties.strokeColor && echoShape.properties.strokeColor !== 'none') {
                echoShape.properties.strokeColor = ColorUtils.applyHSLShift(echoShape.properties.strokeColor, colorShift);
              }
            }
            
            echoShape.properties.zIndex -= (echoIdx + 1) * 0.1;
            echoShapes.push(echoShape);
          });
        });
      }
    } else if (echoScope === 'shape') {
      // SHAPE-LEVEL: Each shape gets its own echo transforms based on shapeIndex
      console.log(`👻 [SERVER ECHO SHAPE] Generating shape-level echoes for ${finalShapes.length} shapes`);
      
      finalShapes.forEach((originalShape, shapeIdx) => {
        // Check ApplyTo filter - skip shapes that don't match the filter
        if (!shouldApplyEchoToShape(shapeIdx, originalShape.type, echoConfig.applyTo, shapeIdx)) {
          return; // Skip this shape
        }
        
        // For shape-level, use the appropriate driver
        const driverIndex = echoDriver === 'combined' 
          ? shapeIdx + (repIndex * finalShapes.length)
          : (echoDriver === 'shapeIndex' ? shapeIdx : repIndex);
        
        let autoMotionContext: AutoMotionContext | undefined;
        if (shapeIdx > 0 && echoConfig.directionMode === 'auto-motion') {
          const prevShape = finalShapes[shapeIdx - 1];
          autoMotionContext = {
            prevX: prevShape.transform.x,
            prevY: prevShape.transform.y,
            currentX: originalShape.transform.x,
            currentY: originalShape.transform.y
          };
        }
        
        // Build absolute position context for this shape
        const absolutePositionContext: AbsolutePositionContext | undefined = 
          echoConfig.directionMode === 'absolute-position' ? {
            shapeX: originalShape.transform.x,
            shapeY: originalShape.transform.y,
            artboardX: canvasBounds.x,
            artboardY: canvasBounds.y,
            artboardWidth: canvasBounds.width,
            artboardHeight: canvasBounds.height
          } : undefined;
        
        const echoTransforms = calculateEchoTransforms(echoConfig, driverIndex, autoMotionContext, absolutePositionContext);
        
        echoTransforms.forEach((echo, echoIdx) => {
          const echoShape = originalShape.clone();
          
          (echoShape as any)._isEcho = true;
          (echoShape as any)._echoIndex = echoIdx;
          (echoShape as any)._sourceShapeId = originalShape.id;
          (echoShape as any)._echoScope = 'shape';
          
          echoShape.transform.x += echo.offsetX;
          echoShape.transform.y += echo.offsetY;
          echoShape.properties.fillOpacity *= echo.opacity;
          echoShape.properties.strokeOpacity *= echo.opacity;
          
          if (echo.scale !== 1.0) {
            echoShape.transform.scaleX *= echo.scale;
            echoShape.transform.scaleY *= echo.scale;
          }
          if (echo.rotation !== 0) {
            echoShape.transform.rotation += echo.rotation;
          }
          if (echo.blur > 0) {
            echoShape.properties.blurRadius = echo.blur;
          }
          
          // Apply color shift if any shift values are non-zero
          if (echo.hueShift !== 0 || echo.saturationShift !== 0 || echo.lightnessShift !== 0) {
            const colorShift = { 
              enabled: true, 
              hue: echo.hueShift, 
              saturation: echo.saturationShift, 
              lightness: echo.lightnessShift 
            };
            if (echoShape.properties.fillColor && echoShape.properties.fillColor !== 'none') {
              echoShape.properties.fillColor = ColorUtils.applyHSLShift(echoShape.properties.fillColor, colorShift);
            }
            if (echoShape.properties.strokeColor && echoShape.properties.strokeColor !== 'none') {
              echoShape.properties.strokeColor = ColorUtils.applyHSLShift(echoShape.properties.strokeColor, colorShift);
            }
          }
          
          echoShape.properties.zIndex -= (echoIdx + 1) * 0.1;
          echoShapes.push(echoShape);
        });
      });
      
      console.log(`👻 [SERVER ECHO SHAPE] Created ${echoShapes.length} total echo shapes`);
    } else if (echoScope === 'both') {
      // BOTH SCOPE: Generate both set-level and shape-level echoes
      console.log(`👻 [SERVER ECHO BOTH] Generating combined set+shape level echoes`);
      
      // Phase 1: Set-level echoes (same transforms for all shapes in set)
      const autoMotionContextSet: AutoMotionContext = {
        prevX: repIndex > 0 ? setCentroidX - 20 : undefined,
        prevY: repIndex > 0 ? setCentroidY - 20 : undefined,
        currentX: setCentroidX,
        currentY: setCentroidY
      };
      
      const absolutePositionContextSet: AbsolutePositionContext | undefined = 
        echoConfig.directionMode === 'absolute-position' ? {
          shapeX: setCentroidX,
          shapeY: setCentroidY,
          artboardX: canvasBounds.x,
          artboardY: canvasBounds.y,
          artboardWidth: canvasBounds.width,
          artboardHeight: canvasBounds.height
        } : undefined;
      
      const setEchoTransforms = calculateEchoTransforms(echoConfig, repIndex, autoMotionContextSet, absolutePositionContextSet);
      
      if (setEchoTransforms.length > 0) {
        console.log(`👻 [SERVER ECHO BOTH-SET] Generating ${setEchoTransforms.length} set-level echoes`);
        
        finalShapes.forEach((originalShape, shapeIdx) => {
          setEchoTransforms.forEach((echo, echoIdx) => {
            const echoShape = originalShape.clone();
            
            (echoShape as any)._isEcho = true;
            (echoShape as any)._echoIndex = echoIdx;
            (echoShape as any)._sourceShapeId = originalShape.id;
            (echoShape as any)._echoScope = 'both-set';
            
            echoShape.transform.x += echo.offsetX;
            echoShape.transform.y += echo.offsetY;
            echoShape.properties.fillOpacity *= echo.opacity;
            echoShape.properties.strokeOpacity *= echo.opacity;
            
            if (echo.scale !== 1.0) {
              echoShape.transform.scaleX *= echo.scale;
              echoShape.transform.scaleY *= echo.scale;
            }
            if (echo.rotation !== 0) {
              echoShape.transform.rotation += echo.rotation;
            }
            if (echo.blur > 0) {
              echoShape.properties.blurRadius = echo.blur;
            }
            
            if (echo.hueShift !== 0 || echo.saturationShift !== 0 || echo.lightnessShift !== 0) {
              const colorShift = { 
                enabled: true, 
                hue: echo.hueShift, 
                saturation: echo.saturationShift, 
                lightness: echo.lightnessShift 
              };
              if (echoShape.properties.fillColor && echoShape.properties.fillColor !== 'none') {
                echoShape.properties.fillColor = ColorUtils.applyHSLShift(echoShape.properties.fillColor, colorShift);
              }
              if (echoShape.properties.strokeColor && echoShape.properties.strokeColor !== 'none') {
                echoShape.properties.strokeColor = ColorUtils.applyHSLShift(echoShape.properties.strokeColor, colorShift);
              }
            }
            
            echoShape.properties.zIndex -= (echoIdx + 1) * 0.1;
            echoShapes.push(echoShape);
          });
        });
      }
      
      // Phase 2: Shape-level echoes (per-shape individual echoes)
      console.log(`👻 [SERVER ECHO BOTH-SHAPE] Generating shape-level echoes for ${finalShapes.length} shapes`);
      
      finalShapes.forEach((originalShape, shapeIdx) => {
        if (!shouldApplyEchoToShape(shapeIdx, originalShape.type, echoConfig.applyTo)) {
          return;
        }
        
        // For combined driver, use both indices
        const driverIndex = echoDriver === 'combined' 
          ? shapeIdx + (repIndex * finalShapes.length)
          : (echoDriver === 'shapeIndex' ? shapeIdx : repIndex);
        
        let autoMotionContextShape: AutoMotionContext | undefined;
        if (shapeIdx > 0 && echoConfig.directionMode === 'auto-motion') {
          const prevShape = finalShapes[shapeIdx - 1];
          autoMotionContextShape = {
            prevX: prevShape.transform.x,
            prevY: prevShape.transform.y,
            currentX: originalShape.transform.x,
            currentY: originalShape.transform.y
          };
        }
        
        const absolutePositionContextShape: AbsolutePositionContext | undefined = 
          echoConfig.directionMode === 'absolute-position' ? {
            shapeX: originalShape.transform.x,
            shapeY: originalShape.transform.y,
            artboardX: canvasBounds.x,
            artboardY: canvasBounds.y,
            artboardWidth: canvasBounds.width,
            artboardHeight: canvasBounds.height
          } : undefined;
        
        const shapeEchoTransforms = calculateEchoTransforms(echoConfig, driverIndex, autoMotionContextShape, absolutePositionContextShape);
        
        shapeEchoTransforms.forEach((echo, echoIdx) => {
          const echoShape = originalShape.clone();
          
          (echoShape as any)._isEcho = true;
          (echoShape as any)._echoIndex = echoIdx;
          (echoShape as any)._sourceShapeId = originalShape.id;
          (echoShape as any)._echoScope = 'both-shape';
          
          echoShape.transform.x += echo.offsetX;
          echoShape.transform.y += echo.offsetY;
          echoShape.properties.fillOpacity *= echo.opacity;
          echoShape.properties.strokeOpacity *= echo.opacity;
          
          if (echo.scale !== 1.0) {
            echoShape.transform.scaleX *= echo.scale;
            echoShape.transform.scaleY *= echo.scale;
          }
          if (echo.rotation !== 0) {
            echoShape.transform.rotation += echo.rotation;
          }
          if (echo.blur > 0) {
            echoShape.properties.blurRadius = echo.blur;
          }
          
          if (echo.hueShift !== 0 || echo.saturationShift !== 0 || echo.lightnessShift !== 0) {
            const colorShift = { 
              enabled: true, 
              hue: echo.hueShift, 
              saturation: echo.saturationShift, 
              lightness: echo.lightnessShift 
            };
            if (echoShape.properties.fillColor && echoShape.properties.fillColor !== 'none') {
              echoShape.properties.fillColor = ColorUtils.applyHSLShift(echoShape.properties.fillColor, colorShift);
            }
            if (echoShape.properties.strokeColor && echoShape.properties.strokeColor !== 'none') {
              echoShape.properties.strokeColor = ColorUtils.applyHSLShift(echoShape.properties.strokeColor, colorShift);
            }
          }
          
          // Shape-level echoes have lower z-index offset to layer behind set-level
          echoShape.properties.zIndex -= (echoIdx + 1) * 0.05;
          echoShapes.push(echoShape);
        });
      });
      
      console.log(`👻 [SERVER ECHO BOTH] Created ${echoShapes.length} total echo shapes`);
    }
    
    if (echoShapes.length > 0) {
      console.log(`👻 [SERVER ECHO] Total: ${echoShapes.length} echo shapes`);
      // Insert echoes BEFORE original shapes (render behind)
      finalShapes = [...echoShapes, ...finalShapes];
    }
  }

  // Apply global jitter — offsets each shape's position and optionally rotation
  if (batchConfig.globalJitterEnabled) {
    const globalJitterCfg = extractGlobalJitterConfig(batchConfig);
    finalShapes.forEach((shape, idx) => {
      const { dx, dy, dz } = computeGlobalJitter(globalJitterCfg, idx, shape.id);
      shape.transform.x += dx;
      shape.transform.y += dy;
      if (dz !== 0) shape.transform.rotation = (shape.transform.rotation || 0) + dz;
    });
  }

  // Build generation metadata
  const metadata: GenerationMetadata = {
    generationId: `gen_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    generationIndex: generationContext?.generationIndex ?? 0,
    shapeCount: finalShapes.length,
    startIndex: generationContext?.startIndex ?? 0
  };

  return { shapes: finalShapes, metadata };
}
