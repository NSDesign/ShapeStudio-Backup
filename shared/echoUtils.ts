/**
 * Shared Echo/Motion Trails Utilities
 * 
 * These functions calculate echo positions and effects for the Echo/Motion Trails feature.
 * Used by both client and server for consistent behavior (client/server parity).
 * 
 * Project A: Set-Level only (scope locked to 'set', driver is setRepIndex)
 */

import type { 
  EchoSpreadConfig, 
  EchoOpacityConfig, 
  EchoBlurConfig, 
  EchoScaleConfig,
  EchoRotationConfig,
  EchoColorShiftConfig,
  EchoJitterConfig,
  EchoPerEffectJitterConfig,
  EchoFixedVectorConfig,
  EchoAutoMotionConfig,
  EchoAbsolutePositionConfig,
  EchoApplyToConfig
} from './schema';

// Default per-effect jitter config (safe fallback)
const DEFAULT_PER_EFFECT_JITTER: EchoPerEffectJitterConfig = {
  enabled: false,
  mode: 'fixed',
  fixedAmount: 0,
  rangeMin: 0,
  rangeMax: 0
};

// Default rotation config (safe fallback for legacy configs)
const DEFAULT_ROTATION_CONFIG: EchoRotationConfig = {
  enabled: false,
  startRotation: 0,
  rotationDelta: 0,
  minRotation: -360,
  maxRotation: 360,
  jitter: { enabled: false, mode: 'fixed', fixedAmount: 0, rangeMin: 0, rangeMax: 0 }
};

/**
 * Get per-effect jitter config with safe defaults
 * Handles legacy configs that don't have the jitter property
 * 
 * Legacy migration: Old configs had a single 'range' property representing ±range jitter.
 * This is converted to 'range' mode with rangeMin: -legacyRange, rangeMax: +legacyRange
 * to maintain the symmetric ±range behavior in the new system.
 */
function getPerEffectJitter(jitter: EchoPerEffectJitterConfig | undefined): EchoPerEffectJitterConfig {
  if (!jitter) {
    return DEFAULT_PER_EFFECT_JITTER;
  }
  
  // Check for legacy config (has 'range' but not 'mode')
  const legacyJitter = jitter as any;
  if (legacyJitter.range !== undefined && jitter.mode === undefined) {
    // Convert legacy config to 'range' mode with symmetric ±range values
    // Legacy behavior was: (random() * 2 - 1) * range → uniform from -range to +range
    // New range mode with negative rangeMin achieves the same symmetric distribution
    const legacyRange = legacyJitter.range ?? 0;
    return {
      enabled: jitter.enabled ?? false,
      mode: 'range',
      fixedAmount: 0,
      rangeMin: -legacyRange,  // Symmetric negative bound
      rangeMax: legacyRange     // Symmetric positive bound
    };
  }
  
  // Return with safe defaults for any missing properties
  return {
    enabled: jitter.enabled ?? false,
    mode: jitter.mode ?? 'fixed',
    fixedAmount: jitter.fixedAmount ?? 0,
    rangeMin: jitter.rangeMin ?? 0,
    rangeMax: jitter.rangeMax ?? 0
  };
}

/**
 * Get rotation config with safe defaults
 * Handles legacy configs (v1) that don't have the rotation object
 */
function getRotationConfig(rotation: EchoRotationConfig | undefined, legacyRotationDelta?: number): EchoRotationConfig {
  if (rotation) {
    return {
      ...rotation,
      jitter: getPerEffectJitter(rotation.jitter)
    };
  }
  
  // Handle v1 legacy config with rotationDelta as a direct property
  if (legacyRotationDelta !== undefined && legacyRotationDelta !== 0) {
    return {
      enabled: true,
      startRotation: 0,
      rotationDelta: legacyRotationDelta,
      minRotation: -360,
      maxRotation: 360,
      jitter: DEFAULT_PER_EFFECT_JITTER
    };
  }
  
  return DEFAULT_ROTATION_CONFIG;
}

/**
 * Result of echo transform calculation for a single echo instance
 */
