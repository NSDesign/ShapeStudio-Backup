import { Label } from "@/components/ui/label";
import { BufferedSlider, BufferedRangeSlider } from "@/components/ui/buffered-slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumericInput } from "@/components/ui/numeric-input";
import { useState, useEffect, useCallback } from "react";
import { Plus, X } from "lucide-react";

// ─── Shared types ────────────────────────────────────────────────────────────

export type RangeSubMode = 'point-index' | 'shape-index' | 'set-rep-index' | 'random';

export type SeriesItem =
  | { mode: 'fixed'; value: number }
  | { mode: 'range'; valueRange: [number, number] };

export interface SeriesConfig {
  items: SeriesItem[];
  stagingMode: 'fixed' | 'range';
  selection: 'sequential' | 'random';
  exhaustion: 'cycle' | 'bounce';
  driver: 'shape-index' | 'set-rep-index';
}

export type ModeKind = 'fixed' | 'range' | 'incremental' | 'series' | 'predefined';

export type ModeConfig =
  | { kind: 'fixed'; value: number }
  | { kind: 'range'; min: number; max: number; subMode?: RangeSubMode }
  | { kind: 'incremental'; startValue: number; increment: number }
  | ({ kind: 'series' } & SeriesConfig)
  | { kind: 'predefined'; value: string };

// Legacy v2 alias (kept for backward compat)
export type ModeConfig_v2 =
  | { kind: 'fixed'; value: number }
  | { kind: 'range'; min: number; max: number; subMode: RangeSubMode }
  | { kind: 'incremental'; startValue: number; increment: number };

export type ModeKind_v2 = 'fixed' | 'range' | 'incremental';

// ─── Internal sub-components ────────────────────────────────────────────────

interface RangeControlsProps {
  config: Extract<ModeConfig, { kind: 'range' }>;
  onChange: (config: ModeConfig) => void;
  bounds: { min: number; max: number };
  step: number;
  idBase: string;
}

function RangeControls({ config, onChange, bounds, step, idBase }: RangeControlsProps) {
  const [localMin, setLocalMin] = useState(config.min);
  const [localMax, setLocalMax] = useState(config.max);

  useEffect(() => { setLocalMin(config.min); setLocalMax(config.max); }, [config.min, config.max]);

  const handleSliderChange = useCallback((values: number[]) => {
    setLocalMin(values[0]); setLocalMax(values[1]);
  }, []);

  const handleSliderCommit = useCallback((values: number[]) => {
    onChange({ ...config, kind: 'range', min: values[0], max: values[1] });
  }, [onChange, config]);

  return (
    <div className="space-y-4">
      <BufferedRangeSlider
        value={[localMin, localMax]}
        onValueChange={handleSliderChange}
        onValueCommit={handleSliderCommit}
        min={bounds.min} max={bounds.max} step={step}
        className="w-full"
        data-testid={`slider-${idBase}-range`}
      />
      <div className="flex space-x-2">
        <NumericInput
          value={localMin}
          onChange={(min) => {
            const clampedMin = Math.min(min, localMax);
            setLocalMin(clampedMin);
            onChange({ ...config, kind: 'range', min: clampedMin, max: localMax });
          }}
          min={bounds.min} max={localMax} step={step}
          className="flex-1 h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
          data-testid={`input-${idBase}-min`}
        />
        <NumericInput
          value={localMax}
          onChange={(max) => {
            const clampedMax = Math.max(max, localMin);
            setLocalMax(clampedMax);
            onChange({ ...config, kind: 'range', min: localMin, max: clampedMax });
          }}
          min={localMin} max={bounds.max} step={step}
          className="flex-1 h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
          data-testid={`input-${idBase}-max`}
        />
      </div>
    </div>
  );
}

interface IncrementalControlsProps {
  config: Extract<ModeConfig, { kind: 'incremental' }>;
  onChange: (config: ModeConfig) => void;
  bounds: { min: number; max: number };
  step: number;
  idBase: string;
}

