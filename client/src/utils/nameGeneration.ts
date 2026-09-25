/**
 * Shared utility functions for generating unique names
 */

/**
 * Generates a unique name by appending a number to the base name
 * @param existingNames - Array of names that already exist
 * @param baseName - Base name to use (defaults to 'Set')
 * @returns A unique name like "Set 1", "Set 2", etc.
 */
export function generateUniqueSetName(existingNames: string[], baseName: string = 'Set'): string {
  const existingNamesSet = new Set(existingNames);
  
  // Find next available number
  let counter = 1;
  let candidateName = `${baseName} ${counter}`;
  
  while (existingNamesSet.has(candidateName)) {
    counter++;
    candidateName = `${baseName} ${counter}`;
  }
  
  return candidateName;
}