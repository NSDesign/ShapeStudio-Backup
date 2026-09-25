import { Shape } from './shapes';
import { ColorManipulation, HSLShift, ColorRemapping } from './shapeTypes';

// Color Harmony Types
export interface ColorHarmonySettings {
  enabled: boolean;
  harmonyType: 'monochromatic' | 'analogous' | 'complementary' | 'triadic' | 'split-complementary' | 'tetradic';
  baseColor: string;
  hueVariance: number;
  saturationRange: [number, number];
  lightnessRange: [number, number];
  
  // Harmony-specific settings
  monochromaticSettings: {
    lightnessSteps: number;
    saturationSteps: number;
    includeNeutrals: boolean;
  };
  analogousSettings: {
    hueRange: number;
    colorCount: number;
  };
  complementarySettings: {
    includeNearComplements: boolean;
    complementOffset: number;
  };
  triadicSettings: {
    rotationOffset: number;
    useEqualSpacing: boolean;
  };
  splitComplementarySettings: {
    splitAngle: number;
    balanceWeights: boolean;
  };
  tetradicSettings: {
    squareHarmony: boolean;
    rectangleRatio: number;
  };
}

export class ColorUtils {
  /**
   * Convert hex color to HSL values
   */
  static hexToHSL(hex: string): { h: number; s: number; l: number } {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Parse RGB values
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }

