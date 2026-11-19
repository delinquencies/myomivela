// Whole-installation backup and restore, identical on both runtimes.
// Format: gzip-compressed JSON { format, version, schema_version, created, tables: { name: [rows] }, photos: { key: dataURL } }.
// Sessions are not included (a restore signs everyone out). The file contains password hashes: keep it private.
import { all, get, run, transaction, photos, schemaVersion } from './db.mjs';
import { requireThat } from './validate.mjs';

export const backupFormat = 'myo-backup';
// Parent tables first: the order rows are inserted on restore (and deleted in reverse).
export const backupTables = ['users','services','slots','pets','recurring_series','series_skips','packages','package_balances','bookings','booking_pets','events','schedule_settings','schedule_exceptions','booking_lines','booking_changes',
  'vaccine_requirements','pet_vaccines','agreements','agreement_acceptances',
  'home_access','home_access_log', // home_access holds ciphertext only: restoring needs the same MYO_VAULT_KEY
  'pet_profile_versions','visit_feedback','staff_notes','care_intakes','fee_rules','holidays',
  'ledger_entries','checkout_sessions','payment_events','outbox'];
const columnsOf = table => all(`PRAGMA table_info(${table})`).map(column => column.name)
  .filter(name => !(table === 'events' && name === 'photo')); // legacy BLOB column, never read

// Reads every table in one synchronous pass (a consistent snapshot), then streams photos one at a time.
export function backupStream() {
  const tables = Object.fromEntries(backupTables.map(table =>
    [table, all(`SELECT ${columnsOf(table).join(',')} FROM ${table} ORDER BY rowid`)]));
  // Every stored file: diary photos and vaccine documents.
  const keys = [
    ...tables.events.filter(event => event.photo_key).map(event => [event.photo_key, event.mime]),
    ...tables.pet_vaccines.filter(record => record.document_key).map(record => [record.document_key, record.document_mime]),
  ];
  const head = { format:backupFormat, version:1, schema_version:schemaVersion, created:new Date().toISOString(), tables };
  const encoder = new TextEncoder();
  let index = -1;
  return new ReadableStream({
    async pull(controller) {
      if (index === -1) {
        controller.enqueue(encoder.encode(JSON.stringify(head).slice(0, -1) + ',"photos":{'));
      } else if (index < keys.length) {
        const [key, mime] = keys[index];
        const bytes = await photos.get(key);
        // A missing photo is recorded as null so the restore can report it rather than fail silently.
        const value = bytes ? 'data:' + mime + ';base64,' + Buffer.from(bytes).toString('base64') : null;
        controller.enqueue(encoder.encode((index ? ',' : '') + JSON.stringify(key) + ':' + JSON.stringify(value)));
      } else {
        controller.enqueue(encoder.encode('}}'));
        controller.close();
      }
      index++;
    },
  }).pipeThrough(new CompressionStream('gzip'));
}

// Restore is only for a fresh installation: no customers, pets, bookings or diary updates yet.
// That makes it impossible to overwrite real data by mistake.
export function requireEmptyInstallation() {
  const used = get('SELECT EXISTS(SELECT 1 FROM users WHERE admin=0) OR EXISTS(SELECT 1 FROM pets) OR EXISTS(SELECT 1 FROM bookings) OR EXISTS(SELECT 1 FROM events) AS used').used;
  requireThat(!used, 'This installation already has customer data. Restore only into a new, empty installation.', 409);
}

export const photoKeyPattern = /^(events|vaccines)\/[0-9a-f-]{36}$/;

// Replaces every table with the backup's rows in one transaction and signs everyone out.
export function restoreTables(backup) {
  requireThat(backup?.format === backupFormat && backup.version === 1, 'This is not a myo. backup file.');
  requireThat(backup.schema_version === schemaVersion,
    'This backup is from schema version ' + backup.schema_version + '; this installation is at ' + schemaVersion + '. Restore it with the matching version of myo.', 409);
  const tables = backup.tables || {};
  for (const table of backupTables) requireThat(Array.isArray(tables[table]), 'The backup is missing the ' + table + ' table.');
  requireThat(tables.users.some(user => user.admin), 'The backup has no staff account.');
  return transaction(() => {
    requireEmptyInstallation();
    run('DELETE FROM sessions');
    run('DELETE FROM idempotency');
    run('DELETE FROM trusted_devices');
    run('DELETE FROM checkout_holds');
    run('DELETE FROM password_resets'); // reset links are never restored: everyone signs in again
    for (const table of [...backupTables].reverse()) run(`DELETE FROM ${table}`);
    const counts = {};
    for (const table of backupTables) {
      const known = new Set(columnsOf(table));
      for (const row of tables[table]) {
        const names = Object.keys(row).filter(name => known.has(name));
        run(`INSERT INTO ${table}(${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`, ...names.map(name => row[name]));
      }
      counts[table] = tables[table].length;
    }
    return counts;
  });
}