export interface EchoTransform {
  echoIndex: number;        // 0-based index of this echo
  offsetX: number;          // X offset from original shape position
  offsetY: number;          // Y offset from original shape position
  opacity: number;          // 0-1 opacity value
  blur: number;             // Blur radius in pixels
  scale: number;            // Scale factor (1.0 = 100%)
  rotation: number;         // Additional rotation in degrees
  // Color shift values (Project B)
  hueShift: number;         // Hue shift in degrees (additive)
  saturationShift: number;  // Saturation shift percentage (additive)
  lightnessShift: number;   // Lightness shift percentage (additive)
}

/**
 * Context for auto-motion mode - position deltas between set repetitions
 */
export interface AutoMotionContext {
  prevX?: number;           // Previous set repetition X position
  prevY?: number;           // Previous set repetition Y position
  currentX: number;         // Current set repetition X position
  currentY: number;         // Current set repetition Y position
}

/**
 * Context for absolute-position mode - target coordinates and artboard dimensions
 */
export interface AbsolutePositionContext {
  shapeX: number;           // Current shape X position (canvas coordinates)
  shapeY: number;           // Current shape Y position (canvas coordinates)
  artboardX: number;        // Artboard X position on canvas
  artboardY: number;        // Artboard Y position on canvas
  artboardWidth: number;    // Artboard width
  artboardHeight: number;   // Artboard height
}

/**
 * Seeded random number generator for deterministic jitter
 * Uses a simple LCG (Linear Congruential Generator)
 */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/**
 * Check if a shape should receive echo effects based on ApplyTo filter config
 *
 * @param shapeIndex - Index of the shape in the set (0-based)
 * @param shapeType - Type of the shape (e.g., 'circle', 'square')
 * @param applyTo - ApplyTo filter configuration
 * @param seed - Optional seed for deterministic probability (use shape index for client/server parity)
 * @returns true if the shape should receive echoes, false otherwise
 */
export function shouldApplyEchoToShape(
  shapeIndex: number,
  shapeType: string,
  applyTo?: EchoApplyToConfig,
  seed?: number,
): boolean {
  // If applyTo is not defined or not enabled, apply to all shapes
  if (!applyTo || !applyTo.enabled) {
    return true;
  }
  
  // Check shape type filter
  if (applyTo.shapeTypes && applyTo.shapeTypes.length > 0) {
    if (!applyTo.shapeTypes.includes(shapeType)) {
      return false;
    }
  }
  
  // Check specific indices filter
  if (applyTo.indices && applyTo.indices.length > 0) {
    if (!applyTo.indices.includes(shapeIndex)) {
      return false;
    }
  }
  
  // Check selector mode
  const selector = applyTo.selector ?? 'all';
  switch (selector) {
    case 'all':
      // No filtering by index
      break;
    case 'even':
      if (shapeIndex % 2 !== 0) {
        return false;
      }
      break;
    case 'odd':
      if (shapeIndex % 2 === 0) {
        return false;
      }
      break;
    case 'step':
      const step = applyTo.indexStep ?? 2;
      if (shapeIndex % step !== 0) {
        return false;
      }
      break;
  }
  
  // Check probability filter — uses seeded random when seed is provided for client/server parity
  const probability = applyTo.probability ?? 100;
  if (probability < 100) {
    let randomValue: number;
    if (seed !== undefined) {
      randomValue = seededRandom(seed)() * 100;
    } else {
      randomValue = Math.random() * 100;
    }
    if (randomValue > probability) {
      return false;
    }
  }
  
  return true;
}

/**
 * Calculate echo direction angle based on direction mode
 * 
 * @param config - Echo spread configuration
 * @param autoMotionContext - Optional context for auto-motion mode (set position deltas)
 * @param absolutePositionContext - Optional context for absolute-position mode (shape and artboard)
 * @returns Direction angle in degrees (0-360)
 */
