// Turns an uploaded data URL into [mime, bytes] with metadata removed, or [null, null] when there is no photo.
import { requireThat } from './validate.mjs';
import { stripMetadata } from './image.mjs';

export function photoFrom(data) {
  if (!data) return [null,null];
  requireThat(typeof data === 'string', 'Use a JPEG, PNG, or WebP photo.');
  const match = data.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  requireThat(match, 'Use a JPEG, PNG, or WebP photo.');
  const bytes = Buffer.from(match[2], 'base64');
  const mime = match[1];
  const valid = mime === 'image/jpeg' ? bytes.subarray(0,3).toString('hex') === 'ffd8ff'
    : mime === 'image/png' ? bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a'
    : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  requireThat(valid && bytes.length <= 2_500_000, 'Use a valid photo smaller than 2.5 MB.');
  // Remove location and device metadata so a photo never reveals more than its pixels.
  try { return [mime,stripMetadata(mime,bytes)]; } catch { requireThat(false, 'Use a valid photo smaller than 2.5 MB.'); }
}
