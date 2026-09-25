/**
 * sRGB ICC Profile Embedding
 * 
 * This module provides utilities for embedding sRGB ICC profiles in exported images.
 * The sRGB IEC61966-2.1 profile is the standard colorspace for web and most POD services.
 * 
 * For TIFF: Uses tag 34675 (InterColorProfile)
 * For PNG: Uses iCCP chunk
 * For JPEG: Uses APP2 marker segment
 */

// sRGB IEC61966-2.1 ICC profile (480 bytes) - extracted from lcms (Little CMS engine)
// Complete, self-consistent profile: header size field matches actual byte count.
// Verified: acsp signature, correct XYZ primaries, sRGB parametric TRC curve.
export const SRGB_ICC_PROFILE_BASE64 =
  'AAAB4GxjbXMEIAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwA' +
  'AAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5keem/Vlo+AbaDI4VVRvdPqgAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAkY3BydAAAASAAAAAid3RwdAAAAUQAAAAUY2hh' +
  'ZAAAAVgAAAAsclhZWgAAAYQAAAAUZ1hZWgAAAZgAAAAUYlhZWgAAAawAAAAUclRSQwAAAcAAAAAg' +
  'Z1RSQwAAAcAAAAAgYlRSQwAAAcAAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIA' +
  'RwBCbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABDAEMAMAAAWFlaIAAAAAAAAPbWAAEAAAAA' +
  '0y1zZjMyAAAAAAABDD8AAAXd///zJgAAB5AAAP2S///7of///aIAAAPcAADAcVhZWiAAAAAAAABv' +
  'oAAAOPIAAAOPWFlaIAAAAAAAAGKWAAC3iQAAGNpYWVogAAAAAAAAJKAAAA+FAAC2xHBhcmEAAAAA' +
  'AAMAAAACZmkAAPKnAAANWQAAE9AAAApb';

// Same profile used for both constants — both are now complete and valid.
export const SRGB_ICC_PROFILE_FULL_BASE64 =
  'AAAB4GxjbXMEIAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwA' +
  'AAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5keem/Vlo+AbaDI4VVRvdPqgAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAkY3BydAAAASAAAAAid3RwdAAAAUQAAAAUY2hh' +
  'ZAAAAVgAAAAsclhZWgAAAYQAAAAUZ1hZWgAAAZgAAAAUYlhZWgAAAawAAAAUclRSQwAAAcAAAAAg' +
  'Z1RSQwAAAcAAAAAgYlRSQwAAAcAAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIA' +
  'RwBCbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABDAEMAMAAAWFlaIAAAAAAAAPbWAAEAAAAA' +
  '0y1zZjMyAAAAAAABDD8AAAXd///zJgAAB5AAAP2S///7of///aIAAAPcAADAcVhZWiAAAAAAAABv' +
  'oAAAOPIAAAOPWFlaIAAAAAAAAGKWAAC3iQAAGNpYWVogAAAAAAAAJKAAAA+FAAC2xHBhcmEAAAAA' +
  'AAMAAAACZmkAAPKnAAANWQAAE9AAAApb';

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Get sRGB ICC profile as Uint8Array
 * @param full - Use full official ICC.org profile (larger but more compatible)
 */
export function getSrgbIccProfile(full: boolean = true): Uint8Array {
  const base64 = full ? SRGB_ICC_PROFILE_FULL_BASE64 : SRGB_ICC_PROFILE_BASE64;
  return base64ToUint8Array(base64);
}

/**
 * Create PNG with embedded sRGB ICC profile
 * This adds an iCCP chunk to the PNG data
 */
