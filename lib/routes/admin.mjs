// Staff settings: service prices, published availability windows, and backup and restore.
import { get, run, photos } from '../db.mjs';
import { requireThat, field, integer } from '../validate.mjs';
import { serviceNames, serviceKind } from '../domain.mjs';
import { backupStream, requireEmptyInstallation, restoreTables, photoKeyPattern } from '../backup.mjs';
import { photoFrom, documentFrom } from '../photos.mjs';
import { backupStore } from '../db.mjs';
import { backupStatus, listBackups, runBackup, backupNamePattern } from '../scheduled-backup.mjs';
const clockMinutes = value => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || '');
  requireThat(match,'Enter a valid time.');
  return Number(match[1])*60+Number(match[2]);
};
function hoursFor(data) {
  const opens = clockMinutes(data.opens), closes = clockMinutes(data.closes);
  requireThat(closes>opens,'Closing time must be after opening time.');
  return [opens,closes];
}

export default [
  { method:'POST', path:'/api/services', access:'staff', handler:({ data }) => {
    const name = field(data.name,80);
    requireThat(serviceNames.includes(name),'Select one of the care services.');
    const kind = serviceKind(name);
    const cents = integer(data.cents,1000000,0);
    const extraPet = data.extra_pet_cents === undefined ? 0 : integer(data.extra_pet_cents,100000,0);
    // A meet & greet is always free, so it never needs payment and never shows a price.
    requireThat(kind !== 'meet' || (cents === 0 && extraPet === 0),'A Meet & Greet is free: set its price to 0.',400,'meet_is_free');
    // Cancellation terms (C3.2) are optional here; when absent, a new service gets the defaults and an existing one keeps its own.
    const minutes = integer(data.minutes,1440);
    const current = get('SELECT cancel_cutoff_hours, cancel_fee_percent FROM services WHERE name=? AND minutes=?',name,minutes) || { cancel_cutoff_hours:24, cancel_fee_percent:0 };
    const cutoff = data.cancel_cutoff_hours === undefined ? current.cancel_cutoff_hours : integer(data.cancel_cutoff_hours,336,0);
    const feePercent = data.cancel_fee_percent === undefined ? current.cancel_fee_percent : integer(data.cancel_fee_percent,100,0);
    run(`INSERT INTO services(name,minutes,cents,extra_pet_cents,kind,cancel_cutoff_hours,cancel_fee_percent) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(name,minutes) DO UPDATE SET cents=excluded.cents,extra_pet_cents=excluded.extra_pet_cents,kind=excluded.kind,
      cancel_cutoff_hours=excluded.cancel_cutoff_hours,cancel_fee_percent=excluded.cancel_fee_percent`,
      name,minutes,cents,extraPet,kind,cutoff,kind === 'meet' ? 0 : feePercent);
    return {};
  } },

  { method:'POST', path:'/api/slots', access:'staff', handler:({ data }) => {
    if (data.id !== undefined) {
      run('DELETE FROM slots WHERE id=?',integer(data.id));
    } else {
      const starts = Date.parse(field(data.starts,48));
      const ends = Date.parse(field(data.ends,48));
      requireThat(starts > Date.now() && ends > starts && ends-starts <= 86_400_000,'Choose a future window up to 24 hours.');
      run('INSERT INTO slots(starts,ends) VALUES(?,?)',starts,ends);
    }
    return {};
  } },

  { method:'POST', path:'/api/schedule', access:'staff', handler:({ data }) => {
    requireThat(Array.isArray(data.days) && data.days.length <=7,'Choose the days you work.');
    const days = data.days.reduce((mask,day)=>mask | (1<<integer(day,6,0)),0);
    // Overnight settings (C2.1) are optional here; when absent, the saved values are kept.
    const current = get('SELECT overnight_days, late_pickup_grace FROM schedule_settings WHERE id=1') || { overnight_days:0, late_pickup_grace:120 };
    let overnight = current.overnight_days;
    if (data.overnight_days !== undefined) {
      requireThat(Array.isArray(data.overnight_days) && data.overnight_days.length <= 7,'Choose the nights you take overnight stays.');
      overnight = data.overnight_days.reduce((mask,day)=>mask | (1<<integer(day,6,0)),0);
    }
    const grace = data.late_pickup_grace === undefined ? current.late_pickup_grace : integer(data.late_pickup_grace,720,0);
    run(`INSERT INTO schedule_settings(id,days,opens,closes,buffer,overnight_days,late_pickup_grace) VALUES(1,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET days=excluded.days,opens=excluded.opens,closes=excluded.closes,buffer=excluded.buffer,
      overnight_days=excluded.overnight_days,late_pickup_grace=excluded.late_pickup_grace`,
      days,...hoursFor(data),integer(data.buffer,180,0),overnight,grace);
    return {};
  } },

  { method:'POST', path:'/api/schedule-exception', access:'staff', handler:({ data }) => {
    const day = field(data.day,10);
    const date = new Date(day+'T12:00:00Z');
    requireThat(/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(+date) && date.toISOString().slice(0,10) === day,'Choose a valid date.');
    requireThat(['closed','custom','reset'].includes(data.mode),'Choose how to adjust this date.');
    if(data.mode === 'reset') run('DELETE FROM schedule_exceptions WHERE day=?',day);
    else run('INSERT INTO schedule_exceptions(day,opens,closes) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET opens=excluded.opens,closes=excluded.closes',
      day,...(data.mode === 'closed' ? [null,null] : hoursFor(data)));
    return {};
  } },

  // Downloads the whole installation as one file (see lib/backup.mjs). It contains password hashes.
  { method:'GET', path:'/api/backup', access:'staff', handler:() => {
    const name = 'myo-backup-' + new Date().toISOString().slice(0,19).replace(/[T:]/g,'-') + '.json.gz';
    return new Response(backupStream(), { headers:{
      'Content-Type':'application/gzip', 'Content-Disposition':'attachment; filename="' + name + '"', 'Cache-Control':'no-store',
    } });
  } },

  // Scheduled backups: their status and stored files, a backup made now, and downloading one (for a restore).
  { method:'GET', path:'/api/backups', access:'staff', handler:async () => ({ ...backupStatus(), backups:await listBackups() }) },
  { method:'POST', path:'/api/backups/run', access:'staff', idempotent:false, handler:() => runBackup() },
  { method:'GET', path:/^\/api\/backups\/file\/([\w.-]+)$/, access:'staff', handler:async ({ match }) => {
    requireThat(backupNamePattern.test(match[1]) && backupStore(), 'Backup not found.', 404);
    const bytes = await backupStore().get(match[1]);
    requireThat(bytes, 'Backup not found.', 404);
    return new Response(bytes, { headers:{ 'Content-Type':'application/gzip', 'Content-Disposition':'attachment; filename="'+match[1]+'"', 'Cache-Control':'no-store' } });
  } },

  // Restore, used by scripts/restore.mjs: photos first, one per request, then all tables at once.
  // Both refuse once customer data exists, so a restore can only fill a new installation.
  { method:'POST', path:'/api/restore/photo', access:'staff', idempotent:false, handler:async ({ data }) => {
    requireEmptyInstallation();
    requireThat(typeof data.key === 'string' && photoKeyPattern.test(data.key), 'Invalid photo key.');
    // Re-validates the file: diary photos as photos, vaccine documents as documents (PDF or image).
    const [mime,bytes] = data.key.startsWith('vaccines/') ? documentFrom(data.photo) : photoFrom(data.photo);
    requireThat(bytes, 'Missing photo.');
    await photos.put(data.key, bytes, mime);
    return {};
  } },
  { method:'POST', path:'/api/restore', access:'staff', idempotent:false, maxBody:50_000_000, handler:({ data }) => ({ restored:restoreTables(data) }) },
];
