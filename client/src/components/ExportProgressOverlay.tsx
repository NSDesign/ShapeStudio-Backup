import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { X, Loader2, Server, Clock, CheckCircle2, AlertCircle, Download } from 'lucide-react';

interface ExportProgressOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  progress: number;
  totalSteps: number;
  status: string;
  elapsedTime: number;
  estimatedTime?: number;
  isServerExport?: boolean;
  onCancel?: () => void;
  isComplete?: boolean;
  isError?: boolean;
  resultMessage?: string;
  downloadUrl?: string;
  downloadFilename?: string;
  onDownloadComplete?: () => void;
  chunkIndex?: number;
  chunkCount?: number;
}

function formatElapsedTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function ExportProgressOverlay({
  open,
  onOpenChange,
  progress,
  totalSteps,
  status,
  elapsedTime,
  estimatedTime,
  isServerExport = false,
  onCancel,
  isComplete = false,
  isError = false,
  resultMessage,
  downloadUrl,
  downloadFilename,
  onDownloadComplete,
  chunkIndex,
  chunkCount
}: ExportProgressOverlayProps) {
  const progressPercent = totalSteps > 0 ? Math.round((progress / totalSteps) * 100) : 0;
  const canClose = isComplete || isError;
  
  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      if (!newOpen && !canClose) return;
      onOpenChange(newOpen);
    }}>
      <DialogContent 
        className="max-w-[400px] bg-slate-900 border-slate-700 text-slate-100 p-0 gap-0 [&>button:last-child]:hidden"
        onPointerDownOutside={(e) => {
          if (!canClose) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (!canClose) e.preventDefault();
        }}
      >
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isComplete ? (
                <CheckCircle2 className="w-5 h-5 text-green-400" />
              ) : isError ? (
                <AlertCircle className="w-5 h-5 text-red-400" />
              ) : isServerExport ? (
                <Server className="w-5 h-5 text-purple-400" />
              ) : (
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              )}
              <span className="font-semibold text-slate-100">
                {isComplete ? 'Export Complete' : isError ? 'Export Failed' : isServerExport ? 'Server Processing' : 'Exporting...'}
              </span>
            </div>
            {canClose && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-slate-400 hover:text-slate-100"
                onClick={() => onOpenChange(false)}
                data-testid="close-export-overlay"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-slate-400">
                <Clock className="w-4 h-4" />
                <span className="font-mono">
                  {formatElapsedTime(elapsedTime)}
                  {estimatedTime !== undefined && estimatedTime > 0 && !isComplete && !isError && (
                    <span className="text-slate-500"> / Est: ~{formatElapsedTime(estimatedTime)}</span>
                  )}
                </span>
              </div>
              <span className="text-slate-300 font-medium">
                {progressPercent}%
              </span>
            </div>
            
            <Progress 
              value={progressPercent} 
              className="h-3 bg-slate-700"
            />
            
            {totalSteps > 0 && !isComplete && !isError && (
              <div className="text-xs text-slate-500 text-right">
                {progress} / {totalSteps} steps
              </div>
            )}
          </div>

          {chunkCount !== undefined && chunkCount > 1 && !isComplete && !isError && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Chunk {chunkIndex ?? 1} of {chunkCount}</span>
                <span>{chunkIndex ?? 1} / {chunkCount}</span>
              </div>
              <Progress
                value={Math.round(((chunkIndex ?? 1) / chunkCount) * 100)}
                className="h-1.5 bg-slate-700 [&>div]:bg-slate-400"
              />
            </div>
          )}

          <div className={`text-sm ${isError ? 'text-red-400' : isComplete ? 'text-green-400' : 'text-slate-400'}`}>
            {resultMessage || status || 'Processing...'}
          </div>

          {!isComplete && !isError && onCancel && (
            <Button
              onClick={onCancel}
              variant="outline"
              size="sm"
              className="w-full bg-red-900/20 border-red-500/30 text-red-300 hover:bg-red-900/40 hover:text-red-200"
              data-testid="cancel-export-button"
            >
              Cancel Export
            </Button>
          )}

          {isComplete && downloadUrl && (
            <a
              href={downloadUrl}
              download={downloadFilename || 'export.tiff'}
              onClick={() => {
                onDownloadComplete?.();
              }}
              className="w-full"
            >
              <Button
                className="w-full gap-2 bg-blue-600 hover:bg-blue-500 text-white"
                data-testid="download-export-button"
              >
                <Download className="w-4 h-4" />
                Save File
              </Button>
            </a>
          )}

          {canClose && (
            <Button
              onClick={() => onOpenChange(false)}
              variant={isComplete && downloadUrl ? "outline" : "default"}
              className={isComplete && downloadUrl 
                ? "w-full border-slate-600 text-slate-300 hover:bg-slate-700" 
                : "w-full bg-slate-700 hover:bg-slate-600 text-white"}
              data-testid="dismiss-export-button"
            >
              {isComplete && downloadUrl ? 'Close' : 'Dismiss'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
