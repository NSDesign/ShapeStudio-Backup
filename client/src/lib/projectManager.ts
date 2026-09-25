import { Shape, ShapeGroupClass } from './shapes';
import { CanvasSettings, ScatterSettings, ShapeType, Artboard, PrintConfig, DEFAULT_PRINT_CONFIG, getEffectivePrintConfig } from './shapeTypes';
import type { GenerationSet, SidebarSectionConfig, SavedArtboard, OverlayManagerState } from '@shared/schema';
import {
  createShapeSetsTransport,
  createArtboardsTransport,
  parseConfigImportJson,
  type ShapeSetsTransport,
  type ArtboardsTransport,
  type ImportDiagnostic,
  CONFIG_IMPORT_LIMITS,
  migrateAndValidateGenerationSets,
} from './configImport';

export interface AppSettingsDefaults {
  exportFormat?: string;
  exportQuality?: number;
  exportScale?: number;
  exportMode?: string;
  artboardName?: string;
  artboardWidth?: number;
  artboardHeight?: number;
  artboardBackgroundColor?: string;
  artboardGridColor?: string;
  artboardDisplayGrid?: boolean;
  artboardDisplayBorder?: boolean;
  artboardDpi?: number;
  artboardUnitType?: 'pixels' | 'mm' | 'cm' | 'inches';
  artboardDisplayName?: boolean;
  artboardDisplayDimensions?: boolean;
  artboardDisplayResolution?: boolean;
  canvasPanX?: number;
  canvasPanY?: number;
  canvasZoom?: number;
  sidebarCollapsed?: boolean;
  showMultiSelectButton?: boolean;
  showSelectedCount?: boolean;
  printOverlayUnit?: 'pixels' | 'mm' | 'cm' | 'inches';
  printBleedAmount?: number;
  printBleedDisplay?: boolean;
  printBleedRender?: boolean;
  printBleedColor?: string;
  printSafeZoneAmount?: number;
  printSafeZoneDisplay?: boolean;
  printSafeZoneColor?: string;
  printMarksCropMarks?: boolean;
  printMarksRegistrationMarks?: boolean;
  printMarksMarkLength?: number;
  printMarksMarkOffset?: number;
  printMarksDisplay?: boolean;
  printMarksRender?: boolean;
  printMarksScaleMode?: 'none' | 'percent';
  printMarksColor?: string;
  printBackgroundMode?: 'transparent' | 'artboard' | 'custom';
  printBackgroundCustomColor?: string;
  printBackgroundDisplay?: boolean;
  printBackgroundRender?: boolean;
}

export interface ExportSettingsData {
  batchExportMode?: string;
  enableGenerationSets?: boolean;
  batchCount?: number;
  exportSaveProjectFiles?: boolean; // Match shared/schema.ts naming
}

export interface ArtboardConfig {
  width: number;
  height: number;
  backgroundColor: string;
  dpi?: number;
  unitType?: 'pixels' | 'mm' | 'cm' | 'inches';
  displayGrid?: boolean;
  displayBorder?: boolean;
  displayName?: boolean;
  displayDimensions?: boolean;
  displayResolution?: boolean;
  name?: string;
  printConfig?: PrintConfig;
}

export interface ProjectData {
  version: string;
  /** 'generated' for shape output files, 'generator' for configuration files.
   * Absent in legacy files — treated as 'generated'. */
  type?: 'generated' | 'generator';
  timestamp: string;
  name: string;
  shapes: any[]; // Serialized shape data
  groups?: any[]; // Serialized group data (optional, only included when non-empty)
  artboard: ArtboardConfig; // Minimal artboard config for reproducing exports
}

