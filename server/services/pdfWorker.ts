import { parentPort, workerData } from 'worker_threads';
import { jsPDF } from 'jspdf';
import * as fs from 'fs';

interface PdfWorkerData {
  pngBase64?: string;      // legacy: base64-encoded PNG (non-tiled path)
  pngFilePath?: string;    // preferred: path to PNG file — avoids base64 in main thread heap
  width: number;
  height: number;
  dpi: number;
  widthMm: number;
  heightMm: number;
  orientation: 'portrait' | 'landscape';
  artistName?: string;
  copyrightText?: string;
  imageTitle?: string;
  imageDescription?: string;
  outPath: string;
}

function generatePdf(data: PdfWorkerData): void {
  const { widthMm, heightMm, orientation, artistName, copyrightText, imageTitle, imageDescription, outPath } = data;

  // Resolve PNG data: read from file path when available (no base64 in main-thread heap)
  let pngBase64: string;
  if (data.pngFilePath) {
    const pngBuffer = fs.readFileSync(data.pngFilePath);
    pngBase64 = pngBuffer.toString('base64');
  } else if (data.pngBase64) {
    pngBase64 = data.pngBase64;
  } else {
    throw new Error('PdfWorker: neither pngFilePath nor pngBase64 was provided');
  }

  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: [widthMm, heightMm]
  });

  pdf.setProperties({
    title: imageTitle || 'Shape Editor Export',
    author: artistName || 'Shape Editor',
    creator: 'Shape Editor - Replit',
    subject: imageDescription || 'Generated artwork',
    keywords: copyrightText ? `Copyright: ${copyrightText}` : undefined
  });

  const pngDataUrl = `data:image/png;base64,${pngBase64}`;
  pdf.addImage(pngDataUrl, 'PNG', 0, 0, widthMm, heightMm, undefined, 'FAST');

  const pdfArrayBuffer = pdf.output('arraybuffer');
  fs.writeFileSync(outPath, Buffer.from(pdfArrayBuffer));
}

if (parentPort) {
  try {
    generatePdf(workerData as PdfWorkerData);
    parentPort.postMessage({ success: true, filePath: (workerData as PdfWorkerData).outPath });
  } catch (error) {
    parentPort.postMessage({
      success: false,
      error: error instanceof Error ? error.message : 'PDF generation failed'
    });
  }
}
