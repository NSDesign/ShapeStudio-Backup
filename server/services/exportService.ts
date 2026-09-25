import { ImageFormat, ExportOptions } from '../../client/src/lib/imageExport';
import { RENDER_MODE_UTILS_JS } from '../../shared/renderModeUtils';
import { SHAPE_RENDERER_JS } from '../../shared/shapeRenderer';
import { estimateImageMemoryMb, deriveChunkSize } from '../../shared/exportMemoryUtils';
import { ProjectManager } from '../../client/src/lib/projectManager';
import { Shape, ShapeGroupClass } from '../../client/src/lib/shapes';
import { CanvasSettings, Artboard } from '../../client/src/lib/shapeTypes';
import { 
  BatchConfigSettings, 
  EnhancedBatchConfig, 
  GenerationSet, 
  GenerationSetMode, 
  ShapeCountMode,
  ZIndexConfig,
  SupportedShapeType,
  exportJobs,
  InsertExportJob,
  ExportJob,
  SSEExportEvent
} from '../../shared/schema';
import { DEFAULT_BATCH_EXPORT_SETTINGS } from '../../shared/exportSchema';
import JSZip from 'jszip';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { db } from '../db';
import { eq } from 'drizzle-orm';
import { createCanvas, Canvas as NodeCanvas } from 'canvas';
import { renderShape } from '../lib/canvasRenderer';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import sharp from 'sharp';
import { execSync } from 'child_process';

// ── Streaming ZIP helper ──────────────────────────────────────────────────────
// Reads disk files one at a time and builds the zip via 7z (preferred) or
// JSZip (fallback). This keeps peak RAM to a single image buffer rather than
// accumulating every image in memory before writing the archive.
async function buildZipFromDisk(exportDir: string, zipPath: string): Promise<void> {
  const files = fs.readdirSync(exportDir);
  if (files.length === 0) {
    // Write an empty zip so the download endpoint doesn't 404
    const emptyZip = new JSZip();
    const buf = await emptyZip.generateAsync({ type: 'nodebuffer' });
    fs.writeFileSync(zipPath, buf);
    return;
  }

  // --- Try 7z first (no JS heap overhead) -----------------------------------
  // 7z is available on the Replit/NixOS sandbox; the binary may be at a
  // Nix store path or on PATH as '7z'.
  const candidates = [
    '7z',
    '/nix/store/j6yz1h0i58a3i54szjv40mdz4gssb391-p7zip-17.05/bin/7z',
    '/usr/bin/7z',
    '/usr/local/bin/7z',
  ];
  for (const bin of candidates) {
    try {
      // Run from exportDir so files are stored with just their basename in the zip
      const result = spawnSync(bin, ['a', '-tzip', '-y', zipPath, ...files], {
        cwd: exportDir,
        maxBuffer: 64 * 1024 * 1024,
      });
      if (result.status === 0) {
        console.log(`[buildZipFromDisk] Created zip with ${bin}: ${zipPath}`);
        return; // success
      }
      console.warn(`[buildZipFromDisk] ${bin} exited with status ${result.status}`);
    } catch {
      // binary not found — try next candidate
    }
  }

  // --- Fallback: JSZip reading from disk one file at a time -----------------
  // This still loads all encoded image bytes into the JSZip object before
  // calling generateAsync, but the canvas render buffers are already freed
  // (they were written to disk), so peak RAM is much lower than the old path.
  console.warn('[buildZipFromDisk] 7z unavailable — falling back to JSZip disk-read');
  const zip = new JSZip();
  for (const filename of files) {
    const filePath = path.join(exportDir, filename);
    let buf = fs.readFileSync(filePath);
    zip.file(filename, buf);
    // release the read buffer immediately after adding to zip
    buf = null as any;
  }
  const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(zipPath, zipBuf);
  console.log(`[buildZipFromDisk] Created zip with JSZip fallback: ${zipPath}`);
}

export interface BatchExportSettings {
  // Format and quality
  format: ImageFormat;
  quality?: number; // 1-100 for lossy formats
  
  // Scale and dimensions  
  scale?: number;
  scope?: 'all' | 'artboard'; // Export mode: 'all' = fit to all shapes, 'artboard' = use artboard bounds
  useCustomSize?: boolean;
  customWidth?: number;
  customHeight?: number;
  
  // Background control
  includeBackground?: boolean;
  backgroundColor?: string;
  
  // Margins
  useMargins?: boolean;
  uniformMargins?: boolean;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  
  // Batch-specific settings
  batchExportCount: number;
  batchSaveProjectFiles?: boolean;
  packageAsZip?: boolean; // New: Whether to package files in ZIP (default: false)
  
  // Additional options
  includeAdornments?: boolean;
  includeGrid?: boolean;
  includeArtboardGeometry?: boolean;
  
  // Naming
  filename?: string;
  customPrefix?: string;
  includeTypeInName?: boolean;
}

export interface ExportProgress {
  exportId: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number; // 0-100
  currentStep: string;
  imagesCompleted: number;
  totalImages: number;
  estimatedTimeRemaining?: number;
  errorMessage?: string;
  downloadPath?: string;
  chunkIndex?: number;
  chunkCount?: number;
}

export interface BatchExportResult {
  success: boolean;
  exportId: string;
  estimatedDuration: number;
  totalImages: number;
  downloadUrl?: string; // Only present if packageAsZip is true
  imageFiles?: Array<{
    filename: string;
    url: string;
    index: number;
  }>;
  projectFiles?: Array<{
    filename: string;
    url: string;
    index: number;
  }>;
}

// Enhanced batch export result for generation sets
export interface EnhancedBatchExportResult extends BatchExportResult {
  mode: GenerationSetMode;
  generationSetsProcessed?: number;
  totalGenerationSets?: number;
}

export class ExportService {
  private activeExports = new Map<string, ExportProgress>();
  private exportResults = new Map<string, string>(); // exportId -> file path
  private individualFiles = new Map<string, { imageFiles: any[], projectFiles: any[] }>(); // exportId -> file arrays
  private exportSettings = new Map<string, { batchSaveProjectFiles: boolean, exportAllImages: boolean, selectedImageIndices: number[] }>(); // exportId -> request settings
  
  constructor() {
    // Ensure exports directory exists
    const exportsDir = path.join(process.cwd(), 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }
  }

