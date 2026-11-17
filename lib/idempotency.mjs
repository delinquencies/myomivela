// Safe retries for signed-in writes. The portal sends an Idempotency-Key header with each form submission and
// reuses it when it retries after a network failure. The first request with a key runs; a repeat gets the
// stored response instead of running again. Only successes are stored, so a refused request can be fixed and
// resent with the same key. Keys are per user and expire after a day.
import { get, run } from './db.mjs';
import { requireThat } from './validate.mjs';
import { hash } from './auth.mjs';

const keepFor = 24 * 60 * 60_000;
// A claim with no stored response is a request still running. If it is older than this, its process died
// before finishing (a crash or a Durable Object restart), and a retry may take it over.
const abandonedAfter = 60_000;
export const validKey = key => /^[\w-]{16,100}$/.test(key);

// Returns null when this request should run (the key is now claimed), or the stored { status, body } to replay.
export function claim(user, key, path, data) {
  requireThat(validKey(key), 'Invalid Idempotency-Key header.');
  const fingerprint = hash(path + '\n' + JSON.stringify(data));
  const now = Date.now();
  run('DELETE FROM idempotency WHERE created<?', now - keepFor);
  const existing = get('SELECT * FROM idempotency WHERE user=? AND key=?', user.id, key);
  if (existing) {
    requireThat(existing.fingerprint === fingerprint, 'This retry does not match the original request. Submit the form again.', 422);
    if (existing.status !== null) return { status:existing.status, body:existing.body };
    requireThat(existing.created < now - abandonedAfter, 'This request is still being processed. Wait a moment and refresh.', 409);
    run('UPDATE idempotency SET created=? WHERE user=? AND key=?', now, user.id, key);
    return null;
  }
  run('INSERT INTO idempotency(user,key,fingerprint,created) VALUES(?,?,?,?)', user.id, key, fingerprint, now);
  return null;
}
export function complete(user, key, status, body) {
  run('UPDATE idempotency SET status=?, body=? WHERE user=? AND key=?', status, body, user.id, key);
}
export function release(user, key) {
  run('DELETE FROM idempotency WHERE user=? AND key=? AND status IS NULL', user.id, key);
}
