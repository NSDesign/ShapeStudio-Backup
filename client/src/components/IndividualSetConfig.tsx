import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
 
  Layers,
  Hash,
  Type,
  Target,
  Settings,
  Info,
  Plus,
  X,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Droplets,
  Blend,
  Move,
  RotateCcw,
  Maximize2,
  AlignCenter,
  Waves
} from 'lucide-react';
import { 
  GenerationSet, 
  ShapeCountMode, 
  SupportedShapeType,
  DEFAULT_GENERATION_SET_LIMITS,
  SupportedShapeTypeSchema,
  BlendMode,
  CompositingOperation,
  BLEND_MODES,
  EchoSpreadConfig,
  DEFAULT_ECHO_SPREAD_CONFIG,
  FitTarget,
} from '@shared/schema';
import { fixedModeCount } from '@shared/shapeTypeGenUtils';
import {
  ShapeSpecificPropertiesHelper,
  BlendModeHelper,
  GenerationSetValidator,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  safeParseNumber,
  isValidShapeType
} from '@/lib/typedHelpers';
import { SafeSection } from '@/components/ErrorBoundary';
import { StyledModeField, type ModeConfig } from '@/components/StyledModeField';

interface IndividualSetConfigProps {
  generationSet: GenerationSet;
  onUpdate: (updates: Partial<GenerationSet>) => void;
  globalZIndexEnabled?: boolean;
  showInlineValidation?: boolean;
  validationResult?: ValidationResult;
  allGenerationSets?: GenerationSet[];
  bleedEnabled?: boolean;
}

// Available shape types grouped by category
const SHAPE_CATEGORIES = {
  'Basic': ['rectangle', 'rounded-rectangle', 'square', 'rounded-square', 'circle', 'ellipse'] as SupportedShapeType[],
  'Geometric': ['triangle', 'right-triangle', 'pentagon', 'hexagon', 'rhombus', 'parallelogram', 'trapezoid'] as SupportedShapeType[],
  'Special': ['star', 'polygon', 'heart', 'arrow', 'cross', 'kite', 'semicircle'] as SupportedShapeType[],
  'Lines & Curves': ['line-vector', 'line', 'bezier', 'cubic', 'smooth-spline'] as SupportedShapeType[],
  'Complex': ['ring', 'blob', 'chunk', 'spline-circle', 'spline-ellipse', 'spline-ring'] as SupportedShapeType[]
};

// Helper function to get display names for shape types
const getShapeDisplayName = (shapeType: SupportedShapeType): string => {
  const displayNames: Record<SupportedShapeType, string> = {
    'rectangle': 'Rect',
    'rounded-rectangle': 'Rounded Rect',
    'square': 'Square', 
    'rounded-square': 'Rounded Sq',
    'circle': 'Circle',
    'ellipse': 'Ellipse',
    'triangle': 'Triangle',
    'right-triangle': 'Right Tri',
    'pentagon': 'Pentagon',
    'hexagon': 'Hexagon',
    'rhombus': 'Rhombus',
    'parallelogram': 'Parallel',
    'trapezoid': 'Trapezoid',
    'star': 'Star',
    'polygon': 'Polygon',
    'heart': 'Heart',
    'arrow': 'Arrow',
    'cross': 'Cross',
    'kite': 'Kite',
    'semicircle': 'Semicircle',
    'line-vector': 'Line Vec',
    'line': 'Line',
    'bezier': 'Bezier',
    'cubic': 'Cubic',
    'smooth-spline': 'Smooth',
    'ring': 'Ring',
    'blob': 'Blob',
    'chunk': 'Chunk',
    'spline-circle': 'Spline Cir',
    'spline-ellipse': 'Spline Ell',
    'spline-ring': 'Spline Ring'
  };
  
  return displayNames[shapeType] || shapeType.replace('-', ' ');
};

// Helper function to check if a shape type has configurable properties
const hasConfigurableProperties = (shapeType: SupportedShapeType): boolean => {
  const shapesWithProperties: SupportedShapeType[] = [
    'rounded-rectangle',   // corner radius
    'rounded-square',      // corner radius
    'polygon',             // point count
    'star',                // point count, inner radius
    'ring',                // inner radius
    'spline-ring',         // inner radius
    'circle',              // segment count
    'ellipse',             // segment count
    'line-vector',         // direction, length, centroid, stroke caps
    'line',                // point count
    'bezier',              // point count
    'cubic',               // point count
    'smooth-spline'        // point count
  ];
  
  return shapesWithProperties.includes(shapeType);
};

// BLEND_MODES is now imported from shared schema

