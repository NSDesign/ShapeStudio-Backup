import React, { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect, memo } from 'react';
import JSZip from 'jszip';
import jsPDF from 'jspdf';
import pako from 'pako';

// Expose pako globally so UTIF.js (used by encodeCanvasAsTiff in imageExport.ts) can auto-detect it for Deflate
if (typeof window !== 'undefined') {
  (window as unknown as { pako: typeof pako }).pako = pako;
}
import { embedIccInPng, embedIccInJpeg } from '@/lib/iccProfile';
import { executeServerExport, executeServerExportWithPolling, fetchServerExportEstimate, ServerExportRequest, encodeCanvasAsTiff } from '@/lib/imageExport';
import { Button } from '@/components/ui/button';
import BatchConfigDialog from './BatchConfigDialog';
import { ShapeSetsTabbedDialog, type ShapeSetsTabbedDialogTab } from './ShapeSetsTabbedDialog';
import TiffPreflightModal, { calculateTiffPreflightInfo, CompressionSettings, DEFAULT_COMPRESSION_SETTINGS } from './TiffPreflightModal';
import ExportProgressOverlay from './ExportProgressOverlay';
import { BatchConfigSettings, EnhancedBatchConfig, GenerationSet, ShapeCountMode, SupportedShapeType, SidebarSectionConfig, DEFAULT_PRINT_CONFIG, PrintConfig, PrintUnitType, BackgroundMode, PrintMarksScaleMode, OverlayManagerState, DEFAULT_OVERLAY_MANAGER_STATE, DebugOverlayEntry, CtpPropertyOverride, PointPropertyConfig } from '@shared/schema';
import { fixedModeCount } from '@shared/shapeTypeGenUtils';
import { addEchoesToShapes, resolveEchoConfig } from '@/lib/echoGeneration';
import { batchSetScatterOverride, hideCopyToPointsSource, placeCopyToPointsShapes, positionGenerationSetShapes, sortCopyToPointsSets } from '@/lib/copyToPointsGeneration';
import type { CurrentUIState } from '@/hooks/useGenerationSets';
import { GenerationSetsDropdown } from './GenerationSetsDropdown';
import ApiCallGenerator from './ApiCallGenerator';
import AuthHeader from './AuthHeader';
import { useUserPreferences, useExportSettings } from '@/hooks/useUserPreferences';
import { useShapeSetPresets } from '@/hooks/useShapeSetPresets';
import { useToast } from '@/hooks/use-toast';
import type { ImportedConfigurationState } from '@/hooks/useShapeEditor';
import { planShapeSetImport, planArtboardImport, type SetImportMode, type ArtboardImportMode, type ImportDiagnostic } from '@/lib/configImport';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { BufferedSlider, BufferedRangeSlider, BufferedSliderWithLabel, BufferedRangeSliderWithLabel, BufferedSliderWithNumericInput, BufferedRangeSliderWithNumericInputs } from '@/components/ui/buffered-slider';
import { NumericInput, BufferedNumericInput } from '@/components/ui/numeric-input';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Shapes,
  Settings,
  Layers,
  Palette,
  Download,
  Wand2,
  Navigation,
  Shuffle,
  Layers3,
  Package,
  ImageIcon,
  Move,
  RotateCcw,
  Expand,
  FlipHorizontal,
  FlipVertical,
  Trash2,
  MousePointer,
  Edit3,
  Activity,
  Monitor,
  Target,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Grid3X3,
  Trash,
  FileImage,
  Save,
  FolderOpen,
  Boxes,
  Plus,
  Minus,
  Info,
  X,
  CheckCircle,
  AlertTriangle,
  Link2,
  Unlink2,
  RectangleVertical,
  RectangleHorizontal,
  HardDrive,
  Clock,
  Eye,
  EyeOff
} from 'lucide-react';
import { ShapeType, ShapeGroup as ShapeGroupClass, BlendMode, ScatterSettings, CanvasSettings, Artboard, ArtboardPreset, ScalarMode, getDefaultLineVectorConfig, getEffectivePrintConfig } from '@/lib/shapeTypes';
import { ModeField } from '@/components/ModeField';
import { StyledModeField, StyledModeField_v2, ModeConfig_v2, RangeSubMode } from '@/components/StyledModeField';
import { Shape } from '@/lib/shapes';
import { pixelsToUnit, unitToPixels, calculatePixelDimensions, getArtboardDisplayDimensions, getUnitLabel, DPI_PRESETS, type UnitType } from '@/lib/artboardUtils';
import { ARTBOARD_PRESETS_PHYSICAL, PRESET_CATEGORIES, getPresetsByCategory, getPresetPixelDimensions, formatPresetDimensions, calculateAspectRatio, type ArtboardPresetPhysical, type PresetCategory } from '@/lib/artboardPresets';
import { embedDPI, embedCopyright, embedPngMetadata, type PngMetadata } from '@/lib/dpiEmbedder';
import {
  estimateImageMemoryMb,
  estimateFileSizeMb,
  estimateProcessingTimeSec,
  getMemoryTier,
  getMemoryTierLabel,
  formatSizeMb,
  formatDurationSec,
} from '@shared/exportMemoryUtils';

import { SmartDistributionAlgorithm } from '../lib/distributionAlgorithm';

// Shape categories for organized display
const SHAPE_CATEGORIES = {
  'Basic': ['rectangle', 'rounded-rectangle', 'square', 'rounded-square', 'circle', 'ellipse'] as ShapeType[],
  'Geometric': ['triangle', 'right-triangle', 'pentagon', 'hexagon', 'rhombus', 'parallelogram', 'trapezoid'] as ShapeType[],
  'Special': ['star', 'polygon', 'heart', 'arrow', 'cross', 'kite', 'semicircle'] as ShapeType[],
  'Lines & Curves': ['line-vector', 'line', 'bezier', 'cubic', 'smooth-spline'] as ShapeType[],
  'Complex': ['ring', 'blob', 'chunk', 'spline-circle', 'spline-ellipse', 'spline-ring'] as ShapeType[]
};

// Shape display names mapping
const shapeTypeDisplayNames: Record<ShapeType, string> = {
  rectangle: 'Rectangle',
  'rounded-rectangle': 'Rounded Rectangle',
  square: 'Square',
  'rounded-square': 'Rounded Square',
  circle: 'Circle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  'right-triangle': 'Right Triangle',
  trapezoid: 'Trapezoid',
  pentagon: 'Pentagon',
  hexagon: 'Hexagon',
  rhombus: 'Rhombus',
  parallelogram: 'Parallelogram',
  kite: 'Kite',
  semicircle: 'Semicircle',
  heart: 'Heart',
  arrow: 'Arrow',
  cross: 'Cross',
  polygon: 'Polygon',
  star: 'Star',
  'line-vector': 'Line Vector',
  line: 'Line',
  cubic: 'Cubic Curve',
  bezier: 'Bézier Curve',

  'smooth-spline': 'Smooth Spline',
  chunk: 'Chunk',
  blob: 'Organic Blob',
  ring: 'Ring',
  'spline-circle': 'Spline Circle',
  'spline-ellipse': 'Spline Ellipse',
  'spline-ring': 'Spline Ring'
};

// Conversion functions for scatterSettings to ModeConfig format
const convertScatterToModeConfig = (
  shapeType: string,
  property: string,
  scatterSettings: ScatterSettings,
  defaultRange: [number, number]
) => {
  const shapeData = scatterSettings.shapeSpecific[shapeType as keyof typeof scatterSettings.shapeSpecific];
  
  switch (property) {
    case 'edgeCount': // for polygon
      if ((shapeData as any)?.edgeCountMode === 'fixed') {
        return {
          kind: 'fixed' as const,
          value: (shapeData as any)?.edgeCountValue ?? defaultRange[0]
        };
      }
      const edgeRange = (shapeData as any)?.edgeCountRange || defaultRange;
      return {
        kind: 'range' as const,
        min: edgeRange[0],
        max: edgeRange[1]
      };
    case 'pointCount': // for star, line, bezier, etc.
      if ((shapeData as any)?.pointCountMode === 'incremental') {
        return {
          kind: 'incremental' as const,
          startValue: (shapeData as any)?.pointCountStartValue ?? defaultRange[0],
          increment: (shapeData as any)?.pointCountIncrement ?? 1
        };
      }
      if ((shapeData as any)?.pointCountMode === 'fixed') {
        return {
          kind: 'fixed' as const,
          value: (shapeData as any)?.pointCountValue ?? defaultRange[0]
        };
      }
      const pointRange = (shapeData as any)?.pointCountRange || defaultRange;
      return {
        kind: 'range' as const,
        min: pointRange[0],
        max: pointRange[1]
      };
    case 'innerRadius': // for star, ring  
      const radiusRange = (shapeData as any)?.innerRadiusRange || [defaultRange[0] / 100, defaultRange[1] / 100];
      return {
        kind: 'range' as const,
        min: Math.round(radiusRange[0] * 100),
        max: Math.round(radiusRange[1] * 100)
      };
    case 'segmentCount': // for circle, ellipse
      if ((shapeData as any)?.segmentCountMode === 'fixed') {
        return {
          kind: 'fixed' as const,
          value: (shapeData as any)?.segmentCountValue ?? defaultRange[0]
        };
      }
      const segmentRange = (shapeData as any)?.segmentCountRange || defaultRange;
      return {
        kind: 'range' as const,
        min: segmentRange[0],
        max: segmentRange[1]
      };
    case 'curvature': // for cubic curves (percentage)
      if ((shapeData as any)?.curvatureMode === 'fixed') {
        return {
          kind: 'fixed' as const,
          value: Math.round(((shapeData as any)?.curvatureValue ?? (defaultRange[0] / 100)) * 100)
        };
      }
      const curvatureRange = (shapeData as any)?.curvatureRange || [defaultRange[0] / 100, defaultRange[1] / 100];
      return {
        kind: 'range' as const,
        min: Math.round(curvatureRange[0] * 100), // Convert back to percentage for UI
        max: Math.round(curvatureRange[1] * 100)
      };
    case 'spread': // for cubic curves (pixels)
      if ((shapeData as any)?.spreadMode === 'fixed') {
        return {
          kind: 'fixed' as const,
          value: (shapeData as any)?.spreadValue ?? defaultRange[0]
        };
      }
      const spreadRange = (shapeData as any)?.spreadRange || defaultRange;
      return {
        kind: 'range' as const,
        min: spreadRange[0],
        max: spreadRange[1]
      };
    case 'curveLength':
      if ((shapeData as any)?.curveLengthMode === 'incremental') {
        return {
          kind: 'incremental' as const,
          startValue: (shapeData as any)?.curveLengthStartValue ?? defaultRange[0],
          increment: (shapeData as any)?.curveLengthIncrement ?? 0
        };
      }
      if ((shapeData as any)?.curveLengthMode === 'fixed') {
        return {
          kind: 'fixed' as const,
          value: (shapeData as any)?.curveLengthValue ?? defaultRange[0]
        };
      }
      const curveLengthRange = (shapeData as any)?.curveLengthRange || defaultRange;
      return {
        kind: 'range' as const,
        min: curveLengthRange[0],
        max: curveLengthRange[1]
      };
    case 'tension': // for cubic curves (percentage handle length)
      if ((shapeData as any)?.curveTensionMode === 'fixed') {
        return {
          kind: 'fixed' as const,
          value: (shapeData as any)?.curveTensionValue ?? (shapeData as any)?.curveTension ?? defaultRange[0]
        };
      }
      const tensionRange = (shapeData as any)?.curveTensionRange || defaultRange;
      return {
        kind: 'range' as const,
        min: tensionRange[0],
        max: tensionRange[1]
      };
    case 'cornerRadius': // for rounded-rectangle, rounded-square
      const radiusMode = (shapeData as any)?.cornerRadiusMode || 'range';
      if (radiusMode === 'fixed') {
        const radiusValue = (shapeData as any)?.cornerRadiusValue || defaultRange[0];
        return {
          kind: 'fixed' as const,
          value: radiusValue
        };
      } else {
        const radiusRange = (shapeData as any)?.cornerRadiusRange || defaultRange;
        return {
          kind: 'range' as const,
          min: radiusRange[0],
          max: radiusRange[1]
        };
      }
    default:
      return {
        kind: 'range' as const,
        min: defaultRange[0],
        max: defaultRange[1]
      };
  }
};

// Conversion functions for line-vector ScalarMode to ModeConfig format
const convertLineVectorToModeConfig = (scalarMode: ScalarMode<number>) => {
  switch (scalarMode.kind) {
    case 'fixed':
      return {
        kind: 'fixed' as const,
        value: scalarMode.value
      };
    case 'range':
      return {
        kind: 'range' as const,
        min: scalarMode.min,
        max: scalarMode.max
      };
    case 'incremental':
      return {
        kind: 'incremental' as const,
        startValue: scalarMode.startValue,
        increment: scalarMode.increment
      };
    default:
      return {
        kind: 'fixed' as const,
        value: 0
      };
  }
};

// Conversion functions for line-vector ModeConfig back to ScalarMode format
const handleLineVectorModeConfigChange = (
  property: 'direction' | 'length' | 'centroid',
  modeConfig: any,
  scatterSettings: ScatterSettings,
  onUpdateScatterSettings: (settings: Partial<ScatterSettings>) => void
) => {
  // Convert ModeConfig back to ScalarMode format
  let newScalarMode: ScalarMode<number>;
  
  switch (modeConfig.kind) {
    case 'fixed':
      newScalarMode = {
        kind: 'fixed' as const,
        value: modeConfig.value
      };
      break;
    case 'range':
      newScalarMode = {
        kind: 'range' as const,
        min: modeConfig.min,
        max: modeConfig.max
      };
      break;
    case 'incremental':
      newScalarMode = {
        kind: 'incremental' as const,
        startValue: modeConfig.startValue,
        increment: modeConfig.increment
      };
      break;
    default:
      newScalarMode = {
        kind: 'fixed' as const,
        value: 0
      };
  }
  
  // Get current line-vector config and merge with the new property
  const currentLineVectorConfig = { 
    ...getDefaultLineVectorConfig(), 
    ...(scatterSettings.shapeSpecific['line-vector'] || {}) 
  };
  
  onUpdateScatterSettings({
    shapeSpecific: {
      ...scatterSettings.shapeSpecific,
      'line-vector': {
        ...currentLineVectorConfig,
        [property]: newScalarMode
      }
    }
  });
};

const handleScatterModeConfigChange = (
  shapeType: string,
  property: string,
  config: any,
  scatterSettings: ScatterSettings,
  onUpdateScatterSettings: (settings: Partial<ScatterSettings>) => void
) => {
  // Handle cornerRadius separately due to different data structure
  if (property === 'cornerRadius') {
    const cornerRadiusData = config.kind === 'fixed' 
      ? { cornerRadiusMode: 'fixed', cornerRadiusValue: config.value }
      : { cornerRadiusMode: 'range', cornerRadiusRange: [config.min, config.max] };
    
    onUpdateScatterSettings({
      shapeSpecific: {
        ...scatterSettings.shapeSpecific,
        [shapeType]: { 
          ...(scatterSettings.shapeSpecific[shapeType as keyof typeof scatterSettings.shapeSpecific] || {}),
          ...cornerRadiusData
        }
      }
    });
    return;
  }

  const propertyMap = {
    edgeCount: 'edgeCountRange',
    pointCount: 'pointCountRange', 
    innerRadius: 'innerRadiusRange',
    segmentCount: 'segmentCountRange',
    curvature: 'curvatureRange',
    spread: 'spreadRange',
    tension: 'curveTensionRange',
    curveLength: 'curveLengthRange'
  };
  
  const rangeProp = propertyMap[property as keyof typeof propertyMap];
  if (!rangeProp) return;

  const existingShapeData = (scatterSettings.shapeSpecific[shapeType as keyof typeof scatterSettings.shapeSpecific] as any) || {};

  // Convert ModeConfig back to range for scatterSettings. For incremental mode we
  // preserve any existing range so the stored range stays valid — incremental uses
  // its own startValue/increment fields instead of the range.
  let range: number[];
  if (config.kind === 'range') {
    range = [config.min, config.max];
  } else if (config.kind === 'fixed') {
    range = [config.value, config.value];
  } else {
    const prev = existingShapeData[rangeProp] as [number, number] | undefined;
    range = prev ? [prev[0], prev[1]] : [config.startValue, config.startValue];
  }
  
  // Handle percentage scaling for inner radius and curvature (convert percentages back to decimals)
  if (property === 'innerRadius' || property === 'curvature') {
    range = [range[0] / 100, range[1] / 100];
  }

  // Persist the selected mode and fixed value so convertScatterToModeConfig
  // can restore the correct UI state on re-render.
  const modeData: Record<string, any> = {};
  if (property === 'pointCount') {
    modeData.pointCountMode = config.kind;
    if (config.kind === 'fixed') modeData.pointCountValue = config.value;
    if (config.kind === 'incremental') {
      modeData.pointCountStartValue = config.startValue;
      modeData.pointCountIncrement = config.increment;
    }
  } else if (property === 'segmentCount') {
    modeData.segmentCountMode = config.kind;
    if (config.kind === 'fixed') modeData.segmentCountValue = config.value;
  } else if (property === 'edgeCount') {
    modeData.edgeCountMode = config.kind;
    if (config.kind === 'fixed') modeData.edgeCountValue = config.value;
  } else if (property === 'curvature') {
    modeData.curvatureMode = config.kind;
    if (config.kind === 'fixed') modeData.curvatureValue = range[0]; // already in decimal
  } else if (property === 'spread') {
    modeData.spreadMode = config.kind;
    if (config.kind === 'fixed') modeData.spreadValue = range[0];
  } else if (property === 'curveLength') {
    modeData.curveLengthMode = config.kind;
    if (config.kind === 'fixed') modeData.curveLengthValue = config.value;
    if (config.kind === 'incremental') {
      modeData.curveLengthStartValue = config.startValue;
      modeData.curveLengthIncrement = config.increment;
    }
  } else if (property === 'tension') {
    modeData.curveTensionMode = config.kind;
    if (config.kind === 'fixed') modeData.curveTensionValue = range[0];
  }
  
  onUpdateScatterSettings({
    shapeSpecific: {
      ...scatterSettings.shapeSpecific,
      [shapeType]: { 
        ...(scatterSettings.shapeSpecific[shapeType as keyof typeof scatterSettings.shapeSpecific] || {}),
        [rangeProp]: range,
        ...modeData
      }
    }
  });
};

// Memoized PrintConfigurationSection - extracted to top level to prevent remounting on parent re-renders
interface PrintConfigurationSectionProps {
  currentArtboard: Artboard;
  onUpdateArtboard: (id: string, updates: Partial<Artboard>) => void;
}

const PrintConfigurationSection = React.memo(function PrintConfigurationSection({ 
  currentArtboard, 
  onUpdateArtboard
}: PrintConfigurationSectionProps) {
  
  const printConfig = currentArtboard.printConfig || DEFAULT_PRINT_CONFIG;
  
  const updatePrintConfig = useCallback((updates: Partial<PrintConfig>) => {
    onUpdateArtboard(currentArtboard.id, {
      printConfig: { ...printConfig, ...updates }
    });
  }, [currentArtboard.id, printConfig, onUpdateArtboard]);
  
  const updateBleed = useCallback((updates: Partial<typeof printConfig.overlays.bleed>) => {
    onUpdateArtboard(currentArtboard.id, {
      printConfig: {
        ...printConfig,
        overlays: {
          ...printConfig.overlays,
          bleed: { ...printConfig.overlays.bleed, ...updates }
        }
      }
    });
  }, [currentArtboard.id, printConfig, onUpdateArtboard]);
  
  const updateSafeZone = useCallback((updates: Partial<typeof printConfig.overlays.safeZone>) => {
    onUpdateArtboard(currentArtboard.id, {
      printConfig: {
        ...printConfig,
        overlays: {
          ...printConfig.overlays,
          safeZone: { ...printConfig.overlays.safeZone, ...updates }
        }
      }
    });
  }, [currentArtboard.id, printConfig, onUpdateArtboard]);
  
  const updatePrintMarks = useCallback((updates: Partial<typeof printConfig.overlays.printMarks>) => {
    onUpdateArtboard(currentArtboard.id, {
      printConfig: {
        ...printConfig,
        overlays: {
          ...printConfig.overlays,
          printMarks: { ...printConfig.overlays.printMarks, ...updates }
        }
      }
    });
  }, [currentArtboard.id, printConfig, onUpdateArtboard]);
  
  const updateOverlayUnit = useCallback((unit: PrintUnitType) => {
    onUpdateArtboard(currentArtboard.id, {
      printConfig: {
        ...printConfig,
        overlays: {
          ...printConfig.overlays,
          overlayUnit: unit
        }
      }
    });
  }, [currentArtboard.id, printConfig, onUpdateArtboard]);
  
  // Get unit label for display
  const overlayUnit = printConfig.overlays.overlayUnit || 'pixels';
  const unitLabel = overlayUnit === 'pixels' ? 'px' : overlayUnit === 'inches' ? 'in' : overlayUnit;
  
  const displayDimensions = getArtboardDisplayDimensions(
    currentArtboard.width,
    currentArtboard.height,
    currentArtboard.dpi ?? 72,
    currentArtboard.unitType ?? 'pixels'
  );
  
  return (
    <div className="space-y-4">
      <div className="text-xs text-purple-300 font-medium">Print Configuration</div>
      
      <div className="space-y-4 p-2 bg-slate-800/30 rounded-lg border border-purple-500/20">
        
        {/* Artboard Info Display - Name, Dimensions, DPI */}
        <div className="flex items-center justify-between text-[10px] bg-slate-900/50 p-2 rounded border border-slate-700">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-400 font-medium truncate max-w-[100px]" title={currentArtboard.name}>
              {currentArtboard.name}
            </span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-300 whitespace-nowrap">
              {displayDimensions.widthFormatted} × {displayDimensions.heightFormatted} {getUnitLabel(currentArtboard.unitType ?? 'pixels')}
            </span>
          </div>
          <span className="text-slate-400 whitespace-nowrap ml-2">
            {currentArtboard.dpi ?? 72} DPI
          </span>
        </div>
        
        <Separator className="bg-slate-600/30" />
        
        {/* Unified Overlay Unit Selector */}
        <div className="space-y-2">
          <Label className="text-xs text-slate-400 font-medium">Overlay Unit</Label>
          <Select
            value={printConfig.overlays.overlayUnit || 'pixels'}
            onValueChange={(value: PrintUnitType) => updateOverlayUnit(value)}
          >
            <SelectTrigger className="h-7 text-xs bg-slate-700 border-slate-600" data-testid="select-overlay-unit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ zIndex: 10002 }}>
              <SelectItem value="pixels">Pixels (px)</SelectItem>
              <SelectItem value="mm">Millimeters (mm)</SelectItem>
              <SelectItem value="cm">Centimeters (cm)</SelectItem>
              <SelectItem value="inches">Inches (in)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[9px] text-slate-500">Applies to bleed, safe zone, and print marks</p>
        </div>
        
        <Separator className="bg-slate-600/30" />
        
        {/* Bleed Settings */}
        <div className="space-y-3">
          <Label className="text-xs text-slate-400 font-medium">Bleed</Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label className="text-[10px] text-slate-500">Amount</Label>
              <BufferedNumericInput
                value={printConfig.overlays.bleed.amount}
                onCommit={(value) => updateBleed({ amount: value })}
                step={0.1}
                min={0}
                className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200"
                data-testid="input-bleed-amount"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] text-slate-500">Color</Label>
              <div className="flex gap-1">
                <input
                  type="color"
                  value={printConfig.overlays.bleed.color || '#00FFFF'}
                  onChange={(e) => updateBleed({ color: e.target.value })}
                  className="h-6 w-8 rounded border border-slate-600 bg-slate-700 cursor-pointer"
                  data-testid="input-bleed-color"
                />
                <Input
                  type="text"
                  value={printConfig.overlays.bleed.color || '#00FFFF'}
                  onChange={(e) => updateBleed({ color: e.target.value })}
                  className="h-6 text-xs bg-slate-700 border-slate-600 text-slate-200 flex-1"
                  data-testid="input-bleed-color-text"
                />
              </div>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <Switch
                checked={printConfig.overlays.bleed.display}
                onCheckedChange={(checked) => updateBleed({ display: !!checked })}
                className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-blue-900"
                data-testid="checkbox-bleed-display"
              />
              <Label className="text-[10px] text-slate-500">Display</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={printConfig.overlays.bleed.render}
                onCheckedChange={(checked) => updateBleed({ render: !!checked })}
                className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-blue-900"
                data-testid="checkbox-bleed-render"
              />
              <Label className="text-[10px] text-slate-500" title="When enabled, bleed area is included in &quot;Artboard + Print Marks&quot; exports. Display only shows it on-screen.">Render</Label>
            </div>
          </div>
        </div>
        
        <Separator className="bg-slate-600/30" />
        
        {/* Safe Zone Settings */}
        <div className="space-y-3">
          <Label className="text-xs text-slate-400 font-medium">Safe Zone</Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label className="text-[10px] text-slate-500">Amount</Label>
              <BufferedNumericInput
                value={printConfig.overlays.safeZone.amount}
                onCommit={(value) => updateSafeZone({ amount: value })}
                step={0.1}
                min={0}
                className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200"
                data-testid="input-safe-zone-amount"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] text-slate-500">Color</Label>
              <div className="flex gap-1">
                <input
                  type="color"
                  value={printConfig.overlays.safeZone.color || '#FF00FF'}
                  onChange={(e) => updateSafeZone({ color: e.target.value })}
                  className="h-6 w-8 rounded border border-slate-600 bg-slate-700 cursor-pointer"
                  data-testid="input-safe-zone-color"
                />
                <Input
                  type="text"
                  value={printConfig.overlays.safeZone.color || '#FF00FF'}
                  onChange={(e) => updateSafeZone({ color: e.target.value })}
                  className="h-6 text-xs bg-slate-700 border-slate-600 text-slate-200 flex-1"
                  data-testid="input-safe-zone-color-text"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={printConfig.overlays.safeZone.display}
              onCheckedChange={(checked) => updateSafeZone({ display: !!checked })}
              className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-blue-900"
              data-testid="checkbox-safe-zone-display"
            />
            <Label className="text-[10px] text-slate-500">Display</Label>
          </div>
        </div>
        
        <Separator className="bg-slate-600/30" />
        
        {/* Print Marks Settings */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-slate-400 font-medium">Print Marks</Label>
            <Select
              value={printConfig.overlays.printMarks.scaleMode || 'none'}
              onValueChange={(value: PrintMarksScaleMode) => updatePrintMarks({ scaleMode: value })}
            >
              <SelectTrigger className="h-6 w-24 text-[10px] bg-slate-700 border-slate-600" data-testid="select-print-marks-scale-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={{ zIndex: 10002 }}>
                <SelectItem value="none">None ({unitLabel})</SelectItem>
                <SelectItem value="percent">Percent (%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <Switch
                checked={printConfig.overlays.printMarks.display}
                onCheckedChange={(checked) => updatePrintMarks({ display: !!checked })}
                className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-blue-900"
                data-testid="checkbox-print-marks-display"
              />
              <Label className="text-[10px] text-slate-500">Display</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={printConfig.overlays.printMarks.render}
                onCheckedChange={(checked) => updatePrintMarks({ render: !!checked })}
                className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-blue-900"
                data-testid="checkbox-print-marks-render"
              />
              <Label className="text-[10px] text-slate-500" title="When enabled, crop/registration marks are included in &quot;Artboard + Print Marks&quot; exports. Display only shows them on-screen.">Render</Label>
            </div>
          </div>
          {(printConfig.overlays.printMarks.display || printConfig.overlays.printMarks.render) && (
            <div className="space-y-3 ml-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={printConfig.overlays.printMarks.cropMarks}
                  onCheckedChange={(checked) => updatePrintMarks({ cropMarks: !!checked })}
                  className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-blue-900"
                  data-testid="checkbox-crop-marks"
                />
                <Label className="text-[10px] text-slate-500">Crop Marks</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={printConfig.overlays.printMarks.registrationMarks}
                  onCheckedChange={(checked) => updatePrintMarks({ registrationMarks: !!checked })}
                  className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-blue-900"
                  data-testid="checkbox-registration-marks"
                />
                <Label className="text-[10px] text-slate-500">Registration Marks</Label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label className="text-[10px] text-slate-500">
                    Mark Length ({(printConfig.overlays.printMarks.scaleMode || 'none') === 'percent' ? '%' : unitLabel})
                  </Label>
                  <BufferedNumericInput
                    value={printConfig.overlays.printMarks.markLength}
                    onCommit={(value) => updatePrintMarks({ markLength: (printConfig.overlays.printMarks.scaleMode || 'none') === 'percent' ? value : Math.round(value) })}
                    min={(printConfig.overlays.printMarks.scaleMode || 'none') === 'percent' ? 0.1 : 1}
                    max={100}
                    step={(printConfig.overlays.printMarks.scaleMode || 'none') === 'percent' ? 0.1 : 1}
                    className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200"
                    data-testid="input-mark-length"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] text-slate-500">
                    Mark Offset ({(printConfig.overlays.printMarks.scaleMode || 'none') === 'percent' ? '%' : unitLabel})
                  </Label>
                  <BufferedNumericInput
                    value={printConfig.overlays.printMarks.markOffset}
                    onCommit={(value) => updatePrintMarks({ markOffset: (printConfig.overlays.printMarks.scaleMode || 'none') === 'percent' ? value : Math.round(value) })}
                    min={0}
                    max={50}
                    step={(printConfig.overlays.printMarks.scaleMode || 'none') === 'percent' ? 0.1 : 1}
                    className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200"
                    data-testid="input-mark-offset"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] text-slate-500">Color</Label>
                <div className="flex gap-1">
                  <input
                    type="color"
                    value={printConfig.overlays.printMarks.color || '#000000'}
                    onChange={(e) => updatePrintMarks({ color: e.target.value })}
                    className="h-6 w-8 rounded border border-slate-600 bg-slate-700 cursor-pointer"
                    data-testid="input-print-marks-color"
                  />
                  <Input
                    type="text"
                    value={printConfig.overlays.printMarks.color || '#000000'}
                    onChange={(e) => updatePrintMarks({ color: e.target.value })}
                    className="h-6 text-xs bg-slate-700 border-slate-600 text-slate-200 flex-1"
                    data-testid="input-print-marks-color-text"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// Reusable info "[i]" popover for shape-specific settings blocks.
// Renders a small icon button in the block's top-right corner that opens a
// plain-language explanation popover with an "[x]" close button. Closes on
// outside click. Uses the dialog z-index convention so it sits above the
// surrounding UI (including inside the Shape Sets dialog / collapsed sidebar).
function ShapeSettingsInfo({ title, children, containerClassName }: { title: string; children: React.ReactNode; containerClassName?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={containerClassName ?? 'absolute top-2 right-2 z-10'}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`About ${title}`}
            className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="left"
          className="w-72 bg-slate-800 border-slate-600 text-slate-200 p-3"
          style={{ zIndex: 10002 }}
        >
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <h4 className="text-xs font-semibold text-slate-100">{title}</h4>
            <button
              type="button"
              aria-label="Close"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors"
              onClick={() => setOpen(false)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="text-xs leading-relaxed text-slate-300 space-y-2.5 max-h-72 overflow-y-auto">
            {children}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Memoized ShapeTypesContent - extracted to top level to prevent remounting on parent re-renders
interface ShapeTypesContentProps {
  scatterSettings: ScatterSettings;
  onUpdateScatterSettings: (settings: Partial<ScatterSettings>) => void;
  generationConfigSettings: BatchConfigSettings;
  onUpdateGenerationConfigSettings: (settings: Partial<BatchConfigSettings>) => void;
  enabledShapeTypes: Set<ShapeType>;
  onToggleShapeType: (type: ShapeType) => void;
  shapeListAccordionOpen: string | undefined;
  setShapeListAccordionOpen: (value: string | undefined) => void;
  openShapeCategories: string[];
  setOpenShapeCategories: (value: string[]) => void;
  expandedShapes: Set<string>;
  toggleShapeExpansion: (shapeType: string) => void;
  setsEnabled: boolean;
  currentGenerationSetId: string | null;
  updateGenerationSetPartial: ((id: string, updates: Partial<GenerationSet>) => Promise<void>) | undefined;
  applyStatus: 'idle' | 'applying' | 'success';
  handleApplyToCurrentSet: () => void;
  hideApplyButton?: boolean;
  bezierAccordionSections: string[];
  setBezierAccordionSections: (value: string[]) => void;
  smoothSplineAccordionSections: string[];
  setSmoothSplineAccordionSections: (value: string[]) => void;
  cubicAccordionSections: string[];
  setCubicAccordionSections: (value: string[]) => void;
  currentSet?: GenerationSet | null;
  shapeSetsUI?: React.ReactNode;
}

// ─── Memoized Collapsed Overlay Manager Content — module level to prevent remounting ───
const COM_PALETTE_OVERLAY = ['#FF4444', '#44AAFF', '#44FF88', '#FFAA00', '#CC44FF'];

interface CollapsedOverlayManagerContentProps {
  overlayManagerState: OverlayManagerState | undefined;
  onOverlayManagerStateChange: ((state: OverlayManagerState) => void) | undefined;
  generationSets: GenerationSet[] | undefined;
  updateGenerationSetPartial: ((id: string, updates: Partial<GenerationSet>) => Promise<void>) | undefined;
}

const CollapsedOverlayManagerContentMemo = React.memo(function CollapsedOverlayManagerContentMemo({
  overlayManagerState: overlayManagerStateProp,
  onOverlayManagerStateChange,
  generationSets,
  updateGenerationSetPartial,
}: CollapsedOverlayManagerContentProps) {
  const state = overlayManagerStateProp ?? DEFAULT_OVERLAY_MANAGER_STATE;
  const upd = (partial: Partial<OverlayManagerState>) =>
    onOverlayManagerStateChange?.({ ...state, ...partial });

  const comDebugSets = (generationSets ?? []).filter(
    s => s.enabled && s.batchConfig?.distributionLayoutEnabled && s.batchConfig?.distributionPattern === 'grid'
  );

  const updateComSetEntry = (set: GenerationSet, idx: number, patch: Partial<DebugOverlayEntry>) => {
    const current = state.debugGrid?.sets ?? {};
    const existing = current[set.id];
    const base: DebugOverlayEntry = { visible: true, color: COM_PALETTE_OVERLAY[idx % COM_PALETTE_OVERLAY.length], opacity: 0.4, order: idx };
    const merged = { ...base, ...existing, ...patch };
    upd({ debugGrid: { sets: { ...current, [set.id]: merged } } });
    if (patch.color !== undefined || patch.opacity !== undefined) {
      updateGenerationSetPartial?.(set.id, {
        batchConfig: {
          ...set.batchConfig!,
          cellConstraints: {
            ...set.batchConfig!.cellConstraints!,
            ...(patch.color !== undefined ? { debugGridColor: patch.color } : {}),
            ...(patch.opacity !== undefined ? { debugGridOpacity: patch.opacity } : {}),
          }
        }
      });
    }
  };

  return (
    <div className="space-y-2.5 w-full">
      {/* Master toggle */}
      <div className={`flex items-center justify-between px-2 py-1.5 rounded-lg border ${state.allVisible ? 'bg-teal-800/40 border-teal-400/60' : 'bg-slate-700/50 border-slate-600/50'}`}>
        <div className="flex items-center gap-1.5">
          {state.allVisible ? <Eye className="w-3.5 h-3.5 text-teal-300" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
          <Label className={`text-xs font-semibold ${state.allVisible ? 'text-teal-100' : 'text-slate-400'}`}>All Overlays</Label>
        </div>
        <Switch
          checked={state.allVisible}
          onCheckedChange={v => {
            const allSets: Record<string, DebugOverlayEntry> = {};
            Object.entries(state.debugGrid?.sets ?? {}).forEach(([k, e]) => { allSets[k] = { ...e, visible: v }; });
            onOverlayManagerStateChange?.({ ...state, allVisible: v, printMarksVisible: v, artboardLabelsVisible: v, debugGridVisible: v, ctpPointLabelsVisible: v, debugGrid: { sets: allSets } });
          }}
          className="data-[state=checked]:bg-teal-500 data-[state=unchecked]:bg-teal-900"
        />
      </div>

      <div className={state.allVisible ? 'space-y-2' : 'space-y-2 opacity-40 pointer-events-none'}>
        {/* Print Marks */}
        <div className={`rounded-lg border transition-colors ${state.printMarksVisible ? 'bg-teal-900/20 border-teal-600/40' : 'bg-slate-800/30 border-slate-700/40'}`}>
          <div className="flex items-center justify-between px-2 py-1.5">
            <Label className={`text-xs font-medium ${state.printMarksVisible ? 'text-teal-200' : 'text-slate-400'}`}>Print Marks</Label>
            <Switch checked={state.printMarksVisible} onCheckedChange={v => upd({ printMarksVisible: v })} className="data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-teal-900" />
          </div>
        </div>

        {/* Artboard Labels */}
        <div className={`rounded-lg border transition-colors ${state.artboardLabelsVisible ? 'bg-teal-900/20 border-teal-600/40' : 'bg-slate-800/30 border-slate-700/40'}`}>
          <div className="flex items-center justify-between px-2 py-1.5">
            <Label className={`text-xs font-medium ${state.artboardLabelsVisible ? 'text-teal-200' : 'text-slate-400'}`}>Artboard Labels</Label>
            <Switch checked={state.artboardLabelsVisible} onCheckedChange={v => upd({ artboardLabelsVisible: v })} className="data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-teal-900" />
          </div>
        </div>

        {/* Debug Grids */}
        <div className={`rounded-lg border transition-colors ${state.debugGridVisible ? 'bg-teal-900/20 border-teal-600/40' : 'bg-slate-800/30 border-slate-700/40'}`}>
          <div className="flex items-center justify-between px-2 py-1.5">
            <Label className={`text-xs font-medium ${state.debugGridVisible ? 'text-teal-200' : 'text-slate-400'}`}>Debug Grids</Label>
            <Switch checked={state.debugGridVisible} onCheckedChange={v => upd({ debugGridVisible: v })} className="data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-teal-900" />
          </div>
          {state.debugGridVisible && (
            <div className="px-2 pb-2 border-t border-teal-700/30">
              {comDebugSets.length === 0 ? (
                <p className="text-[10px] text-slate-500 italic py-1.5">No grid sets found.</p>
              ) : (
                <div className="space-y-2.5 pt-1.5">
                  {comDebugSets.map((set, idx) => {
                    const entry = state.debugGrid?.sets[set.id];
                    const isVisible = entry?.visible !== false;
                    const color = entry?.color || set.batchConfig?.cellConstraints?.debugGridColor || COM_PALETTE_OVERLAY[idx % COM_PALETTE_OVERLAY.length];
                    const opacity = entry?.opacity ?? set.batchConfig?.cellConstraints?.debugGridOpacity ?? 0.4;
                    const rows = set.batchConfig?.gridRows ?? 0;
                    const cols = set.batchConfig?.gridColumns ?? 0;
                    const renderMode = set.batchConfig?.cellConstraints?.renderMode ?? 'cell-center';
                    const isCellCornersMode = renderMode === 'cell-corners';
                    const effRows = isCellCornersMode ? rows + 1 : rows;
                    const effCols = isCellCornersMode ? cols + 1 : cols;
                    const gridOverridden = isCellCornersMode && (effRows !== rows || effCols !== cols);
                    return (
                      <div key={set.id} className="rounded bg-slate-800/60 p-1.5 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Switch checked={isVisible} onCheckedChange={v => updateComSetEntry(set, idx, { visible: v })} className="data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-teal-900 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className={`text-[11px] truncate block ${isVisible ? 'text-slate-300' : 'text-slate-500'}`}>{set.name}</span>
                            {rows > 0 && cols > 0 && (
                              <span className={`text-[9px] ${gridOverridden ? 'text-amber-400' : 'text-slate-500'}`}>
                                {effRows}×{effCols}{gridOverridden ? ` (cell, ${rows}×${cols} set)` : ''}
                              </span>
                            )}
                          </div>
                          <Input type="color" value={color} onChange={e => updateComSetEntry(set, idx, { color: e.target.value })} className="w-12 h-8 p-1 bg-slate-800 border-slate-600 rounded cursor-pointer shrink-0" title="Grid color" />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Slider min={0} max={100} step={5} value={[Math.round(opacity * 100)]} onValueChange={([v]) => updateComSetEntry(set, idx, { opacity: v / 100 })} className="flex-1" />
                          <span className="text-[10px] text-slate-400 w-6 text-right">{Math.round(opacity * 100)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* CTP Point Labels */}
        <CtpOverlaySectionMemo state={state} generationSets={generationSets} onUpdate={upd} compact />
      </div>
    </div>
  );
});

// ─── Memoized CTP overlay section — module level to prevent remounting on parent re-renders ───
interface CtpOverlaySectionProps {
  state: OverlayManagerState;
  generationSets: GenerationSet[] | undefined;
  onUpdate: (patch: Partial<OverlayManagerState>) => void;
  compact?: boolean;
}

const CtpOverlaySectionMemo = React.memo(function CtpOverlaySectionMemo({
  state, generationSets, onUpdate, compact = false,
}: CtpOverlaySectionProps) {
  const [openSets, setOpenSets] = useState<Set<string>>(new Set());
  const [activeTabs, setActiveTabs] = useState<Record<string, string>>({});

  const ctpVisible = state.ctpPointLabelsVisible ?? true;

  const destSets = (generationSets ?? []).filter(s =>
    s.enabled &&
    s.batchConfig?.copyToPointsTargetEnabled &&
    (s.batchConfig?.copyToPointsTargetConfig?.pointProperties ?? []).some(
      (p: PointPropertyConfig) => p.enabled
    )
  );

  const updateCtpProp = useCallback((setId: string, shapeType: string, propKey: string, patch: Partial<CtpPropertyOverride>) => {
    const k = `${setId}:${shapeType}:${propKey}`;
    const current = state.ctpProperties ?? {};
    const base: CtpPropertyOverride = current[k] ?? { visible: true };
    onUpdate({ ctpProperties: { ...current, [k]: { ...base, ...patch } } });
  }, [state.ctpProperties, onUpdate]);

  const toggleSetOpen = useCallback((setId: string) => {
    setOpenSets(prev => {
      const next = new Set(prev);
      if (next.has(setId)) next.delete(setId); else next.add(setId);
      return next;
    });
  }, []);

  const lblSm = compact ? 'text-[11px]' : 'text-xs';
  const lblXs = compact ? 'text-[10px]' : 'text-[11px]';
  const pad = compact ? 'px-2 py-1.5' : 'p-2';

  return (
    <div className={`rounded-lg border transition-colors ${ctpVisible ? 'bg-teal-900/20 border-teal-600/40' : 'bg-slate-800/30 border-slate-700/40'}`}>
      <div className={`flex items-center justify-between ${pad}`}>
        <Label className={`${compact ? 'text-xs' : 'text-sm'} font-medium ${ctpVisible ? 'text-teal-200' : 'text-slate-400'}`}>CTP Point Labels</Label>
        <Switch checked={ctpVisible} onCheckedChange={v => onUpdate({ ctpPointLabelsVisible: v })} className="data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-teal-900" />
      </div>
      {ctpVisible && (
        <div className={`border-t border-teal-700/30 ${compact ? 'px-1.5 pb-1.5 pt-1 space-y-2' : 'px-2 pb-2 pt-1.5 space-y-2.5'}`}>
          {destSets.length === 0 ? (
            <p className={`${lblXs} text-slate-500 italic py-1`}>No sets with CTP point labels enabled.</p>
          ) : destSets.map(destSet => {
            const sourceSet = (generationSets ?? []).find(s =>
              s.enabled &&
              s.batchConfig?.copyToPointsEnabled &&
              s.batchConfig?.copyToPointsConfig?.destinationSetId === destSet.id
            );
            const shapeTypes: string[] = sourceSet?.enabledShapeTypes ?? [];
            const multiType = shapeTypes.length > 1;
            const currentTab = activeTabs[destSet.id] ?? shapeTypes[0] ?? 'all';
            const isOpen = openSets.has(destSet.id);
            const props = (destSet.batchConfig?.copyToPointsTargetConfig?.pointProperties ?? []).filter(
              (p: PointPropertyConfig) => p.enabled
            );

            return (
              <div key={destSet.id} className="rounded-md border border-slate-600/40 bg-slate-800/40 overflow-hidden">
                <button
                  onClick={() => toggleSetOpen(destSet.id)}
                  className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-slate-700/40 transition-colors"
                >
                  <span className={`${lblSm} font-medium text-slate-300 truncate`}>{destSet.name}</span>
                  <span className="text-slate-500 text-[10px] ml-1 shrink-0">{isOpen ? '▲' : '▼'}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-slate-600/40">
                    {multiType && (
                      <div className="flex flex-wrap gap-1 px-2 pt-1.5">
                        {shapeTypes.map(st => (
                          <button
                            key={st}
                            onClick={() => setActiveTabs(prev => ({ ...prev, [destSet.id]: st }))}
                            className={`px-2 py-0.5 rounded ${lblXs} font-medium border transition-colors ${
                              currentTab === st
                                ? 'bg-teal-700/60 text-teal-200 border-teal-500/60'
                                : 'bg-slate-700/40 text-slate-400 border-slate-600/40 hover:text-slate-300'
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="space-y-2.5 p-2">
                      {props.map((prop: PointPropertyConfig) => {
                        const shapeType = multiType ? currentTab : (shapeTypes[0] ?? 'all');
                        const k = `${destSet.id}:${shapeType}:${prop.key}`;
                        const ov = state.ctpProperties?.[k];
                        const isVisible = ov?.visible !== false;
                        const color = ov?.color ?? prop.labelColor ?? '#22d3ee';
                        const size = ov?.size ?? prop.labelFontSize ?? 10;
                        return (
                          <div key={prop.key} className="rounded bg-slate-900/60 p-1.5 space-y-2">
                            <div className="flex items-center gap-1.5">
                              <Switch
                                checked={isVisible}
                                onCheckedChange={v => updateCtpProp(destSet.id, shapeType, prop.key, { visible: v })}
                                className="data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-teal-900 shrink-0"
                              />
                              <span className={`${lblSm} font-medium flex-1 min-w-0 truncate ${isVisible ? 'text-slate-300' : 'text-slate-500'}`}>
                                {prop.key}
                              </span>
                              <input
                                type="color"
                                value={color}
                                onChange={e => updateCtpProp(destSet.id, shapeType, prop.key, { color: e.target.value })}
                                className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0 shrink-0"
                                style={{ appearance: 'none' as any }}
                                title="Label colour"
                              />
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Slider min={6} max={32} step={1} value={[size]} onValueChange={([v]) => updateCtpProp(destSet.id, shapeType, prop.key, { size: v })} className="flex-1" />
                              <span className={`${lblXs} text-slate-400 w-6 text-right shrink-0`}>{size}px</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

const ShapeTypesContentMemo = React.memo(function ShapeTypesContentMemo({
  scatterSettings,
  onUpdateScatterSettings,
  generationConfigSettings,
  onUpdateGenerationConfigSettings,
  enabledShapeTypes,
  onToggleShapeType,
  shapeListAccordionOpen,
  setShapeListAccordionOpen,
  openShapeCategories,
  setOpenShapeCategories,
  expandedShapes,
  toggleShapeExpansion,
  setsEnabled,
  currentGenerationSetId,
  updateGenerationSetPartial,
  applyStatus,
  handleApplyToCurrentSet,
  hideApplyButton = false,
  bezierAccordionSections,
  setBezierAccordionSections,
  smoothSplineAccordionSections,
  setSmoothSplineAccordionSections,
  cubicAccordionSections,
  setCubicAccordionSections,
  currentSet,
  shapeSetsUI,
}: ShapeTypesContentProps) {
  const renderMode = generationConfigSettings?.shapeRenderMode ?? 'smooth';
  const seqDragIndexRef = useRef<number | null>(null);
  const [seqDragOver, setSeqDragOver] = useState<number | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(['shape-types', 'shape-rendering', 'render-mode', 'wire-pass']));
  const toggleSection = (key: string) => setOpenSections(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });

  const getShapeProperties = useCallback((shapeType: string) => {
    const renderCurvePatternFields = (curveType: 'bezier' | 'smooth-spline' | 'cubic') => {
      const s = (scatterSettings.shapeSpecific[curveType] as any) || {};
      const defaultPattern = curveType === 'cubic' ? 2 : 1;
      const pattern = s.patternType ?? defaultPattern;
      const setField = (patch: any) => {
        onUpdateScatterSettings({
          shapeSpecific: {
            ...scatterSettings.shapeSpecific,
            [curveType]: { ...((scatterSettings.shapeSpecific[curveType] as any) || {}), ...patch }
          }
        });
      };

      // Build a ModeConfig_v2 from the stored mode/value/range/incremental fields for a
      // pattern parameter.  Falls back to the legacy plain-value field so old projects work.
      const patternCfg = (fieldName: string, defaultVal: number): ModeConfig_v2 => {
        const mode = s[`${fieldName}Mode`] ?? 'fixed';
        if (mode === 'incremental') {
          return { kind: 'incremental', startValue: s[`${fieldName}StartValue`] ?? defaultVal, increment: s[`${fieldName}Increment`] ?? 0 };
        }
        if (mode === 'range') {
          const r = s[`${fieldName}Range`] as [number, number] | undefined;
          const subMode = (s[`${fieldName}RangeSubMode`] as RangeSubMode) ?? 'random';
          return { kind: 'range', min: r?.[0] ?? defaultVal, max: r?.[1] ?? defaultVal, subMode };
        }
        return { kind: 'fixed', value: s[`${fieldName}Value`] ?? s[fieldName] ?? defaultVal };
      };

      // Persist a pattern parameter change back to shapeSpecific state. Also writes the
      // legacy plain field (e.g. waveHeight) so older generator code stays compatible.
      const setPatternCfg = (fieldName: string, cfg: ModeConfig_v2) => {
        const patch: Record<string, any> = { [`${fieldName}Mode`]: cfg.kind };
        if (cfg.kind === 'fixed') {
          patch[`${fieldName}Value`] = cfg.value;
          patch[fieldName] = cfg.value;
        } else if (cfg.kind === 'range') {
          patch[`${fieldName}Range`] = [cfg.min, cfg.max];
          patch[`${fieldName}RangeSubMode`] = cfg.subMode;
          patch[fieldName] = (cfg.min + cfg.max) / 2;
        } else {
          patch[`${fieldName}StartValue`] = cfg.startValue;
          patch[`${fieldName}Increment`] = cfg.increment;
          patch[fieldName] = cfg.startValue;
        }
        setField(patch);
      };

      return (
        <div className="space-y-4">
          <div className="space-y-3">
            <Label className="text-xs text-slate-400">Curve Pattern</Label>
            <Select value={String(pattern)} onValueChange={(value) => setField({ patternType: parseInt(value) })}>
              <SelectTrigger className="h-8 bg-slate-700 border-slate-600 text-slate-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={{ zIndex: 10002 }}>
                <SelectItem value="-1">None</SelectItem>
                <SelectItem value="0">Spiral</SelectItem>
                <SelectItem value="1">Wave</SelectItem>
                <SelectItem value="2">Organic</SelectItem>
                <SelectItem value="3">Arc</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {pattern === 1 && (
            <div className="space-y-4">
              <StyledModeField_v2 label="Wave Height"    config={patternCfg('waveHeight', 60)}   onChange={(cfg) => setPatternCfg('waveHeight', cfg)}    bounds={{ min: 0,   max: 200 }} step={5}   unit="px"  allowedModes={['fixed', 'range', 'incremental']} />
              <StyledModeField_v2 label="Wave Frequency" config={patternCfg('waveFrequency', 1)} onChange={(cfg) => setPatternCfg('waveFrequency', cfg)} bounds={{ min: 0.5, max: 6 }}   step={0.5}        allowedModes={['fixed', 'range', 'incremental']} />
              <StyledModeField_v2 label="Wave Phase"     config={patternCfg('wavePhase', 0)}     onChange={(cfg) => setPatternCfg('wavePhase', cfg)}     bounds={{ min: 0,   max: 360 }} step={15}  unit="°"   allowedModes={['fixed', 'range', 'incremental']} />
            </div>
          )}
          {pattern === 0 && (
            <div className="space-y-4">
              <StyledModeField_v2 label="Spiral Turns"     config={patternCfg('spiralTurns', 2.5)}    onChange={(cfg) => setPatternCfg('spiralTurns', cfg)}     bounds={{ min: 0.5, max: 6 }}   step={0.5} allowedModes={['fixed', 'range', 'incremental']} />
              <StyledModeField_v2 label="Spiral Tightness" config={patternCfg('spiralTightness', 1)}  onChange={(cfg) => setPatternCfg('spiralTightness', cfg)} bounds={{ min: 0.3, max: 3 }}   step={0.1} allowedModes={['fixed', 'range', 'incremental']} />
            </div>
          )}
          {pattern === 3 && (
            <div className="space-y-4">
              <StyledModeField_v2 label="Arc Sweep" config={patternCfg('arcSweep', 135)} onChange={(cfg) => setPatternCfg('arcSweep', cfg)} bounds={{ min: 30, max: 360 }} step={15} unit="°" allowedModes={['fixed', 'range', 'incremental']} />
            </div>
          )}
          {pattern === 2 && (
            <div className="space-y-4">
              <StyledModeField_v2 label="Organic Irregularity" config={patternCfg('organicJitter', 1)} onChange={(cfg) => setPatternCfg('organicJitter', cfg)} bounds={{ min: 0, max: 3 }} step={0.1} allowedModes={['fixed', 'range', 'incremental']} />
            </div>
          )}

          {pattern !== -1 && <div className="border-t border-slate-700 pt-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-300">Pattern Resample</Label>
                <p className="text-[10px] leading-tight text-slate-500">
                  Auto-picks how many anchor points the pattern needs. Point Count is bypassed.
                </p>
              </div>
              <Switch
                checked={s.patternResample ?? false}
                onCheckedChange={(checked) => setField({ patternResample: checked })}
              />
            </div>
            {(s.patternResample ?? false) && (() => {
              const SPACING = 15;
              const spread = s.spreadValue ?? (s.spreadRange ? (s.spreadRange[0] + s.spreadRange[1]) / 2 : 80);
              let autoCount: number;
              if (pattern === 1) {
                const freq = s.waveFrequency ?? 1;
                autoCount = Math.max(4, Math.ceil(freq * spread * 1.5 / SPACING));
              } else if (pattern === 0) {
                const turns = s.spiralTurns ?? 2.5;
                autoCount = Math.max(6, Math.ceil(turns * 2 * Math.PI * spread / SPACING));
              } else if (pattern === 3) {
                const sweepDeg = s.arcSweep ?? 135;
                autoCount = Math.max(3, Math.ceil((sweepDeg / 360) * 2 * Math.PI * spread / SPACING));
              } else {
                autoCount = 20;
              }
              autoCount = Math.max(2, Math.min(200, autoCount));
              const isManual = s.patternResampleManual ?? false;
              const resampleMode = s.patternResampleAmountMode ?? 'fixed';
              const resampleConfig: any = resampleMode === 'range'
                ? { kind: 'range', min: s.patternResampleAmountRange?.[0] ?? autoCount, max: s.patternResampleAmountRange?.[1] ?? autoCount * 2 }
                : { kind: 'fixed', value: isManual ? (s.patternResampleAmountValue ?? autoCount) : autoCount };
              return (
                <div className="space-y-3 pl-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Label className={`text-xs ${isManual ? 'text-slate-300' : 'text-slate-400'}`}>Resample Amount</Label>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                        {isManual ? 'Manual' : `Auto ≈ ${autoCount}`}
                      </span>
                    </div>
                    <Switch
                      checked={isManual}
                      onCheckedChange={(checked) => setField({ patternResampleManual: checked })}
                      className="scale-[0.8]"
                    />
                  </div>
                  <div className={!isManual ? 'opacity-40 pointer-events-none' : ''}>
                    <StyledModeField
                      label=""
                      config={resampleConfig}
                      onChange={(config: any) => {
                        if (config.kind === 'fixed') setField({ patternResampleAmountMode: 'fixed', patternResampleAmountValue: Math.round(config.value) });
                        else if (config.kind === 'range') setField({ patternResampleAmountMode: 'range', patternResampleAmountRange: [Math.round(config.min), Math.round(config.max)] });
                      }}
                      bounds={{ min: 2, max: 200 }}
                      step={1}
                      allowedModes={['fixed', 'range']}
                    />
                  </div>
                </div>
              );
            })()}
          </div>}
        </div>
      );
    };

    const renderCurveDirectionFields = (curveType: 'bezier' | 'smooth-spline' | 'cubic') => {
      const s = (scatterSettings.shapeSpecific[curveType] as any) || {};
      const dirMode = s.curveDirectionMode ?? 'fixed';
      const dirStep = s.curveDirectionStep ?? 1;
      const dirAngle = s.curveDirectionAngle ?? 0;
      const dirMin = s.curveDirectionMin ?? -45;
      const dirMax = s.curveDirectionMax ?? 45;
      const setField = (patch: any) => {
        onUpdateScatterSettings({
          shapeSpecific: {
            ...scatterSettings.shapeSpecific,
            [curveType]: { ...((scatterSettings.shapeSpecific[curveType] as any) || {}), ...patch }
          }
        });
      };
      const flipSign = () => {
        if (dirMode === 'range') {
          setField({ curveDirectionMin: -dirMax, curveDirectionMax: -dirMin });
        } else {
          setField({ curveDirectionAngle: -dirAngle });
        }
      };
      return (
        <div className="space-y-4">
          <Label className="text-xs text-slate-400">Curve Direction</Label>
          <div className="flex items-center space-x-2">
            <Label className="text-slate-300 text-xs">Mode:</Label>
            <Select value={dirMode} onValueChange={(v) => setField({ curveDirectionMode: v })}>
              <SelectTrigger className="w-24 h-8 bg-slate-700 border-slate-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={{ zIndex: 10002 }}>
                <SelectItem value="fixed">Constant</SelectItem>
                <SelectItem value="range">Range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            {[1, 5, 15, 30, 45, 90].map(step => (
              <button key={step} type="button"
                onClick={() => setField({ curveDirectionStep: step })}
                className={`flex-1 py-1 text-xs rounded ${dirStep === step ? 'bg-slate-500 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                {step}
              </button>
            ))}
            <div className="w-2" />
            <button type="button" onClick={flipSign}
              title={dirMode === 'range' ? 'Flip and swap min/max' : 'Flip sign'}
              className="h-7 w-7 flex items-center justify-center text-slate-300 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded text-sm">
              ±
            </button>
          </div>
          {dirMode !== 'range' ? (
            <div className="space-y-4">
              <Label className="text-xs text-slate-300">Angle</Label>
              <BufferedSlider
                value={[dirAngle]}
                onValueCommit={([v]) => setField({ curveDirectionAngle: v })}
                min={-180} max={180} step={dirStep}
                className="w-full"
              />
              <NumericInput
                value={dirAngle}
                onChange={(v) => setField({ curveDirectionAngle: Math.max(-180, Math.min(180, v)) })}
                min={-180} max={180} step={dirStep}
                className="h-9 w-full bg-slate-700 border-slate-600 text-slate-300 show-spinners"
              />
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <Label className="text-xs text-slate-300">Min</Label>
                <BufferedSlider
                  value={[dirMin]}
                  onValueCommit={([v]) => setField({ curveDirectionMin: v })}
                  min={-180} max={180} step={dirStep}
                  className="w-full"
                />
                <NumericInput
                  value={dirMin}
                  onChange={(v) => setField({ curveDirectionMin: Math.max(-180, Math.min(180, v)) })}
                  min={-180} max={180} step={dirStep}
                  className="h-9 w-full bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                />
              </div>
              <div className="space-y-4">
                <Label className="text-xs text-slate-300">Max</Label>
                <BufferedSlider
                  value={[dirMax]}
                  onValueCommit={([v]) => setField({ curveDirectionMax: v })}
                  min={-180} max={180} step={dirStep}
                  className="w-full"
                />
                <NumericInput
                  value={dirMax}
                  onChange={(v) => setField({ curveDirectionMax: Math.max(-180, Math.min(180, v)) })}
                  min={-180} max={180} step={dirStep}
                  className="h-9 w-full bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                />
              </div>
            </>
          )}
        </div>
      );
    };

    const curveInfoContent = (
      <>
        <p><span className="text-slate-100 font-medium">Point Count</span> — how many anchor points make up each curve. More points = more complex, wavier shapes.</p>
        <p><span className="text-slate-100 font-medium">Curvature</span> — how much the curve bends and wobbles between points. Higher = looser, more random; lower = tighter, calmer lines.</p>
        <p><span className="text-slate-100 font-medium">Curve Length</span> — scales the curve uniformly so its longest axis matches the target length. Both width and height grow or shrink together, keeping the curve's aspect ratio intact.</p>
        <p><span className="text-slate-100 font-medium">Curve Pattern</span> — the base shape the points follow:</p>
        <ul className="list-disc pl-4 space-y-2">
          <li><span className="text-slate-100">None</span> — straight line baseline; points are evenly spaced along the horizontal axis. Use Curvature and Tension to bend it, Direction to rotate it.</li>
          <li><span className="text-slate-100">Spiral</span> — points wind outward. <em>Turns</em> sets how many loops; <em>Tightness</em> packs them toward the center or spreads them evenly.</li>
          <li><span className="text-slate-100">Wave</span> — a flowing S-curve. <em>Height</em> is how tall the waves are, <em>Frequency</em> how many waves fit across, <em>Phase</em> shifts where the wave starts.</li>
          <li><span className="text-slate-100">Organic</span> — natural, scattered points. <em>Irregularity</em> controls how random they are.</li>
          <li><span className="text-slate-100">Arc</span> — a curved segment. <em>Sweep</em> is how many degrees of the arc to draw.</li>
        </ul>
        <p><span className="text-slate-100 font-medium">Curve Direction</span> — rotates the entire generated point cloud around its centroid before handles are computed, so tangents align with the rotated shape. Fixed mode sets a single angle; Range mode picks a random angle per curve between Min and Max. The Step buttons snap both the slider and spinner to common angle increments. The ± button flips the sign (Fixed) or mirrors and swaps the range.</p>
        <p><span className="text-slate-100 font-medium">Open/Closed</span> — the chance a curve stays an open line versus joining back into a closed loop.</p>
        <p><span className="text-slate-100 font-medium">Stroke Cap</span> — how open line ends look: round, square (extends past the end), or butt (flat at the end).</p>
      </>
    );

    switch (shapeType) {
      case 'polygon':
        return (
          <div className="relative space-y-4 p-3 bg-slate-800/30 rounded border border-slate-600">
            <ShapeSettingsInfo title="Polygon">
              <p><span className="text-slate-100 font-medium">Edge Count</span> — the number of straight sides on the polygon. 3 makes triangles, 4 squares, 5 pentagons, and so on up to 20.</p>
            </ShapeSettingsInfo>
            <StyledModeField
              label="Edge Count"
              config={convertScatterToModeConfig('polygon', 'edgeCount', scatterSettings, [3, 20])}
              onChange={(config) => handleScatterModeConfigChange('polygon', 'edgeCount', config, scatterSettings, onUpdateScatterSettings)}
              bounds={{ min: 3, max: 20 }}
              step={1}
              allowedModes={['fixed', 'range']}
            />
          </div>
        );
      
      case 'line-vector':
        const lineVectorConfig = { 
          ...getDefaultLineVectorConfig(), 
          ...(scatterSettings.shapeSpecific['line-vector'] || {}) 
        };
        return (
          <div className="relative space-y-4 p-3 bg-slate-800/30 rounded border border-slate-600">
            <ShapeSettingsInfo title="Line Vector">
              <p><span className="text-slate-100 font-medium">Direction</span> — the angle (0–360°) each line points in.</p>
              <p><span className="text-slate-100 font-medium">Length</span> — how long each line is, in pixels.</p>
              <p><span className="text-slate-100 font-medium">Centroid</span> — where the line balances around its anchor point: 0 starts the line at the point, 0.5 centers it, 1 ends it there.</p>
              <p><span className="text-slate-100 font-medium">Stroke Cap Probabilities</span> — the chance each line end is drawn round, square (extends past the end), or butt (flat). Values are weights that set how often each style is picked.</p>
            </ShapeSettingsInfo>
            <StyledModeField
              label="Direction"
              config={convertLineVectorToModeConfig(lineVectorConfig.direction)}
              onChange={(modeConfig) => {
                handleLineVectorModeConfigChange('direction', modeConfig, scatterSettings, onUpdateScatterSettings);
              }}
              bounds={{ min: 0, max: 360 }}
              unit="°"
              step={15}
            />
            
            <Separator className="bg-slate-600" />
            
            <StyledModeField
              label="Length"
              config={convertLineVectorToModeConfig(lineVectorConfig.length)}
              onChange={(modeConfig) => {
                handleLineVectorModeConfigChange('length', modeConfig, scatterSettings, onUpdateScatterSettings);
              }}
              bounds={{ min: 0, max: 500 }}
              unit="px"
              step={5}
            />
            
            <Separator className="bg-slate-600" />
            
            <StyledModeField
              label="Centroid"
              config={convertLineVectorToModeConfig(lineVectorConfig.centroid)}
              onChange={(modeConfig) => {
                handleLineVectorModeConfigChange('centroid', modeConfig, scatterSettings, onUpdateScatterSettings);
              }}
              bounds={{ min: 0, max: 1 }}
              step={0.01}
            />
            
            <Separator className="bg-slate-600" />
            
            <div className="space-y-3">
              <Label className="text-xs text-slate-400">Stroke Cap Probabilities (%)</Label>
              <div className="space-y-3">
                {['round', 'square', 'butt'].map((cap) => (
                  <div key={cap} className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 capitalize">{cap}</span>
                      <span className="text-slate-400">{(scatterSettings.shapeSpecific['line-vector']?.strokeCapProbabilities as any)?.[cap] || 0}%</span>
                    </div>
                    <BufferedSlider
                      value={[(scatterSettings.shapeSpecific['line-vector']?.strokeCapProbabilities as any)?.[cap] || 0]}
                      onValueCommit={(value) => {
                        const probability = value[0];
                        onUpdateScatterSettings({
                          shapeSpecific: {
                            ...scatterSettings.shapeSpecific,
                            'line-vector': { 
                              ...lineVectorConfig,
                              strokeCapProbabilities: {
                                round: cap === 'round' ? probability : (scatterSettings.shapeSpecific['line-vector']?.strokeCapProbabilities?.round || 0),
                                square: cap === 'square' ? probability : (scatterSettings.shapeSpecific['line-vector']?.strokeCapProbabilities?.square || 0),
                                butt: cap === 'butt' ? probability : (scatterSettings.shapeSpecific['line-vector']?.strokeCapProbabilities?.butt || 0)
                              }
                            }
                          }
                        });
                      }}
                      min={0}
                      max={100}
                      step={1}
                      className="w-full"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      
      case 'circle':
      case 'ellipse':
        return (
          <div className="space-y-4 p-3 bg-slate-800/30 rounded border border-slate-600">
            <StyledModeField
              label="Point Count"
              config={convertScatterToModeConfig(shapeType, 'segmentCount', scatterSettings, [16, 32])}
              onChange={(config) => handleScatterModeConfigChange(shapeType, 'segmentCount', config, scatterSettings, onUpdateScatterSettings)}
              bounds={{ min: 8, max: 64 }}
              step={1}
              allowedModes={['fixed', 'range']}
            />
          </div>
        );
      
      case 'bezier': {
        const bzSettings = (scatterSettings.shapeSpecific['bezier'] as any) || {};
        const bzBoundMin = bzSettings.pointCountBoundMin ?? 3;
        const bzBoundMax = bzSettings.pointCountBoundMax ?? 10;
        const bzPcConfig = convertScatterToModeConfig('bezier', 'pointCount', scatterSettings, [3, 6]);
        const updateBZ = (patch: Record<string, any>) => onUpdateScatterSettings({
          shapeSpecific: { ...scatterSettings.shapeSpecific, bezier: { ...bzSettings, ...patch } }
        });
        return (
          <div>
            <div className="flex items-center justify-end mb-2">
              <ShapeSettingsInfo title="Bezier Curve" containerClassName="">
                {curveInfoContent}
              </ShapeSettingsInfo>
            </div>

            <Accordion
              type="multiple"
              value={bezierAccordionSections}
              onValueChange={setBezierAccordionSections}
              className="space-y-2.5"
            >
              {/* ── CREATE ─────────────────────────────── */}
              <AccordionItem value="create" className="border border-slate-600 rounded-md">
                <AccordionTrigger className="text-xs font-semibold text-slate-200 px-3 py-2.5 hover:no-underline bg-slate-700/60 hover:bg-slate-700/80">
                  Create
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-3 pb-3 px-2">
                  <StyledModeField
                    label="Point Count"
                    config={bzPcConfig}
                    onChange={(config) => handleScatterModeConfigChange('bezier', 'pointCount', config, scatterSettings, onUpdateScatterSettings)}
                    bounds={{ min: bzBoundMin, max: bzBoundMax }}
                    step={1}
                    allowedModes={['fixed', 'range', 'incremental']}
                  />
                  {bzPcConfig.kind === 'range' && (
                    <div className="space-y-4">
                      <Label className="text-xs text-slate-400">Point Count Range Bounds</Label>
                      <BufferedRangeSlider
                        value={[bzBoundMin, bzBoundMax]}
                        onValueCommit={([min, max]) => {
                          const range = bzSettings.pointCountRange as [number, number] | undefined;
                          const patch: Record<string, any> = { pointCountBoundMin: min, pointCountBoundMax: max };
                          if (range) patch.pointCountRange = [Math.max(min, Math.min(range[0], max)), Math.max(min, Math.min(range[1], max))];
                          updateBZ(patch);
                        }}
                        min={2}
                        max={100}
                        step={1}
                        className="w-full"
                      />
                      <div className="flex space-x-2">
                        <NumericInput
                          value={bzBoundMin}
                          onChange={(min) => {
                            const newMin = Math.max(2, Math.min(min, bzBoundMax));
                            const range = bzSettings.pointCountRange as [number, number] | undefined;
                            const patch: Record<string, any> = { pointCountBoundMin: newMin };
                            if (range) patch.pointCountRange = [Math.max(newMin, range[0]), Math.max(newMin, range[1])];
                            updateBZ(patch);
                          }}
                          min={2}
                          max={bzBoundMax}
                          step={1}
                          className="flex-1 h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                          data-testid="input-bezier-point-count-bound-min"
                        />
                        <NumericInput
                          value={bzBoundMax}
                          onChange={(max) => {
                            const newMax = Math.max(bzBoundMin, max);
                            const range = bzSettings.pointCountRange as [number, number] | undefined;
                            const patch: Record<string, any> = { pointCountBoundMax: newMax };
                            if (range) patch.pointCountRange = [Math.min(newMax, range[0]), Math.min(newMax, range[1])];
                            updateBZ(patch);
                          }}
                          min={bzBoundMin}
                          max={100}
                          step={1}
                          className="flex-1 h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                          data-testid="input-bezier-point-count-bound-max"
                        />
                      </div>
                    </div>
                  )}

                  <Separator className="bg-slate-700" />

                  <StyledModeField
                    label="Curve Length"
                    config={convertScatterToModeConfig('bezier', 'curveLength', scatterSettings, [80, 200])}
                    onChange={(config) => handleScatterModeConfigChange('bezier', 'curveLength', config, scatterSettings, onUpdateScatterSettings)}
                    bounds={{ min: 0, max: 2000 }}
                    step={10}
                    unit="px"
                    allowedModes={['fixed', 'range', 'incremental']}
                  />

                  <Separator className="bg-slate-700" />

                  {renderCurveDirectionFields('bezier')}

                </AccordionContent>
              </AccordionItem>

              {/* ── SHAPE ──────────────────────────────── */}
              <AccordionItem value="jitter" className="border border-slate-600 rounded-md">
                <AccordionTrigger className="text-xs font-semibold text-slate-200 px-3 py-2.5 hover:no-underline bg-slate-700/60 hover:bg-slate-700/80">
                  Shape
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-3 pb-3 px-2">
                  <div className="space-y-3">
                    <p className="text-[10px] text-slate-500 leading-tight">How far the points randomly wander from the base pattern. 0% = a clean, exact pattern; higher = more wobble/randomness.</p>
                    <StyledModeField
                      label="Jitter"
                      config={convertScatterToModeConfig('bezier', 'curvature', scatterSettings, [20, 80])}
                      onChange={(config) => handleScatterModeConfigChange('bezier', 'curvature', config, scatterSettings, onUpdateScatterSettings)}
                      bounds={{ min: 0, max: 100 }}
                      step={1}
                      unit="%"
                      allowedModes={['fixed', 'range']}
                    />
                  </div>

                  <div className="space-y-3">
                    <Label className="text-xs text-slate-400">Jitter Direction</Label>
                    <Select
                      value={
                        (bzSettings?.jitterAlongNormal ?? false)
                          ? (bzSettings?.jitterDirection ?? 'both')
                          : 'scatter'
                      }
                      onValueChange={(value) =>
                        onUpdateScatterSettings({
                          shapeSpecific: {
                            ...scatterSettings.shapeSpecific,
                            bezier: {
                              ...bzSettings,
                              jitterAlongNormal: value !== 'scatter',
                              ...(value !== 'scatter' ? { jitterDirection: value } : {})
                            }
                          }
                        })
                      }
                    >
                      <SelectTrigger className="h-8 bg-slate-700 border-slate-600 text-slate-300">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent style={{ zIndex: 10002 }}>
                        <SelectItem value="scatter">Free scatter (default)</SelectItem>
                        <SelectItem value="both">Along curve — both sides (±)</SelectItem>
                        <SelectItem value="outward">Along curve — outward (away)</SelectItem>
                        <SelectItem value="inward">Along curve — inward (toward)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] leading-tight text-slate-500">
                      "Free scatter" jitters points randomly. The "Along curve" options push points perpendicular to the line — both sides, only outward, or only inward.
                    </p>
                  </div>

                  <Separator className="bg-slate-700" />

                  {renderCurvePatternFields('bezier')}
                </AccordionContent>
              </AccordionItem>

              {/* ── REFINE ─────────────────────────────── */}
              <AccordionItem value="refine" className="border border-slate-600 rounded-md">
                <AccordionTrigger className="text-xs font-semibold text-slate-200 px-3 py-2.5 hover:no-underline bg-slate-700/60 hover:bg-slate-700/80">
                  Refine
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-3 pb-3 px-2">
                  <div className="space-y-3">
                    <Label className="text-xs text-slate-400">Open/Closed Probability</Label>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Open: {bzSettings?.openProbability ?? 50}%</span>
                      <span className="text-slate-400">Closed: {100 - (bzSettings?.openProbability ?? 50)}%</span>
                    </div>
                    <BufferedSlider
                      value={[bzSettings?.openProbability ?? 50]}
                      onValueCommit={([value]) => onUpdateScatterSettings({ shapeSpecific: { ...scatterSettings.shapeSpecific, bezier: { ...bzSettings, openProbability: value } } })}
                      min={0} max={100} step={5} className="w-full"
                    />
                    <NumericInput
                      value={bzSettings?.openProbability ?? 50}
                      onChange={(v) => onUpdateScatterSettings({ shapeSpecific: { ...scatterSettings.shapeSpecific, bezier: { ...bzSettings, openProbability: Math.max(0, Math.min(100, v)) } } })}
                      min={0} max={100} step={5}
                      className="h-9 w-full bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                    />
                  </div>

                  <Separator className="bg-slate-700" />

                  <div className="space-y-3">
                    <Label className="text-xs text-slate-400">Close by Averaging Ends</Label>
                    <p className="text-[10px] text-slate-500 leading-tight">Chance a closed curve joins its ends at their averaged midpoint instead of a straight line.</p>
                    <BufferedSlider
                      value={[bzSettings?.closeAverageProbability ?? 0]}
                      onValueCommit={(value) => onUpdateScatterSettings({ shapeSpecific: { ...scatterSettings.shapeSpecific, bezier: { ...bzSettings, closeAverageProbability: value[0] } } })}
                      min={0} max={100} step={5} className="w-full"
                      data-testid="slider-bezier-close-average"
                    />
                    <NumericInput
                      value={bzSettings?.closeAverageProbability ?? 0}
                      onChange={(v) => onUpdateScatterSettings({ shapeSpecific: { ...scatterSettings.shapeSpecific, bezier: { ...bzSettings, closeAverageProbability: Math.max(0, Math.min(100, v)) } } })}
                      min={0} max={100} step={5}
                      className="h-9 w-full bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                    />
                  </div>

                  <div className="space-y-3">
                    <p className="text-[10px] text-slate-500 leading-tight">Higher = longer handles (curvier); lower = shorter handles (sharper corners).</p>
                    <StyledModeField
                      label="Curve Tension"
                      config={convertScatterToModeConfig('bezier', 'tension', scatterSettings, [30, 30])}
                      onChange={(config) => handleScatterModeConfigChange('bezier', 'tension', config, scatterSettings, onUpdateScatterSettings)}
                      bounds={{ min: 0, max: 100 }}
                      step={5}
                      unit="%"
                      allowedModes={['fixed', 'range']}
                    />
                  </div>

                  <Separator className="bg-slate-700" />

                  <div className="flex items-center justify-between">
                    <div className="flex-1 pr-2">
                      <Label className="text-xs text-slate-400">Continuous Endpoints (open curves)</Label>
                      <p className="text-[10px] text-slate-500 leading-tight">End handles flow with the curve instead of curling toward the next point.</p>
                    </div>
                    <Switch
                      checked={bzSettings?.endpointContinuous ?? false}
                      onCheckedChange={(checked) => updateBZ({ endpointContinuous: checked })}
                      data-testid="switch-bezier-endpoint-continuous"
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* ── STYLE ──────────────────────────────── */}
              <AccordionItem value="style" className="border border-slate-600 rounded-md">
                <AccordionTrigger className="text-xs font-semibold text-slate-200 px-3 py-2.5 hover:no-underline bg-slate-700/60 hover:bg-slate-700/80">
                  Style
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-3 pb-3 px-2">
                  <div className="space-y-3">
                    <Label className="text-xs text-slate-400">Stroke Cap Probability</Label>
                    <div className="space-y-4">
                      {['round', 'square', 'butt'].map((cap) => {
                        const currentValue = bzSettings?.strokeCapProbabilities?.[cap] ?? (cap === 'round' ? 50 : 25);
                        const setCap = (value: number) => {
                          const currentCaps = bzSettings?.strokeCapProbabilities ?? { round: 50, square: 25, butt: 25 };
                          onUpdateScatterSettings({ shapeSpecific: { ...scatterSettings.shapeSpecific, bezier: { ...bzSettings, strokeCapProbabilities: { ...currentCaps, [cap]: value } } } });
                        };
                        return (
                          <div key={cap} className="space-y-3">
                            <Label className="text-xs text-slate-300 capitalize">{cap}</Label>
                            <BufferedSlider value={[currentValue]} onValueCommit={([v]) => setCap(v)} min={0} max={100} step={5} className="w-full" />
                            <NumericInput value={currentValue} onChange={(v) => setCap(Math.max(0, Math.min(100, v)))} min={0} max={100} step={5} className="h-9 w-full bg-slate-700 border-slate-600 text-slate-300 show-spinners" />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div className="mt-1.5 border border-slate-600 rounded-md flex items-center justify-between px-3 py-2.5 bg-slate-700/60">
              <Label className="text-xs text-slate-400">Debug Overlay (points &amp; handles)</Label>
              <Switch
                checked={bzSettings?.debugOverlay ?? false}
                onCheckedChange={(checked) => {
                  onUpdateScatterSettings({
                    shapeSpecific: {
                      ...scatterSettings.shapeSpecific,
                      bezier: { ...bzSettings, debugOverlay: checked }
                    }
                  });
                }}
                data-testid="switch-bezier-debug-overlay"
              />
            </div>
          </div>
        );
      }

      case 'smooth-spline': {
        const bsSettings = (scatterSettings.shapeSpecific['smooth-spline'] as any) || {};
        const bsBoundMin = bsSettings.pointCountBoundMin ?? 3;
        const bsBoundMax = bsSettings.pointCountBoundMax ?? 10;
        const bsPcConfig = convertScatterToModeConfig('smooth-spline', 'pointCount', scatterSettings, [3, 6]);
        const updateBS = (patch: Record<string, any>) => onUpdateScatterSettings({
          shapeSpecific: { ...scatterSettings.shapeSpecific, 'smooth-spline': { ...bsSettings, ...patch } }
        });
        return (
          <div>
            <div className="flex items-center justify-end mb-2">
              <ShapeSettingsInfo title="Smooth Spline" containerClassName="">
                {curveInfoContent}
              </ShapeSettingsInfo>
            </div>
            <Accordion
              type="multiple"
              value={smoothSplineAccordionSections}
              onValueChange={setSmoothSplineAccordionSections}
              className="space-y-2.5"
            >
              {/* ── CREATE ─────────────────────────────── */}
              <AccordionItem value="create" className="border border-slate-600 rounded-md">
                <AccordionTrigger className="text-xs font-semibold text-slate-200 px-3 py-2.5 hover:no-underline bg-slate-700/60 hover:bg-slate-700/80">
                  Create
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-3 pb-3 px-2">
                  <StyledModeField
                    label="Point Count"
                    config={bsPcConfig}
                    onChange={(config) => handleScatterModeConfigChange('smooth-spline', 'pointCount', config, scatterSettings, onUpdateScatterSettings)}
                    bounds={{ min: bsBoundMin, max: bsBoundMax }}
                    step={1}
                    allowedModes={['fixed', 'range', 'incremental']}
                  />
                  {bsPcConfig.kind === 'range' && (
                    <div className="space-y-4">
                      <Label className="text-xs text-slate-400">Point Count Range Bounds</Label>
                      <BufferedRangeSlider
                        value={[bsBoundMin, bsBoundMax]}
                        onValueCommit={([min, max]) => {
                          const range = bsSettings.pointCountRange as [number, number] | undefined;
                          const patch: Record<string, any> = { pointCountBoundMin: min, pointCountBoundMax: max };
                          if (range) patch.pointCountRange = [Math.max(min, Math.min(range[0], max)), Math.max(min, Math.min(range[1], max))];
                          updateBS(patch);
                        }}
                        min={2}
                        max={100}
                        step={1}
                        className="w-full"
                      />
                      <div className="flex space-x-2">
                        <NumericInput
                          value={bsBoundMin}
                          onChange={(min) => {
                            const newMin = Math.max(2, Math.min(min, bsBoundMax));
                            const range = bsSettings.pointCountRange as [number, number] | undefined;
                            const patch: Record<string, any> = { pointCountBoundMin: newMin };
                            if (range) patch.pointCountRange = [Math.max(newMin, range[0]), Math.max(newMin, range[1])];
                            updateBS(patch);
                          }}
                          min={2}
                          max={bsBoundMax}
                          step={1}
                          className="flex-1 h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                          data-testid="input-smooth-spline-point-count-bound-min"
                        />
                        <NumericInput
                          value={bsBoundMax}
                          onChange={(max) => {
                            const newMax = Math.max(bsBoundMin, max);
                            const range = bsSettings.pointCountRange as [number, number] | undefined;
                            const patch: Record<string, any> = { pointCountBoundMax: newMax };
                            if (range) patch.pointCountRange = [Math.min(newMax, range[0]), Math.min(newMax, range[1])];
                            updateBS(patch);
                          }}
                          min={bsBoundMin}
                          max={100}
                          step={1}
                          className="flex-1 h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                          data-testid="input-smooth-spline-point-count-bound-max"
                        />
                      </div>
                    </div>
                  )}

                  <Separator className="bg-slate-700" />

                  <StyledModeField
                    label="Curve Length"
                    config={convertScatterToModeConfig('smooth-spline', 'curveLength', scatterSettings, [80, 200])}
                    onChange={(config) => handleScatterModeConfigChange('smooth-spline', 'curveLength', config, scatterSettings, onUpdateScatterSettings)}
                    bounds={{ min: 0, max: 2000 }}
                    step={10}
                    unit="px"
                    allowedModes={['fixed', 'range', 'incremental']}
                  />

                  <Separator className="bg-slate-700" />

                  {renderCurveDirectionFields('smooth-spline')}
                </AccordionContent>
              </AccordionItem>

              {/* ── SHAPE ──────────────────────────────── */}
              <AccordionItem value="jitter" className="border border-slate-600 rounded-md">
                <AccordionTrigger className="text-xs font-semibold text-slate-200 px-3 py-2.5 hover:no-underline bg-slate-700/60 hover:bg-slate-700/80">
                  Shape
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-3 pb-3 px-2">
                  <div className="space-y-3">
                    <p className="text-[10px] text-slate-500 leading-tight">How far the points randomly wander from the base pattern. 0% = a clean, exact pattern; higher = more wobble/randomness.</p>
                    <StyledModeField
                      label="Jitter"
                      config={convertScatterToModeConfig('smooth-spline', 'curvature', scatterSettings, [20, 80])}
                      onChange={(config) => handleScatterModeConfigChange('smooth-spline', 'curvature', config, scatterSettings, onUpdateScatterSettings)}
                      bounds={{ min: 0, max: 100 }}
                      step={1}
                      unit="%"
                      allowedModes={['fixed', 'range']}
                    />
                  </div>

                  <div className="space-y-3">
                    <Label className="text-xs text-slate-400">Jitter Direction</Label>
                    <Select
                      value={
                        (bsSettings?.jitterAlongNormal ?? false)
                          ? (bsSettings?.jitterDirection ?? 'both')
                          : 'scatter'
                      }
                      onValueChange={(value) =>
                        updateBS({
                          jitterAlongNormal: value !== 'scatter',
                          ...(value !== 'scatter' ? { jitterDirection: value } : {})
                        })
                      }
                    >
                      <SelectTrigger className="h-8 bg-slate-700 border-slate-600 text-slate-300">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent style={{ zIndex: 10002 }}>
                        <SelectItem value="scatter">Free scatter (default)</SelectItem>
                        <SelectItem value="both">Along curve — both sides (±)</SelectItem>
                        <SelectItem value="outward">Along curve — outward (away)</SelectItem>
                        <SelectItem value="inward">Along curve — inward (toward)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] leading-tight text-slate-500">
                      "Free scatter" jitters points randomly. The "Along curve" options push points perpendicular to the line — both sides, only outward, or only inward.
                    </p>
                  </div>

                  <Separator className="bg-slate-700" />

                  {renderCurvePatternFields('smooth-spline')}
                </AccordionContent>
              </AccordionItem>

              {/* ── REFINE ─────────────────────────────── */}
              <AccordionItem value="refine" className="border border-slate-600 rounded-md">
                <AccordionTrigger className="text-xs font-semibold text-slate-200 px-3 py-2.5 hover:no-underline bg-slate-700/60 hover:bg-slate-700/80">
                  Refine
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-3 pb-3 px-2">
                  <div className="space-y-3">
                    <Label className="text-xs text-slate-400">Open/Closed Probability</Label>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Open: {bsSettings?.openProbability ?? 50}%</span>
                      <span className="text-slate-400">Closed: {100 - (bsSettings?.openProbability ?? 50)}%</span>
                    </div>
                    <BufferedSlider
                      value={[bsSettings?.openProbability ?? 50]}
                      onValueCommit={([value]) => updateBS({ openProbability: value })}
                      min={0} max={100} step={5} className="w-full"
                    />
                    <NumericInput
                      value={bsSettings?.openProbability ?? 50}
                      onChange={(v) => updateBS({ openProbability: Math.max(0, Math.min(100, v)) })}
                      min={0} max={100} step={5}
                      className="h-9 w-full bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                    />
                  </div>

                  <Separator className="bg-slate-700" />

                  <div className="space-y-3">
                    <Label className="text-xs text-slate-400">Close by Averaging Ends</Label>
                    <p className="text-[10px] text-slate-500 leading-tight">Chance a closed curve joins its ends at their averaged midpoint instead of a straight line.</p>
                    <BufferedSlider
                      value={[bsSettings?.closeAverageProbability ?? 0]}
                      onValueCommit={(value) => updateBS({ closeAverageProbability: value[0] })}
                      min={0} max={100} step={5} className="w-full"
                      data-testid="slider-smooth-spline-close-average"
                    />
                    <NumericInput
                      value={bsSettings?.closeAverageProbability ?? 0}
                      onChange={(v) => updateBS({ closeAverageProbability: Math.max(0, Math.min(100, v)) })}
                      min={0} max={100} step={5}
                      className="h-9 w-full bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* ── STYLE ──────────────────────────────── */}
              <AccordionItem value="style" className="border border-slate-600 rounded-md">
                <AccordionTrigger className="text-xs font-semibold text-slate-200 px-3 py-2.5 hover:no-underline bg-slate-700/60 hover:bg-slate-700/80">
                  Style
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-3 pb-3 px-2">
                  <div className="space-y-3">
                    <Label className="text-xs text-slate-400">Stroke Cap Probability</Label>
                    <div className="space-y-4">
                      {['round', 'square', 'butt'].map((cap) => {
                        const currentValue = bsSettings?.strokeCapProbabilities?.[cap] ?? (cap === 'round' ? 50 : 25);
                        const setCap = (value: number) => {
                          const currentCaps = bsSettings?.strokeCapProbabilities ?? { round: 50, square: 25, butt: 25 };
                          updateBS({ strokeCapProbabilities: { ...currentCaps, [cap]: value } });
                        };
                        return (
                          <div key={cap} className="space-y-3">
                            <Label className="text-xs text-slate-300 capitalize">{cap}</Label>
                            <BufferedSlider value={[currentValue]} onValueCommit={([v]) => setCap(v)} min={0} max={100} step={5} className="w-full" />
                            <NumericInput value={currentValue} onChange={(v) => setCap(Math.max(0, Math.min(100, v)))} min={0} max={100} step={5} className="h-9 w-full bg-slate-700 border-slate-600 text-slate-300 show-spinners" />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div className="mt-1.5 border border-slate-600 rounded-md flex items-center justify-between px-3 py-2.5 bg-slate-700/60">
              <Label className="text-xs text-slate-400">Debug Overlay (points &amp; handles)</Label>
              <Switch
                checked={bsSettings?.debugOverlay ?? false}
                onCheckedChange={(checked) => updateBS({ debugOverlay: checked })}
                data-testid="switch-smooth-spline-debug-overlay"
              />
            </div>
          </div>
        );
      }

      case 'star':
        return (
          <div className="relative space-y-4 p-3 bg-slate-800/30 rounded border border-slate-600">
            <ShapeSettingsInfo title="Star">
              <p><span className="text-slate-100 font-medium">Point Count</span> — how many points the star has (5 = classic star, higher = more spiky).</p>
              <p><span className="text-slate-100 font-medium">Inner Radius</span> — how deep the notches between points cut in, as a percent of the star's size. Low values make thin, spiky stars; high values make plump, gentle ones.</p>
            </ShapeSettingsInfo>
            <StyledModeField
              label="Point Count"
              config={convertScatterToModeConfig('star', 'pointCount', scatterSettings, [5, 8])}
              onChange={(config) => handleScatterModeConfigChange('star', 'pointCount', config, scatterSettings, onUpdateScatterSettings)}
              bounds={{ min: 5, max: 12 }}
              step={1}
              allowedModes={['fixed', 'range']}
            />
            
            <Separator className="bg-slate-600" />
            
            <StyledModeField
              label="Inner Radius"
              config={convertScatterToModeConfig('star', 'innerRadius', scatterSettings, [30, 70])}
              onChange={(config) => handleScatterModeConfigChange('star', 'innerRadius', config, scatterSettings, onUpdateScatterSettings)}
              bounds={{ min: 10, max: 90 }}
              step={1}
              unit="%"
              allowedModes={['fixed', 'range']}
            />
          </div>
        );

      case 'ring':
        return (
          <div className="relative space-y-4 p-3 bg-slate-800/30 rounded border border-slate-600">
            <ShapeSettingsInfo title="Ring">
              <p><span className="text-slate-100 font-medium">Inner Radius</span> — the size of the hole in the middle, as a percent of the ring's outer size. Low = thick ring with a small hole; high = thin ring with a big hole.</p>
            </ShapeSettingsInfo>
            <StyledModeField
              label="Inner Radius"
              config={convertScatterToModeConfig('ring', 'innerRadius', scatterSettings, [20, 80])}
              onChange={(config) => handleScatterModeConfigChange('ring', 'innerRadius', config, scatterSettings, onUpdateScatterSettings)}
              bounds={{ min: 10, max: 90 }}
              step={1}
              unit="%"
              allowedModes={['fixed', 'range']}
            />
          </div>
        );

      case 'spline-ring':
        return (
          <div className="relative space-y-4 p-3 bg-slate-800/30 rounded border border-slate-600">
            <ShapeSettingsInfo title="Spline Ring">
              <p><span className="text-slate-100 font-medium">Inner Radius</span> — the size of the hole in the middle, as a percent of the ring's outer size. This ring uses smooth curved edges instead of straight segments.</p>
            </ShapeSettingsInfo>
            <StyledModeField
              label="Inner Radius"
              config={convertScatterToModeConfig('spline-ring', 'innerRadius', scatterSettings, [20, 80])}
              onChange={(config) => handleScatterModeConfigChange('spline-ring', 'innerRadius', config, scatterSettings, onUpdateScatterSettings)}
              bounds={{ min: 10, max: 90 }}
              step={1}
              unit="%"
              allowedModes={['fixed', 'range']}
            />
          </div>
        );

      case 'line':
        return (
          <div className="relative space-y-4 p-3 bg-slate-800/30 rounded border border-slate-600">
            <ShapeSettingsInfo title="Line">
              <p><span className="text-slate-100 font-medium">Point Count</span> — how many points the line bends through. 2 makes a straight line; more points make multi-segment, zig-zag lines.</p>
              <p><span className="text-slate-100 font-medium">Stroke Cap Probabilities</span> — the chance each line end is drawn round, square (extends past the end), or butt (flat). Values are weights that set how often each style is picked.</p>
            </ShapeSettingsInfo>
            <StyledModeField
              label="Point Count"
              config={convertScatterToModeConfig('line', 'pointCount', scatterSettings, [2, 4])}
              onChange={(config) => handleScatterModeConfigChange('line', 'pointCount', config, scatterSettings, onUpdateScatterSettings)}
              bounds={{ min: 2, max: 8 }}
              step={1}
              allowedModes={['fixed', 'range']}
            />
            <div className="space-y-3">
              <Label className="text-xs text-slate-400">Stroke Cap Probabilities (%)</Label>
              <div className="space-y-3">
                {['round', 'square', 'butt'].map((cap) => (
                  <div key={cap} className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 capitalize">{cap}</span>
                      <span className="text-slate-400">{(scatterSettings.shapeSpecific.line?.strokeCapProbabilities as any)?.[cap] || 0}%</span>
                    </div>
                    <BufferedSlider
                      value={[(scatterSettings.shapeSpecific.line?.strokeCapProbabilities as any)?.[cap] || 0]}
                      onValueCommit={(value) => {
                        const probability = value[0];
                        onUpdateScatterSettings({
                          shapeSpecific: {
                            ...scatterSettings.shapeSpecific,
                            line: { 
                              pointCountRange: scatterSettings.shapeSpecific.line?.pointCountRange || [2, 4] as [number, number],
                              strokeCapProbabilities: {
                                round: cap === 'round' ? probability : (scatterSettings.shapeSpecific.line?.strokeCapProbabilities?.round || 0),
                                square: cap === 'square' ? probability : (scatterSettings.shapeSpecific.line?.strokeCapProbabilities?.square || 0),
                                butt: cap === 'butt' ? probability : (scatterSettings.shapeSpecific.line?.strokeCapProbabilities?.butt || 0)
                              }
                            }
                          }
                        });
                      }}
                      min={0}
                      max={100}
                      step={1}
                      className="w-full"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      case 'rectangle':
        return null;
        
      case 'rounded-rectangle':
      case 'rounded-square':
        return (
          <div className="space-y-4 p-3 bg-slate-800/30 rounded border border-slate-600">
            <StyledModeField
              label="Corner Radius"
              config={convertScatterToModeConfig(shapeType, 'cornerRadius', scatterSettings, [0, 20])}
              onChange={(config) => handleScatterModeConfigChange(shapeType, 'cornerRadius', config, scatterSettings, onUpdateScatterSettings)}
              bounds={{ min: 0, max: 50 }}
              step={1}
              unit="px"
              allowedModes={['fixed', 'range']}
            />
          </div>
        );
        
      case 'cubic': {
        const cubicSettings = (scatterSettings.shapeSpecific.cubic as any) || {};
        const cbBoundMin = cubicSettings?.pointCountBoundMin ?? 3;
        const cbBoundMax = cubicSettings?.pointCountBoundMax ?? 24;
        const cbPcConfig = convertScatterToModeConfig('cubic', 'pointCount', scatterSettings, [3, 7]);
        const updateCubic = (patch: Record<string, any>) => onUpdateScatterSettings({
          shapeSpecific: {
            ...scatterSettings.shapeSpecific,
            cubic: { ...(scatterSettings.shapeSpecific.cubic as any), ...patch }
          }
        });
        return (
          <div>
            <div className="flex items-center justify-end mb-2">
              <ShapeSettingsInfo title="Cubic Curve" containerClassName="">
                {curveInfoContent}
              </ShapeSettingsInfo>
            </div>
            <Accordion
              type="multiple"
              value={cubicAccordionSections}
              onValueChange={setCubicAccordionSections}
              className="space-y-2.5"
            >
              {/* ── CREATE ─────────────────────────────── */}
              <AccordionItem value="create" className="border border-slate-600 rounded-md">
                <AccordionTrigger className="text-xs font-semibold text-slate-200 px-3 py-2.5 hover:no-underline bg-slate-700/60 hover:bg-slate-700/80">
                  Create
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-3 pb-3 px-2">
                  <StyledModeField
                    label="Point Count"
                    config={cbPcConfig}
                    onChange={(config) => handleScatterModeConfigChange('cubic', 'pointCount', config, scatterSettings, onUpdateScatterSettings)}
                    bounds={{ min: cbBoundMin, max: cbBoundMax }}
                    step={1}
                    allowedModes={['fixed', 'range', 'incremental']}
                  />
                  {cbPcConfig.kind === 'range' && (
                    <div className="space-y-4">
                      <Label className="text-xs text-slate-400">Point Count Range Bounds</Label>
                      <BufferedRangeSlider
                        value={[cbBoundMin, cbBoundMax]}
                        onValueCommit={([min, max]) => {
                          const range = cubicSettings?.pointCountRange as [number, number] | undefined;
                          const patch: Record<string, any> = { pointCountBoundMin: min, pointCountBoundMax: max };
                          if (range) patch.pointCountRange = [Math.max(min, Math.min(range[0], max)), Math.max(min, Math.min(range[1], max))];
                          updateCubic(patch);
                        }}
                        min={2}
                        max={100}
                        step={1}
                        className="w-full"
                      />
                      <div className="flex space-x-2">
                        <NumericInput
                          value={cbBoundMin}
                          onChange={(min) => {
                            const newMin = Math.max(2, Math.min(min, cbBoundMax));
                            const range = cubicSettings?.pointCountRange as [number, number] | undefined;
                            const patch: Record<string, any> = { pointCountBoundMin: newMin };
                            if (range) patch.pointCountRange = [Math.max(newMin, range[0]), Math.max(newMin, range[1])];
                            updateCubic(patch);
                          }}
                          min={2}
                          max={cbBoundMax}
                          step={1}
                          className="flex-1 h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                          data-testid="input-cubic-point-count-bound-min"
                        />
                        <NumericInput
                          value={cbBoundMax}
                          onChange={(max) => {
                            const newMax = Math.max(cbBoundMin, max);
                            const range = cubicSettings?.pointCountRange as [number, number] | undefined;
                            const patch: Record<string, any> = { pointCountBoundMax: newMax };
                            if (range) patch.pointCountRange = [Math.min(newMax, range[0]), Math.min(newMax, range[1])];
                            updateCubic(patch);
                          }}
                          min={cbBoundMin}
                          max={100}
                          step={1}
                          className="flex-1 h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                          data-testid="input-cubic-point-count-bound-max"
                        />
                      </div>
                    </div>
                  )}

                  <Separator className="bg-slate-700" />

                  <StyledModeField
                    label="Curve Length"
                    config={convertScatterToModeConfig('cubic', 'curveLength', scatterSettings, [80, 200])}
                    onChange={(config) => handleScatterModeConfigChange('cubic', 'curveLength', config, scatterSettings, onUpdateScatterSettings)}
                    bounds={{ min: 0, max: 2000 }}
                    step={10}
                    unit="px"
                    allowedModes={['fixed', 'range', 'incremental']}
                  />

                  <Separator className="bg-slate-700" />

                  {renderCurveDirectionFields('cubic')}
                </AccordionContent>
              </AccordionItem>

              {/* ── SHAPE ──────────────────────────────── */}
              <AccordionItem value="jitter" className="border border-slate-600 rounded-md">
                <AccordionTrigger className="text-xs font-semibold text-slate-200 px-3 py-2.5 hover:no-underline bg-slate-700/60 hover:bg-slate-700/80">
                  Shape
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-3 pb-3 px-2">
                  <div className="space-y-3">
                    <p className="text-[10px] text-slate-500 leading-tight">How far the points randomly wander from the base pattern. 0% = a clean, exact pattern; higher = more wobble/randomness.</p>
                    <StyledModeField
                      label="Jitter"
                      config={convertScatterToModeConfig('cubic', 'curvature', scatterSettings, [20, 80])}
                      onChange={(config) => handleScatterModeConfigChange('cubic', 'curvature', config, scatterSettings, onUpdateScatterSettings)}
                      bounds={{ min: 0, max: 100 }}
                      step={1}
                      unit="%"
                      allowedModes={['fixed', 'range']}
                    />
                  </div>

                  <div className="space-y-3">
                    <Label className="text-xs text-slate-400">Jitter Direction</Label>
                    <Select
                      value={
                        (cubicSettings?.jitterAlongNormal ?? false)
                          ? (cubicSettings?.jitterDirection ?? 'both')
                          : 'scatter'
                      }
                      onValueChange={(value) =>
                        updateCubic({
                          jitterAlongNormal: value !== 'scatter',
                          ...(value !== 'scatter' ? { jitterDirection: value } : {})
                        })
                      }
                    >
                      <SelectTrigger className="h-8 bg-slate-700 border-slate-600 text-slate-300">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent style={{ zIndex: 10002 }}>
                        <SelectItem value="scatter">Free scatter (default)</SelectItem>
                        <SelectItem value="both">Along curve — both sides (±)</SelectItem>
                        <SelectItem value="outward">Along curve — outward (away)</SelectItem>
                        <SelectItem value="inward">Along curve — inward (toward)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] leading-tight text-slate-500">
                      "Free scatter" jitters points randomly. The "Along curve" options push points perpendicular to the line — both sides, only outward, or only inward.
                    </p>
                  </div>

                  <Separator className="bg-slate-700" />

                  {renderCurvePatternFields('cubic')}
                </AccordionContent>
              </AccordionItem>

              {/* ── REFINE ─────────────────────────────── */}
              <AccordionItem value="refine" className="border border-slate-600 rounded-md">
                <AccordionTrigger className="text-xs font-semibold text-slate-200 px-3 py-2.5 hover:no-underline bg-slate-700/60 hover:bg-slate-700/80">
                  Refine
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-3 pb-3 px-2">
                  <div className="space-y-3">
                    <Label className="text-xs text-slate-400">Open/Closed Probability</Label>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Open: {cubicSettings?.openProbability ?? 85}%</span>
                      <span className="text-slate-400">Closed: {100 - (cubicSettings?.openProbability ?? 85)}%</span>
                    </div>
                    <BufferedSlider
                      value={[cubicSettings?.openProbability ?? 85]}
                      onValueCommit={([value]) => updateCubic({ openProbability: value })}
                      min={0} max={100} step={5} className="w-full"
                    />
                    <NumericInput
                      value={cubicSettings?.openProbability ?? 85}
                      onChange={(v) => updateCubic({ openProbability: Math.max(0, Math.min(100, v)) })}
                      min={0} max={100} step={5}
                      className="h-9 w-full bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                    />
                  </div>

                  <Separator className="bg-slate-700" />

                  <div className="space-y-3">
                    <Label className="text-xs text-slate-400">Close by Averaging Ends</Label>
                    <p className="text-[10px] text-slate-500 leading-tight">Chance a closed curve joins its ends at their averaged midpoint instead of a straight line.</p>
                    <BufferedSlider
                      value={[cubicSettings?.closeAverageProbability ?? 0]}
                      onValueCommit={(value) => updateCubic({ closeAverageProbability: value[0] })}
                      min={0} max={100} step={5} className="w-full"
                      data-testid="slider-cubic-close-average"
                    />
                    <NumericInput
                      value={cubicSettings?.closeAverageProbability ?? 0}
                      onChange={(v) => updateCubic({ closeAverageProbability: Math.max(0, Math.min(100, v)) })}
                      min={0} max={100} step={5}
                      className="h-9 w-full bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                    />
                  </div>

                  <Separator className="bg-slate-700" />

                  <div className="space-y-3">
                    <p className="text-[10px] text-slate-500 leading-tight">Higher = longer handles (curvier); lower = shorter handles (sharper corners).</p>
                    <StyledModeField
                      label="Curve Tension"
                      config={convertScatterToModeConfig('cubic', 'tension', scatterSettings, [30, 30])}
                      onChange={(config) => handleScatterModeConfigChange('cubic', 'tension', config, scatterSettings, onUpdateScatterSettings)}
                      bounds={{ min: 0, max: 100 }}
                      step={5}
                      unit="%"
                      allowedModes={['fixed', 'range']}
                    />
                  </div>

                  <Separator className="bg-slate-700" />

                  <div className="flex items-center justify-between">
                    <div className="flex-1 pr-2">
                      <Label className="text-xs text-slate-400">Continuous Endpoints (open curves)</Label>
                      <p className="text-[10px] text-slate-500 leading-tight">End handles flow with the curve instead of curling toward the next point.</p>
                    </div>
                    <Switch
                      checked={cubicSettings?.endpointContinuous ?? false}
                      onCheckedChange={(checked) => updateCubic({ endpointContinuous: checked })}
                      data-testid="switch-cubic-endpoint-continuous"
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* ── STYLE ──────────────────────────────── */}
              <AccordionItem value="style" className="border border-slate-600 rounded-md">
                <AccordionTrigger className="text-xs font-semibold text-slate-200 px-3 py-2.5 hover:no-underline bg-slate-700/60 hover:bg-slate-700/80">
                  Style
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-3 pb-3 px-2">
                  <div className="space-y-3">
                    <Label className="text-xs text-slate-400">Stroke Cap Probability</Label>
                    <div className="space-y-4">
                      {['round', 'square', 'butt'].map((cap) => {
                        const currentValue = cubicSettings?.strokeCapProbabilities?.[cap] ?? (cap === 'butt' ? 34 : 33);
                        const setCap = (value: number) => {
                          const currentCaps = cubicSettings?.strokeCapProbabilities ?? { round: 33, square: 33, butt: 34 };
                          updateCubic({ strokeCapProbabilities: { ...currentCaps, [cap]: value } });
                        };
                        return (
                          <div key={cap} className="space-y-3">
                            <Label className="text-xs text-slate-300 capitalize">{cap}</Label>
                            <BufferedSlider value={[currentValue]} onValueCommit={([v]) => setCap(v)} min={0} max={100} step={5} className="w-full" />
                            <NumericInput value={currentValue} onChange={(v) => setCap(Math.max(0, Math.min(100, v)))} min={0} max={100} step={5} className="h-9 w-full bg-slate-700 border-slate-600 text-slate-300 show-spinners" />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div className="mt-1.5 border border-slate-600 rounded-md flex items-center justify-between px-3 py-2.5 bg-slate-700/60">
              <Label className="text-xs text-slate-400">Debug Overlay (points &amp; handles)</Label>
              <Switch
                checked={cubicSettings?.debugOverlay ?? false}
                onCheckedChange={(checked) => updateCubic({ debugOverlay: checked })}
                data-testid="switch-cubic-debug-overlay"
              />
            </div>
          </div>
        );
      }

      case 'square':
        return null;

      default:
        return null;
    }
  }, [scatterSettings, onUpdateScatterSettings, bezierAccordionSections, setBezierAccordionSections, smoothSplineAccordionSections, setSmoothSplineAccordionSections, cubicAccordionSections, setCubicAccordionSections]);

  return (
    <div className="space-y-4">
      {/* Shape Types Section Card */}
      <div className="space-y-4 border border-slate-600 rounded-lg px-1.5 sm:px-3 py-3 bg-slate-800/50">
        <button type="button" onClick={() => toggleSection('shape-types')} className="flex items-center justify-between w-full bg-transparent border-0 p-0 cursor-pointer text-left">
          <span className="text-sm font-medium text-slate-200">Shape Types</span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-150 ${openSections.has('shape-types') ? 'rotate-180' : ''}`} />
        </button>
        {openSections.has('shape-types') && (
        <div className="space-y-4">
        {shapeSetsUI}
        {/* Internal accordion to control shape list visibility */}
      <Accordion 
        type="single" 
        collapsible 
        value={shapeListAccordionOpen} 
        onValueChange={setShapeListAccordionOpen}
        className="w-full"
      >
        <AccordionItem value="shape-list" className="border-0">
          <AccordionTrigger className="text-xs text-slate-400 hover:text-slate-300 py-2 hover:no-underline">
            <span>Shape List ({Object.keys(shapeTypeDisplayNames).length} types)</span>
          </AccordionTrigger>
          <AccordionContent className="pb-2">
            <div className="space-y-4">
              {/* Generation Control mode selector — only shown in sets mode */}
              {setsEnabled && currentSet && (
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-400">Selection</Label>
                  <Select
                    value={currentSet.shapeTypeGenMode ?? 'random'}
                    onValueChange={(v) => {
                      if (currentGenerationSetId && updateGenerationSetPartial) {
                        updateGenerationSetPartial(currentGenerationSetId, { shapeTypeGenMode: v as any });
                      }
                    }}
                  >
                    <SelectTrigger className="h-7 w-28 text-xs bg-slate-700 border-slate-600 text-slate-200 px-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
                      <SelectItem value="random" className="text-slate-200 hover:bg-slate-700 text-xs">Random</SelectItem>
                      <SelectItem value="weighted" className="text-slate-200 hover:bg-slate-700 text-xs">Weighted</SelectItem>
                      <SelectItem value="fixed" className="text-slate-200 hover:bg-slate-700 text-xs">Constant</SelectItem>
                      <SelectItem value="sequence" className="text-slate-200 hover:bg-slate-700 text-xs">Sequence</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {/* Fixed mode total count */}
              {setsEnabled && currentSet?.shapeTypeGenMode === 'fixed' && (
                <div className="text-xs text-slate-400">
                  Total: {fixedModeCount(
                    Array.from(enabledShapeTypes) as SupportedShapeType[],
                    currentSet.shapeTypeFixedCounts
                  )} shapes
                </div>
              )}
              {/* Weighted mode total weight summary */}
              {setsEnabled && currentSet?.shapeTypeGenMode === 'weighted' && (
                <div className="text-xs text-slate-400">
                  {(() => {
                    const enabledArr = Array.from(enabledShapeTypes) as SupportedShapeType[];
                    const total = enabledArr.reduce(
                      (sum, t) => sum + Math.max(0, currentSet.shapeTypeWeights?.[t] ?? 1), 0
                    );
                    return `Total weight: ${total}`;
                  })()}
                </div>
              )}
              {/* Nested accordion for shape categories */}
              <Accordion 
                type="multiple" 
                className="w-full"
                value={openShapeCategories}
                onValueChange={setOpenShapeCategories}
              >
                {Object.entries(SHAPE_CATEGORIES).map(([categoryName, categoryShapes]) => {
                  const enabledInCategory = categoryShapes.filter(shapeType => 
                    enabledShapeTypes.has(shapeType)
                  ).length;
                  
                  return (
                    <AccordionItem key={categoryName} value={categoryName} className="border-slate-700">
                      <AccordionTrigger className="text-xs text-slate-400 hover:text-slate-300 py-2 hover:no-underline">
                        <div className="flex items-center gap-2">
                          <span>{categoryName}</span>
                          <span className="text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded text-xs">
                            {enabledInCategory}/{categoryShapes.length}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-3 pt-2">
                        {categoryShapes.map((shapeType) => {
                          const displayName = shapeTypeDisplayNames[shapeType];
                          const isEnabled = enabledShapeTypes.has(shapeType);
                          const isExpanded = expandedShapes.has(shapeType);
                          const hasProperties = ['polygon', 'circle', 'ellipse', 'bezier', 'cubic', 'smooth-spline', 'star', 'ring', 'spline-ring', 'line', 'line-vector', 'rounded-rectangle', 'rounded-square'].includes(shapeType);

                          return (
                            <div key={shapeType} className="space-y-3">
                              {/* Shape Toggle Row */}
                              <div className={`flex items-center justify-between p-2 rounded-lg transition-colors ${
                                isEnabled ? 'bg-blue-900/30 border border-blue-500/50' : 'bg-slate-800/50 hover:bg-slate-700/50'
                              }`}>
                                {/* Left side: click to append to sequence when in sequence mode */}
                                <div
                                  className={`flex items-center space-x-3 ${setsEnabled && currentSet?.shapeTypeGenMode === 'sequence' && isEnabled ? 'cursor-pointer select-none' : ''}`}
                                  onClick={() => {
                                    if (!setsEnabled || currentSet?.shapeTypeGenMode !== 'sequence' || !isEnabled) return;
                                    if (!currentGenerationSetId || !updateGenerationSetPartial) return;
                                    updateGenerationSetPartial(currentGenerationSetId, {
                                      shapeTypeSequence: [...(currentSet.shapeTypeSequence ?? []), shapeType as SupportedShapeType]
                                    });
                                  }}
                                >
                                  <div className={`w-3 h-3 rounded transition-colors ${
                                    isEnabled ? 'bg-blue-400' : 'bg-slate-500'
                                  }`} />
                                  <Label className={`text-sm transition-colors ${
                                    isEnabled ? 'text-blue-200' : 'text-slate-300'
                                  } ${setsEnabled && currentSet?.shapeTypeGenMode === 'sequence' && isEnabled ? 'pointer-events-none' : ''}`}>{displayName}</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                  {/* Per-type weight or count input for gen control */}
                                  {setsEnabled && currentSet && isEnabled &&
                                    (currentSet.shapeTypeGenMode === 'weighted' || currentSet.shapeTypeGenMode === 'fixed') && (
                                    <input
                                      type="number"
                                      min={currentSet.shapeTypeGenMode === 'weighted' ? 0 : 1}
                                      max={currentSet.shapeTypeGenMode === 'weighted' ? 100 : 9999}
                                      value={currentSet.shapeTypeGenMode === 'weighted'
                                        ? (currentSet.shapeTypeWeights?.[shapeType as SupportedShapeType] ?? 1)
                                        : (currentSet.shapeTypeFixedCounts?.[shapeType as SupportedShapeType] ?? 1)}
                                      onChange={(e) => {
                                        if (!currentGenerationSetId || !updateGenerationSetPartial) return;
                                        const v = currentSet.shapeTypeGenMode === 'weighted'
                                          ? Math.max(0, Math.min(100, parseInt(e.target.value) || 0))
                                          : Math.max(1, parseInt(e.target.value) || 1);
                                        if (currentSet.shapeTypeGenMode === 'weighted') {
                                          updateGenerationSetPartial(currentGenerationSetId, {
                                            shapeTypeWeights: { ...currentSet.shapeTypeWeights, [shapeType]: v }
                                          });
                                        } else {
                                          updateGenerationSetPartial(currentGenerationSetId, {
                                            shapeTypeFixedCounts: { ...currentSet.shapeTypeFixedCounts, [shapeType]: v }
                                          });
                                        }
                                      }}
                                      className="w-12 h-6 text-xs text-center bg-slate-700 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-slate-400"
                                    />
                                  )}
                                  {/* Percentage label for weighted mode */}
                                  {setsEnabled && currentSet?.shapeTypeGenMode === 'weighted' && isEnabled && (
                                    <span className="text-xs text-slate-500 w-8 text-right tabular-nums">
                                      {(() => {
                                        const enabledArr = Array.from(enabledShapeTypes) as SupportedShapeType[];
                                        const totalW = enabledArr.reduce(
                                          (sum, t) => sum + Math.max(0, currentSet.shapeTypeWeights?.[t] ?? 1), 0
                                        );
                                        const w = Math.max(0, currentSet.shapeTypeWeights?.[shapeType as SupportedShapeType] ?? 1);
                                        return totalW > 0 ? `${Math.round((w / totalW) * 100)}%` : '0%';
                                      })()}
                                    </span>
                                  )}
                                  {isEnabled && hasProperties && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => toggleShapeExpansion(shapeType)}
                                      className="p-1 h-6 w-6 hover:bg-slate-700"
                                    >
                                      <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform ${
                                        isExpanded ? 'rotate-180' : ''
                                      }`} />
                                    </Button>
                                  )}
                                  <Switch
                                    checked={isEnabled}
                                    onCheckedChange={() => onToggleShapeType(shapeType)}
                                    className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-blue-900"
                                  />
                                </div>
                              </div>
                              
                              {/* Shape Properties (Accordion Content) */}
                              {isEnabled && isExpanded && hasProperties && (
                                <div>
                                  {getShapeProperties(shapeType)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>

              {/* Sequence builder — only shown in sequence mode */}
              {setsEnabled && currentSet?.shapeTypeGenMode === 'sequence' && (
                <div className="space-y-3 pt-1">
                  <Label className="text-xs text-slate-400">Click types above to build sequence</Label>
                  {/* Sequence grid */}
                  {(currentSet.shapeTypeSequence ?? []).length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No types added yet</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-4 gap-1 max-h-48 overflow-y-auto pr-0.5">
                        {(currentSet.shapeTypeSequence ?? []).map((type, i) => {
                          const displayName = shapeTypeDisplayNames[type as ShapeType] ?? type;
                          return (
                            <div
                              key={i}
                              draggable
                              title={`${i + 1}. ${displayName}`}
                              onDragStart={() => { seqDragIndexRef.current = i; }}
                              onDragOver={(e) => { e.preventDefault(); setSeqDragOver(i); }}
                              onDragLeave={() => setSeqDragOver(null)}
                              onDrop={(e) => {
                                e.preventDefault();
                                const from = seqDragIndexRef.current;
                                if (from === null || from === i || !currentGenerationSetId || !updateGenerationSetPartial) return;
                                const seq = [...(currentSet.shapeTypeSequence ?? [])];
                                const [moved] = seq.splice(from, 1);
                                seq.splice(i, 0, moved);
                                updateGenerationSetPartial(currentGenerationSetId, { shapeTypeSequence: seq });
                                seqDragIndexRef.current = null;
                                setSeqDragOver(null);
                              }}
                              onDragEnd={() => { seqDragIndexRef.current = null; setSeqDragOver(null); }}
                              className={`flex flex-col items-start px-1.5 pt-1 pb-1 rounded border cursor-grab active:cursor-grabbing transition-opacity select-none min-w-0
                                ${seqDragIndexRef.current === i ? 'opacity-40' : ''}
                                ${seqDragOver === i && seqDragIndexRef.current !== i ? 'bg-slate-600 border-cyan-500 ring-1 ring-cyan-500' : 'bg-slate-700 border-slate-600'}`}
                            >
                              <div className="flex items-center justify-between w-full min-w-0">
                                <span className="text-[9px] text-slate-500 font-mono leading-none shrink-0">{i + 1}</span>
                                <button
                                  type="button"
                                  aria-label="Remove"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!currentGenerationSetId || !updateGenerationSetPartial) return;
                                    const seq = [...(currentSet.shapeTypeSequence ?? [])];
                                    seq.splice(i, 1);
                                    updateGenerationSetPartial(currentGenerationSetId, { shapeTypeSequence: seq });
                                  }}
                                  className="text-slate-500 hover:text-slate-200 shrink-0 leading-none"
                                ><X size={8} /></button>
                              </div>
                              <span className="truncate text-[10px] text-slate-300 w-full min-w-0 leading-tight mt-0.5">{displayName}</span>
                            </div>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!currentGenerationSetId || !updateGenerationSetPartial) return;
                          updateGenerationSetPartial(currentGenerationSetId, { shapeTypeSequence: [] });
                        }}
                        className="text-xs text-slate-500 hover:text-slate-300 px-1"
                        title="Clear all"
                      >Clear all</button>
                    </div>
                  )}
                </div>
              )}

              {/* Separator inside accordion so it disappears when collapsed */}
              <Separator className="bg-slate-600" />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* All On/Off Buttons */}
      <div className="flex gap-2 py-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const allTypes = Object.keys(shapeTypeDisplayNames) as ShapeType[];
            allTypes.forEach(type => {
              if (!enabledShapeTypes.has(type)) {
                onToggleShapeType(type);
              }
            });
          }}
          className="flex-1 h-8 text-xs bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-slate-200"
        >
          All On
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const enabledTypes = Array.from(enabledShapeTypes);
            enabledTypes.forEach(type => {
              onToggleShapeType(type);
            });
          }}
          className="flex-1 h-8 text-xs bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-slate-200"
        >
          All Off
        </Button>
      </div>

      {/* Shape Count Settings — hidden in fixed gen mode (count is driven by per-type counts) */}
      {!(setsEnabled && currentSet?.shapeTypeGenMode === 'fixed') && (() => {
        const isGridActive = generationConfigSettings?.distributionLayoutEnabled &&
                             generationConfigSettings?.distributionPattern === 'grid';
        const gridFillEnabled = isGridActive && (generationConfigSettings?.gridFillEnabled ?? false);
        const isCornersMode = isGridActive &&
          generationConfigSettings?.cellConstraints?.enabled &&
          generationConfigSettings?.cellConstraints?.renderMode === 'cell-corners';
        const gridEffectiveRows = isCornersMode
          ? Math.max(1, generationConfigSettings!.gridRows) + 1
          : Math.max(1, generationConfigSettings!.gridRows);
        const gridEffectiveCols = isCornersMode
          ? Math.max(1, generationConfigSettings!.gridColumns) + 1
          : Math.max(1, generationConfigSettings!.gridColumns);
        const gridCellCount = isGridActive ? gridEffectiveRows * gridEffectiveCols : 0;
        return (
          <div className="space-y-3 pb-6">
            {/* Header row: label (+ override badge) + mode selector */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Label className={`text-xs ${gridFillEnabled ? 'text-slate-500' : 'text-slate-400'}`}>Shape Count</Label>
                {gridFillEnabled && (
                  <span className="text-[10px] text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded">
                    {gridCellCount} (grid)
                  </span>
                )}
              </div>
              {/* Mode selector — greyed when one-per-position overrides count */}
              <div className={gridFillEnabled ? 'opacity-40 pointer-events-none select-none' : ''}>
                <Select
                  value={scatterSettings.shapeCountMode || 'range'}
                  onValueChange={(value) => onUpdateScatterSettings({ shapeCountMode: value as 'range' | 'fixed' })}
                >
                  <SelectTrigger className="h-8 w-24 text-xs bg-slate-700 border-slate-600 text-slate-200 px-2 py-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
                    <SelectItem value="fixed" className="text-slate-200 hover:bg-slate-700">Constant</SelectItem>
                    <SelectItem value="range" className="text-slate-200 hover:bg-slate-700">Range</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Count slider — greyed when one-per-position is on; always shows the user's configured value */}
            <div className={gridFillEnabled ? 'opacity-40 pointer-events-none select-none' : ''}>
              {scatterSettings.shapeCountMode === 'range' ? (
                <BufferedRangeSliderWithNumericInputs
                  value={[scatterSettings.minCount, scatterSettings.maxCount] as [number, number]}
                  onValueCommit={([min, max]) => onUpdateScatterSettings({ minCount: min, maxCount: max })}
                  min={1}
                  max={50}
                  step={1}
                  minLabel="Min"
                  maxLabel="Max"
                />
              ) : (
                <BufferedSliderWithNumericInput
                  value={scatterSettings.fixedShapeCount || 10}
                  onValueCommit={(value) => onUpdateScatterSettings({ fixedShapeCount: value })}
                  min={1}
                  max={200}
                  step={1}
                  inputUnbounded={true}
                  sliderClassName="w-full pt-2"
                />
              )}
            </div>

            {/* One per position toggle — below the slider, only when grid distribution is active */}
            {isGridActive && (
              <div className="flex items-center justify-between pt-1.5">
                <Label className="text-xs text-slate-400">
                  One per position ({gridEffectiveRows}×{gridEffectiveCols} = {gridCellCount})
                </Label>
                <Switch
                  checked={gridFillEnabled}
                  onCheckedChange={(checked) => onUpdateGenerationConfigSettings({ gridFillEnabled: checked })}
                  className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-blue-900"
                />
              </div>
            )}
          </div>
        );
      })()}
        </div>
        )}
      </div>

      {/* Shape Rendering Section Card */}
      <div className="space-y-4 border border-slate-600 rounded-lg px-1.5 sm:px-3 py-3 bg-slate-800/50">
        <button type="button" onClick={() => toggleSection('shape-rendering')} className="flex items-center justify-between w-full bg-transparent border-0 p-0 cursor-pointer text-left">
          <span className="text-sm font-medium text-slate-200">Shape Rendering</span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-150 ${openSections.has('shape-rendering') ? 'rotate-180' : ''}`} />
        </button>
        {openSections.has('shape-rendering') && (
        <div className="space-y-4">
        {/* Render Mode Sub-Section */}
        <div className="border border-slate-600/60 rounded-lg px-2 py-2">
          <button type="button" onClick={() => toggleSection('render-mode')} className="flex items-center justify-between w-full bg-transparent border-0 p-0 cursor-pointer text-left">
            <span className="text-xs font-medium text-slate-300">Render Mode</span>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 ${openSections.has('render-mode') ? 'rotate-180' : ''}`} />
          </button>
          {openSections.has('render-mode') && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-slate-400">Render Mode</Label>
              <Switch
            checked={generationConfigSettings?.renderModeOverride?.enabled ?? false}
            onCheckedChange={(checked) => onUpdateGenerationConfigSettings({
              renderModeOverride: {
                tension: generationConfigSettings?.renderModeOverride?.tension ?? 1,
                passes: generationConfigSettings?.renderModeOverride?.passes ?? 1,
                smoothAlgorithm: generationConfigSettings?.renderModeOverride?.smoothAlgorithm ?? 'chaikin',
                catmullAlpha: generationConfigSettings?.renderModeOverride?.catmullAlpha ?? 0.5,
                naturalCubicClamped: generationConfigSettings?.renderModeOverride?.naturalCubicClamped ?? false,
                resample: generationConfigSettings?.renderModeOverride?.resample ?? { enabled: false, count: 32 },
                enabled: checked,
              }
            })}
          />
        </div>
        {(generationConfigSettings?.renderModeOverride?.enabled ?? false) && (
          <div className="space-y-4 pt-1">
            {/* Algorithm selector */}
            <div className="space-y-2">
              <Label className="text-xs text-slate-400">Algorithm</Label>
              <Select
                value={generationConfigSettings?.renderModeOverride?.smoothAlgorithm ?? 'chaikin'}
                onValueChange={(v: 'chaikin' | 'catmull-rom' | 'natural-cubic') => onUpdateGenerationConfigSettings({
                  renderModeOverride: {
                    enabled: true,
                    tension: generationConfigSettings?.renderModeOverride?.tension ?? 1,
                    passes: generationConfigSettings?.renderModeOverride?.passes ?? 1,
                    smoothAlgorithm: v,
                    catmullAlpha: generationConfigSettings?.renderModeOverride?.catmullAlpha ?? 0.5,
                    naturalCubicClamped: generationConfigSettings?.renderModeOverride?.naturalCubicClamped ?? false,
                    resample: generationConfigSettings?.renderModeOverride?.resample ?? { enabled: false, count: 32 },
                  }
                })}
              >
                <SelectTrigger className="h-7 text-xs bg-slate-700 border-slate-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chaikin">Chaikin</SelectItem>
                  <SelectItem value="catmull-rom">Catmull-Rom</SelectItem>
                  <SelectItem value="natural-cubic">Natural Cubic</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Tension slider + presets — Chaikin and Catmull-Rom */}
            {(generationConfigSettings?.renderModeOverride?.smoothAlgorithm ?? 'chaikin') !== 'natural-cubic' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] text-slate-500 px-0.5">
                <span>Sharp</span>
                <span>Smooth</span>
              </div>
              <BufferedSlider
                value={[generationConfigSettings?.renderModeOverride?.tension ?? 1]}
                onValueCommit={([value]) => onUpdateGenerationConfigSettings({
                  renderModeOverride: {
                    enabled: true,
                    smoothAlgorithm: generationConfigSettings?.renderModeOverride?.smoothAlgorithm ?? 'chaikin',
                    catmullAlpha: generationConfigSettings?.renderModeOverride?.catmullAlpha ?? 0.5,
                    naturalCubicClamped: generationConfigSettings?.renderModeOverride?.naturalCubicClamped ?? false,
                    resample: generationConfigSettings?.renderModeOverride?.resample ?? { enabled: false, count: 32 },
                    passes: generationConfigSettings?.renderModeOverride?.passes ?? 1,
                    tension: value,
                  }
                })}
                min={0}
                max={1}
                step={0.01}
                className="w-full"
              />
              <div className="flex gap-1 mt-1">
                {([{ label: 'Sharp', value: 0 }, { label: 'Smooth', value: 1 }] as const).map(({ label, value }) => {
                  const tension = generationConfigSettings?.renderModeOverride?.tension ?? 1;
                  const isActive = Math.abs(tension - value) < 0.001;
                  return (
                    <button
                      key={label}
                      onClick={() => onUpdateGenerationConfigSettings({
                        renderModeOverride: {
                          enabled: true,
                          smoothAlgorithm: generationConfigSettings?.renderModeOverride?.smoothAlgorithm ?? 'chaikin',
                          catmullAlpha: generationConfigSettings?.renderModeOverride?.catmullAlpha ?? 0.5,
                          naturalCubicClamped: generationConfigSettings?.renderModeOverride?.naturalCubicClamped ?? false,
                          resample: generationConfigSettings?.renderModeOverride?.resample ?? { enabled: false, count: 32 },
                          passes: generationConfigSettings?.renderModeOverride?.passes ?? 1,
                          tension: value,
                        }
                      })}
                      className={`flex-1 h-6 text-xs font-medium rounded transition-colors ${
                        isActive ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            )}

            {/* Passes slider — Chaikin only */}
            {(generationConfigSettings?.renderModeOverride?.smoothAlgorithm ?? 'chaikin') === 'chaikin' && (
              <BufferedSliderWithNumericInput
                value={generationConfigSettings?.renderModeOverride?.passes ?? 1}
                onValueCommit={(value) => onUpdateGenerationConfigSettings({
                  renderModeOverride: {
                    enabled: true,
                    smoothAlgorithm: 'chaikin',
                    catmullAlpha: generationConfigSettings?.renderModeOverride?.catmullAlpha ?? 0.5,
                    naturalCubicClamped: generationConfigSettings?.renderModeOverride?.naturalCubicClamped ?? false,
                    tension: generationConfigSettings?.renderModeOverride?.tension ?? 1,
                    passes: value,
                    resample: generationConfigSettings?.renderModeOverride?.resample ?? { enabled: false, count: 32 },
                  }
                })}
                min={1}
                max={6}
                step={1}
                inputUnbounded={true}
                label="Passes"
                sliderClassName="w-full pt-2"
              />
            )}

            {/* Natural Cubic — clamped endpoints toggle (open shapes only) */}
            {(generationConfigSettings?.renderModeOverride?.smoothAlgorithm ?? 'chaikin') === 'natural-cubic' && (
              <div className="flex items-center justify-between">
                <Label className="text-xs text-slate-400">Not-a-Knot Ends</Label>
                <Switch
                  checked={generationConfigSettings?.renderModeOverride?.naturalCubicClamped ?? false}
                  onCheckedChange={(checked) => onUpdateGenerationConfigSettings({
                    renderModeOverride: {
                      enabled: true,
                      tension: generationConfigSettings?.renderModeOverride?.tension ?? 1,
                      passes: generationConfigSettings?.renderModeOverride?.passes ?? 1,
                      smoothAlgorithm: 'natural-cubic',
                      catmullAlpha: generationConfigSettings?.renderModeOverride?.catmullAlpha ?? 0.5,
                      naturalCubicClamped: checked,
                      resample: generationConfigSettings?.renderModeOverride?.resample ?? { enabled: false, count: 32 },
                    }
                  })}
                />
              </div>
            )}

            {/* Resample Points — common to all algorithms */}
            <div className="flex items-center justify-between">
              <Label className="text-xs text-slate-400">Resample Points</Label>
              <Switch
                checked={generationConfigSettings?.renderModeOverride?.resample?.enabled ?? false}
                onCheckedChange={(checked) => onUpdateGenerationConfigSettings({
                  renderModeOverride: {
                    enabled: true,
                    tension: generationConfigSettings?.renderModeOverride?.tension ?? 1,
                    passes: generationConfigSettings?.renderModeOverride?.passes ?? 1,
                    smoothAlgorithm: generationConfigSettings?.renderModeOverride?.smoothAlgorithm ?? 'chaikin',
                    catmullAlpha: generationConfigSettings?.renderModeOverride?.catmullAlpha ?? 0.5,
                    naturalCubicClamped: generationConfigSettings?.renderModeOverride?.naturalCubicClamped ?? false,
                    resample: {
                      count: generationConfigSettings?.renderModeOverride?.resample?.count ?? 32,
                      enabled: checked,
                    },
                  }
                })}
              />
            </div>
            {(generationConfigSettings?.renderModeOverride?.resample?.enabled ?? false) && (
              <BufferedSliderWithNumericInput
                value={generationConfigSettings?.renderModeOverride?.resample?.count ?? 32}
                onValueCommit={(value) => onUpdateGenerationConfigSettings({
                  renderModeOverride: {
                    enabled: true,
                    tension: generationConfigSettings?.renderModeOverride?.tension ?? 1,
                    passes: generationConfigSettings?.renderModeOverride?.passes ?? 1,
                    smoothAlgorithm: generationConfigSettings?.renderModeOverride?.smoothAlgorithm ?? 'chaikin',
                    catmullAlpha: generationConfigSettings?.renderModeOverride?.catmullAlpha ?? 0.5,
                    naturalCubicClamped: generationConfigSettings?.renderModeOverride?.naturalCubicClamped ?? false,
                    resample: {
                      enabled: true,
                      count: value,
                    },
                  }
                })}
                min={3}
                max={128}
                step={1}
                inputUnbounded={true}
                label="Point Count"
                sliderClassName="w-full pt-2"
              />
            )}
          </div>
        )}
        </div>
      )}
    </div>

      {/* Wire Pass Sub-Section */}
      <div className="border border-slate-600/60 rounded-lg px-2 py-2">
        <button type="button" onClick={() => toggleSection('wire-pass')} className="flex items-center justify-between w-full bg-transparent border-0 p-0 cursor-pointer text-left">
          <span className="text-xs font-medium text-slate-300">Wire Pass</span>
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 ${openSections.has('wire-pass') ? 'rotate-180' : ''}`} />
        </button>
        {openSections.has('wire-pass') && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-slate-400">Wire Pass</Label>
            <Switch
            checked={generationConfigSettings?.wireConfig?.enabled ?? false}
            onCheckedChange={(checked) => onUpdateGenerationConfigSettings({
              wireConfig: {
                ...(generationConfigSettings?.wireConfig ?? { render: 'points', points: { colorSource: 'explicit', color: '#ffffff', opacity: 1, size: 4 }, connections: { colorSource: 'explicit', color: '#ffffff', opacity: 1, thickness: 1 } }),
                enabled: checked,
              }
            })}
          />
        </div>
        {(generationConfigSettings?.wireConfig?.enabled ?? false) && (
          <div className="space-y-4 pt-1">
            {/* Render mode */}
            <div className="space-y-2">
              <Label className="text-xs text-slate-500">Draw</Label>
              <div className="flex gap-1">
                {(['points', 'connections', 'combined'] as const).map((mode) => {
                  const isActive = (generationConfigSettings?.wireConfig?.render ?? 'points') === mode;
                  return (
                    <button
                      key={mode}
                      onClick={() => onUpdateGenerationConfigSettings({
                        wireConfig: { ...(generationConfigSettings?.wireConfig ?? { enabled: true, points: { colorSource: 'explicit', color: '#ffffff', opacity: 1, size: 4 }, connections: { colorSource: 'explicit', color: '#ffffff', opacity: 1, thickness: 1 } }), render: mode }
                      })}
                      className={`flex-1 h-6 text-[10px] font-medium rounded capitalize transition-colors ${
                        isActive ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      {mode}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Points sub-section */}
            {((generationConfigSettings?.wireConfig?.render ?? 'points') !== 'connections') && (
              <div className="space-y-3 p-2 bg-slate-800/40 rounded border border-slate-700/50">
                <Label className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Points</Label>
                <div className="space-y-2">
                  <Label className="text-xs text-slate-500">Color Source</Label>
                  <Select
                    value={generationConfigSettings?.wireConfig?.points?.colorSource ?? 'explicit'}
                    onValueChange={(v: 'explicit' | 'inherit-fill' | 'inherit-stroke') => onUpdateGenerationConfigSettings({
                      wireConfig: { ...(generationConfigSettings?.wireConfig ?? { enabled: true, render: 'points', connections: { colorSource: 'explicit', color: '#ffffff', opacity: 1, thickness: 1 } }), points: { ...(generationConfigSettings?.wireConfig?.points ?? { color: '#ffffff', opacity: 1, size: 4 }), colorSource: v } }
                    })}
                  >
                    <SelectTrigger className="h-7 text-xs bg-slate-700 border-slate-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ zIndex: 10002 }}>
                      <SelectItem value="explicit">Explicit Color</SelectItem>
                      <SelectItem value="inherit-fill">Inherit Fill</SelectItem>
                      <SelectItem value="inherit-stroke">Inherit Stroke</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(generationConfigSettings?.wireConfig?.points?.colorSource ?? 'explicit') === 'explicit' && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-slate-500 flex-1">Color</Label>
                    <input
                      type="color"
                      value={generationConfigSettings?.wireConfig?.points?.color ?? '#ffffff'}
                      onChange={(e) => onUpdateGenerationConfigSettings({
                        wireConfig: { ...(generationConfigSettings?.wireConfig ?? { enabled: true, render: 'points', connections: { colorSource: 'explicit', color: '#ffffff', opacity: 1, thickness: 1 } }), points: { ...(generationConfigSettings?.wireConfig?.points ?? { colorSource: 'explicit', opacity: 1, size: 4 }), color: e.target.value } }
                      })}
                      className="w-8 h-6 rounded border border-slate-600 cursor-pointer bg-transparent"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label className="text-xs text-slate-500">Opacity Source</Label>
                  <Select
                    value={generationConfigSettings?.wireConfig?.points?.opacitySource ?? 'explicit'}
                    onValueChange={(v: 'explicit' | 'inherit-fill' | 'inherit-stroke') => onUpdateGenerationConfigSettings({
                      wireConfig: { ...(generationConfigSettings?.wireConfig ?? { enabled: true, render: 'points', connections: { colorSource: 'explicit', color: '#ffffff', opacity: 1, thickness: 1 } }), points: { ...(generationConfigSettings?.wireConfig?.points ?? { colorSource: 'explicit', color: '#ffffff', opacity: 1, size: 4 }), opacitySource: v } }
                    })}
                  >
                    <SelectTrigger className="h-7 text-xs bg-slate-700 border-slate-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ zIndex: 10002 }}>
                      <SelectItem value="explicit">Explicit</SelectItem>
                      <SelectItem value="inherit-fill">Fill Opacity</SelectItem>
                      <SelectItem value="inherit-stroke">Stroke Opacity</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(generationConfigSettings?.wireConfig?.points?.opacitySource ?? 'explicit') === 'explicit' && (
                  <BufferedSliderWithNumericInput
                    value={generationConfigSettings?.wireConfig?.points?.opacity ?? 1}
                    onValueCommit={(v) => onUpdateGenerationConfigSettings({
                      wireConfig: { ...(generationConfigSettings?.wireConfig ?? { enabled: true, render: 'points', connections: { colorSource: 'explicit', color: '#ffffff', opacity: 1, thickness: 1 } }), points: { ...(generationConfigSettings?.wireConfig?.points ?? { colorSource: 'explicit', color: '#ffffff', size: 4 }), opacity: v } }
                    })}
                    min={0} max={1} step={0.01} inputUnbounded={true} label="Opacity" sliderClassName="w-full pt-2"
                  />
                )}
                <BufferedSliderWithNumericInput
                  value={generationConfigSettings?.wireConfig?.points?.size ?? 4}
                  onValueCommit={(v) => onUpdateGenerationConfigSettings({
                    wireConfig: { ...(generationConfigSettings?.wireConfig ?? { enabled: true, render: 'points', connections: { colorSource: 'explicit', color: '#ffffff', opacity: 1, thickness: 1 } }), points: { ...(generationConfigSettings?.wireConfig?.points ?? { colorSource: 'explicit', color: '#ffffff', opacity: 1 }), size: v } }
                  })}
                  min={1} max={200} step={0.5} inputUnbounded={true} label="Size" sliderClassName="w-full pt-2"
                />
              </div>
            )}
            {/* Connections sub-section */}
            {((generationConfigSettings?.wireConfig?.render ?? 'points') !== 'points') && (
              <div className="space-y-3 p-2 bg-slate-800/40 rounded border border-slate-700/50">
                <Label className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Connections</Label>
                <div className="space-y-2">
                  <Label className="text-xs text-slate-500">Color Source</Label>
                  <Select
                    value={generationConfigSettings?.wireConfig?.connections?.colorSource ?? 'explicit'}
                    onValueChange={(v: 'explicit' | 'inherit-fill' | 'inherit-stroke') => onUpdateGenerationConfigSettings({
                      wireConfig: { ...(generationConfigSettings?.wireConfig ?? { enabled: true, render: 'connections', points: { colorSource: 'explicit', color: '#ffffff', opacity: 1, size: 4 } }), connections: { ...(generationConfigSettings?.wireConfig?.connections ?? { color: '#ffffff', opacity: 1, thickness: 1 }), colorSource: v } }
                    })}
                  >
                    <SelectTrigger className="h-7 text-xs bg-slate-700 border-slate-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ zIndex: 10002 }}>
                      <SelectItem value="explicit">Explicit Color</SelectItem>
                      <SelectItem value="inherit-fill">Inherit Fill</SelectItem>
                      <SelectItem value="inherit-stroke">Inherit Stroke</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(generationConfigSettings?.wireConfig?.connections?.colorSource ?? 'explicit') === 'explicit' && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-slate-500 flex-1">Color</Label>
                    <input
                      type="color"
                      value={generationConfigSettings?.wireConfig?.connections?.color ?? '#ffffff'}
                      onChange={(e) => onUpdateGenerationConfigSettings({
                        wireConfig: { ...(generationConfigSettings?.wireConfig ?? { enabled: true, render: 'connections', points: { colorSource: 'explicit', color: '#ffffff', opacity: 1, size: 4 } }), connections: { ...(generationConfigSettings?.wireConfig?.connections ?? { colorSource: 'explicit', opacity: 1, thickness: 1 }), color: e.target.value } }
                      })}
                      className="w-8 h-6 rounded border border-slate-600 cursor-pointer bg-transparent"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label className="text-xs text-slate-500">Opacity Source</Label>
                  <Select
                    value={generationConfigSettings?.wireConfig?.connections?.opacitySource ?? 'explicit'}
                    onValueChange={(v: 'explicit' | 'inherit-fill' | 'inherit-stroke') => onUpdateGenerationConfigSettings({
                      wireConfig: { ...(generationConfigSettings?.wireConfig ?? { enabled: true, render: 'connections', points: { colorSource: 'explicit', color: '#ffffff', opacity: 1, size: 4 } }), connections: { ...(generationConfigSettings?.wireConfig?.connections ?? { colorSource: 'explicit', color: '#ffffff', opacity: 1, thickness: 1 }), opacitySource: v } }
                    })}
                  >
                    <SelectTrigger className="h-7 text-xs bg-slate-700 border-slate-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ zIndex: 10002 }}>
                      <SelectItem value="explicit">Explicit</SelectItem>
                      <SelectItem value="inherit-fill">Fill Opacity</SelectItem>
                      <SelectItem value="inherit-stroke">Stroke Opacity</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(generationConfigSettings?.wireConfig?.connections?.opacitySource ?? 'explicit') === 'explicit' && (
                  <BufferedSliderWithNumericInput
                    value={generationConfigSettings?.wireConfig?.connections?.opacity ?? 1}
                    onValueCommit={(v) => onUpdateGenerationConfigSettings({
                      wireConfig: { ...(generationConfigSettings?.wireConfig ?? { enabled: true, render: 'connections', points: { colorSource: 'explicit', color: '#ffffff', opacity: 1, size: 4 } }), connections: { ...(generationConfigSettings?.wireConfig?.connections ?? { colorSource: 'explicit', color: '#ffffff', thickness: 1 }), opacity: v } }
                    })}
                    min={0} max={1} step={0.01} inputUnbounded={true} label="Opacity" sliderClassName="w-full pt-2"
                  />
                )}
                <BufferedSliderWithNumericInput
                  value={generationConfigSettings?.wireConfig?.connections?.thickness ?? 1}
                  onValueCommit={(v) => onUpdateGenerationConfigSettings({
                    wireConfig: { ...(generationConfigSettings?.wireConfig ?? { enabled: true, render: 'connections', points: { colorSource: 'explicit', color: '#ffffff', opacity: 1, size: 4 } }), connections: { ...(generationConfigSettings?.wireConfig?.connections ?? { colorSource: 'explicit', color: '#ffffff', opacity: 1 }), thickness: v } }
                  })}
                  min={0.5} max={200} step={0.5} inputUnbounded={true} label="Thickness" sliderClassName="w-full pt-2"
                />
              </div>
            )}
          </div>
        )}
        </div>
      )}
    </div>
        </div>
        )}
      </div>

      {/* Apply Button - only shown when sets are enabled and not suppressed by parent dialog */}
      {setsEnabled && !hideApplyButton && (
        <Button 
          onClick={applyStatus === 'idle' ? handleApplyToCurrentSet : undefined}
          disabled={!currentGenerationSetId || !updateGenerationSetPartial}
          className={`w-full h-8 ${
            !currentGenerationSetId || !updateGenerationSetPartial
              ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
              : applyStatus === 'applying'
              ? 'bg-blue-600 text-white cursor-not-allowed'
              : applyStatus === 'success'
              ? 'bg-green-600 text-white cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          } transition-colors duration-200`}
          data-testid="button-apply-shape-types"
        >
          <div className="flex items-center space-x-2">
            {!currentGenerationSetId || !updateGenerationSetPartial ? (
              <AlertTriangle className="w-4 h-4" />
            ) : applyStatus === 'applying' ? (
              <>
                <div className="w-4 h-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Applying...</span>
              </>
            ) : applyStatus === 'success' ? (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Applied!</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Apply</span>
              </>
            )}
          </div>
        </Button>
      )}
    </div>
  );
});

interface SidebarProps {
  enabledShapeTypes: Set<ShapeType>;
  scatterSettings: ScatterSettings;
  generationConfigSettings: BatchConfigSettings;
  selectedCount: number;
  selectedPointsCount: number;
  selectedSegmentsCount: number;
  editMode: 'shapes' | 'points' | 'segments';
  showMultiSelectButton: boolean;
  showSelectedCount: boolean;
  onSetShowMultiSelectButton: (show: boolean) => void;
  onSetShowSelectedCount: (show: boolean) => void;
  canComposeShapes: boolean;
  selectedShapes: Shape[];
  selectedGroups: ShapeGroupClass[];
  shapes: Shape[]; // All shapes for layers panel
  artboards: Artboard[];
  activeArtboard: string;
  onToggleShapeType: (type: ShapeType) => void;
  onUpdateScatterSettings: (settings: Partial<ScatterSettings>) => void;
  onGenerateRandomShapes: () => void;
  onGenerateShapesWithBatchConfig: (count: number, canvasBounds: { x: number; y: number; width: number; height: number }, useDistribution?: boolean, shapeGenerationIndex?: number, shapeSpecificPropertiesOverride?: Record<string, any>, overrides?: { enabledShapeTypes?: Set<ShapeType>; batchConfig?: BatchConfigSettings; scatterSettings?: any }) => Shape[];
  onComposeShapes: () => void;
  onSetEditMode: (mode: 'shapes' | 'points' | 'segments') => void;
  onMoveBy: (x: number, y: number) => void;
  onScaleBy: (x: number, y: number) => void;
  onRotateBy: (angle: number) => void;
  onSkewBy: (x: number, y: number) => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onDeleteSelected: () => void;
  onClearAll?: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onChangeBlendMode: (blendMode: BlendMode) => void;
  onShapeUpdate?: () => void;
  onAddCustomShape?: (shape: Shape) => void;
  onAddArtboard: (preset: ArtboardPreset) => void;
  onSelectArtboard: (artboardId: string) => void;
  onDeleteArtboard: (artboardId: string) => void;
  onUpdateArtboard: (artboardId: string, updates: Partial<Artboard>) => void;
  onDistributeSelected: () => void;
  onApplyBooleanOperation: (operation: 'union' | 'subtract' | 'intersect' | 'exclude', targetId: string) => void;
  onApplyColorManipulation: (manipulation: any) => void;
  onUpdateGenerationConfigSettings: (settings: Partial<BatchConfigSettings>) => void;
  onUpdateGenerationConfigSettingsLive?: (settings: Partial<BatchConfigSettings>) => void;
  onLoadProject: (data: {
    shapes: any[];
    groups: any[];
    artboard: {
      width: number;
      height: number;
      backgroundColor: string;
    };
  }) => void;
  
  // Generation Sets Management
  generationSets?: GenerationSet[];
  currentGenerationSetId?: string | null;
  shapeCountMode?: ShapeCountMode;
  shapeCountFixed?: number;
  shapeCountRange?: [number, number];
  batchExportCount?: number;
  generationCountMode?: string;
  onGenerationSetsChange?: (sets: GenerationSet[]) => void;
  onCurrentGenerationSetChange?: (setId: string | null) => void;
  /** Atomic generator-state loader — avoids the stale-closure race when sets
   * and the selected set ID are changed together. Prefer this over calling
   * onGenerationSetsChange + onCurrentGenerationSetChange sequentially.
   * Returns a Promise so callers can await persistence before showing a toast. */
  onLoadGeneratorState?: (state: ImportedConfigurationState) => Promise<void>;
  onCreateGenerationSet?: (customName?: string, currentUIState?: CurrentUIState) => string;
  onDeleteGenerationSet?: (setId: string) => void;
  generateUniqueSetName?: (baseName?: string) => string;
  onOpenGenerationSetsManager?: () => void;
  isSetsManagerOpen?: boolean;
  onCloseGenerationSetsManager?: () => void;
  onBatchExportCountChange?: (count: number) => void;
  onGenerationCountModeChange?: (mode: 'fixed' | 'range') => void;
  onRestoreUIStateFromSet?: (setId: string) => void;
  onApplyCurrentUIStateToSet?: (setId: string, uiState: CurrentUIState) => Promise<void>;
  updateGenerationSetPartial?: (setId: string, partialUpdate: Partial<GenerationSet>) => Promise<void>;
  hasUnsavedChanges?: (setId: string | null) => boolean;
  areSetsEnabled?: (batchCount?: number, countMode?: string) => boolean;
  globalRepetitionMode?: 'fixed' | 'range';
  globalRepetitionValue?: number;
  globalRepetitionRange?: [number, number];
  onGlobalRepetitionModeChange?: (mode: 'fixed' | 'range') => void;
  onGlobalRepetitionValueChange?: (value: number) => void;
  onGlobalRepetitionRangeChange?: (range: [number, number]) => void;
  
  // App Settings Management
  onSaveAppSettings?: () => void;
  onLoadAppSettings?: () => void;
  appSettingsStatus?: { isSaving?: boolean; isLoading?: boolean; hasSaved?: boolean; hasLoaded?: boolean };

  // Generation Sets reload
  onReloadGenerationSets?: () => void;

  // Overlay Manager
  overlayManagerState?: OverlayManagerState;
  onOverlayManagerStateChange?: (state: OverlayManagerState) => void;
}

export default function Sidebar({
  enabledShapeTypes,
  scatterSettings,
  generationConfigSettings,
  selectedCount,
  selectedPointsCount,
  selectedSegmentsCount,
  editMode,
  showMultiSelectButton,
  showSelectedCount,
  onSetShowMultiSelectButton,
  onSetShowSelectedCount,
  canComposeShapes,
  selectedShapes,
  selectedGroups,
  shapes,
  artboards,
  activeArtboard,
  onToggleShapeType,
  onUpdateScatterSettings,
  onUpdateGenerationConfigSettings,
  onUpdateGenerationConfigSettingsLive,
  onGenerateRandomShapes,
  onGenerateShapesWithBatchConfig,
  onComposeShapes,
  onSetEditMode,
  onMoveBy,
  onScaleBy,
  onRotateBy,
  onSkewBy,
  onFlipHorizontal,
  onFlipVertical,
  onDeleteSelected,
  onClearAll,
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
  onChangeBlendMode,
  onShapeUpdate,
  onAddCustomShape,
  onAddArtboard,
  onSelectArtboard,
  onDeleteArtboard,
  onUpdateArtboard,
  onDistributeSelected,
  onApplyBooleanOperation,
  onApplyColorManipulation,
  onLoadProject,
  
  // Generation Sets Management
  generationSets = [],
  currentGenerationSetId = null,
  shapeCountMode = 'fixed' as ShapeCountMode,
  shapeCountFixed = 10,
  shapeCountRange = [5, 15] as [number, number],
  batchExportCount = 1,
  generationCountMode = 'fixed',
  onGenerationSetsChange,
  onCurrentGenerationSetChange,
  onLoadGeneratorState,
  onCreateGenerationSet,
  onDeleteGenerationSet,
  generateUniqueSetName,
  onOpenGenerationSetsManager,
  isSetsManagerOpen = false,
  onCloseGenerationSetsManager,
  onBatchExportCountChange,
  onGenerationCountModeChange,
  onRestoreUIStateFromSet,
  onApplyCurrentUIStateToSet,
  updateGenerationSetPartial,
  hasUnsavedChanges,
  areSetsEnabled,
  globalRepetitionMode: globalRepetitionModeProp = 'fixed',
  globalRepetitionValue: globalRepetitionValueProp = 0,
  globalRepetitionRange: globalRepetitionRangeProp = [0, 0] as [number, number],
  onGlobalRepetitionModeChange,
  onGlobalRepetitionValueChange,
  onGlobalRepetitionRangeChange,
  
  // App Settings Management
  onSaveAppSettings,
  onLoadAppSettings,
  appSettingsStatus = {},

  // Generation Sets reload
  onReloadGenerationSets,

  // Overlay Manager
  overlayManagerState = DEFAULT_OVERLAY_MANAGER_STATE,
  onOverlayManagerStateChange,
}: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activePopover, setActivePopover] = useState<string | null>(null);
  // Per-artboard "Resample on DPI change" toggle. Lifted to Sidebar scope (rather
  // than inside ArtboardsContent) so the state survives ArtboardsContent remounts
  // — ArtboardsContent is declared inside Sidebar, so it gets a new function
  // identity on every parent render and React remounts it, resetting any state
  // declared locally inside it.
  const [resampleByArtboardId, setResampleByArtboardId] = useState<Record<string, boolean>>({});
  
  // Track if sidebar settings have been restored to prevent save loops
  const hasRestoredSidebar = useRef(false);
  const [moveX, setMoveX] = useState(0);
  const [moveY, setMoveY] = useState(0);
  const [scaleX, setScaleX] = useState(100);
  const [scaleY, setScaleY] = useState(100);
  const [lockAspectRatio, setLockAspectRatio] = useState(true);
  
  // Loading states for save/load/export operations
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [isSavingAppSettings, setIsSavingAppSettings] = useState(false);
  const [exportSaveTab, setExportSaveTab] = useState<'single' | 'batch'>('single');
  const [isExporting, setIsExporting] = useState(false);
  const [applyStatus, setApplyStatus] = useState<'idle' | 'applying' | 'success'>('idle');
  
  // Project load dialog state
  const [isLoadDialogOpen, setIsLoadDialogOpen] = useState(false);
  const [pendingProjectFile, setPendingProjectFile] = useState<File | null>(null);
  const [dontAskAgainPref, setDontAskAgainPref] = useState(false);

  // Generator file save/load state
  const [isSavingGenerator, setIsSavingGenerator] = useState(false);
  const [isLoadingGenerator, setIsLoadingGenerator] = useState(false);
  const [isLoadGeneratorDialogOpen, setIsLoadGeneratorDialogOpen] = useState(false);
  const [pendingGeneratorFile, setPendingGeneratorFile] = useState<File | null>(null);
  const [generatorSetImportMode, setGeneratorSetImportMode] = useState<SetImportMode>('append');
  const [generatorArtboardImportMode, setGeneratorArtboardImportMode] = useState<ArtboardImportMode>('add');
  const [isPortableImportDialogOpen, setIsPortableImportDialogOpen] = useState(false);
  const [pendingPortableImport, setPendingPortableImport] = useState<{ kind: 'sets' | 'artboards'; data: any; diagnostics: ImportDiagnostic[] } | null>(null);
  const [portableSetImportMode, setPortableSetImportMode] = useState<SetImportMode>('append');
  const [portableArtboardImportMode, setPortableArtboardImportMode] = useState<ArtboardImportMode>('add');
  const [shapeSetExportScope, setShapeSetExportScope] = useState<'current' | 'selected' | 'all'>('all');
  const [selectedShapeSetExportIds, setSelectedShapeSetExportIds] = useState<string[]>([]);
  const [artboardConfigExportScope, setArtboardConfigExportScope] = useState<'active' | 'selected' | 'all'>('all');
  const [selectedArtboardConfigExportIds, setSelectedArtboardConfigExportIds] = useState<string[]>([]);
  
  // Shape set presets state
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [isSavePresetDialogOpen, setIsSavePresetDialogOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [cleanPresetEnabled, setCleanPresetEnabled] = useState(false);
  const [autoLoadAfterSave, setAutoLoadAfterSave] = useState(false);
  const [isDeletePresetDialogOpen, setIsDeletePresetDialogOpen] = useState(false);
  const [presetToDelete, setPresetToDelete] = useState<string>('');
  const [presetAppendMode, setPresetAppendMode] = useState(true);
  const [isReplaceConfirmOpen, setIsReplaceConfirmOpen] = useState(false);
  const [pendingReplacePresetId, setPendingReplacePresetId] = useState<string>('');
  const [isAutoLoadConfirmOpen, setIsAutoLoadConfirmOpen] = useState(false);
  const [pendingAutoLoadData, setPendingAutoLoadData] = useState<{ sets: GenerationSet[]; currentSetId: string | null; presetName: string } | null>(null);
  const [isNameClashDialogOpen, setIsNameClashDialogOpen] = useState(false);
  const [nameClashSets, setNameClashSets] = useState<Array<{ incoming: GenerationSet; existing: GenerationSet | null; index: number }>>([]);
  const [nameClashResolutions, setNameClashResolutions] = useState<Record<string, 'replace' | 'keep-both'>>({});
  const [pendingAppendData, setPendingAppendData] = useState<{ sets: GenerationSet[]; currentSetId: string | null; presetName: string } | null>(null);

  // Export settings state (lifted from ExportSaveContent for persistence)
  const [exportFormat, setExportFormat] = useState<'png' | 'jpg' | 'webp' | 'avif' | 'bmp' | 'pdf' | 'tiff'>('png');
  const [exportQuality, setExportQuality] = useState(90);
  const [exportScale, setExportScale] = useState(1);
  // Auto-scale-from-DPI removed (2026-05). Artboard pixel dimensions are now the single
  // source of truth for export output size. To scale up/down, use the manual exportScale.
  const [exportMode, setExportMode] = useState<'selection' | 'artboard' | 'artboard-extended' | 'all'>('all');
  const [selectedArtboardForExport, setSelectedArtboardForExport] = useState<string>('');
  
  // TIFF pre-flight modal state
  const [isTiffPreflightOpen, setIsTiffPreflightOpen] = useState(false);
  const [pendingTiffExport, setPendingTiffExport] = useState<boolean>(false);
  const pendingTiffExportRef = useRef<(() => void) | null>(null);
  const compressionSettingsRef = useRef<CompressionSettings>(DEFAULT_COMPRESSION_SETTINGS);
  const [isServerExportingGlobal, setIsServerExportingGlobal] = useState(false);
  // Ref to bridge handleServerExport (defined in nested JSX scope) to top-level JSX
  const serverExportRef = useRef<(() => void) | null>(null);

  // Client export failure panel state
  const [showClientExportFailurePanel, setShowClientExportFailurePanel] = useState(false);
  const [clientExportFailureInfo, setClientExportFailureInfo] = useState<{
    megapixels: number;
    limitMp: number;
    width: number;
    height: number;
    reason: 'too-large' | 'blank-result';
  } | null>(null);
  
  // Export progress overlay state (lifted to component level for global visibility)
  const [showExportProgressOverlay, setShowExportProgressOverlay] = useState(false);
  const [exportProgressGlobal, setExportProgressGlobal] = useState(0);
  const [exportTotalStepsGlobal, setExportTotalStepsGlobal] = useState(0);
  const [exportStatusGlobal, setExportStatusGlobal] = useState('');
  const [exportElapsedTimeGlobal, setExportElapsedTimeGlobal] = useState(0);
  const [exportIsCompleteGlobal, setExportIsCompleteGlobal] = useState(false);
  const [exportIsErrorGlobal, setExportIsErrorGlobal] = useState(false);
  const [exportResultMessageGlobal, setExportResultMessageGlobal] = useState('');
  const [exportEstimatedTimeGlobal, setExportEstimatedTimeGlobal] = useState<number | undefined>(undefined);
  const [exportDownloadUrlGlobal, setExportDownloadUrlGlobal] = useState<string | undefined>(undefined);
  const [exportDownloadFilenameGlobal, setExportDownloadFilenameGlobal] = useState<string | undefined>(undefined);
  const [exportChunkIndexGlobal, setExportChunkIndexGlobal] = useState<number | undefined>(undefined);
  const [exportChunkCountGlobal, setExportChunkCountGlobal] = useState<number | undefined>(undefined);
  const exportStartTimeGlobalRef = useRef<number | null>(null);
  const elapsedTimeIntervalGlobalRef = useRef<NodeJS.Timeout | null>(null);
  const exportAbortControllerGlobalRef = useRef<AbortController | null>(null);
  
  // Start elapsed time tracking (global)
  const startElapsedTimeTrackingGlobal = useCallback(() => {
    exportStartTimeGlobalRef.current = Date.now();
    setExportElapsedTimeGlobal(0);
    elapsedTimeIntervalGlobalRef.current = setInterval(() => {
      if (exportStartTimeGlobalRef.current) {
        setExportElapsedTimeGlobal(Math.floor((Date.now() - exportStartTimeGlobalRef.current) / 1000));
      }
    }, 1000);
  }, []);
  
  // Stop elapsed time tracking (global)
  const stopElapsedTimeTrackingGlobal = useCallback(() => {
    if (elapsedTimeIntervalGlobalRef.current) {
      clearInterval(elapsedTimeIntervalGlobalRef.current);
      elapsedTimeIntervalGlobalRef.current = null;
    }
    exportStartTimeGlobalRef.current = null;
  }, []);
  
  // Cancel export (global)
  const handleCancelExportGlobal = useCallback(() => {
    if (exportAbortControllerGlobalRef.current) {
      exportAbortControllerGlobalRef.current.abort();
      console.log('🛑 Export cancelled by user (global)');
      setExportStatusGlobal('Export cancelled');
      setExportIsErrorGlobal(true);
      setExportResultMessageGlobal('⚠️ Export was cancelled');
      stopElapsedTimeTrackingGlobal();
    }
  }, [stopElapsedTimeTrackingGlobal]);
  
  // Reset export overlay state
  const resetExportOverlay = useCallback(() => {
    // Only revoke blob URLs (starts with 'blob:'), not server URLs
    if (exportDownloadUrlGlobal && exportDownloadUrlGlobal.startsWith('blob:')) {
      URL.revokeObjectURL(exportDownloadUrlGlobal);
    }
    setShowExportProgressOverlay(false);
    setExportProgressGlobal(0);
    setExportTotalStepsGlobal(0);
    setExportStatusGlobal('');
    setExportElapsedTimeGlobal(0);
    setExportEstimatedTimeGlobal(undefined);
    setExportIsCompleteGlobal(false);
    setExportIsErrorGlobal(false);
    setExportResultMessageGlobal('');
    setIsServerExportingGlobal(false);
    setExportDownloadUrlGlobal(undefined);
    setExportDownloadFilenameGlobal(undefined);
    setExportChunkIndexGlobal(undefined);
    setExportChunkCountGlobal(undefined);
  }, [exportDownloadUrlGlobal]);
  
  // Global repetition settings - driven by hook state via props
  const globalRepetitionMode = globalRepetitionModeProp;
  const globalRepetitionValue = globalRepetitionValueProp;
  const globalRepetitionRange = globalRepetitionRangeProp;
  const setGlobalRepetitionMode = onGlobalRepetitionModeChange ?? (() => {});
  const setGlobalRepetitionValue = onGlobalRepetitionValueChange ?? (() => {});
  const setGlobalRepetitionRange = onGlobalRepetitionRangeChange ?? (() => {});
  
  // Ref to skip UI restoration after Apply button (prevents scroll jump)
  const skipNextRestoreRef = useRef(false);
  
  // ShapeSetsTabbedDialog local state
  const [tabbedDialogOpen, setTabbedDialogOpen] = useState(false);
  const [tabbedDialogTab, setTabbedDialogTab] = useState<ShapeSetsTabbedDialogTab>('shape-sets-settings');

  // Open the tabbed dialog on a specific tab
  const handleOpenTabbedDialog = useCallback((tab: string) => {
    setTabbedDialogTab(tab as ShapeSetsTabbedDialogTab);
    setTabbedDialogOpen(true);
  }, []);

  // Sync isSetsManagerOpen prop with local tabbed dialog (external triggers)
  useEffect(() => {
    if (isSetsManagerOpen) {
      setTabbedDialogTab('sets-manager');
      setTabbedDialogOpen(true);
    }
  }, [isSetsManagerOpen]);

  // Get user preferences for sidebar section visibility
  const { sidebarSections, isLoading: isLoadingPreferences, appSettingsDefaults, saveAppSettings, skipLoadProjectDialog, updateSkipLoadDialog } = useUserPreferences();
  
  // Get export settings from user preferences
  const { exportSettings, updateExportSettings, isLoading: isLoadingExportSettings } = useExportSettings();
  
  // Shape set presets hook
  const { presets, savePreset, deletePreset, isSaving, isDeleting } = useShapeSetPresets();
  
  // Toast notifications
  const { toast } = useToast();

  // Use centralized generation sets state from parent (memoized to prevent re-renders)
  const effectiveGenerationSets = useMemo(() => generationSets || [], [generationSets]);
  const effectiveCurrentSetId = currentGenerationSetId;

  // Preset handlers - memoized to prevent recreation on every render
  // Use refs for frequently changing values to avoid recreating the callback
  const newPresetNameRef = useRef('');
  useEffect(() => {
    newPresetNameRef.current = newPresetName;
  }, [newPresetName]);
  
  // Real-time validation for duplicate preset names
  const isPresetNameDuplicate = useMemo(() => {
    const name = newPresetName.trim();
    if (!name) return false;
    return presets.some(p => p.presetName.toLowerCase() === name.toLowerCase());
  }, [newPresetName, presets]);

  const cleanPresetEnabledRef = useRef(false);
  useEffect(() => {
    cleanPresetEnabledRef.current = cleanPresetEnabled;
  }, [cleanPresetEnabled]);
  
  const autoLoadAfterSaveRef = useRef(false);
  useEffect(() => {
    autoLoadAfterSaveRef.current = autoLoadAfterSave;
  }, [autoLoadAfterSave]);
  
  const handleSavePreset = useCallback(async () => {
    const name = newPresetNameRef.current;
    if (!name.trim()) {
      toast({
        variant: "destructive",
        title: "Preset name required",
        description: "Please enter a name for the preset.",
      });
      return;
    }
    
    // Check for duplicate preset names
    const isDuplicate = presets.some(p => p.presetName.toLowerCase() === name.trim().toLowerCase());
    if (isDuplicate) {
      toast({
        variant: "destructive",
        title: "Preset name already exists",
        description: "A preset with this name already exists. Please choose a different name.",
      });
      return;
    }
    
    try {
      // Filter out disabled sets if clean preset is enabled
      const setsToSave = cleanPresetEnabledRef.current 
        ? effectiveGenerationSets.filter(set => set.enabled)
        : effectiveGenerationSets;
      
      // Prevent saving if clean preset would result in no sets
      if (cleanPresetEnabledRef.current && setsToSave.length === 0) {
        toast({
          variant: "destructive",
          title: "No enabled sets",
          description: "Cannot save a clean preset with no enabled sets. Enable at least one set first.",
        });
        return;
      }
      
      // Determine the current set ID - if the current set was filtered out, use the first enabled set
      let currentSetIdToSave = effectiveCurrentSetId;
      if (cleanPresetEnabledRef.current && currentSetIdToSave) {
        const currentSetStillExists = setsToSave.some(set => set.id === currentSetIdToSave);
        if (!currentSetStillExists && setsToSave.length > 0) {
          currentSetIdToSave = setsToSave[0].id;
        }
      }
      
      await savePreset(name, setsToSave, currentSetIdToSave);
      
      const savedCount = setsToSave.length;
      const filteredCount = effectiveGenerationSets.length - savedCount;
      const description = cleanPresetEnabledRef.current && filteredCount > 0
        ? `"${name}" saved with ${savedCount} enabled set${savedCount !== 1 ? 's' : ''} (${filteredCount} disabled set${filteredCount !== 1 ? 's' : ''} excluded).`
        : `"${name}" has been saved successfully.`;
      
      toast({
        title: "Preset saved",
        description,
      });
      
      // Auto-load the saved preset if enabled — confirm before applying
      if (autoLoadAfterSaveRef.current && cleanPresetEnabledRef.current) {
        setPendingAutoLoadData({ sets: setsToSave, currentSetId: currentSetIdToSave || null, presetName: name });
        setIsAutoLoadConfirmOpen(true);
      }
      
      setIsSavePresetDialogOpen(false);
      setNewPresetName('');
      setCleanPresetEnabled(false);
      setAutoLoadAfterSave(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: "Failed to save preset. Please try again.",
      });
    }
  }, [presets, savePreset, effectiveGenerationSets, effectiveCurrentSetId, onGenerationSetsChange, onCurrentGenerationSetChange, toast]);
  
  // Execute a full replace — wipes current sets and applies preset sets
  const executePresetReplace = useCallback((sets: GenerationSet[], currentSetId: string | null, presetName: string) => {
    try {
      // Use the atomic loader so UI restoration reads from the new set list rather
      // than the stale closed-over generationSets (which hasn't committed yet when
      // onCurrentGenerationSetChange fires).
      if (onLoadGeneratorState) {
        onLoadGeneratorState({
          generationSets: sets,
          currentSetId,
          artboards,
          activeArtboardId: activeArtboard,
        });
      } else {
        onGenerationSetsChange?.(sets);
        onCurrentGenerationSetChange?.(currentSetId);
      }
      toast({ title: "Preset loaded", description: `"${presetName}" loaded — all previous shape sets replaced.` });
    } catch {
      toast({ variant: "destructive", title: "Load failed", description: "Failed to load preset. Please try again." });
    }
  }, [onLoadGeneratorState, onGenerationSetsChange, onCurrentGenerationSetChange, artboards, activeArtboard, toast]);

  // Execute an append — merges incoming sets into existing ones, applying clash resolutions.
  // Resolutions are keyed by incoming-set index (string) to avoid duplicate-ID collisions.
  // Clash checking runs against the evolving result so intra-preset duplicates are handled correctly.
  const executePresetAppend = useCallback((
    incomingSets: GenerationSet[],
    presetName: string,
    resolutions: Record<string, 'replace' | 'keep-both'>
  ) => {
    try {
      const result = [...effectiveGenerationSets];
      for (let i = 0; i < incomingSets.length; i++) {
        const inc = incomingSets[i];
        const resolution = resolutions[i.toString()];
        // Check against the evolving result — catches intra-preset duplicate names too
        const existingIdx = result.findIndex(ex => ex.name === inc.name);
        if (existingIdx !== -1 && resolution === 'replace') {
          // Replace existing set's data in-place, preserving its ID
          result[existingIdx] = { ...inc, id: result[existingIdx].id };
        } else if (existingIdx !== -1) {
          // keep-both (default when no explicit resolution): append with unique suffix + fresh ID
          let n = 2;
          while (result.some(s => s.name === `${inc.name} (${n})`)) n++;
          result.push({ ...inc, id: crypto.randomUUID(), name: `${inc.name} (${n})` });
        } else {
          // No clash in the current result — append with fresh ID to avoid conflicts
          result.push({ ...inc, id: crypto.randomUUID() });
        }
      }
      onGenerationSetsChange?.(result);
      // Keep the current active set unchanged when appending
      toast({ title: "Preset appended", description: `Sets from "${presetName}" have been added to your project.` });
    } catch {
      toast({ variant: "destructive", title: "Append failed", description: "Failed to append preset. Please try again." });
    }
  }, [effectiveGenerationSets, onGenerationSetsChange, toast]);

  // Begin an append — detects name clashes (including intra-preset duplicates) against the
  // evolving simulated name-set, then routes to the resolution dialog if any are found.
  // Clashes are keyed by their incoming-array index to handle duplicate IDs inside a preset.
  const startPresetAppend = useCallback((sets: GenerationSet[], currentSetId: string | null, presetName: string) => {
    const clashes: Array<{ incoming: GenerationSet; existing: GenerationSet | null; index: number }> = [];
    // Start from names already in the project; update as we simulate appending each set
    const seenNames = new Set(effectiveGenerationSets.map(s => s.name));

    for (let i = 0; i < sets.length; i++) {
      const inc = sets[i];
      if (seenNames.has(inc.name)) {
        const existingInProject = effectiveGenerationSets.find(ex => ex.name === inc.name) ?? null;
        clashes.push({ incoming: inc, existing: existingInProject, index: i });
        // Don't add to seenNames here; the suffix chosen by the user will differ
      } else {
        // No clash — this name is safe; record it so later identical names in the preset are caught
        seenNames.add(inc.name);
      }
    }

    if (clashes.length > 0) {
      setNameClashSets(clashes);
      setNameClashResolutions(Object.fromEntries(clashes.map(c => [c.index.toString(), 'keep-both' as const])));
      setPendingAppendData({ sets, currentSetId, presetName });
      setIsNameClashDialogOpen(true);
    } else {
      executePresetAppend(sets, presetName, {});
    }
  }, [effectiveGenerationSets, executePresetAppend]);

  const handleLoadPreset = useCallback(() => {
    const preset = presets.find(p => p.id === selectedPresetId);
    if (!preset) return;
    const sets = preset.generationSetsData as GenerationSet[];
    const currentSetId = preset.currentSetId || null;
    if (presetAppendMode) {
      startPresetAppend(sets, currentSetId, preset.presetName);
    } else {
      setPendingReplacePresetId(selectedPresetId);
      setIsReplaceConfirmOpen(true);
    }
  }, [presets, selectedPresetId, presetAppendMode, startPresetAppend]);
  
  const presetToDeleteRef = useRef('');
  useEffect(() => {
    presetToDeleteRef.current = presetToDelete;
  }, [presetToDelete]);

  const loadProjectFileInputRef = useRef<HTMLInputElement>(null);
  const loadGeneratorFileInputRef = useRef<HTMLInputElement>(null);
  const loadShapeSetsFileInputRef = useRef<HTMLInputElement>(null);
  const loadArtboardsFileInputRef = useRef<HTMLInputElement>(null);
  const fillColorInputRef = useRef<HTMLInputElement>(null);
  const strokeColorInputRef = useRef<HTMLInputElement>(null);
  
  const handleDeletePreset = useCallback(async () => {
    const idToDelete = presetToDeleteRef.current;
    try {
      const preset = presets.find(p => p.id === idToDelete);
      await deletePreset(idToDelete);
      toast({
        title: "Preset deleted",
        description: `"${preset?.presetName}" has been deleted.`,
      });
      setIsDeletePresetDialogOpen(false);
      setPresetToDelete('');
      setSelectedPresetId('');
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: "Failed to delete preset. Please try again.",
      });
    }
  }, [presets, deletePreset, toast]);

  // Generation sets are enabled when the main toggle is enabled
  // This allows users to save/load generation configurations with any count mode
  const effectiveMode = generationCountMode ?? 'fixed';
  const setsEnabled = exportSettings.generationSetsEnabled;
  
  // Define section order based on displayOrder from user preferences
  const sectionOrder = useMemo(() => {
    const sections = [
      'shapes', 'selection', 'layers', 'properties', 'composition', 
      'align-distribute', 'artboards', 'colors', 'project', 'export', 'overlay-manager'
    ] as const;
    
    return sections
      .map(id => ({
        id,
        displayOrder: sidebarSections[id as keyof typeof sidebarSections]?.displayOrder ?? 999,
        enabled: sidebarSections[id as keyof typeof sidebarSections]?.enabled ?? false
      }))
      .filter(item => item.enabled) // Only include enabled sections
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(item => item.id);
  }, [sidebarSections]);

  // Auto-load app settings on mount (once only)
  // Note: Artboard and canvas restoration is handled by useShapeEditor
  useEffect(() => {
    if (appSettingsDefaults && !isLoadingPreferences && !hasRestoredSidebar.current) {
      console.log('Auto-loading app settings:', appSettingsDefaults);
      hasRestoredSidebar.current = true;
      
      setExportFormat(appSettingsDefaults.exportFormat);
      setExportQuality(appSettingsDefaults.exportQuality);
      setExportScale(appSettingsDefaults.exportScale);
      setExportMode(appSettingsDefaults.exportMode);
      setIsCollapsed(appSettingsDefaults.sidebarCollapsed ?? false);
    }
  }, [appSettingsDefaults, isLoadingPreferences]);

  // Save sidebar collapsed state when it changes (debounced)
  // Include current export settings so collapsing the sidebar never overwrites them with stale DB values.
  useEffect(() => {
    if (!appSettingsDefaults || !hasRestoredSidebar.current) return;
    
    const timeoutId = setTimeout(() => {
      saveAppSettings.mutate({
        ...appSettingsDefaults,
        sidebarCollapsed: isCollapsed,
        exportFormat,
        exportQuality,
        exportScale,
        exportMode,
      });
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [isCollapsed]);

  // Auto-save export settings whenever any of them change (debounced 800 ms)
  // This means exportMode / format / quality / scale all persist without a manual save click.
  useEffect(() => {
    if (!appSettingsDefaults || !hasRestoredSidebar.current) return;

    const timeoutId = setTimeout(() => {
      saveAppSettings.mutate({
        ...appSettingsDefaults,
        exportFormat,
        exportQuality,
        exportScale,
        exportMode,
      });
    }, 800);

    return () => clearTimeout(timeoutId);
  }, [exportFormat, exportQuality, exportScale, exportMode]);

  // Note: Print configuration auto-save is handled in useShapeEditor along with 
  // other artboard settings. This keeps all artboard-related persistence in one place.

  // Save app settings handler
  const handleSaveAppSettings = useCallback(async () => {
    const activeBoard = artboards.find(a => a.id === activeArtboard);
    if (!activeBoard) {
      console.error('No active artboard found');
      return;
    }
    
    // Get print configuration from active artboard (or use defaults)
    const printConfig = activeBoard.printConfig || DEFAULT_PRINT_CONFIG;
    
    const settings = {
      exportFormat,
      exportQuality,
      exportScale,
      exportMode,
      artboardName: activeBoard.name,
      artboardWidth: activeBoard.width,
      artboardHeight: activeBoard.height,
      artboardBackgroundColor: activeBoard.backgroundColor || '#ffffff',
      artboardGridColor: activeBoard.gridColor || '#cccccc',
      artboardDisplayGrid: activeBoard.displayGrid || false,
      artboardDisplayBorder: activeBoard.displayBorder !== undefined ? activeBoard.displayBorder : true,
      artboardDpi: activeBoard.dpi ?? 72,
      artboardUnitType: activeBoard.unitType ?? 'pixels',
      artboardDisplayName: activeBoard.displayName !== false,
      artboardDisplayDimensions: activeBoard.displayDimensions === true,
      artboardDisplayResolution: activeBoard.displayResolution === true,
      canvasPanX: appSettingsDefaults?.canvasPanX ?? 0,
      canvasPanY: appSettingsDefaults?.canvasPanY ?? 0,
      canvasZoom: appSettingsDefaults?.canvasZoom ?? 1,
      sidebarCollapsed: isCollapsed,
      showMultiSelectButton: appSettingsDefaults?.showMultiSelectButton ?? true,
      showSelectedCount: appSettingsDefaults?.showSelectedCount ?? true,
      printOverlayUnit: printConfig.overlays.overlayUnit || 'pixels',
      printBleedAmount: printConfig.overlays.bleed.amount,
      printBleedDisplay: printConfig.overlays.bleed.display,
      printBleedRender: printConfig.overlays.bleed.render,
      printBleedColor: printConfig.overlays.bleed.color || '#00FFFF',
      printSafeZoneAmount: printConfig.overlays.safeZone.amount,
      printSafeZoneDisplay: printConfig.overlays.safeZone.display,
      printSafeZoneColor: printConfig.overlays.safeZone.color || '#FF00FF',
      printMarksCropMarks: printConfig.overlays.printMarks.cropMarks,
      printMarksRegistrationMarks: printConfig.overlays.printMarks.registrationMarks,
      printMarksMarkLength: printConfig.overlays.printMarks.markLength,
      printMarksMarkOffset: printConfig.overlays.printMarks.markOffset,
      printMarksDisplay: printConfig.overlays.printMarks.display,
      printMarksRender: printConfig.overlays.printMarks.render,
      printMarksScaleMode: printConfig.overlays.printMarks.scaleMode || 'none',
      printMarksColor: printConfig.overlays.printMarks.color || '#000000',
    };
    
    setIsSavingAppSettings(true);
    try {
      await saveAppSettings.mutateAsync(settings);
      toast({ title: 'App settings saved' });
    } catch (error) {
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Failed to save app settings',
        variant: 'destructive'
      });
    } finally {
      setIsSavingAppSettings(false);
    }
  }, [exportFormat, exportQuality, exportScale, exportMode, artboards, activeArtboard, saveAppSettings, isCollapsed, appSettingsDefaults, toast]);

  // Load app settings handler
  const handleLoadAppSettings = useCallback(() => {
    if (appSettingsDefaults) {
      console.log('Loading app settings:', appSettingsDefaults);
      setExportFormat(appSettingsDefaults.exportFormat);
      setExportQuality(appSettingsDefaults.exportQuality);
      setExportScale(appSettingsDefaults.exportScale);
      setExportMode(appSettingsDefaults.exportMode);
      
      // Build print configuration from app settings (if available)
      const printConfig: PrintConfig = {
        outputSpecs: {
          dpi: appSettingsDefaults.artboardDpi ?? DEFAULT_PRINT_CONFIG.outputSpecs.dpi,
          unitType: appSettingsDefaults.artboardUnitType ?? DEFAULT_PRINT_CONFIG.outputSpecs.unitType,
        },
        overlays: {
          overlayUnit: appSettingsDefaults.printOverlayUnit ?? DEFAULT_PRINT_CONFIG.overlays.overlayUnit,
          bleed: {
            amount: appSettingsDefaults.printBleedAmount ?? DEFAULT_PRINT_CONFIG.overlays.bleed.amount,
            display: appSettingsDefaults.printBleedDisplay ?? DEFAULT_PRINT_CONFIG.overlays.bleed.display,
            render: appSettingsDefaults.printBleedRender ?? DEFAULT_PRINT_CONFIG.overlays.bleed.render,
            color: appSettingsDefaults.printBleedColor ?? DEFAULT_PRINT_CONFIG.overlays.bleed.color,
          },
          safeZone: {
            amount: appSettingsDefaults.printSafeZoneAmount ?? DEFAULT_PRINT_CONFIG.overlays.safeZone.amount,
            display: appSettingsDefaults.printSafeZoneDisplay ?? DEFAULT_PRINT_CONFIG.overlays.safeZone.display,
            color: appSettingsDefaults.printSafeZoneColor ?? DEFAULT_PRINT_CONFIG.overlays.safeZone.color,
          },
          printMarks: {
            cropMarks: appSettingsDefaults.printMarksCropMarks ?? DEFAULT_PRINT_CONFIG.overlays.printMarks.cropMarks,
            registrationMarks: appSettingsDefaults.printMarksRegistrationMarks ?? DEFAULT_PRINT_CONFIG.overlays.printMarks.registrationMarks,
            markLength: appSettingsDefaults.printMarksMarkLength ?? DEFAULT_PRINT_CONFIG.overlays.printMarks.markLength,
            markOffset: appSettingsDefaults.printMarksMarkOffset ?? DEFAULT_PRINT_CONFIG.overlays.printMarks.markOffset,
            display: appSettingsDefaults.printMarksDisplay ?? DEFAULT_PRINT_CONFIG.overlays.printMarks.display,
            render: appSettingsDefaults.printMarksRender ?? DEFAULT_PRINT_CONFIG.overlays.printMarks.render,
            scaleMode: appSettingsDefaults.printMarksScaleMode ?? DEFAULT_PRINT_CONFIG.overlays.printMarks.scaleMode,
            color: appSettingsDefaults.printMarksColor ?? DEFAULT_PRINT_CONFIG.overlays.printMarks.color,
          },
          background: DEFAULT_PRINT_CONFIG.overlays.background,
        },
      };
      
      // Apply artboard settings to the active artboard
      const activeBoard = artboards.find(a => a.id === activeArtboard);
      if (activeBoard && onUpdateArtboard) {
        onUpdateArtboard(activeArtboard, {
          width: appSettingsDefaults.artboardWidth,
          height: appSettingsDefaults.artboardHeight,
          backgroundColor: appSettingsDefaults.artboardBackgroundColor,
          gridColor: appSettingsDefaults.artboardGridColor,
          displayGrid: appSettingsDefaults.artboardDisplayGrid,
          displayBorder: appSettingsDefaults.artboardDisplayBorder,
          dpi: appSettingsDefaults.artboardDpi,
          unitType: appSettingsDefaults.artboardUnitType,
          displayName: appSettingsDefaults.artboardDisplayName,
          displayDimensions: appSettingsDefaults.artboardDisplayDimensions,
          displayResolution: appSettingsDefaults.artboardDisplayResolution,
          printConfig: printConfig,
        });
      }
    }
  }, [appSettingsDefaults, artboards, activeArtboard, onUpdateArtboard]);

  // Project load handler - loads project file after user confirms in dialog
  const handleLoadProjectFile = useCallback(async (file: File, clearSettings: boolean = false) => {
    setIsLoadingProject(true);
    try {
      const { ProjectManager } = await import('../lib/projectManager');
      const projectData = await ProjectManager.loadProject(file);
      console.log('Project loaded:', projectData);
      
      // If clearing settings, reset to defaults
      if (clearSettings) {
        console.log('🔄 Clearing settings and resetting to defaults...');
        
        // Reset export settings to defaults
        setExportFormat('png');
        setExportQuality(90);
        setExportScale(1);
        setExportMode('all');
        
        // Clear generation sets (start fresh)
        if (onClearAll) {
          onClearAll();
        }
        
        console.log('✅ Settings cleared, loading project fresh');
      }
      
      if (onLoadProject) {
        onLoadProject({
          shapes: projectData.shapes,
          groups: projectData.groups,
          artboard: projectData.artboard
        });
        console.log('✅ Project loaded successfully!');
      } else {
        console.warn('⚠️ onLoadProject callback not available');
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error('❌ Failed to load project:', error);
      toast({
        title: 'Load failed',
        description: error instanceof Error ? error.message : 'Failed to load project file',
        variant: 'destructive'
      });
    } finally {
      setIsLoadingProject(false);
    }
  }, [onLoadProject, onClearAll, toast]);

  // Generator file load handler — restores shape sets + artboard without touching generated shapes
  const handleLoadGeneratorFile = useCallback(async (file: File) => {
    setIsLoadingGenerator(true);
    try {
      const { ProjectManager } = await import('../lib/projectManager');
      const data = await ProjectManager.loadGeneratorProject(file);

      const setPlan = planShapeSetImport(
        data.generationSets,
        generationSets,
        generatorSetImportMode,
        {},
        data.currentSetId,
        currentGenerationSetId,
        overlayManagerState,
      );
      const currentBoard = artboards.find(board => board.id === activeArtboard);
      if (!currentBoard) throw new Error('No active artboard is available for this import.');
      const importedBoard = {
        ...currentBoard,
        id: `generator-import-${Date.now()}`,
        name: data.artboard.name || currentBoard.name,
        width: data.artboard.width,
        height: data.artboard.height,
        backgroundColor: data.artboard.backgroundColor,
        dpi: data.artboard.dpi,
        unitType: data.artboard.unitType,
        displayGrid: data.artboard.displayGrid,
        displayBorder: data.artboard.displayBorder,
        displayName: data.artboard.displayName,
        displayDimensions: data.artboard.displayDimensions,
        displayResolution: data.artboard.displayResolution,
        printConfig: data.artboard.printConfig,
      };
      const boardPlan = planArtboardImport([importedBoard], artboards, activeArtboard, generatorArtboardImportMode, importedBoard.id);
      if (onLoadGeneratorState) {
        await onLoadGeneratorState({
          generationSets: setPlan.generationSets,
          currentSetId: setPlan.currentSetId,
          artboards: boardPlan.artboards as typeof artboards,
          activeArtboardId: boardPlan.activeArtboardId || activeArtboard,
          overlayManagerState: setPlan.overlayManagerState,
        });
      } else {
        // Fallback for callers that haven't adopted onLoadGeneratorState yet
        onGenerationSetsChange?.(data.generationSets);
        onCurrentGenerationSetChange?.(data.currentSetId);
      }

      toast({
        title: 'Generator loaded',
        description: `${generatorSetImportMode === 'append' ? 'Appended' : generatorSetImportMode === 'replace' ? 'Replaced' : 'Skipped'} ${data.generationSets.length} shape set${data.generationSets.length !== 1 ? 's' : ''}; ${generatorArtboardImportMode === 'add' ? 'added' : generatorArtboardImportMode === 'replace-active' ? 'replaced the active' : generatorArtboardImportMode === 'replace-all' ? 'replaced all' : 'skipped'} artboard configuration from "${data.projectName}".`
      });
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      toast({
        title: 'Load failed',
        description: error instanceof Error ? error.message : 'Failed to load generator file',
        variant: 'destructive'
      });
    } finally {
      setIsLoadingGenerator(false);
    }
  }, [onLoadGeneratorState, onGenerationSetsChange, onCurrentGenerationSetChange, generationSets, currentGenerationSetId, artboards, activeArtboard, overlayManagerState, generatorSetImportMode, generatorArtboardImportMode, toast]);

  const applyPortableImport = useCallback(async (pending: { kind: 'sets' | 'artboards'; data: any }) => {
    const { kind, data } = pending;
    if (!onLoadGeneratorState) throw new Error('Configuration import is unavailable.');
    if (kind === 'sets') {
      const plan = planShapeSetImport(data.sets, generationSets, portableSetImportMode, {}, data.currentSetId, currentGenerationSetId, overlayManagerState, data.overlayManagerState as OverlayManagerState | undefined);
      await onLoadGeneratorState({ generationSets: plan.generationSets, currentSetId: plan.currentSetId, artboards, activeArtboardId: activeArtboard, overlayManagerState: plan.overlayManagerState });
      toast({ title: 'Shape sets imported', description: `${portableSetImportMode === 'append' ? 'Kept existing and added' : portableSetImportMode === 'replace' ? 'Replaced with' : 'Skipped'} ${data.sets.length} set${data.sets.length === 1 ? '' : 's'}.` });
    } else {
      const plan = planArtboardImport(data.artboards, artboards, activeArtboard, portableArtboardImportMode, data.activeArtboardId);
      await onLoadGeneratorState({ generationSets, currentSetId: currentGenerationSetId, artboards: plan.artboards as typeof artboards, activeArtboardId: plan.activeArtboardId || activeArtboard, overlayManagerState });
      toast({ title: 'Artboards imported', description: `${portableArtboardImportMode === 'add' ? 'Added' : portableArtboardImportMode === 'skip' ? 'Skipped' : 'Replaced'} ${data.artboards.length} artboard${data.artboards.length === 1 ? '' : 's'}.` });
    }
  }, [onLoadGeneratorState, generationSets, currentGenerationSetId, artboards, activeArtboard, overlayManagerState, portableSetImportMode, portableArtboardImportMode, toast]);

  const handleLoadShapeSetsFile = useCallback(async (file: File) => {
    try {
      const { ProjectManager } = await import('../lib/projectManager');
      const { data, diagnostics } = await ProjectManager.loadShapeSetsProject(file);
      setPendingPortableImport({ kind: 'sets', data, diagnostics });
      setIsPortableImportDialogOpen(true);
      return;
    } catch (error) {
      toast({ title: 'Import failed', description: error instanceof Error ? error.message : 'Failed to import shape sets.', variant: 'destructive' });
    }
  }, [toast]);

  const handleLoadArtboardsFile = useCallback(async (file: File) => {
    try {
      const { ProjectManager } = await import('../lib/projectManager');
      const { data, diagnostics } = await ProjectManager.loadArtboardsProject(file);
      setPendingPortableImport({ kind: 'artboards', data, diagnostics });
      setIsPortableImportDialogOpen(true);
      return;
    } catch (error) {
      toast({ title: 'Import failed', description: error instanceof Error ? error.message : 'Failed to import artboards.', variant: 'destructive' });
    }
  }, [toast]);

  // Effective export scale = manual exportScale only.
  // Auto-scale-from-DPI was removed (2026-05) — artboard pixel dimensions are now the
  // single source of truth for export output size. Use the Scale slider to override.
  const effectiveExportScale = useMemo(() => exportScale, [exportScale]);

  // Auto-select artboard when export mode changes to 'artboard'
  useEffect(() => {
    if ((exportMode === 'artboard' || exportMode === 'artboard-extended') && artboards.length > 0) {
      // If no artboard is selected, auto-select one
      if (!selectedArtboardForExport) {
        // First try to select the active artboard
        const activeBoard = artboards.find(a => a.id === activeArtboard);
        if (activeBoard) {
          setSelectedArtboardForExport(activeBoard.id);
        } else {
          // Otherwise select the first artboard
          setSelectedArtboardForExport(artboards[0].id);
        }
      }
    }
  }, [exportMode, artboards, activeArtboard, selectedArtboardForExport]);

  // Sync selectedArtboardForExport with activeArtboard to ensure exports use current print config
  // This prevents the bug where UI shows print marks enabled but export uses a different artboard's config
  useEffect(() => {
    if (activeArtboard && artboards.find(a => a.id === activeArtboard)) {
      setSelectedArtboardForExport(activeArtboard);
    }
  }, [activeArtboard, artboards]);

  // Generation sets handlers - now simplified since validation logic is centralized
  const handleSetChange = useCallback((setId: string | null) => {
    // The enhanced validation and state restoration logic is now handled centrally
    // in useShapeEditor's handleCurrentGenerationSetChange function
    onCurrentGenerationSetChange?.(setId);
  }, [onCurrentGenerationSetChange]);


  const handleDeleteSet = useCallback((setId: string) => {
    // Call the actual handler from parent component
    onDeleteGenerationSet?.(setId);
    console.log('Deleted generation set:', setId);
  }, [onDeleteGenerationSet]);

  const handleOpenManager = useCallback(() => {
    onOpenGenerationSetsManager?.();
  }, [onOpenGenerationSetsManager]);

  // Define handlePopoverToggle function
  const handlePopoverToggle = (sectionId: string) => {
    setActivePopover(activePopover === sectionId ? null : sectionId);
  };

  // Helper functions for content sections
  function SelectionModesContent() {
    const editModes = [
      { id: 'shapes', name: 'Shapes', icon: MousePointer, desc: 'Select and transform entire shapes' },
      { id: 'points', name: 'Points', icon: Edit3, desc: 'Edit individual points' },
      { id: 'segments', name: 'Segments', icon: Activity, desc: 'Edit curve segments' }
    ];

    return (
      <div className="space-y-4">
        <div className="text-sm text-slate-400">
          Current Mode: <span className="text-white font-medium">{editMode}</span>
        </div>

        {editModes.map((mode) => {
          const IconComponent = mode.icon;
          const isActive = editMode === mode.id;

          return (
            <div key={mode.id} className={`p-3 rounded-lg transition-colors cursor-pointer ${
              isActive ? 'bg-orange-900/30 border border-orange-500/50' : 'bg-slate-800/50 hover:bg-slate-700/50'
            }`} onClick={() => onSetEditMode(mode.id as any)}>
              <div className="flex items-center space-x-3">
                <IconComponent className={`w-5 h-5 transition-colors ${
                  isActive ? 'text-orange-400' : 'text-slate-400'
                }`} />
                <div>
                  <div className={`text-sm font-medium transition-colors ${
                    isActive ? 'text-orange-200' : 'text-slate-300'
                  }`}>{mode.name}</div>
                  <div className="text-xs text-slate-500">{mode.desc}</div>
                </div>
              </div>
            </div>
          );
        })}

        {editMode === 'points' && selectedPointsCount > 0 && (
          <div className="p-2 bg-blue-500/20 border border-blue-500/30 rounded-lg">
            <div className="text-xs text-blue-200">
              {selectedPointsCount} point{selectedPointsCount !== 1 ? 's' : ''} selected
            </div>
          </div>
        )}

        {editMode === 'segments' && selectedSegmentsCount > 0 && (
          <div className="p-2 bg-green-500/20 border border-green-500/30 rounded-lg">
            <div className="text-xs text-green-200">
              {selectedSegmentsCount} segment{selectedSegmentsCount !== 1 ? 's' : ''} selected
            </div>
          </div>
        )}

        <Separator className="bg-slate-700" />

        <div className="space-y-4">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            UI Element Visibility
          </div>

          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-800/50">
            <Label htmlFor="toggle-selected-count" className="text-sm text-slate-300 cursor-pointer">
              Show selected count overlay
            </Label>
            <Switch
              id="toggle-selected-count"
              checked={showSelectedCount}
              onCheckedChange={onSetShowSelectedCount}
              data-testid="toggle-selected-count"
            />
          </div>
        </div>
      </div>
    );
  }

  function ArtboardsContent() {
    const [customWidth, setCustomWidth] = useState(8.27); // Width in current unit (A4 default)
    const [customHeight, setCustomHeight] = useState(11.69); // Height in current unit (A4 default)
    const [customName, setCustomName] = useState('Custom Artboard');
    const [customBackgroundColor, setCustomBackgroundColor] = useState('#ffffff');
    const [customLinkedDimensions, setCustomLinkedDimensions] = useState(true);
    const [customAspectRatio, setCustomAspectRatio] = useState('1:√2'); // A4 aspect ratio
    const [customUnit, setCustomUnit] = useState<UnitType>('inches');
    const [customDpi, setCustomDpi] = useState(300); // Default to print-quality 300 DPI
    // Per-artboard Resample toggle. State lives at Sidebar scope (see comment there)
    // so it survives ArtboardsContent remounts that happen on every parent re-render.
    const resampleOnDpiChange = resampleByArtboardId[activeArtboard] ?? false;
    const setResampleOnDpiChange = (next: boolean) => {
      setResampleByArtboardId(prev => ({ ...prev, [activeArtboard]: next }));
    };
    const [presetUnit, setPresetUnit] = useState<UnitType>(() => {
      try {
        const saved = localStorage.getItem('artboard-preset-unit');
        return (['pixels', 'inches', 'mm', 'cm'].includes(saved || '') ? saved as UnitType : 'pixels');
      } catch {
        return 'pixels';
      }
    });
    const [matboardToggles, setMatboardToggles] = useState<Record<string, boolean>>({});
    
    // Persist tab and category in localStorage
    const [selectedPresetCategory, setSelectedPresetCategory] = useState<PresetCategory>(() => {
      try {
        const saved = localStorage.getItem('artboard-preset-category');
        return (saved as PresetCategory) || 'paper';
      } catch {
        return 'paper';
      }
    });
    const [activeTab, setActiveTab] = useState<'custom' | 'presets'>(() => {
      try {
        const saved = localStorage.getItem('artboard-create-tab');
        return (saved === 'custom' || saved === 'presets') ? saved : 'custom';
      } catch {
        return 'custom';
      }
    });
    
    // Parent tab state (Active vs Create) with localStorage persistence
    const [parentTab, setParentTab] = useState<'active' | 'create'>(() => {
      try {
        const saved = localStorage.getItem('artboard-parent-tab');
        return (saved === 'active' || saved === 'create') ? saved : 'active';
      } catch {
        return 'active';
      }
    });
    
    // Persist parent tab selection to localStorage
    const handleParentTabChange = (tab: 'active' | 'create') => {
      setParentTab(tab);
      try {
        localStorage.setItem('artboard-parent-tab', tab);
      } catch {}
    };
    
    // Persist nested tab selection to localStorage
    const handleTabChange = (tab: 'custom' | 'presets') => {
      setActiveTab(tab);
      try {
        localStorage.setItem('artboard-create-tab', tab);
      } catch {}
    };
    
    // Persist category selection to localStorage
    const handleCategoryChange = (category: PresetCategory) => {
      setSelectedPresetCategory(category);
      setMatboardToggles({});
      try {
        localStorage.setItem('artboard-preset-category', category);
      } catch {}
    };

    // Persist preset unit selection to localStorage
    const handlePresetUnitChange = (unit: UnitType) => {
      setPresetUnit(unit);
      try {
        localStorage.setItem('artboard-preset-unit', unit);
      } catch {}
    };
    
    // Calculate live pixel dimensions from physical dimensions and DPI
    const livePixelWidth = customUnit === 'pixels' 
      ? Math.round(customWidth) 
      : Math.round(unitToPixels(customWidth, customDpi, customUnit));
    const livePixelHeight = customUnit === 'pixels' 
      ? Math.round(customHeight) 
      : Math.round(unitToPixels(customHeight, customDpi, customUnit));
    
    const handleWidthChange = (newWidth: number) => {
      if (customLinkedDimensions && customWidth > 0) {
        const aspectRatio = customWidth / customHeight;
        const newHeight = newWidth / aspectRatio;
        setCustomWidth(newWidth);
        setCustomHeight(newHeight);
      } else {
        setCustomWidth(newWidth);
        setCustomAspectRatio('custom');
      }
    };
    
    const handleHeightChange = (newHeight: number) => {
      if (customLinkedDimensions && customHeight > 0) {
        const aspectRatio = customWidth / customHeight;
        const newWidth = newHeight * aspectRatio;
        setCustomWidth(newWidth);
        setCustomHeight(newHeight);
      } else {
        setCustomHeight(newHeight);
        setCustomAspectRatio('custom');
      }
    };
    
    const handleAspectRatioChange = (value: string) => {
      if (value === 'custom') {
        setCustomAspectRatio('custom');
      } else {
        const [w, h] = value.split(':').map(Number);
        const aspectRatioValue = w / h;
        const newHeight = customWidth / aspectRatioValue;
        setCustomHeight(newHeight);
        setCustomAspectRatio(value);
        setCustomLinkedDimensions(true);
      }
    };
    
    const handleCreateCustomArtboard = () => {
      const customPreset = {
        name: customName,
        width: livePixelWidth,
        height: livePixelHeight,
        dpi: customDpi,
        unitType: customUnit,
        backgroundColor: customBackgroundColor,
        category: 'custom' as const,
        description: `${livePixelWidth}×${livePixelHeight}px at ${customDpi} DPI`
      };
      onAddArtboard(customPreset);
    };
    
    // Handle selecting a preset - populate the form with preset values then switch to custom tab
    const handlePresetSelect = (preset: ArtboardPresetPhysical) => {
      const useMatboard = matboardToggles[preset.id] && preset.matboardWidthInches !== undefined;
      const widthIn = useMatboard ? preset.matboardWidthInches! : preset.widthInches;
      const heightIn = useMatboard ? preset.matboardHeightInches! : preset.heightInches;
      // Reset matboard toggles for all other presets when a new preset is chosen
      setMatboardToggles((prev) => {
        const next: Record<string, boolean> = {};
        if (prev[preset.id]) next[preset.id] = prev[preset.id];
        return next;
      });
      setCustomName(preset.name + (useMatboard ? ' (matboard)' : ''));
      if (preset.nativeWidthPx !== undefined && preset.nativeHeightPx !== undefined && !useMatboard) {
        setCustomWidth(preset.nativeWidthPx);
        setCustomHeight(preset.nativeHeightPx);
        setCustomUnit('pixels');
      } else {
        setCustomWidth(widthIn);
        setCustomHeight(heightIn);
        setCustomUnit('inches');
      }
      const aspectRatio = useMatboard
        ? calculateAspectRatio(widthIn, heightIn)
        : preset.aspectRatio;
      setCustomAspectRatio(aspectRatio);
      setCustomLinkedDimensions(true);
      setActiveTab('custom');
    };
    
    // Handle quick create from preset - create artboard immediately
    const handlePresetQuickCreate = (preset: ArtboardPresetPhysical) => {
      const useMatboard = matboardToggles[preset.id] && preset.matboardWidthInches !== undefined;
      // Keep only this preset's toggle, clear others
      setMatboardToggles((prev) => {
        const next: Record<string, boolean> = {};
        if (prev[preset.id]) next[preset.id] = prev[preset.id];
        return next;
      });
      let pixelDims: { width: number; height: number };
      if (useMatboard) {
        pixelDims = {
          width: Math.round(preset.matboardWidthInches! * customDpi),
          height: Math.round(preset.matboardHeightInches! * customDpi),
        };
      } else {
        pixelDims = getPresetPixelDimensions(preset, customDpi);
      }
      const newPreset = {
        name: preset.name + (useMatboard ? ' (matboard)' : ''),
        width: pixelDims.width,
        height: pixelDims.height,
        dpi: customDpi,
        unitType: 'inches' as const,
        backgroundColor: customBackgroundColor,
        category: 'print' as const,
        description: `${pixelDims.width}×${pixelDims.height}px at ${customDpi} DPI`
      };
      onAddArtboard(newPreset);
    };
    
    // Handle unit change - convert existing values to new unit via pixels as intermediate
    const handleUnitChange = (newUnit: UnitType) => {
      if (newUnit === customUnit) return;
      
      // Step 1: Convert current values to pixels (using current unit)
      const widthPixels = customUnit === 'pixels' 
        ? customWidth 
        : unitToPixels(customWidth, customDpi, customUnit);
      const heightPixels = customUnit === 'pixels' 
        ? customHeight 
        : unitToPixels(customHeight, customDpi, customUnit);
      
      // Step 2: Convert pixels to new unit
      if (newUnit === 'pixels') {
        setCustomWidth(Math.round(widthPixels));
        setCustomHeight(Math.round(heightPixels));
      } else {
        const newWidth = pixelsToUnit(widthPixels, customDpi, newUnit);
        const newHeight = pixelsToUnit(heightPixels, customDpi, newUnit);
        
        // Format based on unit type
        if (newUnit === 'mm') {
          setCustomWidth(Math.round(newWidth));
          setCustomHeight(Math.round(newHeight));
        } else {
          setCustomWidth(Number(newWidth.toFixed(2)));
          setCustomHeight(Number(newHeight.toFixed(2)));
        }
      }
      
      setCustomUnit(newUnit);
    };

    return (
      <div className="space-y-4">
        {/* Section 1: Existing Artboards (at top) */}
        <div className="space-y-3">
          <Label className="text-xs text-slate-400">Artboards</Label>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {artboards.map((artboard) => {
              const isActive = artboard.id === activeArtboard;
              return (
                <div 
                  key={artboard.id} 
                  className={`flex items-center justify-between p-2 rounded text-xs transition-colors cursor-pointer ${
                    isActive 
                      ? 'bg-orange-500/30 border border-orange-500/50' 
                      : 'bg-slate-800/50 hover:bg-slate-700/50 border border-transparent'
                  }`}
                  onClick={() => onSelectArtboard(artboard.id)}
                  data-testid={`artboard-item-${artboard.id}`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {isActive && (
                      <CheckCircle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className={`truncate ${isActive ? 'text-orange-200 font-medium' : 'text-slate-300'}`}>
                        {artboard.name}
                      </div>
                      <div className="text-slate-500 text-[10px]">{artboard.width}×{artboard.height}px</div>
                    </div>
                  </div>
                  <div className="flex space-x-1 flex-shrink-0">
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteArtboard(artboard.id);
                      }}
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-slate-400 hover:text-red-400"
                      disabled={artboards.length <= 1}
                      data-testid={`button-delete-artboard-${artboard.id}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {artboards.length === 0 && (
            <div className="text-xs text-slate-500 text-center py-4">
              No artboards created
            </div>
          )}
        </div>

        <Separator className="bg-slate-700" />

        {/* Parent Tabs: Active / Create */}
        <Tabs value={parentTab} onValueChange={(v) => handleParentTabChange(v as 'active' | 'create')} className="w-full">
          <TabsList className="flex gap-2 w-full bg-transparent p-0 h-auto">
            <TabsTrigger 
              value="active" 
              className="flex-1 text-xs text-slate-400 rounded-md border border-slate-600 bg-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:border-blue-600 data-[state=active]:text-white h-8"
              data-testid="tab-active-artboard"
            >
              Active
            </TabsTrigger>
            <TabsTrigger 
              value="create" 
              className="flex-1 text-xs text-slate-400 rounded-md border border-slate-600 bg-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:border-blue-600 data-[state=active]:text-white h-8"
              data-testid="tab-create-artboard"
            >
              Create
            </TabsTrigger>
          </TabsList>
          
          {/* Create Tab Content */}
          <TabsContent value="create" className="mt-2">
            <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as 'custom' | 'presets')} className="w-full">
              <TabsList className="flex gap-2 w-full bg-transparent p-0 h-auto">
                <TabsTrigger 
                  value="custom" 
                  className="flex-1 text-xs text-slate-400 rounded-md border border-slate-600 bg-slate-700 data-[state=active]:bg-blue-600 data-[state=active]:border-blue-600 data-[state=active]:text-white h-7"
                  data-testid="tab-custom"
                >
                  Custom
                </TabsTrigger>
                <TabsTrigger 
                  value="presets" 
                  className="flex-1 text-xs text-slate-400 rounded-md border border-slate-600 bg-slate-700 data-[state=active]:bg-blue-600 data-[state=active]:border-blue-600 data-[state=active]:text-white h-7"
                  data-testid="tab-presets"
                >
                  Presets
                </TabsTrigger>
              </TabsList>
            
            {/* Custom Tab Content */}
            <TabsContent value="custom" className="mt-2">
              <div className="space-y-3 p-3 bg-slate-800/50 rounded-lg border border-slate-600">
                <div className="space-y-2">
                  <Label className="text-xs text-slate-400">Name</Label>
                  <Input
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="Custom Artboard"
                    className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200"
                    data-testid="input-artboard-name"
                  />
                </div>
                
                {/* Unit and DPI row */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400">Unit</Label>
                    <Select
                      value={customUnit}
                      onValueChange={(value) => handleUnitChange(value as UnitType)}
                    >
                      <SelectTrigger className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200 artboard-select" data-testid="select-artboard-unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent style={{ zIndex: 10002 }}>
                        <SelectItem value="pixels">Pixels (px)</SelectItem>
                        <SelectItem value="inches">Inches (in)</SelectItem>
                        <SelectItem value="mm">Millimeters (mm)</SelectItem>
                        <SelectItem value="cm">Centimeters (cm)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400">DPI</Label>
                    <Select
                      value={String(customDpi)}
                      onValueChange={(value) => setCustomDpi(Number(value))}
                    >
                      <SelectTrigger className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200 artboard-select" data-testid="select-artboard-dpi">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent style={{ zIndex: 10002 }}>
                        {DPI_PRESETS.map((preset) => (
                          <SelectItem key={preset.value} value={String(preset.value)}>
                            {preset.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-slate-400">Dimensions ({getUnitLabel(customUnit)})</Label>
                    <div className="flex items-center gap-1">
                      {/* Portrait/Landscape Toggle */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-6 w-6 p-0 ${customWidth <= customHeight ? 'text-blue-400 bg-blue-500/10' : 'text-slate-500 hover:text-slate-300'}`}
                        onClick={() => {
                          if (customWidth > customHeight) {
                            const temp = customWidth;
                            setCustomWidth(customHeight);
                            setCustomHeight(temp);
                          }
                        }}
                        title="Portrait orientation"
                        data-testid="button-custom-orientation-portrait"
                      >
                        <RectangleVertical className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-6 w-6 p-0 ${customWidth > customHeight ? 'text-blue-400 bg-blue-500/10' : 'text-slate-500 hover:text-slate-300'}`}
                        onClick={() => {
                          if (customWidth <= customHeight) {
                            const temp = customWidth;
                            setCustomWidth(customHeight);
                            setCustomHeight(temp);
                          }
                        }}
                        title="Landscape orientation"
                        data-testid="button-custom-orientation-landscape"
                      >
                        <RectangleHorizontal className="w-3.5 h-3.5" />
                      </Button>
                      {/* Link Dimensions Toggle */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-6 px-2 ${customLinkedDimensions ? 'text-blue-400 bg-blue-500/10' : 'text-slate-500'}`}
                        onClick={() => {
                          setCustomLinkedDimensions(!customLinkedDimensions);
                          if (!customLinkedDimensions) {
                            setCustomAspectRatio('custom');
                          }
                        }}
                        title={customLinkedDimensions ? 'Unlock dimensions' : 'Lock dimensions (maintain aspect ratio)'}
                        data-testid="button-link-custom-dimensions"
                      >
                        {customLinkedDimensions ? (
                          <Link2 className="w-3.5 h-3.5" />
                        ) : (
                          <Unlink2 className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label className="text-[10px] text-slate-500">Width</Label>
                      <BufferedNumericInput
                        value={customWidth}
                        onCommit={handleWidthChange}
                        min={customUnit === 'pixels' ? 1 : 0.1}
                        max={customUnit === 'pixels' ? 20000 : 100}
                        step={customUnit === 'pixels' ? 1 : (customUnit === 'mm' ? 1 : 0.1)}
                        className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200"
                        data-testid="input-custom-width"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] text-slate-500">Height</Label>
                      <BufferedNumericInput
                        value={customHeight}
                        onCommit={handleHeightChange}
                        min={customUnit === 'pixels' ? 1 : 0.1}
                        max={customUnit === 'pixels' ? 20000 : 100}
                        step={customUnit === 'pixels' ? 1 : (customUnit === 'mm' ? 1 : 0.1)}
                        className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200"
                        data-testid="input-custom-height"
                      />
                    </div>
                  </div>
                </div>
                
                {/* Live pixel preview - only show when not in pixel mode */}
                {customUnit !== 'pixels' && (
                  <div className="text-xs text-slate-400 bg-slate-900/50 p-2 rounded border border-slate-700">
                    <span className="text-slate-500">Output:</span> <span className="text-slate-400">{livePixelWidth} × {livePixelHeight} px</span>
                    <span className="text-slate-500 ml-2">({(livePixelWidth * livePixelHeight / 1000000).toFixed(1)} MP)</span>
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label className="text-xs text-slate-400">Background Color</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={customBackgroundColor}
                      onChange={(e) => setCustomBackgroundColor(e.target.value)}
                      className="h-7 w-12 p-1 bg-slate-700 border-slate-600"
                      data-testid="input-artboard-bg-color"
                    />
                    <Input
                      type="text"
                      value={customBackgroundColor}
                      onChange={(e) => setCustomBackgroundColor(e.target.value)}
                      placeholder="#ffffff"
                      className="h-7 flex-1 text-xs bg-slate-700 border-slate-600 text-slate-200"
                    />
                  </div>
                </div>
                <Button
                  onClick={handleCreateCustomArtboard}
                  className="w-full h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                  data-testid="button-create-artboard"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Create Artboard
                </Button>
              </div>
            </TabsContent>
            
            {/* Presets Tab Content */}
            <TabsContent value="presets" className="mt-2">
              <div className="space-y-3">
                {/* DPI and unit selectors for presets */}
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-slate-400 whitespace-nowrap">DPI:</Label>
                  <Select
                    value={String(customDpi)}
                    onValueChange={(value) => setCustomDpi(Number(value))}
                  >
                    <SelectTrigger className="h-7 text-xs bg-slate-700 border-slate-600 flex-1" data-testid="select-preset-dpi">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ zIndex: 10002 }}>
                      {DPI_PRESETS.map((dpiPreset) => (
                        <SelectItem key={dpiPreset.value} value={String(dpiPreset.value)}>
                          {dpiPreset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={presetUnit}
                    onValueChange={(value) => handlePresetUnitChange(value as UnitType)}
                  >
                    <SelectTrigger className="h-7 text-xs bg-slate-700 border-slate-600 w-20" data-testid="select-preset-unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ zIndex: 10002 }}>
                      <SelectItem value="pixels">px</SelectItem>
                      <SelectItem value="inches">in</SelectItem>
                      <SelectItem value="mm">mm</SelectItem>
                      <SelectItem value="cm">cm</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Category selector */}
                <Select
                  value={selectedPresetCategory}
                  onValueChange={(value) => handleCategoryChange(value as PresetCategory)}
                >
                  <SelectTrigger className="h-8 text-xs bg-slate-700 border-slate-600" data-testid="select-preset-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent style={{ zIndex: 10002 }}>
                    {PRESET_CATEGORIES.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {/* Presets for selected category */}
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {getPresetsByCategory(selectedPresetCategory).map((preset) => {
                    const hasMatboard = preset.matboardWidthInches !== undefined;
                    const matboardOn = !!(matboardToggles[preset.id] && hasMatboard);
                    const displayPreset = matboardOn
                      ? { ...preset, widthInches: preset.matboardWidthInches!, heightInches: preset.matboardHeightInches! }
                      : preset;
                    const dimLabel = formatPresetDimensions(displayPreset, presetUnit, customDpi);
                    return (
                      <div
                        key={preset.id}
                        className="flex flex-col p-2 rounded bg-slate-700/50 hover:bg-slate-700 transition-colors"
                        data-testid={`preset-item-${preset.id}`}
                      >
                        <div className="flex items-center gap-1">
                          <Button
                            onClick={() => handlePresetSelect(preset)}
                            variant="ghost"
                            size="sm"
                            className="flex-1 justify-start text-xs h-auto py-1 px-2 hover:bg-slate-600"
                            title="Edit preset settings before creating"
                            data-testid={`button-preset-edit-${preset.id}`}
                          >
                            <div className="flex-1 text-left min-w-0">
                              <div className="font-medium truncate text-slate-100">{preset.name}</div>
                              <div className="text-[10px] text-slate-400 truncate">
                                {dimLabel}
                              </div>
                            </div>
                          </Button>
                          <Button
                            onClick={() => handlePresetQuickCreate(preset)}
                            variant="secondary"
                            size="sm"
                            className="h-7 px-2 bg-blue-600 hover:bg-blue-700 text-white flex-shrink-0"
                            title="Create artboard immediately"
                            data-testid={`button-preset-create-${preset.id}`}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                        {hasMatboard && (
                          <div className="flex items-center gap-2 mt-1 px-2">
                            <Switch
                              id={`matboard-${preset.id}`}
                              checked={matboardOn}
                              onCheckedChange={(checked) =>
                                setMatboardToggles(checked
                                  ? { [preset.id]: true }
                                  : (prev) => ({ ...prev, [preset.id]: false }))
                              }
                              className="scale-75 origin-left"
                            />
                            <Label htmlFor={`matboard-${preset.id}`} className="text-[10px] text-slate-400 cursor-pointer select-none">
                              With matboard
                            </Label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </TabsContent>
            </Tabs>
          </TabsContent>

          {/* Active Tab Content */}
          <TabsContent value="active" className="mt-2">
            {(() => {
              const currentArtboard = artboards.find(a => a.id === activeArtboard);
              if (!currentArtboard) return (
                <div className="text-xs text-slate-500 text-center py-4 bg-slate-800/50 rounded-lg border border-slate-600">
                  No artboard selected
                </div>
              );
              
              return (
                <div className="space-y-3 p-3 bg-slate-800/50 border border-slate-600 rounded-lg">
                  <Label className="text-xs text-slate-400">Active Artboard Settings</Label>
              
              <div className="space-y-3">
                {/* Artboard Name */}
                <div className="space-y-2">
                  <Label className="text-xs text-slate-400">Artboard Name</Label>
                  <Input
                    type="text"
                    value={currentArtboard.name}
                    onChange={(e) => onUpdateArtboard(currentArtboard.id, { name: e.target.value })}
                    placeholder="Artboard 1"
                    className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200"
                    data-testid="input-artboard-name"
                  />
                </div>

                <Separator className="bg-slate-600/50" />

                {/* DPI Setting */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-slate-400">Resolution (DPI)</Label>
                    <div className="flex items-center gap-1.5">
                      <div className="flex items-center gap-1">
                        <Label
                          htmlFor="toggle-resample-dpi"
                          className="text-[10px] text-slate-500 cursor-pointer"
                        >
                          Resample
                        </Label>
                        <ShapeSettingsInfo title="Resample" containerClassName="">
                          <div>Controls what happens when you change the DPI value.</div>
                          <div><strong className="text-slate-200">ON</strong> — Pixels are recalculated to keep the same physical print size. Higher DPI = more pixels; lower DPI = fewer.</div>
                          <div><strong className="text-slate-200">OFF</strong> — Pixels stay exactly the same. Only the DPI metadata changes, so the physical print size grows or shrinks instead.</div>
                        </ShapeSettingsInfo>
                      </div>
                      <Switch
                        id="toggle-resample-dpi"
                        checked={resampleOnDpiChange}
                        onCheckedChange={setResampleOnDpiChange}
                        className="scale-75 origin-right"
                        data-testid="toggle-resample-dpi"
                      />
                    </div>
                  </div>
                  <Select
                    value={String(currentArtboard.dpi ?? 72)}
                    onValueChange={(value) => {
                      const newDpi = parseInt(value);
                      const oldDpi = currentArtboard.dpi ?? 72;
                      if (resampleOnDpiChange && newDpi !== oldDpi) {
                        // Preserve physical size: recompute pixel dims at the new DPI.
                        const widthInches = currentArtboard.width / oldDpi;
                        const heightInches = currentArtboard.height / oldDpi;
                        onUpdateArtboard(currentArtboard.id, {
                          dpi: newDpi,
                          width: Math.round(widthInches * newDpi),
                          height: Math.round(heightInches * newDpi),
                        });
                      } else {
                        // Metadata-only DPI change; pixels unchanged.
                        onUpdateArtboard(currentArtboard.id, { dpi: newDpi });
                      }
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200 artboard-select" data-testid="select-artboard-dpi">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ zIndex: 10002 }}>
                      {DPI_PRESETS.map(preset => (
                        <SelectItem key={preset.value} value={String(preset.value)}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Unit Type Selector */}
                <div className="space-y-2">
                  <Label className="text-xs text-slate-400">Units</Label>
                  <Select
                    value={currentArtboard.unitType ?? 'pixels'}
                    onValueChange={(value: UnitType) => onUpdateArtboard(currentArtboard.id, { unitType: value })}
                  >
                    <SelectTrigger className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200 artboard-select" data-testid="select-artboard-unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ zIndex: 10002 }}>
                      <SelectItem value="pixels">Pixels (px)</SelectItem>
                      <SelectItem value="mm">Millimeters (mm)</SelectItem>
                      <SelectItem value="cm">Centimeters (cm)</SelectItem>
                      <SelectItem value="inches">Inches (in)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Document Type & Size Presets */}
                <div className="space-y-3">
                  <Label className="text-xs text-slate-400">Document Preset</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={(() => {
                        const matchingPreset = ARTBOARD_PRESETS_PHYSICAL.find(p => 
                          Math.abs(p.widthInches * (currentArtboard.dpi ?? 72) - currentArtboard.width) < 2 &&
                          Math.abs(p.heightInches * (currentArtboard.dpi ?? 72) - currentArtboard.height) < 2
                        );
                        return matchingPreset?.category ?? 'paper';
                      })()}
                      onValueChange={(category: PresetCategory) => {
                        const presets = getPresetsByCategory(category);
                        if (presets.length > 0) {
                          const firstPreset = presets[0];
                          const dpi = currentArtboard.dpi ?? 72;
                          const newWidth = Math.round(firstPreset.widthInches * dpi);
                          const newHeight = Math.round(firstPreset.heightInches * dpi);
                          onUpdateArtboard(currentArtboard.id, {
                            name: firstPreset.name,
                            width: newWidth,
                            height: newHeight,
                            aspectRatio: firstPreset.aspectRatio,
                            linkedDimensions: true
                          });
                        }
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200 artboard-select" data-testid="select-preset-category-active">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent style={{ zIndex: 10002 }}>
                        {PRESET_CATEGORIES.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={(() => {
                        const matchingPreset = ARTBOARD_PRESETS_PHYSICAL.find(p => 
                          Math.abs(p.widthInches * (currentArtboard.dpi ?? 72) - currentArtboard.width) < 2 &&
                          Math.abs(p.heightInches * (currentArtboard.dpi ?? 72) - currentArtboard.height) < 2
                        );
                        return matchingPreset?.id ?? '';
                      })()}
                      onValueChange={(presetId: string) => {
                        const preset = ARTBOARD_PRESETS_PHYSICAL.find(p => p.id === presetId);
                        if (preset) {
                          const dpi = currentArtboard.dpi ?? 72;
                          const newWidth = Math.round(preset.widthInches * dpi);
                          const newHeight = Math.round(preset.heightInches * dpi);
                          onUpdateArtboard(currentArtboard.id, {
                            name: preset.name,
                            width: newWidth,
                            height: newHeight,
                            aspectRatio: preset.aspectRatio,
                            linkedDimensions: true
                          });
                        }
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200 artboard-select" data-testid="select-preset-size-active">
                        <SelectValue placeholder="Size" />
                      </SelectTrigger>
                      <SelectContent style={{ zIndex: 10002 }}>
                        {(() => {
                          const matchingPreset = ARTBOARD_PRESETS_PHYSICAL.find(p => 
                            Math.abs(p.widthInches * (currentArtboard.dpi ?? 72) - currentArtboard.width) < 2 &&
                            Math.abs(p.heightInches * (currentArtboard.dpi ?? 72) - currentArtboard.height) < 2
                          );
                          const category = matchingPreset?.category ?? 'paper';
                          return getPresetsByCategory(category).map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.name}
                            </SelectItem>
                          ));
                        })()}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Dimensions with Orientation and Linked Toggle */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-slate-400">
                      Dimensions {currentArtboard.unitType !== 'pixels' && (
                        <span className="text-slate-500">({getUnitLabel(currentArtboard.unitType ?? 'pixels')})</span>
                      )}
                    </Label>
                    <div className="flex items-center gap-1">
                      {/* Portrait/Landscape Toggle */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-6 w-6 p-0 ${currentArtboard.width <= currentArtboard.height ? 'text-blue-400 bg-blue-500/10' : 'text-slate-500 hover:text-slate-300'}`}
                        onClick={() => {
                          if (currentArtboard.width > currentArtboard.height) {
                            onUpdateArtboard(currentArtboard.id, {
                              width: currentArtboard.height,
                              height: currentArtboard.width
                            });
                          }
                        }}
                        title="Portrait orientation"
                        data-testid="button-orientation-portrait"
                      >
                        <RectangleVertical className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-6 w-6 p-0 ${currentArtboard.width > currentArtboard.height ? 'text-blue-400 bg-blue-500/10' : 'text-slate-500 hover:text-slate-300'}`}
                        onClick={() => {
                          if (currentArtboard.width <= currentArtboard.height) {
                            onUpdateArtboard(currentArtboard.id, {
                              width: currentArtboard.height,
                              height: currentArtboard.width
                            });
                          }
                        }}
                        title="Landscape orientation"
                        data-testid="button-orientation-landscape"
                      >
                        <RectangleHorizontal className="w-3.5 h-3.5" />
                      </Button>
                      {/* Link Dimensions Toggle */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-6 px-2 ${currentArtboard.linkedDimensions ? 'text-blue-400 bg-blue-500/10' : 'text-slate-500'}`}
                        onClick={() => onUpdateArtboard(currentArtboard.id, { 
                          linkedDimensions: !currentArtboard.linkedDimensions,
                          aspectRatio: !currentArtboard.linkedDimensions ? 'custom' : currentArtboard.aspectRatio
                        })}
                        title={currentArtboard.linkedDimensions ? 'Unlock dimensions (allows independent resize)' : 'Lock dimensions (maintain aspect ratio)'}
                        data-testid="button-link-dimensions"
                      >
                        {currentArtboard.linkedDimensions ? (
                          <Link2 className="w-3.5 h-3.5" />
                        ) : (
                          <Unlink2 className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label className="text-[10px] text-slate-500">Width</Label>
                      <BufferedNumericInput
                        step={currentArtboard.unitType === 'pixels' ? 1 : 0.01}
                        value={(() => {
                          const displayDims = getArtboardDisplayDimensions(
                            currentArtboard.width,
                            currentArtboard.height,
                            currentArtboard.dpi ?? 72,
                            currentArtboard.unitType ?? 'pixels'
                          );
                          return parseFloat(displayDims.widthFormatted);
                        })()}
                        onCommit={(value) => {
                          const dpi = currentArtboard.dpi ?? 72;
                          const unitType = currentArtboard.unitType ?? 'pixels';
                          
                          if (currentArtboard.linkedDimensions && currentArtboard.width > 0) {
                            const aspectRatio = currentArtboard.width / currentArtboard.height;
                            const newWidthPixels = unitToPixels(value, dpi, unitType);
                            const newHeightPixels = Math.round(newWidthPixels / aspectRatio);
                            onUpdateArtboard(currentArtboard.id, { 
                              width: Math.round(newWidthPixels), 
                              height: newHeightPixels 
                            });
                          } else {
                            const pixelDims = calculatePixelDimensions(
                              value,
                              pixelsToUnit(currentArtboard.height, dpi, unitType),
                              dpi,
                              unitType
                            );
                            onUpdateArtboard(currentArtboard.id, { 
                              width: pixelDims.widthPixels,
                              aspectRatio: 'custom'
                            });
                          }
                        }}
                        min={1}
                        max={20000}
                        className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200"
                        data-testid="input-artboard-width"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] text-slate-500">Height</Label>
                      <BufferedNumericInput
                        step={currentArtboard.unitType === 'pixels' ? 1 : 0.01}
                        value={(() => {
                          const displayDims = getArtboardDisplayDimensions(
                            currentArtboard.width,
                            currentArtboard.height,
                            currentArtboard.dpi ?? 72,
                            currentArtboard.unitType ?? 'pixels'
                          );
                          return parseFloat(displayDims.heightFormatted);
                        })()}
                        onCommit={(value) => {
                          const dpi = currentArtboard.dpi ?? 72;
                          const unitType = currentArtboard.unitType ?? 'pixels';
                          
                          if (currentArtboard.linkedDimensions && currentArtboard.height > 0) {
                            const aspectRatio = currentArtboard.width / currentArtboard.height;
                            const newHeightPixels = unitToPixels(value, dpi, unitType);
                            const newWidthPixels = Math.round(newHeightPixels * aspectRatio);
                            onUpdateArtboard(currentArtboard.id, { 
                              width: newWidthPixels, 
                              height: Math.round(newHeightPixels) 
                            });
                          } else {
                            const pixelDims = calculatePixelDimensions(
                              pixelsToUnit(currentArtboard.width, dpi, unitType),
                              value,
                              dpi,
                              unitType
                            );
                            onUpdateArtboard(currentArtboard.id, { 
                              height: pixelDims.heightPixels,
                              aspectRatio: 'custom'
                            });
                          }
                        }}
                        min={1}
                        max={20000}
                        className="h-8 text-xs bg-slate-700 border-slate-600 text-slate-200"
                        data-testid="input-artboard-height"
                      />
                    </div>
                  </div>
                  {currentArtboard.unitType !== 'pixels' && (
                    <div className="text-xs text-slate-500 mt-1">
                      {currentArtboard.width} × {currentArtboard.height} px
                    </div>
                  )}
                </div>

                {/* Background Color */}
                <div className="space-y-2">
                  <Label className="text-xs text-slate-400">Background Color</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={currentArtboard.backgroundColor || '#ffffff'}
                      onChange={(e) => onUpdateArtboard(currentArtboard.id, { backgroundColor: e.target.value })}
                      className="h-7 w-12 p-1 bg-slate-700 border-slate-600"
                      data-testid="input-artboard-background-color"
                    />
                    <Input
                      type="text"
                      value={currentArtboard.backgroundColor || '#ffffff'}
                      onChange={(e) => onUpdateArtboard(currentArtboard.id, { backgroundColor: e.target.value })}
                      placeholder="#ffffff"
                      className="h-7 flex-1 text-xs bg-slate-700 border-slate-600 text-slate-200"
                      data-testid="input-artboard-background-hex"
                    />
                  </div>
                </div>

                <Separator className="bg-slate-600/50" />

                {/* Display Name Toggle */}
                <div id="artboard-display-labels-anchor" className="flex items-center justify-between">
                  <Label className="text-xs text-slate-400">Display Name</Label>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={currentArtboard.displayName !== false}
                      onCheckedChange={(checked) => onUpdateArtboard(currentArtboard.id, { displayName: checked })}
                      data-testid="switch-artboard-display-name"
                    />
                    <span className="text-xs text-slate-400">
                      {currentArtboard.displayName !== false ? 'On' : 'Off'}
                    </span>
                  </div>
                </div>

                {/* Display Dimensions Toggle */}
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-400">Display Dimensions</Label>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={currentArtboard.displayDimensions === true}
                      onCheckedChange={(checked) => onUpdateArtboard(currentArtboard.id, { displayDimensions: checked })}
                      data-testid="switch-artboard-display-dimensions"
                    />
                    <span className="text-xs text-slate-400">
                      {currentArtboard.displayDimensions === true ? 'On' : 'Off'}
                    </span>
                  </div>
                </div>

                {/* Display Resolution Toggle */}
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-400">Display Resolution</Label>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={currentArtboard.displayResolution === true}
                      onCheckedChange={(checked) => onUpdateArtboard(currentArtboard.id, { displayResolution: checked })}
                      data-testid="switch-artboard-display-resolution"
                    />
                    <span className="text-xs text-slate-400">
                      {currentArtboard.displayResolution === true ? 'On' : 'Off'}
                    </span>
                  </div>
                </div>

                {/* Display Border Toggle */}
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-400">Display Border</Label>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={currentArtboard.displayBorder !== false}
                      onCheckedChange={(checked) => onUpdateArtboard(currentArtboard.id, { displayBorder: checked })}
                      data-testid="switch-artboard-display-border"
                    />
                    <span className="text-xs text-slate-400">
                      {currentArtboard.displayBorder !== false ? 'On' : 'Off'}
                    </span>
                  </div>
                </div>

                {/* Display Grid Toggle */}
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-400">Display Grid</Label>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={currentArtboard.displayGrid !== false}
                      onCheckedChange={(checked) => onUpdateArtboard(currentArtboard.id, { displayGrid: checked })}
                      data-testid="switch-artboard-display-grid"
                    />
                    <span className="text-xs text-slate-400">
                      {currentArtboard.displayGrid !== false ? 'On' : 'Off'}
                    </span>
                  </div>
                </div>

                {/* Grid Color */}
                {currentArtboard.displayGrid !== false && (
                  <div className="space-y-2 ml-4">
                    <Label className="text-xs text-slate-400">Grid Color</Label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={currentArtboard.gridColor || '#cccccc'}
                        onChange={(e) => onUpdateArtboard(currentArtboard.id, { gridColor: e.target.value })}
                        className="h-7 w-12 p-1 bg-slate-700 border-slate-600"
                        data-testid="input-artboard-grid-color"
                      />
                      <Input
                        type="text"
                        value={currentArtboard.gridColor || '#cccccc'}
                        onChange={(e) => onUpdateArtboard(currentArtboard.id, { gridColor: e.target.value })}
                        placeholder="#cccccc"
                        className="h-7 flex-1 text-xs bg-slate-700 border-slate-600 text-slate-200"
                        data-testid="input-artboard-grid-hex"
                      />
                    </div>
                  </div>
                )}

                <Separator className="bg-slate-600/50" />

                {/* Print Configuration Section */}
                <div id="artboard-print-config-anchor">
                  <PrintConfigurationSection 
                    currentArtboard={currentArtboard}
                    onUpdateArtboard={onUpdateArtboard}
                  />
                </div>
              </div>
                </div>
              );
            })()}
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // Export state variables lifted to main component level  
  const [exportShapeCountRange, setExportShapeCountRange] = useState<[number, number]>([5, 15]);
  
  // Use persisted export settings instead of local state
  const exportBatchCount = exportSettings.batchExportCount;
  const setExportBatchCount = (count: number) => {
    updateExportSettings.mutate({ batchExportCount: count });
  };
  
  const exportSaveProjectFiles = exportSettings.exportSaveProjectFiles;
  const setExportSaveProjectFiles = (enabled: boolean) => {
    updateExportSettings.mutate({ exportSaveProjectFiles: enabled });
  };

  const exportSaveGeneratorFiles = exportSettings.exportSaveGeneratorFiles ?? false;
  const setExportSaveGeneratorFiles = (enabled: boolean) => {
    updateExportSettings.mutate({ exportSaveGeneratorFiles: enabled });
  };
  
  const packageAsZip = exportSettings.packageAsZip;
  const setPackageAsZip = (enabled: boolean) => {
    updateExportSettings.mutate({ packageAsZip: enabled });
  };
  
  // New packaging and selective export settings
  const [exportAllImages, setExportAllImages] = useState(true);
  const [selectedImageIndices, setSelectedImageIndices] = useState<number[]>([]);

  // TIFF Pre-flight helper functions (at component level for access across components)
  const getTiffPreflightInfo = useCallback(() => {
    const backgroundArtboard = artboards.find(ab => ab.id === activeArtboard);
    const targetArtboard = (exportMode === 'artboard' || exportMode === 'artboard-extended')
      ? (selectedArtboardForExport 
          ? artboards.find(ab => ab.id === selectedArtboardForExport)
          : backgroundArtboard)
      : backgroundArtboard;
    
    const artboardWidth = targetArtboard?.width ?? backgroundArtboard?.width ?? 400;
    const artboardHeight = targetArtboard?.height ?? backgroundArtboard?.height ?? 400;
    const artboardDpi = targetArtboard?.dpi ?? backgroundArtboard?.dpi ?? 72;
    const requestedCount = exportAllImages ? exportBatchCount : selectedImageIndices.length;
    
    const printConfig = targetArtboard?.printConfig ?? backgroundArtboard?.printConfig ?? DEFAULT_PRINT_CONFIG;
    const bleedEnabled = printConfig.overlays.bleed.render && printConfig.overlays.bleed.amount > 0;
    const backgroundMode = exportSettings.exportBackgroundMode || 'transparent';
    const is16Bit = (exportSettings.tiffBitDepth ?? 8) === 16;
    const scale = effectiveExportScale;
    
    return calculateTiffPreflightInfo(
      artboardWidth,
      artboardHeight,
      artboardDpi,
      requestedCount,
      bleedEnabled,
      backgroundMode,
      is16Bit,
      scale
    );
  }, [artboards, activeArtboard, exportMode, selectedArtboardForExport, exportAllImages, exportBatchCount, selectedImageIndices, exportSettings.exportBackgroundMode, exportSettings.tiffBitDepth, effectiveExportScale]);

  // Batch cost estimate for all formats — shown as an inline panel in the batch tab
  const batchCostEstimate = useMemo(() => {
    if (!exportSettings.exportBatchModeEnabled) return null;
    const imageCount = exportAllImages ? exportBatchCount : selectedImageIndices.length;
    if (imageCount <= 1) return null;

    const backgroundArtboard = artboards.find(ab => ab.id === activeArtboard);
    const targetArtboard = (exportMode === 'artboard' || exportMode === 'artboard-extended')
      ? (selectedArtboardForExport ? artboards.find(ab => ab.id === selectedArtboardForExport) : backgroundArtboard)
      : backgroundArtboard;

    const artboardWidth = targetArtboard?.width ?? backgroundArtboard?.width ?? 400;
    const artboardHeight = targetArtboard?.height ?? backgroundArtboard?.height ?? 400;

    const scaledWidth = Math.round(artboardWidth * effectiveExportScale);
    const scaledHeight = Math.round(artboardHeight * effectiveExportScale);
    // Normalize "jpg" → "jpeg" to match FORMAT_FILE_SIZE_RATIO / FORMAT_RAM_OVERHEAD keys
    const fmt = exportFormat === 'jpg' ? 'jpeg' : exportFormat;
    const perImageMb = estimateFileSizeMb(scaledWidth, scaledHeight, 8, fmt);
    const totalMb = perImageMb * imageCount;
    const timeSec = estimateProcessingTimeSec(scaledWidth, scaledHeight, imageCount, false);
    // Memory tier is based on uncompressed RAM footprint, not compressed file size
    const memoryPerImageMb = estimateImageMemoryMb(scaledWidth, scaledHeight, 8, fmt);
    const tier = getMemoryTier(memoryPerImageMb);

    return { perImageMb, totalMb, timeSec, tier, imageCount, scaledWidth, scaledHeight, fmt };
  }, [exportSettings.exportBatchModeEnabled, exportAllImages, exportBatchCount, selectedImageIndices, artboards, activeArtboard, exportMode, selectedArtboardForExport, effectiveExportScale, exportFormat]);

  // Handle TIFF pre-flight modal confirmation
  const handleTiffPreflightConfirm = useCallback((dontShowAgain: boolean, compressionSettings?: CompressionSettings) => {
    if (dontShowAgain) {
      updateExportSettings.mutate({ skipTiffPreflightModal: true });
    }
    // Store compression settings for use in server export
    if (compressionSettings) {
      compressionSettingsRef.current = compressionSettings;
    }
    setIsTiffPreflightOpen(false);
    // Trigger the pending export
    if (pendingTiffExportRef.current) {
      pendingTiffExportRef.current();
      pendingTiffExportRef.current = null;
    }
  }, [updateExportSettings]);
  
  // Handle TIFF pre-flight modal cancel
  const handleTiffPreflightCancel = useCallback(() => {
    setIsTiffPreflightOpen(false);
    pendingTiffExportRef.current = null;
  }, []);

  // Generation sets handlers (placed after state declarations)
  const handleCreateSet = useCallback((name: string) => {
    // Auto-enable batch export when creating sets
    if (!exportSettings.exportBatchModeEnabled) {
      updateExportSettings.mutate({ exportBatchModeEnabled: true });
      console.log('Auto-enabled batch export for generation sets');
    }
    
    
    // Capture current UI state for the generation set
    const currentUIState: CurrentUIState = {
      enabledShapeTypes,
      scatterSettings,
      batchConfigSettings: generationConfigSettings,
      shapeCountMode,
      shapeCountFixed,
      shapeCountRange
    };
    
    // Call the actual handler from parent component with UI state
    const setId = onCreateGenerationSet?.(name, currentUIState);
    console.log('Created generation set:', name, 'with ID:', setId, 'from current UI state');
    return setId;
  }, [onCreateGenerationSet, exportSettings.exportBatchModeEnabled, updateExportSettings, generationConfigSettings, onUpdateGenerationConfigSettings, enabledShapeTypes, scatterSettings, shapeCountMode, shapeCountFixed, shapeCountRange]);

  // Create a clean (default) generation set without capturing current UI state
  const handleCreateCleanSet = useCallback((name: string) => {
    if (!exportSettings.exportBatchModeEnabled) {
      updateExportSettings.mutate({ exportBatchModeEnabled: true });
      console.log('Auto-enabled batch export for generation sets');
    }
    const setId = onCreateGenerationSet?.(name);
    console.log('Created clean generation set:', name, 'with ID:', setId);
    return setId;
  }, [onCreateGenerationSet, exportSettings.exportBatchModeEnabled, updateExportSettings]);

  // Apply current UI state to the current generation set - Shape Types section only
  const handleApplyToCurrentSet = useCallback(async () => {
    if (!currentGenerationSetId || !updateGenerationSetPartial) return;

    setApplyStatus('applying');
    
    // Set flag to skip the automatic UI restoration that would reset scroll position
    skipNextRestoreRef.current = true;
    
    try {
      // Prepare shape types partial update - only what this section controls
      const shapeTypesUpdate: Partial<GenerationSet> = {
        enabledShapeTypes: Array.from(enabledShapeTypes) as SupportedShapeType[],
        shapeCountMode,
        shapeCountFixed,
        shapeCountRange,
        // Include shape-specific properties (corner radius, inner radius, segments, etc.)
        shapeSpecificProperties: scatterSettings.shapeSpecific as any
      };
      
      console.log('📝 [SHAPE TYPES APPLY] Updating with:', {
        shapeTypes: shapeTypesUpdate.enabledShapeTypes,
        mode: shapeCountMode,
        fixed: shapeCountFixed,
        range: shapeCountRange,
        shapeSpecific: Object.keys(scatterSettings.shapeSpecific)
      });
      
      await updateGenerationSetPartial(currentGenerationSetId, shapeTypesUpdate);
      
      // Show success state for 1000ms
      setApplyStatus('success');
      setTimeout(() => {
        setApplyStatus('idle');
      }, 1000);
    } catch (error) {
      console.error('Failed to apply shape types:', error);
      // On error, revert to idle and clear the skip flag
      skipNextRestoreRef.current = false;
      setApplyStatus('idle');
    }
  }, [currentGenerationSetId, updateGenerationSetPartial, enabledShapeTypes, shapeCountMode, shapeCountFixed, shapeCountRange, scatterSettings.shapeSpecific]);

  function ExportSaveContent() {
    // Export settings now use lifted state from main Sidebar component
    // exportFormat, exportQuality, exportScale, exportMode, selectedArtboardForExport are already defined at the component level

    // Local export state (not needed by API generator)
    const [batchExportPath, setBatchExportPath] = useState<string>('');
    const [isBatchExporting, setIsBatchExporting] = useState(false);
    // Server export state is managed at the Sidebar component level (isServerExportingGlobal) for proper modal synchronization
    const [batchProgress, setBatchProgress] = useState(0);
    const [batchTotalSteps, setBatchTotalSteps] = useState(0);
    const [batchStatus, setBatchStatus] = useState('');
    const [showBatchResult, setShowBatchResult] = useState(false);
    const [batchResultMessage, setBatchResultMessage] = useState('');
    
    // Export progress tracking with elapsed time and cancel
    const [exportElapsedTime, setExportElapsedTime] = useState(0);
    const exportStartTimeRef = useRef<number | null>(null);
    const exportAbortControllerRef = useRef<AbortController | null>(null);
    const elapsedTimeIntervalRef = useRef<NodeJS.Timeout | null>(null);
    
    // Format elapsed time as mm:ss
    const formatElapsedTime = (seconds: number): string => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };
    
    // Start elapsed time tracking
    const startElapsedTimeTracking = () => {
      exportStartTimeRef.current = Date.now();
      setExportElapsedTime(0);
      elapsedTimeIntervalRef.current = setInterval(() => {
        if (exportStartTimeRef.current) {
          setExportElapsedTime(Math.floor((Date.now() - exportStartTimeRef.current) / 1000));
        }
      }, 1000);
    };
    
    // Stop elapsed time tracking
    const stopElapsedTimeTracking = () => {
      if (elapsedTimeIntervalRef.current) {
        clearInterval(elapsedTimeIntervalRef.current);
        elapsedTimeIntervalRef.current = null;
      }
      exportStartTimeRef.current = null;
    };
    
    // Cancel export
    const handleCancelExport = useCallback(() => {
      if (exportAbortControllerRef.current) {
        exportAbortControllerRef.current.abort();
        console.log('🛑 Export cancelled by user');
        // Update local state
        setBatchStatus('Export cancelled');
        stopElapsedTimeTracking();
        setIsBatchExporting(false);
        setShowBatchResult(true);
        setBatchResultMessage('⚠️ Export was cancelled');
        // Update global state for overlay
        stopElapsedTimeTrackingGlobal();
        setExportStatusGlobal('Export cancelled');
        setExportIsErrorGlobal(true);
        setExportResultMessageGlobal('⚠️ Export was cancelled');
      }
    }, [stopElapsedTimeTrackingGlobal]);

    // Helper function to convert print units to pixels
    const convertPrintUnitToPixels = (value: number, unit: PrintUnitType, dpi: number): number => {
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
    };

    // Helper function to render print marks on export canvas
    const renderPrintMarks = (
      ctx: CanvasRenderingContext2D,
      artboardX: number,
      artboardY: number,
      artboardWidth: number,
      artboardHeight: number,
      bleedPx: number,
      printMarksConfig: {
        cropMarks: boolean;
        registrationMarks: boolean;
        markLength: number;
        markOffset: number;
        color?: string;
      }
    ) => {
      const { cropMarks, registrationMarks, markLength, markOffset, color } = printMarksConfig;
      
      ctx.save();
      ctx.strokeStyle = color || '#000000';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      
      // Crop Marks (corner marks at artboard edges, positioned outside the bleed area)
      if (cropMarks) {
        const corners = [
          { x: artboardX, y: artboardY, dx: -1, dy: -1 },
          { x: artboardX + artboardWidth, y: artboardY, dx: 1, dy: -1 },
          { x: artboardX, y: artboardY + artboardHeight, dx: -1, dy: 1 },
          { x: artboardX + artboardWidth, y: artboardY + artboardHeight, dx: 1, dy: 1 }
        ];
        
        corners.forEach(corner => {
          const offsetX = (bleedPx + markOffset) * corner.dx;
          const offsetY = (bleedPx + markOffset) * corner.dy;
          
          // Horizontal line
          ctx.beginPath();
          ctx.moveTo(corner.x + offsetX, corner.y);
          ctx.lineTo(corner.x + offsetX + (markLength * corner.dx), corner.y);
          ctx.stroke();
          
          // Vertical line
          ctx.beginPath();
          ctx.moveTo(corner.x, corner.y + offsetY);
          ctx.lineTo(corner.x, corner.y + offsetY + (markLength * corner.dy));
          ctx.stroke();
        });
      }
      
      // Registration Marks (crosshair marks at center of each edge)
      if (registrationMarks) {
        const regMarkSize = 8;
        const regCircleRadius = 4;
        const edgeCenters = [
          { x: artboardX + artboardWidth / 2, y: artboardY - bleedPx - markOffset - regMarkSize },
          { x: artboardX + artboardWidth / 2, y: artboardY + artboardHeight + bleedPx + markOffset + regMarkSize },
          { x: artboardX - bleedPx - markOffset - regMarkSize, y: artboardY + artboardHeight / 2 },
          { x: artboardX + artboardWidth + bleedPx + markOffset + regMarkSize, y: artboardY + artboardHeight / 2 }
        ];
        
        edgeCenters.forEach(center => {
          // Draw crosshair
          ctx.beginPath();
          ctx.moveTo(center.x - regMarkSize, center.y);
          ctx.lineTo(center.x + regMarkSize, center.y);
          ctx.stroke();
          
          ctx.beginPath();
          ctx.moveTo(center.x, center.y - regMarkSize);
          ctx.lineTo(center.x, center.y + regMarkSize);
          ctx.stroke();
          
          // Draw circle
          ctx.beginPath();
          ctx.arc(center.x, center.y, regCircleRadius, 0, Math.PI * 2);
          ctx.stroke();
        });
      }
      
      ctx.restore();
    };


    const renderShapeForExport = (ctx: CanvasRenderingContext2D, shape: Shape) => {
      // Temporarily disable selection to avoid selection indicators, but keep the original shape
      const originalSelected = shape.selected;
      shape.selected = false;

      // DIAGNOSTIC: Log shape properties for debugging batch export
      console.log(`🔍 [EXPORT RENDER] Shape ${shape.id}:`, {
        type: shape.type,
        transform: { x: shape.transform.x, y: shape.transform.y },
        hasPoints: !!(shape.points && shape.points.length > 0),
        pointsCount: shape.points?.length ?? 0,
        hasControlPoints: !!(shape.controlPoints && shape.controlPoints.length > 0),
        controlPointsCount: shape.controlPoints?.length ?? 0,
        fillColor: shape.properties.fillColor,
        fillOpacity: shape.properties.fillOpacity,
        hasGradient: !!shape.properties.gradient,
        gradientType: shape.properties.gradient?.type,
        gradientStops: shape.properties.gradient?.stops?.length ?? 0,
        radius: shape.radius
      });

      // Save current context state
      ctx.save();
      
      // Apply blend mode or compositing operation if set
      if (shape.properties.blendMode && shape.properties.blendMode !== 'source-over') {
        ctx.globalCompositeOperation = shape.properties.blendMode as GlobalCompositeOperation;
      }

      // Use the Shape class's render method for export
      shape.render(ctx);

      // Restore context state (including blend mode)
      ctx.restore();

      // Restore original selection state
      shape.selected = originalSelected;
    };

    const exportCanvasAsFormat = async (canvas: HTMLCanvasElement, filename: string, format: string, quality: number, scale: number, dpi: number = 72) => {
      // Get export settings for TIFF and ICC profile
      const tiffBitDepth = exportSettings.tiffBitDepth ?? 8;
      const tiffCompression = exportSettings.tiffCompression ?? 'none';
      const embedIccProfile = exportSettings.embedIccProfile ?? true;
      
      switch (format) {
        case 'pdf':
          // Convert canvas to PDF.
          // jsPDF renders transparent PNG pixels as solid black.
          // Composite onto a white canvas first so every PDF has a clean white background.
          const pdfSourceCanvas = document.createElement('canvas');
          pdfSourceCanvas.width = canvas.width;
          pdfSourceCanvas.height = canvas.height;
          const pdfSourceCtx = pdfSourceCanvas.getContext('2d')!;
          pdfSourceCtx.fillStyle = '#ffffff';
          pdfSourceCtx.fillRect(0, 0, pdfSourceCanvas.width, pdfSourceCanvas.height);
          pdfSourceCtx.drawImage(canvas, 0, 0);
          const pdfDataUrl = pdfSourceCanvas.toDataURL('image/png');
          pdfSourceCanvas.width = 0;
          pdfSourceCanvas.height = 0;
          const pdf = new jsPDF({
            orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
            unit: 'pt',
            format: [canvas.width / scale, canvas.height / scale]
          });
          pdf.addImage(pdfDataUrl, 'PNG', 0, 0, canvas.width / scale, canvas.height / scale);
          pdf.save(filename);
          console.log(`📁 File saved: ${filename} (check your Downloads folder)`);
          break;
        case 'tiff': {
          const bgMode = exportSettings.exportBackgroundMode || 'transparent';
          const shouldFlattenToRgb = bgMode === 'artboard' || (exportSettings.flattenToRgb ?? false);
          const memoryMultiplier = tiffBitDepth === 16 ? 2 : 1;
          const maxPixels = 200_000_000 / memoryMultiplier;
          if (canvas.width * canvas.height > maxPixels) {
            console.error(`❌ TIFF export aborted: Canvas size (${canvas.width}x${canvas.height}) exceeds ${maxPixels.toLocaleString()} pixels at ${tiffBitDepth}-bit.`);
            alert(`TIFF export failed: Image too large (${canvas.width}x${canvas.height}) at ${tiffBitDepth}-bit. Please reduce the resolution or use PNG/JPEG instead.`);
            break;
          }
          const tiffBlob = await encodeCanvasAsTiff(canvas, dpi, {
            bitDepth: tiffBitDepth,
            compression: tiffCompression,
            flattenToRgb: shouldFlattenToRgb,
            matteColor: exportSettings.matteColor || '#ffffff',
            software: 'Shape Editor',
            includeDatetime: true,
            copyright: exportSettings.copyrightText,
            artist: exportSettings.artistName,
            description: exportSettings.imageDescription,
            title: exportSettings.imageTitle,
          }, embedIccProfile);
          const url = URL.createObjectURL(tiffBlob);
          const tiffLink = document.createElement('a');
          tiffLink.href = url;
          tiffLink.download = filename;
          tiffLink.click();
          URL.revokeObjectURL(url);
          const channelMode = shouldFlattenToRgb ? 'RGB' : 'RGBA';
          console.log(`📁 File saved: ${filename} (${dpi} DPI, ${tiffBitDepth}-bit ${channelMode}${embedIccProfile ? ', sRGB ICC profile' : ''})`);
          break;
        }
        default:
          // Handle raster formats
          const link = document.createElement('a');
          link.download = filename;
          
          let dataURL: string;
          switch (format) {
            case 'jpg':
              dataURL = canvas.toDataURL('image/jpeg', quality / 100);
              if ((dataURL.split(',')[1]?.length ?? 0) < 500) {
                setClientExportFailureInfo({ megapixels: (canvas.width * canvas.height) / 1_000_000, limitMp: 220, width: canvas.width, height: canvas.height, reason: 'blank-result' });
                setShowClientExportFailurePanel(true);
                throw new Error('BLANK_CANVAS_RESULT');
              }
              // Embed DPI metadata for JPEG
              if (embedIccProfile) {
                // Convert to blob, embed ICC, then back to URL
                const jpegBlob = await (await fetch(dataURL)).blob();
                const iccBlob = await embedIccInJpeg(jpegBlob);
                const iccUrl = URL.createObjectURL(iccBlob);
                link.href = iccUrl;
                console.log(`📄 JPEG: Embedded sRGB ICC profile`);
              } else {
                link.href = embedDPI(dataURL, 'jpg', dpi);
              }
              break;
            case 'webp':
              link.href = canvas.toDataURL('image/webp', quality / 100);
              break;
            case 'avif':
              link.href = canvas.toDataURL('image/avif', quality / 100);
              break;
            case 'bmp':
              link.href = canvas.toDataURL('image/bmp');
              break;
            case 'png':
            default:
              dataURL = canvas.toDataURL('image/png');
              if ((dataURL.split(',')[1]?.length ?? 0) < 500) {
                setClientExportFailureInfo({ megapixels: (canvas.width * canvas.height) / 1_000_000, limitMp: 220, width: canvas.width, height: canvas.height, reason: 'blank-result' });
                setShowClientExportFailurePanel(true);
                throw new Error('BLANK_CANVAS_RESULT');
              }
              // Embed all image metadata (copyright, author, title, description, creation time, software)
              const pngMetadata: PngMetadata = {
                copyright: exportSettings.copyrightText ?? '',
                author: exportSettings.artistName ?? '',
                title: exportSettings.imageTitle ?? '',
                description: exportSettings.imageDescription ?? '',
                creationTime: new Date().toISOString(),
                software: 'Shape Editor',
              };
              dataURL = embedPngMetadata(dataURL, pngMetadata);
              const hasMetadata = Object.values(pngMetadata).some(v => v && v.trim() !== '');
              if (hasMetadata) {
                console.log(`📄 PNG: Embedded image metadata (copyright, author, title, description, creation time, software)`);
              }
              if (embedIccProfile) {
                // Convert to blob, embed ICC, then back to URL
                const pngBlob = await (await fetch(dataURL)).blob();
                const iccBlob = await embedIccInPng(pngBlob);
                const iccUrl = URL.createObjectURL(iccBlob);
                link.href = iccUrl;
                console.log(`📄 PNG: Embedded sRGB ICC profile`);
              } else {
                // Embed DPI metadata for PNG
                link.href = embedDPI(dataURL, 'png', dpi);
              }
              break;
          }

          link.click();
          console.log(`📁 File saved: ${filename} (check your Downloads folder) with ${dpi} DPI metadata`);
          break;
      }
    };

    const handleExportShapes = async () => {
      // Determine shapes to export based on export mode
      let shapesToExport: Shape[];
      if (exportMode === 'selection' && selectedShapes.length > 0) {
        shapesToExport = selectedShapes;
      } else {
        shapesToExport = shapes;
      }

      if (shapesToExport.length === 0) {
        const isInGenerationMode = exportSettings.generationSetsEnabled || exportSettings.exportBatchModeEnabled;
        toast({
          title: "No shapes to export",
          description: isInGenerationMode
            ? "Single export uses whatever is currently on the canvas — it doesn't auto-generate shapes. Click Generate to populate the canvas first, then export."
            : "No shapes were found on the canvas. Make sure your shapes are positioned on the artboard.",
          variant: "destructive",
          duration: isInGenerationMode ? 8000 : 5000,
        });
        return;
      }

      // Compute a mode-accurate canvas pixel estimate to decide client vs server path.
      // Artboard modes: use artboard dimensions (fixed, known upfront).
      // All/selection modes: derive bounds from shape world coordinates — same algorithm
      // used by the batch renderer — so oversized shape arrangements are caught correctly.
      let estimatedPixels: number;
      if ((exportMode === 'artboard' || exportMode === 'artboard-extended') && selectedArtboardForExport) {
        const artboard = artboards.find(ab => ab.id === selectedArtboardForExport);
        const w = ((artboard?.width ?? 800)) * effectiveExportScale;
        const h = ((artboard?.height ?? 600)) * effectiveExportScale;
        estimatedPixels = w * h;
      } else {
        // Compute from shape world bounds (mirrors batch renderer logic at lines 5843–5883)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        shapesToExport.forEach(shape => {
          const bounds = shape.getBounds();
          const corners = [
            { x: bounds.x, y: bounds.y },
            { x: bounds.x + bounds.width, y: bounds.y },
            { x: bounds.x, y: bounds.y + bounds.height },
            { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
          ];
          corners.forEach(corner => {
            let x = corner.x * shape.transform.scaleX;
            let y = corner.y * shape.transform.scaleY;
            if (shape.transform.rotation !== 0) {
              const angle = (shape.transform.rotation * Math.PI) / 180;
              const cos = Math.cos(angle);
              const sin = Math.sin(angle);
              const rx = x * cos - y * sin;
              const ry = x * sin + y * cos;
              x = rx;
              y = ry;
            }
            x += shape.transform.x;
            y += shape.transform.y;
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          });
        });
        const padding = 20;
        const w = (maxX - minX + padding * 2) * effectiveExportScale;
        const h = (maxY - minY + padding * 2) * effectiveExportScale;
        estimatedPixels = isFinite(w) && isFinite(h) ? w * h : 0;
      }

      const CLIENT_EXPORT_LIMIT_MP = 220;
      const megapixels = estimatedPixels / 1_000_000;
      const shouldUseServer = exportSettings.renderMode === 'server' || megapixels > CLIENT_EXPORT_LIMIT_MP;
      if (shouldUseServer) {
        // When the user explicitly chose "Browser" but the image is oversized, warn before escalating.
        if (exportSettings.renderMode === 'client' && megapixels > CLIENT_EXPORT_LIMIT_MP) {
          toast({
            title: 'Image too large for browser export',
            description: `${megapixels.toFixed(0)} MP exceeds the ${CLIENT_EXPORT_LIMIT_MP} MP browser limit — automatically switching to server export.`,
            duration: 6000,
          });
        }
        // Oversized (> 220 MP) or user-selected server mode: delegate to Puppeteer.
        handleServerExport();
        return;
      }

      // Route through the unified client batch pipeline using live canvas shapes.
      // shape.render(ctx) matches the live canvas and batch export exactly.
      handleBatchExportNewInternal(shapesToExport);
    };


    const performBatchExport = async (filename: string) => {
      // Export all shapes for batch mode
      const shapesToExport = shapes;
      console.log(`Batch export: Found ${shapesToExport.length} shapes to export as ${filename}`);
      
      // Artboard stores pixels at its own DPI; effective output DPI = artboardDpi × exportScale
      const exportDPI = Math.round((artboards.find(ab => ab.id === activeArtboard)?.dpi ?? 72) * effectiveExportScale);
      
      // Set canvas dimensions based on shapes or default size
      let canvasWidth = 800 * effectiveExportScale;
      let canvasHeight = 600 * effectiveExportScale;
      let translateX = 0;
      let translateY = 0;

      if (shapesToExport.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        shapesToExport.forEach(shape => {
          const bounds = shape.getBounds();
          const corners = [
            { x: bounds.x, y: bounds.y },
            { x: bounds.x + bounds.width, y: bounds.y },
            { x: bounds.x, y: bounds.y + bounds.height },
            { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
          ];

          corners.forEach(corner => {
            let x = corner.x * shape.transform.scaleX;
            let y = corner.y * shape.transform.scaleY;

            if (shape.transform.rotation !== 0) {
              const cos = Math.cos(shape.transform.rotation * Math.PI / 180);
              const sin = Math.sin(shape.transform.rotation * Math.PI / 180);
              const newX = x * cos - y * sin;
              const newY = x * sin + y * cos;
              x = newX;
              y = newY;
            }

            x += shape.transform.x;
            y += shape.transform.y;

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          });
        });

        const padding = 20;
        canvasWidth = (maxX - minX + padding * 2) * effectiveExportScale;
        canvasHeight = (maxY - minY + padding * 2) * effectiveExportScale;
        translateX = -minX + padding;
        translateY = -minY + padding;
      }

      // Create export canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.error('Failed to get canvas context for batch export');
        return;
      }

      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      // Get the current artboard for background color reference
      const currentArtboardData = artboards.find(ab => ab.id === activeArtboard);
      const artboardBgColor = currentArtboardData?.backgroundColor || '#ffffff';

      // Determine effective background color based on export settings
      // 'transparent' = no background, 'artboard' = use artboard's configured color
      const bgMode = exportSettings.exportBackgroundMode || 'transparent';
      const effectiveBgColor = bgMode === 'artboard' ? artboardBgColor : 'transparent';

      // Set background if not transparent
      if (effectiveBgColor !== 'transparent') {
        ctx.fillStyle = effectiveBgColor;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }

      // Apply scaling and translation
      ctx.scale(effectiveExportScale, effectiveExportScale);
      ctx.translate(translateX, translateY);

      // Render shapes
      const sortedShapes = [...shapesToExport].sort((a, b) => a.properties.zIndex - b.properties.zIndex);
      sortedShapes.forEach(shape => renderShapeForExport(ctx, shape));

      // Export using helper function that handles all formats including PDF
      await exportCanvasAsFormat(canvas, filename, exportFormat, exportQuality, effectiveExportScale, exportDPI);
    };

    // Server-side high-resolution export handler
    /**
     * Server-side Puppeteer export — intended only for images that exceed the browser canvas
     * limit (~268 MP) or when the user explicitly selects server render mode.
     * For all normal single exports, handleExportShapes routes through
     * handleBatchExportNewInternal(preformedShapes) which calls shape.render(ctx) directly
     * and guarantees the output matches the live canvas appearance exactly.
     */
    const handleServerExport = async () => {
      // Initialize global overlay
      setShowExportProgressOverlay(true);
      setIsServerExportingGlobal(true);
      setExportTotalStepsGlobal(100);
      setExportProgressGlobal(5);
      setExportStatusGlobal('Calculating export estimate...');
      setExportIsCompleteGlobal(false);
      setExportIsErrorGlobal(false);
      setExportResultMessageGlobal('');
      setExportEstimatedTimeGlobal(undefined);
      exportAbortControllerGlobalRef.current = new AbortController();
      startElapsedTimeTrackingGlobal();
      
      // Also update local state for accordion display
      setBatchStatus('Calculating estimate...');
      setBatchProgress(5);
      
      try {
        const backgroundArtboard = artboards.find(ab => ab.id === activeArtboard);
        const targetArtboard = (exportMode === 'artboard' || exportMode === 'artboard-extended')
          ? (selectedArtboardForExport 
              ? artboards.find(ab => ab.id === selectedArtboardForExport)
              : backgroundArtboard)
          : backgroundArtboard;
        
        const artboardWidth = targetArtboard?.width ?? backgroundArtboard?.width ?? 400;
        const artboardHeight = targetArtboard?.height ?? backgroundArtboard?.height ?? 400;
        const artboardDpi = targetArtboard?.dpi ?? backgroundArtboard?.dpi ?? 72;
        const artboardBgColor = targetArtboard?.backgroundColor ?? backgroundArtboard?.backgroundColor ?? '#ffffff';
        const printConfig = targetArtboard?.printConfig ?? backgroundArtboard?.printConfig;
        
        const bgMode = exportSettings.exportBackgroundMode || 'transparent';
        const is16Bit = (exportSettings.tiffBitDepth ?? 8) === 16;
        
        // Fetch export estimate for estimated time display
        try {
          const estimate = await fetchServerExportEstimate(
            { 
              width: artboardWidth, 
              height: artboardHeight, 
              dpi: artboardDpi,
              printConfig: printConfig
            },
            { 
              format: 'tiff', 
              bitDepth: is16Bit ? 16 : 8, 
              scale: effectiveExportScale 
            }
          );
          // Convert milliseconds to seconds for display
          if (estimate.estimatedDuration > 0) {
            setExportEstimatedTimeGlobal(Math.ceil(estimate.estimatedDuration / 1000));
          }
        } catch (estimateError) {
          // Estimate is optional, continue without it
          console.log('Could not fetch export estimate:', estimateError);
        }
        
        setExportProgressGlobal(10);
        setExportStatusGlobal('Preparing shapes for export...');
        setBatchProgress(10);
        setBatchStatus('Preparing export...');
        
        // Use existing canvas shapes (WYSIWYG) — server renders them at full resolution
        // without browser memory constraints. Single export does not auto-generate shapes.
        let shapesToExport: Shape[] = [];
        
        console.log(`🔍 SERVER EXPORT: Using existing canvas shapes (${shapes.length} total), exportMode=${exportMode}`);
        
        if (exportMode === 'selection' && selectedShapes.length > 0) {
          shapesToExport = selectedShapes;
          console.log(`🔍 SERVER EXPORT: Using ${selectedShapes.length} selected shapes`);
        } else {
          shapesToExport = shapes;
          console.log(`🔍 SERVER EXPORT: Using all ${shapes.length} canvas shapes`);
        }
        
        if (shapesToExport.length === 0) {
          setShowExportProgressOverlay(false);
          setIsServerExportingGlobal(false);
          const isInGenerationMode = exportSettings.generationSetsEnabled || exportSettings.exportBatchModeEnabled;
          toast({
            title: "No shapes to export",
            description: isInGenerationMode
              ? "Single export uses whatever is on the canvas — it doesn't auto-generate shapes. Click Generate to populate the canvas first, then export. Alternatively, use Batch Export (count ≥ 2) which auto-generates shapes for every export."
              : "No shapes were found on the canvas. Make sure your shapes are positioned on the artboard.",
            variant: "destructive",
            duration: isInGenerationMode ? 8000 : 5000,
          });
          return;
        }
        
        console.log(`🔍 SERVER EXPORT: Exporting ${shapesToExport.length} shapes`);
        
        // Serialize shapes with full data for server rendering (matching projectManager format)
        const serializeShape = (shape: Shape) => ({
          id: shape.id,
          type: shape.type,
          transform: shape.transform,
          properties: shape.properties,
          points: shape.points,
          sides: shape.sides,
          radius: shape.radius,
          innerRadius: shape.innerRadius,
          width: shape.width,
          height: shape.height,
          controlPoints: shape.controlPoints,
          tangentHandles: shape.tangentHandles,
          smoothPoints: shape.smoothPoints,
          closed: shape.closed,
          segments: shape.segments,
          renderType: shape.renderType,
          cornerRadius: shape.cornerRadius,
          strokeCap: shape.strokeCap,
          shapeRenderMode: shape.shapeRenderMode
        });
        
        const serializedShapes = shapesToExport.map(serializeShape);
        
        console.log(`🔍 SERVER EXPORT DEBUG: serializedShapes has ${serializedShapes.length} entries`);
        if (serializedShapes.length > 0) {
          console.log(`🔍 SERVER EXPORT DEBUG: First shape:`, JSON.stringify(serializedShapes[0]).substring(0, 500));
        }
        
        // Serialize groups - include all groups that contain any of the shapes being exported
        // Use all available groups, not just selectedGroups
        const shapeIds = new Set(shapesToExport.map(s => s.id));
        const allGroups = [...selectedGroups]; // selectedGroups contains all groups in the scene
        const serializedGroups = allGroups
          .filter(group => group.shapes.some(s => shapeIds.has(s.id)))
          .map(group => ({
            id: group.id,
            transform: group.transform,
            shapes: group.shapes.filter(s => shapeIds.has(s.id)).map(s => s.id)
          }));
        
        const artboardX = targetArtboard?.x ?? backgroundArtboard?.x ?? 0;
        const artboardY = targetArtboard?.y ?? backgroundArtboard?.y ?? 0;
        
        // Get compression settings from the modal
        const compressionSettings = compressionSettingsRef.current;
        
        const request: ServerExportRequest = {
          shapes: serializedShapes,
          groups: serializedGroups,
          artboard: {
            x: artboardX,
            y: artboardY,
            width: artboardWidth,
            height: artboardHeight,
            backgroundColor: artboardBgColor,
            dpi: artboardDpi,
            printConfig: printConfig
          },
          exportSettings: {
            format: exportFormat === 'jpg' ? 'jpeg' : (exportFormat as 'tiff' | 'png' | 'jpeg' | 'webp'),
            bitDepth: is16Bit ? 16 : 8,
            dpi: artboardDpi,
            scale: effectiveExportScale,
            includeBleed: exportMode === 'artboard-extended' && (printConfig?.overlays.bleed.render ?? false),
            includePrintMarks: exportMode === 'artboard-extended' && (printConfig?.overlays.printMarks.render ?? false),
            backgroundColor: bgMode === 'artboard' ? artboardBgColor : undefined,
            backgroundMode: bgMode,
            compression: exportSettings.tiffCompression ?? 'none',
            quality: exportQuality ?? 90,
            saveProjectFile: exportSettings.exportSaveProjectFiles ?? false,
            saveGeneratorFile: exportSettings.exportSaveGeneratorFiles ?? false,
            flattenToRgb: exportSettings.flattenToRgb ?? false,
            matteColor: exportSettings.matteColor ?? '#ffffff',
            // Metadata fields for professional print exports
            artistName: exportSettings.artistName ?? '',
            copyrightText: exportSettings.copyrightText ?? '',
            imageTitle: exportSettings.imageTitle ?? '',
            imageDescription: exportSettings.imageDescription ?? '',
            embedIccProfile: exportSettings.embedIccProfile !== false
          },
          exportMode: exportMode as 'artboard' | 'all' | 'selection' | 'artboard-extended',
          enabledShapeTypes: Array.from(enabledShapeTypes),
          archiveCompression: compressionSettings.enabled ? {
            enabled: true,
            format: compressionSettings.format,
            level: compressionSettings.level
          } : undefined
        };
        
        setBatchProgress(15);
        setBatchStatus('Connecting to server...');
        setExportProgressGlobal(15);
        setExportStatusGlobal('Connecting to server...');
        
        console.log(`🖥️ SERVER EXPORT: Starting high-resolution export ${artboardWidth}×${artboardHeight} @ ${artboardDpi} DPI`);
        console.log(`🗜️ SERVER EXPORT: Compression settings:`, JSON.stringify(request.archiveCompression));
        
        // Use polling for real-time progress updates (SSE times out at 300 s on Replit autoscale)
        const result = await executeServerExportWithPolling(
          request,
          {
            onPhase: (phase, message) => {
              console.log(`📋 Phase: ${phase} - ${message}`);
              setExportStatusGlobal(message);
              setBatchStatus(message);
            },
            onTile: (tileIndex, totalTiles, step, progressPct) => {
              const tileMessage = step === 'render' 
                ? `Rendering tile ${tileIndex} of ${totalTiles}...`
                : `Stitching tile ${tileIndex} of ${totalTiles}...`;
              console.log(`🧩 Tile: ${tileMessage} (${progressPct}%)`);
              setExportStatusGlobal(tileMessage);
              setBatchStatus(tileMessage);
              // Map tile progress to 20-80% range
              const mappedProgress = 20 + (progressPct * 0.6);
              setExportProgressGlobal(Math.round(mappedProgress));
              setBatchProgress(Math.round(mappedProgress));
            },
            onProgress: (progressPct, status, estimatedRemaining) => {
              // Map progress to 20-80% range (reserve 0-20 for init, 80-100 for download)
              const mappedProgress = 20 + (progressPct * 0.6);
              setExportProgressGlobal(Math.round(mappedProgress));
              setBatchProgress(Math.round(mappedProgress));
              setExportStatusGlobal(status);
              setBatchStatus(status);
              if (estimatedRemaining !== undefined) {
                setExportEstimatedTimeGlobal(estimatedRemaining);
              }
              const chunkMatch = status.match(/\[Chunk (\d+)\/(\d+)\]/);
              if (chunkMatch) {
                setExportChunkIndexGlobal(parseInt(chunkMatch[1], 10));
                setExportChunkCountGlobal(parseInt(chunkMatch[2], 10));
              }
            },
            onComplete: (downloadUrl, filename, sizeBytes) => {
              console.log(`📥 Export complete: ${filename} (${(sizeBytes / 1024 / 1024).toFixed(2)} MB)`);
              setExportProgressGlobal(85);
              setBatchProgress(85);
              setExportStatusGlobal('Downloading...');
              setBatchStatus('Downloading...');
            },
            onError: (message) => {
              console.error(`❌ Server export error: ${message}`);
            }
          },
          exportAbortControllerGlobalRef.current?.signal
        );
        
        if (result.success && result.downloadUrl) {
          // Use the actual filename and size from server response
          const filename = result.filename || 'export.tiff';
          const sizeBytes = result.sizeBytes || 0;
          
          // Format size string - show "size unknown" if 0 bytes
          const sizeDisplay = sizeBytes > 0 
            ? `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`
            : 'size pending';
          
          // Use server download URL directly - avoids loading 900MB+ into browser memory
          // Browser will stream file to disk when user clicks the download link
          setExportDownloadUrlGlobal(result.downloadUrl);
          setExportDownloadFilenameGlobal(filename);
          
          // Auto-download project file if it was saved
          if (result.projectDownloadUrl && result.projectFilename) {
            console.log(`📄 Downloading project file: ${result.projectFilename}`);
            // Create invisible link to trigger project file download
            const projectLink = document.createElement('a');
            projectLink.href = result.projectDownloadUrl;
            projectLink.download = result.projectFilename;
            document.body.appendChild(projectLink);
            projectLink.click();
            document.body.removeChild(projectLink);
          }
          
          setBatchProgress(100);
          setBatchStatus('Ready to save!');
          setExportProgressGlobal(100);
          setExportStatusGlobal('Ready to save!');
          setExportIsCompleteGlobal(true);
          setExportResultMessageGlobal(`✅ ${filename} (${sizeDisplay}) - Tap "Save File" to download`);
          stopElapsedTimeTrackingGlobal();
          console.log(`✅ SERVER EXPORT: Complete - ${filename} (${sizeDisplay})`);
          
          // Don't auto-close - let user click save button
          setIsServerExportingGlobal(false);
          setBatchProgress(0);
          setBatchStatus('');
        } else {
          throw new Error(result.error || 'Export failed');
        }
        
      } catch (error) {
        console.error('Server export failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setBatchStatus(`Export failed: ${errorMessage}`);
        setExportStatusGlobal(`Export failed: ${errorMessage}`);
        setExportIsErrorGlobal(true);
        setExportResultMessageGlobal(`❌ Export failed: ${errorMessage}`);
        stopElapsedTimeTrackingGlobal();
        
        setTimeout(() => {
          setIsServerExportingGlobal(false);
          setBatchProgress(0);
          setBatchStatus('');
        }, 3000);
      }
    };
    serverExportRef.current = handleServerExport;

    // Wrapper function that shows TIFF pre-flight modal if needed and routes to server for large exports
    const handleBatchExportWithPreflight = useCallback(() => {
      if (!exportSettings.exportBatchModeEnabled) return;
      
      // Batch export ALWAYS generates fresh shapes for every image via handleBatchExportNewInternal.
      // handleServerExport renders the current canvas once (no fresh generation) — it is for single
      // high-res exports only.  When server render mode is selected alongside batch mode the
      // client-side batch loop still drives generation (repetition, distribution, set configs are
      // all applied correctly).  Per-image server rendering is a future enhancement.
      if (exportFormat === 'tiff' && !exportSettings.skipTiffPreflightModal) {
        pendingTiffExportRef.current = handleBatchExportNewInternal;
        setIsTiffPreflightOpen(true);
      } else {
        handleBatchExportNewInternal();
      }
    }, [exportSettings.exportBatchModeEnabled, exportSettings.skipTiffPreflightModal, exportFormat]);
    
    // NEW BATCH EXPORT WITH ZIP PACKAGING (internal implementation)
    // Accepts optional preformedShapes for single-export routing: when provided the function
    // skips shape generation and renders those shapes directly, enabling a unified code path.
    const handleBatchExportNewInternal = async (preformedShapes?: Shape[]) => {
      if (!exportSettings.exportBatchModeEnabled && !preformedShapes) return;

      // Calculate actual number of images to export for step calculation
      // preformedShapes: always a single export (count = 1)
      const actualImageCount = preformedShapes ? 1 : (exportAllImages ? exportBatchCount : selectedImageIndices.length);
      
      // Calculate total steps based on packaging mode and actual image count
      const totalSteps = packageAsZip 
        ? (actualImageCount * 2) + 2 // 2 steps per image + zip creation + download
        : (actualImageCount * 3); // 2 steps per image + individual download per image

      // Initialize abort controller and elapsed time tracking
      exportAbortControllerRef.current = new AbortController();
      startElapsedTimeTracking();
      
      // Initialize global overlay for client-side batch export
      setShowExportProgressOverlay(true);
      setExportTotalStepsGlobal(totalSteps);
      setExportProgressGlobal(0);
      setExportStatusGlobal('Initializing batch export...');
      setExportIsCompleteGlobal(false);
      setExportIsErrorGlobal(false);
      setExportResultMessageGlobal('');
      exportAbortControllerGlobalRef.current = exportAbortControllerRef.current;
      startElapsedTimeTrackingGlobal();

      setIsBatchExporting(true);
      setBatchProgress(0);
      setBatchTotalSteps(totalSteps);
      setBatchStatus('Initializing batch export...');
      console.log(`🚀 BATCH EXPORT: Starting ${actualImageCount} exports (${packageAsZip ? 'ZIP package' : 'individual files'}) - ${exportAllImages ? 'All images' : 'Selected images'}`);
      
      // Get artboard for background color (used in all modes when available)
      const backgroundArtboard = artboards.find(ab => ab.id === activeArtboard);
      
      // Get the target artboard for dimensions (only when exportMode is 'artboard')
      const targetArtboard = (exportMode === 'artboard' || exportMode === 'artboard-extended')
        ? (selectedArtboardForExport 
            ? artboards.find(ab => ab.id === selectedArtboardForExport)
            : backgroundArtboard)
        : null;
      
      // Use targetArtboard bounds for generation when in artboard mode so that
      // shapes are generated in the same coordinate space used for translation.
      // Fall back to backgroundArtboard (active artboard) for other modes.
      const generationBounds = targetArtboard ? {
        x: targetArtboard.x,
        y: targetArtboard.y,
        width: targetArtboard.width,
        height: targetArtboard.height
      } : backgroundArtboard ? {
        x: backgroundArtboard.x,
        y: backgroundArtboard.y,
        width: backgroundArtboard.width,
        height: backgroundArtboard.height
      } : {
        x: -200,
        y: -200,
        width: 400,
        height: 400
      };
      
      console.log(`📐 Using bounds: ${generationBounds.width}x${generationBounds.height} at (${generationBounds.x}, ${generationBounds.y})`);
      
      // MEMORY ESTIMATION FOR TIFF EXPORTS
      // Calculate estimated memory requirements and apply limits for large TIFF exports
      const isTiffExport = exportFormat === 'tiff';
      let effectiveBatchCount = actualImageCount;
      
      if (isTiffExport) {
        // Artboard dimensions are already stored at the artboard's own DPI.
        // The only multiplier is the user's manual export scale (default 1).
        const scaledWidth = generationBounds.width * effectiveExportScale;
        const scaledHeight = generationBounds.height * effectiveExportScale;
        const pixelsPerImage = scaledWidth * scaledHeight;
        const megapixelsPerImage = pixelsPerImage / 1_000_000;
        
        // TIFF requires ~4 bytes per pixel for RGBA (getImageData) + encoding buffer
        const bytesPerImage = pixelsPerImage * 4;
        const mbPerImage = bytesPerImage / (1024 * 1024);
        const totalEstimatedMb = mbPerImage * actualImageCount;
        
        console.log(`🧮 TIFF Memory Estimation:`);
        console.log(`   - Canvas size: ${Math.round(scaledWidth)}×${Math.round(scaledHeight)} (${megapixelsPerImage.toFixed(1)} MP)`);
        console.log(`   - Memory per image: ~${mbPerImage.toFixed(0)} MB`);
        console.log(`   - Total for ${actualImageCount} images: ~${totalEstimatedMb.toFixed(0)} MB`);
        
        // Browser memory limits: ~1-2 GB practical limit for tab
        // Conservative threshold: warn above 300 MB, limit above 600 MB
        const WARNING_THRESHOLD_MB = 300;
        const LIMIT_THRESHOLD_MB = 600;
        const MAX_SAFE_MEGAPIXELS = 150; // ~600 MB for single image
        
        if (megapixelsPerImage > MAX_SAFE_MEGAPIXELS) {
          // Single image too large - warn but allow (user may have enough RAM)
          console.warn(`⚠️ TIFF export: Each image is ${megapixelsPerImage.toFixed(1)} MP (>${MAX_SAFE_MEGAPIXELS} MP limit). May cause memory issues.`);
          setBatchStatus(`⚠️ Large TIFF export (${megapixelsPerImage.toFixed(1)} MP per image). Processing sequentially...`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        if (totalEstimatedMb > LIMIT_THRESHOLD_MB && actualImageCount > 1) {
          // Calculate safe batch size based on memory per image
          const maxSafeCount = Math.max(1, Math.floor(LIMIT_THRESHOLD_MB / mbPerImage));
          effectiveBatchCount = Math.min(actualImageCount, maxSafeCount);
          
          console.warn(`⚠️ TIFF batch export: Reducing from ${actualImageCount} to ${effectiveBatchCount} images to stay under ${LIMIT_THRESHOLD_MB} MB memory limit.`);
          setBatchStatus(`⚠️ Limiting TIFF batch to ${effectiveBatchCount} images for memory safety...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else if (totalEstimatedMb > WARNING_THRESHOLD_MB) {
          console.warn(`⚠️ TIFF batch export: Estimated ${totalEstimatedMb.toFixed(0)} MB memory usage. Processing carefully...`);
        }
      }
      
      // Helper to update both local and global progress
      // Parses optional "[Chunk X/Y]" suffix from status strings to populate chunk indicator
      const updateProgress = (step: number, status: string) => {
        setBatchProgress(step);
        setBatchStatus(status);
        setExportProgressGlobal(step);
        setExportStatusGlobal(status);
        const chunkMatch = status.match(/\[Chunk (\d+)\/(\d+)\]/);
        if (chunkMatch) {
          setExportChunkIndexGlobal(parseInt(chunkMatch[1], 10));
          setExportChunkCountGlobal(parseInt(chunkMatch[2], 10));
        }
      };
      
      try {
        // Initialize packaging based on user setting
        updateProgress(1, packageAsZip ? 'Initializing ZIP archive...' : 'Preparing individual files...');
        const zip = packageAsZip ? new JSZip() : null;
        const timestamp = Date.now();
        const individualFiles: Array<{blob: Blob, filename: string}> = [];
        
        let currentStep = 1; // Start at 1 to avoid initial 0% display
        
        // Determine which images to export based on exportAllImages setting
        // For TIFF exports, use effectiveBatchCount which may be reduced for memory safety
        const exportCount = preformedShapes ? 1 : (isTiffExport ? effectiveBatchCount : exportBatchCount);
        const imagesToExport = preformedShapes
          ? [0]
          : (exportAllImages
              ? Array.from({ length: exportCount }, (_, i) => i)
              : selectedImageIndices.slice(0, exportCount));
        
        console.log(`🎯 Export selection: ${exportAllImages ? 'All images' : 'Selected images'} - Processing indices: [${imagesToExport.join(', ')}]`);
        if (isTiffExport && effectiveBatchCount < actualImageCount) {
          console.log(`📉 TIFF batch limited from ${actualImageCount} to ${effectiveBatchCount} images for memory safety`);
        }
        
        for (let loopIndex = 0; loopIndex < imagesToExport.length; loopIndex++) {
          // Check for abort signal at start of each iteration
          if (exportAbortControllerRef.current?.signal.aborted) {
            console.log('🛑 Export aborted during batch loop');
            stopElapsedTimeTracking();
            stopElapsedTimeTrackingGlobal();
            setExportStatusGlobal('Export cancelled');
            setExportIsErrorGlobal(true);
            setExportResultMessageGlobal('⚠️ Export was cancelled');
            return;
          }
          
          const i = imagesToExport[loopIndex];
          console.log(`🎨 Creating artwork ${i + 1} of ${exportBatchCount}`);
          console.log(`📊 BATCH PROCESSING: ${i + 1} of ${exportBatchCount} exports`);
          
          // Shape collection: pre-formed (single export) or freshly generated (batch)
          const currentExportShapes: Shape[] = [];

          if (preformedShapes) {
            // Single export: use the live canvas shapes directly — no generation needed.
            // shape.render(ctx) is the same renderer used by the live canvas and batch export,
            // so rectangles, gradients, render modes, and all visual properties match exactly.
            currentExportShapes.push(...preformedShapes);
          } else {
          // STEP 1: Shape Generation
          updateProgress(currentStep, `Generating shapes for artwork ${i + 1}...`);
          console.log(`📊 PROGRESS UPDATE: Step ${currentStep}/${totalSteps} - Generating shapes for artwork ${i + 1}`);
          
          // Force UI update before incrementing step
          await new Promise(resolve => {
            setTimeout(() => {
              console.log(`⏳ Shape generation delay completed for artwork ${i + 1} - Progress: ${currentStep}/${totalSteps}`);
              resolve(undefined);
            }, 200); // Reduced delay for better responsiveness
          });
          
          currentStep++;
          
          // Clear canvas and generate fresh shapes
          onClearAll?.();
          await new Promise(resolve => setTimeout(resolve, 200));

          // Generate shapes for this export using batch configuration
          // Use user's configured generations per export and shape count values
          let generationCallsCount: number;
          
          // When Shape Sets are enabled, ignore generations per export setting
          if (exportSettings.generationSetsEnabled && generationSets && generationSets.length > 0) {
            generationCallsCount = 1; // Each set runs once
            console.log(`🔢 SHAPE SETS MODE: Each set runs once (generationCallsCount=1)`);
          } else {
            // Determine generations per export based on user's mode setting
            if (generationConfigSettings?.generationCountMode === 'fixed') {
              generationCallsCount = generationConfigSettings?.generationCountDefine || 5;
              console.log(`🔢 Using FIXED generations per export: ${generationCallsCount} (user configured)`);
            } else if (generationConfigSettings?.generationCountMode === 'range') {
              // Use user's configured range from UI slider (exportShapeCountRange controlled by user)
              generationCallsCount = Math.floor(Math.random() * (exportShapeCountRange[1] - exportShapeCountRange[0] + 1)) + exportShapeCountRange[0];
              console.log(`🔢 Using RANGE generations per export: ${generationCallsCount} (random ${exportShapeCountRange[0]}-${exportShapeCountRange[1]} from user range slider)`);
            } else {
              // Fallback to default
              generationCallsCount = 5;
              console.log(`🔢 Using DEFAULT generations per export: ${generationCallsCount} (fallback)`);
            }
          }

          // Simulate multiple button presses - each call generates shapes based on user's shape count settings
          
          // Check if generation sets mode is enabled
          if (exportSettings.generationSetsEnabled && generationSets && generationSets.length > 0) {
            const { sorted: enabledSets, cycleSetIds } = sortCopyToPointsSets(
              generationSets.filter(set => set.enabled),
              set => set.id === currentGenerationSetId ? generationConfigSettings : set.batchConfig,
            );
            if (cycleSetIds.size) {
              console.warn(`[CTP] Batch export is using generation order due to circular dependency: ${Array.from(cycleSetIds).join(', ')}`);
            }
            
            if (enabledSets.length > 0) {
              console.log(`🎯 GENERATION SETS MODE: Using ${enabledSets.length} enabled sets`);
              
              // DIAGNOSTIC: Log each set's batchConfig on load
              enabledSets.forEach((set, idx) => {
                console.log(`🔍 [DIAGNOSTIC] Set ${idx + 1} "${set.name}" batchConfig:`, {
                  hasConfig: !!set.batchConfig,
                  propertiesEnabled: set.batchConfig?.propertiesEnabled,
                  fillColorMode: set.batchConfig?.fillColorMode,
                  fillColorDefine: set.batchConfig?.fillColorDefine,
                  fillOpacityDefine: set.batchConfig?.fillOpacityDefine,
                  fillStyleProbability: set.batchConfig?.fillStyleProbability
                });
              });
              
              // Loop through each generation call
              for (let callIndex = 0; callIndex < generationCallsCount; callIndex++) {
                // Per-artwork point sources include all repetitions, but never a previous artwork.
                const shapesBySetId = new Map<string, Shape[]>();
                const configForSet = (entry: GenerationSet) =>
                  entry.id === currentGenerationSetId ? generationConfigSettings : entry.batchConfig;
                // Generate shapes for each enabled set
                for (let setIndex = 0; setIndex < enabledSets.length; setIndex++) {
                  const set = enabledSets[setIndex];
                  let previousEchoCentroid: { x: number; y: number } | undefined;
                  
                  // Calculate repetition count for this set
                  const useSetRepetition = set.repetitionMode && set.repetitionMode !== 'use-global';
                  let repetitionCount = 0;
                  
                  if (useSetRepetition) {
                    if (set.repetitionMode === 'fixed') {
                      repetitionCount = set.repetitionValue || 0;
                    } else if (set.repetitionMode === 'range' && set.repetitionRange) {
                      const [min, max] = set.repetitionRange;
                      repetitionCount = Math.floor(Math.random() * (max - min + 1)) + min;
                    }
                  } else {
                    // Use global repetition settings
                    if (globalRepetitionMode === 'fixed') {
                      repetitionCount = globalRepetitionValue;
                    } else {
                      const [min, max] = globalRepetitionRange;
                      repetitionCount = Math.floor(Math.random() * (max - min + 1)) + min;
                    }
                  }
                  
                  const totalReps = Math.max(1, repetitionCount);
                  console.log(`🔁 [BATCH REPETITION] Set "${set.name}" will generate ${totalReps} time(s)`);
                  
                  // Loop for each repetition - regenerate shapes fresh each time
                  for (let repIndex = 0; repIndex < totalReps; repIndex++) {
                    if (repetitionCount > 0) {
                      console.log(`🔁 [BATCH REPETITION ${repIndex + 1}/${totalReps}] Generating fresh shapes for set "${set.name}"`);
                    }
                    
                    // Calculate shape count for this set
                    let shapesFromThisCall: number;
                    const isCurrentSet = set.id === currentGenerationSetId;
                    const setGenMode = set.shapeTypeGenMode ?? 'random';
                    const countMode = isCurrentSet ? scatterSettings.shapeCountMode : set.shapeCountMode;
                    const countRange: [number, number] = isCurrentSet
                      ? [scatterSettings.minCount, scatterSettings.maxCount]
                      : set.shapeCountRange;
                    const isFixedMode = countMode === ShapeCountMode.FIXED || String(countMode).toLowerCase() === 'fixed';
                    if (setGenMode === 'fixed') {
                      shapesFromThisCall = fixedModeCount(set.enabledShapeTypes, set.shapeTypeFixedCounts);
                    } else if (isFixedMode) {
                      shapesFromThisCall = isCurrentSet
                        ? (scatterSettings.fixedShapeCount ?? set.shapeCountFixed)
                        : set.shapeCountFixed;
                      console.log(`📞 [${set.name}] Generation ${callIndex + 1}/${generationCallsCount}: Creating ${shapesFromThisCall} shapes (FIXED)`);
                    } else {
                      shapesFromThisCall = Math.floor(Math.random() * (countRange[1] - countRange[0] + 1)) + countRange[0];
                      console.log(`📞 [${set.name}] Generation ${callIndex + 1}/${generationCallsCount}: Creating ${shapesFromThisCall} shapes (RANGE ${countRange[0]}-${countRange[1]})`);
                    }
                    
                    // Create overrides from set configuration
                    const overrides = {
                      enabledShapeTypes: new Set(set.enabledShapeTypes as ShapeType[]),
                      batchConfig: isCurrentSet ? undefined : set.batchConfig,
                      scatterSettings: batchSetScatterOverride(set, isCurrentSet, shapesFromThisCall),
                      setRepIndex: repIndex,  // Pass repetition index so Index Driver (setRepIndex) works correctly
                      setTransform: set.setTransform,
                      artboardAlignment: set.artboardAlignment,
                      shapeTypeGenMode: setGenMode,
                      shapeTypeWeights: set.shapeTypeWeights,
                      shapeTypeFixedCounts: set.shapeTypeFixedCounts,
                      shapeTypeSequence: set.shapeTypeSequence,
                    };
                    
                    // DIAGNOSTIC: Log overrides being passed
                    console.log(`🔍 [DIAGNOSTIC] Passing overrides for "${set.name}" (rep ${repIndex}/${totalReps - 1}):`, {
                      hasOverrides: !!overrides,
                      hasBatchConfig: !!overrides.batchConfig,
                      setRepIndex: overrides.setRepIndex,
                      fillColorMode: overrides.batchConfig?.fillColorMode,
                      fillColorDefine: overrides.batchConfig?.fillColorDefine,
                      propertiesEnabled: overrides.batchConfig?.propertiesEnabled
                    });
                    
                    let newShapes = onGenerateShapesWithBatchConfig(
                      shapesFromThisCall, 
                      generationBounds, 
                      true, 
                      i + callIndex * 1000 + setIndex + repIndex * 100,  // advance seed per repetition
                      isCurrentSet ? undefined : set.shapeSpecificProperties,
                      overrides
                    );
                    
                    // Apply set-specific post-processing
                    // Apply z-index offset based on generation order (1000x spacing ensures sets never overlap)
                    newShapes.forEach(shape => {
                      shape.properties.zIndex += set.generationOrder * 1000;
                    });
                    
                    // NOTE: Set-level blend modes and compositing operations are applied during rendering,
                    // not to individual shapes. Shapes keep their own blend modes.
                    
                    // Apply visibility and opacity
                    if (set.setVisibility) {
                      if (!set.setVisibility.visible) {
                        // Skip adding these shapes if set is not visible
                        continue;
                      }
                      if (set.setVisibility.opacity !== undefined && set.setVisibility.opacity < 1.0) {
                        const variance = set.setVisibility.opacityVariance || 0;
                        newShapes.forEach(shape => {
                          const randomVariance = (Math.random() - 0.5) * 2 * variance;
                          const finalOpacity = Math.max(0, Math.min(1, set.setVisibility.opacity + randomVariance));
                          shape.properties.fillOpacity *= finalOpacity;
                          shape.properties.strokeOpacity *= finalOpacity;
                        });
                      }
                    }

                    // Harvest only after the same set positioning as live generation.
                    positionGenerationSetShapes(newShapes, set, targetArtboard ?? backgroundArtboard);
                    newShapes = placeCopyToPointsShapes(
                      set, newShapes, shapesBySetId, enabledSets, configForSet,
                    );
                    
                    // Clone the finalized originals once, after set visibility and
                    // opacity, just as live generation does.
                    const echoed = addEchoesToShapes(
                      newShapes,
                      resolveEchoConfig(set.batchConfig, set.echoOverride),
                      repIndex,
                      generationBounds,
                      previousEchoCentroid,
                    );
                    previousEchoCentroid = echoed.previousCentroid;
                    echoed.shapes.forEach(shape => {
                      (shape as any)._generationSetOrder = set.generationOrder;
                    });
                    if (!hideCopyToPointsSource(set, enabledSets, configForSet)) {
                      currentExportShapes.push(...echoed.shapes);
                    }
                  } // End of repetition loop
                }
              }
            } else {
              console.log(`⚠️ No enabled generation sets, using current UI state as fallback`);
              // Fallback to current UI state
              for (let callIndex = 0; callIndex < generationCallsCount; callIndex++) {
                let shapesFromThisCall: number;
                if (scatterSettings.shapeCountMode === 'fixed') {
                  shapesFromThisCall = scatterSettings.fixedShapeCount || 10;
                  console.log(`📞 Generation call ${callIndex + 1}/${generationCallsCount}: Creating ${shapesFromThisCall} shapes (FIXED user configured)`);
                } else {
                  shapesFromThisCall = Math.floor(Math.random() * (scatterSettings.maxCount - scatterSettings.minCount + 1)) + scatterSettings.minCount;
                  console.log(`📞 Generation call ${callIndex + 1}/${generationCallsCount}: Creating ${shapesFromThisCall} shapes (RANGE ${scatterSettings.minCount}-${scatterSettings.maxCount})`);
                }
                const newShapes = onGenerateShapesWithBatchConfig(shapesFromThisCall, generationBounds, true, i + callIndex * 1000);
                currentExportShapes.push(...addEchoesToShapes(
                  newShapes, generationConfigSettings?.echoSpread, 0, generationBounds,
                ).shapes);
              }
            }
          } else {
            // Generation sets disabled - use current UI state
            console.log(`🎯 NORMAL MODE: Using current UI state`);
            for (let callIndex = 0; callIndex < generationCallsCount; callIndex++) {
              let shapesFromThisCall: number;
              
              // Determine shapes per generation based on user's shape count mode
              if (scatterSettings.shapeCountMode === 'fixed') {
                shapesFromThisCall = scatterSettings.fixedShapeCount || 10;
                console.log(`📞 Generation call ${callIndex + 1}/${generationCallsCount}: Creating ${shapesFromThisCall} shapes (FIXED user configured)`);
              } else {
                shapesFromThisCall = Math.floor(Math.random() * (scatterSettings.maxCount - scatterSettings.minCount + 1)) + scatterSettings.minCount;
                console.log(`📞 Generation call ${callIndex + 1}/${generationCallsCount}: Creating ${shapesFromThisCall} shapes (RANGE ${scatterSettings.minCount}-${scatterSettings.maxCount})`);
              }
              
              const newShapes = onGenerateShapesWithBatchConfig(shapesFromThisCall, generationBounds, true, i + callIndex * 1000);
              currentExportShapes.push(...addEchoesToShapes(
                newShapes, generationConfigSettings?.echoSpread, 0, generationBounds,
              ).shapes);
            }
          }
          
          console.log(`✨ Generated ${currentExportShapes.length} total shapes from ${generationCallsCount} generation calls for export ${i + 1}`);
          } // end else (batch shape generation)

          // Check for abort after shape generation
          if (exportAbortControllerRef.current?.signal.aborted) {
            console.log('🛑 Export aborted after shape generation');
            stopElapsedTimeTracking();
            stopElapsedTimeTrackingGlobal();
            setExportStatusGlobal('Export cancelled');
            setExportIsErrorGlobal(true);
            setExportResultMessageGlobal('⚠️ Export was cancelled');
            return;
          }

          // Create image data for ZIP with timestamp
          const imageTimestamp = Date.now() + i; // Unique timestamp for each image
          const filename = preformedShapes
            ? `export-${imageTimestamp}.${exportFormat}`
            : `batch-${String(i + 1).padStart(3, '0')}-${imageTimestamp}.${exportFormat}`;
          
          if (currentExportShapes.length > 0) {
            // STEP 2: Image Creation and Export
            updateProgress(currentStep, `Creating image for artwork ${i + 1}...`);
            console.log(`📊 PROGRESS UPDATE: Step ${currentStep}/${totalSteps} - Creating image for artwork ${i + 1}`);
            
            // Force UI update before incrementing step
            await new Promise(resolve => {
              setTimeout(() => {
                console.log(`⏳ Image creation delay completed for artwork ${i + 1} - Progress: ${currentStep}/${totalSteps}`);
                resolve(undefined);
              }, 200); // Reduced delay for better responsiveness
            });
            
            currentStep++;
            
            console.log(`🖼️ Processing ${currentExportShapes.length} shapes for ${filename}`);
            
            // Use artboard bounds for export dimensions when in artboard mode
            let canvasWidth, canvasHeight, translateX, translateY;
            
            // Print configuration variables for batch export
            let batchBleedPx = 0;
            let batchPrintMarksGutterPx = 0;
            let batchPrintExpansion = 0;
            let batchArtboardForPrintMarks: { x: number; y: number; width: number; height: number } | null = null;
            let batchPrintMarksConfig: { cropMarks: boolean; registrationMarks: boolean; markLength: number; markOffset: number; color?: string } | null = null;
            
            if (targetArtboard) {
              // Get print configuration from artboard
              const batchPrintConfig = targetArtboard.printConfig || DEFAULT_PRINT_CONFIG;
              // Use artboard's actual DPI for print marks calculations (not 72 * scale)
              const batchExportDPI = targetArtboard.dpi || 300;
              const batchOverlayUnit = batchPrintConfig.overlays.overlayUnit || 'pixels';
              
              // DEBUG: Log print configuration for batch export
              console.log('🖨️ [BATCH EXPORT DEBUG] Print Configuration:', {
                artboardName: targetArtboard.name,
                artboardDPI: batchExportDPI,
                hasPrintConfig: !!targetArtboard.printConfig,
                overlayUnit: batchOverlayUnit,
                bleed: {
                  amount: batchPrintConfig.overlays.bleed.amount,
                  render: batchPrintConfig.overlays.bleed.render,
                },
                printMarks: {
                  cropMarks: batchPrintConfig.overlays.printMarks.cropMarks,
                  registrationMarks: batchPrintConfig.overlays.printMarks.registrationMarks,
                  render: batchPrintConfig.overlays.printMarks.render,
                },
              });
              
              // Expansion only applies for "Artboard + Print Marks" scope.
              // Standard "Artboard" scope always crops cleanly to artboard boundary.
              if (exportMode === 'artboard-extended') {
                // Calculate bleed expansion (if render is enabled)
                if (batchPrintConfig.overlays.bleed.render && batchPrintConfig.overlays.bleed.amount > 0) {
                  batchBleedPx = convertPrintUnitToPixels(
                    batchPrintConfig.overlays.bleed.amount,
                    batchOverlayUnit,
                    batchExportDPI
                  );
                }
                
                // Calculate print marks gutter (if render is enabled)
                if (batchPrintConfig.overlays.printMarks.render && (batchPrintConfig.overlays.printMarks.cropMarks || batchPrintConfig.overlays.printMarks.registrationMarks)) {
                  const scaleMode = batchPrintConfig.overlays.printMarks.scaleMode || 'none';
                  const minDimension = Math.min(targetArtboard.width, targetArtboard.height);
                  
                  let markLengthPx: number;
                  let markOffsetPx: number;
                  
                  if (scaleMode === 'percent') {
                    // Percentage mode: values are percentages of the smaller artboard dimension
                    markLengthPx = (batchPrintConfig.overlays.printMarks.markLength / 100) * minDimension;
                    markOffsetPx = (batchPrintConfig.overlays.printMarks.markOffset / 100) * minDimension;
                  } else {
                    // Default mode: convert from unified unit to pixels
                    markLengthPx = convertPrintUnitToPixels(
                      batchPrintConfig.overlays.printMarks.markLength,
                      batchOverlayUnit,
                      batchExportDPI
                    );
                    markOffsetPx = convertPrintUnitToPixels(
                      batchPrintConfig.overlays.printMarks.markOffset,
                      batchOverlayUnit,
                      batchExportDPI
                    );
                  }
                  
                  batchPrintMarksGutterPx = markLengthPx + markOffsetPx + 10;
                  
                  batchPrintMarksConfig = {
                    cropMarks: batchPrintConfig.overlays.printMarks.cropMarks,
                    registrationMarks: batchPrintConfig.overlays.printMarks.registrationMarks,
                    markLength: markLengthPx,
                    markOffset: markOffsetPx,
                    color: batchPrintConfig.overlays.printMarks.color || '#000000'
                  };
                }
              }
              
              // Total print expansion
              batchPrintExpansion = batchBleedPx + batchPrintMarksGutterPx;
              
              // Store artboard bounds for print marks rendering
              if (batchPrintExpansion > 0) {
                batchArtboardForPrintMarks = {
                  x: batchPrintExpansion,
                  y: batchPrintExpansion,
                  width: targetArtboard.width,
                  height: targetArtboard.height
                };
              }
              
              console.log('🖨️ [BATCH EXPORT DEBUG] Print Expansion:', {
                bleedPx: batchBleedPx,
                printMarksGutterPx: batchPrintMarksGutterPx,
                totalExpansion: batchPrintExpansion,
                willRenderMarks: !!batchPrintMarksConfig,
              });
              
              // Use artboard dimensions with print expansion
              canvasWidth = (targetArtboard.width + (batchPrintExpansion * 2)) * effectiveExportScale;
              canvasHeight = (targetArtboard.height + (batchPrintExpansion * 2)) * effectiveExportScale;
              translateX = -targetArtboard.x + batchPrintExpansion;
              translateY = -targetArtboard.y + batchPrintExpansion;
              console.log(`📐 Using artboard bounds: ${targetArtboard.width}x${targetArtboard.height} (expanded to ${canvasWidth/effectiveExportScale}x${canvasHeight/effectiveExportScale} with print config)`);
            } else {
              // Calculate dynamic bounds based on shapes
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              
              currentExportShapes.forEach(shape => {
                const bounds = shape.getBounds();
                const corners = [
                  { x: bounds.x, y: bounds.y },
                  { x: bounds.x + bounds.width, y: bounds.y },
                  { x: bounds.x, y: bounds.y + bounds.height },
                  { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
                ];
                
                corners.forEach(corner => {
                  let x = corner.x * shape.transform.scaleX;
                  let y = corner.y * shape.transform.scaleY;
                  
                  if (shape.transform.rotation !== 0) {
                    const angle = (shape.transform.rotation * Math.PI) / 180;
                    const cos = Math.cos(angle);
                    const sin = Math.sin(angle);
                    const rotatedX = x * cos - y * sin;
                    const rotatedY = x * sin + y * cos;
                    x = rotatedX;
                    y = rotatedY;
                  }
                  
                  x += shape.transform.x;
                  y += shape.transform.y;

                  minX = Math.min(minX, x);
                  minY = Math.min(minY, y);
                  maxX = Math.max(maxX, x);
                  maxY = Math.max(maxY, y);
                });
              });

              const padding = 20;
              canvasWidth = (maxX - minX + padding * 2) * effectiveExportScale;
              canvasHeight = (maxY - minY + padding * 2) * effectiveExportScale;
              translateX = -minX + padding;
              translateY = -minY + padding;
              console.log(`📐 Using dynamic bounds: ${canvasWidth/effectiveExportScale}x${canvasHeight/effectiveExportScale}`);
            }

            // MEMORY ESTIMATION: Log canvas size for diagnostics
            // Browser practical limit is ~268 MP for single canvas, but batch mode needs headroom
            const pixelCount = canvasWidth * canvasHeight;
            const megapixels = pixelCount / 1_000_000;
            const estimatedMB = (pixelCount * 4) / (1024 * 1024); // RGBA = 4 bytes per pixel
            
            // Browser canvas limit: ~268 MP hardware-acceleration ceiling.
            // Use 220 MP for both single and batch — this matches the single-export limit and covers
            // large print artboards (e.g. Poster Medium at 150 DPI auto-scale = ~169 MP).
            // Previously 160 MP for batch caused false-positive failures on poster-sized artboards.
            const MAX_MEGAPIXELS = 220;
            
            console.log(`📊 Memory estimate: ${megapixels.toFixed(1)}MP (${estimatedMB.toFixed(0)}MB RGBA), limit: ${MAX_MEGAPIXELS}MP`);
            
            if (megapixels > MAX_MEGAPIXELS) {
              console.error(`❌ MEMORY GUARD: Canvas size ${Math.round(canvasWidth)}x${Math.round(canvasHeight)} (${megapixels.toFixed(1)}MP) exceeds ${MAX_MEGAPIXELS}MP browser limit for ${exportFormat.toUpperCase()} export.`);
              
              // Graceful degradation: skip this image but continue batch
              setBatchStatus(`⚠️ Skipping image ${i + 1}: Too large (${megapixels.toFixed(0)}MP > ${MAX_MEGAPIXELS}MP limit)`);
              
              // Show the same "Use server export" dialog as the single-export path (first failure only)
              if (i === 0) {
                setClientExportFailureInfo({
                  megapixels,
                  limitMp: MAX_MEGAPIXELS,
                  width: Math.round(canvasWidth),
                  height: Math.round(canvasHeight),
                  reason: 'too-large'
                });
                setShowClientExportFailurePanel(true);
                throw new Error(`Image too large for browser export (${megapixels.toFixed(0)} MP > ${MAX_MEGAPIXELS} MP)`);
              }
              continue; // Skip subsequent images in batch
            }
            
            console.log(`✅ Memory check passed: ${megapixels.toFixed(1)}MP (limit: ${MAX_MEGAPIXELS}MP)`);

            // Create canvas and render
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            if (!ctx) {
              throw new Error(`Failed to get canvas context for export ${i + 1}`);
            }
            
            try {
              canvas.width = canvasWidth;
              canvas.height = canvasHeight;

              // Determine effective background color based on export settings
              // 'transparent' = no background, 'artboard' = use artboard's configured color
              const artboardBgColor = backgroundArtboard?.backgroundColor || '#ffffff';
              const bgMode = exportSettings.exportBackgroundMode || 'transparent';
              const exportBackgroundColor = bgMode === 'artboard' ? artboardBgColor : 'transparent';

              // Check if we need set-based rendering (for compositing operations)
              const hasCompositingOperations = exportSettings.generationSetsEnabled && 
                generationSets?.some(set => set.enabled && set.compositingOperation && set.compositingOperation !== 'source-over');

              if (hasCompositingOperations && exportSettings.generationSetsEnabled && generationSets) {
                // SET-BASED RENDERING WITH COMPOSITING: Use offscreen canvas to avoid background interference
                console.log('🎨 Using set-based rendering with offscreen compositing (background applied last)');
                
                // Create offscreen canvas for compositing (transparent background)
                const compositingCanvas = document.createElement('canvas');
                compositingCanvas.width = canvasWidth;
                compositingCanvas.height = canvasHeight;
                const compositingCtx = compositingCanvas.getContext('2d');
                
                if (!compositingCtx) {
                  throw new Error('Failed to create compositing canvas context');
                }
                
                compositingCtx.scale(effectiveExportScale, effectiveExportScale);
                compositingCtx.translate(translateX, translateY);
                
                const enabledSets = generationSets
                  .filter(set => set.enabled)
                  .sort((a, b) => a.generationOrder - b.generationOrder);
                
                // Echo z-index can fall below its set's 1000x boundary; use the
                // generation membership captured before sorting as the primary key.
                const shapesBySet: Map<number, Shape[]> = new Map();
                currentExportShapes.forEach(shape => {
                  const setIndex = (shape as any)._generationSetOrder ?? Math.floor(shape.properties.zIndex / 1000);
                  if (!shapesBySet.has(setIndex)) {
                    shapesBySet.set(setIndex, []);
                  }
                  shapesBySet.get(setIndex)!.push(shape);
                });
                
                // Calculate SHARED canvas dimensions from ALL shapes (across all sets)
                // This ensures all offscreen canvases are the same size, maintaining relative positions
                let globalMinX = Infinity, globalMinY = Infinity, globalMaxX = -Infinity, globalMaxY = -Infinity;
                currentExportShapes.forEach(shape => {
                  const worldBounds = shape.getWorldBounds();
                  globalMinX = Math.min(globalMinX, worldBounds.x);
                  globalMinY = Math.min(globalMinY, worldBounds.y);
                  globalMaxX = Math.max(globalMaxX, worldBounds.x + worldBounds.width);
                  globalMaxY = Math.max(globalMaxY, worldBounds.y + worldBounds.height);
                });

                // Add padding
                const padding = 50;
                globalMinX -= padding;
                globalMinY -= padding;
                globalMaxX += padding;
                globalMaxY += padding;

                // Calculate shared canvas dimensions in world coordinates (no translation yet)
                const sharedWidth = Math.ceil((globalMaxX - globalMinX) * effectiveExportScale);
                const sharedHeight = Math.ceil((globalMaxY - globalMinY) * effectiveExportScale);

                console.log(`📐 Shared canvas dimensions: ${sharedWidth}x${sharedHeight} for all sets`);
                
                // Render each set to an offscreen canvas (all same size), then composite onto compositing canvas
                enabledSets.forEach((set, idx) => {
                  const setShapes = shapesBySet.get(set.generationOrder) || [];
                  if (setShapes.length === 0) return;
                  
                  console.log(`🖼️ Rendering set "${set.name}" (${setShapes.length} shapes) to shared-size offscreen canvas`);
                  
                  // Create offscreen canvas with SHARED dimensions (same for all sets)
                  const setCanvas = document.createElement('canvas');
                  setCanvas.width = sharedWidth;
                  setCanvas.height = sharedHeight;
                  const setCtx = setCanvas.getContext('2d');
                  
                  if (!setCtx) {
                    console.error(`Failed to create context for set "${set.name}"`);
                    return;
                  }
                  
                  // Apply transform for world coordinates (translate to align with global bounds)
                  setCtx.scale(effectiveExportScale, effectiveExportScale);
                  setCtx.translate(-globalMinX, -globalMinY);
                  
                  // Render shapes for this set with their individual blend modes/comp ops
                  const sortedSetShapes = [...setShapes].sort((a, b) => a.properties.zIndex - b.properties.zIndex);
                  sortedSetShapes.forEach(shape => renderShapeForExport(setCtx, shape));
                  
                  // Composite set canvas onto compositing canvas with set-level blend mode/compositing
                  compositingCtx.save();
                  compositingCtx.setTransform(1, 0, 0, 1, 0, 0); // Reset to pixel coordinates
                  
                  const effectiveBlendMode = (set.compositingOperation && set.compositingOperation !== 'source-over')
                    ? set.compositingOperation
                    : set.setBlendMode;
                  
                  if (effectiveBlendMode && effectiveBlendMode !== 'source-over') {
                    compositingCtx.globalCompositeOperation = effectiveBlendMode as GlobalCompositeOperation;
                    console.log(`🎨 Applying ${effectiveBlendMode} to set "${set.name}"`);
                  }
                  
                  // Draw at world coordinates - compositingCtx already has scale/translate applied
                  const canvasX = (globalMinX + translateX) * effectiveExportScale;
                  const canvasY = (globalMinY + translateY) * effectiveExportScale;
                  compositingCtx.drawImage(setCanvas, canvasX, canvasY);
                  
                  // Reset composite operation for next set
                  compositingCtx.globalCompositeOperation = 'source-over';
                  compositingCtx.restore();
                  
                  // Cleanup
                  setCanvas.width = 0;
                  setCanvas.height = 0;
                });
                
                // NOW draw background to final canvas FIRST (if not transparent)
                if (exportBackgroundColor !== 'transparent') {
                  ctx.fillStyle = exportBackgroundColor;
                  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
                }
                
                // Then draw composited shapes OVER background (using destination-over would put shapes behind)
                ctx.drawImage(compositingCanvas, 0, 0);
                
                // Render print marks for SET-BASED rendering path
                if (batchArtboardForPrintMarks && batchPrintMarksConfig) {
                  ctx.save();
                  ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
                  ctx.scale(effectiveExportScale, effectiveExportScale);
                  renderPrintMarks(
                    ctx,
                    batchArtboardForPrintMarks.x,
                    batchArtboardForPrintMarks.y,
                    batchArtboardForPrintMarks.width,
                    batchArtboardForPrintMarks.height,
                    batchBleedPx,
                    batchPrintMarksConfig
                  );
                  ctx.restore();
                  console.log('🖨️ Print marks rendered (SET-BASED path)');
                }
                
                console.log('✅ Background applied after compositing, preventing interference');
              } else {
                // STANDARD RENDERING: Draw background first (if not transparent), then shapes
                console.log('🎨 Using standard per-shape rendering (background first)');
                if (exportBackgroundColor !== 'transparent') {
                  ctx.fillStyle = exportBackgroundColor;
                  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
                }
                
                ctx.save();
                ctx.scale(effectiveExportScale, effectiveExportScale);
                ctx.translate(translateX, translateY);
                
                const sortedShapes = [...currentExportShapes].sort((a, b) => a.properties.zIndex - b.properties.zIndex);
                sortedShapes.forEach(shape => renderShapeForExport(ctx, shape));
                
                ctx.restore();
                
                // Render print marks for STANDARD rendering path
                if (batchArtboardForPrintMarks && batchPrintMarksConfig) {
                  ctx.save();
                  ctx.scale(effectiveExportScale, effectiveExportScale);
                  renderPrintMarks(
                    ctx,
                    batchArtboardForPrintMarks.x,
                    batchArtboardForPrintMarks.y,
                    batchArtboardForPrintMarks.width,
                    batchArtboardForPrintMarks.height,
                    batchBleedPx,
                    batchPrintMarksConfig
                  );
                  ctx.restore();
                  console.log('🖨️ Print marks rendered (STANDARD path)');
                }
              }

              // Convert canvas to blob and add to ZIP
              if (exportFormat === 'pdf') {
                // Handle PDF separately for ZIP exports.
                // jsPDF renders transparent PNG pixels as solid black.
                // Composite onto white first so every PDF has a clean white background.
                const pdfFlatCanvas = document.createElement('canvas');
                pdfFlatCanvas.width = canvasWidth;
                pdfFlatCanvas.height = canvasHeight;
                const pdfFlatCtx = pdfFlatCanvas.getContext('2d')!;
                pdfFlatCtx.fillStyle = '#ffffff';
                pdfFlatCtx.fillRect(0, 0, canvasWidth, canvasHeight);
                pdfFlatCtx.drawImage(canvas, 0, 0);
                // Validate canvas rendered correctly before embedding
                const pdfImageDataUrl = pdfFlatCanvas.toDataURL('image/png');
                pdfFlatCanvas.width = 0;
                pdfFlatCanvas.height = 0;
                const pdfB64Preview = pdfImageDataUrl?.split(',')[1] ?? '';
                if (pdfB64Preview.length < 500) {
                  console.error(`❌ PDF ${i + 1}: canvas.toDataURL returned a blank/invalid result (${pdfB64Preview.length} chars). Canvas may be too large for browser hardware acceleration.`);
                  setBatchStatus(`⚠️ PDF ${i + 1} skipped: canvas rendered blank (too large for browser)`);
                  continue;
                }
                const pdf = new jsPDF({
                  orientation: canvasWidth > canvasHeight ? 'landscape' : 'portrait',
                  unit: 'pt',
                  format: [canvasWidth / effectiveExportScale, canvasHeight / effectiveExportScale]
                });
                pdf.addImage(pdfImageDataUrl, 'PNG', 0, 0, canvasWidth / effectiveExportScale, canvasHeight / effectiveExportScale);
                const pdfBlob = pdf.output('blob');
                if (packageAsZip && zip) {
                  zip.file(filename, pdfBlob);
                  console.log(`📦 Added ${filename} to ZIP`);
                } else {
                  individualFiles.push({ blob: pdfBlob, filename });
                  console.log(`📁 Prepared ${filename} for individual download`);
                }
              } else if (exportFormat === 'tiff') {
                // Handle TIFF format using UTIF library
                const tiffCtx = canvas.getContext('2d');
                if (tiffCtx) {
                  // Memory guardrail: limit to 200 megapixels (800MB RGBA data) to support A4 300DPI scaled exports
                  const maxPixels = 200_000_000;
                  const pixelCount = canvas.width * canvas.height;
                  if (pixelCount > maxPixels) {
                    console.error(`❌ TIFF batch export skipped for image ${i + 1}: Canvas size (${canvas.width}x${canvas.height} = ${pixelCount.toLocaleString()} pixels) exceeds maximum allowed (${maxPixels.toLocaleString()} pixels).`);
                    continue; // Skip this image in batch mode
                  }
                  
                  try {
                    const imageData = tiffCtx.getImageData(0, 0, canvas.width, canvas.height);
                    // Artboard stores pixels at its own DPI; effective output DPI = artboardDpi × exportScale
                    const batchTiffDPI = Math.round((backgroundArtboard?.dpi ?? 72) * effectiveExportScale);
                    const batchBgMode = exportSettings.exportBackgroundMode || 'transparent';
                    const batchShouldFlattenToRgb = batchBgMode === 'artboard' || (exportSettings.flattenToRgb ?? false);
                    const batchChannelMode = batchShouldFlattenToRgb ? 'RGB' : 'RGBA';
                    console.log(`🔄 Encoding TIFF for image ${i + 1}... (${batchTiffDPI} DPI, ${batchChannelMode})`);
                    const tiffBlob = await encodeCanvasAsTiff(canvas, batchTiffDPI, {
                      compression: exportSettings.tiffCompression ?? 'none',
                      flattenToRgb: batchShouldFlattenToRgb,
                      matteColor: exportSettings.matteColor || '#ffffff',
                    }, false);

                    if (packageAsZip && zip) {
                      zip.file(filename, tiffBlob);
                      console.log(`📦 Added ${filename} to ZIP (TIFF with ${batchTiffDPI} DPI)`);
                    } else {
                      individualFiles.push({ blob: tiffBlob, filename });
                      console.log(`📁 Prepared ${filename} for individual download (TIFF with ${batchTiffDPI} DPI)`);
                    }
                    
                    // ENHANCED MEMORY CLEANUP FOR TIFF:
                    // Clear references to large buffers to help garbage collection
                    // Note: Variables are block-scoped but explicitly nulling helps GC
                    console.log(`🧹 Releasing TIFF memory buffers for image ${i + 1}...`);
                    
                    // Allow event loop to process and GC to potentially run
                    // This pause is critical for sequential TIFF processing
                    if (loopIndex < imagesToExport.length - 1) {
                      setBatchStatus(`Memory cleanup after TIFF ${i + 1}...`);
                      await new Promise(resolve => setTimeout(resolve, 500));
                    }
                  } catch (tiffError) {
                    console.error(`❌ TIFF encoding failed for image ${i + 1}:`, tiffError);
                    setBatchStatus(`⚠️ TIFF encoding failed for image ${i + 1}`);
                    // Continue with next image instead of crashing
                    continue;
                  }
                }
              } else {
                // Handle raster formats
                let dataURL: string;
                switch (exportFormat) {
                  case 'jpg':
                    dataURL = canvas.toDataURL('image/jpeg', exportQuality / 100);
                    break;
                  case 'webp':
                    dataURL = canvas.toDataURL('image/webp', exportQuality / 100);
                    break;
                  case 'avif':
                    dataURL = canvas.toDataURL('image/avif', exportQuality / 100);
                    break;
                  case 'bmp':
                    dataURL = canvas.toDataURL('image/bmp');
                    break;
                  case 'png':
                  default:
                    dataURL = canvas.toDataURL('image/png');
                    break;
                }
                
                // Validate the data URL — browsers silently return a tiny/blank result
                // when the canvas is too large for hardware acceleration.  A real image
                // at 300 DPI will produce millions of base64 chars; a blank/failed one
                // produces under ~200 chars (e.g. a 1×1 transparent PNG).
                const b64Preview = dataURL?.split(',')[1] ?? '';
                if (b64Preview.length < 500) {
                  console.error(`❌ Image ${i + 1}: canvas.toDataURL returned a blank/invalid result (${b64Preview.length} chars). Canvas may be too large for browser hardware acceleration.`);
                  console.error(`   Canvas size: ${canvas.width}×${canvas.height} px — consider reducing DPI or export scale.`);
                  setBatchStatus(`⚠️ Image ${i + 1} skipped: canvas rendered blank (too large for browser)`);
                  continue;
                }
                console.log(`📊 Image ${i + 1}: data URL length ${(b64Preview.length / 1024).toFixed(0)}KB base64`);
                
                if (packageAsZip && zip) {
                  // Extract base64 data from data URL for ZIP
                  const base64Data = dataURL.split(',')[1];
                  zip.file(filename, base64Data, { base64: true });
                  console.log(`📦 Added ${filename} to ZIP`);
                } else {
                  // Convert data URL to blob for individual download
                  const response = await fetch(dataURL);
                  const blob = await response.blob();
                  individualFiles.push({ blob, filename });
                  console.log(`📁 Prepared ${filename} for individual download`);
                }
              }

              // Save project file if enabled
              if (exportSaveProjectFiles) {
                const projectFilename = filename.replace(/\.(png|jpg|webp|avif|bmp|pdf|tiff)$/, '.generated.json');
                const normalizedArtboard = targetArtboard
                  ? { ...targetArtboard, printConfig: getEffectivePrintConfig(targetArtboard) }
                  : null;
                const projectData = {
                  version: '1.0.0',
                  type: 'generated' as const,
                  shapes: currentExportShapes,
                  groups: [], // Empty for batch exports
                  enabledShapeTypes: Array.from(enabledShapeTypes),
                  artboards: normalizedArtboard ? [normalizedArtboard] : [],
                  metadata: {
                    exportIndex: i + 1,
                    totalExports: exportBatchCount,
                    timestamp: new Date().toISOString(),
                    version: '1.0.0',
                    exportMode: exportMode,
                    generationBounds: generationBounds,
                    imageFilename: filename,
                    shapeCount: currentExportShapes.length,
                    description: `Batch export ${i + 1} of ${exportBatchCount} - Generated ${currentExportShapes.length} shapes`
                  },
                  exportSettings: {
                    format: exportFormat,
                    dpi: targetArtboard?.dpi || 300,
                    scale: effectiveExportScale,
                    quality: exportQuality,
                    bitDepth: exportSettings.tiffBitDepth ?? 8,
                    colorProfile: exportSettings.embedIccProfile !== false ? 'sRGB' : 'none',
                    backgroundMode: exportSettings.exportBackgroundMode || 'transparent',
                    flattenToRgb: exportSettings.flattenToRgb ?? false,
                    matteColor: exportSettings.matteColor || '#ffffff',
                    compression: exportSettings.tiffCompression ?? 'none',
                    artistName: exportSettings.artistName ?? '',
                    copyrightText: exportSettings.copyrightText ?? '',
                    imageTitle: exportSettings.imageTitle ?? '',
                    imageDescription: exportSettings.imageDescription ?? '',
                    printConfig: normalizedArtboard?.printConfig ? {
                      bleed: {
                        enabled: normalizedArtboard.printConfig.overlays.bleed.render,
                        amount: normalizedArtboard.printConfig.overlays.bleed.amount,
                        unit: normalizedArtboard.printConfig.overlays.overlayUnit
                      },
                      printMarks: {
                        enabled: normalizedArtboard.printConfig.overlays.printMarks.render,
                        cropMarks: normalizedArtboard.printConfig.overlays.printMarks.cropMarks,
                        registrationMarks: normalizedArtboard.printConfig.overlays.printMarks.registrationMarks
                      }
                    } : null
                  }
                };
                
                const projectJson = JSON.stringify(projectData, null, 2);
                
                if (packageAsZip && zip) {
                  zip.file(projectFilename, projectJson);
                  console.log(`💾 Added project file ${projectFilename} to ZIP`);
                } else {
                  const projectBlob = new Blob([projectJson], { type: 'application/json' });
                  individualFiles.push({ blob: projectBlob, filename: projectFilename });
                  console.log(`📁 Prepared project file ${projectFilename} for individual download`);
                }
              }
            } catch (canvasError) {
              throw new Error(`Canvas rendering failed for export ${i + 1}: ${canvasError instanceof Error ? canvasError.message : 'Unknown canvas error'}`);
            } finally {
              // Immediate canvas cleanup to prevent memory leaks
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              canvas.width = 0;
              canvas.height = 0;
              console.log(`🧹 Cleaned up canvas for image ${i + 1}`);
            }
          } else {
            console.error(`❌ No shapes generated for export ${i + 1}`);
            toast({
              title: `No shapes generated for export ${i + 1}`,
              description: exportSettings.generationSetsEnabled
                ? "No enabled Shape Sets produced any shapes. Check that at least one Shape Set is enabled and has valid shape types configured."
                : "Shape generation returned no shapes for this export. Check that your enabled shape types and generation config are set up correctly.",
              variant: "destructive",
              duration: 7000,
            });
          }

          // Progress already updated after image creation step
          
          // Check for abort after image creation
          if (exportAbortControllerRef.current?.signal.aborted) {
            console.log('🛑 Export aborted after image creation');
            stopElapsedTimeTracking();
            stopElapsedTimeTrackingGlobal();
            setExportStatusGlobal('Export cancelled');
            setExportIsErrorGlobal(true);
            setExportResultMessageGlobal('⚠️ Export was cancelled');
            return;
          }
        }
        
        // Save one generator file per batch if enabled
        if (exportSaveGeneratorFiles) {
          try {
            const activeBoard = artboards.find((a: { id: string }) => a.id === activeArtboard) as typeof artboards[0] | undefined;
            if (activeBoard) {
              const normalizedPrintConfig = getEffectivePrintConfig(activeBoard);
              const generatorData = {
                version: '1.0.0',
                type: 'generator' as const,
                timestamp: new Date().toISOString(),
                name: `batch-export-${timestamp}`,
                generationSets: effectiveGenerationSets,
                currentSetId: effectiveCurrentSetId,
                artboard: {
                  width: activeBoard.width,
                  height: activeBoard.height,
                  backgroundColor: (activeBoard as any).backgroundColor || '#ffffff',
                  dpi: (activeBoard as any).dpi ?? 72,
                  unitType: (activeBoard as any).unitType ?? 'pixels',
                  displayGrid: (activeBoard as any).displayGrid ?? false,
                  displayBorder: (activeBoard as any).displayBorder ?? true,
                  displayName: (activeBoard as any).displayName ?? true,
                  displayDimensions: (activeBoard as any).displayDimensions ?? false,
                  displayResolution: (activeBoard as any).displayResolution ?? false,
                  name: activeBoard.name,
                  printConfig: normalizedPrintConfig,
                }
              };
              const generatorJson = JSON.stringify(generatorData, null, 2);
              const generatorFilename = `batch-export-${timestamp}.generator.json`;
              if (packageAsZip && zip) {
                zip.file(generatorFilename, generatorJson);
                console.log(`🏭 Added generator file ${generatorFilename} to ZIP`);
              } else {
                const generatorBlob = new Blob([generatorJson], { type: 'application/json' });
                individualFiles.push({ blob: generatorBlob, filename: generatorFilename });
                console.log(`📁 Prepared generator file ${generatorFilename} for download`);
              }
            }
          } catch (generatorFileError) {
            console.error('Failed to create generator file:', generatorFileError);
          }
        }

        // FINAL STEP: Package and Download
        if (packageAsZip && zip) {
          // Guard: if all images were skipped (blank canvas / too-large) the ZIP
          // would be empty.  Fail early with a clear message instead of downloading
          // a useless empty archive.
          const zipFileCount = Object.keys(zip.files).length;
          if (zipFileCount === 0) {
            stopElapsedTimeTracking();
            stopElapsedTimeTrackingGlobal();
            setExportStatusGlobal('Export failed: no images were produced');
            setExportIsErrorGlobal(true);
            setExportResultMessageGlobal('❌ All images were skipped — the canvas may be too large for the browser to export at this DPI/scale. Try reducing the export scale or DPI.');
            return;
          }

          // ZIP Creation and Download
          updateProgress(currentStep, 'Creating ZIP file...');
          console.log(`📊 PROGRESS UPDATE: Step ${currentStep}/${totalSteps} - Creating ZIP file`);
          
          // Force UI update before incrementing step
          await new Promise(resolve => {
            setTimeout(() => {
              console.log(`⏳ ZIP creation delay completed - Progress: ${currentStep}/${totalSteps}`);
              resolve(undefined);
            }, 300); // Reduced delay for better responsiveness
          });
          
          currentStep++;
          
          const projectFilesText = [
            exportSaveProjectFiles ? `${exportBatchCount} generated files` : '',
            exportSaveGeneratorFiles ? '1 generator file' : '',
          ].filter(Boolean).join(' and ');
          const projectFilesLabel = projectFilesText ? ` and ${projectFilesText}` : '';
          console.log(`📦 Creating ZIP file with ${zipFileCount} image(s)${projectFilesLabel} (${exportBatchCount - zipFileCount > 0 ? `${exportBatchCount - zipFileCount} skipped` : 'all succeeded'})`);
          
          let zipBlob;
          try {
            setBatchStatus('Generating ZIP file...');
            
            // Use compression level 1 for better mobile compatibility (faster, less memory-intensive)
            zipBlob = await zip.generateAsync({ 
              type: 'blob',
              compression: 'DEFLATE',
              compressionOptions: { level: 1 }
            });
            
            console.log(`✅ ZIP blob generated successfully, size: ${zipBlob.size} bytes`);
            
            // Check if blob is too large for mobile browsers (warn if > 100MB)
            if (zipBlob.size > 100 * 1024 * 1024) {
              console.warn(`⚠️ Large ZIP file (${Math.round(zipBlob.size / 1024 / 1024)}MB) - may cause issues on mobile`);
            }
          } catch (zipError) {
            throw new Error(`Failed to generate ZIP file: ${zipError instanceof Error ? zipError.message : 'Unknown ZIP error'}`);
          }
        
          updateProgress(currentStep, 'Downloading ZIP file...');
          console.log(`📊 PROGRESS UPDATE: Step ${currentStep}/${totalSteps} - Downloading ZIP file`);
          
          // Force UI update before download
          await new Promise(resolve => {
            setTimeout(() => {
              console.log(`⏳ Download preparation delay completed - Progress: ${currentStep}/${totalSteps}`);
              resolve(undefined);
            }, 300); // Reduced delay for better responsiveness
          });
          
          currentStep++;
          
          try {
            setBatchStatus('Triggering download...');
            console.log(`📥 Creating download link for ZIP file (${zipBlob.size} bytes)`);
            
            const link = document.createElement('a');
            const blobUrl = URL.createObjectURL(zipBlob);
            
            // Enhanced mobile compatibility settings
            link.href = blobUrl;
            link.download = `batch-export-${timestamp}.zip`;
            link.style.display = 'none';
            link.target = '_blank'; // Helps with some mobile browsers
            
            // Add to DOM temporarily for better mobile compatibility
            document.body.appendChild(link);
          
          // Use multiple methods for better mobile compatibility
          try {
            link.click();
            console.log(`📱 Primary download method triggered`);
          } catch (clickError) {
            console.warn(`⚠️ Primary download failed, trying fallback:`, clickError);
            // Fallback: try to trigger download event manually
            const event = new MouseEvent('click', {
              view: window,
              bubbles: true,
              cancelable: true
            });
            link.dispatchEvent(event);
          }
          
          // Clean up DOM
          setTimeout(() => {
            if (document.body.contains(link)) {
              document.body.removeChild(link);
            }
          }, 1000);
          
          // Clean up blob URL immediately after download starts
          setTimeout(() => {
            URL.revokeObjectURL(blobUrl);
            console.log(`🧹 Cleaned up blob URL`);
          }, 2000); // Reduced from 10 seconds to 2 seconds for better performance
          
            setBatchStatus('Download initiated!');
            console.log(`🎉 ZIP COMPLETE: Download initiated for batch-export-${timestamp}.zip with ${exportBatchCount} images${projectFilesText}`);
          } catch (downloadError) {
            throw new Error(`Failed to trigger download: ${downloadError instanceof Error ? downloadError.message : 'Unknown download error'}`);
          }
        } else {
          // Individual File Downloads
          setBatchStatus('Downloading individual files...');
          console.log(`📁 INDIVIDUAL FILES: Starting ${individualFiles.length} individual downloads`);
          
          // Detect mobile device once for the entire download session
          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
          const delayMs = isMobile ? 3000 : 800; // 3 seconds for mobile, 800ms for desktop
          console.log(`📱 Device detected: ${isMobile ? 'mobile' : 'desktop'} - using ${delayMs}ms delays between downloads`);
          
          for (let fileIndex = 0; fileIndex < individualFiles.length; fileIndex++) {
            const { blob, filename } = individualFiles[fileIndex];
            
            // Add delay BEFORE each download (including the first one) to let browser settle
            if (fileIndex > 0 || isMobile) {
              setBatchStatus(`Preparing download ${fileIndex + 1}/${individualFiles.length} - waiting for browser...`);
              console.log(`⏳ Pre-download delay (${delayMs}ms) before ${filename}`);
              await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            
            updateProgress(currentStep, `Downloading ${filename} (${fileIndex + 1}/${individualFiles.length})...`);
            console.log(`📊 PROGRESS UPDATE: Step ${currentStep}/${totalSteps} - Downloading ${filename}`);
            currentStep++;
            
            try {
              const link = document.createElement('a');
              const blobUrl = URL.createObjectURL(blob);
              
              link.href = blobUrl;
              link.download = filename;
              link.style.display = 'none';
              link.target = '_blank';
              
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              
              // Clean up blob URL after a delay
              setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
              }, 5000);
              
              console.log(`✅ Downloaded ${filename}`);
              
            } catch (downloadError) {
              console.error(`❌ Failed to download ${filename}:`, downloadError);
              // Continue with other files even if one fails
            }
            
            // ALWAYS add delay after each download, regardless of success/failure
            if (fileIndex < individualFiles.length - 1) { // Don't delay after the last file
              console.log(`⏳ Post-download delay (${delayMs}ms) after ${filename}`);
              await new Promise(resolve => setTimeout(resolve, delayMs));
            }
          }
          
          setBatchStatus('All downloads completed!');
          console.log(`🎉 INDIVIDUAL FILES COMPLETE: Downloaded ${individualFiles.length} files`);
        }
        
        // Mark progress as complete
        stopElapsedTimeTracking();
        stopElapsedTimeTrackingGlobal();
        
        const elapsedStr = formatElapsedTime(exportElapsedTime);
        const projectFilesTextParts = [
          exportSaveProjectFiles ? `${exportBatchCount} generated files` : '',
          exportSaveGeneratorFiles ? '1 generator file' : '',
        ].filter(Boolean).join(' and ');
        const projectFilesText = projectFilesTextParts ? ` and ${projectFilesTextParts}` : '';
        const successMessage = packageAsZip 
          ? `✅ Success! Downloaded batch-export-${timestamp}.zip with ${exportBatchCount} images${projectFilesText} (${elapsedStr})`
          : `✅ Success! Downloaded ${individualFiles.length} individual files (${elapsedStr})`;
        
        // Update both local and global progress
        setBatchProgress(totalSteps);
        setBatchStatus('Export completed successfully!');
        setExportProgressGlobal(totalSteps);
        setExportStatusGlobal('Export completed successfully!');
        setExportIsCompleteGlobal(true);
        setExportResultMessageGlobal(successMessage);
        
        // Show persistent success message with elapsed time
        setBatchResultMessage(successMessage);
        setShowBatchResult(true);
        
        console.log(`✅ Export complete - Progress: ${totalSteps}/${totalSteps} (100%) - Manual dismiss required`);
        
      } catch (error) {
        console.error('❌ Batch export error:', error);
        stopElapsedTimeTracking();
        stopElapsedTimeTrackingGlobal();
        
        // Create a more detailed error message for mobile users who can't check console
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        const detailedError = `Export failed: ${errorMessage}`;
        
        setBatchStatus(detailedError);
        console.error('❌ DETAILED ERROR:', {
          error: errorMessage,
          timestamp: new Date().toISOString(),
          exportBatchCount,
          exportFormat,
          enabledShapeTypes: Array.from(enabledShapeTypes)
        });
        
        // Mark progress as failed but visible (both local and global)
        setBatchStatus(`Export failed: ${errorMessage}`);
        setExportStatusGlobal(`Export failed: ${errorMessage}`);
        setExportIsErrorGlobal(true);
        setExportResultMessageGlobal(`❌ Export failed: ${errorMessage}`);
        
        // Show persistent error message
        setBatchResultMessage(`❌ Export failed: ${errorMessage}`);
        setShowBatchResult(true);
        
        console.log(`❌ Export failed - Progress: ${batchProgress}/${totalSteps} - Manual dismiss required`);
        
      } finally {
        // Only clear canvas after batch generation exports; preserve live shapes for single export
        if (!preformedShapes) onClearAll?.();
        // Stop both local and global timers (idempotent - safe to call multiple times)
        stopElapsedTimeTracking();
        stopElapsedTimeTrackingGlobal();
        exportAbortControllerRef.current = null;
        // Keep the progress dialog visible until manually dismissed by user
        // setIsBatchExporting(false); // Removed to prevent auto-dismiss
        // setBatchProgress(0); // Keep progress visible
        // setBatchStatus(''); // Keep final status visible
        console.log(`🔄 Export process completed - progress dialog remains visible for manual dismiss`);
      }
    };

    const handleSaveProject = () => {
      const projectData = {
        shapes: shapes,
        groups: selectedGroups,
        artboards: artboards,
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      };

      const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `shape-editor-project-${Date.now()}.json`;
      link.click();

      URL.revokeObjectURL(url);
    };

    return (
      <div className="space-y-3">
        <Tabs value={exportSaveTab} onValueChange={(v) => setExportSaveTab(v as 'single' | 'batch')} className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-slate-800 h-8">
            <TabsTrigger value="single" className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400">Settings</TabsTrigger>
            <TabsTrigger value="batch" className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400">Batch</TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="mt-2 space-y-4">
          <div className="space-y-3">
            <Label className="text-xs text-slate-400">Export Mode</Label>
            <Select value={exportMode} onValueChange={(value: any) => setExportMode(value)}>
              <SelectTrigger className="h-8 text-xs bg-slate-800 border-slate-600">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
                <SelectItem value="selection" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">Selected Shapes</SelectItem>
                <SelectItem value="artboard" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">Artboard Content</SelectItem>
                <SelectItem value="artboard-extended" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">Artboard + Print Marks</SelectItem>
                <SelectItem value="all" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">All Shapes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(exportMode === 'artboard' || exportMode === 'artboard-extended') && (
            <div className="space-y-3">
              <Label className="text-xs text-slate-400">Select Artboard</Label>
              <Select value={selectedArtboardForExport} onValueChange={setSelectedArtboardForExport}>
                <SelectTrigger className="h-8 text-xs bg-slate-800 border-slate-600 text-left">
                  <SelectValue placeholder="Choose artboard..." />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
                  {artboards.map((artboard) => (
                    <SelectItem key={artboard.id} value={artboard.id} className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">
                      {artboard.name} ({artboard.width}×{artboard.height})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Format & Format Options Section */}
          <div className="space-y-3">
            <Label className="text-xs text-slate-400">Export Format</Label>
            <Select value={exportFormat} onValueChange={(value: any) => setExportFormat(value)}>
              <SelectTrigger className="h-8 text-xs bg-slate-800 border-slate-600">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
                <SelectItem value="png" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">PNG</SelectItem>
                <SelectItem value="jpg" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">JPG</SelectItem>
                <SelectItem value="webp" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">WebP</SelectItem>
                <SelectItem value="avif" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">AVIF</SelectItem>
                <SelectItem value="bmp" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">BMP</SelectItem>
                <SelectItem value="tiff" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">TIFF (Print)</SelectItem>
                <SelectItem value="pdf" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">PDF (Print)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Format-Specific Options - shown inline after format selection */}
          {exportFormat === 'tiff' && (
            <div className="p-2 bg-slate-800/50 rounded border border-slate-700 space-y-4">
              <Label className="text-xs text-slate-300 font-medium">TIFF Options</Label>
              
              {/* Bit Depth */}
              <div className="flex items-center justify-between">
                <Label className="text-xs text-slate-400">Bit Depth</Label>
                <Select 
                  value={String(exportSettings.tiffBitDepth ?? 8)} 
                  onValueChange={(value) => updateExportSettings.mutate({ tiffBitDepth: Number(value) as 8 | 16 })}
                >
                  <SelectTrigger className="h-7 text-xs bg-slate-800 border-slate-600 w-[140px]" data-testid="select-tiff-bit-depth">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
                    <SelectItem value="8" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">8-bit (Standard)</SelectItem>
                    <SelectItem value="16" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">16-bit (Print)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Compression */}
              <div className="flex items-center justify-between">
                <Label className="text-xs text-slate-400">Compression</Label>
                <Select 
                  value={exportSettings.tiffCompression ?? 'deflate'} 
                  onValueChange={(value: 'none' | 'deflate') => updateExportSettings.mutate({ tiffCompression: value })}
                  disabled={(exportSettings.tiffBitDepth ?? 8) === 16}
                >
                  <SelectTrigger className="h-7 text-xs bg-slate-800 border-slate-600 w-[140px]" data-testid="select-tiff-compression">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
                    <SelectItem value="deflate" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">Deflate</SelectItem>
                    <SelectItem value="none" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(exportSettings.tiffBitDepth ?? 8) === 16 && (
                <p className="text-xs text-slate-500">16-bit mode requires uncompressed output</p>
              )}
              
              {/* Flatten to RGB */}
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <Label className="text-xs text-slate-400">Flatten to RGB</Label>
                  <p className="text-xs text-slate-500">Drop alpha for smaller files</p>
                </div>
                <Switch
                  checked={exportSettings.flattenToRgb ?? false}
                  onCheckedChange={(checked) => updateExportSettings.mutate({ flattenToRgb: checked })}
                  data-testid="toggle-flatten-rgb"
                />
              </div>
              
              {/* Matte Color (shown when flatten enabled or background is transparent) */}
              {(exportSettings.flattenToRgb || exportSettings.exportBackgroundMode === 'transparent') && (
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-400">Matte Color</Label>
                  <input
                    type="color"
                    value={exportSettings.matteColor || '#ffffff'}
                    onChange={(e) => updateExportSettings.mutate({ matteColor: e.target.value })}
                    className="w-8 h-7 rounded border border-slate-600 cursor-pointer"
                    data-testid="input-matte-color"
                  />
                </div>
              )}

              {/* Embed ICC Profile */}
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <Label className="text-xs text-slate-400">Embed sRGB Profile</Label>
                  <p className="text-xs text-slate-500">Recommended for print-on-demand</p>
                </div>
                <Switch
                  checked={exportSettings.embedIccProfile ?? true}
                  onCheckedChange={(checked) => updateExportSettings.mutate({ embedIccProfile: checked })}
                  data-testid="toggle-embed-icc"
                />
              </div>
            </div>
          )}

          {exportFormat === 'pdf' && (
            <div className="p-2 bg-slate-800/50 rounded border border-slate-700 space-y-2">
              <Label className="text-xs text-slate-300 font-medium">PDF Options</Label>
              <p className="text-xs text-slate-500">
                Generates print-ready PDF with embedded image and metadata at the artboard's DPI setting.
              </p>
            </div>
          )}

          {/* Export Background Setting */}
          <div className="space-y-3">
            <Label className="text-xs text-slate-400">Export Background</Label>
            <Select 
              value={exportSettings.exportBackgroundMode || 'transparent'} 
              onValueChange={(value: 'transparent' | 'artboard') => 
                updateExportSettings.mutate({ exportBackgroundMode: value })
              }
            >
              <SelectTrigger className="h-8 text-xs bg-slate-800 border-slate-600" data-testid="select-export-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
                <SelectItem value="transparent" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">Transparent</SelectItem>
                <SelectItem value="artboard" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">Artboard Color</SelectItem>
              </SelectContent>
            </Select>
            {exportSettings.exportBackgroundMode === 'artboard' && (
              <p className="text-xs text-slate-500">Background color is configured in the Artboard section</p>
            )}
          </div>

          {/* Render Mode Setting */}
          <div className="space-y-3">
            <Label className="text-xs text-slate-400">Render Mode</Label>
            <Select 
              value={exportSettings.renderMode || 'auto'} 
              onValueChange={(value: 'auto' | 'client' | 'server') => 
                updateExportSettings.mutate({ renderMode: value })
              }
            >
              <SelectTrigger className="h-8 text-xs bg-slate-800 border-slate-600" data-testid="select-render-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
                <SelectItem value="auto" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">Auto (Recommended)</SelectItem>
                <SelectItem value="client" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">Browser</SelectItem>
                <SelectItem value="server" className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">Server</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">
              {exportSettings.renderMode === 'auto' 
                ? 'Automatically chooses best renderer based on export size and format' 
                : exportSettings.renderMode === 'server'
                ? 'Uses server-side rendering for large/high-quality exports'
                : 'Uses browser for quick exports (may have size limits)'}
            </p>
          </div>

          {/* Print Format Warnings - applies to TIFF and PDF */}
          {['tiff', 'pdf'].includes(exportFormat) && (() => {
            const preflightInfo = getTiffPreflightInfo();
            const warnings: string[] = [];
            if (preflightInfo.hasLowDpi) {
              warnings.push(`DPI (${preflightInfo.artboardDpi}) is below 300 - not ideal for professional printing`);
            }
            if (preflightInfo.hasNoBleed) {
              warnings.push('Bleed is not enabled - may cause issues at print edges');
            }
            if (preflightInfo.hasTransparentBackground) {
              warnings.push('Background is transparent - some print services require solid background');
            }
            
            if (warnings.length === 0) return null;
            
            return (
              <div className="p-2 bg-amber-900/20 border border-amber-500/30 rounded space-y-2">
                <div className="flex items-center gap-1 text-amber-300 text-xs font-medium">
                  <AlertTriangle className="w-3 h-3" />
                  Print Considerations
                </div>
                <ul className="text-xs text-amber-200/80 space-y-0.5 list-disc list-inside pl-1">
                  {warnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {/* Lossy Format Quality Options */}
          {['jpg', 'webp', 'avif'].includes(exportFormat) && (
            <div className="p-2 bg-slate-800/50 rounded border border-slate-700 space-y-3">
              <Label className="text-xs text-slate-300 font-medium">
                {exportFormat.toUpperCase()} Options
              </Label>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-400">Quality</Label>
                  <span className="text-xs text-slate-300">{exportQuality}%</span>
                </div>
                <BufferedSliderWithLabel
                  value={exportQuality}
                  onValueCommit={(value) => setExportQuality(value)}
                  min={10}
                  max={100}
                  step={1}
                  className="w-full"
                  formatLabel={(v) => `${v}%`}
                />
                <p className="text-xs text-slate-500">
                  {exportQuality >= 90 ? 'High quality, larger file size' : 
                   exportQuality >= 70 ? 'Balanced quality and file size' :
                   'Smaller files, some quality loss'}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <BufferedSliderWithNumericInput
              label="Export Scale"
              value={exportScale}
              onValueCommit={(value) => setExportScale(value)}
              min={0.1}
              max={20}
              step={0.1}
              layout="stacked"
              inputUnbounded={true}
              inputClassName="h-9 bg-slate-700 border-slate-600 text-slate-300"
              sliderClassName="w-full"
            />
          </div>

          {/* Auto-scale-from-DPI removed (2026-05) — artboard pixel dimensions are the single
              source of truth for export output size. Use the Scale slider above to override. */}

          <Button
            onClick={handleExportShapes}
            disabled={
              isExporting ||
              isBatchExporting ||
              (exportMode === 'selection' && selectedShapes.length === 0) ||
              ((exportMode === 'artboard' || exportMode === 'artboard-extended') && (!selectedArtboardForExport || artboards.length === 0)) ||
              (exportMode === 'all' && shapes.length === 0)
            }
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white"
          >
            {isExporting ? (
              <>
                <div className="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Exporting...
              </>
            ) : (
              <>
                <FileImage className="w-4 h-4 mr-2" />
                {exportMode === 'selection' && `Export Selected (${selectedShapes.length})`}
                {(exportMode === 'artboard' || exportMode === 'artboard-extended') && selectedArtboardForExport && 
                  `Export ${artboards.find(ab => ab.id === selectedArtboardForExport)?.name || 'Artboard'}${exportMode === 'artboard-extended' ? ' + Marks' : ''}`}
                {(exportMode === 'artboard' || exportMode === 'artboard-extended') && !selectedArtboardForExport && 'Select Artboard to Export'}
                {exportMode === 'all' && `Export All Shapes (${shapes.length})`}
              </>
            )}
          </Button>
          </TabsContent>

          <TabsContent value="batch" className="mt-2 space-y-4">
          <div className="space-y-4">
          <div className="flex items-center justify-between p-2 bg-slate-800/40 rounded border border-slate-700">
            <Label className="text-xs text-slate-300 font-medium">Batch Export</Label>
            <div className="flex items-center space-x-2">
              <Label htmlFor="batch-mode" className="text-xs text-slate-400">Enable</Label>
              <Switch
                id="batch-mode"
                checked={exportSettings.exportBatchModeEnabled ?? false}
                onCheckedChange={(checked) => {
                  updateExportSettings.mutate({ exportBatchModeEnabled: Boolean(checked) });
                }}
              />
            </div>
          </div>

          {exportSettings.exportBatchModeEnabled && (
            <>
              <div className={`space-y-3 ${exportSettings.generationSetsEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="flex items-center space-x-2">
                  <Label className="text-xs text-slate-400">
                    Generations per Export
                  </Label>
                  <Select 
                    value={generationConfigSettings?.generationCountMode || 'range'} 
                    onValueChange={(value) => {
                      console.log('Updating generationCountMode to:', value, 'Current enabledShapeTypes size:', enabledShapeTypes.size);
                      onUpdateGenerationConfigSettings({ generationCountMode: value as 'range' | 'fixed' | 'incremental' });
                    }}
                    disabled={exportSettings.generationSetsEnabled}
                  >
                    <SelectTrigger className="h-6 w-20 text-xs bg-slate-700 border-slate-600 text-slate-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
                      <SelectItem value="fixed" className="text-slate-200 hover:bg-slate-700">Constant</SelectItem>
                      <SelectItem value="range" className="text-slate-200 hover:bg-slate-700">Range</SelectItem>
                      <SelectItem value="incremental" className="text-slate-200 hover:bg-slate-700">Incremental</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {generationConfigSettings?.generationCountMode === 'range' && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Min: {exportShapeCountRange[0]}</span>
                      <span className="text-slate-400">Max: {exportShapeCountRange[1]}</span>
                    </div>
                    <BufferedRangeSlider
                      value={exportShapeCountRange}
                      onValueCommit={(value) => setExportShapeCountRange(value)}
                      min={1}
                      max={20}
                      step={1}
                      className="w-full"
                    />
                  </div>
                )}
                
                {generationConfigSettings?.generationCountMode === 'fixed' && (
                  <div className="space-y-3">
                    <Label className="text-xs text-slate-300">Fixed Value: {generationConfigSettings?.generationCountDefine || 5}</Label>
                    <BufferedSlider
                      value={[generationConfigSettings?.generationCountDefine || 5]}
                      onValueCommit={([value]) => onUpdateGenerationConfigSettings({ generationCountDefine: value })}
                      min={1}
                      max={20}
                      step={1}
                      className="[&_[role=slider]]:bg-blue-600"
                    />
                  </div>
                )}
                
                {generationConfigSettings?.generationCountMode === 'incremental' && (
                  <div className="space-y-3">
                    <Label className="text-xs text-slate-300">Start Value: {generationConfigSettings?.generationCountStartValue || 1}</Label>
                    <BufferedSlider
                      value={[generationConfigSettings?.generationCountStartValue || 1]}
                      onValueCommit={([value]) => onUpdateGenerationConfigSettings({ generationCountStartValue: value })}
                      min={1}
                      max={15}
                      step={1}
                      className="[&_[role=slider]]:bg-blue-600"
                    />
                    <Label className="text-xs text-slate-300">Increment: {generationConfigSettings?.generationCountIncrement || 1}</Label>
                    <BufferedSlider
                      value={[generationConfigSettings?.generationCountIncrement || 1]}
                      onValueCommit={([value]) => onUpdateGenerationConfigSettings({ generationCountIncrement: value })}
                      min={1}
                      max={5}
                      step={1}
                      className="[&_[role=slider]]:bg-blue-600"
                    />
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={generationConfigSettings?.generationCountResetPerBatch || false}
                        onCheckedChange={(checked) => onUpdateGenerationConfigSettings({ generationCountResetPerBatch: checked as boolean })}
                        className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-blue-900"
                      />
                      <Label className="text-xs text-slate-300">Reset per batch</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={generationConfigSettings?.generationCountModulationEnabled || false}
                        onCheckedChange={(checked) => onUpdateGenerationConfigSettings({ generationCountModulationEnabled: checked as boolean })}
                        className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-blue-900"
                      />
                      <Label className="text-xs text-slate-300">Enable Modulation</Label>
                    </div>
                    {generationConfigSettings?.generationCountModulationEnabled && (
                      <>
                        <Label className="text-xs text-slate-300">Modulation Value: {generationConfigSettings?.generationCountModulationValue || 0.5}</Label>
                        <BufferedSlider
                          value={[generationConfigSettings?.generationCountModulationValue || 0.5]}
                          onValueCommit={([value]) => onUpdateGenerationConfigSettings({ generationCountModulationValue: value })}
                          min={1}
                          max={10}
                          step={1}
                          className="[&_[role=slider]]:bg-blue-600"
                        />
                      </>
                    )}
                    <p className="text-xs text-slate-400">Stepped generation count (start + export × increment, with optional modulation)</p>
                  </div>
                )}
              </div>

              <Separator className="bg-slate-700" />

              {/* Shape Sets Toggle */}
              <div className="space-y-3">
                <div className="flex items-center justify-between p-2 bg-slate-800/30 rounded border border-slate-600">
                  <div className="flex items-center space-x-2">
                    <Boxes className="w-3 h-3 text-slate-400" />
                    <Label className="text-xs text-slate-300">Shape Sets</Label>
                  </div>
                  <Switch
                    checked={exportSettings.generationSetsEnabled ?? false}
                    onCheckedChange={(checked) => {
                      updateExportSettings.mutate({ generationSetsEnabled: checked as boolean });
                    }}
                    disabled={!exportSettings.exportBatchModeEnabled}
                    data-testid="toggle-generation-sets"
                  />
                </div>

                {/* Prerequisites messaging */}
                {!exportSettings.exportBatchModeEnabled && (
                  <div className="text-xs text-slate-500 bg-yellow-900/20 p-2 rounded border border-yellow-500/30">
                    <div className="flex items-center space-x-1 mb-1">
                      <div className="w-1 h-1 bg-yellow-400 rounded-full"></div>
                      <span className="text-yellow-300 font-medium">Prerequisites Required</span>
                    </div>
                    <div className="space-y-2">
                      <div>• Enable batch export mode above</div>
                    </div>
                  </div>
                )}

                {/* Shape Sets enabled messaging */}
                {exportSettings.generationSetsEnabled && exportSettings.exportBatchModeEnabled && (
                  <div className="text-xs text-slate-500 bg-blue-900/20 p-2 rounded border border-blue-500/30">
                    <div className="flex items-center space-x-1 mb-1">
                      <div className="w-1 h-1 bg-blue-400 rounded-full"></div>
                      <span className="text-blue-300 font-medium">Shape Sets Active</span>
                    </div>
                    All enabled shape sets combine to create each export. Manage sets in the Shape Sets Manager.
                  </div>
                )}
              </div>

              <BufferedSliderWithNumericInput
                label="Number of Exports"
                value={exportBatchCount}
                onValueCommit={(value) => setExportBatchCount(value)}
                min={1}
                max={100}
                step={1}
                layout="stacked"
                inputUnbounded={true}
                inputClassName="h-9 bg-slate-700 border-slate-600 text-slate-300"
                sliderClassName="w-full"
              />

              {batchCostEstimate && (
                <div className="p-3 bg-slate-800/50 rounded border border-slate-600/60 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                    <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                    Batch Cost Estimate
                    <span className="ml-auto text-slate-500 font-normal uppercase tracking-wide" style={{ fontSize: '10px' }}>
                      {batchCostEstimate.fmt.toUpperCase()} · {batchCostEstimate.scaledWidth}×{batchCostEstimate.scaledHeight}px
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1" style={{ fontSize: '11px' }}>
                    <span className="text-slate-400">Size per image:</span>
                    <span className="text-slate-200">~{formatSizeMb(batchCostEstimate.perImageMb)}</span>

                    <span className="text-slate-400">Total ({batchCostEstimate.imageCount} images):</span>
                    <span className="text-slate-200">~{formatSizeMb(batchCostEstimate.totalMb)}</span>

                    <span className="text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />Est. time:
                    </span>
                    <span className="text-slate-200">{formatDurationSec(batchCostEstimate.timeSec)}</span>

                    <span className="text-slate-400">Memory load:</span>
                    <span className={`font-medium ${
                      batchCostEstimate.tier === 'low' ? 'text-green-400' :
                      batchCostEstimate.tier === 'medium' ? 'text-yellow-400' :
                      batchCostEstimate.tier === 'high' ? 'text-orange-400' :
                      'text-red-400'
                    }`}>
                      {getMemoryTierLabel(batchCostEstimate.tier)}
                    </span>
                  </div>
                </div>
              )}

              {(() => {
                const imageCount = exportAllImages ? exportBatchCount : selectedImageIndices.length;
                const isDisabled = imageCount === 0;
                return (
                  <div className="space-y-2">
                    {/* Generated file toggle — one per image */}
                    <div className={`flex items-center justify-between p-2 rounded border ${isDisabled ? 'bg-slate-900/50 border-slate-700 opacity-50' : 'bg-slate-800/30 border-slate-600'}`}>
                      <div className="flex items-center space-x-2">
                        <Save className={`w-3 h-3 ${isDisabled ? 'text-slate-500' : 'text-slate-400'}`} />
                        <div className="flex flex-col">
                          <Label className={`text-xs ${isDisabled ? 'text-slate-500' : 'text-slate-300'}`}>
                            Export Generated Files
                          </Label>
                          <span className="text-xs text-slate-500">.generated.json — one per image, contains shapes</span>
                        </div>
                      </div>
                      <Switch
                        checked={exportSaveProjectFiles}
                        onCheckedChange={setExportSaveProjectFiles}
                        disabled={isDisabled}
                      />
                    </div>
                    {/* Generator file toggle — one per batch */}
                    <div className={`flex items-center justify-between p-2 rounded border ${isDisabled ? 'bg-slate-900/50 border-slate-700 opacity-50' : 'bg-slate-800/30 border-slate-600'}`}>
                      <div className="flex items-center space-x-2">
                        <Save className={`w-3 h-3 ${isDisabled ? 'text-slate-500' : 'text-slate-400'}`} />
                        <div className="flex flex-col">
                          <Label className={`text-xs ${isDisabled ? 'text-slate-500' : 'text-slate-300'}`}>
                            Export Generator File
                          </Label>
                          <span className="text-xs text-slate-500">.generator.json — one per batch, contains shape sets</span>
                        </div>
                      </div>
                      <Switch
                        checked={exportSaveGeneratorFiles}
                        onCheckedChange={setExportSaveGeneratorFiles}
                        disabled={isDisabled}
                      />
                    </div>
                  </div>
                );
              })()}

              {(exportSaveProjectFiles || exportSaveGeneratorFiles) && (
                <div className="text-xs text-slate-500 bg-blue-900/20 p-2 rounded border border-blue-500/30 space-y-1">
                  <div className="flex items-center space-x-1">
                    <div className="w-1 h-1 bg-blue-400 rounded-full"></div>
                    <span className="text-blue-300 font-medium">Project Files Enabled</span>
                  </div>
                  {exportSaveProjectFiles && <p>Each image will include a <strong>.generated.json</strong> with its specific shapes — reload it later to continue editing that exact output.</p>}
                  {exportSaveGeneratorFiles && <p>One <strong>.generator.json</strong> will be saved for the whole batch — reload it to reconstruct the shape set configuration that produced these images.</p>}
                </div>
              )}

              <div className="flex items-center justify-between p-2 bg-slate-800/30 rounded border border-slate-600">
                <div className="flex items-center space-x-2">
                  <ImageIcon className="w-3 h-3 text-slate-400" />
                  <Label className="text-xs text-slate-300">Export All Images</Label>
                </div>
                <Switch
                  checked={exportAllImages}
                  onCheckedChange={setExportAllImages}
                  data-testid="toggle-export-all-images"
                />
              </div>

              {(() => {
                // Package as ZIP is enabled when there are multiple files to export (images + optional project files)
                const imageCount = exportAllImages ? exportBatchCount : selectedImageIndices.length;
                const generatedFileCount = exportSaveProjectFiles ? imageCount : 0;
                const generatorFileCount = exportSaveGeneratorFiles ? 1 : 0;
                const totalItems = imageCount + generatedFileCount + generatorFileCount;
                const isDisabled = totalItems <= 1;
                const willUseServer = exportSettings.renderMode === 'server' || getTiffPreflightInfo().requiresServerExport;
                
                return (
                  <div className={`flex items-center justify-between p-2 rounded border ${
                    isDisabled 
                      ? 'bg-slate-900/50 border-slate-700 opacity-50' 
                      : 'bg-slate-800/30 border-slate-600'
                  }`}>
                    <div className="flex items-center space-x-2">
                      <Package className={`w-3 h-3 ${isDisabled ? 'text-slate-500' : 'text-slate-400'}`} />
                      <div className="flex flex-col">
                        <Label className={`text-xs ${isDisabled ? 'text-slate-500' : 'text-slate-300'}`}>
                          Package as ZIP
                        </Label>
                        {isDisabled && (
                          <span className="text-xs text-slate-600">
                            Only 1 item - no ZIP needed
                          </span>
                        )}
                        {!isDisabled && willUseServer && (
                          <span className="text-xs text-slate-500">
                            Applies to server export
                          </span>
                        )}
                      </div>
                    </div>
                    <Switch
                      checked={packageAsZip}
                      onCheckedChange={setPackageAsZip}
                      disabled={isDisabled}
                      data-testid="toggle-package-as-zip"
                    />
                  </div>
                );
              })()}

              {!exportAllImages && (
                <div className="space-y-3 p-3 bg-orange-900/20 rounded border border-orange-500/30" data-testid="accordion-selective-export">
                  <div className="flex items-center space-x-1 mb-2">
                    <div className="w-1 h-1 bg-orange-400 rounded-full"></div>
                    <span className="text-orange-300 font-medium text-xs">Selective Export</span>
                  </div>
                  <Label className="text-xs text-slate-400">Select images to export (1-{exportBatchCount}):</Label>
                  <div className="grid grid-cols-5 gap-1 max-h-24 overflow-y-auto">
                    {Array.from({ length: exportBatchCount }, (_, i) => i + 1).map((imageIndex) => (
                      <div key={imageIndex} className="flex items-center space-x-1">
                        <Checkbox
                          checked={selectedImageIndices.includes(imageIndex)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedImageIndices([...selectedImageIndices, imageIndex]);
                            } else {
                              setSelectedImageIndices(selectedImageIndices.filter(idx => idx !== imageIndex));
                            }
                          }}
                          className="border-slate-500 data-[state=checked]:bg-orange-600"
                          data-testid={`checkbox-image-${imageIndex}`}
                        />
                        <Label className="text-xs text-slate-300">{imageIndex}</Label>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-slate-500">
                    Selected: {selectedImageIndices.length} of {exportBatchCount} images
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <Label className="text-xs text-slate-400">Export Info</Label>
                <div className="text-xs text-slate-500 bg-slate-800 p-2 rounded border border-slate-600">
                  {packageAsZip
                    ? `Images${exportSaveProjectFiles ? ' + generated files' : ''}${exportSaveGeneratorFiles ? ' + generator file' : ''} will be packaged into a ZIP file`
                    : `Image files will be downloaded individually${exportSaveProjectFiles ? ', each with a .generated.json' : ''}${exportSaveGeneratorFiles ? '; one .generator.json for the batch' : ''}`
                  }
                  
                  {(() => {
                    // Mobile device detection for helpful UX message
                    const isMobile = typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                    const imageCount = exportAllImages ? exportBatchCount : selectedImageIndices.length;
                    const showMobileWarning = isMobile && !packageAsZip && imageCount > 1;
                    
                    return showMobileWarning ? (
                      <div className="mt-2 p-2 bg-blue-900/20 rounded border border-blue-500/30">
                        <div className="text-blue-300 font-medium text-xs mb-1">📱 Mobile Tip</div>
                        <div className="text-blue-200 text-xs">
                          Individual downloads have 2-second delays on mobile to prevent download interruptions. 
                          Consider enabling "Package as ZIP" for faster download.
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>

              {isBatchExporting && (
                <div className="space-y-3 p-3 bg-purple-900/20 rounded border border-purple-500/30">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-purple-300 font-medium">Batch Export Progress</span>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 font-mono">
                        {formatElapsedTime(exportElapsedTime)}
                      </span>
                      <span className="text-purple-200">
                        {batchProgress}/{batchTotalSteps} ({Math.round((batchProgress / Math.max(batchTotalSteps, 1)) * 100)}%)
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2">
                    <div 
                      className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min((batchProgress / Math.max(batchTotalSteps, 1)) * 100, 100)}%` }}
                    ></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-purple-400">
                      {batchStatus || 'Processing...'}
                    </div>
                    {batchProgress < batchTotalSteps && (
                      <Button
                        onClick={handleCancelExport}
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs bg-red-900/20 border-red-500/30 text-red-300 hover:bg-red-900/40 hover:text-red-200"
                        data-testid="cancel-export-button"
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                  {batchProgress >= batchTotalSteps && (
                    <div className="text-xs text-green-400 font-medium">
                      ✅ Export process completed - Use X button above to close
                    </div>
                  )}
                </div>
              )}
              
              {showBatchResult && (
                <div className="relative space-y-3 p-3 bg-slate-900/50 rounded border border-gray-500/30">
                  <button 
                    onClick={() => {
                      setShowBatchResult(false);
                      setBatchResultMessage('');
                      setIsBatchExporting(false); // Close the entire progress dialog when manually dismissed
                    }}
                    className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white hover:bg-slate-700/50 rounded-full transition-colors"
                    data-testid="close-batch-result"
                    title="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="text-sm text-white whitespace-pre-wrap break-words pr-8">
                    {batchResultMessage}
                  </div>
                </div>
              )}

              <Button
                onClick={handleBatchExportWithPreflight}
                disabled={isBatchExporting || enabledShapeTypes.size === 0}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 disabled:text-slate-500 text-white"
                title={enabledShapeTypes.size === 0 ? `No shape types enabled (${enabledShapeTypes.size})` : undefined}
              >
                {isBatchExporting ? (
                  <>
                    <div className="w-3 h-3 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Exporting... ({Math.round((batchProgress / batchTotalSteps) * 100)}%)
                  </>
                ) : (
                  <>
                    <Boxes className="w-3 h-3 mr-1" />
                    Start Batch Export
                  </>
                )}
              </Button>
            </>
          )}
          </div>
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // Move expanded shapes state outside of function to prevent reset on re-renders
  const [expandedShapes, setExpandedShapes] = useState<Set<string>>(new Set());
  
  // Add state for the shape list accordion to prevent auto-expansion
  const [shapeListAccordionOpen, setShapeListAccordionOpen] = useState<string | undefined>(undefined);
  
  // Add state for main sidebar accordion sections to prevent collapse on value changes
  const [openAccordionSections, setOpenAccordionSections] = useState<string[]>([]);
  
  // Add state for shape categories accordion to prevent collapse when shapes are toggled
  const [openShapeCategories, setOpenShapeCategories] = useState<string[]>(["Basic", "Geometric", "Special", "Lines & Curves", "Complex"]);

  // Persist curve accordion states across popover open/close
  const [bezierAccordionSections, setBezierAccordionSections] = useState<string[]>(['create']);
  const [smoothSplineAccordionSections, setSmoothSplineAccordionSections] = useState<string[]>(['create']);
  const [cubicAccordionSections, setCubicAccordionSections] = useState<string[]>(['create']);
  
  // Scroll container ref for the sidebar
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  
  // Scroll position preservation to prevent jumps during state updates in nested accordions
  const scrollPositionRef = useRef<number>(0);
  const scrollLockEndTimeRef = useRef<number>(0);
  const scrollLockRafRef = useRef<number | null>(null);
  
  // Save scroll position before any interaction that might cause a re-render
  // Uses a time-based lock that persists across multiple re-renders
  const saveScrollPosition = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollPositionRef.current = scrollContainerRef.current.scrollTop;
      // Lock scroll for 100ms to handle multiple re-renders and browser scroll adjustments
      scrollLockEndTimeRef.current = Date.now() + 100;
    }
  }, []);
  
  // Continuously restore scroll position while lock is active
  useLayoutEffect(() => {
    const checkAndRestoreScroll = () => {
      if (Date.now() < scrollLockEndTimeRef.current && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollPositionRef.current;
        scrollLockRafRef.current = requestAnimationFrame(checkAndRestoreScroll);
      } else {
        scrollLockRafRef.current = null;
      }
    };
    
    if (Date.now() < scrollLockEndTimeRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollPositionRef.current;
      // Schedule additional checks to handle delayed scroll resets
      if (!scrollLockRafRef.current) {
        scrollLockRafRef.current = requestAnimationFrame(checkAndRestoreScroll);
      }
    }
    
    return () => {
      if (scrollLockRafRef.current) {
        cancelAnimationFrame(scrollLockRafRef.current);
        scrollLockRafRef.current = null;
      }
    };
  });
  

  const toggleShapeExpansion = useCallback((shapeType: string) => {
    setExpandedShapes(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(shapeType)) {
        newExpanded.delete(shapeType);
      } else {
        newExpanded.add(shapeType);
      }
      return newExpanded;
    });
  }, []);

  // Simplified callback for BatchConfigDialog (committed/Apply changes — may trigger shape re-renders)
  const handleBatchConfigSettingsChange = useCallback((settings: BatchConfigSettings) => {
    onUpdateGenerationConfigSettings(settings);
  }, [onUpdateGenerationConfigSettings]);

  // Live (pre-Apply) callback — skips render-mode side effects so CTP/label keystrokes
  // don't trigger unnecessary shape layer re-renders.
  const handleBatchConfigSettingsChangeLive = useCallback((settings: BatchConfigSettings) => {
    const fn = onUpdateGenerationConfigSettingsLive ?? onUpdateGenerationConfigSettings;
    fn(settings);
  }, [onUpdateGenerationConfigSettingsLive, onUpdateGenerationConfigSettings]);

  // Memoized Shape Sets UI using the unified GenerationSetsDropdown component
  const ShapeSetsUI = useMemo(() => (
    <GenerationSetsDropdown
      currentSetId={effectiveCurrentSetId}
      generationSets={effectiveGenerationSets}
      enabledShapeTypes={enabledShapeTypes}
      scatterSettings={scatterSettings}
      batchConfigSettings={generationConfigSettings}
      shapeCountMode={effectiveMode as ShapeCountMode}
      shapeCountFixed={shapeCountFixed}
      shapeCountRange={shapeCountRange}
      onSetChange={handleSetChange}
      onCreateSet={handleCreateSet}
      onCreateCleanSet={handleCreateCleanSet}
      onDeleteSet={handleDeleteSet}
      onOpenManager={handleOpenManager}
      enabled={setsEnabled}
      variant="boxed"
      size="sm"
      data-testid="sidebar-generation-sets"
    />
  ), [
    setsEnabled,
    effectiveCurrentSetId,
    effectiveGenerationSets,
    enabledShapeTypes,
    scatterSettings,
    generationConfigSettings,
    effectiveMode,
    shapeCountFixed,
    shapeCountRange,
    handleCreateSet,
    handleCreateCleanSet,
    handleDeleteSet,
    handleSetChange,
    handleOpenManager
  ]);

  // Variant-aware ShapeTypesSection that includes Shape Sets UI + ShapeTypesContentMemo
  const ShapeTypesSection = useCallback(({ variant, hideApplyButton }: { variant: 'expanded' | 'collapsed'; hideApplyButton?: boolean }) => {
    return (
      <>
        <ShapeTypesContentMemo
          shapeSetsUI={ShapeSetsUI}
          scatterSettings={scatterSettings}
          onUpdateScatterSettings={onUpdateScatterSettings}
          generationConfigSettings={generationConfigSettings}
          onUpdateGenerationConfigSettings={onUpdateGenerationConfigSettings}
          enabledShapeTypes={enabledShapeTypes}
          onToggleShapeType={onToggleShapeType}
          shapeListAccordionOpen={shapeListAccordionOpen}
          setShapeListAccordionOpen={setShapeListAccordionOpen}
          openShapeCategories={openShapeCategories}
          setOpenShapeCategories={setOpenShapeCategories}
          expandedShapes={expandedShapes}
          toggleShapeExpansion={toggleShapeExpansion}
          setsEnabled={setsEnabled}
          currentGenerationSetId={currentGenerationSetId}
          updateGenerationSetPartial={updateGenerationSetPartial}
          applyStatus={applyStatus}
          handleApplyToCurrentSet={handleApplyToCurrentSet}
          hideApplyButton={hideApplyButton}
          bezierAccordionSections={bezierAccordionSections}
          setBezierAccordionSections={setBezierAccordionSections}
          smoothSplineAccordionSections={smoothSplineAccordionSections}
          setSmoothSplineAccordionSections={setSmoothSplineAccordionSections}
          cubicAccordionSections={cubicAccordionSections}
          setCubicAccordionSections={setCubicAccordionSections}
          currentSet={effectiveGenerationSets.find(s => s.id === effectiveCurrentSetId) ?? null}
        />
      </>
    );
  }, [
    ShapeSetsUI, 
    scatterSettings, 
    onUpdateScatterSettings, 
    generationConfigSettings,
    onUpdateGenerationConfigSettings,
    enabledShapeTypes, 
    onToggleShapeType, 
    shapeListAccordionOpen,
    openShapeCategories,
    expandedShapes,
    toggleShapeExpansion,
    setsEnabled,
    currentGenerationSetId,
    effectiveCurrentSetId,
    effectiveGenerationSets,
    updateGenerationSetPartial,
    applyStatus,
    handleApplyToCurrentSet,
    bezierAccordionSections,
    smoothSplineAccordionSections,
    cubicAccordionSections,
  ]);

  // Collapsed content: inline-call the section (no component boundary) so the
  // stable, memoized ShapeTypesContentMemo reconciles directly and is never
  // remounted on value changes (which would reset the popover scroll position).
  const CollapsedShapeTypesContent = useCallback(() => {
    return ShapeTypesSection({ variant: 'collapsed' });
  }, [ShapeTypesSection]);

  function CompositionContent() {
    return (
      <div className="h-[400px] w-full overflow-y-auto">
        <div className="space-y-4 pr-4">
          <Button 
            onClick={onComposeShapes}
            disabled={!canComposeShapes}
            className="w-full bg-[var(--editor-accent)] hover:bg-purple-700 text-white font-medium mb-4 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Layers className="w-4 h-4 mr-2" />
            Compose Shapes
          </Button>

          <div className="space-y-4">
            <div className={`flex items-center justify-between p-2 rounded-lg transition-colors ${
              scatterSettings.onPoints ? 'bg-orange-900/30 border border-orange-500/50' : 'bg-slate-800/50 hover:bg-slate-700/50'
            }`}>
              <div className="flex items-center space-x-3">
                <Navigation className={`w-4 h-4 transition-colors ${
                  scatterSettings.onPoints ? 'text-orange-400' : 'text-slate-400'
                }`} />
                <Label className={`text-sm transition-colors ${
                  scatterSettings.onPoints ? 'text-orange-200' : 'text-slate-300'
                }`}>Scatter on Points</Label>
              </div>
              <Switch
                checked={scatterSettings.onPoints}
                onCheckedChange={(checked) => onUpdateScatterSettings({ onPoints: checked })}
                className="data-[state=checked]:bg-orange-600 data-[state=unchecked]:bg-orange-900"
              />
            </div>
            <div className={`flex items-center justify-between p-2 rounded-lg transition-colors ${
              scatterSettings.insideArea ? 'bg-cyan-900/30 border border-cyan-500/50' : 'bg-slate-800/50 hover:bg-slate-700/50'
            }`}>
              <div className="flex items-center space-x-3">
                <Shapes className={`w-4 h-4 transition-colors ${
                  scatterSettings.insideArea ? 'text-cyan-400' : 'text-slate-400'
                }`} />
                <Label className={`text-sm transition-colors ${
                  scatterSettings.insideArea ? 'text-cyan-200' : 'text-slate-300'
                }`}>Scatter Inside Area</Label>
              </div>
              <Switch
                checked={scatterSettings.insideArea}
                onCheckedChange={(checked) => onUpdateScatterSettings({ insideArea: checked })}
                className="data-[state=checked]:bg-cyan-600 data-[state=unchecked]:bg-cyan-900"
              />
            </div>

            <div className="space-y-3">
              <Label className="text-xs text-slate-400">Shape Count Range</Label>
              <BufferedSliderWithLabel
                value={scatterSettings.count}
                onValueCommit={(value) => onUpdateScatterSettings({ count: value })}
                min={1}
                max={50}
                step={1}
                className="w-full"
                formatLabel={(v) => `${v} shapes`}
              />
            </div>

            <div className="space-y-3">
              <Label className="text-xs text-slate-400">Randomness</Label>
              <BufferedSliderWithLabel
                value={scatterSettings.randomness}
                onValueCommit={(value) => onUpdateScatterSettings({ randomness: value })}
                min={0}
                max={1}
                step={0.1}
                className="w-full"
                formatLabel={(v) => `${Math.round(v * 100)}%`}
              />
            </div>

            <Button
              onClick={onDistributeSelected}
              disabled={selectedCount < 2}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white"
            >
              <Boxes className="w-4 h-4 mr-2" />
              Distribute Selected ({selectedCount})
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function PropertiesContent() {
    return (
      <div className="h-[400px] w-full overflow-y-auto">
        <div className="space-y-4 pr-4">
          <div className="text-sm text-slate-400">
            Selected: <span className="text-white font-medium">{selectedCount}</span> {selectedCount === 1 ? 'shape' : 'shapes'}
            {selectedCount === 1 && selectedShapes[0] && (
              <div className="text-xs text-slate-500 mt-1">
                Type: <span className="text-slate-300">{shapeTypeDisplayNames[selectedShapes[0].type] || selectedShapes[0].type}</span>
              </div>
            )}
          </div>

          {/* Shape Properties Information */}
          {selectedCount === 1 && selectedShapes[0] && (
            <div className="space-y-4 p-3 bg-slate-800/30 rounded border border-slate-600">
              <Label className="text-sm text-slate-300 font-medium">Shape Properties</Label>
              
              <div className="space-y-3 text-xs">
                {(() => {
                  const shape = selectedShapes[0];
                  const properties = [];

                  // Basic position and transform info
                  properties.push(
                    <div key="position" className="flex justify-between">
                      <span className="text-slate-400">Position</span>
                      <span className="text-slate-300">
                        {Math.round(shape.transform.x)}, {Math.round(shape.transform.y)}
                      </span>
                    </div>
                  );

                  properties.push(
                    <div key="rotation" className="flex justify-between">
                      <span className="text-slate-400">Rotation</span>
                      <span className="text-slate-300">{Math.round(shape.transform.rotation)}°</span>
                    </div>
                  );

                  properties.push(
                    <div key="scale" className="flex justify-between">
                      <span className="text-slate-400">Scale</span>
                      <span className="text-slate-300">
                        {shape.transform.scaleX.toFixed(2)}×, {shape.transform.scaleY.toFixed(2)}×
                      </span>
                    </div>
                  );

                  // Shape-specific properties
                  switch (shape.type) {
                    case 'cubic':
                    case 'bezier':
                    case 'smooth-spline':
                      properties.push(
                        <div key="curve-type" className="flex justify-between">
                          <span className="text-slate-400">Curve Type</span>
                          <span className="text-slate-300 capitalize">
                            {shape.closed ? 'Closed' : 'Open'}
                          </span>
                        </div>
                      );
                      properties.push(
                        <div key="points" className="flex justify-between">
                          <span className="text-slate-400">Control Points</span>
                          <span className="text-slate-300">{shape.points?.length || 0}</span>
                        </div>
                      );
                      if (shape.tangentHandles?.length) {
                        properties.push(
                          <div key="handles" className="flex justify-between">
                            <span className="text-slate-400">Tangent Handles</span>
                            <span className="text-slate-300">{shape.tangentHandles.length}</span>
                          </div>
                        );
                      }
                      break;

                    case 'polygon':
                    case 'star':
                      if (shape.sides) {
                        properties.push(
                          <div key="sides" className="flex justify-between">
                            <span className="text-slate-400">{shape.type === 'star' ? 'Points' : 'Sides'}</span>
                            <span className="text-slate-300">{shape.sides}</span>
                          </div>
                        );
                      }
                      if (shape.type === 'star' && shape.innerRadius) {
                        properties.push(
                          <div key="inner-radius" className="flex justify-between">
                            <span className="text-slate-400">Inner Radius</span>
                            <span className="text-slate-300">{Math.round(shape.innerRadius)}px</span>
                          </div>
                        );
                      }
                      break;

                    case 'circle':
                    case 'ellipse':
                      if (shape.radius) {
                        properties.push(
                          <div key="radius" className="flex justify-between">
                            <span className="text-slate-400">Radius</span>
                            <span className="text-slate-300">{Math.round(shape.radius)}px</span>
                          </div>
                        );
                      }
                      break;

                    case 'rectangle':
                    case 'rounded-rectangle':
                    case 'square':
                    case 'rounded-square':
                      if (shape.width && shape.height) {
                        properties.push(
                          <div key="dimensions" className="flex justify-between">
                            <span className="text-slate-400">Dimensions</span>
                            <span className="text-slate-300">
                              {Math.round(shape.width)} × {Math.round(shape.height)}
                            </span>
                          </div>
                        );
                      }
                      if ((shape.type === 'rounded-rectangle' || shape.type === 'rounded-square') && shape.cornerRadius) {
                        properties.push(
                          <div key="corner-radius" className="flex justify-between">
                            <span className="text-slate-400">Corner Radius</span>
                            <span className="text-slate-300">{Math.round(shape.cornerRadius)}px</span>
                          </div>
                        );
                      }
                      break;

                    case 'line':
                      properties.push(
                        <div key="points" className="flex justify-between">
                          <span className="text-slate-400">Line Points</span>
                          <span className="text-slate-300">{shape.points?.length || 2}</span>
                        </div>
                      );
                      if (shape.strokeCap) {
                        properties.push(
                          <div key="stroke-cap" className="flex justify-between">
                            <span className="text-slate-400">Stroke Cap</span>
                            <span className="text-slate-300 capitalize">{shape.strokeCap}</span>
                          </div>
                        );
                      }
                      break;

                    case 'ring':
                    case 'spline-ring':
                      if (shape.radius) {
                        properties.push(
                          <div key="outer-radius" className="flex justify-between">
                            <span className="text-slate-400">Outer Radius</span>
                            <span className="text-slate-300">{Math.round(shape.radius)}px</span>
                          </div>
                        );
                      }
                      if (shape.innerRadius) {
                        properties.push(
                          <div key="inner-radius" className="flex justify-between">
                            <span className="text-slate-400">Inner Radius</span>
                            <span className="text-slate-300">{Math.round(shape.innerRadius)}px</span>
                          </div>
                        );
                      }
                      break;
                  }

                  // Common properties for all shapes
                  properties.push(
                    <div key="opacity" className="flex justify-between">
                      <span className="text-slate-400">Fill Opacity</span>
                      <span className="text-slate-300">{Math.round(shape.properties.fillOpacity * 100)}%</span>
                    </div>
                  );

                  if (shape.properties.strokeWidth > 0) {
                    properties.push(
                      <div key="stroke-width" className="flex justify-between">
                        <span className="text-slate-400">Stroke Width</span>
                        <span className="text-slate-300">{shape.properties.strokeWidth}px</span>
                      </div>
                    );
                  }

                  if (shape.properties.blurRadius > 0) {
                    properties.push(
                      <div key="blur" className="flex justify-between">
                        <span className="text-slate-400">Blur Radius</span>
                        <span className="text-slate-300">{shape.properties.blurRadius}px</span>
                      </div>
                    );
                  }

                  properties.push(
                    <div key="layer" className="flex justify-between">
                      <span className="text-slate-400">Layer Index</span>
                      <span className="text-slate-300">{shape.properties.zIndex}</span>
                    </div>
                  );

                  return properties;
                })()}
              </div>
            </div>
          )}

          {/* Multiple shapes selected - show aggregate information */}
          {selectedCount > 1 && (
            <div className="space-y-4 p-3 bg-slate-800/30 rounded border border-slate-600">
              <Label className="text-sm text-slate-300 font-medium">Selection Properties</Label>
              
              <div className="space-y-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Shape Types</span>
                  <span className="text-slate-300">
                    {Array.from(new Set(selectedShapes.map(s => s.type))).length} different
                  </span>
                </div>
                
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Shapes</span>
                  <span className="text-slate-300">{selectedCount}</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-slate-400">Layer Range</span>
                  <span className="text-slate-300">
                    {Math.min(...selectedShapes.map(s => s.properties.zIndex))} - {Math.max(...selectedShapes.map(s => s.properties.zIndex))}
                  </span>
                </div>

                {/* Show types breakdown */}
                <div className="mt-2 pt-2 border-t border-slate-600">
                  <span className="text-slate-400 text-xs">Types breakdown:</span>
                  <div className="mt-1 space-y-2">
                    {Object.entries(
                      selectedShapes.reduce((acc, shape) => {
                        acc[shape.type] = (acc[shape.type] || 0) + 1;
                        return acc;
                      }, {} as Record<string, number>)
                    ).map(([type, count]) => (
                      <div key={type} className="flex justify-between text-xs">
                        <span className="text-slate-500">{shapeTypeDisplayNames[type as ShapeType] || type}</span>
                        <span className="text-slate-400">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedCount > 0 && (
            <ShapePropertiesPanel 
              selectedShapes={selectedShapes}
              selectedGroups={selectedGroups}
              selectedCount={selectedCount}
            />
          )}

          {selectedCount === 0 && (
            <div className="space-y-4">
              <div className="text-xs text-slate-500 mb-4">
                Select shapes to edit their properties
              </div>
              
              {/* General Canvas Properties */}
              <div className="space-y-4">
                <Label className="text-sm text-slate-300 font-medium">Canvas Settings</Label>
                
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-slate-400">Background Color</Label>
                    <div className="w-6 h-6 rounded bg-slate-900 border border-slate-600"></div>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-slate-400">Canvas Size</Label>
                    <span className="text-xs text-slate-300">1200 × 800</span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-slate-400">Zoom Level</Label>
                    <span className="text-xs text-slate-300">100%</span>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="space-y-4">
                <Label className="text-sm text-slate-300 font-medium">Quick Actions</Label>
                
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={onGenerateRandomShapes} variant="secondary" size="sm" className="text-xs bg-slate-700 hover:bg-slate-600">
                    Generate Random
                  </Button>
                  <Button onClick={() => onGenerateShapesWithBatchConfig(10, { x: 0, y: 0, width: 800, height: 600 })} variant="secondary" size="sm" className="text-xs bg-slate-700 hover:bg-slate-600">
                    Generate 10
                  </Button>
                  <Button onClick={() => {/* Select all functionality would be handled by parent */}} variant="secondary" size="sm" className="text-xs bg-slate-700 hover:bg-slate-600 opacity-50" disabled>
                    Select All
                  </Button>
                  <Button onClick={onClearAll} variant="secondary" size="sm" className="text-xs bg-slate-700 hover:bg-slate-600" disabled={!onClearAll}>
                    Clear Canvas
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  function LayersContent() {
    const blendModes = [
      'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
      'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
      'exclusion', 'hue', 'saturation', 'color', 'luminosity'
    ];

    const sortedShapes = useMemo(() => {
      return (shapes || []).sort((a, b) => a.properties.zIndex - b.properties.zIndex);
    }, [shapes]);

    return (
      <div className="space-y-4">
        <div className="text-sm text-slate-400">
          Layers: <span className="text-white font-medium">{(shapes || []).length}</span> total
        </div>

        {selectedCount > 0 && (
          <div className="space-y-3">
            <Label className="text-xs text-slate-400">Layer Order</Label>
            <div className="grid grid-cols-2 gap-1">
              <Button onClick={onBringToFront} variant="secondary" size="sm" className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200">
                Bring to Front
              </Button>
              <Button onClick={onSendToBack} variant="secondary" size="sm" className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200">
                Send to Back
              </Button>
              <Button onClick={onBringForward} variant="secondary" size="sm" className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200">
                Bring Forward
              </Button>
              <Button onClick={onSendBackward} variant="secondary" size="sm" className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200">
                Send Backward
              </Button>
            </div>
          </div>
        )}

        {selectedCount > 0 && (
          <div className="space-y-3">
            <Label className="text-xs text-slate-400">Blend Mode</Label>
            <Select onValueChange={(value) => onChangeBlendMode(value as any)}>
              <SelectTrigger className="h-8 text-xs bg-slate-800 border-slate-600">
                <SelectValue placeholder="source-over" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                {blendModes.map((mode) => (
                  <SelectItem key={mode} value={mode} className="text-black data-[highlighted]:bg-slate-600 data-[highlighted]:text-white">
                    {mode.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2 max-h-48 overflow-y-auto">
          {sortedShapes.map((shape) => (
            <div key={shape.id} className={`flex items-center justify-between p-2 rounded text-xs transition-colors cursor-pointer ${
              shape.selected ? 'bg-blue-500/30 border border-blue-500/50' : 'bg-slate-800/50 hover:bg-slate-700/50'
            }`}>
              <span className={shape.selected ? 'text-blue-200' : 'text-slate-300'}>
                {shape.type} (z: {shape.properties.zIndex})
              </span>
            </div>
          ))}
        </div>

        {sortedShapes.length === 0 && (
          <div className="text-xs text-slate-500 text-center py-4">
            No shapes on canvas
          </div>
        )}
      </div>
    );
  }

  function AlignDistributeContent() {
    const [distributionPattern, setDistributionPattern] = useState<'grid' | 'circle' | 'line' | 'spiral'>('grid');
    const [distributionSpacing, setDistributionSpacing] = useState(50);
    const [alignTarget, setAlignTarget] = useState<'selection' | 'canvas'>('selection');

    const handleAlign = (direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
      if (selectedShapes.length < 2) return;

      const bounds = selectedShapes.map(shape => {
        // Calculate shape bounds
        const minX = Math.min(...shape.points.map(p => p.x + shape.transform.x));
        const maxX = Math.max(...shape.points.map(p => p.x + shape.transform.x));
        const minY = Math.min(...shape.points.map(p => p.y + shape.transform.y));
        const maxY = Math.max(...shape.points.map(p => p.y + shape.transform.y));
        return { shape, minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
      });

      let targetValue: number;

      if (direction === 'left') {
        targetValue = Math.min(...bounds.map(b => b.minX));
        bounds.forEach(b => {
          b.shape.transform.x += targetValue - b.minX;
        });
      } else if (direction === 'right') {
        targetValue = Math.max(...bounds.map(b => b.maxX));
        bounds.forEach(b => {
          b.shape.transform.x += targetValue - b.maxX;
        });
      } else if (direction === 'center') {
        targetValue = bounds.reduce((sum, b) => sum + b.centerX, 0) / bounds.length;
        bounds.forEach(b => {
          b.shape.transform.x += targetValue - b.centerX;
        });
      } else if (direction === 'top') {
        targetValue = Math.min(...bounds.map(b => b.minY));
        bounds.forEach(b => {
          b.shape.transform.y += targetValue - b.minY;
        });
      } else if (direction === 'bottom') {
        targetValue = Math.max(...bounds.map(b => b.maxY));
        bounds.forEach(b => {
          b.shape.transform.y += targetValue - b.maxY;
        });
      } else if (direction === 'middle') {
        targetValue = bounds.reduce((sum, b) => sum + b.centerY, 0) / bounds.length;
        bounds.forEach(b => {
          b.shape.transform.y += targetValue - b.centerY;
        });
      }

      if (onShapeUpdate) onShapeUpdate();
    };

    const handleDistribute = (direction: 'horizontal' | 'vertical') => {
      if (selectedShapes.length < 3) return;

      const bounds = selectedShapes.map(shape => {
        const minX = Math.min(...shape.points.map(p => p.x + shape.transform.x));
        const maxX = Math.max(...shape.points.map(p => p.x + shape.transform.x));
        const minY = Math.min(...shape.points.map(p => p.y + shape.transform.y));
        const maxY = Math.max(...shape.points.map(p => p.y + shape.transform.y));
        return { shape, minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
      });

      if (direction === 'horizontal') {
        bounds.sort((a, b) => a.centerX - b.centerX);
        const totalSpace = bounds[bounds.length - 1].centerX - bounds[0].centerX;
        const spacing = totalSpace / (bounds.length - 1);

        bounds.forEach((b, index) => {
          if (index > 0 && index < bounds.length - 1) {
            const targetX = bounds[0].centerX + spacing * index;
            b.shape.transform.x += targetX - b.centerX;
          }
        });
      } else {
        bounds.sort((a, b) => a.centerY - b.centerY);
        const totalSpace = bounds[bounds.length - 1].centerY - bounds[0].centerY;
        const spacing = totalSpace / (bounds.length - 1);

        bounds.forEach((b, index) => {
          if (index > 0 && index < bounds.length - 1) {
            const targetY = bounds[0].centerY + spacing * index;
            b.shape.transform.y += targetY - b.centerY;
          }
        });
      }

      if (onShapeUpdate) onShapeUpdate();
    };

    const handleSmartDistribution = () => {
      const targetShapes = alignTarget === 'selection' ? selectedShapes : shapes;
      if (targetShapes.length < 2) return;

      // Use the distribution algorithm
      const bounds = { x: 0, y: 0, width: 800, height: 600 };
      const settings = {
        pattern: distributionPattern as any,
        spacing: distributionSpacing,
        randomness: 0.1,
        angle: 0,
        rotation: 0,
        scale: 1,
        density: 1,
        avoidOverlap: true,
        respectBounds: true
      };

      const positions = SmartDistributionAlgorithm.generatePositions(targetShapes.length, bounds, settings);

      targetShapes.forEach((shape, index) => {
        if (positions[index]) {
          shape.transform.x = positions[index].x;
          shape.transform.y = positions[index].y;
        }
      });

      if (onShapeUpdate) onShapeUpdate();
    };

    return (
      <div className="space-y-4">
        {/* Alignment Controls */}
        <div className="space-y-3">
          <Label className="text-xs text-slate-300">Align ({selectedShapes.length} selected)</Label>
          <div className="grid grid-cols-3 gap-1">
            <Button
              onClick={() => handleAlign('left')}
              variant="secondary"
              size="sm"
              className="text-xs p-1 h-7"
              disabled={selectedShapes.length < 2}
            >
              <AlignLeft className="w-3 h-3" />
            </Button>
            <Button
              onClick={() => handleAlign('center')}
              variant="secondary"
              size="sm"
              className="text-xs p-1 h-7"
              disabled={selectedShapes.length < 2}
            >
              <AlignCenter className="w-3 h-3" />
            </Button>
            <Button
              onClick={() => handleAlign('right')}
              variant="secondary"
              size="sm"
              className="text-xs p-1 h-7"
              disabled={selectedShapes.length < 2}
            >
              <AlignRight className="w-3 h-3" />
            </Button>
            <Button
              onClick={() => handleAlign('top')}
              variant="secondary"
              size="sm"
              className="text-xs p-1 h-7"
              disabled={selectedShapes.length < 2}
            >
              <AlignJustify className="w-3 h-3 rotate-90" />
            </Button>
            <Button
              onClick={() => handleAlign('middle')}
              variant="secondary"
              size="sm"
              className="text-xs p-1 h-7"
              disabled={selectedShapes.length < 2}
            >
              <AlignCenter className="w-3 h-3 rotate-90" />
            </Button>
            <Button
              onClick={() => handleAlign('bottom')}
              variant="secondary"
              size="sm"
              className="text-xs p-1 h-7"
              disabled={selectedShapes.length < 2}
            >
              <AlignJustify className="w-3 h-3 rotate-90" />
            </Button>
          </div>
        </div>

        {/* Distribution Controls */}
        <div className="space-y-3">
          <Label className="text-xs text-slate-300">Distribute</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => handleDistribute('horizontal')}
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={selectedShapes.length < 3}
            >
              Horizontal
            </Button>
            <Button
              onClick={() => handleDistribute('vertical')}
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={selectedShapes.length < 3}
            >
              Vertical
            </Button>
          </div>
        </div>

        <Separator className="bg-slate-700" />

        {/* Smart Distribution */}
        <div className="space-y-3">
          <Label className="text-xs text-slate-300">Smart Distribution</Label>

          <div className="space-y-3">
            <Label className="text-xs text-slate-400">Target</Label>
            <Select value={alignTarget} onValueChange={(value: 'selection' | 'canvas') => setAlignTarget(value)}>
              <SelectTrigger className="h-7 text-xs bg-slate-800 border-slate-600 text-slate-200">
                <SelectValue className="text-slate-200" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="selection" className="text-slate-200 hover:bg-slate-700 focus:bg-slate-700 focus:text-slate-100">Selected Shapes</SelectItem>
                <SelectItem value="canvas" className="text-slate-200 hover:bg-slate-700 focus:bg-slate-700 focus:text-slate-100">All Shapes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label className="text-xs text-slate-400">Pattern</Label>
            <Select value={distributionPattern} onValueChange={(value: 'grid' | 'circle' | 'line' | 'spiral') => setDistributionPattern(value)}>
              <SelectTrigger className="h-7 text-xs bg-slate-800 border-slate-600 text-slate-200">
                <SelectValue className="text-slate-200" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="grid" className="text-slate-200 hover:bg-slate-700 focus:bg-slate-700 focus:text-slate-100">Grid</SelectItem>
                <SelectItem value="circle" className="text-slate-200 hover:bg-slate-700 focus:bg-slate-700 focus:text-slate-100">Circle</SelectItem>
                <SelectItem value="line" className="text-slate-200 hover:bg-slate-700 focus:bg-slate-700 focus:text-slate-100">Line</SelectItem>
                <SelectItem value="spiral" className="text-slate-200 hover:bg-slate-700 focus:bg-slate-700 focus:text-slate-100">Spiral</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Spacing</span>
              <span className="text-slate-300">{distributionSpacing}px</span>
            </div>
            <BufferedSlider
              value={[distributionSpacing]}
              onValueCommit={([value]) => setDistributionSpacing(value)}
              min={10}
              max={200}
              step={5}
              className="w-full"
            />
          </div>

          <Button
            onClick={handleSmartDistribution}
            variant="secondary"
            size="sm"
            className="w-full text-xs"
            disabled={(alignTarget === 'selection' && selectedShapes.length < 2) || (alignTarget === 'canvas' && shapes.length < 2)}
          >
            <Grid3X3 className="w-3 h-3 mr-1" />
            Apply Distribution
          </Button>
        </div>
      </div>
    );
  }

  function ProjectManagementContent() {
    return (
      <div className="flex flex-col gap-4">
        {/* Shape Sets Presets */}
        <div className="order-[7] space-y-3">
          <Label className="text-xs text-slate-300">Shape Set Presets</Label>
          <Select
            value={selectedPresetId}
            onValueChange={setSelectedPresetId}
          >
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue placeholder="Select a preset..." />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              {presets.length === 0 ? (
                <SelectItem value="no-presets" disabled className="text-slate-400 text-xs">
                  No presets saved
                </SelectItem>
              ) : (
                presets.map((preset) => (
                  <SelectItem 
                    key={preset.id} 
                    value={preset.id}
                    className="text-white data-[highlighted]:bg-slate-600 data-[highlighted]:text-white text-xs"
                  >
                    {preset.presetName}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          
          <div className="grid grid-cols-3 gap-2">
            <Button
              onClick={() => setIsSavePresetDialogOpen(true)}
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={isSaving}
              data-testid="button-save-preset"
            >
              <Save className="w-3 h-3 mr-1" />
              Save As
            </Button>
            <Button
              onClick={handleLoadPreset}
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={!selectedPresetId || selectedPresetId === 'no-presets'}
              data-testid="button-load-preset"
            >
              <FolderOpen className="w-3 h-3 mr-1" />
              Load
            </Button>
            <Button
              onClick={() => {
                setPresetToDelete(selectedPresetId);
                setIsDeletePresetDialogOpen(true);
              }}
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={!selectedPresetId || selectedPresetId === 'no-presets' || isDeleting}
              data-testid="button-delete-preset"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Delete
            </Button>
          </div>

          {/* Append / Replace toggle — applies to Load only, not Save */}
          <div className="flex items-center justify-between rounded-md bg-slate-800 border border-slate-700 px-3 py-2">
            <div className="flex items-center gap-2">
              <Switch
                checked={presetAppendMode}
                onCheckedChange={setPresetAppendMode}
                className="data-[state=checked]:bg-emerald-600 data-[state=unchecked]:bg-slate-600"
                data-testid="toggle-preset-append-mode"
              />
              <span className="text-xs text-slate-300 select-none">
                {presetAppendMode ? 'Append loaded sets' : 'Replace all sets on load'}
              </span>
            </div>
          </div>
          {!presetAppendMode && (
            <p className="text-xs text-amber-400 flex items-start gap-1.5 px-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              Loading will remove all current shape sets and replace them with the preset.
            </p>
          )}

          {/* Reload current generation sets from DB */}
          <Button
            onClick={() => onReloadGenerationSets?.()}
            variant="secondary"
            size="sm"
            className="text-xs w-full"
            disabled={!onReloadGenerationSets}
            title="Re-fetch the last saved shape sets from the database"
          >
            <RotateCcw className="w-3 h-3 mr-1" />
            Reload Sets from DB
          </Button>
        </div>

        <Separator className="order-[8] bg-slate-700" />

        {/* Save/Load Generator */}
        <div className="order-[1] space-y-3">
          <div>
            <Label className="text-xs text-slate-300">Generator</Label>
            <p className="text-xs text-slate-500 mt-0.5">Shape sets &amp; artboard config — no generated shapes</p>
          </div>
          <input
            ref={loadGeneratorFileInputRef}
            type="file"
            accept=".generator.json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                e.target.value = '';
                if (file.name.endsWith('.generated.json')) {
                  toast({
                    title: 'Wrong file type',
                    description: 'This is a Generated file. Use "Load" under "Generated File" to open it.',
                    variant: 'destructive',
                  });
                  return;
                }
                setPendingGeneratorFile(file);
                setIsLoadGeneratorDialogOpen(true);
              }
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={async () => {
                setIsSavingGenerator(true);
                try {
                  const { ProjectManager } = await import('../lib/projectManager');
                  const activeArtboardData = artboards.find(a => a.id === activeArtboard);
                  if (!activeArtboardData) {
                    toast({ title: 'No active artboard', variant: 'destructive' });
                    return;
                  }
                  await ProjectManager.saveGeneratorProject(
                    effectiveGenerationSets,
                    effectiveCurrentSetId,
                    activeArtboardData
                  );
                  await new Promise(resolve => setTimeout(resolve, 400));
                } catch (err) {
                  toast({
                    title: 'Save failed',
                    description: err instanceof Error ? err.message : 'Unknown error',
                    variant: 'destructive'
                  });
                } finally {
                  setIsSavingGenerator(false);
                }
              }}
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={isSavingGenerator}
              title="Save shape sets and artboard settings (no generated shapes)"
            >
              {isSavingGenerator ? (
                <>
                  <div className="w-3 h-3 mr-1 animate-spin rounded-full border-2 border-slate-400 border-t-slate-600" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="w-3 h-3 mr-1" />
                  Save
                </>
              )}
            </Button>
            <Button
              onClick={() => loadGeneratorFileInputRef.current?.click()}
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={isLoadingGenerator}
              title="Load shape sets and artboard settings from a generator file"
            >
              {isLoadingGenerator ? (
                <>
                  <div className="w-3 h-3 mr-1 animate-spin rounded-full border-2 border-slate-400 border-t-slate-600" />
                  Loading…
                </>
              ) : (
                <>
                  <FolderOpen className="w-3 h-3 mr-1" />
                  Load
                </>
              )}
            </Button>
          </div>
        </div>

        <Separator className="order-[2] bg-slate-700" />

        {/* Save/Load Generated */}
        <div className="order-[3] space-y-3">
          <div>
            <Label className="text-xs text-slate-300">Generated</Label>
            <p className="text-xs text-slate-500 mt-0.5">Shapes, groups &amp; artboard settings</p>
          </div>
          <input
            ref={loadProjectFileInputRef}
            type="file"
            accept=".generated.json,.json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                e.target.value = '';
                if (file.name.endsWith('.generator.json')) {
                  toast({
                    title: 'Wrong file type',
                    description: 'This is a Generator file. Use "Load" under "Generator File" to open it.',
                    variant: 'destructive',
                  });
                  return;
                }
                if (skipLoadProjectDialog) {
                  await handleLoadProjectFile(file, false);
                } else {
                  setPendingProjectFile(file);
                  setIsLoadDialogOpen(true);
                }
              }
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={async () => {
                setIsSavingProject(true);
                try {
                  const { ProjectManager } = await import('../lib/projectManager');
                  const activeArtboardData = artboards.find(a => a.id === activeArtboard);
                  if (!activeArtboardData) {
                    console.error('No active artboard found');
                    return;
                  }
                  await ProjectManager.saveProject(
                    shapes,
                    selectedGroups as any,
                    activeArtboardData
                  );
                  await new Promise(resolve => setTimeout(resolve, 500));
                } finally {
                  setIsSavingProject(false);
                }
              }}
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={isSavingProject}
              title="Save generated shapes and artboard settings"
            >
              {isSavingProject ? (
                <>
                  <div className="w-3 h-3 mr-1 animate-spin rounded-full border-2 border-slate-400 border-t-slate-600" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="w-3 h-3 mr-1" />
                  Save
                </>
              )}
            </Button>
            <Button
              onClick={() => loadProjectFileInputRef.current?.click()}
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={isLoadingProject}
              title="Load generated shapes and artboard settings"
            >
              {isLoadingProject ? (
                <>
                  <div className="w-3 h-3 mr-1 animate-spin rounded-full border-2 border-slate-400 border-t-slate-600" />
                  Loading…
                </>
              ) : (
                <>
                  <FolderOpen className="w-3 h-3 mr-1" />
                  Load
                </>
              )}
            </Button>
          </div>
        </div>

        <Separator className="order-[4] bg-slate-700" />

        {/* Portable Shape Sets */}
        <div className="order-[5] space-y-3">
          <div>
            <Label className="text-xs text-slate-300">Shape Sets</Label>
            <p className="text-xs text-slate-500 mt-0.5">Save or load portable shape-set files</p>
          </div>
          <input
            ref={loadShapeSetsFileInputRef}
            type="file"
            accept=".shapesets.json"
            className="hidden"
            onChange={async event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) await handleLoadShapeSetsFile(file);
            }}
          />
            <Select data-testid="shape-set-export-scope" value={shapeSetExportScope} onValueChange={value => setShapeSetExportScope(value as typeof shapeSetExportScope)}>
              <SelectTrigger data-testid="shape-set-export-scope-trigger" className="h-9 bg-slate-800 border-slate-600 text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
              <SelectItem value="current">Current set</SelectItem>
              <SelectItem value="selected">Selected sets</SelectItem>
              <SelectItem value="all">All sets</SelectItem>
            </SelectContent>
          </Select>
          {shapeSetExportScope === 'selected' && (
            <div className="max-h-36 overflow-y-auto rounded border border-slate-700 p-2 space-y-2">
              {effectiveGenerationSets.map(set => (
                <label key={set.id} data-testid="shape-set-export-item" className="flex items-center gap-2 text-xs text-slate-300">
                  <Checkbox
                    checked={selectedShapeSetExportIds.includes(set.id)}
                    onCheckedChange={checked => setSelectedShapeSetExportIds(ids =>
                      checked ? [...ids, set.id] : ids.filter(id => id !== set.id)
                    )}
                  />
                  <span className="truncate">{set.name}</span>
                </label>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={async () => {
                try {
                  const { ProjectManager } = await import('../lib/projectManager');
                  const setsToExport = shapeSetExportScope === 'all'
                    ? effectiveGenerationSets
                    : shapeSetExportScope === 'current'
                      ? effectiveGenerationSets.filter(set => set.id === effectiveCurrentSetId)
                      : effectiveGenerationSets.filter(set => selectedShapeSetExportIds.includes(set.id));
                  await ProjectManager.saveShapeSetsProject(setsToExport, effectiveCurrentSetId, undefined, overlayManagerState);
                } catch (error) {
                  toast({ title: 'Save failed', description: error instanceof Error ? error.message : 'Failed to save shape sets.', variant: 'destructive' });
                }
              }}
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={
                (shapeSetExportScope === 'current' && !effectiveGenerationSets.some(set => set.id === effectiveCurrentSetId))
                || (shapeSetExportScope === 'selected' && !effectiveGenerationSets.some(set => selectedShapeSetExportIds.includes(set.id)))
              }
              title="Export portable shape-set configuration"
              data-testid="save-shape-sets"
            >
              <Save className="w-3 h-3 mr-1" />
              Save
            </Button>
            <Button
              onClick={() => loadShapeSetsFileInputRef.current?.click()}
              variant="secondary"
              size="sm"
              className="text-xs"
              title="Import portable shape-set configuration"
              data-testid="load-shape-sets"
            >
              <FolderOpen className="w-3 h-3 mr-1" />
              Load
            </Button>
          </div>
        </div>

        <Separator className="order-[6] bg-slate-700" />

        {/* Portable Artboards */}
        <div className="order-[9] space-y-3">
          <div>
            <Label className="text-xs text-slate-300">Artboards</Label>
            <p className="text-xs text-slate-500 mt-0.5">Save or load portable artboard files</p>
          </div>
          <input
            ref={loadArtboardsFileInputRef}
            type="file"
            accept=".artboards.json"
            className="hidden"
            onChange={async event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) await handleLoadArtboardsFile(file);
            }}
          />
            <Select data-testid="artboard-export-scope" value={artboardConfigExportScope} onValueChange={value => setArtboardConfigExportScope(value as typeof artboardConfigExportScope)}>
              <SelectTrigger data-testid="artboard-export-scope-trigger" className="h-9 bg-slate-800 border-slate-600 text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
              <SelectItem value="active">Active artboard</SelectItem>
              <SelectItem value="selected">Selected artboards</SelectItem>
              <SelectItem value="all">All artboards</SelectItem>
            </SelectContent>
          </Select>
          {artboardConfigExportScope === 'selected' && (
            <div className="max-h-36 overflow-y-auto rounded border border-slate-700 p-2 space-y-2">
              {artboards.map(artboard => (
                <label key={artboard.id} data-testid="artboard-export-item" className="flex items-center gap-2 text-xs text-slate-300">
                  <Checkbox
                    checked={selectedArtboardConfigExportIds.includes(artboard.id)}
                    onCheckedChange={checked => setSelectedArtboardConfigExportIds(ids =>
                      checked ? [...ids, artboard.id] : ids.filter(id => id !== artboard.id)
                    )}
                  />
                  <span className="truncate">{artboard.name}</span>
                </label>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={async () => {
                try {
                  const { ProjectManager } = await import('../lib/projectManager');
                  const artboardsToExport = artboardConfigExportScope === 'all'
                    ? artboards
                    : artboardConfigExportScope === 'active'
                      ? artboards.filter(artboard => artboard.id === activeArtboard)
                      : artboards.filter(artboard => selectedArtboardConfigExportIds.includes(artboard.id));
                  await ProjectManager.saveArtboardsProject(artboardsToExport, activeArtboard);
                } catch (error) {
                  toast({ title: 'Save failed', description: error instanceof Error ? error.message : 'Failed to save artboards.', variant: 'destructive' });
                }
              }}
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={
                (artboardConfigExportScope === 'active' && !artboards.some(artboard => artboard.id === activeArtboard))
                || (artboardConfigExportScope === 'selected' && !artboards.some(artboard => selectedArtboardConfigExportIds.includes(artboard.id)))
              }
              title="Export portable artboard configuration"
              data-testid="save-artboards"
            >
              <Save className="w-3 h-3 mr-1" />
              Save
            </Button>
            <Button
              onClick={() => loadArtboardsFileInputRef.current?.click()}
              variant="secondary"
              size="sm"
              className="text-xs"
              title="Import portable artboard configuration"
              data-testid="load-artboards"
            >
              <FolderOpen className="w-3 h-3 mr-1" />
              Load
            </Button>
          </div>
        </div>

        <Separator className="order-[10] bg-slate-700" />

        {/* App Settings */}
        <div className="order-[11] space-y-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-slate-300">App Settings</Label>
            {isLoadingPreferences && (
              <div className="w-3 h-3 animate-spin rounded-full border-2 border-slate-500 border-t-slate-300" title="Loading saved settings…" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={handleSaveAppSettings}
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={isSavingAppSettings || isLoadingPreferences}
              data-testid="button-save-app-settings"
            >
              {isSavingAppSettings ? (
                <>
                  <div className="w-3 h-3 mr-1 animate-spin rounded-full border-2 border-slate-400 border-t-slate-600" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="w-3 h-3 mr-1" />
                  Save
                </>
              )}
            </Button>
            <Button
              onClick={handleLoadAppSettings}
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={!appSettingsDefaults || isLoadingPreferences}
              data-testid="button-load-app-settings"
            >
              <FolderOpen className="w-3 h-3 mr-1" />
              Load
            </Button>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Your settings are automatically saved to the database and reloaded when the app is refreshed.
          </p>
        </div>

        <Separator className="order-[12] bg-slate-700" />

        {/* New Project */}
        <Button
          onClick={() => {
            if (onClearAll) onClearAll();
          }}
          variant="secondary"
          size="sm"
          className="order-[13] w-full text-xs"
        >
          <Trash2 className="w-3 h-3 mr-1" />
          New Project
        </Button>

        {/* Project Info */}
        <div className="order-[14] space-y-3">
          <Label className="text-xs text-slate-300">Project Statistics</Label>
          <div className="text-xs text-slate-400 space-y-2">
            <div>Shapes: {shapes.length}</div>
            <div>Groups: {selectedGroups.length}</div>
            <div>Selected: {selectedCount}</div>
          </div>
        </div>
      </div>
    );
  }

  // Dialogs moved outside ProjectManagementContent to prevent recreation on state changes
  
  function renderDialogs() {
    return (
      <>
        <AlertDialog open={isPortableImportDialogOpen} onOpenChange={setIsPortableImportDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Import portable configuration</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingPortableImport?.kind === 'sets'
                  ? `Review ${pendingPortableImport.data.sets.length} imported set(s); ${pendingPortableImport.data.sets.filter((item: GenerationSet) => generationSets.some(existing => existing.id === item.id || existing.name === item.name)).length} conflict(s). Existing sets are preserved by default.`
                  : `Review ${pendingPortableImport?.data.artboards.length ?? 0} artboard(s) before importing.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              {(pendingPortableImport?.diagnostics ?? []).filter(item => item.severity !== 'info').map((item, index) => (
                <div key={`${item.code}-${item.path ?? index}`} className="text-xs text-amber-400 flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{item.message}</span>
                </div>
              ))}
              {pendingPortableImport?.kind === 'sets' ? (
                <>
                <Select value={portableSetImportMode} onValueChange={value => setPortableSetImportMode(value as SetImportMode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger><SelectContent style={{ zIndex: 10002 }}>
                    <SelectItem value="append">Keep existing / keep-both conflicts</SelectItem>
                    <SelectItem value="replace">Replace all sets</SelectItem>
                    <SelectItem value="skip">Skip imported sets</SelectItem>
                  </SelectContent>
                </Select>
                  {portableSetImportMode === 'replace' && <p className="text-xs text-amber-400">Warning: this removes all existing shape sets.</p>}
                </>
              ) : (
                <Select value={portableArtboardImportMode} onValueChange={value => setPortableArtboardImportMode(value as ArtboardImportMode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger><SelectContent style={{ zIndex: 10002 }}>
                    <SelectItem value="add">Add artboards (recommended)</SelectItem>
                    <SelectItem value="replace-active">Replace active artboard</SelectItem>
                    <SelectItem value="replace-all">Replace all artboards</SelectItem>
                    <SelectItem value="skip">Skip artboards</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPendingPortableImport(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={async event => {
                event.preventDefault();
                if (!pendingPortableImport) return;
                try {
                  await applyPortableImport(pendingPortableImport);
                  setPendingPortableImport(null);
                  setIsPortableImportDialogOpen(false);
                } catch (error) {
                  toast({ title: 'Import failed', description: error instanceof Error ? error.message : 'Failed to import configuration.', variant: 'destructive' });
                }
              }}>Continue</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {/* Load Generator Dialog */}
        <AlertDialog open={isLoadGeneratorDialogOpen} onOpenChange={setIsLoadGeneratorDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Load Generator File</AlertDialogTitle>
              <AlertDialogDescription>
                Review the import scope before continuing. Generated shapes on the canvas will not be affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">Shape sets</Label>
                <Select value={generatorSetImportMode} onValueChange={(value) => setGeneratorSetImportMode(value as SetImportMode)}>
                  <SelectTrigger className="h-9 bg-slate-800 border-slate-600 text-slate-200"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
                    <SelectItem value="append">Append (recommended)</SelectItem>
                    <SelectItem value="replace">Replace all sets</SelectItem>
                    <SelectItem value="skip">Skip shape sets</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">Artboard</Label>
                <Select value={generatorArtboardImportMode} onValueChange={(value) => setGeneratorArtboardImportMode(value as ArtboardImportMode)}>
                  <SelectTrigger className="h-9 bg-slate-800 border-slate-600 text-slate-200"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
                    <SelectItem value="add">Add as new (recommended)</SelectItem>
                    <SelectItem value="replace-active">Replace active artboard</SelectItem>
                    <SelectItem value="replace-all">Replace all artboards</SelectItem>
                    <SelectItem value="skip">Skip artboard</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(generatorSetImportMode === 'replace' || generatorArtboardImportMode === 'replace-all' || generatorArtboardImportMode === 'replace-active') && (
                <div className="text-xs text-amber-400 flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  Replacement can remove existing configuration. Review the selected modes before continuing.
                </div>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPendingGeneratorFile(null)}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={async (e) => {
                  e.preventDefault();
                  if (pendingGeneratorFile) {
                    setIsLoadGeneratorDialogOpen(false);
                    await handleLoadGeneratorFile(pendingGeneratorFile);
                    setPendingGeneratorFile(null);
                  }
                }}
              >
                Continue
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Load Project Dialog */}
        <AlertDialog open={isLoadDialogOpen} onOpenChange={setIsLoadDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Load Project File</AlertDialogTitle>
              <AlertDialogDescription>
                This project file contains shapes and artboard settings. Would you like to keep your current auto-saved settings or start fresh?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex items-center space-x-2 py-2">
              <Switch
                checked={dontAskAgainPref}
                onCheckedChange={(checked) => setDontAskAgainPref(checked as boolean)}
                className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-blue-900"
              />
              <span className="text-sm text-slate-300 cursor-pointer">Don't ask again</span>
            </div>
            <AlertDialogFooter className="flex-col sm:flex-row gap-2">
              <AlertDialogCancel onClick={() => {
                setPendingProjectFile(null);
                setDontAskAgainPref(false);
              }}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={async (e) => {
                  e.preventDefault();
                  if (pendingProjectFile) {
                    setIsLoadDialogOpen(false);
                    // Save "don't ask again" preference if checked
                    if (dontAskAgainPref) {
                      await updateSkipLoadDialog.mutateAsync(true);
                    }
                    await handleLoadProjectFile(pendingProjectFile, true);
                    setPendingProjectFile(null);
                    setDontAskAgainPref(false);
                  }
                }}
              >
                Clear & Load Fresh
              </AlertDialogAction>
              <AlertDialogAction onClick={async (e) => {
                e.preventDefault();
                if (pendingProjectFile) {
                  setIsLoadDialogOpen(false);
                  // Save "don't ask again" preference if checked
                  if (dontAskAgainPref) {
                    await updateSkipLoadDialog.mutateAsync(true);
                  }
                  await handleLoadProjectFile(pendingProjectFile, false);
                  setPendingProjectFile(null);
                  setDontAskAgainPref(false);
                }
              }}>
                Keep My Settings
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Save Preset Dialog */}
        <AlertDialog open={isSavePresetDialogOpen} onOpenChange={setIsSavePresetDialogOpen}>
          <AlertDialogContent className="bg-slate-900 border-slate-700">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-slate-200">Save Shape Sets Preset</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                Enter a name for this preset configuration. This will save all current shape sets and their settings.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-4">
              <Input
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="Preset name..."
                className={`mt-2 ${isPresetNameDuplicate ? 'border-red-500 focus-visible:ring-red-500' : 'border-slate-600'} bg-slate-800 text-slate-200 placeholder:text-slate-500`}
                autoFocus
                list="preset-names-datalist"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newPresetName.trim() && !isPresetNameDuplicate) {
                    handleSavePreset();
                  }
                }}
                data-testid="input-preset-name"
              />
              {isPresetNameDuplicate && (
                <p className="text-xs text-red-400">A preset with this name already exists</p>
              )}
              <div className="flex items-center space-x-2 pt-1">
                <Switch
                  checked={cleanPresetEnabled}
                  onCheckedChange={(checked) => setCleanPresetEnabled(checked as boolean)}
                  className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-blue-900"
                  data-testid="checkbox-clean-preset"
                />
                <span className="text-sm text-slate-300 cursor-pointer select-none">Clean preset (only save enabled sets)</span>
              </div>
              {cleanPresetEnabled && (
                <>
                  <p className={`text-xs pl-6 ${effectiveGenerationSets.filter(s => s.enabled).length === 0 ? 'text-red-400' : 'text-slate-400'}`}>
                    {effectiveGenerationSets.filter(s => s.enabled).length === 0 
                      ? 'No enabled sets - cannot save clean preset'
                      : `${effectiveGenerationSets.filter(s => s.enabled).length} of ${effectiveGenerationSets.length} sets will be saved`
                    }
                  </p>
                  <div className="flex items-center space-x-2 pl-6 pt-1">
                    <Switch
                      checked={autoLoadAfterSave}
                      onCheckedChange={(checked) => setAutoLoadAfterSave(checked as boolean)}
                      className="data-[state=checked]:bg-green-600 data-[state=unchecked]:bg-green-900"
                      data-testid="checkbox-auto-load-after-save"
                    />
                    <span className="text-sm text-slate-300 cursor-pointer select-none">Auto-load after saving</span>
                  </div>
                  {autoLoadAfterSave && (
                    <p className="text-xs text-amber-400 flex items-start gap-1.5 pl-6">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      Applying this preset will replace your current shape sets.
                    </p>
                  )}
                </>
              )}
            </div>
            <datalist id="preset-names-datalist">
              {presets.map(preset => (
                <option key={preset.id} value={preset.presetName} />
              ))}
            </datalist>
            <AlertDialogFooter>
              <AlertDialogCancel 
                className="bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700"
                onClick={() => {
                  setNewPresetName('');
                  setCleanPresetEnabled(false);
                  setAutoLoadAfterSave(false);
                }}
              >
                Cancel
              </AlertDialogCancel>
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleSavePreset}
                disabled={!newPresetName.trim() || isPresetNameDuplicate || (cleanPresetEnabled && effectiveGenerationSets.filter(s => s.enabled).length === 0)}
                data-testid="button-save-preset"
              >
                Save Preset
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete Preset Confirmation Dialog */}
        <AlertDialog open={isDeletePresetDialogOpen} onOpenChange={setIsDeletePresetDialogOpen}>
          <AlertDialogContent className="bg-slate-900 border-slate-700">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-slate-200">Delete Preset</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                Are you sure you want to delete "{presets.find(p => p.id === presetToDelete)?.presetName}"? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel 
                className="bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700"
                onClick={() => {
                  setPresetToDelete('');
                }}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleDeletePreset} 
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Replace Confirmation Dialog */}
        <AlertDialog open={isReplaceConfirmOpen} onOpenChange={setIsReplaceConfirmOpen}>
          <AlertDialogContent className="bg-slate-900 border-slate-700">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-slate-200">Replace all shape sets?</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                This will remove all current shape sets and replace them with the sets from{' '}
                <span className="text-slate-200 font-medium">
                  "{presets.find(p => p.id === pendingReplacePresetId)?.presetName}"
                </span>
                . This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col sm:flex-row gap-2">
              <AlertDialogCancel
                className="bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700"
                onClick={() => { setIsReplaceConfirmOpen(false); setPendingReplacePresetId(''); }}
              >
                Cancel
              </AlertDialogCancel>
              <Button
                variant="secondary"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setIsReplaceConfirmOpen(false);
                  const preset = presets.find(p => p.id === pendingReplacePresetId);
                  if (preset) startPresetAppend(preset.generationSetsData as GenerationSet[], preset.currentSetId || null, preset.presetName);
                  setPendingReplacePresetId('');
                }}
              >
                Append instead
              </Button>
              <AlertDialogAction
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={() => {
                  const preset = presets.find(p => p.id === pendingReplacePresetId);
                  if (preset) executePresetReplace(preset.generationSetsData as GenerationSet[], preset.currentSetId || null, preset.presetName);
                  setPendingReplacePresetId('');
                  setIsReplaceConfirmOpen(false);
                }}
              >
                Replace all sets
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Auto-load After Save Confirmation Dialog */}
        <AlertDialog open={isAutoLoadConfirmOpen} onOpenChange={setIsAutoLoadConfirmOpen}>
          <AlertDialogContent className="bg-slate-900 border-slate-700">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-slate-200">Apply preset now?</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                <span className="text-slate-200 font-medium">"{pendingAutoLoadData?.presetName}"</span> was saved successfully.
                Do you want to apply it now?
                <span className="block mt-2 text-amber-400 flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 inline" />
                  {' '}Replacing will remove all current shape sets.
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col sm:flex-row gap-2">
              <AlertDialogCancel
                className="bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700"
                onClick={() => { setIsAutoLoadConfirmOpen(false); setPendingAutoLoadData(null); }}
              >
                Don't apply
              </AlertDialogCancel>
              <Button
                variant="secondary"
                size="sm"
                className="text-xs"
                onClick={() => {
                  if (pendingAutoLoadData) {
                    startPresetAppend(pendingAutoLoadData.sets, pendingAutoLoadData.currentSetId, pendingAutoLoadData.presetName);
                  }
                  setIsAutoLoadConfirmOpen(false);
                  setPendingAutoLoadData(null);
                }}
              >
                Append
              </Button>
              <AlertDialogAction
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={() => {
                  if (pendingAutoLoadData) {
                    executePresetReplace(pendingAutoLoadData.sets, pendingAutoLoadData.currentSetId, pendingAutoLoadData.presetName);
                  }
                  setIsAutoLoadConfirmOpen(false);
                  setPendingAutoLoadData(null);
                }}
              >
                Replace all sets
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Name Clash Resolution Dialog */}
        <AlertDialog open={isNameClashDialogOpen} onOpenChange={setIsNameClashDialogOpen}>
          <AlertDialogContent className="bg-slate-900 border-slate-700 max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-slate-200">Name conflicts found</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                {nameClashSets.length} set{nameClashSets.length !== 1 ? 's' : ''} share a name with existing sets.
                Choose how to handle each conflict.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {/* Apply-to-all shortcuts */}
            <div className="flex gap-2 px-1">
              <Button
                variant="secondary"
                size="sm"
                className="text-xs flex-1"
                onClick={() => setNameClashResolutions(Object.fromEntries(nameClashSets.map(c => [c.index.toString(), 'replace' as const])))}
              >
                Replace all
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="text-xs flex-1"
                onClick={() => setNameClashResolutions(Object.fromEntries(nameClashSets.map(c => [c.index.toString(), 'keep-both' as const])))}
              >
                Keep all (add suffix)
              </Button>
            </div>

            {/* Per-clash rows — keyed and resolved by index, not ID */}
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {nameClashSets.map((clash) => (
                <div key={clash.index} className="rounded-md bg-slate-800 border border-slate-700 p-3 space-y-2">
                  <p className="text-xs text-slate-200 font-medium truncate">"{clash.incoming.name}"</p>
                  {clash.existing === null && (
                    <p className="text-xs text-slate-500 italic">Duplicate name within the preset</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      className={`flex-1 text-xs rounded px-2 py-1 border transition-colors ${nameClashResolutions[clash.index.toString()] === 'replace' ? 'bg-amber-600 border-amber-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}
                      onClick={() => setNameClashResolutions(r => ({ ...r, [clash.index.toString()]: 'replace' }))}
                    >
                      Replace existing
                    </button>
                    <button
                      className={`flex-1 text-xs rounded px-2 py-1 border transition-colors ${nameClashResolutions[clash.index.toString()] === 'keep-both' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}
                      onClick={() => setNameClashResolutions(r => ({ ...r, [clash.index.toString()]: 'keep-both' }))}
                    >
                      Keep both
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel
                className="bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700"
                onClick={() => { setIsNameClashDialogOpen(false); setNameClashSets([]); setPendingAppendData(null); }}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => {
                  if (pendingAppendData) {
                    executePresetAppend(pendingAppendData.sets, pendingAppendData.presetName, nameClashResolutions);
                  }
                  setIsNameClashDialogOpen(false);
                  setNameClashSets([]);
                  setNameClashResolutions({});
                  setPendingAppendData(null);
                }}
              >
                Apply
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  function ColorManipulationContent() {
    const [hueShift, setHueShift] = useState(0);
    const [saturationShift, setSaturationShift] = useState(0);
    const [lightnessShift, setLightnessShift] = useState(0);

    const handleApplyColorManipulation = () => {
      const manipulation = {
        mode: 'shift' as const,
        hslShift: {
          hue: hueShift,
          saturation: saturationShift,
          lightness: lightnessShift,
          enabled: true
        },
        affectFill: true,
        affectStroke: true
      };

      onApplyColorManipulation(manipulation);
    };

    return (
      <div className="space-y-4">
        <div className="text-sm text-slate-400">
          Color Manipulation
        </div>

        <div className="text-xs text-slate-500 mb-3">
          {selectedShapes.length === 0 
            ? "Apply to all shapes on canvas" 
            : `Apply to ${selectedShapes.length} selected shape${selectedShapes.length > 1 ? 's' : ''}`
          }
        </div>

        {(
          <div className="space-y-4">
            <div className="space-y-3">
              <Label className="text-xs text-slate-400">Hue Shift</Label>
              <BufferedSliderWithLabel
                value={hueShift}
                onValueCommit={(value) => setHueShift(value)}
                min={-180}
                max={180}
                step={1}
                className="w-full"
                formatLabel={(v) => `${v}°`}
              />
            </div>

            <div className="space-y-3">
              <Label className="text-xs text-slate-400">Saturation Shift</Label>
              <BufferedSliderWithLabel
                value={saturationShift}
                onValueCommit={(value) => setSaturationShift(value)}
                min={-100}
                max={100}
                step={1}
                className="w-full"
                formatLabel={(v) => `${v}%`}
              />
            </div>

            <div className="space-y-3">
              <Label className="text-xs text-slate-400">Lightness Shift</Label>
              <BufferedSliderWithLabel
                value={lightnessShift}
                onValueCommit={(value) => setLightnessShift(value)}
                min={-100}
                max={100}
                step={1}
                className="w-full"
                formatLabel={(v) => `${v}%`}
              />
            </div>

            <Button
              onClick={handleApplyColorManipulation}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white"
            >
              Apply Color Changes
            </Button>
          </div>
        )}
      </div>
    );
  }

  function ShapePropertiesPanel({ selectedShapes, selectedGroups, selectedCount }: {
    selectedShapes: Shape[];
    selectedGroups: ShapeGroupClass[];
    selectedCount: number;
  }) {
    const updateShapeProperty = useCallback((updater: (shape: Shape) => void) => {
      selectedShapes.forEach(updater);
      if (onShapeUpdate) {
        onShapeUpdate();
      }
    }, [selectedShapes, onShapeUpdate]);

    return (
      <div className="space-y-4">
        {/* Transform Properties */}
        <div className="space-y-4">
          <Label className="text-sm text-slate-300 font-medium">Transform</Label>

          {/* Position */}
          <div className="space-y-3">
            <Label className="text-xs text-slate-400">Position</Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center space-x-1">
                <Button
                  onClick={() => onMoveBy(-1, 0)}
                  variant="secondary"
                  size="sm"
                  className="text-xs p-1 h-6"
                >
                  ←
                </Button>
                <Input
                  type="number"
                  value={moveX}
                  onChange={(e) => setMoveX(Number(e.target.value))}
                  className="h-6 text-xs bg-slate-800 border-slate-600 text-white"
                  placeholder="X"
                />
                <Button
                  onClick={() => onMoveBy(1, 0)}
                  variant="secondary"
                  size="sm"
                  className="text-xs p-1 h-6"
                >
                  →
                </Button>
              </div>
              <div className="flex items-center space-x-1">
                <Button
                  onClick={() => onMoveBy(0, -1)}
                  variant="secondary"
                  size="sm"
                  className="text-xs p-1 h-6"
                >
                  ↑
                </Button>
                <Input
                  type="number"
                  value={moveY}
                  onChange={(e) => setMoveY(Number(e.target.value))}
                  className="h-6 text-xs bg-slate-800 border-slate-600 text-white"
                  placeholder="Y"
                />
                <Button
                  onClick={() => onMoveBy(0, 1)}
                  variant="secondary"
                  size="sm"
                  className="text-xs p-1 h-6"
                >
                  ↓
                </Button>
              </div>
            </div>
            <Button
              onClick={() => onMoveBy(moveX, moveY)}
              variant="secondary"
              size="sm"
              className="w-full text-xs"
            >
              <Move className="w-3 h-3 mr-1" />
              Apply Move
            </Button>
          </div>

          {/* Scale with Interactive Sliders */}
          <div className="space-y-3">
            <Label className="text-xs text-slate-400">Scale</Label>
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">X Scale</span>
                  <span className="text-slate-300">{scaleX}%</span>
                </div>
                <BufferedSlider
                  value={[scaleX]}
                  onValueCommit={([value]) => {
                    setScaleX(value);
                    if (lockAspectRatio) {
                      setScaleY(value);
                    }
                  }}
                  min={1}
                  max={500}
                  step={1}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Y Scale</span>
                  <span className="text-slate-300">{scaleY}%</span>
                </div>
                <BufferedSlider
                  value={[scaleY]}
                  onValueCommit={([value]) => {
                    setScaleY(value);
                    if (lockAspectRatio) {
                      setScaleX(value);
                    }
                  }}
                  min={1}
                  max={500}
                  step={1}
                  className="w-full"
                />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                checked={lockAspectRatio}
                onCheckedChange={(checked) => setLockAspectRatio(checked === true)}
                className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-blue-900"
              />
              <Label className="text-xs text-slate-400">Lock Aspect Ratio</Label>
            </div>
            <Button
              onClick={() => onScaleBy(scaleX / 100, scaleY / 100)}
              variant="secondary"
              size="sm"
              className="w-full text-xs"
            >
              <Expand className="w-3 h-3 mr-1" />
              Apply Scale
            </Button>
          </div>

          {/* Rotation with Slider */}
          <div className="space-y-3">
            <Label className="text-xs text-slate-400">Rotation</Label>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Angle</span>
                <span className="text-slate-300">{selectedShapes[0]?.transform.rotation || 0}°</span>
              </div>
              <BufferedSlider
                value={[selectedShapes[0]?.transform.rotation || 0]}
                onValueCommit={([value]) => {
                  selectedShapes.forEach(shape => {
                    shape.transform.rotation = value;
                  });
                  if (onShapeUpdate) onShapeUpdate();
                }}
                min={-180}
                max={180}
                step={1}
                className="w-full"
              />
            </div>
            <div className="grid grid-cols-3 gap-1">
              <Button
                onClick={() => onRotateBy(-15)}
                variant="secondary"
                size="sm"
                className="text-xs"
              >
                -15°
              </Button>
              <Button
                onClick={() => onRotateBy(-90)}
                variant="secondary"
                size="sm"
                className="text-xs"
              >
                -90°
              </Button>
              <Button
                onClick={() => onRotateBy(15)}
                variant="secondary"
                size="sm"
                className="text-xs"
              >
                +15°
              </Button>
            </div>
          </div>

          {/* Flip */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={onFlipHorizontal}
              variant="secondary"
              size="sm"
              className="text-xs"
            >
              <FlipHorizontal className="w-3 h-3 mr-1" />
              Flip H
            </Button>
            <Button
              onClick={onFlipVertical}
              variant="secondary"
              size="sm"
              className="text-xs"
            >
              <FlipVertical className="w-3 h-3 mr-1" />
              Flip V
            </Button>
          </div>
        </div>

        {/* Fill & Stroke Properties */}
        <Separator className="bg-slate-600" />

        <div className="space-y-4">
          <Label className="text-sm text-slate-300 font-medium">Fill & Stroke</Label>

          {/* Fill Color */}
          <div className="space-y-3">
            <Label className="text-xs text-slate-400">Fill Color</Label>
            <input
              ref={fillColorInputRef}
              type="color"
              style={{ display: 'none' }}
              onChange={(e) => {
                const color = e.target.value;
                updateShapeProperty((shape) => {
                  shape.properties.fillColor = color;
                });
              }}
            />
            <div className="flex items-center space-x-2">
              <div 
                className="w-8 h-6 rounded border border-slate-600 cursor-pointer"
                style={{ backgroundColor: selectedShapes[0]?.properties.fillColor || '#3b82f6' }}
                onClick={() => {
                  if (fillColorInputRef.current) {
                    fillColorInputRef.current.value = selectedShapes[0]?.properties.fillColor || '#3b82f6';
                    fillColorInputRef.current.click();
                  }
                }}
              />
              <Input
                type="text"
                value={selectedShapes[0]?.properties.fillColor || '#3b82f6'}
                onChange={(e) => {
                  const color = e.target.value;
                  updateShapeProperty((shape) => {
                    shape.properties.fillColor = color;
                  });
                }}
                className="h-6 text-xs bg-slate-800 border-slate-600 text-white"
                placeholder="#color"
              />
            </div>
          </div>

          {/* Fill Opacity */}
          <div className="space-y-3">
            <Label className="text-xs text-slate-400">Fill Opacity</Label>
            <BufferedSlider
              value={[Math.round((selectedShapes[0]?.properties.fillOpacity || 1) * 100)]}
              onValueCommit={([value]) => {
                updateShapeProperty((shape) => {
                  shape.properties.fillOpacity = value / 100;
                });
              }}
              min={0}
              max={100}
              step={1}
              className="w-full"
            />
            <span className="text-xs text-slate-500">{Math.round((selectedShapes[0]?.properties.fillOpacity || 1) * 100)}%</span>
          </div>

          {/* Stroke Color */}
          <div className="space-y-3">
            <Label className="text-xs text-slate-400">Stroke Color</Label>
            <input
              ref={strokeColorInputRef}
              type="color"
              style={{ display: 'none' }}
              onChange={(e) => {
                const color = e.target.value;
                updateShapeProperty((shape) => {
                  shape.properties.strokeColor = color;
                });
              }}
            />
            <div className="flex items-center space-x-2">
              <div 
                className="w-8 h-6 rounded border border-slate-600 cursor-pointer"
                style={{ backgroundColor: selectedShapes[0]?.properties.strokeColor || '#1e40af' }}
                onClick={() => {
                  if (strokeColorInputRef.current) {
                    strokeColorInputRef.current.value = selectedShapes[0]?.properties.strokeColor || '#1e40af';
                    strokeColorInputRef.current.click();
                  }
                }}
              />
              <Input
                type="text"
                value={selectedShapes[0]?.properties.strokeColor || '#1e40af'}
                onChange={(e) => {
                  const color = e.target.value;
                  updateShapeProperty((shape) => {
                    shape.properties.strokeColor = color;
                  });
                }}
                className="h-6 text-xs bg-slate-800 border-slate-600 text-white"
                placeholder="#color"
              />
            </div>
          </div>

          {/* Stroke Width & Opacity */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label className="text-xs text-slate-400">Stroke Width</Label>
              <BufferedNumericInput
                value={selectedShapes[0]?.properties.strokeWidth || 2}
                onCommit={(width) => {
                  updateShapeProperty((shape) => {
                    shape.properties.strokeWidth = width;
                  });
                }}
                min={0}
                max={50}
                step={0.1}
                className="h-6 text-xs bg-slate-800 border-slate-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-slate-400">Stroke Opacity</Label>
              <BufferedNumericInput
                value={Math.round((selectedShapes[0]?.properties.strokeOpacity || 1) * 100)}
                onCommit={(value) => {
                  const opacity = value / 100;
                  updateShapeProperty((shape) => {
                    shape.properties.strokeOpacity = opacity;
                  });
                }}
                min={0}
                max={100}
                step={1}
                className="h-6 text-xs bg-slate-800 border-slate-600 text-white"
              />
            </div>
          </div>
        </div>

        {/* Shape-specific Properties */}
        {selectedShapes.length === 1 && (
          <>
            <Separator className="bg-slate-600" />
            <div className="space-y-4">
              <Label className="text-sm text-slate-300 font-medium">Shape Properties</Label>

              {selectedShapes[0].type === 'circle' && selectedShapes[0].radius && (
                <div className="space-y-3">
                  <Label className="text-xs text-slate-400">Radius</Label>
                  <BufferedNumericInput
                    value={selectedShapes[0].radius}
                    onCommit={(newRadius) => {
                      updateShapeProperty((shape) => {
                        if (shape.type === 'circle') {
                          shape.radius = newRadius;
                          shape.regeneratePointsFromSegments();
                        }
                      });
                    }}
                    min={1}
                    max={1000}
                    step={1}
                    className="h-6 text-xs bg-slate-800 border-slate-600 text-white"
                  />
                </div>
              )}

              {(selectedShapes[0].type === 'rectangle' || selectedShapes[0].type === 'ellipse') && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400">Width</Label>
                    <BufferedNumericInput
                      value={selectedShapes[0].width || 0}
                      onCommit={(newWidth) => {
                        updateShapeProperty((shape) => {
                          if (shape.width !== undefined) {
                            shape.width = newWidth;
                            if (shape.type === 'rectangle' || shape.type === 'ellipse') {
                              shape.regeneratePointsFromSegments();
                            }
                          }
                        });
                      }}
                      min={1}
                      max={2000}
                      step={1}
                      className="h-6 text-xs bg-slate-800 border-slate-600 text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400">Height</Label>
                    <BufferedNumericInput
                      value={selectedShapes[0].height || 0}
                      onCommit={(newHeight) => {
                        updateShapeProperty((shape) => {
                          if (shape.height !== undefined) {
                            shape.height = newHeight;
                            if (shape.type === 'rectangle' || shape.type === 'ellipse') {
                              shape.regeneratePointsFromSegments();
                            }
                          }
                        });
                      }}
                      min={1}
                      max={2000}
                      step={1}
                      className="h-6 text-xs bg-slate-800 border-slate-600 text-white"
                    />
                  </div>
                </div>
              )}

              {(selectedShapes[0].type === 'polygon' || selectedShapes[0].type === 'star') && selectedShapes[0].sides && (
                <div className="space-y-3">
                  <Label className="text-xs text-slate-400">Sides</Label>
                  <BufferedNumericInput
                    value={selectedShapes[0].sides}
                    onCommit={(newSides) => {
                      updateShapeProperty((shape) => {
                        if (shape.sides !== undefined) {
                          shape.sides = newSides;
                          shape.regeneratePointsFromSegments();
                        }
                      });
                    }}
                    min={3}
                    max={20}
                    step={1}
                    className="h-6 text-xs bg-slate-800 border-slate-600 text-white"
                  />
                </div>
              )}

              {(selectedShapes[0].type === 'circle' || selectedShapes[0].type === 'ellipse') && (
                <div className="space-y-3">
                  <Label className="text-xs text-slate-400">Segments (Smoothness)</Label>
                  <BufferedSliderWithLabel
                    value={selectedShapes[0].segments}
                    onValueCommit={(value) => {
                      updateShapeProperty((shape) => {
                        shape.segments = value;
                        shape.regeneratePointsFromSegments();
                      });
                    }}
                    min={8}
                    max={64}
                    step={4}
                    className="w-full"
                    formatLabel={(v) => `${v} segments`}
                  />
                </div>
              )}

              {/* Point Management for Splines, Lines, and Polygons */}
              {(selectedShapes[0].type === 'bezier' || selectedShapes[0].type === 'smooth-spline' || selectedShapes[0].type === 'line' || selectedShapes[0].type === 'polygon') && (
                <div className="space-y-3">
                  <Label className="text-xs text-slate-400">Point Count</Label>
                  <div className="flex items-center space-x-2">
                    <Button
                      onClick={() => {
                        updateShapeProperty((shape) => {
                          if (shape.points && shape.points.length > 2) {
                            // Remove the last point
                            shape.points.pop();
                            // Update shape geometry
                            if (shape.updateShapeFromPoints) {
                              shape.updateShapeFromPoints();
                            }
                            // Regenerate polygon segments if needed
                            if (shape.type === 'polygon' && shape.sides) {
                              shape.sides = shape.points.length;
                            }
                          }
                        });
                      }}
                      variant="secondary"
                      size="sm"
                      className="text-xs h-6 px-2 bg-slate-700 hover:bg-slate-600"
                      disabled={selectedShapes[0].points?.length <= 2}
                    >
                      - Remove Point
                    </Button>
                    <span className="text-xs text-slate-300 flex-1 text-center">
                      {selectedShapes[0].points?.length || 0} points
                    </span>
                    <Button
                      onClick={() => {
                        updateShapeProperty((shape) => {
                          if (shape.points && shape.points.length < 20) {
                            // Add a new point between the last two points
                            const lastPoint = shape.points[shape.points.length - 1];
                            const secondLastPoint = shape.points[shape.points.length - 2] || lastPoint;
                            const newPoint = {
                              x: (lastPoint.x + secondLastPoint.x) / 2 + (Math.random() - 0.5) * 20,
                              y: (lastPoint.y + secondLastPoint.y) / 2 + (Math.random() - 0.5) * 20
                            };
                            shape.points.push(newPoint);
                            // Update shape geometry
                            if (shape.updateShapeFromPoints) {
                              shape.updateShapeFromPoints();
                            }
                            // Regenerate polygon segments if needed
                            if (shape.type === 'polygon' && shape.sides) {
                              shape.sides = shape.points.length;
                            }
                          }
                        });
                      }}
                      variant="secondary"
                      size="sm"
                      className="text-xs h-6 px-2 bg-slate-700 hover:bg-slate-600"
                      disabled={selectedShapes[0].points?.length >= 20}
                    >
                      + Add Point
                    </Button>
                  </div>
                </div>
              )}

              {/* Corner Radius for Rounded Shapes */}
              {(selectedShapes[0].type === 'rounded-rectangle' || selectedShapes[0].type === 'rounded-square') && selectedShapes[0].cornerRadius !== undefined && (
                <div className="space-y-3">
                  <Label className="text-xs text-slate-400">Corner Radius</Label>
                  <BufferedNumericInput
                    value={selectedShapes[0].cornerRadius || 0}
                    onCommit={(newRadius) => {
                      updateShapeProperty((shape) => {
                        if (shape.cornerRadius !== undefined) {
                          shape.cornerRadius = Math.max(0, newRadius);
                          if (shape.regeneratePointsFromSegments) {
                            shape.regeneratePointsFromSegments();
                          }
                        }
                      });
                    }}
                    min={0}
                    max={50}
                    step={1}
                    className="h-6 text-xs bg-slate-800 border-slate-600 text-white"
                  />
                </div>
              )}

              {/* Inner Radius for Stars and Rings */}
              {(selectedShapes[0].type === 'star' || selectedShapes[0].type === 'ring') && selectedShapes[0].innerRadius !== undefined && (
                <div className="space-y-3">
                  <Label className="text-xs text-slate-400">Inner Radius</Label>
                  <BufferedNumericInput
                    value={selectedShapes[0].innerRadius || 0}
                    onCommit={(newInnerRadius) => {
                      updateShapeProperty((shape) => {
                        if (shape.innerRadius !== undefined) {
                          shape.innerRadius = Math.max(0, newInnerRadius);
                          if (shape.regeneratePointsFromSegments) {
                            shape.regeneratePointsFromSegments();
                          }
                        }
                      });
                    }}
                    min={0}
                    max={selectedShapes[0].radius ? Math.floor(selectedShapes[0].radius * 0.9) : 50}
                    step={1}
                    className="h-6 text-xs bg-slate-800 border-slate-600 text-white"
                  />
                </div>
              )}
            </div>
          </>
        )}

        <Separator className="bg-slate-600" />

        <Button
          onClick={onDeleteSelected}
          variant="destructive"
          size="sm"
          className="w-full text-xs"
        >
          <Trash2 className="w-3 h-3 mr-1" />
          Delete Selected
        </Button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full bg-slate-900/95 border-r border-slate-700 transition-all duration-300 ${
      isCollapsed ? 'w-12' : 'w-80'
    }`}>
      {/* Auth Header */}
      <div className="border-b border-slate-700">
        <AuthHeader 
          isCollapsed={isCollapsed}
          apiTabProps={{
            enabledShapeTypes,
            scatterSettings,
            generationConfigSettings,
            exportBatchModeEnabled: exportSettings.exportBatchModeEnabled,
            exportSaveProjectFiles,
            exportBatchCount,
            exportShapeCountRange,
            exportQuality,
            exportScale,
            exportFormat,
            exportScope: exportMode === 'selection' ? 'selected' : (exportMode === 'artboard' || exportMode === 'artboard-extended') ? 'artboard' : 'all',
            packageAsZip,
            exportAllImages,
            selectedImageIndices,
            artboards,
            activeArtboard,
            sidebarCollapsed: isCollapsed,
          }}
        />
      </div>
      
      {/* Header */}
      <div className={`flex items-center border-b border-slate-700 ${isCollapsed ? 'justify-center py-3' : 'justify-between p-3'}`}>
        {!isCollapsed && (
          <h2 className="text-lg font-semibold text-white">Shape Editor</h2>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-slate-400 hover:text-white hover:bg-slate-800 h-8 w-8 p-0"
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      {/* Collapsed Content with Tight Popovers */}
      {isCollapsed && (
        <div className="flex flex-col w-full items-center">
          {[
            { id: 'shapes', name: 'Shape Types', icon: Shapes, color: 'blue', content: CollapsedShapeTypesContent },
            { id: 'selection', name: 'Selection Mode', icon: Target, color: 'cyan', content: SelectionModesContent },
            { id: 'layers', name: 'Layers', icon: Layers3, color: 'purple', content: LayersContent },
            { id: 'properties', name: 'Properties', icon: Settings, color: 'yellow', content: PropertiesContent },
            { id: 'composition', name: 'Composition', icon: Shuffle, color: 'green', content: CompositionContent },
            { id: 'align-distribute', name: 'Align & Distribute', icon: AlignCenter, color: 'indigo', content: AlignDistributeContent },
            { id: 'artboards', name: 'Artboards', icon: Monitor, color: 'orange', content: ArtboardsContent },
            { id: 'colors', name: 'Color Manipulation', icon: Palette, color: 'pink', content: ColorManipulationContent },
            { id: 'project', name: 'Project Management', icon: FolderOpen, color: 'violet', content: ProjectManagementContent },
            { id: 'export', name: 'Export & Save', icon: Download, color: 'emerald', content: ExportSaveContent },
            { id: 'overlay-manager', name: 'Overlay Manager', icon: Eye, color: 'teal', content: () => null }
          ]
          .sort((a, b) => {
            // Sort by displayOrder from user preferences
            const orderA = sidebarSections[a.id as keyof typeof sidebarSections]?.displayOrder ?? 999;
            const orderB = sidebarSections[b.id as keyof typeof sidebarSections]?.displayOrder ?? 999;
            return orderA - orderB;
          })
          .filter(section => 
            // Only show sections that are enabled in user preferences
            sidebarSections[section.id as keyof typeof sidebarSections]?.enabled === true
          ).map((section, index) => (
            <div key={section.id} className="flex flex-col items-center w-full">
              <Popover 
                open={activePopover === section.id} 
                onOpenChange={(open) => setActivePopover(open ? section.id : null)}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    className={`w-full h-8 p-0 rounded-none border-0 hover:bg-slate-800 ${
                      activePopover === section.id ? 'bg-slate-800' : ''
                    } ${
                      section.color === 'cyan' ? 'text-cyan-400 hover:text-cyan-300' :
                      section.color === 'orange' ? 'text-orange-400 hover:text-orange-300' :
                      section.color === 'emerald' ? 'text-emerald-400 hover:text-emerald-300' :
                      section.color === 'blue' ? 'text-blue-400 hover:text-blue-300' :
                      section.color === 'green' ? 'text-green-400 hover:text-green-300' :
                      section.color === 'yellow' ? 'text-yellow-400 hover:text-yellow-300' :
                      section.color === 'purple' ? 'text-purple-400 hover:text-purple-300' :
                      section.color === 'indigo' ? 'text-indigo-400 hover:text-indigo-300' :
                      section.color === 'violet' ? 'text-violet-400 hover:text-violet-300' :
                      section.color === 'teal' ? 'text-teal-400 hover:text-teal-300' :
                      'text-pink-400 hover:text-pink-300'
                    }`}
                    onClick={() => handlePopoverToggle(section.id)}
                    data-testid={`sidebar-collapsed-${section.id}-button`}
                  >
                    <section.icon className="w-4 h-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent 
                  side="right" 
                  align="start" 
                  className="w-80 max-h-96 overflow-y-auto bg-slate-900 border-slate-700 text-white"
                  sideOffset={4}
                >
                  <div className="space-y-3">
                    <h3 className={`text-sm font-medium ${
                      section.color === 'cyan' ? 'text-cyan-400' :
                      section.color === 'orange' ? 'text-orange-400' :
                      section.color === 'emerald' ? 'text-emerald-400' :
                      section.color === 'blue' ? 'text-blue-400' :
                      section.color === 'green' ? 'text-green-400' :
                      section.color === 'yellow' ? 'text-yellow-400' :
                      section.color === 'purple' ? 'text-purple-400' :
                      section.color === 'indigo' ? 'text-indigo-400' :
                      section.color === 'violet' ? 'text-violet-400' :
                      section.color === 'teal' ? 'text-teal-400' :
                      'text-pink-400'
                    }`}>
                      {section.name}
                    </h3>
                    {/* Inline-call only hook-free content fns (shapes/properties/composition)
                        so their subtree is not remounted on value changes (preserves scroll).
                        overlay-manager uses a module-level memo component to preserve accordion state.
                        Keep other hook-using sections as <section.content /> to respect rules of hooks. */}
                    {section.id === 'overlay-manager'
                      ? <CollapsedOverlayManagerContentMemo
                          overlayManagerState={overlayManagerState}
                          onOverlayManagerStateChange={onOverlayManagerStateChange}
                          generationSets={generationSets}
                          updateGenerationSetPartial={updateGenerationSetPartial}
                        />
                      : (section.id === 'shapes' || section.id === 'properties' || section.id === 'composition')
                        ? section.content()
                        : <section.content />}
                  </div>
                </PopoverContent>
              </Popover>
              

            </div>
          ))}
        </div>
      )}

      {!isCollapsed && (
        /* Expanded sidebar with full content */
        <>
          <div 
            ref={scrollContainerRef} 
            className="flex-1 overflow-y-auto [&_*]:!scroll-m-0"
            style={{ overflowAnchor: 'none' }}
            onPointerDown={saveScrollPosition}
            onFocusCapture={saveScrollPosition}
            onKeyDown={saveScrollPosition}
          >
          <Accordion 
            type="multiple" 
            value={openAccordionSections} 
            onValueChange={setOpenAccordionSections}
            className="w-full px-2 py-1 flex flex-col"
          >
            {/* Shape Types Section */}
            {sidebarSections.shapes?.enabled && (
              <AccordionItem value="shapes" className="border-slate-700" style={{ order: sidebarSections.shapes?.displayOrder ?? 999 }}>
                <AccordionTrigger className="text-sm text-blue-400 hover:text-blue-300 py-3 hover:no-underline">
                  <div className="flex items-center">
                    <Shapes className="w-4 h-4 mr-2" />
                    Shape Types
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  {ShapeTypesSection({ variant: 'expanded' })}
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Selection Modes Section */}
            {sidebarSections.selection?.enabled && (
              <AccordionItem value="selection" className="border-slate-700" style={{ order: sidebarSections.selection?.displayOrder ?? 999 }}>
                <AccordionTrigger className="text-sm text-cyan-400 hover:text-cyan-300 py-3 hover:no-underline">
                  <div className="flex items-center">
                    <Target className="w-4 h-4 mr-2" />
                    Selection Modes
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <SelectionModesContent />
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Layers Section */}
            {sidebarSections.layers?.enabled && (
              <AccordionItem value="layers" className="border-slate-700" style={{ order: sidebarSections.layers?.displayOrder ?? 999 }}>
                <AccordionTrigger className="text-sm text-purple-400 hover:text-purple-300 py-3 hover:no-underline">
                  <div className="flex items-center">
                    <Layers3 className="w-4 h-4 mr-2" />
                    Layers
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <LayersContent />
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Composition Section */}
            {sidebarSections.composition?.enabled && (
              <AccordionItem value="composition" className="border-slate-700" style={{ order: sidebarSections.composition?.displayOrder ?? 999 }}>
                <AccordionTrigger className="text-sm text-green-400 hover:text-green-300 py-3 hover:no-underline">
                  <div className="flex items-center">
                    <Shuffle className="w-4 h-4 mr-2" />
                    Composition
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  {CompositionContent()}
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Align & Distribute Section */}
            {sidebarSections['align-distribute']?.enabled && (
              <AccordionItem value="align-distribute" className="border-slate-700" style={{ order: sidebarSections['align-distribute']?.displayOrder ?? 999 }}>
                <AccordionTrigger className="text-sm text-indigo-400 hover:text-indigo-300 py-3 hover:no-underline">
                  <div className="flex items-center">
                    <AlignCenter className="w-4 h-4 mr-2" />
                    Align & Distribute
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <AlignDistributeContent />
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Artboards Section */}
            {sidebarSections.artboards?.enabled && (
              <AccordionItem value="artboards" className="border-slate-700" style={{ order: sidebarSections.artboards?.displayOrder ?? 999 }}>
                <AccordionTrigger className="text-sm text-orange-400 hover:text-orange-300 py-3 hover:no-underline">
                  <div className="flex items-center">
                    <Monitor className="w-4 h-4 mr-2" />
                    Artboards
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <ArtboardsContent />
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Color Manipulation Section */}
            {sidebarSections.colors?.enabled && (
              <AccordionItem value="colors" className="border-slate-700" style={{ order: sidebarSections.colors?.displayOrder ?? 999 }}>
                <AccordionTrigger className="text-sm text-pink-400 hover:text-pink-300 py-3 hover:no-underline">
                  <div className="flex items-center">
                    <Palette className="w-4 h-4 mr-2" />
                    Color Manipulation
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <ColorManipulationContent />
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Project Management Section */}
            {sidebarSections.project?.enabled && (
              <AccordionItem value="project" className="border-slate-700" style={{ order: sidebarSections.project?.displayOrder ?? 999 }}>
                <AccordionTrigger className="text-sm text-violet-400 hover:text-violet-300 py-3 hover:no-underline">
                  <div className="flex items-center">
                    <FolderOpen className="w-4 h-4 mr-2" />
                    Project Management
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <ProjectManagementContent />
                  
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Export & Save Section */}
            {sidebarSections.export?.enabled && (
              <AccordionItem value="export" className="border-slate-700" style={{ order: sidebarSections.export?.displayOrder ?? 999 }}>
                <AccordionTrigger className="text-sm text-emerald-400 hover:text-emerald-300 py-3 hover:no-underline">
                  <div className="flex items-center">
                    <Download className="w-4 h-4 mr-2" />
                    Export & Save
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <ExportSaveContent />
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Overlay Manager Section */}
            {sidebarSections['overlay-manager']?.enabled && (
              <AccordionItem value="overlay-manager" className="border-slate-700" style={{ order: sidebarSections['overlay-manager']?.displayOrder ?? 999 }}>
                <AccordionTrigger className="text-sm text-teal-400 hover:text-teal-300 py-3 hover:no-underline">
                  <div className="flex items-center">
                    <Eye className="w-4 h-4 mr-2" />
                    Overlay Manager
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  {(() => {
                    const upd = (partial: Partial<OverlayManagerState>) =>
                      onOverlayManagerStateChange?.({ ...overlayManagerState, ...partial });

                    // Jump to a named anchor inside the Artboards section
                    const openArtboardSection = (anchorId: string) => {
                      if (!openAccordionSections.includes('artboards')) {
                        setOpenAccordionSections([...openAccordionSections, 'artboards']);
                      }
                      setTimeout(() => {
                        const el = document.getElementById(anchorId);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 220);
                    };

                    const DEBUG_PALETTE = ['#FF4444', '#44AAFF', '#44FF88', '#FFAA00', '#CC44FF'];
                    // Include ALL enabled grid-distribution sets — overlayManagerState controls visibility per-set
                    const debugSets = generationSets?.filter(
                      s => s.enabled && s.batchConfig?.distributionLayoutEnabled && s.batchConfig?.distributionPattern === 'grid'
                    ) ?? [];

                    return (
                    <div className="space-y-4">
                      {/* ── Master toggle ── */}
                      <div className={`flex items-center justify-between p-2 rounded-lg border transition-colors ${
                        overlayManagerState.allVisible ? 'bg-teal-800/40 border-teal-400/60' : 'bg-slate-700/50 border-slate-600/50'
                      }`}>
                        <div className="flex items-center space-x-3">
                          {overlayManagerState.allVisible ? <Eye className="w-4 h-4 text-teal-300" /> : <EyeOff className="w-4 h-4 text-slate-400" />}
                          <Label className={`text-sm font-semibold ${overlayManagerState.allVisible ? 'text-teal-100' : 'text-slate-400'}`}>All Overlays</Label>
                        </div>
                        <Switch
                          checked={overlayManagerState.allVisible}
                          onCheckedChange={v => {
                            // Propagate to all layer-level toggles
                            const allSets: Record<string, DebugOverlayEntry> = {};
                            Object.entries(overlayManagerState.debugGrid?.sets ?? {}).forEach(([k, e]) => {
                              allSets[k] = { ...e, visible: v };
                            });
                            onOverlayManagerStateChange?.({
                              ...overlayManagerState,
                              allVisible: v,
                              printMarksVisible: v,
                              artboardLabelsVisible: v,
                              debugGridVisible: v,
                              ctpPointLabelsVisible: v,
                              debugGrid: { sets: allSets },
                            });
                          }}
                          className="data-[state=checked]:bg-teal-500 data-[state=unchecked]:bg-teal-900"
                        />
                      </div>

                      {/* ── Individual layers — dimmed when master off ── */}
                      <div className={overlayManagerState.allVisible ? 'space-y-3' : 'space-y-3 opacity-40 pointer-events-none'}>

                        {/* ── Layer 4: Print Marks ── */}
                        <div className={`rounded-lg border transition-colors ${overlayManagerState.printMarksVisible ? 'bg-teal-900/20 border-teal-600/40' : 'bg-slate-800/30 border-slate-700/40'}`}>
                          <div className="flex items-center justify-between p-2">
                            <div className="flex items-center space-x-2">
                              <Eye className={`w-4 h-4 ${overlayManagerState.printMarksVisible ? 'text-teal-400' : 'text-slate-500'}`} />
                              <Label className={`text-sm font-medium ${overlayManagerState.printMarksVisible ? 'text-teal-200' : 'text-slate-400'}`}>Print Marks</Label>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => openArtboardSection('artboard-print-config-anchor')}
                                className="w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-teal-300 hover:bg-teal-900/40 transition-colors"
                                title="Go to Print Config in Artboards"
                              >
                                <Settings className="w-3 h-3" />
                              </button>
                              <Switch checked={overlayManagerState.printMarksVisible} onCheckedChange={v => upd({ printMarksVisible: v })} className="data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-teal-900" />
                            </div>
                          </div>
                        </div>

                        {/* ── Layer 5: Artboard Labels ── */}
                        <div className={`rounded-lg border transition-colors ${overlayManagerState.artboardLabelsVisible ? 'bg-teal-900/20 border-teal-600/40' : 'bg-slate-800/30 border-slate-700/40'}`}>
                          <div className="flex items-center justify-between p-2">
                            <div className="flex items-center space-x-2">
                              <Eye className={`w-4 h-4 ${overlayManagerState.artboardLabelsVisible ? 'text-teal-400' : 'text-slate-500'}`} />
                              <Label className={`text-sm font-medium ${overlayManagerState.artboardLabelsVisible ? 'text-teal-200' : 'text-slate-400'}`}>Artboard Labels</Label>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => openArtboardSection('artboard-display-labels-anchor')}
                                className="w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-teal-300 hover:bg-teal-900/40 transition-colors"
                                title="Go to Display Labels in Artboards"
                              >
                                <Settings className="w-3 h-3" />
                              </button>
                              <Switch checked={overlayManagerState.artboardLabelsVisible} onCheckedChange={v => upd({ artboardLabelsVisible: v })} className="data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-teal-900" />
                            </div>
                          </div>
                        </div>

                        {/* ── Layer 6: Debug Grid ── */}
                        <div className={`rounded-lg border transition-colors ${overlayManagerState.debugGridVisible ? 'bg-teal-900/20 border-teal-600/40' : 'bg-slate-800/30 border-slate-700/40'}`}>
                          <div className="flex items-center justify-between p-2">
                            <div className="flex items-center space-x-2">
                              <Eye className={`w-4 h-4 ${overlayManagerState.debugGridVisible ? 'text-teal-400' : 'text-slate-500'}`} />
                              <Label className={`text-sm font-medium ${overlayManagerState.debugGridVisible ? 'text-teal-200' : 'text-slate-400'}`}>Debug Grid</Label>
                            </div>
                            <Switch checked={overlayManagerState.debugGridVisible} onCheckedChange={v => upd({ debugGridVisible: v })} className="data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-teal-900" />
                          </div>
                          {overlayManagerState.debugGridVisible && (
                            <div className="px-3 pb-2 border-t border-teal-700/30">
                              {debugSets.length === 0 ? (
                                <p className="text-xs text-slate-500 italic py-2">No sets with grid distribution and debug enabled.</p>
                              ) : (
                                <div className="space-y-3 pt-1">
                                  {debugSets.map((set, idx) => {
                                    const entry = overlayManagerState.debugGrid?.sets[set.id];
                                    const isVisible = entry?.visible !== false;
                                    // overlayManagerState is authoritative at runtime; palette fallback for un-seeded sets
                                    const color = entry?.color || set.batchConfig?.cellConstraints?.debugGridColor || DEBUG_PALETTE[idx % DEBUG_PALETTE.length];
                                    const opacity = entry?.opacity ?? set.batchConfig?.cellConstraints?.debugGridOpacity ?? 0.4;
                                    const rows = set.batchConfig?.gridRows ?? 0;
                                    const cols = set.batchConfig?.gridColumns ?? 0;
                                    const renderMode = set.batchConfig?.cellConstraints?.renderMode ?? 'cell-center';
                                    const isCellCornersMode = renderMode === 'cell-corners';
                                    const effRows = isCellCornersMode ? rows + 1 : rows;
                                    const effCols = isCellCornersMode ? cols + 1 : cols;
                                    const gridOverridden = isCellCornersMode && (effRows !== rows || effCols !== cols);

                                    const updateSetEntry = (patch: Partial<DebugOverlayEntry>) => {
                                      const current = overlayManagerState.debugGrid?.sets ?? {};
                                      const base: DebugOverlayEntry = { visible: true, color: DEBUG_PALETTE[idx % DEBUG_PALETTE.length], opacity: 0.4, order: idx };
                                      const merged = { ...base, ...entry, ...patch };
                                      upd({ debugGrid: { sets: { ...current, [set.id]: merged } } });
                                      // Persist color/opacity to cellConstraints as side-effect
                                      if (patch.color !== undefined || patch.opacity !== void 0) {
                                        updateGenerationSetPartial?.(set.id, {
                                          batchConfig: {
                                            ...set.batchConfig!,
                                            cellConstraints: {
                                              ...set.batchConfig!.cellConstraints!,
                                              ...(patch.color !== undefined ? { debugGridColor: patch.color } : {}),
                                              ...(patch.opacity !== undefined ? { debugGridOpacity: patch.opacity } : {}),
                                            }
                                          }
                                        });
                                      }
                                    };

                                    return (
                                      <div key={set.id} className="rounded-md bg-slate-800/50 p-2 space-y-2.5">
                                        <div className="flex items-center gap-2">
                                          <Switch checked={isVisible} onCheckedChange={v => updateSetEntry({ visible: v })} className="data-[state=checked]:bg-teal-600 data-[state=unchecked]:bg-teal-900 shrink-0" />
                                          <div className="flex-1 min-w-0">
                                            <Label className={`text-xs truncate block ${isVisible ? 'text-slate-300' : 'text-slate-500'}`}>{set.name}</Label>
                                            {rows > 0 && cols > 0 && (
                                              <span className={`text-[10px] ${gridOverridden ? 'text-amber-400' : 'text-slate-500'}`}>
                                                {effRows} × {effCols}{gridOverridden ? ` (cell mode — ${rows}×${cols} configured)` : ''}
                                              </span>
                                            )}
                                          </div>
                                          <Input type="color" value={color} onChange={e => updateSetEntry({ color: e.target.value })} className="w-12 h-8 p-1 bg-slate-800 border-slate-600 rounded cursor-pointer shrink-0" title="Grid color" />
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Slider min={0} max={100} step={5} value={[Math.round(opacity * 100)]} onValueChange={([v]) => updateSetEntry({ opacity: v / 100 })} className="flex-1" />
                                          <span className="text-xs text-slate-400 w-8 text-right">{Math.round(opacity * 100)}%</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* ── Layer 7: CTP Point Labels ── */}
                        {(() => {
                          return (
                            <CtpOverlaySectionMemo
                              state={overlayManagerState}
                              generationSets={generationSets}
                              onUpdate={upd}
                            />
                          );
                        })()}

                      </div>
                    </div>
                    );
                  })()}
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Properties Section - Moved to last position */}
            {sidebarSections.properties?.enabled && (
              <AccordionItem value="properties" className="border-slate-700" style={{ order: sidebarSections.properties?.displayOrder ?? 999 }}>
                <AccordionTrigger className="text-sm text-yellow-400 hover:text-yellow-300 py-3 hover:no-underline">
                  <div className="flex items-center">
                    <Settings className="w-4 h-4 mr-2" />
                    Properties
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  {PropertiesContent()}
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </div>
        </>
      )}
      
      {/* BatchConfigDialog - Moved to stable location to prevent mount/unmount cycles */}
      <BatchConfigDialog
        settings={generationConfigSettings}
        onSettingsChange={handleBatchConfigSettingsChange}
        onLiveSettingsChange={handleBatchConfigSettingsChangeLive}
        sidebarCollapsed={isCollapsed}
        
        // Generation Sets Integration
        generationSets={generationSets}
        currentGenerationSetId={currentGenerationSetId}
        enabledShapeTypes={enabledShapeTypes}
        scatterSettings={scatterSettings}
        shapeCountMode={shapeCountMode}
        shapeCountFixed={shapeCountFixed}
        shapeCountRange={shapeCountRange}
        generationSetsEnabled={exportSettings.generationSetsEnabled}
        onGenerationSetsChange={onGenerationSetsChange}
        onCurrentGenerationSetChange={onCurrentGenerationSetChange}
        onCreateGenerationSet={onCreateGenerationSet}
        onDeleteGenerationSet={onDeleteGenerationSet}
        generateUniqueSetName={generateUniqueSetName}
        onOpenGenerationSetsManager={onOpenGenerationSetsManager}
        updateGenerationSetPartial={updateGenerationSetPartial}
        onClearAll={onClearAll}
        onOpenTabbedDialog={handleOpenTabbedDialog}
        onGenerateRandomShapes={onGenerateRandomShapes}
      />
      
      {/* Render all dialogs outside the main component tree to prevent recreation */}
      {renderDialogs()}
      
      {/* ShapeSetsTabbedDialog - consolidated tabbed dialog for all shape set dialogs */}
      <ShapeSetsTabbedDialog
        isOpen={tabbedDialogOpen}
        onOpenChange={(open) => {
          setTabbedDialogOpen(open);
          if (!open && isSetsManagerOpen && onCloseGenerationSetsManager) {
            onCloseGenerationSetsManager();
          }
        }}
        activeTab={tabbedDialogTab}
        onActiveTabChange={(tab) => setTabbedDialogTab(tab as ShapeSetsTabbedDialogTab)}
        shapeTypesSectionContent={ShapeTypesSection({ variant: 'expanded', hideApplyButton: true })}
        onApplyShapeTypes={handleApplyToCurrentSet}
        shapeTypesApplyStatus={applyStatus}
        setsEnabled={setsEnabled}
        generationSets={effectiveGenerationSets}
        onGenerationSetsChange={onGenerationSetsChange}
        currentGenerationSetId={effectiveCurrentSetId}
        onCurrentGenerationSetChange={onCurrentGenerationSetChange}
        updateGenerationSetPartial={updateGenerationSetPartial}
        globalZIndexEnabled={false}
        bleedEnabled={(() => {
          const currentArtboard = artboards.find(a => a.id === activeArtboard);
          const bleedConfig = currentArtboard?.printConfig?.overlays?.bleed;
          return (bleedConfig?.display || bleedConfig?.render) && (bleedConfig?.amount || 0) > 0;
        })()}
        batchConfigSettings={generationConfigSettings}
        onBatchConfigSettingsChange={handleBatchConfigSettingsChange}
        onLiveBatchConfigSettingsChange={handleBatchConfigSettingsChangeLive}
        enabledShapeTypes={enabledShapeTypes}
        scatterSettings={scatterSettings}
        shapeCountMode={shapeCountMode}
        shapeCountFixed={shapeCountFixed}
        shapeCountRange={shapeCountRange}
        generationSetsEnabled={exportSettings.generationSetsEnabled}
        onCreateGenerationSet={onCreateGenerationSet}
        onDeleteGenerationSet={onDeleteGenerationSet}
        generateUniqueSetName={generateUniqueSetName}
        onClearAll={onClearAll}
        onCurrentSetUpdate={(setId) => {
          if (skipNextRestoreRef.current) {
            skipNextRestoreRef.current = false;
            return;
          }
          onRestoreUIStateFromSet?.(setId);
        }}
        onApplyCurrentUIStateToSet={onApplyCurrentUIStateToSet}
        onCreateSetFromState={(uiState, name) => {
          const setId = onCreateGenerationSet?.(name || '', uiState);
          return setId || '';
        }}
        batchExportCount={exportBatchCount}
        globalRepetitionMode={globalRepetitionMode}
        globalRepetitionValue={globalRepetitionValue}
        globalRepetitionRange={globalRepetitionRange}
        onGlobalRepetitionModeChange={setGlobalRepetitionMode}
        onGlobalRepetitionValueChange={setGlobalRepetitionValue}
        onGlobalRepetitionRangeChange={setGlobalRepetitionRange}
        edgeCaseStrategy={exportSettings.edgeCaseStrategy || 'hold'}
        onEdgeCaseStrategyChange={(strategy) => {
          updateExportSettings.mutate({ edgeCaseStrategy: strategy });
        }}
      />
      
      {/* TIFF Pre-flight Modal */}
      <TiffPreflightModal
        open={isTiffPreflightOpen}
        onOpenChange={setIsTiffPreflightOpen}
        preflightInfo={getTiffPreflightInfo()}
        onConfirm={handleTiffPreflightConfirm}
        onCancel={handleTiffPreflightCancel}
        isExporting={isServerExportingGlobal}
        flattenToRgb={exportSettings.flattenToRgb ?? false}
        onFlattenToRgbChange={(value) => updateExportSettings.mutate({ flattenToRgb: value })}
        matteColor={exportSettings.matteColor || '#ffffff'}
        onMatteColorChange={(value) => updateExportSettings.mutate({ matteColor: value })}
        compressionSettings={compressionSettingsRef.current}
        onCompressionSettingsChange={(settings) => { compressionSettingsRef.current = settings; }}
      />

      {/* Client Export Failure Panel — shown when the browser canvas is too large to render */}
      <AlertDialog open={showClientExportFailurePanel} onOpenChange={setShowClientExportFailurePanel}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
              Image too large for browser export
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {clientExportFailureInfo?.reason === 'too-large' ? (
                  <p>
                    This export is{' '}
                    <strong>{clientExportFailureInfo.megapixels.toFixed(0)} megapixels</strong>{' '}
                    ({clientExportFailureInfo.width.toLocaleString()} &times; {clientExportFailureInfo.height.toLocaleString()} px),
                    which exceeds the browser&apos;s {clientExportFailureInfo.limitMp} MP hardware-acceleration limit.
                    The browser cannot render a canvas this large and would produce a blank file.
                  </p>
                ) : (
                  <p>
                    The browser returned a blank result for this export
                    {clientExportFailureInfo && ` (${clientExportFailureInfo.width.toLocaleString()} \u00d7 ${clientExportFailureInfo.height.toLocaleString()} px)`}.
                    This usually means the canvas exceeded the browser&apos;s hardware-acceleration limit.
                  </p>
                )}
                <p>
                  The <strong>server export</strong> handles any resolution without browser memory constraints and produces an identical result.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Dismiss</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowClientExportFailurePanel(false);
                serverExportRef.current?.();
              }}
            >
              Use server export
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Export Progress Overlay - Always visible during export */}
      <ExportProgressOverlay
        open={showExportProgressOverlay}
        onOpenChange={(open) => {
          if (!open) resetExportOverlay();
        }}
        progress={exportProgressGlobal}
        totalSteps={exportTotalStepsGlobal}
        status={exportStatusGlobal}
        elapsedTime={exportElapsedTimeGlobal}
        estimatedTime={exportEstimatedTimeGlobal}
        isServerExport={isServerExportingGlobal}
        onCancel={handleCancelExportGlobal}
        isComplete={exportIsCompleteGlobal}
        isError={exportIsErrorGlobal}
        resultMessage={exportResultMessageGlobal}
        downloadUrl={exportDownloadUrlGlobal}
        downloadFilename={exportDownloadFilenameGlobal}
        onDownloadComplete={() => {
          console.log('📥 User downloaded file:', exportDownloadFilenameGlobal);
        }}
        chunkIndex={exportChunkIndexGlobal}
        chunkCount={exportChunkCountGlobal}
      />
    </div>
  );
}
