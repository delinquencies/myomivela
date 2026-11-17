// Removes embedded metadata (EXIF GPS, XMP, text chunks, comments) from uploaded images.
// A JPEG's EXIF orientation is kept as the only EXIF tag so phone photos still display upright.

const ORIENTATION_TAG = 0x0112;

function jpegOrientation(bytes, start, end) {
  // `start` points at the "Exif\0\0" signature inside an APP1 segment.
  const tiff = start + 6;
  if (tiff + 8 > end) return 0;
  const little = bytes.toString('ascii', tiff, tiff + 2) === 'II';
  if (!little && bytes.toString('ascii', tiff, tiff + 2) !== 'MM') return 0;
  const u16 = at => at + 2 <= end ? (little ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at)) : -1;
  const u32 = at => at + 4 <= end ? (little ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at)) : -1;
  const ifd = u32(tiff + 4);
  if (ifd < 8) return 0;
  const count = u16(tiff + ifd);
  for (let i = 0; i < count && i < 256; i++) {
    const entry = tiff + ifd + 2 + i * 12;
    if (u16(entry) === ORIENTATION_TAG) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 0;
    }
  }
  return 0;
}

function orientationSegment(orientation) {
  const tiff = Buffer.from([0x4d,0x4d,0x00,0x2a,0,0,0,8, 0,1, 0x01,0x12,0,3,0,0,0,1, 0,orientation,0,0, 0,0,0,0]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0','latin1'), tiff]);
  const header = Buffer.from([0xff,0xe1,0,0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

export function stripJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not a JPEG.');
  const kept = [bytes.subarray(0, 2)];
  let orientation = 0;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) throw new Error('Corrupt JPEG.');
    const marker = bytes[at + 1];
    if (marker === 0xff) { at++; continue; }
    if (marker === 0xda) { kept.push(bytes.subarray(at)); at = bytes.length; break; } // scan data to end
    if (marker === 0xd9) { kept.push(bytes.subarray(at, at + 2)); at = bytes.length; break; }
    if (marker >= 0xd0 && marker <= 0xd7 || marker === 0x01) { kept.push(bytes.subarray(at, at + 2)); at += 2; continue; }
    const length = bytes.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > bytes.length) throw new Error('Corrupt JPEG.');
    const segment = bytes.subarray(at, at + 2 + length);
    const isExif = marker === 0xe1 && bytes.toString('latin1', at + 4, at + 10) === 'Exif\0\0';
    if (isExif) orientation ||= jpegOrientation(bytes, at + 4, at + 2 + length);
    // Keep only the JFIF header (APP0), ICC profiles (APP2) and the image data structure; drop EXIF/XMP/IPTC/comments.
    const keep = marker === 0xe0 || (marker === 0xe2 && bytes.toString('latin1', at + 4, at + 15) === 'ICC_PROFILE')
      || !(marker >= 0xe1 && marker <= 0xef && marker !== 0xee || marker === 0xfe);
    if (keep) kept.push(segment);
    at += 2 + length;
  }
  if (at < bytes.length && at !== 0) throw new Error('Corrupt JPEG.');
  const out = kept;
  if (orientation > 1) {
    const insertAt = out.length > 1 && out[1][1] === 0xe0 ? 2 : 1;
    out.splice(insertAt, 0, orientationSegment(orientation));
  }
  return Buffer.concat(out);
}

const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
export function stripPng(bytes) {
  const kept = [bytes.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const end = at + 12 + length;
    if (end > bytes.length) throw new Error('Corrupt PNG.');
    if (!PNG_DROP.has(bytes.toString('ascii', at + 4, at + 8))) kept.push(bytes.subarray(at, end));
    at = end;
  }
  if (at !== bytes.length) throw new Error('Corrupt PNG.');
  return Buffer.concat(kept);
}

export function stripWebp(bytes) {
  const kept = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const type = bytes.toString('ascii', at, at + 4);
    const length = bytes.readUInt32LE(at + 4);
    const end = at + 8 + length + (length & 1);
    if (end > bytes.length + 1) throw new Error('Corrupt WebP.');
    const chunk = Buffer.from(bytes.subarray(at, Math.min(end, bytes.length)));
    if (type === 'VP8X') chunk[8] &= ~0x0c; // clear the EXIF and XMP presence flags
    if (type !== 'EXIF' && type !== 'XMP ') kept.push(chunk);
    at = end;
  }
  const body = Buffer.concat(kept);
  const header = Buffer.from(bytes.subarray(0, 12));
  header.writeUInt32LE(body.length + 4, 4);
  return Buffer.concat([header, body]);
}

export function stripMetadata(mime, bytes) {
  return mime === 'image/jpeg' ? stripJpeg(bytes) : mime === 'image/png' ? stripPng(bytes) : stripWebp(bytes);
}
