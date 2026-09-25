import * as React from "react"
import { useState, useCallback, useEffect, useRef } from "react"
import { Slider } from "./slider"
import { NumericInput, BufferedNumericInput } from "./numeric-input"
import { cn } from "@/lib/utils"

function roundToStep(v: number, step: number): number {
  if (step <= 0) return v;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return parseFloat(v.toFixed(decimals));
}

interface BufferedSliderProps {
  value: number[];
  onValueChange?: (value: number[]) => void;
  onValueCommit?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}

export function BufferedSlider({
  value,
  onValueChange,
  onValueCommit,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  className,
}: BufferedSliderProps) {
  const [localValue, setLocalValue] = useState<number[]>(value);
  const isDraggingRef = useRef(false);
  
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleValueChange = useCallback((newValue: number[]) => {
    isDraggingRef.current = true;
    setLocalValue(newValue);
    onValueChange?.(newValue);
  }, [onValueChange]);

  const handleValueCommit = useCallback((newValue: number[]) => {
    isDraggingRef.current = false;
    onValueCommit?.(newValue.map(v => roundToStep(v, step)));
  }, [onValueCommit, step]);

  return (
    <Slider
      value={localValue}
      onValueChange={handleValueChange}
      onValueCommit={handleValueCommit}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={className}
    />
  );
}

// Buffered slider with integrated label display
interface BufferedSliderWithLabelProps {
  value: number;
  onValueCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  label?: string;
  formatLabel?: (value: number) => string;
  labelClassName?: string;
  valueClassName?: string;
}

export function BufferedSliderWithLabel({
  value,
  onValueCommit,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  className,
  label,
  formatLabel = (v) => String(v),
  labelClassName = "text-xs text-slate-400",
  valueClassName = "text-xs text-slate-300",
}: BufferedSliderWithLabelProps) {
  const [localValue, setLocalValue] = useState<number>(value);
  const isDraggingRef = useRef(false);
  
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleValueChange = useCallback((newValue: number[]) => {
    isDraggingRef.current = true;
    setLocalValue(newValue[0]);
  }, []);

  const handleValueCommit = useCallback((newValue: number[]) => {
    isDraggingRef.current = false;
    onValueCommit(roundToStep(newValue[0], step));
  }, [onValueCommit, step]);

  return (
    <div className="space-y-1">
      {label && (
        <div className="flex justify-between text-xs">
          <span className={labelClassName}>{label}</span>
          <span className={valueClassName}>{formatLabel(localValue)}</span>
        </div>
      )}
      <Slider
        value={[localValue]}
        onValueChange={handleValueChange}
        onValueCommit={handleValueCommit}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={className}
      />
      {!label && <span className={labelClassName}>{formatLabel(localValue)}</span>}
    </div>
  );
}

// Buffered range slider with integrated dual label display
interface BufferedRangeSliderWithLabelProps {
  value: [number, number];
  onValueCommit: (value: [number, number]) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  formatLabel?: (min: number, max: number) => string;
  labelClassName?: string;
}

export function BufferedRangeSliderWithLabel({
  value,
  onValueCommit,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  className,
  formatLabel = (minVal, maxVal) => `${minVal} - ${maxVal}`,
  labelClassName = "text-xs text-slate-500",
}: BufferedRangeSliderWithLabelProps) {
  const [localValue, setLocalValue] = useState<[number, number]>(value);
  const isDraggingRef = useRef(false);
  
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleValueChange = useCallback((newValue: number[]) => {
    isDraggingRef.current = true;
    setLocalValue(newValue as [number, number]);
  }, []);

  const handleValueCommit = useCallback((newValue: number[]) => {
    isDraggingRef.current = false;
    onValueCommit(newValue as [number, number]);
  }, [onValueCommit]);

  return (
    <div className="space-y-1">
      <Slider
        value={localValue}
        onValueChange={handleValueChange}
        onValueCommit={handleValueCommit}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={className}
      />
      <span className={labelClassName}>{formatLabel(localValue[0], localValue[1])}</span>
    </div>
  );
}

interface BufferedRangeSliderProps {
  value: [number, number];
  onValueChange?: (value: [number, number]) => void;
  onValueCommit?: (value: [number, number]) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}

