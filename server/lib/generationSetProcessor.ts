/**
 * Generation Set Processor for Server-side Multi-Set Generation
 * Ported from client/src/hooks/useShapeEditor.ts (generateRandomShapes function)
 * and client/src/lib/offscreenRenderer.ts (compositing logic)
 * 
 * This module handles:
 * - Multi-set generation with layering
 * - Z-index offsets (generationOrder × 1000)
 * - Set transforms (translation, rotation, scaling)
 * - Artboard alignment (fit-to-artboard, 9-point alignment)
 * - Set visibility and opacity
 * - Offscreen rendering and compositing
 * - Blend modes and compositing operations
 */

import { Shape } from './shapeGenerator';
import { generateShapesWithBatchConfig } from './batchConfigProcessor';
import { renderShape } from './canvasRenderer';
import { createCanvas, Canvas, CanvasRenderingContext2D } from 'canvas';
import type { GenerationSet, SetTransform, ArtboardAlignment, SetVisibility, FitTarget, PrintUnitType } from '../../shared/schema';
import { fixedModeCount } from '../../shared/shapeTypeGenUtils';

/**
 * Topological sort for copy-to-points dependencies.
 * Ensures that destination sets (referenced by copyToPointsConfig.destinationSetId)
 * are always generated before the source sets that reference them.
 * Falls back to generationOrder for sets without copy-to-points dependencies.
 */
function topologicalSortSets(sets: GenerationSet[]): GenerationSet[] {
  const byId = new Map(sets.map(s => [s.id, s]));
  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const cycleSetIds = new Set<string>();
  const result: GenerationSet[] = [];

  function visit(set: GenerationSet) {
    if (visited.has(set.id)) return;
    if (inProgress.has(set.id)) {
      // Cycle detected — skip the back-edge to break the loop
      console.warn(
        `[CTP] Circular dependency detected involving set "${set.name ?? set.id}". ` +
        `Skipping back-edge. Select the set, disable CTP, and click Apply to clear the stale config.`
      );
      cycleSetIds.add(set.id);
      return;
    }
    inProgress.add(set.id);
    // If this set uses copy-to-points, visit its destination set first
    const destId = set.batchConfig?.copyToPointsEnabled
      ? set.batchConfig?.copyToPointsConfig?.destinationSetId
      : undefined;
    if (destId) {
      const destSet = byId.get(destId);
      if (destSet) visit(destSet);
    }
    inProgress.delete(set.id);
    visited.add(set.id);
    result.push(set);
  }

  // Visit in generationOrder so that among unrelated sets the original order is preserved
  const sorted = [...sets].sort((a, b) => a.generationOrder - b.generationOrder);
  sorted.forEach(set => visit(set));

  if (cycleSetIds.size > 0) {
    const cycleNames = Array.from(cycleSetIds).map(id => sets.find(s => s.id === id)?.name ?? id).join(', ');
    console.warn(`[CTP] Cycle involves set(s): ${cycleNames}. Falling back to generationOrder sort.`);
    return [...sets].sort((a, b) => a.generationOrder - b.generationOrder);
  }

  return result;
}
import type { ShapeType, DistributionSettings } from '../../client/src/lib/shapeTypes';
import { convertPrintUnitToPixels } from '../../client/src/lib/imageExport';

interface ArtboardSettings {
  x: number;
  y: number;
  width: number;
  height: number;
  dpi?: number;
  backgroundColor?: string;
  printConfig?: {
    overlays?: {
      bleed?: {
        display?: boolean;
        render?: boolean;
        amount?: number;
      };
      overlayUnit?: string;
    };
  };
}

interface ExportSettings {
  width: number;
  height: number;
  scale?: number;
  dpr?: number;
}

interface ProcessGenerationSetsResult {
  shapes: Shape[];
  canvas: Canvas;
}

interface RenderContext {
  width: number;
  height: number;
  dpr: number;
}

