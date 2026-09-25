import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Plus, Minus, Layers, Info, Eye, EyeOff, X, Copy, Sparkles, ArrowLeft } from 'lucide-react';
import { GenerationSet, ShapeCountMode, BatchConfigSettings } from '@shared/schema';
import { ScatterSettings, ShapeType } from '@/lib/shapeTypes';

interface GenerationSetsDropdownProps {
  // Current state to capture/restore
  currentSetId: string | null;
  generationSets: GenerationSet[];
  
  // Current UI state that gets captured
  enabledShapeTypes: Set<ShapeType>;
  scatterSettings: ScatterSettings;
  batchConfigSettings: BatchConfigSettings;
  shapeCountMode: ShapeCountMode;
  shapeCountFixed: number;
  shapeCountRange: [number, number];
  
  // Callbacks
  onSetChange: (setId: string | null) => void;
  onCreateSet: (name: string) => void;
  onCreateCleanSet?: (name: string) => void;
  onDeleteSet: (setId: string) => void;
  onOpenManager: () => void;
  
  // Name generation
  generateUniqueSetName?: (baseName?: string) => string;
  
  // Conditional enabling
  enabled: boolean;
  
  // Styling
  className?: string;
  size?: 'sm' | 'default';
  showLabel?: boolean;
  variant?: 'inline' | 'boxed';  // boxed = sidebar style with border and stacked layout
  'data-testid'?: string;
}

