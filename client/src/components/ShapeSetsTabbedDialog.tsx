import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { X, Layers2, Settings, Layers, CheckCircle, Save } from 'lucide-react';
import { GenerationSet, BatchConfigSettings, ShapeCountMode } from '@shared/schema';
import { ScatterSettings, ShapeType } from '@/lib/shapeTypes';
import type { CurrentUIState } from '@/hooks/useGenerationSets';
import BatchConfigDialog from './BatchConfigDialog';
import { SetsManagerDialog } from './SetsManagerDialog';

export type ShapeSetsTabbedDialogTab = 'shape-sets-settings' | 'gen-config' | 'sets-manager';

interface ShapeSetsTabbedDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: ShapeSetsTabbedDialogTab;
  onActiveTabChange: (tab: ShapeSetsTabbedDialogTab) => void;

  shapeTypesSectionContent?: React.ReactNode;

  generationSets: GenerationSet[];
  currentGenerationSetId?: string | null;
  onGenerationSetsChange?: (sets: GenerationSet[]) => void;
  onCurrentGenerationSetChange?: (setId: string | null) => void;
  updateGenerationSetPartial?: (setId: string, partialUpdate: Partial<GenerationSet>) => Promise<void>;
  globalZIndexEnabled?: boolean;
  bleedEnabled?: boolean;

  batchConfigSettings: BatchConfigSettings;
  onBatchConfigSettingsChange: (settings: BatchConfigSettings) => void;
  onLiveBatchConfigSettingsChange?: (settings: BatchConfigSettings) => void;
  enabledShapeTypes?: Set<ShapeType>;
  scatterSettings?: ScatterSettings;
  shapeCountMode?: ShapeCountMode;
  shapeCountFixed?: number;
  shapeCountRange?: [number, number];
  generationSetsEnabled?: boolean;
  onCreateGenerationSet?: (customName?: string, currentUIState?: CurrentUIState) => string;
  onDeleteGenerationSet?: (setId: string) => void;
  generateUniqueSetName?: (baseName?: string) => string;
  onClearAll?: () => void;

  onCurrentSetUpdate?: (setId: string) => void;
  onApplyCurrentUIStateToSet?: (setId: string, uiState: CurrentUIState) => Promise<void>;
  onCreateSetFromState?: (uiState: CurrentUIState, name?: string) => string;
  batchExportCount?: number;
  edgeCaseStrategy?: 'hold' | 'cycle' | 'random' | 'stop';
  onEdgeCaseStrategyChange?: (strategy: 'hold' | 'cycle' | 'random' | 'stop') => void;
  globalRepetitionMode?: 'fixed' | 'range';
  globalRepetitionValue?: number;
  globalRepetitionRange?: [number, number];
  onGlobalRepetitionModeChange?: (mode: 'fixed' | 'range') => void;
  onGlobalRepetitionValueChange?: (value: number) => void;
  onGlobalRepetitionRangeChange?: (range: [number, number]) => void;

  onApplyShapeTypes?: () => void | Promise<void>;
  shapeTypesApplyStatus?: 'idle' | 'applying' | 'success';
  setsEnabled?: boolean;
}