export function calculateEchoDirection(
  config: EchoSpreadConfig,
  autoMotionContext?: AutoMotionContext,
  absolutePositionContext?: AbsolutePositionContext
): number {
  if (config.directionMode === 'fixed-vector') {
    return config.fixedVector.angle;
  }
  
  // Absolute-position mode: direction toward or away from target
  if (config.directionMode === 'absolute-position' && absolutePositionContext) {
    const absConfig = config.absolutePosition ?? {
      targetX: 0,
      targetY: 0,
      artboardTarget: 'center',
      mode: 'converge'
    };
    
    // Determine target coordinates in canvas space based on artboardTarget
    let targetX: number;
    let targetY: number;
    
    const artX = absolutePositionContext.artboardX;
    const artY = absolutePositionContext.artboardY;
    const artW = absolutePositionContext.artboardWidth;
    const artH = absolutePositionContext.artboardHeight;
    
    // Handle legacy configs that still have useArtboardCenter
    const artboardTarget = (absConfig as any).useArtboardCenter === true 
      ? 'center' 
      : (absConfig.artboardTarget ?? 'center');
    
    switch (artboardTarget) {
      case 'center':
        targetX = artX + artW / 2;
        targetY = artY + artH / 2;
        break;
      case 'top-left':
        targetX = artX;
        targetY = artY;
        break;
      case 'top-right':
        targetX = artX + artW;
        targetY = artY;
        break;
      case 'bottom-right':
        targetX = artX + artW;
        targetY = artY + artH;
        break;
      case 'bottom-left':
        targetX = artX;
        targetY = artY + artH;
        break;
      case 'custom':
      default:
        // Custom coordinates are artboard-relative, convert to canvas space
        targetX = artX + absConfig.targetX;
        targetY = artY + absConfig.targetY;
        break;
    }
    
    // Calculate direction from shape to target (both in canvas coordinates)
    const dx = targetX - absolutePositionContext.shapeX;
    const dy = targetY - absolutePositionContext.shapeY;
    
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    // Diverge mode: reverse direction (away from target)
    if (absConfig.mode === 'diverge') {
      angle = (angle + 180) % 360;
    }
    
    if (angle < 0) angle += 360;
    return angle;
  }
  
  // Auto-motion mode: derive direction from position deltas
  if (autoMotionContext && 
      autoMotionContext.prevX !== undefined && 
      autoMotionContext.prevY !== undefined) {
    const deltaX = autoMotionContext.currentX - autoMotionContext.prevX;
    const deltaY = autoMotionContext.currentY - autoMotionContext.prevY;
    
    // If there's meaningful motion, calculate angle from it
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (distance > 0.1) {
      // Calculate angle and add 180° to trail behind the motion
      let angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
      angle = (angle + 180) % 360; // Reverse direction (trail behind)
      if (angle < 0) angle += 360;
      return angle;
    }
  }
  
  // Fallback angle when no motion detected
  return config.autoMotion.fallbackAngle;
}

/**
 * Calculate distance between echo copies based on direction mode
 * 
 * @param config - Echo spread configuration
 * @param autoMotionContext - Optional context for auto-motion mode
 * @param absolutePositionContext - Optional context for absolute-position mode
 * @returns Distance in pixels between each echo
 */
export function calculateEchoDistance(
  config: EchoSpreadConfig,
  autoMotionContext?: AutoMotionContext,
  absolutePositionContext?: AbsolutePositionContext
): number {
  if (config.directionMode === 'fixed-vector') {
    return config.fixedVector.distance;
  }
  
  // Absolute-position mode: use fixed distance toward target
  if (config.directionMode === 'absolute-position') {
    // Use fixed vector distance as the per-echo distance
    // This gives consistent spacing regardless of shape position
    return config.fixedVector.distance;
  }
  
  // Auto-motion mode: derive distance from position deltas
  if (autoMotionContext && 
      autoMotionContext.prevX !== undefined && 
      autoMotionContext.prevY !== undefined) {
    const deltaX = autoMotionContext.currentX - autoMotionContext.prevX;
    const deltaY = autoMotionContext.currentY - autoMotionContext.prevY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    return distance * config.autoMotion.distanceMultiplier;
  }
  
  // Fallback to a reasonable default distance
  return 20 * config.autoMotion.distanceMultiplier;
}

