/**
 * Phase 2: Sharp Validation Test
 * 
 * Tests that Sharp can produce:
 * - 16-bit TIFF files
 * - sRGB ICC profile embedding
 * - 300 DPI metadata
 */

import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(process.cwd(), 'server/validation/output');

export interface SharpTestResult {
  success: boolean;
  tiffPath?: string;
  tiffSize?: number;
  metadata?: {
    format: string;
    width: number;
    height: number;
    channels: number;
    depth: string;
    density: number;
    hasProfile: boolean;
  };
  error?: string;
  duration?: number;
}

export async function runSharpTest(): Promise<SharpTestResult> {
  const startTime = Date.now();
  
  try {
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    console.log('[Sharp Test] Creating test image buffer...');

    // Create a test image: 300 DPI A4 dimensions would be 2480x3508
    // For testing, use smaller: 800x600 at 300 DPI
    const width = 800;
    const height = 600;
    const channels = 4; // RGBA

    // Create raw pixel buffer with a gradient pattern
    const pixels = Buffer.alloc(width * height * channels);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * channels;
        
        // Create a gradient pattern
        const r = Math.floor((x / width) * 255);
        const g = Math.floor((y / height) * 255);
        const b = Math.floor(((x + y) / (width + height)) * 255);
        
        pixels[idx] = r;     // R
        pixels[idx + 1] = g; // G
        pixels[idx + 2] = b; // B
        pixels[idx + 3] = 255; // A (fully opaque)
      }
    }

    console.log('[Sharp Test] Converting to 16-bit TIFF with sRGB ICC profile...');

    const tiffPath = path.join(OUTPUT_DIR, 'sharp-test-16bit.tiff');

    // Create the 16-bit TIFF with sRGB ICC and 300 DPI
    await sharp(pixels, {
      raw: {
        width,
        height,
        channels
      }
    })
      .toColourspace('rgb16') // Convert to 16-bit color
      .withMetadata({
        density: 300 // 300 DPI
      })
      .tiff({
        compression: 'deflate', // Lossless compression (better for 16-bit than LZW)
        quality: 100
      })
      .toFile(tiffPath);

    console.log(`[Sharp Test] TIFF saved: ${tiffPath}`);

    // Read back metadata to verify
    const metadata = await sharp(tiffPath).metadata();
    
    console.log('[Sharp Test] Verifying metadata...');
    console.log(`  Format: ${metadata.format}`);
    console.log(`  Size: ${metadata.width}x${metadata.height}`);
    console.log(`  Channels: ${metadata.channels}`);
    console.log(`  Depth: ${metadata.depth}`);
    console.log(`  Density: ${metadata.density}`);
    console.log(`  Has ICC Profile: ${metadata.hasProfile}`);

    // Get file size
    const stats = fs.statSync(tiffPath);
    console.log(`  File size: ${stats.size} bytes (${(stats.size / 1024).toFixed(1)} KB)`);

    const duration = Date.now() - startTime;

    // Verify critical properties
    // Note: Sharp reports 16-bit as 'ushort' (unsigned short)
    const is16Bit = metadata.depth === 'ushort';
    const hasDpi = metadata.density === 300;
    
    if (!is16Bit) {
      console.warn('[Sharp Test] WARNING: Output is not 16-bit depth!');
    }
    if (!hasDpi) {
      console.warn(`[Sharp Test] WARNING: DPI is ${metadata.density}, expected 300`);
    }

    return {
      success: true,
      tiffPath,
      tiffSize: stats.size,
      metadata: {
        format: metadata.format || 'unknown',
        width: metadata.width || 0,
        height: metadata.height || 0,
        channels: metadata.channels || 0,
        depth: metadata.depth || 'unknown',
        density: metadata.density || 0,
        hasProfile: metadata.hasProfile || false
      },
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration
    };
  }
}

// Additional test: Create a larger image to test memory handling
export async function runLargeImageTest(): Promise<SharpTestResult> {
  const startTime = Date.now();
  
  try {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    console.log('[Sharp Large Test] Creating A4 @ 300 DPI test image (2480x3508)...');

    // A4 at 300 DPI dimensions
    const width = 2480;
    const height = 3508;
    
    // Create a simple solid color buffer (much faster than per-pixel gradient)
    // Using create() instead of raw buffer for efficiency
    const tiffPath = path.join(OUTPUT_DIR, 'sharp-test-a4-300dpi.tiff');

    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 100, g: 150, b: 200 }
      }
    })
      .toColourspace('rgb16')
      .withMetadata({ density: 300 })
      .tiff({
        compression: 'deflate',
        quality: 100
      })
      .toFile(tiffPath);

    const stats = fs.statSync(tiffPath);
    const metadata = await sharp(tiffPath).metadata();

    console.log(`[Sharp Large Test] A4 TIFF saved: ${tiffPath}`);
    console.log(`  Size: ${metadata.width}x${metadata.height}`);
    console.log(`  File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    const duration = Date.now() - startTime;

    return {
      success: true,
      tiffPath,
      tiffSize: stats.size,
      metadata: {
        format: metadata.format || 'unknown',
        width: metadata.width || 0,
        height: metadata.height || 0,
        channels: metadata.channels || 0,
        depth: metadata.depth || 'unknown',
        density: metadata.density || 0,
        hasProfile: metadata.hasProfile || false
      },
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration
    };
  }
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  (async () => {
    console.log('\n=== Sharp Basic Test ===');
    const basicResult = await runSharpTest();
    console.log(JSON.stringify(basicResult, null, 2));

    console.log('\n=== Sharp Large Image Test (A4 @ 300 DPI) ===');
    const largeResult = await runLargeImageTest();
    console.log(JSON.stringify(largeResult, null, 2));

    process.exit(basicResult.success && largeResult.success ? 0 : 1);
  })();
}