  generateExportId(): string {
    return `export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getDefaultBatchSettings(): BatchExportSettings {
    // Use shared defaults to ensure consistency across the application
    return DEFAULT_BATCH_EXPORT_SETTINGS;
  }

  mergeBatchSettings(userSettings: Partial<BatchExportSettings>): BatchExportSettings {
    const defaults = this.getDefaultBatchSettings();
    return { ...defaults, ...userSettings };
  }

  /**
   * Render shapes to a node-canvas Canvas
   * @param shapes - Array of shapes to render
   * @param canvasSettings - Canvas dimensions and settings
   * @param exportOptions - Export options including background, margins, scale
   * @returns Canvas with rendered shapes
   */
  private renderShapesToCanvas(
    shapes: Shape[],
    canvasSettings: CanvasSettings,
    exportOptions: ExportOptions
  ): NodeCanvas {
    // Calculate canvas dimensions with scale and margins
    const scale = exportOptions.scale || 1;
    const margins = exportOptions.margins || { top: 0, right: 0, bottom: 0, left: 0 };
    
    // Calculate bounds of all content to export
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    // Use artboard bounds if provided (for artboard exports)
    if (exportOptions.artboardBounds) {
      minX = exportOptions.artboardBounds.x;
      minY = exportOptions.artboardBounds.y;
      maxX = exportOptions.artboardBounds.x + exportOptions.artboardBounds.width;
      maxY = exportOptions.artboardBounds.y + exportOptions.artboardBounds.height;
      console.log(`[ExportService] Using artboard bounds: ${minX},${minY} to ${maxX},${maxY}`);
    } else {
      // Get bounds of all shapes
      shapes.forEach(shape => {
        const bounds = shape.getBounds();
        minX = Math.min(minX, bounds.x);
        minY = Math.min(minY, bounds.y);
        maxX = Math.max(maxX, bounds.x + bounds.width);
        maxY = Math.max(maxY, bounds.y + bounds.height);
      });
      
      // If no valid bounds found after checking all content, use a minimal default
      if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
        minX = 0;
        minY = 0;
        maxX = 100;
        maxY = 100;
      }
      console.log(`[ExportService] Calculated bounds from ${shapes.length} shapes: ${minX},${minY} to ${maxX},${maxY}`);
    }
    
    // Calculate content dimensions
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    
    // Use custom size if specified, otherwise use calculated content dimensions
    const baseWidth = exportOptions.width || contentWidth;
    const baseHeight = exportOptions.height || contentHeight;
    
    // Apply margins and scale
    const canvasWidth = (baseWidth + margins.left + margins.right) * scale;
    const canvasHeight = (baseHeight + margins.top + margins.bottom) * scale;
    
    console.log(`[ExportService] Creating canvas: ${canvasWidth}x${canvasHeight} (base: ${baseWidth}x${baseHeight}, scale: ${scale})`);
    console.log(`[ExportService] Rendering ${shapes.length} shapes`);
    
    // Create canvas
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      throw new Error('Failed to get 2D context from canvas');
    }
    
    // Apply scale
    ctx.scale(scale, scale);
    
    // Translate for margins and to move content origin to (0,0)
    ctx.translate(margins.left - minX, margins.top - minY);
    
    // Draw background if requested
    if (exportOptions.includeBackground && exportOptions.backgroundColor) {
      console.log(`[ExportService] Drawing background: ${exportOptions.backgroundColor}`);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
      ctx.fillStyle = exportOptions.backgroundColor;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.restore();
    }
    
    // Sort shapes by z-index for proper layering
    const sortedShapes = [...shapes].sort((a, b) => (a.properties.zIndex || 0) - (b.properties.zIndex || 0));
    
    // Render each shape
    for (let i = 0; i < sortedShapes.length; i++) {
      const shape = sortedShapes[i];
      console.log(`[ExportService] Rendering shape ${i + 1}/${sortedShapes.length}: type=${shape.type}, points=${shape.points?.length || 0}`);
      
      if (!shape.points || shape.points.length === 0) {
        console.warn(`[ExportService] Shape ${shape.type} has no points, skipping`);
        continue;
      }
      
      // Cast to server Shape type - they're compatible in structure
      renderShape(ctx, shape as any, !exportOptions.includeAdornments);
    }
    
    console.log('[ExportService] Canvas rendering complete');
    return canvas;
  }

  /**
   * Apply export options to a pre-composited canvas
   * This preserves blend modes and compositing while applying margins, bounds, backgrounds, etc.
   * @param sourceCanvas - The pre-composited canvas from generation sets
   * @param shapes - Array of shapes (for bounds calculation)
   * @param canvasSettings - Canvas dimensions
   * @param exportOptions - Export options to apply
   * @returns New canvas with export options applied
   */
  private applyExportOptionsToCanvas(
    sourceCanvas: NodeCanvas,
    shapes: Shape[],
    canvasSettings: CanvasSettings,
    exportOptions: ExportOptions
  ): NodeCanvas {
    const scale = exportOptions.scale || 1;
    const margins = exportOptions.margins || { top: 0, right: 0, bottom: 0, left: 0 };
    
    // Calculate bounds (same logic as renderShapesToCanvas)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    if (exportOptions.artboardBounds) {
      minX = exportOptions.artboardBounds.x;
      minY = exportOptions.artboardBounds.y;
      maxX = exportOptions.artboardBounds.x + exportOptions.artboardBounds.width;
      maxY = exportOptions.artboardBounds.y + exportOptions.artboardBounds.height;
      console.log(`[ExportService] Using artboard bounds for composited canvas: ${minX},${minY} to ${maxX},${maxY}`);
    } else {
      // Get bounds of all shapes
      shapes.forEach(shape => {
        const bounds = shape.getBounds();
        minX = Math.min(minX, bounds.x);
        minY = Math.min(minY, bounds.y);
        maxX = Math.max(maxX, bounds.x + bounds.width);
        maxY = Math.max(maxY, bounds.y + bounds.height);
      });
      
      if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
        minX = 0;
        minY = 0;
        maxX = 100;
        maxY = 100;
      }
      console.log(`[ExportService] Calculated bounds for composited canvas from ${shapes.length} shapes: ${minX},${minY} to ${maxX},${maxY}`);
    }
    
    // Calculate content dimensions
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    
    // Use custom size if specified, otherwise use calculated content dimensions
    const baseWidth = exportOptions.width || contentWidth;
    const baseHeight = exportOptions.height || contentHeight;
    
    // Apply margins and scale
    const canvasWidth = (baseWidth + margins.left + margins.right) * scale;
    const canvasHeight = (baseHeight + margins.top + margins.bottom) * scale;
    
    console.log(`[ExportService] Creating final export canvas: ${canvasWidth}x${canvasHeight} (base: ${baseWidth}x${baseHeight}, scale: ${scale})`);
    
    // Create final export canvas
    const exportCanvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = exportCanvas.getContext('2d');
    
    if (!ctx) {
      throw new Error('Failed to get 2D context from export canvas');
    }
    
    // Apply scale
    ctx.scale(scale, scale);
    
    // Translate for margins and to move content origin to (0,0) - same as renderShapesToCanvas
    ctx.translate(margins.left - minX, margins.top - minY);
    
    // Draw background if requested
    if (exportOptions.includeBackground && exportOptions.backgroundColor) {
      console.log(`[ExportService] Drawing background: ${exportOptions.backgroundColor}`);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
      ctx.fillStyle = exportOptions.backgroundColor;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.restore();
    }
    
    // Draw the pre-composited canvas at the origin
    // The sourceCanvas is centered at (width/2, height/2) from processGenerationSets
    // We need to draw it so that shapes at (minX, minY) appear at our origin
    ctx.drawImage(sourceCanvas, 0, 0);
    
    console.log('[ExportService] Applied export options to composited canvas');
    return exportCanvas;
  }

  /**
   * Convert canvas to image buffer with format support
   * @param canvas - The canvas to convert
   * @param format - Image format (png, jpeg, webp, etc.)
   * @param quality - Quality for lossy formats (0-1)
   * @returns Buffer containing image data
   */
  private canvasToBuffer(
    canvas: NodeCanvas,
    format: ImageFormat,
    quality: number = 0.92
  ): Buffer {
    const formatLower = format.toLowerCase();
    
    // node-canvas supports PNG and JPEG reliably
    if (formatLower === 'jpeg' || formatLower === 'jpg') {
      const buffer = canvas.toBuffer('image/jpeg', { quality });
      console.log(`[ExportService] Generated JPEG buffer, size: ${buffer.length} bytes`);
      return buffer;
    }
    
    // All other formats default to PNG
    // (WebP, AVIF, BMP not widely supported in node-canvas)
    if (formatLower !== 'png') {
      console.warn(`Format ${format} not fully supported, using PNG`);
    }
    
    const buffer = canvas.toBuffer('image/png');
    console.log(`[ExportService] Generated PNG buffer, size: ${buffer.length} bytes`);
    
    // Validate PNG header (PNG signature: 89 50 4E 47 0D 0A 1A 0A)
    if (buffer.length < 8) {
      console.error('[ExportService] PNG buffer too small:', buffer.length);
      throw new Error('Generated PNG buffer is too small');
    }
    
    const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const bufferSignature = buffer.slice(0, 8);
    
    if (!bufferSignature.equals(pngSignature)) {
      console.error('[ExportService] Invalid PNG signature:', bufferSignature);
      console.error('[ExportService] Expected:', pngSignature);
      console.error('[ExportService] Buffer preview (first 50 bytes):', buffer.slice(0, 50));
      throw new Error('Generated buffer does not have valid PNG signature');
    }
    
    console.log('[ExportService] PNG buffer validated successfully');
    return buffer;
  }

  // Legacy method for backward compatibility
  async startBatchExport(
    shapes: Shape[],
    groups: ShapeGroupClass[],
    canvasSettings: CanvasSettings,
    batchConfigSettings: BatchConfigSettings,
    enabledShapeTypes: Set<string>,
    userSettings: Partial<BatchExportSettings> & { exportAllImages?: boolean, selectedImageIndices?: number[] },
    generateShapesFunction: (config: any) => { shapes: Shape[], groups: ShapeGroupClass[] },
    userId?: string,
    generationSetsMetadata?: {
      generationSets?: any[];
      exportSettings?: any;
      artboardSettings?: any;
    }
  ): Promise<BatchExportResult>;
  
  // New enhanced method for generation sets
  async startBatchExport(
    shapes: Shape[],
    groups: ShapeGroupClass[],
    canvasSettings: CanvasSettings,
    enhancedConfig: EnhancedBatchConfig,
    enabledShapeTypes: Set<string>,
    userSettings: Partial<BatchExportSettings> & { exportAllImages?: boolean, selectedImageIndices?: number[] },
    generateShapesFunction: (config: any, enabledTypes?: Set<SupportedShapeType>) => { shapes: Shape[], groups: ShapeGroupClass[] },
    userId?: string
  ): Promise<EnhancedBatchExportResult>;
  
  // Implementation with overload handling
  async startBatchExport(
    shapes: Shape[],
    groups: ShapeGroupClass[],
    canvasSettings: CanvasSettings,
    configSettings: BatchConfigSettings | EnhancedBatchConfig,
    enabledShapeTypes: Set<string>,
    userSettings: Partial<BatchExportSettings> & { exportAllImages?: boolean, selectedImageIndices?: number[] },
    generateShapesFunction: (config: any, enabledTypes?: Set<SupportedShapeType>) => { shapes: Shape[], groups: ShapeGroupClass[] },
    userId: string = 'dev-user',
    generationSetsMetadata?: {
      generationSets?: any[];
      exportSettings?: any;
      artboardSettings?: any;
    }
  ): Promise<BatchExportResult | EnhancedBatchExportResult> {
    // Detect configuration type and delegate to appropriate handler
    const isEnhanced = this.isEnhancedBatchConfig(configSettings);
    
    if (isEnhanced) {
      return this.startEnhancedBatchExport(
        shapes,
        groups,
        canvasSettings,
        configSettings as EnhancedBatchConfig,
        enabledShapeTypes,
        userSettings,
        generateShapesFunction,
        userId
      );
    } else {
      return this.startLegacyBatchExport(
        shapes,
        groups,
        canvasSettings,
        configSettings as BatchConfigSettings,
        enabledShapeTypes,
        userSettings,
        generateShapesFunction,
        userId,
        generationSetsMetadata
      );
    }
  }

  private async processBatchExport(
    exportId: string,
    baseShapes: Shape[],
    baseGroups: ShapeGroupClass[],
    canvasSettings: CanvasSettings,
    batchConfigSettings: BatchConfigSettings,
    enabledShapeTypes: Set<string>,
    settings: BatchExportSettings,
    generateShapesFunction: (config: any) => { shapes: Shape[], groups: ShapeGroupClass[] },
    generationSetsMetadata?: {
      generationSets?: any[];
      exportSettings?: any;
      artboardSettings?: any;
    }
  ): Promise<void> {
    const progress = this.activeExports.get(exportId)!;
    
    try {
      progress.status = 'processing';
      progress.currentStep = settings.packageAsZip ? 'Creating ZIP archive...' : 'Creating individual files...';
      this.activeExports.set(exportId, progress);
      await this.updateExportJobProgress(exportId, progress);
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      
      // Initialize tracking for individual files
      const imageFiles: any[] = [];
      const projectFiles: any[] = [];
      
      // Create export directory for this batch
      const exportDir = path.join(process.cwd(), 'exports', exportId);
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }
      
      // Files are always written to disk immediately to avoid accumulating large PNG
      // buffers in RAM.  The OS zip command assembles the archive at the end.

      // Derive chunk size for batch throttling using effective render dimensions
      // (custom size OR base canvas × export scale) and worst-case bit depth for the format
      const _effScale = settings.useCustomSize ? 1 : (settings.scale || 1);
      const _imgW = Math.round((settings.useCustomSize ? (settings.customWidth || canvasSettings.width) : canvasSettings.width) * _effScale);
      const _imgH = Math.round((settings.useCustomSize ? (settings.customHeight || canvasSettings.height) : canvasSettings.height) * _effScale);
      const _bitDepth = settings.format === 'tiff' ? 16 : 8;
      const _memPerImg = estimateImageMemoryMb(_imgW, _imgH, _bitDepth, settings.format || 'png');
      const _chunkSize = deriveChunkSize(_memPerImg);
      const _totalImages = settings.batchExportCount;
      const _chunkCount = Math.ceil(_totalImages / _chunkSize);
      
      // Calculate total steps for progress tracking
      const baseSteps = settings.batchExportCount * 2; // 2 steps per image
      const finalSteps = 2; // zip/finalize step + completion
      const totalSteps = baseSteps + finalSteps;
      let currentStep = 0;
      let failedCount = 0;
      
      // Process in chunk windows — each window writes every image to disk before the next begins
      for (let chunkIdx = 0; chunkIdx < _chunkCount; chunkIdx++) {
        const chunkStart = chunkIdx * _chunkSize;
        const chunkEnd = Math.min(chunkStart + _chunkSize, _totalImages);
        const chunkLabel = _chunkCount > 1 ? ` [Chunk ${chunkIdx + 1}/${_chunkCount}]` : '';
        progress.chunkIndex = chunkIdx + 1;
        progress.chunkCount = _chunkCount;
      for (let i = chunkStart; i < chunkEnd; i++) {
        // Update progress
        progress.currentStep = `Generating artwork ${i + 1} of ${_totalImages}${chunkLabel}`;
        progress.progress = Math.round((currentStep / totalSteps) * 100);
        this.activeExports.set(exportId, progress);
        await this.updateExportJobProgress(exportId, progress);
        
        try {
        // Generate shapes for this iteration
        const generationResult = generateShapesFunction(batchConfigSettings) as any;
        const { shapes: currentShapes, groups: currentGroups, compositedCanvas } = generationResult;
        currentStep++;
        
        // Export image
        progress.currentStep = `Exporting image ${i + 1} of ${_totalImages}${chunkLabel}`;
        progress.progress = Math.round((currentStep / totalSteps) * 100);
        this.activeExports.set(exportId, progress);
        await this.updateExportJobProgress(exportId, progress);
        
        // Build export options
        const exportOptions: ExportOptions = {
          format: settings.format,
          quality: settings.quality ? settings.quality / 100 : 0.92,
          scale: settings.scale || 1,
          backgroundColor: settings.backgroundColor,
          includeBackground: settings.includeBackground,
          includeAdornments: settings.includeAdornments,
          includeGrid: settings.includeGrid,
          includeArtboardGeometry: settings.includeArtboardGeometry,
          margins: settings.useMargins ? {
            top: settings.marginTop || 0,
            right: settings.marginRight || 0,
            bottom: settings.marginBottom || 0,
            left: settings.marginLeft || 0
          } : undefined
        };
        
        // Set artboard bounds if scope is 'artboard'
        if (settings.scope === 'artboard') {
          exportOptions.artboardBounds = {
            x: -(canvasSettings.width / 2),
            y: -(canvasSettings.height / 2),
            width: canvasSettings.width,
            height: canvasSettings.height
          };
        }
        
        if (settings.useCustomSize && settings.customWidth && settings.customHeight) {
          exportOptions.width = settings.customWidth;
          exportOptions.height = settings.customHeight;
        }
        
        let imageBuffer: Buffer;
        
        // CRITICAL FIX: If generation sets returned a pre-composited canvas, use it as source
        // but still apply export options (margins, bounds, background) for parity
        if (compositedCanvas) {
          console.log(`[ExportService] Using pre-composited canvas from generation sets with export options applied`);
          const finalCanvas = this.applyExportOptionsToCanvas(compositedCanvas, currentShapes, canvasSettings, exportOptions);
          imageBuffer = this.canvasToBuffer(finalCanvas, settings.format, exportOptions.quality);
        } else {
          // Normal flow: render shapes to canvas
          const canvas = this.renderShapesToCanvas(currentShapes, canvasSettings, exportOptions);
          imageBuffer = this.canvasToBuffer(canvas, settings.format, exportOptions.quality);
        }
        
        // Generate filename
        const filename = this.generateBatchFilename(settings, i + 1);
        const imageFilename = `${filename}.${settings.format}`;
        
        // Always write to disk immediately — never buffer large images in RAM
        {
          const imagePath = path.join(exportDir, imageFilename);
          fs.writeFileSync(imagePath, imageBuffer);
          imageFiles.push({
            filename: imageFilename,
            url: `/api/export/files/${exportId}/${imageFilename}`,
            index: i + 1
          });
        }
        
        // Save project file if requested (minimal schema: shapes + artboard only)
        if (settings.batchSaveProjectFiles) {
          const projectData: any = {
            version: '1.0.0',
            type: 'generated',
            timestamp: new Date().toISOString(),
            name: filename,
            shapes: currentShapes.map((shape: Shape) => this.serializeShape(shape)),
            ...(currentGroups && currentGroups.length > 0 && { 
              groups: currentGroups.map((group: ShapeGroupClass) => this.serializeGroup(group)) 
            }),
            artboard: {
              width: canvasSettings.width || 1200,
              height: canvasSettings.height || 800,
              backgroundColor: canvasSettings.backgroundColor || '#ffffff'
            }
          };
          
          const projectJson = JSON.stringify(projectData, null, 2);
          const projectFilename = `${filename}.generated.json`;
          
          // Always write to disk immediately
          const projectPath = path.join(exportDir, projectFilename);
          fs.writeFileSync(projectPath, projectJson);
          projectFiles.push({
            filename: projectFilename,
            url: `/api/export/files/${exportId}/${projectFilename}`,
            index: i + 1
          });
        }
        
        progress.imagesCompleted = imageFiles.length;
        currentStep++;
        await this.updateExportJobProgress(exportId, progress);
        } catch (imageErr) {
          console.error(`[ExportService] Image ${i + 1} failed, skipping: ${imageErr instanceof Error ? imageErr.message : imageErr}`);
          currentStep += 2;
          failedCount++;
        }
      } // end inner image loop
      // Chunk boundary: release canvas buffers before starting the next window
      if (typeof global.gc === 'function') { global.gc(); }
      } // end outer chunk loop
      
      if (imageFiles.length === 0) {
        throw new Error(`All ${settings.batchExportCount} images failed to export`);
      }
      if (failedCount > 0) {
        console.log(`[ExportService] Partial export: ${imageFiles.length} of ${settings.batchExportCount} images completed successfully`);
      }
      
      // Packaging: chunkSize==1 means memory-constrained → individual files (no ZIP).
      // chunkSize>1 with multiple outputs → ZIP only when user hasn't opted out.
      const _autoZip = _chunkSize > 1 && imageFiles.length > 1 && settings.packageAsZip !== false;
      if (_autoZip) {
        progress.currentStep = 'Creating ZIP file...';
        progress.progress = Math.round((currentStep / totalSteps) * 100);
        this.activeExports.set(exportId, progress);
        await this.updateExportJobProgress(exportId, progress);
        
        const zipFilename = `batch-export-${timestamp}.zip`;
        const zipPath = path.join(process.cwd(), 'exports', zipFilename);
        await buildZipFromDisk(exportDir, zipPath);
        try { fs.rmSync(exportDir, { recursive: true, force: true }); } catch {}
        
        progress.status = 'completed';
        progress.progress = 100;
        progress.currentStep = `ZIP export completed (${imageFiles.length} files)`;
        progress.downloadPath = zipPath;
        this.activeExports.set(exportId, progress);
        this.exportResults.set(exportId, zipPath);
        
        await this.updateExportJobResults(exportId, {
          downloadUrl: `/api/export/download/${exportId}`,
          downloadPath: zipPath,
          packageType: 'zip'
        });
        await this.updateExportJobProgress(exportId, progress);
      } else {
        // Single file — deliver directly without ZIP wrapper
        progress.status = 'completed';
        progress.progress = 100;
        progress.currentStep = 'Export completed successfully';
        this.activeExports.set(exportId, progress);
        
        this.individualFiles.set(exportId, { imageFiles, projectFiles });
        
        await this.updateExportJobResults(exportId, {
          imageFiles,
          projectFiles,
          packageType: 'individual'
        });
        await this.updateExportJobProgress(exportId, progress);
      }
      
    } catch (error) {
      progress.status = 'error';
      progress.errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      this.activeExports.set(exportId, progress);
      
      // Update database with error status
      await this.updateExportJobProgress(exportId, progress);
    }
  }

  private generateBatchFilename(settings: BatchExportSettings, index: number): string {
    const parts = [];
    
    if (settings.customPrefix) {
      // Sanitize custom prefix to prevent path traversal
      const sanitizedPrefix = this.sanitizeFilename(settings.customPrefix);
      if (sanitizedPrefix) {
        parts.push(sanitizedPrefix);
      }
    }
    
    if (settings.filename?.trim()) {
      // Sanitize filename to prevent path traversal
      const sanitizedFilename = this.sanitizeFilename(settings.filename.trim());
      if (sanitizedFilename) {
        parts.push(sanitizedFilename);
      } else {
        parts.push('batch-export'); // Fallback if sanitization removes everything
      }
    } else {
      parts.push('batch-export');
    }
    
    // Add index with zero-padding
    const paddedIndex = index.toString().padStart(3, '0');
    parts.push(paddedIndex);
    
    return parts.join('-');
  }

  // Sanitize filename to prevent path traversal attacks and ensure valid filenames
  private sanitizeFilename(input: string): string {
    if (!input || typeof input !== 'string') {
      return '';
    }
    
    // Remove null bytes and control characters
    let sanitized = input.replace(/[\x00-\x1f\x80-\x9f]/g, '');
    
    // Remove path traversal sequences
    sanitized = sanitized.replace(/\.\./g, '');
    
    // Remove path separators and dangerous characters
    sanitized = sanitized.replace(/[\\\/:|*?"<>]/g, '');
    
    // Replace multiple spaces/dashes with single dash
    sanitized = sanitized.replace(/[\s\-]+/g, '-');
    
    // Remove leading/trailing dashes and dots
    sanitized = sanitized.replace(/^[\-\.]+|[\-\.]+$/g, '');
    
    // Limit length to prevent filesystem issues
    sanitized = sanitized.substring(0, 100);
    
    // Ensure it's not empty and doesn't start with a dot
    if (!sanitized || sanitized.startsWith('.')) {
      return '';
    }
    
    return sanitized;
  }

  private calculateEstimatedDuration(batchCount: number): number {
    // Estimate 2-3 seconds per image for processing
    return Math.ceil(batchCount * 2.5);
  }

  private serializeShape(shape: Shape): any {
    return {
      id: shape.id,
      type: shape.type,
      transform: shape.transform,
      properties: shape.properties,
      points: shape.points,
      sides: shape.sides,
      radius: shape.radius,
      innerRadius: shape.innerRadius,
      width: shape.width,
      height: shape.height,
      controlPoints: shape.controlPoints,
      closed: shape.closed
    };
  }

  private serializeGroup(group: ShapeGroupClass): any {
    return {
      id: group.id,
      shapes: group.shapes.map(shape => this.serializeShape(shape)),
      transform: group.transform
    };
  }

  async getExportStatus(exportId: string): Promise<ExportProgress | null> {
    // Try in-memory cache first for performance
    const cached = this.activeExports.get(exportId);
    if (cached) {
      return cached;
    }
    
    // Query from database
    try {
      const [job] = await db.select().from(exportJobs).where(eq(exportJobs.exportId, exportId));
      
      if (!job) {
        return null;
      }
      
      // Convert database record to ExportProgress format
      const progress = job.progress as any;
      const results = job.results as any;
      
      const exportProgress: ExportProgress = {
        exportId: job.exportId,
        status: job.status as any,
        progress: progress?.progress || 0,
        currentStep: progress?.currentStep || '',
        imagesCompleted: progress?.imagesCompleted || 0,
        totalImages: progress?.totalImages || 0,
        estimatedTimeRemaining: progress?.estimatedTimeRemaining,
        errorMessage: job.error || undefined,
        downloadPath: results?.downloadUrl || results?.downloadPath
      };
      
      // Cache it for future requests
      this.activeExports.set(exportId, exportProgress);
      
      return exportProgress;
    } catch (error) {
      console.error(`[ExportService] Error fetching export status from database:`, error);
      return null;
    }
  }

  /**
   * Create a new export job in the database
   */
  private async createExportJob(
    exportId: string,
    userId: string,
    progress: ExportProgress,
    config: any
  ): Promise<void> {
    try {
      await db.insert(exportJobs).values({
        exportId,
        userId,
        status: progress.status,
        progress: {
          progress: progress.progress,
          currentStep: progress.currentStep,
          imagesCompleted: progress.imagesCompleted,
          totalImages: progress.totalImages,
          estimatedTimeRemaining: progress.estimatedTimeRemaining
        },
        config,
        results: null,
        error: progress.errorMessage || null
      });
      
      console.log(`[ExportService] Created export job in database: ${exportId}`);
    } catch (error) {
      console.error(`[ExportService] Error creating export job in database:`, error);
    }
  }

  /**
   * Update export job progress in the database
   */
  private async updateExportJobProgress(
    exportId: string,
    progress: ExportProgress
  ): Promise<void> {
    try {
      await db.update(exportJobs)
        .set({
          status: progress.status,
          progress: {
            progress: progress.progress,
            currentStep: progress.currentStep,
            imagesCompleted: progress.imagesCompleted,
            totalImages: progress.totalImages,
            estimatedTimeRemaining: progress.estimatedTimeRemaining
          },
          error: progress.errorMessage || null,
          completedAt: progress.status === 'completed' || progress.status === 'error' ? new Date() : null
        })
        .where(eq(exportJobs.exportId, exportId));
    } catch (error) {
      console.error(`[ExportService] Error updating export job progress in database:`, error);
    }
  }

  /**
   * Update export job results in the database
   */
  private async updateExportJobResults(
    exportId: string,
    results: any
  ): Promise<void> {
    try {
      await db.update(exportJobs)
        .set({
          results,
          status: 'completed',
          completedAt: new Date()
        })
        .where(eq(exportJobs.exportId, exportId));
    } catch (error) {
      console.error(`[ExportService] Error updating export job results in database:`, error);
    }
  }

  async getExportFile(exportId: string): Promise<string | null> {
    // First check in-memory cache for backwards compatibility
    const cachedPath = this.exportResults.get(exportId);
    if (cachedPath) {
      return cachedPath;
    }

    // Query database for export job
    try {
      const [exportJob] = await db
        .select()
        .from(exportJobs)
        .where(eq(exportJobs.exportId, exportId))
        .limit(1);

      if (!exportJob || !exportJob.results) {
        return null;
      }

      // Extract downloadPath from results JSONB column
      const results = exportJob.results as any;
      const downloadPath = results?.downloadPath;

      if (downloadPath && fs.existsSync(downloadPath)) {
        return downloadPath;
      }

      return null;
    } catch (error) {
      console.error(`[ExportService] Error fetching export file from database:`, error);
      return null;
    }
  }

  getIndividualFiles(exportId: string): { imageFiles: any[], projectFiles: any[] } | null {
    return this.individualFiles.get(exportId) || null;
  }

  getExportSettings(exportId: string): { batchSaveProjectFiles: boolean, exportAllImages: boolean, selectedImageIndices: number[] } | null {
    return this.exportSettings.get(exportId) || null;
  }

  getIndividualFile(exportId: string, filename: string): string | null {
    // Validate input parameters
    if (!exportId || !filename) {
      return null;
    }
    
    // Sanitize filename to prevent path traversal
    const sanitizedFilename = this.sanitizeFilename(filename);
    if (!sanitizedFilename) {
      return null;
    }
    
    const exportDir = path.join(process.cwd(), 'exports', exportId);
    const resolvedExportDir = path.resolve(exportDir);
    const requestedPath = path.resolve(exportDir, sanitizedFilename);
    
    // Critical security check: Ensure the resolved path is within the export directory
    if (!requestedPath.startsWith(resolvedExportDir + path.sep) && requestedPath !== resolvedExportDir) {
      return null;
    }
    
    // Additional security: Only allow access to files we've actually tracked
    const trackedFiles = this.individualFiles.get(exportId);
    if (trackedFiles) {
      const isTrackedFile = [
        ...trackedFiles.imageFiles.map(f => f.filename),
        ...trackedFiles.projectFiles.map(f => f.filename)
      ].includes(sanitizedFilename);
      
      if (!isTrackedFile) {
        return null;
      }
    }
    
    // Final check: file exists and is within bounds
    if (fs.existsSync(requestedPath)) {
      return requestedPath;
    }
    
    return null;
  }

  cleanupOldExports(): void {
    // Clean up exports older than 24 hours
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
    
    for (const [exportId, progress] of Array.from(this.activeExports.entries())) {
      const timestamp = parseInt(exportId.split('_')[1]);
      if (timestamp < cutoffTime) {
        // Remove from tracking
        this.activeExports.delete(exportId);
        
        // Delete file if it exists
        const filePath = this.exportResults.get(exportId);
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        this.exportResults.delete(exportId);
        
        // Clean up individual files tracking and export settings
        this.individualFiles.delete(exportId);
        this.exportSettings.delete(exportId);
        
        // Clean up export directory
        const exportDir = path.join(process.cwd(), 'exports', exportId);
        if (fs.existsSync(exportDir)) {
          fs.rmSync(exportDir, { recursive: true, force: true });
        }
      }
    }
  }

  // Helper method to detect if config is EnhancedBatchConfig with robust runtime validation
  private isEnhancedBatchConfig(config: any): config is EnhancedBatchConfig {
    if (!config || typeof config !== 'object') {
      return false;
    }
    
    // Check for required EnhancedBatchConfig properties
    if (!('mode' in config)) {
      return false;
    }
    
    // Validate mode value using string comparison (more reliable than enum check)
    const validModes = ['single', 'multi'] as const;
    if (!validModes.includes(config.mode)) {
      return false;
    }
    
    // Check for generationSets array (required for enhanced config)
    if (!('generationSets' in config) || !Array.isArray(config.generationSets)) {
      return false;
    }
    
    // Check for globalSettings object
    if (!('globalSettings' in config) || typeof config.globalSettings !== 'object') {
      return false;
    }
    
    // For single mode, legacyBatchConfig should be present
    if (config.mode === 'single' && !('legacyBatchConfig' in config)) {
      return false;
    }
    
    return true;
  }

  // Validation for mode restrictions
  private validateModeRestrictions(config: EnhancedBatchConfig): void {
    if (config.mode === GenerationSetMode.MULTI) {
      const { modeRestrictions } = config;
      
      // Check maximum generation sets
      if (config.generationSets.length > modeRestrictions.maxGenerationSets) {
        throw new Error(`Too many generation sets: ${config.generationSets.length} exceeds maximum of ${modeRestrictions.maxGenerationSets}`);
      }
      
      // Check if multi-generation is restricted to fixed count only
      if (modeRestrictions.multiGenerationOnlyForFixedCount) {
        for (const set of config.generationSets) {
          if (set.enabled && set.shapeCountMode !== ShapeCountMode.FIXED) {
            throw new Error(`Multi-generation mode restricted to fixed shape count only. Set "${set.name}" uses ${set.shapeCountMode} mode.`);
          }
        }
      }
      
      // Check shape count limits per set
      for (const set of config.generationSets) {
        if (!set.enabled) continue;
        
        const shapeCount = set.shapeCountMode === ShapeCountMode.FIXED 
          ? set.shapeCountFixed 
          : Math.max(set.shapeCountRange[0], set.shapeCountRange[1]);
          
        if (shapeCount < modeRestrictions.minShapesPerSet) {
          throw new Error(`Set "${set.name}" has too few shapes: ${shapeCount} < minimum ${modeRestrictions.minShapesPerSet}`);
        }
        
        if (shapeCount > modeRestrictions.maxShapesPerSet) {
          throw new Error(`Set "${set.name}" has too many shapes: ${shapeCount} > maximum ${modeRestrictions.maxShapesPerSet}`);
        }
      }
    }
  }
  
  // Calculate total images for enhanced config
  private calculateTotalImages(config: EnhancedBatchConfig, settings: BatchExportSettings): number {
    if (config.mode === GenerationSetMode.SINGLE) {
      return settings.batchExportCount;
    } else {
      // For multi-generation, we still use the batch export count as total images to generate
      // The generation sets define the composition within each image
      return settings.batchExportCount;
    }
  }

  // Legacy batch export implementation (backward compatibility)
  private async startLegacyBatchExport(
    shapes: Shape[],
    groups: ShapeGroupClass[],
    canvasSettings: CanvasSettings,
    batchConfigSettings: BatchConfigSettings,
    enabledShapeTypes: Set<string>,
    userSettings: Partial<BatchExportSettings> & { exportAllImages?: boolean, selectedImageIndices?: number[] },
    generateShapesFunction: (config: any) => { shapes: Shape[], groups: ShapeGroupClass[] },
    userId: string = 'dev-user',
    generationSetsMetadata?: {
      generationSets?: any[];
      exportSettings?: any;
      artboardSettings?: any;
    }
  ): Promise<BatchExportResult> {
    const exportId = this.generateExportId();
    const settings = this.mergeBatchSettings(userSettings);
    
    // Store request settings for later use in status endpoint
    this.exportSettings.set(exportId, {
      batchSaveProjectFiles: settings.batchSaveProjectFiles || false,
      exportAllImages: userSettings.exportAllImages !== false, // default to true
      selectedImageIndices: userSettings.selectedImageIndices || []
    });
    
    // Initialize progress tracking
    const progress: ExportProgress = {
      exportId,
      status: 'pending',
      progress: 0,
      currentStep: 'Initializing batch export...',
      imagesCompleted: 0,
      totalImages: settings.batchExportCount
    };
    
    this.activeExports.set(exportId, progress);
    
    // Persist to database
    await this.createExportJob(exportId, userId, progress, {
      shapes: shapes.map(s => this.serializeShape(s)),
      groups: groups.map(g => this.serializeGroup(g)),
      canvasSettings,
      batchConfigSettings,
      enabledShapeTypes: Array.from(enabledShapeTypes),
      userSettings
    });
    
    // Start async batch processing using legacy method
    this.processBatchExport(
      exportId,
      shapes,
      groups,
      canvasSettings,
      batchConfigSettings,
      enabledShapeTypes,
      settings,
      generateShapesFunction,
      generationSetsMetadata
    );
    
    // Predict packaging outcome using the same logic as execution paths:
    // chunkSize=1 (memory-constrained) → individual files even if packageAsZip=true
    const _lEffScale = settings.useCustomSize ? 1 : (settings.scale || 1);
    const _lImgW = Math.round((settings.useCustomSize ? (settings.customWidth || canvasSettings.width) : canvasSettings.width) * _lEffScale);
    const _lImgH = Math.round((settings.useCustomSize ? (settings.customHeight || canvasSettings.height) : canvasSettings.height) * _lEffScale);
    const _lBitDepth = settings.format === 'tiff' ? 16 : 8;
    const _lChunkSize = deriveChunkSize(estimateImageMemoryMb(_lImgW, _lImgH, _lBitDepth, settings.format || 'png'));
    const _lWillZip = _lChunkSize > 1 && settings.batchExportCount > 1 && settings.packageAsZip !== false;

    if (_lWillZip) {
      return {
        success: true,
        exportId,
        estimatedDuration: this.calculateEstimatedDuration(settings.batchExportCount),
        totalImages: settings.batchExportCount,
        downloadUrl: `/api/export/download/${exportId}`
      };
    } else {
      return {
        success: true,
        exportId,
        estimatedDuration: this.calculateEstimatedDuration(settings.batchExportCount),
        totalImages: settings.batchExportCount,
        imageFiles: [], // Will be populated when processing completes
        projectFiles: []
      };
    }
  }

  // Enhanced batch export implementation for generation sets
  private async startEnhancedBatchExport(
    shapes: Shape[],
    groups: ShapeGroupClass[],
    canvasSettings: CanvasSettings,
    enhancedConfig: EnhancedBatchConfig,
    enabledShapeTypes: Set<string>,
    userSettings: Partial<BatchExportSettings> & { exportAllImages?: boolean, selectedImageIndices?: number[] },
    generateShapesFunction: (config: any, enabledTypes?: Set<SupportedShapeType>) => { shapes: Shape[], groups: ShapeGroupClass[] },
    userId: string = 'dev-user'
  ): Promise<EnhancedBatchExportResult> {
    // Validate mode restrictions
    this.validateModeRestrictions(enhancedConfig);
    
    const exportId = this.generateExportId();
    const settings = this.mergeBatchSettings(userSettings);
    
    // Calculate total images based on mode
    const totalImages = this.calculateTotalImages(enhancedConfig, settings);
    
    // Store request settings for later use in status endpoint
    this.exportSettings.set(exportId, {
      batchSaveProjectFiles: settings.batchSaveProjectFiles || false,
      exportAllImages: userSettings.exportAllImages !== false, // default to true
      selectedImageIndices: userSettings.selectedImageIndices || []
    });
    
    // Initialize progress tracking
    const progress: ExportProgress = {
      exportId,
      status: 'pending',
      progress: 0,
      currentStep: 'Initializing enhanced batch export...',
      imagesCompleted: 0,
      totalImages
    };
    
    this.activeExports.set(exportId, progress);
    
    // Persist to database
    await this.createExportJob(exportId, userId, progress, {
      shapes: shapes.map(s => this.serializeShape(s)),
      groups: groups.map(g => this.serializeGroup(g)),
      canvasSettings,
      enhancedConfig,
      enabledShapeTypes: Array.from(enabledShapeTypes),
      userSettings
    });
    
    // Start async enhanced batch processing
    this.processBatchExportEnhanced(
      exportId,
      shapes,
      groups,
      canvasSettings,
      enhancedConfig,
      enabledShapeTypes,
      settings,
      generateShapesFunction
    );
    
    // Calculate additional metadata for enhanced result
    const enabledSets = enhancedConfig.generationSets.filter(set => set.enabled);
    
    // Predict packaging outcome using the same logic as execution paths:
    // chunkSize=1 (memory-constrained) → individual files even if packageAsZip=true
    const _eEffScaleR = settings.useCustomSize ? 1 : (settings.scale || 1);
    const _eImgWR = Math.round((settings.useCustomSize ? (settings.customWidth || canvasSettings.width) : canvasSettings.width) * _eEffScaleR);
    const _eImgHR = Math.round((settings.useCustomSize ? (settings.customHeight || canvasSettings.height) : canvasSettings.height) * _eEffScaleR);
    const _eBitDepthR = settings.format === 'tiff' ? 16 : 8;
    const _eChunkSizeR = deriveChunkSize(estimateImageMemoryMb(_eImgWR, _eImgHR, _eBitDepthR, settings.format || 'png'));
    const _eWillZip = _eChunkSizeR > 1 && totalImages > 1 && settings.packageAsZip !== false;

    const baseResult = {
      success: true,
      exportId,
      estimatedDuration: this.calculateEstimatedDuration(totalImages),
      totalImages,
      mode: enhancedConfig.mode,
      generationSetsProcessed: enabledSets.length,
      totalGenerationSets: enhancedConfig.generationSets.length
    };
    
    if (_eWillZip) {
      return {
        ...baseResult,
        downloadUrl: `/api/export/download/${exportId}`
      };
    } else {
      return {
        ...baseResult,
        imageFiles: [], // Will be populated when processing completes
        projectFiles: []
      };
    }
  }

  // Enhanced batch export processing for generation sets with z-index layering
  private async processBatchExportEnhanced(
    exportId: string,
    baseShapes: Shape[],
    baseGroups: ShapeGroupClass[],
    canvasSettings: CanvasSettings,
    enhancedConfig: EnhancedBatchConfig,
    enabledShapeTypes: Set<string>,
    settings: BatchExportSettings,
    generateShapesFunction: (config: any, enabledTypes?: Set<SupportedShapeType>) => { shapes: Shape[], groups: ShapeGroupClass[] }
  ): Promise<void> {
    const progress = this.activeExports.get(exportId);
    
    if (!progress) {
      throw new Error(`Export progress not found for ID: ${exportId}`);
    }
    
    try {
      // Validate enhanced config
      if (!enhancedConfig) {
        throw new Error('Enhanced configuration is required but not provided');
      }
      
      if (!enhancedConfig.generationSets || !Array.isArray(enhancedConfig.generationSets)) {
        throw new Error('Enhanced configuration must contain valid generationSets array');
      }
      
      if (!enhancedConfig.globalSettings) {
        throw new Error('Enhanced configuration must contain globalSettings');
      }
      // Derive chunk size once here — drives packaging policy in finalizeExport
      const _eEffScale = settings.useCustomSize ? 1 : (settings.scale || 1);
      const _eImgW = Math.round((settings.useCustomSize ? (settings.customWidth || canvasSettings.width) : canvasSettings.width) * _eEffScale);
      const _eImgH = Math.round((settings.useCustomSize ? (settings.customHeight || canvasSettings.height) : canvasSettings.height) * _eEffScale);
      const _eBitDepth = settings.format === 'tiff' ? 16 : 8;
      const _eChunkSize = deriveChunkSize(estimateImageMemoryMb(_eImgW, _eImgH, _eBitDepth, settings.format || 'png'));

      progress.status = 'processing';
      progress.currentStep = 'Preparing batch export...';
      this.activeExports.set(exportId, progress);
      
      // Update database with processing status
      await this.updateExportJobProgress(exportId, progress);
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      
      // Initialize tracking for individual files
      const imageFiles: any[] = [];
      const projectFiles: any[] = [];
      
      // Create export directory for this batch
      const exportDir = path.join(process.cwd(), 'exports', exportId);
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }
      
      // Validate mode and handle different modes
      if (!enhancedConfig.mode) {
        throw new Error('Enhanced configuration mode is required');
      }
      
      if (enhancedConfig.mode === GenerationSetMode.SINGLE) {
        // Single mode: use legacy batch configuration
        await this.processSingleMode(
          exportId, 
          baseShapes, 
          baseGroups, 
          canvasSettings, 
          enhancedConfig, 
          enabledShapeTypes,
          settings, 
          generateShapesFunction, 
          exportDir, 
          imageFiles, 
          projectFiles, 
          timestamp
        );
      } else {
        // Multi mode: process generation sets
        await this.processMultiMode(
          exportId, 
          baseShapes, 
          baseGroups, 
          canvasSettings, 
          enhancedConfig, 
          settings, 
          generateShapesFunction, 
          exportDir, 
          imageFiles, 
          projectFiles, 
          timestamp
        );
      }
      
      // Finalize export — pass derived chunk size to drive the packaging policy
      await this.finalizeExport(exportId, settings, exportDir, timestamp, imageFiles, projectFiles, _eChunkSize);
      
    } catch (error) {
      progress.status = 'error';
      progress.errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      this.activeExports.set(exportId, progress);
      
      // Update database with error status
      await this.updateExportJobProgress(exportId, progress);
    }
  }

  // Process single generation mode (backward compatibility)
  private async processSingleMode(
    exportId: string,
    baseShapes: Shape[],
    baseGroups: ShapeGroupClass[],
    canvasSettings: CanvasSettings,
    enhancedConfig: EnhancedBatchConfig,
    enabledShapeTypes: Set<string>,
    settings: BatchExportSettings,
    generateShapesFunction: (config: any, enabledTypes?: Set<SupportedShapeType>) => { shapes: Shape[], groups: ShapeGroupClass[] },
    exportDir: string,
    imageFiles: any[],
    projectFiles: any[],
    timestamp: string
  ): Promise<void> {
    const progress = this.activeExports.get(exportId);
    
    if (!progress) {
      throw new Error(`Export progress not found for ID: ${exportId}`);
    }
    
    const batchConfig = enhancedConfig.legacyBatchConfig;
    
    if (!batchConfig) {
      throw new Error('Single mode requires legacyBatchConfig to be provided');
    }
    
    if (!generateShapesFunction || typeof generateShapesFunction !== 'function') {
      throw new Error('generateShapesFunction is required but not provided or invalid');
    }
    
    if (settings.batchExportCount <= 0) {
      throw new Error('batchExportCount must be greater than 0');
    }
    
    // Derive chunk size for batch throttling using effective render dimensions and format bit depth
    const _smEffScale = settings.useCustomSize ? 1 : (settings.scale || 1);
    const _smImgW = Math.round((settings.useCustomSize ? (settings.customWidth || canvasSettings.width) : canvasSettings.width) * _smEffScale);
    const _smImgH = Math.round((settings.useCustomSize ? (settings.customHeight || canvasSettings.height) : canvasSettings.height) * _smEffScale);
    const _smBitDepth = settings.format === 'tiff' ? 16 : 8;
    const _smMemPerImg = estimateImageMemoryMb(_smImgW, _smImgH, _smBitDepth, settings.format || 'png');
    const _smChunkSize = deriveChunkSize(_smMemPerImg);
    const _smTotal = settings.batchExportCount;
    const _smChunkCount = Math.ceil(_smTotal / _smChunkSize);

    // Calculate steps for progress tracking
    const totalSteps = settings.batchExportCount * 2 + 2;
    let currentStep = 0;
    let failedCount = 0;
    
    // Process in chunk windows — each window writes to disk before the next begins
    for (let smChunkIdx = 0; smChunkIdx < _smChunkCount; smChunkIdx++) {
      const smChunkStart = smChunkIdx * _smChunkSize;
      const smChunkEnd = Math.min(smChunkStart + _smChunkSize, _smTotal);
      const smChunkLabel = _smChunkCount > 1 ? ` [Chunk ${smChunkIdx + 1}/${_smChunkCount}]` : '';
      progress.chunkIndex = smChunkIdx + 1;
      progress.chunkCount = _smChunkCount;
    for (let i = smChunkStart; i < smChunkEnd; i++) {
      // Update progress
      progress.currentStep = `Generating artwork ${i + 1} of ${_smTotal}${smChunkLabel}`;
      progress.progress = Math.round((currentStep / totalSteps) * 100);
      this.activeExports.set(exportId, progress);
      await this.updateExportJobProgress(exportId, progress);
      
      try {
      // Generate shapes for this iteration using legacy config
      const { shapes: currentShapes, groups: currentGroups } = generateShapesFunction(batchConfig);
      currentStep++;
      
      // Export image
      progress.currentStep = `Exporting image ${i + 1} of ${_smTotal}${smChunkLabel}`;
      progress.progress = Math.round((currentStep / totalSteps) * 100);
      this.activeExports.set(exportId, progress);
      await this.updateExportJobProgress(exportId, progress);
      
      await this.exportImage(
        i + 1, 
        currentShapes, 
        currentGroups, 
        canvasSettings, 
        batchConfig, 
        settings, 
        exportDir, 
        imageFiles, 
        projectFiles, 
        timestamp,
        new Set(Array.from(enabledShapeTypes))
      );
      
      progress.imagesCompleted = imageFiles.length;
      currentStep++;
      await this.updateExportJobProgress(exportId, progress);
      } catch (imageErr) {
        console.error(`[ExportService] Image ${i + 1} failed (Single Mode), skipping: ${imageErr instanceof Error ? imageErr.message : imageErr}`);
        currentStep += 2;
        failedCount++;
      }
    } // end inner image loop
    // Chunk boundary: release canvas buffers before starting the next window
    if (typeof global.gc === 'function') { global.gc(); }
    } // end outer chunk loop
    
    if (imageFiles.length === 0) {
      throw new Error(`All ${settings.batchExportCount} images failed to export`);
    }
    if (failedCount > 0) {
      console.log(`[ExportService] Partial export: ${imageFiles.length} of ${settings.batchExportCount} images completed successfully`);
    }
  }

  // Process multi-generation mode with z-index layering
  private async processMultiMode(
    exportId: string,
    baseShapes: Shape[],
    baseGroups: ShapeGroupClass[],
    canvasSettings: CanvasSettings,
    enhancedConfig: EnhancedBatchConfig,
    settings: BatchExportSettings,
    generateShapesFunction: (config: any, enabledTypes?: Set<SupportedShapeType>) => { shapes: Shape[], groups: ShapeGroupClass[] },
    exportDir: string,
    imageFiles: any[],
    projectFiles: any[],
    timestamp: string
  ): Promise<void> {
    const progress = this.activeExports.get(exportId);
    
    if (!progress) {
      throw new Error(`Export progress not found for ID: ${exportId}`);
    }
    
    if (!generateShapesFunction || typeof generateShapesFunction !== 'function') {
      throw new Error('generateShapesFunction is required but not provided or invalid');
    }
    
    if (settings.batchExportCount <= 0) {
      throw new Error('batchExportCount must be greater than 0');
    }
    
    // Filter enabled generation sets and sort by generation order
    const enabledSets = enhancedConfig.generationSets
      .filter(set => set.enabled)
      .sort((a, b) => (a.generationOrder ?? 0) - (b.generationOrder ?? 0));
      
    if (enabledSets.length === 0) {
      throw new Error('No enabled generation sets found for multi-generation mode');
    }
      
    // Derive chunk size for batch throttling using effective render dimensions and format bit depth
    const _mmEffScale = settings.useCustomSize ? 1 : (settings.scale || 1);
    const _mmImgW = Math.round((settings.useCustomSize ? (settings.customWidth || canvasSettings.width) : canvasSettings.width) * _mmEffScale);
    const _mmImgH = Math.round((settings.useCustomSize ? (settings.customHeight || canvasSettings.height) : canvasSettings.height) * _mmEffScale);
    const _mmBitDepth = settings.format === 'tiff' ? 16 : 8;
    const _mmMemPerImg = estimateImageMemoryMb(_mmImgW, _mmImgH, _mmBitDepth, settings.format || 'png');
    const _mmChunkSize = deriveChunkSize(_mmMemPerImg);
    const _mmTotal = settings.batchExportCount;
    const _mmChunkCount = Math.ceil(_mmTotal / _mmChunkSize);

    // Calculate steps for progress tracking
    const totalSteps = settings.batchExportCount * 2 + 2;
    let currentStep = 0;
    let failedCount = 0;
    
    // Process in chunk windows — each window writes to disk before the next begins
    for (let mmChunkIdx = 0; mmChunkIdx < _mmChunkCount; mmChunkIdx++) {
      const mmChunkStart = mmChunkIdx * _mmChunkSize;
      const mmChunkEnd = Math.min(mmChunkStart + _mmChunkSize, _mmTotal);
      const mmChunkLabel = _mmChunkCount > 1 ? ` [Chunk ${mmChunkIdx + 1}/${_mmChunkCount}]` : '';
      progress.chunkIndex = mmChunkIdx + 1;
      progress.chunkCount = _mmChunkCount;
    for (let i = mmChunkStart; i < mmChunkEnd; i++) {
      // Update progress
      progress.currentStep = `Generating composite artwork ${i + 1} of ${_mmTotal}${mmChunkLabel}`;
      progress.progress = Math.round((currentStep / totalSteps) * 100);
      this.activeExports.set(exportId, progress);
      await this.updateExportJobProgress(exportId, progress);
      
      try {
      // Accumulate shapes from all generation sets with proper z-index layering
      const compositeShapes: Shape[] = [];
      const compositeGroups: ShapeGroupClass[] = [];
      
      // Process each generation set ONCE - each set generates exactly its defined shape count
      for (let setIndex = 0; setIndex < enabledSets.length; setIndex++) {
        const generationSet = enabledSets[setIndex];
        
        if (!generationSet) {
          throw new Error(`Generation set at index ${setIndex} is null or undefined`);
        }
        
        if (!generationSet.batchConfig) {
          throw new Error(`Generation set "${generationSet.name || setIndex}" is missing required batchConfig`);
        }
        
        if (!generationSet.enabledShapeTypes || !Array.isArray(generationSet.enabledShapeTypes)) {
          throw new Error(`Generation set "${generationSet.name || setIndex}" has invalid enabledShapeTypes`);
        }
        
        // Convert SupportedShapeType[] to Set<SupportedShapeType> for type safety
        const setEnabledTypes = new Set(generationSet.enabledShapeTypes);
        
        // Generate shapes for this generation set with error handling
        let setShapes: Shape[];
        let setGroups: ShapeGroupClass[];
        
        try {
          const result = generateShapesFunction(
            generationSet.batchConfig, 
            setEnabledTypes
          );
          setShapes = result.shapes;
          setGroups = result.groups;
        } catch (error) {
          throw new Error(`Failed to generate shapes for set "${generationSet.name || setIndex}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        
        // Apply z-index layering based on global settings
        const adjustedShapes = this.applyZIndexLayering(
          setShapes, 
          generationSet, 
          setIndex, 
          enhancedConfig.globalSettings.globalZIndexSettings
        );
        
        // Apply shape count restrictions for this generation set
        const finalShapes = this.applyShapeCountRestrictions(adjustedShapes, generationSet);
        
        // Add to composite
        compositeShapes.push(...finalShapes);
        compositeGroups.push(...setGroups);
      }
      
