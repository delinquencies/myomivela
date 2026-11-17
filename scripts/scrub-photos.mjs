// Usage: node scripts/scrub-photos.mjs [--apply]
// Removes EXIF/XMP/text metadata from photos that were stored before upload-time stripping existed.
// Dry run by default. Take a backup first (npm run backup -- <file>) before using --apply.
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { stripMetadata } from '../lib/image.mjs';

const apply = process.argv.includes('--apply');
const db = new DatabaseSync(resolve(process.env.MYO_DB || '.myo/data.sqlite'));
let changed = 0, failed = 0, total = 0;
db.exec('BEGIN IMMEDIATE');
try {
  for (const { id, mime, photo } of db.prepare('SELECT id,mime,photo FROM events WHERE photo IS NOT NULL').all()) {
    total++;
    try {
      const clean = stripMetadata(mime, Buffer.from(photo));
      if (!clean.equals(photo)) {
        changed++;
        if (apply) db.prepare('UPDATE events SET photo=? WHERE id=?').run(clean, id);
      }
    } catch { failed++; console.error('Could not parse photo for event ' + id + '; left unchanged.'); }
  }
  db.exec(apply ? 'COMMIT' : 'ROLLBACK');
} catch (error) { db.exec('ROLLBACK'); throw error; }
console.log((apply ? 'Scrubbed ' : 'Would scrub ') + changed + ' of ' + total + ' photos (' + failed + ' unreadable).');
