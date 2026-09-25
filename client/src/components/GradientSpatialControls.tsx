import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StyledModeField, ModeConfig } from "@/components/StyledModeField";

type Settings = Record<string, any>;

interface Props {
  type: "Linear" | "Radial" | "Diamond";
  settings: Settings;
  onChange: (patch: Settings) => void;
}

function configFor(settings: Settings, key: string, modeKey: string, defaults: { value: number; range: [number, number]; start: number; increment: number }): ModeConfig {
  const mode = settings[modeKey] || "fixed";
  if (mode === "range") return { kind: "range", min: settings[`${key}Range`]?.[0] ?? defaults.range[0], max: settings[`${key}Range`]?.[1] ?? defaults.range[1] };
  if (mode === "incremental") return { kind: "incremental", startValue: settings[`${key}StartValue`] ?? defaults.start, increment: settings[`${key}Increment`] ?? defaults.increment };
  if (mode === "series") return {
    kind: "series",
    items: settings[`${key}SeriesItems`] ?? [{ mode: "fixed", value: defaults.value }],
    stagingMode: settings[`${key}SeriesStagingMode`] ?? "fixed",
    selection: settings[`${key}SeriesSelection`] ?? "sequential",
    exhaustion: settings[`${key}SeriesExhaustion`] ?? "cycle",
    driver: settings[`${key}SeriesDriver`] ?? "shape-index",
  };
  return { kind: "fixed", value: settings[key] ?? defaults.value };
}

function updateConfig(settings: Settings, onChange: (patch: Settings) => void, key: string, modeKey: string, config: ModeConfig, defaults: { value: number; range: [number, number]; start: number; increment: number }) {
  const patch: Settings = { [modeKey]: config.kind };
  const changedMode = (settings[modeKey] || "fixed") !== config.kind;
  if (config.kind === "fixed") patch[key] = changedMode ? defaults.value : config.value;
  if (config.kind === "range") patch[`${key}Range`] = changedMode ? defaults.range : [config.min, config.max];
  if (config.kind === "incremental") {
    patch[`${key}StartValue`] = changedMode ? defaults.start : config.startValue;
    patch[`${key}Increment`] = changedMode ? defaults.increment : config.increment;
  }
  if (config.kind === "series") {
    patch[`${key}SeriesItems`] = changedMode
      ? [{ mode: "fixed", value: defaults.value }]
      : (config.items.length ? config.items : [{ mode: "fixed", value: defaults.value }]);
    patch[`${key}SeriesStagingMode`] = config.stagingMode;
    patch[`${key}SeriesSelection`] = config.selection;
    patch[`${key}SeriesExhaustion`] = config.exhaustion;
    patch[`${key}SeriesDriver`] = config.driver;
  }
  onChange(patch);
}

