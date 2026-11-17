import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';

let app;
const call = (...args) => app.call(...args);
before(async () => {
  app = await startServer();
  assert.equal((await call('staff','POST','/api/login',adminLogin)).status, 200);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  await call('staff','POST','/api/services',{ name:'Overnight pet sitting', minutes:600, cents:11000 });
  for (const name of ['ann','bob']) {
    assert.equal((await call(name,'POST','/api/register',{ name, email:name+'@example.test', password })).status, 200);
    assert.equal((await call(name,'POST','/api/pets',{ name:name+'-pet', species:'Dog', details:'{}' })).status, 200);
  }
});
after(() => app.stop());

const portal = who => call(who,'GET','/api/portal').then(r => r.json);
const startOfDay = () => Math.ceil((Date.now() + hours(48)) / hours(1)) * hours(1);
let window = 0; // each test uses its own non-overlapping future day
async function publish(lengthHours) {
  const starts = startOfDay() + hours(24) * ++window;
  const response = await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(lengthHours)) });
  assert.equal(response.status, 200);
  const found = (await portal('staff')).windows.find(w => w.starts === starts);
  return { id:found.id, starts, ends:starts + hours(lengthHours) };
}
async function request(who, slot, start, serviceName = 'Dog walking') {
  const data = await portal(who);
  const service = data.services.find(s => s.name === serviceName);
  return call(who,'POST','/api/bookings',{ service:service.id, cents:service.cents, pets:[data.pets[0].id], slot:slot.id, start, notes:'' });
}

test('request → approve → start → diary update → complete is visible to the owner only', async () => {
  const slot = await publish(2);
  const booking = await request('ann', slot, slot.starts);
  assert.equal(booking.status, 200);
  const id = booking.json.id;
  for (const status of ['Confirmed','In Progress']) assert.equal((await call('staff','POST','/api/status',{ id, status })).status, 200);
  const pet = (await portal('ann')).pets[0].id;
  assert.equal((await call('staff','POST','/api/events',{ id, pet, kind:'Feeding', notes:'Lunch served' })).status, 200);
  assert.equal((await call('staff','POST','/api/status',{ id, status:'Completed' })).status, 400, 'completion needs a summary');
  assert.equal((await call('staff','POST','/api/status',{ id, status:'Completed', summary:'All good' })).status, 200);
  assert.equal((await call('staff','POST','/api/events',{ id, pet, kind:'Feeding', notes:'late' })).status, 409);
  const mine = (await call('ann','GET','/api/diary?visit='+id)).json;
  assert.equal(mine.events.filter(e => e.booking === id).length, 1);
  assert.equal(mine.visits[0].summary, 'All good');
  assert.equal((await portal('ann')).bookings.find(b => b.id === id).summary, 'All good');
  const theirs = (await call('bob','GET','/api/diary?visit='+id)).json;
  assert.equal(theirs.visits.length + theirs.events.length, 0, 'another customer cannot read the visit');
});

test('customers cannot touch each other’s bookings, pets, or staff endpoints', async () => {
  const slot = await publish(2);
  const booking = await request('ann', slot, slot.starts);
  const annPet = (await portal('ann')).pets[0].id;
  const bob = await portal('bob');
  assert.equal((await call('bob','POST','/api/status',{ id:booking.json.id, status:'Cancelled' })).status, 404);
  assert.equal((await call('bob','POST','/api/bookings',{ service:bob.services[0].id, cents:bob.services[0].cents, pets:[annPet], slot:slot.id, start:slot.starts + hours(1), notes:'' })).status, 404);
  assert.equal((await call('bob','POST','/api/pets',{ id:annPet, name:'x', species:'x', details:'' })).status, 404);
  assert.equal((await call('bob','POST','/api/slots',{ starts:iso(slot.starts), ends:iso(slot.ends) })).status, 403);
  assert.equal((await call('nobody','GET','/api/portal')).status, 401);
});

