/**
 * Utility functions for embedding DPI metadata into image exports
 */

/**
 * Convert DPI to pixels per meter for PNG pHYs chunk
 */
function dpiToPixelsPerMeter(dpi: number): number {
  // 1 inch = 0.0254 meters
  // pixels per meter = DPI / 0.0254
  return Math.round(dpi / 0.0254);
}

/**
 * Add pHYs chunk to PNG data URL to embed DPI metadata
 * PNG structure: Signature (8 bytes) + IHDR chunk + optional chunks + IDAT chunks + IEND chunk
 * We insert pHYs chunk after IHDR and before IDAT
 */
export function embedDPIInPNG(dataURL: string, dpi: number): string {
  // Convert data URL to Uint8Array
  const base64 = dataURL.split(',')[1];
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // PNG signature: 137 80 78 71 13 10 26 10
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  
  // Verify this is a PNG
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== pngSignature[i]) {
      console.warn('Not a valid PNG file, returning original data URL');
      return dataURL;
    }
  }

  // Find IHDR chunk end (should be at byte 33 for most PNGs)
  // IHDR structure: length(4) + 'IHDR'(4) + data(13) + CRC(4) = 25 bytes
  let ihdrEnd = 8; // Start after signature
  
  // Read chunk length
  const ihdrLength = (bytes[ihdrEnd] << 24) | (bytes[ihdrEnd + 1] << 16) | 
                     (bytes[ihdrEnd + 2] << 8) | bytes[ihdrEnd + 3];
  
  // Skip to end of IHDR: length(4) + type(4) + data + CRC(4)
  ihdrEnd += 4 + 4 + ihdrLength + 4;

  // Create pHYs chunk
  const pixelsPerMeter = dpiToPixelsPerMeter(dpi);
  
  // pHYs chunk structure:
  // - Pixels per unit, X axis: 4 bytes
  // - Pixels per unit, Y axis: 4 bytes  
  // - Unit specifier: 1 byte (1 = meter)
  const physData = new Uint8Array(9);
  
  // X pixels per meter (big-endian)
  physData[0] = (pixelsPerMeter >> 24) & 0xFF;
  physData[1] = (pixelsPerMeter >> 16) & 0xFF;
  physData[2] = (pixelsPerMeter >> 8) & 0xFF;
  physData[3] = pixelsPerMeter & 0xFF;
  
  // Y pixels per meter (big-endian)
  physData[4] = (pixelsPerMeter >> 24) & 0xFF;
  physData[5] = (pixelsPerMeter >> 16) & 0xFF;
  physData[6] = (pixelsPerMeter >> 8) & 0xFF;
  physData[7] = pixelsPerMeter & 0xFF;
  
  // Unit specifier (1 = meter)
  physData[8] = 1;

  // Create chunk: length(4) + type(4) + data(9) + CRC(4)
  const chunkLength = physData.length;
  const chunkType = new Uint8Array([112, 72, 89, 115]); // 'pHYs' in ASCII
  
  // Calculate CRC for type + data
  const crcData = new Uint8Array(4 + physData.length);
  crcData.set(chunkType, 0);
  crcData.set(physData, 4);
  const crc = calculateCRC(crcData);
  
  // Build complete pHYs chunk
  const physChunk = new Uint8Array(4 + 4 + physData.length + 4);
  let offset = 0;
  
  // Length (big-endian)
  physChunk[offset++] = (chunkLength >> 24) & 0xFF;
  physChunk[offset++] = (chunkLength >> 16) & 0xFF;
  physChunk[offset++] = (chunkLength >> 8) & 0xFF;
  physChunk[offset++] = chunkLength & 0xFF;
  
  // Type 'pHYs'
  physChunk.set(chunkType, offset);
  offset += 4;
  
  // Data
  physChunk.set(physData, offset);
  offset += physData.length;
  
  // CRC
  physChunk[offset++] = (crc >> 24) & 0xFF;
  physChunk[offset++] = (crc >> 16) & 0xFF;
  physChunk[offset++] = (crc >> 8) & 0xFF;
  physChunk[offset++] = crc & 0xFF;

  // Combine: signature + IHDR + pHYs + rest of PNG
  const result = new Uint8Array(bytes.length + physChunk.length);
  result.set(bytes.subarray(0, ihdrEnd), 0);
  result.set(physChunk, ihdrEnd);
  result.set(bytes.subarray(ihdrEnd), ihdrEnd + physChunk.length);

  // Convert back to data URL
  const resultBase64 = btoa(String.fromCharCode.apply(null, Array.from(result)));
  return `data:image/png;base64,${resultBase64}`;
}

/**
 * CRC-32 calculation for PNG chunks
 */
