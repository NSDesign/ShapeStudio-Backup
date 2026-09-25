import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Info, Server, Loader2, Palette, Archive, HardDrive, Clock } from 'lucide-react';
import {
  estimateImageMemoryMb,
  estimateFileSizeMb,
  estimateProcessingTimeSec,
  deriveChunkSize,
  getMemoryTier,
  getMemoryTierLabel,
  formatSizeMb,
  formatDurationSec,
  MemoryTier,
} from '@shared/exportMemoryUtils';

export type CompressionFormat = 'none' | 'zip' | '7z';
export type CompressionLevel = 1 | 3 | 5 | 7 | 9;

export interface CompressionSettings {
  enabled: boolean;
  format: CompressionFormat;
  level: CompressionLevel;
}

export const DEFAULT_COMPRESSION_SETTINGS: CompressionSettings = {
  enabled: false,
  format: '7z',
  level: 5,
};

const COMPRESSION_LEVEL_LABELS: Record<CompressionLevel, string> = {
  1: 'Fastest',
  3: 'Fast',
  5: 'Normal',
  7: 'Maximum',
  9: 'Ultra',
};

interface TiffPreflightInfo {
  requestedCount: number;
  effectiveCount: number;
  megapixelsPerImage: number;
  memoryPerImageMb: number;
  totalMemoryMb: number;
  artboardDpi: number;
  canvasWidth: number;
  canvasHeight: number;
  isMemoryLimited: boolean;
  hasLowDpi: boolean;
  hasNoBleed: boolean;
  hasTransparentBackground: boolean;
  requiresServerExport?: boolean;
  serverExportReason?: string | null;
  estimatedDuration?: number;
  is16Bit?: boolean;
  estimatedFileSizeMb?: number;
  totalFileSizeMb?: number;
  processingTimeSec?: number;
  memoryTier?: MemoryTier;
  chunkSize?: number;
  chunkCount?: number;
}

interface TiffPreflightModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preflightInfo: TiffPreflightInfo;
  onConfirm: (dontShowAgain: boolean, compressionSettings?: CompressionSettings) => void;
  onCancel: () => void;
  isExporting?: boolean;
  flattenToRgb?: boolean;
  onFlattenToRgbChange?: (value: boolean) => void;
  matteColor?: string;
  onMatteColorChange?: (value: string) => void;
  compressionSettings?: CompressionSettings;
  onCompressionSettingsChange?: (settings: CompressionSettings) => void;
}

