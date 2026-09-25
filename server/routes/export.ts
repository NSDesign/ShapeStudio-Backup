import type { Express } from "express";
import { ExportService, BatchExportSettings, highResExportService, HighResExportRequest } from '../services/exportService';
import { ProjectService, SaveProjectSettings } from '../services/projectService';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { 
  BatchConfigSettingsSchema, 
  GenerationSetSchema, 
  SupportedShapeTypeSchema,
  migrateBatchConfigSettings
} from '../../shared/schema';

// Create service instances
const exportService = new ExportService();
const projectService = new ProjectService();

// High-resolution export schema
const HighResExportSchema = z.object({
  shapes: z.array(z.any()),
  groups: z.array(z.any()).optional().default([]),
  artboard: z.object({
    x: z.number().default(0),
    y: z.number().default(0),
    width: z.number(),
    height: z.number(),
    backgroundColor: z.string(),
    dpi: z.number().default(300),
    printConfig: z.any().optional()
  }),
  exportSettings: z.object({
    format: z.enum(['tiff', 'png', 'jpeg', 'webp', 'pdf']).default('tiff'),
    bitDepth: z.union([z.literal(8), z.literal(16)]).default(16),
    compression: z.enum(['none', 'deflate']).default('none'),
    dpi: z.number().optional(),
    scale: z.number().min(0.1).max(10).default(1),
    includeBleed: z.boolean().default(false),
    includePrintMarks: z.boolean().default(false),
    backgroundColor: z.string().optional(),
    backgroundMode: z.enum(['transparent', 'artboard', 'custom']).default('transparent'),
    quality: z.number().min(1).max(100).optional().default(90),
    flattenToRgb: z.boolean().optional().default(false),
    matteColor: z.string().optional().default('#ffffff'),
    saveProjectFile: z.boolean().optional().default(false),
    // Metadata fields for professional print exports
    artistName: z.string().optional(),
    copyrightText: z.string().optional(),
    imageTitle: z.string().optional(),
    imageDescription: z.string().optional(),
    embedIccProfile: z.boolean().optional().default(true)
  }),
  exportMode: z.enum(['artboard', 'all', 'selection', 'artboard-extended']).optional().default('artboard'),
  archiveCompression: z.object({
    enabled: z.boolean(),
    format: z.enum(['none', 'zip', '7z']),
    level: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(7), z.literal(9)])
  }).optional()
});

// Validation schemas
// V2 Generation Count Schema
const GenerationCountSchema = z.object({
  mode: z.enum(['fixed', 'range', 'incremental']),
  fixed: z.number().min(1).optional(),
  min: z.number().min(1).optional(),
  max: z.number().min(1).optional(),
  start: z.number().min(1).optional(),
  increment: z.number().min(1).optional(),
  resetPerBatch: z.boolean().optional()
}).refine((data) => {
  if (data.mode === 'fixed') return typeof data.fixed === 'number';
  if (data.mode === 'range') return typeof data.min === 'number' && typeof data.max === 'number' && data.min <= data.max;
  if (data.mode === 'incremental') return typeof data.start === 'number' && typeof data.increment === 'number';
  return false;
}, {
  message: "Invalid generation count configuration for the specified mode"
});

const BatchExportSchema = z.object({
  // V1 (existing) parameters
  format: z.enum(['png', 'jpeg', 'webp', 'avif', 'bmp']).default('png'),
  quality: z.number().min(1).max(100).optional().default(92),
  scale: z.number().min(0.1).max(8).optional().default(1),
  useCustomSize: z.boolean().optional().default(false),
  customWidth: z.number().min(1).optional(),
  customHeight: z.number().min(1).optional(),
  includeBackground: z.boolean().optional().default(true),
  backgroundColor: z.string().optional().default('#1e293b'),
  useMargins: z.boolean().optional().default(false),
  uniformMargins: z.boolean().optional().default(true),
  marginTop: z.number().min(0).optional().default(20),
  marginRight: z.number().min(0).optional().default(20),
  marginBottom: z.number().min(0).optional().default(20),
  marginLeft: z.number().min(0).optional().default(20),
  batchExportCount: z.number().min(1).max(100).default(10),
  batchSaveProjectFiles: z.boolean().optional().default(false),
  packageAsZip: z.boolean().optional().default(false),
  // Selective export settings (V3+ features)
  exportAllImages: z.boolean().optional().default(true),
  selectedImageIndices: z.array(z.number().int().positive()).optional().default([]),
  includeAdornments: z.boolean().optional().default(false),
  includeGrid: z.boolean().optional().default(false),
  includeArtboardGeometry: z.boolean().optional().default(false),
  filename: z.string().optional(),
  customPrefix: z.string().optional(),
  includeTypeInName: z.boolean().optional().default(false),
  
  // V2 additions
  generationCount: GenerationCountSchema.optional(),
  modulationValue: z.number().min(0).max(1).optional()
});

