// Staff settings: service prices, published availability windows, and backup and restore.
import { run, photos } from '../db.mjs';
import { requireThat, field, integer } from '../validate.mjs';
import { serviceNames } from '../domain.mjs';
import { backupStream, requireEmptyInstallation, restoreTables, photoKeyPattern } from '../backup.mjs';
import { photoFrom } from '../photos.mjs';
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
    requireThat(serviceNames.includes(name),'Select one of the three care services.');
    run('INSERT INTO services(name,minutes,cents) VALUES(?,?,?) ON CONFLICT(name,minutes) DO UPDATE SET cents=excluded.cents',name,integer(data.minutes,1440),integer(data.cents,1000000,0));
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
    run('INSERT INTO schedule_settings VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET days=excluded.days,opens=excluded.opens,closes=excluded.closes,buffer=excluded.buffer',
      days,...hoursFor(data),integer(data.buffer,180,0));
    return {};
  } },

  { method:'POST', path:'/api/schedule-exception', access:'staff', handler:({ data }) => {
    const day = field(data.day,10);
    const date = new Date(day+'T12:00:00Z');
    requireThat(/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(+date) && date.toISOString().slice(0,10) === day,'Choose a valid date.');
    requireThat(['closed','custom','reset'].includes(data.mode),'Choose how to adjust this date.');
    if(data.mode === 'reset') run('DELETE FROM schedule_exceptions WHERE day=?',day);
    else run('INSERT INTO schedule_exceptions VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET opens=excluded.opens,closes=excluded.closes',
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

  // Restore, used by scripts/restore.mjs: photos first, one per request, then all tables at once.
  // Both refuse once customer data exists, so a restore can only fill a new installation.
  { method:'POST', path:'/api/restore/photo', access:'staff', idempotent:false, handler:async ({ data }) => {
    requireEmptyInstallation();
    requireThat(typeof data.key === 'string' && photoKeyPattern.test(data.key), 'Invalid photo key.');
    const [mime,bytes] = photoFrom(data.photo); // re-validates the image and strips metadata again
    requireThat(bytes, 'Missing photo.');
    await photos.put(data.key, bytes, mime);
    return {};
  } },
  { method:'POST', path:'/api/restore', access:'staff', idempotent:false, maxBody:50_000_000, handler:({ data }) => ({ restored:restoreTables(data) }) },
];
