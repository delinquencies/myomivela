import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password, iso } from './helpers.mjs';

// Runs on both runtimes with the real rule: a visit may start from (visit buffer) minutes before its booked time.
let app, service, pet;
const call = (...args) => app.call(...args);
const minute = 60_000;
async function bookConfirmed(minutesAhead) {
  const starts = Math.ceil((Date.now() + minutesAhead * minute) / minute) * minute;
  assert.equal((await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + 60 * minute) })).status, 200);
  const window = (await call('staff','GET','/api/portal')).json.windows.find(w => w.starts === starts);
  const booking = await call('ann','POST','/api/bookings',{ service:service.id, cents:service.cents, pets:[pet], slot:window.id, start:starts, notes:'' });
  assert.equal(booking.status, 200, JSON.stringify(booking.json));
  assert.equal((await call('staff','POST','/api/status',{ id:booking.json.id, status:'Confirmed' })).status, 200);
  return booking.json.id;
}
const start = id => call('staff','POST','/api/status',{ id, status:'In Progress' });

// Each test gets its own installation, so visits booked minutes from now never collide.
beforeEach(async () => {
  app = await startServer({ MYO_EARLY_START_MINUTES:'' });
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'' });
  const data = (await call('ann','GET','/api/portal')).json;
  [service, pet] = [data.services[0], data.pets[0].id];
});
afterEach(() => app.stop());

test('with the default 30-minute buffer, a visit can start within 30 minutes of its time but not earlier', async () => {
  assert.equal((await call('staff','GET','/api/portal')).json.schedule.earlyStart, 30);
  const later = await bookConfirmed(180);
  const refused = await start(later);
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /can start from \d{1,2}:\d{2}\s?[AP]M ET \(30 minutes before it is booked\)/);
  const soon = await bookConfirmed(10);
  assert.equal((await start(soon)).status, 200, 'ten minutes early is inside the buffer');
});

test('the limit follows the visit buffer setting', async () => {
  const save = buffer => call('staff','POST','/api/schedule',{ days:[0,1,2,3,4,5,6], opens:'00:00', closes:'23:30', buffer });
  assert.equal((await save(0)).status, 200);
  assert.equal((await call('staff','GET','/api/portal')).json.schedule.earlyStart, 0);
  const soon = await bookConfirmed(12);
  const refused = await start(soon);
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /when it is booked/);
  assert.equal((await save(15)).status, 200);
  assert.equal((await start(soon)).status, 200, 'twelve minutes early is inside a 15-minute buffer');
});