/** File produced by saveGeneratorProject — captures pre-generation state only. */
export interface GeneratorProjectData {
  version: string;
  type: 'generator';
  timestamp: string;
  name: string;
  generationSets: GenerationSet[];
  currentSetId: string | null;
  artboard: ArtboardConfig;
}

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export class ProjectManager {
  static async saveProject(
    shapes: Shape[],
    groups: ShapeGroupClass[],
    artboard: Artboard,
    projectName?: string
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const name = projectName || `shape-editor-${timestamp.slice(0, 10)}`;
    
    const printConfig = getEffectivePrintConfig(artboard);
    const projectData: ProjectData = {
      version: '1.0.0',
      type: 'generated',
      timestamp,
      name,
      shapes: shapes.map(shape => this.serializeShape(shape)),
      ...(groups.length > 0 && { groups: groups.map(group => this.serializeGroup(group)) }),
      artboard: {
        width: artboard.width,
        height: artboard.height,
        backgroundColor: artboard.backgroundColor || '#ffffff',
        dpi: artboard.dpi ?? 72,
        unitType: artboard.unitType ?? 'pixels',
        displayGrid: artboard.displayGrid ?? false,
        displayBorder: artboard.displayBorder ?? true,
        displayName: artboard.displayName ?? true,
        displayDimensions: artboard.displayDimensions ?? false,
        displayResolution: artboard.displayResolution ?? false,
        name: artboard.name,
        printConfig
      }
    };

    const jsonData = JSON.stringify(projectData, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.generated.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /** Save the pre-generation configuration (shape sets + artboard) as a .generator.json file. */
  static async saveGeneratorProject(
    generationSets: GenerationSet[],
    currentSetId: string | null,
    artboard: Artboard,
    projectName?: string
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const name = projectName || `shape-studio-${timestamp.slice(0, 10)}`;

    const printConfig = getEffectivePrintConfig(artboard);
    const generatorData: GeneratorProjectData = {
      version: '1.0.0',
      type: 'generator',
      timestamp,
      name,
      generationSets,
      currentSetId,
      artboard: {
        width: artboard.width,
        height: artboard.height,
        backgroundColor: artboard.backgroundColor || '#ffffff',
        dpi: artboard.dpi ?? 72,
        unitType: artboard.unitType ?? 'pixels',
        displayGrid: artboard.displayGrid ?? false,
        displayBorder: artboard.displayBorder ?? true,
        displayName: artboard.displayName ?? true,
        displayDimensions: artboard.displayDimensions ?? false,
        displayResolution: artboard.displayResolution ?? false,
        name: artboard.name,
        printConfig
      }
    };

    downloadJson(generatorData, `${name}.generator.json`);
  }

  /** Save selected/all portable shape-set configuration. */
  static async saveShapeSetsProject(
    generationSets: GenerationSet[],
    currentSetId: string | null,
    projectName?: string,
    overlayManagerState?: OverlayManagerState,
  ): Promise<void> {
    const name = projectName || `shape-sets-${new Date().toISOString().slice(0, 10)}`;
    downloadJson(createShapeSetsTransport(generationSets, currentSetId, name, overlayManagerState), `${name}.shapesets.json`);
  }

  /** Save selected/all portable artboard configuration. */
  static async saveArtboardsProject(
    artboards: Artboard[],
    activeArtboardId: string | null,
    projectName?: string,
  ): Promise<void> {
    const name = projectName || `artboards-${new Date().toISOString().slice(0, 10)}`;
    downloadJson(createArtboardsTransport(artboards, activeArtboardId, name), `${name}.artboards.json`);
  }

  private static async loadPortableDocument(file: File): Promise<{
    data: ShapeSetsTransport | ArtboardsTransport;
    diagnostics: ImportDiagnostic[];
  }> {
    const text = await file.text();
    const parsed = parseConfigImportJson(text);
    if (!parsed.success) {
      throw new Error(parsed.diagnostics.map(d => d.path ? `${d.path}: ${d.message}` : d.message).join(' '));
    }
    return { data: parsed.data, diagnostics: parsed.diagnostics };
  }

  static async loadShapeSetsProject(file: File): Promise<{ data: ShapeSetsTransport; diagnostics: ImportDiagnostic[] }> {
    const { data, diagnostics } = await this.loadPortableDocument(file);
    if (data.type !== 'shape-sets') {
      throw new Error('This is not a portable shape-set file. Use the matching configuration import slot.');
    }
    return { data, diagnostics };
  }

  static async loadArtboardsProject(file: File): Promise<{ data: ArtboardsTransport; diagnostics: ImportDiagnostic[] }> {
    const { data, diagnostics } = await this.loadPortableDocument(file);
    if (data.type !== 'artboards') {
      throw new Error('This is not a portable artboard file. Use the matching configuration import slot.');
    }
    return { data, diagnostics };
  }

  /** Load a generator project file. Returns the generation sets, current set ID, and artboard config. */
  static async loadGeneratorProject(file: File): Promise<{
    generationSets: GenerationSet[];
    currentSetId: string | null;
    artboard: ArtboardConfig;
    projectName: string;
  }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const rawText = e.target?.result as string;
          if (new TextEncoder().encode(rawText).byteLength > CONFIG_IMPORT_LIMITS.maxDocumentBytes) {
            throw new Error(`Generator files must be smaller than ${CONFIG_IMPORT_LIMITS.maxDocumentBytes} bytes.`);
          }
          const data: any = JSON.parse(rawText);

          if (data.type !== 'generator') {
            throw new Error(
              data.type === 'generated'
                ? 'This is a Generated file (shapes output), not a Generator file. Use "Load Generated" to load it.'
                : 'This file does not appear to be a Generator project file.'
            );
          }

          if (!Array.isArray(data.generationSets) || data.generationSets.length > CONFIG_IMPORT_LIMITS.maxSets) {
            throw new Error('Invalid generator file: missing generationSets array.');
          }
          const invalidSetIndex = data.generationSets.findIndex((set: any) =>
            !set || typeof set !== 'object' ||
            typeof set.id !== 'string' || !set.id.trim() ||
            typeof set.name !== 'string' || !set.name.trim() ||
            !Array.isArray(set.enabledShapeTypes) ||
            !set.batchConfig || typeof set.batchConfig !== 'object' || Array.isArray(set.batchConfig)
          );
          if (invalidSetIndex !== -1) {
            throw new Error(`Invalid generator file: generationSets[${invalidSetIndex}] must include an ID, name, enabledShapeTypes array, and batchConfig object.`);
          }
          const validUnits = new Set(['pixels', 'mm', 'cm', 'inches']);
          const migratedSets = migrateAndValidateGenerationSets(data.generationSets);
          if (!migratedSets.success) {
            throw new Error(`Invalid generator file: ${migratedSets.diagnostics.map(item => item.message).join('; ')}`);
          }
          data.generationSets = migratedSets.data;
          const ids = data.generationSets.map((set: GenerationSet) => set.id);
          if (new Set(ids).size !== ids.length) {
            throw new Error('Invalid generator file: generation set IDs must be unique.');
          }
          const names = data.generationSets.map((set: GenerationSet) => set.name);
          if (new Set(names).size !== names.length) {
            throw new Error('Invalid generator file: generation set names must be unique.');
          }
          if (data.currentSetId !== undefined && data.currentSetId !== null &&
            (typeof data.currentSetId !== 'string' || !ids.includes(data.currentSetId))) {
            throw new Error('Invalid generator file: currentSetId does not identify an imported shape set.');
          }

          const rawArtboard = data.artboard ?? null;
          let artboard: ArtboardConfig;
          if (rawArtboard) {
            const dpi = rawArtboard.dpi ?? 72;
            const unitType = rawArtboard.unitType ?? 'pixels';
            if (!Number.isFinite(rawArtboard.width) || rawArtboard.width <= 0 || rawArtboard.width > 100000 ||
                !Number.isFinite(rawArtboard.height) || rawArtboard.height <= 0 || rawArtboard.height > 100000 ||
                !Number.isFinite(dpi) || dpi < 1 || dpi > 1200 || !validUnits.has(unitType)) {
              throw new Error('Invalid generator file: artboard dimensions, DPI, or unit are outside supported limits.');
            }
            const backgroundColor = rawArtboard.backgroundColor || '#ffffff';
            artboard = {
              width: rawArtboard.width || 1200,
              height: rawArtboard.height || 800,
              backgroundColor,
              dpi,
              unitType,
              displayGrid: rawArtboard.displayGrid ?? false,
              displayBorder: rawArtboard.displayBorder ?? true,
              displayName: rawArtboard.displayName ?? true,
              displayDimensions: rawArtboard.displayDimensions ?? false,
              displayResolution: rawArtboard.displayResolution ?? false,
              name: rawArtboard.name,
              printConfig: getEffectivePrintConfig({
                dpi,
                unitType,
                backgroundColor,
                printConfig: rawArtboard.printConfig,
              })
            };
          } else {
            artboard = {
              width: 1200,
              height: 800,
              backgroundColor: '#ffffff',
              dpi: 72,
              unitType: 'pixels',
              displayGrid: false,
              displayBorder: true,
              displayName: true,
              displayDimensions: false,
              displayResolution: false,
              printConfig: DEFAULT_PRINT_CONFIG
            };
          }

          resolve({
            generationSets: data.generationSets as GenerationSet[],
            currentSetId: data.currentSetId ?? null,
            artboard,
            projectName: data.name ?? 'Untitled'
          });
        } catch (error) {
          reject(new Error(`Failed to load generator file: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  static async loadProject(file: File): Promise<{
    shapes: Shape[];
    groups: ShapeGroupClass[];
    artboard: ArtboardConfig;
    projectName: string;
  }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const projectData: any = JSON.parse(e.target?.result as string);

          // Reject generator files — they must be loaded via loadGeneratorProject
          if (projectData.type === 'generator') {
            throw new Error(
              'This is a Generator file (shape set configuration). Use "Load Generator" to load it.'
            );
          }

          // Validate project data
          // Batch-export files put version inside metadata; standard saves put it at the top level
          const hasVersion = projectData.version || projectData.metadata?.version;
          if (!hasVersion || !projectData.shapes) {
            throw new Error('Invalid project file format');
          }

          const shapes = projectData.shapes.map((shapeData: any) => this.deserializeShape(shapeData));
          const groups = (projectData.groups || []).map((groupData: any) => this.deserializeGroup(groupData));
          
          // Extract artboard config
          // Batch-export files use `artboards` (array); standard saves use `artboard` (single object)
          const rawArtboard = projectData.artboard ?? projectData.artboards?.[0] ?? null;
          let artboard: ArtboardConfig;
          if (rawArtboard) {
            const dpi = rawArtboard.dpi ?? 72;
            const unitType = rawArtboard.unitType ?? 'pixels';
            const backgroundColor = rawArtboard.backgroundColor || '#ffffff';
            
            artboard = {
              width: rawArtboard.width || 1200,
              height: rawArtboard.height || 800,
              backgroundColor,
              dpi,
              unitType,
              displayGrid: rawArtboard.displayGrid ?? false,
              displayBorder: rawArtboard.displayBorder ?? true,
              displayName: rawArtboard.displayName ?? true,
              displayDimensions: rawArtboard.displayDimensions ?? false,
              displayResolution: rawArtboard.displayResolution ?? false,
              name: rawArtboard.name,
              printConfig: getEffectivePrintConfig({
                dpi,
                unitType,
                backgroundColor,
                printConfig: rawArtboard.printConfig,
              })
            };
          } else if (projectData.canvasSettings) {
            // Legacy compatibility: extract from canvasSettings
            const backgroundColor = projectData.canvasSettings.backgroundColor || '#ffffff';
            artboard = {
              width: projectData.canvasSettings.width || 1200,
              height: projectData.canvasSettings.height || 800,
              backgroundColor,
              dpi: 72,
              unitType: 'pixels',
              displayGrid: false,
              displayBorder: true,
              displayName: true,
              displayDimensions: false,
              displayResolution: false,
              printConfig: getEffectivePrintConfig({
                dpi: 72,
                unitType: 'pixels',
                backgroundColor
              })
            };
          } else {
            // Default fallback
            artboard = {
              width: 1200,
              height: 800,
              backgroundColor: '#ffffff',
              dpi: 72,
              unitType: 'pixels',
              displayGrid: false,
              displayBorder: true,
              displayName: true,
              displayDimensions: false,
              displayResolution: false,
              printConfig: DEFAULT_PRINT_CONFIG
            };
          }
          
          resolve({
            shapes,
            groups,
            artboard,
            projectName: projectData.name
          });
        } catch (error) {
          reject(new Error(`Failed to load project: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  private static serializeShape(shape: Shape): any {
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
      closed: shape.closed,
      segments: shape.segments,
      renderType: shape.renderType,
      tangentHandles: shape.tangentHandles,
      renderModeOverride: shape.renderModeOverride,
    };
  }

  private static serializeGroup(group: ShapeGroupClass): any {
    return {
      id: group.id,
      shapes: group.shapes.map(shape => this.serializeShape(shape)),
      transform: group.transform
    };
  }

  private static deserializeShape(data: any): Shape {
    const shape = new Shape(data.type, data.transform.x, data.transform.y);
    
    // Restore all properties
    shape.id = data.id;
    shape.transform = data.transform;
    shape.properties = data.properties;
    shape.selected = false;
    shape.points = data.points || [];
    shape.sides = data.sides;
    shape.radius = data.radius;
    shape.innerRadius = data.innerRadius;
    shape.width = data.width;
    shape.height = data.height;
    shape.controlPoints = data.controlPoints;
    shape.closed = data.closed;
    // Curve-rendering fields — critical for bezier/cubic shapes to draw correctly
    if (data.segments !== undefined) shape.segments = data.segments;
    if (data.renderType !== undefined) shape.renderType = data.renderType;
    if (data.tangentHandles !== undefined) shape.tangentHandles = data.tangentHandles;
    if (data.renderModeOverride !== undefined) shape.renderModeOverride = data.renderModeOverride;
    
    return shape;
  }

  private static deserializeGroup(data: any): ShapeGroupClass {
    const shapes = data.shapes.map((shapeData: any) => this.deserializeShape(shapeData));
    const group = new ShapeGroupClass(shapes);
    
    group.id = data.id;
    group.transform = data.transform;
    group.selected = false;
    
    return group;
  }

  static exportAsJSON(
    shapes: Shape[],
    groups: ShapeGroupClass[],
    artboard: Artboard
  ): string {
    const projectData: ProjectData = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      name: `shape-editor-export-${Date.now()}`,
      shapes: shapes.map(shape => this.serializeShape(shape)),
      ...(groups.length > 0 && { groups: groups.map(group => this.serializeGroup(group)) }),
      artboard: {
        width: artboard.width,
        height: artboard.height,
        backgroundColor: artboard.backgroundColor || '#ffffff'
      }
    };

    return JSON.stringify(projectData, null, 2);
  }
}