export function GenerationSetsDropdown({
  currentSetId,
  generationSets,
  enabledShapeTypes,
  scatterSettings,
  batchConfigSettings,
  shapeCountMode,
  shapeCountFixed,
  shapeCountRange,
  onSetChange,
  onCreateSet,
  onCreateCleanSet,
  onDeleteSet,
  onOpenManager,
  generateUniqueSetName,
  enabled,
  className = '',
  size = 'default',
  showLabel = false,
  variant = 'inline',
  'data-testid': testId
}: GenerationSetsDropdownProps) {
  const [isAddPopoverOpen, setIsAddPopoverOpen] = useState(false);
  const [showNewSetForm, setShowNewSetForm] = useState(false);
  const [newSetFormName, setNewSetFormName] = useState('');
  const newSetInputRef = useRef<HTMLInputElement>(null);

  // Pre-fill with unique name and focus the input when the form appears
  useEffect(() => {
    if (showNewSetForm) {
      const suggestedName = generateUniqueSetName ? generateUniqueSetName() : 'Set 1';
      setNewSetFormName(suggestedName);
      setTimeout(() => newSetInputRef.current?.select(), 50);
    }
  }, [showNewSetForm, generateUniqueSetName]);

  // Reset form when popover closes
  useEffect(() => {
    if (!isAddPopoverOpen) {
      setShowNewSetForm(false);
      setNewSetFormName('');
    }
  }, [isAddPopoverOpen]);

  const existingSetNames = generationSets.map(s => s.name.toLowerCase());
  const trimmedNewName = newSetFormName.trim();
  const isNewNameTaken = trimmedNewName.length > 0 && existingSetNames.includes(trimmedNewName.toLowerCase());
  const isNewNameEmpty = trimmedNewName.length === 0;

  const handleConfirmNewSet = useCallback(() => {
    if (isNewNameTaken || isNewNameEmpty) return;
    if (onCreateCleanSet) {
      onCreateCleanSet(trimmedNewName);
    } else {
      onCreateSet(trimmedNewName);
    }
    setIsAddPopoverOpen(false);
  }, [trimmedNewName, isNewNameTaken, isNewNameEmpty, onCreateCleanSet, onCreateSet]);

  // Initialize showOnlyEnabled from localStorage
  const [showOnlyEnabled, setShowOnlyEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('generationSetsDropdownShowOnlyEnabled') === 'true';
    }
    return false;
  });

  // Persist showOnlyEnabled to localStorage
  useEffect(() => {
    localStorage.setItem('generationSetsDropdownShowOnlyEnabled', String(showOnlyEnabled));
  }, [showOnlyEnabled]);

  // Filter generation sets based on toggle, but always include the currently selected set
  const filteredGenerationSets = showOnlyEnabled 
    ? generationSets.filter(set => set.enabled || set.id === currentSetId)
    : generationSets;

  const handleDeleteCurrentSet = () => {
    if (currentSetId) {
      onDeleteSet(currentSetId);
    }
  };

  const handleNewCleanSet = () => {
    setShowNewSetForm(true);
  };

  const handleDuplicateCurrentSet = () => {
    const baseName = currentSet?.name || 'Set';
    const dupName = generateUniqueSetName
      ? generateUniqueSetName(`${baseName} Copy`)
      : `${baseName} (Copy)`;
    onCreateSet(dupName);
    setIsAddPopoverOpen(false);
  };

  const currentSet = generationSets.find(set => set.id === currentSetId);
  const canDelete = currentSetId && generationSets.length > 1;

  const buttonSize = size === 'sm' ? 'sm' : 'default';
  const selectHeight = size === 'sm' ? 'h-8' : 'h-10';
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';

  // Popover content for the add button
  const addPopoverContent = (
    <PopoverContent
      className="w-64 p-0 bg-slate-800 border-slate-600"
      align="end"
      sideOffset={4}
      style={{ zIndex: 10002 }}
    >
      {showNewSetForm ? (
        /* Inline name-entry form */
        <>
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-700">
            <button
              onClick={() => setShowNewSetForm(false)}
              className="text-slate-400 hover:text-slate-200 transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs font-medium text-slate-300 flex-1">New shape set</span>
            <button
              onClick={() => setIsAddPopoverOpen(false)}
              className="text-slate-400 hover:text-slate-200 transition-colors"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="p-3 space-y-2">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Set name</label>
              <Input
                ref={newSetInputRef}
                value={newSetFormName}
                onChange={e => setNewSetFormName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleConfirmNewSet();
                  if (e.key === 'Escape') setIsAddPopoverOpen(false);
                }}
                className={`h-7 text-xs bg-slate-700 border-slate-600 text-slate-100 ${
                  isNewNameTaken ? 'border-red-500 focus-visible:ring-red-500' : ''
                }`}
                placeholder="Enter set name…"
                data-testid={`${testId}-new-name-input`}
              />
              {isNewNameTaken && (
                <p className="text-xs text-red-400">
                  A set named "{trimmedNewName}" already exists. Choose a different name.
                </p>
              )}
            </div>
            <Button
              size="sm"
              onClick={handleConfirmNewSet}
              disabled={isNewNameEmpty || isNewNameTaken}
              className="w-full h-7 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
              data-testid={`${testId}-new-confirm-button`}
            >
              Create
            </Button>
          </div>
        </>
      ) : (
        /* Default choice list */
        <>
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
            <span className="text-xs font-medium text-slate-300">Add Shape Set</span>
            <button
              onClick={() => setIsAddPopoverOpen(false)}
              className="text-slate-400 hover:text-slate-200 transition-colors"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="p-1">
            <button
              onClick={handleNewCleanSet}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-left hover:bg-slate-700 transition-colors group"
              data-testid={`${testId}-new-clean-button`}
            >
              <div className="flex-shrink-0 w-6 h-6 rounded bg-slate-700 group-hover:bg-slate-600 flex items-center justify-center transition-colors">
                <Sparkles className="h-3 w-3 text-blue-400" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-200">New shape set</div>
                <div className="text-xs text-slate-400">Start with default settings</div>
              </div>
            </button>
            <button
              onClick={handleDuplicateCurrentSet}
              disabled={!currentSet}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-left hover:bg-slate-700 transition-colors group disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid={`${testId}-duplicate-button`}
            >
              <div className="flex-shrink-0 w-6 h-6 rounded bg-slate-700 group-hover:bg-slate-600 flex items-center justify-center transition-colors">
                <Copy className="h-3 w-3 text-slate-300" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-200">
                  Duplicate{currentSet ? ` "${currentSet.name}"` : ''}
                </div>
                <div className="text-xs text-slate-400">Copy current set's settings</div>
              </div>
            </button>
          </div>
        </>
      )}
    </PopoverContent>
  );

  // Render buttons component (shared between variants)
  const buttonsComponent = enabled && (
    <div className="flex items-center gap-1">
      <Popover open={isAddPopoverOpen} onOpenChange={setIsAddPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size={buttonSize}
            disabled={!enabled}
            className={`px-2 bg-slate-800 border-slate-600 hover:bg-slate-700 ${!enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            title="Add shape set"
            data-testid={`${testId}-add-button`}
          >
            <Plus className={`${iconSize} text-slate-300`} />
          </Button>
        </PopoverTrigger>
        {addPopoverContent}
      </Popover>
      <Button
        variant="outline"
        size={buttonSize}
        onClick={handleDeleteCurrentSet}
        disabled={!enabled || !canDelete}
        className={`px-2 bg-slate-800 border-slate-600 hover:bg-slate-700 ${(!enabled || !canDelete) ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={canDelete ? "Delete current generation set" : "Cannot delete - only one set remaining"}
        data-testid={`${testId}-remove-button`}
      >
        <Minus className={`${iconSize} text-slate-300`} />
      </Button>
      <Button
        variant="outline"
        size={buttonSize}
        onClick={onOpenManager}
        disabled={!enabled}
        className={`px-2 bg-slate-800 border-slate-600 hover:bg-slate-700 ${!enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title="Open Generation Sets Manager"
        data-testid={`${testId}-manager-button`}
      >
        <Layers className={`${iconSize} text-slate-300`} />
      </Button>
      <Button
        variant="outline"
        size={buttonSize}
        onClick={() => setShowOnlyEnabled(prev => !prev)}
        disabled={!enabled}
        className={`px-2 bg-slate-800 border-slate-600 hover:bg-slate-700 ${!enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={showOnlyEnabled ? "Show all sets" : "Show only enabled sets"}
        data-testid={`${testId}-filter-button`}
      >
        {showOnlyEnabled ? (
          <EyeOff className={`${iconSize} text-blue-400`} />
        ) : (
          <Eye className={`${iconSize} text-slate-300`} />
        )}
      </Button>
    </div>
  );

  // Render dropdown component (shared between variants)
  const dropdownComponent = (
    <Select
      value={currentSetId || ''}
      onValueChange={(value) => onSetChange(value || null)}
      disabled={!enabled}
    >
      <SelectTrigger 
        className={`${variant === 'boxed' ? 'w-full' : 'flex-1'} ${selectHeight} ${!enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        data-testid={`${testId}-select-trigger`}
      >
        <SelectValue 
          placeholder={enabled ? "Select generation set..." : "Enable generation sets to select"} 
        />
      </SelectTrigger>
      <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
        {filteredGenerationSets.length === 0 ? (
          <SelectItem value="no-sets" disabled className="text-slate-400">
            {showOnlyEnabled ? "No enabled sets" : "No sets available"}
          </SelectItem>
        ) : (
          filteredGenerationSets.map((set) => (
            <SelectItem 
              key={set.id} 
              value={set.id}
              className={`${set.enabled ? 'text-white' : 'text-slate-500 opacity-60'} data-[highlighted]:bg-slate-600 data-[highlighted]:text-white`}
              data-testid={`${testId}-option-${set.id}`}
            >
              {variant === 'inline' ? (
                <div className="flex items-center justify-between w-full">
                  <span className={!set.enabled ? 'opacity-75' : ''}>{set.name}</span>
                  <div className="flex items-center gap-1 text-xs text-slate-400">
                    <span>{set.enabledShapeTypes.length} types</span>
                    {!set.enabled && <span className="text-orange-400">●</span>}
                  </div>
                </div>
              ) : (
                <span className={!set.enabled ? 'opacity-75' : ''}>{set.name}</span>
              )}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );

  // Boxed variant (sidebar style)
  if (variant === 'boxed') {
    return (
      <>
        <div className={`mb-4 p-3 border border-slate-600 rounded-lg bg-slate-800/30 space-y-2 ${className}`} data-testid={testId}>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-slate-400">Shape Sets</Label>
            {buttonsComponent}
          </div>
          {enabled ? dropdownComponent : (
            <div className="flex items-center gap-2 p-2 bg-slate-900/50 border border-slate-600 rounded text-xs text-slate-400">
              <Info className="w-3 h-3 text-blue-400 flex-shrink-0" />
              <span>Enable Shape Sets in the Export & Save section to use this feature</span>
            </div>
          )}
        </div>

      </>
    );
  }

  // Inline variant (dialog style)
  return (
    <>
      <div className={`flex items-center gap-2 ${className}`} data-testid={testId}>
        {showLabel && (
          <span className="text-xs text-slate-400 whitespace-nowrap">Set:</span>
        )}
        
        {dropdownComponent}
        {buttonsComponent}
      </div>

    </>
  );
}