// HSL Color utility functions for proper hue interpolation

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

/**
 * Convert hex color to HSL
 */
export function hexToHSL(hex: string): HSL {
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Convert to RGB first
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
export function hslToHex(hsl: HSL): string {
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
    r = g = b = l; // achromatic
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
 * Calculate the shortest path between two hues on the color wheel (for color harmony)
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
 * Linear hue interpolation - treats hue as a straight line from 0° to 360°
 * This gives full spectrum coverage as expected in color picker interfaces
 */
function interpolateLinearHue(h1: number, h2: number, t: number): number {
  // Simple linear interpolation between two hue values
  let result = h1 + (h2 - h1) * t;
  
  // Normalize to 0-360 range
  while (result < 0) result += 360;
  while (result >= 360) result -= 360;
  
  return result;
}

/**
 * Interpolate between two HSL colors using linear spectrum interpolation
 * This provides full spectrum coverage for color ranges (H=342 to H=50 = 292° span)
 */
export function interpolateHSL(color1: string, color2: string, t: number): string {
  const hsl1 = hexToHSL(color1);
  const hsl2 = hexToHSL(color2);
  
  // Use linear hue interpolation for spectrum coverage
  const newHue = interpolateLinearHue(hsl1.h, hsl2.h, t);
  
  // Linear interpolation for saturation and lightness
  const newHSL: HSL = {
    h: Math.round(newHue),
    s: Math.round(hsl1.s + (hsl2.s - hsl1.s) * t),
    l: Math.round(hsl1.l + (hsl2.l - hsl1.l) * t)
  };
  
  return hslToHex(newHSL);
}

/**
 * Interpolate between two HSL colors using color wheel logic (shortest path)
 * This is useful for color harmony applications where natural color relationships matter
 */
export function interpolateHSLColorWheel(color1: string, color2: string, t: number): string {
  const hsl1 = hexToHSL(color1);
  const hsl2 = hexToHSL(color2);
  
  // Handle hue interpolation with wraparound (shortest path)
  const hueInfo = getHueDistance(hsl1.h, hsl2.h);
  let newHue = hsl1.h + (hueInfo.direction * hueInfo.distance * t);
  
  // Normalize hue to 0-360
  if (newHue < 0) newHue += 360;
  if (newHue >= 360) newHue -= 360;
  
  // Linear interpolation for saturation and lightness
  const newHSL: HSL = {
    h: Math.round(newHue),
    s: Math.round(hsl1.s + (hsl2.s - hsl1.s) * t),
    l: Math.round(hsl1.l + (hsl2.l - hsl1.l) * t)
  };
  
  return hslToHex(newHSL);
}

/**
 * Convert hex color to RGB
 */
export function hexToRGB(hex: string): RGB {
  // Remove # if present
  hex = hex.replace('#', '');
  
  return {
    r: parseInt(hex.substr(0, 2), 16),
    g: parseInt(hex.substr(2, 2), 16),
    b: parseInt(hex.substr(4, 2), 16)
  };
}

/**
 * Convert RGB to hex color
 */
export function rgbToHex(rgb: RGB): string {
  const toHex = (c: number): string => {
    const hex = Math.round(c).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Interpolate between two colors using RGB linear interpolation
 * This matches the linear spectrum behavior of color pickers
 */
export function interpolateRGB(color1: string, color2: string, t: number): string {
  const rgb1 = hexToRGB(color1);
  const rgb2 = hexToRGB(color2);
  
  const newRGB: RGB = {
    r: rgb1.r + (rgb2.r - rgb1.r) * t,
    g: rgb1.g + (rgb2.g - rgb1.g) * t,
    b: rgb1.b + (rgb2.b - rgb1.b) * t
  };
  
  return rgbToHex(newRGB);
}

/**
 * Interpolate between two colors using HSL interpolation with optional flip
 * @param color1 - First color in hex format
 * @param color2 - Second color in hex format
 * @param t - Interpolation value between 0 and 1
 * @param flip - If true, goes the long way around the hue wheel for full spectrum; if false, uses shortest path
 */
export function interpolateHSLWithFlip(color1: string, color2: string, t: number, flip: boolean = false): string {
  const hsl1 = hexToHSL(color1);
  const hsl2 = hexToHSL(color2);
  
  let newHue;
  
  if (flip) {
    // Flip mode: go the long way around the hue wheel
    const hueInfo = getHueDistance(hsl1.h, hsl2.h);
    
    // To go the long way, we need to go in the opposite direction
    // The long way distance is 360 - shortest distance
    const longDistance = 360 - hueInfo.distance;
    const longDirection = -hueInfo.direction; // Opposite direction
    
    newHue = hsl1.h + (longDirection * longDistance * t);
  } else {
    // Normal mode: use shortest path (color wheel logic)
    const hueInfo = getHueDistance(hsl1.h, hsl2.h);
    newHue = hsl1.h + (hueInfo.direction * hueInfo.distance * t);
  }
  
  // Normalize hue to 0-360
  if (newHue < 0) newHue += 360;
  if (newHue >= 360) newHue -= 360;
  
  // Linear interpolation for saturation and lightness
  const newHSL: HSL = {
    h: Math.round(newHue),
    s: Math.round(hsl1.s + (hsl2.s - hsl1.s) * t),
    l: Math.round(hsl1.l + (hsl2.l - hsl1.l) * t)
  };
  
  return hslToHex(newHSL);
}

/**
 * @deprecated Use interpolateHSLWithFlip instead
 * Interpolate between two colors using full spectrum HSL interpolation
 * Always takes the long path around the hue wheel for maximum color variety
 */
export function interpolateHSLFullSpectrum(color1: string, color2: string, t: number): string {
  return interpolateHSLWithFlip(color1, color2, t, true);
}

/**
 * Generate color based on mode (range, palette, define, hsl)
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
      
      // If we have saturation/lightness ranges, use them to modify the interpolated color
      if (rangeSettings?.saturationRange || rangeSettings?.lightnessRange) {
        // First interpolate using HSL with flip setting
        const baseColor = interpolateHSLWithFlip(range[0], range[1], Math.random(), flip);
        const hsl = hexToHSL(baseColor);
        
        // Override saturation if range is provided
        if (rangeSettings.saturationRange) {
          const [minSat, maxSat] = rangeSettings.saturationRange;
          hsl.s = Math.round(minSat + Math.random() * (maxSat - minSat));
        }
        
        // Override lightness if range is provided
        if (rangeSettings.lightnessRange) {
          const [minLight, maxLight] = rangeSettings.lightnessRange;
          hsl.l = Math.round(minLight + Math.random() * (maxLight - minLight));
        }
        
        return hslToHex(hsl);
      } else {
        // Use HSL interpolation with flip setting
        return interpolateHSLWithFlip(range[0], range[1], Math.random(), flip);
      }
      
    case 'palette':
      if (!palette || palette.length === 0) return '#3b82f6';
      if (shapeIndex !== undefined) {
        // Cycle through palette based on shape index
        return palette[shapeIndex % palette.length];
      } else {
        // Random selection from palette
        return palette[Math.floor(Math.random() * palette.length)];
      }

    case 'series':
      if (!palette || palette.length === 0) return '#3b82f6';
      // Series always cycles in order by shape index
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
  mode: 'range' | 'palette' | 'define' | 'hsl',
  stopCount: number,
  range?: [string, string],
  palette?: string[],
  define?: string[],
  shapeIndex?: number,
  hslSettings?: {
    hslMode: 'range' | 'define';
    hueRange?: [number, number];
    saturationRange?: [number, number];
    lightnessRange?: [number, number];
    hueDefine?: number;
    saturationDefine?: number;
    lightnessDefine?: number;
  },
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
      // Use defined colors, repeat if needed
      const defineColors: string[] = [];
      for (let i = 0; i < stopCount; i++) {
        defineColors.push(define[i % define.length]);
      }
      return defineColors;
      
    case 'hsl':
      if (!hslSettings) return ['#3b82f6', '#8b5cf6'];
      
      const hslColors: string[] = [];
      
      for (let i = 0; i < stopCount; i++) {
        let h: number, s: number, l: number;
        
        if (hslSettings.hslMode === 'range') {
          // Generate random values within ranges for each stop
          const hueRange = hslSettings.hueRange || [0, 360];
          const satRange = hslSettings.saturationRange || [50, 100];
          const lightRange = hslSettings.lightnessRange || [30, 70];
          
          h = hueRange[0] + Math.random() * (hueRange[1] - hueRange[0]);
          s = satRange[0] + Math.random() * (satRange[1] - satRange[0]);
          l = lightRange[0] + Math.random() * (lightRange[1] - lightRange[0]);
        } else {
          // Use defined values for all stops
          h = hslSettings.hueDefine || 270;
          s = hslSettings.saturationDefine || 70;
          l = hslSettings.lightnessDefine || 60;
        }
        
        hslColors.push(hslToHex({ h: Math.round(h), s: Math.round(s), l: Math.round(l) }));
      }
      
      return hslColors;
      
    default:
      return ['#3b82f6', '#8b5cf6'];
  }
}