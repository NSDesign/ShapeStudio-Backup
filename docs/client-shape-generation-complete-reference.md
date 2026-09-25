# Complete Client-Side Shape Generation Reference

> **⚠️ DEPRECATION NOTICE**: The Noise System (Section 5) has been completely removed from the codebase as of the latest update. All noise-related properties, algorithms, and UI controls have been deleted. This documentation is kept for historical reference only.

## Overview
This document provides a comprehensive analysis of the client's shape generation logic that the server must replicate. The generation process is controlled by `BatchConfigSettings` and involves multiple phases of property application.

---

## Table of Contents
1. [Batch Configuration Settings](#batch-configuration-settings)
2. [Shape Generation Process](#shape-generation-process)
3. [Shape-Specific Properties](#shape-specific-properties)
4. [Color & Gradient Generation](#color--gradient-generation)
5. [Noise System](#noise-system)
6. [Transform System](#transform-system)
7. [Property Application Order](#property-application-order)

---

## Batch Configuration Settings

### Master Toggle
- `propertiesEnabled`: Boolean - Master switch for all batch config properties

### 1. Advanced Noise Section

#### Core Settings
```typescript
noiseEnabled: boolean;
noiseAlgorithm: 'randomise' | 'perlin' | 'simplex' | 'fractal' | 'worley' | 'ridge' | 'turbulence';
noiseScale: number;
noiseOctaves: number;
noiseAmplitude: number;
noiseSeed: number;
noiseScaleToCanvas: boolean;
```

#### Property-Specific Amplitudes
```typescript
noisePositionAmplitude: number;  // Multiplier for position noise
noiseRotationAmplitude: number;  // Multiplier for rotation noise
noiseScaleAmplitude: number;     // Multiplier for scale noise
noiseOpacityAmplitude: number;   // Multiplier for opacity noise
noiseColorAmplitude: number;     // Multiplier for color noise
```

#### Algorithm-Specific Settings
```typescript
// Octave handling
noiseOctaveMode: 'natural' | 'normalized';

// Fractal specific
noiseLacunarity: number;
noiseGain: number;

// Worley specific
noiseDistanceFunction: 'euclidean' | 'manhattan' | 'chebyshev';
noiseFeaturePoints: number;

// Ridge specific
noiseRidgeOffset: number;

// Turbulence specific
noiseTurbulencePower: number;
```

### 2. Distribution Layout Section

#### Core Settings
```typescript
distributionLayoutEnabled: boolean;
distributionPattern: 'grid' | 'wave' | 'ellipse' | 'spiral' | 'auto-distribute';
```

#### Grid Layout
```typescript
gridRows: number;
gridColumns: number;
gridStartX: number;
gridStartY: number;
gridSpacingXMode: 'define' | 'auto-centered' | 'auto-edge-to-edge';
gridSpacingYMode: 'define' | 'auto-centered' | 'auto-edge-to-edge';
gridRowOffset: number;
gridColumnOffset: number;
gridMarginEnabled: boolean;
gridMarginValue: number;
gridSortBy: string; // 'layer' | 'id' | 'shape-type' | 'fill-color' | etc.
gridSortScope: 'per-generation' | 'per-batch';
gridSortOrder: 'ascending' | 'descending';
gridGroupByShapeType: boolean;
gridReverseGroups: boolean;
gridXRandomization: number; // 0-200 pixels
gridYRandomization: number; // 0-200 pixels
```

#### Wave Pattern
```typescript
waveType: 'sine' | 'triangle' | 'square' | 'sawtooth';
waveAmplitude: number;      // 0-200 pixels
waveFrequency: number;
waveDirection: 'horizontal' | 'vertical';
wavePhaseOffset: number;    // 0-360 degrees
```

#### Ellipse/Ring Pattern
```typescript
ellipseXRadius: [number, number];
ellipseYRadius: [number, number];
ellipseRingCount: number;   // 1-10
ellipseRingSpacing: 'even' | 'progressive';
ellipseRotation: number;    // 0-360 degrees
ellipseRotationAlignment: 'uniform' | 'progressive';
```

#### Spiral Pattern
```typescript
spiralTurnCount: number;    // 1-20
spiralSpacingMode: 'linear' | 'logarithmic';
spiralDirection: 'clockwise' | 'counterclockwise';
spiralStartAngle: number;   // 0-360 degrees
spiralTightness: number;    // 0.1-2.0
```

#### Pattern Enhancements
```typescript
tangentAlignment: boolean;
segmentDistribution: 'even' | 'clustered';
reverseDirection: boolean;
```

### 3. Generation Count Controls

```typescript
generationCountMode: 'range' | 'fixed' | 'incremental';
generationCountDefine: number;
generationCountStartValue: number;
generationCountIncrement: number;
generationCountResetPerBatch: boolean;
generationCountModulationEnabled: boolean;
generationCountModulationValue: number;
```

### 4. Blend Mode & Compositing

```typescript
blendModeEnabled: boolean;
enabledBlendModes: { [key in BlendMode]?: number }; // Probability weights 0-100

compositingOperationsEnabled: boolean;
enabledCompositingOperations: { [key: string]: number }; // Probability weights
```

### 5. Shape Properties Section

#### Master Toggle
```typescript
shapePropertiesEnabled: boolean;
```

#### Width & Height
```typescript
// Mode selection
widthMode: 'range' | 'value' | 'incremental';
heightMode: 'range' | 'value' | 'incremental';

// Range mode
widthRange: [number, number];
heightRange: [number, number];
widthRandomizationScale: number;  // 0-100%
heightRandomizationScale: number; // 0-100%

// Value mode
widthValue: number;
heightValue: number;

// Incremental mode
widthIncrement: number;
heightIncrement: number;
widthStartValue: number;
heightStartValue: number;
widthModulationEnabled: boolean;
widthModulationValue: number;
heightModulationEnabled: boolean;
heightModulationValue: number;

// Size constraints
maintainAspectRatio: boolean;
useMinWidthHeight: boolean;
useMaxWidthHeight: boolean;
useAvgWidthHeight: boolean;
minimumSize: number;
maximumSize: number;
```

#### Position
```typescript
// Mode selection
xPositionMode: 'range' | 'value' | 'directional' | 'incremental';
yPositionMode: 'range' | 'value' | 'directional' | 'incremental';

// Range mode
xPositionRange: [number, number];
yPositionRange: [number, number];

// Value mode
xPositionValue: number;
yPositionValue: number;

// Directional mode
positionDirectionalMode: 'outward-center' | 'outward-edge' | 'angle-based';
positionDirectionalAngle: number;      // 0-360 degrees
positionDirectionalDistance: number;
directionalEvenDistribution: boolean;
directionalClusterAngle: number;

// Incremental mode
xPositionIncrement: number;
yPositionIncrement: number;
xPositionStartValue: number;
yPositionStartValue: number;
xPositionModulationEnabled: boolean;
xPositionModulationValue: number;
yPositionModulationEnabled: boolean;
yPositionModulationValue: number;
incrementalResetPerBatch: boolean;
```

### 6. Shape-Specific Properties

#### Rectangle Corner Radius
```typescript
rectangleCornerRadiusMode: 'range' | 'define' | 'incremental';
rectangleCornerRadiusRange: [number, number];
rectangleCornerRadiusDefine: number;
rectangleCornerRadiusStartValue: number;
rectangleCornerRadiusIncrement: number;
rectangleCornerRadiusModulationEnabled: boolean;
rectangleCornerRadiusModulationValue: number;
```

#### Star Inner Radius
```typescript
starInnerRadiusMode: 'range' | 'define' | 'incremental';
starInnerRadiusRange: [number, number];
starInnerRadiusDefine: number;
starInnerRadiusStartValue: number;
starInnerRadiusIncrement: number;
starInnerRadiusModulationEnabled: boolean;
starInnerRadiusModulationValue: number;
```

#### Ring Inner Radius
```typescript
ringInnerRadiusMode: 'range' | 'define' | 'incremental';
ringInnerRadiusRange: [number, number];
ringInnerRadiusDefine: number;
ringInnerRadiusStartValue: number;
ringInnerRadiusIncrement: number;
ringInnerRadiusModulationEnabled: boolean;
ringInnerRadiusModulationValue: number;
```

#### Polygon Segments
```typescript
polygonPropertiesEnabled: boolean;
segmentCountMode: 'range' | 'define' | 'incremental';
segmentCountRange: [number, number];
segmentCountDefine: number;
segmentCountStartValue: number;
segmentCountIncrement: number;
segmentCountModulationEnabled: boolean;
segmentCountModulationValue: number;
```

#### Line Properties
```typescript
linePropertiesEnabled: boolean;
pointCountMode: 'range' | 'define' | 'incremental';
pointCountRange: [number, number];
pointCountDefine: number;
pointCountStartValue: number;
pointCountIncrement: number;
pointCountModulationEnabled: boolean;
pointCountModulationValue: number;

pointPositionMode: 'range' | 'define' | 'incremental';
pointPositionRange: [number, number];
pointPositionDefine: number;
pointPositionStartValue: number;
pointPositionIncrement: number;
pointPositionModulationEnabled: boolean;
pointPositionModulationValue: number;
```

#### Spline Properties
```typescript
splinePropertiesEnabled: boolean;
splinePointCountMode: 'range' | 'define' | 'incremental';
splinePointCountRange: [number, number];
splinePointCountDefine: number;
splinePointCountStartValue: number;
splinePointCountIncrement: number;
splinePointCountModulationEnabled: boolean;
splinePointCountModulationValue: number;

splinePointPositionMode: 'range' | 'define' | 'incremental';
splinePointPositionRange: [number, number];
splinePointPositionDefine: number;
splinePointPositionStartValue: number;
splinePointPositionIncrement: number;
splinePointPositionModulationEnabled: boolean;
splinePointPositionModulationValue: number;

splineControlPointMode: 'range' | 'define' | 'incremental';
splineControlPointRange: [number, number];
splineControlPointDefine: number;
splineControlPointStartValue: number;
splineControlPointIncrement: number;
splineControlPointModulationEnabled: boolean;
splineControlPointModulationValue: number;
```

### 7. Fill Properties

#### Fill Style Control
```typescript
fillEnabled: boolean;
fillStyleProbability: number; // 0-100% - probability for solid vs gradient
```

#### Solid Fill Color
```typescript
fillColorMode: 'range' | 'palette' | 'define';
fillColorRange: [string, string];       // Hex colors
fillColorRangeFlip: boolean;            // Toggle hue wheel direction
fillColorPalette: string[];             // Array of hex colors
fillColorDefine: string;                // Single hex color
fillColorSaturationRange: [number, number]; // 0-100%
fillColorLightnessRange: [number, number];  // 0-100%
```

#### Gradient Fill
```typescript
fillGradientEnabled: boolean;

// Type probabilities (must sum to 100)
fillGradientLinearProbability: number;  // 0-100%
fillGradientRadialProbability: number;  // 0-100%
fillGradientConicProbability: number;   // 0-100%

// Gradient colors
fillGradientColorMode: 'range' | 'palette' | 'define';
fillGradientColorRange: [string, string];
fillGradientColorRangeFlip: boolean;
fillGradientColorPalette: string[];
fillGradientColorDefine: string[];
fillGradientColorSaturationRange: [number, number];
fillGradientColorLightnessRange: [number, number];
fillGradientStopsRange: [number, number];

// Linear gradient direction
fillGradientLinearDirection: 'range' | 'predefined';
fillGradientLinearAngleRange: [number, number];
fillGradientLinearPredefined: 'horizontal' | 'vertical' | 'diagonal-down' | 'diagonal-up';
fillGradientLinearAlignToShape: boolean;

// Radial gradient center
fillGradientRadialCenter: 'center' | 'random' | 'corners' | 'midpoints' | 'coordinates';
fillGradientRadialCenterX: number;      // 0-100%
fillGradientRadialCenterY: number;      // 0-100%
fillGradientRadialCorners: {
  topLeft: boolean;
  topRight: boolean;
  bottomLeft: boolean;
  bottomRight: boolean;
};
fillGradientRadialMidpoints: {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
};
fillGradientRadialSelectionMode: 'random' | 'cycle';
fillGradientRadialShape: 'circle' | 'ellipse' | 'auto';
fillGradientRadialCircleProbability: number;
fillGradientRadialEllipseProbability: number;
fillGradientMatchShape: boolean;

// Conic gradient
fillGradientConicCenter: 'center' | 'random' | 'coordinates';
fillGradientConicCenterX: number;       // 0-100%
fillGradientConicCenterY: number;       // 0-100%
fillGradientConicAngle: number;         // 0-360 degrees
```

#### Fill Opacity
```typescript
fillOpacityMode: 'range' | 'define' | 'incremental';
fillOpacityRange: [number, number];     // 0-100
fillOpacityDefine: number;              // 0-100
fillOpacityStartValue: number;
fillOpacityIncrement: number;
fillOpacityModulationEnabled: boolean;
fillOpacityModulationValue: number;
```

### 8. Blur Properties

```typescript
blurEnabled: boolean;
blurProbability: number;                // 0-100%
blurMode: 'range' | 'define' | 'incremental';
blurRange: [number, number];            // Pixels
blurDefine: number;                     // Pixels
blurStartValue: number;
blurIncrement: number;
blurModulationEnabled: boolean;
blurModulationValue: number;
```

### 9. Stroke Properties

```typescript
strokeEnabled: boolean;
strokeProbability: number;              // 0-100%

// Stroke color
strokeColorMode: 'range' | 'palette' | 'define';
strokeColorRange: [string, string];
strokeColorRangeFlip: boolean;
strokeColorPalette: string[];
strokeColorDefine: string;
strokeColorSaturationRange: [number, number];
strokeColorLightnessRange: [number, number];

// Stroke opacity
strokeOpacityMode: 'range' | 'define' | 'incremental';
strokeOpacityRange: [number, number];
strokeOpacityDefine: number;
strokeOpacityStartValue: number;
strokeOpacityIncrement: number;
strokeOpacityModulationEnabled: boolean;
strokeOpacityModulationValue: number;

// Stroke width
strokeWidthMode: 'range' | 'define' | 'incremental';
strokeWidthRange: [number, number];
strokeWidthDefine: number;
strokeWidthStartValue: number;
strokeWidthIncrement: number;
strokeWidthModulationEnabled: boolean;
strokeWidthModulationValue: number;
```

### 10. Transform Properties

#### Master Toggle
```typescript
transformsEnabled: boolean;
```

#### Transform Origin
```typescript
transformOriginMode: 'define' | 'predefined-artboard' | 'predefined-shape';
transformOriginX: number;
transformOriginY: number;
transformOriginPredefined: 'center' | 'top-left' | 'top-center' | 'top-right' | 
                          'center-left' | 'center-right' | 'bottom-left' | 
                          'bottom-center' | 'bottom-right';
```

#### Position Transforms
```typescript
xTransformMode: 'range' | 'value' | 'incremental' | 'align';
yTransformMode: 'range' | 'value' | 'incremental' | 'align';
translateXRange: [number, number];
translateYRange: [number, number];
xTransformValue: number;
yTransformValue: number;
xTransformIncrement: number;
yTransformIncrement: number;
xTransformStartValue: number;
yTransformStartValue: number;
xTransformModulationEnabled: boolean;
xTransformModulationValue: number;
yTransformModulationEnabled: boolean;
yTransformModulationValue: number;

// Alignment mode settings
xShapeAnchorMode: 'predefined' | 'define';
xShapeAnchorPredefined: 'left' | 'center' | 'right';
xShapeAnchorDefine: number;
xArtboardAnchorMode: 'predefined' | 'define';
xArtboardAnchorPredefined: 'left' | 'center' | 'right';
xArtboardAnchorDefine: number;
yShapeAnchorMode: 'predefined' | 'define';
yShapeAnchorPredefined: 'top' | 'center' | 'bottom';
yShapeAnchorDefine: number;
yArtboardAnchorMode: 'predefined' | 'define';
yArtboardAnchorPredefined: 'top' | 'center' | 'bottom';
yArtboardAnchorDefine: number;
```

#### Scale Transforms
```typescript
scaleXMode: 'range' | 'value' | 'incremental';
scaleYMode: 'range' | 'value' | 'incremental';
scaleXRange: [number, number];          // Percentage
scaleYRange: [number, number];          // Percentage
scaleXValue: number;                    // Percentage
scaleYValue: number;                    // Percentage
scaleXIncrement: number;
scaleYIncrement: number;
scaleXStartValue: number;
scaleYStartValue: number;
scaleXModulationEnabled: boolean;
scaleXModulationValue: number;
scaleYModulationEnabled: boolean;
scaleYModulationValue: number;
maintainScaleAspectRatio: boolean;
scaleRandomizationScale: number;        // 0-100%
```

#### Rotation Transforms
```typescript
rotationMode: 'range' | 'value' | 'incremental';
rotationRange: [number, number];        // Degrees
rotationValue: number;                  // Degrees
rotationIncrement: number;              // Degrees
rotationModulation: number;             // Degrees (e.g., 360 for reset)
rotationModulationEnabled: boolean;
rotationRandomizationScale: number;     // 0-100%
```

#### Skew Transforms
```typescript
skewXRange: [number, number];
skewYRange: [number, number];
```

### 11. Color Harmony

```typescript
colorHarmonyEnabled: boolean;
harmonyType: 'monochromatic' | 'analogous' | 'complementary' | 
             'triadic' | 'split-complementary' | 'tetradic';
baseColor: string;                      // Hex color
hueVariance: number;
saturationRange: [number, number];
lightnessRange: [number, number];

// Monochromatic settings
monochromaticSettings: {
  lightnessSteps: number;
  saturationSteps: number;
  includeNeutrals: boolean;
};

// Analogous settings
analogousSettings: {
  hueRange: number;
  colorCount: number;
};

// Complementary settings
complementarySettings: {
  includeNearComplements: boolean;
  complementOffset: number;
};

// Triadic settings
triadicSettings: {
  rotationOffset: number;
  useEqualSpacing: boolean;
};

// Split complementary settings
splitComplementarySettings: {
  splitAngle: number;
  balanceWeights: boolean;
};

// Tetradic settings
tetradicSettings: {
  squareHarmony: boolean;
  rectangleRatio: number;
};
```

---

## Shape Generation Process

### Function: `generateShapesWithBatchConfig`

Located in: `client/src/hooks/useShapeEditor.ts` (line ~1469)

```typescript
const generateShapesWithBatchConfig = (
  count: number,
  canvasBounds: { x: number; y: number; width: number; height: number },
  useDistribution: boolean = true,
  shapeGenerationIndex: number = 0,
  shapeSpecificPropertiesOverride?: Record<string, any>,
  overrides?: GenerationContextOverrides
): Shape[]
```

#### Step 1: Setup & Position Generation
```typescript
// Determine enabled shape types
const effectiveEnabledTypes = overrides?.enabledShapeTypes 
  ? Array.from(overrides.enabledShapeTypes) 
  : Array.from(enabledShapeTypes);

// Generate positions using distribution algorithm or random
const positions = useDistribution 
  ? SmartDistributionAlgorithm.generatePositions(count, canvasBounds, distribution)
  : Array.from({ length: count }, () => ({ 
      x: canvasBounds.x + (Math.random() - 0.5) * (canvasBounds.width * 0.8),
      y: canvasBounds.y + (Math.random() - 0.5) * (canvasBounds.height * 0.8)
    }));
```

#### Step 2: Shape Construction
```typescript
const newShapes = positions.map((position, index) => {
  // Select random shape type
  const randomType = effectiveEnabledTypes[
    Math.floor(Math.random() * effectiveEnabledTypes.length)
  ];
  
  // Calculate position from batch config
  let shapeX = position.x;
  let shapeY = position.y;
  if (batchConfig.propertiesEnabled && batchConfig.shapePropertiesEnabled) {
    shapeX = calculatePositionX(batchConfig, index, ...);
    shapeY = calculatePositionY(batchConfig, index, ...);
  }
  
  // Merge batch config with scatter settings
  const combinedConfig = { 
    ...batchConfig, 
    scatterSettings: enhancedScatterSettings 
  };
  
  // Create shape with batch config
  const shape = new Shape(randomType, shapeX, shapeY, combinedConfig);
  
  // ... continue with property application
});
```

#### Step 3: Size Application
```typescript
if (batchConfig.propertiesEnabled && batchConfig.shapePropertiesEnabled) {
  let width = calculateWidth(batchConfig, index, ...);
  let height = calculateHeight(batchConfig, index, ...);
  
  // Apply aspect ratio constraint
  if (batchConfig.maintainAspectRatio) {
    const constrainedSize = calculateConstrainedSize(batchConfig, width, height, shape.type);
    width = constrainedSize;
    height = constrainedSize;
  }
  
  // Apply size to shape based on type
  switch (shape.type) {
    case 'rectangle':
    case 'rounded-rectangle':
      shape.width = width;
      shape.height = height;
      break;
    case 'circle':
    case 'star':
    case 'polygon':
      shape.radius = constrainedSize / 2;
      break;
    // ... other shape types
  }
  
  // CRITICAL: Regenerate points after size changes
  shape.regenerateShapePoints();
}
```

#### Step 4: Fill & Stroke Application
```typescript
if (batchConfig.propertiesEnabled) {
  // Handle fill style: solid vs gradient
  if (batchConfig.fillEnabled) {
    const shouldHaveSolidFill = Math.random() * 100 < batchConfig.fillStyleProbability;
    const shouldHaveGradient = !shouldHaveSolidFill && batchConfig.fillGradientEnabled;
    
    if (shouldHaveGradient) {
      // Determine gradient type based on probabilities
      const gradientType = selectGradientType(batchConfig);
      const stopCount = randomInRange(batchConfig.fillGradientStopsRange);
      
      // Generate gradient stops
      const gradientStops = [];
      for (let i = 0; i < stopCount; i++) {
        const stopColor = generateColor(
          batchConfig.fillGradientColorMode,
          batchConfig.fillGradientColorRange,
          batchConfig.fillGradientColorPalette,
          // ... other params
        );
        gradientStops.push({ offset: i / (stopCount - 1), color: stopColor });
      }
      
      shape.properties.gradient = { type: gradientType, stops: gradientStops };
      shape.properties.fillColor = 'transparent';
    } else if (shouldHaveSolidFill) {
      // Generate solid fill color
      const fillColor = generateColor(
        batchConfig.fillColorMode,
        batchConfig.fillColorRange,
        batchConfig.fillColorPalette,
        batchConfig.fillColorDefine,
        index,
        { 
          saturationRange: batchConfig.fillColorSaturationRange,
          lightnessRange: batchConfig.fillColorLightnessRange,
          flip: batchConfig.fillColorRangeFlip 
        }
      );
      shape.properties.fillColor = fillColor;
      shape.properties.gradient = undefined;
    }
    
    // Apply fill opacity
    if (batchConfig.fillOpacityMode === 'range') {
      const [min, max] = batchConfig.fillOpacityRange;
      shape.properties.fillOpacity = (min + Math.random() * (max - min)) / 100;
    } else if (batchConfig.fillOpacityMode === 'define') {
      shape.properties.fillOpacity = batchConfig.fillOpacityDefine / 100;
    }
  }
  
  // Handle stroke probability
  if (batchConfig.strokeEnabled) {
    const shouldHaveStroke = Math.random() * 100 < batchConfig.strokeProbability;
    if (shouldHaveStroke) {
      // Apply stroke width
      const [minWidth, maxWidth] = batchConfig.strokeWidthRange;
      shape.properties.strokeWidth = minWidth + Math.random() * (maxWidth - minWidth);
      
      // Apply stroke color
      const strokeColor = generateColor(
        batchConfig.strokeColorMode,
        batchConfig.strokeColorRange,
        // ... other params
      );
      shape.properties.strokeColor = strokeColor;
      
      // Apply stroke opacity
      // ... similar to fill opacity
    } else {
      shape.properties.strokeColor = 'transparent';
      shape.properties.strokeOpacity = 0;
      shape.properties.strokeWidth = 0;
    }
  }
  
  // Handle blur
  if (batchConfig.blurEnabled) {
    const shouldHaveBlur = Math.random() * 100 < batchConfig.blurProbability;
    if (shouldHaveBlur) {
      if (batchConfig.blurMode === 'range') {
        const [minBlur, maxBlur] = batchConfig.blurRange;
        shape.properties.blurRadius = minBlur + Math.random() * (maxBlur - minBlur);
      } else if (batchConfig.blurMode === 'define') {
        shape.properties.blurRadius = batchConfig.blurDefine;
      }
    }
  }
}
```

#### Step 5: Color Harmony Application
```typescript
if (batchConfig.colorHarmonyEnabled) {
  const colorHarmonySettings = {
    enabled: batchConfig.colorHarmonyEnabled,
    harmonyType: batchConfig.harmonyType,
    baseColor: batchConfig.baseColor,
    hueVariance: batchConfig.hueVariance,
    saturationRange: batchConfig.saturationRange,
    lightnessRange: batchConfig.lightnessRange,
    // ... harmony-specific settings
  };
  
  // Apply harmony to fill color
  shape.properties.fillColor = ColorUtils.generateHarmonyColor(colorHarmonySettings);
  
  // Apply harmony to stroke color
  shape.properties.strokeColor = ColorUtils.generateHarmonyColor(colorHarmonySettings);
  
  // Apply harmony to gradients
  if (shape.properties.gradient) {
    shape.properties.gradient.stops = shape.properties.gradient.stops.map(stop => ({
      ...stop,
      color: ColorUtils.generateHarmonyColor(colorHarmonySettings)
    }));
  }
}
```

#### Step 6: Transform Application
```typescript
if (batchConfig.transformsEnabled) {
  // Calculate transform origin
  let originX = 0, originY = 0;
  if (batchConfig.transformOriginMode === 'predefined-artboard') {
    // Calculate origin from artboard alignment
    switch (batchConfig.transformOriginPredefined) {
      case 'center':
        originX = artboardX + artboardWidth / 2;
        originY = artboardY + artboardHeight / 2;
        break;
      // ... other alignments
    }
  } else if (batchConfig.transformOriginMode === 'define') {
    originX = batchConfig.transformOriginX;
    originY = batchConfig.transformOriginY;
  }
  
  // Calculate position deltas
  let positionDeltaX = 0, positionDeltaY = 0;
  if (batchConfig.xTransformMode === 'range') {
    const [min, max] = batchConfig.translateXRange;
    positionDeltaX = min + Math.random() * (max - min);
  } else if (batchConfig.xTransformMode === 'value') {
    positionDeltaX = batchConfig.xTransformValue;
  } else if (batchConfig.xTransformMode === 'incremental') {
    positionDeltaX = batchConfig.xTransformIncrement * index;
  } else if (batchConfig.xTransformMode === 'align') {
    // Alignment logic between shape anchor and artboard anchor
    positionDeltaX = artboardAnchorX - shapeAnchorX;
  }
  // ... similar for Y
  
  // Calculate scale
  let scaleX = 1, scaleY = 1;
  if (batchConfig.maintainScaleAspectRatio) {
    // Single scale for both axes
    if (batchConfig.scaleXMode === 'range') {
      const [min, max] = batchConfig.scaleXRange;
      scaleX = scaleY = (min + Math.random() * (max - min)) / 100;
    }
  } else {
    // Independent X and Y scaling
    // ... similar logic for each axis
  }
  
  // Calculate rotation
  let rotation = 0;
  if (batchConfig.rotationMode === 'range') {
    const [min, max] = batchConfig.rotationRange;
    rotation = min + Math.random() * (max - min);
  } else if (batchConfig.rotationMode === 'value') {
    rotation = batchConfig.rotationValue;
  } else if (batchConfig.rotationMode === 'incremental') {
    let amount = batchConfig.rotationIncrement * index;
    if (batchConfig.rotationModulationEnabled) {
      amount = amount % batchConfig.rotationModulation;
    }
    rotation = amount;
  }
  
  // Apply transforms relative to origin
  const shapeRelativeX = shape.transform.x - originX;
  const shapeRelativeY = shape.transform.y - originY;
  
  // 1. Scale the relative position
  const scaledX = shapeRelativeX * scaleX;
  const scaledY = shapeRelativeY * scaleY;
  
  // 2. Rotate the scaled position
  const rotRad = (rotation * Math.PI) / 180;
  const rotatedX = scaledX * Math.cos(rotRad) - scaledY * Math.sin(rotRad);
  const rotatedY = scaledX * Math.sin(rotRad) + scaledY * Math.cos(rotRad);
  
  // 3. Apply final position
  shape.transform.x = originX + rotatedX + positionDeltaX;
  shape.transform.y = originY + rotatedY + positionDeltaY;
  shape.transform.scaleX = scaleX;
  shape.transform.scaleY = scaleY;
  shape.transform.rotation = rotation;
  
  // Apply skew if configured
  if (batchConfig.skewXRange && batchConfig.skewYRange) {
    const [minSkewX, maxSkewX] = batchConfig.skewXRange;
    const [minSkewY, maxSkewY] = batchConfig.skewYRange;
    shape.transform.skewX = minSkewX + Math.random() * (maxSkewX - minSkewX);
    shape.transform.skewY = minSkewY + Math.random() * (maxSkewY - minSkewY);
  }
}

// Apply rotation randomization (additive)
if (batchConfig.rotationRandomizationScale > 0) {
  const variation = (Math.random() * 2 - 1) * 30; // ±30° base
  shape.transform.rotation += variation * (batchConfig.rotationRandomizationScale / 100);
}
```

#### Step 7: Noise Application
```typescript
if (batchConfig.noiseEnabled) {
  const noiseResult = NoiseSystem.generateNoiseVariation(
    index,
    batchConfig,
    position.x,
    position.y,
    artboardWidth,
    artboardHeight
  );
  
  // Apply additive noise to position
  shape.transform.x += noiseResult.x;
  shape.transform.y += noiseResult.y;
  
  // Apply additive noise to rotation
  shape.transform.rotation += noiseResult.rotation;
  
  // Apply additive noise to scale
  shape.transform.scaleX += noiseResult.scaleX * 0.1;
  shape.transform.scaleY += noiseResult.scaleY * 0.1;
  
  // Apply noise to opacity (if enabled)
  if (batchConfig.propertiesEnabled && batchConfig.noiseOpacityAmplitude > 0) {
    const baseOpacity = shape.properties.fillOpacity;
    const noiseOpacity = baseOpacity + (noiseResult.opacity - 1) * 0.3;
    shape.properties.fillOpacity = Math.max(0.1, Math.min(1, noiseOpacity));
    shape.properties.strokeOpacity = Math.max(0.1, Math.min(1, noiseOpacity));
  }
  
  // Apply noise to blur
  shape.properties.blurRadius = Math.max(0, noiseResult.blur);
  
  // Apply noise to colors (if color harmony is not enabled)
  if (!batchConfig.colorHarmonyEnabled) {
    if (batchConfig.noiseAlgorithm === 'randomise') {
      // Absolute color values
      const hue = noiseResult.hue;
      const saturation = noiseResult.saturation;
      const lightness = noiseResult.lightness;
      shape.properties.fillColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    } else if (batchConfig.noiseAlgorithm === 'perlin') {
      // Additive variations
      const hslMatch = shape.properties.fillColor.match(/hsl\((\d+\.?\d*),\s*(\d+\.?\d*)%,\s*(\d+\.?\d*)%\)/);
      let hue = parseFloat(hslMatch[1]);
      let saturation = parseFloat(hslMatch[2]);
      let lightness = parseFloat(hslMatch[3]);
      
      hue = (hue + noiseResult.hue + 360) % 360;
      saturation = Math.max(0, Math.min(100, saturation + noiseResult.saturation));
      lightness = Math.max(0, Math.min(100, lightness + noiseResult.lightness));
      
      shape.properties.fillColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }
    // ... other noise algorithms
  }
}
```

#### Step 8: Blend Mode & Compositing
```typescript
if (batchConfig.blendModeEnabled && batchConfig.enabledBlendModes) {
  // Select blend mode based on probability weights
  const enabledModes = Object.entries(batchConfig.enabledBlendModes);
  const totalWeight = enabledModes.reduce((sum, [_, weight]) => sum + weight, 0);
  
  if (totalWeight > 0) {
    const random = Math.random() * totalWeight;
    let cumulative = 0;
    
    for (const [mode, weight] of enabledModes) {
      cumulative += weight;
      if (random < cumulative) {
        shape.properties.blendMode = mode;
        break;
      }
    }
  }
} else if (batchConfig.compositingOperationsEnabled) {
  // Similar logic for compositing operations
  // ...
}
```

---

## Shape-Specific Properties

### Shape Construction: `new Shape(type, x, y, batchConfig)`

Located in: `client/src/lib/shapes.ts` (line ~24)

```typescript
constructor(type: ShapeType, x: number = 0, y: number = 0, batchConfig?: any) {
  this.id = `shape_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  this.type = type;
  this.transform = { x, y, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0 };
  
  // Initialize properties
  if (batchConfig && batchConfig.propertiesEnabled) {
    this.properties = this.generateMinimalProperties();
  } else {
    this.properties = this.generateRandomProperties();
  }
  
  this.selected = false;
  this.points = [];
  this.segments = this.getDefaultSegments();
  this.renderType = this.getDefaultRenderType();
  
  this.generateShapeData(batchConfig);
}
```

### Default Segments
```typescript
private getDefaultSegments(): number {
  switch (this.type) {
    case 'circle':
    case 'ellipse':
      return 32;
    case 'ring':
      return 24;
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
```

### Default Render Type
```typescript
private getDefaultRenderType(): 'polygon' | 'bezier' | 'cubic' | 'smooth' {
  switch (this.type) {
    case 'circle':
    case 'ellipse':
    case 'ring':
      return 'smooth';
    case 'cubic':
      return 'cubic';
    case 'bezier':
      return 'bezier';
    case 'blob':
      return 'bezier';
    default:
      return 'polygon';
  }
}
```

### Minimal Properties (for batch config)
```typescript
private generateMinimalProperties(): ShapeProperties {
  return {
    fillColor: 'transparent',
    fillOpacity: 0,
    strokeColor: 'transparent',
    strokeWidth: 0,
    strokeOpacity: 0,
    blendMode: 'source-over',
    zIndex: Date.now(),
    blurRadius: 0,
    gradient: undefined
  };
}
```

### Generate Shape Data
```typescript
private generateShapeData(batchConfig?: any): void {
  // Helper to get values from batch config
  const getWidthHeight = (): { width: number; height: number } => {
    if (batchConfig?.propertiesEnabled && batchConfig?.shapePropertiesEnabled) {
      const width = batchConfig?.widthRange 
        ? (batchConfig.widthRange[0] + batchConfig.widthRange[1]) / 2 
        : 100;
      const height = batchConfig?.heightRange 
        ? (batchConfig.heightRange[0] + batchConfig.heightRange[1]) / 2 
        : 100;
      return { width, height };
    }
    const width = 40 + Math.random() * 110;
    const height = 30 + Math.random() * 90;
    return { width, height };
  };
  
  const getRadius = (defaultMin = 25, defaultMax = 75): number => {
    const { width } = getWidthHeight();
    return width / 2;
  };
  
  // Shape-specific generation
  switch (this.type) {
    case 'rectangle':
      const rectDims = getWidthHeight();
      this.width = rectDims.width;
      this.height = rectDims.height;
      this.generateRectanglePoints(0);
      break;
      
    case 'rounded-rectangle':
      const roundedRectDims = getWidthHeight();
      this.width = roundedRectDims.width;
      this.height = roundedRectDims.height;
      
      // Get corner radius from batch config or scatter settings
      let cornerRadius = 0;
      if (batchConfig?.propertiesEnabled && batchConfig?.rectangleCornerRadiusRange) {
        const [min, max] = batchConfig.rectangleCornerRadiusRange;
        cornerRadius = min + Math.random() * (max - min);
      } else if (batchConfig?.scatterSettings?.shapeSpecific?.['rounded-rectangle']) {
        const settings = batchConfig.scatterSettings.shapeSpecific['rounded-rectangle'];
        if (settings.cornerRadiusMode === 'fixed') {
          cornerRadius = settings.cornerRadiusValue || 5;
        } else {
          const [min, max] = settings.cornerRadiusRange || [0, 10];
          cornerRadius = min + Math.random() * (max - min);
        }
      }
      this.generateRectanglePoints(cornerRadius);
      break;
      
    case 'circle':
      this.radius = getRadius();
      // Apply segment count from scatter settings
      if (batchConfig?.scatterSettings?.shapeSpecific?.circle) {
        const settings = batchConfig.scatterSettings.shapeSpecific.circle;
        if (settings.segmentCountMode === 'fixed') {
          this.segments = settings.segmentCountValue;
        } else if (settings.segmentCountRange) {
          const [min, max] = settings.segmentCountRange;
          this.segments = Math.floor(min + Math.random() * (max - min + 1));
        }
      }
      this.generateCirclePoints();
      break;
      
    case 'polygon':
      // Get segment count
      this.sides = getSegmentCount(3, 12);
      this.radius = getRadius(30, 70);
      this.generatePolygonPoints();
      break;
      
    case 'star':
      this.sides = getSegmentCount(5, 12);
      this.radius = getRadius(30, 70);
      
      // Get inner radius ratio
      let innerRadiusRatio = 0.3 + Math.random() * 0.4;
      if (batchConfig?.propertiesEnabled && batchConfig?.starInnerRadiusRange) {
        const [min, max] = batchConfig.starInnerRadiusRange;
        innerRadiusRatio = min + Math.random() * (max - min);
      } else if (batchConfig?.scatterSettings?.shapeSpecific?.star) {
        const settings = batchConfig.scatterSettings.shapeSpecific.star;
        if (settings.innerRadiusMode === 'fixed') {
          innerRadiusRatio = settings.innerRadiusValue;
        } else if (settings.innerRadiusRange) {
          const [min, max] = settings.innerRadiusRange;
          innerRadiusRatio = min + Math.random() * (max - min);
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
      
    case 'bezier':
      this.generateCurvePoints(getSplinePointCount(3, 6), batchConfig);
      break;
      
    case 'smooth-spline':
      this.generateSmoothSplinePoints(getSplinePointCount(3, 8), batchConfig);
      break;
      
    case 'cubic':
      this.generateCubicCurvePoints(batchConfig);
      break;
      
    // ... other shape types
  }
}
```

### Line-Vector Properties
```typescript
private generateLineVectorPoints(batchConfig?: any): void {
  // Get properties from scatter settings
  const lineVectorSettings = {
    directionMode: 'range',
    directionRange: [0, 360],
    directionValue: 0,
    lengthMode: 'range',
    lengthRange: [50, 150],
    lengthValue: 100,
    centroidMode: 'fixed',
    centroidValue: 0.5,
    ...(batchConfig?.scatterSettings?.shapeSpecific?.['line-vector'] || {})
  };
  
  // Calculate direction (0-360 degrees)
  const direction = getValue(
    lineVectorSettings.directionMode,
    lineVectorSettings.directionRange,
    lineVectorSettings.directionValue,
    // ... incremental params
  );
  
  // Calculate length
  const length = getValue(
    lineVectorSettings.lengthMode,
    lineVectorSettings.lengthRange,
    lineVectorSettings.lengthValue,
  );
  
  // Calculate centroid (0-1 position along line)
  const centroid = getValue(
    lineVectorSettings.centroidMode,
    lineVectorSettings.centroidRange || [0, 1],
    lineVectorSettings.centroidValue || 0.5,
  );
  
  // Convert to radians and calculate endpoints
  const angleRadians = (direction * Math.PI) / 180;
  const startDistance = length * centroid;
  const endDistance = length * (1 - centroid);
  
  this.points = [
    { 
      x: -Math.cos(angleRadians) * startDistance, 
      y: -Math.sin(angleRadians) * startDistance 
    },
    { 
      x: Math.cos(angleRadians) * endDistance, 
      y: Math.sin(angleRadians) * endDistance 
    }
  ];
  
  this.closed = false;
  this.renderType = 'polygon';
}
```

### Bezier Curve Properties
```typescript
private generateCurvePoints(numPoints?: number, batchConfig?: any): void {
  const pointCount = numPoints || 3 + Math.floor(Math.random() * 5);
  this.points = [];
  this.tangentHandles = [];
  this.smoothPoints = [];
  
  // Get point position range
  let pointPositionRange = [-30, 30];
  if (batchConfig?.splinePropertiesEnabled && batchConfig?.splinePointPositionRange) {
    pointPositionRange = batchConfig.splinePointPositionRange;
  } else if (batchConfig?.scatterSettings?.shapeSpecific?.bezier?.pointPositionRange) {
    pointPositionRange = batchConfig.scatterSettings.shapeSpecific.bezier.pointPositionRange;
  }
  
  const [minPos, maxPos] = pointPositionRange;
  const width = 120;
  const height = 60;
  
  // Generate base points along smooth path
  for (let i = 0; i < pointCount; i++) {
    const t = i / (pointCount - 1);
    const baseX = (t - 0.5) * width;
    const baseY = Math.sin(t * Math.PI * 1.5) * height / 4;
    
    const xVariation = (Math.random() - 0.5) * (maxPos - minPos) * 0.5;
    const yVariation = (Math.random() - 0.5) * (maxPos - minPos) * 0.5;
    
    this.points.push({ x: baseX + xVariation, y: baseY + yVariation });
  }
  
  // Generate mathematically continuous tangent handles
  this.generateSmoothTangentHandles();
  
  // Get open/closed probability
  let openProbability = 70;
  if (batchConfig?.scatterSettings?.shapeSpecific?.bezier?.openProbability !== undefined) {
    openProbability = batchConfig.scatterSettings.shapeSpecific.bezier.openProbability;
  }
  
  this.closed = Math.random() * 100 > openProbability;
  this.renderType = 'bezier';
}
```

### Cubic Curve Properties
```typescript
private generateCubicCurvePoints(batchConfig?: any): void {
  this.points = [];
  this.tangentHandles = [];
  this.smoothPoints = [];
  
  // Get configuration
  let pointCount = 3 + Math.floor(Math.random() * 5);
  let curvatureVariation = 0.3 + Math.random() * 0.4;
  let pointSpread = 60 + Math.random() * 40;
  let curvePattern = Math.floor(Math.random() * 4);
  
  if (batchConfig?.scatterSettings?.shapeSpecific?.cubic) {
    const settings = batchConfig.scatterSettings.shapeSpecific.cubic;
    if (settings.pointCountRange) {
      const [min, max] = settings.pointCountRange;
      pointCount = Math.floor(min + Math.random() * (max - min + 1));
    }
    if (settings.curvatureRange) {
      const [min, max] = settings.curvatureRange;
      curvatureVariation = min + Math.random() * (max - min);
    }
    if (settings.spreadRange) {
      const [min, max] = settings.spreadRange;
      pointSpread = min + Math.random() * (max - min);
    }
    if (settings.patternType !== undefined) {
      curvePattern = settings.patternType;
    }
  }
  
  // Generate points based on pattern
  switch (curvePattern) {
    case 0: this.generateSpiralCubicPoints(pointCount, pointSpread, curvatureVariation); break;
    case 1: this.generateWaveCubicPoints(pointCount, pointSpread, curvatureVariation); break;
    case 2: this.generateOrganicCubicPoints(pointCount, pointSpread, curvatureVariation); break;
    case 3: this.generateArcCubicPoints(pointCount, pointSpread, curvatureVariation); break;
  }
  
  this.generateSmoothTangentHandles();
  
  let openProbability = 85;
  if (batchConfig?.scatterSettings?.shapeSpecific?.cubic?.openProbability !== undefined) {
    openProbability = batchConfig.scatterSettings.shapeSpecific.cubic.openProbability;
  }
  
  this.closed = Math.random() * 100 > openProbability;
  this.renderType = 'cubic';
}
```

### Smooth Tangent Handles Generation
```typescript
private generateSmoothTangentHandles(): void {
  if (!this.points || this.points.length < 2) return;
  
  this.tangentHandles = [];
  this.smoothPoints = [];
  
  for (let i = 0; i < this.points.length; i++) {
    const current = this.points[i];
    const isFirst = i === 0;
    const isLast = i === this.points.length - 1;
    
    let tangentVector: Point = { x: 0, y: 0 };
    
    if (isFirst && !this.closed) {
      // First point: tangent toward next
      const next = this.points[i + 1];
      tangentVector = this.normalizeVector({
        x: next.x - current.x,
        y: next.y - current.y
      });
    } else if (isLast && !this.closed) {
      // Last point: tangent from previous
      const prev = this.points[i - 1];
      tangentVector = this.normalizeVector({
        x: current.x - prev.x,
        y: current.y - prev.y
      });
    } else {
      // Middle points: bisect adjacent segments
      const prevIndex = this.closed ? (i - 1 + this.points.length) % this.points.length : Math.max(0, i - 1);
      const nextIndex = this.closed ? (i + 1) % this.points.length : Math.min(this.points.length - 1, i + 1);
      
      const prev = this.points[prevIndex];
      const next = this.points[nextIndex];
      
      const incomingVector = this.normalizeVector({
        x: current.x - prev.x,
        y: current.y - prev.y
      });
      const outgoingVector = this.normalizeVector({
        x: next.x - current.x,
        y: current.y - prev.y
      });
      
      tangentVector = this.normalizeVector({
        x: (incomingVector.x + outgoingVector.x) / 2,
        y: (incomingVector.y + outgoingVector.y) / 2
      });
    }
    
    // Calculate handle length (30% of average adjacent distance)
    let handleLength = 25;
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
      handleLength = avgDistance * 0.3;
    }
    
    // Create collinear handles (C1 continuity)
    this.tangentHandles.push({
      in: {
        x: current.x - tangentVector.x * handleLength,
        y: current.y - tangentVector.y * handleLength
      },
      out: {
        x: current.x + tangentVector.x * handleLength,
        y: current.y + tangentVector.y * handleLength
      },
      linked: true,
      smooth: true
    });
    
    this.smoothPoints.push(true);
  }
}
```

---

## Color & Gradient Generation

### Color Generation Function

Located in: `client/src/lib/hslColor.ts` (line ~262)

```typescript
export function generateColor(
  mode: 'range' | 'palette' | 'define',
  range?: [string, string],
  palette?: string[],
  define?: string,
  shapeIndex?: number,
  rangeSettings?: {
    saturationRange?: [number, number];
    lightnessRange?: [number, number];
    flip?: boolean;
  }
): string {
  switch (mode) {
    case 'range':
      if (!range || range.length !== 2) return '#3b82f6';
      
      const flip = rangeSettings?.flip || false;
      
      // Interpolate with saturation/lightness ranges
      if (rangeSettings?.saturationRange || rangeSettings?.lightnessRange) {
        const baseColor = interpolateHSLWithFlip(range[0], range[1], Math.random(), flip);
        const hsl = hexToHSL(baseColor);
        
        if (rangeSettings.saturationRange) {
          const [minSat, maxSat] = rangeSettings.saturationRange;
          hsl.s = Math.round(minSat + Math.random() * (maxSat - minSat));
        }
        
        if (rangeSettings.lightnessRange) {
          const [minLight, maxLight] = rangeSettings.lightnessRange;
          hsl.l = Math.round(minLight + Math.random() * (maxLight - minLight));
        }
        
        return hslToHex(hsl);
      } else {
        return interpolateHSLWithFlip(range[0], range[1], Math.random(), flip);
      }
      
    case 'palette':
      if (!palette || palette.length === 0) return '#3b82f6';
      if (shapeIndex !== undefined) {
        return palette[shapeIndex % palette.length];
      } else {
        return palette[Math.floor(Math.random() * palette.length)];
      }
      
    case 'define':
      return define || '#3b82f6';
      
    default:
      return '#3b82f6';
  }
}
```

### HSL Color Interpolation

```typescript
// Linear hue interpolation (full spectrum)
export function interpolateHSL(color1: string, color2: string, t: number): string {
  const hsl1 = hexToHSL(color1);
  const hsl2 = hexToHSL(color2);
  
  const newHue = interpolateLinearHue(hsl1.h, hsl2.h, t);
  
  const newHSL: HSL = {
    h: Math.round(newHue),
    s: Math.round(hsl1.s + (hsl2.s - hsl1.s) * t),
    l: Math.round(hsl1.l + (hsl2.l - hsl1.l) * t)
  };
  
  return hslToHex(newHSL);
}

// Color wheel interpolation (shortest path)
export function interpolateHSLColorWheel(color1: string, color2: string, t: number): string {
  const hsl1 = hexToHSL(color1);
  const hsl2 = hexToHSL(color2);
  
  const hueInfo = getHueDistance(hsl1.h, hsl2.h);
  let newHue = hsl1.h + (hueInfo.direction * hueInfo.distance * t);
  
  if (newHue < 0) newHue += 360;
  if (newHue >= 360) newHue -= 360;
  
  const newHSL: HSL = {
    h: Math.round(newHue),
    s: Math.round(hsl1.s + (hsl2.s - hsl1.s) * t),
    l: Math.round(hsl1.l + (hsl2.l - hsl1.l) * t)
  };
  
  return hslToHex(newHSL);
}

// Interpolation with flip control
export function interpolateHSLWithFlip(
  color1: string, 
  color2: string, 
  t: number, 
  flip: boolean = false
): string {
  const hsl1 = hexToHSL(color1);
  const hsl2 = hexToHSL(color2);
  
  let newHue;
  
  if (flip) {
    // Go long way around hue wheel
    const hueInfo = getHueDistance(hsl1.h, hsl2.h);
    const longDistance = 360 - hueInfo.distance;
    const longDirection = -hueInfo.direction;
    newHue = hsl1.h + (longDirection * longDistance * t);
  } else {
    // Go shortest path
    const hueInfo = getHueDistance(hsl1.h, hsl2.h);
    newHue = hsl1.h + (hueInfo.direction * hueInfo.distance * t);
  }
  
  if (newHue < 0) newHue += 360;
  if (newHue >= 360) newHue -= 360;
  
  const newHSL: HSL = {
    h: Math.round(newHue),
    s: Math.round(hsl1.s + (hsl2.s - hsl1.s) * t),
    l: Math.round(hsl1.l + (hsl2.l - hsl1.l) * t)
  };
  
  return hslToHex(newHSL);
}
```

### Gradient Color Generation

```typescript
export function generateGradientColors(
  mode: 'range' | 'palette' | 'define' | 'hsl',
  stopCount: number,
  range?: [string, string],
  palette?: string[],
  define?: string[],
  shapeIndex?: number,
  hslSettings?: {
    hslMode: 'range' | 'define';
    hueRange?: [number, number];
    saturationRange?: [number, number];
    lightnessRange?: [number, number];
    hueDefine?: number;
    saturationDefine?: number;
    lightnessDefine?: number;
  },
  flip?: boolean
): string[] {
  switch (mode) {
    case 'range':
      if (!range || range.length !== 2) return ['#3b82f6', '#8b5cf6'];
      const colors: string[] = [];
      for (let i = 0; i < stopCount; i++) {
        const t = stopCount === 1 ? 0 : i / (stopCount - 1);
        colors.push(interpolateHSLWithFlip(range[0], range[1], t, flip || false));
      }
      return colors;
      
    case 'palette':
      if (!palette || palette.length === 0) return ['#3b82f6', '#8b5cf6'];
      const paletteColors: string[] = [];
      for (let i = 0; i < stopCount; i++) {
        if (shapeIndex !== undefined) {
          paletteColors.push(palette[(shapeIndex + i) % palette.length]);
        } else {
          paletteColors.push(palette[Math.floor(Math.random() * palette.length)]);
        }
      }
      return paletteColors;
      
    case 'define':
      if (!define || define.length === 0) return ['#3b82f6', '#8b5cf6'];
      const defineColors: string[] = [];
      for (let i = 0; i < stopCount; i++) {
        defineColors.push(define[i % define.length]);
      }
      return defineColors;
      
    case 'hsl':
      if (!hslSettings) return ['#3b82f6', '#8b5cf6'];
      const hslColors: string[] = [];
      
      for (let i = 0; i < stopCount; i++) {
        let h: number, s: number, l: number;
        
        if (hslSettings.hslMode === 'range') {
          const hueRange = hslSettings.hueRange || [0, 360];
          const satRange = hslSettings.saturationRange || [50, 100];
          const lightRange = hslSettings.lightnessRange || [30, 70];
          
          h = hueRange[0] + Math.random() * (hueRange[1] - hueRange[0]);
          s = satRange[0] + Math.random() * (satRange[1] - satRange[0]);
          l = lightRange[0] + Math.random() * (lightRange[1] - lightRange[0]);
        } else {
          h = hslSettings.hueDefine || 270;
          s = hslSettings.saturationDefine || 70;
          l = hslSettings.lightnessDefine || 60;
        }
        
        hslColors.push(hslToHex({ h: Math.round(h), s: Math.round(s), l: Math.round(l) }));
      }
      
      return hslColors;
      
    default:
      return ['#3b82f6', '#8b5cf6'];
  }
}
```

### Color Harmony Generation

Located in: `client/src/lib/colorManipulation.ts`

```typescript
export class ColorUtils {
  static generateHarmonyColor(settings: ColorHarmonySettings): string {
    if (!settings.enabled) {
      const hue = Math.random() * 360;
      const saturation = 50 + Math.random() * 50;
      const lightness = 30 + Math.random() * 40;
      return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }
    
    const baseHSL = this.hexToHSL(settings.baseColor);
    
    switch (settings.harmonyType) {
      case 'monochromatic':
        return this.generateMonochromaticColor(baseHSL, settings);
      case 'analogous':
        return this.generateAnalogousColor(baseHSL, settings);
      case 'complementary':
        return this.generateComplementaryColor(baseHSL, settings);
      case 'triadic':
        return this.generateTriadicColor(baseHSL, settings);
      case 'split-complementary':
        return this.generateSplitComplementaryColor(baseHSL, settings);
      case 'tetradic':
        return this.generateTetradicColor(baseHSL, settings);
      default:
        return settings.baseColor;
    }
  }
  
  private static generateMonochromaticColor(
    baseHSL: { h: number; s: number; l: number }, 
    settings: ColorHarmonySettings
  ): string {
    const { monochromaticSettings, saturationRange, lightnessRange } = settings;
    
    let saturation = baseHSL.s;
    let lightness = baseHSL.l;
    
    if (monochromaticSettings.saturationSteps > 1) {
      const satStep = (saturationRange[1] - saturationRange[0]) / (monochromaticSettings.saturationSteps - 1);
      const stepIndex = Math.floor(Math.random() * monochromaticSettings.saturationSteps);
      saturation = saturationRange[0] + (stepIndex * satStep);
    } else {
      saturation = saturationRange[0] + Math.random() * (saturationRange[1] - saturationRange[0]);
    }
    
    if (monochromaticSettings.lightnessSteps > 1) {
      const lightStep = (lightnessRange[1] - lightnessRange[0]) / (monochromaticSettings.lightnessSteps - 1);
      const stepIndex = Math.floor(Math.random() * monochromaticSettings.lightnessSteps);
      lightness = lightnessRange[0] + (stepIndex * lightStep);
    } else {
      lightness = lightnessRange[0] + Math.random() * (lightnessRange[1] - lightnessRange[0]);
    }
    
    if (monochromaticSettings.includeNeutrals && Math.random() < 0.2) {
      saturation = Math.random() * 15;
    }
    
    return `hsl(${baseHSL.h}, ${saturation}%, ${lightness}%)`;
  }
  
  private static generateAnalogousColor(
    baseHSL: { h: number; s: number; l: number }, 
    settings: ColorHarmonySettings
  ): string {
    const { analogousSettings, saturationRange, lightnessRange, hueVariance } = settings;
    
    const analogousPositions = [
      0,
      analogousSettings.hueRange / 2,
      -analogousSettings.hueRange / 2
    ];
    
    const selectedPosition = analogousPositions[Math.floor(Math.random() * analogousPositions.length)];
    let hue = (baseHSL.h + selectedPosition + 360) % 360;
    hue += (Math.random() - 0.5) * Math.min(hueVariance, 10);
    hue = (hue + 360) % 360;
    
    const saturation = saturationRange[0] + Math.random() * (saturationRange[1] - saturationRange[0]);
    const lightness = lightnessRange[0] + Math.random() * (lightnessRange[1] - lightnessRange[0]);
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }
  
  // ... other harmony types follow similar patterns
}
```

---

## Noise System

### Noise Generation Function

Located in: `client/src/lib/noiseSystem.ts` (line ~74)

```typescript
export class NoiseSystem {
  static generateNoiseVariation(
    shapeIndex: number,
    settings: BatchConfigSettings,
    baseX: number = 0,
    baseY: number = 0,
    artboardWidth: number = 400,
    artboardHeight: number = 400
  ): NoiseResult {
    const { noiseEnabled, noiseAlgorithm, noiseScale, noiseOctaves, noiseAmplitude, noiseSeed } = settings;
    
    if (!noiseEnabled) {
      return {
        x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
        opacity: 1, blur: 0, hue: 0, saturation: 0, lightness: 0
      };
    }
    
    const options: NoiseOptions = {
      algorithm: noiseAlgorithm,
      scale: noiseScale,
      octaves: noiseOctaves,
      amplitude: noiseAmplitude,
      seed: noiseSeed,
      scaleToCanvas: settings.noiseScaleToCanvas,
      artboardWidth: artboardWidth,
      artboardHeight: artboardHeight,
      positionAmplitude: settings.noisePositionAmplitude,
      rotationAmplitude: settings.noiseRotationAmplitude,
      scaleAmplitude: settings.noiseScaleAmplitude,
      opacityAmplitude: settings.noiseOpacityAmplitude,
      colorAmplitude: settings.noiseColorAmplitude,
      octaveMode: settings.noiseOctaveMode,
      lacunarity: settings.noiseLacunarity,
      gain: settings.noiseGain,
      distanceFunction: settings.noiseDistanceFunction,
      featurePoints: settings.noiseFeaturePoints,
      ridgeOffset: settings.noiseRidgeOffset,
      turbulencePower: settings.noiseTurbulencePower
    };
    
    // Generate noise coordinates with prime spacing
    const noiseX = (shapeIndex * 1.37 + baseX * 0.01) * options.scale;
    const noiseY = (shapeIndex * 2.11 + baseY * 0.01) * options.scale;
    const noiseZ = shapeIndex * 0.83;
    
    switch (options.algorithm) {
      case 'randomise':
        return this.generateRandomNoise(shapeIndex, options);
      case 'perlin':
        return this.generatePerlinNoise(noiseX, noiseY, noiseZ, options);
      case 'simplex':
        return this.generateSimplexNoise(noiseX, noiseY, noiseZ, options);
      case 'fractal':
        return this.generateFractalNoise(noiseX, noiseY, noiseZ, options);
      case 'worley':
        return this.generateWorleyNoise(noiseX, noiseY, options);
      case 'ridge':
        return this.generateRidgeNoise(noiseX, noiseY, noiseZ, options);
      case 'turbulence':
        return this.generateTurbulenceNoise(noiseX, noiseY, noiseZ, options);
      default:
        return this.generateRandomNoise(shapeIndex, options);
    }
  }
}
```

### Random Noise
```typescript
private static generateRandomNoise(shapeIndex: number, options: NoiseOptions): NoiseResult {
  // Use large prime offsets for independence
  const baseOffset = shapeIndex * 4177;
  
  const randX = this.seededRandom(options.seed + baseOffset + 7919)();
  const randY = this.seededRandom(options.seed + baseOffset + 15937)();
  const randRot = this.seededRandom(options.seed + baseOffset + 24077)();
  const randScale = this.seededRandom(options.seed + baseOffset + 32143)();
  const randOpacity = this.seededRandom(options.seed + baseOffset + 40213)();
  const randHue = this.seededRandom(options.seed + baseOffset + 48299)();
  const randSat = this.seededRandom(options.seed + baseOffset + 56377)();
  const randLght = this.seededRandom(options.seed + baseOffset + 64439)();
  const randBlur = this.seededRandom(options.seed + baseOffset + 72511)();
  
  const artboardWidth = options.artboardWidth || 400;
  const artboardHeight = options.artboardHeight || 400;
  
  const maxPosOffset = options.scaleToCanvas 
    ? Math.min(artboardWidth * 0.3, artboardHeight * 0.3) 
    : 20;
  
  return {
    x: (randX - 0.5) * 2 * maxPosOffset * options.amplitude,
    y: (randY - 0.5) * 2 * maxPosOffset * options.amplitude,
    rotation: randRot * 360 * options.amplitude,
    scaleX: 0.5 + randScale * 1.0 * options.amplitude,
    scaleY: 0.5 + randScale * 1.0 * options.amplitude,
    opacity: Math.max(0.1, 0.1 + randOpacity * 0.9 * options.amplitude),
    blur: randBlur * 20 * options.amplitude,
    hue: randHue * 360 * options.amplitude,
    saturation: 50 + randSat * 50 * options.amplitude,
    lightness: 30 + randLght * 40 * options.amplitude
  };
}
```

### Perlin Noise
```typescript
private static generatePerlinNoise(x: number, y: number, z: number, options: NoiseOptions): NoiseResult {
  let positionX = 0, positionY = 0, rotation = 0;
  let scaleX = 0, scaleY = 0, opacity = 0, blur = 0;
  let hue = 0, saturation = 0, lightness = 0;
  
  const artboardWidth = options.artboardWidth || 400;
  const artboardHeight = options.artboardHeight || 400;
  const maxPosOffset = options.scaleToCanvas 
    ? Math.min(artboardWidth * 0.3, artboardHeight * 0.3) 
    : 50;
  
  let amplitude = options.amplitude;
  let frequency = 1 / options.scale;
  
  // Generate noise across octaves
  for (let i = 0; i < options.octaves; i++) {
    // Use large primes for coordinate independence
    const noiseX = this.perlin3D(x * frequency + 1117 * i, y * frequency + 2221 * i, z * frequency + 3331 * i, options.seed + 1);
    const noiseY = this.perlin3D(x * frequency + 4441 * i, y * frequency + 5557 * i, z * frequency + 6661 * i, options.seed + 2);
    const noiseRot = this.perlin3D(x * frequency + 7771 * i, y * frequency + 8887 * i, z * frequency + 9997 * i, options.seed + 3);
    const noiseScaleX = this.perlin3D(x * frequency + 10007 * i, y * frequency + 11117 * i, z * frequency + 12227 * i, options.seed + 4);
    const noiseScaleY = this.perlin3D(x * frequency + 13337 * i, y * frequency + 14447 * i, z * frequency + 15557 * i, options.seed + 5);
    const noiseOpacity = this.perlin3D(x * frequency + 16667 * i, y * frequency + 17777 * i, z * frequency + 18887 * i, options.seed + 6);
    const noiseHue = this.perlin3D(x * frequency + 19997 * i, y * frequency + 21107 * i, z * frequency + 22217 * i, options.seed + 7);
    const noiseSat = this.perlin3D(x * frequency + 23327 * i, y * frequency + 24437 * i, z * frequency + 25547 * i, options.seed + 8);
    const noiseLght = this.perlin3D(x * frequency + 26657 * i, y * frequency + 27767 * i, z * frequency + 28877 * i, options.seed + 9);
    const noiseBlur = this.perlin3D(x * frequency + 29987 * i, y * frequency + 31097 * i, z * frequency + 32207 * i, options.seed + 10);
    
    // Apply noise with proper ranges
    positionX += noiseX * amplitude * maxPosOffset * 0.25;
    positionY += noiseY * amplitude * maxPosOffset * 0.25;
    rotation += noiseRot * amplitude * 45;
    scaleX += noiseScaleX * amplitude * 0.125;
    scaleY += noiseScaleY * amplitude * 0.125;
    opacity += noiseOpacity * amplitude * 0.15;
    blur += noiseBlur * amplitude * 5;
    hue += noiseHue * amplitude * 60;
    saturation += noiseSat * amplitude * 30;
    lightness += noiseLght * amplitude * 25;
    
    amplitude *= (options.gain || 0.5);
    frequency *= (options.lacunarity || 2.0);
  }
  
  return {
    x: Math.max(-maxPosOffset, Math.min(maxPosOffset, positionX)),
    y: Math.max(-maxPosOffset, Math.min(maxPosOffset, positionY)),
    rotation: Math.abs(rotation) % 360,
    scaleX: Math.max(1.0, 1.0 + scaleX),
    scaleY: Math.max(1.0, 1.0 + scaleY),
    opacity: Math.max(0.1, Math.min(1.0, 1.0 + opacity)),
    blur: Math.max(0, blur + 10),
    hue: Math.abs(hue) % 360,
    saturation: Math.max(0, Math.min(100, 75 + saturation)),
    lightness: Math.max(0, Math.min(100, 50 + lightness))
  };
}
```

---

## Transform System

### Transform Origin Calculation

```typescript
// Calculate transform origin point
let originX = 0, originY = 0;

if (batchConfig.transformOriginMode === 'define') {
  originX = batchConfig.transformOriginX || 0;
  originY = batchConfig.transformOriginY || 0;
} else if (batchConfig.transformOriginMode === 'predefined-artboard') {
  const artboardWidth = currentArtboard?.width || canvasBounds.width;
  const artboardHeight = currentArtboard?.height || canvasBounds.height;
  const artboardX = currentArtboard?.x || canvasBounds.x;
  const artboardY = currentArtboard?.y || canvasBounds.y;
  
  switch (batchConfig.transformOriginPredefined) {
    case 'center':
      originX = artboardX + artboardWidth / 2;
      originY = artboardY + artboardHeight / 2;
      break;
    case 'top-left':
      originX = artboardX;
      originY = artboardY;
      break;
    case 'top-center':
      originX = artboardX + artboardWidth / 2;
      originY = artboardY;
      break;
    // ... other alignments
  }
} else if (batchConfig.transformOriginMode === 'predefined-shape') {
  const shapeWidth = shape.width || (shape.radius * 2) || 100;
  const shapeHeight = shape.height || (shape.radius * 2) || 100;
  const shapeX = shape.transform.x;
  const shapeY = shape.transform.y;
  
  switch (batchConfig.transformOriginPredefined) {
    case 'center':
      originX = shapeX;
      originY = shapeY;
      break;
    case 'top-left':
      originX = shapeX - shapeWidth / 2;
      originY = shapeY - shapeHeight / 2;
      break;
    // ... other alignments
  }
}
```

### Transform Application Order

```typescript
// Store shape's position relative to origin
const shapeRelativeX = shape.transform.x - originX;
const shapeRelativeY = shape.transform.y - originY;

// 1. SCALE the relative position
const scaledRelativeX = shapeRelativeX * scaleX;
const scaledRelativeY = shapeRelativeY * scaleY;

// 2. ROTATE the scaled position
const rotationRad = (rotation * Math.PI) / 180;
const cosR = Math.cos(rotationRad);
const sinR = Math.sin(rotationRad);
const rotatedX = scaledRelativeX * cosR - scaledRelativeY * sinR;
const rotatedY = scaledRelativeX * sinR + scaledRelativeY * cosR;

// 3. TRANSLATE back from origin and apply position delta
shape.transform.x = originX + rotatedX + positionDeltaX;
shape.transform.y = originY + rotatedY + positionDeltaY;
shape.transform.scaleX = scaleX;
shape.transform.scaleY = scaleY;
shape.transform.rotation = rotation;
```

---

## Property Application Order

### Complete Execution Order

1. **Shape Construction** (`new Shape(type, x, y, batchConfig)`)
   - Set initial position from distribution or batch config
   - Generate minimal or random properties based on `propertiesEnabled`
   - Generate shape geometry (`generateShapeData`)
   
2. **Size Application** (if `propertiesEnabled && shapePropertiesEnabled`)
   - Calculate width from batch config mode (range/value/incremental)
   - Calculate height from batch config mode
   - Apply aspect ratio constraint if enabled
   - Apply size to shape based on type
   - **CRITICAL**: Call `shape.regenerateShapePoints()`
   
3. **Color Harmony** (if `colorHarmonyEnabled`)
   - Override fill color with harmony color
   - Override stroke color with harmony color
   - Override gradient colors with harmony colors
   
4. **Fill & Stroke Application** (if `propertiesEnabled && !colorHarmonyEnabled`)
   - Determine fill style (solid vs gradient) based on probability
   - For solid fill:
     - Generate color from mode (range/palette/define)
     - Apply opacity from mode
   - For gradient fill:
     - Determine gradient type based on probabilities
     - Generate gradient stops
     - Set fill color to transparent
     - Apply opacity
   - For stroke:
     - Check stroke probability
     - If enabled: apply color, width, opacity
     - If disabled: set to transparent
   
5. **Blur Application** (if `blurEnabled`)
   - Check blur probability
   - If enabled: apply blur from mode (range/define/incremental)
   
6. **Transform Application** (if `transformsEnabled`)
   - Calculate transform origin
   - Calculate position deltas from mode
   - Calculate scale from mode
   - Calculate rotation from mode
   - Apply transforms relative to origin:
     1. Scale relative position
     2. Rotate scaled position
     3. Translate from origin + position delta
   - Apply skew if configured
   - Apply rotation randomization (additive)
   
7. **Noise Application** (if `noiseEnabled`)
   - Generate noise variation for shape index
   - Apply additive noise to position
   - Apply additive noise to rotation
   - Apply additive noise to scale
   - Apply additive noise to opacity (if amplitude > 0)
   - Apply additive noise to blur
   - Apply noise to colors (if color harmony not enabled):
     - **Randomise**: Absolute color values
     - **Perlin**: Additive variations to existing color
     - **Other**: Additive variations to base color
   
8. **Blend Mode & Compositing** (independent of `propertiesEnabled`)
   - If blend modes enabled: select based on probability weights
   - Else if compositing enabled: select based on probability weights
   
9. **Distribution Layout** (if `distributionLayoutEnabled`)
   - Apply grid/wave/ellipse/spiral distribution
   - Apply sorting if enabled
   - Apply randomization offsets

### Critical Dependencies

1. **Color Application Hierarchy**:
   - Color Harmony > Fill/Stroke Config > Noise Colors
   - If Color Harmony enabled, it overrides all other color logic
   - If Noise enabled without Color Harmony, Randomise overrides fill/stroke config
   
2. **Opacity Application**:
   - Fill/Stroke opacity from batch config > Noise opacity (additive)
   
3. **Transform Order**:
   - Position calculation > Size application > Transform origin > Scale > Rotate > Translate > Noise (all additive)
   
4. **Shape Regeneration**:
   - Must call `regenerateShapePoints()` after any size changes
   
5. **Probability Gates**:
   - Fill style probability: solid vs gradient
   - Stroke probability: stroke vs no stroke
   - Blur probability: blur vs no blur
   - Blend mode weights: distribution across modes
   - Compositing weights: distribution across operations

---

## Summary

The server must replicate this exact process to achieve parity:

1. **Configuration**: Use identical `BatchConfigSettings` structure from `shared/schema.ts`
2. **Shape Construction**: Follow same constructor pattern and `generateShapeData` logic
3. **Property Application**: Apply properties in the exact order listed above
4. **Color Generation**: Use identical HSL interpolation and harmony algorithms
5. **Noise System**: Implement all 7 noise algorithms with same parameters
6. **Transform System**: Apply transforms in the same order with same origin calculations
7. **Probability Logic**: Use same probability-based selection for fill style, stroke, blur, and blend modes

The key to parity is maintaining the exact property application order and respecting all the conditional gates (`propertiesEnabled`, `shapePropertiesEnabled`, `colorHarmonyEnabled`, etc.).
