// Home access and key custody (C2.3). Entry instructions are encrypted at rest (lib/vault.mjs) and shown to staff
// only for a visit that is under way or about to start; every reveal is logged.
import { get, run } from '../db.mjs';
import { requireThat, field, integer } from '../validate.mjs';
import { encrypt, decrypt } from '../vault.mjs';
import { earlyStartMinutes } from '../scheduling.mjs';

const methods = ['key','lockbox','code','doorman','other'];
const keyStatuses = ['with_client','with_myomi','returned'];
const log = (owner, actor, action) => run('INSERT INTO home_access_log(owner,actor,action,at) VALUES(?,?,?,?)', owner, actor, action, Date.now());

// The decrypted record for a customer, or null. A record still sealed with the previous key is re-sealed with the current one.
async function readAccess(owner) {
  const row = get('SELECT * FROM home_access WHERE owner=?', owner);
  if (!row) return null;
  let instructions = '';
  if (row.secret_enc) {
    const opened = await decrypt(owner, row.secret_enc, row.iv);
    instructions = opened.plaintext;
    if (opened.rotated) {
      const sealed = await encrypt(owner, instructions);
      run('UPDATE home_access SET secret_enc=?, iv=? WHERE owner=? AND secret_enc=?', sealed.secret_enc, sealed.iv, owner, row.secret_enc);
    }
  }
  return { method:row.method, instructions, key_label:row.key_label, key_status:row.key_status, updated:row.updated };
}

export default [
  { method:'GET', path:'/api/home-access', access:'user', handler:({ user }) => {
    requireThat(!user.admin, 'Staff read entry details from a visit.', 403);
    return readAccess(user.id);
  } },

  // Not idempotency-keyed: nothing derived from the instructions is stored outside the vault.
  { method:'POST', path:'/api/home-access', access:'user', idempotent:false, handler:async ({ user, data }) => {
    requireThat(!user.admin, 'Use a customer account to save entry details.', 403);
    requireThat(methods.includes(data.method), 'Choose how Myomi gets in.', 400, 'invalid_method');
    const instructions = field(data.instructions ?? '', 1000, false);
    const label = data.key_label == null || data.key_label === '' ? null : field(data.key_label, 40);
    const sealed = instructions ? await encrypt(user.id, instructions) : { secret_enc:null, iv:null };
    run(`INSERT INTO home_access(owner,method,secret_enc,iv,key_label,updated) VALUES(?,?,?,?,?,?)
      ON CONFLICT(owner) DO UPDATE SET method=excluded.method, secret_enc=excluded.secret_enc, iv=excluded.iv,
      key_label=excluded.key_label, updated=excluded.updated`, user.id, data.method, sealed.secret_enc, sealed.iv, label, Date.now());
    log(user.id, user.id, 'update');
    return {};
  } },

  // Staff see the instructions for a visit that is in progress, or confirmed and within the early-start window.
  { method:'GET', path:/^\/api\/home-access\/booking\/(\d+)$/, access:'staff', handler:async ({ user, match }) => {
    const booking = get('SELECT * FROM bookings WHERE id=?', Number(match[1]));
    requireThat(booking, 'Booking not found.', 404);
    const from = booking.starts - earlyStartMinutes() * 60_000;
    const open = booking.status === 'In Progress' || (booking.status === 'Confirmed' && Date.now() >= from);
    requireThat(open, booking.status === 'Confirmed' ? 'Entry details unlock shortly before the visit.' : 'Entry details are only shown for a current visit.',
      403, 'access_not_yet', { available_from:booking.status === 'Confirmed' ? from : null });
    const access = await readAccess(booking.owner);
    requireThat(access, 'This customer hasn’t saved entry details.', 404, 'not_set');
    log(booking.owner, user.id, 'view');
    return { method:access.method, instructions:access.instructions, key_label:access.key_label, key_status:access.key_status };
  } },

  // Where the customer's key is. Works without saved instructions (a key alone).
  { method:'POST', path:'/api/keys', access:'staff', handler:({ user, data }) => {
    const owner = integer(data.owner);
    requireThat(get('SELECT id FROM users WHERE id=? AND admin=0', owner), 'Customer not found.', 404);
    requireThat(keyStatuses.includes(data.key_status), 'Choose where the key is.', 400, 'invalid_key_status');
    run(`INSERT INTO home_access(owner,method,key_status,updated) VALUES(?,'key',?,?)
      ON CONFLICT(owner) DO UPDATE SET key_status=excluded.key_status, updated=excluded.updated`, owner, data.key_status, Date.now());
    log(owner, user.id, 'key_status');
    return {};
  } },
];
