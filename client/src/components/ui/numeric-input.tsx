import * as React from "react"
import { ChevronUp, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  value: number | string;
  onChange: (value: number) => void;
  onBlur?: () => void;
  min?: number;
  max?: number;
  step?: number;
  arrowVariant?: 'default' | 'orange';
}

const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  ({ className, value, onChange, onBlur, min = -Infinity, max = Infinity, step = 1, arrowVariant = 'default', ...props }, ref) => {
    const [localValue, setLocalValue] = React.useState(String(value));
    const isFocusedRef = React.useRef(false);
    
    const arrowColor = arrowVariant === 'orange' ? 'text-orange-500' : 'text-slate-300';
    const arrowHoverBg = arrowVariant === 'orange' ? 'hover:bg-orange-900/30' : 'hover:bg-slate-600';

    // Guard: don't overwrite the local value while the user is actively typing.
    // Without this, each keystroke fires onChange → parent re-renders → new value prop
    // → this effect fires → setLocalValue resets cursor position and can lose focus.
    React.useEffect(() => {
      if (!isFocusedRef.current) {
        setLocalValue(String(value));
      }
    }, [value]);

    const handleIncrement = React.useCallback(() => {
      const currentValue = parseFloat(localValue) || 0;
      const newValue = Math.max(min, Math.min(max, currentValue + step));
      setLocalValue(String(newValue));
      onChange(newValue);
    }, [localValue, min, max, step, onChange]);

    const handleDecrement = React.useCallback(() => {
      const currentValue = parseFloat(localValue) || 0;
      const newValue = Math.min(max, Math.max(min, currentValue - step));
      setLocalValue(String(newValue));
      onChange(newValue);
    }, [localValue, min, max, step, onChange]);

    const handleInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setLocalValue(newValue);
      
      // If the input is a valid number, call onChange immediately
      const numValue = parseFloat(newValue);
      if (!Number.isNaN(numValue) && newValue !== '' && newValue.trim() !== '-') {
        const clampedValue = Math.max(min, Math.min(max, numValue));
        onChange(clampedValue);
      }
    }, [min, max, onChange]);

    const handleInputBlur = React.useCallback(() => {
      const numValue = parseFloat(localValue);
      if (Number.isNaN(numValue) || localValue === '' || localValue.trim() === '-') {
        // Reset to current value if invalid
        setLocalValue(String(value));
      } else {
        // Clamp to bounds
        const clampedValue = Math.max(min, Math.min(max, numValue));
        setLocalValue(String(clampedValue));
        onChange(clampedValue);
      }
      onBlur?.();
    }, [localValue, value, min, max, onChange, onBlur]);

    const nudge = React.useCallback((delta: number) => {
      const currentValue = parseFloat(localValue) || 0;
      const newValue = Math.max(min, Math.min(max, currentValue + delta));
      setLocalValue(String(newValue));
      onChange(newValue);
    }, [localValue, min, max, onChange]);

    const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.currentTarget.blur();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const direction = e.key === 'ArrowUp' ? 1 : -1;
        let delta: number;
        if (e.altKey && e.shiftKey) {
          delta = 1.0 * direction;
        } else if (e.shiftKey) {
          delta = 10 * direction;
        } else if (e.altKey) {
          delta = 0.1 * direction;
        } else {
          delta = step * direction;
        }
        nudge(delta);
      }
    }, [step, nudge]);

    return (
      <div className="relative flex items-stretch overflow-hidden rounded-md w-full">
        <input
          type="number"
          ref={ref}
          value={localValue}
          onChange={handleInputChange}
          onFocus={() => { isFocusedRef.current = true; }}
          onBlur={(e) => { isFocusedRef.current = false; handleInputBlur(); }}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 pr-8 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
            className
          )}
          {...props}
        />
        <div className="absolute right-0 top-0 bottom-0 flex flex-col">
          <button
            type="button"
            onClick={handleIncrement}
            className={cn("flex-1 w-6 p-0 flex items-center justify-center bg-slate-700 border border-slate-600 rounded-tr-md transition-colors", arrowHoverBg)}
            tabIndex={-1}
          >
            <ChevronUp className={cn("h-3 w-3", arrowColor)} />
          </button>
          <button
            type="button"
            onClick={handleDecrement}
            className={cn("flex-1 w-6 p-0 flex items-center justify-center bg-slate-700 border border-slate-600 rounded-br-md transition-colors", arrowHoverBg)}
            tabIndex={-1}
          >
            <ChevronDown className={cn("h-3 w-3", arrowColor)} />
          </button>
        </div>
      </div>
    );
  }
);

