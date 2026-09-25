# Export Validation Tests

This folder contains isolated validation tests for the server-side export feature.
These tests validate that Puppeteer (headless Chrome) and Sharp work correctly on Replit
before we commit to full implementation.

## Purpose
- Validate Puppeteer/Chromium works on Replit
- Validate Sharp can produce 16-bit TIFF with sRGB ICC profile
- Validate the full pipeline: canvas render → Sharp → print-quality TIFF

## Files
- `puppeteer-test.ts` - Phase 1: Headless Chrome validation
- `sharp-test.ts` - Phase 2: 16-bit TIFF with ICC profile validation  
- `integration-test.ts` - Phase 3: Full pipeline validation

## Cleanup
If validation fails or after successful integration, this entire folder can be deleted.
