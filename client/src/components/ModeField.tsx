import { Card } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { Slider } from "@/components/ui/slider";
import { ScalarMode, ModeKind } from "@/lib/shapeTypes";

interface ModeFieldProps {
  label: string;
  config: ScalarMode<number>;
  onChange: (config: ScalarMode<number>) => void;
  bounds: { min: number; max: number };
  unit?: string;
  step?: number;
}

export function ModeField({ label, config, onChange, bounds, unit = "", step = 1 }: ModeFieldProps) {
  const handleModeChange = (mode: ModeKind) => {
    switch (mode) {
      case 'fixed':
        onChange({ kind: 'fixed', value: bounds.min });
        break;
      case 'range':
        onChange({ kind: 'range', min: bounds.min, max: bounds.max });
        break;
      case 'incremental':
        onChange({ kind: 'incremental', startValue: bounds.min, increment: 1 });
        break;
    }
  };

  return (
    <Card className="p-4 space-y-3" data-testid={`mode-field-${label.toLowerCase()}`}>
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>

      <RadioGroup
        value={config.kind}
        onValueChange={(v) => handleModeChange(v as ModeKind)}
        className="flex space-x-4"
        data-testid={`select-${label.toLowerCase()}-mode`}
      >
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="fixed" id={`${label}-fixed`} />
          <Label htmlFor={`${label}-fixed`} className="text-xs">Constant</Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="range" id={`${label}-range`} />
          <Label htmlFor={`${label}-range`} className="text-xs">Range</Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="incremental" id={`${label}-incremental`} />
          <Label htmlFor={`${label}-incremental`} className="text-xs">Incremental</Label>
        </div>
      </RadioGroup>

      {config.kind === 'fixed' && (
        <NumericInput
          value={config.value}
          onChange={(value) => onChange({ ...config, value })}
          min={bounds.min}
          max={bounds.max}
          step={step}
          data-testid={`input-${label.toLowerCase()}-fixed`}
        />
      )}

      {config.kind === 'range' && (
        <div className="space-y-2">
          <Slider
            value={[config.min, config.max]}
            onValueChange={([min, max]) => onChange({ ...config, min, max })}
            min={bounds.min}
            max={bounds.max}
            step={step}
            className="w-full"
            data-testid={`slider-${label.toLowerCase()}-range`}
          />
          <div className="flex space-x-2">
            <NumericInput
              value={config.min}
              onChange={(min) => onChange({ ...config, min })}
              min={bounds.min}
              max={config.max}
              step={step}
              placeholder="Min"
              className="flex-1"
              data-testid={`input-${label.toLowerCase()}-min`}
            />
            <NumericInput
              value={config.max}
              onChange={(max) => onChange({ ...config, max })}
              min={config.min}
              max={bounds.max}
              step={step}
              placeholder="Max"
              className="flex-1"
              data-testid={`input-${label.toLowerCase()}-max`}
            />
          </div>
        </div>
      )}

      {config.kind === 'incremental' && (
        <div className="space-y-2">
          <NumericInput
            value={config.startValue}
            onChange={(startValue) => onChange({ ...config, startValue })}
            min={bounds.min}
            max={bounds.max}
            step={step}
            placeholder="Start"
            data-testid={`input-${label.toLowerCase()}-start`}
          />
          <NumericInput
            value={config.increment}
            onChange={(increment) => onChange({ ...config, increment })}
            step={step}
            placeholder="Increment"
            data-testid={`input-${label.toLowerCase()}-increment`}
          />
        </div>
      )}
    </Card>
  );
}
