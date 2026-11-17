// Restores a backup made with "Download backup" (GET /api/backup) into a NEW, empty myo. installation.
//
//   MYO_STAFF_EMAIL=... MYO_STAFF_PASSWORD=... node scripts/restore.mjs <backup.json.gz> <site URL>
//
// The URL can be the live Cloudflare site, `npm run dev` (http://127.0.0.1:8787) or `npm start`.
// Sign in with the staff account of the target installation (from its MYO_ADMIN_* settings).
// The server refuses if the installation already has customers, pets, bookings or diary updates.
// Afterwards everyone, including you, is signed out; sign in again with the accounts from the backup.
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const [file, site] = process.argv.slice(2);
const { MYO_STAFF_EMAIL:email, MYO_STAFF_PASSWORD:password } = process.env;
if (!file || !site || !email || !password) {
  console.error('Usage: MYO_STAFF_EMAIL=... MYO_STAFF_PASSWORD=... node scripts/restore.mjs <backup.json.gz> <site URL>');
  process.exit(2);
}
const base = new URL(site).origin;
const backup = JSON.parse(gunzipSync(await readFile(file)));
if (backup.format !== 'myo-backup') { console.error(file + ' is not a myo. backup.'); process.exit(1); }

let cookie = '';
async function call(path, body) {
  const response = await fetch(base + path, {
    method:'POST', headers:{ 'Content-Type':'application/json', ...(cookie ? { cookie } : {}) }, body:JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(path + ' failed (' + response.status + '): ' + (result.error || 'no details'));
  return result;
}

try {
  await call('/api/login', { email, password });
  const entries = Object.entries(backup.photos || {});
  const missing = entries.filter(([, photo]) => !photo).map(([key]) => key);
  let sent = 0;
  for (const [key, photo] of entries) {
    if (!photo) continue;
    await call('/api/restore/photo', { key, photo });
    process.stdout.write('\rPhotos: ' + ++sent + ' of ' + (entries.length - missing.length));
  }
  if (sent) process.stdout.write('\n');
  const { restored } = await call('/api/restore', backup);
  console.log('Restored from ' + backup.created + ': ' + Object.entries(restored).map(([table, count]) => count + ' ' + table).join(', ') + '.');
  if (missing.length) console.warn('Warning: ' + missing.length + ' photo(s) were already missing when the backup was made: ' + missing.join(', '));
  console.log('Everyone has been signed out. Sign in with an account from the backup.');
} catch (error) {
  console.error('Restore failed: ' + error.message);
  process.exit(1);
}