// Minimal SaveProjectRequestSchema - shapes and artboard only
const SaveProjectSchema = z.object({
  // Project metadata
  projectName: z.string().optional(),
  includeTimestamp: z.boolean().optional().default(true),
  
  // Core project data
  shapes: z.array(z.any()).optional().default([]),
  groups: z.array(z.any()).optional().default([]),
  
  // Minimal artboard config (new format)
  artboard: z.object({
    width: z.number(),
    height: z.number(),
    backgroundColor: z.string()
  }).optional(),
  
  // Legacy canvas settings (for backwards compatibility)
  canvasSettings: z.object({
    width: z.number(),
    height: z.number(),
    zoom: z.number().optional().default(1),
    panX: z.number().optional().default(0),
    panY: z.number().optional().default(0),
    backgroundColor: z.string().optional().default('#1e293b'),
    showGrid: z.boolean().optional().default(false)
  }).optional(),
  
  // Legacy fields (for backwards compatibility, but not saved)
  batchConfigSettings: BatchConfigSettingsSchema.optional(),
  generationSets: z.array(GenerationSetSchema).optional().default([]),
  enabledShapeTypes: z.array(SupportedShapeTypeSchema).optional().default([])
});

// Live State API Schema - Complete current UI state
const LiveStateApiSchema = z.object({
  // Mode differentiation
  apiMode: z.literal('live').default('live'),
  
  // Current UI state (passed from frontend)
  currentState: z.object({
    // Shape types and settings from current UI
    enabledShapeTypes: z.array(z.string()),
    shapeCountMode: z.enum(['fixed', 'range']),
    shapeCount: z.number(),
    shapeCountRange: z.tuple([z.number(), z.number()]),
    shapeSpecificSettings: z.record(z.any()),
    // Export settings from current UI
    exportFormat: z.enum(['png', 'jpeg', 'webp', 'avif', 'bmp']),
    exportQuality: z.number().min(1).max(100),
    exportScale: z.number().min(0.1).max(20),
    exportScope: z.enum(['all', 'selected', 'artboard']),
    // Batch settings from UI
    exportBatchModeEnabled: z.boolean(),
    exportBatchCount: z.number().min(1).max(100),
    exportSaveProjectFiles: z.boolean(),
    exportShapeCountRange: z.tuple([z.number(), z.number()]),
    // Packaging settings
    packageAsZip: z.boolean().optional().default(false),
    // Selective export settings
    exportAllImages: z.boolean().optional().default(true),
    selectedImageIndices: z.array(z.number()).optional().default([]),
    // Artboard settings
    artboardBackgroundColor: z.string(),
    // Only enabled generation config settings
    enabledGenerationSettings: z.record(z.any()),
  }).optional()
});

// Helper function to apply selective filtering to both image and project files
// NOTE: This should only be used when files are actually available (e.g., Live API or status responses)
function applySelectiveFiltering(
  result: any, 
  settings: { batchSaveProjectFiles?: boolean; exportAllImages?: boolean; selectedImageIndices?: number[] }
): any {
  const { batchSaveProjectFiles = false, exportAllImages = true, selectedImageIndices = [] } = settings;
  
  // If Export All Images is enabled, return all files as-is
  if (exportAllImages) {
    // Create a files array that includes both types when available
    let files: any[] = [];
    
    // Always include image files if available
    if (result.imageFiles && Array.isArray(result.imageFiles)) {
      files.push(...result.imageFiles);
    }
    
    // Include project files if enabled and available
    if (batchSaveProjectFiles && result.projectFiles && Array.isArray(result.projectFiles)) {
      files.push(...result.projectFiles);
    }
    
    return {
      ...result,
      files,
      downloadUrl: files.length > 0 ? files[0].url : result.downloadUrl
    };
  }
  
  // Selective export is enabled - only export selected files
  if (selectedImageIndices.length > 0) {
    // Convert 1-based UI indices to 0-based array indices and validate
    const validIndices = selectedImageIndices
      .filter(idx => idx >= 1) // Must be 1-based
      .map(idx => idx - 1); // Convert to 0-based
    
    // If Save Project Files is enabled, return ONLY project files for selected indices
    if (batchSaveProjectFiles && result.projectFiles && Array.isArray(result.projectFiles) && result.projectFiles.length > 0) {
      const filteredProjectFiles = validIndices
        .filter(index => index >= 0 && index < result.projectFiles!.length)
        .map(index => result.projectFiles![index]);
      
      return {
        ...result,
        imageFiles: [], // No image files when selective + project files enabled
        projectFiles: filteredProjectFiles,
        files: filteredProjectFiles,
        downloadUrl: filteredProjectFiles.length > 0 ? filteredProjectFiles[0].url : result.downloadUrl
      };
    }
    
    // If Save Project Files is disabled, return ONLY image files for selected indices
    if (result.imageFiles && Array.isArray(result.imageFiles) && result.imageFiles.length > 0) {
      const filteredImageFiles = validIndices
        .filter(index => index >= 0 && index < result.imageFiles!.length)
        .map(index => result.imageFiles![index]);
      
      return {
        ...result,
        imageFiles: filteredImageFiles,
        projectFiles: [], // No project files when not enabled
        files: filteredImageFiles,
        downloadUrl: filteredImageFiles.length > 0 ? filteredImageFiles[0].url : result.downloadUrl
      };
    }
  }
  
  // No files selected for export
  return {
    ...result,
    imageFiles: [],
    projectFiles: [],
    files: [],
    downloadUrl: result.downloadUrl
  };
}