export function IndividualSetConfig({ 
  generationSet, 
  onUpdate, 
  globalZIndexEnabled = false,
  showInlineValidation = true,
  validationResult,
  allGenerationSets = [],
  bleedEnabled = false
}: IndividualSetConfigProps) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, ValidationError | null>>({});
  const [fieldWarnings, setFieldWarnings] = useState<Record<string, ValidationWarning | null>>({});
  const seqDragIndexRef = useRef<number | null>(null);
  const [seqDragOver, setSeqDragOver] = useState<number | null>(null);

  // Sub-tabs for the advanced configuration panel
  const [advancedSubTab, setAdvancedSubTab] = useState<'behavior' | 'appearance' | 'layout'>('behavior');

  // Real-time validation for duplicate set names
  const isDuplicateName = useMemo(() => {
    const name = generationSet.name.trim();
    if (!name) return false;
    
    // Check if any other set (excluding current set) has the same name
    return allGenerationSets.some(
      set => set.id !== generationSet.id && 
      set.name.trim().toLowerCase() === name.toLowerCase()
    );
  }, [generationSet.name, generationSet.id, allGenerationSets]);

  // Real-time validation
  const currentValidation = useMemo(() => {
    if (validationResult) {
      return validationResult;
    }
    return GenerationSetValidator.validateGenerationSet(generationSet);
  }, [generationSet, validationResult]);

  // Update field-level errors and warnings
  useEffect(() => {
    if (!showInlineValidation) return;
    
    const newFieldErrors: Record<string, ValidationError | null> = {};
    const newFieldWarnings: Record<string, ValidationWarning | null> = {};
    
    currentValidation.errors.forEach(error => {
      newFieldErrors[error.field] = error;
    });
    
    currentValidation.warnings.forEach(warning => {
      newFieldWarnings[warning.field] = warning;
    });
    
    setFieldErrors(newFieldErrors);
    setFieldWarnings(newFieldWarnings);
  }, [currentValidation, showInlineValidation]);

  // Helper to get field validation state
  const getFieldValidation = useCallback((fieldName: string) => {
    return {
      error: fieldErrors[fieldName],
      warning: fieldWarnings[fieldName],
      hasError: Boolean(fieldErrors[fieldName]),
      hasWarning: Boolean(fieldWarnings[fieldName])
    };
  }, [fieldErrors, fieldWarnings]);

  // Update handlers
  const handleNameChange = useCallback((name: string) => {
    onUpdate({ name });
  }, [onUpdate]);

  const handleDescriptionChange = useCallback((description: string) => {
    onUpdate({ description: description || undefined });
  }, [onUpdate]);

  const handleShapeCountModeChange = useCallback((mode: ShapeCountMode) => {
    onUpdate({ shapeCountMode: mode });
  }, [onUpdate]);

  const handleShapeCountFixedChange = useCallback((count: number) => {
    onUpdate({ shapeCountFixed: count });
  }, [onUpdate]);

  const handleShapeCountRangeChange = useCallback((range: [number, number]) => {
    onUpdate({ shapeCountRange: range });
  }, [onUpdate]);

  const handleRepetitionModeChange = useCallback((mode: 'use-global' | 'fixed' | 'range') => {
    onUpdate({ repetitionMode: mode });
  }, [onUpdate]);

  const handleRepetitionValueChange = useCallback((value: number) => {
    onUpdate({ repetitionValue: value });
  }, [onUpdate]);

  const handleRepetitionRangeChange = useCallback((range: [number, number]) => {
    onUpdate({ repetitionRange: range });
  }, [onUpdate]);

  const handleShapeTypeToggle = useCallback((shapeType: SupportedShapeType, enabled: boolean) => {
    const currentTypes = generationSet.enabledShapeTypes;
    const updatedTypes = enabled
      ? [...currentTypes, shapeType]
      : currentTypes.filter(type => type !== shapeType);
    
    onUpdate({ enabledShapeTypes: updatedTypes });
  }, [generationSet.enabledShapeTypes, onUpdate]);

  const handleSelectAllShapes = useCallback((category: string) => {
    const categoryShapes = SHAPE_CATEGORIES[category as keyof typeof SHAPE_CATEGORIES];
    const allCurrentTypes = new Set(generationSet.enabledShapeTypes);
    
    categoryShapes.forEach(shape => allCurrentTypes.add(shape));
    onUpdate({ enabledShapeTypes: Array.from(allCurrentTypes) });
  }, [generationSet.enabledShapeTypes, onUpdate]);

  const handleDeselectAllShapes = useCallback((category: string) => {
    const categoryShapes = SHAPE_CATEGORIES[category as keyof typeof SHAPE_CATEGORIES];
    const updatedTypes = generationSet.enabledShapeTypes.filter(
      type => !categoryShapes.includes(type)
    );
    onUpdate({ enabledShapeTypes: updatedTypes });
  }, [generationSet.enabledShapeTypes, onUpdate]);

  const handleShapeTypeGenModeChange = useCallback((mode: string) => {
    onUpdate({ shapeTypeGenMode: mode as 'random' | 'weighted' | 'fixed' | 'sequence' });
  }, [onUpdate]);

  const handleShapeTypeWeightChange = useCallback((shapeType: SupportedShapeType, value: number) => {
    onUpdate({ shapeTypeWeights: { ...generationSet.shapeTypeWeights, [shapeType]: value } });
  }, [generationSet.shapeTypeWeights, onUpdate]);

  const handleShapeTypeFixedCountChange = useCallback((shapeType: SupportedShapeType, value: number) => {
    onUpdate({ shapeTypeFixedCounts: { ...generationSet.shapeTypeFixedCounts, [shapeType]: value } });
  }, [generationSet.shapeTypeFixedCounts, onUpdate]);

  const handleAddToSequence = useCallback((shapeType: SupportedShapeType) => {
    onUpdate({ shapeTypeSequence: [...(generationSet.shapeTypeSequence ?? []), shapeType] });
  }, [generationSet.shapeTypeSequence, onUpdate]);

  const handleRemoveFromSequence = useCallback((index: number) => {
    const seq = [...(generationSet.shapeTypeSequence ?? [])];
    seq.splice(index, 1);
    onUpdate({ shapeTypeSequence: seq });
  }, [generationSet.shapeTypeSequence, onUpdate]);

  const handleClearSequence = useCallback(() => {
    onUpdate({ shapeTypeSequence: [] });
  }, [onUpdate]);

  const handleZIndexConfigChange = useCallback((field: keyof typeof generationSet.zIndexConfig, value: number) => {
    onUpdate({
      zIndexConfig: {
        ...generationSet.zIndexConfig,
        [field]: value
      }
    });
  }, [generationSet.zIndexConfig, onUpdate]);

  // Shape-specific property handlers with type safety
  const handleShapeSpecificPropertyChange = useCallback(<T = any>(
    shapeType: SupportedShapeType,
    property: string,
    value: T
  ) => {
    if (!isValidShapeType(shapeType)) {
      console.error(`Invalid shape type: ${shapeType}`);
      return;
    }
    
    // Create fresh helper with current properties to avoid stale data race condition
    const freshHelper = new ShapeSpecificPropertiesHelper(generationSet.shapeSpecificProperties);
    const updatedProperties = freshHelper.setProperty(shapeType, property, value);
    onUpdate({ shapeSpecificProperties: updatedProperties });
  }, [generationSet.shapeSpecificProperties, onUpdate]);

  // Helper functions to convert between old format and ModeConfig
  const convertToModeConfig = useCallback((shapeType: SupportedShapeType, property: string, defaultFixed: number, defaultRange: [number, number]): ModeConfig => {
    const shapeProps = generationSet.shapeSpecificProperties?.[shapeType] as any;
    const mode = shapeProps?.[`${property}Mode`] || 'range';
    
    switch (mode) {
      case 'fixed':
        return { kind: 'fixed', value: shapeProps?.[`${property}Value`] || defaultFixed };
      case 'range':
        const range = shapeProps?.[`${property}Range`] || defaultRange;
        return { kind: 'range', min: range[0], max: range[1] };
      default:
        return { kind: 'range', min: defaultRange[0], max: defaultRange[1] };
    }
  }, [generationSet.shapeSpecificProperties]);

  const handleModeConfigChange = useCallback((shapeType: SupportedShapeType, property: string, config: ModeConfig) => {
    const updates: Record<string, any> = {};
    
    switch (config.kind) {
      case 'fixed':
        updates[`${property}Mode`] = 'fixed';
        updates[`${property}Value`] = config.value;
        break;
      case 'range':
        updates[`${property}Mode`] = 'range';
        updates[`${property}Range`] = [config.min, config.max];
        break;
    }

    // Apply all updates atomically with a single helper operation
    const currentProperties = generationSet.shapeSpecificProperties || {};
    const shapeProperties = currentProperties[shapeType] || {};
    
    onUpdate({
      shapeSpecificProperties: {
        ...currentProperties,
        [shapeType]: {
          ...shapeProperties,
          ...updates
        }
      }
    });
  }, [generationSet.shapeSpecificProperties, onUpdate]);

  // Helper to render field validation indicators
  const renderFieldValidation = useCallback((fieldName: string) => {
    const validation = getFieldValidation(fieldName);
    
    if (!showInlineValidation) return null;
    
    if (validation.hasError) {
      return (
        <div className="flex items-center gap-1 mt-1" data-testid={`validation-error-${fieldName}`}>
          <AlertTriangle className="w-3 h-3 text-red-400" />
          <span className="text-xs text-red-400">{validation.error!.message}</span>
        </div>
      );
    }
    
    if (validation.hasWarning) {
      return (
        <div className="flex items-center gap-1 mt-1" data-testid={`validation-warning-${fieldName}`}>
          <AlertCircle className="w-3 h-3 text-yellow-400" />
          <span className="text-xs text-yellow-400">{validation.warning!.message}</span>
        </div>
      );
    }
    
    return null;
  }, [getFieldValidation, showInlineValidation]);

  // Render validation summary
  const renderValidationSummary = useCallback(() => {
    if (!showInlineValidation || currentValidation.isValid) return null;
    
    return (
      <Alert variant="destructive" className="mb-4" data-testid="validation-summary">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <div className="space-y-2">
            <p className="font-medium">Configuration Issues:</p>
            <ul className="list-disc list-inside space-y-2 text-sm">
              {currentValidation.errors.map((error, index) => (
                <li key={`error-${index}`}>{error.message}</li>
              ))}
            </ul>
            {currentValidation.warnings.length > 0 && (
              <>
                <p className="font-medium mt-2">Warnings:</p>
                <ul className="list-disc list-inside space-y-2 text-sm text-yellow-400">
                  {currentValidation.warnings.map((warning, index) => (
                    <li key={`warning-${index}`}>{warning.message}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </AlertDescription>
      </Alert>
    );
  }, [showInlineValidation, currentValidation]);

  return (
    <SafeSection className="bg-slate-900 border-slate-700 rounded-lg">
      <Card className="bg-slate-900 border-slate-700" data-testid="individual-set-config">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-slate-200">
            <Settings className="w-5 h-5" />
            Configure Shape Set
            {!currentValidation.isValid && (
              <Badge variant="destructive" className="ml-2" data-testid="badge-validation-status">
                Issues
              </Badge>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-7 w-7 text-slate-400 hover:text-blue-400 hover:bg-slate-800"
                  aria-label="About shape types configuration"
                  data-testid="button-shape-types-info"
                >
                  <Info className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side="left"
                align="start"
                className="w-80 bg-slate-800 border-slate-700 text-slate-200 z-[10002]"
                data-testid="popover-shape-types-info"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Info className="w-4 h-4 text-blue-400" />
                  <h4 className="text-sm font-medium text-blue-200">Shape Types Configuration</h4>
                </div>
                <p className="text-xs text-slate-400">
                  Shape types are configured in the sidebar Shape Sets dropdown and combined with the advanced settings below.
                  This dialog manages only the advanced shape settings that apply to the captured shape types.
                </p>
              </PopoverContent>
            </Popover>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px] pr-4">
            <div className="space-y-6">
              {/* Validation Summary */}
              {renderValidationSummary()}

              {globalZIndexEnabled && (
                <div className="bg-slate-800 p-4 rounded-lg border border-slate-700" data-testid="alert-global-zindex-enabled">
                  <div className="flex items-center gap-2 mb-2">
                    <Info className="w-4 h-4 text-blue-400" data-testid="icon-global-zindex-info" />
                    <span className="text-sm font-medium text-white" data-testid="text-global-zindex-title">Global Z-Index Enabled</span>
                  </div>
                  <p className="text-xs text-slate-500" data-testid="text-global-zindex-description">
                    Z-index settings are controlled globally. Individual set z-index configuration is disabled.
                  </p>
                </div>
              )}

            {/* Advanced Configuration — categorised sub-tabs (fits container width) */}
            <Tabs
              value={advancedSubTab}
              onValueChange={(value) => setAdvancedSubTab(value as 'behavior' | 'appearance' | 'layout')}
              className="w-full"
              data-testid="tabs-advanced-config"
            >
              <TabsList className="w-full rounded-none border-b border-slate-700 bg-slate-900 h-auto p-0 flex-shrink-0 overflow-x-auto touch-auto">
                <TabsTrigger
                  value="behavior"
                  className="flex-1 px-2 py-1.5 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:text-blue-400 data-[state=active]:bg-slate-800/50 data-[state=inactive]:text-slate-400 data-[state=inactive]:hover:text-slate-200 data-[state=inactive]:hover:bg-slate-800/30 data-[state=active]:shadow-none bg-transparent whitespace-nowrap"
                  data-testid="subtab-behavior"
                >
                  Behavior
                </TabsTrigger>
                <TabsTrigger
                  value="appearance"
                  className="flex-1 px-2 py-1.5 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:text-blue-400 data-[state=active]:bg-slate-800/50 data-[state=inactive]:text-slate-400 data-[state=inactive]:hover:text-slate-200 data-[state=inactive]:hover:bg-slate-800/30 data-[state=active]:shadow-none bg-transparent whitespace-nowrap"
                  data-testid="subtab-appearance"
                >
                  Appearance
                </TabsTrigger>
                <TabsTrigger
                  value="layout"
                  className="flex-1 px-2 py-1.5 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:text-blue-400 data-[state=active]:bg-slate-800/50 data-[state=inactive]:text-slate-400 data-[state=inactive]:hover:text-slate-200 data-[state=inactive]:hover:bg-slate-800/30 data-[state=active]:shadow-none bg-transparent whitespace-nowrap"
                  data-testid="subtab-layout"
                >
                  Layout
                </TabsTrigger>
              </TabsList>

              {/* Behavior sub-tab: Repetition + Visibility & Opacity */}
              <TabsContent value="behavior" className="mt-3" data-testid="subtab-content-behavior">
                <Accordion type="multiple" className="space-y-3" defaultValue={[]}>

              {/* Type Selection Control */}
              <AccordionItem value="generation-control" className="border-slate-700">
                <AccordionTrigger className="text-slate-200 hover:text-white hover:no-underline py-3" data-testid="trigger-generation-control">
                  <div className="flex items-center gap-2">
                    <Settings className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-medium">Type Selection</span>
                    {(generationSet.shapeTypeGenMode ?? 'random') !== 'random' && (
                      <Badge variant="outline" className="ml-2 text-xs border-blue-500 text-blue-400 capitalize">
                        {generationSet.shapeTypeGenMode}
                      </Badge>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="grid grid-cols-1 gap-4 pt-2">
                    <div>
                      <Label className="text-white text-xs">Mode</Label>
                      <Select
                        value={generationSet.shapeTypeGenMode ?? 'random'}
                        onValueChange={handleShapeTypeGenModeChange}
                        data-testid="select-shape-type-gen-mode"
                      >
                        <SelectTrigger className="bg-slate-700 border-slate-600 text-white mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-700 border-slate-600" style={{ zIndex: 10002 }}>
                          <SelectItem value="random" className="text-white hover:bg-slate-600">Random</SelectItem>
                          <SelectItem value="weighted" className="text-white hover:bg-slate-600">Weighted</SelectItem>
                          <SelectItem value="fixed" className="text-white hover:bg-slate-600">Constant</SelectItem>
                          <SelectItem value="sequence" className="text-white hover:bg-slate-600">Sequence</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {generationSet.shapeTypeGenMode === 'weighted' && generationSet.enabledShapeTypes.length > 0 && (
                      <div>
                        <Label className="text-white text-xs">Weights per type (0–100)</Label>
                        <div className="mt-2 space-y-2.5">
                          {generationSet.enabledShapeTypes.map(type => (
                            <div key={type} className="flex items-center justify-between">
                              <span className="text-xs text-slate-300">{getShapeDisplayName(type)}</span>
                              <NumericInput
                                min={0}
                                max={100}
                                value={generationSet.shapeTypeWeights?.[type] ?? 1}
                                onChange={(v) => handleShapeTypeWeightChange(type, Math.max(0, Math.min(100, v)))}
                                className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {generationSet.shapeTypeGenMode === 'fixed' && generationSet.enabledShapeTypes.length > 0 && (
                      <div>
                        <Label className="text-white text-xs">
                          Counts per type (total: {fixedModeCount(generationSet.enabledShapeTypes, generationSet.shapeTypeFixedCounts)})
                        </Label>
                        <div className="mt-2 space-y-2.5">
                          {generationSet.enabledShapeTypes.map(type => (
                            <div key={type} className="flex items-center justify-between">
                              <span className="text-xs text-slate-300">{getShapeDisplayName(type)}</span>
                              <NumericInput
                                min={1}
                                max={9999}
                                value={generationSet.shapeTypeFixedCounts?.[type] ?? 1}
                                onChange={(v) => handleShapeTypeFixedCountChange(type, v)}
                                className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {generationSet.shapeTypeGenMode === 'sequence' && (
                      <div>
                        <Label className="text-white text-xs">Click types to build sequence</Label>
                        {/* Clickable type buttons to append */}
                        {generationSet.enabledShapeTypes.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {generationSet.enabledShapeTypes.map(type => (
                              <button
                                key={type}
                                type="button"
                                onClick={() => handleAddToSequence(type as SupportedShapeType)}
                                className="px-2 py-0.5 rounded bg-slate-700 border border-slate-600 text-xs text-slate-300 hover:bg-slate-600 hover:text-slate-100"
                              >+{getShapeDisplayName(type)}</button>
                            ))}
                          </div>
                        )}
                        {/* Sequence grid */}
                        <div className="mt-2">
                          {(generationSet.shapeTypeSequence ?? []).length === 0 ? (
                            <p className="text-xs text-slate-500 italic">No types added yet</p>
                          ) : (
                            <div className="space-y-2">
                              <div className="grid grid-cols-4 gap-1 max-h-48 overflow-y-auto pr-0.5">
                                {(generationSet.shapeTypeSequence ?? []).map((type, i) => {
                                  const displayName = getShapeDisplayName(type);
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
                                        if (from === null || from === i) return;
                                        const seq = [...(generationSet.shapeTypeSequence ?? [])];
                                        const [moved] = seq.splice(from, 1);
                                        seq.splice(i, 0, moved);
                                        onUpdate({ shapeTypeSequence: seq });
                                        seqDragIndexRef.current = null;
                                        setSeqDragOver(null);
                                      }}
                                      onDragEnd={() => { seqDragIndexRef.current = null; setSeqDragOver(null); }}
                                      className={`flex flex-col items-start px-1.5 pt-1 pb-1 rounded border cursor-grab active:cursor-grabbing transition-opacity select-none min-w-0
                                        ${seqDragIndexRef.current === i ? 'opacity-40' : ''}
                                        ${seqDragOver === i && seqDragIndexRef.current !== i ? 'bg-slate-500 border-cyan-500 ring-1 ring-cyan-500' : 'bg-slate-600 border-slate-500'}`}
                                    >
                                      <div className="flex items-center justify-between w-full min-w-0">
                                        <span className="text-[9px] text-slate-500 font-mono leading-none shrink-0">{i + 1}</span>
                                        <button
                                          type="button"
                                          aria-label="Remove"
                                          onClick={(e) => { e.stopPropagation(); handleRemoveFromSequence(i); }}
                                          className="text-slate-500 hover:text-slate-200 shrink-0 leading-none"
                                        >×</button>
                                      </div>
                                      <span className="truncate text-[10px] text-slate-200 w-full min-w-0 leading-tight mt-0.5">{displayName}</span>
                                    </div>
                                  );
                                })}
                              </div>
                              <button
                                type="button"
                                onClick={handleClearSequence}
                                className="text-xs text-slate-500 hover:text-slate-300 px-1"
                                title="Clear all"
                              >Clear all</button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Repetition Settings */}
              <AccordionItem value="repetition" className="border-slate-700">
                <AccordionTrigger className="text-slate-200 hover:text-white hover:no-underline py-3" data-testid="trigger-repetition">
                  <div className="flex items-center gap-2">
                    <Hash className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-medium">Repetition Settings</span>
                    {generationSet.repetitionMode !== 'use-global' && (
                      <Badge variant="outline" className="ml-2 text-xs border-blue-500 text-blue-400">
                        Override
                      </Badge>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="grid grid-cols-1 gap-4 pt-2">
                    <div>
                      <Label className="text-white text-xs">Mode</Label>
                      <Select
                        value={generationSet.repetitionMode}
                        onValueChange={(value) => handleRepetitionModeChange(value as 'use-global' | 'fixed' | 'range')}
                        data-testid="select-repetition-mode"
                      >
                        <SelectTrigger className="bg-slate-700 border-slate-600 text-white mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-700 border-slate-600" style={{ zIndex: 10002 }}>
                          <SelectItem value="use-global" className="text-white hover:bg-slate-600">
                            Use Global
                          </SelectItem>
                          <SelectItem value="fixed" className="text-white hover:bg-slate-600">
                            Constant
                          </SelectItem>
                          <SelectItem value="range" className="text-white hover:bg-slate-600">
                            Range
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-slate-500 mt-1">
                        Override global repetition or use global settings
                      </p>
                    </div>

                    {generationSet.repetitionMode === 'fixed' && (
                      <div>
                        <Label className="text-white text-xs">Count</Label>
                        <NumericInput
                          min={0}
                          max={100}
                          value={generationSet.repetitionValue}
                          onChange={handleRepetitionValueChange}
                          className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                          data-testid="input-repetition-value"
                        />
                        <p className="text-xs text-slate-500 mt-1">
                          Number of times to repeat this shape set
                        </p>
                      </div>
                    )}

                    {generationSet.repetitionMode === 'range' && (
                      <div>
                        <Label className="text-white text-xs">Range</Label>
                        <div className="grid grid-cols-2 gap-2 mt-1">
                          <NumericInput
                            min={0}
                            max={100}
                            value={generationSet.repetitionRange[0]}
                            onChange={(value) => handleRepetitionRangeChange([value, generationSet.repetitionRange[1]])}
                            className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                            placeholder="Min"
                            data-testid="input-repetition-range-min"
                          />
                          <NumericInput
                            min={0}
                            max={100}
                            value={generationSet.repetitionRange[1]}
                            onChange={(value) => handleRepetitionRangeChange([generationSet.repetitionRange[0], value])}
                            className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                            placeholder="Max"
                            data-testid="input-repetition-range-max"
                          />
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          Random repetition count within this range
                        </p>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Set Visibility & Opacity Controls */}
              <AccordionItem value="visibility" className="border-slate-700">
                <AccordionTrigger className="text-slate-200 hover:text-white hover:no-underline py-3" data-testid="trigger-set-visibility">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-medium">Set Visibility & Opacity</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="grid grid-cols-1 gap-4 pt-2">
                    {/* Visibility Toggle */}
                    <div className="flex items-center justify-between">
                      <Label className="text-white text-sm">Visible</Label>
                      <div className="flex items-center space-x-2">
                        {generationSet.setVisibility.visible ? (
                          <Eye className="w-4 h-4 text-blue-400" />
                        ) : (
                          <EyeOff className="w-4 h-4 text-slate-500" />
                        )}
                        <Switch
                          checked={generationSet.setVisibility.visible}
                          onCheckedChange={(checked) => 
                            onUpdate({
                              setVisibility: {
                                ...generationSet.setVisibility,
                                visible: checked as boolean
                              }
                            })
                          }
                          className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-blue-900"
                          data-testid="checkbox-set-visible"
                        />
                      </div>
                    </div>

                    {/* Opacity Control */}
                    <div>
                      <Label className="text-white text-xs">Opacity</Label>
                      <Slider
                        value={[generationSet.setVisibility.opacity]}
                        onValueChange={([value]) => 
                          onUpdate({
                            setVisibility: {
                              ...generationSet.setVisibility,
                              opacity: value
                            }
                          })
                        }
                        min={0}
                        max={1}
                        step={0.01}
                        className="mt-2"
                        data-testid="slider-set-opacity"
                        aria-label="Set opacity"
                      />
                      <NumericInput
                        value={generationSet.setVisibility.opacity}
                        onChange={(value) => onUpdate({ setVisibility: { ...generationSet.setVisibility, opacity: value } })}
                        min={0}
                        max={1}
                        step={0.01}
                        className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                      />
                      <p className="text-xs text-slate-500 mt-1">
                        Overall opacity applied to all shapes in this set
                      </p>
                    </div>

                    {/* Opacity Variance */}
                    <div>
                      <Label className="text-white text-xs">Opacity Variance</Label>
                      <Slider
                        value={[generationSet.setVisibility.opacityVariance]}
                        onValueChange={([value]) => 
                          onUpdate({
                            setVisibility: {
                              ...generationSet.setVisibility,
                              opacityVariance: value
                            }
                          })
                        }
                        min={0}
                        max={1}
                        step={0.01}
                        className="mt-2"
                        data-testid="slider-set-opacity-variance"
                        aria-label="Set opacity variance"
                      />
                      <NumericInput
                        value={generationSet.setVisibility.opacityVariance}
                        onChange={(value) => onUpdate({ setVisibility: { ...generationSet.setVisibility, opacityVariance: value } })}
                        min={0}
                        max={1}
                        step={0.01}
                        className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                      />
                      <p className="text-xs text-slate-500 mt-1">
                        Random variation in opacity across shapes in this set
                      </p>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
                </Accordion>
              </TabsContent>

              {/* Appearance sub-tab: Compositing + Echo/Motion + Set Positioning & Transforms */}
              <TabsContent value="appearance" className="mt-3" data-testid="subtab-content-appearance">
                <Accordion type="multiple" className="space-y-3" defaultValue={[]}>
              {/* Compositing & Blend Modes Controls */}
              <AccordionItem value="compositing" className="border-slate-700">
                <AccordionTrigger className="text-slate-200 hover:text-white hover:no-underline py-3" data-testid="trigger-compositing-blend">
                  <div className="flex items-center gap-2">
                    <Blend className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-medium">Compositing & Blend Modes</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="grid grid-cols-1 gap-4 pt-2">
                    {/* Set Blend Mode */}
                    <div>
                  <Label className="text-white text-xs">Set Blend Mode</Label>
                  <Select
                    value={generationSet.setBlendMode}
                    onValueChange={(value: BlendMode) => 
                      onUpdate({ setBlendMode: value })
                    }
                    data-testid="select-set-blend-mode"
                  >
                    <SelectTrigger className="bg-slate-700 border-slate-600 text-white mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-700 border-slate-600 max-h-48" style={{ zIndex: 10002 }}>
                      {BLEND_MODES.map((mode) => (
                        <SelectItem key={mode} value={mode} className="text-white hover:bg-slate-600">
                          <div className="flex flex-col">
                            <span className="capitalize">{mode.replace('-', ' ')}</span>
                            <span className="text-xs text-slate-400">
                              {mode === 'source-over' && 'Default - normal blending'}
                              {mode === 'multiply' && 'Darkens by multiplying colors'}
                              {mode === 'screen' && 'Lightens by inverting and multiplying'}
                              {mode === 'overlay' && 'Combines multiply and screen'}
                              {mode === 'difference' && 'Subtracts colors for contrast'}
                              {mode === 'exclusion' && 'Similar to difference but softer'}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500 mt-1">
                    Blend mode applied to the entire shape set
                  </p>
                </div>

                {/* Compositing Operation */}
                <div>
                  <Label className="text-white text-xs">Compositing Operation</Label>
                  <Select
                    value={generationSet.compositingOperation}
                    onValueChange={(value: CompositingOperation) => 
                      onUpdate({ compositingOperation: value })
                    }
                    data-testid="select-compositing-operation"
                  >
                    <SelectTrigger className="bg-slate-700 border-slate-600 text-white mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-700 border-slate-600 max-h-48" style={{ zIndex: 10002 }}>
                      <SelectItem value="source-over" className="text-white hover:bg-slate-600">
                        <div className="flex flex-col">
                          <span>Source Over</span>
                          <span className="text-xs text-slate-400">Draw new on top (default)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="source-in" className="text-white hover:bg-slate-600">
                        <div className="flex flex-col">
                          <span>Source In</span>
                          <span className="text-xs text-slate-400">Keep new where it overlaps existing</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="source-out" className="text-white hover:bg-slate-600">
                        <div className="flex flex-col">
                          <span>Source Out</span>
                          <span className="text-xs text-slate-400">Keep new where it doesn't overlap</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="destination-in" className="text-white hover:bg-slate-600">
                        <div className="flex flex-col">
                          <span>Destination In</span>
                          <span className="text-xs text-slate-400">Keep existing where new overlaps</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="destination-out" className="text-white hover:bg-slate-600">
                        <div className="flex flex-col">
                          <span>Destination Out</span>
                          <span className="text-xs text-slate-400">Remove existing where new overlaps</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="xor" className="text-white hover:bg-slate-600">
                        <div className="flex flex-col">
                          <span>XOR</span>
                          <span className="text-xs text-slate-400">Keep where they don't overlap</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500 mt-1">
                    Advanced compositing for masking and special effects
                  </p>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Set Positioning & Transforms Controls */}
              <AccordionItem value="transforms" className="border-slate-700">
                <AccordionTrigger className="text-slate-200 hover:text-white hover:no-underline py-3" data-testid="trigger-set-transform">
                  <div className="flex items-center gap-2">
                    <Move className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-medium">Set Positioning & Transforms</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                    <div className="grid grid-cols-2 gap-4 pt-2">
                        {/* Position Controls */}
                        <div className="space-y-4">
                            <Label className="text-white text-xs">Position</Label>
                            
                            {/* X Position */}
                            <div>
                                <Label className="text-white text-xs">X (px)</Label>
                                <Slider
                                    value={[generationSet.setTransform.x]}
                                    onValueChange={([value]) => 
                                        onUpdate({
                                            setTransform: {
                                                ...generationSet.setTransform,
                                                x: value
                                            }
                                        })
                                    }
                                    min={-1000}
                                    max={1000}
                                    step={1}
                                    className="mt-1"
                                    data-testid="slider-set-transform-x"
                                    aria-label="Set X position"
                                />
                                <NumericInput
                                    value={generationSet.setTransform.x}
                                    onChange={(value) => onUpdate({ setTransform: { ...generationSet.setTransform, x: value } })}
                                    min={-1000}
                                    max={1000}
                                    step={1}
                                    className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                />
                            </div>

                            {/* Y Position */}
                            <div>
                                <Label className="text-white text-xs">Y (px)</Label>
                                <Slider
                                    value={[generationSet.setTransform.y]}
                                    onValueChange={([value]) => 
                                        onUpdate({
                                            setTransform: {
                                                ...generationSet.setTransform,
                                                y: value
                                            }
                                        })
                                    }
                                    min={-1000}
                                    max={1000}
                                    step={1}
                                    className="mt-1"
                                    data-testid="slider-set-transform-y"
                                    aria-label="Set Y position"
                                />
                                <NumericInput
                                    value={generationSet.setTransform.y}
                                    onChange={(value) => onUpdate({ setTransform: { ...generationSet.setTransform, y: value } })}
                                    min={-1000}
                                    max={1000}
                                    step={1}
                                    className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                />
                            </div>
                        </div>

                        {/* Transform Controls */}
                        <div className="space-y-4">
                            <Label className="text-white text-xs">Transform</Label>
                            
                            {/* Rotation */}
                            <div>
                                <Label className="text-white text-xs">Rotation (°)</Label>
                                <Slider
                                    value={[generationSet.setTransform.rotation]}
                                    onValueChange={([value]) => 
                                        onUpdate({
                                            setTransform: {
                                                ...generationSet.setTransform,
                                                rotation: value
                                            }
                                        })
                                    }
                                    min={-180}
                                    max={180}
                                    step={1}
                                    className="mt-1"
                                    data-testid="slider-set-transform-rotation"
                                    aria-label="Set rotation"
                                />
                                <NumericInput
                                    value={generationSet.setTransform.rotation}
                                    onChange={(value) => onUpdate({ setTransform: { ...generationSet.setTransform, rotation: value } })}
                                    min={-180}
                                    max={180}
                                    step={1}
                                    className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                />
                            </div>

                            {/* Scale Controls */}
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <Label className="text-white text-xs">Scale X</Label>
                                    <Slider
                                        value={[generationSet.setTransform.scaleX]}
                                        onValueChange={([value]) => 
                                            onUpdate({
                                                setTransform: {
                                                    ...generationSet.setTransform,
                                                    scaleX: value
                                                }
                                            })
                                        }
                                        min={0.1}
                                        max={3.0}
                                        step={0.01}
                                        className="mt-1"
                                        data-testid="slider-set-transform-scale-x"
                                        aria-label="Set scale X"
                                    />
                                    <NumericInput
                                        value={generationSet.setTransform.scaleX}
                                        onChange={(value) => onUpdate({ setTransform: { ...generationSet.setTransform, scaleX: value } })}
                                        min={0.1}
                                        max={3.0}
                                        step={0.01}
                                        className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                    />
                                </div>
                                
                                <div>
                                    <Label className="text-white text-xs">Scale Y</Label>
                                    <Slider
                                        value={[generationSet.setTransform.scaleY]}
                                        onValueChange={([value]) => 
                                            onUpdate({
                                                setTransform: {
                                                    ...generationSet.setTransform,
                                                    scaleY: value
                                                }
                                            })
                                        }
                                        min={0.1}
                                        max={3.0}
                                        step={0.01}
                                        className="mt-1"
                                        data-testid="slider-set-transform-scale-y"
                                        aria-label="Set scale Y"
                                    />
                                    <NumericInput
                                        value={generationSet.setTransform.scaleY}
                                        onChange={(value) => onUpdate({ setTransform: { ...generationSet.setTransform, scaleY: value } })}
                                        min={0.1}
                                        max={3.0}
                                        step={0.01}
                                        className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Transform Origin */}
                    <div>
                        <Label className="text-white text-xs">Transform Origin</Label>
                        <Select
                            value={generationSet.setTransform.transformOrigin}
                            onValueChange={(value) => 
                                onUpdate({
                                    setTransform: {
                                        ...generationSet.setTransform,
                                        transformOrigin: value as 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
                                    }
                                })
                            }
                            data-testid="select-transform-origin"
                        >
                            <SelectTrigger className="bg-slate-700 border-slate-600 text-white mt-1">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-700 border-slate-600" style={{ zIndex: 10002 }}>
                                <SelectItem value="center" className="text-white hover:bg-slate-600">Center</SelectItem>
                                <SelectItem value="top-left" className="text-white hover:bg-slate-600">Top Left</SelectItem>
                                <SelectItem value="top-right" className="text-white hover:bg-slate-600">Top Right</SelectItem>
                                <SelectItem value="bottom-left" className="text-white hover:bg-slate-600">Bottom Left</SelectItem>
                                <SelectItem value="bottom-right" className="text-white hover:bg-slate-600">Bottom Right</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-slate-500 mt-1">
                            Point around which rotation and scaling occurs
                        </p>
                    </div>
              </AccordionContent>
            </AccordionItem>

            {/* Echo/Motion Trails Override */}
            <AccordionItem value="echo-override" className="border-slate-700">
              <AccordionTrigger className="text-slate-200 hover:text-white hover:no-underline py-3" data-testid="trigger-echo-override">
                <div className="flex items-center gap-2">
                  <Waves className="w-4 h-4 text-slate-400" />
                  <span className="text-sm font-medium">Echo/Motion Trails</span>
                  {generationSet.echoOverride?.enabled && (
                    <Badge variant="outline" className="ml-2 text-xs border-cyan-500 text-cyan-400">
                      Override
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="grid grid-cols-1 gap-4 pt-2">
                  {/* Enable Override Toggle */}
                  <div className="flex items-center justify-between">
                    <Label className="text-white text-sm">Override Global Echo Settings</Label>
                    <Switch
                      checked={generationSet.echoOverride?.enabled ?? false}
                      onCheckedChange={(checked) => {
                        const newEchoOverride = {
                          enabled: checked as boolean,
                          config: generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG }
                        };
                        onUpdate({ echoOverride: newEchoOverride });
                      }}
                      className="data-[state=checked]:bg-cyan-600 data-[state=unchecked]:bg-cyan-900"
                      data-testid="checkbox-echo-override-enabled"
                    />
                  </div>

                  {generationSet.echoOverride?.enabled && (
                    <>
                      {/* Echo Enabled Toggle */}
                      <div className="flex items-center justify-between">
                        <Label className="text-white text-sm">Enable Echoes for this Set</Label>
                        <Switch
                          checked={generationSet.echoOverride.config?.enabled ?? false}
                          onCheckedChange={(checked) => {
                            const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                            onUpdate({
                              echoOverride: {
                                enabled: true,
                                config: { ...currentConfig, enabled: checked as boolean }
                              }
                            });
                          }}
                          className="data-[state=checked]:bg-cyan-600 data-[state=unchecked]:bg-cyan-900"
                          data-testid="checkbox-echo-enabled"
                        />
                      </div>

                      {generationSet.echoOverride.config?.enabled && (
                        <>
                          {/* Echo Count */}
                          <div>
                            <Label className="text-white text-xs">Echo Count</Label>
                            <Slider
                              value={[generationSet.echoOverride.config.echoCount ?? 3]}
                              onValueChange={([value]) => {
                                const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                onUpdate({
                                  echoOverride: {
                                    enabled: true,
                                    config: { ...currentConfig, echoCount: value }
                                  }
                                });
                              }}
                              min={1}
                              max={20}
                              step={1}
                              className="mt-2"
                              data-testid="slider-echo-count"
                            />
                            <NumericInput
                              value={generationSet.echoOverride.config.echoCount ?? 3}
                              onChange={(value) => {
                                const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                onUpdate({ echoOverride: { enabled: true, config: { ...currentConfig, echoCount: value } } });
                              }}
                              min={1}
                              max={20}
                              step={1}
                              className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                            />
                            <p className="text-xs text-slate-500 mt-1">Number of echo copies (1-20)</p>
                          </div>

                          {/* Scope Selection */}
                          <div>
                            <Label className="text-white text-xs">Scope</Label>
                            <Select
                              value={generationSet.echoOverride.config.scope ?? 'set'}
                              onValueChange={(value: 'set' | 'shape' | 'both') => {
                                const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                onUpdate({
                                  echoOverride: {
                                    enabled: true,
                                    config: { ...currentConfig, scope: value }
                                  }
                                });
                              }}
                              data-testid="select-echo-scope"
                            >
                              <SelectTrigger className="bg-slate-700 border-slate-600 text-white mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-700 border-slate-600" style={{ zIndex: 10002 }}>
                                <SelectItem value="set" className="text-white hover:bg-slate-600">Set Level</SelectItem>
                                <SelectItem value="shape" className="text-white hover:bg-slate-600">Shape Level</SelectItem>
                                <SelectItem value="both" className="text-white hover:bg-slate-600">Both</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-slate-500 mt-1">Set: same echoes for all shapes, Shape: per-shape trails</p>
                          </div>

                          {/* Driver Selection */}
                          <div>
                            <Label className="text-white text-xs">Driver</Label>
                            <Select
                              value={generationSet.echoOverride.config.driver ?? 'setRepIndex'}
                              onValueChange={(value: 'setRepIndex' | 'shapeIndex' | 'combined') => {
                                const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                onUpdate({
                                  echoOverride: {
                                    enabled: true,
                                    config: { ...currentConfig, driver: value }
                                  }
                                });
                              }}
                              data-testid="select-echo-driver"
                            >
                              <SelectTrigger className="bg-slate-700 border-slate-600 text-white mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-700 border-slate-600" style={{ zIndex: 10002 }}>
                                <SelectItem value="setRepIndex" className="text-white hover:bg-slate-600">Set Repetition</SelectItem>
                                <SelectItem value="shapeIndex" className="text-white hover:bg-slate-600">Shape Index</SelectItem>
                                <SelectItem value="combined" className="text-white hover:bg-slate-600">Combined</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-slate-500 mt-1">What drives echo variation</p>
                          </div>

                          {/* Direction Mode */}
                          <div>
                            <Label className="text-white text-xs">Direction Mode</Label>
                            <Select
                              value={generationSet.echoOverride.config.directionMode ?? 'fixed-vector'}
                              onValueChange={(value: 'fixed-vector' | 'auto-motion' | 'absolute-position') => {
                                const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                onUpdate({
                                  echoOverride: {
                                    enabled: true,
                                    config: { ...currentConfig, directionMode: value }
                                  }
                                });
                              }}
                              data-testid="select-echo-direction-mode"
                            >
                              <SelectTrigger className="bg-slate-700 border-slate-600 text-white mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-700 border-slate-600" style={{ zIndex: 10002 }}>
                                <SelectItem value="fixed-vector" className="text-white hover:bg-slate-600">Fixed Vector</SelectItem>
                                <SelectItem value="auto-motion" className="text-white hover:bg-slate-600">Auto Motion</SelectItem>
                                <SelectItem value="absolute-position" className="text-white hover:bg-slate-600">Absolute Position</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Fixed Vector Settings (when direction mode is fixed-vector) */}
                          {generationSet.echoOverride.config.directionMode === 'fixed-vector' && (
                            <div className="space-y-4 pl-3 border-l-2 border-slate-600">
                              <div>
                                <Label className="text-white text-xs">Angle (°)</Label>
                                <Slider
                                  value={[generationSet.echoOverride.config.fixedVector?.angle ?? 225]}
                                  onValueChange={([value]) => {
                                    const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                    onUpdate({
                                      echoOverride: {
                                        enabled: true,
                                        config: {
                                          ...currentConfig,
                                          fixedVector: {
                                            ...currentConfig.fixedVector,
                                            angle: value
                                          }
                                        }
                                      }
                                    });
                                  }}
                                  min={0}
                                  max={360}
                                  step={1}
                                  className="mt-2"
                                  data-testid="slider-echo-angle"
                                />
                                <NumericInput
                                  value={generationSet.echoOverride.config.fixedVector?.angle ?? 225}
                                  onChange={(value) => {
                                    const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                    onUpdate({ echoOverride: { enabled: true, config: { ...currentConfig, fixedVector: { ...currentConfig.fixedVector, angle: value } } } });
                                  }}
                                  min={0}
                                  max={360}
                                  step={1}
                                  className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                />
                              </div>
                              <div>
                                <Label className="text-white text-xs">Distance (px)</Label>
                                <Slider
                                  value={[generationSet.echoOverride.config.fixedVector?.distance ?? 20]}
                                  onValueChange={([value]) => {
                                    const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                    onUpdate({
                                      echoOverride: {
                                        enabled: true,
                                        config: {
                                          ...currentConfig,
                                          fixedVector: {
                                            ...currentConfig.fixedVector,
                                            distance: value
                                          }
                                        }
                                      }
                                    });
                                  }}
                                  min={1}
                                  max={100}
                                  step={1}
                                  className="mt-2"
                                  data-testid="slider-echo-distance"
                                />
                                <NumericInput
                                  value={generationSet.echoOverride.config.fixedVector?.distance ?? 20}
                                  onChange={(value) => {
                                    const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                    onUpdate({ echoOverride: { enabled: true, config: { ...currentConfig, fixedVector: { ...currentConfig.fixedVector, distance: value } } } });
                                  }}
                                  min={1}
                                  max={100}
                                  step={1}
                                  className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                />
                              </div>
                            </div>
                          )}

                          {/* Opacity Settings */}
                          <div className="space-y-4">
                            <Label className="text-white text-xs font-medium">Opacity Falloff</Label>
                            <div className="space-y-3 pl-3 border-l-2 border-slate-600">
                              <div>
                                <Label className="text-white text-xs">Start Opacity (%)</Label>
                                <Slider
                                  value={[generationSet.echoOverride.config.opacity?.startOpacity ?? 80]}
                                  onValueChange={([value]) => {
                                    const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                    onUpdate({
                                      echoOverride: {
                                        enabled: true,
                                        config: {
                                          ...currentConfig,
                                          opacity: {
                                            ...currentConfig.opacity,
                                            startOpacity: value
                                          }
                                        }
                                      }
                                    });
                                  }}
                                  min={0}
                                  max={100}
                                  step={1}
                                  className="mt-2"
                                  data-testid="slider-echo-opacity-start"
                                />
                                <NumericInput
                                  value={generationSet.echoOverride.config.opacity?.startOpacity ?? 80}
                                  onChange={(value) => {
                                    const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                    onUpdate({ echoOverride: { enabled: true, config: { ...currentConfig, opacity: { ...currentConfig.opacity, startOpacity: value } } } });
                                  }}
                                  min={0}
                                  max={100}
                                  step={1}
                                  className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                />
                              </div>
                              <div>
                                <Label className="text-white text-xs">Falloff Rate (%)</Label>
                                <Slider
                                  value={[generationSet.echoOverride.config.opacity?.falloffRate ?? 25]}
                                  onValueChange={([value]) => {
                                    const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                    onUpdate({
                                      echoOverride: {
                                        enabled: true,
                                        config: {
                                          ...currentConfig,
                                          opacity: {
                                            ...currentConfig.opacity,
                                            falloffRate: value
                                          }
                                        }
                                      }
                                    });
                                  }}
                                  min={0}
                                  max={100}
                                  step={1}
                                  className="mt-2"
                                  data-testid="slider-echo-opacity-falloff"
                                />
                                <NumericInput
                                  value={generationSet.echoOverride.config.opacity?.falloffRate ?? 25}
                                  onChange={(value) => {
                                    const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                    onUpdate({ echoOverride: { enabled: true, config: { ...currentConfig, opacity: { ...currentConfig.opacity, falloffRate: value } } } });
                                  }}
                                  min={0}
                                  max={100}
                                  step={1}
                                  className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Scale Settings */}
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <Label className="text-white text-xs font-medium">Scale Effect</Label>
                              <Switch
                                checked={generationSet.echoOverride.config.scale?.enabled ?? false}
                                onCheckedChange={(checked) => {
                                  const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                  onUpdate({
                                    echoOverride: {
                                      enabled: true,
                                      config: {
                                        ...currentConfig,
                                        scale: {
                                          ...currentConfig.scale,
                                          enabled: checked as boolean
                                        }
                                      }
                                    }
                                  });
                                }}
                                className="data-[state=checked]:bg-cyan-600 data-[state=unchecked]:bg-cyan-900"
                                data-testid="checkbox-echo-scale-enabled"
                              />
                            </div>
                            {generationSet.echoOverride.config.scale?.enabled && (
                              <div className="space-y-3 pl-3 border-l-2 border-slate-600">
                                <div>
                                  <Label className="text-white text-xs">Scale Delta (%)</Label>
                                  <Slider
                                    value={[generationSet.echoOverride.config.scale?.scaleDelta ?? -5]}
                                    onValueChange={([value]) => {
                                      const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                      onUpdate({
                                        echoOverride: {
                                          enabled: true,
                                          config: {
                                            ...currentConfig,
                                            scale: {
                                              ...currentConfig.scale,
                                              scaleDelta: value
                                            }
                                          }
                                        }
                                      });
                                    }}
                                    min={-50}
                                    max={50}
                                    step={1}
                                    className="mt-2"
                                    data-testid="slider-echo-scale-delta"
                                  />
                                  <NumericInput
                                    value={generationSet.echoOverride.config.scale?.scaleDelta ?? -5}
                                    onChange={(value) => {
                                      const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                      onUpdate({ echoOverride: { enabled: true, config: { ...currentConfig, scale: { ...currentConfig.scale, scaleDelta: value } } } });
                                    }}
                                    min={-50}
                                    max={50}
                                    step={1}
                                    className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Blur Settings */}
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <Label className="text-white text-xs font-medium">Blur Effect</Label>
                              <Switch
                                checked={generationSet.echoOverride.config.blur?.enabled ?? false}
                                onCheckedChange={(checked) => {
                                  const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                  onUpdate({
                                    echoOverride: {
                                      enabled: true,
                                      config: {
                                        ...currentConfig,
                                        blur: {
                                          ...currentConfig.blur,
                                          enabled: checked as boolean
                                        }
                                      }
                                    }
                                  });
                                }}
                                className="data-[state=checked]:bg-cyan-600 data-[state=unchecked]:bg-cyan-900"
                                data-testid="checkbox-echo-blur-enabled"
                              />
                            </div>
                            {generationSet.echoOverride.config.blur?.enabled && (
                              <div className="space-y-3 pl-3 border-l-2 border-slate-600">
                                <div>
                                  <Label className="text-white text-xs">Blur Delta (px)</Label>
                                  <Slider
                                    value={[generationSet.echoOverride.config.blur?.blurDelta ?? 2]}
                                    onValueChange={([value]) => {
                                      const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                      onUpdate({
                                        echoOverride: {
                                          enabled: true,
                                          config: {
                                            ...currentConfig,
                                            blur: {
                                              ...currentConfig.blur,
                                              blurDelta: value
                                            }
                                          }
                                        }
                                      });
                                    }}
                                    min={0}
                                    max={20}
                                    step={0.5}
                                    className="mt-2"
                                    data-testid="slider-echo-blur-delta"
                                  />
                                  <NumericInput
                                    value={generationSet.echoOverride.config.blur?.blurDelta ?? 2}
                                    onChange={(value) => {
                                      const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                      onUpdate({ echoOverride: { enabled: true, config: { ...currentConfig, blur: { ...currentConfig.blur, blurDelta: value } } } });
                                    }}
                                    min={0}
                                    max={20}
                                    step={0.5}
                                    className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Color Shift Settings */}
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <Label className="text-white text-xs font-medium">Color Shift</Label>
                              <Switch
                                checked={generationSet.echoOverride.config.colorShift?.enabled ?? false}
                                onCheckedChange={(checked) => {
                                  const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                  onUpdate({
                                    echoOverride: {
                                      enabled: true,
                                      config: {
                                        ...currentConfig,
                                        colorShift: {
                                          ...(currentConfig.colorShift ?? { hueDelta: 0, saturationDelta: 0, lightnessDelta: 0, jitter: { enabled: false, mode: 'fixed' as const, fixedAmount: 0, rangeMin: 0, rangeMax: 0 } }),
                                          enabled: checked as boolean
                                        }
                                      }
                                    }
                                  });
                                }}
                                className="data-[state=checked]:bg-cyan-600 data-[state=unchecked]:bg-cyan-900"
                                data-testid="checkbox-echo-color-shift-enabled"
                              />
                            </div>
                            {generationSet.echoOverride.config.colorShift?.enabled && (
                              <div className="space-y-3 pl-3 border-l-2 border-slate-600">
                                <div>
                                  <Label className="text-white text-xs">Hue Delta (°)</Label>
                                  <Slider
                                    value={[generationSet.echoOverride.config.colorShift?.hueDelta ?? 0]}
                                    onValueChange={([value]) => {
                                      const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                      onUpdate({
                                        echoOverride: {
                                          enabled: true,
                                          config: {
                                            ...currentConfig,
                                            colorShift: {
                                              ...(currentConfig.colorShift ?? { enabled: true, saturationDelta: 0, lightnessDelta: 0, jitter: { enabled: false, mode: 'fixed' as const, fixedAmount: 0, rangeMin: 0, rangeMax: 0 } }),
                                              hueDelta: value
                                            }
                                          }
                                        }
                                      });
                                    }}
                                    min={-180}
                                    max={180}
                                    step={1}
                                    className="mt-2"
                                    data-testid="slider-echo-hue-delta"
                                  />
                                  <NumericInput
                                    value={generationSet.echoOverride.config.colorShift?.hueDelta ?? 0}
                                    onChange={(value) => {
                                      const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                      onUpdate({ echoOverride: { enabled: true, config: { ...currentConfig, colorShift: { ...(currentConfig.colorShift ?? { enabled: true, saturationDelta: 0, lightnessDelta: 0, jitter: { enabled: false, mode: 'fixed' as const, fixedAmount: 0, rangeMin: 0, rangeMax: 0 } }), hueDelta: value } } } });
                                    }}
                                    min={-180}
                                    max={180}
                                    step={1}
                                    className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                  />
                                </div>
                                <div>
                                  <Label className="text-white text-xs">Saturation Delta (%)</Label>
                                  <Slider
                                    value={[generationSet.echoOverride.config.colorShift?.saturationDelta ?? 0]}
                                    onValueChange={([value]) => {
                                      const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                      onUpdate({
                                        echoOverride: {
                                          enabled: true,
                                          config: {
                                            ...currentConfig,
                                            colorShift: {
                                              ...(currentConfig.colorShift ?? { enabled: true, hueDelta: 0, lightnessDelta: 0, jitter: { enabled: false, mode: 'fixed' as const, fixedAmount: 0, rangeMin: 0, rangeMax: 0 } }),
                                              saturationDelta: value
                                            }
                                          }
                                        }
                                      });
                                    }}
                                    min={-50}
                                    max={50}
                                    step={1}
                                    className="mt-2"
                                    data-testid="slider-echo-saturation-delta"
                                  />
                                  <NumericInput
                                    value={generationSet.echoOverride.config.colorShift?.saturationDelta ?? 0}
                                    onChange={(value) => {
                                      const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                      onUpdate({ echoOverride: { enabled: true, config: { ...currentConfig, colorShift: { ...(currentConfig.colorShift ?? { enabled: true, hueDelta: 0, lightnessDelta: 0, jitter: { enabled: false, mode: 'fixed' as const, fixedAmount: 0, rangeMin: 0, rangeMax: 0 } }), saturationDelta: value } } } });
                                    }}
                                    min={-50}
                                    max={50}
                                    step={1}
                                    className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                  />
                                </div>
                                <div>
                                  <Label className="text-white text-xs">Lightness Delta (%)</Label>
                                  <Slider
                                    value={[generationSet.echoOverride.config.colorShift?.lightnessDelta ?? 0]}
                                    onValueChange={([value]) => {
                                      const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                      onUpdate({
                                        echoOverride: {
                                          enabled: true,
                                          config: {
                                            ...currentConfig,
                                            colorShift: {
                                              ...(currentConfig.colorShift ?? { enabled: true, hueDelta: 0, saturationDelta: 0, jitter: { enabled: false, mode: 'fixed' as const, fixedAmount: 0, rangeMin: 0, rangeMax: 0 } }),
                                              lightnessDelta: value
                                            }
                                          }
                                        }
                                      });
                                    }}
                                    min={-50}
                                    max={50}
                                    step={1}
                                    className="mt-2"
                                    data-testid="slider-echo-lightness-delta"
                                  />
                                  <NumericInput
                                    value={generationSet.echoOverride.config.colorShift?.lightnessDelta ?? 0}
                                    onChange={(value) => {
                                      const currentConfig = generationSet.echoOverride?.config ?? { ...DEFAULT_ECHO_SPREAD_CONFIG };
                                      onUpdate({ echoOverride: { enabled: true, config: { ...currentConfig, colorShift: { ...(currentConfig.colorShift ?? { enabled: true, hueDelta: 0, saturationDelta: 0, jitter: { enabled: false, mode: 'fixed' as const, fixedAmount: 0, rangeMin: 0, rangeMax: 0 } }), lightnessDelta: value } } } });
                                    }}
                                    min={-50}
                                    max={50}
                                    step={1}
                                    className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          <p className="text-xs text-slate-400 mt-2 italic">
                            These settings override global echo configuration for this set only.
                          </p>
                        </>
                      )}
                    </>
                  )}

                  {!generationSet.echoOverride?.enabled && (
                    <p className="text-xs text-slate-500">
                      Enable override to customize echo settings for this set instead of using global settings.
                    </p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

                </Accordion>
              </TabsContent>

              {/* Layout sub-tab: Z-Index (when global disabled) + Artboard & Alignment */}
              <TabsContent value="layout" className="mt-3" data-testid="subtab-content-layout">
                <Accordion type="multiple" className="space-y-3" defaultValue={[]}>
                  {/* Z-Index Layering Controls - only when global z-index is disabled */}
                  {!globalZIndexEnabled && (
                    <AccordionItem value="zindex" className="border-slate-700">
                      <AccordionTrigger className="text-slate-200 hover:text-white hover:no-underline py-3" data-testid="trigger-zindex-layering">
                        <div className="flex items-center gap-2">
                          <Layers className="w-4 h-4 text-slate-400" />
                          <span className="text-sm font-medium">Z-Index Layering</span>
                          <Info className="w-3 h-3 text-slate-500" data-testid="icon-zindex-info" />
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pb-4">
                        <div className="grid grid-cols-1 gap-4 pt-2">
                          <div>
                            <Label className="text-white text-xs">Base Offset</Label>
                            <Slider
                              value={[generationSet.zIndexConfig.baseOffset]}
                              onValueChange={([value]) => handleZIndexConfigChange('baseOffset', value)}
                              min={0}
                              max={10000}
                              step={100}
                              className="mt-2"
                              data-testid="slider-zindex-base-offset"
                              aria-label="Base Z-index offset"
                            />
                            <NumericInput
                              value={generationSet.zIndexConfig.baseOffset}
                              onChange={(value) => handleZIndexConfigChange('baseOffset', value)}
                              min={0}
                              step={100}
                              className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                            />
                            <p className="text-xs text-slate-500 mt-1">
                              Starting z-index for shapes in this set
                            </p>
                          </div>

                          <div>
                            <Label className="text-white text-xs">Increment Per Shape</Label>
                            <Slider
                              value={[generationSet.zIndexConfig.incrementPerShape]}
                              onValueChange={([value]) => handleZIndexConfigChange('incrementPerShape', value)}
                              min={1}
                              max={100}
                              step={1}
                              className="mt-2"
                              data-testid="slider-zindex-increment-per-shape"
                              aria-label="Z-index increment per shape"
                            />
                            <NumericInput
                              value={generationSet.zIndexConfig.incrementPerShape}
                              onChange={(value) => handleZIndexConfigChange('incrementPerShape', value)}
                              min={1}
                              max={100}
                              step={1}
                              className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                            />
                            <p className="text-xs text-slate-500 mt-1">
                              Z-index increment between shapes in this set
                            </p>
                          </div>

                          <div>
                            <Label className="text-white text-xs">Increment Per Shape Set</Label>
                            <Slider
                              value={[generationSet.zIndexConfig.incrementPerGeneration]}
                              onValueChange={([value]) => handleZIndexConfigChange('incrementPerGeneration', value)}
                              min={0}
                              max={1000}
                              step={10}
                              className="mt-2"
                              data-testid="slider-zindex-increment-per-generation"
                              aria-label="Z-index increment per generation"
                            />
                            <NumericInput
                              value={generationSet.zIndexConfig.incrementPerGeneration}
                              onChange={(value) => handleZIndexConfigChange('incrementPerGeneration', value)}
                              min={0}
                              max={1000}
                              step={10}
                              className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                            />
                            <p className="text-xs text-slate-500 mt-1">
                              Z-index increment between batch shape sets
                            </p>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

            {/* Artboard & Alignment Controls */}
            <AccordionItem value="artboard" className="border-slate-700">
              <AccordionTrigger className="text-slate-200 hover:text-white hover:no-underline py-3" data-testid="trigger-artboard-alignment">
                <div className="flex items-center gap-2">
                  <Maximize2 className="w-4 h-4 text-slate-400" />
                  <span className="text-sm font-medium">Artboard & Alignment</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                    <div className="grid grid-cols-1 gap-4 pt-2">
                        {/* Fit Target - Dropdown to select fit behavior */}
                        <div>
                            <Label className="text-white text-xs">Fit Target</Label>
                            <Select
                                value={generationSet.artboardAlignment.fitTarget || (generationSet.artboardAlignment.fitToArtboard ? 'artboard' : 'none')}
                                onValueChange={(value: FitTarget) => 
                                    onUpdate({
                                        artboardAlignment: {
                                            ...generationSet.artboardAlignment,
                                            fitTarget: value,
                                            fitToArtboard: value !== 'none'
                                        }
                                    })
                                }
                                data-testid="select-fit-target"
                            >
                                <SelectTrigger className="bg-slate-700 border-slate-600 text-white mt-1">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-slate-700 border-slate-600" style={{ zIndex: 10002 }}>
                                    <SelectItem value="none" className="text-white hover:bg-slate-600">None</SelectItem>
                                    <SelectItem value="artboard" className="text-white hover:bg-slate-600">Fit to Artboard</SelectItem>
                                    <SelectItem 
                                        value="bleed" 
                                        className={`text-white hover:bg-slate-600 ${!bleedEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        disabled={!bleedEnabled}
                                    >
                                        Fit to Bleed {!bleedEnabled && '(enable bleed first)'}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-slate-500 mt-1">
                                {!bleedEnabled && 'Enable bleed display or render in Artboard settings to use "Fit to Bleed"'}
                            </p>
                        </div>

                        {/* Fit Mode (only shown when Fit Target is artboard or bleed) */}
                        {(generationSet.artboardAlignment.fitTarget === 'artboard' || generationSet.artboardAlignment.fitTarget === 'bleed' || generationSet.artboardAlignment.fitToArtboard) && (
                            <>
                                <div>
                                    <Label className="text-white text-xs">Fit Mode</Label>
                                    <Select
                                        value={generationSet.artboardAlignment.fitMode || 'contain'}
                                        onValueChange={(value: 'contain' | 'fill') => 
                                            onUpdate({
                                                artboardAlignment: {
                                                    ...generationSet.artboardAlignment,
                                                    fitMode: value
                                                }
                                            })
                                        }
                                        data-testid="select-fit-mode"
                                    >
                                        <SelectTrigger className="bg-slate-700 border-slate-600 text-white mt-1">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-slate-700 border-slate-600" style={{ zIndex: 10002 }}>
                                            <SelectItem value="contain" className="text-white hover:bg-slate-600">Contain (maintain aspect ratio)</SelectItem>
                                            <SelectItem value="fill" className="text-white hover:bg-slate-600">Fill (stretch to fit both axes)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-slate-500 mt-1">
                                        Contain maintains aspect ratio, Fill stretches to fill entire artboard
                                    </p>
                                </div>
                            </>
                        )}

                        {/* Align To */}
                        <div>
                            <Label className="text-white text-xs">Align To</Label>
                            <Select
                                value={generationSet.artboardAlignment.alignTo}
                                onValueChange={(value: 'artboard' | 'set' | 'none') => 
                                    onUpdate({
                                        artboardAlignment: {
                                            ...generationSet.artboardAlignment,
                                            alignTo: value,
                                            ...(value !== 'set' && { targetSetId: undefined })
                                        }
                                    })
                                }
                                data-testid="select-align-to"
                            >
                                <SelectTrigger className="bg-slate-700 border-slate-600 text-white mt-1">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-slate-700 border-slate-600" style={{ zIndex: 10002 }}>
                                    <SelectItem value="none" className="text-white hover:bg-slate-600">None</SelectItem>
                                    <SelectItem value="artboard" className="text-white hover:bg-slate-600">Artboard</SelectItem>
                                    <SelectItem value="set" className="text-white hover:bg-slate-600">Another Set</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Target Set Selection (when aligning to another set) */}
                        {generationSet.artboardAlignment.alignTo === 'set' && (
                            <div>
                                <Label className="text-white text-xs">Target Set ID</Label>
                                <Input
                                    value={generationSet.artboardAlignment.targetSetId || ''}
                                    onChange={(e) => 
                                        onUpdate({
                                            artboardAlignment: {
                                                ...generationSet.artboardAlignment,
                                                targetSetId: e.target.value || undefined
                                            }
                                        })
                                    }
                                    placeholder="Enter target set ID"
                                    className="bg-slate-700 border-slate-600 text-white mt-1"
                                    data-testid="input-target-set-id"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    ID of the generation set to align to
                                </p>
                            </div>
                        )}

                        {/* Alignment Type */}
                        {generationSet.artboardAlignment.alignTo !== 'none' && (
                            <div>
                                <Label className="text-white text-xs">Alignment</Label>
                                <Select
                                    value={generationSet.artboardAlignment.alignmentType}
                                    onValueChange={(value) => 
                                        onUpdate({
                                            artboardAlignment: {
                                                ...generationSet.artboardAlignment,
                                                alignmentType: value as any
                                            }
                                        })
                                    }
                                    data-testid="select-alignment-type"
                                >
                                    <SelectTrigger className="bg-slate-700 border-slate-600 text-white mt-1">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-700 border-slate-600" style={{ zIndex: 10002 }}>
                                        <SelectItem value="center" className="text-white hover:bg-slate-600">
                                            <div className="flex items-center gap-2">
                                                <AlignCenter className="w-3 h-3" />
                                                <span>Center</span>
                                            </div>
                                        </SelectItem>
                                        <SelectItem value="top-left" className="text-white hover:bg-slate-600">Top Left</SelectItem>
                                        <SelectItem value="top-center" className="text-white hover:bg-slate-600">Top Center</SelectItem>
                                        <SelectItem value="top-right" className="text-white hover:bg-slate-600">Top Right</SelectItem>
                                        <SelectItem value="center-left" className="text-white hover:bg-slate-600">Center Left</SelectItem>
                                        <SelectItem value="center-right" className="text-white hover:bg-slate-600">Center Right</SelectItem>
                                        <SelectItem value="bottom-left" className="text-white hover:bg-slate-600">Bottom Left</SelectItem>
                                        <SelectItem value="bottom-center" className="text-white hover:bg-slate-600">Bottom Center</SelectItem>
                                        <SelectItem value="bottom-right" className="text-white hover:bg-slate-600">Bottom Right</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* Margin Controls */}
                        {(generationSet.artboardAlignment.fitToArtboard || generationSet.artboardAlignment.alignTo !== 'none') && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <Label className="text-white text-xs">Margin Mode</Label>
                                    <Select
                                        value={typeof generationSet.artboardAlignment.margin === 'number' ? 'uniform' : 'individual'}
                                        onValueChange={(mode) => {
                                            const currentMargin = generationSet.artboardAlignment.margin;
                                            const uniformValue = typeof currentMargin === 'number' ? currentMargin : 0;
                                            
                                            onUpdate({
                                                artboardAlignment: {
                                                    ...generationSet.artboardAlignment,
                                                    margin: mode === 'uniform' ? uniformValue : {
                                                        top: uniformValue,
                                                        bottom: uniformValue,
                                                        left: uniformValue,
                                                        right: uniformValue
                                                    }
                                                }
                                            });
                                        }}
                                        data-testid="select-margin-mode"
                                    >
                                        <SelectTrigger className="bg-slate-700 border-slate-600 text-white w-[140px] h-8">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-slate-700 border-slate-600" style={{ zIndex: 10002 }}>
                                            <SelectItem value="uniform" className="text-white hover:bg-slate-600">Uniform</SelectItem>
                                            <SelectItem value="individual" className="text-white hover:bg-slate-600">Individual</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                
                                {typeof generationSet.artboardAlignment.margin === 'number' ? (
                                    <div>
                                        <Label className="text-white text-xs">All Sides (px)</Label>
                                        <Slider
                                            value={[generationSet.artboardAlignment.margin]}
                                            onValueChange={([value]) => 
                                                onUpdate({
                                                    artboardAlignment: {
                                                        ...generationSet.artboardAlignment,
                                                        margin: value
                                                    }
                                                })
                                            }
                                            min={0}
                                            max={100}
                                            step={1}
                                            className="mt-2"
                                            data-testid="slider-margin-uniform"
                                        />
                                        <NumericInput
                                            value={generationSet.artboardAlignment.margin}
                                            onChange={(value) => onUpdate({ artboardAlignment: { ...generationSet.artboardAlignment, margin: value } })}
                                            min={0}
                                            max={100}
                                            step={1}
                                            className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                        />
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <Label className="text-white text-xs">Top (px)</Label>
                                            <Slider
                                                value={[generationSet.artboardAlignment.margin.top]}
                                                onValueChange={([value]) => 
                                                    onUpdate({
                                                        artboardAlignment: {
                                                            ...generationSet.artboardAlignment,
                                                            margin: {
                                                                ...(generationSet.artboardAlignment.margin as any),
                                                                top: value
                                                            }
                                                        }
                                                    })
                                                }
                                                min={0}
                                                max={100}
                                                step={1}
                                                className="mt-1"
                                                data-testid="slider-margin-top"
                                            />
                                            <NumericInput
                                                value={generationSet.artboardAlignment.margin.top}
                                                onChange={(value) => onUpdate({ artboardAlignment: { ...generationSet.artboardAlignment, margin: { ...(generationSet.artboardAlignment.margin as any), top: value } } })}
                                                min={0}
                                                max={100}
                                                step={1}
                                                className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                            />
                                        </div>
                                        <div>
                                            <Label className="text-white text-xs">Bottom (px)</Label>
                                            <Slider
                                                value={[generationSet.artboardAlignment.margin.bottom]}
                                                onValueChange={([value]) => 
                                                    onUpdate({
                                                        artboardAlignment: {
                                                            ...generationSet.artboardAlignment,
                                                            margin: {
                                                                ...(generationSet.artboardAlignment.margin as any),
                                                                bottom: value
                                                            }
                                                        }
                                                    })
                                                }
                                                min={0}
                                                max={100}
                                                step={1}
                                                className="mt-1"
                                                data-testid="slider-margin-bottom"
                                            />
                                            <NumericInput
                                                value={generationSet.artboardAlignment.margin.bottom}
                                                onChange={(value) => onUpdate({ artboardAlignment: { ...generationSet.artboardAlignment, margin: { ...(generationSet.artboardAlignment.margin as any), bottom: value } } })}
                                                min={0}
                                                max={100}
                                                step={1}
                                                className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                            />
                                        </div>
                                        <div>
                                            <Label className="text-white text-xs">Left (px)</Label>
                                            <Slider
                                                value={[generationSet.artboardAlignment.margin.left]}
                                                onValueChange={([value]) => 
                                                    onUpdate({
                                                        artboardAlignment: {
                                                            ...generationSet.artboardAlignment,
                                                            margin: {
                                                                ...(generationSet.artboardAlignment.margin as any),
                                                                left: value
                                                            }
                                                        }
                                                    })
                                                }
                                                min={0}
                                                max={100}
                                                step={1}
                                                className="mt-1"
                                                data-testid="slider-margin-left"
                                            />
                                            <NumericInput
                                                value={generationSet.artboardAlignment.margin.left}
                                                onChange={(value) => onUpdate({ artboardAlignment: { ...generationSet.artboardAlignment, margin: { ...(generationSet.artboardAlignment.margin as any), left: value } } })}
                                                min={0}
                                                max={100}
                                                step={1}
                                                className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                            />
                                        </div>
                                        <div>
                                            <Label className="text-white text-xs">Right (px)</Label>
                                            <Slider
                                                value={[generationSet.artboardAlignment.margin.right]}
                                                onValueChange={([value]) => 
                                                    onUpdate({
                                                        artboardAlignment: {
                                                            ...generationSet.artboardAlignment,
                                                            margin: {
                                                                ...(generationSet.artboardAlignment.margin as any),
                                                                right: value
                                                            }
                                                        }
                                                    })
                                                }
                                                min={0}
                                                max={100}
                                                step={1}
                                                className="mt-1"
                                                data-testid="slider-margin-right"
                                            />
                                            <NumericInput
                                                value={generationSet.artboardAlignment.margin.right}
                                                onChange={(value) => onUpdate({ artboardAlignment: { ...generationSet.artboardAlignment, margin: { ...(generationSet.artboardAlignment.margin as any), right: value } } })}
                                                min={0}
                                                max={100}
                                                step={1}
                                                className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                            />
                                        </div>
                                    </div>
                                )}
                                
                                <p className="text-xs text-slate-500">
                                    Distance from artboard edges in pixels
                                </p>
                            </div>
                        )}
                    </div>
                </AccordionContent>
              </AccordionItem>
                </Accordion>
              </TabsContent>
            </Tabs>

            <Separator className="bg-slate-700" />

            {/* Basic Information — collapsed by default */}
            <Accordion
              type="multiple"
              defaultValue={[]}
              className="space-y-3"
              data-testid="accordion-basic-info"
            >
              <AccordionItem value="basic-info" className="border-slate-700">
                <AccordionTrigger
                  className="text-slate-200 hover:text-white hover:no-underline py-3"
                  data-testid="trigger-basic-info"
                >
                  <div className="flex items-center gap-2">
                    <Type className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-medium">Basic Information</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="space-y-4 pt-2" data-testid="section-basic-information">
                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <Label htmlFor="set-name" className="text-white">
                          Set Name
                        </Label>
                        <Input
                          id="set-name"
                          value={generationSet.name}
                            onChange={(e) => handleNameChange(e.target.value)}
                            placeholder="Enter set name"
                            className={`bg-slate-800 border-slate-600 text-white ${
                              getFieldValidation('name').hasError || isDuplicateName ? 'border-red-500' : ''
                            }`}
                            autoComplete="off"
                            data-testid="input-set-name"
                            aria-invalid={getFieldValidation('name').hasError || isDuplicateName}
                            aria-describedby={getFieldValidation('name').hasError || isDuplicateName ? 'set-name-error' : undefined}
                          />
                          {isDuplicateName && (
                            <p className="text-xs text-red-400 mt-1" data-testid="error-duplicate-name">
                              A set with this name already exists
                            </p>
                          )}
                          <div id="set-name-error" role="alert">
                            {renderFieldValidation('name')}
                          </div>
                        </div>

                        <div>
                          <Label htmlFor="set-description" className="text-white">
                            Description (Optional)
                          </Label>
                          <Textarea
                            id="set-description"
                            value={generationSet.description || ''}
                            onChange={(e) => handleDescriptionChange(e.target.value)}
                            placeholder="Enter optional description"
                            className="bg-slate-800 border-slate-600 text-white"
                            rows={2}
                            data-testid="textarea-set-description"
                            aria-describedby="set-description-help"
                          />
                          <div id="set-description-help" className="sr-only">
                            Optional description for this generation set
                          </div>
                        </div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

            {/* Shape-Specific Properties - Hidden */}
            {false && generationSet.enabledShapeTypes.length > 0 && (
              <>
                <Separator className="bg-slate-700" />
                
                <div className="space-y-4">
                  <div className="flex items-center gap-2" data-testid="section-shape-specific-properties">
                    <Settings className="w-4 h-4 text-slate-400" />
                    <h4 className="text-sm font-medium text-white" data-testid="heading-shape-specific-properties">Shape-Specific Properties</h4>
                  </div>

                  <Tabs 
                    defaultValue={generationSet.enabledShapeTypes.find(hasConfigurableProperties) || generationSet.enabledShapeTypes[0]} 
                    className="w-full" 
                    data-testid="tabs-shape-properties"
                  >
                    {/* Only show tabs if there are shape types with properties */}
                    {generationSet.enabledShapeTypes.filter(hasConfigurableProperties).length > 0 && (
                      <div className="mb-4">
                        <TabsList className="w-full bg-slate-800 flex flex-wrap justify-start gap-1 p-1 h-auto min-h-[40px]" data-testid="tabs-list-shape-properties">
                          {generationSet.enabledShapeTypes
                            .filter(hasConfigurableProperties)
                            .map((shapeType) => (
                            <TabsTrigger 
                              key={shapeType} 
                              value={shapeType} 
                              className="text-xs px-3 py-2 flex-shrink-0 data-[state=active]:!text-blue-500" 
                              data-testid={`tab-trigger-${shapeType}`}
                            >
                              {getShapeDisplayName(shapeType)}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </div>
                    )}

                    {/* Show message if no shape types have properties */}
                    {generationSet.enabledShapeTypes.filter(hasConfigurableProperties).length === 0 && (
                      <div className="text-center py-8 bg-slate-800 rounded-lg">
                        <p className="text-sm text-slate-400">
                          None of the selected shape types have configurable properties.
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Try selecting shapes like circles, polygons, stars, or rounded rectangles.
                        </p>
                      </div>
                    )}
                    
                    {generationSet.enabledShapeTypes.map((shapeType) => (
                      <TabsContent key={shapeType} value={shapeType} className="mt-4" data-testid={`tab-content-${shapeType}`}>
                        <div className="bg-slate-800 p-4 rounded-lg">
                          <h5 className="text-sm font-medium text-white mb-3">
                            {shapeType.replace('-', ' ')} Properties
                          </h5>
                          
                          {/* Render shape-specific controls based on shape type */}
                          {(shapeType === 'rounded-rectangle' || shapeType === 'rounded-square') && (
                            <div className="space-y-4">
                              <div>
                                <Label className="text-white text-xs">Corner Radius Mode</Label>
                                <Select
                                  value={generationSet.shapeSpecificProperties[shapeType]?.cornerRadiusMode || 'range'}
                                  onValueChange={(value) => 
                                    handleShapeSpecificPropertyChange(shapeType, 'cornerRadiusMode', value)
                                  }
                                >
                                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="bg-slate-700 border-slate-600 text-white" style={{ zIndex: 10002 }}>
                                    <SelectItem value="fixed">Constant</SelectItem>
                                    <SelectItem value="range">Range</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              
                              {generationSet.shapeSpecificProperties[shapeType]?.cornerRadiusMode === 'fixed' ? (
                                <div>
                                  <Label className="text-white text-xs">Corner Radius</Label>
                                  <Slider
                                    value={[generationSet.shapeSpecificProperties[shapeType]?.cornerRadiusValue || 5]}
                                    onValueChange={([value]) => 
                                      handleShapeSpecificPropertyChange(shapeType, 'cornerRadiusValue', value)
                                    }
                                    min={0}
                                    max={50}
                                    step={1}
                                    className="mt-2"
                                    data-testid={`slider-${shapeType}-segment-count-value`}
                                  />
                                  <NumericInput
                                    value={generationSet.shapeSpecificProperties[shapeType]?.cornerRadiusValue || 5}
                                    onChange={(value) => handleShapeSpecificPropertyChange(shapeType, 'cornerRadiusValue', value)}
                                    min={0}
                                    max={50}
                                    step={1}
                                    className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                  />
                                </div>
                              ) : (
                                <div>
                                  <Label className="text-white text-xs">
                                    Corner Radius Range: {
                                      (generationSet.shapeSpecificProperties[shapeType]?.cornerRadiusRange || [0, 10])[0]
                                    } - {
                                      (generationSet.shapeSpecificProperties[shapeType]?.cornerRadiusRange || [0, 10])[1]
                                    }
                                  </Label>
                                  <Slider
                                    value={generationSet.shapeSpecificProperties[shapeType]?.cornerRadiusRange || [0, 10]}
                                    onValueChange={(value) => 
                                      handleShapeSpecificPropertyChange(shapeType, 'cornerRadiusRange', value)
                                    }
                                    min={0}
                                    max={50}
                                    step={1}
                                    className="mt-2"
                                  />
                                </div>
                              )}
                            </div>
                          )}

                          {shapeType === 'polygon' && (
                            <StyledModeField
                              label="Point Count"
                              config={convertToModeConfig(shapeType, 'pointCount', 6, [3, 8])}
                              onChange={(config) => handleModeConfigChange(shapeType, 'pointCount', config)}
                              bounds={{ min: 3, max: 20 }}
                              step={1}
                            />
                          )}

                          {shapeType === 'star' && (
                            <div className="space-y-4">
                              <StyledModeField
                                label="Point Count"
                                config={convertToModeConfig(shapeType, 'pointCount', 5, [3, 8])}
                                onChange={(config) => handleModeConfigChange(shapeType, 'pointCount', config)}
                                bounds={{ min: 3, max: 20 }}
                                step={1}
                              />
                              
                              <StyledModeField
                                label="Inner Radius"
                                config={convertToModeConfig(shapeType, 'innerRadius', 0.5, [0.2, 0.8])}
                                onChange={(config) => handleModeConfigChange(shapeType, 'innerRadius', config)}
                                bounds={{ min: 0.1, max: 0.9 }}
                                step={0.1}
                              />
                            </div>
                          )}

                          {(shapeType === 'ring' || shapeType === 'spline-ring') && (
                            <StyledModeField
                              label="Inner Radius"
                              config={convertToModeConfig(shapeType, 'innerRadius', 0.5, [0.2, 0.8])}
                              onChange={(config) => handleModeConfigChange(shapeType, 'innerRadius', config)}
                              bounds={{ min: 0.1, max: 0.9 }}
                              step={0.1}
                            />
                          )}


                          {(shapeType === 'circle' || shapeType === 'ellipse') && (
                            <StyledModeField
                              label="Segment Count"
                              config={convertToModeConfig(shapeType, 'segmentCount', 24, [16, 32])}
                              onChange={(config) => handleModeConfigChange(shapeType, 'segmentCount', config)}
                              bounds={{ min: 8, max: 64 }}
                              step={4}
                            />
                          )}

                          {shapeType === 'line-vector' && (
                            <div className="space-y-4">
                              {/* Direction Controls */}
                              <div className="space-y-4">
                                <div>
                                  <Label className="text-white text-xs">Direction Mode</Label>
                                  <Select
                                    value={generationSet.shapeSpecificProperties[shapeType]?.directionMode || 'range'}
                                    onValueChange={(value) => 
                                      handleShapeSpecificPropertyChange(shapeType, 'directionMode', value)
                                    }
                                  >
                                    <SelectTrigger className="bg-slate-700 border-slate-600 text-white" data-testid="select-line-vector-direction-mode">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-700 border-slate-600 text-white" style={{ zIndex: 10002 }}>
                                      <SelectItem value="fixed" data-testid="option-line-vector-direction-fixed">Constant</SelectItem>
                                      <SelectItem value="range" data-testid="option-line-vector-direction-range">Range</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                
                                {generationSet.shapeSpecificProperties[shapeType]?.directionMode === 'fixed' ? (
                                  <div>
                                    <Label className="text-white text-xs">Direction (°)</Label>
                                    <Slider
                                      value={[generationSet.shapeSpecificProperties[shapeType]?.directionValue || 0]}
                                      onValueChange={([value]) => 
                                        handleShapeSpecificPropertyChange(shapeType, 'directionValue', value)
                                      }
                                      min={0}
                                      max={360}
                                      step={1}
                                      className="mt-2"
                                      data-testid="slider-line-vector-direction-value"
                                    />
                                    <NumericInput
                                      value={generationSet.shapeSpecificProperties[shapeType]?.directionValue || 0}
                                      onChange={(value) => handleShapeSpecificPropertyChange(shapeType, 'directionValue', value)}
                                      min={0}
                                      max={360}
                                      step={1}
                                      className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                    />
                                  </div>
                                ) : (
                                  <div>
                                    <Label className="text-white text-xs">
                                      Direction Range: {
                                        (generationSet.shapeSpecificProperties[shapeType]?.directionRange || [0, 360])[0]
                                      }° - {
                                        (generationSet.shapeSpecificProperties[shapeType]?.directionRange || [0, 360])[1]
                                      }°
                                    </Label>
                                    <Slider
                                      value={generationSet.shapeSpecificProperties[shapeType]?.directionRange || [0, 360]}
                                      onValueChange={(value) => 
                                        handleShapeSpecificPropertyChange(shapeType, 'directionRange', value)
                                      }
                                      min={0}
                                      max={360}
                                      step={1}
                                      className="mt-2"
                                      data-testid="slider-line-vector-direction-range"
                                    />
                                  </div>
                                )}
                              </div>

                              {/* Length Controls */}
                              <div className="space-y-4">
                                <div>
                                  <Label className="text-white text-xs">Length Mode</Label>
                                  <Select
                                    value={generationSet.shapeSpecificProperties[shapeType]?.lengthMode || 'range'}
                                    onValueChange={(value) => 
                                      handleShapeSpecificPropertyChange(shapeType, 'lengthMode', value)
                                    }
                                  >
                                    <SelectTrigger className="bg-slate-700 border-slate-600 text-white" data-testid="select-line-vector-length-mode">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-700 border-slate-600 text-white" style={{ zIndex: 10002 }}>
                                      <SelectItem value="fixed" data-testid="option-line-vector-length-fixed">Constant</SelectItem>
                                      <SelectItem value="range" data-testid="option-line-vector-length-range">Range</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                
                                {generationSet.shapeSpecificProperties[shapeType]?.lengthMode === 'fixed' ? (
                                  <div>
                                    <Label className="text-white text-xs">Length</Label>
                                    <Slider
                                      value={[generationSet.shapeSpecificProperties[shapeType]?.lengthValue || 100]}
                                      onValueChange={([value]) => 
                                        handleShapeSpecificPropertyChange(shapeType, 'lengthValue', value)
                                      }
                                      min={5}
                                      max={500}
                                      step={1}
                                      className="mt-2"
                                      data-testid="slider-line-vector-length-value"
                                    />
                                    <NumericInput
                                      value={generationSet.shapeSpecificProperties[shapeType]?.lengthValue || 100}
                                      onChange={(value) => handleShapeSpecificPropertyChange(shapeType, 'lengthValue', value)}
                                      min={5}
                                      max={500}
                                      step={1}
                                      className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                    />
                                  </div>
                                ) : (
                                  <div>
                                    <Label className="text-white text-xs">
                                      Length Range: {
                                        (generationSet.shapeSpecificProperties[shapeType]?.lengthRange || [50, 150])[0]
                                      } - {
                                        (generationSet.shapeSpecificProperties[shapeType]?.lengthRange || [50, 150])[1]
                                      }
                                    </Label>
                                    <Slider
                                      value={generationSet.shapeSpecificProperties[shapeType]?.lengthRange || [50, 150]}
                                      onValueChange={(value) => 
                                        handleShapeSpecificPropertyChange(shapeType, 'lengthRange', value)
                                      }
                                      min={5}
                                      max={500}
                                      step={1}
                                      className="mt-2"
                                      data-testid="slider-line-vector-length-range"
                                    />
                                  </div>
                                )}
                              </div>

                              {/* Centroid Controls */}
                              <div className="space-y-4">
                                <div>
                                  <Label className="text-white text-xs">Centroid Mode</Label>
                                  <Select
                                    value={generationSet.shapeSpecificProperties[shapeType]?.centroidMode || 'fixed'}
                                    onValueChange={(value) => 
                                      handleShapeSpecificPropertyChange(shapeType, 'centroidMode', value)
                                    }
                                  >
                                    <SelectTrigger className="bg-slate-700 border-slate-600 text-white" data-testid="select-line-vector-centroid-mode">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-700 border-slate-600 text-white" style={{ zIndex: 10002 }}>
                                      <SelectItem value="fixed" data-testid="option-line-vector-centroid-fixed">Constant</SelectItem>
                                      <SelectItem value="range" data-testid="option-line-vector-centroid-range">Range</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                
                                {generationSet.shapeSpecificProperties[shapeType]?.centroidMode === 'fixed' ? (
                                  <div>
                                    <Label className="text-white text-xs">Centroid</Label>
                                    <Slider
                                      value={[generationSet.shapeSpecificProperties[shapeType]?.centroidValue || 0.5]}
                                      onValueChange={([value]) => 
                                        handleShapeSpecificPropertyChange(shapeType, 'centroidValue', value)
                                      }
                                      min={0}
                                      max={1}
                                      step={0.01}
                                      className="mt-2"
                                      data-testid="slider-line-vector-centroid-value"
                                    />
                                    <NumericInput
                                      value={generationSet.shapeSpecificProperties[shapeType]?.centroidValue || 0.5}
                                      onChange={(value) => handleShapeSpecificPropertyChange(shapeType, 'centroidValue', value)}
                                      min={0}
                                      max={1}
                                      step={0.01}
                                      className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                    />
                                  </div>
                                ) : (
                                  <div>
                                    <Label className="text-white text-xs">
                                      Centroid Range: {
                                        (generationSet.shapeSpecificProperties[shapeType]?.centroidRange || [0, 1])[0].toFixed(2)
                                      } - {
                                        (generationSet.shapeSpecificProperties[shapeType]?.centroidRange || [0, 1])[1].toFixed(2)
                                      }
                                    </Label>
                                    <Slider
                                      value={generationSet.shapeSpecificProperties[shapeType]?.centroidRange || [0, 1]}
                                      onValueChange={(value) => 
                                        handleShapeSpecificPropertyChange(shapeType, 'centroidRange', value)
                                      }
                                      min={0}
                                      max={1}
                                      step={0.01}
                                      className="mt-2"
                                      data-testid="slider-line-vector-centroid-range"
                                    />
                                  </div>
                                )}
                              </div>
                              
                              {/* Stroke Cap Probabilities */}
                              <div className="space-y-4">
                                <Label className="text-white text-xs">Stroke Cap Probabilities (%)</Label>
                                <div className="space-y-3">
                                  {(['round', 'square', 'butt'] as const).map((cap) => {
                                    const strokeCaps = generationSet.shapeSpecificProperties[shapeType]?.strokeCapProbabilities ?? { round: 33, square: 33, butt: 34 };
                                    const currentValue = strokeCaps[cap] ?? 33;
                                    return (
                                      <div key={cap} className="space-y-2">
                                        <Label className="text-white capitalize text-xs">{cap}</Label>
                                        <Slider
                                          value={[currentValue]}
                                          onValueChange={([value]) => {
                                            const currentCaps = generationSet.shapeSpecificProperties[shapeType]?.strokeCapProbabilities ?? { round: 33, square: 33, butt: 34 };
                                            const updatedCaps = {
                                              ...currentCaps,
                                              [cap]: value
                                            };
                                            handleShapeSpecificPropertyChange(shapeType, 'strokeCapProbabilities', updatedCaps);
                                          }}
                                          min={0}
                                          max={100}
                                          step={1}
                                          className="mt-1"
                                          data-testid={`slider-line-vector-${cap}-cap`}
                                        />
                                        <NumericInput
                                          value={currentValue}
                                          onChange={(value) => {
                                            const currentCaps = generationSet.shapeSpecificProperties[shapeType]?.strokeCapProbabilities ?? { round: 33, square: 33, butt: 34 };
                                            handleShapeSpecificPropertyChange(shapeType, 'strokeCapProbabilities', { ...currentCaps, [cap]: value });
                                          }}
                                          min={0}
                                          max={100}
                                          step={1}
                                          className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners mt-1"
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Point Count Controls for Line/Curve shapes */}
                          {(shapeType === 'line' || shapeType === 'bezier' || shapeType === 'cubic' || shapeType === 'smooth-spline') && (
                            <StyledModeField
                              label="Point Count"
                              config={convertToModeConfig(shapeType, 'pointCount', 4, [2, 8])}
                              onChange={(config) => handleModeConfigChange(shapeType, 'pointCount', config)}
                              bounds={{ min: 2, max: 20 }}
                              step={1}
                            />
                          )}


                          {/* Default message for shapes without specific properties */}
                          {!['rounded-rectangle', 'rounded-square', 'polygon', 'star', 'ring', 'spline-ring', 'circle', 'ellipse', 'line-vector', 'line', 'bezier', 'cubic', 'smooth-spline'].includes(shapeType) && (
                            <div className="text-center py-4">
                              <p className="text-sm text-slate-500">
                                No specific properties available for {shapeType.replace('-', ' ')}
                              </p>
                            </div>
                          )}
                        </div>
                      </TabsContent>
                    ))}
                  </Tabs>
                </div>
              </>
            )}

            {/* Validation Errors */}
            {showInlineValidation && currentValidation.errors.length > 0 && (
              <div className="bg-red-900/20 border border-red-700 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <X className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-medium text-red-400">Validation Errors</span>
                </div>
                <ul className="space-y-2">
                  {currentValidation.errors.map((error, index) => (
                    <li key={index} className="text-sm text-red-300">
                      • {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
    </SafeSection>
  );
}