      currentStep++;
      
      // Export composite image
      progress.currentStep = `Exporting composite image ${i + 1} of ${_mmTotal}${mmChunkLabel}`;
      progress.progress = Math.round((currentStep / totalSteps) * 100);
      this.activeExports.set(exportId, progress);
      await this.updateExportJobProgress(exportId, progress);
      
      await this.exportImage(
        i + 1, 
        compositeShapes, 
        compositeGroups, 
        canvasSettings, 
        enhancedConfig.generationSets[0]?.batchConfig, // Use first set's config for export settings
        settings, 
        exportDir, 
        imageFiles, 
        projectFiles, 
        timestamp,
        new Set(enabledSets.flatMap(set => set.enabledShapeTypes.map(type => type as string)))
      );
      
      progress.imagesCompleted = imageFiles.length;
      currentStep++;
      await this.updateExportJobProgress(exportId, progress);
      } catch (imageErr) {
        console.error(`[ExportService] Image ${i + 1} failed (Multi Mode), skipping: ${imageErr instanceof Error ? imageErr.message : imageErr}`);
        currentStep += 2;
        failedCount++;
      }
    } // end inner image loop
    // Chunk boundary: release canvas buffers before starting the next window
    if (typeof global.gc === 'function') { global.gc(); }
    } // end outer chunk loop
    
    if (imageFiles.length === 0) {
      throw new Error(`All ${settings.batchExportCount} images failed to export`);
    }
    if (failedCount > 0) {
      console.log(`[ExportService] Partial export: ${imageFiles.length} of ${settings.batchExportCount} images completed successfully`);
    }
  }

  // Apply z-index layering to shapes based on generation set configuration
  private applyZIndexLayering(
    shapes: Shape[], 
    generationSet: GenerationSet, 
    setIndex: number,
    globalZIndexSettings: any
  ): Shape[] {
    if (!shapes || !Array.isArray(shapes)) {
      throw new Error('Invalid shapes array provided to applyZIndexLayering');
    }
    
    if (!generationSet) {
      throw new Error('Generation set is required for z-index layering');
    }
    
    if (!globalZIndexSettings) {
      throw new Error('Global z-index settings are required');
    }
    
    // Use global settings if enabled, otherwise use per-set settings
    const zIndexConfig = globalZIndexSettings.useGlobalSettings 
      ? {
          baseOffset: (globalZIndexSettings.startingZIndex || 0) + (setIndex * (globalZIndexSettings.setSpacing || 10)),
          incrementPerShape: 1,
          incrementPerGeneration: globalZIndexSettings.setSpacing || 10
        }
      : generationSet.zIndexConfig || { baseOffset: 0, incrementPerShape: 1, incrementPerGeneration: 10 };
    
    return shapes.map((shape, shapeIndex) => {
      if (!shape) {
        throw new Error(`Shape at index ${shapeIndex} is null or undefined`);
      }
      
      // Calculate z-index for this shape
      const baseOffset = zIndexConfig.baseOffset || 0;
      const incrementPerShape = zIndexConfig.incrementPerShape || 1;
      const zIndex = baseOffset + (shapeIndex * incrementPerShape);
      
      // Apply z-index to shape properties (preserve existing properties)
      if (!shape.properties) {
        // Create minimal properties object with defaults for required fields
        shape.properties = {
          fillColor: '#000000',
          fillOpacity: 1,
          strokeColor: 'none',
          strokeWidth: 0,
          strokeOpacity: 1,
          blendMode: 'source-over' as any,
          zIndex: zIndex,
          blurRadius: 0
        };
      } else {
        // Only update the zIndex if properties already exist
        shape.properties.zIndex = zIndex;
      }
      return shape;
    });
  }

  // Apply shape count restrictions for a generation set
  private applyShapeCountRestrictions(shapes: Shape[], generationSet: GenerationSet): Shape[] {
    if (!shapes || !Array.isArray(shapes)) {
      throw new Error('Invalid shapes array provided to applyShapeCountRestrictions');
    }
    
    if (!generationSet) {
      throw new Error('Generation set is required for shape count restrictions');
    }
    
    let targetCount: number;
    
    if (generationSet.shapeCountMode === ShapeCountMode.FIXED) {
      targetCount = generationSet.shapeCountFixed;
      
      if (typeof targetCount !== 'number' || targetCount < 0) {
        throw new Error(`Invalid fixed shape count: ${targetCount}`);
      }
    } else {
      // Range mode: pick random count within range
      const shapeCountRange = generationSet.shapeCountRange;
      
      if (!Array.isArray(shapeCountRange) || shapeCountRange.length !== 2) {
        throw new Error('Shape count range must be an array of two numbers');
      }
      
      const [min, max] = shapeCountRange;
      
      if (typeof min !== 'number' || typeof max !== 'number' || min < 0 || max < min) {
        throw new Error(`Invalid shape count range: [${min}, ${max}]`);
      }
      
      targetCount = Math.floor(Math.random() * (max - min + 1)) + min;
    }
    
    // Return the first targetCount shapes (or all if fewer than target)
    return shapes.slice(0, Math.max(0, targetCount));
  }

  // Refactored image export logic (extracted from original processBatchExport)
  private async exportImage(
    index: number,
    shapes: Shape[],
    groups: ShapeGroupClass[],
    canvasSettings: CanvasSettings,
    batchConfig: BatchConfigSettings | undefined,
    settings: BatchExportSettings,
    exportDir: string,
    imageFiles: any[],
    projectFiles: any[],
    timestamp: string,
    enabledShapeTypes: Set<string>
  ): Promise<void> {
    // Create export options
    const exportOptions: any = {
      format: settings.format,
      quality: settings.quality ? settings.quality / 100 : 0.92,
      scale: settings.scale || 1,
      backgroundColor: settings.backgroundColor,
      includeBackground: settings.includeBackground,
      includeAdornments: settings.includeAdornments,
      includeGrid: settings.includeGrid,
      includeArtboardGeometry: settings.includeArtboardGeometry,
      margins: settings.useMargins ? {
        top: settings.marginTop || 0,
        right: settings.marginRight || 0,
        bottom: settings.marginBottom || 0,
        left: settings.marginLeft || 0
      } : undefined
    };
    
    // Set artboard bounds if scope is 'artboard'
    if (settings.scope === 'artboard') {
      exportOptions.artboardBounds = {
        x: -(canvasSettings.width / 2),
        y: -(canvasSettings.height / 2),
        width: canvasSettings.width,
        height: canvasSettings.height
      };
    }
    
    if (settings.useCustomSize && settings.customWidth && settings.customHeight) {
      exportOptions.width = settings.customWidth;
      exportOptions.height = settings.customHeight;
    }
    
    // Render shapes to canvas and convert to image buffer
    const canvas = this.renderShapesToCanvas(shapes, canvasSettings, exportOptions);
    const imageBuffer = this.canvasToBuffer(canvas, settings.format, exportOptions.quality);
    
    // Generate filename
    const filename = this.generateBatchFilename(settings, index);
    const imageFilename = `${filename}.${settings.format}`;
    
    // Always write to disk immediately — never buffer large images in RAM
    const imagePath = path.join(exportDir, imageFilename);
    fs.writeFileSync(imagePath, imageBuffer);
    imageFiles.push({
      filename: imageFilename,
      url: `/api/export/files/${exportDir.split('/').pop()}/${imageFilename}`,
      index
    });
    
    // Save project file if requested
    if (settings.batchSaveProjectFiles) {
      const projectData = {
        version: '1.0.0',
        type: 'generated',
        timestamp: new Date().toISOString(),
        name: filename,
        canvasSettings,
        batchConfig,
        enabledShapeTypes: Array.from(enabledShapeTypes),
        shapes: shapes.map(shape => this.serializeShape(shape))
      };
      
      const projectJson = JSON.stringify(projectData, null, 2);
      const projectFilename = `${filename}.generated.json`;
      
      // Always write to disk immediately
      const projectPath = path.join(exportDir, projectFilename);
      fs.writeFileSync(projectPath, projectJson);
      projectFiles.push({
        filename: projectFilename,
        url: `/api/export/files/${exportDir.split('/').pop()}/${projectFilename}`,
        index
      });
    }
  }

  // Finalize export — auto-ZIP for multiple files, direct delivery for single file
  private async finalizeExport(
    exportId: string,
    settings: BatchExportSettings,
    exportDir: string,
    timestamp: string,
    imageFiles: any[],
    projectFiles: any[],
    chunkSize: number = 8
  ): Promise<void> {
    const progress = this.activeExports.get(exportId)!;
    
    // chunkSize==1: memory-constrained mode — deliver individual files (no ZIP), even for multi-image batches
    // chunkSize>1 with multiple outputs: ZIP only when user hasn't opted out via packageAsZip
    const autoZip = chunkSize > 1 && imageFiles.length > 1 && settings.packageAsZip !== false;
    if (autoZip) {
      // Multiple files → auto-package into ZIP
      progress.currentStep = 'Creating ZIP file...';
      progress.progress = 95;
      this.activeExports.set(exportId, progress);
      
      const zipFilename = `batch-export-${timestamp}.zip`;
      const zipPath = path.join(process.cwd(), 'exports', zipFilename);
      await buildZipFromDisk(exportDir, zipPath);
      try { fs.rmSync(exportDir, { recursive: true, force: true }); } catch {}
      
      progress.status = 'completed';
      progress.progress = 100;
      progress.currentStep = `ZIP export completed (${imageFiles.length} files)`;
      progress.downloadPath = zipPath;
      this.activeExports.set(exportId, progress);
      this.exportResults.set(exportId, zipPath);
      
      await this.updateExportJobResults(exportId, {
        downloadUrl: `/api/export/download/${exportId}`,
        downloadPath: zipPath,
        packageType: 'zip'
      });
      await this.updateExportJobProgress(exportId, progress);
    } else {
      // Individual delivery — memory-constrained mode (chunkSize=1) OR single-file output
      progress.status = 'completed';
      progress.progress = 100;
      progress.currentStep = 'Export completed successfully';
      this.activeExports.set(exportId, progress);
      
      this.individualFiles.set(exportId, { imageFiles, projectFiles });
      
      await this.updateExportJobResults(exportId, {
        imageFiles,
        projectFiles,
        packageType: 'individual'
      });
      await this.updateExportJobProgress(exportId, progress);
    }
  }
}

