import React, { useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NumericInput } from '@/components/ui/numeric-input';
import { MousePointer, Hand, ZoomIn, ZoomOut, RotateCcw, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Shape, ShapeGroupClass } from '@/lib/shapes';
import { CanvasSettings, Artboard } from '@/lib/shapeTypes';
import { GenerationSet, BatchConfigSettings, DEFAULT_PRINT_CONFIG, PrintUnitType, OverlayManagerState, PointPropertyConfig, DEFAULT_CTP_TARGET_CONFIG, CtpPropertyOverride } from '@shared/schema';
import { harvestDestinationPoints, computeCtpLabelVal, getPropertyValue } from '@shared/copyToPointsUtils';
import { renderSetToOffscreenCanvas, compositeSetCanvases } from '@/lib/offscreenRenderer';
import { getArtboardDisplayDimensions } from '@/lib/artboardUtils';

/** Abbreviation shown in CTP point labels for each property key */
const CTP_PROP_ABBREV: Record<string, string> = {
  posX: 'X', posY: 'Y',
  scaleX: 'sX', scaleY: 'sY', uniformScale: 'sc',
  skewX: 'skX', skewY: 'skY',
  rotation: 'rot',
  fillOpacity: 'op',
  fillR: 'R', fillG: 'G', fillB: 'B',
};

function convertPrintUnitToPixels(value: number, unit: PrintUnitType, dpi: number): number {
  switch (unit) {
    case 'pixels':
      return value;
    case 'mm':
      return (value / 25.4) * dpi;
    case 'cm':
      return (value / 2.54) * dpi;
    case 'inches':
      return value * dpi;
    default:
      return value;
  }
}