/**
 * Calculate opacity for a specific echo index
 * 
 * @param opacityConfig - Opacity configuration
 * @param echoIndex - 0-based echo index (0 = first echo, closest to original)
 * @param totalEchoes - Total number of echo copies
 * @returns Opacity value 0-1
 */
export function calculateEchoOpacity(
  opacityConfig: EchoOpacityConfig,
  echoIndex: number,
  totalEchoes: number
): number {
  const startOpacity = opacityConfig.startOpacity / 100;
  const falloffRate = opacityConfig.falloffRate / 100;
  const minOpacity = opacityConfig.minOpacity / 100;
  
  // Calculate falloff: each echo loses (falloffRate) opacity
  const falloff = startOpacity * (1 - Math.pow(1 - falloffRate, echoIndex + 1));
  const opacity = Math.max(startOpacity - falloff, minOpacity);
  
  return Math.max(0, Math.min(1, opacity));
}

/**
 * Calculate blur for a specific echo index
 * 
 * @param blurConfig - Blur configuration
 * @param echoIndex - 0-based echo index
 * @returns Blur radius in pixels
 */
export function calculateEchoBlur(
  blurConfig: EchoBlurConfig,
  echoIndex: number
): number {
  if (!blurConfig.enabled) {
    return 0;
  }
  
  const blur = blurConfig.startBlur + (blurConfig.blurDelta * (echoIndex + 1));
  return Math.max(0, Math.min(blurConfig.maxBlur, blur));
}

/**
 * Calculate scale for a specific echo index
 * 
 * @param scaleConfig - Scale configuration
 * @param echoIndex - 0-based echo index
 * @returns Scale factor (1.0 = 100%)
 */
export function calculateEchoScale(
  scaleConfig: EchoScaleConfig,
  echoIndex: number
): number {
  if (!scaleConfig.enabled) {
    return 1.0;
  }
  
  const scalePercent = scaleConfig.startScale + (scaleConfig.scaleDelta * (echoIndex + 1));
  const clampedPercent = Math.max(
    scaleConfig.minScale,
    Math.min(scaleConfig.maxScale, scalePercent)
  );
  
  return clampedPercent / 100;
}

/**
 * Calculate rotation for a specific echo index
 * Now uses the full rotation config with start, delta, min, and max values
 * 
 * @param rotationConfig - Rotation configuration
 * @param echoIndex - 0-based echo index
 * @returns Total rotation in degrees
 */
export function calculateEchoRotation(
  rotationConfig: EchoRotationConfig,
  echoIndex: number
): number {
  if (!rotationConfig.enabled) {
    return 0;
  }
  
  const rotation = rotationConfig.startRotation + (rotationConfig.rotationDelta * (echoIndex + 1));
  return Math.max(
    rotationConfig.minRotation,
    Math.min(rotationConfig.maxRotation, rotation)
  );
}

// Default color shift config (safe fallback for legacy configs)
const DEFAULT_COLOR_SHIFT_CONFIG: EchoColorShiftConfig = {
  enabled: false,
  hueDelta: 0,
  saturationDelta: 0,
  lightnessDelta: 0,
  jitter: { enabled: false, mode: 'fixed', fixedAmount: 0, rangeMin: 0, rangeMax: 0 }
};

/**
 * Calculate color shift values for a specific echo index
 * Returns hue, saturation, and lightness shift values
 * 
 * @param colorShiftConfig - Color shift configuration
 * @param echoIndex - 0-based echo index
 * @returns Object with hueShift, saturationShift, lightnessShift values
 */
export function calculateEchoColorShift(
  colorShiftConfig: EchoColorShiftConfig | undefined,
  echoIndex: number
): { hueShift: number; saturationShift: number; lightnessShift: number } {
  const config = colorShiftConfig ?? DEFAULT_COLOR_SHIFT_CONFIG;
  
  if (!config.enabled) {
    return { hueShift: 0, saturationShift: 0, lightnessShift: 0 };
  }
  
  // Each echo accumulates delta values
  const hueShift = config.hueDelta * (echoIndex + 1);
  const saturationShift = config.saturationDelta * (echoIndex + 1);
  const lightnessShift = config.lightnessDelta * (echoIndex + 1);
  
  return { hueShift, saturationShift, lightnessShift };
}