/**
 * High-Resolution Export Service
 * 
 * Uses Headless Chromium + Sharp for exports that exceed browser canvas limits.
 * Produces 16-bit TIFF with sRGB ICC profiles for professional print quality.
 */

export type ArchiveCompressionFormat = 'none' | 'zip' | '7z';
export type ArchiveCompressionLevel = 1 | 3 | 5 | 7 | 9;

export interface ArchiveCompressionSettings {
  enabled: boolean;
  format: ArchiveCompressionFormat;
  level: ArchiveCompressionLevel;
}

export interface HighResExportRequest {
  shapes: any[];
  groups?: any[];
  exportMode?: 'artboard' | 'all' | 'selection' | 'artboard-extended';
  artboard: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    backgroundColor: string;
    dpi: number;
    unitType?: 'pixels' | 'mm' | 'cm' | 'inches';
    printConfig?: any;
  };
  exportSettings: {
    format: 'tiff' | 'png' | 'jpeg' | 'webp' | 'pdf';
    bitDepth?: 8 | 16;
    quality?: number; // JPEG/WebP quality (1-100)
    dpi?: number;
    scale?: number;
    includeBleed?: boolean;
    includePrintMarks?: boolean;
    backgroundColor?: string;
    backgroundMode?: 'transparent' | 'artboard' | 'custom';
    compression?: 'none' | 'deflate';
    flattenToRgb?: boolean;
    matteColor?: string;
    saveProjectFile?: boolean;
    // Metadata fields for professional print exports
    artistName?: string;
    copyrightText?: string;
    imageTitle?: string;
    imageDescription?: string;
    embedIccProfile?: boolean;
  };
  archiveCompression?: ArchiveCompressionSettings;
  enabledShapeTypes?: string[];
}

export interface HighResExportResult {
  success: boolean;
  buffer?: Buffer;
  filePath?: string;
  mimeType?: string;
  filename?: string;
  width?: number;
  height?: number;
  error?: string;
  duration?: number;
}

let chromiumPathCache: string | null = null;

function findChromiumPath(): string {
  if (chromiumPathCache) return chromiumPathCache;
  
  try {
    const result = execSync('which chromium', { encoding: 'utf-8' }).trim();
    if (result && fs.existsSync(result)) {
      chromiumPathCache = result;
      return result;
    }
  } catch {}
  
  const commonPaths = [
    '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];
  
  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      chromiumPathCache = p;
      return p;
    }
  }
  
  throw new Error('Chromium not found. Please install Chromium via replit.nix');
}

/**
 * Compress a buffer using 7z or ZIP format
 * Returns compressed buffer, new filename, and MIME type
 */