    return {
      h: h * 360,
      s: s * 100,
      l: l * 100
    };
  }

  /**
   * Generate color using harmony settings
   */
  static generateHarmonyColor(settings: ColorHarmonySettings): string {
    if (!settings.enabled) {
      // Fallback to current randomization
      const hue = Math.random() * 360;
      const saturation = 50 + Math.random() * 50;
      const lightness = 30 + Math.random() * 40;
      return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }

    const baseHSL = this.hexToHSL(settings.baseColor);
    
    switch (settings.harmonyType) {
      case 'monochromatic':
        return this.generateMonochromaticColor(baseHSL, settings);
      case 'analogous':
        return this.generateAnalogousColor(baseHSL, settings);
      case 'complementary':
        return this.generateComplementaryColor(baseHSL, settings);
      case 'triadic':
        return this.generateTriadicColor(baseHSL, settings);
      case 'split-complementary':
        return this.generateSplitComplementaryColor(baseHSL, settings);
      case 'tetradic':
        return this.generateTetradicColor(baseHSL, settings);
      default:
        return settings.baseColor;
    }
  }

  /**
   * Generate monochromatic color variation
   */
  private static generateMonochromaticColor(baseHSL: { h: number; s: number; l: number }, settings: ColorHarmonySettings): string {
    const { monochromaticSettings, saturationRange, lightnessRange } = settings;
    
    let saturation = baseHSL.s;
    let lightness = baseHSL.l;
    
    // Apply saturation steps
    if (monochromaticSettings.saturationSteps > 1) {
      const satStep = (saturationRange[1] - saturationRange[0]) / (monochromaticSettings.saturationSteps - 1);
      const stepIndex = Math.floor(Math.random() * monochromaticSettings.saturationSteps);
      saturation = saturationRange[0] + (stepIndex * satStep);
    } else {
      saturation = saturationRange[0] + Math.random() * (saturationRange[1] - saturationRange[0]);
    }
    
    // Apply lightness steps
    if (monochromaticSettings.lightnessSteps > 1) {
      const lightStep = (lightnessRange[1] - lightnessRange[0]) / (monochromaticSettings.lightnessSteps - 1);
      const stepIndex = Math.floor(Math.random() * monochromaticSettings.lightnessSteps);
      lightness = lightnessRange[0] + (stepIndex * lightStep);
    } else {
      lightness = lightnessRange[0] + Math.random() * (lightnessRange[1] - lightnessRange[0]);
    }
    
    // Include neutrals option
    if (monochromaticSettings.includeNeutrals && Math.random() < 0.2) {
      saturation = Math.random() * 15; // Very low saturation for neutrals
    }
    
    return `hsl(${baseHSL.h}, ${saturation}%, ${lightness}%)`;
  }

  /**
   * Generate analogous color variation
   */
  private static generateAnalogousColor(baseHSL: { h: number; s: number; l: number }, settings: ColorHarmonySettings): string {
    const { analogousSettings, saturationRange, lightnessRange, hueVariance } = settings;
    
    // Create distinct analogous positions for more visible hue differences
    const analogousPositions = [
      0,  // Base color
      analogousSettings.hueRange / 2,  // Positive direction
      -analogousSettings.hueRange / 2  // Negative direction
    ];
    
    // Randomly select one of the analogous positions
    const selectedPosition = analogousPositions[Math.floor(Math.random() * analogousPositions.length)];
    let hue = (baseHSL.h + selectedPosition + 360) % 360;
    
    // Apply smaller hue variance to maintain analogous relationship
    hue += (Math.random() - 0.5) * Math.min(hueVariance, 10); // Limit variance to 10 degrees
    hue = (hue + 360) % 360;
    
    const saturation = saturationRange[0] + Math.random() * (saturationRange[1] - saturationRange[0]);
    const lightness = lightnessRange[0] + Math.random() * (lightnessRange[1] - lightnessRange[0]);
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  /**
   * Generate complementary color variation
   */
  private static generateComplementaryColor(baseHSL: { h: number; s: number; l: number }, settings: ColorHarmonySettings): string {
    const { complementarySettings, saturationRange, lightnessRange, hueVariance } = settings;
    
    let hue = baseHSL.h;
    
    // 50% chance to use complement
    if (Math.random() < 0.5) {
      hue = (baseHSL.h + 180) % 360;
      
      // Include near complements
      if (complementarySettings.includeNearComplements) {
        hue += (Math.random() - 0.5) * complementarySettings.complementOffset * 2;
      }
    }
    
    // Apply hue variance
    hue += (Math.random() - 0.5) * hueVariance;
    hue = (hue + 360) % 360;
    
    const saturation = saturationRange[0] + Math.random() * (saturationRange[1] - saturationRange[0]);
    const lightness = lightnessRange[0] + Math.random() * (lightnessRange[1] - lightnessRange[0]);
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  /**
   * Generate triadic color variation
   */
  private static generateTriadicColor(baseHSL: { h: number; s: number; l: number }, settings: ColorHarmonySettings): string {
    const { triadicSettings, saturationRange, lightnessRange, hueVariance } = settings;
    
    const triadicPositions = [0, 120, 240];
    if (!triadicSettings.useEqualSpacing) {
      triadicPositions[1] += triadicSettings.rotationOffset;
      triadicPositions[2] += triadicSettings.rotationOffset;
    }
    
    const selectedPosition = triadicPositions[Math.floor(Math.random() * 3)];
    let hue = (baseHSL.h + selectedPosition) % 360;
    
    // Apply hue variance
    hue += (Math.random() - 0.5) * hueVariance;
    hue = (hue + 360) % 360;
    
    const saturation = saturationRange[0] + Math.random() * (saturationRange[1] - saturationRange[0]);
    const lightness = lightnessRange[0] + Math.random() * (lightnessRange[1] - lightnessRange[0]);
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  /**
   * Generate split-complementary color variation
   */
  private static generateSplitComplementaryColor(baseHSL: { h: number; s: number; l: number }, settings: ColorHarmonySettings): string {
    const { splitComplementarySettings, saturationRange, lightnessRange, hueVariance } = settings;
    
    const complementHue = (baseHSL.h + 180) % 360;
    const splitPositions = [
      baseHSL.h,
      (complementHue - splitComplementarySettings.splitAngle + 360) % 360,
      (complementHue + splitComplementarySettings.splitAngle) % 360
    ];
    
    let selectedHue = splitPositions[Math.floor(Math.random() * 3)];
    
    // Apply hue variance
    selectedHue += (Math.random() - 0.5) * hueVariance;
    selectedHue = (selectedHue + 360) % 360;
    
    const saturation = saturationRange[0] + Math.random() * (saturationRange[1] - saturationRange[0]);
    const lightness = lightnessRange[0] + Math.random() * (lightnessRange[1] - lightnessRange[0]);
    
    return `hsl(${selectedHue}, ${saturation}%, ${lightness}%)`;
  }

  /**
   * Generate tetradic color variation
   */
  private static generateTetradicColor(baseHSL: { h: number; s: number; l: number }, settings: ColorHarmonySettings): string {
    const { tetradicSettings, saturationRange, lightnessRange, hueVariance } = settings;
    
    let tetradicPositions: number[];
    
    if (tetradicSettings.squareHarmony) {
      // Square harmony: 90° spacing
      tetradicPositions = [0, 90, 180, 270];
    } else {
      // Rectangle harmony: adjustable ratio
      const angle1 = 180 * tetradicSettings.rectangleRatio;
      const angle2 = 180;
      const angle3 = 180 + angle1;
      tetradicPositions = [0, angle1, angle2, angle3];
    }
    
    const selectedPosition = tetradicPositions[Math.floor(Math.random() * 4)];
    let hue = (baseHSL.h + selectedPosition) % 360;
    
    // Apply hue variance
    hue += (Math.random() - 0.5) * hueVariance;
    hue = (hue + 360) % 360;
    
    const saturation = saturationRange[0] + Math.random() * (saturationRange[1] - saturationRange[0]);
    const lightness = lightnessRange[0] + Math.random() * (lightnessRange[1] - lightnessRange[0]);
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  /**
   * Convert HSL values to hex color
   */
  static hslToHex(h: number, s: number, l: number): string {
    h = h / 360;
    s = s / 100;
    l = l / 100;

    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    let r, g, b;

    if (s === 0) {
      r = g = b = l; // achromatic
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    const toHex = (c: number) => {
      const hex = Math.round(c * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  /**
   * Apply HSL shift to a color
   */
  static applyHSLShift(color: string, shift: HSLShift): string {
    if (!shift.enabled || color === 'none') return color;

    const hsl = this.hexToHSL(color);
    
    // Apply shifts with proper clamping
    let newH = hsl.h + shift.hue;
    while (newH < 0) newH += 360;
    while (newH >= 360) newH -= 360;
    
    const newS = Math.max(0, Math.min(100, hsl.s + shift.saturation));
    const newL = Math.max(0, Math.min(100, hsl.l + shift.lightness));

    return this.hslToHex(newH, newS, newL);
  }

  /**
   * Check if two colors are similar within tolerance
   */
  static colorsMatch(color1: string, color2: string, tolerance: number): boolean {
    if (color1 === color2) return true;
    if (color1 === 'none' || color2 === 'none') return false;

    const hsl1 = this.hexToHSL(color1);
    const hsl2 = this.hexToHSL(color2);

    // Calculate color distance in HSL space
    const hueDiff = Math.min(Math.abs(hsl1.h - hsl2.h), 360 - Math.abs(hsl1.h - hsl2.h));
    const satDiff = Math.abs(hsl1.s - hsl2.s);
    const lightDiff = Math.abs(hsl1.l - hsl2.l);

    // Normalize differences to 0-100 range
    const distance = Math.sqrt((hueDiff / 180) ** 2 + (satDiff / 100) ** 2 + (lightDiff / 100) ** 2) * 100;
    
    return distance <= tolerance;
  }

  /**
   * Apply color remapping to a color
   */
  static applyColorRemapping(color: string, remappings: ColorRemapping[]): string {
    if (color === 'none') return color;

    for (const mapping of remappings) {
      if (this.colorsMatch(color, mapping.sourceColor, mapping.tolerance)) {
        return mapping.targetColor;
      }
    }

    return color;
  }

  /**
   * Apply color manipulation to a shape
   */
  static applyColorManipulation(shape: Shape, manipulation: ColorManipulation): void {
    if (manipulation.mode === 'shift' && manipulation.hslShift) {
      if (manipulation.affectFill && shape.properties.fillColor !== 'none') {
        shape.properties.fillColor = this.applyHSLShift(shape.properties.fillColor, manipulation.hslShift);
      }
      if (manipulation.affectStroke && shape.properties.strokeColor !== 'none') {
        shape.properties.strokeColor = this.applyHSLShift(shape.properties.strokeColor, manipulation.hslShift);
      }
    } else if (manipulation.mode === 'remap' && manipulation.remappings) {
      if (manipulation.affectFill && shape.properties.fillColor !== 'none') {
        shape.properties.fillColor = this.applyColorRemapping(shape.properties.fillColor, manipulation.remappings);
      }
      if (manipulation.affectStroke && shape.properties.strokeColor !== 'none') {
        shape.properties.strokeColor = this.applyColorRemapping(shape.properties.strokeColor, manipulation.remappings);
      }
    }
  }

  /**
   * Apply color manipulation to multiple shapes
   */
  static applyToShapes(shapes: Shape[], manipulation: ColorManipulation): void {
    shapes.forEach(shape => this.applyColorManipulation(shape, manipulation));
  }

  /**
   * Get all unique colors from a set of shapes
   */
  static extractUniqueColors(shapes: Shape[]): { fills: string[]; strokes: string[] } {
    const fills = new Set<string>();
    const strokes = new Set<string>();

    shapes.forEach(shape => {
      if (shape.properties.fillColor !== 'none') {
        fills.add(shape.properties.fillColor);
      }
      if (shape.properties.strokeColor !== 'none') {
        strokes.add(shape.properties.strokeColor);
      }
    });

    return {
      fills: Array.from(fills),
      strokes: Array.from(strokes)
    };
  }

  /**
   * Create a color harmony based on HSL shifts
   */
  static createColorHarmony(baseColor: string, harmonyType: 'complementary' | 'triadic' | 'analogous' | 'split-complementary'): string[] {
    const hsl = this.hexToHSL(baseColor);
    const colors = [baseColor];

    switch (harmonyType) {
      case 'complementary':
        colors.push(this.hslToHex((hsl.h + 180) % 360, hsl.s, hsl.l));
        break;
      case 'triadic':
        colors.push(this.hslToHex((hsl.h + 120) % 360, hsl.s, hsl.l));
        colors.push(this.hslToHex((hsl.h + 240) % 360, hsl.s, hsl.l));
        break;
      case 'analogous':
        colors.push(this.hslToHex((hsl.h + 30) % 360, hsl.s, hsl.l));
        colors.push(this.hslToHex((hsl.h - 30 + 360) % 360, hsl.s, hsl.l));
        break;
      case 'split-complementary':
        colors.push(this.hslToHex((hsl.h + 150) % 360, hsl.s, hsl.l));
        colors.push(this.hslToHex((hsl.h + 210) % 360, hsl.s, hsl.l));
        break;
    }

    return colors;
  }
}