/**
 * Apply per-effect jitter to a calculated effect value
 * Uses deterministic seeded random for reproducibility
 * Supports both 'fixed' mode (constant jitter) and 'range' mode (random between min/max)
 * 
 * @param effectJitter - Per-effect jitter config
 * @param baseValue - The calculated base value
 * @param seed - Random seed for deterministic jitter
 * @returns Jittered value
 */
export function applyPerEffectJitter(
  effectJitter: EchoPerEffectJitterConfig,
  baseValue: number,
  seed: number
): number {
  if (!effectJitter.enabled) {
    return baseValue;
  }
  
  const random = seededRandom(seed);
  
  // Handle legacy configs that might only have 'range' property (backward compatibility)
  const legacyRange = (effectJitter as any).range;
  if (legacyRange !== undefined && effectJitter.mode === undefined) {
    // Legacy mode: use range as ±amount
    if (legacyRange === 0) return baseValue;
    const jitterAmount = (random() * 2 - 1) * legacyRange;
    return baseValue + jitterAmount;
  }
  
  const mode = effectJitter.mode ?? 'fixed';
  
  if (mode === 'fixed') {
    // Fixed mode: apply constant jitter amount with random sign
    const fixedAmount = effectJitter.fixedAmount ?? 0;
    if (fixedAmount === 0) return baseValue;
    const sign = random() > 0.5 ? 1 : -1;
    return baseValue + (sign * fixedAmount);
  } else {
    // Range mode: randomize between min and max (direct interpolation, no sign manipulation)
    // This supports both symmetric ranges (e.g., -10 to +10 from legacy) and asymmetric ranges
    const rangeMin = effectJitter.rangeMin ?? 0;
    const rangeMax = effectJitter.rangeMax ?? 0;
    if (rangeMin === 0 && rangeMax === 0) return baseValue;
    
    // Direct interpolation: pick a random value between rangeMin and rangeMax
    const jitterAmount = rangeMin + (random() * (rangeMax - rangeMin));
    return baseValue + jitterAmount;
  }
}

/**
 * Apply jitter to distance and angle
 * Uses deterministic seeded random for reproducibility
 * 
 * @param jitterConfig - Jitter configuration
 * @param baseAngle - Base direction angle in degrees
 * @param baseDistance - Base distance in pixels
 * @param seed - Random seed for deterministic jitter
 * @returns Object with jittered angle and distance
 */
export function applyJitter(
  jitterConfig: EchoJitterConfig,
  baseAngle: number,
  baseDistance: number,
  seed: number
): { angle: number; distance: number } {
  if (!jitterConfig.enabled || (jitterConfig.distanceRange === 0 && jitterConfig.angleRange === 0)) {
    return { angle: baseAngle, distance: baseDistance };
  }
  
  const random = seededRandom(seed);
  
  // Apply distance jitter: ±distanceRange
  const distanceJitter = (random() * 2 - 1) * jitterConfig.distanceRange;
  const jitteredDistance = Math.max(0, baseDistance + distanceJitter);
  
  // Apply angle jitter: ±angleRange
  const angleJitter = (random() * 2 - 1) * jitterConfig.angleRange;
  let jitteredAngle = baseAngle + angleJitter;
  
  // Normalize angle to 0-360
  while (jitteredAngle < 0) jitteredAngle += 360;
  while (jitteredAngle >= 360) jitteredAngle -= 360;
  
  return { angle: jitteredAngle, distance: jitteredDistance };
}

/**
 * Calculate all echo transforms for a set repetition or shape
 * 
 * @param config - Echo spread configuration
 * @param setRepIndex - Set repetition index or shape index (0-based), used for seeding
 * @param autoMotionContext - Optional context for auto-motion direction detection
 * @param absolutePositionContext - Optional context for absolute-position mode
 * @returns Array of echo transforms, one per echo copy
 */