function calculateCRC(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    crc = crc ^ byte;
    
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Note: JPEG DPI embedding requires modifying JFIF or EXIF markers
 * This is complex as we need to parse and modify the binary structure
 * For now, we return the original data URL
 * DPI information should be stored in the project file instead
 */
export function embedDPIInJPEG(dataURL: string, dpi: number): string {
  // JPEG DPI embedding is complex and requires parsing JFIF/EXIF markers
  // For browser compatibility, we skip this and rely on project file for DPI info
  console.log(`Note: JPEG DPI metadata (${dpi} DPI) not embedded in browser export. DPI info is stored in project file.`);
  return dataURL;
}

/**
 * Add tEXt chunk to PNG data URL to embed copyright metadata
 * tEXt chunk contains keyword + null byte + text content
 */
export function embedCopyrightInPNG(dataURL: string, copyright: string): string {
  if (!copyright || copyright.trim() === '') {
    return dataURL;
  }

  // Convert data URL to Uint8Array
  const base64 = dataURL.split(',')[1];
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // PNG signature: 137 80 78 71 13 10 26 10
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  
  // Verify this is a PNG
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== pngSignature[i]) {
      console.warn('Not a valid PNG file, returning original data URL');
      return dataURL;
    }
  }

  // Find IHDR chunk end
  let ihdrEnd = 8;
  const ihdrLength = (bytes[ihdrEnd] << 24) | (bytes[ihdrEnd + 1] << 16) | 
                     (bytes[ihdrEnd + 2] << 8) | bytes[ihdrEnd + 3];
  ihdrEnd += 4 + 4 + ihdrLength + 4;

  // Skip any existing pHYs chunk if present
  let insertPosition = ihdrEnd;
  while (insertPosition < bytes.length - 8) {
    const chunkLen = (bytes[insertPosition] << 24) | (bytes[insertPosition + 1] << 16) | 
                     (bytes[insertPosition + 2] << 8) | bytes[insertPosition + 3];
    const chunkType = String.fromCharCode(
      bytes[insertPosition + 4], 
      bytes[insertPosition + 5], 
      bytes[insertPosition + 6], 
      bytes[insertPosition + 7]
    );
    
    // Stop when we hit IDAT (image data)
    if (chunkType === 'IDAT') {
      break;
    }
    
    insertPosition += 4 + 4 + chunkLen + 4;
  }

  // Create tEXt chunk for copyright
  // Format: keyword + null byte + text
  const keyword = 'Copyright';
  const textContent = copyright;
  const keywordBytes = new TextEncoder().encode(keyword);
  const textBytes = new TextEncoder().encode(textContent);
  
  // tEXt data: keyword + null separator + text
  const textData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  textData.set(keywordBytes, 0);
  textData[keywordBytes.length] = 0; // null separator
  textData.set(textBytes, keywordBytes.length + 1);

  // Create chunk: length(4) + type(4) + data + CRC(4)
  const chunkLength = textData.length;
  const chunkType = new Uint8Array([116, 69, 88, 116]); // 'tEXt' in ASCII
  
  // Calculate CRC for type + data
  const crcData = new Uint8Array(4 + textData.length);
  crcData.set(chunkType, 0);
  crcData.set(textData, 4);
  const crc = calculateCRC(crcData);
  
  // Build complete tEXt chunk
  const textChunk = new Uint8Array(4 + 4 + textData.length + 4);
  let offset = 0;
  
  // Length (big-endian)
  textChunk[offset++] = (chunkLength >> 24) & 0xFF;
  textChunk[offset++] = (chunkLength >> 16) & 0xFF;
  textChunk[offset++] = (chunkLength >> 8) & 0xFF;
  textChunk[offset++] = chunkLength & 0xFF;
  
  // Type 'tEXt'
  textChunk.set(chunkType, offset);
  offset += 4;
  
  // Data
  textChunk.set(textData, offset);
  offset += textData.length;
  
  // CRC
  textChunk[offset++] = (crc >> 24) & 0xFF;
  textChunk[offset++] = (crc >> 16) & 0xFF;
  textChunk[offset++] = (crc >> 8) & 0xFF;
  textChunk[offset++] = crc & 0xFF;

  // Combine: before insert + tEXt + rest of PNG
  const result = new Uint8Array(bytes.length + textChunk.length);
  result.set(bytes.subarray(0, insertPosition), 0);
  result.set(textChunk, insertPosition);
  result.set(bytes.subarray(insertPosition), insertPosition + textChunk.length);

  // Convert back to data URL
  const resultBase64 = btoa(String.fromCharCode.apply(null, Array.from(result)));
  return `data:image/png;base64,${resultBase64}`;
}

/**
 * Embed copyright in image based on format
 * Note: Currently only PNG is supported for browser-based copyright embedding
 */
export function embedCopyright(dataURL: string, format: string, copyright: string): string {
  if (!copyright || copyright.trim() === '') {
    return dataURL;
  }
  
  if (format === 'png') {
    return embedCopyrightInPNG(dataURL, copyright);
  }
  
  // JPEG/other formats would require EXIF manipulation which is complex in browser
  // For now, log a note and return original
  if (format === 'jpg' || format === 'jpeg') {
    console.log('Note: JPEG copyright metadata embedding not yet supported in browser export.');
  }
  
  return dataURL;
}

/**
 * Helper to create a single tEXt chunk for PNG
 */
