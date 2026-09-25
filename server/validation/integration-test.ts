/**
 * Phase 3: Integration Validation Test
 * 
 * Tests the full pipeline:
 * 1. Launch headless Chrome
 * 2. Render a canvas with shapes (simulating our shape editor)
 * 3. Export canvas to PNG buffer
 * 4. Pipe through Sharp to 16-bit TIFF with sRGB ICC
 * 5. Verify output quality
 */

import puppeteer, { Browser } from 'puppeteer-core';
import sharp from 'sharp';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(process.cwd(), 'server/validation/output');

export interface IntegrationTestResult {
  success: boolean;
  canvasSize?: { width: number; height: number };
  pngBufferSize?: number;
  tiffPath?: string;
  tiffSize?: number;
  tiffMetadata?: {
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
  steps?: string[];
}

export async function runIntegrationTest(options?: {
  width?: number;
  height?: number;
  dpi?: number;
}): Promise<IntegrationTestResult> {
  const startTime = Date.now();
  const steps: string[] = [];
  
  // Default to a reasonably large canvas (simulating print-quality export)
  const canvasWidth = options?.width || 2000;
  const canvasHeight = options?.height || 1500;
  const targetDpi = options?.dpi || 300;
  
  let browser: Browser | null = null;
  
  try {
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Step 1: Find Chromium
    steps.push('Finding Chromium executable...');
    let chromiumPath: string;
    try {
      chromiumPath = execSync('which chromium').toString().trim();
    } catch {
      chromiumPath = execSync('which chromium-browser').toString().trim();
    }
    steps.push(`Found Chromium: ${chromiumPath}`);

    // Step 2: Launch headless Chrome
    steps.push('Launching headless Chrome...');
    browser = await puppeteer.launch({
      headless: true,
      executablePath: chromiumPath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    steps.push('Browser launched');

    // Step 3: Create page and set viewport
    const page = await browser.newPage();
    // Set viewport larger than canvas to ensure it fits
    await page.setViewport({ 
      width: Math.max(canvasWidth + 100, 1200), 
      height: Math.max(canvasHeight + 100, 800) 
    });
    steps.push('Page created');

    // Step 4: Load HTML with canvas that draws shapes (simulating shape editor)
    steps.push(`Creating canvas ${canvasWidth}x${canvasHeight}...`);
    
    const testHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Integration Test</title>
        <style>
          body { margin: 0; padding: 20px; background: #1a1a1a; }
          canvas { background: white; }
        </style>
      </head>
      <body>
        <canvas id="exportCanvas" width="${canvasWidth}" height="${canvasHeight}"></canvas>
        <script>
          const canvas = document.getElementById('exportCanvas');
          const ctx = canvas.getContext('2d');
          
          // Fill background
          ctx.fillStyle = '#f0f0f0';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Draw various shapes to simulate shape editor output
          
          // 1. Gradient rectangle
          const gradient = ctx.createLinearGradient(100, 100, 500, 400);
          gradient.addColorStop(0, '#ff6b6b');
          gradient.addColorStop(0.5, '#feca57');
          gradient.addColorStop(1, '#48dbfb');
          ctx.fillStyle = gradient;
          ctx.fillRect(100, 100, 400, 300);
          
          // 2. Circles with different fills
          ctx.fillStyle = 'rgba(46, 213, 115, 0.8)';
          ctx.beginPath();
          ctx.arc(800, 300, 150, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.strokeStyle = '#5352ed';
          ctx.lineWidth = 8;
          ctx.beginPath();
          ctx.arc(1200, 400, 120, 0, Math.PI * 2);
          ctx.stroke();
          
          // 3. Polygon (star shape)
          ctx.fillStyle = '#ff9f43';
          ctx.beginPath();
          const cx = 400, cy = 700, spikes = 5, outerR = 100, innerR = 50;
          for (let i = 0; i < spikes * 2; i++) {
            const r = i % 2 === 0 ? outerR : innerR;
            const angle = (i * Math.PI / spikes) - Math.PI / 2;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
          
          // 4. Bezier curves
          ctx.strokeStyle = '#1dd1a1';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(700, 600);
          ctx.bezierCurveTo(900, 500, 1100, 800, 1300, 650);
          ctx.stroke();
          
          // 5. Text
          ctx.fillStyle = '#2f3542';
          ctx.font = 'bold 48px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('Shape Editor Export Test', canvas.width / 2, canvas.height - 100);
          
          ctx.font = '24px Arial';
          ctx.fillStyle = '#747d8c';
          ctx.fillText('Testing canvas → PNG → 16-bit TIFF pipeline', canvas.width / 2, canvas.height - 50);
          
          // 6. Fine gradients (to test 16-bit color depth)
          for (let i = 0; i < 256; i++) {
            ctx.fillStyle = \`rgb(\${i}, \${i}, \${i})\`;
            ctx.fillRect(1500 + (i * 2), 100, 2, 200);
          }
          
          console.log('Canvas rendering complete');
        </script>
      </body>
      </html>
    `;

    await page.setContent(testHtml, { waitUntil: 'networkidle0' });
    steps.push('Canvas rendered with shapes');

    // Step 5: Export canvas to PNG buffer
    steps.push('Exporting canvas to PNG buffer...');
    
    const pngBase64 = await page.evaluate(() => {
      const canvas = document.getElementById('exportCanvas') as HTMLCanvasElement;
      return canvas.toDataURL('image/png').split(',')[1];
    });
    
    const pngBuffer = Buffer.from(pngBase64, 'base64');
    steps.push(`PNG buffer created: ${pngBuffer.length} bytes (${(pngBuffer.length / 1024).toFixed(1)} KB)`);

    // Step 6: Close browser (we have the buffer, don't need it anymore)
    await browser.close();
    browser = null;
    steps.push('Browser closed');

    // Step 7: Convert to 16-bit TIFF with Sharp
    steps.push('Converting to 16-bit TIFF with sRGB ICC profile...');
    
    const tiffPath = path.join(OUTPUT_DIR, 'integration-test-result.tiff');
    
    await sharp(pngBuffer)
      .toColourspace('rgb16')
      .withMetadata({
        density: targetDpi
      })
      .tiff({
        compression: 'deflate',
        quality: 100
      })
      .toFile(tiffPath);
    
    steps.push(`TIFF saved: ${tiffPath}`);

    // Step 8: Verify TIFF metadata
    steps.push('Verifying TIFF metadata...');
    const tiffStats = fs.statSync(tiffPath);
    const tiffMetadata = await sharp(tiffPath).metadata();
    
    steps.push(`  Format: ${tiffMetadata.format}`);
    steps.push(`  Size: ${tiffMetadata.width}x${tiffMetadata.height}`);
    steps.push(`  Depth: ${tiffMetadata.depth}`);
    steps.push(`  DPI: ${tiffMetadata.density}`);
    steps.push(`  Has ICC Profile: ${tiffMetadata.hasProfile}`);
    steps.push(`  File size: ${(tiffStats.size / 1024 / 1024).toFixed(2)} MB`);

    const duration = Date.now() - startTime;
    steps.push(`Total time: ${duration}ms`);

    return {
      success: true,
      canvasSize: { width: canvasWidth, height: canvasHeight },
      pngBufferSize: pngBuffer.length,
      tiffPath,
      tiffSize: tiffStats.size,
      tiffMetadata: {
        format: tiffMetadata.format || 'unknown',
        width: tiffMetadata.width || 0,
        height: tiffMetadata.height || 0,
        channels: tiffMetadata.channels || 0,
        depth: tiffMetadata.depth || 'unknown',
        density: tiffMetadata.density || 0,
        hasProfile: tiffMetadata.hasProfile || false
      },
      duration,
      steps
    };

  } catch (error) {
    // Clean up browser if still open
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    
    const duration = Date.now() - startTime;
    steps.push(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration,
      steps
    };
  }
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  console.log('\n=== Integration Test (Canvas → PNG → 16-bit TIFF) ===\n');
  
  runIntegrationTest({
    width: 2000,
    height: 1500,
    dpi: 300
  }).then(result => {
    console.log('\n=== Steps ===');
    result.steps?.forEach(step => console.log(`  ${step}`));
    
    console.log('\n=== Final Result ===');
    console.log(JSON.stringify({
      success: result.success,
      canvasSize: result.canvasSize,
      pngBufferSize: result.pngBufferSize,
      tiffSize: result.tiffSize,
      tiffMetadata: result.tiffMetadata,
      duration: result.duration,
      error: result.error
    }, null, 2));
    
    process.exit(result.success ? 0 : 1);
  });
}
