// Scheduled backups: once a day the whole installation (the same file as "Download backup") is written to a second
// place, so a lost or damaged database can be restored without anyone having remembered to download one. The newest
// MYO_BACKUP_KEEP (30) are kept. The file is built in memory first (R2 needs its length), which is fine for a
// one-sitter business; a very large photo library would need a multipart upload instead.
import { get, run, backupStore } from './db.mjs';
import { backupStream } from './backup.mjs';
import { config } from './config.mjs';
import { requireThat } from './validate.mjs';

const dayMs = 86_400_000;
export const backupNamePattern = /^myo-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d{3}\.json\.gz$/;
export const backupName = now => 'myo-backup-' + new Date(now).toISOString().slice(0, 23).replace(/[T:.]/g, '-') + '.json.gz';
const meta = key => get('SELECT value FROM meta WHERE key=?', key)?.value ?? null;
const setMeta = (key, value) => run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));

export const backupsEnabled = () => Boolean(backupStore());
export async function listBackups() {
  const store = backupStore();
  if (!store) return [];
  return (await store.list()).filter(item => backupNamePattern.test(item.name)).sort((a, b) => b.name.localeCompare(a.name));
}
export function backupStatus() {
  const last = meta('last_backup');
  return { enabled:backupsEnabled(), keep:config.backupKeep, last_backup:last ? Number(last) : null, last_error:meta('last_backup_error') };
}

export async function runBackup(now = Date.now()) {
  const store = backupStore();
  requireThat(store, 'Scheduled backups are not set up.', 503, 'backups_unconfigured');
  setMeta('last_backup_attempt', now);
  try {
    const bytes = new Uint8Array(await new Response(backupStream()).arrayBuffer());
    const name = backupName(now);
    await store.put(name, bytes);
    setMeta('last_backup', now);
    run("DELETE FROM meta WHERE key='last_backup_error'");
    for (const old of (await listBackups()).slice(config.backupKeep)) await store.delete(old.name);
    return { name, size:bytes.length };
  } catch (error) {
    setMeta('last_backup_error', new Date(now).toISOString() + ': ' + String(error.message || error).slice(0, 300));
    throw error;
  }
}
// Called by the runtimes' timers: makes a backup when the last one is a day old, retrying a failure hourly.
export async function backupIfDue(now = Date.now()) {
  if (!backupsEnabled()) return null;
  const last = Number(meta('last_backup') || 0), attempt = Number(meta('last_backup_attempt') || 0);
  return now - last >= dayMs && now - attempt >= 60 * 60_000 ? runBackup(now) : null;
}