export function calculateEchoTransforms(
  config: EchoSpreadConfig,
  setRepIndex: number,
  autoMotionContext?: AutoMotionContext,
  absolutePositionContext?: AbsolutePositionContext
): EchoTransform[] {
  if (!config.enabled || config.echoCount <= 0) {
    return [];
  }
  
  const echoes: EchoTransform[] = [];
  
  // Calculate base direction and distance
  const baseAngle = calculateEchoDirection(config, autoMotionContext, absolutePositionContext);
  const baseDistance = calculateEchoDistance(config, autoMotionContext, absolutePositionContext);
  
  for (let i = 0; i < config.echoCount; i++) {
    // Create deterministic seeds based on set rep index, echo index, and effect type
    const baseSeed = setRepIndex * 1000 + i * 17;
    const opacitySeed = baseSeed + 1;
    const blurSeed = baseSeed + 2;
    const scaleSeed = baseSeed + 3;
    const rotationSeed = baseSeed + 4;
    
    // Apply position jitter to angle and distance
    const { angle, distance } = applyJitter(
      config.jitter,
      baseAngle,
      baseDistance,
      baseSeed
    );
    
    // Calculate cumulative position offset for this echo
    // Each echo is positioned further away: echo 0 at 1×distance, echo 1 at 2×distance, etc.
    const cumulativeDistance = distance * (i + 1);
    const angleRad = angle * (Math.PI / 180);
    const offsetX = Math.cos(angleRad) * cumulativeDistance;
    const offsetY = Math.sin(angleRad) * cumulativeDistance;
    
    // Calculate per-echo effects with per-effect jitter (using safe defaults for legacy configs)
    const opacityJitter = getPerEffectJitter(config.opacity?.jitter);
    let opacity = calculateEchoOpacity(config.opacity, i, config.echoCount);
    opacity = Math.max(0, Math.min(1, applyPerEffectJitter(opacityJitter, opacity, opacitySeed)));
    
    const blurJitter = getPerEffectJitter(config.blur?.jitter);
    let blur = calculateEchoBlur(config.blur, i);
    blur = Math.max(0, applyPerEffectJitter(blurJitter, blur, blurSeed));
    
    const scaleJitter = getPerEffectJitter(config.scale?.jitter);
    let scale = calculateEchoScale(config.scale, i);
    const scaleJitterAmount = applyPerEffectJitter(scaleJitter, 0, scaleSeed) / 100; // Convert percentage jitter to scale factor
    scale = Math.max(0.01, scale + scaleJitterAmount);
    
    // Handle rotation with legacy support (v1 had rotationDelta as direct property)
    const rotationConfig = getRotationConfig(config.rotation, (config as any).rotationDelta);
    let rotation = calculateEchoRotation(rotationConfig, i);
    rotation = applyPerEffectJitter(rotationConfig.jitter, rotation, rotationSeed);
    
    // Calculate color shift values
    const colorShiftSeed = baseSeed + 5;
    const colorShift = calculateEchoColorShift(config.colorShift, i);
    const colorShiftJitter = getPerEffectJitter(config.colorShift?.jitter);
    const hueShift = applyPerEffectJitter(colorShiftJitter, colorShift.hueShift, colorShiftSeed);
    
    echoes.push({
      echoIndex: i,
      offsetX,
      offsetY,
      opacity,
      blur,
      scale,
      rotation,
      hueShift,
      saturationShift: colorShift.saturationShift,
      lightnessShift: colorShift.lightnessShift
    });
  }
  
  return echoes;
}

/**
 * Check if echo rendering is enabled and should be applied
 */
export function isEchoEnabled(config: EchoSpreadConfig | undefined): boolean {
  return config?.enabled === true && config.echoCount > 0;
}

/**
 * Get total shape count including echoes
 * Useful for performance estimation
 */
export function getTotalShapeCountWithEchoes(
  baseShapeCount: number,
  config: EchoSpreadConfig | undefined
): number {
  if (!isEchoEnabled(config)) {
    return baseShapeCount;
  }
  
  // Each base shape generates echoCount echo copies
  return baseShapeCount + (baseShapeCount * config!.echoCount);
}
