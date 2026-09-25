import { BaseShape, ShapeType, Point, TangentHandle, Transform, ShapeProperties, ShapeGroup, BlendMode } from './shapeTypes';
import { 
  calculateLinearGradientCoords,
  calculateRadialGradientCoords,
  calculateConicGradientCoords,
  calculateDiamondGradientTexture
} from '@shared/gradientUtils';
import { applyLocalJitter, shapeIdToHash } from '@shared/roughnessUtils';
import { resolveScalarSeries } from '@shared/batchUtils';
import { drawContourWithConfig, DEFAULT_RENDER_MODE_OVERRIDE, drawWirePass, applyCatmullRom, applyNaturalCubicSpline } from '@shared/renderModeUtils';
import { drawShapeToContext, type ShapeRenderData } from '@shared/shapeRenderer';
import { blurShapePixels, type ShapeBlurType } from '@shared/shapeBlur';
import {
  generateCurvePatternPoints as computeCurvePatternPoints,
  resolvePatternSetting as _resolvePatternSetting,
  resolveCurveDirectionAngle as _resolveCurveDirectionAngle,
  rotateCurvePoints as _rotateCurvePoints,
  computeAutoResampleCount as _computeAutoResampleCount,
  resolvePatternResampleCount as _resolvePatternResampleCount,
  applyCurveLengthToPoints as _applyCurveLengthToPoints,
  buildPatternControls as _buildPatternControls,
} from '@shared/curveUtils';

// Utility function to normalize stroke cap probabilities
// Takes raw slider values (can be any positive numbers) and returns a selected stroke cap
function selectStrokeCap(probabilities: { round: number; square: number; butt: number }): 'round' | 'square' | 'butt' {
  const { round, square, butt } = probabilities;
  const total = round + square + butt;
  
  // Handle edge case where all probabilities are 0
  if (total === 0) {
    return 'butt'; // Default to butt if no probabilities set
  }
  
  // Normalize to percentages (0-100)
  const roundPercent = (round / total) * 100;
  const squarePercent = (square / total) * 100;
  // buttPercent is implicit (remaining percentage)
  
  // Generate random number 0-100 and select based on normalized ranges
  const rand = Math.random() * 100;
  
  if (rand < roundPercent) {
    return 'round';
  } else if (rand < roundPercent + squarePercent) {
    return 'square';
  } else {
    return 'butt';
  }
}

// addSmooth, resampleContour, drawContourWithConfig are imported from
// @shared/renderModeUtils — single canonical implementation shared across all renderers.

export class Shape {
  id: string;
  type: ShapeType;
  transform: Transform;
  properties: ShapeProperties;
  selected: boolean;
  points: Point[];
  sides?: number;
  radius?: number;
  innerRadius?: number;
  width?: number;
  height?: number;
  controlPoints?: Point[];
  tangentHandles?: TangentHandle[];
  smoothPoints?: boolean[];
  closed?: boolean;
  segments: number;
  renderType: 'polygon' | 'bezier' | 'cubic' | 'smooth' | 'roundRect';
  cornerRadius?: number;
  strokeCap?: 'round' | 'square' | 'butt';
  shapeRenderMode?: 'smooth' | 'sharp';
  shapeRenderSegments?: number;
  shapeRenderDotSize?: number;
  renderModeOverride?: import('@shared/renderModeUtils').RenderModeOverride;
  wireConfig?: import('@shared/renderModeUtils').WireConfig;
  localJitterConfig?: import('@shared/roughnessUtils').LocalJitterConfig;
  // Parameterised stroke width profile
  strokeProfile?: import('@shared/strokeUtils').StrokeProfile;
  // Stroke pattern
  strokePattern?: 'none' | 'dash' | 'dot' | 'squiggle';
  strokeDashLength?: number;
  strokeDashGap?: number;
  strokeDotSpacing?: number;
  strokeSquiggleAmplitude?: number;
  strokeSquiggleFrequency?: number;
  strokeSquigglePhase?: number;
  strokeSquiggleAlign?: number;
  strokeSquiggleAbs?: boolean;
  strokeSquiggleFlip?: boolean;
  strokeSquiggleJitter?: number;
  strokeSquiggleJitterSeed?: number;
  strokeSquiggleNoise?: number;
  strokeSquiggleNoiseFreq?: number;
  strokeSquiggleJitterMode?: 'normal' | 'xy';  // final rendered value (computed from strokeSquiggleJitterDir)
  strokeSquiggleSampleCount?: number;
  strokeSquiggleSmoothCurves?: boolean;