interface RepetitionSettings {
  globalMode: 'fixed' | 'range';
  globalValue: number;
  globalRange: [number, number];
}

/** Mirror of client calculateRepetitionCount — resolves how many extra times a set repeats. */
function calculateSetRepetitionCount(set: GenerationSet, global?: RepetitionSettings): number {
  const useSetOwn = set.repetitionMode && set.repetitionMode !== 'use-global';
  if (useSetOwn) {
    if (set.repetitionMode === 'fixed') return (set.repetitionValue as number) || 0;
    if (set.repetitionMode === 'range' && set.repetitionRange) {
      const [min, max] = set.repetitionRange as [number, number];
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    return 0;
  }
  if (!global) return 0;
  if (global.globalMode === 'fixed') return global.globalValue;
  const [min, max] = global.globalRange;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Main function to process generation sets and create a final composited canvas
 * 
 * @param sets - Array of generation sets to process
 * @param artboardSettings - Artboard dimensions and properties
 * @param exportSettings - Export/rendering settings
 * @param repetitionSettings - Optional global repetition settings (mirrors client useState)
 * @returns Object containing all generated shapes and final composited canvas
 */
export function processGenerationSets(
  sets: GenerationSet[],
  artboardSettings: ArtboardSettings,
  exportSettings: ExportSettings,
  repetitionSettings?: RepetitionSettings
): ProcessGenerationSetsResult {
  // Filter enabled sets then apply dependency-aware topological sort so that
  // copy-to-points destination sets are always generated before source sets.
  const enabledSets = topologicalSortSets(sets.filter(set => set.enabled));

  if (enabledSets.length === 0) {
    // No enabled sets, return empty result
    const canvas = createCanvas(exportSettings.width, exportSettings.height);
    return { shapes: [], canvas };
  }

  // Canvas bounds for shape placement
  // If x/y are not provided, center the artboard at (0, 0)
  const canvasBounds = {
    x: artboardSettings.x ?? -artboardSettings.width / 2,
    y: artboardSettings.y ?? -artboardSettings.height / 2,
    width: artboardSettings.width,
    height: artboardSettings.height
  };

  // Render context for offscreen canvases
  const dpr = exportSettings.dpr || 1;
  const renderContext: RenderContext = {
    width: exportSettings.width,
    height: exportSettings.height,
    dpr
  };

  // Generate shapes for each enabled set.
  // shapesBySetId accumulates completed shapes keyed by set.id so that copy-to-points
  // source sets can reference already-generated destination shapes.
  const allShapes: Shape[] = [];
  const setCanvases: Array<{ canvas: Canvas; set: GenerationSet }> = [];
  const shapesBySetId = new Map<string, Shape[]>();
  const batchConfigBySetId = new Map<string, any>(enabledSets.map(s => [s.id, s.batchConfig]));

  enabledSets.forEach((set, setIndex) => {
    console.log(`🎯 [SERVER] Processing generation set "${set.name}" (order: ${set.generationOrder})`);

    const repetitionCount = calculateSetRepetitionCount(set, repetitionSettings);
    const totalReps = Math.max(1, repetitionCount);
    console.log(`🔁 [SERVER] Set "${set.name}" will generate ${totalReps} time(s) (repetitionCount=${repetitionCount})`);

    // Collect all shapes from every repetition before applying set-level effects
    const allSetShapes: Shape[] = [];

    for (let repIndex = 0; repIndex < totalReps; repIndex++) {
      // Shape count may vary per repetition when using range mode
      const setGenMode = (set.shapeTypeGenMode ?? 'random') as 'random' | 'weighted' | 'fixed' | 'sequence';
      const setCount = setGenMode === 'fixed'
        ? fixedModeCount(set.enabledShapeTypes, set.shapeTypeFixedCounts ?? {})
        : set.shapeCountMode === 'fixed'
          ? set.shapeCountFixed
          : Math.floor(Math.random() * (set.shapeCountRange[1] - set.shapeCountRange[0] + 1)) + set.shapeCountRange[0];

      console.log(`🎯 [SERVER] Rep ${repIndex + 1}/${totalReps}: generating ${setCount} shapes for set "${set.name}"`);

      const scatterSettings = {
        distribution: {
          pattern: 'random' as const,
          spacing: 50,
          randomness: 0.3,
          rotation: 0,
          scale: 1,
          density: 0.5,
          avoidOverlap: false,
          respectBounds: true
        } as DistributionSettings,
        shapeSpecific: set.shapeSpecificProperties || {}
      };

      const { shapes: repShapes } = generateShapesWithBatchConfig(
        setCount,
        canvasBounds,
        {
          enabledShapeTypes: set.enabledShapeTypes as ShapeType[],
          batchConfig: set.batchConfig,
          distributionEnabled: true,
          scatterSettings: scatterSettings,
          echoOverride: set.echoOverride,
          shapeTypeGenMode: setGenMode,
          shapeTypeWeights: set.shapeTypeWeights,
          shapeTypeFixedCounts: set.shapeTypeFixedCounts,
          shapeTypeSequence: set.shapeTypeSequence,
        },
        {
          generationIndex: repIndex,
          startIndex: 0,
          // Pass all shapes generated so far so copy-to-points can look up destination sets
          destinationShapesMap: shapesBySetId,
          destinationBatchConfigMap: batchConfigBySetId
        }
      );

      // Apply z-index offset — same for all reps of the same set
      repShapes.forEach(shape => {
        shape.properties.zIndex += set.generationOrder * 1000;
      });

      allSetShapes.push(...repShapes);
    }

    console.log(`🔍 [SERVER] Total shapes for set "${set.name}": ${allSetShapes.length} (${totalReps} rep(s))`);

    // Apply set-level effects to the combined shape list from all repetitions
    applySetVisibility(allSetShapes, set.setVisibility, set.name);
    applySetTransform(allSetShapes, set.setTransform, set.name);
    applyArtboardAlignment(allSetShapes, set.artboardAlignment, artboardSettings, set.name);

    // Register completed shapes so downstream sets (copy-to-points sources) can reference them
    shapesBySetId.set(set.id, allSetShapes);

    // Dynamically detect whether this set is acting as a point source for any other enabled set.
    // Mirrors client-side logic — no manual useAsPointSource flag needed; derived from live CTP config.
    const isEffectivelyPointSource = enabledSets.some(
      s => s.id !== set.id &&
           s.batchConfig?.copyToPointsEnabled === true &&
           s.batchConfig?.copyToPointsConfig?.destinationSetId === set.id
    );
    const isHiddenPointSource = isEffectivelyPointSource && (set as any).hideWhenUsedAsPointSource;

    const setCanvas = renderSetToOffscreenCanvas(set, allSetShapes, renderContext, artboardSettings);
    setCanvases.push({ canvas: setCanvas, set: { ...set, _serverHide: isHiddenPointSource } as any });
    if (!isHiddenPointSource) {
      allShapes.push(...allSetShapes);
    }
  });

  console.log(`✅ [SERVER] Generated total of ${allShapes.length} shapes from ${enabledSets.length} generation sets`);

  // Create final composite canvas
  const finalCanvas = createCanvas(exportSettings.width, exportSettings.height);
  const finalCtx = finalCanvas.getContext('2d');

  // Fill background
  if (artboardSettings.backgroundColor) {
    finalCtx.fillStyle = artboardSettings.backgroundColor;
    finalCtx.fillRect(0, 0, exportSettings.width, exportSettings.height);
  }

  // Composite all set canvases onto final canvas
  compositeSetCanvases(finalCtx, setCanvases);

  return {
    shapes: allShapes,
    canvas: finalCanvas
  };
}

/**
 * Apply set visibility and opacity to all shapes in a set
 * 
 * @param shapes - Array of shapes in the set
 * @param visibility - Set visibility configuration
 * @param setName - Name of the set (for logging)
 */
function applySetVisibility(
  shapes: Shape[],
  visibility: SetVisibility | undefined,
  setName: string
): void {
  // If no visibility config, shapes are visible with default opacity
  if (!visibility) {
    return;
  }
  
  if (!visibility.visible) {
    console.log(`👁️ [SERVER] Set "${setName}" is hidden, shapes will be skipped during render`);
    return;
  }
  
  if (visibility.opacity < 1 || visibility.opacityVariance > 0) {
    console.log(`🌫️ [SERVER] Applying set opacity ${visibility.opacity} with variance ${visibility.opacityVariance} to set "${setName}"`);
    
    shapes.forEach(shape => {
      const variance = (Math.random() - 0.5) * 2 * visibility.opacityVariance;
      const finalOpacity = Math.max(0, Math.min(1, visibility.opacity + variance));
      
      // Apply to both fill and stroke opacity
      shape.properties.fillOpacity *= finalOpacity;
      shape.properties.strokeOpacity *= finalOpacity;
    });
  }
}

/**
 * Apply set-level transform to all shapes in a set
 * Handles translation, rotation, and scaling
 * 
 * @param shapes - Array of shapes in the set
 * @param transform - Set transform configuration
 * @param setName - Name of the set (for logging)
 */
function applySetTransform(
  shapes: Shape[],
  transform: SetTransform,
  setName: string
): void {
  if (!transform) return;

  // Check if any transforms are non-default
  const hasTransform = transform.x !== 0 || transform.y !== 0 || 
    transform.rotation !== 0 || transform.scaleX !== 1 || transform.scaleY !== 1;

  if (!hasTransform) return;

  console.log(`🔄 [SERVER] Applying setTransform to set "${setName}": x=${transform.x}, y=${transform.y}, rotation=${transform.rotation}, scaleX=${transform.scaleX}, scaleY=${transform.scaleY}`);
  
  shapes.forEach(shape => {
    // Apply translation
    shape.transform.x += transform.x;
    shape.transform.y += transform.y;
    
    // Apply rotation
    shape.transform.rotation += transform.rotation;
    
    // Apply scale
    shape.transform.scaleX *= transform.scaleX;
    shape.transform.scaleY *= transform.scaleY;
  });
}

/**
 * Apply artboard alignment to all shapes in a set
 * Supports fit-to-artboard and 9-point alignment
 * 
 * @param shapes - Array of shapes in the set
 * @param alignment - Artboard alignment configuration
 * @param artboard - Artboard settings
 * @param setName - Name of the set (for logging)
 */
function applyArtboardAlignment(
  shapes: Shape[],
  alignment: ArtboardAlignment,
  artboard: ArtboardSettings,
  setName: string
): void {
  if (!alignment || shapes.length === 0) return;

  // Determine fit target: use new fitTarget field if set, fall back to legacy fitToArtboard boolean
  const fitTarget: FitTarget = (alignment as any).fitTarget || 
    (alignment.fitToArtboard ? 'artboard' : 'none');

  if (fitTarget === 'artboard' || fitTarget === 'bleed') {
    const fitMode = alignment.fitMode || 'contain';
    console.log(`📐 [SERVER] Applying fit to ${fitTarget} for set "${setName}" (mode: ${fitMode})`);
    
    // Calculate bleed expansion if fitting to bleed
    let bleedPx = 0;
    if (fitTarget === 'bleed' && artboard.printConfig?.overlays?.bleed) {
      const bleedConfig = artboard.printConfig.overlays.bleed;
      const overlayUnit = artboard.printConfig.overlays.overlayUnit || 'pixels';
      const dpi = artboard.dpi || 300;
      
      // Apply bleed based on amount > 0 (display/render are visualization settings, not the actual bleed value)
      if (bleedConfig.amount && bleedConfig.amount > 0) {
        bleedPx = convertPrintUnitToPixels(bleedConfig.amount, overlayUnit as PrintUnitType, dpi);
        console.log(`📐 [SERVER BLEED] Expanding target by bleed: ${bleedConfig.amount}${overlayUnit} = ${bleedPx.toFixed(1)}px`);
      }
    }
    
    // Calculate bounding box of all shapes in this set using world bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    shapes.forEach(shape => {
      // Calculate world bounds for shape, accounting for transform scale
      const x = shape.transform.x;
      const y = shape.transform.y;
      const halfWidth = ((shape.width || 50) * (shape.transform.scaleX || 1)) / 2;
      const halfHeight = ((shape.height || 50) * (shape.transform.scaleY || 1)) / 2;
      
      minX = Math.min(minX, x - halfWidth);
      minY = Math.min(minY, y - halfHeight);
      maxX = Math.max(maxX, x + halfWidth);
      maxY = Math.max(maxY, y + halfHeight);
    });
    
    const setBoundsWidth = maxX - minX;
    const setBoundsHeight = maxY - minY;
    const setCenterX = (minX + maxX) / 2;
    const setCenterY = (minY + maxY) / 2;
    
    // Normalize margin to individual values
    const margin = alignment.margin || 0;
    const marginTop = typeof margin === 'number' ? margin : margin.top;
    const marginBottom = typeof margin === 'number' ? margin : margin.bottom;
    const marginLeft = typeof margin === 'number' ? margin : margin.left;
    const marginRight = typeof margin === 'number' ? margin : margin.right;
    
    // Calculate target area dimensions (artboard + bleed if applicable)
    const targetX = artboard.x - bleedPx;
    const targetY = artboard.y - bleedPx;
    const targetWidth = artboard.width + (bleedPx * 2);
    const targetHeight = artboard.height + (bleedPx * 2);
    
    // Calculate scale to fit within target area with margin
    const availableWidth = targetWidth - marginLeft - marginRight;
    const availableHeight = targetHeight - marginTop - marginBottom;
    
    const scaleX = availableWidth / setBoundsWidth;
    const scaleY = availableHeight / setBoundsHeight;
    
    // fitMode: 'contain' maintains aspect ratio, 'fill' stretches to fill both axes
    const finalScaleX = fitMode === 'contain' ? Math.min(scaleX, scaleY) : scaleX;
    const finalScaleY = fitMode === 'contain' ? Math.min(scaleX, scaleY) : scaleY;
    
    // Apply scale and center to target area
    shapes.forEach(shape => {
      // Scale relative to set center
      const relX = shape.transform.x - setCenterX;
      const relY = shape.transform.y - setCenterY;
      
      shape.transform.x = targetX + marginLeft + availableWidth / 2 + (relX * finalScaleX);
      shape.transform.y = targetY + marginTop + availableHeight / 2 + (relY * finalScaleY);
      shape.transform.scaleX *= finalScaleX;
      shape.transform.scaleY *= finalScaleY;
    });
    
    console.log(`✅ [SERVER] Fitted set to ${fitTarget} with scaleX=${finalScaleX.toFixed(2)}, scaleY=${finalScaleY.toFixed(2)}${bleedPx > 0 ? `, bleedPx=${bleedPx.toFixed(1)}` : ''}`);
  } else if (alignment.alignTo !== 'none') {
    console.log(`🎯 [SERVER] Applying alignment for set "${setName}": ${alignment.alignmentType}`);
    
    // Calculate bounding box center
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    shapes.forEach(shape => {
      const x = shape.transform.x;
      const y = shape.transform.y;
      const halfWidth = (shape.width || 50) / 2;
      const halfHeight = (shape.height || 50) / 2;
      
      minX = Math.min(minX, x - halfWidth);
      minY = Math.min(minY, y - halfHeight);
      maxX = Math.max(maxX, x + halfWidth);
      maxY = Math.max(maxY, y + halfHeight);
    });
    
    const setCenterX = (minX + maxX) / 2;
    const setCenterY = (minY + maxY) / 2;
    
    // Normalize margin to individual values
    const margin = alignment.margin || 0;
    const marginTop = typeof margin === 'number' ? margin : margin.top;
    const marginBottom = typeof margin === 'number' ? margin : margin.bottom;
    const marginLeft = typeof margin === 'number' ? margin : margin.left;
    const marginRight = typeof margin === 'number' ? margin : margin.right;
    
    // Calculate target position based on alignment type
    let targetX = artboard.x + artboard.width / 2;
    let targetY = artboard.y + artboard.height / 2;
    
    switch (alignment.alignmentType) {
      case 'top-left':
        targetX = artboard.x + marginLeft;
        targetY = artboard.y + marginTop;
        break;
      case 'top-center':
        targetX = artboard.x + artboard.width / 2;
        targetY = artboard.y + marginTop;
        break;
      case 'top-right':
        targetX = artboard.x + artboard.width - marginRight;
        targetY = artboard.y + marginTop;
        break;
      case 'center-left':
        targetX = artboard.x + marginLeft;
        targetY = artboard.y + artboard.height / 2;
        break;
      case 'center':
        targetX = artboard.x + artboard.width / 2;
        targetY = artboard.y + artboard.height / 2;
        break;
      case 'center-right':
        targetX = artboard.x + artboard.width - marginRight;
        targetY = artboard.y + artboard.height / 2;
        break;
      case 'bottom-left':
        targetX = artboard.x + marginLeft;
        targetY = artboard.y + artboard.height - marginBottom;
        break;
      case 'bottom-center':
        targetX = artboard.x + artboard.width / 2;
        targetY = artboard.y + artboard.height - marginBottom;
        break;
      case 'bottom-right':
        targetX = artboard.x + artboard.width - marginRight;
        targetY = artboard.y + artboard.height - marginBottom;
        break;
    }
    
    // Calculate offset and apply to all shapes
    const offsetX = targetX - setCenterX;
    const offsetY = targetY - setCenterY;
    
    shapes.forEach(shape => {
      shape.transform.x += offsetX;
      shape.transform.y += offsetY;
    });
    
    console.log(`✅ [SERVER] Aligned set to ${alignment.alignmentType} with offset (${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`);
  }
}

