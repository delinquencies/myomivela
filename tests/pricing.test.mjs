import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, adminLogin, password, iso, hours, nodeOnly } from './helpers.mjs';

// Itemised quotes (C1.1): extra-pet pricing, booking lines, price checks and machine-readable errors. Both runtimes.
let app, service, pets, slot;
const call = (...args) => app.call(...args);
const body = (petIds, start, cents) => ({ service:service.id, pets:petIds, slot:slot.id, start, cents, notes:'' });

before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  assert.equal((await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000, extra_pet_cents:1000 })).status, 200);
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(6)) });
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  for (const name of ['Rex','Pip']) await call('ann','POST','/api/pets',{ name, species:'Dog', details:'' });
  await call('bob','POST','/api/register',{ name:'Bob', email:'bob@example.test', password });
  await call('bob','POST','/api/pets',{ name:'Mo', species:'Cat', details:'' });
  const data = (await call('ann','GET','/api/portal')).json;
  [service, pets] = [data.services[0], data.pets.map(p => p.id)];
  slot = data.windows.find(w => w.starts === starts);
});
after(() => app.stop());

test('the catalog carries the extra-pet amount', async () => {
  assert.equal((await call('ann','GET','/api/catalog')).json[0].extra_pet_cents, 1000);
  assert.equal(service.extra_pet_cents, 1000);
});

test('a quote itemises the base price and extra pets', async () => {
  const one = await call('ann','POST','/api/quote', body([pets[0]], slot.starts));
  assert.equal(one.status, 200);
  assert.deepEqual(one.json.lines, [{ code:'base', label:'Dog walking', quantity:1, cents:3000 }]);
  assert.equal(one.json.total_cents, 3000);
  const two = await call('ann','POST','/api/quote', body(pets, slot.starts));
  assert.deepEqual(two.json.lines.map(l => [l.code, l.quantity, l.cents]), [['base',1,3000],['extra_pet',1,1000]]);
  assert.equal(two.json.total_cents, 4000);
  assert.equal(two.json.ends - two.json.starts, 30 * 60_000);
  assert.equal((await call('staff','POST','/api/quote', body(pets, slot.starts))).status, 403, 'staff do not request care');
});

test('a hold or request at a stale price is refused with the current total', async () => {
  const stale = await call('ann','POST','/api/checkout-hold', body(pets, slot.starts, 3000));
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'price_changed');
  assert.equal(stale.json.total_cents, 4000);
  assert.equal((await call('ann','POST','/api/bookings', body(pets, slot.starts, 3000))).json.code, 'price_changed');
});

test('a booking stores its lines and total, and both reach the portal and financials', async () => {
  const hold = await call('ann','POST','/api/checkout-hold', body(pets, slot.starts, 4000));
  assert.equal(hold.status, 200);
  assert.equal(hold.json.total_cents, 4000);
  assert.equal(hold.json.lines.length, 2);
  const booking = await call('ann','POST','/api/bookings', { ...body(pets, slot.starts, 4000), hold:hold.json.expires });
  assert.equal(booking.status, 200, JSON.stringify(booking.json));
  const row = (await call('ann','GET','/api/portal')).json.bookings.find(b => b.id === booking.json.id);
  assert.equal(row.cents, 4000);
  assert.deepEqual(row.lines.map(l => l.code), ['base','extra_pet']);
  const staffRow = (await call('staff','GET','/api/portal')).json.bookings.find(b => b.id === booking.json.id);
  assert.deepEqual(staffRow.lines, row.lines);
  assert.equal((await call('staff','POST','/api/status',{ id:booking.json.id, status:'Confirmed' })).status, 200);
  assert.equal((await call('staff','GET','/api/financials')).json.upcoming.cents, 4000);
});

test('errors carry machine-readable codes', async () => {
  const offGrid = await call('bob','POST','/api/quote', { ...body([], slot.starts + 7 * 60_000), pets:[(await call('bob','GET','/api/portal')).json.pets[0].id] });
  assert.equal(offGrid.status, 409);
  assert.equal(offGrid.json.code, 'time_unavailable');
  const bobPet = (await call('bob','GET','/api/portal')).json.pets[0].id;
  const taken = await call('bob','POST','/api/quote', { ...body([bobPet], slot.starts) });
  assert.equal(taken.json.code, 'time_reserved', 'Ann’s confirmed visit holds that time');
  const missing = await call('ann','POST','/api/quote', { service:999, pets, slot:slot.id, start:slot.starts });
  assert.equal(missing.status, 404);
  assert.equal('code' in missing.json, false, 'errors without a code keep the plain shape');
});

test('bookings made before itemised prices show one base line for their total', { skip:nodeOnly }, async () => {
  const db = new DatabaseSync(app.dbPath);
  db.exec('DELETE FROM booking_lines');
  db.close();
  const row = (await call('ann','GET','/api/portal')).json.bookings[0];
  assert.deepEqual(row.lines, [{ code:'base', label:'Dog walking', quantity:1, cents:4000 }]);
});