  constructor(type: ShapeType, x: number = 0, y: number = 0, batchConfig?: any) {
    this.id = `shape_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.type = type;
    this.transform = {
      x,
      y,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      skewX: 0,
      skewY: 0
    };
    
    // Initialize properties based on whether batch config is provided
    if (batchConfig && batchConfig.propertiesEnabled) {
      // Use minimal properties that batch config will override
      this.properties = this.generateMinimalProperties();
    } else {
      // Use full random properties for non-batch creation
      this.properties = this.generateRandomProperties();
    }
    
    this.selected = false;
    this.points = [];
    
    // Set proper defaults before shape initialization
    this.segments = this.getDefaultSegments();
    this.renderType = this.getDefaultRenderType();
    
    this.generateShapeData(batchConfig);
  }
  
  /**
   * Regenerate points when segments change for circles and ellipses
   */
  regeneratePointsFromSegments(): void {
    if (this.type === 'circle' && this.radius) {
      this.points = [];
      for (let i = 0; i < this.segments; i++) {
        const angle = (i / this.segments) * Math.PI * 2;
        this.points.push({
          x: Math.cos(angle) * this.radius,
          y: Math.sin(angle) * this.radius
        });
      }
    } else if (this.type === 'ellipse' && this.width && this.height) {
      this.points = [];
      const w = this.width / 2;
      const h = this.height / 2;
      for (let i = 0; i < this.segments; i++) {
        const angle = (i / this.segments) * Math.PI * 2;
        this.points.push({
          x: Math.cos(angle) * w,
          y: Math.sin(angle) * h
        });
      }
    }
  }

  /**
   * Check if the shape's geometry has been manually edited
   */
  hasEditedGeometry(): boolean {
    if (this.points.length === 0) return false;
    
    // Generate expected points based on shape type and compare
    switch (this.type) {
      case 'circle':
        if (!this.radius || this.points.length !== this.segments) return true;
        for (let i = 0; i < this.segments; i++) {
          const angle = (i / this.segments) * Math.PI * 2;
          const expectedX = Math.cos(angle) * this.radius;
          const expectedY = Math.sin(angle) * this.radius;
          const tolerance = 0.1;
          if (Math.abs(this.points[i].x - expectedX) > tolerance || 
              Math.abs(this.points[i].y - expectedY) > tolerance) {
            return true;
          }
        }
        return false;
        
      case 'ellipse':
        if (!this.width || !this.height || this.points.length !== this.segments) return true;
        const w = this.width / 2;
        const h = this.height / 2;
        for (let i = 0; i < this.segments; i++) {
          const angle = (i / this.segments) * Math.PI * 2;
          const expectedX = Math.cos(angle) * w;
          const expectedY = Math.sin(angle) * h;
          const tolerance = 0.1;
          if (Math.abs(this.points[i].x - expectedX) > tolerance || 
              Math.abs(this.points[i].y - expectedY) > tolerance) {
            return true;
          }
        }
        return false;
        
      case 'rectangle':
      case 'square':
        if (!this.width || !this.height || this.points.length !== 4) return true;
        const expectedRect = [
          { x: -this.width / 2, y: -this.height / 2 },
          { x: this.width / 2, y: -this.height / 2 },
          { x: this.width / 2, y: this.height / 2 },
          { x: -this.width / 2, y: this.height / 2 }
        ];
        for (let i = 0; i < 4; i++) {
          const tolerance = 0.1;
          if (Math.abs(this.points[i].x - expectedRect[i].x) > tolerance || 
              Math.abs(this.points[i].y - expectedRect[i].y) > tolerance) {
            return true;
          }
        }
        return false;
        
      default:
        // For other shape types (line, bezier, blob, etc.), assume they are always "edited"
        return true;
    }
  }

  static create(type: ShapeType, x: number = 0, y: number = 0): Shape {
    return new Shape(type, x, y);
  }

  private getDefaultSegments(): number {
    switch (this.type) {
      case 'circle':
      case 'ellipse':
        return 32; // Smooth circles/ellipses
      case 'ring':
        return 24; // Smooth rings
      case 'polygon':
      case 'star':
        return this.sides || 6;
      case 'rectangle':
      case 'square':
        return 4;
      default:
        return 8;
    }
  }

  private getDefaultRenderType(): 'polygon' | 'bezier' | 'cubic' | 'smooth' {
    switch (this.type) {
      case 'circle':
      case 'ellipse':
      case 'ring':
        return 'smooth'; // Use smooth curves for round shapes
      case 'cubic':
        return 'cubic';
      case 'bezier':
        return 'bezier';
      case 'blob':
        return 'bezier';
      default:
        return 'polygon'; // Use polygon for geometric shapes
    }
  }

  private generateMinimalProperties(): ShapeProperties {
    // Minimal properties for batch configuration to override
    return {
      fillColor: 'transparent',
      fillOpacity: 0,
      strokeColor: 'transparent',
      strokeWidth: 0,
      strokeOpacity: 0,
      blendMode: 'source-over' as BlendMode,
      zIndex: Date.now(),
      blurRadius: 0,
      gradient: undefined
    };
  }

  private generateRandomProperties(): ShapeProperties {
    const hue = Math.random() * 360;
    const saturation = 50 + Math.random() * 50;
    const lightness = 40 + Math.random() * 40;
    
    // Determine fill/stroke combination (ensure at least one is visible)
    const fillChance = Math.random();
    const strokeChance = Math.random();
    
    let hasFill = fillChance > 0.3; // 70% chance for fill
    let hasStroke = strokeChance > 0.5; // 50% chance for stroke
    
    // Ensure at least one is visible
    if (!hasFill && !hasStroke) {
      if (Math.random() > 0.5) {
        hasFill = true;
      } else {
        hasStroke = true;
      }
    }
    
    // 50% chance for gradient fill (only if has fill)
    const useGradient = hasFill && Math.random() > 0.5;
    let gradient = undefined;
    
    if (useGradient) {
      const gradientType = Math.random() > 0.5 ? 'linear' : 'radial';
      const stopCount = 2 + Math.floor(Math.random() * 3); // 2-4 color stops
      const stops = [];
      
      for (let i = 0; i < stopCount; i++) {
        const stopHue = (hue + (i * 60)) % 360;
        const stopSat = 40 + Math.random() * 60;
        const stopLight = 30 + Math.random() * 50;
        stops.push({
          offset: i / (stopCount - 1),
          color: `hsl(${stopHue}, ${stopSat}%, ${stopLight}%)`
        });
      }
      
      gradient = {
        type: gradientType as 'linear' | 'radial',
        stops
      };
    }
    
    const fillColor = hasFill ? `hsl(${hue}, ${saturation}%, ${lightness}%)` : 'transparent';
    const strokeColor = hasStroke ? `hsl(${(hue + 30) % 360}, ${saturation}%, ${Math.max(20, lightness - 20)}%)` : 'transparent';
    
    console.log(`🏗️ [SHAPE CONSTRUCTOR] generateRandomProperties: fillColor="${fillColor}", strokeColor="${strokeColor}" (non-batch creation) - ID: ${this.id}`);
    
    return {
      fillColor: fillColor,
      fillOpacity: hasFill ? 0.7 + Math.random() * 0.3 : 0,
      strokeColor: strokeColor,
      strokeWidth: hasStroke ? 1 + Math.random() * 4 : 0,
      strokeOpacity: hasStroke ? 0.8 + Math.random() * 0.2 : 0,
      blendMode: 'source-over' as BlendMode,
      zIndex: Date.now(), // Use timestamp for proper ordering
      blurRadius: 0, // No blur by default in random generation
      gradient: hasFill ? gradient : undefined
    };
  }

  private generateShapeData(batchConfig?: any): void {
    // Helper function to get values from batch config or use defaults
    const getRange = (configRange: [number, number] | undefined, defaultMin: number, defaultMax: number): number => {
      if (batchConfig?.propertiesEnabled && batchConfig?.shapePropertiesEnabled && batchConfig?.shapePropertiesDimensionsEnabled && configRange) {
        // Batch config handles its own randomization in the width/height calculation functions
        // Don't add additional randomization here
        const [min, max] = configRange;
        return min + (max - min) / 2; // Use center value, randomization handled elsewhere
      }
      return defaultMin + Math.random() * (defaultMax - defaultMin);
    };
    
    const getWidthHeight = (): { width: number; height: number } => {
      // For batch configuration, width and height are calculated based on mode
      if (batchConfig?.propertiesEnabled && batchConfig?.shapePropertiesEnabled && batchConfig?.shapePropertiesDimensionsEnabled) {
        let width = 100;
        let height = 100;
        
        // Width calculation based on mode
        if (batchConfig.widthMode === 'value' && batchConfig.widthValue !== undefined) {
          width = batchConfig.widthValue;
        } else if (batchConfig.widthMode === 'range' && batchConfig.widthRange) {
          const [min, max] = batchConfig.widthRange;
          width = (min + max) / 2; // Use center value
        } else if (batchConfig.widthMode === 'incremental') {
          width = batchConfig.widthStartValue || 100;
        }
        
        // Height calculation based on mode
        if (batchConfig.heightMode === 'value' && batchConfig.heightValue !== undefined) {
          height = batchConfig.heightValue;
        } else if (batchConfig.heightMode === 'range' && batchConfig.heightRange) {
          const [min, max] = batchConfig.heightRange;
          height = (min + max) / 2; // Use center value
        } else if (batchConfig.heightMode === 'incremental') {
          height = batchConfig.heightStartValue || 100;
        }
        
        return { width, height };
      }
      // For non-batch creation, use random values
      const width = 40 + Math.random() * 110;
      const height = 30 + Math.random() * 90;
      return { width, height };
    };
    
    const getRadius = (defaultMin: number = 25, defaultMax: number = 75): number => {
      const { width } = getWidthHeight();
      return width / 2; // Use width to determine radius
    };
    
    const getSegmentCount = (defaultMin: number, defaultMax: number): number => {
      // Check if polygon properties are specifically enabled
      if (batchConfig?.propertiesEnabled && batchConfig?.polygonPropertiesEnabled && batchConfig?.segmentCountRange) {
        const [min, max] = batchConfig.segmentCountRange;
        return Math.floor(min + Math.random() * (max - min + 1));
      }
      // Fallback to scatter settings for polygon-specific properties
      // Check both edgeCountRange (UI naming) and pointCountRange (schema naming)
      if (batchConfig?.scatterSettings?.shapeSpecific?.polygon) {
        const polygonSettings = batchConfig.scatterSettings.shapeSpecific.polygon as any;
        
        // Check for fixed mode with either edgeCountValue or pointCountValue
        if (polygonSettings.edgeCountMode === 'fixed' && polygonSettings.edgeCountValue !== undefined) {
          return polygonSettings.edgeCountValue;
        } else if (polygonSettings.pointCountMode === 'fixed' && polygonSettings.pointCountValue !== undefined) {
          return polygonSettings.pointCountValue;
        }
        
        // Check for range mode with either edgeCountRange or pointCountRange
        if (polygonSettings.edgeCountRange) {
          const [min, max] = polygonSettings.edgeCountRange;
          return Math.floor(min + Math.random() * (max - min + 1));
        } else if (polygonSettings.pointCountRange) {
          const [min, max] = polygonSettings.pointCountRange;
          return Math.floor(min + Math.random() * (max - min + 1));
        }
      }
      return defaultMin + Math.floor(Math.random() * (defaultMax - defaultMin + 1));
    };
    
    const getPointCount = (defaultMin: number, defaultMax: number): number => {
      // Check if line properties are specifically enabled
      if (batchConfig?.propertiesEnabled && batchConfig?.linePropertiesEnabled && batchConfig?.pointCountRange) {
        const [min, max] = batchConfig.pointCountRange;
        return Math.floor(min + Math.random() * (max - min + 1));
      }
      // Fallback to scatter settings for line-specific properties
      if (batchConfig?.scatterSettings?.shapeSpecific?.line?.pointCountRange) {
        const [min, max] = batchConfig.scatterSettings.shapeSpecific.line.pointCountRange;
        return Math.floor(min + Math.random() * (max - min + 1));
      }
      return defaultMin + Math.floor(Math.random() * (defaultMax - defaultMin + 1));
    };
    
    const getSplinePointCount = (defaultMin: number, defaultMax: number): number => {
      // Check if spline properties are specifically enabled
      if (batchConfig?.propertiesEnabled && batchConfig?.splinePropertiesEnabled && batchConfig?.splinePointCountRange) {
        const [min, max] = batchConfig.splinePointCountRange;
        return Math.floor(min + Math.random() * (max - min + 1));
      }
      // Fallback to scatter settings for spline-specific properties
      if (batchConfig?.scatterSettings?.shapeSpecific?.['smooth-spline']?.pointCountRange || 
          batchConfig?.scatterSettings?.shapeSpecific?.bezier?.pointCountRange ||
          batchConfig?.scatterSettings?.shapeSpecific?.bezier?.pointCountRange) {
        const splineSettings = batchConfig.scatterSettings.shapeSpecific['smooth-spline'] || 
                              batchConfig.scatterSettings.shapeSpecific.bezier;
        if (splineSettings?.pointCountRange) {
          const [min, max] = splineSettings.pointCountRange;
          return Math.floor(min + Math.random() * (max - min + 1));
        }
      }
      return defaultMin + Math.floor(Math.random() * (defaultMax - defaultMin + 1));
    };

    switch (this.type) {
      case 'rectangle':
        const rectDims = getWidthHeight();
        this.width = rectDims.width;
        this.height = rectDims.height;
        // Standard rectangle - no rounded corners
        this.generateRectanglePoints(0);
        break;
      case 'rounded-rectangle':
        const roundedRectDims = getWidthHeight();
        this.width = roundedRectDims.width;
        this.height = roundedRectDims.height;
        // Apply corner radius from batch config or scatter settings if available
        let cornerRadius = 0;
        if (batchConfig?.propertiesEnabled && batchConfig?.shapePropertiesEnabled && batchConfig?.shapePropertiesDimensionsEnabled) {
          const crMode = batchConfig.rectangleCornerRadiusMode ?? 'range';
          if (crMode === 'range') {
            const [minR, maxR] = batchConfig.rectangleCornerRadiusRange ?? [0, 20];
            cornerRadius = minR + Math.random() * (maxR - minR);
          } else if (crMode === 'define') {
            cornerRadius = batchConfig.rectangleCornerRadiusDefine ?? 10;
          } else if (crMode === 'incremental') {
            const crDriver = batchConfig.rectangleCornerRadiusIncrementalIndexDriver ?? 'shapeIndex';
            const crIdx = crDriver === 'setRepIndex' ? (batchConfig._setRepIndex ?? 0) : (batchConfig._shapeIndex ?? 0);
            cornerRadius = (batchConfig.rectangleCornerRadiusStartValue ?? 0) + crIdx * (batchConfig.rectangleCornerRadiusIncrement ?? 2);
            if (batchConfig.rectangleCornerRadiusModulationEnabled && (batchConfig.rectangleCornerRadiusModulationValue ?? 0) > 0) {
              cornerRadius = cornerRadius % batchConfig.rectangleCornerRadiusModulationValue;
            }
          } else if (crMode === 'series') {
            const crVal = resolveScalarSeries(batchConfig.rectangleCornerRadiusSeriesItems ?? [], batchConfig.rectangleCornerRadiusSeriesSelection ?? 'sequential', batchConfig.rectangleCornerRadiusSeriesExhaustion ?? 'cycle', batchConfig.rectangleCornerRadiusSeriesDriver ?? 'shape-index', batchConfig._shapeIndex ?? 0, batchConfig._setRepIndex ?? 0);
            cornerRadius = isNaN(crVal) ? 0 : crVal;
          }
        } else if (batchConfig?.scatterSettings?.shapeSpecific?.['rounded-rectangle']) {
          const roundedRectSettings = batchConfig.scatterSettings.shapeSpecific['rounded-rectangle'];
          if (roundedRectSettings.cornerRadiusMode === 'fixed') {
            cornerRadius = roundedRectSettings.cornerRadiusValue || 5;
          } else {
            const [minRadius, maxRadius] = roundedRectSettings.cornerRadiusRange || [0, 10];
            cornerRadius = minRadius + Math.random() * (maxRadius - minRadius);
          }
        }
        this.generateRectanglePoints(cornerRadius);
        break;
      case 'square':
        const { width: squareSize } = getWidthHeight();
        this.width = squareSize;
        this.height = squareSize;
        // Standard square - no rounded corners
        this.generateRectanglePoints(0);
        break;
      case 'rounded-square':
        const { width: roundedSquareSize } = getWidthHeight();
        this.width = roundedSquareSize;
        this.height = roundedSquareSize;
        // Apply corner radius from batch config or scatter settings if available
        let squareCornerRadius = 0;
        if (batchConfig?.propertiesEnabled && batchConfig?.shapePropertiesEnabled && batchConfig?.shapePropertiesDimensionsEnabled) {
          const sqCrMode = batchConfig.rectangleCornerRadiusMode ?? 'range';
          if (sqCrMode === 'range') {
            const [minR, maxR] = batchConfig.rectangleCornerRadiusRange ?? [0, 20];
            squareCornerRadius = minR + Math.random() * (maxR - minR);
          } else if (sqCrMode === 'define') {
            squareCornerRadius = batchConfig.rectangleCornerRadiusDefine ?? 10;
          } else if (sqCrMode === 'incremental') {
            const sqCrDriver = batchConfig.rectangleCornerRadiusIncrementalIndexDriver ?? 'shapeIndex';
            const sqCrIdx = sqCrDriver === 'setRepIndex' ? (batchConfig._setRepIndex ?? 0) : (batchConfig._shapeIndex ?? 0);
            squareCornerRadius = (batchConfig.rectangleCornerRadiusStartValue ?? 0) + sqCrIdx * (batchConfig.rectangleCornerRadiusIncrement ?? 2);
            if (batchConfig.rectangleCornerRadiusModulationEnabled && (batchConfig.rectangleCornerRadiusModulationValue ?? 0) > 0) {
              squareCornerRadius = squareCornerRadius % batchConfig.rectangleCornerRadiusModulationValue;
            }
          } else if (sqCrMode === 'series') {
            const sqCrVal = resolveScalarSeries(batchConfig.rectangleCornerRadiusSeriesItems ?? [], batchConfig.rectangleCornerRadiusSeriesSelection ?? 'sequential', batchConfig.rectangleCornerRadiusSeriesExhaustion ?? 'cycle', batchConfig.rectangleCornerRadiusSeriesDriver ?? 'shape-index', batchConfig._shapeIndex ?? 0, batchConfig._setRepIndex ?? 0);
            squareCornerRadius = isNaN(sqCrVal) ? 0 : sqCrVal;
          }
        } else if (batchConfig?.scatterSettings?.shapeSpecific?.['rounded-square']) {
          const roundedSquareSettings = batchConfig.scatterSettings.shapeSpecific['rounded-square'];
          if (roundedSquareSettings.cornerRadiusMode === 'fixed') {
            squareCornerRadius = roundedSquareSettings.cornerRadiusValue || 5;
          } else {
            const [minRadius, maxRadius] = roundedSquareSettings.cornerRadiusRange || [0, 10];
            squareCornerRadius = minRadius + Math.random() * (maxRadius - minRadius);
          }
        }
        this.generateRectanglePoints(squareCornerRadius);
        break;
      case 'circle':
        this.radius = getRadius();
        // Apply segment count from shape-specific settings if available
        if (batchConfig?.scatterSettings?.shapeSpecific?.circle) {
          const circleSettings = batchConfig.scatterSettings.shapeSpecific.circle;
          if (circleSettings.segmentCountMode === 'fixed' && circleSettings.segmentCountValue !== undefined) {
            this.segments = circleSettings.segmentCountValue;
          } else if (circleSettings.segmentCountRange) {
            const [min, max] = circleSettings.segmentCountRange;
            this.segments = Math.floor(min + Math.random() * (max - min + 1));
          }
        }
        this.generateCirclePoints();
        break;
      case 'ellipse':
        const ellipseDims = getWidthHeight();
        this.width = ellipseDims.width;
        this.height = ellipseDims.height;
        // Apply segment count from shape-specific settings if available
        if (batchConfig?.scatterSettings?.shapeSpecific?.ellipse) {
          const ellipseSettings = batchConfig.scatterSettings.shapeSpecific.ellipse;
          if (ellipseSettings.segmentCountMode === 'fixed' && ellipseSettings.segmentCountValue !== undefined) {
            this.segments = ellipseSettings.segmentCountValue;
          } else if (ellipseSettings.segmentCountRange) {
            const [min, max] = ellipseSettings.segmentCountRange;
            this.segments = Math.floor(min + Math.random() * (max - min + 1));
          }
        }
        this.generateEllipsePoints();
        break;
      case 'triangle':
        this.radius = getRadius(30, 70);
        this.generateTrianglePoints();
        break;
      case 'right-triangle':
        const rightTriDims = getWidthHeight();
        this.width = rightTriDims.width;
        this.height = rightTriDims.height;
        this.generateRightTrianglePoints();
        break;
      case 'trapezoid':
        const trapDims = getWidthHeight();
        this.width = trapDims.width;
        this.height = trapDims.height;
        this.generateTrapezoidPoints();
        break;
      case 'pentagon':
        this.radius = getRadius(30, 70);
        this.generatePentagonPoints();
        break;
      case 'hexagon':
        this.radius = getRadius(30, 70);
        this.generateHexagonPoints();
        break;
      case 'rhombus':
        const rhombusDims = getWidthHeight();
        this.width = rhombusDims.width;
        this.height = rhombusDims.height;
        this.generateRhombusPoints();
        break;
      case 'parallelogram':
        const paraDims = getWidthHeight();
        this.width = paraDims.width;
        this.height = paraDims.height;
        this.generateParallelogramPoints();
        break;
      case 'kite':
        const kiteDims = getWidthHeight();
        this.width = kiteDims.width;
        this.height = kiteDims.height;
        this.generateKitePoints();
        break;
      case 'semicircle':
        this.radius = getRadius(30, 70);
        this.generateSemicirclePoints();
        break;
      case 'heart':
        const heartDims = getWidthHeight();
        this.width = heartDims.width;
        this.height = heartDims.height;
        this.generateHeartPoints();
        break;
      case 'arrow':
        const arrowDims = getWidthHeight();
        this.width = arrowDims.width;
        this.height = arrowDims.height;
        this.generateArrowPoints();
        break;
      case 'cross':
        const crossDims = getWidthHeight();
        this.width = crossDims.width;
        this.height = crossDims.height;
        this.generateCrossPoints();
        break;
      case 'polygon':
        this.sides = getSegmentCount(3, 12);
        this.radius = getRadius(30, 70);
        this.generatePolygonPoints();
        break;
      case 'star':
        this.sides = getSegmentCount(5, 12);
        this.radius = getRadius(30, 70);
        // Apply inner radius ratio from batch config or scatter settings if available
        let innerRadiusRatio = 0.3 + Math.random() * 0.4;
        if (batchConfig?.propertiesEnabled && batchConfig?.shapePropertiesEnabled && batchConfig?.shapePropertiesDimensionsEnabled) {
          const starIrMode = batchConfig.starInnerRadiusMode ?? 'range';
          if (starIrMode === 'range') {
            const [minRatio, maxRatio] = batchConfig.starInnerRadiusRange ?? [0.3, 0.7];
            innerRadiusRatio = minRatio + Math.random() * (maxRatio - minRatio);
          } else if (starIrMode === 'define') {
            innerRadiusRatio = batchConfig.starInnerRadiusDefine ?? 0.5;
          } else if (starIrMode === 'incremental') {
            const starIrDriver = batchConfig.starInnerRadiusIncrementalIndexDriver ?? 'shapeIndex';
            const starIrIdx = starIrDriver === 'setRepIndex' ? (batchConfig._setRepIndex ?? 0) : (batchConfig._shapeIndex ?? 0);
            innerRadiusRatio = (batchConfig.starInnerRadiusStartValue ?? 0.3) + starIrIdx * (batchConfig.starInnerRadiusIncrement ?? 0.05);
            if (batchConfig.starInnerRadiusModulationEnabled && (batchConfig.starInnerRadiusModulationValue ?? 0) > 0) {
              innerRadiusRatio = innerRadiusRatio % batchConfig.starInnerRadiusModulationValue;
            }
          } else if (starIrMode === 'series') {
            const starIrVal = resolveScalarSeries(batchConfig.starInnerRadiusSeriesItems ?? [], batchConfig.starInnerRadiusSeriesSelection ?? 'sequential', batchConfig.starInnerRadiusSeriesExhaustion ?? 'cycle', batchConfig.starInnerRadiusSeriesDriver ?? 'shape-index', batchConfig._shapeIndex ?? 0, batchConfig._setRepIndex ?? 0);
            innerRadiusRatio = isNaN(starIrVal) ? 0.5 : starIrVal;
          }
        } else if (batchConfig?.scatterSettings?.shapeSpecific?.star) {
          const starSettings = batchConfig.scatterSettings.shapeSpecific.star;
          if (starSettings.innerRadiusMode === 'fixed' && starSettings.innerRadiusValue !== undefined) {
            innerRadiusRatio = starSettings.innerRadiusValue;
          } else if (starSettings.innerRadiusRange) {
            const [minRatio, maxRatio] = starSettings.innerRadiusRange;
            innerRadiusRatio = minRatio + Math.random() * (maxRatio - minRatio);
          }
        }
        this.innerRadius = this.radius * innerRadiusRatio;
        this.generateStarPoints();
        break;
      case 'line':
        this.generateLinePoints(getPointCount(2, 8), batchConfig);
        break;
      case 'line-vector':
        this.generateLineVectorPoints(batchConfig);
        break;
      case 'cubic':
        this.generateCubicCurvePoints(batchConfig);
        break;
      case 'bezier':
        this.generateCurvePoints(getSplinePointCount(3, 6), batchConfig);
        break;
      case 'smooth-spline':
        this.generateSmoothSplinePoints(getSplinePointCount(3, 8), batchConfig);
        break;
      case 'chunk':
        this.generateChunkPoints();
        break;
      case 'blob':
        this.generateBlobPoints();
        break;
      case 'ring':
        this.radius = getRadius();
        // Apply inner radius ratio from batch config or shape-specific settings
        let ringInnerRadiusRatio = 0.4 + Math.random() * 0.4;
        if (batchConfig?.propertiesEnabled && batchConfig?.shapePropertiesEnabled && batchConfig?.shapePropertiesDimensionsEnabled) {
          const ringIrMode = batchConfig.ringInnerRadiusMode ?? 'range';
          if (ringIrMode === 'range') {
            const [minRatio, maxRatio] = batchConfig.ringInnerRadiusRange ?? [0.4, 0.8];
            ringInnerRadiusRatio = minRatio + Math.random() * (maxRatio - minRatio);
          } else if (ringIrMode === 'define') {
            ringInnerRadiusRatio = batchConfig.ringInnerRadiusDefine ?? 0.6;
          } else if (ringIrMode === 'incremental') {
            const ringIrDriver = batchConfig.ringInnerRadiusIncrementalIndexDriver ?? 'shapeIndex';
            const ringIrIdx = ringIrDriver === 'setRepIndex' ? (batchConfig._setRepIndex ?? 0) : (batchConfig._shapeIndex ?? 0);
            ringInnerRadiusRatio = (batchConfig.ringInnerRadiusStartValue ?? 0.4) + ringIrIdx * (batchConfig.ringInnerRadiusIncrement ?? 0.05);
            if (batchConfig.ringInnerRadiusModulationEnabled && (batchConfig.ringInnerRadiusModulationValue ?? 0) > 0) {
              ringInnerRadiusRatio = ringInnerRadiusRatio % batchConfig.ringInnerRadiusModulationValue;
            }
          } else if (ringIrMode === 'series') {
            const ringIrVal = resolveScalarSeries(batchConfig.ringInnerRadiusSeriesItems ?? [], batchConfig.ringInnerRadiusSeriesSelection ?? 'sequential', batchConfig.ringInnerRadiusSeriesExhaustion ?? 'cycle', batchConfig.ringInnerRadiusSeriesDriver ?? 'shape-index', batchConfig._shapeIndex ?? 0, batchConfig._setRepIndex ?? 0);
            ringInnerRadiusRatio = isNaN(ringIrVal) ? 0.6 : ringIrVal;
          }
        } else if (batchConfig?.scatterSettings?.shapeSpecific?.ring) {
          const ringSettings = batchConfig.scatterSettings.shapeSpecific.ring;
          if (ringSettings.innerRadiusMode === 'fixed' && ringSettings.innerRadiusValue !== undefined) {
            ringInnerRadiusRatio = ringSettings.innerRadiusValue;
          } else if (ringSettings.innerRadiusRange) {
            const [minRatio, maxRatio] = ringSettings.innerRadiusRange;
            ringInnerRadiusRatio = minRatio + Math.random() * (maxRatio - minRatio);
          }
        }
        this.innerRadius = this.radius * ringInnerRadiusRatio;
        this.generateRingPoints();
        break;
      case 'spline-circle':
        this.radius = getRadius();
        this.generateSplineCirclePoints();
        break;
      case 'spline-ellipse':
        const splineEllipseDims = getWidthHeight();
        this.width = splineEllipseDims.width;
        this.height = splineEllipseDims.height;
        this.generateSplineEllipsePoints();
        break;
      case 'spline-ring':
        this.radius = getRadius();
        // Apply inner radius ratio from batch config or shape-specific settings
        let splineRingInnerRadiusRatio = 0.4 + Math.random() * 0.4;
        if (batchConfig?.propertiesEnabled && batchConfig?.shapePropertiesEnabled && batchConfig?.shapePropertiesDimensionsEnabled) {
          const srIrMode = batchConfig.ringInnerRadiusMode ?? 'range';
          if (srIrMode === 'range') {
            const [minRatio, maxRatio] = batchConfig.ringInnerRadiusRange ?? [0.4, 0.8];
            splineRingInnerRadiusRatio = minRatio + Math.random() * (maxRatio - minRatio);
          } else if (srIrMode === 'define') {
            splineRingInnerRadiusRatio = batchConfig.ringInnerRadiusDefine ?? 0.6;
          } else if (srIrMode === 'incremental') {
            const srIrDriver = batchConfig.ringInnerRadiusIncrementalIndexDriver ?? 'shapeIndex';
            const srIrIdx = srIrDriver === 'setRepIndex' ? (batchConfig._setRepIndex ?? 0) : (batchConfig._shapeIndex ?? 0);
            splineRingInnerRadiusRatio = (batchConfig.ringInnerRadiusStartValue ?? 0.4) + srIrIdx * (batchConfig.ringInnerRadiusIncrement ?? 0.05);
            if (batchConfig.ringInnerRadiusModulationEnabled && (batchConfig.ringInnerRadiusModulationValue ?? 0) > 0) {
              splineRingInnerRadiusRatio = splineRingInnerRadiusRatio % batchConfig.ringInnerRadiusModulationValue;
            }
          } else if (srIrMode === 'series') {
            const srIrVal = resolveScalarSeries(batchConfig.ringInnerRadiusSeriesItems ?? [], batchConfig.ringInnerRadiusSeriesSelection ?? 'sequential', batchConfig.ringInnerRadiusSeriesExhaustion ?? 'cycle', batchConfig.ringInnerRadiusSeriesDriver ?? 'shape-index', batchConfig._shapeIndex ?? 0, batchConfig._setRepIndex ?? 0);
            splineRingInnerRadiusRatio = isNaN(srIrVal) ? 0.6 : srIrVal;
          }
        } else if (batchConfig?.scatterSettings?.shapeSpecific?.['spline-ring']) {
          const splineRingSettings = batchConfig.scatterSettings.shapeSpecific['spline-ring'];
          if (splineRingSettings.innerRadiusMode === 'fixed' && splineRingSettings.innerRadiusValue !== undefined) {
            splineRingInnerRadiusRatio = splineRingSettings.innerRadiusValue;
          } else if (splineRingSettings.innerRadiusRange) {
            const [minRatio, maxRatio] = splineRingSettings.innerRadiusRange;
            splineRingInnerRadiusRatio = minRatio + Math.random() * (maxRatio - minRatio);
          }
        }
        this.innerRadius = this.radius * splineRingInnerRadiusRatio;
        this.generateSplineRingPoints();
        break;

    }
  }

  private generateLinePoints(numPoints?: number, batchConfig?: any): void {
    const pointCount = numPoints || 2 + Math.floor(Math.random() * 6);
    this.points = [];
    
    // Get point position range from batch config if available
    let positionRange = [-50, 50]; // Default range
    if (batchConfig?.propertiesEnabled && batchConfig?.linePropertiesEnabled && batchConfig?.pointPositionRange) {
      positionRange = batchConfig.pointPositionRange;
    } else if (batchConfig?.scatterSettings?.shapeSpecific?.line?.pointPositionRange) {
      positionRange = batchConfig.scatterSettings.shapeSpecific.line.pointPositionRange;
    }
    
    const [minPos, maxPos] = positionRange;
    const baseSpacing = 40; // Base spacing between points
    
    for (let i = 0; i < pointCount; i++) {
      // Calculate position with controlled variation
      const xVariation = minPos + Math.random() * (maxPos - minPos);
      const yVariation = minPos + Math.random() * (maxPos - minPos);
      
      this.points.push({
        x: i * baseSpacing + xVariation,
        y: yVariation
      });
    }
    
    // Set stroke cap based on normalized probabilities
    const strokeCapProbabilities = batchConfig?.scatterSettings?.shapeSpecific?.line?.strokeCapProbabilities || { round: 33, square: 33, butt: 34 };
    this.strokeCap = selectStrokeCap(strokeCapProbabilities);
  }

  private generateLineVectorPoints(batchConfig?: any): void {
    this.points = [];
    
    // Helper function to get value based on mode (range/fixed/incremental)
    const getValue = (
      mode: 'range' | 'fixed' | 'incremental',
      range?: [number, number],
      value?: number,
      startValue?: number,
      increment?: number,
      generationIndex: number = 0
    ): number => {
      switch (mode) {
        case 'range':
          if (range) {
            const [min, max] = range;
            return min + Math.random() * (max - min);
          }
          return 0;
        case 'fixed':
          return value || 0;
        case 'incremental':
          return (startValue || 0) + ((increment || 0) * generationIndex);
        default:
          return 0;
      }
    };

    // Get line-vector properties from batch config
    // The settings come in ScalarMode format: { kind: 'fixed'|'range'|'incremental', value/min/max/... }
    const rawSettings = batchConfig?.scatterSettings?.shapeSpecific?.['line-vector'] || {};
    
    // Default settings in ScalarMode format
    const defaultDirection = { kind: 'range' as const, min: 0, max: 360 };
    const defaultLength = { kind: 'range' as const, min: 5, max: 500 };
    const defaultCentroid = { kind: 'fixed' as const, value: 0.5 };
    
    // Get direction setting (merge with defaults)
    const directionSetting = rawSettings.direction || defaultDirection;
    const direction = getValue(
      directionSetting.kind,
      directionSetting.kind === 'range' ? [directionSetting.min, directionSetting.max] : undefined,
      directionSetting.kind === 'fixed' ? directionSetting.value : undefined,
      directionSetting.kind === 'incremental' ? directionSetting.startValue : undefined,
      directionSetting.kind === 'incremental' ? directionSetting.increment : undefined,
      batchConfig?.generationIndex || 0
    );
    
    // Get length setting (merge with defaults)
    const lengthSetting = rawSettings.length || defaultLength;
    const length = getValue(
      lengthSetting.kind,
      lengthSetting.kind === 'range' ? [lengthSetting.min, lengthSetting.max] : undefined,
      lengthSetting.kind === 'fixed' ? lengthSetting.value : undefined,
      lengthSetting.kind === 'incremental' ? lengthSetting.startValue : undefined,
      lengthSetting.kind === 'incremental' ? lengthSetting.increment : undefined,
      batchConfig?.generationIndex || 0
    );
    
    // Get centroid setting (merge with defaults)
    const centroidSetting = rawSettings.centroid || defaultCentroid;
    const centroid = getValue(
      centroidSetting.kind,
      centroidSetting.kind === 'range' ? [centroidSetting.min, centroidSetting.max] : undefined,
      centroidSetting.kind === 'fixed' ? centroidSetting.value : undefined,
      centroidSetting.kind === 'incremental' ? centroidSetting.startValue : undefined,
      centroidSetting.kind === 'incremental' ? centroidSetting.increment : undefined,
      batchConfig?.generationIndex || 0
    );
    
    // Convert direction to radians
    const angleRadians = (direction * Math.PI) / 180;
    
    // Calculate line endpoints based on centroid position
    // Centroid 0 = anchor at line start (start point at origin)
    // Centroid 0.5 = anchor at line center (center point at origin)
    // Centroid 1 = anchor at line end (end point at origin)
    const startDist = -length * (1 - centroid);
    const endDist = length * centroid;
    
    // Calculate points along the direction vector
    const startX = Math.cos(angleRadians) * startDist;
    const startY = Math.sin(angleRadians) * startDist;
    const endX = Math.cos(angleRadians) * endDist;
    const endY = Math.sin(angleRadians) * endDist;
    
    // Create exactly 2 points for the line vector
    this.points = [
      { x: startX, y: startY },
      { x: endX, y: endY }
    ];
    
    // Set stroke cap based on normalized probabilities
    const strokeCapProbabilities = rawSettings.strokeCapProbabilities || { round: 33, square: 33, butt: 34 };
    this.strokeCap = selectStrokeCap(strokeCapProbabilities);
    
    // Set render properties for line vectors
    this.closed = false;
    this.renderType = 'polygon'; // Simple line rendering
  }

  private generateCurvePoints(numPoints?: number, batchConfig?: any): void {
    let pointCount = numPoints || 3 + Math.floor(Math.random() * 5); // 3-7 points for variable complexity
    this.points = [];
    // Don't initialize controlPoints - let tangentHandles be used instead
    this.tangentHandles = [];
    this.smoothPoints = [];

    // Pattern + size defaults; Wave (1) keeps the previous gentle-wave look by default
    let curvature = 0.3 + Math.random() * 0.4; // 0.3-0.7 wobble
    let spread = 80; // overall footprint in px
    let patternType = 1; // Wave

    const settings = batchConfig?.scatterSettings?.shapeSpecific?.bezier;
    if (settings) {
      if (settings.pointCountMode === 'incremental') {
        const start = settings.pointCountStartValue ?? 3;
        const inc = settings.pointCountIncrement ?? 0;
        const boundMax = settings.pointCountBoundMax ?? 10;
        pointCount = Math.max(2, Math.min(boundMax, Math.round(start + inc * (batchConfig?.generationIndex || 0))));
      } else if (settings.pointCountRange) {
        const [min, max] = settings.pointCountRange;
        pointCount = Math.floor(min + Math.random() * (max - min + 1));
      }
      if (settings.curvatureRange) {
        const [min, max] = settings.curvatureRange;
        curvature = min + Math.random() * (max - min);
      }
      if (settings.spreadRange) {
        const [min, max] = settings.spreadRange;
        spread = min + Math.random() * (max - min);
      }
      if (settings.patternType !== undefined) {
        patternType = settings.patternType;
      }
    }

    const bezierBoundMax = settings?.pointCountBoundMax ?? 10;
    pointCount = Math.max(2, Math.min(bezierBoundMax, pointCount));

    // patternType === -1 means "None": generate a straight-line baseline instead
    // of a structured pattern. Curvature and handle tension will bend it naturally.
    if (patternType !== -1) {
      // Pattern Resample: override pointCount with pattern-geometry-driven count when enabled
      const _bezierResample = _resolvePatternResampleCount(settings, patternType, spread, batchConfig?.generationIndex ?? 0);
      if (_bezierResample !== undefined) {
        pointCount = _bezierResample;
        (this as any)._curveEffectivePointCount = _bezierResample;
      } else {
        (this as any)._curveEffectivePointCount = undefined;
      }
      const _bzGenIdx = batchConfig?.generationIndex ?? 0;
      this.generateCurvePatternPoints(
        pointCount, spread, curvature, patternType,
        _buildPatternControls(settings, spread, _bzGenIdx),
      );
    } else {
      // None pattern: evenly spaced points along the x-axis, y=0 (straight line).
      (this as any)._curveEffectivePointCount = undefined;
      this.points = [];
      for (let i = 0; i < pointCount; i++) {
        const t = pointCount > 1 ? i / (pointCount - 1) : 0.5;
        this.points.push({ x: (t - 0.5) * spread * 2, y: 0 });
      }
    }

    // Apply Curve Length: rescale x-extent of generated points to the target length.
    _applyCurveLengthToPoints(this.points, settings, batchConfig?.generationIndex ?? 0);

    // Apply curve direction: rotate the point cloud around its centroid BEFORE
    // handle generation so tangents align automatically with the rotated shape.
    if (this.points.length >= 2) {
      const _dirAngle = _resolveCurveDirectionAngle(settings);
      if (_dirAngle !== 0) _rotateCurvePoints(this.points, _dirAngle);
    }

    // Decide open/closed BEFORE generating handles. generateSmoothTangentHandles
    // uses this.closed to wrap the first/last point tangents around the loop for
    // closed curves; if it still saw the constructor default (open) the endpoints
    // got open-curve handles pointing off into empty space, collapsing the closing
    // segment so a closed bezier rendered as a near-invisible sliver until a point
    // was added (which recomputed handles with the correct closed state). This is
    // the same fix already applied to the cubic and smooth-spline generators.
    let openProbability = 70; // Default 70% open for better curve display
    if (settings?.openProbability !== undefined) {
      openProbability = settings.openProbability;
    }
    this.closed = Math.random() * 100 > openProbability;

    // Resolve curve tension (handle length). Supports fixed and range modes,
    // matching the cubic generator. Falls back to 30% (= historical 0.3 factor).
    let tensionPercent = settings?.curveTension ?? 30;
    if (settings?.curveTensionMode === 'fixed' && settings?.curveTensionValue !== undefined) {
      tensionPercent = settings.curveTensionValue;
    } else if (settings?.curveTensionRange) {
      const [tMin, tMax] = settings.curveTensionRange;
      tensionPercent = tMin + Math.random() * (tMax - tMin);
    }
    const tensionFactor = tensionPercent / 100;
    const endpointContinuous = settings?.endpointContinuous ?? false;

    // Generate mathematically continuous tangent handles
    this.generateSmoothTangentHandles(tensionFactor, endpointContinuous);

    // Recenter geometry on its bounding-box center (see generateCubicCurvePoints).
    this.recenterPointsAndHandles();

    // When closed, optionally average the first/last points to a shared midpoint
    // so ends meet at one point instead of a straight-line join.
    const closeAverageProbability = settings?.closeAverageProbability ?? 0;
    if (this.closed && Math.random() * 100 < closeAverageProbability) {
      this.averageCurveEndpoints();
    }

    // Set stroke cap based on normalized probabilities
    const strokeCapProbabilities = settings?.strokeCapProbabilities || { round: 33, square: 33, butt: 34 };
    this.strokeCap = selectStrokeCap(strokeCapProbabilities);

    this.renderType = 'bezier';
  }

  private generateCubicCurvePoints(batchConfig?: any): void {
    // Generate multiple connected cubic curves with smooth interpolation
    this.points = [];
    // Don't initialize controlPoints - let tangentHandles be used instead
    this.tangentHandles = [];
    this.smoothPoints = [];

    // Get configuration from batch config if available
    let pointCount = 3 + Math.floor(Math.random() * 5); // Default 3-7 points
    let curvatureVariation = 0.3 + Math.random() * 0.4; // Default 0.3-0.7
    let pointSpread = 60 + Math.random() * 40; // Default 60-100 spread
    let curvePattern = Math.floor(Math.random() * 4); // 0-3 different patterns

    const settings = batchConfig?.scatterSettings?.shapeSpecific?.cubic;
    if (settings) {
      // Point count — incremental grows per shape index, then fixed, then range
      if ((settings as any).pointCountMode === 'incremental') {
        const start = (settings as any).pointCountStartValue ?? 3;
        const inc = (settings as any).pointCountIncrement ?? 0;
        const boundMax = (settings as any).pointCountBoundMax ?? 24;
        pointCount = Math.max(2, Math.min(boundMax, Math.round(start + inc * (batchConfig?.generationIndex || 0))));
      } else if ((settings as any).pointCountMode === 'fixed' && (settings as any).pointCountValue !== undefined) {
        pointCount = Math.round((settings as any).pointCountValue);
      } else if (settings.pointCountRange) {
        const [min, max] = settings.pointCountRange;
        pointCount = Math.floor(min + Math.random() * (max - min + 1));
      }
      // Curvature — prefer explicit fixed mode value over range
      if ((settings as any).curvatureMode === 'fixed' && (settings as any).curvatureValue !== undefined) {
        curvatureVariation = (settings as any).curvatureValue;
      } else if (settings.curvatureRange) {
        const [min, max] = settings.curvatureRange;
        curvatureVariation = min + Math.random() * (max - min);
      }
      // Spread — prefer explicit fixed mode value over range
      if ((settings as any).spreadMode === 'fixed' && (settings as any).spreadValue !== undefined) {
        pointSpread = (settings as any).spreadValue;
      } else if (settings.spreadRange) {
        const [min, max] = settings.spreadRange;
        pointSpread = min + Math.random() * (max - min);
      }
      if (settings.patternType !== undefined) {
        curvePattern = settings.patternType;
      }
    }

    const s_any = settings as any;

    if (curvePattern === -1) {
      // None pattern: evenly spaced points along x-axis, y=0 (straight line).
      const userMaxCap = Math.max(2, Math.round(s_any?.pointCountBoundMax ?? 24));
      pointCount = Math.max(2, Math.min(userMaxCap, pointCount));
      (this as any)._curveEffectivePointCount = undefined;
      this.points = [];
      for (let i = 0; i < pointCount; i++) {
        const t = pointCount > 1 ? i / (pointCount - 1) : 0.5;
        this.points.push({ x: (t - 0.5) * pointSpread * 2, y: 0 });
      }
    } else {
      // Each pattern needs a minimum number of points to be visually recognisable.
      // Below these thresholds every pattern collapses to the same smooth wiggle.
      let patternMinPoints: number;
      if (curvePattern === 0) {       // Spiral — need enough samples per turn
        const turns = s_any?.spiralTurns ?? 2.5;
        patternMinPoints = Math.max(10, Math.ceil(turns * 6));
      } else if (curvePattern === 1) { // Wave — honour the user's point count.
        patternMinPoints = 2;
      } else if (curvePattern === 3) { // Arc — smooth arc needs at least 5
        patternMinPoints = 5;
      } else {                         // Organic
        patternMinPoints = 4;
      }
      // Honour a user-configured upper bound on point count when present, otherwise
      // fall back to the historical cap of 24. Always clamp up to the pattern minimum.
      const userMaxCap = Math.max(patternMinPoints, Math.round(s_any?.pointCountBoundMax ?? 24));
      pointCount = Math.max(patternMinPoints, Math.min(userMaxCap, pointCount));

      // Pattern Resample: override pointCount with pattern-geometry-driven count when enabled
      const _cubicResample = _resolvePatternResampleCount(settings, curvePattern, pointSpread, batchConfig?.generationIndex ?? 0);
      if (_cubicResample !== undefined) {
        pointCount = _cubicResample;
        (this as any)._curveEffectivePointCount = _cubicResample;
      } else {
        (this as any)._curveEffectivePointCount = undefined;
      }

      const _ssGenIdx = batchConfig?.generationIndex ?? 0;
      this.generateCurvePatternPoints(
        pointCount, pointSpread, curvatureVariation, curvePattern,
        _buildPatternControls(settings, pointSpread, _ssGenIdx),
      );
    }

    // Apply Curve Length: rescale x-extent of generated points to the target length.
    _applyCurveLengthToPoints(this.points, settings, batchConfig?.generationIndex ?? 0);

    // Apply curve direction rotation before handle generation (cubic generator).
    if (this.points.length >= 2) {
      const _dirAngle = _resolveCurveDirectionAngle(settings);
      if (_dirAngle !== 0) _rotateCurvePoints(this.points, _dirAngle);
    }

    // Decide open/closed BEFORE generating handles, because endpoint-continuity
    // logic in generateSmoothTangentHandles only applies to open curves and
    // checks this.closed. (Previously this was set after handle generation, so
    // the endpoint logic always saw closed=false.)
    let openProbability = 85; // Default 85% open for better curve display
    if (batchConfig?.scatterSettings?.shapeSpecific?.[this.type]?.openProbability !== undefined) {
      openProbability = batchConfig.scatterSettings.shapeSpecific[this.type].openProbability;
    }
    this.closed = Math.random() * 100 > openProbability;

    // Spiral needs analytically-correct tangents (perpendicular to its radius vector).
    // The generic chord-bisection handles produce severe errors when points are far
    // apart angularly, so we use a dedicated method for that pattern.
    // Curve tension (handle length) and endpoint continuity controls.
    // Tension supports fixed and range modes (like curvature/spread). Falls back
    // to the legacy single curveTension number, then to 30 (= historical 0.3).
    let tensionPercent = s_any?.curveTension ?? 30;
    if (s_any?.curveTensionMode === 'fixed' && s_any?.curveTensionValue !== undefined) {
      tensionPercent = s_any.curveTensionValue;
    } else if (s_any?.curveTensionRange) {
      const [tMin, tMax] = s_any.curveTensionRange;
      tensionPercent = tMin + Math.random() * (tMax - tMin);
    }
    const tensionFactor = tensionPercent / 100; // default 30% reproduces the historical 0.3 factor
    const endpointContinuous = s_any?.endpointContinuous ?? false;
    if (curvePattern === 0) {
      this.generateSpiralTangentHandles();
    } else {
      this.generateSmoothTangentHandles(tensionFactor, endpointContinuous);
    }

    // Recenter the generated geometry on its bounding-box center so the shape's
    // transform pivot (local 0,0) coincides with the visual center. Done AFTER
    // handle generation because the spiral tangent math assumes the spiral centre
    // sits at the origin. Shifts points and their absolute tangent handles together.
    this.recenterPointsAndHandles();

    // Close mode: when closed, optionally "average" the first/last points to a
    // shared midpoint (so ends meet at one point) instead of the default "keep"
    // (straight join). Probability 0 = always keep (historical behaviour).
    const closeAverageProbability = s_any?.closeAverageProbability ?? 0;
    if (this.closed && Math.random() * 100 < closeAverageProbability) {
      this.averageCurveEndpoints();
    }

    // Set stroke cap based on normalized probabilities (matches bezier/smooth-spline/line)
    const strokeCapProbabilities = settings?.strokeCapProbabilities || { round: 33, square: 33, butt: 34 };
    this.strokeCap = selectStrokeCap(strokeCapProbabilities);

    this.renderType = 'cubic';
  }

  /**
   * Shared curve pattern point generator used by Cubic, Bezier and Smooth Spline.
   * Lays out anchor points for the selected pattern (Spiral / Wave / Organic / Arc),
   * scaled by `spread` (overall size) with `curvature` controlling random wobble.
   * Per-pattern artistic controls (wave height/frequency/phase, spiral turns/tightness,
   * arc sweep, organic jitter) are read from `controls` with safe fallbacks so older
   * saved data keeps its previous look.
   */
  private generateCurvePatternPoints(
    pointCount: number,
    spread: number,
    curvature: number,
    patternType: number,
    controls: {
      waveHeight?: number;
      waveFrequency?: number;
      wavePhase?: number;
      spiralTurns?: number;
      spiralTightness?: number;
      arcSweep?: number;
      organicJitter?: number;
      jitterAlongNormal?: boolean;
      jitterDirection?: 'both' | 'outward' | 'inward';
    } = {}
  ): void {
    // Delegate to the shared generator so client preview and server/batch
    // exports always produce identical curve geometry (see shared/curveUtils.ts).
    this.points = computeCurvePatternPoints(pointCount, spread, curvature, patternType, controls);
  }

  /**
   * Generate mathematically smooth tangent handles that maintain C1 continuity
   * This ensures smooth curves without breaks or sharp angles between segments
   */
  private generateSmoothTangentHandles(tensionFactor: number = 0.3, endpointContinuous: boolean = false): void {
    if (!this.points || this.points.length < 2) return;
    
    this.tangentHandles = [];
    this.smoothPoints = [];
    
    for (let i = 0; i < this.points.length; i++) {
      const current = this.points[i];
      const isFirst = i === 0;
      const isLast = i === this.points.length - 1;
      
      let tangentVector: Point = { x: 0, y: 0 };
      
      if (isFirst && !this.closed) {
        // First point. Default: tangent points toward next point (gives a curly tail).
        // Continuous mode: match the neighbouring interior point's tangent so the
        // curve flows smoothly into the endpoint instead of curling toward it.
        if (endpointContinuous && this.points.length >= 3) {
          tangentVector = this.computeBisectorTangent(i + 1);
        } else {
          const next = this.points[i + 1];
          tangentVector = this.normalizeVector({
            x: next.x - current.x,
            y: next.y - current.y
          });
        }
      } else if (isLast && !this.closed) {
        // Last point. Default: tangent points from previous point.
        // Continuous mode: match the neighbouring interior point's tangent.
        if (endpointContinuous && this.points.length >= 3) {
          tangentVector = this.computeBisectorTangent(i - 1);
        } else {
          const prev = this.points[i - 1];
          tangentVector = this.normalizeVector({
            x: current.x - prev.x,
            y: current.y - prev.y
          });
        }
      } else {
        // Middle points or closed curve: tangent bisects adjacent segments
        const prevIndex = this.closed ? (i - 1 + this.points.length) % this.points.length : Math.max(0, i - 1);
        const nextIndex = this.closed ? (i + 1) % this.points.length : Math.min(this.points.length - 1, i + 1);
        
        const prev = this.points[prevIndex];
        const next = this.points[nextIndex];
        
        // Calculate smooth tangent vector (average of normalized adjacent directions)
        const incomingVector = this.normalizeVector({
          x: current.x - prev.x,
          y: current.y - prev.y
        });
        const outgoingVector = this.normalizeVector({
          x: next.x - current.x,
          y: next.y - current.y
        });
        
        // Tangent is the normalized average of adjacent directions
        tangentVector = this.normalizeVector({
          x: (incomingVector.x + outgoingVector.x) / 2,
          y: (incomingVector.y + outgoingVector.y) / 2
        });
      }
      
      // Calculate handle length based on distance to adjacent points (30% of average)
      let handleLength = 25; // Default length
      
      const distances: number[] = [];
      if (!isFirst || this.closed) {
        const prevIndex = this.closed ? (i - 1 + this.points.length) % this.points.length : i - 1;
        const prev = this.points[prevIndex];
        distances.push(Math.sqrt(
          Math.pow(current.x - prev.x, 2) + Math.pow(current.y - prev.y, 2)
        ));
      }
      if (!isLast || this.closed) {
        const nextIndex = this.closed ? (i + 1) % this.points.length : i + 1;
        const next = this.points[nextIndex];
        distances.push(Math.sqrt(
          Math.pow(next.x - current.x, 2) + Math.pow(next.y - current.y, 2)
        ));
      }
      
      if (distances.length > 0) {
        const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
        handleLength = avgDistance * tensionFactor; // fraction of average adjacent segment length (default 0.3)
      }
      
      // Create collinear handles that maintain C1 continuity
      this.tangentHandles.push({
        in: {
          x: current.x - tangentVector.x * handleLength,
          y: current.y - tangentVector.y * handleLength
        },
        out: {
          x: current.x + tangentVector.x * handleLength,
          y: current.y + tangentVector.y * handleLength
        },
        linked: true,  // Handles maintain collinearity
        smooth: true   // Point creates smooth continuity
      });
      
      // All points are smooth by default for mathematical continuity
      this.smoothPoints.push(true);
    }
  }

  /**
   * Compute the smooth (chord-bisection) tangent direction at a point index,
   * the same way interior points are handled. Used so open-curve endpoints can
   * borrow their neighbour's tangent for a continuous (non-curly) look.
   */
  private computeBisectorTangent(i: number): Point {
    const n = this.points.length;
    const current = this.points[i];
    const prev = this.points[Math.max(0, i - 1)];
    const next = this.points[Math.min(n - 1, i + 1)];
    const incoming = this.normalizeVector({ x: current.x - prev.x, y: current.y - prev.y });
    const outgoing = this.normalizeVector({ x: next.x - current.x, y: next.y - current.y });
    return this.normalizeVector({
      x: (incoming.x + outgoing.x) / 2,
      y: (incoming.y + outgoing.y) / 2
    });
  }

  /**
   * Close a curve by averaging its first and last point positions: both ends are
   * moved to their midpoint (and their tangent handles shifted by the same delta)
   * so the curve meets at a single shared point instead of joining with a straight
   * line. Used by the cubic "average" close mode.
   */
  private averageCurveEndpoints(): void {
    if (!this.points || this.points.length < 2) return;
    const n = this.points.length;
    const first = this.points[0];
    const last = this.points[n - 1];
    const mid = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
    const dFirst = { x: mid.x - first.x, y: mid.y - first.y };
    const dLast = { x: mid.x - last.x, y: mid.y - last.y };
    this.points[0] = { x: mid.x, y: mid.y };
    this.points[n - 1] = { x: mid.x, y: mid.y };
    if (this.tangentHandles) {
      const hFirst = this.tangentHandles[0];
      if (hFirst && 'in' in hFirst && 'out' in hFirst) {
        hFirst.in = { x: hFirst.in.x + dFirst.x, y: hFirst.in.y + dFirst.y };
        hFirst.out = { x: hFirst.out.x + dFirst.x, y: hFirst.out.y + dFirst.y };
      }
      const hLast = this.tangentHandles[n - 1];
      if (hLast && 'in' in hLast && 'out' in hLast) {
        hLast.in = { x: hLast.in.x + dLast.x, y: hLast.in.y + dLast.y };
        hLast.out = { x: hLast.out.x + dLast.x, y: hLast.out.y + dLast.y };
      }
      // Align both handles at the merged point to a shared bisector tangent so
      // the arriving segment (pts[n-2]→mid) and departing segment (mid→pts[1])
      // meet smoothly (C1 continuity). Without this, the two handles point in
      // divergent directions and produce a visible kink at the merge point.
      if (n >= 3) {
        const hF = this.tangentHandles[0];
        const hL = this.tangentHandles[n - 1];
        if (hF && hL && 'out' in hF && 'in' in hF && 'out' in hL && 'in' in hL) {
          // Outgoing direction from merged point toward pts[1]
          const outDx = hF.out.x - mid.x, outDy = hF.out.y - mid.y;
          const outLen = Math.sqrt(outDx * outDx + outDy * outDy);
          // Incoming direction arriving at merged point from pts[n-2]
          const inDx = mid.x - hL.in.x, inDy = mid.y - hL.in.y;
          const inLen = Math.sqrt(inDx * inDx + inDy * inDy);
          if (outLen > 1e-6 && inLen > 1e-6) {
            // Average the two unit vectors to get a smooth bisector tangent
            const avgX = outDx / outLen + inDx / inLen;
            const avgY = outDy / outLen + inDy / inLen;
            const avgLen = Math.sqrt(avgX * avgX + avgY * avgY);
            if (avgLen > 1e-6) {
              const tx = avgX / avgLen, ty = avgY / avgLen;
              // Rewrite both handles using the shared tangent, preserving their lengths
              hF.out = { x: mid.x + tx * outLen, y: mid.y + ty * outLen };
              hF.in  = { x: mid.x - tx * outLen, y: mid.y - ty * outLen };
              hL.in  = { x: mid.x - tx * inLen,  y: mid.y - ty * inLen  };
              hL.out = { x: mid.x + tx * inLen,  y: mid.y + ty * inLen  };
            }
          }
        }
      }
    }
  }

  /**
   * Tangent handle generator for Spiral patterns.
   * Uses the analytically-correct tangent direction at each point —
   * perpendicular to the radius vector in the CCW direction — rather than
   * the chord-bisection approximation, which degrades badly when adjacent
   * points are far apart angularly (as they are with few turns and few points).
   */
  private generateSpiralTangentHandles(): void {
    if (!this.points || this.points.length < 2) return;
    this.tangentHandles = [];
    this.smoothPoints = [];

    for (let i = 0; i < this.points.length; i++) {
      const current = this.points[i];
      const isFirst = i === 0;
      const isLast  = i === this.points.length - 1;

      const r = Math.sqrt(current.x * current.x + current.y * current.y);
      let tangentVector: Point;

      if (r < 1) {
        // Near the spiral centre: fall back to direction toward the next point
        const ref = isLast ? this.points[i - 1] : this.points[i + 1];
        const sign = isLast ? -1 : 1;
        tangentVector = this.normalizeVector({
          x: sign * (ref.x - current.x),
          y: sign * (ref.y - current.y),
        });
      } else {
        // True spiral tangent: rotate radius 90° CCW → (-y/r, x/r)
        tangentVector = { x: -current.y / r, y: current.x / r };
      }

      // Handle length — 35% of the average adjacent segment length
      const distances: number[] = [];
      if (!isFirst) {
        const prev = this.points[i - 1];
        distances.push(Math.sqrt(Math.pow(current.x - prev.x, 2) + Math.pow(current.y - prev.y, 2)));
      }
      if (!isLast) {
        const next = this.points[i + 1];
        distances.push(Math.sqrt(Math.pow(next.x - current.x, 2) + Math.pow(next.y - current.y, 2)));
      }
      const avgDist = distances.length > 0
        ? distances.reduce((s, d) => s + d, 0) / distances.length
        : 25;
      const handleLength = avgDist * 0.35;

      this.tangentHandles.push({
        in:  { x: current.x - tangentVector.x * handleLength, y: current.y - tangentVector.y * handleLength },
        out: { x: current.x + tangentVector.x * handleLength, y: current.y + tangentVector.y * handleLength },
        linked: true,
        smooth: true,
      });
      this.smoothPoints.push(true);
    }
  }

  /**
   * Shift all anchor points and their tangent handles so the geometry is centered
   * on its bounding-box center. Tangent handles are stored as absolute local
   * coordinates (anchor + offset), so they shift by the same amount as the points.
   * Must be called AFTER tangent handles are generated (the spiral tangent
   * generator assumes the spiral centre is at the local origin).
   */
  private recenterPointsAndHandles(): void {
    if (!this.points || this.points.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of this.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    if (cx === 0 && cy === 0) return;

    for (const p of this.points) {
      p.x -= cx;
      p.y -= cy;
    }

    if (this.tangentHandles) {
      for (const h of this.tangentHandles) {
        if (h && h.in)  { h.in.x  -= cx; h.in.y  -= cy; }
        if (h && h.out) { h.out.x -= cx; h.out.y -= cy; }
      }
    }
  }

  /**
   * Normalize a vector to unit length
   */
  private normalizeVector(vector: Point): Point {
    const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
    if (length === 0) return { x: 0, y: 0 };
    return {
      x: vector.x / length,
      y: vector.y / length
    };
  }

  private generateChunkPoints(): void {
    const numPoints = 6 + Math.floor(Math.random() * 6);
    this.points = [];
    this.controlPoints = [];
    const baseRadius = 40 + Math.random() * 60;
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      const radiusVariation = 0.7 + Math.random() * 0.6;
      const radius = baseRadius * radiusVariation;
      
      this.points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius
      });
      
      // Generate control points for smooth blob curves positioned between points
      const nextAngle = ((i + 1) / numPoints) * Math.PI * 2;
      const nextRadius = baseRadius * (0.7 + Math.random() * 0.6);
      const nextX = Math.cos(nextAngle) * nextRadius;
      const nextY = Math.sin(nextAngle) * nextRadius;
      
      // Control point positioned between current and next point for smooth curves
      const controlX = (this.points[i].x + nextX) / 2 + (Math.random() - 0.5) * 20;
      const controlY = (this.points[i].y + nextY) / 2 + (Math.random() - 0.5) * 20;
      
      this.controlPoints.push({
        x: controlX,
        y: controlY
      });
    }
    
    this.closed = true;
    this.renderType = 'bezier';
  }

  private generateBlobPoints(): void {
    const numPoints = 6 + Math.floor(Math.random() * 4); // 6-10 points for smoother curves
    this.points = [];
    this.tangentHandles = [];
    const baseRadius = 50 + Math.random() * 50;
    
    // Generate points in a circular pattern with radius variation
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      const radiusVariation = 0.8 + Math.random() * 0.4; // Less variation for smoother shape
      const radius = baseRadius * radiusVariation;
      
      this.points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius
      });
    }
    
    // Generate tangent handles for bezier curves
    for (let i = 0; i < numPoints; i++) {
      const prevIndex = (i - 1 + numPoints) % numPoints;
      const nextIndex = (i + 1) % numPoints;
      
      const prev = this.points[prevIndex];
      const current = this.points[i];
      const next = this.points[nextIndex];
      
      // Calculate tangent direction based on neighboring points
      const tangentX = (next.x - prev.x) * 0.25; // Control handle length
      const tangentY = (next.y - prev.y) * 0.25;
      
      // Add some randomness to the tangent handles for organic variation
      const randomFactor = 0.3;
      const randomX = (Math.random() - 0.5) * randomFactor * Math.abs(tangentX);
      const randomY = (Math.random() - 0.5) * randomFactor * Math.abs(tangentY);
      
      this.tangentHandles.push({
        in: {
          x: current.x - tangentX + randomX,
          y: current.y - tangentY + randomY
        },
        out: {
          x: current.x + tangentX + randomX,
          y: current.y + tangentY + randomY
        },
        linked: true,
        smooth: true
      });
    }
    
    this.closed = true;
    this.renderType = 'bezier';
  }

  private generateTrianglePoints(): void {
    this.points = [];
    const height = this.radius! * Math.sin(Math.PI / 3); // Equilateral triangle height
    
    this.points.push({ x: 0, y: -this.radius! * 2/3 });
    this.points.push({ x: -this.radius! * Math.cos(Math.PI / 6), y: height - this.radius! * 2/3 });
    this.points.push({ x: this.radius! * Math.cos(Math.PI / 6), y: height - this.radius! * 2/3 });
    
    this.closed = true;
    this.renderType = 'polygon';
  }

  private generateRightTrianglePoints(): void {
    this.points = [];
    const w = this.width! / 2;
    const h = this.height! / 2;
    
    this.points.push({ x: -w, y: -h });
    this.points.push({ x: w, y: h });
    this.points.push({ x: -w, y: h });
    
    this.closed = true;
    this.renderType = 'polygon';
  }

  private generateTrapezoidPoints(): void {
    this.points = [];
    const w = this.width! / 2;
    const h = this.height! / 2;
    const topWidth = w * 0.6; // Top is 60% of bottom width
    
    this.points.push({ x: -topWidth, y: -h });
    this.points.push({ x: topWidth, y: -h });
    this.points.push({ x: w, y: h });
    this.points.push({ x: -w, y: h });
    
    this.closed = true;
    this.renderType = 'polygon';
  }

  private generatePentagonPoints(): void {
    this.points = [];
    const sides = 5;
    
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
      this.points.push({
        x: Math.cos(angle) * this.radius!,
        y: Math.sin(angle) * this.radius!
      });
    }
    
    this.closed = true;
    this.renderType = 'polygon';
  }

  private generateHexagonPoints(): void {
    this.points = [];
    const sides = 6;
    
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2;
      this.points.push({
        x: Math.cos(angle) * this.radius!,
        y: Math.sin(angle) * this.radius!
      });
    }
    
    this.closed = true;
    this.renderType = 'polygon';
  }

  private generateRhombusPoints(): void {
    this.points = [];
    const w = this.width! / 2;
    const h = this.height! / 2;
    
    this.points.push({ x: 0, y: -h });
    this.points.push({ x: w, y: 0 });
    this.points.push({ x: 0, y: h });
    this.points.push({ x: -w, y: 0 });
    
    this.closed = true;
    this.renderType = 'polygon';
  }

  private generateParallelogramPoints(): void {
    this.points = [];
    const w = this.width! / 2;
    const h = this.height! / 2;
    const skew = w * 0.3; // 30% skew
    
    this.points.push({ x: -w + skew, y: -h });
    this.points.push({ x: w + skew, y: -h });
    this.points.push({ x: w - skew, y: h });
    this.points.push({ x: -w - skew, y: h });
    
    this.closed = true;
    this.renderType = 'polygon';
  }

  private generateKitePoints(): void {
    this.points = [];
    const w = this.width! / 2;
    const h = this.height! / 2;
    
    this.points.push({ x: 0, y: -h });
    this.points.push({ x: w * 0.6, y: -h * 0.3 });
    this.points.push({ x: 0, y: h });
    this.points.push({ x: -w * 0.6, y: -h * 0.3 });
    
    this.closed = true;
    this.renderType = 'polygon';
  }

  private generateSemicirclePoints(): void {
    this.points = [];
    const segments = 16;
    
    // Generate semicircle arc
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI;
      this.points.push({
        x: Math.cos(angle) * this.radius!,
        y: Math.sin(angle) * this.radius!
      });
    }
    
    this.closed = true;
    this.renderType = 'polygon';
  }

  private generateHeartPoints(): void {
    this.points = [];
    const segments = 32;
    const scale = this.width! / 100; // Scale factor
    
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = -(13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t));
      
      this.points.push({
        x: x * scale,
        y: y * scale
      });
    }
    
    this.closed = true;
    this.renderType = 'polygon';
  }

  private generateArrowPoints(): void {
    this.points = [];
    const w = this.width! / 2;
    const h = this.height! / 2;
    const headWidth = w * 0.6;
    const shaftWidth = h * 0.4;
    
    this.points.push({ x: w, y: 0 }); // Arrow tip
    this.points.push({ x: w * 0.3, y: -headWidth });
    this.points.push({ x: w * 0.3, y: -shaftWidth });
    this.points.push({ x: -w, y: -shaftWidth });
    this.points.push({ x: -w, y: shaftWidth });
    this.points.push({ x: w * 0.3, y: shaftWidth });
    this.points.push({ x: w * 0.3, y: headWidth });
    
    this.closed = true;
    this.renderType = 'polygon';
  }

  private generateCrossPoints(): void {
    this.points = [];
    const w = this.width! / 2;
    const h = this.height! / 2;
    const thickness = Math.min(w, h) * 0.4;
    
    // Cross shape with 12 points
    this.points.push({ x: -thickness, y: -h });
    this.points.push({ x: thickness, y: -h });
    this.points.push({ x: thickness, y: -thickness });
    this.points.push({ x: w, y: -thickness });
    this.points.push({ x: w, y: thickness });
    this.points.push({ x: thickness, y: thickness });
    this.points.push({ x: thickness, y: h });
    this.points.push({ x: -thickness, y: h });
    this.points.push({ x: -thickness, y: thickness });
    this.points.push({ x: -w, y: thickness });
    this.points.push({ x: -w, y: -thickness });
    this.points.push({ x: -thickness, y: -thickness });
    
    this.closed = true;
    this.renderType = 'polygon';
  }

  private generateRectanglePoints(cornerRadius?: number): void {
    const w = this.width! / 2;
    const h = this.height! / 2;
    const radius = cornerRadius || 0;
    
    // Store corner radius for native roundRect() rendering
    this.cornerRadius = radius;
    
    // Always generate basic corner points for bounds calculation
    this.points = [
      { x: -w, y: -h },  // Top-left
      { x: w, y: -h },   // Top-right
      { x: w, y: h },    // Bottom-right
      { x: -w, y: h }    // Bottom-left
    ];
    
    // Use roundRect rendering if radius is specified (drawRoundedRectangle will clamp it)
    if (radius > 0) {
      this.renderType = 'roundRect';
    } else {
      this.renderType = 'polygon';
    }
    this.closed = true;
  }

  private generateCirclePoints(): void {
    this.points = [];
    const radius = this.radius!;
    
    // Use consistent segment count for smooth circles and proper boolean operations
    const numPoints = this.segments;
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      this.points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius
      });
    }
    this.closed = true;
    this.renderType = 'smooth'; // Use smooth rendering for circles
  }

  private generateEllipsePoints(): void {
    const numPoints = this.segments; // Use consistent segment count
    this.points = [];
    const w = this.width! / 2;
    const h = this.height! / 2;
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      this.points.push({
        x: Math.cos(angle) * w,
        y: Math.sin(angle) * h
      });
    }
    this.closed = true;
    this.renderType = 'smooth'; // Use smooth rendering for ellipses
  }

  private generatePolygonPoints(): void {
    this.points = [];
    const sides = this.sides!;
    const radius = this.radius!;
    
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
      this.points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius
      });
    }
    this.closed = true;
  }

  private generateStarPoints(): void {
    this.points = [];
    const sides = this.sides!;
    const outerRadius = this.radius!;
    const innerRadius = this.innerRadius!;
    
    for (let i = 0; i < sides * 2; i++) {
      const angle = (i / (sides * 2)) * Math.PI * 2 - Math.PI / 2;
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      this.points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius
      });
    }
    this.closed = true;
  }

  private generateRingPoints(): void {
    const numPoints = 16;
    this.points = [];
    const outerRadius = this.radius!;
    const innerRadius = this.innerRadius!;
    
    // Outer ring points
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      this.points.push({
        x: Math.cos(angle) * outerRadius,
        y: Math.sin(angle) * outerRadius
      });
    }
    
    // Inner ring points (reverse order for proper winding)
    for (let i = numPoints - 1; i >= 0; i--) {
      const angle = (i / numPoints) * Math.PI * 2;
      this.points.push({
        x: Math.cos(angle) * innerRadius,
        y: Math.sin(angle) * innerRadius
      });
    }
    this.closed = true;
  }

  private generateSplineCirclePoints(): void {
    const radius = this.radius!;
    // Four-segment Bézier circle approximation
    // Control point distance for accurate circle approximation
    const kappa = 0.5522848; // (4/3) * tan(π/8) - magic number for Bézier circle
    const cp = kappa * radius; // Control point distance from anchor points
    
    // Four anchor points (cardinal directions)
    this.points = [
      { x: radius, y: 0 },     // Right
      { x: 0, y: -radius },    // Top
      { x: -radius, y: 0 },    // Left  
      { x: 0, y: radius }      // Bottom
    ];
    
    // Four segments with control points for smooth Bézier curves
    this.controlPoints = [
      { x: radius, y: -cp },   // First control point for segment 0→1
      { x: cp, y: -radius },   // Second control point for segment 0→1
      { x: -cp, y: -radius },  // First control point for segment 1→2
      { x: -radius, y: -cp },  // Second control point for segment 1→2
      { x: -radius, y: cp },   // First control point for segment 2→3
      { x: -cp, y: radius },   // Second control point for segment 2→3
      { x: cp, y: radius },    // First control point for segment 3→0
      { x: radius, y: cp }     // Second control point for segment 3→0
    ];
    
    this.closed = true;
    this.renderType = 'bezier';
    this.segments = 4; // Four Bézier segments
  }

  private generateSplineEllipsePoints(): void {
    const w = this.width! / 2;
    const h = this.height! / 2;
    // Control point distances for ellipse approximation
    const kappaX = 0.5522848 * w;
    const kappaY = 0.5522848 * h;
    
    // Four anchor points
    this.points = [
      { x: w, y: 0 },      // Right
      { x: 0, y: -h },     // Top
      { x: -w, y: 0 },     // Left
      { x: 0, y: h }       // Bottom
    ];
    
    // Control points for ellipse segments
    this.controlPoints = [
      { x: w, y: -kappaY },     // First control point for segment 0→1
      { x: kappaX, y: -h },     // Second control point for segment 0→1
      { x: -kappaX, y: -h },    // First control point for segment 1→2
      { x: -w, y: -kappaY },    // Second control point for segment 1→2
      { x: -w, y: kappaY },     // First control point for segment 2→3
      { x: -kappaX, y: h },     // Second control point for segment 2→3
      { x: kappaX, y: h },      // First control point for segment 3→0
      { x: w, y: kappaY }       // Second control point for segment 3→0
    ];
    
    this.closed = true;
    this.renderType = 'bezier';
    this.segments = 4;
  }

  private generateSplineRingPoints(): void {
    const outerRadius = this.radius!;
    const innerRadius = this.innerRadius!;
    const outerKappa = 0.5522848 * outerRadius;
    const innerKappa = 0.5522848 * innerRadius;
    
    // Outer circle points (4 segments)
    this.points = [
      { x: outerRadius, y: 0 },     // Outer right
      { x: 0, y: -outerRadius },    // Outer top
      { x: -outerRadius, y: 0 },    // Outer left
      { x: 0, y: outerRadius },     // Outer bottom
      // Inner circle points (reverse order for proper winding)
      { x: 0, y: innerRadius },     // Inner bottom
      { x: -innerRadius, y: 0 },    // Inner left
      { x: 0, y: -innerRadius },    // Inner top
      { x: innerRadius, y: 0 }      // Inner right
    ];
    
    // Control points for both outer and inner circles
    this.controlPoints = [
      // Outer circle control points
      { x: outerRadius, y: -outerKappa },
      { x: outerKappa, y: -outerRadius },
      { x: -outerKappa, y: -outerRadius },
      { x: -outerRadius, y: -outerKappa },
      { x: -outerRadius, y: outerKappa },
      { x: -outerKappa, y: outerRadius },
      { x: outerKappa, y: outerRadius },
      { x: outerRadius, y: outerKappa },
      // Inner circle control points (reverse order)
      { x: -innerKappa, y: innerRadius },
      { x: -innerRadius, y: innerKappa },
      { x: -innerRadius, y: -innerKappa },
      { x: -innerKappa, y: -innerRadius },
      { x: innerKappa, y: -innerRadius },
      { x: innerRadius, y: -innerKappa },
      { x: innerRadius, y: innerKappa },
      { x: innerKappa, y: innerRadius }
    ];
    
    this.closed = true;
    this.renderType = 'bezier';
    this.segments = 8; // Four segments for outer + four for inner
  }

  private generateSmoothSplinePoints(numPoints?: number, batchConfig?: any): void {
    let pointCount = numPoints || 4 + Math.floor(Math.random() * 6); // 4-10 points for variety
    this.points = [];
    this.controlPoints = [];
    
    // Get spline positioning ranges from batch config if available
    let pointPositionRange = [-50, 50]; // Default range for point positioning
    let controlPointRange = [-25, 25]; // Default range for control point positioning
    
    if (batchConfig?.propertiesEnabled && batchConfig?.splinePropertiesEnabled) {
      if (batchConfig?.splinePointPositionRange) {
        pointPositionRange = batchConfig.splinePointPositionRange;
      }
      if (batchConfig?.splineControlPointRange) {
        controlPointRange = batchConfig.splineControlPointRange;
      }
    } else if (batchConfig?.scatterSettings?.shapeSpecific?.['smooth-spline']) {
      if (batchConfig.scatterSettings.shapeSpecific['smooth-spline'].pointPositionRange) {
        pointPositionRange = batchConfig.scatterSettings.shapeSpecific['smooth-spline'].pointPositionRange;
      }
      if (batchConfig.scatterSettings.shapeSpecific['smooth-spline'].controlPointRange) {
        controlPointRange = batchConfig.scatterSettings.shapeSpecific['smooth-spline'].controlPointRange;
      }
    }
    
    const [minPointPos, maxPointPos] = pointPositionRange;
    const [minControlPos, maxControlPos] = controlPointRange;

    const settings = batchConfig?.scatterSettings?.shapeSpecific?.['smooth-spline'];

    // Use batch config settings for open/closed probability if available
    let openProbability = 30; // Default 30% open (70% closed)
    if (settings?.openProbability !== undefined) {
      openProbability = settings.openProbability;
    }
    
    this.closed = Math.random() * 100 > openProbability;
    
    const baseRadius = 50 + Math.random() * 80;
    const variation = 0.4 + Math.random() * 0.4; // Control point variation

    // Resolve shared curve pattern params (size/wobble/pattern) for open splines
    let curvature = 0.3 + Math.random() * 0.4;
    let spread = baseRadius;
    let patternType = 1; // Wave (matches the previous open-spline look)
    if (settings) {
      if (settings.pointCountMode === 'incremental') {
        const start = settings.pointCountStartValue ?? 3;
        const inc = settings.pointCountIncrement ?? 0;
        const boundMax = settings.pointCountBoundMax ?? 10;
        pointCount = Math.max(2, Math.min(boundMax, Math.round(start + inc * (batchConfig?.generationIndex || 0))));
      } else if (settings.pointCountRange) {
        const [min, max] = settings.pointCountRange;
        pointCount = Math.floor(min + Math.random() * (max - min + 1));
      }
      if (settings.curvatureRange) {
        const [min, max] = settings.curvatureRange;
        curvature = min + Math.random() * (max - min);
      }
      if (settings.spreadRange) {
        const [min, max] = settings.spreadRange;
        spread = min + Math.random() * (max - min);
      }
      if (settings.patternType !== undefined) {
        patternType = settings.patternType;
      }
    }

    if (patternType === -1) {
      // None pattern: evenly spaced points along x-axis, y=0 (straight line).
      (this as any)._curveEffectivePointCount = undefined;
      this.points = [];
      for (let i = 0; i < pointCount; i++) {
        const t = pointCount > 1 ? i / (pointCount - 1) : 0.5;
        this.points.push({ x: (t - 0.5) * spread * 2, y: 0 });
      }
    } else {
      // Pattern Resample: override pointCount with pattern-geometry-driven count when enabled
      const _splineResample = _resolvePatternResampleCount(settings, patternType, spread, batchConfig?.generationIndex ?? 0);
      if (_splineResample !== undefined) {
        pointCount = _splineResample;
        (this as any)._curveEffectivePointCount = _splineResample;
      } else {
        (this as any)._curveEffectivePointCount = undefined;
      }

      const _spGenIdx = batchConfig?.generationIndex ?? 0;
      this.generateCurvePatternPoints(
        pointCount, spread, curvature, patternType,
        _buildPatternControls(settings, spread, _spGenIdx),
      );
    }

    // Apply Curve Length: rescale x-extent BEFORE adding position jitter so jitter
    // magnitude is independent of the length stretch.
    _applyCurveLengthToPoints(this.points, settings, batchConfig?.generationIndex ?? 0);

    // Position jitter is only applied for the legacy "None" pattern (patternType === -1).
    // Pattern types (Wave/Spiral/Arc/Organic) generate geometrically-correct anchor points
    // that must not be randomly displaced — the jitter destroys the pattern geometry and
    // makes wave/spiral/arc shapes look like random squiggles.
    if (patternType === -1) {
      for (const pt of this.points) {
        pt.x += minPointPos + Math.random() * (maxPointPos - minPointPos);
        pt.y += minPointPos + Math.random() * (maxPointPos - minPointPos);
      }
    }

    // Apply curve direction rotation before handle generation (smooth-spline).
    if (this.points.length >= 2) {
      const _dirAngle = _resolveCurveDirectionAngle(settings);
      if (_dirAngle !== 0) _rotateCurvePoints(this.points, _dirAngle);
    }

    // Resolve curve tension (handle length). Supports fixed and range modes,
    // matching the cubic generator. Falls back to 30% (= historical 0.3 factor).
    let tensionPercent = settings?.curveTension ?? 30;
    if (settings?.curveTensionMode === 'fixed' && settings?.curveTensionValue !== undefined) {
      tensionPercent = settings.curveTensionValue;
    } else if (settings?.curveTensionRange) {
      const [tMin, tMax] = settings.curveTensionRange;
      tensionPercent = tMin + Math.random() * (tMax - tMin);
    }
    const tensionFactor = tensionPercent / 100;
    const endpointContinuous = settings?.endpointContinuous ?? false;

    // Generate mathematically continuous tangent handles for smooth splines
    this.generateSmoothTangentHandles(tensionFactor, endpointContinuous);

    // Recenter geometry on its bounding-box center (see generateCubicCurvePoints).
    this.recenterPointsAndHandles();

    // When closed, optionally average the first/last points to a shared midpoint.
    const closeAverageProbability = settings?.closeAverageProbability ?? 0;
    if (this.closed && Math.random() * 100 < closeAverageProbability) {
      this.averageCurveEndpoints();
    }

    this.renderType = 'bezier'; // Use bezier rendering for smooth curves
    this.segments = this.closed ? pointCount : pointCount - 1;
    
    // Set stroke cap based on normalized probabilities
    const strokeCapProbabilities = batchConfig?.scatterSettings?.shapeSpecific?.['smooth-spline']?.strokeCapProbabilities || { round: 33, square: 33, butt: 34 };
    this.strokeCap = selectStrokeCap(strokeCapProbabilities);
  }

  render(ctx: CanvasRenderingContext2D, skipSelectionAdornments = false): void {
    if (!this.points || this.points.length === 0) {
      return;
    }
    
    ctx.save();
    
    // Apply blend mode
    ctx.globalCompositeOperation = this.properties.blendMode;
    
    // Apply transform
    ctx.translate(this.transform.x, this.transform.y);
    ctx.rotate(this.transform.rotation * Math.PI / 180);
    ctx.scale(this.transform.scaleX, this.transform.scaleY);
    ctx.transform(1, this.transform.skewX, this.transform.skewY, 1, 0, 0);
    
    // Check if any effects need to be applied
    const hasEffects = this.hasAnyEffect();
    
    if (hasEffects || this.properties.blurRadius > 0) {
      this.renderWithEffects(ctx);
    } else {
      // Draw shape normally
      this.drawShape(ctx);
    }

    // Draw selection indicator (skip when rendering to offscreen canvas for compositing)
    if (this.selected && !skipSelectionAdornments) {
      ctx.globalCompositeOperation = 'source-over'; // Reset blend mode for selection
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#2563EB';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      this.drawSelectionBounds(ctx);
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Wire post-pass — drawn OUTSIDE the shape's transform context so that non-uniform
    // scale / skew cannot distort dot shapes (ctx.arc would produce ellipses) or line widths.
    //
    // We manually replicate the shape's own transform in the correct order to produce
    // artboard-space coordinates.  After ctx.restore() the canvas is in pan+zoom space,
    // so artboard-space points draw at exactly the right screen positions.
    //
    // Canvas transform order (applied left-to-right, i.e. innermost first on the point):
    //   ctx.transform(1, skewX, skewY, 1, 0, 0)  ← shear K
    //   ctx.scale(scaleX, scaleY)                 ← scale S
    //   ctx.rotate(rotation)                      ← rotation R
    //   ctx.translate(tx, ty)                     ← translation T
    //
    // So: artboard_pos = T(R(S(K(local_pt))))
    if (this.wireConfig?.enabled) {
      const { x: tx, y: ty, rotation, scaleX, scaleY, skewX, skewY } = this.transform;
      const θ = rotation * Math.PI / 180;
      const cosθ = Math.cos(θ), sinθ = Math.sin(θ);

      const artboardPts = this.points.map(p => {
        // K — shear: ctx.transform(1, skewX, skewY, 1, 0, 0) maps (px,py) → (px + skewY·py, skewX·px + py)
        const kx = p.x + skewY * p.y;
        const ky = skewX * p.x + p.y;
        // S — scale
        const sx = scaleX * kx;
        const sy = scaleY * ky;
        // R — rotate
        const rx = cosθ * sx - sinθ * sy;
        const ry = sinθ * sx + cosθ * sy;
        // T — translate
        return { x: rx + tx, y: ry + ty };
      });

      const wireProxy: import('@shared/renderModeUtils').WireShapeContext = {
        type: this.type,
        points: artboardPts,
        properties: {
          fillColor:     this.properties.fillColor,
          strokeColor:   this.properties.strokeColor,
          fillOpacity:   this.properties.fillOpacity,
          strokeOpacity: this.properties.strokeOpacity,
          gradient:      this.properties.gradient,
        },
        renderModeOverride: this.renderModeOverride,
      };
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      drawWirePass(ctx as any, wireProxy, this.wireConfig, undefined);
    }
  }

  private hasAnyEffect(): boolean {
    return !!(
      this.properties.dropShadow?.enabled ||
      this.properties.outerGlow?.enabled ||
      this.properties.innerShadow?.enabled ||
      this.properties.innerGlow?.enabled
    );
  }

  private renderWithEffects(ctx: CanvasRenderingContext2D): void {
    const bounds = this.getBounds();
    const blurRadius = Math.max(0, this.properties.blurRadius);
    
    // Calculate maximum effect expansion needed
    let maxExpansion = blurRadius * 2;
    if (this.properties.dropShadow?.enabled) {
      const ds = this.properties.dropShadow;
      maxExpansion = Math.max(maxExpansion, Math.abs(ds.offsetX) + ds.blur + ds.spread + 10);
      maxExpansion = Math.max(maxExpansion, Math.abs(ds.offsetY) + ds.blur + ds.spread + 10);
    }
    if (this.properties.outerGlow?.enabled) {
      const og = this.properties.outerGlow;
      maxExpansion = Math.max(maxExpansion, og.blur + og.spread + 10);
    }
    
    const expandedBounds = {
      x: bounds.x - maxExpansion,
      y: bounds.y - maxExpansion,
      width: bounds.width + maxExpansion * 2,
      height: bounds.height + maxExpansion * 2
    };
    
    // Create main compositing canvas
    const compositeCanvas = document.createElement('canvas');
    const compositeCtx = compositeCanvas.getContext('2d')!;
    compositeCanvas.width = expandedBounds.width;
    compositeCanvas.height = expandedBounds.height;
    compositeCtx.translate(-expandedBounds.x, -expandedBounds.y);
    
    // 1. Render Drop Shadow (beneath everything)
    if (this.properties.dropShadow?.enabled) {
      this.renderDropShadow(compositeCtx, expandedBounds);
    }
    
    // 2. Render Outer Glow (beneath shape, above shadow)
    if (this.properties.outerGlow?.enabled) {
      this.renderOuterGlow(compositeCtx, expandedBounds);
    }
    
    // 3. Draw the main shape (with blur if needed - blur only affects shape, not inner effects)
    if (blurRadius > 0) {
      // Create separate canvas for shape with blur
      const shapeCanvas = document.createElement('canvas');
      const shapeCtx = shapeCanvas.getContext('2d')!;
      shapeCanvas.width = expandedBounds.width;
      shapeCanvas.height = expandedBounds.height;
      shapeCtx.translate(-expandedBounds.x, -expandedBounds.y);
      
      // Draw shape on separate canvas
      shapeCtx.save();
      this.drawShape(shapeCtx);
      shapeCtx.restore();
      
      // Apply blur to shape only
      const blurredData = this.applyGaussianBlur(shapeCtx, shapeCanvas.width, shapeCanvas.height, blurRadius, this.properties.blurType ?? 'box');
      shapeCtx.putImageData(blurredData, 0, 0);
      
      // Composite blurred shape
      compositeCtx.save();
      compositeCtx.translate(expandedBounds.x, expandedBounds.y);
      compositeCtx.drawImage(shapeCanvas, 0, 0);
      compositeCtx.restore();
    } else {
      // Draw shape directly without blur
      compositeCtx.save();
      this.drawShape(compositeCtx);
      compositeCtx.restore();
    }
    
    // 4. Render Inner Shadow (inside shape, crisp on top of possibly blurred shape)
    if (this.properties.innerShadow?.enabled) {
      this.renderInnerShadow(compositeCtx, expandedBounds);
    }
    
    // 5. Render Inner Glow (inside shape, crisp on top of everything)
    if (this.properties.innerGlow?.enabled) {
      this.renderInnerGlow(compositeCtx, expandedBounds);
    }
    
    // Draw final composite to main canvas
    ctx.drawImage(compositeCanvas, expandedBounds.x, expandedBounds.y);
  }

  private renderDropShadow(ctx: CanvasRenderingContext2D, expandedBounds: { x: number; y: number; width: number; height: number }): void {
    const shadow = this.properties.dropShadow!;
    const blurRadius = Math.max(1, Math.min(30, shadow.blur));
    
    // Create shadow canvas
    const shadowCanvas = document.createElement('canvas');
    const shadowCtx = shadowCanvas.getContext('2d')!;
    shadowCanvas.width = expandedBounds.width;
    shadowCanvas.height = expandedBounds.height;
    
    // Translate and offset for shadow position
    shadowCtx.translate(-expandedBounds.x + shadow.offsetX, -expandedBounds.y + shadow.offsetY);
    
    // Draw shape silhouette for shadow
    shadowCtx.save();
    this.drawShapePath(shadowCtx);
    shadowCtx.fillStyle = shadow.color;
    shadowCtx.globalAlpha = shadow.opacity / 100;
    shadowCtx.fill();
    shadowCtx.restore();
    
    // Apply spread by scaling if needed
    if (shadow.spread > 0) {
      // Spread is handled by expanding the shape slightly - simplified for now
    }
    
    // Apply blur to shadow
    if (blurRadius > 1) {
      const blurredData = this.applyGaussianBlur(shadowCtx, shadowCanvas.width, shadowCanvas.height, blurRadius);
      shadowCtx.putImageData(blurredData, 0, 0);
    }
    
    // Composite shadow to main canvas with blend mode
    ctx.save();
    ctx.translate(expandedBounds.x, expandedBounds.y);
    ctx.globalCompositeOperation = shadow.blendMode;
    ctx.drawImage(shadowCanvas, 0, 0);
    ctx.restore();
  }

  private renderOuterGlow(ctx: CanvasRenderingContext2D, expandedBounds: { x: number; y: number; width: number; height: number }): void {
    const glow = this.properties.outerGlow!;
    const blurRadius = Math.max(1, Math.min(30, glow.blur));
    
    // Create glow canvas
    const glowCanvas = document.createElement('canvas');
    const glowCtx = glowCanvas.getContext('2d')!;
    glowCanvas.width = expandedBounds.width;
    glowCanvas.height = expandedBounds.height;
    glowCtx.translate(-expandedBounds.x, -expandedBounds.y);
    
    // Draw shape silhouette for glow
    glowCtx.save();
    this.drawShapePath(glowCtx);
    glowCtx.fillStyle = glow.color;
    glowCtx.globalAlpha = glow.opacity / 100;
    glowCtx.fill();
    glowCtx.restore();
    
    // Apply blur to create glow effect
    if (blurRadius > 1) {
      const blurredData = this.applyGaussianBlur(glowCtx, glowCanvas.width, glowCanvas.height, blurRadius);
      glowCtx.putImageData(blurredData, 0, 0);
    }
    
    // Composite glow to main canvas with blend mode
    ctx.save();
    ctx.translate(expandedBounds.x, expandedBounds.y);
    // Map blend modes - 'add' is not a valid canvas composite operation, use 'lighter'
    const blendMode = glow.blendMode === 'add' ? 'lighter' : glow.blendMode;
    ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;
    ctx.drawImage(glowCanvas, 0, 0);
    ctx.restore();
  }

  private renderInnerShadow(ctx: CanvasRenderingContext2D, expandedBounds: { x: number; y: number; width: number; height: number }): void {
    const shadow = this.properties.innerShadow!;
    const blurRadius = Math.max(1, Math.min(20, shadow.blur));
    
    // Create inner shadow using inverted shape masking
    const shadowCanvas = document.createElement('canvas');
    const shadowCtx = shadowCanvas.getContext('2d')!;
    shadowCanvas.width = expandedBounds.width;
    shadowCanvas.height = expandedBounds.height;
    shadowCtx.translate(-expandedBounds.x, -expandedBounds.y);
    
    // Fill entire canvas with shadow color
    shadowCtx.save();
    shadowCtx.fillStyle = shadow.color;
    shadowCtx.globalAlpha = shadow.opacity / 100;
    shadowCtx.translate(shadow.offsetX, shadow.offsetY);
    
    // Draw inverted shape (everything except shape area)
    shadowCtx.fillRect(
      expandedBounds.x - shadow.offsetX - blurRadius * 2, 
      expandedBounds.y - shadow.offsetY - blurRadius * 2, 
      expandedBounds.width + blurRadius * 4, 
      expandedBounds.height + blurRadius * 4
    );
    
    // Cut out the shape area
    shadowCtx.globalCompositeOperation = 'destination-out';
    this.drawShapePath(shadowCtx);
    shadowCtx.fill();
    shadowCtx.restore();
    
    // Apply blur
    if (blurRadius > 1) {
      const blurredData = this.applyGaussianBlur(shadowCtx, shadowCanvas.width, shadowCanvas.height, blurRadius);
      shadowCtx.putImageData(blurredData, 0, 0);
    }
    
    // Mask to only show inside shape
    const maskCanvas = document.createElement('canvas');
    const maskCtx = maskCanvas.getContext('2d')!;
    maskCanvas.width = expandedBounds.width;
    maskCanvas.height = expandedBounds.height;
    maskCtx.translate(-expandedBounds.x, -expandedBounds.y);
    this.drawShapePath(maskCtx);
    maskCtx.fillStyle = '#ffffff';
    maskCtx.fill();
    
    // Apply mask
    shadowCtx.save();
    shadowCtx.translate(expandedBounds.x, expandedBounds.y);
    shadowCtx.globalCompositeOperation = 'destination-in';
    shadowCtx.drawImage(maskCanvas, 0, 0);
    shadowCtx.restore();
    
    // Composite to main canvas
    ctx.save();
    ctx.translate(expandedBounds.x, expandedBounds.y);
    ctx.globalCompositeOperation = shadow.blendMode;
    ctx.drawImage(shadowCanvas, 0, 0);
    ctx.restore();
  }

  private renderInnerGlow(ctx: CanvasRenderingContext2D, expandedBounds: { x: number; y: number; width: number; height: number }): void {
    const glow = this.properties.innerGlow!;
    const blurRadius = Math.max(1, Math.min(20, glow.blur));
    
    // Create inner glow using edge detection
    const glowCanvas = document.createElement('canvas');
    const glowCtx = glowCanvas.getContext('2d')!;
    glowCanvas.width = expandedBounds.width;
    glowCanvas.height = expandedBounds.height;
    glowCtx.translate(-expandedBounds.x, -expandedBounds.y);
    
    // Draw shape outline (stroke) for glow source
    glowCtx.save();
    this.drawShapePath(glowCtx);
    glowCtx.strokeStyle = glow.color;
    glowCtx.lineWidth = blurRadius * 2;
    glowCtx.globalAlpha = glow.opacity / 100;
    glowCtx.stroke();
    glowCtx.restore();
    
    // Apply blur to create glow effect
    if (blurRadius > 1) {
      const blurredData = this.applyGaussianBlur(glowCtx, glowCanvas.width, glowCanvas.height, blurRadius);
      glowCtx.putImageData(blurredData, 0, 0);
    }
    
    // Mask to only show inside shape
    const maskCanvas = document.createElement('canvas');
    const maskCtx = maskCanvas.getContext('2d')!;
    maskCanvas.width = expandedBounds.width;
    maskCanvas.height = expandedBounds.height;
    maskCtx.translate(-expandedBounds.x, -expandedBounds.y);
    this.drawShapePath(maskCtx);
    maskCtx.fillStyle = '#ffffff';
    maskCtx.fill();
    
    // Apply mask
    glowCtx.save();
    glowCtx.translate(expandedBounds.x, expandedBounds.y);
    glowCtx.globalCompositeOperation = 'destination-in';
    glowCtx.drawImage(maskCanvas, 0, 0);
    glowCtx.restore();
    
    // Composite to main canvas
    ctx.save();
    ctx.translate(expandedBounds.x, expandedBounds.y);
    // Map blend modes - 'add' is not a valid canvas composite operation, use 'lighter'
    const blendMode = glow.blendMode === 'add' ? 'lighter' : glow.blendMode;
    ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;
    ctx.drawImage(glowCanvas, 0, 0);
    ctx.restore();
  }

  private drawShapePath(ctx: CanvasRenderingContext2D): void {
    const rmo = this.renderModeOverride;
    ctx.beginPath();
    
    switch (this.type) {
      case 'rectangle':
      case 'square':
        if (rmo?.enabled) {
          this.drawPolygonPath(ctx);
        } else {
          ctx.rect(-(this.width ?? 0) / 2, -(this.height ?? 0) / 2, this.width ?? 0, this.height ?? 0);
        }
        break;
      case 'rounded-rectangle':
      case 'rounded-square':
        if (rmo?.enabled) {
          this.drawPolygonPath(ctx);
        } else {
          this.drawRoundedRectanglePath(ctx);
        }
        break;
      case 'circle': {
        if (rmo?.enabled) {
          this.drawPolygonPath(ctx);
        } else {
          const r = this.radius ?? (this.width ?? 0) / 2;
          ctx.arc(0, 0, r, 0, Math.PI * 2);
        }
        break;
      }
      case 'ellipse':
        if (rmo?.enabled) {
          this.drawPolygonPath(ctx);
        } else {
          ctx.ellipse(0, 0, (this.width ?? 0) / 2, (this.height ?? 0) / 2, 0, 0, Math.PI * 2);
        }
        break;
      case 'spline-circle':
      case 'spline-ellipse':
      case 'spline-ring':
        this.drawSplineCubicBezier(ctx);
        break;
      case 'polygon':
      case 'triangle':
      case 'right-triangle':
      case 'trapezoid':
      case 'pentagon':
      case 'hexagon':
      case 'rhombus':
      case 'parallelogram':
      case 'kite':
      case 'semicircle':
      case 'heart':
      case 'arrow':
      case 'cross':
      case 'star':
        if (rmo?.enabled) {
          this.drawPolygonPath(ctx);
        } else {
          this.drawPolygonFlat(ctx);
        }
        break;
      case 'ring':
        if (rmo?.enabled) {
          if (this.points && this.points.length > 0) {
            let pts = this.points;
            if (this.localJitterConfig?.enabled) {
              pts = applyLocalJitter(pts, this.localJitterConfig, shapeIdToHash(this.id));
            }
            const halfPoints = Math.floor(pts.length / 2);
            drawContourWithConfig(ctx, pts.slice(0, halfPoints), rmo);
            drawContourWithConfig(ctx, pts.slice(halfPoints), rmo);
          }
        } else {
          this.drawPolygonFlat(ctx);
        }
        break;
      case 'line':
      case 'line-vector':
        this.drawLinePath(ctx);
        break;
      case 'bezier':
      case 'cubic':
      case 'smooth-spline':
        this.drawBezierPath(ctx);
        break;
      case 'chunk':
      case 'blob':
        if (rmo?.enabled) {
          this.drawPolygonPath(ctx);
        } else {
          this.drawPolygonFlat(ctx);
        }
        break;
      default:
        if (rmo?.enabled) {
          this.drawPolygonPath(ctx);
        } else {
          this.drawPolygonFlat(ctx);
        }
    }
  }

  private drawPolygonPath(ctx: CanvasRenderingContext2D): void {
    if (!this.points || this.points.length < 2) return;

    let pts = this.points;
    if (this.localJitterConfig?.enabled) {
      pts = applyLocalJitter(this.points, this.localJitterConfig, shapeIdToHash(this.id));
    }

    drawContourWithConfig(ctx, pts, this.renderModeOverride ?? DEFAULT_RENDER_MODE_OVERRIDE);
  }

  private drawRoundedRectanglePath(ctx: CanvasRenderingContext2D): void {
    if (!this.points || this.points.length < 4) return;
    const minX = Math.min(...this.points.map(p => p.x));
    const maxX = Math.max(...this.points.map(p => p.x));
    const minY = Math.min(...this.points.map(p => p.y));
    const maxY = Math.max(...this.points.map(p => p.y));
    const width = maxX - minX;
    const height = maxY - minY;
    const radius = Math.min(this.cornerRadius || 0, width / 2, height / 2);
    ctx.roundRect(minX, minY, width, height, radius);
  }

  private drawRingPath(ctx: CanvasRenderingContext2D): void {
    if (!this.points || this.points.length === 0) return;
    const outerCount = Math.ceil(this.points.length / 2);
    
    // Draw outer path
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < outerCount; i++) {
      ctx.lineTo(this.points[i].x, this.points[i].y);
    }
    ctx.closePath();
    
    // Draw inner path (reverse winding)
    if (this.points.length > outerCount) {
      ctx.moveTo(this.points[outerCount].x, this.points[outerCount].y);
      for (let i = this.points.length - 1; i >= outerCount; i--) {
        ctx.lineTo(this.points[i].x, this.points[i].y);
      }
      ctx.closePath();
    }
  }

  private drawLinePath(ctx: CanvasRenderingContext2D): void {
    if (!this.points || this.points.length < 2) return;
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      ctx.lineTo(this.points[i].x, this.points[i].y);
    }
  }

  private drawBezierPath(ctx: CanvasRenderingContext2D): void {
    if (!this.points || this.points.length < 2) return;
    
    ctx.moveTo(this.points[0].x, this.points[0].y);
    
    if (this.tangentHandles && this.tangentHandles.length >= this.points.length) {
      for (let i = 0; i < this.points.length - 1; i++) {
        const p0 = this.points[i];
        const p1 = this.points[i + 1];
        const h0 = this.tangentHandles[i];
        const h1 = this.tangentHandles[i + 1];
        
        ctx.bezierCurveTo(
          h0.out.x, h0.out.y,
          h1.in.x, h1.in.y,
          p1.x, p1.y
        );
      }
      
      if (this.closed && this.points.length > 2) {
        const lastIdx = this.points.length - 1;
        const lastPoint = this.points[lastIdx];
        const firstPoint = this.points[0];
        const lastHandle = this.tangentHandles[lastIdx];
        const firstHandle = this.tangentHandles[0];
        
        ctx.bezierCurveTo(
          lastHandle.out.x, lastHandle.out.y,
          firstHandle.in.x, firstHandle.in.y,
          firstPoint.x, firstPoint.y
        );
      }
    } else {
      // Catmull-Rom approximation fallback — consistent with tsDrawSmoothSpline.
      // Produces smooth bezier curves even when tangentHandles are absent,
      // which matters for the effect-mask path (drop shadow, glow).
      for (let i = 1; i < this.points.length; i++) {
        const p0 = this.points[i - 2] ?? this.points[i - 1];
        const p1 = this.points[i - 1];
        const p2 = this.points[i];
        const p3 = this.points[i + 1] ?? this.points[i];
        ctx.bezierCurveTo(
          p1.x + (p2.x - p0.x) * 0.3, p1.y + (p2.y - p0.y) * 0.3,
          p2.x - (p3.x - p1.x) * 0.3, p2.y - (p3.y - p1.y) * 0.3,
          p2.x, p2.y,
        );
      }
      if (this.closed) {
        ctx.closePath();
      }
    }
  }

  private renderWithCanvasBlur(ctx: CanvasRenderingContext2D): void {
    // Get the bounds of the shape for blur calculation
    const bounds = this.getBounds();
    const blurRadius = Math.max(0, this.properties.blurRadius);
    
    // Expand bounds to account for blur effect
    const expandedBounds = {
      x: bounds.x - blurRadius * 2,
      y: bounds.y - blurRadius * 2,
      width: bounds.width + blurRadius * 4,
      height: bounds.height + blurRadius * 4
    };
    
    // Create temporary canvas for shape rendering
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCanvas.width = expandedBounds.width;
    tempCanvas.height = expandedBounds.height;
    
    // Save current transform and translate temp context
    tempCtx.translate(-expandedBounds.x, -expandedBounds.y);
    
    // Draw shape on temporary canvas without transforms (they're already applied)
    tempCtx.save();
    this.drawShape(tempCtx);
    tempCtx.restore();
    
    // Apply blur effect to the temporary canvas
    const blurredImageData = this.applyGaussianBlur(tempCtx, tempCanvas.width, tempCanvas.height, blurRadius, this.properties.blurType ?? 'box');
    
    // Draw the blurred result back to the main canvas
    const blurredCanvas = document.createElement('canvas');
    const blurredCtx = blurredCanvas.getContext('2d')!;
    blurredCanvas.width = tempCanvas.width;
    blurredCanvas.height = tempCanvas.height;
    blurredCtx.putImageData(blurredImageData, 0, 0);
    
    // Draw blurred result to main canvas
    ctx.drawImage(blurredCanvas, expandedBounds.x, expandedBounds.y);
  }

  private applyGaussianBlur(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number, type: ShapeBlurType = 'box'): ImageData {
    const imageData = ctx.getImageData(0, 0, width, height);
    blurShapePixels(imageData.data, width, height, radius, type);
    return imageData;
  }

  private drawShape(ctx: CanvasRenderingContext2D): void {
    const browserCanvasFactory = (w: number, h: number): HTMLCanvasElement => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    };
    drawShapeToContext(ctx, this as unknown as ShapeRenderData, browserCanvasFactory);
  }

  private drawPolygon(ctx: CanvasRenderingContext2D): void {
    if (!this.points || this.points.length === 0) return;

    let pts = this.points;
    if (this.localJitterConfig?.enabled) {
      pts = applyLocalJitter(this.points, this.localJitterConfig, shapeIdToHash(this.id));
    }

    const rmo = this.renderModeOverride!;

    if (this.type === 'ring') {
      const halfPoints = Math.floor(pts.length / 2);
      drawContourWithConfig(ctx, pts.slice(0, halfPoints), rmo);
      drawContourWithConfig(ctx, pts.slice(halfPoints), rmo);
    } else {
      drawContourWithConfig(ctx, pts, rmo);
    }
  }

  private drawPolygonFlat(ctx: CanvasRenderingContext2D): void {
    if (!this.points || this.points.length === 0) return;

    let pts = this.points;
    if (this.localJitterConfig?.enabled) {
      pts = applyLocalJitter(this.points, this.localJitterConfig, shapeIdToHash(this.id));
    }

    if (this.type === 'ring') {
      const halfPoints = Math.floor(pts.length / 2);
      const outerPts = pts.slice(0, halfPoints);
      const innerPts = pts.slice(halfPoints);
      outerPts.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
      ctx.closePath();
      innerPts.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
      ctx.closePath();
    } else {
      pts.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
      ctx.closePath();
    }
  }

  private drawStar(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.sides! * 2; i++) {
      const angle = (i * Math.PI) / this.sides! - Math.PI / 2;
      const radius = i % 2 === 0 ? this.radius! : this.innerRadius!;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  private drawRoundedRectangle(ctx: CanvasRenderingContext2D): void {
    if (!this.width || !this.height || !this.cornerRadius) return;
    
    const w = this.width / 2;
    const h = this.height / 2;
    const radius = Math.min(this.cornerRadius, Math.min(w, h));
    
    // Use native roundRect() method for perfect rounded rectangles
    ctx.roundRect(-w, -h, this.width, this.height, radius);
  }

  private drawCubicCurve(ctx: CanvasRenderingContext2D): void {
    if (!this.points || this.points.length < 2) return;
    const rmo = this.renderModeOverride;
    if (rmo?.enabled && (rmo.smoothAlgorithm ?? 'chaikin') === 'catmull-rom') {
      applyCatmullRom(ctx, this.points, rmo.catmullAlpha ?? 0.5, this.closed ?? false, rmo.tension ?? 1);
      return;
    }
    if (rmo?.enabled && rmo.smoothAlgorithm === 'natural-cubic') {
      applyNaturalCubicSpline(ctx, this.points, this.closed ?? false, rmo.naturalCubicClamped ?? false);
      return;
    }
    ctx.moveTo(this.points[0].x, this.points[0].y);

    // Use tangent handles for smooth cubic curves, same as Bézier curves
    if (this.tangentHandles && this.tangentHandles.length > 0) {
      for (let i = 0; i < this.points.length - 1; i++) {
        const p1 = this.points[i];
        const p2 = this.points[i + 1];
        
        // Get tangent handles for smooth cubic interpolation
        const handle1 = this.tangentHandles[i]; // Current point's tangent handle
        const handle2 = this.tangentHandles[i + 1]; // Next point's tangent handle
        
        if (handle1 && handle2 && 'out' in handle1 && 'in' in handle2) {
          // Draw cubic Bézier curve with proper tangent continuity
          ctx.bezierCurveTo(
            handle1.out.x, handle1.out.y,
            handle2.in.x, handle2.in.y,
            p2.x, p2.y
          );
        } else {
          // Fallback to linear if handles missing
          ctx.lineTo(p2.x, p2.y);
        }
      }
    } else {
      // Fallback to simple quadratic curves if no tangent handles
      for (let i = 1; i < this.points.length; i++) {
        ctx.lineTo(this.points[i].x, this.points[i].y);
      }
    }

    // Close the path if this is a closed curve
    if (this.closed) {
      ctx.closePath();
    }
  }

  private drawLine(ctx: CanvasRenderingContext2D): void {
    const rmo = this.renderModeOverride;
    if (rmo?.enabled && (rmo.smoothAlgorithm ?? 'chaikin') === 'catmull-rom' && this.points.length >= 2) {
      applyCatmullRom(ctx, this.points, rmo.catmullAlpha ?? 0.5, false, rmo.tension ?? 1);
      return;
    }
    if (rmo?.enabled && rmo.smoothAlgorithm === 'natural-cubic' && this.points.length >= 2) {
      applyNaturalCubicSpline(ctx, this.points, false, rmo.naturalCubicClamped ?? false);
      return;
    }
    this.points.forEach((point, i) => {
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
  }

  private drawCurve(ctx: CanvasRenderingContext2D): void {
    if (this.points.length < 2) return;
    const rmo = this.renderModeOverride;
    if (rmo?.enabled && (rmo.smoothAlgorithm ?? 'chaikin') === 'catmull-rom') {
      applyCatmullRom(ctx, this.points, rmo.catmullAlpha ?? 0.5, this.closed ?? false, rmo.tension ?? 1);
      return;
    }
    if (rmo?.enabled && rmo.smoothAlgorithm === 'natural-cubic') {
      applyNaturalCubicSpline(ctx, this.points, this.closed ?? false, rmo.naturalCubicClamped ?? false);
      return;
    }
    ctx.moveTo(this.points[0].x, this.points[0].y);
    
    // Use renderType to determine how to draw curves
    const renderType = this.renderType || 'polygon';
    
    if (renderType === 'bezier' || renderType === 'cubic' || renderType === 'smooth') {
      if ((this.type === 'spline-circle' || this.type === 'spline-ellipse' || this.type === 'spline-ring') && this.controlPoints) {
        // Draw four-segment Bézier curves for spline-based shapes
        this.drawSplineCubicBezier(ctx);
      } else if (this.type === 'bezier' && this.controlPoints && this.controlPoints.length > 0 && this.points.length >= 2) {
        // Draw bezier curves using bezier curves with control points (only if control points actually exist)
        for (let i = 1; i < this.points.length; i++) {
          const controlIndex1 = (i - 1) * 2;
          const controlIndex2 = controlIndex1 + 1;
          
          if (controlIndex1 < this.controlPoints.length && controlIndex2 < this.controlPoints.length) {
            // Use two control points for proper bezier curve
            ctx.bezierCurveTo(
              this.controlPoints[controlIndex1].x,
              this.controlPoints[controlIndex1].y,
              this.controlPoints[controlIndex2].x,
              this.controlPoints[controlIndex2].y,
              this.points[i].x,
              this.points[i].y
            );
          } else {
            // Fallback to linear if control points are missing
            ctx.lineTo(this.points[i].x, this.points[i].y);
          }
        }
      } else if (this.type === 'bezier' && this.tangentHandles && this.points.length >= 2) {
        // Draw proper bezier curves using tangent handles
        for (let i = 0; i < this.points.length - 1; i++) {
          const p1 = this.points[i];
          const p2 = this.points[i + 1];
          
          if (i < this.tangentHandles.length && (i + 1) < this.tangentHandles.length) {
            const cp1 = this.tangentHandles[i].out;
            const cp2 = this.tangentHandles[i + 1].in;
            
            // Draw bezier curve
            ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
          } else {
            ctx.lineTo(p2.x, p2.y);
          }
        }
      } else {
        // Fallback for other curve types
        for (let i = 1; i < this.points.length; i++) {
          const prevPoint = this.points[i - 1];
          const currentPoint = this.points[i];
          const nextPoint = this.points[i + 1] || (this.closed ? this.points[0] : currentPoint);
          
          // Calculate control point for smooth curve
          const tension = 0.3;
          const controlX = currentPoint.x + (nextPoint.x - prevPoint.x) * tension;
          const controlY = currentPoint.y + (nextPoint.y - prevPoint.y) * tension;
          
          ctx.quadraticCurveTo(controlX, controlY, currentPoint.x, currentPoint.y);
        }
      }
    } else {
      // Draw straight lines between points
      for (let i = 1; i < this.points.length; i++) {
        ctx.lineTo(this.points[i].x, this.points[i].y);
      }
    }
    
    if (this.closed) ctx.closePath();
  }

  private drawChunk(ctx: CanvasRenderingContext2D): void {
    if (this.points.length < 3) return;

    if (!this.renderModeOverride?.enabled) {
      this.points.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
      ctx.closePath();
      return;
    }
    
    ctx.moveTo(this.points[0].x, this.points[0].y);
    
    // Use control points if available, otherwise generate them
    if (this.controlPoints && this.controlPoints.length > 0) {
      for (let i = 1; i < this.points.length; i++) {
        const controlIndex = (i - 1) % this.controlPoints.length;
        ctx.quadraticCurveTo(
          this.controlPoints[controlIndex].x,
          this.controlPoints[controlIndex].y,
          this.points[i].x,
          this.points[i].y
        );
      }
      // Close the curve back to the first point
      if (this.controlPoints.length > 0) {
        const lastControlIndex = this.controlPoints.length - 1;
        ctx.quadraticCurveTo(
          this.controlPoints[lastControlIndex].x,
          this.controlPoints[lastControlIndex].y,
          this.points[0].x,
          this.points[0].y
        );
      }
    } else {
      // Fallback to generated smooth curves
      for (let i = 1; i < this.points.length; i++) {
        const current = this.points[i];
        const next = this.points[(i + 1) % this.points.length];
        const cp1x = current.x;
        const cp1y = current.y;
        const cp2x = (current.x + next.x) / 2;
        const cp2y = (current.y + next.y) / 2;
        
        ctx.quadraticCurveTo(cp1x, cp1y, cp2x, cp2y);
      }
    }
    
    ctx.closePath();
  }

  private drawBlob(ctx: CanvasRenderingContext2D): void {
    if (this.points.length < 3) return;

    if (!this.renderModeOverride?.enabled) {
      this.points.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
      ctx.closePath();
      return;
    }
    
    ctx.moveTo(this.points[0].x, this.points[0].y);
    
    // Use bezier curves with tangent handles for smooth organic shapes
    if (this.tangentHandles && this.tangentHandles.length === this.points.length) {
      for (let i = 0; i < this.points.length; i++) {
        const current = this.points[i];
        const next = this.points[(i + 1) % this.points.length];
        const currentHandle = this.tangentHandles[i];
        const nextHandle = this.tangentHandles[(i + 1) % this.tangentHandles.length];
        
        // Create smooth bezier curve between points
        ctx.bezierCurveTo(
          currentHandle.out.x,
          currentHandle.out.y,
          nextHandle.in.x,
          nextHandle.in.y,
          next.x,
          next.y
        );
      }
    } else {
      // Fallback to generated smooth curves
      for (let i = 1; i < this.points.length; i++) {
        const current = this.points[i];
        const next = this.points[(i + 1) % this.points.length];
        const cp1x = current.x;
        const cp1y = current.y;
        const cp2x = (current.x + next.x) / 2;
        const cp2y = (current.y + next.y) / 2;
        
        ctx.quadraticCurveTo(cp1x, cp1y, cp2x, cp2y);
      }
    }
    
    ctx.closePath();
  }

  private drawRing(ctx: CanvasRenderingContext2D): void {
    ctx.arc(0, 0, this.radius!, 0, Math.PI * 2);
    ctx.arc(0, 0, this.innerRadius!, 0, Math.PI * 2, true);
  }

  private drawSplineCubicBezier(ctx: CanvasRenderingContext2D): void {
    if (!this.controlPoints || !this.points) return;
    
    if (this.type === 'spline-circle' || this.type === 'spline-ellipse') {
      // Four-segment Bézier curve (circle/ellipse)
      ctx.moveTo(this.points[0].x, this.points[0].y);
      
      // Draw four Bézier segments
      for (let i = 0; i < 4; i++) {
        const startPoint = this.points[i];
        const endPoint = this.points[(i + 1) % 4];
        const cp1 = this.controlPoints[i * 2];
        const cp2 = this.controlPoints[i * 2 + 1];
        
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, endPoint.x, endPoint.y);
      }
      
      if (this.closed) {
        ctx.closePath();
      }
    } else if (this.type === 'spline-ring') {
      // Outer ring - four Bézier segments
      ctx.moveTo(this.points[0].x, this.points[0].y);
      
      for (let i = 0; i < 4; i++) {
        const startPoint = this.points[i];
        const endPoint = this.points[(i + 1) % 4];
        const cp1 = this.controlPoints[i * 2];
        const cp2 = this.controlPoints[i * 2 + 1];
        
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, endPoint.x, endPoint.y);
      }
      ctx.closePath();
      
      // Inner ring - four Bézier segments (reverse order)
      ctx.moveTo(this.points[4].x, this.points[4].y);
      
      for (let i = 0; i < 4; i++) {
        const startPoint = this.points[4 + i];
        const endPoint = this.points[4 + ((i + 1) % 4)];
        const cp1 = this.controlPoints[8 + i * 2];
        const cp2 = this.controlPoints[8 + i * 2 + 1];
        
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, endPoint.x, endPoint.y);
      }
      ctx.closePath();
    }
  }

  private drawSmoothSpline(ctx: CanvasRenderingContext2D): void {
    if (this.points.length < 2) return;
    
    ctx.moveTo(this.points[0].x, this.points[0].y);
    
    // Use tangent handles for proper smooth spline curves
    if (this.tangentHandles && this.tangentHandles.length >= this.points.length) {
      // Draw smooth spline using bezier curves with tangent handles
      for (let i = 0; i < this.points.length - 1; i++) {
        const p1 = this.points[i];
        const p2 = this.points[i + 1];
        const cp1 = this.tangentHandles[i].out;
        const cp2 = this.tangentHandles[i + 1].in;
        
        // Draw bezier curve for smooth continuity
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
      }
      
      // Handle closed curves
      if (this.closed && this.points.length > 2) {
        const lastIndex = this.points.length - 1;
        const firstPoint = this.points[0];
        const cp1 = this.tangentHandles[lastIndex].out;
        const cp2 = this.tangentHandles[0].in;
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, firstPoint.x, firstPoint.y);
      }
    } else {
      // Fallback: use catmull-rom spline approximation
      for (let i = 1; i < this.points.length; i++) {
        const p0 = this.points[i - 2] || this.points[i - 1];
        const p1 = this.points[i - 1];
        const p2 = this.points[i];
        const p3 = this.points[i + 1] || this.points[i];
        
        // Catmull-Rom to Bezier conversion
        const tension = 0.3;
        const cp1x = p1.x + (p2.x - p0.x) * tension;
        const cp1y = p1.y + (p2.y - p0.y) * tension;
        const cp2x = p2.x - (p3.x - p1.x) * tension;
        const cp2y = p2.y - (p3.y - p1.y) * tension;
        
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
    }
    
    if (this.closed) ctx.closePath();
  }

  private drawSelectionBounds(ctx: CanvasRenderingContext2D): void {
    const bounds = this.getBounds();
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    
    // Add corner indicators for better visibility
    const cornerSize = 6;
    const corners = [
      [bounds.x, bounds.y],
      [bounds.x + bounds.width, bounds.y],
      [bounds.x + bounds.width, bounds.y + bounds.height],
      [bounds.x, bounds.y + bounds.height]
    ];
    
    ctx.fillStyle = '#2563EB';
    corners.forEach(([x, y]) => {
      ctx.fillRect(x - cornerSize/2, y - cornerSize/2, cornerSize, cornerSize);
    });
  }

  renderTransformHandles(ctx: CanvasRenderingContext2D, canvasZoom: number = 1, isTouchDevice: boolean = false): void {
    if (!this.selected || isTouchDevice) return; // Only show handles on non-touch devices
    
    ctx.save();
    
    // Get world-space bounds after transformation
    const worldBounds = this.getWorldBounds();
    
    // Handle size should be constant in screen space
    const handleSize = 8 / canvasZoom;
    const handleOffset = handleSize / 2;
    
    // Corner handles for scaling - use world bounds
    const corners = [
      { x: worldBounds.x - handleOffset, y: worldBounds.y - handleOffset }, // Top-left
      { x: worldBounds.x + worldBounds.width - handleOffset, y: worldBounds.y - handleOffset }, // Top-right
      { x: worldBounds.x + worldBounds.width - handleOffset, y: worldBounds.y + worldBounds.height - handleOffset }, // Bottom-right
      { x: worldBounds.x - handleOffset, y: worldBounds.y + worldBounds.height - handleOffset } // Bottom-left
    ];
    
    // Edge handles for scaling
    const edges = [
      { x: worldBounds.x + worldBounds.width / 2 - handleOffset, y: worldBounds.y - handleOffset }, // Top
      { x: worldBounds.x + worldBounds.width - handleOffset, y: worldBounds.y + worldBounds.height / 2 - handleOffset }, // Right
      { x: worldBounds.x + worldBounds.width / 2 - handleOffset, y: worldBounds.y + worldBounds.height - handleOffset }, // Bottom
      { x: worldBounds.x - handleOffset, y: worldBounds.y + worldBounds.height / 2 - handleOffset } // Left
    ];
    
    // Draw corner handles (for scaling)
    ctx.fillStyle = '#3B82F6';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1 / canvasZoom;
    
    corners.forEach(corner => {
      ctx.fillRect(corner.x, corner.y, handleSize, handleSize);
      ctx.strokeRect(corner.x, corner.y, handleSize, handleSize);
    });
    
    // Draw edge handles (for scaling)
    ctx.fillStyle = '#10B981';
    edges.forEach(edge => {
      ctx.fillRect(edge.x, edge.y, handleSize, handleSize);
      ctx.strokeRect(edge.x, edge.y, handleSize, handleSize);
    });
    
    // Draw rotation handle
    const rotationHandleDistance = Math.max(worldBounds.width, worldBounds.height) / 2 + 20 / canvasZoom;
    const rotationHandleX = worldBounds.x + worldBounds.width / 2 - handleOffset;
    const rotationHandleY = worldBounds.y - rotationHandleDistance - handleOffset;
    
    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(rotationHandleX + handleOffset, rotationHandleY + handleOffset, handleSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // Draw line connecting rotation handle to shape
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = 1 / canvasZoom;
    ctx.setLineDash([2 / canvasZoom, 2 / canvasZoom]);
    ctx.beginPath();
    ctx.moveTo(worldBounds.x + worldBounds.width / 2, worldBounds.y);
    ctx.lineTo(rotationHandleX + handleOffset, rotationHandleY + handleOffset);
    ctx.stroke();
    ctx.setLineDash([]);
    
    ctx.restore();
  }

  /**
   * Returns t values in (0,1) where the cubic Bézier derivative is zero for one axis.
   * Used to find the exact parametric extrema of a curve segment.
   * Control-point order: p0 → c1 → c2 → p3  (c1 = out-handle of p0, c2 = in-handle of p3)
   */
  private _cubicBezierExtremaT(p0: number, c1: number, c2: number, p3: number): number[] {
    const a = c1 - p0;
    const b = c2 - c1;
    const c = p3 - c2;
    const qa = a - 2 * b + c;
    const qb = 2 * (b - a);
    const qc = a;
    const ts: number[] = [];
    if (Math.abs(qa) < 1e-10) {
      if (Math.abs(qb) > 1e-10) {
        const t = -qc / qb;
        if (t > 0 && t < 1) ts.push(t);
      }
    } else {
      const disc = qb * qb - 4 * qa * qc;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        const t1 = (-qb + sq) / (2 * qa);
        const t2 = (-qb - sq) / (2 * qa);
        if (t1 > 0 && t1 < 1) ts.push(t1);
        if (t2 > 0 && t2 < 1) ts.push(t2);
      }
    }
    return ts;
  }

  /** Evaluate one axis of a cubic Bézier at parameter t. */
  private _evalCubicBezier(p0: number, c1: number, c2: number, p3: number, t: number): number {
    const mt = 1 - t;
    return mt * mt * mt * p0 + 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t * p3;
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    if (this.points.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    // For Bézier-based curves compute exact bounds by finding parametric extrema
    // of every segment.  Knot points are always ON the curve so they are included
    // first; then we solve the quadratic derivative for each segment's x and y
    // components and evaluate the curve at any roots in (0,1).
    if (
      (this.type === 'bezier' || this.type === 'cubic' || this.type === 'smooth-spline') &&
      this.tangentHandles && this.tangentHandles.length >= this.points.length &&
      this.points.length >= 2
    ) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      for (const p of this.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }

      const segCount = this.closed ? this.points.length : this.points.length - 1;
      for (let i = 0; i < segCount; i++) {
        const ni = this.closed ? (i + 1) % this.points.length : i + 1;
        const p0 = this.points[i];
        const p3 = this.points[ni];
        const c1 = this.tangentHandles[i].out;
        const c2 = this.tangentHandles[ni].in;

        for (const t of this._cubicBezierExtremaT(p0.x, c1.x, c2.x, p3.x)) {
          const x = this._evalCubicBezier(p0.x, c1.x, c2.x, p3.x, t);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
        for (const t of this._cubicBezierExtremaT(p0.y, c1.y, c2.y, p3.y)) {
          const y = this._evalCubicBezier(p0.y, c1.y, c2.y, p3.y, t);
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }

      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    // All other shape types: bounds from knot / polygon points
    const xs = this.points.map(p => p.x);
    const ys = this.points.map(p => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }

  getWorldBounds(): { x: number; y: number; width: number; height: number } {
    if (this.points.length === 0) {
      return { x: this.transform.x, y: this.transform.y, width: 0, height: 0 };
    }

    // Transform all points to world space
    const worldPoints = this.points.map(p => {
      // Apply scale
      let x = p.x * this.transform.scaleX;
      let y = p.y * this.transform.scaleY;
      
      // Apply skew
      x += y * Math.tan(this.transform.skewX * Math.PI / 180);
      y += x * Math.tan(this.transform.skewY * Math.PI / 180);
      
      // Apply rotation
      const rotationRad = this.transform.rotation * Math.PI / 180;
      const cos = Math.cos(rotationRad);
      const sin = Math.sin(rotationRad);
      const rotatedX = x * cos - y * sin;
      const rotatedY = x * sin + y * cos;
      
      // Apply translation
      return {
        x: this.transform.x + rotatedX,
        y: this.transform.y + rotatedY
      };
    });

    const xs = worldPoints.map(p => p.x);
    const ys = worldPoints.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  containsPoint(x: number, y: number): boolean {
    // Transform the world point to local space using inverse transformation
    let localX = x - this.transform.x;
    let localY = y - this.transform.y;
    
    // Inverse rotation
    if (this.transform.rotation !== 0) {
      const cos = Math.cos(-this.transform.rotation * Math.PI / 180);
      const sin = Math.sin(-this.transform.rotation * Math.PI / 180);
      const rotatedX = localX * cos - localY * sin;
      const rotatedY = localX * sin + localY * cos;
      localX = rotatedX;
      localY = rotatedY;
    }
    
    // Inverse skew (approximate)
    if (this.transform.skewX !== 0) localX -= localY * Math.tan(this.transform.skewX);
    if (this.transform.skewY !== 0) localY -= localX * Math.tan(this.transform.skewY);
    
    // Inverse scale
    if (this.transform.scaleX !== 0) localX /= this.transform.scaleX;
    if (this.transform.scaleY !== 0) localY /= this.transform.scaleY;
    
    // Use pixel-perfect detection instead of bounding box
    return this.isPointInsideShape(localX, localY);
  }

  private isPointInsideShape(x: number, y: number): boolean {
    if (this.points.length === 0) return false;
    
    // Check if points have been manually edited by comparing with original geometry
    const hasEditedPoints = this.hasEditedGeometry();
    
    // For shapes with edited points, always use point-based detection
    if (hasEditedPoints) {
      if (this.type === 'line') {
        return this.isPointOnLine(x, y);
      } else {
        return this.isPointInPolygon(x, y);
      }
    }
    
    // For unedited shapes, use optimized detection algorithms
    switch (this.type) {
      case 'circle':
      case 'ellipse':
        return this.isPointInEllipse(x, y);
      case 'polygon':
      case 'star':
      case 'ring':
        return this.isPointInPolygon(x, y);
      case 'rectangle':
        return this.isPointInRectangle(x, y);
      case 'line':
        return this.isPointOnLine(x, y);
      case 'line-vector':
        return this.isPointOnLine(x, y); // Use same hit detection as regular line
      case 'blob':
        return this.isPointInPolygon(x, y);
      default:
        return this.isPointInPolygon(x, y);
    }
  }

  private isPointInEllipse(x: number, y: number): boolean {
    // For circles, use radius; for ellipses, use width/height
    if (this.type === 'circle') {
      if (!this.radius) return false;
      const distance = Math.sqrt(x * x + y * y);
      return distance <= this.radius;
    } else {
      // Ellipse case
      if (!this.width || !this.height) return false;
      const cx = 0; // Center at origin in local space
      const cy = 0;
      const rx = this.width / 2;
      const ry = this.height / 2;
      
      const dx = x - cx;
      const dy = y - cy;
      return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
    }
  }

  private isPointInRectangle(x: number, y: number): boolean {
    if (!this.width || !this.height) return false;
    return x >= -this.width / 2 && x <= this.width / 2 &&
           y >= -this.height / 2 && y <= this.height / 2;
  }

  private isPointOnLine(x: number, y: number, tolerance: number = 3): boolean {
    if (this.points.length < 2) return false;
    
    for (let i = 0; i < this.points.length - 1; i++) {
      const p1 = this.points[i];
      const p2 = this.points[i + 1];
      
      const distance = this.distanceToLineSegment(x, y, p1.x, p1.y, p2.x, p2.y);
      if (distance <= tolerance) return true;
    }
    return false;
  }

  private isPointInPolygon(x: number, y: number): boolean {
    if (this.points.length < 3) return false;
    
    let inside = false;
    for (let i = 0, j = this.points.length - 1; i < this.points.length; j = i++) {
      const xi = this.points[i].x;
      const yi = this.points[i].y;
      const xj = this.points[j].x;
      const yj = this.points[j].y;
      
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  private distanceToLineSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) {
      param = dot / lenSq;
    }

    let xx, yy;
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  worldDeltaToLocal(worldDeltaX: number, worldDeltaY: number): Point {
    // Transform world space delta to local space delta
    let localDeltaX = worldDeltaX;
    let localDeltaY = worldDeltaY;
    
    // Inverse rotation
    if (this.transform.rotation !== 0) {
      const rotationRad = -this.transform.rotation * Math.PI / 180;
      const cos = Math.cos(rotationRad);
      const sin = Math.sin(rotationRad);
      const rotatedX = localDeltaX * cos - localDeltaY * sin;
      const rotatedY = localDeltaX * sin + localDeltaY * cos;
      localDeltaX = rotatedX;
      localDeltaY = rotatedY;
    }
    
    // Inverse scale
    if (this.transform.scaleX !== 0) localDeltaX /= this.transform.scaleX;
    if (this.transform.scaleY !== 0) localDeltaY /= this.transform.scaleY;
    
    return { x: localDeltaX, y: localDeltaY };
  }

  getPointAt(index: number): Point | null {
    if (!this.points || index < 0 || index >= this.points.length) return null;
    return { ...this.points[index] };
  }

  getWorldPoint(index: number): Point | null {
    const localPoint = this.getPointAt(index);
    if (!localPoint) return null;
    
    // Apply full transformation matrix: scale, rotation, skew, then translate
    const rotationRad = this.transform.rotation * Math.PI / 180;
    const cos = Math.cos(rotationRad);
    const sin = Math.sin(rotationRad);
    
    // Apply scale
    let x = localPoint.x * this.transform.scaleX;
    let y = localPoint.y * this.transform.scaleY;
    
    // Apply skew
    x += y * Math.tan(this.transform.skewX);
    y += x * Math.tan(this.transform.skewY);
    
    // Apply rotation
    const rotatedX = x * cos - y * sin;
    const rotatedY = x * sin + y * cos;
    
    // Apply translation
    return {
      x: this.transform.x + rotatedX,
      y: this.transform.y + rotatedY
    };
  }

  updateShapeFromPoints(): void {
    // Allow direct point manipulation for all shapes - no regeneration
    // This enables free-form deformation instead of scaling
    // The shape will render using the modified points directly
  }

  updatePoint(index: number, newPoint: Point): void {
    // Handle control points (offset by 1000)
    if (index >= 1000) {
      const controlIndex = index - 1000;
      if (!this.controlPoints || controlIndex < 0 || controlIndex >= this.controlPoints.length) return;
      this.controlPoints[controlIndex] = { ...newPoint };
      return;
    }
    
    // Handle regular points
    if (!this.points || index < 0 || index >= this.points.length) return;
    this.points[index] = { ...newPoint };
    
    // For geometric shapes, recalculate dimensions based on modified points
    this.updateShapeFromPoints();
  }

  updateWorldPoint(index: number, worldPoint: Point): void {
    // Handle control points (offset by 1000)
    if (index >= 1000) {
      const controlIndex = index - 1000;
      if (!this.controlPoints || controlIndex < 0 || controlIndex >= this.controlPoints.length) return;
      
      // Inverse transformation for control points
      let x = worldPoint.x - this.transform.x;
      let y = worldPoint.y - this.transform.y;
      
      // Inverse rotation
      const rotationRad = -this.transform.rotation * Math.PI / 180;
      const cos = Math.cos(rotationRad);
      const sin = Math.sin(rotationRad);
      const unrotatedX = x * cos - y * sin;
      const unrotatedY = x * sin + y * cos;
      
      x = unrotatedX;
      y = unrotatedY;
      
      // Inverse skew (approximate)
      x -= y * Math.tan(this.transform.skewX);
      y -= x * Math.tan(this.transform.skewY);
      
      // Inverse scale
      const localControl = {
        x: x / this.transform.scaleX,
        y: y / this.transform.scaleY
      };
      
      this.controlPoints[controlIndex] = localControl;
      return;
    }
    
    // Handle regular points
    // Inverse transformation: translate, then inverse rotate, skew, and scale
    let x = worldPoint.x - this.transform.x;
    let y = worldPoint.y - this.transform.y;
    
    // Inverse rotation
    const rotationRad = -this.transform.rotation * Math.PI / 180;
    const cos = Math.cos(rotationRad);
    const sin = Math.sin(rotationRad);
    const unrotatedX = x * cos - y * sin;
    const unrotatedY = x * sin + y * cos;
    
    x = unrotatedX;
    y = unrotatedY;
    
    // Inverse skew (approximate)
    x -= y * Math.tan(this.transform.skewX);
    y -= x * Math.tan(this.transform.skewY);
    
    // Inverse scale
    const localPoint = {
      x: x / this.transform.scaleX,
      y: y / this.transform.scaleY
    };
    
    this.updatePoint(index, localPoint);
  }

  getWorldControlPoint(index: number): Point | null {
    if (!this.controlPoints || index < 0 || index >= this.controlPoints.length) return null;
    
    const localControl = this.controlPoints[index];
    
    // Apply full transformation matrix: scale, rotation, skew, then translate
    const rotationRad = this.transform.rotation * Math.PI / 180;
    const cos = Math.cos(rotationRad);
    const sin = Math.sin(rotationRad);
    
    // Apply scale
    let x = localControl.x * this.transform.scaleX;
    let y = localControl.y * this.transform.scaleY;
    
    // Apply skew
    x += y * Math.tan(this.transform.skewX);
    y += x * Math.tan(this.transform.skewY);
    
    // Apply rotation
    const rotatedX = x * cos - y * sin;
    const rotatedY = x * sin + y * cos;
    
    // Apply translation
    return {
      x: this.transform.x + rotatedX,
      y: this.transform.y + rotatedY
    };
  }

  getWorldTangentHandle(index: number, type: 'in' | 'out'): Point | null {
    if (!this.tangentHandles || index < 0 || index >= this.tangentHandles.length) return null;
    
    const localHandle = type === 'in' ? this.tangentHandles[index].in : this.tangentHandles[index].out;
    
    // Apply full transformation matrix: scale, rotation, skew, then translate
    const rotationRad = this.transform.rotation * Math.PI / 180;
    const cos = Math.cos(rotationRad);
    const sin = Math.sin(rotationRad);
    
    // Apply scale
    let x = localHandle.x * this.transform.scaleX;
    let y = localHandle.y * this.transform.scaleY;
    
    // Apply skew
    x += y * Math.tan(this.transform.skewX);
    y += x * Math.tan(this.transform.skewY);
    
    // Apply rotation
    const rotatedX = x * cos - y * sin;
    const rotatedY = x * sin + y * cos;
    
    // Apply translation
    return {
      x: this.transform.x + rotatedX,
      y: this.transform.y + rotatedY
    };
  }

  isPointNear(worldX: number, worldY: number, pointIndex: number, threshold: number = 8): boolean {
    // Check regular points
    if (pointIndex < 1000) {
      const worldPoint = this.getWorldPoint(pointIndex);
      if (!worldPoint) return false;
      
      const dx = worldX - worldPoint.x;
      const dy = worldY - worldPoint.y;
      return Math.sqrt(dx * dx + dy * dy) <= threshold;
    }
    
    // Check control points (offset by 1000)
    const controlIndex = pointIndex - 1000;
    const worldControl = this.getWorldControlPoint(controlIndex);
    if (!worldControl) return false;
    
    const dx = worldX - worldControl.x;
    const dy = worldY - worldControl.y;
    return Math.sqrt(dx * dx + dy * dy) <= threshold;
  }

  isSegmentNear(worldX: number, worldY: number, segmentIndex: number, threshold: number = 5): boolean {
    if (!this.points || segmentIndex < 0 || segmentIndex >= this.points.length - 1) return false;
    
    const point1 = this.getWorldPoint(segmentIndex);
    const point2 = this.getWorldPoint(segmentIndex + 1);
    if (!point1 || !point2) return false;
    
    // Calculate distance from point to line segment
    const A = worldX - point1.x;
    const B = worldY - point1.y;
    const C = point2.x - point1.x;
    const D = point2.y - point1.y;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    
    if (lenSq === 0) return false;
    
    let param = dot / lenSq;
    param = Math.max(0, Math.min(1, param));
    
    const closestX = point1.x + param * C;
    const closestY = point1.y + param * D;
    
    const dx = worldX - closestX;
    const dy = worldY - closestY;
    return Math.sqrt(dx * dx + dy * dy) <= threshold;
  }

  renderPoints(ctx: CanvasRenderingContext2D, selectedPoints: number[] = [], selectedSegments: number[] = [], canvasZoom: number = 1): void {
    if (!this.points || this.points.length === 0) return;
    
    ctx.save();
    
    // Draw control handles for curve types
    if (this.type === 'bezier' && this.tangentHandles) {
      // Draw tangent handles for bezier curves
      this.tangentHandles.forEach((tangentHandle, index) => {
        const worldPoint = this.getWorldPoint(index);
        if (!worldPoint) return;
        
        // Transform tangent handles to world coordinates
        const worldHandleIn = this.getWorldTangentHandle(index, 'in');
        const worldHandleOut = this.getWorldTangentHandle(index, 'out');
        
        if (worldHandleIn) {
          // Draw tangent line for 'in' handle
          ctx.strokeStyle = '#9CA3AF';
          ctx.lineWidth = 1 / canvasZoom;
          ctx.setLineDash([3 / canvasZoom, 3 / canvasZoom]);
          ctx.beginPath();
          ctx.moveTo(worldPoint.x, worldPoint.y);
          ctx.lineTo(worldHandleIn.x, worldHandleIn.y);
          ctx.stroke();
          ctx.setLineDash([]);
          
          // Draw 'in' handle (bezier curves use orange color)
          const radius = 4 / canvasZoom;
          const isInSelected = selectedPoints.includes(2000 + index * 2); // Tangent handles start at 2000
          ctx.fillStyle = isInSelected ? '#EF4444' : '#F59E0B';
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1 / canvasZoom;
          
          ctx.beginPath();
          ctx.arc(worldHandleIn.x, worldHandleIn.y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        
        if (worldHandleOut) {
          // Draw tangent line for 'out' handle
          ctx.strokeStyle = '#9CA3AF';
          ctx.lineWidth = 1 / canvasZoom;
          ctx.setLineDash([3 / canvasZoom, 3 / canvasZoom]);
          ctx.beginPath();
          ctx.moveTo(worldPoint.x, worldPoint.y);
          ctx.lineTo(worldHandleOut.x, worldHandleOut.y);
          ctx.stroke();
          ctx.setLineDash([]);
          
          // Draw 'out' handle (bezier curves use orange color)
          const radius = 4 / canvasZoom;
          const isOutSelected = selectedPoints.includes(2000 + index * 2 + 1); // Out handle is +1 from in handle
          ctx.fillStyle = isOutSelected ? '#EF4444' : '#F59E0B';
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1 / canvasZoom;
          
          ctx.beginPath();
          ctx.arc(worldHandleOut.x, worldHandleOut.y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      });
    } else if ((this.type === 'bezier' || this.type === 'blob' || this.renderType === 'bezier') && this.controlPoints) {
      // Draw control points for bezier curves and blob shapes
      this.controlPoints.forEach((controlPoint, index) => {
        const worldControl = this.getWorldControlPoint(index);
        
        // For bezier curves, control points are between segments
        // Control point at index controls the curve from point[index] to point[index+1]
        const startPointIndex = index;
        const endPointIndex = (index + 1) % this.points.length;
        
        const worldStartPoint = this.getWorldPoint(startPointIndex);
        const worldEndPoint = this.getWorldPoint(endPointIndex);
        
        if (worldControl && worldStartPoint && worldEndPoint) {
          // Draw tangent lines to both connected points
          ctx.strokeStyle = '#9CA3AF';
          ctx.lineWidth = 1 / canvasZoom;
          ctx.setLineDash([3 / canvasZoom, 3 / canvasZoom]);
          
          // Line from start point to control point
          ctx.beginPath();
          ctx.moveTo(worldStartPoint.x, worldStartPoint.y);
          ctx.lineTo(worldControl.x, worldControl.y);
          ctx.stroke();
          
          // Line from control point to end point
          ctx.beginPath();
          ctx.moveTo(worldControl.x, worldControl.y);
          ctx.lineTo(worldEndPoint.x, worldEndPoint.y);
          ctx.stroke();
          
          ctx.setLineDash([]);
          
          // Draw control handle (cubic curves use purple color)
          const radius = 4 / canvasZoom;
          const isControlSelected = selectedPoints.includes(index + 1000);
          ctx.fillStyle = isControlSelected ? '#EF4444' : '#8B5CF6';
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1 / canvasZoom;
          
          ctx.beginPath();
          ctx.arc(worldControl.x, worldControl.y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      });
    }
    
    // Draw all segment midpoints for visibility
    const numSegments = this.closed ? this.points.length : this.points.length - 1;
    for (let i = 0; i < numSegments; i++) {
      const p1 = this.getWorldPoint(i);
      const p2 = this.getWorldPoint((i + 1) % this.points.length);
      
      if (p1 && p2) {
        const isSelected = selectedSegments.includes(i);
        
        // Draw segment highlight with curve matching render type
        if (isSelected) {
          ctx.strokeStyle = '#10B981';
          ctx.lineWidth = 6 / canvasZoom;
          ctx.beginPath();
          
          if (this.type === 'bezier' && this.tangentHandles && i < this.tangentHandles.length && (i + 1) < this.tangentHandles.length) {
            // Draw bezier curve using tangent handles for bezier curves
            ctx.moveTo(p1.x, p1.y);
            const cp1 = this.getWorldTangentHandle(i, 'out');
            const cp2 = this.getWorldTangentHandle(i + 1, 'in');
            
            if (cp1 && cp2) {
              ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
            } else {
              ctx.lineTo(p2.x, p2.y);
            }
          } else if (this.type === 'bezier' && this.controlPoints && i < this.controlPoints.length) {
            // Draw bezier curve using control points for cubic curves
            ctx.moveTo(p1.x, p1.y);
            const worldControl = this.getWorldControlPoint(i);
            if (worldControl) {
              ctx.quadraticCurveTo(worldControl.x, worldControl.y, p2.x, p2.y);
            } else {
              ctx.lineTo(p2.x, p2.y);
            }
          } else if ((this.type === 'spline-circle' || this.type === 'spline-ellipse' || this.type === 'spline-ring') && this.controlPoints) {
            // Draw Bézier curve segment for spline-based shapes
            ctx.moveTo(p1.x, p1.y);
            
            const segmentIndex = i % 4; // Four segments for circles/ellipses
            const cp1Index = segmentIndex * 2;
            const cp2Index = segmentIndex * 2 + 1;
            
            if (cp1Index < this.controlPoints.length && cp2Index < this.controlPoints.length) {
              const cp1 = this.getWorldControlPoint(cp1Index);
              const cp2 = this.getWorldControlPoint(cp2Index);
              
              if (cp1 && cp2) {
                ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
              } else {
                ctx.lineTo(p2.x, p2.y);
              }
            } else {
              ctx.lineTo(p2.x, p2.y);
            }
          } else if (this.type === 'bezier' || this.type === 'cubic' || this.renderType === 'smooth') {
            // Draw curved segment using actual control points if available
            ctx.moveTo(p1.x, p1.y);
            
            if (this.controlPoints && i < this.controlPoints.length) {
              // Use actual control point for this segment
              const worldControl = this.getWorldControlPoint(i);
              if (worldControl) {
                ctx.quadraticCurveTo(worldControl.x, worldControl.y, p2.x, p2.y);
              } else {
                ctx.lineTo(p2.x, p2.y);
              }
            } else {
              // Generate smooth curve without explicit control points
              const prevPoint = i > 0 ? this.getWorldPoint(i - 1) : p1;
              const nextPoint = i + 2 < this.points.length ? this.getWorldPoint(i + 2) : p2;
              
              if (prevPoint && nextPoint) {
                const tension = 0.3;
                const controlX = p2.x + (nextPoint.x - prevPoint.x) * tension;
                const controlY = p2.y + (nextPoint.y - prevPoint.y) * tension;
                ctx.quadraticCurveTo(controlX, controlY, p2.x, p2.y);
              } else {
                ctx.lineTo(p2.x, p2.y);
              }
            }
          } else {
            // Draw straight line segment
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
          }
          ctx.stroke();
        }
        
        // Draw segment midpoint indicator - calculate true curve midpoint
        let midX, midY;
        
        if (this.type === 'bezier' && this.tangentHandles && i < this.tangentHandles.length && (i + 1) < this.tangentHandles.length) {
          // For bezier curves, calculate the actual curve midpoint
          const cp1 = this.getWorldTangentHandle(i, 'out');
          const cp2 = this.getWorldTangentHandle(i + 1, 'in');
          
          if (cp1 && cp2) {
            // Calculate bezier curve midpoint at t=0.5
            const t = 0.5;
            const mt = 1 - t;
            midX = mt * mt * mt * p1.x + 3 * mt * mt * t * cp1.x + 3 * mt * t * t * cp2.x + t * t * t * p2.x;
            midY = mt * mt * mt * p1.y + 3 * mt * mt * t * cp1.y + 3 * mt * t * t * cp2.y + t * t * t * p2.y;
          } else {
            midX = (p1.x + p2.x) / 2;
            midY = (p1.y + p2.y) / 2;
          }
        } else if (this.type === 'bezier' && this.controlPoints && i < this.controlPoints.length) {
          // For cubic curves, calculate quadratic curve midpoint
          const worldControl = this.getWorldControlPoint(i);
          if (worldControl) {
            // Calculate quadratic curve midpoint at t=0.5
            const t = 0.5;
            const mt = 1 - t;
            midX = mt * mt * p1.x + 2 * mt * t * worldControl.x + t * t * p2.x;
            midY = mt * mt * p1.y + 2 * mt * t * worldControl.y + t * t * p2.y;
          } else {
            midX = (p1.x + p2.x) / 2;
            midY = (p1.y + p2.y) / 2;
          }
        } else if ((this.type === 'spline-circle' || this.type === 'spline-ellipse' || this.type === 'spline-ring') && this.controlPoints) {
          // For spline-based shapes, calculate Bézier curve midpoint
          const segmentIndex = i % 4; // Four segments for circles/ellipses
          const cp1Index = segmentIndex * 2;
          const cp2Index = segmentIndex * 2 + 1;
          
          if (cp1Index < this.controlPoints.length && cp2Index < this.controlPoints.length) {
            const cp1 = this.getWorldControlPoint(cp1Index);
            const cp2 = this.getWorldControlPoint(cp2Index);
            
            if (cp1 && cp2) {
              // Calculate Bézier curve midpoint at t=0.5
              const t = 0.5;
              const mt = 1 - t;
              midX = mt * mt * mt * p1.x + 3 * mt * mt * t * cp1.x + 3 * mt * t * t * cp2.x + t * t * t * p2.x;
              midY = mt * mt * mt * p1.y + 3 * mt * mt * t * cp1.y + 3 * mt * t * t * cp2.y + t * t * t * p2.y;
            } else {
              midX = (p1.x + p2.x) / 2;
              midY = (p1.y + p2.y) / 2;
            }
          } else {
            midX = (p1.x + p2.x) / 2;
            midY = (p1.y + p2.y) / 2;
          }
        } else if (this.type === 'bezier' || this.type === 'cubic' || this.renderType === 'smooth') {
          // For other curve types with control points
          if (this.controlPoints && i < this.controlPoints.length) {
            const worldControl = this.getWorldControlPoint(i);
            if (worldControl) {
              const t = 0.5;
              const mt = 1 - t;
              midX = mt * mt * p1.x + 2 * mt * t * worldControl.x + t * t * p2.x;
              midY = mt * mt * p1.y + 2 * mt * t * worldControl.y + t * t * p2.y;
            } else {
              midX = (p1.x + p2.x) / 2;
              midY = (p1.y + p2.y) / 2;
            }
          } else {
            midX = (p1.x + p2.x) / 2;
            midY = (p1.y + p2.y) / 2;
          }
        } else {
          // For straight segments
          midX = (p1.x + p2.x) / 2;
          midY = (p1.y + p2.y) / 2;
        }
        
        const radius = (isSelected ? 6 : 4) / canvasZoom;
        
        ctx.fillStyle = isSelected ? '#10B981' : '#8B5CF6';
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1 / canvasZoom;
        
        ctx.beginPath();
        ctx.rect(midX - radius/2, midY - radius/2, radius, radius);
        ctx.fill();
        ctx.stroke();
      }
    }
    
    // Draw points in world space for constant size
    this.points.forEach((point, index) => {
      const worldPoint = this.getWorldPoint(index);
      if (!worldPoint) return;
      
      const isSelected = selectedPoints.includes(index);
      const radius = (isSelected ? 8 : 6) / canvasZoom; // Constant size regardless of zoom
      
      ctx.fillStyle = isSelected ? '#EF4444' : '#3B82F6';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2 / canvasZoom; // Constant stroke width
      
      ctx.beginPath();
      ctx.arc(worldPoint.x, worldPoint.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // Draw control points for legacy bezier curves using controlPoints  
    if (this.controlPoints && this.controlPoints.length > 0 && 
        (this.type === 'spline-circle' || this.type === 'spline-ellipse' || this.type === 'spline-ring')) {
      ctx.fillStyle = '#8B5CF6';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1 / canvasZoom;
      
      this.controlPoints.forEach((controlPoint, index) => {
        const worldControlPoint = {
          x: controlPoint.x * this.transform.scaleX + this.transform.x,
          y: controlPoint.y * this.transform.scaleY + this.transform.y
        };
        
        const radius = 4 / canvasZoom;
        ctx.beginPath();
        ctx.arc(worldControlPoint.x, worldControlPoint.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }

    // Draw tangent handles for curve types (cubic, bezier, smooth-spline) - only when in point selection mode
    if ((this.type === 'cubic' || this.type === 'bezier' || this.type === 'smooth-spline') && 
        this.tangentHandles && this.tangentHandles.length > 0 && 
        (selectedPoints.length > 0 || this.selected)) {
      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 1 / canvasZoom;
      
      this.points.forEach((point, index) => {
        const worldPoint = this.getWorldPoint(index);
        if (!worldPoint || !this.tangentHandles) return;
        
        // Each point has one TangentHandle object with 'in' and 'out' properties
        const tangentHandle = this.tangentHandles[index];
        if (tangentHandle && 'in' in tangentHandle && 'out' in tangentHandle) {
          // Draw incoming handle (handle.in contains absolute world coordinates)
          ctx.beginPath();
          ctx.moveTo(worldPoint.x, worldPoint.y);
          ctx.lineTo(tangentHandle.in.x, tangentHandle.in.y);
          ctx.stroke();
          
          // Draw incoming handle point
          ctx.fillStyle = '#10B981';
          ctx.beginPath();
          ctx.arc(tangentHandle.in.x, tangentHandle.in.y, 3 / canvasZoom, 0, Math.PI * 2);
          ctx.fill();
          
          // Draw outgoing handle (handle.out contains absolute world coordinates)
          ctx.beginPath();
          ctx.moveTo(worldPoint.x, worldPoint.y);
          ctx.lineTo(tangentHandle.out.x, tangentHandle.out.y);
          ctx.stroke();
          
          // Draw outgoing handle point
          ctx.fillStyle = '#F59E0B';
          ctx.beginPath();
          ctx.arc(tangentHandle.out.x, tangentHandle.out.y, 3 / canvasZoom, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    
    ctx.restore();
  }

  /**
   * Debug overlay for curve shapes: draws anchor points, in/out tangent handles
   * (with connector lines) and a point index number next to each anchor — always,
   * regardless of selection state. Anchors are blue, in-handles green, out-handles
   * amber. Intended to be called from the canvas render loop within the same
   * world-space transform used to draw shapes.
   */
  renderCurveDebugOverlay(ctx: CanvasRenderingContext2D, canvasZoom: number = 1): void {
    if (!this.points || this.points.length === 0) return;

    ctx.save();

    // Tangent handle connector lines + handle dots
    if (this.tangentHandles && this.tangentHandles.length > 0) {
      this.points.forEach((_point, index) => {
        const worldPoint = this.getWorldPoint(index);
        if (!worldPoint || !this.tangentHandles) return;
        const th = this.tangentHandles[index];
        if (!th || !('in' in th) || !('out' in th)) return;

        const inW = this.getWorldTangentHandle(index, 'in');
        const outW = this.getWorldTangentHandle(index, 'out');

        ctx.strokeStyle = 'rgba(16, 185, 129, 0.7)';
        ctx.lineWidth = 1 / canvasZoom;

        if (inW) {
          ctx.beginPath();
          ctx.moveTo(worldPoint.x, worldPoint.y);
          ctx.lineTo(inW.x, inW.y);
          ctx.stroke();
          ctx.fillStyle = '#10B981';
          ctx.beginPath();
          ctx.arc(inW.x, inW.y, 3 / canvasZoom, 0, Math.PI * 2);
          ctx.fill();
        }
        if (outW) {
          ctx.beginPath();
          ctx.moveTo(worldPoint.x, worldPoint.y);
          ctx.lineTo(outW.x, outW.y);
          ctx.stroke();
          ctx.fillStyle = '#F59E0B';
          ctx.beginPath();
          ctx.arc(outW.x, outW.y, 3 / canvasZoom, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // Anchor points + index numbers
    const fontSize = 11 / canvasZoom;
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    this.points.forEach((_point, index) => {
      const worldPoint = this.getWorldPoint(index);
      if (!worldPoint) return;

      const radius = 5 / canvasZoom;
      ctx.fillStyle = '#3B82F6';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5 / canvasZoom;
      ctx.beginPath();
      ctx.arc(worldPoint.x, worldPoint.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const labelX = worldPoint.x + radius + 2 / canvasZoom;
      const labelY = worldPoint.y - radius;
      ctx.lineWidth = 3 / canvasZoom;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeText(String(index), labelX, labelY);
      ctx.fillText(String(index), labelX, labelY);
    });

    ctx.restore();
  }

  move(deltaX: number, deltaY: number): void {
    this.transform.x += deltaX;
    this.transform.y += deltaY;
  }

  scale(factor: number): void {
    this.transform.scaleX *= factor;
    this.transform.scaleY *= factor;
  }

  rotate(angle: number): void {
    this.transform.rotation += angle;
  }

  skew(skewX: number, skewY: number): void {
    this.transform.skewX += skewX;
    this.transform.skewY += skewY;
  }

  flip(horizontal: boolean): void {
    // Calculate the center of the actual point geometry
    const bounds = this.getBounds();
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    
    if (horizontal) {
      // Horizontal flip: mirror points across vertical center line
      this.points.forEach(point => {
        point.x = centerX - (point.x - centerX);
      });
      if (this.controlPoints) {
        this.controlPoints.forEach(control => {
          control.x = centerX - (control.x - centerX);
        });
      }
    } else {
      // Vertical flip: mirror points across horizontal center line  
      this.points.forEach(point => {
        point.y = centerY - (point.y - centerY);
      });
      if (this.controlPoints) {
        this.controlPoints.forEach(control => {
          control.y = centerY - (control.y - centerY);
        });
      }
    }
  }

  // Method to regenerate shape points when properties change
  regenerateShapePoints(): void {
    switch (this.type) {
      case 'polygon':
        this.generatePolygonPoints();
        break;
      case 'star':
        this.generateStarPoints();
        break;
      case 'circle':
        this.generateCirclePoints();
        break;
      case 'ellipse':
        this.generateEllipsePoints();
        break;
      case 'spline-circle':
        this.generateSplineCirclePoints();
        break;
      case 'spline-ellipse':
        this.generateSplineEllipsePoints();
        break;
      case 'spline-ring':
        this.generateSplineRingPoints();
        break;
      case 'rectangle':
      case 'square':
        this.generateRectanglePoints();
        break;
      case 'ring':
        this.generateRingPoints();
        break;
      // Line and curve types don't auto-regenerate to preserve user edits
    }
  }

  clone(): Shape {
    const cloned = new Shape(this.type, this.transform.x + 20, this.transform.y + 20);
    cloned.transform = { ...this.transform };
    cloned.properties = { ...this.properties };
    cloned.points = [...this.points];
    cloned.sides = this.sides;
    cloned.radius = this.radius;
    cloned.innerRadius = this.innerRadius;
    cloned.width = this.width;
    cloned.height = this.height;
    cloned.controlPoints = this.controlPoints ? [...this.controlPoints] : undefined;
    cloned.closed = this.closed;
    return cloned;
  }
}

export class ShapeGroupClass {
  id: string;
  shapes: Shape[];
  transform: Transform;
  selected: boolean;

  constructor(shapes: Shape[]) {
    this.id = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.shapes = shapes;
    this.selected = false;
    
    // Calculate center point for group transform
    const bounds = this.getBounds();
    this.transform = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      skewX: 0,
      skewY: 0
    };
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    if (this.shapes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    
    this.shapes.forEach(shape => {
      const bounds = shape.getBounds();
      const shapeMinX = shape.transform.x + bounds.x;
      const shapeMaxX = shape.transform.x + bounds.x + bounds.width;
      const shapeMinY = shape.transform.y + bounds.y;
      const shapeMaxY = shape.transform.y + bounds.y + bounds.height;
      
      minX = Math.min(minX, shapeMinX);
      maxX = Math.max(maxX, shapeMaxX);
      minY = Math.min(minY, shapeMinY);
      maxY = Math.max(maxY, shapeMaxY);
    });
    
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    
    // Apply group transform
    ctx.translate(this.transform.x, this.transform.y);
    ctx.rotate(this.transform.rotation * Math.PI / 180);
    ctx.scale(this.transform.scaleX, this.transform.scaleY);
    ctx.transform(1, this.transform.skewX, this.transform.skewY, 1, 0, 0);
    ctx.translate(-this.transform.x, -this.transform.y);
    
    // Render all shapes
    this.shapes.forEach(shape => shape.render(ctx));
    
    // Draw group selection
    if (this.selected) {
      const bounds = this.getBounds();
      ctx.strokeStyle = '#7C3AED';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 5]);
      ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      ctx.setLineDash([]);
    }
    
    ctx.restore();
  }

  move(deltaX: number, deltaY: number): void {
    this.shapes.forEach(shape => shape.move(deltaX, deltaY));
    this.transform.x += deltaX;
    this.transform.y += deltaY;
  }

  scale(factor: number): void {
    const centerX = this.transform.x;
    const centerY = this.transform.y;
    
    this.shapes.forEach(shape => {
      const dx = shape.transform.x - centerX;
      const dy = shape.transform.y - centerY;
      shape.transform.x = centerX + dx * factor;
      shape.transform.y = centerY + dy * factor;
      shape.scale(factor);
    });
    
    this.transform.scaleX *= factor;
    this.transform.scaleY *= factor;
  }

  rotate(angle: number): void {
    const centerX = this.transform.x;
    const centerY = this.transform.y;
    const rad = angle * Math.PI / 180;
    
    this.shapes.forEach(shape => {
      const dx = shape.transform.x - centerX;
      const dy = shape.transform.y - centerY;
      const newX = dx * Math.cos(rad) - dy * Math.sin(rad);
      const newY = dx * Math.sin(rad) + dy * Math.cos(rad);
      shape.transform.x = centerX + newX;
      shape.transform.y = centerY + newY;
      shape.rotate(angle);
    });
    
    this.transform.rotation += angle;
  }

  skew(skewX: number, skewY: number): void {
    this.shapes.forEach(shape => shape.skew(skewX, skewY));
    this.transform.skewX += skewX;
    this.transform.skewY += skewY;
  }

  flip(horizontal: boolean): void {
    const centerX = this.transform.x;
    const centerY = this.transform.y;
    
    this.shapes.forEach(shape => {
      if (horizontal) {
        const dx = shape.transform.x - centerX;
        shape.transform.x = centerX - dx;
      } else {
        const dy = shape.transform.y - centerY;
        shape.transform.y = centerY - dy;
      }
      shape.flip(horizontal);
    });
    
    if (horizontal) {
      this.transform.scaleX *= -1;
    } else {
      this.transform.scaleY *= -1;
    }
  }

  containsPoint(x: number, y: number): boolean {
    const bounds = this.getBounds();
    return x >= bounds.x && x <= bounds.x + bounds.width &&
           y >= bounds.y && y <= bounds.y + bounds.height;
  }
}
