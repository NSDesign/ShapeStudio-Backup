import { ProjectManager } from '../../client/src/lib/projectManager';
import { Shape, ShapeGroupClass } from '../../client/src/lib/shapes';
import { CanvasSettings, Artboard, ScatterSettings } from '../../client/src/lib/shapeTypes';
import type { BatchConfigSettings, GenerationSet, SidebarSectionConfig } from '../../shared/schema';
import * as fs from 'fs';
import * as path from 'path';

export interface ExportSettingsData {
  batchExportMode?: string;
  enableGenerationSets?: boolean;
  batchCount?: number;
  exportSaveProjectFiles?: boolean; // Match shared/schema.ts naming
}

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
}

export interface SaveProjectSettings {
  projectName?: string;
  includeTimestamp?: boolean;
  generationSets?: GenerationSet[];
  currentSetId?: string | null;
  exportSettings?: ExportSettingsData;
  appSettingsDefaults?: AppSettingsDefaults;
  artboard?: Artboard;
  sidebarSections?: SidebarSectionConfig;
}

export interface ProjectSaveResult {
  success: boolean;
  filename: string;
  downloadUrl: string;
  projectData?: any;
}

export class ProjectService {
  constructor() {
    // Ensure projects directory exists
    const projectsDir = path.join(process.cwd(), 'projects');
    if (!fs.existsSync(projectsDir)) {
      fs.mkdirSync(projectsDir, { recursive: true });
    }
  }

  async saveProject(
    shapes: Shape[],
    groups: ShapeGroupClass[],
    artboard: { width: number; height: number; backgroundColor: string },
    settings: SaveProjectSettings = {}
  ): Promise<ProjectSaveResult> {
    try {
      const timestamp = new Date().toISOString();
      const name = settings.projectName || `shape-editor-${timestamp.slice(0, 10)}`;
      
      // Build minimal project data (shapes + artboard only)
      const projectData: any = {
        version: '1.0.0',
        timestamp,
        name,
        shapes: shapes.map(shape => this.serializeShape(shape)),
        ...(groups.length > 0 && { groups: groups.map(group => this.serializeGroup(group)) }),
        artboard: {
          width: artboard.width || 1200,
          height: artboard.height || 800,
          backgroundColor: artboard.backgroundColor || '#ffffff'
        }
      };

      const filename = settings.includeTimestamp 
        ? `${name}-${timestamp.replace(/[:.]/g, '-').slice(0, -5)}.json`
        : `${name}.json`;
      
      const filePath = path.join(process.cwd(), 'projects', filename);
      const jsonData = JSON.stringify(projectData, null, 2);
      
      fs.writeFileSync(filePath, jsonData);
      
      return {
        success: true,
        filename,
        downloadUrl: `/api/projects/download/${encodeURIComponent(filename)}`,
        projectData
      };
      
    } catch (error) {
      throw new Error(`Failed to save project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getProjectFile(filename: string): Promise<string | null> {
    const filePath = path.join(process.cwd(), 'projects', filename);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    return filePath;
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

  cleanupOldProjects(): void {
    // Clean up projects older than 30 days
    const cutoffTime = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const projectsDir = path.join(process.cwd(), 'projects');
    
    if (fs.existsSync(projectsDir)) {
      const files = fs.readdirSync(projectsDir);
      
      for (const file of files) {
        const filePath = path.join(projectsDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          fs.unlinkSync(filePath);
        }
      }
    }
  }
}