export function BufferedRangeSlider({
  value,
  onValueChange,
  onValueCommit,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  className,
}: BufferedRangeSliderProps) {
  const [localValue, setLocalValue] = useState<[number, number]>(value);
  const isDraggingRef = useRef(false);
  
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleValueChange = useCallback((newValue: number[]) => {
    isDraggingRef.current = true;
    const rangeValue = newValue as [number, number];
    setLocalValue(rangeValue);
    onValueChange?.(rangeValue);
  }, [onValueChange]);

  const handleValueCommit = useCallback((newValue: number[]) => {
    isDraggingRef.current = false;
    onValueCommit?.(newValue as [number, number]);
  }, [onValueCommit]);

  return (
    <Slider
      value={localValue}
      onValueChange={handleValueChange}
      onValueCommit={handleValueCommit}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={className}
    />
  );
}

// Buffered slider with synchronized numeric input.
// Layout "stacked" (default): slider on top, numeric input below.
// Layout "inline": slider and input side-by-side (kept for non-BatchConfig callers).
// inputUnbounded (default true): removes the max ceiling from the numeric input so
// the user can type any value; the slider thumb still clamps to its visual max.
interface BufferedSliderWithNumericInputProps {
  value: number;
  onValueCommit: (value: number) => void;
  min?: number;
  max?: number;
  inputMax?: number;
  inputUnbounded?: boolean;
  step?: number;
  disabled?: boolean;
  sliderClassName?: string;
  inputClassName?: string;
  layout?: 'stacked' | 'inline';
  label?: string;
  labelClassName?: string;
}

export function BufferedSliderWithNumericInput({
  value,
  onValueCommit,
  min = 0,
  max = 100,
  inputMax,
  inputUnbounded = false,
  step = 1,
  disabled = false,
  sliderClassName,
  inputClassName = "h-9 bg-slate-700 border-slate-600 text-slate-300",
  layout = 'stacked',
  label,
  labelClassName = "text-xs text-slate-400",
}: BufferedSliderWithNumericInputProps) {
  const [localValue, setLocalValue] = useState<number>(value);
  const isDraggingRef = useRef(false);
  
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleSliderChange = useCallback((newValue: number[]) => {
    isDraggingRef.current = true;
    setLocalValue(newValue[0]);
  }, []);

  const handleSliderCommit = useCallback((newValue: number[]) => {
    isDraggingRef.current = false;
    onValueCommit(roundToStep(newValue[0], step));
  }, [onValueCommit, step]);

  const handleInputChange = useCallback((newValue: number) => {
    setLocalValue(newValue);
  }, []);

  const handleInputCommit = useCallback((newValue: number) => {
    setLocalValue(newValue);
    onValueCommit(newValue);
  }, [onValueCommit]);

  const effectiveInputMax = inputUnbounded ? Infinity : (inputMax !== undefined ? inputMax : max);

  if (layout === 'inline') {
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {label && <span className={labelClassName}>{label}</span>}
        <BufferedNumericInput
          value={localValue}
          onChange={handleInputChange}
          onCommit={handleInputCommit}
          min={min}
          max={effectiveInputMax}
          step={step}
          disabled={disabled}
          className={inputClassName}
        />
        <Slider
          value={[Math.min(Math.max(localValue, min), max)]}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className={sliderClassName ? `flex-1 min-w-0 ${sliderClassName}` : "flex-1 min-w-0"}
        />
      </div>
    );
  }

  // stacked: slider first, input below
  return (
    <div className="space-y-2">
      {label && <span className={labelClassName}>{label}</span>}
      <Slider
        value={[Math.min(Math.max(localValue, min), max)]}
        onValueChange={handleSliderChange}
        onValueCommit={handleSliderCommit}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={sliderClassName}
      />
      <BufferedNumericInput
        value={localValue}
        onChange={handleInputChange}
        onCommit={handleInputCommit}
        min={min}
        max={effectiveInputMax}
        step={step}
        disabled={disabled}
        className={inputClassName}
      />
    </div>
  );
}