test('a window can hold several bookings on the start-time grid and rejects overlaps and off-grid starts', async () => {
  const slot = await publish(4);
  const portalSlots = (await portal('ann')).slots.filter(s => s.id === slot.id);
  assert.equal(portalSlots.length, 8, 'a 4-hour window offers 30-minute starts');
  const first = await request('ann', slot, slot.starts);
  const second = await request('bob', slot, slot.starts + hours(1));
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal((await call('staff','POST','/api/status',{ id:first.json.id, status:'Confirmed' })).status, 200);
  assert.equal((await call('staff','POST','/api/status',{ id:second.json.id, status:'Confirmed' })).status, 200, 'non-overlapping bookings share a window');
  const overlapping = await request('ann', slot, slot.starts + 75 * 60_000);
  assert.equal(overlapping.status, 409, 'off-grid start is rejected');
  const clash = await request('ann', slot, slot.starts + 30 * 60_000 * 2);
  assert.equal(clash.status, 409, 'start that overlaps a confirmed booking is rejected');
  assert.equal((await request('ann', slot, slot.ends)).status, 409, 'start at window end does not fit');
  assert.equal((await request('ann', slot, slot.starts - 30 * 60_000)).status, 409, 'start before the window is rejected');
  const offered = (await portal('ann')).slots.filter(s => s.id === slot.id && s.service_ids.length);
  assert.ok(!offered.some(s => s.starts === slot.starts || s.starts === slot.starts + hours(1)), 'booked starts are no longer offered');
});

test('two pending requests for one time cannot both be approved', async () => {
  const slot = await publish(1);
  const a = await request('ann', slot, slot.starts);
  const b = await request('bob', slot, slot.starts);
  assert.equal((await call('staff','POST','/api/status',{ id:a.json.id, status:'Confirmed' })).status, 200);
  const second = await call('staff','POST','/api/status',{ id:b.json.id, status:'Confirmed' });
  assert.equal(second.status, 409);
});

test('approval is rejected when the published window was withdrawn', async () => {
  const slot = await publish(1);
  const booking = await request('ann', slot, slot.starts);
  assert.equal((await call('staff','POST','/api/slots',{ id:slot.id })).status, 200);
  assert.equal((await call('staff','POST','/api/status',{ id:booking.json.id, status:'Confirmed' })).status, 409);
});

test('the quoted price must match the current price', async () => {
  const slot = await publish(1);
  const data = await portal('ann');
  const service = data.services.find(s => s.name === 'Dog walking');
  const stale = await call('ann','POST','/api/bookings',{ service:service.id, cents:service.cents - 1, pets:[data.pets[0].id], slot:slot.id, start:slot.starts, notes:'' });
  assert.equal(stale.status, 409);
});

test('malformed URLs return 404, not a server error', async () => {
  assert.equal((await call('x','GET','/%E0%A4%A')).status, 404);
  assert.equal((await call('x','GET','/assets/../server.mjs')).status, 404);
  assert.equal((await call('x','GET','/lib/image.mjs')).status, 404);
});

test('responses carry CSP and permissions policy headers', async () => {
  const { headers } = await call('x','GET','/');
  assert.match(headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(headers.get('permissions-policy'), /geolocation=\(\)/);
  assert.equal(headers.get('strict-transport-security'), null, 'HSTS only when secure cookies are configured');
});

test('password guessing on one account locks that account but not other users', async () => {
  for (let i = 0; i < 8; i++) assert.equal((await call('guess','POST','/api/login',{ email:'ann@example.test', password:'wrong-password-'+i })).status, 401);
  assert.equal((await call('guess','POST','/api/login',{ email:'ann@example.test', password })).status, 429, 'locked even for the right password');
  assert.equal((await call('guess','POST','/api/login',{ email:'bob@example.test', password })).status, 200, 'other accounts are unaffected');
});

test('a request that names only the window still books the window start', async () => {
  const slot = await publish(1);
  const data = await portal('ann');
  const service = data.services.find(s => s.name === 'Dog walking');
  const booking = await call('ann','POST','/api/bookings',{ service:service.id, cents:service.cents, pets:[data.pets[0].id], slot:slot.id, notes:'' });
  assert.equal(booking.status, 200);
  assert.equal((await portal('ann')).bookings.find(b => b.id === booking.json.id).starts, slot.starts);
});