function IncrementalControls({ config, onChange, bounds, step, idBase }: IncrementalControlsProps) {
  const [localStart, setLocalStart] = useState(config.startValue);
  const [localIncrement, setLocalIncrement] = useState(config.increment);

  useEffect(() => { setLocalStart(config.startValue); }, [config.startValue]);
  useEffect(() => { setLocalIncrement(config.increment); }, [config.increment]);

  const incrementBound = Math.max(step, bounds.max - bounds.min);

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <Label className="text-slate-300 text-xs">Start Value</Label>
        <BufferedSlider
          value={[localStart]}
          onValueChange={([v]) => setLocalStart(v)}
          onValueCommit={([v]) => onChange({ ...config, startValue: v })}
          min={bounds.min} max={bounds.max} step={step}
          className="w-full"
          data-testid={`slider-${idBase}-start-value`}
        />
        <NumericInput
          value={localStart}
          onChange={(v) => {
            const clamped = Math.max(bounds.min, Math.min(bounds.max, v));
            setLocalStart(clamped);
            onChange({ ...config, startValue: clamped });
          }}
          min={bounds.min} max={bounds.max} step={step}
          className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
          data-testid={`input-${idBase}-start-value`}
        />
      </div>
      <div className="space-y-4">
        <Label className="text-slate-300 text-xs">Increment</Label>
        <BufferedSlider
          value={[localIncrement]}
          onValueChange={([v]) => setLocalIncrement(v)}
          onValueCommit={([v]) => onChange({ ...config, increment: v })}
          min={-incrementBound} max={incrementBound} step={step}
          className="w-full"
          data-testid={`slider-${idBase}-increment`}
        />
        <NumericInput
          value={localIncrement}
          onChange={(v) => { setLocalIncrement(v); onChange({ ...config, increment: v }); }}
          min={-1000} max={1000} step={step}
          className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
          data-testid={`input-${idBase}-increment`}
        />
      </div>
    </div>
  );
}

interface FixedControlsProps {
  config: Extract<ModeConfig, { kind: 'fixed' }>;
  onChange: (config: ModeConfig) => void;
  bounds: { min: number; max: number };
  step: number;
  idBase: string;
}

function FixedControls({ config, onChange, bounds, step, idBase }: FixedControlsProps) {
  const [localValue, setLocalValue] = useState(config.value);

  useEffect(() => { setLocalValue(config.value); }, [config.value]);

  const handleSliderChange = useCallback((values: number[]) => { setLocalValue(values[0]); }, []);
  const handleSliderCommit = useCallback((values: number[]) => { onChange({ kind: 'fixed', value: values[0] }); }, [onChange]);

  return (
    <div className="space-y-4">
      <BufferedSlider
        value={[localValue]}
        onValueChange={handleSliderChange}
        onValueCommit={handleSliderCommit}
        min={bounds.min} max={bounds.max} step={step}
        className="w-full"
      />
      <NumericInput
        value={localValue}
        onChange={(value) => {
          const clamped = Math.max(bounds.min, Math.min(bounds.max, value));
          setLocalValue(clamped);
          onChange({ kind: 'fixed', value: clamped });
        }}
        min={bounds.min} max={bounds.max} step={step}
        className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
        data-testid={`input-${idBase}-fixed`}
      />
    </div>
  );
}

// ─── SeriesPanel — exported for direct use in BatchConfigDialog ───────────────

export interface SeriesPanelProps {
  config: SeriesConfig;
  onChange: (config: SeriesConfig) => void;
  /** Optional label shown above the panel (used when two panels sit side-by-side) */
  label?: string;
  /** Step size for numeric inputs (default: 1) */
  step?: number;
  /** Minimum allowed value for numeric inputs */
  min?: number;
  /** Maximum allowed value for numeric inputs */
  max?: number;
  /**
   * Default value seeded into new **fixed** items when the user clicks Add.
   * Should be the current fixed setting value so new items feel contextual.
   */
  fixedDefault?: number;
  /**
   * Default range seeded into new **range** items when the user clicks Add.
   * Should be the current range setting (or a sensible literal fallback).
   */
  rangeDefault?: [number, number];
}

