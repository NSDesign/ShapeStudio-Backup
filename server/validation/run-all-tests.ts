/**
 * Validation Test Runner
 * 
 * Runs all validation tests in sequence and reports results.
 * Usage: npx tsx server/validation/run-all-tests.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runPuppeteerTest, PuppeteerTestResult } from './puppeteer-test';
import { runSharpTest, runLargeImageTest, SharpTestResult } from './sharp-test';
import { runIntegrationTest, IntegrationTestResult } from './integration-test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ValidationReport {
  timestamp: string;
  phase1_puppeteer: PuppeteerTestResult;
  phase2_sharp_basic: SharpTestResult;
  phase2_sharp_large: SharpTestResult;
  phase3_integration: IntegrationTestResult;
  allPassed: boolean;
  summary: string[];
}

async function runAllValidationTests(): Promise<ValidationReport> {
  const summary: string[] = [];
  
  console.log('═'.repeat(60));
  console.log('  EXPORT VALIDATION TEST SUITE');
  console.log('  Testing: Puppeteer + Sharp for server-side export');
  console.log('═'.repeat(60));
  console.log();

  // Phase 1: Puppeteer
  console.log('─'.repeat(60));
  console.log('PHASE 1: Puppeteer (Headless Chrome) Validation');
  console.log('─'.repeat(60));
  const puppeteerResult = await runPuppeteerTest();
  
  if (puppeteerResult.success) {
    summary.push('✅ Phase 1: Puppeteer works on Replit');
    console.log(`\n✅ PASSED - Screenshot saved (${puppeteerResult.screenshotSize} bytes)`);
  } else {
    summary.push(`❌ Phase 1: Puppeteer FAILED - ${puppeteerResult.error}`);
    console.log(`\n❌ FAILED - ${puppeteerResult.error}`);
  }
  console.log();

  // Phase 2: Sharp Basic
  console.log('─'.repeat(60));
  console.log('PHASE 2a: Sharp Basic Test (16-bit TIFF)');
  console.log('─'.repeat(60));
  const sharpBasicResult = await runSharpTest();
  
  if (sharpBasicResult.success) {
    const is16Bit = sharpBasicResult.metadata?.depth === 'ushort';
    const hasDpi = sharpBasicResult.metadata?.density === 300;
    
    if (is16Bit && hasDpi) {
      summary.push('✅ Phase 2a: Sharp 16-bit TIFF with 300 DPI works');
      console.log(`\n✅ PASSED - 16-bit TIFF created (${sharpBasicResult.metadata?.depth}, ${sharpBasicResult.metadata?.density} DPI)`);
    } else {
      summary.push(`⚠️ Phase 2a: Sharp works but: depth=${sharpBasicResult.metadata?.depth}, dpi=${sharpBasicResult.metadata?.density}`);
      console.log(`\n⚠️ PARTIAL - depth=${sharpBasicResult.metadata?.depth}, dpi=${sharpBasicResult.metadata?.density}`);
    }
  } else {
    summary.push(`❌ Phase 2a: Sharp FAILED - ${sharpBasicResult.error}`);
    console.log(`\n❌ FAILED - ${sharpBasicResult.error}`);
  }
  console.log();

  // Phase 2: Sharp Large Image (A4 @ 300 DPI)
  console.log('─'.repeat(60));
  console.log('PHASE 2b: Sharp Large Image Test (A4 @ 300 DPI)');
  console.log('─'.repeat(60));
  const sharpLargeResult = await runLargeImageTest();
  
  if (sharpLargeResult.success) {
    const sizeMB = (sharpLargeResult.tiffSize || 0) / 1024 / 1024;
    summary.push(`✅ Phase 2b: Sharp handles A4 @ 300 DPI (${sizeMB.toFixed(1)} MB)`);
    console.log(`\n✅ PASSED - A4 @ 300 DPI created (${sizeMB.toFixed(1)} MB, ${sharpLargeResult.duration}ms)`);
  } else {
    summary.push(`❌ Phase 2b: Sharp large image FAILED - ${sharpLargeResult.error}`);
    console.log(`\n❌ FAILED - ${sharpLargeResult.error}`);
  }
  console.log();

  // Phase 3: Integration Test
  console.log('─'.repeat(60));
  console.log('PHASE 3: Full Integration (Canvas → PNG → 16-bit TIFF)');
  console.log('─'.repeat(60));
  const integrationResult = await runIntegrationTest({
    width: 2000,
    height: 1500,
    dpi: 300
  });
  
  if (integrationResult.success) {
    const sizeMB = (integrationResult.tiffSize || 0) / 1024 / 1024;
    const is16Bit = integrationResult.tiffMetadata?.depth === 'ushort';
    
    summary.push(`✅ Phase 3: Full pipeline works (${sizeMB.toFixed(1)} MB TIFF)`);
    console.log(`\n✅ PASSED - Full pipeline works!`);
    console.log(`   Canvas: ${integrationResult.canvasSize?.width}x${integrationResult.canvasSize?.height}`);
    console.log(`   PNG buffer: ${((integrationResult.pngBufferSize || 0) / 1024).toFixed(0)} KB`);
    console.log(`   TIFF output: ${sizeMB.toFixed(2)} MB, ${is16Bit ? '16-bit' : '8-bit'}, ${integrationResult.tiffMetadata?.density} DPI`);
    console.log(`   Duration: ${integrationResult.duration}ms`);
  } else {
    summary.push(`❌ Phase 3: Integration FAILED - ${integrationResult.error}`);
    console.log(`\n❌ FAILED - ${integrationResult.error}`);
    if (integrationResult.steps) {
      console.log('\nSteps completed:');
      integrationResult.steps.forEach(s => console.log(`  ${s}`));
    }
  }
  console.log();

  // Final Report
  const allPassed = puppeteerResult.success && 
                    sharpBasicResult.success && 
                    sharpLargeResult.success && 
                    integrationResult.success;

  console.log('═'.repeat(60));
  console.log('  VALIDATION SUMMARY');
  console.log('═'.repeat(60));
  summary.forEach(s => console.log(`  ${s}`));
  console.log('─'.repeat(60));
  
  if (allPassed) {
    console.log('  🎉 ALL TESTS PASSED - Ready for full implementation!');
  } else {
    console.log('  ⚠️  SOME TESTS FAILED - Review errors above');
  }
  console.log('═'.repeat(60));

  return {
    timestamp: new Date().toISOString(),
    phase1_puppeteer: puppeteerResult,
    phase2_sharp_basic: sharpBasicResult,
    phase2_sharp_large: sharpLargeResult,
    phase3_integration: integrationResult,
    allPassed,
    summary
  };
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runAllValidationTests()
    .then(report => {
      // Save report to file
      const reportPath = path.join(__dirname, 'output', 'validation-report.json');
      
      // Ensure output directory exists
      const outputDir = path.dirname(reportPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\nReport saved to: ${reportPath}`);
      
      process.exit(report.allPassed ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal error running tests:', err);
      process.exit(1);
    });
}

export { runAllValidationTests };
