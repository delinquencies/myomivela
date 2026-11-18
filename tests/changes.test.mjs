import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';

// Change requests (C1.2): a customer's new time for a confirmed visit waits for staff; the visit keeps its time.
let app, service, pet, window_;
const call = (...args) => app.call(...args);
const minutes = n => n * 60_000;
const ok = async response => { const r = await response; assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
let next = 0;
async function confirmed(who = 'ann', petId = pet) {
  const start = window_.starts + minutes(30) * next++;
  const booking = await ok(call(who,'POST','/api/bookings',{ service:service.id, cents:service.cents, pets:[petId], slot:window_.id, start, notes:'' }));
  await ok(call('staff','POST','/api/status',{ id:booking.id, status:'Confirmed' }));
  return { id:booking.id, start };
}
const row = async (who, id) => (await call(who,'GET','/api/portal')).json.bookings.find(b => b.id === id);
const later = () => window_.starts + minutes(30) * (22 + next++); // proposed times sit in the second half of the 24-hour window
const move = (who, id, start) => call(who,'POST','/api/reschedule',{ id, slot:window_.id, start });

before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(24)) });
  for (const name of ['ann','bob']) {
    await call(name,'POST','/api/register',{ name, email:name + '@example.test', password });
    await call(name,'POST','/api/pets',{ name:name + '-pet', species:'Dog', details:'' });
  }
  const data = (await call('ann','GET','/api/portal')).json;
  [service, pet] = [data.services[0], data.pets[0].id];
  window_ = data.windows.find(w => w.starts === starts);
});
after(() => app.stop());

test('a requested (not yet confirmed) booking still moves directly', async () => {
  const start = window_.starts + minutes(30) * next++;
  const booking = await ok(call('ann','POST','/api/bookings',{ service:service.id, cents:service.cents, pets:[pet], slot:window_.id, start, notes:'' }));
  const to = later();
  assert.deepEqual(await ok(move('ann', booking.id, to)), {});
  const moved = await row('ann', booking.id);
  assert.equal(moved.starts, to);
  assert.equal(moved.status, 'Requested');
  assert.equal(moved.pending_change, null);
});

test('moving a confirmed visit creates a pending change and keeps the confirmed time', async () => {
  const visit = await confirmed();
  const to = later();
  const result = await ok(move('ann', visit.id, to));
  assert.equal(result.change.status, 'Pending');
  assert.equal(result.change.starts, to);
  const mine = await row('ann', visit.id);
  assert.equal(mine.status, 'Confirmed');
  assert.equal(mine.starts, visit.start, 'the original time stays booked');
  assert.deepEqual([mine.pending_change.id, mine.pending_change.starts], [result.change.id, to]);
  assert.equal((await row('staff', visit.id)).pending_change.id, result.change.id);
  // A newer request replaces the older one.
  const newer = await ok(move('ann', visit.id, later()));
  assert.notEqual(newer.change.id, result.change.id);
  assert.equal((await row('ann', visit.id)).pending_change.id, newer.change.id);
});

test('staff approve: the visit moves and stays confirmed', async () => {
  const visit = await confirmed();
  const to = later();
  const { change } = await ok(move('ann', visit.id, to));
  await ok(call('staff','POST','/api/changes/decide',{ id:change.id, decision:'approve' }));
  const moved = await row('ann', visit.id);
  assert.equal(moved.starts, to);
  assert.equal(moved.status, 'Confirmed');
  assert.equal(moved.pending_change, null);
  assert.equal(moved.last_change.status, 'Approved');
  const again = await call('staff','POST','/api/changes/decide',{ id:change.id, decision:'approve' });
  assert.equal(again.json.code, 'change_not_pending');
});

test('staff decline: the visit keeps its time', async () => {
  const visit = await confirmed();
  const { change } = await ok(move('ann', visit.id, later()));
  await ok(call('staff','POST','/api/changes/decide',{ id:change.id, decision:'decline' }));
  const kept = await row('ann', visit.id);
  assert.equal(kept.starts, visit.start);
  assert.equal(kept.last_change.status, 'Declined');
});

test('the customer can withdraw, and nobody else can', async () => {
  const visit = await confirmed();
  const { change } = await ok(move('ann', visit.id, later()));
  assert.equal((await call('bob','POST','/api/changes/withdraw',{ id:change.id })).status, 404);
  assert.equal((await call('ann','POST','/api/changes/decide',{ id:change.id, decision:'approve' })).status, 403);
  await ok(call('ann','POST','/api/changes/withdraw',{ id:change.id }));
  assert.equal((await row('ann', visit.id)).pending_change, null);
});

test('approval re-checks the new time, which may have been taken since', async () => {
  const visit = await confirmed();
  const to = later();
  const { change } = await ok(move('ann', visit.id, to));
  const bobPet = (await call('bob','GET','/api/portal')).json.pets[0].id;
  const bobs = await ok(call('bob','POST','/api/bookings',{ service:service.id, cents:service.cents, pets:[bobPet], slot:window_.id, start:to, notes:'' }));
  await ok(call('staff','POST','/api/status',{ id:bobs.id, status:'Confirmed' }));
  const refused = await call('staff','POST','/api/changes/decide',{ id:change.id, decision:'approve' });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.code, 'time_reserved');
  assert.equal((await row('staff', visit.id)).pending_change.id, change.id, 'the change stays pending so staff can decline it');
});

test('cancelling withdraws a pending change, and starting the visit declines it', async () => {
  const cancelled = await confirmed();
  await ok(move('ann', cancelled.id, later()));
  await ok(call('ann','POST','/api/status',{ id:cancelled.id, status:'Cancelled' }));
  assert.equal((await row('ann', cancelled.id)).pending_change, null);
  const started = await confirmed();
  await ok(move('ann', started.id, later()));
  await ok(call('staff','POST','/api/status',{ id:started.id, status:'In Progress' }));
  const live = await row('ann', started.id);
  assert.equal(live.pending_change, null);
  assert.equal(live.last_change.status, 'Declined');
});
