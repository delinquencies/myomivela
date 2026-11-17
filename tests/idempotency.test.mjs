import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';

// Runs on both runtimes. A write retried with the same Idempotency-Key runs once.
let app, pet, service, slot;
const call = (...args) => app.call(...args);
const keyed = (who, path, body, key) => call(who, 'POST', path, body, { 'Idempotency-Key':key });
let serial = 0;
const newKey = () => 'test-key-' + String(++serial).padStart(8, '0') + '-' + Date.now();
const png = () => { // valid 1×1 PNG
  const table = Array.from({ length:256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = bytes => { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const check = Buffer.alloc(4); check.writeUInt32BE(crc(body)); return Buffer.concat([length, body, check]); };
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'), chunk('IHDR', Buffer.from([0,0,0,1,0,0,0,1,8,2,0,0,0])), chunk('IDAT', deflateSync(Buffer.from([0,255,0,0]))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
};

before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(8)) });
  for (const who of ['ann','bob']) {
    await call(who,'POST','/api/register',{ name:who, email:who + '@example.test', password });
    await call(who,'POST','/api/pets',{ name:who + '-pet', species:'Dog', details:'' });
  }
  const data = (await call('ann','GET','/api/portal')).json;
  [pet, service, slot] = [data.pets[0].id, data.services[0], data.slots[0]];
});
after(() => app.stop());

let nextStart = 0;
const bookingBody = () => ({ service:service.id, cents:service.cents, pets:[pet], slot:slot.id, start:slot.starts + hours(0.5) * nextStart++, notes:'' });
async function visitInProgress() {
  const booking = await call('ann','POST','/api/bookings',bookingBody());
  for (const status of ['Confirmed','In Progress']) assert.equal((await call('staff','POST','/api/status',{ id:booking.json.id, status })).status, 200);
  return booking.json.id;
}
const eventsFor = async id => (await call('ann','GET','/api/diary?visit=' + id)).json.events;

test('a repeated booking request with the same key creates one booking and returns the same answer', async () => {
  const key = newKey();
  const body = bookingBody();
  const first = await keyed('ann','/api/bookings',body,key);
  const second = await keyed('ann','/api/bookings',body,key);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(second.json, first.json);
  assert.equal(second.headers.get('idempotent-replay'), 'true');
  const mine = (await call('ann','GET','/api/portal')).json.bookings.filter(b => b.starts === body.start);
  assert.equal(mine.length, 1);
});

test('a retried diary update is published once, even when both copies arrive together', async () => {
  const id = await visitInProgress();
  const body = { id, pet, kind:'Feeding', notes:'Dinner', photo:png() };
  const key = newKey();
  const together = await Promise.all([keyed('staff','/api/events',body,key), keyed('staff','/api/events',body,key)]);
  for (const response of together) assert.ok([200, 409].includes(response.status), 'a copy that overlaps the first is told to wait: ' + response.status);
  assert.ok(together.some(response => response.status === 200));
  const later = await keyed('staff','/api/events',body,key);
  assert.equal(later.status, 200);
  assert.equal(later.headers.get('idempotent-replay'), 'true');
  assert.equal((await eventsFor(id)).length, 1);
});

test('a retried approval replays its success instead of reporting a conflict', async () => {
  const booking = await call('ann','POST','/api/bookings',bookingBody());
  const key = newKey();
  assert.equal((await keyed('staff','/api/status',{ id:booking.json.id, status:'Confirmed' },key)).status, 200);
  assert.equal((await keyed('staff','/api/status',{ id:booking.json.id, status:'Confirmed' },key)).status, 200);
  assert.equal((await call('staff','POST','/api/status',{ id:booking.json.id, status:'Confirmed' })).status, 409, 'without a key the repeat is still refused');
});

test('a key reused with different content is refused', async () => {
  const id = await visitInProgress();
  const key = newKey();
  assert.equal((await keyed('staff','/api/events',{ id, pet, kind:'Water', notes:'one' },key)).status, 200);
  const changed = await keyed('staff','/api/events',{ id, pet, kind:'Water', notes:'two' },key);
  assert.equal(changed.status, 422);
  assert.equal((await eventsFor(id)).length, 1);
});

test('a refused request is not remembered, so it can be corrected and resent with the same key', async () => {
  const id = await visitInProgress();
  const key = newKey();
  assert.equal((await keyed('staff','/api/events',{ id, pet, kind:'Not a kind', notes:'' },key)).status, 400);
  // The fingerprint belongs to the stored claim, which a refusal deletes, so new content is accepted.
  assert.equal((await keyed('staff','/api/events',{ id, pet, kind:'Rest', notes:'nap' },key)).status, 200);
  assert.equal((await eventsFor(id)).length, 1);
});

test('keys belong to one account, and malformed keys are rejected', async () => {
  const key = newKey();
  assert.equal((await keyed('ann','/api/pets',{ name:'Pip', species:'Cat', details:'' },key)).status, 200);
  assert.equal((await keyed('bob','/api/pets',{ name:'Pip', species:'Cat', details:'' },key)).status, 200, 'same key, other user: runs');
  assert.equal((await call('bob','GET','/api/portal')).json.pets.filter(p => p.name === 'Pip').length, 1);
  assert.equal((await keyed('ann','/api/pets',{ name:'Pip', species:'Cat', details:'' },'short')).status, 400);
  assert.equal((await keyed('ann','/api/pets',{ name:'Pip', species:'Cat', details:'' },'has spaces in it, not allowed')).status, 400);
});
