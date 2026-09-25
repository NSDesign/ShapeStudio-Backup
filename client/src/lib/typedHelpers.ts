/**
 * Typed helpers for safe access to dynamic properties in generation sets
 */

import { 
  SupportedShapeType, 
  BlendMode, 
  GenerationSet,
  BatchConfigSettings,
  ShapeSpecificProperties
} from '@shared/schema';

// Type definitions for shape-specific properties
interface RoundedShapeProperties {
  cornerRadiusMode?: 'fixed' | 'range';
  cornerRadiusValue?: number;
  cornerRadiusRange?: [number, number];
}

interface PolygonProperties {
  pointCountMode?: 'fixed' | 'range';
  pointCountValue?: number;
  pointCountRange?: [number, number];
}

interface StarProperties extends PolygonProperties {
  innerRadiusMode?: 'fixed' | 'range';
  innerRadiusValue?: number;
  innerRadiusRange?: [number, number];
}

interface RingProperties {
  innerRadiusMode?: 'fixed' | 'range';
  innerRadiusValue?: number;
  innerRadiusRange?: [number, number];
}

// Type-safe shape specific property accessor with improved typing
export class ShapeSpecificPropertiesHelper {
  private properties: Partial<Record<SupportedShapeType, Record<string, unknown>>>;

  constructor(properties: ShapeSpecificProperties | Partial<Record<SupportedShapeType, Record<string, unknown>>> = {}) {
    this.properties = properties;
  }

  // Get property for a specific shape type with improved type safety
  getProperty<T = unknown>(shapeType: SupportedShapeType, property: string, defaultValue?: T): T | undefined {
    const shapeProperties = this.properties[shapeType];
    if (!shapeProperties || !(property in shapeProperties)) {
      return defaultValue;
    }
    return shapeProperties[property] as T ?? defaultValue;
  }

  // Type-safe getters for common properties
  getRoundedShapeProperties(shapeType: 'rounded-rectangle' | 'rounded-square'): RoundedShapeProperties {
    return this.properties[shapeType] as RoundedShapeProperties ?? {};
  }

  getPolygonProperties(shapeType: 'polygon'): PolygonProperties {
    return this.properties[shapeType] as PolygonProperties ?? {};
  }

  getStarProperties(shapeType: 'star'): StarProperties {
    return this.properties[shapeType] as StarProperties ?? {};
  }

  getRingProperties(shapeType: 'ring' | 'spline-ring'): RingProperties {
    return this.properties[shapeType] as RingProperties ?? {};
  }

  // Set property for a specific shape type with improved type safety
  setProperty<T = unknown>(shapeType: SupportedShapeType, property: string, value: T): Partial<Record<SupportedShapeType, Record<string, unknown>>> {
    return {
      ...this.properties,
      [shapeType]: {
        ...this.properties[shapeType],
        [property]: value
      }
    };
  }

  // Type-safe setters for common properties
  setRoundedShapeProperties(shapeType: 'rounded-rectangle' | 'rounded-square', properties: Partial<RoundedShapeProperties>): Partial<Record<SupportedShapeType, Record<string, unknown>>> {
    return {
      ...this.properties,
      [shapeType]: {
        ...this.properties[shapeType],
        ...properties
      }
    };
  }

  setPolygonProperties(shapeType: 'polygon', properties: Partial<PolygonProperties>): Partial<Record<SupportedShapeType, Record<string, unknown>>> {
    return {
      ...this.properties,
      [shapeType]: {
        ...this.properties[shapeType],
        ...properties
      }
    };
  }

  setStarProperties(shapeType: 'star', properties: Partial<StarProperties>): Partial<Record<SupportedShapeType, Record<string, unknown>>> {
    return {
      ...this.properties,
      [shapeType]: {
        ...this.properties[shapeType],
        ...properties
      }
    };
  }

  setRingProperties(shapeType: 'ring' | 'spline-ring', properties: Partial<RingProperties>): Partial<Record<SupportedShapeType, Record<string, unknown>>> {
    return {
      ...this.properties,
      [shapeType]: {
        ...this.properties[shapeType],
        ...properties
      }
    };
  }

  // Check if shape type has properties
  hasProperties(shapeType: SupportedShapeType): boolean {
    return Boolean(this.properties[shapeType] && Object.keys(this.properties[shapeType]).length > 0);
  }

  // Get all properties for a shape type with improved type safety
  getShapeProperties(shapeType: SupportedShapeType): Record<string, unknown> {
    return this.properties[shapeType] ?? {};
  }

