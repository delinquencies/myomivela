import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, adminLogin, password, iso, nodeOnly } from './helpers.mjs';

// Home-access vault and key custody (C2.3), with the real early-start rule (30 minutes). Both runtimes.
let app, service, pet;
const call = (...args) => app.call(...args);
const minute = 60_000;
const secret = 'Lockbox 4821 behind the planter';
const ok = async promise => { const r = await promise; assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
async function confirmedAt(minutesAhead) {
  const starts = Math.ceil((Date.now() + minutesAhead * minute) / minute) * minute;
  await ok(call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + 60 * minute) }));
  const window_ = (await call('staff','GET','/api/portal')).json.windows.find(w => w.starts === starts);
  const booking = await ok(call('ann','POST','/api/bookings',{ service:service.id, cents:service.cents, pets:[pet], slot:window_.id, start:starts, notes:'' }));
  await ok(call('staff','POST','/api/status',{ id:booking.id, status:'Confirmed' }));
  return booking.id;
}

before(async () => {
  app = await startServer({ MYO_EARLY_START_MINUTES:'' });
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  for (const name of ['ann','bob']) await call(name,'POST','/api/register',{ name, email:name + '@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'' });
  const data = (await call('ann','GET','/api/portal')).json;
  [service, pet] = [data.services[0], data.pets[0].id];
});
after(() => app.stop());

test('the customer saves and reads entry details; nobody else can, and they never leave the vault', async () => {
  assert.equal((await call('ann','GET','/api/home-access')).json, null);
  await ok(call('ann','POST','/api/home-access',{ method:'lockbox', instructions:secret, key_label:'Front door' }));
  const mine = await ok(call('ann','GET','/api/home-access'));
  assert.deepEqual([mine.method, mine.instructions, mine.key_label, mine.key_status], ['lockbox', secret, 'Front door', 'with_client']);
  assert.equal((await call('bob','GET','/api/home-access')).json, null, 'another customer sees only their own (none)');
  assert.equal((await call('staff','GET','/api/home-access')).status, 403, 'staff read entry details through a visit');
  assert.equal((await call('ann','POST','/api/home-access',{ method:'teleport', instructions:'x' })).json.code, 'invalid_method');
  const backup = gunzipSync((await call('staff','GET','/api/backup')).bytes).toString();
  assert.ok(!backup.includes('4821'), 'the backup holds ciphertext only');
});

test('staff see entry details only for a visit under way or about to start, and each reveal is logged', async () => {
  const later = await confirmedAt(180);
  const early = await call('staff','GET','/api/home-access/booking/' + later);
  assert.equal(early.status, 403);
  assert.equal(early.json.code, 'access_not_yet');
  const laterStarts = (await call('staff','GET','/api/portal')).json.bookings.find(b => b.id === later).starts;
  assert.equal(early.json.available_from, laterStarts - 30 * minute, 'details unlock 30 minutes before the visit');
  const staffPortal = JSON.stringify((await call('staff','GET','/api/portal')).json);
  assert.ok(!staffPortal.includes('4821'), 'the staff portal shows how, never the instructions');
  assert.deepEqual((await call('staff','GET','/api/portal')).json.bookings.find(b => b.id === later).home_access, { method:'lockbox', key_status:'with_client' });
  const soon = await confirmedAt(10);
  const revealed = await ok(call('staff','GET','/api/home-access/booking/' + soon));
  assert.equal(revealed.instructions, secret, 'within the 30-minute window before the visit');
  assert.equal((await call('staff','POST','/api/status',{ id:soon, status:'In Progress' })).status, 200);
  assert.equal((await ok(call('staff','GET','/api/home-access/booking/' + soon))).instructions, secret);
  assert.equal((await call('ann','GET','/api/home-access/booking/' + soon)).status, 403, 'customers can’t use the staff route');
});

test('key custody and the keys-to-return list', async () => {
  const bobId = (await call('bob','GET','/api/session')).json.id;
  await ok(call('staff','POST','/api/keys',{ owner:bobId, key_status:'with_myomi' }));
  assert.deepEqual((await call('staff','GET','/api/portal')).json.keys_to_return.map(k => k.customer), ['bob'], 'bob has no upcoming visit');
  assert.equal((await call('bob','GET','/api/home-access')).json.key_status, 'with_myomi');
  await ok(call('staff','POST','/api/keys',{ owner:bobId, key_status:'returned' }));
  assert.deepEqual((await call('staff','GET','/api/portal')).json.keys_to_return, []);
  assert.equal((await call('staff','POST','/api/keys',{ owner:bobId, key_status:'lost' })).json.code, 'invalid_key_status');
  const annId = (await call('ann','GET','/api/session')).json.id;
  await ok(call('staff','POST','/api/keys',{ owner:annId, key_status:'with_myomi' }));
  assert.ok(!(await call('staff','GET','/api/portal')).json.keys_to_return.some(k => k.owner === annId), 'ann still has visits booked');
  assert.equal((await call('ann','GET','/api/home-access')).json.instructions, secret, 'changing key status keeps the instructions');
});

test('without a vault key the details can’t be saved', async () => {
  const bare = await startServer({ MYO_VAULT_KEY:'' });
  try {
    await bare.call('c','POST','/api/register',{ name:'c', email:'c@example.test', password });
    const refused = await bare.call('c','POST','/api/home-access',{ method:'code', instructions:'1234' });
    assert.equal(refused.status, 503);
    assert.equal(refused.json.code, 'vault_unconfigured');
  } finally { await bare.stop(); }
});

test('rotating the key: the previous key still opens records, which are re-sealed with the new one', { skip:nodeOnly }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myo-vault-'));
  const path = join(dir, 'vault.sqlite');
  const keyA = Buffer.from('A'.repeat(32)).toString('base64'), keyB = Buffer.from('B'.repeat(32)).toString('base64');
  let server = await startServer({ MYO_VAULT_KEY:keyA }, { dbPath:path });
  await server.call('c','POST','/api/register',{ name:'c', email:'c@example.test', password });
  await server.call('c','POST','/api/home-access',{ method:'code', instructions:'Door code 2580' });
  await server.stop();
  const sealedA = new DatabaseSync(path).prepare('SELECT secret_enc FROM home_access').get().secret_enc;
  assert.ok(!sealedA.includes('2580'));
  server = await startServer({ MYO_VAULT_KEY:keyB }, { dbPath:path });
  await server.call('c','POST','/api/login',{ email:'c@example.test', password });
  assert.equal((await server.call('c','GET','/api/home-access')).json.code, 'vault_decrypt_failed', 'the new key alone can’t open it');
  await server.stop();
  server = await startServer({ MYO_VAULT_KEY:keyB, MYO_VAULT_KEY_PREVIOUS:keyA }, { dbPath:path });
  await server.call('c','POST','/api/login',{ email:'c@example.test', password });
  assert.equal((await server.call('c','GET','/api/home-access')).json.instructions, 'Door code 2580');
  await server.stop();
  server = await startServer({ MYO_VAULT_KEY:keyB }, { dbPath:path });
  try {
    await server.call('c','POST','/api/login',{ email:'c@example.test', password });
    assert.equal((await server.call('c','GET','/api/home-access')).json.instructions, 'Door code 2580', 're-sealed with the new key');
  } finally { await server.stop(); await rm(dir, { recursive:true, force:true }); }
});