async function compressBuffer(
  buffer: Buffer,
  originalFilename: string,
  settings: ArchiveCompressionSettings
): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  if (!settings.enabled || settings.format === 'none') {
    const ext = originalFilename.split('.').pop() || 'bin';
    const mimeType = ext === 'tiff' ? 'image/tiff' : ext === 'png' ? 'image/png' : 'application/octet-stream';
    return { buffer, filename: originalFilename, mimeType };
  }
  
  const tempDir = os.tmpdir();
  const sessionId = `compress_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const workDir = path.join(tempDir, sessionId);
  
  try {
    fs.mkdirSync(workDir, { recursive: true });
    
    const inputPath = path.join(workDir, originalFilename);
    fs.writeFileSync(inputPath, buffer);
    
    const baseName = originalFilename.replace(/\.[^.]+$/, '');
    
    if (settings.format === '7z') {
      const archivePath = path.join(workDir, `${baseName}.7z`);
      
      await new Promise<void>((resolve, reject) => {
        const args = [
          'a',
          archivePath,
          inputPath,
          `-mx=${settings.level}`,
          `-m0=LZMA2:d=${getLzma2DictSize(settings.level)}`,
          '-y'
        ];
        
        console.log(`[Compression] Running: 7z ${args.join(' ')}`);
        
        const proc = spawn('7z', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        
        let stderr = '';
        proc.stderr?.on('data', (data) => { stderr += data.toString(); });
        
        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`7z exited with code ${code}: ${stderr}`));
          }
        });
        
        proc.on('error', (err) => {
          reject(new Error(`Failed to spawn 7z: ${err.message}`));
        });
      });
      
      const compressedBuffer = fs.readFileSync(archivePath);
      console.log(`[Compression] 7z: ${(buffer.length / 1024 / 1024).toFixed(2)}MB -> ${(compressedBuffer.length / 1024 / 1024).toFixed(2)}MB (${((1 - compressedBuffer.length / buffer.length) * 100).toFixed(1)}% reduction)`);
      
      return {
        buffer: compressedBuffer,
        filename: `${baseName}.7z`,
        mimeType: 'application/x-7z-compressed'
      };
    } else {
      const zip = new JSZip();
      zip.file(originalFilename, buffer, {
        compression: 'DEFLATE',
        compressionOptions: { level: Math.min(9, settings.level) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }
      });
      
      const compressedBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: Math.min(9, settings.level) }
      });
      
      console.log(`[Compression] ZIP: ${(buffer.length / 1024 / 1024).toFixed(2)}MB -> ${(compressedBuffer.length / 1024 / 1024).toFixed(2)}MB (${((1 - compressedBuffer.length / buffer.length) * 100).toFixed(1)}% reduction)`);
      
      return {
        buffer: compressedBuffer,
        filename: `${baseName}.zip`,
        mimeType: 'application/zip'
      };
    }
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('[Compression] Failed to clean up temp dir:', e);
    }
  }
}

function getLzma2DictSize(level: ArchiveCompressionLevel): string {
  switch (level) {
    case 1: return '64k';
    case 3: return '1m';
    case 5: return '8m';
    case 7: return '32m';
    case 9: return '64m';
    default: return '8m';
  }
}

function convertUnitToPixels(value: number, unit: string, dpi: number): number {
  switch (unit) {
    case 'pixels': return value;
    case 'mm': return (value / 25.4) * dpi;
    case 'cm': return (value / 2.54) * dpi;
    case 'inches': return value * dpi;
    default: return value;
  }
}

/**
 * Tile Planning for Large Exports
 * 
 * Calculates optimal tile grid for rendering very large images that exceed
 * memory thresholds. Uses ~8000px base tile size with automatic edge sizing.
 */

export interface TilePlan {
  needsTiling: boolean;
  tileWidth: number;
  tileHeight: number;
  cols: number;
  rows: number;
  totalTiles: number;
  tiles: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    index: number;
  }>;
  reason?: string;
}

const TILE_THRESHOLDS = {
  maxSinglePassPixels: 100_000_000,  // ~100M pixels
  maxSinglePassBytes: 512_000_000,   // ~512MB raw
  baseTileSize: 8000,                // ~8000px base tile
  minTileSize: 1000,                 // Minimum tile dimension
};

export function planTiles(
  width: number,
  height: number,
  channels: number = 4,
  bitDepth: number = 16
): TilePlan {
  const totalPixels = width * height;
  const bytesPerPixel = channels * (bitDepth / 8);
  const totalBytes = totalPixels * bytesPerPixel;
  
  // Check if tiling is needed
  const exceedsPixelLimit = totalPixels > TILE_THRESHOLDS.maxSinglePassPixels;
  const exceedsByteLimit = totalBytes > TILE_THRESHOLDS.maxSinglePassBytes;
  const needsTiling = exceedsPixelLimit || exceedsByteLimit;
  
  if (!needsTiling) {
    return {
      needsTiling: false,
      tileWidth: width,
      tileHeight: height,
      cols: 1,
      rows: 1,
      totalTiles: 1,
      tiles: [{ x: 0, y: 0, width, height, index: 0 }],
      reason: 'Image within single-pass limits'
    };
  }
  
  // Calculate optimal tile size
  const baseTile = TILE_THRESHOLDS.baseTileSize;
  const cols = Math.ceil(width / baseTile);
  const rows = Math.ceil(height / baseTile);
  const totalTiles = cols * rows;
  
  // Generate tile definitions with edge handling
  const tiles: TilePlan['tiles'] = [];
  let index = 0;
  
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * baseTile;
      const y = row * baseTile;
      // Edge tiles are sized to remaining pixels
      const tileW = Math.min(baseTile, width - x);
      const tileH = Math.min(baseTile, height - y);
      
      tiles.push({ x, y, width: tileW, height: tileH, index });
      index++;
    }
  }
  
  const reason = exceedsPixelLimit 
    ? `Exceeds ${(TILE_THRESHOLDS.maxSinglePassPixels / 1_000_000).toFixed(0)}M pixel limit (${(totalPixels / 1_000_000).toFixed(1)}M)`
    : `Exceeds ${(TILE_THRESHOLDS.maxSinglePassBytes / 1_000_000).toFixed(0)}MB memory limit (${(totalBytes / 1_000_000).toFixed(1)}MB)`;
  
  console.log(`[TilePlanner] ${reason}`);
  console.log(`[TilePlanner] Planning ${cols}x${rows} = ${totalTiles} tiles for ${width}x${height} canvas`);
  
  return {
    needsTiling: true,
    tileWidth: baseTile,
    tileHeight: baseTile,
    cols,
    rows,
    totalTiles,
    tiles,
    reason
  };
}

/**
 * Progress callback type for tiled export
 */
export type TileProgressCallback = (phase: string, current: number, total: number) => void;

/**
 * SSE progress callback type - emits structured events for SSE streaming
 */
export type SSEProgressCallback = (event: SSEExportEvent) => void;

/**
 * SSE export session for tracking active streaming exports
 */
export interface SSEExportSessionData {
  exportId: string;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
  startTime: number;
  abortController: AbortController;
  downloadUrl?: string;
  filename?: string;
  filePath?: string;
  error?: string;
  dimensions?: { width: number; height: number };
  sizeBytes?: number;
}

export class HighResolutionExportService {
  private browser: Browser | null = null;
  private sseExportSessions = new Map<string, SSEExportSessionData>();
  private exportFiles = new Map<string, { buffer?: Buffer; filePath?: string; filename: string; mimeType: string }>();
  private readonly exportTempDir: string;
  private cleanupIntervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.exportTempDir = path.join(os.tmpdir(), 'shape-editor-exports');
    try {
      fs.mkdirSync(this.exportTempDir, { recursive: true });
    } catch (e) {
      console.warn('[HighResExport] Could not create export temp dir:', e);
    }
    this.cleanupStaleExportFiles();
    this.cleanupIntervalHandle = setInterval(() => this.cleanupStaleExportFiles(), 30 * 60 * 1000);
    if (this.cleanupIntervalHandle.unref) this.cleanupIntervalHandle.unref();
  }

  /**
   * Delete files in the export temp dir that are older than maxAgeMs (default 2 hours).
   * Scoped strictly to exportTempDir so it cannot affect other OS temp files.
   */
  private cleanupStaleExportFiles(maxAgeMs = 2 * 60 * 60 * 1000): void {
    try {
      if (!fs.existsSync(this.exportTempDir)) return;
      const now = Date.now();
      const entries = fs.readdirSync(this.exportTempDir);
      let removed = 0;
      for (const entry of entries) {
        const filePath = path.join(this.exportTempDir, entry);
        try {
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > maxAgeMs) {
            fs.rmSync(filePath, { recursive: true, force: true });
            removed++;
          }
        } catch {
        }
      }
      if (removed > 0) {
        console.log(`[HighResExport] Startup/periodic cleanup: removed ${removed} stale file(s) from ${this.exportTempDir}`);
      }
    } catch (e) {
      console.warn('[HighResExport] Cleanup sweep failed:', e);
    }
  }

  /**
   * Check if the browser is healthy and can create new pages
   */
  private async isBrowserHealthy(): Promise<boolean> {
    if (!this.browser) return false;
    
    try {
      // Try to get browser version - this will fail if browser is disconnected
      await this.browser.version();
      return true;
    } catch {
      console.log('[HighResExport] Browser health check failed - browser is unhealthy');
      return false;
    }
  }
  
  /**
   * Force close the browser, handling cases where it may be disconnected
   */
  private async forceCloseBrowser(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        console.log('[HighResExport] Browser was already disconnected, clearing reference');
      }
      this.browser = null;
    }
  }
  
  async initialize(): Promise<void> {
    // Check if existing browser is healthy
    if (this.browser) {
      const healthy = await this.isBrowserHealthy();
      if (healthy) {
        return; // Browser is fine, no need to reinitialize
      }
      // Browser is unhealthy, force close and reinitialize
      console.log('[HighResExport] Existing browser is unhealthy, reinitializing...');
      await this.forceCloseBrowser();
    }
    
    const executablePath = findChromiumPath();
    console.log(`[HighResExport] Launching browser from: ${executablePath}`);
    
    this.browser = await puppeteer.launch({
      executablePath,
      headless: true,
      protocolTimeout: 600000, // 10 minutes — large tiled renders can exceed the 3-min default
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
        // Additional memory management flags
        '--js-flags=--max-old-space-size=4096',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check'
      ]
    });
    
    console.log('[HighResExport] Browser initialized');
  }
  
  async shutdown(): Promise<void> {
    await this.forceCloseBrowser();
    console.log('[HighResExport] Browser closed');
  }
  
  // ===== SSE EXPORT SESSION MANAGEMENT =====
  
  /**
   * Generate unique export session ID
   */
  generateExportId(): string {
    return `sse_export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Create a new SSE export session
   */
  createSSESession(exportId: string): SSEExportSessionData {
    const session: SSEExportSessionData = {
      exportId,
      status: 'pending',
      startTime: Date.now(),
      abortController: new AbortController()
    };
    this.sseExportSessions.set(exportId, session);
    console.log(`[SSE Export] Created session: ${exportId}`);
    return session;
  }
  
  /**
   * Get an SSE export session by ID
   */
  getSSESession(exportId: string): SSEExportSessionData | undefined {
    return this.sseExportSessions.get(exportId);
  }
  
  /**
   * Cancel an SSE export session
   */
  cancelSSESession(exportId: string): boolean {
    const session = this.sseExportSessions.get(exportId);
    if (session && session.status === 'processing') {
      session.abortController.abort();
      session.status = 'cancelled';
      console.log(`[SSE Export] Cancelled session: ${exportId}`);
      return true;
    }
    return false;
  }
  
  /**
   * Clean up an SSE export session — also deletes any on-disk export file
   */
  cleanupSSESession(exportId: string): void {
    const fileData = this.exportFiles.get(exportId);
    if (fileData?.filePath) {
      try { fs.unlinkSync(fileData.filePath); } catch { /* already gone */ }
    }
    this.sseExportSessions.delete(exportId);
    this.exportFiles.delete(exportId);
    console.log(`[SSE Export] Cleaned up session: ${exportId}`);
  }
  
  /**
   * Get stored export file data for download (may have buffer or filePath)
   */
  getExportFileBuffer(exportId: string): { buffer?: Buffer; filePath?: string; filename: string; mimeType: string } | undefined {
    return this.exportFiles.get(exportId);
  }
  
  /**
   * Store export file (buffer) for later download
   */
  storeExportFile(exportId: string, buffer: Buffer, filename: string, mimeType: string): void {
    this.exportFiles.set(exportId, { buffer, filename, mimeType });
    console.log(`[SSE Export] Stored file for ${exportId}: ${filename} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
  }

  /**
   * Store export file path (disk-based) for later streaming download
   */
  storeExportFilePath(exportId: string, filePath: string, filename: string, mimeType: string): void {
    const size = (() => { try { return fs.statSync(filePath).size; } catch { return 0; } })();
    this.exportFiles.set(exportId, { filePath, filename, mimeType });
    console.log(`[SSE Export] Stored file path for ${exportId}: ${filename} (${(size / 1024 / 1024).toFixed(2)} MB on disk)`);
  }
  
  /**
   * Export with SSE progress streaming
   * This wraps the existing exportImage method with structured SSE events
   */
  async exportWithSSE(
    request: HighResExportRequest,
    exportId: string,
    onProgress: SSEProgressCallback
  ): Promise<void> {
    const session = this.getSSESession(exportId);
    if (!session) {
      onProgress({
        type: 'error',
        message: 'Export session not found',
        timestamp: Date.now()
      });
      return;
    }
    
    session.status = 'processing';
    const startTime = Date.now();
    
    // Calculate estimated duration for progress tracking
    const scale = request.exportSettings.scale || 1;
    const width = Math.ceil(request.artboard.width * scale);
    const height = Math.ceil(request.artboard.height * scale);
    const pixels = width * height;
    const estimatedTotalSeconds = Math.ceil(2 + pixels / 5_000_000);
    
    // Create a tile progress callback that emits SSE events
    const sseProgressCallback: TileProgressCallback = (phase: string, current: number, total: number) => {
      const elapsedSeconds = (Date.now() - startTime) / 1000;
      const progressPct = Math.round((current / total) * 100);
      const estimatedRemaining = Math.max(0, Math.ceil((estimatedTotalSeconds * (100 - progressPct)) / 100));
      
      // Parse the phase message to determine event type
      if (phase.includes('Preparing tiles')) {
        onProgress({
          type: 'phase',
          phase: 'preparing',
          message: phase,
          timestamp: Date.now()
        });
      } else if (phase.includes('Rendering tile')) {
        // Extract tile numbers from message like "Rendering tile 3 of 12..."
        const match = phase.match(/tile (\d+) of (\d+)/);
        if (match) {
          onProgress({
            type: 'tile',
            tileIndex: parseInt(match[1], 10),
            totalTiles: parseInt(match[2], 10),
            step: 'render',
            message: phase,
            progressPct,
            timestamp: Date.now()
          });
        }
      } else if (phase.includes('Stitching')) {
        onProgress({
          type: 'phase',
          phase: 'stitching',
          message: phase,
          timestamp: Date.now()
        });
      } else if (phase.includes('Encoding')) {
        onProgress({
          type: 'phase',
          phase: 'encoding',
          message: phase,
          timestamp: Date.now()
        });
      } else if (phase.includes('Rendering image')) {
        onProgress({
          type: 'phase',
          phase: 'rendering',
          message: phase,
          timestamp: Date.now()
        });
      }
      
      // Always emit progress update
      onProgress({
        type: 'progress',
        progressPct,
        status: phase,
        estimatedSecondsRemaining: estimatedRemaining,
        timestamp: Date.now()
      });
    };
    
    try {
      // Emit initial phase
      onProgress({
        type: 'phase',
        phase: 'preparing',
        message: 'Initializing export...',
        timestamp: Date.now()
      });
      
      // Run the export with SSE progress callback
      const result = await this.exportImage(
        request,
        sseProgressCallback,
        session.abortController.signal
      );
      
      if (result.success && (result.buffer || result.filePath)) {
        const originalFilename = result.filename || `export-${exportId}.${request.exportSettings.format || 'tiff'}`;
        let finalBuffer: Buffer | undefined = result.buffer;
        let finalFilePath: string | undefined = result.filePath;
        let finalFilename = originalFilename;
        let finalMimeType = result.mimeType || 'image/tiff';
        
        // Apply compression if requested
        if (request.archiveCompression?.enabled && request.archiveCompression.format !== 'none') {
          onProgress({
            type: 'phase',
            phase: 'compressing',
            message: `Compressing with ${request.archiveCompression.format.toUpperCase()}...`,
            timestamp: Date.now()
          });
          
          try {
            // For disk-based tiled exports, read into memory only for compression.
            // NOTE: do NOT delete the original file here — keep it until compression
            // succeeds so the fallback path can still serve it on failure.
            const bufferForCompression = finalBuffer ?? fs.readFileSync(finalFilePath!);
            const compressed = await compressBuffer(
              bufferForCompression,
              originalFilename,
              request.archiveCompression
            );
            // Compression succeeded — safe to drop the original disk file now
            if (!finalBuffer && finalFilePath) {
              try { fs.unlinkSync(finalFilePath); } catch { /* ignore */ }
            }
            finalBuffer = compressed.buffer;
            finalFilePath = undefined;
            finalFilename = compressed.filename;
            finalMimeType = compressed.mimeType;
            
            console.log(`[SSE Export] Compressed: ${originalFilename} -> ${finalFilename}`);
          } catch (compressError) {
            // Compression failed — finalBuffer / finalFilePath are unchanged so
            // the original file (disk or buffer) is still available for download.
            console.error('[SSE Export] Compression failed, using original file:', compressError);
          }
        }
        
        // Store the image file for download (file path for tiled exports, buffer for small)
        if (finalFilePath) {
          this.storeExportFilePath(exportId, finalFilePath, finalFilename, finalMimeType);
        } else {
          this.storeExportFile(exportId, finalBuffer!, finalFilename, finalMimeType);
        }
        
        // Save project file if requested
        if (request.exportSettings.saveProjectFile) {
          const projectFilename = originalFilename.replace(/\.(tiff|png|jpeg|jpg|webp)$/i, '.generated.json');
          const normalizedPrintConfig = request.artboard.printConfig ? {
            ...request.artboard.printConfig,
            outputSpecs: {
              ...request.artboard.printConfig.outputSpecs,
              dpi: request.artboard.dpi ?? request.exportSettings.dpi ?? request.artboard.printConfig.outputSpecs?.dpi ?? 72,
              unitType: request.artboard.unitType ?? request.artboard.printConfig.outputSpecs?.unitType ?? 'pixels',
            },
          } : undefined;
          const normalizedArtboard = {
            ...request.artboard,
            printConfig: normalizedPrintConfig,
          };
          const projectData = {
            version: '1.0.0',
            type: 'generated',
            timestamp: new Date().toISOString(),
            shapes: request.shapes,
            groups: request.groups || [],
            enabledShapeTypes: request.enabledShapeTypes || [],
            artboards: [normalizedArtboard],
            metadata: {
              exportMode: 'artboard',
              imageFilename: originalFilename,
              shapeCount: request.shapes?.length || 0,
              description: `High-resolution export - Generated ${request.shapes?.length || 0} shapes`
            },
            exportSettings: {
              format: request.exportSettings.format,
              dpi: request.exportSettings.dpi || request.artboard.dpi || 300,
              scale: request.exportSettings.scale || 1,
              quality: request.exportSettings.quality,
              bitDepth: request.exportSettings.bitDepth ?? 8,
              colorProfile: 'sRGB',
              backgroundMode: request.exportSettings.backgroundMode || 'transparent',
              compression: request.exportSettings.compression ?? 'none',
              printConfig: request.artboard.printConfig ? {
                bleed: {
                  enabled: request.artboard.printConfig.overlays?.bleed?.render,
                  amount: request.artboard.printConfig.overlays?.bleed?.amount,
                  unit: request.artboard.printConfig.overlays?.overlayUnit
                },
                printMarks: {
                  enabled: request.artboard.printConfig.overlays?.printMarks?.render,
                  cropMarks: request.artboard.printConfig.overlays?.printMarks?.cropMarks,
                  registrationMarks: request.artboard.printConfig.overlays?.printMarks?.registrationMarks
                }
              } : null
            }
          };
          
          const projectJson = JSON.stringify(projectData, null, 2);
          const projectBuffer = Buffer.from(projectJson, 'utf-8');
          
          // Store project file with a separate key
          this.storeExportFile(`${exportId}_project`, projectBuffer, projectFilename, 'application/json');
          console.log(`[SSE Export] Saved project file: ${projectFilename}`);
        }
        
        // Update session
        session.status = 'completed';
        session.filename = finalFilename;
        session.downloadUrl = `/api/export/highres/download/${exportId}`;
        session.dimensions = { width: result.width || width, height: result.height || height };
        session.sizeBytes = finalBuffer?.length ?? (finalFilePath ? (() => { try { return fs.statSync(finalFilePath!).size; } catch { return 0; } })() : 0);
        
        // Emit completion event
        const completionEvent: any = {
          type: 'complete',
          downloadUrl: session.downloadUrl,
          filename: finalFilename,
          contentType: finalMimeType,
          sizeBytes: session.sizeBytes,
          dimensions: session.dimensions,
          timestamp: Date.now()
        };
        
        // Add project file URL if saved
        if (request.exportSettings.saveProjectFile) {
          completionEvent.projectDownloadUrl = `/api/export/highres/download/${exportId}_project`;
          completionEvent.projectFilename = originalFilename.replace(/\.(tiff|png|jpeg|jpg|webp)$/i, '.generated.json');
        }
        
        onProgress(completionEvent);
        
        console.log(`[SSE Export] Completed: ${exportId} - ${finalFilename}`);
      } else {
        session.status = 'error';
        session.error = result.error || 'Export failed';
        
        onProgress({
          type: 'error',
          message: result.error || 'Export failed',
          timestamp: Date.now()
        });
      }
    } catch (error) {
      session.status = 'error';
      session.error = error instanceof Error ? error.message : 'Unknown error';
      
      onProgress({
        type: 'error',
        message: session.error,
        timestamp: Date.now()
      });
      
      console.error(`[SSE Export] Error: ${exportId}`, error);
    }
  }
  
  async exportImage(
    request: HighResExportRequest,
    progressCallback?: TileProgressCallback,
    abortSignal?: AbortSignal
  ): Promise<HighResExportResult> {
    const startTime = Date.now();
    
    try {
      // Check for abort before starting
      if (abortSignal?.aborted) {
        return { success: false, error: 'Export cancelled', duration: 0 };
      }
      
      await this.initialize();
      
      if (!this.browser) {
        throw new Error('Browser not initialized');
      }
      
      const page = await this.browser.newPage();
      
      try {
        const result = await this.renderAndCapture(page, request, progressCallback, abortSignal);
        return {
          ...result,
          duration: Date.now() - startTime
        };
      } finally {
        // Page may already be closed by renderTiled during page recycling for memory management
        // Wrap in try-catch to handle this gracefully
        try {
          await page.close();
        } catch (closeError) {
          // Expected when renderTiled recycled the page - not an error
          console.log('[HighResExport] Page already closed (expected for tiled exports with page recycling)');
        }
      }
    } catch (error) {
      console.error('[HighResExport] Export failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime
      };
    }
  }
  
  private async renderAndCapture(
    page: Page,
    request: HighResExportRequest,
    progressCallback?: TileProgressCallback,
    abortSignal?: AbortSignal
  ): Promise<HighResExportResult> {
    const { shapes, groups = [], artboard, exportSettings } = request;
    const { format = 'tiff', bitDepth = 16, scale = 1, backgroundMode = 'transparent', compression = 'none' } = exportSettings;
    
    const effectiveDpi = exportSettings.dpi || artboard.printConfig?.outputSpecs?.dpi || artboard.dpi || 300;
    
    let bleedPx = 0;
    let safeZonePx = 0;
    let printMarksGutterPx = 0;
    let singlePassPrintMarksConfig: {
      enabled: boolean;
      cropMarks: boolean;
      registrationMarks: boolean;
      markLengthPx: number;
      markOffsetPx: number;
      color: string;
    } | null = null;
    
    if (artboard.printConfig) {
      const config = artboard.printConfig;
      const overlayUnit = config.overlays?.overlayUnit || 'pixels';
      
      if (exportSettings.includeBleed && config.overlays?.bleed?.render && config.overlays?.bleed?.amount > 0) {
        bleedPx = convertUnitToPixels(config.overlays.bleed.amount, overlayUnit, effectiveDpi);
      }
      
      if (config.overlays?.safeZone?.display && config.overlays?.safeZone?.amount > 0) {
        safeZonePx = convertUnitToPixels(config.overlays.safeZone.amount, overlayUnit, effectiveDpi);
      }
      
      if (exportSettings.includePrintMarks && config.overlays?.printMarks?.render) {
        const scaleMode = config.overlays.printMarks.scaleMode || 'none';
        let markLengthPx: number;
        let markOffsetPx: number;
        
        if (scaleMode === 'percent') {
          const minDimension = Math.min(artboard.width, artboard.height);
          markLengthPx = (config.overlays.printMarks.markLength / 100) * minDimension;
          markOffsetPx = (config.overlays.printMarks.markOffset / 100) * minDimension;
        } else {
          markLengthPx = convertUnitToPixels(config.overlays.printMarks.markLength, overlayUnit, effectiveDpi);
          markOffsetPx = convertUnitToPixels(config.overlays.printMarks.markOffset, overlayUnit, effectiveDpi);
        }
        
        printMarksGutterPx = markLengthPx + markOffsetPx + 5;
        singlePassPrintMarksConfig = {
          enabled: true,
          cropMarks: config.overlays.printMarks.cropMarks ?? false,
          registrationMarks: config.overlays.printMarks.registrationMarks ?? false,
          markLengthPx,
          markOffsetPx,
          color: config.overlays.printMarks.color || '#000000'
        };
      }
    }
    
    const printExpansion = bleedPx + printMarksGutterPx;

    // For 'all' or 'selection' export modes, compute the world-space bounding box of
    // all shapes instead of constraining canvas to artboard dimensions.
    // originX/Y is the offset subtracted from shape transforms when rendering.
    const exportModeReq = request.exportMode || 'artboard';
    let originX = artboard.x || 0;
    let originY = artboard.y || 0;
    let baseWidth = artboard.width;
    let baseHeight = artboard.height;

    if (exportModeReq === 'all' || exportModeReq === 'selection') {
      const allShapesForBounds = [
        ...shapes,
        ...(groups || []).flatMap((g: any) => Array.isArray(g.shapes) ? g.shapes : [])
      ];
      if (allShapesForBounds.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const shape of allShapesForBounds) {
          const tx = shape.transform?.x || 0;
          const ty = shape.transform?.y || 0;
          if (shape.points && shape.points.length > 0) {
            for (const p of shape.points) {
              minX = Math.min(minX, tx + p.x);
              minY = Math.min(minY, ty + p.y);
              maxX = Math.max(maxX, tx + p.x);
              maxY = Math.max(maxY, ty + p.y);
            }
          } else {
            const hw = (shape.width || 100) / 2;
            const hh = (shape.height || 100) / 2;
            minX = Math.min(minX, tx - hw);
            minY = Math.min(minY, ty - hh);
            maxX = Math.max(maxX, tx + hw);
            maxY = Math.max(maxY, ty + hh);
          }
        }
        if (isFinite(minX)) {
          const pad = 0; // no padding; shapes already include stroke in their points
          originX = minX - pad;
          originY = minY - pad;
          baseWidth  = Math.max(1, maxX - minX + pad * 2);
          baseHeight = Math.max(1, maxY - minY + pad * 2);
          console.log(`[HighResExport] exportMode=${exportModeReq}: shape bounds origin=(${originX.toFixed(1)},${originY.toFixed(1)}) size=${baseWidth.toFixed(1)}x${baseHeight.toFixed(1)}`);
        }
      }
    }

    const canvasWidth = Math.ceil((baseWidth + printExpansion * 2) * scale);
    const canvasHeight = Math.ceil((baseHeight + printExpansion * 2) * scale);
    
    console.log(`[HighResExport] Rendering ${canvasWidth}x${canvasHeight} canvas at ${effectiveDpi} DPI`);
    
    let bgColor = 'transparent';
    if (backgroundMode === 'artboard') {
      bgColor = artboard.backgroundColor || '#ffffff';
    } else if (backgroundMode === 'custom' && exportSettings.backgroundColor) {
      bgColor = exportSettings.backgroundColor;
    }
    
    const shouldFlattenToRgb = exportSettings.flattenToRgb || 
      (backgroundMode === 'artboard' || backgroundMode === 'custom');
    
    // Check if tiling is needed for large exports
    const channels = shouldFlattenToRgb ? 3 : 4;
    const tilePlan = planTiles(canvasWidth, canvasHeight, channels, bitDepth);
    
    if (tilePlan.needsTiling) {
      console.log(`[HighResExport] Using tiled rendering: ${tilePlan.cols}x${tilePlan.rows} = ${tilePlan.totalTiles} tiles`);
      return this.renderTiled(page, request, tilePlan, {
        canvasWidth,
        canvasHeight,
        effectiveDpi,
        bgColor,
        bleedPx,
        safeZonePx,
        printMarksGutterPx,
        printExpansion,
        scale,
        shouldFlattenToRgb
      }, progressCallback, abortSignal);
    }
    
    // Single-pass rendering for smaller images
    progressCallback?.('Rendering image...', 1, 3);
    
    // originX/Y: the viewport coordinate that maps to canvas (0,0).
    // For artboard mode this is artboard.x/y; for all/selection mode it is the
    // computed shape-bounds origin set above.
    const renderData = {
      shapes,
      groups,
      artboard: {
        ...artboard,
        printConfig: artboard.printConfig
      },
      exportSettings: {
        ...exportSettings,
        dpi: effectiveDpi,
        bleedPx,
        safeZonePx,
        printMarksGutterPx,
        printExpansion,
        backgroundColor: bgColor,
        printMarksConfig: singlePassPrintMarksConfig
      },
      originX,
      originY,
      canvasWidth,
      canvasHeight,
      scale
    };
    
    const templateHtml = this.generateRendererHtml(renderData);
    
    await page.setViewport({
      width: Math.max(canvasWidth, 800),
      height: Math.max(canvasHeight, 600),
      deviceScaleFactor: 1
    });
    
    await page.setContent(templateHtml, { waitUntil: 'networkidle0' });
    
    const renderResult = await page.evaluate(() => {
      return (window as any).renderShapes();
    });
    
    if (!renderResult.success) {
      throw new Error(`Render failed: ${renderResult.error}`);
    }
    
    const pngDataUrl = await page.evaluate(() => {
      const canvas = document.getElementById('exportCanvas') as HTMLCanvasElement;
      return canvas.toDataURL('image/png');
    });
    
    const pngBuffer = Buffer.from(pngDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    
    console.log(`[HighResExport] Captured PNG buffer: ${(pngBuffer.length / 1024).toFixed(1)} KB`);
    
    // Extract metadata fields from exportSettings
    const metadataOptions = {
      dpi: effectiveDpi,
      artistName: exportSettings.artistName,
      copyrightText: exportSettings.copyrightText,
      imageTitle: exportSettings.imageTitle,
      imageDescription: exportSettings.imageDescription,
      embedIccProfile: exportSettings.embedIccProfile !== false
    };
    
    if (format === 'png') {
      progressCallback?.('Encoding PNG with metadata...', 2, 3);
      const pngWithMetadata = await this.applyPngMetadata(pngBuffer, metadataOptions);
      progressCallback?.('Complete', 3, 3);
      return {
        success: true,
        buffer: pngWithMetadata,
        mimeType: 'image/png',
        filename: `export-${Date.now()}.png`,
        width: canvasWidth,
        height: canvasHeight
      };
    }
    
    // Handle JPEG format
    if (format === 'jpeg') {
      progressCallback?.('Encoding JPEG with metadata...', 2, 3);
      const quality = exportSettings.quality ?? 90;
      const jpegBuffer = await sharp(pngBuffer, { limitInputPixels: false })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      const jpegWithMetadata = await this.applyJpegMetadata(jpegBuffer, { ...metadataOptions, quality });
      progressCallback?.('Complete', 3, 3);
      return {
        success: true,
        buffer: jpegWithMetadata,
        mimeType: 'image/jpeg',
        filename: `export-${Date.now()}.jpg`,
        width: canvasWidth,
        height: canvasHeight
      };
    }
    
    // Handle WebP format
    if (format === 'webp') {
      progressCallback?.('Encoding WebP with metadata...', 2, 3);
      const quality = exportSettings.quality ?? 90;
      const webpBuffer = await sharp(pngBuffer, { limitInputPixels: false })
        .webp({ quality, lossless: quality === 100 })
        .toBuffer();
      const webpWithMetadata = await this.applyWebpMetadata(webpBuffer, { ...metadataOptions, quality });
      progressCallback?.('Complete', 3, 3);
      return {
        success: true,
        buffer: webpWithMetadata,
        mimeType: 'image/webp',
        filename: `export-${Date.now()}.webp`,
        width: canvasWidth,
        height: canvasHeight
      };
    }
    
    // Handle PDF format
    if (format === 'pdf') {
      progressCallback?.('Creating PDF with metadata...', 2, 3);
      
      console.log(`[HighResExport] PDF conversion: canvas ${canvasWidth}x${canvasHeight}px, bleedPx=${bleedPx}, printMarksGutterPx=${printMarksGutterPx}, printExpansion=${printExpansion} (buffer ${(pngBuffer.length / 1024).toFixed(1)} KB)`);
      
      // Create a sub-progress callback to emit SSE events during PDF conversion
      const pdfProgressCallback = (message: string) => {
        progressCallback?.(message, 2, 3);
      };
      
      // convertToPdf returns a file path — stream directly from disk, no buffer spike
      const pdfFilePath = await this.convertToPdf(pngBuffer, {
        width: canvasWidth,
        height: canvasHeight,
        dpi: effectiveDpi,
        artistName: exportSettings.artistName,
        copyrightText: exportSettings.copyrightText,
        imageTitle: exportSettings.imageTitle || 'Untitled Artwork',
        imageDescription: exportSettings.imageDescription,
        embedIccProfile: exportSettings.embedIccProfile !== false
      }, pdfProgressCallback);
      
      const pdfSize = (() => { try { return fs.statSync(pdfFilePath).size; } catch { return 0; } })();
      console.log(`[HighResExport] Generated PDF: ${(pdfSize / 1024 / 1024).toFixed(2)} MB`);
      
      progressCallback?.('Complete', 3, 3);
      return {
        success: true,
        filePath: pdfFilePath,
        mimeType: 'application/pdf',
        filename: `export-${Date.now()}.pdf`,
        width: canvasWidth,
        height: canvasHeight
      };
    }
    
    progressCallback?.('Encoding TIFF with metadata...', 2, 3);
    
    const tiffBuffer = await this.convertToTiff(pngBuffer, {
      bitDepth,
      dpi: effectiveDpi,
      compression: compression as 'none' | 'deflate',
      flattenToRgb: shouldFlattenToRgb,
      matteColor: exportSettings.matteColor || '#ffffff',
      artistName: exportSettings.artistName,
      copyrightText: exportSettings.copyrightText,
      imageTitle: exportSettings.imageTitle,
      imageDescription: exportSettings.imageDescription,
      embedIccProfile: exportSettings.embedIccProfile !== false
    });
    
    console.log(`[HighResExport] Generated TIFF: ${(tiffBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    progressCallback?.('Complete', 3, 3);
    
    return {
      success: true,
      buffer: tiffBuffer,
      mimeType: 'image/tiff',
      filename: `export-${Date.now()}.tiff`,
      width: canvasWidth,
      height: canvasHeight
    };
  }
  
  /**
   * Tiled rendering for very large exports
   * Renders each tile separately and composites them using Sharp
   * Note: This function now manages its own page lifecycle to handle memory pressure better
   */
  private async renderTiled(
    page: Page,
    request: HighResExportRequest,
    tilePlan: TilePlan,
    renderConfig: {
      canvasWidth: number;
      canvasHeight: number;
      effectiveDpi: number;
      bgColor: string;
      bleedPx: number;
      safeZonePx: number;
      printMarksGutterPx: number;
      printExpansion: number;
      scale: number;
      shouldFlattenToRgb: boolean;
    },
    progressCallback?: TileProgressCallback,
    abortSignal?: AbortSignal
  ): Promise<HighResExportResult> {
    const { shapes, groups = [], artboard, exportSettings } = request;
    const { format = 'tiff', bitDepth = 16, compression = 'none' } = exportSettings;
    const { canvasWidth, canvasHeight, effectiveDpi, bgColor, bleedPx, safeZonePx, printMarksGutterPx, printExpansion, scale, shouldFlattenToRgb } = renderConfig;
    
    // Calculate total steps for progress: 1 (prep) + tiles + 1 (stitch) + 1 (encode)
    const totalSteps = 1 + tilePlan.totalTiles + 1 + 1;
    let currentStep = 0;
    
    // For tiled rendering, we'll manage pages per-tile to handle memory pressure
    // Close the passed-in page immediately - we'll create fresh pages per tile
    let currentPage: Page = page;
    const TILES_BEFORE_PAGE_REFRESH = 6; // Recreate page every N tiles to prevent memory buildup
    
    // Phase 1: Preparing tiles
    progressCallback?.(`Preparing tiles (${tilePlan.cols}x${tilePlan.rows} grid)...`, ++currentStep, totalSteps);
    console.log(`[HighResExport] Starting tiled render: ${tilePlan.totalTiles} tiles`);
    
    // Create base canvas for compositing with Sharp
    // Parse background color for Sharp
    let sharpBackground: { r: number; g: number; b: number; alpha?: number };
    if (bgColor === 'transparent') {
      sharpBackground = { r: 0, g: 0, b: 0, alpha: 0 };
    } else {
      const hexMatch = bgColor.match(/^#?([0-9a-fA-F]{6})$/);
      sharpBackground = {
        r: hexMatch ? parseInt(hexMatch[1].substring(0, 2), 16) : 255,
        g: hexMatch ? parseInt(hexMatch[1].substring(2, 4), 16) : 255,
        b: hexMatch ? parseInt(hexMatch[1].substring(4, 6), 16) : 255
      };
    }
    
    // Create the full-size canvas as a Sharp instance
    // Set limitInputPixels to false to allow processing very large print files (A0+ at 600 DPI)
    // IMPORTANT: Always use 4 channels (RGBA) for compositing to avoid channel mismatch issues
    // The flatten to RGB happens in convertToTiff() if shouldFlattenToRgb is true
    // Pre-compute overlay parameters once before the tile loop so they can be embedded in each tile
    // Part C: overlays are now rendered per-tile inside Puppeteer instead of post-stitch in Sharp
    const overlayUnit = artboard.printConfig?.overlays?.overlayUnit || 'pixels';
    const printMarksOverlayCfg = artboard.printConfig?.overlays?.printMarks;
    let tileOverlayMarkLengthPx = 0;
    let tileOverlayMarkOffsetPx = 0;
    if (exportSettings.includePrintMarks && printMarksOverlayCfg?.render) {
      const scaleMode = printMarksOverlayCfg.scaleMode || 'none';
      if (scaleMode === 'percent') {
        const minDimension = Math.min(artboard.width, artboard.height);
        tileOverlayMarkLengthPx = (printMarksOverlayCfg.markLength / 100) * minDimension;
        tileOverlayMarkOffsetPx = (printMarksOverlayCfg.markOffset / 100) * minDimension;
      } else {
        tileOverlayMarkLengthPx = convertUnitToPixels(printMarksOverlayCfg.markLength, overlayUnit, effectiveDpi);
        tileOverlayMarkOffsetPx = convertUnitToPixels(printMarksOverlayCfg.markOffset, overlayUnit, effectiveDpi);
      }
    }
    
    // Tile temp files for row-by-row strip stitching (Part B)
    const tileTempFiles: string[] = [];
    const tileTempDir = this.exportTempDir;
    const tileTimestamp = Date.now();

    // Cleanup all tile (and later: row strip, stitched) temp files.
    // Declared before the tile loop so it's usable in all error/cancel paths.
    const cleanupTileFiles = () => {
      for (const f of tileTempFiles) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
      }
    };

    // Set up console listener ONCE before the loop (not inside)
    const setupConsoleListener = (pg: any) => {
      pg.on('console', (msg: any) => {
        const text = msg.text();
        if (text.includes('TILE_RENDER') || text.includes('TILE DEBUG')) {
          console.log(`[Puppeteer Console] ${text}`);
        }
      });
    };
    setupConsoleListener(currentPage);
    
    // Phase 2: Render each tile
    for (const tile of tilePlan.tiles) {
      // Check for abort
      if (abortSignal?.aborted) {
        cleanupTileFiles();
        console.log('[HighResExport] Tiled export cancelled');
        if (currentPage !== page) {
          try { await currentPage.close(); } catch { /* ignore */ }
        }
        return { success: false, error: 'Export cancelled' };
      }
      
      // Refresh the page every N tiles to prevent memory buildup
      // This creates a fresh page context and releases memory from previous renders
      if (tile.index > 0 && tile.index % TILES_BEFORE_PAGE_REFRESH === 0) {
        console.log(`[HighResExport] Refreshing page after ${tile.index} tiles to manage memory`);
        try {
          await currentPage.close();
        } catch {
          console.log('[HighResExport] Previous page already closed');
        }
        
        // Check browser health and reinitialize if needed
        if (!await this.isBrowserHealthy()) {
          console.log('[HighResExport] Browser became unhealthy, reinitializing...');
          await this.forceCloseBrowser();
          await this.initialize();
        }
        
        if (!this.browser) {
          throw new Error('Browser not available after reinitialization');
        }
        
        // Retry page creation up to 3 times — under memory pressure the CDP handshake
        // can transiently fail even with a raised protocolTimeout
        let pageCreated = false;
        for (let attempt = 0; attempt <= 2; attempt++) {
          try {
            currentPage = await this.browser!.newPage();
            pageCreated = true;
            break;
          } catch (pageErr) {
            console.log(`[HighResExport] Page creation attempt ${attempt + 1} failed: ${pageErr instanceof Error ? pageErr.message : pageErr}`);
            if (attempt < 2) {
              await new Promise(r => setTimeout(r, 3000));
            }
          }
        }
        if (!pageCreated) {
          throw new Error('Failed to create new page after 3 attempts');
        }
        setupConsoleListener(currentPage);
        console.log('[HighResExport] Created fresh page for remaining tiles');
      }
      
      progressCallback?.(`Rendering tile ${tile.index + 1} of ${tilePlan.totalTiles}...`, ++currentStep, totalSteps);
      console.log(`[HighResExport] Rendering tile ${tile.index + 1}/${tilePlan.totalTiles} at (${tile.x}, ${tile.y}) size ${tile.width}x${tile.height}`);
      
      // Generate HTML for this tile with offset translation
      // Keep artboard.x/y as-is - shapes have viewport coordinates and
      // renderShape() correctly subtracts artboard position to get artboard-relative coords
      const tileRenderData = {
        shapes,
        groups,
        artboard: {
          ...artboard,
          printConfig: artboard.printConfig
        },
        exportSettings: {
          ...exportSettings,
          dpi: effectiveDpi,
          bleedPx,
          printMarksGutterPx,
          printExpansion,
          backgroundColor: bgColor,
          safeZonePx,
          printMarksConfig: (exportSettings.includePrintMarks && printMarksOverlayCfg?.render) ? {
            enabled: true,
            cropMarks: printMarksOverlayCfg.cropMarks,
            registrationMarks: printMarksOverlayCfg.registrationMarks,
            markLengthPx: tileOverlayMarkLengthPx,
            markOffsetPx: tileOverlayMarkOffsetPx,
            color: printMarksOverlayCfg.color || '#000000'
          } : null
        },
        canvasWidth: tile.width,
        canvasHeight: tile.height,
        scale,
        // Tile offset for translation
        tileOffsetX: tile.x,
        tileOffsetY: tile.y,
        fullCanvasWidth: canvasWidth,
        fullCanvasHeight: canvasHeight,
        // For debug labeling
        tileIndex: tile.index + 1
      };
      
      const tileHtml = this.generateTileRendererHtml(tileRenderData);
      
      // DEBUG: Log HTML offset values for ALL tiles to verify correct generation
      const tileOffsetMatch = tileHtml.match(/TILE_OFFSET_X = (\d+)/);
      const tileOffsetYMatch = tileHtml.match(/TILE_OFFSET_Y = (\d+)/);
      console.log(`[HighResExport] Tile ${tile.index + 1} HTML contains: TILE_OFFSET_X=${tileOffsetMatch?.[1] || 'NOT_FOUND'}, TILE_OFFSET_Y=${tileOffsetYMatch?.[1] || 'NOT_FOUND'}`);
      if (tile.index === 0) {
        // Also check for our debug marker on first tile
        const hasDebugMarker = tileHtml.includes('TILE_RENDER_V2');
        console.log(`[HighResExport] Tile 1 HTML has TILE_RENDER_V2 marker: ${hasDebugMarker}`);
      }
      
      await currentPage.setViewport({
        width: Math.max(tile.width, 800),
        height: Math.max(tile.height, 600),
        deviceScaleFactor: 1
      });
      
      // CRITICAL: Navigate to about:blank BEFORE setContent to force a clean JavaScript state
      // This prevents the previous tile's JavaScript from persisting due to Puppeteer/Chromium caching
      await currentPage.goto('about:blank', { waitUntil: 'domcontentloaded' });
      
      await currentPage.setContent(tileHtml, { waitUntil: 'networkidle0' });
      
      const tileRenderResult = await currentPage.evaluate(() => {
        return (window as any).renderShapes();
      });
      
      // Log debug info for ALL tiles to see offset values
      console.log(`[HighResExport] Tile ${tile.index + 1} render result: tileOffset=(${tile.x}, ${tile.y}), shapesRendered=${tileRenderResult.shapesRendered || 'N/A'}, calculatedScale=${tileRenderResult.debug?.calculatedScale || 'N/A'}`);
      if (tile.index === 0 && tileRenderResult.debug) {
        console.log(`[HighResExport] Tile 1 debug:`, JSON.stringify(tileRenderResult.debug, null, 2));
      }
      
      if (!tileRenderResult.success) {
        // Clean up page before throwing
        if (currentPage !== page) {
          try { await currentPage.close(); } catch { /* ignore */ }
        }
        throw new Error(`Tile ${tile.index + 1} render failed: ${tileRenderResult.error}`);
      }
      
      const tilePngDataUrl = await currentPage.evaluate(() => {
        const canvas = document.getElementById('exportCanvas') as HTMLCanvasElement;
        return canvas.toDataURL('image/png');
      });
      
      const tilePngBuffer = Buffer.from(tilePngDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
      console.log(`[HighResExport] Tile ${tile.index + 1} captured: ${(tilePngBuffer.length / 1024).toFixed(1)} KB`);
      
      // Write tile immediately to disk — avoids accumulating all tile buffers in RAM (Part B)
      const tileTempFile = path.join(tileTempDir, `tile_${tile.index}_${tileTimestamp}.png`);
      await sharp(tilePngBuffer, { limitInputPixels: false })
        .ensureAlpha()
        .png()
        .toFile(tileTempFile);
      tileTempFiles.push(tileTempFile);
      console.log(`[HighResExport] Tile ${tile.index + 1} written to disk: ${tileTempFile}`);
    }
    
    // Close the current page after all tiles are done (if it's different from original)
    if (currentPage !== page) {
      try { await currentPage.close(); } catch { /* ignore */ }
    }
    
    // Check for abort before stitching — clean up tile files first
    if (abortSignal?.aborted) {
      cleanupTileFiles();
      console.log('[HighResExport] Tiled export cancelled before stitching');
      return { success: false, error: 'Export cancelled' };
    }

    // Phase 3: Stitch tiles using row-by-row strip compositing (Part B)
    // Each row is composited horizontally into a PNG strip file (no raw RGBA accumulation).
    // All row strip files are then composited vertically via file-path references so Sharp
    // reads from disk — peak Node.js memory is proportional to one row at a time.
    // Overlays (bleed, safe zone, print marks) are baked into tiles by Puppeteer (Part C).
    progressCallback?.('Stitching tiles...', ++currentStep, totalSteps);
    console.log(`[HighResExport] Stitching ${tileTempFiles.length} tiles using row-by-row strip stitching`);

    const tempDir = this.exportTempDir;
    const timestamp = tileTimestamp;
    let currentTempFile = path.join(tempDir, `stitched_${timestamp}.png`);
    // tempFilesToCleanup tracks row strip files and the final stitched file for cleanup.
    // Tile files are covered by cleanupTileFiles() (declared before the tile loop).
    const tempFilesToCleanup: string[] = [];

    const stripBackground = bgColor === 'transparent'
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : { r: sharpBackground.r, g: sharpBackground.g, b: sharpBackground.b, alpha: 255 };

    try {
      // Step 1: Composite each row's tiles horizontally into a PNG strip file
      const rowStripFiles: string[] = [];

      for (let row = 0; row < tilePlan.rows; row++) {
        const rowTiles = tilePlan.tiles.filter((_t, i) => Math.floor(i / tilePlan.cols) === row);
        const rowHeight = rowTiles[0].height;

        const rowCompositeInputs = rowTiles.map(tile => ({
          input: tileTempFiles[tile.index],
          left: tile.x,
          top: 0
        }));

        const rowStripFile = path.join(tempDir, `row_${row}_${timestamp}.png`);
        await (sharp({
          create: { width: canvasWidth, height: rowHeight, channels: 4, background: stripBackground },
          limitInputPixels: false
        } as any) as any)
          .composite(rowCompositeInputs)
          .png()
          .toFile(rowStripFile);

        rowStripFiles.push(rowStripFile);
        tempFilesToCleanup.push(rowStripFile);
        console.log(`[HighResExport] Stitched row ${row + 1}/${tilePlan.rows}`);
      }

      // Step 2: Composite all row strip files vertically via file-path references.
      // Sharp reads each strip from disk rather than from Node.js heap, so peak Node.js
      // memory is proportional to the output buffer/file rather than the full raw image.
      const verticalCompositeInputs = rowStripFiles.map((rowFile, row) => ({
        input: rowFile,
        left: 0,
        top: tilePlan.tiles[row * tilePlan.cols].y
      }));

      await (sharp({
        create: { width: canvasWidth, height: canvasHeight, channels: 4, background: stripBackground },
        limitInputPixels: false
      } as any) as any)
        .composite(verticalCompositeInputs)
        .png()
        .toFile(currentTempFile);

      tempFilesToCleanup.push(currentTempFile);
      const stitchedStats = fs.statSync(currentTempFile);
      console.log(`[HighResExport] Stitched image written to: ${currentTempFile} (${(stitchedStats.size / 1024 / 1024).toFixed(2)} MB)`);

    } catch (stitchErr) {
      cleanupTileFiles();
      for (const f of tempFilesToCleanup) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
      }
      throw stitchErr;
    }

    // Extract metadata fields for tiled exports
    const tiledMetadataOptions = {
      dpi: effectiveDpi,
      artistName: exportSettings.artistName,
      copyrightText: exportSettings.copyrightText,
      imageTitle: exportSettings.imageTitle,
      imageDescription: exportSettings.imageDescription,
      embedIccProfile: exportSettings.embedIccProfile !== false
    };
    
    // Helper function to clean up temp files
    const cleanupTempFiles = () => {
      for (const f of tempFilesToCleanup) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
      }
    };
    
    // For all formats, we write to a temp file first, then read back at the end.
    // Wrapped in try/finally so tile temp files are always deleted regardless of
    // which format branch runs, whether it succeeds, or whether it throws.
    try {
    if (format === 'png') {
      progressCallback?.('Encoding PNG with metadata...', ++currentStep, totalSteps);
      const finalPngFile = path.join(tempDir, `final_${timestamp}.png`);
      
      // Apply metadata and write to file
      await sharp(currentTempFile, { limitInputPixels: false })
        .ensureAlpha()
        .withMetadata(this.buildImageMetadata(tiledMetadataOptions))
        .png({ compressionLevel: 6, adaptiveFiltering: true, palette: false })
        .toFile(finalPngFile);
      
      // Cleanup tile temp files — final file stays on disk for streaming
      cleanupTempFiles();
      
      progressCallback?.('Complete', totalSteps, totalSteps);
      return {
        success: true,
        filePath: finalPngFile,
        mimeType: 'image/png',
        filename: `export-${Date.now()}.png`,
        width: canvasWidth,
        height: canvasHeight
      };
    }
    
    // Handle JPEG format
    if (format === 'jpeg') {
      progressCallback?.('Encoding final JPEG with metadata...', ++currentStep, totalSteps);
      const quality = exportSettings.quality ?? 90;
      const finalJpegFile = path.join(tempDir, `final_${timestamp}.jpg`);
      
      // Encode JPEG and write to file
      await sharp(currentTempFile, { limitInputPixels: false })
        .withMetadata(this.buildImageMetadata(tiledMetadataOptions))
        .jpeg({ quality, mozjpeg: true })
        .toFile(finalJpegFile);
      
      // Cleanup tile temp files — final file stays on disk for streaming
      cleanupTempFiles();
      
      progressCallback?.('Complete', totalSteps, totalSteps);
      return {
        success: true,
        filePath: finalJpegFile,
        mimeType: 'image/jpeg',
        filename: `export-${Date.now()}.jpg`,
        width: canvasWidth,
        height: canvasHeight
      };
    }
    
    // Handle WebP format
    if (format === 'webp') {
      progressCallback?.('Encoding final WebP with metadata...', ++currentStep, totalSteps);
      const quality = exportSettings.quality ?? 90;
      const finalWebpFile = path.join(tempDir, `final_${timestamp}.webp`);
      
      // Build metadata without EXIF for WebP
      const webpMetadata = this.buildImageMetadata(tiledMetadataOptions);
      delete webpMetadata.exif;
      
      // Encode WebP and write to file
      await sharp(currentTempFile, { limitInputPixels: false })
        .withMetadata(webpMetadata)
        .webp({ quality, lossless: quality === 100 })
        .toFile(finalWebpFile);
      
      // Cleanup tile temp files — final file stays on disk for streaming
      cleanupTempFiles();
      
      progressCallback?.('Complete', totalSteps, totalSteps);
      return {
        success: true,
        filePath: finalWebpFile,
        mimeType: 'image/webp',
        filename: `export-${Date.now()}.webp`,
        width: canvasWidth,
        height: canvasHeight
      };
    }
    
    // Handle PDF format (tiled)
    if (format === 'pdf') {
      progressCallback?.('Creating PDF with metadata...', ++currentStep, totalSteps);
      
      // Determine output path up front so the worker writes directly to it.
      // This eliminates both the readFileSync (PNG→heap) and writeFileSync (PDF buffer→disk).
      const finalPdfFile = path.join(tempDir, `final_${timestamp}.pdf`);
      
      // Create a sub-progress callback to emit SSE events during PDF conversion
      // This is critical for large images where PDF conversion can take 60+ seconds
      const pdfProgressCallback = (message: string) => {
        progressCallback?.(message, currentStep, totalSteps);
      };
      
      // Use file-path variant: PNG is read inside the worker thread, PDF written directly to disk.
      // The main-thread heap never holds the PNG buffer or the encoded PDF.
      await this.convertToPdfToFile(currentTempFile, finalPdfFile, {
        width: canvasWidth,
        height: canvasHeight,
        dpi: effectiveDpi,
        artistName: exportSettings.artistName,
        copyrightText: exportSettings.copyrightText,
        imageTitle: exportSettings.imageTitle || 'Untitled Artwork',
        imageDescription: exportSettings.imageDescription,
        embedIccProfile: exportSettings.embedIccProfile !== false
      }, pdfProgressCallback);
      
      // Cleanup tile temp files — final PDF file stays on disk for streaming
      cleanupTempFiles();
      
      const pdfSize = (() => { try { return fs.statSync(finalPdfFile).size; } catch { return 0; } })();
      console.log(`[HighResExport] Final PDF: ${(pdfSize / 1024 / 1024).toFixed(2)} MB`);
      
      progressCallback?.('Complete', totalSteps, totalSteps);
      return {
        success: true,
        filePath: finalPdfFile,
        mimeType: 'application/pdf',
        filename: `export-${Date.now()}.pdf`,
        width: canvasWidth,
        height: canvasHeight
      };
    }
    
    // Phase 4: Encode to TIFF with full metadata (file-based, direct disk write)
    progressCallback?.('Encoding final TIFF with metadata...', ++currentStep, totalSteps);
    
    // Determine output path up front so Sharp writes directly to it.
    // This eliminates the readFileSync (temp→heap) + writeFileSync (buffer→disk) round-trip.
    const finalTiffFile = path.join(tempDir, `final_${timestamp}.tiff`);
    
    // Use file-based TIFF conversion: reads from input file, writes directly to output file.
    // The main-thread heap never holds the encoded TIFF buffer.
    await this.convertToTiffFromFile(currentTempFile, finalTiffFile, {
      bitDepth,
      dpi: effectiveDpi,
      compression: compression as 'none' | 'deflate',
      flattenToRgb: shouldFlattenToRgb,
      matteColor: exportSettings.matteColor || '#ffffff',
      artistName: exportSettings.artistName,
      copyrightText: exportSettings.copyrightText,
      imageTitle: exportSettings.imageTitle,
      imageDescription: exportSettings.imageDescription,
      embedIccProfile: exportSettings.embedIccProfile !== false
    });
    
    // Cleanup tile temp files — final TIFF file stays on disk for streaming
    cleanupTempFiles();
    
    const tiffSize = (() => { try { return fs.statSync(finalTiffFile).size; } catch { return 0; } })();
    console.log(`[HighResExport] Final TIFF: ${(tiffSize / 1024 / 1024).toFixed(2)} MB`);
    
    progressCallback?.('Complete', totalSteps, totalSteps);
    
    return {
      success: true,
      filePath: finalTiffFile,
      mimeType: 'image/tiff',
      filename: `export-${Date.now()}.tiff`,
      width: canvasWidth,
      height: canvasHeight
    };
    } finally {
      // Always clean up tile temp files, regardless of which format branch
      // ran, whether it succeeded, or whether it threw an exception.
      cleanupTileFiles();
    }
  }
  
  /**
   * Generate HTML for rendering a single tile with offset translation
   * Uses the same rendering logic as generateRendererHtml but with tile offset support
   */
  private generateTileRendererHtml(data: any): string {
    const { shapes, groups, artboard, exportSettings, canvasWidth, canvasHeight, scale, tileOffsetX, tileOffsetY, fullCanvasWidth, fullCanvasHeight, tileIndex } = data;
    const { bleedPx, printMarksGutterPx, printExpansion, backgroundColor } = exportSettings;
    
    // Extend artboard-filling shapes to cover bleed area
    const bleedAdjustedShapes = printExpansion > 0 ? this.extendArtboardFillingShapes(shapes, artboard, printExpansion) : shapes;
    
    // Add tile offset to the render data for translation
    const tileData = {
      ...data,
      shapes: bleedAdjustedShapes,
      tileOffsetX,
      tileOffsetY,
      fullCanvasWidth,
      fullCanvasHeight,
      tileIndex: tileIndex || 1
    };
    
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Tile Renderer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: transparent; overflow: hidden; }
    #exportCanvas { display: block; }
  </style>
</head>
<body>
  <canvas id="exportCanvas" width="${canvasWidth}" height="${canvasHeight}"></canvas>
  <script>
    const RENDER_DATA = ${JSON.stringify(tileData)};
    const TILE_OFFSET_X = ${tileOffsetX};
    const TILE_OFFSET_Y = ${tileOffsetY};
    
    // Legacy sharp path: straight lines vertex-to-vertex
    function drawPolygon(ctx, points) {
      if (!points || points.length === 0) return;
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
    }
    
    // Canonical render-mode utilities (shared with TypeScript renderers)
    ${RENDER_MODE_UTILS_JS}
    
    ${SHAPE_RENDERER_JS}
    
    window.renderShapes = function() {
      try {
        const canvas = document.getElementById('exportCanvas');
        const ctx = canvas.getContext('2d');
        
        const printExpansion = RENDER_DATA.exportSettings?.printExpansion || 0;
        const artboardWidth = RENDER_DATA.artboard?.width || 1;
        const artboardHeight = RENDER_DATA.artboard?.height || 1;
        const fullCanvasWidth = RENDER_DATA.fullCanvasWidth || ${canvasWidth};
        const fullCanvasHeight = RENDER_DATA.fullCanvasHeight || ${canvasHeight};
        
        // Calculate the actual DPI scale from canvas dimensions
        // The full canvas was sized as: (artboard + 2*printExpansion) * scale
        // So: scale = fullCanvasWidth / (artboardWidth + 2*printExpansion)
        const scale = fullCanvasWidth / (artboardWidth + 2 * printExpansion);
        
        // Fill background first if not transparent (in pixel coordinates before transform)
        const bgColor = RENDER_DATA.exportSettings?.backgroundColor || 'transparent';
        if (bgColor !== 'transparent') {
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, ${canvasWidth}, ${canvasHeight});
        }
        
        // Use setTransform to set up the complete transformation matrix in one call.
        // The matrix is: [a, b, c, d, e, f] where:
        //   a = horizontal scale, d = vertical scale
        //   e = horizontal translation, f = vertical translation
        // 
        // For tiled rendering, each tile needs to:
        // 1. Scale artboard coords to final pixels (by 'scale' factor)
        // 2. Offset for print expansion (bleed area) - this is in artboard coords, so multiply by scale
        // 3. Offset for tile position - TILE_OFFSET is already in final pixels, so subtract directly
        //
        // Final transform: point_pixel = (artboard_point + printExpansion) * scale - tileOffset
        // Matrix form: point_pixel = point_artboard * scale + (printExpansion * scale - tileOffset)
        const translateX = printExpansion * scale - TILE_OFFSET_X;
        const translateY = printExpansion * scale - TILE_OFFSET_Y;
        
        // UNIQUE MARKER: This proves the new setTransform code is running (v2)
        console.log('TILE_RENDER_V2: tileIndex=' + RENDER_DATA.tileIndex + ', translateX=' + translateX + ', translateY=' + translateY + ', TILE_OFFSET_X=' + TILE_OFFSET_X + ', TILE_OFFSET_Y=' + TILE_OFFSET_Y);
        
        ctx.setTransform(scale, 0, 0, scale, translateX, translateY);
        
        // Set up origin for shared renderShape — tiled path uses artboard origin
        RENDER_DATA.originX = RENDER_DATA.artboard.x || 0;
        RENDER_DATA.originY = RENDER_DATA.artboard.y || 0;
        
        const shapes = RENDER_DATA.shapes || [];
        
        // Debug: Log scale calculation and shape info
        // Also check if exportSettings.scale was passed from the server
        const passedScale = RENDER_DATA.scale || RENDER_DATA.exportSettings?.scale || 'not_passed';
        const debugInfo = {
          calculatedScale: scale,
          passedScale: passedScale,
          fullCanvasWidth: fullCanvasWidth,
          fullCanvasHeight: fullCanvasHeight,
          artboardWidth: artboardWidth,
          artboardHeight: artboardHeight,
          printExpansion: printExpansion,
          artboardPlusExpansion: artboardWidth + 2 * printExpansion,
          expectedScale: fullCanvasWidth / (artboardWidth + 2 * printExpansion),
          tileOffsetX: TILE_OFFSET_X,
          tileOffsetY: TILE_OFFSET_Y,
          shapeCount: shapes.length,
          firstShapeTransform: shapes.length > 0 ? shapes[0].transform : null,
          firstShapeType: shapes.length > 0 ? shapes[0].type : null
        };
        console.log('TILE DEBUG:', JSON.stringify(debugInfo));
        
        // Sort shapes by z-index for proper layering
        const sortedShapes = [...shapes].sort((a, b) => 
          (a.properties?.zIndex || 0) - (b.properties?.zIndex || 0)
        );
        
        // Render each shape
        sortedShapes.forEach(function(shape) {
          renderShape(ctx, shape);
        });
        
        // --- Per-tile overlay rendering (Part C) ---
        // Overlays are drawn here in the same setTransform coordinate space as shapes.
        // artboard (0,0) maps to the correct pixel position in the tile because the
        // canvas clips naturally to the tile viewport — no post-stitch compositing needed.
        
        const artW = RENDER_DATA.artboard.width || 0;
        const artH = RENDER_DATA.artboard.height || 0;
        const bleedPx_ov = RENDER_DATA.exportSettings && RENDER_DATA.exportSettings.bleedPx || 0;
        
        // Draw bleed zone rectangle (outside artboard edge, inset by bleedPx)
        // stroke-width matches the prior SVG overlay: 2 canvas pixels (stroke-width="2")
        if (bleedPx_ov > 0) {
          var bleedCfg_ov = RENDER_DATA.artboard.printConfig && RENDER_DATA.artboard.printConfig.overlays && RENDER_DATA.artboard.printConfig.overlays.bleed;
          var bleedColor_ov = (bleedCfg_ov && bleedCfg_ov.color) || '#00FFFF';
          ctx.save();
          ctx.strokeStyle = bleedColor_ov;
          ctx.lineWidth = 2 / scale;
          ctx.setLineDash([]);
          ctx.strokeRect(-bleedPx_ov, -bleedPx_ov, artW + bleedPx_ov * 2, artH + bleedPx_ov * 2);
          ctx.restore();
        }
        
        // Draw safe zone rectangle (inside artboard edge)
        // stroke-width matches the prior SVG overlay: 2 canvas pixels (stroke-width="2")
        var safeZonePx_ov = (RENDER_DATA.exportSettings && RENDER_DATA.exportSettings.safeZonePx) || 0;
        if (safeZonePx_ov > 0) {
          var szCfg_ov = RENDER_DATA.artboard.printConfig && RENDER_DATA.artboard.printConfig.overlays && RENDER_DATA.artboard.printConfig.overlays.safeZone;
          var safeZoneColor_ov = (szCfg_ov && szCfg_ov.color) || '#FF00FF';
          ctx.save();
          ctx.strokeStyle = safeZoneColor_ov;
          ctx.lineWidth = 2 / scale;
          ctx.setLineDash([]);
          ctx.strokeRect(safeZonePx_ov, safeZonePx_ov, artW - safeZonePx_ov * 2, artH - safeZonePx_ov * 2);
          ctx.restore();
        }
        
        // Draw crop marks and registration marks
        // stroke-width matches the prior SVG overlay: 1 canvas pixel (stroke-width="1")
        var pmCfg_ov = RENDER_DATA.exportSettings && RENDER_DATA.exportSettings.printMarksConfig;
        if (pmCfg_ov && pmCfg_ov.enabled) {
          var markLength_ov = pmCfg_ov.markLengthPx || 20;
          var markOffset_ov = pmCfg_ov.markOffsetPx || 5;
          
          ctx.save();
          ctx.strokeStyle = pmCfg_ov.color || '#000000';
          ctx.lineWidth = 1 / scale;
          ctx.setLineDash([]);
          
          if (pmCfg_ov.cropMarks) {
            var cropCorners = [
              { cx: -bleedPx_ov, cy: -bleedPx_ov, sx: -1, sy: -1 },
              { cx: artW + bleedPx_ov, cy: -bleedPx_ov, sx: 1, sy: -1 },
              { cx: artW + bleedPx_ov, cy: artH + bleedPx_ov, sx: 1, sy: 1 },
              { cx: -bleedPx_ov, cy: artH + bleedPx_ov, sx: -1, sy: 1 }
            ];
            cropCorners.forEach(function(c) {
              ctx.beginPath();
              ctx.moveTo(c.cx + markOffset_ov * c.sx, c.cy);
              ctx.lineTo(c.cx + (markOffset_ov + markLength_ov) * c.sx, c.cy);
              ctx.moveTo(c.cx, c.cy + markOffset_ov * c.sy);
              ctx.lineTo(c.cx, c.cy + (markOffset_ov + markLength_ov) * c.sy);
              ctx.stroke();
            });
          }
          
          if (pmCfg_ov.registrationMarks) {
            var regSize_ov = 8;
            var regPositions = [
              { rx: artW / 2, ry: -bleedPx_ov - markOffset_ov - regSize_ov },
              { rx: artW / 2, ry: artH + bleedPx_ov + markOffset_ov + regSize_ov },
              { rx: -bleedPx_ov - markOffset_ov - regSize_ov, ry: artH / 2 },
              { rx: artW + bleedPx_ov + markOffset_ov + regSize_ov, ry: artH / 2 }
            ];
            regPositions.forEach(function(pos) {
              ctx.beginPath();
              ctx.arc(pos.rx, pos.ry, regSize_ov / 2, 0, Math.PI * 2);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(pos.rx - regSize_ov, pos.ry);
              ctx.lineTo(pos.rx + regSize_ov, pos.ry);
              ctx.moveTo(pos.rx, pos.ry - regSize_ov);
              ctx.lineTo(pos.rx, pos.ry + regSize_ov);
              ctx.stroke();
            });
          }
          
          ctx.restore();
        }
        
        return { success: true, shapesRendered: shapes.length, debug: debugInfo };
      } catch (error) {
        return { success: false, error: error.message };
      }
    };
  </script>
</body>
</html>`;
  }
  
  /**
   * Build comprehensive metadata object for Sharp's withMetadata()
   * Includes DPI, EXIF fields (artist, copyright, title, description), and optionally ICC profile
   */
  private buildImageMetadata(options: {
    dpi?: number;
    artistName?: string;
    copyrightText?: string;
    imageTitle?: string;
    imageDescription?: string;
    embedIccProfile?: boolean;
  }): sharp.WriteableMetadata {
    const metadata: sharp.WriteableMetadata = {};
    
    // DPI/density (used for print exports)
    if (options.dpi) {
      metadata.density = options.dpi;
    }
    
    // EXIF metadata for artist, copyright, and description
    // Sharp's withMetadata supports these as EXIF IFD0 tags
    const exif: Record<string, string> = {};
    
    if (options.artistName?.trim()) {
      exif.Artist = options.artistName.trim();
    }
    
    if (options.copyrightText?.trim()) {
      exif.Copyright = options.copyrightText.trim();
    }
    
    if (options.imageDescription?.trim()) {
      exif.ImageDescription = options.imageDescription.trim();
    }
    
    // Note: imageTitle maps to XMP:Title which Sharp doesn't directly support
    // We embed it in ImageDescription if no description is provided
    if (options.imageTitle?.trim() && !options.imageDescription?.trim()) {
      exif.ImageDescription = options.imageTitle.trim();
    }
    
    if (Object.keys(exif).length > 0) {
      metadata.exif = {
        IFD0: exif
      };
    }
    
    // ICC Profile embedding
    // When embedIccProfile is true, we use Sharp's default sRGB profile
    // Sharp automatically embeds sRGB profile when 'icc' is set to a profile name
    if (options.embedIccProfile !== false) {
      // Sharp uses 'srgb' as the default ICC profile name
      metadata.icc = 'srgb';
    }
    
    return metadata;
  }

  /**
   * Convert PNG buffer to PDF with embedded image and metadata
   * Uses jsPDF in a Worker Thread to avoid blocking the main event loop.
   * This is critical for large images (300+ megapixels) where PDF generation
   * can take 60+ seconds. Running in a separate thread allows SSE heartbeats to continue.
   * 
   * The worker is compiled from TypeScript to JavaScript at runtime using esbuild.
   */
  private async convertToPdf(pngBuffer: Buffer, options: {
    width: number;
    height: number;
    dpi: number;
    artistName?: string;
    copyrightText?: string;
    imageTitle?: string;
    imageDescription?: string;
    embedIccProfile?: boolean;
  }, progressCallback?: (message: string) => void): Promise<string> {
    const { Worker } = await import('worker_threads');
    const pathModule = await import('path');
    const esbuild = await import('esbuild');
    const fsModule = await import('fs');
    
    const { width, height, dpi, artistName, copyrightText, imageTitle, imageDescription } = options;
    
    const widthMm = (width / dpi) * 25.4;
    const heightMm = (height / dpi) * 25.4;
    const orientation = widthMm > heightMm ? 'landscape' : 'portrait';
    
    progressCallback?.('Encoding image for PDF...');
    console.log('[HighResExport] PDF: Encoding image to base64...');
    
    const pngBase64 = pngBuffer.toString('base64');
    console.log(`[HighResExport] PDF: Base64 encoded (${(pngBase64.length / 1024 / 1024).toFixed(1)} MB)`);
    
    progressCallback?.('Compiling PDF worker...');
    console.log('[HighResExport] PDF: Compiling TypeScript worker to JavaScript...');
    
    const workerTsPath = pathModule.join(process.cwd(), 'server', 'services', 'pdfWorker.ts');
    const workerJsPath = '/tmp/pdfWorker.js';
    
    await esbuild.build({
      entryPoints: [workerTsPath],
      outfile: workerJsPath,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent'
    });
    
    console.log(`[HighResExport] PDF: Worker compiled to ${workerJsPath}`);
    
    progressCallback?.('Generating PDF in worker thread...');
    console.log('[HighResExport] PDF: Starting worker thread for PDF generation...');
    
    const pdfTimestamp = Date.now();
    const outPath = path.join(this.exportTempDir, `pdf_${pdfTimestamp}.pdf`);
    
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerJsPath, {
        workerData: {
          pngBase64,
          width,
          height,
          dpi,
          widthMm,
          heightMm,
          orientation,
          artistName,
          copyrightText,
          imageTitle,
          imageDescription,
          outPath
        }
      });
      
      const heartbeatInterval = setInterval(() => {
        progressCallback?.('PDF generation in progress...');
      }, 5000);
      
      worker.on('message', (result: { success: boolean; filePath?: string; error?: string }) => {
        clearInterval(heartbeatInterval);
        if (result.success && result.filePath) {
          const size = (() => { try { return fsModule.statSync(result.filePath).size; } catch { return 0; } })();
          console.log(`[HighResExport] Created PDF: ${widthMm.toFixed(1)}mm x ${heightMm.toFixed(1)}mm at ${dpi} DPI, size: ${(size / 1024 / 1024).toFixed(2)} MB`);
          // Return path directly — caller streams from disk, no readFileSync spike
          resolve(result.filePath);
        } else {
          try { fsModule.unlinkSync(outPath); } catch { /* ignore */ }
          reject(new Error(result.error || 'PDF generation failed'));
        }
      });
      
      worker.on('error', (error) => {
        clearInterval(heartbeatInterval);
        try { fsModule.unlinkSync(outPath); } catch { /* ignore */ }
        console.error('[HighResExport] PDF worker error:', error);
        reject(error);
      });
      
      worker.on('exit', (code) => {
        clearInterval(heartbeatInterval);
        if (code !== 0) {
          try { fsModule.unlinkSync(outPath); } catch { /* ignore */ }
          reject(new Error(`PDF worker exited with code ${code}`));
        }
      });
    });
  }

  private async convertToTiff(pngBuffer: Buffer, options: { 
    bitDepth: 8 | 16; 
    dpi: number; 
    compression?: 'none' | 'deflate';
    flattenToRgb?: boolean;
    matteColor?: string;
    artistName?: string;
    copyrightText?: string;
    imageTitle?: string;
    imageDescription?: string;
    embedIccProfile?: boolean;
  }): Promise<Buffer> {
    const { 
      bitDepth, 
      dpi, 
      compression = 'none', 
      flattenToRgb = false, 
      matteColor = '#ffffff',
      artistName,
      copyrightText,
      imageTitle,
      imageDescription,
      embedIccProfile = true
    } = options;
    
    // Use limitInputPixels: false to allow processing very large print files
    let pipeline = sharp(pngBuffer, { limitInputPixels: false });
    
    if (flattenToRgb) {
      const hexMatch = matteColor.match(/^#?([0-9a-fA-F]{6})$/);
      const r = hexMatch ? parseInt(hexMatch[1].substring(0, 2), 16) : 255;
      const g = hexMatch ? parseInt(hexMatch[1].substring(2, 4), 16) : 255;
      const b = hexMatch ? parseInt(hexMatch[1].substring(4, 6), 16) : 255;
      
      pipeline = pipeline.flatten({ background: { r, g, b } });
      console.log(`[HighResExport] Flattening to RGB with matte color: ${matteColor} (${r}, ${g}, ${b})`);
    }
    
    if (bitDepth === 16) {
      pipeline = pipeline.toColourspace('rgb16');
    }
    
    // Map compression setting to Sharp's TIFF compression options
    // Sharp supports: 'none', 'jpeg', 'deflate', 'packbits', 'ccittfax4', 'lzw', 'webp', 'zstd', 'jp2k'
    const tiffCompression = compression === 'deflate' ? 'deflate' : 'none';
    
    // Build comprehensive metadata including DPI, EXIF, and ICC profile
    const metadata = this.buildImageMetadata({
      dpi,
      artistName,
      copyrightText,
      imageTitle,
      imageDescription,
      embedIccProfile
    });
    
    console.log(`[HighResExport] Embedding metadata in TIFF: dpi=${dpi}, artist=${artistName || 'none'}, copyright=${copyrightText ? 'yes' : 'no'}, icc=${embedIccProfile ? 'sRGB' : 'none'}`);
    
    const tiffBuffer = await pipeline
      .withMetadata(metadata)
      .tiff({
        compression: tiffCompression,
        quality: 100
      })
      .toBuffer();
    
    return tiffBuffer;
  }
  
  /**
   * Convert PNG file to TIFF with metadata, writing directly to outputFilePath.
   * Eliminates the read-back-to-buffer step: Sharp writes to disk and the function
   * returns the output path, so the main-thread heap never holds the encoded TIFF.
   */
  private async convertToTiffFromFile(pngFilePath: string, outputFilePath: string, options: { 
    bitDepth: 8 | 16; 
    dpi: number; 
    compression?: 'none' | 'deflate';
    flattenToRgb?: boolean;
    matteColor?: string;
    artistName?: string;
    copyrightText?: string;
    imageTitle?: string;
    imageDescription?: string;
    embedIccProfile?: boolean;
  }): Promise<string> {
    const { 
      bitDepth, 
      dpi, 
      compression = 'none', 
      flattenToRgb = false, 
      matteColor = '#ffffff',
      artistName,
      copyrightText,
      imageTitle,
      imageDescription,
      embedIccProfile = true
    } = options;
    
    // Use limitInputPixels: false to allow processing very large print files
    let pipeline = sharp(pngFilePath, { limitInputPixels: false });
    
    if (flattenToRgb) {
      const hexMatch = matteColor.match(/^#?([0-9a-fA-F]{6})$/);
      const r = hexMatch ? parseInt(hexMatch[1].substring(0, 2), 16) : 255;
      const g = hexMatch ? parseInt(hexMatch[1].substring(2, 4), 16) : 255;
      const b = hexMatch ? parseInt(hexMatch[1].substring(4, 6), 16) : 255;
      
      pipeline = pipeline.flatten({ background: { r, g, b } });
      console.log(`[HighResExport] Flattening to RGB with matte color: ${matteColor} (${r}, ${g}, ${b})`);
    }
    
    if (bitDepth === 16) {
      pipeline = pipeline.toColourspace('rgb16');
    }
    
    // Map compression setting to Sharp's TIFF compression options
    const tiffCompression = compression === 'deflate' ? 'deflate' : 'none';
    
    // Build comprehensive metadata including DPI, EXIF, and ICC profile
    const metadata = this.buildImageMetadata({
      dpi,
      artistName,
      copyrightText,
      imageTitle,
      imageDescription,
      embedIccProfile
    });
    
    console.log(`[HighResExport] Embedding metadata in TIFF (file-based): dpi=${dpi}, artist=${artistName || 'none'}, copyright=${copyrightText ? 'yes' : 'no'}, icc=${embedIccProfile ? 'sRGB' : 'none'}`);
    
    // Write directly to outputFilePath — no intermediate buffer in heap
    await pipeline
      .withMetadata(metadata)
      .tiff({
        compression: tiffCompression,
        quality: 100
      })
      .toFile(outputFilePath);
    
    return outputFilePath;
  }
  
  /**
   * File-path variant of convertToPdf for tiled exports.
   * The PNG is read inside the worker thread (not in the main thread heap) and the PDF
   * is written directly to outputFilePath, so the main-thread heap never holds either buffer.
   */
  private async convertToPdfToFile(pngFilePath: string, outputFilePath: string, options: {
    width: number;
    height: number;
    dpi: number;
    artistName?: string;
    copyrightText?: string;
    imageTitle?: string;
    imageDescription?: string;
    embedIccProfile?: boolean;
  }, progressCallback?: (message: string) => void): Promise<void> {
    const { Worker } = await import('worker_threads');
    const pathModule = await import('path');
    const esbuild = await import('esbuild');
    const fsModule = await import('fs');
    
    const { width, height, dpi, artistName, copyrightText, imageTitle, imageDescription } = options;
    
    const widthMm = (width / dpi) * 25.4;
    const heightMm = (height / dpi) * 25.4;
    const orientation = widthMm > heightMm ? 'landscape' : 'portrait';
    
    progressCallback?.('Compiling PDF worker...');
    console.log('[HighResExport] PDF: Compiling TypeScript worker to JavaScript...');
    
    const workerTsPath = pathModule.join(process.cwd(), 'server', 'services', 'pdfWorker.ts');
    const workerJsPath = '/tmp/pdfWorker.js';
    
    await esbuild.build({
      entryPoints: [workerTsPath],
      outfile: workerJsPath,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent'
    });
    
    console.log(`[HighResExport] PDF: Worker compiled to ${workerJsPath}`);
    
    progressCallback?.('Generating PDF in worker thread...');
    console.log('[HighResExport] PDF: Starting worker thread for PDF generation (file-path mode)...');
    
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerJsPath, {
        workerData: {
          // Pass file path — worker reads PNG from disk, avoiding base64 in main-thread heap
          pngFilePath,
          width,
          height,
          dpi,
          widthMm,
          heightMm,
          orientation,
          artistName,
          copyrightText,
          imageTitle,
          imageDescription,
          outPath: outputFilePath
        }
      });
      
      const heartbeatInterval = setInterval(() => {
        progressCallback?.('PDF generation in progress...');
      }, 5000);
      
      worker.on('message', (result: { success: boolean; filePath?: string; error?: string }) => {
        clearInterval(heartbeatInterval);
        if (result.success) {
          console.log(`[HighResExport] PDF written directly to disk: ${outputFilePath}`);
          resolve();
        } else {
          reject(new Error(result.error || 'PDF generation failed'));
        }
      });
      
      worker.on('error', (error) => {
        clearInterval(heartbeatInterval);
        console.error('[HighResExport] PDF worker error:', error);
        reject(error);
      });
      
      worker.on('exit', (code) => {
        clearInterval(heartbeatInterval);
        if (code !== 0) {
          reject(new Error(`PDF worker exited with code ${code}`));
        }
      });
    });
  }
  
  /**
   * Apply metadata to PNG buffer
   * Includes DPI, EXIF fields, and optionally ICC profile
   * IMPORTANT: Preserves alpha channel by using ensureAlpha() to maintain transparency
   */
  private async applyPngMetadata(pngBuffer: Buffer, options: {
    dpi?: number;
    artistName?: string;
    copyrightText?: string;
    imageTitle?: string;
    imageDescription?: string;
    embedIccProfile?: boolean;
  }): Promise<Buffer> {
    const metadata = this.buildImageMetadata(options);
    
    if (Object.keys(metadata).length === 0) {
      return pngBuffer; // No metadata to apply
    }
    
    console.log(`[HighResExport] Embedding metadata in PNG: dpi=${options.dpi || 'default'}, artist=${options.artistName || 'none'}, icc=${options.embedIccProfile !== false ? 'sRGB' : 'none'}`);
    
    // Use ensureAlpha() to preserve transparency in PNG exports
    // This prevents Sharp from stripping alpha channel during re-encoding
    return await sharp(pngBuffer, { limitInputPixels: false })
      .ensureAlpha()
      .withMetadata(metadata)
      .png({
        compressionLevel: 6,  // Balanced compression (0-9)
        adaptiveFiltering: true,
        palette: false  // Ensure truecolor output, not palette-based
      })
      .toBuffer();
  }
  
  /**
   * Apply metadata to JPEG buffer
   * Includes DPI, EXIF fields (including quality), and optionally ICC profile
   */
  private async applyJpegMetadata(jpegBuffer: Buffer, options: {
    dpi?: number;
    quality?: number;
    artistName?: string;
    copyrightText?: string;
    imageTitle?: string;
    imageDescription?: string;
    embedIccProfile?: boolean;
  }): Promise<Buffer> {
    const metadata = this.buildImageMetadata(options);
    
    if (Object.keys(metadata).length === 0) {
      return jpegBuffer; // No metadata to apply
    }
    
    console.log(`[HighResExport] Embedding metadata in JPEG: dpi=${options.dpi || 'default'}, artist=${options.artistName || 'none'}, icc=${options.embedIccProfile !== false ? 'sRGB' : 'none'}`);
    
    return await sharp(jpegBuffer, { limitInputPixels: false })
      .withMetadata(metadata)
      .jpeg({ quality: options.quality || 90 })
      .toBuffer();
  }
  
  /**
   * Apply metadata to WebP buffer
   * WebP has limited metadata support but Sharp can embed ICC profiles
   */
  private async applyWebpMetadata(webpBuffer: Buffer, options: {
    quality?: number;
    artistName?: string;
    copyrightText?: string;
    imageTitle?: string;
    imageDescription?: string;
    embedIccProfile?: boolean;
  }): Promise<Buffer> {
    const metadata = this.buildImageMetadata(options);
    
    // WebP only really supports ICC profiles, not EXIF
    // Remove EXIF fields for WebP
    delete metadata.exif;
    
    if (Object.keys(metadata).length === 0) {
      return webpBuffer; // No metadata to apply
    }
    
    console.log(`[HighResExport] Embedding ICC profile in WebP: icc=${options.embedIccProfile !== false ? 'sRGB' : 'none'}`);
    
    return await sharp(webpBuffer, { limitInputPixels: false })
      .withMetadata(metadata)
      .webp({ quality: options.quality || 90 })
      .toBuffer();
  }
  
  private generateRendererHtml(data: any): string {
    const { shapes, groups, artboard, exportSettings, canvasWidth, canvasHeight, scale } = data;
    const { bleedPx, printMarksGutterPx, printExpansion, backgroundColor } = exportSettings;
    
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>High-Res Shape Renderer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: transparent; overflow: hidden; }
    #exportCanvas { display: block; }
  </style>
</head>
<body>
  <canvas id="exportCanvas" width="${canvasWidth}" height="${canvasHeight}"></canvas>
  
  <script>
    const RENDER_DATA = ${JSON.stringify({ shapes, groups, artboard, exportSettings, canvasWidth, canvasHeight, scale, bleedPx, printMarksGutterPx, printExpansion, backgroundColor, originX: data.originX, originY: data.originY })};
    
    // Legacy sharp path: straight lines vertex-to-vertex
    function drawPolygon(ctx, points) {
      if (!points || points.length === 0) return;
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
    }
    
    // Canonical render-mode utilities (shared with TypeScript renderers)
    ${RENDER_MODE_UTILS_JS}
    
    ${SHAPE_RENDERER_JS}
    
    function renderPrintMarks(ctx, x, y, width, height, bleedPx, config) {
      if (!config.cropMarks && !config.registrationMarks) return;
      
      ctx.save();
      ctx.strokeStyle = config.color || '#000000';
      ctx.lineWidth = 0.5;
      
      const markLength = config.markLength || 20;
      const markOffset = config.markOffset || 5;
      
      if (config.cropMarks) {
        const corners = [
          { x: x - bleedPx, y: y - bleedPx },
          { x: x + width + bleedPx, y: y - bleedPx },
          { x: x + width + bleedPx, y: y + height + bleedPx },
          { x: x - bleedPx, y: y + height + bleedPx }
        ];
        
        corners.forEach(function(corner, i) {
          ctx.beginPath();
          if (i === 0) {
            ctx.moveTo(corner.x - markOffset - markLength, corner.y);
            ctx.lineTo(corner.x - markOffset, corner.y);
            ctx.moveTo(corner.x, corner.y - markOffset - markLength);
            ctx.lineTo(corner.x, corner.y - markOffset);
          } else if (i === 1) {
            ctx.moveTo(corner.x + markOffset, corner.y);
            ctx.lineTo(corner.x + markOffset + markLength, corner.y);
            ctx.moveTo(corner.x, corner.y - markOffset - markLength);
            ctx.lineTo(corner.x, corner.y - markOffset);
          } else if (i === 2) {
            ctx.moveTo(corner.x + markOffset, corner.y);
            ctx.lineTo(corner.x + markOffset + markLength, corner.y);
            ctx.moveTo(corner.x, corner.y + markOffset);
            ctx.lineTo(corner.x, corner.y + markOffset + markLength);
          } else {
            ctx.moveTo(corner.x - markOffset - markLength, corner.y);
            ctx.lineTo(corner.x - markOffset, corner.y);
            ctx.moveTo(corner.x, corner.y + markOffset);
            ctx.lineTo(corner.x, corner.y + markOffset + markLength);
          }
          ctx.stroke();
        });
      }
      
      if (config.registrationMarks) {
        const regSize = 8;
        const positions = [
          { x: x + width / 2, y: y - bleedPx - markOffset - regSize },
          { x: x + width / 2, y: y + height + bleedPx + markOffset + regSize },
          { x: x - bleedPx - markOffset - regSize, y: y + height / 2 },
          { x: x + width + bleedPx + markOffset + regSize, y: y + height / 2 }
        ];
        
        positions.forEach(function(pos) {
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, regSize / 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(pos.x - regSize, pos.y);
          ctx.lineTo(pos.x + regSize, pos.y);
          ctx.moveTo(pos.x, pos.y - regSize);
          ctx.lineTo(pos.x, pos.y + regSize);
          ctx.stroke();
        });
      }
      
      ctx.restore();
    }
    
    window.renderShapes = function() {
      try {
        const canvas = document.getElementById('exportCanvas');
        const ctx = canvas.getContext('2d');
        
        const { shapes, groups, artboard, exportSettings, canvasWidth, canvasHeight, scale, bleedPx, printExpansion, backgroundColor } = RENDER_DATA;
        
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        
        if (backgroundColor && backgroundColor !== 'transparent') {
          ctx.fillStyle = backgroundColor;
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        }
        
        ctx.save();
        ctx.scale(scale, scale);
        ctx.translate(printExpansion, printExpansion);
        
        const allShapes = [...shapes];
        if (groups) {
          groups.forEach(function(group) {
            if (group.shapes) {
              group.shapes.forEach(function(s) {
                allShapes.push(s);
              });
            }
          });
        }
        
        allShapes.sort(function(a, b) {
          return (a.properties.zIndex || 0) - (b.properties.zIndex || 0);
        });
        
        allShapes.forEach(function(shape) {
          renderShape(ctx, shape);
        });
        
        // Draw bleed overlay rectangle if bleed is active
        if (bleedPx > 0) {
          var bleedCfg = artboard.printConfig && artboard.printConfig.overlays && artboard.printConfig.overlays.bleed;
          var bleedColor = (bleedCfg && bleedCfg.color) || '#00FFFF';
          ctx.save();
          ctx.strokeStyle = bleedColor;
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.strokeRect(-bleedPx, -bleedPx, artboard.width + bleedPx * 2, artboard.height + bleedPx * 2);
          ctx.restore();
        }
        
        // Draw safe zone overlay rectangle if configured
        var safeZonePx = exportSettings.safeZonePx || 0;
        if (safeZonePx > 0) {
          var szCfg = artboard.printConfig && artboard.printConfig.overlays && artboard.printConfig.overlays.safeZone;
          var safeZoneColor = (szCfg && szCfg.color) || '#FF00FF';
          ctx.save();
          ctx.strokeStyle = safeZoneColor;
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.strokeRect(safeZonePx, safeZonePx, artboard.width - safeZonePx * 2, artboard.height - safeZonePx * 2);
          ctx.restore();
        }
        
        var pmCfgSP = exportSettings.printMarksConfig;
        if (pmCfgSP && pmCfgSP.enabled) {
          renderPrintMarks(ctx, 0, 0, artboard.width, artboard.height, bleedPx, {
            cropMarks: pmCfgSP.cropMarks,
            registrationMarks: pmCfgSP.registrationMarks,
            markLength: pmCfgSP.markLengthPx,
            markOffset: pmCfgSP.markOffsetPx,
            color: pmCfgSP.color || '#000000'
          });
        }
        
        ctx.restore();
        
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    };
  </script>
</body>
</html>`;
  }
  
  needsServerExport(artboard: { width: number; height: number; dpi?: number }, exportSettings: any): boolean {
    const width = artboard.width * (exportSettings.scale || 1);
    const height = artboard.height * (exportSettings.scale || 1);
    
    const estimatedMemory = width * height * 4;
    const maxBrowserPixels = 268_000_000;
    const maxBrowserMemory = 500_000_000;
    
    if (estimatedMemory > maxBrowserMemory) return true;
    if (width * height > maxBrowserPixels) return true;
    if (exportSettings.format === 'tiff' && exportSettings.bitDepth === 16) return true;
    
    const dpi = exportSettings.dpi || artboard.dpi || 72;
    if (dpi >= 300 && (width >= 3000 || height >= 3000)) return true;
    
    return false;
  }
  
  getExportEstimate(artboard: { width: number; height: number; dpi?: number }, exportSettings: any): {
    needsServer: boolean;
    estimatedTime: string;
    estimatedSize: string;
    dimensions: { width: number; height: number };
  } {
    const scale = exportSettings.scale || 1;
    const width = Math.ceil(artboard.width * scale);
    const height = Math.ceil(artboard.height * scale);
    const needsServer = this.needsServerExport(artboard, exportSettings);
    
    const pixels = width * height;
    const bytesPerPixel = exportSettings.bitDepth === 16 ? 8 : 4;
    const estimatedBytes = pixels * bytesPerPixel;
    
    let estimatedTime: string;
    if (needsServer) {
      const seconds = Math.ceil(2 + pixels / 5_000_000);
      estimatedTime = seconds < 60 ? `~${seconds} seconds` : `~${Math.ceil(seconds / 60)} minutes`;
    } else {
      estimatedTime = '< 1 second';
    }
    
    const sizeMB = estimatedBytes / 1024 / 1024;
    const estimatedSize = sizeMB < 1 ? `~${Math.ceil(sizeMB * 1024)} KB` : `~${sizeMB.toFixed(1)} MB`;
    
    return {
      needsServer,
      estimatedTime,
      estimatedSize,
      dimensions: { width, height }
    };
  }
  
  /**
   * Extend shapes that fill the artboard to also cover the bleed area
   * This ensures background shapes don't leave a visible border in the bleed zone
   */
  private extendArtboardFillingShapes(shapes: any[], artboard: any, printExpansion: number): any[] {
    const artboardX = artboard.x || 0;
    const artboardY = artboard.y || 0;
    const artboardWidth = artboard.width;
    const artboardHeight = artboard.height;
    const tolerance = 5; // pixels tolerance for matching artboard bounds
    
    return shapes.map((shape: any) => {
      if (!shape.points || shape.points.length === 0) return shape;
      
      // Calculate shape bounds from points
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of shape.points) {
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
      }
      const shapeWidth = maxX - minX;
      const shapeHeight = maxY - minY;
      
      // Get transform position (shape's world position)
      const tx = shape.transform?.x ?? 0;
      const ty = shape.transform?.y ?? 0;
      
      // Calculate world bounds (shape center + local bounds)
      // Shape points are relative to shape center, transform.x/y is the center position
      const worldMinX = tx + minX;
      const worldMinY = ty + minY;
      const worldMaxX = tx + maxX;
      const worldMaxY = ty + maxY;
      
      // Check if shape covers the artboard (within tolerance)
      const coversLeft = worldMinX <= artboardX + tolerance;
      const coversTop = worldMinY <= artboardY + tolerance;
      const coversRight = worldMaxX >= artboardX + artboardWidth - tolerance;
      const coversBottom = worldMaxY >= artboardY + artboardHeight - tolerance;
      
      // Only extend if shape covers all four edges of artboard
      if (coversLeft && coversTop && coversRight && coversBottom) {
        console.log(`[BleedExtension] Extending shape ${shape.id} by ${printExpansion}px for bleed coverage`);
        
        // Clone shape and extend points by printExpansion
        const extendedShape = JSON.parse(JSON.stringify(shape));
        
        // Extend each point outward based on its position relative to center
        for (const pt of extendedShape.points) {
          // For corner points, extend diagonally
          if (pt.x < 0) pt.x -= printExpansion;
          else if (pt.x > 0) pt.x += printExpansion;
          
          if (pt.y < 0) pt.y -= printExpansion;
          else if (pt.y > 0) pt.y += printExpansion;
        }
        
        // Also update width/height if stored on shape
        if (extendedShape.width !== undefined) {
          extendedShape.width += printExpansion * 2;
        }
        if (extendedShape.height !== undefined) {
          extendedShape.height += printExpansion * 2;
        }
        
        return extendedShape;
      }
      
      return shape;
    });
  }

  /**
   * Generate an SVG overlay with print marks (crop marks and registration marks)
   * Used for compositing print marks onto stitched tiled exports
   */
  private generatePrintMarksSvg(
    canvasWidth: number,
    canvasHeight: number,
    artboardWidth: number,
    artboardHeight: number,
    scale: number,
    bleedPx: number,
    printExpansion: number,
    printMarksConfig: {
      cropMarks?: boolean;
      registrationMarks?: boolean;
      markLength: number;
      markOffset: number;
      color?: string;
    }
  ): string {
    const { cropMarks, registrationMarks, markLength, markOffset, color = '#000000' } = printMarksConfig;
    
    if (!cropMarks && !registrationMarks) {
      return '';
    }
    
    // Scale the mark dimensions
    const scaledMarkLength = markLength * scale;
    const scaledMarkOffset = markOffset * scale;
    const scaledBleedPx = bleedPx * scale;
    
    // Artboard position in canvas coordinates (after printExpansion offset)
    const scaledPrintExpansion = printExpansion * scale;
    const artboardX = scaledPrintExpansion;
    const artboardY = scaledPrintExpansion;
    const scaledArtboardWidth = artboardWidth * scale;
    const scaledArtboardHeight = artboardHeight * scale;
    
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">`;
    svgContent += `<g stroke="${color}" stroke-width="1" fill="none">`;
    
    // Crop marks at artboard corners (positioned outside the bleed area)
    if (cropMarks) {
      const corners = [
        { x: artboardX, y: artboardY, dx: -1, dy: -1 },                                    // Top-left
        { x: artboardX + scaledArtboardWidth, y: artboardY, dx: 1, dy: -1 },               // Top-right
        { x: artboardX, y: artboardY + scaledArtboardHeight, dx: -1, dy: 1 },              // Bottom-left
        { x: artboardX + scaledArtboardWidth, y: artboardY + scaledArtboardHeight, dx: 1, dy: 1 }  // Bottom-right
      ];
      
      corners.forEach(corner => {
        const offsetX = (scaledBleedPx + scaledMarkOffset) * corner.dx;
        const offsetY = (scaledBleedPx + scaledMarkOffset) * corner.dy;
        
        // Horizontal crop mark
        const hx1 = corner.x + offsetX;
        const hx2 = corner.x + offsetX + (scaledMarkLength * corner.dx);
        svgContent += `<line x1="${hx1}" y1="${corner.y}" x2="${hx2}" y2="${corner.y}"/>`;
        
        // Vertical crop mark
        const vy1 = corner.y + offsetY;
        const vy2 = corner.y + offsetY + (scaledMarkLength * corner.dy);
        svgContent += `<line x1="${corner.x}" y1="${vy1}" x2="${corner.x}" y2="${vy2}"/>`;
      });
    }
    
    // Registration marks (crosshairs at center of each edge)
    if (registrationMarks) {
      const regMarkSize = 8 * scale;
      const regCircleRadius = 4 * scale;
      
      const edgeCenters = [
        { x: artboardX + scaledArtboardWidth / 2, y: artboardY - scaledBleedPx - scaledMarkOffset - regMarkSize },  // Top
        { x: artboardX + scaledArtboardWidth / 2, y: artboardY + scaledArtboardHeight + scaledBleedPx + scaledMarkOffset + regMarkSize },  // Bottom
        { x: artboardX - scaledBleedPx - scaledMarkOffset - regMarkSize, y: artboardY + scaledArtboardHeight / 2 },  // Left
        { x: artboardX + scaledArtboardWidth + scaledBleedPx + scaledMarkOffset + regMarkSize, y: artboardY + scaledArtboardHeight / 2 }   // Right
      ];
      
      edgeCenters.forEach(center => {
        // Draw crosshair
        svgContent += `<line x1="${center.x - regMarkSize}" y1="${center.y}" x2="${center.x + regMarkSize}" y2="${center.y}"/>`;
        svgContent += `<line x1="${center.x}" y1="${center.y - regMarkSize}" x2="${center.x}" y2="${center.y + regMarkSize}"/>`;
        // Draw circle
        svgContent += `<circle cx="${center.x}" cy="${center.y}" r="${regCircleRadius}"/>`;
      });
    }
    
    svgContent += '</g></svg>';
    return svgContent;
  }

  private generateBleedOverlaySvg(
    canvasWidth: number,
    canvasHeight: number,
    artboardWidth: number,
    artboardHeight: number,
    scale: number,
    bleedPx: number,
    safeZonePx: number,
    printExpansion: number,
    bleedColor: string,
    safeZoneColor: string | null
  ): string {
    const scaledPrintExpansion = printExpansion * scale;
    const scaledBleedPx = bleedPx * scale;
    const scaledSafeZonePx = safeZonePx * scale;
    const scaledArtboardWidth = artboardWidth * scale;
    const scaledArtboardHeight = artboardHeight * scale;

    // Artboard top-left in canvas coordinates
    const artboardX = scaledPrintExpansion;
    const artboardY = scaledPrintExpansion;

    // Bleed rect: expands outward from artboard by bleedPx
    const bleedRectX = artboardX - scaledBleedPx;
    const bleedRectY = artboardY - scaledBleedPx;
    const bleedRectW = scaledArtboardWidth + scaledBleedPx * 2;
    const bleedRectH = scaledArtboardHeight + scaledBleedPx * 2;

    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">`;

    // Bleed rectangle
    svgContent += `<rect x="${bleedRectX}" y="${bleedRectY}" width="${bleedRectW}" height="${bleedRectH}" fill="none" stroke="${bleedColor}" stroke-width="2"/>`;

    // Safe zone rectangle (inside artboard)
    if (safeZoneColor && scaledSafeZonePx > 0) {
      const szX = artboardX + scaledSafeZonePx;
      const szY = artboardY + scaledSafeZonePx;
      const szW = scaledArtboardWidth - scaledSafeZonePx * 2;
      const szH = scaledArtboardHeight - scaledSafeZonePx * 2;
      svgContent += `<rect x="${szX}" y="${szY}" width="${szW}" height="${szH}" fill="none" stroke="${safeZoneColor}" stroke-width="2"/>`;
    }

    svgContent += '</svg>';
    return svgContent;
  }
}

export const highResExportService = new HighResolutionExportService();