export async function embedIccInPng(pngBlob: Blob, iccProfile?: Uint8Array): Promise<Blob> {
  const profile = iccProfile || getSrgbIccProfile();
  const pngData = new Uint8Array(await pngBlob.arrayBuffer());
  
  // PNG signature check
  const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < 8; i++) {
    if (pngData[i] !== pngSignature[i]) {
      console.warn('Invalid PNG signature, returning original blob');
      return pngBlob;
    }
  }
  
  // Compress the ICC profile using pako-like compression (browser native)
  let compressedProfile: Uint8Array;
  try {
    const stream = new CompressionStream('deflate');
    const writer = stream.writable.getWriter();
    writer.write(profile);
    writer.close();
    const compressedData = await new Response(stream.readable).arrayBuffer();
    compressedProfile = new Uint8Array(compressedData);
  } catch {
    // Fallback: use uncompressed profile if compression fails
    console.warn('ICC profile compression failed, using uncompressed');
    compressedProfile = profile;
  }
  
  // Create iCCP chunk
  // Format: profile_name (null-terminated) + compression_method (1 byte) + compressed_profile
  const profileName = 'sRGB';
  const profileNameBytes = new TextEncoder().encode(profileName);
  const chunkData = new Uint8Array(profileNameBytes.length + 1 + 1 + compressedProfile.length);
  chunkData.set(profileNameBytes, 0);
  chunkData[profileNameBytes.length] = 0; // null terminator
  chunkData[profileNameBytes.length + 1] = 0; // compression method (0 = deflate)
  chunkData.set(compressedProfile, profileNameBytes.length + 2);
  
  // Calculate CRC for iCCP chunk
  const chunkType = new TextEncoder().encode('iCCP');
  const crcData = new Uint8Array(chunkType.length + chunkData.length);
  crcData.set(chunkType, 0);
  crcData.set(chunkData, chunkType.length);
  const crc = calculateCrc32(crcData);
  
  // Build the iCCP chunk: length (4 bytes) + type (4 bytes) + data + crc (4 bytes)
  const chunkLength = chunkData.length;
  const iccpChunk = new Uint8Array(4 + 4 + chunkLength + 4);
  
  // Length (big-endian)
  iccpChunk[0] = (chunkLength >> 24) & 0xFF;
  iccpChunk[1] = (chunkLength >> 16) & 0xFF;
  iccpChunk[2] = (chunkLength >> 8) & 0xFF;
  iccpChunk[3] = chunkLength & 0xFF;
  
  // Type
  iccpChunk.set(chunkType, 4);
  
  // Data
  iccpChunk.set(chunkData, 8);
  
  // CRC (big-endian)
  iccpChunk[8 + chunkLength] = (crc >> 24) & 0xFF;
  iccpChunk[8 + chunkLength + 1] = (crc >> 16) & 0xFF;
  iccpChunk[8 + chunkLength + 2] = (crc >> 8) & 0xFF;
  iccpChunk[8 + chunkLength + 3] = crc & 0xFF;
  
  // Insert iCCP chunk right after IHDR (which starts at byte 8 and has variable length)
  // Find the end of IHDR chunk
  const ihdrLength = (pngData[8] << 24) | (pngData[9] << 16) | (pngData[10] << 8) | pngData[11];
  const ihdrEnd = 8 + 4 + 4 + ihdrLength + 4; // signature(8) + length(4) + type(4) + data + crc(4)
  
  // Create new PNG with iCCP chunk inserted
  const newPng = new Uint8Array(pngData.length + iccpChunk.length);
  newPng.set(pngData.subarray(0, ihdrEnd), 0);
  newPng.set(iccpChunk, ihdrEnd);
  newPng.set(pngData.subarray(ihdrEnd), ihdrEnd + iccpChunk.length);
  
  return new Blob([newPng], { type: 'image/png' });
}

/**
 * Get TIFF ICC profile tag for embedding
 * TIFF tag 34675 (0x8773) = InterColorProfile
 */
export function getTiffIccTag(): { tagId: number; data: Uint8Array } {
  return {
    tagId: 34675, // InterColorProfile / ICC Profile tag
    data: getSrgbIccProfile()
  };
}

