import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Label } from '@/components/ui/label';
import { 
  Plus, 
  Copy, 
  Trash2, 
  ChevronUp, 
  ChevronDown, 
  Settings,
  Eye,
  EyeOff,
  AlertTriangle,
  GripVertical,
  CheckCircle,
  AlertCircle,
  Info,
  Lock,
  Layers2
} from 'lucide-react';
import { 
  GenerationSet, 
  ShapeCountMode, 
  SupportedShapeType,
  DEFAULT_GENERATION_SET_LIMITS,
  GenerationSetUtils,
  BatchConfigSettings
} from '@shared/schema';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { generateUniqueSetName } from '@/utils/nameGeneration';
import { IndividualSetConfig } from '@/components/IndividualSetConfig';
import { 
  GenerationSetValidator,
  ValidationResult,
  ValidationError,
  ValidationWarning
} from '@/lib/typedHelpers';
import { ErrorBoundary, SafeSection } from '@/components/ErrorBoundary';
import { ScatterSettings, ShapeType } from '@/lib/shapeTypes';
import type { CurrentUIState } from '@/hooks/useGenerationSets';

// Base props that are always available
interface GenerationSetsInterfaceBaseProps {
  generationSets: GenerationSet[];
  onGenerationSetsChange: (sets: GenerationSet[]) => void;
  validationErrors?: string[];
  maxSets?: number;
  globalZIndexEnabled?: boolean;
  showInlineValidation?: boolean;
  onValidationChange?: (isValid: boolean, errors: ValidationError[], warnings: ValidationWarning[]) => void;
  // Bi-directional sync props
  currentSetId?: string | null;
  onCurrentSetChange?: (setId: string | null) => void;
  // Callback when current set is updated (to trigger UI state restoration)
  onCurrentSetUpdate?: (setId: string) => void;
  // Mismatch detection for export count
  batchExportCount?: number;
  // Bleed settings for fitToBleed option
  bleedEnabled?: boolean;
  // Scroll-to-and-highlight the current set when this increments
  scrollToCurrentSetTrigger?: number;
}

// When onCreateSetFromState is provided, all state capture props are REQUIRED
interface GenerationSetsInterfaceWithStateCapture extends GenerationSetsInterfaceBaseProps {
  // Raw UI state props for synchronous state capture at button click time (ALL REQUIRED)
  enabledShapeTypes: Set<ShapeType>;
  scatterSettings: ScatterSettings;
  batchConfigSettings: BatchConfigSettings;
  shapeCountMode: ShapeCountMode;
  shapeCountFixed: number;
  shapeCountRange: [number, number];
  onCreateSetFromState: (uiState: CurrentUIState, name?: string) => string;
}

// When onCreateSetFromState is not provided, state capture props are not allowed
interface GenerationSetsInterfaceWithoutStateCapture extends GenerationSetsInterfaceBaseProps {
  enabledShapeTypes?: never;
  scatterSettings?: never;
  batchConfigSettings?: never;
  shapeCountMode?: never;
  shapeCountFixed?: never;
  shapeCountRange?: never;
  onCreateSetFromState?: never;
}

// Union type enforces: either ALL state props are provided, or NONE are provided
type GenerationSetsInterfaceProps = 
  | GenerationSetsInterfaceWithStateCapture 
  | GenerationSetsInterfaceWithoutStateCapture;