/**
 * Render a generation set's shapes to an isolated offscreen canvas
 * with shape-level blend modes applied
 * 
 * Ported from client/src/lib/offscreenRenderer.ts
 * 
 * @param set - Generation set configuration
 * @param shapes - Array of shapes to render
 * @param renderContext - Rendering context (dimensions, DPR)
 * @param artboard - Artboard settings for centering
 * @returns Offscreen canvas with rendered shapes
 */
function renderSetToOffscreenCanvas(
  set: GenerationSet,
  shapes: Shape[],
  renderContext: RenderContext,
  artboard: ArtboardSettings
): Canvas {
  const { width, height, dpr } = renderContext;
  
  // Create offscreen canvas with same dimensions as target
  const offscreenCanvas = createCanvas(width * dpr, height * dpr);
  const ctx = offscreenCanvas.getContext('2d');
  
  // Apply device pixel ratio scaling
  ctx.scale(dpr, dpr);
  
  // Center the canvas (translate to center)
  ctx.translate(width / 2, height / 2);
  
  // Sort shapes by z-index for proper layering within the set
  const sortedShapes = [...shapes].sort((a, b) => a.properties.zIndex - b.properties.zIndex);
  
  // Render each shape with its individual blend mode
  sortedShapes.forEach(shape => {
    renderShape(ctx, shape, true); // Skip selection adornments
  });
  
  return offscreenCanvas;
}

