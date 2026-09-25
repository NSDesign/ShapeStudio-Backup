import { useState, useCallback, useMemo } from 'react';
import { 
  GenerationSet, 
  ShapeCountMode, 
  SupportedShapeType, 
  BatchConfigSettings,
  DEFAULT_GENERATION_SET_LIMITS,
  ZIndexConfig,
  DEFAULT_Z_INDEX_CONFIG
} from '@shared/schema';
import { ScatterSettings, ShapeType } from '@/lib/shapeTypes';
import { generateUniqueSetName as generateUniqueName } from '@/utils/nameGeneration';

// Convert client ShapeType to shared SupportedShapeType
const convertToSupportedShapeType = (shapeTypes: Set<ShapeType>): SupportedShapeType[] => {
  return Array.from(shapeTypes) as SupportedShapeType[];
};

// Convert shared SupportedShapeType to client ShapeType
const convertToShapeType = (shapeTypes: SupportedShapeType[]): Set<ShapeType> => {
  return new Set(shapeTypes as ShapeType[]);
};

// State interface for current UI values
export interface CurrentUIState {
  enabledShapeTypes: Set<ShapeType>;
  scatterSettings: ScatterSettings;
  batchConfigSettings: BatchConfigSettings;
  shapeCountMode: ShapeCountMode;
  shapeCountFixed: number;
  shapeCountRange: [number, number];
}

// Props interface for the hook
interface UseGenerationSetsProps {
  initialSets?: GenerationSet[];
  onSetsChange?: (sets: GenerationSet[]) => void;
}

