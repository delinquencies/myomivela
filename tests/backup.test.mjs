import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { gunzipSync, deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';

// Runs on both runtimes: download a backup from one installation and restore it into a fresh one.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let source, dir, archive, backup, photoBytes, visitId;

function png() { // a valid 1×1 PNG
  const table = Array.from({ length:256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = bytes => { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const check = Buffer.alloc(4); check.writeUInt32BE(crc(body)); return Buffer.concat([length, body, check]); };
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'), chunk('IHDR', Buffer.from([0,0,0,1,0,0,0,1,8,2,0,0,0])), chunk('IDAT', deflateSync(Buffer.from([0,255,0,0]))), chunk('IEND', Buffer.alloc(0))]);
}
const restore = (site, file) => spawnSync(process.execPath, [join(root, 'scripts', 'restore.mjs'), file, site], {
  env:{ ...process.env, MYO_STAFF_EMAIL:adminLogin.email, MYO_STAFF_PASSWORD:adminLogin.password }, encoding:'utf8', timeout:60_000,
});

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'myo-backup-test-'));
  source = await startServer();
  const { call } = source;
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Drop-in visit', minutes:30, cents:3500 });
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(2)) });
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Biscuit', species:'Dog', details:'{"profileVersion":1,"vet":"Main St"}' });
  const data = (await call('ann','GET','/api/portal')).json;
  const booking = await call('ann','POST','/api/bookings',{ service:data.services[0].id, cents:3500, pets:[data.pets[0].id], slot:data.slots[0].id, start:data.slots[0].starts, notes:'Side gate' });
  visitId = booking.json.id;
  for (const status of ['Confirmed','In Progress']) await call('staff','POST','/api/status',{ id:visitId, status });
  const photo = 'data:image/png;base64,' + png().toString('base64');
  assert.equal((await call('staff','POST','/api/events',{ id:visitId, pet:data.pets[0].id, kind:'Playtime', notes:'Fetch', photo })).status, 200);
  await call('staff','POST','/api/events',{ id:visitId, pet:data.pets[0].id, kind:'Water', notes:'Bowl filled' });
  await call('staff','POST','/api/status',{ id:visitId, status:'Completed', summary:'Happy dog' });
  const event = (await call('ann','GET','/api/diary')).json.events.find(e => e.has_photo);
  photoBytes = (await call('ann','GET','/api/photos/' + event.id)).bytes;
  const response = await call('staff','GET','/api/backup');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/gzip');
  assert.match(response.headers.get('content-disposition'), /attachment; filename="myo-backup-[\d-]+\.json\.gz"/);
  archive = join(dir, 'backup.json.gz');
  await writeFile(archive, response.bytes);
  backup = JSON.parse(gunzipSync(response.bytes));
});
after(async () => { await source.stop(); await rm(dir, { recursive:true, force:true }); });

test('the backup holds every table and photo, and no sessions', () => {
  assert.equal(backup.format, 'myo-backup');
  assert.equal(backup.schema_version, 6);
  assert.equal(backup.tables.users.length, 2);
  assert.ok(backup.tables.users.every(user => /^[0-9a-f]+:[0-9a-f]+$/.test(user.password)), 'password hashes kept so accounts still work');
  assert.equal(backup.tables.events.length, 2);
  assert.equal(backup.tables.bookings[0].summary, 'Happy dog');
  assert.equal('sessions' in backup.tables, false);
  const [key, value] = Object.entries(backup.photos)[0];
  assert.equal(backup.tables.events.find(e => e.photo_key).photo_key, key);
  assert.deepEqual(Buffer.from(value.split(',')[1], 'base64'), photoBytes, 'photo bytes match what customers see');
});

test('only staff can download a backup', async () => {
  assert.equal((await source.call('ann','GET','/api/backup')).status, 403);
  assert.equal((await source.call('nobody','GET','/api/backup')).status, 401);
});

test('restore refuses an installation that already has customer data', () => {
  const result = restore(source.base, archive);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already has customer data/);
});

test('a backup restores into a new installation with accounts, visits, diary and photos intact', async () => {
  const target = await startServer();
  try {
    const { call } = target;
    await call('staff','POST','/api/login',adminLogin);
    const wrongVersion = await call('staff','POST','/api/restore',{ ...backup, schema_version:99 });
    assert.equal(wrongVersion.status, 409);
    assert.match(wrongVersion.json.error, /schema version 99/);
    assert.equal((await call('staff','POST','/api/restore/photo',{ key:'../../etc/passwd', photo:'x' })).status, 400);

    const result = restore(target.base, archive);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 users, 1 services, 1 slots, 1 pets, 1 bookings, 1 booking_pets, 2 events/);

    assert.equal((await call('staff','GET','/api/portal')).status, 401, 'restore signs everyone out');
    assert.equal((await call('ann','POST','/api/login',{ email:'ann@example.test', password })).status, 200, 'customer password still works');
    const portal = (await call('ann','GET','/api/portal')).json;
    assert.equal(portal.pets[0].name, 'Biscuit');
    assert.equal(portal.bookings.find(b => b.id === visitId).notes, 'Side gate');
    const diary = (await call('ann','GET','/api/diary')).json;
    assert.equal(diary.events.length, 2);
    const event = diary.events.find(e => e.has_photo);
    assert.deepEqual((await call('ann','GET','/api/photos/' + event.id)).bytes, photoBytes);

    const again = restore(target.base, archive);
    assert.equal(again.status, 1, 'a second restore is refused once data exists');
  } finally { await target.stop(); }
});
