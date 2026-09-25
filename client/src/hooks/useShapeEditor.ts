import { useState, useCallback, useRef, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { CurrentUIState } from './useGenerationSets';
import { useGenerationSetsPersistence } from './useGenerationSetsPersistence';
import { queryClient } from '@/lib/queryClient';
import { useUserPreferences } from './useUserPreferences';
import { generateUniqueSetName as generateUniqueName } from '@/utils/nameGeneration';
import { Shape, ShapeGroupClass } from '../lib/shapes';
import { ShapeType, ScatterSettings, CanvasSettings, BlendMode, Point, Artboard, ColorManipulation, DistributionConfig, applyGridDistribution, applyWaveDistribution, applyEllipseDistribution, applySpiralDistribution, DEFAULT_PRINT_CONFIG, PrintConfig, getEffectivePrintConfig } from '../lib/shapeTypes';
import { harvestDestinationPoints, applyCopyToPointsDistribution } from '@shared/copyToPointsUtils';
import { SmartDistributionAlgorithm } from '../lib/distributionAlgorithm';
import { BooleanOperations } from '../lib/booleanOperations';
import { ColorUtils, ColorHarmonySettings } from '../lib/colorManipulation';
import { BatchConfigSettings, defaultBatchConfigSettings, GenerationSet, ShapeCountMode, SupportedShapeType, OverlayManagerState, DEFAULT_OVERLAY_MANAGER_STATE } from '@shared/schema';
import { resolveFillPaletteColour } from '@shared/fillPaletteAnchors';
import { ShapeTypeGenMode, pickShapeType, buildFixedTypeList, fixedModeCount } from '@shared/shapeTypeGenUtils';
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
  calculateDiamondCenterY,
  resolveScalarSeries,
} from '@shared/batchUtils';
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
  resolveAnchorOffset,
  calculateDropShadow,
  calculateOuterGlow,
  calculateInnerShadow,
  calculateInnerGlow,
  deriveEffectColor,
} from '@shared/shapePropertyUtils';
import { generateColor, generateGradientColors } from '../lib/hslColor';
import { getEffectiveTranslateRange, recalculateGridForArtboard } from '../lib/artboardUtils';
import { validateArtboardDimensions } from '../lib/artboardPresets';
import { IncrementalIndexDriver, FitTarget, PrintUnitType, DEFAULT_CTP_TARGET_CONFIG } from '@shared/schema';
import { addEchoesToShapes, resolveEchoConfig } from '../lib/echoGeneration';
import { calculateIncrementalValue, applyThresholdModulation } from '@shared/incrementalUtils';
import { extractLocalJitterConfig, extractGlobalJitterConfig, computeGlobalJitter, shapeIdToHash } from '@shared/roughnessUtils';
import { convertPrintUnitToPixels } from '../lib/imageExport';
import { persistImportedConfiguration } from '../lib/configImportPersistence';
import { composePerShapeTransform, randomizeTransformAmounts } from '../lib/shapeTransformComposition';
import { applyShapeTransformsInReferenceOrder, resolveShapeReferenceOrigin } from '../lib/shapeTransformOrigins';

export interface ImportedConfigurationState {
  generationSets: GenerationSet[];
  currentSetId: string | null;
  artboards: Artboard[];
  activeArtboardId: string;
  overlayManagerState?: OverlayManagerState;
}

// Interface for overriding UI state during generation (used for generation sets)
export interface GenerationContextOverrides {
  enabledShapeTypes?: Set<ShapeType>;
  batchConfig?: BatchConfigSettings;
  scatterSettings?: Partial<ScatterSettings>;
  setRepIndex?: number;  // Set repetition index for Index Driver feature
  shapeTypeGenMode?: ShapeTypeGenMode;
  shapeTypeWeights?: Partial<Record<SupportedShapeType, number>>;
  shapeTypeFixedCounts?: Partial<Record<SupportedShapeType, number>>;
  shapeTypeSequence?: SupportedShapeType[];
  setTransform?: {
    x: number;
    y: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
    transformOrigin: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  };
  artboardAlignment?: {
    fitToArtboard: boolean;
    fitTarget?: FitTarget;  // New: 'none', 'artboard', or 'bleed'
    fitMode: 'contain' | 'fill';
    alignTo: 'artboard' | 'set' | 'none';
    alignmentType: 'center' | 'top-left' | 'top-center' | 'top-right' | 
                   'center-left' | 'center-right' | 'bottom-left' | 
                   'bottom-center' | 'bottom-right';
    targetSetId?: string;
    margin: number | { top: number; bottom: number; left: number; right: number };
  };
}