export function ShapeSetsTabbedDialog({
  isOpen,
  onOpenChange,
  activeTab,
  onActiveTabChange,
  shapeTypesSectionContent,
  generationSets,
  currentGenerationSetId,
  onGenerationSetsChange,
  onCurrentGenerationSetChange,
  updateGenerationSetPartial,
  globalZIndexEnabled = false,
  bleedEnabled = false,
  batchConfigSettings,
  onBatchConfigSettingsChange,
  onLiveBatchConfigSettingsChange,
  enabledShapeTypes,
  scatterSettings,
  shapeCountMode,
  shapeCountFixed,
  shapeCountRange,
  generationSetsEnabled,
  onCreateGenerationSet,
  onDeleteGenerationSet,
  generateUniqueSetName,
  onClearAll,
  onCurrentSetUpdate,
  onApplyCurrentUIStateToSet,
  onCreateSetFromState,
  batchExportCount,
  edgeCaseStrategy = 'hold',
  onEdgeCaseStrategyChange,
  globalRepetitionMode = 'fixed',
  globalRepetitionValue = 0,
  globalRepetitionRange = [0, 0] as [number, number],
  onGlobalRepetitionModeChange,
  onGlobalRepetitionValueChange,
  onGlobalRepetitionRangeChange,
  onApplyShapeTypes,
  shapeTypesApplyStatus = 'idle',
  setsEnabled = false,
}: ShapeSetsTabbedDialogProps) {
  const [setsManagerScrollTrigger, setSetsManagerScrollTrigger] = useState(0);

  // Ref to BatchConfigDialog's applySettings function — populated via applyRef prop
  const batchConfigApplyRef = useRef<(() => Promise<void>) | null>(null);
  const [isBatchConfigApplying, setIsBatchConfigApplying] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      const prevOverscroll = document.body.style.overscrollBehavior;
      document.body.style.overflow = 'hidden';
      document.body.style.overscrollBehavior = 'none';
      return () => {
        document.body.style.overflow = prev;
        document.body.style.overscrollBehavior = prevOverscroll;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Unified footer Apply handler — delegates to the correct section based on active tab
  const handleUnifiedApply = async () => {
    if (activeTab === 'shape-sets-settings') {
      await onApplyShapeTypes?.();
    } else if (activeTab === 'gen-config') {
      await batchConfigApplyRef.current?.();
    }
  };

  // Derive unified button visual state
  const isApplying =
    activeTab === 'shape-sets-settings'
      ? shapeTypesApplyStatus === 'applying'
      : activeTab === 'gen-config'
      ? isBatchConfigApplying
      : false;

  const isSuccess =
    activeTab === 'shape-sets-settings' ? shapeTypesApplyStatus === 'success' : false;

  const isAutoSaveTab = activeTab === 'sets-manager';

  const dialog = (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        className="w-[95vw] max-w-[1100px] bg-slate-900 border border-slate-700 rounded-lg overflow-hidden h-[95dvh] shadow-2xl flex flex-col overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-900 flex-shrink-0">
          <h3 className="text-base font-semibold text-slate-200">Shape Sets Configuration</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-6 w-6 p-0 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(val) => {
            const tab = val as ShapeSetsTabbedDialogTab;
            onActiveTabChange(tab);
            if (tab === 'sets-manager') {
              setSetsManagerScrollTrigger(t => t + 1);
            }
          }}
          className="flex flex-col flex-1 min-h-0 overflow-hidden"
        >
          <TabsList className="w-full justify-start rounded-none border-b border-slate-700 bg-slate-900 h-auto p-0 flex-shrink-0 overflow-x-auto touch-auto">
            <TabsTrigger
              value="shape-sets-settings"
              className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-none border-t-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:text-blue-400 data-[state=active]:bg-slate-800/50 data-[state=inactive]:text-slate-400 data-[state=inactive]:hover:text-slate-200 data-[state=inactive]:hover:bg-slate-800/30 data-[state=active]:shadow-none bg-transparent whitespace-nowrap"
            >
              <Layers2 className="w-4 h-4 hidden sm:inline-flex" />
              Shape Types
            </TabsTrigger>
            <TabsTrigger
              value="gen-config"
              className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-none border-t-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:text-blue-400 data-[state=active]:bg-slate-800/50 data-[state=inactive]:text-slate-400 data-[state=inactive]:hover:text-slate-200 data-[state=inactive]:hover:bg-slate-800/30 data-[state=active]:shadow-none bg-transparent whitespace-nowrap"
            >
              <Settings className="w-4 h-4 hidden sm:inline-flex" />
              Generation Configuration
            </TabsTrigger>
            <TabsTrigger
              value="sets-manager"
              className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-none border-t-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:text-blue-400 data-[state=active]:bg-slate-800/50 data-[state=inactive]:text-slate-400 data-[state=inactive]:hover:text-slate-200 data-[state=inactive]:hover:bg-slate-800/30 data-[state=active]:shadow-none bg-transparent whitespace-nowrap"
            >
              <Layers className="w-4 h-4 hidden sm:inline-flex" />
              Sets Manager
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Shape Types */}
          <TabsContent value="shape-sets-settings" className="flex-1 overflow-y-auto overscroll-contain touch-auto mt-0 min-h-0">
            {shapeTypesSectionContent ? (
              <div className="px-1 sm:px-3 py-3 space-y-3">
                {shapeTypesSectionContent}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm p-8">
                Shape types UI not available.
              </div>
            )}
          </TabsContent>

          {/* Tab 2: Generation Configuration */}
          <TabsContent value="gen-config" className="flex-1 relative mt-0 min-h-0">
            <div className="absolute inset-0 flex flex-col overflow-hidden">
            <BatchConfigDialog
              settings={batchConfigSettings}
              onSettingsChange={onBatchConfigSettingsChange}
              onLiveSettingsChange={onLiveBatchConfigSettingsChange}
              sidebarCollapsed={false}
              generationSets={generationSets}
              currentGenerationSetId={currentGenerationSetId ?? null}
              enabledShapeTypes={enabledShapeTypes ?? new Set()}
              scatterSettings={scatterSettings}
              shapeCountMode={shapeCountMode}
              shapeCountFixed={shapeCountFixed}
              shapeCountRange={shapeCountRange}
              generationSetsEnabled={generationSetsEnabled}
              onGenerationSetsChange={onGenerationSetsChange}
              onCurrentGenerationSetChange={onCurrentGenerationSetChange}
              onCreateGenerationSet={onCreateGenerationSet}
              onDeleteGenerationSet={onDeleteGenerationSet}
              generateUniqueSetName={generateUniqueSetName}
              onClearAll={onClearAll}
              updateGenerationSetPartial={updateGenerationSetPartial}
              onOpenGenerationSetsManager={() => {
                onActiveTabChange('sets-manager');
                setSetsManagerScrollTrigger(t => t + 1);
              }}
              renderAsInlineContent={true}
              hideInlineFooter={true}
              applyRef={batchConfigApplyRef}
              onIsApplyingChange={setIsBatchConfigApplying}
            />
            </div>
          </TabsContent>

          {/* Tab 3: Sets Manager */}
          <TabsContent value="sets-manager" className="flex-1 relative mt-0 min-h-0">
            <div className="absolute inset-0 flex flex-col overflow-hidden">
            {enabledShapeTypes instanceof Set &&
             scatterSettings !== undefined &&
             batchConfigSettings !== undefined &&
             shapeCountMode !== undefined &&
             shapeCountFixed !== undefined &&
             Array.isArray(shapeCountRange) &&
             onCreateSetFromState ? (
              <SetsManagerDialog
                isOpen={true}
                onOpenChange={() => {}}
                renderAsInlineContent={true}
                generationSets={generationSets}
                onGenerationSetsChange={onGenerationSetsChange ?? (() => {})}
                globalZIndexEnabled={globalZIndexEnabled}
                showInlineValidation={true}
                currentSetId={currentGenerationSetId}
                onCurrentSetChange={onCurrentGenerationSetChange}
                onCurrentSetUpdate={onCurrentSetUpdate}
                onApplyCurrentUIStateToSet={onApplyCurrentUIStateToSet}
                enabledShapeTypes={enabledShapeTypes}
                scatterSettings={scatterSettings}
                batchConfigSettings={batchConfigSettings}
                shapeCountMode={shapeCountMode}
                shapeCountFixed={shapeCountFixed}
                shapeCountRange={shapeCountRange}
                onCreateSetFromState={onCreateSetFromState}
                batchExportCount={batchExportCount}
                globalRepetitionMode={globalRepetitionMode}
                globalRepetitionValue={globalRepetitionValue}
                globalRepetitionRange={globalRepetitionRange}
                onGlobalRepetitionModeChange={onGlobalRepetitionModeChange}
                onGlobalRepetitionValueChange={onGlobalRepetitionValueChange}
                onGlobalRepetitionRangeChange={onGlobalRepetitionRangeChange}
                edgeCaseStrategy={edgeCaseStrategy}
                onEdgeCaseStrategyChange={onEdgeCaseStrategyChange}
                bleedEnabled={bleedEnabled}
                scrollToCurrentSetTrigger={setsManagerScrollTrigger}
              />
            ) : (
              <SetsManagerDialog
                isOpen={true}
                onOpenChange={() => {}}
                renderAsInlineContent={true}
                generationSets={generationSets}
                onGenerationSetsChange={onGenerationSetsChange ?? (() => {})}
                globalZIndexEnabled={globalZIndexEnabled}
                showInlineValidation={true}
                currentSetId={currentGenerationSetId}
                onCurrentSetChange={onCurrentGenerationSetChange}
                onCurrentSetUpdate={onCurrentSetUpdate}
                onApplyCurrentUIStateToSet={onApplyCurrentUIStateToSet}
                batchExportCount={batchExportCount}
                globalRepetitionMode={globalRepetitionMode}
                globalRepetitionValue={globalRepetitionValue}
                globalRepetitionRange={globalRepetitionRange}
                onGlobalRepetitionModeChange={onGlobalRepetitionModeChange}
                onGlobalRepetitionValueChange={onGlobalRepetitionValueChange}
                onGlobalRepetitionRangeChange={onGlobalRepetitionRangeChange}
                edgeCaseStrategy={edgeCaseStrategy}
                onEdgeCaseStrategyChange={onEdgeCaseStrategyChange}
                bleedEnabled={bleedEnabled}
                scrollToCurrentSetTrigger={setsManagerScrollTrigger}
              />
            )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Unified sticky footer — always visible, tab-aware */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-700 bg-slate-900 flex-shrink-0">
          {isAutoSaveTab ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Save className="w-3.5 h-3.5" />
              <span>Changes saved automatically</span>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={isApplying || isSuccess ? undefined : handleUnifiedApply}
              disabled={!setsEnabled || isApplying || isSuccess}
              className={`${
                !setsEnabled
                  ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
                  : isApplying
                  ? 'bg-blue-600 text-white cursor-not-allowed'
                  : isSuccess
                  ? 'bg-green-600 text-white cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              } transition-colors duration-200`}
            >
              <div className="flex items-center gap-2">
                {isApplying ? (
                  <>
                    <div className="w-3 h-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>Applying…</span>
                  </>
                ) : isSuccess ? (
                  <>
                    <CheckCircle className="w-3 h-3" />
                    <span>Applied!</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-3 h-3" />
                    <span>Apply to Current Set</span>
                  </>
                )}
              </div>
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
