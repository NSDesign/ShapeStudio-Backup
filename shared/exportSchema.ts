// Canonical export types and defaults - Single source of truth for export configuration

// Export scope options - ordered for UI display
export type ExportScope = 'all' | 'artboard' | 'selected';
export const EXPORT_SCOPE_ORDER = ['all', 'artboard', 'selected'] as const;

// Export format types
export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'bmp';

// Canonical batch export settings interface
export interface CanonicalBatchExportSettings {
  // Format and quality
  format: ExportFormat;
  quality: number;
  scale: number;
  
  // Size options
  useCustomSize: boolean;
  customWidth?: number;
  customHeight?: number;
  
  // Background control
  includeBackground: boolean;
  backgroundColor: string;
  
  // Margins
  useMargins: boolean;
  uniformMargins: boolean;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  
  // Batch-specific settings
  batchExportCount: number;
  batchSaveProjectFiles: boolean;
  batchSaveGeneratorFiles: boolean;
  packageAsZip: boolean;
  
  // Additional options
  includeAdornments: boolean;
  includeGrid: boolean;
  includeArtboardGeometry: boolean;
  includeTypeInName: boolean;
}

// Default batch export settings - matches ExportService.getDefaultBatchSettings() exactly
export const DEFAULT_BATCH_EXPORT_SETTINGS: CanonicalBatchExportSettings = {
  format: 'png',
  quality: 92,
  scale: 1,
  useCustomSize: false,
  includeBackground: true,
  backgroundColor: '#1e293b',
  useMargins: false,
  uniformMargins: true,
  marginTop: 20,
  marginRight: 20,
  marginBottom: 20,
  marginLeft: 20,
  batchExportCount: 10,
  batchSaveProjectFiles: false,
  batchSaveGeneratorFiles: false,
  packageAsZip: false, // Default to individual files
  includeAdornments: false,
  includeGrid: false,
  includeArtboardGeometry: false,
  includeTypeInName: false
};

// Default export scope - "all" shapes should be the default
export const DEFAULT_EXPORT_SCOPE: ExportScope = 'all';