interface CanvasProps {
  shapes: Shape[];
  groups: ShapeGroupClass[];
  canvasSettings: CanvasSettings;
  artboards: Artboard[];
  activeArtboard: string;
  selectedCount: number;
  editMode: 'shapes' | 'points' | 'segments';
  selectedPoints: { shapeId: string; pointIndex: number }[];
  selectedSegments: { shapeId: string; segmentIndex: number }[];
  isMultiSelectMode: boolean;
  isPanMode: boolean;
  showSelectedCount: boolean;
  marqueeStart: { x: number; y: number } | null;
  marqueeEnd: { x: number; y: number } | null;
  isMarqueeSelecting: boolean;
  isTouchDevice: boolean;
  isMultiTouch: boolean;
  selectedShapes: Shape[];
  selectedGroups: ShapeGroupClass[];
  generationSets?: GenerationSet[];
  liveSetBatchConfig?: BatchConfigSettings;
  currentSetId?: string;
  overlayManagerState?: OverlayManagerState;
  showCubicDebugOverlay?: boolean;
  showBezierDebugOverlay?: boolean;
  showSmoothSplineDebugOverlay?: boolean;
  onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onTouchStart: (e: React.TouchEvent<HTMLCanvasElement>) => void;
  onTouchMove: (e: React.TouchEvent<HTMLCanvasElement>) => void;
  onTouchEnd: (e: React.TouchEvent<HTMLCanvasElement>) => void;
  onWheel: (e: WheelEvent) => void;
  onToggleMultiSelect: () => void;
  onTogglePanMode: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomChange: (zoomPercentage: number) => void;
  onResetView: () => void;
  onFitToArtboard: () => void;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

function renderGroupTransformHandles(ctx: CanvasRenderingContext2D, group: ShapeGroupClass, zoom: number) {
  // Simplified group handle rendering
  const bounds = group.getBounds();
  if (!bounds) return;
  
  ctx.strokeStyle = '#00ff00';
  ctx.lineWidth = 2 / zoom;
  ctx.setLineDash([5 / zoom, 5 / zoom]);
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.setLineDash([]);
}

export default function Canvas({
  shapes,
  groups,
  canvasSettings,
  artboards,
  activeArtboard,
  selectedCount,
  editMode,
  selectedPoints,
  selectedSegments,
  isMultiSelectMode,
  isPanMode,
  showSelectedCount,
  marqueeStart,
  marqueeEnd,
  isMarqueeSelecting,
  isTouchDevice,
  isMultiTouch,
  selectedShapes,
  selectedGroups,
  generationSets,
  liveSetBatchConfig,
  currentSetId,
  overlayManagerState,
  showCubicDebugOverlay,
  showBezierDebugOverlay,
  showSmoothSplineDebugOverlay,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onWheel,
  onToggleMultiSelect,
  onTogglePanMode,
  onZoomIn,
  onZoomOut,
  onZoomChange,
  onResetView,
  onFitToArtboard,
  canvasRef,
}: CanvasProps) {
  const animationFrameRef = useRef<number>();
  const infiniteCanvasRef = useRef<HTMLCanvasElement>(null);
  const artboardCanvasRef = useRef<HTMLCanvasElement>(null);
  const printMarksCanvasRef = useRef<HTMLCanvasElement>(null);
  const artboardLabelsCanvasRef = useRef<HTMLCanvasElement>(null);
  const debugGridCanvasRef = useRef<HTMLCanvasElement>(null);
  const ctpPointLabelsCanvasRef = useRef<HTMLCanvasElement>(null);
  const dirtyRef = useRef<boolean>(true); // Track if canvas needs re-render
  const shapesDirtyRef = useRef<boolean>(true); // Track if shapes need re-render (expensive)
  const shapesCanvasRef = useRef<HTMLCanvasElement | null>(null); // Cached shapes rendering
  const isAnimatingRef = useRef<boolean>(false); // Track if animation loop is active

  // Set canvas size to match container with proper pixel density for all three layers
  useEffect(() => {
    let resizeTimeoutId: number;
    
    const resizeCanvas = () => {
      const canvases = [infiniteCanvasRef.current, artboardCanvasRef.current, canvasRef.current, printMarksCanvasRef.current, artboardLabelsCanvasRef.current, debugGridCanvasRef.current, ctpPointLabelsCanvasRef.current];
      const canvas = canvasRef.current;
      
      if (canvas) {
        const container = canvas.parentElement;
        if (container) {
          const rect = container.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          
          // Apply same sizing to all three canvas layers
          canvases.forEach(c => {
            if (c) {
              // Set actual canvas size in memory (accounting for device pixel ratio)
              c.width = rect.width * dpr;
              c.height = rect.height * dpr;
              
              // Set display size via CSS
              c.style.width = rect.width + 'px';
              c.style.height = rect.height + 'px';
              
              // Scale the drawing context so everything draws at the correct size
              const ctx = c.getContext('2d');
              if (ctx) {
                ctx.scale(dpr, dpr);
              }
            }
          });
        }
      }
    };

    const debouncedResizeCanvas = () => {
      clearTimeout(resizeTimeoutId);
      resizeTimeoutId = window.setTimeout(() => {
        requestAnimationFrame(() => {
          resizeCanvas();
          dirtyRef.current = true; // Mark as dirty after resize
          shapesDirtyRef.current = true; // Need to re-render shapes after resize
        });
      }, 16); // ~60fps debouncing
    };

    resizeCanvas();
    dirtyRef.current = true; // Mark as dirty on mount
    shapesDirtyRef.current = true; // Also need to re-render shapes on mount
    
    const resizeObserver = new ResizeObserver(debouncedResizeCanvas);
    if (canvasRef.current?.parentElement) {
      resizeObserver.observe(canvasRef.current.parentElement);
    }

    window.addEventListener('resize', debouncedResizeCanvas);
    
    return () => {
      clearTimeout(resizeTimeoutId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', debouncedResizeCanvas);
    };
  }, []);

  // Main render loop - three separate layers
  useEffect(() => {
    // Layer 1: Infinite Canvas (background + grid)
    const renderInfiniteCanvas = () => {
      const canvas = infiniteCanvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Clear and fill background
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = canvasSettings.backgroundColor || '#1e293b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Temporarily force zoom to 1.0 if invalid
      let effectiveZoom = canvasSettings.zoom;
      let effectivePanX = canvasSettings.panX;
      let effectivePanY = canvasSettings.panY;
      
      if (effectiveZoom < 0.05) {
        effectiveZoom = 1.0;
        effectivePanX = 0;
        effectivePanY = 0;
      }

      // Apply transformations
      ctx.save();
      
      const displayWidth = canvas.clientWidth;
      const displayHeight = canvas.clientHeight;
      
      ctx.translate(displayWidth / 2, displayHeight / 2);
      ctx.scale(effectiveZoom, effectiveZoom);
      ctx.translate(effectivePanX, effectivePanY);

      // Draw infinite canvas grid
      if (canvasSettings.showGrid) {
        const gridSize = 20;
        const adjustedGridSize = gridSize / effectiveZoom;
        
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 0.5 / effectiveZoom;
        ctx.globalAlpha = 0.3;

        const viewWidth = displayWidth / effectiveZoom;
        const viewHeight = displayHeight / effectiveZoom;
        const startX = Math.floor((-effectivePanX - viewWidth / 2) / adjustedGridSize) * adjustedGridSize;
        const endX = Math.ceil((-effectivePanX + viewWidth / 2) / adjustedGridSize) * adjustedGridSize;
        const startY = Math.floor((-effectivePanY - viewHeight / 2) / adjustedGridSize) * adjustedGridSize;
        const endY = Math.ceil((-effectivePanY + viewHeight / 2) / adjustedGridSize) * adjustedGridSize;

        ctx.beginPath();
        for (let x = startX; x <= endX; x += adjustedGridSize) {
          ctx.moveTo(x, startY);
          ctx.lineTo(x, endY);
        }
        for (let y = startY; y <= endY; y += adjustedGridSize) {
          ctx.moveTo(startX, y);
          ctx.lineTo(endX, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    };

    // Layer 2: Artboard (background + grid + border)
    const renderArtboard = () => {
      const canvas = artboardCanvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Clear canvas (transparent)
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let effectiveZoom = canvasSettings.zoom;
      let effectivePanX = canvasSettings.panX;
      let effectivePanY = canvasSettings.panY;
      
      if (effectiveZoom < 0.05) {
        effectiveZoom = 1.0;
        effectivePanX = 0;
        effectivePanY = 0;
      }

      ctx.save();
      
      const displayWidth = canvas.clientWidth;
      const displayHeight = canvas.clientHeight;
      
      ctx.translate(displayWidth / 2, displayHeight / 2);
      ctx.scale(effectiveZoom, effectiveZoom);
      ctx.translate(effectivePanX, effectivePanY);

      // Draw active artboard
      const currentArtboard = artboards.find(a => a.id === activeArtboard);
      if (currentArtboard) {
        // Draw artboard background
        ctx.fillStyle = currentArtboard.backgroundColor || '#ffffff';
        ctx.fillRect(currentArtboard.x, currentArtboard.y, currentArtboard.width, currentArtboard.height);
        
        // Draw artboard grid if enabled
        if (currentArtboard.displayGrid !== false) {
          const gridSize = 50;
          const adjustedGridSize = gridSize / effectiveZoom;
          
          ctx.strokeStyle = currentArtboard.gridColor || '#cccccc';
          ctx.lineWidth = 0.5 / effectiveZoom;
          ctx.globalAlpha = 0.3;
          
          ctx.beginPath();
          for (let x = currentArtboard.x; x <= currentArtboard.x + currentArtboard.width; x += adjustedGridSize) {
            ctx.moveTo(x, currentArtboard.y);
            ctx.lineTo(x, currentArtboard.y + currentArtboard.height);
          }
          for (let y = currentArtboard.y; y <= currentArtboard.y + currentArtboard.height; y += adjustedGridSize) {
            ctx.moveTo(currentArtboard.x, y);
            ctx.lineTo(currentArtboard.x + currentArtboard.width, y);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        
      }

      ctx.restore();
    };

    // Layer 4: Print Marks Overlay (dedicated canvas above shapes, no pointer events)
    const renderPrintMarks = () => {
      const pmCanvas = printMarksCanvasRef.current;
      if (!pmCanvas) return;

      const ctx = pmCanvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, pmCanvas.width, pmCanvas.height);

      if (overlayManagerState?.allVisible === false) return;
      if (overlayManagerState?.printMarksVisible === false) return;

      const currentArtboard = artboards.find(a => a.id === activeArtboard);
      if (!currentArtboard) return;

      let effectiveZoom = canvasSettings.zoom;
      let effectivePanX = canvasSettings.panX;
      let effectivePanY = canvasSettings.panY;
      if (effectiveZoom < 0.05) { effectiveZoom = 1.0; effectivePanX = 0; effectivePanY = 0; }

      ctx.save();
      const displayWidth = pmCanvas.clientWidth;
      const displayHeight = pmCanvas.clientHeight;
      ctx.translate(displayWidth / 2, displayHeight / 2);
      ctx.scale(effectiveZoom, effectiveZoom);
      ctx.translate(effectivePanX, effectivePanY);

      const printConfig = currentArtboard.printConfig || DEFAULT_PRINT_CONFIG;
      const artboardDpi = currentArtboard.dpi ?? 72;
      const overlayUnit = printConfig.overlays.overlayUnit || 'pixels';
      const unitLabel = overlayUnit === 'pixels' ? 'px' : overlayUnit;

      // Bleed Overlay
      if (printConfig.overlays.bleed.display && printConfig.overlays.bleed.amount > 0) {
        const bleedPx = convertPrintUnitToPixels(printConfig.overlays.bleed.amount, overlayUnit, artboardDpi);
        const bleedColor = printConfig.overlays.bleed.color || '#00FFFF';
        ctx.strokeStyle = bleedColor;
        ctx.lineWidth = 1.5 / effectiveZoom;
        ctx.setLineDash([]);
        ctx.strokeRect(
          currentArtboard.x - bleedPx, currentArtboard.y - bleedPx,
          currentArtboard.width + bleedPx * 2, currentArtboard.height + bleedPx * 2
        );
        const labelFontSize = 10 / effectiveZoom;
        ctx.fillStyle = bleedColor;
        ctx.font = `${labelFontSize}px Arial`;
        ctx.fillText(`Bleed: ${printConfig.overlays.bleed.amount}${unitLabel}`,
          currentArtboard.x - bleedPx, currentArtboard.y - bleedPx - 4 / effectiveZoom);
      }

      // Safe Zone Overlay
      if (printConfig.overlays.safeZone.display && printConfig.overlays.safeZone.amount > 0) {
        const safeZonePx = convertPrintUnitToPixels(printConfig.overlays.safeZone.amount, overlayUnit, artboardDpi);
        const safeZoneColor = printConfig.overlays.safeZone.color || '#FF00FF';
        ctx.strokeStyle = safeZoneColor;
        ctx.lineWidth = 1.5 / effectiveZoom;
        ctx.setLineDash([]);
        ctx.strokeRect(
          currentArtboard.x + safeZonePx, currentArtboard.y + safeZonePx,
          currentArtboard.width - safeZonePx * 2, currentArtboard.height - safeZonePx * 2
        );
        const labelFontSize = 10 / effectiveZoom;
        ctx.fillStyle = safeZoneColor;
        ctx.font = `${labelFontSize}px Arial`;
        ctx.fillText(`Safe Zone: ${printConfig.overlays.safeZone.amount}${unitLabel}`,
          currentArtboard.x + safeZonePx, currentArtboard.y + safeZonePx + labelFontSize + 2 / effectiveZoom);
      }

      // Print Marks (crop marks + registration marks)
      if (printConfig.overlays.printMarks.display) {
        const bleedPx = printConfig.overlays.bleed.amount > 0
          ? convertPrintUnitToPixels(printConfig.overlays.bleed.amount, overlayUnit, artboardDpi)
          : 0;
        const scaleMode = printConfig.overlays.printMarks.scaleMode || 'none';
        const minDimension = Math.min(currentArtboard.width, currentArtboard.height);
        let markLengthPx: number;
        let markOffsetPx: number;
        if (scaleMode === 'percent') {
          markLengthPx = (printConfig.overlays.printMarks.markLength / 100) * minDimension;
          markOffsetPx = (printConfig.overlays.printMarks.markOffset / 100) * minDimension;
        } else {
          markLengthPx = convertPrintUnitToPixels(printConfig.overlays.printMarks.markLength, overlayUnit, artboardDpi);
          markOffsetPx = convertPrintUnitToPixels(printConfig.overlays.printMarks.markOffset, overlayUnit, artboardDpi);
        }
        // Use world-pixel values directly so crop marks scale with zoom the same
        // way the bleed and artboard do. A 3mm crop mark and a 3mm bleed must
        // measure the same on screen at every zoom level. (Only the stroke width
        // is divided by zoom below so the line stays 1 screen-px thick.)
        const markLength = markLengthPx;
        const markOffset = markOffsetPx;
        ctx.strokeStyle = printConfig.overlays.printMarks.color || '#000000';
        ctx.lineWidth = 1 / effectiveZoom;
        ctx.setLineDash([]);

        if (printConfig.overlays.printMarks.cropMarks) {
          const corners = [
            { x: currentArtboard.x, y: currentArtboard.y, dx: -1, dy: -1 },
            { x: currentArtboard.x + currentArtboard.width, y: currentArtboard.y, dx: 1, dy: -1 },
            { x: currentArtboard.x, y: currentArtboard.y + currentArtboard.height, dx: -1, dy: 1 },
            { x: currentArtboard.x + currentArtboard.width, y: currentArtboard.y + currentArtboard.height, dx: 1, dy: 1 }
          ];
          corners.forEach(corner => {
            const offsetX = (bleedPx + markOffset) * corner.dx;
            const offsetY = (bleedPx + markOffset) * corner.dy;
            ctx.beginPath();
            ctx.moveTo(corner.x + offsetX, corner.y);
            ctx.lineTo(corner.x + offsetX + markLength * corner.dx, corner.y);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(corner.x, corner.y + offsetY);
            ctx.lineTo(corner.x, corner.y + offsetY + markLength * corner.dy);
            ctx.stroke();
          });
        }

        if (printConfig.overlays.printMarks.registrationMarks) {
          const regMarkSize = 8 / effectiveZoom;
          const regCircleRadius = 4 / effectiveZoom;
          const edgeCenters = [
            { x: currentArtboard.x + currentArtboard.width / 2, y: currentArtboard.y - bleedPx - markOffset - regMarkSize },
            { x: currentArtboard.x + currentArtboard.width / 2, y: currentArtboard.y + currentArtboard.height + bleedPx + markOffset + regMarkSize },
            { x: currentArtboard.x - bleedPx - markOffset - regMarkSize, y: currentArtboard.y + currentArtboard.height / 2 },
            { x: currentArtboard.x + currentArtboard.width + bleedPx + markOffset + regMarkSize, y: currentArtboard.y + currentArtboard.height / 2 }
          ];
          edgeCenters.forEach(center => {
            ctx.beginPath(); ctx.moveTo(center.x - regMarkSize, center.y); ctx.lineTo(center.x + regMarkSize, center.y); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(center.x, center.y - regMarkSize); ctx.lineTo(center.x, center.y + regMarkSize); ctx.stroke();
            ctx.beginPath(); ctx.arc(center.x, center.y, regCircleRadius, 0, Math.PI * 2); ctx.stroke();
          });
        }
      }

      ctx.restore();
    };

    // Layer 5: Artboard Labels Overlay (dedicated canvas above print marks, no pointer events)
    const renderArtboardLabels = () => {
      const alCanvas = artboardLabelsCanvasRef.current;
      if (!alCanvas) return;

      const ctx = alCanvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, alCanvas.width, alCanvas.height);

      if (overlayManagerState?.allVisible === false) return;
      if (overlayManagerState?.artboardLabelsVisible === false) return;

      const currentArtboard = artboards.find(a => a.id === activeArtboard);
      if (!currentArtboard) return;

      let effectiveZoom = canvasSettings.zoom;
      let effectivePanX = canvasSettings.panX;
      let effectivePanY = canvasSettings.panY;
      if (effectiveZoom < 0.05) { effectiveZoom = 1.0; effectivePanX = 0; effectivePanY = 0; }

      ctx.save();
      const displayWidth = alCanvas.clientWidth;
      const displayHeight = alCanvas.clientHeight;
      ctx.translate(displayWidth / 2, displayHeight / 2);
      ctx.scale(effectiveZoom, effectiveZoom);
      ctx.translate(effectivePanX, effectivePanY);

      // Draw artboard border on this layer (Layer 5) — stripped from renderArtboard (Layer 2)
      if (currentArtboard.displayBorder !== false) {
        ctx.strokeStyle = '#0066cc';
        ctx.lineWidth = 2 / effectiveZoom;
        ctx.strokeRect(currentArtboard.x, currentArtboard.y, currentArtboard.width, currentArtboard.height);
      }

      const hasAnyInfoToDisplay =
        currentArtboard.displayName !== false ||
        currentArtboard.displayDimensions === true ||
        currentArtboard.displayResolution === true;

      const printConfig = currentArtboard.printConfig || DEFAULT_PRINT_CONFIG;
      const artboardDpi = currentArtboard.dpi ?? 72;
      const overlayUnit = printConfig.overlays.overlayUnit || 'pixels';

      if (!hasAnyInfoToDisplay) {
        ctx.restore();
        return;
      }

      const bleedPxForInfo = printConfig.overlays.bleed.display && printConfig.overlays.bleed.amount > 0
        ? convertPrintUnitToPixels(printConfig.overlays.bleed.amount, overlayUnit, artboardDpi)
        : 0;

      let printMarksGutter = 0;
      if (printConfig.overlays.printMarks.display && overlayManagerState?.printMarksVisible !== false) {
        const scaleMode = printConfig.overlays.printMarks.scaleMode || 'none';
        const minDimension = Math.min(currentArtboard.width, currentArtboard.height);
        let markLengthPxInfo: number;
        let markOffsetPxInfo: number;
        if (scaleMode === 'percent') {
          markLengthPxInfo = (printConfig.overlays.printMarks.markLength / 100) * minDimension;
          markOffsetPxInfo = (printConfig.overlays.printMarks.markOffset / 100) * minDimension;
        } else {
          markLengthPxInfo = convertPrintUnitToPixels(printConfig.overlays.printMarks.markLength, overlayUnit, artboardDpi);
          markOffsetPxInfo = convertPrintUnitToPixels(printConfig.overlays.printMarks.markOffset, overlayUnit, artboardDpi);
        }
        const regMarkSizeBase = printConfig.overlays.printMarks.registrationMarks ? 8 : 0;
        printMarksGutter = (markOffsetPxInfo + markLengthPxInfo + regMarkSizeBase) / effectiveZoom;
      }

      const topBoundary = currentArtboard.y - bleedPxForInfo - printMarksGutter;
      const fontSize = 11 / effectiveZoom;
      const lineHeight = fontSize * 1.4;
      const paddingX = 8 / effectiveZoom;
      const paddingY = 6 / effectiveZoom;
      const borderRadius = 4 / effectiveZoom;
      const containerGap = 6 / effectiveZoom;

      const infoLines: string[] = [];
      if (currentArtboard.displayName !== false)
        infoLines.push(currentArtboard.name);
      if (currentArtboard.displayDimensions === true) {
        const displayDims = getArtboardDisplayDimensions(
          currentArtboard.width, currentArtboard.height,
          currentArtboard.dpi ?? 72, currentArtboard.unitType ?? 'pixels'
        );
        infoLines.push(`${displayDims.widthFormatted} × ${displayDims.heightFormatted}`);
      }
      if (currentArtboard.displayResolution === true)
        infoLines.push(`${currentArtboard.dpi ?? 72} DPI`);

      ctx.font = `${fontSize}px Arial`;
      let maxTextWidth = 0;
      infoLines.forEach(line => {
        const w = ctx.measureText(line).width;
        if (w > maxTextWidth) maxTextWidth = w;
      });

      const containerWidth = maxTextWidth + paddingX * 2;
      const containerHeight = infoLines.length * lineHeight + paddingY * 2 - (lineHeight - fontSize);
      const containerX = currentArtboard.x + currentArtboard.width - containerWidth;
      const containerY = topBoundary - containerHeight - containerGap;

      const bgColor = currentArtboard.backgroundColor || '#ffffff';
      const rr = parseInt(bgColor.slice(1, 3), 16);
      const gg = parseInt(bgColor.slice(3, 5), 16);
      const bb = parseInt(bgColor.slice(5, 7), 16);
      const brightness = (rr * 299 + gg * 587 + bb * 114) / 1000;
      const isLightBg = brightness > 128;
      const containerBgColor = isLightBg ? 'rgba(30, 41, 59, 0.85)' : 'rgba(241, 245, 249, 0.9)';
      const textColor = isLightBg ? '#f1f5f9' : '#1e293b';

      ctx.fillStyle = containerBgColor;
      ctx.beginPath();
      ctx.moveTo(containerX + borderRadius, containerY);
      ctx.lineTo(containerX + containerWidth - borderRadius, containerY);
      ctx.quadraticCurveTo(containerX + containerWidth, containerY, containerX + containerWidth, containerY + borderRadius);
      ctx.lineTo(containerX + containerWidth, containerY + containerHeight - borderRadius);
      ctx.quadraticCurveTo(containerX + containerWidth, containerY + containerHeight, containerX + containerWidth - borderRadius, containerY + containerHeight);
      ctx.lineTo(containerX + borderRadius, containerY + containerHeight);
      ctx.quadraticCurveTo(containerX, containerY + containerHeight, containerX, containerY + containerHeight - borderRadius);
      ctx.lineTo(containerX, containerY + borderRadius);
      ctx.quadraticCurveTo(containerX, containerY, containerX + borderRadius, containerY);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = textColor;
      ctx.font = `${fontSize}px Arial`;
      ctx.textAlign = 'right';
      let textY = containerY + paddingY + fontSize;
      infoLines.forEach(line => {
        ctx.fillText(line, containerX + containerWidth - paddingX, textY);
        textY += lineHeight;
      });
      ctx.textAlign = 'left';

      ctx.restore();
    };

    // Layer 6: Debug Grid Overlay (dedicated canvas above all, no pointer events)
    // Supports multiple sets, each with per-set color and opacity from cellConstraints
    const renderDebugGrid = () => {
      const debugCanvas = debugGridCanvasRef.current;
      if (!debugCanvas) return;

      const debugCtx = debugCanvas.getContext('2d');
      if (!debugCtx) return;

      // Always clear the debug canvas first
      debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);

      // Global visibility gates
      if (overlayManagerState?.allVisible === false) return;
      if (overlayManagerState?.debugGridVisible === false) return;

      // Find all enabled grid-distribution sets — overlayManagerState controls runtime visibility
      // (showDebugGrid only seeds the initial per-set visible flag, not used as a runtime filter)
      const activeSets = (generationSets || []).filter(set =>
        set.enabled &&
        set.batchConfig?.distributionLayoutEnabled &&
        set.batchConfig?.distributionPattern === 'grid'
      );
      if (activeSets.length === 0) return;

      const currentArtboard = artboards.find(a => a.id === activeArtboard);
      if (!currentArtboard) return;

      let effectiveZoom = canvasSettings.zoom;
      let effectivePanX = canvasSettings.panX;
      let effectivePanY = canvasSettings.panY;

      if (effectiveZoom < 0.05) {
        effectiveZoom = 1.0;
        effectivePanX = 0;
        effectivePanY = 0;
      }

      const displayWidth = debugCanvas.clientWidth;
      const displayHeight = debugCanvas.clientHeight;

      const artboardBounds = {
        x: currentArtboard.x,
        y: currentArtboard.y,
        width: currentArtboard.width,
        height: currentArtboard.height
      };

      // Helper to parse a hex/named color into rgba components
      const hexToRgb = (hex: string): [number, number, number] => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
          ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
          : [255, 0, 0];
      };

      // Sort active sets by overlay order if defined
      const sortedActiveSets = [...activeSets].sort((a, b) => {
        const orderA = overlayManagerState?.debugGrid?.sets[a.id]?.order ?? 0;
        const orderB = overlayManagerState?.debugGrid?.sets[b.id]?.order ?? 0;
        return orderA - orderB;
      });

      sortedActiveSets.forEach((activeSet, setIndex) => {
        // Check per-set visibility from overlayManagerState
        const perSetEntry = overlayManagerState?.debugGrid?.sets[activeSet.id];
        if (perSetEntry && perSetEntry.visible === false) return;

        const batchConfig = (liveSetBatchConfig && currentSetId && activeSet.id === currentSetId)
          ? liveSetBatchConfig
          : activeSet.batchConfig!;
        const cellConstraints = batchConfig.cellConstraints!;

        // Per-set color/opacity: overlayManagerState is authoritative; palette fallback for uninitialized sets
        const DEBUG_PALETTE = ['#FF4444', '#44AAFF', '#44FF88', '#FFAA00', '#CC44FF'];
        const rawColor = perSetEntry?.color || cellConstraints.debugGridColor || DEBUG_PALETTE[setIndex % DEBUG_PALETTE.length];
        const opacity = perSetEntry?.opacity ?? cellConstraints.debugGridOpacity ?? 0.4;
        const [r, g, b] = hexToRgb(rawColor);
        const lineColor = `rgba(${r}, ${g}, ${b}, ${0.4 * opacity})`;
        const cellColor = `rgba(${r}, ${g}, ${b}, ${0.3 * opacity})`;
        const markerColor = `rgba(0, 200, 0, ${0.8 * opacity})`;
        const dotColor = `rgba(${r}, ${g}, ${b}, ${0.8 * opacity})`;
        const labelColor = `rgba(${r}, ${g}, ${b}, ${0.9 * opacity})`;

        debugCtx.save();
        debugCtx.translate(displayWidth / 2, displayHeight / 2);
        debugCtx.scale(effectiveZoom, effectiveZoom);
        debugCtx.translate(effectivePanX, effectivePanY);

        const rows = batchConfig.gridRows;
        const columns = batchConfig.gridColumns;
        const isCellCenterMode = cellConstraints.renderMode === 'cell-center';
        const isCellCornersMode = cellConstraints.renderMode === 'cell-corners';

        // ── Step 1: Apply margin to get effective bounds (mirrors applyGridDistribution) ──
        let eb = { ...artboardBounds };
        if (batchConfig.gridMarginEnabled) {
          const mUnit = batchConfig.gridMarginUnit ?? 'px';
          const mT = mUnit === '%' ? (batchConfig.gridMarginTop    ?? 0) / 100 * artboardBounds.height : (batchConfig.gridMarginTop    ?? 0);
          const mR = mUnit === '%' ? (batchConfig.gridMarginRight  ?? 0) / 100 * artboardBounds.width  : (batchConfig.gridMarginRight  ?? 0);
          const mB = mUnit === '%' ? (batchConfig.gridMarginBottom ?? 0) / 100 * artboardBounds.height : (batchConfig.gridMarginBottom ?? 0);
          const mL = mUnit === '%' ? (batchConfig.gridMarginLeft   ?? 0) / 100 * artboardBounds.width  : (batchConfig.gridMarginLeft   ?? 0);
          eb = {
            x: artboardBounds.x + mL,
            y: artboardBounds.y + mT,
            width:  Math.max(1, artboardBounds.width  - mL - mR),
            height: Math.max(1, artboardBounds.height - mT - mB),
          };
          // Shade the margin bands
          debugCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.09 * opacity})`;
          debugCtx.fillRect(artboardBounds.x, artboardBounds.y, artboardBounds.width, mT);
          debugCtx.fillRect(artboardBounds.x, eb.y + eb.height, artboardBounds.width, mB);
          debugCtx.fillRect(artboardBounds.x, eb.y, mL, eb.height);
          debugCtx.fillRect(eb.x + eb.width, eb.y, mR, eb.height);
          // Dashed border around effective area
          debugCtx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.7 * opacity})`;
          debugCtx.lineWidth = 1.5 / effectiveZoom;
          debugCtx.setLineDash([6 / effectiveZoom, 3 / effectiveZoom]);
          debugCtx.strokeRect(eb.x, eb.y, eb.width, eb.height);
          debugCtx.setLineDash([]);
        }

        // ── Step 2: Gutters (mirrors applyGridDistribution) ───────────────────
        const gutterX = (batchConfig.gridGutterEnabled && batchConfig.gridGutterX) ? batchConfig.gridGutterX : 0;
        const gutterY = (batchConfig.gridGutterEnabled && batchConfig.gridGutterY) ? batchConfig.gridGutterY : 0;

        // Cell size after subtracting total gutter space
        const cellWidth  = (eb.width  - gutterX * (columns - 1)) / columns;
        const cellHeight = (eb.height - gutterY * (rows    - 1)) / rows;

        // Shade gutter strips between columns and rows
        if (gutterX > 0) {
          debugCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.13 * opacity})`;
          for (let col = 0; col < columns - 1; col++) {
            debugCtx.fillRect(eb.x + (col + 1) * cellWidth + col * gutterX, eb.y, gutterX, eb.height);
          }
        }
        if (gutterY > 0) {
          debugCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.13 * opacity})`;
          for (let row = 0; row < rows - 1; row++) {
            debugCtx.fillRect(eb.x, eb.y + (row + 1) * cellHeight + row * gutterY, eb.width, gutterY);
          }
        }

        // Helper: canvas origin of a given cell
        const cellX = (col: number) => eb.x + col * (cellWidth  + gutterX);
        const cellY = (row: number) => eb.y + row * (cellHeight + gutterY);

        const effectiveRows = isCellCornersMode ? rows + 1 : rows;
        const effectiveCols = isCellCornersMode ? columns + 1 : columns;

        // ── Step 3: Cell boundary lines ───────────────────────────────────────
        debugCtx.strokeStyle = lineColor;
        debugCtx.lineWidth = 1 / effectiveZoom;
        debugCtx.setLineDash([]);

        for (let col = 0; col < columns; col++) {
          const cx = cellX(col);
          debugCtx.beginPath(); debugCtx.moveTo(cx, eb.y); debugCtx.lineTo(cx, eb.y + eb.height); debugCtx.stroke();
          if (col === columns - 1) {
            debugCtx.beginPath(); debugCtx.moveTo(cx + cellWidth, eb.y); debugCtx.lineTo(cx + cellWidth, eb.y + eb.height); debugCtx.stroke();
          }
        }
        for (let row = 0; row < rows; row++) {
          const cy = cellY(row);
          debugCtx.beginPath(); debugCtx.moveTo(eb.x, cy); debugCtx.lineTo(eb.x + eb.width, cy); debugCtx.stroke();
          if (row === rows - 1) {
            debugCtx.beginPath(); debugCtx.moveTo(eb.x, cy + cellHeight); debugCtx.lineTo(eb.x + eb.width, cy + cellHeight); debugCtx.stroke();
          }
        }

        // ── Step 4: Dashed cell outlines ──────────────────────────────────────
        debugCtx.strokeStyle = cellColor;
        debugCtx.lineWidth = 2 / effectiveZoom;
        debugCtx.setLineDash([4 / effectiveZoom, 4 / effectiveZoom]);

        if (isCellCenterMode) {
          for (let row = 0; row < rows; row++) {
            for (let col = 0; col < columns; col++) {
              debugCtx.strokeRect(cellX(col), cellY(row), cellWidth, cellHeight);
            }
          }
        } else {
          const sqHalf = Math.min(cellWidth, cellHeight) * 0.15;
          for (let row = 0; row <= rows; row++) {
            for (let col = 0; col <= columns; col++) {
              const x = eb.x + col * (cellWidth + gutterX);
              const y = eb.y + row * (cellHeight + gutterY);
              debugCtx.strokeRect(x - sqHalf, y - sqHalf, sqHalf * 2, sqHalf * 2);
            }
          }
        }
        debugCtx.setLineDash([]);

        // ── Step 5: Cell padding bands (cyan) ─────────────────────────────────
        if (cellConstraints.enabled) {
          const padUnit = cellConstraints.paddingUnit ?? 'px';
          const pT2 = padUnit === '%' ? ((cellConstraints.paddingTop    ?? 0) / 100) * cellHeight : (cellConstraints.paddingTop    ?? 0);
          const pR2 = padUnit === '%' ? ((cellConstraints.paddingRight  ?? 0) / 100) * cellWidth  : (cellConstraints.paddingRight  ?? 0);
          const pB2 = padUnit === '%' ? ((cellConstraints.paddingBottom ?? 0) / 100) * cellHeight : (cellConstraints.paddingBottom ?? 0);
          const pL2 = padUnit === '%' ? ((cellConstraints.paddingLeft   ?? 0) / 100) * cellWidth  : (cellConstraints.paddingLeft   ?? 0);

          if (pT2 > 0 || pR2 > 0 || pB2 > 0 || pL2 > 0) {
            debugCtx.fillStyle   = 'rgba(6,182,212,0.10)';
            debugCtx.strokeStyle = 'rgba(6,182,212,0.75)';
            debugCtx.lineWidth   = 1.5 / effectiveZoom;
            debugCtx.setLineDash([3 / effectiveZoom, 3 / effectiveZoom]);

            const drawPadBands = (outerX: number, outerY: number, w: number, h: number) => {
              if (pT2 > 0) debugCtx.fillRect(outerX,            outerY,           w,    pT2);
              if (pB2 > 0) debugCtx.fillRect(outerX,            outerY + h - pB2, w,    pB2);
              if (pL2 > 0) debugCtx.fillRect(outerX,            outerY + pT2,     pL2,  h - pT2 - pB2);
              if (pR2 > 0) debugCtx.fillRect(outerX + w - pR2,  outerY + pT2,     pR2,  h - pT2 - pB2);
              const iW2 = w - pL2 - pR2, iH2 = h - pT2 - pB2;
              if (iW2 > 0 && iH2 > 0) debugCtx.strokeRect(outerX + pL2, outerY + pT2, iW2, iH2);
            };

            if (isCellCenterMode) {
              for (let row = 0; row < rows; row++) {
                for (let col = 0; col < columns; col++) {
                  drawPadBands(cellX(col), cellY(row), cellWidth, cellHeight);
                }
              }
            } else {
              for (let row = 0; row <= rows; row++) {
                for (let col = 0; col <= columns; col++) {
                  drawPadBands(eb.x + col * (cellWidth + gutterX) - cellWidth / 2, eb.y + row * (cellHeight + gutterY) - cellHeight / 2, cellWidth, cellHeight);
                }
              }
            }
            debugCtx.setLineDash([]);
          }
        }

        // ── Step 6: Shape-position markers ────────────────────────────────────
        const markerSize = 6 / effectiveZoom;

        for (let row = 0; row < effectiveRows; row++) {
          for (let col = 0; col < effectiveCols; col++) {
            const x = isCellCenterMode
              ? cellX(col) + cellWidth  / 2
              : eb.x + col * (cellWidth  + gutterX);
            const y = isCellCenterMode
              ? cellY(row) + cellHeight / 2
              : eb.y + row * (cellHeight + gutterY);

            debugCtx.strokeStyle = markerColor;
            debugCtx.lineWidth = 2 / effectiveZoom;
            debugCtx.beginPath();
            debugCtx.moveTo(x - markerSize, y);
            debugCtx.lineTo(x + markerSize, y);
            debugCtx.moveTo(x, y - markerSize);
            debugCtx.lineTo(x, y + markerSize);
            debugCtx.stroke();

            if (isCellCornersMode) {
              debugCtx.fillStyle = dotColor;
              debugCtx.beginPath();
              debugCtx.arc(x, y, markerSize / 3, 0, Math.PI * 2);
              debugCtx.fill();
            }
          }
        }

        debugCtx.restore();
      });
    };

    // Layer 7: CTP Point Labels — renders computed property values at each destination point
    const renderCtpPointLabels = () => {
      const labelsCanvas = ctpPointLabelsCanvasRef.current;
      if (!labelsCanvas) return;
      const ctx = labelsCanvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, labelsCanvas.width, labelsCanvas.height);

      if (overlayManagerState?.allVisible === false) return;
      if ((overlayManagerState?.ctpPointLabelsVisible ?? true) === false) return;
      if (!generationSets || shapes.length === 0) return;

      // Helper: return the effective batchConfig for a set, merging live edits
      // for the currently-selected set so eligibility and values reflect the
      // sidebar in real time (before Apply / persist).
      const effectiveBatchConfig = (set: GenerationSet) => {
        if (liveSetBatchConfig && currentSetId && set.id === currentSetId) {
          return { ...set.batchConfig, ...liveSetBatchConfig } as typeof set.batchConfig;
        }
        return set.batchConfig;
      };

      // Find destination sets that have at least one enabled point property.
      // Visibility of each property is controlled exclusively by the Overlay Manager.
      const destSets = generationSets.filter(set => {
        if (!set.enabled) return false;
        const cfg = effectiveBatchConfig(set);
        if (!cfg?.copyToPointsTargetEnabled) return false;
        return (cfg.copyToPointsTargetConfig?.pointProperties ?? []).some(
          (p: PointPropertyConfig) => p.enabled
        );
      });
      if (destSets.length === 0) return;

      let effectiveZoom = canvasSettings.zoom;
      let effectivePanX = canvasSettings.panX;
      let effectivePanY = canvasSettings.panY;
      if (effectiveZoom < 0.05) { effectiveZoom = 1.0; effectivePanX = 0; effectivePanY = 0; }

      ctx.save();
      const displayWidth = labelsCanvas.clientWidth;
      const displayHeight = labelsCanvas.clientHeight;
      ctx.translate(displayWidth / 2, displayHeight / 2);
      ctx.scale(effectiveZoom, effectiveZoom);
      ctx.translate(effectivePanX, effectivePanY);

      const defaultFontSize = 10;

      destSets.forEach(destSet => {
        // Full merged config for this destination set (live-aware)
        const mergedBatchCfg = effectiveBatchConfig(destSet);
        const savedTarget = destSet.batchConfig?.copyToPointsTargetConfig ?? DEFAULT_CTP_TARGET_CONFIG;
        const targetConfig = mergedBatchCfg?.copyToPointsTargetConfig
          ? { ...savedTarget, ...mergedBatchCfg.copyToPointsTargetConfig }
          : savedTarget;

        // All enabled props are candidates; per-shape-type visibility is checked per-point below.
        const propsToShow = (targetConfig.pointProperties ?? []).filter(
          (p: PointPropertyConfig) => p.enabled
        );
        if (propsToShow.length === 0) return;

        // Get destination shapes for this set
        const destSetIdx = destSet.generationOrder;
        const destShapes = shapes.filter(s => Math.floor(s.properties.zIndex / 1000) === destSetIdx);
        if (destShapes.length === 0) return;

        const harvestedPoints = harvestDestinationPoints(destShapes, {
          includeVertices: targetConfig.includeVertices ?? true,
          includeCentroid: targetConfig.includeCentroid ?? false,
          vertexSampleStride: targetConfig.vertexSampleStride ?? 1,
          resampleOutline: targetConfig.resampleOutline ?? false,
          resampleCount: targetConfig.resampleCount ?? 20,
        });
        if (harvestedPoints.length === 0) return;

        const totalPoints = harvestedPoints.length;

        // Find the source set that copies to this destination set.
        // Use the live-merged config so sidebar edits to copyMode/overflowMode
        // are reflected immediately in which source shape maps to each point.
        const sourceSet = generationSets.find(s => {
          if (!s.enabled) return false;
          const cfg = effectiveBatchConfig(s);
          return cfg?.copyToPointsEnabled &&
            cfg?.copyToPointsConfig?.destinationSetId === destSet.id;
        });
        const srcSetShapes = sourceSet
          ? shapes.filter(s => Math.floor(s.properties.zIndex / 1000) === sourceSet.generationOrder)
          : [];

        // Build the same point→source-shape mapping that applyCopyToPointsDistribution uses,
        // reading copyMode/overflowMode from the live-merged source config.
        const srcLiveCfg = sourceSet ? effectiveBatchConfig(sourceSet) : null;
        const copyMode = srcLiveCfg?.copyToPointsConfig?.copyMode ?? 'shape-copy';
        const overflowMode = srcLiveCfg?.copyToPointsConfig?.overflowMode ?? 'wrap';

        const getSrcShape = (ptIdx: number): any | null => {
          if (srcSetShapes.length === 0) return null;
          if (copyMode === 'set-copy') {
            // In set-copy, output order is [pt0_src0…pt0_srcN, pt1_src0…pt1_srcN, …].
            // Pick the first shape placed at this destination point as the representative.
            const shapesPerPoint = Math.round(srcSetShapes.length / totalPoints);
            const repIdx = ptIdx * (shapesPerPoint || 1);
            return srcSetShapes[Math.min(repIdx, srcSetShapes.length - 1)] ?? null;
          }
          // shape-copy
          let srcIdx: number;
          if (overflowMode === 'clamp') {
            if (ptIdx >= srcSetShapes.length) return null;
            srcIdx = ptIdx;
          } else if (overflowMode === 'distribute-evenly') {
            srcIdx = srcSetShapes.length === 1
              ? 0
              : Math.round((ptIdx / Math.max(totalPoints - 1, 1)) * (srcSetShapes.length - 1));
          } else {
            // wrap (default)
            srcIdx = ptIdx % srcSetShapes.length;
          }
          return srcSetShapes[srcIdx] ?? null;
        };

        // Helper: resolve overlay override for a specific shape type + prop.
        // Type-specific key takes precedence; falls back to the 'all' bucket.
        const resolveOv = (shapeType: string, propKey: string): CtpPropertyOverride | undefined => {
          const ctpProps = overlayManagerState?.ctpProperties;
          return ctpProps?.[`${destSet.id}:${shapeType}:${propKey}`]
            ?? ctpProps?.[`${destSet.id}:all:${propKey}`];
        };

        harvestedPoints.forEach((pt, globalIdx) => {
          const srcShape = getSrcShape(globalIdx);
          const shapeType: string = (srcShape as any)?.type ?? 'unknown';

          // Filter to props visible for this shape type's overlay settings.
          const visibleProps = propsToShow.filter((prop: PointPropertyConfig) => {
            const ov = resolveOv(shapeType, prop.key);
            return ov?.visible !== false;
          });
          if (visibleProps.length === 0) return;

          // Pre-compute per-prop font sizes for this shape's visible props.
          const propFontSizes = visibleProps.map((prop: PointPropertyConfig) => {
            const ov = resolveOv(shapeType, prop.key);
            const sz = ov?.size ?? prop.labelFontSize ?? defaultFontSize;
            return sz / effectiveZoom;
          });
          const totalH = propFontSizes.reduce((sum, fs) => sum + fs * 1.35, 0);
          let yOff = -totalH / 2 - 2 / effectiveZoom;

          visibleProps.forEach((prop: PointPropertyConfig, pIdx: number) => {
            const useLocal = (prop.evaluatePoints ?? 'all-points') === 'points-per-shape';
            const ptIdx = useLocal ? pt.shapeLocalIndex : globalIdx;
            const total = useLocal ? pt.shapeLocalTotal : totalPoints;

            // Prefer the actual value already written onto the placed shape.
            // Fall back to computeCtpLabelVal (midpoint approximation) only when
            // no placed shape is available (no source set, clamp overflow, pre-generation).
            const placedVal = srcShape != null
              ? getPropertyValue(srcShape, prop.key as any, prop)
              : undefined;
            const isExact = placedVal !== undefined;
            const val = isExact
              ? placedVal!
              : computeCtpLabelVal(prop, ptIdx, total, undefined);

            const abbrev = CTP_PROP_ABBREV[prop.key] ?? prop.key;
            const isApprox = !isExact && (prop.mode === 'random-range' || prop.amountMode === 'range');
            const label = isApprox ? `${abbrev}~${val.toFixed(2)}` : `${abbrev}:${val.toFixed(2)}`;

            const fontSize = propFontSizes[pIdx];
            const lineH = fontSize * 1.35;

            ctx.font = `bold ${fontSize}px Arial`;
            ctx.textAlign = 'center';
            const lw = 2.5 / effectiveZoom;

            // Dark outline for contrast
            ctx.strokeStyle = 'rgba(0,0,0,0.8)';
            ctx.lineWidth = lw;
            ctx.lineJoin = 'round';
            ctx.strokeText(label, pt.x, pt.y + yOff);

            // Overlay state is authoritative; fall back to per-property config, then cyan/amber
            const defaultColor = isApprox ? '#f59e0b' : '#22d3ee';
            const propOv = resolveOv(shapeType, prop.key);
            ctx.fillStyle = propOv?.color ?? prop.labelColor ?? defaultColor;
            ctx.fillText(label, pt.x, pt.y + yOff);

            yOff += lineH;
          });
          ctx.textAlign = 'left';
        });
      });

      ctx.restore();
    };

