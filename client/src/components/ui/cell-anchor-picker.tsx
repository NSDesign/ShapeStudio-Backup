import React from 'react';
import { X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CellAnchor, CellAnchorMode } from '@shared/schema';

// ─── Anchor grid metadata ─────────────────────────────────────────────────────

const ANCHOR_GRID: CellAnchor[][] = [
  ['nw', 'n',  'ne'],
  ['w',  'center', 'e'],
  ['sw', 's',  'se'],
];

const ANCHOR_LABEL: Record<CellAnchor, string> = {
  nw: 'NW', n: 'N',  ne: 'NE',
  w:  'W',  center: '·', e:  'E',
  sw: 'SW', s: 'S',  se: 'SE',
};

const ANCHOR_ARIA: Record<CellAnchor, string> = {
  nw: 'Top Left',    n: 'Top Center',    ne: 'Top Right',
  w:  'Mid Left',    center: 'Center',   e:  'Mid Right',
  sw: 'Bot Left',    s:  'Bot Center',   se: 'Bot Right',
};

// ─── Single-cell button ───────────────────────────────────────────────────────

interface AnchorButtonProps {
  anchor: CellAnchor;
  selected: boolean;
  dimmed?: boolean;
  count?: number;
  onClick: (a: CellAnchor) => void;
}

function AnchorButton({ anchor, selected, dimmed, count, onClick }: AnchorButtonProps) {
  return (
    <button
      type="button"
      aria-label={ANCHOR_ARIA[anchor]}
      aria-pressed={selected}
      onClick={() => onClick(anchor)}
      className={[
        'relative w-8 h-8 rounded text-[10px] font-semibold transition-colors select-none',
        'border flex items-center justify-center',
        dimmed
          ? 'bg-slate-800 border-slate-700 text-slate-600 hover:bg-slate-700 hover:text-slate-400 hover:border-slate-600'
          : selected
            ? 'bg-slate-500 border-slate-400 text-slate-100'
            : 'bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600 hover:text-slate-200',
      ].join(' ')}
    >
      {ANCHOR_LABEL[anchor]}
      {count !== undefined && count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] rounded-full bg-slate-500 text-[9px] font-bold text-white flex items-center justify-center px-0.5 leading-none">
          {count}
        </span>
      )}
    </button>
  );
}

// ─── 3×3 grid ─────────────────────────────────────────────────────────────────

interface AnchorGrid3x3Props {
  mode: CellAnchorMode;
  fixedValue: CellAnchor;
  optionValues: CellAnchor[];
  sequenceValues: CellAnchor[];
  customUVActive?: boolean;
  onFixedChange: (a: CellAnchor) => void;
  onOptionsChange: (opts: CellAnchor[]) => void;
  onSequenceChange: (seq: CellAnchor[]) => void;
}

function AnchorGrid3x3({
  mode,
  fixedValue,
  optionValues,
  sequenceValues,
  customUVActive = false,
  onFixedChange,
  onOptionsChange,
  onSequenceChange,
}: AnchorGrid3x3Props) {
  function handleClick(anchor: CellAnchor) {
    if (mode === 'fixed') {
      onFixedChange(anchor);
    } else if (mode === 'range' || mode === 'incremental') {
      const next = optionValues.includes(anchor)
        ? optionValues.filter(a => a !== anchor)
        : [...optionValues, anchor];
      onOptionsChange(next);
    } else {
      onSequenceChange([...sequenceValues, anchor]);
    }
  }

  function isSelected(anchor: CellAnchor): boolean {
    if (mode === 'fixed') return fixedValue === anchor;
    if (mode === 'range' || mode === 'incremental') return optionValues.includes(anchor);
    return sequenceValues.includes(anchor);
  }

  function countInSequence(anchor: CellAnchor): number {
    return sequenceValues.filter(a => a === anchor).length;
  }

  return (
    <div className="inline-grid grid-cols-3 gap-1">
      {ANCHOR_GRID.flat().map(anchor => (
        <AnchorButton
          key={anchor}
          anchor={anchor}
          selected={!customUVActive && isSelected(anchor)}
          dimmed={customUVActive}
          count={mode === 'sequence' ? countInSequence(anchor) : undefined}
          onClick={handleClick}
        />
      ))}
    </div>
  );
}

// ─── Sequence chip list ───────────────────────────────────────────────────────

interface SequenceChipsProps {
  sequence: CellAnchor[];
  onChange: (seq: CellAnchor[]) => void;
}