export function GenerationSetsInterface({
  generationSets,
  onGenerationSetsChange,
  validationErrors = [],
  maxSets = DEFAULT_GENERATION_SET_LIMITS.maxGenerationSets,
  globalZIndexEnabled = false,
  showInlineValidation = true,
  onValidationChange,
  // Bi-directional sync props
  currentSetId,
  onCurrentSetChange,
  onCurrentSetUpdate,
  // Mismatch detection for export count
  batchExportCount,
  // Bleed settings for fitToBleed option
  bleedEnabled,
  // Scroll-to-and-highlight the current set when this increments
  scrollToCurrentSetTrigger,
  // Raw UI state props for synchronous state capture
  enabledShapeTypes,
  scatterSettings,
  batchConfigSettings,
  shapeCountMode,
  shapeCountFixed,
  shapeCountRange,
  onCreateSetFromState
}: GenerationSetsInterfaceProps) {
  // Use external currentSetId if provided, otherwise fall back to internal state
  const [internalSelectedSetId, setInternalSelectedSetId] = useState<string | null>(null);
  const selectedSetId = currentSetId !== undefined ? currentSetId : internalSelectedSetId;
  const setSelectedSetId = currentSetId !== undefined ? (setId: string | null) => {
    onCurrentSetChange?.(setId);
  } : setInternalSelectedSetId;
  const [draggedSetId, setDraggedSetId] = useState<string | null>(null);
  const [dragOverSetId, setDragOverSetId] = useState<string | null>(null);
  const [setValidations, setSetValidations] = useState<Record<string, ValidationResult>>({});
  const [highlightedSetId, setHighlightedSetId] = useState<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  
  // Initialize filter state from localStorage
  const [filterType, setFilterType] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('generationSetsFilterType') || 'all';
    }
    return 'all';
  });
  const [filterValue, setFilterValue] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('generationSetsFilterValue') || '';
    }
    return '';
  });
  
  // Initialize accordion state from localStorage
  const [accordionValue, setAccordionValue] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('generationSetsAccordionValue');
      return saved ? JSON.parse(saved) : ['errors', 'warnings'];
    }
    return ['errors', 'warnings'];
  });

  // Persist filter type to localStorage
  useEffect(() => {
    localStorage.setItem('generationSetsFilterType', filterType);
  }, [filterType]);

  // Persist filter value to localStorage
  useEffect(() => {
    localStorage.setItem('generationSetsFilterValue', filterValue);
  }, [filterValue]);

  // Persist accordion value to localStorage
  useEffect(() => {
    localStorage.setItem('generationSetsAccordionValue', JSON.stringify(accordionValue));
  }, [accordionValue]);

  // Comprehensive validation for all sets
  const overallValidation = useMemo(() => {
    return GenerationSetValidator.validateGenerationSets(generationSets);
  }, [generationSets]);


  // Update parent validation state when validation changes
  useEffect(() => {
    if (onValidationChange) {
      onValidationChange(overallValidation.isValid, overallValidation.errors, overallValidation.warnings);
    }
  }, [overallValidation, onValidationChange]);
  
  // Individual set validations
  useEffect(() => {
    if (!showInlineValidation) return;
    
    const newSetValidations: Record<string, ValidationResult> = {};
    generationSets.forEach(set => {
      newSetValidations[set.id] = GenerationSetValidator.validateGenerationSet(set);
    });
    setSetValidations(newSetValidations);
  }, [generationSets, showInlineValidation]);

  // Auto-select first set if none selected and sets exist
  useEffect(() => {
    if (!selectedSetId && generationSets.length > 0) {
      setSelectedSetId(generationSets[0].id);
    }
  }, [selectedSetId, generationSets]);

  // Scroll active set into view and briefly highlight it when trigger fires
  useEffect(() => {
    if (!scrollToCurrentSetTrigger || !selectedSetId) return;
    // If the active set is filtered out, clear the filter first so it becomes visible
    const el = cardRefs.current.get(selectedSetId);
    if (!el) {
      setFilterType('all');
      setFilterValue('');
    }
    // Use a short delay to allow re-render after possible filter reset
    const scrollTimer = setTimeout(() => {
      const resolvedEl = cardRefs.current.get(selectedSetId);
      if (resolvedEl) {
        resolvedEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setHighlightedSetId(selectedSetId);
        const highlightTimer = setTimeout(() => setHighlightedSetId(null), 1500);
        return () => clearTimeout(highlightTimer);
      }
    }, 50);
    return () => clearTimeout(scrollTimer);
  }, [scrollToCurrentSetTrigger]);

  // Filter generation sets based on filter type and value
  const filteredSets = useMemo(() => {
    if (filterType === 'all' || !filterValue) {
      return generationSets;
    }

    return generationSets.filter(set => {
      switch (filterType) {
        case 'name':
          return set.id === filterValue;
        case 'hidden':
          return filterValue === 'hidden' ? !set.enabled : set.enabled;
        case 'shape-type':
          return set.enabledShapeTypes.includes(filterValue as SupportedShapeType);
        case 'count-mode':
          return set.shapeCountMode === filterValue;
        case 'distribution':
          return set.batchConfig.distributionLayoutEnabled && set.batchConfig.distributionPattern === filterValue;
        default:
          return true;
      }
    });
  }, [generationSets, filterType, filterValue]);

  // Add new generation set
  const handleAddSet = useCallback(() => {
    if (generationSets.length >= maxSets) {
      return;
    }

    // Use the generateUniqueSetName utility for consistent naming
    const existingNames = generationSets.map(set => set.name);
    const uniqueName = generateUniqueSetName(existingNames, 'Set');
    
    // Build CurrentUIState object from raw props AT BUTTON CLICK TIME
    // This ensures we capture the absolute latest values, not stale state
    if (onCreateSetFromState) {
      // Runtime assertion: ALL state capture props must be present when onCreateSetFromState is provided
      // This should be enforced by TypeScript, but we add a runtime check for safety
      // Use explicit checks to avoid rejecting valid empty values (empty Set, [0,0] range, etc.)
      const hasAllProps = 
        enabledShapeTypes instanceof Set &&
        scatterSettings !== undefined &&
        batchConfigSettings !== undefined &&
        shapeCountMode !== undefined &&
        shapeCountFixed !== undefined &&
        Array.isArray(shapeCountRange) && 
        shapeCountRange.length === 2 &&
        typeof shapeCountRange[0] === 'number' &&
        typeof shapeCountRange[1] === 'number';
        
      if (!hasAllProps) {
        console.error('❌ [STATE CAPTURE ERROR] onCreateSetFromState is provided but required state props are missing!', {
          enabledShapeTypes: enabledShapeTypes instanceof Set ? 'Set' : typeof enabledShapeTypes,
          scatterSettings: scatterSettings !== undefined ? 'present' : 'undefined',
          batchConfigSettings: batchConfigSettings !== undefined ? 'present' : 'undefined',
          shapeCountMode: shapeCountMode !== undefined ? shapeCountMode : 'undefined',
          shapeCountFixed: shapeCountFixed !== undefined ? shapeCountFixed : 'undefined',
          shapeCountRange: Array.isArray(shapeCountRange) ? 'array' : typeof shapeCountRange
        });
        throw new Error('Invalid state: onCreateSetFromState requires all state capture props to be provided');
      }
      
      const currentUIState: CurrentUIState = {
        enabledShapeTypes,
        scatterSettings,
        batchConfigSettings,
        shapeCountMode,
        shapeCountFixed,
        shapeCountRange
      };
      
      console.log('📋 [SYNC CAPTURE] Built CurrentUIState from raw props at button click:', {
        shapeTypes: Array.from(currentUIState.enabledShapeTypes),
        countMode: currentUIState.shapeCountMode,
        countFixed: currentUIState.shapeCountFixed,
        countRange: currentUIState.shapeCountRange
      });
      
      const newSetId = onCreateSetFromState(currentUIState, uniqueName);
      setSelectedSetId(newSetId);
      return;
    }
    
    // Fallback to default creation (for backwards compatibility)
    const newId = `generation_set_${Date.now()}`;
    const newSet = GenerationSetUtils.createDefault(
      newId,
      uniqueName
    );
    
    // Set generation order
    newSet.generationOrder = generationSets.length;
    
    const updatedSets = [...generationSets, newSet];
    onGenerationSetsChange(updatedSets);
    setSelectedSetId(newId);
  }, [generationSets, maxSets, onGenerationSetsChange, enabledShapeTypes, scatterSettings, batchConfigSettings, shapeCountMode, shapeCountFixed, shapeCountRange, onCreateSetFromState]);

  // Duplicate generation set
  const handleDuplicateSet = useCallback((setId: string) => {
    if (generationSets.length >= maxSets) {
      return;
    }

    const setToDuplicate = generationSets.find(set => set.id === setId);
    if (!setToDuplicate) return;

    const newId = `generation_set_${Date.now()}`;
    const duplicatedSet: GenerationSet = {
      ...setToDuplicate,
      id: newId,
      name: `${setToDuplicate.name} (Copy)`,
      generationOrder: generationSets.length
    };

    const updatedSets = [...generationSets, duplicatedSet];
    onGenerationSetsChange(updatedSets);
    setSelectedSetId(newId);
  }, [generationSets, maxSets, onGenerationSetsChange]);

  // Delete generation set
  const handleDeleteSet = useCallback((setId: string) => {
    // Allow deletion of final set to support 0-set state
    // if (generationSets.length <= 1) {
    //   return; // Prevent deleting the last set
    // }

    // Find the index of the set being deleted
    const deletedIndex = generationSets.findIndex(set => set.id === setId);
    
    const updatedSets = generationSets
      .filter(set => set.id !== setId)
      .map((set, index) => ({
        ...set,
        generationOrder: index
      }));

    onGenerationSetsChange(updatedSets);

    // Update selection if deleted set was selected
    if (selectedSetId === setId) {
      if (updatedSets.length === 0) {
        // No sets left
        setSelectedSetId(null);
      } else if (deletedIndex < updatedSets.length) {
        // Select the next set (same index position, which is now the "next" set)
        setSelectedSetId(updatedSets[deletedIndex].id);
      } else {
        // Deleted the last set, select the new last set (previous set)
        setSelectedSetId(updatedSets[updatedSets.length - 1].id);
      }
    }
  }, [generationSets, onGenerationSetsChange, selectedSetId]);

  // Update specific generation set
  const handleUpdateSet = useCallback((setId: string, updates: Partial<GenerationSet>) => {
    const updatedSets = generationSets.map(set =>
      set.id === setId ? { ...set, ...updates } : set
    );
    onGenerationSetsChange(updatedSets);
    
    // If the updated set is the currently selected set, trigger UI state restoration
    if (setId === selectedSetId && onCurrentSetUpdate) {
      console.log('🔄 [SET UPDATE] Current set was modified, triggering UI state restoration for:', setId);
      onCurrentSetUpdate(setId);
    }
  }, [generationSets, onGenerationSetsChange, selectedSetId, onCurrentSetUpdate]);

  // Toggle set enabled state
  const handleToggleSetEnabled = useCallback((setId: string) => {
    handleUpdateSet(setId, { 
      enabled: !generationSets.find(set => set.id === setId)?.enabled 
    });
  }, [generationSets, handleUpdateSet]);

  // Toggle composite lock state
  const handleToggleCompositeLock = useCallback((setId: string) => {
    const currentSet = generationSets.find(set => set.id === setId);
    if (!currentSet) return;
    
    // Safely toggle composite lock, ensuring locks object exists
    const currentLocks = currentSet.locks || { composite: false };
    handleUpdateSet(setId, {
      locks: {
        ...currentLocks,
        composite: !currentLocks.composite
      }
    });
  }, [generationSets, handleUpdateSet]);

  // Move set up/down in order
  const handleMoveSet = useCallback((setId: string, direction: 'up' | 'down') => {
    const currentIndex = generationSets.findIndex(set => set.id === setId);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= generationSets.length) return;

    const updatedSets = [...generationSets];
    [updatedSets[currentIndex], updatedSets[newIndex]] = 
    [updatedSets[newIndex], updatedSets[currentIndex]];

    // Update generation orders
    updatedSets.forEach((set, index) => {
      set.generationOrder = index;
    });

    onGenerationSetsChange(updatedSets);
  }, [generationSets, onGenerationSetsChange]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, setId: string) => {
    setDraggedSetId(setId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, setId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverSetId(setId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedSetId(null);
    setDragOverSetId(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetSetId: string) => {
    e.preventDefault();
    
    if (!draggedSetId || draggedSetId === targetSetId) return;

    const draggedIndex = generationSets.findIndex(set => set.id === draggedSetId);
    const targetIndex = generationSets.findIndex(set => set.id === targetSetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const updatedSets = [...generationSets];
    const draggedSet = updatedSets.splice(draggedIndex, 1)[0];
    updatedSets.splice(targetIndex, 0, draggedSet);

    // Update generation orders
    updatedSets.forEach((set, index) => {
      set.generationOrder = index;
    });

    onGenerationSetsChange(updatedSets);
    setDraggedSetId(null);
    setDragOverSetId(null);
  }, [draggedSetId, generationSets, onGenerationSetsChange]);

  // Calculate total shape count across all enabled sets
  const totalShapeCount = generationSets
    .filter(set => set.enabled)
    .reduce((total, set) => {
      const count = set.shapeCountMode === ShapeCountMode.FIXED 
        ? set.shapeCountFixed 
        : Math.floor((set.shapeCountRange[0] + set.shapeCountRange[1]) / 2);
      return total + count;
    }, 0);
    
  // Get validation state for a specific set
  const getSetValidation = useCallback((setId: string) => {
    return setValidations[setId] || { isValid: true, errors: [], warnings: [] };
  }, [setValidations]);
  
  // Render set validation indicator
  const renderSetValidationIndicator = useCallback((setId: string) => {
    if (!showInlineValidation) return null;
    
    const validation = getSetValidation(setId);
    
    if (validation.errors.length > 0) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertTriangle 
                className="w-4 h-4 text-red-400 cursor-help" 
                data-testid={`validation-error-indicator-${setId}`}
              />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <div className="space-y-1">
                <p className="font-medium text-red-400">Errors:</p>
                {validation.errors.map((error, index) => (
                  <p key={index} className="text-xs">{error.message}</p>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    
    if (validation.warnings.length > 0) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertCircle 
                className="w-4 h-4 text-yellow-400 cursor-help"
                data-testid={`validation-warning-indicator-${setId}`}
              />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <div className="space-y-1">
                <p className="font-medium text-yellow-400">Warnings:</p>
                {validation.warnings.map((warning, index) => (
                  <p key={index} className="text-xs">{warning.message}</p>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    
    return (
      <CheckCircle 
        className="w-4 h-4 text-green-400"
        data-testid={`validation-success-indicator-${setId}`}
      />
    );
  }, [showInlineValidation, getSetValidation]);

  const selectedSet = generationSets.find(set => set.id === selectedSetId);

  return (
    <ErrorBoundary
      resetKeys={[generationSets.length, selectedSetId]}
      onError={(error, errorInfo) => {
        console.error('GenerationSetsInterface error:', error, errorInfo);
      }}
    >
      <div className="space-y-2" data-testid="generation-sets-interface">
      {/* Header with summary */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-slate-200" data-testid="heading-generation-sets">Shape Sets</h3>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span data-testid="text-sets-count">{generationSets.length} sets</span>
            <Separator orientation="vertical" className="h-4" />
            <span data-testid="text-enabled-count">{generationSets.filter(set => set.enabled).length} enabled</span>
            <Separator orientation="vertical" className="h-4" />
            <span data-testid="text-total-shapes">~{totalShapeCount} shapes total</span>
          </div>
        </div>
        
        <Button
          onClick={handleAddSet}
          disabled={generationSets.length >= maxSets}
          size="sm"
          data-testid="button-add-generation-set"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Set
        </Button>
      </div>

        {/* Overall validation summary with accordion */}
        {showInlineValidation && (overallValidation.errors.length > 0 || overallValidation.warnings.length > 0) && (
          <div className="border border-slate-700 rounded-lg bg-slate-900/50" data-testid="validation-accordion-container">
            <Accordion type="multiple" value={accordionValue} onValueChange={setAccordionValue} className="w-full">
              {/* Errors Section */}
              {overallValidation.errors.length > 0 && (
                <AccordionItem value="errors" className="border-b border-slate-700">
                  <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-slate-800/50">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="h-4 w-4 text-red-400" />
                      <span className="text-sm font-medium text-red-400">Shape Sets Issues</span>
                      <Badge 
                        className="ml-auto bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
                        data-testid="badge-errors-count"
                      >
                        {overallValidation.errors.length}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <ul className="list-disc list-inside space-y-1 text-sm text-red-400">
                      {overallValidation.errors.map((error, index) => (
                        <li key={`error-${index}`}>{error.message}</li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              )}
              
              {/* Warnings Section */}
              {overallValidation.warnings.length > 0 && (
                <AccordionItem value="warnings" className="border-0">
                  <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-slate-800/50">
                    <div className="flex items-center gap-3">
                      <AlertCircle className="h-4 w-4 text-yellow-400" />
                      <span className="text-sm font-medium text-yellow-400">Warnings</span>
                      <Badge 
                        className="ml-auto bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/30"
                        data-testid="badge-warnings-count"
                      >
                        {overallValidation.warnings.length}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <ul className="list-disc list-inside space-y-1 text-sm text-yellow-400">
                      {overallValidation.warnings.map((warning, index) => (
                        <li key={`warning-${index}`}>{warning.message}</li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              )}
            </Accordion>
          </div>
        )}
        
        {/* Legacy validation errors for backward compatibility */}
        {validationErrors.length > 0 && (
          <Alert variant="destructive" data-testid="alert-legacy-validation-errors">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <ul className="list-disc list-inside space-y-1">
                {validationErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Filter Controls */}
        <div className="flex items-center gap-2" data-testid="filter-controls">
          <Label className="text-sm text-slate-300">Filter:</Label>
          <Select value={filterType} onValueChange={(value) => { setFilterType(value); setFilterValue(''); }}>
            <SelectTrigger className="w-[180px] bg-slate-800 border-slate-600 text-slate-200" data-testid="select-filter-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ zIndex: 10002 }}>
              <SelectItem value="all">All Sets</SelectItem>
              <SelectItem value="name">Filter by Name</SelectItem>
              <SelectItem value="hidden">Hidden Status</SelectItem>
              <SelectItem value="shape-type">Shape Type</SelectItem>
              <SelectItem value="count-mode">Count Mode</SelectItem>
              <SelectItem value="distribution">Distribution Layout</SelectItem>
            </SelectContent>
          </Select>

          {/* Dynamic value selector based on filter type */}
          {filterType === 'name' && (
            <Select value={filterValue} onValueChange={setFilterValue}>
              <SelectTrigger className="w-[180px] bg-slate-800 border-slate-600 text-slate-200" data-testid="select-filter-value">
                <SelectValue placeholder="Select set..." />
              </SelectTrigger>
              <SelectContent style={{ zIndex: 10002 }}>
                {generationSets.map(set => (
                  <SelectItem key={set.id} value={set.id}>{set.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {filterType === 'hidden' && (
            <Select value={filterValue} onValueChange={setFilterValue}>
              <SelectTrigger className="w-[180px] bg-slate-800 border-slate-600 text-slate-200" data-testid="select-filter-value">
                <SelectValue placeholder="Select status..." />
              </SelectTrigger>
              <SelectContent style={{ zIndex: 10002 }}>
                <SelectItem value="hidden">Hidden</SelectItem>
                <SelectItem value="visible">Not Hidden</SelectItem>
              </SelectContent>
            </Select>
          )}

          {filterType === 'count-mode' && (
            <Select value={filterValue} onValueChange={setFilterValue}>
              <SelectTrigger className="w-[180px] bg-slate-800 border-slate-600 text-slate-200" data-testid="select-filter-value">
                <SelectValue placeholder="Select mode..." />
              </SelectTrigger>
              <SelectContent style={{ zIndex: 10002 }}>
                <SelectItem value="fixed">Constant</SelectItem>
                <SelectItem value="range">Range</SelectItem>
              </SelectContent>
            </Select>
          )}

          {filterType === 'shape-type' && (
            <Select value={filterValue} onValueChange={setFilterValue}>
              <SelectTrigger className="w-[180px] bg-slate-800 border-slate-600 text-slate-200" data-testid="select-filter-value">
                <SelectValue placeholder="Select shape type..." />
              </SelectTrigger>
              <SelectContent style={{ zIndex: 10002 }}>
                <SelectItem value="rectangle">Rectangle</SelectItem>
                <SelectItem value="rounded-rectangle">Rounded Rectangle</SelectItem>
                <SelectItem value="square">Square</SelectItem>
                <SelectItem value="rounded-square">Rounded Square</SelectItem>
                <SelectItem value="circle">Circle</SelectItem>
                <SelectItem value="ellipse">Ellipse</SelectItem>
                <SelectItem value="triangle">Triangle</SelectItem>
                <SelectItem value="right-triangle">Right Triangle</SelectItem>
                <SelectItem value="trapezoid">Trapezoid</SelectItem>
                <SelectItem value="pentagon">Pentagon</SelectItem>
                <SelectItem value="hexagon">Hexagon</SelectItem>
                <SelectItem value="rhombus">Rhombus</SelectItem>
                <SelectItem value="parallelogram">Parallelogram</SelectItem>
                <SelectItem value="kite">Kite</SelectItem>
                <SelectItem value="semicircle">Semicircle</SelectItem>
                <SelectItem value="heart">Heart</SelectItem>
                <SelectItem value="arrow">Arrow</SelectItem>
                <SelectItem value="cross">Cross</SelectItem>
                <SelectItem value="line-vector">Line Vector</SelectItem>
                <SelectItem value="line">Line</SelectItem>
                <SelectItem value="polygon">Polygon</SelectItem>
                <SelectItem value="star">Star</SelectItem>
                <SelectItem value="chunk">Chunk</SelectItem>
                <SelectItem value="blob">Blob</SelectItem>
                <SelectItem value="ring">Ring</SelectItem>
                <SelectItem value="cubic">Cubic</SelectItem>
                <SelectItem value="bezier">Bezier</SelectItem>
                <SelectItem value="smooth-spline">Smooth Spline</SelectItem>
                <SelectItem value="spline-circle">Spline Circle</SelectItem>
                <SelectItem value="spline-ellipse">Spline Ellipse</SelectItem>
                <SelectItem value="spline-ring">Spline Ring</SelectItem>
              </SelectContent>
            </Select>
          )}

          {filterType === 'distribution' && (
            <Select value={filterValue} onValueChange={setFilterValue}>
              <SelectTrigger className="w-[180px] bg-slate-800 border-slate-600 text-slate-200" data-testid="select-filter-value">
                <SelectValue placeholder="Select layout..." />
              </SelectTrigger>
              <SelectContent style={{ zIndex: 10002 }}>
                <SelectItem value="grid">Grid</SelectItem>
                <SelectItem value="wave">Wave</SelectItem>
                <SelectItem value="ellipse">Ellipse</SelectItem>
                <SelectItem value="spiral">Spiral</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Generation Sets List */}
        <div className="lg:col-span-2 space-y-2">
          <h4 className="text-sm font-medium text-slate-300 mb-2" data-testid="heading-sets-list">
            Shape Sets List ({filterType !== 'all' && filterValue ? `${filteredSets.length} of ` : ''}{generationSets.length} set{generationSets.length !== 1 ? 's' : ''})
          </h4>
          <ScrollArea className="h-[400px]">
            <div className="space-y-2 pr-2">
              {filteredSets.map((set, index) => (
                <Card 
                  key={set.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(set.id, el);
                    else cardRefs.current.delete(set.id);
                  }}
                  className={`cursor-pointer transition-all border-slate-700 ${
                    selectedSetId === set.id 
                      ? 'bg-slate-800 border-blue-600' 
                      : 'bg-slate-900 hover:bg-slate-800'
                  } ${
                    dragOverSetId === set.id ? 'border-blue-400' : ''
                  } ${
                    highlightedSetId === set.id ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-slate-900' : ''
                  }`}
                  onClick={() => setSelectedSetId(set.id)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, set.id)}
                  onDragOver={(e) => handleDragOver(e, set.id)}
                  onDragEnd={handleDragEnd}
                  onDrop={(e) => handleDrop(e, set.id)}
                  data-testid={`card-generation-set-${set.id}`}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <GripVertical className="w-4 h-4 text-slate-500" data-testid={`handle-drag-${set.id}`} />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleSetEnabled(set.id);
                        }}
                        data-testid={`button-toggle-enabled-${set.id}`}
                        aria-label={set.enabled ? `Disable ${set.name}` : `Enable ${set.name}`}
                      >
                        {set.enabled ? (
                          <Eye className="w-3 h-3 text-green-400" data-testid={`icon-enabled-${set.id}`} />
                        ) : (
                          <EyeOff className="w-3 h-3 text-slate-500" data-testid={`icon-disabled-${set.id}`} />
                        )}
                      </Button>
                      <span className="text-xs text-slate-500" data-testid={`text-set-order-${set.id}`}>#{index + 1}</span>
                      {renderSetValidationIndicator(set.id)}
                      
                      {/* Lock Features Section */}
                      <div className="flex items-center gap-1 ml-auto">
                        {/* Lock icon - static label indicating lockable features */}
                        <Lock className="w-3 h-3 text-slate-500" data-testid={`icon-lock-label-${set.id}`} />
                        
                        {/* Composite Lock Toggle - Layers2 button */}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleCompositeLock(set.id);
                                }}
                                data-testid={`button-toggle-composite-lock-${set.id}`}
                                aria-label={set.locks?.composite ? 'Unlock composite operations' : 'Lock composite operations'}
                              >
                                <Layers2 
                                  className={`w-3 h-3 ${set.locks?.composite ? 'text-blue-400' : 'text-slate-500'}`}
                                  data-testid={`icon-composite-${set.id}`} 
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p className="text-xs">
                                {set.locks?.composite 
                                  ? 'Composite lock enabled - this set is protected from compositing operations' 
                                  : 'Composite lock disabled - click to lock compositing operations'}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>

                    <h5 className="font-medium text-slate-200 mb-1 truncate" data-testid={`text-set-name-${set.id}`}>
                      {set.name}
                    </h5>

                    <div className="flex flex-wrap gap-1 mb-2" data-testid={`container-shape-types-${set.id}`}>
                      {/* Show each set's own stored shape types */}
                      {set.enabledShapeTypes.slice(0, 3).map(shapeType => (
                        <Badge 
                          key={shapeType} 
                          variant="secondary" 
                          className="text-xs"
                          data-testid={`badge-shape-type-${set.id}-${shapeType}`}
                        >
                          {shapeType}
                        </Badge>
                      ))}
                      
                      {set.enabledShapeTypes.length > 3 && (
                        <Badge variant="secondary" className="text-xs bg-slate-600 text-slate-200 border-slate-500" data-testid={`badge-more-shapes-${set.id}`}>
                          +{set.enabledShapeTypes.length - 3}
                        </Badge>
                      )}
                    </div>

                    {/* Generation Settings Summary - Show each set's unique stored settings */}
                    <div className="text-xs text-slate-500 mb-2 space-y-1" data-testid={`generation-settings-${set.id}`}>
                      {set.batchConfig?.distributionLayoutEnabled && (
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                          <span>Layout: {set.batchConfig.distributionPattern}</span>
                        </div>
                      )}
                      {set.batchConfig?.colorHarmonyEnabled && (
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 bg-purple-400 rounded-full"></span>
                          <span>Colors: {set.batchConfig.harmonyType}</span>
                        </div>
                      )}
                      {set.batchConfig?.blendModeEnabled && (
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 bg-orange-400 rounded-full"></span>
                          <span>Blending: Enabled</span>
                        </div>
                      )}
                      {set.batchConfig?.shapePropertiesEnabled && (
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                          <span>Properties: Enabled</span>
                        </div>
                      )}
                      {set.batchConfig?.physicsEnabled && (
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 bg-red-400 rounded-full"></span>
                          <span>Physics: {set.batchConfig.physicsType}</span>
                        </div>
                      )}
                      {set.batchConfig?.transformsEnabled && (
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 bg-cyan-400 rounded-full"></span>
                          <span>Transforms: Enabled</span>
                        </div>
                      )}
                      {set.batchConfig?.copyToPointsEnabled && (
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
                          <span className="text-yellow-400">CTP: Active</span>
                        </div>
                      )}
                      {/* Set-specific configuration indicator */}
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 bg-indigo-400 rounded-full"></span>
                        <span>Count: {set.shapeCountMode === 'fixed' ? `${set.shapeCountFixed}` : `${set.shapeCountRange[0]}-${set.shapeCountRange[1]}`}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span data-testid={`text-shape-count-${set.id}`}>
                        {/* Show set's unique stored data */}
                        {set.enabledShapeTypes.length} shape type{set.enabledShapeTypes.length !== 1 ? 's' : ''}
                      </span>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveSet(set.id, 'up');
                          }}
                          disabled={index === 0}
                          data-testid={`button-move-up-${set.id}`}
                          aria-label={`Move ${set.name} up`}
                        >
                          <ChevronUp className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveSet(set.id, 'down');
                          }}
                          disabled={index === generationSets.length - 1}
                          data-testid={`button-move-down-${set.id}`}
                          aria-label={`Move ${set.name} down`}
                        >
                          <ChevronDown className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicateSet(set.id);
                          }}
                          disabled={generationSets.length >= maxSets}
                          data-testid={`button-duplicate-${set.id}`}
                          aria-label={`Duplicate ${set.name}`}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSet(set.id);
                          }}
                          disabled={generationSets.length <= 1}
                          data-testid={`button-delete-${set.id}`}
                          aria-label={`Delete ${set.name}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Individual Set Configuration */}
        <div className="lg:col-span-3">
          {selectedSet ? (
            <IndividualSetConfig
              generationSet={selectedSet}
              onUpdate={(updates: Partial<GenerationSet>) => handleUpdateSet(selectedSet.id, updates)}
              globalZIndexEnabled={globalZIndexEnabled}
              allGenerationSets={generationSets}
              bleedEnabled={bleedEnabled}
            />
          ) : (
            <Card className="bg-slate-900 border-slate-700" data-testid="card-no-set-selected">
              <CardContent className="p-8 text-center">
                <Settings className="w-12 h-12 text-slate-500 mx-auto mb-4" data-testid="icon-no-selection" />
                <h3 className="text-lg font-medium text-slate-300 mb-2" data-testid="heading-no-selection">
                  No Shape Set Selected
                </h3>
                <p className="text-slate-500 mb-4" data-testid="text-no-selection-help">
                  Select a shape set from the list to configure its settings.
                </p>
                <Button 
                  onClick={handleAddSet} 
                  disabled={generationSets.length >= maxSets}
                  data-testid="button-create-first-set"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Set
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
    </ErrorBoundary>
  );
}