export function GradientSpatialControls({ type, settings, onChange }: Props) {
  const key = `fillGradient${type}Scale`;
  const modeKey = `fillGradient${type}ScaleMode`;
  const scaleConfig = configFor(settings, key, modeKey, { value: 100, range: [50, 150], start: 100, increment: 10 });
  return (
    <div className="space-y-4 px-1.5 sm:px-3 py-3 bg-slate-800/40 rounded border border-slate-700" data-testid={`gradient-${type.toLowerCase()}-spatial-controls`}>
      <StyledModeField
        label="Scale"
        unit="%"
        config={scaleConfig}
        onChange={(config) => updateConfig(settings, onChange, key, modeKey, config, { value: 100, range: [50, 150], start: 100, increment: 10 })}
        bounds={{ min: 10, max: 300 }}
        step={1}
        allowedModes={["fixed", "range", "incremental", "series"]}
      />
      {scaleConfig.kind === "incremental" && (
        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-400 shrink-0">Scale driver</Label>
          <Select value={settings.gradientScaleIncrementalIndexDriver || "shapeIndex"} onValueChange={(value) => onChange({ gradientScaleIncrementalIndexDriver: value })}>
            <SelectTrigger className="h-9 flex-1 text-xs bg-slate-800 border-slate-600 text-slate-200"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
              <SelectItem value="shapeIndex">Shape index</SelectItem>
              <SelectItem value="setRepIndex">Set-rep index</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {type === "Diamond" && (
        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-400 shrink-0">Below 100%</Label>
          <Select value={settings.fillGradientDiamondScaleEdgeMode || "streak"} onValueChange={(value) => onChange({ fillGradientDiamondScaleEdgeMode: value })}>
            <SelectTrigger className="h-9 flex-1 text-xs bg-slate-800 border-slate-600 text-slate-200"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
              <SelectItem value="streak">Streak edge colours</SelectItem>
              <SelectItem value="repeat">Repeat diamond bands</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

export function LinearPositionControls({ settings, onChange }: Omit<Props, "type">) {
  const coordinate = settings.fillGradientLinearCenter || "center";
  const corners = settings.fillGradientLinearCorners || { topLeft: true, topRight: true, bottomLeft: true, bottomRight: true };
  const midpoints = settings.fillGradientLinearMidpoints || { top: true, right: true, bottom: true, left: true };
  const togglePoint = (key: "fillGradientLinearCorners" | "fillGradientLinearMidpoints", point: string) => {
    const current = settings[key] || {};
    onChange({ [key]: { ...current, [point]: !current[point] } });
  };
  return (
    <div className="space-y-4 px-1.5 sm:px-3 py-3 bg-slate-800/40 rounded border border-slate-700" data-testid="gradient-linear-position-controls">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-slate-400 shrink-0">Position</Label>
        <Select value={coordinate} onValueChange={(value) => onChange({ fillGradientLinearCenter: value })}>
          <SelectTrigger className="h-9 flex-1 text-xs bg-slate-800 border-slate-600 text-slate-200"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
            <SelectItem value="center">Center</SelectItem>
            <SelectItem value="corners">Corners</SelectItem>
            <SelectItem value="midpoints">Midpoints</SelectItem>
            <SelectItem value="coordinates">Coordinates</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {coordinate === "coordinates" && (
        <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <StyledModeField label="Center X" unit="%" config={configFor(settings, "fillGradientLinearCenterX", "fillGradientLinearCenterXMode", { value: 50, range: [25, 75], start: 50, increment: 10 })} onChange={(c) => updateConfig(settings, onChange, "fillGradientLinearCenterX", "fillGradientLinearCenterXMode", c, { value: 50, range: [25, 75], start: 50, increment: 10 })} bounds={{ min: 0, max: 100 }} />
          <StyledModeField label="Center Y" unit="%" config={configFor(settings, "fillGradientLinearCenterY", "fillGradientLinearCenterYMode", { value: 50, range: [25, 75], start: 50, increment: 10 })} onChange={(c) => updateConfig(settings, onChange, "fillGradientLinearCenterY", "fillGradientLinearCenterYMode", c, { value: 50, range: [25, 75], start: 50, increment: 10 })} bounds={{ min: 0, max: 100 }} />
        </div>
        </>
      )}
      {(coordinate === "corners" || coordinate === "midpoints") && (
        <div className="space-y-2">
          <Label className="text-xs text-slate-400">Available endpoints</Label>
          <div className="grid grid-cols-2 gap-2">
            {(coordinate === "corners"
              ? (["topLeft", "topRight", "bottomLeft", "bottomRight"] as const)
              : (["top", "right", "bottom", "left"] as const)
            ).map((point) => {
              const source = coordinate === "corners" ? corners : midpoints;
              const key = coordinate === "corners" ? "fillGradientLinearCorners" : "fillGradientLinearMidpoints";
              return (
                <div key={point} className="flex items-center gap-2">
                  <Switch checked={source[point]} onCheckedChange={() => togglePoint(key, point)} className="data-[state=checked]:bg-cyan-600" />
                  <Label className="text-xs text-slate-300">{point}</Label>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-slate-400 shrink-0">Selection</Label>
            <Select value={settings.fillGradientLinearSelectionMode || "random"} onValueChange={(value) => onChange({ fillGradientLinearSelectionMode: value })}>
              <SelectTrigger className="h-9 flex-1 text-xs bg-slate-800 border-slate-600 text-slate-200"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600" style={{ zIndex: 10002 }}>
                <SelectItem value="random">Random</SelectItem>
                <SelectItem value="cycle">Cycle</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}