function SequenceChips({ sequence, onChange }: SequenceChipsProps) {
  if (sequence.length === 0) {
    return (
      <p className="text-xs text-slate-500 italic">
        Click positions above to build sequence
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {sequence.map((anchor, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-700 border border-slate-600 text-xs text-slate-300"
        >
          <span className="font-mono">{ANCHOR_ARIA[anchor]}</span>
          <button
            type="button"
            aria-label="Remove"
            onClick={() => onChange(sequence.filter((_, j) => j !== i))}
            className="text-slate-400 hover:text-slate-100 ml-0.5"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => onChange([])}
        className="text-xs text-slate-500 hover:text-slate-300 px-1"
        title="Clear all"
      >
        Clear
      </button>
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export interface CellAnchorPickerProps {
  label: string;
  mode: CellAnchorMode;
  onModeChange: (m: CellAnchorMode) => void;
  fixedValue: CellAnchor;
  onFixedChange: (a: CellAnchor) => void;
  optionValues: CellAnchor[];
  onOptionsChange: (opts: CellAnchor[]) => void;
  sequenceValues: CellAnchor[];
  onSequenceChange: (seq: CellAnchor[]) => void;
  showCustomUV?: boolean;
  customUVEnabled?: boolean;
  customUVX?: number;
  customUVY?: number;
  onCustomUVChange?: (enabled: boolean, uvX: number, uvY: number) => void;
}

export const CellAnchorPicker = React.memo(function CellAnchorPicker({
  label,
  mode,
  onModeChange,
  fixedValue,
  onFixedChange,
  optionValues,
  onOptionsChange,
  sequenceValues,
  onSequenceChange,
  showCustomUV = false,
  customUVEnabled = false,
  customUVX = 0.5,
  customUVY = 0.5,
  onCustomUVChange,
}: CellAnchorPickerProps) {
  const customUVActive = showCustomUV && customUVEnabled && mode === 'fixed';

  // Clicking a grid preset while custom UV is active deactivates custom UV
  // and applies the preset anchor.
  function handleFixedChange(anchor: CellAnchor) {
    if (customUVActive) {
      onCustomUVChange?.(false, customUVX, customUVY);
    }
    onFixedChange(anchor);
  }

  return (
    <div className="space-y-2">
      {/* Header row: label + mode select */}
      <div className="flex items-center justify-between">
        <Label className="text-xs text-slate-400">{label}</Label>
        <Select value={mode} onValueChange={(v) => onModeChange(v as CellAnchorMode)}>
          <SelectTrigger className="h-6 w-28 text-xs bg-slate-800 border-slate-600 text-slate-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
            <SelectItem value="fixed"       className="text-slate-200 hover:bg-slate-700">Constant</SelectItem>
            <SelectItem value="range"       className="text-slate-200 hover:bg-slate-700">Range</SelectItem>
            <SelectItem value="incremental" className="text-slate-200 hover:bg-slate-700">Incremental</SelectItem>
            <SelectItem value="sequence"    className="text-slate-200 hover:bg-slate-700">Sequence</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 3×3 grid — always shown; dimmed when custom UV is active */}
      <AnchorGrid3x3
        mode={mode}
        fixedValue={fixedValue}
        optionValues={optionValues}
        sequenceValues={sequenceValues}
        customUVActive={customUVActive}
        onFixedChange={handleFixedChange}
        onOptionsChange={onOptionsChange}
        onSequenceChange={onSequenceChange}
      />

      {/* Sequence chip list */}
      {mode === 'sequence' && (
        <SequenceChips sequence={sequenceValues} onChange={onSequenceChange} />
      )}

      {/* Custom UV toggle — shape anchor, Fixed mode only */}
      {showCustomUV && mode === 'fixed' && (
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Switch
              checked={customUVEnabled}
              onCheckedChange={(checked) => onCustomUVChange?.(checked, customUVX, customUVY)}
              className="data-[state=checked]:bg-cyan-600 data-[state=unchecked]:bg-cyan-900 scale-90"
            />
            <Label className="text-xs text-slate-400">Custom UV</Label>
          </div>
          {customUVEnabled && (
            <div className="space-y-2 ml-6">
              <div className="flex items-center gap-2">
                <Label className="text-[10px] text-slate-500 w-4">X</Label>
                <Slider
                  value={[customUVX]}
                  onValueChange={([v]) => onCustomUVChange?.(true, v, customUVY)}
                  min={0} max={1} step={0.01}
                  className="flex-1"
                />
                <span className="text-[10px] text-slate-400 w-8 text-right">
                  {customUVX.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-[10px] text-slate-500 w-4">Y</Label>
                <Slider
                  value={[customUVY]}
                  onValueChange={([v]) => onCustomUVChange?.(true, customUVX, v)}
                  min={0} max={1} step={0.01}
                  className="flex-1"
                />
                <span className="text-[10px] text-slate-400 w-8 text-right">
                  {customUVY.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
