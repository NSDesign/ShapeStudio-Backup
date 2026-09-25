import type { Express } from "express";
import { createCanvas } from 'canvas';

/**
 * Test endpoint for debugging canvas/PNG generation issues
 * Creates a minimal canvas with one circle to isolate the problem
 */
export function registerCanvasTestRoutes(app: Express) {
  // Simple canvas test endpoint
  app.get('/api/test/canvas', (req, res) => {
    try {
      const format = (req.query.format as string)?.toLowerCase() || 'png';
      const width = parseInt(req.query.width as string) || 400;
      const height = parseInt(req.query.height as string) || 400;
      
      console.log(`[CanvasTest] Generating test image: ${width}x${height}, format: ${format}`);
      
      // Check node-canvas version
      let canvasVersion = 'unknown';
      try {
        const canvasPackage = require('canvas/package.json');
        canvasVersion = canvasPackage.version;
      } catch (e) {
        console.warn('[CanvasTest] Could not read canvas package version');
      }
      
      console.log(`[CanvasTest] node-canvas version: ${canvasVersion}`);
      
      // Create canvas
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Failed to get 2D context from canvas');
      }
      
      // Draw white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      
      // Draw a red circle in the center
      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 50, 0, Math.PI * 2);
      ctx.fill();
      
      // Add some text
      ctx.fillStyle = '#000000';
      ctx.font = '20px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Test Canvas', width / 2, height - 30);
      ctx.fillText(`Format: ${format.toUpperCase()}`, width / 2, height - 10);
      
      console.log('[CanvasTest] Canvas rendering complete');
      
      // Convert to buffer
      let buffer: Buffer;
      let mimeType: string;
      
      if (format === 'jpeg' || format === 'jpg') {
        buffer = canvas.toBuffer('image/jpeg', { quality: 0.92 });
        mimeType = 'image/jpeg';
        console.log(`[CanvasTest] Generated JPEG buffer, size: ${buffer.length} bytes`);
      } else {
        // Default to PNG
        buffer = canvas.toBuffer('image/png');
        mimeType = 'image/png';
        console.log(`[CanvasTest] Generated PNG buffer, size: ${buffer.length} bytes`);
        
        // Validate PNG header
        const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const bufferSignature = buffer.slice(0, 8);
        
        if (!bufferSignature.equals(pngSignature)) {
          console.error('[CanvasTest] Invalid PNG signature!');
          console.error('[CanvasTest] Expected:', pngSignature);
          console.error('[CanvasTest] Got:', bufferSignature);
          console.error('[CanvasTest] First 50 bytes:', buffer.slice(0, 50));
          
          return res.status(500).json({
            error: 'Generated buffer does not have valid PNG signature',
            expected: Array.from(pngSignature),
            got: Array.from(bufferSignature),
            bufferSize: buffer.length,
            canvasVersion
          });
        }
        
        console.log('[CanvasTest] PNG signature validated successfully');
      }
      
      // Set headers and send
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('X-Canvas-Version', canvasVersion);
      res.setHeader('X-Buffer-Size', buffer.length.toString());
      res.send(buffer);
      
      console.log('[CanvasTest] Image sent successfully');
      
    } catch (error) {
      console.error('[CanvasTest] Error generating test canvas:', error);
      res.status(500).json({
        error: 'Failed to generate test canvas',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  });
  
  // Info endpoint
  app.get('/api/test/canvas/info', (req, res) => {
    try {
      let canvasVersion = 'unknown';
      let canvasInstalled = false;
      
      try {
        require('canvas');
        canvasInstalled = true;
        const canvasPackage = require('canvas/package.json');
        canvasVersion = canvasPackage.version;
      } catch (e) {
        console.warn('[CanvasTest] node-canvas not found or not properly installed');
      }
      
      res.json({
        canvasInstalled,
        canvasVersion,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get canvas info',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}