    // Layer 3: Shapes (transparent background, compositing happens here)
    const renderShapes = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Clear canvas (transparent background)
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let effectiveZoom = canvasSettings.zoom;
      let effectivePanX = canvasSettings.panX;
      let effectivePanY = canvasSettings.panY;
      
      if (effectiveZoom < 0.05) {
        effectiveZoom = 1.0;
        effectivePanX = 0;
        effectivePanY = 0;
      }

      ctx.save();
      
      const displayWidth = canvas.clientWidth;
      const displayHeight = canvas.clientHeight;
      
      ctx.translate(displayWidth / 2, displayHeight / 2);
      ctx.scale(effectiveZoom, effectiveZoom);
      ctx.translate(effectivePanX, effectivePanY);

      // Check if we need set-based rendering with compositing operations
      const hasCompositingOperations = generationSets && generationSets.some(set => 
        set.enabled && ((set.compositingOperation && set.compositingOperation !== 'source-over') || 
        (set.setBlendMode && set.setBlendMode !== 'source-over'))
      );

      if (hasCompositingOperations && generationSets && shapes.length > 0) {
        // OFFSCREEN RENDERING PIPELINE: Render each set to isolated canvas, then composite
        
        // Echo z-index can fall below a set boundary; retain its originating set.
        const shapesBySet: Map<number, typeof shapes> = new Map();
        shapes.forEach(shape => {
          const setIndex = (shape as any)._generationSetOrder ?? Math.floor(shape.properties.zIndex / 1000);
          if (!shapesBySet.has(setIndex)) {
            shapesBySet.set(setIndex, []);
          }
          shapesBySet.get(setIndex)!.push(shape);
        });

        const enabledSets = generationSets
          .filter(set => set.enabled)
          .sort((a, b) => a.generationOrder - b.generationOrder);

        // Create render context for offscreen canvases
        const renderContext = {
          width: displayWidth,
          height: displayHeight,
          dpr: window.devicePixelRatio || 1,
          panX: effectivePanX,
          panY: effectivePanY,
          zoom: effectiveZoom
        };

        // Render each set to its own offscreen canvas
        const setCanvases = enabledSets.map(set => {
          const setShapes = shapesBySet.get(set.generationOrder) || [];
          if (setShapes.length === 0) return null;

          const offscreenCanvas = renderSetToOffscreenCanvas(set, setShapes, renderContext);
          return { canvas: offscreenCanvas, set };
        }).filter(Boolean) as Array<{ canvas: HTMLCanvasElement; set: GenerationSet }>;

        // Save current context state (preserving transforms applied above)
        ctx.save();
        
        // Reset to identity transform for compositing
        // The offscreen canvases already have transforms baked in
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        // Composite all set canvases onto main canvas with set-level operations
        compositeSetCanvases(ctx, setCanvases);
        
        // Restore context state (to apply transforms for UI elements below)
        ctx.restore();
      } else {
        // STANDARD RENDERING: Draw shapes in z-index order (no compositing)
        const sortedShapes = [...shapes].sort((a, b) => a.properties.zIndex - b.properties.zIndex);
        sortedShapes.forEach(shape => {
          shape.render(ctx);
        });
      }