export const useShapeEditor = () => {
  // Get user preferences for app settings persistence
  const { exportSettings, appSettingsDefaults, saveAppSettings, debouncedSaveAppSettings, savedOverlayManagerState, saveOverlayManagerState, debouncedSaveOverlayManagerState, cancelPendingPreferenceWrites, isLoading: isLoadingPreferences } = useUserPreferences();
  const { toast } = useToast();
  
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [groups, setGroups] = useState<ShapeGroupClass[]>([]);
  const [selectedShapes, setSelectedShapes] = useState<Shape[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<ShapeGroupClass[]>([]);
  const [enabledShapeTypes, setEnabledShapeTypes] = useState<Set<ShapeType>>(
    new Set(['rectangle' as ShapeType, 'rounded-rectangle' as ShapeType, 'square' as ShapeType, 'rounded-square' as ShapeType, 'circle' as ShapeType, 'polygon' as ShapeType])
  );
  const [scatterSettings, setScatterSettings] = useState<ScatterSettings>({
    onPoints: false,
    insideArea: false,
    count: 5,
    minCount: 1,
    maxCount: 20,
    randomness: 0.5,
    shapeCountMode: 'fixed',
    fixedShapeCount: 5,
    distribution: {
      pattern: 'random',
      spacing: 50,
      randomness: 0.3,
      rotation: 0,
      scale: 1,
      density: 0.5,
      avoidOverlap: false,
      respectBounds: true
    },
    shapeSpecific: {
      polygon: { edgeCountRange: [3, 20] },
      circle: { segmentCountRange: [16, 32] },
      ellipse: { segmentCountRange: [16, 32] },
      bezier: { 
        pointCountRange: [3, 6], 
        openProbability: 50,
        strokeCapProbabilities: { round: 33, square: 33, butt: 34 },
        curvatureRange: [0.2, 0.8],
        patternType: 1,
        curveLengthRange: [80, 200],
        curveLengthMode: 'range'
      },
      cubic: { 
        pointCountRange: [3, 8], 
        openProbability: 90,
        strokeCapProbabilities: { round: 33, square: 33, butt: 34 },
        curvatureRange: [0.2, 0.8],
        patternType: 2,
        closeAverageProbability: 0,
        curveTension: 30,
        curveTensionMode: 'fixed',
        curveTensionValue: 30,
        curveTensionRange: [20, 50],
        endpointContinuous: false,
        jitterAlongNormal: false,
        jitterDirection: 'both'
      },
      'smooth-spline': { 
        pointCountRange: [3, 6], 
        openProbability: 50,
        strokeCapProbabilities: { round: 33, square: 33, butt: 34 },
        curvatureRange: [0.2, 0.8],
        patternType: 1
      },
      star: { pointCountRange: [5, 8], innerRadiusRange: [0.3, 0.7] },
      ring: { innerRadiusRange: [0.2, 0.8] },
      'spline-ring': { innerRadiusRange: [0.2, 0.8], segmentCountRange: [16, 32] },
      line: { 
        pointCountRange: [2, 4],
        strokeCapProbabilities: { round: 33, square: 33, butt: 34 }
      },
      'line-vector': {
        direction: { kind: 'range' as const, min: 0, max: 360 },
        length: { kind: 'range' as const, min: 5, max: 500 },
        centroid: { kind: 'fixed' as const, value: 0.5 },
        strokeCapProbabilities: { round: 33, square: 33, butt: 34 }
      },
      rectangle: {
        // Standard rectangle has no special properties
      },
      'rounded-rectangle': { 
        cornerRadiusRange: [0, 10],
        cornerRadiusMode: 'range' as const,
        cornerRadiusValue: 5
      },
      square: {
        // Standard square has no special properties
      },
      'rounded-square': { 
        cornerRadiusRange: [0, 10],
        cornerRadiusMode: 'range' as const,
        cornerRadiusValue: 5
      }
    }
  });
  const [canvasSettings, setCanvasSettings] = useState<CanvasSettings>({
    width: Number.MAX_SAFE_INTEGER,  // Truly infinite canvas
    height: Number.MAX_SAFE_INTEGER,
    zoom: 1,
    panX: 0,
    panY: 0,
    backgroundColor: '#1e293b',
    showGrid: true
  });



  // Artboard state
  const [artboards, setArtboards] = useState<Artboard[]>([
    {
      id: 'artboard_1',
      name: 'Artboard 1',
      x: -200,  // Centered at origin
      y: -200,
      width: 400,
      height: 400,
      dpi: 72,  // Default screen resolution
      unitType: 'pixels',  // Default to pixels
      backgroundColor: '#ffffff',
      displayGrid: false,
      displayBorder: true,
      displayName: true,
      displayDimensions: false,
      displayResolution: false,
      preset: 'Basic',
      printConfig: DEFAULT_PRINT_CONFIG
    }
  ]);
  const [activeArtboard, setActiveArtboard] = useState<string>('artboard_1');

  // Batch Configuration Settings - using defaults from BatchConfigDialog
  const [generationConfigSettings, setGenerationConfigSettings] = useState<BatchConfigSettings>(defaultBatchConfigSettings);
  
  // Generation Sets persistence
  const {
    generationSets: persistedGenerationSets,
    currentSetId: persistedCurrentSetId,
    saveGenerationSets,
    isLoading: isLoadingGenerationSets,
    isReady: isPersistenceReady,
  } = useGenerationSetsPersistence();

  // Generation Sets Management - centralized state for bi-directional sync
  const [generationSets, setGenerationSets] = useState<GenerationSet[]>([]);
  const [currentGenerationSetId, setCurrentGenerationSetId] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [overlayManagerState, setOverlayManagerState] = useState<OverlayManagerState>(DEFAULT_OVERLAY_MANAGER_STATE);
  const overlayLoadedRef = useRef(false);

  useEffect(() => {
    if (isLoadingPreferences || overlayLoadedRef.current) return;
    if (savedOverlayManagerState) setOverlayManagerState(savedOverlayManagerState);
    overlayLoadedRef.current = true;
  }, [isLoadingPreferences, savedOverlayManagerState]);

  const handleOverlayManagerStateChange = useCallback((state: OverlayManagerState) => {
    setOverlayManagerState(state);
    debouncedSaveOverlayManagerState(state);
  }, [debouncedSaveOverlayManagerState]);

  // Track if initial load is complete to prevent save loops
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  
  // Track if initial UI state has been restored to prevent multiple restores
  const hasRestoredInitialUI = useRef(false);
  
  // Track if we're currently saving to prevent reload loops after Apply button saves
  const isSavingRef = useRef(false);
  
  // Migration function to ensure old sets have new properties
  const migrateGenerationSets = useCallback((sets: GenerationSet[]): GenerationSet[] => {
    return sets.map(set => {
      // Migrate legacy 'predefined' transformOriginMode to 'predefined-artboard'
      // Add default alignment values if they don't exist
      const migratedBatchConfig = set.batchConfig ? {
        ...set.batchConfig,
        transformOriginMode: (set.batchConfig.transformOriginMode === 'predefined' as any) 
          ? 'predefined-artboard' 
          : set.batchConfig.transformOriginMode,
        // Add alignment defaults if they don't exist
        xShapeAnchorMode: set.batchConfig.xShapeAnchorMode || 'predefined',
        xShapeAnchorPredefined: set.batchConfig.xShapeAnchorPredefined || 'center',
        xShapeAnchorDefine: set.batchConfig.xShapeAnchorDefine ?? 0,
        xArtboardAnchorMode: set.batchConfig.xArtboardAnchorMode || 'predefined',
        xArtboardAnchorPredefined: set.batchConfig.xArtboardAnchorPredefined || 'center',
        xArtboardAnchorDefine: set.batchConfig.xArtboardAnchorDefine ?? 0,
        yShapeAnchorMode: set.batchConfig.yShapeAnchorMode || 'predefined',
        yShapeAnchorPredefined: set.batchConfig.yShapeAnchorPredefined || 'center',
        yShapeAnchorDefine: set.batchConfig.yShapeAnchorDefine ?? 0,
        yArtboardAnchorMode: set.batchConfig.yArtboardAnchorMode || 'predefined',
        yArtboardAnchorPredefined: set.batchConfig.yArtboardAnchorPredefined || 'center',
        yArtboardAnchorDefine: set.batchConfig.yArtboardAnchorDefine ?? 0,
        // Add grid distribution defaults if they don't exist
        gridStartX: set.batchConfig.gridStartX ?? 0,
        gridStartY: set.batchConfig.gridStartY ?? 0,
        // Migrate legacy position modulation (boolean+value → mode enum)
        xPositionModulationMode: set.batchConfig.xPositionModulationMode || 
          ((set.batchConfig as any).xPositionModulationEnabled && (set.batchConfig as any).xPositionModulationValue > 0 
            ? 'pixel-value' 
            : 'off'),
        yPositionModulationMode: set.batchConfig.yPositionModulationMode || 
          ((set.batchConfig as any).yPositionModulationEnabled && (set.batchConfig as any).yPositionModulationValue > 0 
            ? 'pixel-value' 
            : 'off'),
        // Ensure shape property flags default to true for dimension/position control
        // Fix for fit-to-bleed: old saved sets may not have these flags, causing shapes to use random dimensions
        shapePropertiesDimensionsEnabled: set.batchConfig.shapePropertiesDimensionsEnabled ?? true,
        shapePropertiesPositionEnabled: set.batchConfig.shapePropertiesPositionEnabled ?? true,
      } : set.batchConfig;

      return {
        ...set,
        batchConfig: migratedBatchConfig,
        // Add new set-level properties with defaults if they don't exist
        setVisibility: set.setVisibility || {
          visible: true,
          opacity: 1.0,
          opacityVariance: 0.0
        },
        setBlendMode: set.setBlendMode || 'source-over',
        compositingOperation: set.compositingOperation || 'source-over',
        setTransform: set.setTransform || {
          x: 0,
          y: 0,
          rotation: 0,
          scaleX: 1.0,
          scaleY: 1.0,
          transformOrigin: 'center'
        },
        artboardAlignment: set.artboardAlignment || {
          fitToArtboard: false,
          alignTo: 'none',
          alignmentType: 'center',
          margin: 0
        }
      };
    });
  }, []);

  // Sync persisted data to local state when loaded
  useEffect(() => {
    // Skip reload if we're in the middle of saving (prevents Apply button reload loop)
    if (isSavingRef.current) {
      console.log('⏭️ [RELOAD] Skipped - Currently saving, local state is already updated');
      return;
    }
    
    if (isPersistenceReady && persistedGenerationSets) {
      const migratedSets = migrateGenerationSets(persistedGenerationSets);
      setGenerationSets(migratedSets);
      setCurrentGenerationSetId(persistedCurrentSetId);
      setIsInitialLoadComplete(true);
      console.log('Loaded generation sets from persistence:', migratedSets.length, 'sets');
    }
  }, [isPersistenceReady, persistedGenerationSets, persistedCurrentSetId, migrateGenerationSets]);

  // Keep keyed overlay state aligned with the current set collection. Entries
  // for deleted sets must not survive a replace/import operation.
  useEffect(() => {
    if (!overlayLoadedRef.current || generationSets.length === 0) return;
    const valid = new Set(generationSets.map(set => set.id));
    setOverlayManagerState(prev => {
      const debugGridSets = Object.fromEntries(
        Object.entries(prev.debugGrid?.sets ?? {}).filter(([id]) => valid.has(id)),
      );
      const ctpProperties = Object.fromEntries(
        Object.entries(prev.ctpProperties ?? {}).filter(([key]) => valid.has(key.split(':', 1)[0])),
      );
      if (Object.keys(debugGridSets).length === Object.keys(prev.debugGrid?.sets ?? {}).length &&
          Object.keys(ctpProperties).length === Object.keys(prev.ctpProperties ?? {}).length) return prev;
      return { ...prev, debugGrid: { ...(prev.debugGrid ?? { sets: {} }), sets: debugGridSets }, ctpProperties };
    });
  }, [generationSets]);

  // Auto-save when generation sets or current set changes (only after initial load)
  // DISABLED when shape sets are enabled - Apply button is the only save mechanism
  useEffect(() => {
    // Wait for initial hydration before checking exportSettings
    // This ensures we have the accurate value, not defaults
    if (!hasRestoredInitialUI.current) {
      console.log('⏭️ [AUTO-SAVE] Skipped - Waiting for initial hydration');
      return;
    }
    
    // Skip auto-save when shape sets feature is enabled - user must use Apply button
    if (exportSettings.generationSetsEnabled) {
      console.log('⏭️ [AUTO-SAVE] Skipped - Shape sets enabled, use Apply button to save');
      return;
    }
    
    if (isPersistenceReady && isInitialLoadComplete) {
      // Deep comparison for arrays and simple comparison for primitives
      const setsChanged = generationSets.length !== persistedGenerationSets.length ||
                         JSON.stringify(generationSets) !== JSON.stringify(persistedGenerationSets);
      const currentSetChanged = currentGenerationSetId !== persistedCurrentSetId;
      
      if (setsChanged || currentSetChanged) {
        // Debounce saves to avoid excessive API calls
        const timeoutId = setTimeout(() => {
          console.log('Auto-saving generation sets:', generationSets.length, 'sets');
          saveGenerationSets(generationSets, currentGenerationSetId)
            .catch(error => console.error('Failed to auto-save generation sets:', error));
        }, 1000);
        
        return () => clearTimeout(timeoutId);
      }
    }
  }, [generationSets, currentGenerationSetId, saveGenerationSets, isPersistenceReady, isInitialLoadComplete, persistedGenerationSets, persistedCurrentSetId, exportSettings.generationSetsEnabled]);
  
  // Restore UI state for the current set after initial load
  useEffect(() => {
    // Guard: only run once on initial load when all conditions are met
    if (!hasRestoredInitialUI.current && 
        isInitialLoadComplete && 
        currentGenerationSetId && 
        generationSets.length > 0) {
      // Verify the current set exists in the loaded sets
      const hasSet = generationSets.some(s => s.id === currentGenerationSetId);
      if (hasSet) {
        console.log('🔄 [INITIAL LOAD] Restoring UI state for current set:', currentGenerationSetId);
        restoreUIStateFromSet(currentGenerationSetId);
        hasRestoredInitialUI.current = true; // Mark as restored to prevent re-runs
      }
    }
  }, [isInitialLoadComplete, currentGenerationSetId, generationSets]); // restoreUIStateFromSet is stable (useCallback), omitted per exhaustive-deps
  
  const [batchExportCount, setBatchExportCount] = useState(1);
  const [generationCountMode, setGenerationCountMode] = useState<'fixed' | 'range'>('fixed');
  
  // Global repetition settings
  const [globalRepetitionMode, setGlobalRepetitionMode] = useState<'fixed' | 'range'>('fixed');
  const [globalRepetitionValue, setGlobalRepetitionValue] = useState<number>(0);
  const [globalRepetitionRange, setGlobalRepetitionRange] = useState<[number, number]>([0, 0]);
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragState, setDragState] = useState<{
    startScreenX: number;
    startScreenY: number;
    lastScreenX: number;
    lastScreenY: number;
    totalDeltaX: number;
    totalDeltaY: number;
  } | null>(null);
  const [touchStartTime, setTouchStartTime] = useState<number>(0);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isPanMode, setIsPanMode] = useState(false);
  const [editMode, setEditMode] = useState<'shapes' | 'points' | 'segments'>('shapes');
  const [selectedPoints, setSelectedPoints] = useState<{ shapeId: string; pointIndex: number }[]>([]);
  const [selectedSegments, setSelectedSegments] = useState<{ shapeId: string; segmentIndex: number }[]>([]);
  
  // UI element visibility toggles (persisted to appSettingsDefaults)
  const [showMultiSelectButton, setShowMultiSelectButton] = useState<boolean>(true);
  const [showSelectedCount, setShowSelectedCount] = useState<boolean>(true);
  const [marqueeStart, setMarqueeStart] = useState<{ x: number; y: number } | null>(null);
  const [marqueeEnd, setMarqueeEnd] = useState<{ x: number; y: number } | null>(null);
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false);

  // Sets Manager Dialog state
  const [isSetsManagerOpen, setIsSetsManagerOpen] = useState(false);

  // Track incremental index for continuous incremental positioning
  const [lastIncrementalIndex, setLastIncrementalIndex] = useState(0);

  // Multi-touch gesture state
  const [isMultiTouch, setIsMultiTouch] = useState(false);

  // Use refs for immediate access to gesture data
  const gestureDataRef = useRef({
    isActive: false,
    initialDistance: 0,
    initialAngle: 0,
    initialScale: 1,
    initialRotation: 0
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Touch device detection
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  
  // Track if we've restored settings to prevent re-restoration loops
  const hasRestoredSettings = useRef(false);

  // Synchronize selectedShapes and selectedGroups with shape.selected flags
  useEffect(() => {
    const currentSelectedShapes = shapes.filter(shape => shape.selected);
    const currentSelectedGroups = groups.filter(group => group.selected);

    if (currentSelectedShapes.length !== selectedShapes.length || 
        !currentSelectedShapes.every(shape => selectedShapes.includes(shape))) {
      setSelectedShapes(currentSelectedShapes);
    }

    if (currentSelectedGroups.length !== selectedGroups.length || 
        !currentSelectedGroups.every(group => selectedGroups.includes(group))) {
      setSelectedGroups(currentSelectedGroups);
    }
  }, [shapes, groups, selectedShapes, selectedGroups]);


  const updateCanvasSettings = useCallback((updates: Partial<CanvasSettings>) => {
    setCanvasSettings(prev => ({ ...prev, ...updates }));
  }, []);

  // Restore canvas and artboard settings from appSettingsDefaults when it loads (once only)
  useEffect(() => {
    if (appSettingsDefaults && !hasRestoredSettings.current) {
      console.log('🔄 Restoring app settings from user preferences');
      hasRestoredSettings.current = true;
      
      // Restore canvas pan/zoom
      setCanvasSettings(prev => ({
        ...prev,
        panX: appSettingsDefaults.canvasPanX ?? prev.panX,
        panY: appSettingsDefaults.canvasPanY ?? prev.panY,
        zoom: appSettingsDefaults.canvasZoom ?? prev.zoom,
      }));
      
      // Check if we have savedArtboards (new multi-artboard persistence)
      if (appSettingsDefaults.savedArtboards && appSettingsDefaults.savedArtboards.length > 0) {
        console.log(`🔄 Restoring ${appSettingsDefaults.savedArtboards.length} saved artboards`);
        
        // Restore all artboards with dimension validation
        const restoredArtboards: Artboard[] = appSettingsDefaults.savedArtboards.map(savedAb => {
          const validatedDims = validateArtboardDimensions(savedAb.name, savedAb.width, savedAb.height, savedAb.dpi);
          
          if (validatedDims.corrected) {
            console.log(`🔧 Auto-correcting artboard dimensions for "${savedAb.name}": ${savedAb.width}×${savedAb.height} → ${validatedDims.width}×${validatedDims.height} at ${savedAb.dpi} DPI`);
          }
          
          return {
            id: savedAb.id,
            name: savedAb.name,
            x: savedAb.x ?? 0,
            y: savedAb.y ?? 0,
            width: validatedDims.width,
            height: validatedDims.height,
            dpi: savedAb.dpi,
            unitType: savedAb.unitType,
            backgroundColor: savedAb.backgroundColor,
            gridColor: savedAb.gridColor,
            displayGrid: savedAb.displayGrid,
            displayBorder: savedAb.displayBorder,
            displayName: savedAb.displayName ?? true,
            displayDimensions: savedAb.displayDimensions ?? false,
            displayResolution: savedAb.displayResolution ?? false,
            preset: savedAb.preset,
            category: savedAb.category,
            linkedDimensions: savedAb.linkedDimensions,
            aspectRatio: savedAb.aspectRatio,
            printConfig: getEffectivePrintConfig({
              dpi: savedAb.dpi,
              unitType: savedAb.unitType,
              backgroundColor: savedAb.backgroundColor,
              printConfig: savedAb.printConfig,
            }),
          };
        });
        
        setArtboards(restoredArtboards);
        
        // Restore active artboard ID
        if (appSettingsDefaults.activeArtboardId && restoredArtboards.some(ab => ab.id === appSettingsDefaults.activeArtboardId)) {
          setActiveArtboard(appSettingsDefaults.activeArtboardId);
        } else if (restoredArtboards.length > 0) {
          setActiveArtboard(restoredArtboards[0].id);
        }
      } else {
        // Legacy: Single artboard from old settings
        console.log('🔄 Restoring from legacy single-artboard settings');
        
        // Build print configuration from saved settings
        const restoredPrintConfig: PrintConfig = {
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
            background: {
              ...DEFAULT_PRINT_CONFIG.overlays.background,
              mode: appSettingsDefaults.printBackgroundMode ?? DEFAULT_PRINT_CONFIG.overlays.background.mode,
              customColor: appSettingsDefaults.printBackgroundCustomColor ?? DEFAULT_PRINT_CONFIG.overlays.background.customColor,
              display: appSettingsDefaults.printBackgroundDisplay ?? DEFAULT_PRINT_CONFIG.overlays.background.display,
              render: appSettingsDefaults.printBackgroundRender ?? DEFAULT_PRINT_CONFIG.overlays.background.render,
            },
          },
        };
        
        // Validate and auto-correct artboard dimensions based on preset name
        const artboardName = appSettingsDefaults.artboardName ?? 'Artboard 1';
        const storedWidth = appSettingsDefaults.artboardWidth ?? 800;
        const storedHeight = appSettingsDefaults.artboardHeight ?? 600;
        const dpi = appSettingsDefaults.artboardDpi ?? 72;
        
        const validatedDims = validateArtboardDimensions(artboardName, storedWidth, storedHeight, dpi);
        
        if (validatedDims.corrected) {
          console.log(`🔧 Auto-correcting artboard dimensions for "${artboardName}": ${storedWidth}×${storedHeight} → ${validatedDims.width}×${validatedDims.height} at ${dpi} DPI`);
        }
        
        // Restore active artboard settings including print configuration
        setArtboards(prev => prev.map(ab => 
          ab.id === activeArtboard ? {
            ...ab,
            name: artboardName,
            width: validatedDims.width,
            height: validatedDims.height,
            dpi: dpi,
            unitType: appSettingsDefaults.artboardUnitType ?? ab.unitType ?? 'pixels',
            backgroundColor: appSettingsDefaults.artboardBackgroundColor ?? ab.backgroundColor,
            displayGrid: appSettingsDefaults.artboardDisplayGrid ?? ab.displayGrid,
            displayBorder: appSettingsDefaults.artboardDisplayBorder ?? ab.displayBorder,
            displayName: appSettingsDefaults.artboardDisplayName ?? ab.displayName ?? true,
            displayDimensions: appSettingsDefaults.artboardDisplayDimensions ?? ab.displayDimensions ?? false,
            displayResolution: appSettingsDefaults.artboardDisplayResolution ?? ab.displayResolution ?? false,
            printConfig: restoredPrintConfig,
          } : ab
        ));
      }
      
      // Restore UI visibility settings
      if (appSettingsDefaults.showMultiSelectButton !== undefined) {
        setShowMultiSelectButton(appSettingsDefaults.showMultiSelectButton);
      }
      if (appSettingsDefaults.showSelectedCount !== undefined) {
        setShowSelectedCount(appSettingsDefaults.showSelectedCount);
      }
    }
  }, [appSettingsDefaults, activeArtboard]); // Re-run when appSettingsDefaults loads

  // Save canvas settings when they change (debounced)
  useEffect(() => {
    if (!appSettingsDefaults || !hasRestoredSettings.current) return;
    
    const activeAb = artboards.find(ab => ab.id === activeArtboard);
    if (!activeAb) return;
    
    // Use debounced save to batch with other setting updates
    debouncedSaveAppSettings({
      canvasPanX: canvasSettings.panX,
      canvasPanY: canvasSettings.panY,
      canvasZoom: canvasSettings.zoom,
    });
  }, [canvasSettings.panX, canvasSettings.panY, canvasSettings.zoom, debouncedSaveAppSettings]);

  // Save all artboards when artboards or active artboard changes (debounced)
  // This includes print configuration as it's part of artboard settings
  useEffect(() => {
    if (!appSettingsDefaults || !hasRestoredSettings.current) return;
    
    const activeAb = artboards.find(ab => ab.id === activeArtboard);
    if (!activeAb) return;
    
    const printConfig = activeAb.printConfig || DEFAULT_PRINT_CONFIG;
    
    // Convert artboards to savedArtboards format for persistence
    const savedArtboards = artboards.map(ab => ({
      id: ab.id,
      name: ab.name,
      x: ab.x ?? 0,
      y: ab.y ?? 0,
      width: ab.width,
      height: ab.height,
      dpi: ab.dpi ?? 72,
      unitType: ab.unitType ?? 'pixels' as const,
      backgroundColor: ab.backgroundColor ?? '#ffffff',
      gridColor: ab.gridColor,
      displayGrid: ab.displayGrid ?? false,
      displayBorder: ab.displayBorder ?? true,
      displayName: ab.displayName ?? true,
      displayDimensions: ab.displayDimensions ?? false,
      displayResolution: ab.displayResolution ?? false,
      preset: ab.preset,
      category: ab.category,
      linkedDimensions: ab.linkedDimensions,
      aspectRatio: ab.aspectRatio,
      printConfig: getEffectivePrintConfig(ab),
    }));
    
    // Use debounced save to batch with other setting updates
    debouncedSaveAppSettings({
      // New multi-artboard persistence
      savedArtboards,
      activeArtboardId: activeArtboard,
      // Legacy fields (for backward compatibility)
      artboardName: activeAb.name,
      artboardWidth: activeAb.width,
      artboardHeight: activeAb.height,
      artboardDpi: activeAb.dpi ?? 72,
      artboardUnitType: activeAb.unitType ?? 'pixels',
      artboardBackgroundColor: activeAb.backgroundColor ?? '#ffffff',
      artboardGridColor: activeAb.gridColor ?? '#cccccc',
      artboardDisplayGrid: activeAb.displayGrid ?? false,
      artboardDisplayBorder: activeAb.displayBorder ?? true,
      artboardDisplayName: activeAb.displayName ?? true,
      artboardDisplayDimensions: activeAb.displayDimensions ?? false,
      artboardDisplayResolution: activeAb.displayResolution ?? false,
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
      printMarksScaleMode: printConfig.overlays.printMarks.scaleMode,
      printMarksColor: printConfig.overlays.printMarks.color,
      printBackgroundMode: printConfig.overlays.background.mode,
      printBackgroundCustomColor: printConfig.overlays.background.customColor,
      printBackgroundDisplay: printConfig.overlays.background.display,
      printBackgroundRender: printConfig.overlays.background.render,
    });
  }, [artboards, activeArtboard, debouncedSaveAppSettings]);

  // Save UI visibility settings when they change (debounced)
  useEffect(() => {
    if (!appSettingsDefaults || !hasRestoredSettings.current) return;
    
    // Use debounced save to batch with other setting updates
    debouncedSaveAppSettings({
      showMultiSelectButton,
      showSelectedCount,
    });
  }, [showMultiSelectButton, showSelectedCount, debouncedSaveAppSettings]);

  const updateScatterSettings = useCallback((updates: Partial<ScatterSettings>) => {
    setScatterSettings(prev => ({ ...prev, ...updates }));
  }, []);

  // Capture current UI state for comparison and saving
  const captureCurrentState = useCallback((): CurrentUIState => {
    return {
      enabledShapeTypes,
      scatterSettings,
      batchConfigSettings: generationConfigSettings,
      shapeCountMode: scatterSettings.shapeCountMode as ShapeCountMode,
      shapeCountFixed: scatterSettings.fixedShapeCount,
      shapeCountRange: [scatterSettings.minCount, scatterSettings.maxCount] as [number, number]
    };
  }, [enabledShapeTypes, scatterSettings, generationConfigSettings]);

  // Partial update function - allows updating specific portions of a generation set
  const updateGenerationSetPartial = useCallback(async (
    setId: string,
    partialUpdate: Partial<GenerationSet>
  ): Promise<void> => {
    const setIndex = generationSets.findIndex(set => set.id === setId);
    if (setIndex === -1) {
      console.warn('⚠️ [PARTIAL UPDATE] Set not found:', setId);
      return;
    }

    const existingSet = generationSets[setIndex];
    console.log('💾 [PARTIAL UPDATE] Updating set:', existingSet.name, 'with:', Object.keys(partialUpdate));
    
    const updatedSets = [...generationSets];
    updatedSets[setIndex] = {
      ...existingSet,
      ...partialUpdate
    };
    
    // Update local state immediately
    setGenerationSets(updatedSets);
    
    // Persist to database (in background, without triggering reload)
    if (isPersistenceReady) {
      isSavingRef.current = true;
      try {
        await saveGenerationSets(updatedSets, currentGenerationSetId);
        console.log('✅ [PARTIAL UPDATE] Successfully saved changes to set:', existingSet.name);
      } finally {
        // Clear saving flag after a short delay to ensure cache update is processed
        setTimeout(() => {
          isSavingRef.current = false;
        }, 100);
      }
    }
  }, [generationSets, currentGenerationSetId, isPersistenceReady, saveGenerationSets]);

  // Apply current UI state to a specific generation set with visual feedback
  // DEPRECATED: Use updateGenerationSetPartial for section-specific updates
  const applyCurrentUIStateToSet = useCallback(async (
    setId: string,
    uiState: CurrentUIState
  ): Promise<void> => {
    const setIndex = generationSets.findIndex(set => set.id === setId);
    if (setIndex === -1) {
      console.warn('⚠️ [APPLY] Set not found:', setId);
      return;
    }

    const existingSet = generationSets[setIndex];
    console.log('💾 [APPLY] Applying UI state to set:', existingSet.name, 'ID:', setId);
    
    const updatedSets = [...generationSets];
    //
    // SNAPSHOT FIELDS (written here on every "Apply to Current Set"):
    //   enabledShapeTypes, shapeCountMode, shapeCountFixed, shapeCountRange,
    //   shapeSpecificProperties (per-shape curve/size settings), batchConfig.
    //
    // LIVE-ONLY FIELDS (managed exclusively by updateGenerationSetPartial,
    //   NOT touched here — preserved intact via the ...existingSet spread):
    //   shapeTypeGenMode, shapeTypeWeights, shapeTypeFixedCounts, shapeTypeSequence.
    //   These fields are written directly to the set record whenever the user
    //   changes the gen-control UI, so they are always current and must never
    //   be overwritten or reset to undefined by this snapshot path.
    //
    updatedSets[setIndex] = {
      ...existingSet,
      // --- snapshotted fields ---
      enabledShapeTypes: Array.from(uiState.enabledShapeTypes) as SupportedShapeType[],
      shapeCountMode: uiState.shapeCountMode,
      shapeCountFixed: uiState.shapeCountFixed,
      shapeCountRange: uiState.shapeCountRange,
      shapeSpecificProperties: {
        ...Object.fromEntries(
          Object.entries(uiState.scatterSettings.shapeSpecific || {}).map(([shapeType, settings]) => [
            shapeType,
            settings
          ])
        )
      },
      batchConfig: { ...uiState.batchConfigSettings }
      // shapeTypeGenMode, shapeTypeWeights, shapeTypeFixedCounts, shapeTypeSequence
      // are intentionally omitted — they come through from ...existingSet above.
    };
    
    setGenerationSets(updatedSets);
    
    // Persist to database
    if (isPersistenceReady) {
      await saveGenerationSets(updatedSets, currentGenerationSetId);
      console.log('✅ [APPLY] Successfully saved changes to set:', existingSet.name);
    }
  }, [generationSets, currentGenerationSetId, isPersistenceReady, saveGenerationSets]);

  // Check if there are unsaved changes - with explicit Apply button, changes are always saved manually
  const hasUnsavedChanges = useCallback((setId: string | null): boolean => {
    // With explicit Apply button, we don't track unsaved changes automatically
    return false;
  }, []);

  // UI state restoration from generation set
  const restoreUIStateFromSet = useCallback((setId: string) => {
    const set = generationSets.find(s => s.id === setId);
    if (!set) {
      console.warn('🔄 [SET RESTORE] Set not found:', setId);
      return;
    }

    console.log('🔄 [SET RESTORE] Restoring UI state from set:', set.name, 'ID:', setId);
    
    // Set restoring flag to prevent manual change tracking during restore
    setIsRestoring(true);
    console.log('🔄 [SET RESTORE] Shape types:', set.enabledShapeTypes);
    console.log('🔄 [SET RESTORE] Count mode:', set.shapeCountMode, 'Fixed:', set.shapeCountFixed, 'Range:', set.shapeCountRange);
    console.log('🔄 [SET RESTORE] Saved shapeSpecific properties:', set.shapeSpecificProperties);

    // Convert SupportedShapeType back to ShapeType Set
    const newShapeTypes = new Set(set.enabledShapeTypes as ShapeType[]);
    setEnabledShapeTypes(newShapeTypes);
    console.log('🔄 [SET RESTORE] Updated shape types to:', Array.from(newShapeTypes));
    
    // Restore scatter settings with proper shape count properties
    // Prioritize saved values over current state by spreading saved properties last
    const restoredScatterSettings: ScatterSettings = {
      ...scatterSettings,
      shapeCountMode: set.shapeCountMode,
      fixedShapeCount: set.shapeCountFixed,
      count: set.shapeCountMode === 'fixed' ? set.shapeCountFixed : Math.floor((set.shapeCountRange[0] + set.shapeCountRange[1]) / 2),
      minCount: set.shapeCountRange[0],
      maxCount: set.shapeCountRange[1],
      // Saved shapeSpecific properties override current state completely
      shapeSpecific: set.shapeSpecificProperties ? { ...(set.shapeSpecificProperties as any) } : scatterSettings.shapeSpecific
    };
    setScatterSettings(restoredScatterSettings);
    console.log('🔄 [SET RESTORE] Updated scatter settings:', restoredScatterSettings.shapeCountMode, restoredScatterSettings.count);
    console.log('🔄 [SET RESTORE] Restored shapeSpecific:', restoredScatterSettings.shapeSpecific);
    
    // Restore batch config settings
    setGenerationConfigSettings(set.batchConfig);
    console.log('🔄 [SET RESTORE] Updated generation config settings');
    
    // Clear restoring flag
    setIsRestoring(false);
    console.log('🔄 [SET RESTORE] Cleared restoring flag');
    
    console.log('🔄 [SET RESTORE] ✅ Successfully restored UI state from set:', set.name);
  }, [generationSets, scatterSettings]);

  // Generation Sets handlers for bi-directional synchronization
  const handleGenerationSetsChange = useCallback((sets: GenerationSet[]) => {
    setGenerationSets(sets);
  }, []);

  const handleCurrentGenerationSetChange = useCallback((setId: string | null) => {
    console.log('🔄 [SET SWITCH] Attempting to switch to set:', setId);
    console.log('🔄 [SET SWITCH] Current set ID:', currentGenerationSetId);
    
    console.log('🔄 [SET SWITCH] ✅ Proceeding with set switch to:', setId);
    setCurrentGenerationSetId(setId);
    
    // Restore UI state if a set is selected
    if (setId) {
      console.log('🔄 [SET SWITCH] Restoring UI state for set:', setId);
      restoreUIStateFromSet(setId);
    }
  }, [currentGenerationSetId, restoreUIStateFromSet]);

  /**
   * Atomically load generator state (sets + current-set ID) and restore UI from
   * the provided set data.  Avoids the stale-closure race that occurs when
   * onGenerationSetsChange and onCurrentGenerationSetChange are called sequentially:
   * restoreUIStateFromSet reads the closed-over generationSets which hasn't
   * committed yet, so the active set can't be found and the restore silently fails.
   *
   * Also explicitly persists the loaded sets so the configuration survives a
   * page reload even when generationSetsEnabled is true (which disables auto-save).
   */
  const handleImportedConfigurationState = useCallback(async (next: ImportedConfigurationState) => {
    const importedCurrentSet = next.currentSetId
      ? next.generationSets.find(s => s.id === next.currentSetId)
      : undefined;
    if (next.currentSetId && !importedCurrentSet) {
      throw new Error(`Imported current set "${next.currentSetId}" was not found.`);
    }
    if (!next.artboards.some(board => board.id === next.activeArtboardId)) {
      throw new Error(`Imported active artboard "${next.activeArtboardId}" was not found.`);
    }
    if (!isPersistenceReady) throw new Error('Configuration persistence is not ready.');
    const canceledWrites = cancelPendingPreferenceWrites();
    const pendingAppSettings = canceledWrites.pendingAppSettings;
    const pendingOverlayState = canceledWrites.pendingOverlayState;
    const previousAppSettingsDefaults = appSettingsDefaults
      ? { ...appSettingsDefaults, ...(pendingAppSettings ?? {}) }
      : appSettingsDefaults;
    const previous = {
      generationSets,
      currentSetId: currentGenerationSetId,
      artboards,
      activeArtboardId: activeArtboard,
      scatterSettings,
      generationConfigSettings,
      enabledShapeTypes,
      appSettingsDefaults: previousAppSettingsDefaults,
      overlayManagerState: pendingOverlayState ?? overlayManagerState,
    };
    const serializeArtboards = (boards: typeof artboards) => boards.map(ab => ({
      id: ab.id, name: ab.name, x: ab.x ?? 0, y: ab.y ?? 0,
      width: ab.width, height: ab.height, dpi: ab.dpi ?? 72,
      unitType: ab.unitType ?? 'pixels', backgroundColor: ab.backgroundColor ?? '#ffffff',
      gridColor: ab.gridColor, displayGrid: ab.displayGrid ?? false,
      displayBorder: ab.displayBorder ?? true, displayName: ab.displayName ?? true,
      displayDimensions: ab.displayDimensions ?? false, displayResolution: ab.displayResolution ?? false,
      preset: ab.preset, category: ab.category, linkedDimensions: ab.linkedDimensions,
      aspectRatio: ab.aspectRatio, printConfig: getEffectivePrintConfig(ab),
    }));
    const appPayload = (defaults: typeof appSettingsDefaults, boards: typeof artboards, activeId: string) => {
      const active = boards.find(board => board.id === activeId) ?? boards[0];
      if (!defaults || !active) throw new Error('Configuration persistence requires an active artboard.');
      return {
        ...defaults, savedArtboards: serializeArtboards(boards), activeArtboardId: active.id,
        artboardName: active.name, artboardWidth: active.width, artboardHeight: active.height,
        artboardDpi: active.dpi ?? 72, artboardUnitType: active.unitType ?? 'pixels',
        artboardBackgroundColor: active.backgroundColor ?? '#ffffff',
        artboardGridColor: active.gridColor ?? '#cccccc',
      };
    };
    // A user edit queued immediately before the import is newer than the file
    // snapshot and must not be discarded when its debounce is cancelled.
    const nextOverlay = pendingOverlayState ?? next.overlayManagerState ?? overlayManagerState;
    // Auto-save is skipped when generationSetsEnabled is true, so we must persist
    // directly here to ensure the configuration survives a page reload.
    const restoreRuntime = () => {
      setGenerationSets(previous.generationSets);
      setCurrentGenerationSetId(previous.currentSetId);
      setArtboards(previous.artboards);
      setActiveArtboard(previous.activeArtboardId);
      setScatterSettings(previous.scatterSettings);
      setGenerationConfigSettings(previous.generationConfigSettings);
      setEnabledShapeTypes(previous.enabledShapeTypes);
      setOverlayManagerState(previous.overlayManagerState);
      setIsRestoring(false);
    };
    const commitRuntime = () => {
      setGenerationSets(next.generationSets);
      setCurrentGenerationSetId(next.currentSetId);
      setArtboards(next.artboards);
      setActiveArtboard(next.activeArtboardId);
      setOverlayManagerState(nextOverlay);
      if (next.currentSetId) {
        const set = importedCurrentSet!;
        setIsRestoring(true);
        setEnabledShapeTypes(new Set(set.enabledShapeTypes as ShapeType[]));
        setScatterSettings(prev => ({
          ...prev, shapeCountMode: set.shapeCountMode, fixedShapeCount: set.shapeCountFixed,
          count: set.shapeCountMode === 'fixed' ? set.shapeCountFixed : Math.floor((set.shapeCountRange[0] + set.shapeCountRange[1]) / 2),
          minCount: set.shapeCountRange[0], maxCount: set.shapeCountRange[1],
          shapeSpecific: set.shapeSpecificProperties ? { ...(set.shapeSpecificProperties as any) } : prev.shapeSpecific,
        }));
        setGenerationConfigSettings(set.batchConfig);
      }
      setIsRestoring(false);
    };
    await persistImportedConfiguration({
      steps: [
        {
          saveNext: () => saveGenerationSets(next.generationSets, next.currentSetId),
          restorePrevious: () => saveGenerationSets(previous.generationSets, previous.currentSetId),
        },
        {
          saveNext: () => saveAppSettings.mutateAsync(appPayload(previousAppSettingsDefaults, next.artboards, next.activeArtboardId)).then(() => undefined),
          restorePrevious: () => previous.appSettingsDefaults
            ? saveAppSettings.mutateAsync(appPayload(previous.appSettingsDefaults, previous.artboards, previous.activeArtboardId)).then(() => undefined)
            : Promise.resolve(),
        },
        {
          saveNext: () => saveOverlayManagerState.mutateAsync(nextOverlay).then(() => undefined),
          restorePrevious: () => saveOverlayManagerState.mutateAsync(previous.overlayManagerState).then(() => undefined),
        },
      ],
      commitRuntime,
      restoreRuntime,
    });
  }, [
    generationSets,
    currentGenerationSetId,
    artboards,
    activeArtboard,
    scatterSettings,
    generationConfigSettings,
    enabledShapeTypes,
    appSettingsDefaults,
    overlayManagerState,
    isPersistenceReady,
    saveGenerationSets,
    saveAppSettings,
    saveOverlayManagerState,
    cancelPendingPreferenceWrites,
  ]); // Stable state-setters omitted per deps rules

  const handleBatchExportCountChange = useCallback((count: number) => {
    setBatchExportCount(count);
  }, []);

  const handleGenerationCountModeChange = useCallback((mode: 'fixed' | 'range') => {
    setGenerationCountMode(mode);
  }, []);

  // Generate unique set name with auto-increment using shared utility
  const generateUniqueSetName = useCallback((baseName?: string): string => {
    const existingNames = generationSets.map(set => set.name);
    return generateUniqueName(existingNames, baseName);
  }, [generationSets]);

  // Create a new generation set with current UI state
  const handleCreateGenerationSet = useCallback((customName?: string, currentUIState?: CurrentUIState) => {
    console.log('📝 [CREATE SET] Starting set creation with name:', customName);
    
    // Generate unique name if none provided
    const setName = customName || generateUniqueSetName();
    
    // STEP 3: Use currentUIState if provided (duplicate mode), otherwise use clean defaults
    const isDuplicate = currentUIState !== undefined;
    const uiState = isDuplicate ? currentUIState : {
      enabledShapeTypes: new Set<ShapeType>(['rectangle', 'rounded-rectangle', 'square', 'rounded-square', 'circle', 'polygon']),
      scatterSettings: {
        onPoints: false,
        insideArea: false,
        count: 5,
        minCount: 1,
        maxCount: 20,
        randomness: 0.5,
        shapeCountMode: 'fixed' as const,
        fixedShapeCount: 5,
        distribution: {
          pattern: 'random',
          spacing: 50,
          randomness: 0.3,
          rotation: 0,
          scale: 1,
          density: 0.5,
          avoidOverlap: false,
          respectBounds: true
        },
        shapeSpecific: {
          polygon: { edgeCountRange: [3, 20] },
          circle: { segmentCountRange: [16, 32] },
          ellipse: { segmentCountRange: [16, 32] },
          bezier: {
            pointCountRange: [3, 6],
            openProbability: 50,
            strokeCapProbabilities: { round: 33, square: 33, butt: 34 },
            curvatureRange: [0.2, 0.8],
            patternType: 1,
            curveLengthRange: [80, 200],
            curveLengthMode: 'range'
          },
          cubic: {
            pointCountRange: [3, 8],
            openProbability: 90,
            strokeCapProbabilities: { round: 33, square: 33, butt: 34 },
            curvatureRange: [0.2, 0.8],
            patternType: 2,
            closeAverageProbability: 0,
            curveTension: 30,
            curveTensionMode: 'fixed',
            curveTensionValue: 30,
            curveTensionRange: [20, 50],
            endpointContinuous: false,
            jitterAlongNormal: false,
            jitterDirection: 'both'
          },
          'smooth-spline': {
            pointCountRange: [3, 6],
            openProbability: 50,
            strokeCapProbabilities: { round: 33, square: 33, butt: 34 },
            curvatureRange: [0.2, 0.8],
            patternType: 1
          },
          star: { pointCountRange: [5, 8], innerRadiusRange: [0.3, 0.7] },
          ring: { innerRadiusRange: [0.2, 0.8] },
          'spline-ring': { innerRadiusRange: [0.2, 0.8], segmentCountRange: [16, 32] },
          line: {
            pointCountRange: [2, 4],
            strokeCapProbabilities: { round: 33, square: 33, butt: 34 }
          },
          'line-vector': {
            direction: { kind: 'range' as const, min: 0, max: 360 },
            length: { kind: 'range' as const, min: 5, max: 500 },
            centroid: { kind: 'fixed' as const, value: 0.5 },
            strokeCapProbabilities: { round: 33, square: 33, butt: 34 }
          },
          rectangle: {},
          'rounded-rectangle': {
            cornerRadiusRange: [0, 10],
            cornerRadiusMode: 'range',
            cornerRadiusValue: 5
          },
          square: {},
          'rounded-square': {
            cornerRadiusRange: [0, 10],
            cornerRadiusMode: 'range',
            cornerRadiusValue: 5
          }
        }
      } as ScatterSettings,
      batchConfig: defaultBatchConfigSettings,
      shapeCountMode: 'fixed' as const,
      shapeCountFixed: 5,
      shapeCountRange: [1, 20] as [number, number]
    };
    
    console.log('📋 [CREATE SET] Captured UI state:', {
      shapeTypes: Array.from(uiState.enabledShapeTypes),
      countMode: uiState.shapeCountMode,
      countFixed: uiState.shapeCountFixed,
      countRange: uiState.shapeCountRange
    });
    
    // STEP 4: Create new generation set with proper types
    const newSetId = `set-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newSet: GenerationSet = {
      id: newSetId,
      name: setName,
      enabled: true,
      enabledShapeTypes: Array.from(uiState.enabledShapeTypes || enabledShapeTypes) as SupportedShapeType[],
      shapeCountMode: (uiState.shapeCountMode === 'fixed' ? ShapeCountMode.FIXED : ShapeCountMode.RANGE) || 
                      (scatterSettings.shapeCountMode === 'fixed' ? ShapeCountMode.FIXED : ShapeCountMode.RANGE),
      shapeCountFixed: uiState.shapeCountFixed ?? scatterSettings.fixedShapeCount,
      shapeCountRange: uiState.shapeCountRange ?? [scatterSettings.minCount, scatterSettings.maxCount] as [number, number],
      shapeSpecificProperties: {
        // Capture current shape-specific scatter settings
        ...Object.fromEntries(
          Object.entries(uiState.scatterSettings?.shapeSpecific || scatterSettings.shapeSpecific).map(([shapeType, settings]) => [
            shapeType,
            settings
          ])
        )
      },
      zIndexConfig: {
        baseOffset: 0,
        incrementPerShape: 1,
        incrementPerGeneration: 1000
      },
      batchConfig: { ...((uiState as any).batchConfigSettings || (uiState as any).batchConfig || generationConfigSettings) },
      generationOrder: generationSets.length,
      description: `Generated from current settings on ${new Date().toLocaleString()}`,
      // New set-level features with sensible defaults
      setVisibility: {
        visible: true,
        opacity: 1.0,
        opacityVariance: 0.0
      },
      setBlendMode: 'source-over',
      compositingOperation: 'source-over',
      setTransform: {
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1.0,
        scaleY: 1.0,
        transformOrigin: 'center'
      },
      artboardAlignment: {
        fitToArtboard: false,
        fitTarget: 'none',
        fitMode: 'contain',
        alignTo: 'none',
        alignmentType: 'center',
        margin: 0
      },
      // Repetition settings (per-set defaults to use global)
      repetitionMode: 'use-global',
      repetitionValue: 0,
      repetitionRange: [0, 0],
      // Lock settings (defaults to all locks disabled/off)
      locks: {
        composite: false
      }
    };
    
    // STEP 5: Add to generation sets
    const newSets = [...generationSets, newSet];
    setGenerationSets(newSets);
    
    // STEP 6: ALWAYS auto-select the newly created set (removed conditional check)
    // This ensures the UI immediately reflects the new set and prevents confusion
    console.log('🎯 [CREATE SET] Auto-selecting new set:', newSetId);
    setCurrentGenerationSetId(newSetId);
    
    // Immediately persist to server (bypass debounce) to ensure data is saved
    if (isPersistenceReady) {
      console.log('💾 [CREATE SET] Immediately saving to server');
      saveGenerationSets(newSets, newSetId)
        .then(() => console.log('✅ [CREATE SET] Successfully saved to server'))
        .catch(error => console.error('❌ [CREATE SET] Failed to save to server:', error));
    }
    
    console.log('✅ [CREATE SET] Created and selected new set:', setName);
    return newSetId;
  }, [enabledShapeTypes, scatterSettings, generationConfigSettings, generationSets, generateUniqueSetName, isPersistenceReady, saveGenerationSets]);

  // Delete a generation set
  const handleDeleteGenerationSet = useCallback((setId: string) => {
    // Prevent deletion if this is the last remaining set
    if (generationSets.length <= 1) {
      console.warn('Cannot delete the last remaining generation set');
      return;
    }
    
    // Find the index of the set being deleted
    const deletedIndex = generationSets.findIndex(set => set.id === setId);
    
    // Guard against stale/invalid set IDs
    if (deletedIndex === -1) {
      console.warn('Cannot delete set - ID not found:', setId);
      return;
    }
    
    // Filter out the deleted set
    const newSets = generationSets.filter(set => set.id !== setId);
    setGenerationSets(newSets);
    
    // Determine new current set ID
    let newCurrentSetId = currentGenerationSetId;
    if (currentGenerationSetId === setId) {
      newCurrentSetId = null;
      // If there was a set after the deleted one, select it (same index in newSets)
      if (deletedIndex < newSets.length) {
        newCurrentSetId = newSets[deletedIndex].id;
      }
      // Otherwise, select the previous set (last set in newSets)
      else if (newSets.length > 0) {
        newCurrentSetId = newSets[newSets.length - 1].id;
      }
      setCurrentGenerationSetId(newCurrentSetId);
    }

    // Always persist deletion immediately — auto-save is skipped when shape sets are enabled
    if (isPersistenceReady) {
      saveGenerationSets(newSets, newCurrentSetId)
        .catch(error => console.error('❌ [DELETE SET] Failed to save to server:', error));
    }
  }, [generationSets, currentGenerationSetId, isPersistenceReady, saveGenerationSets]);

  // Reload generation sets from DB — resets restoration flag so UI re-applies after refetch
  const reloadGenerationSetsFromDB = useCallback(() => {
    hasRestoredInitialUI.current = false;
    queryClient.invalidateQueries({ queryKey: ['/api/user/generation-sets'] });
  }, []);

  // Handler to open the Sets Manager Dialog
  const handleOpenGenerationSetsManager = useCallback(() => {
    setIsSetsManagerOpen(true);
  }, []);

  const handleCloseGenerationSetsManager = useCallback(() => {
    setIsSetsManagerOpen(false);
  }, []);

  // Check if generation sets are enabled based on batch export settings
  const areSetsEnabled = useCallback((
    batchCount: number = batchExportCount,
    countMode: string = generationCountMode
  ): boolean => {
    return batchCount > 1 && countMode === 'fixed';
  }, [batchExportCount, generationCountMode]);

  const clearSelection = useCallback(() => {
    shapes.forEach(shape => shape.selected = false);
    groups.forEach(group => group.selected = false);
    setSelectedShapes([]);
    setSelectedGroups([]);
    setSelectedPoints([]);
    setSelectedSegments([]);
  }, [shapes, groups]);

  const selectShapeAtPoint = useCallback((x: number, y: number, addToSelection: boolean = false) => {
    // Sort shapes by z-index from highest to lowest and find first hit
    const sortedShapes = [...shapes].sort((a, b) => b.properties.zIndex - a.properties.zIndex);
    console.log(`🎯 [SELECTION] Sorting ${shapes.length} shapes by z-index for selection`);
    console.log(`🎯 [SELECTION] Original z-indices: [${shapes.map(s => s.properties.zIndex).join(', ')}]`);
    console.log(`🎯 [SELECTION] Sorted z-indices (high→low): [${sortedShapes.map(s => s.properties.zIndex).join(', ')}]`);
    let topShape: Shape | null = null;

    // Find the first (topmost) shape that contains the point
    for (const shape of sortedShapes) {
      if (shape.containsPoint(x, y)) {
        topShape = shape;
        break;
      }
    }

    if (!topShape) {
      if (!addToSelection) {
        clearSelection();
      }
      return false;
    }

    if (addToSelection) {
      topShape.selected = !topShape.selected;
    } else {
      clearSelection();
      setSelectedPoints([]);
      setSelectedSegments([]);
      topShape.selected = true;
    }

    const newSelectedShapes = shapes.filter(shape => shape.selected);
    setSelectedShapes(newSelectedShapes);
    return true;
  }, [shapes, clearSelection]);

  const selectPointAt = useCallback((x: number, y: number, addToSelection: boolean = false) => {
    // Sort shapes by z-index from highest to lowest to respect layering
    const sortedShapes = [...shapes].sort((a, b) => b.properties.zIndex - a.properties.zIndex);

    for (const shape of sortedShapes) {
      if (shape.points) {
        // Check if this shape blocks access to lower shapes
        const shapeBlocks = shape.containsPoint(x, y);

        // Check tangent handles first (for cubic curves)
        if (shape.tangentHandles) {
          for (let i = 0; i < shape.tangentHandles.length; i++) {
            // Check 'in' handle
            const worldHandleIn = shape.getWorldTangentHandle(i, 'in');
            if (worldHandleIn) {
              const distance = Math.sqrt((worldHandleIn.x - x) ** 2 + (worldHandleIn.y - y) ** 2);
              if (distance <= 6) {
                const pointId = { shapeId: shape.id, pointIndex: 2000 + i * 2 }; // Tangent handles start at 2000
                if (addToSelection) {
                  const exists = selectedPoints.some(p => p.shapeId === pointId.shapeId && p.pointIndex === pointId.pointIndex);
                  if (exists) {
                    setSelectedPoints(prev => prev.filter(p => !(p.shapeId === pointId.shapeId && p.pointIndex === pointId.pointIndex)));
                  } else {
                    const pointsFromOtherShapes = selectedPoints.filter(p => p.shapeId !== shape.id);
                    if (pointsFromOtherShapes.length > 0) {
                      setSelectedPoints(prev => prev.filter(p => p.shapeId === shape.id).concat([pointId]));
                    } else {
                      setSelectedPoints(prev => [...prev, pointId]);
                    }
                  }
                } else {
                  // Check if clicking on already selected point - if so, maintain selection for dragging
                  const isAlreadySelected = selectedPoints.some(p => p.shapeId === pointId.shapeId && p.pointIndex === pointId.pointIndex);
                  if (!isAlreadySelected) {
                    setSelectedPoints([pointId]);
                  }
                }
                return true;
              }
            }

            // Check 'out' handle
            const worldHandleOut = shape.getWorldTangentHandle(i, 'out');
            if (worldHandleOut) {
              const distance = Math.sqrt((worldHandleOut.x - x) ** 2 + (worldHandleOut.y - y) ** 2);
              if (distance <= 6) {
                const pointId = { shapeId: shape.id, pointIndex: 2000 + i * 2 + 1 }; // Out handle is +1 from in handle
                if (addToSelection) {
                  const exists = selectedPoints.some(p => p.shapeId === pointId.shapeId && p.pointIndex === pointId.pointIndex);
                  if (exists) {
                    setSelectedPoints(prev => prev.filter(p => !(p.shapeId === pointId.shapeId && p.pointIndex === pointId.pointIndex)));
                  } else {
                    const pointsFromOtherShapes = selectedPoints.filter(p => p.shapeId !== shape.id);
                    if (pointsFromOtherShapes.length > 0) {
                      setSelectedPoints(prev => prev.filter(p => p.shapeId === shape.id).concat([pointId]));
                    } else {
                      setSelectedPoints(prev => [...prev, pointId]);
                    }
                  }
                } else {
                  // Check if clicking on already selected point - if so, maintain selection for dragging
                  const isAlreadySelected = selectedPoints.some(p => p.shapeId === pointId.shapeId && p.pointIndex === pointId.pointIndex);
                  if (!isAlreadySelected) {
                    setSelectedPoints([pointId]);
                  }
                }
                return true;
              }
            }
          }
        }

        // Check control points (for bezier curves)
        if (shape.controlPoints) {
          for (let i = 0; i < shape.controlPoints.length; i++) {
            const worldControl = shape.getWorldControlPoint(i);
            if (worldControl) {
              const distance = Math.sqrt((worldControl.x - x) ** 2 + (worldControl.y - y) ** 2);
              if (distance <= 6) {
                const pointId = { shapeId: shape.id, pointIndex: i + 1000 }; // Offset control points
                if (addToSelection) {
                  const exists = selectedPoints.some(p => p.shapeId === pointId.shapeId && p.pointIndex === pointId.pointIndex);
                  if (exists) {
                    setSelectedPoints(prev => prev.filter(p => !(p.shapeId === pointId.shapeId && p.pointIndex === pointId.pointIndex)));
                  } else {
                    const pointsFromOtherShapes = selectedPoints.filter(p => p.shapeId !== shape.id);
                    if (pointsFromOtherShapes.length > 0) {
                      setSelectedPoints(prev => prev.filter(p => p.shapeId === shape.id).concat([pointId]));
                    } else {
                      setSelectedPoints(prev => [...prev, pointId]);
                    }
                  }
                } else {
                  // Check if clicking on already selected point - if so, maintain selection for dragging
                  const isAlreadySelected = selectedPoints.some(p => p.shapeId === pointId.shapeId && p.pointIndex === pointId.pointIndex);
                  if (!isAlreadySelected) {
                    setSelectedPoints([pointId]);
                  }
                }
                return true;
              }
            }
          }
        }

        // Check regular points
        for (let i = 0; i < shape.points.length; i++) {
          const worldPoint = shape.getWorldPoint(i);
          if (worldPoint) {
            const distance = Math.sqrt((worldPoint.x - x) ** 2 + (worldPoint.y - y) ** 2);
            if (distance <= 8) {
              const pointId = { shapeId: shape.id, pointIndex: i };
              if (addToSelection) {
                const exists = selectedPoints.some(p => p.shapeId === pointId.shapeId && p.pointIndex === pointId.pointIndex);
                if (exists) {
                  setSelectedPoints(prev => prev.filter(p => !(p.shapeId === pointId.shapeId && p.pointIndex === pointId.pointIndex)));
                } else {
                  const pointsFromOtherShapes = selectedPoints.filter(p => p.shapeId !== shape.id);
                  if (pointsFromOtherShapes.length > 0) {
                    setSelectedPoints(prev => prev.filter(p => p.shapeId === shape.id).concat([pointId]));
                  } else {
                    setSelectedPoints(prev => [...prev, pointId]);
                  }
                }
              } else {
                // Check if clicking on already selected point - if so, maintain selection for dragging
                const isAlreadySelected = selectedPoints.some(p => p.shapeId === pointId.shapeId && p.pointIndex === pointId.pointIndex);
                if (!isAlreadySelected) {
                  setSelectedPoints([pointId]);
                }
              }
              return true;
            }
          }
        }

        // If this shape blocks access to lower shapes, stop searching
        if (shapeBlocks) {
          return false;
        }
      }
    }

    if (!addToSelection) {
      setSelectedPoints([]);
    }
    return false;
  }, [shapes, selectedPoints]);

  const selectSegmentAt = useCallback((x: number, y: number, addToSelection: boolean = false) => {
    // Sort shapes by z-index from highest to lowest to respect layering
    const sortedShapes = [...shapes].sort((a, b) => b.properties.zIndex - a.properties.zIndex);

    for (const shape of sortedShapes) {
      if (shape.points && shape.points.length > 1) {
        // Check if this shape blocks access to lower shapes
        const shapeBlocks = shape.containsPoint(x, y);

        for (let i = 0; i < shape.points.length - 1; i++) {
          const worldP1 = shape.getWorldPoint(i);
          const worldP2 = shape.getWorldPoint(i + 1);

          if (worldP1 && worldP2) {
            let distance = Infinity;

            // For spline shapes, use cubic Bézier curve distance calculation
            if (shape.type.startsWith('spline-') && shape.tangentHandles && i < shape.tangentHandles.length && (i + 1) < shape.tangentHandles.length) {
              // Get world-space tangent handles for this segment
              const worldTangent1Out = shape.getWorldTangentHandle(i, 'out');
              const worldTangent2In = shape.getWorldTangentHandle(i + 1, 'in');

              if (worldTangent1Out && worldTangent2In) {
                // Sample points along the cubic Bézier curve and find the closest distance
                const sampleCount = 20;
                let minDistance = Infinity;

                for (let t = 0; t <= 1; t += 1 / sampleCount) {
                  // Cubic Bézier formula: B(t) = (1-t)³P₀ + 3(1-t)²tC₀ + 3(1-t)t²C₁ + t³P₁
                  const t1 = 1 - t;
                  const t1_2 = t1 * t1;
                  const t1_3 = t1_2 * t1;
                  const t_2 = t * t;
                  const t_3 = t_2 * t;

                  const curveX = t1_3 * worldP1.x + 
                               3 * t1_2 * t * worldTangent1Out.x + 
                               3 * t1 * t_2 * worldTangent2In.x + 
                               t_3 * worldP2.x;

                  const curveY = t1_3 * worldP1.y + 
                               3 * t1_2 * t * worldTangent1Out.y + 
                               3 * t1 * t_2 * worldTangent2In.y + 
                               t_3 * worldP2.y;

                  const dx = x - curveX;
                  const dy = y - curveY;
                  const sampleDistance = Math.sqrt(dx * dx + dy * dy);

                  if (sampleDistance < minDistance) {
                    minDistance = sampleDistance;
                  }
                }

                distance = minDistance;
              }
            } else {
              // For non-spline shapes, use straight line distance calculation
              const A = x - worldP1.x;
              const B = y - worldP1.y;
              const C = worldP2.x - worldP1.x;
              const D = worldP2.y - worldP1.y;

              const dot = A * C + B * D;
              const lenSq = C * C + D * D;
              let param = -1;
              if (lenSq !== 0) {
                param = dot / lenSq;
              }

              let xx, yy;
              if (param < 0) {
                xx = worldP1.x;
                yy = worldP1.y;
              } else if (param > 1) {
                xx = worldP2.x;
                yy = worldP2.y;
              } else {
                xx = worldP1.x + param * C;
                yy = worldP1.y + param * D;
              }

              const dx = x - xx;
              const dy = y - yy;
              distance = Math.sqrt(dx * dx + dy * dy);
            }

            if (distance <= 8) {
              const segmentId = { shapeId: shape.id, segmentIndex: i };
              if (addToSelection) {
                const exists = selectedSegments.some(s => s.shapeId === segmentId.shapeId && s.segmentIndex === segmentId.segmentIndex);
                if (exists) {
                  setSelectedSegments(prev => prev.filter(s => !(s.shapeId === segmentId.shapeId && s.segmentIndex === segmentId.segmentIndex)));
                } else {
                  // If selecting segment from different shape, clear segments from other shapes
                  const segmentsFromOtherShapes = selectedSegments.filter(s => s.shapeId !== shape.id);
                  if (segmentsFromOtherShapes.length > 0) {
                    setSelectedSegments(prev => prev.filter(s => s.shapeId === shape.id).concat([segmentId]));
                  } else {
                    setSelectedSegments(prev => [...prev, segmentId]);
                  }
                }
              } else {
                // Check if clicking on already selected segment - if so, maintain selection for dragging
                const isAlreadySelected = selectedSegments.some(s => s.shapeId === segmentId.shapeId && s.segmentIndex === segmentId.segmentIndex);
                if (!isAlreadySelected) {
                  setSelectedSegments([segmentId]);
                }
              }
              return true;
            }
          }
        }

        // If this shape blocks access to lower shapes, stop searching
        if (shapeBlocks) {
          return false;
        }
      }
    }

    if (!addToSelection) {
      setSelectedSegments([]);
    }
    return false;
  }, [shapes, selectedSegments]);

  const moveSelected = useCallback((deltaX: number, deltaY: number) => {
    selectedShapes.forEach(shape => {
      shape.transform.x += deltaX;
      shape.transform.y += deltaY;
    });

    selectedGroups.forEach(group => {
      group.transform.x += deltaX;
      group.transform.y += deltaY;
      group.shapes.forEach(shape => {
        shape.transform.x += deltaX;
        shape.transform.y += deltaY;
      });
    });

    setShapes(prev => [...prev]);
    setGroups(prev => [...prev]);
  }, [selectedShapes, selectedGroups]);

  const moveSelectedPoints = useCallback((deltaX: number, deltaY: number) => {
    selectedPoints.forEach(({ shapeId, pointIndex }) => {
      const shape = shapes.find(s => s.id === shapeId);
      if (!shape) return;

      const localDelta = shape.worldDeltaToLocal(deltaX, deltaY);

      if (pointIndex < 1000) {
        // Regular point
        if (shape.points && shape.points[pointIndex]) {
          const oldX = shape.points[pointIndex].x;
          const oldY = shape.points[pointIndex].y;

          shape.points[pointIndex].x += localDelta.x;
          shape.points[pointIndex].y += localDelta.y;

          // Move associated control points and tangent handles with the point
          if (shape.controlPoints) {
            // For bezier curves, move the control point associated with this point
            if (pointIndex < shape.controlPoints.length) {
              shape.controlPoints[pointIndex].x += localDelta.x;
              shape.controlPoints[pointIndex].y += localDelta.y;
            }

            // For blob shapes, also move the previous control point (since they're between points)
            if (shape.type === 'blob') {
              const prevControlIndex = (pointIndex - 1 + shape.controlPoints.length) % shape.controlPoints.length;
              shape.controlPoints[prevControlIndex].x += localDelta.x;
              shape.controlPoints[prevControlIndex].y += localDelta.y;
            }
          }

          // Move associated tangent handles with the point
          if (shape.tangentHandles && pointIndex < shape.tangentHandles.length) {
            shape.tangentHandles[pointIndex].in.x += localDelta.x;
            shape.tangentHandles[pointIndex].in.y += localDelta.y;
            shape.tangentHandles[pointIndex].out.x += localDelta.x;
            shape.tangentHandles[pointIndex].out.y += localDelta.y;
          }
        }
      } else if (pointIndex >= 1000 && pointIndex < 2000) {
        // Control point (for bezier curves)
        const controlIndex = pointIndex - 1000;
        if (shape.controlPoints && shape.controlPoints[controlIndex]) {
          shape.controlPoints[controlIndex].x += localDelta.x;
          shape.controlPoints[controlIndex].y += localDelta.y;
        }
      } else if (pointIndex >= 2000) {
        // Tangent handle (for cubic curves)
        const handlePointIndex = Math.floor((pointIndex - 2000) / 2);
        const isOut = (pointIndex - 2000) % 2 === 1;

        if (shape.tangentHandles && shape.tangentHandles[handlePointIndex]) {
          const handleType = isOut ? 'out' : 'in';
          shape.tangentHandles[handlePointIndex][handleType].x += localDelta.x;
          shape.tangentHandles[handlePointIndex][handleType].y += localDelta.y;

          // If the point is marked as smooth, update the opposite handle to maintain continuity
          if (shape.smoothPoints && shape.smoothPoints[handlePointIndex]) {
            const oppositeType = isOut ? 'in' : 'out';
            const currentHandle = shape.tangentHandles[handlePointIndex][handleType];
            const oppositeHandle = shape.tangentHandles[handlePointIndex][oppositeType];
            const basePoint = shape.points[handlePointIndex];

            if (basePoint) {
              // Calculate the vector from base point to current handle
              const currentVector = {
                x: currentHandle.x - basePoint.x,
                y: currentHandle.y - basePoint.y
              };

              // Set opposite handle to be the reflection of current handle
              oppositeHandle.x = basePoint.x - currentVector.x;
              oppositeHandle.y = basePoint.y - currentVector.y;
            }
          }
        }
      }
    });
    setShapes(prev => [...prev]);
  }, [selectedPoints, shapes]);

  const moveSelectedSegments = useCallback((deltaX: number, deltaY: number) => {
    selectedSegments.forEach(({ shapeId, segmentIndex }) => {
      const shape = shapes.find(s => s.id === shapeId);
      if (shape && shape.points) {
        const localDelta = shape.worldDeltaToLocal(deltaX, deltaY);
        const p1 = shape.points[segmentIndex];
        const p2 = shape.points[segmentIndex + 1];

        if (p1) {
          p1.x += localDelta.x;
          p1.y += localDelta.y;

          // Move associated control points and tangent handles with the first point
          if (shape.controlPoints && segmentIndex < shape.controlPoints.length) {
            shape.controlPoints[segmentIndex].x += localDelta.x;
            shape.controlPoints[segmentIndex].y += localDelta.y;
          }

          if (shape.tangentHandles && segmentIndex < shape.tangentHandles.length) {
            shape.tangentHandles[segmentIndex].in.x += localDelta.x;
            shape.tangentHandles[segmentIndex].in.y += localDelta.y;
            shape.tangentHandles[segmentIndex].out.x += localDelta.x;
            shape.tangentHandles[segmentIndex].out.y += localDelta.y;
          }
        }

        if (p2) {
          p2.x += localDelta.x;
          p2.y += localDelta.y;

          // Move associated control points and tangent handles with the second point
          const p2Index = segmentIndex + 1;
          if (shape.controlPoints && p2Index < shape.controlPoints.length) {
            shape.controlPoints[p2Index].x += localDelta.x;
            shape.controlPoints[p2Index].y += localDelta.y;
          }

          if (shape.tangentHandles && p2Index < shape.tangentHandles.length) {
            shape.tangentHandles[p2Index].in.x += localDelta.x;
            shape.tangentHandles[p2Index].in.y += localDelta.y;
            shape.tangentHandles[p2Index].out.x += localDelta.x;
            shape.tangentHandles[p2Index].out.y += localDelta.y;
          }
        }
      }
    });
    setShapes(prev => [...prev]);
  }, [selectedSegments, shapes]);

  const scatterOnShape = useCallback((targetShape: Shape) => {
    if (!targetShape.points || targetShape.points.length === 0) return;

    const newShapes: Shape[] = [];
    const enabledTypes = Array.from(enabledShapeTypes);

    // Use smart distribution algorithm
    let positions: Point[] = [];

    if (scatterSettings.onPoints) {
      // Scatter on shape points
      positions = targetShape.points.slice();
    } else if (scatterSettings.insideArea) {
      // Scatter inside shape area using smart distribution
      const bounds = targetShape.getBounds();
      positions = SmartDistributionAlgorithm.generatePositions(
        scatterSettings.count,
        bounds,
        scatterSettings.distribution
      );

      // Filter positions to only include those inside the shape
      positions = positions.filter(pos => targetShape.containsPoint(pos.x, pos.y));
    } else {
      // Use smart distribution algorithm for general scattering
      const bounds = targetShape.getBounds();
      // Expand bounds slightly for more interesting distributions
      const expandedBounds = {
        ...bounds,
        x: bounds.x - bounds.width * 0.2,
        y: bounds.y - bounds.height * 0.2,
        width: bounds.width * 1.4,
        height: bounds.height * 1.4
      };

      positions = SmartDistributionAlgorithm.generatePositions(
        scatterSettings.count,
        expandedBounds,
        scatterSettings.distribution
      );
    }

    positions.forEach((position, index) => {
      if (enabledTypes.length === 0) return;

      const randomType = enabledTypes[Math.floor(Math.random() * enabledTypes.length)];
      const randomness = scatterSettings.randomness;

      // Add some randomness to position
      const finalX = position.x + (Math.random() - 0.5) * 20 * randomness;
      const finalY = position.y + (Math.random() - 0.5) * 20 * randomness;

      const newShape = new Shape(randomType, finalX, finalY);

      // Add some variation to scattered shapes
      const sizeVariation = 0.5 + Math.random() * randomness;
      newShape.transform.scaleX *= sizeVariation;
      newShape.transform.scaleY *= sizeVariation;

      // Random rotation
      newShape.transform.rotation = Math.random() * 360 * randomness;

      // Random color variation
      const hue = Math.random() * 360;
      const saturation = 50 + Math.random() * 50;
      const lightness = 30 + Math.random() * 40;
      newShape.properties.fillColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;

      newShapes.push(newShape);
    });

    setShapes(prev => {
      // Calculate proper z-indices for scatter shapes to avoid conflicts
      const currentMaxZIndex = prev.length > 0 ? Math.max(...prev.map(s => s.properties.zIndex)) : 0;
      const shapesWithFixedZIndex = newShapes.map((shape, index) => {
        // Directly modify the existing Shape instance instead of creating a plain object
        shape.properties.zIndex = currentMaxZIndex + index + 1;
        return shape;
      });
      return [...prev, ...shapesWithFixedZIndex];
    });
  }, [enabledShapeTypes, scatterSettings]);

  const toggleShapeType = useCallback((type: ShapeType) => {
    setEnabledShapeTypes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(type)) {
        newSet.delete(type);
      } else {
        newSet.add(type);
      }
      return newSet;
    });
  }, []);

  // Helper function to calculate incremental position with modulation (for post-distribution application)
  const calculateIncrementalPositionOffset = (
    settings: BatchConfigSettings,
    axis: 'x' | 'y',
    shapeIndex: number,
    gridColumnIndex?: number
  ): number => {
    const mode = axis === 'x' ? settings.xPositionMode : settings.yPositionMode;
    if (mode !== 'incremental') return 0;

    const startValue = axis === 'x' ? settings.xPositionStartValue : settings.yPositionStartValue;
    const increment = axis === 'x' ? settings.xPositionIncrement : settings.yPositionIncrement;
    const modulationMode = axis === 'x' ? settings.xPositionModulationMode : settings.yPositionModulationMode;
    const modulationValue = axis === 'x' ? settings.xPositionModulationValue : settings.yPositionModulationValue;
    const resetPerBatch = settings.incrementalResetPerBatch;

    // Calculate effective index (with reset-per-batch support)
    const effectiveIndex = resetPerBatch ? shapeIndex : (shapeIndex + lastIncrementalIndex);
    
    // Calculate base incremental value
    let value = startValue + (effectiveIndex * increment);

    // Apply modulation based on mode
    if (modulationMode === 'pixel-value' && modulationValue > 0) {
      value = value % modulationValue;
    } else if (modulationMode === 'shape-count' && modulationValue > 0) {
      const moduloIndex = effectiveIndex % modulationValue;
      value = startValue + (moduloIndex * increment);
    } else if ((modulationMode === 'grid-col' || modulationMode === 'grid-row') && modulationValue > 0 && gridColumnIndex !== undefined) {
      // Grid-col/grid-row mode: modulate based on grid position
      // Note: gridColumnIndex is the generic grid cell index - could be column for X or row for Y
      const moduloIndex = gridColumnIndex % modulationValue;
      value = startValue + (moduloIndex * increment);
    }

    return value;
  };






  // Unified shape generation function that both regular and batch export can use
  const generateShapesWithBatchConfig = useCallback((
    count: number, 
    canvasBounds: { x: number; y: number; width: number; height: number },
    useDistribution: boolean = true,
    shapeGenerationIndex: number = 0,
    shapeSpecificPropertiesOverride?: Record<string, any>,
    overrides?: GenerationContextOverrides
  ): Shape[] => {
    // Use overrides if provided, otherwise fall back to UI state
    const effectiveEnabledTypes = overrides?.enabledShapeTypes 
      ? Array.from(overrides.enabledShapeTypes) 
      : Array.from(enabledShapeTypes);
    
    const effectiveBatchConfig = overrides?.batchConfig ?? generationConfigSettings;
    
    const effectiveScatterSettings = overrides?.scatterSettings 
      ? { ...scatterSettings, ...overrides.scatterSettings }
      : scatterSettings;
    
    // Get set repetition index for Index Driver feature (defaults to 0)
    const setRepIndex = overrides?.setRepIndex ?? 0;

    console.log(`🔍 generateShapesWithBatchConfig: count=${count}, enabledTypes=${effectiveEnabledTypes.length}, types=${effectiveEnabledTypes.join(',')}, hasOverrides=${!!overrides}`);
    
    // DIAGNOSTIC: Log effectiveBatchConfig being used
    console.log(`🔍 [DIAGNOSTIC] effectiveBatchConfig in generateShapes:`, {
      source: overrides?.batchConfig ? 'FROM_OVERRIDES' : 'FROM_GLOBAL_UI',
      propertiesEnabled: effectiveBatchConfig.propertiesEnabled,
      shapePropertiesEnabled: effectiveBatchConfig.shapePropertiesEnabled,
      widthMode: effectiveBatchConfig.widthMode,
      widthValue: effectiveBatchConfig.widthValue,
      widthRange: effectiveBatchConfig.widthRange,
      heightMode: effectiveBatchConfig.heightMode,
      heightValue: effectiveBatchConfig.heightValue,
      heightRange: effectiveBatchConfig.heightRange,
      sizeConstraintMode: effectiveBatchConfig.sizeConstraintMode,
      fillColorMode: effectiveBatchConfig.fillColorMode,
      fillColorDefine: effectiveBatchConfig.fillColorDefine,
      fillOpacityDefine: effectiveBatchConfig.fillOpacityDefine,
      fillStyleProbability: effectiveBatchConfig.fillStyleProbability
    });

    if (effectiveEnabledTypes.length === 0) {
      console.log(`❌ No enabled shape types, returning empty array`);
      return [];
    }

    // Shape type generation control setup
    const effectiveGenMode: ShapeTypeGenMode = overrides?.shapeTypeGenMode ?? 'random';
    const effectiveWeights = overrides?.shapeTypeWeights;
    const effectiveSequence = overrides?.shapeTypeSequence;
    const effectiveFixedCounts = overrides?.shapeTypeFixedCounts;

    let actualCount = count;
    let fixedTypeList: SupportedShapeType[] | null = null;
    if (effectiveGenMode === 'fixed' && effectiveEnabledTypes.length > 0) {
      fixedTypeList = buildFixedTypeList(effectiveEnabledTypes as SupportedShapeType[], effectiveFixedCounts);
      actualCount = fixedTypeList.length;
    }

    // Grid fill override: when the manual toggle is on, force actualCount to rows × columns
    // so every grid position gets exactly one shape.
    // NOTE: Cell/Cell-Point render modes do NOT auto-force the count — applyGridDistribution
    // already truncates excess shapes to the available grid positions, which is the correct
    // and expected behaviour. The count slider controls how many shapes are generated (and
    // therefore which ones survive the truncation), e.g. sequence mode with count=30 and a
    // 3×1 grid generates 30 shapes (cycling through all types) then places the first 3.
    const isGridFill = effectiveBatchConfig.distributionLayoutEnabled &&
                       effectiveBatchConfig.distributionPattern === 'grid' &&
                       (effectiveBatchConfig.gridFillEnabled ?? false) &&
                       effectiveGenMode !== 'fixed'; // fixed mode owns its own count
    if (isGridFill) {
      const isCornersMode = effectiveBatchConfig.cellConstraints?.enabled &&
                            effectiveBatchConfig.cellConstraints?.renderMode === 'cell-corners';
      const effectiveRows = isCornersMode
        ? Math.max(1, effectiveBatchConfig.gridRows) + 1
        : Math.max(1, effectiveBatchConfig.gridRows);
      const effectiveCols = isCornersMode
        ? Math.max(1, effectiveBatchConfig.gridColumns) + 1
        : Math.max(1, effectiveBatchConfig.gridColumns);
      const gridCount = effectiveRows * effectiveCols;
      console.log(`🔲 [GRID FILL] Overriding count ${actualCount} → ${gridCount} (${effectiveRows}×${effectiveCols}, mode=${isCornersMode ? 'corners' : 'center'})`);
      actualCount = gridCount;
    }

    // Check if any positioning system is active
    const hasDistributionLayout = effectiveBatchConfig.distributionLayoutEnabled;
    // Shape Properties is active if master enabled AND at least one sub-section (Dimensions or Position) is enabled
    const hasShapeProperties = effectiveBatchConfig.propertiesEnabled && effectiveBatchConfig.shapePropertiesEnabled && 
                               (effectiveBatchConfig.shapePropertiesDimensionsEnabled || effectiveBatchConfig.shapePropertiesPositionEnabled);
    const hasTransforms = effectiveBatchConfig.transformsEnabled;
    const anyPositioningSystemActive = hasDistributionLayout || hasShapeProperties || hasTransforms;

    // Only use random scatter if NO positioning systems are active (fallback behavior)
    // Otherwise start with deterministic (0, 0) so positioning systems aren't polluted
    const positions = anyPositioningSystemActive
      ? Array.from({ length: actualCount }, () => ({ x: 0, y: 0 }))
      : (useDistribution 
          ? SmartDistributionAlgorithm.generatePositions(actualCount, canvasBounds, effectiveScatterSettings.distribution)
          : Array.from({ length: actualCount }, () => ({
              x: canvasBounds.x + (Math.random() - 0.5) * (canvasBounds.width * 0.8),
              y: canvasBounds.y + (Math.random() - 0.5) * (canvasBounds.height * 0.8)
            })));

    // Helper: apply per-shape transforms (origin, rotation, scale, translation).
    // Non-reference transforms run as shapes are created; references run after
    // the full batch exists, following the chosen neighbour direction.
    const applyPerShapeTransforms = (shape: Shape, index: number, postPlacementMode: boolean = false, shapeList: Shape[] = [shape]): void => {
      const applyTranslation = !postPlacementMode || (effectiveBatchConfig.transformsTranslationPostPlacement ?? true);
      const applyScale = !postPlacementMode || (effectiveBatchConfig.transformsScalePostPlacement ?? true);
      const applyRotation = !postPlacementMode || (effectiveBatchConfig.transformsRotationPostPlacement ?? true);
      const applyOrigin = !postPlacementMode || (effectiveBatchConfig.transformsOriginPostPlacement ?? true);
      const applyRandomisation = !postPlacementMode || (effectiveBatchConfig.transformsRandomisationPostPlacement ?? true);

      // Calculate transform origin point
      let originX = 0;
      let originY = 0;
      
      if (effectiveBatchConfig.transformOriginMode === 'define') {
        // Define mode with sub-modes (fixed, range, incremental, series)
        const defineMode = effectiveBatchConfig.transformOriginDefineMode || 'fixed';
        
        if (defineMode === 'series') {
          const xVal = resolveScalarSeries(
            effectiveBatchConfig.transformOriginXSeriesItems || [],
            effectiveBatchConfig.transformOriginXSeriesSelection || 'sequential',
            effectiveBatchConfig.transformOriginXSeriesExhaustion || 'cycle',
            effectiveBatchConfig.transformOriginXSeriesDriver || 'shape-index',
            index,
            setRepIndex
          );
          const yVal = resolveScalarSeries(
            effectiveBatchConfig.transformOriginYSeriesItems || [],
            effectiveBatchConfig.transformOriginYSeriesSelection || 'sequential',
            effectiveBatchConfig.transformOriginYSeriesExhaustion || 'cycle',
            effectiveBatchConfig.transformOriginYSeriesDriver || 'shape-index',
            index,
            setRepIndex
          );
          originX = isNaN(xVal) ? 0 : xVal;
          originY = isNaN(yVal) ? 0 : yVal;
        } else if (defineMode === 'fixed') {
          // Fixed mode: use custom coordinates
          originX = effectiveBatchConfig.transformOriginX || 0;
          originY = effectiveBatchConfig.transformOriginY || 0;
        } else if (defineMode === 'range') {
          // Range mode: random X/Y from ranges
          const xMin = effectiveBatchConfig.transformOriginXMin ?? -100;
          const xMax = effectiveBatchConfig.transformOriginXMax ?? 100;
          const yMin = effectiveBatchConfig.transformOriginYMin ?? -100;
          const yMax = effectiveBatchConfig.transformOriginYMax ?? 100;
          originX = xMin + Math.random() * (xMax - xMin);
          originY = yMin + Math.random() * (yMax - yMin);
        } else if (defineMode === 'incremental') {
          // Incremental mode: start + increment * index + modulation
          // Use separate Index Drivers for X and Y axes
          const xOriginDriver = effectiveBatchConfig.transformOriginXIncrementalIndexDriver || 'shapeIndex';
          const yOriginDriver = effectiveBatchConfig.transformOriginYIncrementalIndexDriver || 'shapeIndex';
          const effectiveXOriginIndex = xOriginDriver === 'setRepIndex' ? setRepIndex : index;
          const effectiveYOriginIndex = yOriginDriver === 'setRepIndex' ? setRepIndex : index;
          
          const xStart = effectiveBatchConfig.transformOriginXStartValue ?? 0;
          const xIncrement = effectiveBatchConfig.transformOriginXIncrement ?? 10;
          const yStart = effectiveBatchConfig.transformOriginYStartValue ?? 0;
          const yIncrement = effectiveBatchConfig.transformOriginYIncrement ?? 10;
          
          let xIncrementAmount = xIncrement * effectiveXOriginIndex;
          let yIncrementAmount = yIncrement * effectiveYOriginIndex;
          
          // Apply threshold modulation if enabled
          if (effectiveBatchConfig.transformOriginXModulationEnabled && effectiveBatchConfig.transformOriginXModulationValue !== undefined && xIncrement !== 0) {
            originX = applyThresholdModulation(effectiveXOriginIndex, xStart, xIncrement, effectiveBatchConfig.transformOriginXModulationValue, effectiveBatchConfig.transformOriginXStartOffset ?? 0, effectiveBatchConfig.transformOriginXStartOffsetCompound ?? false, effectiveBatchConfig.transformOriginXWrapOffset ?? 0, effectiveBatchConfig.transformOriginXWrapOffsetCompound ?? false, effectiveBatchConfig.transformOriginXModulationBounce ?? false);
          } else {
            originX = xStart + xIncrementAmount;
          }
          if (effectiveBatchConfig.transformOriginYModulationEnabled && effectiveBatchConfig.transformOriginYModulationValue !== undefined && yIncrement !== 0) {
            originY = applyThresholdModulation(effectiveYOriginIndex, yStart, yIncrement, effectiveBatchConfig.transformOriginYModulationValue, effectiveBatchConfig.transformOriginYStartOffset ?? 0, effectiveBatchConfig.transformOriginYStartOffsetCompound ?? false, effectiveBatchConfig.transformOriginYWrapOffset ?? 0, effectiveBatchConfig.transformOriginYWrapOffsetCompound ?? false, effectiveBatchConfig.transformOriginYModulationBounce ?? false);
          } else {
            originY = yStart + yIncrementAmount;
          }
          console.log(`🎯 [TRANSFORM ORIGIN INCREMENTAL] Shape ${index} (xDriver=${xOriginDriver}, xIdx=${effectiveXOriginIndex}, yDriver=${yOriginDriver}, yIdx=${effectiveYOriginIndex}): origin=(${originX}, ${originY})`);
        }
      } else if (effectiveBatchConfig.transformOriginMode === 'predefined-artboard') {
        // Use predefined artboard alignment points
        const currentArtboard = artboards.find(ab => ab.id === activeArtboard);
        const artboardWidth = currentArtboard?.width || canvasBounds.width;
        const artboardHeight = currentArtboard?.height || canvasBounds.height;
        const artboardX = currentArtboard?.x || canvasBounds.x;
        const artboardY = currentArtboard?.y || canvasBounds.y;
        
        switch (effectiveBatchConfig.transformOriginPredefined) {
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
          case 'top-right':
            originX = artboardX + artboardWidth;
            originY = artboardY;
            break;
          case 'center-left':
            originX = artboardX;
            originY = artboardY + artboardHeight / 2;
            break;
          case 'center-right':
            originX = artboardX + artboardWidth;
            originY = artboardY + artboardHeight / 2;
            break;
          case 'bottom-left':
            originX = artboardX;
            originY = artboardY + artboardHeight;
            break;
          case 'bottom-center':
            originX = artboardX + artboardWidth / 2;
            originY = artboardY + artboardHeight;
            break;
          case 'bottom-right':
            originX = artboardX + artboardWidth;
            originY = artboardY + artboardHeight;
            break;
        }
      } else if (effectiveBatchConfig.transformOriginMode === 'current-shape') {
        const origin = resolveShapeReferenceOrigin([shape], 0, 'current', effectiveBatchConfig.transformOriginPredefined);
        originX = origin.x;
        originY = origin.y;
      } else if (effectiveBatchConfig.transformOriginMode === 'shape-reference') {
        const origin = resolveShapeReferenceOrigin(
          shapeList, index, effectiveBatchConfig.transformOriginShapeReference,
          effectiveBatchConfig.transformOriginShapeAnchor,
          effectiveBatchConfig.transformOriginShapeIndex,
        );
        originX = origin.x;
        originY = origin.y;
      }
      
      console.log(`🎯 [TRANSFORM ORIGIN] Shape ${index}: mode=${effectiveBatchConfig.transformOriginMode}, origin=(${originX}, ${originY}), predefined=${effectiveBatchConfig.transformOriginPredefined}`);

      // If origin post-placement is disabled, use shape's own position as origin (neutral)
      if (!applyOrigin) {
        originX = shape.transform.x;
        originY = shape.transform.y;
      }
      
      // Get active artboard bounds for transforms
      const currentArtboard = artboards.find(ab => ab.id === activeArtboard);
      const artboardBounds = {
        x: currentArtboard?.x ?? canvasBounds.x,
        y: currentArtboard?.y ?? canvasBounds.y,
        width: currentArtboard?.width ?? canvasBounds.width,
        height: currentArtboard?.height ?? canvasBounds.height
      };
      
      // Apply enhanced position transforms (X)
      let positionDeltaX = 0;
      if (effectiveBatchConfig.xTransformMode === 'series') {
        const val = resolveScalarSeries(
          effectiveBatchConfig.xTransformSeriesItems || [],
          effectiveBatchConfig.xTransformSeriesSelection || 'sequential',
          effectiveBatchConfig.xTransformSeriesExhaustion || 'cycle',
          effectiveBatchConfig.xTransformSeriesDriver || 'shape-index',
          index,
          setRepIndex
        );
        positionDeltaX = isNaN(val) ? 0 : val;
      } else if (effectiveBatchConfig.xTransformMode === 'range') {
        const [minTransX, maxTransX] = getEffectiveTranslateRange('x', effectiveBatchConfig, artboardBounds);
        positionDeltaX = minTransX + Math.random() * (maxTransX - minTransX);
      } else if (effectiveBatchConfig.xTransformMode === 'value') {
        positionDeltaX = effectiveBatchConfig.xTransformValue || 0;
      } else if (effectiveBatchConfig.xTransformMode === 'incremental') {
        // Use Index Driver to select which index to use for incremental calculation (position/scale/rotation share setTransformIncrementalIndexDriver)
        const posDriver = effectiveBatchConfig.setTransformIncrementalIndexDriver || 'shapeIndex';
        const effectivePosIndex = posDriver === 'setRepIndex' ? setRepIndex : index;
        const startValue = effectiveBatchConfig.xTransformStartValue ?? 0;
        const xTransformInc = effectiveBatchConfig.xTransformIncrement || 0;
        if (effectiveBatchConfig.xTransformModulationEnabled && effectiveBatchConfig.xTransformModulationValue !== undefined && xTransformInc !== 0) {
          positionDeltaX = applyThresholdModulation(effectivePosIndex, startValue, xTransformInc, effectiveBatchConfig.xTransformModulationValue, effectiveBatchConfig.xTransformStartOffset ?? 0, effectiveBatchConfig.xTransformStartOffsetCompound ?? false, effectiveBatchConfig.xTransformWrapOffset ?? 0, effectiveBatchConfig.xTransformWrapOffsetCompound ?? false, effectiveBatchConfig.xTransformModulationBounce ?? false);
        } else {
          positionDeltaX = startValue + xTransformInc * effectivePosIndex;
        }
        console.log(`📍 [X POSITION INCREMENTAL] Shape ${index} (driver=${posDriver}, idx=${effectivePosIndex}): start=${startValue}, inc=${xTransformInc}, final=${positionDeltaX}`);
      } else if (effectiveBatchConfig.xTransformMode === 'align') {
        // Alignment mode: align shape anchor to artboard anchor
        const artboardWidth = artboardBounds.width;
        const artboardX = artboardBounds.x;
        const shapeBounds = shape.getBounds();
        
        // Calculate shape X anchor point (relative to shape center)
        let shapeAnchorX = 0;
        if (effectiveBatchConfig.xShapeAnchorMode === 'predefined') {
          switch (effectiveBatchConfig.xShapeAnchorPredefined) {
            case 'left':
              shapeAnchorX = shapeBounds.x;
              break;
            case 'center':
              shapeAnchorX = shapeBounds.x + shapeBounds.width / 2;
              break;
            case 'right':
              shapeAnchorX = shapeBounds.x + shapeBounds.width;
              break;
          }
        } else {
          shapeAnchorX = effectiveBatchConfig.xShapeAnchorDefine;
        }
        
        // Calculate artboard X anchor point
        let artboardAnchorX = 0;
        if (effectiveBatchConfig.xArtboardAnchorMode === 'predefined') {
          switch (effectiveBatchConfig.xArtboardAnchorPredefined) {
            case 'left':
              artboardAnchorX = artboardX;
              break;
            case 'center':
              artboardAnchorX = artboardX + artboardWidth / 2;
              break;
            case 'right':
              artboardAnchorX = artboardX + artboardWidth;
              break;
          }
        } else {
          artboardAnchorX = effectiveBatchConfig.xArtboardAnchorDefine;
        }
        
        // Calculate delta to align shape anchor to artboard anchor
        positionDeltaX = artboardAnchorX - shapeAnchorX;
        console.log(`📍 [X ALIGN] Shape ${index}: shapeAnchor=${shapeAnchorX}, artboardAnchor=${artboardAnchorX}, delta=${positionDeltaX}`);
      }

      // Apply enhanced position transforms (Y)
      let positionDeltaY = 0;
      if (effectiveBatchConfig.yTransformMode === 'series') {
        const val = resolveScalarSeries(
          effectiveBatchConfig.yTransformSeriesItems || [],
          effectiveBatchConfig.yTransformSeriesSelection || 'sequential',
          effectiveBatchConfig.yTransformSeriesExhaustion || 'cycle',
          effectiveBatchConfig.yTransformSeriesDriver || 'shape-index',
          index,
          setRepIndex
        );
        positionDeltaY = isNaN(val) ? 0 : val;
      } else if (effectiveBatchConfig.yTransformMode === 'range') {
        const [minTransY, maxTransY] = getEffectiveTranslateRange('y', effectiveBatchConfig, artboardBounds);
        positionDeltaY = minTransY + Math.random() * (maxTransY - minTransY);
      } else if (effectiveBatchConfig.yTransformMode === 'value') {
        positionDeltaY = effectiveBatchConfig.yTransformValue || 0;
      } else if (effectiveBatchConfig.yTransformMode === 'incremental') {
        // Use Index Driver to select which index to use for incremental calculation (position/scale/rotation share setTransformIncrementalIndexDriver)
        const posDriver = effectiveBatchConfig.setTransformIncrementalIndexDriver || 'shapeIndex';
        const effectivePosIndex = posDriver === 'setRepIndex' ? setRepIndex : index;
        const startValue = effectiveBatchConfig.yTransformStartValue ?? 0;
        const yTransformInc = effectiveBatchConfig.yTransformIncrement || 0;
        if (effectiveBatchConfig.yTransformModulationEnabled && effectiveBatchConfig.yTransformModulationValue !== undefined && yTransformInc !== 0) {
          positionDeltaY = applyThresholdModulation(effectivePosIndex, startValue, yTransformInc, effectiveBatchConfig.yTransformModulationValue, effectiveBatchConfig.yTransformStartOffset ?? 0, effectiveBatchConfig.yTransformStartOffsetCompound ?? false, effectiveBatchConfig.yTransformWrapOffset ?? 0, effectiveBatchConfig.yTransformWrapOffsetCompound ?? false, effectiveBatchConfig.yTransformModulationBounce ?? false);
        } else {
          positionDeltaY = startValue + yTransformInc * effectivePosIndex;
        }
        console.log(`📍 [Y POSITION INCREMENTAL] Shape ${index} (driver=${posDriver}, idx=${effectivePosIndex}): start=${startValue}, inc=${yTransformInc}, final=${positionDeltaY}`);
      } else if (effectiveBatchConfig.yTransformMode === 'align') {
        // Alignment mode: align shape anchor to artboard anchor
        const artboardHeight = artboardBounds.height;
        const artboardY = artboardBounds.y;
        const shapeBounds = shape.getBounds();
        
        // Calculate shape Y anchor point (relative to shape center)
        let shapeAnchorY = 0;
        if (effectiveBatchConfig.yShapeAnchorMode === 'predefined') {
          switch (effectiveBatchConfig.yShapeAnchorPredefined) {
            case 'top':
              shapeAnchorY = shapeBounds.y;
              break;
            case 'center':
              shapeAnchorY = shapeBounds.y + shapeBounds.height / 2;
              break;
            case 'bottom':
              shapeAnchorY = shapeBounds.y + shapeBounds.height;
              break;
          }
        } else {
          shapeAnchorY = effectiveBatchConfig.yShapeAnchorDefine;
        }
        
        // Calculate artboard Y anchor point
        let artboardAnchorY = 0;
        if (effectiveBatchConfig.yArtboardAnchorMode === 'predefined') {
          switch (effectiveBatchConfig.yArtboardAnchorPredefined) {
            case 'top':
              artboardAnchorY = artboardY;
              break;
            case 'center':
              artboardAnchorY = artboardY + artboardHeight / 2;
              break;
            case 'bottom':
              artboardAnchorY = artboardY + artboardHeight;
              break;
          }
        } else {
          artboardAnchorY = effectiveBatchConfig.yArtboardAnchorDefine;
        }
        
        // Calculate delta to align shape anchor to artboard anchor
        positionDeltaY = artboardAnchorY - shapeAnchorY;
        console.log(`📍 [Y ALIGN] Shape ${index}: shapeAnchor=${shapeAnchorY}, artboardAnchor=${artboardAnchorY}, delta=${positionDeltaY}`);
      }

      // Apply enhanced scale transforms
      let scaleX = shape.transform.scaleX;
      let scaleY = shape.transform.scaleY;
      
      if (effectiveBatchConfig.maintainScaleAspectRatio) {
        if (effectiveBatchConfig.scaleXMode === 'series') {
          const val = resolveScalarSeries(
            effectiveBatchConfig.scaleXSeriesItems || [],
            effectiveBatchConfig.scaleXSeriesSelection || 'sequential',
            effectiveBatchConfig.scaleXSeriesExhaustion || 'cycle',
            effectiveBatchConfig.scaleXSeriesDriver || 'shape-index',
            index,
            setRepIndex
          );
          const s = isNaN(val) ? 1 : Math.max(0.1, val / 100);
          scaleX = s;
          scaleY = s;
        } else if (effectiveBatchConfig.scaleXMode === 'range') {
          const [minScale, maxScale] = effectiveBatchConfig.scaleXRange;
          const randomScale = (minScale + Math.random() * (maxScale - minScale)) / 100;
          scaleX = Math.max(0.1, randomScale);
          scaleY = Math.max(0.1, randomScale);
        } else if (effectiveBatchConfig.scaleXMode === 'value') {
          const baseScale = (effectiveBatchConfig.scaleXValue || 100) / 100;
          scaleX = Math.max(0.1, baseScale);
          scaleY = Math.max(0.1, baseScale);
        } else if (effectiveBatchConfig.scaleXMode === 'incremental') {
          // Use Index Driver to select which index to use for incremental calculation (scale/rotation share setTransformIncrementalIndexDriver)
          const scaleDriver = effectiveBatchConfig.setTransformIncrementalIndexDriver || 'shapeIndex';
          const effectiveScaleIndex = scaleDriver === 'setRepIndex' ? setRepIndex : index;
          const scaleXStartPct = effectiveBatchConfig.scaleXStartValue ?? 100;
          const scaleXIncPct = effectiveBatchConfig.scaleXIncrement || 0;
          let finalScalePct: number;
          if (effectiveBatchConfig.scaleXModulationEnabled && effectiveBatchConfig.scaleXModulationValue !== undefined && scaleXIncPct !== 0) {
            finalScalePct = applyThresholdModulation(effectiveScaleIndex, scaleXStartPct, scaleXIncPct, effectiveBatchConfig.scaleXModulationValue, effectiveBatchConfig.scaleXStartOffset ?? 0, effectiveBatchConfig.scaleXStartOffsetCompound ?? false, effectiveBatchConfig.scaleXWrapOffset ?? 0, effectiveBatchConfig.scaleXWrapOffsetCompound ?? false, effectiveBatchConfig.scaleXModulationBounce ?? false);
          } else {
            finalScalePct = scaleXStartPct + scaleXIncPct * effectiveScaleIndex;
          }
          scaleX = Math.max(0.1, finalScalePct / 100);
          scaleY = Math.max(0.1, finalScalePct / 100);
          console.log(`📐 [SCALE INCREMENTAL] Shape ${index} (driver=${scaleDriver}, idx=${effectiveScaleIndex}): startPct=${scaleXStartPct}, inc=${scaleXIncPct}, finalPct=${finalScalePct}`);
        }
      } else {
        if (effectiveBatchConfig.scaleXMode === 'series') {
          const val = resolveScalarSeries(
            effectiveBatchConfig.scaleXSeriesItems || [],
            effectiveBatchConfig.scaleXSeriesSelection || 'sequential',
            effectiveBatchConfig.scaleXSeriesExhaustion || 'cycle',
            effectiveBatchConfig.scaleXSeriesDriver || 'shape-index',
            index,
            setRepIndex
          );
          scaleX = isNaN(val) ? 1 : Math.max(0.1, val / 100);
        } else if (effectiveBatchConfig.scaleXMode === 'range') {
          const [minScaleX, maxScaleX] = effectiveBatchConfig.scaleXRange;
          const randomScale = (minScaleX + Math.random() * (maxScaleX - minScaleX)) / 100;
          scaleX = Math.max(0.1, randomScale);
        } else if (effectiveBatchConfig.scaleXMode === 'value') {
          const baseScale = (effectiveBatchConfig.scaleXValue || 100) / 100;
          scaleX = Math.max(0.1, baseScale);
        } else if (effectiveBatchConfig.scaleXMode === 'incremental') {
          // Use Index Driver to select which index to use for incremental calculation (scale/rotation share setTransformIncrementalIndexDriver)
          const scaleDriver = effectiveBatchConfig.setTransformIncrementalIndexDriver || 'shapeIndex';
          const effectiveScaleIndex = scaleDriver === 'setRepIndex' ? setRepIndex : index;
          const scaleXStartPct = effectiveBatchConfig.scaleXStartValue ?? 100;
          const scaleXIncPct = effectiveBatchConfig.scaleXIncrement || 0;
          let finalScaleXPct: number;
          if (effectiveBatchConfig.scaleXModulationEnabled && effectiveBatchConfig.scaleXModulationValue !== undefined && scaleXIncPct !== 0) {
            finalScaleXPct = applyThresholdModulation(effectiveScaleIndex, scaleXStartPct, scaleXIncPct, effectiveBatchConfig.scaleXModulationValue, effectiveBatchConfig.scaleXStartOffset ?? 0, effectiveBatchConfig.scaleXStartOffsetCompound ?? false, effectiveBatchConfig.scaleXWrapOffset ?? 0, effectiveBatchConfig.scaleXWrapOffsetCompound ?? false, effectiveBatchConfig.scaleXModulationBounce ?? false);
          } else {
            finalScaleXPct = scaleXStartPct + scaleXIncPct * effectiveScaleIndex;
          }
          scaleX = Math.max(0.1, finalScaleXPct / 100);
          console.log(`📐 [SCALE X INCREMENTAL] Shape ${index} (driver=${scaleDriver}, idx=${effectiveScaleIndex}): startPct=${scaleXStartPct}, inc=${scaleXIncPct}, finalPct=${finalScaleXPct}`);
        }

        if (effectiveBatchConfig.scaleYMode === 'series') {
          const val = resolveScalarSeries(
            effectiveBatchConfig.scaleYSeriesItems || [],
            effectiveBatchConfig.scaleYSeriesSelection || 'sequential',
            effectiveBatchConfig.scaleYSeriesExhaustion || 'cycle',
            effectiveBatchConfig.scaleYSeriesDriver || 'shape-index',
            index,
            setRepIndex
          );
          scaleY = isNaN(val) ? 1 : Math.max(0.1, val / 100);
        } else if (effectiveBatchConfig.scaleYMode === 'range') {
          const [minScaleY, maxScaleY] = effectiveBatchConfig.scaleYRange;
          const randomScale = (minScaleY + Math.random() * (maxScaleY - minScaleY)) / 100;
          scaleY = Math.max(0.1, randomScale);
        } else if (effectiveBatchConfig.scaleYMode === 'value') {
          const baseScale = (effectiveBatchConfig.scaleYValue || 100) / 100;
          scaleY = Math.max(0.1, baseScale);
        } else if (effectiveBatchConfig.scaleYMode === 'incremental') {
          // Use Index Driver to select which index to use for incremental calculation (scale/rotation share setTransformIncrementalIndexDriver)
          const scaleDriver = effectiveBatchConfig.setTransformIncrementalIndexDriver || 'shapeIndex';
          const effectiveScaleIndex = scaleDriver === 'setRepIndex' ? setRepIndex : index;
          const scaleYStartPct = effectiveBatchConfig.scaleYStartValue ?? 100;
          const scaleYIncPct = effectiveBatchConfig.scaleYIncrement || 0;
          let finalScaleYPct: number;
          if (effectiveBatchConfig.scaleYModulationEnabled && effectiveBatchConfig.scaleYModulationValue !== undefined && scaleYIncPct !== 0) {
            finalScaleYPct = applyThresholdModulation(effectiveScaleIndex, scaleYStartPct, scaleYIncPct, effectiveBatchConfig.scaleYModulationValue, effectiveBatchConfig.scaleYStartOffset ?? 0, effectiveBatchConfig.scaleYStartOffsetCompound ?? false, effectiveBatchConfig.scaleYWrapOffset ?? 0, effectiveBatchConfig.scaleYWrapOffsetCompound ?? false, effectiveBatchConfig.scaleYModulationBounce ?? false);
          } else {
            finalScaleYPct = scaleYStartPct + scaleYIncPct * effectiveScaleIndex;
          }
          scaleY = Math.max(0.1, finalScaleYPct / 100);
          console.log(`📐 [SCALE Y INCREMENTAL] Shape ${index} (driver=${scaleDriver}, idx=${effectiveScaleIndex}): startPct=${scaleYStartPct}, inc=${scaleYIncPct}, finalPct=${finalScaleYPct}`);
        }
      }

      // Apply enhanced rotation transforms
      let rotation = 0;
      if (effectiveBatchConfig.rotationMode === 'series') {
        const val = resolveScalarSeries(
          effectiveBatchConfig.rotationSeriesItems || [],
          effectiveBatchConfig.rotationSeriesSelection || 'sequential',
          effectiveBatchConfig.rotationSeriesExhaustion || 'cycle',
          effectiveBatchConfig.rotationSeriesDriver || 'shape-index',
          index,
          setRepIndex
        );
        rotation = isNaN(val) ? 0 : val;
      } else if (effectiveBatchConfig.rotationMode === 'range') {
        const [minRot, maxRot] = effectiveBatchConfig.rotationRange;
        rotation = minRot + Math.random() * (maxRot - minRot);
        console.log(`🔄 [ENHANCED ROTATION RANGE] Shape ${index}: base=${rotation.toFixed(2)}°, range=${minRot}-${maxRot}`);
      } else if (effectiveBatchConfig.rotationMode === 'value') {
        rotation = effectiveBatchConfig.rotationValue || 0;
        console.log(`🔄 [ENHANCED ROTATION VALUE] Shape ${index}: fixed value=${rotation}°`);
      } else if (effectiveBatchConfig.rotationMode === 'incremental') {
        // Use Index Driver to select which index to use for incremental calculation (scale/rotation share setTransformIncrementalIndexDriver)
        const rotationDriver = effectiveBatchConfig.setTransformIncrementalIndexDriver || 'shapeIndex';
        const effectiveRotIndex = rotationDriver === 'setRepIndex' ? setRepIndex : index;
        let incrementAmount = (effectiveBatchConfig.rotationIncrement || 0) * effectiveRotIndex;
        const startValue = effectiveBatchConfig.rotationStartValue ?? 0;
        if (effectiveBatchConfig.rotationModulationEnabled && effectiveBatchConfig.rotationModulation > 0) {
          const m = effectiveBatchConfig.rotationModulation;
          incrementAmount = ((incrementAmount % m) + m) % m;
        }
        rotation = startValue + incrementAmount;
        console.log(`🔄 [ENHANCED ROTATION INCREMENTAL] Shape ${index} (driver=${rotationDriver}, idx=${effectiveRotIndex}): start=${startValue}°, increment=${incrementAmount}°, final=${rotation}°`);
      }

      // Randomization scales the configured transform amounts. A zero translation
      // or rotation (and 100% scale) must remain neutral in either placement mode.
      const randomized = randomizeTransformAmounts(
        { translationX: positionDeltaX, translationY: positionDeltaY, scaleX, scaleY, rotation },
        {
          scale: effectiveBatchConfig.scaleRandomizationScale ?? 0,
          rotation: effectiveBatchConfig.rotationRandomizationScale ?? 0,
          translationX: effectiveBatchConfig.translationXRandomizationScale ?? 0,
          translationY: effectiveBatchConfig.translationYRandomizationScale ?? 0,
          maintainScaleAspectRatio: effectiveBatchConfig.maintainScaleAspectRatio,
          applyScale, applyRotation, applyTranslation,
          enabled: applyRandomisation,
        },
      );

      Object.assign(shape.transform, composePerShapeTransform(shape.transform, {
        originX, originY,
        translationX: applyTranslation ? randomized.translationX : 0,
        translationY: applyTranslation ? randomized.translationY : 0,
        scaleX: randomized.scaleX, scaleY: randomized.scaleY, rotation: randomized.rotation,
        applyScale, applyRotation,
        postPlacement: postPlacementMode,
      }));

      // Apply skew if configured (legacy system)
      if (effectiveBatchConfig.skewXRange && effectiveBatchConfig.skewYRange) {
        const [minSkewX, maxSkewX] = effectiveBatchConfig.skewXRange;
        const [minSkewY, maxSkewY] = effectiveBatchConfig.skewYRange;
        shape.transform.skewX = minSkewX + Math.random() * (maxSkewX - minSkewX);
        shape.transform.skewY = minSkewY + Math.random() * (maxSkewY - minSkewY);
      }

    };

    // Stores polar direction angles per shape; populated inside the map when transformsPostPlacement
    // is true so positionRotateToDirection can be deferred to run after applyPerShapeTransforms.
    const polarAngles = new Map<string, number>();

    const newShapes = positions.map((position, index) => {
      const randomType: SupportedShapeType = effectiveGenMode === 'fixed'
        ? fixedTypeList![index % fixedTypeList!.length]
        : pickShapeType(effectiveGenMode, effectiveEnabledTypes as SupportedShapeType[], effectiveWeights, effectiveSequence, index);

      // Apply position from batch config if properties are enabled
      let shapeX = position.x;
      let shapeY = position.y;
      let polarAngleDeg: number | undefined = undefined;

      if (effectiveBatchConfig.propertiesEnabled && effectiveBatchConfig.shapePropertiesEnabled && effectiveBatchConfig.shapePropertiesPositionEnabled) {
        const coordSystem = effectiveBatchConfig.positionCoordSystem ?? 'cartesian';

        if (coordSystem === 'polar') {
          // Polar mode: anchor + polar offset (angle + radius); anchor replaces distribution position
          const posResult = calculatePositionXY(
            effectiveBatchConfig, index, canvasBounds.width, canvasBounds.height,
            positions.length, lastIncrementalIndex, setRepIndex,
            canvasBounds.x, canvasBounds.y
          );
          shapeX += posResult.x - posResult.anchorX;
          shapeY += posResult.y - posResult.anchorY;
          polarAngleDeg = posResult.angleDeg;
        } else {
          // Cartesian mode: anchor is the origin; X/Y offsets are added to anchor
          const anchor = resolveAnchorOffset(
            effectiveBatchConfig, canvasBounds.width, canvasBounds.height,
            canvasBounds.x, canvasBounds.y, index
          );
          // Check if we're using grid distribution with incremental positions
          const isGridDistribution = effectiveBatchConfig.distributionLayoutEnabled &&
                                     effectiveBatchConfig.distributionPattern === 'grid';
          const hasXIncremental = effectiveBatchConfig.xPositionMode === 'incremental';
          const hasYIncremental = effectiveBatchConfig.yPositionMode === 'incremental';
          const shouldDeferIncremental = isGridDistribution && (hasXIncremental || hasYIncremental);

          if (shouldDeferIncremental) {
            // For grid + incremental: skip incremental positions here, apply after grid distribution
            if (!hasXIncremental) {
              shapeX = anchor.x + calculatePositionX(effectiveBatchConfig, index, canvasBounds.width, canvasBounds.height, positions.length, lastIncrementalIndex, setRepIndex);
            }
            if (!hasYIncremental) {
              shapeY = anchor.y + calculatePositionY(effectiveBatchConfig, index, canvasBounds.width, canvasBounds.height, positions.length, lastIncrementalIndex, setRepIndex);
            }
          } else {
            shapeX = anchor.x + calculatePositionX(effectiveBatchConfig, index, canvasBounds.width, canvasBounds.height, positions.length, lastIncrementalIndex, setRepIndex);
            shapeY = anchor.y + calculatePositionY(effectiveBatchConfig, index, canvasBounds.width, canvasBounds.height, positions.length, lastIncrementalIndex, setRepIndex);
          }
        }
      }

      // Combine batch config with scatter settings for complete configuration
      // Deep merge shape-specific properties override if provided (from generation sets)
      const enhancedScatterSettings = shapeSpecificPropertiesOverride ? {
        ...effectiveScatterSettings,
        shapeSpecific: Object.fromEntries(
          // Get all unique shape type keys from both sources
          Array.from(new Set([
            ...Object.keys(effectiveScatterSettings.shapeSpecific || {}),
            ...Object.keys(shapeSpecificPropertiesOverride)
          ])).map((shapeType: string) => [
            shapeType,
            {
              // Deep merge: existing config + override for this shape type
              ...(effectiveScatterSettings.shapeSpecific?.[shapeType as keyof typeof effectiveScatterSettings.shapeSpecific] || {}),
              ...(shapeSpecificPropertiesOverride[shapeType] || {})
            }
          ])
        )
      } : effectiveScatterSettings;

      const combinedConfig = { 
        ...effectiveBatchConfig, 
        scatterSettings: enhancedScatterSettings,
        generationIndex: index,
        _shapeIndex: index,
        _setRepIndex: setRepIndex,
      };
      const shape = new Shape(randomType, shapeX, shapeY, combinedConfig);

      // Apply width/height from batch config if properties and Dimensions sub-section are enabled
      if (effectiveBatchConfig.propertiesEnabled && effectiveBatchConfig.shapePropertiesEnabled && effectiveBatchConfig.shapePropertiesDimensionsEnabled) {
        let width = calculateWidth(effectiveBatchConfig, index, canvasBounds.width, canvasBounds.height, positions.length, setRepIndex);
        let height = calculateHeight(effectiveBatchConfig, index, canvasBounds.width, canvasBounds.height, positions.length, setRepIndex);

        // Calculate constrained size based on mode
        const constrainedSize = calculateConstrainedSize(effectiveBatchConfig, width, height);
        
        // If constraint mode is active (min/max/avg), use constrained size for BOTH dimensions
        const useConstrainedDimensions = effectiveBatchConfig.sizeConstraintMode !== 'none';
        
        if (useConstrainedDimensions) {
          width = constrainedSize;
          height = constrainedSize;
        }

        // Apply the size based on shape type
        switch (shape.type) {
          case 'rectangle':
          case 'rounded-rectangle':
            shape.width = width;
            shape.height = height;
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
            shape.radius = width / 2;
            shape.width = width;
            shape.height = height;
            break;
          case 'ellipse':
          case 'spline-ellipse':
            shape.width = width;
            shape.height = height;
            break;
          case 'line':
            // A line is just a start + end point, so size it by overwriting the
            // second point with a random-direction offset of the requested size.
            if (shape.points.length >= 2) {
              const angle = Math.random() * Math.PI * 2;
              shape.points[1] = {
                x: shape.points[0].x + Math.cos(angle) * width,
                y: shape.points[0].y + Math.sin(angle) * height
              };
            }
            break;
          case 'bezier':
          case 'cubic':
          case 'smooth-spline':
            // Curves keep the multi-point geometry produced by the pattern
            // generator. Do NOT overwrite points[1] here — doing so flung the
            // second anchor far away at a random angle, creating spikes/slivers.
            break;
        }
        
        // CRITICAL: Regenerate points after width/height changes to update visual rendering
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
        ].includes(shape.type);
        if (isScalableRadiusShape && (effectiveBatchConfig.stretchShapeToDimensions ?? false) && shape.points.length > 0 && width > 0 && height > 0) {
          const xs = shape.points.map(p => p.x);
          const ys = shape.points.map(p => p.y);
          const minX = Math.min(...xs), maxX = Math.max(...xs);
          const minY = Math.min(...ys), maxY = Math.max(...ys);
          const actualW = maxX - minX;
          const actualH = maxY - minY;
          if (actualW > 0 && actualH > 0) {
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            const sx = width / actualW;
            const sy = height / actualH;
            shape.points = shape.points.map(p => ({
              x: (p.x - cx) * sx,
              y: (p.y - cy) * sy
            }));
          }
        }
      }

      // Apply render mode
      shape.shapeRenderMode = effectiveBatchConfig.shapeRenderMode ?? 'smooth';
      shape.shapeRenderSegments = effectiveBatchConfig.shapeRenderSegments ?? 32;
      shape.shapeRenderDotSize = effectiveBatchConfig.shapeRenderDotSize ?? 4;
      shape.renderModeOverride = effectiveBatchConfig.renderModeOverride ?? { enabled: false, tension: 1, resample: { enabled: false, count: 32 } };
      shape.wireConfig = effectiveBatchConfig.wireConfig ?? undefined;

      // Apply local jitter config (stored on shape for render-time use)
      if (effectiveBatchConfig.localJitterEnabled) {
        shape.localJitterConfig = extractLocalJitterConfig(effectiveBatchConfig);
      } else {
        shape.localJitterConfig = undefined;
      }

      // Temporarily assign a placeholder z-index, will be fixed during state update
      shape.properties.zIndex = index + 1;

      // Apply color harmony if enabled
      if (effectiveBatchConfig.colorHarmonyEnabled) {
        const colorHarmonySettings: ColorHarmonySettings = {
          enabled: effectiveBatchConfig.colorHarmonyEnabled,
          harmonyType: effectiveBatchConfig.harmonyType,
          baseColor: effectiveBatchConfig.baseColor,
          hueVariance: effectiveBatchConfig.hueVariance,
          saturationRange: effectiveBatchConfig.saturationRange,
          lightnessRange: effectiveBatchConfig.lightnessRange,
          monochromaticSettings: effectiveBatchConfig.monochromaticSettings,
          analogousSettings: effectiveBatchConfig.analogousSettings,
          complementarySettings: effectiveBatchConfig.complementarySettings,
          triadicSettings: effectiveBatchConfig.triadicSettings,
          splitComplementarySettings: effectiveBatchConfig.splitComplementarySettings,
          tetradicSettings: effectiveBatchConfig.tetradicSettings
        };

        // Apply harmony to fill color
        shape.properties.fillColor = ColorUtils.generateHarmonyColor(colorHarmonySettings);

        // Apply harmony to stroke color (related but slightly different)
        shape.properties.strokeColor = ColorUtils.generateHarmonyColor(colorHarmonySettings);

        // Apply harmony to gradients if they exist
        if (shape.properties.gradient) {
          shape.properties.gradient.stops = shape.properties.gradient.stops.map(stop => ({
            ...stop,
            color: ColorUtils.generateHarmonyColor(colorHarmonySettings)
          }));
        }

        console.log(`🎨 Applied ${effectiveBatchConfig.harmonyType} harmony - Fill: ${shape.properties.fillColor}, Stroke: ${shape.properties.strokeColor}`);
      } else if (effectiveBatchConfig.propertiesEnabled) {
        // When properties are enabled, don't pre-set colors here
        // Fill and stroke colors will be determined by probability logic below
        console.log(`🎯 [BATCH PROPERTIES] Shape ${index}: Properties enabled, colors will be set by probability logic`);

        // Set default transparent values - probability logic will override if needed
        shape.properties.fillColor = 'transparent';
        shape.properties.fillOpacity = 0;
        shape.properties.strokeColor = 'transparent';
        shape.properties.strokeOpacity = 0;
      } else {
          // Only apply legacy randomization if batch config properties are completely disabled
          if (!effectiveBatchConfig.propertiesEnabled) {
            // Original randomization behavior (before noise system)
            const hue = Math.random() * 360;
            const saturation = 50 + Math.random() * 50;
            const lightness = 30 + Math.random() * 40;
            const fillColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
            shape.properties.fillColor = fillColor;

            // Random stroke color
            const strokeHue = Math.random() * 360;
            const strokeSaturation = 60 + Math.random() * 40;
            const strokeLightness = 20 + Math.random() * 60;
            const strokeColor = `hsl(${strokeHue}, ${strokeSaturation}%, ${strokeLightness}%)`;
            shape.properties.strokeColor = strokeColor;
          }
        }

      // Apply fill and stroke probabilities from batch config
      const isLineType = randomType === 'line' || randomType === 'line-vector';
      if (effectiveBatchConfig.propertiesEnabled) {
        // Handle fill style: solid vs gradient (not transparent vs opaque)
        // Lines are never filled — skip fill logic entirely for them
        if (effectiveBatchConfig.fillEnabled && !isLineType) {
          // Determine if this shape gets solid or gradient fill
          // If fillSolidEnabled is false, treat solid fill probability as 0
          const effectiveSolidProbability = effectiveBatchConfig.fillSolidEnabled !== false ? effectiveBatchConfig.fillStyleProbability : 0;
          const shouldHaveSolidFill = Math.random() * 100 < effectiveSolidProbability;
          const shouldHaveGradient = !shouldHaveSolidFill && effectiveBatchConfig.fillGradientEnabled;

          // Determine fill type based on probabilities
          if (shouldHaveGradient) {
            // Determine gradient type based on settings
            let gradientType: 'linear' | 'radial' | 'conic' | 'diamond' = 'linear';
            
            // Check if shape-matching mode is enabled
            const useShapeMatching = effectiveBatchConfig.fillGradientTypeDirectionEnabled && 
                                    effectiveBatchConfig.fillGradientMatchShape;
            
            if (useShapeMatching) {
              // Match gradient type to shape type - deterministic override of probabilities
              const roundShapes = ['circle', 'ellipse', 'star', 'blob', 'ring', 'spline-circle', 'spline-ring', 'spline-star', 'spline-blob'];
              const isRoundShape = roundShapes.includes(randomType);
              
              if (isRoundShape) {
                // For round shapes: ONLY use radial or conic, never linear
                // Use relative probabilities to determine which one, but exclude linear entirely
                const radialProb = effectiveBatchConfig.fillGradientRadialProbability;
                const conicProb = effectiveBatchConfig.fillGradientConicProbability;
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
                const linearProb = effectiveBatchConfig.fillGradientLinearProbability;
                const diamondProb = effectiveBatchConfig.fillGradientDiamondProbability ?? 0;
                const totalGeomProb = linearProb + diamondProb;
                
                if (totalGeomProb > 0) {
                  const random = Math.random() * totalGeomProb;
                  gradientType = random < linearProb ? 'linear' : 'diamond';
                } else {
                  gradientType = 'linear';
                }
              }
            } else {
              // Use probability-based selection (original behavior)
              const totalGradientProb = effectiveBatchConfig.fillGradientLinearProbability + 
                                      effectiveBatchConfig.fillGradientRadialProbability + 
                                      effectiveBatchConfig.fillGradientConicProbability +
                                      (effectiveBatchConfig.fillGradientDiamondProbability ?? 0);
              
              if (totalGradientProb > 0) {
                const random = Math.random() * totalGradientProb;
                let cumulative = 0;
                
                cumulative += effectiveBatchConfig.fillGradientLinearProbability;
                if (random < cumulative) {
                  gradientType = 'linear';
                } else {
                  cumulative += effectiveBatchConfig.fillGradientRadialProbability;
                  if (random < cumulative) {
                    gradientType = 'radial';
                  } else {
                    cumulative += effectiveBatchConfig.fillGradientConicProbability;
                    if (random < cumulative) {
                      gradientType = 'conic';
                    } else {
                      gradientType = 'diamond';
                    }
                  }
                }
              }
            }
            // Determine stop count based on mode
            let stopCount: number;
            if (effectiveBatchConfig.fillGradientStopsMode === 'fixed') {
              stopCount = effectiveBatchConfig.fillGradientStopsCount ?? 3;
            } else {
              const [minStops, maxStops] = effectiveBatchConfig.fillGradientStopsRange;
              stopCount = Math.floor(minStops + Math.random() * (maxStops - minStops + 1));
            }

            // Generate colors for gradient stops
            const gradientColors: string[] = [];
            for (let i = 0; i < stopCount; i++) {
              let stopColor: string;

              if (effectiveBatchConfig.fillGradientColorMode === 'define') {
                // For define mode, use specific colors from the array
                const colors = effectiveBatchConfig.fillGradientColorDefine || ['#3b82f6'];
                stopColor = colors[i % colors.length];
              } else {
                // For range and palette modes, use generateColor
                stopColor = generateColor(
                  effectiveBatchConfig.fillGradientColorMode,
                  effectiveBatchConfig.fillGradientColorRange,
                  effectiveBatchConfig.fillGradientColorPalette,
                  undefined, // define is handled above
                  i, // stop index only — palette stops follow swatch order, not shape-index offset
                  effectiveBatchConfig.fillGradientColorMode === 'range' ? {
                    saturationRange: effectiveBatchConfig.fillGradientColorSaturationRange,
                    lightnessRange: effectiveBatchConfig.fillGradientColorLightnessRange,
                    flip: effectiveBatchConfig.fillGradientColorRangeFlip
                  } : undefined
                );
              }
              gradientColors.push(stopColor);
            }

            // Apply reverse if enabled
            if (effectiveBatchConfig.fillGradientStopsReverse) {
              gradientColors.reverse();
            }

            // Calculate stop positions based on distribution mode
            const gradientStops = gradientColors.map((color, i) => {
              let offset: number;
              if (effectiveBatchConfig.fillGradientStopDistribution === 'random' && stopCount > 2) {
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
            if (effectiveBatchConfig.fillGradientStopDistribution === 'random') {
              gradientStops.sort((a, b) => a.offset - b.offset);
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
              stops: gradientStops
            };
            
            // Add linear-specific parameters when gradient type is linear
            if (gradientType === 'linear') {
              gradientObj.angle = calculateLinearAngle(effectiveBatchConfig, index, setRepIndex);
              const linearPosition = (effectiveBatchConfig as any).fillGradientLinearCenter ?? 'center';
              if (linearPosition === 'center') {
                gradientObj.linearCenterX = 50;
                gradientObj.linearCenterY = 50;
              } else if (linearPosition === 'corners' || linearPosition === 'midpoints') {
                const s = effectiveBatchConfig as any;
                const points: [number, number][] = [];
                if (linearPosition === 'corners') {
                  const corners = s.fillGradientLinearCorners ?? { topLeft: true, topRight: true, bottomLeft: true, bottomRight: true };
                  if (corners.topLeft) points.push([0, 0]);
                  if (corners.topRight) points.push([100, 0]);
                  if (corners.bottomLeft) points.push([0, 100]);
                  if (corners.bottomRight) points.push([100, 100]);
                } else {
                  const midpoints = s.fillGradientLinearMidpoints ?? { top: true, right: true, bottom: true, left: true };
                  if (midpoints.top) points.push([50, 0]);
                  if (midpoints.right) points.push([100, 50]);
                  if (midpoints.bottom) points.push([50, 100]);
                  if (midpoints.left) points.push([0, 50]);
                }
                const pick: [number, number] = points.length
                  ? (s.fillGradientLinearSelectionMode === 'cycle'
                    ? points[index % points.length]
                    : points[Math.floor(Math.random() * points.length)])
                  : [50, 50];
                [gradientObj.linearCenterX, gradientObj.linearCenterY] = pick;
              } else {
                gradientObj.linearCenterX = calculateLinearCenterX(effectiveBatchConfig, index, setRepIndex);
                gradientObj.linearCenterY = calculateLinearCenterY(effectiveBatchConfig, index, setRepIndex);
              }
              gradientObj.linearScale = calculateGradientScale(effectiveBatchConfig, 'Linear', index, setRepIndex);
            }
            
            // Add radial-specific parameters when gradient type is radial
            if (gradientType === 'radial') {
              gradientObj.radialCenterX = calculateRadialCenterX(effectiveBatchConfig, index, setRepIndex);
              gradientObj.radialCenterY = calculateRadialCenterY(effectiveBatchConfig, index, setRepIndex);
              gradientObj.radialScale = calculateGradientScale(effectiveBatchConfig, 'Radial', index, setRepIndex);
            }
            
            // Add conic-specific parameters when gradient type is conic
            if (gradientType === 'conic') {
              gradientObj.conicAngle = calculateConicAngle(effectiveBatchConfig, index, setRepIndex);
              gradientObj.conicCenterX = calculateConicCenterX(effectiveBatchConfig, index, setRepIndex);
              gradientObj.conicCenterY = calculateConicCenterY(effectiveBatchConfig, index, setRepIndex);
            }

            // Add diamond-specific parameters when gradient type is diamond
            if (gradientType === 'diamond') {
              const diamondPosition = effectiveBatchConfig.fillGradientDiamondCenter ?? 'center';
              if (diamondPosition === 'center') {
                gradientObj.diamondCenterX = 50;
                gradientObj.diamondCenterY = 50;
              } else if (diamondPosition === 'corners') {
                const corners = effectiveBatchConfig.fillGradientDiamondCorners ?? { topLeft: true, topRight: true, bottomLeft: true, bottomRight: true };
                const selectionMode = effectiveBatchConfig.fillGradientDiamondSelectionMode ?? 'random';
                const cornerPositions: [number, number][] = [];
                if (corners.topLeft) cornerPositions.push([0, 0]);
                if (corners.topRight) cornerPositions.push([100, 0]);
                if (corners.bottomLeft) cornerPositions.push([0, 100]);
                if (corners.bottomRight) cornerPositions.push([100, 100]);
                if (cornerPositions.length === 0) { gradientObj.diamondCenterX = 50; gradientObj.diamondCenterY = 50; }
                else {
                  const pick = selectionMode === 'cycle'
                    ? cornerPositions[index % cornerPositions.length]
                    : cornerPositions[Math.floor(Math.random() * cornerPositions.length)];
                  [gradientObj.diamondCenterX, gradientObj.diamondCenterY] = pick;
                }
              } else if (diamondPosition === 'midpoints') {
                const midpoints = effectiveBatchConfig.fillGradientDiamondMidpoints ?? { top: true, right: true, bottom: true, left: true };
                const selectionMode = effectiveBatchConfig.fillGradientDiamondSelectionMode ?? 'random';
                const midPositions: [number, number][] = [];
                if (midpoints.top) midPositions.push([50, 0]);
                if (midpoints.right) midPositions.push([100, 50]);
                if (midpoints.bottom) midPositions.push([50, 100]);
                if (midpoints.left) midPositions.push([0, 50]);
                if (midPositions.length === 0) { gradientObj.diamondCenterX = 50; gradientObj.diamondCenterY = 50; }
                else {
                  const pick = selectionMode === 'cycle'
                    ? midPositions[index % midPositions.length]
                    : midPositions[Math.floor(Math.random() * midPositions.length)];
                  [gradientObj.diamondCenterX, gradientObj.diamondCenterY] = pick;
                }
              } else {
                gradientObj.diamondCenterX = calculateDiamondCenterX(effectiveBatchConfig, index, setRepIndex);
                gradientObj.diamondCenterY = calculateDiamondCenterY(effectiveBatchConfig, index, setRepIndex);
              }
              gradientObj.diamondAngle = calculateDiamondAngle(effectiveBatchConfig, index, setRepIndex);
              gradientObj.diamondScale = calculateGradientScale(effectiveBatchConfig, 'Diamond', index, setRepIndex);
              gradientObj.diamondScaleEdgeMode = (effectiveBatchConfig as any).fillGradientDiamondScaleEdgeMode ?? 'streak';
            }
            
            shape.properties.gradient = gradientObj;

            // When gradient is used, set fillColor to gradient's first stop color as fallback
            // This ensures compatibility with export rendering that may check fillColor before gradient
            shape.properties.fillColor = gradientStops[0]?.color ?? '#3b82f6';

            // Apply fill opacity based on mode
            shape.properties.fillOpacity = calculateFillOpacity(effectiveBatchConfig, index, setRepIndex);

          } else if (shouldHaveSolidFill) {
            // Create solid fill (only if no gradient)
            shape.properties.gradient = undefined;

            // Apply solid fill color using range mode with saturation/lightness controls
            const fillColor = effectiveBatchConfig.fillColorMode === 'palette' && effectiveBatchConfig.fillColorPaletteBehavior === 'blend'
              ? resolveFillPaletteColour(
                  effectiveBatchConfig.fillColorPalette,
                  index,
                  positions.length,
                  effectiveBatchConfig.fillColorPaletteDistribution ?? 'even',
                  effectiveBatchConfig.fillColorPaletteAssignments ?? [],
                  effectiveBatchConfig.fillColorPaletteInterpolation ?? 'linear',
                )
              : generateColor(
              effectiveBatchConfig.fillColorMode,
              effectiveBatchConfig.fillColorRange,
              effectiveBatchConfig.fillColorPalette,
              effectiveBatchConfig.fillColorDefine,
              index,
              effectiveBatchConfig.fillColorMode === 'range' ? {
                saturationRange: (effectiveBatchConfig.fillColorSaturationMode ?? 'range') === 'fixed'
                  ? [effectiveBatchConfig.fillColorSaturationFixed ?? 75, effectiveBatchConfig.fillColorSaturationFixed ?? 75] as [number, number]
                  : effectiveBatchConfig.fillColorSaturationRange,
                lightnessRange: (effectiveBatchConfig.fillColorLightnessMode ?? 'range') === 'fixed'
                  ? [effectiveBatchConfig.fillColorLightnessFixed ?? 50, effectiveBatchConfig.fillColorLightnessFixed ?? 50] as [number, number]
                  : effectiveBatchConfig.fillColorLightnessRange,
                flip: effectiveBatchConfig.fillColorRangeFlip
              } : undefined
              );
            shape.properties.fillColor = fillColor;

            // Apply fill opacity based on mode
            shape.properties.fillOpacity = calculateFillOpacity(effectiveBatchConfig, index, setRepIndex);

          } else {
            // This should not happen in the new system - every shape gets either solid or gradient
            // If neither solid nor gradient, default to a solid fill
            shape.properties.gradient = undefined;
            shape.properties.fillColor = '#3b82f6';
            shape.properties.fillOpacity = 0.8;
          }
        }

        // Open Curve Fill Probability: suppress fill on open curves below threshold
        const openCurveFillProbability = effectiveBatchConfig.openCurveFillProbability ?? 100;
        if (openCurveFillProbability < 100) {
          const openCurveTypes = ['bezier', 'cubic', 'smooth-spline'];
          if (openCurveTypes.includes(shape.type) && shape.closed === false) {
            if (Math.random() * 100 >= openCurveFillProbability) {
              shape.properties.openCurveFilled = false;
            }
          }
        }

        // Handle stroke probability - PRIMARY GATE for all stroke properties
        if (effectiveBatchConfig.strokeEnabled) {
          const shouldHaveStroke = Math.random() * 100 < effectiveBatchConfig.strokeProbability;
          if (!shouldHaveStroke) {
            // No stroke - disable all stroke properties
            shape.properties.strokeColor = 'transparent';
            shape.properties.strokeOpacity = 0;
            shape.properties.strokeWidth = 0;
          } else {
            // Stroke enabled - apply all stroke properties

            // Apply stroke width using helper function that supports all modes (range/define/incremental)
            // Only if strokeWidthEnabled is true, otherwise use a default
            if (effectiveBatchConfig.strokeWidthEnabled !== false) {
              if (effectiveBatchConfig.strokeWidthMode === 'parameterised') {
                // Base width is the define value; profile varies it along the path
                shape.properties.strokeWidth = effectiveBatchConfig.strokeWidthDefine ?? 3;
                shape.strokeProfile = {
                  profileType: effectiveBatchConfig.strokeProfileType ?? 'wave',
                  profileFrequency: effectiveBatchConfig.strokeProfileFrequency ?? 2,
                  profilePhaseOffset: effectiveBatchConfig.strokeProfilePhaseOffset ?? 0,
                  profileScale: effectiveBatchConfig.strokeProfileScale ?? 0.5,
                };
              } else {
                shape.properties.strokeWidth = calculateStrokeWidth(effectiveBatchConfig, index, setRepIndex);
                shape.strokeProfile = undefined;
              }
            } else {
              shape.properties.strokeWidth = 1; // Default stroke width when disabled
              shape.strokeProfile = undefined;
            }

            // Apply stroke pattern
            const pat = effectiveBatchConfig.strokePattern ?? 'none';
            shape.strokePattern = pat as any;
            if (pat === 'dash') {
              shape.strokeDashLength = effectiveBatchConfig.strokeDashLength ?? 10;
              shape.strokeDashGap = effectiveBatchConfig.strokeDashGap ?? 6;
            } else if (pat === 'dot') {
              shape.strokeDotSpacing = effectiveBatchConfig.strokeDotSpacing ?? 8;
            } else if (pat === 'squiggle') {
              shape.strokeSquiggleAmplitude   = calculateSquiggleAmplitude(effectiveBatchConfig, index, setRepIndex);
              shape.strokeSquiggleFrequency   = calculateSquiggleFrequency(effectiveBatchConfig, index, setRepIndex);
              shape.strokeSquigglePhase       = calculateSquigglePhase(effectiveBatchConfig, index, setRepIndex);
              shape.strokeSquiggleAlign       = calculateSquiggleAlign(effectiveBatchConfig, index, setRepIndex);
              shape.strokeSquiggleAbs         = effectiveBatchConfig.strokeSquiggleAbs  ?? false;
              shape.strokeSquiggleFlip        = effectiveBatchConfig.strokeSquiggleFlip ?? false;
              const sqPerturbType = (effectiveBatchConfig as any).strokeSquigglePerturbType ?? 'jitter';
              shape.strokeSquiggleJitter      = sqPerturbType === 'jitter' ? calculateSquiggleJitter(effectiveBatchConfig, index, setRepIndex) : 0;
              shape.strokeSquiggleJitterSeed  = calculateSquiggleJitterSeed(effectiveBatchConfig, index, setRepIndex);
              shape.strokeSquiggleNoise       = sqPerturbType === 'noise' ? calculateSquiggleNoise(effectiveBatchConfig, index, setRepIndex) : 0;
              shape.strokeSquiggleNoiseFreq   = calculateSquiggleNoiseFreq(effectiveBatchConfig, index, setRepIndex);
              shape.strokeSquiggleJitterMode  = effectiveBatchConfig.strokeSquiggleJitterDir ?? 'normal';
              shape.strokeSquiggleSampleCount = calculateSquiggleSampleCount(effectiveBatchConfig);
              shape.strokeSquiggleSmoothCurves = (effectiveBatchConfig as any).strokeSquiggleSmoothCurves !== false;
            }

            // Apply stroke opacity based on mode
            if (effectiveBatchConfig.strokeOpacityMode === 'match-fill') {
              shape.properties.strokeOpacity = shape.properties.fillOpacity;
            } else {
              shape.properties.strokeOpacity = calculateStrokeOpacity(effectiveBatchConfig, index, setRepIndex);
            }

            // Apply stroke color
            if (effectiveBatchConfig.strokeColorMode === 'match-fill') {
              // Take hue from fill colour; apply sat/light from controls (or match-fill)
              const fillC = shape.properties.gradient
                ? shape.properties.gradient.stops[Math.floor(shape.properties.gradient.stops.length / 2)]?.color ?? shape.properties.fillColor
                : shape.properties.fillColor;
              const fillHex = (fillC && fillC !== 'transparent' && fillC !== 'none') ? fillC : '#808080';
              const fHsl = ColorUtils.hexToHSL(fillHex); // h 0-360, s 0-100, l 0-100
              const satMode = effectiveBatchConfig.strokeColorSaturationMode ?? 'range';
              const lightMode = effectiveBatchConfig.strokeColorLightnessMode ?? 'range';
              // hslToHex also expects s/l in 0-100 — no division needed
              const sat = satMode === 'match-fill'
                ? fHsl.s
                : satMode === 'fixed'
                ? (effectiveBatchConfig.strokeColorSaturationFixed ?? 80)
                : (effectiveBatchConfig.strokeColorSaturationRange?.[0] ?? 60) +
                    Math.random() * ((effectiveBatchConfig.strokeColorSaturationRange?.[1] ?? 100) - (effectiveBatchConfig.strokeColorSaturationRange?.[0] ?? 60));
              const light = lightMode === 'match-fill'
                ? fHsl.l
                : lightMode === 'fixed'
                ? (effectiveBatchConfig.strokeColorLightnessFixed ?? 40)
                : (effectiveBatchConfig.strokeColorLightnessRange?.[0] ?? 20) +
                    Math.random() * ((effectiveBatchConfig.strokeColorLightnessRange?.[1] ?? 60) - (effectiveBatchConfig.strokeColorLightnessRange?.[0] ?? 20));
              shape.properties.strokeColor = ColorUtils.hslToHex(fHsl.h, sat, light);
            } else if (effectiveBatchConfig.strokeColorEnabled !== false) {
              // Resolve sat/lightness ranges — substitute fill HSL components when match-fill mode is set
              let satRange = effectiveBatchConfig.strokeColorSaturationRange;
              let lightRange = effectiveBatchConfig.strokeColorLightnessRange;
              const satMode = effectiveBatchConfig.strokeColorSaturationMode ?? 'range';
              const lightMode = effectiveBatchConfig.strokeColorLightnessMode ?? 'range';
              if (satMode === 'fixed') satRange = [effectiveBatchConfig.strokeColorSaturationFixed ?? 80, effectiveBatchConfig.strokeColorSaturationFixed ?? 80] as [number, number];
              if (lightMode === 'fixed') lightRange = [effectiveBatchConfig.strokeColorLightnessFixed ?? 40, effectiveBatchConfig.strokeColorLightnessFixed ?? 40] as [number, number];
              if ((satMode === 'match-fill' || lightMode === 'match-fill') && effectiveBatchConfig.strokeColorMode === 'range') {
                const fillHex = shape.properties.fillColor ?? '#808080';
                const fHsl = ColorUtils.hexToHSL(fillHex); // h 0-360, s 0-100, l 0-100
                // Use s/l directly — hexToHSL already returns 0-100 on the client
                if (satMode === 'match-fill') satRange = [Math.round(fHsl.s), Math.round(fHsl.s)] as [number, number];
                if (lightMode === 'match-fill') lightRange = [Math.round(fHsl.l), Math.round(fHsl.l)] as [number, number];
              }
              const strokeColor = generateColor(
                effectiveBatchConfig.strokeColorMode,
                effectiveBatchConfig.strokeColorRange,
                effectiveBatchConfig.strokeColorPalette,
                effectiveBatchConfig.strokeColorDefine,
                index,
                effectiveBatchConfig.strokeColorMode === 'range' ? {
                  saturationRange: satRange,
                  lightnessRange: lightRange,
                  flip: effectiveBatchConfig.strokeColorRangeFlip
                } : undefined
              );
              shape.properties.strokeColor = strokeColor;
            } else {
              shape.properties.strokeColor = '#000000'; // Default to black when disabled
            }
          }
        } else {
          // Stroke section disabled - ensure no stroke
          shape.properties.strokeColor = 'transparent';
          shape.properties.strokeOpacity = 0;
          shape.properties.strokeWidth = 0;
        }

        // Stroke only on unfilled shapes — suppress stroke on any shape that has fill.
        // Open curves whose fill was suppressed (openCurveFilled === false, via the
        // Open Curve Fill Probability control) render no fill, so they count as
        // unfilled here — otherwise their stroke would be wrongly suppressed and the
        // shape would become completely invisible.
        if (effectiveBatchConfig.strokeOnlyUnfilled ?? false) {
          const hasFill = shape.properties.openCurveFilled !== false &&
                          shape.properties.fillColor !== 'transparent' &&
                          shape.properties.fillColor !== 'none' &&
                          (shape.properties.fillOpacity ?? 1) > 0;
          if (hasFill) {
            shape.properties.strokeColor = 'transparent';
            shape.properties.strokeOpacity = 0;
            shape.properties.strokeWidth = 0;
          }
        }

        // Handle blur properties - check parent Shape Effects first
        shape.properties.blurType = effectiveBatchConfig.blurType ?? 'box';
        if (effectiveBatchConfig.shapeEffectsEnabled && effectiveBatchConfig.blurEnabled) {
          const shouldHaveBlur = Math.random() * 100 < effectiveBatchConfig.blurProbability;
          if (shouldHaveBlur) {
            // Apply blur using helper function that supports all modes (range/define/incremental)
            shape.properties.blurRadius = calculateBlur(effectiveBatchConfig, index, setRepIndex);
            console.log(`🌊 [BLUR] Shape ${index}: Applied blur radius=${shape.properties.blurRadius}px (mode: ${effectiveBatchConfig.blurMode})`);
          } else {
            shape.properties.blurRadius = 0;
            console.log(`🌊 [BLUR] Shape ${index}: No blur applied (probability failed)`);
          }
        } else {
          // Shape Effects or Blur section disabled - ensure no blur
          shape.properties.blurRadius = 0;
        }

        // Handle shape effects (drop shadow, outer glow, inner shadow, inner glow)
        // Get the shape's fill color for auto-color mode
        const shapeFillColor = typeof shape.properties.fillColor === 'string' && shape.properties.fillColor !== 'none' 
          ? shape.properties.fillColor 
          : '#808080'; // Fallback for auto-color mode
        
        if (effectiveBatchConfig.shapeEffectsEnabled) {
          // Calculate and apply Drop Shadow
          shape.properties.dropShadow = calculateDropShadow(effectiveBatchConfig, index, setRepIndex, shapeFillColor);
          
          // Calculate and apply Outer Glow
          shape.properties.outerGlow = calculateOuterGlow(effectiveBatchConfig, index, setRepIndex, shapeFillColor);
          
          // Calculate and apply Inner Shadow
          shape.properties.innerShadow = calculateInnerShadow(effectiveBatchConfig, index, setRepIndex, shapeFillColor);
          
          // Calculate and apply Inner Glow
          shape.properties.innerGlow = calculateInnerGlow(effectiveBatchConfig, index, setRepIndex, shapeFillColor);
        }

        // Apply shape transforms if enabled (pre-placement path)
        if (effectiveBatchConfig.transformsEnabled && !(effectiveBatchConfig.transformsPostPlacement ?? false) &&
            effectiveBatchConfig.transformOriginMode !== 'shape-reference') {
          applyPerShapeTransforms(shape, index);
        }
      }

      // Rotate shape to face its polar direction — independent of transformsEnabled
      if ((effectiveBatchConfig.positionRotateToDirection ?? false) && polarAngleDeg !== undefined) {
        if (effectiveBatchConfig.transformsEnabled && ((effectiveBatchConfig.transformsPostPlacement ?? false) ||
            (effectiveBatchConfig.propertiesEnabled && effectiveBatchConfig.transformOriginMode === 'shape-reference'))) {
          // Defer: store the angle so it can be applied after post-placement transforms
          polarAngles.set(shape.id, polarAngleDeg);
        } else {
          shape.transform.rotation += polarAngleDeg;
        }
      }

      // Apply blend modes or compositing operations based on probabilities
      // NOTE: These are independent sections, NOT gated by propertiesEnabled
      if (effectiveBatchConfig.blendModeEnabled && effectiveBatchConfig.enabledBlendModes) {
        // Select blend mode based on probability weights
        const enabledModes = Object.entries(effectiveBatchConfig.enabledBlendModes) as [BlendMode, number][];
        if (enabledModes.length > 0) {
          const totalWeight = enabledModes.reduce((sum, [_, weight]) => sum + weight, 0);
          if (totalWeight > 0) {
            const random = Math.random() * totalWeight;
            let cumulative = 0;
            
            for (const [mode, weight] of enabledModes) {
              cumulative += weight;
              if (random < cumulative) {
                shape.properties.blendMode = mode;
                console.log(`🎭 [BLEND MODE] Shape ${index}: Applied blend mode="${mode}" (weight=${weight}%)`);
                break;
              }
            }
          }
        }
      } else if (effectiveBatchConfig.compositingOperationsEnabled && effectiveBatchConfig.enabledCompositingOperations) {
        // Select compositing operation based on probability weights
        const enabledOps = Object.entries(effectiveBatchConfig.enabledCompositingOperations);
        if (enabledOps.length > 0) {
          const totalWeight = enabledOps.reduce((sum, [_, weight]) => sum + weight, 0);
          if (totalWeight > 0) {
            const random = Math.random() * totalWeight;
            let cumulative = 0;
            
            for (const [op, weight] of enabledOps) {
              cumulative += weight;
              if (random < cumulative) {
                shape.properties.blendMode = op as BlendMode;
                console.log(`🎭 [COMPOSITING] Shape ${index}: Applied compositing operation="${op}" (weight=${weight}%)`);
                break;
              }
            }
          }
        }
      }

      return shape;
    });

    // Shape references require all shapes to exist. Resolve each neighbour from its
    // live position, in an order that lets previous/next chains accumulate transforms.
    if (effectiveBatchConfig.propertiesEnabled && effectiveBatchConfig.transformsEnabled &&
        !(effectiveBatchConfig.transformsPostPlacement ?? false) &&
        effectiveBatchConfig.transformOriginMode === 'shape-reference') {
      applyShapeTransformsInReferenceOrder(newShapes, effectiveBatchConfig.transformOriginShapeReference,
        (shape, index) => {
          applyPerShapeTransforms(shape, index, false, newShapes);
          const angle = polarAngles.get(shape.id);
          if (angle !== undefined) shape.transform.rotation += angle;
        });
    }

    // Apply grid distribution if enabled
    let finalShapes = newShapes;
    if (effectiveBatchConfig.distributionLayoutEnabled) {
      const distributionConfig: DistributionConfig = {
        enabled: effectiveBatchConfig.distributionLayoutEnabled,
        pattern: effectiveBatchConfig.distributionPattern,
        gridRows: effectiveBatchConfig.gridRows,
        gridColumns: effectiveBatchConfig.gridColumns,
        gridCreationOrder: effectiveBatchConfig.gridCreationOrder,
        gridHorizontalDirection: effectiveBatchConfig.gridHorizontalDirection,
        gridVerticalDirection: effectiveBatchConfig.gridVerticalDirection,
        gridStartX: effectiveBatchConfig.gridStartX,
        gridStartY: effectiveBatchConfig.gridStartY,
        gridRowOffset: effectiveBatchConfig.gridRowOffset,
        gridColumnOffset: effectiveBatchConfig.gridColumnOffset,
        gridMarginEnabled: effectiveBatchConfig.gridMarginEnabled,
        gridMarginMode:    effectiveBatchConfig.gridMarginMode,
        gridMarginUnit:    effectiveBatchConfig.gridMarginUnit,
        gridMarginTop:     effectiveBatchConfig.gridMarginTop,
        gridMarginRight:   effectiveBatchConfig.gridMarginRight,
        gridMarginBottom:  effectiveBatchConfig.gridMarginBottom,
        gridMarginLeft:    effectiveBatchConfig.gridMarginLeft,
        gridGutterEnabled: effectiveBatchConfig.gridGutterEnabled,
        gridGutterX:       effectiveBatchConfig.gridGutterX,
        gridGutterY:       effectiveBatchConfig.gridGutterY,
        gridSortBy: effectiveBatchConfig.gridSortBy,
        gridSortScope: effectiveBatchConfig.gridSortScope,
        gridSortOrder: effectiveBatchConfig.gridSortOrder,
        gridXRandomization: effectiveBatchConfig.gridXRandomization,
        gridYRandomization: effectiveBatchConfig.gridYRandomization,
        gridOffsets: effectiveBatchConfig.gridOffsets,
        shapeMasking: effectiveBatchConfig.shapeMasking,
        cellConstraints: effectiveBatchConfig.cellConstraints,
        waveType: effectiveBatchConfig.waveType,
        waveAmplitude: effectiveBatchConfig.waveAmplitude,
        waveFrequency: effectiveBatchConfig.waveFrequency,
        waveDirection: effectiveBatchConfig.waveDirection,
        wavePhaseOffset: effectiveBatchConfig.wavePhaseOffset,
        ellipseXRadius: effectiveBatchConfig.ellipseXRadius,
        ellipseYRadius: effectiveBatchConfig.ellipseYRadius,
        ellipseRingCount: effectiveBatchConfig.ellipseRingCount,
        ellipseRingSpacing: effectiveBatchConfig.ellipseRingSpacing,
        ellipseRotation: effectiveBatchConfig.ellipseRotation,
        ellipseRotationAlignment: effectiveBatchConfig.ellipseRotationAlignment,
        ellipseAlignToRing: effectiveBatchConfig.ellipseAlignToRing,
        ellipseFlipInward: effectiveBatchConfig.ellipseFlipInward,
        ellipseAdditionalRotation: effectiveBatchConfig.ellipseAdditionalRotation,
        ellipseShapeRotationMode: effectiveBatchConfig.ellipseShapeRotationMode,
        ellipseRotationFixed: effectiveBatchConfig.ellipseRotationFixed,
        ellipseRotationRange: effectiveBatchConfig.ellipseRotationRange,
        ellipseRotationIncrementalStart: effectiveBatchConfig.ellipseRotationIncrementalStart,
        ellipseRotationIncrementalStep: effectiveBatchConfig.ellipseRotationIncrementalStep,
        ellipseShapeRotationSeriesItems: effectiveBatchConfig.ellipseShapeRotationSeriesItems,
        ellipseShapeRotationSeriesSelection: effectiveBatchConfig.ellipseShapeRotationSeriesSelection,
        ellipseShapeRotationSeriesExhaustion: effectiveBatchConfig.ellipseShapeRotationSeriesExhaustion,
        ellipseShapeRotationSeriesDriver: effectiveBatchConfig.ellipseShapeRotationSeriesDriver,
        _setRepIndex: setRepIndex,
        spiralTurnCount: effectiveBatchConfig.spiralTurnCount,
        spiralSpacingMode: effectiveBatchConfig.spiralSpacingMode,
        spiralDirection: effectiveBatchConfig.spiralDirection,
        spiralStartAngle: effectiveBatchConfig.spiralStartAngle,
        spiralTightness: effectiveBatchConfig.spiralTightness,
        tangentAlignment: effectiveBatchConfig.tangentAlignment,
        segmentDistribution: effectiveBatchConfig.segmentDistribution,
        reverseDirection: effectiveBatchConfig.reverseDirection
      };

      // Apply grid positioning additively with existing positions
      // For now, assume single generation per call (can be enhanced for batch exports)
      const generationInfo = {
        currentGeneration: 0,
        totalGenerations: 1,
        shapesPerGeneration: newShapes.length
      };
      
      // Get artboard bounds for auto spacing calculations
      const currentArtboard = artboards.find(ab => ab.id === activeArtboard);
      const artboardBounds = currentArtboard ? {
        x: currentArtboard.x,
        y: currentArtboard.y,
        width: currentArtboard.width,
        height: currentArtboard.height
      } : undefined;
      
      if (effectiveBatchConfig.distributionPattern === 'wave') {
        finalShapes = applyWaveDistribution(newShapes, distributionConfig, { x: 0, y: 0 }, artboardBounds);
        console.log(`🌊 Applied wave distribution: ${effectiveBatchConfig.waveType} wave, amplitude=${effectiveBatchConfig.waveAmplitude}px, frequency=${effectiveBatchConfig.waveFrequency}, direction=${effectiveBatchConfig.waveDirection}`);
      } else if (effectiveBatchConfig.distributionPattern === 'ellipse') {
        finalShapes = applyEllipseDistribution(newShapes, distributionConfig, { x: 0, y: 0 }, artboardBounds);
        console.log(`⭕ Applied ellipse distribution: ${effectiveBatchConfig.ellipseRingCount} rings, spacing=${effectiveBatchConfig.ellipseRingSpacing}, rotation=${effectiveBatchConfig.ellipseRotation}°`);
      } else if (effectiveBatchConfig.distributionPattern === 'spiral') {
        finalShapes = applySpiralDistribution(newShapes, distributionConfig, { x: 0, y: 0 }, artboardBounds);
        console.log(`🌀 Applied spiral distribution: ${effectiveBatchConfig.spiralTurnCount} turns, spacing=${effectiveBatchConfig.spiralSpacingMode}, direction=${effectiveBatchConfig.spiralDirection}, tightness=${effectiveBatchConfig.spiralTightness}`);
      } else {
        // Apply grid distribution and get results with grid context
        const gridResults = applyGridDistribution(newShapes, distributionConfig, { x: 0, y: 0 }, generationInfo, artboardBounds);
        console.log(`🎯 Applied grid distribution: ${effectiveBatchConfig.gridRows}×${effectiveBatchConfig.gridColumns}, sort by ${effectiveBatchConfig.gridSortBy} (${effectiveBatchConfig.gridSortOrder}, ${effectiveBatchConfig.gridSortScope})`);
        
        // Apply incremental position modulation if enabled (post-distribution)
        const hasXIncremental = effectiveBatchConfig.propertiesEnabled && 
                               effectiveBatchConfig.shapePropertiesEnabled && 
                               effectiveBatchConfig.xPositionMode === 'incremental';
        const hasYIncremental = effectiveBatchConfig.propertiesEnabled && 
                               effectiveBatchConfig.shapePropertiesEnabled && 
                               effectiveBatchConfig.yPositionMode === 'incremental';
        
        if (hasXIncremental || hasYIncremental) {
          gridResults.forEach((result, index) => {
            const xOffset = hasXIncremental 
              ? calculateIncrementalPositionOffset(effectiveBatchConfig, 'x', index, result.colIndex)
              : 0;
            const yOffset = hasYIncremental 
              ? calculateIncrementalPositionOffset(effectiveBatchConfig, 'y', index, result.colIndex)
              : 0;
            
            result.shape.transform.x += xOffset;
            result.shape.transform.y += yOffset;
            
            if (index < 3) {
              console.log(`📐 [CLIENT] Applied incremental modulation to shape ${index}: xOffset=${xOffset}, yOffset=${yOffset}, col=${result.colIndex}, row=${result.rowIndex}`);
            }
          });
          console.log(`📐 [CLIENT] Applied incremental position modulation after grid distribution`);
        }
        
        // Extract shapes from grid results
        finalShapes = gridResults.map(r => r.shape);
      }
    }

    // Post-placement transforms — run after distribution when transformsPostPlacement is true
    if (effectiveBatchConfig.transformsEnabled && (effectiveBatchConfig.transformsPostPlacement ?? false)) {
      if (effectiveBatchConfig.transformOriginMode === 'shape-reference') {
        applyShapeTransformsInReferenceOrder(finalShapes, effectiveBatchConfig.transformOriginShapeReference,
          (shape, index) => {
            applyPerShapeTransforms(shape, index, true, finalShapes);
            const angle = polarAngles.get(shape.id);
            if (angle !== undefined) shape.transform.rotation += angle;
          });
      } else {
        finalShapes.forEach((shape, index) => applyPerShapeTransforms(shape, index, true));
      }
    }
    // Apply deferred polar direction rotation (deferred during map only when transformsEnabled &&
    // transformsPostPlacement — so positionRotateToDirection always runs after applyPerShapeTransforms)
    if ((effectiveBatchConfig.transformsEnabled && (effectiveBatchConfig.transformsPostPlacement ?? false)) &&
        effectiveBatchConfig.transformOriginMode !== 'shape-reference' &&
        (effectiveBatchConfig.positionRotateToDirection ?? false)) {
      finalShapes.forEach(shape => {
        const deferredAngle = polarAngles.get(shape.id);
        if (deferredAngle !== undefined) shape.transform.rotation += deferredAngle;
      });
    }

    // Apply global jitter — offsets each shape's position and optionally rotation
    if (effectiveBatchConfig.globalJitterEnabled) {
      const globalJitterCfg = extractGlobalJitterConfig(effectiveBatchConfig);
      finalShapes.forEach((shape, idx) => {
        const { dx, dy, dz } = computeGlobalJitter(globalJitterCfg, idx, shape.id);
        shape.transform.x += dx;
        shape.transform.y += dy;
        if (dz !== 0) shape.transform.rotation = (shape.transform.rotation || 0) + dz;
      });
    }

    // Apply setTransform if provided in overrides
    if (overrides?.setTransform) {
      const setTransform = overrides.setTransform;
      if (setTransform.x !== 0 || setTransform.y !== 0 || 
          setTransform.rotation !== 0 || setTransform.scaleX !== 1 || setTransform.scaleY !== 1) {
        console.log(`🔄 Applying setTransform from overrides: x=${setTransform.x}, y=${setTransform.y}, rotation=${setTransform.rotation}, scaleX=${setTransform.scaleX}, scaleY=${setTransform.scaleY}`);
        
        finalShapes.forEach(shape => {
          shape.transform.x += setTransform.x;
          shape.transform.y += setTransform.y;
          shape.transform.rotation += setTransform.rotation;
          shape.transform.scaleX *= setTransform.scaleX;
          shape.transform.scaleY *= setTransform.scaleY;
        });
      }
    }

    // Apply artboard alignment if provided in overrides
    if (overrides?.artboardAlignment) {
      const currentArtboard = artboards.find(ab => ab.id === activeArtboard);
      
      // Determine fit target: use new fitTarget field if set, fall back to legacy fitToArtboard boolean
      const fitTarget = overrides.artboardAlignment.fitTarget || 
        (overrides.artboardAlignment.fitToArtboard ? 'artboard' : 'none');
      
      if ((fitTarget === 'artboard' || fitTarget === 'bleed') && currentArtboard && finalShapes.length > 0) {
        const fitMode = overrides.artboardAlignment.fitMode || 'contain';
        console.log(`📐 Applying fit to ${fitTarget} from overrides (mode: ${fitMode})`);
        
        // Calculate bleed expansion if fitting to bleed
        let bleedPx = 0;
        if (fitTarget === 'bleed' && currentArtboard.printConfig?.overlays?.bleed) {
          const bleedConfig = currentArtboard.printConfig.overlays.bleed;
          const overlayUnit = currentArtboard.printConfig.overlays.overlayUnit || 'pixels';
          const dpi = currentArtboard.dpi || 300;
          
          // Apply bleed based on amount > 0 (display/render are visualization settings, not the actual bleed value)
          if (bleedConfig.amount > 0) {
            bleedPx = convertPrintUnitToPixels(bleedConfig.amount, overlayUnit as PrintUnitType, dpi);
            console.log(`📐 [BLEED] Expanding target by bleed: ${bleedConfig.amount}${overlayUnit} = ${bleedPx.toFixed(1)}px`);
          }
        }
        
        // Calculate bounding box of all shapes using world bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        finalShapes.forEach(shape => {
          const worldBounds = shape.getWorldBounds();
          
          minX = Math.min(minX, worldBounds.x);
          minY = Math.min(minY, worldBounds.y);
          maxX = Math.max(maxX, worldBounds.x + worldBounds.width);
          maxY = Math.max(maxY, worldBounds.y + worldBounds.height);
        });
        
        const setBoundsWidth = maxX - minX;
        const setBoundsHeight = maxY - minY;
        const setCenterX = (minX + maxX) / 2;
        const setCenterY = (minY + maxY) / 2;
        
        // Normalize margin to individual values
        const margin = overrides.artboardAlignment.margin || 0;
        console.log(`📏 [MARGIN DEBUG] fitToArtboard margin value:`, margin, `type:`, typeof margin);
        const marginTop = typeof margin === 'number' ? margin : margin.top;
        const marginBottom = typeof margin === 'number' ? margin : margin.bottom;
        const marginLeft = typeof margin === 'number' ? margin : margin.left;
        const marginRight = typeof margin === 'number' ? margin : margin.right;
        console.log(`📏 [MARGIN DEBUG] Effective margins: top=${marginTop}, bottom=${marginBottom}, left=${marginLeft}, right=${marginRight}`);
        
        // Calculate target area dimensions (artboard + bleed if applicable)
        // When fitting to bleed, the target area expands by bleedPx on all sides
        const targetX = currentArtboard.x - bleedPx;
        const targetY = currentArtboard.y - bleedPx;
        const targetWidth = currentArtboard.width + (bleedPx * 2);
        const targetHeight = currentArtboard.height + (bleedPx * 2);
        
        // Calculate scale to fit within target area with margin
        const availableWidth = targetWidth - marginLeft - marginRight;
        const availableHeight = targetHeight - marginTop - marginBottom;
        
        const scaleX = availableWidth / setBoundsWidth;
        const scaleY = availableHeight / setBoundsHeight;
        
        // fitMode: 'contain' maintains aspect ratio, 'fill' stretches to fill both axes
        const finalScaleX = fitMode === 'contain' ? Math.min(scaleX, scaleY) : scaleX;
        const finalScaleY = fitMode === 'contain' ? Math.min(scaleX, scaleY) : scaleY;
        
        // Apply scale and center to target area
        finalShapes.forEach(shape => {
          const relX = shape.transform.x - setCenterX;
          const relY = shape.transform.y - setCenterY;
          
          shape.transform.x = targetX + marginLeft + availableWidth / 2 + (relX * finalScaleX);
          shape.transform.y = targetY + marginTop + availableHeight / 2 + (relY * finalScaleY);
          shape.transform.scaleX *= finalScaleX;
          shape.transform.scaleY *= finalScaleY;
        });
        
        console.log(`✅ Fitted shapes to ${fitTarget} with scaleX=${finalScaleX.toFixed(2)}, scaleY=${finalScaleY.toFixed(2)}${bleedPx > 0 ? `, bleedPx=${bleedPx.toFixed(1)}` : ''}`);
        console.log(`📍 [POSITION DEBUG] First shape after fit: x=${finalShapes[0]?.transform.x.toFixed(1)}, y=${finalShapes[0]?.transform.y.toFixed(1)}`);
      } else if (overrides.artboardAlignment.alignTo !== 'none' && currentArtboard && finalShapes.length > 0) {
        console.log(`🎯 Applying alignment from overrides: ${overrides.artboardAlignment.alignmentType}`);
        
        // Calculate bounding box center
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        finalShapes.forEach(shape => {
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
        const margin = overrides.artboardAlignment.margin || 0;
        const marginTop = typeof margin === 'number' ? margin : margin.top;
        const marginBottom = typeof margin === 'number' ? margin : margin.bottom;
        const marginLeft = typeof margin === 'number' ? margin : margin.left;
        const marginRight = typeof margin === 'number' ? margin : margin.right;
        
        // Calculate target position based on alignment type
        let targetX = currentArtboard.x + currentArtboard.width / 2;
        let targetY = currentArtboard.y + currentArtboard.height / 2;
        
        switch (overrides.artboardAlignment.alignmentType) {
          case 'top-left':
            targetX = currentArtboard.x + marginLeft;
            targetY = currentArtboard.y + marginTop;
            break;
          case 'top-center':
            targetX = currentArtboard.x + currentArtboard.width / 2;
            targetY = currentArtboard.y + marginTop;
            break;
          case 'top-right':
            targetX = currentArtboard.x + currentArtboard.width - marginRight;
            targetY = currentArtboard.y + marginTop;
            break;
          case 'center-left':
            targetX = currentArtboard.x + marginLeft;
            targetY = currentArtboard.y + currentArtboard.height / 2;
            break;
          case 'center':
            targetX = currentArtboard.x + currentArtboard.width / 2;
            targetY = currentArtboard.y + currentArtboard.height / 2;
            break;
          case 'center-right':
            targetX = currentArtboard.x + currentArtboard.width - marginRight;
            targetY = currentArtboard.y + currentArtboard.height / 2;
            break;
          case 'bottom-left':
            targetX = currentArtboard.x + marginLeft;
            targetY = currentArtboard.y + currentArtboard.height - marginBottom;
            break;
          case 'bottom-center':
            targetX = currentArtboard.x + currentArtboard.width / 2;
            targetY = currentArtboard.y + currentArtboard.height - marginBottom;
            break;
          case 'bottom-right':
            targetX = currentArtboard.x + currentArtboard.width - marginRight;
            targetY = currentArtboard.y + currentArtboard.height - marginBottom;
            break;
        }
        
        // Calculate offset and apply to all shapes
        const offsetX = targetX - setCenterX;
        const offsetY = targetY - setCenterY;
        
        finalShapes.forEach(shape => {
          shape.transform.x += offsetX;
          shape.transform.y += offsetY;
        });
        
        console.log(`✅ Aligned shapes to ${overrides.artboardAlignment.alignmentType} with offset (${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`);
      }
    }

    // Log all final z-indices before adding to state
    console.log(`🔍 [FINAL Z-INDEX] All new shapes z-indices: [${finalShapes.map(s => s.properties.zIndex).join(', ')}]`);
    console.log(`🔍 [FINAL Z-INDEX] Existing shapes count: ${shapes.length}, New shapes count: ${finalShapes.length}`);

    console.log(`✅ Created ${finalShapes.length} shapes, returning for further processing`);

    return finalShapes;
  }, [enabledShapeTypes, scatterSettings, canvasSettings, generationConfigSettings, artboards, activeArtboard]);

  // Helper function to calculate repetition count for a set
  const calculateRepetitionCount = useCallback((
    set: GenerationSet,
    globalRepetitionMode: 'fixed' | 'range',
    globalRepetitionValue: number,
    globalRepetitionRange: [number, number]
  ): number => {
    // Check if set overrides global repetition settings
    const useSetRepetition = set.repetitionMode && set.repetitionMode !== 'use-global';
    
    if (useSetRepetition) {
      // Use set-specific repetition settings
      if (set.repetitionMode === 'fixed') {
        return set.repetitionValue || 0;
      } else if (set.repetitionMode === 'range' && set.repetitionRange) {
        const [min, max] = set.repetitionRange;
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }
    }
    
    // Use global repetition settings
    if (globalRepetitionMode === 'fixed') {
      return globalRepetitionValue;
    } else {
      const [min, max] = globalRepetitionRange;
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
  }, []);

  const generateRandomShapes = useCallback(() => {
    // Check if generation sets are enabled and have enabled sets
    // Dependency-aware topological sort: ensures copy-to-points destination sets
    // are always generated before the source sets that reference them.
    // Returns both the sorted array and a set of IDs involved in circular dependencies.
    function topologicalSortSets<T extends { id: string; generationOrder: number; batchConfig?: any }>(
      sets: T[]
    ): { sorted: T[]; cycleSetIds: Set<string> } {
      const byId = new Map(sets.map(s => [s.id, s]));
      const visited = new Set<string>();
      const inProgress = new Set<string>();
      const cycleSetIds = new Set<string>();
      const result: T[] = [];
      function visit(s: T) {
        if (visited.has(s.id)) return;
        if (inProgress.has(s.id)) {
          // Cycle detected — skip the back-edge to break the loop
          console.warn(
            `[CTP] Circular dependency detected involving set "${(s as any).name ?? s.id}". ` +
            `Skipping back-edge. Select the set, disable CTP, and click Apply to clear the stale config.`
          );
          cycleSetIds.add(s.id);
          return;
        }
        inProgress.add(s.id);
        // For the current set, prefer live generationConfigSettings over saved batchConfig
        // so that changes made in the dialog (before apply) are reflected in ordering.
        const cfg = (s.id === currentGenerationSetId) ? generationConfigSettings : s.batchConfig;
        const destId = cfg?.copyToPointsEnabled ? cfg?.copyToPointsConfig?.destinationSetId : undefined;
        if (destId) { const d = byId.get(destId); if (d) visit(d); }
        inProgress.delete(s.id);
        visited.add(s.id);
        result.push(s);
      }
      [...sets].sort((a, b) => a.generationOrder - b.generationOrder).forEach(s => visit(s));
      if (cycleSetIds.size > 0) {
        // Fall back to plain generationOrder sort so at least something runs
        return { sorted: [...sets].sort((a, b) => a.generationOrder - b.generationOrder), cycleSetIds };
      }
      return { sorted: result, cycleSetIds };
    }

    const { sorted: enabledGenerationSets, cycleSetIds: ctpCycleSetIds } = topologicalSortSets(
      generationSets.filter(set => set.enabled)
    );
    const useGenerationSets = enabledGenerationSets.length > 0;

    let newShapes: Shape[] = [];

    if (useGenerationSets) {
      console.log(`🔍 generateRandomShapes: Using ${enabledGenerationSets.length} enabled generation sets`);
      
      // Use current artboard bounds for shape placement
      const currentArtboard = artboards.find(ab => ab.id === activeArtboard);
      const canvasBounds = currentArtboard ? {
        x: currentArtboard.x,
        y: currentArtboard.y,
        width: currentArtboard.width,
        height: currentArtboard.height
      } : {
        x: -200,
        y: -200,
        width: 400,
        height: 400
      };

      // Generate shapes for each enabled generation set
      const allNewShapes: Shape[] = [];
      // Track generated shapes per set so copy-to-points source sets can look up destination shapes
      const shapesBySetId = new Map<string, Shape[]>();
      
      enabledGenerationSets.forEach((set, setIndex) => {
        let previousEchoCentroid: { x: number; y: number } | undefined;
        // Calculate repetition count for this set
        const repetitionCount = calculateRepetitionCount(
          set,
          globalRepetitionMode,
          globalRepetitionValue,
          globalRepetitionRange
        );
        
        const totalReps = Math.max(1, repetitionCount);
        console.log(`🔁 [REPETITION] Set "${set.name}" will generate ${totalReps} time(s)`);
        
        // Loop for each repetition - regenerate shapes fresh each time
        for (let repIndex = 0; repIndex < totalReps; repIndex++) {
          if (repetitionCount > 0) {
            console.log(`🔁 [REPETITION ${repIndex + 1}/${totalReps}] Generating fresh shapes for set "${set.name}"`);
          }
          
          // Calculate shape count for this set.
          // For the CURRENT set, read directly from live scatterSettings so the count slider
          // takes effect immediately without requiring "Apply to Current Set" first.
          // All other sets use their own saved shapeCountFixed/Range (applied snapshot).
          const isCurrentSet = currentGenerationSetId && set.id === currentGenerationSetId;
          const effectiveCountMode = isCurrentSet ? scatterSettings.shapeCountMode : set.shapeCountMode;
          const effectiveCountFixed = isCurrentSet ? (scatterSettings.fixedShapeCount ?? set.shapeCountFixed) : set.shapeCountFixed;
          const effectiveCountRange = isCurrentSet
            ? [scatterSettings.minCount, scatterSettings.maxCount] as [number, number]
            : set.shapeCountRange;

          const setGenMode: ShapeTypeGenMode = (set.shapeTypeGenMode ?? 'random') as ShapeTypeGenMode;
          const setCount = setGenMode === 'fixed'
            ? fixedModeCount(set.enabledShapeTypes as SupportedShapeType[], set.shapeTypeFixedCounts)
            : effectiveCountMode === 'fixed'
              ? effectiveCountFixed
              : Math.floor(Math.random() * (effectiveCountRange[1] - effectiveCountRange[0] + 1)) + effectiveCountRange[0];

          console.log(`🎯 Generating ${setCount} shapes for set "${set.name}" (genMode=${setGenMode}, isCurrentSet=${!!isCurrentSet}, countMode=${effectiveCountMode})`);
          let setShapes = generateShapesWithBatchConfig(
            setCount,
            canvasBounds,
            true,
            setIndex,
            isCurrentSet ? undefined : set.shapeSpecificProperties,
            {
              enabledShapeTypes: new Set(set.enabledShapeTypes),
              // For the currently-selected set, use live generationConfigSettings so BatchConfig
              // changes take effect immediately without requiring an "Apply" first.
              // Other sets still use their own saved batchConfig.
              batchConfig: isCurrentSet ? undefined : set.batchConfig,
              scatterSettings: {},
              setRepIndex: repIndex,  // Pass set repetition index for Index Driver feature
              setTransform: set.setTransform,
              artboardAlignment: set.artboardAlignment,
              shapeTypeGenMode: setGenMode,
              shapeTypeWeights: set.shapeTypeWeights,
              shapeTypeFixedCounts: set.shapeTypeFixedCounts,
              shapeTypeSequence: set.shapeTypeSequence,
            }
          );

          // Apply z-index offset based on generation order (1000x spacing ensures sets never overlap)
          setShapes.forEach(shape => {
            shape.properties.zIndex += set.generationOrder * 1000;
          });

          // NOTE: Do NOT assign set's compositing operation to individual shapes
          // Compositing operations should only be applied BETWEEN sets, not WITHIN sets
          // Shapes within a set should always use 'source-over' to combine properly
          // The set-level compositing is handled during rendering (Canvas.tsx for live, Sidebar.tsx for batch)

          // Apply set visibility and opacity
          if (set.setVisibility) {
            if (!set.setVisibility.visible) {
              console.log(`👁️ Set "${set.name}" is hidden, skipping render`);
              return; // Skip this set entirely if not visible
            }
            
            if (set.setVisibility.opacity < 1 || set.setVisibility.opacityVariance > 0) {
              console.log(`🌫️ Applying set opacity ${set.setVisibility.opacity} with variance ${set.setVisibility.opacityVariance} to set "${set.name}"`);
              setShapes.forEach(shape => {
                const variance = (Math.random() - 0.5) * 2 * set.setVisibility.opacityVariance;
                const finalOpacity = Math.max(0, Math.min(1, set.setVisibility.opacity + variance));
                
                // Apply to both fill and stroke opacity
                shape.properties.fillOpacity *= finalOpacity;
                shape.properties.strokeOpacity *= finalOpacity;
              });
            }
          }

          // Apply setTransform if configured
          if (set.setTransform && (set.setTransform.x !== 0 || set.setTransform.y !== 0 || 
              set.setTransform.rotation !== 0 || set.setTransform.scaleX !== 1 || set.setTransform.scaleY !== 1)) {
            console.log(`🔄 Applying setTransform to set "${set.name}": x=${set.setTransform.x}, y=${set.setTransform.y}, rotation=${set.setTransform.rotation}, scaleX=${set.setTransform.scaleX}, scaleY=${set.setTransform.scaleY}`);
            
            setShapes.forEach(shape => {
              // Apply translation
              shape.transform.x += set.setTransform!.x;
              shape.transform.y += set.setTransform!.y;
              
              // Apply rotation
              shape.transform.rotation += set.setTransform!.rotation;
              
              // Apply scale
              shape.transform.scaleX *= set.setTransform!.scaleX;
              shape.transform.scaleY *= set.setTransform!.scaleY;
            });
          }

          // NOTE: artboardAlignment.fitToArtboard is now handled inside generateShapesWithBatchConfig via overrides
          // Skip duplicate set-level fitToArtboard since it was already applied above
          // Only apply set-level alignment (alignTo) if NOT using fitToArtboard
          if (set.artboardAlignment && !set.artboardAlignment.fitToArtboard && set.artboardAlignment.alignTo !== 'none' && currentArtboard) {
            console.log(`🎯 Applying alignment for set "${set.name}": ${set.artboardAlignment.alignmentType}`);
            
            // Calculate bounding box center
            if (setShapes.length > 0) {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              
              setShapes.forEach(shape => {
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
              const margin = set.artboardAlignment.margin || 0;
              const marginTop = typeof margin === 'number' ? margin : margin.top;
              const marginBottom = typeof margin === 'number' ? margin : margin.bottom;
              const marginLeft = typeof margin === 'number' ? margin : margin.left;
              const marginRight = typeof margin === 'number' ? margin : margin.right;
              
              // Calculate target position based on alignment type
              let targetX = currentArtboard.x + currentArtboard.width / 2;
              let targetY = currentArtboard.y + currentArtboard.height / 2;
              
              switch (set.artboardAlignment.alignmentType) {
                case 'top-left':
                  targetX = currentArtboard.x + marginLeft;
                  targetY = currentArtboard.y + marginTop;
                  break;
                case 'top-center':
                  targetX = currentArtboard.x + currentArtboard.width / 2;
                  targetY = currentArtboard.y + marginTop;
                  break;
                case 'top-right':
                  targetX = currentArtboard.x + currentArtboard.width - marginRight;
                  targetY = currentArtboard.y + marginTop;
                  break;
                case 'center-left':
                  targetX = currentArtboard.x + marginLeft;
                  targetY = currentArtboard.y + currentArtboard.height / 2;
                  break;
                case 'center':
                  targetX = currentArtboard.x + currentArtboard.width / 2;
                  targetY = currentArtboard.y + currentArtboard.height / 2;
                  break;
                case 'center-right':
                  targetX = currentArtboard.x + currentArtboard.width - marginRight;
                  targetY = currentArtboard.y + currentArtboard.height / 2;
                  break;
                case 'bottom-left':
                  targetX = currentArtboard.x + marginLeft;
                  targetY = currentArtboard.y + currentArtboard.height - marginBottom;
                  break;
                case 'bottom-center':
                  targetX = currentArtboard.x + currentArtboard.width / 2;
                  targetY = currentArtboard.y + currentArtboard.height - marginBottom;
                  break;
                case 'bottom-right':
                  targetX = currentArtboard.x + currentArtboard.width - marginRight;
                  targetY = currentArtboard.y + currentArtboard.height - marginBottom;
                  break;
              }
              
              // Calculate offset and apply to all shapes
              const offsetX = targetX - setCenterX;
              const offsetY = targetY - setCenterY;
              
              setShapes.forEach(shape => {
                shape.transform.x += offsetX;
                shape.transform.y += offsetY;
              });
              
              console.log(`✅ Aligned set to ${set.artboardAlignment.alignmentType} with offset (${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`);
            }
          }

          // ── Copy-to-Points distribution ──────────────────────────────────────────
          // Track this set's finalised shapes (after all position transforms) so that
          // later sets can look them up as destination point sources.
          // Always store the full current setShapes before any copy-to-points transform.
          {
            const existing = shapesBySetId.get(set.id) ?? [];
            shapesBySetId.set(set.id, [...existing, ...setShapes]);
          }

          // Non-current sets always use their saved batchConfig snapshot — the one written at
          // "Apply to Current Set" time. If a non-current set still has copyToPointsEnabled: true
          // pointing at a set it shouldn't (stale circular config), cycle detection in
          // topologicalSortSets will have already warned and fallen back to generationOrder.
          // To clear a stale CTP config: select the affected set, disable Copy to Points in
          // the dialog, then click "Apply to Current Set".
          const effectiveBatchConfig = isCurrentSet ? generationConfigSettings : set.batchConfig;
          if (
            effectiveBatchConfig?.copyToPointsEnabled &&
            effectiveBatchConfig?.copyToPointsConfig
          ) {
            const c2p = effectiveBatchConfig.copyToPointsConfig;
            const destShapes = shapesBySetId.get(c2p.destinationSetId);
            if (destShapes && destShapes.length > 0) {
              // Read harvest/influence config from destination set's batchConfig
              const isDestCurrentSet = c2p.destinationSetId === currentGenerationSetId;
              const destSetEntry = enabledGenerationSets.find((s: any) => s.id === c2p.destinationSetId)
                                ?? generationSets.find((s: any) => s.id === c2p.destinationSetId);
              const destBatchCfg = isDestCurrentSet ? generationConfigSettings : destSetEntry?.batchConfig;
              const targetCfg = destBatchCfg?.copyToPointsTargetConfig ?? DEFAULT_CTP_TARGET_CONFIG;
              const pts = harvestDestinationPoints(destShapes, targetCfg);
              if (pts.length > 0) {
                const copiedShapes = applyCopyToPointsDistribution(setShapes, pts, c2p, targetCfg) as Shape[];
                setShapes = copiedShapes;
                // Replace the map entry ENTIRELY with the clones (not a mix of originals + clones)
                shapesBySetId.set(set.id, copiedShapes);
                console.log(`🔵 [COPY-TO-POINTS] Set "${set.name}" → ${copiedShapes.length} shapes at ${pts.length} destination points`);
              }
            } else {
              console.warn(`⚠️ [COPY-TO-POINTS] Destination set "${c2p.destinationSetId}" not found or generated after source set "${set.name}". Ensure destination has lower generationOrder.`);
            }
          }

          // Echoes are created after placement so both live and batch exports
          // clone the same finalized originals exactly once.
          const echoed = addEchoesToShapes(
            setShapes,
            resolveEchoConfig(effectiveBatchConfig, set.echoOverride),
            repIndex,
            canvasBounds,
            previousEchoCentroid,
          );
          setShapes = echoed.shapes;
          previousEchoCentroid = echoed.previousCentroid;
          setShapes.forEach(shape => {
            (shape as any)._generationSetOrder = set.generationOrder;
          });

          // Add the generated shapes to the collection
          // Derive whether this set is currently acting as a point source by checking all other
          // enabled sets — including the current set via live generationConfigSettings.
          // This replaces the old manual useAsPointSource toggle which had to be set/cleared
          // separately and often lagged behind the actual CTP config state.
          const isEffectivelyPointSource = enabledGenerationSets.some(s => {
            if (s.id === set.id) return false;
            const cfg = (s.id === currentGenerationSetId) ? generationConfigSettings : s.batchConfig;
            return cfg?.copyToPointsEnabled && cfg?.copyToPointsConfig?.destinationSetId === set.id;
          });
          if (set.batchConfig?.hideWhenUsedAsPointSource && isEffectivelyPointSource) {
            console.log(`🙈 [COPY-TO-POINTS] Set "${set.name}" hidden (dynamically detected as point source + hideWhenUsedAsPointSource)`);
          } else {
            allNewShapes.push(...setShapes);
          }
        } // End of repetition loop
        
      });

      console.log(`✅ Generated total of ${allNewShapes.length} shapes from ${enabledGenerationSets.length} generation sets`);
      newShapes = allNewShapes;

      // Warn the user if a circular CTP config was detected during sort
      if (ctpCycleSetIds.size > 0) {
        const cycleNames = Array.from(ctpCycleSetIds)
          .map(id => generationSets.find(s => s.id === id)?.name ?? id)
          .join(', ');
        toast({
          title: 'Stale Copy to Points config detected',
          description: `Set(s) with a circular CTP config: ${cycleNames}. Select each set, disable Copy to Points, and click Apply to Current Set to clear it.`,
          variant: 'destructive',
        });
      }
    } else {
      // Fallback to scatter settings when no generation sets are enabled
      const count = scatterSettings.shapeCountMode === 'fixed' 
        ? (scatterSettings.fixedShapeCount || 10)
        : Math.floor(Math.random() * (scatterSettings.maxCount - scatterSettings.minCount + 1)) + scatterSettings.minCount;

      console.log(`🔍 generateRandomShapes: count=${count}, mode=${scatterSettings.shapeCountMode || 'range'}, using scatter settings (no generation sets)`);

      if (enabledShapeTypes.size === 0) {
        console.log(`❌ No enabled shape types, returning early`);
        return;
      }

      // Use current artboard bounds for shape placement
      const currentArtboard = artboards.find(ab => ab.id === activeArtboard);
      const canvasBounds = currentArtboard ? {
        x: currentArtboard.x,
        y: currentArtboard.y,
        width: currentArtboard.width,
        height: currentArtboard.height
      } : {
        x: -200,
        y: -200,
        width: 400,
        height: 400
      };

      // Generate shapes using the unified function
      newShapes = addEchoesToShapes(
        generateShapesWithBatchConfig(count, canvasBounds, true, 0),
        generationConfigSettings.echoSpread,
        0,
        canvasBounds,
      ).shapes;
    }

    if (newShapes.length === 0) {
      console.log(`❌ No shapes generated, returning early`);
      return;
    }

    // Add shapes to state
    setShapes(prev => {
      const currentMaxZIndex = prev.length > 0 ? Math.max(...prev.map(s => s.properties.zIndex)) : 0;
      console.log(`🔍 [STATE UPDATE] Current shapes: ${prev.length}, currentMaxZIndex: ${currentMaxZIndex}`);

      // When using generation sets, preserve the z-index offsets (1000x spacing for set grouping)
      // When NOT using generation sets, assign sequential z-indices
      const shapesWithFixedZIndex = enabledGenerationSets.length > 0 
        ? newShapes // Keep z-indices as-is (already have 1000x offset from generation sets)
        : newShapes.map((shape, index, all) => {
            // Preserve each echo's offset relative to its original in non-set mode.
            const sourceIndex = (shape as any)._isEcho
              ? all.findIndex(candidate => candidate.id === (shape as any)._sourceShapeId)
              : -1;
            const offset = sourceIndex >= 0
              ? shape.properties.zIndex - all[sourceIndex].properties.zIndex
              : 0;
            shape.properties.zIndex = currentMaxZIndex + (sourceIndex >= 0 ? sourceIndex : index) + 1 + offset;
            return shape;
          });

      const updatedShapes = [...prev, ...shapesWithFixedZIndex];
      console.log(`🔍 [AFTER ADD] Total shapes: ${updatedShapes.length}, New z-indices: [${shapesWithFixedZIndex.map(s => s.properties.zIndex).join(', ')}]`);
      return updatedShapes;
    });

    // Update incremental index if not resetting per batch
    if (generationConfigSettings.propertiesEnabled && generationConfigSettings.shapePropertiesEnabled && 
        !generationConfigSettings.incrementalResetPerBatch) {
      setLastIncrementalIndex(prev => prev + newShapes.length);
    }
  }, [enabledShapeTypes, scatterSettings, generateShapesWithBatchConfig, artboards, activeArtboard, generationConfigSettings, generationSets, calculateRepetitionCount, globalRepetitionMode, globalRepetitionValue, globalRepetitionRange, currentGenerationSetId]);

  const getTouchCenter = useCallback((touch1: React.Touch, touch2: React.Touch, canvas: HTMLCanvasElement): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    const centerX = (touch1.clientX + touch2.clientX) / 2;
    const centerY = (touch1.clientY + touch2.clientY) / 2;

    const screenX = (centerX - rect.left - rect.width / 2) / canvasSettings.zoom;
    const screenY = (centerY - rect.top - rect.height / 2) / canvasSettings.zoom;

    return {
      x: screenX - canvasSettings.panX,
      y: screenY - canvasSettings.panY
    };
  }, [canvasSettings]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - rect.width / 2;
    const mouseY = e.clientY - rect.top - rect.height / 2;

    const currentZoom = canvasSettings.zoom < 0.05 ? 1 : canvasSettings.zoom;

    // World coordinates before zoom
    const worldXBefore = (mouseX / currentZoom) - canvasSettings.panX;
    const worldYBefore = (mouseY / currentZoom) - canvasSettings.panY;

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.05, Math.min(5, currentZoom * zoomFactor));

    // World coordinates after zoom
    const worldXAfter = (mouseX / newZoom) - canvasSettings.panX;
    const worldYAfter = (mouseY / newZoom) - canvasSettings.panY;

    // Adjust pan to keep mouse position fixed
    const panDeltaX = worldXAfter - worldXBefore;
    const panDeltaY = worldYAfter - worldYBefore;

    setCanvasSettings(prev => ({
      ...prev,
      zoom: newZoom,
      panX: prev.panX + panDeltaX,
      panY: prev.panY + panDeltaY
    }));
  }, [canvasSettings]);

  // Add keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent browser scroll triggered by Space and arrow keys during any active canvas
      // interaction — pan mode, marquee selection, or shape dragging
      if ((isPanMode || isDragging) && (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        return;
      }

      // Delete selected shapes/points/segments
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editMode === 'points' && selectedPoints.length > 0) {
          // Remove points from highest to lowest index per shape so each
          // deletion preserves the indices of points that are still pending.
          const pointsByShape = new Map<string, number[]>();
          selectedPoints.forEach(({ shapeId, pointIndex }) => {
            const indexes = pointsByShape.get(shapeId) ?? [];
            indexes.push(pointIndex);
            pointsByShape.set(shapeId, indexes);
          });
          pointsByShape.forEach((pointIndexes, shapeId) => {
            const shape = shapes.find(s => s.id === shapeId);
            if (!shape?.points) return;
            pointIndexes
              .sort((a, b) => b - a)
              .forEach(pointIndex => {
                if (shape.points && shape.points.length > 3 && pointIndex >= 0 && pointIndex < shape.points.length) {
                  shape.points.splice(pointIndex, 1);
                }
              });
          });
          setSelectedPoints([]);
          setShapes(prev => [...prev]);
        } else if (editMode === 'segments' && selectedSegments.length > 0) {
          // For segments, we could split the shape or remove the segment
          setSelectedSegments([]);
        } else if (selectedShapes.length > 0) {
          setShapes(prev => prev.filter(shape => !shape.selected));
          clearSelection();
        }
      }

      // Escape to clear selection and exit pan mode
      if (e.key === 'Escape') {
        clearSelection();
        setIsMarqueeSelecting(false);
        setMarqueeStart(null);
        setMarqueeEnd(null);
        setIsPanMode(false);
      }

      // Tab to cycle through edit modes
      if (e.key === 'Tab') {
        e.preventDefault();
        setEditMode(prev => {
          switch (prev) {
            case 'shapes': return 'points';
            case 'points': return 'segments';
            case 'segments': return 'shapes';
            default: return 'shapes';
          }
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editMode, isPanMode, isDragging, selectedPoints, selectedSegments, selectedShapes, shapes, clearSelection]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = (e.clientX - rect.left - rect.width / 2) / canvasSettings.zoom;
    const screenY = (e.clientY - rect.top - rect.height / 2) / canvasSettings.zoom;
    const x = screenX - canvasSettings.panX;
    const y = screenY - canvasSettings.panY;

    // Handle middle mouse button for panning
    if (e.button === 1) {
      setDragState({
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        lastScreenX: e.clientX,
        lastScreenY: e.clientY,
        totalDeltaX: 0,
        totalDeltaY: 0
      });
      setIsDragging(true);
      return;
    }

    // Handle pan mode left click for panning
    if (e.button === 0 && isPanMode) {
      setDragState({
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        lastScreenX: e.clientX,
        lastScreenY: e.clientY,
        totalDeltaX: 0,
        totalDeltaY: 0
      });
      setIsDragging(true);
      return;
    }

    // Handle space key + left click for panning
    if (e.button === 0 && (e.metaKey || e.ctrlKey)) {
      setDragState({
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        lastScreenX: e.clientX,
        lastScreenY: e.clientY,
        totalDeltaX: 0,
        totalDeltaY: 0
      });
      setIsDragging(true);
      return;
    }

    // Initialize new drag state tracking system
    setDragState({
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      lastScreenX: e.clientX,
      lastScreenY: e.clientY,
      totalDeltaX: 0,
      totalDeltaY: 0
    });

    // Intelligent mode detection and auto-switching
    let clickedOnShape = false;
    let detectedMode: 'shapes' | 'points' | 'segments' = 'shapes';

    // First, check for point selection (highest priority)
    const pointSelected = selectPointAt(x, y, e.shiftKey);
    if (pointSelected) {
      clickedOnShape = true;
      detectedMode = 'points';
      if (editMode !== 'points') {
        // Clear shape selections when entering point mode
        shapes.forEach(shape => shape.selected = false);
        setSelectedShapes([]);
        setEditMode('points');
      }
    } else {
      // Check for segment selection
      const segmentSelected = selectSegmentAt(x, y, e.shiftKey);
      if (segmentSelected) {
        clickedOnShape = true;
        detectedMode = 'segments';
        if (editMode !== 'segments') {
          // Clear shape selections when entering segment mode
          shapes.forEach(shape => shape.selected = false);
          setSelectedShapes([]);
          setEditMode('segments');
        }
      } else {
        // Check for shape selection - iterate from highest to lowest z-index
        const sortedShapes = [...shapes].sort((a, b) => b.properties.zIndex - a.properties.zIndex);
        let topShape: Shape | null = null;

        // Find the first (topmost) shape that contains the point
        for (const shape of sortedShapes) {
          if (shape.containsPoint(x, y)) {
            topShape = shape;
            break;
          }
        }

        clickedOnShape = topShape !== null;
        if (clickedOnShape && topShape) {
          detectedMode = 'shapes';
          if (editMode !== 'shapes') {
            setEditMode('shapes');
          }

          // Preserve multi-selection if:
          // 1. Shift is held and clicking on a selected shape, OR
          // 2. Clicking on any selected shape when multiple shapes are selected (for dragging)
          const isMultiSelectDrag = topShape.selected && selectedShapes.length > 1;

          // If clicking on a selected shape with multiple selections, don't change selection
          if (!isMultiSelectDrag) {
            if (e.shiftKey) {
              // Toggle selection
              topShape.selected = !topShape.selected;
            } else {
              // Single select - clear everything including components
              clearSelection();
              setSelectedPoints([]);
              setSelectedSegments([]);
              topShape.selected = true;
            }

            const newSelectedShapes = shapes.filter(shape => shape.selected);
            setSelectedShapes(newSelectedShapes);
          }
        } else {
          // Check if clicking on already selected elements for dragging
          if (editMode === 'points') {
            clickedOnShape = selectedPoints.some(p => {
              const shape = shapes.find(s => s.id === p.shapeId);
              if (shape) {
                const worldPoint = shape.getWorldPoint(p.pointIndex);
                if (worldPoint) {
                  const distance = Math.sqrt((worldPoint.x - x) ** 2 + (worldPoint.y - y) ** 2);
                  return distance <= 8;
                }
              }
              return false;
            });
          } else if (editMode === 'segments') {
            clickedOnShape = selectedSegments.some(s => {
              const shape = shapes.find(sh => sh.id === s.shapeId);
              if (shape) {
                const worldP1 = shape.getWorldPoint(s.segmentIndex);
                const worldP2 = shape.getWorldPoint(s.segmentIndex + 1);
                if (worldP1 && worldP2) {
                  const midX = (worldP1.x + worldP2.x) / 2;
                  const midY = (worldP1.y + worldP2.y) / 2;
                  const distance = Math.sqrt((midX - x) ** 2 + (midY - y) ** 2);
                  return distance <= 8;
                }
              }
              return false;
            });
          }
        }
      }
    }

    // Start marquee selection if clicking on empty space
    if (!clickedOnShape && !e.shiftKey) {
      clearSelection();
      // Clear all component selections when starting marquee
      setSelectedPoints([]);
      setSelectedSegments([]);
      setIsMultiSelectMode(false); // exit additive mode when clicking empty space
      setMarqueeStart({ x, y });
      setIsMarqueeSelecting(false); // Will be set to true on mouse move
    }

    setIsDragging(true);
  }, [canvasSettings.zoom, canvasSettings.panX, canvasSettings.panY, editMode, isPanMode, selectPointAt, selectSegmentAt, selectedPoints, selectedSegments, shapes, selectedShapes, clearSelection]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    // Handle canvas panning (middle mouse, Cmd/Ctrl+drag, or pan mode)
    if (isDragging && dragState && (e.buttons === 4 || (e.buttons === 1 && (e.metaKey || e.ctrlKey)) || (e.buttons === 1 && isPanMode))) {
      const deltaX = (e.clientX - dragState.lastScreenX) / canvasSettings.zoom;
      const deltaY = (e.clientY - dragState.lastScreenY) / canvasSettings.zoom;

      setCanvasSettings(prev => ({
        ...prev,
        panX: prev.panX + deltaX,
        panY: prev.panY + deltaY
      }));

      setDragState(prev => prev ? {
        ...prev,
        lastScreenX: e.clientX,
        lastScreenY: e.clientY
      } : null);
      return;
    }

    // Convert screen coordinates to world coordinates - match canvas transformation
    const screenX = (e.clientX - rect.left - rect.width / 2) / canvasSettings.zoom;
    const screenY = (e.clientY - rect.top - rect.height / 2) / canvasSettings.zoom;
    const x = screenX - canvasSettings.panX;
    const y = screenY - canvasSettings.panY;

    // Start marquee selection if dragging from empty space
    if (marqueeStart && !isMarqueeSelecting && isDragging) {
      const dragDistance = Math.sqrt((x - marqueeStart.x) ** 2 + (y - marqueeStart.y) ** 2);
      if (dragDistance > 10) { // Start marquee after minimum drag distance
        setIsMarqueeSelecting(true);
      }
    }

    // Update marquee selection
    if (isMarqueeSelecting && marqueeStart) {
      setMarqueeEnd({ x, y });

      // Select shapes/points/segments within marquee
      const minX = Math.min(marqueeStart.x, x);
      const maxX = Math.max(marqueeStart.x, x);
      const minY = Math.min(marqueeStart.y, y);
      const maxY = Math.max(marqueeStart.y, y);

      if (editMode === 'shapes') {
        shapes.forEach(shape => {
          // Use world bounds for proper marquee selection
          const worldBounds = shape.getWorldBounds();
          const shapeInMarquee = worldBounds.x >= minX && worldBounds.x + worldBounds.width <= maxX &&
                               worldBounds.y >= minY && worldBounds.y + worldBounds.height <= maxY;
          if (shape.selected !== shapeInMarquee) {
            shape.selected = shapeInMarquee;
          }
        });
      } else if (editMode === 'points') {
        const newSelectedPoints: { shapeId: string; pointIndex: number }[] = [];
        shapes.forEach(shape => {
          shape.points?.forEach((point, index) => {
            // Transform point to world coordinates for marquee selection
            const worldPoint = shape.getWorldPoint(index);
            if (worldPoint) {
              const pointInMarquee = worldPoint.x >= minX && worldPoint.x <= maxX &&
                                   worldPoint.y >= minY && worldPoint.y <= maxY;
              if (pointInMarquee) {
                newSelectedPoints.push({ shapeId: shape.id, pointIndex: index });
              }
            }
          });
        });
        setSelectedPoints(newSelectedPoints);
      } else if (editMode === 'segments') {
        const newSelectedSegments: { shapeId: string; segmentIndex: number }[] = [];
        shapes.forEach(shape => {
          if (shape.points) {
            for (let i = 0; i < shape.points.length - 1; i++) {
              const worldPoint1 = shape.getWorldPoint(i);
              const worldPoint2 = shape.getWorldPoint(i + 1);
              if (worldPoint1 && worldPoint2) {
                const midX = (worldPoint1.x + worldPoint2.x) / 2;
                const midY = (worldPoint1.y + worldPoint2.y) / 2;
                const segmentInMarquee = midX >= minX && midX <= maxX &&
                                       midY >= minY && midY <= maxY;
                if (segmentInMarquee) {
                  newSelectedSegments.push({ shapeId: shape.id, segmentIndex: i });
                }
              }
            }
          }
        });
        setSelectedSegments(newSelectedSegments);
      }

      return;
    }

    if (!isDragging || !dragState) return;

    // Calculate precise delta from last position
    const deltaX = (e.clientX - dragState.lastScreenX) / canvasSettings.zoom;
    const deltaY = (e.clientY - dragState.lastScreenY) / canvasSettings.zoom;

    // Only apply movement if there's actual delta
    if (Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01) {
      // Handle different edit modes
      switch (editMode) {
        case 'points':
          if (selectedPoints.length > 0) {
            moveSelectedPoints(deltaX, deltaY);
          }
          break;
        case 'segments':
          if (selectedSegments.length > 0) {
            moveSelectedSegments(deltaX, deltaY);
          }
          break;
        default:
          if (selectedShapes.length > 0 || selectedGroups.length > 0) {
            moveSelected(deltaX, deltaY);
          }
          break;
      }

      // Update drag state with new position and accumulated delta
      setDragState(prev => prev ? {
        ...prev,
        lastScreenX: e.clientX,
        lastScreenY: e.clientY,
        totalDeltaX: prev.totalDeltaX + deltaX,
        totalDeltaY: prev.totalDeltaY + deltaY
      } : null);
    }
  }, [isDragging, dragState, editMode, isPanMode, selectedPoints.length, selectedSegments.length, selectedShapes.length, selectedGroups.length, canvasSettings.zoom, moveSelected, moveSelectedPoints, moveSelectedSegments, isMarqueeSelecting, marqueeStart, shapes]);

  const handleMouseUp = useCallback(() => {
    if (isMarqueeSelecting) {
      // Finalize marquee selection and immediately hide marquee rectangle
      setIsMarqueeSelecting(false);
      setMarqueeStart(null);
      setMarqueeEnd(null);

      // Update selected shapes array based on shape.selected flags
      const newSelectedShapes = shapes.filter(shape => shape.selected);
      setSelectedShapes(newSelectedShapes);

      // Auto-enable additive multi-select when marquee captures > 1 shape
      setIsMultiSelectMode(newSelectedShapes.length > 1);
    } else if (marqueeStart && !isMarqueeSelecting) {
      // Single click without drag - clear marquee state
      setMarqueeStart(null);
      setMarqueeEnd(null);
    }

    setIsDragging(false);
    setDragState(null);
  }, [isMarqueeSelecting, marqueeStart, shapes]);

  // Touch event handlers for mobile multi-select and marquee
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Handle multi-touch gestures
    if (e.touches.length === 2) {
      setIsMultiTouch(true);
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];

      const distance = Math.sqrt(
        Math.pow(touch2.clientX - touch1.clientX, 2) + 
        Math.pow(touch2.clientY - touch1.clientY, 2)
      );

      const angle = Math.atan2(
        touch2.clientY - touch1.clientY,
        touch2.clientX - touch1.clientX
      ) * 180 / Math.PI;

      gestureDataRef.current = {
        isActive: true,
        initialDistance: distance,
        initialAngle: angle,
        initialScale: canvasSettings.zoom,
        initialRotation: 0
      };

      return;
    }

    setIsMultiTouch(false);

    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const screenX = (touch.clientX - rect.left - rect.width / 2) / canvasSettings.zoom;
    const screenY = (touch.clientY - rect.top - rect.height / 2) / canvasSettings.zoom;
    const x = screenX - canvasSettings.panX;
    const y = screenY - canvasSettings.panY;

    setTouchStartTime(Date.now());
    setDragState({
      startScreenX: e.touches[0].clientX,
      startScreenY: e.touches[0].clientY,
      lastScreenX: e.touches[0].clientX,
      lastScreenY: e.touches[0].clientY,
      totalDeltaX: 0,
      totalDeltaY: 0
    });

    // In pan mode, skip selection and marquee entirely — just set up for panning
    if (isPanMode) {
      setIsDragging(true);
      return;
    }

    // Check if touching empty space for potential marquee selection
    let touchedShape = false;

    switch (editMode) {
      case 'points':
        touchedShape = selectPointAt(x, y, isMultiSelectMode);
        break;
      case 'segments':
        touchedShape = selectSegmentAt(x, y, isMultiSelectMode);
        break;
      default:
        touchedShape = selectShapeAtPoint(x, y, isMultiSelectMode);
        break;
    }

    if (!touchedShape && !isMultiSelectMode) {
      setMarqueeStart({ x, y });
    }

    setIsDragging(true);
  }, [canvasSettings.zoom, canvasSettings.panX, canvasSettings.panY, editMode, isPanMode, isMultiSelectMode, selectPointAt, selectSegmentAt, selectShapeAtPoint]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Handle multi-touch zoom and rotate
    if (e.touches.length === 2 && gestureDataRef.current.isActive) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];

      const currentDistance = Math.sqrt(
        Math.pow(touch2.clientX - touch1.clientX, 2) + 
        Math.pow(touch2.clientY - touch1.clientY, 2)
      );

      const scale = currentDistance / gestureDataRef.current.initialDistance;
      const newZoom = Math.max(0.05, Math.min(5, gestureDataRef.current.initialScale * scale));

      // Get center point for zoom
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;
      const rect = canvas.getBoundingClientRect();
      const mouseX = centerX - rect.left - rect.width / 2;
      const mouseY = centerY - rect.top - rect.height / 2;

      // Apply zoom with center point
      const worldXBefore = (mouseX / canvasSettings.zoom) - canvasSettings.panX;
      const worldYBefore = (mouseY / canvasSettings.zoom) - canvasSettings.panY;
      const worldXAfter = (mouseX / newZoom) - canvasSettings.panX;
      const worldYAfter = (mouseY / newZoom) - canvasSettings.panY;

      setCanvasSettings(prev => ({
        ...prev,
        zoom: newZoom,
        panX: prev.panX + (worldXAfter - worldXBefore),
        panY: prev.panY + (worldYAfter - worldYBefore)
      }));

      return;
    }

    // Single touch handling
    if (!dragState || e.touches.length > 1) return;

    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const screenX = (touch.clientX - rect.left - rect.width / 2) / canvasSettings.zoom;
    const screenY = (touch.clientY - rect.top - rect.height / 2) / canvasSettings.zoom;
    const x = screenX - canvasSettings.panX;
    const y = screenY - canvasSettings.panY;

    // Calculate precise delta from last position
    const deltaX = (touch.clientX - dragState.lastScreenX) / canvasSettings.zoom;
    const deltaY = (touch.clientY - dragState.lastScreenY) / canvasSettings.zoom;

    // In pan mode, always pan — never select or move shapes
    if (isPanMode) {
      setCanvasSettings(prev => ({
        ...prev,
        panX: prev.panX + deltaX,
        panY: prev.panY + deltaY
      }));
      setDragState(prev => prev ? {
        ...prev,
        lastScreenX: touch.clientX,
        lastScreenY: touch.clientY
      } : null);
      return;
    }

    // Check if we should start marquee selection on touch devices
    if (marqueeStart && !isMarqueeSelecting && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
      setIsMarqueeSelecting(true);
      clearSelection();
    }

    // Handle marquee selection for touch
    if (isMarqueeSelecting && marqueeStart) {
      setMarqueeEnd({ x, y });

      // Select shapes within marquee rectangle
      const minX = Math.min(marqueeStart.x, x);
      const maxX = Math.max(marqueeStart.x, x);
      const minY = Math.min(marqueeStart.y, y);
      const maxY = Math.max(marqueeStart.y, y);

      shapes.forEach(shape => {
        // Check if shape center is within marquee bounds
        const shapeCenterX = shape.transform.x;
        const shapeCenterY = shape.transform.y;

        const shapeInMarquee = shapeCenterX >= minX && shapeCenterX <= maxX &&
                              shapeCenterY >= minY && shapeCenterY <= maxY;
        shape.selected = shapeInMarquee;
      });

      return;
    }

    // Handle shape/point/segment dragging or canvas panning
    if (isDragging && (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5)) {
      let handledDrag = false;

      switch (editMode) {
        case 'points':
          if (selectedPoints.length > 0) {
            moveSelectedPoints(deltaX, deltaY);
            handledDrag = true;
          }
          break;
        case 'segments':
          if (selectedSegments.length > 0) {
            moveSelectedSegments(deltaX, deltaY);
            handledDrag = true;
          }
          break;
        default:
          if (selectedShapes.length > 0 || selectedGroups.length > 0) {
            moveSelected(deltaX, deltaY);
            handledDrag = true;
          }
          break;
      }

      // If no shapes/points/segments were moved, pan the canvas
      if (!handledDrag) {
        setCanvasSettings(prev => ({
          ...prev,
          panX: prev.panX + deltaX,
          panY: prev.panY + deltaY
        }));
      }

      setDragState(prev => prev ? {
        ...prev,
        lastScreenX: touch.clientX,
        lastScreenY: touch.clientY,
        totalDeltaX: prev.totalDeltaX + deltaX,
        totalDeltaY: prev.totalDeltaY + deltaY
      } : null);
    }
  }, [isDragging, dragState, editMode, isPanMode, selectedPoints.length, selectedSegments.length, selectedShapes.length, selectedGroups.length, canvasSettings.zoom, moveSelected, moveSelectedPoints, moveSelectedSegments]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    // Prevent default browser touch behavior
    e.preventDefault();

    const touchDuration = Date.now() - touchStartTime;

    // Reset multi-touch state when touches end
    if (e.touches.length < 2) {
      gestureDataRef.current = {
        isActive: false,
        initialDistance: 0,
        initialAngle: 0,
        initialScale: 1,
        initialRotation: 0
      };
      setIsMultiTouch(false);
    }

    // Handle marquee selection completion
    if (isMarqueeSelecting) {
      setIsMarqueeSelecting(false);
      setMarqueeStart(null);
      setMarqueeEnd(null);

      // Update selected shapes array based on shape.selected flags
      const newSelectedShapes = shapes.filter(shape => shape.selected);
      setSelectedShapes(newSelectedShapes);
    } else if (!isDragging && dragState && e.touches.length === 0) {
      // This was a tap, not a drag
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const screenX = (e.changedTouches[0].clientX - rect.left - rect.width / 2) / canvasSettings.zoom;
        const screenY = (e.changedTouches[0].clientY - rect.top - rect.height / 2) / canvasSettings.zoom;
        const x = screenX - canvasSettings.panX;
        const y = screenY - canvasSettings.panY;

        switch (editMode) {
          case 'points':
            selectPointAt(x, y, isMultiSelectMode);
            break;
          case 'segments':
            selectSegmentAt(x, y, isMultiSelectMode);
            break;
          default:
            selectShapeAtPoint(x, y, isMultiSelectMode);
            break;
        }
      }
    }

    setIsDragging(false);
    setDragState(null);
    setTouchStartTime(0);
    setMarqueeStart(null);
    setMarqueeEnd(null);
  }, [touchStartTime, isMultiSelectMode, isDragging, dragState, canvasSettings.zoom, editMode, selectShapeAtPoint, selectPointAt, selectSegmentAt, isMarqueeSelecting, shapes]);

  const toggleSelectionMode = useCallback(() => {
    const next = !isSelectionMode;
    setIsSelectionMode(next);
    if (next) setIsPanMode(false);
  }, [isSelectionMode]);

  const togglePanMode = useCallback(() => {
    const next = !isPanMode;
    setIsPanMode(next);
    if (next) {
      setIsSelectionMode(false);
      setIsMultiSelectMode(false);
    }
  }, [isPanMode]);

  const changeBlendMode = useCallback((blendMode: BlendMode) => {
    selectedShapes.forEach(shape => {
      shape.properties.blendMode = blendMode;
    });
    setShapes(prev => [...prev]);
  }, [selectedShapes]);

  // Artboard management
  const addArtboard = useCallback((preset: any) => {
    // Center the artboard on the canvas (stack them on top of each other)
    const centerX = -preset.width / 2;
    const centerY = -preset.height / 2;

    const newArtboardId = `artboard_${Date.now()}`;
    const newArtboard: Artboard = {
      id: newArtboardId,
      name: `${preset.name}`,
      x: centerX,
      y: centerY,
      width: preset.width,
      height: preset.height,
      dpi: preset.dpi ?? 72,
      unitType: preset.unitType ?? 'pixels',
      backgroundColor: preset.backgroundColor ?? '#ffffff',
      displayGrid: true,
      displayBorder: false,
      preset: preset.name,
      category: preset.category,
      printConfig: getEffectivePrintConfig({
        dpi: preset.dpi ?? 72,
        unitType: preset.unitType ?? 'pixels',
        backgroundColor: preset.backgroundColor ?? '#ffffff',
      })
    };
    setArtboards(prev => [...prev, newArtboard]);
    // Automatically select the newly created artboard
    setActiveArtboard(newArtboardId);
  }, []);

  const selectArtboard = useCallback((artboardId: string) => {
    // Get current and new artboard dimensions for grid recalculation
    const currentArtboardObj = artboards.find(ab => ab.id === activeArtboard);
    const newArtboardObj = artboards.find(ab => ab.id === artboardId);
    
    // If switching to a different artboard with different dimensions, recalculate grid settings
    if (currentArtboardObj && newArtboardObj && 
        (currentArtboardObj.width !== newArtboardObj.width || 
         currentArtboardObj.height !== newArtboardObj.height)) {
      
      console.log(`🔄 Grid recalculation: switching from ${currentArtboardObj.width}×${currentArtboardObj.height} to ${newArtboardObj.width}×${newArtboardObj.height}`);
      
      // Recalculate grid settings for the new artboard dimensions
      const updatedGridSettings = recalculateGridForArtboard(
        {
          gridRows: generationConfigSettings.gridRows,
          gridColumns: generationConfigSettings.gridColumns,
          gridStartX: generationConfigSettings.gridStartX,
          gridStartY: generationConfigSettings.gridStartY,
          gridRowOffset: generationConfigSettings.gridRowOffset,
          gridColumnOffset: generationConfigSettings.gridColumnOffset,
          gridMarginEnabled: generationConfigSettings.gridMarginEnabled,
          gridMarginMode:    generationConfigSettings.gridMarginMode,
          gridMarginUnit:    generationConfigSettings.gridMarginUnit,
          gridMarginTop:     generationConfigSettings.gridMarginTop,
          gridMarginRight:   generationConfigSettings.gridMarginRight,
          gridMarginBottom:  generationConfigSettings.gridMarginBottom,
          gridMarginLeft:    generationConfigSettings.gridMarginLeft,
        },
        { width: currentArtboardObj.width, height: currentArtboardObj.height },
        { width: newArtboardObj.width, height: newArtboardObj.height }
      );
      
      console.log(`🔄 Grid updated: spacing ${generationConfigSettings.gridColumnOffset}×${generationConfigSettings.gridRowOffset} → ${updatedGridSettings.gridColumnOffset}×${updatedGridSettings.gridRowOffset}`);
      
      // Update the generation config settings with recalculated grid values
      setGenerationConfigSettings(prev => ({
        ...prev,
        gridStartX: updatedGridSettings.gridStartX,
        gridStartY: updatedGridSettings.gridStartY,
        gridRowOffset: updatedGridSettings.gridRowOffset,
        gridColumnOffset: updatedGridSettings.gridColumnOffset,
        ...(updatedGridSettings.gridMarginTop    !== undefined && { gridMarginTop:    updatedGridSettings.gridMarginTop }),
        ...(updatedGridSettings.gridMarginRight  !== undefined && { gridMarginRight:  updatedGridSettings.gridMarginRight }),
        ...(updatedGridSettings.gridMarginBottom !== undefined && { gridMarginBottom: updatedGridSettings.gridMarginBottom }),
        ...(updatedGridSettings.gridMarginLeft   !== undefined && { gridMarginLeft:   updatedGridSettings.gridMarginLeft }),
      }));
    }
    
    setActiveArtboard(artboardId);
  }, [artboards, activeArtboard, generationConfigSettings]);

  const deleteArtboard = useCallback((artboardId: string) => {
    setArtboards(prev => {
      if (prev.length <= 1) return prev; // Keep at least one artboard
      const remaining = prev.filter(ab => ab.id !== artboardId);
      // If we're deleting the active artboard, select the first remaining one
      if (activeArtboard === artboardId && remaining.length > 0) {
        setActiveArtboard(remaining[0].id);
      }
      return remaining;
    });
  }, [activeArtboard]);

  const updateArtboard = useCallback((artboardId: string, updates: Partial<Artboard>) => {
    setArtboards(prev => prev.map(ab => {
      if (ab.id !== artboardId) return ab;
      const updated = { ...ab, ...updates };
      return {
        ...updated,
        printConfig: getEffectivePrintConfig(updated),
      };
    }));
  }, []);

  const distributeSelected = useCallback(() => {
    if (selectedShapes.length < 2) return;

    // Sort shapes by position for proper distribution
    const sortedShapes = [...selectedShapes].sort((a, b) => a.transform.x - b.transform.x);

    const firstX = sortedShapes[0].transform.x;
    const lastX = sortedShapes[sortedShapes.length - 1].transform.x;
    const totalDistance = lastX - firstX;

    if (totalDistance === 0) return;

    const spacing = totalDistance / (sortedShapes.length - 1);

    sortedShapes.forEach((shape, index) => {
      if (index > 0 && index < sortedShapes.length - 1) {
        shape.transform.x = firstX + spacing * index;
      }
    });

    setShapes(prev => [...prev]);
  }, [selectedShapes]);

  const updateGenerationConfigSettings = useCallback((updates: Partial<BatchConfigSettings>) => {
    setGenerationConfigSettings(prev => ({ ...prev, ...updates }));
    // Live-apply render-mode properties to existing shapes so the canvas updates immediately
    // without requiring a full regeneration. Shapes baked at generation time get the new values.
    const hasRenderChange = 'renderModeOverride' in updates || 'shapeRenderMode' in updates || 'wireConfig' in updates;
    if (hasRenderChange) {
      setShapes(prev => {
        if (prev.length === 0) return prev;
        prev.forEach(s => {
          if ('renderModeOverride' in updates) s.renderModeOverride = updates.renderModeOverride;
          if ('shapeRenderMode' in updates) s.shapeRenderMode = updates.shapeRenderMode as any;
          if ('wireConfig' in updates) s.wireConfig = updates.wireConfig as any;
        });
        return [...prev]; // new array ref triggers canvas re-render
      });
    }

    // Sync certain settings into the active generation set's batchConfig immediately so they
    // persist across reloads without requiring the user to click "Apply to Current Set".
    // This covers: render-mode overrides AND gridFillEnabled (layout preference).
    const hasSetSyncChange = hasRenderChange || 'gridFillEnabled' in updates;
    if (hasSetSyncChange && currentGenerationSetId) {
      setGenerationSets(prev => prev.map(set => {
        if (set.id !== currentGenerationSetId) return set;
        return {
          ...set,
          batchConfig: { ...set.batchConfig, ...updates },
        };
      }));
    }
  }, [currentGenerationSetId]);

  // Lightweight updater for live (pre-Apply) updates that should NOT trigger shape re-renders.
  // Use this for transient UI changes (e.g. CTP label settings) where only generation config
  // state needs updating — no render-mode side effects, no setShapes call.
  const updateGenerationConfigSettingsLive = useCallback((updates: Partial<BatchConfigSettings>) => {
    setGenerationConfigSettings(prev => ({ ...prev, ...updates }));
  }, []);

  // Project loading functionality (minimal - shapes and artboard only)
  const onLoadProject = useCallback((data: {
    shapes: any[];
    groups: any[];
    artboard: {
      width: number;
      height: number;
      backgroundColor: string;
      dpi?: number;
      unitType?: 'pixels' | 'mm' | 'cm' | 'inches';
      printConfig?: PrintConfig;
    };
  }) => {
    console.log('🔄 Loading project with minimal data:', data);

    // Clear current shapes and selections
    setShapes([]);
    setGroups([]);
    setSelectedShapes([]);
    setSelectedGroups([]);

    // Convert plain objects back to Shape instances
    const shapeInstances = (data.shapes || []).map((shapeData: any) => {
      // Create a new Shape instance
      const shape = new Shape(shapeData.type, shapeData.transform.x, shapeData.transform.y);

      // Copy all properties from saved data
      Object.assign(shape, shapeData);

      // Ensure the shape has all required methods by creating a proper instance
      return shape;
    });

    // Convert groups if needed
    const groupInstances = (data.groups || []).map((groupData: any) => {
      return groupData;
    });

    // Load shapes and groups
    setShapes(shapeInstances);
    setGroups(groupInstances);

    // Update the active artboard and normalize its duplicated print output specs.
    if (data.artboard) {
      updateArtboard(activeArtboard, {
        width: data.artboard.width,
        height: data.artboard.height,
        backgroundColor: data.artboard.backgroundColor,
        dpi: data.artboard.dpi,
        unitType: data.artboard.unitType,
        printConfig: data.artboard.printConfig,
      });
    }

    console.log('✅ Project loaded successfully with', shapeInstances.length, 'shapes');

    // Log shape positions for debugging
    if (shapeInstances.length > 0) {
      console.log('📍 First few shape positions:', shapeInstances.slice(0, 3).map(s => ({
        id: s.id,
        type: s.type,
        x: s.transform.x,
        y: s.transform.y
      })));
    }
  }, [activeArtboard, updateArtboard]);

  return {
    // State
    shapes,
    setShapes,
    groups,
    selectedShapes,
    selectedGroups,
    enabledShapeTypes,
    scatterSettings,
    generationConfigSettings,
    canvasSettings,
    updateCanvasSettings,
    artboards,
    activeArtboard,
    
    // Generation Sets state for bi-directional sync
    generationSets,
    currentGenerationSetId,
    overlayManagerState,
    handleOverlayManagerStateChange,
    saveOverlayManagerState,
    batchExportCount,
    generationCountMode,
    
    // Global repetition settings
    globalRepetitionMode,
    globalRepetitionValue,
    globalRepetitionRange,
    setGlobalRepetitionMode,
    setGlobalRepetitionValue,
    setGlobalRepetitionRange,
    selectedCount: selectedShapes.length + selectedGroups.length,
    selectedPointsCount: selectedPoints.length,
    selectedSegmentsCount: selectedSegments.length,
    editMode,
    selectedPoints,
    selectedSegments,
    marqueeStart,
    marqueeEnd,
    isMarqueeSelecting,
    isTouchDevice,
    isMultiTouch,
    isMultiSelectMode,
    isSelectionMode,
    isPanMode,
    showMultiSelectButton,
    showSelectedCount,
    setShowMultiSelectButton,
    setShowSelectedCount,

    // Canvas interaction
    canvasRef,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleWheel,

    // Actions
    toggleShapeType,
    updateScatterSettings,
    updateGenerationConfigSettings,
    updateGenerationConfigSettingsLive,
    
    // Generation Sets handlers for bi-directional sync
    handleGenerationSetsChange,
    handleCurrentGenerationSetChange,
    handleBatchExportCountChange,
    handleGenerationCountModeChange,
    handleCreateGenerationSet,
    handleDeleteGenerationSet,
    reloadGenerationSetsFromDB,
    onOpenGenerationSetsManager: handleOpenGenerationSetsManager,
    onCloseGenerationSetsManager: handleCloseGenerationSetsManager,
    isSetsManagerOpen,
    generateUniqueSetName,
    restoreUIStateFromSet,
    applyCurrentUIStateToSet,
    updateGenerationSetPartial,
    hasUnsavedChanges,
    areSetsEnabled,
    generateRandomShapes,
    generateShapesWithBatchConfig,
    scatterOnShape,
    clearSelection,
    setEditMode,
    toggleSelectionMode,
    togglePanMode,
    changeBlendMode,

    // Canvas controls
    zoomIn: () => {
      const currentZoom = canvasSettings.zoom || 1;
      updateCanvasSettings({ zoom: Math.min(5, currentZoom * 1.2) });
    },
    zoomOut: () => {
      const currentZoom = canvasSettings.zoom || 1;
      updateCanvasSettings({ zoom: Math.max(0.05, currentZoom / 1.2) });
    },
    resetView: () => {
      // Find the active artboard and center on it
      const artboard = artboards.find(ab => ab.id === activeArtboard);
      if (artboard) {
        // Center the view on the artboard
        const centerX = -(artboard.x + artboard.width / 2);
        const centerY = -(artboard.y + artboard.height / 2);
        updateCanvasSettings({ zoom: 1, panX: centerX, panY: centerY });
      } else {
        // Default reset if no artboard is active
        updateCanvasSettings({ zoom: 1, panX: 0, panY: 0 });
      }
    },
    fitToArtboard: () => {
      // Find the active artboard
      const artboard = artboards.find(ab => ab.id === activeArtboard);
      if (!artboard || !canvasRef.current) return;
      
      // Get canvas viewport dimensions
      const canvas = canvasRef.current;
      const viewportWidth = canvas.clientWidth;
      const viewportHeight = canvas.clientHeight;
      
      // Calculate zoom to fit artboard with 10% padding
      const paddingFactor = 0.9;
      const zoomX = (viewportWidth * paddingFactor) / artboard.width;
      const zoomY = (viewportHeight * paddingFactor) / artboard.height;
      const zoom = Math.min(zoomX, zoomY, 5); // Cap at max zoom of 5
      
      // Center the artboard in the viewport
      const centerX = -(artboard.x + artboard.width / 2);
      const centerY = -(artboard.y + artboard.height / 2);
      
      updateCanvasSettings({ zoom, panX: centerX, panY: centerY });
    },

    // Transform operations
    moveBy: (x: number, y: number) => moveSelected(x, y),
    scaleBy: (x: number, y: number) => {
      selectedShapes.forEach(shape => {
        shape.transform.scaleX *= x;
        shape.transform.scaleY *= y;
      });
      setShapes(prev => [...prev]);
    },
    rotateBy: (angle: number) => {
      selectedShapes.forEach(shape => {
        shape.transform.rotation += angle;
      });
      setShapes(prev => [...prev]);
    },
    skewBy: (x: number, y: number) => {
      selectedShapes.forEach(shape => {
        shape.transform.skewX += x;
        shape.transform.skewY += y;
      });
      setShapes(prev => [...prev]);
    },
    flipHorizontal: () => {
      selectedShapes.forEach(shape => {
        shape.transform.scaleX *= -1;
      });
      setShapes(prev => [...prev]);
    },
    flipVertical: () => {
      selectedShapes.forEach(shape => {
        shape.transform.scaleY *= -1;
      });
      setShapes(prev => [...prev]);
    },

    // Layer operations
    deleteSelected: () => {
      setShapes(prev => prev.filter(shape => !shape.selected));
      clearSelection();
    },
    clearAllShapes: () => {
      setShapes([]);
      setGroups([]);
      clearSelection();
    },
    bringToFront: () => {
      const maxZ = Math.max(...shapes.map(s => s.properties.zIndex), 0);
      selectedShapes.forEach(shape => {
        shape.properties.zIndex = maxZ + 1;
      });
      setShapes(prev => [...prev]);
    },
    sendToBack: () => {
      const minZ = Math.min(...shapes.map(s => s.properties.zIndex), 0);
      selectedShapes.forEach(shape => {
        shape.properties.zIndex = minZ - 1;
      });
      setShapes(prev => [...prev]);
    },
    bringForward: () => {
      selectedShapes.forEach(shape => {
        shape.properties.zIndex += 1;
      });
      setShapes(prev => [...prev]);
    },
    sendBackward: () => {
      selectedShapes.forEach(shape => {
        shape.properties.zIndex -= 1;
      });
      setShapes(prev => [...prev]);
    },

    // Group operations
    composeShapes: () => {
      if (selectedShapes.length < 2) return;

      const newGroup = new ShapeGroupClass([...selectedShapes]);
      selectedShapes.forEach(shape => {
        shape.selected = false;
      });

      setGroups(prev => [...prev, newGroup]);
      setSelectedShapes([]);
      setSelectedGroups([newGroup]);
    },
    canComposeShapes: selectedShapes.length >= 2,

    // Artboard operations
    addArtboard,
    selectArtboard,
    deleteArtboard,
    updateArtboard,
    distributeSelected,

    // Boolean operations
    applyBooleanOperation: useCallback((operation: 'union' | 'subtract' | 'intersect' | 'exclude', targetId: string) => {
      if (selectedShapes.length !== 1) return;

      const sourceShape = selectedShapes[0];
      const targetShape = shapes.find(s => s.id === targetId);

      if (!targetShape) return;

      const result = BooleanOperations.applyBooleanOperation(sourceShape, targetShape, operation);

      if (result) {
        // Remove both original shapes and add the result
        const newShapes = shapes.filter(shape => 
          shape.id !== sourceShape.id && shape.id !== targetId
        );
        newShapes.push(result);

        setShapes(newShapes);
        setSelectedShapes([result]);
        console.log(`${operation.charAt(0).toUpperCase() + operation.slice(1)} operation completed successfully.`);
      } else {
        console.warn(`Cannot perform ${operation}: shapes do not intersect or are incompatible.`);
      }
    }, [selectedShapes, shapes, setShapes, setSelectedShapes]),

    // Color manipulation
    applyColorManipulation: useCallback((manipulation: ColorManipulation) => {
      const targetShapes = selectedShapes.length > 0 ? selectedShapes : shapes;

      if (manipulation.mode === 'shift' && manipulation.hslShift) {
        targetShapes.forEach(shape => {
          if (manipulation.affectFill && shape.properties.fillColor !== 'none') {
            shape.properties.fillColor = ColorUtils.applyHSLShift(
              shape.properties.fillColor, 
              manipulation.hslShift!
            );
          }
          if (manipulation.affectStroke && shape.properties.strokeColor !== 'none') {
            shape.properties.strokeColor = ColorUtils.applyHSLShift(
              shape.properties.strokeColor, 
              manipulation.hslShift!
            );
          }
        });
      } else if (manipulation.mode === 'remap' && manipulation.remappings) {
        targetShapes.forEach(shape => {
          if (manipulation.affectFill && shape.properties.fillColor !== 'none') {
            shape.properties.fillColor = ColorUtils.applyColorRemapping(
              shape.properties.fillColor, 
              manipulation.remappings!
            );
          }
          if (manipulation.affectStroke && shape.properties.strokeColor !== 'none') {
            shape.properties.strokeColor = ColorUtils.applyColorRemapping(
              shape.properties.strokeColor, 
              manipulation.remappings!
            );
          }
        });
      }

      setShapes(prev => [...prev]);
    }, [selectedShapes, shapes]),

    // Project management
    onLoadProject,
    setGroups,
    setCanvasSettings,
    setScatterSettings,
    setEnabledShapeTypes: useCallback((value: Set<ShapeType> | ((prev: Set<ShapeType>) => Set<ShapeType>)) => {
      setEnabledShapeTypes(value);
    }, []),

    // Generator state loader (atomic — avoids stale-closure restore race)
    handleImportedConfigurationState,
  };
};