/**
 * Composite multiple generation set canvases onto a target canvas
 * with set-level compositing operations and blend modes
 * 
 * Ported from client/src/lib/offscreenRenderer.ts
 * 
 * Implements hierarchical compositing:
 * - Inner level: Shape blend modes (already applied in offscreen canvases)
 * - Outer level: Set compositing operations (applied here)
 * 
 * Composite Lock Support (Separate Buffer Approach):
 * - Locked sets render directly to final canvas (never targets of composite ops)
 * - Unlocked sets composite on separate buffer (isolated from locked content)
 * - Unlocked buffer is flushed to final canvas with source-over
 * - This protects locked pixels while allowing unlocked composite operations
 * 
 * @param targetCtx - Target canvas context to composite onto
 * @param setCanvases - Array of set canvases with their configurations
 */
function compositeSetCanvases(
  targetCtx: CanvasRenderingContext2D,
  setCanvases: Array<{ canvas: Canvas; set: GenerationSet }>
): void {
  // Sort by generation order (should already be sorted, but ensure it)
  const sortedSets = [...setCanvases].sort((a, b) => 
    a.set.generationOrder - b.set.generationOrder
  );
  
  // Check if any sets are locked
  const hasLockedSets = sortedSets.some(({ set }) => set.locks?.composite === true);
  
  // If no locked sets, use simple compositing path
  if (!hasLockedSets) {
    sortedSets.forEach(({ canvas, set }) => {
      // Skip invisible sets and hidden point-source sets
      if (set.setVisibility && !set.setVisibility.visible) return;
      if ((set as any)._serverHide) return;
      
      const effectiveOperation = (set.compositingOperation && set.compositingOperation !== 'source-over')
        ? set.compositingOperation
        : set.setBlendMode || 'source-over';
      
      targetCtx.globalCompositeOperation = effectiveOperation as GlobalCompositeOperation;
      targetCtx.drawImage(canvas, 0, 0);
      targetCtx.globalCompositeOperation = 'source-over';
    });
    return;
  }
  
  // Separate buffer approach: unlocked sets composite on separate canvas
  const unlockedBuffer = createCanvas(targetCtx.canvas.width, targetCtx.canvas.height);
  const unlockedCtx = unlockedBuffer.getContext('2d')!;
  
  // Track if we have any unlocked content to flush
  let hasUnlockedContent = false;
  
  // Render all sets in generation order
  for (const { canvas, set } of sortedSets) {
    // Skip invisible sets and hidden point-source sets
    if (set.setVisibility && !set.setVisibility.visible) continue;
    if ((set as any)._serverHide) continue;
    
    const isLocked = set.locks?.composite === true;
    
    if (isLocked) {
      // Flush any accumulated unlocked content before rendering locked set
      if (hasUnlockedContent) {
        targetCtx.globalCompositeOperation = 'source-over';
        targetCtx.drawImage(unlockedBuffer, 0, 0);
        
        // Clear unlocked buffer for next batch
        unlockedCtx.clearRect(0, 0, unlockedBuffer.width, unlockedBuffer.height);
        hasUnlockedContent = false;
      }
      
      // Render locked set directly to final canvas (protected from compositing)
      targetCtx.globalCompositeOperation = 'source-over';
      targetCtx.drawImage(canvas, 0, 0);
    } else {
      // Render unlocked set to isolated buffer (composites only with other unlocked sets)
      const effectiveOperation = (set.compositingOperation && set.compositingOperation !== 'source-over')
        ? set.compositingOperation
        : set.setBlendMode || 'source-over';
      
      unlockedCtx.globalCompositeOperation = effectiveOperation as GlobalCompositeOperation;
      unlockedCtx.drawImage(canvas, 0, 0);
      unlockedCtx.globalCompositeOperation = 'source-over';
      
      hasUnlockedContent = true;
    }
  }
  
  // Flush any remaining unlocked content
  if (hasUnlockedContent) {
    targetCtx.globalCompositeOperation = 'source-over';
    targetCtx.drawImage(unlockedBuffer, 0, 0);
  }
  
  // Reset to default
  targetCtx.globalCompositeOperation = 'source-over';
}
