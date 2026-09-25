/**
 * Color Utilities for Server-side Shape Generation
 * Ported from client/src/lib/colorManipulation.ts and client/src/lib/hslColor.ts
 */

export interface HSL {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

export interface RGB {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

export interface ColorHarmonySettings {
  enabled: boolean;
  harmonyType: 'monochromatic' | 'analogous' | 'complementary' | 'triadic' | 'split-complementary' | 'tetradic';
  baseColor: string;
  hueVariance: number;
  saturationRange: [number, number];
  lightnessRange: [number, number];
  
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
  static hexToHSL(hex: string): HSL {
    hex = hex.replace('#', '');
    
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
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100)
    };
  }

  /**
   * Convert HSL to hex color
   */
  static hslToHex(hsl: HSL): string {
    const h = hsl.h / 360;
    const s = hsl.s / 100;
    const l = hsl.l / 100;
    
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    let r, g, b;
    
    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    
    const toHex = (c: number): string => {
      const hex = Math.round(c * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  /**
   * Apply HSL shift to a color
   * Used for echo color shift effects
   */
  static applyHSLShift(color: string, shift: { enabled: boolean; hue: number; saturation: number; lightness: number }): string {
    if (!shift.enabled || color === 'none') return color;

    const hsl = this.hexToHSL(color);
    
    // Apply shifts with proper clamping
    let newH = hsl.h + shift.hue;
    while (newH < 0) newH += 360;
    while (newH >= 360) newH -= 360;
    
    const newS = Math.max(0, Math.min(100, hsl.s + shift.saturation));
    const newL = Math.max(0, Math.min(100, hsl.l + shift.lightness));

    return this.hslToHex({ h: newH, s: newS, l: newL });
  }

  /**
   * Generate color using harmony settings
   */
  static generateHarmonyColor(settings: ColorHarmonySettings): string {
    if (!settings.enabled) {
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

  private static generateMonochromaticColor(baseHSL: HSL, settings: ColorHarmonySettings): string {
    const { monochromaticSettings, saturationRange, lightnessRange } = settings;
    
    let saturation = baseHSL.s;
    let lightness = baseHSL.l;
    
    if (monochromaticSettings.saturationSteps > 1) {
      const satStep = (saturationRange[1] - saturationRange[0]) / (monochromaticSettings.saturationSteps - 1);
      const stepIndex = Math.floor(Math.random() * monochromaticSettings.saturationSteps);
      saturation = saturationRange[0] + (stepIndex * satStep);
    } else {
      saturation = saturationRange[0] + Math.random() * (saturationRange[1] - saturationRange[0]);
    }
    
    if (monochromaticSettings.lightnessSteps > 1) {
      const lightStep = (lightnessRange[1] - lightnessRange[0]) / (monochromaticSettings.lightnessSteps - 1);
      const stepIndex = Math.floor(Math.random() * monochromaticSettings.lightnessSteps);
      lightness = lightnessRange[0] + (stepIndex * lightStep);
    } else {
      lightness = lightnessRange[0] + Math.random() * (lightnessRange[1] - lightnessRange[0]);
    }
    
    if (monochromaticSettings.includeNeutrals && Math.random() < 0.2) {
      saturation = Math.random() * 15;
    }
    
    return `hsl(${baseHSL.h}, ${saturation}%, ${lightness}%)`;
  }

  private static generateAnalogousColor(baseHSL: HSL, settings: ColorHarmonySettings): string {
    const { analogousSettings, saturationRange, lightnessRange, hueVariance } = settings;
    
    const analogousPositions = [
      0,
      analogousSettings.hueRange / 2,
      -analogousSettings.hueRange / 2
    ];
    
    const selectedPosition = analogousPositions[Math.floor(Math.random() * analogousPositions.length)];
    let hue = (baseHSL.h + selectedPosition + 360) % 360;
    
    hue += (Math.random() - 0.5) * Math.min(hueVariance, 10);
    hue = (hue + 360) % 360;
    
    const saturation = saturationRange[0] + Math.random() * (saturationRange[1] - saturationRange[0]);
    const lightness = lightnessRange[0] + Math.random() * (lightnessRange[1] - lightnessRange[0]);
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  private static generateComplementaryColor(baseHSL: HSL, settings: ColorHarmonySettings): string {
    const { complementarySettings, saturationRange, lightnessRange, hueVariance } = settings;
    
    let hue = baseHSL.h;
    
    if (Math.random() < 0.5) {
      hue = (baseHSL.h + 180) % 360;
      
      if (complementarySettings.includeNearComplements) {
        hue += (Math.random() - 0.5) * complementarySettings.complementOffset * 2;
      }
    }
    
    hue += (Math.random() - 0.5) * hueVariance;
    hue = (hue + 360) % 360;
    
    const saturation = saturationRange[0] + Math.random() * (saturationRange[1] - saturationRange[0]);
    const lightness = lightnessRange[0] + Math.random() * (lightnessRange[1] - lightnessRange[0]);
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  private static generateTriadicColor(baseHSL: HSL, settings: ColorHarmonySettings): string {
    const { triadicSettings, saturationRange, lightnessRange, hueVariance } = settings;
    
    const triadicPositions = [0, 120, 240];
    if (!triadicSettings.useEqualSpacing) {
      triadicPositions[1] += triadicSettings.rotationOffset;
      triadicPositions[2] += triadicSettings.rotationOffset;
    }
    
    const selectedPosition = triadicPositions[Math.floor(Math.random() * 3)];
    let hue = (baseHSL.h + selectedPosition) % 360;
    
    hue += (Math.random() - 0.5) * hueVariance;
    hue = (hue + 360) % 360;
    
    const saturation = saturationRange[0] + Math.random() * (saturationRange[1] - saturationRange[0]);
    const lightness = lightnessRange[0] + Math.random() * (lightnessRange[1] - lightnessRange[0]);
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  private static generateSplitComplementaryColor(baseHSL: HSL, settings: ColorHarmonySettings): string {
    const { splitComplementarySettings, saturationRange, lightnessRange, hueVariance } = settings;
    
    const complementHue = (baseHSL.h + 180) % 360;
    const splitPositions = [
      baseHSL.h,
      (complementHue - splitComplementarySettings.splitAngle + 360) % 360,
      (complementHue + splitComplementarySettings.splitAngle) % 360
    ];
    
    let selectedHue = splitPositions[Math.floor(Math.random() * 3)];
    
    selectedHue += (Math.random() - 0.5) * hueVariance;
    selectedHue = (selectedHue + 360) % 360;
    
    const saturation = saturationRange[0] + Math.random() * (saturationRange[1] - saturationRange[0]);
    const lightness = lightnessRange[0] + Math.random() * (lightnessRange[1] - lightnessRange[0]);
    
    return `hsl(${selectedHue}, ${saturation}%, ${lightness}%)`;
  }

  private static generateTetradicColor(baseHSL: HSL, settings: ColorHarmonySettings): string {
    const { tetradicSettings, saturationRange, lightnessRange, hueVariance } = settings;
    
    let tetradicPositions: number[];
    
    if (tetradicSettings.squareHarmony) {
      tetradicPositions = [0, 90, 180, 270];
    } else {
      const angle1 = 180 * tetradicSettings.rectangleRatio;
      const angle2 = 180;
      const angle3 = 180 + angle1;
      tetradicPositions = [0, angle1, angle2, angle3];
    }
    
    const selectedPosition = tetradicPositions[Math.floor(Math.random() * 4)];
    let hue = (baseHSL.h + selectedPosition) % 360;
    
    hue += (Math.random() - 0.5) * hueVariance;
    hue = (hue + 360) % 360;
    
    const saturation = saturationRange[0] + Math.random() * (saturationRange[1] - saturationRange[0]);
    const lightness = lightnessRange[0] + Math.random() * (lightnessRange[1] - lightnessRange[0]);
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }
}

/**
 * Calculate the shortest path between two hues on the color wheel
 */
function getHueDistance(h1: number, h2: number): { distance: number, direction: number } {
  const direct = h2 - h1;
  const wrap = direct > 0 ? direct - 360 : direct + 360;
  
  if (Math.abs(direct) <= Math.abs(wrap)) {
    return { distance: Math.abs(direct), direction: Math.sign(direct) };
  } else {
    return { distance: Math.abs(wrap), direction: Math.sign(wrap) };
  }
}

/**
 * Interpolate between two HSL colors using color wheel logic with optional flip
 */
export function interpolateHSLWithFlip(color1: string, color2: string, t: number, flip: boolean = false): string {
  const hsl1 = ColorUtils.hexToHSL(color1);
  const hsl2 = ColorUtils.hexToHSL(color2);
  
  let newHue;
  
  if (flip) {
    const hueInfo = getHueDistance(hsl1.h, hsl2.h);
    const longDistance = 360 - hueInfo.distance;
    const longDirection = -hueInfo.direction;
    newHue = hsl1.h + (longDirection * longDistance * t);
  } else {
    const hueInfo = getHueDistance(hsl1.h, hsl2.h);
    newHue = hsl1.h + (hueInfo.direction * hueInfo.distance * t);
  }
  
  if (newHue < 0) newHue += 360;
  if (newHue >= 360) newHue -= 360;
  
  const newHSL: HSL = {
    h: Math.round(newHue),
    s: Math.round(hsl1.s + (hsl2.s - hsl1.s) * t),
    l: Math.round(hsl1.l + (hsl2.l - hsl1.l) * t)
  };
  
  return ColorUtils.hslToHex(newHSL);
}

/**
 * Generate color based on mode (range, palette, define)
 */
export function generateColor(
  mode: 'range' | 'palette' | 'define' | 'series',
  range?: [string, string],
  palette?: string[],
  define?: string,
  shapeIndex?: number,
  rangeSettings?: {
    saturationRange?: [number, number];
    lightnessRange?: [number, number];
    flip?: boolean;
  }
): string {
  switch (mode) {
    case 'range':
      if (!range || range.length !== 2) return '#3b82f6';
      
      const flip = rangeSettings?.flip || false;
      
      if (rangeSettings?.saturationRange || rangeSettings?.lightnessRange) {
        const baseColor = interpolateHSLWithFlip(range[0], range[1], Math.random(), flip);
        const hsl = ColorUtils.hexToHSL(baseColor);
        
        if (rangeSettings.saturationRange) {
          const [minSat, maxSat] = rangeSettings.saturationRange;
          hsl.s = Math.round(minSat + Math.random() * (maxSat - minSat));
        }
        
        if (rangeSettings.lightnessRange) {
          const [minLight, maxLight] = rangeSettings.lightnessRange;
          hsl.l = Math.round(minLight + Math.random() * (maxLight - minLight));
        }
        
        return ColorUtils.hslToHex(hsl);
      } else {
        return interpolateHSLWithFlip(range[0], range[1], Math.random(), flip);
      }
      
    case 'palette':
      if (!palette || palette.length === 0) return '#3b82f6';
      if (shapeIndex !== undefined) {
        return palette[shapeIndex % palette.length];
      } else {
        return palette[Math.floor(Math.random() * palette.length)];
      }

    case 'series':
      if (!palette || palette.length === 0) return '#3b82f6';
      return palette[(shapeIndex ?? 0) % palette.length];

    case 'define':
      return define || '#3b82f6';
      
    default:
      return '#3b82f6';
  }
}

/**
 * Generate array of colors for gradients
 */
export function generateGradientColors(
  mode: 'range' | 'palette' | 'define',
  stopCount: number,
  range?: [string, string],
  palette?: string[],
  define?: string[],
  shapeIndex?: number,
  flip?: boolean
): string[] {
  switch (mode) {
    case 'range':
      if (!range || range.length !== 2) return ['#3b82f6', '#8b5cf6'];
      const colors: string[] = [];
      for (let i = 0; i < stopCount; i++) {
        const t = stopCount === 1 ? 0 : i / (stopCount - 1);
        colors.push(interpolateHSLWithFlip(range[0], range[1], t, flip || false));
      }
      return colors;
      
    case 'palette':
      if (!palette || palette.length === 0) return ['#3b82f6', '#8b5cf6'];
      const paletteColors: string[] = [];
      for (let i = 0; i < stopCount; i++) {
        // Always cycle from the start of the palette so stops follow swatch order.
        // (shapeIndex is intentionally not used here — stop ordering must match
        // the palette display regardless of which shape in the batch this is.)
        paletteColors.push(palette[i % palette.length]);
      }
      return paletteColors;
      
    case 'define':
      if (!define || define.length === 0) return ['#3b82f6', '#8b5cf6'];
      const defineColors: string[] = [];
      for (let i = 0; i < stopCount; i++) {
        defineColors.push(define[i % define.length]);
      }
      return defineColors;
      
    default:
      return ['#3b82f6', '#8b5cf6'];
  }
}