export function registerExportRoutes(app: Express): void {
  // Get available export formats
  app.get('/api/export/formats', (req, res) => {
    try {
      const formats = [
        { value: 'png', label: 'PNG', description: 'Lossless with transparency' },
        { value: 'jpeg', label: 'JPEG', description: 'Lossy compression, smaller files' },
        { value: 'webp', label: 'WebP', description: 'Modern format, excellent compression' },
        { value: 'avif', label: 'AVIF', description: 'Next-gen format, best compression' },
        { value: 'bmp', label: 'BMP', description: 'Uncompressed bitmap' }
      ];
      
      res.json({ success: true, formats });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get export formats',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get default export settings
  app.get('/api/export/defaults', (req, res) => {
    try {
      const defaults = exportService.getDefaultBatchSettings();
      res.json({ success: true, defaults });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get default settings',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Start batch export
  app.post('/api/export/batch', async (req, res) => {
    try {
      // Set defaults when options are not provided: Export All Images = true, Save Project Files = true
      const requestWithDefaults = {
        exportAllImages: true,
        batchSaveProjectFiles: true,
        ...req.body
      };
      
      // Extract batchConfigSettings before validation (BatchExportSchema doesn't include it)
      const { batchConfigSettings, generationSets, ...exportSettingsInput } = requestWithDefaults;
      
      // Validate request body
      const validatedSettings = BatchExportSchema.parse(exportSettingsInput);
      
      // Apply migration to batch config settings
      const migratedBatchConfig = batchConfigSettings ? migrateBatchConfigSettings(batchConfigSettings) : undefined;
      
      // For now, we'll use mock data since we don't have the actual shape generation
      // In a real implementation, this would get the current shapes and settings
      const mockShapes: any[] = [];
      const mockGroups: any[] = [];
      const mockCanvasSettings = {
        width: 1200,
        height: 800,
        zoom: 1,
        panX: 0,
        panY: 0,
        backgroundColor: '#1e293b',
        showGrid: false
      };
      const fallbackBatchConfig = {
        selectedPreset: 'none',
        distributionLayoutEnabled: false,
        propertiesEnabled: true,
        // Add other default batch config settings
      };
      const mockEnabledShapeTypes = new Set(['rectangle', 'circle', 'polygon']);
      
      // Mock shape generation function
      const mockGenerateShapes = (config: any) => {
        // This would be replaced with actual shape generation logic
        return { shapes: [], groups: [] };
      };
      
      const result = await exportService.startBatchExport(
        mockShapes,
        mockGroups,
        mockCanvasSettings,
        (migratedBatchConfig ?? fallbackBatchConfig) as any,
        mockEnabledShapeTypes,
        validatedSettings,
        mockGenerateShapes
      );
      
      // Note: Project file prioritization happens at the status endpoint when files are available
      // The initial POST response contains empty arrays that will be populated during async processing
      res.json(result);
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ 
          success: false, 
          error: 'Invalid request parameters',
          details: error.errors
        });
      } else {
        res.status(500).json({ 
          success: false, 
          error: 'Failed to start batch export',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  });

  // Get export status
  app.get('/api/export/status/:exportId', async (req, res) => {
    try {
      const { exportId } = req.params;
      const status = await exportService.getExportStatus(exportId);
      
      if (!status) {
        return res.status(404).json({ 
          success: false, 
          error: 'Export not found' 
        });
      }
      
      // If export is completed and was using individual files, include file arrays
      if (status.status === 'completed') {
        const individualFiles = exportService.getIndividualFiles(exportId);
        const exportSettings = exportService.getExportSettings(exportId);
        
        if (individualFiles && exportSettings) {
          // Apply selective filtering with stored settings
          const resultWithFiles = {
            ...status,
            imageFiles: individualFiles.imageFiles,
            projectFiles: individualFiles.projectFiles
          };
          
          const filteredResult = applySelectiveFiltering(resultWithFiles, exportSettings);
          
          return res.json({
            success: true,
            status: filteredResult
          });
        } else if (individualFiles) {
          // Fallback for exports without stored settings (backward compatibility)
          let files: any[] = [];
          
          // Include both image and project files when available
          if (individualFiles.imageFiles) files.push(...individualFiles.imageFiles);
          if (individualFiles.projectFiles) files.push(...individualFiles.projectFiles);
            
          return res.json({
            success: true,
            status: {
              ...status,
              imageFiles: individualFiles.imageFiles,
              projectFiles: individualFiles.projectFiles,
              files,
              downloadUrl: files.length > 0 ? files[0].url : status.downloadPath
            }
          });
        }
      }
      
      res.json({ success: true, status });
      
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get export status',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Download completed export (ZIP only)
  app.get('/api/export/download/:exportId', async (req, res) => {
    try {
      const { exportId } = req.params;
      const filePath = await exportService.getExportFile(exportId);
      
      if (!filePath) {
        return res.status(404).json({ 
          success: false, 
          error: 'Export file not found' 
        });
      }
      
      const filename = path.basename(filePath);
      res.download(filePath, filename, (err) => {
        if (err) {
          console.error('Download error:', err);
          if (!res.headersSent) {
            res.status(500).json({ 
              success: false, 
              error: 'Failed to download file',
              message: err.message
            });
          }
        }
      });
      
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to download export',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Serve individual export files
  app.get('/api/export/files/:exportId/:filename', (req, res) => {
    try {
      const { exportId, filename } = req.params;
      const filePath = exportService.getIndividualFile(exportId, filename);
      
      if (!filePath) {
        return res.status(404).json({ 
          success: false, 
          error: 'File not found' 
        });
      }
      
      res.download(filePath, filename, (err) => {
        if (err) {
          console.error('Download error:', err);
          if (!res.headersSent) {
            res.status(500).json({ 
              success: false, 
              error: 'Failed to download file',
              message: err.message
            });
          }
        }
      });
      
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to serve file',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Save project (minimal schema: shapes + artboard only)
  app.post('/api/projects/save', async (req, res) => {
    try {
      const validatedData = SaveProjectSchema.parse(req.body);
      
      // Extract minimal project data from request body
      const shapes = validatedData.shapes || [];
      const groups = validatedData.groups || [];
      
      // Extract artboard config from canvasSettings or artboard field
      let artboard: { width: number; height: number; backgroundColor: string };
      if (validatedData.artboard) {
        artboard = {
          width: validatedData.artboard.width || 1200,
          height: validatedData.artboard.height || 800,
          backgroundColor: validatedData.artboard.backgroundColor || '#ffffff'
        };
      } else if (validatedData.canvasSettings) {
        // Legacy compatibility: extract from canvasSettings
        artboard = {
          width: validatedData.canvasSettings.width || 1200,
          height: validatedData.canvasSettings.height || 800,
          backgroundColor: validatedData.canvasSettings.backgroundColor || '#ffffff'
        };
      } else {
        // Default fallback
        artboard = {
          width: 1200,
          height: 800,
          backgroundColor: '#ffffff'
        };
      }
      
      // Pass settings for projectName and includeTimestamp
      const saveSettings: SaveProjectSettings = {
        projectName: validatedData.projectName,
        includeTimestamp: validatedData.includeTimestamp ?? true
      };
      
      const result = await projectService.saveProject(
        shapes,
        groups,
        artboard,
        saveSettings
      );
      
      res.json(result);
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ 
          success: false, 
          error: 'Invalid request parameters',
          details: error.errors
        });
      } else {
        res.status(500).json({ 
          success: false, 
          error: 'Failed to save project',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  });

  // Download project file
  app.get('/api/projects/download/:filename', async (req, res) => {
    try {
      const { filename } = req.params;
      const filePath = await projectService.getProjectFile(decodeURIComponent(filename));
      
      if (!filePath) {
        return res.status(404).json({ 
          success: false, 
          error: 'Project file not found' 
        });
      }
      
      res.download(filePath, filename, (err) => {
        if (err) {
          console.error('Download error:', err);
          if (!res.headersSent) {
            res.status(500).json({ 
              success: false, 
              error: 'Failed to download file',
              message: err.message
            });
          }
        }
      });
      
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to download project',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Live State API - Single endpoint using all current app settings
  app.post('/api/live/execute', async (req, res) => {
    try {
      // Validate API key - using hardcoded key
      const apiKey = req.headers['x-api-key'];
      const expectedApiKey = '3211d3f332fsss4t4tbebw5r653765h6brb4';
      if (!apiKey || apiKey !== expectedApiKey) {
        return res.status(401).json({ 
          success: false, 
          error: 'Invalid or missing API key' 
        });
      }

      const validatedData = LiveStateApiSchema.parse({
        ...req.body,
        apiMode: 'live'
      });

      // Convert current UI state to complete export operation
      const currentState = validatedData.currentState;
      if (!currentState) {
        return res.status(400).json({ 
          success: false, 
          error: 'Current UI state is required for Live State API' 
        });
      }

      // Set defaults when options are not provided: Export All Images = true, Save Project Files = true
      const exportAllImages = currentState.exportAllImages !== false; // default to true
      const exportSaveProjectFiles = currentState.exportSaveProjectFiles !== false; // default to true 
      const selectedImageIndices = currentState.selectedImageIndices || [];

      // Force batch mode for Live State API
      if (!currentState.exportBatchModeEnabled) {
        return res.status(400).json({ 
          success: false, 
          error: 'Live State API requires batch mode to be enabled. Set exportBatchModeEnabled: true or use generationCount mode: fixed with count: 1 for single generation.' 
        });
      }

      // Build complete export operation using ALL current UI settings
      const allSettings = {
        // Export settings from UI
        format: currentState.exportFormat,
        quality: currentState.exportQuality / 100, // Convert percentage to decimal
        scale: currentState.exportScale,
        scope: currentState.exportScope,
        includeBackground: true,
        backgroundColor: currentState.artboardBackgroundColor || '#ffffff',
        
        // Batch settings from UI - use correct field names that match BatchExportSchema
        batchExportCount: currentState.exportBatchCount,
        batchSaveProjectFiles: exportSaveProjectFiles,
        packageAsZip: currentState.packageAsZip || false,
        // Selective export settings
        exportAllImages: exportAllImages,
        selectedImageIndices: selectedImageIndices,
        
        // Generation count settings from UI
        ...(currentState.exportShapeCountRange && {
          generationCount: {
            mode: 'range' as const,
            min: currentState.exportShapeCountRange[0],
            max: currentState.exportShapeCountRange[1]
          }
        }),
        
        // Advanced generation config from enabled sections only
        ...(currentState.enabledGenerationSettings.modulation && {
          modulationValue: currentState.enabledGenerationSettings.modulation.value
        })
      };

      // Perform actual batch export using all current UI settings
      const mockShapes: any[] = [];
      const mockGroups: any[] = [];
      const mockCanvasSettings = {
        width: 1200,
        height: 800,
        zoom: 1,
        panX: 0,
        panY: 0,
        backgroundColor: allSettings.backgroundColor,
        showGrid: false
      };
      const mockBatchConfigSettings = {
        selectedPreset: 'none',
        distributionLayoutEnabled: false,
        propertiesEnabled: true,
      };
      const enabledShapeTypesSet = new Set(currentState.enabledShapeTypes);
      
      // Mock shape generation function
      const mockGenerateShapes = (config: any) => {
        return { shapes: [], groups: [] };
      };
      
      // Actually perform the export using the export service
      const result = await exportService.startBatchExport(
        mockShapes,
        mockGroups,
        mockCanvasSettings,
        mockBatchConfigSettings as any,
        enabledShapeTypesSet,
        allSettings,
        mockGenerateShapes
      );
      
      // Apply selective filtering logic for Live API
      // Live API expects immediate results, so we apply the helper here
      let filteredResult = applySelectiveFiltering(result, {
        batchSaveProjectFiles: allSettings.batchSaveProjectFiles,
        exportAllImages: exportAllImages,
        selectedImageIndices: selectedImageIndices
      });
      
      // Return the same format as regular batch export with direct URLs
      res.json({
        ...filteredResult,
        apiMode: 'live',
        message: 'Live State API export completed - using current app settings'
      });
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ 
          success: false, 
          error: 'Invalid request data for Live State API',
          details: error.errors
        });
      } else {
        res.status(500).json({ 
          success: false, 
          error: 'Failed to execute Live State API',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  });


  // Versioned batch export endpoints (v1, v2, v3, v4)
  ['v1', 'v2', 'v3', 'v4'].forEach(version => {
    app.post(`/api/export/batch/${version}`, async (req, res) => {
      try {
        // All versions support the full feature set with defaults
        const requestWithDefaults = {
          exportAllImages: true,
          batchSaveProjectFiles: true,
          ...req.body
        };
        
        // Extract batchConfigSettings before validation (BatchExportSchema doesn't include it)
        const { batchConfigSettings, generationSets, ...exportSettingsInput } = requestWithDefaults;
        
        const validatedSettings = BatchExportSchema.parse(exportSettingsInput);
        
        // Apply migration to batch config settings
        const migratedBatchConfig = batchConfigSettings ? migrateBatchConfigSettings(batchConfigSettings) : undefined;
        
        // Use the same logic as regular batch export
        const mockShapes: any[] = [];
        const mockGroups: any[] = [];
        const mockCanvasSettings = {
          width: 1200,
          height: 800,
          zoom: 1,
          panX: 0,
          panY: 0,
          backgroundColor: validatedSettings.backgroundColor || '#1e293b',
          showGrid: false
        };
        const fallbackBatchConfig = {
          selectedPreset: 'none',
          noiseEnabled: false,
          distributionLayoutEnabled: false,
          propertiesEnabled: true,
        };
        const mockEnabledShapeTypes = new Set(['rectangle', 'circle', 'polygon']);
        
        const mockGenerateShapes = (config: any) => {
          return { shapes: [], groups: [] };
        };
        
        const result = await exportService.startBatchExport(
          mockShapes,
          mockGroups,
          mockCanvasSettings,
          (migratedBatchConfig ?? fallbackBatchConfig) as any,
          mockEnabledShapeTypes,
          validatedSettings,
          mockGenerateShapes
        );
        
        // Note: Project file prioritization happens at the status endpoint when files are available
        // The initial POST response contains empty arrays that will be populated during async processing
        res.json({
          ...result,
          apiVersion: version,
          message: `${version.toUpperCase()} batch export completed`
        });
        
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({ 
            success: false, 
            error: 'Invalid request parameters',
            details: error.errors
          });
        } else {
          res.status(500).json({ 
            success: false, 
            error: `Failed to start ${version.toUpperCase()} batch export`,
            message: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    });
  });

  /**
   * High-Resolution Export Endpoint
   * 
   * Uses Headless Chromium + Sharp for exports that exceed browser canvas limits.
   * Produces 16-bit TIFF with sRGB ICC profiles for professional print quality.
   */
  app.post('/api/export/high-resolution', async (req, res) => {
    // Create AbortController for cancellation on client disconnect
    const abortController = new AbortController();
    let isClientDisconnected = false;
    
    // Listen for client disconnect to abort long-running exports
    req.on('close', () => {
      if (!res.writableEnded) {
        isClientDisconnected = true;
        abortController.abort();
        console.log('[HighRes Export] Client disconnected, aborting export...');
      }
    });
    
    try {
      const validationResult = HighResExportSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: validationResult.error.errors
        });
      }
      
      const request: HighResExportRequest = validationResult.data;
      
      console.log(`[HighRes Export] Starting export: ${request.artboard.width}x${request.artboard.height} @ ${request.exportSettings.dpi || request.artboard.dpi} DPI`);
      console.log(`[HighRes Export] Format: ${request.exportSettings.format}, BitDepth: ${request.exportSettings.bitDepth}`);
      
      // Progress callback for tile rendering (logs to console)
      // Note: Real-time client progress would require SSE streaming (future enhancement)
      const progressCallback = (phase: string, current: number, total: number) => {
        const percent = Math.round((current / total) * 100);
        console.log(`[HighRes Export] Progress: ${phase} (${percent}%)`);
      };
      
      const result = await highResExportService.exportImage(
        request, 
        progressCallback, 
        abortController.signal
      );
      
      // Check if client disconnected during export
      if (isClientDisconnected) {
        console.log('[HighRes Export] Export completed but client disconnected, discarding result');
        if (result.filePath) {
          try { fs.unlinkSync(result.filePath); } catch { /* ignore */ }
        }
        return;
      }
      
      if (!result.success || (!result.buffer && !result.filePath)) {
        return res.status(500).json({
          success: false,
          error: result.error || 'Export failed',
          duration: result.duration
        });
      }
      
      const filename = result.filename || `export-${Date.now()}.${request.exportSettings.format}`;
      
      if (result.filePath && fs.existsSync(result.filePath)) {
        // Tiled export: stream directly from disk — no heap spike for large files
        const stat = fs.statSync(result.filePath);
        res.setHeader('Content-Type', result.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('X-Export-Width', result.width || 0);
        res.setHeader('X-Export-Height', result.height || 0);
        res.setHeader('X-Export-Duration', result.duration || 0);
        console.log(`[HighRes Export] Success: ${filename} (streaming from disk, ${(stat.size / 1024 / 1024).toFixed(2)} MB) in ${result.duration}ms`);
        const filePath = result.filePath;
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        // Use res lifecycle events so the file is deleted on all paths:
        // normal completion (finish), premature client close (close), and read errors.
        let fileDeleted = false;
        const deleteFile = () => {
          if (!fileDeleted) {
            fileDeleted = true;
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
          }
        };
        res.on('finish', deleteFile);
        res.on('close', deleteFile);
        stream.on('error', (err) => { console.error('[HighRes Export] Stream error:', err); deleteFile(); });
      } else if (result.buffer) {
        res.setHeader('Content-Type', result.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', result.buffer.length);
        res.setHeader('X-Export-Width', result.width || 0);
        res.setHeader('X-Export-Height', result.height || 0);
        res.setHeader('X-Export-Duration', result.duration || 0);
        console.log(`[HighRes Export] Success: ${filename} (${(result.buffer.length / 1024 / 1024).toFixed(2)} MB) in ${result.duration}ms`);
        res.send(result.buffer);
      } else {
        return res.status(500).json({ success: false, error: 'Export produced no output' });
      }
      
    } catch (error) {
      // Don't send error response if client already disconnected
      if (isClientDisconnected) {
        console.log('[HighRes Export] Error after client disconnect:', error instanceof Error ? error.message : 'Unknown error');
        return;
      }
      
      console.error('[HighRes Export] Error:', error);
      res.status(500).json({
        success: false,
        error: 'High-resolution export failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * High-Resolution Export Estimate Endpoint
   * 
   * Returns whether server-side export is needed and time/size estimates.
   */
  app.post('/api/export/high-resolution/estimate', (req, res) => {
    try {
      const { artboard, exportSettings } = req.body;
      
      if (!artboard || !artboard.width || !artboard.height) {
        return res.status(400).json({
          success: false,
          error: 'Missing artboard dimensions'
        });
      }
      
      const estimate = highResExportService.getExportEstimate(artboard, exportSettings || {});
      
      res.json({
        success: true,
        ...estimate
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to calculate estimate',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Cleanup endpoint (can be called by cron job)
  app.post('/api/export/cleanup', (req, res) => {
    try {
      exportService.cleanupOldExports();
      projectService.cleanupOldProjects();
      
      res.json({ 
        success: true, 
        message: 'Cleanup completed successfully' 
      });
      
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to cleanup files',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // ===== POLLING JOB ENDPOINTS =====
  // These wrap the existing SSE/tiled pipeline in fire-and-forget jobs so that the
  // client can poll for status instead of holding an SSE connection open.
  // Replit autoscale drops SSE connections at 300 s; polling is immune to that limit.

  /**
   * POST /api/export/job/start
   * Validates the request, creates an SSE session, fires the export pipeline as a
   * fire-and-forget promise, and immediately returns the jobId.
   */
  app.post('/api/export/job/start', async (req, res) => {
    try {
      const validationResult = HighResExportSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: validationResult.error.errors
        });
      }

      const request = validationResult.data;
      const jobId = highResExportService.generateExportId();

      // Initialise in-memory job record
      pollingJobs.set(jobId, {
        jobId,
        status: 'pending',
        progress: 0,
        phase: 'pending',
        message: 'Export queued',
        startTime: Date.now(),
        recentEvents: [],
        nextSeqNo: 0
      });

      // Create SSE session so the existing exportWithSSE / download path works
      highResExportService.createSSESession(jobId);

      // Fire-and-forget – do NOT await; return immediately
      (async () => {
        try {
          await highResExportService.exportWithSSE(
            request as any,
            jobId,
            (event: any) => {
              const job = pollingJobs.get(jobId);
              if (!job) return;

              switch (event.type) {
                case 'phase':
                  job.status = 'processing';
                  job.phase = event.phase ?? 'processing';
                  job.message = event.message ?? event.phase ?? '';
                  break;
                case 'tile': {
                  job.status = 'processing';
                  job.phase = 'tiling';
                  job.message = event.message ?? `Tile ${event.tileIndex}/${event.totalTiles}`;
                  if (typeof event.progressPct === 'number') {
                    job.progress = Math.round(20 + event.progressPct * 0.6);
                  }
                  // Append to ring buffer so polling clients can replay individual tile events
                  const tileEvent: TileProgressEvent = {
                    seqNo: job.nextSeqNo++,
                    tileIndex: event.tileIndex ?? 0,
                    totalTiles: event.totalTiles ?? 0,
                    step: event.step ?? 'render',
                    progressPct: typeof event.progressPct === 'number' ? event.progressPct : 0,
                    message: event.message ?? `Tile ${event.tileIndex}/${event.totalTiles}`
                  };
                  job.recentEvents.push(tileEvent);
                  if (job.recentEvents.length > TILE_EVENT_RING_SIZE) {
                    job.recentEvents.splice(0, job.recentEvents.length - TILE_EVENT_RING_SIZE);
                  }
                  break;
                }
                case 'progress':
                  job.status = 'processing';
                  if (typeof event.progressPct === 'number') {
                    job.progress = Math.round(20 + event.progressPct * 0.6);
                  }
                  job.message = event.status ?? job.message;
                  if (typeof event.estimatedSecondsRemaining === 'number') {
                    job.estimatedRemaining = event.estimatedSecondsRemaining;
                  }
                  break;
                case 'complete':
                  job.status = 'completed';
                  job.progress = 100;
                  job.phase = 'complete';
                  job.message = 'Export complete';
                  job.filename = event.filename;
                  job.sizeBytes = event.sizeBytes;
                  job.downloadUrl = event.downloadUrl;
                  if (event.projectDownloadUrl) job.projectDownloadUrl = event.projectDownloadUrl;
                  if (event.projectFilename) job.projectFilename = event.projectFilename;
                  break;
                case 'error':
                  job.status = 'error';
                  job.phase = 'error';
                  job.message = event.message ?? 'Export failed';
                  job.error = event.message ?? 'Export failed';
                  break;
              }
              pollingJobs.set(jobId, job);
            }
          );
        } catch (err) {
          const job = pollingJobs.get(jobId);
          if (job) {
            job.status = 'error';
            job.phase = 'error';
            job.error = err instanceof Error ? err.message : 'Export failed';
            job.message = job.error;
            pollingJobs.set(jobId, job);
          }
          console.error(`[Job Export] Error for job ${jobId}:`, err);
        }
      })();

      console.log(`[Job Export] Started job: ${jobId}`);

      res.json({
        success: true,
        jobId,
        statusUrl: `/api/export/job/status/${jobId}`,
        downloadUrl: `/api/export/highres/download/${jobId}`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to start export job',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/export/job/status/:jobId
   * Returns the current state of a polling job.
   */
  app.get('/api/export/job/status/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = pollingJobs.get(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    res.json({
      success: true,
      job: {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        phase: job.phase,
        message: job.message,
        error: job.error,
        filename: job.filename,
        sizeBytes: job.sizeBytes,
        downloadUrl: job.downloadUrl,
        projectDownloadUrl: job.projectDownloadUrl,
        projectFilename: job.projectFilename,
        elapsedMs: Date.now() - job.startTime,
        estimatedRemaining: job.estimatedRemaining,
        recentEvents: job.recentEvents
      }
    });

    // Auto-cleanup completed/errored jobs after 10 minutes
    if (job.status === 'completed' || job.status === 'error') {
      setTimeout(() => pollingJobs.delete(jobId), 10 * 60 * 1000);
    }
  });

  // ===== SSE STREAMING EXPORT ENDPOINTS =====

  /**
   * Start SSE High-Resolution Export
   * 
   * Creates an export session and returns the exportId.
   * Client should then connect to the SSE stream endpoint with this exportId.
   */
  app.post('/api/export/highres/start', async (req, res) => {
    try {
      const validationResult = HighResExportSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters',
          details: validationResult.error.errors
        });
      }
      
      // Generate export ID and create session
      const exportId = highResExportService.generateExportId();
      highResExportService.createSSESession(exportId);
      
      // Store the request data for the SSE stream handler
      // Using a temporary in-memory store for pending requests
      pendingSSERequests.set(exportId, validationResult.data);
      
      console.log(`[SSE Export] Session started: ${exportId}`);
      
      // Explicit headers to prevent iOS Safari from treating this JSON as a download
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      
      res.json({
        success: true,
        exportId,
        streamUrl: `/api/export/highres/stream?exportId=${exportId}`,
        downloadUrl: `/api/export/highres/download/${exportId}`
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to start SSE export session',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * SSE Stream Endpoint for High-Resolution Export Progress
   * 
   * Streams real-time progress events during export processing.
   * Events include: phase, tile, progress, complete, error, heartbeat
   */
  app.get('/api/export/highres/stream', async (req, res) => {
    const exportId = req.query.exportId as string;
    
    if (!exportId) {
      return res.status(400).json({
        success: false,
        error: 'Missing exportId parameter'
      });
    }
    
    const session = highResExportService.getSSESession(exportId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Export session not found'
      });
    }
    
    const request = pendingSSERequests.get(exportId);
    if (!request) {
      return res.status(400).json({
        success: false,
        error: 'No pending export request for this session'
      });
    }
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();
    
    // Helper to send SSE event
    const sendEvent = (event: any) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };
    
    // Setup heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      if (!res.writableEnded) {
        sendEvent({ type: 'heartbeat', timestamp: Date.now() });
      }
    }, 5000); // Every 5 seconds — keep connection alive through cloud proxy during long tile renders
    
    // Handle client disconnect
    req.on('close', () => {
      console.log(`[SSE Export] Client disconnected: ${exportId}`);
      clearInterval(heartbeatInterval);
      
      // Cancel the export if still processing
      if (session.status === 'processing') {
        highResExportService.cancelSSESession(exportId);
      }
      
      // Cleanup pending request
      pendingSSERequests.delete(exportId);
    });
    
    // Send initial connection event
    sendEvent({ 
      type: 'phase', 
      phase: 'preparing', 
      message: 'Connected to export stream',
      timestamp: Date.now()
    });
    
    try {
      // Start the export with SSE progress streaming
      await highResExportService.exportWithSSE(
        request as HighResExportRequest,
        exportId,
        (event) => {
          sendEvent(event);
          
          // Close the stream on complete or error
          if (event.type === 'complete' || event.type === 'error') {
            clearInterval(heartbeatInterval);
            pendingSSERequests.delete(exportId);
            res.end();
          }
        }
      );
    } catch (error) {
      clearInterval(heartbeatInterval);
      sendEvent({
        type: 'error',
        message: error instanceof Error ? error.message : 'Export failed',
        timestamp: Date.now()
      });
      pendingSSERequests.delete(exportId);
      res.end();
    }
  });

  /**
   * Download endpoint for SSE exports
   * 
   * After SSE export completes, the file can be downloaded from this endpoint.
   */
  app.get('/api/export/highres/download/:exportId', (req, res) => {
    const { exportId } = req.params;
    
    const session = highResExportService.getSSESession(exportId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Export session not found'
      });
    }
    
    if (session.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: `Export not ready: status is ${session.status}`
      });
    }
    
    const fileData = highResExportService.getExportFileBuffer(exportId);
    if (!fileData) {
      return res.status(404).json({
        success: false,
        error: 'Export file not found'
      });
    }
    
    if (fileData.filePath && fs.existsSync(fileData.filePath)) {
      // Tiled export: stream directly from disk — no heap spike for large files
      const stat = fs.statSync(fileData.filePath);
      res.setHeader('Content-Type', fileData.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileData.filename}"`);
      res.setHeader('Content-Length', stat.size);
      console.log(`[SSE Export] Download: ${exportId} - ${fileData.filename} (streaming from disk, ${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
      const filePath = fileData.filePath;
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      // Use res lifecycle events so the file is deleted on all paths:
      // normal completion (finish), premature client close (close), and read errors.
      let sseFileDeleted = false;
      const scheduleCleanup = () => {
        if (!sseFileDeleted) {
          sseFileDeleted = true;
          try { fs.unlinkSync(filePath); } catch { /* already deleted */ }
          setTimeout(() => highResExportService.cleanupSSESession(exportId), 60000);
        }
      };
      res.on('finish', scheduleCleanup);
      res.on('close', scheduleCleanup);
      stream.on('error', (err) => { console.error('[SSE Export] Stream error:', err); scheduleCleanup(); });
    } else if (fileData.buffer) {
      res.setHeader('Content-Type', fileData.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileData.filename}"`);
      res.setHeader('Content-Length', fileData.buffer.length);
      console.log(`[SSE Export] Download: ${exportId} - ${fileData.filename}`);
      res.send(fileData.buffer);
      setTimeout(() => highResExportService.cleanupSSESession(exportId), 60000);
    } else {
      return res.status(404).json({ success: false, error: 'Export file not found on disk' });
    }
  });

  /**
   * Cancel SSE Export
   * 
   * Cancels an ongoing SSE export session.
   */
  app.delete('/api/export/highres/:exportId', (req, res) => {
    const { exportId } = req.params;
    
    const cancelled = highResExportService.cancelSSESession(exportId);
    pendingSSERequests.delete(exportId);
    
    if (cancelled) {
      res.json({
        success: true,
        message: 'Export cancelled'
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Cannot cancel: export not in progress or not found'
      });
    }
  });

  /**
   * Get SSE Export Session Status
   */
  app.get('/api/export/highres/status/:exportId', (req, res) => {
    const { exportId } = req.params;
    
    const session = highResExportService.getSSESession(exportId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Export session not found'
      });
    }
    
    res.json({
      success: true,
      session: {
        exportId: session.exportId,
        status: session.status,
        startTime: session.startTime,
        downloadUrl: session.downloadUrl,
        filename: session.filename,
        error: session.error,
        dimensions: session.dimensions,
        sizeBytes: session.sizeBytes
      }
    });
  });
}

// In-memory store for pending SSE export requests
const pendingSSERequests = new Map<string, any>();

// ===== In-memory polling job store =====
interface TileProgressEvent {
  seqNo: number;
  tileIndex: number;
  totalTiles: number;
  step: string;
  progressPct: number;
  message: string;
}

const TILE_EVENT_RING_SIZE = 100;

interface PollingJob {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  phase: string;
  message: string;
  error?: string;
  filename?: string;
  sizeBytes?: number;
  downloadUrl?: string;
  projectDownloadUrl?: string;
  projectFilename?: string;
  startTime: number;
  estimatedRemaining?: number;
  recentEvents: TileProgressEvent[];
  nextSeqNo: number;
}
const pollingJobs = new Map<string, PollingJob>();