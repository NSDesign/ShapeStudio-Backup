import { BaseShape, ShapeType, Point, TangentHandle, Transform, ShapeProperties, ShapeGroup, BlendMode } from '../../client/src/lib/shapeTypes';
import { resolveScalarSeries } from '../../shared/batchUtils';
import {
  generateCurvePatternPoints as computeCurvePatternPoints,
  selectStrokeCap,
  resolvePatternSetting,
  resolveCurveDirectionAngle,
  rotateCurvePoints,
  resolvePatternResampleCount,
  applyCurveLengthToPoints,
  buildPatternControls,
} from '../../shared/curveUtils';

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
  renderModeOverride?: import('../../shared/renderModeUtils').RenderModeOverride;
  localJitterConfig?: import('../../shared/roughnessUtils').LocalJitterConfig;
  // Parameterised stroke width profile
  strokeProfile?: import('../../shared/strokeUtils').StrokeProfile;
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
  strokeSquiggleJitterMode?: 'normal' | 'xy';
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
          const expectedY = Math.cos(angle) * h;
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
      if (batchConfig?.propertiesEnabled && batchConfig?.shapePropertiesEnabled && configRange) {
        // Batch config handles its own randomization in the width/height calculation functions
        // Don't add additional randomization here
        const [min, max] = configRange;
        return min + (max - min) / 2; // Use center value, randomization handled elsewhere
      }
      return defaultMin + Math.random() * (defaultMax - defaultMin);
    };
    
    const getWidthHeight = (): { width: number; height: number } => {
      // For batch configuration, width and height are calculated based on mode
      if (batchConfig?.propertiesEnabled && batchConfig?.shapePropertiesEnabled) {
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
        if (batchConfig?.propertiesEnabled && batchConfig?.shapePropertiesEnabled) {
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
        if (batchConfig?.propertiesEnabled && batchConfig?.shapePropertiesEnabled) {
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
        if (batchConfig?.propertiesEnabled && batchConfig?.shapePropertiesEnabled) {
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
        if (batchConfig?.propertiesEnabled && batchConfig?.shapePropertiesEnabled) {
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
        if (batchConfig?.propertiesEnabled && batchConfig?.shapePropertiesEnabled) {
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
          const ringSettings = batchConfig.scatterSettings.shapeSpecific['spline-ring'];
          if (ringSettings.innerRadiusMode === 'fixed' && ringSettings.innerRadiusValue !== undefined) {
            splineRingInnerRadiusRatio = ringSettings.innerRadiusValue;
          } else if (ringSettings.innerRadiusRange) {
            const [minRatio, maxRatio] = ringSettings.innerRadiusRange;
            splineRingInnerRadiusRatio = minRatio + Math.random() * (maxRatio - minRatio);
          }
        }
        this.innerRadius = this.radius * splineRingInnerRadiusRatio;
        this.generateSplineRingPoints();
        break;
      default:
        // Fallback for unknown types
        console.warn(`Unknown shape type: ${this.type}`);
        this.generateCirclePoints();
    }
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

  private generateLinePoints(numPoints?: number, batchConfig?: any): void {
    const pointCount = numPoints || 3 + Math.floor(Math.random() * 5);
    this.points = [];
    const spread = 100;
    
    for (let i = 0; i < pointCount; i++) {
      const t = i / (pointCount - 1);
      this.points.push({
        x: (t - 0.5) * spread + (Math.random() - 0.5) * 20,
        y: (Math.random() - 0.5) * spread
      });
    }
    
    this.closed = false;
    
    // Apply stroke cap settings from batch config if available
    if (batchConfig?.scatterSettings?.shapeSpecific?.line?.strokeCapProbabilities) {
      const caps = batchConfig.scatterSettings.shapeSpecific.line.strokeCapProbabilities;
      const total = caps.round + caps.square + caps.butt;
      const rand = Math.random() * total;
      
      if (rand < caps.round) {
        this.strokeCap = 'round';
      } else if (rand < caps.round + caps.square) {
        this.strokeCap = 'square';
      } else {
        this.strokeCap = 'butt';
      }
    } else {
      // Default random selection
      const capOptions: ('round' | 'square' | 'butt')[] = ['round', 'square', 'butt'];
      this.strokeCap = capOptions[Math.floor(Math.random() * capOptions.length)];
    }
  }

  private generateLineVectorPoints(batchConfig?: any): void {
    // Get direction, length, and centroid from batch config or use defaults
    let direction = Math.random() * 360; // Default random angle
    let length = 50 + Math.random() * 100; // Default random length
    let centroid = 0.5; // Default center point
    
    if (batchConfig?.scatterSettings?.shapeSpecific?.['line-vector']) {
      const settings = batchConfig.scatterSettings.shapeSpecific['line-vector'];
      
      // Handle direction based on mode
      if (settings.direction) {
        if (settings.direction.kind === 'fixed') {
          direction = settings.direction.value;
        } else if (settings.direction.kind === 'range') {
          direction = settings.direction.min + Math.random() * (settings.direction.max - settings.direction.min);
        } else if (settings.direction.kind === 'values') {
          if (settings.direction.selection === 'random') {
            direction = settings.direction.values[Math.floor(Math.random() * settings.direction.values.length)];
          } else {
            // cycle mode - use start index or 0
            const index = (settings.direction.startIndex || 0) % settings.direction.values.length;
            direction = settings.direction.values[index];
          }
        }
      }
      
      // Handle length based on mode
      if (settings.length) {
        if (settings.length.kind === 'fixed') {
          length = settings.length.value;
        } else if (settings.length.kind === 'range') {
          length = settings.length.min + Math.random() * (settings.length.max - settings.length.min);
        } else if (settings.length.kind === 'values') {
          if (settings.length.selection === 'random') {
            length = settings.length.values[Math.floor(Math.random() * settings.length.values.length)];
          } else {
            const index = (settings.length.startIndex || 0) % settings.length.values.length;
            length = settings.length.values[index];
          }
        }
      }
      
      // Handle centroid based on mode
      if (settings.centroid) {
        if (settings.centroid.kind === 'fixed') {
          centroid = settings.centroid.value;
        } else if (settings.centroid.kind === 'range') {
          centroid = settings.centroid.min + Math.random() * (settings.centroid.max - settings.centroid.min);
        } else if (settings.centroid.kind === 'values') {
          if (settings.centroid.selection === 'random') {
            centroid = settings.centroid.values[Math.floor(Math.random() * settings.centroid.values.length)];
          } else {
            const index = (settings.centroid.startIndex || 0) % settings.centroid.values.length;
            centroid = settings.centroid.values[index];
          }
        }
      }
      
      // Handle stroke cap
      if (settings.strokeCapProbabilities) {
        const caps = settings.strokeCapProbabilities;
        const total = caps.round + caps.square + caps.butt;
        const rand = Math.random() * total;
        
        if (rand < caps.round) {
          this.strokeCap = 'round';
        } else if (rand < caps.round + caps.square) {
          this.strokeCap = 'square';
        } else {
          this.strokeCap = 'butt';
        }
      }
    }
    
    // Convert direction to radians
    const angleRad = (direction * Math.PI) / 180;
    
    // Calculate start and end points based on centroid
    // Centroid 0 = anchor at line start (start point at origin)
    // Centroid 0.5 = anchor at line center (center point at origin)
    // Centroid 1 = anchor at line end (end point at origin)
    const startDist = -length * (1 - centroid);
    const endDist = length * centroid;
    
    this.points = [
      {
        x: Math.cos(angleRad) * startDist,
        y: Math.sin(angleRad) * startDist
      },
      {
        x: Math.cos(angleRad) * endDist,
        y: Math.sin(angleRad) * endDist
      }
    ];
    
    this.closed = false;
    
    // Set default stroke cap if not set
    if (!this.strokeCap) {
      const capOptions: ('round' | 'square' | 'butt')[] = ['round', 'square', 'butt'];
      this.strokeCap = capOptions[Math.floor(Math.random() * capOptions.length)];
    }
  }

  /**
   * Lay out anchor points for the selected curve pattern. Delegates to the
   * shared generator (shared/curveUtils.ts) so server / batch / tiled exports
   * produce the same curve geometry as the client preview.
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
    } = {}
  ): void {
    this.points = computeCurvePatternPoints(pointCount, spread, curvature, patternType, controls);
  }

  private generateCubicCurvePoints(batchConfig?: any): void {
    this.points = [];
    this.tangentHandles = [];
    this.smoothPoints = [];

    let pointCount    = 3 + Math.floor(Math.random() * 5);
    let curvatureVariation = 0.3 + Math.random() * 0.4;
    let pointSpread   = 60 + Math.random() * 40;
    let curvePattern  = Math.floor(Math.random() * 4);

    const settings = batchConfig?.scatterSettings?.shapeSpecific?.cubic;
    const s_any = settings as any;
    const genIdx = batchConfig?.generationIndex ?? 0;

    if (settings) {
      if (s_any.pointCountMode === 'incremental') {
        const start    = s_any.pointCountStartValue ?? 3;
        const inc      = s_any.pointCountIncrement  ?? 0;
        const boundMax = s_any.pointCountBoundMax   ?? 24;
        pointCount = Math.max(2, Math.min(boundMax, Math.round(start + inc * genIdx)));
      } else if (s_any.pointCountMode === 'fixed' && s_any.pointCountValue !== undefined) {
        pointCount = Math.round(s_any.pointCountValue);
      } else if (settings.pointCountRange) {
        const [min, max] = settings.pointCountRange;
        pointCount = Math.floor(min + Math.random() * (max - min + 1));
      }
      if (s_any.curvatureMode === 'fixed' && s_any.curvatureValue !== undefined) {
        curvatureVariation = s_any.curvatureValue;
      } else if (settings.curvatureRange) {
        const [min, max] = settings.curvatureRange;
        curvatureVariation = min + Math.random() * (max - min);
      }
      if (s_any.spreadMode === 'fixed' && s_any.spreadValue !== undefined) {
        pointSpread = s_any.spreadValue;
      } else if (settings.spreadRange) {
        const [min, max] = settings.spreadRange;
        pointSpread = min + Math.random() * (max - min);
      }
      if (settings.patternType !== undefined) curvePattern = settings.patternType;
    }

    if (curvePattern === -1) {
      const userMaxCap = Math.max(2, Math.round(s_any?.pointCountBoundMax ?? 24));
      pointCount = Math.max(2, Math.min(userMaxCap, pointCount));
      this.points = [];
      for (let i = 0; i < pointCount; i++) {
        const t = pointCount > 1 ? i / (pointCount - 1) : 0.5;
        this.points.push({ x: (t - 0.5) * pointSpread * 2, y: 0 });
      }
    } else {
      let patternMinPoints: number;
      if (curvePattern === 0) {
        const turns = s_any?.spiralTurns ?? resolvePatternSetting(settings, 'spiralTurns', 2.5);
        patternMinPoints = Math.max(10, Math.ceil(turns * 6));
      } else if (curvePattern === 1) {
        patternMinPoints = 2;
      } else if (curvePattern === 3) {
        patternMinPoints = 5;
      } else {
        patternMinPoints = 4;
      }
      const userMaxCap = Math.max(patternMinPoints, Math.round(s_any?.pointCountBoundMax ?? 24));
      pointCount = Math.max(patternMinPoints, Math.min(userMaxCap, pointCount));

      const resample = resolvePatternResampleCount(settings, curvePattern, pointSpread, genIdx);
      if (resample !== undefined) pointCount = resample;

      this.points = computeCurvePatternPoints(
        pointCount, pointSpread, curvatureVariation, curvePattern,
        buildPatternControls(settings, pointSpread, genIdx),
      );
    }

    applyCurveLengthToPoints(this.points, settings, genIdx);

    if (this.points.length >= 2) {
      const dirAngle = resolveCurveDirectionAngle(settings);
      if (dirAngle !== 0) rotateCurvePoints(this.points, dirAngle);
    }

    let openProbability = 85;
    if (batchConfig?.scatterSettings?.shapeSpecific?.[this.type]?.openProbability !== undefined) {
      openProbability = batchConfig.scatterSettings.shapeSpecific[this.type].openProbability;
    }
    this.closed = Math.random() * 100 > openProbability;

    let tensionPercent = s_any?.curveTension ?? 30;
    if (s_any?.curveTensionMode === 'fixed' && s_any?.curveTensionValue !== undefined) {
      tensionPercent = s_any.curveTensionValue;
    } else if (s_any?.curveTensionRange) {
      const [tMin, tMax] = s_any.curveTensionRange;
      tensionPercent = tMin + Math.random() * (tMax - tMin);
    }
    const tensionFactor = tensionPercent / 100;
    const endpointContinuous = s_any?.endpointContinuous ?? false;

    if (curvePattern === 0) {
      this.generateSpiralTangentHandles();
    } else {
      this.generateSmoothTangentHandles(tensionFactor, endpointContinuous);
    }
    this.recenterPointsAndHandles();

    const closeAverageProbability = s_any?.closeAverageProbability ?? 0;
    if (this.closed && Math.random() * 100 < closeAverageProbability) {
      this.averageCurveEndpoints();
    }

    const strokeCapProbabilities = settings?.strokeCapProbabilities || { round: 33, square: 33, butt: 34 };
    this.strokeCap = selectStrokeCap(strokeCapProbabilities);
    this.renderType = 'cubic';
  }

  private generateCurvePoints(numPoints?: number, batchConfig?: any): void {
    let pointCount = numPoints || 3 + Math.floor(Math.random() * 5);
    this.points = [];
    this.tangentHandles = [];
    this.smoothPoints = [];

    let curvature  = 0.3 + Math.random() * 0.4;
    let spread     = 80;
    let patternType = 1;

    const settings = batchConfig?.scatterSettings?.shapeSpecific?.bezier;
    const genIdx   = batchConfig?.generationIndex ?? 0;

    if (settings) {
      if (settings.pointCountMode === 'incremental') {
        const start    = settings.pointCountStartValue ?? 3;
        const inc      = settings.pointCountIncrement  ?? 0;
        const boundMax = settings.pointCountBoundMax   ?? 10;
        pointCount = Math.max(2, Math.min(boundMax, Math.round(start + inc * genIdx)));
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
      if (settings.patternType !== undefined) patternType = settings.patternType;
    }

    const bezierBoundMax = settings?.pointCountBoundMax ?? 10;
    pointCount = Math.max(2, Math.min(bezierBoundMax, pointCount));

    if (patternType !== -1) {
      const resample = resolvePatternResampleCount(settings, patternType, spread, genIdx);
      if (resample !== undefined) pointCount = resample;
      this.points = computeCurvePatternPoints(
        pointCount, spread, curvature, patternType,
        buildPatternControls(settings, spread, genIdx),
      );
    } else {
      for (let i = 0; i < pointCount; i++) {
        const t = pointCount > 1 ? i / (pointCount - 1) : 0.5;
        this.points.push({ x: (t - 0.5) * spread * 2, y: 0 });
      }
    }

    applyCurveLengthToPoints(this.points, settings, genIdx);

    if (this.points.length >= 2) {
      const dirAngle = resolveCurveDirectionAngle(settings);
      if (dirAngle !== 0) rotateCurvePoints(this.points, dirAngle);
    }

    let openProbability = 70;
    if (settings?.openProbability !== undefined) openProbability = settings.openProbability;
    this.closed = Math.random() * 100 > openProbability;

    let tensionPercent = settings?.curveTension ?? 30;
    if (settings?.curveTensionMode === 'fixed' && settings?.curveTensionValue !== undefined) {
      tensionPercent = settings.curveTensionValue;
    } else if (settings?.curveTensionRange) {
      const [tMin, tMax] = settings.curveTensionRange;
      tensionPercent = tMin + Math.random() * (tMax - tMin);
    }
    const tensionFactor      = tensionPercent / 100;
    const endpointContinuous = settings?.endpointContinuous ?? false;

    this.generateSmoothTangentHandles(tensionFactor, endpointContinuous);
    this.recenterPointsAndHandles();

    const closeAverageProbability = settings?.closeAverageProbability ?? 0;
    if (this.closed && Math.random() * 100 < closeAverageProbability) {
      this.averageCurveEndpoints();
    }

    const strokeCapProbabilities = settings?.strokeCapProbabilities || { round: 33, square: 33, butt: 34 };
    this.strokeCap = selectStrokeCap(strokeCapProbabilities);
    this.renderType = 'bezier';
  }

  /**
   * Generate linked tangent handles that maintain C1 continuity for smooth curves
   */
  private createLinkedTangentHandles(curvatureFactor: number = 0.3): void {
    this.tangentHandles = [];
    this.smoothPoints = [];
    
    for (let i = 0; i < this.points.length; i++) {
      const current = this.points[i];
      const isFirst = i === 0;
      const isLast = i === this.points.length - 1;
      
      // Calculate tangent direction based on neighboring points
      let tangentVector: Point;
      
      if (isFirst && !this.closed) {
        // First point in open curve: tangent points towards next point
        const next = this.points[i + 1];
        tangentVector = this.normalizeVector({
          x: next.x - current.x,
          y: next.y - current.y
        });
      } else if (isLast && !this.closed) {
        // Last point in open curve: tangent points from previous point
        const prev = this.points[i - 1];
        tangentVector = this.normalizeVector({
          x: current.x - prev.x,
          y: current.y - prev.y
        });
      } else {
        // Middle points or closed curve: calculate smooth tangent
        const prevIndex = this.closed ? (i - 1 + this.points.length) % this.points.length : i - 1;
        const nextIndex = this.closed ? (i + 1) % this.points.length : i + 1;
        
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
        handleLength = avgDistance * curvatureFactor;
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
   * Generate smooth tangent handles with configurable tension and optional
   * endpoint-continuity mode. Mirrors client generateSmoothTangentHandles exactly.
   */
  private generateSmoothTangentHandles(
    tensionFactor: number = 0.3,
    endpointContinuous: boolean = false,
  ): void {
    if (!this.points || this.points.length < 2) return;
    this.tangentHandles = [];
    this.smoothPoints = [];

    for (let i = 0; i < this.points.length; i++) {
      const current = this.points[i];
      const isFirst = i === 0;
      const isLast  = i === this.points.length - 1;

      let tangentVector: Point = { x: 0, y: 0 };

      if (isFirst && !this.closed) {
        if (endpointContinuous && this.points.length >= 3) {
          tangentVector = this.computeBisectorTangent(i + 1);
        } else {
          const next = this.points[i + 1];
          tangentVector = this.normalizeVector({ x: next.x - current.x, y: next.y - current.y });
        }
      } else if (isLast && !this.closed) {
        if (endpointContinuous && this.points.length >= 3) {
          tangentVector = this.computeBisectorTangent(i - 1);
        } else {
          const prev = this.points[i - 1];
          tangentVector = this.normalizeVector({ x: current.x - prev.x, y: current.y - prev.y });
        }
      } else {
        const prevIndex = this.closed ? (i - 1 + this.points.length) % this.points.length : Math.max(0, i - 1);
        const nextIndex = this.closed ? (i + 1) % this.points.length : Math.min(this.points.length - 1, i + 1);
        const prev = this.points[prevIndex];
        const next = this.points[nextIndex];
        const incoming = this.normalizeVector({ x: current.x - prev.x, y: current.y - prev.y });
        const outgoing = this.normalizeVector({ x: next.x - current.x, y: next.y - current.y });
        tangentVector = this.normalizeVector({
          x: (incoming.x + outgoing.x) / 2,
          y: (incoming.y + outgoing.y) / 2,
        });
      }

      const distances: number[] = [];
      if (!isFirst || this.closed) {
        const prevIndex = this.closed ? (i - 1 + this.points.length) % this.points.length : i - 1;
        const prev = this.points[prevIndex];
        distances.push(Math.sqrt(Math.pow(current.x - prev.x, 2) + Math.pow(current.y - prev.y, 2)));
      }
      if (!isLast || this.closed) {
        const nextIndex = this.closed ? (i + 1) % this.points.length : i + 1;
        const next = this.points[nextIndex];
        distances.push(Math.sqrt(Math.pow(next.x - current.x, 2) + Math.pow(next.y - current.y, 2)));
      }
      let handleLength = 25;
      if (distances.length > 0) {
        const avg = distances.reduce((s, d) => s + d, 0) / distances.length;
        handleLength = avg * tensionFactor;
      }

      this.tangentHandles.push({
        in:  { x: current.x - tangentVector.x * handleLength, y: current.y - tangentVector.y * handleLength },
        out: { x: current.x + tangentVector.x * handleLength, y: current.y + tangentVector.y * handleLength },
        linked: true,
        smooth: true,
      });
      this.smoothPoints.push(true);
    }
  }

  /** Compute the chord-bisection tangent at point index i (for endpoint-continuity). */
  private computeBisectorTangent(i: number): Point {
    const n = this.points.length;
    const current = this.points[i];
    const prev    = this.points[Math.max(0, i - 1)];
    const next    = this.points[Math.min(n - 1, i + 1)];
    const incoming = this.normalizeVector({ x: current.x - prev.x, y: current.y - prev.y });
    const outgoing = this.normalizeVector({ x: next.x - current.x, y: next.y - current.y });
    return this.normalizeVector({
      x: (incoming.x + outgoing.x) / 2,
      y: (incoming.y + outgoing.y) / 2,
    });
  }

  /**
   * Analytically correct tangent handles for Spiral patterns.
   * Perpendicular to the radius vector (CCW) avoids chord-bisection errors
   * when points are far apart angularly. Mirrors client generateSpiralTangentHandles.
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
        const ref  = isLast ? this.points[i - 1] : this.points[i + 1];
        const sign = isLast ? -1 : 1;
        tangentVector = this.normalizeVector({
          x: sign * (ref.x - current.x),
          y: sign * (ref.y - current.y),
        });
      } else {
        tangentVector = { x: -current.y / r, y: current.x / r };
      }

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
   * on its bounding-box center. Mirrors client recenterPointsAndHandles.
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
    for (const p of this.points) { p.x -= cx; p.y -= cy; }
    if (this.tangentHandles) {
      for (const h of this.tangentHandles) {
        if (h && h.in)  { h.in.x  -= cx; h.in.y  -= cy; }
        if (h && h.out) { h.out.x -= cx; h.out.y -= cy; }
      }
    }
  }

  /**
   * Average first/last curve endpoints to a shared midpoint for closed "average" mode.
   * Mirrors client averageCurveEndpoints including the bisector tangent alignment.
   */
  private averageCurveEndpoints(): void {
    if (!this.points || this.points.length < 2) return;
    const n = this.points.length;
    const first = this.points[0];
    const last  = this.points[n - 1];
    const mid = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
    const dFirst = { x: mid.x - first.x, y: mid.y - first.y };
    const dLast  = { x: mid.x - last.x,  y: mid.y - last.y  };
    this.points[0]     = { x: mid.x, y: mid.y };
    this.points[n - 1] = { x: mid.x, y: mid.y };
    if (this.tangentHandles) {
      const hFirst = this.tangentHandles[0];
      if (hFirst && 'in' in hFirst && 'out' in hFirst) {
        hFirst.in  = { x: hFirst.in.x  + dFirst.x, y: hFirst.in.y  + dFirst.y };
        hFirst.out = { x: hFirst.out.x + dFirst.x, y: hFirst.out.y + dFirst.y };
      }
      const hLast = this.tangentHandles[n - 1];
      if (hLast && 'in' in hLast && 'out' in hLast) {
        hLast.in  = { x: hLast.in.x  + dLast.x, y: hLast.in.y  + dLast.y };
        hLast.out = { x: hLast.out.x + dLast.x, y: hLast.out.y + dLast.y };
      }
      if (n >= 3) {
        const hF = this.tangentHandles[0];
        const hL = this.tangentHandles[n - 1];
        if (hF && hL && 'out' in hF && 'in' in hF && 'out' in hL && 'in' in hL) {
          const outDx = hF.out.x - mid.x, outDy = hF.out.y - mid.y;
          const outLen = Math.sqrt(outDx * outDx + outDy * outDy);
          const inDx  = mid.x - hL.in.x,  inDy  = mid.y - hL.in.y;
          const inLen  = Math.sqrt(inDx  * inDx  + inDy  * inDy);
          if (outLen > 1e-6 && inLen > 1e-6) {
            const avgX = outDx / outLen + inDx / inLen;
            const avgY = outDy / outLen + inDy / inLen;
            const avgLen = Math.sqrt(avgX * avgX + avgY * avgY);
            if (avgLen > 1e-6) {
              const tx = avgX / avgLen, ty = avgY / avgLen;
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

  private generateSmoothSplinePoints(numPoints?: number, batchConfig?: any): void {
    let pointCount = numPoints || 4 + Math.floor(Math.random() * 6);
    this.points = [];
    this.controlPoints = [];

    let pointPositionRange = [-50, 50];
    let controlPointRange  = [-25, 25];

    if (batchConfig?.propertiesEnabled && batchConfig?.splinePropertiesEnabled) {
      if (batchConfig?.splinePointPositionRange) pointPositionRange = batchConfig.splinePointPositionRange;
      if (batchConfig?.splineControlPointRange)  controlPointRange  = batchConfig.splineControlPointRange;
    } else if (batchConfig?.scatterSettings?.shapeSpecific?.['smooth-spline']) {
      const ss = batchConfig.scatterSettings.shapeSpecific['smooth-spline'];
      if (ss.pointPositionRange) pointPositionRange = ss.pointPositionRange;
      if (ss.controlPointRange)  controlPointRange  = ss.controlPointRange;
    }

    const [minPointPos, maxPointPos] = pointPositionRange;

    const settings = batchConfig?.scatterSettings?.shapeSpecific?.['smooth-spline'];
    const genIdx   = batchConfig?.generationIndex ?? 0;

    let openProbability = 30;
    if (settings?.openProbability !== undefined) openProbability = settings.openProbability;
    this.closed = Math.random() * 100 > openProbability;

    const baseRadius = 50 + Math.random() * 80;
    let curvature  = 0.3 + Math.random() * 0.4;
    let spread     = baseRadius;
    let patternType = 1;

    if (settings) {
      if (settings.pointCountMode === 'incremental') {
        const start    = settings.pointCountStartValue ?? 3;
        const inc      = settings.pointCountIncrement  ?? 0;
        const boundMax = settings.pointCountBoundMax   ?? 10;
        pointCount = Math.max(2, Math.min(boundMax, Math.round(start + inc * genIdx)));
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
      if (settings.patternType !== undefined) patternType = settings.patternType;
    }

    if (patternType === -1) {
      this.points = [];
      for (let i = 0; i < pointCount; i++) {
        const t = pointCount > 1 ? i / (pointCount - 1) : 0.5;
        this.points.push({ x: (t - 0.5) * spread * 2, y: 0 });
      }
    } else {
      const resample = resolvePatternResampleCount(settings, patternType, spread, genIdx);
      if (resample !== undefined) pointCount = resample;
      this.points = computeCurvePatternPoints(
        pointCount, spread, curvature, patternType,
        buildPatternControls(settings, spread, genIdx),
      );
    }

    applyCurveLengthToPoints(this.points, settings, genIdx);

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

    if (this.points.length >= 2) {
      const dirAngle = resolveCurveDirectionAngle(settings);
      if (dirAngle !== 0) rotateCurvePoints(this.points, dirAngle);
    }

    let tensionPercent = settings?.curveTension ?? 30;
    if (settings?.curveTensionMode === 'fixed' && settings?.curveTensionValue !== undefined) {
      tensionPercent = settings.curveTensionValue;
    } else if (settings?.curveTensionRange) {
      const [tMin, tMax] = settings.curveTensionRange;
      tensionPercent = tMin + Math.random() * (tMax - tMin);
    }
    const tensionFactor      = tensionPercent / 100;
    const endpointContinuous = settings?.endpointContinuous ?? false;

    this.generateSmoothTangentHandles(tensionFactor, endpointContinuous);
    this.recenterPointsAndHandles();

    const closeAverageProbability = settings?.closeAverageProbability ?? 0;
    if (this.closed && Math.random() * 100 < closeAverageProbability) {
      this.averageCurveEndpoints();
    }

    this.renderType = 'bezier';
    this.segments   = this.closed ? pointCount : pointCount - 1;

    const strokeCapProbabilities = settings?.strokeCapProbabilities || { round: 33, square: 33, butt: 34 };
    this.strokeCap = selectStrokeCap(strokeCapProbabilities);
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

  private _evalCubicBezier(p0: number, c1: number, c2: number, p3: number, t: number): number {
    const mt = 1 - t;
    return mt * mt * mt * p0 + 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t * p3;
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    if (this.points.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

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
