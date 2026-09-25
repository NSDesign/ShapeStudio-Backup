// Parity test to ensure server defaults match shared defaults exactly
// This prevents configuration drift between multiple implementations

import { DEFAULT_BATCH_EXPORT_SETTINGS } from './exportSchema';

// Simple validation function that can be called from server or tests
export function validateExportSettingsParity(serverDefaults: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  const shared = DEFAULT_BATCH_EXPORT_SETTINGS;

  // Check each property matches exactly
  const requiredProperties = [
    'format', 'quality', 'scale', 'useCustomSize', 'includeBackground', 
    'backgroundColor', 'useMargins', 'uniformMargins', 'marginTop', 
    'marginRight', 'marginBottom', 'marginLeft', 'batchExportCount', 
    'batchSaveProjectFiles', 'packageAsZip', 'includeAdornments', 
    'includeGrid', 'includeArtboardGeometry', 'includeTypeInName'
  ];

  for (const prop of requiredProperties) {
    if (serverDefaults[prop] !== shared[prop as keyof typeof shared]) {
      errors.push(`Mismatch for ${prop}: server=${serverDefaults[prop]}, shared=${shared[prop as keyof typeof shared]}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Quick assertion function for immediate validation
export function assertExportSettingsParity(serverDefaults: any): void {
  const result = validateExportSettingsParity(serverDefaults);
  if (!result.isValid) {
    throw new Error(`Export settings parity check failed:\n${result.errors.join('\n')}`);
  }
}