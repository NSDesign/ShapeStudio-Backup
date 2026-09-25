import { Label } from '@/components/ui/label';
import { NumericInput } from '@/components/ui/numeric-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import type { BatchConfigSettings } from '@shared/schema';
import { validateFillPaletteAssignments } from '@shared/fillPaletteAnchors';

type PaletteSettings = Pick<BatchConfigSettings,
  'fillColorPalette' | 'fillColorPaletteBehavior' | 'fillColorPaletteDistribution' |
  'fillColorPaletteInterpolation' | 'fillColorPaletteAssignments'>;

interface Props {
  settings: PaletteSettings;
  onChange: (updates: Partial<BatchConfigSettings>) => void;
  minimumShapeCount?: number;
}

const selectClass = 'h-9 flex-1 text-xs bg-slate-800 border-slate-600 text-slate-200';
const popupClass = 'bg-slate-800 border-slate-600';

export function FillPaletteAnchorControls({ settings, onChange, minimumShapeCount }: Props) {
  const behavior = settings.fillColorPaletteBehavior ?? 'cycle';
  const distribution = settings.fillColorPaletteDistribution ?? 'even';
  const assignments = settings.fillColorPaletteAssignments ?? [];
  const palette = settings.fillColorPalette ?? [];
  const error = behavior === 'blend' && distribution === 'manual'
    ? validateFillPaletteAssignments(assignments, palette.length)
    : null;
  const insufficient = behavior === 'blend' && distribution !== 'manual' &&
    minimumShapeCount !== undefined && minimumShapeCount < palette.length;

  return (
    <div className="space-y-4 pt-2 border-t border-slate-600" data-testid="fill-palette-anchor-controls">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-slate-400 shrink-0">Palette use</Label>
        <Select value={behavior} onValueChange={value => onChange({ fillColorPaletteBehavior: value as PaletteSettings['fillColorPaletteBehavior'] })}>
          <SelectTrigger className={selectClass} data-testid="select-fill-palette-behavior"><SelectValue /></SelectTrigger>
          <SelectContent className={popupClass} style={{ zIndex: 10002 }}>
            <SelectItem value="cycle">Cycle colours</SelectItem>
            <SelectItem value="blend">Assign &amp; blend</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {behavior === 'blend' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-slate-400">Anchor distribution</Label>
            <Select value={distribution} onValueChange={value => onChange({ fillColorPaletteDistribution: value as PaletteSettings['fillColorPaletteDistribution'] })}>
              <SelectTrigger className={selectClass} data-testid="select-fill-anchor-distribution"><SelectValue /></SelectTrigger>
              <SelectContent className={popupClass} style={{ zIndex: 10002 }}>
                <SelectItem value="manual">Manual positions</SelectItem>
                <SelectItem value="even">Even · equal spacing</SelectItem>
                <SelectItem value="logarithmic">Logarithmic · near start</SelectItem>
                <SelectItem value="exponential">Exponential · near end</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {distribution === 'manual' ? (
            <div className="space-y-2">
              <Label className="text-xs text-slate-400">Colour anchors · shape numbers start at 1 in each set</Label>
              <div className="max-h-40 overflow-y-auto space-y-2">
                {assignments.map((assignment, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Label htmlFor={`fill-anchor-position-${index}`} className="text-xs text-slate-400 shrink-0">Shape</Label>
                    <div className="w-24 shrink-0">
                      <NumericInput id={`fill-anchor-position-${index}`} aria-label={`Shape number for anchor ${index + 1}`}
                        value={assignment.shapeNumber} min={1} step={1}
                        onChange={number => onChange({ fillColorPaletteAssignments: assignments.map((entry, i) => i === index ? { ...entry, shapeNumber: number } : entry) })}
                        className="h-9 bg-slate-700 border-slate-600 text-slate-300 show-spinners"
                      />
                    </div>
                    <Select value={String(assignment.paletteIndex)} onValueChange={value =>
                      onChange({ fillColorPaletteAssignments: assignments.map((entry, i) => i === index ? { ...entry, paletteIndex: Number(value) } : entry) })
                    }>
                      <SelectTrigger className={selectClass} aria-label={`Palette colour for anchor ${index + 1}`}><SelectValue /></SelectTrigger>
                      <SelectContent className={popupClass} style={{ zIndex: 10002 }}>
                        {palette.map((color, i) => (
                          <SelectItem key={i} value={String(i)}>
                            <span className="flex items-center gap-2">
                              <span className="h-4 w-4 rounded border border-slate-600" style={{ backgroundColor: color }} />
                              Colour {i + 1}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="ghost" size="sm" className="h-9 shrink-0 text-slate-300"
                      aria-label={`Remove anchor ${index + 1}`}
                      onClick={() => onChange({ fillColorPaletteAssignments: assignments.filter((_, i) => i !== index) })}>Remove</Button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" disabled={!palette.length}
                onClick={() => onChange({ fillColorPaletteAssignments: [...assignments, {
                  shapeNumber: Math.max(0, ...assignments.map(a => Number.isFinite(a.shapeNumber) ? a.shapeNumber : 0)) + 1,
                  paletteIndex: 0,
                }] })}>Add anchor</Button>
              {error && <div role="alert" className="text-xs text-red-400">{error}</div>}
            </div>
          ) : (
            <div className="text-xs text-slate-400">
              Every palette colour becomes an anchor in order, from the first to the last shape in each set.
              {insufficient && <div role="alert" className="mt-2 text-red-400">
                Some sets may have fewer shapes than palette colours. Use at least {palette.length} shapes to include every colour.
              </div>}
              {!palette.length && <div role="alert" className="mt-2 text-red-400">Add at least one palette colour.</div>}
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-xs text-slate-400">Colour interpolation · between anchors</Label>
            <Select value={settings.fillColorPaletteInterpolation ?? 'linear'} onValueChange={value =>
              onChange({ fillColorPaletteInterpolation: value as PaletteSettings['fillColorPaletteInterpolation'] })
            }>
              <SelectTrigger className={selectClass} data-testid="select-fill-anchor-interpolation"><SelectValue /></SelectTrigger>
              <SelectContent className={popupClass} style={{ zIndex: 10002 }}>
                <SelectItem value="linear">Linear · steady blend</SelectItem>
                <SelectItem value="sine">Sine · smooth at both ends</SelectItem>
                <SelectItem value="exponential">Exponential · change near end</SelectItem>
                <SelectItem value="logarithmic">Logarithmic · change near start</SelectItem>
                <SelectItem value="bounce">Bounce · touch and rebound</SelectItem>
                <SelectItem value="zigzag">Zig-zag · alternate back and forth</SelectItem>
                <SelectItem value="sawtooth">Sawtooth · repeat the ramp</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}