  // Remove all properties for a shape type
  removeShapeProperties(shapeType: SupportedShapeType): Partial<Record<SupportedShapeType, Record<string, unknown>>> {
    const { [shapeType]: removed, ...remaining } = this.properties;
    return remaining;
  }
}

// Type-safe blend mode helper
export class BlendModeHelper {
  private blendModes: Partial<Record<BlendMode, number>>;

  constructor(blendModes: Partial<Record<BlendMode, number>> = {}) {
    this.blendModes = blendModes;
  }

  // Get weight for a blend mode
  getWeight(mode: BlendMode): number {
    return this.blendModes[mode] ?? 0;
  }

  // Set weight for a blend mode
  setWeight(mode: BlendMode, weight: number): Partial<Record<BlendMode, number>> {
    return {
      ...this.blendModes,
      [mode]: Math.max(0, Math.min(100, weight))
    };
  }

  // Toggle blend mode (set to 50 if 0, or 0 if has value)
  toggleMode(mode: BlendMode): Partial<Record<BlendMode, number>> {
    const currentWeight = this.getWeight(mode);
    return this.setWeight(mode, currentWeight > 0 ? 0 : 50);
  }

  // Check if blend mode is enabled (weight > 0)
  isEnabled(mode: BlendMode): boolean {
    return this.getWeight(mode) > 0;
  }

  // Get all enabled blend modes
  getEnabledModes(): BlendMode[] {
    return Object.entries(this.blendModes)
      .filter(([_, weight]) => weight && weight > 0)
      .map(([mode, _]) => mode as BlendMode);
  }

  // Get total weight of all blend modes
  getTotalWeight(): number {
    return Object.values(this.blendModes).reduce((sum, weight) => sum + (weight || 0), 0);
  }

  // Remove blend mode
  removeMode(mode: BlendMode): Partial<Record<BlendMode, number>> {
    const { [mode]: removed, ...remaining } = this.blendModes;
    return remaining;
  }
}

// Validation result interface
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  code: string;
}