// Buffered range slider with synchronized dual numeric inputs.
// Layout: slider on top (full width), min/max inputs side-by-side below.
// inputUnbounded (default true): removes max ceiling from both inputs so
// the user can type any value beyond the slider's visual range.
interface BufferedRangeSliderWithNumericInputsProps {
  value: [number, number];
  onValueCommit: (value: [number, number]) => void;
  min?: number;
  max?: number;
  inputUnbounded?: boolean;
  step?: number;
  disabled?: boolean;
  sliderClassName?: string;
  inputClassName?: string;
  minLabel?: string;
  maxLabel?: string;
  labelClassName?: string;
}

export function BufferedRangeSliderWithNumericInputs({
  value,
  onValueCommit,
  min = 0,
  max = 100,
  inputUnbounded = false,
  step = 1,
  disabled = false,
  sliderClassName,
  inputClassName = "h-9 bg-slate-700 border-slate-600 text-slate-300",
  minLabel = "",
  maxLabel = "",
  labelClassName = "text-xs text-slate-400 mb-1 block",
}: BufferedRangeSliderWithNumericInputsProps) {
  const [localValue, setLocalValue] = useState<[number, number]>(value);
  const isDraggingRef = useRef(false);
  // Track when a numeric input is focused so we can ignore spurious slider
  // onValueChange events that Radix fires when the controlled value prop changes
  // (e.g. when the user types a large number that forces the display to clamp).
  const isInputFocusedRef = useRef(false);
  
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleSliderChange = useCallback((newValue: number[]) => {
    // While the user is typing in a numeric input, Radix may fire onValueChange
    // because the controlled value prop changed (clamped display vs actual value).
    // Ignore those events so the typed value is never overwritten.
    if (isInputFocusedRef.current) return;
    isDraggingRef.current = true;
    setLocalValue(newValue as [number, number]);
  }, []);

  const handleSliderCommit = useCallback((newValue: number[]) => {
    isDraggingRef.current = false;
    onValueCommit([roundToStep(newValue[0], step), roundToStep(newValue[1], step)]);
  }, [onValueCommit, step]);

  const handleMinInputChange = useCallback((newMin: number) => {
    const clampedMin = Math.min(newMin, localValue[1] - step);
    const newRange: [number, number] = [clampedMin, localValue[1]];
    setLocalValue(newRange);
    onValueCommit(newRange);
  }, [localValue, step, onValueCommit]);

  const handleMaxInputChange = useCallback((newMax: number) => {
    const clampedMax = Math.max(newMax, localValue[0] + step);
    const newRange: [number, number] = [localValue[0], clampedMax];
    setLocalValue(newRange);
    onValueCommit(newRange);
  }, [localValue, step, onValueCommit]);

  // Compute safe slider display values: always a valid [min, max] range clamped
  // to the slider bounds so Radix never receives an inverted or out-of-range pair.
  const clampedA = Math.min(Math.max(localValue[0], min), max);
  const clampedB = Math.min(Math.max(localValue[1], min), max);
  const sliderDisplayMin = Math.min(clampedA, clampedB);
  const sliderDisplayMax = Math.max(clampedA, clampedB);

  return (
    <div className="space-y-2">
      <Slider
        value={[sliderDisplayMin, sliderDisplayMax]}
        onValueChange={handleSliderChange}
        onValueCommit={handleSliderCommit}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={sliderClassName || "w-full"}
      />
      <div
        className="flex gap-2"
        onFocus={() => { isInputFocusedRef.current = true; }}
        onBlur={(e) => {
          // Only clear when focus leaves the entire input wrapper (not when
          // tabbing between min and max inputs within the same component).
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            isInputFocusedRef.current = false;
          }
        }}
      >
        <div className="flex-1 min-w-0">
          {minLabel && <span className={labelClassName}>{minLabel}</span>}
          <NumericInput
            value={localValue[0]}
            onChange={handleMinInputChange}
            min={min}
            max={inputUnbounded ? Infinity : localValue[1] - step}
            step={step}
            disabled={disabled}
            className={cn("w-full min-w-[4.5rem]", inputClassName)}
          />
        </div>
        <div className="flex-1 min-w-0">
          {maxLabel && <span className={labelClassName}>{maxLabel}</span>}
          <NumericInput
            value={localValue[1]}
            onChange={handleMaxInputChange}
            min={localValue[0] + step}
            max={inputUnbounded ? Infinity : max}
            step={step}
            disabled={disabled}
            className={cn("w-full min-w-[4.5rem]", inputClassName)}
          />
        </div>
      </div>
    </div>
  );
}
