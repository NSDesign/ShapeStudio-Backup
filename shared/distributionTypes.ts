/**
 * Shared distribution types for client and server
 */

/**
 * Grid distribution result with grid context
 * Used to pass grid cell information through the distribution pipeline
 * for grid-aware position modulation
 */
export interface GridDistributionResult {
  shape: any;
  rowIndex: number;
  colIndex: number;
  generationIndex: number;  // Index within this generation (0 to shapeCount-1)
  batchIndex?: number;       // Index across entire batch (includes prior generations)
}

/**
 * Generation metadata for tracking shapes across multiple generations in batch exports
 */
export interface GenerationMetadata {
  generationId: string;      // Unique identifier for this generation
  generationIndex: number;   // Which generation this is (0, 1, 2... for repetitions)
  shapeCount: number;        // Number of shapes in this generation
  startIndex: number;        // Cumulative index where this generation starts in the batch
}
