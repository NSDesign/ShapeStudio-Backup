import { Shape } from './shapes';
import { GenerationSet } from '@shared/schema';

interface RenderContext {
  width: number;
  height: number;
  dpr: number;
  panX: number;
  panY: number;
  zoom: number;
}

/**
 * Renders a Generation Set's shapes to an isolated offscreen canvas
 * with shape-level blend modes applied.
 * 
 * This function creates a temporary rendering surface for a set, allowing
 * set-level compositing operations to be applied to the entire group.
 */
export function renderSetToOffscreenCanvas(
  set: GenerationSet,
  shapes: Shape[],
  renderContext: RenderContext
): HTMLCanvasElement {
  const { width, height, dpr, panX, panY, zoom } = renderContext;
  
  // Create offscreen canvas with same dimensions as target
  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = width * dpr;
  offscreenCanvas.height = height * dpr;
  
  const ctx = offscreenCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D context from offscreen canvas');
  }
  
  // Apply device pixel ratio scaling (matches main canvas init)
  ctx.scale(dpr, dpr);
  
  // Center the canvas (matches main canvas render loop)
  ctx.translate(width / 2, height / 2);
  
  // Apply zoom and pan transforms (matches main canvas render loop)
  ctx.scale(zoom, zoom);
  ctx.translate(panX, panY);
  
  // Sort shapes by z-index for proper layering within the set
  const sortedShapes = [...shapes].sort((a, b) => a.properties.zIndex - b.properties.zIndex);
  
  // Render each shape with its individual blend mode
  // Skip selection adornments to prevent them from being included in compositing operations
  sortedShapes.forEach(shape => {
    shape.render(ctx, true);
  });
  
  return offscreenCanvas;
}

/**
 * Composites multiple Generation Set canvases onto a target canvas
 * with set-level compositing operations and blend modes.
 * 
 * This function implements the hierarchical compositing system:
 * - Inner level: Shape blend modes (already applied in offscreen canvases)
 * - Outer level: Set compositing operations (applied here)
 * 
 * Composite Lock Support (Separate Buffer Approach):
 * - Locked sets render directly to final canvas (never targets of composite ops)
 * - Unlocked sets composite on separate buffer (isolated from locked content)
 * - Unlocked buffer is flushed to final canvas with source-over
 * - This protects locked pixels while allowing unlocked composite operations
 */
export function compositeSetCanvases(
  targetCtx: CanvasRenderingContext2D,
  setCanvases: Array<{
    canvas: HTMLCanvasElement;
    set: GenerationSet;
  }>
) {
  // Sort by generation order
  const sortedSets = [...setCanvases].sort((a, b) => 
    a.set.generationOrder - b.set.generationOrder
  );
  
  // Check if any sets are locked
  const hasLockedSets = sortedSets.some(({ set }) => set.locks?.composite === true);
  
  // If no locked sets, use simple compositing path
  if (!hasLockedSets) {
    sortedSets.forEach(({ canvas, set }) => {
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
  const unlockedBuffer = document.createElement('canvas');
  unlockedBuffer.width = targetCtx.canvas.width;
  unlockedBuffer.height = targetCtx.canvas.height;
  const unlockedCtx = unlockedBuffer.getContext('2d')!;
  
  // Track if we have any unlocked content to flush
  let hasUnlockedContent = false;
  
  // Render all sets in generation order
  for (const { canvas, set } of sortedSets) {
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