export function useGenerationSets({ 
  initialSets = [], 
  onSetsChange 
}: UseGenerationSetsProps = {}) {
  const [generationSets, setGenerationSets] = useState<GenerationSet[]>(initialSets);
  const [currentSetId, setCurrentSetId] = useState<string | null>(null);

  // Update parent when sets change
  const updateSets = useCallback((newSets: GenerationSet[]) => {
    setGenerationSets(newSets);
    onSetsChange?.(newSets);
  }, [onSetsChange]);

  // Capture current UI state into a GenerationSet
  const captureCurrentState = useCallback((
    uiState: CurrentUIState,
    setName: string,
    setId?: string
  ): GenerationSet => {
    const id = setId || `set-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    return {
      id,
      name: setName,
      enabled: true,
      enabledShapeTypes: convertToSupportedShapeType(uiState.enabledShapeTypes),
      shapeCountMode: uiState.shapeCountMode,
      shapeCountFixed: uiState.shapeCountFixed,
      shapeCountRange: uiState.shapeCountRange,
      shapeSpecificProperties: {
        // Convert scatterSettings.shapeSpecific to GenerationSet format
        ...Object.fromEntries(
          Object.entries(uiState.scatterSettings.shapeSpecific).map(([shapeType, settings]) => [
            shapeType,
            settings
          ])
        )
      },
      zIndexConfig: DEFAULT_Z_INDEX_CONFIG,
      batchConfig: { ...uiState.batchConfigSettings },
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
      generationOrder: generationSets.length > 0 ? Math.max(...generationSets.map(s => s.generationOrder)) + 1 : 0,
      description: `Generated from current settings on ${new Date().toLocaleString()}`,
      // Repetition settings (defaults to use-global mode with no repetitions)
      repetitionMode: 'use-global',
      repetitionValue: 0,
      repetitionRange: [0, 0],
      // Lock settings (defaults to all locks disabled/off)
      locks: {
        composite: false
      }
    };
  }, [generationSets]);

  // Generate unique set name with auto-increment using shared utility
  const generateUniqueSetName = useCallback((baseName?: string): string => {
    const existingNames = generationSets.map(set => set.name);
    return generateUniqueName(existingNames, baseName);
  }, [generationSets]);

  // Create a new generation set from current UI state
  const createSetFromCurrentState = useCallback((
    uiState: CurrentUIState,
    setName?: string
  ) => {
    const finalName = setName || generateUniqueSetName();
    const newSet = captureCurrentState(uiState, finalName);
    const newSets = [...generationSets, newSet];
    updateSets(newSets);
    setCurrentSetId(newSet.id);
    return newSet.id;
  }, [generationSets, captureCurrentState, updateSets, generateUniqueSetName]);

  // Update existing set with current UI state
  const updateSetWithCurrentState = useCallback((
    setId: string,
    uiState: CurrentUIState
  ) => {
    const setIndex = generationSets.findIndex(set => set.id === setId);
    if (setIndex === -1) return;

    const existingSet = generationSets[setIndex];
    const updatedSet = captureCurrentState(uiState, existingSet.name, setId);
    
    const newSets = [...generationSets];
    newSets[setIndex] = {
      ...updatedSet,
      generationOrder: existingSet.generationOrder,
      description: existingSet.description
    };
    
    updateSets(newSets);
  }, [generationSets, captureCurrentState, updateSets]);

  // Apply current UI state to set (resolves immediately, callers handle visual feedback)
  const applyCurrentUIStateToSet = useCallback(async (
    setId: string,
    uiState: CurrentUIState
  ): Promise<void> => {
    updateSetWithCurrentState(setId, uiState);
  }, [updateSetWithCurrentState]);

  // Extract UI state from a generation set
  const extractUIStateFromSet = useCallback((setId: string): CurrentUIState | null => {
    const set = generationSets.find(s => s.id === setId);
    if (!set) return null;

    return {
      enabledShapeTypes: convertToShapeType(set.enabledShapeTypes),
      scatterSettings: {
        // Convert back to ScatterSettings format - this is a simplified version
        // In practice, you'd want to merge with existing scatterSettings to preserve other properties
        shapeSpecific: set.shapeSpecificProperties
      } as ScatterSettings,
      batchConfigSettings: { ...set.batchConfig },
      shapeCountMode: set.shapeCountMode,
      shapeCountFixed: set.shapeCountFixed,
      shapeCountRange: set.shapeCountRange
    };
  }, [generationSets]);

  // Delete a generation set
  const deleteSet = useCallback((setId: string) => {
    const newSets = generationSets.filter(set => set.id !== setId);
    updateSets(newSets);
    
    // If we deleted the current set, clear selection or select first available
    if (currentSetId === setId) {
      setCurrentSetId(newSets.length > 0 ? newSets[0].id : null);
    }
  }, [generationSets, currentSetId, updateSets]);

  // Rename a generation set
  const renameSet = useCallback((setId: string, newName: string) => {
    const setIndex = generationSets.findIndex(set => set.id === setId);
    if (setIndex === -1) return;

    const newSets = [...generationSets];
    newSets[setIndex] = { ...newSets[setIndex], name: newName };
    updateSets(newSets);
  }, [generationSets, updateSets]);

  // Toggle lock state for a generation set
  const toggleSetLock = useCallback((setId: string, lockType: keyof typeof generationSets[0]['locks']) => {
    const setIndex = generationSets.findIndex(set => set.id === setId);
    if (setIndex === -1) return;

    const newSets = [...generationSets];
    const currentLockState = newSets[setIndex].locks[lockType];
    newSets[setIndex] = {
      ...newSets[setIndex],
      locks: {
        ...newSets[setIndex].locks,
        [lockType]: !currentLockState
      }
    };
    updateSets(newSets);
  }, [generationSets, updateSets]);

  // Reorder generation sets
  const reorderSets = useCallback((fromIndex: number, toIndex: number) => {
    const newSets = [...generationSets];
    const [movedSet] = newSets.splice(fromIndex, 1);
    newSets.splice(toIndex, 0, movedSet);
    
    // Update generation order
    newSets.forEach((set, index) => {
      set.generationOrder = index;
    });
    
    updateSets(newSets);
  }, [generationSets, updateSets]);

  // Get current set
  const currentSet = useMemo(() => {
    return generationSets.find(set => set.id === currentSetId) || null;
  }, [generationSets, currentSetId]);

  // Check if sets are enabled (based on batch export settings)
  const areSetsEnabled = useCallback((
    batchExportCount: number,
    generationCountMode: string
  ): boolean => {
    return batchExportCount > 1 && generationCountMode === 'fixed';
  }, []);

  return {
    // State
    generationSets,
    currentSetId,
    currentSet,
    
    // Actions
    setCurrentSetId,
    createSetFromCurrentState,
    updateSetWithCurrentState,
    applyCurrentUIStateToSet,
    extractUIStateFromSet,
    deleteSet,
    renameSet,
    toggleSetLock,
    reorderSets,
    
    // Utilities
    areSetsEnabled,
    generateUniqueSetName,
    
    // Direct set management
    updateSets
  };
}