// Generation set validator
export class GenerationSetValidator {
  static validateGenerationSet(generationSet: GenerationSet): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Validate name
    if (!generationSet.name?.trim()) {
      errors.push({
        field: 'name',
        message: 'Set name is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (generationSet.name?.trim().length > 50) {
      warnings.push({
        field: 'name',
        message: 'Set name is quite long and may be truncated in displays',
        code: 'LONG_NAME'
      });
    }

    // Validate shape types
    if (generationSet.enabledShapeTypes.length === 0) {
      errors.push({
        field: 'enabledShapeTypes',
        message: 'At least one shape type must be selected',
        code: 'NO_SHAPE_TYPES'
      });
    }

    // Validate shape count
    if (generationSet.shapeCountMode === 'fixed') {
      if (generationSet.shapeCountFixed < 1 || generationSet.shapeCountFixed > 1000) {
        errors.push({
          field: 'shapeCountFixed',
          message: 'Shape count must be between 1 and 1000',
          code: 'INVALID_SHAPE_COUNT'
        });
      }
    } else {
      const [min, max] = generationSet.shapeCountRange;
      if (min < 1 || max > 1000 || min > max) {
        errors.push({
          field: 'shapeCountRange',
          message: 'Shape count range must be between 1 and 1000 with min ≤ max',
          code: 'INVALID_SHAPE_COUNT_RANGE'
        });
      }
    }

    // Validate z-index configuration
    const zConfig = generationSet.zIndexConfig;
    if (zConfig.baseOffset < -1000 || zConfig.baseOffset > 1000) {
      warnings.push({
        field: 'zIndexConfig.baseOffset',
        message: 'Z-index base offset outside -1000 to 1000 may cause rendering issues',
        code: 'EXTREME_ZINDEX'
      });
    }
    
    if (zConfig.incrementPerShape < 0 || zConfig.incrementPerShape > 100) {
      warnings.push({
        field: 'zIndexConfig.incrementPerShape',
        message: 'Z-index increment per shape should be between 0 and 100',
        code: 'EXTREME_ZINDEX_INCREMENT'
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  // Validate multiple generation sets for conflicts
  static validateGenerationSets(generationSets: GenerationSet[]): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check for duplicate names
    const nameMap = new Map<string, number>();
    generationSets.forEach((set, index) => {
      const name = set.name.trim().toLowerCase();
      if (nameMap.has(name)) {
        errors.push({
          field: `sets.${index}.name`,
          message: `Duplicate set name "${set.name}" (conflicts with set item #${nameMap.get(name)! + 1})`,
          code: 'DUPLICATE_NAME'
        });
      }
      nameMap.set(name, index);
    });

    // Check for generation order conflicts
    const orderMap = new Map<number, number>();
    generationSets.forEach((set, index) => {
      if (orderMap.has(set.generationOrder)) {
        errors.push({
          field: `sets.${index}.generationOrder`,
          message: `Duplicate generation order ${set.generationOrder} (conflicts with set ${orderMap.get(set.generationOrder)! + 1})`,
          code: 'DUPLICATE_ORDER'
        });
      }
      orderMap.set(set.generationOrder, index);
    });

    // Check for z-index conflicts (only warn)
    const enabledSets = generationSets.filter(set => set.enabled);
    
    // Check for overlapping z-index ranges between sets
    for (let i = 0; i < enabledSets.length; i++) {
      for (let j = i + 1; j < enabledSets.length; j++) {
        const setA = enabledSets[i];
        const setB = enabledSets[j];
        
        // Calculate potential z-index ranges (estimate with max 100 shapes)
        const maxShapes = 100;
        const rangeA = {
          min: setA.zIndexConfig.baseOffset,
          max: setA.zIndexConfig.baseOffset + (maxShapes * setA.zIndexConfig.incrementPerShape)
        };
        const rangeB = {
          min: setB.zIndexConfig.baseOffset,
          max: setB.zIndexConfig.baseOffset + (maxShapes * setB.zIndexConfig.incrementPerShape)
        };
        
        // Check for overlap
        if (rangeA.min <= rangeB.max && rangeB.min <= rangeA.max) {
          warnings.push({
            field: 'zIndexConfig',
            message: `Z-index ranges may overlap between "${setA.name}" and "${setB.name}"`,
            code: 'ZINDEX_OVERLAP'
          });
        }
      }
    }

    // Individual set validation
    generationSets.forEach((set, index) => {
      const setValidation = this.validateGenerationSet(set);
      setValidation.errors.forEach(error => {
        errors.push({
          ...error,
          field: `sets.${index}.${error.field}`,
          message: `Set "${set.name}": ${error.message}`
        });
      });
      setValidation.warnings.forEach(warning => {
        warnings.push({
          ...warning,
          field: `sets.${index}.${warning.field}`,
          message: `Set "${set.name}": ${warning.message}`
        });
      });
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
}

// Improved utility function to create safe property updaters with better typing
export function createSafePropertyUpdater<T extends Record<string, unknown>, K extends keyof T>(
  currentProperties: T,
  key: K,
  value: T[K]
): T {
  return {
    ...currentProperties,
    [key]: value
  };
}

// Type-safe property updater for nested objects
export function createSafeNestedPropertyUpdater<
  T extends Record<string, unknown>,
  K extends keyof T,
  NK extends keyof NonNullable<T[K]>
>(
  currentProperties: T,
  key: K,
  nestedKey: NK,
  value: NonNullable<T[K]>[NK]
): T {
  const currentNested = (currentProperties[key] as Record<string, unknown>) ?? {};
  return {
    ...currentProperties,
    [key]: {
      ...currentNested,
      [nestedKey]: value
    }
  };
}

// Type guard for checking if a value is a valid blend mode
export function isValidBlendMode(value: string): value is BlendMode {
  const validModes: BlendMode[] = [
    'source-over', 'multiply', 'screen', 'overlay', 'darken',
    'lighten', 'color-dodge', 'color-burn', 'hard-light',
    'soft-light', 'difference', 'exclusion', 'hue',
    'saturation', 'color', 'luminosity'
  ];
  return validModes.includes(value as BlendMode);
}

// Type guard for checking if a value is a valid shape type
export function isValidShapeType(value: string): value is SupportedShapeType {
  const validTypes: SupportedShapeType[] = [
    'rectangle', 'rounded-rectangle', 'square', 'rounded-square',
    'circle', 'ellipse', 'triangle', 'right-triangle', 'pentagon',
    'hexagon', 'rhombus', 'parallelogram', 'trapezoid', 'star',
    'polygon', 'heart', 'arrow', 'cross', 'kite', 'semicircle',
    'line', 'line-vector', 'bezier', 'cubic', 'smooth-spline', 'ring', 'blob',
    'chunk', 'spline-circle', 'spline-ellipse', 'spline-ring'
  ];
  return validTypes.includes(value as SupportedShapeType);
}

// Helper to safely parse numbers with fallback
export function safeParseNumber(value: any, fallback: number = 0): number {
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  return isNaN(parsed) ? fallback : parsed;
}

// Helper to safely parse arrays with fallback
export function safeParseArray<T>(value: any, fallback: T[] = []): T[] {
  return Array.isArray(value) ? value : fallback;
}