export function SeriesPanel({
  config, onChange, label,
  step = 1, min, max,
  fixedDefault = 0,
  rangeDefault = [0, 100],
}: SeriesPanelProps) {
  const { items, stagingMode, selection, exhaustion, driver } = config;

  const addItem = () => {
    const newItem: SeriesItem = stagingMode === 'range'
      ? { mode: 'range', valueRange: rangeDefault }
      : { mode: 'fixed', value: fixedDefault };
    onChange({ ...config, items: [...items, newItem] });
  };

  const removeItem = (idx: number) => {
    if (items.length <= 1) return;
    onChange({ ...config, items: items.filter((_, i) => i !== idx) });
  };

  const updateItem = (idx: number, item: SeriesItem) => {
    const next = [...items];
    next[idx] = item;
    onChange({ ...config, items: next });
  };

  return (
    <div className="space-y-2">
      {label && <Label className="text-xs text-slate-400">{label}</Label>}
      <div className="space-y-2 p-2 bg-slate-800/50 rounded">
        {/* Staging + Add */}
        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-400 shrink-0">Staging</Label>
          <Select
            value={stagingMode}
            onValueChange={(v) => onChange({ ...config, stagingMode: v as 'fixed' | 'range' })}
          >
            <SelectTrigger className="h-9 flex-1 text-xs bg-slate-800 border-slate-600 text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10003 }}>
              <SelectItem value="fixed" className="text-slate-200 hover:bg-slate-700">Constant</SelectItem>
              <SelectItem value="range" className="text-slate-200 hover:bg-slate-700">Range</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={addItem}
            className="h-9 w-9 flex items-center justify-center bg-blue-600 hover:bg-blue-500 rounded text-white shrink-0"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Item list */}
        <div className="max-h-40 overflow-y-auto space-y-1">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-1">
              {item.mode === 'fixed' ? (
                <NumericInput
                  value={item.value}
                  onChange={(v) => updateItem(idx, { mode: 'fixed', value: v })}
                  min={min} max={max} step={step}
                  className="h-9 flex-1 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                />
              ) : (
                <>
                  <NumericInput
                    value={item.valueRange[0]}
                    onChange={(v) => updateItem(idx, { mode: 'range', valueRange: [v, item.valueRange[1]] })}
                    min={min} max={max} step={step}
                    className="h-9 flex-1 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                  />
                  <span className="text-slate-500 text-xs px-1">–</span>
                  <NumericInput
                    value={item.valueRange[1]}
                    onChange={(v) => updateItem(idx, { mode: 'range', valueRange: [item.valueRange[0], v] })}
                    min={min} max={max} step={step}
                    className="h-9 flex-1 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                  />
                </>
              )}
              <button
                onClick={() => removeItem(idx)}
                className="h-9 w-9 flex items-center justify-center bg-slate-600 hover:bg-red-700 rounded text-slate-300 shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Selection */}
        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-400 w-20 shrink-0">Selection</Label>
          <Select
            value={selection}
            onValueChange={(v) => onChange({ ...config, selection: v as 'sequential' | 'random' })}
          >
            <SelectTrigger className="h-9 flex-1 text-xs bg-slate-800 border-slate-600 text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10003 }}>
              <SelectItem value="sequential" className="text-slate-200 hover:bg-slate-700">Sequential</SelectItem>
              <SelectItem value="random" className="text-slate-200 hover:bg-slate-700">Random</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Exhaustion — only when sequential */}
        {selection === 'sequential' && (
          <div className="flex items-center gap-2">
            <Label className="text-xs text-slate-400 w-20 shrink-0">Exhaustion</Label>
            <Select
              value={exhaustion}
              onValueChange={(v) => onChange({ ...config, exhaustion: v as 'cycle' | 'bounce' })}
            >
              <SelectTrigger className="h-9 flex-1 text-xs bg-slate-800 border-slate-600 text-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10003 }}>
                <SelectItem value="cycle" className="text-slate-200 hover:bg-slate-700">Cycle</SelectItem>
                <SelectItem value="bounce" className="text-slate-200 hover:bg-slate-700">Bounce</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Driver */}
        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-400 w-20 shrink-0">Driver</Label>
          <Select
            value={driver}
            onValueChange={(v) => onChange({ ...config, driver: v as 'shape-index' | 'set-rep-index' })}
          >
            <SelectTrigger className="h-9 flex-1 text-xs bg-slate-800 border-slate-600 text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10003 }}>
              <SelectItem value="shape-index" className="text-slate-200 hover:bg-slate-700">Shape index</SelectItem>
              <SelectItem value="set-rep-index" className="text-slate-200 hover:bg-slate-700">Set-rep index</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

// ─── Unified StyledModeField ──────────────────────────────────────────────────

const RANGE_SUB_MODE_LABELS: Record<RangeSubMode, string> = {
  'point-index': 'Point index',
  'shape-index': 'Shape index',
  'set-rep-index': 'Set-rep index',
  'random': 'Random',
};

export interface StyledModeFieldProps {
  label: string;
  config: ModeConfig;
  onChange: (config: ModeConfig) => void;
  bounds: { min: number; max: number };
  unit?: string;
  step?: number;
  /**
   * Ordered list of modes to offer. 'series' is always appended last even if
   * omitted. Omit a kind to hide it from the selector.
   */
  allowedModes?: ModeKind[];
  /**
   * Which Drive-by sub-modes to show under Range. Pass an empty array (or
   * omit) to hide the Drive-by row entirely (legacy v1 behaviour).
   */
  rangeSubModes?: RangeSubMode[];
  /**
   * Options for the Predefined mode. Required when allowedModes includes 'predefined'.
   */
  predefinedOptions?: { value: string; label: string }[];
}

const DEFAULT_SERIES_CONFIG: SeriesConfig = {
  items: [{ mode: 'fixed', value: 0 }],
  stagingMode: 'fixed',
  selection: 'sequential',
  exhaustion: 'cycle',
  driver: 'shape-index',
};

export function StyledModeField({
  label,
  config,
  onChange,
  bounds,
  unit = "",
  step = 1,
  allowedModes = ['fixed', 'range', 'incremental'],
  rangeSubModes,
  predefinedOptions,
}: StyledModeFieldProps) {
  const idBase = label.toLowerCase().replace(/[^a-z0-9_-]/g, "-");

  // Build the final ordered mode list: supplied modes (deduplicated) then 'series' last
  const orderedModes: ModeKind[] = [
    ...allowedModes.filter((m) => m !== 'series'),
    'series',
  ];

  const handleModeChange = (mode: ModeKind) => {
    switch (mode) {
      case 'fixed':
        onChange({ kind: 'fixed', value: bounds.min });
        break;
      case 'range':
        onChange({ kind: 'range', min: bounds.min, max: bounds.max, subMode: rangeSubModes?.[0] ?? 'random' });
        break;
      case 'incremental':
        onChange({ kind: 'incremental', startValue: bounds.min, increment: step });
        break;
      case 'series':
        onChange({ kind: 'series', ...DEFAULT_SERIES_CONFIG });
        break;
      case 'predefined':
        onChange({ kind: 'predefined', value: predefinedOptions?.[0]?.value ?? '' });
        break;
    }
  };

  const handleSubModeChange = (subMode: RangeSubMode) => {
    if (config.kind === 'range') onChange({ ...config, subMode });
  };

  const modeLabel = () => {
    switch (config.kind) {
      case 'fixed': return 'Constant';
      case 'range': return 'Range';
      case 'incremental': return 'Incremental';
      case 'series': return 'Series';
      case 'predefined': return 'Predefined';
      default: return (config as any).kind ?? 'Unknown';
    }
  };

  const showSubMode = config.kind === 'range' && rangeSubModes && rangeSubModes.length > 0;

  return (
    <div className="space-y-6" data-testid={`styled-mode-field-${idBase}`}>
      {/* Label row */}
      <div className="flex items-baseline justify-between">
        <Label className="text-slate-300 text-xs font-medium">{label}</Label>
        <span className="text-slate-400 text-xs">{unit}</span>
      </div>

      {/* Mode selector */}
      <div className="flex items-center space-x-2">
        <Label className="text-slate-300 text-xs">Mode:</Label>
        <Select value={config.kind} onValueChange={handleModeChange}>
          <SelectTrigger className="w-28 h-8 bg-slate-700 border-slate-600 text-white" data-testid={`select-${idBase}-mode`}>
            <SelectValue>{modeLabel()}</SelectValue>
          </SelectTrigger>
          <SelectContent className="bg-slate-700 border-slate-600 text-white" style={{ zIndex: 10002 }}>
            {orderedModes.includes('fixed') && <SelectItem value="fixed">Constant</SelectItem>}
            {orderedModes.includes('range') && <SelectItem value="range">Range</SelectItem>}
            {orderedModes.includes('incremental') && <SelectItem value="incremental">Incremental</SelectItem>}
            {orderedModes.includes('predefined') && allowedModes.includes('predefined') && <SelectItem value="predefined">Predefined</SelectItem>}
            <SelectItem value="series">Series</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Range Drive-by row (v2 behaviour, only when rangeSubModes provided) */}
      {showSubMode && (
        <div className="flex items-center space-x-2">
          <Label className="text-slate-300 text-xs">Drive by:</Label>
          <Select value={(config as any).subMode ?? 'random'} onValueChange={handleSubModeChange}>
            <SelectTrigger className="flex-1 h-8 bg-slate-700 border-slate-600 text-white" data-testid={`select-${idBase}-submode`}>
              <SelectValue>{RANGE_SUB_MODE_LABELS[((config as any).subMode ?? 'random') as RangeSubMode]}</SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-slate-700 border-slate-600 text-white" style={{ zIndex: 10002 }}>
              {rangeSubModes!.includes('point-index') && <SelectItem value="point-index">Point index</SelectItem>}
              {rangeSubModes!.includes('shape-index') && <SelectItem value="shape-index">Shape index</SelectItem>}
              {rangeSubModes!.includes('set-rep-index') && <SelectItem value="set-rep-index">Set-rep index</SelectItem>}
              {rangeSubModes!.includes('random') && <SelectItem value="random">Random</SelectItem>}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Mode-specific controls */}
      {config.kind === 'fixed' && (
        <FixedControls config={config} onChange={onChange} bounds={bounds} step={step} idBase={idBase} />
      )}
      {config.kind === 'range' && (
        <RangeControls
          config={{ kind: 'range', min: config.min, max: config.max, subMode: config.subMode }}
          onChange={(c) => {
            if (c.kind === 'range') onChange({ kind: 'range', min: c.min, max: c.max, subMode: config.subMode });
          }}
          bounds={bounds} step={step} idBase={idBase}
        />
      )}
      {config.kind === 'incremental' && (
        <IncrementalControls config={config} onChange={onChange} bounds={bounds} step={step} idBase={idBase} />
      )}
      {config.kind === 'predefined' && predefinedOptions && (
        <Select
          value={config.value}
          onValueChange={(v) => onChange({ kind: 'predefined', value: v })}
        >
          <SelectTrigger className="w-full h-8 bg-slate-700 border-slate-600 text-white" data-testid={`select-${idBase}-predefined`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-700 border-slate-600 text-white" style={{ zIndex: 10002 }}>
            {predefinedOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {config.kind === 'series' && (
        <SeriesPanel
          config={config}
          onChange={(sc) => onChange({ kind: 'series', ...sc })}
          step={step}
        />
      )}
    </div>
  );
}

// ─── Backward-compat re-exports ───────────────────────────────────────────────

/** @deprecated Use StyledModeField with rangeSubModes prop instead */
export interface StyledModeField_v2Props {
  label: string;
  config: ModeConfig_v2;
  onChange: (config: ModeConfig_v2) => void;
  bounds: { min: number; max: number };
  unit?: string;
  step?: number;
  allowedModes?: ModeKind_v2[];
}

/** @deprecated Use StyledModeField with rangeSubModes prop instead */
export function StyledModeField_v2({
  label,
  config,
  onChange,
  bounds,
  unit,
  step,
  allowedModes = ['fixed', 'range', 'incremental'],
}: StyledModeField_v2Props) {
  return (
    <StyledModeField
      label={label}
      config={config as ModeConfig}
      onChange={(c) => {
        if (c.kind === 'fixed' || c.kind === 'range' || c.kind === 'incremental') {
          onChange(c as ModeConfig_v2);
        }
      }}
      bounds={bounds}
      unit={unit}
      step={step}
      allowedModes={allowedModes as ModeKind[]}
      rangeSubModes={['point-index', 'shape-index', 'set-rep-index', 'random']}
    />
  );
}