function createTextChunk(keyword: string, value: string): Uint8Array {
  const keywordBytes = new TextEncoder().encode(keyword);
  const textBytes = new TextEncoder().encode(value);
  
  // tEXt data: keyword + null separator + text
  const textData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  textData.set(keywordBytes, 0);
  textData[keywordBytes.length] = 0; // null separator
  textData.set(textBytes, keywordBytes.length + 1);

  // Create chunk: length(4) + type(4) + data + CRC(4)
  const chunkLength = textData.length;
  const chunkType = new Uint8Array([116, 69, 88, 116]); // 'tEXt' in ASCII
  
  // Calculate CRC for type + data
  const crcData = new Uint8Array(4 + textData.length);
  crcData.set(chunkType, 0);
  crcData.set(textData, 4);
  const crc = calculateCRC(crcData);
  
  // Build complete tEXt chunk
  const textChunk = new Uint8Array(4 + 4 + textData.length + 4);
  let offset = 0;
  
  // Length (big-endian)
  textChunk[offset++] = (chunkLength >> 24) & 0xFF;
  textChunk[offset++] = (chunkLength >> 16) & 0xFF;
  textChunk[offset++] = (chunkLength >> 8) & 0xFF;
  textChunk[offset++] = chunkLength & 0xFF;
  
  // Type 'tEXt'
  textChunk.set(chunkType, offset);
  offset += 4;
  
  // Data
  textChunk.set(textData, offset);
  offset += textData.length;
  
  // CRC
  textChunk[offset++] = (crc >> 24) & 0xFF;
  textChunk[offset++] = (crc >> 16) & 0xFF;
  textChunk[offset++] = (crc >> 8) & 0xFF;
  textChunk[offset++] = crc & 0xFF;
  
  return textChunk;
}

/**
 * Embed all image metadata into PNG using multiple tEXt chunks
 * Supports: Copyright, Author, Title, Description, Creation Time, Software
 */
export interface PngMetadata {
  copyright?: string;
  author?: string;
  title?: string;
  description?: string;
  creationTime?: string;
  software?: string;
}

export function embedPngMetadata(dataURL: string, metadata: PngMetadata): string {
  // Filter out empty values
  const entries = Object.entries(metadata).filter(([_, value]) => value && value.trim() !== '');
  
  if (entries.length === 0) {
    return dataURL;
  }

  // Convert data URL to Uint8Array
  const base64 = dataURL.split(',')[1];
  const binaryString = atob(base64);
  let bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // PNG signature verification
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== pngSignature[i]) {
      console.warn('Not a valid PNG file, returning original data URL');
      return dataURL;
    }
  }

  // Find IHDR chunk end
  let ihdrEnd = 8;
  const ihdrLength = (bytes[ihdrEnd] << 24) | (bytes[ihdrEnd + 1] << 16) | 
                     (bytes[ihdrEnd + 2] << 8) | bytes[ihdrEnd + 3];
  ihdrEnd += 4 + 4 + ihdrLength + 4;

  // Find insert position (before IDAT)
  let insertPosition = ihdrEnd;
  while (insertPosition < bytes.length - 8) {
    const chunkLen = (bytes[insertPosition] << 24) | (bytes[insertPosition + 1] << 16) | 
                     (bytes[insertPosition + 2] << 8) | bytes[insertPosition + 3];
    const chunkType = String.fromCharCode(
      bytes[insertPosition + 4], 
      bytes[insertPosition + 5], 
      bytes[insertPosition + 6], 
      bytes[insertPosition + 7]
    );
    
    if (chunkType === 'IDAT') {
      break;
    }
    
    insertPosition += 4 + 4 + chunkLen + 4;
  }

  // Map our metadata keys to PNG tEXt keywords
  const keywordMap: Record<string, string> = {
    copyright: 'Copyright',
    author: 'Author',
    title: 'Title',
    description: 'Description',
    creationTime: 'Creation Time',
    software: 'Software',
  };

  // Create all tEXt chunks
  const chunks: Uint8Array[] = [];
  for (const [key, value] of entries) {
    const keyword = keywordMap[key] || key;
    chunks.push(createTextChunk(keyword, value));
  }

  // Calculate total size of all chunks
  const totalChunksSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

  // Combine: before insert + all chunks + rest of PNG
  const result = new Uint8Array(bytes.length + totalChunksSize);
  result.set(bytes.subarray(0, insertPosition), 0);
  
  let chunkOffset = insertPosition;
  for (const chunk of chunks) {
    result.set(chunk, chunkOffset);
    chunkOffset += chunk.length;
  }
  
  result.set(bytes.subarray(insertPosition), chunkOffset);

  // Convert back to data URL
  const resultBase64 = btoa(String.fromCharCode.apply(null, Array.from(result)));
  return `data:image/png;base64,${resultBase64}`;
}

/**
 * Embed DPI metadata based on format
 */
export function embedDPI(dataURL: string, format: string, dpi: number): string {
  if (format === 'png') {
    return embedDPIInPNG(dataURL, dpi);
  } else if (format === 'jpg' || format === 'jpeg') {
    return embedDPIInJPEG(dataURL, dpi);
  }
  
  // Other formats don't support DPI metadata in browser exports
  return dataURL;
}
