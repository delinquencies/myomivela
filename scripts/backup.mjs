// Usage: node scripts/backup.mjs <destination.sqlite>
// Writes a consistent copy of the live database (safe while the server runs) and checks it.
// Restore by stopping the server and copying the backup over MYO_DB (default .myo/data.sqlite).
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve(process.env.MYO_DB || '.myo/data.sqlite');
const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination) { console.error('Usage: node scripts/backup.mjs <destination.sqlite>'); process.exit(2); }
if (!existsSync(source)) { console.error('No database at ' + source); process.exit(1); }
if (existsSync(destination)) { console.error('Refusing to overwrite ' + destination); process.exit(1); }

const db = new DatabaseSync(source);
db.prepare('VACUUM INTO ?').run(destination);
db.close();

const copy = new DatabaseSync(destination, { readOnly: true });
const check = copy.prepare('PRAGMA integrity_check').get().integrity_check;
const { user_version } = copy.prepare('PRAGMA user_version').get();
copy.close();
if (check !== 'ok') { console.error('Backup failed its integrity check: ' + check); process.exit(1); }
console.log('Backup written to ' + destination + ' (schema version ' + user_version + ').');
