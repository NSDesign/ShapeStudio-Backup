/**
 * Phase 1: Puppeteer Validation Test
 * 
 * Tests that headless Chrome (via puppeteer-core) works on Replit.
 * Uses system Chromium installed via Nix.
 */

import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(process.cwd(), 'server/validation/output');

export interface PuppeteerTestResult {
  success: boolean;
  chromiumPath?: string;
  screenshotPath?: string;
  screenshotSize?: number;
  error?: string;
  duration?: number;
}

export async function runPuppeteerTest(): Promise<PuppeteerTestResult> {
  const startTime = Date.now();
  
  try {
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Find system Chromium path
    let chromiumPath: string;
    try {
      chromiumPath = execSync('which chromium').toString().trim();
    } catch {
      // Try alternative path
      try {
        chromiumPath = execSync('which chromium-browser').toString().trim();
      } catch {
        return {
          success: false,
          error: 'Could not find Chromium executable. Make sure pkgs.chromium is in replit.nix'
        };
      }
    }

    console.log(`[Puppeteer Test] Found Chromium at: ${chromiumPath}`);

    // Launch headless Chrome
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: chromiumPath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer'
      ]
    });

    console.log('[Puppeteer Test] Browser launched successfully');

    // Create a new page
    const page = await browser.newPage();
    
    // Set viewport to a reasonable size
    await page.setViewport({ width: 1024, height: 768 });

    // Navigate to a simple data URL with a test canvas
    const testHtml = `
      <!DOCTYPE html>
      <html>
      <head><title>Puppeteer Test</title></head>
      <body style="margin:0;padding:0;">
        <canvas id="testCanvas" width="800" height="600"></canvas>
        <script>
          const canvas = document.getElementById('testCanvas');
          const ctx = canvas.getContext('2d');
          
          // Draw a gradient background
          const gradient = ctx.createLinearGradient(0, 0, 800, 600);
          gradient.addColorStop(0, '#ff6b6b');
          gradient.addColorStop(0.5, '#4ecdc4');
          gradient.addColorStop(1, '#45b7d1');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, 800, 600);
          
          // Draw some shapes
          ctx.fillStyle = 'white';
          ctx.beginPath();
          ctx.arc(400, 300, 100, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = '#333';
          ctx.font = 'bold 24px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('Puppeteer Test - Success!', 400, 310);
        </script>
      </body>
      </html>
    `;

    await page.setContent(testHtml, { waitUntil: 'networkidle0' });
    console.log('[Puppeteer Test] Page loaded with test canvas');

    // Take a screenshot
    const screenshotPath = path.join(OUTPUT_DIR, 'puppeteer-test-screenshot.png');
    await page.screenshot({ path: screenshotPath, type: 'png' });
    
    // Get file size
    const stats = fs.statSync(screenshotPath);
    console.log(`[Puppeteer Test] Screenshot saved: ${screenshotPath} (${stats.size} bytes)`);

    // Close browser
    await browser.close();
    console.log('[Puppeteer Test] Browser closed');

    const duration = Date.now() - startTime;

    return {
      success: true,
      chromiumPath,
      screenshotPath,
      screenshotSize: stats.size,
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
  runPuppeteerTest().then(result => {
    console.log('\n=== Puppeteer Test Result ===');
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  });
}