// CRC32 lookup table
const crc32Table = (() => {
  const table: number[] = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

/**
 * Calculate CRC32 for PNG chunk validation
 */
function calculateCrc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Embed ICC profile in JPEG using APP2 marker
 * ICC profiles in JPEG are stored in APP2 markers with 'ICC_PROFILE' signature
 */
export async function embedIccInJpeg(jpegBlob: Blob, iccProfile?: Uint8Array): Promise<Blob> {
  const profile = iccProfile || getSrgbIccProfile();
  const jpegData = new Uint8Array(await jpegBlob.arrayBuffer());
  
  // JPEG signature check (SOI marker)
  if (jpegData[0] !== 0xFF || jpegData[1] !== 0xD8) {
    console.warn('Invalid JPEG signature, returning original blob');
    return jpegBlob;
  }
  
  // ICC_PROFILE marker identifier
  const iccMarker = new TextEncoder().encode('ICC_PROFILE');
  
  // Build APP2 segment with ICC profile
  // Format: FF E2 (APP2) + length (2 bytes) + 'ICC_PROFILE\0' + sequence number (1) + total chunks (1) + profile data
  // For profiles <= ~64KB, we use a single chunk
  const maxChunkSize = 65519; // 65535 - 16 (marker overhead)
  const profileSize = profile.length;
  
  if (profileSize > maxChunkSize) {
    // For very large profiles, we'd need multi-segment embedding
    // Most sRGB profiles are small enough for single segment
    console.warn('ICC profile too large for single APP2 segment, returning original blob');
    return jpegBlob;
  }
  
  // Single chunk APP2 segment
  const segmentDataLength = 12 + 2 + profileSize; // ICC_PROFILE\0 + seq/total + profile
  const segmentLength = 2 + segmentDataLength; // length field (2) + data
  
  const app2Segment = new Uint8Array(2 + segmentLength); // marker (2) + segment
  app2Segment[0] = 0xFF;
  app2Segment[1] = 0xE2; // APP2
  app2Segment[2] = (segmentLength >> 8) & 0xFF;
  app2Segment[3] = segmentLength & 0xFF;
  app2Segment.set(iccMarker, 4);
  app2Segment[4 + iccMarker.length] = 0x00; // null terminator
  app2Segment[4 + iccMarker.length + 1] = 0x01; // sequence number
  app2Segment[4 + iccMarker.length + 2] = 0x01; // total chunks
  app2Segment.set(profile, 4 + iccMarker.length + 3);
  
  // Insert APP2 segment right after SOI (bytes 0-1)
  // We should insert before any existing APP markers for best compatibility
  const newJpeg = new Uint8Array(jpegData.length + app2Segment.length);
  newJpeg.set(jpegData.subarray(0, 2), 0); // SOI
  newJpeg.set(app2Segment, 2);
  newJpeg.set(jpegData.subarray(2), 2 + app2Segment.length);
  
  return new Blob([newJpeg], { type: 'image/jpeg' });
}

/**
 * Embed ICC profile in TIFF by injecting tag 34675 (InterColorProfile).
 * UTIF.encodeImage does not support this tag, so we patch the binary after encoding.
 * Handles both big-endian (MM) and little-endian (II) TIFF files.
 * Inserts the new IFD entry in sorted tag order and shifts all data offsets beyond the IFD.
 */
export async function embedIccInTiff(tiffBlob: Blob, iccProfile?: Uint8Array): Promise<Blob> {
  const profile = iccProfile || getSrgbIccProfile();
  const raw = new Uint8Array(await tiffBlob.arrayBuffer());

  const isBE = raw[0] === 0x4D && raw[1] === 0x4D; // 'MM'
  const isLE = raw[0] === 0x49 && raw[1] === 0x49; // 'II'
  if (!isBE && !isLE) {
    console.warn('[embedIccInTiff] Not a valid TIFF file, skipping ICC injection');
    return tiffBlob;
  }

  const r16 = (off: number) =>
    isBE ? (raw[off] << 8) | raw[off + 1] : raw[off] | (raw[off + 1] << 8);
  const r32 = (off: number) =>
    isBE
      ? ((raw[off] << 24) | (raw[off + 1] << 16) | (raw[off + 2] << 8) | raw[off + 3]) >>> 0
      : (raw[off] | (raw[off + 1] << 8) | (raw[off + 2] << 16) | (raw[off + 3] << 24)) >>> 0;

  if (r16(2) !== 42) {
    console.warn('[embedIccInTiff] Invalid TIFF magic number');
    return tiffBlob;
  }

  const ifdOff = r32(4);
  if (ifdOff + 2 > raw.length) {
    console.warn('[embedIccInTiff] IFD offset out of bounds');
    return tiffBlob;
  }
  const n = r16(ifdOff);

  // Return unchanged if ICC tag (34675) already present
  const ICC_TAG = 34675;
  for (let i = 0; i < n; i++) {
    if (r16(ifdOff + 2 + i * 12) === ICC_TAG) return tiffBlob;
  }

  // IFD body ends after: 2 (count) + n×12 (entries) + 4 (next-IFD ptr)
  const ifdBodyEnd = ifdOff + 2 + n * 12 + 4;

  // New layout: original bytes shifted +12 (one extra entry) + ICC profile appended at end
  const iccDataOffset = raw.length + 12;
  const out = new Uint8Array(raw.length + 12 + profile.length);

  const w16 = (off: number, v: number) => {
    if (isBE) { out[off] = (v >> 8) & 0xFF; out[off + 1] = v & 0xFF; }
    else { out[off] = v & 0xFF; out[off + 1] = (v >> 8) & 0xFF; }
  };
  const w32 = (off: number, v: number) => {
    v = v >>> 0;
    if (isBE) { out[off] = (v >> 24) & 0xFF; out[off + 1] = (v >> 16) & 0xFF; out[off + 2] = (v >> 8) & 0xFF; out[off + 3] = v & 0xFF; }
    else { out[off] = v & 0xFF; out[off + 1] = (v >> 8) & 0xFF; out[off + 2] = (v >> 16) & 0xFF; out[off + 3] = (v >> 24) & 0xFF; }
  };

  // Copy header + any pre-IFD data unchanged
  out.set(raw.subarray(0, ifdOff));

  // Write updated entry count
  w16(ifdOff, n + 1);

  // Find insertion index (IFD entries must be in ascending tag order)
  let insertAt = n;
  for (let i = 0; i < n; i++) {
    if (r16(ifdOff + 2 + i * 12) > ICC_TAG) { insertAt = i; break; }
  }

  // Bytes per value unit for each TIFF type
  const typeSizes: Record<number, number> = {
    1: 1, 2: 1, 3: 2, 4: 4, 5: 8,
    6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
  };

  // Tags whose value field is always a file offset, even when it fits inline (≤4 bytes).
  // Standard TIFF: the "value" of StripOffsets and TileOffsets IS a pointer into the file,
  // stored directly in the 4-byte IFD value field for single-strip/tile images.
  // These must be shifted by 12 when we insert an extra IFD entry.
  const inlineOffsetTags = new Set([273, 324]); // StripOffsets, TileOffsets

  // Copy all existing entries; entries at/after insertAt shift one slot down (+12 bytes)
  for (let i = 0; i < n; i++) {
    const src = ifdOff + 2 + i * 12;
    const dst = i < insertAt ? ifdOff + 2 + i * 12 : ifdOff + 2 + (i + 1) * 12;

    const tag   = r16(src);
    const type  = r16(src + 2);
    const count = r32(src + 4);
    let   val   = r32(src + 8);

    // Shift file offsets that point to data beyond the old IFD body.
    // Two cases:
    //   (a) value is an external pointer because data doesn't fit in 4 bytes
    //   (b) value is an inline file offset (StripOffsets / TileOffsets with count=1)
    const typeSize = typeSizes[type] ?? 1;
    const isExternalPtr = count * typeSize > 4;
    const isInlineOffset = inlineOffsetTags.has(tag);
    if ((isExternalPtr || isInlineOffset) && val >= ifdBodyEnd) val += 12;

    w16(dst,     tag);
    w16(dst + 2, type);
    w32(dst + 4, count);
    w32(dst + 8, val);
  }

  // Write new ICC entry
  const ieOff = ifdOff + 2 + insertAt * 12;
  w16(ieOff,     ICC_TAG);
  w16(ieOff + 2, 7);               // type = UNDEFINED (1 byte/unit)
  w32(ieOff + 4, profile.length);  // count = byte count
  w32(ieOff + 8, iccDataOffset);   // value = file offset of ICC data

  // Write next-IFD pointer (0 = end of IFD chain)
  w32(ifdOff + 2 + (n + 1) * 12, 0);

  // Copy original data that followed the IFD body, shifted +12
  out.set(raw.subarray(ifdBodyEnd), ifdBodyEnd + 12);

  // Append ICC profile
  out.set(profile, iccDataOffset);

  return new Blob([out], { type: 'image/tiff' });
}

export interface ColorSpaceOptions {
  embedIccProfile?: boolean;  // Whether to embed sRGB ICC profile (default: true for POD)
  colorSpace?: 'srgb' | 'display-p3' | 'adobe-rgb';  // Color space (only sRGB implemented)
}

export const DEFAULT_COLOR_SPACE_OPTIONS: ColorSpaceOptions = {
  embedIccProfile: true,
  colorSpace: 'srgb'
};