export default function TiffPreflightModal({
  open,
  onOpenChange,
  preflightInfo,
  onConfirm,
  onCancel,
  isExporting = false,
  flattenToRgb = false,
  onFlattenToRgbChange,
  matteColor = '#ffffff',
  onMatteColorChange,
  compressionSettings = DEFAULT_COMPRESSION_SETTINGS,
  onCompressionSettingsChange,
}: TiffPreflightModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [localCompression, setLocalCompression] = useState<CompressionSettings>(compressionSettings);
  
  // Sync local state with incoming prop when modal opens
  useEffect(() => {
    if (open) {
      setLocalCompression(compressionSettings);
    }
  }, [open, compressionSettings]);
  
  const updateCompression = (updates: Partial<CompressionSettings>) => {
    const newSettings = { ...localCompression, ...updates };
    setLocalCompression(newSettings);
    onCompressionSettingsChange?.(newSettings);
  };

  const hasWarnings = preflightInfo.hasLowDpi || preflightInfo.hasNoBleed || preflightInfo.hasTransparentBackground;
  const hasMemoryLimitation = preflightInfo.isMemoryLimited && !preflightInfo.requiresServerExport;
  const hasServerExport = preflightInfo.requiresServerExport;
  const hasCriticalIssue = hasMemoryLimitation;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-[500px] bg-slate-900 border-slate-700 text-slate-100">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-slate-100 flex items-center gap-2">
            {hasCriticalIssue ? (
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            ) : (
              <Info className="w-5 h-5 text-blue-400" />
            )}
            TIFF Export Summary
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Review your export settings before proceeding.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4 py-2 pr-4">
            <div className="p-3 bg-slate-800 rounded-lg space-y-2">
              <div className="text-sm font-medium text-slate-300">Export Details</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-slate-400">Canvas Size:</span>
                <span className="text-slate-200">{preflightInfo.canvasWidth} × {preflightInfo.canvasHeight} px</span>
                
                <span className="text-slate-400">Resolution:</span>
                <span className="text-slate-200">{preflightInfo.artboardDpi} DPI</span>
                
                <span className="text-slate-400">Image Size:</span>
                <span className="text-slate-200">{preflightInfo.megapixelsPerImage.toFixed(1)} megapixels</span>
                
                <span className="text-slate-400">RAM per Image:</span>
                <span className="text-slate-200">~{formatSizeMb(preflightInfo.memoryPerImageMb)}</span>

                {preflightInfo.estimatedFileSizeMb !== undefined && (
                  <>
                    <span className="text-slate-400">Est. File Size:</span>
                    <span className="text-slate-200">~{formatSizeMb(preflightInfo.estimatedFileSizeMb)}</span>
                  </>
                )}
              </div>
            </div>

            {(preflightInfo.estimatedFileSizeMb !== undefined || preflightInfo.processingTimeSec !== undefined || preflightInfo.memoryTier !== undefined) && (
              <div className="p-3 bg-slate-800 rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                  <HardDrive className="w-4 h-4" />
                  Batch Cost Estimate
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {preflightInfo.effectiveCount > 1 && preflightInfo.estimatedFileSizeMb !== undefined && (
                    <>
                      <span className="text-slate-400">Total File Size:</span>
                      <span className="text-slate-200">~{formatSizeMb(preflightInfo.totalFileSizeMb ?? preflightInfo.estimatedFileSizeMb * preflightInfo.effectiveCount)}</span>
                    </>
                  )}
                  {preflightInfo.processingTimeSec !== undefined && (
                    <>
                      <span className="text-slate-400 flex items-center gap-1"><Clock className="w-3 h-3" />Est. Time:</span>
                      <span className="text-slate-200">{formatDurationSec(preflightInfo.processingTimeSec)}</span>
                    </>
                  )}
                  {preflightInfo.memoryTier !== undefined && (
                    <>
                      <span className="text-slate-400">Memory Load:</span>
                      <span className={`font-medium ${
                        preflightInfo.memoryTier === 'low' ? 'text-green-400' :
                        preflightInfo.memoryTier === 'medium' ? 'text-yellow-400' :
                        preflightInfo.memoryTier === 'high' ? 'text-orange-400' :
                        'text-red-400'
                      }`}>
                        {getMemoryTierLabel(preflightInfo.memoryTier)}
                      </span>
                    </>
                  )}
                  {preflightInfo.chunkCount !== undefined && preflightInfo.chunkCount > 1 && (
                    <>
                      <span className="text-slate-400">Processing:</span>
                      <span className="text-slate-200">{preflightInfo.chunkCount} chunks of {preflightInfo.chunkSize}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {hasServerExport && (
              <div className="p-3 bg-purple-900/30 border border-purple-500/50 rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-purple-300 font-medium text-sm">
                  <Server className="w-4 h-4" />
                  Server Processing Required
                </div>
                <p className="text-xs text-purple-200/80">
                  {preflightInfo.serverExportReason || 'This export requires server-side processing for optimal quality.'}
                </p>
                {preflightInfo.is16Bit && (
                  <p className="text-xs text-purple-200/80">
                    16-bit TIFF output will be generated with embedded sRGB ICC profile for professional print quality.
                  </p>
                )}
                {preflightInfo.estimatedDuration && (
                  <p className="text-xs text-purple-200/60">
                    Estimated time: ~{Math.ceil(preflightInfo.estimatedDuration / 1000)} seconds per image
                  </p>
                )}
              </div>
            )}

            {hasMemoryLimitation && (
              <div className="p-3 bg-amber-900/30 border border-amber-500/50 rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-amber-300 font-medium text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  Batch Size Limited
                </div>
                <p className="text-xs text-amber-200/80">
                  Due to browser memory limits (~600 MB), only <strong>{preflightInfo.effectiveCount}</strong> of your 
                  requested <strong>{preflightInfo.requestedCount}</strong> images will be exported.
                </p>
                <p className="text-xs text-amber-200/60">
                  Estimated total: ~{preflightInfo.totalMemoryMb.toFixed(0)} MB
                </p>
              </div>
            )}

            {!hasMemoryLimitation && preflightInfo.requestedCount > 1 && (
              <div className="p-3 bg-slate-800 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Images to Export:</span>
                  <span className="text-slate-200 font-medium">{preflightInfo.effectiveCount}</span>
                </div>
                <div className="flex justify-between text-xs mt-1">
                  <span className="text-slate-500">Est. Total Memory:</span>
                  <span className="text-slate-400">~{preflightInfo.totalMemoryMb.toFixed(0)} MB</span>
                </div>
              </div>
            )}

            {hasWarnings && (
              <div className="p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-blue-300 font-medium text-sm">
                  <Info className="w-4 h-4" />
                  Print-Ready Considerations
                </div>
                <ul className="text-xs text-blue-200/80 space-y-1 list-disc list-inside">
                  {preflightInfo.hasLowDpi && (
                    <li>DPI ({preflightInfo.artboardDpi}) is below 300 - not ideal for professional printing</li>
                  )}
                  {preflightInfo.hasNoBleed && (
                    <li>Bleed is not enabled - may cause issues at print edges</li>
                  )}
                  {preflightInfo.hasTransparentBackground && (
                    <li>Background is transparent - some print services require solid background</li>
                  )}
                </ul>
              </div>
            )}

            {preflightInfo.hasTransparentBackground && onFlattenToRgbChange && (
              <div className="p-3 bg-slate-800 rounded-lg space-y-3">
                <div className="flex items-center gap-2 text-slate-300 font-medium text-sm">
                  <Palette className="w-4 h-4" />
                  RGB Optimization
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <Label htmlFor="flatten-to-rgb" className="text-xs text-slate-300 cursor-pointer">
                      Flatten to RGB (drop transparency)
                    </Label>
                    <p className="text-xs text-slate-500 mt-0.5">
                      ~10-20% smaller files, removes alpha channel
                    </p>
                  </div>
                  <Switch
                    id="flatten-to-rgb"
                    checked={flattenToRgb}
                    onCheckedChange={onFlattenToRgbChange}
                    disabled={isExporting}
                    className="data-[state=checked]:bg-green-600 data-[state=unchecked]:bg-green-900"
                  />
                </div>
                {flattenToRgb && onMatteColorChange && (
                  <div className="flex items-center gap-3 pt-1">
                    <Label className="text-xs text-slate-400">Matte Color:</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={matteColor}
                        onChange={(e) => onMatteColorChange(e.target.value)}
                        disabled={isExporting}
                        className="w-8 h-8 rounded cursor-pointer border border-slate-600 bg-transparent"
                      />
                      <span className="text-xs text-slate-400 font-mono">{matteColor}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {hasServerExport && (
              <div className="p-3 bg-slate-800 rounded-lg space-y-3">
                <div className="flex items-center gap-2 text-slate-300 font-medium text-sm">
                  <Archive className="w-4 h-4" />
                  Download Compression
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <Label htmlFor="enable-compression" className="text-xs text-slate-300 cursor-pointer">
                      Compress file before download
                    </Label>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Reduces download size by 30-70% (larger files benefit most)
                    </p>
                  </div>
                  <Switch
                    id="enable-compression"
                    checked={localCompression.enabled}
                    onCheckedChange={(checked) => updateCompression({ enabled: checked })}
                    disabled={isExporting}
                    className="data-[state=checked]:bg-green-600 data-[state=unchecked]:bg-green-900"
                    data-testid="switch-compression-enabled"
                  />
                </div>
                
                {localCompression.enabled && (
                  <div className="space-y-3 pt-2 border-t border-slate-700">
                    <div className="flex items-center gap-3">
                      <Label className="text-xs text-slate-400 w-16">Format:</Label>
                      <Select
                        value={localCompression.format}
                        onValueChange={(value: CompressionFormat) => updateCompression({ format: value })}
                        disabled={isExporting}
                      >
                        <SelectTrigger 
                          className="h-8 bg-slate-700 border-slate-600 text-slate-200 text-xs flex-1"
                          data-testid="select-compression-format"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-slate-600">
                          <SelectItem value="7z" className="text-slate-200 hover:bg-slate-700">
                            7z (Best compression)
                          </SelectItem>
                          <SelectItem value="zip" className="text-slate-200 hover:bg-slate-700">
                            ZIP (Most compatible)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-slate-400">Level:</Label>
                        <span className="text-xs text-slate-300 font-medium">
                          {COMPRESSION_LEVEL_LABELS[localCompression.level]} ({localCompression.level})
                        </span>
                      </div>
                      <Slider
                        value={[localCompression.level]}
                        onValueChange={([value]) => {
                          const levels: CompressionLevel[] = [1, 3, 5, 7, 9];
                          const closest = levels.reduce((prev, curr) => 
                            Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
                          );
                          updateCompression({ level: closest });
                        }}
                        min={1}
                        max={9}
                        step={2}
                        disabled={isExporting}
                        className="w-full"
                        data-testid="slider-compression-level"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>Fastest</span>
                        <span>Best</span>
                      </div>
                    </div>
                    
                    {localCompression.format === '7z' && localCompression.level >= 7 && (
                      <p className="text-[10px] text-amber-400/80">
                        High compression levels may increase processing time significantly
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex flex-col sm:flex-row gap-3 pt-2">
          <div className="flex items-center space-x-2 flex-1">
            <Checkbox
              id="dont-show-again"
              checked={dontShowAgain}
              onCheckedChange={(checked) => setDontShowAgain(checked as boolean)}
              disabled={isExporting}
              className="border-slate-500 data-[state=checked]:bg-blue-600"
            />
            <Label htmlFor="dont-show-again" className="text-xs text-slate-400 cursor-pointer">
              Don't show this again
            </Label>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={isExporting}
              className="bg-slate-800 border-slate-600 text-slate-100 hover:bg-slate-700"
            >
              Cancel
            </Button>
            <Button
              onClick={() => onConfirm(dontShowAgain, hasServerExport ? localCompression : undefined)}
              disabled={isExporting}
              className={hasServerExport 
                ? "bg-purple-600 hover:bg-purple-700 text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white"
              }
              data-testid="button-confirm-export"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {hasServerExport ? 'Processing...' : 'Exporting...'}
                </>
              ) : hasMemoryLimitation 
                ? `Export ${preflightInfo.effectiveCount} Image${preflightInfo.effectiveCount > 1 ? 's' : ''}`
                : hasServerExport
                  ? 'Start Server Export'
                  : 'Continue Export'
              }
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function calculateTiffPreflightInfo(
  artboardWidth: number,
  artboardHeight: number,
  artboardDpi: number,
  requestedCount: number,
  bleedEnabled: boolean,
  backgroundMode: 'transparent' | 'artboard' | 'custom',
  is16Bit: boolean = false,
  scale: number = 1
): TiffPreflightInfo {
  // Scale is applied directly to artboard dimensions (which are already in pixels at artboardDpi).
  // No separate dpiScale needed - the scale parameter is the user's manual export scale.
  // Artboard pixel dimensions already encode the correct DPI.
  const scaledWidth = Math.round(artboardWidth * scale);
  const scaledHeight = Math.round(artboardHeight * scale);
  const pixelsPerImage = scaledWidth * scaledHeight;
  const megapixelsPerImage = pixelsPerImage / 1_000_000;
  const bytesPerPixel = is16Bit ? 8 : 4;
  const bytesPerImage = pixelsPerImage * bytesPerPixel;
  const memoryPerImageMb = bytesPerImage / (1024 * 1024);
  
  const LIMIT_THRESHOLD_MB = 600;
  const MAX_CANVAS_DIMENSION = 32767;
  const MAX_CANVAS_PIXELS = 268435456;
  const SERVER_MEMORY_THRESHOLD_MB = 500;
  const totalMemoryMb = memoryPerImageMb * requestedCount;
  
  let requiresServerExport = false;
  let serverExportReason: string | null = null;
  
  if (scaledWidth > MAX_CANVAS_DIMENSION || scaledHeight > MAX_CANVAS_DIMENSION) {
    requiresServerExport = true;
    serverExportReason = `Canvas dimension ${Math.max(scaledWidth, scaledHeight)}px exceeds browser limit of ${MAX_CANVAS_DIMENSION}px`;
  } else if (pixelsPerImage > MAX_CANVAS_PIXELS) {
    requiresServerExport = true;
    serverExportReason = `Total pixels (${(pixelsPerImage / 1000000).toFixed(1)}M) exceeds browser limit of ${(MAX_CANVAS_PIXELS / 1000000).toFixed(0)}M`;
  } else if (memoryPerImageMb > SERVER_MEMORY_THRESHOLD_MB) {
    requiresServerExport = true;
    serverExportReason = `Estimated memory (${memoryPerImageMb.toFixed(0)}MB) exceeds browser threshold of ${SERVER_MEMORY_THRESHOLD_MB}MB`;
  } else if (is16Bit) {
    requiresServerExport = true;
    serverExportReason = '16-bit TIFF requires server-side processing for proper bit depth';
  }
  
  const baseDurationMs = 5000;
  const pixelFactor = pixelsPerImage / (3000 * 4000);
  const estimatedDuration = Math.ceil(baseDurationMs * Math.max(1, pixelFactor));
  
  let effectiveCount = requestedCount;
  let isMemoryLimited = false;
  
  if (!requiresServerExport && totalMemoryMb > LIMIT_THRESHOLD_MB && requestedCount > 1) {
    effectiveCount = Math.max(1, Math.floor(LIMIT_THRESHOLD_MB / memoryPerImageMb));
    isMemoryLimited = effectiveCount < requestedCount;
  }

  const bitDepth = is16Bit ? 16 : 8;
  const estimatedFileSizeMb = estimateFileSizeMb(scaledWidth, scaledHeight, bitDepth, 'tiff');
  const totalFileSizeMb = estimatedFileSizeMb * effectiveCount;
  const processingTimeSec = estimateProcessingTimeSec(scaledWidth, scaledHeight, effectiveCount, is16Bit);
  const memoryTier = getMemoryTier(memoryPerImageMb);
  const chunkSize = deriveChunkSize(memoryPerImageMb);
  const chunkCount = Math.ceil(effectiveCount / chunkSize);

  return {
    requestedCount,
    effectiveCount,
    megapixelsPerImage,
    memoryPerImageMb,
    totalMemoryMb: memoryPerImageMb * effectiveCount,
    artboardDpi,
    canvasWidth: scaledWidth,
    canvasHeight: scaledHeight,
    isMemoryLimited,
    hasLowDpi: artboardDpi < 300,
    hasNoBleed: !bleedEnabled,
    hasTransparentBackground: backgroundMode === 'transparent',
    requiresServerExport,
    serverExportReason,
    estimatedDuration: requiresServerExport ? estimatedDuration : undefined,
    is16Bit,
    estimatedFileSizeMb,
    totalFileSizeMb,
    processingTimeSec,
    memoryTier,
    chunkSize,
    chunkCount,
  };
}