      // Draw selection bounding boxes on top of composited result
      selectedShapes.forEach(shape => {
        ctx.save();
        
        // Calculate total scale factor (canvas zoom × shape scale)
        // This ensures constant visual stroke width regardless of zoom or transform scaling
        const totalScaleX = effectiveZoom * Math.abs(shape.transform.scaleX);
        const totalScaleY = effectiveZoom * Math.abs(shape.transform.scaleY);
        const avgScale = (totalScaleX + totalScaleY) / 2;
        
        // Apply shape transform to position the bounding box correctly
        ctx.translate(shape.transform.x, shape.transform.y);
        ctx.rotate(shape.transform.rotation * Math.PI / 180);
        ctx.scale(shape.transform.scaleX, shape.transform.scaleY);
        ctx.transform(1, shape.transform.skewX, shape.transform.skewY, 1, 0, 0);
        
        // Draw selection bounding box with constant stroke width
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#2563EB';
        ctx.lineWidth = 2 / avgScale;
        ctx.setLineDash([5 / avgScale, 5 / avgScale]);
        
        const bounds = shape.getBounds();
        ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
        
        // Add corner indicators with constant size
        const cornerSize = 6 / avgScale;
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
        
        ctx.setLineDash([]);
        ctx.restore();
      });

      // Draw group handles
      groups.forEach(group => {
        if (selectedGroups.includes(group)) {
          renderGroupTransformHandles(ctx, group, effectiveZoom);
        }
      });