NumericInput.displayName = "NumericInput";

export interface BufferedNumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  value: number | string;
  onCommit: (value: number) => void;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  arrowVariant?: 'default' | 'orange';
}

const BufferedNumericInput = React.forwardRef<HTMLInputElement, BufferedNumericInputProps>(
  ({ className, value, onCommit, onChange, min = -Infinity, max = Infinity, step = 1, arrowVariant = 'default', ...props }, ref) => {
    const [localValue, setLocalValue] = React.useState(String(value));
    const isEditingRef = React.useRef(false);
    
    const arrowColor = arrowVariant === 'orange' ? 'text-orange-500' : 'text-slate-300';
    const arrowHoverBg = arrowVariant === 'orange' ? 'hover:bg-orange-900/30' : 'hover:bg-slate-600';

    React.useEffect(() => {
      if (!isEditingRef.current) {
        setLocalValue(String(value));
      }
    }, [value]);

    const commitValue = React.useCallback((rawValue: string) => {
      const numValue = parseFloat(rawValue);
      if (Number.isNaN(numValue) || rawValue === '' || rawValue.trim() === '-') {
        setLocalValue(String(value));
      } else {
        const clampedValue = Math.max(min, Math.min(max, numValue));
        setLocalValue(String(clampedValue));
        onCommit(clampedValue);
      }
      isEditingRef.current = false;
    }, [value, min, max, onCommit]);

    const handleIncrement = React.useCallback(() => {
      const currentValue = parseFloat(localValue) || 0;
      const newValue = Math.max(min, Math.min(max, currentValue + step));
      setLocalValue(String(newValue));
      onCommit(newValue);
    }, [localValue, min, max, step, onCommit]);

    const handleDecrement = React.useCallback(() => {
      const currentValue = parseFloat(localValue) || 0;
      const newValue = Math.min(max, Math.max(min, currentValue - step));
      setLocalValue(String(newValue));
      onCommit(newValue);
    }, [localValue, min, max, step, onCommit]);

    const handleInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      isEditingRef.current = true;
      setLocalValue(newValue);
      
      if (onChange) {
        const numValue = parseFloat(newValue);
        if (!Number.isNaN(numValue) && newValue !== '' && newValue.trim() !== '-') {
          const clampedValue = Math.max(min, Math.min(max, numValue));
          onChange(clampedValue);
        }
      }
    }, [min, max, onChange]);

    const handleInputBlur = React.useCallback(() => {
      commitValue(localValue);
    }, [localValue, commitValue]);

    const nudge = React.useCallback((delta: number) => {
      const currentValue = parseFloat(localValue) || 0;
      const newValue = Math.max(min, Math.min(max, currentValue + delta));
      setLocalValue(String(newValue));
      onCommit(newValue);
    }, [localValue, min, max, onCommit]);

    const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        commitValue(localValue);
        e.currentTarget.blur();
        return;
      }
      if (e.key === 'Escape') {
        setLocalValue(String(value));
        isEditingRef.current = false;
        e.currentTarget.blur();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const direction = e.key === 'ArrowUp' ? 1 : -1;
        let delta: number;
        if (e.altKey && e.shiftKey) {
          delta = 1.0 * direction;
        } else if (e.shiftKey) {
          delta = 10 * direction;
        } else if (e.altKey) {
          delta = 0.1 * direction;
        } else {
          delta = step * direction;
        }
        nudge(delta);
      }
    }, [localValue, value, step, commitValue, nudge]);

    return (
      <div className="relative flex items-stretch overflow-hidden rounded-md w-full">
        <input
          type="number"
          ref={ref}
          value={localValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 pr-8 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
            className
          )}
          {...props}
        />
        <div className="absolute right-0 top-0 bottom-0 flex flex-col">
          <button
            type="button"
            onClick={handleIncrement}
            className={cn("flex-1 w-6 p-0 flex items-center justify-center bg-slate-700 border border-slate-600 rounded-tr-md transition-colors", arrowHoverBg)}
            tabIndex={-1}
          >
            <ChevronUp className={cn("h-3 w-3", arrowColor)} />
          </button>
          <button
            type="button"
            onClick={handleDecrement}
            className={cn("flex-1 w-6 p-0 flex items-center justify-center bg-slate-700 border border-slate-600 rounded-br-md transition-colors", arrowHoverBg)}
            tabIndex={-1}
          >
            <ChevronDown className={cn("h-3 w-3", arrowColor)} />
          </button>
        </div>
      </div>
    );
  }
);

BufferedNumericInput.displayName = "BufferedNumericInput";

export { NumericInput, BufferedNumericInput };
