/**
 * Shared export memory estimation utilities.
 * Used by both client (TIFF preflight) and server (chunk-size throttling).
 */

const FORMAT_RAM_OVERHEAD: Record<string, number> = {
  tiff: 1.0,
  png:  1.0,
  jpeg: 1.0,
  webp: 1.0,
  avif: 1.0,
  bmp:  1.0,
  pdf:  1.2,
};

/**
 * Compression ratio: approximate on-disk file size relative to raw RGBA buffer.
 * These are conservative estimates for typical design artwork (geometric shapes).
 */
const FORMAT_FILE_SIZE_RATIO: Record<string, number> = {
  tiff: 0.30,
  png:  0.15,
  jpeg: 0.05,
  webp: 0.04,
  avif: 0.03,
  bmp:  1.00,
  pdf:  0.10,
};

const AVAILABLE_SERVER_MEMORY_MB = 1024;
const MAX_CONCURRENT_CEILING = 8;

const BASE_SEC_PER_IMAGE = 2.5;
const LARGE_IMAGE_THRESHOLD_MP = 12;

export type MemoryTier = 'low' | 'medium' | 'high' | 'critical';

/**
 * Estimate RAM required to hold one image in memory (uncompressed RGBA buffer).
 */
export function estimateImageMemoryMb(
  width: number,
  height: number,
  bitDepth: number = 8,
  format: string = 'png'
): number {
  const bytesPerChannel = bitDepth / 8;
  const bytesPerPixel = bytesPerChannel * 4; // RGBA
  const rawBytes = width * height * bytesPerPixel;
  const overhead = FORMAT_RAM_OVERHEAD[format] ?? 1.0;
  return (rawBytes * overhead) / (1024 * 1024);
}

/**
 * Estimate compressed file size on disk per image.
 */
export function estimateFileSizeMb(
  width: number,
  height: number,
  bitDepth: number = 8,
  format: string = 'png'
): number {
  const bytesPerChannel = bitDepth / 8;
  const bytesPerPixel = bytesPerChannel * 4; // RGBA
  const rawBytes = width * height * bytesPerPixel;
  const ratio = FORMAT_FILE_SIZE_RATIO[format] ?? 0.15;
  return (rawBytes * ratio) / (1024 * 1024);
}

/**
 * Derive a safe concurrent chunk size based on estimated per-image RAM footprint.
 * Since the server processes images sequentially (write-to-disk-then-free), this
 * is used for progress-chunk labelling and theoretical concurrency ceiling.
 * Minimum: 1. Maximum: maxCeiling (default 8).
 */
export function deriveChunkSize(
  memoryPerImageMb: number,
  maxCeiling: number = MAX_CONCURRENT_CEILING
): number {
  if (memoryPerImageMb <= 0) return maxCeiling;
  const safeCount = Math.floor(AVAILABLE_SERVER_MEMORY_MB / memoryPerImageMb);
  return Math.max(1, Math.min(maxCeiling, safeCount));
}

/**
 * Classify RAM requirement into a human-readable tier.
 */
export function getMemoryTier(memoryPerImageMb: number): MemoryTier {
  if (memoryPerImageMb < 100)  return 'low';
  if (memoryPerImageMb < 500)  return 'medium';
  if (memoryPerImageMb < 1024) return 'high';
  return 'critical';
}

const MEMORY_TIER_LABELS: Record<MemoryTier, string> = {
  low:      'Low — fast, minimal RAM',
  medium:   'Medium — server recommended for large batches',
  high:     'High — server export required',
  critical: 'Critical — server export required',
};

export function getMemoryTierLabel(tier: MemoryTier): string {
  return MEMORY_TIER_LABELS[tier];
}

/**
 * Estimate total processing time in seconds for a batch of images.
 */
export function estimateProcessingTimeSec(
  width: number,
  height: number,
  imageCount: number,
  is16Bit: boolean = false
): number {
  const mp = (width * height) / 1_000_000;
  const sizeFactor = Math.max(1, mp / LARGE_IMAGE_THRESHOLD_MP);
  const bitFactor = is16Bit ? 2.0 : 1.0;
  return Math.ceil(BASE_SEC_PER_IMAGE * sizeFactor * bitFactor * imageCount);
}

/**
 * Format a byte size in MB to a human-readable string.
 */
export function formatSizeMb(mb: number): string {
  if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Format seconds to a human-readable duration string.
 */
export function formatDurationSec(sec: number): string {
  if (sec < 60) return `~${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `~${m}m ${s}s` : `~${m}m`;
}