      // Draw marquee selection
      if (isMarqueeSelecting && marqueeStart && marqueeEnd) {
        const startX = Math.min(marqueeStart.x, marqueeEnd.x);
        const startY = Math.min(marqueeStart.y, marqueeEnd.y);
        const width = Math.abs(marqueeEnd.x - marqueeStart.x);
        const height = Math.abs(marqueeEnd.y - marqueeStart.y);
        
        ctx.strokeStyle = '#007bff';
        ctx.setLineDash([5 / effectiveZoom, 5 / effectiveZoom]);
        ctx.lineWidth = 1 / effectiveZoom;
        ctx.strokeRect(startX, startY, width, height);
        ctx.setLineDash([]);
      }

      // Draw edit handles
      if (editMode === 'points') {
        selectedShapes.forEach(shape => {
          if (shape.points) {
            shape.points.forEach((point, index) => {
              const isSelected = selectedPoints.some(sp => sp.shapeId === shape.id && sp.pointIndex === index);
              ctx.fillStyle = isSelected ? '#ff6b6b' : '#4dabf7';
              
              const transformedX = point.x + shape.transform.x;
              const transformedY = point.y + shape.transform.y;
              
              ctx.fillRect(
                transformedX - 4 / effectiveZoom,
                transformedY - 4 / effectiveZoom,
                8 / effectiveZoom,
                8 / effectiveZoom
              );
            });
          }
        });
      } else if (editMode === 'segments') {
        selectedShapes.forEach(shape => {
          if (shape.points && shape.points.length > 1) {
            for (let i = 0; i < shape.points.length - 1; i++) {
              const point1 = shape.points[i];
              const point2 = shape.points[i + 1];
              
              const midX = (point1.x + point2.x) / 2 + shape.transform.x;
              const midY = (point1.y + point2.y) / 2 + shape.transform.y;
              
              const isSelected = selectedSegments.some(ss => ss.shapeId === shape.id && ss.segmentIndex === i);
              ctx.fillStyle = isSelected ? '#ff6b6b' : '#51cf66';
              ctx.beginPath();
              ctx.arc(midX, midY, 4 / effectiveZoom, 0, 2 * Math.PI);
              ctx.fill();
            }
          }
        });
      }

