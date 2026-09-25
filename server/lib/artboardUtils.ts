/**
 * Artboard utility functions for server-side shape generation
 */

interface ArtboardBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TranslateSettings {
  transformsArtboardAware: boolean;
  translateXRange?: [number, number];
  translateYRange?: [number, number];
}

/**
 * Get effective translate range for shape transforms based on artboard-aware setting
 * 
 * When transformsArtboardAware is enabled, returns artboard bounds.
 * Otherwise, returns the user's manual translate range settings.
 */
export function getEffectiveTranslateRange(
  axis: 'x' | 'y',
  settings: TranslateSettings,
  artboard: ArtboardBounds
): [number, number] {
  if (!settings.transformsArtboardAware) {
    // Use manual ranges when toggle is OFF
    return axis === 'x' 
      ? (settings.translateXRange || [-50, 50])
      : (settings.translateYRange || [-50, 50]);
  }
  
  // Use artboard bounds when toggle is ON
  return axis === 'x'
    ? [artboard.x, artboard.x + artboard.width]
    : [artboard.y, artboard.y + artboard.height];
}