      // Curve debug overlay: draw anchor points, tangent handles and index numbers
      // for every cubic shape regardless of selection (toggled from the cubic UI).
      if (showCubicDebugOverlay) {
        shapes.forEach(shape => {
          if (shape.type === 'cubic') {
            shape.renderCurveDebugOverlay(ctx, effectiveZoom);
          }
        });
      }
      if (showBezierDebugOverlay) {
        shapes.forEach(shape => {
          if (shape.type === 'bezier') {
            shape.renderCurveDebugOverlay(ctx, effectiveZoom);
          }
        });
      }
      if (showSmoothSplineDebugOverlay) {
        shapes.forEach(shape => {
          if (shape.type === 'smooth-spline') {
            shape.renderCurveDebugOverlay(ctx, effectiveZoom);
          }
        });
      }

      ctx.restore();
    };

    const animate = () => {
      // Only render if dirty flag is set
      if (dirtyRef.current) {
        renderInfiniteCanvas();
        renderArtboard();
        renderShapes();
        renderPrintMarks();        // Layer 4: print marks on dedicated canvas
        renderArtboardLabels();    // Layer 5: artboard labels on dedicated canvas
        renderDebugGrid();         // Layer 6: debug grid on dedicated canvas
        renderCtpPointLabels();    // Layer 7: CTP point property value labels
        dirtyRef.current = false; // Reset dirty flag after rendering
      }
      
      // Always schedule next frame to check for changes
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    // Start animation loop if not already running
    if (!isAnimatingRef.current) {
      isAnimatingRef.current = true;
      animate();
    }

    return () => {
      isAnimatingRef.current = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [shapes, groups, canvasSettings, artboards, activeArtboard, selectedShapes, selectedGroups, isMarqueeSelecting, marqueeStart, marqueeEnd, editMode, selectedPoints, selectedSegments, generationSets, overlayManagerState, showCubicDebugOverlay, showBezierDebugOverlay, showSmoothSplineDebugOverlay, liveSetBatchConfig, currentSetId]);

  // Register wheel event listener as non-passive so preventDefault works reliably
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => { onWheel(e); };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, [canvasRef, onWheel]);

  // Mark canvas as dirty whenever state changes - this triggers a re-render
  useEffect(() => {
    dirtyRef.current = true;
  }, [shapes, groups, canvasSettings, artboards, activeArtboard, selectedShapes, selectedGroups, isMarqueeSelecting, marqueeStart, marqueeEnd, editMode, selectedPoints, selectedSegments, generationSets, overlayManagerState, showCubicDebugOverlay, showBezierDebugOverlay, showSmoothSplineDebugOverlay, liveSetBatchConfig, currentSetId]);

  // Mark shapes as dirty only when shape/artboard/settings change (not selection)
  // This is used to optimize rendering - only re-render expensive shapes when needed
  useEffect(() => {
    shapesDirtyRef.current = true;
  }, [shapes, groups, canvasSettings, artboards, activeArtboard, generationSets]);

  // Wrap interaction handlers to set dirty flag for immediate visual feedback
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dirtyRef.current = true;
    onMouseDown(e);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dirtyRef.current = true;
    onMouseMove(e);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dirtyRef.current = true;
    onMouseUp(e);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    dirtyRef.current = true;
    onTouchStart(e);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    dirtyRef.current = true;
    onTouchMove(e);
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    dirtyRef.current = true;
    onTouchEnd(e);
  };

  const handleWheel = (e: WheelEvent) => {
    dirtyRef.current = true;
    onWheel(e);
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Toolbar */}
      <div className="bg-slate-800 border-b border-slate-700 p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onToggleMultiSelect}
                  className={cn(
                    "text-slate-300 hover:text-white hover:bg-slate-700",
                    isMultiSelectMode && "bg-blue-600 text-white hover:bg-blue-500"
                  )}
                  data-testid="button-multi-select"
                >
                  <MousePointer className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Selection mode</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onTogglePanMode}
                  className={cn(
                    "text-slate-300 hover:text-white hover:bg-slate-700",
                    isPanMode && "bg-blue-600 text-white hover:bg-blue-500"
                  )}
                  data-testid="button-pan-mode"
                >
                  <Hand className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Pan mode — drag to pan the canvas</p>
              </TooltipContent>
            </Tooltip>
          </div>
          
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={onZoomOut} className="text-slate-300 hover:text-white hover:bg-slate-700">
                  <ZoomOut className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Zoom out</p></TooltipContent>
            </Tooltip>
            
            <NumericInput
              value={Math.round((canvasSettings.zoom || 1) * 100)}
              onChange={(value) => onZoomChange(value / 100)}
              min={5}
              max={500}
              step={5}
              className="h-8 w-16 text-xs bg-slate-700 border-slate-600 text-slate-200 pt-[0px] pb-[0px] pl-[10px] pr-[10px]"
            />
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={onZoomIn} className="text-slate-300 hover:text-white hover:bg-slate-700">
                  <ZoomIn className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Zoom in</p></TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={onResetView} className="text-slate-300 hover:text-white hover:bg-slate-700">
                  <RotateCcw className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Reset view</p></TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={onFitToArtboard} className="text-slate-300 hover:text-white hover:bg-slate-700" data-testid="button-fit-artboard">
                  <Maximize2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Fit Artboard</p></TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
      
      {/* Canvas Container - Three Layered Canvases */}
      <div className="flex-1 relative bg-slate-900" style={{ overscrollBehavior: 'none' }}>
        {/* Floating selected count overlay */}
        {showSelectedCount && (() => {
          const parts: string[] = [];
          if (editMode === 'shapes' && selectedCount > 0) parts.push(`${selectedCount} shape${selectedCount !== 1 ? 's' : ''}`);
          if (editMode === 'points' && selectedPoints.length > 0) parts.push(`${selectedPoints.length} point${selectedPoints.length !== 1 ? 's' : ''}`);
          if (editMode === 'segments' && selectedSegments.length > 0) parts.push(`${selectedSegments.length} segment${selectedSegments.length !== 1 ? 's' : ''}`);
          if (parts.length === 0) return null;
          return (
            <div
              className="absolute top-2 left-1/2 -translate-x-1/2 z-10 text-xs text-slate-300 bg-slate-800/70 backdrop-blur-sm px-3 py-1 rounded-full pointer-events-none select-none"
              data-testid="text-selected-count"
            >
              {parts.join(' · ')} selected
            </div>
          );
        })()}
        {/* Layer 1: Infinite Canvas (background + grid) */}
        <canvas
          ref={infiniteCanvasRef}
          className="absolute inset-0"
          style={{ pointerEvents: 'none' }}
        />
        
        {/* Layer 2: Artboard (artboard background + border + grid) */}
        <canvas
          ref={artboardCanvasRef}
          className="absolute inset-0"
          style={{ pointerEvents: 'none' }}
        />
        
        {/* Layer 3: Shapes (transparent, compositing happens here, receives all interactions) */}
        <canvas
          ref={canvasRef}
          className={cn("absolute inset-0", isPanMode ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair")}
          style={{ touchAction: 'none', userSelect: 'none' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
        />

        {/* Layer 4: Print Marks Overlay (above shapes, no pointer events) */}
        <canvas
          ref={printMarksCanvasRef}
          className="absolute inset-0"
          style={{ pointerEvents: 'none', display: (overlayManagerState?.allVisible && overlayManagerState?.printMarksVisible) ? 'block' : 'none' }}
        />

        {/* Layer 5: Artboard Labels Overlay (above print marks, no pointer events) */}
        <canvas
          ref={artboardLabelsCanvasRef}
          className="absolute inset-0"
          style={{ pointerEvents: 'none', display: (overlayManagerState?.allVisible && overlayManagerState?.artboardLabelsVisible) ? 'block' : 'none' }}
        />

        {/* Layer 6: Debug Grid Overlay (topmost overlay, no pointer events) */}
        <canvas
          ref={debugGridCanvasRef}
          className="absolute inset-0"
          style={{ pointerEvents: 'none', display: (overlayManagerState?.allVisible && overlayManagerState?.debugGridVisible) ? 'block' : 'none' }}
        />

        {/* Layer 7: CTP Point Labels Overlay (above debug grid, no pointer events) */}
        <canvas
          ref={ctpPointLabelsCanvasRef}
          className="absolute inset-0"
          style={{ pointerEvents: 'none', display: (overlayManagerState?.allVisible !== false && (overlayManagerState?.ctpPointLabelsVisible ?? true)) ? 'block' : 'none' }}
        />
        
        {editMode !== 'shapes' && (
          <div className="absolute top-4 right-4 bg-purple-500/90 backdrop-blur-sm rounded-lg px-3 py-2 text-sm text-white">
            {editMode === 'points' ? 'Point Edit Mode' : 'Segment Edit Mode'}
          </div>
        )}
      </div>
    </div>
  );
}